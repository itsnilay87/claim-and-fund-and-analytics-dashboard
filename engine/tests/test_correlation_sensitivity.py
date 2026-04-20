"""
Tests for v2_correlation_sensitivity.py — Gaussian copula correlation model.
=============================================================================

Covers:
  - Outcome vector enumeration (shape, uniqueness, binary)
  - Conditional q boundary conditions (ρ=0, ρ=1, ρ=0.5)
  - Marginal preservation under quadrature
  - Vector probability normalization
  - P(loss) monotonicity in ρ
  - E[MOIC] approximate invariance to ρ
  - ρ=0 matches independence baseline
  - 2D heatmap dimensions
  - Diversification benefit ordering
  - Full run_correlation_sensitivity integration with mock data

All tests use mock data — no full MC simulation required.
"""

from __future__ import annotations

import math

import numpy as np
import pytest
from scipy.special import ndtri, ndtr
from unittest.mock import MagicMock

from engine.v2_core.v2_correlation_sensitivity import (
    _compute_conditional_q,
    _compute_conditional_q_vectorized,
    _compute_vector_probabilities,
    _enumerate_outcome_vectors,
    _extract_binary_conditionals,
    _precompute_vector_metrics,
    _setup_gauss_hermite,
    _sweep_single_rho,
    _sweep_correlation,
    run_correlation_sensitivity,
    RHO_VALUES,
    HEATMAP_DELTA_VALUES,
    HEATMAP_RHO_VALUES,
    REFERENCE_DEALS,
)


# ============================================================================
# Mock data helpers
# ============================================================================

def _make_mock_path(collected_cr: float, legal_cost_cr: float, duration_months: float):
    """Create a mock PathResult with essential fields."""
    pr = MagicMock()
    pr.collected_cr = collected_cr
    pr.legal_cost_total_cr = legal_cost_cr
    pr.total_duration_months = duration_months
    return pr


def _make_mock_claim(
    claim_id: str,
    soc_cr: float,
    p_win: float,
    e_collected_win: float,
    e_legal_win: float,
    e_legal_lose: float,
    e_duration_win: float = 48.0,
    e_duration_lose: float = 36.0,
    n_paths: int = 1000,
    tpl_share: float = 1.0,
):
    """Create a mock ClaimConfig and corresponding path results.

    Generates n_paths paths where p_win fraction are wins with the
    specified conditional expectations.
    """
    claim = MagicMock()
    claim.claim_id = claim_id
    claim.soc_value_cr = soc_cr
    claim.tpl_share = tpl_share

    n_win = int(n_paths * p_win)
    n_lose = n_paths - n_win

    paths = []
    for _ in range(n_win):
        paths.append(_make_mock_path(e_collected_win, e_legal_win, e_duration_win))
    for _ in range(n_lose):
        paths.append(_make_mock_path(0.0, e_legal_lose, e_duration_lose))

    return claim, paths


def _build_mock_sim_and_claims(n_claims: int = 6, n_paths: int = 1000):
    """Build a mock SimulationResults and claims list for testing.

    Creates n_claims claims with varying p_win and returns.
    All claims are profitable (high collected_win relative to costs).
    """
    claim_configs = [
        ("D1", 100.0, 0.70, 80.0, 5.0, 3.0, 48.0, 36.0),
        ("D2", 150.0, 0.65, 120.0, 7.0, 4.0, 50.0, 38.0),
        ("D3", 80.0,  0.75, 65.0, 4.0, 2.5, 45.0, 34.0),
        ("S1", 200.0, 0.60, 160.0, 10.0, 5.0, 55.0, 40.0),
        ("S2", 120.0, 0.68, 95.0, 6.0, 3.5, 46.0, 35.0),
        ("S3", 90.0,  0.72, 70.0, 4.5, 2.8, 44.0, 33.0),
    ]

    claims = []
    sim = MagicMock()
    sim.results = {}
    sim.n_paths = n_paths
    sim.claim_ids = []

    for i in range(min(n_claims, len(claim_configs))):
        cid, soc, p_win, e_coll, e_lw, e_ll, e_dw, e_dl = claim_configs[i]
        claim, paths = _make_mock_claim(
            cid, soc, p_win, e_coll, e_lw, e_ll, e_dw, e_dl, n_paths,
        )
        claims.append(claim)
        sim.results[cid] = paths
        sim.claim_ids.append(cid)

    grid = MagicMock()
    return sim, claims, grid


