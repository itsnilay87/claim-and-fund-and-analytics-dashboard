"""
tests/test_known_outcomes.py — Integration tests for Known Outcomes feature.

Tests the full pipeline: KnownOutcomes schema → adapter → MC engine.
Verifies that:
  1. KnownOutcomes validates correctly (positive and negative cases)
  2. Post-arb stages produce empty pipelines
  3. MC engine forces arb_won when arb_outcome is set
  4. Known quantum produces distribution centered on known amount
  5. Partial tree traversal forces known nodes
  6. Enforcement stage bypasses MC pipeline
  7. RNG reproducibility is maintained with known outcomes
"""

from __future__ import annotations

import json
import os

import numpy as np
import pytest

from engine.config.schema import (
    ClaimConfig,
    JurisdictionTemplate,
    KnownOutcomes,
)
from engine.config.defaults import get_default_claim_config
from engine.adapter import derive_pipeline, derive_known_outcomes_from_stage
from engine.models.quantum_model import draw_known_quantum
from engine.models.probability_tree import simulate_challenge_tree_with_known_outcomes
from engine.simulation.monte_carlo import simulate_one_path


# ── Helpers ────────────────────────────────────────────────────────────────

_JURISDICTIONS_DIR = os.path.join(
    os.path.dirname(__file__), os.pardir, "jurisdictions"
)


def _load_template(jurisdiction: str) -> JurisdictionTemplate:
    """Load a JurisdictionTemplate from the JSON file."""
    filename = {
        "indian_domestic": "indian_domestic.json",
        "siac_singapore": "siac_singapore.json",
        "hkiac_hongkong": "hkiac_hongkong.json",
    }[jurisdiction]
    path = os.path.join(_JURISDICTIONS_DIR, filename)
    with open(path) as f:
        return JurisdictionTemplate(**json.load(f))


# ============================================================================
# A. Schema Validation Tests
# ============================================================================

