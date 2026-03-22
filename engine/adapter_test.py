"""
engine/adapter_test.py — Unit tests for the adapter layer.
============================================================

Run with:
    python -m pytest engine/adapter_test.py -v
"""

from __future__ import annotations

import copy

import pytest

from engine.adapter import (
    _JURISDICTION_MAP,
    derive_pipeline,
    map_legal_costs,
    merge_portfolio_results,
    patch_master_inputs_for_claim,
    platform_claim_to_v2_claim,
    save_and_restore_mi,
    tree_to_v2_flat_paths,
)
from engine.config.loader import merge_with_defaults
from engine.config.schema import ClaimConfig as PlatformClaim
from engine.v2_core import v2_master_inputs as MI


# ===================================================================
# Fixtures
# ===================================================================

def _make_claim(overrides: dict | None = None) -> PlatformClaim:
    """Build a minimal domestic claim by merging with defaults."""
    base = {
        "id": "TEST-001",
        "name": "Test Claim",
        "soc_value_cr": 100.0,
        "claimant_share_pct": 1.0,
        "current_stage": "dab_commenced",
        "jurisdiction": "indian_domestic",
        "claim_type": "prolongation",
        "perspective": "claimant",
        "arbitration": {
            "win_probability": 0.65,
            "re_arb_win_probability": 0.60,
        },
        "quantum": {
            "bands": [
                {"low": 0.0, "high": 0.5, "probability": 0.30},
                {"low": 0.5, "high": 1.0, "probability": 0.70},
            ]
        },
    }
    if overrides:
        base.update(overrides)
    return merge_with_defaults(base, jurisdiction=base.get("jurisdiction", "indian_domestic"))


# ===================================================================
# Tests
# ===================================================================

class TestPatchAndRestore:
    """Test that save_and_restore_mi properly saves and restores MI state."""

    def test_restore_scalar(self):
        """Scalar MI attributes are restored after patching."""
        original = MI.ARB_WIN_PROBABILITY
        with save_and_restore_mi():
            MI.ARB_WIN_PROBABILITY = 0.99
            assert MI.ARB_WIN_PROBABILITY == 0.99
        assert MI.ARB_WIN_PROBABILITY == original

    def test_restore_dict(self):
        """Dict MI attributes are fully restored (deep copy)."""
        original_costs = copy.deepcopy(MI.LEGAL_COSTS)
        with save_and_restore_mi():
            MI.LEGAL_COSTS["duration_based"]["arb_counsel"] = 999.0
            assert MI.LEGAL_COSTS["duration_based"]["arb_counsel"] == 999.0
        assert MI.LEGAL_COSTS == original_costs

    def test_restore_list(self):
        """List MI attributes are fully restored (deep copy)."""
        original_bands = copy.deepcopy(MI.QUANTUM_BANDS)
        with save_and_restore_mi():
            MI.QUANTUM_BANDS = [{"low": 0, "high": 1, "probability": 1.0}]
        assert MI.QUANTUM_BANDS == original_bands

    def test_patch_claim_restores(self):
        """Full patch_master_inputs_for_claim is properly restored."""
        claim = _make_claim()
        original_arb = MI.ARB_WIN_PROBABILITY
        original_bands = copy.deepcopy(MI.QUANTUM_BANDS)

        with save_and_restore_mi():
            patch_master_inputs_for_claim(claim, template=None)
            # arb probability should be patched to claim's value
            assert MI.ARB_WIN_PROBABILITY == claim.arbitration.win_probability

        assert MI.ARB_WIN_PROBABILITY == original_arb
        assert MI.QUANTUM_BANDS == original_bands


class TestTreeConversion:
    """Test tree_to_v2_flat_paths flattens challenge trees correctly."""

    def test_domestic_tree_produces_paths(self):
        """Domestic claim generates DOMESTIC_PATHS_A and DOMESTIC_PATHS_B."""
        claim = _make_claim()
        with save_and_restore_mi():
            patch_master_inputs_for_claim(claim, template=None)

            # Before conversion
            tree_to_v2_flat_paths(claim)

            paths_a = MI.DOMESTIC_PATHS_A
            paths_b = MI.DOMESTIC_PATHS_B

            # Should have at least one path
            assert len(paths_a) > 0, "DOMESTIC_PATHS_A should have paths"
            assert len(paths_b) > 0, "DOMESTIC_PATHS_B should have paths"

            # Each path should be a dict with required keys
            for path in paths_a:
                assert "conditional_prob" in path
                assert "s34_tata_wins" in path
                assert "outcome" in path

            # Probabilities should sum to ~1.0
            total_a = sum(p["conditional_prob"] for p in paths_a)
            total_b = sum(p["conditional_prob"] for p in paths_b)
            assert abs(total_a - 1.0) < 0.05, f"Scenario A probs sum to {total_a}"
            assert abs(total_b - 1.0) < 0.05, f"Scenario B probs sum to {total_b}"

    def test_siac_tree(self):
        """SIAC claim generates SIAC_PATHS_A and SIAC_PATHS_B."""
        claim = _make_claim({"jurisdiction": "siac_singapore", "id": "SIAC-001"})
        with save_and_restore_mi():
            patch_master_inputs_for_claim(claim, template=None)

            if claim.challenge_tree and (
                claim.challenge_tree.scenario_a or claim.challenge_tree.scenario_b
            ):
                tree_to_v2_flat_paths(claim)
                paths_a = MI.SIAC_PATHS_A
                assert len(paths_a) > 0, "SIAC_PATHS_A should have paths"


class TestPlatformClaimConversion:
    """Test platform claim → V2 claim conversion."""

    def test_jurisdiction_mapping(self):
        """Jurisdiction is correctly mapped."""
        claim = _make_claim()
        v2 = platform_claim_to_v2_claim(claim)
        assert v2.jurisdiction == "domestic"

    def test_siac_jurisdiction(self):
        claim = _make_claim({"jurisdiction": "siac_singapore", "id": "SIAC-002"})
        v2 = platform_claim_to_v2_claim(claim)
        assert v2.jurisdiction == "siac"

    def test_claim_id_preserved(self):
        claim = _make_claim({"id": "MY-CLAIM-42"})
        v2 = platform_claim_to_v2_claim(claim)
        assert v2.claim_id == "MY-CLAIM-42"

    def test_soc_value_preserved(self):
        claim = _make_claim({"soc_value_cr": 250.0})
        v2 = platform_claim_to_v2_claim(claim)
        assert v2.soc_value_cr == 250.0


class TestDerivePipeline:
    """Test pipeline derivation from current stage."""

    def test_dab_commenced(self):
        claim = _make_claim({"current_stage": "dab_commenced"})
        pipeline = derive_pipeline(claim)
        assert "dab" in pipeline
        assert "arbitration" in pipeline

    def test_arb_hearings(self):
        claim = _make_claim({"current_stage": "arb_hearings_ongoing"})
        pipeline = derive_pipeline(claim)
        assert "dab" not in pipeline


class TestMergePortfolioResults:
    """Test merging per-claim results into SimulationResults."""

    def test_empty_merge(self):
        """Empty per-claim results produce empty sim."""
        sim = merge_portfolio_results({}, [], n_paths=100, seed=42)
        assert sim.n_paths == 100
        assert sim.seed == 42
        assert len(sim.claim_ids) == 0
