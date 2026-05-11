from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import date
from dateutil.relativedelta import relativedelta
from pathlib import Path
from typing import Any, Dict, Optional

import numpy as np

from ..core.models import Fund, Investor, UnitClass
from .schema import validate_fund_config

DEFAULT_INPUTS_PATH = Path("inputs/fund_parameters.json")

_FUND_KWARGS = (
    "name",
    "committed_capital",
    "fund_size",
    "capital_reserve",
    "regulatory_concentration_limit",
    "fund_concentration_limit",
    "deployment_limit_tolerance",
    "monetisation_ratio",
    "case_origination_rate",
    "average_quantum",
    "quantum_std_dev",
    "average_prob_success",
    "prob_success_std_dev",
    "average_duration",
    "duration_std_dev",
    "initial_committed_capital",
    "initial_closing_date",
    "final_closing_date",
    "fiscal_year_end_month",
    "fiscal_year_end_day",
    "audit_base_fee_inr",
    "audit_fee_per_case_inr",
    "organizational_costs_inr",
    "origination_cost_per_case_inr",
    "trustee_fee_monthly_inr",
    "compliance_cost_monthly_inr",
    "fundraising_cost_inr",
    "insurance_cost_monthly_inr",
    "marketing_cost_monthly_inr",
    "management_fee_frequency",
    "management_fee_timing",
)

_DEFAULT_INVESTMENT_DATE = date(2026, 1, 1)
_DEFAULT_FUND_START_DATE = date(2026, 1, 1)
_DEFAULT_PORTFOLIO_SEED = 42
_DEFAULT_TOTAL_CASES = 20
_DEFAULT_FORECAST_START = date(2025, 12, 31)
_DEFAULT_DEPOSIT_RATE = 0.07
_DEFAULT_NUM_SIMS = 500
_DEFAULT_ALPHA_SEED = 0
_DEFAULT_REBASING_COMMITMENT = 100_000_000.0
_DEFAULT_EXCHANGE_RATE = 90.0
_DEFAULT_SENSITIVITY_SAMPLE_DIVISOR = 4


def load_model_inputs(
    path: Path | str | None = None,
    *,
    validate: bool = True,
    strict: bool = False,
) -> Dict[str, Any]:
    """Return the parsed JSON configuration used to parameterise the model.

    Args:
        path: Path to the JSON config file. Defaults to inputs/fund_parameters.json.
        validate: If True, run schema validation on load.
        strict: If True and validate=True, raise on warnings too.

    Returns:
        The parsed configuration dictionary.

    Raises:
        FileNotFoundError: If the config file doesn't exist.
        ValueError: If validation fails.
    """
    resolved = Path(path) if path is not None else DEFAULT_INPUTS_PATH
    if not resolved.exists():
        raise FileNotFoundError(f"Inputs file not found at '{resolved}'")
    with resolved.open("r", encoding="utf-8") as handle:
        inputs = json.load(handle)

    if validate:
        result = validate_fund_config(inputs)
        result.raise_if_invalid()
        if strict and result.warnings:
            lines = ["Configuration has warnings (strict mode):"]
            for warn in result.warnings:
                lines.append(f"  - {warn}")
            raise ValueError("\n".join(lines))
        result.print_warnings()

    return inputs


def _resolve_date(
    value: Optional[str],
    *,
    default: Optional[date],
    field_name: str,
) -> date:
    if value is None:
        if default is None:
            raise ValueError(f"Missing required date field '{field_name}' in inputs")
        return default
    try:
        return date.fromisoformat(str(value))
    except ValueError as exc:  # pragma: no cover - defensive path
        raise ValueError(f"Invalid date '{value}' for field '{field_name}'") from exc


def _resolve_commitment(
    investor_cfg: Dict[str, Any],
    *,
    unit_price: float,
    investor_name: str,
) -> float:
    commitment = investor_cfg.get("commitment")
    units = investor_cfg.get("units")
    if commitment is None and units is None:
        raise ValueError(
            f"Investor '{investor_name}' must specify either 'commitment' or 'units' in the inputs file"
        )
    if commitment is None:
        commitment = float(units) * float(unit_price)
    return float(commitment)


def _resolve_units(
    investor_cfg: Dict[str, Any],
    *,
    unit_price: float,
    commitment: float,
) -> float:
    units = investor_cfg.get("units")
    if units is not None:
        return float(units)
    if unit_price == 0:
        return 0.0
    return float(commitment) / float(unit_price)


