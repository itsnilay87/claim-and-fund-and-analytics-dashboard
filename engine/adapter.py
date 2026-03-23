"""
engine/adapter.py — Adapter layer: Platform Pydantic schemas ↔ V2 engine.
==========================================================================

Translates the platform's Pydantic ``ClaimConfig`` / ``PortfolioConfig``
into the format V2 functions expect, runs V2 simulation per-claim,
and merges results back.

Key design decision: V2 reads parameters from ``v2_master_inputs`` (MI)
as module-level constants.  The adapter **monkey-patches** MI attributes
per-claim inside a ``save_and_restore_mi()`` context manager, then calls
V2 functions unchanged.  This avoids any modifications to the V2 core.
"""

from __future__ import annotations

import copy
from contextlib import contextmanager
from typing import Any, Optional

from engine.config.schema import (
    ClaimConfig as PlatformClaim,
    ChallengeTreeConfig,
    JurisdictionTemplate,
    LegalCostConfig,
    PortfolioConfig,
    PortfolioStructure,
    ScenarioTree,
    SimulationConfig,
    StageConfig,
    TimelineConfig,
    TreeNode,
)
from engine.v2_core import v2_master_inputs as MI
from engine.v2_core.v2_config import (
    ClaimConfig as V2ClaimConfig,
    PathResult as V2PathResult,
    SimulationResults,
)


# ============================================================================
# Save / Restore context manager
# ============================================================================

# Module-level MI attributes that we monkey-patch.  Listed explicitly so
# save_and_restore_mi knows what to capture and restore.
_MI_PATCHABLE_ATTRS: list[str] = [
    "ARB_WIN_PROBABILITY",
    "RE_ARB_WIN_PROBABILITY",
    "QUANTUM_BANDS",
    "NO_RESTART_MODE",
    "MAX_TIMELINE_MONTHS",
    "N_SIMULATIONS",
    "RANDOM_SEED",
    "START_DATE",
    "DISCOUNT_RATE",
    "RISK_FREE_RATE",
    # Timeline durations
    "DAB_DURATION",
    "ARB_DURATION",
    "S34_DURATION",
    "S37_DURATION",
    "SLP_DISMISSED_DURATION",
    "SLP_ADMITTED_DURATION",
    "SIAC_HC_DURATION",
    "SIAC_COA_DURATION",
    "DOMESTIC_PAYMENT_DELAY",
    "SIAC_PAYMENT_DELAY",
    "RE_ARB_PAYMENT_DELAY",
    # Interest
    "INTEREST_ENABLED",
    "INTEREST_RATE_DOMESTIC",
    "INTEREST_RATE_SIAC",
    "INTEREST_TYPE_DOMESTIC",
    "INTEREST_TYPE_SIAC",
    "INTEREST_RATE_BANDS_DOMESTIC",
    "INTEREST_RATE_BANDS_SIAC",
    "INTEREST_START_BASIS",
    # Legal costs
    "LEGAL_COSTS",
    "LEGAL_COST_OVERRUN",
    # Probability trees (flat path tables)
    "DOMESTIC_PATHS_A",
    "DOMESTIC_PATHS_B",
    "SIAC_PATHS_A",
    "SIAC_PATHS_B",
    "DOMESTIC_TREE_SCENARIO_A",
    # Claims list (patched for per-claim dab_commencement_date)
    "CLAIMS",
    "CLAIMS_BY_ID",
    "PORTFOLIO_SOC_CR",
    # Config override flag
    "CONFIG_OVERRIDE_ACTIVE",
    "_EXPECTED_OUTCOME_TOTALS",
]


@contextmanager
def save_and_restore_mi():
    """Save MI attributes before patching and restore them after.

    Usage::

        with save_and_restore_mi():
            patch_master_inputs_for_claim(claim, template)
            results = run_v2_for_claim(claim)
        # MI is now restored to original state
    """
    saved: dict[str, Any] = {}
    for attr in _MI_PATCHABLE_ATTRS:
        if hasattr(MI, attr):
            val = getattr(MI, attr)
            # Deep-copy mutable objects (dicts, lists)
            if isinstance(val, (dict, list)):
                saved[attr] = copy.deepcopy(val)
            else:
                saved[attr] = val
    try:
        yield
    finally:
        for attr, val in saved.items():
            setattr(MI, attr, val)


