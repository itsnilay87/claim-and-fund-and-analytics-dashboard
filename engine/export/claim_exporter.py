"""
engine/export/claim_exporter.py — Single-claim JSON export (no investment grid).
=================================================================================

Exports claim_results.json with:
  - Claim metadata
  - Path results summary (outcome distribution, quantum, timeline, costs)
  - Tree probability analysis (scenario A & B)
  - Quantum distribution (per-band frequencies)
  - Timeline distribution (stage-by-stage)
  - Legal cost distribution (histogram + stage breakdown)
  - Sensitivity curves (arb win prob reweighting)
"""

from __future__ import annotations

import json
import os
from collections import Counter
from dataclasses import asdict, is_dataclass
from datetime import datetime
from typing import Any

import numpy as np

from engine.config.schema import ClaimConfig, PathResult, SimulationConfig
from engine.models.probability_tree import compute_tree_probabilities


def _safe(v: Any) -> Any:
    if isinstance(v, (np.integer,)):
        return int(v)
    if isinstance(v, (np.floating,)):
        return float(v)
    if isinstance(v, np.ndarray):
        return v.tolist()
    if isinstance(v, (np.bool_,)):
        return bool(v)
    if is_dataclass(v) and not isinstance(v, type):
        return asdict(v)
    return v


def _pct(v: float) -> float:
    return round(float(v), 6)


def _cr(v: float) -> float:
    return round(float(v), 2)


def _percentiles(arr: np.ndarray) -> dict:
    """Compute standard distribution percentiles (p5 through p95)."""
    if len(arr) == 0:
        return {}
    return {
        "p5": _pct(np.percentile(arr, 5)),
        "p10": _pct(np.percentile(arr, 10)),
        "p25": _pct(np.percentile(arr, 25)),
        "p50": _pct(np.percentile(arr, 50)),
        "p75": _pct(np.percentile(arr, 75)),
        "p90": _pct(np.percentile(arr, 90)),
        "p95": _pct(np.percentile(arr, 95)),
    }


def _build_histogram(values: np.ndarray, n_bins: int = 30) -> list[dict]:
    """Build histogram bins from an array of values.

    Returns list of {bin_start, bin_end, count} dicts.
    """
    if len(values) == 0:
        return []
    hist, edges = np.histogram(values, bins=n_bins)
    return [
        {"bin_start": _cr(edges[i]), "bin_end": _cr(edges[i + 1]), "count": int(hist[i])}
        for i in range(len(hist))
    ]


def _build_outcome_distribution(path_results: list[PathResult]) -> dict:
    """Compute outcome counts and percentages (TRUE_WIN, RESTART, LOSE)."""
    counts = Counter(r.outcome for r in path_results)
    n = len(path_results)
    return {
        "TRUE_WIN": {"count": counts.get("TRUE_WIN", 0), "pct": _pct(counts.get("TRUE_WIN", 0) / n)},
        "RESTART": {"count": counts.get("RESTART", 0), "pct": _pct(counts.get("RESTART", 0) / n)},
        "LOSE": {"count": counts.get("LOSE", 0), "pct": _pct(counts.get("LOSE", 0) / n)},
    }


def _build_quantum_distribution(claim: ClaimConfig, path_results: list[PathResult]) -> dict:
    """Build quantum band frequency analysis from MC path results.

    Compares theoretical band probabilities against simulated frequencies
    and computes quantum value statistics (conditional on TRUE_WIN).
    """
    win_results = [r for r in path_results if r.outcome == "TRUE_WIN" and r.quantum_cr > 0]
    win_quantums = np.array([r.quantum_cr for r in win_results]) if win_results else np.array([])
    win_quantum_pcts = np.array([r.quantum_pct for r in win_results]) if win_results else np.array([])

    # Band frequency from simulation
    band_counts = Counter(r.band_idx for r in win_results)
    bands = claim.quantum.bands if claim.quantum and claim.quantum.bands else []
    band_data = []
    for idx, b in enumerate(bands):
        band_data.append({
            "idx": idx,
            "low": _pct(b.low),
            "high": _pct(b.high),
            "theoretical_prob": _pct(b.probability),
            "simulated_count": band_counts.get(idx, 0),
            "simulated_freq": _pct(band_counts.get(idx, 0) / len(win_results)) if win_results else 0,
        })

    return {
        "n_wins": len(win_results),
        "bands": band_data,
        "histogram_cr": _build_histogram(win_quantums, 25),
        "histogram_pct": _build_histogram(win_quantum_pcts, 20),
        "stats_cr": {
            "mean": _cr(float(win_quantums.mean())) if len(win_quantums) > 0 else 0,
            "median": _cr(float(np.median(win_quantums))) if len(win_quantums) > 0 else 0,
            **_percentiles(win_quantums),
        },
    }