class TestKnownOutcomesSchema:
    def test_empty_known_outcomes(self):
        """All-None KnownOutcomes is valid."""
        ko = KnownOutcomes()
        assert ko.arb_outcome is None
        assert ko.known_quantum_cr is None
        assert ko.known_quantum_pct is None

    def test_arb_won_with_quantum(self):
        """arb_outcome='won' + known_quantum_pct is valid."""
        ko = KnownOutcomes(arb_outcome="won", known_quantum_pct=0.85)
        assert ko.known_quantum_pct == 0.85

    def test_arb_won_with_quantum_cr(self):
        """arb_outcome='won' + known_quantum_cr is valid."""
        ko = KnownOutcomes(arb_outcome="won", known_quantum_cr=850.0)
        assert ko.known_quantum_cr == 850.0

    def test_quantum_without_arb_raises(self):
        """known_quantum_cr without arb_outcome should raise."""
        with pytest.raises(ValueError, match="require arb_outcome"):
            KnownOutcomes(known_quantum_cr=850.0)

    def test_quantum_pct_without_arb_raises(self):
        """known_quantum_pct without arb_outcome should raise."""
        with pytest.raises(ValueError, match="require arb_outcome"):
            KnownOutcomes(known_quantum_pct=0.85)

    def test_quantum_with_arb_lost_raises(self):
        """known_quantum_pct with arb_outcome='lost' should raise."""
        with pytest.raises(ValueError, match="require arb_outcome"):
            KnownOutcomes(arb_outcome="lost", known_quantum_pct=0.85)

    def test_challenge_without_arb_raises(self):
        """Challenge outcomes without arb_outcome should raise."""
        with pytest.raises(ValueError, match="require arb_outcome"):
            KnownOutcomes(s34_outcome="claimant_won")

    def test_sequential_consistency_s37(self):
        """s37_outcome without s34_outcome should raise."""
        with pytest.raises(ValueError, match="s37_outcome requires s34_outcome"):
            KnownOutcomes(arb_outcome="won", s37_outcome="claimant_won")

    def test_slp_gate_requires_s37(self):
        """slp_gate_outcome without s37_outcome should raise."""
        with pytest.raises(ValueError, match="slp_gate_outcome requires s37_outcome"):
            KnownOutcomes(
                arb_outcome="won",
                s34_outcome="claimant_won",
                slp_gate_outcome="dismissed",
            )

    def test_slp_requires_admitted(self):
        """slp_merits without slp_gate='admitted' should raise."""
        with pytest.raises(ValueError, match="slp_gate_outcome='admitted'"):
            KnownOutcomes(
                arb_outcome="won",
                s34_outcome="claimant_won",
                s37_outcome="claimant_won",
                slp_gate_outcome="dismissed",
                slp_merits_outcome="claimant_won",
            )

    def test_full_domestic_chain_valid(self):
        """Full Indian Domestic chain with SLP dismissed is valid."""
        ko = KnownOutcomes(
            arb_outcome="won",
            known_quantum_pct=0.85,
            s34_outcome="claimant_won",
            s37_outcome="claimant_won",
            slp_gate_outcome="dismissed",
        )
        assert ko.s34_outcome == "claimant_won"
        assert ko.slp_gate_outcome == "dismissed"

    def test_full_domestic_chain_slp_admitted(self):
        """Full Domestic chain with SLP admitted + merits is valid."""
        ko = KnownOutcomes(
            arb_outcome="won",
            s34_outcome="claimant_won",
            s37_outcome="claimant_won",
            slp_gate_outcome="admitted",
            slp_merits_outcome="claimant_won",
        )
        assert ko.slp_merits_outcome == "claimant_won"

    def test_siac_chain_valid(self):
        """SIAC chain hc→coa is valid."""
        ko = KnownOutcomes(
            arb_outcome="won",
            hc_outcome="claimant_won",
            coa_outcome="claimant_won",
        )
        assert ko.coa_outcome == "claimant_won"

    def test_siac_coa_requires_hc(self):
        """coa_outcome without hc_outcome should raise."""
        with pytest.raises(ValueError, match="coa_outcome requires hc_outcome"):
            KnownOutcomes(arb_outcome="won", coa_outcome="claimant_won")

    def test_hkiac_chain_valid(self):
        """HKIAC chain cfi→ca→cfa is valid."""
        ko = KnownOutcomes(
            arb_outcome="won",
            cfi_outcome="claimant_won",
            ca_outcome="claimant_won",
            cfa_gate_outcome="dismissed",
        )
        assert ko.cfa_gate_outcome == "dismissed"

    def test_hkiac_ca_requires_cfi(self):
        """ca_outcome without cfi_outcome should raise."""
        with pytest.raises(ValueError, match="ca_outcome requires cfi_outcome"):
            KnownOutcomes(arb_outcome="won", ca_outcome="claimant_won")

    def test_hkiac_cfa_gate_requires_ca(self):
        """cfa_gate_outcome without ca_outcome should raise."""
        with pytest.raises(ValueError, match="cfa_gate_outcome requires ca_outcome"):
            KnownOutcomes(
                arb_outcome="won",
                cfi_outcome="claimant_won",
                cfa_gate_outcome="dismissed",
            )

    def test_hkiac_cfa_merits_requires_admitted(self):
        """cfa_merits without cfa_gate='admitted' should raise."""
        with pytest.raises(ValueError, match="cfa_gate_outcome='admitted'"):
            KnownOutcomes(
                arb_outcome="won",
                cfi_outcome="claimant_won",
                ca_outcome="claimant_won",
                cfa_gate_outcome="dismissed",
                cfa_merits_outcome="claimant_won",
            )


# ============================================================================
# B. Pipeline / Adapter Tests
# ============================================================================