# ============================================================================
# Platform claim → V2 ClaimConfig
# ============================================================================

# Map platform jurisdiction strings to V2 jurisdiction strings
_JURISDICTION_MAP: dict[str, str] = {
    "indian_domestic": "domestic",
    "siac_singapore": "siac",
    # Direct V2 values pass through
    "domestic": "domestic",
    "siac": "siac",
}

# Map platform claim_type → V2 archetype
_ARCHETYPE_MAP: dict[str, str] = {
    "prolongation": "prolongation",
    "change_of_law": "change_of_law",
    "scope_variation": "scope_variation",
    "breach_of_contract": "breach_of_contract",
    "other": "other",
}


def platform_claim_to_v2_claim(
    claim: PlatformClaim,
    template: Optional[JurisdictionTemplate] = None,
) -> V2ClaimConfig:
    """Convert a platform Pydantic ``ClaimConfig`` → V2 dataclass ``ClaimConfig``.

    Parameters
    ----------
    claim : PlatformClaim
        Platform's Pydantic claim configuration.
    template : JurisdictionTemplate, optional
        Jurisdiction template (used to derive pipeline if not explicit).

    Returns
    -------
    V2ClaimConfig
        Dataclass that V2 engine functions accept.
    """
    jurisdiction = _JURISDICTION_MAP.get(claim.jurisdiction, claim.jurisdiction)
    archetype = _ARCHETYPE_MAP.get(claim.claim_type, claim.claim_type)
    pipeline = derive_pipeline(claim, template)

    dab_commencement = ""
    if claim.interest and claim.interest.commencement_date:
        dab_commencement = claim.interest.commencement_date

    v2_claim = V2ClaimConfig(
        claim_id=claim.id,
        archetype=archetype,
        soc_value_cr=claim.soc_value_cr,
        jurisdiction=jurisdiction,
        current_gate=claim.current_stage or "dab_commenced",
        tpl_share=claim.claimant_share_pct,
        pipeline=pipeline,
        dab_commencement_date=dab_commencement,
    )
    v2_claim.validate()
    return v2_claim


# ============================================================================
# Derive pipeline from current_stage + jurisdiction
# ============================================================================

# Full domestic pipeline stages in order
_DOMESTIC_FULL_PIPELINE = ["dab", "arbitration", "challenge_tree"]
# Full SIAC pipeline stages in order
_SIAC_FULL_PIPELINE = ["dab", "arbitration", "challenge_tree"]

# Maps current_stage → index into the full pipeline (how many to skip)
_STAGE_SKIP_MAP: dict[str, int] = {
    # Not started yet or at beginning
    "": 0,
    "not_started": 0,
    "soc_filed_at_dab": 0,
    "dab_constituted": 0,
    "dab_commenced": 0,
    # DAB done → skip DAB
    "dab_award_done": 1,
    "dab_completed": 1,
    "dab_found_premature": 0,  # needs re-referral then DAB
    # In arbitration → partial arb remaining
    "arb_hearings_ongoing": 1,  # uses arb_remaining pipeline
    "arb_commenced": 1,
    # Arbitration done → skip to challenge tree
    "arb_award_done": 2,
    "challenge_pending": 2,
}


def derive_pipeline(
    claim: PlatformClaim,
    template: Optional[JurisdictionTemplate] = None,
) -> list[str]:
    """Determine remaining V2 pipeline stages for this claim.

    Based on ``claim.current_stage`` and ``claim.jurisdiction``:
    - Domestic claims: ``['dab', 'arbitration', 'challenge_tree']``
    - SIAC claims: ``['dab', 'arbitration', 'challenge_tree']``
    - Mid-pipeline stages truncate stages already completed.

    Special cases:
    - ``dab_found_premature`` → ``['re_referral', 'dab', 'arbitration', 'challenge_tree']``
    - ``arb_hearings_ongoing`` → ``['arb_remaining', 'challenge_tree']``
    """
    stage = claim.current_stage or ""

    # Special: re-referral needed
    if stage == "dab_found_premature":
        return ["re_referral", "dab", "arbitration", "challenge_tree"]

    # Special: mid-arbitration
    if stage == "arb_hearings_ongoing":
        return ["arb_remaining", "challenge_tree"]

    skip = _STAGE_SKIP_MAP.get(stage, 0)
    jurisdiction = _JURISDICTION_MAP.get(claim.jurisdiction, claim.jurisdiction)

    if jurisdiction == "siac":
        full = list(_SIAC_FULL_PIPELINE)
    else:
        full = list(_DOMESTIC_FULL_PIPELINE)

    return full[skip:]


