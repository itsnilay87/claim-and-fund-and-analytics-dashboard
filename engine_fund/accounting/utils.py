"""Utility functions for accounting operations."""

from __future__ import annotations

from datetime import date
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from typing import Union

import pandas as pd


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

CENT = Decimal("0.01")
TOLERANCE = Decimal("0.001")
ZERO = Decimal("0")


# ---------------------------------------------------------------------------
# Decimal Conversion
# ---------------------------------------------------------------------------

def to_decimal(value: Union[int, float, str, Decimal, None], default: Decimal = ZERO) -> Decimal:
    """
    Convert a value to Decimal safely.
    
    Args:
        value: The value to convert (int, float, str, Decimal, or None)
        default: Default value if conversion fails
        
    Returns:
        Decimal representation of the value, quantized to CENT
    """
    if value is None:
        return default
    if isinstance(value, Decimal):
        if not value.is_finite():
            return default
        return value.quantize(CENT, rounding=ROUND_HALF_UP)
    try:
        dec = Decimal(str(value))
        if not dec.is_finite():
            return default
        return dec.quantize(CENT, rounding=ROUND_HALF_UP)
    except (InvalidOperation, TypeError, ValueError):
        return default


# ---------------------------------------------------------------------------
# Date Utilities
# ---------------------------------------------------------------------------

def normalize_date(entry_date: Union[date, pd.Timestamp, None]) -> date:
    """
    Normalize a date input to a Python date object.
    
    Args:
        entry_date: A date, pd.Timestamp, or None
        
    Returns:
        A Python date object
    """
    if entry_date is None:
        return date.today()
    if isinstance(entry_date, pd.Timestamp):
        return entry_date.date()
    if isinstance(entry_date, date):
        return entry_date
    return date.today()


def month_start(d: date) -> date:
    """
    Return the first day of the month for a given date.
    
    Args:
        d: Input date
        
    Returns:
        First day of that month
    """
    return d.replace(day=1)


def add_months(d: date, months: int) -> date:
    """
    Add a number of months to a date, returning the first of that month.
    
    Args:
        d: Input date
        months: Number of months to add (can be negative)
        
    Returns:
        First day of the resulting month
    """
    year = d.year
    month = d.month + months
    while month > 12:
        month -= 12
        year += 1
    while month < 1:
        month += 12
        year -= 1
    return date(year, month, 1)
