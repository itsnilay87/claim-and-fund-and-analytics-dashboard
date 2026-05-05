"""
v2_hybrid_payoff_analysis.py — Investment grid analysis for the hybrid payoff
structure.

Sweeps a 2-D grid of (upfront_value, return_a_value) and computes the same
``GridCellMetrics`` fields used by the upfront-tail dashboard so the existing
heatmap renderers work without modification.

For each grid cell we run all MC paths through ``build_hybrid_payoff_cashflow``,
aggregate portfolio MOIC / XIRR / VaR / CVaR, and surface a per-claim
breakdown identical in shape to ``v2_investment_analysis``.

All monetary values are in ₹ Crore.
"""

from __future__ import annotations

from typing import Optional

import numpy as np

from .v2_cashflow_builder import (
    build_hybrid_payoff_cashflow,
    merge_dated_cashflows,
)
from .v2_config import ClaimConfig, PathResult, SimulationResults
from .v2_investment_analysis import (
    GridCellMetrics,
    InvestmentGridResults,
    _get_legal_burn,
)
from .v2_metrics import (
    compute_xirr,
    compute_moic,
    compute_net_return,
    compute_var,
    compute_cvar,
)


def _grid_axis(rng) -> list[float]:
    """Materialise a `_GridRange` (min/max/step) into a list of float steps."""
    step = max(float(rng.step), 1e-9)
    lo = float(rng.min)
    hi = float(rng.max)
    if hi < lo:
        lo, hi = hi, lo
    n = int(round((hi - lo) / step)) + 1
    return [round(lo + i * step, 10) for i in range(n) if lo + i * step <= hi + 1e-9]


def analyze_hybrid_payoff_grid(
    sim: SimulationResults,
    claims: list[ClaimConfig],
    params,
    pricing_basis: Optional[str] = None,
) -> InvestmentGridResults:
    """Compute portfolio + per-claim metrics across the hybrid payoff grid.

    Parameters
    ----------
    sim : SimulationResults
        Completed Monte Carlo simulation.
    claims : list[ClaimConfig]
        Claim configurations.
    params : HybridPayoffParams
        Hybrid payoff parameter spec (from ``PortfolioStructure.params``).
    pricing_basis : str, optional
        For dashboard compatibility.  Defaults to ``params.upfront_basis``.

    Returns
    -------
    InvestmentGridResults whose ``cells`` are keyed by
    ``(upfront_value, return_a_value, basis)``.  Field names match the
    upfront-tail grid so the existing dashboard heatmap renders.
    """
    basis = pricing_basis or params.upfront_basis

    upfront_values = _grid_axis(params.upfront_range)
    return_a_values = _grid_axis(params.return_a_range)

    grid = InvestmentGridResults(
        upfront_pcts=upfront_values,
        award_share_pcts=return_a_values,
        pricing_bases=[basis],
        n_paths=sim.n_paths,
        n_claims=len(claims),
    )

    claim_map = {c.claim_id: c for c in claims}

    for up_val in upfront_values:
        for ra_val in return_a_values:
            cell = _compute_hybrid_cell(
                sim=sim,
                claim_map=claim_map,
                params=params,
                upfront_value=up_val,
                return_a_value=ra_val,
                pricing_basis=basis,
            )
            grid.cells[(up_val, ra_val, basis)] = cell

    return grid


