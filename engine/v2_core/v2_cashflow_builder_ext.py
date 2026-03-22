"""
v2_cashflow_builder_ext.py — Extended cashflow builders for new investment structures.
======================================================================================

Adds Litigation Funding, Full Purchase, Staged Payments, and Comparative
cashflow construction alongside the existing upfront+tail model in
v2_cashflow_builder.py.

All monetary values in ₹ Crore.  All durations in months.
Cashflow convention: negative = investor outflow, positive = investor inflow.
"""

from __future__ import annotations

import math
from datetime import datetime, timedelta
from typing import Optional

import numpy as np

from . import v2_master_inputs as MI
from .v2_config import ClaimConfig, PathResult, SimulationResults
from .v2_cashflow_builder import (
    _month_end,
    _parse_start_date,
    merge_monthly_cashflows,
)


# ===================================================================
# Internal helpers
# ===================================================================

def _resolve_start_date(start_date: str) -> datetime:
    """Parse an ISO start-date string, falling back to MI.START_DATE."""
    if start_date:
        return datetime.strptime(start_date, "%Y-%m-%d")
    return _parse_start_date()


def _get_path_legal_burn(path_result: PathResult) -> np.ndarray:
    """Return monthly legal burn from PathResult (with flat-burn fallback)."""
    if path_result.monthly_legal_burn is not None and len(path_result.monthly_legal_burn) > 0:
        return path_result.monthly_legal_burn

    total_cost = path_result.legal_cost_total_cr
    total_months = max(int(np.ceil(path_result.total_duration_months)), 2)
    burn = np.zeros(total_months + 1)
    if total_months > 0 and total_cost > 0:
        burn[0] = total_cost * 0.05
        remaining = total_cost * 0.95
        if total_months > 0:
            burn[1:] = remaining / total_months
    return burn


def _sum_claim_legal_costs(
    claims: list[ClaimConfig],
    all_paths: list[list[PathResult]],
    path_idx: int,
) -> tuple[float, np.ndarray, int]:
    """Sum legal costs & monthly burns across all claims for one MC path.

    Returns
    -------
    (total_legal_cost, merged_monthly_burn, max_payment_month)
    """
    total_cost = 0.0
    burns: list[np.ndarray] = []
    max_month = 1

    for claim_results in all_paths:
        pr = claim_results[path_idx]
        total_cost += pr.legal_cost_total_cr
        burns.append(_get_path_legal_burn(pr))
        pm = max(int(math.ceil(pr.total_duration_months)), 1)
        max_month = max(max_month, pm)

    merged_burn = merge_monthly_cashflows(burns) if burns else np.array([0.0])
    return total_cost, merged_burn, max_month


def _any_claim_wins(
    all_paths: list[list[PathResult]],
    path_idx: int,
) -> bool:
    """Return True if any claim yields positive collected_cr in this path."""
    for claim_results in all_paths:
        if claim_results[path_idx].collected_cr > 0:
            return True
    return False


def _total_collected(
    all_paths: list[list[PathResult]],
    path_idx: int,
) -> float:
    """Sum collected_cr across all claims for one MC path."""
    return sum(cr[path_idx].collected_cr for cr in all_paths)


def _max_payment_month(
    all_paths: list[list[PathResult]],
    path_idx: int,
) -> int:
    """Latest payment month across all claims for one path."""
    m = 1
    for claim_results in all_paths:
        pm = max(int(math.ceil(claim_results[path_idx].total_duration_months)), 1)
        m = max(m, pm)
    return m


# ===================================================================
# Milestone → month mapping (for staged payments)
# ===================================================================