# ============================================================================
# Patch master inputs for a single claim
# ============================================================================

def patch_master_inputs_for_claim(
    claim: PlatformClaim,
    template: Optional[JurisdictionTemplate] = None,
) -> None:
    """Monkey-patch ``v2_master_inputs`` module attributes for one claim.

    Must be called inside a ``save_and_restore_mi()`` context manager.

    Patches arbitration probabilities, quantum bands, timeline durations,
    interest settings, legal costs, and probability trees.

    Parameters
    ----------
    claim : PlatformClaim
        Platform's Pydantic claim configuration.
    template : JurisdictionTemplate, optional
        Jurisdiction template for defaults.
    """
    # ── Arbitration probabilities ──
    if claim.arbitration:
        MI.ARB_WIN_PROBABILITY = claim.arbitration.win_probability
        MI.RE_ARB_WIN_PROBABILITY = claim.arbitration.re_arb_win_probability

    # ── Quantum bands ──
    if claim.quantum and claim.quantum.bands:
        MI.QUANTUM_BANDS = [
            {"low": b.low, "high": b.high, "probability": b.probability}
            for b in claim.quantum.bands
        ]

    # ── No-restart mode ──
    MI.NO_RESTART_MODE = claim.no_restart_mode

    # ── Timeline durations (from pre_arb_stages) ──
    _patch_timeline_durations(claim, template)

    # ── Interest ──
    _patch_interest(claim)

    # ── Legal costs ──
    _patch_legal_costs(claim)

    # ── Probability trees ──
    tree_to_v2_flat_paths(claim)

    # ── Single-claim CLAIMS list for V2 compatibility ──
    jurisdiction = _JURISDICTION_MAP.get(claim.jurisdiction, claim.jurisdiction)
    dab_date = ""
    if claim.interest and claim.interest.commencement_date:
        dab_date = claim.interest.commencement_date

    claim_dict = {
        "claim_id": claim.id,
        "archetype": _ARCHETYPE_MAP.get(claim.claim_type, claim.claim_type),
        "soc_value_cr": claim.soc_value_cr,
        "jurisdiction": jurisdiction,
        "current_gate": claim.current_stage or "dab_commenced",
        "tpl_share": claim.claimant_share_pct,
        "pipeline": derive_pipeline(claim, template),
        "dab_commencement_date": dab_date,
    }
    MI.CLAIMS = [claim_dict]
    MI.CLAIMS_BY_ID = {claim_dict["claim_id"]: claim_dict}
    MI.PORTFOLIO_SOC_CR = claim.soc_value_cr
    MI.CONFIG_OVERRIDE_ACTIVE = True


