"""
TATA_code_v2/v2_json_exporter.py — Export simulation results to JSON for dashboard.
=====================================================================================

Produces TATA_code_v2/outputs/dashboard_data.json containing:
  - claims: per-claim config + simulation stats
  - probability_summary: domestic/SIAC path probabilities
  - quantum_summary: per-claim E[Q], percentiles
  - timeline_summary: per-claim E[dur], percentiles
  - legal_cost_summary: per-claim legal cost stats
  - investment_grid_soc / investment_grid_eq: full 6×7 matrix
  - per_claim_grid: per-claim metrics for key scenarios
  - breakeven_data: per-claim max breakeven %
  - scenario_comparison: 7-scenario summary with verdicts
  - simulation_meta: run parameters
"""

from __future__ import annotations

import json
import os
from datetime import datetime
from typing import Any

import numpy as np

from . import v2_master_inputs as MI
from .v2_config import ClaimConfig, SimulationResults, SettlementResult
from .v2_investment_analysis import InvestmentGridResults


def _safe(v: Any) -> Any:
    """Convert numpy types to JSON-serializable Python types."""
    if isinstance(v, (np.integer,)):
        return int(v)
    if isinstance(v, (np.floating,)):
        return float(v)
    if isinstance(v, np.ndarray):
        return v.tolist()
    if isinstance(v, (np.bool_,)):
        return bool(v)
    return v


def _pct(v: float) -> float:
    """Round to 4 decimal places."""
    return round(float(v), 6)


def _cr(v: float) -> float:
    """Round currency to 2dp."""
    return round(float(v), 2)


# ===================================================================
# Section builders
# ===================================================================

def _build_claims_section(
    sim: SimulationResults,
    claims: list[ClaimConfig],
) -> list[dict]:
    """Per-claim config + MC stats."""
    out = []
    for c in claims:
        cid = c.claim_id
        paths = sim.results.get(cid, [])
        n = len(paths)

        # Outcome distribution
        outcomes = {"TRUE_WIN": 0, "RESTART": 0, "LOSE": 0, "SETTLED": 0}
        durations = []
        legal_costs = []
        collected_vals = []
        interest_vals = []

        for p in paths:
            outcomes[p.final_outcome] = outcomes.get(p.final_outcome, 0) + 1
            durations.append(float(p.total_duration_months))
            legal_costs.append(float(p.legal_cost_total_cr))
            collected_vals.append(float(p.collected_cr))
            interest_vals.append(float(p.interest_earned_cr))

        dur_arr = np.array(durations) if durations else np.array([0.0])
        lc_arr = np.array(legal_costs) if legal_costs else np.array([0.0])
        col_arr = np.array(collected_vals) if collected_vals else np.array([0.0])
        int_arr = np.array(interest_vals) if interest_vals else np.array([0.0])

        # Economic viability check: can the claim's max possible return exceed legal costs?
        mean_lc = float(np.mean(lc_arr)) if len(lc_arr) > 0 else 0.0
        # At best, the fund gets award_share × SOC. Use reference award_share = 0.70.
        max_return_at_ref = c.soc_value_cr * 0.70
        economically_viable = max_return_at_ref > mean_lc
        viability_note = ""
        if not economically_viable:
            viability_note = (
                f"SOC (₹{c.soc_value_cr:.1f} Cr) × 70% award share = "
                f"₹{max_return_at_ref:.1f} Cr < mean legal cost ₹{mean_lc:.1f} Cr. "
                "Guaranteed loss at all pricing levels."
            )

        out.append({
            "claim_id": cid,
            "name": getattr(c, 'name', '') or c.archetype.replace('_', ' ').title() or f"Claim {i+1}",
            "archetype": c.archetype,
            "soc_value_cr": _cr(c.soc_value_cr),
            "jurisdiction": c.jurisdiction,
            "current_gate": c.current_gate,
            "tpl_share": c.tpl_share,
            "pipeline": c.pipeline,
            "expected_quantum_cr": _cr(sim.expected_quantum_map.get(cid, 0.0)),
            "win_rate": _pct(sim.win_rate_map.get(cid, 0.0)),
            "mean_duration_months": _pct(sim.mean_duration_map.get(cid, 0.0)),
            "economically_viable": economically_viable,
            "viability_note": viability_note,
            "outcome_distribution": {
                "TRUE_WIN": outcomes.get("TRUE_WIN", 0),
                "RESTART": outcomes.get("RESTART", 0),
                "LOSE": outcomes.get("LOSE", 0),
                "SETTLED": outcomes.get("SETTLED", 0),
            },
            "duration_stats": {
                "mean": _pct(np.mean(dur_arr)),
                "median": _pct(np.median(dur_arr)),
                "p5": _pct(np.percentile(dur_arr, 5)),
                "p25": _pct(np.percentile(dur_arr, 25)),
                "p75": _pct(np.percentile(dur_arr, 75)),
                "p95": _pct(np.percentile(dur_arr, 95)),
            },
            "legal_cost_stats": {
                "mean": _cr(np.mean(lc_arr)),
                "median": _cr(np.median(lc_arr)),
                "p5": _cr(np.percentile(lc_arr, 5)),
                "p95": _cr(np.percentile(lc_arr, 95)),
                "total_portfolio_mean": _cr(np.sum(lc_arr) / max(n, 1)),
            },
            "collected_stats": {
                "mean": _cr(np.mean(col_arr)),
                "median": _cr(np.median(col_arr)),
                "p5": _cr(np.percentile(col_arr, 5)),
                "p95": _cr(np.percentile(col_arr, 95)),
            },
            "interest_stats": {
                "mean": _cr(np.mean(int_arr)),
                "median": _cr(np.median(int_arr)),
                "p5": _cr(np.percentile(int_arr, 5)),
                "p95": _cr(np.percentile(int_arr, 95)),
            },
        })
    return out


