"""Diagnostics utilities for running deterministic inspections of the fund model.

This module provides testing data dumps and verbose diagnostic outputs that are
useful for debugging and testing but not required for regular simulation runs.
For core reporting metrics, see :mod:`quant.reporting.metrics`.
"""

from __future__ import annotations

import argparse
import json
import shutil
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Dict, Optional

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd

from ..accounting.bookkeeper import FundBookkeeper
from ..config.inputs import (
    DEFAULT_INPUTS_PATH,
    build_fund_from_inputs,
    get_exchange_rate,
    get_rebasing_commitment,
    get_simulation_settings,
    load_model_inputs,
)
from ..core.models import Fund
from ..core.simulation import CashFlowModel, SimulationResult
from ..reporting.formatting import build_formatted_sections
from ..reporting.hybrid_overlay import (
    compute_hybrid_cagr,
    compute_market_nav_series,
    simulate_hybrid_overlay,
)
from ..reporting.investor_statements import generate_investor_statements
from ..reporting.metrics import (
    collect_cases,
    collect_fund_metadata,
    collect_investors,
    collect_unit_class_totals,
    collect_unit_classes,
    compute_case_metrics,
    compute_fund_metrics,
    merge_case_profiles,
)
from ..reporting.timeseries import (
    build_investor_timeseries,
    build_monthly_timeseries,
)
from ..utils.cashflow import USDINR


@dataclass
class DiagnosticsPayload:
    """Container for the collected diagnostics artefacts."""

    fund_metadata: Dict[str, float]
    unit_classes: pd.DataFrame
    unit_class_totals: pd.DataFrame
    investors: pd.DataFrame
    cases: pd.DataFrame
    monthly_timeseries: pd.DataFrame
    fund_metrics: Dict[str, float]
    ledger_lines: pd.DataFrame
    trial_balance: pd.DataFrame
    capital_accounts: pd.DataFrame
    investor_subledger: pd.DataFrame
    investor_timeseries: Dict[str, pd.DataFrame]
    hybrid_overlay: pd.DataFrame
    hybrid_overlay_rebased: pd.DataFrame


def _round_numeric(df: pd.DataFrame, ndigits: int = 2) -> pd.DataFrame:
    """Round numeric columns in a DataFrame for export."""
    rounded = df.copy()
    numeric_cols = rounded.select_dtypes(include=["number"]).columns
    if not numeric_cols.empty:
        rounded[numeric_cols] = rounded[numeric_cols].round(ndigits)
    return rounded


def _round_hybrid_for_export(overlay: pd.DataFrame) -> pd.DataFrame:
    """Round hybrid overlay DataFrame with appropriate precision."""
    if overlay.empty:
        return overlay.copy()

    rounded = overlay.copy()
    numeric_cols = rounded.select_dtypes(include=["number"]).columns.tolist()
    precision_six = {"effective_interest_rate", "rolling_cagr"}
    precision_two = [col for col in numeric_cols if col not in precision_six]

    if precision_two:
        rounded[precision_two] = rounded[precision_two].round(2)
    for column in precision_six:
        if column in rounded.columns:
            rounded[column] = rounded[column].round(6)

    return rounded


def _save_nav_comparison_plot(timeseries: pd.DataFrame, output_path: Path) -> None:
    """Save NAV comparison plot to file."""
    if timeseries.empty:
        return

    required = ["market_nav", "total_nav", "hybrid_nav"]
    if not set(required).issubset(timeseries.columns):
        return

    data = timeseries[required].astype(float).copy()
    if data.replace(0.0, np.nan).dropna(how="all").empty:
        return

    data = data.sort_index()
    data_crore = data / 1e7

    labels = {
        "market_nav": "Market NAV (Deposit Only)",
        "total_nav": "Fund Total NAV",
        "hybrid_nav": "Hybrid NAV",
    }

    plt.figure(figsize=(10, 6))
    for column in required:
        plt.plot(data_crore.index, data_crore[column], label=labels[column])

    plt.xlabel("Date")
    plt.ylabel("INR Crore")
    plt.title("NAV Comparison")
    plt.legend(loc="best")
    plt.tight_layout()
    plt.savefig(output_path, dpi=150)
    plt.close()