def _patch_timeline_durations(
    claim: PlatformClaim,
    template: Optional[JurisdictionTemplate],
) -> None:
    """Patch MI timeline duration attributes from claim's timeline config."""
    tl = claim.timeline
    if not tl:
        return

    MI.MAX_TIMELINE_MONTHS = tl.max_horizon_months

    jurisdiction = _JURISDICTION_MAP.get(claim.jurisdiction, claim.jurisdiction)

    # Payment delay
    if jurisdiction == "domestic":
        MI.DOMESTIC_PAYMENT_DELAY = tl.payment_delay_months
    else:
        MI.SIAC_PAYMENT_DELAY = tl.payment_delay_months

    # Pre-arb stage durations (normalize to lowercase for lookup)
    stage_map: dict[str, StageConfig] = {}
    for s in tl.pre_arb_stages:
        stage_map[s.name.lower()] = s

    if "dab" in stage_map:
        MI.DAB_DURATION = {"low": stage_map["dab"].duration_low, "high": stage_map["dab"].duration_high}
    if "arbitration" in stage_map:
        MI.ARB_DURATION = {"low": stage_map["arbitration"].duration_low, "high": stage_map["arbitration"].duration_high}
    if "s34" in stage_map:
        MI.S34_DURATION = {"low": stage_map["s34"].duration_low, "high": stage_map["s34"].duration_high}
    if "s37" in stage_map:
        MI.S37_DURATION = {"low": stage_map["s37"].duration_low, "high": stage_map["s37"].duration_high}
    if "slp_dismissed" in stage_map:
        MI.SLP_DISMISSED_DURATION = stage_map["slp_dismissed"].duration_low
    if "slp_admitted" in stage_map:
        MI.SLP_ADMITTED_DURATION = stage_map["slp_admitted"].duration_low
    if "siac_hc" in stage_map:
        MI.SIAC_HC_DURATION = stage_map["siac_hc"].duration_low
    if "siac_coa" in stage_map:
        MI.SIAC_COA_DURATION = stage_map["siac_coa"].duration_low


def _patch_interest(claim: PlatformClaim) -> None:
    """Patch MI interest attributes from claim's interest config."""
    interest = claim.interest
    if not interest:
        return

    MI.INTEREST_ENABLED = interest.enabled

    jurisdiction = _JURISDICTION_MAP.get(claim.jurisdiction, claim.jurisdiction)

    if jurisdiction == "domestic":
        MI.INTEREST_RATE_DOMESTIC = interest.rate
        MI.INTEREST_TYPE_DOMESTIC = interest.compounding
        MI.INTEREST_RATE_BANDS_DOMESTIC = [
            {"rate": interest.rate, "type": interest.compounding, "probability": 1.0}
        ]
    else:
        MI.INTEREST_RATE_SIAC = interest.rate
        MI.INTEREST_TYPE_SIAC = interest.compounding
        MI.INTEREST_RATE_BANDS_SIAC = [
            {"rate": interest.rate, "type": interest.compounding, "probability": 1.0}
        ]

    if interest.commencement_date:
        MI.INTEREST_START_BASIS = "dab_commencement"
    else:
        MI.INTEREST_START_BASIS = "award_date"


# ============================================================================
# Legal costs mapping
# ============================================================================

def map_legal_costs(claim: PlatformClaim) -> dict:
    """Convert platform ``LegalCostConfig`` → V2's ``LEGAL_COSTS`` dict format.

    Returns
    -------
    dict
        V2-format legal costs with 'onetime' and 'duration_based' keys.
    """
    lc = claim.legal_costs
    if not lc:
        return copy.deepcopy(MI.LEGAL_COSTS)

    v2_costs: dict[str, Any] = {
        "onetime": {
            "tribunal": lc.one_time_tribunal_cr,
            "expert": lc.one_time_expert_cr,
        },
        "duration_based": {},
    }

    # Map per-stage costs
    for name, stage_cfg in lc.per_stage_costs.items():
        if stage_cfg.legal_cost_low == stage_cfg.legal_cost_high:
            v2_costs["duration_based"][name] = stage_cfg.legal_cost_low
        else:
            v2_costs["duration_based"][name] = {
                "low": stage_cfg.legal_cost_low,
                "high": stage_cfg.legal_cost_high,
            }

    # Backfill default duration_based keys not in per_stage_costs
    default_db = MI.LEGAL_COSTS.get("duration_based", {})
    for key in default_db:
        if key not in v2_costs["duration_based"]:
            v2_costs["duration_based"][key] = copy.deepcopy(default_db[key])

    return v2_costs


def _patch_legal_costs(claim: PlatformClaim) -> None:
    """Patch MI legal cost attributes from claim's legal_costs config."""
    MI.LEGAL_COSTS = map_legal_costs(claim)

    lc = claim.legal_costs
    if lc:
        MI.LEGAL_COST_OVERRUN = {
            "alpha": lc.overrun_alpha,
            "beta": lc.overrun_beta,
            "low": lc.overrun_low,
            "high": lc.overrun_high,
        }


