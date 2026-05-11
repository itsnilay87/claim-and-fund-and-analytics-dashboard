import numpy as np
import pandas as pd
from datetime import datetime
from pathlib import Path
import matplotlib
matplotlib.use('Agg')  # Use non-interactive backend
import matplotlib.pyplot as plt
from matplotlib.ticker import FuncFormatter, PercentFormatter


def visualize_results(model, irr_distribution, *, output_dir: Path | str = Path("reports"), timestamp: str | None = None):
    """Generate Matplotlib visualisations for the simulation results."""

    print("\n--- Generating Visualizations ---")

    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)
    effective_timestamp = timestamp or datetime.now().strftime("%Y%m%d%H%M%S")
    
    plt.style.use('seaborn-v0_8-whitegrid')
    
    results = model.results if model.results is not None else None
    if results is None or results.empty:
        raise ValueError("Model results are required for visualisation")

    diff = results.diff().abs()
    activity_mask = diff.gt(1e-6).any(axis=1)
    if not results.empty:
        initial_activity = (results.iloc[0].abs() > 1e-6).any()
        if activity_mask.empty:
            activity_mask = pd.Series(False, index=results.index)
        activity_mask.iloc[0] = activity_mask.iloc[0] or initial_activity
    if activity_mask.any():
        last_active_index = activity_mask[activity_mask].index.max()
        trimmed_results = results.loc[:last_active_index]
    else:
        trimmed_results = results

    # 1. Cumulative Cashflow Simulations
    fig1, ax1 = plt.subplots(figsize=(12, 7))
    trimmed_results.plot(ax=ax1, color='lightgray', alpha=0.4, legend=False)
    trimmed_results.quantile(0.25, axis=1).plot(ax=ax1, color='red', linestyle='--', label='25th Percentile')
    trimmed_results.quantile(0.5, axis=1).plot(ax=ax1, color='black', linestyle='-', label='Median (50th Percentile)')
    trimmed_results.quantile(0.75, axis=1).plot(ax=ax1, color='blue', linestyle='--', label='75th Percentile')

    ax1.set_title(f"Cumulative Net Cashflow Distribution ({model.num_simulations} Simulations)", fontsize=16)
    ax1.set_xlabel("Date", fontsize=12)
    ax1.set_ylabel("Cumulative Cashflow (USD)", fontsize=12)
    ax1.yaxis.set_major_formatter(FuncFormatter(lambda x, p: f'${x/1_000_000:.1f}M'))
    handles, labels = ax1.get_legend_handles_labels()
    filtered = [(h, l) for h, l in zip(handles, labels) if "Percentile" in l or "Median" in l]
    if filtered:
        filtered_handles, filtered_labels = zip(*filtered)
        ax1.legend(filtered_handles, filtered_labels)

    fig1.tight_layout()
    cashflow_path = output_path / f"cumulative_cashflow_{effective_timestamp}.png"
    fig1.savefig(cashflow_path)
    plt.close(fig1)
    print(f"✅ Cashflow plot saved to '{cashflow_path}'")

    # 2. IRR Distribution Histogram
    irr_values = np.asarray(irr_distribution)
    fig2, ax2 = plt.subplots(figsize=(12, 7))

    if irr_values.size == 0:
        ax2.text(0.5, 0.5, "No valid Net IRR values were generated", fontsize=14,
                 ha='center', va='center')
        ax2.set_axis_off()
    else:
        ax2.hist(irr_values, bins=30, color="#4C72B0", alpha=0.8, edgecolor="white")

        mean_irr = float(np.mean(irr_values))
        median_irr = float(np.median(irr_values))
        p5_irr = float(np.percentile(irr_values, 5))
        p95_irr = float(np.percentile(irr_values, 95))

        ax2.axvline(mean_irr, color='red', linestyle='--', label=f'Mean: {mean_irr:.2%}')
        ax2.axvline(median_irr, color='black', linestyle='-', label=f'Median: {median_irr:.2%}')

        ax2.set_title("Net Annualized IRR Distribution", fontsize=16)
        ax2.set_xlabel("Net Annualized IRR", fontsize=12)
        ax2.set_ylabel("Frequency", fontsize=12)
        ax2.xaxis.set_major_formatter(PercentFormatter(1.0))
        ax2.legend()

        stats_text = (f"Mean: {mean_irr:.2%}\n"
                      f"Median: {median_irr:.2%}\n"
                      f"5th Percentile: {p5_irr:.2%}\n"
                      f"95th Percentile: {p95_irr:.2%}")
        ax2.text(0.05, 0.95, stats_text, transform=ax2.transAxes, fontsize=12,
                 verticalalignment='top', bbox=dict(boxstyle='round,pad=0.5', fc='wheat', alpha=0.5))

    fig2.tight_layout()
    irr_path = output_path / f"irr_distribution_{effective_timestamp}.png"
    fig2.savefig(irr_path)
    plt.close(fig2)
    print(f"✅ IRR distribution plot saved to '{irr_path}'")


