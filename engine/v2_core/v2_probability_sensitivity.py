"""
TATA_code_v2/v2_probability_sensitivity.py — Probability shift sensitivity analysis.
======================================================================================

Analytically computes how shifting key probability parameters affects
investment metrics WITHOUT re-running Monte Carlo simulation.

Approach: analytical probability reweighting + MC-conditioned expectations.
  1. Partition existing MC paths by (arb_won, challenge_outcome, final_outcome)
  2. Compute conditional E[collected], E[legal_cost], E[MOIC], P(loss) per partition
  3. For each shift δ, analytically recompute partition probabilities
  4. Reweight to get shifted metrics: E[MOIC|shifted] = Σ P_shifted(k) × E[MOIC|k]

Four shift categories:
  arb_win  — shift P(arb WIN) and P(re-arb WIN) by δ
  court    — shift ALL favorable court-node probabilities by δ
  quantum  — exponential tilt of quantum band mass (higher/lower bands)
  combined — all three simultaneously

All shifted probabilities remain normalised. Binary nodes are clamped to [ε, 1−ε].
Quantum bands use Esscher-style exponential tilting to preserve Σ prob = 1.

No re-simulation required. Runs in < 1 second.
"""

from __future__ import annotations

import math
from typing import Optional

import numpy as np

from . import v2_master_inputs as MI
from .v2_config import ClaimConfig, SimulationResults
from .v2_investment_analysis import InvestmentGridResults


# ===================================================================
# Constants
# ===================================================================

SHIFT_DELTAS: list[float] = [
    -0.20, -0.15, -0.10, -0.05, 0.0, 0.05, 0.10, 0.15, 0.20,
]
"""Additive shift levels for binary probabilities."""

CATEGORIES: list[str] = ["arb_win", "court", "quantum", "combined"]

REFERENCE_DEALS: list[tuple[float, float]] = [
    (0.10, 0.20),   # 10% upfront, 20% Tata tail
    (0.15, 0.25),   # 15% upfront, 25% Tata tail
    (0.20, 0.30),   # 20% upfront, 30% Tata tail
    (0.30, 0.10),   # 30% upfront, 10% Tata tail
]
"""(upfront_pct, tata_tail_pct) for metric computation.
NOTE: Both upfront and tail must exist in STOCHASTIC_PRICING grids:
  - upfront: [5, 7.5, 10, 12.5, 15, 17.5, 20, 22.5, 25, 27.5, 30]
  - tail:    [10, 15, 20, 25, 30, 35, 40, 45, 50]
"""

TILT_STRENGTH: float = 5.0
"""Exponential tilting coefficient for quantum-band shifts.
λ = TILT_STRENGTH × δ.  At δ=+0.20, λ=1.0 (moderate tilt)."""

EPS: float = 0.01
"""Minimum/maximum for clamped probabilities: [EPS, 1−EPS]."""


# ===================================================================
# Utility
# ===================================================================

def _clamp(p: float) -> float:
    """Clamp probability to [EPS, 1−EPS]."""
    return max(EPS, min(1.0 - EPS, p))


# ===================================================================
# Analytical tree recomputation — Domestic
# ===================================================================

