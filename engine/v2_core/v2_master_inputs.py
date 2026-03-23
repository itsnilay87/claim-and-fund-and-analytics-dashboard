#!/usr/bin/env python3
"""
TATA_code_v2/v2_master_inputs.py — SINGLE SOURCE OF TRUTH for all v2 model parameters
======================================================================================

Every parameter used by the Monte Carlo valuation model is defined here.
NO hardcoded numbers exist elsewhere in the v2 codebase.

SECTIONS:
    1. Simulation Engine
    2. Claim Definitions (6 claims)
    3. Timeline Parameters (durations in months)
    4. Arbitration Outcome
    5. Quantum Bands (conditional on arb WIN)
    6. Domestic Probability Tree (24 paths, 4 levels)
    7. SIAC Probability Tree (8 paths, 2 levels)
    8. Investment Structure
    9. Legal Cost Parameters
   10. Financial Parameters
   11. Report Settings
"""

from __future__ import annotations

import json
import os as _os


# ============================================================================
# CONFIG OVERRIDE STATE — set by load_config_override()
# ============================================================================

CONFIG_OVERRIDE_ACTIVE: bool = False
"""True when load_config_override() has been called with a JSON config file."""

_EXPECTED_OUTCOME_TOTALS: dict | None = None
"""Dynamically computed outcome subtotals for validate_tree() to check
against when CONFIG_OVERRIDE_ACTIVE is True. Set by load_config_override()."""


# ============================================================================
# SECTION 1: SIMULATION ENGINE
# ============================================================================

N_SIMULATIONS: int = 10_000
"""Number of Monte Carlo paths.  Range: 1,000-100,000."""

RANDOM_SEED: int = 42
"""Base RNG seed for reproducibility.  Any non-negative integer."""

MAX_TIMELINE_MONTHS: int = 96
"""Maximum timeline in months — re-arbitration cutoff.
Paths exceeding this are capped/terminal-valued."""

NO_RESTART_MODE: bool = False
"""If True, all RESTART outcomes in probability trees are treated as LOSE.
Used for conservative 'no re-arbitration' sensitivity analysis.
When enabled, Scenario B paths that would yield RESTART are remapped to
LOSE at the Monte Carlo engine level — the underlying path data is unchanged."""

START_DATE: str = "2026-04-30"
"""All cash-flow dates are anchored to this investment date (ISO 8601)."""


# ============================================================================
# SECTION 2: CLAIM DEFINITIONS (6 claims)
# ============================================================================

CLAIMS: list[dict] = [
    {
        "claim_id": "TP-301-6",
        "archetype": "prolongation",
        "soc_value_cr": 1532.0,
        "jurisdiction": "domestic",
        "current_gate": "dab_commenced",
        "tpl_share": 1.0,
        "pipeline": ["dab", "arbitration", "challenge_tree"],
        "dab_commencement_date": "2025-01-06",
    },
    {
        "claim_id": "TP-302-3",
        "archetype": "change_of_law",
        "soc_value_cr": 23.13,
        "jurisdiction": "domestic",
        "current_gate": "dab_award_done",
        "tpl_share": 1.0,
        "pipeline": ["arbitration", "challenge_tree"],
        "dab_commencement_date": "2020-07-01",
    },
    {
        "claim_id": "TP-302-5",
        "archetype": "prolongation",
        "soc_value_cr": 491.99,
        "jurisdiction": "domestic",
        "current_gate": "arb_hearings_ongoing",
        "tpl_share": 1.0,
        "pipeline": ["arb_remaining", "challenge_tree"],
        "dab_commencement_date": "2023-08-17",
    },
    {
        "claim_id": "TP-CTP11-2",
        "archetype": "scope_variation",
        "soc_value_cr": 484.0,
        "jurisdiction": "siac",
        "current_gate": "dab_found_premature",
        "tpl_share": 1.0,
        "pipeline": ["re_referral", "dab", "arbitration", "challenge_tree"],
        "dab_commencement_date": "2024-02-23",
    },
    {
        "claim_id": "TP-CTP11-4",
        "archetype": "prolongation",
        "soc_value_cr": 1368.0,
        "jurisdiction": "siac",
        "current_gate": "soc_filed_at_dab",
        "tpl_share": 1.0,
        "pipeline": ["dab", "arbitration", "challenge_tree"],
        "dab_commencement_date": "2024-05-22",
    },
    {
        "claim_id": "TP-CTP13-2",
        "archetype": "prolongation",
        "soc_value_cr": 1245.0,
        "jurisdiction": "siac",
        "current_gate": "dab_constituted",
        "tpl_share": 1.0,
        "pipeline": ["dab", "arbitration", "challenge_tree"],
        "dab_commencement_date": "2025-04-02",
    },
]
"""
6 active TATA Arbitration claims.

Each claim has:
  claim_id       — Unique identifier
  archetype      — "prolongation" | "change_of_law" | "scope_variation"
  soc_value_cr   — Statement of Claim value in ₹ Crore
  jurisdiction   — "domestic" (Indian courts) or "siac" (Singapore arbitration)
  current_gate   — Where the claim currently sits in the pipeline
  tpl_share      — TPL's share of the claim (1.0 = 100%)
  pipeline       — Remaining stages from current_gate to resolution

Total SOC: ₹5,144.12 Crore across all 6 claims.
"""

# Convenient lookup dict by claim_id
CLAIMS_BY_ID: dict[str, dict] = {c["claim_id"]: c for c in CLAIMS}

PORTFOLIO_SOC_CR: float = sum(c["soc_value_cr"] for c in CLAIMS)
"""Total SOC across all 6 claims (₹ Crore). = 5,144.12"""


# ============================================================================
# SECTION 3: TIMELINE PARAMETERS (all durations in months)
# ============================================================================

DAB_DURATION: dict[str, float] = {"low": 4.8, "high": 13.1}
"""DAB proceedings duration — Uniform(4.8, 13.1) months.
Historical: 13.1 mo (EOT), 8.5 mo (302-5), 3.1 mo (CTP11-2 premature)."""

ARB_DURATION: dict[str, float] = {"low": 20.3, "high": 23.4}
"""Arbitration duration — Uniform(20.3, 23.4) months.
Historical normal regime: avg 21.8 mo (range 20.3–23.4)."""

ARB_REMAINING_302_5: dict[str, float] = {"low": 6.0, "high": 12.0}
"""Remaining arbitration for TP-302-5 (already in hearings) — Uniform(6, 12)."""

RE_REFERRAL_CTP11_2: dict[str, float] = {"low": 3.0, "high": 7.0}
"""Re-referral to DAB for TP-CTP11-2 — Uniform(3, 7) months."""

# --- Domestic court stages (S.34 → S.37 → SLP) ---

S34_DURATION: dict[str, float] = {"low": 9, "high": 18}
"""Section 34 proceedings duration — Uniform(9, 18) months.
Historical: 12–18 months for DFCCIL matters."""

S37_DURATION: dict[str, float] = {"low": 6, "high": 12}
"""Section 37 appeal duration — Uniform(6, 12) months."""

SLP_DISMISSED_DURATION: float = 4.0
"""Fixed months for SLP dismissed without admission (gate only)."""

SLP_ADMITTED_DURATION: float = 24.0
"""Fixed months for SLP admitted and heard on merits (includes full hearing)."""

# --- SIAC court stages (HC → COA) ---

SIAC_HC_DURATION: float = 6.0
"""High Court challenge duration for SIAC awards — fixed 6 months."""

SIAC_COA_DURATION: float = 6.0
"""Court of Appeal duration for SIAC awards — fixed 6 months."""

# --- HKIAC court stages (CFI → CA → CFA) ---

HK_CFI_DURATION: dict[str, float] = {"low": 6.0, "high": 12.0}
"""Court of First Instance duration for HKIAC awards — Uniform(6, 12) months."""

HK_CA_DURATION: dict[str, float] = {"low": 6.0, "high": 9.0}
"""Court of Appeal duration for HKIAC awards — Uniform(6, 9) months."""

HK_CFA_GRANTED_DURATION: dict[str, float] = {"low": 9.0, "high": 15.0}
"""CFA duration when leave is granted — Uniform(9, 15) months."""

HK_CFA_REFUSED_DURATION: float = 2.0
"""CFA duration when leave is refused — fixed 2 months."""

# --- Payment delays ---

DOMESTIC_PAYMENT_DELAY: float = 6.0
"""Months from final domestic court resolution to payment receipt."""

SIAC_PAYMENT_DELAY: float = 4.0
"""Months from final SIAC court resolution to payment receipt."""

HKIAC_PAYMENT_DELAY: float = 3.0
"""Months from final HKIAC court resolution to payment receipt."""

RE_ARB_PAYMENT_DELAY: float = 6.0
"""Months from re-arbitration win to payment (no further court challenge)."""


# ============================================================================
# SECTION 4: ARBITRATION OUTCOME
# ============================================================================

ARB_WIN_PROBABILITY: float = 0.70
"""Probability that TATA wins at arbitration (first pass).
Expert judgment: 70% based on DFCCIL historical outcomes."""

RE_ARB_WIN_PROBABILITY: float = 0.70
"""Probability that TATA wins at re-arbitration (after RESTART).
Same as first pass — independent fresh tribunal."""


# ============================================================================
# SECTION 5: QUANTUM BANDS (conditional on arbitration WIN)
# ============================================================================

QUANTUM_BANDS: list[dict] = [
    {"low": 0.00, "high": 0.20, "probability": 0.15},
    {"low": 0.20, "high": 0.40, "probability": 0.05},
    {"low": 0.40, "high": 0.60, "probability": 0.05},
    {"low": 0.60, "high": 0.80, "probability": 0.05},
    {"low": 0.80, "high": 1.00, "probability": 0.70},
]
"""
Quantum bands as fraction of SOC, conditional on arbitration WIN.

Each band defines a range [low, high) with discrete probability.
Within a band, quantum is drawn Uniform(low, high).

E[Q|WIN] = Σ prob_i × (low_i + high_i) / 2
         = 0.15×0.10 + 0.05×0.30 + 0.05×0.50 + 0.05×0.70 + 0.70×0.90
         = 0.015 + 0.015 + 0.025 + 0.035 + 0.630
         = 0.720

Band probabilities must sum to 1.0.
"""


# ============================================================================
# SECTION 6: DOMESTIC PROBABILITY TREE (24 paths, 4 levels)
# ============================================================================
#
# After arbitration, the LOSER may challenge through Indian courts:
#   Level 1: S.34 (setting aside) — who files depends on arb outcome
#   Level 2: S.37 (appeal)
#   Level 3: SLP gate (Supreme Court leave to appeal)
#   Level 4: SLP merits (if admitted)
#
# Scenario A: TATA WON arbitration → DFCCIL challenges
# Scenario B: TATA LOST arbitration → TATA challenges
#
# Each node stores conditional probabilities for level-by-level traversal.
# The MC engine draws random numbers at each level to traverse the tree.

DOMESTIC_TREE_SCENARIO_A: dict = {
    "description": "TATA WON arbitration, DFCCIL challenges",
    "arb_won": True,
    # Level 1: S.34 — DFCCIL files to set aside award
    # W(70%) = DFCCIL's S.34 DISMISSED (award upheld) → good for TATA
    # L(30%) = DFCCIL's S.34 GRANTED (award set aside) → bad for TATA
    "s34": {
        "filer": "DFCCIL",
        "tata_wins_prob": 0.70,  # DFCCIL fails S.34 → good for TATA
        "if_tata_wins": {
            # DFCCIL S.34 dismissed (70%). DFCCIL files S.37 appeal.
            "s37": {
                "filer": "DFCCIL",
                "tata_wins_prob": 0.80,  # DFCCIL S.37 dismissed
                "if_tata_wins": {
                    # DFCCIL lost both courts. Files SLP (very weak).
                    "slp": {
                        "filer": "DFCCIL",
                        "admitted_prob": 0.10,  # 90% dismissed
                        "if_dismissed": "A1: TRUE_WIN (50.40%) — SLP dismissed [+4m]",
                        "if_admitted": {
                            "tata_wins_prob": 0.90,
                            "win": "A3: TRUE_WIN (5.04%) [+24m]",
                            "lose": "A2: LOSE (0.56%) — DFCCIL wins merits [+24m]",
                        },
                    },
                },
                "if_tata_loses": {
                    # DFCCIL won S.37 (award set aside). TATA files SLP.
                    "slp": {
                        "filer": "TATA",
                        "admitted_prob": 0.50,
                        "if_dismissed": "A4: LOSE (7.00%) — TATA SLP dismissed [+4m]",
                        "if_admitted": {
                            "tata_wins_prob": 0.50,
                            "win": "A5: TRUE_WIN (3.50%) [+24m]",
                            "lose": "A6: LOSE (3.50%) [+24m]",
                        },
                    },
                },
            },
        },
        "if_tata_loses": {
            # DFCCIL won S.34 (30%) — award set aside. TATA files S.37.
            "s37": {
                "filer": "TATA",
                "tata_wins_prob": 0.50,  # TATA wins S.37 (award restored)
                "if_tata_wins": {
                    # TATA won S.37 (award restored). DFCCIL files SLP.
                    "slp": {
                        "filer": "DFCCIL",
                        "admitted_prob": 0.25,  # 75% dismissed
                        "if_dismissed": "A7: TRUE_WIN (11.25%) [+4m]",
                        "if_admitted": {
                            "tata_wins_prob": 0.75,
                            "win": "A9: TRUE_WIN (2.81%) [+24m]",
                            "lose": "A8: LOSE (0.94%) [+24m]",
                        },
                    },
                },
                "if_tata_loses": {
                    # TATA lost S.37 (award stays set aside). TATA files SLP (weak).
                    "slp": {
                        "filer": "TATA",
                        "admitted_prob": 0.20,  # 80% dismissed
                        "if_dismissed": "A10: LOSE (12.00%) [+4m]",
                        "if_admitted": {
                            "tata_wins_prob": 0.20,
                            "win": "A11: TRUE_WIN (0.60%) [+24m]",
                            "lose": "A12: LOSE (2.40%) [+24m]",
                        },
                    },
                },
            },
        },
    },
    "totals": {
        "TRUE_WIN": "73.60%",
        "LOSE": "26.40%",
        "RESTART": "0.00%",
    },
}

