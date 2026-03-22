#!/usr/bin/env python3
"""
engine/run_v2.py — Platform entry point for V2 valuation pipeline.
===================================================================

Orchestrates the full analysis pipeline using V2 core functions,
called by the platform's server or CLI.

Usage:
    python -m engine.run_v2 --config engine/tests/test_tata_portfolio.json --output-dir test_outputs/
    python -m engine.run_v2 --config config.json --mode portfolio --output-dir outputs/
    python -m engine.run_v2 --config config.json --mode claim --output-dir outputs/
"""

from __future__ import annotations

import argparse
import io
import json
import os
import sys
import time
from typing import Optional

# Force UTF-8 output on Windows
if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
    sys.stdout = io.TextIOWrapper(
        sys.stdout.buffer, encoding="utf-8", errors="replace", line_buffering=True,
    )
    sys.stderr = io.TextIOWrapper(
        sys.stderr.buffer, encoding="utf-8", errors="replace", line_buffering=True,
    )

from engine.adapter import (
    merge_portfolio_results,
    patch_master_inputs_for_claim,
    platform_claim_to_v2_claim,
    save_and_restore_mi,
)
from engine.config.schema import (
    ClaimConfig as PlatformClaim,
    JurisdictionTemplate,
    PortfolioConfig,
    SimulationConfig,
)
from engine.v2_core import v2_master_inputs as MI
from engine.v2_core.v2_config import (
    ClaimConfig as V2ClaimConfig,
    PathResult as V2PathResult,
    PortfolioContext,
    SimulationResults,
)


# ===================================================================
# Full Portfolio Pipeline
# ===================================================================

def run_platform_pipeline(
    portfolio_config: PortfolioConfig,
    claims: list[PlatformClaim],
    templates: dict[str, JurisdictionTemplate],
    output_dir: str = "outputs",
) -> dict:
    """Full pipeline orchestrator for a multi-claim portfolio.

    Steps:
      1. For each claim: patch MI, run MC simulation, collect results, restore MI.
      2. Merge per-claim results into SimulationResults.
      3. Run investment grid analysis (based on portfolio structure type).
      4. Run stochastic pricing grid.
      5. Run probability sensitivity analysis.
      6. Export all outputs (JSON, Excel, PDF, charts).

    Parameters
    ----------
    portfolio_config : PortfolioConfig
        Portfolio definition with structure and simulation settings.
    claims : list[PlatformClaim]
        Platform claim configs for all claims in the portfolio.
    templates : dict[str, JurisdictionTemplate]
        Jurisdiction templates keyed by jurisdiction ID.
    output_dir : str
        Directory for output files.

    Returns
    -------
    dict
        ``{output_path, status, sim, grid, per_claim_summaries, ...}``
    """
    from engine.v2_core.v2_monte_carlo import run_simulation

    sim_config = portfolio_config.simulation
    n_paths = sim_config.n_paths
    seed = sim_config.seed

    os.makedirs(output_dir, exist_ok=True)

    print("=" * 70)
    print(f"PLATFORM PIPELINE — {portfolio_config.name}")
    print("=" * 70)
    print(f"  Claims:       {len(claims)} ({', '.join(c.id for c in claims)})")
    print(f"  Simulations:  {n_paths:,}")
    print(f"  Seed:         {seed}")
    print(f"  Structure:    {portfolio_config.structure.type}")
    print(f"  Output dir:   {output_dir}")
    total_soc = sum(c.soc_value_cr for c in claims)
    print(f"  Total SOC:    {total_soc:,.2f} Cr")
    print()

    # ── Step 1: Run MC simulation per claim ──
    t0 = time.time()
    per_claim_results: dict[str, list[V2PathResult]] = {}

    for claim in claims:
        template = templates.get(claim.jurisdiction)

        print(f"  Simulating {claim.id} ({claim.jurisdiction})...")
        with save_and_restore_mi():
            # Patch MI for this claim
            patch_master_inputs_for_claim(claim, template)

            # Patch simulation config
            MI.N_SIMULATIONS = n_paths
            MI.RANDOM_SEED = seed
            MI.START_DATE = sim_config.start_date
            MI.DISCOUNT_RATE = sim_config.discount_rate
            MI.RISK_FREE_RATE = sim_config.risk_free_rate

            # Build V2 claim config
            v2_claim = platform_claim_to_v2_claim(claim, template)

            # Run simulation for this single claim
            sim_result = run_simulation(n=n_paths, seed=seed, claims=[v2_claim])

            # Extract per-claim path results
            per_claim_results[claim.id] = sim_result.get_claim_results(v2_claim.claim_id)

    elapsed_mc = time.time() - t0
    print(f"\n  MC completed in {elapsed_mc:.1f}s "
          f"({n_paths * len(claims) / max(elapsed_mc, 0.001):,.0f} claim-paths/sec)")

    # ── Step 2: Merge results ──
    sim = merge_portfolio_results(per_claim_results, claims, n_paths, seed)
    sim.portfolio_mode = "all"
    sim.portfolio_label = portfolio_config.name

    # ── Step 3: Build portfolio context for V2 report functions ──
    ctx = _build_portfolio_context(claims, sim_config, output_dir)

    # ── Step 4: Investment grid analysis ──
    result = _run_analysis_and_export(
        sim, claims, ctx, portfolio_config, output_dir,
    )

    result["sim"] = sim
    result["output_path"] = output_dir
    result["status"] = "complete"
    result["n_claims"] = len(claims)
    result["n_paths"] = n_paths

    # Per-claim summaries
    result["per_claim_summaries"] = {
        cid: {
            "expected_quantum_cr": sim.expected_quantum_map.get(cid, 0.0),
            "mean_duration_months": sim.mean_duration_map.get(cid, 0.0),
            "win_rate": sim.win_rate_map.get(cid, 0.0),
        }
        for cid in sim.claim_ids
    }

    elapsed_total = time.time() - t0
    print(f"\nTotal pipeline time: {elapsed_total:.1f}s")
    print("=" * 70)

    return result


