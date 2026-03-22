"""
Tests for metrics.py and cashflow_builder.py.

Covers:
  - XIRR convergence on known cashflows
  - XIRR edge cases (all-loss, all-positive, single cashflow)
  - MOIC calculation
  - Monthly IRR
  - VaR / CVaR on known distributions
  - Litigation funding waterfall (MIN and MAX)
  - Upfront + tail cashflow
  - Full purchase cashflow
  - Merge dated cashflows
"""

from __future__ import annotations

import math
from datetime import datetime, timedelta

import numpy as np
import pytest

from engine.simulation.metrics import (
    compute_cvar,
    compute_irr_monthly,
    compute_moic,
    compute_net_return,
    compute_var,
    compute_xirr,
    compute_xirr_from_dayfrac,
    merge_dated_cashflows,
)
from engine.simulation.cashflow_builder import (
    build_litigation_funding_cashflow,
    build_full_purchase_cashflow,
    build_upfront_tail_cashflow,
    _month_end,
)
from engine.config.schema import ClaimConfig, PathResult


# ============================================================================
# Fixtures — minimal ClaimConfig for cashflow tests
# ============================================================================

def _minimal_claim(soc: float = 1000.0) -> ClaimConfig:
    """Build a minimal valid ClaimConfig for cashflow testing."""
    return ClaimConfig(
        id="TEST-001",
        name="Test Claim",
        jurisdiction="indian_domestic",
        soc_value_cr=soc,
        quantum={"bands": [{"low": 0.60, "high": 1.00, "probability": 1.0}]},
        challenge_tree={
            "scenario_a": {
                "root": {
                    "name": "root_a",
                    "probability": 1.0,
                    "children": [
                        {"name": "no_challenge", "probability": 1.0, "outcome": "TRUE_WIN"},
                    ],
                },
            },
            "scenario_b": {
                "root": {
                    "name": "root_b",
                    "probability": 1.0,
                    "children": [
                        {"name": "challenge_fail", "probability": 1.0, "outcome": "LOSE"},
                    ],
                },
            },
        },
    )


def _win_path(timeline: float = 24.0, collected: float = 500.0, legal: float = 50.0) -> PathResult:
    """Build a TRUE_WIN PathResult."""
    return PathResult(
        outcome="TRUE_WIN",
        quantum_cr=collected,
        quantum_pct=0.80,
        timeline_months=timeline,
        legal_costs_cr=legal,
        collected_cr=collected,
    )


def _lose_path(timeline: float = 30.0, legal: float = 40.0) -> PathResult:
    """Build a LOSE PathResult."""
    return PathResult(
        outcome="LOSE",
        quantum_cr=0.0,
        quantum_pct=0.0,
        timeline_months=timeline,
        legal_costs_cr=legal,
        collected_cr=0.0,
    )


# ============================================================================
# XIRR Tests
# ============================================================================

class TestComputeXIRR:
    """Tests for compute_xirr()."""

    def test_simple_investment_return(self):
        """Invest 100 at month 0, receive 150 at month 24 → ~22% annualized."""
        base = datetime(2026, 4, 30)
        dates = [base, base + timedelta(days=730)]  # ~24 months
        cashflows = [-100.0, 150.0]

        xirr = compute_xirr(dates, cashflows)
        # 150/100 over 2 years → (1.5)^0.5 - 1 ≈ 0.2247
        assert 0.20 <= xirr <= 0.25, f"XIRR {xirr:.4f} not in expected range"

    def test_all_loss_path(self):
        """All negative cashflows → returns -1.0."""
        base = datetime(2026, 4, 30)
        dates = [base, base + timedelta(days=365)]
        cashflows = [-100.0, -50.0]

        xirr = compute_xirr(dates, cashflows)
        assert xirr == -1.0

    def test_all_positive(self):
        """All positive cashflows → returns 10.0 (capped)."""
        base = datetime(2026, 4, 30)
        dates = [base, base + timedelta(days=365)]
        cashflows = [50.0, 100.0]

        xirr = compute_xirr(dates, cashflows)
        assert xirr == 10.0

    def test_single_cashflow(self):
        """Single cashflow → returns 0.0."""
        dates = [datetime(2026, 4, 30)]
        cashflows = [-100.0]

        xirr = compute_xirr(dates, cashflows)
        assert xirr == 0.0

    def test_breakeven(self):
        """Invest 100, get 100 back in 1 year → XIRR ≈ 0."""
        base = datetime(2026, 4, 30)
        dates = [base, base + timedelta(days=365)]
        cashflows = [-100.0, 100.0]

        xirr = compute_xirr(dates, cashflows)
        assert abs(xirr) < 0.01

    def test_length_mismatch_raises(self):
        """Mismatched lengths should raise ValueError."""
        with pytest.raises(ValueError, match="same length"):
            compute_xirr(
                [datetime(2026, 1, 1)],
                [-100.0, 50.0],
            )


