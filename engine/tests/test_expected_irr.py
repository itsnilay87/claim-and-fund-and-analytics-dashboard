"""
Tests for expected-cashflow IRR methodology (BUG-1 fix).

Validates that E[IRR] computed from the mean cashflow stream is:
  - Not dominated by -100% total-loss paths
  - Consistent with E[MOIC] given the average duration
  - Correct for edge cases (all-win, all-loss)

The old approach (arithmetic mean of per-path IRRs) is mathematically
incorrect because IRR is a non-linear function and -100% loss paths
dominate the arithmetic average.
"""

from __future__ import annotations

from datetime import datetime, timedelta

import numpy as np
import pytest

from engine.simulation.metrics import compute_xirr, merge_dated_cashflows


# ============================================================================
# Helper: compute expected-cashflow IRR from a list of per-path cashflows
# ============================================================================

def _expected_cashflow_irr(
    path_cashflows: list[tuple[list[datetime], list[float]]],
) -> float:
    """Compute IRR of the expected (mean) cashflow stream across paths.

    This mirrors the logic in compute_expected_cashflow_irr() and
    _compute_grid_cell() but operates on pre-built cashflow tuples
    for simpler test construction.
    """
    n_paths = len(path_cashflows)
    if n_paths == 0:
        return 0.0

    all_dates_set: set[datetime] = set()
    path_cf_dicts: list[dict[datetime, float]] = []

    for dates, cfs in path_cashflows:
        cf_dict: dict[datetime, float] = {}
        for d, cf in zip(dates, cfs):
            cf_dict[d] = cf_dict.get(d, 0.0) + cf
            all_dates_set.add(d)
        path_cf_dicts.append(cf_dict)

    if not all_dates_set:
        return 0.0

    sorted_dates = sorted(all_dates_set)
    expected_cfs: list[float] = []
    for d in sorted_dates:
        total = sum(pcf.get(d, 0.0) for pcf in path_cf_dicts)
        expected_cfs.append(total / n_paths)

    if len(sorted_dates) < 2:
        return 0.0

    return compute_xirr(sorted_dates, expected_cfs)


# ============================================================================
# Tests
# ============================================================================

