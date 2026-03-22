#!/usr/bin/env python3
"""
engine/run.py — CLI orchestrator for the Claim Analytics Platform.
===================================================================

Usage:
    python engine/run.py --config portfolio_config.json --output-dir outputs/
    python engine/run.py --config portfolio_config.json --n 5000 --seed 42

Pipeline:
  1. Load and validate portfolio config
  2. Load claim configs
  3. Load jurisdiction templates
  4. Run MC simulation for all claims
  5. Compute claim summaries
  6. Evaluate grid (appropriate to structure type)
  7. Compute risk metrics
  8. Compute sensitivity
  9. Export JSON
  10. Print summary to console

Supports all 5 structure types. The structure type determines which
analysis modules are called and what's included in the JSON.
"""

from __future__ import annotations

import argparse
import io
import json
import os
import sys
import time
from pathlib import Path

# Force UTF-8 output on Windows
if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
    sys.stdout = io.TextIOWrapper(
        sys.stdout.buffer, encoding="utf-8", errors="replace", line_buffering=True
    )
    sys.stderr = io.TextIOWrapper(
        sys.stderr.buffer, encoding="utf-8", errors="replace", line_buffering=True
    )

# Ensure project root is importable
_engine_dir = Path(__file__).resolve().parent
_platform_dir = _engine_dir.parent
if str(_platform_dir) not in sys.path:
    sys.path.insert(0, str(_platform_dir))


def run_claim_pipeline(
    config_path: str,
    output_dir: str = "outputs",
    n_override: int | None = None,
    seed_override: int | None = None,
) -> dict:
    """Run single-claim analysis pipeline (no investment grid).

    Parameters
    ----------
    config_path : str
        Path to config JSON with a single claim config.
    output_dir : str
        Output directory for JSON exports.
    n_override : int, optional
        Override n_paths from config.
    seed_override : int, optional
        Override seed from config.

    Returns
    -------
    dict with keys: path_results, claim_summary, sensitivity, output_path
    """
    from engine.config.schema import ClaimConfig, SimulationConfig
    from engine.jurisdictions.registry import JurisdictionRegistry
    from engine.simulation.monte_carlo import (
        run_claim_simulation,
        compute_claim_summary,
    )

    print("=" * 70)
    print("CLAIM ANALYTICS PLATFORM — Single Claim Run")
    print("=" * 70)

    config_file = Path(config_path)
    if not config_file.exists():
        print(f"ERROR: Config file not found: {config_path}")
        sys.exit(1)

    raw = json.loads(config_file.read_text(encoding="utf-8"))

    # Extract claim config — may be nested under 'claims' array or top-level
    claims_raw = raw.pop("claims", [])
    claim_raw = claims_raw[0] if claims_raw else raw.get("claim_config", raw)
    claim = ClaimConfig.model_validate(claim_raw)

    # Simulation settings
    sim_raw = raw.get("simulation", {})
    n_paths = n_override or sim_raw.get("n_paths", 10000)
    seed = seed_override if seed_override is not None else sim_raw.get("seed", 42)
    sim_config = SimulationConfig(
        n_paths=n_paths,
        seed=seed,
        discount_rate=sim_raw.get("discount_rate", 0.12),
        risk_free_rate=sim_raw.get("risk_free_rate", 0.07),
        start_date=sim_raw.get("start_date", "2026-04-30"),
    )

    print(f"  Claim:        {claim.id} — {claim.name}")
    print(f"  Jurisdiction: {claim.jurisdiction}")
    print(f"  SOC:          {claim.soc_value_cr:,.1f} Cr")
    print(f"  Simulations:  {sim_config.n_paths:,}")
    print(f"  Seed:         {sim_config.seed}")
    print()

    os.makedirs(output_dir, exist_ok=True)

    # Load jurisdiction template
    registry = JurisdictionRegistry()
    template = registry.get_template(claim.jurisdiction)

    # Run MC simulation
    t0 = time.time()
    print(f"Running {sim_config.n_paths:,} MC paths for claim '{claim.id}'...")
    path_results = run_claim_simulation(
        claim, template, sim_config.n_paths, sim_config.seed,
    )
    elapsed_mc = time.time() - t0
    print(f"  MC completed in {elapsed_mc:.1f}s "
          f"({sim_config.n_paths / elapsed_mc:,.0f} paths/sec)")
    print()

    # Compute claim summary
    print("Computing claim summary...")
    claim_summary = compute_claim_summary(claim, path_results)

    # Print key metrics
    s = claim_summary
    print(f"  Win Rate:       {s['win_rate']:.1%}")
    print(f"  Eff Win Rate:   {s['effective_win_rate']:.1%}")
    print(f"  E[Quantum|Win]: {s['mean_quantum_cr']:,.1f} Cr")
    print(f"  E[Duration]:    {s['mean_duration_months']:.1f} months")
    print(f"  E[Legal Costs]: {s['mean_legal_costs_cr']:,.1f} Cr")
    print()

    # Sensitivity: E[Collected] vs arb win prob reweighting
    print("Computing arb-win sensitivity...")
    from engine.analysis.sensitivity import compute_arb_win_sensitivity
    import numpy as np
    arb_win_prob = claim.arbitration.win_probability
    sensitivity_results = compute_arb_win_sensitivity(
        [claim], {claim.id: path_results}, arb_win_prob,
        start_date=sim_config.start_date,
    )
    print(f"  Sensitivity: {len(sensitivity_results)} points computed")

    # Export claim-level JSON
    print("\nExporting claim results JSON...")
    output_path = os.path.join(output_dir, "claim_results.json")
    from engine.export.claim_exporter import export_claim_json
    export_claim_json(
        claim=claim,
        path_results=path_results,
        claim_summary=claim_summary,
        sensitivity_results=sensitivity_results,
        simulation_config=sim_config,
        output_path=output_path,
    )

    print(f"\nPipeline complete. Output: {output_path}")

    return {
        "path_results": path_results,
        "claim_summary": claim_summary,
        "sensitivity_results": sensitivity_results,
        "output_path": output_path,
    }