class TestComputeXIRRFromDayFrac:
    """Tests for the batch-optimised XIRR."""

    def test_matches_date_based(self):
        """Day-frac version should match date-based for same cashflows."""
        base = datetime(2026, 4, 30)
        dates = [base, base + timedelta(days=365), base + timedelta(days=730)]
        cashflows = [-100.0, 30.0, 120.0]

        xirr_dates = compute_xirr(dates, cashflows)

        day_fracs = np.array([0.0, 365.0 / 365.0, 730.0 / 365.0])
        cf = np.array(cashflows)
        xirr_df = compute_xirr_from_dayfrac(day_fracs, cf)

        assert abs(xirr_dates - xirr_df) < 0.001


# ============================================================================
# Monthly IRR Tests
# ============================================================================

class TestComputeIRRMonthly:
    """Tests for compute_irr_monthly()."""

    def test_simple_monthly(self):
        """Invest 100 at month 0, receive 150 at month 24."""
        cf = np.zeros(25)
        cf[0] = -100.0
        cf[24] = 150.0

        irr = compute_irr_monthly(cf)
        # ~22% annualized
        assert 0.18 <= irr <= 0.28

    def test_all_negative(self):
        """All losses → -1.0."""
        cf = np.array([-100.0, -50.0, -25.0])
        assert compute_irr_monthly(cf) == -1.0


# ============================================================================
# MOIC Tests
# ============================================================================

class TestComputeMOIC:
    """Tests for compute_moic()."""

    def test_standard_moic(self):
        """Invested 50, returned 125 → MOIC = 2.5."""
        moic = compute_moic(total_return=125.0, total_invested=50.0)
        assert moic == 2.5

    def test_zero_invested(self):
        """Zero invested → 0.0."""
        moic = compute_moic(total_return=100.0, total_invested=0.0)
        assert moic == 0.0

    def test_negative_invested(self):
        """Negative invested → 0.0."""
        moic = compute_moic(total_return=100.0, total_invested=-10.0)
        assert moic == 0.0

    def test_loss_moic(self):
        """Loss: invested 100, returned 30 → MOIC = 0.3."""
        moic = compute_moic(total_return=30.0, total_invested=100.0)
        assert abs(moic - 0.3) < 1e-9


# ============================================================================
# Net Return Tests
# ============================================================================

class TestComputeNetReturn:
    """Tests for compute_net_return()."""

    def test_positive(self):
        assert compute_net_return(150.0, 100.0) == 50.0

    def test_negative(self):
        assert compute_net_return(30.0, 100.0) == -70.0


# ============================================================================
# VaR / CVaR Tests
# ============================================================================

