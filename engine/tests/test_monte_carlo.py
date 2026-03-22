"""
engine/tests/test_monte_carlo.py — Tests for the Monte Carlo simulation engine.
================================================================================

Golden tests verify the MC engine produces statistically valid results
consistent with the TATA v2 probability model.

NOTE on win rates:
  The analytical win rate (no 96-month cap) for domestic is ~56%.
  With the 96-month cap, most RESTART paths exceed the horizon
  (pre-arb + first challenge + re-arb + post-challenge ≈ 106 months avg),
  reducing the effective rate to ~51%.  The SIAC rate is less affected
  (challenge durations are shorter: HC+COA = 12 months fixed).
"""

from __future__ import annotations

import math

import numpy as np
import pytest

from engine.config.defaults import (
    DEFAULT_ARBITRATION_CONFIG,
    DEFAULT_DOMESTIC_TREE,
    DEFAULT_LEGAL_COSTS,
    DEFAULT_QUANTUM_CONFIG,
    DEFAULT_SIAC_TREE,
    get_default_claim_config,
)
from engine.config.schema import (
    ArbitrationConfig,
    ClaimConfig,
    PathResult,
)
from engine.jurisdictions.registry import REGISTRY
from engine.simulation.monte_carlo import (
    compute_claim_summary,
    run_claim_simulation,
    run_portfolio_simulation,
    simulate_one_path,
)


# ============================================================================
# Fixtures
# ============================================================================

@pytest.fixture
def domestic_claim() -> ClaimConfig:
    """ClaimConfig matching TATA TP-301-6 (domestic, prolongation, SOC=1532 Cr)."""
    return get_default_claim_config(
        "indian_domestic",
        claim_id="TP-301-6",
        name="TP-301-6 Prolongation",
        soc_value_cr=1532.0,
    )


@pytest.fixture
def domestic_template():
    return REGISTRY.get_template("indian_domestic")


@pytest.fixture
def siac_claim() -> ClaimConfig:
    """ClaimConfig matching TATA TP-CTP11-4 (SIAC, prolongation, SOC=1368 Cr)."""
    return get_default_claim_config(
        "siac_singapore",
        claim_id="TP-CTP11-4",
        name="TP-CTP11-4 Prolongation",
        soc_value_cr=1368.0,
    )


@pytest.fixture
def siac_template():
    return REGISTRY.get_template("siac_singapore")


# ============================================================================
# TEST 1: Golden test — Domestic TP-301-6
# ============================================================================

class TestGoldenDomestic:
    """Golden test for domestic claim matching TATA TP-301-6."""

    N = 10_000
    SEED = 42

    def test_win_rate(self, domestic_claim, domestic_template):
        """Win rate should be in the range expected for P(win)=0.70.

        Analytical rate without 96m cap: ~56%.
        Effective rate with 96m cap (most RESTART paths exceed horizon):
        ~50-54%.  We use a tolerance band of ±5% around the analytical
        value to accommodate both cap effects and MC noise.
        """
        results = run_claim_simulation(
            domestic_claim, domestic_template, self.N, self.SEED,
        )
        summary = compute_claim_summary(domestic_claim, results)
        win_rate = summary["win_rate"]
        # Analytical P(TRUE_WIN) ≈ 0.70 × 0.736 = 0.515 (direct)
        # Plus small RESTART contribution: up to 0.561 without cap.
        # With 96-month cap, effective ~0.50-0.54.
        assert 0.47 <= win_rate <= 0.58, (
            f"Domestic win rate {win_rate:.4f} outside expected range [0.47, 0.58]"
        )

    def test_collected_reasonable(self, domestic_claim, domestic_template):
        """E[collected|win] should be > 0 and < SOC."""
        results = run_claim_simulation(
            domestic_claim, domestic_template, self.N, self.SEED,
        )
        summary = compute_claim_summary(domestic_claim, results)
        mean_q = summary["mean_quantum_cr"]
        assert mean_q > 0, "Mean quantum should be > 0"
        assert mean_q <= domestic_claim.soc_value_cr, (
            f"Mean quantum {mean_q} should not exceed SOC {domestic_claim.soc_value_cr}"
        )

    def test_all_paths_valid(self, domestic_claim, domestic_template):
        """All 10,000 paths must have valid outcomes (no None, no NaN)."""
        results = run_claim_simulation(
            domestic_claim, domestic_template, self.N, self.SEED,
        )
        for i, r in enumerate(results):
            assert r.outcome in ("TRUE_WIN", "LOSE"), (
                f"Path {i}: unexpected outcome '{r.outcome}'"
            )
            assert not math.isnan(r.timeline_months), f"Path {i}: NaN timeline"
            assert not math.isnan(r.collected_cr), f"Path {i}: NaN collected"
            assert not math.isnan(r.legal_costs_cr), f"Path {i}: NaN legal costs"
            assert r.timeline_months >= 0, f"Path {i}: negative timeline"
            assert r.legal_costs_cr >= 0, f"Path {i}: negative legal costs"
            assert r.collected_cr >= 0, f"Path {i}: negative collected"
            if r.outcome == "TRUE_WIN":
                assert r.collected_cr > 0, f"Path {i}: TRUE_WIN with 0 collected"
                assert r.quantum_cr > 0, f"Path {i}: TRUE_WIN with 0 quantum"

    def test_outcome_distribution(self, domestic_claim, domestic_template):
        """Outcome counts should sum to N and include both WIN and LOSE."""
        results = run_claim_simulation(
            domestic_claim, domestic_template, self.N, self.SEED,
        )
        summary = compute_claim_summary(domestic_claim, results)
        dist = summary["outcome_distribution"]
        total = dist["TRUE_WIN"] + dist["RESTART"] + dist["LOSE"]
        assert total == self.N, f"Outcomes sum to {total}, expected {self.N}"
        assert dist["TRUE_WIN"] > 0, "Should have some TRUE_WIN paths"
        assert dist["LOSE"] > 0, "Should have some LOSE paths"


