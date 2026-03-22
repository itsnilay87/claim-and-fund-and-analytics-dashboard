#!/usr/bin/env python3
"""
TATA_code_v2/v2_audit.py — Comprehensive numerical verification.
=================================================================

Runs five audit categories:
  A. Probability tree verification (analytical)
  B. Monte Carlo convergence (N=50000)
  C. Cashflow vector sanity
  D. XIRR edge cases
  E. Investment grid consistency (monotonicity)

Usage:
    python -m TATA_code_v2.v2_audit
    python TATA_code_v2/v2_audit.py
"""

from __future__ import annotations

import math
import os
import sys
import time
from datetime import datetime

import numpy as np

# Ensure project root on path
_project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _project_root not in sys.path:
    sys.path.insert(0, _project_root)

from . import v2_master_inputs as MI
from .v2_config import build_claim_configs, ClaimConfig
from .v2_probability_tree import (
    simulate_domestic_challenge,
    simulate_siac_challenge,
)
from .v2_quantum_model import (
    draw_quantum,
    compute_expected_quantum,
    expected_quantum_pct,
)
from .v2_timeline_model import draw_pipeline_duration
from .v2_monte_carlo import run_simulation, simulate_one_path
from .v2_cashflow_builder import build_cashflow
from .v2_metrics import (
    compute_xirr,
    compute_moic,
    compute_net_return,
)
from .v2_legal_cost_model import (
    load_legal_costs,
    get_onetime_costs,
    compute_stage_cost,
    build_monthly_legal_costs,
)
from .v2_investment_analysis import analyze_investment_grid


# ───────────────────────────────────────────────────────────────────
# Helpers
# ───────────────────────────────────────────────────────────────────

_checks_run = 0
_checks_pass = 0
_checks_fail = 0


def _check(name: str, condition: bool, detail: str = "") -> bool:
    """Record a PASS/FAIL check."""
    global _checks_run, _checks_pass, _checks_fail
    _checks_run += 1
    if condition:
        _checks_pass += 1
        print(f"  [PASS] {name}")
    else:
        _checks_fail += 1
        msg = f"  [FAIL] {name}"
        if detail:
            msg += f"  ({detail})"
        print(msg)
    return condition


def _check_close(name: str, actual: float, expected: float,
                 tol: float = 0.01) -> bool:
    """Check that actual ≈ expected within tolerance."""
    ok = abs(actual - expected) <= tol
    detail = f"actual={actual:.6f}, expected={expected:.6f}, tol={tol}"
    return _check(name, ok, detail)


# ===================================================================
# A. PROBABILITY TREE VERIFICATION (analytical, no simulation)
# ===================================================================