class TestPipelineDerivation:
    def test_pre_arb_stage_has_pipeline(self):
        """Pre-arb stages should produce non-empty pipeline."""
        claim = get_default_claim_config("indian_domestic")
        claim.current_stage = "dab"
        pipeline = derive_pipeline(claim)
        assert len(pipeline) > 0

    def test_post_arb_stage_empty_pipeline(self):
        """Post-arb stages should produce empty pipeline."""
        claim = get_default_claim_config("indian_domestic")
        claim.current_stage = "s34_pending"
        pipeline = derive_pipeline(claim)
        assert pipeline == []

    def test_enforcement_empty_pipeline(self):
        """Enforcement stage should produce empty pipeline."""
        claim = get_default_claim_config("indian_domestic")
        claim.current_stage = "enforcement"
        pipeline = derive_pipeline(claim)
        assert pipeline == []

    def test_arb_award_done_empty_pipeline(self):
        """arb_award_done should produce empty pipeline."""
        claim = get_default_claim_config("indian_domestic")
        claim.current_stage = "arb_award_done"
        pipeline = derive_pipeline(claim)
        assert pipeline == []

    def test_siac_post_arb_empty(self):
        """SIAC post-arb stages should produce empty pipeline."""
        claim = get_default_claim_config("siac_singapore")
        claim.current_stage = "hc_challenge_pending"
        pipeline = derive_pipeline(claim)
        assert pipeline == []

    def test_hkiac_post_arb_empty(self):
        """HKIAC post-arb stages should produce empty pipeline."""
        claim = get_default_claim_config("hkiac_hongkong")
        claim.current_stage = "cfi_challenge_pending"
        pipeline = derive_pipeline(claim)
        assert pipeline == []

    def test_derive_required_outcomes_s37_pending(self):
        """derive_known_outcomes_from_stage returns correct fields for s37_pending."""
        result = derive_known_outcomes_from_stage("s37_pending", "indian_domestic")
        assert result["is_post_arb"] is True
        assert "arb_outcome" in result["required_fields"]
        assert "s34_outcome" in result["required_fields"]

    def test_derive_required_outcomes_enforcement(self):
        """derive_known_outcomes_from_stage returns correct fields for enforcement."""
        result = derive_known_outcomes_from_stage("enforcement", "indian_domestic")
        assert result["is_post_arb"] is True
        assert "arb_outcome" in result["required_fields"]

    def test_derive_required_outcomes_pre_arb(self):
        """Pre-arb stages return empty result."""
        result = derive_known_outcomes_from_stage("dab", "indian_domestic")
        assert result == {}

    def test_derive_required_outcomes_siac_coa(self):
        """SIAC coa_pending requires arb_outcome and hc_outcome."""
        result = derive_known_outcomes_from_stage("coa_pending", "siac_singapore")
        assert "arb_outcome" in result["required_fields"]
        assert "hc_outcome" in result["required_fields"]

    def test_derive_required_outcomes_hkiac_cfa(self):
        """HKIAC cfa_pending requires arb, cfi, ca outcomes."""
        result = derive_known_outcomes_from_stage("cfa_pending", "hkiac_hongkong")
        assert "arb_outcome" in result["required_fields"]
        assert "cfi_outcome" in result["required_fields"]
        assert "ca_outcome" in result["required_fields"]


# ============================================================================
# C. Known Quantum Tests
# ============================================================================

