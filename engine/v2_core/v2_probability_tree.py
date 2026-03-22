"""
TATA_code_v2/v2_probability_tree.py — Stochastic court challenge tree traversal.
=================================================================================

Two main functions:
  simulate_domestic_challenge(arb_won, rng) → ChallengeResult
  simulate_siac_challenge(arb_won, rng) → ChallengeResult

Implementation: Level-by-level simulation (NOT path enumeration).
At each court level, draw a random number to determine the outcome,
accumulate the timeline, and continue to the next level.

Also includes validate_tree() which analytically verifies all path
probabilities sum to 100% for both scenarios. Runs on import.

All durations sourced from v2_master_inputs. Never calls np.random.seed().
Every random function takes rng: np.random.Generator as final argument.
"""

from __future__ import annotations

import numpy as np

from .v2_config import ChallengeResult
from . import v2_master_inputs as MI


# ===================================================================
# DOMESTIC CHALLENGE TREE (4 levels: S.34 → S.37 → SLP gate → SLP merits)
# ===================================================================

def simulate_domestic_challenge(
    arb_won: bool,
    rng: np.random.Generator,
) -> ChallengeResult:
    """Traverse the 4-level domestic court challenge tree.

    Parameters
    ----------
    arb_won : bool
        True = TATA won arbitration (Scenario A), False = TATA lost (Scenario B).
    rng : np.random.Generator
        Random number generator for this path.

    Returns
    -------
    ChallengeResult with outcome, timeline, path_id, and stage breakdown.

    The tree is traversed level by level:
      Level 1: S.34 — who files and does the filer succeed?
      Level 2: S.37 — appeal — does the filer succeed?
      Level 3: SLP gate — is the petition admitted by Supreme Court?
      Level 4: SLP merits — if admitted, does TATA win on merits?

    At each level, "who files" and "what winning means" depends on
    the prior outcomes and which scenario (A or B) we are in.
    """
    # Select the path table for the appropriate scenario
    paths = MI.DOMESTIC_PATHS_A if arb_won else MI.DOMESTIC_PATHS_B
    scenario = "A" if arb_won else "B"

    # Draw durations for S.34 and S.37 from Uniform distributions
    s34_dur = rng.uniform(MI.S34_DURATION["low"], MI.S34_DURATION["high"])
    s37_dur = rng.uniform(MI.S37_DURATION["low"], MI.S37_DURATION["high"])

    # ── Level 1: S.34 ──
    # In Scenario A: DFCCIL files S.34 to set aside award.
    #   "s34_tata_wins=True" means DFCCIL FAILS → good for TATA.
    #   s34_prob = 0.70 means 70% chance DFCCIL fails (TATA wins).
    # In Scenario B: TATA files S.34 to set aside unfavourable award.
    #   "s34_tata_wins=True" means TATA SUCCEEDS at S.34.
    #   s34_prob = 0.30 means 30% chance TATA succeeds.
    s34_tata_wins_prob = paths[0]["s34_prob"]  # same for all paths in scenario
    u1 = rng.random()
    s34_tata_wins = u1 < s34_tata_wins_prob

    # ── Level 2: S.37 ──
    # Filter paths matching S.34 outcome
    matching = [p for p in paths if p["s34_tata_wins"] == s34_tata_wins]
    # IMPORTANT: Each path stores P(its_own_outcome) as s37_prob.
    # Paths with s37_tata_wins=True store P(True); False paths store P(False).
    # We must read P(True) from a s37_tata_wins=True path.
    s37_true_paths = [p for p in matching if p["s37_tata_wins"] is True]
    if s37_true_paths:
        s37_tata_wins_prob = s37_true_paths[0]["s37_prob"]
    else:
        s37_tata_wins_prob = 0.0
    u2 = rng.random()
    s37_tata_wins = u2 < s37_tata_wins_prob

    # ── Level 3: SLP gate ──
    matching = [p for p in matching if p["s37_tata_wins"] == s37_tata_wins]
    # IMPORTANT: slp_gate_prob on dismissed paths stores P(dismissed),
    # while on admitted paths it stores P(admitted). We must read from
    # the admitted paths to get P(admitted) consistently.
    admitted_in_branch = [p for p in matching if p["slp_admitted"] is True]
    if admitted_in_branch:
        slp_gate_prob = admitted_in_branch[0]["slp_gate_prob"]
    else:
        slp_gate_prob = 0.0  # no admission possible
    u3 = rng.random()
    slp_admitted = u3 < slp_gate_prob

    # ── Level 4: SLP merits (only if admitted) ──
    if slp_admitted:
        matching = [p for p in matching if p["slp_admitted"] is True]
        # IMPORTANT: slp_merits_prob on tata_wins=False paths stores
        # P(tata_loses), and on tata_wins=True paths stores P(tata_wins).
        # We must read from the tata_wins=True path consistently.
        tata_wins_paths = [p for p in matching if p["slp_merits_tata_wins"] is True]
        if tata_wins_paths:
            slp_merits_prob = tata_wins_paths[0]["slp_merits_prob"]
        else:
            slp_merits_prob = 0.0

        # Find which path corresponds to merits_tata_wins=True vs False
        u4 = rng.random()
        slp_merits_tata_wins = u4 < slp_merits_prob

        result_path = [
            p for p in matching
            if p["slp_merits_tata_wins"] == slp_merits_tata_wins
        ][0]

        slp_dur = MI.SLP_ADMITTED_DURATION
    else:
        # SLP dismissed — find the dismissed path
        result_path = [p for p in matching if p["slp_admitted"] is False][0]
        slp_dur = MI.SLP_DISMISSED_DURATION

    # Build timeline
    total_dur = s34_dur + s37_dur + slp_dur
    stages_detail = {
        "s34": float(s34_dur),
        "s37": float(s37_dur),
        "slp": float(slp_dur),
    }

    return ChallengeResult(
        scenario=scenario,
        path_id=result_path["path_id"],
        outcome=result_path["outcome"],
        timeline_months=float(total_dur),
        stages_detail=stages_detail,
    )


