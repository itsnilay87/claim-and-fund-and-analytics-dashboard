"""
TATA_code_v2/v2_correlation_sensitivity.py — Correlation sensitivity analysis.
================================================================================

Models how portfolio risk metrics change as cross-claim equicorrelation ρ
varies from 0 (independent) to 1 (perfectly correlated), using a one-factor
Gaussian copula (Vasicek model).

Mathematical framework
----------------------

For K claims, each with marginal recovery probability  p_i  (from MC simulation):

    Z_i = √ρ · M + √(1−ρ) · ε_i ,   M, ε_i ~ N(0,1) i.i.d.

Conditional on the systematic factor M = m, claims are independent with:

    q_i(m, ρ) = Φ( (Φ⁻¹(p_i) − √ρ · m) / √(1−ρ) )

Key properties:
  - Marginals preserved:  ∫ q_i(m,ρ) φ(m) dm = p_i   (for all ρ)
  - E[MOIC] approximately invariant to ρ   (exact for linear MOIC)
  - P(loss), σ[MOIC], VaR, CVaR affected by ρ
  - P(loss) monotonically non-decreasing in ρ for E[MOIC]>1 portfolios

Numerical approach:
  - 30-node Gauss-Hermite quadrature for M integration
  - 2^K = 64 binary outcome vector enumeration (K = 6 claims)
  - Per-claim conditional expectations from MC simulation paths

All monetary values in ₹ Crore.
"""

from __future__ import annotations

import itertools
import math
import time
from datetime import datetime, timedelta
from typing import Optional

import numpy as np
from numpy.polynomial.hermite_e import hermegauss
from scipy.special import ndtr, ndtri

from .v2_config import ClaimConfig, SimulationResults
from .v2_investment_analysis import InvestmentGridResults


# ===================================================================
# Constants
# ===================================================================

N_GH_NODES: int = 30
"""Number of Gauss-Hermite quadrature nodes for M integration."""

RHO_VALUES: list[float] = [round(i * 0.05, 2) for i in range(21)]
"""ρ = 0.00, 0.05, 0.10, ..., 1.00  (21 points)."""

HEATMAP_RHO_VALUES: list[float] = [round(i * 0.1, 1) for i in range(11)]
"""Coarser ρ grid for 2D heatmap: 0.0, 0.1, ..., 1.0  (11 points)."""

HEATMAP_DELTA_VALUES: list[float] = [-0.15, -0.10, -0.05, 0.0, 0.05, 0.10, 0.15]
"""Probability shift values for 2D heatmap."""

REFERENCE_DEALS: list[tuple[float, float]] = [
    (0.10, 0.20),  # 10% upfront, 20% Tata tail
    (0.15, 0.25),  # 15% upfront, 25% Tata tail
    (0.20, 0.30),  # 20% upfront, 30% Tata tail
    (0.30, 0.10),  # 30% upfront, 10% Tata tail
]
"""(upfront_pct, tata_tail_pct) reference deal points."""

EPS: float = 1e-12
"""Small epsilon for numerical stability."""


# ===================================================================
# Gauss-Hermite quadrature setup
# ===================================================================

def _setup_gauss_hermite(n: int = N_GH_NODES) -> tuple[np.ndarray, np.ndarray]:
    """Get transformed Gauss-Hermite quadrature nodes and weights.

    hermegauss gives nodes x_j and weights w̃_j for the probabilist's
    Hermite polynomials (weight function exp(-x²/2)).
    We need ∫ f(m) φ(m) dm ≈ Σ w_j f(x_j) where φ is standard normal density.

    For probabilist's hermegauss: ∫ f(x) exp(-x²/2) dx ≈ Σ w̃_j f(x_j)
    Since φ(x) = exp(-x²/2) / √(2π):
        ∫ f(x) φ(x) dx ≈ Σ (w̃_j / √(2π)) f(x_j)

    Returns (nodes, weights) where weights sum to 1.0.
    """
    nodes, raw_weights = hermegauss(n)
    weights = raw_weights / np.sqrt(2.0 * np.pi)
    return nodes, weights


