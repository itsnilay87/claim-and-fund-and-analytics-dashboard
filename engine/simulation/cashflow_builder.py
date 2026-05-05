"""
engine/simulation/cashflow_builder.py — Structure-aware cashflow construction.
===============================================================================

Builds dated cashflow vectors for each of the 5 investment structures:
  1. Litigation funding (waterfall: min/max of cost multiple vs award ratio)
  2. Full claim purchase (monetisation)
  3. Upfront + tail (monetisation)
  4. Staged milestone payments (monetisation)
  5. Portfolio builder (per-path aggregation across claims)

Cashflow convention:
  Negative = investor outflow (money going out)
  Positive = investor inflow  (money coming in)

All monetary values in ₹ Crore.  All durations in months.

Ported from TATA_code_v2/v2_cashflow_builder.py with multi-structure support.
"""

from __future__ import annotations

import math
from datetime import datetime, timedelta
from typing import Optional, Union

import numpy as np

from engine.config.schema import (
    ClaimConfig,
    FullPurchaseParams,
    HybridPayoffParams,
    LitFundingParams,
    MilestonePayment,
    PathResult,
    PortfolioStructure,
    StagedPaymentParams,
    UpfrontTailParams,
)
from engine.simulation.metrics import merge_dated_cashflows


# ===================================================================
# Helper: month-end date generator
# ===================================================================

def _month_end(base: datetime, months_ahead: int) -> datetime:
    """Return the last day of the month that is `months_ahead` from base."""
    total_months = base.month - 1 + months_ahead
    year = base.year + total_months // 12
    month = total_months % 12 + 1
    if month == 12:
        return datetime(year, 12, 31)
    else:
        return datetime(year, month + 1, 1) - timedelta(days=1)


def _parse_start_date(start_date: str) -> datetime:
    """Parse ISO date string into datetime."""
    return datetime.strptime(start_date, "%Y-%m-%d")


def _spread_legal_costs(
    path_result: PathResult,
    payment_month: int,
) -> np.ndarray:
    """Spread total legal costs evenly across the timeline.

    Month 0 gets one-time costs (approximated as 30% of total).
    Remaining months share the rest evenly.

    The MC engine builds detailed monthly burn arrays but PathResult
    only stores total legal_costs_cr.  This reconstructs a reasonable
    approximation for cashflow dating.
    """
    total = path_result.legal_costs_cr
    if total <= 0 or payment_month <= 0:
        return np.zeros(payment_month + 1)

    burn = np.zeros(payment_month + 1)
    # Approximate one-time costs as ~30% paid at month 0
    one_time_frac = 0.30
    one_time = total * one_time_frac
    remaining = total - one_time

    burn[0] = one_time
    if payment_month > 0:
        monthly_rate = remaining / payment_month
        burn[1 : payment_month + 1] = monthly_rate

    return burn


# ===================================================================
# 1. Litigation Funding cashflow
# ===================================================================

def build_litigation_funding_cashflow(
    claim: ClaimConfig,
    path_result: PathResult,
    cost_multiple_cap: float,
    award_ratio_cap: float,
    waterfall_type: str = "min",
    start_date: str = "2026-04-30",
) -> tuple[list[datetime], list[float], float, float]:
    """Build cashflow for litigation funding structure.

    The funder bears all legal costs. On success, return is determined by
    a waterfall: min/max of (cost_multiple × costs, award_ratio × collected).

    Returns (dates, cashflows, total_invested, total_return).
    """
    start = _parse_start_date(start_date)
    payment_month = max(int(math.ceil(path_result.timeline_months)), 1)
    burn = _spread_legal_costs(path_result, payment_month)

    # Total invested = all legal costs borne by funder
    total_invested = float(np.sum(burn))

    # Determine gross return on success
    total_return = 0.0
    if path_result.outcome == "TRUE_WIN" and path_result.collected_cr > 0:
        leg_a = cost_multiple_cap * total_invested
        leg_b = award_ratio_cap * path_result.collected_cr
        if waterfall_type == "min":
            total_return = min(leg_a, leg_b)
        else:
            total_return = max(leg_a, leg_b)

    # Build dated cashflow vector
    n_months = payment_month + 1
    dates = [_month_end(start, m) for m in range(n_months)]
    cashflows = [0.0] * n_months

    # Month 0: one-time legal costs
    cashflows[0] = -burn[0]

    # Months 1..T-1: ongoing legal burn
    for m in range(1, payment_month):
        cashflows[m] = -burn[m]

    # Month T: final legal cost + return
    cashflows[payment_month] = -burn[payment_month] + total_return

    return dates, cashflows, total_invested, total_return