def _build_settlement_summary(
    sim: SimulationResults,
    claims: list[ClaimConfig],
) -> dict:
    """Build settlement analytics for the dashboard.

    Returns a dict with settlement config, summary stats, per-stage breakdown,
    per-claim analysis, settled-vs-judgment comparison, timing histogram,
    and game-theoretic analytics (when applicable).
    """
    total_soc = sum(c.soc_value_cr for c in claims)
    n_paths = sim.n_paths

    # ── Collect all settled and non-settled paths ──
    settled_paths: list[tuple[str, Any]] = []  # (claim_id, PathResult)
    judgment_paths: list[tuple[str, Any]] = []

    for c in claims:
        cid = c.claim_id
        for p in sim.results.get(cid, []):
            if p.settlement is not None and p.settlement.settled:
                settled_paths.append((cid, p))
            else:
                judgment_paths.append((cid, p))

    n_settled = len(settled_paths)
    n_judgment = len(judgment_paths)
    settlement_rate = n_settled / (n_settled + n_judgment) if (n_settled + n_judgment) > 0 else 0.0

    # ── Summary ──
    settled_amounts = [p.settlement.settlement_amount_cr for _, p in settled_paths]
    mean_settlement_cr = float(np.mean(settled_amounts)) if settled_amounts else 0.0
    mean_settlement_pct = mean_settlement_cr / total_soc if total_soc > 0 else 0.0

    summary = {
        "total_paths": n_settled + n_judgment,
        "settled_paths": n_settled,
        "settlement_rate": _pct(settlement_rate),
        "judgment_paths": n_judgment,
        "mean_settlement_amount_cr": _cr(mean_settlement_cr),
        "mean_settlement_as_pct_of_soc": _pct(mean_settlement_pct),
    }

    # ── Per-stage breakdown ──
    stage_data: dict[str, list] = {}  # stage → list of (amount, discount, timing)
    for _, p in settled_paths:
        s = p.settlement
        stage = s.settlement_stage or "unknown"
        stage_data.setdefault(stage, []).append({
            "amount": s.settlement_amount_cr,
            "discount": s.settlement_discount_used,
            "timing": s.settlement_timing_months,
        })

    per_stage = []
    for stage, entries in sorted(stage_data.items()):
        count = len(entries)
        per_stage.append({
            "stage": stage,
            "count": count,
            "pct_of_total": _pct(count / (n_settled + n_judgment)) if (n_settled + n_judgment) > 0 else 0.0,
            "pct_of_settlements": _pct(count / n_settled) if n_settled > 0 else 0.0,
            "mean_discount_used": _pct(float(np.mean([e["discount"] for e in entries]))),
            "mean_amount_cr": _cr(float(np.mean([e["amount"] for e in entries]))),
            "mean_timing_months": round(float(np.mean([e["timing"] for e in entries])), 1),
        })

    # ── Per-claim settlement stats ──
    per_claim: dict[str, dict] = {}
    for c in claims:
        cid = c.claim_id
        claim_settled = [(cid2, p) for cid2, p in settled_paths if cid2 == cid]
        claim_total = len(sim.results.get(cid, []))
        if claim_total == 0:
            continue
        if claim_settled:
            amounts = [p.settlement.settlement_amount_cr for _, p in claim_settled]
            discounts = [p.settlement.settlement_discount_used for _, p in claim_settled]
            timings = [p.settlement.settlement_timing_months for _, p in claim_settled]
            per_claim[cid] = {
                "settlement_rate": _pct(len(claim_settled) / claim_total),
                "mean_amount_cr": _cr(float(np.mean(amounts))),
                "mean_discount": _pct(float(np.mean(discounts))),
                "mean_timing_months": round(float(np.mean(timings)), 1),
            }
        else:
            per_claim[cid] = {
                "settlement_rate": 0.0,
                "mean_amount_cr": 0.0,
                "mean_discount": 0.0,
                "mean_timing_months": 0.0,
            }

    # ── Settled vs judgment comparison ──
    def _group_stats(path_list):
        if not path_list:
            return {"mean_moic": 0.0, "mean_irr": 0.0, "mean_duration_months": 0.0, "mean_legal_cost_cr": 0.0}
        moics = [p.moic for _, p in path_list if p.moic is not None]
        irrs = [p.irr for _, p in path_list if p.irr is not None]
        durs = [p.total_duration_months for _, p in path_list]
        costs = [p.legal_cost_total_cr for _, p in path_list]
        return {
            "mean_moic": _pct(float(np.mean(moics))) if moics else 0.0,
            "mean_irr": _pct(float(np.mean(irrs))) if irrs else 0.0,
            "mean_duration_months": round(float(np.mean(durs)), 1) if durs else 0.0,
            "mean_legal_cost_cr": _cr(float(np.mean(costs))) if costs else 0.0,
        }

    comparison = {
        "settled_paths": _group_stats(settled_paths),
        "judgment_paths": _group_stats(judgment_paths),
    }

    # ── Timing histogram (6-month bins) ──
    timing_histogram = []
    if settled_paths:
        all_timings = [p.settlement.settlement_timing_months for _, p in settled_paths]
        max_timing = max(all_timings)
        bin_size = 6
        for bin_start in range(0, int(max_timing) + bin_size, bin_size):
            count = sum(1 for t in all_timings if bin_start <= t < bin_start + bin_size)
            if count > 0:
                timing_histogram.append({
                    "month_bin": bin_start + bin_size,
                    "count": count,
                })

    # ── Derive settlement mode from path results (MI may be restored to defaults) ──
    _modes_seen = set()
    for _, p in settled_paths:
        if p.settlement and p.settlement.settlement_mode != "none":
            _modes_seen.add(p.settlement.settlement_mode)
    settlement_mode = _modes_seen.pop() if len(_modes_seen) == 1 else (
        MI.SETTLEMENT_MODE if MI.SETTLEMENT_MODE != "user_specified" or not _modes_seen
        else next(iter(_modes_seen))
    )

    # ── Game-theoretic analytics ──
    game_theoretic = None
    if settlement_mode == "game_theoretic":
        from .v2_settlement import compute_game_theoretic_discounts, compute_continuation_values

        gt_discounts: dict[str, dict] = {}
        gt_cont_values: dict[str, dict] = {}

        # Compute for each jurisdiction present in claims
        jurisdictions_seen = set()
        for c in claims:
            jur = c.jurisdiction
            if jur in jurisdictions_seen:
                continue
            jurisdictions_seen.add(jur)
            eq_cr = sim.expected_quantum_map.get(c.claim_id, c.soc_value_cr * 0.5)

            for arb_won in [True, False, None]:
                regime_label = {True: "post_award_won", False: "post_award_lost", None: "pre_award"}[arb_won]
                try:
                    discounts = compute_game_theoretic_discounts(
                        jurisdiction=jur,
                        arb_won=arb_won,
                        expected_quantum_cr=eq_cr,
                        soc_value_cr=c.soc_value_cr,
                        bargaining_power=MI.SETTLEMENT_BARGAINING_POWER,
                    )
                    cont_vals = compute_continuation_values(
                        jurisdiction=jur,
                        arb_won=arb_won,
                        expected_quantum_cr=eq_cr,
                        soc_value_cr=c.soc_value_cr,
                    )
                    for stage, delta in discounts.items():
                        key = f"{jur}_{regime_label}_{stage}"
                        gt_discounts[key] = _pct(delta)
                    for stage, vals in cont_vals.items():
                        key = f"{jur}_{regime_label}_{stage}"
                        gt_cont_values[key] = {
                            "v_claimant_cr": _cr(vals["v_claimant"]),
                            "v_respondent_cr": _cr(vals["v_respondent"]),
                        }
                except Exception:
                    pass  # Skip regimes that don't apply to this jurisdiction

        game_theoretic = {
            "bargaining_power": MI.SETTLEMENT_BARGAINING_POWER,
            "per_stage_discounts": gt_discounts,
            "per_stage_continuation_values": gt_cont_values,
        }

    # ── Config snapshot ──
    stage_overrides = []
    for stage, rate in MI.SETTLEMENT_STAGE_HAZARD_RATES.items():
        override = {"stage_name": stage, "hazard_rate": rate}
        if stage in MI.SETTLEMENT_STAGE_DISCOUNT_FACTORS:
            override["discount_factor"] = MI.SETTLEMENT_STAGE_DISCOUNT_FACTORS[stage]
        stage_overrides.append(override)

    config = {
        "global_hazard_rate": MI.SETTLEMENT_GLOBAL_HAZARD_RATE,
        "discount_min": MI.SETTLEMENT_DISCOUNT_MIN,
        "discount_max": MI.SETTLEMENT_DISCOUNT_MAX,
        "delay_months": MI.SETTLEMENT_DELAY_MONTHS,
        "stage_overrides": stage_overrides,
    }

    return {
        "enabled": True,
        "mode": settlement_mode,
        "config": config,
        "summary": summary,
        "per_stage": per_stage,
        "per_claim": per_claim,
        "comparison": comparison,
        "timing_histogram": timing_histogram,
        "game_theoretic": game_theoretic,
    }


