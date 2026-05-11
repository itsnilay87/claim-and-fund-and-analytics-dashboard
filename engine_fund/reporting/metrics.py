"""Core reporting metrics for fund performance analysis.

This module provides functions for computing fund metrics, case metrics,
and collecting structured data from Fund and Bookkeeper objects.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import date
from typing import TYPE_CHECKING, Dict, List, Optional

import numpy as np
import pandas as pd

from ..utils.cashflow import compute_internal_rate_of_return

if TYPE_CHECKING:
    from ..accounting.bookkeeper import FundBookkeeper
    from ..core.models import Case, Fund


def _float(value: float) -> float:
    """Safely convert value to float, returning nan for None."""
    return float(value) if value is not None else float("nan")


def compute_investor_net_irr(events: List[Dict[str, object]]) -> float:
    """Compute net IRR for an investor from their event history.

    Args:
        events: List of investor events with 'event_type', 'amount', and 'date' keys.

    Returns:
        Annualized net IRR after fees, or nan if insufficient data.
    """
    if not events:
        return float("nan")

    cashflows: Dict[pd.Timestamp, float] = {}
    for event in events:
        event_type = event.get("event_type")
        if event_type not in {"drawdown", "return_of_capital", "profit_distribution"}:
            continue
        amount = float(event.get("amount", 0.0))
        if amount == 0.0:
            continue
        timestamp = pd.to_datetime(event.get("date"), errors="coerce")
        if pd.isna(timestamp):
            continue
        period = timestamp + pd.offsets.MonthEnd(0)
        value = -amount if event_type == "drawdown" else amount
        cashflows[period] = cashflows.get(period, 0.0) + value

    if not cashflows:
        return float("nan")

    periods = sorted(cashflows)
    date_index = pd.date_range(periods[0], periods[-1], freq="ME")
    flows = [cashflows.get(period, 0.0) for period in date_index]
    try:
        monthly_irr = compute_internal_rate_of_return(flows)
    except (ValueError, RuntimeError, FloatingPointError):
        return float("nan")
    if not np.isfinite(monthly_irr):
        return float("nan")
    return float((1.0 + monthly_irr) ** 12 - 1.0)


def compute_cashflow_summary(series: Optional[pd.Series]) -> Dict[str, float]:
    """Compute summary metrics for a cashflow series.

    Args:
        series: Pandas Series of cashflows (negative = outflows, positive = inflows).

    Returns:
        Dictionary with monthly_irr, annualised_irr, outflows, inflows, roic.
    """
    summary = {
        "monthly_irr": float("nan"),
        "annualised_irr": float("nan"),
        "outflows": 0.0,
        "inflows": 0.0,
        "roic": float("nan"),
    }

    if series is None or series.empty:
        return summary

    values = series.to_numpy(dtype=float)
    if values.size == 0:
        return summary

    idx = np.nonzero(values)[0]
    if idx.size:
        trimmed = values[: idx[-1] + 1]
        trimmed = np.trim_zeros(np.trim_zeros(trimmed, "f"), "b")
    else:
        trimmed = np.array([], dtype=float)

    if trimmed.size:
        try:
            monthly_irr = compute_internal_rate_of_return(trimmed)
        except (ValueError, RuntimeError, FloatingPointError):
            monthly_irr = float("nan")
        if np.isfinite(monthly_irr):
            summary["monthly_irr"] = float(monthly_irr)
            summary["annualised_irr"] = float((1.0 + monthly_irr) ** 12 - 1.0)

        outflows = -trimmed[trimmed < 0].sum()
        inflows = trimmed[trimmed > 0].sum()
    else:
        outflows = 0.0
        inflows = 0.0

    summary["outflows"] = float(outflows)
    summary["inflows"] = float(inflows)
    if outflows > 0:
        summary["roic"] = float(inflows / outflows)

    return summary


def _month_delta(start: Optional[pd.Timestamp], end: Optional[pd.Timestamp]) -> Optional[int]:
    """Calculate the number of months between two timestamps."""
    if start is None or end is None:
        return None
    return (end.year - start.year) * 12 + (end.month - start.month)


def compute_fund_metrics(
    forecast: pd.Series,
    *,
    monthly_status: pd.Series,
    commitment_start_date: date,
    monthly_fees: pd.Series,
    total_committed_capital: float,
    ledger_lines: pd.DataFrame,
    gross_investment_cashflow: Optional[pd.Series] = None,
) -> Dict[str, float]:
    """Compute comprehensive fund-level performance metrics.

    Args:
        forecast: Net cashflow forecast series.
        monthly_status: Fund status per period ('Commitment', 'Harvest', 'Closed').
        commitment_start_date: Date when commitment period started.
        monthly_fees: Management fees per period.
        total_committed_capital: Total committed capital amount.
        ledger_lines: Ledger lines DataFrame for carried interest calculation.
        gross_investment_cashflow: Optional gross investment cashflow series.

    Returns:
        Dictionary of fund metrics including IRR, ROIC, fees, duration.
    """
    net_summary = compute_cashflow_summary(forecast)
    monthly_irr = net_summary["monthly_irr"]
    annual_irr = net_summary["annualised_irr"]
    outflows = net_summary["outflows"]
    inflows = net_summary["inflows"]
    roic = net_summary["roic"]

    harvest_months = monthly_status[monthly_status == "Harvest"]
    if not harvest_months.empty:
        period_end_ts = harvest_months.index.max()
    else:
        active_months = monthly_status[monthly_status == "Commitment"]
        period_end_ts = active_months.index.max() if not active_months.empty else None

    if period_end_ts is not None:
        period_end_date = date(period_end_ts.year, period_end_ts.month, 1)
        months_elapsed = (
            (period_end_date.year - commitment_start_date.year) * 12
            + (period_end_date.month - commitment_start_date.month)
            + 1
        )
        fund_duration_months = float(months_elapsed if months_elapsed > 0 else 0)
    else:
        fund_duration_months = 0.0

    duration_years = fund_duration_months / 12.0 if fund_duration_months > 0 else float("nan")

    active_mask = monthly_status.isin({"Commitment", "Harvest"})
    active_index = monthly_status.index[active_mask]
    total_management_fee = float(monthly_fees.loc[active_index].sum()) if len(active_index) else 0.0

    if total_committed_capital > 0:
        total_management_fee_pct = total_management_fee / total_committed_capital
    else:
        total_management_fee_pct = float("nan")

    if np.isfinite(duration_years) and duration_years > 0:
        annualised_management_fee_pct = total_management_fee_pct / duration_years
    else:
        annualised_management_fee_pct = float("nan")

    carry_lines = ledger_lines[ledger_lines["account_code"] == "6910"]
    total_carried_interest = float(carry_lines["debit"].sum()) if not carry_lines.empty else 0.0

    gross_summary = compute_cashflow_summary(gross_investment_cashflow)
    gross_outflows = gross_summary["outflows"]
    gross_inflows = gross_summary["inflows"]
    gross_monthly_irr = gross_summary["monthly_irr"]
    gross_annualised_irr = gross_summary["annualised_irr"]
    gross_roic = gross_summary["roic"]
    gross_investment_returns = gross_inflows - gross_outflows

    if gross_investment_returns > 0:
        total_carried_interest_pct = total_carried_interest / gross_investment_returns
    elif total_committed_capital > 0:
        total_carried_interest_pct = total_carried_interest / total_committed_capital
    else:
        total_carried_interest_pct = float("nan")

    if np.isfinite(duration_years) and duration_years > 0:
        annualised_carried_interest_pct = total_carried_interest_pct / duration_years
    else:
        annualised_carried_interest_pct = float("nan")

    tolerance = 1e-6
    forecast_values = forecast.astype(float)
    cumulative = forecast_values.cumsum()
    activity_mask = forecast_values.abs() > tolerance
    first_activity_ts: Optional[pd.Timestamp] = None
    if activity_mask.any():
        first_activity_position = int(np.argmax(activity_mask.values))
        first_activity_ts = forecast_values.index[first_activity_position]

    break_even_candidates = cumulative[cumulative >= -tolerance]
    if first_activity_ts is not None:
        break_even_candidates = break_even_candidates[break_even_candidates.index >= first_activity_ts]
    break_even_ts = break_even_candidates.index[0] if not break_even_candidates.empty else None

    commitment_mask = monthly_status == "Commitment"
    commitment_periods = monthly_status.index[commitment_mask]
    months_to_target_deployment = int(len(commitment_periods)) if len(commitment_periods) else None
    deployment_target_ts = commitment_periods[-1] if len(commitment_periods) else None

    months_to_break_even = _month_delta(first_activity_ts, break_even_ts)

    metrics = {
        "net_monthly_irr": monthly_irr,
        "net_annualised_irr": annual_irr,
        "total_outflows": outflows,
        "total_inflows": inflows,
        "roic": roic,
        "fund_duration_months": fund_duration_months,
        "total_management_fee": total_management_fee,
        "total_management_fee_pct": total_management_fee_pct,
        "annualised_management_fee_pct": annualised_management_fee_pct,
        "total_carried_interest": total_carried_interest,
        "total_carried_interest_pct": total_carried_interest_pct,
        "annualised_carried_interest_pct": annualised_carried_interest_pct,
        "gross_investment_returns": gross_investment_returns,
        "gross_total_outflows": gross_outflows,
        "gross_total_inflows": gross_inflows,
        "gross_monthly_irr": gross_monthly_irr,
        "gross_annualised_irr": gross_annualised_irr,
        "gross_roic": gross_roic,
        "break_even_date": break_even_ts.date().isoformat() if break_even_ts is not None else None,
        "months_to_break_even": float(months_to_break_even) if months_to_break_even is not None else None,
        "deployment_target_date": deployment_target_ts.date().isoformat() if deployment_target_ts is not None else None,
        "months_to_target_deployment": float(months_to_target_deployment) if months_to_target_deployment is not None else None,
    }

    currency_keys = [
        "total_outflows",
        "total_inflows",
        "total_management_fee",
        "total_carried_interest",
        "gross_investment_returns",
        "gross_total_outflows",
        "gross_total_inflows",
    ]
    for key in currency_keys:
        if isinstance(metrics[key], (int, float)):
            metrics[key] = float(round(metrics[key], 2))

    if isinstance(metrics["fund_duration_months"], (int, float)):
        metrics["fund_duration_months"] = float(round(metrics["fund_duration_months"], 2))

    if metrics["months_to_break_even"] is not None:
        metrics["months_to_break_even"] = float(metrics["months_to_break_even"])

    if metrics["months_to_target_deployment"] is not None:
        metrics["months_to_target_deployment"] = float(metrics["months_to_target_deployment"])

    return metrics


def compute_case_metrics(
    cases: List["Case"],
    case_cashflows: Dict[int, pd.Series],
    case_outcomes: Dict[int, tuple],
) -> pd.DataFrame:
    """Compute performance metrics for each case in the portfolio.

    Args:
        cases: List of Case objects.
        case_cashflows: Dictionary mapping case_id to cashflow series.
        case_outcomes: Dictionary mapping case_id to outcome tuple.

    Returns:
        DataFrame with case-level metrics.
    """
    records = []
    for case in cases:
        series = case_cashflows[case.case_id]
        values = series.to_numpy()
        idx = np.nonzero(values)[0]
        if idx.size:
            trimmed = values[: idx[-1] + 1]
            trimmed = np.trim_zeros(np.trim_zeros(trimmed, "f"), "b")
        else:
            trimmed = np.array([], dtype=float)

        monthly_irr = compute_internal_rate_of_return(trimmed) if trimmed.size else float("nan")
        annual_irr = (1.0 + monthly_irr) ** 12 - 1.0 if np.isfinite(monthly_irr) else float("nan")
        outflows = -trimmed[trimmed < 0].sum() if trimmed.size else 0.0
        inflows = trimmed[trimmed > 0].sum() if trimmed.size else 0.0
        roic = inflows / outflows if outflows > 0 else float("nan")

        payout, monthly_cost, end_date, initial_payment, final_investment, trial_outcome = case_outcomes[case.case_id]

        records.append(
            {
                "case_id": case.case_id,
                "name": case.name,
                "gross_monthly_irr": _float(monthly_irr),
                "gross_annualised_irr": _float(annual_irr),
                "roic": _float(roic),
                "payout": _float(payout),
                "monthly_cost": _float(monthly_cost),
                "resolution_date": end_date.isoformat() if hasattr(end_date, "isoformat") else str(end_date),
                "initial_payment": _float(initial_payment),
                "final_investment": _float(final_investment),
                "total_cash_outflows": _float(outflows),
                "total_cash_inflows": _float(inflows),
                "trial_outcome": trial_outcome,
            }
        )
    return pd.DataFrame.from_records(records)


# -----------------------------------------------------------------------------
# Data Collection Functions
# -----------------------------------------------------------------------------


def collect_fund_metadata(fund: "Fund") -> Dict[str, float]:
    """Collect fund-level metadata as a dictionary.

    Args:
        fund: Fund object to extract metadata from.

    Returns:
        Dictionary of fund metadata fields.
    """
    return {
        "name": fund.name,
        "committed_capital": float(fund.committed_capital),
        "fund_size": float(fund.fund_size),
        "capital_reserve": float(fund.capital_reserve),
        "regulatory_concentration_limit": float(fund.regulatory_concentration_limit),
        "fund_concentration_limit": float(fund.fund_concentration_limit),
        "deployment_limit_tolerance": float(fund.deployment_limit_tolerance),
        "monetisation_ratio": float(fund.monetisation_ratio),
        "case_origination_rate": float(fund.case_origination_rate),
        "average_quantum": float(fund.average_quantum),
        "quantum_std_dev": float(fund.quantum_std_dev),
        "average_prob_success": float(fund.average_prob_success),
        "prob_success_std_dev": float(fund.prob_success_std_dev),
        "average_duration": float(fund.average_duration),
        "duration_std_dev": float(fund.duration_std_dev),
        "audit_base_fee_inr": float(fund.audit_base_fee_inr),
        "audit_fee_per_case_inr": float(fund.audit_fee_per_case_inr),
    }


def collect_unit_classes(fund: "Fund") -> pd.DataFrame:
    """Collect unit class information as a DataFrame.

    Args:
        fund: Fund object with unit_classes attribute.

    Returns:
        DataFrame with class_name, management_fee_rate, performance_fee_rate.
    """
    records = []
    for unit_class in fund.unit_classes.values():
        records.append(
            {
                "class_name": unit_class.class_name,
                "management_fee_rate": float(unit_class.management_fee_rate),
                "performance_fee_rate": float(unit_class.performance_fee_rate),
            }
        )
    return pd.DataFrame.from_records(records)


def collect_unit_class_totals(fund: "Fund") -> pd.DataFrame:
    """Collect unit class totals aggregated across investors.

    Args:
        fund: Fund object with unit_holdings attribute.

    Returns:
        DataFrame with totals per unit class.
    """
    records = []
    for holding in getattr(fund, "unit_holdings", []):
        unit_class = getattr(holding, "unit_class", None)
        investor = getattr(holding, "investor", None)
        class_name = unit_class.class_name if unit_class else ""
        units = float(getattr(holding, "number_of_units", 0.0) or 0.0)
        if units <= 0.0:
            continue
        unit_price = float(getattr(holding, "unit_price", 0.0) or 0.0)
        committed_amount = units * unit_price
        records.append(
            {
                "class_name": class_name,
                "investor": investor.name if investor else "",
                "number_of_units": units,
                "unit_price": unit_price,
                "committed_amount": committed_amount,
            }
        )

    if records:
        holdings_df = pd.DataFrame.from_records(records)
        totals = (
            holdings_df.groupby("class_name")
            .agg(
                total_units=("number_of_units", "sum"),
                committed_capital=("committed_amount", "sum"),
                investor_count=("investor", "nunique"),
            )
        )
    else:
        totals = pd.DataFrame(columns=["class_name", "total_units", "committed_capital", "investor_count"])
        totals.set_index("class_name", inplace=True)

    class_index = pd.Index([unit_class.class_name for unit_class in fund.unit_classes.values()], name="class_name")
    if not totals.empty:
        totals = totals.reindex(class_index, fill_value=0.0)
    else:
        totals = pd.DataFrame(index=class_index, columns=["total_units", "committed_capital", "investor_count"], data=0.0)

    def _unit_face_value(name: str) -> float:
        unit_class = fund.unit_classes.get(name)
        return float(getattr(unit_class, "unit_face_value", float("nan"))) if unit_class else float("nan")

    totals["unit_face_value"] = totals.index.map(_unit_face_value)
    totals["average_unit_price"] = np.where(
        totals["total_units"] > 0.0,
        totals["committed_capital"] / totals["total_units"],
        totals["unit_face_value"],
    )
    totals = totals.reset_index()
    column_order = [
        "class_name",
        "total_units",
        "unit_face_value",
        "average_unit_price",
        "committed_capital",
        "investor_count",
    ]
    return totals[column_order]


def collect_investors(fund: "Fund", bookkeeper: "FundBookkeeper") -> pd.DataFrame:
    """Collect investor data including their performance metrics.

    Args:
        fund: Fund object with investors.
        bookkeeper: FundBookkeeper with investor state and events.

    Returns:
        DataFrame with investor-level data.
    """
    state_by_name = {state.name: state for state in getattr(bookkeeper, "_investors", [])}
    events_by_investor: Dict[str, List[Dict[str, object]]] = defaultdict(list)
    for event in getattr(bookkeeper, "_investor_events", []):
        events_by_investor[event["investor"]].append(event)

    holdings_by_investor: Dict[str, Dict[str, float]] = defaultdict(lambda: defaultdict(float))
    for holding in getattr(fund, "unit_holdings", []):
        investor = getattr(holding, "investor", None)
        unit_class = getattr(holding, "unit_class", None)
        if investor is None or unit_class is None:
            continue
        class_name = unit_class.class_name
        units = float(getattr(holding, "number_of_units", 0.0) or 0.0)
        if units <= 0.0:
            continue
        holdings_by_investor[investor.name][class_name] += units

    records = []
    for investor in fund.investors:
        state = state_by_name.get(investor.name)
        events = events_by_investor.get(investor.name, [])
        net_irr = compute_investor_net_irr(events)
        holdings = holdings_by_investor.get(investor.name, {})
        records.append(
            {
                "investor_id": investor.investor_id,
                "name": investor.name,
                "committed_capital": float(investor.committed_capital),
                "investment_date": investor.investment_date.isoformat(),
                "jurisdiction": investor.jurisdiction,
                "carry_rate_paid": float(getattr(investor, "carry_rate", 0.0) or 0.0),
                "carry_recipient_rate": float(getattr(investor, "carry_recipient_rate", 0.0) or 0.0),
                "units_subscribed": float(getattr(investor, "units_subscribed", 0.0) or 0.0),
                "drawdowns": float(state.contributed) if state else 0.0,
                "distributions": float(state.distributed) if state else 0.0,
                "management_fee_paid": float(state.management_fees) if state else 0.0,
                "carried_interest_deducted": float(getattr(state, "carried_interest", 0.0)) if state else 0.0,
                "carried_interest_clawback_reserved": float(getattr(state, "carry_clawback", 0.0)) if state else 0.0,
                "net_irr_after_fees": net_irr,
                "Class A": holdings.get("A1", 0.0) + holdings.get("A", 0.0),
                "Class B": holdings.get("B", 0.0),
            }
        )
    df = pd.DataFrame.from_records(records)
    if not df.empty:
        column_order = [
            "investor_id",
            "name",
            "Class A",
            "Class B",
            "committed_capital",
            "investment_date",
            "jurisdiction",
            "units_subscribed",
            "carry_rate_paid",
            "carry_recipient_rate",
            "drawdowns",
            "distributions",
            "management_fee_paid",
            "carried_interest_deducted",
            "carried_interest_clawback_reserved",
            "net_irr_after_fees",
        ]
        existing = [col for col in column_order if col in df.columns]
        remaining = [col for col in df.columns if col not in existing]
        df = df[existing + remaining]
    return df


def collect_cases(fund: "Fund") -> pd.DataFrame:
    """Collect case portfolio data as a DataFrame.

    Args:
        fund: Fund object with portfolio of cases.

    Returns:
        DataFrame with case-level data.
    """
    records = []
    for case in fund.portfolio:
        records.append(
            {
                "case_id": case.case_id,
                "name": case.name,
                "case_type": case.case_type,
                "start_date": case.start_date.isoformat(),
                "settlement_outcome": bool(case.settlement_outcome),
                "quantum": _float(getattr(case, "quantum", np.nan)),
                "prob_success": _float(getattr(case, "prob_success", np.nan)),
                "original_duration_months": _float(getattr(case, "original_duration_months", np.nan)),
                "settlement_quantum_pct": _float(case.settlement_quantum_pct),
                "settlement_duration_pct": _float(case.settlement_duration_pct),
                "payout_cap_pct": _float(case.payout_cap_pct),
                "initial_payment_pct": _float(case.initial_payment_pct),
                "monthly_base_cost": _float(case.monthly_base_cost),
                "excess_cost_threshold": _float(case.excess_cost_threshold),
                "excess_cost_rate": _float(case.excess_cost_rate),
                "payout_multiple": _float(case.payout_multiple),
                "award_ratio": _float(case.award_ratio),
            }
        )
    return pd.DataFrame.from_records(records)


def merge_case_profiles(cases_df: pd.DataFrame, metrics_df: pd.DataFrame) -> pd.DataFrame:
    """Merge case profile data with computed metrics.

    Args:
        cases_df: DataFrame from collect_cases.
        metrics_df: DataFrame from compute_case_metrics.

    Returns:
        Merged DataFrame with all case information.
    """
    merged = cases_df.merge(metrics_df, on=["case_id", "name"], how="left")

    merged["win"] = merged["payout"].fillna(0.0) > 0.0
    merged["win"] = merged["win"].astype(bool)
    if "trial_outcome" in merged.columns:
        merged["trial_outcome"] = merged["trial_outcome"].astype("boolean")

    start_dt = pd.to_datetime(merged["start_date"], errors="coerce")
    resolution_dt = pd.to_datetime(merged["resolution_date"], errors="coerce")
    duration_months = (resolution_dt - start_dt).dt.days.div(30.4375)
    merged["actual_duration_months"] = duration_months.astype(float)

    columns = [
        "case_id",
        "name",
        "case_type",
        "win",
        "trial_outcome",
        "settlement_outcome",
        "start_date",
        "resolution_date",
        "original_duration_months",
        "actual_duration_months",
        "quantum",
        "prob_success",
        "payout",
        "payout_multiple",
        "award_ratio",
        "gross_monthly_irr",
        "gross_annualised_irr",
        "roic",
        "total_cash_outflows",
        "total_cash_inflows",
        "monthly_cost",
        "initial_payment",
        "final_investment",
        "settlement_quantum_pct",
        "settlement_duration_pct",
        "payout_cap_pct",
        "initial_payment_pct",
        "monthly_base_cost",
        "excess_cost_threshold",
        "excess_cost_rate",
    ]

    ordered_columns = [col for col in columns if col in merged.columns]
    other_columns = [col for col in merged.columns if col not in ordered_columns]
    ordered_columns.extend(other_columns)

    merged = merged[ordered_columns]
    merged["actual_duration_months"] = merged["actual_duration_months"].round(2)

    return merged


# Backwards compatibility aliases
_compute_investor_net_irr = compute_investor_net_irr
_compute_fund_metrics = compute_fund_metrics
_compute_case_metrics = compute_case_metrics
_compute_cashflow_summary = compute_cashflow_summary
_collect_fund_metadata = collect_fund_metadata
_collect_unit_classes = collect_unit_classes
_collect_unit_class_totals = collect_unit_class_totals
_collect_investors = collect_investors
_collect_cases = collect_cases
_merge_case_profiles = merge_case_profiles
