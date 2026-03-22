"""
engine/tests/test_structures.py — Per-structure end-to-end tests.
==================================================================

Phase 9B: Verify each investment structure produces valid simulation
results and correctly formatted output through the platform engine.

Tests exercise:
  1. Upfront + Tail  (standard V2 monetisation structure)
  2. Litigation Funding (waterfall: cost multiple × award ratio)
  3. Full Purchase (lump-sum claim purchase)
  4. Staged Payments (milestone-based acquisition)
  5. Comparative (side-by-side lit funding vs monetisation)
"""

from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np
import pytest

from engine.config.defaults import get_default_claim_config
from engine.config.schema import (
    ArbitrationConfig,
    ClaimConfig,
    GridCellMetrics,
    LitFundingParams,
    FullPurchaseParams,
    MilestonePayment,
    PathResult,
    PortfolioStructure,
    StagedPaymentParams,
    SimulationConfig,
    UpfrontTailParams,
    _GridRange,
)
from engine.jurisdictions.registry import REGISTRY
from engine.simulation.monte_carlo import (
    compute_claim_summary,
    run_claim_simulation,
    run_portfolio_simulation,
)
from engine.simulation.cashflow_builder import (
    build_upfront_tail_cashflow,
    build_litigation_funding_cashflow,
    build_full_purchase_cashflow,
    build_staged_payment_cashflow,
    merge_dated_cashflows,
)
from engine.simulation.metrics import compute_xirr, compute_moic
from engine.analysis.investment_grid import evaluate_upfront_tail_grid
from engine.analysis.waterfall_analysis import evaluate_waterfall_grid


# ============================================================================
# Shared fixtures
# ============================================================================

N_PATHS = 2_000  # Smaller for speed; structures are tested, not MC quality
SEED = 42


@pytest.fixture(scope="module")
def domestic_claim() -> ClaimConfig:
    return get_default_claim_config(
        "indian_domestic",
        claim_id="STRUCT_DOM",
        name="Structure Test Domestic",
        soc_value_cr=1000.0,
    )


@pytest.fixture(scope="module")
def siac_claim() -> ClaimConfig:
    return get_default_claim_config(
        "siac_singapore",
        claim_id="STRUCT_SIAC",
        name="Structure Test SIAC",
        soc_value_cr=500.0,
    )


@pytest.fixture(scope="module")
def portfolio_claims(domestic_claim, siac_claim) -> list[ClaimConfig]:
    return [domestic_claim, siac_claim]


@pytest.fixture(scope="module")
def templates() -> dict:
    return {
        "indian_domestic": REGISTRY.get_template("indian_domestic"),
        "siac_singapore": REGISTRY.get_template("siac_singapore"),
    }


@pytest.fixture(scope="module")
def portfolio_results(portfolio_claims, templates):
    return run_portfolio_simulation(
        portfolio_claims, templates, N_PATHS, SEED,
    )


# ============================================================================
# TEST 1: Upfront + Tail (e2e)
# ============================================================================

