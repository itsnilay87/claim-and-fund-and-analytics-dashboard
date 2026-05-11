"""Core simulation and domain models for fund analysis."""

from .models import Case, Fund, Investor, UnitClass, UnitHolding
from .simulation import CashFlowModel, SimulationResult
from .summary_statistics import (
    SUMMARY_METRIC_METADATA,
    summarise_simulation,
    build_summary_statistics,
    build_distribution_payload,
)

__all__ = [
    # Models
    "Case",
    "Fund",
    "Investor",
    "UnitClass",
    "UnitHolding",
    # Simulation
    "CashFlowModel",
    "SimulationResult",
    # Summary statistics
    "SUMMARY_METRIC_METADATA",
    "summarise_simulation",
    "build_summary_statistics",
    "build_distribution_payload",
]
