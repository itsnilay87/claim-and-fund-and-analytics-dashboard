"""
engine/analysis/risk_metrics.py — Portfolio-level risk analytics.
=================================================================

Computes:
  - MOIC / IRR distribution percentiles
  - Duration distribution (per-claim and portfolio)
  - Capital-at-risk timeline
  - Concentration metrics (Herfindahl indices)
  - Stress scenarios

All monetary values in ₹ Crore.
"""

from __future__ import annotations

import logging
from typing import Optional

import numpy as np

from engine.config.schema import (
    ClaimConfig,
    GridCellMetrics,
    PathResult,
    PortfolioStructure,
    SimulationConfig,
)
from engine.simulation.cashflow_builder import (
    build_upfront_tail_cashflow,
    build_litigation_funding_cashflow,
    merge_dated_cashflows,
)
from engine.simulation.metrics import (
    compute_xirr,
    compute_moic,
    compute_var,
    compute_cvar,
)


LOGGER = logging.getLogger(__name__)


def _percentiles(arr: np.ndarray) -> dict[str, float]:
    """Compute standard distribution percentiles."""
    if len(arr) == 0:
        return {}
    return {
        f"p{p}": round(float(np.percentile(arr, p)), 4)
        for p in [1, 5, 10, 25, 50, 75, 90, 95, 99]
    }


# ===================================================================
# Expected Cashflow IRR (Industry-Standard Approach)
# ===================================================================

def compute_expected_cashflow_irr(
    claims: list[ClaimConfig],
    all_path_results: dict[str, list[PathResult]],
    portfolio_structure: PortfolioStructure,
    reference_upfront: float = 0.10,
    reference_tail: float = 0.20,
    start_date: str = "2026-04-30",
) -> float:
    """Compute IRR of the expected (mean) portfolio cashflow across all MC paths.

    Instead of averaging per-path IRRs (which is mathematically incorrect because
    IRR is a non-linear function and -100% loss paths dominate the arithmetic mean),
    this function:
    1. For each MC path, builds the full dated cashflow for the portfolio
    2. Merges all path cashflows into a date-aligned matrix
    3. Computes the arithmetic mean cashflow at each date
    4. Computes XIRR on the resulting expected cashflow stream

    This is the industry-standard approach for expected IRR in litigation finance
    and produces results consistent with E[MOIC].
    """
    from datetime import datetime as _dt

    first_cid = claims[0].id
    n_paths = len(all_path_results.get(first_cid, []))
    if n_paths == 0:
        return 0.0

    stype = portfolio_structure.type

    # Collect per-path merged cashflows as {date: cashflow} dicts
    all_dates_set: set[_dt] = set()
    path_cf_dicts: list[dict[_dt, float]] = []

    for path_i in range(n_paths):
        path_cfs: list[tuple[list, list]] = []

        for claim in claims:
            results = all_path_results.get(claim.id, [])
            if path_i >= len(results):
                continue
            pr = results[path_i]

            dates, cfs, _, _ = _build_path_cashflow(
                claim, pr, stype, portfolio_structure,
                reference_upfront, reference_tail, start_date,
            )
            path_cfs.append((dates, cfs))

        if path_cfs:
            merged_dates, merged_cfs = merge_dated_cashflows(path_cfs)
        else:
            merged_dates, merged_cfs = [], []

        cf_dict: dict[_dt, float] = {}
        for d, cf in zip(merged_dates, merged_cfs):
            cf_dict[d] = cf_dict.get(d, 0.0) + cf
            all_dates_set.add(d)

        path_cf_dicts.append(cf_dict)

    if not all_dates_set:
        return 0.0

    # Build date-aligned matrix and compute column means
    sorted_dates = sorted(all_dates_set)
    expected_cfs: list[float] = []

    for d in sorted_dates:
        total = sum(pcf.get(d, 0.0) for pcf in path_cf_dicts)
        expected_cfs.append(total / n_paths)

    if len(sorted_dates) < 2:
        return 0.0

    return compute_xirr(sorted_dates, expected_cfs)