# ===================================================================
# Core copula functions
# ===================================================================

def _compute_conditional_q(p_i: float, rho: float, m: float) -> float:
    """Compute conditional recovery probability q_i(m, ρ).

    q_i(m, ρ) = Φ( (Φ⁻¹(p_i) − √ρ · m) / √(1−ρ) )

    Special cases:
      ρ = 0: q_i = p_i  (independent of M)
      ρ = 1: q_i = 1 if m < Φ⁻¹(p_i), else 0  (deterministic)
      p_i = 0: q_i = 0
      p_i = 1: q_i = 1
    """
    # Edge cases on p_i
    if p_i <= 0.0:
        return 0.0
    if p_i >= 1.0:
        return 1.0

    # Edge cases on rho
    if rho <= 0.0:
        return p_i
    if rho >= 1.0:
        threshold = ndtri(p_i)
        return 1.0 if m < threshold else (0.5 if abs(m - threshold) < EPS else 0.0)

    # General case
    phi_inv_p = ndtri(p_i)
    sqrt_rho = math.sqrt(rho)
    sqrt_1_minus_rho = math.sqrt(1.0 - rho)
    z = (phi_inv_p - sqrt_rho * m) / sqrt_1_minus_rho
    return float(ndtr(z))


def _compute_conditional_q_vectorized(
    p_vec: np.ndarray, rho: float, m: float,
) -> np.ndarray:
    """Vectorized conditional q for all K claims at once.

    Parameters
    ----------
    p_vec : array of shape (K,) — marginal probabilities
    rho : equicorrelation parameter
    m : systematic factor realization

    Returns array of shape (K,) — conditional probabilities.
    """
    K = len(p_vec)
    if rho <= 0.0:
        return p_vec.copy()
    if rho >= 1.0:
        thresholds = ndtri(np.clip(p_vec, EPS, 1.0 - EPS))
        return np.where(m < thresholds, 1.0, 0.0)

    phi_inv_p = ndtri(np.clip(p_vec, EPS, 1.0 - EPS))
    sqrt_rho = math.sqrt(rho)
    sqrt_1_minus_rho = math.sqrt(1.0 - rho)
    z = (phi_inv_p - sqrt_rho * m) / sqrt_1_minus_rho
    return ndtr(z)


def _enumerate_outcome_vectors(K: int) -> np.ndarray:
    """Enumerate all 2^K binary outcome vectors.

    Returns array of shape (2^K, K) where each row is a binary vector
    s = (s_1, ..., s_K) with s_i ∈ {0, 1}.
    """
    return np.array(list(itertools.product([0, 1], repeat=K)), dtype=np.float64)


# ===================================================================
# Binary conditional extraction from MC paths
# ===================================================================