def run_diagnostics(
    *,
    fund: Optional[Fund] = None,
    portfolio_seed: Optional[int] = None,
    simulation_seed: Optional[int] = None,
    total_cases: Optional[int] = None,
    deposit_rate: Optional[float] = None,
    inputs_path: Path | str | None = None,
) -> DiagnosticsPayload:
    """Run a fully deterministic single simulation and collect diagnostics.

    When ``fund`` is not supplied the helper will construct one using the
    configuration stored in ``inputs/fund_parameters.json`` (or the custom
    ``inputs_path`` provided). Explicit keyword arguments override the values
    from the configuration file, enabling targeted what-if diagnostics without
    editing the shared inputs file.

    Args:
        fund: Optional pre-constructed Fund object.
        portfolio_seed: Override portfolio seed from inputs.
        simulation_seed: Override simulation seed from inputs.
        total_cases: Override total cases from inputs.
        deposit_rate: Override deposit rate for hybrid overlay.
        inputs_path: Path to JSON inputs file.

    Returns:
        DiagnosticsPayload with all collected diagnostics data.
    """
    inputs = load_model_inputs(inputs_path or DEFAULT_INPUTS_PATH)
    simulation_settings = get_simulation_settings(inputs)

    effective_simulation_seed = (
        int(simulation_seed)
        if simulation_seed is not None
        else simulation_settings.alpha_seed
    )
    effective_deposit_rate = (
        float(deposit_rate)
        if deposit_rate is not None
        else float(simulation_settings.deposit_rate)
    )
    effective_portfolio_seed = (
        int(portfolio_seed)
        if portfolio_seed is not None
        else None
    )
    effective_total_cases = total_cases

    if fund is None:
        fund = build_fund_from_inputs(
            inputs,
            total_cases=effective_total_cases,
            portfolio_seed=effective_portfolio_seed,
        )

    model = CashFlowModel(
        fund=fund,
        forecast_start_date=simulation_settings.forecast_start_date,
        num_simulations=1,
        alpha_seed=effective_simulation_seed,
    )
    bookkeeper = FundBookkeeper(fund)

    result: SimulationResult = model.run_alpha_simulation(bookkeeper=bookkeeper)

    # Collect data using reporting metrics module
    fund_metadata = collect_fund_metadata(fund)
    unit_classes = collect_unit_classes(fund)
    unit_class_totals = collect_unit_class_totals(fund)
    investors = collect_investors(fund, bookkeeper)
    cases = collect_cases(fund)
    case_metrics = compute_case_metrics(fund.portfolio, result.sim_case_cashflows, result.sim_case_outcomes)
    cases_combined = merge_case_profiles(cases, case_metrics)

    # Build monthly timeseries
    monthly_timeseries = build_monthly_timeseries(
        model,
        result.forecast,
        result.monthly_fees,
        result.monthly_gst,
        result.monthly_audit_fees,
        result.sim_case_cashflows,
        result.monthly_active_cases,
        result.monthly_committed_capital,
        result.monthly_net_committed_capital,
        result.monthly_status,
        fund,
        bookkeeper,
        result.monthly_fund_expenses,
    )

    total_fees_and_expenses = float(
        result.monthly_fees.fillna(0.0).sum()
        + result.monthly_gst.fillna(0.0).sum()
        + sum(series.fillna(0.0).sum() for series in result.monthly_fund_expenses.values())
    )

    # Simulate hybrid overlay
    total_committed_capital = float(fund.committed_capital)
    hybrid_overlay = simulate_hybrid_overlay(
        monthly_timeseries,
        total_committed_capital=total_committed_capital,
        deposit_rate=effective_deposit_rate,
    )

    if not hybrid_overlay.empty:
        hybrid_column_map = {
            "deposit_balance": "hybrid_deposit_balance",
            "invested_balance": "hybrid_invested_balance",
            "hybrid_nav": "hybrid_nav",
            "interest_earned": "hybrid_interest_earned",
            "cumulative_interest": "hybrid_cumulative_interest",
            "drawdowns": "hybrid_drawdowns",
            "distributions": "hybrid_distributions",
            "deposit_rate": "hybrid_deposit_rate",
            "rolling_cagr": "hybrid_rolling_cagr",
            "effective_interest_rate": "hybrid_effective_interest_rate",
            "funding_shortfall": "hybrid_funding_shortfall",
        }
        available_columns = [col for col in hybrid_column_map if col in hybrid_overlay.columns]
        if available_columns:
            hybrid_monthly = hybrid_overlay[available_columns].rename(columns=hybrid_column_map)
            monthly_timeseries = monthly_timeseries.join(hybrid_monthly, how="left")

    monthly_timeseries["market_nav"] = compute_market_nav_series(
        monthly_timeseries.index,
        initial_value=total_committed_capital,
        deposit_rate=effective_deposit_rate,
    )

    # Create rebased overlay
    rebased_committed_capital = get_rebasing_commitment(inputs)
    scale_ratio = (
        rebased_committed_capital / total_committed_capital
        if total_committed_capital > 0.0
        else 1.0
    )
    rebased_timeseries = monthly_timeseries.copy()
    if "net_cashflow" in rebased_timeseries.columns:
        rebased_timeseries["net_cashflow"] = (
            rebased_timeseries["net_cashflow"].astype(float) * scale_ratio
        )
    hybrid_overlay_rebased = simulate_hybrid_overlay(
        rebased_timeseries,
        total_committed_capital=rebased_committed_capital,
        deposit_rate=effective_deposit_rate,
    )

    fund_metadata["commitment_start_date"] = result.commitment_start_date.isoformat()

    # Export ledger data
    ledger_lines = bookkeeper.export_ledger_lines()
    trial_balance = bookkeeper.export_trial_balance()
    capital_accounts = bookkeeper.export_capital_accounts()
    investor_subledger = bookkeeper.export_investor_subledger()

    # Build investor timeseries
    investor_timeseries = build_investor_timeseries(
        fund=fund,
        bookkeeper=bookkeeper,
        monthly_timeseries=monthly_timeseries,
        date_index=model.date_index,
        hybrid_overlay=hybrid_overlay,
    )

    # Compute fund metrics
    fund_metrics = compute_fund_metrics(
        result.forecast,
        monthly_status=result.monthly_status,
        commitment_start_date=result.commitment_start_date,
        monthly_fees=result.monthly_fees,
        total_committed_capital=float(fund.committed_capital),
        ledger_lines=ledger_lines,
        gross_investment_cashflow=monthly_timeseries.get("gross_investment_cashflow"),
    )
    fund_metrics["total_fees_and_expenses"] = float(round(total_fees_and_expenses, 2))

    overlay_cagr = compute_hybrid_cagr(
        hybrid_overlay,
        initial_value=float(fund.committed_capital),
    )
    fund_metrics["hybrid_cagr"] = overlay_cagr
    fund_metrics["hybrid_deposit_rate"] = float(effective_deposit_rate)

    return DiagnosticsPayload(
        fund_metadata=fund_metadata,
        unit_classes=unit_classes,
        unit_class_totals=unit_class_totals,
        investors=investors,
        cases=cases_combined,
        monthly_timeseries=monthly_timeseries,
        fund_metrics=fund_metrics,
        ledger_lines=ledger_lines,
        trial_balance=trial_balance,
        capital_accounts=capital_accounts,
        investor_subledger=investor_subledger,
        investor_timeseries=investor_timeseries,
        hybrid_overlay=hybrid_overlay,
        hybrid_overlay_rebased=hybrid_overlay_rebased,
    )