# ===================================================================
# 2. Full Purchase cashflow
# ===================================================================

def build_full_purchase_cashflow(
    claim: ClaimConfig,
    path_result: PathResult,
    purchase_price_cr: float,
    legal_cost_bearer: str = "investor",
    purchased_share_pct: float = 1.0,
    start_date: str = "2026-04-30",
) -> tuple[list[datetime], list[float], float, float]:
    """Build cashflow for full claim purchase structure.

    Investor buys the claim at a fixed price.  On success, receives
    purchased_share_pct × collected.

    legal_cost_bearer: "investor" | "claimant" | "shared"

    Returns (dates, cashflows, total_invested, total_return).
    """
    start = _parse_start_date(start_date)
    payment_month = max(int(math.ceil(path_result.timeline_months)), 1)

    # Determine legal cost share
    if legal_cost_bearer == "investor":
        cost_share = 1.0
    elif legal_cost_bearer == "claimant":
        cost_share = 0.0
    else:  # shared — default 50/50
        cost_share = 0.5

    burn = _spread_legal_costs(path_result, payment_month)
    burn *= cost_share

    # Investor inflow on success
    total_return = 0.0
    if path_result.outcome == "TRUE_WIN" and path_result.collected_cr > 0:
        total_return = purchased_share_pct * path_result.collected_cr

    # Total invested = purchase price + share of legal costs
    total_legal = float(np.sum(burn))
    total_invested = purchase_price_cr + total_legal

    # Build dated cashflow
    n_months = payment_month + 1
    dates = [_month_end(start, m) for m in range(n_months)]
    cashflows = [0.0] * n_months

    # Month 0: purchase price + one-time legal
    cashflows[0] = -purchase_price_cr - burn[0]

    # Months 1..T-1: ongoing legal burn
    for m in range(1, payment_month):
        cashflows[m] = -burn[m]

    # Month T: final legal + return
    cashflows[payment_month] = -burn[payment_month] + total_return

    return dates, cashflows, total_invested, total_return


# ===================================================================
# 3. Upfront + Tail cashflow
# ===================================================================

def build_upfront_tail_cashflow(
    claim: ClaimConfig,
    path_result: PathResult,
    upfront_pct: float,
    tail_pct: float,
    pricing_basis: str = "soc",
    start_date: str = "2026-04-30",
    expected_quantum_cr: Optional[float] = None,
) -> tuple[list[datetime], list[float], float, float]:
    """Build cashflow for upfront payment + tail (success fee) structure.

    Investor pays upfront_pct × basis at close, bears legal costs,
    and receives (1 - tail_pct) × collected on success.
    tail_pct is what the claimant keeps.

    Returns (dates, cashflows, total_invested, total_return).
    """
    start = _parse_start_date(start_date)
    payment_month = max(int(math.ceil(path_result.timeline_months)), 1)

    # Upfront payment
    if pricing_basis == "ev" and expected_quantum_cr is not None:
        upfront = upfront_pct * expected_quantum_cr
    else:
        upfront = upfront_pct * claim.soc_value_cr

    upfront = max(upfront, 1e-6)

    # Fund's share of award: fund keeps (1 - tail_pct)
    fund_share = 1.0 - tail_pct

    # Legal costs (investor bears all for upfront+tail)
    burn = _spread_legal_costs(path_result, payment_month)

    # Return on success
    total_return = 0.0
    if path_result.outcome == "TRUE_WIN" and path_result.collected_cr > 0:
        total_return = fund_share * path_result.collected_cr

    total_legal = float(np.sum(burn))
    total_invested = upfront + total_legal

    # Build dated cashflow
    n_months = payment_month + 1
    dates = [_month_end(start, m) for m in range(n_months)]
    cashflows = [0.0] * n_months

    # Month 0: upfront + one-time legal
    cashflows[0] = -upfront - burn[0]

    # Months 1..T-1: ongoing legal burn
    for m in range(1, payment_month):
        cashflows[m] = -burn[m]

    # Month T: final legal + return
    cashflows[payment_month] = -burn[payment_month] + total_return

    return dates, cashflows, total_invested, total_return


