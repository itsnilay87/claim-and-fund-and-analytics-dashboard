"""
engine/tests/test_probability_tree.py
======================================

Comprehensive tests for the generic probability tree walker.

Tests:
  1–4: Monte Carlo convergence (100K paths) for Indian Domestic & SIAC,
       both Scenario A and B, verifying outcomes match known analytical probs.
  5:   Analytical compute_tree_probabilities() exact-match verification.
  6:   validate_tree() catches children probs not summing to 1.0.
  7:   validate_tree() catches Scenario A tree with RESTART terminal.
  8:   SIAC fixed-duration determinism: every path totals exactly 12.0 months.
  9:   Deterministic reproducibility: same seed → identical results.
"""

from __future__ import annotations

import numpy as np
import pytest

from engine.config.schema import ScenarioTree, TreeNode
from engine.jurisdictions.registry import REGISTRY
from engine.models.probability_tree import (
    ChallengeResult,
    compute_tree_probabilities,
    simulate_challenge_tree,
    simulate_full_challenge,
    validate_tree,
)


# ============================================================================
# Helpers
# ============================================================================

def _load_template(jurisdiction_id: str):
    """Load a jurisdiction template from the registry."""
    tmpl = REGISTRY.get_template(jurisdiction_id)
    assert tmpl is not None, f"Template '{jurisdiction_id}' not found in registry."
    return tmpl


def _run_mc(tree: ScenarioTree, n: int, seed: int, label: str = "") -> dict[str, int]:
    """Run *n* MC traversals and return outcome counts."""
    counts: dict[str, int] = {}
    for i in range(n):
        rng = np.random.default_rng(seed + i)
        result = simulate_challenge_tree(tree, rng, scenario_label=label)
        counts[result.outcome] = counts.get(result.outcome, 0) + 1
    return counts


# ============================================================================
# Constants — known analytical probabilities
# ============================================================================

# Indian Domestic (exact analytical from tree multiplication)
IND_A_TW = 0.736025  # P(TRUE_WIN | Scenario A)
IND_A_LO = 0.263975  # P(LOSE | Scenario A)
IND_B_RS = 0.296575  # P(RESTART | Scenario B)
IND_B_LO = 0.703425  # P(LOSE | Scenario B)

# SIAC Singapore
SIAC_A_TW = 0.8200
SIAC_A_LO = 0.1800
SIAC_B_RS = 0.4200
SIAC_B_LO = 0.5800

N_SIMULATIONS = 100_000
TOL = 0.01  # MC tolerance (at 100K, SE ≈ 0.0015 for p≈0.5, so ±0.01 is ~6 SE)


# ============================================================================
# Test 1: Indian Domestic Scenario A — MC convergence
# ============================================================================

class TestIndianDomesticScenarioA:
    """Monte Carlo verification of Indian Domestic Scenario A probabilities."""

    @pytest.fixture(autouse=True)
    def setup(self):
        self.tmpl = _load_template("indian_domestic")
        self.tree = self.tmpl.default_challenge_tree.scenario_a

    def test_true_win_probability(self):
        counts = _run_mc(self.tree, N_SIMULATIONS, seed=42, label="A")
        p_tw = counts.get("TRUE_WIN", 0) / N_SIMULATIONS
        assert abs(p_tw - IND_A_TW) < TOL, (
            f"P(TRUE_WIN|A) = {p_tw:.4f}, expected {IND_A_TW:.4f} ± {TOL}"
        )

    def test_lose_probability(self):
        counts = _run_mc(self.tree, N_SIMULATIONS, seed=42, label="A")
        p_lo = counts.get("LOSE", 0) / N_SIMULATIONS
        assert abs(p_lo - IND_A_LO) < TOL, (
            f"P(LOSE|A) = {p_lo:.4f}, expected {IND_A_LO:.4f} ± {TOL}"
        )

    def test_no_restart_in_scenario_a(self):
        counts = _run_mc(self.tree, N_SIMULATIONS, seed=42, label="A")
        assert counts.get("RESTART", 0) == 0, (
            "Scenario A should never produce RESTART outcomes."
        )

    def test_all_results_are_challenge_result(self):
        rng = np.random.default_rng(99)
        result = simulate_challenge_tree(self.tree, rng, scenario_label="A")
        assert isinstance(result, ChallengeResult)
        assert result.scenario == "A"
        assert result.outcome in {"TRUE_WIN", "LOSE"}
        assert result.challenge_duration_months > 0.0
        assert len(result.stages_traversed) > 0


