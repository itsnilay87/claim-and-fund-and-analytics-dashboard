"""Timeseries builders for fund and investor-level time series data.

This module provides functions for building detailed monthly time series
data for the fund and individual investors, including cashflows, balances,
and hybrid overlay integration.
"""

from __future__ import annotations

from collections import defaultdict
from typing import TYPE_CHECKING, Dict

import numpy as np
import pandas as pd

if TYPE_CHECKING:
    from ..accounting.bookkeeper import FundBookkeeper
    from ..core.models import Fund
    from ..core.simulation import CashFlowModel


def _slugify_investor(name: str) -> str:
    """Convert investor name to a slug for use in column names."""
    return "".join(ch.lower() if ch.isalnum() else "_" for ch in name).strip("_")


def _resolve_capital_account_code(chart, investor_name: str) -> str:
    """Resolve the capital account code for an investor name.

    Args:
        chart: ChartOfAccounts instance.
        investor_name: Name of the investor.

    Returns:
        Account code string.
    """
    name = investor_name.strip().lower()
    if name == "sponsor":
        code = "3110"
    elif name == "sponsor investor 1":
        code = "3115"
    elif name == "sponsor investor 2":
        code = "3116"
    elif name == "sponsor investor 3":
        code = "3117"
    elif name == "anchor investor":
        code = "3120"
    elif name.startswith("lp investor"):
        suffix = name.replace("lp investor", "").strip()
        if suffix.isdigit():
            code = f"31{30 + int(suffix)}"
        else:
            code = "3130"
    else:
        code = "3100"
    chart.require(code)
    return code


def build_monthly_timeseries(
    model: "CashFlowModel",
    forecast: pd.Series,
    monthly_fees: pd.Series,
    monthly_gst: pd.Series,
    monthly_audit_fees: pd.Series,
    case_cashflows: Dict[int, pd.Series],
    monthly_active_cases: pd.Series,
    monthly_committed_capital: pd.Series,
    monthly_net_committed_capital: pd.Series,
    monthly_status: pd.Series,
    fund: "Fund",
    bookkeeper: "FundBookkeeper",
    monthly_fund_expenses: Dict[str, pd.Series],
) -> pd.DataFrame:
    """Build comprehensive monthly time series DataFrame.

    Args:
        model: CashFlowModel with date_index.
        forecast: Net cashflow forecast series.
        monthly_fees: Management fees per period.
        monthly_gst: GST on management fees per period.
        monthly_audit_fees: Audit fees per period.
        case_cashflows: Dictionary mapping case_id to cashflow series.
        monthly_active_cases: Active case count per period.
        monthly_committed_capital: Committed capital per period.
        monthly_net_committed_capital: Net committed capital per period.
        monthly_status: Fund status per period.
        fund: Fund object.
        bookkeeper: FundBookkeeper for ledger data.
        monthly_fund_expenses: Additional fund expenses by name.

    Returns:
        DataFrame with all monthly time series data.
    """
    df = pd.DataFrame(index=model.date_index.copy())
    df.index.name = "date"

    df["net_cashflow"] = forecast
    df["cumulative_cashflow"] = forecast.cumsum()
    df["management_fee"] = monthly_fees
    df["management_fee_gst"] = monthly_gst
    df["audit_fee"] = monthly_audit_fees

    expense_columns: Dict[str, pd.Series] = {}
    for name, series in monthly_fund_expenses.items():
        column_name = f"fund_expense_{name}"
        aligned = series.reindex(df.index, fill_value=0.0).astype(float)
        df[column_name] = aligned
        expense_columns[column_name] = aligned

    if expense_columns:
        df["fund_expense_total"] = pd.DataFrame(expense_columns).sum(axis=1)

    df["investments_outflows"] = df["net_cashflow"].where(df["net_cashflow"] < 0, 0.0).abs()
    df["payouts_inflows"] = df["net_cashflow"].where(df["net_cashflow"] > 0, 0.0)

    for case_id, series in case_cashflows.items():
        col_name = f"case_{case_id}_cashflow"
        df[col_name] = series

    if case_cashflows:
        case_cf_df = pd.DataFrame(case_cashflows).reindex(df.index)
        case_cf_df = case_cf_df.fillna(0.0)
        total_case_cf = case_cf_df.sum(axis=1).astype(float)
    else:
        total_case_cf = pd.Series(0.0, index=df.index, dtype=float)

    df["gross_investment_cashflow"] = total_case_cf
    df["gross_investment_cumulative"] = total_case_cf.cumsum()
    df["gross_investment_outflows"] = total_case_cf.where(total_case_cf < 0.0, 0.0).abs()
    df["gross_investment_inflows"] = total_case_cf.where(total_case_cf > 0.0, 0.0)

    df["active_cases"] = monthly_active_cases
    df["committed_capital"] = monthly_committed_capital
    df["net_committed_capital"] = monthly_net_committed_capital
    df["fund_status"] = monthly_status

    lp_names = {
        holding.investor.name
        for holding in fund.unit_holdings
        if holding.unit_class.class_name != "B"
    }

    capital_columns: Dict[str, pd.Series] = {}
    if not lp_names:
        lp_names = {investor.name for investor in fund.investors if investor.name != "Sponsor"}

    ledger_lines = bookkeeper.export_ledger_lines()
    if not ledger_lines.empty:
        capital_lines = ledger_lines[ledger_lines["account_code"].str.startswith("31")].copy()
        if not capital_lines.empty:
            capital_lines["date"] = pd.to_datetime(capital_lines["date"], errors="coerce")
            capital_lines.dropna(subset=["date"], inplace=True)
            if not capital_lines.empty:
                capital_lines["period"] = capital_lines["date"] + pd.offsets.MonthEnd(0)
                capital_lines["net"] = capital_lines["credit"] - capital_lines["debit"]

                capital_changes = (
                    capital_lines.groupby(["period", "account_code"])["net"].sum().unstack(fill_value=0)
                )
                capital_changes = capital_changes.reindex(df.index, fill_value=0)
                capital_balances = capital_changes.cumsum()

                account_name_map = {
                    _resolve_capital_account_code(bookkeeper.chart, inv.name): inv.name
                    for inv in fund.investors
                }

                for account_code, investor_name in account_name_map.items():
                    if investor_name not in lp_names:
                        continue
                    if account_code not in capital_balances.columns:
                        series = pd.Series(0.0, index=df.index)
                    else:
                        series = capital_balances[account_code].astype(float)
                    column_name = f"lp_{_slugify_investor(investor_name)}_capital"
                    df[column_name] = series
                    capital_columns[column_name] = series

    if not capital_columns and lp_names:
        for investor_name in sorted(lp_names):
            column_name = f"lp_{_slugify_investor(investor_name)}_capital"
            series = pd.Series(0.0, index=df.index)
            df[column_name] = series
            capital_columns[column_name] = series

    if capital_columns:
        stacked = pd.DataFrame(capital_columns)
        df["lp_total_capital"] = stacked.sum(axis=1)

    if "fund_status" in df.columns:
        numeric_columns = df.select_dtypes(include=["number"]).columns.tolist()
        if numeric_columns:
            numeric_data = df[numeric_columns].fillna(0.0)
            change_mask = (numeric_data.diff().abs() > 1e-6).any(axis=1)
            if not numeric_data.empty:
                initial_activity = (numeric_data.iloc[0].abs() > 1e-6).any()
                change_mask.iloc[0] = change_mask.iloc[0] or initial_activity
            activity_mask = change_mask
        else:
            activity_mask = pd.Series(False, index=df.index)

        status_series = df["fund_status"].fillna("")
        initial_status = status_series.iloc[0] if not status_series.empty else ""
        status_mask = ~status_series.eq("Closed")
        status_change_mask = status_series.ne(status_series.shift().fillna(initial_status))
        combined_mask = activity_mask | status_mask | status_change_mask

        if combined_mask.any():
            last_active = df.index[combined_mask].max()
            df = df.loc[:last_active].copy()
        else:
            df = df.iloc[0:0].copy()

    return df


