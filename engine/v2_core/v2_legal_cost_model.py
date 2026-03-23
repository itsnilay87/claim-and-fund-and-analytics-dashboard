"""
TATA_code_v2/v2_legal_cost_model.py — Stage-based legal cost model (v2).
=========================================================================

Redesigned model with two cost categories:
  1. ONE-TIME costs (tribunal + expert) → paid at Month 0
  2. DURATION-BASED costs → total for stage, spread evenly over months

SLP costs are stochastic: depend on SLP admission/dismissal from
the probability tree traversal.

Functions:
  get_onetime_costs()                  → total one-time costs per claim (₹ Cr)
  compute_stage_cost(stage, dur, ...)  → total cost for one stage (₹ Cr)
  compute_monthly_burn(stage, cost, d) → monthly burn rate for a stage
  build_monthly_legal_costs(...)       → (monthly_array, total) for one claim

All monetary values in ₹ Crore. All durations in months.
Never calls np.random.seed(). Every random function takes
rng: np.random.Generator as final argument.
"""

from __future__ import annotations

from typing import Optional, Tuple

import numpy as np

from . import v2_master_inputs as MI


# ===================================================================
# Stage name mapping
# ===================================================================
# Maps pipeline stage names to keys in MI.LEGAL_COSTS["duration_based"]

_STAGE_KEY_MAP: dict[str, str] = {
    "dab":           "dab",
    "arbitration":   "arb_counsel",
    "arb_remaining": "arb_counsel",    # Same rate, prorated by actual duration
    "re_referral":   "dab",            # Re-referral uses DAB rates
    "s34":           "s34",
    "s37":           "s37",
    # SLP is handled specially (depends on slp_admitted)
    "hc":            "siac_hc",
    "coa":           "siac_coa",
    "siac_hc":       "siac_hc",
    "siac_coa":      "siac_coa",
    # Re-arbitration uses arbitration rate
    "re_arbitration": "arb_counsel",
    # Post-re-arb challenge stages (same rates as initial challenge)
    "post_rearb_s34":  "s34",
    "post_rearb_s37":  "s37",
    # post_rearb_slp handled specially like slp
    "post_rearb_hc":   "siac_hc",
    "post_rearb_coa":  "siac_coa",
    # HKIAC stages
    "hk_cfi":          "hk_cfi",
    "hk_ca":           "hk_ca",
    "hk_cfa":          "hk_cfa",
    # Post-re-arb HKIAC challenge stages (same rates as initial)
    "post_rearb_hk_cfi": "hk_cfi",
    "post_rearb_hk_ca":  "hk_ca",
    "post_rearb_hk_cfa": "hk_cfa",
}
"""Mapping from stage names used in pipeline/challenge to LEGAL_COSTS keys."""


# ===================================================================
# One-Time Costs
# ===================================================================

def get_onetime_costs() -> float:
    """Return total one-time costs (tribunal + expert) per claim.

    Returns
    -------
    float — ₹ Crore. Paid at Month 0 for each claim.
    """
    onetime = MI.LEGAL_COSTS["onetime"]
    return float(onetime["tribunal"]) + float(onetime["expert"])


# ===================================================================
# Overrun Draw (v1 ScaledBeta pattern)
# ===================================================================

def _draw_overrun(rng: np.random.Generator) -> float:
    """Draw multiplicative overrun factor from ScaledBeta distribution.

    Returns (1 + ε) where ε ~ ScaledBeta(α, β, low, high).

    Using master_inputs parameters:
      α=2, β=5, low=-0.10, high=0.60
      E[ε] = -0.10 + (2/7) × 0.70 = +0.10 (+10% mean overrun)
      E[factor] = 1.10
    """
    params = MI.LEGAL_COST_OVERRUN
    alpha = params["alpha"]
    beta_param = params["beta"]
    low = params["low"]
    high = params["high"]

    raw = rng.beta(alpha, beta_param)
    overrun = low + raw * (high - low)
    return 1.0 + overrun


def _expected_overrun_factor() -> float:
    """Return E[1 + ε] analytically."""
    params = MI.LEGAL_COST_OVERRUN
    e_eps = params["low"] + (
        params["alpha"] / (params["alpha"] + params["beta"])
    ) * (params["high"] - params["low"])
    return 1.0 + e_eps


# ===================================================================
# Base Cost Lookup
# ===================================================================

def _get_base_cost(key: str) -> float:
    """Look up base cost for a duration-based stage key.

    For fixed values (float), returns the value directly.
    For ranges (dict with low/high), returns the midpoint.

    Parameters
    ----------
    key : str
        Key into MI.LEGAL_COSTS["duration_based"].

    Returns
    -------
    float — base total cost in ₹ Crore for the stage.
    """
    db = MI.LEGAL_COSTS["duration_based"]
    val = db[key]
    if isinstance(val, dict):
        # Range: use midpoint
        return (val["low"] + val["high"]) / 2.0
    return float(val)


