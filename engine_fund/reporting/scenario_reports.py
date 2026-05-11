"""Scenario comparison reporting utilities."""

from __future__ import annotations

from pathlib import Path
from typing import Iterable, Mapping

import matplotlib.pyplot as plt
import numpy as np


def _median_or_nan(values: Iterable[float]) -> float:
    arr = np.array(list(values), dtype=float)
    if arr.size == 0:
        return float("nan")
    return float(np.median(arr))


def generate_scenario_comparison_chart(
    scenario_metrics: Iterable[Mapping[str, object]],
    *,
    output_dir: Path,
) -> Path:
    """Generate a bar chart comparing median IRR per scenario."""

    scenario_names = []
    med_irr = []
    for entry in scenario_metrics:
        scenario_names.append(str(entry.get("scenario", "")))
        irr_values = entry.get("irr_results") or []
        med_irr.append(_median_or_nan(irr_values))

    if not scenario_names:
        raise ValueError("No scenario metrics provided")

    output_dir.mkdir(parents=True, exist_ok=True)
    chart_path = output_dir / "scenario_irr_comparison.png"

    plt.figure(figsize=(8, 5))
    bars = plt.bar(scenario_names, med_irr, color="#1f77b4")
    plt.ylabel("Median IRR")
    plt.title("Scenario Comparison: Median IRR")
    plt.grid(axis="y", linestyle="--", alpha=0.4)

    # Annotate bars
    for bar, val in zip(bars, med_irr):
        if np.isnan(val):
            label = "n/a"
        else:
            label = f"{val*100:.1f}%"
        plt.text(bar.get_x() + bar.get_width() / 2, bar.get_height(), label, ha="center", va="bottom", fontsize=9)

    plt.tight_layout()
    plt.savefig(chart_path, dpi=150)
    plt.close()
    return chart_path
