"""
TATA_code_v2/v2_investment_analysis.py — Investment grid analysis.
===================================================================

For each (upfront_pct, award_share_pct, pricing_basis) combination,
compute portfolio-level and per-claim metrics across all MC paths.

Also computes breakeven surface: maximum upfront_pct where E[MOIC] >= 1.0.

All monetary values in ₹ Crore.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

import numpy as np

from . import v2_master_inputs as MI
from .v2_config import ClaimConfig, PathResult, SimulationResults
from .v2_cashflow_builder import build_cashflow, merge_dated_cashflows
from .v2_metrics import (
    compute_xirr,
    compute_moic,
    compute_net_return,
    compute_var,
    compute_cvar,
)
from .v2_quantum_model import compute_expected_quantum
from .v2_legal_cost_model import load_legal_costs


# ===================================================================
# Result Dataclasses
# ===================================================================

@dataclass
class GridCellMetrics:
    """Metrics for one (upfront_pct, award_share_pct) combination."""

    upfront_pct: float
    award_share_pct: float
    pricing_basis: str          # "soc" or "eq"

    # Portfolio-level aggregated metrics
    mean_xirr: float = 0.0
    median_xirr: float = 0.0
    expected_xirr: float = 0.0   # IRR of the expected (mean) cashflow stream
    mean_moic: float = 0.0
    median_moic: float = 0.0
    std_moic: float = 0.0
    mean_net_return_cr: float = 0.0
    p_loss: float = 0.0          # P(MOIC < 1)
    p_irr_gt_30: float = 0.0    # P(IRR > 30%)
    p_irr_gt_25: float = 0.0    # P(IRR > 25%)
    var_1: float = 0.0           # VaR at 1st percentile (on net return)
    cvar_1: float = 0.0          # CVaR at 1st percentile

    # Per-claim breakdown: claim_id → metrics dict
    per_claim: dict[str, dict] = field(default_factory=dict)

    def __repr__(self) -> str:
        return (
            f"GridCell({self.upfront_pct:.0%}/{self.award_share_pct:.0%} "
            f"{self.pricing_basis}: E[MOIC]={self.mean_moic:.2f}x, "
            f"P(loss)={self.p_loss:.1%})"
        )


@dataclass
class InvestmentGridResults:
    """Complete investment grid analysis results."""

    upfront_pcts: list[float]
    award_share_pcts: list[float]
    pricing_bases: list[str]

    # All grid cells: (upfront_pct, award_share_pct, pricing_basis) → GridCellMetrics
    cells: dict[tuple[float, float, str], GridCellMetrics] = field(
        default_factory=dict
    )

    # Breakeven surface: award_share_pct → max upfront_pct where E[MOIC] >= 1
    breakeven: dict[str, dict[float, float]] = field(default_factory=dict)
    # breakeven["soc"][0.40] = 0.25 → at 40% award share (SOC pricing),
    # max viable upfront is 25%

    n_paths: int = 0
    n_claims: int = 0


# ===================================================================
# Main Analysis Function
# ===================================================================

def analyze_investment_grid(
    sim: SimulationResults,
    claims: list[ClaimConfig],
    pricing_bases: Optional[list[str]] = None,
    ctx=None,
) -> InvestmentGridResults:
    """Compute metrics for entire investment grid.

    Parameters
    ----------
    sim : SimulationResults
        Completed MC simulation.
    claims : list[ClaimConfig]
        Claim configurations.
    pricing_bases : list[str], optional
        Which pricing bases to evaluate. Default: ["soc"].
    ctx : PortfolioContext, optional
        If provided, uses ctx.upfront_pcts and ctx.award_share_pcts for grid.
        If None, falls back to MI.UPFRONT_PCT_SOC and MI.AWARD_SHARE_PCT.

    Returns
    -------
    InvestmentGridResults with all grid cells populated.
    """
    if pricing_bases is None:
        pricing_bases = ["soc"]

    if ctx is not None:
        upfront_pcts = ctx.upfront_pcts
        award_share_pcts = ctx.award_share_pcts
    else:
        upfront_pcts = MI.UPFRONT_PCT_SOC
        award_share_pcts = MI.AWARD_SHARE_PCT

    # Pre-compute expected quantum per claim (for "eq" pricing)
    eq_map = sim.expected_quantum_map

    # Pre-load legal cost table
    cost_table = load_legal_costs()

    grid = InvestmentGridResults(
        upfront_pcts=upfront_pcts,
        award_share_pcts=award_share_pcts,
        pricing_bases=pricing_bases,
        n_paths=sim.n_paths,
        n_claims=len(claims),
    )

    claim_map = {c.claim_id: c for c in claims}

    for basis in pricing_bases:
        for up_pct in upfront_pcts:
            for aw_pct in award_share_pcts:
                cell = _compute_grid_cell(
                    sim, claim_map, up_pct, aw_pct, basis, eq_map,
                )
                grid.cells[(up_pct, aw_pct, basis)] = cell

        # Compute breakeven surface for this basis
        grid.breakeven[basis] = _compute_breakeven(
            grid.cells, upfront_pcts, award_share_pcts, basis,
        )

    return grid


# ===================================================================
# Per-Cell Computation
# ===================================================================

def _compute_grid_cell(
    sim: SimulationResults,
    claim_map: dict[str, ClaimConfig],
    upfront_pct: float,
    award_share_pct: float,
    pricing_basis: str,
    eq_map: dict[str, float],
) -> GridCellMetrics:
    """Compute portfolio-level metrics for one grid cell.

    For each MC path, sum cashflows across all 6 claims to get
    portfolio-level invested/return, then compute XIRR/MOIC.
    """
    n = sim.n_paths
    cell = GridCellMetrics(
        upfront_pct=upfront_pct,
        award_share_pct=award_share_pct,
        pricing_basis=pricing_basis,
    )

    # Per-path portfolio metrics
    path_moics = np.zeros(n)
    path_xirrs = np.zeros(n)
    path_net_returns = np.zeros(n)

    # Per-claim accumulators for per-claim breakdown
    claim_moics: dict[str, list[float]] = {cid: [] for cid in sim.claim_ids}
    claim_xirrs: dict[str, list[float]] = {cid: [] for cid in sim.claim_ids}
    claim_net_returns: dict[str, list[float]] = {cid: [] for cid in sim.claim_ids}

    # Collect per-path merged cashflows for expected-cashflow IRR
    all_dates_set: set = set()
    path_cf_dicts: list[dict] = []

    for path_i in range(n):
        portfolio_invested = 0.0
        portfolio_return = 0.0
        path_claim_cfs: list[tuple[list, list]] = []  # for portfolio XIRR merge

        for cid in sim.claim_ids:
            path_result = sim.results[cid][path_i]
            claim = claim_map[cid]

            # Build cashflow for this claim/path/investment combo
            eq_cr_val = eq_map.get(cid, claim.soc_value_cr * 0.720)

            # Use actual monthly legal burn from MC simulation
            legal_burn = _get_legal_burn(path_result)

            dates, cfs, total_inv, total_ret = build_cashflow(
                claim=claim,
                total_duration_months=path_result.total_duration_months,
                quantum_received_cr=path_result.collected_cr,
                monthly_legal_burn=legal_burn,
                upfront_pct=upfront_pct,
                award_share_pct=award_share_pct,
                pricing_basis=pricing_basis,
                expected_quantum_cr=eq_cr_val,
            )

            # Per-claim metrics
            c_moic = compute_moic(total_inv, total_ret)
            c_xirr = compute_xirr(dates, cfs)
            c_net = compute_net_return(total_ret, total_inv)

            claim_moics[cid].append(c_moic)
            claim_xirrs[cid].append(c_xirr)
            claim_net_returns[cid].append(c_net)

            # Collect for portfolio merge
            path_claim_cfs.append((dates, cfs))

            # Accumulate portfolio
            portfolio_invested += total_inv
            portfolio_return += total_ret

        # Portfolio MOIC for this path
        p_moic = compute_moic(portfolio_invested, portfolio_return)
        p_net = compute_net_return(portfolio_return, portfolio_invested)
        path_moics[path_i] = p_moic
        path_net_returns[path_i] = p_net

        # True portfolio-level XIRR from merged dated cashflows
        port_dates, port_cfs = merge_dated_cashflows(path_claim_cfs)
        path_xirrs[path_i] = compute_xirr(port_dates, port_cfs) if len(port_dates) >= 2 else -1.0

        # Store for expected-cashflow IRR computation
        cf_dict = {}
        for d, cf in zip(port_dates, port_cfs):
            cf_dict[d] = cf_dict.get(d, 0.0) + cf
            all_dates_set.add(d)
        path_cf_dicts.append(cf_dict)

    # Aggregate portfolio metrics
    cell.mean_moic = float(np.mean(path_moics))
    cell.median_moic = float(np.median(path_moics))
    cell.std_moic = float(np.std(path_moics))
    cell.mean_net_return_cr = float(np.mean(path_net_returns))
    cell.p_loss = float(np.mean(path_moics < 1.0))

    # Portfolio-level XIRR stats (true merged cashflow XIRR, not per-claim average)
    cell.mean_xirr = float(np.mean(path_xirrs))
    cell.median_xirr = float(np.median(path_xirrs))

    # Expected-cashflow IRR: IRR of the mean cashflow stream across all paths
    if all_dates_set and path_cf_dicts:
        sorted_dates = sorted(all_dates_set)
        expected_cfs = []
        for d in sorted_dates:
            total = sum(pcf.get(d, 0.0) for pcf in path_cf_dicts)
            expected_cfs.append(total / n)
        if len(sorted_dates) >= 2:
            cell.expected_xirr = compute_xirr(sorted_dates, expected_cfs)
        else:
            cell.expected_xirr = 0.0
    else:
        cell.expected_xirr = 0.0

    cell.p_irr_gt_30 = float(np.mean(path_xirrs > 0.30))
    cell.p_irr_gt_25 = float(np.mean(path_xirrs > 0.25))

    # VaR/CVaR on net returns
    if len(path_net_returns) > 0:
        cell.var_1 = compute_var(path_net_returns, 0.01)
        cell.cvar_1 = compute_cvar(path_net_returns, 0.01)

    # Per-claim breakdown
    for cid in sim.claim_ids:
        moic_arr = np.array(claim_moics[cid])
        xirr_arr = np.array(claim_xirrs[cid])
        net_arr = np.array(claim_net_returns[cid])

        # Conditional E[XIRR | win]: average XIRR only over winning paths
        win_mask = moic_arr > 0.0  # paths where quantum > 0 (TRUE_WIN)
        cond_xirr_win = float(np.mean(xirr_arr[win_mask])) if win_mask.any() else 0.0

        # Economic viability: SOC must exceed expected legal costs
        claim_cfg = claim_map.get(cid)
        claim_legal_costs = [float(sim.results[cid][i].legal_cost_total_cr) for i in range(n)]
        mean_legal = float(np.mean(claim_legal_costs))
        max_possible_return = (
            claim_cfg.soc_value_cr * award_share_pct if claim_cfg else 0.0
        )
        economically_viable = max_possible_return > mean_legal
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
            "economically_viable": economically_viable,
            "mean_legal_cost_cr": mean_legal,
            "max_possible_return_cr": max_possible_return,
        }

    return cell


def _get_legal_burn(path_result: PathResult) -> np.ndarray:
    """Get monthly legal burn from PathResult.

    Uses stored monthly_legal_burn if available (from MC engine),
    otherwise approximates with flat burn.
    """
    if path_result.monthly_legal_burn is not None and len(path_result.monthly_legal_burn) > 0:
        return path_result.monthly_legal_burn

    # Fallback: approximate as flat monthly burn
    total_cost = path_result.legal_cost_total_cr
    total_months = max(int(np.ceil(path_result.total_duration_months)), 2)

    monthly_burn = np.zeros(total_months + 1)
    if total_months > 0 and total_cost > 0:
        monthly_burn[0] = total_cost * 0.05  # ~5% tribunal at month 0
        remaining = total_cost * 0.95
        if total_months > 0:
            per_month = remaining / total_months
            monthly_burn[1:] = per_month

    return monthly_burn


# ===================================================================
# Breakeven Computation
# ===================================================================

def _compute_breakeven(
    cells: dict[tuple[float, float, str], GridCellMetrics],
    upfront_pcts: list[float],
    award_share_pcts: list[float],
    basis: str,
) -> dict[float, float]:
    """Find maximum upfront_pct where E[MOIC] >= 1.0 for each award_share_pct.

    Returns dict: award_share_pct → max viable upfront_pct.
    """
    breakeven: dict[float, float] = {}

    for aw_pct in award_share_pcts:
        max_viable = 0.0
        for up_pct in sorted(upfront_pcts):
            key = (up_pct, aw_pct, basis)
            if key in cells and cells[key].mean_moic >= 1.0:
                max_viable = up_pct
        breakeven[aw_pct] = max_viable

    return breakeven


# ===================================================================
# Summary Table Printer
# ===================================================================

def print_investment_grid_summary(
    grid: InvestmentGridResults,
    basis: str = "soc",
) -> None:
    """Print E[MOIC] table for the full upfront × award_share grid.

    Rows = upfront_pct, Columns = award_share_pct.
    """
    print(f"\n{'='*90}")
    print(f"INVESTMENT GRID — E[MOIC] ({basis.upper()} pricing)")
    print(f"N = {grid.n_paths:,}  |  {grid.n_claims} claims")
    print(f"{'='*90}")

    # Header
    header = f"{'Upfront':>8}"
    for aw_pct in grid.award_share_pcts:
        tata_tail = 1.0 - aw_pct
        header += f"  {tata_tail:>7.0%}"
    print(header)
    print("-" * (8 + len(grid.award_share_pcts) * 9))

    # Body
    for up_pct in grid.upfront_pcts:
        row = f"{up_pct:>8.0%}"
        for aw_pct in grid.award_share_pcts:
            key = (up_pct, aw_pct, basis)
            if key in grid.cells:
                moic = grid.cells[key].mean_moic
                if moic >= 1.0:
                    row += f"  {moic:>7.2f}"
                else:
                    row += f"  {moic:>6.2f}*"
            else:
                row += f"  {'N/A':>7}"
        print(row)

    # Breakeven
    print("-" * (8 + len(grid.award_share_pcts) * 9))
    be_row = f"{'Break-E':>8}"
    be = grid.breakeven.get(basis, {})
    for aw_pct in grid.award_share_pcts:
        max_up = be.get(aw_pct, 0.0)
        if max_up > 0:
            be_row += f"  {max_up:>7.0%}"
        else:
            be_row += f"  {'<5%':>7}"
    print(be_row)

    print(f"{'='*90}")
    print("* = E[MOIC] < 1.0 (expected loss)")
    print(f"Break-E = maximum upfront% where E[MOIC] >= 1.0")
    print(f"Column headers show Tata Tail % (fund keeps the complement)\n")


def print_per_claim_summary(
    grid: InvestmentGridResults,
    upfront_pct: float = 0.10,
    award_share_pct: float = 0.70,
    basis: str = "soc",
) -> None:
    """Print per-claim breakdown for one specific grid cell."""
    key = (upfront_pct, award_share_pct, basis)
    cell = grid.cells.get(key)
    if cell is None:
        print(f"No data for {upfront_pct:.0%}/{1-award_share_pct:.0%} Tata tail/{basis}")
        return

    tata_tail = 1.0 - award_share_pct
    print(f"\n{'='*80}")
    print(f"PER-CLAIM BREAKDOWN — {upfront_pct:.0%} upfront / "
          f"{tata_tail:.0%} Tata tail ({basis.upper()})")
    print(f"{'='*80}")
    print(
        f"{'Claim':<15} {'E[MOIC]':>8} {'E[XIRR]':>9} "
        f"{'P(IRR>30%)':>11}"
    )
    print("-" * 80)

    for cid, metrics in cell.per_claim.items():
        print(
            f"{cid:<15} {metrics['E[MOIC]']:>8.2f} "
            f"{metrics['E[XIRR]']:>9.1%} "
            f"{metrics['E[net_return_cr]']:>11.2f} "
            f"{metrics['P(loss)']:>8.1%} "
            f"{metrics['P(IRR>30%)']:>11.1%}"
        )

    print("-" * 80)
    print(
        f"{'PORTFOLIO':<15} {cell.mean_moic:>8.2f} "
        f"{cell.mean_xirr:>9.1%} "
        f"{cell.mean_net_return_cr:>11.2f} "
        f"{cell.p_loss:>8.1%} "
        f"{cell.p_irr_gt_30:>11.1%}"
    )
    print(f"{'='*80}\n")