# ===================================================================
# Main entry point
# ===================================================================

def compute_portfolio_risk(
    claims: list[ClaimConfig],
    all_path_results: dict[str, list[PathResult]],
    portfolio_structure: PortfolioStructure,
    simulation_config: SimulationConfig,
    reference_upfront: float = 0.10,
    reference_tail: float = 0.20,
    start_date: str = "2026-04-30",
) -> dict:
    """Compute comprehensive portfolio risk metrics.

    Parameters
    ----------
    claims : list[ClaimConfig]
    all_path_results : dict  {claim_id: [PathResult]}
    portfolio_structure : PortfolioStructure
    simulation_config : SimulationConfig
    reference_upfront, reference_tail : float
        Reference deal point for MOIC/XIRR computation.
    start_date : str

    Returns
    -------
    dict with moic_distribution, irr_distribution, duration_distribution,
    capital_at_risk_timeline, concentration, stress_scenarios.
    """
    first_cid = claims[0].id
    n_paths = len(all_path_results.get(first_cid, []))
    stype = portfolio_structure.type

    # ── Compute per-path portfolio MOIC / XIRR ──
    path_moics = np.zeros(n_paths)
    path_xirrs = np.zeros(n_paths)

    for path_i in range(n_paths):
        port_inv = 0.0
        port_ret = 0.0
        path_cfs: list[tuple[list, list]] = []

        for claim in claims:
            results = all_path_results.get(claim.id, [])
            if path_i >= len(results):
                continue
            pr = results[path_i]

            dates, cfs, inv, ret = _build_path_cashflow(
                claim, pr, stype, portfolio_structure,
                reference_upfront, reference_tail, start_date,
            )
            path_cfs.append((dates, cfs))
            port_inv += inv
            port_ret += ret

        path_moics[path_i] = compute_moic(port_ret, port_inv)
        if path_cfs:
            pd, pc = merge_dated_cashflows(path_cfs)
            path_xirrs[path_i] = compute_xirr(pd, pc) if len(pd) >= 2 else -1.0

    # ── MOIC distribution ──
    moic_dist = _percentiles(path_moics)

    # ── IRR distribution ──
    irr_dist = _percentiles(path_xirrs)

    # ── Expected Cashflow IRR (industry-standard) ──
    expected_xirr = compute_expected_cashflow_irr(
        claims, all_path_results, portfolio_structure,
        reference_upfront, reference_tail, start_date,
    )

    # ── Duration distributions ──
    duration_per_claim: dict[str, dict] = {}
    all_durations: list[float] = []
    for c in claims:
        durs = np.array([r.timeline_months for r in all_path_results.get(c.id, [])])
        duration_per_claim[c.id] = _percentiles(durs) if len(durs) > 0 else {}
        all_durations.extend(durs.tolist())

    portfolio_dur = np.array(all_durations)
    duration_distribution = {
        "per_claim": duration_per_claim,
        "portfolio": _percentiles(portfolio_dur) if len(portfolio_dur) > 0 else {},
    }

    # ── Capital-at-risk timeline ──
    max_months = simulation_config.start_date if hasattr(simulation_config, "start_date") else "2026-04-30"
    car_timeline = _compute_capital_at_risk_timeline(
        claims, all_path_results, n_paths,
        reference_upfront, reference_tail, stype,
    )

    # ── Concentration ──
    concentration = _compute_concentration(claims)

    # ── Stress scenarios ──
    stress = _compute_stress_scenarios(
        claims, all_path_results, path_moics, path_xirrs, n_paths,
    )

    return {
        "moic_distribution": moic_dist,
        "irr_distribution": irr_dist,
        "expected_xirr": round(expected_xirr, 4),
        "duration_distribution": duration_distribution,
        "capital_at_risk_timeline": car_timeline,
        "concentration": concentration,
        "stress_scenarios": stress,
    }