class TestExpectedCashflowIRR:
    """Tests for the expected-cashflow IRR methodology."""

    def test_no_loss_skew(self):
        """E[IRR] from expected cashflows should not be dominated by -100% loss paths.

        Setup: 2-path scenario
        - Path 1: invest 100 at t=0, receive 300 at t=2years -> IRR ~ 73%
        - Path 2: invest 100 at t=0, receive 0 (total loss) -> IRR = -100%

        Wrong approach: mean(73%, -100%) = -13.5%
        Correct approach: expected cashflow = [-100, 150], XIRR should be positive
        """
        t0 = datetime(2026, 4, 30)
        t2 = t0 + timedelta(days=730)  # ~2 years

        path1 = ([t0, t2], [-100.0, 300.0])  # Big win
        path2 = ([t0, t2], [-100.0, 0.0])    # Total loss (only outflow)

        # Per-path IRRs (the wrong approach)
        irr_path1 = compute_xirr(*path1)
        irr_path2 = compute_xirr([t0], [-100.0])  # all-negative -> -1.0
        mean_of_path_irrs = (irr_path1 + (-1.0)) / 2.0

        # Expected-cashflow IRR (the correct approach)
        expected_irr = _expected_cashflow_irr([path1, path2])

        # The wrong approach gives negative (dominated by -100%)
        assert mean_of_path_irrs < 0.0, (
            f"Mean-of-path-IRRs should be negative, got {mean_of_path_irrs:.4f}"
        )

        # The correct approach gives a positive IRR
        assert expected_irr > 0.0, (
            f"Expected-cashflow IRR should be positive, got {expected_irr:.4f}"
        )

        # Expected cashflow: [-100, 150] over 2 years -> XIRR ~ 22.5%
        assert 0.15 <= expected_irr <= 0.35, (
            f"Expected-cashflow IRR {expected_irr:.4f} not in reasonable range"
        )

    def test_expected_irr_consistent_with_moic(self):
        """If E[MOIC] = 2.3x over ~5 years, E[IRR] should be ~15-25%, not negative.

        Setup: 100 paths, ~49% full loss, ~51% receive 4.5x return -> E[MOIC] ~ 2.3x
        """
        t0 = datetime(2026, 4, 30)
        t5 = t0 + timedelta(days=int(5 * 365.25))  # ~5 years

        n_paths = 1000
        rng = np.random.default_rng(42)

        path_cashflows = []
        total_return = 0.0
        total_invested = 0.0
        for i in range(n_paths):
            invested = 100.0
            if rng.random() < 0.49:
                # Loss path: invest 100, get 0
                ret = 0.0
            else:
                # Win path: invest 100, get ~450
                ret = 450.0

            total_invested += invested
            total_return += ret
            path_cashflows.append(([t0, t5], [-invested, ret]))

        e_moic = total_return / total_invested
        assert 2.0 <= e_moic <= 2.6, f"E[MOIC] = {e_moic:.2f} not in expected range"

        expected_irr = _expected_cashflow_irr(path_cashflows)

        # E[IRR] should be positive and consistent with E[MOIC]
        # For E[MOIC] ~ 2.3x over 5 years: (2.3)^(1/5) - 1 ~ 18%
        assert expected_irr > 0.10, (
            f"Expected-cashflow IRR should be > 10%, got {expected_irr:.4f}"
        )
        assert expected_irr < 0.30, (
            f"Expected-cashflow IRR should be < 30%, got {expected_irr:.4f}"
        )

    def test_all_win(self):
        """When P(Loss) = 0%, expected IRR should equal single-path IRR."""
        t0 = datetime(2026, 4, 30)
        t2 = t0 + timedelta(days=730)

        # All paths identical: invest 100, receive 150 in 2 years
        path_cashflows = [([t0, t2], [-100.0, 150.0]) for _ in range(100)]

        expected_irr = _expected_cashflow_irr(path_cashflows)
        single_irr = compute_xirr([t0, t2], [-100.0, 150.0])

        assert abs(expected_irr - single_irr) < 0.001, (
            f"All-win expected IRR {expected_irr:.4f} != single-path IRR {single_irr:.4f}"
        )

    def test_all_loss(self):
        """When P(Loss) = 100%, expected IRR should be -100%."""
        t0 = datetime(2026, 4, 30)
        t2 = t0 + timedelta(days=730)

        # All paths: invest 100, receive 0
        # Expected cashflow: [-100, 0] -> all outflows -> XIRR returns -1.0
        path_cashflows = [([t0, t2], [-100.0, 0.0]) for _ in range(100)]

        expected_irr = _expected_cashflow_irr(path_cashflows)

        assert expected_irr == -1.0, (
            f"All-loss expected IRR should be -1.0, got {expected_irr:.4f}"
        )

    def test_multi_claim_portfolio(self):
        """Expected-cashflow IRR works for merged multi-claim portfolios.

        Setup: 2-claim portfolio, each with different timelines
        """
        t0 = datetime(2026, 4, 30)
        t_claim1 = t0 + timedelta(days=365 * 3)   # Claim 1 resolves in 3y
        t_claim2 = t0 + timedelta(days=365 * 4)   # Claim 2 resolves in 4y

        path_cashflows = []
        for i in range(200):
            # Merge two claims for this path
            if i % 2 == 0:
                # Good outcome: both claims win
                claim1 = ([t0, t_claim1], [-50.0, 200.0])
                claim2 = ([t0, t_claim2], [-50.0, 150.0])
            else:
                # Bad outcome: both claims lose
                claim1 = ([t0, t_claim1], [-50.0, 0.0])
                claim2 = ([t0, t_claim2], [-50.0, 0.0])

            merged_dates, merged_cfs = merge_dated_cashflows([claim1, claim2])
            path_cashflows.append((merged_dates, merged_cfs))

        expected_irr = _expected_cashflow_irr(path_cashflows)

        # 50% win: expected investment = -100, expected return = 175
        # E[MOIC] = 175/100 = 1.75x over ~3.5 years
        # Expected IRR should be positive
        assert expected_irr > 0.05, (
            f"Multi-claim expected IRR should be positive, got {expected_irr:.4f}"
        )

    def test_different_timing_paths(self):
        """Paths with different resolution months should be handled correctly.

        The expected-cashflow approach must align dates across paths.
        """
        t0 = datetime(2026, 4, 30)
        t2 = t0 + timedelta(days=730)
        t3 = t0 + timedelta(days=1095)
        t4 = t0 + timedelta(days=1460)

        # Path 1: resolves at 2 years with 200 return
        # Path 2: resolves at 3 years with 250 return
        # Path 3: resolves at 4 years with 300 return
        path_cashflows = [
            ([t0, t2], [-100.0, 200.0]),
            ([t0, t3], [-100.0, 250.0]),
            ([t0, t4], [-100.0, 300.0]),
        ]

        expected_irr = _expected_cashflow_irr(path_cashflows)

        # All paths are profitable, so expected IRR should be solidly positive
        assert expected_irr > 0.10, (
            f"Expected IRR with profitable staggered paths should be > 10%, got {expected_irr:.4f}"
        )

    def test_single_path(self):
        """Single path: expected-cashflow IRR equals that path's IRR."""
        t0 = datetime(2026, 4, 30)
        t2 = t0 + timedelta(days=730)

        path_cashflows = [([t0, t2], [-100.0, 200.0])]

        expected_irr = _expected_cashflow_irr(path_cashflows)
        single_irr = compute_xirr([t0, t2], [-100.0, 200.0])

        assert abs(expected_irr - single_irr) < 0.001

    def test_high_loss_probability_still_positive(self):
        """With 80% loss but 10x return on wins, expected IRR should be positive.

        E[MOIC] = 0.8 * 0 + 0.2 * 10 = 2.0x
        """
        t0 = datetime(2026, 4, 30)
        t3 = t0 + timedelta(days=1095)  # 3 years

        path_cashflows = []
        for i in range(1000):
            if i < 800:
                # Loss
                path_cashflows.append(([t0, t3], [-100.0, 0.0]))
            else:
                # 10x return
                path_cashflows.append(([t0, t3], [-100.0, 1000.0]))

        expected_irr = _expected_cashflow_irr(path_cashflows)

        # E[MOIC] = 2.0x over 3 years -> (2.0)^(1/3) - 1 ~ 26%
        assert expected_irr > 0.15, (
            f"Expected IRR with E[MOIC]=2.0x should be > 15%, got {expected_irr:.4f}"
        )

        # Verify that mean-of-path-IRRs would be very negative
        irr_win = compute_xirr([t0, t3], [-100.0, 1000.0])
        mean_path_irr = 0.8 * (-1.0) + 0.2 * irr_win
        assert mean_path_irr < 0, (
            f"Mean-of-path-IRRs should be negative for this scenario, got {mean_path_irr:.4f}"
        )