# ============================================================================
# Test 2: Indian Domestic Scenario B — MC convergence
# ============================================================================

class TestIndianDomesticScenarioB:
    """Monte Carlo verification of Indian Domestic Scenario B probabilities."""

    @pytest.fixture(autouse=True)
    def setup(self):
        self.tmpl = _load_template("indian_domestic")
        self.tree = self.tmpl.default_challenge_tree.scenario_b

    def test_restart_probability(self):
        counts = _run_mc(self.tree, N_SIMULATIONS, seed=123, label="B")
        p_rs = counts.get("RESTART", 0) / N_SIMULATIONS
        assert abs(p_rs - IND_B_RS) < TOL, (
            f"P(RESTART|B) = {p_rs:.4f}, expected {IND_B_RS:.4f} ± {TOL}"
        )

    def test_lose_probability(self):
        counts = _run_mc(self.tree, N_SIMULATIONS, seed=123, label="B")
        p_lo = counts.get("LOSE", 0) / N_SIMULATIONS
        assert abs(p_lo - IND_B_LO) < TOL, (
            f"P(LOSE|B) = {p_lo:.4f}, expected {IND_B_LO:.4f} ± {TOL}"
        )

    def test_no_true_win_in_scenario_b(self):
        counts = _run_mc(self.tree, N_SIMULATIONS, seed=123, label="B")
        assert counts.get("TRUE_WIN", 0) == 0, (
            "Scenario B should never produce TRUE_WIN outcomes."
        )


# ============================================================================
# Test 3: SIAC Scenario A — MC convergence
# ============================================================================

class TestSIACScenarioA:
    """Monte Carlo verification of SIAC Scenario A probabilities."""

    @pytest.fixture(autouse=True)
    def setup(self):
        self.tmpl = _load_template("siac_singapore")
        self.tree = self.tmpl.default_challenge_tree.scenario_a

    def test_true_win_probability(self):
        counts = _run_mc(self.tree, N_SIMULATIONS, seed=200, label="A")
        p_tw = counts.get("TRUE_WIN", 0) / N_SIMULATIONS
        assert abs(p_tw - SIAC_A_TW) < TOL, (
            f"P(TRUE_WIN|A) = {p_tw:.4f}, expected {SIAC_A_TW:.4f} ± {TOL}"
        )

    def test_lose_probability(self):
        counts = _run_mc(self.tree, N_SIMULATIONS, seed=200, label="A")
        p_lo = counts.get("LOSE", 0) / N_SIMULATIONS
        assert abs(p_lo - SIAC_A_LO) < TOL, (
            f"P(LOSE|A) = {p_lo:.4f}, expected {SIAC_A_LO:.4f} ± {TOL}"
        )


# ============================================================================
# Test 4: SIAC Scenario B — MC convergence
# ============================================================================

class TestSIACScenarioB:
    """Monte Carlo verification of SIAC Scenario B probabilities."""

    @pytest.fixture(autouse=True)
    def setup(self):
        self.tmpl = _load_template("siac_singapore")
        self.tree = self.tmpl.default_challenge_tree.scenario_b

    def test_restart_probability(self):
        counts = _run_mc(self.tree, N_SIMULATIONS, seed=300, label="B")
        p_rs = counts.get("RESTART", 0) / N_SIMULATIONS
        assert abs(p_rs - SIAC_B_RS) < TOL, (
            f"P(RESTART|B) = {p_rs:.4f}, expected {SIAC_B_RS:.4f} ± {TOL}"
        )

    def test_lose_probability(self):
        counts = _run_mc(self.tree, N_SIMULATIONS, seed=300, label="B")
        p_lo = counts.get("LOSE", 0) / N_SIMULATIONS
        assert abs(p_lo - SIAC_B_LO) < TOL, (
            f"P(LOSE|B) = {p_lo:.4f}, expected {SIAC_B_LO:.4f} ± {TOL}"
        )


# ============================================================================
# Test 5: Analytical — compute_tree_probabilities exact match
# ============================================================================