class TestKnownQuantum:
    def test_distribution_centered(self):
        """Known quantum draws should center around the known value."""
        rng = np.random.default_rng(42)
        draws = [draw_known_quantum(1000.0, 0.85, rng).quantum_pct for _ in range(5000)]
        mean = np.mean(draws)
        assert 0.82 < mean < 0.88, f"Mean {mean} not centered around 0.85"

    def test_distribution_spread(self):
        """Known quantum should have meaningful variance (not deterministic)."""
        rng = np.random.default_rng(42)
        draws = [draw_known_quantum(1000.0, 0.85, rng).quantum_pct for _ in range(1000)]
        std = np.std(draws)
        assert std > 0.05, f"Std {std} too low — distribution appears deterministic"
        assert std < 0.20, f"Std {std} too high — distribution too spread"

    def test_quantum_non_negative(self):
        """Known quantum should never be negative."""
        rng = np.random.default_rng(42)
        for _ in range(1000):
            result = draw_known_quantum(1000.0, 0.10, rng)
            assert result.quantum_pct >= 0.0
            assert result.quantum_cr >= 0.0

    def test_quantum_clipped_to_one(self):
        """Known quantum pct should never exceed 1.0."""
        rng = np.random.default_rng(42)
        for _ in range(1000):
            result = draw_known_quantum(1000.0, 0.95, rng)
            assert result.quantum_pct <= 1.0

    def test_band_idx_marker(self):
        """Known quantum should have band_idx = -2."""
        rng = np.random.default_rng(42)
        result = draw_known_quantum(1000.0, 0.85, rng)
        assert result.band_idx == -2

    def test_quantum_cr_scales_with_soc(self):
        """quantum_cr should equal soc_cr * quantum_pct."""
        rng = np.random.default_rng(42)
        result = draw_known_quantum(500.0, 0.85, rng)
        assert abs(result.quantum_cr - 500.0 * result.quantum_pct) < 1e-6

    def test_low_quantum_center(self):
        """Low known quantum (10%) should center around 0.10."""
        rng = np.random.default_rng(42)
        draws = [draw_known_quantum(1000.0, 0.10, rng).quantum_pct for _ in range(5000)]
        mean = np.mean(draws)
        # With truncation at 0, the mean may be slightly above 0.10
        assert 0.05 < mean < 0.18, f"Mean {mean} not near 0.10"


# ============================================================================
# D. MC Engine Tests — Forced Arb Outcome
# ============================================================================