# ── DOMESTIC TREE: Store as flat enumerated paths for MC sampling ──
# This representation is used by the MC engine to directly sample paths
# by drawing a single U(0,1) against cumulative probabilities.
# The level-by-level traversal approach is implemented in v2_probability_tree.py.

DOMESTIC_PATHS_A: list[dict] = [
    # Scenario A: TATA WON arbitration (prob=0.70), DFCCIL challenges
    # Format: path_id, conditional probability (within Scenario A),
    #         outcome, slp_duration, description
    #
    # Outcomes: TRUE_WIN = award survives (cash recovery)
    #           LOSE     = award set aside (no recovery)
    # No RESTART paths in Scenario A.
    #
    # Branch: DFCCIL loses S.34 (70%) → DFCCIL loses S.37 (80%) → SLP
    # DFCCIL files SLP (lost both courts). Gate: 10% admitted / 90% dismissed.
    {"path_id": "A1",
     "s34_tata_wins": True,  "s34_prob": 0.70,   # DFCCIL fails S.34
     "s37_tata_wins": True,  "s37_prob": 0.80,   # DFCCIL fails S.37
     "slp_admitted": False,  "slp_gate_prob": 0.90,  # SLP dismissed (P(dismissed)=0.90)
     "slp_merits_tata_wins": None,  "slp_merits_prob": None,
     "conditional_prob": 0.5040,   # 0.70 × 0.80 × 0.90
     "outcome": "TRUE_WIN",
     "slp_duration_months": SLP_DISMISSED_DURATION,
     "description": "S.34 DFCCIL dismissed → S.37 DFCCIL dismissed → SLP dismissed"},

    {"path_id": "A2",
     "s34_tata_wins": True,  "s34_prob": 0.70,
     "s37_tata_wins": True,  "s37_prob": 0.80,
     "slp_admitted": True,   "slp_gate_prob": 0.10,  # P(admitted)=0.10
     "slp_merits_tata_wins": False,  "slp_merits_prob": 0.10,
     "conditional_prob": 0.0056,   # 0.70 × 0.80 × 0.10 × 0.10
     "outcome": "LOSE",
     "slp_duration_months": SLP_ADMITTED_DURATION,
     "description": "S.34 DFCCIL dismissed → S.37 DFCCIL dismissed → SLP admitted → DFCCIL wins"},

    {"path_id": "A3",
     "s34_tata_wins": True,  "s34_prob": 0.70,
     "s37_tata_wins": True,  "s37_prob": 0.80,
     "slp_admitted": True,   "slp_gate_prob": 0.10,
     "slp_merits_tata_wins": True,   "slp_merits_prob": 0.90,
     "conditional_prob": 0.0504,   # 0.70 × 0.80 × 0.10 × 0.90
     "outcome": "TRUE_WIN",
     "slp_duration_months": SLP_ADMITTED_DURATION,
     "description": "S.34 DFCCIL dismissed → S.37 DFCCIL dismissed → SLP admitted → DFCCIL loses"},

    # Branch: DFCCIL loses S.34 (70%) → DFCCIL wins S.37 (20%) → SLP
    # Award set aside at S.37. TATA files SLP. Gate: 50% admitted / 50% dismissed.
    {"path_id": "A4",
     "s34_tata_wins": True,  "s34_prob": 0.70,
     "s37_tata_wins": False, "s37_prob": 0.20,
     "slp_admitted": False,  "slp_gate_prob": 0.50,  # P(dismissed)=0.50
     "slp_merits_tata_wins": None,  "slp_merits_prob": None,
     "conditional_prob": 0.0700,   # 0.70 × 0.20 × 0.50
     "outcome": "LOSE",
     "slp_duration_months": SLP_DISMISSED_DURATION,
     "description": "S.34 DFCCIL dismissed → S.37 DFCCIL wins → TATA SLP dismissed"},

    {"path_id": "A5",
     "s34_tata_wins": True,  "s34_prob": 0.70,
     "s37_tata_wins": False, "s37_prob": 0.20,
     "slp_admitted": True,   "slp_gate_prob": 0.50,  # P(admitted)=0.50
     "slp_merits_tata_wins": True,   "slp_merits_prob": 0.50,
     "conditional_prob": 0.0350,   # 0.70 × 0.20 × 0.50 × 0.50
     "outcome": "TRUE_WIN",
     "slp_duration_months": SLP_ADMITTED_DURATION,
     "description": "S.34 DFCCIL dismissed → S.37 DFCCIL wins → TATA SLP admitted → TATA wins"},

    {"path_id": "A6",
     "s34_tata_wins": True,  "s34_prob": 0.70,
     "s37_tata_wins": False, "s37_prob": 0.20,
     "slp_admitted": True,   "slp_gate_prob": 0.50,
     "slp_merits_tata_wins": False,  "slp_merits_prob": 0.50,
     "conditional_prob": 0.0350,   # 0.70 × 0.20 × 0.50 × 0.50
     "outcome": "LOSE",
     "slp_duration_months": SLP_ADMITTED_DURATION,
     "description": "S.34 DFCCIL dismissed → S.37 DFCCIL wins → TATA SLP admitted → TATA loses"},

    # Branch: DFCCIL wins S.34 (30%) → TATA wins S.37 (50%) → SLP
    # Award restored at S.37. DFCCIL files SLP. Gate: 25% admitted / 75% dismissed.
    {"path_id": "A7",
     "s34_tata_wins": False, "s34_prob": 0.30,
     "s37_tata_wins": True,  "s37_prob": 0.50,
     "slp_admitted": False,  "slp_gate_prob": 0.75,  # P(dismissed)=0.75
     "slp_merits_tata_wins": None,  "slp_merits_prob": None,
     "conditional_prob": 0.1125,   # 0.30 × 0.50 × 0.75
     "outcome": "TRUE_WIN",
     "slp_duration_months": SLP_DISMISSED_DURATION,
     "description": "S.34 DFCCIL wins → S.37 TATA wins → DFCCIL SLP dismissed"},

    {"path_id": "A8",
     "s34_tata_wins": False, "s34_prob": 0.30,
     "s37_tata_wins": True,  "s37_prob": 0.50,
     "slp_admitted": True,   "slp_gate_prob": 0.25,  # P(admitted)=0.25
     "slp_merits_tata_wins": False,  "slp_merits_prob": 0.25,
     "conditional_prob": 0.0094,   # 0.30 × 0.50 × 0.25 × 0.25 = 0.009375
     "outcome": "LOSE",
     "slp_duration_months": SLP_ADMITTED_DURATION,
     "description": "S.34 DFCCIL wins → S.37 TATA wins → DFCCIL SLP admitted → DFCCIL wins"},

    {"path_id": "A9",
     "s34_tata_wins": False, "s34_prob": 0.30,
     "s37_tata_wins": True,  "s37_prob": 0.50,
     "slp_admitted": True,   "slp_gate_prob": 0.25,
     "slp_merits_tata_wins": True,   "slp_merits_prob": 0.75,
     "conditional_prob": 0.0281,   # 0.30 × 0.50 × 0.25 × 0.75 = 0.028125
     "outcome": "TRUE_WIN",
     "slp_duration_months": SLP_ADMITTED_DURATION,
     "description": "S.34 DFCCIL wins → S.37 TATA wins → DFCCIL SLP admitted → TATA wins"},

    # Branch: DFCCIL wins S.34 (30%) → TATA loses S.37 (50%) → SLP
    # Award stays set aside. TATA files SLP (very weak). Gate: 20% admitted / 80% dismissed.
    {"path_id": "A10",
     "s34_tata_wins": False, "s34_prob": 0.30,
     "s37_tata_wins": False, "s37_prob": 0.50,
     "slp_admitted": False,  "slp_gate_prob": 0.80,  # P(dismissed)=0.80
     "slp_merits_tata_wins": None,  "slp_merits_prob": None,
     "conditional_prob": 0.1200,   # 0.30 × 0.50 × 0.80
     "outcome": "LOSE",
     "slp_duration_months": SLP_DISMISSED_DURATION,
     "description": "S.34 DFCCIL wins → S.37 TATA loses → TATA SLP dismissed"},

    {"path_id": "A11",
     "s34_tata_wins": False, "s34_prob": 0.30,
     "s37_tata_wins": False, "s37_prob": 0.50,
     "slp_admitted": True,   "slp_gate_prob": 0.20,  # P(admitted)=0.20
     "slp_merits_tata_wins": True,   "slp_merits_prob": 0.20,
     "conditional_prob": 0.0060,   # 0.30 × 0.50 × 0.20 × 0.20
     "outcome": "TRUE_WIN",
     "slp_duration_months": SLP_ADMITTED_DURATION,
     "description": "S.34 DFCCIL wins → S.37 TATA loses → TATA SLP admitted → TATA wins"},

    {"path_id": "A12",
     "s34_tata_wins": False, "s34_prob": 0.30,
     "s37_tata_wins": False, "s37_prob": 0.50,
     "slp_admitted": True,   "slp_gate_prob": 0.20,
     "slp_merits_tata_wins": False,  "slp_merits_prob": 0.80,
     "conditional_prob": 0.0240,   # 0.30 × 0.50 × 0.20 × 0.80
     "outcome": "LOSE",
     "slp_duration_months": SLP_ADMITTED_DURATION,
     "description": "S.34 DFCCIL wins → S.37 TATA loses → TATA SLP admitted → TATA loses"},
]
"""
Domestic Scenario A — TATA WON arbitration, DFCCIL challenges.
12 terminal paths. Probabilities are CONDITIONAL on Scenario A (arb_win=True).

Outcomes: TRUE_WIN (award survives, cash recovery) or LOSE (award set aside).
No RESTART paths — court loss in Scenario A is final.

Totals:
  TRUE_WIN = A1+A3+A5+A7+A9+A11 = 0.5040+0.0504+0.0350+0.1125+0.0281+0.0060 = 0.7360 (73.60%)
  LOSE     = A2+A4+A6+A8+A10+A12 = 0.0056+0.0700+0.0350+0.0094+0.1200+0.0240 = 0.2640 (26.40%)
  RESTART  = 0.0000 (0%)
  Sum      = 1.0000 (100%)
"""