def _deep_merge(base: Dict[str, Any], override: Dict[str, Any]) -> Dict[str, Any]:
    """Deep merge override into base without mutating the originals."""
    result = dict(base)
    for key, value in override.items():
        if isinstance(value, dict) and isinstance(result.get(key), dict):
            result[key] = _deep_merge(result[key], value)
        else:
            result[key] = value
    return result


def apply_scenario_overrides(inputs: Dict[str, Any], scenario: str) -> Dict[str, Any]:
    """Return inputs with the specified scenario overrides applied.

    Scenarios live under the top-level "scenarios" key. The base file values are
    treated as the baseline; scenario overrides can redefine any nested section
    such as fund/portfolio/simulation/claims.
    """
    if not scenario or scenario == "base":
        return inputs

    scenarios = inputs.get("scenarios", {}) or {}
    override = scenarios.get(scenario)
    if not override:
        raise ValueError(f"Scenario '{scenario}' not found in inputs")

    merged = _deep_merge(inputs, override)
    # Avoid carrying the scenarios block forward into downstream consumers
    merged.pop("scenarios", None)
    return merged


def build_fund_from_inputs(
    inputs: Dict[str, Any],
    *,
    total_cases: Optional[int] = None,
    portfolio_seed: Optional[int] = None,
    case_modeling_mode: str = "legacy",
) -> Fund:
    """Instantiate a ``Fund`` object based on the provided configuration."""

    fund_cfg = inputs.get("fund")
    if not fund_cfg:
        raise ValueError("Inputs file must contain a 'fund' section")

    fund_kwargs = {key: fund_cfg[key] for key in _FUND_KWARGS if key in fund_cfg}
    if "name" not in fund_kwargs:
        raise ValueError("Fund configuration requires a 'name' field")

    # Resolve common dates
    base_investment_date = _resolve_date(
        fund_cfg.get("investment_date"),
        default=_DEFAULT_INVESTMENT_DATE,
        field_name="fund.investment_date",
    )

    # Handle closing dates and initial commitment defaults
    initial_closing_date = _resolve_date(
        fund_cfg.get("initial_closing_date"),
        default=base_investment_date,
        field_name="fund.initial_closing_date",
    )
    final_closing_raw = fund_cfg.get("final_closing_date")
    final_closing_date = (
        _resolve_date(final_closing_raw, default=None, field_name="fund.final_closing_date")
        if final_closing_raw is not None
        else None
    )
    fund_kwargs["initial_closing_date"] = initial_closing_date
    if final_closing_date:
        fund_kwargs["final_closing_date"] = final_closing_date

    if "initial_committed_capital" in fund_cfg:
        fund_kwargs["initial_committed_capital"] = float(fund_cfg["initial_committed_capital"])

    # Load claims configuration if present
    claims_config = inputs.get("claims", {})
    if claims_config:
        fund_kwargs["claims_config"] = claims_config

    fund = Fund(**fund_kwargs)

    for unit_cfg in fund_cfg.get("unit_classes", []):
        class_name = unit_cfg.get("class_name")
        if not class_name:
            raise ValueError("Each unit class entry must include 'class_name'")
        unit = UnitClass(
            class_name,
            unit_cfg.get("management_fee_rate", 0.0),
            unit_cfg.get("performance_fee_rate", 0.0),
            unit_cfg.get("unit_face_value", 100_000.0),
        )
        fund.add_unit_class(unit)

    # Default investor investment dates to initial closing unless explicitly provided
    default_investment_date = initial_closing_date

    for investor_cfg in fund_cfg.get("investors", []):
        investor_name = investor_cfg.get("name")
        if not investor_name:
            raise ValueError("Each investor entry must include a 'name'")
        class_name = investor_cfg.get("class_name")
        if not class_name:
            raise ValueError(f"Investor '{investor_name}' is missing 'class_name'")
        unit_class = fund.unit_classes.get(class_name)
        if unit_class is None:
            raise ValueError(
                f"Investor '{investor_name}' references unknown unit class '{class_name}'"
            )

        unit_price = float(investor_cfg.get("unit_price", unit_class.unit_face_value))
        commitment = _resolve_commitment(
            investor_cfg,
            unit_price=unit_price,
            investor_name=investor_name,
        )
        investment_date = _resolve_date(
            investor_cfg.get("investment_date"),
            default=default_investment_date,
            field_name=f"investors[{investor_name}].investment_date",
        )

        investor = Investor(
            name=investor_name,
            committed_capital=commitment,
            investment_date=investment_date,
            management_fee_rate=investor_cfg.get("management_fee_rate"),
            carry_rate=investor_cfg.get("carry_rate"),
        )
        fund.add_investor(investor)
        fund.issue_units(
            investor_name=investor_name,
            unit_class_name=class_name,
            committed_amount=commitment,
            unit_price=unit_price,
        )

        if "carry_recipient_rate" in investor_cfg:
            setattr(investor, "carry_recipient_rate", float(investor_cfg["carry_recipient_rate"]))
        subscribed_units = _resolve_units(
            investor_cfg,
            unit_price=unit_price,
            commitment=commitment,
        )
        setattr(investor, "units_subscribed", subscribed_units)

    portfolio_cfg = inputs.get("portfolio", {})
    portfolio_cases = total_cases if total_cases is not None else portfolio_cfg.get("total_cases")
    if portfolio_cases is None:
        portfolio_cases = _DEFAULT_TOTAL_CASES
    if int(portfolio_cases) <= 0:
        raise ValueError("Portfolio 'total_cases' must be a positive integer")

    seed_value = portfolio_seed if portfolio_seed is not None else portfolio_cfg.get("portfolio_seed")
    if seed_value is None:
        seed_value = _DEFAULT_PORTFOLIO_SEED
    np.random.seed(int(seed_value))

    fund_start_raw = portfolio_cfg.get("fund_start_date")
    if fund_start_raw is None:
        fund_start_date = fund.initial_closing_date
    else:
        fund_start_date = _resolve_date(
            fund_start_raw,
            default=fund.initial_closing_date,
            field_name="portfolio.fund_start_date",
        )
    fund.generate_portfolio(total_cases=int(portfolio_cases), fund_start_date=fund_start_date)
    fund.set_case_modeling_mode(case_modeling_mode)

    return fund