# ===================================================================
# Single-Claim Pipeline
# ===================================================================

def run_single_claim(
    claim: PlatformClaim,
    template: Optional[JurisdictionTemplate],
    simulation_config: SimulationConfig,
    output_dir: str = "outputs",
) -> dict:
    """Single-claim pipeline (for the claim results page).

    Runs the same steps as the full portfolio pipeline but for one claim.

    Parameters
    ----------
    claim : PlatformClaim
        Platform claim configuration.
    template : JurisdictionTemplate, optional
        Jurisdiction template for defaults.
    simulation_config : SimulationConfig
        MC simulation settings.
    output_dir : str
        Directory for output files.

    Returns
    -------
    dict
        ``{output_path, status, sim, grid, claim_summary, ...}``
    """
    from engine.v2_core.v2_monte_carlo import run_simulation

    n_paths = simulation_config.n_paths
    seed = simulation_config.seed
    os.makedirs(output_dir, exist_ok=True)

    print(f"Running single-claim pipeline for {claim.id}...")

    with save_and_restore_mi():
        # Patch MI
        patch_master_inputs_for_claim(claim, template)
        MI.N_SIMULATIONS = n_paths
        MI.RANDOM_SEED = seed
        MI.START_DATE = simulation_config.start_date
        MI.DISCOUNT_RATE = simulation_config.discount_rate
        MI.RISK_FREE_RATE = simulation_config.risk_free_rate

        v2_claim = platform_claim_to_v2_claim(claim, template)

        t0 = time.time()
        sim_result = run_simulation(n=n_paths, seed=seed, claims=[v2_claim])
        elapsed = time.time() - t0
        print(f"  MC completed in {elapsed:.1f}s")

        # Build context and run analysis inside the patched context
        ctx = _build_portfolio_context([claim], simulation_config, output_dir)
        sim = merge_portfolio_results(
            {claim.id: sim_result.get_claim_results(v2_claim.claim_id)},
            [claim], n_paths, seed,
        )
        sim.portfolio_mode = "single"
        sim.portfolio_label = f"Single Claim: {claim.id}"

        result = _run_analysis_and_export(
            sim, [claim], ctx, None, output_dir,
        )

    result["sim"] = sim
    result["output_path"] = output_dir
    result["status"] = "complete"
    result["claim_summary"] = {
        "expected_quantum_cr": sim.expected_quantum_map.get(claim.id, 0.0),
        "mean_duration_months": sim.mean_duration_map.get(claim.id, 0.0),
        "win_rate": sim.win_rate_map.get(claim.id, 0.0),
    }

    return result


# ===================================================================
# Shared: Analysis & Export
# ===================================================================