def audit_probability_trees() -> bool:
    """Analytically verify all probability tree sums and per-outcome totals."""
    print("\n" + "=" * 70)
    print("A. PROBABILITY TREE VERIFICATION (Analytical)")
    print("=" * 70)

    all_ok = True
    TOL = 1e-4

    # ── Domestic Scenario A ──
    dom_a_tw = sum(p["conditional_prob"] for p in MI.DOMESTIC_PATHS_A
                   if p["outcome"] == "TRUE_WIN")
    dom_a_lo = sum(p["conditional_prob"] for p in MI.DOMESTIC_PATHS_A
                   if p["outcome"] == "LOSE")
    dom_a_re = sum(p["conditional_prob"] for p in MI.DOMESTIC_PATHS_A
                   if p["outcome"] == "RESTART")
    dom_a_total = sum(p["conditional_prob"] for p in MI.DOMESTIC_PATHS_A)

    all_ok &= _check_close("Domestic A: TRUE_WIN = 73.60%",
                           dom_a_tw, 0.7360, TOL)
    all_ok &= _check_close("Domestic A: LOSE = 26.40%",
                           dom_a_lo, 0.2640, TOL)
    all_ok &= _check_close("Domestic A: RESTART = 0.00%",
                           dom_a_re, 0.0, TOL)
    all_ok &= _check_close("Domestic A: sum = 100%",
                           dom_a_total, 1.0, TOL)

    # ── Domestic Scenario B ──
    dom_b_re = sum(p["conditional_prob"] for p in MI.DOMESTIC_PATHS_B
                   if p["outcome"] == "RESTART")
    dom_b_lo = sum(p["conditional_prob"] for p in MI.DOMESTIC_PATHS_B
                   if p["outcome"] == "LOSE")
    dom_b_total = sum(p["conditional_prob"] for p in MI.DOMESTIC_PATHS_B)

    all_ok &= _check_close("Domestic B: RESTART = 29.66%",
                           dom_b_re, 0.2966, TOL)
    all_ok &= _check_close("Domestic B: LOSE = 70.34%",
                           dom_b_lo, 0.7034, TOL)
    all_ok &= _check_close("Domestic B: sum = 100%",
                           dom_b_total, 1.0, TOL)

    # ── SIAC Scenario A ──
    siac_a_tw = sum(p["conditional_prob"] for p in MI.SIAC_PATHS_A
                    if p["outcome"] == "TRUE_WIN")
    siac_a_lo = sum(p["conditional_prob"] for p in MI.SIAC_PATHS_A
                    if p["outcome"] == "LOSE")
    siac_a_re = sum(p["conditional_prob"] for p in MI.SIAC_PATHS_A
                    if p["outcome"] == "RESTART")
    siac_a_total = sum(p["conditional_prob"] for p in MI.SIAC_PATHS_A)

    all_ok &= _check_close("SIAC A: TRUE_WIN = 76.25%",
                           siac_a_tw, 0.7625, TOL)
    all_ok &= _check_close("SIAC A: LOSE = 23.75%",
                           siac_a_lo, 0.2375, TOL)
    all_ok &= _check_close("SIAC A: RESTART = 0.00%",
                           siac_a_re, 0.0, TOL)
    all_ok &= _check_close("SIAC A: sum = 100%",
                           siac_a_total, 1.0, TOL)

    # ── SIAC Scenario B ──
    siac_b_re = sum(p["conditional_prob"] for p in MI.SIAC_PATHS_B
                    if p["outcome"] == "RESTART")
    siac_b_lo = sum(p["conditional_prob"] for p in MI.SIAC_PATHS_B
                    if p["outcome"] == "LOSE")
    siac_b_total = sum(p["conditional_prob"] for p in MI.SIAC_PATHS_B)

    all_ok &= _check_close("SIAC B: RESTART = 41.25%",
                           siac_b_re, 0.4125, TOL)
    all_ok &= _check_close("SIAC B: LOSE = 58.75%",
                           siac_b_lo, 0.5875, TOL)
    all_ok &= _check_close("SIAC B: sum = 100%",
                           siac_b_total, 1.0, TOL)

    # ── Combined domestic: P(arb_win) × P(outcome|A) + P(arb_lose) × P(outcome|B) ──
    p_win = MI.ARB_WIN_PROBABILITY    # 0.70
    p_lose = 1 - p_win                # 0.30

    dom_combined_tw = p_win * dom_a_tw + p_lose * 0.0
    dom_combined_re = p_win * dom_a_re + p_lose * dom_b_re
    dom_combined_lo = p_win * dom_a_lo + p_lose * dom_b_lo

    all_ok &= _check_close("Combined domestic: TRUE_WIN = 51.52%",
                           dom_combined_tw, 0.5152, 0.005)
    all_ok &= _check_close("Combined domestic: RESTART = 8.90%",
                           dom_combined_re, 0.08898, 0.005)
    all_ok &= _check_close("Combined domestic: LOSE = 39.58%",
                           dom_combined_lo, 0.3958, 0.005)

    # ── Combined SIAC ──
    siac_combined_tw = p_win * siac_a_tw + p_lose * 0.0
    siac_combined_re = p_win * siac_a_re + p_lose * siac_b_re
    siac_combined_lo = p_win * siac_a_lo + p_lose * siac_b_lo

    all_ok &= _check_close("Combined SIAC: TRUE_WIN = 53.375%",
                           siac_combined_tw, 0.53375, 0.005)
    all_ok &= _check_close("Combined SIAC: RESTART = 12.375%",
                           siac_combined_re, 0.12375, 0.005)
    all_ok &= _check_close("Combined SIAC: LOSE = 34.25%",
                           siac_combined_lo, 0.34250, 0.005)

    # ── After re-arb: RESTART paths get another ARB_WIN draw,
    #    then must survive Scenario A challenge tree ──
    re_arb_win = MI.RE_ARB_WIN_PROBABILITY  # 0.70

    # P(TRUE_WIN | Sc.A) for each jurisdiction
    dom_tw_given_a = dom_a_tw   # P(TRUE_WIN | domestic Sc.A) = 0.7360
    siac_tw_given_a = siac_a_tw  # P(TRUE_WIN | SIAC Sc.A) = 0.8200

    # Effective win = direct TRUE_WIN + RESTART × re_arb_win × P(TW|Sc.A)
    dom_eff_win = dom_combined_tw + dom_combined_re * re_arb_win * dom_tw_given_a
    siac_eff_win = siac_combined_tw + siac_combined_re * re_arb_win * siac_tw_given_a

    all_ok &= _check(
        f"After re-arb domestic: effective_win ~= 56% (got {dom_eff_win:.1%})",
        0.50 < dom_eff_win < 0.62,
        f"actual={dom_eff_win:.4f}"
    )
    all_ok &= _check(
        f"After re-arb SIAC: effective_win ~= 65% (got {siac_eff_win:.1%})",
        0.58 < siac_eff_win < 0.70,
        f"actual={siac_eff_win:.4f}"
    )

    # ── Quantum bands sum to 1.0 ──
    qb_total = sum(b["probability"] for b in MI.QUANTUM_BANDS)
    all_ok &= _check_close("Quantum bands: prob sum = 1.0",
                           qb_total, 1.0, TOL)

    # ── E[Q|WIN] analytical ──
    eq_pct = expected_quantum_pct()
    all_ok &= _check_close("E[Q|WIN] = 72.00% of SOC",
                           eq_pct, 0.7200, 0.001)

    return all_ok