class TestComputeTreeProbabilities:
    """Verify analytical probability computation returns exact values."""

    def test_indian_domestic_scenario_a(self):
        tmpl = _load_template("indian_domestic")
        probs = compute_tree_probabilities(tmpl.default_challenge_tree.scenario_a)
        assert abs(probs.p_true_win - IND_A_TW) < 1e-6, (
            f"Analytical P(TRUE_WIN|A) = {probs.p_true_win:.6f}, expected {IND_A_TW}"
        )
        assert abs(probs.p_lose - IND_A_LO) < 1e-6
        assert abs(probs.p_restart) < 1e-6  # Should be 0

    def test_indian_domestic_scenario_b(self):
        tmpl = _load_template("indian_domestic")
        probs = compute_tree_probabilities(tmpl.default_challenge_tree.scenario_b)
        assert abs(probs.p_restart - IND_B_RS) < 1e-6, (
            f"Analytical P(RESTART|B) = {probs.p_restart:.6f}, expected {IND_B_RS}"
        )
        assert abs(probs.p_lose - IND_B_LO) < 1e-6
        assert abs(probs.p_true_win) < 1e-6  # Should be 0

    def test_siac_scenario_a(self):
        tmpl = _load_template("siac_singapore")
        probs = compute_tree_probabilities(tmpl.default_challenge_tree.scenario_a)
        assert abs(probs.p_true_win - SIAC_A_TW) < 1e-6
        assert abs(probs.p_lose - SIAC_A_LO) < 1e-6
        assert abs(probs.p_restart) < 1e-6

    def test_siac_scenario_b(self):
        tmpl = _load_template("siac_singapore")
        probs = compute_tree_probabilities(tmpl.default_challenge_tree.scenario_b)
        assert abs(probs.p_restart - SIAC_B_RS) < 1e-6
        assert abs(probs.p_lose - SIAC_B_LO) < 1e-6
        assert abs(probs.p_true_win) < 1e-6

    def test_terminal_paths_sum_to_one(self):
        tmpl = _load_template("indian_domestic")
        probs = compute_tree_probabilities(tmpl.default_challenge_tree.scenario_a)
        total = sum(p["probability"] for p in probs.terminal_paths)
        assert abs(total - 1.0) < 1e-6, (
            f"Terminal path probabilities sum to {total:.6f}, expected 1.0"
        )

    def test_indian_domestic_a_has_12_paths(self):
        tmpl = _load_template("indian_domestic")
        probs = compute_tree_probabilities(tmpl.default_challenge_tree.scenario_a)
        assert len(probs.terminal_paths) == 12, (
            f"Expected 12 terminal paths, got {len(probs.terminal_paths)}"
        )

    def test_siac_a_has_4_paths(self):
        tmpl = _load_template("siac_singapore")
        probs = compute_tree_probabilities(tmpl.default_challenge_tree.scenario_a)
        assert len(probs.terminal_paths) == 4, (
            f"Expected 4 terminal paths, got {len(probs.terminal_paths)}"
        )


# ============================================================================
# Test 6: validate_tree — structural error detection
# ============================================================================

class TestValidateTree:
    """Verify that validate_tree catches structural errors."""

    def test_valid_trees_produce_no_errors(self):
        tmpl = _load_template("indian_domestic")
        errors_a = validate_tree(tmpl.default_challenge_tree.scenario_a, "A")
        errors_b = validate_tree(tmpl.default_challenge_tree.scenario_b, "B")
        assert errors_a == [], f"Unexpected errors in valid tree A: {errors_a}"
        assert errors_b == [], f"Unexpected errors in valid tree B: {errors_b}"

    def test_catches_bad_probability_sum(self):
        """Children probs summing to 0.8 (not 1.0) should be flagged."""
        # Pydantic's own validator catches bad probability sums at parse time,
        # so we use model_construct() to bypass schema validation and test
        # that validate_tree() independently catches the same issue.
        child_a = TreeNode.model_construct(
            name="A", probability=0.5, children=[], outcome="TRUE_WIN",
            duration_distribution=None, legal_cost=None,
        )
        child_b = TreeNode.model_construct(
            name="B", probability=0.3, children=[], outcome="LOSE",
            duration_distribution=None, legal_cost=None,
        )
        bad_root = TreeNode.model_construct(
            name="Root", probability=1.0, children=[child_a, child_b],
            outcome=None, duration_distribution=None, legal_cost=None,
        )
        bad_tree = ScenarioTree.model_construct(
            root=bad_root, description="Bad probability sum tree",
        )
        errors = validate_tree(bad_tree, "A")
        assert any("sum to" in e for e in errors), (
            f"Expected probability sum error, got: {errors}"
        )

    def test_catches_scenario_a_with_restart(self):
        """Scenario A tree with RESTART terminal should be flagged."""
        # We can't create this via ChallengeTreeConfig (validator blocks it),
        # but we can pass a ScenarioTree directly to validate_tree.
        bad_tree = ScenarioTree(
            root=TreeNode(
                name="Root",
                probability=1.0,
                children=[
                    TreeNode(name="Win", probability=0.7, outcome="TRUE_WIN"),
                    TreeNode(name="Restart", probability=0.3, outcome="RESTART"),
                ],
            ),
            description="Scenario A with illegal RESTART",
        )
        errors = validate_tree(bad_tree, "A")
        assert any("RESTART" in e for e in errors), (
            f"Expected RESTART-in-A error, got: {errors}"
        )

    def test_catches_scenario_b_with_true_win(self):
        """Scenario B tree with TRUE_WIN terminal should be flagged."""
        bad_tree = ScenarioTree(
            root=TreeNode(
                name="Root",
                probability=1.0,
                children=[
                    TreeNode(name="Lose", probability=0.6, outcome="LOSE"),
                    TreeNode(name="Win", probability=0.4, outcome="TRUE_WIN"),
                ],
            ),
            description="Scenario B with illegal TRUE_WIN",
        )
        errors = validate_tree(bad_tree, "B")
        assert any("TRUE_WIN" in e for e in errors), (
            f"Expected TRUE_WIN-in-B error, got: {errors}"
        )