DOMESTIC_PATHS_B: list[dict] = [
    # Scenario B: TATA LOST arbitration (prob=0.30), TATA challenges
    # "s34_tata_wins" = TATA's S.34 challenge succeeds (adverse award set aside).
    # "s37_tata_wins" = the outcome at S.37 is favourable for TATA.
    #
    # Outcomes: RESTART = adverse award vacated, fresh arbitration possible
    #           LOSE    = adverse award stands/restored
    # No TRUE_WIN paths in Scenario B.
    #
    # NOTE: paths[0] MUST have s34_tata_wins=True so traversal reads correct s34_prob.

    # Branch: TATA wins S.34 (30%) → DFCCIL wins S.37 (50%) → SLP
    # DFCCIL restores adverse award at S.37. TATA files SLP.
    # Gate: 25% admitted / 75% dismissed.
    {"path_id": "B7",
     "s34_tata_wins": True,  "s34_prob": 0.30,   # TATA succeeds in S.34
     "s37_tata_wins": False, "s37_prob": 0.50,    # DFCCIL wins S.37 (restores adverse award)
     "slp_admitted": False,  "slp_gate_prob": 0.75,  # P(dismissed)=0.75
     "slp_merits_tata_wins": None,  "slp_merits_prob": None,
     "conditional_prob": 0.1125,   # 0.30 × 0.50 × 0.75
     "outcome": "LOSE",
     "slp_duration_months": SLP_DISMISSED_DURATION,
     "description": "S.34 win(TATA) → S.37 DFCCIL wins → TATA SLP dismissed"},

    {"path_id": "B8",
     "s34_tata_wins": True,  "s34_prob": 0.30,
     "s37_tata_wins": False, "s37_prob": 0.50,
     "slp_admitted": True,   "slp_gate_prob": 0.25,  # P(admitted)=0.25
     "slp_merits_tata_wins": True,   "slp_merits_prob": 0.75,
     "conditional_prob": 0.028125,  # 0.30 × 0.50 × 0.25 × 0.75
     "outcome": "RESTART",
     "slp_duration_months": SLP_ADMITTED_DURATION,
     "description": "S.34 win(TATA) → S.37 DFCCIL wins → TATA SLP admitted → TATA wins"},

    {"path_id": "B9",
     "s34_tata_wins": True,  "s34_prob": 0.30,
     "s37_tata_wins": False, "s37_prob": 0.50,
     "slp_admitted": True,   "slp_gate_prob": 0.25,
     "slp_merits_tata_wins": False,  "slp_merits_prob": 0.25,
     "conditional_prob": 0.009375,  # 0.30 × 0.50 × 0.25 × 0.25
     "outcome": "LOSE",
     "slp_duration_months": SLP_ADMITTED_DURATION,
     "description": "S.34 win(TATA) → S.37 DFCCIL wins → TATA SLP admitted → TATA loses"},

    # Branch: TATA wins S.34 (30%) → TATA wins S.37 (50%) → SLP
    # Setting aside upheld. DFCCIL files SLP (lost both courts, very weak).
    # Gate: 20% admitted / 80% dismissed.
    {"path_id": "B10",
     "s34_tata_wins": True,  "s34_prob": 0.30,
     "s37_tata_wins": True,  "s37_prob": 0.50,
     "slp_admitted": False,  "slp_gate_prob": 0.80,  # P(dismissed)=0.80
     "slp_merits_tata_wins": None,  "slp_merits_prob": None,
     "conditional_prob": 0.1200,   # 0.30 × 0.50 × 0.80
     "outcome": "RESTART",
     "slp_duration_months": SLP_DISMISSED_DURATION,
     "description": "S.34 win(TATA) → S.37 win(TATA) → DFCCIL SLP dismissed → RESTART"},

    {"path_id": "B11",
     "s34_tata_wins": True,  "s34_prob": 0.30,
     "s37_tata_wins": True,  "s37_prob": 0.50,
     "slp_admitted": True,   "slp_gate_prob": 0.20,  # P(admitted)=0.20
     "slp_merits_tata_wins": False,  "slp_merits_prob": 0.80,
     "conditional_prob": 0.0240,   # 0.30 × 0.50 × 0.20 × 0.80
     "outcome": "LOSE",
     "slp_duration_months": SLP_ADMITTED_DURATION,
     "description": "S.34 win(TATA) → S.37 win(TATA) → DFCCIL SLP admitted → DFCCIL wins"},

    {"path_id": "B12",
     "s34_tata_wins": True,  "s34_prob": 0.30,
     "s37_tata_wins": True,  "s37_prob": 0.50,
     "slp_admitted": True,   "slp_gate_prob": 0.20,
     "slp_merits_tata_wins": True,   "slp_merits_prob": 0.20,
     "conditional_prob": 0.0060,   # 0.30 × 0.50 × 0.20 × 0.20
     "outcome": "RESTART",
     "slp_duration_months": SLP_ADMITTED_DURATION,
     "description": "S.34 win(TATA) → S.37 win(TATA) → DFCCIL SLP admitted → DFCCIL loses"},

    # Branch: TATA loses S.34 (70%) → TATA loses S.37 (80%) → SLP
    # Adverse award upheld at both levels. TATA files SLP (very weak).
    # Gate: 10% admitted / 90% dismissed.
    {"path_id": "B1",
     "s34_tata_wins": False, "s34_prob": 0.70,   # TATA fails S.34
     "s37_tata_wins": False, "s37_prob": 0.80,    # TATA loses S.37
     "slp_admitted": False,  "slp_gate_prob": 0.90,  # P(dismissed)=0.90
     "slp_merits_tata_wins": None,  "slp_merits_prob": None,
     "conditional_prob": 0.5040,   # 0.70 × 0.80 × 0.90
     "outcome": "LOSE",
     "slp_duration_months": SLP_DISMISSED_DURATION,
     "description": "S.34 fail → S.37 fail → TATA SLP dismissed ★ KEY PATH"},

    {"path_id": "B2",
     "s34_tata_wins": False, "s34_prob": 0.70,
     "s37_tata_wins": False, "s37_prob": 0.80,
     "slp_admitted": True,   "slp_gate_prob": 0.10,  # P(admitted)=0.10
     "slp_merits_tata_wins": True,   "slp_merits_prob": 0.20,
     "conditional_prob": 0.0112,   # 0.70 × 0.80 × 0.10 × 0.20
     "outcome": "RESTART",
     "slp_duration_months": SLP_ADMITTED_DURATION,
     "description": "S.34 fail → S.37 fail → TATA SLP admitted → TATA wins"},

    {"path_id": "B3",
     "s34_tata_wins": False, "s34_prob": 0.70,
     "s37_tata_wins": False, "s37_prob": 0.80,
     "slp_admitted": True,   "slp_gate_prob": 0.10,
     "slp_merits_tata_wins": False,  "slp_merits_prob": 0.80,
     "conditional_prob": 0.0448,   # 0.70 × 0.80 × 0.10 × 0.80
     "outcome": "LOSE",
     "slp_duration_months": SLP_ADMITTED_DURATION,
     "description": "S.34 fail → S.37 fail → TATA SLP admitted → TATA loses"},

    # Branch: TATA loses S.34 (70%) → TATA wins S.37 (20%) → SLP
    # TATA wins appeal, adverse award set aside. DFCCIL files SLP.
    # Gate: 25% admitted / 75% dismissed.
    {"path_id": "B4",
     "s34_tata_wins": False, "s34_prob": 0.70,
     "s37_tata_wins": True,  "s37_prob": 0.20,    # TATA wins S.37
     "slp_admitted": False,  "slp_gate_prob": 0.75,  # P(dismissed)=0.75
     "slp_merits_tata_wins": None,  "slp_merits_prob": None,
     "conditional_prob": 0.1050,   # 0.70 × 0.20 × 0.75
     "outcome": "RESTART",
     "slp_duration_months": SLP_DISMISSED_DURATION,
     "description": "S.34 fail → S.37 win(TATA) → DFCCIL SLP dismissed → RESTART"},

    {"path_id": "B5",
     "s34_tata_wins": False, "s34_prob": 0.70,
     "s37_tata_wins": True,  "s37_prob": 0.20,
     "slp_admitted": True,   "slp_gate_prob": 0.25,  # P(admitted)=0.25
     "slp_merits_tata_wins": False,  "slp_merits_prob": 0.25,
     "conditional_prob": 0.00875,  # 0.70 × 0.20 × 0.25 × 0.25
     "outcome": "LOSE",
     "slp_duration_months": SLP_ADMITTED_DURATION,
     "description": "S.34 fail → S.37 win(TATA) → DFCCIL SLP admitted → DFCCIL wins"},

    {"path_id": "B6",
     "s34_tata_wins": False, "s34_prob": 0.70,
     "s37_tata_wins": True,  "s37_prob": 0.20,
     "slp_admitted": True,   "slp_gate_prob": 0.25,
     "slp_merits_tata_wins": True,   "slp_merits_prob": 0.75,
     "conditional_prob": 0.02625,  # 0.70 × 0.20 × 0.25 × 0.75
     "outcome": "RESTART",
     "slp_duration_months": SLP_ADMITTED_DURATION,
     "description": "S.34 fail → S.37 win(TATA) → DFCCIL SLP admitted → DFCCIL loses"},
]
"""
Domestic Scenario B — TATA LOST arbitration, TATA challenges.
12 terminal paths. Probabilities are CONDITIONAL on Scenario B (arb_win=False).

Outcomes: RESTART (adverse award vacated, fresh arb) or LOSE (adverse award stands).
No TRUE_WIN paths — setting aside adverse award ≠ cash recovery.

NOTE: Paths ordered with s34_tata_wins=True first (B7-B12) so paths[0] has correct s34_prob.

Totals:
  TRUE_WIN = 0.0000 (0%)
  RESTART  = B2+B4+B6+B8+B10+B12 = 0.0112+0.1050+0.02625+0.028125+0.1200+0.0060 = 0.2966 (29.66%)
  LOSE     = B1+B3+B5+B7+B9+B11 = 0.5040+0.0448+0.00875+0.1125+0.009375+0.0240 = 0.7034 (70.34%)
  Sum      = 1.0000 (100%)
"""


# ============================================================================
# SECTION 7: SIAC PROBABILITY TREE (8 paths, 2 levels: HC → COA)
# ============================================================================

SIAC_PATHS_A: list[dict] = [
    # Scenario A: TATA WON arbitration, counterparty challenges
    # Outcomes: TRUE_WIN (award upheld) or LOSE (award set aside)
    # No RESTART paths in SIAC Scenario A.
    {"path_id": "SA1",
     "hc_tata_wins": True,  "hc_prob": 0.80,
     "coa_tata_wins": True, "coa_prob": 0.90,
     "conditional_prob": 0.7200,
     "outcome": "TRUE_WIN",
     "description": "HC win(TATA) → COA win(TATA)"},

    {"path_id": "SA2",
     "hc_tata_wins": True,  "hc_prob": 0.80,
     "coa_tata_wins": False, "coa_prob": 0.10,
     "conditional_prob": 0.0800,
     "outcome": "LOSE",
     "description": "HC win(TATA) → COA sets aside award"},

    {"path_id": "SA3",
     "hc_tata_wins": False, "hc_prob": 0.20,
     "coa_tata_wins": True,  "coa_prob": 0.50,
     "conditional_prob": 0.1000,
     "outcome": "TRUE_WIN",
     "description": "HC sets aside → COA restores award"},

    {"path_id": "SA4",
     "hc_tata_wins": False, "hc_prob": 0.20,
     "coa_tata_wins": False, "coa_prob": 0.50,
     "conditional_prob": 0.1000,
     "outcome": "LOSE",
     "description": "HC sets aside → COA upholds setting aside"},
]
"""
SIAC Scenario A — TATA WON arbitration, counterparty challenges.
4 terminal paths.

Outcomes: TRUE_WIN (award upheld, enforce) or LOSE (award set aside, no recovery).
No RESTART — SIAC setting aside is final under Singapore IAA.

Conditional probabilities:
  HC:  P(TATA wins) = 80%, P(TATA loses) = 20%
  COA: P(TATA wins | HC won) = 90%, P(TATA loses | HC won) = 10%
  COA: P(TATA wins | HC lost) = 50%, P(TATA loses | HC lost) = 50%

Totals:
  TRUE_WIN = SA1+SA3 = 0.7200+0.1000 = 0.8200 (82.00%)
  LOSE     = SA2+SA4 = 0.0800+0.1000 = 0.1800 (18.00%)
  RESTART  = 0.0000 (0%)
  Sum      = 1.0000 (100%)
"""

SIAC_PATHS_B: list[dict] = [
    # Scenario B: TATA LOST arbitration, TATA challenges
    {"path_id": "SB1",
     "hc_tata_wins": True,  "hc_prob": 0.20,
     "coa_tata_wins": True,  "coa_prob": 0.10,
     "conditional_prob": 0.0200,
     "outcome": "RESTART",
     "description": "HC win(TATA) → COA win(TATA)"},

    {"path_id": "SB2",
     "hc_tata_wins": True,  "hc_prob": 0.20,
     "coa_tata_wins": False, "coa_prob": 0.90,
     "conditional_prob": 0.1800,
     "outcome": "LOSE",
     "description": "HC win(TATA) → COA lose(TATA)"},

    {"path_id": "SB3",
     "hc_tata_wins": False, "hc_prob": 0.80,
     "coa_tata_wins": True,  "coa_prob": 0.50,
     "conditional_prob": 0.4000,
     "outcome": "RESTART",
     "description": "HC lose(TATA) → COA win(TATA)"},

    {"path_id": "SB4",
     "hc_tata_wins": False, "hc_prob": 0.80,
     "coa_tata_wins": False, "coa_prob": 0.50,
     "conditional_prob": 0.4000,
     "outcome": "LOSE",
     "description": "HC lose(TATA) → COA lose(TATA)"},
]
"""
SIAC Scenario B — TATA LOST arbitration, TATA challenges.
4 terminal paths.

Conditional probabilities (inverted from Scenario A — TATA is now the challenger):
  HC:  P(TATA wins) = 20%, P(TATA loses) = 80%
  COA: P(TATA wins | HC won) = 10%, P(TATA loses | HC won) = 90%
  COA: P(TATA wins | HC lost) = 50%, P(TATA loses | HC lost) = 50%

Totals:
  TRUE_WIN = 0.0000 (0%)
  RESTART  = SB1+SB3 = 0.0200+0.4000 = 0.4200 (42.00%)
  LOSE     = SB2+SB4 = 0.1800+0.4000 = 0.5800 (58.00%)
  Sum      = 1.0000 (100%)
"""


# ============================================================================
# SECTION 7b: HKIAC PROBABILITY TREE (24 paths, 3 levels: CFI → CA → CFA)
# ============================================================================
#
# After arbitration, the LOSER may challenge through Hong Kong courts:
#   Level 1: CFI (Court of First Instance) — setting aside application
#   Level 2: CA (Court of Appeal)
#   Level 3: CFA (Court of Final Appeal) — with leave gate
#
# Scenario A: TATA WON arbitration → counterparty challenges
# Scenario B: TATA LOST arbitration → TATA challenges
#
# Each path stores node-level probabilities for level-by-level traversal.
# The CFA has a leave gate: if leave refused, the path terminates there.

