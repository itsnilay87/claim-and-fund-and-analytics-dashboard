"""Sensitivity analysis utilities for the stochastic fund model.

Allows sweeping a single input variable while holding all other settings and
random draws constant so that the impact on portfolio IRR and ROIC can be
measured precisely.
"""

from __future__ import annotations

import argparse
import concurrent.futures
from datetime import date
from pathlib import Path
from typing import Dict, Iterable, List

import numpy as np
import pandas as pd
import matplotlib
import os

matplotlib.use("Agg")
import matplotlib.pyplot as plt

from engine_fund.core.models import Fund, Investor, UnitClass
from engine_fund.core.simulation import CashFlowModel
from engine_fund.utils.cashflow import compute_internal_rate_of_return, USDINR

# Default capital inputs used across the project.
TOTAL_COMMITTED_CAPITAL = 60_000_000 * USDINR
SPONSOR_SHARE = 0.025
ANCHOR_SHARE = 1.0 / 6.0
NUM_OTHER_INVESTORS = 20
DEFAULT_AVG_PROB_SUCCESS = 0.65
DEFAULT_AVG_DURATION = 55.2
DEFAULT_PAYOUT_MULTIPLE = 4.0
DEFAULT_AWARD_RATIO = 0.30

# Number of Monte Carlo simulations per sensitivity point to stabilise metrics.
DEFAULT_SENSITIVITY_SIMULATIONS = 200


def _float_range(start: float, stop: float, step: float) -> List[float]:
    """Return a list of floats inclusive of the stop value."""
    count = int(round((stop - start) / step))
    return [round(start + i * step, 10) for i in range(count + 1)]


VARIABLE_RANGES: Dict[str, List[float]] = {
    "average_prob_success": _float_range(0.50, 0.90, 0.01),
    "average_duration": _float_range(24.0, 84.0, 1.0),
    "payout_multiple": _float_range(2.0, 8.0, 0.1),
    "award_ratio": _float_range(0.10, 0.40, 0.01),
}


def _build_fund(
    *,
    average_prob_success: float = DEFAULT_AVG_PROB_SUCCESS,
    average_duration: float = DEFAULT_AVG_DURATION,
    payout_multiple: float = DEFAULT_PAYOUT_MULTIPLE,
    award_ratio: float = DEFAULT_AWARD_RATIO,
    case_modeling_mode: str = "legacy",
) -> Fund:
    """Construct the fund with a fixed capital structure and supplied inputs."""

    fund = Fund(
        name="5R Fund I",
        committed_capital=TOTAL_COMMITTED_CAPITAL,
        fund_size=TOTAL_COMMITTED_CAPITAL,
        initial_closing_date=date(2026, 1, 1),
        average_prob_success=average_prob_success,
        average_duration=average_duration,
    )

    fund.add_unit_class(UnitClass("A1", 0.02, 0.20))
    fund.add_unit_class(UnitClass("B"))

    sponsor_commitment = TOTAL_COMMITTED_CAPITAL * SPONSOR_SHARE
    anchor_commitment = TOTAL_COMMITTED_CAPITAL * ANCHOR_SHARE
    remaining_capital = TOTAL_COMMITTED_CAPITAL - sponsor_commitment - anchor_commitment
    capital_per_lp = remaining_capital / NUM_OTHER_INVESTORS

    investors = [
        {"name": "Sponsor", "commitment": sponsor_commitment, "class": "B"},
        {"name": "Anchor Investor", "commitment": anchor_commitment, "class": "A1"},
    ]
    investors.extend(
        {"name": f"LP Investor {i+1}", "commitment": capital_per_lp, "class": "A1"}
        for i in range(NUM_OTHER_INVESTORS)
    )

    investment_date = date(2026, 1, 1)
    for inv in investors:
        investor_obj = Investor(inv["name"], inv["commitment"], investment_date)
        fund.add_investor(investor_obj)
        fund.issue_units(inv["name"], inv["class"], inv["commitment"])

    np.random.seed(42)
    fund.generate_portfolio(total_cases=20, fund_start_date=date(2026, 1, 1))
    fund.set_case_modeling_mode(case_modeling_mode)

    for case in fund.portfolio:
        case.payout_multiple = float(payout_multiple)
        case.award_ratio = float(award_ratio)

    return fund


