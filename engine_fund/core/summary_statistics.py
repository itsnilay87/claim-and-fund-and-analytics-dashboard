"""Summary statistics and distribution payloads for simulation results.

This module provides functions for summarizing individual simulation runs,
building aggregate statistics across Monte Carlo simulations, and preparing
distribution data for visualization.
"""

from __future__ import annotations

from datetime import date
from typing import Any, Dict, List, Optional, Tuple, TYPE_CHECKING

import numpy as np
import pandas as pd

if TYPE_CHECKING:
    from .models import Case, Fund


# =============================================================================
# Metric Metadata Configuration
# =============================================================================

SUMMARY_METRIC_METADATA: Dict[str, Dict[str, Any]] = {
    "net_result": {
        "label": "Net Cash Result",
        "format": "currency",
        "table": True,
        "distribution": True,
        "order": 10,
    },
    "peak_drawdown": {
        "label": "Peak Drawdown",
        "format": "currency",
        "table": True,
        "distribution": True,
        "order": 20,
    },
    "total_capital_deployed": {
        "label": "Capital Deployed",
        "format": "currency",
        "table": True,
        "distribution": True,
        "order": 30,
    },
    "total_payout": {
        "label": "Total Payout",
        "format": "currency",
        "table": True,
        "distribution": True,
        "order": 40,
    },
    "total_management_fee": {
        "label": "Management Fees (ex GST)",
        "format": "currency",
        "table": True,
        "distribution": True,
        "order": 50,
    },
    "total_fund_expenses": {
        "label": "Fund Expenses",
        "format": "currency",
        "table": True,
        "distribution": True,
        "order": 60,
    },
    "capital_utilisation_pct": {
        "label": "Capital Utilisation",
        "format": "percent",
        "table": True,
        "distribution": True,
        "order": 70,
    },
    "payout_multiple": {
        "label": "Payout Multiple",
        "format": "ratio",
        "table": True,
        "distribution": True,
        "order": 80,
    },
    "months_to_break_even": {
        "label": "Months to Break Even",
        "format": "months",
        "table": True,
        "distribution": True,
        "order": 90,
    },
    "months_to_target_deployment": {
        "label": "Months to Target Deployment",
        "format": "months",
        "table": True,
        "distribution": True,
        "order": 100,
    },
    "average_realised_duration_months": {
        "label": "Average Case Duration",
        "format": "months",
        "table": True,
        "distribution": True,
        "order": 110,
    },
    "active_months": {
        "label": "Active Months",
        "format": "months",
        "table": True,
        "distribution": False,
        "order": 120,
    },
}


# =============================================================================
# Helper Functions
# =============================================================================

def _month_delta(start: Optional[pd.Timestamp], end: Optional[pd.Timestamp]) -> Optional[int]:
    """Calculate the number of months between two timestamps."""
    if start is None or end is None:
        return None
    return (end.year - start.year) * 12 + (end.month - start.month)