# Maps milestone names to cumulative V2 timeline stage offsets.
# Values are functions that compute the month from a PathResult.
_MILESTONE_MONTH_MAP = {
    "signing":       lambda _pr: 0,
    "dab_complete":  lambda pr: int(math.ceil(
        pr.timeline.dab_months if hasattr(pr.timeline, "dab_months") else 12
    )),
    "arb_commenced": lambda pr: int(math.ceil(
        (pr.timeline.dab_months if hasattr(pr.timeline, "dab_months") else 12)
    )),
    "arb_complete":  lambda pr: int(math.ceil(
        getattr(pr.timeline, "total_pre_challenge_months",
                pr.total_duration_months * 0.5)
    )),
    "award_received": lambda pr: int(math.ceil(pr.total_duration_months)),
    "s34_complete":  lambda pr: int(math.ceil(
        getattr(pr.timeline, "total_pre_challenge_months",
                pr.total_duration_months * 0.5)
        + getattr(pr.challenge, "s34_months", 12)
    )),
}


def _milestone_month(milestone_name: str, path_result: PathResult) -> int:
    """Return the month index at which a milestone triggers.

    Falls back to a fraction of total duration for unknown milestone names.
    """
    fn = _MILESTONE_MONTH_MAP.get(milestone_name)
    if fn is not None:
        return max(fn(path_result), 0)
    # Fallback: treat as fraction-of-total-duration
    return max(int(math.ceil(path_result.total_duration_months * 0.5)), 0)


def _milestone_triggered(
    milestone_month: int,
    resolution_month: int,
    claim_won: bool,
) -> bool:
    """Whether a milestone payment occurs given the claim outcome.

    A milestone is triggered only if it falls before or at the
    resolution month.  Milestones at resolution month are triggered
    only if the claim won (so that "award_received" triggers only on win).
    """
    if milestone_month < resolution_month:
        return True
    if milestone_month == resolution_month and claim_won:
        return True
    return False


# ===================================================================
# 1. Litigation Funding cashflow
# ===================================================================

def build_litigation_funding_cashflow(
    claims: list[ClaimConfig],
    all_paths: list[list[PathResult]],
    path_idx: int,
    cost_multiple: float,
    award_ratio: float,
    waterfall_type: str = "min",
    start_date: str = "2026-04-30",
) -> tuple[np.ndarray, float, float]:
    """Build cashflow for a litigation-funding structure on one MC path.

    Investment = total legal costs across all claims.
    Return on success = waterfall-capped share of collected award.
    Return on total loss = 0 (full loss of legal-cost investment).

    Returns
    -------
    (monthly_cashflow_vector, total_invested, fund_return)
    """
    total_legal, merged_burn, max_month = _sum_claim_legal_costs(
        claims, all_paths, path_idx,
    )
    collected = _total_collected(all_paths, path_idx)
    payment_month = _max_payment_month(all_paths, path_idx)
    n_months = payment_month + 1

    # Build outflow vector from merged legal burn
    cf = np.zeros(n_months)
    for m in range(min(len(merged_burn), n_months)):
        cf[m] -= merged_burn[m]

    # Determine fund return via waterfall
    fund_return = 0.0
    if collected > 0:
        cap_1 = cost_multiple * total_legal
        cap_2 = award_ratio * collected
        if waterfall_type == "min":
            fund_return = min(cap_1, cap_2)
        else:
            fund_return = max(cap_1, cap_2)
        # Floor: at least recover costs
        fund_return = max(fund_return, total_legal)

    cf[payment_month] += fund_return

    total_invested = max(total_legal, 0.0)
    return cf, total_invested, fund_return


# ===================================================================
# 2. Full Purchase cashflow
# ===================================================================