def _extract_binary_conditionals(
    sim: SimulationResults,
    claims: list[ClaimConfig],
) -> dict:
    """Extract per-claim binary conditional expectations from MC paths.

    For each claim, partitions paths into win (collected > 0) and lose
    (collected == 0), then computes conditional means.

    Returns dict[claim_id] → {
        "p_i": float,                     marginal P(recovery)
        "soc_cr": float,                  statement of claim value
        "tpl_share": float,               TPL share
        "e_collected_win_cr": float,       E[collected | win]
        "e_collected_lose_cr": float,      E[collected | lose]
        "e_legal_win_cr": float,           E[legal cost | win]
        "e_legal_lose_cr": float,          E[legal cost | lose]
        "e_duration_win_months": float,    E[duration | win]
        "e_duration_lose_months": float,   E[duration | lose]
    }
    """
    conditionals = {}

    for claim in claims:
        cid = claim.claim_id
        paths = sim.results[cid]
        n = len(paths)

        # Partition: win = collected > 0, lose = collected == 0
        win_collected = []
        win_legal = []
        win_duration = []
        lose_legal = []
        lose_duration = []
        lose_collected = []

        for pr in paths:
            if pr.collected_cr > 0:
                win_collected.append(pr.collected_cr)
                win_legal.append(pr.legal_cost_total_cr)
                win_duration.append(pr.total_duration_months)
            else:
                lose_collected.append(pr.collected_cr)
                lose_legal.append(pr.legal_cost_total_cr)
                lose_duration.append(pr.total_duration_months)

        n_win = len(win_collected)
        n_lose = len(lose_legal)
        p_i = n_win / n if n > 0 else 0.0

        conditionals[cid] = {
            "p_i": p_i,
            "soc_cr": claim.soc_value_cr,
            "tpl_share": claim.tpl_share,
            "e_collected_win_cr": float(np.mean(win_collected)) if n_win > 0 else 0.0,
            "e_collected_lose_cr": float(np.mean(lose_collected)) if n_lose > 0 else 0.0,
            "e_legal_win_cr": float(np.mean(win_legal)) if n_win > 0 else 0.0,
            "e_legal_lose_cr": float(np.mean(lose_legal)) if n_lose > 0 else 0.0,
            "e_duration_win_months": float(np.mean(win_duration)) if n_win > 0 else 0.0,
            "e_duration_lose_months": float(np.mean(lose_duration)) if n_lose > 0 else 0.0,
        }

    return conditionals


# ===================================================================
# Portfolio MOIC for a single outcome vector
# ===================================================================

def _compute_portfolio_moic(
    s: np.ndarray,
    conditionals: dict,
    claim_ids: list[str],
    upfront_pct: float,
    tata_tail_pct: float,
    pricing_basis: str = "soc",
) -> float:
    """Compute portfolio MOIC for a binary outcome vector s.

    Investment_i = upfront_pct × SOC_i + E[legal_i | s_i]
    Return_i     = s_i × (1 - tata_tail_pct) × E[collected_i | win_i]
    MOIC         = Σ Return_i / Σ Investment_i
    """
    award_share_pct = 1.0 - tata_tail_pct
    total_investment = 0.0
    total_return = 0.0

    for k, cid in enumerate(claim_ids):
        cond = conditionals[cid]
        soc = cond["soc_cr"] * cond["tpl_share"]
        upfront = upfront_pct * soc

        if s[k] > 0.5:  # win
            legal = cond["e_legal_win_cr"]
            ret = award_share_pct * cond["e_collected_win_cr"]
        else:  # lose
            legal = cond["e_legal_lose_cr"]
            ret = 0.0

        total_investment += upfront + legal
        total_return += ret

    if total_investment <= 0:
        return 0.0
    return total_return / total_investment


