#!/usr/bin/env python3
"""
TATA_code_v2/v2_run.py — CLI entry point for v2 valuation model.
=================================================================

Usage:
    python -m TATA_code_v2.v2_run --n 10000 --seed 42
    python -m TATA_code_v2.v2_run --n 10000 --seed 42 --portfolio siac
    python -m TATA_code_v2.v2_run --n 10000 --seed 42 --portfolio compare
    python -m TATA_code_v2.v2_run --n 500 --seed 42 --audit-only
    python -m TATA_code_v2.v2_run --n 10000 --seed 42 --pricing-basis both

Portfolio modes:
  all      — Full portfolio (6 claims, default)
  siac     — SIAC portfolio (3 claims: CTP11-2, CTP11-4, CTP13-2)
  domestic — Domestic portfolio (3 claims: 301-6, 302-3, 302-5)
  compare  — Run all three modes sequentially + generate comparison workbook

Steps per portfolio:
  1. Build portfolio context (filtered claims, grid, output paths)
  2. Run Monte Carlo simulation (N paths × filtered claims)
  3. Print numerical audit
  4. Run investment grid analysis
  5. Generate reports (Excel, PDF, charts, JSON)
  6. Print top scenarios
"""

from __future__ import annotations

import argparse
import io
import os
import sys
import time

# Force UTF-8 output on Windows to handle ₹ and other Unicode symbols
if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
    sys.stdout = io.TextIOWrapper(
        sys.stdout.buffer, encoding="utf-8", errors="replace", line_buffering=True
    )
    sys.stderr = io.TextIOWrapper(
        sys.stderr.buffer, encoding="utf-8", errors="replace", line_buffering=True
    )

# Ensure the project root is on the path so imports work
# when running as `python TATA_code_v2/v2_run.py`
_project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _project_root not in sys.path:
    sys.path.insert(0, _project_root)


# ===================================================================
# Single Portfolio Run
# ===================================================================