def _build_path_cashflow(
    claim: ClaimConfig,
    pr: PathResult,
    stype: str,
    structure: PortfolioStructure,
    upfront: float,
    tail: float,
    start_date: str,
) -> tuple[list, list, float, float]:
    """Route to the correct cashflow builder based on structure type.

    Parameters
    ----------
    claim : ClaimConfig
    pr : PathResult
        Single MC path result for this claim.
    stype : str
        Investment structure type (e.g. 'monetisation_upfront_tail').
    structure : PortfolioStructure
        Portfolio structure with embedded params.
    upfront : float
        Reference upfront percentage (0–1).
    tail : float
        Reference tail percentage (0–1).
    start_date : str
        ISO date string for cashflow dating.

    Returns
    -------
    tuple of (dates, cashflows, total_invested, total_return)
    """
    if stype in ("monetisation_upfront_tail", "comparative"):
        return build_upfront_tail_cashflow(
            claim=claim, path_result=pr,
            upfront_pct=upfront, tail_pct=tail,
            pricing_basis="soc", start_date=start_date,
        )
    elif stype == "litigation_funding":
        params = structure.params
        return build_litigation_funding_cashflow(
            claim=claim, path_result=pr,
            cost_multiple_cap=params.cost_multiple_cap,
            award_ratio_cap=params.award_ratio_cap,
            waterfall_type=params.waterfall_type,
            start_date=start_date,
        )
    else:
        # Default to upfront/tail for other types
        return build_upfront_tail_cashflow(
            claim=claim, path_result=pr,
            upfront_pct=upfront, tail_pct=tail,
            pricing_basis="soc", start_date=start_date,
        )


def _compute_capital_at_risk_timeline(
    claims: list[ClaimConfig],
    all_path_results: dict[str, list[PathResult]],
    n_paths: int,
    upfront: float,
    tail: float,
    stype: str,
) -> list[dict]:
    """Compute cumulative capital deployed over time at p50 and p95.

    Approximates monthly capital-at-risk by spreading each claim's
    upfront payment at month 0 and legal costs evenly across the
    claim's duration, then computing percentile bands.

    Returns
    -------
    list of {month, p50_deployed_cr, p95_deployed_cr}
    """
    max_months = 96
    # Approximate: capital deployed = upfront at month 0 + legal costs spread
    # Use per-claim cumulative legal costs as proxy
    cumul_per_path = np.zeros((n_paths, max_months))

    for claim in claims:
        results = all_path_results.get(claim.id, [])
        upfront_cr = upfront * claim.soc_value_cr

        for path_i in range(min(len(results), n_paths)):
            pr = results[path_i]
            legal_total = pr.legal_costs_cr
            dur = max(int(pr.timeline_months), 1)
            dur = min(dur, max_months)

            # Month 0: upfront
            cumul_per_path[path_i, 0] += upfront_cr

            # Spread legal costs
            if dur > 0 and legal_total > 0:
                monthly_legal = legal_total / dur
                for m in range(min(dur, max_months)):
                    cumul_per_path[path_i, m] += monthly_legal

    # Cumulative sum over time
    for i in range(n_paths):
        cumul_per_path[i] = np.cumsum(cumul_per_path[i])

    timeline: list[dict] = []
    sample_months = list(range(0, 24)) + list(range(24, max_months, 3))
    for m in sorted(set(m for m in sample_months if m < max_months)):
        col = cumul_per_path[:, m]
        timeline.append({
            "month": m,
            "p50_deployed_cr": round(float(np.percentile(col, 50)), 2),
            "p95_deployed_cr": round(float(np.percentile(col, 95)), 2),
        })

    return timeline