def _compute_portfolio_irr(
    s: np.ndarray,
    conditionals: dict,
    claim_ids: list[str],
    upfront_pct: float,
    tata_tail_pct: float,
    pricing_basis: str = "soc",
) -> float:
    """Approximate portfolio IRR for a binary outcome vector.

    Simplified cashflow:
      t=0 : -Σ upfront_i
      t=E[duration_i|s_i] months : +net_return_i for each claim i

    Returns annualized IRR or -1.0 on failure.
    """
    award_share_pct = 1.0 - tata_tail_pct
    base_date = datetime(2025, 1, 1)

    # Build cashflows
    total_upfront = 0.0
    dated_returns: list[tuple[datetime, float]] = []

    for k, cid in enumerate(claim_ids):
        cond = conditionals[cid]
        soc = cond["soc_cr"] * cond["tpl_share"]
        upfront = upfront_pct * soc
        total_upfront += upfront

        if s[k] > 0.5:  # win
            ret = award_share_pct * cond["e_collected_win_cr"]
            legal = cond["e_legal_win_cr"]
            dur_months = cond["e_duration_win_months"]
        else:
            ret = 0.0
            legal = cond["e_legal_lose_cr"]
            dur_months = cond["e_duration_lose_months"]

        # Net return after deducting ongoing legal costs
        net_ret = ret - legal
        if abs(dur_months) > 0.1 and abs(net_ret) > EPS:
            ret_date = base_date + timedelta(days=int(dur_months * 30.44))
            dated_returns.append((ret_date, net_ret))

    if total_upfront <= 0:
        return 0.0

    # Merge cashflows by date
    cf_dict: dict[datetime, float] = {base_date: -total_upfront}
    for dt, cf in dated_returns:
        cf_dict[dt] = cf_dict.get(dt, 0.0) + cf

    sorted_dates = sorted(cf_dict.keys())
    cfs = [cf_dict[d] for d in sorted_dates]

    if len(sorted_dates) < 2:
        return -1.0

    # Simple XIRR using brentq
    cf_arr = np.array(cfs)
    if np.all(cf_arr <= 0):
        return -1.0
    if np.all(cf_arr >= 0):
        return 10.0

    d0 = sorted_dates[0]
    day_fracs = np.array([(d - d0).days / 365.0 for d in sorted_dates])

    def npv(r: float) -> float:
        if r <= -1.0:
            return float("inf")
        return float(np.sum(cf_arr / (1.0 + r) ** day_fracs))

    try:
        from scipy.optimize import brentq
        # Find sign change
        low, high = -0.50, 10.0
        if npv(low) * npv(high) > 0:
            return -1.0
        return float(brentq(npv, low, high, maxiter=200))
    except Exception:
        return -1.0


# ===================================================================
# Pre-compute MOIC for all outcome vectors × deals
# ===================================================================

def _precompute_vector_metrics(
    outcome_vectors: np.ndarray,
    conditionals: dict,
    claim_ids: list[str],
) -> dict:
    """Pre-compute MOIC and IRR for all outcome vectors and reference deals.

    Returns dict[deal_key] → {
        "moics": np.ndarray of shape (2^K,),
        "irrs": np.ndarray of shape (2^K,),
    }
    """
    n_vecs = outcome_vectors.shape[0]
    result = {}

    for (up_pct, tail_pct) in REFERENCE_DEALS:
        deal_key = f"{int(up_pct * 100)}_{int(tail_pct * 100)}"
        moics = np.zeros(n_vecs)
        irrs = np.zeros(n_vecs)

        for v_idx in range(n_vecs):
            s = outcome_vectors[v_idx]
            moics[v_idx] = _compute_portfolio_moic(
                s, conditionals, claim_ids, up_pct, tail_pct,
            )
            irrs[v_idx] = _compute_portfolio_irr(
                s, conditionals, claim_ids, up_pct, tail_pct,
            )

        result[deal_key] = {"moics": moics, "irrs": irrs}

    return result


# ===================================================================
# Correlation sweep — core computation
# ===================================================================

def _compute_vector_probabilities(
    q_vec: np.ndarray,
    outcome_vectors: np.ndarray,
) -> np.ndarray:
    """Compute probability of each outcome vector given conditional q values.

    P(s | M=m) = Π_i q_i^s_i · (1-q_i)^(1-s_i)

    Parameters
    ----------
    q_vec : shape (K,) — conditional win probabilities
    outcome_vectors : shape (2^K, K) — binary outcome vectors

    Returns
    -------
    shape (2^K,) — probability of each vector
    """
    # For numerical stability, work in log space
    log_q = np.log(np.clip(q_vec, EPS, 1.0))
    log_1mq = np.log(np.clip(1.0 - q_vec, EPS, 1.0))

    # log P(s) = Σ_i [ s_i log(q_i) + (1-s_i) log(1-q_i) ]
    log_probs = outcome_vectors @ log_q + (1.0 - outcome_vectors) @ log_1mq
    probs = np.exp(log_probs)

    return probs