# ============================================================================
# Test 1: Outcome vector enumeration
# ============================================================================

class TestEnumerateOutcomeVectors:

    def test_shape_K1(self):
        vecs = _enumerate_outcome_vectors(1)
        assert vecs.shape == (2, 1)

    def test_shape_K2(self):
        vecs = _enumerate_outcome_vectors(2)
        assert vecs.shape == (4, 2)

    def test_shape_K3(self):
        vecs = _enumerate_outcome_vectors(3)
        assert vecs.shape == (8, 3)

    def test_shape_K6(self):
        vecs = _enumerate_outcome_vectors(6)
        assert vecs.shape == (64, 6)

    def test_all_unique(self):
        vecs = _enumerate_outcome_vectors(6)
        unique_rows = np.unique(vecs, axis=0)
        assert len(unique_rows) == 64

    def test_all_binary(self):
        vecs = _enumerate_outcome_vectors(6)
        assert np.all((vecs == 0.0) | (vecs == 1.0))

    def test_includes_all_zeros_and_all_ones(self):
        vecs = _enumerate_outcome_vectors(4)
        has_all_zeros = any(np.all(v == 0) for v in vecs)
        has_all_ones = any(np.all(v == 1) for v in vecs)
        assert has_all_zeros and has_all_ones


# ============================================================================
# Test 2: Conditional q boundary conditions
# ============================================================================

class TestConditionalQBoundaries:

    @pytest.mark.parametrize("p", [0.3, 0.5, 0.7, 0.9])
    def test_rho_zero_returns_p(self, p):
        """At ρ=0, q_i(m, 0) = p_i for all m."""
        for m in [-2.0, -1.0, 0.0, 1.0, 2.0]:
            q = _compute_conditional_q(p, 0.0, m)
            assert abs(q - p) < 1e-10, f"ρ=0: expected {p}, got {q} at m={m}"

    @pytest.mark.parametrize("p", [0.3, 0.5, 0.7, 0.9])
    def test_rho_one_below_threshold(self, p):
        """At ρ=1 with m < Φ⁻¹(p), q → 1.0."""
        threshold = ndtri(p)
        m = threshold - 1.0  # well below threshold
        q = _compute_conditional_q(p, 1.0, m)
        assert q == 1.0, f"ρ=1, m < threshold: expected 1.0, got {q}"

    @pytest.mark.parametrize("p", [0.3, 0.5, 0.7, 0.9])
    def test_rho_one_above_threshold(self, p):
        """At ρ=1 with m > Φ⁻¹(p), q → 0.0."""
        threshold = ndtri(p)
        m = threshold + 1.0  # well above threshold
        q = _compute_conditional_q(p, 1.0, m)
        assert q == 0.0, f"ρ=1, m > threshold: expected 0.0, got {q}"

    @pytest.mark.parametrize("p", [0.3, 0.5, 0.7, 0.9])
    def test_rho_half_m_zero(self, p):
        """At ρ=0.5, m=0: q = Φ(Φ⁻¹(p)/√0.5)."""
        expected = float(ndtr(ndtri(p) / math.sqrt(0.5)))
        q = _compute_conditional_q(p, 0.5, 0.0)
        assert abs(q - expected) < 1e-8, f"ρ=0.5, m=0: expected {expected}, got {q}"

    def test_p_zero(self):
        q = _compute_conditional_q(0.0, 0.5, 0.0)
        assert q == 0.0

    def test_p_one(self):
        q = _compute_conditional_q(1.0, 0.5, 0.0)
        assert q == 1.0

    def test_vectorized_matches_scalar(self):
        """Vectorized version should match scalar for each element."""
        p_vec = np.array([0.3, 0.5, 0.7, 0.9])
        rho = 0.4
        m = 0.5

        q_vec = _compute_conditional_q_vectorized(p_vec, rho, m)
        for i, p in enumerate(p_vec):
            q_scalar = _compute_conditional_q(p, rho, m)
            assert abs(q_vec[i] - q_scalar) < 1e-10


