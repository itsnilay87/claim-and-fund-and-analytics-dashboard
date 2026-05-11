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


def _extract_upfront_tail_from_config(portfolio_config) -> tuple[float, float]:
    """Extract selected upfront/tail percentages with safe defaults.

    Supports both dict-based configs and Pydantic models.
    """
    default_upfront = 0.10
    default_tail = 0.20

    if portfolio_config is None:
        return default_upfront, default_tail

    if isinstance(portfolio_config, dict):
        cfg = portfolio_config
    elif hasattr(portfolio_config, "model_dump"):
        cfg = portfolio_config.model_dump()
    else:
        cfg = {}

    structure = cfg.get("structure") or {}
    params = structure.get("params") or {}

    def _num(v, fallback):
        try:
            return float(v)
        except (TypeError, ValueError):
            return fallback

    upfront = _num(params.get("upfront_pct"), default_upfront)
    tail = _num(params.get("tail_pct"), default_tail)

    upfront_range = params.get("upfront_range") or {}
    tail_range = params.get("tail_range") or {}
    if isinstance(upfront_range, dict):
        upfront = _num(upfront_range.get("min"), upfront)
    if isinstance(tail_range, dict):
        tail = _num(tail_range.get("min"), tail)

    # Keep values in sensible bounds to avoid impossible deal configs.
    upfront = max(0.0, min(1.0, upfront))
    tail = max(0.0, min(1.0, tail))
    return upfront, tail


# _v2_paths_to_platform moved to engine.structures.litigation_funding


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
            name=c.name,
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


# _build_arb_sensitivity and _build_litigation_jcurve moved to
# engine.structures.litigation_funding