HKIAC_PATHS_A: list[dict] = [
    # Scenario A: TATA WON arbitration, counterparty challenges
    # 12 terminal paths. Outcomes: TRUE_WIN or LOSE. No RESTART.
    #
    # Format per path:
    #   cfi_tata_wins: bool — CFI upholds award (good for TATA)
    #   cfi_prob: float — P(cfi_tata_wins=True) at CFI level
    #   ca_tata_wins: bool — CA upholds TATA's position
    #   ca_prob: float — P(ca_tata_wins=True) at CA level given CFI outcome
    #   cfa_leave_granted: bool — CFA grants leave to appeal
    #   cfa_leave_prob: float — P(cfa_leave_granted=True)
    #   cfa_tata_wins: bool|None — CFA merits outcome (None if leave refused)
    #   cfa_merits_prob: float|None — P(cfa_tata_wins=True) if leave granted

    # Branch: CFI upheld (0.85) → CA upheld (0.85) → CFA
    {"path_id": "HA1",
     "cfi_tata_wins": True,  "cfi_prob": 0.85,
     "ca_tata_wins": True,   "ca_prob": 0.85,
     "cfa_leave_granted": False, "cfa_leave_prob": 0.08,
     "cfa_tata_wins": None,  "cfa_merits_prob": None,
     "conditional_prob": 0.6647,
     "outcome": "TRUE_WIN",
     "description": "CFI upheld → CA upheld → CFA leave refused"},

    {"path_id": "HA2",
     "cfi_tata_wins": True,  "cfi_prob": 0.85,
     "ca_tata_wins": True,   "ca_prob": 0.85,
     "cfa_leave_granted": True, "cfa_leave_prob": 0.08,
     "cfa_tata_wins": True,  "cfa_merits_prob": 0.80,
     "conditional_prob": 0.0462,
     "outcome": "TRUE_WIN",
     "description": "CFI upheld → CA upheld → CFA granted → CFA upholds"},

    {"path_id": "HA3",
     "cfi_tata_wins": True,  "cfi_prob": 0.85,
     "ca_tata_wins": True,   "ca_prob": 0.85,
     "cfa_leave_granted": True, "cfa_leave_prob": 0.08,
     "cfa_tata_wins": False, "cfa_merits_prob": 0.20,
     "conditional_prob": 0.0116,
     "outcome": "LOSE",
     "description": "CFI upheld → CA upheld → CFA granted → CFA overturns"},

    # Branch: CFI upheld (0.85) → CA set aside (0.15) → CFA
    {"path_id": "HA4",
     "cfi_tata_wins": True,  "cfi_prob": 0.85,
     "ca_tata_wins": False,  "ca_prob": 0.15,
     "cfa_leave_granted": False, "cfa_leave_prob": 0.20,
     "cfa_tata_wins": None,  "cfa_merits_prob": None,
     "conditional_prob": 0.1020,
     "outcome": "LOSE",
     "description": "CFI upheld → CA set aside → CFA leave refused"},

    {"path_id": "HA5",
     "cfi_tata_wins": True,  "cfi_prob": 0.85,
     "ca_tata_wins": False,  "ca_prob": 0.15,
     "cfa_leave_granted": True, "cfa_leave_prob": 0.20,
     "cfa_tata_wins": True,  "cfa_merits_prob": 0.60,
     "conditional_prob": 0.0153,
     "outcome": "TRUE_WIN",
     "description": "CFI upheld → CA set aside → CFA granted → CFA restores"},

    {"path_id": "HA6",
     "cfi_tata_wins": True,  "cfi_prob": 0.85,
     "ca_tata_wins": False,  "ca_prob": 0.15,
     "cfa_leave_granted": True, "cfa_leave_prob": 0.20,
     "cfa_tata_wins": False, "cfa_merits_prob": 0.40,
     "conditional_prob": 0.0102,
     "outcome": "LOSE",
     "description": "CFI upheld → CA set aside → CFA granted → CFA upholds set aside"},

    # Branch: CFI set aside (0.15) → CA restores (0.55) → CFA
    {"path_id": "HA7",
     "cfi_tata_wins": False, "cfi_prob": 0.15,
     "ca_tata_wins": True,   "ca_prob": 0.55,
     "cfa_leave_granted": False, "cfa_leave_prob": 0.15,
     "cfa_tata_wins": None,  "cfa_merits_prob": None,
     "conditional_prob": 0.0701,
     "outcome": "TRUE_WIN",
     "description": "CFI set aside → CA restores → CFA leave refused"},

    {"path_id": "HA8",
     "cfi_tata_wins": False, "cfi_prob": 0.15,
     "ca_tata_wins": True,   "ca_prob": 0.55,
     "cfa_leave_granted": True, "cfa_leave_prob": 0.15,
     "cfa_tata_wins": True,  "cfa_merits_prob": 0.55,
     "conditional_prob": 0.0068,
     "outcome": "TRUE_WIN",
     "description": "CFI set aside → CA restores → CFA granted → CFA upholds restore"},

    {"path_id": "HA9",
     "cfi_tata_wins": False, "cfi_prob": 0.15,
     "ca_tata_wins": True,   "ca_prob": 0.55,
     "cfa_leave_granted": True, "cfa_leave_prob": 0.15,
     "cfa_tata_wins": False, "cfa_merits_prob": 0.45,
     "conditional_prob": 0.0056,
     "outcome": "LOSE",
     "description": "CFI set aside → CA restores → CFA granted → CFA overturns"},

    # Branch: CFI set aside (0.15) → CA upholds set aside (0.45) → CFA
    {"path_id": "HA10",
     "cfi_tata_wins": False, "cfi_prob": 0.15,
     "ca_tata_wins": False,  "ca_prob": 0.45,
     "cfa_leave_granted": False, "cfa_leave_prob": 0.25,
     "cfa_tata_wins": None,  "cfa_merits_prob": None,
     "conditional_prob": 0.0506,
     "outcome": "LOSE",
     "description": "CFI set aside → CA upholds set aside → CFA leave refused"},

    {"path_id": "HA11",
     "cfi_tata_wins": False, "cfi_prob": 0.15,
     "ca_tata_wins": False,  "ca_prob": 0.45,
     "cfa_leave_granted": True, "cfa_leave_prob": 0.25,
     "cfa_tata_wins": True,  "cfa_merits_prob": 0.45,
     "conditional_prob": 0.0076,
     "outcome": "TRUE_WIN",
     "description": "CFI set aside → CA upholds set aside → CFA granted → CFA restores"},

    {"path_id": "HA12",
     "cfi_tata_wins": False, "cfi_prob": 0.15,
     "ca_tata_wins": False,  "ca_prob": 0.45,
     "cfa_leave_granted": True, "cfa_leave_prob": 0.25,
     "cfa_tata_wins": False, "cfa_merits_prob": 0.55,
     "conditional_prob": 0.0093,
     "outcome": "LOSE",
     "description": "CFI set aside → CA upholds set aside → CFA granted → CFA upholds"},
]
"""
HKIAC Scenario A — TATA WON arbitration, counterparty challenges.
12 terminal paths. 3 levels: CFI → CA → CFA (with leave gate).

Outcomes: TRUE_WIN (award survives, enforce) or LOSE (award set aside).
No RESTART paths in Scenario A.

Totals:
  TRUE_WIN = HA1+HA2+HA5+HA7+HA8+HA11 = 0.6647+0.0462+0.0153+0.0701+0.0068+0.0076 = 0.8107 (81.07%)
  LOSE     = HA3+HA4+HA6+HA9+HA10+HA12 = 0.0116+0.1020+0.0102+0.0056+0.0506+0.0093 = 0.1893 (18.93%)
  RESTART  = 0.0000 (0%)
  Sum      = 1.0000 (100%) [0.0004 rounding]
"""

HKIAC_PATHS_B: list[dict] = [
    # Scenario B: TATA LOST arbitration, TATA challenges
    # 12 terminal paths. Outcomes: RESTART or LOSE. No TRUE_WIN.
    #
    # NOTE: paths[0] MUST have cfi_tata_wins=True so traversal reads correct cfi_prob.

    # Branch: CFI overturns (0.20) → CA upholds overturn (0.50) → CFA
    {"path_id": "HB1",
     "cfi_tata_wins": True,  "cfi_prob": 0.20,
     "ca_tata_wins": True,   "ca_prob": 0.50,
     "cfa_leave_granted": False, "cfa_leave_prob": 0.15,
     "cfa_tata_wins": None,  "cfa_merits_prob": None,
     "conditional_prob": 0.0850,
     "outcome": "RESTART",
     "description": "CFI overturns → CA upholds → CFA leave refused"},

    {"path_id": "HB2",
     "cfi_tata_wins": True,  "cfi_prob": 0.20,
     "ca_tata_wins": True,   "ca_prob": 0.50,
     "cfa_leave_granted": True, "cfa_leave_prob": 0.15,
     "cfa_tata_wins": True,  "cfa_merits_prob": 0.50,
     "conditional_prob": 0.0075,
     "outcome": "RESTART",
     "description": "CFI overturns → CA upholds → CFA granted → CFA upholds"},

    {"path_id": "HB3",
     "cfi_tata_wins": True,  "cfi_prob": 0.20,
     "ca_tata_wins": True,   "ca_prob": 0.50,
     "cfa_leave_granted": True, "cfa_leave_prob": 0.15,
     "cfa_tata_wins": False, "cfa_merits_prob": 0.50,
     "conditional_prob": 0.0075,
     "outcome": "LOSE",
     "description": "CFI overturns → CA upholds → CFA granted → CFA overturns"},

    # Branch: CFI overturns (0.20) → CA restores adverse (0.50) → CFA
    {"path_id": "HB4",
     "cfi_tata_wins": True,  "cfi_prob": 0.20,
     "ca_tata_wins": False,  "ca_prob": 0.50,
     "cfa_leave_granted": False, "cfa_leave_prob": 0.25,
     "cfa_tata_wins": None,  "cfa_merits_prob": None,
     "conditional_prob": 0.0750,
     "outcome": "LOSE",
     "description": "CFI overturns → CA restores adverse → CFA leave refused"},

    {"path_id": "HB5",
     "cfi_tata_wins": True,  "cfi_prob": 0.20,
     "ca_tata_wins": False,  "ca_prob": 0.50,
     "cfa_leave_granted": True, "cfa_leave_prob": 0.25,
     "cfa_tata_wins": True,  "cfa_merits_prob": 0.45,
     "conditional_prob": 0.0113,
     "outcome": "RESTART",
     "description": "CFI overturns → CA restores adverse → CFA granted → CFA overturns adverse"},

    {"path_id": "HB6",
     "cfi_tata_wins": True,  "cfi_prob": 0.20,
     "ca_tata_wins": False,  "ca_prob": 0.50,
     "cfa_leave_granted": True, "cfa_leave_prob": 0.25,
     "cfa_tata_wins": False, "cfa_merits_prob": 0.55,
     "conditional_prob": 0.0138,
     "outcome": "LOSE",
     "description": "CFI overturns → CA restores adverse → CFA granted → CFA upholds adverse"},

    # Branch: CFI upholds adverse (0.80) → CA overturns adverse (0.25) → CFA
    {"path_id": "HB7",
     "cfi_tata_wins": False, "cfi_prob": 0.80,
     "ca_tata_wins": True,   "ca_prob": 0.25,
     "cfa_leave_granted": False, "cfa_leave_prob": 0.20,
     "cfa_tata_wins": None,  "cfa_merits_prob": None,
     "conditional_prob": 0.1600,
     "outcome": "RESTART",
     "description": "CFI upholds adverse → CA overturns → CFA leave refused"},

    {"path_id": "HB8",
     "cfi_tata_wins": False, "cfi_prob": 0.80,
     "ca_tata_wins": True,   "ca_prob": 0.25,
     "cfa_leave_granted": True, "cfa_leave_prob": 0.20,
     "cfa_tata_wins": True,  "cfa_merits_prob": 0.45,
     "conditional_prob": 0.0180,
     "outcome": "RESTART",
     "description": "CFI upholds adverse → CA overturns → CFA granted → CFA upholds overturn"},

    {"path_id": "HB9",
     "cfi_tata_wins": False, "cfi_prob": 0.80,
     "ca_tata_wins": True,   "ca_prob": 0.25,
     "cfa_leave_granted": True, "cfa_leave_prob": 0.20,
     "cfa_tata_wins": False, "cfa_merits_prob": 0.55,
     "conditional_prob": 0.0220,
     "outcome": "LOSE",
     "description": "CFI upholds adverse → CA overturns → CFA granted → CFA restores adverse"},

    # Branch: CFI upholds adverse (0.80) → CA upholds adverse (0.75) → CFA
    {"path_id": "HB10",
     "cfi_tata_wins": False, "cfi_prob": 0.80,
     "ca_tata_wins": False,  "ca_prob": 0.75,
     "cfa_leave_granted": False, "cfa_leave_prob": 0.15,
     "cfa_tata_wins": None,  "cfa_merits_prob": None,
     "conditional_prob": 0.5100,
     "outcome": "LOSE",
     "description": "CFI upholds adverse → CA upholds adverse → CFA leave refused"},

    {"path_id": "HB11",
     "cfi_tata_wins": False, "cfi_prob": 0.80,
     "ca_tata_wins": False,  "ca_prob": 0.75,
     "cfa_leave_granted": True, "cfa_leave_prob": 0.15,
     "cfa_tata_wins": True,  "cfa_merits_prob": 0.35,
     "conditional_prob": 0.0315,
     "outcome": "RESTART",
     "description": "CFI upholds adverse → CA upholds adverse → CFA granted → CFA overturns"},

    {"path_id": "HB12",
     "cfi_tata_wins": False, "cfi_prob": 0.80,
     "ca_tata_wins": False,  "ca_prob": 0.75,
     "cfa_leave_granted": True, "cfa_leave_prob": 0.15,
     "cfa_tata_wins": False, "cfa_merits_prob": 0.65,
     "conditional_prob": 0.0585,
     "outcome": "LOSE",
     "description": "CFI upholds adverse → CA upholds adverse → CFA granted → CFA upholds"},
]
"""
HKIAC Scenario B — TATA LOST arbitration, TATA challenges.
12 terminal paths. 3 levels: CFI → CA → CFA (with leave gate).

Outcomes: RESTART (adverse award vacated, fresh arb) or LOSE (adverse award stands).
No TRUE_WIN paths in Scenario B.

NOTE: Paths ordered with cfi_tata_wins=True first (HB1-HB6) so paths[0] has correct cfi_prob.

Totals:
  TRUE_WIN = 0.0000 (0%)
  RESTART  = HB1+HB2+HB5+HB7+HB8+HB11 = 0.0850+0.0075+0.0113+0.1600+0.0180+0.0315 = 0.3133 (31.33%)
  LOSE     = HB3+HB4+HB6+HB9+HB10+HB12 = 0.0075+0.0750+0.0138+0.0220+0.5100+0.0585 = 0.6868 (68.68%)
  Sum      = 1.0001 (100%) [0.0001 rounding]
"""


