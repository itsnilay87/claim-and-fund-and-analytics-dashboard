"""
engine/models/quantum_model.py — Quantum band draw model.
==========================================================

Given a claim's SOC and an RNG:
  draw_quantum()              → stochastic quantum for one MC path
  compute_expected_quantum()  → analytical E[Q|WIN] (deterministic)
  compute_interest_on_quantum() → interest accrued on awarded quantum

Quantum bands are conditional on arbitration WIN.
All monetary values in native currency (default ₹ Crore).
Never calls np.random.seed().
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from engine.config.schema import InterestConfig, QuantumConfig


# ============================================================================
# Result dataclass
# ============================================================================

@dataclass
class QuantumResult:
    """Result of a single quantum band draw."""

    band_idx: int
    """Index of the selected quantum band."""

    quantum_pct: float
    """Drawn quantum as a fraction of SOC (0–1)."""

    quantum_cr: float
    """Drawn quantum in currency Cr (= soc_cr × quantum_pct)."""


# ============================================================================
# Stochastic Quantum Draw
# ============================================================================

def draw_quantum(
    soc_cr: float,
    quantum_config: QuantumConfig,
    rng: np.random.Generator,
) -> QuantumResult:
    """Draw quantum from band distribution for one MC path.

    Parameters
    ----------
    soc_cr : float
        Statement of Claim value in currency Cr.
    quantum_config : QuantumConfig
        Band definitions with probabilities.
    rng : np.random.Generator

    Returns
    -------
    QuantumResult with band_idx, quantum_pct, quantum_cr.

    Procedure:
      1. Select band from discrete distribution using rng.choice.
      2. Draw uniformly within selected band [low, high).
      3. Compute quantum_cr = soc_cr × quantum_pct.
    """
    bands = quantum_config.bands
    probs = np.array([b.probability for b in bands])
    band_idx = int(rng.choice(len(bands), p=probs))
    band = bands[band_idx]

    quantum_pct = float(rng.uniform(band.low, band.high))
    quantum_cr = soc_cr * quantum_pct

    return QuantumResult(
        band_idx=band_idx,
        quantum_pct=quantum_pct,
        quantum_cr=quantum_cr,
    )


# ============================================================================
# Analytical Expected Quantum
# ============================================================================

def compute_expected_quantum(
    soc_cr: float,
    quantum_config: QuantumConfig,
) -> float:
    """Compute analytical E[Q|WIN] = SOC × Σ(prob_i × midpoint_i).

    Parameters
    ----------
    soc_cr : float
        Statement of Claim value in currency Cr.
    quantum_config : QuantumConfig
        Band definitions with probabilities.

    Returns
    -------
    float — expected quantum in currency Cr (conditional on WIN).
    """
    return soc_cr * quantum_config.expected_quantum_pct


# ============================================================================
# Interest on Awarded Quantum
# ============================================================================

def compute_interest_on_quantum(
    quantum_cr: float,
    duration_months: float,
    interest_config: InterestConfig,
) -> float:
    """Compute interest accrued on awarded quantum.

    Parameters
    ----------
    quantum_cr : float
        Awarded quantum in currency Cr.
    duration_months : float
        Interest accrual period in months.
    interest_config : InterestConfig
        Interest configuration (enabled, rate, compounding).

    Returns
    -------
    float — interest amount in currency Cr.  Returns 0.0 if interest
    is not enabled or inputs are non-positive.

    Formulas
    --------
    Simple:   interest = quantum_cr × rate × (months / 12)
    Compound: interest = quantum_cr × ((1 + rate/12)^months − 1)
    """
    if not interest_config.enabled:
        return 0.0
    if quantum_cr <= 0.0 or duration_months <= 0.0 or interest_config.rate <= 0.0:
        return 0.0

    rate = interest_config.rate

    if interest_config.compounding == "compound":
        monthly_rate = rate / 12.0
        interest = quantum_cr * ((1.0 + monthly_rate) ** duration_months - 1.0)
    else:
        interest = quantum_cr * rate * (duration_months / 12.0)

    return interest


# ============================================================================
# Known Quantum Distribution Draw
# ============================================================================

def draw_known_quantum(
    soc_cr: float,
    known_quantum_pct: float,
    rng: np.random.Generator,
    sigma: float = 0.10,
) -> QuantumResult:
    """Draw quantum centered on a KNOWN award amount.

    When a claim has a known arbitration award, the quantum is not fully
    deterministic — it could still change through court challenges
    (partial set-aside, remand, etc.).  We model this uncertainty as a
    truncated normal distribution centered on the known percentage.

    Parameters
    ----------
    soc_cr : float
        Statement of Claim value in currency Cr.
    known_quantum_pct : float
        Known quantum as fraction of SOC (the award amount / SOC).
    rng : np.random.Generator
    sigma : float
        Standard deviation for the normal distribution (default 0.10 = 10%).

    Returns
    -------
    QuantumResult

    Distribution:
        quantum_pct ~ TruncatedNormal(μ=known_quantum_pct, σ=sigma, [0, 1])
    """
    raw = rng.normal(known_quantum_pct, sigma)
    quantum_pct = float(np.clip(raw, 0.0, 1.0))
    quantum_cr = soc_cr * quantum_pct

    return QuantumResult(
        band_idx=-2,  # -2 signals "known quantum distribution" (vs -1 for loss)
        quantum_pct=quantum_pct,
        quantum_cr=quantum_cr,
    )