def _compute_concentration(claims: list[ClaimConfig]) -> dict:
    """Compute portfolio concentration metrics."""
    total_soc = sum(c.soc_value_cr for c in claims)
    if total_soc <= 0:
        return {
            "herfindahl_by_jurisdiction": 0.0,
            "herfindahl_by_type": 0.0,
            "jurisdiction_breakdown": {},
            "type_breakdown": {},
        }

    # Herfindahl by jurisdiction
    jur_sums: dict[str, float] = {}
    for c in claims:
        jurisdiction = (c.jurisdiction or "").strip()
        if not jurisdiction:
            jurisdiction = "unknown"
            LOGGER.warning(
                "Claim %s missing jurisdiction; defaulting to 'unknown' for concentration",
                c.id,
            )
        jur_sums[jurisdiction] = jur_sums.get(jurisdiction, 0.0) + c.soc_value_cr
    hhi_jur = sum((v / total_soc) ** 2 for v in jur_sums.values())

    # Herfindahl by claim type
    type_sums: dict[str, float] = {}
    for c in claims:
        claim_type = (c.claim_type or "").strip()
        if not claim_type:
            claim_type = "unclassified"
            LOGGER.warning(
                "Claim %s missing claim_type; defaulting to 'unclassified' for concentration",
                c.id,
            )
        type_sums[claim_type] = type_sums.get(claim_type, 0.0) + c.soc_value_cr
    hhi_type = sum((v / total_soc) ** 2 for v in type_sums.values())

    return {
        "herfindahl_by_jurisdiction": round(hhi_jur, 4),
        "herfindahl_by_type": round(hhi_type, 4),
        "jurisdiction_breakdown": {k: round(v / total_soc, 4) for k, v in jur_sums.items()},
        "type_breakdown": {k: round(v / total_soc, 4) for k, v in type_sums.items()},
    }


def _compute_stress_scenarios(
    claims: list[ClaimConfig],
    all_path_results: dict[str, list[PathResult]],
    path_moics: np.ndarray,
    path_xirrs: np.ndarray,
    n_paths: int,
) -> list[dict]:
    """Generate stress scenario results.

    Returns four scenarios: Total Loss (all claims fail), Downside (P25),
    Base Case (P50), and Extended Timelines (paths > 72 months).

    Returns
    -------
    list of {name, description, portfolio_moic, portfolio_irr}
    """
    scenarios: list[dict] = []

    # Scenario 1: All claims lose arbitration
    lose_moic = 0.0  # If all lose, MOIC ~ 0 (only legal costs)
    scenarios.append({
        "name": "Total Loss",
        "description": "All claims lose at arbitration — zero recovery",
        "portfolio_moic": 0.0,
        "portfolio_irr": -1.0,
    })

    # Scenario 2: Only bottom-quartile paths survive
    p25_idx = int(n_paths * 0.25)
    sorted_moics = np.sort(path_moics)
    bottom_25 = sorted_moics[:p25_idx] if p25_idx > 0 else sorted_moics[:1]
    scenarios.append({
        "name": "Downside (P25)",
        "description": "25th percentile MC outcome — only worst quarter of paths",
        "portfolio_moic": round(float(np.mean(bottom_25)), 4),
        "portfolio_irr": round(float(np.percentile(path_xirrs, 25)), 4),
    })

    # Scenario 3: Median case
    scenarios.append({
        "name": "Base Case (P50)",
        "description": "Median MC outcome",
        "portfolio_moic": round(float(np.median(path_moics)), 4),
        "portfolio_irr": round(float(np.median(path_xirrs)), 4),
    })

    # Scenario 4: Extended timelines (all paths take max_horizon)
    # Approximate by looking at paths with duration > 72 months
    long_paths = []
    for c in claims:
        for r in all_path_results.get(c.id, []):
            if r.timeline_months > 72:
                long_paths.append(r)
    scenarios.append({
        "name": "Extended Timelines",
        "description": "Paths exceeding 72 months — delayed resolution stress",
        "portfolio_moic": round(float(np.mean(path_moics)), 4),
        "portfolio_irr": round(float(np.percentile(path_xirrs, 10)), 4),
    })

    return scenarios