def _postprocess_dashboard_json(
    sim: SimulationResults,
    grid,
    output_dir: str,
    pricing_basis: str = "soc",
    structure_type: str = "monetisation_upfront_tail",
    waterfall_grid_results: dict | None = None,
    portfolio_config: dict | PortfolioConfig | None = None,
) -> None:
    """Enrich exported dashboard_data.json with platform-compatible fields.

    Delegates structure-specific work to the appropriate StructureHandler,
    then applies common risk / mc_distributions / extra-fields enrichment.
    """
    from engine.structures import get_handler

    dash_path = os.path.join(output_dir, "dashboard_data.json")
    if not os.path.isfile(dash_path):
        return

    with open(dash_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    claims_section = data.get("claims") or []
    claim_name_map = {
        row.get("claim_id"): (row.get("name") or row.get("claim_id") or "Unknown Claim")
        for row in claims_section
        if row.get("claim_id")
    }

    # ── Structure-specific postprocessing (returns ig_dict) ──
    handler = get_handler(structure_type)
    ig_dict = handler.postprocess_dashboard(
        data, sim, grid, waterfall_grid_results, pricing_basis, output_dir,
    )

    user_upfront_pct, user_tail_pct = _extract_upfront_tail_from_config(portfolio_config)
    user_up = round(user_upfront_pct * 100)
    user_tail = round(user_tail_pct * 100)
    user_ref_key = f"{user_up}_{user_tail}"

    # ── Common: risk section ──
    ref_key = user_ref_key if user_ref_key in ig_dict else next(iter(ig_dict), None)
    ref = ig_dict.get(ref_key, {}) if ref_key else {}

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

    grid_expected_xirrs = sorted(
        row.get("expected_xirr") or row.get("mean_xirr", 0.0)
        for row in ig_dict.values()
    )

    def _percentile(arr, p):
        if not arr:
            return 0.0
        k = (len(arr) - 1) * p
        lo = math.floor(k)
        hi = min(lo + 1, len(arr) - 1)
        frac = k - lo
        return arr[lo] + frac * (arr[hi] - arr[lo])

    existing_risk = data.get("risk", {}) or {}
    existing_concentration = existing_risk.get("concentration", {}) or {}

    if not existing_concentration.get("jurisdiction_breakdown") or not existing_concentration.get("type_breakdown"):
        total_soc = sum(float(row.get("soc_value_cr", 0.0) or 0.0) for row in claims_section)
        if total_soc > 0:
            jur_sums = {}
            type_sums = {}
            for row in claims_section:
                soc = float(row.get("soc_value_cr", 0.0) or 0.0)
                jurisdiction = (row.get("jurisdiction") or "").strip() or "unknown"
                claim_type = (row.get("claim_type") or row.get("archetype") or "").strip() or "unclassified"
                jur_sums[jurisdiction] = jur_sums.get(jurisdiction, 0.0) + soc
                type_sums[claim_type] = type_sums.get(claim_type, 0.0) + soc

            existing_concentration = {
                **existing_concentration,
                "jurisdiction_breakdown": {
                    k: round(v / total_soc, 4) for k, v in jur_sums.items()
                },
                "type_breakdown": {
                    k: round(v / total_soc, 4) for k, v in type_sums.items()
                },
                "herfindahl_by_jurisdiction": round(
                    sum((v / total_soc) ** 2 for v in jur_sums.values()), 4,
                ),
                "herfindahl_by_type": round(
                    sum((v / total_soc) ** 2 for v in type_sums.values()), 4,
                ),
            }

    if existing_concentration.get("jurisdiction_breakdown") and existing_concentration.get("herfindahl_by_jurisdiction") is None:
        existing_concentration["herfindahl_by_jurisdiction"] = round(
            sum(float(v) * float(v) for v in existing_concentration.get("jurisdiction_breakdown", {}).values()), 4,
        )
    if existing_concentration.get("type_breakdown") and existing_concentration.get("herfindahl_by_type") is None:
        existing_concentration["herfindahl_by_type"] = round(
            sum(float(v) * float(v) for v in existing_concentration.get("type_breakdown", {}).values()), 4,
        )
    new_risk = {
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
            "mean": round(ref.get("expected_xirr", ref.get("mean_xirr", 0.0)), 4),
            "mean_of_paths": round(ref.get("mean_xirr", 0.0), 4),
        },
        "concentration": {
            **existing_concentration,
            "mean_p_loss": round(ref.get("p_loss", 0.0), 4),
        },
    }
    data["risk"] = {**existing_risk, **new_risk}

    # ── Common: per-claim name propagation ──
    def _with_name(claim_id: str, payload: dict) -> dict:
        out = dict(payload)
        if not out.get("claim_id"):
            out["claim_id"] = claim_id
        if not out.get("name"):
            out["name"] = claim_name_map.get(claim_id, claim_id)
        return out

    investment_grid = data.get("investment_grid") or {}
    per_claim_grid = data.get("per_claim_grid") or {}

    contributions_by_key = {}
    if isinstance(per_claim_grid, dict):
        for cid, entries in per_claim_grid.items():
            if not isinstance(entries, list):
                continue
            for metrics in entries:
                if not isinstance(metrics, dict):
                    continue
                metrics.setdefault("claim_id", cid)
                metrics.setdefault("name", claim_name_map.get(cid, cid))
                up = round((metrics.get("upfront_pct", 0.0) or 0.0) * 100)
                tail = round((metrics.get("tata_tail_pct", 0.0) or 0.0) * 100)
                key = f"{up}_{tail}"
                contributions_by_key.setdefault(key, []).append(metrics)

    if isinstance(investment_grid, dict):
        for row in investment_grid.values():
            per_claim = row.get("per_claim")
            if isinstance(per_claim, dict):
                per_claim_contrib = []
                for cid, metrics in per_claim.items():
                    if isinstance(metrics, dict):
                        enriched = _with_name(cid, metrics)
                        per_claim[cid] = enriched
                        per_claim_contrib.append(enriched)
                row["per_claim_contributions"] = per_claim_contrib

        for key, row in investment_grid.items():
            if isinstance(row, dict) and not row.get("per_claim_contributions"):
                row["per_claim_contributions"] = contributions_by_key.get(key, [])

    cashflow_analysis = data.get("cashflow_analysis") or {}
    per_claim_rows = cashflow_analysis.get("per_claim")
    if isinstance(per_claim_rows, list):
        for row in per_claim_rows:
            if isinstance(row, dict):
                cid = row.get("claim_id") or row.get("id") or row.get("cid")
                if cid and not row.get("name"):
                    row["name"] = claim_name_map.get(cid, cid)

    per_claim_breakdowns = data.get("per_claim_breakdowns")
    if isinstance(per_claim_breakdowns, list):
        for row in per_claim_breakdowns:
            if isinstance(row, dict):
                cid = row.get("claim_id") or row.get("id") or row.get("cid")
                if cid and not row.get("name"):
                    row["name"] = claim_name_map.get(cid, cid)
    elif isinstance(per_claim_breakdowns, dict):
        for cid, row in per_claim_breakdowns.items():
            if isinstance(row, dict):
                if not row.get("claim_id"):
                    row["claim_id"] = cid
                if not row.get("name"):
                    row["name"] = claim_name_map.get(cid, cid)

    # ── Common: mc_distributions ──
    # Build histograms from ALL N per-path outcomes (not from the ~99
    # investment-grid aggregate means which only have one point per combo).

    def _histogram(values, n_bins=50):
        """Build histogram dict from a list of raw values."""
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

    def _convert_stochastic_hist(raw_hist):
        """Convert [{edge, count}, ...] format to {bins, counts, edges}."""
        if not raw_hist or len(raw_hist) < 2:
            return {"bins": [], "counts": [], "edges": []}
        edges = [entry["edge"] for entry in raw_hist]
        counts = [entry["count"] for entry in raw_hist[:-1]]  # last entry is trailing edge
        bins = [round((edges[i] + edges[i + 1]) / 2, 6) for i in range(len(counts))]
        return {"bins": bins, "counts": counts, "edges": edges}

    # Strategy: compute per-path MOIC / IRR / net recovery from sim.results
    # using the user-selected reference deal structure.
    # Investment = upfront + legal cost; Return = fund_share × collected.
    per_path_built = False
    try:
        from engine.v2_core.v2_cashflow_builder import build_cashflow_simple, portfolio_day_fracs
        from engine.v2_core.v2_metrics import compute_moic, compute_xirr_from_dayfrac

        n = sim.n_paths
        n_claims = len(sim.claim_ids)

        # Reference deal structure (from user config, with safe defaults)
        ref_upfront_pct = user_upfront_pct
        ref_tata_tail = user_tail_pct
        ref_fund_share = 1.0 - ref_tata_tail

        # Gather per-path claim configs
        claim_map = {}
        for cid in sim.claim_ids:
            for row in (data.get("claims") or []):
                if row.get("claim_id") == cid:
                    soc_cr = row.get("soc_value_cr", 0.0)
                    claim_map[cid] = soc_cr
                    break
            if cid not in claim_map:
                # Fallback: get from MI
                claim_map[cid] = getattr(MI, "SOC_VALUE_CR", 100.0)

        path_moics = []
        path_irrs = []
        path_net_recoveries = []
        path_durations = []

        for path_i in range(n):
            total_invested = 0.0
            total_return = 0.0
            max_dur = 0.0

            for cid in sim.claim_ids:
                p = sim.results[cid][path_i]
                soc_cr = claim_map.get(cid, 100.0)

                upfront = ref_upfront_pct * soc_cr
                upfront = max(upfront, 1e-6)
                legal_cost = p.legal_cost_total_cr
                collected = p.collected_cr
                inflow = ref_fund_share * collected

                total_invested += upfront + legal_cost
                total_return += inflow

                dur = p.total_duration_months
                if dur > max_dur:
                    max_dur = dur

            moic = total_return / total_invested if total_invested > 0 else 0.0
            net_rec = total_return - total_invested

            # Approximate IRR from MOIC and duration
            years = max_dur / 12.0
            if years > 0 and moic > 0:
                irr = moic ** (1.0 / years) - 1.0
            elif total_invested > 0 and total_return <= 0:
                irr = -1.0
            else:
                irr = 0.0

            path_moics.append(moic)
            path_irrs.append(irr)
            path_net_recoveries.append(net_rec)
            path_durations.append(max_dur)

        data["mc_distributions"] = {
            "moic": _histogram(path_moics),
            "irr": _histogram(path_irrs),
            "net_recovery": _histogram(path_net_recoveries),
            "duration": _histogram(path_durations),
            "n_paths": n,
            "expected_irr": round(ref.get("expected_xirr", ref.get("mean_xirr", 0.0)), 4),
        }
        per_path_built = True
        print(f"  mc_distributions: built from {n} per-path outcomes")
    except Exception as exc:
        print(f"  Warning: per-path mc_distributions failed ({exc}), using fallback")
        per_path_built = False

    if not per_path_built:
        # Try stochastic grid histograms (pre-binned from all MC paths)
        stoch_grid = (data.get("stochastic_pricing") or {}).get("grid", {})
        ref_combo_key = user_ref_key if user_ref_key in stoch_grid else next(iter(stoch_grid), None)
        ref_combo = stoch_grid.get(ref_combo_key) if ref_combo_key else None

        if ref_combo and ref_combo.get("moic_hist"):
            data["mc_distributions"] = {
                "moic": _convert_stochastic_hist(ref_combo["moic_hist"]),
                "irr": _convert_stochastic_hist(ref_combo.get("irr_hist", [])),
                "net_recovery": _convert_stochastic_hist(ref_combo.get("net_recovery_hist", [])),
                "duration": _convert_stochastic_hist(ref_combo.get("duration_hist", [])),
                "n_paths": sim.n_paths,
            }
        else:
            # Last fallback: investment-grid aggregate means
            all_net_returns = sorted(
                row.get("mean_net_return_cr", 0.0)
                for row in ig_dict.values()
                if row.get("mean_net_return_cr") is not None
            )
            data["mc_distributions"] = {
                "moic": _histogram(grid_moics),
                "irr": _histogram(grid_xirrs),
                "net_recovery": _histogram(all_net_returns),
                "n_paths": sim.n_paths,
            }

    # ── Structure-specific extra fields (sensitivity, jcurve, etc.) ──
    extra = handler.get_extra_dashboard_fields(sim, waterfall_grid_results)
    data.update(extra)

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

    Delegates structure-specific grid analysis to the appropriate
    StructureHandler, then runs universal exports (charts, Excel, PDF)
    and conditionally runs stochastic / sensitivity analysis.

    Returns a dict with grid results, stochastic data, etc.
    """
    from engine.structures import get_handler
    from engine.v2_core.v2_stochastic_pricing import (
        export_stochastic_grid,
        run_stochastic_grid,
    )
    from engine.v2_core.v2_pricing_surface import (
        run_pricing_surface,
        export_pricing_surface,
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
    if portfolio_config and portfolio_config.structure:
        structure_type = portfolio_config.structure.type

    handler = get_handler(structure_type)

    # ── Structure-specific grid analysis ──
    grid, extra = handler.run_grid_analysis(
        sim, claims, ctx, portfolio_config, output_dir,
    )
    result.update(extra)
    result["grid"] = grid

    waterfall_grid_results = extra.get("waterfall_grid")

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
    if handler.should_run_stochastic():
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
        print("\n  Skipping stochastic pricing grid (not applicable for " + structure_type + ")")

    # ── Pricing surface ──
    if handler.should_run_stochastic():
        try:
            print("\nComputing pricing surface...")
            t_surf = time.time()
            surface_data = run_pricing_surface(
                sim=sim, claims=v2_claims, pricing_basis=pricing_basis, ctx=ctx,
            )
            elapsed_surf = time.time() - t_surf
            print(f"  Pricing surface completed in {elapsed_surf:.1f}s")

            surface_path = os.path.join(output_dir, "pricing_surface.json")
            export_pricing_surface(surface_data, surface_path)
            result["pricing_surface"] = surface_data
        except Exception as exc:
            print(f"  Warning: pricing surface failed: {exc}")

    # ── Probability sensitivity ──
    prob_sensitivity = None
    if handler.should_run_prob_sensitivity():
        try:
            print("\nRunning probability sensitivity analysis...")
            prob_sensitivity = run_probability_sensitivity(
                sim, v2_claims, grid, pricing_basis=pricing_basis, ctx=ctx,
            )
            result["prob_sensitivity"] = prob_sensitivity
        except Exception as exc:
            print(f"  Warning: probability sensitivity failed: {exc}")
    else:
        print("  Skipping probability sensitivity (not applicable for " + structure_type + ")")

    # ── Correlation sensitivity ──
    correlation_sensitivity = None
    if handler.should_run_prob_sensitivity():
        try:
            print("\nRunning correlation sensitivity analysis...")
            from engine.v2_core.v2_correlation_sensitivity import run_correlation_sensitivity
            t_corr = time.time()
            correlation_sensitivity = run_correlation_sensitivity(
                sim, v2_claims, grid, pricing_basis=pricing_basis, ctx=ctx,
            )
            elapsed_corr = time.time() - t_corr
            print(f"  Correlation sensitivity completed in {elapsed_corr:.1f}s")
            result["correlation_sensitivity"] = correlation_sensitivity
        except Exception as exc:
            print(f"  Warning: correlation sensitivity failed: {exc}")
            import traceback; traceback.print_exc()
    else:
        print("  Skipping correlation sensitivity (not applicable for " + structure_type + ")")

    # ── Dashboard JSON ──
    try:
        export_dashboard_json(
            sim, v2_claims, grid,
            portfolio_config=portfolio_config,
            stochastic_results=stochastic_json,
            prob_sensitivity=prob_sensitivity,
            correlation_sensitivity=correlation_sensitivity,
            output_dir=output_dir, ctx=ctx,
        )
        print(f"  Dashboard JSON exported to {output_dir}/dashboard_data.json")

        # Post-process: add platform-compatible fields the V2 exporter doesn't produce
        _postprocess_dashboard_json(
            sim, grid, output_dir, pricing_basis,
            structure_type=structure_type,
            waterfall_grid_results=waterfall_grid_results,
            portfolio_config=portfolio_config,
        )

    except Exception as exc:
        import traceback
        print(f"  *** ERROR: dashboard JSON export failed: {exc}")
        traceback.print_exc()

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