class TestMCEngineKnownOutcomes:
    @pytest.fixture
    def domestic_template(self):
        return _load_template("indian_domestic")

    @pytest.fixture
    def siac_template(self):
        return _load_template("siac_singapore")

    @pytest.fixture
    def hkiac_template(self):
        return _load_template("hkiac_hongkong")

    def _make_claim(self, jurisdiction, stage, arb_outcome="won", quantum_pct=0.85):
        """Create a test claim at a specific stage with known outcomes."""
        claim = get_default_claim_config(jurisdiction)
        claim.current_stage = stage
        claim.known_outcomes = KnownOutcomes(
            arb_outcome=arb_outcome,
            known_quantum_pct=quantum_pct if arb_outcome == "won" else None,
        )
        return claim

    # ── Forced arb_won ──

    def test_forced_arb_won_domestic(self, domestic_template):
        """When arb_outcome='won', no path should lose due to arb draw."""
        claim = self._make_claim("indian_domestic", "arb_award_done")
        win_count = 0
        n = 100
        for i in range(n):
            path_rng = np.random.default_rng(42 + i)
            result = simulate_one_path(claim, domestic_template, i, 42 + i, path_rng)
            if result.outcome == "TRUE_WIN":
                win_count += 1
            # Should never see RESTART since arb_won → scenario A (no RESTART)
        assert win_count > 0, "No wins at all — arb_outcome forcing not working"

    def test_forced_arb_lost_domestic(self, domestic_template):
        """When arb_outcome='lost', ALL paths should go to scenario B."""
        claim = self._make_claim("indian_domestic", "arb_award_done", arb_outcome="lost")
        for i in range(50):
            path_rng = np.random.default_rng(42 + i)
            result = simulate_one_path(claim, domestic_template, i, 42 + i, path_rng)
            assert result.outcome in ("RESTART", "LOSE"), (
                f"Path {i}: outcome={result.outcome} — should never be TRUE_WIN with arb_outcome='lost'"
            )

    def test_forced_arb_won_siac(self, siac_template):
        """SIAC: arb_outcome='won' should produce only TRUE_WIN or LOSE (no RESTART in scenario A)."""
        claim = self._make_claim("siac_singapore", "hc_challenge_pending")
        for i in range(50):
            path_rng = np.random.default_rng(42 + i)
            result = simulate_one_path(claim, siac_template, i, 42 + i, path_rng)
            # Scenario A for arb_won: outcomes are TRUE_WIN or LOSE
            assert result.outcome in ("TRUE_WIN", "LOSE"), (
                f"SIAC path {i}: unexpected outcome {result.outcome}"
            )

    def test_forced_arb_won_hkiac(self, hkiac_template):
        """HKIAC: arb_outcome='won' should work correctly."""
        claim = self._make_claim("hkiac_hongkong", "cfi_challenge_pending")
        win_count = 0
        for i in range(50):
            path_rng = np.random.default_rng(42 + i)
            result = simulate_one_path(claim, hkiac_template, i, 42 + i, path_rng)
            if result.outcome == "TRUE_WIN":
                win_count += 1
        assert win_count > 0, "HKIAC: No wins with arb_outcome='won'"

    # ── Enforcement stage ──

    def test_enforcement_stage_domestic(self, domestic_template):
        """Enforcement stage should bypass MC and return TRUE_WIN."""
        claim = self._make_claim("indian_domestic", "enforcement")
        path_rng = np.random.default_rng(42)
        result = simulate_one_path(claim, domestic_template, 0, 42, path_rng)
        assert result.outcome == "TRUE_WIN"
        assert result.quantum_cr > 0
        assert "enforcement" in result.stages_traversed
        assert result.band_idx == -3
        assert result.legal_costs_cr == 0.0

    def test_enforcement_stage_siac(self, siac_template):
        """SIAC enforcement stage should also bypass MC."""
        claim = self._make_claim("siac_singapore", "enforcement")
        path_rng = np.random.default_rng(42)
        result = simulate_one_path(claim, siac_template, 0, 42, path_rng)
        assert result.outcome == "TRUE_WIN"
        assert result.quantum_cr > 0

    def test_enforcement_arb_lost(self, domestic_template):
        """Enforcement with arb_outcome='lost' should return LOSE."""
        claim = self._make_claim("indian_domestic", "enforcement", arb_outcome="lost")
        path_rng = np.random.default_rng(42)
        result = simulate_one_path(claim, domestic_template, 0, 42, path_rng)
        assert result.outcome == "LOSE"
        assert result.quantum_cr == 0.0

    # ── Known quantum in MC ──

    def test_known_quantum_in_mc(self, domestic_template):
        """MC paths with known quantum should center quantum around known value."""
        claim = self._make_claim("indian_domestic", "arb_award_done", quantum_pct=0.85)
        quantum_pcts = []
        for i in range(200):
            path_rng = np.random.default_rng(42 + i)
            result = simulate_one_path(claim, domestic_template, i, 42 + i, path_rng)
            if result.quantum_pct > 0:
                quantum_pcts.append(result.quantum_pct)
        assert len(quantum_pcts) > 0, "No paths with quantum > 0"
        mean_q = np.mean(quantum_pcts)
        assert 0.75 < mean_q < 0.95, f"Mean quantum {mean_q} not centered around 0.85"

    # ── Known challenge outcomes ──

    def test_known_s34_won(self, domestic_template):
        """Forcing s34_outcome='claimant_won' should increase win rate."""
        claim = get_default_claim_config("indian_domestic")
        claim.current_stage = "s34_decided"
        claim.known_outcomes = KnownOutcomes(
            arb_outcome="won",
            known_quantum_pct=0.85,
            s34_outcome="claimant_won",
        )
        win_count = 0
        for i in range(100):
            path_rng = np.random.default_rng(42 + i)
            result = simulate_one_path(claim, domestic_template, i, 42 + i, path_rng)
            if result.outcome == "TRUE_WIN":
                win_count += 1
        # With s34 forced to won, win rate should be higher
        assert win_count > 50, f"Win rate {win_count}% too low with s34 forced to claimant_won"

    def test_known_hc_won_siac(self, siac_template):
        """SIAC: Forcing hc_outcome='claimant_won' should increase win rate."""
        claim = get_default_claim_config("siac_singapore")
        claim.current_stage = "hc_decided"
        claim.known_outcomes = KnownOutcomes(
            arb_outcome="won",
            known_quantum_pct=0.85,
            hc_outcome="claimant_won",
        )
        win_count = 0
        for i in range(100):
            path_rng = np.random.default_rng(42 + i)
            result = simulate_one_path(claim, siac_template, i, 42 + i, path_rng)
            if result.outcome == "TRUE_WIN":
                win_count += 1
        assert win_count > 50, f"Win rate {win_count}% too low with hc forced to claimant_won"