def _sweep_single_rho(
    rho: float,
    p_vec: np.ndarray,
    outcome_vectors: np.ndarray,
    vector_metrics: dict,
    gh_nodes: np.ndarray,
    gh_weights: np.ndarray,
) -> dict:
    """Compute portfolio metrics at a single ρ value.

    Returns dict with p_loss, e_moic, sigma_moic, var_1, cvar_1, e_irr per deal.
    """
    n_vecs = outcome_vectors.shape[0]
    K = len(p_vec)

    per_deal = {}

    for deal_key, vm in vector_metrics.items():
        moics = vm["moics"]  # (2^K,)
        irrs = vm["irrs"]    # (2^K,)

        if rho <= 0.0:
            # Independence: single evaluation, no GH integration needed
            q_vec = p_vec.copy()
            vec_probs = _compute_vector_probabilities(q_vec, outcome_vectors)

            # Weighted metrics
            e_moic = float(np.dot(vec_probs, moics))
            e_moic2 = float(np.dot(vec_probs, moics ** 2))
            sigma_moic = math.sqrt(max(0.0, e_moic2 - e_moic ** 2))
            p_loss = float(np.dot(vec_probs, (moics < 1.0).astype(float)))
            e_irr = float(np.dot(vec_probs, irrs))

            # VaR/CVaR from weighted distribution
            sorted_idx = np.argsort(moics)
            sorted_moics = moics[sorted_idx]
            sorted_probs = vec_probs[sorted_idx]
            cum_probs = np.cumsum(sorted_probs)

            # 1st percentile VaR
            var_idx = np.searchsorted(cum_probs, 0.01)
            var_1 = float(sorted_moics[min(var_idx, len(sorted_moics) - 1)])

            # CVaR: E[MOIC | MOIC <= VaR_1]
            tail_mask = sorted_moics <= var_1
            tail_prob_total = float(np.sum(sorted_probs[tail_mask]))
            if tail_prob_total > EPS:
                cvar_1 = float(np.sum(sorted_probs[tail_mask] * sorted_moics[tail_mask]) / tail_prob_total)
            else:
                cvar_1 = var_1

        elif rho >= 1.0:
            # Perfect-correlation limit (comonotonic Bernoulli vector):
            # Xi = 1{M < t_i}, t_i = Φ^{-1}(p_i), M ~ N(0,1).
            # Integrate exactly across threshold intervals to avoid endpoint artifacts.
            thresholds = ndtri(np.clip(p_vec, EPS, 1.0 - EPS))
            breaks = np.concatenate(([-np.inf], np.sort(thresholds), [np.inf]))

            weighted_moic = 0.0
            weighted_moic2 = 0.0
            weighted_p_loss = 0.0
            weighted_irr = 0.0
            moic_cdf_builder: list[tuple[float, float]] = []

            for b_idx in range(len(breaks) - 1):
                lo = breaks[b_idx]
                hi = breaks[b_idx + 1]

                # Interval probability under standard normal.
                w = float(ndtr(hi) - ndtr(lo))
                if w <= EPS:
                    continue

                # Representative m in interval (deterministic Xi pattern inside interval).
                if np.isneginf(lo):
                    m_mid = hi - 1.0
                elif np.isposinf(hi):
                    m_mid = lo + 1.0
                else:
                    m_mid = 0.5 * (lo + hi)

                s_vec = (m_mid < thresholds).astype(np.float64)
                mask = np.all(np.isclose(outcome_vectors, s_vec), axis=1)
                if not np.any(mask):
                    continue
                v_idx = int(np.argmax(mask))

                moic_val = float(moics[v_idx])
                irr_val = float(irrs[v_idx])
                loss_val = 1.0 if moic_val < 1.0 else 0.0

                weighted_moic += w * moic_val
                weighted_moic2 += w * (moic_val ** 2)
                weighted_p_loss += w * loss_val
                weighted_irr += w * irr_val
                moic_cdf_builder.append((moic_val, w))

            e_moic = weighted_moic
            sigma_moic = math.sqrt(max(0.0, weighted_moic2 - e_moic ** 2))
            p_loss = weighted_p_loss
            e_irr = weighted_irr
            var_1, cvar_1 = _compute_var_cvar_from_weighted(moic_cdf_builder, 0.01)

        else:
            # General case: GH quadrature over M
            weighted_moic = 0.0
            weighted_moic2 = 0.0
            weighted_p_loss = 0.0
            weighted_irr = 0.0
            moic_cdf_builder: list[tuple[float, float]] = []

            for j in range(len(gh_nodes)):
                m = gh_nodes[j]
                w = gh_weights[j]
                q_vec = _compute_conditional_q_vectorized(p_vec, rho, m)
                vec_probs = _compute_vector_probabilities(q_vec, outcome_vectors)

                moic_at_m = float(np.dot(vec_probs, moics))
                moic2_at_m = float(np.dot(vec_probs, moics ** 2))
                p_loss_at_m = float(np.dot(vec_probs, (moics < 1.0).astype(float)))
                irr_at_m = float(np.dot(vec_probs, irrs))

                weighted_moic += w * moic_at_m
                weighted_moic2 += w * moic2_at_m
                weighted_p_loss += w * p_loss_at_m
                weighted_irr += w * irr_at_m

                for v_idx in range(n_vecs):
                    effective_w = w * vec_probs[v_idx]
                    if effective_w > EPS:
                        moic_cdf_builder.append((moics[v_idx], effective_w))

            e_moic = weighted_moic
            sigma_moic = math.sqrt(max(0.0, weighted_moic2 - e_moic ** 2))
            p_loss = weighted_p_loss
            e_irr = weighted_irr
            var_1, cvar_1 = _compute_var_cvar_from_weighted(moic_cdf_builder, 0.01)

        per_deal[deal_key] = {
            "p_loss": round(p_loss, 6),
            "e_moic": round(e_moic, 4),
            "sigma_moic": round(sigma_moic, 4),
            "var_1": round(var_1, 4),
            "cvar_1": round(cvar_1, 4),
            "e_irr": round(e_irr, 4),
        }

    return per_deal