# ===================================================================
# Compute Cost for One Stage
# ===================================================================

def compute_stage_cost(
    stage: str,
    duration_months: float,
    slp_admitted: Optional[bool] = None,
    rng: Optional[np.random.Generator] = None,
) -> float:
    """Compute total cost for a stage.

    Parameters
    ----------
    stage : str
        One of 'dab', 'arbitration', 'arb_remaining', 's34', 's37',
        'slp', 'siac_hc', 'siac_coa', 'hc', 'coa', 're_referral',
        're_arbitration'.
    duration_months : float
        Duration drawn for this stage.
    slp_admitted : bool, optional
        For 'slp' stage only — True if admitted (₹2-3Cr), False if
        dismissed (₹50L-₹1Cr). Required when stage='slp'.
    rng : np.random.Generator, optional
        If provided, applies stochastic overrun. If None, uses
        deterministic base cost (midpoint of range).

    Returns
    -------
    float — total cost in ₹ Crore for this stage.
    """
    if duration_months <= 0:
        return 0.0

    # --- SLP is handled specially ---
    if stage in ("slp", "post_rearb_slp"):
        if slp_admitted is True:
            base = _get_base_cost("slp_admitted")
        elif slp_admitted is False:
            base = _get_base_cost("slp_dismissed")
        else:
            # Default: assume dismissed (conservative)
            base = _get_base_cost("slp_dismissed")
    else:
        # Normal stage lookup
        key = _STAGE_KEY_MAP.get(stage)
        if key is None:
            # Unknown stage — zero cost
            return 0.0
        base = _get_base_cost(key)

    # Apply stochastic overrun if rng provided
    if rng is not None:
        overrun = _draw_overrun(rng)
        return base * overrun
    return base


def compute_monthly_burn(
    stage: str,
    total_cost: float,
    duration_months: float,
) -> float:
    """Return monthly burn rate for a stage.

    Parameters
    ----------
    stage : str
        Stage identifier (for documentation).
    total_cost : float
        Total cost for the stage in ₹ Crore.
    duration_months : float
        Duration of the stage in months.

    Returns
    -------
    float — monthly burn rate (₹ Crore / month).
    """
    if duration_months > 0:
        return total_cost / duration_months
    return 0.0


# ===================================================================
# Build Monthly Legal Cost Vector
# ===================================================================

def build_monthly_legal_costs(
    claim_id: str,
    stage_durations: dict[str, float],
    slp_admitted: Optional[bool] = None,
    rng: Optional[np.random.Generator] = None,
) -> Tuple[np.ndarray, float]:
    """Build monthly legal cost vector for a claim path.

    Parameters
    ----------
    claim_id : str
        Claim identifier (for logging/documentation).
    stage_durations : dict[str, float]
        Dict of stage → duration_months from timeline + challenge draw.
        e.g. {"dab": 9.5, "arbitration": 22.1, "s34": 14.0, "s37": 9.0, "slp": 4.0}
    slp_admitted : bool, optional
        Whether SLP was admitted (affects SLP cost). None for SIAC or
        paths without SLP stage.
    rng : np.random.Generator, optional
        If provided, applies stochastic overrun to each stage.
        If None, uses deterministic base costs.

    Returns
    -------
    Tuple of (monthly_costs: np.ndarray, total_legal_cost: float)

    Month 0 includes one-time costs (tribunal + expert).
    Subsequent months have duration-based costs spread evenly across
    each stage's duration, placed sequentially.
    """
    # One-time costs at month 0
    onetime = get_onetime_costs()

    # Compute total timeline
    total_months = sum(
        dur for stage, dur in stage_durations.items()
        if stage != "challenge_tree" or dur > 0
    )
    T = max(int(np.ceil(total_months)), 2)

    # Array: month 0 = one-time, months 1..T = duration-based burns
    monthly = np.zeros(T + 1)
    monthly[0] = onetime

    # Place duration-based costs sequentially
    month_cursor = 0  # tracks start month for each stage
    total_duration_based = 0.0

    for stage, dur in stage_durations.items():
        if stage == "challenge_tree" and dur == 0.0:
            continue
        if dur <= 0:
            continue

        # Compute total cost for this stage
        # Determine SLP admission per stage: original slp uses passed flag,
        # post_rearb_slp auto-detects from duration
        if stage == "slp":
            stage_slp = slp_admitted
        elif stage == "post_rearb_slp":
            # Post-re-arb SLP: infer admission from duration
            stage_slp = (dur >= MI.SLP_ADMITTED_DURATION) if dur > 0 else None
        else:
            stage_slp = None

        stage_cost = compute_stage_cost(
            stage=stage,
            duration_months=dur,
            slp_admitted=stage_slp,
            rng=rng,
        )

        total_duration_based += stage_cost

        if stage_cost <= 0:
            month_cursor += max(int(np.ceil(dur)), 1)
            continue

        # Spread evenly over stage months
        n_months = max(int(np.ceil(dur)), 1)
        monthly_rate = stage_cost / n_months

        for i in range(n_months):
            # +1 offset because month 0 is reserved for one-time costs
            month_idx = month_cursor + 1 + i
            if month_idx < len(monthly):
                monthly[month_idx] += monthly_rate

        month_cursor += n_months

    total_legal_cost = onetime + total_duration_based
    return monthly, total_legal_cost


