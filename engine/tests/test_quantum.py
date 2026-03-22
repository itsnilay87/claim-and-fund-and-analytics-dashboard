"""
engine/tests/test_quantum.py
==============================

Tests for the quantum model — band sampling, expected value, and interest.

Tests:
  1. draw_quantum with default 5 bands produces E[Q|WIN] ≈ 72% over 100K draws
  2. compute_expected_quantum returns exactly 0.72 for default bands
  3. Simple interest: 100 Cr for 24 months at 9% = 18 Cr
  4. Compound interest: 100 Cr for 24 months at 9% ≈ 19.25 Cr
  5. Interest disabled → returns 0.0
  6. draw_quantum band_idx is always valid and quantum_pct within band
"""

from __future__ import annotations

import numpy as np
import pytest

from engine.config.schema import InterestConfig, QuantumBand, QuantumConfig
from engine.models.quantum_model import (
    QuantumResult,
    compute_expected_quantum,
    compute_interest_on_quantum,
    draw_quantum,
)


# ============================================================================
# Default 5-band config (matches TATA v2 master inputs)
# ============================================================================

DEFAULT_BANDS = QuantumConfig(
    bands=[
        QuantumBand(low=0.00, high=0.20, probability=0.15),
        QuantumBand(low=0.20, high=0.40, probability=0.05),
        QuantumBand(low=0.40, high=0.60, probability=0.05),
        QuantumBand(low=0.60, high=0.80, probability=0.05),
        QuantumBand(low=0.80, high=1.00, probability=0.70),
    ]
)

SOC = 1000.0  # ₹ 1,000 Crore


# ============================================================================
# 1. MC convergence: E[Q|WIN] ≈ 72% over 100K draws
# ============================================================================

def test_draw_quantum_mc_convergence():
    """100K draws should converge to E[Q|WIN] ≈ 0.72 (±0.01)."""
    n = 100_000
    total_pct = 0.0
    for i in range(n):
        rng = np.random.default_rng(42 + i)
        result = draw_quantum(SOC, DEFAULT_BANDS, rng)
        total_pct += result.quantum_pct

    mean_pct = total_pct / n
    assert abs(mean_pct - 0.72) < 0.01, (
        f"E[Q|WIN] = {mean_pct:.4f}, expected ≈ 0.72"
    )


# ============================================================================
# 2. Analytical expected quantum = 0.72
# ============================================================================

def test_compute_expected_quantum_exact():
    """Analytical E[Q|WIN] should be exactly 0.72."""
    eq_pct = DEFAULT_BANDS.expected_quantum_pct
    assert abs(eq_pct - 0.72) < 1e-9, (
        f"expected_quantum_pct = {eq_pct:.9f}, expected 0.72"
    )

    eq_cr = compute_expected_quantum(SOC, DEFAULT_BANDS)
    assert abs(eq_cr - 720.0) < 1e-6, (
        f"E[Q] = {eq_cr:.6f}, expected 720.0"
    )


# ============================================================================
# 3. Simple interest: 100 Cr × 9% × 2 years = 18 Cr
# ============================================================================

def test_simple_interest():
    """Simple interest on 100 Cr for 24 months at 9% = 18 Cr."""
    cfg = InterestConfig(enabled=True, rate=0.09, compounding="simple")
    interest = compute_interest_on_quantum(100.0, 24.0, cfg)
    assert abs(interest - 18.0) < 1e-9, (
        f"Simple interest = {interest:.6f}, expected 18.0"
    )


# ============================================================================
# 4. Compound interest: 100 Cr for 24 months at 9% ≈ 19.25 Cr
# ============================================================================

def test_compound_interest():
    """Compound interest on 100 Cr for 24 months at 9% ≈ 19.25 Cr."""
    cfg = InterestConfig(enabled=True, rate=0.09, compounding="compound")
    interest = compute_interest_on_quantum(100.0, 24.0, cfg)
    # Exact: 100 * ((1 + 0.09/12)^24 - 1) = 100 * (1.0075^24 - 1)
    expected = 100.0 * ((1.0 + 0.09 / 12.0) ** 24 - 1.0)
    assert abs(interest - expected) < 1e-9, (
        f"Compound interest = {interest:.6f}, expected {expected:.6f}"
    )
    # Sanity: should be approximately 19.25
    assert abs(interest - 19.25) < 0.5, (
        f"Compound interest = {interest:.4f}, expected ≈ 19.25"
    )


# ============================================================================
# 5. Interest disabled → 0.0
# ============================================================================

def test_interest_disabled():
    """When interest is not enabled, should return 0.0."""
    cfg = InterestConfig(enabled=False, rate=0.09, compounding="simple")
    assert compute_interest_on_quantum(100.0, 24.0, cfg) == 0.0


# ============================================================================
# 6. draw_quantum produces valid results
# ============================================================================

def test_draw_quantum_validity():
    """Each draw should produce a valid band_idx and quantum_pct within band."""
    for seed in range(200):
        rng = np.random.default_rng(seed)
        result = draw_quantum(SOC, DEFAULT_BANDS, rng)

        assert 0 <= result.band_idx < len(DEFAULT_BANDS.bands), (
            f"band_idx={result.band_idx} out of range"
        )
        band = DEFAULT_BANDS.bands[result.band_idx]
        assert band.low <= result.quantum_pct <= band.high, (
            f"quantum_pct={result.quantum_pct} outside band [{band.low}, {band.high}]"
        )
        assert abs(result.quantum_cr - SOC * result.quantum_pct) < 1e-9, (
            f"quantum_cr mismatch"
        )