def _compute_var_cvar_from_weighted(
    moic_weight_pairs: list[tuple[float, float]],
    percentile: float,
) -> tuple[float, float]:
    """Compute VaR and CVaR from weighted (moic, weight) pairs.

    Parameters
    ----------
    moic_weight_pairs : list of (moic_value, weight)
    percentile : quantile level (e.g. 0.01 for 1st percentile)

    Returns (VaR, CVaR).
    """
    if not moic_weight_pairs:
        return 0.0, 0.0

    # Sort by MOIC ascending
    sorted_pairs = sorted(moic_weight_pairs, key=lambda x: x[0])
    moics = np.array([p[0] for p in sorted_pairs])
    weights = np.array([p[1] for p in sorted_pairs])

    # Normalize weights
    total_w = weights.sum()
    if total_w <= 0:
        return 0.0, 0.0
    weights = weights / total_w

    cum_weights = np.cumsum(weights)
    var_idx = np.searchsorted(cum_weights, percentile)
    var_idx = min(var_idx, len(moics) - 1)
    var_val = float(moics[var_idx])

    # CVaR: weighted mean of MOIC values below VaR
    tail_mask = moics <= var_val
    tail_total_w = float(weights[tail_mask].sum())
    if tail_total_w > EPS:
        cvar_val = float(np.sum(weights[tail_mask] * moics[tail_mask]) / tail_total_w)
    else:
        cvar_val = var_val

    return var_val, cvar_val


# ===================================================================
# Full correlation sweep
# ===================================================================