# ============================================================================
# SECTION 8: INVESTMENT STRUCTURE (TATA'S PERSPECTIVE)
# ============================================================================
# All percentages now show what TATA receives, not what fund keeps

# Upfront payment to Tata as % of SOC
UPFRONT_PCT_SOC: list[float] = [0.05, 0.10,  0.15, 0.20, 0.25, 0.30]
"""Upfront investment as percentage of SOC. 6 levels."""

# Tail payment to Tata as % of received award
# Fund keeps (1 - tata_tail_pct) of the award
TATA_TAIL_PCT: list[float] = [0.10, 0.15, 0.20, 0.25, 0.30, 0.35, 0.40, 0.45, 0.50]
"""Tata's share of the received award (tail payment). 9 levels.
Fund keeps (1 - tata_tail_pct). Grid: 6 × 9 = 54 combinations."""

# Backward compat alias: fund's share = 1 - tata_tail_pct
AWARD_SHARE_PCT: list[float] = [round(1.0 - t, 2) for t in TATA_TAIL_PCT]
"""DEPRECATED: Fund's share of award. Derived from TATA_TAIL_PCT.
= [0.90, 0.85, 0.80, 0.75, 0.70, 0.65, 0.60, 0.55, 0.50]
If old code references AWARD_SHARE_PCT, compute as: 1 - TATA_TAIL_PCT."""


# ============================================================================
# SECTION 9: LEGAL COSTS (₹ Crores)
# ============================================================================
# One-time costs: paid at Month 0 (with upfront investment)
# Duration-based costs: total cost spread over stage duration

LEGAL_COSTS: dict = {
    # ONE-TIME COSTS (Month 0) — per claim
    "onetime": {
        "tribunal": 6.0,   # ₹Cr — one-time, average of ₹5-7Cr range
        "expert": 2.0,     # ₹Cr — one-time fixed expense (NOT annual)
    },

    # STAGE TOTAL COSTS — fixed total per stage, NOT annual rates.
    # Each is the total cost for the entire stage duration.
    # The model spreads this total evenly over the stage's months.
    "duration_based": {
        "dab": {"low": 0.50, "high": 1.0},             # ₹50L-₹1Cr total for DAB stage
        "arb_counsel": 8.0,                             # ₹8Cr TOTAL for entire arbitration (NOT per year)
        "s34": {"low": 2.0, "high": 3.0},              # ₹2-3Cr total for S.34 stage
        "s37": {"low": 1.0, "high": 2.0},              # ₹1-2Cr total for S.37 stage
        "slp_dismissed": {"low": 0.50, "high": 1.0},   # ₹50L-₹1Cr if SLP dismissed at admission
        "slp_admitted": {"low": 2.0, "high": 3.0},     # ₹2-3Cr if SLP admitted to hearing
        "siac_hc": {"low": 3.0, "high": 4.0},          # ₹3-4Cr total for Singapore HC stage
        "siac_coa": 2.0,                                # ₹2Cr total for Court of Appeal stage
        "hk_cfi": {"low": 3.0, "high": 5.0},           # ₹3-5Cr total for Hong Kong CFI stage
        "hk_ca": {"low": 2.5, "high": 4.0},            # ₹2.5-4Cr total for Hong Kong CA stage
        "hk_cfa": {"low": 2.0, "high": 3.5},           # ₹2-3.5Cr total for Hong Kong CFA stage
    },
}
"""
Legal cost structure for each claim.

ONE-TIME costs (tribunal + expert) are incurred at Month 0 for each claim.
  - Tribunal: ₹5-7 Cr (one-time arbitration tribunal fee)
  - Expert:   ₹2 Cr   (one-time expert engagement, NOT annual)

STAGE TOTAL costs are the TOTAL cost for the entire stage, NOT annual rates.
  - arb_counsel: ₹8 Cr = total counsel fees for entire arbitration
    (the model spreads this total across the arbitration months)
  - All other stages: fixed total (or low/high range) for that stage

For ranges (low/high), the midpoint (low + high) / 2 is used as the
deterministic base. Stochastic overrun multiplier is applied on top.

SLP costs are stochastic: depend on whether SLP is admitted or dismissed
(determined by the probability tree traversal).
"""

# Stochastic overrun parameters (from v1 — kept as-is)
LEGAL_COST_OVERRUN: dict = {
    "alpha": 2,
    "beta": 5,
    "low": -0.10,
    "high": 0.60,
}
"""
ScaledBeta distribution for legal cost overrun multiplier.
E[overrun] = low + (α/(α+β)) × (high - low)
           = -0.10 + (2/7) × 0.70 = +0.10 = +10% mean overrun.
Applied as: actual_cost = base_cost × (1 + ε), ε ~ ScaledBeta.
"""


# ============================================================================
# SECTION 10: FINANCIAL PARAMETERS
# ============================================================================

DISCOUNT_RATE: float = 0.12
"""Annual discount rate (hurdle rate).  Range: 0.05-0.30.  Default: 12%."""

RISK_FREE_RATE: float = 0.07
"""Risk-free rate (annualized).  Range: 0.02-0.15.  Default: 7%."""


# ============================================================================
# SECTION 10a: INTEREST ACCUMULATION ON AWARDED QUANTUM
# ============================================================================

INTEREST_ENABLED: bool = False
"""If True, interest accrues on the awarded quantum. Default: off."""

INTEREST_RATE_DOMESTIC: float = 0.09
"""Annual interest rate for domestic claims (e.g., 0.09 = 9% p.a.).
DEPRECATED — used as fallback when INTEREST_RATE_BANDS_DOMESTIC is empty."""

INTEREST_RATE_SIAC: float = 0.09
"""Annual interest rate for SIAC claims (e.g., 0.09 = 9% p.a.).
DEPRECATED — used as fallback when INTEREST_RATE_BANDS_SIAC is empty."""

INTEREST_TYPE_DOMESTIC: str = "simple"
"""Interest calculation type for domestic: 'simple' or 'compound'."""

INTEREST_TYPE_SIAC: str = "simple"
"""Interest calculation type for SIAC: 'simple' or 'compound'."""

INTEREST_RATE_BANDS_DOMESTIC: list[dict] = [
    {"rate": 0.09, "type": "simple", "probability": 1.0},
]
"""Stochastic interest rate distribution for domestic claims.
Each entry: {rate: float, type: 'simple'|'compound', probability: float}.
Probabilities must sum to 1.0. In each MC path, one band is drawn."""

INTEREST_RATE_BANDS_SIAC: list[dict] = [
    {"rate": 0.09, "type": "simple", "probability": 1.0},
]
"""Stochastic interest rate distribution for SIAC claims."""

INTEREST_RATE_BANDS_HKIAC: list[dict] = [
    {"rate": 0.07, "type": "simple", "probability": 1.0},
]
"""Stochastic interest rate distribution for HKIAC claims (7% p.a.)."""

INTEREST_START_BASIS: str = "award_date"
"""When interest accrual begins. Options:
  'award_date'          — from arbitration award to payment (original behaviour)
  'dab_commencement'    — from each claim's DAB commencement date to payment
"""

# DAB commencement dates are stored per-claim inside CLAIMS[].dab_commencement_date
# and used only when INTEREST_START_BASIS == 'dab_commencement'.


# ============================================================================
# SECTION 11: REPORT SETTINGS
# ============================================================================

REPORT_OUTPUT_DIR: str = "TATA_code_v2/outputs/"
"""Directory for all output files (created if not exists)."""

EXCEL_OUTPUT_NAME: str = "TATA_V2_Valuation_Model.xlsx"
"""Main Excel workbook filename."""

PDF_REPORT_NAME: str = "TATA_V2_Investment_Analysis.pdf"
"""PDF report filename."""


# ============================================================================
# SECTION 12: STOCHASTIC PRICING GRID
# ============================================================================

STOCHASTIC_PRICING: dict = {
    # Upfront payment to Tata as % of SOC (or E[Q] if eq_based)
    "upfront_pct_grid": [5, 7.5, 10, 12.5, 15, 17.5, 20, 22.5, 25, 27.5, 30],  # 11 values

    # Tail payment to Tata as % of award received
    "tata_tail_pct_grid": [10, 15, 20, 25, 30, 35, 40, 45, 50],  # 9 values

    # Simulations per combination (uses pre-computed MC paths)
    "sims_per_combo": 2000,

    # Total combinations: 11 × 9 = 99
    # Total evaluations: 99 × N_SIMULATIONS × 6 claims
}
"""Stochastic pricing grid parameters for dashboard pre-computation.
Finer granularity than the standard 6×9 investment grid."""

# Metrics to compute per combination
STOCHASTIC_METRICS: list[str] = [
    "e_moic",      # Expected MOIC
    "e_irr",       # Expected IRR (annualized, MOIC-implied)
    "p5_moic", "p25_moic", "p50_moic", "p75_moic", "p95_moic",
    "p5_irr", "p25_irr", "p50_irr", "p75_irr", "p95_irr",
    "prob_loss",   # P(MOIC < 1.0)
    "prob_hurdle", # P(IRR > 30%)
]
"""Metrics computed for each (upfront%, tail%) combination."""

# ============================================================================
# SECTION 13: PORTFOLIO MODES
# ============================================================================

PORTFOLIO_MODES: dict = {
    "all": {
        "filter": None,
        "label": "Full Portfolio (6 Claims)",
        "theme_color": "4A148C",       # purple
        "output_dir": "TATA_code_v2/outputs/",
        "output_prefix": "",
    },
    "siac": {
        "filter": "siac",
        "label": "SIAC Portfolio (3 Claims)",
        "theme_color": "1B5E20",       # green
        "output_dir": "TATA_code_v2/outputs_siac/",
        "output_prefix": "_SIAC",
    },
    "domestic": {
        "filter": "domestic",
        "label": "Domestic Portfolio (3 Claims)",
        "theme_color": "2E75B6",       # blue
        "output_dir": "TATA_code_v2/outputs_domestic/",
        "output_prefix": "_Domestic",
    },
}
"""
Portfolio mode definitions.  Each mode filters claims by jurisdiction.
  - "all"      → all 6 claims (no filter)
  - "siac"     → 3 SIAC claims (TP-CTP11-2, TP-CTP11-4, TP-CTP13-2)
  - "domestic" → 3 domestic claims (TP-301-6, TP-302-3, TP-302-5)
"""

DEFAULT_PORTFOLIO_MODE: str = "all"


# ============================================================================
# SECTION 14: JURISDICTION-SPECIFIC INVESTMENT GRIDS
# ============================================================================
# Each grid defines upfront% and tail% ranges with step sizes.
# SIAC and full portfolios share the same union grid.
# Domestic grid has a higher tail floor (10% vs 5%).

INVESTMENT_GRID_ALL: dict = {
    "upfront_pcts": [0.05, 0.075, 0.10, 0.125, 0.15, 0.175, 0.20, 0.225, 0.25, 0.275, 0.30, 0.325, 0.35],
    "tata_tail_pcts": [0.05, 0.10, 0.15, 0.20, 0.25, 0.30, 0.35, 0.40, 0.45, 0.50, 0.55, 0.60],
    "label": "Full Portfolio Grid (13×12 = 156 combinations)",
}
"""Union grid: upfront 5–35% (2.5% step), tail 5–60% (5% step)."""

