"""
engine/export/json_exporter.py — Build dashboard-ready JSON from simulation results.
=====================================================================================

OUTPUT JSON SCHEMA (dashboard_data.json):
=========================================

{
  "claims": [                       # Per-claim metadata + MC statistics
    {
      "claim_id": str,
      "name": str,
      "jurisdiction": str,
      "claim_type": str,
      "soc_value_cr": float,
      "win_rate": float,
      "effective_win_rate": float,
      "mean_quantum_cr": float,
      "mean_duration_months": float,
      "mean_collected_cr": float,
      "mean_legal_costs_cr": float,
      "outcome_distribution": {"TRUE_WIN": int, "RESTART": int, "LOSE": int},
      "duration_stats": {p5, p25, p50, p75, p95},
      "legal_cost_stats": {mean, median, p5, p95},
      "collected_stats": {mean, median, p5, p95},
    }, ...
  ],

  "simulation_meta": {              # Run configuration
    "n_paths": int,
    "seed": int,
    "n_claims": int,
    "total_soc_cr": float,
    "structure_type": str,
    "start_date": str,
    "discount_rate": float,
    "generated_at": str,
  },

  "structure_type": str,            # For dashboard tab routing

  "probability_summary": {          # Per-claim tree probabilities
    "<claim_id>": {
      "scenario_a": {p_true_win, p_lose, terminal_paths: [...]},
      "scenario_b": {p_restart, p_lose, terminal_paths: [...]},
      "aggregate": {p_true_win, p_restart, p_lose},
    }, ...
  },

  "quantum_summary": {              # Band distribution + per-claim expected quantum
    "bands": [{low, high, probability, midpoint}, ...],
    "expected_quantum_pct": float,
    "per_claim": {<claim_id>: {soc_cr, eq_cr, eq_pct}, ...},
  },

  "investment_grid" | "waterfall_grid": {   # Grid cells with metrics
    "<key>": {mean_moic, median_moic, mean_xirr, p_loss, p_hurdle, var_1, cvar_1, per_claim},
    ...
  },

  "breakeven_data": [{tail_pct, max_upfront_pct}, ...],

  "waterfall": {                    # Nominal and PV value decomposition
    "nominal": {soc_cr, win_rate, eq_pct, ...},
    "present_value": {soc_cr, pv_factor, ...},
  },

  "cashflow_analysis": {            # Portfolio summary, per-claim, timeline
    "portfolio_summary": {...},
    "per_claim": [{claim_id, soc_cr, eq_cr, win_rate, e_collected_cr, ...}, ...],
    "annual_timeline": [{year, pct_resolving, e_recovery_cr, ...}, ...],
    "distribution": {p1: {gross_cr, legal_cr, net_cr}, ...},
  },

  "jcurve_data": {                  # Fan chart data by month
    "scenarios": {"up10_tail20": [{month, p5, p25, median, p75, p95}, ...]},
    "available_combos": [...],
    "default_key": str,
  },

  "timeline_summary": {             # Per-claim duration stats
    "per_claim": {<claim_id>: {mean, median, p5, p25, p75, p95}, ...},
  },

  "legal_cost_summary": {           # Per-claim cost stats
    "portfolio_mean_total_cr": float,
    "per_claim": {<claim_id>: {mean_total_cr, median_total_cr, p5, p95}, ...},
  },

  "sensitivity": [...],             # Arb win sensitivity curves

  "risk": {                         # All risk metrics
    "moic_distribution": {p1, p5, ..., p99},
    "irr_distribution": {p1, p5, ..., p99},
    "duration_distribution": {...},
    "capital_at_risk_timeline": [...],
    "concentration": {...},
    "stress_scenarios": [...],
  },
}
"""

from __future__ import annotations

import json
import os
from datetime import datetime
from typing import Any

import numpy as np

from engine.config.schema import (
    ClaimConfig,
    GridCellMetrics,
    PathResult,
    PortfolioStructure,
    SimulationConfig,
)
from engine.models.probability_tree import compute_tree_probabilities
from engine.simulation.cashflow_builder import (
    build_upfront_tail_cashflow,
    merge_dated_cashflows,
)


# ===================================================================
# Utility
# ===================================================================

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
    return round(float(v), 6)


