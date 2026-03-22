"""
TATA_code_v2/v2_quantum_model.py — Quantum band draw model.
=============================================================

Given a claim's SOC and an RNG:
  draw_quantum()          → stochastic quantum for one MC path
  compute_expected_quantum() → analytical E[Q] (deterministic)

Quantum bands are conditional on arbitration WIN.
All monetary values in ₹ Crore. Never calls np.random.seed().
"""

from __future__ import annotations

import numpy as np

from .v2_config import QuantumResult
from . import v2_master_inputs as MI


# ===================================================================
# Expected Quantum (deterministic)
# ===================================================================

def compute_expected_quantum(soc_cr: float) -> float:
    """Compute analytical E[Q] = SOC × Σ(band_prob × band_midpoint).

    Parameters
    ----------
    soc_cr : float
        Statement of Claim value in ₹ Crore.

    Returns
    -------
    float — expected quantum in ₹ Crore (conditional on WIN).

    Manual:
      E[Q|WIN] = Σ prob_i × (low_i + high_i) / 2
               = 0.15×0.10 + 0.05×0.30 + 0.05×0.50 + 0.05×0.70 + 0.70×0.90
               = 0.015 + 0.015 + 0.025 + 0.035 + 0.630
               = 0.7200
      E[Q] = SOC × 0.7200
    """
    e_pct = 0.0
    for band in MI.QUANTUM_BANDS:
        midpoint = (band["low"] + band["high"]) / 2.0
        e_pct += band["probability"] * midpoint
    return soc_cr * e_pct


def expected_quantum_pct() -> float:
    """Return E[Q|WIN] as a fraction of SOC (e.g. 0.7200)."""
    e_pct = 0.0
    for band in MI.QUANTUM_BANDS:
        midpoint = (band["low"] + band["high"]) / 2.0
        e_pct += band["probability"] * midpoint
    return e_pct


# ===================================================================
# Stochastic Quantum Draw
# ===================================================================

def draw_quantum(
    soc_cr: float,
    rng: np.random.Generator,
) -> QuantumResult:
    """Draw quantum from band distribution for one MC path.

    Parameters
    ----------
    soc_cr : float
        Statement of Claim value in ₹ Crore.
    rng : np.random.Generator

    Returns
    -------
    QuantumResult with band_idx, quantum_pct, quantum_cr, expected_quantum_cr.

    Procedure:
      1. Select band from discrete distribution (QUANTUM_BANDS)
      2. Draw uniformly within selected band [low, high)
      3. Compute quantum_cr = soc_cr × quantum_pct
    """
    # Step 1: Select band
    probs = np.array([b["probability"] for b in MI.QUANTUM_BANDS])
    band_idx = int(rng.choice(len(MI.QUANTUM_BANDS), p=probs))

    band = MI.QUANTUM_BANDS[band_idx]

    # Step 2: Draw uniformly within band
    quantum_pct = float(rng.uniform(band["low"], band["high"]))

    # Step 3: Compute quantum in ₹ Cr
    quantum_cr = soc_cr * quantum_pct

    # Deterministic E[Q]
    eq_cr = compute_expected_quantum(soc_cr)

    return QuantumResult(
        band_idx=band_idx,
        quantum_pct=quantum_pct,
        quantum_cr=quantum_cr,
        expected_quantum_cr=eq_cr,
    )


# ===================================================================
# Interest Accumulation on Awarded Quantum
# ===================================================================

def compute_interest_on_quantum(
    quantum_cr: float,
    duration_months: float,
    annual_rate: float,
    interest_type: str = "simple",
) -> float:
    """Compute interest accrued on awarded quantum.

    Parameters
    ----------
    quantum_cr : float
        Awarded quantum in ₹ Crore.
    duration_months : float
        Interest accrual period in months (award date → payment date).
    annual_rate : float
        Annual interest rate (e.g. 0.09 = 9% p.a.).
    interest_type : str
        'simple' or 'compound' (monthly compounding).

    Returns
    -------
    float — interest amount in ₹ Crore. Returns 0.0 if inputs are non-positive.

    Formulas
    --------
    Simple:   interest = quantum_cr × annual_rate × (duration_months / 12)
    Compound: interest = quantum_cr × ((1 + annual_rate/12)^duration_months - 1)
    """
    if quantum_cr <= 0.0 or duration_months <= 0.0 or annual_rate <= 0.0:
        return 0.0

    if interest_type == "compound":
        monthly_rate = annual_rate / 12.0
        interest = quantum_cr * ((1.0 + monthly_rate) ** duration_months - 1.0)
    else:
        # Simple interest (default)
        interest = quantum_cr * annual_rate * (duration_months / 12.0)

    return interest


# ===================================================================
# Validation
# ===================================================================

def validate_quantum_bands() -> None:
    """Verify quantum band probabilities sum to 1.0 and all ranges valid."""
    total_prob = sum(b["probability"] for b in MI.QUANTUM_BANDS)
    assert abs(total_prob - 1.0) < 1e-9, (
        f"Quantum band probabilities sum to {total_prob:.9f}, expected 1.0"
    )

    for i, b in enumerate(MI.QUANTUM_BANDS):
        assert 0.0 <= b["low"] < b["high"] <= 1.0, (
            f"Band {i}: invalid range [{b['low']}, {b['high']}]"
        )
        assert b["probability"] >= 0, (
            f"Band {i}: probability must be >= 0, got {b['probability']}"
        )

    # Verify E[Q|WIN]
    eq_pct = expected_quantum_pct()
    assert 0.0 < eq_pct <= 1.0, (
        f"E[Q|WIN] = {eq_pct:.4f} outside (0, 1]"
    )


# Run on import
validate_quantum_bands()