# ============================================================================
# Tree conversion: Platform hierarchical TreeNode → V2 flat path tables
# ============================================================================

def tree_to_v2_flat_paths(claim: PlatformClaim) -> None:
    """Convert platform's hierarchical ``TreeNode`` → V2's flat probability tables.

    V2 expects ``MI.DOMESTIC_PATHS_A/B`` or ``MI.SIAC_PATHS_A/B`` as lists
    of dicts with specific keys (``path_id``, ``conditional_prob``, ``outcome``,
    branch-level probabilities, etc.).

    This function walks the platform's ``ChallengeTreeConfig`` DFS, extracts
    branch probabilities, and produces the flat path table format.

    Patches the result directly into MI.
    """
    tree = claim.challenge_tree
    if not tree:
        return

    jurisdiction = _JURISDICTION_MAP.get(claim.jurisdiction, claim.jurisdiction)

    if jurisdiction == "domestic":
        paths_a = _flatten_domestic_tree(tree.scenario_a, is_scenario_a=True)
        paths_b = _flatten_domestic_tree(tree.scenario_b, is_scenario_a=False)
        MI.DOMESTIC_PATHS_A = paths_a
        MI.DOMESTIC_PATHS_B = paths_b
        # Compute expected outcome totals for validate_tree compatibility
        MI._EXPECTED_OUTCOME_TOTALS = {
            "dom_a": _compute_outcome_totals(paths_a),
            "dom_b": _compute_outcome_totals(paths_b),
            "siac_a": _compute_outcome_totals(MI.SIAC_PATHS_A),
            "siac_b": _compute_outcome_totals(MI.SIAC_PATHS_B),
        }
    else:
        paths_a = _flatten_siac_tree(tree.scenario_a, is_scenario_a=True)
        paths_b = _flatten_siac_tree(tree.scenario_b, is_scenario_a=False)
        MI.SIAC_PATHS_A = paths_a
        MI.SIAC_PATHS_B = paths_b
        MI._EXPECTED_OUTCOME_TOTALS = {
            "dom_a": _compute_outcome_totals(MI.DOMESTIC_PATHS_A),
            "dom_b": _compute_outcome_totals(MI.DOMESTIC_PATHS_B),
            "siac_a": _compute_outcome_totals(paths_a),
            "siac_b": _compute_outcome_totals(paths_b),
        }


def _compute_outcome_totals(paths: list[dict]) -> dict[str, float]:
    """Compute per-outcome probability subtotals."""
    tw = sum(p["conditional_prob"] for p in paths if p["outcome"] == "TRUE_WIN")
    re = sum(p["conditional_prob"] for p in paths if p["outcome"] == "RESTART")
    lo = sum(p["conditional_prob"] for p in paths if p["outcome"] == "LOSE")
    return {"TRUE_WIN": tw, "RESTART": re, "LOSE": lo}


