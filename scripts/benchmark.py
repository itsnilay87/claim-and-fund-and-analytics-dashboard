#!/usr/bin/env python3
"""
scripts/benchmark.py — Performance benchmark for Claim Analytics Platform engine.
==================================================================================

Usage:
    python scripts/benchmark.py

Benchmarks:
  1. 1,000-path simulation for 1 claim
  2. 1,000-path simulation for 6 claims
  3. 10,000-path simulation for 6 claims with full investment grid
  4. Verify 10,000-path run completes in < 5 minutes
"""

from __future__ import annotations

import sys
import time
from pathlib import Path

# Ensure engine is importable
_script_dir = Path(__file__).resolve().parent
_platform_dir = _script_dir.parent
if str(_platform_dir) not in sys.path:
    sys.path.insert(0, str(_platform_dir))

from engine.config.defaults import (
    DEFAULT_ARBITRATION_CONFIG,
    DEFAULT_QUANTUM_CONFIG,
    get_default_claim_config,
)
from engine.config.schema import (
    ClaimConfig,
    SimulationConfig,
)
from engine.jurisdictions.registry import JurisdictionRegistry
from engine.simulation.monte_carlo import (
    run_claim_simulation,
    run_portfolio_simulation,
    compute_claim_summary,
)


# ── Build realistic 6-claim TATA portfolio ──

CLAIM_DEFS = [
    ("TP-301-6", "Prolongation", "indian_domestic", 1532.0),
    ("TP-302-3", "Change of Law", "indian_domestic", 23.13),
    ("TP-302-5", "Prolongation", "indian_domestic", 491.99),
    ("TP-CTP11-2", "Scope Variation", "siac_singapore", 484.0),
    ("TP-CTP11-4", "Prolongation", "siac_singapore", 1368.0),
    ("TP-CTP13-2", "Prolongation", "siac_singapore", 1245.0),
]


def build_claims() -> list[ClaimConfig]:
    """Build 6 ClaimConfig objects matching the TATA portfolio."""
    claims = []
    for cid, name, jurisdiction, soc in CLAIM_DEFS:
        c = get_default_claim_config(jurisdiction)
        # Override key fields
        c = c.model_copy(update={
            "id": cid,
            "name": name,
            "soc_value_cr": soc,
        })
        claims.append(c)
    return claims


def build_templates(claims: list[ClaimConfig]) -> dict:
    """Load jurisdiction templates for all claims."""
    registry = JurisdictionRegistry()
    templates = {}
    for c in claims:
        if c.jurisdiction not in templates:
            templates[c.jurisdiction] = registry.get_template(c.jurisdiction)
    return templates


def fmt_time(seconds: float) -> str:
    if seconds < 1:
        return f"{seconds * 1000:.0f}ms"
    elif seconds < 60:
        return f"{seconds:.1f}s"
    else:
        m, s = divmod(seconds, 60)
        return f"{int(m)}m {s:.0f}s"