# ===================================================================
# B. MONTE CARLO CONVERGENCE CHECK
# ===================================================================

def audit_mc_convergence(n: int = 50000, seed: int = 42) -> bool:
    """Run large-N simulation and check convergence to analytical values."""
    print("\n" + "=" * 70)
    print(f"B. MONTE CARLO CONVERGENCE CHECK (N={n:,})")
    print("=" * 70)

    claims = build_claim_configs()
    t0 = time.time()
    print(f"  Running {n:,} MC paths...")
    sim = run_simulation(n=n, seed=seed, claims=claims)
    elapsed = time.time() - t0
    print(f"  Completed in {elapsed:.1f}s")

    all_ok = True

    # Expected analytical values for each claim
    p_arb = MI.ARB_WIN_PROBABILITY

    for claim in claims:
        cid = claim.claim_id
        paths = sim.results[cid]

        # ── P(arb_win) convergence ──
        p_arb_mc = sum(1 for p in paths if p.arb_won) / n
        all_ok &= _check_close(
            f"{cid}: P(arb_win) -> {p_arb:.0%}",
            p_arb_mc, p_arb, 0.01
        )

        # ── Pre-challenge TRUE_WIN rate ──
        # For domestic: P(TW|A) = 0.7360, combined = 0.70 × 0.7360 = 0.5152
        # For SIAC: P(TW|A) = 0.7625, combined = 0.70 × 0.7625 = 0.53375
        n_tw_pre = sum(1 for p in paths if p.challenge.outcome == "TRUE_WIN")
        p_tw_pre = n_tw_pre / n

        if claim.jurisdiction == "domestic":
            expected_tw_pre = p_arb * 0.7360
        else:
            expected_tw_pre = p_arb * 0.7625

        all_ok &= _check_close(
            f"{cid}: P(TW pre-reArb) -> {expected_tw_pre:.1%}",
            p_tw_pre, expected_tw_pre, 0.015
        )

        # ── E[Q|WIN] = 72.00% of SOC ──
        quanta = [p.quantum.quantum_cr for p in paths
                  if p.arb_won and p.quantum is not None]
        if quanta:
            eq_mc = np.mean(quanta)
            eq_expected = claim.soc_value_cr * 0.7200
            eq_pct_mc = eq_mc / claim.soc_value_cr
            all_ok &= _check_close(
                f"{cid}: E[Q|WIN] -> 72.00% of SOC",
                eq_pct_mc, 0.7200, 0.01
            )

        # ── E[timeline] is reasonable ──
        durations = [p.total_duration_months for p in paths]
        e_dur = np.mean(durations)
        all_ok &= _check(
            f"{cid}: E[duration] = {e_dur:.1f}m (reasonable: 30-96m)",
            30 < e_dur < 96,
            f"actual={e_dur:.1f}"
        )

    return all_ok