INVESTMENT_GRID_SIAC: dict = {
    "upfront_pcts": [0.05, 0.075, 0.10, 0.125, 0.15, 0.175, 0.20, 0.225, 0.25, 0.275, 0.30, 0.325, 0.35],
    "tata_tail_pcts": [0.05, 0.10, 0.15, 0.20, 0.25, 0.30, 0.35, 0.40, 0.45, 0.50, 0.55, 0.60],
    "label": "SIAC Granular Grid (13×12 = 156 combinations)",
}
"""SIAC grid: upfront 5–35% (2.5% step), tail 5–60% (5% step)."""

INVESTMENT_GRID_DOMESTIC: dict = {
    "upfront_pcts": [0.05, 0.075, 0.10, 0.125, 0.15, 0.175, 0.20, 0.225, 0.25, 0.275, 0.30, 0.325, 0.35],
    "tata_tail_pcts": [0.10, 0.15, 0.20, 0.25, 0.30, 0.35, 0.40, 0.45, 0.50, 0.55, 0.60],
    "label": "Domestic Grid (13×11 = 143 combinations)",
}
"""Domestic grid: upfront 5–35% (2.5% step), tail 10–60% (5% step)."""


# ============================================================================
# SECTION 15: JURISDICTION-SPECIFIC STOCHASTIC GRIDS
# ============================================================================

STOCHASTIC_GRID_ALL: dict = {
    "upfront_pct_grid": [5, 7.5, 10, 12.5, 15, 17.5, 20, 22.5, 25, 27.5, 30, 32.5, 35],
    "tata_tail_pct_grid": [5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60],
    "sims_per_combo": 2000,
}
"""Stochastic grid for full portfolio: 13×12 = 156 combos."""

STOCHASTIC_GRID_SIAC: dict = {
    "upfront_pct_grid": [5, 7.5, 10, 12.5, 15, 17.5, 20, 22.5, 25, 27.5, 30, 32.5, 35],
    "tata_tail_pct_grid": [5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60],
    "sims_per_combo": 2000,
}
"""Stochastic grid for SIAC portfolio: 13×12 = 156 combos."""

STOCHASTIC_GRID_DOMESTIC: dict = {
    "upfront_pct_grid": [5, 7.5, 10, 12.5, 15, 17.5, 20, 22.5, 25, 27.5, 30, 32.5, 35],
    "tata_tail_pct_grid": [10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60],
    "sims_per_combo": 2000,
}
"""Stochastic grid for domestic portfolio: 13×11 = 143 combos."""


# ============================================================================
# SECTION 16: COMPARISON OUTPUT SETTINGS
# ============================================================================

OUTPUT_DIR_COMPARE: str = "TATA_code_v2/outputs_comparison/"
"""Directory for cross-portfolio comparison outputs."""

# ============================================================================
# SECTION 17: CONFIG OVERRIDE (JSON file)
# ============================================================================

def _recompute_domestic_paths_a(n: dict) -> list:
    """Recompute DOMESTIC_PATHS_A from 11 node probabilities.

    Parameters
    ----------
    n : dict with keys:
        s34_tata_wins, s37_tata_wins_given_s34_win,
        slp_gate_dismiss_s34w_s37w, slp_merits_tata_wins_s34w_s37w,
        slp_gate_dismiss_s34w_s37l, slp_merits_tata_wins_s34w_s37l,
        s37_tata_wins_given_s34_lose,
        slp_gate_dismiss_s34l_s37w, slp_merits_tata_wins_s34l_s37w,
        slp_gate_dismiss_s34l_s37l, slp_merits_tata_wins_s34l_s37l
    """
    p1  = n["s34_tata_wins"]
    p2  = n["s37_tata_wins_given_s34_win"]
    p3  = n["slp_gate_dismiss_s34w_s37w"]
    p4  = n["slp_merits_tata_wins_s34w_s37w"]
    p5  = n["slp_gate_dismiss_s34w_s37l"]
    p6  = n["slp_merits_tata_wins_s34w_s37l"]
    p7  = n["s37_tata_wins_given_s34_lose"]
    p8  = n["slp_gate_dismiss_s34l_s37w"]
    p9  = n["slp_merits_tata_wins_s34l_s37w"]
    p10 = n["slp_gate_dismiss_s34l_s37l"]
    p11 = n["slp_merits_tata_wins_s34l_s37l"]

    return [
        # ── Branch: s34 W, s37 W ──
        {"path_id": "A1",
         "s34_tata_wins": True,  "s34_prob": p1,
         "s37_tata_wins": True,  "s37_prob": p2,
         "slp_admitted": False,  "slp_gate_prob": p3,
         "slp_merits_tata_wins": None,  "slp_merits_prob": None,
         "conditional_prob": p1 * p2 * p3,
         "outcome": "TRUE_WIN",
         "slp_duration_months": SLP_DISMISSED_DURATION,
         "description": "S.34 DFCCIL dismissed \u2192 S.37 DFCCIL dismissed \u2192 SLP dismissed"},

        {"path_id": "A2",
         "s34_tata_wins": True,  "s34_prob": p1,
         "s37_tata_wins": True,  "s37_prob": p2,
         "slp_admitted": True,   "slp_gate_prob": 1.0 - p3,
         "slp_merits_tata_wins": False,  "slp_merits_prob": 1.0 - p4,
         "conditional_prob": p1 * p2 * (1.0 - p3) * (1.0 - p4),
         "outcome": "LOSE",
         "slp_duration_months": SLP_ADMITTED_DURATION,
         "description": "S.34 DFCCIL dismissed \u2192 S.37 DFCCIL dismissed \u2192 SLP admitted \u2192 DFCCIL wins"},

        {"path_id": "A3",
         "s34_tata_wins": True,  "s34_prob": p1,
         "s37_tata_wins": True,  "s37_prob": p2,
         "slp_admitted": True,   "slp_gate_prob": 1.0 - p3,
         "slp_merits_tata_wins": True,   "slp_merits_prob": p4,
         "conditional_prob": p1 * p2 * (1.0 - p3) * p4,
         "outcome": "TRUE_WIN",
         "slp_duration_months": SLP_ADMITTED_DURATION,
         "description": "S.34 DFCCIL dismissed \u2192 S.37 DFCCIL dismissed \u2192 SLP admitted \u2192 DFCCIL loses"},

        # ── Branch: s34 W, s37 L ──
        {"path_id": "A4",
         "s34_tata_wins": True,  "s34_prob": p1,
         "s37_tata_wins": False, "s37_prob": 1.0 - p2,
         "slp_admitted": False,  "slp_gate_prob": p5,
         "slp_merits_tata_wins": None,  "slp_merits_prob": None,
         "conditional_prob": p1 * (1.0 - p2) * p5,
         "outcome": "LOSE",
         "slp_duration_months": SLP_DISMISSED_DURATION,
         "description": "S.34 DFCCIL dismissed \u2192 S.37 DFCCIL wins \u2192 TATA SLP dismissed"},

        {"path_id": "A5",
         "s34_tata_wins": True,  "s34_prob": p1,
         "s37_tata_wins": False, "s37_prob": 1.0 - p2,
         "slp_admitted": True,   "slp_gate_prob": 1.0 - p5,
         "slp_merits_tata_wins": True,   "slp_merits_prob": p6,
         "conditional_prob": p1 * (1.0 - p2) * (1.0 - p5) * p6,
         "outcome": "TRUE_WIN",
         "slp_duration_months": SLP_ADMITTED_DURATION,
         "description": "S.34 DFCCIL dismissed \u2192 S.37 DFCCIL wins \u2192 TATA SLP admitted \u2192 TATA wins"},

        {"path_id": "A6",
         "s34_tata_wins": True,  "s34_prob": p1,
         "s37_tata_wins": False, "s37_prob": 1.0 - p2,
         "slp_admitted": True,   "slp_gate_prob": 1.0 - p5,
         "slp_merits_tata_wins": False,  "slp_merits_prob": 1.0 - p6,
         "conditional_prob": p1 * (1.0 - p2) * (1.0 - p5) * (1.0 - p6),
         "outcome": "LOSE",
         "slp_duration_months": SLP_ADMITTED_DURATION,
         "description": "S.34 DFCCIL dismissed \u2192 S.37 DFCCIL wins \u2192 TATA SLP admitted \u2192 TATA loses"},

        # ── Branch: s34 L, s37 W ──
        {"path_id": "A7",
         "s34_tata_wins": False, "s34_prob": 1.0 - p1,
         "s37_tata_wins": True,  "s37_prob": p7,
         "slp_admitted": False,  "slp_gate_prob": p8,
         "slp_merits_tata_wins": None,  "slp_merits_prob": None,
         "conditional_prob": (1.0 - p1) * p7 * p8,
         "outcome": "TRUE_WIN",
         "slp_duration_months": SLP_DISMISSED_DURATION,
         "description": "S.34 DFCCIL wins \u2192 S.37 TATA wins \u2192 DFCCIL SLP dismissed"},

        {"path_id": "A8",
         "s34_tata_wins": False, "s34_prob": 1.0 - p1,
         "s37_tata_wins": True,  "s37_prob": p7,
         "slp_admitted": True,   "slp_gate_prob": 1.0 - p8,
         "slp_merits_tata_wins": False,  "slp_merits_prob": 1.0 - p9,
         "conditional_prob": (1.0 - p1) * p7 * (1.0 - p8) * (1.0 - p9),
         "outcome": "LOSE",
         "slp_duration_months": SLP_ADMITTED_DURATION,
         "description": "S.34 DFCCIL wins \u2192 S.37 TATA wins \u2192 DFCCIL SLP admitted \u2192 DFCCIL wins"},

        {"path_id": "A9",
         "s34_tata_wins": False, "s34_prob": 1.0 - p1,
         "s37_tata_wins": True,  "s37_prob": p7,
         "slp_admitted": True,   "slp_gate_prob": 1.0 - p8,
         "slp_merits_tata_wins": True,   "slp_merits_prob": p9,
         "conditional_prob": (1.0 - p1) * p7 * (1.0 - p8) * p9,
         "outcome": "TRUE_WIN",
         "slp_duration_months": SLP_ADMITTED_DURATION,
         "description": "S.34 DFCCIL wins \u2192 S.37 TATA wins \u2192 DFCCIL SLP admitted \u2192 TATA wins"},

        # ── Branch: s34 L, s37 L ──
        {"path_id": "A10",
         "s34_tata_wins": False, "s34_prob": 1.0 - p1,
         "s37_tata_wins": False, "s37_prob": 1.0 - p7,
         "slp_admitted": False,  "slp_gate_prob": p10,
         "slp_merits_tata_wins": None,  "slp_merits_prob": None,
         "conditional_prob": (1.0 - p1) * (1.0 - p7) * p10,
         "outcome": "LOSE",
         "slp_duration_months": SLP_DISMISSED_DURATION,
         "description": "S.34 DFCCIL wins \u2192 S.37 TATA loses \u2192 TATA SLP dismissed"},

        {"path_id": "A11",
         "s34_tata_wins": False, "s34_prob": 1.0 - p1,
         "s37_tata_wins": False, "s37_prob": 1.0 - p7,
         "slp_admitted": True,   "slp_gate_prob": 1.0 - p10,
         "slp_merits_tata_wins": True,   "slp_merits_prob": p11,
         "conditional_prob": (1.0 - p1) * (1.0 - p7) * (1.0 - p10) * p11,
         "outcome": "TRUE_WIN",
         "slp_duration_months": SLP_ADMITTED_DURATION,
         "description": "S.34 DFCCIL wins \u2192 S.37 TATA loses \u2192 TATA SLP admitted \u2192 TATA wins"},

        {"path_id": "A12",
         "s34_tata_wins": False, "s34_prob": 1.0 - p1,
         "s37_tata_wins": False, "s37_prob": 1.0 - p7,
         "slp_admitted": True,   "slp_gate_prob": 1.0 - p10,
         "slp_merits_tata_wins": False,  "slp_merits_prob": 1.0 - p11,
         "conditional_prob": (1.0 - p1) * (1.0 - p7) * (1.0 - p10) * (1.0 - p11),
         "outcome": "LOSE",
         "slp_duration_months": SLP_ADMITTED_DURATION,
         "description": "S.34 DFCCIL wins \u2192 S.37 TATA loses \u2192 TATA SLP admitted \u2192 TATA loses"},
    ]