def _build_portfolio_context(
    claims: list[PlatformClaim],
    sim_config: SimulationConfig,
    output_dir: str,
) -> PortfolioContext:
    """Build a ``PortfolioContext`` from platform claims for V2 report functions."""
    from engine.adapter import _JURISDICTION_MAP

    v2_claims = [
        V2ClaimConfig(
            claim_id=c.id,
            archetype=c.claim_type or "other",
            soc_value_cr=c.soc_value_cr,
            jurisdiction=_JURISDICTION_MAP.get(c.jurisdiction, c.jurisdiction),
            current_gate=c.current_stage or "dab_commenced",
            tpl_share=c.claimant_share_pct,
            pipeline=["dab", "arbitration", "challenge_tree"],
            dab_commencement_date=(
                c.interest.commencement_date if c.interest and c.interest.commencement_date else ""
            ),
        )
        for c in claims
    ]

    # Use current MI grid values (may have been patched)
    upfront_pcts = MI.INVESTMENT_GRID_ALL["upfront_pcts"]
    tata_tail_pcts = MI.INVESTMENT_GRID_ALL["tata_tail_pcts"]

    return PortfolioContext(
        mode="all",
        label=f"Platform Portfolio ({len(claims)} Claims)",
        claims=v2_claims,
        portfolio_soc_cr=sum(c.soc_value_cr for c in claims),
        upfront_pcts=upfront_pcts,
        tata_tail_pcts=tata_tail_pcts,
        award_share_pcts=[round(1.0 - t, 4) for t in tata_tail_pcts],
        stochastic_grid=MI.STOCHASTIC_GRID_ALL,
        output_dir=output_dir,
        output_prefix="",
        theme_color="4A148C",
    )


def _run_analysis_and_export(
    sim: SimulationResults,
    claims: list[PlatformClaim],
    ctx: PortfolioContext,
    portfolio_config: Optional[PortfolioConfig],
    output_dir: str,
) -> dict:
    """Run investment grid, stochastic pricing, sensitivity, and exports.

    Returns a dict with grid results, stochastic data, etc.
    """
    from engine.v2_core.v2_investment_analysis import analyze_investment_grid
    from engine.v2_core.v2_stochastic_pricing import (
        export_stochastic_grid,
        run_stochastic_grid,
    )
    from engine.v2_core.v2_probability_sensitivity import run_probability_sensitivity
    from engine.v2_core.v2_json_exporter import export_dashboard_json
    from engine.v2_core.v2_excel_writer import generate_excel_report
    from engine.v2_core.v2_comprehensive_excel import generate_comprehensive_report
    from engine.v2_core.v2_report_charts import generate_all_charts
    from engine.v2_core.v2_pdf_report import generate_pdf_report
    from engine.v2_core.v2_chart_data_excel import generate_chart_data_excel

    result: dict = {}
    v2_claims = ctx.claims
    pricing_basis = "soc"

    # ── Investment grid analysis ──
    print("\nComputing investment grid...")
    t1 = time.time()
    grid = analyze_investment_grid(
        sim, v2_claims, pricing_bases=[pricing_basis], ctx=ctx,
    )
    elapsed_grid = time.time() - t1
    print(f"  Grid analysis completed in {elapsed_grid:.1f}s")
    result["grid"] = grid

    # ── Charts ──
    try:
        charts = generate_all_charts(
            sim, v2_claims, grid, basis=pricing_basis, output_dir=output_dir,
        )
    except Exception as exc:
        print(f"  Warning: chart generation failed: {exc}")
        charts = {}

    # ── Excel reports ──
    try:
        generate_excel_report(
            sim, v2_claims, grid, basis=pricing_basis,
            output_dir=output_dir, filename="TATA_V2_Valuation_Model.xlsx", ctx=ctx,
        )
    except Exception as exc:
        print(f"  Warning: Excel report failed: {exc}")

    try:
        generate_comprehensive_report(
            sim, v2_claims, grid, basis=pricing_basis,
            output_dir=output_dir, filename="Investment_Analysis_Report.xlsx", ctx=ctx,
        )
    except Exception as exc:
        print(f"  Warning: comprehensive Excel failed: {exc}")

    # ── PDF report ──
    try:
        generate_pdf_report(
            sim, v2_claims, grid, charts, basis=pricing_basis,
            output_dir=output_dir,
        )
    except Exception as exc:
        print(f"  Warning: PDF report failed: {exc}")

    # ── Stochastic pricing grid ──
    stochastic_json = None
    try:
        print("\nComputing stochastic pricing grid...")
        t_stoch = time.time()

        def _progress(current: int, total: int) -> None:
            if current % 10 == 0 or current == total:
                print(f"  [{current}/{total}] combos evaluated...", end="\r")

        stochastic_results, actual_sims = run_stochastic_grid(
            sim=sim, claims=v2_claims, pricing_basis=pricing_basis,
            progress_callback=_progress, ctx=ctx,
        )
        elapsed_stoch = time.time() - t_stoch
        print(f"\n  Stochastic grid completed in {elapsed_stoch:.1f}s")

        stochastic_path = os.path.join(output_dir, "stochastic_pricing.json")
        export_stochastic_grid(
            stochastic_results, stochastic_path, ctx=ctx, actual_sims=actual_sims,
        )
        with open(stochastic_path, "r", encoding="utf-8") as f:
            stochastic_json = json.load(f)
        result["stochastic_json"] = stochastic_json
    except Exception as exc:
        print(f"  Warning: stochastic pricing failed: {exc}")
        stochastic_json = None

    # ── Probability sensitivity ──
    prob_sensitivity = None
    try:
        print("\nRunning probability sensitivity analysis...")
        prob_sensitivity = run_probability_sensitivity(
            sim, v2_claims, grid, pricing_basis=pricing_basis, ctx=ctx,
        )
        result["prob_sensitivity"] = prob_sensitivity
    except Exception as exc:
        print(f"  Warning: probability sensitivity failed: {exc}")

    # ── Dashboard JSON ──
    try:
        export_dashboard_json(
            sim, v2_claims, grid,
            stochastic_results=stochastic_json,
            prob_sensitivity=prob_sensitivity,
            output_dir=output_dir, ctx=ctx,
        )
        print(f"  Dashboard JSON exported to {output_dir}/dashboard_data.json")
    except Exception as exc:
        print(f"  Warning: dashboard JSON export failed: {exc}")

    # ── Chart Data Excel ──
    try:
        generate_chart_data_excel(output_dir=output_dir, filename="Chart_Data.xlsx")
    except Exception as exc:
        print(f"  Warning: chart data Excel failed: {exc}")

    return result