def _build_probability_summary() -> dict:
    """Domestic and SIAC tree path probabilities for visualization."""
    arb_win = MI.ARB_WIN_PROBABILITY
    arb_lose = 1.0 - arb_win

    domestic_a = []
    for p in MI.DOMESTIC_PATHS_A:
        domestic_a.append({
            "path_id": p["path_id"],
            "outcome": p["outcome"],
            "conditional_prob": _pct(p["conditional_prob"]),
            "absolute_prob": _pct(p["conditional_prob"] * arb_win),
            "description": p.get("description", ""),
            "slp_duration_months": _safe(p.get("slp_duration_months", 0)),
        })

    domestic_b = []
    for p in MI.DOMESTIC_PATHS_B:
        domestic_b.append({
            "path_id": p["path_id"],
            "outcome": p["outcome"],
            "conditional_prob": _pct(p["conditional_prob"]),
            "absolute_prob": _pct(p["conditional_prob"] * arb_lose),
            "description": p.get("description", ""),
            "slp_duration_months": _safe(p.get("slp_duration_months", 0)),
        })

    siac_a = []
    for p in MI.SIAC_PATHS_A:
        siac_a.append({
            "path_id": p["path_id"],
            "outcome": p["outcome"],
            "conditional_prob": _pct(p["conditional_prob"]),
            "absolute_prob": _pct(p["conditional_prob"] * arb_win),
            "description": p.get("description", ""),
        })

    siac_b = []
    for p in MI.SIAC_PATHS_B:
        siac_b.append({
            "path_id": p["path_id"],
            "outcome": p["outcome"],
            "conditional_prob": _pct(p["conditional_prob"]),
            "absolute_prob": _pct(p["conditional_prob"] * arb_lose),
            "description": p.get("description", ""),
        })

    # Aggregate outcome probabilities
    dom_tw = sum(p["conditional_prob"] for p in MI.DOMESTIC_PATHS_A if p["outcome"] == "TRUE_WIN") * arb_win
    dom_re = sum(p["conditional_prob"] for p in MI.DOMESTIC_PATHS_A if p["outcome"] == "RESTART") * arb_win
    dom_lo = sum(p["conditional_prob"] for p in MI.DOMESTIC_PATHS_A if p["outcome"] == "LOSE") * arb_win
    dom_tw += sum(p["conditional_prob"] for p in MI.DOMESTIC_PATHS_B if p["outcome"] == "TRUE_WIN") * arb_lose
    dom_re += sum(p["conditional_prob"] for p in MI.DOMESTIC_PATHS_B if p["outcome"] == "RESTART") * arb_lose
    dom_lo += sum(p["conditional_prob"] for p in MI.DOMESTIC_PATHS_B if p["outcome"] == "LOSE") * arb_lose

    # Normalize domestic aggregates to ensure they sum to exactly 1.0
    dom_total = dom_tw + dom_re + dom_lo
    if dom_total > 0:
        dom_tw, dom_re, dom_lo = dom_tw / dom_total, dom_re / dom_total, dom_lo / dom_total

    siac_tw = sum(p["conditional_prob"] for p in MI.SIAC_PATHS_A if p["outcome"] == "TRUE_WIN") * arb_win
    siac_re = sum(p["conditional_prob"] for p in MI.SIAC_PATHS_A if p["outcome"] == "RESTART") * arb_win
    siac_lo = sum(p["conditional_prob"] for p in MI.SIAC_PATHS_A if p["outcome"] == "LOSE") * arb_win
    siac_tw += sum(p["conditional_prob"] for p in MI.SIAC_PATHS_B if p["outcome"] == "TRUE_WIN") * arb_lose
    siac_re += sum(p["conditional_prob"] for p in MI.SIAC_PATHS_B if p["outcome"] == "RESTART") * arb_lose
    siac_lo += sum(p["conditional_prob"] for p in MI.SIAC_PATHS_B if p["outcome"] == "LOSE") * arb_lose

    # Normalize SIAC aggregates to ensure they sum to exactly 1.0
    siac_total = siac_tw + siac_re + siac_lo
    if siac_total > 0:
        siac_tw, siac_re, siac_lo = siac_tw / siac_total, siac_re / siac_total, siac_lo / siac_total

    # HKIAC path data
    hkiac_a = []
    for p in MI.HKIAC_PATHS_A:
        hkiac_a.append({
            "path_id": p["path_id"],
            "outcome": p["outcome"],
            "conditional_prob": _pct(p["conditional_prob"]),
            "absolute_prob": _pct(p["conditional_prob"] * arb_win),
            "description": p.get("description", ""),
        })

    hkiac_b = []
    for p in MI.HKIAC_PATHS_B:
        hkiac_b.append({
            "path_id": p["path_id"],
            "outcome": p["outcome"],
            "conditional_prob": _pct(p["conditional_prob"]),
            "absolute_prob": _pct(p["conditional_prob"] * arb_lose),
            "description": p.get("description", ""),
        })

    # HKIAC aggregate outcome probabilities
    hk_tw = sum(p["conditional_prob"] for p in MI.HKIAC_PATHS_A if p["outcome"] == "TRUE_WIN") * arb_win
    hk_re = sum(p["conditional_prob"] for p in MI.HKIAC_PATHS_A if p["outcome"] == "RESTART") * arb_win
    hk_lo = sum(p["conditional_prob"] for p in MI.HKIAC_PATHS_A if p["outcome"] == "LOSE") * arb_win
    hk_tw += sum(p["conditional_prob"] for p in MI.HKIAC_PATHS_B if p["outcome"] == "TRUE_WIN") * arb_lose
    hk_re += sum(p["conditional_prob"] for p in MI.HKIAC_PATHS_B if p["outcome"] == "RESTART") * arb_lose
    hk_lo += sum(p["conditional_prob"] for p in MI.HKIAC_PATHS_B if p["outcome"] == "LOSE") * arb_lose

    hk_total = hk_tw + hk_re + hk_lo
    if hk_total > 0:
        hk_tw, hk_re, hk_lo = hk_tw / hk_total, hk_re / hk_total, hk_lo / hk_total

    # ── Build hierarchical tree nodes for SVG visualization ──
    # ── Party names for dynamic labels ──
    claimant = getattr(MI, 'CLAIMANT_NAME', 'Claimant') or 'Claimant'
    respondent = getattr(MI, 'RESPONDENT_NAME', 'Respondent') or 'Respondent'

    def _build_domestic_tree(scenario_label, paths, arb_prob):
        """Build a hierarchical node tree from flat domestic paths."""
        root = {
            "id": f"arb_{scenario_label.lower()}",
            "label": f"Arbitration\n{claimant + ' Wins' if scenario_label == 'A' else claimant + ' Loses'}",
            "prob": round(arb_prob, 4),
            "children": [],
        }
        # Group by S.34 outcome
        s34_groups = {}
        for p in paths:
            s34_key = "claimant_wins" if p.get("s34_tata_wins") else "respondent_wins"
            if s34_key not in s34_groups:
                s34_prob = p["s34_prob"]
                s34_groups[s34_key] = {
                    "id": f"s34_{s34_key}_{scenario_label}",
                    "label": f"S.34\n{claimant + ' wins' if s34_key == 'claimant_wins' else respondent + ' wins'}",
                    "prob": round(s34_prob, 4),
                    "children": [],
                    "_paths": [],
                }
            s34_groups[s34_key]["_paths"].append(p)

        for s34_key, s34_node in s34_groups.items():
            # Group by S.37 outcome
            s37_groups = {}
            for p in s34_node["_paths"]:
                s37_key = "claimant_wins" if p.get("s37_tata_wins") else "respondent_wins"
                if s37_key not in s37_groups:
                    s37_groups[s37_key] = {
                        "id": f"s37_{s37_key}_{s34_key}_{scenario_label}",
                        "label": f"S.37\n{claimant + ' wins' if s37_key == 'claimant_wins' else respondent + ' wins'}",
                        "prob": round(p.get("s37_prob", 0.5), 4),
                        "children": [],
                        "_paths": [],
                    }
                s37_groups[s37_key]["_paths"].append(p)

            for s37_key, s37_node in s37_groups.items():
                # Group by SLP gate
                slp_groups = {}
                for p in s37_node["_paths"]:
                    slp_key = "admitted" if p.get("slp_admitted") else "dismissed"
                    if slp_key not in slp_groups:
                        slp_groups[slp_key] = {
                            "id": f"slp_{slp_key}_{s37_key}_{s34_key}_{scenario_label}",
                            "label": f"SLP\n{slp_key.title()}",
                            "prob": round(p.get("slp_gate_prob", 0.5), 4),
                            "children": [],
                            "_paths": [],
                        }
                    slp_groups[slp_key]["_paths"].append(p)

                for slp_key, slp_node in slp_groups.items():
                    if slp_key == "dismissed":
                        # Terminal node
                        p = slp_node["_paths"][0]
                        slp_node["outcome"] = p["outcome"]
                        slp_node["abs_prob"] = round(p["conditional_prob"] * arb_prob, 6)
                    else:
                        # SLP merits
                        for p in slp_node["_paths"]:
                            merits_key = "claimant_wins" if p.get("slp_merits_tata_wins") else "claimant_loses"
                            child = {
                                "id": f"merits_{merits_key}_{slp_key}_{s37_key}_{s34_key}_{scenario_label}",
                                "label": f"SLP Merits\n{claimant + ' wins' if merits_key == 'claimant_wins' else claimant + ' loses'}",
                                "prob": round(p.get("slp_merits_prob", 0.5), 4),
                                "outcome": p["outcome"],
                                "abs_prob": round(p["conditional_prob"] * arb_prob, 6),
                            }
                            slp_node["children"].append(child)

                    del slp_node["_paths"]
                    s37_node["children"].append(slp_node)

                del s37_node["_paths"]
                s34_node["children"].append(s37_node)

            del s34_node["_paths"]
            root["children"].append(s34_node)

        return root

    def _build_siac_tree(scenario_label, paths, arb_prob):
        """Build a hierarchical node tree from flat SIAC paths."""
        root = {
            "id": f"arb_{scenario_label.lower()}_siac",
            "label": f"Arbitration\n{claimant + ' Wins' if scenario_label == 'A' else claimant + ' Loses'}",
            "prob": round(arb_prob, 4),
            "children": [],
        }
        hc_groups = {}
        for p in paths:
            hc_key = "claimant_wins" if p.get("hc_tata_wins") else "claimant_loses"
            if hc_key not in hc_groups:
                hc_groups[hc_key] = {
                    "id": f"hc_{hc_key}_{scenario_label}",
                    "label": f"High Court\n{claimant + ' wins' if hc_key == 'claimant_wins' else claimant + ' loses'}",
                    "prob": round(p["hc_prob"], 4),
                    "children": [],
                }
            # COA node is terminal
            coa_key = "claimant_wins" if p.get("coa_tata_wins") else "claimant_loses"
            hc_groups[hc_key]["children"].append({
                "id": f"coa_{coa_key}_{hc_key}_{scenario_label}",
                "label": f"Court of Appeal\n{claimant + ' wins' if coa_key == 'claimant_wins' else claimant + ' loses'}",
                "prob": round(p["coa_prob"], 4),
                "outcome": p["outcome"],
                "abs_prob": round(p["conditional_prob"] * arb_prob, 6),
            })

        for hc_node in hc_groups.values():
            root["children"].append(hc_node)

        return root

    def _build_hkiac_tree(scenario_label, paths, arb_prob):
        """Build a hierarchical node tree from flat HKIAC paths: CFI → CA → CFA."""
        root = {
            "id": f"arb_{scenario_label.lower()}_hkiac",
            "label": f"Arbitration\n{claimant + ' Wins' if scenario_label == 'A' else claimant + ' Loses'}",
            "prob": round(arb_prob, 4),
            "children": [],
        }
        cfi_groups = {}
        for p in paths:
            cfi_key = "upheld" if p.get("cfi_tata_wins") else "set_aside"
            if cfi_key not in cfi_groups:
                cfi_groups[cfi_key] = {
                    "id": f"cfi_{cfi_key}_{scenario_label}",
                    "label": f"CFI\n{'Upheld' if cfi_key == 'upheld' else 'Set Aside'}",
                    "prob": round(p["cfi_prob"] if cfi_key == "upheld" else (1 - p["cfi_prob"]), 4),
                    "children": [],
                    "_paths": [],
                }
            cfi_groups[cfi_key]["_paths"].append(p)

        for cfi_key, cfi_node in cfi_groups.items():
            ca_groups = {}
            for p in cfi_node["_paths"]:
                ca_key = "claimant_wins" if p.get("ca_tata_wins") else "claimant_loses"
                if ca_key not in ca_groups:
                    ca_groups[ca_key] = {
                        "id": f"ca_{ca_key}_{cfi_key}_{scenario_label}",
                        "label": f"CA\n{claimant + ' wins' if ca_key == 'claimant_wins' else claimant + ' loses'}",
                        "prob": round(p["ca_prob"], 4),
                        "children": [],
                        "_paths": [],
                    }
                ca_groups[ca_key]["_paths"].append(p)

            for ca_key, ca_node in ca_groups.items():
                cfa_gate_groups = {}
                for p in ca_node["_paths"]:
                    gate_key = "granted" if p.get("cfa_leave_granted") else "refused"
                    if gate_key not in cfa_gate_groups:
                        cfa_gate_groups[gate_key] = {
                            "id": f"cfa_leave_{gate_key}_{ca_key}_{cfi_key}_{scenario_label}",
                            "label": f"CFA Leave\n{gate_key.title()}",
                            "prob": round(p["cfa_leave_prob"] if gate_key == "granted" else (1 - p["cfa_leave_prob"]), 4),
                            "children": [],
                            "_paths": [],
                        }
                    cfa_gate_groups[gate_key]["_paths"].append(p)

                for gate_key, gate_node in cfa_gate_groups.items():
                    if gate_key == "refused":
                        # Terminal node — leave refused ends here
                        p = gate_node["_paths"][0]
                        gate_node["outcome"] = p["outcome"]
                        gate_node["abs_prob"] = round(p["conditional_prob"] * arb_prob, 6)
                    else:
                        # CFA merits
                        for p in gate_node["_paths"]:
                            merits_key = "claimant_wins" if p.get("cfa_tata_wins") else "claimant_loses"
                            child = {
                                "id": f"cfa_merits_{merits_key}_{gate_key}_{ca_key}_{cfi_key}_{scenario_label}",
                                "label": f"CFA Merits\n{claimant + ' wins' if merits_key == 'claimant_wins' else claimant + ' loses'}",
                                "prob": round(p.get("cfa_merits_prob", 0.5), 4),
                                "outcome": p["outcome"],
                                "abs_prob": round(p["conditional_prob"] * arb_prob, 6),
                            }
                            gate_node["children"].append(child)

                    del gate_node["_paths"]
                    ca_node["children"].append(gate_node)

                del ca_node["_paths"]
                cfi_node["children"].append(ca_node)

            del cfi_node["_paths"]
            root["children"].append(cfi_node)

        return root

    # Build tree structures
    tree_nodes = {
        "domestic": {
            "scenario_a": _build_domestic_tree("A", MI.DOMESTIC_PATHS_A, arb_win),
            "scenario_b": _build_domestic_tree("B", MI.DOMESTIC_PATHS_B, arb_lose),
        },
        "siac": {
            "scenario_a": _build_siac_tree("A", MI.SIAC_PATHS_A, arb_win),
            "scenario_b": _build_siac_tree("B", MI.SIAC_PATHS_B, arb_lose),
        },
        "hkiac": {
            "scenario_a": _build_hkiac_tree("A", MI.HKIAC_PATHS_A, arb_win),
            "scenario_b": _build_hkiac_tree("B", MI.HKIAC_PATHS_B, arb_lose),
        },
    }

    return {
        "arb_win_probability": arb_win,
        "re_arb_win_probability": MI.RE_ARB_WIN_PROBABILITY,
        "tree_nodes": tree_nodes,
        "domestic": {
            "scenario_a": domestic_a,
            "scenario_b": domestic_b,
            "aggregate": {
                "true_win": _pct(dom_tw),
                "restart": _pct(dom_re),
                "lose": _pct(dom_lo),
            },
        },
        "siac": {
            "scenario_a": siac_a,
            "scenario_b": siac_b,
            "aggregate": {
                "true_win": _pct(siac_tw),
                "restart": _pct(siac_re),
                "lose": _pct(siac_lo),
            },
        },
        "hkiac": {
            "scenario_a": hkiac_a,
            "scenario_b": hkiac_b,
            "aggregate": {
                "true_win": _pct(hk_tw),
                "restart": _pct(hk_re),
                "lose": _pct(hk_lo),
            },
        },
    }