def _evaluate_fund(
    fund: Fund,
    *,
    sim_seed: int = 0,
    num_simulations: int = DEFAULT_SENSITIVITY_SIMULATIONS,
) -> tuple[float, float]:
    """Run a seeded Monte Carlo simulation and return median (IRR, ROIC)."""

    model = CashFlowModel(
        fund=fund,
        forecast_start_date=date(2025, 12, 31),
        num_simulations=num_simulations,
        alpha_seed=sim_seed,
    )
    model.run_simulation()

    irr_values: List[float] = []
    if model.results is not None and not model.results.empty:
        for column in model.results.columns:
            cumulative_cf = model.results[column]
            monthly_cf = cumulative_cf.diff().fillna(cumulative_cf.iloc[0])
            flows = monthly_cf.to_numpy()
            if not flows.any():
                continue
            last_event_index = np.nonzero(flows)[0][-1]
            trimmed = monthly_cf.iloc[: last_event_index + 1]
            monthly_irr = compute_internal_rate_of_return(trimmed.values)
            if not np.isfinite(monthly_irr):
                continue
            annualised = (1.0 + monthly_irr) ** 12 - 1.0
            if np.isfinite(annualised):
                irr_values.append(float(annualised))

    irr_median = float(np.median(irr_values)) if irr_values else float("nan")

    roic_median = float("nan")
    if isinstance(model.simulation_summary, pd.DataFrame) and not model.simulation_summary.empty:
        payout_series = pd.to_numeric(model.simulation_summary.get("payout_multiple"), errors="coerce")
        roic_values = [float(x) for x in payout_series if np.isfinite(x)]
        if roic_values:
            roic_median = float(np.median(roic_values))

    return irr_median, roic_median


def _build_fund_for_variable(variable: str, value: float, *, case_modeling_mode: str = "legacy") -> Fund:
    """Route the supplied value to the correct fund constructor argument."""

    kwargs = {}
    if variable == "average_prob_success":
        kwargs["average_prob_success"] = value
    elif variable == "average_duration":
        kwargs["average_duration"] = value
    elif variable == "payout_multiple":
        kwargs["payout_multiple"] = value
    elif variable == "award_ratio":
        kwargs["award_ratio"] = value
    else:
        raise ValueError(f"Unsupported variable '{variable}'")

    return _build_fund(case_modeling_mode=case_modeling_mode, **kwargs)


def _evaluate_variable_point(
    variable: str,
    value: float,
    *,
    sim_seed: int,
    num_simulations: int,
    case_modeling_mode: str,
) -> dict[str, float]:
    fund = _build_fund_for_variable(variable, value, case_modeling_mode=case_modeling_mode)
    annual, roic = _evaluate_fund(fund, sim_seed=sim_seed, num_simulations=num_simulations)
    irr_pct = annual * 100.0 if np.isfinite(annual) else np.nan
    roic_value = roic if np.isfinite(roic) else np.nan
    return {
        "variable": variable,
        "value": value,
        "net_annualised_irr_pct": irr_pct,
        "roic_multiple": roic_value,
    }


def _evaluate_variable_point_star(args: tuple[str, float, int, int, str]) -> dict[str, float]:
    variable, value, sim_seed, num_simulations, case_modeling_mode = args
    return _evaluate_variable_point(
        variable,
        value,
        sim_seed=sim_seed,
        num_simulations=num_simulations,
        case_modeling_mode=case_modeling_mode,
    )


