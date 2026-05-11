"""Pydantic models for API requests and responses."""

from __future__ import annotations

from datetime import date
from enum import Enum
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


class SimulationStatus(str, Enum):
    """Status of a simulation job."""

    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"


class SimulationInput(BaseModel):
    """Request model for starting a new simulation."""

    inputs_path: Optional[str] = Field(
        default="engine_fund/inputs/fund_parameters.json",
        description="Path to fund parameters JSON file"
    )
    simulations: Optional[int] = Field(
        default=None,
        description="Number of Monte Carlo simulations to run"
    )
    sensitivity: bool = Field(
        default=False,
        description="Whether to compute sensitivity analysis"
    )
    sensitivity_divisor: Optional[int] = Field(
        default=None,
        description="Divisor for sensitivity sampling (e.g., 8 for one-eighth)"
    )
    scenario: Optional[str] = Field(
        default="base",
        description="Scenario name from the inputs file (e.g., 'base', 'upside', 'downside', 'stress', 'failure')"
    )
    scenarios: Optional[List[str]] = Field(
        default=None,
        description="List of scenario names to run. If provided, multiple scenarios will be executed."
    )
    all_scenarios: bool = Field(
        default=False,
        description="Run all scenarios defined in the inputs file"
    )
    case_mode: Optional[str] = Field(
        default="legacy",
        description="Case modeling mode: 'legacy' or 'claims'"
    )
    funding_profile: Optional[str] = Field(
        default="UF",
        description="Funding profile: 'UF' (Upfront Funding) or 'SF' (Scaled Funding)"
    )
    custom_parameters: Optional[Dict[str, Any]] = Field(
        default=None,
        description="Custom fund parameters to override file contents"
    )

    class Config:
        json_schema_extra = {
            "example": {
                "inputs_path": "inputs/fund_parameters.json",
                "simulations": None,
                "sensitivity": True,
                "sensitivity_divisor": 8,
                "scenario": "base",
                "scenarios": None,
                "all_scenarios": False,
                "case_mode": "legacy",
                "funding_profile": "UF",
            }
        }


class SimulationMetadata(BaseModel):
    """Metadata about a simulation run."""

    id: str = Field(description="Unique simulation ID")
    status: SimulationStatus = Field(description="Current status of the simulation")
    created_at: str = Field(description="ISO 8601 timestamp when simulation was created")
    started_at: Optional[str] = Field(default=None, description="ISO 8601 timestamp when simulation started")
    completed_at: Optional[str] = Field(default=None, description="ISO 8601 timestamp when simulation completed")
    error_message: Optional[str] = Field(default=None, description="Error message if simulation failed")
    duration_seconds: Optional[float] = Field(default=None, description="Total execution time in seconds")


class SummaryMetric(BaseModel):
    """A single summary metric from simulation results."""

    label: str
    value: Optional[float]
    format: str
    distribution: bool


class DashboardData(BaseModel):
    """Complete dashboard data payload for D3 visualization."""

    summary_metrics: Dict[str, Any]
    j_curve: List[Dict[str, Any]]
    irr_distribution: List[float]
    sensitivity_data: Optional[List[Dict[str, Any]]] = None

    class Config:
        json_schema_extra = {
            "example": {
                "summary_metrics": {
                    "net_result": {"label": "Net Cash Result", "value": 1000000.0},
                },
                "j_curve": [
                    {"date": "2025-01-01", "median": 0.0, "p5": -100000.0, "p25": -50000.0}
                ],
                "irr_distribution": [0.15, 0.18, 0.20],
                "sensitivity_data": [],
            }
        }


class SimulationResponse(BaseModel):
    """Response model for simulation details."""

    metadata: SimulationMetadata
    dashboard_data: Optional[DashboardData] = None


class StatusResponse(BaseModel):
    """Response model for job status queries."""

    metadata: SimulationMetadata


class ErrorResponse(BaseModel):
    """Standard error response."""

    error: str = Field(description="Error message")
    detail: Optional[str] = Field(default=None, description="Additional error details")

    class Config:
        json_schema_extra = {
            "example": {
                "error": "Simulation not found",
                "detail": "No simulation exists with ID: abc123"
            }
        }


class InputFileInfo(BaseModel):
    """Information about an input file."""
    
    filename: str = Field(description="Name of the input file")
    path: str = Field(description="Relative path to the file")
    size_bytes: int = Field(description="File size in bytes")
    modified_at: str = Field(description="Last modified timestamp")


class SimulationListItem(BaseModel):
    """Summary information for simulation list."""
    
    task_id: str = Field(description="Unique task identifier")
    status: str = Field(description="Simulation status")
    created_at: Optional[str] = Field(default=None, description="Creation timestamp")
    completed_at: Optional[str] = Field(default=None, description="Completion timestamp")
    duration_seconds: Optional[float] = Field(default=None, description="Execution duration")
    simulations: Optional[int] = Field(default=None, description="Number of simulations run")
    sensitivity: Optional[bool] = Field(default=None, description="Whether sensitivity analysis was run")