# ===================================================================
# Expected Legal Costs (analytical, for pricing)
# ===================================================================

def compute_expected_total_legal_cost(
    claim_id: str,
    stage_durations: dict[str, float],
    slp_admitted: Optional[bool] = None,
) -> float:
    """Compute expected total legal costs for one claim (deterministic).

    Uses midpoint of ranges and E[overrun] analytically.

    Parameters
    ----------
    claim_id : str
    stage_durations : dict[str, float]
    slp_admitted : bool, optional

    Returns
    -------
    float — expected total in ₹ Crore, accounting for mean overrun.
    """
    onetime = get_onetime_costs()
    e_factor = _expected_overrun_factor()

    total = onetime  # no overrun on one-time costs

    for stage, dur in stage_durations.items():
        if stage == "challenge_tree" and dur == 0.0:
            continue
        if dur <= 0:
            continue

        # Get deterministic base cost (no overrun, no rng)
        base = compute_stage_cost(
            stage=stage,
            duration_months=dur,
            slp_admitted=slp_admitted if stage == "slp" else None,
            rng=None,  # deterministic
        )
        total += base * e_factor

    return total


# ===================================================================
# Backward Compatibility: load_legal_costs
# ===================================================================

def load_legal_costs(filepath: str | None = None) -> dict:
    """Backward-compatible stub.

    The new model uses MI.LEGAL_COSTS directly (no per-claim Excel file).
    Returns a sentinel dict so callers that pass cost_table don't crash.
    """
    return {"__new_model__": True}


# ===================================================================
# Backward Compatibility: build_monthly_legal_burn
# ===================================================================

def build_monthly_legal_burn(
    claim_id: str,
    stage_durations: dict[str, float],
    rng: np.random.Generator,
    cost_table: dict | None = None,
    slp_admitted: Optional[bool] = None,
) -> np.ndarray:
    """Backward-compatible wrapper around build_monthly_legal_costs.

    Returns just the monthly array (not the total).
    Added slp_admitted parameter for new model.
    """
    monthly, _ = build_monthly_legal_costs(
        claim_id=claim_id,
        stage_durations=stage_durations,
        slp_admitted=slp_admitted,
        rng=rng,
    )
    return monthly


# ===================================================================
# Validation
# ===================================================================

def validate_legal_costs() -> None:
    """Verify legal cost configuration is self-consistent."""

    # Verify LEGAL_COSTS structure exists
    assert "onetime" in MI.LEGAL_COSTS, "Missing 'onetime' in LEGAL_COSTS"
    assert "duration_based" in MI.LEGAL_COSTS, "Missing 'duration_based' in LEGAL_COSTS"

    onetime = MI.LEGAL_COSTS["onetime"]
    assert "tribunal" in onetime, "Missing 'tribunal' in LEGAL_COSTS.onetime"
    assert "expert" in onetime, "Missing 'expert' in LEGAL_COSTS.onetime"
    assert onetime["tribunal"] > 0, "tribunal cost must be > 0"
    assert onetime["expert"] > 0, "expert cost must be > 0"

    db = MI.LEGAL_COSTS["duration_based"]
    required_keys = [
        "dab", "arb_counsel", "s34", "s37",
        "slp_dismissed", "slp_admitted",
        "siac_hc", "siac_coa",
    ]
    for key in required_keys:
        assert key in db, f"Missing '{key}' in LEGAL_COSTS.duration_based"

    # Verify overrun parameters
    params = MI.LEGAL_COST_OVERRUN
    assert params["alpha"] > 0 and params["beta"] > 0, "Overrun alpha/beta must be > 0"
    assert params["low"] < params["high"], "Overrun low must be < high"

    # Verify E[overrun] is reasonable
    e_overrun = params["low"] + (
        params["alpha"] / (params["alpha"] + params["beta"])
    ) * (params["high"] - params["low"])
    assert -0.5 < e_overrun < 1.0, (
        f"E[overrun] = {e_overrun:.4f} outside [-0.5, 1.0]"
    )


# Run on import
validate_legal_costs()