def analyse_variable(
    variable: str,
    values: Iterable[float],
    *,
    sim_seed: int = 0,
    num_simulations: int = DEFAULT_SENSITIVITY_SIMULATIONS,
    case_modeling_mode: str = "legacy",
    max_workers: int | None = None,
) -> pd.DataFrame:
    """Evaluate a single variable across the supplied values."""

    value_list = list(values)
    tasks = [(variable, value, sim_seed, num_simulations, case_modeling_mode) for value in value_list]
    if not tasks:
        return pd.DataFrame(columns=["variable", "value", "net_annualised_irr_pct", "roic_multiple"])

    worker_target = max_workers
    if worker_target is None:
        cpu_total = os.cpu_count() or 1
        auto = cpu_total - 1 if cpu_total > 1 else 1
        worker_target = max(1, min(len(tasks), auto))
    else:
        worker_target = max(1, min(len(tasks), worker_target))

    if worker_target == 1:
        records = [
            _evaluate_variable_point(
                variable,
                value,
                sim_seed=sim_seed,
                num_simulations=num_simulations,
                case_modeling_mode=case_modeling_mode,
            )
            for value in value_list
        ]
    else:
        with concurrent.futures.ProcessPoolExecutor(max_workers=worker_target) as pool:
            records = list(pool.map(_evaluate_variable_point_star, tasks))

    return pd.DataFrame.from_records(records)


def main() -> None:
    parser = argparse.ArgumentParser(description="Run single-variable sensitivity analysis.")
    parser.add_argument(
        "--variable",
        required=True,
        choices=sorted(VARIABLE_RANGES.keys()),
        help="Model input to sweep.",
    )
    parser.add_argument(
        "--seed",
        type=int,
        default=0,
        help="Random seed used for the case outcome simulation (default: 0).",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=None,
        help="Optional path for the CSV output (defaults to reports/current/sensitivity/sensitivity_<variable>.csv).",
    )
    parser.add_argument(
        "--simulations",
        type=int,
        default=None,
        help=(
            "Number of Monte Carlo simulations to run per sensitivity point (defaults to the caller "
            "configuration or 200 if unspecified)."
        ),
    )
    parser.add_argument(
        "--workers",
        type=int,
        default=None,
        help="Process pool size for parallel evaluation (defaults to CPU count minus one).",
    )
    parser.add_argument(
        "--case-mode",
        choices=["legacy", "claims"],
        default="legacy",
        help="Select legacy case modeling or claims-based modeling for the sensitivity run.",
    )
    args = parser.parse_args()

    values = VARIABLE_RANGES[args.variable]
    simulations = args.simulations if args.simulations is not None else DEFAULT_SENSITIVITY_SIMULATIONS
    if simulations <= 0:
        raise SystemExit("--simulations must be a positive integer.")
    if args.workers is not None and args.workers <= 0:
        raise SystemExit("--workers must be a positive integer when specified.")
    df = analyse_variable(
        args.variable,
        values,
        sim_seed=args.seed,
        num_simulations=simulations,
        case_modeling_mode=args.case_mode,
        max_workers=args.workers,
    )

    default_dir = Path("reports/current/sensitivity")
    output_path = Path(args.output) if args.output else default_dir / f"sensitivity_{args.variable}.csv"
    output_path.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(output_path, index=False)

    print(df.to_string(index=False, float_format=lambda x: f"{x:0.4f}"))
    print(f"\n[INFO] Sensitivity results saved to '{output_path}'")

    fig, ax_left = plt.subplots(figsize=(10, 6))
    ax_left.plot(
        df["value"],
        df["net_annualised_irr_pct"],
        color="#1f77b4",
        marker="o",
        linewidth=1.5,
        label="Net Annualised IRR (%)",
    )
    ax_left.set_xlabel(args.variable.replace("_", " ").title())
    ax_left.set_ylabel("Net Annualised IRR (%)", color="#1f77b4")
    ax_left.tick_params(axis="y", labelcolor="#1f77b4")

    ax_right = ax_left.twinx()
    ax_right.plot(
        df["value"],
        df["roic_multiple"],
        color="#ff7f0e",
        marker="s",
        linewidth=1.5,
        label="ROIC (x)",
    )
    ax_right.set_ylabel("ROIC (x)", color="#ff7f0e")
    ax_right.tick_params(axis="y", labelcolor="#ff7f0e")

    ax_left.grid(True, linestyle="--", alpha=0.4)
    fig.tight_layout()

    plot_path = output_path.with_suffix(".png")
    fig.savefig(plot_path)
    plt.close(fig)
    print(f"[INFO] Sensitivity chart saved to '{plot_path}'")


if __name__ == "__main__":
    main()
