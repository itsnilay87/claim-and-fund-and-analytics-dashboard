"""
engine/tests/test_edge_cases.py — Edge case tests for the simulation engine.
==============================================================================

Phase 9C: Verify the platform handles boundary conditions gracefully —
extreme probabilities, tiny claims, single-claim portfolios, mixed
jurisdictions, no-restart mode, and timeline caps.
"""

from __future__ import annotations

import math

import numpy as np
import pytest

from engine.config.defaults import (
    get_default_claim_config,
    DEFAULT_QUANTUM_CONFIG,
)
from engine.config.schema import (
    ArbitrationConfig,
    ClaimConfig,
    PathResult,
    QuantumBand,
    QuantumConfig,
    SimulationConfig,
)
from engine.jurisdictions.registry import REGISTRY
from engine.simulation.monte_carlo import (
    compute_claim_summary,
    run_claim_simulation,
    run_portfolio_simulation,
)
from engine.analysis.investment_grid import evaluate_upfront_tail_grid
from engine.simulation.cashflow_builder import build_upfront_tail_cashflow
from engine.simulation.metrics import compute_moic


# ============================================================================
# Shared constants
# ============================================================================

N_PATHS = 2_000
SEED = 42


def _dom_template():
    return REGISTRY.get_template("indian_domestic")


def _siac_template():
    return REGISTRY.get_template("siac_singapore")


# ============================================================================
# TEST 1: P(win) ≈ 0 → near-100% loss
# ============================================================================

class TestPWinZero:
    """Claim with arb_win_probability ≈ 0. Nearly all outcomes should be LOSE."""

    def test_all_lose(self):
        claim = get_default_claim_config(
            "indian_domestic",
            claim_id="PWIN_ZERO",
            soc_value_cr=500.0,
        )
        claim = claim.model_copy(update={
            "arbitration": ArbitrationConfig(
                win_probability=0.01,
                re_arb_win_probability=0.01,
            ),
        })
        results = run_claim_simulation(claim, _dom_template(), N_PATHS, SEED)
        summary = compute_claim_summary(claim, results)

        assert summary["win_rate"] < 0.05, (
            f"P(win)=0.01: win rate {summary['win_rate']:.4f} should be < 0.05"
        )
        assert summary["outcome_distribution"]["LOSE"] > N_PATHS * 0.90, (
            "P(win)=0.01: > 90% of paths should be LOSE"
        )

    def test_p_loss_near_one(self):
        """Portfolio-level P(Loss) should be near 1.0."""
        claim = get_default_claim_config(
            "indian_domestic",
            claim_id="PWIN_ZERO_GRID",
            soc_value_cr=500.0,
        )
        claim = claim.model_copy(update={
            "arbitration": ArbitrationConfig(
                win_probability=0.01,
                re_arb_win_probability=0.01,
            ),
        })
        template = _dom_template()
        results = run_claim_simulation(claim, template, N_PATHS, SEED)
        pr_dict = {"PWIN_ZERO_GRID": results}

        grid = evaluate_upfront_tail_grid(
            [claim], pr_dict,
            upfront_range=[0.10],
            tail_range=[0.20],
        )
        cell = grid.get("10_20")
        assert cell is not None
        assert cell.p_loss > 0.90, (
            f"P(Loss) = {cell.p_loss:.4f}, expected > 0.90 for near-zero win"
        )


# ============================================================================
# TEST 2: P(win) ≈ 1 → near-zero loss probability
# ============================================================================