def _extract_domestic_base_probs() -> dict:
    """Extract node-level base probabilities from MI flat path tables.

    Returns dict with all base node probabilities for Scenario A and B.
    Cross-checked against path tables to ensure consistency.
    """
    dom_a = MI.DOMESTIC_PATHS_A
    dom_b = MI.DOMESTIC_PATHS_B

    # --- Scenario A ---
    # S.34 P(TATA wins)
    a_s34_tw = next(p["s34_prob"] for p in dom_a if p["s34_tata_wins"])  # 0.70

    # S.37 P(TATA wins) in each S.34 branch
    s34T = [p for p in dom_a if p["s34_tata_wins"]]
    a_s37_tw_s34T = next(p["s37_prob"] for p in s34T if p["s37_tata_wins"])  # 0.80
    s34F = [p for p in dom_a if not p["s34_tata_wins"]]
    a_s37_tw_s34F = next(p["s37_prob"] for p in s34F if p["s37_tata_wins"])  # 0.50

    # SLP gate: P(admitted) from admitted paths in each (s34, s37) branch
    def _slp_admitted_prob(paths, s34_tw, s37_tw):
        sub = [p for p in paths if p["s34_tata_wins"] == s34_tw
               and p["s37_tata_wins"] == s37_tw and p["slp_admitted"]]
        return sub[0]["slp_gate_prob"] if sub else 0.0

    a_slp_adm_TT = _slp_admitted_prob(dom_a, True, True)    # 0.10
    a_slp_adm_TF = _slp_admitted_prob(dom_a, True, False)   # 0.50
    a_slp_adm_FT = _slp_admitted_prob(dom_a, False, True)   # 0.25
    a_slp_adm_FF = _slp_admitted_prob(dom_a, False, False)  # 0.20

    # SLP merits P(TATA wins) from tata_wins=True paths
    def _slp_merits_tw_prob(paths, s34_tw, s37_tw):
        sub = [p for p in paths if p["s34_tata_wins"] == s34_tw
               and p["s37_tata_wins"] == s37_tw
               and p["slp_admitted"]
               and p.get("slp_merits_tata_wins")]
        return sub[0]["slp_merits_prob"] if sub else 0.0

    a_slpm_TT = _slp_merits_tw_prob(dom_a, True, True)    # 0.90
    a_slpm_TF = _slp_merits_tw_prob(dom_a, True, False)   # 0.50
    a_slpm_FT = _slp_merits_tw_prob(dom_a, False, True)   # 0.75
    a_slpm_FF = _slp_merits_tw_prob(dom_a, False, False)  # 0.20

    # --- Scenario B ---
    b_s34_tw = next(p["s34_prob"] for p in dom_b if p["s34_tata_wins"])  # 0.30

    s34T_b = [p for p in dom_b if p["s34_tata_wins"]]
    b_s37_tw_s34T = next(p["s37_prob"] for p in s34T_b if p["s37_tata_wins"])  # 0.50
    s34F_b = [p for p in dom_b if not p["s34_tata_wins"]]
    b_s37_tw_s34F = next(p["s37_prob"] for p in s34F_b if p["s37_tata_wins"])  # 0.20

    b_slp_adm_TT = _slp_admitted_prob(dom_b, True, True)    # 0.20
    b_slp_adm_TF = _slp_admitted_prob(dom_b, True, False)   # 0.25
    b_slp_adm_FT = _slp_admitted_prob(dom_b, False, True)   # 0.25
    b_slp_adm_FF = _slp_admitted_prob(dom_b, False, False)  # 0.10

    b_slpm_TT = _slp_merits_tw_prob(dom_b, True, True)    # 0.20
    b_slpm_TF = _slp_merits_tw_prob(dom_b, True, False)   # 0.75
    b_slpm_FT = _slp_merits_tw_prob(dom_b, False, True)   # 0.75
    b_slpm_FF = _slp_merits_tw_prob(dom_b, False, False)  # 0.20

    return {
        "a": {
            "s34_tw": a_s34_tw,
            "s37_tw_s34T": a_s37_tw_s34T,
            "s37_tw_s34F": a_s37_tw_s34F,
            "slp_adm_TT": a_slp_adm_TT,
            "slp_adm_TF": a_slp_adm_TF,
            "slp_adm_FT": a_slp_adm_FT,
            "slp_adm_FF": a_slp_adm_FF,
            "slpm_TT": a_slpm_TT,
            "slpm_TF": a_slpm_TF,
            "slpm_FT": a_slpm_FT,
            "slpm_FF": a_slpm_FF,
        },
        "b": {
            "s34_tw": b_s34_tw,
            "s37_tw_s34T": b_s37_tw_s34T,
            "s37_tw_s34F": b_s37_tw_s34F,
            "slp_adm_TT": b_slp_adm_TT,
            "slp_adm_TF": b_slp_adm_TF,
            "slp_adm_FT": b_slp_adm_FT,
            "slp_adm_FF": b_slp_adm_FF,
            "slpm_TT": b_slpm_TT,
            "slpm_TF": b_slpm_TF,
            "slpm_FT": b_slpm_FT,
            "slpm_FF": b_slpm_FF,
        },
    }