class TestVaRCVaR:
    """Tests for compute_var() and compute_cvar()."""

    def test_var_known_distribution(self):
        """Uniform [0, 100] → VaR at 5% ≈ 5.0."""
        rng = np.random.default_rng(42)
        values = rng.uniform(0, 100, size=100_000)

        var_5 = compute_var(values, alpha=0.05)
        assert 4.0 <= var_5 <= 6.0, f"VaR_5% = {var_5:.2f}"

    def test_cvar_below_var(self):
        """CVaR should be ≤ VaR (further in the tail)."""
        rng = np.random.default_rng(42)
        values = rng.normal(0, 1, size=100_000)

        var_5 = compute_var(values, alpha=0.05)
        cvar_5 = compute_cvar(values, alpha=0.05)
        assert cvar_5 <= var_5

    def test_cvar_known_distribution(self):
        """Uniform [0, 100] → CVaR at 1% ≈ mean of bottom 1% ≈ 0.5."""
        rng = np.random.default_rng(42)
        values = rng.uniform(0, 100, size=100_000)

        cvar_1 = compute_cvar(values, alpha=0.01)
        assert 0.0 <= cvar_1 <= 2.0, f"CVaR_1% = {cvar_1:.2f}"

    def test_var_alpha_bounds(self):
        """Invalid alpha should raise AssertionError."""
        values = np.array([1.0, 2.0, 3.0])
        with pytest.raises(AssertionError):
            compute_var(values, alpha=0.0)
        with pytest.raises(AssertionError):
            compute_var(values, alpha=1.0)


# ============================================================================
# Merge Dated Cashflows Tests
# ============================================================================

class TestMergeDatedCashflows:
    """Tests for merge_dated_cashflows()."""

    def test_empty(self):
        dates, cfs = merge_dated_cashflows([])
        assert dates == []
        assert cfs == []

    def test_single_claim(self):
        d = [datetime(2026, 4, 30), datetime(2026, 5, 31)]
        c = [-100.0, 150.0]
        dates, cfs = merge_dated_cashflows([(d, c)])
        assert dates == d
        assert cfs == c

    def test_two_claims_aligned(self):
        """Two claims with same dates → cashflows sum."""
        d = [datetime(2026, 4, 30), datetime(2026, 5, 31)]
        c1 = [-100.0, 150.0]
        c2 = [-50.0, 80.0]

        dates, cfs = merge_dated_cashflows([(d, c1), (d, c2)])
        assert len(dates) == 2
        assert cfs[0] == pytest.approx(-150.0)
        assert cfs[1] == pytest.approx(230.0)

    def test_two_claims_staggered(self):
        """Claims with different end dates → merged timeline extends."""
        d1 = [datetime(2026, 4, 30), datetime(2026, 5, 31)]
        c1 = [-100.0, 150.0]
        d2 = [datetime(2026, 4, 30), datetime(2026, 6, 30)]
        c2 = [-50.0, 80.0]

        dates, cfs = merge_dated_cashflows([(d1, c1), (d2, c2)])
        assert len(dates) == 3  # Apr 30, May 31, Jun 30
        assert dates[0] == datetime(2026, 4, 30)
        assert cfs[0] == pytest.approx(-150.0)


# ============================================================================
# Litigation Funding Waterfall Tests
# ============================================================================

class TestLitigationFundingCashflow:
    """Tests for build_litigation_funding_cashflow()."""

    def test_waterfall_min(self):
        """MIN waterfall: costs=50, collected=500, multiple=4, ratio=0.25.
        leg_a = 4 * 50 = 200, leg_b = 0.25 * 500 = 125 → return = min(200, 125) = 125.
        """
        claim = _minimal_claim()
        pr = _win_path(timeline=24.0, collected=500.0, legal=50.0)

        dates, cfs, invested, ret = build_litigation_funding_cashflow(
            claim=claim,
            path_result=pr,
            cost_multiple_cap=4.0,
            award_ratio_cap=0.25,
            waterfall_type="min",
        )

        assert invested == pytest.approx(50.0, abs=1.0)
        assert ret == pytest.approx(125.0, abs=1.0)
        assert len(dates) == len(cfs)
        # Sum of cashflows should be ret - invested
        assert sum(cfs) == pytest.approx(ret - invested, abs=1.0)

    def test_waterfall_max(self):
        """MAX waterfall: same inputs → return = max(200, 125) = 200."""
        claim = _minimal_claim()
        pr = _win_path(timeline=24.0, collected=500.0, legal=50.0)

        dates, cfs, invested, ret = build_litigation_funding_cashflow(
            claim=claim,
            path_result=pr,
            cost_multiple_cap=4.0,
            award_ratio_cap=0.25,
            waterfall_type="max",
        )

        assert invested == pytest.approx(50.0, abs=1.0)
        assert ret == pytest.approx(200.0, abs=1.0)

    def test_loss_path_zero_return(self):
        """LOSE path → total_return = 0, only legal costs outflow."""
        claim = _minimal_claim()
        pr = _lose_path(timeline=30.0, legal=40.0)

        dates, cfs, invested, ret = build_litigation_funding_cashflow(
            claim=claim,
            path_result=pr,
            cost_multiple_cap=3.0,
            award_ratio_cap=0.30,
            waterfall_type="min",
        )

        assert ret == 0.0
        assert invested == pytest.approx(40.0, abs=1.0)
        assert all(c <= 0 for c in cfs)  # Only outflows