# ============================================================================
# Test 3: Marginal preservation
# ============================================================================

class TestMarginalPreservation:

    @pytest.mark.parametrize("p", [0.3, 0.5, 0.7, 0.9])
    @pytest.mark.parametrize("rho", [0.1, 0.25, 0.5, 0.75, 0.9])
    def test_integral_recovers_marginal(self, p, rho):
        """∫ q_i(m,ρ) φ(m) dm ≈ p_i using GH quadrature."""
        nodes, weights = _setup_gauss_hermite(30)
        integral = 0.0
        for j in range(len(nodes)):
            q = _compute_conditional_q(p, rho, nodes[j])
            integral += weights[j] * q
        assert abs(integral - p) < 0.001, (
            f"Marginal not preserved: ρ={rho}, p={p}, integral={integral:.6f}"
        )


# ============================================================================
# Test 4: Vector probability sum
# ============================================================================

class TestVectorProbabilitySum:

    @pytest.mark.parametrize("K", [2, 3, 4, 6])
    def test_probs_sum_to_one(self, K):
        """At each GH node, Σ P(s|M=m) = 1.0."""
        p_vec = np.random.default_rng(42).uniform(0.3, 0.8, K)
        outcome_vectors = _enumerate_outcome_vectors(K)
        nodes, _ = _setup_gauss_hermite(30)

        for rho in [0.0, 0.3, 0.5, 0.8, 1.0]:
            for m in nodes[:5]:  # check a subset for speed
                q_vec = _compute_conditional_q_vectorized(p_vec, rho, m)
                probs = _compute_vector_probabilities(q_vec, outcome_vectors)
                total = float(np.sum(probs))
                assert abs(total - 1.0) < 1e-8, (
                    f"Probs sum to {total} at ρ={rho}, m={m:.3f}"
                )


# ============================================================================
# Test 5: P(loss) monotonicity in ρ
# ============================================================================

class TestPLossMonotonicity:

    def test_p_loss_nondecreasing(self):
        """P(loss) should be non-decreasing in ρ for a profitable portfolio."""
        sim, claims, grid = _build_mock_sim_and_claims(6, 1000)
        conditionals = _extract_binary_conditionals(sim, claims)
        claim_ids = [c.claim_id for c in claims]
        outcome_vectors = _enumerate_outcome_vectors(len(claim_ids))
        vector_metrics = _precompute_vector_metrics(outcome_vectors, conditionals, claim_ids)
        gh_nodes, gh_weights = _setup_gauss_hermite(30)

        # Exclude ρ=1.0: at perfect correlation the deterministic step-function
        # threshold can violate monotonicity for heterogeneous portfolios.
        rho_values = [0.0, 0.1, 0.2, 0.3, 0.5, 0.7, 0.9]
        for deal_key in ["10_20", "30_10"]:
            prev_p_loss = -1.0
            for rho in rho_values:
                per_deal = _sweep_single_rho(
                    rho, np.array([conditionals[cid]["p_i"] for cid in claim_ids]),
                    outcome_vectors, vector_metrics, gh_nodes, gh_weights,
                )
                p_loss = per_deal[deal_key]["p_loss"]
                assert p_loss >= prev_p_loss - 1e-6, (
                    f"P(loss) decreased: {prev_p_loss:.6f} → {p_loss:.6f} at ρ={rho} "
                    f"for deal {deal_key}"
                )
                prev_p_loss = p_loss