def _flatten_domestic_tree(
    scenario: ScenarioTree,
    is_scenario_a: bool,
) -> list[dict]:
    """Flatten a domestic scenario tree (4 levels: S.34→S.37→SLP gate→SLP merits).

    Walks the tree DFS and builds flat path dicts compatible with V2's
    ``DOMESTIC_PATHS_A/B`` format.

    The domestic tree has exactly 4 levels of branching:
      Level 0: Root (probability=1.0, always S.34)
      Level 1: S.34 outcome (2 children)
      Level 2: S.37 outcome (2 children per S.34 branch)
      Level 3: SLP gate (2 children: dismissed/admitted)
      Level 4: SLP merits (2 children if admitted)

    Returns a list of 12 path dicts.
    """
    paths: list[dict] = []
    path_counter = [0]

    root = scenario.root
    if not root.children:
        return paths

    # Extract S.34 level probabilities
    # children[0] = "TATA wins S.34" branch, children[1] = "TATA loses S.34"
    # We must identify which child corresponds to TATA winning vs losing
    # Convention: higher probability child in Scenario A is TATA wins
    # More robust: look for keyword patterns in names
    s34_children = root.children

    for s34_child in s34_children:
        s34_prob = s34_child.probability
        # Determine if this is "TATA wins S.34" based on name heuristics
        s34_name_lower = s34_child.name.lower()
        is_s34_tata_wins = _is_tata_favorable(s34_name_lower, is_scenario_a)

        if not s34_child.children:
            # Leaf at S.34 level (unusual but handle)
            _add_leaf_path(
                paths, path_counter, is_scenario_a,
                s34_tata_wins=is_s34_tata_wins, s34_prob=s34_prob,
                s37_tata_wins=None, s37_prob=0.0,
                slp_admitted=None, slp_gate_prob=0.0,
                slp_merits_tata_wins=None, slp_merits_prob=None,
                outcome=s34_child.outcome or "LOSE",
                slp_duration=4.0,
            )
            continue

        # S.37 level
        for s37_child in s34_child.children:
            s37_prob = s37_child.probability
            s37_name_lower = s37_child.name.lower()
            # For S.37: determine if outcome is favorable for TATA
            is_s37_tata_wins = _is_tata_favorable(s37_name_lower, is_scenario_a)

            if not s37_child.children:
                # Leaf at S.37 level
                _add_leaf_path(
                    paths, path_counter, is_scenario_a,
                    s34_tata_wins=is_s34_tata_wins, s34_prob=s34_prob,
                    s37_tata_wins=is_s37_tata_wins, s37_prob=s37_prob,
                    slp_admitted=False, slp_gate_prob=1.0,
                    slp_merits_tata_wins=None, slp_merits_prob=None,
                    outcome=s37_child.outcome or "LOSE",
                    slp_duration=4.0,
                )
                continue

            # SLP gate level
            for slp_child in s37_child.children:
                slp_prob = slp_child.probability
                slp_name_lower = slp_child.name.lower()
                is_slp_dismissed = "dismiss" in slp_name_lower

                if not slp_child.children:
                    # Terminal at SLP gate (dismissed or simple admitted)
                    dur = _extract_duration(slp_child)
                    _add_leaf_path(
                        paths, path_counter, is_scenario_a,
                        s34_tata_wins=is_s34_tata_wins, s34_prob=s34_prob,
                        s37_tata_wins=is_s37_tata_wins, s37_prob=s37_prob,
                        slp_admitted=not is_slp_dismissed,
                        slp_gate_prob=slp_prob,
                        slp_merits_tata_wins=None, slp_merits_prob=None,
                        outcome=slp_child.outcome or "LOSE",
                        slp_duration=dur,
                    )
                else:
                    # SLP admitted with merits children
                    for merits_child in slp_child.children:
                        merits_prob = merits_child.probability
                        merits_name_lower = merits_child.name.lower()
                        # Determine if TATA wins SLP merits
                        is_merits_tata_wins = _is_tata_favorable(
                            merits_name_lower, is_scenario_a,
                        )
                        dur = _extract_duration(slp_child)
                        _add_leaf_path(
                            paths, path_counter, is_scenario_a,
                            s34_tata_wins=is_s34_tata_wins, s34_prob=s34_prob,
                            s37_tata_wins=is_s37_tata_wins, s37_prob=s37_prob,
                            slp_admitted=True, slp_gate_prob=slp_prob,
                            slp_merits_tata_wins=is_merits_tata_wins,
                            slp_merits_prob=merits_prob,
                            outcome=merits_child.outcome or "LOSE",
                            slp_duration=dur,
                        )

    # Sort: s34_tata_wins=True paths first for Scenario B (V2 convention)
    if not is_scenario_a:
        paths.sort(key=lambda p: (not p["s34_tata_wins"], p["path_id"]))

    return paths