def _sweep_correlation(
    conditionals: dict,
    claim_ids: list[str],
    rho_values: list[float],
    outcome_vectors: np.ndarray,
    vector_metrics: dict,
    gh_nodes: np.ndarray,
    gh_weights: np.ndarray,
) -> dict:
    """Sweep across all ρ values and collect per-deal metrics.

    Returns dict[deal_key] → {
        "p_loss": [float, ...],      len=len(rho_values)
        "e_moic": [float, ...],
        "sigma_moic": [float, ...],
        "var_1": [float, ...],
        "cvar_1": [float, ...],
        "e_irr": [float, ...],
    }
    """
    p_vec = np.array([conditionals[cid]["p_i"] for cid in claim_ids])

    # Initialize result structure
    deal_keys = list(vector_metrics.keys())
    result: dict[str, dict[str, list]] = {}
    for dk in deal_keys:
        result[dk] = {
            "p_loss": [],
            "e_moic": [],
            "sigma_moic": [],
            "var_1": [],
            "cvar_1": [],
            "e_irr": [],
        }

    for rho in rho_values:
        per_deal = _sweep_single_rho(
            rho, p_vec, outcome_vectors, vector_metrics,
            gh_nodes, gh_weights,
        )
        for dk in deal_keys:
            for metric_key in result[dk]:
                result[dk][metric_key].append(per_deal[dk][metric_key])

    return result


# ===================================================================
# 2D heatmap: (δ × ρ) surface
# ===================================================================

def _build_2d_surface(
    conditionals: dict,
    claim_ids: list[str],
    delta_values: list[float],
    rho_values: list[float],
    outcome_vectors: np.ndarray,
    vector_metrics: dict,
    gh_nodes: np.ndarray,
    gh_weights: np.ndarray,
    primary_deal_key: str = "10_20",
) -> dict:
    """Build 2D (delta × rho) sensitivity surface for P(loss) and E[MOIC].

    At each (δ, ρ): shift all marginal probabilities by δ, then compute
    metrics at correlation ρ.

    Returns {
        "delta_values": [...],
        "rho_values": [...],
        "p_loss": [[...], ...],   shape: (len(delta), len(rho))
        "e_moic": [[...], ...],   shape: (len(delta), len(rho))
    }
    """
    base_p_vec = np.array([conditionals[cid]["p_i"] for cid in claim_ids])

    p_loss_matrix = []
    e_moic_matrix = []

    for delta in delta_values:
        # Shift marginals
        shifted_p = np.clip(base_p_vec + delta, 0.01, 0.99)

        p_loss_row = []
        e_moic_row = []

        for rho in rho_values:
            per_deal = _sweep_single_rho(
                rho, shifted_p, outcome_vectors, vector_metrics,
                gh_nodes, gh_weights,
            )
            p_loss_row.append(per_deal[primary_deal_key]["p_loss"])
            e_moic_row.append(per_deal[primary_deal_key]["e_moic"])

        p_loss_matrix.append(p_loss_row)
        e_moic_matrix.append(e_moic_row)

    return {
        "delta_values": delta_values,
        "rho_values": rho_values,
        "p_loss": p_loss_matrix,
        "e_moic": e_moic_matrix,
    }


# ===================================================================
# Main entry point
# ===================================================================