def build_investor_timeseries(
    *,
    fund: "Fund",
    bookkeeper: "FundBookkeeper",
    monthly_timeseries: pd.DataFrame,
    date_index: pd.DatetimeIndex,
    hybrid_overlay: pd.DataFrame,
) -> Dict[str, pd.DataFrame]:
    """Build individual investor time series DataFrames.

    Args:
        fund: Fund object with investors and unit_holdings.
        bookkeeper: FundBookkeeper with investor events.
        monthly_timeseries: Monthly timeseries DataFrame (may be updated with total_nav).
        date_index: DatetimeIndex from the model.
        hybrid_overlay: Hybrid overlay DataFrame for pro-rata allocation.

    Returns:
        Dictionary mapping investor names to their time series DataFrames.
    """
    investor_names = [investor.name for investor in fund.investors]
    event_records = getattr(bookkeeper, "_investor_events", [])
    if event_records:
        events_df = pd.DataFrame(event_records)
        events_df["date"] = pd.to_datetime(events_df["date"], errors="coerce")
        events_df.dropna(subset=["date"], inplace=True)
        events_df["period"] = events_df["date"] + pd.offsets.MonthEnd(0)
    else:
        events_df = pd.DataFrame(columns=["investor", "event_type", "amount", "period"])

    event_columns = {
        "drawdown": "drawdowns",
        "return_of_capital": "return_of_capital",
        "profit_distribution": "profit_distribution",
        "management_fee": "management_fee",
        "carried_interest_withheld": "carried_interest",
        "carried_interest_clawback": "carried_interest",
        "carried_interest_clawback_release": "carried_interest",
        "carried_interest_adjustment": "carried_interest",
        "carried_interest_paid": "carry_income",
    }

    if not events_df.empty:
        events_df["column"] = events_df["event_type"].map(event_columns)
        events_df = events_df[events_df["column"].notna()]

    results: Dict[str, pd.DataFrame] = {}

    base_index = pd.DatetimeIndex(monthly_timeseries.index, name="date")
    total_nav_series = pd.Series(0.0, index=base_index)

    units_by_investor: Dict[str, float] = defaultdict(float)
    for holding in getattr(fund, "unit_holdings", []):
        investor_obj = getattr(holding, "investor", None)
        if investor_obj is None:
            continue
        units_value = float(getattr(holding, "number_of_units", 0.0) or 0.0)
        if units_value <= 0.0:
            continue
        units_by_investor[investor_obj.name] += units_value

    total_units = sum(value for value in units_by_investor.values() if value > 0.0)
    if "net_committed_capital" in monthly_timeseries.columns:
        net_committed_series = monthly_timeseries["net_committed_capital"].astype(float).reindex(base_index)
        if net_committed_series.isna().any():
            net_committed_series = net_committed_series.ffill().bfill().fillna(0.0)
    else:
        net_committed_series = pd.Series(0.0, index=base_index)

    for name in investor_names:
        slug = _slugify_investor(name)
        data = pd.DataFrame(index=base_index)
        for column in event_columns.values():
            data[column] = 0.0

        if not events_df.empty:
            investor_events = events_df[events_df["investor"] == name]
            if not investor_events.empty:
                pivot = (
                    investor_events.groupby(["period", "column"])["amount"].sum().unstack(fill_value=0.0)
                )
                pivot = pivot.reindex(base_index, fill_value=0.0)
                for column in event_columns.values():
                    if column in pivot.columns:
                        data[column] = pivot[column].astype(float)

        capital_column = f"lp_{slug}_capital"
        if capital_column in monthly_timeseries.columns:
            data["capital_balance"] = (
                monthly_timeseries[capital_column].astype(float).reindex(base_index, fill_value=0.0)
            )
        else:
            data["capital_balance"] = pd.Series(0.0, index=base_index)

        units = units_by_investor.get(name, 0.0)
        share = 0.0
        if units > 0.0:
            share = units / total_units if total_units > 0.0 else 0.0
            investor_ncc = net_committed_series * share
            data["net_committed_capital"] = investor_ncc

            capital_returned_cum = data["return_of_capital"].cumsum()
            profit_dist_cum = data["profit_distribution"].cumsum()
            carry_income_cum = data.get("carry_income", pd.Series(0.0, index=base_index)).cumsum()
            fee_cum = (data["management_fee"] + data["carried_interest"]).cumsum()

            nav_series = investor_ncc + capital_returned_cum + profit_dist_cum + carry_income_cum - fee_cum
            nav_series = nav_series.clip(lower=0.0)
            unit_price_series = (nav_series / units).clip(lower=0.0)
        else:
            data["net_committed_capital"] = pd.Series(0.0, index=base_index)
            nav_series = pd.Series(0.0, index=base_index)
            unit_price_series = pd.Series(0.0, index=base_index)

        data["unit_price"] = unit_price_series
        data["nav"] = nav_series
        total_nav_series = total_nav_series.add(nav_series, fill_value=0.0)

        if not hybrid_overlay.empty:
            overlay_aligned = hybrid_overlay.reindex(base_index)
            additive_columns = {
                "deposit_balance": "hybrid_deposit_balance",
                "invested_balance": "hybrid_invested_balance",
                "hybrid_nav": "hybrid_nav",
                "interest_earned": "hybrid_interest_earned",
                "cumulative_interest": "hybrid_cumulative_interest",
                "drawdowns": "hybrid_drawdowns",
                "distributions": "hybrid_distributions",
                "funding_shortfall": "hybrid_funding_shortfall",
            }
            rate_columns = {
                "effective_interest_rate": "hybrid_effective_interest_rate",
                "rolling_cagr": "hybrid_rolling_cagr",
                "deposit_rate": "hybrid_deposit_rate",
            }

            for column, target in additive_columns.items():
                source = overlay_aligned.get(column)
                if source is None:
                    values = pd.Series(0.0, index=base_index)
                else:
                    values = source.astype(float).fillna(0.0)
                data[target] = values * share

            for column, target in rate_columns.items():
                if column in overlay_aligned:
                    data[target] = overlay_aligned[column]

            if "fund_status" in overlay_aligned:
                data["hybrid_fund_status"] = overlay_aligned["fund_status"].fillna("")

        carry_income_series = data.get("carry_income", pd.Series(0.0, index=base_index))
        data["net_cashflow"] = (
            data["return_of_capital"]
            + data["profit_distribution"]
            + carry_income_series
            - data["drawdowns"]
            - data["management_fee"]
            - data["carried_interest"]
        )

        results[name] = data

    if not total_nav_series.empty:
        monthly_timeseries["total_nav"] = total_nav_series.reindex(monthly_timeseries.index, fill_value=0.0)

    return results


# Backwards compatibility aliases
_slugify_investor = _slugify_investor
_resolve_capital_account_code = _resolve_capital_account_code
_build_monthly_timeseries = build_monthly_timeseries
_build_investor_timeseries = build_investor_timeseries