def _flatten_siac_tree(
    scenario: ScenarioTree,
    is_scenario_a: bool,
) -> list[dict]:
    """Flatten a SIAC scenario tree (2 levels: HC→COA).

    Returns a list of 4 path dicts compatible with V2's ``SIAC_PATHS_A/B``.
    """
    paths: list[dict] = []
    path_counter = [0]
    prefix = "SA" if is_scenario_a else "SB"

    root = scenario.root
    if not root.children:
        return paths

    for hc_child in root.children:
        hc_prob = hc_child.probability
        hc_name_lower = hc_child.name.lower()
        is_hc_tata_wins = _is_tata_favorable(hc_name_lower, is_scenario_a)

        if not hc_child.children:
            # Terminal at HC level
            path_counter[0] += 1
            paths.append({
                "path_id": f"{prefix}{path_counter[0]}",
                "hc_tata_wins": is_hc_tata_wins,
                "hc_prob": hc_prob,
                "coa_tata_wins": None,
                "coa_prob": 0.0,
                "conditional_prob": hc_prob,
                "outcome": hc_child.outcome or "LOSE",
                "description": hc_child.name,
            })
            continue

        for coa_child in hc_child.children:
            coa_prob = coa_child.probability
            coa_name_lower = coa_child.name.lower()
            is_coa_tata_wins = _is_tata_favorable(coa_name_lower, is_scenario_a)

            path_counter[0] += 1
            paths.append({
                "path_id": f"{prefix}{path_counter[0]}",
                "hc_tata_wins": is_hc_tata_wins,
                "hc_prob": hc_prob,
                "coa_tata_wins": is_coa_tata_wins,
                "coa_prob": coa_prob,
                "conditional_prob": hc_prob * coa_prob,
                "outcome": coa_child.outcome or "LOSE",
                "description": f"{hc_child.name} → {coa_child.name}",
            })

    return paths


def _is_tata_favorable(name: str, is_scenario_a: bool) -> bool:
    """Heuristic: does this node name indicate a TATA-favorable outcome?

    In Scenario A (TATA won arb), "dismissed" / "fail" for respondent = good.
    In Scenario B (TATA lost arb), "win" for claimant/TATA = good.

    Looks for keyword patterns in the node name.
    """
    name_l = name.lower()

    # --- Handle "adverse" keyword combinations (SIAC trees) ---
    # "upholds adverse" / "restores adverse" = bad for TATA
    if "adverse" in name_l:
        if any(w in name_l for w in ["upholds", "upheld", "restores", "restore"]):
            return False
        # "overturns adverse" = good for TATA
        if any(w in name_l for w in ["overturn", "overturns"]):
            return True

    # Explicit TATA/claimant win indicators
    if any(w in name_l for w in ["tata win", "claim win", "claimant win",
                                  "claim wins", "claimant wins", "tata wins"]):
        return True
    # Explicit TATA/claimant loss indicators (including "fails")
    if any(w in name_l for w in ["tata lose", "claim lose", "claimant lose",
                                  "tata loses", "claim loses", "claimant loses",
                                  "claimant fail", "claim fail",
                                  "tata fail", "tata fails",
                                  "claimant fails", "claim fails"]):
        return False
    # Respondent / DFCCIL dismissed/fails = favorable for TATA
    if any(w in name_l for w in ["respondent fail", "resp fail", "dfccil fail",
                                  "respondent fails", "resp fails", "dfccil fails",
                                  "respondent lose", "respondent loses",
                                  "dismissed", "dfccil dismissed",
                                  "respondent dismissed"]):
        return True
    # Respondent wins = bad for TATA
    if any(w in name_l for w in ["respondent win", "resp win", "dfccil win",
                                  "respondent wins", "resp wins"]):
        return False
    # "Restored" / "upheld" / "upholds" in Scenario A context = good for TATA
    # UNLESS the phrase also contains "setting aside" (upholds setting aside = bad)
    if is_scenario_a and any(w in name_l for w in ["restored", "restores",
                                                    "upheld", "upholds"]):
        if "set" in name_l and "aside" in name_l:
            return False  # "upholds setting aside" = bad for TATA
        return True
    # "Set aside" / "sets aside" in Scenario A = bad for TATA
    if is_scenario_a and "set" in name_l and "aside" in name_l:
        return False
    # "Overturns" in Scenario B (without "adverse") = good for TATA
    if not is_scenario_a and any(w in name_l for w in ["overturn", "overturns"]):
        return True
    # Fallback: first child in list = TATA wins (common convention)
    return True