def run_correlation_sensitivity(
    sim: SimulationResults,
    claims: list[ClaimConfig],
    grid: InvestmentGridResults,
    pricing_basis: str = "soc",
    ctx=None,
) -> dict:
    """Run full correlation sensitivity analysis.

    Uses the one-factor Gaussian copula (Vasicek model) to model how
    portfolio risk metrics change with cross-claim equicorrelation ρ.

    Parameters
    ----------
    sim : SimulationResults
        Completed MC simulation with per-claim path results.
    claims : list[ClaimConfig]
        Claim configurations.
    grid : InvestmentGridResults
        Investment grid (used for reference; not modified).
    pricing_basis : str
        "soc" or "eq" pricing basis.
    ctx : optional
        Portfolio context.

    Returns
    -------
    dict : JSON-serializable correlation sensitivity results.
    """
    t0 = time.time()
    print("Computing correlation sensitivity analysis...")

    # Step 1: Extract binary conditionals from MC paths
    claim_ids = [c.claim_id for c in claims]
    K = len(claim_ids)
    print(f"  {K} claims, {2**K} outcome vectors")

    conditionals = _extract_binary_conditionals(sim, claims)

    # Step 2: Set up quadrature
    gh_nodes, gh_weights = _setup_gauss_hermite(N_GH_NODES)
    print(f"  {N_GH_NODES}-node Gauss-Hermite quadrature")

    # Step 3: Enumerate outcome vectors
    outcome_vectors = _enumerate_outcome_vectors(K)

    # Step 4: Pre-compute MOIC/IRR for all vectors × deals
    print("  Pre-computing vector metrics...")
    vector_metrics = _precompute_vector_metrics(
        outcome_vectors, conditionals, claim_ids,
    )

    # Step 5: Correlation sweep (main ρ sweep)
    print("  Sweeping correlation ρ = 0.00 to 1.00...")
    sweep_result = _sweep_correlation(
        conditionals, claim_ids, RHO_VALUES,
        outcome_vectors, vector_metrics,
        gh_nodes, gh_weights,
    )

    # Step 6: Build 2D heatmap
    print("  Building 2D (δ × ρ) heatmap...")
    heatmap_2d = _build_2d_surface(
        conditionals, claim_ids,
        HEATMAP_DELTA_VALUES, HEATMAP_RHO_VALUES,
        outcome_vectors, vector_metrics,
        gh_nodes, gh_weights,
    )

    # Step 7: Build per-claim summary
    per_claim = {}
    for cid in claim_ids:
        c = conditionals[cid]
        per_claim[cid] = {
            "p_i": round(c["p_i"], 4),
            "e_collected_win_cr": round(c["e_collected_win_cr"], 2),
            "e_collected_lose_cr": round(c["e_collected_lose_cr"], 2),
            "e_legal_win_cr": round(c["e_legal_win_cr"], 2),
            "e_legal_lose_cr": round(c["e_legal_lose_cr"], 2),
            "e_duration_win_months": round(c["e_duration_win_months"], 1),
            "e_duration_lose_months": round(c["e_duration_lose_months"], 1),
        }

    # Step 8: Diversification benefit (using primary deal 10_20)
    primary_key = "10_20"
    p_loss_curve = sweep_result[primary_key]["p_loss"]
    # ρ=0 is index 0, ρ=0.5 is index 10, ρ=1.0 is index 20
    p_loss_indep = p_loss_curve[0]
    p_loss_mid = p_loss_curve[10]
    p_loss_perfect = p_loss_curve[20]
    div_ratio = p_loss_indep / p_loss_mid if p_loss_mid > EPS else 0.0

    # Step 9: Build reference deal metadata
    reference_deals = []
    for (up_pct, tail_pct) in REFERENCE_DEALS:
        deal_key = f"{int(up_pct * 100)}_{int(tail_pct * 100)}"
        reference_deals.append({
            "upfront_pct": up_pct,
            "tata_tail_pct": tail_pct,
            "label": f"{int(up_pct * 100)}% / {int(tail_pct * 100)}%",
            "key": deal_key,
        })

    elapsed = time.time() - t0
    print(f"  Correlation sensitivity complete in {elapsed:.2f}s")

    return {
        "rho_values": RHO_VALUES,
        "reference_deals": reference_deals,
        "per_deal": sweep_result,
        "heatmap_2d": heatmap_2d,
        "per_claim": per_claim,
        "diversification_benefit": {
            "p_loss_independent": round(p_loss_indep, 6),
            "p_loss_mid_corr": round(p_loss_mid, 6),
            "p_loss_perfect": round(p_loss_perfect, 6),
            "diversification_ratio": round(div_ratio, 4),
        },
        "computation_time_s": round(elapsed, 2),
    }
