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
import math
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


def _v2_paths_to_platform(
    sim: SimulationResults,
) -> dict:
    """Convert V2 PathResult objects to platform PathResult for analysis modules."""
    from engine.config.schema import PathResult as PlatformPathResult

    converted: dict[str, list] = {}
    for claim_id, v2_paths in sim.results.items():
        platform_paths = []
        for pr in v2_paths:
            platform_paths.append(PlatformPathResult(
                outcome=pr.final_outcome,
                quantum_cr=pr.quantum.expected_quantum_cr if pr.quantum else 0.0,
                timeline_months=pr.total_duration_months,
                legal_costs_cr=pr.legal_cost_total_cr,
                collected_cr=pr.collected_cr,
                interest_cr=pr.interest_earned_cr,
            ))
        converted[claim_id] = platform_paths
    return converted


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
    portfolio_config: Optional[PortfolioConfig] = None,
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
    portfolio_config : PortfolioConfig, optional
        Full portfolio config (carries structure type/params).

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
            sim, [claim], ctx, portfolio_config, output_dir,
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


def _build_arb_sensitivity(
    sim: SimulationResults,
    waterfall_grid_results: dict,
) -> list[dict]:
    """Compute arb-win-prob sensitivity via analytical path reweighting.

    Uses the litigation-funding waterfall at a reference (cost_multiple,
    award_ratio) mid-point.  Classifies each MC path as 'won' or 'lost'
    and reweights at shifted arb_win_prob values.

    Returns list of {arb_win_prob, e_moic, e_irr, p_loss}.
    """
    import numpy as np

    # Pick reference point from waterfall grid midpoint
    keys = sorted(waterfall_grid_results.keys())
    if not keys:
        return []
    mid_key = keys[len(keys) // 2]
    parts = mid_key.split("_")
    ref_cm = int(parts[0]) / 10.0  # e.g. 30 → 3.0
    ref_ar = int(parts[1]) / 100.0  # e.g. 25 → 0.25

    n_paths = sim.n_paths
    path_moics = np.zeros(n_paths)
    path_irrs = np.zeros(n_paths)
    path_won = np.zeros(n_paths, dtype=bool)

    for path_i in range(n_paths):
        total_inv = 0.0
        total_ret = 0.0
        any_won = False
        mean_dur = 0.0
        n_claims = 0

        for cid in sim.claim_ids:
            paths = sim.results.get(cid, [])
            if path_i >= len(paths):
                continue
            p = paths[path_i]
            legal = float(p.legal_cost_total_cr)
            total_inv += legal

            if p.final_outcome == "TRUE_WIN" and p.collected_cr > 0:
                any_won = True
                leg_a = ref_cm * legal
                leg_b = ref_ar * float(p.collected_cr)
                total_ret += min(leg_a, leg_b)

            mean_dur += float(p.total_duration_months)
            n_claims += 1

        if total_inv > 0:
            moic = total_ret / total_inv
        else:
            moic = 0.0

        path_moics[path_i] = moic
        path_won[path_i] = any_won

        avg_dur = mean_dur / max(n_claims, 1)
        if moic > 0 and avg_dur > 0:
            path_irrs[path_i] = moic ** (12.0 / avg_dur) - 1.0
        else:
            path_irrs[path_i] = -1.0

    # Original arb win probability
    p_orig = MI.ARB_WIN_PROBABILITY
    n_won = int(path_won.sum())
    n_lost = n_paths - n_won

    results = []
    for p_s_raw in np.arange(0.30, 0.96, 0.05):
        p_s = float(max(0.01, min(0.99, p_s_raw)))
        if n_won > 0 and n_lost > 0 and p_orig > 0 and p_orig < 1:
            w_won = p_s / p_orig
            w_lost = (1.0 - p_s) / (1.0 - p_orig)
            weights = np.where(path_won, w_won, w_lost)
            weights /= weights.sum()
            e_moic = float(np.dot(weights, path_moics))
            e_irr = float(np.dot(weights, path_irrs))
            p_loss = float(np.dot(weights, (path_moics < 1.0).astype(float)))
        else:
            e_moic = float(np.mean(path_moics))
            e_irr = float(np.mean(path_irrs))
            p_loss = float(np.mean(path_moics < 1.0))

        results.append({
            "arb_win_prob": round(p_s, 4),
            "e_moic": round(e_moic, 4),
            "e_irr": round(e_irr, 4),
            "p_loss": round(p_loss, 4),
        })

    return results


def _build_litigation_jcurve(sim: SimulationResults) -> dict:
    """Build J-curve data for litigation funding from actual MC path cashflows.

    For litigation funding there are no upfront/tail investment combos.
    The cashflow is: monthly legal cost burn (outflows) → collection at settlement (inflow).
    We compute cumulative cashflow percentile bands directly from the simulation paths.
    """
    import numpy as np

    MAX_MONTHS = 96
    n_paths = sim.n_paths

    # Build cumulative cashflow matrix: shape (n_paths, MAX_MONTHS)
    portfolio_cumul = np.zeros((n_paths, MAX_MONTHS))

    for cid in sim.claim_ids:
        paths = sim.results.get(cid, [])
        for path_idx in range(min(len(paths), n_paths)):
            p = paths[path_idx]
            burn = p.monthly_legal_burn
            if burn is None or len(burn) == 0:
                continue

            payment_month = max(int(math.ceil(p.total_duration_months)), 1)

            # Build monthly cashflow vector: legal costs out, collection in
            cf = np.zeros(MAX_MONTHS)
            burn_len = min(len(burn), MAX_MONTHS)
            for m in range(burn_len):
                cf[m] = -float(burn[m])

            # Collection inflow at settlement month
            if payment_month < MAX_MONTHS and p.collected_cr > 0:
                cf[payment_month] += p.collected_cr

            # Cumulative sum and add to portfolio
            portfolio_cumul[path_idx] += np.cumsum(cf)

    # Compute percentile bands at sampled months
    months_to_sample = list(range(0, min(24, MAX_MONTHS)))
    months_to_sample += list(range(24, MAX_MONTHS, 3))
    months_to_sample = sorted(set(m for m in months_to_sample if m < MAX_MONTHS))

    timeline = []
    for m in months_to_sample:
        col = portfolio_cumul[:, m]
        year = 2026 + (m + 4) // 12
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

    return {
        "scenarios": {"litigation_funding": timeline},
        "available_combos": [],
        "upfront_pcts": [],
        "tata_tail_pcts": [],
        "default_key": "litigation_funding",
        "max_months": MAX_MONTHS,
    }


def _postprocess_dashboard_json(
    sim: SimulationResults,
    grid,
    output_dir: str,
    pricing_basis: str = "soc",
    structure_type: str = "monetisation_upfront_tail",
    waterfall_grid_results: dict | None = None,
) -> None:
    """Enrich exported dashboard_data.json with platform-compatible fields.

    Adds: structure_type, risk section, mc_distributions, investment_grid (dict format).
    The V2 exporter outputs investment_grid_soc as a list; the platform dashboard expects
    a dict keyed by "up_tail" strings.

    For litigation_funding mode, injects waterfall_grid, waterfall_axes, and
    waterfall_breakeven from waterfall_grid_results.
    """
    dash_path = os.path.join(output_dir, "dashboard_data.json")
    if not os.path.isfile(dash_path):
        return

    with open(dash_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    # ── Litigation Funding mode: inject waterfall grid ──
    if structure_type == "litigation_funding" and waterfall_grid_results:
        # Build waterfall_grid dict from GridCellMetrics
        wf_grid = {}
        for key, cell in waterfall_grid_results.items():
            cell_dict = cell.model_dump() if hasattr(cell, "model_dump") else cell.dict()
            cell_dict["e_moic"] = cell_dict.get("mean_moic", 0.0)
            cell_dict["p_hurdle"] = cell_dict.get("p_hurdle", 0.0)
            wf_grid[key] = cell_dict

        data["waterfall_grid"] = wf_grid
        data["structure_type"] = "litigation_funding"
        if data.get("simulation_meta"):
            data["simulation_meta"]["structure_type"] = "litigation_funding"

        # Build waterfall_axes from grid keys (e.g. "30_25" → cm=3.0, ar=0.25)
        cm_set = set()
        ar_set = set()
        for key in waterfall_grid_results:
            parts = key.split("_")
            if len(parts) == 2:
                cm_set.add(int(parts[0]))
                ar_set.add(int(parts[1]))
        data["waterfall_axes"] = {
            "cost_multiples": sorted(v / 10.0 for v in cm_set),
            "award_ratios": sorted(v / 100.0 for v in ar_set),
        }

        # Build waterfall_breakeven: for each award_ratio, find max cost_multiple
        # where E[MOIC] >= 1.0
        breakeven = []
        for ar_val in sorted(ar_set):
            ar_frac = ar_val / 100.0
            max_cm = None
            for cm_val in sorted(cm_set):
                key = f"{cm_val}_{ar_val}"
                cell = waterfall_grid_results.get(key)
                if cell and cell.mean_moic >= 1.0:
                    max_cm = cm_val / 10.0
            if max_cm is not None:
                breakeven.append({"award_ratio": ar_frac, "max_cost_multiple": max_cm})
        data["waterfall_breakeven"] = breakeven

        # Remove upfront/tail keys that don't apply to litigation funding
        data.pop("investment_grid", None)
        data.pop("investment_grid_soc", None)
        data.pop("investment_grid_eq", None)

        # Use waterfall_grid as source for risk/mc_distributions below
        ig_dict = wf_grid

    else:
        # 1. Convert investment_grid_soc list → investment_grid dict + add p_hurdle alias
        for basis_key in ("investment_grid_soc", "investment_grid_eq"):
            if isinstance(data.get(basis_key), list) and len(data[basis_key]) > 0:
                ig = {}
                for row in data[basis_key]:
                    # Add p_hurdle as alias for p_irr_gt_30 (dashboard expects p_hurdle)
                    if "p_hurdle" not in row:
                        row["p_hurdle"] = row.get("p_irr_gt_30", 0.0)
                    # Add e_moic alias for mean_moic
                    if "e_moic" not in row:
                        row["e_moic"] = row.get("mean_moic", 0.0)
                    up = round((row.get("upfront_pct", 0)) * 100)
                    tail = round((row.get("tata_tail_pct", 0)) * 100)
                    ig[f"{up}_{tail}"] = row
                data["investment_grid"] = ig

        # 2. Add structure_type if missing
        if not data.get("structure_type"):
            data["structure_type"] = "monetisation_upfront_tail"

        ig_dict = data.get("investment_grid", {})

    # 3. Build risk section from grid data at a reference point
    #    (sim.results PathResult.moic/irr are not populated by grid analysis,
    #     so we extract risk info from the grid cells themselves)
    ref_key = "10_20" if "10_20" in ig_dict else next(iter(ig_dict), None)
    ref = ig_dict.get(ref_key, {}) if ref_key else {}

    # Collect grid-wide MOIC/IRR stats across all grid points for distribution
    grid_moics = sorted(
        row.get("mean_moic", 0.0)
        for row in ig_dict.values()
        if row.get("mean_moic") is not None
    )
    grid_xirrs = sorted(
        row.get("mean_xirr", 0.0)
        for row in ig_dict.values()
        if row.get("mean_xirr") is not None
    )

    def _percentile(arr, p):
        if not arr:
            return 0.0
        k = (len(arr) - 1) * p
        lo = math.floor(k)
        hi = min(lo + 1, len(arr) - 1)
        frac = k - lo
        return arr[lo] + frac * (arr[hi] - arr[lo])

    data["risk"] = {
        "moic_distribution": {
            "p5": round(_percentile(grid_moics, 0.05), 4),
            "p25": round(_percentile(grid_moics, 0.25), 4),
            "p50": round(_percentile(grid_moics, 0.50), 4),
            "p75": round(_percentile(grid_moics, 0.75), 4),
            "p95": round(_percentile(grid_moics, 0.95), 4),
            "mean": round(ref.get("mean_moic", 0.0), 4),
        },
        "irr_distribution": {
            "p5": round(_percentile(grid_xirrs, 0.05), 4),
            "p25": round(_percentile(grid_xirrs, 0.25), 4),
            "p50": round(_percentile(grid_xirrs, 0.50), 4),
            "p75": round(_percentile(grid_xirrs, 0.75), 4),
            "p95": round(_percentile(grid_xirrs, 0.95), 4),
            "mean": round(ref.get("mean_xirr", 0.0), 4),
        },
        "concentration": {
            "mean_p_loss": round(ref.get("p_loss", 0.0), 4),
        },
    }

    # 4. Build mc_distributions from investment grid data
    #    Use per-cell mean_moic/mean_xirr/mean_net_return_cr across all combos
    all_net_returns = sorted(
        row.get("mean_net_return_cr", 0.0)
        for row in ig_dict.values()
        if row.get("mean_net_return_cr") is not None
    )

    def _histogram(values, n_bins=50):
        if not values:
            return {"bins": [], "counts": [], "edges": []}
        lo, hi = min(values), max(values)
        if lo == hi:
            return {"bins": [lo], "counts": [len(values)], "edges": [lo, hi + 1]}
        width = (hi - lo) / n_bins
        edges = [round(lo + i * width, 6) for i in range(n_bins + 1)]
        counts = [0] * n_bins
        for v in values:
            idx = min(int((v - lo) / width), n_bins - 1)
            counts[idx] += 1
        bins = [round((edges[i] + edges[i + 1]) / 2, 6) for i in range(n_bins)]
        return {"bins": bins, "counts": counts, "edges": edges}

    data["mc_distributions"] = {
        "moic": _histogram(grid_moics),
        "irr": _histogram(grid_xirrs),
        "net_recovery": _histogram(all_net_returns),
        "n_paths": sim.n_paths,
    }

    # 5. Build sensitivity (arb win prob reweighting) for litigation_funding
    if structure_type == "litigation_funding" and waterfall_grid_results:
        sensitivity = _build_arb_sensitivity(sim, waterfall_grid_results)
        if sensitivity:
            data["sensitivity"] = sensitivity

    # 6. Rebuild jcurve_data for litigation_funding using actual MC path cashflows
    #    (no upfront/tail combos — pure legal cost burn + collection at settlement)
    if structure_type == "litigation_funding":
        data["jcurve_data"] = _build_litigation_jcurve(sim)

    with open(dash_path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)

    print("  Post-processed dashboard JSON (added risk, mc_distributions, investment_grid dict)")


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
    from engine.v2_core.v2_investment_analysis import (
        InvestmentGridResults,
        analyze_investment_grid,
    )
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

    # Determine structure type
    structure_type = "monetisation_upfront_tail"
    waterfall_grid_results = None
    if portfolio_config and portfolio_config.structure:
        structure_type = portfolio_config.structure.type

    if structure_type == "litigation_funding":
        # ── Waterfall grid analysis (litigation funding) ──
        from engine.analysis.waterfall_analysis import evaluate_waterfall_grid
        from engine.analysis.investment_grid import _arange

        params = portfolio_config.structure.params
        cm_list = _arange(params.cost_multiple_range)
        ar_list = _arange(params.award_ratio_range)

        print(f"\nComputing waterfall grid ({len(cm_list)} × {len(ar_list)})...")
        t1 = time.time()

        # Convert V2 path results to platform PathResult for waterfall analysis
        platform_path_results = _v2_paths_to_platform(sim)

        waterfall_grid_results = evaluate_waterfall_grid(
            claims, platform_path_results,
            cost_multiple_range=cm_list,
            award_ratio_range=ar_list,
            waterfall_type=params.waterfall_type,
            start_date=sim_config_start_date(portfolio_config),
        )
        elapsed_grid = time.time() - t1
        print(f"  Waterfall grid completed in {elapsed_grid:.1f}s ({len(waterfall_grid_results)} cells)")
        result["waterfall_grid"] = waterfall_grid_results

        # Create a minimal dummy InvestmentGridResults so the V2 exporter
        # can still build non-grid sections (claims, jcurve, cashflow, etc.)
        grid = InvestmentGridResults(
            upfront_pcts=[],
            award_share_pcts=[],
            pricing_bases=[pricing_basis],
            n_paths=sim.n_paths,
            n_claims=len(claims),
        )
    else:
        # ── Standard upfront/tail investment grid analysis ──
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

    # ── Stochastic pricing grid (skip for litigation_funding — uses upfront/tail axes) ──
    stochastic_json = None
    if structure_type != "litigation_funding":
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
    else:
        print("\n  Skipping stochastic pricing grid (not applicable for litigation_funding)")

    # ── Probability sensitivity (skip for litigation_funding — uses upfront/tail grid) ──
    prob_sensitivity = None
    if structure_type != "litigation_funding":
        try:
            print("\nRunning probability sensitivity analysis...")
            prob_sensitivity = run_probability_sensitivity(
                sim, v2_claims, grid, pricing_basis=pricing_basis, ctx=ctx,
            )
            result["prob_sensitivity"] = prob_sensitivity
        except Exception as exc:
            print(f"  Warning: probability sensitivity failed: {exc}")
    else:
        print("  Skipping probability sensitivity (not applicable for litigation_funding)")

    # ── Dashboard JSON ──
    try:
        export_dashboard_json(
            sim, v2_claims, grid,
            stochastic_results=stochastic_json,
            prob_sensitivity=prob_sensitivity,
            output_dir=output_dir, ctx=ctx,
        )
        print(f"  Dashboard JSON exported to {output_dir}/dashboard_data.json")

        # Post-process: add platform-compatible fields the V2 exporter doesn't produce
        _postprocess_dashboard_json(
            sim, grid, output_dir, pricing_basis,
            structure_type=structure_type,
            waterfall_grid_results=waterfall_grid_results,
        )

    except Exception as exc:
        print(f"  Warning: dashboard JSON export failed: {exc}")

    # ── Chart Data Excel ──
    try:
        generate_chart_data_excel(output_dir=output_dir, filename="Chart_Data.xlsx")
    except Exception as exc:
        print(f"  Warning: chart data Excel failed: {exc}")

    return result


def sim_config_start_date(portfolio_config: PortfolioConfig) -> str:
    """Extract start_date from portfolio config simulation settings."""
    if portfolio_config and portfolio_config.simulation:
        return portfolio_config.simulation.start_date
    return "2026-04-30"


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
            portfolio_config=portfolio,
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