def _cr(v: float) -> float:
    return round(float(v), 2)


# ===================================================================
# Section builders
# ===================================================================

def _build_claims_section(
    claims: list[ClaimConfig],
    all_path_results: dict[str, list[PathResult]],
    claim_summaries: dict[str, dict],
) -> list[dict]:
    """Per-claim config + MC stats."""
    out = []
    for c in claims:
        cid = c.id
        summary = claim_summaries.get(cid, {})
        paths = all_path_results.get(cid, [])
        n = len(paths)

        outcomes = {"TRUE_WIN": 0, "RESTART": 0, "LOSE": 0}
        durations = []
        legal_costs = []
        collected_vals = []

        for p in paths:
            outcomes[p.outcome] = outcomes.get(p.outcome, 0) + 1
            durations.append(float(p.timeline_months))
            legal_costs.append(float(p.legal_costs_cr))
            collected_vals.append(float(p.collected_cr))

        dur_arr = np.array(durations) if durations else np.array([0.0])
        lc_arr = np.array(legal_costs) if legal_costs else np.array([0.0])
        col_arr = np.array(collected_vals) if collected_vals else np.array([0.0])

        out.append({
            "claim_id": cid,
            "name": c.name,
            "jurisdiction": c.jurisdiction,
            "claim_type": c.claim_type,
            "soc_value_cr": _cr(c.soc_value_cr),
            "currency": c.currency,
            "current_stage": c.current_stage,
            "win_rate": _pct(summary.get("win_rate", 0.0)),
            "effective_win_rate": _pct(summary.get("effective_win_rate", 0.0)),
            "mean_quantum_cr": _cr(summary.get("mean_quantum_cr", 0.0)),
            "mean_duration_months": _pct(summary.get("mean_duration_months", 0.0)),
            "mean_collected_cr": _cr(summary.get("mean_collected_cr", 0.0)),
            "mean_legal_costs_cr": _cr(summary.get("mean_legal_costs_cr", 0.0)),
            "outcome_distribution": outcomes,
            "duration_stats": {
                "mean": _pct(float(np.mean(dur_arr))),
                "median": _pct(float(np.median(dur_arr))),
                "p5": _pct(float(np.percentile(dur_arr, 5))),
                "p25": _pct(float(np.percentile(dur_arr, 25))),
                "p75": _pct(float(np.percentile(dur_arr, 75))),
                "p95": _pct(float(np.percentile(dur_arr, 95))),
            },
            "legal_cost_stats": {
                "mean": _cr(float(np.mean(lc_arr))),
                "median": _cr(float(np.median(lc_arr))),
                "p5": _cr(float(np.percentile(lc_arr, 5))),
                "p95": _cr(float(np.percentile(lc_arr, 95))),
            },
            "collected_stats": {
                "mean": _cr(float(np.mean(col_arr))),
                "median": _cr(float(np.median(col_arr))),
                "p5": _cr(float(np.percentile(col_arr, 5))),
                "p95": _cr(float(np.percentile(col_arr, 95))),
            },
        })
    return out


def _build_probability_summary(
    claims: list[ClaimConfig],
) -> dict:
    """Per-claim tree probabilities using analytical computation."""
    summary: dict[str, dict] = {}
    for c in claims:
        tree_a = c.challenge_tree.scenario_a
        tree_b = c.challenge_tree.scenario_b

        probs_a = compute_tree_probabilities(tree_a)
        probs_b = compute_tree_probabilities(tree_b)

        arb_win = c.arbitration.win_probability
        arb_lose = 1.0 - arb_win

        agg_tw = probs_a.p_true_win * arb_win
        agg_rs = probs_b.p_restart * arb_lose
        agg_lo = probs_a.p_lose * arb_win + probs_b.p_lose * arb_lose

        summary[c.id] = {
            "arb_win_probability": arb_win,
            "scenario_a": {
                "p_true_win": _pct(probs_a.p_true_win),
                "p_lose": _pct(probs_a.p_lose),
                "terminal_paths": probs_a.terminal_paths,
            },
            "scenario_b": {
                "p_restart": _pct(probs_b.p_restart),
                "p_lose": _pct(probs_b.p_lose),
                "terminal_paths": probs_b.terminal_paths,
            },
            "aggregate": {
                "p_true_win": _pct(agg_tw),
                "p_restart": _pct(agg_rs),
                "p_lose": _pct(agg_lo),
            },
        }
    return summary


