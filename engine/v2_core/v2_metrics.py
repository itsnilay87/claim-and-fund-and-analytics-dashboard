"""
TATA_code_v2/v2_metrics.py — XIRR, MOIC, Net Return, VaR, CVaR.
=================================================================

Pure numerical functions for return metrics.
No project imports. Only numpy and scipy.

Follows v1 src/metrics.py brentq-based IRR solver pattern but uses
date-based XIRR (actual/365 day-count) instead of monthly index.

Includes optimised compute_xirr_from_dayfrac() for batch XIRR computation
where day-fraction arrays are pre-computed and reused across multiple calls.

All monetary values assumed in ₹ Crore (caller's responsibility).
"""

from __future__ import annotations

from datetime import datetime, timedelta

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

    Parameters
    ----------
    dates : list[datetime]
        Date of each cashflow (month-end dates).
    cashflows : list[float]
        Cashflow at each date. Negative = outflow, positive = inflow.
    guess : float
        Initial guess for annual rate (default 10%).

    Returns
    -------
    float — annualized rate where NPV = 0.

    Edge cases:
      - All cashflows <= 0 (total loss): return -1.0
      - All cashflows >= 0: return 10.0 (capped)
      - No inflows at all: return -1.0
      - Single cashflow: return 0.0

    XIRR Formula:
      NPV(r) = Σ CF_i / (1 + r)^(d_i / 365)
      where d_i = (date_i - date_0).days

    Uses scipy.optimize.brentq for robustness.
    Bounds: [-0.50, 10.0] for annual rate.
    """
    if len(dates) != len(cashflows):
        raise ValueError(
            f"dates ({len(dates)}) and cashflows ({len(cashflows)}) must be same length"
        )
    if len(dates) < 2:
        return 0.0

    cf = np.array(cashflows, dtype=float)

    # Edge case: all non-positive (total loss)
    if np.all(cf <= 0):
        return -1.0

    # Edge case: all non-negative (infinite return — cap)
    if np.all(cf >= 0):
        return 10.0

    # Check there's at least one positive and one negative
    if not (np.any(cf > 0) and np.any(cf < 0)):
        return -1.0

    # Day fractions from first date
    d0 = dates[0]
    day_fracs = np.array([(d - d0).days / 365.0 for d in dates])

    def npv(r: float) -> float:
        """NPV at annual rate r using actual/365 day count."""
        if r <= -1.0:
            return float('inf')
        return float(np.sum(cf / (1.0 + r) ** day_fracs))

    # Bounds for brentq
    low = -0.50
    high = 10.0

    npv_low = npv(low)
    npv_high = npv(high)

    if npv_low * npv_high > 0:
        # No root in bounds
        return -1.0 if npv_low < 0 else 10.0

    try:
        r = scipy.optimize.brentq(npv, low, high, xtol=1e-8, maxiter=200)
        # Clamp to bounds
        return float(max(min(r, 10.0), -1.0))
    except (ValueError, RuntimeError):
        return -1.0


# ===================================================================
# 1b. XIRR from pre-computed day fractions (optimised for batch use)
# ===================================================================

def compute_xirr_from_dayfrac(
    day_fracs: np.ndarray,
    cashflows: np.ndarray,
) -> float:
    """Compute annualized XIRR from pre-computed day fractions and cashflows.

    Identical to compute_xirr() but skips date parsing.  Use this when the
    same date structure is reused across many cashflow vectors (e.g. the
    stochastic pricing grid where only upfront/inflow amounts change per combo
    while the month-end schedule stays constant within a path).

    Parameters
    ----------
    day_fracs : np.ndarray
        (date_i - date_0).days / 365.0 for each position.
    cashflows : np.ndarray
        Cashflow at each position.  Negative = outflow, positive = inflow.

    Returns
    -------
    float — annualized rate where NPV = 0.
    """
    cf = np.asarray(cashflows, dtype=float)

    if len(cf) < 2:
        return 0.0

    # Edge cases
    if np.all(cf <= 0):
        return -1.0
    if np.all(cf >= 0):
        return 10.0
    if not (np.any(cf > 0) and np.any(cf < 0)):
        return -1.0

    df = np.asarray(day_fracs, dtype=float)

    def npv(r: float) -> float:
        if r <= -1.0:
            return float('inf')
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
# 2. Monthly IRR (v1-compatible, for quick checks)
# ===================================================================

def compute_irr_monthly(cashflows: np.ndarray) -> float:
    """Compute annualized IRR from monthly cashflow vector (v1 pattern).

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

def compute_moic(total_invested: float, total_return: float) -> float:
    """MOIC = total_return / total_invested.

    Parameters
    ----------
    total_invested : float
        Sum of all outflows (positive number).
    total_return : float
        Sum of all inflows (positive number).

    Returns 0.0 if total_invested <= 0.
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

def compute_var(returns: np.ndarray, alpha: float = 0.01) -> float:
    """Value at Risk at alpha percentile.

    VaR_1% = np.percentile(returns, 1)
    99% of paths have return >= this value.
    """
    assert 0 < alpha < 1, f"alpha must be in (0,1), got {alpha}"
    return float(np.percentile(returns, alpha * 100))


# ===================================================================
# 6. CVaR — Conditional Value at Risk (Expected Shortfall)
# ===================================================================

def compute_cvar(returns: np.ndarray, alpha: float = 0.01) -> float:
    """Conditional VaR: mean of returns at or below VaR_alpha."""
    var = compute_var(returns, alpha)
    tail = returns[returns <= var]
    if len(tail) == 0:
        return var
    return float(tail.mean())