def _recompute_domestic_paths_b(n: dict) -> list:
    """Recompute DOMESTIC_PATHS_B from 11 node probabilities.

    Ordering: s34_tata_wins=True paths first (B7-B12), then False (B1-B6).
    This matches the existing convention so paths[0] has s34_tata_wins=True.
    """
    q1  = n["s34_tata_wins"]
    q2  = n["s37_tata_wins_given_s34_win"]
    q3  = n["slp_gate_dismiss_s34w_s37w"]
    q4  = n["slp_merits_tata_wins_s34w_s37w"]
    q5  = n["slp_gate_dismiss_s34w_s37l"]
    q6  = n["slp_merits_tata_wins_s34w_s37l"]
    q7  = n["s37_tata_wins_given_s34_lose"]
    q8  = n["slp_gate_dismiss_s34l_s37w"]
    q9  = n["slp_merits_tata_wins_s34l_s37w"]
    q10 = n["slp_gate_dismiss_s34l_s37l"]
    q11 = n["slp_merits_tata_wins_s34l_s37l"]

    return [
        # ── s34_tata_wins=True first (B7-B12) ──

        # Branch: TATA wins S.34, DFCCIL wins S.37
        {"path_id": "B7",
         "s34_tata_wins": True,  "s34_prob": q1,
         "s37_tata_wins": False, "s37_prob": 1.0 - q2,
         "slp_admitted": False,  "slp_gate_prob": q5,
         "slp_merits_tata_wins": None,  "slp_merits_prob": None,
         "conditional_prob": q1 * (1.0 - q2) * q5,
         "outcome": "LOSE",
         "slp_duration_months": SLP_DISMISSED_DURATION,
         "description": "S.34 win(TATA) \u2192 S.37 DFCCIL wins \u2192 TATA SLP dismissed"},

        {"path_id": "B8",
         "s34_tata_wins": True,  "s34_prob": q1,
         "s37_tata_wins": False, "s37_prob": 1.0 - q2,
         "slp_admitted": True,   "slp_gate_prob": 1.0 - q5,
         "slp_merits_tata_wins": True,   "slp_merits_prob": q6,
         "conditional_prob": q1 * (1.0 - q2) * (1.0 - q5) * q6,
         "outcome": "RESTART",
         "slp_duration_months": SLP_ADMITTED_DURATION,
         "description": "S.34 win(TATA) \u2192 S.37 DFCCIL wins \u2192 TATA SLP admitted \u2192 TATA wins"},

        {"path_id": "B9",
         "s34_tata_wins": True,  "s34_prob": q1,
         "s37_tata_wins": False, "s37_prob": 1.0 - q2,
         "slp_admitted": True,   "slp_gate_prob": 1.0 - q5,
         "slp_merits_tata_wins": False,  "slp_merits_prob": 1.0 - q6,
         "conditional_prob": q1 * (1.0 - q2) * (1.0 - q5) * (1.0 - q6),
         "outcome": "LOSE",
         "slp_duration_months": SLP_ADMITTED_DURATION,
         "description": "S.34 win(TATA) \u2192 S.37 DFCCIL wins \u2192 TATA SLP admitted \u2192 TATA loses"},

        # Branch: TATA wins S.34, TATA wins S.37 (setting aside upheld)
        {"path_id": "B10",
         "s34_tata_wins": True,  "s34_prob": q1,
         "s37_tata_wins": True,  "s37_prob": q2,
         "slp_admitted": False,  "slp_gate_prob": q3,
         "slp_merits_tata_wins": None,  "slp_merits_prob": None,
         "conditional_prob": q1 * q2 * q3,
         "outcome": "RESTART",
         "slp_duration_months": SLP_DISMISSED_DURATION,
         "description": "S.34 win(TATA) \u2192 S.37 win(TATA) \u2192 DFCCIL SLP dismissed \u2192 RESTART"},

        {"path_id": "B11",
         "s34_tata_wins": True,  "s34_prob": q1,
         "s37_tata_wins": True,  "s37_prob": q2,
         "slp_admitted": True,   "slp_gate_prob": 1.0 - q3,
         "slp_merits_tata_wins": False,  "slp_merits_prob": 1.0 - q4,
         "conditional_prob": q1 * q2 * (1.0 - q3) * (1.0 - q4),
         "outcome": "LOSE",
         "slp_duration_months": SLP_ADMITTED_DURATION,
         "description": "S.34 win(TATA) \u2192 S.37 win(TATA) \u2192 DFCCIL SLP admitted \u2192 DFCCIL wins"},

        {"path_id": "B12",
         "s34_tata_wins": True,  "s34_prob": q1,
         "s37_tata_wins": True,  "s37_prob": q2,
         "slp_admitted": True,   "slp_gate_prob": 1.0 - q3,
         "slp_merits_tata_wins": True,   "slp_merits_prob": q4,
         "conditional_prob": q1 * q2 * (1.0 - q3) * q4,
         "outcome": "RESTART",
         "slp_duration_months": SLP_ADMITTED_DURATION,
         "description": "S.34 win(TATA) \u2192 S.37 win(TATA) \u2192 DFCCIL SLP admitted \u2192 DFCCIL loses"},

        # ── s34_tata_wins=False (B1-B6) ──

        # Branch: TATA loses S.34, TATA loses S.37
        {"path_id": "B1",
         "s34_tata_wins": False, "s34_prob": 1.0 - q1,
         "s37_tata_wins": False, "s37_prob": 1.0 - q7,
         "slp_admitted": False,  "slp_gate_prob": q10,
         "slp_merits_tata_wins": None,  "slp_merits_prob": None,
         "conditional_prob": (1.0 - q1) * (1.0 - q7) * q10,
         "outcome": "LOSE",
         "slp_duration_months": SLP_DISMISSED_DURATION,
         "description": "S.34 fail \u2192 S.37 fail \u2192 TATA SLP dismissed"},

        {"path_id": "B2",
         "s34_tata_wins": False, "s34_prob": 1.0 - q1,
         "s37_tata_wins": False, "s37_prob": 1.0 - q7,
         "slp_admitted": True,   "slp_gate_prob": 1.0 - q10,
         "slp_merits_tata_wins": True,   "slp_merits_prob": q11,
         "conditional_prob": (1.0 - q1) * (1.0 - q7) * (1.0 - q10) * q11,
         "outcome": "RESTART",
         "slp_duration_months": SLP_ADMITTED_DURATION,
         "description": "S.34 fail \u2192 S.37 fail \u2192 TATA SLP admitted \u2192 TATA wins"},

        {"path_id": "B3",
         "s34_tata_wins": False, "s34_prob": 1.0 - q1,
         "s37_tata_wins": False, "s37_prob": 1.0 - q7,
         "slp_admitted": True,   "slp_gate_prob": 1.0 - q10,
         "slp_merits_tata_wins": False,  "slp_merits_prob": 1.0 - q11,
         "conditional_prob": (1.0 - q1) * (1.0 - q7) * (1.0 - q10) * (1.0 - q11),
         "outcome": "LOSE",
         "slp_duration_months": SLP_ADMITTED_DURATION,
         "description": "S.34 fail \u2192 S.37 fail \u2192 TATA SLP admitted \u2192 TATA loses"},

        # Branch: TATA loses S.34, TATA wins S.37
        {"path_id": "B4",
         "s34_tata_wins": False, "s34_prob": 1.0 - q1,
         "s37_tata_wins": True,  "s37_prob": q7,
         "slp_admitted": False,  "slp_gate_prob": q8,
         "slp_merits_tata_wins": None,  "slp_merits_prob": None,
         "conditional_prob": (1.0 - q1) * q7 * q8,
         "outcome": "RESTART",
         "slp_duration_months": SLP_DISMISSED_DURATION,
         "description": "S.34 fail \u2192 S.37 win(TATA) \u2192 DFCCIL SLP dismissed \u2192 RESTART"},

        {"path_id": "B5",
         "s34_tata_wins": False, "s34_prob": 1.0 - q1,
         "s37_tata_wins": True,  "s37_prob": q7,
         "slp_admitted": True,   "slp_gate_prob": 1.0 - q8,
         "slp_merits_tata_wins": False,  "slp_merits_prob": 1.0 - q9,
         "conditional_prob": (1.0 - q1) * q7 * (1.0 - q8) * (1.0 - q9),
         "outcome": "LOSE",
         "slp_duration_months": SLP_ADMITTED_DURATION,
         "description": "S.34 fail \u2192 S.37 win(TATA) \u2192 DFCCIL SLP admitted \u2192 DFCCIL wins"},

        {"path_id": "B6",
         "s34_tata_wins": False, "s34_prob": 1.0 - q1,
         "s37_tata_wins": True,  "s37_prob": q7,
         "slp_admitted": True,   "slp_gate_prob": 1.0 - q8,
         "slp_merits_tata_wins": True,   "slp_merits_prob": q9,
         "conditional_prob": (1.0 - q1) * q7 * (1.0 - q8) * q9,
         "outcome": "RESTART",
         "slp_duration_months": SLP_ADMITTED_DURATION,
         "description": "S.34 fail \u2192 S.37 win(TATA) \u2192 DFCCIL SLP admitted \u2192 DFCCIL loses"},
    ]


def _recompute_siac_paths_a(n: dict) -> list:
    """Recompute SIAC_PATHS_A from 3 node probabilities."""
    r1 = n["hc_tata_wins"]
    r2 = n["coa_tata_wins_given_hc_win"]
    r3 = n["coa_tata_wins_given_hc_lose"]

    return [
        {"path_id": "SA1",
         "hc_tata_wins": True,  "hc_prob": r1,
         "coa_tata_wins": True, "coa_prob": r2,
         "conditional_prob": r1 * r2,
         "outcome": "TRUE_WIN",
         "description": "HC win(TATA) \u2192 COA win(TATA)"},

        {"path_id": "SA2",
         "hc_tata_wins": True,  "hc_prob": r1,
         "coa_tata_wins": False, "coa_prob": 1.0 - r2,
         "conditional_prob": r1 * (1.0 - r2),
         "outcome": "LOSE",
         "description": "HC win(TATA) \u2192 COA sets aside award"},

        {"path_id": "SA3",
         "hc_tata_wins": False, "hc_prob": 1.0 - r1,
         "coa_tata_wins": True,  "coa_prob": r3,
         "conditional_prob": (1.0 - r1) * r3,
         "outcome": "TRUE_WIN",
         "description": "HC sets aside \u2192 COA restores award"},

        {"path_id": "SA4",
         "hc_tata_wins": False, "hc_prob": 1.0 - r1,
         "coa_tata_wins": False, "coa_prob": 1.0 - r3,
         "conditional_prob": (1.0 - r1) * (1.0 - r3),
         "outcome": "LOSE",
         "description": "HC sets aside \u2192 COA upholds setting aside"},
    ]


def _recompute_siac_paths_b(n: dict) -> list:
    """Recompute SIAC_PATHS_B from 3 node probabilities."""
    s1 = n["hc_tata_wins"]
    s2 = n["coa_tata_wins_given_hc_win"]
    s3 = n["coa_tata_wins_given_hc_lose"]

    return [
        {"path_id": "SB1",
         "hc_tata_wins": True,  "hc_prob": s1,
         "coa_tata_wins": True,  "coa_prob": s2,
         "conditional_prob": s1 * s2,
         "outcome": "RESTART",
         "description": "HC win(TATA) \u2192 COA win(TATA)"},

        {"path_id": "SB2",
         "hc_tata_wins": True,  "hc_prob": s1,
         "coa_tata_wins": False, "coa_prob": 1.0 - s2,
         "conditional_prob": s1 * (1.0 - s2),
         "outcome": "LOSE",
         "description": "HC win(TATA) \u2192 COA lose(TATA)"},

        {"path_id": "SB3",
         "hc_tata_wins": False, "hc_prob": 1.0 - s1,
         "coa_tata_wins": True,  "coa_prob": s3,
         "conditional_prob": (1.0 - s1) * s3,
         "outcome": "RESTART",
         "description": "HC lose(TATA) \u2192 COA win(TATA)"},

        {"path_id": "SB4",
         "hc_tata_wins": False, "hc_prob": 1.0 - s1,
         "coa_tata_wins": False, "coa_prob": 1.0 - s3,
         "conditional_prob": (1.0 - s1) * (1.0 - s3),
         "outcome": "LOSE",
         "description": "HC lose(TATA) \u2192 COA lose(TATA)"},
    ]


def _compute_outcome_totals(paths: list) -> dict:
    """Compute per-outcome probability subtotals for a path table."""
    tw = sum(p["conditional_prob"] for p in paths if p["outcome"] == "TRUE_WIN")
    re = sum(p["conditional_prob"] for p in paths if p["outcome"] == "RESTART")
    lo = sum(p["conditional_prob"] for p in paths if p["outcome"] == "LOSE")
    return {"TRUE_WIN": tw, "RESTART": re, "LOSE": lo}