# ============================================================================
# TEST 2: Golden test — SIAC TP-CTP11-4
# ============================================================================

class TestGoldenSIAC:
    """Golden test for SIAC claim matching TATA TP-CTP11-4."""

    N = 10_000
    SEED = 42

    def test_win_rate(self, siac_claim, siac_template):
        """SIAC win rate ~57-68% (96m cap less impactful for SIAC)."""
        results = run_claim_simulation(
            siac_claim, siac_template, self.N, self.SEED,
        )
        summary = compute_claim_summary(siac_claim, results)
        win_rate = summary["win_rate"]
        assert 0.57 <= win_rate <= 0.68, (
            f"SIAC win rate {win_rate:.4f} outside expected range [0.57, 0.68]"
        )

    def test_all_paths_valid(self, siac_claim, siac_template):
        results = run_claim_simulation(
            siac_claim, siac_template, self.N, self.SEED,
        )
        for i, r in enumerate(results):
            assert r.outcome in ("TRUE_WIN", "LOSE")
            assert not math.isnan(r.timeline_months)
            assert not math.isnan(r.collected_cr)
            assert not math.isnan(r.legal_costs_cr)


# ============================================================================
# TEST 3: no_restart_mode — zero RESTART outcomes
# ============================================================================

class TestNoRestartMode:
    """Verify no_restart_mode remaps all RESTART → LOSE."""

    N = 5_000
    SEED = 42

    def test_zero_restart_outcomes(self, domestic_template):
        claim = get_default_claim_config(
            "indian_domestic",
            claim_id="NO_RESTART_TEST",
            soc_value_cr=1000.0,
        )
        # Enable no_restart_mode
        claim = claim.model_copy(update={"no_restart_mode": True})

        results = run_claim_simulation(claim, domestic_template, self.N, self.SEED)
        summary = compute_claim_summary(claim, results)

        # No RESTART in final outcomes
        assert summary["outcome_distribution"]["RESTART"] == 0, (
            "no_restart_mode should produce zero RESTART outcomes"
        )

    def test_lower_win_rate_than_default(self, domestic_template):
        """no_restart_mode should give lower or equal win rate."""
        claim_normal = get_default_claim_config(
            "indian_domestic", claim_id="NORMAL", soc_value_cr=1000.0,
        )
        claim_no_restart = claim_normal.model_copy(
            update={"id": "NO_RESTART", "no_restart_mode": True},
        )

        results_normal = run_claim_simulation(
            claim_normal, domestic_template, self.N, self.SEED,
        )
        results_no_restart = run_claim_simulation(
            claim_no_restart, domestic_template, self.N, self.SEED,
        )

        wr_normal = compute_claim_summary(claim_normal, results_normal)["win_rate"]
        wr_no_restart = compute_claim_summary(
            claim_no_restart, results_no_restart,
        )["win_rate"]

        assert wr_no_restart <= wr_normal + 0.02, (
            f"no_restart win rate {wr_no_restart:.4f} should be <= "
            f"normal {wr_normal:.4f} (within MC noise)"
        )


# ============================================================================
# TEST 4: P(win)=0.0 — all paths LOSE
# ============================================================================

