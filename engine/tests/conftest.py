"""
engine/tests/conftest.py — Shared test fixtures for Phase 1 testing.
====================================================================

Provides:
  - mi_context: context manager that saves/restores MI module state
  - default_settlement_mi: patches MI with settlement enabled, default params
  - rng: deterministic NumPy RNG seeded at 42
  - tata_portfolio_config: loads test_tata_portfolio.json

Created by Phase 1, Session 1A.
"""

from __future__ import annotations

import copy
import json
import os
from contextlib import contextmanager

import numpy as np
import pytest

from engine.v2_core import v2_master_inputs as MI
from engine.adapter import save_and_restore_mi


# ============================================================================
# Custom pytest marks
# ============================================================================

def pytest_configure(config):
    """Register custom pytest marks."""
    config.addinivalue_line("markers", "slow: marks tests as slow (100K+ draws)")
    config.addinivalue_line("markers", "regression: marks Monte Carlo regression snapshot tests")
    config.addinivalue_line("markers", "integration: marks end-to-end pipeline integration tests")



# ============================================================================
# MI save/restore fixture
# ============================================================================

@pytest.fixture
def mi_context():
    """Context manager fixture that saves and restores MI module attributes.

    Usage in tests::

        def test_something(mi_context):
            with mi_context():
                MI.SETTLEMENT_ENABLED = True
                # ... test code ...
            # MI is restored here
    """
    return save_and_restore_mi


# ============================================================================
# Default settlement MI fixture
# ============================================================================

@pytest.fixture
def default_settlement_mi():
    """Patch MI with settlement enabled using default parameters.

    Yields control inside a save_and_restore_mi context. MI is restored
    when the fixture tears down.

    Default params:
      SETTLEMENT_ENABLED = True
      SETTLEMENT_GLOBAL_HAZARD_RATE = 0.15
      SETTLEMENT_DISCOUNT_MIN = 0.30
      SETTLEMENT_DISCOUNT_MAX = 0.85
      SETTLEMENT_DELAY_MONTHS = 3.0
      SETTLEMENT_MODE = "user_specified"
      SETTLEMENT_BARGAINING_POWER = 0.5
      SETTLEMENT_STAGE_HAZARD_RATES = {}
      SETTLEMENT_STAGE_DISCOUNT_FACTORS = {}
    """
    with save_and_restore_mi():
        MI.SETTLEMENT_ENABLED = True
        MI.SETTLEMENT_GLOBAL_HAZARD_RATE = 0.15
        MI.SETTLEMENT_DISCOUNT_MIN = 0.30
        MI.SETTLEMENT_DISCOUNT_MAX = 0.85
        MI.SETTLEMENT_DELAY_MONTHS = 3.0
        MI.SETTLEMENT_MODE = "user_specified"
        MI.SETTLEMENT_BARGAINING_POWER = 0.5
        MI.SETTLEMENT_STAGE_HAZARD_RATES = {}
        MI.SETTLEMENT_STAGE_DISCOUNT_FACTORS = {}
        MI.SETTLEMENT_RESPONDENT_LEGAL_COST_CR = None
        yield


# ============================================================================
# Deterministic RNG fixture
# ============================================================================

@pytest.fixture
def rng():
    """Return a deterministic NumPy random generator seeded at 42."""
    return np.random.default_rng(42)


# ============================================================================
# TATA portfolio config fixture
# ============================================================================

_TEST_PORTFOLIO_PATH = os.path.join(
    os.path.dirname(__file__), "test_tata_portfolio.json"
)


@pytest.fixture(scope="session")
def tata_portfolio_config():
    """Load and return the 6-claim TATA test portfolio config as a dict."""
    with open(_TEST_PORTFOLIO_PATH) as f:
        return json.load(f)
