"""
v2_settlement.py — Game-Theoretic Settlement Computation
=========================================================

Implements backward induction on the probability tree to compute Nash Bargaining
settlement discount factors. Used when SETTLEMENT_MODE == "game_theoretic".

Functions:
  compute_continuation_values(jurisdiction, arb_won, expected_quantum_cr, soc_value_cr)
      → dict[stage_name, {"v_claimant": float, "v_respondent": float}]

  compute_game_theoretic_discounts(jurisdiction, arb_won, expected_quantum_cr, soc_value_cr, bargaining_power)
      → dict[stage_name, float]  (discount factor δ* per stage)

Mathematical basis:
  δ*_s = α × V_C(s) + (1 - α) × V_R(s)
  where α = bargaining_power (0.5 = symmetric NBS)
  V_C(s) = claimant's expected payoff from continuing from stage s onward
  V_R(s) = respondent's expected cost avoided by settling at stage s
"""

from __future__ import annotations

from typing import Optional

from . import v2_master_inputs as MI


# ── Jurisdiction → stage ordering ──────────────────────────────────

_DOMESTIC_STAGES = ["s34", "s37", "slp"]
_SIAC_STAGES = ["hc", "coa"]
_HKIAC_STAGES = ["cfi", "ca", "cfa"]


def _get_stages(jurisdiction: str) -> list[str]:
    """Return ordered post-award challenge stages for a jurisdiction."""
    jur = jurisdiction.lower()
    if jur in ("domestic", "indian_domestic"):
        return list(_DOMESTIC_STAGES)
    elif jur in ("siac", "siac_singapore"):
        return list(_SIAC_STAGES)
    elif jur in ("hkiac", "hkiac_hongkong"):
        return list(_HKIAC_STAGES)
    return list(_DOMESTIC_STAGES)  # fallback


# ── Compute survival probabilities from path tables ────────────────

def _survival_prob_from_paths(paths: list[dict]) -> float:
    """Compute P(TRUE_WIN) from a set of conditional-probability paths."""
    return sum(p["conditional_prob"] for p in paths if p["outcome"] == "TRUE_WIN")


def _get_paths(jurisdiction: str, arb_won: bool) -> list[dict]:
    """Get the path table for a jurisdiction + scenario."""
    jur = jurisdiction.lower()
    if jur in ("domestic", "indian_domestic"):
        return MI.DOMESTIC_PATHS_A if arb_won else MI.DOMESTIC_PATHS_B
    elif jur in ("siac", "siac_singapore"):
        return MI.SIAC_PATHS_A if arb_won else MI.SIAC_PATHS_B
    elif jur in ("hkiac", "hkiac_hongkong"):
        return MI.HKIAC_PATHS_A if arb_won else MI.HKIAC_PATHS_B
    return MI.DOMESTIC_PATHS_A if arb_won else MI.DOMESTIC_PATHS_B


def _expected_quantum_fraction() -> float:
    """E[q% | arb win] from QUANTUM_BANDS."""
    return sum(
        band["probability"] * (band["low"] + band["high"]) / 2.0
        for band in MI.QUANTUM_BANDS
    )


# ── Continuation values via backward induction ─────────────────────