# ===================================================================
# SIAC CHALLENGE TREE (2 levels: HC → COA)
# ===================================================================

def simulate_siac_challenge(
    arb_won: bool,
    rng: np.random.Generator,
) -> ChallengeResult:
    """Traverse the 2-level SIAC court challenge tree.

    Parameters
    ----------
    arb_won : bool
        True = TATA won arbitration (Scenario A), False = TATA lost (Scenario B).
    rng : np.random.Generator
        Random number generator for this path.

    Returns
    -------
    ChallengeResult with outcome, timeline, path_id, and stage breakdown.

    The tree is traversed level by level:
      Level 1: HC (High Court) — does TATA's position prevail?
      Level 2: COA (Court of Appeal) — does TATA's position prevail?
    """
    paths = MI.SIAC_PATHS_A if arb_won else MI.SIAC_PATHS_B
    scenario = "A" if arb_won else "B"

    # Fixed durations from master_inputs
    hc_dur = MI.SIAC_HC_DURATION
    coa_dur = MI.SIAC_COA_DURATION

    # ── Level 1: HC ──
    hc_tata_wins_prob = paths[0]["hc_prob"]
    u1 = rng.random()
    hc_tata_wins = u1 < hc_tata_wins_prob

    # ── Level 2: COA ──
    matching = [p for p in paths if p["hc_tata_wins"] == hc_tata_wins]
    coa_tata_wins_prob = matching[0]["coa_prob"]
    u2 = rng.random()
    coa_tata_wins = u2 < coa_tata_wins_prob

    result_path = [
        p for p in matching if p["coa_tata_wins"] == coa_tata_wins
    ][0]

    total_dur = hc_dur + coa_dur
    stages_detail = {
        "hc": float(hc_dur),
        "coa": float(coa_dur),
    }

    return ChallengeResult(
        scenario=scenario,
        path_id=result_path["path_id"],
        outcome=result_path["outcome"],
        timeline_months=float(total_dur),
        stages_detail=stages_detail,
    )


# ===================================================================
# VALIDATION — Analytical probability verification
# ===================================================================

