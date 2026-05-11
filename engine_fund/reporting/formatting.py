"""Formatting helpers for dashboard and diagnostics outputs."""

from __future__ import annotations

from typing import Dict, List, Optional, Tuple

from ..utils.cashflow import USDINR

FUND_METADATA_CURRENCY_FIELDS: Dict[str, str] = {
    "committed_capital": "Committed Capital",
    "fund_size": "Fund Size",
    "average_quantum": "Average Quantum",
    "quantum_std_dev": "Quantum Standard Dev",
    "audit_base_fee_inr": "Audit Base Fee",
    "audit_fee_per_case_inr": "Audit Fee Per Case",
}

FUND_METADATA_PERCENT_FIELDS: Dict[str, str] = {
    "capital_reserve": "Capital Reserve",
    "regulatory_concentration_limit": "Regulatory Concentration Limit",
    "fund_concentration_limit": "Fund Concentration Limit",
    "deployment_limit_tolerance": "Deployment Limit Tolerance",
    "monetisation_ratio": "Monetisation Ratio",
    "average_prob_success": "Average Prob Success",
    "prob_success_std_dev": "Prob Success Std Dev",
}

FUND_METRICS_CURRENCY_FIELDS: Dict[str, str] = {
    "total_outflows": "Total Outflows",
    "total_inflows": "Total Inflows",
    "total_management_fee": "Total Management Fee",
    "total_fees_and_expenses": "Total Fees & Expenses",
    "total_carried_interest": "Total Carried Interest",
    "gross_investment_returns": "Gross Investment Returns",
    "gross_total_outflows": "Gross Total Outflows",
    "gross_total_inflows": "Gross Total Inflows",
}

FUND_METRICS_PERCENT_FIELDS: Dict[str, str] = {
    "net_monthly_irr": "Net Monthly IRR",
    "net_annualised_irr": "Net Annualised IRR",
    "gross_monthly_irr": "Gross Monthly IRR",
    "gross_annualised_irr": "Gross Annualised IRR",
    "total_management_fee_pct": "Total Management Fee Pct",
    "total_carried_interest_pct": "Total Carried Interest Pct",
    "annualised_management_fee_pct": "Annualised Management Fee Pct",
    "annualised_carried_interest_pct": "Annualised Carried Interest Pct",
    "hybrid_cagr": "Hybrid CAGR",
    "hybrid_deposit_rate": "Hybrid Deposit Rate",
}

FUND_METRICS_MULTIPLE_FIELDS: Dict[str, str] = {
    "roic": "ROIC Multiple",
    "gross_roic": "Gross ROIC Multiple",
}


def _format_inr_usd(amount: Optional[float], exchange_rate: float) -> str:
    if amount is None:
        return "—"
    inr_crore = amount / 1e7
    usd_amount = amount / exchange_rate if exchange_rate else 0.0
    return f"INR {inr_crore:,.2f} cr / USD {usd_amount:,.2f}"


def _format_percent(value: Optional[float]) -> str:
    if value is None:
        return "—"
    return f"{value * 100:,.2f}%"


def _format_multiple(value: Optional[float]) -> str:
    if value is None:
        return "—"
    return f"{value:,.2f}x"


def _build_rows(
    data: Optional[Dict[str, object]],
    currency_fields: Optional[Dict[str, str]],
    percent_fields: Optional[Dict[str, str]],
    exchange_rate: float,
    *,
    multiple_fields: Optional[Dict[str, str]] = None,
) -> Tuple[List[Dict[str, str]], Dict[str, str]]:
    rows: List[Dict[str, str]] = []
    formatted: Dict[str, str] = {}

    for key, label in (currency_fields or {}).items():
        amount = (data or {}).get(key)
        if amount is None:
            continue
        formatted_value = _format_inr_usd(float(amount), exchange_rate)
        rows.append({"key": label, "value": formatted_value})
        formatted[label] = formatted_value

    for key, label in (percent_fields or {}).items():
        value = (data or {}).get(key)
        if value is None:
            continue
        formatted_value = _format_percent(float(value))
        rows.append({"key": label, "value": formatted_value})
        formatted[label] = formatted_value

    for key, label in (multiple_fields or {}).items():
        value = (data or {}).get(key)
        if value is None:
            continue
        formatted_value = _format_multiple(float(value))
        rows.append({"key": label, "value": formatted_value})
        formatted[label] = formatted_value

    return rows, formatted