# ============================================================================
# Test 6: E[MOIC] approximate invariance to ρ
# ============================================================================

class TestEMoicInvariance:

    def test_e_moic_roughly_constant(self):
        """E[MOIC] should be approximately constant across ρ values."""
        sim, claims, grid = _build_mock_sim_and_claims(6, 1000)
        conditionals = _extract_binary_conditionals(sim, claims)
        claim_ids = [c.claim_id for c in claims]
        outcome_vectors = _enumerate_outcome_vectors(len(claim_ids))
        vector_metrics = _precompute_vector_metrics(outcome_vectors, conditionals, claim_ids)
        gh_nodes, gh_weights = _setup_gauss_hermite(30)

        # Exclude ρ=1.0: perfect correlation produces a step function
        # that breaks the approximate invariance for nonlinear portfolio metrics.
        rho_values = [0.0, 0.1, 0.25, 0.5, 0.75]

        for deal_key in ["10_20", "20_30"]:
            e_moic_at_zero = None
            for rho in rho_values:
                per_deal = _sweep_single_rho(
                    rho, np.array([conditionals[cid]["p_i"] for cid in claim_ids]),
                    outcome_vectors, vector_metrics, gh_nodes, gh_weights,
                )
                e_moic = per_deal[deal_key]["e_moic"]
                if e_moic_at_zero is None:
                    e_moic_at_zero = e_moic
                assert abs(e_moic - e_moic_at_zero) < 0.10, (
                    f"E[MOIC] deviated: {e_moic_at_zero:.4f} → {e_moic:.4f} at ρ={rho} "
                    f"for deal {deal_key}"
                )


# ============================================================================
# Test 7: ρ=0 matches independence baseline
# ============================================================================

class TestRhoZeroMatchesIndependence:

    def test_rho_zero_p_loss(self):
        """P(loss|ρ=0) should match analytically computed independence P(loss)."""
        sim, claims, grid = _build_mock_sim_and_claims(6, 1000)
        conditionals = _extract_binary_conditionals(sim, claims)
        claim_ids = [c.claim_id for c in claims]
        outcome_vectors = _enumerate_outcome_vectors(len(claim_ids))
        vector_metrics = _precompute_vector_metrics(outcome_vectors, conditionals, claim_ids)
        gh_nodes, gh_weights = _setup_gauss_hermite(30)

        # Compute at ρ=0
        per_deal_rho0 = _sweep_single_rho(
            0.0, np.array([conditionals[cid]["p_i"] for cid in claim_ids]),
            outcome_vectors, vector_metrics, gh_nodes, gh_weights,
        )

        # Compute independence directly: enumerate vectors with product of marginals
        p_vec = np.array([conditionals[cid]["p_i"] for cid in claim_ids])
        vec_probs = _compute_vector_probabilities(p_vec, outcome_vectors)
        moics = vector_metrics["10_20"]["moics"]
        independent_p_loss = float(np.dot(vec_probs, (moics < 1.0).astype(float)))

        rho0_p_loss = per_deal_rho0["10_20"]["p_loss"]
        assert abs(rho0_p_loss - independent_p_loss) < 1e-6, (
            f"ρ=0 P(loss) {rho0_p_loss:.6f} != independence {independent_p_loss:.6f}"
        )


# ============================================================================
# Test 8: 2D heatmap shape
# ============================================================================

class TestHeatmapShape:

    def test_heatmap_dimensions(self):
        """heatmap_2d should have 7 delta × 11 rho dimensions."""
        sim, claims, grid = _build_mock_sim_and_claims(6, 500)
        result = run_correlation_sensitivity(sim, claims, grid)

        hm = result["heatmap_2d"]
        assert len(hm["delta_values"]) == 7
        assert len(hm["rho_values"]) == 11
        assert len(hm["p_loss"]) == 7, f"Expected 7 delta rows, got {len(hm['p_loss'])}"
        assert len(hm["p_loss"][0]) == 11, f"Expected 11 rho cols, got {len(hm['p_loss'][0])}"
        assert len(hm["e_moic"]) == 7
        assert len(hm["e_moic"][0]) == 11


