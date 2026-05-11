"""Configuration schema validation for fund_parameters.json.

This module provides early-fail validation of the input configuration,
catching common errors before the simulation runs.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from dateutil.relativedelta import relativedelta
from typing import Any, Dict, List, Optional


@dataclass
class ValidationError:
    """A single validation error with path and message."""

    path: str
    message: str
    value: Any = None

    def __str__(self) -> str:
        if self.value is not None:
            return f"{self.path}: {self.message} (got: {self.value!r})"
        return f"{self.path}: {self.message}"


@dataclass
class ValidationResult:
    """Aggregated validation results."""

    errors: List[ValidationError] = field(default_factory=list)
    warnings: List[ValidationError] = field(default_factory=list)

    @property
    def is_valid(self) -> bool:
        return len(self.errors) == 0

    def add_error(self, path: str, message: str, value: Any = None) -> None:
        self.errors.append(ValidationError(path, message, value))

    def add_warning(self, path: str, message: str, value: Any = None) -> None:
        self.warnings.append(ValidationError(path, message, value))

    def raise_if_invalid(self) -> None:
        """Raise ValueError if any errors were found."""
        if self.errors:
            lines = ["Configuration validation failed:"]
            for err in self.errors:
                lines.append(f"  - {err}")
            raise ValueError("\n".join(lines))

    def print_warnings(self) -> None:
        """Print warnings to stdout."""
        for warn in self.warnings:
            print(f"⚠️  {warn}")


def _is_positive_number(value: Any) -> bool:
    """Check if value is a positive number."""
    try:
        return float(value) > 0
    except (TypeError, ValueError):
        return False


MIN_INITIAL_COMMITMENT_INR = 200_000_000.0


def _is_non_negative_number(value: Any) -> bool:
    """Check if value is a non-negative number."""
    try:
        return float(value) >= 0
    except (TypeError, ValueError):
        return False


def _is_valid_date(value: Any) -> bool:
    """Check if value is a valid ISO date string."""
    if value is None:
        return False
    try:
        date.fromisoformat(str(value))
        return True
    except ValueError:
        return False


def _is_percentage(value: Any) -> bool:
    """Check if value is a valid percentage (0-1)."""
    try:
        v = float(value)
        return 0.0 <= v <= 1.0
    except (TypeError, ValueError):
        return False


def validate_fund_config(inputs: Dict[str, Any]) -> ValidationResult:
    """Validate the fund_parameters.json configuration.

    Returns a ValidationResult containing any errors or warnings found.
    Use result.raise_if_invalid() to fail fast, or inspect errors manually.
    """
    result = ValidationResult()

    # Top-level structure
    if "fund" not in inputs:
        result.add_error("fund", "Missing required 'fund' section")
        return result  # Can't continue without fund section

    fund = inputs["fund"]

    # Required fund fields
    if not fund.get("name"):
        result.add_error("fund.name", "Fund name is required")

    # Numeric validations
    _validate_positive_field(result, fund, "fund.committed_capital", "committed_capital")
    committed_capital = fund.get("committed_capital")
    if committed_capital is not None and float(committed_capital) < MIN_INITIAL_COMMITMENT_INR:
        result.add_error(
            "fund.committed_capital",
            f"Committed capital must be at least INR {MIN_INITIAL_COMMITMENT_INR:,.0f} to satisfy initial closing requirements",
            committed_capital,
        )
    _validate_positive_field(result, fund, "fund.fund_size", "fund_size", required=False)

    # Percentage validations (capital_reserve can be negative for over-commitment)
    if "capital_reserve" in fund:
        try:
            cr = float(fund["capital_reserve"])
            if cr < -1.0 or cr > 1.0:
                result.add_error("fund.capital_reserve", "Must be a decimal between -1 and 1", fund["capital_reserve"])
        except (TypeError, ValueError):
            result.add_error("fund.capital_reserve", "Must be a number", fund["capital_reserve"])

    if "regulatory_concentration_limit" in fund and not _is_percentage(fund["regulatory_concentration_limit"]):
        result.add_error("fund.regulatory_concentration_limit", "Must be a decimal between 0 and 1", fund["regulatory_concentration_limit"])

    if "monetisation_ratio" in fund and not _is_percentage(fund["monetisation_ratio"]):
        result.add_error("fund.monetisation_ratio", "Must be a decimal between 0 and 1", fund["monetisation_ratio"])

    # Closings and commitment ramp
    initial_closing_raw = fund.get("initial_closing_date")
    final_closing_raw = fund.get("final_closing_date")
    initial_closing_date: Optional[date] = None
    final_closing_date: Optional[date] = None

    if initial_closing_raw is not None:
        if not _is_valid_date(initial_closing_raw):
            result.add_error("fund.initial_closing_date", "Invalid date format (use YYYY-MM-DD)", initial_closing_raw)
        else:
            initial_closing_date = date.fromisoformat(str(initial_closing_raw))

    if final_closing_raw is not None:
        if not _is_valid_date(final_closing_raw):
            result.add_error("fund.final_closing_date", "Invalid date format (use YYYY-MM-DD)", final_closing_raw)
        else:
            final_closing_date = date.fromisoformat(str(final_closing_raw))

    if "initial_committed_capital" in fund:
        icc = fund.get("initial_committed_capital")
        if not _is_positive_number(icc):
            result.add_error("fund.initial_committed_capital", "Must be a positive number", icc)
        elif float(icc) < MIN_INITIAL_COMMITMENT_INR:
            result.add_error(
                "fund.initial_committed_capital",
                f"Initial committed capital must be at least INR {MIN_INITIAL_COMMITMENT_INR:,.0f}",
                icc,
            )

    if initial_closing_date and final_closing_date:
        if final_closing_date < initial_closing_date:
            result.add_error(
                "fund.final_closing_date",
                "Final closing date must be on or after the initial closing date",
                final_closing_raw,
            )
        else:
            delta = relativedelta(final_closing_date, initial_closing_date)
            total_months = delta.years * 12 + delta.months
            if total_months > 24:
                result.add_error(
                    "fund.final_closing_date",
                    "Final closing must be within 24 months of the initial closing",
                    final_closing_raw,
                )

    # Unit classes
    unit_classes = fund.get("unit_classes", [])
    class_names = set()
    for i, uc in enumerate(unit_classes):
        path = f"fund.unit_classes[{i}]"
        class_name = uc.get("class_name")
        if not class_name:
            result.add_error(f"{path}.class_name", "Unit class name is required")
        else:
            if class_name in class_names:
                result.add_error(f"{path}.class_name", f"Duplicate unit class name", class_name)
            class_names.add(class_name)

        if "management_fee_rate" in uc and not _is_non_negative_number(uc["management_fee_rate"]):
            result.add_error(f"{path}.management_fee_rate", "Must be a non-negative number", uc["management_fee_rate"])

    # Investors
    investors = fund.get("investors", [])
    if not investors:
        result.add_warning("fund.investors", "No investors defined - fund will have no capital")

    investor_names = set()
    total_commitment = 0.0
    unit_price = fund.get("unit_price", 100_000.0)

    for i, inv in enumerate(investors):
        path = f"fund.investors[{i}]"
        name = inv.get("name")
        if not name:
            result.add_error(f"{path}.name", "Investor name is required")
        else:
            if name in investor_names:
                result.add_error(f"{path}.name", f"Duplicate investor name", name)
            investor_names.add(name)
            path = f"fund.investors[{name}]"

        # Class reference
        inv_class = inv.get("class_name")
        if not inv_class:
            result.add_error(f"{path}.class_name", "Investor must reference a unit class")
        elif inv_class not in class_names:
            result.add_error(f"{path}.class_name", f"References unknown unit class", inv_class)

        # Commitment or units
        commitment = inv.get("commitment")
        units = inv.get("units")
        if commitment is None and units is None:
            result.add_error(f"{path}", "Must specify either 'commitment' or 'units'")
        elif commitment is not None and not _is_positive_number(commitment):
            result.add_error(f"{path}.commitment", "Must be a positive number", commitment)
        elif units is not None and not _is_positive_number(units):
            result.add_error(f"{path}.units", "Must be a positive number", units)

        # Track total commitment
        if commitment is not None:
            total_commitment += float(commitment)
        elif units is not None:
            inv_unit_price = float(inv.get("unit_price", unit_price))
            total_commitment += float(units) * inv_unit_price

        # Investment date
        if "investment_date" in inv and not _is_valid_date(inv["investment_date"]):
            result.add_error(f"{path}.investment_date", "Invalid date format (use YYYY-MM-DD)", inv["investment_date"])

    # Cross-validation: total commitment vs fund size
    committed_capital = fund.get("committed_capital")
    if committed_capital is not None and total_commitment > 0:
        tolerance = abs(float(committed_capital) - total_commitment) / float(committed_capital)
        if tolerance > 0.01:  # More than 1% difference
            result.add_warning(
                "fund.investors",
                f"Total investor commitments ({total_commitment:,.0f}) differs from "
                f"committed_capital ({committed_capital:,.0f}) by {tolerance*100:.1f}%"
            )

    # Portfolio section
    portfolio = inputs.get("portfolio", {})
    if "total_cases" in portfolio:
        tc = portfolio["total_cases"]
        if not isinstance(tc, int) or tc <= 0:
            result.add_error("portfolio.total_cases", "Must be a positive integer", tc)

    if "fund_start_date" in portfolio and not _is_valid_date(portfolio["fund_start_date"]):
        result.add_error("portfolio.fund_start_date", "Invalid date format (use YYYY-MM-DD)", portfolio["fund_start_date"])

    # Simulation section
    simulation = inputs.get("simulation", {})
    if "forecast_start_date" in simulation and not _is_valid_date(simulation["forecast_start_date"]):
        result.add_error("simulation.forecast_start_date", "Invalid date format (use YYYY-MM-DD)", simulation["forecast_start_date"])

    if "num_simulations" in simulation:
        ns = simulation["num_simulations"]
        if not isinstance(ns, int) or ns <= 0:
            result.add_error("simulation.num_simulations", "Must be a positive integer", ns)

    if "deposit_rate" in simulation and not _is_non_negative_number(simulation["deposit_rate"]):
        result.add_error("simulation.deposit_rate", "Must be a non-negative number", simulation["deposit_rate"])

    return result


def _validate_positive_field(
    result: ValidationResult,
    obj: Dict[str, Any],
    path: str,
    field: str,
    required: bool = True,
) -> None:
    """Helper to validate a required positive numeric field."""
    if field not in obj:
        if required:
            result.add_error(path, f"Missing required field '{field}'")
        return
    if not _is_positive_number(obj[field]):
        result.add_error(path, "Must be a positive number", obj[field])


__all__ = [
    "ValidationError",
    "ValidationResult",
    "validate_fund_config",
]