def run_pipeline(
    config_path: str,
    output_dir: str = "outputs",
    n_override: int | None = None,
    seed_override: int | None = None,
) -> dict:
    """Run the full analysis pipeline.

    Parameters
    ----------
    config_path : str
        Path to portfolio_config.json (contains portfolio + claim configs).
    output_dir : str
        Output directory for JSON exports.
    n_override : int, optional
        Override n_paths from config.
    seed_override : int, optional
        Override seed from config.

    Returns
    -------
    dict with keys: all_path_results, claim_summaries, grid_results,
    risk_metrics, sensitivity_results, output_path
    """
    from engine.config.schema import (
        ClaimConfig,
        PortfolioConfig,
        SimulationConfig,
    )
    from engine.jurisdictions.registry import JurisdictionRegistry
    from engine.simulation.monte_carlo import (
        run_portfolio_simulation,
        compute_claim_summary,
    )

    # ── Step 1: Load and validate config ──
    print("=" * 70)
    print("CLAIM ANALYTICS PLATFORM — Pipeline Run")
    print("=" * 70)

    config_file = Path(config_path)
    if not config_file.exists():
        print(f"ERROR: Config file not found: {config_path}")
        sys.exit(1)

    raw = json.loads(config_file.read_text(encoding="utf-8"))

    # Extract claims from config (they may be inline or referenced)
    claims_raw = raw.pop("claims", [])

    # Parse portfolio config
    portfolio_config = PortfolioConfig.model_validate(raw)

    # ── Step 2: Load claim configs ──
    claims: list[ClaimConfig] = []
    for c_raw in claims_raw:
        claims.append(ClaimConfig.model_validate(c_raw))

    # Filter to portfolio claim_ids
    claim_map = {c.id: c for c in claims}
    portfolio_claims = [
        claim_map[cid] for cid in portfolio_config.claim_ids
        if cid in claim_map
    ]

    if not portfolio_claims:
        print("ERROR: No matching claims found for portfolio claim_ids")
        sys.exit(1)

    # ── Step 3: Load jurisdiction templates ──
    registry = JurisdictionRegistry()
    templates = {}
    for c in portfolio_claims:
        if c.jurisdiction not in templates:
            templates[c.jurisdiction] = registry.get_template(c.jurisdiction)

    # ── Apply overrides ──
    sim_config = portfolio_config.simulation
    if n_override is not None:
        sim_config = SimulationConfig(
            n_paths=n_override,
            seed=sim_config.seed if seed_override is None else seed_override,
            discount_rate=sim_config.discount_rate,
            risk_free_rate=sim_config.risk_free_rate,
            start_date=sim_config.start_date,
        )
    elif seed_override is not None:
        sim_config = SimulationConfig(
            n_paths=sim_config.n_paths,
            seed=seed_override,
            discount_rate=sim_config.discount_rate,
            risk_free_rate=sim_config.risk_free_rate,
            start_date=sim_config.start_date,
        )

    structure = portfolio_config.structure
    stype = structure.type

    print(f"  Portfolio:    {portfolio_config.name}")
    print(f"  Structure:    {stype}")
    print(f"  Claims:       {len(portfolio_claims)} ({', '.join(c.id for c in portfolio_claims)})")
    print(f"  Total SOC:    INR {sum(c.soc_value_cr for c in portfolio_claims):,.2f} Crore")
    print(f"  Simulations:  {sim_config.n_paths:,}")
    print(f"  Seed:         {sim_config.seed}")
    print(f"  Output dir:   {output_dir}")
    print()

    os.makedirs(output_dir, exist_ok=True)

    # ── Step 4: Run MC simulation ──
    t0 = time.time()
    print(f"Running {sim_config.n_paths:,} MC paths across {len(portfolio_claims)} claims...")
    all_path_results = run_portfolio_simulation(
        portfolio_claims, templates, sim_config.n_paths, sim_config.seed,
    )
    elapsed_mc = time.time() - t0
    total_paths = sim_config.n_paths * len(portfolio_claims)
    print(f"  MC completed in {elapsed_mc:.1f}s "
          f"({total_paths / elapsed_mc:,.0f} claim-paths/sec)")
    print()

    # ── Step 5: Compute claim summaries ──
    print("Computing claim summaries...")
    claim_summaries: dict[str, dict] = {}
    for c in portfolio_claims:
        claim_summaries[c.id] = compute_claim_summary(c, all_path_results[c.id])

    # Print summary table
    print(f"\n{'Claim':<14} {'SOC (Cr)':>10} {'Win%':>7} {'E[Q] Cr':>10} "
          f"{'E[Dur] mo':>10} {'E[Legal]':>10} {'E[Coll]':>10}")
    print("-" * 75)
    for c in portfolio_claims:
        s = claim_summaries[c.id]
        print(f"{c.id:<14} {c.soc_value_cr:>10,.1f} {s['win_rate']:>7.1%} "
              f"{s['mean_quantum_cr']:>10,.1f} {s['mean_duration_months']:>10.1f} "
              f"{s['mean_legal_costs_cr']:>10,.1f} {s['mean_collected_cr']:>10,.1f}")
    print()

    # ── Step 6: Evaluate grid (structure-dependent) ──
    t1 = time.time()
    grid_results = {}
    breakeven_data = []

    if stype == "monetisation_upfront_tail":
        from engine.analysis.investment_grid import (
            evaluate_upfront_tail_grid,
            find_breakeven_curve,
        )
        params = structure.params
        from engine.analysis.investment_grid import _arange
        upfront_list = _arange(params.upfront_range)
        tail_list = _arange(params.tail_range)
        print(f"Computing investment grid ({len(upfront_list)} × {len(tail_list)})...")
        grid_results = evaluate_upfront_tail_grid(
            portfolio_claims, all_path_results,
            upfront_range=upfront_list,
            tail_range=tail_list,
            pricing_basis=params.pricing_basis if params.pricing_basis != "both" else "soc",
            simulation_config=sim_config,
            start_date=sim_config.start_date,
        )
        breakeven_data = find_breakeven_curve(grid_results)

    elif stype == "litigation_funding":
        from engine.analysis.waterfall_analysis import evaluate_waterfall_grid
        params = structure.params
        from engine.analysis.investment_grid import _arange
        cm_list = _arange(params.cost_multiple_range)
        ar_list = _arange(params.award_ratio_range)
        print(f"Computing waterfall grid ({len(cm_list)} × {len(ar_list)})...")
        grid_results = evaluate_waterfall_grid(
            portfolio_claims, all_path_results,
            cost_multiple_range=cm_list,
            award_ratio_range=ar_list,
            waterfall_type=params.waterfall_type,
            simulation_config=sim_config,
            start_date=sim_config.start_date,
        )

    elif stype in ("monetisation_full_purchase", "monetisation_staged"):
        # For these types, grid is not applicable — compute a single cell
        print(f"Structure '{stype}' — single scenario evaluation...")

    elif stype == "comparative":
        # Run both lit funding and monetisation grids
        from engine.analysis.investment_grid import (
            evaluate_upfront_tail_grid,
            find_breakeven_curve,
        )
        from engine.analysis.waterfall_analysis import evaluate_waterfall_grid

        mon_params = structure.monetisation_params
        if hasattr(mon_params, "upfront_range"):
            from engine.analysis.investment_grid import _arange
            upfront_list = _arange(mon_params.upfront_range)
            tail_list = _arange(mon_params.tail_range)
            grid_results = evaluate_upfront_tail_grid(
                portfolio_claims, all_path_results,
                upfront_range=upfront_list,
                tail_range=tail_list,
                pricing_basis="soc",
                simulation_config=sim_config,
                start_date=sim_config.start_date,
            )
            breakeven_data = find_breakeven_curve(grid_results)

    elapsed_grid = time.time() - t1
    if grid_results:
        print(f"  Grid analysis completed in {elapsed_grid:.1f}s ({len(grid_results)} cells)")
    print()

    # ── Step 7: Compute risk metrics ──
    print("Computing risk metrics...")
    from engine.analysis.risk_metrics import compute_portfolio_risk
    risk_metrics = compute_portfolio_risk(
        portfolio_claims, all_path_results, structure, sim_config,
        start_date=sim_config.start_date,
    )
    print("  Risk metrics computed")

    # ── Step 8: Compute sensitivity ──
    print("Computing arb-win sensitivity...")
    from engine.analysis.sensitivity import compute_arb_win_sensitivity
    arb_win_prob = portfolio_claims[0].arbitration.win_probability
    sensitivity_results = compute_arb_win_sensitivity(
        portfolio_claims, all_path_results, arb_win_prob,
        start_date=sim_config.start_date,
    )
    print(f"  Sensitivity: {len(sensitivity_results)} points computed")

    # ── Step 9: Export JSON ──
    print("\nExporting dashboard JSON...")
    output_path = os.path.join(output_dir, "dashboard_data.json")
    from engine.export.json_exporter import export_dashboard_json
    export_dashboard_json(
        claims=portfolio_claims,
        all_path_results=all_path_results,
        claim_summaries=claim_summaries,
        grid_results=grid_results,
        portfolio_config=portfolio_config,
        risk_metrics=risk_metrics,
        sensitivity_results=sensitivity_results,
        output_path=output_path,
        simulation_config=sim_config,
        structure_type=stype,
        breakeven_data=breakeven_data,
    )

    # ── Step 9b: Export Excel (optional — requires openpyxl) ──
    try:
        from engine.export.excel_writer import export_excel
        import json as _json
        dashboard_json = _json.loads(
            Path(output_path).read_text(encoding="utf-8")
        )
        excel_path = os.path.join(output_dir, "dashboard_report.xlsx")
        print("Exporting Excel report...")
        export_excel(dashboard_json, excel_path)
    except ImportError:
        print("  Skipping Excel export (openpyxl not installed)")
    except Exception as exc:
        print(f"  Excel export failed: {exc}")

    # ── Step 10: Print top scenarios ──
    if grid_results:
        viable = [
            (k, c) for k, c in grid_results.items()
            if c.p_loss < 0.40
        ]
        viable.sort(key=lambda x: x[1].mean_moic, reverse=True)
        if viable:
            print(f"\n{'='*70}")
            print("TOP 3 SCENARIOS (P(loss) < 40%)")
            print(f"{'='*70}")
            for i, (key, cell) in enumerate(viable[:3], 1):
                print(f"  #{i}: {key} — E[MOIC]={cell.mean_moic:.2f}x  "
                      f"E[XIRR]={cell.mean_xirr:.1%}  P(loss)={cell.p_loss:.1%}")
            print(f"{'='*70}")

    print(f"\nPipeline complete. Output: {output_path}")

    return {
        "all_path_results": all_path_results,
        "claim_summaries": claim_summaries,
        "grid_results": grid_results,
        "risk_metrics": risk_metrics,
        "sensitivity_results": sensitivity_results,
        "output_path": output_path,
    }


# ===================================================================
# CLI
# ===================================================================

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Claim Analytics Platform — Monte Carlo Pipeline"
    )
    parser.add_argument(
        "--config", type=str, required=True,
        help="Path to config JSON (portfolio or claim config)"
    )
    parser.add_argument(
        "--output-dir", type=str, default="outputs",
        help="Output directory (default: outputs/)"
    )
    parser.add_argument(
        "--mode", type=str, default="portfolio", choices=["portfolio", "claim"],
        help="Run mode: 'portfolio' (default) or 'claim' (single claim, no grid)"
    )
    parser.add_argument(
        "--n", type=int, default=None,
        help="Override number of MC paths"
    )
    parser.add_argument(
        "--seed", type=int, default=None,
        help="Override base random seed"
    )
    args = parser.parse_args()

    if args.mode == "claim":
        run_claim_pipeline(
            config_path=args.config,
            output_dir=args.output_dir,
            n_override=args.n,
            seed_override=args.seed,
        )
    else:
        run_pipeline(
            config_path=args.config,
            output_dir=args.output_dir,
            n_override=args.n,
            seed_override=args.seed,
        )


if __name__ == "__main__":
    main()