def _build_quantum_summary(
    sim: SimulationResults,
    claims: list[ClaimConfig],
) -> dict:
    """Quantum band definitions + per-claim quantum stats from MC."""
    bands = []
    for i, b in enumerate(MI.QUANTUM_BANDS):
        bands.append({
            "band_idx": i,
            "low": b["low"],
            "high": b["high"],
            "probability": b["probability"],
            "midpoint": (b["low"] + b["high"]) / 2,
        })

    eq_win = sum(b["probability"] * (b["low"] + b["high"]) / 2 for b in MI.QUANTUM_BANDS)

    per_claim = {}
    for c in claims:
        cid = c.claim_id
        paths = sim.results.get(cid, [])
        quanta = [float(p.quantum.quantum_cr) for p in paths if p.quantum is not None]
        q_arr = np.array(quanta) if quanta else np.array([0.0])
        per_claim[cid] = {
            "soc_cr": _cr(c.soc_value_cr),
            "eq_cr": _cr(sim.expected_quantum_map.get(cid, 0.0)),
            "eq_pct_of_soc": _pct(eq_win),
            "mc_quantum_stats": {
                "mean": _cr(np.mean(q_arr)),
                "median": _cr(np.median(q_arr)),
                "p5": _cr(np.percentile(q_arr, 5)),
                "p25": _cr(np.percentile(q_arr, 25)),
                "p75": _cr(np.percentile(q_arr, 75)),
                "p95": _cr(np.percentile(q_arr, 95)),
            },
        }

    return {
        "bands": bands,
        "expected_quantum_pct_of_soc": _pct(eq_win),
        "per_claim": per_claim,
    }


def _build_timeline_summary(
    sim: SimulationResults,
    claims: list[ClaimConfig],
) -> dict:
    """Per-claim timeline stats from MC paths."""
    per_claim = {}
    for c in claims:
        cid = c.claim_id
        paths = sim.results.get(cid, [])
        durs = [float(p.total_duration_months) for p in paths]
        d_arr = np.array(durs) if durs else np.array([0.0])
        per_claim[cid] = {
            "pipeline": c.pipeline,
            "jurisdiction": c.jurisdiction,
            "mean": _pct(np.mean(d_arr)),
            "median": _pct(np.median(d_arr)),
            "p5": _pct(np.percentile(d_arr, 5)),
            "p25": _pct(np.percentile(d_arr, 25)),
            "p75": _pct(np.percentile(d_arr, 75)),
            "p95": _pct(np.percentile(d_arr, 95)),
            "max": _pct(np.max(d_arr)),
            "pct_above_96m": _pct(np.mean(d_arr > 96)),
        }
    return {
        "max_timeline_months": MI.MAX_TIMELINE_MONTHS,
        "per_claim": per_claim,
    }


def _build_legal_cost_summary(
    sim: SimulationResults,
    claims: list[ClaimConfig],
) -> dict:
    """Legal cost stats from MC and default table."""
    per_claim = {}
    total_mean = 0.0
    for c in claims:
        cid = c.claim_id
        paths = sim.results.get(cid, [])
        costs = [float(p.legal_cost_total_cr) for p in paths]
        lc_arr = np.array(costs) if costs else np.array([0.0])
        mean_lc = float(np.mean(lc_arr))
        total_mean += mean_lc

        # Get cost structure from MI (new model)
        onetime = MI.LEGAL_COSTS["onetime"]
        onetime_total = float(onetime["tribunal"]) + float(onetime["expert"])
        db = MI.LEGAL_COSTS["duration_based"]
        duration_stages = {}
        for stage_key, val in db.items():
            if isinstance(val, dict):
                duration_stages[stage_key] = {
                    "low": val["low"],
                    "high": val["high"],
                    "midpoint": (val["low"] + val["high"]) / 2,
                }
            else:
                duration_stages[stage_key] = {
                    "fixed": float(val),
                }

        per_claim[cid] = {
            "mean_total_cr": _cr(mean_lc),
            "median_total_cr": _cr(np.median(lc_arr)),
            "p5": _cr(np.percentile(lc_arr, 5)),
            "p95": _cr(np.percentile(lc_arr, 95)),
            "pct_of_soc": _pct(mean_lc / c.soc_value_cr) if c.soc_value_cr > 0 else 0.0,
            "onetime_total_cr": onetime_total,
            "duration_stages": duration_stages,
        }

    return {
        "overrun_params": {
            "alpha": MI.LEGAL_COST_OVERRUN["alpha"],
            "beta": MI.LEGAL_COST_OVERRUN["beta"],
            "low": MI.LEGAL_COST_OVERRUN["low"],
            "high": MI.LEGAL_COST_OVERRUN["high"],
            "expected_overrun_pct": round(
                MI.LEGAL_COST_OVERRUN["low"]
                + (MI.LEGAL_COST_OVERRUN["alpha"]
                   / (MI.LEGAL_COST_OVERRUN["alpha"] + MI.LEGAL_COST_OVERRUN["beta"]))
                * (MI.LEGAL_COST_OVERRUN["high"] - MI.LEGAL_COST_OVERRUN["low"]),
                4,
            ),
        },
        "portfolio_mean_total_cr": _cr(total_mean),
        "per_claim": per_claim,
    }