# ===================================================================
# 3b. Hybrid Payoff cashflow
# ===================================================================

def _hybrid_payoff_amount(
    upfront_cr: float,
    collected_cr: float,
    return_a_type: str,
    return_a_value: float,
    return_b_type: str,
    return_b_value: float,
    operator: str,
    min_payout: Optional[float],
    max_payout: Optional[float],
) -> float:
    """Inline copy of v2_cashflow_builder.compute_hybrid_payoff (avoid cross-package import)."""
    if collected_cr <= 0.0:
        return 0.0

    def _leg(kind: str, value: float) -> float:
        if kind == "multiple_of_upfront":
            return float(value) * float(upfront_cr)
        if kind == "pct_of_recovery":
            return float(value) * float(collected_cr)
        raise ValueError(f"Unknown return leg type: {kind!r}")

    a = _leg(return_a_type, return_a_value)
    b = _leg(return_b_type, return_b_value)
    payout = max(a, b) if operator == "max" else min(a, b)

    if min_payout is not None:
        payout = max(payout, float(min_payout))
    if max_payout is not None:
        payout = min(payout, float(max_payout))

    payout = min(payout, float(collected_cr))
    return max(payout, 0.0)


def build_hybrid_payoff_cashflow(
    claim: ClaimConfig,
    path_result: PathResult,
    upfront_basis: str,
    upfront_value: float,
    return_a_type: str,
    return_a_value: float,
    return_b_type: str,
    return_b_value: float,
    operator: str = "max",
    min_payout: Optional[float] = None,
    max_payout: Optional[float] = None,
    start_date: str = "2026-04-30",
    expected_quantum_cr: Optional[float] = None,
) -> tuple[list[datetime], list[float], float, float]:
    """Cashflow for the hybrid payoff structure (single claim, single MC path).

    Investor pays an upfront amount + bears legal costs, and on win receives
    a payout = clip(op(A, B), min, max), where A and B are independently
    parameterised as multiples of the upfront or fractions of recovery.

    See ``HybridPayoffParams`` for the full parameter spec.
    """
    start = _parse_start_date(start_date)
    payment_month = max(int(math.ceil(path_result.timeline_months)), 1)

    if upfront_basis == "fixed_amount":
        upfront = max(float(upfront_value), 1e-6)
    elif upfront_basis == "pct_eq" and expected_quantum_cr is not None:
        upfront = max(float(upfront_value) * float(expected_quantum_cr), 1e-6)
    else:
        upfront = max(float(upfront_value) * float(claim.soc_value_cr), 1e-6)

    burn = _spread_legal_costs(path_result, payment_month)

    payout = 0.0
    if path_result.outcome == "TRUE_WIN" and path_result.collected_cr > 0:
        payout = _hybrid_payoff_amount(
            upfront_cr=upfront,
            collected_cr=path_result.collected_cr,
            return_a_type=return_a_type,
            return_a_value=return_a_value,
            return_b_type=return_b_type,
            return_b_value=return_b_value,
            operator=operator,
            min_payout=min_payout,
            max_payout=max_payout,
        )

    total_legal = float(np.sum(burn))
    total_invested = upfront + total_legal

    n_months = payment_month + 1
    dates = [_month_end(start, m) for m in range(n_months)]
    cashflows = [0.0] * n_months
    cashflows[0] = -upfront - burn[0]
    for m in range(1, payment_month):
        cashflows[m] = -burn[m]
    cashflows[payment_month] = -burn[payment_month] + payout

    return dates, cashflows, total_invested, payout