@dataclass(frozen=True)
class SimulationSettings:
    forecast_start_date: date
    num_simulations: int
    alpha_seed: int
    deposit_rate: float
    sensitivity_sample_divisor: int


def get_simulation_settings(inputs: Dict[str, Any]) -> SimulationSettings:
    """Extract simulation-related settings from the configuration."""
    sim_cfg = inputs.get("simulation", {})
    fund_cfg = inputs.get("fund", {})

    base_investment_date = _resolve_date(
        fund_cfg.get("investment_date"),
        default=_DEFAULT_INVESTMENT_DATE,
        field_name="fund.investment_date",
    )
    initial_closing_date = _resolve_date(
        fund_cfg.get("initial_closing_date"),
        default=base_investment_date,
        field_name="fund.initial_closing_date",
    )
    prior_month_end = initial_closing_date.replace(day=1) - relativedelta(days=1)

    forecast_start_date = _resolve_date(
        sim_cfg.get("forecast_start_date"),
        default=prior_month_end,
        field_name="simulation.forecast_start_date",
    )
    num_simulations = int(sim_cfg.get("num_simulations", _DEFAULT_NUM_SIMS))
    alpha_seed = int(sim_cfg.get("alpha_seed", _DEFAULT_ALPHA_SEED))
    deposit_rate = float(sim_cfg.get("deposit_rate", _DEFAULT_DEPOSIT_RATE))
    sensitivity_sample_divisor = int(
        sim_cfg.get("sensitivity_sample_divisor", _DEFAULT_SENSITIVITY_SAMPLE_DIVISOR)
    )
    if sensitivity_sample_divisor <= 0:
        raise ValueError("simulation.sensitivity_sample_divisor must be a positive integer")
    return SimulationSettings(
        forecast_start_date=forecast_start_date,
        num_simulations=num_simulations,
        alpha_seed=alpha_seed,
        deposit_rate=deposit_rate,
        sensitivity_sample_divisor=sensitivity_sample_divisor,
    )


def get_rebasing_commitment(inputs: Dict[str, Any]) -> float:
    return float(
        inputs.get("reporting", {}).get("rebasing_commitment", _DEFAULT_REBASING_COMMITMENT)
    )


def get_exchange_rate(inputs: Dict[str, Any]) -> float:
    return float(inputs.get("currency", {}).get("usd_inr", _DEFAULT_EXCHANGE_RATE))


__all__ = [
    "DEFAULT_INPUTS_PATH",
    "SimulationSettings",
    "build_fund_from_inputs",
    "get_exchange_rate",
    "get_rebasing_commitment",
    "get_simulation_settings",
    "load_model_inputs",
    "validate_fund_config",
    "apply_scenario_overrides",
]