def _build_timeline_distribution(claim: ClaimConfig, path_results: list[PathResult]) -> dict:
    """Build timeline duration distribution with per-stage breakdown.

    Returns histogram, percentile stats, and pre-arbitration stage configs.
    """
    all_durations = np.array([r.timeline_months for r in path_results])

    # Stage-by-stage from claim config
    stages = []
    for s in (claim.timeline.pre_arb_stages if claim.timeline else []):
        stages.append({
            "name": s.name,
            "duration_low": s.duration_low,
            "duration_high": s.duration_high,
            "expected": (s.duration_low + s.duration_high) / 2,
        })

    return {
        "histogram": _build_histogram(all_durations, 25),
        "stats": {
            "mean": _pct(float(all_durations.mean())),
            "median": _pct(float(np.median(all_durations))),
            **_percentiles(all_durations),
        },
        "stages": stages,
        "payment_delay_months": claim.timeline.payment_delay_months if claim.timeline else 6,
        "max_horizon_months": claim.timeline.max_horizon_months if claim.timeline else 96,
    }


def _build_legal_cost_distribution(claim: ClaimConfig, path_results: list[PathResult]) -> dict:
    """Build legal cost distribution with stage breakdown and overrun analysis.

    Compares simulated costs against base estimates to measure overrun.
    """
    all_costs = np.array([r.legal_costs_cr for r in path_results])

    # Stage-by-stage from config
    per_stage = claim.legal_costs.per_stage_costs if claim.legal_costs else {}
    stage_breakdown = []
    for stage_name, costs in per_stage.items():
        stage_breakdown.append({
            "stage": stage_name,
            "cost_low_cr": _cr(costs.legal_cost_low) if hasattr(costs, "legal_cost_low") else 0,
            "cost_high_cr": _cr(costs.legal_cost_high) if hasattr(costs, "legal_cost_high") else 0,
            "expected_cr": _cr(
                (costs.legal_cost_low + costs.legal_cost_high) / 2
                if hasattr(costs, "legal_cost_low") else 0
            ),
        })

    # Overrun analysis
    base_total = (
        (claim.legal_costs.one_time_tribunal_cr or 0)
        + (claim.legal_costs.one_time_expert_cr or 0)
        + sum(
            (getattr(c, "legal_cost_low", 0) + getattr(c, "legal_cost_high", 0)) / 2
            for c in per_stage.values()
        )
    ) if claim.legal_costs else 0

    overrun_amounts = all_costs - base_total if base_total > 0 else np.zeros_like(all_costs)
    overrun_pcts = (overrun_amounts / base_total * 100) if base_total > 0 else np.zeros_like(all_costs)

    return {
        "histogram": _build_histogram(all_costs, 25),
        "stats": {
            "mean": _cr(float(all_costs.mean())),
            "median": _cr(float(np.median(all_costs))),
            **_percentiles(all_costs),
        },
        "stage_breakdown": stage_breakdown,
        "one_time_tribunal_cr": _cr(claim.legal_costs.one_time_tribunal_cr) if claim.legal_costs else 0,
        "one_time_expert_cr": _cr(claim.legal_costs.one_time_expert_cr) if claim.legal_costs else 0,
        "overrun_stats": {
            "mean_pct": _pct(float(overrun_pcts.mean())) if len(overrun_pcts) > 0 else 0,
            **_percentiles(overrun_pcts),
        },
        "overrun_histogram": _build_histogram(overrun_pcts, 20),
    }


