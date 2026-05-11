"""Hybrid overlay simulation for comparing fund performance to deposit accounts.

This module provides functions for simulating a hypothetical scenario where
committed capital is held in a deposit account and drawn down as needed,
enabling comparison of fund NAV to a simple deposit strategy.
"""

from __future__ import annotations

from typing import Dict, List

import numpy as np
import pandas as pd


def compute_market_nav_series(
    index: pd.DatetimeIndex,
    *,
    initial_value: float,
    deposit_rate: float,
) -> pd.Series:
    """Compute market NAV series assuming capital held in deposit.

    This represents the hypothetical NAV if committed capital was simply
    held in a deposit account earning the deposit rate.

    Args:
        index: DatetimeIndex of periods.
        initial_value: Initial committed capital amount.
        deposit_rate: Annual deposit rate.

    Returns:
        Series of NAV values indexed by period.
    """
    if index.empty or initial_value <= 0.0:
        return pd.Series(0.0, index=index, name="market_nav")

    monthly_rate = (1.0 + float(deposit_rate)) ** (1.0 / 12.0) - 1.0
    balance = float(initial_value)
    values: List[float] = []

    for position, _ in enumerate(index, start=1):
        if position > 1:
            balance *= 1.0 + monthly_rate
        values.append(balance)

    return pd.Series(values, index=index, name="market_nav")


def simulate_hybrid_overlay(
    monthly_timeseries: pd.DataFrame,
    *,
    total_committed_capital: float,
    deposit_rate: float = 0.07,
) -> pd.DataFrame:
    """Simulate hybrid overlay tracking deposit vs invested balances.

    This creates a synthetic view where committed capital starts in a deposit
    account, gets drawn down when fund needs capital (negative net_cashflow),
    and receives distributions back (positive net_cashflow).

    Args:
        monthly_timeseries: DataFrame with 'net_cashflow' and 'fund_status' columns.
        total_committed_capital: Initial committed capital amount.
        deposit_rate: Annual deposit rate (default 7%).

    Returns:
        DataFrame with hybrid overlay metrics including deposit_balance,
        invested_balance, hybrid_nav, interest_earned, etc.
    """
    if monthly_timeseries.empty:
        return pd.DataFrame(columns=[
            "deposit_balance",
            "invested_balance",
            "hybrid_nav",
            "interest_earned",
            "cumulative_interest",
            "drawdowns",
            "distributions",
            "fund_status",
            "effective_interest_rate",
            "funding_shortfall",
        ])

    index = monthly_timeseries.index
    monthly_rate = (1.0 + deposit_rate) ** (1.0 / 12.0) - 1.0

    deposit_balance = float(total_committed_capital)
    invested_balance = 0.0
    cumulative_interest = 0.0
    interest_active = True

    records: List[Dict[str, object]] = []

    for position, timestamp in enumerate(index, start=1):
        row = monthly_timeseries.loc[timestamp]
        status = str(row.get("fund_status", "") or "")

        interest_enabled = interest_active and status != "Closed"
        interest_earned = deposit_balance * monthly_rate if (interest_enabled and position > 1) else 0.0
        if interest_earned:
            deposit_balance += interest_earned
            cumulative_interest += interest_earned

        net_cashflow = float(row.get("net_cashflow", 0.0) or 0.0)
        drawdowns = 0.0
        distributions = 0.0
        funding_shortfall = 0.0

        if net_cashflow < 0.0:
            drawdowns = -net_cashflow
            deposit_balance -= drawdowns
            if deposit_balance < 0.0:
                funding_shortfall = deposit_balance
            invested_balance += drawdowns
        elif net_cashflow > 0.0:
            distributions = net_cashflow
            deposit_balance += distributions
            repayment = min(invested_balance, distributions)
            invested_balance -= repayment

        hybrid_nav = deposit_balance + invested_balance

        records.append(
            {
                "date": timestamp,
                "deposit_balance": float(deposit_balance),
                "invested_balance": float(invested_balance),
                "hybrid_nav": float(hybrid_nav),
                "interest_earned": float(interest_earned),
                "cumulative_interest": float(cumulative_interest),
                "drawdowns": float(drawdowns),
                "distributions": float(distributions),
                "fund_status": status,
                "effective_interest_rate": float(round(monthly_rate if interest_enabled else 0.0, 6)),
                "funding_shortfall": float(funding_shortfall),
            }
        )

        if status == "Closed":
            interest_active = False

    overlay_df = pd.DataFrame.from_records(records).set_index("date")
    overlay_df.index.name = "date"
    overlay_df["deposit_rate"] = float(deposit_rate)
    overlay_df["rolling_cagr"] = compute_hybrid_cagr_series(
        overlay_df,
        initial_value=float(total_committed_capital),
    )
    return overlay_df


def compute_hybrid_cagr(overlay: pd.DataFrame, *, initial_value: float) -> float:
    """Compute compound annual growth rate for hybrid overlay.

    Args:
        overlay: Hybrid overlay DataFrame with 'hybrid_nav' column.
        initial_value: Initial committed capital amount.

    Returns:
        CAGR as a decimal (e.g., 0.07 for 7%), or nan if cannot be computed.
    """
    if overlay.empty or initial_value <= 0.0:
        return float("nan")

    start = overlay.index[0]
    end = overlay.index[-1]
    if isinstance(start, pd.Timestamp) and isinstance(end, pd.Timestamp):
        months_elapsed = (end.year - start.year) * 12 + (end.month - start.month) + 1
    else:
        months_elapsed = max(len(overlay), 1)

    years_elapsed = months_elapsed / 12.0 if months_elapsed > 0 else float("nan")
    final_value = float(overlay["hybrid_nav"].iloc[-1])

    if not np.isfinite(years_elapsed) or years_elapsed <= 0.0 or final_value <= 0.0:
        return float("nan")

    return (final_value / initial_value) ** (1.0 / years_elapsed) - 1.0


def compute_hybrid_cagr_series(overlay: pd.DataFrame, *, initial_value: float) -> pd.Series:
    """Compute rolling CAGR series for hybrid overlay.

    Args:
        overlay: Hybrid overlay DataFrame with 'hybrid_nav' column.
        initial_value: Initial committed capital amount.

    Returns:
        Series of rolling CAGR values.
    """
    if overlay.empty or initial_value <= 0.0:
        return pd.Series(dtype=float)

    values = overlay["hybrid_nav"].astype(float)
    start = overlay.index[0]

    rolling_cagr = []
    for idx, (timestamp, value) in enumerate(values.items(), start=1):
        if isinstance(timestamp, pd.Timestamp) and isinstance(start, pd.Timestamp):
            months_elapsed = (timestamp.year - start.year) * 12 + (timestamp.month - start.month) + 1
        else:
            months_elapsed = idx

        years_elapsed = months_elapsed / 12.0 if months_elapsed > 0 else float("nan")
        if not np.isfinite(years_elapsed) or years_elapsed <= 0.0 or value <= 0.0:
            rolling_cagr.append(float("nan"))
            continue

        rolling_cagr.append((value / initial_value) ** (1.0 / years_elapsed) - 1.0)

    return pd.Series(rolling_cagr, index=overlay.index, name="rolling_cagr")


# Backwards compatibility aliases
_simulate_hybrid_overlay = simulate_hybrid_overlay
_compute_hybrid_cagr = compute_hybrid_cagr
_compute_hybrid_cagr_series = compute_hybrid_cagr_series
_compute_market_nav_series = compute_market_nav_series