def build_full_purchase_cashflow(
    claims: list[ClaimConfig],
    all_paths: list[list[PathResult]],
    path_idx: int,
    purchase_price_cr: float,
    legal_cost_bearer: str = "investor",
    purchased_share_pct: float = 1.0,
    start_date: str = "2026-04-30",
) -> tuple[np.ndarray, float, float]:
    """Build cashflow for a full-purchase structure on one MC path.

    Investment = purchase_price at month 0, plus legal costs if investor bears them.
    Return = purchased_share_pct × total collected quantum + interest.

    Returns
    -------
    (monthly_cashflow, total_invested, total_return)
    """
    total_legal, merged_burn, _ = _sum_claim_legal_costs(
        claims, all_paths, path_idx,
    )
    collected = _total_collected(all_paths, path_idx)
    payment_month = _max_payment_month(all_paths, path_idx)
    n_months = payment_month + 1

    cf = np.zeros(n_months)

    # Month 0: purchase price (always)
    cf[0] -= purchase_price_cr

    # Legal costs — depends on bearer
    if legal_cost_bearer == "investor":
        for m in range(min(len(merged_burn), n_months)):
            cf[m] -= merged_burn[m]
        total_invested = purchase_price_cr + total_legal
    elif legal_cost_bearer == "shared":
        # Investor bears 50% by default (matching schema investor_cost_share_pct=1.0
        # which is 100%; but "shared" in the plan means 50/50 unless overridden)
        share = 0.5
        for m in range(min(len(merged_burn), n_months)):
            cf[m] -= merged_burn[m] * share
        total_invested = purchase_price_cr + total_legal * share
    else:
        # "seller" / "claimant" — investor bears no legal costs
        total_invested = purchase_price_cr

    # Inflow at payment month
    total_return = purchased_share_pct * collected
    cf[payment_month] += total_return

    return cf, total_invested, total_return


# ===================================================================
# 3. Staged Payment cashflow
# ===================================================================

def build_staged_payment_cashflow(
    claims: list[ClaimConfig],
    all_paths: list[list[PathResult]],
    path_idx: int,
    milestones: list[dict],
    legal_cost_bearer: str = "investor",
    purchased_share_pct: float = 1.0,
    start_date: str = "2026-04-30",
) -> tuple[np.ndarray, float, float]:
    """Build cashflow for a staged (milestone-triggered) acquisition on one MC path.

    Each milestone triggers a payment only if the claim hasn't already lost
    at a prior stage.  Investment = sum of triggered milestone payments + legal
    costs (if borne by investor).

    Parameters
    ----------
    milestones : list[dict]
        Each dict has ``milestone_name`` (str) and ``payment_cr`` (float).

    Returns
    -------
    (monthly_cashflow, total_invested, total_return)
    """
    total_legal, merged_burn, _ = _sum_claim_legal_costs(
        claims, all_paths, path_idx,
    )
    collected = _total_collected(all_paths, path_idx)
    payment_month = _max_payment_month(all_paths, path_idx)
    n_months = payment_month + 1

    cf = np.zeros(n_months)

    # Determine overall win (any claim) for milestone-trigger logic
    any_win = _any_claim_wins(all_paths, path_idx)

    # Use the first claim's PathResult for milestone timing
    # (for multi-claim portfolios, use the longest timeline)
    reference_pr = max(
        (cr[path_idx] for cr in all_paths),
        key=lambda pr: pr.total_duration_months,
    )
    resolution_month = max(int(math.ceil(reference_pr.total_duration_months)), 1)

    milestone_total = 0.0
    for ms in milestones:
        ms_name = ms.get("milestone_name", ms.get("name", "signing"))
        ms_payment = ms.get("payment_cr", 0.0)
        ms_month = _milestone_month(ms_name, reference_pr)

        if _milestone_triggered(ms_month, resolution_month, any_win):
            month_idx = min(ms_month, n_months - 1)
            cf[month_idx] -= ms_payment
            milestone_total += ms_payment

    # Legal costs
    total_invested = milestone_total
    if legal_cost_bearer == "investor":
        for m in range(min(len(merged_burn), n_months)):
            cf[m] -= merged_burn[m]
        total_invested += total_legal
    elif legal_cost_bearer == "shared":
        share = 0.5
        for m in range(min(len(merged_burn), n_months)):
            cf[m] -= merged_burn[m] * share
        total_invested += total_legal * share

    # Inflow
    total_return = purchased_share_pct * collected
    cf[payment_month] += total_return

    return cf, total_invested, total_return