def _build_quantum_summary(
    claims: list[ClaimConfig],
    all_path_results: dict[str, list[PathResult]],
) -> dict:
    """Quantum band definitions + per-claim quantum stats."""
    # Use first claim's bands as reference (all claims share same bands in TATA)
    ref = claims[0]
    bands = []
    for i, b in enumerate(ref.quantum.bands):
        bands.append({
            "band_idx": i,
            "low": b.low,
            "high": b.high,
            "probability": b.probability,
            "midpoint": (b.low + b.high) / 2.0,
        })

    eq_pct = ref.quantum.expected_quantum_pct

    per_claim = {}
    for c in claims:
        paths = all_path_results.get(c.id, [])
        win_quanta = [r.quantum_cr for r in paths if r.outcome == "TRUE_WIN" and r.quantum_cr > 0]
        eq_cr = float(np.mean(win_quanta)) if win_quanta else c.soc_value_cr * eq_pct
        per_claim[c.id] = {
            "claim_id": c.id,
            "name": c.name,
            "soc_cr": _cr(c.soc_value_cr),
            "eq_cr": _cr(eq_cr),
            "eq_pct": _pct(c.quantum.expected_quantum_pct),
        }

    return {
        "bands": bands,
        "expected_quantum_pct": _pct(eq_pct),
        "per_claim": per_claim,
    }


def _build_timeline_summary(
    claims: list[ClaimConfig],
    all_path_results: dict[str, list[PathResult]],
) -> dict:
    """Per-claim timeline stats."""
    per_claim = {}
    for c in claims:
        paths = all_path_results.get(c.id, [])
        durs = np.array([r.timeline_months for r in paths]) if paths else np.array([0.0])
        per_claim[c.id] = {
            "claim_id": c.id,
            "name": c.name,
            "mean": _pct(float(np.mean(durs))),
            "median": _pct(float(np.median(durs))),
            "p5": _pct(float(np.percentile(durs, 5))),
            "p25": _pct(float(np.percentile(durs, 25))),
            "p75": _pct(float(np.percentile(durs, 75))),
            "p95": _pct(float(np.percentile(durs, 95))),
        }
    return {"per_claim": per_claim}


def _build_legal_cost_summary(
    claims: list[ClaimConfig],
    all_path_results: dict[str, list[PathResult]],
) -> dict:
    """Legal cost stats from MC."""
    per_claim = {}
    total_mean = 0.0
    for c in claims:
        paths = all_path_results.get(c.id, [])
        costs = np.array([r.legal_costs_cr for r in paths]) if paths else np.array([0.0])
        mean_lc = float(np.mean(costs))
        total_mean += mean_lc
        per_claim[c.id] = {
            "claim_id": c.id,
            "name": c.name,
            "mean_total_cr": _cr(mean_lc),
            "median_total_cr": _cr(float(np.median(costs))),
            "p5": _cr(float(np.percentile(costs, 5))),
            "p95": _cr(float(np.percentile(costs, 95))),
            "pct_of_soc": _pct(mean_lc / c.soc_value_cr) if c.soc_value_cr > 0 else 0.0,
        }
    return {
        "portfolio_mean_total_cr": _cr(total_mean),
        "per_claim": per_claim,
    }


def _build_grid_section(
    grid_results: dict[str, GridCellMetrics],
) -> dict:
    """Flatten grid results for JSON."""
    out = {}
    for key, cell in grid_results.items():
        per_claim = {}
        for cid, claim_data in cell.per_claim.items():
            payload = {k: _safe(v) for k, v in claim_data.items()}
            payload.setdefault("claim_id", cid)
            payload.setdefault("name", cid)
            per_claim[cid] = payload

        out[key] = {
            "mean_moic": _pct(cell.mean_moic),
            "median_moic": _pct(cell.median_moic),
            "mean_xirr": _pct(cell.mean_xirr),
            "expected_xirr": _pct(getattr(cell, "expected_xirr", cell.mean_xirr)),
            "p_loss": _pct(cell.p_loss),
            "p_hurdle": _pct(cell.p_hurdle),
            "var_1": _pct(cell.var_1),
            "cvar_1": _pct(cell.cvar_1),
            "per_claim": per_claim,
        }
    return out


