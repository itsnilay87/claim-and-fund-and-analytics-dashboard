"""
TATA_code_v2/v2_cashflow_builder.py — Monthly cashflow vector construction.
============================================================================

Builds dated cashflow vectors for one claim in one MC path,
given a specific (upfront_pct, award_share_pct) investment structure.

Cashflow convention:
  Negative = investor outflow (money going out)
  Positive = investor inflow  (money coming in)

All monetary values in ₹ Crore. All durations in months.
"""

from __future__ import annotations

import math
from datetime import datetime, timedelta
from typing import Optional

import numpy as np

from . import v2_master_inputs as MI
from .v2_config import ClaimConfig


# ===================================================================
# Helper: month-end date generator
# ===================================================================

def _month_end(base: datetime, months_ahead: int) -> datetime:
    """Return the last day of the month that is `months_ahead` from base.

    Parameters
    ----------
    base : datetime
        Anchor date (should be month-end already, e.g. 2026-04-30).
    months_ahead : int
        Number of months to advance.

    Returns
    -------
    datetime — last day of target month.
    """
    # Advance year/month
    total_months = base.month - 1 + months_ahead
    year = base.year + total_months // 12
    month = total_months % 12 + 1

    # Last day of that month
    if month == 12:
        return datetime(year, 12, 31)
    else:
        return datetime(year, month + 1, 1) - timedelta(days=1)


def _parse_start_date() -> datetime:
    """Parse MI.START_DATE string into datetime."""
    return datetime.strptime(MI.START_DATE, "%Y-%m-%d")


# ===================================================================
# Portfolio merge helpers
# ===================================================================

def merge_dated_cashflows(
    claims_data: list[tuple[list[datetime], list[float]]],
) -> tuple[list[datetime], list[float]]:
    """Merge multiple claims' dated cashflow vectors into a single portfolio vector.

    Each entry in *claims_data* is ``(dates, cashflows)`` as returned by
    :func:`build_cashflow`.  All claims are assumed to share the same
    START_DATE, so month-end dates from different claims align exactly.

    Returns
    -------
    (dates, cashflows) — the combined portfolio vector, sorted by date.
    """
    if not claims_data:
        return [], []

    cf_by_date: dict[datetime, float] = {}
    for dates, cfs in claims_data:
        for d, cf in zip(dates, cfs):
            cf_by_date[d] = cf_by_date.get(d, 0.0) + cf

    sorted_dates = sorted(cf_by_date.keys())
    sorted_cfs = [cf_by_date[d] for d in sorted_dates]
    return sorted_dates, sorted_cfs


def merge_monthly_cashflows(
    claim_cashflows: list[np.ndarray],
) -> np.ndarray:
    """Merge month-indexed cashflow arrays by padding to max length and summing.

    Parameters
    ----------
    claim_cashflows : list[np.ndarray]
        Each array is a monthly cashflow vector from :func:`build_cashflow_simple`.
        Index 0 = month 0, index N = month N.

    Returns
    -------
    np.ndarray — portfolio cashflow vector (length = max of input lengths).
    """
    if not claim_cashflows:
        return np.array([0.0])
    max_len = max(len(cf) for cf in claim_cashflows)
    merged = np.zeros(max_len)
    for cf in claim_cashflows:
        merged[:len(cf)] += cf
    return merged


def portfolio_day_fracs(n_months: int) -> np.ndarray:
    """Pre-compute day-fraction array for *n_months* month-end dates from START_DATE.

    Returns ``(date_i - date_0).days / 365.0`` for i in ``0..n_months-1``.
    Used by :func:`compute_xirr_from_dayfrac` for fast batch XIRR computation.
    """
    start = _parse_start_date()
    dates = [_month_end(start, m) for m in range(n_months)]
    d0 = dates[0]
    return np.array([(d - d0).days / 365.0 for d in dates], dtype=float)


# ===================================================================
# Main: build_cashflow
# ===================================================================