def validate_tree() -> None:
    """Verify all probability trees sum to 100% for both scenarios.

    Checks:
      1. Domestic Scenario A: 12 paths sum to 1.0
      2. Domestic Scenario B: 12 paths sum to 1.0
      3. SIAC Scenario A: 4 paths sum to 1.0
      4. SIAC Scenario B: 4 paths sum to 1.0
      5. Quantum bands sum to 1.0

    Also verifies per-outcome totals match expected values.
    When CONFIG_OVERRIDE_ACTIVE is True, expected subtotals are read
    dynamically from _EXPECTED_OUTCOME_TOTALS instead of hardcoded values.

    Structural invariants always enforced:
      - Domestic A:  RESTART = 0
      - Domestic B:  TRUE_WIN = 0
      - SIAC A:      RESTART = 0
      - SIAC B:      TRUE_WIN = 0

    Raises AssertionError if any check fails.
    """
    TOL = 1e-4
    use_dynamic = MI.CONFIG_OVERRIDE_ACTIVE and MI._EXPECTED_OUTCOME_TOTALS is not None

    # ── Domestic Scenario A ──
    dom_a_probs = [p["conditional_prob"] for p in MI.DOMESTIC_PATHS_A]
    dom_a_total = sum(dom_a_probs)
    assert abs(dom_a_total - 1.0) < TOL, (
        f"Domestic Scenario A paths sum to {dom_a_total:.6f}, expected 1.0"
    )
    dom_a_tw = sum(p["conditional_prob"] for p in MI.DOMESTIC_PATHS_A
                   if p["outcome"] == "TRUE_WIN")
    dom_a_re = sum(p["conditional_prob"] for p in MI.DOMESTIC_PATHS_A
                   if p["outcome"] == "RESTART")
    dom_a_lo = sum(p["conditional_prob"] for p in MI.DOMESTIC_PATHS_A
                   if p["outcome"] == "LOSE")

    if use_dynamic:
        exp = MI._EXPECTED_OUTCOME_TOTALS["dom_a"]
        assert abs(dom_a_tw - exp["TRUE_WIN"]) < TOL, (
            f"Domestic A TRUE_WIN = {dom_a_tw:.4f}, expected {exp['TRUE_WIN']:.4f}"
        )
        assert abs(dom_a_lo - exp["LOSE"]) < TOL, (
            f"Domestic A LOSE = {dom_a_lo:.4f}, expected {exp['LOSE']:.4f}"
        )
    else:
        assert abs(dom_a_tw - 0.7360) < TOL, (
            f"Domestic A TRUE_WIN = {dom_a_tw:.4f}, expected 0.7360"
        )
        assert abs(dom_a_lo - 0.2640) < TOL, (
            f"Domestic A LOSE = {dom_a_lo:.4f}, expected 0.2640"
        )
    # Structural invariant: no RESTART in Scenario A
    assert abs(dom_a_re - 0.0) < TOL, (
        f"Domestic A RESTART = {dom_a_re:.4f}, expected 0.0"
    )

    # ── Domestic Scenario B ──
    dom_b_probs = [p["conditional_prob"] for p in MI.DOMESTIC_PATHS_B]
    dom_b_total = sum(dom_b_probs)
    assert abs(dom_b_total - 1.0) < TOL, (
        f"Domestic Scenario B paths sum to {dom_b_total:.6f}, expected 1.0"
    )
    dom_b_tw = sum(p["conditional_prob"] for p in MI.DOMESTIC_PATHS_B
                   if p["outcome"] == "TRUE_WIN")
    dom_b_re = sum(p["conditional_prob"] for p in MI.DOMESTIC_PATHS_B
                   if p["outcome"] == "RESTART")
    dom_b_lo = sum(p["conditional_prob"] for p in MI.DOMESTIC_PATHS_B
                   if p["outcome"] == "LOSE")

    # Structural invariant: no TRUE_WIN in Scenario B
    assert abs(dom_b_tw - 0.0) < TOL, (
        f"Domestic B TRUE_WIN = {dom_b_tw:.4f}, expected 0.0"
    )
    if use_dynamic:
        exp = MI._EXPECTED_OUTCOME_TOTALS["dom_b"]
        assert abs(dom_b_re - exp["RESTART"]) < TOL, (
            f"Domestic B RESTART = {dom_b_re:.4f}, expected {exp['RESTART']:.4f}"
        )
        assert abs(dom_b_lo - exp["LOSE"]) < TOL, (
            f"Domestic B LOSE = {dom_b_lo:.4f}, expected {exp['LOSE']:.4f}"
        )
    else:
        assert abs(dom_b_re - 0.2966) < TOL, (
            f"Domestic B RESTART = {dom_b_re:.4f}, expected 0.2966"
        )
        assert abs(dom_b_lo - 0.7034) < TOL, (
            f"Domestic B LOSE = {dom_b_lo:.4f}, expected 0.7034"
        )

    # ── SIAC Scenario A ──
    siac_a_probs = [p["conditional_prob"] for p in MI.SIAC_PATHS_A]
    siac_a_total = sum(siac_a_probs)
    assert abs(siac_a_total - 1.0) < TOL, (
        f"SIAC Scenario A paths sum to {siac_a_total:.6f}, expected 1.0"
    )
    siac_a_tw = sum(p["conditional_prob"] for p in MI.SIAC_PATHS_A
                    if p["outcome"] == "TRUE_WIN")
    siac_a_lo = sum(p["conditional_prob"] for p in MI.SIAC_PATHS_A
                    if p["outcome"] == "LOSE")
    siac_a_re = sum(p["conditional_prob"] for p in MI.SIAC_PATHS_A
                    if p["outcome"] == "RESTART")

    if use_dynamic:
        exp = MI._EXPECTED_OUTCOME_TOTALS["siac_a"]
        assert abs(siac_a_tw - exp["TRUE_WIN"]) < TOL, (
            f"SIAC A TRUE_WIN = {siac_a_tw:.4f}, expected {exp['TRUE_WIN']:.4f}"
        )
        assert abs(siac_a_lo - exp["LOSE"]) < TOL, (
            f"SIAC A LOSE = {siac_a_lo:.4f}, expected {exp['LOSE']:.4f}"
        )
    else:
        assert abs(siac_a_tw - 0.8200) < TOL, (
            f"SIAC A TRUE_WIN = {siac_a_tw:.4f}, expected 0.8200"
        )
        assert abs(siac_a_lo - 0.1800) < TOL, (
            f"SIAC A LOSE = {siac_a_lo:.4f}, expected 0.1800"
        )
    # Structural invariant: no RESTART in SIAC A
    assert abs(siac_a_re - 0.0) < TOL, (
        f"SIAC A RESTART = {siac_a_re:.4f}, expected 0.0"
    )

    # ── SIAC Scenario B ──
    siac_b_probs = [p["conditional_prob"] for p in MI.SIAC_PATHS_B]
    siac_b_total = sum(siac_b_probs)
    assert abs(siac_b_total - 1.0) < TOL, (
        f"SIAC Scenario B paths sum to {siac_b_total:.6f}, expected 1.0"
    )
    siac_b_tw = sum(p["conditional_prob"] for p in MI.SIAC_PATHS_B
                    if p["outcome"] == "TRUE_WIN")
    siac_b_re = sum(p["conditional_prob"] for p in MI.SIAC_PATHS_B
                    if p["outcome"] == "RESTART")
    siac_b_lo = sum(p["conditional_prob"] for p in MI.SIAC_PATHS_B
                    if p["outcome"] == "LOSE")

    # Structural invariant: no TRUE_WIN in SIAC B
    assert siac_b_tw < TOL, (
        f"SIAC B TRUE_WIN = {siac_b_tw:.4f}, expected 0.0"
    )
    if use_dynamic:
        exp = MI._EXPECTED_OUTCOME_TOTALS["siac_b"]
        assert abs(siac_b_re - exp["RESTART"]) < TOL, (
            f"SIAC B RESTART = {siac_b_re:.4f}, expected {exp['RESTART']:.4f}"
        )
        assert abs(siac_b_lo - exp["LOSE"]) < TOL, (
            f"SIAC B LOSE = {siac_b_lo:.4f}, expected {exp['LOSE']:.4f}"
        )
    else:
        assert abs(siac_b_re - 0.4200) < TOL, (
            f"SIAC B RESTART = {siac_b_re:.4f}, expected 0.4200"
        )
        assert abs(siac_b_lo - 0.5800) < TOL, (
            f"SIAC B LOSE = {siac_b_lo:.4f}, expected 0.5800"
        )

    # ── Quantum bands ──
    qb_total = sum(b["probability"] for b in MI.QUANTUM_BANDS)
    assert abs(qb_total - 1.0) < TOL, (
        f"Quantum band probabilities sum to {qb_total:.6f}, expected 1.0"
    )


# ===================================================================
# Monte Carlo helper: sample path by cumulative probability
# ===================================================================

def _sample_path_from_table(
    paths: list[dict],
    rng: np.random.Generator,
) -> dict:
    """Sample one terminal path from a flat path table using CDF.

    This is an alternative to level-by-level traversal — useful for
    validation and quick single-draw sampling.

    Parameters
    ----------
    paths : list[dict]
        Path table (e.g. DOMESTIC_PATHS_A).
    rng : np.random.Generator

    Returns
    -------
    dict — the selected path entry.
    """
    probs = np.array([p["conditional_prob"] for p in paths])
    probs = probs / probs.sum()  # normalize for safety
    idx = rng.choice(len(paths), p=probs)
    return paths[idx]


# ===================================================================
# Run validation on import
# ===================================================================

validate_tree()