# ============================================================================
# Test 9: Diversification benefit
# ============================================================================

class TestDiversificationBenefit:

    def test_diversification_ordering(self):
        """p_loss_independent ≤ p_loss_mid_corr ≤ p_loss_perfect."""
        sim, claims, grid = _build_mock_sim_and_claims(6, 500)
        result = run_correlation_sensitivity(sim, claims, grid)

        db = result["diversification_benefit"]
        assert db["p_loss_independent"] <= db["p_loss_mid_corr"] + 1e-6, (
            f"Independent {db['p_loss_independent']:.6f} > mid {db['p_loss_mid_corr']:.6f}"
        )
        assert db["p_loss_mid_corr"] <= db["p_loss_perfect"] + 1e-6, (
            f"Mid {db['p_loss_mid_corr']:.6f} > perfect {db['p_loss_perfect']:.6f}"
        )

    def test_diversification_ratio_le_one(self):
        """diversification_ratio = P(loss|ρ=0)/P(loss|ρ=0.5) should be ≤ 1.0."""
        sim, claims, grid = _build_mock_sim_and_claims(6, 500)
        result = run_correlation_sensitivity(sim, claims, grid)

        db = result["diversification_benefit"]
        assert db["diversification_ratio"] <= 1.0 + 1e-6, (
            f"Diversification ratio {db['diversification_ratio']:.4f} > 1.0"
        )


# ============================================================================
# Test 10: Full run_correlation_sensitivity output structure
# ============================================================================

class TestFullRunOutputStructure:

    @pytest.fixture(scope="class")
    def corr_result(self):
        """Run once for the whole class."""
        sim, claims, grid = _build_mock_sim_and_claims(6, 500)
        return run_correlation_sensitivity(sim, claims, grid)

    def test_rho_values_count(self, corr_result):
        assert len(corr_result["rho_values"]) == 21

    def test_reference_deals_count(self, corr_result):
        assert len(corr_result["reference_deals"]) == 4

    def test_per_deal_keys(self, corr_result):
        expected_keys = {"10_20", "15_25", "20_30", "30_10"}
        assert set(corr_result["per_deal"].keys()) == expected_keys

    def test_per_deal_array_lengths(self, corr_result):
        for deal_key in ["10_20", "15_25", "20_30", "30_10"]:
            deal = corr_result["per_deal"][deal_key]
            for metric in ["p_loss", "e_moic", "sigma_moic", "var_1", "cvar_1", "e_irr"]:
                assert len(deal[metric]) == 21, (
                    f"Deal {deal_key} metric {metric}: expected 21, got {len(deal[metric])}"
                )

    def test_per_claim_present(self, corr_result):
        expected_claims = {"D1", "D2", "D3", "S1", "S2", "S3"}
        assert set(corr_result["per_claim"].keys()) == expected_claims

    def test_per_claim_fields(self, corr_result):
        for cid, data in corr_result["per_claim"].items():
            assert "p_i" in data
            assert "e_collected_win_cr" in data
            assert "e_legal_win_cr" in data
            assert "e_legal_lose_cr" in data
            assert 0.0 <= data["p_i"] <= 1.0

    def test_computation_time(self, corr_result):
        assert corr_result["computation_time_s"] >= 0

    def test_heatmap_present(self, corr_result):
        assert "heatmap_2d" in corr_result

    def test_diversification_present(self, corr_result):
        assert "diversification_benefit" in corr_result


# ============================================================================
# Test 11: Gauss-Hermite weights sum to 1
# ============================================================================

class TestGaussHermite:

    def test_weights_sum_to_one(self):
        nodes, weights = _setup_gauss_hermite(30)
        assert abs(weights.sum() - 1.0) < 1e-10

    def test_node_count(self):
        nodes, weights = _setup_gauss_hermite(30)
        assert len(nodes) == 30
        assert len(weights) == 30