def _compute_domestic_outcomes(bp: dict, delta: float) -> dict[str, float]:
    """Compute domestic tree outcome probabilities with court shift δ.

    Shifts every "favorable-for-TATA" node probability by +δ.
    At each binary node, the favorable direction is:
      - S.34 / S.37 / SLP merits: P(TATA wins) shifted up
      - SLP gate when opponent files (s37=T after favourable chain):
            P(dismissed) shifted up → P(admitted) = 1 − P(dismissed)
      - SLP gate when TATA files (s37=F):
            P(admitted) shifted up

    Returns dict with 'TRUE_WIN', 'RESTART', 'LOSE' probabilities.
    Probabilities sum to 1.0 by construction (binary tree, complementary at each node).
    """
    # --- S.34: "TATA wins" is always favorable ---
    s34 = _clamp(bp["s34_tw"] + delta)

    # --- S.37: "TATA wins" is always favorable ---
    s37_s34T = _clamp(bp["s37_tw_s34T"] + delta)
    s37_s34F = _clamp(bp["s37_tw_s34F"] + delta)

    # --- SLP gate ---
    # After s37=T (award intact/restored) → opponent (DFCCIL) files SLP → dismissed = favorable
    # P(dismissed) = 1 − P(admitted). Shift P(dismissed) UP means shift P(admitted) DOWN.
    # Base P(admitted) values are stored in slp_adm_*. Favorable = P(dismissed) = 1 − slp_adm.
    # Shift: P(dismissed)_new = clamp(P(dismissed)_base + delta)
    #        P(admitted)_new  = 1 − P(dismissed)_new
    slp_adm_TT = 1.0 - _clamp((1.0 - bp["slp_adm_TT"]) + delta)  # opponent files
    slp_adm_FT = 1.0 - _clamp((1.0 - bp["slp_adm_FT"]) + delta)  # opponent files

    # After s37=F (award set aside) → TATA files SLP → admitted = favorable
    # Shift P(admitted) UP directly
    slp_adm_TF = _clamp(bp["slp_adm_TF"] + delta)  # TATA files
    slp_adm_FF = _clamp(bp["slp_adm_FF"] + delta)  # TATA files

    # --- SLP merits: "TATA wins" is always favorable ---
    slpm_TT = _clamp(bp["slpm_TT"] + delta)
    slpm_TF = _clamp(bp["slpm_TF"] + delta)
    slpm_FT = _clamp(bp["slpm_FT"] + delta)
    slpm_FF = _clamp(bp["slpm_FF"] + delta)

    # --- Compute 12 path probabilities ---
    # Branch s34=T (TATA wins S.34)
    p_s34T = s34
    p_s34F = 1.0 - s34

    # s34=T, s37=T
    p_TT = p_s34T * s37_s34T
    a1 = p_TT * (1.0 - slp_adm_TT)                      # SLP dismissed → TRUE_WIN
    a2 = p_TT * slp_adm_TT * (1.0 - slpm_TT)            # SLP admitted, TATA loses → LOSE
    a3 = p_TT * slp_adm_TT * slpm_TT                     # SLP admitted, TATA wins → TRUE_WIN

    # s34=T, s37=F
    p_TF = p_s34T * (1.0 - s37_s34T)
    a4 = p_TF * (1.0 - slp_adm_TF)                      # TATA SLP dismissed → LOSE
    a5 = p_TF * slp_adm_TF * slpm_TF                    # TATA SLP admitted, TATA wins → TRUE_WIN
    a6 = p_TF * slp_adm_TF * (1.0 - slpm_TF)            # TATA SLP admitted, TATA loses → LOSE

    # s34=F, s37=T
    p_FT = p_s34F * s37_s34F
    a7 = p_FT * (1.0 - slp_adm_FT)                      # DFCCIL SLP dismissed → TRUE_WIN
    a8 = p_FT * slp_adm_FT * (1.0 - slpm_FT)            # DFCCIL SLP admitted, DFCCIL wins → LOSE
    a9 = p_FT * slp_adm_FT * slpm_FT                    # DFCCIL SLP admitted, TATA wins → TRUE_WIN

    # s34=F, s37=F
    p_FF = p_s34F * (1.0 - s37_s34F)
    a10 = p_FF * (1.0 - slp_adm_FF)                     # TATA SLP dismissed → LOSE
    a11 = p_FF * slp_adm_FF * slpm_FF                   # TATA SLP admitted, TATA wins → TRUE_WIN
    a12 = p_FF * slp_adm_FF * (1.0 - slpm_FF)           # TATA SLP admitted, TATA loses → LOSE

    p_tw = a1 + a3 + a5 + a7 + a9 + a11
    p_lo = a2 + a4 + a6 + a8 + a10 + a12
    p_re = 0.0  # No RESTART in domestic Scenario A

    total = p_tw + p_lo + p_re
    assert abs(total - 1.0) < 1e-10, f"Domestic A paths sum to {total:.10f}"

    return {"TRUE_WIN": p_tw, "LOSE": p_lo, "RESTART": p_re}


def _compute_domestic_b_outcomes(bp: dict, delta: float) -> dict[str, float]:
    """Compute domestic Scenario B (TATA lost arb) outcome probabilities.

    Same node structure as Scenario A but different base probabilities,
    different outcomes (RESTART instead of TRUE_WIN), and different filer logic.

    In Scenario B:
      s37=T → award favorable for TATA → opponent files SLP → dismissed = favorable
      s37=F → award unfavorable → TATA files SLP → admitted = favorable
    Same structural pattern as Scenario A.

    Outcomes: RESTART (good) or LOSE (bad). No TRUE_WIN.
    """
    s34 = _clamp(bp["s34_tw"] + delta)
    s37_s34T = _clamp(bp["s37_tw_s34T"] + delta)
    s37_s34F = _clamp(bp["s37_tw_s34F"] + delta)

    # SLP gate: same filer logic as Scenario A
    slp_adm_TT = 1.0 - _clamp((1.0 - bp["slp_adm_TT"]) + delta)
    slp_adm_FT = 1.0 - _clamp((1.0 - bp["slp_adm_FT"]) + delta)
    slp_adm_TF = _clamp(bp["slp_adm_TF"] + delta)
    slp_adm_FF = _clamp(bp["slp_adm_FF"] + delta)

    slpm_TT = _clamp(bp["slpm_TT"] + delta)
    slpm_TF = _clamp(bp["slpm_TF"] + delta)
    slpm_FT = _clamp(bp["slpm_FT"] + delta)
    slpm_FF = _clamp(bp["slpm_FF"] + delta)

    p_s34T = s34
    p_s34F = 1.0 - s34

    # s34=T, s37=T → DFCCIL files SLP
    p_TT = p_s34T * s37_s34T
    b10 = p_TT * (1.0 - slp_adm_TT)                    # SLP dismissed → RESTART
    b11 = p_TT * slp_adm_TT * (1.0 - slpm_TT)          # SLP merits DFCCIL wins → LOSE
    b12 = p_TT * slp_adm_TT * slpm_TT                   # SLP merits TATA wins → RESTART

    # s34=T, s37=F → TATA files SLP
    p_TF = p_s34T * (1.0 - s37_s34T)
    b7  = p_TF * (1.0 - slp_adm_TF)                    # TATA SLP dismissed → LOSE
    b8  = p_TF * slp_adm_TF * slpm_TF                  # TATA wins merits → RESTART
    b9  = p_TF * slp_adm_TF * (1.0 - slpm_TF)          # TATA loses merits → LOSE

    # s34=F, s37=T → DFCCIL files SLP
    p_FT = p_s34F * s37_s34F
    b4 = p_FT * (1.0 - slp_adm_FT)                     # SLP dismissed → RESTART
    b5 = p_FT * slp_adm_FT * (1.0 - slpm_FT)           # DFCCIL wins → LOSE
    b6 = p_FT * slp_adm_FT * slpm_FT                   # TATA wins → RESTART

    # s34=F, s37=F → TATA files SLP
    p_FF = p_s34F * (1.0 - s37_s34F)
    b1  = p_FF * (1.0 - slp_adm_FF)                    # TATA SLP dismissed → LOSE
    b2  = p_FF * slp_adm_FF * slpm_FF                  # TATA wins merits → RESTART
    b3  = p_FF * slp_adm_FF * (1.0 - slpm_FF)          # TATA loses merits → LOSE

    p_restart = b10 + b12 + b8 + b4 + b6 + b2
    p_lose = b11 + b7 + b9 + b5 + b1 + b3
    p_tw = 0.0  # No TRUE_WIN in Scenario B

    # NO_RESTART_MODE: absorb RESTART mass into LOSE
    if MI.NO_RESTART_MODE:
        p_lose += p_restart
        p_restart = 0.0

    total = p_restart + p_lose + p_tw
    assert abs(total - 1.0) < 1e-10, f"Domestic B paths sum to {total:.10f}"

    return {"TRUE_WIN": p_tw, "LOSE": p_lose, "RESTART": p_restart}