# ===================================================================
# C. CASHFLOW VECTOR SANITY
# ===================================================================

def audit_cashflow_vectors(n: int = 1000, seed: int = 42) -> bool:
    """Verify cashflow vectors for structural correctness."""
    print("\n" + "=" * 70)
    print(f"C. CASHFLOW VECTOR SANITY (N={n:,})")
    print("=" * 70)

    claims = build_claim_configs()
    claim_map = {c.claim_id: c for c in claims}

    sim = run_simulation(n=n, seed=seed, claims=claims)

    all_ok = True
    upfront_pct = 0.10
    award_share = 0.40

    n_checked = 0
    n_outflow_fail = 0
    n_inflow_fail = 0
    n_moic_fail = 0

    rng = np.random.default_rng(99)
    sample_indices = rng.choice(n, size=min(100, n), replace=False)

    for cid in sim.claim_ids:
        claim = claim_map[cid]
        paths = sim.results[cid]

        for idx in sample_indices:
            p = paths[idx]
            burn = p.monthly_legal_burn if p.monthly_legal_burn is not None else np.zeros(1)

            dates, cfs, total_invested, total_return = build_cashflow(
                claim=claim,
                total_duration_months=p.total_duration_months,
                quantum_received_cr=p.collected_cr,
                monthly_legal_burn=burn,
                upfront_pct=upfront_pct,
                award_share_pct=award_share,
                pricing_basis="soc",
            )

            n_checked += 1

            # Check 1: At least one outflow (month-0 must be negative)
            if cfs[0] >= 0:
                n_outflow_fail += 1

            # Check 2: TRUE_WIN paths should have positive final inflow
            if p.final_outcome == "TRUE_WIN":
                has_inflow = any(cf > 0 for cf in cfs)
                if not has_inflow:
                    n_inflow_fail += 1

            # Check 3: LOSE paths should have zero inflows
            if p.final_outcome == "LOSE":
                has_inflow = any(cf > 0 for cf in cfs)
                if has_inflow:
                    n_inflow_fail += 1

            # Check 4: MOIC = total_return / total_invested
            if total_invested > 0:
                moic_check = total_return / total_invested
                moic_computed = compute_moic(total_invested, total_return)
                if abs(moic_check - moic_computed) > 1e-6:
                    n_moic_fail += 1

    all_ok &= _check(
        f"Month-0 always negative outflow ({n_checked} paths checked)",
        n_outflow_fail == 0,
        f"{n_outflow_fail} failures"
    )
    all_ok &= _check(
        f"TRUE_WIN has inflow, LOSE has none ({n_checked} paths)",
        n_inflow_fail == 0,
        f"{n_inflow_fail} failures"
    )
    all_ok &= _check(
        f"MOIC = return/invested for 100 random paths",
        n_moic_fail == 0,
        f"{n_moic_fail} failures"
    )

    # Check 5: total_invested = upfront + sum(legal costs)
    # Just verify for one path
    s_claim = claims[0]
    s_path = sim.results[s_claim.claim_id][0]
    s_burn = s_path.monthly_legal_burn if s_path.monthly_legal_burn is not None else np.zeros(1)
    _, _, s_invested, _ = build_cashflow(
        claim=s_claim,
        total_duration_months=s_path.total_duration_months,
        quantum_received_cr=s_path.collected_cr,
        monthly_legal_burn=s_burn,
        upfront_pct=upfront_pct,
        award_share_pct=award_share,
    )
    expected_upfront = upfront_pct * s_claim.soc_value_cr
    # Total invested should include upfront + spread legal costs
    all_ok &= _check(
        f"total_invested >= upfront ({s_invested:.2f} >= {expected_upfront:.2f})",
        s_invested >= expected_upfront - 1e-6,
    )

    # Check 6: Cashflow dates are month-end from START_DATE
    start = datetime.strptime(MI.START_DATE, "%Y-%m-%d")
    s_claim = claims[0]
    s_path = sim.results[s_claim.claim_id][0]
    s_burn = s_path.monthly_legal_burn if s_path.monthly_legal_burn is not None else np.zeros(1)
    dates, _, _, _ = build_cashflow(
        claim=s_claim,
        total_duration_months=s_path.total_duration_months,
        quantum_received_cr=s_path.collected_cr,
        monthly_legal_burn=s_burn,
        upfront_pct=upfront_pct,
        award_share_pct=award_share,
    )
    # First date should be April 30 (end of April)
    all_ok &= _check(
        f"First cashflow date = {dates[0].strftime('%Y-%m-%d')} (expected month-end of {MI.START_DATE})",
        dates[0].day >= 28,
        f"day={dates[0].day}"
    )

    return all_ok


