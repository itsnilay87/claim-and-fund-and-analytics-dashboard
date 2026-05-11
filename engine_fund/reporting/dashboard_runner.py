"""Helpers for building dashboard artefacts across entry points."""

from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path
from typing import List, Sequence

import numpy as np

from ..core.simulation import CashFlowModel
from ..utils.cashflow import compute_internal_rate_of_return

CURRENT_REPORTS_DIR = Path("reports/current")
CURRENT_SENSITIVITY_DIR = CURRENT_REPORTS_DIR / "sensitivity"

SENSITIVITY_VARIABLES: Sequence[str] = (
    "average_prob_success",
    "average_duration",
    "payout_multiple",
    "award_ratio",
)


def ensure_current_reports_dir() -> Path:
    """Guarantee that the ``reports/current`` directory exists."""

    CURRENT_REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    return CURRENT_REPORTS_DIR


def ensure_current_sensitivity_dir() -> Path:
    """Guarantee that the ``reports/current/sensitivity`` directory exists."""

    ensure_current_reports_dir()
    CURRENT_SENSITIVITY_DIR.mkdir(parents=True, exist_ok=True)
    return CURRENT_SENSITIVITY_DIR


def compute_irr_distribution(model: CashFlowModel) -> List[float]:
    """Derive annualised IRRs from the simulation output."""

    irr_values: List[float] = []
    if model.results is None or model.results.empty:
        return irr_values

    for column in model.results.columns:
        cumulative_cf = model.results[column]
        monthly_cf = cumulative_cf.diff().fillna(cumulative_cf.iloc[0])
        cashflow_array = monthly_cf.to_numpy()
        if not cashflow_array.any():
            continue
        last_event_index = np.nonzero(cashflow_array)[0][-1]
        trimmed = monthly_cf.iloc[: last_event_index + 1]
        monthly_irr = compute_internal_rate_of_return(trimmed.values)
        if np.isnan(monthly_irr):
            continue
        annual_irr = (1 + monthly_irr) ** 12 - 1
        if np.isnan(annual_irr):
            continue
        irr_values.append(float(annual_irr))
    return irr_values


def _run_sensitivity_script(
    *,
    script_path: Path,
    variable: str,
    output_path: Path,
    python_executable: str | None,
    sample_size: int | None,
    max_workers: int | None,
    case_mode: str | None,
) -> None:
    python_cmd = python_executable or sys.executable
    cmd = [python_cmd, str(script_path), "--variable", variable, "--output", str(output_path)]
    if sample_size is not None and sample_size > 0:
        cmd.extend(["--simulations", str(sample_size)])
    if max_workers is not None and max_workers > 0:
        cmd.extend(["--workers", str(max_workers)])
    if case_mode:
        cmd.extend(["--case-mode", case_mode])
    subprocess.run(
        cmd,
        check=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )


def prepare_sensitivity_data(
    *,
    regenerate: bool = True,
    script_path: Path | None = None,
    variables: Sequence[str] = SENSITIVITY_VARIABLES,
    python_executable: str | None = None,
    sample_size: int | None = None,
    max_workers: int | None = None,
    case_mode: str | None = None,
    current_dir: Path | None = None,
    archive_dir: Path | None = None,
    timestamp: str | None = None,
) -> List[Path]:
    """Ensure sensitivity CSVs are available for the dashboard.

    When ``regenerate`` is True the helper invokes ``sensitivity.py`` for each
    requested variable, saving timestamped artefacts into ``archive_dir`` (when
    provided) and copying untimestamped variants into
    ``reports/current/sensitivity``. When ``regenerate`` is False the existing
    untimestamped artefacts are reused and optionally mirrored to the archive.
    """

    current_root = Path(current_dir) if current_dir is not None else ensure_current_sensitivity_dir()
    current_root.mkdir(parents=True, exist_ok=True)

    archive_root = Path(archive_dir) if archive_dir is not None else None
    if archive_root is not None:
        archive_root.mkdir(parents=True, exist_ok=True)

    available: List[Path] = []
    timestamp_suffix = f"_{timestamp}" if timestamp else ""

    if regenerate:
        if script_path is None or not script_path.exists():
            print("⚠️  Sensitivity script not found; skipping regeneration.")
        else:
            for variable in variables:
                base_name = f"sensitivity_{variable}"
                current_csv = current_root / f"{base_name}.csv"
                current_png = current_csv.with_suffix(".png")

                for stale in current_root.glob(f"{base_name}" + "*.csv"):
                    try:
                        if stale.exists():
                            stale.unlink()
                    except OSError:
                        pass
                for stale_plot in current_root.glob(f"{base_name}" + "*.png"):
                    try:
                        if stale_plot.exists():
                            stale_plot.unlink()
                    except OSError:
                        pass

                archive_csv = (
                    archive_root / f"{base_name}{timestamp_suffix}.csv" if archive_root is not None else current_csv
                )

                sample_note = f"{sample_size} sims" if sample_size is not None and sample_size > 0 else "default sims"
                print(f"⚙️  Running sensitivity sweep for {variable} ({sample_note})...")
                try:
                    _run_sensitivity_script(
                        script_path=script_path,
                        variable=variable,
                        output_path=archive_csv,
                        python_executable=python_executable,
                        sample_size=sample_size,
                        max_workers=max_workers,
                        case_mode=case_mode,
                    )
                    print(f"✅ Sensitivity CSV saved to {archive_csv}")
                    if archive_root is not None:
                        archive_png = archive_csv.with_suffix(".png")
                        shutil.copy2(archive_csv, current_csv)
                        if archive_png.exists():
                            shutil.copy2(archive_png, current_png)
                except subprocess.CalledProcessError as exc:
                    print(f"⚠️  Sensitivity sweep for {variable} failed: {exc}")
                    stdout = exc.stdout.decode("utf-8", errors="ignore") if exc.stdout else ""
                    stderr = exc.stderr.decode("utf-8", errors="ignore") if exc.stderr else ""
                    if stdout:
                        print(stdout)
                    if stderr:
                        print(stderr)
                except FileNotFoundError:
                    print("⚠️  Python executable not found; skipping remaining sensitivity sweeps.")
                    break

    for variable in variables:
        base_name = f"sensitivity_{variable}"
        candidate = current_root / f"{base_name}.csv"
        if candidate.exists():
            available.append(candidate)
        else:
            print(f"⚠️  Sensitivity CSV for {variable} unavailable; dashboard section may be empty.")

        if candidate.exists() and archive_root is not None:
            archive_target = archive_root / f"{base_name}{timestamp_suffix}.csv"
            try:
                if not archive_target.exists():
                    shutil.copy2(candidate, archive_target)
            except OSError:
                pass
            current_png = candidate.with_suffix(".png")
            if current_png.exists():
                archive_png = archive_target.with_suffix(".png")
                try:
                    if not archive_png.exists():
                        shutil.copy2(current_png, archive_png)
                except OSError:
                    pass

    return available


__all__ = [
    "CURRENT_REPORTS_DIR",
    "CURRENT_SENSITIVITY_DIR",
    "SENSITIVITY_VARIABLES",
    "compute_irr_distribution",
    "ensure_current_reports_dir",
    "ensure_current_sensitivity_dir",
    "prepare_sensitivity_data",
]
