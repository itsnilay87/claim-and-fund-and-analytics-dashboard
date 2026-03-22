"""
v2_json_exporter_ext.py — Extended dashboard JSON for new investment structures.
=================================================================================

Adds structure-specific sections to the base dashboard JSON produced by
v2_json_exporter.export_dashboard_json().  Each structure type injects
its own keys (waterfall_grid, purchase_sensitivity, milestone_analysis,
or comparative) while also setting structure_type and structure_params.

All monetary values serialised in ₹ Crore.
"""

from __future__ import annotations

from typing import Any

import numpy as np


# ===================================================================
# JSON-safe serialisation helpers
# ===================================================================

def _safe(v: Any) -> Any:
    """Convert numpy scalars/arrays to JSON-serialisable Python types."""
    if isinstance(v, (np.integer,)):
        return int(v)
    if isinstance(v, (np.floating,)):
        return round(float(v), 6)
    if isinstance(v, np.ndarray):
        return [_safe(x) for x in v.tolist()]
    if isinstance(v, dict):
        return {str(k): _safe(val) for k, val in v.items()}
    if isinstance(v, (list, tuple)):
        return [_safe(x) for x in v]
    return v


def _pct(v: float) -> float:
    """Round a percentage/probability to 6 decimals."""
    return round(float(v), 6)


def _cr(v: float) -> float:
    """Round a currency amount to 2 decimals."""
    return round(float(v), 2)


# ===================================================================
# Main: extend_dashboard_json
# ===================================================================

def extend_dashboard_json(
    base_json: dict,
    structure_type: str,
    grid_results: dict,
    portfolio_structure: Any = None,
) -> dict:
    """Add structure-specific sections to the base dashboard JSON.

    Parameters
    ----------
    base_json : dict
        Output of ``v2_json_exporter.export_dashboard_json()``.
    structure_type : str
        One of ``"litigation_funding"``, ``"monetisation_full_purchase"``,
        ``"monetisation_upfront_tail"``, ``"monetisation_staged"``,
        ``"comparative"``.
    grid_results : dict
        Output of the corresponding ``analyze_*`` function from
        ``v2_investment_analysis_ext``.
    portfolio_structure : object, optional
        The ``PortfolioStructure`` Pydantic model or a dict representation.

    Returns
    -------
    dict — *base_json* mutated in-place with extra keys.
    """
    # Always stamp the structure type
    base_json["structure_type"] = structure_type

    if portfolio_structure is not None:
        if hasattr(portfolio_structure, "model_dump"):
            base_json["structure_params"] = _safe(portfolio_structure.model_dump())
        elif isinstance(portfolio_structure, dict):
            base_json["structure_params"] = _safe(portfolio_structure)
        else:
            base_json["structure_params"] = str(portfolio_structure)

    # Dispatch to structure-specific builder
    if structure_type == "litigation_funding":
        _extend_litigation_funding(base_json, grid_results)
    elif structure_type == "monetisation_full_purchase":
        _extend_full_purchase(base_json, grid_results)
    elif structure_type == "monetisation_staged":
        _extend_staged(base_json, grid_results)
    elif structure_type == "comparative":
        _extend_comparative(base_json, grid_results)
    elif structure_type == "monetisation_upfront_tail":
        # The base JSON already contains investment_grid_soc etc.
        # No extra keys needed beyond structure_type stamp.
        pass

    return base_json


# ===================================================================
# Litigation Funding
# ===================================================================

def _extend_litigation_funding(base_json: dict, results: dict) -> None:
    """Inject waterfall_grid, waterfall_axes, waterfall_breakeven."""

    # Flatten grid cells for serialisation
    grid_rows = []
    raw_grid = results.get("grid", {})
    for key, cell in raw_grid.items():
        grid_rows.append({
            "cost_multiple": _safe(cell["cost_multiple"]),
            "award_ratio": _safe(cell["award_ratio"]),
            "mean_moic": _pct(cell["mean_moic"]),
            "median_moic": _pct(cell["median_moic"]),
            "mean_xirr": _pct(cell["mean_xirr"]),
            "median_xirr": _pct(cell.get("median_xirr", 0)),
            "p_loss": _pct(cell["p_loss"]),
            "p_hurdle": _pct(cell.get("p_hurdle", 0)),
            "var_5": _cr(cell.get("var_5", 0)),
            "cvar_5": _cr(cell.get("cvar_5", 0)),
            "mean_net_return_cr": _cr(cell.get("mean_net_return_cr", 0)),
        })

    base_json["waterfall_grid"] = grid_rows
    base_json["waterfall_axes"] = _safe(results.get("axes", {}))
    base_json["waterfall_breakeven"] = _safe(results.get("breakeven_curve", []))
    base_json["waterfall_best_cell"] = _safe(results.get("best_cell", {}))
    base_json["waterfall_type"] = results.get("waterfall_type", "min")