# ===================================================================
# 4. Staged Milestone Payment cashflow
# ===================================================================

def _compute_milestone_month(
    milestone_name: str,
    claim: ClaimConfig,
) -> float:
    """Estimate the month at which a milestone is reached.

    We sum durations of pre-arb stages up to and including
    the stage matching the milestone, using midpoint estimates.
    Special milestone 'award_received' = sum of all pre-arb stages.
    """
    cumulative = 0.0
    for stage in claim.timeline.pre_arb_stages:
        mid = (stage.duration_low + stage.duration_high) / 2.0
        cumulative += mid
        if stage.name.lower() in milestone_name.lower():
            return cumulative

    # If milestone is 'award_received' or not found, return total pre-arb
    return cumulative


def build_staged_payment_cashflow(
    claim: ClaimConfig,
    path_result: PathResult,
    milestones: list[MilestonePayment],
    legal_cost_bearer: str = "investor",
    purchased_share_pct: float = 1.0,
    start_date: str = "2026-04-30",
) -> tuple[list[datetime], list[float], float, float]:
    """Build cashflow for staged (milestone-based) acquisition.

    Milestone payments are only made if the claim reaches that milestone
    (path timeline exceeds milestone month). If path terminates before
    a milestone, that tranche is not paid → total_invested is stochastic.

    Returns (dates, cashflows, total_invested, total_return).
    """
    start = _parse_start_date(start_date)
    payment_month = max(int(math.ceil(path_result.timeline_months)), 1)

    # Determine legal cost share
    if legal_cost_bearer == "investor":
        cost_share = 1.0
    elif legal_cost_bearer == "claimant":
        cost_share = 0.0
    else:
        cost_share = 0.5

    burn = _spread_legal_costs(path_result, payment_month)
    burn *= cost_share

    # Build cashflow array
    n_months = payment_month + 1
    dates = [_month_end(start, m) for m in range(n_months)]
    cashflows = [0.0] * n_months

    # Place one-time legal costs at month 0
    cashflows[0] = -burn[0]

    # Ongoing legal burn months 1..T
    for m in range(1, payment_month + 1):
        cashflows[m] = -burn[m]

    # Place milestone payments at their trigger months
    total_milestone_paid = 0.0
    for ms in milestones:
        ms_month = _compute_milestone_month(ms.milestone_name, claim)
        ms_month_int = min(int(math.ceil(ms_month)), payment_month)

        # Only pay if the path reaches this milestone
        if path_result.timeline_months >= ms_month:
            cashflows[ms_month_int] -= ms.payment_cr
            total_milestone_paid += ms.payment_cr

    # Return on success
    total_return = 0.0
    if path_result.outcome == "TRUE_WIN" and path_result.collected_cr > 0:
        total_return = purchased_share_pct * path_result.collected_cr

    # Add return at final month
    cashflows[payment_month] += total_return

    total_legal = float(np.sum(burn))
    total_invested = total_milestone_paid + total_legal

    return dates, cashflows, total_invested, total_return


# ===================================================================
# 5. Portfolio Cashflow Builder (single MC path)
# ===================================================================

