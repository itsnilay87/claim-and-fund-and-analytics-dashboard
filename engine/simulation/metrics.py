"""
engine/simulation/metrics.py — XIRR, MOIC, VaR, CVaR, and portfolio analytics.
================================================================================

Pure numerical functions for investment return metrics.
No project imports. Only numpy and scipy.

Ported from TATA_code_v2/v2_metrics.py with enhancements:
  - compute_xirr()           — date-based XIRR (actual/365)
  - compute_xirr_from_dayfrac() — optimised batch version
  - compute_irr_monthly()    — monthly-indexed IRR (annualized)
  - compute_moic()           — Multiple on Invested Capital
  - compute_var()            — Value at Risk
  - compute_cvar()           — Conditional VaR (Expected Shortfall)
  - merge_dated_cashflows()  — portfolio-level cashflow merger

All monetary values assumed in ₹ Crore (caller's responsibility).
"""

from __future__ import annotations

from datetime import datetime
from typing import Union

import numpy as np
import scipy.optimize


# ===================================================================
# 1. XIRR — Extended Internal Rate of Return (date-based)
# ===================================================================

def compute_xirr(
    dates: list[datetime],
    cashflows: list[float],
    guess: float = 0.10,
) -> float:
    """Compute annualized XIRR from dated cashflows.

    XIRR Formula:
      NPV(r) = Σ CF_i / (1 + r)^(d_i / 365) = 0
      where d_i = (date_i - date_0).days

    Uses scipy.optimize.brentq for robustness.
    Bounds: [-0.50, 10.0] for annual rate.

    Edge cases:
      - All cashflows <= 0 (total loss): return -1.0
      - All cashflows >= 0: return 10.0 (capped)
      - <2 cashflows: return 0.0
    """
    if len(dates) != len(cashflows):
        raise ValueError(
            f"dates ({len(dates)}) and cashflows ({len(cashflows)}) must be same length"
        )
    if len(dates) < 2:
        return 0.0

    cf = np.array(cashflows, dtype=float)

    if np.all(cf <= 0):
        return -1.0
    if np.all(cf >= 0):
        return 10.0
    if not (np.any(cf > 0) and np.any(cf < 0)):
        return -1.0

    d0 = dates[0]
    day_fracs = np.array([(d - d0).days / 365.0 for d in dates])

    def npv(r: float) -> float:
        if r <= -1.0:
            return float("inf")
        return float(np.sum(cf / (1.0 + r) ** day_fracs))

    low = -0.50
    high = 10.0

    npv_low = npv(low)
    npv_high = npv(high)

    if npv_low * npv_high > 0:
        return -1.0 if npv_low < 0 else 10.0

    try:
        r = scipy.optimize.brentq(npv, low, high, xtol=1e-8, maxiter=200)
        return float(max(min(r, 10.0), -1.0))
    except (ValueError, RuntimeError):
        return -1.0


# ===================================================================
# 1b. XIRR from pre-computed day fractions (batch optimised)
# ===================================================================

def compute_xirr_from_dayfrac(
    day_fracs: np.ndarray,
    cashflows: np.ndarray,
) -> float:
    """Compute annualized XIRR from pre-computed day fractions.

    Identical to compute_xirr() but skips date parsing.  Use when the
    same date structure is reused across many cashflow vectors.
    """
    cf = np.asarray(cashflows, dtype=float)

    if len(cf) < 2:
        return 0.0
    if np.all(cf <= 0):
        return -1.0
    if np.all(cf >= 0):
        return 10.0
    if not (np.any(cf > 0) and np.any(cf < 0)):
        return -1.0

    df = np.asarray(day_fracs, dtype=float)

    def npv(r: float) -> float:
        if r <= -1.0:
            return float("inf")
        return float(np.sum(cf / (1.0 + r) ** df))

    low = -0.50
    high = 10.0

    npv_low = npv(low)
    npv_high = npv(high)

    if npv_low * npv_high > 0:
        return -1.0 if npv_low < 0 else 10.0

    try:
        r = scipy.optimize.brentq(npv, low, high, xtol=1e-8, maxiter=200)
        return float(max(min(r, 10.0), -1.0))
    except (ValueError, RuntimeError):
        return -1.0