# ============================================================================
# Upfront + Tail Cashflow Tests
# ============================================================================

class TestUpfrontTailCashflow:
    """Tests for build_upfront_tail_cashflow()."""

    def test_basic_win(self):
        """Upfront 10% of SOC=1000 → 100. Tail 20% → fund keeps 80%."""
        claim = _minimal_claim(soc=1000.0)
        pr = _win_path(timeline=24.0, collected=500.0, legal=50.0)

        dates, cfs, invested, ret = build_upfront_tail_cashflow(
            claim=claim,
            path_result=pr,
            upfront_pct=0.10,
            tail_pct=0.20,
            pricing_basis="soc",
        )

        expected_upfront = 100.0
        expected_return = 0.80 * 500.0  # = 400
        assert invested == pytest.approx(expected_upfront + 50.0, abs=1.0)
        assert ret == pytest.approx(expected_return, abs=1.0)

    def test_loss_no_return(self):
        """LOSE path → only upfront + legal costs, no return."""
        claim = _minimal_claim(soc=1000.0)
        pr = _lose_path(timeline=30.0, legal=40.0)

        dates, cfs, invested, ret = build_upfront_tail_cashflow(
            claim=claim,
            path_result=pr,
            upfront_pct=0.10,
            tail_pct=0.20,
        )

        assert ret == 0.0
        assert invested == pytest.approx(100.0 + 40.0, abs=1.0)


# ============================================================================
# Full Purchase Cashflow Tests
# ============================================================================

class TestFullPurchaseCashflow:
    """Tests for build_full_purchase_cashflow()."""

    def test_investor_bears_legal(self):
        """Investor buys claim for 200 Cr, bears all legal costs."""
        claim = _minimal_claim(soc=1000.0)
        pr = _win_path(timeline=24.0, collected=800.0, legal=60.0)

        dates, cfs, invested, ret = build_full_purchase_cashflow(
            claim=claim,
            path_result=pr,
            purchase_price_cr=200.0,
            legal_cost_bearer="investor",
            purchased_share_pct=1.0,
        )

        assert invested == pytest.approx(200.0 + 60.0, abs=1.0)
        assert ret == pytest.approx(800.0, abs=1.0)

    def test_claimant_bears_legal(self):
        """Claimant bears legal → investor only pays purchase price."""
        claim = _minimal_claim(soc=1000.0)
        pr = _win_path(timeline=24.0, collected=800.0, legal=60.0)

        dates, cfs, invested, ret = build_full_purchase_cashflow(
            claim=claim,
            path_result=pr,
            purchase_price_cr=200.0,
            legal_cost_bearer="claimant",
            purchased_share_pct=1.0,
        )

        assert invested == pytest.approx(200.0, abs=1.0)
        assert ret == pytest.approx(800.0, abs=1.0)


# ============================================================================
# Month-end helper Tests
# ============================================================================

class TestMonthEnd:
    """Tests for _month_end helper."""

    def test_same_month(self):
        base = datetime(2026, 4, 30)
        assert _month_end(base, 0) == datetime(2026, 4, 30)

    def test_one_month_ahead(self):
        base = datetime(2026, 4, 30)
        assert _month_end(base, 1) == datetime(2026, 5, 31)

    def test_december(self):
        base = datetime(2026, 4, 30)
        assert _month_end(base, 8) == datetime(2026, 12, 31)

    def test_cross_year(self):
        base = datetime(2026, 11, 30)
        result = _month_end(base, 2)
        assert result == datetime(2027, 1, 31)
