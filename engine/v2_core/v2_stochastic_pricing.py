"""
TATA_code_v2/v2_stochastic_pricing.py — Stochastic Pricing Grid Pre-Computation.
==================================================================================

Pre-computes Monte Carlo results for all (upfront%, tail%) combinations
using pre-simulated paths, enabling real-time dashboard interactivity.

Uses the SAME MC simulation results (no re-simulation) — only the investment
structure (upfront%, tail%) varies across the 99 combinations.

Output: JSON file with metrics for each of the 99 (11×9) combinations.

All monetary values in ₹ Crore.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from typing import Optional

import numpy as np

from . import v2_master_inputs as MI
from .v2_config import ClaimConfig, SimulationResults
from .v2_cashflow_builder import (
    build_cashflow_simple,
    merge_monthly_cashflows,
    portfolio_day_fracs,
)
from .v2_metrics import compute_moic, compute_xirr_from_dayfrac


# ===================================================================
# Result Dataclass
# ===================================================================

# Default number of histogram bins
HIST_BINS = 50


@dataclass
class ComboResult:
    """Results for one (upfront%, tail%) combination."""

    upfront_pct: float       # as percentage (e.g. 5.0 = 5%)
    tata_tail_pct: float     # as percentage (e.g. 10.0 = 10%)

    # Expected values
    e_moic: float
    e_irr: float

    # Percentiles — MOIC
    p1_moic: float
    p5_moic: float
    p25_moic: float
    p50_moic: float
    p75_moic: float
    p95_moic: float
    p99_moic: float

    # Percentiles — IRR (MOIC-implied annualized)
    p1_irr: float
    p5_irr: float
    p25_irr: float
    p50_irr: float
    p75_irr: float
    p95_irr: float
    p99_irr: float

    # Probability metrics
    prob_loss: float      # P(MOIC < 1.0)
    prob_hurdle: float    # P(IRR > 30%)

    # Histogram bins for distributions
    moic_hist: list = None           # list of {edge, count}
    irr_hist: list = None            # list of {edge, count}
    net_recovery_hist: list = None   # list of {edge, count} — net_return - invested (₹ Cr)
    duration_hist: list = None       # list of {edge, count} — avg portfolio duration (months)


# ===================================================================
# Helper: extract legal burn vector from PathResult
# ===================================================================

def _get_legal_burn(path_result) -> np.ndarray:
    """Get monthly legal burn from PathResult.

    Uses stored monthly_legal_burn if available (from MC engine),
    otherwise approximates with flat burn.
    """
    if (path_result.monthly_legal_burn is not None
            and len(path_result.monthly_legal_burn) > 0):
        return path_result.monthly_legal_burn

    # Fallback: approximate as flat monthly burn
    total_cost = path_result.legal_cost_total_cr
    total_months = max(int(np.ceil(path_result.total_duration_months)), 2)

    monthly_burn = np.zeros(total_months + 1)
    if total_months > 0 and total_cost > 0:
        monthly_burn[0] = total_cost * 0.05  # ~5% tribunal at month 0
        remaining = total_cost * 0.95
        per_month = remaining / total_months
        monthly_burn[1:] = per_month

    return monthly_burn


# ===================================================================
# Helper: compute histogram bins from an array
# ===================================================================

def _compute_histogram(values: np.ndarray, n_bins: int = 50) -> list[dict]:
    """Pre-compute histogram bins for an array of values.

    Clips extreme values to [P1, P99] range to avoid sparse tail bins.
    Returns list of {edge: float, count: int} dicts (length = n_bins).
    """
    lo = float(np.percentile(values, 1))
    hi = float(np.percentile(values, 99))
    if hi <= lo:
        hi = lo + 1.0
    counts, edges = np.histogram(values, bins=n_bins, range=(lo, hi))
    result = []
    for i in range(n_bins):
        result.append({
            "edge": round(float(edges[i]), 4),
            "count": int(counts[i]),
        })
    # Append the final bin edge as metadata
    result.append({"edge": round(float(edges[-1]), 4), "count": 0})
    return result


# ===================================================================
# Main: run_stochastic_grid
# ===================================================================

def run_stochastic_grid(
    sim: SimulationResults,
    claims: list[ClaimConfig],
    pricing_basis: str = "soc",
    progress_callback=None,
    ctx=None,
) -> tuple[dict[str, ComboResult], int]:
    """Compute metrics for all (upfront%, tail%) combinations.

    Uses pre-simulated MC paths from `sim`. For each of the N combinations,
    evaluates portfolio MOIC and IRR across all N paths.

    Parameters
    ----------
    sim : SimulationResults
        Pre-computed MC simulation (from run_simulation).
    claims : list[ClaimConfig]
        Claim configurations.
    pricing_basis : str
        "soc" or "eq" for upfront calculation.
    progress_callback : callable, optional
        Callback(current: int, total: int) for progress reporting.
    ctx : PortfolioContext, optional
        If provided, uses ctx.stochastic_grid for grid dimensions.
        If None, falls back to MI.STOCHASTIC_PRICING.

    Returns
    -------
    tuple[dict[str, ComboResult], int]
        (results dict, actual_sims_per_combo).
        Keys are "upfront_tail" e.g. "10.0_20" → ComboResult.
    """
    if ctx is not None:
        upfront_grid = ctx.stochastic_grid["upfront_pct_grid"]
        tail_grid = ctx.stochastic_grid["tata_tail_pct_grid"]
    else:
        upfront_grid = MI.STOCHASTIC_PRICING["upfront_pct_grid"]
        tail_grid = MI.STOCHASTIC_PRICING["tata_tail_pct_grid"]

    eq_map = sim.expected_quantum_map
    claim_map = {c.claim_id: c for c in claims}
    n = sim.n_paths
    n_claims = len(sim.claim_ids)

    # Pre-compute per-path average duration (for histogram / diagnostics)
    path_avg_durs = np.zeros(n)
    for path_i in range(n):
        dur_sum = sum(
            sim.results[cid][path_i].total_duration_months
            for cid in sim.claim_ids
        )
        path_avg_durs[path_i] = dur_sum / n_claims

    # Pre-extract legal burn vectors (avoid re-extraction per combo)
    path_burns: dict[str, list[np.ndarray]] = {
        cid: [_get_legal_burn(sim.results[cid][i]) for i in range(n)]
        for cid in sim.claim_ids
    }

    # ── Pre-compute per-path data for portfolio XIRR (constant across combos) ──
    # For each path: legal burn template, claim metadata, day_fracs
    import math

    # Per-path: payment months, max portfolio month, pre-computed day_fracs
    path_payment_months: dict[str, np.ndarray] = {}  # cid → array[n] of ints
    for cid in sim.claim_ids:
        pm_arr = np.array([
            max(int(math.ceil(sim.results[cid][i].total_duration_months)), 1)
            for i in range(n)
        ], dtype=int)
        path_payment_months[cid] = pm_arr

    # Max portfolio month per path (determines cashflow vector length & day_fracs)
    path_max_months = np.zeros(n, dtype=int)
    for cid in sim.claim_ids:
        path_max_months = np.maximum(path_max_months, path_payment_months[cid])

    # Pre-compute day_fracs for each distinct n_months (cached to avoid recomputation)
    _dayfrac_cache: dict[int, np.ndarray] = {}
    def _get_day_fracs(n_months: int) -> np.ndarray:
        if n_months not in _dayfrac_cache:
            _dayfrac_cache[n_months] = portfolio_day_fracs(n_months)
        return _dayfrac_cache[n_months]

    # Pre-compute per-path legal burn template (sum of all claims' legal burns,
    # padded to portfolio length).  Constant across combos.
    path_legal_templates: list[np.ndarray] = []
    path_legal_cost_totals: list[np.ndarray] = []  # per-claim legal cost totals per path
    for path_i in range(n):
        nmx = int(path_max_months[path_i]) + 1
        legal_tmpl = np.zeros(nmx)
        for cid in sim.claim_ids:
            lb = path_burns[cid][path_i]
            pm = int(path_payment_months[cid][path_i])
            clip_len = min(len(lb), pm + 1)
            legal_tmpl[:clip_len] -= lb[:clip_len]  # negative = outflow
        path_legal_templates.append(legal_tmpl)

    # Per-path per-claim: soc_cr, quantum_cr, eq_cr (constant across combos)
    path_claim_soc: dict[str, float] = {}
    path_claim_quantum: dict[str, np.ndarray] = {}
    path_claim_eq: dict[str, float] = {}
    for cid in sim.claim_ids:
        claim = claim_map[cid]
        path_claim_soc[cid] = claim.soc_value_cr
        path_claim_quantum[cid] = np.array([
            sim.results[cid][i].collected_cr for i in range(n)
        ])
        path_claim_eq[cid] = eq_map.get(cid)

    # Per-path per-claim: legal cost total (for MOIC invested calculation)
    path_claim_legal_total: dict[str, np.ndarray] = {}
    for cid in sim.claim_ids:
        totals = np.zeros(n)
        for i in range(n):
            lb = path_burns[cid][i]
            pm = int(path_payment_months[cid][i])
            totals[i] = float(np.sum(lb[:min(len(lb), pm + 1)]))
        path_claim_legal_total[cid] = totals

    results: dict[str, ComboResult] = {}
    total_combos = len(upfront_grid) * len(tail_grid)
    combo_idx = 0

    for upfront_pct_raw in upfront_grid:
        upfront_pct = upfront_pct_raw / 100.0  # Convert % → decimal

        for tata_tail_pct_raw in tail_grid:
            tata_tail_pct = tata_tail_pct_raw / 100.0  # Convert % → decimal
            fund_share = 1.0 - tata_tail_pct
            combo_idx += 1

            moics = np.zeros(n)
            irrs = np.zeros(n)
            net_recoveries = np.zeros(n)

            for path_i in range(n):
                # Start from pre-computed legal burn template
                nmx = int(path_max_months[path_i]) + 1
                port_cf = path_legal_templates[path_i].copy()

                portfolio_invested = 0.0
                portfolio_return = 0.0

                for cid in sim.claim_ids:
                    # Upfront
                    if pricing_basis == "eq" and path_claim_eq[cid] is not None:
                        up = upfront_pct * path_claim_eq[cid]
                    else:
                        up = upfront_pct * path_claim_soc[cid]
                    up = max(up, 1e-6)

                    # Inflow at payment month
                    inflow = fund_share * path_claim_quantum[cid][path_i]

                    port_cf[0] -= up  # upfront outflow
                    pm = int(path_payment_months[cid][path_i])
                    port_cf[pm] += inflow  # terminal inflow

                    # Accumulate for MOIC
                    legal_cost = path_claim_legal_total[cid][path_i]
                    portfolio_invested += up + legal_cost
                    portfolio_return += inflow

                moics[path_i] = compute_moic(portfolio_invested, portfolio_return)
                net_recoveries[path_i] = portfolio_return - portfolio_invested

                # True portfolio XIRR from merged cashflows
                day_fracs = _get_day_fracs(nmx)
                irrs[path_i] = compute_xirr_from_dayfrac(day_fracs, port_cf)

            # Pre-compute histogram bins for distributions
            moic_hist = _compute_histogram(moics, HIST_BINS)
            irr_hist = _compute_histogram(irrs, HIST_BINS)
            net_recovery_hist = _compute_histogram(net_recoveries, HIST_BINS)
            duration_hist = _compute_histogram(path_avg_durs, HIST_BINS)

            result = ComboResult(
                upfront_pct=upfront_pct_raw,
                tata_tail_pct=tata_tail_pct_raw,
                e_moic=float(np.mean(moics)),
                e_irr=float(np.mean(irrs)),
                p1_moic=float(np.percentile(moics, 1)),
                p5_moic=float(np.percentile(moics, 5)),
                p25_moic=float(np.percentile(moics, 25)),
                p50_moic=float(np.percentile(moics, 50)),
                p75_moic=float(np.percentile(moics, 75)),
                p95_moic=float(np.percentile(moics, 95)),
                p99_moic=float(np.percentile(moics, 99)),
                p1_irr=float(np.percentile(irrs, 1)),
                p5_irr=float(np.percentile(irrs, 5)),
                p25_irr=float(np.percentile(irrs, 25)),
                p50_irr=float(np.percentile(irrs, 50)),
                p75_irr=float(np.percentile(irrs, 75)),
                p95_irr=float(np.percentile(irrs, 95)),
                p99_irr=float(np.percentile(irrs, 99)),
                prob_loss=float(np.mean(moics < 1.0)),
                prob_hurdle=float(np.mean(irrs > 0.30)),
                moic_hist=moic_hist,
                irr_hist=irr_hist,
                net_recovery_hist=net_recovery_hist,
                duration_hist=duration_hist,
            )

            def _clean_num(v):
                """Format number: 5.0→'5', 7.5→'7.5'."""
                return str(int(v)) if v == int(v) else str(v)

            key = f"{_clean_num(upfront_pct_raw)}_{_clean_num(tata_tail_pct_raw)}"
            results[key] = result

            if progress_callback:
                progress_callback(combo_idx, total_combos)

    return results, n


# ===================================================================
# Export: stochastic grid to JSON
# ===================================================================

def export_stochastic_grid(
    results: dict[str, ComboResult],
    output_path: str,
    ctx=None,
    actual_sims: int | None = None,
) -> None:
    """Export grid results to JSON for dashboard consumption.

    Parameters
    ----------
    results : dict[str, ComboResult]
        Output from run_stochastic_grid().
    output_path : str
        Full path to output JSON file.
    ctx : PortfolioContext, optional
        If provided, uses ctx for portfolio SOC and grid metadata.
    actual_sims : int, optional
        Actual number of MC paths used per combo.  Overrides the
        hardcoded sims_per_combo in STOCHASTIC_PRICING config.
    """
    if ctx is not None:
        stoch = ctx.stochastic_grid
        soc_cr = ctx.portfolio_soc_cr
    else:
        stoch = MI.STOCHASTIC_PRICING
        soc_cr = MI.PORTFOLIO_SOC_CR

    data = {
        "meta": {
            "upfront_grid": stoch["upfront_pct_grid"],
            "tail_grid": stoch["tata_tail_pct_grid"],
            "sims_per_combo": actual_sims if actual_sims else stoch.get("sims_per_combo", MI.STOCHASTIC_PRICING["sims_per_combo"]),
            "portfolio_soc_cr": soc_cr,
            "portfolio_mode": ctx.mode if ctx else "all",
            "portfolio_label": ctx.label if ctx else "Full Portfolio (6 claims)",
            "n_combos": len(results),
        },
        "grid": {},
    }

    for key, r in results.items():
        data["grid"][key] = {
            "upfront_pct": r.upfront_pct,
            "tata_tail_pct": r.tata_tail_pct,
            "e_moic": round(r.e_moic, 3),
            "e_irr": round(r.e_irr, 4),
            "p1_moic": round(r.p1_moic, 3),
            "p5_moic": round(r.p5_moic, 3),
            "p25_moic": round(r.p25_moic, 3),
            "p50_moic": round(r.p50_moic, 3),
            "p75_moic": round(r.p75_moic, 3),
            "p95_moic": round(r.p95_moic, 3),
            "p99_moic": round(r.p99_moic, 3),
            "p1_irr": round(r.p1_irr, 4),
            "p5_irr": round(r.p5_irr, 4),
            "p25_irr": round(r.p25_irr, 4),
            "p50_irr": round(r.p50_irr, 4),
            "p75_irr": round(r.p75_irr, 4),
            "p95_irr": round(r.p95_irr, 4),
            "p99_irr": round(r.p99_irr, 4),
            "prob_loss": round(r.prob_loss, 4),
            "prob_hurdle": round(r.prob_hurdle, 4),
            "moic_hist": r.moic_hist or [],
            "irr_hist": r.irr_hist or [],
            "net_recovery_hist": r.net_recovery_hist or [],
            "duration_hist": r.duration_hist or [],
        }

    out_dir = os.path.dirname(output_path)
    if out_dir:
        os.makedirs(out_dir, exist_ok=True)

    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)

    size_kb = os.path.getsize(output_path) / 1024
    print(f"  Stochastic grid exported → {output_path} ({size_kb:.1f} KB)")