# ===================================================================
# D. XIRR EDGE CASES
# ===================================================================

def audit_xirr_edge_cases() -> bool:
    """Verify XIRR handles edge cases correctly."""
    print("\n" + "=" * 70)
    print("D. XIRR EDGE CASES")
    print("=" * 70)

    all_ok = True

    # Case 1: All-loss path → XIRR = -100%
    dates_loss = [
        datetime(2026, 4, 30),
        datetime(2026, 5, 31),
        datetime(2026, 6, 30),
        datetime(2031, 4, 30),
    ]
    cfs_loss = [-100.0, -5.0, -5.0, 0.0]
    xirr_loss = compute_xirr(dates_loss, cfs_loss)
    all_ok &= _check(
        f"All-loss path: XIRR = {xirr_loss:.1%} (expected -100%)",
        xirr_loss <= -0.99,
        f"xirr={xirr_loss:.4f}"
    )

    # Case 2: Known cashflow — invest 100, receive 150 after 1 year
    dates_good = [datetime(2026, 4, 30), datetime(2027, 4, 30)]
    cfs_good = [-100.0, 150.0]
    xirr_good = compute_xirr(dates_good, cfs_good)
    expected_xirr = 0.50  # 50% return
    all_ok &= _check_close(
        f"Invest 100 receive 150 at t=1yr: XIRR = {xirr_good:.1%} (expected 50%)",
        xirr_good, expected_xirr, 0.005
    )

    # Case 3: Short TRUE_WIN → high XIRR
    # Invest 100, receive 300 after 6 months
    dates_short = [datetime(2026, 4, 30), datetime(2026, 10, 31)]
    cfs_short = [-100.0, 300.0]
    xirr_short = compute_xirr(dates_short, cfs_short)
    all_ok &= _check(
        f"Short win (6m, 3x): XIRR = {xirr_short:.0%} (expected very high)",
        xirr_short > 3.0,
        f"xirr={xirr_short:.4f}"
    )

    # Case 4: Verify XIRR is annualized
    # Invest 100, receive 110 after 2 years → ~4.88% annual
    dates_2yr = [datetime(2026, 4, 30), datetime(2028, 4, 30)]
    cfs_2yr = [-100.0, 110.0]
    xirr_2yr = compute_xirr(dates_2yr, cfs_2yr)
    expected_2yr = (110.0 / 100.0) ** (1.0 / 2.0) - 1.0  # ~4.88%
    all_ok &= _check_close(
        f"2yr 10% total return: XIRR = {xirr_2yr:.2%} (expected {expected_2yr:.2%})",
        xirr_2yr, expected_2yr, 0.005
    )

    # Case 5: invest 100, receive 100 after 3 years → XIRR = 0%
    dates_zero = [datetime(2026, 4, 30), datetime(2029, 4, 30)]
    cfs_zero = [-100.0, 100.0]
    xirr_zero = compute_xirr(dates_zero, cfs_zero)
    all_ok &= _check_close(
        f"Break-even (3yr): XIRR = {xirr_zero:.2%} (expected 0%)",
        xirr_zero, 0.0, 0.005
    )

    return all_ok