def run_single_portfolio(
    ctx,
    n_sims: int,
    seed: int,
    pricing_basis_str: str,
    audit_only: bool = False,
    skip_stochastic: bool = False,
) -> dict:
    """Run the full analysis pipeline for one portfolio mode.

    Parameters
    ----------
    ctx : PortfolioContext
        Fully configured context (claims, grid, output paths).
    n_sims : int
        Number of MC paths.
    seed : int
        Random seed.
    pricing_basis_str : str
        "soc", "eq", or "both".
    audit_only : bool
        If True, skip investment grid and output generation.
    skip_stochastic : bool
        If True, skip stochastic pricing grid.

    Returns
    -------
    dict with keys: "sim", "grid", "claims", "context", "stochastic_json"
    """
    from . import v2_master_inputs as MI
    from .v2_monte_carlo import run_simulation, print_numerical_audit

    claims = ctx.claims
    output_dir = ctx.output_dir
    os.makedirs(output_dir, exist_ok=True)

    print("=" * 70)
    print(f"TATA v2 VALUATION MODEL — {ctx.label}")
    print("=" * 70)
    print(f"  Portfolio mode: {ctx.mode}")
    print(f"  Simulations:    {n_sims:,}")
    print(f"  Seed:           {seed}")
    print(f"  Pricing basis:  {pricing_basis_str}")
    print(f"  Claims:         {ctx.n_claims} ({', '.join(ctx.claim_ids)})")
    print(f"  Total SOC:      INR {ctx.portfolio_soc_cr:,.2f} Crore")
    print(f"  Jurisdiction:   {ctx.jurisdiction_mix}")
    print(f"  Output dir:     {output_dir}")
    print(f"  Grid:           {len(ctx.upfront_pcts)}×{len(ctx.tata_tail_pcts)} = "
          f"{len(ctx.upfront_pcts) * len(ctx.tata_tail_pcts)} combos")
    print()

    # ── MC Simulation ──
    t0 = time.time()
    print(f"Running {n_sims:,} MC paths across {ctx.n_claims} claims...")
    sim = run_simulation(n=n_sims, seed=seed, claims=claims)
    elapsed_mc = time.time() - t0
    print(f"  MC completed in {elapsed_mc:.1f}s "
          f"({n_sims * ctx.n_claims / elapsed_mc:,.0f} claim-paths/sec)")
    print()

    # Stamp portfolio metadata on SimulationResults
    sim.portfolio_mode = ctx.mode
    sim.portfolio_label = ctx.label
    sim.portfolio_soc_cr = ctx.portfolio_soc_cr
    sim.jurisdiction_mix = ctx.jurisdiction_mix

    # ── Numerical audit ──
    audit_pass = print_numerical_audit(sim)

    result = {
        "sim": sim,
        "grid": None,
        "claims": claims,
        "context": ctx,
        "stochastic_json": None,
    }

    if audit_only:
        print("Audit-only mode — skipping investment analysis.")
        return result

    # ── Investment grid ──
    from .v2_investment_analysis import (
        analyze_investment_grid,
        print_investment_grid_summary,
        print_per_claim_summary,
    )

    pricing_bases = (
        ["soc", "eq"] if pricing_basis_str == "both"
        else [pricing_basis_str]
    )

    t1 = time.time()
    print(f"Computing investment grid ({len(ctx.upfront_pcts)} × "
          f"{len(ctx.award_share_pcts)} × {len(pricing_bases)} bases)...")
    grid = analyze_investment_grid(
        sim, claims, pricing_bases=pricing_bases, ctx=ctx,
    )
    elapsed_grid = time.time() - t1
    print(f"  Grid analysis completed in {elapsed_grid:.1f}s")

    # Print summary tables
    for basis in pricing_bases:
        print_investment_grid_summary(grid, basis=basis)

    # Print per-claim detail for a reference scenario
    ref_tail = 0.30
    ref_aw = round(1.0 - ref_tail, 2)
    if ref_aw in ctx.award_share_pcts:
        print_per_claim_summary(grid, upfront_pct=0.10, award_share_pct=ref_aw,
                                basis=pricing_bases[0])
    elif ctx.award_share_pcts:
        mid_idx = len(ctx.award_share_pcts) // 2
        print_per_claim_summary(grid, upfront_pct=0.10,
                                award_share_pct=ctx.award_share_pcts[mid_idx],
                                basis=pricing_bases[0])

    result["grid"] = grid

    # ── Charts ──
    from .v2_report_charts import generate_all_charts
    charts = generate_all_charts(sim, claims, grid, basis=pricing_bases[0],
                                 output_dir=output_dir)
    print()

    # ── Excel report (14-sheet) ──
    from .v2_excel_writer import generate_excel_report
    excel_fname = f"TATA_V2_Valuation_Model{ctx.output_prefix}.xlsx"
    generate_excel_report(
        sim, claims, grid, basis=pricing_bases[0],
        output_dir=output_dir, filename=excel_fname, ctx=ctx,
    )
    print()

    # ── Comprehensive Excel (20-sheet) ──
    from .v2_comprehensive_excel import generate_comprehensive_report
    comp_fname = f"Investment_Analysis_Report{ctx.output_prefix}.xlsx"
    generate_comprehensive_report(
        sim, claims, grid, basis=pricing_bases[0],
        output_dir=output_dir, filename=comp_fname, ctx=ctx,
    )
    print()

    # ── PDF report ──
    from .v2_pdf_report import generate_pdf_report
    generate_pdf_report(sim, claims, grid, charts, basis=pricing_bases[0],
                        output_dir=output_dir)
    print()

    # ── Stochastic pricing grid ──
    stochastic_json = None
    if not skip_stochastic:
        from .v2_stochastic_pricing import (
            run_stochastic_grid,
            export_stochastic_grid,
        )

        stoch_upfront = ctx.stochastic_grid["upfront_pct_grid"]
        stoch_tail = ctx.stochastic_grid["tata_tail_pct_grid"]
        n_combos = len(stoch_upfront) * len(stoch_tail)
        print("\n" + "=" * 60)
        print(f"STOCHASTIC PRICING GRID ({ctx.label})")
        print("=" * 60)
        print(f"Computing {n_combos} combinations × {sim.n_paths:,} paths × {ctx.n_claims} claims...")

        t_stoch = time.time()

        def _progress(current: int, total: int) -> None:
            if current % 10 == 0 or current == total:
                print(f"  [{current}/{total}] combos evaluated...", end="\r")

        stochastic_results, actual_sims = run_stochastic_grid(
            sim=sim, claims=claims, pricing_basis=pricing_bases[0],
            progress_callback=_progress, ctx=ctx,
        )

        elapsed_stoch = time.time() - t_stoch
        print(f"\n  Stochastic grid completed in {elapsed_stoch:.1f}s ({n_combos} combos)")

        stochastic_path = os.path.join(output_dir, "stochastic_pricing.json")
        export_stochastic_grid(stochastic_results, stochastic_path, ctx=ctx,
                               actual_sims=actual_sims)

        import json as _json
        with open(stochastic_path, "r") as _f:
            stochastic_json = _json.load(_f)
    else:
        print("\nSkipping stochastic pricing grid (--skip-stochastic)")

    result["stochastic_json"] = stochastic_json

    # ── Probability sensitivity ──
    from .v2_probability_sensitivity import run_probability_sensitivity
    print("\n" + "=" * 60)
    print(f"PROBABILITY SENSITIVITY ANALYSIS ({ctx.label})")
    print("=" * 60)
    prob_sensitivity = run_probability_sensitivity(
        sim, claims, grid, pricing_basis=pricing_bases[0], ctx=ctx,
    )
    result["prob_sensitivity"] = prob_sensitivity

    # ── Dashboard JSON ──
    from .v2_json_exporter import export_dashboard_json
    export_dashboard_json(
        sim, claims, grid, stochastic_results=stochastic_json,
        prob_sensitivity=prob_sensitivity,
        output_dir=output_dir, ctx=ctx,
    )
    print()

    # ── Chart Data Excel (for PPT/presentation graphs) ──
    from .v2_chart_data_excel import generate_chart_data_excel
    chart_data_fname = f"Chart_Data{ctx.output_prefix}.xlsx"
    generate_chart_data_excel(
        output_dir=output_dir,
        filename=chart_data_fname,
    )
    print()

    # ── Top scenarios ──
    viable = [
        (k, c) for k, c in grid.cells.items()
        if c.p_loss < 0.40
    ]
    viable.sort(key=lambda x: x[1].mean_moic, reverse=True)
    if viable:
        print("\n" + "=" * 70)
        print(f"TOP 3 INVESTMENT SCENARIOS — {ctx.label} (P(loss) < 40%)")
        print("=" * 70)
        for i, ((up, aw, basis_label), cell) in enumerate(viable[:3], 1):
            tata_tail = 1.0 - aw
            verdict = (
                "Strong Buy" if cell.mean_moic > 2.5 and cell.p_loss < 0.10 else
                "Attractive" if cell.mean_moic > 1.5 and cell.p_loss < 0.25 else
                "Marginal" if cell.mean_moic > 1.0 and cell.p_loss < 0.40 else
                "Avoid"
            )
            print(f"  #{i}: {up:.0%} upfront / {tata_tail:.0%} Tata tail ({basis_label.upper()})")
            print(f"       E[MOIC] = {cell.mean_moic:.2f}x  |  E[XIRR] = {cell.mean_xirr:.1%}  |  P(loss) = {cell.p_loss:.1%}  |  {verdict}")
        print("=" * 70)

    return result