def _build_single_claim_cashflow(
    claim: ClaimConfig,
    path_result: PathResult,
    structure: PortfolioStructure,
    start_date: str,
) -> tuple[list[datetime], list[float], float, float]:
    """Route to the appropriate structure-specific cashflow builder."""
    stype = structure.type

    if stype == "litigation_funding":
        params: LitFundingParams = structure.params  # type: ignore[assignment]
        return build_litigation_funding_cashflow(
            claim=claim,
            path_result=path_result,
            cost_multiple_cap=params.cost_multiple_cap,
            award_ratio_cap=params.award_ratio_cap,
            waterfall_type=params.waterfall_type,
            start_date=start_date,
        )

    elif stype == "monetisation_full_purchase":
        params_fp: FullPurchaseParams = structure.params  # type: ignore[assignment]
        # Use first purchase price
        price = params_fp.purchase_prices[0]
        if params_fp.pricing_basis == "soc":
            price_cr = price * claim.soc_value_cr
        else:
            price_cr = price
        return build_full_purchase_cashflow(
            claim=claim,
            path_result=path_result,
            purchase_price_cr=price_cr,
            legal_cost_bearer=params_fp.legal_cost_bearer,
            purchased_share_pct=params_fp.purchased_share_pct,
            start_date=start_date,
        )

    elif stype == "monetisation_upfront_tail":
        params_ut: UpfrontTailParams = structure.params  # type: ignore[assignment]
        upfront_pct = (params_ut.upfront_range.min + params_ut.upfront_range.max) / 2.0
        tail_pct = (params_ut.tail_range.min + params_ut.tail_range.max) / 2.0
        return build_upfront_tail_cashflow(
            claim=claim,
            path_result=path_result,
            upfront_pct=upfront_pct,
            tail_pct=tail_pct,
            pricing_basis=params_ut.pricing_basis if params_ut.pricing_basis != "both" else "soc",
            start_date=start_date,
        )

    elif stype == "monetisation_staged":
        params_sp: StagedPaymentParams = structure.params  # type: ignore[assignment]
        return build_staged_payment_cashflow(
            claim=claim,
            path_result=path_result,
            milestones=params_sp.milestones,
            legal_cost_bearer=params_sp.legal_cost_bearer,
            purchased_share_pct=params_sp.purchased_share_pct,
            start_date=start_date,
        )

    elif stype == "monetisation_hybrid_payoff":
        params_hp: HybridPayoffParams = structure.params  # type: ignore[assignment]
        return build_hybrid_payoff_cashflow(
            claim=claim,
            path_result=path_result,
            upfront_basis=params_hp.upfront_basis,
            upfront_value=params_hp.upfront_value,
            return_a_type=params_hp.return_a_type,
            return_a_value=params_hp.return_a_value,
            return_b_type=params_hp.return_b_type,
            return_b_value=params_hp.return_b_value,
            operator=params_hp.operator,
            min_payout=params_hp.min_payout,
            max_payout=params_hp.max_payout,
            start_date=start_date,
        )

    else:
        raise ValueError(f"Unsupported structure type for single-claim: {stype}")


def build_portfolio_cashflows(
    claims: list[ClaimConfig],
    all_path_results: dict[str, list[PathResult]],
    structure: PortfolioStructure,
    path_index: int,
    start_date: str = "2026-04-30",
) -> tuple[list[datetime], list[float], float, float]:
    """Build portfolio-level cashflow for a single MC path.

    For each claim, picks path_result[path_index] and builds the
    structure-appropriate cashflow, then merges all claims into
    a single portfolio cashflow.

    Returns (dates, cashflows, total_invested, total_return).
    """
    claim_cashflows: list[tuple[list[datetime], list[float]]] = []
    portfolio_invested = 0.0
    portfolio_return = 0.0

    for claim in claims:
        path_results = all_path_results.get(claim.id, [])
        if path_index >= len(path_results):
            continue

        pr = path_results[path_index]

        # For comparative type, use lit_funding_params
        if structure.type == "comparative":
            lf_params = structure.lit_funding_params
            dates, cfs, invested, ret = build_litigation_funding_cashflow(
                claim=claim,
                path_result=pr,
                cost_multiple_cap=lf_params.cost_multiple_cap,
                award_ratio_cap=lf_params.award_ratio_cap,
                waterfall_type=lf_params.waterfall_type,
                start_date=start_date,
            )
        else:
            dates, cfs, invested, ret = _build_single_claim_cashflow(
                claim, pr, structure, start_date,
            )

        claim_cashflows.append((dates, cfs))
        portfolio_invested += invested
        portfolio_return += ret

    merged_dates, merged_cfs = merge_dated_cashflows(claim_cashflows)
    return merged_dates, merged_cfs, portfolio_invested, portfolio_return