def _build_waterfall_data(
    claims: list[ClaimConfig],
    all_path_results: dict[str, list[PathResult]],
    simulation_config: SimulationConfig,
) -> dict:
    """Compute value decomposition waterfall."""
    total_soc = sum(c.soc_value_cr for c in claims)
    n_paths = len(all_path_results.get(claims[0].id, []))

    # Aggregate across all paths
    total_collected_per_path = np.zeros(n_paths)
    total_legal_per_path = np.zeros(n_paths)

    for c in claims:
        paths = all_path_results.get(c.id, [])
        for i, p in enumerate(paths):
            if i < n_paths:
                total_collected_per_path[i] += p.collected_cr
                total_legal_per_path[i] += p.legal_costs_cr

    avg_collected = float(np.mean(total_collected_per_path))
    avg_legal = float(np.mean(total_legal_per_path))

    all_outcomes = []
    for c in claims:
        for p in all_path_results.get(c.id, []):
            all_outcomes.append(1 if p.outcome == "TRUE_WIN" else 0)
    avg_win_rate = float(np.mean(all_outcomes))

    # Average timeline
    all_durs = []
    for c in claims:
        for p in all_path_results.get(c.id, []):
            all_durs.append(p.timeline_months)
    avg_dur = float(np.mean(all_durs))

    # PV
    pv_rate = simulation_config.risk_free_rate
    discount_factor = (1.0 / (1.0 + pv_rate)) ** (avg_dur / 12.0)

    nominal = {
        "soc_cr": _cr(total_soc),
        "win_rate": round(avg_win_rate, 4),
        "e_collected_cr": _cr(avg_collected),
        "legal_costs_cr": _cr(avg_legal),
        "net_after_legal_cr": _cr(avg_collected - avg_legal),
    }

    present_value = {
        "soc_cr": _cr(total_soc),
        "discount_rate": pv_rate,
        "avg_timeline_months": round(avg_dur, 1),
        "pv_factor": round(discount_factor, 4),
        "pv_soc_cr": _cr(total_soc * discount_factor),
        "e_collected_cr": _cr(avg_collected),
        "legal_costs_cr": _cr(avg_legal),
        "net_after_legal_cr": _cr(avg_collected - avg_legal),
    }

    return {"nominal": nominal, "present_value": present_value}


