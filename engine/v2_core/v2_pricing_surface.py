"""
TATA_code_v2/v2_pricing_surface.py — Continuous Pricing Surface Pre-Computation.
=================================================================================

Computes a fine-grained 1% × 1% grid of (upfront%, tail%) combinations
using pre-simulated MC paths.  Produces a JSON file (pricing_surface.json)
consumed by the "Pricing Surface" dashboard tab.

Architecture:
  * Reuses the SAME Monte Carlo paths (no re-simulation).
  * Only the investment structure (upfront%, tail%) varies.
  * Pre-extracts loss/legal cash flows once; sweeps premium parameters.
  * Stores 2D surface arrays for direct 3D / contour visualisation,
    plus per-grid-point histograms for distribution exploration.

Output: pricing_surface.json (~3–4 MB for a 31×41 grid @ 10 000 paths).

All monetary values in ₹ Crore.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import sys
import time
from dataclasses import dataclass, field
from typing import Optional

import numpy as np

# ---------------------------------------------------------------------------
# Imports from the existing codebase
# ---------------------------------------------------------------------------
from . import v2_master_inputs as MI
from .v2_config import ClaimConfig, SimulationResults, build_portfolio_context
from .v2_cashflow_builder import portfolio_day_fracs
from .v2_metrics import compute_moic, compute_xirr_from_dayfrac

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
HIST_BINS = 50  # match existing stochastic pricing


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

    total_cost = path_result.legal_cost_total_cr
    total_months = max(int(math.ceil(path_result.total_duration_months)), 2)

    monthly_burn = np.zeros(total_months + 1)
    if total_months > 0 and total_cost > 0:
        monthly_burn[0] = total_cost * 0.05
        remaining = total_cost * 0.95
        per_month = remaining / total_months
        monthly_burn[1:] = per_month

    return monthly_burn


# ===================================================================
# Helper: histogram bins
# ===================================================================

def _compute_histogram(values: np.ndarray, n_bins: int = HIST_BINS) -> list[dict]:
    """Pre-compute histogram bins clipped to [P1, P99]."""
    lo = float(np.percentile(values, 1))
    hi = float(np.percentile(values, 99))
    if hi <= lo:
        hi = lo + 1.0
    counts, edges = np.histogram(values, bins=n_bins, range=(lo, hi))
    result = []
    for i in range(n_bins):
        result.append({"edge": round(float(edges[i]), 4), "count": int(counts[i])})
    result.append({"edge": round(float(edges[-1]), 4), "count": 0})
    return result


def _clean_num(v):
    """Format number: 5.0→'5', 7.5→'7.5'."""
    return str(int(v)) if v == int(v) else str(v)


# ===================================================================
# Main grid computation
# ===================================================================

def run_pricing_surface(
    sim: SimulationResults,
    claims: list[ClaimConfig],
    upfront_min: float = 5.0,
    upfront_max: float = 35.0,
    tail_min: float = 0.0,
    tail_max: float = 40.0,
    step: float = 1.0,
    pricing_basis: str = "soc",
    progress_callback=None,
    ctx=None,
) -> dict:
    """Compute metrics for a fine grid of (upfront%, tail%) combinations.

    Parameters
    ----------
    sim : SimulationResults
        Pre-computed MC simulation.
    claims : list[ClaimConfig]
        Claim configurations.
    upfront_min/max : float
        Upfront premium range (as percentages, e.g. 5.0 = 5%).
    tail_min/max : float
        Tata tail range (as percentages).
    step : float
        Grid step size (percentage points).
    pricing_basis : str
        "soc" or "eq".
    progress_callback : callable, optional
        callback(current, total) for progress reporting.
    ctx : PortfolioContext, optional

    Returns
    -------
    dict  — ready-to-serialise JSON structure.
    """
    # Build grid vectors
    upfront_grid = list(np.arange(upfront_min, upfront_max + step / 2, step))
    tail_grid = list(np.arange(tail_min, tail_max + step / 2, step))

    # Round to avoid floating point artifacts
    upfront_grid = [round(v, 2) for v in upfront_grid]
    tail_grid = [round(v, 2) for v in tail_grid]

    eq_map = sim.expected_quantum_map
    claim_map = {c.claim_id: c for c in claims}
    n = sim.n_paths
    n_claims = len(sim.claim_ids)

    # ── Pre-extract per-path data (constant across combos) ──────────────

    # Average duration per path (for histogram)
    path_avg_durs = np.zeros(n)
    for path_i in range(n):
        dur_sum = sum(
            sim.results[cid][path_i].total_duration_months
            for cid in sim.claim_ids
        )
        path_avg_durs[path_i] = dur_sum / n_claims

    # Legal burn vectors
    path_burns: dict[str, list[np.ndarray]] = {
        cid: [_get_legal_burn(sim.results[cid][i]) for i in range(n)]
        for cid in sim.claim_ids
    }

    # Payment months per claim per path
    path_payment_months: dict[str, np.ndarray] = {}
    for cid in sim.claim_ids:
        pm_arr = np.array([
            max(int(math.ceil(sim.results[cid][i].total_duration_months)), 1)
            for i in range(n)
        ], dtype=int)
        path_payment_months[cid] = pm_arr

    # Max portfolio month per path
    path_max_months = np.zeros(n, dtype=int)
    for cid in sim.claim_ids:
        path_max_months = np.maximum(path_max_months, path_payment_months[cid])

    # Day-frac cache
    _dayfrac_cache: dict[int, np.ndarray] = {}

    def _get_day_fracs(n_months: int) -> np.ndarray:
        if n_months not in _dayfrac_cache:
            _dayfrac_cache[n_months] = portfolio_day_fracs(n_months)
        return _dayfrac_cache[n_months]

    # Pre-compute per-path legal burn template (sum across claims, padded)
    path_legal_templates: list[np.ndarray] = []
    for path_i in range(n):
        nmx = int(path_max_months[path_i]) + 1
        legal_tmpl = np.zeros(nmx)
        for cid in sim.claim_ids:
            lb = path_burns[cid][path_i]
            pm = int(path_payment_months[cid][path_i])
            clip_len = min(len(lb), pm + 1)
            legal_tmpl[:clip_len] -= lb[:clip_len]  # negative = outflow
        path_legal_templates.append(legal_tmpl)

    # Per-claim constants
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

    # Per-claim legal cost totals per path
    path_claim_legal_total: dict[str, np.ndarray] = {}
    for cid in sim.claim_ids:
        totals = np.zeros(n)
        for i in range(n):
            lb = path_burns[cid][i]
            pm = int(path_payment_months[cid][i])
            totals[i] = float(np.sum(lb[:min(len(lb), pm + 1)]))
        path_claim_legal_total[cid] = totals

    # ── Surface arrays (for 3D / contour) ───────────────────────────────
    n_up = len(upfront_grid)
    n_tail = len(tail_grid)

    # Metric names that will become 2D surfaces
    SURFACE_METRICS = [
        "e_irr", "e_moic", "p5_irr", "p25_irr", "p50_irr", "p75_irr", "p95_irr",
        "p5_moic", "p25_moic", "p50_moic", "p75_moic", "p95_moic",
        "prob_loss", "prob_hurdle",
        "irr_cvar_5", "moic_cvar_5",
    ]
    surfaces = {m: np.zeros((n_up, n_tail)) for m in SURFACE_METRICS}

    grid_dict: dict[str, dict] = {}
    total_combos = n_up * n_tail
    combo_idx = 0

    # ── Grid sweep ──────────────────────────────────────────────────────
    for i_up, upfront_pct_raw in enumerate(upfront_grid):
        upfront_pct = upfront_pct_raw / 100.0

        for i_tail, tata_tail_pct_raw in enumerate(tail_grid):
            tata_tail_pct = tata_tail_pct_raw / 100.0
            fund_share = 1.0 - tata_tail_pct
            combo_idx += 1

            moics = np.zeros(n)
            irrs = np.zeros(n)
            net_recoveries = np.zeros(n)

            for path_i in range(n):
                nmx = int(path_max_months[path_i]) + 1
                port_cf = path_legal_templates[path_i].copy()

                portfolio_invested = 0.0
                portfolio_return = 0.0

                for cid in sim.claim_ids:
                    if pricing_basis == "eq" and path_claim_eq[cid] is not None:
                        up = upfront_pct * path_claim_eq[cid]
                    else:
                        up = upfront_pct * path_claim_soc[cid]
                    up = max(up, 1e-6)

                    inflow = fund_share * path_claim_quantum[cid][path_i]

                    port_cf[0] -= up
                    pm = int(path_payment_months[cid][path_i])
                    port_cf[pm] += inflow

                    legal_cost = path_claim_legal_total[cid][path_i]
                    portfolio_invested += up + legal_cost
                    portfolio_return += inflow

                moics[path_i] = compute_moic(portfolio_invested, portfolio_return)
                net_recoveries[path_i] = portfolio_return - portfolio_invested

                day_fracs = _get_day_fracs(nmx)
                irrs[path_i] = compute_xirr_from_dayfrac(day_fracs, port_cf)

            # ── Summary statistics ──────────────────────────────────────
            e_moic = float(np.mean(moics))
            e_irr = float(np.mean(irrs))

            p1_moic = float(np.percentile(moics, 1))
            p5_moic = float(np.percentile(moics, 5))
            p25_moic = float(np.percentile(moics, 25))
            p50_moic = float(np.percentile(moics, 50))
            p75_moic = float(np.percentile(moics, 75))
            p95_moic = float(np.percentile(moics, 95))
            p99_moic = float(np.percentile(moics, 99))

            p1_irr = float(np.percentile(irrs, 1))
            p5_irr = float(np.percentile(irrs, 5))
            p25_irr = float(np.percentile(irrs, 25))
            p50_irr = float(np.percentile(irrs, 50))
            p75_irr = float(np.percentile(irrs, 75))
            p95_irr = float(np.percentile(irrs, 95))
            p99_irr = float(np.percentile(irrs, 99))

            prob_loss = float(np.mean(moics < 1.0))
            prob_hurdle = float(np.mean(irrs > 0.30))

            # CVaR (5%) = expected value in the worst 5%
            irr_var5 = np.percentile(irrs, 5)
            irr_tail = irrs[irrs <= irr_var5]
            irr_cvar_5 = float(np.mean(irr_tail)) if len(irr_tail) > 0 else float(irr_var5)

            moic_var5 = np.percentile(moics, 5)
            moic_tail = moics[moics <= moic_var5]
            moic_cvar_5 = float(np.mean(moic_tail)) if len(moic_tail) > 0 else float(moic_var5)

            # Fill surface arrays
            surfaces["e_irr"][i_up, i_tail] = e_irr
            surfaces["e_moic"][i_up, i_tail] = e_moic
            surfaces["p5_irr"][i_up, i_tail] = p5_irr
            surfaces["p25_irr"][i_up, i_tail] = p25_irr
            surfaces["p50_irr"][i_up, i_tail] = p50_irr
            surfaces["p75_irr"][i_up, i_tail] = p75_irr
            surfaces["p95_irr"][i_up, i_tail] = p95_irr
            surfaces["p5_moic"][i_up, i_tail] = p5_moic
            surfaces["p25_moic"][i_up, i_tail] = p25_moic
            surfaces["p50_moic"][i_up, i_tail] = p50_moic
            surfaces["p75_moic"][i_up, i_tail] = p75_moic
            surfaces["p95_moic"][i_up, i_tail] = p95_moic
            surfaces["prob_loss"][i_up, i_tail] = prob_loss
            surfaces["prob_hurdle"][i_up, i_tail] = prob_hurdle
            surfaces["irr_cvar_5"][i_up, i_tail] = irr_cvar_5
            surfaces["moic_cvar_5"][i_up, i_tail] = moic_cvar_5

            # Histograms
            moic_hist = _compute_histogram(moics, HIST_BINS)
            irr_hist = _compute_histogram(irrs, HIST_BINS)

            key = f"{_clean_num(upfront_pct_raw)}_{_clean_num(tata_tail_pct_raw)}"
            grid_dict[key] = {
                "upfront_pct": upfront_pct_raw,
                "tata_tail_pct": tata_tail_pct_raw,
                "e_moic": round(e_moic, 4),
                "e_irr": round(e_irr, 4),
                "p1_moic": round(p1_moic, 4),
                "p5_moic": round(p5_moic, 4),
                "p25_moic": round(p25_moic, 4),
                "p50_moic": round(p50_moic, 4),
                "p75_moic": round(p75_moic, 4),
                "p95_moic": round(p95_moic, 4),
                "p99_moic": round(p99_moic, 4),
                "p1_irr": round(p1_irr, 4),
                "p5_irr": round(p5_irr, 4),
                "p25_irr": round(p25_irr, 4),
                "p50_irr": round(p50_irr, 4),
                "p75_irr": round(p75_irr, 4),
                "p95_irr": round(p95_irr, 4),
                "p99_irr": round(p99_irr, 4),
                "prob_loss": round(prob_loss, 4),
                "prob_hurdle": round(prob_hurdle, 4),
                "irr_cvar_5": round(irr_cvar_5, 4),
                "moic_cvar_5": round(moic_cvar_5, 4),
                "moic_hist": moic_hist,
                "irr_hist": irr_hist,
            }

            if progress_callback:
                progress_callback(combo_idx, total_combos)

    # ── Build output structure ──────────────────────────────────────────
    soc_cr = ctx.portfolio_soc_cr if ctx else sum(c.soc_value_cr for c in claims)
    mode = ctx.mode if ctx else "all"
    label = ctx.label if ctx else "Full Portfolio"

    output = {
        "meta": {
            "upfront_grid": upfront_grid,
            "tail_grid": tail_grid,
            "step": step,
            "sims_per_combo": n,
            "portfolio_soc_cr": round(soc_cr, 2),
            "portfolio_mode": mode,
            "portfolio_label": label,
            "n_combos": total_combos,
        },
        "surfaces": {
            metric: [[round(float(surfaces[metric][i, j]), 4)
                       for j in range(n_tail)]
                      for i in range(n_up)]
            for metric in SURFACE_METRICS
        },
        "grid": grid_dict,
    }

    return output


# ===================================================================
# Export to JSON
# ===================================================================

def export_pricing_surface(data: dict, output_path: str) -> None:
    """Write pricing surface dict to JSON."""
    out_dir = os.path.dirname(output_path)
    if out_dir:
        os.makedirs(out_dir, exist_ok=True)

    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(data, f)  # no indent — saves ~40% file size

    size_kb = os.path.getsize(output_path) / 1024
    print(f"  Pricing surface exported → {output_path} ({size_kb:.1f} KB)")


# ===================================================================
# CLI entry point
# ===================================================================

def main():
    """Standalone CLI: py -m TATA_code_v2.v2_pricing_surface [options]"""

    # Force UTF-8 output on Windows
    if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
        import io
        sys.stdout = io.TextIOWrapper(
            sys.stdout.buffer, encoding="utf-8", errors="replace", line_buffering=True
        )
        sys.stderr = io.TextIOWrapper(
            sys.stderr.buffer, encoding="utf-8", errors="replace", line_buffering=True
        )

    parser = argparse.ArgumentParser(
        description="Compute continuous pricing surface (upfront × tail grid)"
    )
    parser.add_argument("--n", type=int, default=None,
                        help="Number of MC paths (default: from master_inputs)")
    parser.add_argument("--seed", type=int, default=None,
                        help="Random seed (default: from master_inputs)")
    parser.add_argument("--portfolio", type=str, default="all",
                        choices=["all", "siac", "domestic"],
                        help="Portfolio mode")
    parser.add_argument("--upfront-min", type=float, default=5.0,
                        help="Min upfront %% (default: 5)")
    parser.add_argument("--upfront-max", type=float, default=35.0,
                        help="Max upfront %% (default: 35)")
    parser.add_argument("--tail-min", type=float, default=0.0,
                        help="Min tail %% (default: 0)")
    parser.add_argument("--tail-max", type=float, default=40.0,
                        help="Max tail %% (default: 40)")
    parser.add_argument("--step", type=float, default=1.0,
                        help="Grid step in percentage points (default: 1)")
    parser.add_argument("--pricing-basis", type=str, default="soc",
                        choices=["soc", "eq"],
                        help="Pricing basis (default: soc)")
    parser.add_argument("--output-dir", type=str, default=None,
                        help="Output directory override")
    parser.add_argument("--config", type=str, default=None,
                        help="Path to JSON config override file")
    args = parser.parse_args()

    # Apply config override
    if args.config:
        MI.load_config_override(args.config)
        print(f"[CONFIG] Loaded override from {args.config}")

    from .v2_monte_carlo import run_simulation

    ctx = build_portfolio_context(args.portfolio)
    if args.output_dir:
        ctx.output_dir = args.output_dir

    n_sims = args.n if args.n is not None else MI.N_SIMULATIONS
    seed = args.seed if args.seed is not None else MI.RANDOM_SEED

    n_up = len(list(np.arange(args.upfront_min, args.upfront_max + args.step / 2, args.step)))
    n_tail = len(list(np.arange(args.tail_min, args.tail_max + args.step / 2, args.step)))
    n_combos = n_up * n_tail

    print("=" * 70)
    print("PRICING SURFACE COMPUTATION")
    print("=" * 70)
    print(f"  Portfolio:   {ctx.label}")
    print(f"  MC paths:    {n_sims:,}")
    print(f"  Seed:        {seed}")
    print(f"  Upfront:     {args.upfront_min}% – {args.upfront_max}%")
    print(f"  Tail:        {args.tail_min}% – {args.tail_max}%")
    print(f"  Step:        {args.step}%")
    print(f"  Grid:        {n_up} × {n_tail} = {n_combos} combos")
    print(f"  XIRR solves: {n_combos * n_sims:,}")
    print()

    # Step 1: MC simulation
    t0 = time.time()
    print(f"Step 1/2: Running {n_sims:,} MC paths across {ctx.n_claims} claims...")
    sim = run_simulation(n=n_sims, seed=seed, claims=ctx.claims)
    sim.portfolio_mode = ctx.mode
    sim.portfolio_label = ctx.label
    sim.portfolio_soc_cr = ctx.portfolio_soc_cr
    elapsed_mc = time.time() - t0
    print(f"  MC completed in {elapsed_mc:.1f}s")
    print()

    # Step 2: Grid sweep
    t1 = time.time()
    print(f"Step 2/2: Computing {n_combos} pricing surface points...")

    def _progress(current: int, total: int) -> None:
        if current % max(1, total // 20) == 0 or current == total:
            pct = current / total * 100
            print(f"  [{current}/{total}] {pct:.0f}% complete...", end="\r")

    result = run_pricing_surface(
        sim=sim,
        claims=ctx.claims,
        upfront_min=args.upfront_min,
        upfront_max=args.upfront_max,
        tail_min=args.tail_min,
        tail_max=args.tail_max,
        step=args.step,
        pricing_basis=args.pricing_basis,
        progress_callback=_progress,
        ctx=ctx,
    )

    elapsed_grid = time.time() - t1
    print(f"\n  Grid completed in {elapsed_grid:.1f}s")
    print()

    # Export
    output_dir = ctx.output_dir
    os.makedirs(output_dir, exist_ok=True)
    output_path = os.path.join(output_dir, "pricing_surface.json")
    export_pricing_surface(result, output_path)

    total_elapsed = time.time() - t0
    print(f"\nTotal runtime: {total_elapsed:.1f}s")
    print("=" * 70)


if __name__ == "__main__":
    main()