def _build_investment_grid(
    grid: InvestmentGridResults,
    basis: str,
) -> list[dict]:
    """Flatten the investment grid for one pricing basis."""
    rows = []
    for up_pct in grid.upfront_pcts:
        for aw_pct in grid.award_share_pcts:
            key = (up_pct, aw_pct, basis)
            cell = grid.cells.get(key)
            if cell is None:
                continue
            rows.append({
                "upfront_pct": up_pct,
                "tata_tail_pct": round(1.0 - aw_pct, 2),
                "award_share_pct": aw_pct,  # backward compat
                "mean_moic": _pct(cell.mean_moic),
                "median_moic": _pct(cell.median_moic),
                "std_moic": _pct(cell.std_moic),
                "mean_xirr": _pct(cell.mean_xirr),
                "median_xirr": _pct(cell.median_xirr),
                "mean_net_return_cr": _cr(cell.mean_net_return_cr),
                "p_loss": _pct(cell.p_loss),
                "p_irr_gt_30": _pct(cell.p_irr_gt_30),
                "p_irr_gt_25": _pct(cell.p_irr_gt_25),
                "var_1": _cr(cell.var_1),
                "cvar_1": _cr(cell.cvar_1),
            })
    return rows


def _build_per_claim_grid(
    grid: InvestmentGridResults,
    claims: list[ClaimConfig],
    scenarios: list[tuple[float, float, str]],
) -> dict:
    """Per-claim metrics for key scenarios."""
    result = {}
    for cid_cfg in claims:
        cid = cid_cfg.claim_id
        claim_scenarios = []
        for up_pct, aw_pct, basis in scenarios:
            key = (up_pct, aw_pct, basis)
            cell = grid.cells.get(key)
            if cell is None or cid not in cell.per_claim:
                continue
            m = cell.per_claim[cid]
            claim_scenarios.append({
                "upfront_pct": up_pct,
                "tata_tail_pct": round(1.0 - aw_pct, 2),
                "award_share_pct": aw_pct,  # backward compat
                "basis": basis,
                "mean_moic": _pct(m.get("E[MOIC]", 0.0)),
                "median_moic": _pct(m.get("median_MOIC", 0.0)),
                "mean_xirr": _pct(m.get("E[XIRR]", 0.0)),
                "median_xirr": _pct(m.get("median_XIRR", 0.0)),
                "conditional_xirr_win": _pct(m.get("conditional_E[XIRR|win]", 0.0)),
                "p_xirr_gt_0": _pct(m.get("P(XIRR>0)", 0.0)),
                "mean_net_return_cr": _cr(m.get("E[net_return_cr]", 0.0)),
                "p_loss": _pct(m.get("P(loss)", 0.0)),
                "p_irr_gt_30": _pct(m.get("P(IRR>30%)", 0.0)),
                "economically_viable": m.get("economically_viable", True),
                "mean_legal_cost_cr": _cr(m.get("mean_legal_cost_cr", 0.0)),
                "max_possible_return_cr": _cr(m.get("max_possible_return_cr", 0.0)),
            })
        result[cid] = claim_scenarios
    return result


def _build_breakeven_data(
    grid: InvestmentGridResults,
    claims: list[ClaimConfig],
) -> dict:
    """Breakeven surface per basis + per-claim breakeven at reference tata tail."""
    be_data = {}
    for basis in grid.pricing_bases:
        be_surface = grid.breakeven.get(basis, {})
        be_data[basis] = {
            "surface": [
                {"tata_tail_pct": round(1.0 - aw, 2), "award_share_pct": aw, "max_upfront_pct": _pct(mx)}
                for aw, mx in sorted(be_surface.items())
            ],
        }

    # Per-claim breakeven at 30% Tata tail (= 70% award share)
    ref_aw = 0.70  # fund keeps 70%, Tata tail = 30%
    per_claim_be = {}
    for c in claims:
        cid = c.claim_id
        claim_be = {}
        for basis in grid.pricing_bases:
            max_viable = 0.0
            for up_pct in sorted(grid.upfront_pcts):
                key = (up_pct, ref_aw, basis)
                cell = grid.cells.get(key)
                if cell and cid in cell.per_claim:
                    if cell.per_claim[cid].get("E[MOIC]", 0.0) >= 1.0:
                        max_viable = up_pct
            claim_be[basis] = _pct(max_viable)
        per_claim_be[cid] = {
            "soc_cr": _cr(c.soc_value_cr),
            "archetype": c.archetype,
            "soc_breakeven_pct": claim_be.get("soc", 0.0),
            "eq_breakeven_pct": claim_be.get("eq", 0.0),
        }

    return {
        "surfaces": be_data,
        "per_claim_at_30_tata_tail": per_claim_be,
    }


def _get_verdict(moic: float, p_loss: float) -> str:
    """Return investment verdict string."""
    if moic > 2.5 and p_loss < 0.10:
        return "STRONG BUY"
    if moic > 1.5 and p_loss < 0.25:
        return "ATTRACTIVE"
    if moic > 1.0 and p_loss < 0.40:
        return "MARGINAL"
    return "AVOID"