def _build_cashflow_analysis(
    claims: list[ClaimConfig],
    all_path_results: dict[str, list[PathResult]],
    simulation_config: SimulationConfig,
) -> dict:
    """Comprehensive cashflow analysis."""
    total_soc = sum(c.soc_value_cr for c in claims)
    n_paths = len(all_path_results.get(claims[0].id, []))

    # Per-claim stats
    per_claim = []
    for c in claims:
        paths = all_path_results.get(c.id, [])
        if not paths:
            continue
        collected = np.array([p.collected_cr for p in paths])
        legal = np.array([p.legal_costs_cr for p in paths])
        durs = np.array([p.timeline_months for p in paths])
        wins = np.array([1 if p.outcome == "TRUE_WIN" else 0 for p in paths])
        net = collected - legal

        # E[Q] for this claim
        win_q = [p.quantum_cr for p in paths if p.outcome == "TRUE_WIN" and p.quantum_cr > 0]
        eq_cr = float(np.mean(win_q)) if win_q else c.soc_value_cr * c.quantum.expected_quantum_pct

        per_claim.append({
            "claim_id": c.id,
            "name": c.name,
            "soc_cr": _cr(c.soc_value_cr),
            "jurisdiction": c.jurisdiction,
            "eq_cr": _cr(eq_cr),
            "win_rate": _pct(float(np.mean(wins))),
            "e_collected_cr": _cr(float(np.mean(collected))),
            "p50_collected_cr": _cr(float(np.median(collected))),
            "e_legal_cr": _cr(float(np.mean(legal))),
            "e_net_cr": _cr(float(np.mean(net))),
            "e_duration_months": round(float(np.mean(durs)), 1),
        })

    # Portfolio distribution
    portfolio_collected = np.zeros(n_paths)
    portfolio_legal = np.zeros(n_paths)
    for c in claims:
        paths = all_path_results.get(c.id, [])
        for i, p in enumerate(paths):
            if i < n_paths:
                portfolio_collected[i] += p.collected_cr
                portfolio_legal[i] += p.legal_costs_cr
    portfolio_net = portfolio_collected - portfolio_legal

    distribution = {}
    for pctl in [1, 5, 10, 25, 50, 75, 90, 95, 99]:
        distribution[f"p{pctl}"] = {
            "gross_cr": _cr(float(np.percentile(portfolio_collected, pctl))),
            "legal_cr": _cr(float(np.percentile(portfolio_legal, pctl))),
            "net_cr": _cr(float(np.percentile(portfolio_net, pctl))),
        }
    distribution["mean"] = {
        "gross_cr": _cr(float(np.mean(portfolio_collected))),
        "legal_cr": _cr(float(np.mean(portfolio_legal))),
        "net_cr": _cr(float(np.mean(portfolio_net))),
    }

    # Annual timeline
    all_durs = []
    all_collected_arr = []
    for c in claims:
        for p in all_path_results.get(c.id, []):
            all_durs.append(p.timeline_months)
            all_collected_arr.append(p.collected_cr)
    dur_arr = np.array(all_durs)
    col_arr = np.array(all_collected_arr)
    n_total = len(dur_arr)
    n_claims = len(claims)

    annual_timeline = []
    cumul = 0.0
    for year in range(1, 9):
        m_start = (year - 1) * 12
        m_end = year * 12
        mask = (dur_arr > m_start) & (dur_arr <= m_end)
        pct_this = float(np.mean(mask))
        recovery = float(np.sum(col_arr[mask])) / max(n_total / n_claims, 1)
        cumul += recovery
        annual_timeline.append({
            "year": year,
            "pct_resolving": _pct(pct_this),
            "e_recovery_cr": _cr(recovery),
            "cumul_recovery_cr": _cr(cumul),
        })

    total_eq = sum(d["eq_cr"] for d in per_claim)
    return {
        "portfolio_summary": {
            "total_soc_cr": _cr(total_soc),
            "total_eq_cr": _cr(total_eq),
            "total_e_collected_cr": _cr(float(np.mean(portfolio_collected))),
            "total_e_legal_cr": _cr(float(np.mean(portfolio_legal))),
            "total_e_net_cr": _cr(float(np.mean(portfolio_net))),
            "n_paths": n_paths,
        },
        "per_claim": per_claim,
        "distribution": distribution,
        "annual_timeline": annual_timeline,
    }


