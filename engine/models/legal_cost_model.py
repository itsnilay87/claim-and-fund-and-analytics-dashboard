"""
engine/models/legal_cost_model.py — Stage-based legal cost model.
=================================================================

Two cost categories:
  1. ONE-TIME costs (tribunal + expert) → paid at Month 0
  2. DURATION-BASED costs → total for stage, spread evenly over months
     with a stochastic ScaledBeta overrun multiplier.

Functions:
  build_monthly_legal_costs()  → (monthly_burn_array, total_legal_cost)
  compute_stage_cost()         → total cost for one stage with overrun

All monetary values in native currency (default ₹ Crore).
All durations in months. Never calls np.random.seed().
"""

from __future__ import annotations

from typing import Any

import numpy as np

from engine.config.schema import ClaimConfig, LegalCostConfig, StageConfig


# ============================================================================
# Overrun draw (ScaledBeta)
# ============================================================================

def _draw_overrun(legal_cost_config: LegalCostConfig, rng: np.random.Generator) -> float:
    """Draw multiplicative overrun factor from ScaledBeta distribution.

    Returns (1 + ε) where ε ~ ScaledBeta(α, β, low, high).

    With default parameters (α=2, β=5, low=-0.10, high=0.60):
      E[ε] = -0.10 + (2/7) × 0.70 = +0.10   (+10% mean overrun)
      E[factor] = 1.10
    """
    raw = rng.beta(legal_cost_config.overrun_alpha, legal_cost_config.overrun_beta)
    overrun = legal_cost_config.overrun_low + raw * (
        legal_cost_config.overrun_high - legal_cost_config.overrun_low
    )
    return 1.0 + overrun


# ============================================================================
# Compute cost for one stage
# ============================================================================

def compute_stage_cost(
    stage_name: str,
    duration_months: float,
    legal_cost_config: LegalCostConfig,
    rng: np.random.Generator,
) -> float:
    """Compute total cost for a named stage with stochastic overrun.

    Parameters
    ----------
    stage_name : str
        Stage identifier matching a key in legal_cost_config.per_stage_costs.
    duration_months : float
        Duration drawn for this stage.
    legal_cost_config : LegalCostConfig
        Legal cost parameters including per-stage ranges and overrun config.
    rng : np.random.Generator

    Returns
    -------
    float — total cost in currency Cr for this stage (base × overrun factor).
    """
    if duration_months <= 0:
        return 0.0

    stage_cfg = legal_cost_config.per_stage_costs.get(stage_name)
    if stage_cfg is None:
        return 0.0

    # Draw base cost uniformly within stage's legal cost range
    if stage_cfg.legal_cost_low == stage_cfg.legal_cost_high:
        base_cost = stage_cfg.legal_cost_low
    else:
        base_cost = float(rng.uniform(stage_cfg.legal_cost_low, stage_cfg.legal_cost_high))

    # Apply ScaledBeta overrun
    overrun_factor = _draw_overrun(legal_cost_config, rng)
    return base_cost * overrun_factor


# ============================================================================
# Build monthly legal cost vector
# ============================================================================

def build_monthly_legal_costs(
    claim: ClaimConfig,
    stage_durations: dict[str, float],
    challenge_stages: list[dict[str, Any]],
    rng: np.random.Generator,
) -> tuple[np.ndarray, float]:
    """Build monthly legal cost vector for a claim path.

    Parameters
    ----------
    claim : ClaimConfig
        Claim configuration (provides legal_costs config).
    stage_durations : dict[str, float]
        Pre-arbitration stage → duration_months from timeline draw.
    challenge_stages : list[dict]
        Post-arbitration stages from ChallengeResult.stages_traversed.
        Each dict has at least {"stage": str, "duration": float}.
    rng : np.random.Generator

    Returns
    -------
    tuple of (monthly_burn_array, total_legal_cost)

    Month 0 includes one-time costs (tribunal + expert).
    Subsequent months have duration-based costs spread evenly
    across each stage's duration, placed sequentially.
    """
    lc = claim.legal_costs

    # One-time costs at month 0
    onetime = lc.one_time_tribunal_cr + lc.one_time_expert_cr

    # Collect all stages: pre-arb + challenge tree
    all_stages: list[tuple[str, float]] = []
    for name, dur in stage_durations.items():
        if dur > 0:
            all_stages.append((name, dur))
    for cs in challenge_stages:
        dur = cs.get("duration", 0.0)
        if dur > 0:
            all_stages.append((cs["stage"], dur))

    # Total timeline
    total_dur = sum(dur for _, dur in all_stages)
    T = max(int(np.ceil(total_dur)), 1)

    # Monthly array: month 0 = one-time, months 1..T = stage burns
    monthly = np.zeros(T + 1)
    monthly[0] = onetime

    month_cursor = 0
    total_duration_based = 0.0

    for stage_name, dur in all_stages:
        stage_cost = compute_stage_cost(stage_name, dur, lc, rng)
        total_duration_based += stage_cost

        if stage_cost <= 0:
            month_cursor += max(int(np.ceil(dur)), 1)
            continue

        n_months = max(int(np.ceil(dur)), 1)
        monthly_rate = stage_cost / n_months

        for i in range(n_months):
            month_idx = month_cursor + 1 + i  # +1 offset: month 0 is one-time
            if month_idx < len(monthly):
                monthly[month_idx] += monthly_rate

        month_cursor += n_months

    total_legal_cost = onetime + total_duration_based
    return monthly, total_legal_cost