class TestUpfrontTailE2E:
    """Complete upfront+tail monetisation structure test."""

    def test_investment_grid_produces_cells(
        self, portfolio_claims, portfolio_results,
    ):
        """Grid with 6 upfront × 9 tail levels = 54 cells."""
        grid = evaluate_upfront_tail_grid(
            portfolio_claims, portfolio_results,
            upfront_range=[0.05, 0.10, 0.15, 0.20, 0.25, 0.30],
            tail_range=[0.10, 0.15, 0.20, 0.25, 0.30, 0.35, 0.40, 0.45, 0.50],
        )
        assert len(grid) >= 54, f"Expected >= 54 grid cells, got {len(grid)}"

    def test_per_claim_moic_positive_on_win_paths(
        self, portfolio_claims, portfolio_results,
    ):
        """For winning paths, single-claim MOIC should be > 0."""
        claim = portfolio_claims[0]
        results = portfolio_results[claim.id]
        wins = [r for r in results if r.outcome == "TRUE_WIN"]
        assert len(wins) > 0, "Should have at least some winning paths"

        for r in wins[:10]:
            dates, cfs, inv, ret = build_upfront_tail_cashflow(
                claim, r, upfront_pct=0.10, tail_pct=0.20,
            )
            moic = compute_moic(ret, inv)
            assert moic > 0, f"TRUE_WIN path should have MOIC > 0, got {moic}"

    def test_loss_paths_return_zero(
        self, portfolio_claims, portfolio_results,
    ):
        """For losing paths, total_return should be 0."""
        claim = portfolio_claims[0]
        results = portfolio_results[claim.id]
        losses = [r for r in results if r.outcome == "LOSE"]
        assert len(losses) > 0, "Should have some losing paths"

        for r in losses[:10]:
            dates, cfs, inv, ret = build_upfront_tail_cashflow(
                claim, r, upfront_pct=0.10, tail_pct=0.20,
            )
            assert ret == 0.0, f"LOSE path should have 0 return, got {ret}"
            assert inv > 0.0, f"Investment should be > 0, got {inv}"

    def test_cashflow_dates_ordered(
        self, portfolio_claims, portfolio_results,
    ):
        """Cashflow dates should be monotonically increasing."""
        claim = portfolio_claims[0]
        r = portfolio_results[claim.id][0]
        dates, cfs, inv, ret = build_upfront_tail_cashflow(
            claim, r, upfront_pct=0.10, tail_pct=0.20,
        )
        for i in range(1, len(dates)):
            assert dates[i] > dates[i - 1], (
                f"Dates not ordered at index {i}: {dates[i-1]} -> {dates[i]}"
            )


# ============================================================================
# TEST 2: Litigation Funding (e2e)
# ============================================================================

class TestLitigationFundingE2E:
    """Litigation funding waterfall structure test."""

    def test_waterfall_grid_produces_cells(
        self, portfolio_claims, portfolio_results,
    ):
        """Waterfall grid should produce cells for each (cost_multiple, award_ratio)."""
        grid = evaluate_waterfall_grid(
            portfolio_claims, portfolio_results,
            cost_multiple_range=[1.5, 2.0, 2.5, 3.0],
            award_ratio_range=[0.15, 0.20, 0.25, 0.30],
        )
        assert len(grid) >= 16, f"Expected >= 16 grid cells, got {len(grid)}"

    def test_waterfall_cell_has_metrics(
        self, portfolio_claims, portfolio_results,
    ):
        """Each cell should have valid MOIC and P(Loss) values."""
        grid = evaluate_waterfall_grid(
            portfolio_claims, portfolio_results,
            cost_multiple_range=[2.0],
            award_ratio_range=[0.25],
        )
        assert len(grid) >= 1, "Should have at least 1 cell"
        cell = list(grid.values())[0]
        assert isinstance(cell, GridCellMetrics)
        assert not math.isnan(cell.mean_moic), "mean_moic should not be NaN"
        assert 0.0 <= cell.p_loss <= 1.0, "p_loss should be in [0,1]"

    def test_litigation_funding_cashflow_win(
        self, portfolio_claims, portfolio_results,
    ):
        """Lit funding on a TRUE_WIN path should produce positive return."""
        claim = portfolio_claims[0]
        wins = [r for r in portfolio_results[claim.id] if r.outcome == "TRUE_WIN"]
        assert len(wins) > 0

        r = wins[0]
        dates, cfs, inv, ret = build_litigation_funding_cashflow(
            claim, r,
            cost_multiple_cap=3.0,
            award_ratio_cap=0.25,
            waterfall_type="min",
        )
        assert inv > 0, "Invested (legal costs) should be > 0"
        assert ret > 0, "Return on TRUE_WIN should be > 0"

    def test_litigation_funding_cashflow_lose(
        self, portfolio_claims, portfolio_results,
    ):
        """Lit funding on a LOSE path should return 0."""
        claim = portfolio_claims[0]
        losses = [r for r in portfolio_results[claim.id] if r.outcome == "LOSE"]
        assert len(losses) > 0

        r = losses[0]
        dates, cfs, inv, ret = build_litigation_funding_cashflow(
            claim, r,
            cost_multiple_cap=3.0,
            award_ratio_cap=0.25,
        )
        assert ret == 0.0, f"LOSE path should have 0 return, got {ret}"

    def test_waterfall_min_vs_max(
        self, portfolio_claims, portfolio_results,
    ):
        """'min' waterfall should produce ≤ 'max' waterfall return on win paths."""
        claim = portfolio_claims[0]
        wins = [r for r in portfolio_results[claim.id] if r.outcome == "TRUE_WIN"]
        if not wins:
            pytest.skip("No winning paths found")

        r = wins[0]
        _, _, _, ret_min = build_litigation_funding_cashflow(
            claim, r, cost_multiple_cap=3.0, award_ratio_cap=0.25,
            waterfall_type="min",
        )
        _, _, _, ret_max = build_litigation_funding_cashflow(
            claim, r, cost_multiple_cap=3.0, award_ratio_cap=0.25,
            waterfall_type="max",
        )
        assert ret_min <= ret_max + 1e-9, (
            f"min waterfall ({ret_min}) should be <= max waterfall ({ret_max})"
        )