# ===================================================================
# Analytical tree recomputation — SIAC
# ===================================================================

def _extract_siac_base_probs() -> dict:
    """Extract SIAC node-level base probabilities."""
    sa = MI.SIAC_PATHS_A
    sb = MI.SIAC_PATHS_B

    # Scenario A
    a_hc_tw = next(p["hc_prob"] for p in sa if p["hc_tata_wins"])          # 0.80
    a_coa_tw_hcT = next(p["coa_prob"] for p in sa
                        if p["hc_tata_wins"] and p["coa_tata_wins"])       # 0.90
    a_coa_tw_hcF = next(p["coa_prob"] for p in sa
                        if not p["hc_tata_wins"] and p["coa_tata_wins"])   # 0.50

    # Scenario B
    b_hc_tw = next(p["hc_prob"] for p in sb if p["hc_tata_wins"])          # 0.20
    b_coa_tw_hcT = next(p["coa_prob"] for p in sb
                        if p["hc_tata_wins"] and p["coa_tata_wins"])       # 0.10
    b_coa_tw_hcF = next(p["coa_prob"] for p in sb
                        if not p["hc_tata_wins"] and p["coa_tata_wins"])   # 0.50

    return {
        "a": {"hc_tw": a_hc_tw, "coa_tw_hcT": a_coa_tw_hcT, "coa_tw_hcF": a_coa_tw_hcF},
        "b": {"hc_tw": b_hc_tw, "coa_tw_hcT": b_coa_tw_hcT, "coa_tw_hcF": b_coa_tw_hcF},
    }


def _compute_siac_outcomes(bp: dict, delta: float) -> dict[str, float]:
    """Compute SIAC tree outcome probabilities with court shift δ.

    All favorable-for-TATA node probabilities shifted by +δ.
    """
    hc = _clamp(bp["hc_tw"] + delta)
    coa_hcT = _clamp(bp["coa_tw_hcT"] + delta)
    coa_hcF = _clamp(bp["coa_tw_hcF"] + delta)

    sa1 = hc * coa_hcT                  # HC win, COA win → TRUE_WIN
    sa2 = hc * (1.0 - coa_hcT)          # HC win, COA lose → LOSE
    sa3 = (1.0 - hc) * coa_hcF          # HC lose, COA win → TRUE_WIN
    sa4 = (1.0 - hc) * (1.0 - coa_hcF)  # HC lose, COA lose → LOSE

    p_tw = sa1 + sa3
    p_lo = sa2 + sa4

    total = p_tw + p_lo
    assert abs(total - 1.0) < 1e-10, f"SIAC A paths sum to {total:.10f}"
    return {"TRUE_WIN": p_tw, "LOSE": p_lo, "RESTART": 0.0}


def _compute_siac_b_outcomes(bp: dict, delta: float) -> dict[str, float]:
    """SIAC Scenario B (TATA lost arb): RESTART or LOSE."""
    hc = _clamp(bp["hc_tw"] + delta)
    coa_hcT = _clamp(bp["coa_tw_hcT"] + delta)
    coa_hcF = _clamp(bp["coa_tw_hcF"] + delta)

    sb1 = hc * coa_hcT                   # RESTART
    sb2 = hc * (1.0 - coa_hcT)           # LOSE
    sb3 = (1.0 - hc) * coa_hcF           # RESTART
    sb4 = (1.0 - hc) * (1.0 - coa_hcF)   # LOSE

    p_re = sb1 + sb3
    p_lo = sb2 + sb4

    # NO_RESTART_MODE: absorb RESTART mass into LOSE
    if MI.NO_RESTART_MODE:
        p_lo += p_re
        p_re = 0.0

    total = p_re + p_lo
    assert abs(total - 1.0) < 1e-10, f"SIAC B paths sum to {total:.10f}"
    return {"TRUE_WIN": 0.0, "LOSE": p_lo, "RESTART": p_re}


# ===================================================================
# Quantum band tilting
# ===================================================================