def _build_probability_tree(claim: ClaimConfig, path_results: list[PathResult]) -> dict:
    """Build tree probability data with simulated frequencies."""
    # Theoretical probabilities from challenge tree
    tree_info = {"scenario_a": {}, "scenario_b": {}}
    ct = claim.challenge_tree
    if ct:
        for scenario_key, scenario_attr in [("scenario_a", ct.scenario_a), ("scenario_b", ct.scenario_b)]:
            if scenario_attr and scenario_attr.root:
                probs = compute_tree_probabilities(scenario_attr)
                tree_info[scenario_key] = {
                    "theoretical": {
                        "p_true_win": _pct(probs.p_true_win),
                        "p_restart": _pct(probs.p_restart),
                        "p_lose": _pct(probs.p_lose),
                        "terminal_paths": probs.terminal_paths,
                    },
                }

    # Simulated path frequencies
    path_id_counts = Counter(r.challenge_path_id for r in path_results if r.challenge_path_id)
    n = len(path_results)
    path_freq = {
        pid: {"count": cnt, "freq": _pct(cnt / n)}
        for pid, cnt in path_id_counts.items()
    }
    tree_info["simulated_path_frequencies"] = path_freq

    # Outcome by path
    path_outcomes = {}
    for r in path_results:
        pid = r.challenge_path_id or "unknown"
        if pid not in path_outcomes:
            path_outcomes[pid] = {"TRUE_WIN": 0, "RESTART": 0, "LOSE": 0, "total": 0}
        path_outcomes[pid][r.outcome] = path_outcomes[pid].get(r.outcome, 0) + 1
        path_outcomes[pid]["total"] += 1
    tree_info["path_outcome_breakdown"] = path_outcomes

    return tree_info


def export_claim_json(
    claim: ClaimConfig,
    path_results: list[PathResult],
    claim_summary: dict,
    sensitivity_results: list[dict],
    simulation_config: SimulationConfig,
    output_path: str,
) -> None:
    """Export single-claim results to JSON.

    Parameters
    ----------
    claim : ClaimConfig
    path_results : list[PathResult]
    claim_summary : dict from compute_claim_summary
    sensitivity_results : list of sensitivity dicts
    simulation_config : SimulationConfig
    output_path : str
    """
    data = {
        "mode": "claim",

        "claim": {
            "id": claim.id,
            "name": claim.name,
            "jurisdiction": claim.jurisdiction,
            "claim_type": claim.claim_type,
            "soc_value_cr": _cr(claim.soc_value_cr),
            "currency": claim.currency,
            "current_stage": claim.current_stage,
            "claimant_share_pct": _pct(claim.claimant_share_pct),
        },

        "simulation_meta": {
            "n_paths": simulation_config.n_paths,
            "seed": simulation_config.seed,
            "start_date": simulation_config.start_date,
            "discount_rate": simulation_config.discount_rate,
            "generated_at": datetime.now().isoformat(),
        },

        "kpis": {
            "win_rate": _pct(claim_summary.get("win_rate", 0)),
            "effective_win_rate": _pct(claim_summary.get("effective_win_rate", 0)),
            "mean_quantum_cr": _cr(claim_summary.get("mean_quantum_cr", 0)),
            "median_quantum_cr": _cr(claim_summary.get("median_quantum_cr", 0)),
            "mean_duration_months": _pct(claim_summary.get("mean_duration_months", 0)),
            "median_duration_months": _pct(claim_summary.get("median_duration_months", 0)),
            "mean_legal_costs_cr": _cr(claim_summary.get("mean_legal_costs_cr", 0)),
            "mean_collected_cr": _cr(claim_summary.get("mean_collected_cr", 0)),
            "p_total_loss": _pct(claim_summary.get("outcome_distribution", {}).get("LOSE", 0) / max(claim_summary.get("n_paths", 1), 1)),
        },

        "outcome_distribution": _build_outcome_distribution(path_results),
        "quantum_distribution": _build_quantum_distribution(claim, path_results),
        "timeline_distribution": _build_timeline_distribution(claim, path_results),
        "legal_cost_distribution": _build_legal_cost_distribution(claim, path_results),
        "probability_tree": _build_probability_tree(claim, path_results),
        "sensitivity": sensitivity_results,
    }

    os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, default=_safe)