def _build_cashflow_analysis(
    sim: SimulationResults,
    claims: list[ClaimConfig],
    grid: InvestmentGridResults,
) -> dict:
    """Comprehensive cashflow analysis for dashboard Cashflow tab.
    
    Returns per-claim detail, annual/quarterly projections, portfolio distribution,
    value decomposition chain, and investor scenario comparisons — all in ₹ Crore.
    """
    total_soc = sum(c.soc_value_cr for c in claims)
    
    # ── E[Q|WIN] from quantum bands ──
    eq_given_win = sum(
        b["probability"] * (b["low"] + b["high"]) / 2
        for b in MI.QUANTUM_BANDS
    )
    
    # ── Per-claim cashflow stats ──
    per_claim = []
    for c in claims:
        cid = c.claim_id
        paths = sim.results.get(cid, [])
        if not paths:
            continue
        durations = np.array([p.total_duration_months for p in paths])
        collected = np.array([p.collected_cr for p in paths])
        legal_costs = np.array([p.legal_cost_total_cr for p in paths])
        outcomes = np.array([1 if p.final_outcome == "TRUE_WIN" else 0 for p in paths])
        net = collected - legal_costs
        
        per_claim.append({
            "claim_id": cid,
            "soc_cr": _cr(c.soc_value_cr),
            "jurisdiction": c.jurisdiction,
            "archetype": c.archetype,
            "eq_cr": _cr(sim.expected_quantum_map.get(cid, 0.0)),
            "eq_pct": _pct(sim.expected_quantum_map.get(cid, 0.0) / c.soc_value_cr if c.soc_value_cr > 0 else 0),
            "win_rate": _pct(float(np.mean(outcomes))),
            "e_collected_cr": _cr(float(np.mean(collected))),
            "p5_collected_cr": _cr(float(np.percentile(collected, 5))),
            "p25_collected_cr": _cr(float(np.percentile(collected, 25))),
            "p50_collected_cr": _cr(float(np.median(collected))),
            "p75_collected_cr": _cr(float(np.percentile(collected, 75))),
            "p95_collected_cr": _cr(float(np.percentile(collected, 95))),
            "e_legal_cr": _cr(float(np.mean(legal_costs))),
            "e_net_cr": _cr(float(np.mean(net))),
            "collected_over_soc": _pct(float(np.mean(collected)) / c.soc_value_cr if c.soc_value_cr > 0 else 0),
            "e_duration_months": round(float(np.mean(durations)), 1),
            "p5_duration": round(float(np.percentile(durations, 5)), 1),
            "p50_duration": round(float(np.median(durations)), 1),
            "p95_duration": round(float(np.percentile(durations, 95)), 1),
            "e_interest_cr": _cr(float(np.mean(np.array([p.interest_earned_cr for p in paths])))),
        })
    
    # ── Portfolio aggregates ──
    total_eq = sum(sim.expected_quantum_map.get(cid, 0.0) for cid in sim.claim_ids)
    total_e_collected = sum(d["e_collected_cr"] for d in per_claim)
    total_e_legal = sum(d["e_legal_cr"] for d in per_claim)
    # SOC-weighted win rate: predicts "average Rupee" performance, not "average claim"
    avg_win_rate = sum(d["soc_cr"] * d["win_rate"] for d in per_claim) / total_soc if total_soc > 0 else 0.0
    
    # ── Empirical P(survive|arb_win) and RESTART contribution ──
    # Tracks value from direct wins (arb_win → survive court) vs RESTART paths (arb_lose → court reversal → re-arb)
    n_arb_won = 0
    n_direct_win = 0
    direct_collected_cr = 0.0
    restart_collected_cr = 0.0
    for c in claims:
        cid = c.claim_id
        for p in sim.results.get(cid, []):
            if p.arb_won:
                n_arb_won += 1
                if p.final_outcome == "TRUE_WIN":
                    n_direct_win += 1
                    direct_collected_cr += p.collected_cr
            else:
                # arb_lost path — if final_outcome is TRUE_WIN, value came via RESTART → re-arb
                if p.final_outcome == "TRUE_WIN":
                    restart_collected_cr += p.collected_cr
    
    # Empirical court survival rate given arb win (should match probability trees: Domestic ~73.6%, SIAC ~82%)
    p_survive_arb_win = n_direct_win / n_arb_won if n_arb_won > 0 else 0.0
    # Average per claim for display
    direct_collected_avg = direct_collected_cr / len(claims) if claims else 0.0
    restart_collected_avg = restart_collected_cr / len(claims) if claims else 0.0
    
    # ── Portfolio-level path distributions ──
    portfolio_collected_per_path = np.zeros(sim.n_paths)
    portfolio_legal_per_path = np.zeros(sim.n_paths)
    for cid in sim.claim_ids:
        paths = sim.results.get(cid, [])
        for i, p in enumerate(paths):
            portfolio_collected_per_path[i] += p.collected_cr
            portfolio_legal_per_path[i] += p.legal_cost_total_cr
    portfolio_net = portfolio_collected_per_path - portfolio_legal_per_path
    
    distribution = {}
    for pctl in [1, 5, 10, 25, 50, 75, 90, 95, 99]:
        distribution[f"p{pctl}"] = {
            "gross_cr": _cr(float(np.percentile(portfolio_collected_per_path, pctl))),
            "legal_cr": _cr(float(np.percentile(portfolio_legal_per_path, pctl))),
            "net_cr": _cr(float(np.percentile(portfolio_net, pctl))),
            "net_over_soc": _pct(float(np.percentile(portfolio_net, pctl)) / total_soc),
        }
    distribution["mean"] = {
        "gross_cr": _cr(float(np.mean(portfolio_collected_per_path))),
        "legal_cr": _cr(float(np.mean(portfolio_legal_per_path))),
        "net_cr": _cr(float(np.mean(portfolio_net))),
        "net_over_soc": _pct(float(np.mean(portfolio_net)) / total_soc),
    }
    
    # ── Annual timeline ──
    all_durations = []
    all_collected = []
    for cid in sim.claim_ids:
        for p in sim.results.get(cid, []):
            all_durations.append(p.total_duration_months)
            all_collected.append(p.collected_cr)
    dur_arr = np.array(all_durations)
    col_arr = np.array(all_collected)
    n_total = len(dur_arr)
    n_claims = len(claims)
    
    annual_timeline = []
    cumul_recovery = 0.0
    for year in range(1, 9):
        m_start = (year - 1) * 12
        m_end = year * 12
        mask = (dur_arr > m_start) & (dur_arr <= m_end)
        pct_this = float(np.mean(mask))
        pct_cumul = float(np.mean(dur_arr <= m_end))
        recovery = float(np.sum(col_arr[mask])) / max(n_total / n_claims, 1)
        cumul_recovery += recovery
        
        if year <= 2:
            phase = "Investment & Pre-Arb"
        elif year <= 4:
            phase = "Arbitration & S.34"
        elif year <= 6:
            phase = "Appeals (S.37/SLP)"
        else:
            phase = "Tail / Re-Arbitration"
        
        annual_timeline.append({
            "year": year,
            "month_range": f"M{m_start+1}–M{m_end}",
            "pct_resolving": _pct(pct_this),
            "pct_cumulative": _pct(pct_cumul),
            "e_recovery_cr": _cr(recovery),
            "cumul_recovery_cr": _cr(cumul_recovery),
            "phase": phase,
        })
    
    # ── Quarterly timeline (first 6 years = 24 quarters) ──
    quarterly_timeline = []
    running = 0.0
    for q in range(1, 25):
        q_start = (q - 1) * 3
        q_end = q * 3
        mask_q = (dur_arr > q_start) & (dur_arr <= q_end)
        pct_q = float(np.mean(mask_q))
        recovery_q = float(np.sum(col_arr[mask_q])) / max(n_total / n_claims, 1)
        running += recovery_q
        quarterly_timeline.append({
            "quarter": q,
            "label": f"Q{q} (M{q_start+1}–M{q_end})",
            "pct_resolving": _pct(pct_q),
            "e_recovery_cr": _cr(recovery_q),
            "cumul_recovery_cr": _cr(running),
        })
    
    # ── Value decomposition chain ──
    # Compute intermediate values for the chain
    after_arb_win = total_soc * MI.ARB_WIN_PROBABILITY
    after_quantum = after_arb_win * eq_given_win
    direct_path_value = after_quantum * p_survive_arb_win
    restart_contribution = total_e_collected - direct_path_value
    
    decomposition = [
        {"step": "SOC", "label": "Total Statement of Claim",
         "factor": "—", "value_cr": _cr(total_soc),
         "note": f"Sum across {len(claims)} DFCCIL claims in portfolio"},
        {"step": "× P(arb_win)", "label": "Arbitration win probability",
         "factor": f"{MI.ARB_WIN_PROBABILITY:.0%}",
         "value_cr": _cr(after_arb_win),
         "note": f"Expert judgment based on DFCCIL historical outcomes; {MI.ARB_WIN_PROBABILITY:.0%} probability TATA wins first arbitration"},
        {"step": "× E[Q|WIN]", "label": "Expected quantum given win",
         "factor": f"{eq_given_win:.1%}",
         "value_cr": _cr(after_quantum),
         "note": "5-band quantum distribution: 70% chance of 80-100% SOC, 15% chance of 0-20% SOC, remainder spread across middle bands"},
        {"step": "× P(survive|arb_win)", "label": "Court survival given arb win",
         "factor": f"{p_survive_arb_win:.1%}",
         "value_cr": _cr(direct_path_value),
         "note": f"Empirical from MC: probability award survives post-arb court challenges (Domestic: S.34→S.37→SLP; SIAC: HC→COA). Based on {n_arb_won:,} arb-won paths."},
        {"step": "+ RESTART", "label": "Recovery via re-arbitration path",
         "factor": f"+₹{restart_contribution:.1f} Cr",
         "value_cr": _cr(total_e_collected),
         "note": f"Additional value from RESTART paths: arb_lose → court reverses adverse award → fresh re-arbitration (P={MI.RE_ARB_WIN_PROBABILITY:.0%}) → survive courts. Adds ₹{restart_contribution:.1f} Cr to expected recovery."},
        {"step": "= E[Collected]", "label": "Expected amount collected",
         "factor": f"{total_e_collected / total_soc:.1%} of SOC" if total_soc > 0 else "—",
         "value_cr": _cr(total_e_collected),
         "note": f"Total expected collection = direct path (₹{direct_path_value:.1f} Cr) + RESTART contribution (₹{restart_contribution:.1f} Cr). MC average over {sim.n_paths:,} paths."},
        {"step": "− E[Legal]", "label": "Minus expected legal costs",
         "factor": f"−₹{total_e_legal:.1f} Cr",
         "value_cr": _cr(total_e_collected - total_e_legal),
         "note": f"All-stage legal costs: tribunal fees, counsel, DAB, arbitration, court challenges. Average ₹{total_e_legal / len(claims):.1f} Cr per claim."},
    ]
    
    # ── Investor scenarios ──
    investor_scenarios = []
    scenario_defs = [
        (0.05, 0.80, "5% upfront / 20% tail"),
        (0.10, 0.80, "10% upfront / 20% tail"),
        (0.15, 0.70, "15% upfront / 30% tail"),
        (0.20, 0.60, "20% upfront / 40% tail"),
    ]
    for up_pct, aw_pct, label in scenario_defs:
        upfront_cr = up_pct * total_soc
        key = (up_pct, aw_pct, "soc")
        cell = grid.cells.get(key)
        if cell:
            total_inv = upfront_cr + total_e_legal
            e_gross = total_inv * cell.mean_moic
            e_net = e_gross - total_inv
            investor_scenarios.append({
                "label": label,
                "upfront_pct": up_pct,
                "tata_tail_pct": round(1.0 - aw_pct, 2),
                "upfront_cr": _cr(upfront_cr),
                "legal_costs_cr": _cr(total_e_legal),
                "total_investment_cr": _cr(total_inv),
                "e_gross_recovery_cr": _cr(e_gross),
                "e_net_to_fund_cr": _cr(e_net),
                "e_moic": round(cell.mean_moic, 2),
                "e_xirr": _pct(cell.mean_xirr),
                "p_loss": _pct(cell.p_loss),
                "verdict": _get_verdict(cell.mean_moic, cell.p_loss),
            })
    
    return {
        "portfolio_summary": {
            "total_soc_cr": _cr(total_soc),
            "total_eq_cr": _cr(total_eq),
            "eq_over_soc": _pct(total_eq / total_soc if total_soc > 0 else 0),
            "arb_win_prob": MI.ARB_WIN_PROBABILITY,
            "eq_given_win": _pct(eq_given_win),
            "avg_win_rate": _pct(avg_win_rate),
            "total_e_collected_cr": _cr(total_e_collected),
            "collected_over_soc": _pct(total_e_collected / total_soc if total_soc > 0 else 0),
            "total_e_legal_cr": _cr(total_e_legal),
            "total_e_net_cr": _cr(total_e_collected - total_e_legal),
            "n_paths": sim.n_paths,
        },
        "per_claim": per_claim,
        "distribution": distribution,
        "annual_timeline": annual_timeline,
        "quarterly_timeline": quarterly_timeline,
        "decomposition": decomposition,
        "investor_scenarios": investor_scenarios,
    }