class TestPWinOne:
    """Claim with arb_win_probability = 0.99."""

    def test_high_win_rate(self):
        claim = get_default_claim_config(
            "indian_domestic",
            claim_id="PWIN_ONE",
            soc_value_cr=500.0,
        )
        claim = claim.model_copy(update={
            "arbitration": ArbitrationConfig(
                win_probability=0.99,
                re_arb_win_probability=0.99,
            ),
        })
        results = run_claim_simulation(claim, _dom_template(), N_PATHS, SEED)
        summary = compute_claim_summary(claim, results)

        # P(win)=0.99 → ScA probability ≈ 0.99 → P(TRUE_WIN|ScA) = 0.736
        # Effective win rate ≈ 0.73+ (some RESTART paths also succeed)
        assert summary["win_rate"] > 0.65, (
            f"P(win)=0.99: win rate {summary['win_rate']:.4f} should be > 0.65"
        )

    def test_low_loss_probability(self):
        """P(Loss) at a generous deal point should be low."""
        claim = get_default_claim_config(
            "indian_domestic",
            claim_id="PWIN_ONE_GRID",
            soc_value_cr=500.0,
        )
        claim = claim.model_copy(update={
            "arbitration": ArbitrationConfig(
                win_probability=0.99,
                re_arb_win_probability=0.99,
            ),
        })
        template = _dom_template()
        results = run_claim_simulation(claim, template, N_PATHS, SEED)
        pr_dict = {"PWIN_ONE_GRID": results}

        grid = evaluate_upfront_tail_grid(
            [claim], pr_dict,
            upfront_range=[0.05],
            tail_range=[0.10],
        )
        cell = grid.get("5_10")
        assert cell is not None
        assert cell.p_loss < 0.50, (
            f"P(Loss) = {cell.p_loss:.4f} at (5%, 10%) with P(win)=0.99, expected < 0.50"
        )


# ============================================================================
# TEST 3: Single-claim portfolio
# ============================================================================

class TestSingleClaimPortfolio:
    """Portfolio with exactly 1 claim should still work end-to-end."""

    def test_single_claim_simulation(self):
        claim = get_default_claim_config(
            "indian_domestic",
            claim_id="SINGLE",
            soc_value_cr=1000.0,
        )
        template = _dom_template()
        results = run_claim_simulation(claim, template, N_PATHS, SEED)

        summary = compute_claim_summary(claim, results)
        assert summary["n_paths"] == N_PATHS
        assert summary["win_rate"] > 0

    def test_single_claim_grid(self):
        """Single-claim portfolio should produce valid grid."""
        claim = get_default_claim_config(
            "indian_domestic",
            claim_id="SINGLE_GRID",
            soc_value_cr=1000.0,
        )
        template = _dom_template()
        results = run_claim_simulation(claim, template, N_PATHS, SEED)
        pr_dict = {"SINGLE_GRID": results}

        grid = evaluate_upfront_tail_grid(
            [claim], pr_dict,
            upfront_range=[0.10, 0.20],
            tail_range=[0.10, 0.20],
        )
        assert len(grid) >= 4, f"Expected 4 grid cells, got {len(grid)}"
        for cell in grid.values():
            assert not math.isnan(cell.mean_moic)
            assert 0.0 <= cell.p_loss <= 1.0


# ============================================================================
# TEST 4: Very small SOC
# ============================================================================

class TestVerySmallSOC:
    """Claim with SOC = 0.01 Cr. Should not cause division errors."""

    def test_no_division_errors(self):
        claim = get_default_claim_config(
            "indian_domestic",
            claim_id="TINY_SOC",
            soc_value_cr=0.01,
        )
        results = run_claim_simulation(claim, _dom_template(), 500, SEED)

        for i, r in enumerate(results):
            assert not math.isnan(r.timeline_months), f"Path {i}: NaN timeline"
            assert not math.isnan(r.collected_cr), f"Path {i}: NaN collected"
            assert not math.isnan(r.legal_costs_cr), f"Path {i}: NaN legal costs"

    def test_small_soc_grid(self):
        """Grid computation should handle tiny SOC without errors."""
        claim = get_default_claim_config(
            "indian_domestic",
            claim_id="TINY_SOC_GRID",
            soc_value_cr=0.01,
        )
        results = run_claim_simulation(claim, _dom_template(), 500, SEED)
        pr_dict = {"TINY_SOC_GRID": results}

        grid = evaluate_upfront_tail_grid(
            [claim], pr_dict,
            upfront_range=[0.10],
            tail_range=[0.20],
        )
        cell = grid.get("10_20")
        assert cell is not None
        assert not math.isnan(cell.mean_moic)