def _shifted_quantum_eq(delta: float, tilt: float = TILT_STRENGTH) -> tuple[float, list[float]]:
    """Compute E[Q|WIN] under exponentially tilted quantum bands.

    Esscher-style tilt: w_i = prob_i × exp(λ × midpoint_i), then normalise.
    λ = tilt × δ.  Positive δ tilts mass toward high-quantum bands.

    Returns (e_q_win_pct, shifted_probs_list).
    """
    bands = MI.QUANTUM_BANDS
    lam = tilt * delta

    weights = []
    for band in bands:
        mid = (band["low"] + band["high"]) / 2.0
        w = band["probability"] * math.exp(lam * mid)
        weights.append(w)

    total_w = sum(weights)
    shifted_probs = [w / total_w for w in weights]

    # Verify sum = 1
    assert abs(sum(shifted_probs) - 1.0) < 1e-10

    e_q = sum(
        sp * (b["low"] + b["high"]) / 2.0
        for sp, b in zip(shifted_probs, bands)
    )
    return e_q, shifted_probs


# ===================================================================
# MC conditional extraction
# ===================================================================

# Partition codes (per-claim):
#   0: arb_won=True,  final=TRUE_WIN   (direct win through courts)
#   1: arb_won=True,  final=LOSE       (won arb but courts set aside)
#   2: arb_won=False, no restart        (court challenge → LOSE)
#   3: arb_won=False, restart → TRUE_WIN (re-arb won, within timeline)
#   4: arb_won=False, restart → LOSE    (re-arb lost or timeline exceeded)

PARTITION_NAMES = [
    "arb_win__court_win",
    "arb_win__court_lose",
    "arb_lose__no_restart",
    "arb_lose__restart_win",
    "arb_lose__restart_lose",
]


def _classify_path(pr) -> int:
    """Classify a PathResult into one of 5 partitions."""
    if pr.arb_won:
        return 0 if pr.final_outcome == "TRUE_WIN" else 1
    else:
        # arb lost: check if challenge led to RESTART
        if pr.challenge.outcome == "RESTART":
            return 3 if pr.final_outcome == "TRUE_WIN" else 4
        else:
            return 2  # direct LOSE from courts


def _extract_mc_conditionals(
    sim: SimulationResults,
    claims: list[ClaimConfig],
    pricing_basis: str = "soc",
) -> dict:
    """Extract per-claim conditional statistics from MC paths.

    For each claim and each partition, compute:
      - count: number of paths
      - mean_collected_cr: conditional mean of collected_cr
      - mean_legal_cost_cr: conditional mean of legal_cost_total_cr
      - For each reference deal: conditional E[MOIC] and P(loss)

    Also estimates P(within_timeline | RESTART) per claim.
    """
    from .v2_quantum_model import compute_expected_quantum

    n = sim.n_paths
    conditionals: dict[str, dict] = {}
    base_eq_pct = _shifted_quantum_eq(0.0)[0]  # base E[Q|WIN] as fraction of SOC

    for claim in claims:
        cid = claim.claim_id
        paths = sim.results[cid]
        eq_cr = compute_expected_quantum(claim.soc_value_cr)

        # Partition paths
        partitions: dict[int, list] = {k: [] for k in range(5)}
        for pr in paths:
            k = _classify_path(pr)
            partitions[k].append(pr)

        # Count restarts that were within timeline vs exceeded
        restart_paths = partitions[3] + partitions[4]
        n_restart = len(restart_paths)
        n_restart_within = sum(
            1 for pr in restart_paths
            if pr.re_arb_won is not None  # re-arb was actually drawn
        )
        p_within_timeline = n_restart_within / max(n_restart, 1)

        claim_cond = {
            "claim_id": cid,
            "jurisdiction": claim.jurisdiction,
            "soc_cr": claim.soc_value_cr,
            "tpl_share": claim.tpl_share,
            "p_within_timeline": p_within_timeline,
            "partitions": {},
        }

        for k in range(5):
            plist = partitions[k]
            count = len(plist)

            if count == 0:
                claim_cond["partitions"][k] = {
                    "count": 0,
                    "mc_prob": 0.0,
                    "mean_collected_cr": 0.0,
                    "mean_legal_cost_cr": 0.0,
                    "deals": {},
                }
                continue

            collected_arr = np.array([pr.collected_cr for pr in plist])
            legal_arr = np.array([pr.legal_cost_total_cr for pr in plist])

            # Compute MOIC for each reference deal
            deals_data = {}
            for (up_pct, tail_pct) in REFERENCE_DEALS:
                fund_share = 1.0 - tail_pct
                if pricing_basis == "eq":
                    upfront = up_pct * eq_cr
                else:
                    upfront = up_pct * claim.soc_value_cr * claim.tpl_share

                inv_arr = upfront + legal_arr
                ret_arr = fund_share * collected_arr
                moic_arr = np.where(inv_arr > 0, ret_arr / inv_arr, 0.0)

                deal_key = f"{int(up_pct*100)}_{int(tail_pct*100)}"
                deals_data[deal_key] = {
                    "mean_moic": float(np.mean(moic_arr)),
                    "p_loss": float(np.mean(moic_arr < 1.0)),
                    "mean_inv_cr": float(np.mean(inv_arr)),
                    "mean_ret_cr": float(np.mean(ret_arr)),
                }

            claim_cond["partitions"][k] = {
                "count": count,
                "mc_prob": count / n,
                "mean_collected_cr": float(np.mean(collected_arr)),
                "mean_legal_cost_cr": float(np.mean(legal_arr)),
                "deals": deals_data,
            }

        conditionals[cid] = claim_cond

    return conditionals