def _build_scenario_comparison(
    grid: InvestmentGridResults,
    claims: list[ClaimConfig],
) -> list[dict]:
    """7-scenario comparison table with verdicts."""
    total_soc = sum(c.soc_value_cr for c in claims)

    # Canonical scenarios (Tata tail 30% = fund keeps 70%) — SOC only
    ref_aw = 0.70  # award_share_pct corresponding to 30% Tata tail
    scenarios_def = [
        ("SOC_5",  0.05, ref_aw, "soc"),
        ("SOC_10", 0.10, ref_aw, "soc"),
        ("SOC_15", 0.15, ref_aw, "soc"),
        ("SOC_20", 0.20, ref_aw, "soc"),
        ("SOC_25", 0.25, ref_aw, "soc"),
        ("SOC_30", 0.30, ref_aw, "soc"),
    ]

    # Build available scenarios
    results = []
    for defn in scenarios_def:
        if defn is None:
            continue
        label, up_pct, aw_pct, basis = defn
        key = (up_pct, aw_pct, basis)
        cell = grid.cells.get(key)
        if cell is None:
            continue

        # Compute investment amount (SOC-based)
        inv_cr = total_soc * up_pct

        results.append({
            "scenario": label,
            "basis": basis.upper(),
            "upfront_pct": up_pct,
            "tata_tail_pct": round(1.0 - aw_pct, 2),
            "award_share_pct": aw_pct,  # backward compat
            "investment_cr": _cr(inv_cr),
            "mean_moic": _pct(cell.mean_moic),
            "median_moic": _pct(cell.median_moic),
            "mean_xirr": _pct(cell.mean_xirr),
            "median_xirr": _pct(cell.median_xirr),
            "p_loss": _pct(cell.p_loss),
            "p_irr_gt_30": _pct(cell.p_irr_gt_30),
            "mean_net_return_cr": _cr(cell.mean_net_return_cr),
            "var_1": _cr(cell.var_1),
            "cvar_1": _cr(cell.cvar_1),
            "verdict": _get_verdict(cell.mean_moic, cell.p_loss),
        })

    return results


# ===================================================================
# J-Curve Percentile Data (portfolio-level cumulative cashflow bands)
# ===================================================================

def _build_jcurve_data(
    sim: SimulationResults,
    claims: list[ClaimConfig],
) -> dict:
    """Compute monthly cumulative portfolio cashflow percentile bands.

    For each MC path, build the monthly cashflow vector across ALL claims
    (upfront outflow + legal costs + collection inflow), compute the
    cumulative sum, then aggregate percentile bands across all paths.

    We pre-compute for a matrix of (upfront_pct, tata_tail_pct) combos
    so the dashboard can render any combo without re-running the sim.

    Returns dict keyed by "up{upfront}_tail{tail}" with monthly arrays of
    {month, p5, p25, median, p75, p95, label}.
    """
    from .v2_cashflow_builder import build_cashflow_simple

    MAX_MONTHS = MI.MAX_TIMELINE_MONTHS  # 96
    n_paths = sim.n_paths

    # Pre-compute scenarios: key combos for dashboard
    upfront_pcts = [0.05, 0.10, 0.15, 0.20, 0.25, 0.30]
    tata_tail_pcts = [0.10, 0.15, 0.20, 0.25, 0.30, 0.35, 0.40]

    scenarios = {}
    for up_pct in upfront_pcts:
        for tail_pct in tata_tail_pcts:
            key = f"up{int(up_pct*100)}_tail{int(tail_pct*100)}"
            # Portfolio cumulative cashflow: shape (n_paths, MAX_MONTHS)
            portfolio_cumul = np.zeros((n_paths, MAX_MONTHS))

            for cid in sim.claim_ids:
                claim_cfg = next(c for c in claims if c.claim_id == cid)
                paths = sim.results.get(cid, [])

                for path_idx in range(min(len(paths), n_paths)):
                    p = paths[path_idx]
                    legal_burn = p.monthly_legal_burn
                    if legal_burn is None or len(legal_burn) == 0:
                        continue

                    # Build monthly cashflow for this claim/path
                    cf_arr, _, _ = build_cashflow_simple(
                        claim=claim_cfg,
                        total_duration_months=p.total_duration_months,
                        quantum_received_cr=p.collected_cr,
                        monthly_legal_burn=legal_burn,
                        upfront_pct=up_pct,
                        tata_tail_pct=tail_pct,
                        pricing_basis="soc",
                        expected_quantum_cr=sim.expected_quantum_map.get(cid),
                    )

                    # Pad to MAX_MONTHS and add to portfolio
                    cf_len = min(len(cf_arr), MAX_MONTHS)
                    portfolio_cumul[path_idx, :cf_len] += cf_arr[:cf_len]

            # Compute cumulative sum per path
            for i in range(n_paths):
                portfolio_cumul[i] = np.cumsum(portfolio_cumul[i])

            # Compute percentile bands at each month
            timeline = []
            # Sample every month for first 2 years, then quarterly
            months_to_sample = list(range(0, min(24, MAX_MONTHS)))
            months_to_sample += list(range(24, MAX_MONTHS, 3))
            months_to_sample = sorted(set(m for m in months_to_sample if m < MAX_MONTHS))

            for m in months_to_sample:
                col = portfolio_cumul[:, m]
                # Generate date label
                year = 2026 + (m + 4) // 12  # START_DATE is April 2026
                month_num = ((m + 4) % 12) or 12
                month_names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                               'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
                label = f"{month_names[month_num - 1]} {year}"

                timeline.append({
                    "month": m,
                    "label": label,
                    "p5": round(float(np.percentile(col, 5)), 2),
                    "p25": round(float(np.percentile(col, 25)), 2),
                    "median": round(float(np.percentile(col, 50)), 2),
                    "p75": round(float(np.percentile(col, 75)), 2),
                    "p95": round(float(np.percentile(col, 95)), 2),
                    "mean": round(float(np.mean(col)), 2),
                })

            scenarios[key] = timeline

    # Also compute a list of available combos for the dashboard UI
    available = []
    for up_pct in upfront_pcts:
        for tail_pct in tata_tail_pcts:
            available.append({
                "upfront_pct": up_pct,
                "tata_tail_pct": tail_pct,
                "key": f"up{int(up_pct*100)}_tail{int(tail_pct*100)}",
            })

    return {
        "scenarios": scenarios,
        "available_combos": available,
        "upfront_pcts": upfront_pcts,
        "tata_tail_pcts": tata_tail_pcts,
        "default_key": "up10_tail20",
        "max_months": MAX_MONTHS,
    }


# ===================================================================
# Main Export Function
# ===================================================================

def _build_sample_cashflows(
    sim: SimulationResults,
    claims: list[ClaimConfig],
    n: int = 10,
) -> list[dict]:
    """Export n sample paths with cashflow details for verification."""
    from .v2_cashflow_builder import build_cashflow

    samples = []
    ref_upfront = 0.10
    ref_tata_tail = 0.20
    eq_map = sim.expected_quantum_map

    for i in range(min(n, sim.n_paths)):
        for cid in sim.claim_ids:
            p = sim.results[cid][i]
            claim_cfg = next(c for c in claims if c.claim_id == cid)

            # Build cashflow for a reference scenario
            legal_burn = p.monthly_legal_burn
            if legal_burn is None or len(legal_burn) == 0:
                continue

            dates, cfs, total_inv, total_ret = build_cashflow(
                claim=claim_cfg,
                total_duration_months=p.total_duration_months,
                quantum_received_cr=p.collected_cr,
                monthly_legal_burn=legal_burn,
                upfront_pct=ref_upfront,
                tata_tail_pct=ref_tata_tail,
                pricing_basis="soc",
                expected_quantum_cr=eq_map.get(cid),
            )

            # Compute MOIC
            moic = total_ret / total_inv if total_inv > 0 else 0.0

            samples.append({
                "path_idx": i,
                "claim_id": cid,
                "outcome": p.final_outcome,
                "quantum_cr": _cr(p.collected_cr),
                "timeline_months": _pct(p.total_duration_months),
                "slp_admitted": _safe(p.slp_admitted),
                "upfront_pct": ref_upfront,
                "tata_tail_pct": ref_tata_tail,
                "onetime_legal_cr": _cr(float(legal_burn[0])),
                "duration_legal_cr": _cr(float(np.sum(legal_burn[1:]))),
                "total_invested_cr": _cr(total_inv),
                "total_return_cr": _cr(total_ret),
                "moic": round(moic, 3),
                "monthly_cashflows": [round(float(c), 4) for c in cfs[:60]],
            })

        if len(samples) >= n * len(sim.claim_ids):
            break

    return samples


