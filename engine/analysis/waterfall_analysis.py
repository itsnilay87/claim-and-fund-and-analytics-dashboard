"""
engine/analysis/waterfall_analysis.py — Litigation Funding waterfall grid analysis.
====================================================================================

For each (cost_multiple, award_ratio) combination, compute portfolio-level
metrics using the litigation funding cashflow waterfall.

Same structure as investment_grid but axes are (cost_multiple, award_ratio)
instead of (upfront_pct, tail_pct).

All monetary values in ₹ Crore.
"""

from __future__ import annotations

import numpy as np

from engine.config.schema import (
    ClaimConfig,
    GridCellMetrics,
    LitFundingParams,
    PathResult,
    SimulationConfig,
)
from engine.simulation.cashflow_builder import (
    build_litigation_funding_cashflow,
    merge_dated_cashflows,
)
from engine.simulation.metrics import (
    compute_xirr,
    compute_moic,
    compute_net_return,
    compute_var,
    compute_cvar,
)


# ===================================================================
# Main entry point
# ===================================================================

def evaluate_waterfall_grid(
    claims: list[ClaimConfig],
    all_path_results: dict[str, list[PathResult]],
    cost_multiple_range: list[float] | None = None,
    award_ratio_range: list[float] | None = None,
    waterfall_type: str = "min",
    simulation_config: SimulationConfig | None = None,
    start_date: str = "2026-04-30",
) -> dict[str, GridCellMetrics]:
    """Evaluate litigation funding metrics across cost_multiple × award_ratio grid.

    Parameters
    ----------
    claims : list[ClaimConfig]
    all_path_results : dict  {claim_id: [PathResult_0, ...]}
    cost_multiple_range : list[float], optional  (default: 1.0..5.0 by 0.5)
    award_ratio_range : list[float], optional  (default: 0.10..0.50 by 0.05)
    waterfall_type : str  "min" or "max"
    simulation_config : SimulationConfig, optional
    start_date : str

    Returns
    -------
    dict keyed by "cm_ar" string, e.g. "30_25" (3.0× cost mult, 25% award ratio)
    """
    if cost_multiple_range is None:
        cost_multiple_range = [round(1.0 + x * 0.5, 1) for x in range(9)]
    if award_ratio_range is None:
        award_ratio_range = [round(0.10 + x * 0.05, 2) for x in range(9)]

    first_cid = claims[0].id
    n_paths = len(all_path_results.get(first_cid, []))

    grid: dict[str, GridCellMetrics] = {}

    for cm in cost_multiple_range:
        for ar in award_ratio_range:
            cell = _compute_waterfall_cell(
                claims, all_path_results, cm, ar,
                waterfall_type, n_paths, start_date,
            )
            key = f"{int(round(cm * 10))}_{int(round(ar * 100))}"
            grid[key] = cell

    return grid


# ===================================================================
# Per-cell computation
# ===================================================================

def _compute_waterfall_cell(
    claims: list[ClaimConfig],
    all_path_results: dict[str, list[PathResult]],
    cost_multiple: float,
    award_ratio: float,
    waterfall_type: str,
    n_paths: int,
    start_date: str,
) -> GridCellMetrics:
    """Compute portfolio-level metrics for one (cost_multiple, award_ratio) cell."""
    path_moics = np.zeros(n_paths)
    path_xirrs = np.zeros(n_paths)
    path_net_returns = np.zeros(n_paths)

    claim_moics: dict[str, list[float]] = {c.id: [] for c in claims}

    for path_i in range(n_paths):
        portfolio_invested = 0.0
        portfolio_return = 0.0
        path_claim_cfs: list[tuple[list, list]] = []

        for claim in claims:
            results = all_path_results.get(claim.id, [])
            if path_i >= len(results):
                continue
            pr = results[path_i]

            dates, cfs, total_inv, total_ret = build_litigation_funding_cashflow(
                claim=claim,
                path_result=pr,
                cost_multiple_cap=cost_multiple,
                award_ratio_cap=award_ratio,
                waterfall_type=waterfall_type,
                start_date=start_date,
            )

            c_moic = compute_moic(total_ret, total_inv)
            claim_moics[claim.id].append(c_moic)

            path_claim_cfs.append((dates, cfs))
            portfolio_invested += total_inv
            portfolio_return += total_ret

        p_moic = compute_moic(portfolio_return, portfolio_invested)
        p_net = compute_net_return(portfolio_return, portfolio_invested)
        path_moics[path_i] = p_moic
        path_net_returns[path_i] = p_net

        if path_claim_cfs:
            port_dates, port_cfs = merge_dated_cashflows(path_claim_cfs)
            path_xirrs[path_i] = compute_xirr(port_dates, port_cfs) if len(port_dates) >= 2 else -1.0
        else:
            path_xirrs[path_i] = -1.0

    per_claim: dict[str, dict] = {}
    for c in claims:
        moic_arr = np.array(claim_moics[c.id])
        per_claim[c.id] = {
            "mean_moic": float(np.mean(moic_arr)) if len(moic_arr) > 0 else 0.0,
            "p_loss": float(np.mean(moic_arr < 1.0)) if len(moic_arr) > 0 else 0.0,
        }

    return GridCellMetrics(
        mean_moic=float(np.mean(path_moics)),
        median_moic=float(np.median(path_moics)),
        mean_xirr=float(np.mean(path_xirrs)),
        p_loss=float(np.mean(path_moics < 1.0)),
        p_hurdle=float(np.mean(path_xirrs > 0.30)),
        var_1=float(compute_var(path_moics, 0.01)),
        cvar_1=float(compute_cvar(path_moics, 0.01)),
        per_claim=per_claim,
    )