# ===================================================================
# E. INVESTMENT GRID CONSISTENCY
# ===================================================================

def audit_investment_grid(n: int = 2000, seed: int = 42) -> bool:
    """Verify monotonicity and consistency of investment grid."""
    print("\n" + "=" * 70)
    print(f"E. INVESTMENT GRID CONSISTENCY (N={n:,})")
    print("=" * 70)

    claims = build_claim_configs()
    sim = run_simulation(n=n, seed=seed, claims=claims)
    grid = analyze_investment_grid(sim, claims, pricing_bases=["soc"])

    all_ok = True

    # Check 1: Higher upfront → lower MOIC (monotonic, at each award share)
    n_mono_violations_up = 0
    for award in MI.AWARD_SHARE_PCT:
        prev_moic = None
        for upfront in MI.UPFRONT_PCT_SOC:
            key = (upfront, award, "soc")
            if key in grid.cells:
                moic = grid.cells[key].mean_moic
                if prev_moic is not None and moic > prev_moic + 0.01:
                    n_mono_violations_up += 1
                prev_moic = moic

    all_ok &= _check(
        f"Higher upfront -> lower MOIC (monotonic) [{n_mono_violations_up} violations]",
        n_mono_violations_up == 0,
        f"{n_mono_violations_up} violations"
    )

    # Check 2: Higher award_share → higher MOIC (at each upfront)
    n_mono_violations_award = 0
    for upfront in MI.UPFRONT_PCT_SOC:
        prev_moic = None
        for award in MI.AWARD_SHARE_PCT:
            key = (upfront, award, "soc")
            if key in grid.cells:
                moic = grid.cells[key].mean_moic
                if prev_moic is not None and moic < prev_moic - 0.01:
                    n_mono_violations_award += 1
                prev_moic = moic

    all_ok &= _check(
        f"Higher award_share -> higher MOIC (monotonic) [{n_mono_violations_award} violations]",
        n_mono_violations_award == 0,
        f"{n_mono_violations_award} violations"
    )

    # Check 3: Grid has correct dimensions
    n_cells_soc = sum(
        1 for k in grid.cells if k[2] == "soc"
    )
    expected_cells = len(MI.UPFRONT_PCT_SOC) * len(MI.AWARD_SHARE_PCT)
    all_ok &= _check(
        f"Grid dimensions: {n_cells_soc} SOC cells (expected {expected_cells})",
        n_cells_soc == expected_cells
    )

    # Check 4: Breakeven surface exists
    all_ok &= _check(
        "Breakeven surface computed for SOC",
        "soc" in grid.breakeven and len(grid.breakeven["soc"]) > 0,
    )

    # Check 5: Lower upfront → higher P(loss) at same award share
    # (higher upfront = more invested, may still lose everything)
    # Actually: higher upfront → higher P(loss) because more capital at risk
    # with potentially same expected inflows.
    # Wait — higher upfront → lower MOIC → higher P(loss). Let's verify.
    n_ploss_violations = 0
    for award in MI.AWARD_SHARE_PCT:
        prev_ploss = None
        for upfront in MI.UPFRONT_PCT_SOC:
            key = (upfront, award, "soc")
            if key in grid.cells:
                ploss = grid.cells[key].p_loss
                if prev_ploss is not None and ploss < prev_ploss - 0.02:
                    n_ploss_violations += 1
                prev_ploss = ploss

    all_ok &= _check(
        f"Higher upfront -> higher P(loss) [{n_ploss_violations} violations]",
        n_ploss_violations == 0,
        f"{n_ploss_violations} violations"
    )

    # Check 6: EQ-based upfront < SOC-based upfront (if both computed)
    # Since E[Q] < SOC, upfront_eq = pct × E[Q] < pct × SOC = upfront_soc.
    eq_pct = expected_quantum_pct()
    all_ok &= _check(
        f"E[Q|WIN] = {eq_pct:.4f} < 1.0 (so EQ upfront < SOC upfront)",
        eq_pct < 1.0,
    )

    # Check 7: All MOICs non-negative
    n_neg = sum(1 for c in grid.cells.values() if c.mean_moic < 0)
    all_ok &= _check(
        f"All E[MOIC] >= 0 ({n_neg} negative)",
        n_neg == 0,
    )

    # Check 8: Best scenario = lowest upfront, highest award share
    best_key = (MI.UPFRONT_PCT_SOC[0], MI.AWARD_SHARE_PCT[-1], "soc")
    worst_key = (MI.UPFRONT_PCT_SOC[-1], MI.AWARD_SHARE_PCT[0], "soc")
    if best_key in grid.cells and worst_key in grid.cells:
        all_ok &= _check(
            f"Best cell (5%/75%) MOIC > worst cell (30%/25%) MOIC",
            grid.cells[best_key].mean_moic > grid.cells[worst_key].mean_moic,
        )

    return all_ok


