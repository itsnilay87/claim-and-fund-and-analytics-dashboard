"""HTML dashboard generator powered by D3.js visualisations.

This module leaves the existing Matplotlib reporting intact while offering an
alternative, browser-based dashboard.  The main entry point is
``generate_d3_dashboard`` — supply it with the stochastic model and IRR
distribution you already compute, and it will write an interactive HTML file
under ``reports/`` that you can open locally or host on an internal site.
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Iterable, List, Literal, Optional, Sequence

import pandas as pd

from .formatting import build_formatted_sections
from .template_loader import assemble_dashboard
from ..utils.cashflow import USDINR


NAV_REBASE_FACTOR = 50.0


@dataclass(frozen=True)
class SensitivitySeries:
    """Container for a single sensitivity sweep."""

    variable: str
    records: List[dict]


def _ensure_float(value) -> Optional[float]:
  """Return a finite ``float`` or ``None`` when serialising to JSON."""

  if value is None:
    return None
  try:
    candidate = float(value)
  except (TypeError, ValueError):
    return None
  if math.isnan(candidate) or math.isinf(candidate):
    return None
  return candidate


def _prepare_j_curve(model) -> List[dict]:
    """Summarise simulated cashflows by percentile for the J curve chart."""

    if model.results is None or model.results.empty:
        raise ValueError("Model must be executed before generating the dashboard")

    results = model.results
    diff = results.diff().abs()
    activity_mask = diff.gt(1e-6).any(axis=1)
    if not results.empty:
        initial_activity = (results.iloc[0].abs() > 1e-6).any()
        if activity_mask.empty:
            activity_mask = pd.Series(False, index=results.index)
        activity_mask.iloc[0] = activity_mask.iloc[0] or initial_activity
    if activity_mask.any():
        last_active_index = activity_mask[activity_mask].index.max()
        results = results.loc[:last_active_index]

    quantiles = results.quantile([0.05, 0.25, 0.5, 0.75, 0.95], axis=1)
    payload: List[dict] = []
    for timestamp in results.index:
        payload.append(
            {
                "date": timestamp.strftime("%Y-%m-%d"),
                "p5": _ensure_float(quantiles.loc[0.05, timestamp]),
                "p25": _ensure_float(quantiles.loc[0.25, timestamp]),
                "median": _ensure_float(quantiles.loc[0.5, timestamp]),
                "p75": _ensure_float(quantiles.loc[0.75, timestamp]),
                "p95": _ensure_float(quantiles.loc[0.95, timestamp]),
            }
        )
    return payload


def _prepare_alpha_cashflow_bars(monthly_timeseries: Optional[pd.DataFrame]) -> List[dict]:
    """Build Alpha cashflow series for the bar + cumulative overlay chart."""

    if monthly_timeseries is None or monthly_timeseries.empty:
        return []

    columns_choice = None
    if {"gross_investment_outflows", "gross_investment_inflows"}.issubset(monthly_timeseries.columns):
        columns_choice = ("gross_investment_outflows", "gross_investment_inflows", "gross_investment_cashflow")
    elif {"investments_outflows", "payouts_inflows"}.issubset(monthly_timeseries.columns):
        columns_choice = ("investments_outflows", "payouts_inflows", "net_cashflow")

    if columns_choice is None:
        return []

    out_col, in_col, net_col = columns_choice

    df = monthly_timeseries.copy()
    df.index = pd.to_datetime(df.index, errors="coerce")
    df = df[~df.index.isna()].sort_index()

    if df.empty:
        return []

    selected = pd.DataFrame(index=df.index)
    selected["outflow_amount"] = df[out_col].fillna(0.0).astype(float)
    selected["inflow_amount"] = df[in_col].fillna(0.0).astype(float)

    if net_col in df.columns:
        selected["net"] = df[net_col].fillna(0.0).astype(float)
    else:
        selected["net"] = selected["inflow_amount"] - selected["outflow_amount"]

    numeric = selected[["outflow_amount", "inflow_amount", "net"]]
    change_mask = (numeric.diff().abs() > 1e-6).any(axis=1)
    if not numeric.empty:
        initial_activity = (numeric.iloc[0].abs() > 1e-6).any()
        change_mask.iloc[0] = change_mask.iloc[0] or initial_activity

    if change_mask.any():
        last_active = change_mask[change_mask].index.max()
        selected = selected.loc[:last_active]
    else:
        selected = selected.iloc[0:0]

    if selected.empty:
        return []

    selected["cumulative"] = selected["net"].cumsum()

    payload: List[dict] = []
    for timestamp, row in selected.iterrows():
        outflow_amount = float(row.get("outflow_amount", 0.0))
        inflow_amount = float(row.get("inflow_amount", 0.0))
        net_amount = float(row.get("net", inflow_amount - outflow_amount))
        cumulative_amount = float(row.get("cumulative", 0.0))
        payload.append(
            {
                "date": timestamp.strftime("%Y-%m-%d"),
                "outflow": _ensure_float(-outflow_amount),
                "outflow_amount": _ensure_float(outflow_amount),
                "inflow": _ensure_float(inflow_amount),
                "inflow_amount": _ensure_float(inflow_amount),
                "net": _ensure_float(net_amount),
                "cumulative": _ensure_float(cumulative_amount),
            }
        )

    return payload


def _prepare_irr_distribution(irr_distribution: Iterable[float]) -> List[float]:
    """Normalise IRR inputs to floats."""

    return [float(x) for x in irr_distribution if x is not None]


def _load_sensitivity_frames(paths: Iterable[Path]) -> List[SensitivitySeries]:
    """Read pre-generated sensitivity CSV files, when available."""

    series: List[SensitivitySeries] = []
    for csv_path in paths:
        if not csv_path.exists():
            continue
        df = pd.read_csv(csv_path)
        if df.empty:
            continue
        variable = csv_path.stem.replace("sensitivity_", "")
        records = [
          {
            "value": _ensure_float(row.get("value")),
            "net_annualised_irr_pct": _ensure_float(row.get("net_annualised_irr_pct")),
            "roic_multiple": _ensure_float(row.get("roic_multiple")),
          }
          for row in df.to_dict("records")
        ]
        series.append(SensitivitySeries(variable=variable, records=records))
    return series


def _discover_sensitivity_files(root: Path) -> List[Path]:
    """Auto-discover sensitivity CSVs saved by ``sensitivity.py``."""

    return sorted(root.glob("sensitivity_*.csv"))


def generate_d3_dashboard(
  model,
  irr_distribution: Sequence[float],
  *,
  output_dir: Path | str = "reports/current",
  output_filename: str = "fund_dashboard.html",
  sensitivity_files: Optional[Iterable[Path]] = None,
  fund_metadata: Optional[Dict[str, Any]] = None,
  fund_metrics: Optional[Dict[str, Any]] = None,
  exchange_rate: Optional[float] = None,
  monthly_timeseries: Optional[pd.DataFrame] = None,
) -> Path:
    """Create an interactive D3.js dashboard from simulation artefacts.

    Parameters
    ----------
    model:
        Instance of ``CashFlowModel`` with the ``results`` attribute populated.
    irr_distribution:
      Collection of annualised net IRRs produced by the simulation step.
    output_dir:
        Target directory for the generated HTML.  Created if it does not exist.
    output_filename:
        Name of the HTML file to create (defaults to ``fund_dashboard.html``).
    sensitivity_files:
        Optional iterable of CSV paths produced by the sensitivity sweep.  When
        omitted, the function will search ``output_dir`` for files matching the
        ``sensitivity_*.csv`` pattern.

    Returns
    -------
    Path
        The fully qualified path to the generated HTML dashboard.
    """

    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)

    j_curve_payload = _prepare_j_curve(model)
    alpha_cashflow_payload = _prepare_alpha_cashflow_bars(monthly_timeseries)
    irr_payload = _prepare_irr_distribution(irr_distribution)

    if sensitivity_files is None:
        sensitivity_sources = _discover_sensitivity_files(output_path)
    else:
        sensitivity_sources = list(sensitivity_files)
    sensitivity_series = _load_sensitivity_frames(sensitivity_sources)

    sensitivity_payload = [
      {"variable": series.variable, "records": series.records}
      for series in sensitivity_series
    ]

    metadata_rows, metrics_rows, _, _ = build_formatted_sections(
      fund_metadata,
      fund_metrics,
      exchange_rate or USDINR,
    )
    metadata_payload = metadata_rows
    metrics_payload = metrics_rows

    nav_payload: List[dict] = []
    if monthly_timeseries is not None and not monthly_timeseries.empty:
      nav_columns = ["market_nav", "total_nav", "hybrid_nav"]
      if all(column in monthly_timeseries.columns for column in nav_columns):
        nav_frame = monthly_timeseries[nav_columns].copy()
        nav_frame = nav_frame.dropna(how="all")
        if not nav_frame.empty:
          nav_frame.index = pd.to_datetime(nav_frame.index)
          nav_frame.sort_index(inplace=True)
          scaled = nav_frame.astype(float) / NAV_REBASE_FACTOR / 1e7
          nav_payload = [
            {
              "date": idx.strftime("%Y-%m-%d"),
              "market_nav": _ensure_float(row.get("market_nav")),
              "total_nav": _ensure_float(row.get("total_nav")),
              "hybrid_nav": _ensure_float(row.get("hybrid_nav")),
            }
            for idx, row in scaled.iterrows()
          ]

    summary_stats_payload: List[dict] = []
    distributions_payload: Dict[str, dict] = {}

    stats_df = getattr(model, "simulation_statistics", None)
    if isinstance(stats_df, pd.DataFrame) and not stats_df.empty:
      stats_records = stats_df.to_dict("records")
      for idx, row in enumerate(stats_records):
        summary_stats_payload.append(
          {
            "metric": row.get("metric"),
            "label": row.get("label") or row.get("metric"),
            "format": row.get("format", "number"),
            "order": int(row.get("order", idx)),
            "alpha": _ensure_float(row.get("alpha")),
            "count": int(row.get("count", 0)) if row.get("count") is not None else 0,
            "min": _ensure_float(row.get("min")),
            "p25": _ensure_float(row.get("p25")),
            "median": _ensure_float(row.get("median")),
            "mean": _ensure_float(row.get("mean")),
            "p75": _ensure_float(row.get("p75")),
            "max": _ensure_float(row.get("max")),
            "std": _ensure_float(row.get("std")),
          }
        )
      summary_stats_payload.sort(key=lambda item: item.get("order", 9999))

    distributions_source = getattr(model, "simulation_distributions", None) or {}
    metric_metadata = getattr(model, "metric_metadata", {}) or {}
    for metric, payload in distributions_source.items():
      histogram = [
        {
          "bin_start": _ensure_float(entry.get("bin_start")),
          "bin_end": _ensure_float(entry.get("bin_end")),
          "count": int(entry.get("count", 0)),
        }
        for entry in payload.get("histogram", [])
      ]
      summary = {
        key: _ensure_float(payload.get("summary", {}).get(key))
        for key in ["min", "p25", "median", "mean", "p75", "max"]
      }
      distributions_payload[metric] = {
        "label": payload.get("label") or metric_metadata.get(metric, {}).get("label") or metric,
        "format": payload.get("format") or metric_metadata.get(metric, {}).get("format", "number"),
        "order": metric_metadata.get(metric, {}).get("order", 9_999),
        "histogram": histogram,
        "summary": summary,
        "alpha": _ensure_float(payload.get("alpha")),
      }

    distributions_payload = dict(
      sorted(distributions_payload.items(), key=lambda item: item[1].get("order", 9_999))
    )

    # Assemble dashboard from external templates
    html_content = assemble_dashboard({
        "J_CURVE_DATA": json.dumps(j_curve_payload),
        "IRR_DATA": json.dumps(irr_payload),
        "METADATA_DATA": json.dumps(metadata_payload),
        "METRICS_DATA": json.dumps(metrics_payload),
        "SENSITIVITY_DATA": json.dumps(sensitivity_payload),
        "NAV_DATA": json.dumps(nav_payload),
        "ALPHA_CASHFLOW_DATA": json.dumps(alpha_cashflow_payload),
        "SIM_STATS_DATA": json.dumps(summary_stats_payload),
        "SIM_DISTRIBUTIONS_DATA": json.dumps(distributions_payload),
    })

    dashboard_path = output_path / output_filename
    dashboard_path.write_text(html_content, encoding="utf-8")
    return dashboard_path


__all__ = ["generate_d3_dashboard"]