def _compute_hybrid_cell(
    sim: SimulationResults,
    claim_map: dict,
    params,
    upfront_value: float,
    return_a_value: float,
    pricing_basis: str,
) -> GridCellMetrics:
    """Compute a single grid cell across all MC paths."""
    n = sim.n_paths
    cell = GridCellMetrics(
        upfront_pct=upfront_value,
        award_share_pct=return_a_value,
        pricing_basis=pricing_basis,
    )

    path_moics = np.zeros(n)
    path_xirrs = np.zeros(n)
    path_net_returns = np.zeros(n)

    claim_moics = {cid: [] for cid in sim.claim_ids}
    claim_xirrs = {cid: [] for cid in sim.claim_ids}
    claim_net_returns = {cid: [] for cid in sim.claim_ids}

    all_dates_set: set = set()
    path_cf_dicts: list[dict] = []

    eq_map = sim.expected_quantum_map

    for path_i in range(n):
        portfolio_invested = 0.0
        portfolio_return = 0.0
        path_claim_cfs: list[tuple[list, list]] = []

        for cid in sim.claim_ids:
            path_result: PathResult = sim.results[cid][path_i]
            claim: ClaimConfig = claim_map[cid]
            legal_burn = _get_legal_burn(path_result)
            eq_cr_val = eq_map.get(cid, claim.soc_value_cr * 0.720)

            dates, cfs, total_inv, total_ret = build_hybrid_payoff_cashflow(
                claim=claim,
                total_duration_months=path_result.total_duration_months,
                quantum_received_cr=path_result.collected_cr,
                monthly_legal_burn=legal_burn,
                upfront_basis=params.upfront_basis,
                upfront_value=upfront_value,
                return_a_type=params.return_a_type,
                return_a_value=return_a_value,
                return_b_type=params.return_b_type,
                return_b_value=params.return_b_value,
                operator=params.operator,
                min_payout=params.min_payout,
                max_payout=params.max_payout,
                expected_quantum_cr=eq_cr_val,
            )

            c_moic = compute_moic(total_inv, total_ret)
            c_xirr = compute_xirr(dates, cfs)
            c_net = compute_net_return(total_ret, total_inv)

            claim_moics[cid].append(c_moic)
            claim_xirrs[cid].append(c_xirr)
            claim_net_returns[cid].append(c_net)

            path_claim_cfs.append((dates, cfs))
            portfolio_invested += total_inv
            portfolio_return += total_ret

        p_moic = compute_moic(portfolio_invested, portfolio_return)
        p_net = compute_net_return(portfolio_return, portfolio_invested)
        path_moics[path_i] = p_moic
        path_net_returns[path_i] = p_net

        port_dates, port_cfs = merge_dated_cashflows(path_claim_cfs)
        path_xirrs[path_i] = (
            compute_xirr(port_dates, port_cfs) if len(port_dates) >= 2 else -1.0
        )

        cf_dict: dict = {}
        for d, cf in zip(port_dates, port_cfs):
            cf_dict[d] = cf_dict.get(d, 0.0) + cf
            all_dates_set.add(d)
        path_cf_dicts.append(cf_dict)

    cell.mean_moic = float(np.mean(path_moics))
    cell.median_moic = float(np.median(path_moics))
    cell.std_moic = float(np.std(path_moics))
    cell.mean_net_return_cr = float(np.mean(path_net_returns))
    cell.p_loss = float(np.mean(path_moics < 1.0))
    cell.mean_xirr = float(np.mean(path_xirrs))
    cell.median_xirr = float(np.median(path_xirrs))

    if all_dates_set and path_cf_dicts:
        sorted_dates = sorted(all_dates_set)
        expected_cfs = []
        for d in sorted_dates:
            total = sum(pcf.get(d, 0.0) for pcf in path_cf_dicts)
            expected_cfs.append(total / n)
        cell.expected_xirr = (
            compute_xirr(sorted_dates, expected_cfs)
            if len(sorted_dates) >= 2 else 0.0
        )
    else:
        cell.expected_xirr = 0.0

    cell.p_irr_gt_30 = float(np.mean(path_xirrs > 0.30))
    cell.p_irr_gt_25 = float(np.mean(path_xirrs > 0.25))

    if len(path_net_returns) > 0:
        cell.var_1 = compute_var(path_net_returns, 0.01)
        cell.cvar_1 = compute_cvar(path_net_returns, 0.01)

    for cid in sim.claim_ids:
        moic_arr = np.array(claim_moics[cid])
        xirr_arr = np.array(claim_xirrs[cid])
        net_arr = np.array(claim_net_returns[cid])

        win_mask = moic_arr > 0.0
        cond_xirr_win = float(np.mean(xirr_arr[win_mask])) if win_mask.any() else 0.0

        claim_cfg = claim_map.get(cid)
        claim_legal_costs = [
            float(sim.results[cid][i].legal_cost_total_cr) for i in range(n)
        ]
        mean_legal = float(np.mean(claim_legal_costs))
        claim_name = getattr(claim_cfg, "name", "") if claim_cfg else ""

        cell.per_claim[cid] = {
            "claim_id": cid,
            "name": claim_name or cid,
            "E[MOIC]": float(np.mean(moic_arr)),
            "median_MOIC": float(np.median(moic_arr)),
            "E[XIRR]": float(np.mean(xirr_arr)),
            "median_XIRR": float(np.median(xirr_arr)),
            "conditional_E[XIRR|win]": cond_xirr_win,
            "P(XIRR>0)": float(np.mean(xirr_arr > 0.0)),
            "E[net_return_cr]": float(np.mean(net_arr)),
            "P(loss)": float(np.mean(moic_arr < 1.0)),
            "P(IRR>30%)": float(np.mean(xirr_arr > 0.30)),
            "economically_viable": float(np.mean(net_arr)) > 0.0,
            "mean_legal_cost_cr": mean_legal,
        }

    return cell