# ============================================================================
# Test 7: SIAC durations — all paths exactly 12.0 months (fixed 6+6)
# ============================================================================

class TestSIACFixedDurations:
    """SIAC uses fixed 6.0-month durations for HC and COA stages.
    Every path should total exactly 12.0 months."""

    @pytest.fixture(autouse=True)
    def setup(self):
        self.tmpl = _load_template("siac_singapore")

    def test_scenario_a_all_durations_12(self):
        tree = self.tmpl.default_challenge_tree.scenario_a
        for i in range(1000):
            rng = np.random.default_rng(i)
            result = simulate_challenge_tree(tree, rng, scenario_label="A")
            assert abs(result.challenge_duration_months - 12.0) < 1e-9, (
                f"Path {i}: duration={result.challenge_duration_months}, expected 12.0. "
                f"Stages: {result.stages_traversed}"
            )

    def test_scenario_b_all_durations_12(self):
        tree = self.tmpl.default_challenge_tree.scenario_b
        for i in range(1000):
            rng = np.random.default_rng(i)
            result = simulate_challenge_tree(tree, rng, scenario_label="B")
            assert abs(result.challenge_duration_months - 12.0) < 1e-9, (
                f"Path {i}: duration={result.challenge_duration_months}, expected 12.0. "
                f"Stages: {result.stages_traversed}"
            )


# ============================================================================
# Test 8: Deterministic reproducibility — same seed → identical results
# ============================================================================

class TestDeterminism:
    """Verify that the same seed produces identical results."""

    def test_indian_domestic_deterministic(self):
        tmpl = _load_template("indian_domestic")
        tree = tmpl.default_challenge_tree.scenario_a

        rng1 = np.random.default_rng(12345)
        result1 = simulate_challenge_tree(tree, rng1, scenario_label="A")

        rng2 = np.random.default_rng(12345)
        result2 = simulate_challenge_tree(tree, rng2, scenario_label="A")

        assert result1.outcome == result2.outcome
        assert result1.path_description == result2.path_description
        assert result1.challenge_duration_months == result2.challenge_duration_months
        assert len(result1.stages_traversed) == len(result2.stages_traversed)

    def test_siac_deterministic(self):
        tmpl = _load_template("siac_singapore")
        tree = tmpl.default_challenge_tree.scenario_b

        rng1 = np.random.default_rng(54321)
        result1 = simulate_challenge_tree(tree, rng1, scenario_label="B")

        rng2 = np.random.default_rng(54321)
        result2 = simulate_challenge_tree(tree, rng2, scenario_label="B")

        assert result1.outcome == result2.outcome
        assert result1.path_description == result2.path_description


# ============================================================================
# Test 9: simulate_full_challenge convenience wrapper
# ============================================================================

class TestSimulateFullChallenge:
    """Verify the convenience wrapper selects the correct scenario."""

    def test_arb_won_uses_scenario_a(self):
        tmpl = _load_template("indian_domestic")
        rng = np.random.default_rng(42)
        result = simulate_full_challenge(tmpl, arb_won=True, rng=rng)
        assert result.scenario == "A"
        assert result.outcome in {"TRUE_WIN", "LOSE"}

    def test_arb_lost_uses_scenario_b(self):
        tmpl = _load_template("indian_domestic")
        rng = np.random.default_rng(42)
        result = simulate_full_challenge(tmpl, arb_won=False, rng=rng)
        assert result.scenario == "B"
        assert result.outcome in {"RESTART", "LOSE"}