def _build_jcurve_data(
    claims: list[ClaimConfig],
    all_path_results: dict[str, list[PathResult]],
    simulation_config: SimulationConfig,
    portfolio_config: Any | None = None,
) -> dict:
    """Compute monthly cumulative portfolio cashflow percentile bands."""
    max_from_claims = max(
        int(getattr(getattr(c, "timeline", None), "max_horizon_months", 0) or 0)
        for c in claims
    )
    max_from_paths = 0
    for paths in all_path_results.values():
        for p in paths:
            max_from_paths = max(max_from_paths, int(getattr(p, "timeline_months", 0) or 0))

    max_months = max(max_from_claims, max_from_paths)
    if max_months <= 0:
        max_months = 96

    n_paths = len(all_path_results.get(claims[0].id, []))
    start_date = simulation_config.start_date

    cfg = portfolio_config.model_dump() if hasattr(portfolio_config, "model_dump") else (portfolio_config or {})
    params = ((cfg.get("structure") or {}).get("params") or {}) if isinstance(cfg, dict) else {}

    def _num(v, fallback):
        try:
            return float(v)
        except (TypeError, ValueError):
            return fallback

    user_upfront = _num(params.get("upfront_pct"), 0.10)
    user_tail = _num(params.get("tail_pct"), 0.20)
    upfront_range = params.get("upfront_range") or {}
    tail_range = params.get("tail_range") or {}
    if isinstance(upfront_range, dict):
        user_upfront = _num(upfront_range.get("min"), user_upfront)
    if isinstance(tail_range, dict):
        user_tail = _num(tail_range.get("min"), user_tail)

    user_upfront = max(0.0, min(1.0, user_upfront))
    user_tail = max(0.0, min(1.0, user_tail))

    legal_upfront_split = _num(
        params.get("legal_cost_upfront_split", params.get("legal_cost_t0_split", 0.30)),
        0.30,
    )
    legal_upfront_split = max(0.0, min(1.0, legal_upfront_split))
    legal_burn_split = 1.0 - legal_upfront_split

    upfront_pcts = [0.05, 0.10, 0.15, 0.20, 0.25, 0.30]
    tail_pcts = [0.10, 0.15, 0.20, 0.25, 0.30, 0.35, 0.40]
    if user_upfront not in upfront_pcts:
        upfront_pcts.append(user_upfront)
        upfront_pcts = sorted(set(upfront_pcts))
    if user_tail not in tail_pcts:
        tail_pcts.append(user_tail)
        tail_pcts = sorted(set(tail_pcts))

    scenarios: dict[str, list[dict]] = {}

    for up_pct in upfront_pcts:
        for tail_pct in tail_pcts:
            key = f"up{int(up_pct*100)}_tail{int(tail_pct*100)}"
            portfolio_cumul = np.zeros((n_paths, max_months))

            for claim in claims:
                paths = all_path_results.get(claim.id, [])
                for path_i in range(min(len(paths), n_paths)):
                    pr = paths[path_i]
                    dur = max(int(pr.timeline_months), 1)
                    dur = min(dur, max_months)

                    # Quick inline cashflow approximation for j-curve
                    if up_pct > 0:
                        upfront_cr = up_pct * claim.soc_value_cr
                    else:
                        upfront_cr = 0.0

                    legal_per_m = pr.legal_costs_cr / dur if dur > 0 else 0.0
                    fund_share = 1.0 - tail_pct
                    ret = fund_share * pr.collected_cr if pr.outcome == "TRUE_WIN" else 0.0

                    # Month 0: outflow
                    portfolio_cumul[path_i, 0] -= upfront_cr + (
                        pr.legal_costs_cr * legal_upfront_split / max(len(claims), 1)
                    )

                    # Months 1..dur-1: legal burn
                    for m in range(1, min(dur, max_months)):
                        portfolio_cumul[path_i, m] -= legal_per_m * legal_burn_split / max(len(claims), 1)

                    # Month dur: return
                    if dur < max_months:
                        portfolio_cumul[path_i, min(dur, max_months - 1)] += ret

            # Cumulative sum
            for i in range(n_paths):
                portfolio_cumul[i] = np.cumsum(portfolio_cumul[i])

            # Sample percentiles
            timeline = []
            months_to_sample = list(range(0, min(24, max_months))) + list(range(24, max_months, 3))
            months_to_sample = sorted(set(m for m in months_to_sample if m < max_months))

            for m in months_to_sample:
                col = portfolio_cumul[:, m]
                timeline.append({
                    "month": m,
                    "p5": round(float(np.percentile(col, 5)), 2),
                    "p25": round(float(np.percentile(col, 25)), 2),
                    "median": round(float(np.percentile(col, 50)), 2),
                    "p75": round(float(np.percentile(col, 75)), 2),
                    "p95": round(float(np.percentile(col, 95)), 2),
                })

            scenarios[key] = timeline

    available = [
        {"upfront_pct": up, "tail_pct": tail, "key": f"up{int(up*100)}_tail{int(tail*100)}"}
        for up in upfront_pcts for tail in tail_pcts
    ]

    return {
        "scenarios": scenarios,
        "available_combos": available,
        "default_key": f"up{int(round(user_upfront*100))}_tail{int(round(user_tail*100))}",
        "max_months": max_months,
    }


# ===================================================================
# Main export function
# ===================================================================