def _extract_duration(node: TreeNode) -> float:
    """Extract duration from a TreeNode's duration_distribution field."""
    dd = node.duration_distribution
    if not dd:
        return 4.0  # default SLP dismissed duration
    if dd.get("type") == "fixed":
        return float(dd.get("value", 4.0))
    # Uniform: return midpoint as the fixed duration for the path table
    # (actual MC draw happens in v2_probability_tree.py)
    return float(dd.get("value", dd.get("low", 4.0)))


def _add_leaf_path(
    paths: list[dict],
    counter: list[int],
    is_scenario_a: bool,
    *,
    s34_tata_wins: bool,
    s34_prob: float,
    s37_tata_wins: Optional[bool],
    s37_prob: float,
    slp_admitted: Optional[bool],
    slp_gate_prob: float,
    slp_merits_tata_wins: Optional[bool],
    slp_merits_prob: Optional[float],
    outcome: str,
    slp_duration: float,
) -> None:
    """Build and append one flat path dict for domestic trees."""
    counter[0] += 1
    prefix = "A" if is_scenario_a else "B"
    path_id = f"{prefix}{counter[0]}"

    # Compute conditional probability
    cond_prob = s34_prob
    if s37_prob > 0:
        cond_prob *= s37_prob
    if slp_gate_prob > 0:
        cond_prob *= slp_gate_prob
    if slp_merits_prob is not None and slp_merits_prob > 0:
        cond_prob *= slp_merits_prob

    paths.append({
        "path_id": path_id,
        "s34_tata_wins": s34_tata_wins,
        "s34_prob": s34_prob,
        "s37_tata_wins": s37_tata_wins if s37_tata_wins is not None else True,
        "s37_prob": s37_prob,
        "slp_admitted": slp_admitted if slp_admitted is not None else False,
        "slp_gate_prob": slp_gate_prob,
        "slp_merits_tata_wins": slp_merits_tata_wins,
        "slp_merits_prob": slp_merits_prob,
        "conditional_prob": cond_prob,
        "outcome": outcome,
        "slp_duration_months": slp_duration,
        "description": f"Path {path_id}",
    })


# ============================================================================
# Merge per-claim results into portfolio SimulationResults
# ============================================================================

def merge_portfolio_results(
    per_claim_results: dict[str, list[V2PathResult]],
    claims: list[PlatformClaim],
    n_paths: int,
    seed: int,
) -> SimulationResults:
    """Merge per-claim path results into a single ``SimulationResults``.

    Parameters
    ----------
    per_claim_results : dict[str, list[V2PathResult]]
        ``{claim_id: [PathResult × n_paths]}`` — one list per claim.
    claims : list[PlatformClaim]
        Original platform claim configs.
    n_paths : int
        Number of MC paths.
    seed : int
        RNG seed used.

    Returns
    -------
    SimulationResults
        Merged container with per-claim results and aggregated metrics.
    """
    claim_ids = [c.id for c in claims]
    sim = SimulationResults(
        n_paths=n_paths,
        seed=seed,
        claim_ids=claim_ids,
    )

    for claim_id, path_results in per_claim_results.items():
        sim.add_claim_results(claim_id, path_results)

    # Compute aggregated metrics
    for claim in claims:
        cid = claim.id
        results = sim.get_claim_results(cid)
        if not results:
            continue

        # Expected quantum (deterministic)
        eq_values = [
            r.quantum.expected_quantum_cr
            for r in results
            if r.quantum is not None
        ]
        if eq_values:
            sim.expected_quantum_map[cid] = eq_values[0]

        # Mean duration
        durations = [r.total_duration_months for r in results]
        if durations:
            sim.mean_duration_map[cid] = sum(durations) / len(durations)

        # Win rate
        wins = sum(1 for r in results if r.final_outcome != "LOSE")
        sim.win_rate_map[cid] = wins / len(results) if results else 0.0

    # Portfolio metadata
    jurisdiction_mix: dict[str, int] = {}
    for claim in claims:
        jur = _JURISDICTION_MAP.get(claim.jurisdiction, claim.jurisdiction)
        jurisdiction_mix[jur] = jurisdiction_mix.get(jur, 0) + 1
    sim.jurisdiction_mix = jurisdiction_mix
    sim.portfolio_soc_cr = sum(c.soc_value_cr for c in claims)

    return sim
