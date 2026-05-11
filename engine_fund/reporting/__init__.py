"""Reporting modules for fund metrics, dashboards, and data formatting.

This package provides:
- :mod:`.metrics`: Core fund and case performance metrics
- :mod:`.hybrid_overlay`: Deposit comparison simulation
- :mod:`.timeseries`: Monthly and investor time series builders
- :mod:`.formatting`: Data formatting utilities
- :mod:`.d3_dashboard`: D3.js dashboard generation
- :mod:`.investor_statements`: PDF investor statement generation
"""

from .formatting import build_formatted_sections
from .hybrid_overlay import (
    compute_hybrid_cagr,
    compute_hybrid_cagr_series,
    compute_market_nav_series,
    simulate_hybrid_overlay,
)
from .investor_statements import (
    InvestorStatementGenerator,
    generate_investor_statements,
)
from .metrics import (
    collect_cases,
    collect_fund_metadata,
    collect_investors,
    collect_unit_class_totals,
    collect_unit_classes,
    compute_case_metrics,
    compute_cashflow_summary,
    compute_fund_metrics,
    compute_investor_net_irr,
    merge_case_profiles,
)
from .timeseries import (
    build_investor_timeseries,
    build_monthly_timeseries,
)

__all__ = [
    # metrics
    "compute_investor_net_irr",
    "compute_cashflow_summary",
    "compute_fund_metrics",
    "compute_case_metrics",
    "collect_fund_metadata",
    "collect_unit_classes",
    "collect_unit_class_totals",
    "collect_investors",
    "collect_cases",
    "merge_case_profiles",
    # hybrid_overlay
    "simulate_hybrid_overlay",
    "compute_hybrid_cagr",
    "compute_hybrid_cagr_series",
    "compute_market_nav_series",
    # timeseries
    "build_monthly_timeseries",
    "build_investor_timeseries",
    # formatting
    "build_formatted_sections",
    # investor_statements
    "InvestorStatementGenerator",
    "generate_investor_statements",
]
