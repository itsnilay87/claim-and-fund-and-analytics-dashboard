"""
engine/analysis/investment_grid.py — Upfront × Tail investment grid analysis.
==============================================================================

For each (upfront_pct, tail_pct) combination, compute portfolio-level and
per-claim MOIC/XIRR metrics across all MC paths.

Also computes breakeven curve: max upfront_pct where E[MOIC] >= 1.0 per tail%.

Ported from TATA_code_v2/v2_investment_analysis.py with Pydantic schema support.
All monetary values in ₹ Crore.
"""

from __future__ import annotations

import numpy as np

from engine.config.schema import (
    ClaimConfig,
    GridCellMetrics,
    PathResult,
    PortfolioStructure,
    SimulationConfig,
    UpfrontTailParams,
)
from engine.simulation.cashflow_builder import (
    build_upfront_tail_cashflow,
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
# Grid generation helper
# ===================================================================

def _arange(grid_range) -> list[float]:
    """Generate list of floats from a _GridRange object."""
    vals = []
    v = grid_range.min
    while v <= grid_range.max + 1e-9:
        vals.append(round(v, 4))
        v += grid_range.step
    return vals


# ===================================================================
# Main entry point
# ===================================================================

def evaluate_upfront_tail_grid(
    claims: list[ClaimConfig],
    all_path_results: dict[str, list[PathResult]],
    upfront_range: list[float] | None = None,
    tail_range: list[float] | None = None,
    pricing_basis: str = "soc",
    simulation_config: SimulationConfig | None = None,
    start_date: str = "2026-04-30",
) -> dict[str, GridCellMetrics]:
    """Evaluate investment metrics across the upfront × tail grid.

    Parameters
    ----------
    claims : list[ClaimConfig]
    all_path_results : dict  {claim_id: [PathResult_0, ...]}
    upfront_range : list[float], optional  (default: 5%..50% by 5%)
    tail_range : list[float], optional  (default: 0%..50% by 5%)
    pricing_basis : str  "soc" or "ev"
    simulation_config : SimulationConfig, optional
    start_date : str  ISO date

    Returns
    -------
    dict keyed by "upfront_tail" string, e.g. "10_30" → GridCellMetrics
    """
    if upfront_range is None:
        upfront_range = [round(x * 0.05, 2) for x in range(1, 11)]
    if tail_range is None:
        tail_range = [round(x * 0.05, 2) for x in range(0, 11)]

    # Determine n_paths from first claim's results
    first_cid = claims[0].id
    n_paths = len(all_path_results.get(first_cid, []))

    # Pre-compute expected quantum per claim (for "ev" pricing)
    eq_map: dict[str, float] = {}
    for c in claims:
        win_quanta = [
            r.quantum_cr for r in all_path_results.get(c.id, [])
            if r.outcome == "TRUE_WIN" and r.quantum_cr > 0
        ]
        eq_map[c.id] = float(np.mean(win_quanta)) if win_quanta else c.soc_value_cr * 0.72

    grid: dict[str, GridCellMetrics] = {}

    for up_pct in upfront_range:
        for tail_pct in tail_range:
            cell = _compute_grid_cell(
                claims, all_path_results, up_pct, tail_pct,
                pricing_basis, eq_map, n_paths, start_date,
            )
            key = f"{int(round(up_pct * 100))}_{int(round(tail_pct * 100))}"
            grid[key] = cell

    return grid


# ===================================================================
# Per-cell computation
# ===================================================================

def _compute_grid_cell(
    claims: list[ClaimConfig],
    all_path_results: dict[str, list[PathResult]],
    upfront_pct: float,
    tail_pct: float,
    pricing_basis: str,
    eq_map: dict[str, float],
    n_paths: int,
    start_date: str,
) -> GridCellMetrics:
    """Compute portfolio-level metrics for one (upfront, tail) cell."""
    path_moics = np.zeros(n_paths)
    path_xirrs = np.zeros(n_paths)
    path_net_returns = np.zeros(n_paths)

    # Per-claim accumulators
    claim_moics: dict[str, list[float]] = {c.id: [] for c in claims}
    claim_xirrs: dict[str, list[float]] = {c.id: [] for c in claims}

    for path_i in range(n_paths):
        portfolio_invested = 0.0
        portfolio_return = 0.0
        path_claim_cfs: list[tuple[list, list]] = []

        for claim in claims:
            results = all_path_results.get(claim.id, [])
            if path_i >= len(results):
                continue
            pr = results[path_i]

            eq_cr = eq_map.get(claim.id)
            dates, cfs, total_inv, total_ret = build_upfront_tail_cashflow(
                claim=claim,
                path_result=pr,
                upfront_pct=upfront_pct,
                tail_pct=tail_pct,
                pricing_basis=pricing_basis,
                start_date=start_date,
                expected_quantum_cr=eq_cr,
            )

            c_moic = compute_moic(total_ret, total_inv)
            c_xirr = compute_xirr(dates, cfs)

            claim_moics[claim.id].append(c_moic)
            claim_xirrs[claim.id].append(c_xirr)

            path_claim_cfs.append((dates, cfs))
            portfolio_invested += total_inv
            portfolio_return += total_ret

        p_moic = compute_moic(portfolio_return, portfolio_invested)
        p_net = compute_net_return(portfolio_return, portfolio_invested)
        path_moics[path_i] = p_moic
        path_net_returns[path_i] = p_net

        # Portfolio-level XIRR from merged cashflows
        if path_claim_cfs:
            port_dates, port_cfs = merge_dated_cashflows(path_claim_cfs)
            path_xirrs[path_i] = compute_xirr(port_dates, port_cfs) if len(port_dates) >= 2 else -1.0
        else:
            path_xirrs[path_i] = -1.0

    # Aggregate
    per_claim: dict[str, dict] = {}
    for c in claims:
        moic_arr = np.array(claim_moics[c.id])
        xirr_arr = np.array(claim_xirrs[c.id])
        per_claim[c.id] = {
            "mean_moic": float(np.mean(moic_arr)) if len(moic_arr) > 0 else 0.0,
            "median_moic": float(np.median(moic_arr)) if len(moic_arr) > 0 else 0.0,
            "mean_xirr": float(np.mean(xirr_arr)) if len(xirr_arr) > 0 else 0.0,
            "p_loss": float(np.mean(moic_arr < 1.0)) if len(moic_arr) > 0 else 0.0,
            "p_hurdle": float(np.mean(xirr_arr > 0.30)) if len(xirr_arr) > 0 else 0.0,
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


# ===================================================================
# Breakeven curve
# ===================================================================

def find_breakeven_curve(
    grid_results: dict[str, GridCellMetrics],
) -> list[dict]:
    """For each tail%, find the maximum upfront% where E[MOIC] >= 1.0.

    Returns list of {tail_pct, max_upfront_pct}.
    """
    # Group by tail_pct
    tail_groups: dict[int, list[tuple[int, float]]] = {}
    for key, cell in grid_results.items():
        parts = key.split("_")
        if len(parts) != 2:
            continue
        up_int, tail_int = int(parts[0]), int(parts[1])
        tail_groups.setdefault(tail_int, []).append((up_int, cell.mean_moic))

    breakeven: list[dict] = []
    for tail_int in sorted(tail_groups.keys()):
        max_viable = 0.0
        for up_int, moic in sorted(tail_groups[tail_int]):
            if moic >= 1.0:
                max_viable = up_int / 100.0
        breakeven.append({
            "tail_pct": tail_int / 100.0,
            "max_upfront_pct": max_viable,
        })

    return breakeven