def build_formatted_sections(
    fund_metadata: Optional[Dict[str, object]],
    fund_metrics: Optional[Dict[str, object]],
    exchange_rate: Optional[float] = None,
) -> Tuple[List[Dict[str, str]], List[Dict[str, str]], Dict[str, str], Dict[str, str]]:
    """Return formatted rows and dicts for metadata and metrics tables."""

    effective_rate = exchange_rate or USDINR

    metadata_rows: List[Dict[str, str]] = []
    metadata_dict: Dict[str, str] = {}

    if effective_rate:
        rate_display = f"1 USD = INR {effective_rate:,.2f}"
        metadata_rows.append({"key": "USD to INR Exchange Rate", "value": rate_display})
        metadata_dict["USD to INR Exchange Rate"] = rate_display

    fund_name = (fund_metadata or {}).get("name")
    if fund_name:
        metadata_rows.append({"key": "Fund Name", "value": str(fund_name)})
        metadata_dict["Fund Name"] = str(fund_name)

    meta_rows, meta_dict = _build_rows(
        fund_metadata,
        FUND_METADATA_CURRENCY_FIELDS,
        FUND_METADATA_PERCENT_FIELDS,
        effective_rate,
    )
    metadata_rows.extend(meta_rows)
    metadata_dict.update(meta_dict)

    commitment_start = (fund_metadata or {}).get("commitment_start_date")
    if commitment_start:
        metadata_rows.append({"key": "Commitment Start Date", "value": str(commitment_start)})
        metadata_dict["Commitment Start Date"] = str(commitment_start)

    average_duration = (fund_metadata or {}).get("average_duration")
    if average_duration is not None:
        formatted_avg_duration = f"{float(average_duration):,.1f} months"
        metadata_rows.append({"key": "Average Duration", "value": formatted_avg_duration})
        metadata_dict["Average Duration"] = formatted_avg_duration

    duration_std_dev = (fund_metadata or {}).get("duration_std_dev")
    if duration_std_dev is not None:
        formatted_duration_std = f"{float(duration_std_dev):,.1f} months"
        metadata_rows.append({"key": "Duration Std Dev", "value": formatted_duration_std})
        metadata_dict["Duration Std Dev"] = formatted_duration_std

    metrics_rows, metrics_dict = _build_rows(
        fund_metrics,
        FUND_METRICS_CURRENCY_FIELDS,
        FUND_METRICS_PERCENT_FIELDS,
        effective_rate,
        multiple_fields=FUND_METRICS_MULTIPLE_FIELDS,
    )

    duration_months = (fund_metrics or {}).get("fund_duration_months")
    if duration_months is not None:
        formatted_duration = f"{float(duration_months):,.0f} months"
        metrics_rows.append({"key": "Fund Duration", "value": formatted_duration})
        metrics_dict["Fund Duration"] = formatted_duration

    months_to_break_even = (fund_metrics or {}).get("months_to_break_even")
    if months_to_break_even is not None:
        formatted_break_even_months = f"{float(months_to_break_even):,.0f} months"
        metrics_rows.append({"key": "Months to Break Even", "value": formatted_break_even_months})
        metrics_dict["Months to Break Even"] = formatted_break_even_months

    break_even_date = (fund_metrics or {}).get("break_even_date")
    if break_even_date:
        metrics_rows.append({"key": "Break Even Date", "value": str(break_even_date)})
        metrics_dict["Break Even Date"] = str(break_even_date)

    months_to_target = (fund_metrics or {}).get("months_to_target_deployment")
    if months_to_target is not None:
        formatted_target_months = f"{float(months_to_target):,.0f} months"
        metrics_rows.append({"key": "Months to Target Deployment", "value": formatted_target_months})
        metrics_dict["Months to Target Deployment"] = formatted_target_months

    deployment_date = (fund_metrics or {}).get("deployment_target_date")
    if deployment_date:
        metrics_rows.append({"key": "Target Deployment Date", "value": str(deployment_date)})
        metrics_dict["Target Deployment Date"] = str(deployment_date)

    return metadata_rows, metrics_rows, metadata_dict, metrics_dict