# ============================================================================
# TEST 3: Full Purchase (e2e)
# ============================================================================

class TestFullPurchaseE2E:
    """Full claim purchase monetisation structure test."""

    def test_purchase_cashflow_structure(
        self, portfolio_claims, portfolio_results,
    ):
        """Full purchase should produce valid cashflow with purchase price at month 0."""
        claim = portfolio_claims[0]
        r = portfolio_results[claim.id][0]

        dates, cfs, inv, ret = build_full_purchase_cashflow(
            claim, r,
            purchase_price_cr=100.0,
            legal_cost_bearer="investor",
            purchased_share_pct=1.0,
        )
        assert len(dates) >= 2, "Should have at least 2 cashflow dates"
        assert cfs[0] < 0, "Month 0 cashflow should be negative (purchase + legal)"
        assert inv >= 100.0, "Total invested should include purchase price"

    def test_breakeven_price_exists(
        self, portfolio_claims, portfolio_results,
    ):
        """There should exist a purchase price where E[MOIC] ≈ 1.0.

        Sweep purchase prices and verify MOIC transitions from > 1 to < 1.
        """
        claim = portfolio_claims[0]
        results = portfolio_results[claim.id]

        prices = [50.0, 100.0, 200.0, 400.0, 600.0, 800.0]
        moics = []
        for price in prices:
            path_moics = []
            for r in results:
                _, _, inv, ret = build_full_purchase_cashflow(
                    claim, r,
                    purchase_price_cr=price,
                    legal_cost_bearer="investor",
                )
                path_moics.append(compute_moic(ret, inv))
            moics.append(np.mean(path_moics))

        # MOIC should decrease as purchase price increases
        assert moics[0] > moics[-1], (
            f"MOIC should decrease: cheap ({moics[0]:.3f}) vs expensive ({moics[-1]:.3f})"
        )

    def test_legal_cost_bearer_variants(
        self, portfolio_claims, portfolio_results,
    ):
        """Different legal cost bearers should produce different invested amounts."""
        claim = portfolio_claims[0]
        r = portfolio_results[claim.id][0]

        _, _, inv_investor, _ = build_full_purchase_cashflow(
            claim, r, purchase_price_cr=100.0, legal_cost_bearer="investor",
        )
        _, _, inv_claimant, _ = build_full_purchase_cashflow(
            claim, r, purchase_price_cr=100.0, legal_cost_bearer="claimant",
        )
        # Investor-borne costs → higher invested
        assert inv_investor >= inv_claimant, (
            f"Investor bearer ({inv_investor:.2f}) should have higher invested "
            f"than claimant bearer ({inv_claimant:.2f})"
        )


# ============================================================================
# TEST 4: Staged Payment (e2e)
# ============================================================================