class TestZeroWinProbability:
    """With P(win)=0.0, all paths should be LOSE with 0 collected."""

    N = 1_000
    SEED = 42

    def test_all_lose(self, domestic_template):
        claim = get_default_claim_config(
            "indian_domestic", claim_id="ZERO_WIN", soc_value_cr=1000.0,
        )
        claim = claim.model_copy(
            update={
                "arbitration": ArbitrationConfig(
                    win_probability=0.0, re_arb_win_probability=0.0,
                ),
            },
        )
        results = run_claim_simulation(claim, domestic_template, self.N, self.SEED)

        for i, r in enumerate(results):
            assert r.outcome == "LOSE", (
                f"Path {i}: expected LOSE, got {r.outcome}"
            )
            assert r.collected_cr == 0.0, (
                f"Path {i}: expected 0 collected, got {r.collected_cr}"
            )

    def test_zero_win_rate(self, domestic_template):
        claim = get_default_claim_config(
            "indian_domestic", claim_id="ZERO_WIN", soc_value_cr=1000.0,
        )
        claim = claim.model_copy(
            update={
                "arbitration": ArbitrationConfig(
                    win_probability=0.0, re_arb_win_probability=0.0,
                ),
            },
        )
        results = run_claim_simulation(claim, domestic_template, self.N, self.SEED)
        summary = compute_claim_summary(claim, results)
        assert summary["win_rate"] == 0.0
        assert summary["effective_win_rate"] == 0.0
        assert summary["mean_collected_cr"] == 0.0


# ============================================================================
# TEST 5: P(win)=1.0 — high win rate (96-month cap may trigger on some)
# ============================================================================

class TestPerfectWinProbability:
    """With P(win)=1.0, most paths should be TRUE_WIN.

    Some may still LOSE if the challenge tree Scenario A produces LOSE
    outcomes (P(LOSE|ScA) = 0.264 for domestic).
    """

    N = 5_000
    SEED = 42

    def test_high_win_rate(self, domestic_template):
        claim = get_default_claim_config(
            "indian_domestic", claim_id="PERFECT_WIN", soc_value_cr=1000.0,
        )
        claim = claim.model_copy(
            update={
                "arbitration": ArbitrationConfig(
                    win_probability=1.0, re_arb_win_probability=1.0,
                ),
            },
        )
        results = run_claim_simulation(claim, domestic_template, self.N, self.SEED)
        summary = compute_claim_summary(claim, results)

        # With P(win)=1.0, all paths go through Scenario A.
        # P(TRUE_WIN|ScA) = 0.736 for domestic.
        assert summary["win_rate"] >= 0.70, (
            f"P(win)=1.0 win rate {summary['win_rate']:.4f} should be >= 0.70"
        )

    def test_no_lose_from_arb(self, domestic_template):
        """All TRUE_WIN paths should have positive quantum."""
        claim = get_default_claim_config(
            "indian_domestic", claim_id="PERFECT_WIN", soc_value_cr=1000.0,
        )
        claim = claim.model_copy(
            update={
                "arbitration": ArbitrationConfig(
                    win_probability=1.0, re_arb_win_probability=1.0,
                ),
            },
        )
        results = run_claim_simulation(claim, domestic_template, self.N, self.SEED)

        for i, r in enumerate(results):
            if r.outcome == "TRUE_WIN":
                assert r.quantum_cr > 0, (
                    f"Path {i}: TRUE_WIN should have positive quantum"
                )


# ============================================================================
# TEST 6: Reproducibility — same seed gives identical results
# ============================================================================

class TestReproducibility:
    """Same seed must produce identical results across runs."""

    N = 1_000
    SEED = 42

    def test_deterministic_domestic(self, domestic_claim, domestic_template):
        results_a = run_claim_simulation(
            domestic_claim, domestic_template, self.N, self.SEED,
        )
        results_b = run_claim_simulation(
            domestic_claim, domestic_template, self.N, self.SEED,
        )

        assert len(results_a) == len(results_b)
        for i, (a, b) in enumerate(zip(results_a, results_b)):
            assert a.outcome == b.outcome, f"Path {i}: outcome mismatch"
            assert a.quantum_cr == b.quantum_cr, f"Path {i}: quantum mismatch"
            assert a.timeline_months == b.timeline_months, (
                f"Path {i}: timeline mismatch"
            )
            assert a.collected_cr == b.collected_cr, (
                f"Path {i}: collected mismatch"
            )
            assert a.legal_costs_cr == b.legal_costs_cr, (
                f"Path {i}: legal costs mismatch"
            )

    def test_deterministic_siac(self, siac_claim, siac_template):
        results_a = run_claim_simulation(
            siac_claim, siac_template, self.N, self.SEED,
        )
        results_b = run_claim_simulation(
            siac_claim, siac_template, self.N, self.SEED,
        )

        for i, (a, b) in enumerate(zip(results_a, results_b)):
            assert a.outcome == b.outcome
            assert a.collected_cr == b.collected_cr
            assert a.timeline_months == b.timeline_months


# ============================================================================
# TEST 7: compute_claim_summary validation
# ============================================================================

