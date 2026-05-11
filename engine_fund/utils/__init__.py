"""Utility functions for cashflow analysis and financial calculations."""

from .cashflow import (
    USDINR,
    GST_RATE,
    compute_internal_rate_of_return,
)

__all__ = [
    "USDINR",
    "GST_RATE",
    "compute_internal_rate_of_return",
]