def export_dashboard_json(
    claims: list[ClaimConfig],
    all_path_results: dict[str, list[PathResult]],
    claim_summaries: dict[str, dict],
    grid_results: dict[str, GridCellMetrics],
    portfolio_config: Any,
    risk_metrics: dict,
    sensitivity_results: list[dict],
    output_path: str,
    simulation_config: SimulationConfig | None = None,
    structure_type: str = "monetisation_upfront_tail",
    breakeven_data: list[dict] | None = None,
) -> None:
    """Export all dashboard data to a single JSON file.

    Parameters
    ----------
    claims : list[ClaimConfig]
    all_path_results : dict  {claim_id: [PathResult]}
    claim_summaries : dict  {claim_id: summary_dict}
    grid_results : dict  {key: GridCellMetrics}
    portfolio_config : PortfolioConfig or dict
    risk_metrics : dict  Output of compute_portfolio_risk()
    sensitivity_results : list  Output of compute_arb_win_sensitivity()
    output_path : str  Path to write the JSON file
    simulation_config : SimulationConfig, optional
    structure_type : str
    breakeven_data : list, optional
    """
    if simulation_config is None:
        simulation_config = SimulationConfig()

    n_paths = simulation_config.n_paths
    total_soc = sum(c.soc_value_cr for c in claims)

    # Build all sections
    print("  Building claims section...")
    claims_section = _build_claims_section(claims, all_path_results, claim_summaries)

    print("  Building probability summary...")
    prob_summary = _build_probability_summary(claims)

    print("  Building quantum summary...")
    quantum_summary = _build_quantum_summary(claims, all_path_results)

    print("  Building timeline summary...")
    timeline_summary = _build_timeline_summary(claims, all_path_results)

    print("  Building legal cost summary...")
    legal_cost_summary = _build_legal_cost_summary(claims, all_path_results)

    print("  Building grid section...")
    grid_section = _build_grid_section(grid_results)

    print("  Building waterfall data...")
    waterfall = _build_waterfall_data(claims, all_path_results, simulation_config)

    print("  Building cashflow analysis...")
    cashflow_analysis = _build_cashflow_analysis(claims, all_path_results, simulation_config)

    print("  Building J-curve data...")
    jcurve = _build_jcurve_data(
        claims,
        all_path_results,
        simulation_config,
        portfolio_config=portfolio_config,
    )
    print(f"  J-curve: {len(jcurve['scenarios'])} scenario combos computed")

    # Normalize risk payload to a stable schema for dashboard consumers.
    risk_payload = risk_metrics or {}
    concentration = (risk_payload.get("concentration") or {}) if isinstance(risk_payload, dict) else {}
    normalized_concentration = {
        "herfindahl_by_jurisdiction": _pct(concentration.get("herfindahl_by_jurisdiction", 0.0)),
        "herfindahl_by_type": _pct(concentration.get("herfindahl_by_type", 0.0)),
        "jurisdiction_breakdown": concentration.get("jurisdiction_breakdown", {}) or {},
        "type_breakdown": concentration.get("type_breakdown", {}) or {},
    }
    if "mean_p_loss" in concentration:
        normalized_concentration["mean_p_loss"] = _pct(concentration.get("mean_p_loss", 0.0))

    normalized_risk = dict(risk_payload) if isinstance(risk_payload, dict) else {}
    normalized_risk["concentration"] = normalized_concentration

    # Determine grid key name based on structure type
    grid_key = "investment_grid" if "monetisation" in structure_type else "waterfall_grid"

    data = {
        "claims": claims_section,
        "simulation_meta": {
            "n_paths": n_paths,
            "seed": simulation_config.seed,
            "n_claims": len(claims),
            "total_soc_cr": _cr(total_soc),
            "structure_type": structure_type,
            "start_date": simulation_config.start_date,
            "discount_rate": simulation_config.discount_rate,
            "risk_free_rate": simulation_config.risk_free_rate,
            "generated_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        },
        "structure_type": structure_type,
        "probability_summary": prob_summary,
        "quantum_summary": quantum_summary,
        grid_key: grid_section,
        "breakeven_data": breakeven_data or [],
        "waterfall": waterfall,
        "cashflow_analysis": cashflow_analysis,
        "jcurve_data": jcurve,
        "timeline_summary": timeline_summary,
        "legal_cost_summary": legal_cost_summary,
        "sensitivity": sensitivity_results,
        "risk": normalized_risk,
    }

    os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, default=_safe)

    size_kb = os.path.getsize(output_path) / 1024
    print(f"  Dashboard JSON exported -> {output_path} ({size_kb:.1f} KB)")