# ===================================================================
# Shifted partition probabilities
# ===================================================================

def _compute_shifted_partition_probs(
    jurisdiction: str,
    arb_delta: float,
    court_delta: float,
    quantum_delta: float,
    dom_base: dict,
    siac_base: dict,
    p_within_timeline: float,
) -> dict[int, float]:
    """Compute shifted partition probabilities for one claim.

    Parameters
    ----------
    jurisdiction : "domestic" or "siac"
    arb_delta : shift for arb win probability
    court_delta : shift for court node probabilities
    quantum_delta : shift for quantum bands (affects E[Q], not partition probs directly)
    dom_base, siac_base : base probability dicts from _extract_*_base_probs
    p_within_timeline : fraction of RESTART paths within timeline (from MC)
    """
    arb_win = _clamp(MI.ARB_WIN_PROBABILITY + arb_delta)
    re_arb_win = _clamp(MI.RE_ARB_WIN_PROBABILITY + arb_delta)

    if jurisdiction == "domestic":
        sc_a = _compute_domestic_outcomes(dom_base["a"], court_delta)
        sc_b = _compute_domestic_b_outcomes(dom_base["b"], court_delta)
    else:
        sc_a = _compute_siac_outcomes(siac_base["a"], court_delta)
        sc_b = _compute_siac_b_outcomes(siac_base["b"], court_delta)

    # Partition probabilities
    p = {}
    p[0] = arb_win * sc_a["TRUE_WIN"]                                         # arb win, courts win
    p[1] = arb_win * sc_a["LOSE"]                                              # arb win, courts lose
    p[2] = (1.0 - arb_win) * sc_b["LOSE"]                                     # arb lose, no restart
    p[3] = (1.0 - arb_win) * sc_b["RESTART"] * re_arb_win * p_within_timeline  # restart → re-arb win
    p[4] = (1.0 - arb_win) * sc_b["RESTART"] * (1.0 - re_arb_win * p_within_timeline)  # restart → lose

    # Verify sum
    total = sum(p.values())
    assert abs(total - 1.0) < 1e-6, f"Partition probs sum to {total:.6f}"

    return p


# ===================================================================
# Core sensitivity computation
# ===================================================================

def _compute_claim_sensitivity(
    claim_cond: dict,
    dom_base: dict,
    siac_base: dict,
    category: str,
    delta: float,
    base_eq_pct: float,
) -> dict:
    """Compute shifted metrics for one claim at one (category, delta).

    Returns per-claim dict with p_recovery, e_collected_cr, and per-deal metrics.
    """
    jur = claim_cond["jurisdiction"]
    soc = claim_cond["soc_cr"]
    pwt = claim_cond["p_within_timeline"]

    # Determine per-dimension deltas
    if category == "arb_win":
        arb_d, court_d, q_d = delta, 0.0, 0.0
    elif category == "court":
        arb_d, court_d, q_d = 0.0, delta, 0.0
    elif category == "quantum":
        arb_d, court_d, q_d = 0.0, 0.0, delta
    elif category == "combined":
        arb_d, court_d, q_d = delta, delta, delta
    else:
        raise ValueError(f"Unknown category: {category}")

    # Shifted partition probabilities
    p_shifted = _compute_shifted_partition_probs(
        jur, arb_d, court_d, q_d, dom_base, siac_base, pwt,
    )

    # Quantum scaling for TRUE_WIN partitions
    shifted_eq_pct, _ = _shifted_quantum_eq(q_d)
    q_ratio = shifted_eq_pct / base_eq_pct if base_eq_pct > 0 else 1.0

    # P(cash recovery) = P(partition 0) + P(partition 3)
    p_recovery = p_shifted[0] + p_shifted[3]

    # E[collected] = Σ P_shifted(k) × E[collected|k] × quantum_scale
    partitions = claim_cond["partitions"]
    e_collected = 0.0
    for k in range(5):
        pk = partitions.get(k, partitions.get(str(k), {}))
        if pk["count"] == 0:
            continue
        coll = pk["mean_collected_cr"]
        # Apply quantum scaling only to win partitions (where collected > 0)
        if k in (0, 3) and q_d != 0.0:
            coll *= q_ratio
        e_collected += p_shifted[k] * coll

    # Per-deal metrics
    deals_out = {}
    for (up_pct, tail_pct) in REFERENCE_DEALS:
        deal_key = f"{int(up_pct*100)}_{int(tail_pct*100)}"
        e_moic_num = 0.0
        e_moic_den = 0.0
        p_loss_weighted = 0.0

        for k in range(5):
            pk = partitions.get(k, partitions.get(str(k), {}))
            if pk["count"] == 0:
                continue
            dk = pk["deals"].get(deal_key, {})
            if not dk:
                continue

            weight = p_shifted[k]

            # Scale MOIC for quantum shift on win partitions
            moic_k = dk["mean_moic"]
            p_loss_k = dk["p_loss"]
            if k in (0, 3) and q_d != 0.0:
                moic_k *= q_ratio
                # Approximate P(loss) adjustment: if quantum goes up, P(loss|win) decreases
                # Use simple scaling: P(loss|win,shifted) ≈ P(loss|win,base) / q_ratio
                # (more quantum → harder to lose). Clamp to [0, 1].
                if q_ratio > 0:
                    p_loss_k = min(1.0, max(0.0, p_loss_k / q_ratio))

            e_moic_num += weight * dk["mean_ret_cr"] * (q_ratio if k in (0, 3) and q_d != 0.0 else 1.0)
            e_moic_den += weight * dk["mean_inv_cr"]
            p_loss_weighted += weight * p_loss_k

        e_moic = e_moic_num / e_moic_den if e_moic_den > 0 else 0.0
        deals_out[deal_key] = {
            "e_moic": round(e_moic, 4),
            "p_loss": round(p_loss_weighted, 4),
        }

    return {
        "p_recovery": round(p_recovery, 6),
        "e_collected_cr": round(e_collected, 2),
        "deals": deals_out,
    }