# ===================================================================
# 4. Comparative cashflows (wrapper)
# ===================================================================

def build_comparative_cashflows(
    claims: list[ClaimConfig],
    all_paths: list[list[PathResult]],
    path_idx: int,
    structure_a_type: str,
    structure_a_params: dict,
    structure_b_type: str,
    structure_b_params: dict,
    start_date: str = "2026-04-30",
) -> tuple[tuple[np.ndarray, float, float], tuple[np.ndarray, float, float]]:
    """Build cashflows for two structures on the same MC path.

    Parameters
    ----------
    structure_a_type, structure_b_type : str
        One of "litigation_funding", "monetisation_full_purchase",
        "monetisation_staged", "monetisation_upfront_tail".
    structure_a_params, structure_b_params : dict
        Keyword arguments forwarded to the appropriate builder.

    Returns
    -------
    ((cf_a, inv_a, ret_a), (cf_b, inv_b, ret_b))
    """
    result_a = _dispatch_builder(
        claims, all_paths, path_idx,
        structure_a_type, structure_a_params, start_date,
    )
    result_b = _dispatch_builder(
        claims, all_paths, path_idx,
        structure_b_type, structure_b_params, start_date,
    )
    return result_a, result_b


def _dispatch_builder(
    claims: list[ClaimConfig],
    all_paths: list[list[PathResult]],
    path_idx: int,
    structure_type: str,
    params: dict,
    start_date: str,
) -> tuple[np.ndarray, float, float]:
    """Route to the correct cashflow builder based on structure_type."""
    if structure_type == "litigation_funding":
        return build_litigation_funding_cashflow(
            claims, all_paths, path_idx,
            cost_multiple=params.get("cost_multiple", 3.0),
            award_ratio=params.get("award_ratio", 0.30),
            waterfall_type=params.get("waterfall_type", "min"),
            start_date=start_date,
        )
    elif structure_type == "monetisation_full_purchase":
        return build_full_purchase_cashflow(
            claims, all_paths, path_idx,
            purchase_price_cr=params.get("purchase_price_cr", 100.0),
            legal_cost_bearer=params.get("legal_cost_bearer", "investor"),
            purchased_share_pct=params.get("purchased_share_pct", 1.0),
            start_date=start_date,
        )
    elif structure_type == "monetisation_staged":
        return build_staged_payment_cashflow(
            claims, all_paths, path_idx,
            milestones=params.get("milestones", []),
            legal_cost_bearer=params.get("legal_cost_bearer", "investor"),
            purchased_share_pct=params.get("purchased_share_pct", 1.0),
            start_date=start_date,
        )
    elif structure_type == "monetisation_upfront_tail":
        # Delegate to original v2_cashflow_builder for upfront+tail
        from .v2_cashflow_builder import build_cashflow_simple
        # For upfront+tail in comparative mode, we need a single claim reference
        # Use portfolio-level merge
        all_cfs: list[np.ndarray] = []
        total_inv = 0.0
        total_ret = 0.0
        for i, claim in enumerate(claims):
            pr = all_paths[i][path_idx]
            legal_burn = _get_path_legal_burn(pr)
            cf, inv, ret = build_cashflow_simple(
                claim=claim,
                total_duration_months=pr.total_duration_months,
                quantum_received_cr=pr.collected_cr,
                monthly_legal_burn=legal_burn,
                upfront_pct=params.get("upfront_pct", 0.10),
                tata_tail_pct=params.get("tata_tail_pct", 0.30),
                pricing_basis=params.get("pricing_basis", "soc"),
            )
            all_cfs.append(cf)
            total_inv += inv
            total_ret += ret
        merged = merge_monthly_cashflows(all_cfs)
        return merged, total_inv, total_ret
    else:
        raise ValueError(f"Unknown structure type: {structure_type}")