# ===================================================================
# F. LEGAL COST MODEL VERIFICATION
# ===================================================================

def verify_legal_costs() -> bool:
    """Verify legal cost calculations with the new model."""
    print("\n" + "=" * 70)
    print("F. LEGAL COST MODEL VERIFICATION")
    print("=" * 70)

    all_ok = True

    # Test 1: One-time costs
    onetime = get_onetime_costs()
    all_ok &= _check_close(
        "One-time costs = ₹8.0 Cr (tribunal ₹6 + expert ₹2)",
        onetime, 8.0, 0.001
    )

    # Test 2: DAB cost (midpoint of 0.005-0.01 = 0.0075)
    dab_cost = compute_stage_cost("dab", duration_months=9.0)
    expected_dab = 0.0075  # midpoint of {low: 0.005, high: 0.01}
    all_ok &= _check_close(
        f"DAB cost = ₹{dab_cost:.4f} Cr (expected ~₹0.0075 Cr)",
        dab_cost, expected_dab, 0.001
    )

    # Test 3: Arbitration cost (fixed ₹8Cr)
    arb_cost = compute_stage_cost("arbitration", duration_months=22.0)
    all_ok &= _check_close(
        f"Arbitration cost = ₹{arb_cost:.2f} Cr (expected ₹8.0 Cr)",
        arb_cost, 8.0, 0.001
    )

    # Test 4: S.34 cost (midpoint of 2.0-3.0 = 2.5)
    s34_cost = compute_stage_cost("s34", duration_months=14.0)
    all_ok &= _check_close(
        f"S.34 cost = ₹{s34_cost:.2f} Cr (expected ₹2.5 Cr)",
        s34_cost, 2.5, 0.001
    )

    # Test 5: S.37 cost (midpoint of 1.0-2.0 = 1.5)
    s37_cost = compute_stage_cost("s37", duration_months=9.0)
    all_ok &= _check_close(
        f"S.37 cost = ₹{s37_cost:.2f} Cr (expected ₹1.5 Cr)",
        s37_cost, 1.5, 0.001
    )

    # Test 6: SLP dismissed cost (~₹75L = 0.0075 Cr)
    slp_dism = compute_stage_cost("slp", duration_months=4, slp_admitted=False)
    all_ok &= _check(
        f"SLP dismissed = ₹{slp_dism:.4f} Cr (expected ≤ ₹0.01 Cr)",
        slp_dism < 0.1,
        f"actual={slp_dism:.4f}"
    )

    # Test 7: SLP admitted cost (~₹2.5 Cr)
    slp_adm = compute_stage_cost("slp", duration_months=24, slp_admitted=True)
    all_ok &= _check(
        f"SLP admitted = ₹{slp_adm:.2f} Cr (expected > ₹2 Cr)",
        slp_adm > 2.0,
        f"actual={slp_adm:.4f}"
    )

    # Test 8: SIAC HC cost (midpoint of 3.0-4.0 = 3.5)
    hc_cost = compute_stage_cost("hc", duration_months=6.0)
    all_ok &= _check_close(
        f"SIAC HC cost = ₹{hc_cost:.2f} Cr (expected ₹3.5 Cr)",
        hc_cost, 3.5, 0.001
    )

    # Test 9: SIAC COA cost (fixed ₹2Cr)
    coa_cost = compute_stage_cost("coa", duration_months=6.0)
    all_ok &= _check_close(
        f"SIAC COA cost = ₹{coa_cost:.2f} Cr (expected ₹2.0 Cr)",
        coa_cost, 2.0, 0.001
    )

    # Test 10: Full monthly vector for domestic claim (SLP dismissed)
    stage_durations = {
        "dab": 9.0,
        "arbitration": 22.0,
        "s34": 14.0,
        "s37": 9.0,
        "slp": 4.0,
    }
    monthly, total = build_monthly_legal_costs(
        "TP-301-6", stage_durations, slp_admitted=False
    )

    # Expected total (deterministic, no overrun):
    # One-time: 8.0
    # DAB: 0.0075
    # Arb: 8.0
    # S.34: 2.5
    # S.37: 1.5
    # SLP dismissed: 0.0075
    expected_total = 8.0 + 0.0075 + 8.0 + 2.5 + 1.5 + 0.0075
    all_ok &= _check_close(
        f"Total legal cost (domestic, SLP dismissed): "
        f"₹{total:.4f} Cr (expected ₹{expected_total:.4f} Cr)",
        total, expected_total, 0.1
    )

    # Test 11: Month-0 should equal one-time costs
    all_ok &= _check_close(
        f"Month-0 = one-time costs = ₹{monthly[0]:.2f} Cr",
        monthly[0], 8.0, 0.001
    )

    # Test 12: Monthly vector has correct length
    expected_len = int(np.ceil(sum(stage_durations.values()))) + 1
    all_ok &= _check(
        f"Monthly vector length = {len(monthly)} (expected ~{expected_len})",
        abs(len(monthly) - expected_len) <= 1,
        f"actual={len(monthly)}"
    )

    # Test 13: Full monthly vector for SIAC claim
    siac_stages = {
        "dab": 9.0,
        "arbitration": 22.0,
        "hc": 6.0,
        "coa": 6.0,
    }
    monthly_siac, total_siac = build_monthly_legal_costs(
        "TP-CTP11-4", siac_stages, slp_admitted=None
    )
    # Expected: 8.0 + 0.0075 + 8.0 + 3.5 + 2.0 = 21.5075
    expected_siac = 8.0 + 0.0075 + 8.0 + 3.5 + 2.0
    all_ok &= _check_close(
        f"Total legal cost (SIAC): "
        f"₹{total_siac:.4f} Cr (expected ₹{expected_siac:.4f} Cr)",
        total_siac, expected_siac, 0.1
    )

    # Test 14: SLP admitted vs dismissed cost difference
    stage_dur_admitted = dict(stage_durations)
    stage_dur_admitted["slp"] = 24.0
    _, total_admitted = build_monthly_legal_costs(
        "TP-301-6", stage_dur_admitted, slp_admitted=True
    )
    cost_diff = total_admitted - total
    all_ok &= _check(
        f"SLP admitted costs ₹{cost_diff:.2f} Cr more than dismissed",
        cost_diff > 2.0,
        f"diff={cost_diff:.4f}"
    )

    if all_ok:
        print("\n  ✓ All legal cost verification checks passed")
    else:
        print("\n  ✗ Some legal cost verification checks failed")

    return all_ok


# ===================================================================
# MAIN
# ===================================================================

def main() -> None:
    """Run all audits and print summary."""
    print("=" * 70)
    print("TATA V2 — COMPREHENSIVE NUMERICAL AUDIT")
    print("=" * 70)

    t0 = time.time()

    a = audit_probability_trees()
    f = verify_legal_costs()
    b = audit_mc_convergence(n=50000, seed=42)
    c = audit_cashflow_vectors(n=1000, seed=42)
    d = audit_xirr_edge_cases()
    e = audit_investment_grid(n=2000, seed=42)

    elapsed = time.time() - t0

    print("\n" + "=" * 70)
    print(f"AUDIT SUMMARY: {_checks_pass}/{_checks_run} checks passed, "
          f"{_checks_fail} failed")
    print(f"Total audit time: {elapsed:.1f}s")
    if _checks_fail == 0:
        print("ALL CHECKS PASSED")
    else:
        print(f"WARNING: {_checks_fail} CHECK(S) FAILED — review output above")
    print("=" * 70)


if __name__ == "__main__":
    main()