def build_cashflow(
    claim: ClaimConfig,
    total_duration_months: float,
    quantum_received_cr: float,
    monthly_legal_burn: np.ndarray,
    upfront_pct: float,
    award_share_pct: Optional[float] = None,
    pricing_basis: str = "soc",
    expected_quantum_cr: Optional[float] = None,
    tata_tail_pct: Optional[float] = None,
) -> tuple[list[datetime], list[float], float, float]:
    """Build dated cashflow vector for one claim/path/investment combo.

    Parameters
    ----------
    claim : ClaimConfig
        Claim configuration.
    total_duration_months : float
        Total months from investment to payment receipt (includes
        pre-arb + challenge tree + payment delay, and re-arb if applicable).
    quantum_received_cr : float
        Amount ultimately received by TATA (₹ Cr). 0 if loss.
    monthly_legal_burn : np.ndarray
        Monthly legal cost array from v2_legal_cost_model.
        Month 0 = one-time costs (tribunal+expert), month 1..N = stage burns.
    upfront_pct : float
        Upfront investment as fraction (e.g. 0.10 for 10%).
    award_share_pct : float, optional
        Investor's share of the received award (e.g. 0.40 for 40%).
        Mutually exclusive with tata_tail_pct.
    pricing_basis : str
        "soc" — upfront = upfront_pct × claim.soc_cr
        "eq"  — upfront = upfront_pct × E[quantum_cr]
    expected_quantum_cr : float, optional
        Required if pricing_basis="eq". Analytical E[Q] for pricing.
    tata_tail_pct : float, optional
        Tata's share of the award. Fund keeps (1 - tata_tail_pct).
        If provided, overrides award_share_pct.

    Returns
    -------
    (dates, cashflows, total_invested, total_return) where:
      dates       : list[datetime] — month-end dates from START_DATE
      cashflows   : list[float] — negative=out, positive=in
      total_invested : float — abs(sum of all outflows)
      total_return   : float — sum of all inflows
    """
    start_date = _parse_start_date()
    payment_month = max(int(math.ceil(total_duration_months)), 1)

    # --- Resolve fund's award share ---
    if tata_tail_pct is not None:
        fund_award_share = 1.0 - tata_tail_pct
    elif award_share_pct is not None:
        fund_award_share = award_share_pct
    else:
        fund_award_share = 0.40  # default

    # --- Upfront payment (month 0) ---
    if pricing_basis == "eq" and expected_quantum_cr is not None:
        upfront = upfront_pct * expected_quantum_cr
    else:
        upfront = upfront_pct * claim.soc_value_cr

    # Ensure upfront is positive
    upfront = max(upfront, 1e-6)

    # --- Legal cost spread ---
    # Legal costs run from month 0 through payment_month
    # (costs continue through enforcement/payment period)
    burn_length = len(monthly_legal_burn)
    # If burn is shorter than payment timeline, pad with last-stage rate
    # If longer, truncate (costs don't continue past payment)
    legal_costs_by_month = np.zeros(payment_month + 1)
    for i in range(min(burn_length, payment_month + 1)):
        legal_costs_by_month[i] = monthly_legal_burn[i]

    # --- Investor inflow at payment month ---
    investor_inflow = fund_award_share * quantum_received_cr

    # --- Build cashflow vector ---
    n_months = payment_month + 1
    cashflows = [0.0] * n_months
    dates = [_month_end(start_date, m) for m in range(n_months)]

    # Month 0: upfront + legal cost (both outflows)
    cashflows[0] = -upfront - legal_costs_by_month[0]

    # Months 1 through payment_month-1: legal costs only
    for m in range(1, payment_month):
        cashflows[m] = -legal_costs_by_month[m]

    # Payment month: legal cost (outflow) + investor share of award (inflow)
    cashflows[payment_month] = -legal_costs_by_month[payment_month] + investor_inflow

    # --- Totals ---
    total_invested = upfront + float(np.sum(legal_costs_by_month))
    total_return = investor_inflow

    return dates, cashflows, total_invested, total_return


# ===================================================================
# Lightweight: build_cashflow_simple (no dates, monthly indexed)
# ===================================================================

def build_cashflow_simple(
    claim: ClaimConfig,
    total_duration_months: float,
    quantum_received_cr: float,
    monthly_legal_burn: np.ndarray,
    upfront_pct: float,
    award_share_pct: Optional[float] = None,
    pricing_basis: str = "soc",
    expected_quantum_cr: Optional[float] = None,
    tata_tail_pct: Optional[float] = None,
) -> tuple[np.ndarray, float, float]:
    """Build monthly-indexed cashflow vector (no dates).

    Same logic as build_cashflow but returns np.ndarray indexed by month.
    Useful for monthly IRR computation.

    Parameters accept either award_share_pct or tata_tail_pct.
    If tata_tail_pct provided, fund_share = 1 - tata_tail_pct.

    Returns
    -------
    (cashflows_array, total_invested, total_return)
    """
    payment_month = max(int(math.ceil(total_duration_months)), 1)

    # Resolve fund's award share
    if tata_tail_pct is not None:
        fund_award_share = 1.0 - tata_tail_pct
    elif award_share_pct is not None:
        fund_award_share = award_share_pct
    else:
        fund_award_share = 0.40  # default

    # Upfront
    if pricing_basis == "eq" and expected_quantum_cr is not None:
        upfront = upfront_pct * expected_quantum_cr
    else:
        upfront = upfront_pct * claim.soc_value_cr

    upfront = max(upfront, 1e-6)

    # Legal costs
    burn_length = len(monthly_legal_burn)
    legal_costs_by_month = np.zeros(payment_month + 1)
    for i in range(min(burn_length, payment_month + 1)):
        legal_costs_by_month[i] = monthly_legal_burn[i]

    # Inflow
    investor_inflow = fund_award_share * quantum_received_cr

    # Build cashflow vector
    n_months = payment_month + 1
    cf = np.zeros(n_months)

    cf[0] = -upfront - legal_costs_by_month[0]
    for m in range(1, payment_month):
        cf[m] = -legal_costs_by_month[m]
    cf[payment_month] += -legal_costs_by_month[payment_month] + investor_inflow

    total_invested = upfront + float(np.sum(legal_costs_by_month))
    total_return = investor_inflow

    return cf, total_invested, total_return
