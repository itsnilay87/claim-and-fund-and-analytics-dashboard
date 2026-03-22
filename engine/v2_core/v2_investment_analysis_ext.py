"""
v2_investment_analysis_ext.py — Investment analysis for new structures.
=======================================================================

Grid/sensitivity analysis functions for Litigation Funding, Full Purchase,
Staged Payments, and Comparative structures.  Runs alongside the existing
upfront+tail analysis in v2_investment_analysis.py.

All monetary values in ₹ Crore.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

import numpy as np

from . import v2_master_inputs as MI
from .v2_config import ClaimConfig, PathResult, SimulationResults
from .v2_cashflow_builder import (
    merge_dated_cashflows,
    _month_end,
    _parse_start_date,
)
from .v2_cashflow_builder_ext import (
    build_litigation_funding_cashflow,
    build_full_purchase_cashflow,
    build_staged_payment_cashflow,
    build_comparative_cashflows,
    _get_path_legal_burn,
    _max_payment_month,
    _total_collected,
    _any_claim_wins,
    _milestone_month,
    _milestone_triggered,
)
from .v2_metrics import (
    compute_xirr,
    compute_xirr_from_dayfrac,
    compute_moic,
    compute_net_return,
    compute_var,
    compute_cvar,
)


# ===================================================================
# Helper: generate grid points from a range tuple
# ===================================================================

def _arange(rng: tuple[float, float, float]) -> list[float]:
    """Generate grid values from (min, max, step) inclusive of endpoints."""
    lo, hi, step = rng
    vals = []
    v = lo
    while v <= hi + step * 0.01:  # small epsilon for float rounding
        vals.append(round(v, 6))
        v += step
    return vals


def _monthly_to_dated_cashflow(
    cf: np.ndarray,
    start_date: str = "2026-04-30",
) -> tuple[list, list[float]]:
    """Convert monthly-indexed cashflow → (dates, cashflows) for XIRR."""
    start = _parse_start_date()
    dates = [_month_end(start, m) for m in range(len(cf))]
    return dates, cf.tolist()


# ===================================================================
# 1. Litigation Funding Grid Analysis
# ===================================================================

def analyze_litigation_funding_grid(
    claims: list[ClaimConfig],
    sim: SimulationResults,
    cost_multiple_range: tuple[float, float, float] = (1.0, 5.0, 0.5),
    award_ratio_range: tuple[float, float, float] = (0.05, 0.50, 0.05),
    waterfall_type: str = "min",
    discount_rate: float = 0.12,
) -> dict:
    """Evaluate litigation funding across a cost_multiple × award_ratio grid.

    For each (cm, ar) combination, runs all MC paths through the
    litigation-funding cashflow builder and aggregates metrics.

    Returns
    -------
    dict with keys: grid, axes, best_cell, breakeven_curve.
    """
    cost_multiples = _arange(cost_multiple_range)
    award_ratios = _arange(award_ratio_range)
    n = sim.n_paths

    # Build parallel list of per-claim PathResult lists
    all_paths = [sim.results[cid] for cid in sim.claim_ids]
    claim_objs = [_find_claim(claims, cid) for cid in sim.claim_ids]

    grid: dict[str, dict] = {}
    best_moic = -999.0
    best_cell = {}

    for cm in cost_multiples:
        for ar in award_ratios:
            path_moics = np.zeros(n)
            path_xirrs = np.zeros(n)
            path_net = np.zeros(n)

            for pi in range(n):
                cf, inv, ret = build_litigation_funding_cashflow(
                    claim_objs, all_paths, pi,
                    cost_multiple=cm,
                    award_ratio=ar,
                    waterfall_type=waterfall_type,
                )
                path_moics[pi] = compute_moic(inv, ret)
                path_net[pi] = compute_net_return(ret, inv)

                dates, cfs_list = _monthly_to_dated_cashflow(cf)
                path_xirrs[pi] = compute_xirr(dates, cfs_list) if len(dates) >= 2 else -1.0

            mean_moic = float(np.mean(path_moics))
            cell = {
                "cost_multiple": cm,
                "award_ratio": ar,
                "mean_moic": mean_moic,
                "median_moic": float(np.median(path_moics)),
                "mean_xirr": float(np.mean(path_xirrs)),
                "median_xirr": float(np.median(path_xirrs)),
                "p_loss": float(np.mean(path_moics < 1.0)),
                "p_hurdle": float(np.mean(path_xirrs > discount_rate)),
                "var_5": float(np.percentile(path_moics, 5)) if n > 0 else 0.0,
                "cvar_5": float(np.mean(path_moics[path_moics <= np.percentile(path_moics, 5)])) if n > 0 else 0.0,
                "mean_net_return_cr": float(np.mean(path_net)),
            }
            key = f"{cm}_{ar}"
            grid[key] = cell

            if mean_moic > best_moic:
                best_moic = mean_moic
                best_cell = {"cost_multiple": cm, "award_ratio": ar,
                             "moic": mean_moic, "irr": cell["mean_xirr"]}

    # Breakeven curve: for each cm, find minimum ar where E[MOIC] >= 1.0
    breakeven_curve = []
    for cm in cost_multiples:
        min_ar = None
        for ar in award_ratios:
            key = f"{cm}_{ar}"
            if key in grid and grid[key]["mean_moic"] >= 1.0:
                min_ar = ar
                break
        if min_ar is not None:
            breakeven_curve.append({"cost_multiple": cm, "min_award_ratio_for_moic_1": min_ar})

    return {
        "grid": grid,
        "axes": {"cost_multiples": cost_multiples, "award_ratios": award_ratios},
        "best_cell": best_cell,
        "breakeven_curve": breakeven_curve,
        "waterfall_type": waterfall_type,
        "n_paths": n,
    }


# ===================================================================
# 2. Full Purchase Sensitivity Analysis
# ===================================================================

def analyze_full_purchase_sensitivity(
    claims: list[ClaimConfig],
    sim: SimulationResults,
    purchase_prices: list[float],
    legal_cost_bearer: str = "investor",
    purchased_share_pct: float = 1.0,
    discount_rate: float = 0.12,
) -> dict:
    """Evaluate full purchase at multiple price points.

    Returns
    -------
    dict with keys: sensitivity, breakeven_price, optimal_price.
    """
    n = sim.n_paths
    all_paths = [sim.results[cid] for cid in sim.claim_ids]
    claim_objs = [_find_claim(claims, cid) for cid in sim.claim_ids]

    sensitivity = []
    breakeven_price = None
    prev_moic = None
    prev_price = None
    optimal_price = None
    optimal_irr = -999.0

    for price in sorted(purchase_prices):
        path_moics = np.zeros(n)
        path_xirrs = np.zeros(n)
        path_net = np.zeros(n)

        for pi in range(n):
            cf, inv, ret = build_full_purchase_cashflow(
                claim_objs, all_paths, pi,
                purchase_price_cr=price,
                legal_cost_bearer=legal_cost_bearer,
                purchased_share_pct=purchased_share_pct,
            )
            path_moics[pi] = compute_moic(inv, ret)
            path_net[pi] = compute_net_return(ret, inv)

            dates, cfs_list = _monthly_to_dated_cashflow(cf)
            path_xirrs[pi] = compute_xirr(dates, cfs_list) if len(dates) >= 2 else -1.0

        mean_moic = float(np.mean(path_moics))
        mean_xirr = float(np.mean(path_xirrs))
        p_loss = float(np.mean(path_moics < 1.0))

        row = {
            "price": price,
            "mean_moic": mean_moic,
            "median_moic": float(np.median(path_moics)),
            "mean_xirr": mean_xirr,
            "median_xirr": float(np.median(path_xirrs)),
            "p_loss": p_loss,
            "p5_moic": float(np.percentile(path_moics, 5)) if n > 0 else 0.0,
            "p95_moic": float(np.percentile(path_moics, 95)) if n > 0 else 0.0,
            "mean_net_return_cr": float(np.mean(path_net)),
        }
        sensitivity.append(row)

        # Breakeven: linear interpolation where mean_moic crosses 1.0
        if breakeven_price is None and prev_moic is not None:
            if prev_moic >= 1.0 and mean_moic < 1.0:
                # Interpolate between prev_price and price
                if abs(prev_moic - mean_moic) > 1e-9:
                    frac = (prev_moic - 1.0) / (prev_moic - mean_moic)
                    breakeven_price = prev_price + frac * (price - prev_price)
                else:
                    breakeven_price = price

        # Optimal: highest IRR with P(loss) < 20%
        if p_loss < 0.20 and mean_xirr > optimal_irr:
            optimal_irr = mean_xirr
            optimal_price = price

        prev_moic = mean_moic
        prev_price = price

    # If all points have MOIC >= 1, breakeven is beyond the tested range
    if breakeven_price is None and sensitivity:
        last = sensitivity[-1]
        if last["mean_moic"] >= 1.0:
            breakeven_price = float(sorted(purchase_prices)[-1])

    return {
        "sensitivity": sensitivity,
        "breakeven_price": breakeven_price,
        "optimal_price": optimal_price,
        "legal_cost_bearer": legal_cost_bearer,
        "purchased_share_pct": purchased_share_pct,
        "n_paths": n,
    }


# ===================================================================
# 3. Staged Payment Analysis
# ===================================================================

def analyze_staged_payment_grid(
    claims: list[ClaimConfig],
    sim: SimulationResults,
    milestones: list[dict],
    legal_cost_bearer: str = "investor",
    purchased_share_pct: float = 1.0,
    discount_rate: float = 0.12,
) -> dict:
    """Evaluate a staged payment structure across all MC paths.

    Returns
    -------
    dict with keys: summary, per_milestone, total_expected_investment,
    milestone_timing.
    """
    n = sim.n_paths
    all_paths = [sim.results[cid] for cid in sim.claim_ids]
    claim_objs = [_find_claim(claims, cid) for cid in sim.claim_ids]

    path_moics = np.zeros(n)
    path_xirrs = np.zeros(n)
    path_net = np.zeros(n)
    path_invested = np.zeros(n)

    # Per-milestone tracking
    ms_names = [ms.get("milestone_name", ms.get("name", f"ms_{i}"))
                for i, ms in enumerate(milestones)]
    ms_payments = [ms.get("payment_cr", 0.0) for ms in milestones]
    ms_triggered_count = np.zeros(len(milestones))
    ms_month_samples: list[list[int]] = [[] for _ in milestones]

    for pi in range(n):
        cf, inv, ret = build_staged_payment_cashflow(
            claim_objs, all_paths, pi,
            milestones=milestones,
            legal_cost_bearer=legal_cost_bearer,
            purchased_share_pct=purchased_share_pct,
        )
        path_moics[pi] = compute_moic(inv, ret)
        path_net[pi] = compute_net_return(ret, inv)
        path_invested[pi] = inv

        dates, cfs_list = _monthly_to_dated_cashflow(cf)
        path_xirrs[pi] = compute_xirr(dates, cfs_list) if len(dates) >= 2 else -1.0

        # Track milestone triggers per path
        reference_pr = max(
            (cr[pi] for cr in all_paths),
            key=lambda pr: pr.total_duration_months,
        )
        resolution_month = max(int(np.ceil(reference_pr.total_duration_months)), 1)
        any_win = _any_claim_wins(all_paths, pi)

        for mi, ms in enumerate(milestones):
            ms_name = ms.get("milestone_name", ms.get("name", "signing"))
            mm = _milestone_month(ms_name, reference_pr)
            if _milestone_triggered(mm, resolution_month, any_win):
                ms_triggered_count[mi] += 1
                ms_month_samples[mi].append(mm)

    # Summary
    summary = {
        "mean_moic": float(np.mean(path_moics)),
        "median_moic": float(np.median(path_moics)),
        "mean_xirr": float(np.mean(path_xirrs)),
        "median_xirr": float(np.median(path_xirrs)),
        "p_loss": float(np.mean(path_moics < 1.0)),
        "p_hurdle": float(np.mean(path_xirrs > discount_rate)),
        "var_5": float(np.percentile(path_moics, 5)) if n > 0 else 0.0,
        "mean_net_return_cr": float(np.mean(path_net)),
        "mean_invested_cr": float(np.mean(path_invested)),
    }

    # Per-milestone breakdown
    per_milestone = []
    for mi in range(len(milestones)):
        trigger_rate = float(ms_triggered_count[mi] / n) if n > 0 else 0.0
        months = ms_month_samples[mi]
        timing = {}
        if months:
            arr = np.array(months, dtype=float)
            timing = {
                "P25": float(np.percentile(arr, 25)),
                "P50": float(np.percentile(arr, 50)),
                "P75": float(np.percentile(arr, 75)),
            }

        per_milestone.append({
            "name": ms_names[mi],
            "payment_cr": ms_payments[mi],
            "trigger_rate": trigger_rate,
            "mean_payment": trigger_rate * ms_payments[mi],
            "total_expected": trigger_rate * ms_payments[mi] * n / n if n > 0 else 0.0,
            "timing": timing,
        })

    total_expected_investment = float(np.mean(path_invested))

    # Milestone timing aggregation
    milestone_timing = {}
    for mi in range(len(milestones)):
        months = ms_month_samples[mi]
        if months:
            arr = np.array(months, dtype=float)
            milestone_timing[ms_names[mi]] = {
                "P25": float(np.percentile(arr, 25)),
                "P50": float(np.percentile(arr, 50)),
                "P75": float(np.percentile(arr, 75)),
            }

    return {
        "summary": summary,
        "per_milestone": per_milestone,
        "total_expected_investment": total_expected_investment,
        "milestone_timing": milestone_timing,
        "n_paths": n,
    }


# ===================================================================
# 4. Comparative Analysis
# ===================================================================

def analyze_comparative(
    claims: list[ClaimConfig],
    sim: SimulationResults,
    structure_a_type: str,
    structure_a_params: dict,
    structure_b_type: str,
    structure_b_params: dict,
    discount_rate: float = 0.12,
) -> dict:
    """Run two structures side-by-side on the same MC paths.

    Returns
    -------
    dict with keys: structure_a, structure_b, comparison.
    """
    n = sim.n_paths
    all_paths = [sim.results[cid] for cid in sim.claim_ids]
    claim_objs = [_find_claim(claims, cid) for cid in sim.claim_ids]

    moics_a = np.zeros(n)
    moics_b = np.zeros(n)
    xirrs_a = np.zeros(n)
    xirrs_b = np.zeros(n)
    net_a = np.zeros(n)
    net_b = np.zeros(n)

    for pi in range(n):
        (cf_a, inv_a, ret_a), (cf_b, inv_b, ret_b) = build_comparative_cashflows(
            claim_objs, all_paths, pi,
            structure_a_type=structure_a_type,
            structure_a_params=structure_a_params,
            structure_b_type=structure_b_type,
            structure_b_params=structure_b_params,
        )

        moics_a[pi] = compute_moic(inv_a, ret_a)
        moics_b[pi] = compute_moic(inv_b, ret_b)
        net_a[pi] = compute_net_return(ret_a, inv_a)
        net_b[pi] = compute_net_return(ret_b, inv_b)

        dates_a, cfs_a = _monthly_to_dated_cashflow(cf_a)
        dates_b, cfs_b = _monthly_to_dated_cashflow(cf_b)
        xirrs_a[pi] = compute_xirr(dates_a, cfs_a) if len(dates_a) >= 2 else -1.0
        xirrs_b[pi] = compute_xirr(dates_b, cfs_b) if len(dates_b) >= 2 else -1.0

    def _summarize(moics, xirrs, nets):
        return {
            "mean_moic": float(np.mean(moics)),
            "median_moic": float(np.median(moics)),
            "mean_xirr": float(np.mean(xirrs)),
            "median_xirr": float(np.median(xirrs)),
            "p_loss": float(np.mean(moics < 1.0)),
            "p_hurdle": float(np.mean(xirrs > discount_rate)),
            "var_5": float(np.percentile(moics, 5)) if n > 0 else 0.0,
            "mean_net_return_cr": float(np.mean(nets)),
        }

    summary_a = _summarize(moics_a, xirrs_a, net_a)
    summary_b = _summarize(moics_b, xirrs_b, net_b)

    # Correlation of path-level returns
    corr = 0.0
    if n > 1:
        std_a = np.std(moics_a)
        std_b = np.std(moics_b)
        if std_a > 1e-9 and std_b > 1e-9:
            corr = float(np.corrcoef(moics_a, moics_b)[0, 1])

    # Advantages
    moic_adv = "A" if summary_a["mean_moic"] >= summary_b["mean_moic"] else "B"
    irr_adv = "A" if summary_a["mean_xirr"] >= summary_b["mean_xirr"] else "B"
    risk_adv = "A" if summary_a["p_loss"] <= summary_b["p_loss"] else "B"

    return {
        "structure_a": {
            "type": structure_a_type,
            "params": structure_a_params,
            "summary_metrics": summary_a,
        },
        "structure_b": {
            "type": structure_b_type,
            "params": structure_b_params,
            "summary_metrics": summary_b,
        },
        "comparison": {
            "moic_advantage": moic_adv,
            "irr_advantage": irr_adv,
            "risk_advantage": risk_adv,
            "correlation": corr,
            "moic_diff": summary_a["mean_moic"] - summary_b["mean_moic"],
            "irr_diff": summary_a["mean_xirr"] - summary_b["mean_xirr"],
            "p_loss_diff": summary_a["p_loss"] - summary_b["p_loss"],
        },
        "n_paths": n,
    }


# ===================================================================
# Helper: find claim by id
# ===================================================================

def _find_claim(claims: list[ClaimConfig], claim_id: str) -> ClaimConfig:
    """Look up a ClaimConfig by claim_id."""
    for c in claims:
        if c.claim_id == claim_id:
            return c
    raise ValueError(f"Claim '{claim_id}' not found in claims list")
