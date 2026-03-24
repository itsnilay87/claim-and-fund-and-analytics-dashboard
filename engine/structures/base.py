"""Base class for portfolio-structure-specific analysis logic."""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Optional


class StructureHandler(ABC):
    """Abstract base class for per-structure analysis dispatch."""

    @abstractmethod
    def run_grid_analysis(self, sim, claims, ctx, portfolio_config, output_dir):
        """Run the structure-specific grid analysis.

        Returns (grid, extra_results_dict).
        """

    @abstractmethod
    def should_run_stochastic(self) -> bool:
        """Whether stochastic pricing grid applies to this structure."""

    @abstractmethod
    def should_run_prob_sensitivity(self) -> bool:
        """Whether probability sensitivity analysis applies."""

    @abstractmethod
    def postprocess_dashboard(self, data, sim, grid, waterfall_grid_results,
                              pricing_basis, output_dir):
        """Structure-specific postprocessing of dashboard_data.json.

        Mutates *data* dict in-place. Returns the ``ig_dict`` used for
        risk / mc_distributions (either the waterfall grid dict or the
        investment_grid dict).
        """

    @abstractmethod
    def get_extra_dashboard_fields(self, sim, waterfall_grid_results) -> dict:
        """Return extra fields to merge into dashboard JSON."""