# ===================================================================
# Comparison Mode
# ===================================================================

def run_comparison(
    n_sims: int,
    seed: int,
    pricing_basis_str: str,
    skip_stochastic: bool = False,
) -> None:
    """Run all three portfolio modes and generate comparison workbook."""
    from .v2_config import build_portfolio_context

    all_results = {}
    for mode in ["all", "siac", "domestic"]:
        ctx = build_portfolio_context(mode)
        result = run_single_portfolio(
            ctx, n_sims, seed, pricing_basis_str,
            audit_only=False, skip_stochastic=skip_stochastic,
        )
        all_results[mode] = result
        print(f"\n{'=' * 70}")
        print(f"Completed {ctx.label}")
        print(f"{'=' * 70}\n")

    # Generate comparison workbook
    from . import v2_master_inputs as MI
    from .v2_comparison_excel import generate_comparison_report

    compare_dir = MI.OUTPUT_DIR_COMPARE
    os.makedirs(compare_dir, exist_ok=True)

    generate_comparison_report(all_results, compare_dir)
    print(f"\nComparison report saved to {compare_dir}")


# ===================================================================
# Main
# ===================================================================

def main() -> None:
    """Main entry point."""
    parser = argparse.ArgumentParser(
        description="TATA v2 Monte Carlo Valuation Model"
    )
    parser.add_argument(
        "--n", type=int, default=None,
        help="Number of MC paths (default: from master_inputs)"
    )
    parser.add_argument(
        "--seed", type=int, default=None,
        help="Base random seed (default: from master_inputs)"
    )
    parser.add_argument(
        "--pricing-basis", type=str, default="soc",
        choices=["soc", "eq", "both"],
        help="Pricing basis: soc (SOC-based), eq (E[Q]-based), both"
    )
    parser.add_argument(
        "--audit-only", action="store_true",
        help="Run simulation and print audit only (skip investment grid)"
    )
    parser.add_argument(
        "--output-dir", type=str, default=None,
        help="Output directory override"
    )
    parser.add_argument(
        "--skip-stochastic", action="store_true",
        help="Skip stochastic pricing grid computation"
    )
    parser.add_argument(
        "--portfolio", type=str, default="all",
        choices=["all", "siac", "domestic", "compare"],
        help="Portfolio mode: all (6 claims), siac (3 SIAC), domestic (3 domestic), compare (all three)"
    )
    parser.add_argument(
        "--no-restart", action="store_true",
        help="Treat all RESTART outcomes as LOSE (conservative no re-arbitration mode)"
    )
    parser.add_argument(
        "--config", type=str, default=None,
        help="Path to JSON config override file (overrides master_inputs defaults)"
    )
    args = parser.parse_args()

    # Apply config override BEFORE any lazy module imports
    if args.config:
        from . import v2_master_inputs as _MI_early
        _MI_early.load_config_override(args.config)
        print(f"[CONFIG] Loaded override from {args.config}")

    from . import v2_master_inputs as MI
    from .v2_config import build_portfolio_context

    # Apply no-restart mode if requested
    if args.no_restart:
        MI.NO_RESTART_MODE = True
        print("[NO-RESTART MODE] All RESTART outcomes will be treated as LOSE")

    n_sims = args.n if args.n is not None else MI.N_SIMULATIONS
    seed = args.seed if args.seed is not None else MI.RANDOM_SEED

    t_global = time.time()

    if args.portfolio == "compare":
        run_comparison(
            n_sims, seed, args.pricing_basis,
            skip_stochastic=args.skip_stochastic,
        )
    else:
        ctx = build_portfolio_context(args.portfolio)
        if args.output_dir:
            ctx.output_dir = args.output_dir
        run_single_portfolio(
            ctx, n_sims, seed, args.pricing_basis,
            audit_only=args.audit_only,
            skip_stochastic=args.skip_stochastic,
        )

    total_elapsed = time.time() - t_global
    print(f"\nTotal runtime: {total_elapsed:.1f}s")
    print("=" * 70)


if __name__ == "__main__":
    main()