def load_config_override(json_path: str) -> None:
    """Load a JSON config file and override module-level variables.

    Must be called BEFORE any other module reads from v2_master_inputs
    (i.e., before v2_probability_tree is imported and validate_tree() runs).

    Parameters
    ----------
    json_path : str
        Path to JSON config file matching the Phase 0 schema.

    Raises
    ------
    FileNotFoundError  if the config file doesn't exist.
    ValueError         if probability constraints are violated.
    """
    global CONFIG_OVERRIDE_ACTIVE, _EXPECTED_OUTCOME_TOTALS
    global N_SIMULATIONS, RANDOM_SEED, MAX_TIMELINE_MONTHS, NO_RESTART_MODE, START_DATE
    global ARB_WIN_PROBABILITY, RE_ARB_WIN_PROBABILITY
    global QUANTUM_BANDS
    global DOMESTIC_PATHS_A, DOMESTIC_PATHS_B, SIAC_PATHS_A, SIAC_PATHS_B
    global DAB_DURATION, ARB_DURATION, ARB_REMAINING_302_5, RE_REFERRAL_CTP11_2
    global S34_DURATION, S37_DURATION, SLP_DISMISSED_DURATION, SLP_ADMITTED_DURATION
    global SIAC_HC_DURATION, SIAC_COA_DURATION
    global DOMESTIC_PAYMENT_DELAY, SIAC_PAYMENT_DELAY, RE_ARB_PAYMENT_DELAY
    global LEGAL_COSTS, LEGAL_COST_OVERRUN
    global DISCOUNT_RATE, RISK_FREE_RATE
    global UPFRONT_PCT_SOC, TATA_TAIL_PCT, AWARD_SHARE_PCT
    global INVESTMENT_GRID_ALL, INVESTMENT_GRID_SIAC, INVESTMENT_GRID_DOMESTIC
    global STOCHASTIC_GRID_ALL, STOCHASTIC_GRID_SIAC, STOCHASTIC_GRID_DOMESTIC
    global STOCHASTIC_PRICING
    global PORTFOLIO_SOC_CR
    global INTEREST_ENABLED, INTEREST_RATE_DOMESTIC, INTEREST_RATE_SIAC
    global INTEREST_TYPE_DOMESTIC, INTEREST_TYPE_SIAC
    global INTEREST_RATE_BANDS_DOMESTIC, INTEREST_RATE_BANDS_SIAC
    global INTEREST_START_BASIS

    with open(json_path, "r", encoding="utf-8") as f:
        cfg = json.load(f)

    # ── Simulation section ──
    sim = cfg.get("simulation", {})
    if "n_simulations" in sim:
        N_SIMULATIONS = int(sim["n_simulations"])
    if "random_seed" in sim:
        RANDOM_SEED = int(sim["random_seed"])
    if "max_timeline_months" in sim:
        MAX_TIMELINE_MONTHS = int(sim["max_timeline_months"])
    if "no_restart_mode" in sim:
        NO_RESTART_MODE = bool(sim["no_restart_mode"])
    if "start_date" in sim:
        START_DATE = str(sim["start_date"])
    sims_per_combo = sim.get("sims_per_combo", None)

    # ── Arbitration section ──
    arb = cfg.get("arbitration", {})
    if "arb_win_probability" in arb:
        ARB_WIN_PROBABILITY = float(arb["arb_win_probability"])
    if "re_arb_win_probability" in arb:
        RE_ARB_WIN_PROBABILITY = float(arb["re_arb_win_probability"])

    # ── Quantum bands ──
    if "quantum_bands" in cfg:
        QUANTUM_BANDS = cfg["quantum_bands"]
        qb_sum = sum(b["probability"] for b in QUANTUM_BANDS)
        if abs(qb_sum - 1.0) > 0.001:
            raise ValueError(
                f"Quantum band probabilities sum to {qb_sum:.6f}, expected 1.0"
            )

    # ── Domestic tree ──
    dom = cfg.get("domestic_tree", {})
    if "scenario_a" in dom:
        DOMESTIC_PATHS_A = _recompute_domestic_paths_a(dom["scenario_a"])
        path_sum = sum(p["conditional_prob"] for p in DOMESTIC_PATHS_A)
        if abs(path_sum - 1.0) > 1e-4:
            raise ValueError(
                f"Domestic Scenario A paths sum to {path_sum:.6f}, expected 1.0"
            )
    if "scenario_b" in dom:
        DOMESTIC_PATHS_B = _recompute_domestic_paths_b(dom["scenario_b"])
        path_sum = sum(p["conditional_prob"] for p in DOMESTIC_PATHS_B)
        if abs(path_sum - 1.0) > 1e-4:
            raise ValueError(
                f"Domestic Scenario B paths sum to {path_sum:.6f}, expected 1.0"
            )

    # ── SIAC tree ──
    siac = cfg.get("siac_tree", {})
    if "scenario_a" in siac:
        SIAC_PATHS_A = _recompute_siac_paths_a(siac["scenario_a"])
        path_sum = sum(p["conditional_prob"] for p in SIAC_PATHS_A)
        if abs(path_sum - 1.0) > 1e-4:
            raise ValueError(
                f"SIAC Scenario A paths sum to {path_sum:.6f}, expected 1.0"
            )
    if "scenario_b" in siac:
        SIAC_PATHS_B = _recompute_siac_paths_b(siac["scenario_b"])
        path_sum = sum(p["conditional_prob"] for p in SIAC_PATHS_B)
        if abs(path_sum - 1.0) > 1e-4:
            raise ValueError(
                f"SIAC Scenario B paths sum to {path_sum:.6f}, expected 1.0"
            )

    # ── Timeline section ──
    tl = cfg.get("timeline", {})
    if "dab" in tl:
        DAB_DURATION = tl["dab"]
    if "arbitration" in tl:
        ARB_DURATION = tl["arbitration"]
    if "arb_remaining_302_5" in tl:
        ARB_REMAINING_302_5 = tl["arb_remaining_302_5"]
    if "re_referral_ctp11_2" in tl:
        RE_REFERRAL_CTP11_2 = tl["re_referral_ctp11_2"]
    if "s34" in tl:
        S34_DURATION = tl["s34"]
    if "s37" in tl:
        S37_DURATION = tl["s37"]
    if "slp_dismissed" in tl:
        SLP_DISMISSED_DURATION = float(tl["slp_dismissed"])
    if "slp_admitted" in tl:
        SLP_ADMITTED_DURATION = float(tl["slp_admitted"])
    if "siac_hc" in tl:
        SIAC_HC_DURATION = float(tl["siac_hc"])
    if "siac_coa" in tl:
        SIAC_COA_DURATION = float(tl["siac_coa"])

    # ── Payment delays ──
    pd_sec = cfg.get("payment_delays", {})
    if "domestic" in pd_sec:
        DOMESTIC_PAYMENT_DELAY = float(pd_sec["domestic"])
    if "siac" in pd_sec:
        SIAC_PAYMENT_DELAY = float(pd_sec["siac"])
    if "re_arb" in pd_sec:
        RE_ARB_PAYMENT_DELAY = float(pd_sec["re_arb"])

    # ── Legal costs ──
    lc = cfg.get("legal_costs", {})
    if "onetime" in lc:
        LEGAL_COSTS["onetime"].update(lc["onetime"])
    if "duration_based" in lc:
        LEGAL_COSTS["duration_based"].update(lc["duration_based"])
    if "overrun" in lc:
        LEGAL_COST_OVERRUN.update(lc["overrun"])
        if LEGAL_COST_OVERRUN["low"] >= LEGAL_COST_OVERRUN["high"]:
            raise ValueError("Legal cost overrun: low must be < high")

    # ── Financial ──
    fin = cfg.get("financial", {})
    if "discount_rate" in fin:
        DISCOUNT_RATE = float(fin["discount_rate"])
    if "risk_free_rate" in fin:
        RISK_FREE_RATE = float(fin["risk_free_rate"])

    # ── Investment grid ──
    ig = cfg.get("investment_grid", {})
    if ig:
        upfront = ig.get("upfront_pcts", INVESTMENT_GRID_ALL["upfront_pcts"])
        tails = ig.get("tata_tail_pcts", INVESTMENT_GRID_ALL["tata_tail_pcts"])
        upfront_sorted = sorted(upfront)
        tails_sorted = sorted(tails)

        INVESTMENT_GRID_ALL["upfront_pcts"] = upfront_sorted
        INVESTMENT_GRID_ALL["tata_tail_pcts"] = tails_sorted
        INVESTMENT_GRID_SIAC["upfront_pcts"] = upfront_sorted
        INVESTMENT_GRID_SIAC["tata_tail_pcts"] = tails_sorted

        # Domestic: floor at 10% tail
        domestic_tails = [t for t in tails_sorted if t >= 0.10]
        if not domestic_tails:
            domestic_tails = tails_sorted
        INVESTMENT_GRID_DOMESTIC["upfront_pcts"] = upfront_sorted
        INVESTMENT_GRID_DOMESTIC["tata_tail_pcts"] = domestic_tails

        n_up = len(upfront_sorted)
        n_tail = len(tails_sorted)
        n_dtail = len(domestic_tails)
        INVESTMENT_GRID_ALL["label"] = f"Full Portfolio Grid ({n_up}\u00d7{n_tail} = {n_up * n_tail} combinations)"
        INVESTMENT_GRID_SIAC["label"] = f"SIAC Granular Grid ({n_up}\u00d7{n_tail} = {n_up * n_tail} combinations)"
        INVESTMENT_GRID_DOMESTIC["label"] = f"Domestic Grid ({n_up}\u00d7{n_dtail} = {n_up * n_dtail} combinations)"

        # Mirror to stochastic grids
        upfront_pct_grid = [round(v * 100, 1) for v in upfront_sorted]
        tails_pct_grid = [round(v * 100, 1) for v in tails_sorted]
        domestic_tails_pct_grid = [round(v * 100, 1) for v in domestic_tails]
        spc = sims_per_combo or STOCHASTIC_GRID_ALL.get("sims_per_combo", 2000)

        STOCHASTIC_GRID_ALL = {"upfront_pct_grid": upfront_pct_grid, "tata_tail_pct_grid": tails_pct_grid, "sims_per_combo": spc}
        STOCHASTIC_GRID_SIAC = {"upfront_pct_grid": upfront_pct_grid, "tata_tail_pct_grid": tails_pct_grid, "sims_per_combo": spc}
        STOCHASTIC_GRID_DOMESTIC = {"upfront_pct_grid": upfront_pct_grid, "tata_tail_pct_grid": domestic_tails_pct_grid, "sims_per_combo": spc}
        STOCHASTIC_PRICING = {"upfront_pct_grid": upfront_pct_grid, "tata_tail_pct_grid": tails_pct_grid, "sims_per_combo": spc}

        UPFRONT_PCT_SOC = upfront_sorted
        TATA_TAIL_PCT = tails_sorted
        AWARD_SHARE_PCT = [round(1.0 - t, 4) for t in tails_sorted]
    elif sims_per_combo is not None:
        STOCHASTIC_GRID_ALL["sims_per_combo"] = sims_per_combo
        STOCHASTIC_GRID_SIAC["sims_per_combo"] = sims_per_combo
        STOCHASTIC_GRID_DOMESTIC["sims_per_combo"] = sims_per_combo
        STOCHASTIC_PRICING["sims_per_combo"] = sims_per_combo

    # ── Interest accumulation ──
    interest = cfg.get("interest", {})
    if "enabled" in interest:
        INTEREST_ENABLED = bool(interest["enabled"])
    if "domestic_rate" in interest:
        INTEREST_RATE_DOMESTIC = float(interest["domestic_rate"])
    if "siac_rate" in interest:
        INTEREST_RATE_SIAC = float(interest["siac_rate"])
    if "domestic_type" in interest:
        val = str(interest["domestic_type"]).lower()
        if val not in ("simple", "compound"):
            raise ValueError(f"interest.domestic_type must be 'simple' or 'compound', got '{val}'")
        INTEREST_TYPE_DOMESTIC = val
    if "siac_type" in interest:
        val = str(interest["siac_type"]).lower()
        if val not in ("simple", "compound"):
            raise ValueError(f"interest.siac_type must be 'simple' or 'compound', got '{val}'")
        INTEREST_TYPE_SIAC = val

    # ── Stochastic interest rate bands ──
    if "domestic_rate_bands" in interest:
        bands = interest["domestic_rate_bands"]
        if bands and len(bands) > 0:
            INTEREST_RATE_BANDS_DOMESTIC = bands
            prob_sum = sum(b["probability"] for b in bands)
            if abs(prob_sum - 1.0) > 0.001:
                raise ValueError(
                    f"Domestic interest rate band probabilities sum to {prob_sum:.6f}, expected 1.0"
                )
            for b in bands:
                if b.get("type", "simple") not in ("simple", "compound"):
                    raise ValueError(f"Interest band type must be 'simple' or 'compound', got '{b['type']}'")
    if "siac_rate_bands" in interest:
        bands = interest["siac_rate_bands"]
        if bands and len(bands) > 0:
            INTEREST_RATE_BANDS_SIAC = bands
            prob_sum = sum(b["probability"] for b in bands)
            if abs(prob_sum - 1.0) > 0.001:
                raise ValueError(
                    f"SIAC interest rate band probabilities sum to {prob_sum:.6f}, expected 1.0"
                )
            for b in bands:
                if b.get("type", "simple") not in ("simple", "compound"):
                    raise ValueError(f"Interest band type must be 'simple' or 'compound', got '{b['type']}'")

    # ── Interest start basis ──
    if "start_basis" in interest:
        val = str(interest["start_basis"]).lower()
        if val not in ("award_date", "dab_commencement"):
            raise ValueError(f"interest.start_basis must be 'award_date' or 'dab_commencement', got '{val}'")
        INTEREST_START_BASIS = val

    # ── Per-claim DAB commencement date overrides ──
    if "dab_commencement_dates" in interest:
        date_map = interest["dab_commencement_dates"]
        for claim in CLAIMS:
            cid = claim["claim_id"]
            if cid in date_map:
                claim["dab_commencement_date"] = date_map[cid]

    # ── Recompute derived constants ──
    PORTFOLIO_SOC_CR = sum(c["soc_value_cr"] for c in CLAIMS)

    # ── Build dynamic expected outcome totals for validate_tree() ──
    _EXPECTED_OUTCOME_TOTALS = {
        "dom_a": _compute_outcome_totals(DOMESTIC_PATHS_A),
        "dom_b": _compute_outcome_totals(DOMESTIC_PATHS_B),
        "siac_a": _compute_outcome_totals(SIAC_PATHS_A),
        "siac_b": _compute_outcome_totals(SIAC_PATHS_B),
    }

    CONFIG_OVERRIDE_ACTIVE = True