def _build_waterfall_data(
    sim: SimulationResults,
    claims: list[ClaimConfig],
) -> dict:
    """Compute value decomposition waterfall for portfolio.

    Returns both a NOMINAL waterfall (no time-value discounting) and a
    PV waterfall discounted at the RISK_FREE_RATE (7%).
    """
    total_soc = sum(c.soc_value_cr for c in claims)

    # Average timeline across all paths
    all_durs = []
    for cid in sim.claim_ids:
        for p in sim.results[cid]:
            all_durs.append(p.total_duration_months)
    avg_timeline = float(np.mean(all_durs))

    # Win rate
    all_outcomes = []
    for cid in sim.claim_ids:
        for p in sim.results[cid]:
            all_outcomes.append(1 if p.final_outcome == "TRUE_WIN" else 0)
    avg_win_rate = float(np.mean(all_outcomes))

    # E[Q|WIN] from MC paths (compute from actual simulation data)
    all_quanta_win = []
    for cid in sim.claim_ids:
        for p in sim.results[cid]:
            if p.final_outcome == "TRUE_WIN" and p.quantum is not None:
                all_quanta_win.append(float(p.quantum.quantum_cr))
    avg_eq_win = float(np.mean(all_quanta_win)) if all_quanta_win else 0.0
    total_eq_cr = sum(sim.expected_quantum_map.get(cid, 0.0) for cid in sim.claim_ids)
    eq_pct = total_eq_cr / total_soc if total_soc > 0 else 0.720

    # Average legal costs
    all_legal = []
    for cid in sim.claim_ids:
        claim_legal = [p.legal_cost_total_cr for p in sim.results[cid]]
        all_legal.append(float(np.mean(claim_legal)))
    avg_legal_portfolio = sum(all_legal)

    # Reference: 20% Tata tail
    ref_tata_tail = 0.20

    # ── NOMINAL waterfall (no discounting) ──
    nom_win_adj = total_soc * avg_win_rate
    nom_prob_adj = nom_win_adj * eq_pct
    nom_net_after_legal = nom_prob_adj - avg_legal_portfolio
    nom_tata_receives = nom_prob_adj * ref_tata_tail
    nom_fund_net = nom_net_after_legal * (1 - ref_tata_tail)

    nominal = {
        "soc_cr": round(total_soc, 2),
        "win_rate": round(avg_win_rate, 4),
        "eq_multiplier": round(eq_pct, 4),
        "win_adjusted_cr": round(nom_win_adj, 2),
        "prob_adjusted_cr": round(nom_prob_adj, 2),
        "legal_costs_cr": round(avg_legal_portfolio, 2),
        "net_after_legal_cr": round(nom_net_after_legal, 2),
        "reference_tail_pct": ref_tata_tail,
        "tata_receives_cr": round(nom_tata_receives, 2),
        "fund_net_profit_cr": round(nom_fund_net, 2),
    }

    # ── PV waterfall (discounted at RISK_FREE_RATE = 7%) ──
    pv_rate = MI.RISK_FREE_RATE  # 7%
    discount_factor = (1 / (1 + pv_rate)) ** (avg_timeline / 12)
    pv_soc = total_soc * discount_factor
    pv_win_adj = pv_soc * avg_win_rate
    pv_prob_adj = pv_win_adj * eq_pct
    pv_net_after_legal = pv_prob_adj - avg_legal_portfolio
    pv_tata_receives = pv_prob_adj * ref_tata_tail
    pv_fund_net = pv_net_after_legal * (1 - ref_tata_tail)

    present_value = {
        "soc_cr": round(total_soc, 2),
        "discount_rate": pv_rate,
        "avg_timeline_months": round(avg_timeline, 1),
        "pv_factor": round(discount_factor, 4),
        "pv_soc_cr": round(pv_soc, 2),
        "win_rate": round(avg_win_rate, 4),
        "eq_multiplier": round(eq_pct, 4),
        "win_adjusted_cr": round(pv_win_adj, 2),
        "prob_adjusted_cr": round(pv_prob_adj, 2),
        "legal_costs_cr": round(avg_legal_portfolio, 2),
        "net_after_legal_cr": round(pv_net_after_legal, 2),
        "reference_tail_pct": ref_tata_tail,
        "tata_receives_cr": round(pv_tata_receives, 2),
        "fund_net_profit_cr": round(pv_fund_net, 2),
    }

    # Backward-compat top-level fields (PV at 7% as default view)
    return {
        "nominal": nominal,
        "present_value": present_value,
        "soc_cr": round(total_soc, 2),
        "pv_factor": round(discount_factor, 4),
        "pv_soc_cr": round(pv_soc, 2),
        "win_rate": round(avg_win_rate, 4),
        "eq_multiplier": round(eq_pct, 4),
        "prob_adjusted_cr": round(pv_prob_adj, 2),
        "legal_costs_cr": round(avg_legal_portfolio, 2),
        "net_after_legal_cr": round(pv_net_after_legal, 2),
        "reference_tail_pct": ref_tata_tail,
        "tata_receives_cr": round(pv_tata_receives, 2),
        "fund_net_profit_cr": round(pv_fund_net, 2),
    }


def export_dashboard_json(
    sim: SimulationResults,
    claims: list[ClaimConfig],
    grid: InvestmentGridResults,
    stochastic_results: dict | None = None,
    prob_sensitivity: dict | None = None,
    output_dir: str | None = None,
    ctx=None,
) -> str:
    """Export all dashboard data to JSON.

    Parameters
    ----------
    sim : SimulationResults
    claims : list[ClaimConfig]
    grid : InvestmentGridResults
    stochastic_results : dict, optional
        Pre-computed stochastic grid data (from export_stochastic_grid).
    output_dir : str, optional
        Output directory. Default: MI.REPORT_OUTPUT_DIR.
    ctx : PortfolioContext, optional
        If provided, uses ctx for output dir and metadata.

    Returns
    -------
    str: path to written JSON file.
    """
    if output_dir is None:
        output_dir = ctx.output_dir if ctx else MI.REPORT_OUTPUT_DIR

    os.makedirs(output_dir, exist_ok=True)

    # Key scenarios for per-claim grid — ALL upfront × tail combinations
    # so the dashboard can render cross-claim comparisons at any combo
    key_scenarios = []
    for basis in grid.pricing_bases:
        for up_pct in grid.upfront_pcts:
            for aw_pct in grid.award_share_pcts:
                key_scenarios.append((up_pct, aw_pct, basis))

    print("  Building J-curve percentile data...")
    jcurve_data = _build_jcurve_data(sim, claims)
    print(f"  J-curve: {len(jcurve_data['scenarios'])} scenario combos computed")

    data = {
        "party_names": {
            "claimant": getattr(MI, 'CLAIMANT_NAME', 'Claimant') or 'Claimant',
            "respondent": getattr(MI, 'RESPONDENT_NAME', 'Respondent') or 'Respondent',
        },
        "perspective": getattr(MI, 'PERSPECTIVE', 'claimant') or 'claimant',
        "claims": _build_claims_section(sim, claims),
        "probability_summary": _build_probability_summary(),
        "quantum_summary": _build_quantum_summary(sim, claims),
        "timeline_summary": _build_timeline_summary(sim, claims),
        "legal_cost_summary": _build_legal_cost_summary(sim, claims),
        "investment_grid_soc": _build_investment_grid(grid, "soc") if "soc" in grid.pricing_bases else [],
        "investment_grid_eq": _build_investment_grid(grid, "eq") if "eq" in grid.pricing_bases else [],
        "per_claim_grid": _build_per_claim_grid(grid, claims, key_scenarios),
        "breakeven_data": _build_breakeven_data(grid, claims),
        "scenario_comparison": _build_scenario_comparison(grid, claims),
        "sample_cashflows": _build_sample_cashflows(sim, claims, n=10),
        "waterfall": _build_waterfall_data(sim, claims),
        "cashflow_analysis": _build_cashflow_analysis(sim, claims, grid),
        "jcurve_data": jcurve_data,
        "simulation_meta": {
            "n_paths": sim.n_paths,
            "seed": sim.seed,
            "n_claims": len(claims),
            "total_soc_cr": _cr(sum(c.soc_value_cr for c in claims)),
            "pricing_bases": grid.pricing_bases,
            "upfront_pcts": grid.upfront_pcts,
            "tata_tail_pcts": [round(1.0 - a, 2) for a in grid.award_share_pcts],
            "award_share_pcts": grid.award_share_pcts,  # backward compat
            "arb_win_probability": MI.ARB_WIN_PROBABILITY,
            "max_timeline_months": MI.MAX_TIMELINE_MONTHS,
            "discount_rate": MI.DISCOUNT_RATE,
            "risk_free_rate": MI.RISK_FREE_RATE,
            "start_date": MI.START_DATE,
            "generated_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "portfolio_mode": ctx.mode if ctx else "all",
            "portfolio_label": ctx.label if ctx else "Full Portfolio (6 claims)",
            "jurisdiction_mix": ctx.jurisdiction_mix if ctx else {"domestic": 3, "siac": 3},
            "interest_enabled": MI.INTEREST_ENABLED,
            "interest_rate_domestic": MI.INTEREST_RATE_DOMESTIC,
            "interest_rate_siac": MI.INTEREST_RATE_SIAC,
            "interest_type_domestic": MI.INTEREST_TYPE_DOMESTIC,
            "interest_type_siac": MI.INTEREST_TYPE_SIAC,
            "interest_rate_bands_domestic": MI.INTEREST_RATE_BANDS_DOMESTIC,
            "interest_rate_bands_siac": MI.INTEREST_RATE_BANDS_SIAC,
            "interest_start_basis": MI.INTEREST_START_BASIS,
        },
    }

    # Add settlement analytics
    # Check if any path actually has settlement data (MI may have been restored
    # to defaults by save_and_restore_mi before the exporter runs)
    _any_settlement = any(
        p.settlement is not None and p.settlement.settled
        for cid_paths in sim.results.values()
        for p in cid_paths
    )
    if _any_settlement or getattr(MI, 'SETTLEMENT_ENABLED', False):
        data["settlement"] = _build_settlement_summary(sim, claims)
    else:
        data["settlement"] = {"enabled": False}

    # Add stochastic pricing grid if available
    if stochastic_results is not None:
        data["stochastic_pricing"] = stochastic_results

    # Add probability sensitivity analysis if available
    if prob_sensitivity is not None:
        data["probability_sensitivity"] = prob_sensitivity

    out_path = os.path.join(output_dir, "dashboard_data.json")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, default=_safe)

    print(f"  Dashboard JSON exported → {out_path}")
    size_kb = os.path.getsize(out_path) / 1024
    print(f"  Size: {size_kb:.1f} KB")

    return out_path