# ============================================================================
# TEST 5: Single quantum band
# ============================================================================

class TestSingleQuantumBand:
    """Claim with 1 quantum band (100% probability). Quantum should be near-deterministic."""

    def test_single_band_deterministic(self):
        claim = get_default_claim_config(
            "indian_domestic",
            claim_id="SINGLE_BAND",
            soc_value_cr=1000.0,
        )
        # Override quantum: single band at 80-100% of SOC
        claim = claim.model_copy(update={
            "quantum": QuantumConfig(
                bands=[QuantumBand(low=0.80, high=1.00, probability=1.0)],
            ),
        })
        results = run_claim_simulation(claim, _dom_template(), 1000, SEED)

        # All TRUE_WIN paths should have quantum in [0.80, 1.00] × SOC
        for r in results:
            if r.outcome == "TRUE_WIN" and r.quantum_cr > 0:
                q_pct = r.quantum_cr / 1000.0
                assert 0.79 <= q_pct <= 1.01, (
                    f"Q/SOC = {q_pct:.4f}, expected in [0.80, 1.00]"
                )

    def test_single_band_expected_value(self):
        """E[Q|WIN] with single band [0.80, 1.00] = 0.90 × SOC."""
        qc = QuantumConfig(
            bands=[QuantumBand(low=0.80, high=1.00, probability=1.0)],
        )
        assert abs(qc.expected_quantum_pct - 0.90) < 0.001


# ============================================================================
# TEST 6: Mixed jurisdiction portfolio (3 domestic + 3 SIAC)
# ============================================================================

class TestMixedJurisdiction:
    """Portfolio with both domestic and SIAC claims. Both tree types should execute."""

    def test_mixed_portfolio(self):
        dom = get_default_claim_config(
            "indian_domestic", claim_id="MIX_DOM_1", soc_value_cr=500.0,
        )
        siac = get_default_claim_config(
            "siac_singapore", claim_id="MIX_SIAC_1", soc_value_cr=500.0,
        )
        claims = [dom, siac]
        templates = {
            "indian_domestic": _dom_template(),
            "siac_singapore": _siac_template(),
        }

        results = run_portfolio_simulation(claims, templates, N_PATHS, SEED)

        assert "MIX_DOM_1" in results
        assert "MIX_SIAC_1" in results
        assert len(results["MIX_DOM_1"]) == N_PATHS
        assert len(results["MIX_SIAC_1"]) == N_PATHS

        # Both should have non-zero win rates
        dom_wins = sum(1 for r in results["MIX_DOM_1"] if r.outcome == "TRUE_WIN")
        siac_wins = sum(1 for r in results["MIX_SIAC_1"] if r.outcome == "TRUE_WIN")
        assert dom_wins > 0, "Domestic claim should have some wins"
        assert siac_wins > 0, "SIAC claim should have some wins"

    def test_mixed_portfolio_grid(self):
        """Grid should work with mixed-jurisdiction portfolio."""
        dom = get_default_claim_config(
            "indian_domestic", claim_id="MIX_DOM_G", soc_value_cr=500.0,
        )
        siac = get_default_claim_config(
            "siac_singapore", claim_id="MIX_SIAC_G", soc_value_cr=500.0,
        )
        claims = [dom, siac]
        templates = {
            "indian_domestic": _dom_template(),
            "siac_singapore": _siac_template(),
        }

        results = run_portfolio_simulation(claims, templates, 1000, SEED)
        grid = evaluate_upfront_tail_grid(
            claims, results,
            upfront_range=[0.10],
            tail_range=[0.20],
        )
        cell = grid.get("10_20")
        assert cell is not None
        assert "MIX_DOM_G" in cell.per_claim
        assert "MIX_SIAC_G" in cell.per_claim