# ===================================================================
# CLI Entry Point
# ===================================================================

def main() -> None:
    """CLI entry point: ``python -m engine.run_v2 --config config.json``"""
    parser = argparse.ArgumentParser(
        description="Claim Analytics Platform — V2 Pipeline Runner",
    )
    parser.add_argument(
        "--config", type=str, required=True,
        help="Path to JSON config file (portfolio + claims)",
    )
    parser.add_argument(
        "--output-dir", type=str, default="outputs",
        help="Output directory (default: outputs/)",
    )
    parser.add_argument(
        "--mode", type=str, default="portfolio",
        choices=["portfolio", "claim"],
        help="Run mode: 'portfolio' (all claims) or 'claim' (single claim)",
    )
    parser.add_argument(
        "--n", type=int, default=None,
        help="Number of MC paths (overrides config)",
    )
    parser.add_argument(
        "--seed", type=int, default=None,
        help="Random seed (overrides config)",
    )
    args = parser.parse_args()

    # ── Load config ──
    config_path = args.config
    if not os.path.isfile(config_path):
        print(f"Error: config file not found: {config_path}", file=sys.stderr)
        sys.exit(1)

    with open(config_path, "r", encoding="utf-8") as f:
        raw = json.load(f)

    # ── Parse portfolio config ──
    from engine.config.loader import load_portfolio_config, merge_with_defaults

    portfolio = PortfolioConfig.model_validate(raw)

    # ── Parse claim configs from inline 'claims' array ──
    claims_raw = raw.get("claims", [])
    claims: list[PlatformClaim] = []
    for claim_data in claims_raw:
        jurisdiction = claim_data.get("jurisdiction", "indian_domestic")
        claim = merge_with_defaults(claim_data, jurisdiction=jurisdiction)
        claims.append(claim)

    if not claims:
        print("Error: no claims found in config file.", file=sys.stderr)
        sys.exit(1)

    # Apply CLI overrides
    if args.n is not None:
        portfolio.simulation.n_paths = args.n
    if args.seed is not None:
        portfolio.simulation.seed = args.seed

    # ── Load jurisdiction templates ──
    from engine.jurisdictions import REGISTRY

    templates: dict[str, JurisdictionTemplate] = {}
    for jur_id in REGISTRY.list_jurisdictions():
        templates[jur_id] = REGISTRY.get_template(jur_id)

    # ── Run pipeline ──
    if args.mode == "claim" and len(claims) == 1:
        template = templates.get(claims[0].jurisdiction)
        result = run_single_claim(
            claims[0], template, portfolio.simulation, args.output_dir,
        )
    else:
        result = run_platform_pipeline(
            portfolio, claims, templates, args.output_dir,
        )

    # ── Print summary ──
    print(f"\nPipeline status: {result.get('status', 'unknown')}")
    print(f"Output directory: {result.get('output_path', args.output_dir)}")

    summaries = result.get("per_claim_summaries", {})
    if not summaries:
        summary = result.get("claim_summary")
        if summary:
            summaries = {claims[0].id: summary}

    if summaries:
        print("\nPer-claim summaries:")
        for cid, s in summaries.items():
            print(
                f"  {cid}: E[Q]={s.get('expected_quantum_cr', 0):.2f} Cr, "
                f"Win={s.get('win_rate', 0):.1%}, "
                f"Dur={s.get('mean_duration_months', 0):.1f}m"
            )


if __name__ == "__main__":
    main()