def save_payload(
    payload: DiagnosticsPayload,
    output_dir: Path,
    *,
    timestamp: Optional[str] = None,
    inputs_path: Path | str | None = None,
    exchange_rate: Optional[float] = None,
) -> Path:
    """Save diagnostics payload to output directory.

    Args:
        payload: DiagnosticsPayload to save.
        output_dir: Base output directory.
        timestamp: Optional timestamp for subdirectory naming.
        inputs_path: Optional path to copy inputs file from.
        exchange_rate: Exchange rate for formatting.

    Returns:
        Path to the created output directory.
    """
    generated_ts = datetime.now().strftime("%Y%m%d-%H%M")
    is_custom = timestamp is not None
    base_ts = timestamp if is_custom else generated_ts
    final_dir = output_dir / base_ts
    final_dir.mkdir(parents=True, exist_ok=True)

    def _filename(base: str) -> Path:
        if is_custom:
            return final_dir / base
        name, suffix = base.rsplit(".", 1)
        return final_dir / f"{name}_{base_ts}.{suffix}"

    _filename("fund_metadata.json").write_text(json.dumps(payload.fund_metadata, indent=2))
    effective_exchange_rate = exchange_rate if exchange_rate is not None else USDINR

    _, _, metadata_formatted, metrics_formatted = build_formatted_sections(
        payload.fund_metadata,
        payload.fund_metrics,
        effective_exchange_rate,
    )
    _filename("fund_metadata_formatted.json").write_text(json.dumps(metadata_formatted, indent=2))
    unit_classes = _round_numeric(payload.unit_classes)
    unit_classes.to_csv(_filename("unit_classes.csv"), index=False)
    unit_class_totals = _round_numeric(payload.unit_class_totals)
    unit_class_totals.to_csv(_filename("unit_class_totals.csv"), index=False)
    investors = _round_numeric(payload.investors)
    investors.to_csv(_filename("investors.csv"), index=False)
    cases = _round_numeric(payload.cases)
    cases.to_csv(_filename("cases.csv"), index=False)
    monthly_timeseries = _round_numeric(payload.monthly_timeseries.copy())
    monthly_timeseries.index = monthly_timeseries.index.map(lambda d: d.strftime("%Y-%m-%d"))
    monthly_timeseries_transposed = monthly_timeseries.T
    monthly_timeseries_transposed.index.name = "metric"
    monthly_timeseries_transposed.to_csv(_filename("monthly_timeseries.csv"))
    ledger_lines = _round_numeric(payload.ledger_lines)
    ledger_lines.to_csv(_filename("ledger_lines.csv"), index=False)
    trial_balance = _round_numeric(payload.trial_balance)
    trial_balance.to_csv(_filename("trial_balance.csv"), index=False)
    capital_accounts = _round_numeric(payload.capital_accounts)
    capital_accounts.to_csv(_filename("capital_accounts.csv"), index=False)
    investor_subledger = _round_numeric(payload.investor_subledger)
    investor_subledger.to_csv(_filename("investor_subledger.csv"), index=False)
    _filename("fund_metrics.json").write_text(json.dumps(payload.fund_metrics, indent=2))
    _filename("fund_metrics_formatted.json").write_text(json.dumps(metrics_formatted, indent=2))

    hybrid_overlay = _round_hybrid_for_export(payload.hybrid_overlay.copy())
    hybrid_overlay.index = hybrid_overlay.index.map(lambda d: d.strftime("%Y-%m-%d"))
    hybrid_overlay.to_csv(_filename("hybrid_overlay.csv"))

    hybrid_overlay_rebased = _round_hybrid_for_export(payload.hybrid_overlay_rebased.copy())
    hybrid_overlay_rebased.index = hybrid_overlay_rebased.index.map(lambda d: d.strftime("%Y-%m-%d"))
    hybrid_overlay_rebased.to_csv(_filename("hybrid_overlay_rebased.csv"))

    _save_nav_comparison_plot(
        payload.monthly_timeseries,
        _filename("nav_comparison.png"),
    )

    investor_ts_dir = final_dir / "investor_timeseries"
    investor_ts_dir.mkdir(exist_ok=True)
    for investor_name, ts_df in payload.investor_timeseries.items():
        slug = "".join(ch.lower() if ch.isalnum() else "_" for ch in investor_name).strip("_")
        rounded_ts = _round_numeric(ts_df)
        rounded_ts.to_csv(investor_ts_dir / f"{slug}.csv")

    # Generate investor statement PDFs
    try:
        fund_name = payload.fund_metadata.get("name", "Fund")
        last_date = None
        try:
            if not payload.monthly_timeseries.empty:
                last_date = pd.to_datetime(payload.monthly_timeseries.index).max()
        except Exception:
            last_date = None

        statement_files = generate_investor_statements(
            output_dir=final_dir,
            fund_name=fund_name,
            fund_metadata=payload.fund_metadata,
            fund_metrics=payload.fund_metrics,
            investors_df=payload.investors,
            capital_accounts_df=payload.capital_accounts,
            investor_timeseries=payload.investor_timeseries,
            statement_date=last_date or datetime.now(),
            currency="INR",
            valuation_currency="INR",
        )
        if statement_files:
            print(f"✅ Generated {len(statement_files)} investor statement PDFs")
    except ImportError as e:
        print(f"⚠️  Could not generate investor statements (reportlab not installed): {e}")
    except Exception as e:
        print(f"⚠️  Error generating investor statements: {e}")

    if inputs_path is not None:
        source_path = Path(inputs_path)
        if source_path.exists():
            shutil.copy2(source_path, _filename(source_path.name))

    return final_dir