# ===================================================================
# Full Purchase
# ===================================================================

def _extend_full_purchase(base_json: dict, results: dict) -> None:
    """Inject purchase_sensitivity, purchase_breakeven."""

    rows = []
    for row in results.get("sensitivity", []):
        rows.append({
            "price": _cr(row["price"]),
            "mean_moic": _pct(row["mean_moic"]),
            "median_moic": _pct(row.get("median_moic", 0)),
            "mean_xirr": _pct(row["mean_xirr"]),
            "median_xirr": _pct(row.get("median_xirr", 0)),
            "p_loss": _pct(row["p_loss"]),
            "p5_moic": _pct(row.get("p5_moic", 0)),
            "p95_moic": _pct(row.get("p95_moic", 0)),
            "mean_net_return_cr": _cr(row.get("mean_net_return_cr", 0)),
        })

    base_json["purchase_sensitivity"] = rows
    base_json["purchase_breakeven"] = (
        _cr(results["breakeven_price"])
        if results.get("breakeven_price") is not None
        else None
    )
    base_json["purchase_optimal_price"] = (
        _cr(results["optimal_price"])
        if results.get("optimal_price") is not None
        else None
    )


# ===================================================================
# Staged Payments
# ===================================================================

def _extend_staged(base_json: dict, results: dict) -> None:
    """Inject milestone_analysis."""

    per_milestone = []
    for ms in results.get("per_milestone", []):
        pm = {
            "name": ms["name"],
            "payment_cr": _cr(ms["payment_cr"]),
            "trigger_rate": _pct(ms["trigger_rate"]),
            "mean_payment": _cr(ms["mean_payment"]),
            "total_expected": _cr(ms["total_expected"]),
        }
        if ms.get("timing"):
            pm["timing"] = {k: round(v, 1) for k, v in ms["timing"].items()}
        per_milestone.append(pm)

    summary = results.get("summary", {})
    base_json["milestone_analysis"] = {
        "summary": {
            "mean_moic": _pct(summary.get("mean_moic", 0)),
            "median_moic": _pct(summary.get("median_moic", 0)),
            "mean_xirr": _pct(summary.get("mean_xirr", 0)),
            "median_xirr": _pct(summary.get("median_xirr", 0)),
            "p_loss": _pct(summary.get("p_loss", 0)),
            "p_hurdle": _pct(summary.get("p_hurdle", 0)),
            "var_5": _cr(summary.get("var_5", 0)),
            "mean_net_return_cr": _cr(summary.get("mean_net_return_cr", 0)),
            "mean_invested_cr": _cr(summary.get("mean_invested_cr", 0)),
        },
        "per_milestone": per_milestone,
        "total_expected_investment": _cr(
            results.get("total_expected_investment", 0)
        ),
        "milestone_timing": _safe(results.get("milestone_timing", {})),
    }


# ===================================================================
# Comparative
# ===================================================================

def _extend_comparative(base_json: dict, results: dict) -> None:
    """Inject comparative section with both structures and comparison."""

    def _fmt_side(side: dict) -> dict:
        sm = side.get("summary_metrics", {})
        return {
            "type": side.get("type", ""),
            "params": _safe(side.get("params", {})),
            "summary_metrics": {
                "mean_moic": _pct(sm.get("mean_moic", 0)),
                "median_moic": _pct(sm.get("median_moic", 0)),
                "mean_xirr": _pct(sm.get("mean_xirr", 0)),
                "median_xirr": _pct(sm.get("median_xirr", 0)),
                "p_loss": _pct(sm.get("p_loss", 0)),
                "p_hurdle": _pct(sm.get("p_hurdle", 0)),
                "var_5": _cr(sm.get("var_5", 0)),
                "mean_net_return_cr": _cr(sm.get("mean_net_return_cr", 0)),
            },
        }

    comp = results.get("comparison", {})
    base_json["comparative"] = {
        "structure_a": _fmt_side(results.get("structure_a", {})),
        "structure_b": _fmt_side(results.get("structure_b", {})),
        "comparison": {
            "moic_advantage": comp.get("moic_advantage", ""),
            "irr_advantage": comp.get("irr_advantage", ""),
            "risk_advantage": comp.get("risk_advantage", ""),
            "correlation": _pct(comp.get("correlation", 0)),
            "moic_diff": _pct(comp.get("moic_diff", 0)),
            "irr_diff": _pct(comp.get("irr_diff", 0)),
            "p_loss_diff": _pct(comp.get("p_loss_diff", 0)),
        },
    }