def _to_float(value: Any) -> Optional[float]:
    """Safely convert a value to float."""
    if value is None:
        return None
    if isinstance(value, (int, float, np.floating, np.integer)):
        return float(value)
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return None
        try:
            return float(text)
        except ValueError:
            return None
    try:
        return float(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None


# =============================================================================
# Summary Functions
# =============================================================================

def summarise_simulation(
    *,
    label: str,
    forecast: pd.Series,
    monthly_fees: pd.Series,
    monthly_gst: pd.Series,
    monthly_fund_expenses: Dict[str, pd.Series],
    sim_case_outcomes: Dict[int, Tuple[float, float, date, float, float, Optional[bool]]],
    monthly_status: pd.Series,
    fund: "Fund",
) -> Dict[str, object]:
    """Summarize a single simulation run into key metrics.

    Args:
        label: Identifier for this simulation (e.g., "Alpha", "Sim 1").
        forecast: Net cashflow series for this simulation.
        monthly_fees: Management fees per period.
        monthly_gst: GST on management fees per period.
        monthly_fund_expenses: Dictionary of expense series by name.
        sim_case_outcomes: Dictionary mapping case_id to outcome tuple.
        monthly_status: Fund status per period.
        fund: Fund object for committed capital and portfolio lookup.

    Returns:
        Dictionary of summary metrics for this simulation.
    """
    forecast = forecast.astype(float)
    start_idx = forecast.index[0] if not forecast.empty else None
    cumulative = forecast.cumsum()

    negative_flows = forecast.where(forecast < 0.0, 0.0)
    positive_flows = forecast.where(forecast > 0.0, 0.0)

    total_outflows = float(-negative_flows.sum())
    total_inflows = float(positive_flows.sum())
    net_cash = float(forecast.sum())

    peak_cumulative = cumulative.min() if not cumulative.empty else 0.0
    peak_drawdown = float(-peak_cumulative) if peak_cumulative < 0.0 else 0.0
    peak_drawdown_date = cumulative.idxmin() if peak_cumulative < 0.0 else None

    tolerance = 1e-6
    activity_mask = forecast.abs() > tolerance
    first_activity_date: Optional[pd.Timestamp] = None
    if activity_mask.any():
        first_activity_position = int(np.argmax(activity_mask.values))
        first_activity_date = forecast.index[first_activity_position]

    break_even_candidates = cumulative[cumulative >= -tolerance]
    if first_activity_date is not None:
        break_even_candidates = break_even_candidates[break_even_candidates.index >= first_activity_date]
    break_even_date = break_even_candidates.index[0] if not break_even_candidates.empty else None

    commitment_months = None
    deployment_target_date = None
    if isinstance(monthly_status, pd.Series) and not monthly_status.empty:
        commitment_mask = monthly_status == "Commitment"
        commitment_periods = monthly_status.index[commitment_mask]
        if len(commitment_periods) > 0:
            commitment_months = int(len(commitment_periods))
            deployment_target_date = commitment_periods[-1]

    total_management_fee = float(monthly_fees.fillna(0.0).sum())
    total_management_fee_gst = float(monthly_gst.fillna(0.0).sum())

    total_fund_expenses = 0.0
    expense_totals: Dict[str, float] = {}
    for name, series in monthly_fund_expenses.items():
        value = float(series.fillna(0.0).sum())
        expense_totals[name] = value
        total_fund_expenses += value

    total_capital_deployed = float(
        sum(outcome[4] or 0.0 for outcome in sim_case_outcomes.values())
    )
    total_payout = float(sum(outcome[0] or 0.0 for outcome in sim_case_outcomes.values()))
    committed_capital = float(fund.committed_capital or 0.0)
    utilisation_pct = (
        (total_capital_deployed / committed_capital) * 100.0
        if committed_capital > 0
        else None
    )
    payout_multiple = (
        (total_payout / total_capital_deployed)
        if total_capital_deployed > 0
        else None
    )
    total_management_fee_gross = total_management_fee + total_management_fee_gst

    case_lookup = {case.case_id: case for case in fund.portfolio}
    realised_durations: List[float] = []
    settlement_count = 0
    trial_count = 0
    trial_wins = 0
    trial_losses = 0
    win_count = 0
    loss_count = 0

    for case_id, outcome in sim_case_outcomes.items():
        payout, _, end_date, _, final_investment, trial_result = outcome
        if payout and payout > 0:
            win_count += 1
        else:
            loss_count += 1

        if trial_result is None:
            settlement_count += 1
        else:
            trial_count += 1
            if trial_result:
                trial_wins += 1
            else:
                trial_losses += 1

        case = case_lookup.get(case_id)
        if case is not None:
            start_date = pd.to_datetime(case.start_date)
            end_ts = pd.to_datetime(end_date)
            if pd.notna(start_date) and pd.notna(end_ts):
                months = _month_delta(start_date, end_ts)
                if months is not None:
                    realised_durations.append(float(months))

    summary: Dict[str, object] = {
        "label": label,
        "total_outflows": total_outflows,
        "total_inflows": total_inflows,
        "net_result": net_cash,
        "peak_drawdown": peak_drawdown,
        "peak_drawdown_date": peak_drawdown_date.isoformat() if peak_drawdown_date else None,
        "months_to_peak_drawdown": (
            _month_delta(start_idx, peak_drawdown_date) if peak_drawdown_date else None
        ),
        "break_even_date": break_even_date.isoformat() if break_even_date else None,
        "months_to_break_even": (
            _month_delta(first_activity_date, break_even_date)
            if (first_activity_date is not None and break_even_date is not None)
            else None
        ),
        "deployment_target_date": deployment_target_date.isoformat() if deployment_target_date is not None else None,
        "months_to_target_deployment": commitment_months,
        "total_management_fee": total_management_fee,
        "total_management_fee_gst": total_management_fee_gst,
        "total_management_fee_gross": total_management_fee_gross,
        "total_fund_expenses": total_fund_expenses,
        "total_capital_deployed": total_capital_deployed,
        "total_payout": total_payout,
        "capital_utilisation_pct": float(utilisation_pct) if utilisation_pct is not None else None,
        "payout_multiple": float(payout_multiple) if payout_multiple is not None else None,
        "cases_total": len(sim_case_outcomes),
        "cases_won": win_count,
        "cases_lost": loss_count,
        "cases_settled": settlement_count,
        "trial_cases": trial_count,
        "trial_wins": trial_wins,
        "trial_losses": trial_losses,
        "average_realised_duration_months": (
            float(np.mean(realised_durations)) if realised_durations else None
        ),
        "active_months": int((forecast.abs() > 1e-6).sum()),
    }

    for name, value in expense_totals.items():
        summary[f"expense_{name}"] = value

    return summary


def build_summary_statistics(
    summary_df: pd.DataFrame,
    alpha_label: str = "Alpha",
) -> pd.DataFrame:
    """Build aggregate statistics DataFrame from simulation summaries.

    Args:
        summary_df: DataFrame of simulation summaries (one row per simulation).
        alpha_label: Label identifying the deterministic alpha simulation.

    Returns:
        DataFrame with statistics (min, p25, median, mean, p75, max, std) per metric.
    """
    if summary_df is None or summary_df.empty:
        return pd.DataFrame(
            columns=[
                "metric",
                "label",
                "format",
                "order",
                "alpha",
                "count",
                "min",
                "p25",
                "median",
                "mean",
                "p75",
                "max",
                "std",
            ]
        )

    alpha_row = summary_df[summary_df["label"] == alpha_label]
    alpha_series = alpha_row.iloc[0] if not alpha_row.empty else pd.Series(dtype=float)
    mc_df = summary_df[summary_df["label"] != alpha_label]

    records: List[Dict[str, Any]] = []
    for metric, metadata in SUMMARY_METRIC_METADATA.items():
        if not metadata.get("table", False):
            continue
        if metric not in summary_df.columns:
            continue

        numeric_series = (
            pd.to_numeric(mc_df[metric], errors="coerce") if not mc_df.empty else pd.Series(dtype=float)
        )
        numeric_series = numeric_series.dropna()

        record: Dict[str, Any] = {
            "metric": metric,
            "label": metadata.get("label", metric.replace("_", " ").title()),
            "format": metadata.get("format", "number"),
            "order": metadata.get("order", 9_999),
            "alpha": _to_float(alpha_series.get(metric)) if metric in alpha_series else None,
        }

        if not numeric_series.empty:
            count = int(numeric_series.count())
            record.update(
                {
                    "count": count,
                    "min": float(numeric_series.min()),
                    "p25": float(numeric_series.quantile(0.25)),
                    "median": float(numeric_series.quantile(0.5)),
                    "mean": float(numeric_series.mean()),
                    "p75": float(numeric_series.quantile(0.75)),
                    "max": float(numeric_series.max()),
                    "std": float(numeric_series.std(ddof=1)) if count > 1 else 0.0,
                }
            )
        else:
            record.update(
                {
                    "count": 0,
                    "min": None,
                    "p25": None,
                    "median": None,
                    "mean": None,
                    "p75": None,
                    "max": None,
                    "std": None,
                }
            )

        records.append(record)

    if not records:
        return pd.DataFrame(
            columns=[
                "metric",
                "label",
                "format",
                "order",
                "alpha",
                "count",
                "min",
                "p25",
                "median",
                "mean",
                "p75",
                "max",
                "std",
            ]
        )

    stats_df = pd.DataFrame(records)
    stats_df.sort_values("order", inplace=True)
    stats_df.reset_index(drop=True, inplace=True)
    return stats_df


def build_distribution_payload(
    summary_df: pd.DataFrame,
    alpha_label: str = "Alpha",
) -> Dict[str, Dict[str, Any]]:
    """Build distribution data for visualization histograms.

    Args:
        summary_df: DataFrame of simulation summaries.
        alpha_label: Label identifying the deterministic alpha simulation.

    Returns:
        Dictionary mapping metric names to histogram and summary data.
    """
    if summary_df is None or summary_df.empty:
        return {}

    mc_df = summary_df[summary_df["label"] != alpha_label]
    if mc_df.empty:
        return {}

    alpha_row = summary_df[summary_df["label"] == alpha_label]
    alpha_series = alpha_row.iloc[0] if not alpha_row.empty else pd.Series(dtype=float)

    payload: Dict[str, Dict[str, Any]] = {}
    for metric, metadata in SUMMARY_METRIC_METADATA.items():
        if not metadata.get("distribution", False):
            continue
        if metric not in mc_df.columns:
            continue

        numeric_series = pd.to_numeric(mc_df[metric], errors="coerce").dropna()
        if numeric_series.empty:
            continue

        sample_size = int(numeric_series.count())
        bins = max(10, min(60, int(max(5.0, np.sqrt(sample_size) * 2.0))))
        counts, edges = np.histogram(numeric_series, bins=bins)
        histogram = [
            {
                "bin_start": float(edges[idx]),
                "bin_end": float(edges[idx + 1]),
                "count": int(counts[idx]),
            }
            for idx in range(len(counts))
        ]

        payload[metric] = {
            "label": metadata.get("label", metric.replace("_", " ").title()),
            "format": metadata.get("format", "number"),
            "histogram": histogram,
            "summary": {
                "min": float(numeric_series.min()),
                "p25": float(numeric_series.quantile(0.25)),
                "median": float(numeric_series.quantile(0.5)),
                "mean": float(numeric_series.mean()),
                "p75": float(numeric_series.quantile(0.75)),
                "max": float(numeric_series.max()),
            },
            "alpha": _to_float(alpha_series.get(metric)) if metric in alpha_series else None,
        }

    return payload


# Backwards compatibility aliases
_month_delta = _month_delta
_to_float = _to_float
_summarise_simulation = summarise_simulation
_build_summary_statistics = build_summary_statistics
_build_distribution_payload = build_distribution_payload