# ===================================================================
# Main entry point
# ===================================================================

def run_probability_sensitivity(
    sim: SimulationResults,
    claims: list[ClaimConfig],
    grid: InvestmentGridResults,
    pricing_basis: str = "soc",
    ctx=None,
) -> dict:
    """Run full probability sensitivity analysis.

    Returns structured dict ready for JSON export into dashboard_data.json.

    Computation:
      1. Extract per-claim MC conditional statistics (no re-simulation)
      2. Extract base node probabilities from master_inputs
      3. For each category × delta: analytically shift probabilities,
         reweight MC conditionals, compute portfolio metrics.
      4. Build tornado chart data.

    Runtime: < 1 second for any N.
    """
    import time
    t0 = time.time()

    # Step 1: MC conditionals
    mc_cond = _extract_mc_conditionals(sim, claims, pricing_basis)

    # Step 2: base tree probabilities
    dom_base = _extract_domestic_base_probs()
    siac_base = _extract_siac_base_probs()
    base_eq_pct, base_qb_probs = _shifted_quantum_eq(0.0)

    # Verify base probabilities at δ=0
    dom_a_base = _compute_domestic_outcomes(dom_base["a"], 0.0)
    dom_b_base = _compute_domestic_b_outcomes(dom_base["b"], 0.0)
    siac_a_base = _compute_siac_outcomes(siac_base["a"], 0.0)
    siac_b_base = _compute_siac_b_outcomes(siac_base["b"], 0.0)

    # Step 3: compute all shift results
    results = []
    for category in CATEGORIES:
        for delta in SHIFT_DELTAS:
            # Per-claim
            per_claim = {}
            for claim in claims:
                cid = claim.claim_id
                per_claim[cid] = _compute_claim_sensitivity(
                    mc_cond[cid], dom_base, siac_base, category, delta, base_eq_pct,
                )

            # Portfolio aggregation
            total_soc = sum(c.soc_value_cr * c.tpl_share for c in claims)
            portfolio_p_recovery = sum(
                per_claim[c.claim_id]["p_recovery"]
                * c.soc_value_cr * c.tpl_share / total_soc
                for c in claims
            )
            portfolio_e_collected = sum(
                per_claim[c.claim_id]["e_collected_cr"]
                for c in claims
            )

            # Portfolio deal metrics (sum E[ret] / sum E[inv] across claims)
            portfolio_deals = {}
            for (up_pct, tail_pct) in REFERENCE_DEALS:
                deal_key = f"{int(up_pct*100)}_{int(tail_pct*100)}"
                total_ret = 0.0
                total_inv = 0.0
                total_ploss_w = 0.0
                total_w = 0.0
                for claim in claims:
                    cid = claim.claim_id
                    cd = per_claim[cid]["deals"].get(deal_key, {})
                    soc_c = claim.soc_value_cr * claim.tpl_share
                    # Reconstruct E[ret] and E[inv] from partition-weighted values
                    # We already computed e_moic = E[ret]/E[inv] but need separate totals.
                    # Use the partition data directly for accuracy.
                    partitions = mc_cond[cid]["partitions"]
                    q_d = delta if category in ("quantum", "combined") else 0.0
                    _, shifted_qb = _shifted_quantum_eq(q_d)
                    shifted_eq, _ = _shifted_quantum_eq(q_d)
                    q_ratio = shifted_eq / base_eq_pct if base_eq_pct > 0 else 1.0

                    arb_d = delta if category in ("arb_win", "combined") else 0.0
                    court_d = delta if category in ("court", "combined") else 0.0
                    p_shifted = _compute_shifted_partition_probs(
                        claim.jurisdiction, arb_d, court_d, q_d,
                        dom_base, siac_base,
                        mc_cond[cid]["p_within_timeline"],
                    )

                    claim_ret = 0.0
                    claim_inv = 0.0
                    claim_ploss = 0.0
                    for k in range(5):
                        pk = partitions.get(k, partitions.get(str(k), {}))
                        if pk["count"] == 0:
                            continue
                        dk = pk["deals"].get(deal_key, {})
                        if not dk:
                            continue
                        scale = q_ratio if k in (0, 3) and q_d != 0.0 else 1.0
                        claim_ret += p_shifted[k] * dk["mean_ret_cr"] * scale
                        claim_inv += p_shifted[k] * dk["mean_inv_cr"]
                        ploss_k = dk["p_loss"]
                        if k in (0, 3) and q_d != 0.0 and q_ratio > 0:
                            ploss_k = min(1.0, max(0.0, ploss_k / q_ratio))
                        claim_ploss += p_shifted[k] * ploss_k

                    total_ret += claim_ret
                    total_inv += claim_inv
                    total_ploss_w += claim_ploss * soc_c
                    total_w += soc_c

                portfolio_moic = total_ret / total_inv if total_inv > 0 else 0.0
                portfolio_ploss = total_ploss_w / total_w if total_w > 0 else 0.0

                portfolio_deals[deal_key] = {
                    "e_moic": round(portfolio_moic, 4),
                    "p_loss": round(portfolio_ploss, 4),
                    "e_return_cr": round(total_ret, 2),
                    "e_invested_cr": round(total_inv, 2),
                }

            # Shifted parameter summary
            arb_d = delta if category in ("arb_win", "combined") else 0.0
            court_d = delta if category in ("court", "combined") else 0.0
            q_d = delta if category in ("quantum", "combined") else 0.0

            shifted_arb = _clamp(MI.ARB_WIN_PROBABILITY + arb_d)
            shifted_eq, shifted_qb = _shifted_quantum_eq(q_d)

            results.append({
                "category": category,
                "delta": delta,
                "shifted_params": {
                    "arb_win_prob": round(shifted_arb, 4),
                    "re_arb_win_prob": round(_clamp(MI.RE_ARB_WIN_PROBABILITY + arb_d), 4),
                    "e_q_win_pct": round(shifted_eq, 4),
                    "quantum_band_probs": [round(p, 4) for p in shifted_qb],
                    "dom_a_tw": round(
                        _compute_domestic_outcomes(dom_base["a"], court_d)["TRUE_WIN"], 4
                    ),
                    "dom_b_restart": round(
                        _compute_domestic_b_outcomes(dom_base["b"], court_d)["RESTART"], 4
                    ),
                    "siac_a_tw": round(
                        _compute_siac_outcomes(siac_base["a"], court_d)["TRUE_WIN"], 4
                    ),
                    "siac_b_restart": round(
                        _compute_siac_b_outcomes(siac_base["b"], court_d)["RESTART"], 4
                    ),
                },
                "per_claim": per_claim,
                "portfolio": {
                    "p_recovery": round(portfolio_p_recovery, 6),
                    "e_collected_cr": round(portfolio_e_collected, 2),
                    "deals": portfolio_deals,
                },
            })

    # Step 4: tornado chart data (at ±0.15 for each category, using first reference deal)
    # Build tornado_ref from first REFERENCE_DEALS entry
    first_ref = REFERENCE_DEALS[0]  # (upfront_pct, tail_pct)
    tornado_ref = f"{int(first_ref[0]*100)}_{int(first_ref[1]*100)}"
    base_result = next(
        r for r in results if r["category"] == "combined" and r["delta"] == 0.0
    )
    base_moic = base_result["portfolio"]["deals"][tornado_ref]["e_moic"]

    tornado_bars = []
    for cat in CATEGORIES:
        cat_results = [r for r in results if r["category"] == cat]
        # Find results at most extreme deltas
        lo = next(r for r in cat_results if r["delta"] == min(SHIFT_DELTAS))
        hi = next(r for r in cat_results if r["delta"] == max(SHIFT_DELTAS))
        lo_moic = lo["portfolio"]["deals"][tornado_ref]["e_moic"]
        hi_moic = hi["portfolio"]["deals"][tornado_ref]["e_moic"]
        tornado_bars.append({
            "category": cat,
            "low_delta": min(SHIFT_DELTAS),
            "high_delta": max(SHIFT_DELTAS),
            "low_moic": lo_moic,
            "high_moic": hi_moic,
            "range": round(hi_moic - lo_moic, 4),
        })

    # Sort tornado by range (widest first)
    tornado_bars.sort(key=lambda x: x["range"], reverse=True)

    # Base probabilities for reference
    base_probs = {
        "arb_win_prob": MI.ARB_WIN_PROBABILITY,
        "re_arb_win_prob": MI.RE_ARB_WIN_PROBABILITY,
        "e_q_win_pct": round(base_eq_pct, 4),
        "quantum_band_probs": [round(p, 4) for p in base_qb_probs],
        "domestic": {
            "scenario_a": {k: round(v, 4) for k, v in dom_a_base.items()},
            "scenario_b": {k: round(v, 4) for k, v in dom_b_base.items()},
        },
        "siac": {
            "scenario_a": {k: round(v, 4) for k, v in siac_a_base.items()},
            "scenario_b": {k: round(v, 4) for k, v in siac_b_base.items()},
        },
    }

    elapsed = time.time() - t0

    output = {
        "shift_levels": SHIFT_DELTAS,
        "categories": CATEGORIES,
        "reference_deals": [
            {
                "upfront_pct": up,
                "tata_tail_pct": tail,
                "label": f"{int(up*100)}% / {int(tail*100)}%",
                "key": f"{int(up*100)}_{int(tail*100)}",
            }
            for up, tail in REFERENCE_DEALS
        ],
        "base_probabilities": base_probs,
        "results": results,
        "tornado": {
            "ref_deal": tornado_ref,
            "base_e_moic": base_moic,
            "bars": tornado_bars,
        },
        "computation_time_s": round(elapsed, 2),
    }

    print(f"  Probability sensitivity: {len(results)} scenarios computed in {elapsed:.2f}s")
    return output