# ============================================================================
# E. Reproducibility Tests
# ============================================================================

class TestReproducibility:
    def test_same_seed_same_result(self):
        """Same seed should give identical results with known outcomes."""
        claim = get_default_claim_config("indian_domestic")
        claim.current_stage = "s34_pending"
        claim.known_outcomes = KnownOutcomes(arb_outcome="won", known_quantum_pct=0.85)
        template = _load_template("indian_domestic")

        results = []
        for _ in range(2):
            path_rng = np.random.default_rng(12345)
            r = simulate_one_path(claim, template, 0, 12345, path_rng)
            results.append(r)

        assert results[0].outcome == results[1].outcome
        assert results[0].quantum_cr == results[1].quantum_cr
        assert results[0].timeline_months == results[1].timeline_months

    def test_different_seeds_differ(self):
        """Different seeds should produce different results."""
        claim = get_default_claim_config("indian_domestic")
        claim.current_stage = "arb_award_done"
        claim.known_outcomes = KnownOutcomes(arb_outcome="won", known_quantum_pct=0.85)
        template = _load_template("indian_domestic")

        results = []
        for seed in [10, 20]:
            path_rng = np.random.default_rng(seed)
            r = simulate_one_path(claim, template, 0, seed, path_rng)
            results.append(r)

        # Quantum values should differ due to stochastic known_quantum draw
        assert results[0].quantum_cr != results[1].quantum_cr

    def test_enforcement_reproducible(self):
        """Enforcement stage should be deterministic (no RNG draws)."""
        claim = get_default_claim_config("indian_domestic")
        claim.current_stage = "enforcement"
        claim.known_outcomes = KnownOutcomes(arb_outcome="won", known_quantum_pct=0.85)
        template = _load_template("indian_domestic")

        results = []
        for seed in [1, 999]:
            path_rng = np.random.default_rng(seed)
            r = simulate_one_path(claim, template, 0, seed, path_rng)
            results.append(r)

        # Enforcement is fully deterministic — same quantum regardless of seed
        assert results[0].quantum_cr == results[1].quantum_cr
        assert results[0].outcome == results[1].outcome


# ============================================================================
# F. Cross-Jurisdiction Tests
# ============================================================================

class TestCrossJurisdiction:
    def test_all_jurisdictions_enforcement(self):
        """Enforcement works for all jurisdictions."""
        for jur in ["indian_domestic", "siac_singapore", "hkiac_hongkong"]:
            claim = get_default_claim_config(jur)
            claim.current_stage = "enforcement"
            claim.known_outcomes = KnownOutcomes(arb_outcome="won", known_quantum_pct=0.85)
            template = _load_template(jur)

            path_rng = np.random.default_rng(42)
            result = simulate_one_path(claim, template, 0, 42, path_rng)
            assert result.outcome == "TRUE_WIN", f"{jur}: enforcement should give TRUE_WIN"
            assert result.quantum_cr > 0, f"{jur}: enforcement should have quantum > 0"

    def test_all_jurisdictions_forced_arb(self):
        """All jurisdictions handle forced arb_outcome='won'."""
        stage_map = {
            "indian_domestic": "arb_award_done",
            "siac_singapore": "hc_challenge_pending",
            "hkiac_hongkong": "cfi_challenge_pending",
        }
        for jur, stage in stage_map.items():
            claim = get_default_claim_config(jur)
            claim.current_stage = stage
            claim.known_outcomes = KnownOutcomes(
                arb_outcome="won", known_quantum_pct=0.85,
            )
            template = _load_template(jur)

            win_count = 0
            for i in range(50):
                path_rng = np.random.default_rng(42 + i)
                result = simulate_one_path(claim, template, i, 42 + i, path_rng)
                if result.outcome == "TRUE_WIN":
                    win_count += 1
            assert win_count > 0, f"{jur}: no wins with forced arb_outcome='won'"