def compute_continuation_values(
    jurisdiction: str,
    arb_won: Optional[bool],
    expected_quantum_cr: float,
    soc_value_cr: float,
) -> dict[str, dict[str, float]]:
    """Compute V_C(s) and V_R(s) at each stage via backward induction.

    Args:
        jurisdiction: "domestic", "siac", "hkiac" etc.
        arb_won: True (post-award won), False (post-award lost), None (pre-award).
        expected_quantum_cr: Expected quantum in ₹Cr.
        soc_value_cr: Statement of Claim value in ₹Cr.

    Returns:
        Dict mapping stage_name → {"v_claimant": float, "v_respondent": float}
        Values are in ₹Cr.
    """
    if arb_won is None:
        # Pre-award: single synthetic stage "arbitration"
        eq_frac = _expected_quantum_fraction()
        v_c = soc_value_cr * eq_frac * MI.ARB_WIN_PROBABILITY
        v_r = v_c  # respondent's expected payout = claimant's expected recovery
        return {"arbitration": {"v_claimant": v_c, "v_respondent": v_r}}

    stages = _get_stages(jurisdiction)
    paths = _get_paths(jurisdiction, arb_won)

    if not paths:
        return {}

    # Terminal value: P(TRUE_WIN) × Q_ref
    p_win = _survival_prob_from_paths(paths)

    if arb_won:
        # Claimant holds the award; Q_ref = expected_quantum_cr
        q_ref = expected_quantum_cr
    else:
        # Claimant lost; Q_ref is based on re-arb expectations
        eq_frac = _expected_quantum_fraction()
        q_ref = soc_value_cr * eq_frac * MI.RE_ARB_WIN_PROBABILITY

    # Backward induction: assign continuation values per stage.
    # V_C(last stage) = P(win from here) × Q_ref  (simplified)
    # V_R(last stage) = V_C (what respondent expects to pay)
    # For earlier stages, V_C(s) = P(survive stage s) × V_C(s+1) + P(lose at s) × 0

    # Approximate stage-specific survival probabilities
    # by distributing overall P(win) across stages
    n_stages = len(stages)
    if n_stages == 0:
        return {}

    # Per-stage survival: approximate as p_win^(1/n) per stage
    if p_win > 0:
        per_stage_survival = p_win ** (1.0 / n_stages)
    else:
        per_stage_survival = 0.0

    result = {}
    # Backward: compute from last stage to first
    v_c_next = p_win * q_ref  # terminal expected value
    for i in range(n_stages - 1, -1, -1):
        stage = stages[i]
        # V_C at this stage = expected value looking forward
        # Stages remaining from here = n_stages - i
        remaining_fraction = (n_stages - i) / n_stages
        v_c = (per_stage_survival ** (n_stages - i)) * q_ref
        v_r = v_c  # symmetric: respondent expects to pay what claimant expects to receive
        result[stage] = {"v_claimant": v_c, "v_respondent": v_r}

    return result


def compute_game_theoretic_discounts(
    jurisdiction: str,
    arb_won: Optional[bool],
    expected_quantum_cr: float,
    soc_value_cr: float,
    bargaining_power: float = 0.5,
) -> dict[str, float]:
    """Compute Nash Bargaining discount factor δ* per stage.

    δ*_s = (α × V_C(s) + (1 - α) × V_R(s)) / Q_ref

    Args:
        jurisdiction: "domestic", "siac", "hkiac" etc.
        arb_won: True (post-award won), False (post-award lost), None (pre-award).
        expected_quantum_cr: Expected quantum in ₹Cr.
        soc_value_cr: Statement of Claim value in ₹Cr.
        bargaining_power: α ∈ (0, 1), default 0.5 (symmetric NBS).

    Returns:
        Dict mapping stage_name → δ* (float in [0, 1]).
    """
    cont_vals = compute_continuation_values(
        jurisdiction=jurisdiction,
        arb_won=arb_won,
        expected_quantum_cr=expected_quantum_cr,
        soc_value_cr=soc_value_cr,
    )

    if not cont_vals:
        return {}

    # Determine Q_ref for normalisation
    if arb_won is None:
        eq_frac = _expected_quantum_fraction()
        q_ref = soc_value_cr * eq_frac * MI.ARB_WIN_PROBABILITY
    elif arb_won:
        q_ref = expected_quantum_cr
    else:
        eq_frac = _expected_quantum_fraction()
        q_ref = soc_value_cr * eq_frac * MI.RE_ARB_WIN_PROBABILITY

    if q_ref <= 0:
        return {}

    alpha = max(0.0, min(1.0, bargaining_power))
    result = {}
    for stage, vals in cont_vals.items():
        v_c = vals["v_claimant"]
        v_r = vals["v_respondent"]
        delta_star = (alpha * v_c + (1.0 - alpha) * v_r) / q_ref
        # Clamp to [0, 1]
        delta_star = max(0.0, min(1.0, delta_star))
        result[stage] = delta_star

    return result