# ===================================================================
# 2. Monthly IRR (annualized)
# ===================================================================

def compute_irr_monthly(cashflows: Union[list[float], np.ndarray]) -> float:
    """Compute annualized IRR from monthly cashflow vector.

    cashflows[0] = outflow at month 0 (negative)
    cashflows[T] = inflow at resolution month (positive)

    Uses brentq on monthly NPV, then annualizes: (1 + r_m)^12 - 1.
    """
    cf = np.asarray(cashflows, dtype=float)

    if np.all(cf <= 0):
        return -1.0
    if np.all(cf >= 0):
        return 10.0

    def npv(r_monthly: float) -> float:
        t = np.arange(len(cf))
        return float(np.sum(cf / (1.0 + r_monthly) ** t))

    low = -0.999 / 12.0   # ~-0.0833 monthly
    high = 10.0 / 12.0    # ~0.833 monthly

    npv_low = npv(low)
    npv_high = npv(high)

    if npv_low * npv_high > 0:
        return -1.0 if npv_low < 0 else 10.0

    try:
        r_monthly = scipy.optimize.brentq(npv, low, high, xtol=1e-8, maxiter=200)
        annual = (1.0 + r_monthly) ** 12 - 1.0
        return float(annual)
    except (ValueError, RuntimeError):
        return -1.0


# ===================================================================
# 3. MOIC — Multiple on Invested Capital
# ===================================================================

def compute_moic(total_return: float, total_invested: float) -> float:
    """MOIC = total_return / total_invested.

    Guard: if total_invested <= 0, return 0.0.
    """
    if total_invested <= 0:
        return 0.0
    return total_return / total_invested


# ===================================================================
# 4. Net Return
# ===================================================================

def compute_net_return(total_return: float, total_invested: float) -> float:
    """Net return = total_return - total_invested (₹ Crore)."""
    return total_return - total_invested


# ===================================================================
# 5. VaR — Value at Risk
# ===================================================================

def compute_var(values: np.ndarray, alpha: float = 0.01) -> float:
    """Value at Risk at alpha percentile.

    VaR_1% = np.percentile(values, 1)
    99% of paths have return >= this value.
    """
    assert 0 < alpha < 1, f"alpha must be in (0,1), got {alpha}"
    return float(np.percentile(values, alpha * 100))


# ===================================================================
# 6. CVaR — Conditional Value at Risk (Expected Shortfall)
# ===================================================================

def compute_cvar(values: np.ndarray, alpha: float = 0.01) -> float:
    """Conditional VaR: mean of values at or below VaR_alpha."""
    var = compute_var(values, alpha)
    tail = values[values <= var]
    if len(tail) == 0:
        return var
    return float(tail.mean())


# ===================================================================
# 7. Merge Dated Cashflows (portfolio-level)
# ===================================================================

def merge_dated_cashflows(
    all_dated_cfs: list[tuple[list[datetime], list[float]]],
) -> tuple[list[datetime], list[float]]:
    """Merge multiple claims' dated cashflows by aligning dates and summing.

    Each entry is (dates, cashflows) from a per-claim cashflow builder.
    Returns a single (dates, cashflows) tuple sorted by date.
    """
    if not all_dated_cfs:
        return [], []

    cf_by_date: dict[datetime, float] = {}
    for dates, cfs in all_dated_cfs:
        for d, cf in zip(dates, cfs):
            cf_by_date[d] = cf_by_date.get(d, 0.0) + cf

    sorted_dates = sorted(cf_by_date.keys())
    sorted_cfs = [cf_by_date[d] for d in sorted_dates]
    return sorted_dates, sorted_cfs