class TestClaimSummary:
    """Validate summary statistics are well-formed."""

    N = 5_000
    SEED = 42

    def test_summary_keys(self, domestic_claim, domestic_template):
        results = run_claim_simulation(
            domestic_claim, domestic_template, self.N, self.SEED,
        )
        summary = compute_claim_summary(domestic_claim, results)

        expected_keys = {
            "n_paths", "win_rate", "effective_win_rate",
            "mean_quantum_cr", "median_quantum_cr",
            "mean_duration_months", "median_duration_months",
            "mean_legal_costs_cr", "mean_collected_cr",
            "outcome_distribution", "quantum_percentiles",
            "duration_percentiles", "legal_cost_percentiles",
        }
        assert expected_keys.issubset(summary.keys())

    def test_percentiles_ordered(self, domestic_claim, domestic_template):
        results = run_claim_simulation(
            domestic_claim, domestic_template, self.N, self.SEED,
        )
        summary = compute_claim_summary(domestic_claim, results)

        for key in ("quantum_percentiles", "duration_percentiles",
                     "legal_cost_percentiles"):
            pcts = summary[key]
            if pcts:
                assert pcts["p5"] <= pcts["p25"] <= pcts["p50"]
                assert pcts["p50"] <= pcts["p75"] <= pcts["p95"]

    def test_summary_n_paths(self, domestic_claim, domestic_template):
        results = run_claim_simulation(
            domestic_claim, domestic_template, self.N, self.SEED,
        )
        summary = compute_claim_summary(domestic_claim, results)
        assert summary["n_paths"] == self.N

    def test_empty_results(self, domestic_claim):
        summary = compute_claim_summary(domestic_claim, [])
        assert summary == {}


# ============================================================================
# TEST 8: Portfolio simulation
# ============================================================================

class TestPortfolioSimulation:
    """Verify portfolio simulation runs correctly for multiple claims."""

    N = 500
    SEED = 42

    def test_portfolio_returns_all_claims(self):
        claims = [
            get_default_claim_config(
                "indian_domestic", claim_id="DOM-1", soc_value_cr=1000.0,
            ),
            get_default_claim_config(
                "siac_singapore", claim_id="SIAC-1", soc_value_cr=500.0,
            ),
        ]
        templates = {
            "indian_domestic": REGISTRY.get_template("indian_domestic"),
            "siac_singapore": REGISTRY.get_template("siac_singapore"),
        }
        results = run_portfolio_simulation(
            claims, templates, self.N, self.SEED,
        )

        assert set(results.keys()) == {"DOM-1", "SIAC-1"}
        assert len(results["DOM-1"]) == self.N
        assert len(results["SIAC-1"]) == self.N

    def test_portfolio_path_alignment(self):
        """All claims use the same seed progression per path."""
        claims = [
            get_default_claim_config(
                "indian_domestic", claim_id="C1", soc_value_cr=1000.0,
            ),
            get_default_claim_config(
                "indian_domestic", claim_id="C2", soc_value_cr=2000.0,
            ),
        ]
        templates = {
            "indian_domestic": REGISTRY.get_template("indian_domestic"),
        }
        results = run_portfolio_simulation(
            claims, templates, self.N, self.SEED,
        )

        # Both claims should have same outcome pattern (same seed per path,
        # same probabilities — only SOC differs affecting quantum amounts)
        outcomes_c1 = [r.outcome for r in results["C1"]]
        outcomes_c2 = [r.outcome for r in results["C2"]]
        # With identical seeds and same probabilities, outcomes should match
        assert outcomes_c1 == outcomes_c2, (
            "Same-probability claims with same seeds should have aligned outcomes"
        )


# ============================================================================
# TEST 9: Single path smoke test
# ============================================================================

class TestSinglePath:
    """Basic smoke test for single-path simulation."""

    def test_single_path_returns_path_result(
        self, domestic_claim, domestic_template,
    ):
        rng = np.random.default_rng(42)
        result = simulate_one_path(
            domestic_claim, domestic_template, 0, 42, rng,
        )
        assert isinstance(result, PathResult)
        assert result.outcome in ("TRUE_WIN", "LOSE")
        assert result.timeline_months > 0
        assert result.legal_costs_cr >= 0

    def test_quantum_consistent_with_outcome(
        self, domestic_claim, domestic_template,
    ):
        """TRUE_WIN paths should have positive quantum; LOSE should have 0 collected."""
        rng = np.random.default_rng(100)
        result = simulate_one_path(
            domestic_claim, domestic_template, 0, 100, rng,
        )
        if result.outcome == "TRUE_WIN":
            assert result.collected_cr > 0
            assert result.quantum_cr > 0
        else:
            assert result.collected_cr == 0.0