# ============================================================================
# TEST 7: no_restart_mode
# ============================================================================

class TestNoRestartMode:
    """All RESTART outcomes should remap to LOSE."""

    def test_zero_restart_in_results(self):
        claim = get_default_claim_config(
            "indian_domestic",
            claim_id="NO_RESTART",
            soc_value_cr=1000.0,
        )
        claim = claim.model_copy(update={"no_restart_mode": True})

        results = run_claim_simulation(claim, _dom_template(), N_PATHS, SEED)
        summary = compute_claim_summary(claim, results)

        assert summary["outcome_distribution"]["RESTART"] == 0, (
            "no_restart_mode should produce zero RESTART outcomes"
        )

    def test_no_restart_lower_win_rate(self):
        """no_restart_mode should produce lower or equal win rate."""
        claim_normal = get_default_claim_config(
            "indian_domestic", claim_id="NR_NORMAL", soc_value_cr=1000.0,
        )
        claim_nr = claim_normal.model_copy(
            update={"id": "NR_MODE", "no_restart_mode": True},
        )

        r_normal = run_claim_simulation(claim_normal, _dom_template(), N_PATHS, SEED)
        r_nr = run_claim_simulation(claim_nr, _dom_template(), N_PATHS, SEED)

        wr_normal = compute_claim_summary(claim_normal, r_normal)["win_rate"]
        wr_nr = compute_claim_summary(claim_nr, r_nr)["win_rate"]

        assert wr_nr <= wr_normal + 0.02, (
            f"no_restart win rate ({wr_nr:.4f}) should be <= "
            f"normal ({wr_normal:.4f}) within MC noise"
        )


# ============================================================================
# TEST 8: Max timeline cap (96 months)
# ============================================================================

class TestMaxTimelineCap:
    """Paths exceeding max_horizon_months should be capped."""

    def test_no_path_exceeds_96_months(self):
        claim = get_default_claim_config(
            "indian_domestic",
            claim_id="TIMELINE_CAP",
            soc_value_cr=1000.0,
        )
        results = run_claim_simulation(claim, _dom_template(), N_PATHS, SEED)

        max_dur = max(r.timeline_months for r in results)
        assert max_dur <= 96.0 + 1e-6, (
            f"Max timeline = {max_dur:.2f}, should be <= 96 months"
        )

    def test_capped_paths_are_lose(self):
        """Paths hitting the 96-month cap should be LOSE outcomes."""
        claim = get_default_claim_config(
            "indian_domestic",
            claim_id="TIMELINE_CAP_LOSE",
            soc_value_cr=1000.0,
        )
        results = run_claim_simulation(claim, _dom_template(), N_PATHS, SEED)

        for r in results:
            if abs(r.timeline_months - 96.0) < 0.5:
                # Paths at the cap boundary should be LOSE
                assert r.outcome == "LOSE", (
                    f"Path at {r.timeline_months:.1f}m should be LOSE, got {r.outcome}"
                )


# ============================================================================
# TEST 9: Large SOC does not overflow
# ============================================================================

class TestLargeSOC:
    """SOC = 100,000 Cr. Should handle without numeric overflow."""

    def test_large_soc_runs(self):
        claim = get_default_claim_config(
            "indian_domestic",
            claim_id="LARGE_SOC",
            soc_value_cr=100_000.0,
        )
        results = run_claim_simulation(claim, _dom_template(), 500, SEED)

        for i, r in enumerate(results):
            assert not math.isnan(r.collected_cr), f"Path {i}: NaN collected"
            assert not math.isinf(r.collected_cr), f"Path {i}: Inf collected"
            if r.outcome == "TRUE_WIN":
                assert r.collected_cr <= 100_000.0 + 1e-6, (
                    f"Path {i}: collected {r.collected_cr} > SOC"
                )
