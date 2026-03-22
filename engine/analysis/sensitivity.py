"""
engine/analysis/sensitivity.py — Probability sensitivity via analytical reweighting.
=====================================================================================

Computes how shifting the arbitration win probability affects portfolio
metrics WITHOUT re-running Monte Carlo simulation.

Approach: analytical probability reweighting of MC-conditioned expectations.
  1. Partition MC paths by arb outcome (WIN/LOSE)
  2. Compute conditional E[MOIC], P(loss) per partition
  3. For each shifted arb_win_prob, analytically reweight

No re-simulation required — runs in < 1 second.

Ported from TATA_code_v2/v2_probability_sensitivity.py (arb_win category).
"""

from __future__ import annotations

from typing import Optional

import numpy as np

from engine.config.schema import (
    ClaimConfig,
    PathResult,
    SimulationConfig,
    PortfolioStructure,
)
from engine.simulation.cashflow_builder import (
    build_upfront_tail_cashflow,
    merge_dated_cashflows,
)
from engine.simulation.metrics import compute_xirr, compute_moic


# ===================================================================
# Constants
# ===================================================================

EPS: float = 0.01


def _clamp(p: float) -> float:
    """Clamp probability to [EPS, 1-EPS]."""
    return max(EPS, min(1.0 - EPS, p))


# ===================================================================
# Main entry point
# ===================================================================

def compute_arb_win_sensitivity(
    claims: list[ClaimConfig],
    all_path_results: dict[str, list[PathResult]],
    original_arb_win_prob: float,
    prob_range: Optional[np.ndarray] = None,
    structure: Optional[PortfolioStructure] = None,
    reference_upfront: float = 0.10,
    reference_tail: float = 0.20,
    start_date: str = "2026-04-30",
) -> list[dict]:
    """Compute sensitivity of portfolio metrics to arb win probability shift.

    For each shifted probability, reweight MC paths analytically without
    re-running the simulation.

    Parameters
    ----------
    claims : list[ClaimConfig]
    all_path_results : dict  {claim_id: [PathResult]}
    original_arb_win_prob : float  Base arb win probability
    prob_range : ndarray, optional  Probability values to evaluate
    structure : PortfolioStructure, optional
    reference_upfront : float  Reference upfront for metric computation
    reference_tail : float  Reference tail for metric computation
    start_date : str

    Returns
    -------
    list of {arb_win_prob, e_moic, e_irr, p_loss}
    """
    if prob_range is None:
        prob_range = np.arange(0.30, 0.96, 0.05)

    first_cid = claims[0].id
    n_paths = len(all_path_results.get(first_cid, []))

    # Pre-compute per-path portfolio MOIC at the reference deal point.
    # Also classify each path as "arb_won" for ALL claims by checking
    # whether the collected_cr > 0 (TRUE_WIN paths).
    path_moics = np.zeros(n_paths)
    path_xirrs = np.zeros(n_paths)
    path_arb_won_fracs = np.zeros(n_paths)  # fraction of claims that won arb

    for path_i in range(n_paths):
        portfolio_invested = 0.0
        portfolio_return = 0.0
        path_cfs: list[tuple[list, list]] = []
        n_won = 0

        for claim in claims:
            results = all_path_results.get(claim.id, [])
            if path_i >= len(results):
                continue
            pr = results[path_i]

            # Infer arb outcome from path: TRUE_WIN implies arb was won
            if pr.outcome == "TRUE_WIN" or pr.collected_cr > 0:
                n_won += 1

            dates, cfs, inv, ret = build_upfront_tail_cashflow(
                claim=claim,
                path_result=pr,
                upfront_pct=reference_upfront,
                tail_pct=reference_tail,
                pricing_basis="soc",
                start_date=start_date,
            )
            path_cfs.append((dates, cfs))
            portfolio_invested += inv
            portfolio_return += ret

        path_moics[path_i] = compute_moic(portfolio_return, portfolio_invested)
        path_arb_won_fracs[path_i] = n_won / max(len(claims), 1)

        if path_cfs:
            pd, pc = merge_dated_cashflows(path_cfs)
            path_xirrs[path_i] = compute_xirr(pd, pc) if len(pd) >= 2 else -1.0

    # For analytical reweighting, partition paths into "mostly won" vs "mostly lost"
    # A path is "won" if the majority of claims in that path had arb win
    won_mask = path_arb_won_fracs > 0.5

    # Base weights: under original probability
    p_orig = original_arb_win_prob
    n_won_paths = won_mask.sum()
    n_lost_paths = n_paths - n_won_paths

    results: list[dict] = []
    for p_shifted in prob_range:
        p_s = float(_clamp(p_shifted))

        # Importance weights: P_shifted(won)/P_orig(won) for won paths, etc.
        if n_won_paths > 0 and n_lost_paths > 0:
            w_won = p_s / p_orig if p_orig > 0 else 1.0
            w_lost = (1.0 - p_s) / (1.0 - p_orig) if (1.0 - p_orig) > 0 else 1.0

            weights = np.where(won_mask, w_won, w_lost)
            weights /= weights.sum()  # normalize

            e_moic = float(np.sum(weights * path_moics))
            e_irr = float(np.sum(weights * path_xirrs))
            p_loss = float(np.sum(weights * (path_moics < 1.0)))
        else:
            e_moic = float(np.mean(path_moics))
            e_irr = float(np.mean(path_xirrs))
            p_loss = float(np.mean(path_moics < 1.0))

        results.append({
            "arb_win_prob": round(p_s, 4),
            "e_moic": round(e_moic, 4),
            "e_irr": round(e_irr, 4),
            "p_loss": round(p_loss, 4),
        })

    return results