def main() -> None:
    """Command-line entry point for generating diagnostics."""
    parser = argparse.ArgumentParser(description="Generate diagnostics artefacts for a single simulation.")
    parser.add_argument("--portfolio-seed", type=int, default=None, help="Override the portfolio seed from the inputs file.")
    parser.add_argument("--simulation-seed", type=int, default=None, help="Override the simulation seed from the inputs file.")
    parser.add_argument("--total-cases", type=int, default=None, help="Override the total cases defined in the inputs file.")
    parser.add_argument(
        "--inputs",
        type=Path,
        default=DEFAULT_INPUTS_PATH,
        help="Path to the JSON inputs file used to configure the fund.",
    )
    parser.add_argument(
        "--output",
        type=Path,
        required=True,
        help="Directory to store diagnostics outputs (CSV/JSON).",
    )
    args = parser.parse_args()

    inputs = load_model_inputs(args.inputs)

    payload = run_diagnostics(
        portfolio_seed=args.portfolio_seed,
        simulation_seed=args.simulation_seed,
        total_cases=args.total_cases,
        inputs_path=args.inputs,
    )
    exchange_rate = get_exchange_rate(inputs)
    final_dir = save_payload(
        payload,
        args.output,
        inputs_path=args.inputs,
        exchange_rate=exchange_rate,
    )
    print(f"✅ Diagnostics saved to '{final_dir}'")


if __name__ == "__main__":
    main()