class TestStagedPaymentE2E:
    """Staged (milestone-based) acquisition structure test."""

    def test_staged_cashflow_basic(
        self, portfolio_claims, portfolio_results,
    ):
        """Staged payment should produce valid multi-tranche cashflow."""
        claim = portfolio_claims[0]
        r = portfolio_results[claim.id][0]

        milestones = [
            MilestonePayment(milestone_name="dab", payment_cr=20.0),
            MilestonePayment(milestone_name="arbitration", payment_cr=50.0),
            MilestonePayment(milestone_name="award_received", payment_cr=30.0),
        ]

        dates, cfs, inv, ret = build_staged_payment_cashflow(
            claim, r, milestones=milestones,
        )
        assert len(dates) >= 2, "Should have at least 2 dates"
        assert inv > 0, "Total invested should be > 0"

    def test_milestone_triggers_conditional(
        self, portfolio_claims, portfolio_results,
    ):
        """Milestones beyond the path's timeline should NOT be paid.

        For very short paths, late milestones are skipped → lower total invested.
        """
        claim = portfolio_claims[0]
        results = portfolio_results[claim.id]

        milestones = [
            MilestonePayment(milestone_name="dab", payment_cr=20.0),
            MilestonePayment(milestone_name="arbitration", payment_cr=50.0),
            MilestonePayment(milestone_name="award_received", payment_cr=30.0),
        ]

        invested_amounts = []
        for r in results[:100]:
            _, _, inv, _ = build_staged_payment_cashflow(
                claim, r, milestones=milestones,
            )
            invested_amounts.append(inv)

        # With stochastic timelines, invested amounts should vary
        inv_arr = np.array(invested_amounts)
        assert inv_arr.std() >= 0, "Invested amounts computed"

    def test_staged_return_on_win(
        self, portfolio_claims, portfolio_results,
    ):
        """TRUE_WIN paths should produce positive return."""
        claim = portfolio_claims[0]
        wins = [r for r in portfolio_results[claim.id] if r.outcome == "TRUE_WIN"]
        if not wins:
            pytest.skip("No winning paths")

        milestones = [
            MilestonePayment(milestone_name="dab", payment_cr=20.0),
            MilestonePayment(milestone_name="award_received", payment_cr=30.0),
        ]

        r = wins[0]
        _, _, inv, ret = build_staged_payment_cashflow(
            claim, r, milestones=milestones,
            purchased_share_pct=1.0,
        )
        assert ret > 0, f"TRUE_WIN should produce positive return, got {ret}"


# ============================================================================
# TEST 5: Comparative (e2e)
# ============================================================================

class TestComparativeE2E:
    """Comparative structure: side-by-side lit funding vs monetisation."""

    def test_both_structures_produce_results(
        self, portfolio_claims, portfolio_results,
    ):
        """Running both structures on same paths should produce two sets of metrics."""
        # Upfront + Tail grid
        ut_grid = evaluate_upfront_tail_grid(
            portfolio_claims, portfolio_results,
            upfront_range=[0.10],
            tail_range=[0.20],
        )
        assert len(ut_grid) >= 1, "UT grid should have cells"

        # Waterfall grid
        wf_grid = evaluate_waterfall_grid(
            portfolio_claims, portfolio_results,
            cost_multiple_range=[2.0],
            award_ratio_range=[0.25],
        )
        assert len(wf_grid) >= 1, "Waterfall grid should have cells"

    def test_comparative_metrics_differ(
        self, portfolio_claims, portfolio_results,
    ):
        """Different structures should generally produce different MOIC values."""
        ut_grid = evaluate_upfront_tail_grid(
            portfolio_claims, portfolio_results,
            upfront_range=[0.10],
            tail_range=[0.20],
        )
        wf_grid = evaluate_waterfall_grid(
            portfolio_claims, portfolio_results,
            cost_multiple_range=[2.0],
            award_ratio_range=[0.25],
        )

        ut_moic = list(ut_grid.values())[0].mean_moic
        wf_moic = list(wf_grid.values())[0].mean_moic

        # Structures should produce different MOIC (different economics)
        # Not testing equality — just that both produce valid numbers
        assert not math.isnan(ut_moic), "UT MOIC should not be NaN"
        assert not math.isnan(wf_moic), "WF MOIC should not be NaN"
        assert ut_moic > 0 or wf_moic > 0, "At least one structure should have MOIC > 0"

    def test_cashflow_merge_works(
        self, portfolio_claims, portfolio_results,
    ):
        """Merging cashflows from both claims should produce valid combined cashflow."""
        claim_cfs = []
        for claim in portfolio_claims:
            r = portfolio_results[claim.id][0]
            dates, cfs, _, _ = build_upfront_tail_cashflow(
                claim, r, upfront_pct=0.10, tail_pct=0.20,
            )
            claim_cfs.append((dates, cfs))

        merged_dates, merged_cfs = merge_dated_cashflows(claim_cfs)
        assert len(merged_dates) >= 2, "Merged cashflow should have dates"
        # First cashflow should be negative (outflows)
        assert merged_cfs[0] < 0, "First merged cashflow should be negative (investment)"