def run_benchmarks():
    print("=" * 70)
    print("  CLAIM ANALYTICS PLATFORM — Performance Benchmarks")
    print("=" * 70)
    print()

    claims = build_claims()
    templates = build_templates(claims)
    results = []

    # ── Benchmark 1: 1,000 paths × 1 claim ──
    print("Benchmark 1: 1,000 paths × 1 claim")
    claim1 = claims[0]
    t0 = time.perf_counter()
    paths = run_claim_simulation(claim1, templates[claim1.jurisdiction], 1000, seed=42)
    t1 = time.perf_counter()
    elapsed = t1 - t0
    results.append(("1K paths × 1 claim", elapsed, 1000))
    print(f"  Completed: {fmt_time(elapsed)} ({1000 / elapsed:,.0f} paths/sec)")
    print()

    # ── Benchmark 2: 1,000 paths × 6 claims ──
    print("Benchmark 2: 1,000 paths × 6 claims")
    t0 = time.perf_counter()
    all_paths = run_portfolio_simulation(claims, templates, 1000, seed=42)
    t1 = time.perf_counter()
    elapsed = t1 - t0
    total_paths = 1000 * len(claims)
    results.append(("1K paths × 6 claims", elapsed, total_paths))
    print(f"  Completed: {fmt_time(elapsed)} ({total_paths / elapsed:,.0f} claim-paths/sec)")
    print()

    # ── Benchmark 3: 10,000 paths × 6 claims + investment grid ──
    print("Benchmark 3: 10,000 paths × 6 claims + investment grid")

    t0 = time.perf_counter()

    # MC simulation
    print("  Running MC simulation...")
    t_mc_start = time.perf_counter()
    all_paths_10k = run_portfolio_simulation(claims, templates, 10000, seed=42)
    t_mc_end = time.perf_counter()
    mc_time = t_mc_end - t_mc_start
    print(f"    MC: {fmt_time(mc_time)}")

    # Claim summaries
    print("  Computing claim summaries...")
    t_cs_start = time.perf_counter()
    claim_summaries = {}
    for c in claims:
        claim_summaries[c.id] = compute_claim_summary(c, all_paths_10k[c.id])
    t_cs_end = time.perf_counter()
    summary_time = t_cs_end - t_cs_start
    print(f"    Summaries: {fmt_time(summary_time)}")

    # Investment grid (upfront_tail)
    print("  Computing investment grid (5 × 7 = 35 cells)...")
    from engine.analysis.investment_grid import evaluate_upfront_tail_grid
    t_grid_start = time.perf_counter()
    sim_config = SimulationConfig(
        n_paths=10000, seed=42, discount_rate=0.12,
        risk_free_rate=0.07, start_date="2026-04-30",
    )
    upfront_range = [0.05, 0.10, 0.15, 0.20, 0.25]
    tail_range = [0.10, 0.15, 0.20, 0.25, 0.30, 0.35, 0.40]
    grid_results = evaluate_upfront_tail_grid(
        claims, all_paths_10k,
        upfront_range=upfront_range,
        tail_range=tail_range,
        pricing_basis="soc",
        simulation_config=sim_config,
        start_date=sim_config.start_date,
    )
    t_grid_end = time.perf_counter()
    grid_time = t_grid_end - t_grid_start
    print(f"    Grid: {fmt_time(grid_time)}")

    # Risk metrics
    print("  Computing risk metrics...")
    from engine.analysis.risk_metrics import compute_portfolio_risk
    from engine.config.schema import PortfolioStructure, UpfrontTailParams
    t_risk_start = time.perf_counter()
    portfolio_structure = PortfolioStructure(
        type="monetisation_upfront_tail",
        params=UpfrontTailParams(upfront_pct=0.10, tail_pct=0.20),
    )
    risk_metrics = compute_portfolio_risk(
        claims, all_paths_10k, portfolio_structure, sim_config,
    )
    t_risk_end = time.perf_counter()
    risk_time = t_risk_end - t_risk_start
    print(f"    Risk: {fmt_time(risk_time)}")

    t1 = time.perf_counter()
    total_elapsed = t1 - t0
    total_paths = 10000 * len(claims)
    results.append(("10K paths × 6 claims + grid", total_elapsed, total_paths))
    print(f"  Total: {fmt_time(total_elapsed)} ({total_paths / total_elapsed:,.0f} claim-paths/sec)")
    print()

    # ── Results Table ──
    print("=" * 70)
    print("  BENCHMARK RESULTS")
    print("=" * 70)
    print()
    print(f"  {'Benchmark':<30} {'Time':>10} {'Paths':>10} {'Rate':>15}")
    print(f"  {'-' * 30} {'-' * 10} {'-' * 10} {'-' * 15}")
    for name, elapsed, paths in results:
        rate = f"{paths / elapsed:,.0f} p/s"
        print(f"  {name:<30} {fmt_time(elapsed):>10} {paths:>10,} {rate:>15}")
    print()

    # ── Verify < 5 minute threshold ──
    full_run = results[-1]
    max_seconds = 300  # 5 minutes
    if full_run[1] < max_seconds:
        print(f"  ✓ PASS: 10K×6 completed in {fmt_time(full_run[1])} (< 5 min threshold)")
    else:
        print(f"  ✗ FAIL: 10K×6 took {fmt_time(full_run[1])} (exceeds 5 min threshold)")
        sys.exit(1)

    print()
    print("  Benchmark complete.")


if __name__ == "__main__":
    run_benchmarks()
