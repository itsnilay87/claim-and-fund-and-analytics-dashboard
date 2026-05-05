"""
TATA_code_v2/v2_report_charts.py — Professional chart generation (11 charts).
===============================================================================

Dark-theme matplotlib charts for embedding in Excel/PDF reports.

Theme:
  Background:  #0B0E17 (deep navy)
  Text:        #E5E7EB (light grey)
  Accent colours:
    Cyan   #06B6D4   Purple #8B5CF6   Amber  #F59E0B
    Green  #10B981   Red    #EF4444   Slate  #64748B
  Font:  Segoe UI (fallback: DejaVu Sans)

All charts saved as 300 DPI PNGs to TATA_code_v2/outputs/charts/.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Optional

import numpy as np
import matplotlib
matplotlib.use("Agg")  # non-interactive backend

import matplotlib.pyplot as plt
import matplotlib.ticker as mticker
from matplotlib.colors import LinearSegmentedColormap

from . import v2_master_inputs as MI
from .v2_config import ClaimConfig, SimulationResults
from .v2_investment_analysis import InvestmentGridResults


# ===================================================================
# Theme Constants
# ===================================================================

BG_DARK   = "#0B0E17"
BG_PANEL  = "#111827"
TXT_LIGHT = "#E5E7EB"
TXT_DIM   = "#9CA3AF"
GRID_CLR  = "#1F2937"

CYAN   = "#06B6D4"
PURPLE = "#8B5CF6"
AMBER  = "#F59E0B"
GREEN  = "#10B981"
RED    = "#EF4444"
SLATE  = "#64748B"

ACCENT_CYCLE = [CYAN, PURPLE, AMBER, GREEN, RED, SLATE]
CLAIM_COLORS = {
    "TP-301-6":   CYAN,
    "TP-302-3":   PURPLE,
    "TP-302-5":   AMBER,
    "TP-CTP11-2": GREEN,
    "TP-CTP11-4": RED,
    "TP-CTP13-2": SLATE,
}

FONT_FAMILY = "Segoe UI"

# Diverging colormap: red → amber → green
_MOIC_CMAP = LinearSegmentedColormap.from_list(
    "moic_rg", [RED, AMBER, GREEN], N=256
)


# ===================================================================
# Theme Applicator
# ===================================================================

def _apply_dark_theme() -> None:
    """Apply consistent dark theme to matplotlib rcParams."""
    plt.rcParams.update({
        "figure.facecolor": BG_DARK,
        "axes.facecolor": BG_PANEL,
        "axes.edgecolor": GRID_CLR,
        "axes.labelcolor": TXT_LIGHT,
        "axes.grid": True,
        "grid.color": GRID_CLR,
        "grid.alpha": 0.5,
        "text.color": TXT_LIGHT,
        "xtick.color": TXT_DIM,
        "ytick.color": TXT_DIM,
        "font.family": FONT_FAMILY,
        "font.size": 10,
        "legend.facecolor": BG_PANEL,
        "legend.edgecolor": GRID_CLR,
        "legend.fontsize": 8,
        "savefig.facecolor": BG_DARK,
        "savefig.edgecolor": BG_DARK,
    })


def _ensure_output_dir() -> Path:
    """Create and return the charts directory."""
    out = Path(MI.REPORT_OUTPUT_DIR) / "charts"
    out.mkdir(parents=True, exist_ok=True)
    return out


def _save(fig: plt.Figure, name: str, out_dir: Path) -> str:
    """Save figure and close. Returns the file path."""
    path = out_dir / f"{name}.png"
    fig.savefig(str(path), dpi=300, bbox_inches="tight", pad_inches=0.3)
    plt.close(fig)
    return str(path)


# ===================================================================
# Chart 1: Win Probability Waterfall
# ===================================================================

def chart_win_probability_waterfall(
    sim: SimulationResults,
    claims: list[ClaimConfig],
    out_dir: Optional[Path] = None,
) -> str:
    """Horizontal waterfall: Arb Win → Final Win (after court challenge + re-arb)."""
    _apply_dark_theme()
    out_dir = out_dir or _ensure_output_dir()

    fig, ax = plt.subplots(figsize=(10, 6))

    claim_ids = sim.claim_ids
    n = len(claim_ids)
    y_pos = np.arange(n)

    # Build a {claim_id: display_name} map so y-axis ticks show the claim name,
    # not its UUID.
    name_lookup = {
        c.claim_id: (getattr(c, "name", None) or c.claim_id)
        for c in claims
    }

    arb_win_rates = []
    final_win_rates = []

    for cid in claim_ids:
        paths = sim.results[cid]
        arb_wins = sum(1 for p in paths if p.arb_won) / len(paths)
        final_wins = sim.win_rate_map.get(cid, 0.0)
        arb_win_rates.append(arb_wins)
        final_win_rates.append(final_wins)

    # Draw bars
    bar_height = 0.35
    bars1 = ax.barh(y_pos + bar_height / 2, arb_win_rates, bar_height,
                     color=CYAN, alpha=0.85, label="Arb Win Rate")
    bars2 = ax.barh(y_pos - bar_height / 2, final_win_rates, bar_height,
                     color=GREEN, alpha=0.85, label="Final Win Rate (post-challenge)")

    # Labels
    for i, (aw, fw) in enumerate(zip(arb_win_rates, final_win_rates)):
        ax.text(aw + 0.01, i + bar_height / 2, f"{aw:.0%}",
                va="center", fontsize=8, color=TXT_LIGHT)
        ax.text(fw + 0.01, i - bar_height / 2, f"{fw:.0%}",
                va="center", fontsize=8, color=TXT_LIGHT)

    ax.set_yticks(y_pos)
    ax.set_yticklabels([name_lookup.get(cid, cid) for cid in claim_ids], fontsize=9)
    ax.set_xlabel("Probability", fontsize=10)
    ax.set_title("Win Probability: Arbitration vs Final Outcome",
                 fontsize=13, fontweight="bold", color=TXT_LIGHT, pad=12)
    ax.set_xlim(0, 1.05)
    ax.legend(loc="lower right", fontsize=8)
    ax.xaxis.set_major_formatter(mticker.PercentFormatter(1.0))
    ax.invert_yaxis()

    return _save(fig, "01_win_probability_waterfall", out_dir)


# ===================================================================
# Chart 2: Quantum Distribution (histogram)
# ===================================================================

def chart_quantum_distribution(
    sim: SimulationResults,
    claims: list[ClaimConfig],
    out_dir: Optional[Path] = None,
) -> str:
    """Histogram of quantum draws (as % of SOC) conditional on arb win."""
    _apply_dark_theme()
    out_dir = out_dir or _ensure_output_dir()

    fig, ax = plt.subplots(figsize=(10, 6))

    claim_map = {c.claim_id: c for c in claims}

    for cid in sim.claim_ids:
        paths = sim.results[cid]
        claim = claim_map[cid]
        q_pcts = []
        for p in paths:
            if p.arb_won and p.quantum is not None:
                q_pcts.append(p.quantum.quantum_pct)
        if q_pcts:
            ax.hist(q_pcts, bins=40, alpha=0.55, density=True,
                    color=CLAIM_COLORS.get(cid, CYAN), label=cid)

    # E[Q|WIN] reference line
    eq_pct = 0.720  # from quantum bands
    ax.axvline(eq_pct, color=AMBER, linestyle="--", linewidth=2,
               label=f"E[Q|WIN] = {eq_pct:.1%}")

    ax.set_xlabel("Quantum (% of SOC)", fontsize=10)
    ax.set_ylabel("Density", fontsize=10)
    ax.set_title("Quantum Distribution (conditional on Arb Win)",
                 fontsize=13, fontweight="bold", color=TXT_LIGHT, pad=12)
    ax.xaxis.set_major_formatter(mticker.PercentFormatter(1.0))
    ax.legend(fontsize=7, ncol=2)

    return _save(fig, "02_quantum_distribution", out_dir)


# ===================================================================
# Chart 3: Timeline Box Plots
# ===================================================================

def chart_timeline_boxplots(
    sim: SimulationResults,
    out_dir: Optional[Path] = None,
) -> str:
    """Box plots of total duration (months) per claim."""
    _apply_dark_theme()
    out_dir = out_dir or _ensure_output_dir()

    fig, ax = plt.subplots(figsize=(10, 6))

    data = []
    labels = []
    for cid in sim.claim_ids:
        paths = sim.results[cid]
        durations = [p.total_duration_months for p in paths]
        data.append(durations)
        labels.append(cid)

    bp = ax.boxplot(data, labels=labels, patch_artist=True, vert=True,
                    showfliers=False, widths=0.5,
                    medianprops=dict(color=AMBER, linewidth=2))

    for i, box in enumerate(bp["boxes"]):
        color = ACCENT_CYCLE[i % len(ACCENT_CYCLE)]
        box.set(facecolor=color, alpha=0.4, edgecolor=color, linewidth=1.5)
    for whisker in bp["whiskers"]:
        whisker.set(color=TXT_DIM, linewidth=1)
    for cap in bp["caps"]:
        cap.set(color=TXT_DIM, linewidth=1)

    # Add mean markers
    means = [np.mean(d) for d in data]
    ax.scatter(range(1, len(means) + 1), means, color=CYAN, zorder=5,
               s=60, marker="D", label="Mean")

    ax.set_ylabel("Total Duration (months)", fontsize=10)
    ax.set_title("Timeline Distribution per Claim",
                 fontsize=13, fontweight="bold", color=TXT_LIGHT, pad=12)
    ax.legend(fontsize=8)
    plt.xticks(rotation=15, fontsize=8)

    return _save(fig, "03_timeline_boxplots", out_dir)


# ===================================================================
# Chart 4 & 5: MOIC Heatmaps (SOC and EQ pricing)
# ===================================================================

def _chart_moic_heatmap(
    grid: InvestmentGridResults,
    basis: str,
    out_dir: Path,
) -> str:
    """MOIC heatmap for given pricing basis. Rows=upfront, Cols=tata_tail."""
    _apply_dark_theme()

    up_pcts = sorted(grid.upfront_pcts)
    aw_pcts = sorted(grid.award_share_pcts, reverse=True)  # so Tata-Tail ascending L→R
    n_rows = len(up_pcts)
    n_cols = len(aw_pcts)

    matrix = np.full((n_rows, n_cols), np.nan)
    for i, up in enumerate(up_pcts):
        for j, aw in enumerate(aw_pcts):
            key = (up, aw, basis)
            if key in grid.cells:
                matrix[i, j] = grid.cells[key].mean_moic

    fig, ax = plt.subplots(figsize=(10, 7))

    vmin = max(0, np.nanmin(matrix) - 0.2)
    vmax = np.nanmax(matrix) + 0.2
    im = ax.imshow(matrix, cmap=_MOIC_CMAP, aspect="auto",
                   vmin=vmin, vmax=vmax, origin="upper")

    # Annotate cells
    for i in range(n_rows):
        for j in range(n_cols):
            val = matrix[i, j]
            if not np.isnan(val):
                txt_c = "#000000" if val > 1.5 else TXT_LIGHT
                ax.text(j, i, f"{val:.2f}x", ha="center", va="center",
                        fontsize=8, fontweight="bold", color=txt_c)

    ax.set_xticks(range(n_cols))
    ax.set_xticklabels([f"{1-p:.0%}" for p in aw_pcts], fontsize=8)
    ax.set_yticks(range(n_rows))
    ax.set_yticklabels([f"{p:.0%}" for p in up_pcts], fontsize=8)
    ax.set_xlabel("Tata Tail %", fontsize=10)
    ax.set_ylabel("Upfront Investment %", fontsize=10)

    label = "SOC-Based" if basis == "soc" else "E[Q]-Based"
    ax.set_title(f"E[MOIC] Heatmap — {label} Pricing",
                 fontsize=13, fontweight="bold", color=TXT_LIGHT, pad=12)

    cbar = fig.colorbar(im, ax=ax, shrink=0.8, pad=0.02)
    cbar.set_label("E[MOIC]", color=TXT_LIGHT, fontsize=9)
    cbar.ax.yaxis.set_tick_params(color=TXT_DIM)
    plt.setp(cbar.ax.yaxis.get_ticklabels(), color=TXT_DIM)

    # Breakeven contour at MOIC = 1.0
    if not np.all(np.isnan(matrix)):
        try:
            ax.contour(matrix, levels=[1.0], colors=[AMBER],
                       linewidths=2, linestyles="--")
        except Exception:
            pass

    idx = "04" if basis == "soc" else "05"
    return _save(fig, f"{idx}_moic_heatmap_{basis}", out_dir)


def chart_moic_heatmap_soc(
    grid: InvestmentGridResults,
    out_dir: Optional[Path] = None,
) -> str:
    out_dir = out_dir or _ensure_output_dir()
    return _chart_moic_heatmap(grid, "soc", out_dir)


def chart_moic_heatmap_eq(
    grid: InvestmentGridResults,
    out_dir: Optional[Path] = None,
) -> str:
    out_dir = out_dir or _ensure_output_dir()
    return _chart_moic_heatmap(grid, "eq", out_dir)


# ===================================================================
# Chart 6: IRR Distribution Curves (KDE per claim)
# ===================================================================

def chart_irr_distribution(
    grid: InvestmentGridResults,
    upfront_pct: float = 0.10,
    award_share_pct: float = 0.80,
    basis: str = "soc",
    out_dir: Optional[Path] = None,
) -> str:
    """KDE-style histogram of per-claim XIRR at a reference scenario."""
    _apply_dark_theme()
    out_dir = out_dir or _ensure_output_dir()

    fig, ax = plt.subplots(figsize=(10, 6))

    key = (upfront_pct, award_share_pct, basis)
    cell = grid.cells.get(key)

    if cell and cell.per_claim:
        # We don't have raw per-path XIRR stored in the cell, so use per_claim means
        # as markers and construct a synthetic visualization
        cids = list(cell.per_claim.keys())
        means = [cell.per_claim[cid]["E[XIRR]"] for cid in cids]
        p_gt_30 = [cell.per_claim[cid]["P(IRR>30%)"] for cid in cids]

        x = np.arange(len(cids))
        bar_width = 0.4

        bars1 = ax.bar(x - bar_width / 2, [m * 100 for m in means], bar_width,
                        color=CYAN, alpha=0.85, label="E[XIRR] %")
        bars2 = ax.bar(x + bar_width / 2, [p * 100 for p in p_gt_30], bar_width,
                        color=GREEN, alpha=0.85, label="P(XIRR > 30%) %")

        for bar, val in zip(bars1, means):
            ax.text(bar.get_x() + bar.get_width() / 2, bar.get_height() + 0.5,
                    f"{val:.1%}", ha="center", va="bottom", fontsize=7, color=TXT_LIGHT)

        ax.set_xticks(x)
        ax.set_xticklabels(cids, fontsize=8, rotation=15)
        ax.set_ylabel("Percentage (%)", fontsize=10)
    else:
        ax.text(0.5, 0.5, "No data available", transform=ax.transAxes,
                ha="center", va="center", color=TXT_DIM, fontsize=14)

    tata_tail = 1.0 - award_share_pct
    label = f"{upfront_pct:.0%} Upfront / {tata_tail:.0%} Tata Tail ({basis.upper()})"
    ax.set_title(f"IRR Analysis per Claim — {label}",
                 fontsize=12, fontweight="bold", color=TXT_LIGHT, pad=12)
    ax.legend(fontsize=8)

    return _save(fig, "06_irr_distribution", out_dir)


# ===================================================================
# Chart 7: P(Loss) Heatmap
# ===================================================================

def chart_ploss_heatmap(
    grid: InvestmentGridResults,
    basis: str = "soc",
    out_dir: Optional[Path] = None,
) -> str:
    """Heatmap of P(loss) across the investment grid."""
    _apply_dark_theme()
    out_dir = out_dir or _ensure_output_dir()

    up_pcts = sorted(grid.upfront_pcts)
    aw_pcts = sorted(grid.award_share_pcts, reverse=True)  # Tata-Tail ascending L→R

    matrix = np.full((len(up_pcts), len(aw_pcts)), np.nan)
    for i, up in enumerate(up_pcts):
        for j, aw in enumerate(aw_pcts):
            key = (up, aw, basis)
            if key in grid.cells:
                matrix[i, j] = grid.cells[key].p_loss * 100

    fig, ax = plt.subplots(figsize=(10, 7))

    # Reversed colors: low P(loss) = green, high = red
    cmap_loss = LinearSegmentedColormap.from_list("loss_gr", [GREEN, AMBER, RED], N=256)
    im = ax.imshow(matrix, cmap=cmap_loss, aspect="auto", origin="upper",
                   vmin=0, vmax=min(100, np.nanmax(matrix) + 10))

    for i in range(len(up_pcts)):
        for j in range(len(aw_pcts)):
            val = matrix[i, j]
            if not np.isnan(val):
                txt_c = "#000000" if val < 30 else TXT_LIGHT
                ax.text(j, i, f"{val:.0f}%", ha="center", va="center",
                        fontsize=8, fontweight="bold", color=txt_c)

    ax.set_xticks(range(len(aw_pcts)))
    ax.set_xticklabels([f"{1-p:.0%}" for p in aw_pcts], fontsize=8)
    ax.set_yticks(range(len(up_pcts)))
    ax.set_yticklabels([f"{p:.0%}" for p in up_pcts], fontsize=8)
    ax.set_xlabel("Tata Tail %", fontsize=10)
    ax.set_ylabel("Upfront Investment %", fontsize=10)

    label = "SOC-Based" if basis == "soc" else "E[Q]-Based"
    ax.set_title(f"P(Capital Loss) Heatmap — {label} Pricing",
                 fontsize=13, fontweight="bold", color=TXT_LIGHT, pad=12)

    cbar = fig.colorbar(im, ax=ax, shrink=0.8, pad=0.02)
    cbar.set_label("P(Loss) %", color=TXT_LIGHT, fontsize=9)
    cbar.ax.yaxis.set_tick_params(color=TXT_DIM)
    plt.setp(cbar.ax.yaxis.get_ticklabels(), color=TXT_DIM)

    return _save(fig, "07_ploss_heatmap", out_dir)


# ===================================================================
# Chart 8: Per-Claim MOIC Bars
# ===================================================================

def chart_per_claim_moic_bars(
    grid: InvestmentGridResults,
    upfront_pct: float = 0.10,
    award_share_pct: float = 0.80,
    basis: str = "soc",
    out_dir: Optional[Path] = None,
) -> str:
    """Grouped bars: E[MOIC] per claim with breakeven line."""
    _apply_dark_theme()
    out_dir = out_dir or _ensure_output_dir()

    fig, ax = plt.subplots(figsize=(10, 6))

    key = (upfront_pct, award_share_pct, basis)
    cell = grid.cells.get(key)

    if cell and cell.per_claim:
        cids = list(cell.per_claim.keys())
        moics = [cell.per_claim[cid]["E[MOIC]"] for cid in cids]
        xirrs = [cell.per_claim[cid].get("E[XIRR]", 0) for cid in cids]
        colors = [CLAIM_COLORS.get(cid, CYAN) for cid in cids]

        x = np.arange(len(cids))
        bars = ax.bar(x, moics, color=colors, alpha=0.85, width=0.6,
                      edgecolor=[c + "88" for c in colors], linewidth=1.5)

        # Labels on bars (MOIC + XIRR)
        for bar, val, xirr_val in zip(bars, moics, xirrs):
            y_pos = bar.get_height() + 0.02
            ax.text(bar.get_x() + bar.get_width() / 2, y_pos,
                    f"{val:.2f}x", ha="center", va="bottom",
                    fontsize=9, fontweight="bold", color=TXT_LIGHT)
            ax.text(bar.get_x() + bar.get_width() / 2, y_pos + 0.12,
                    f"IRR {xirr_val:.0%}", ha="center", va="bottom",
                    fontsize=7, color=TXT_DIM)

        # Breakeven line
        ax.axhline(1.0, color=AMBER, linestyle="--", linewidth=1.5,
                    alpha=0.8, label="Breakeven (1.0x)")

        # Portfolio average
        portfolio_moic = cell.mean_moic
        ax.axhline(portfolio_moic, color=CYAN, linestyle=":",
                    linewidth=1.5, alpha=0.7,
                    label=f"Portfolio E[MOIC] = {portfolio_moic:.2f}x")

        ax.set_xticks(x)
        ax.set_xticklabels(cids, fontsize=8, rotation=15)
        ax.set_ylabel("E[MOIC]", fontsize=10)
        ax.legend(fontsize=8, loc="upper right")
    else:
        ax.text(0.5, 0.5, "No data available", transform=ax.transAxes,
                ha="center", va="center", color=TXT_DIM, fontsize=14)

    tata_tail = 1.0 - award_share_pct
    label = f"{upfront_pct:.0%} Upfront / {tata_tail:.0%} Tata Tail ({basis.upper()})"
    ax.set_title(f"Per-Claim E[MOIC] — {label}",
                 fontsize=13, fontweight="bold", color=TXT_LIGHT, pad=12)

    return _save(fig, "08_per_claim_moic_bars", out_dir)


# ===================================================================
# Chart 9: Investment vs Return Scatter
# ===================================================================

def chart_investment_vs_return(
    grid: InvestmentGridResults,
    basis: str = "soc",
    out_dir: Optional[Path] = None,
) -> str:
    """Scatter: E[Net Return ₹ Cr] vs Upfront % for each Tata Tail %."""
    _apply_dark_theme()
    out_dir = out_dir or _ensure_output_dir()

    fig, ax = plt.subplots(figsize=(10, 6))

    aw_pcts = sorted(grid.award_share_pcts, reverse=True)  # Tata-Tail ascending
    up_pcts = sorted(grid.upfront_pcts)

    for idx, aw in enumerate(aw_pcts):
        net_returns = []
        for up in up_pcts:
            key = (up, aw, basis)
            if key in grid.cells:
                net_returns.append(grid.cells[key].mean_net_return_cr)
            else:
                net_returns.append(np.nan)

        color = ACCENT_CYCLE[idx % len(ACCENT_CYCLE)]
        ax.plot([p * 100 for p in up_pcts], net_returns,
                marker="o", color=color, linewidth=2, markersize=6,
                alpha=0.85, label=f"Tail={1-aw:.0%}")

    # Zero line
    ax.axhline(0, color=AMBER, linestyle="--", linewidth=1, alpha=0.6)

    ax.set_xlabel("Upfront Investment (% of SOC)", fontsize=10)
    ax.set_ylabel("E[Net Return] (₹ Crore)", fontsize=10)
    label = "SOC-Based" if basis == "soc" else "E[Q]-Based"
    ax.set_title(f"Investment vs Expected Return — {label} Pricing",
                 fontsize=13, fontweight="bold", color=TXT_LIGHT, pad=12)
    ax.legend(fontsize=7, ncol=2, loc="best")

    return _save(fig, "09_investment_vs_return", out_dir)


# ===================================================================
# Chart 10: Scenario Decision Matrix
# ===================================================================

def _verdict(moic: float, p_loss: float) -> tuple[str, str]:
    """Classify scenario into verdict + colour."""
    if moic > 2.5 and p_loss < 0.10:
        return "Strong Buy", GREEN
    elif moic > 1.5 and p_loss < 0.25:
        return "Attractive", CYAN
    elif moic > 1.0 and p_loss < 0.40:
        return "Marginal", AMBER
    else:
        return "Avoid", RED


def chart_scenario_decision_matrix(
    grid: InvestmentGridResults,
    basis: str = "soc",
    out_dir: Optional[Path] = None,
) -> str:
    """Grid of verdicts (Strong Buy / Attractive / Marginal / Avoid)."""
    _apply_dark_theme()
    out_dir = out_dir or _ensure_output_dir()

    up_pcts = sorted(grid.upfront_pcts)
    aw_pcts = sorted(grid.award_share_pcts, reverse=True)  # Tata-Tail ascending L→R

    fig, ax = plt.subplots(figsize=(12, 7))
    ax.set_xlim(-0.5, len(aw_pcts) - 0.5)
    ax.set_ylim(-0.5, len(up_pcts) - 0.5)

    for i, up in enumerate(up_pcts):
        for j, aw in enumerate(aw_pcts):
            key = (up, aw, basis)
            cell = grid.cells.get(key)
            if cell:
                verdict, color = _verdict(cell.mean_moic, cell.p_loss)
                rect = plt.Rectangle((j - 0.45, i - 0.45), 0.9, 0.9,
                                      facecolor=color, alpha=0.25,
                                      edgecolor=color, linewidth=1.5)
                ax.add_patch(rect)
                ax.text(j, i + 0.18, verdict, ha="center", va="center",
                        fontsize=7, fontweight="bold", color=color)
                ax.text(j, i - 0.08, f"{cell.mean_moic:.2f}x",
                        ha="center", va="center", fontsize=7, color=TXT_DIM)
                ax.text(j, i - 0.28, f"IRR {cell.mean_xirr:.0%}",
                        ha="center", va="center", fontsize=6, color=TXT_DIM)

    ax.set_xticks(range(len(aw_pcts)))
    ax.set_xticklabels([f"{1-p:.0%}" for p in aw_pcts], fontsize=8)
    ax.set_yticks(range(len(up_pcts)))
    ax.set_yticklabels([f"{p:.0%}" for p in up_pcts], fontsize=8)
    ax.set_xlabel("Tata Tail %", fontsize=10)
    ax.set_ylabel("Upfront Investment %", fontsize=10)
    ax.invert_yaxis()

    label = "SOC-Based" if basis == "soc" else "E[Q]-Based"
    ax.set_title(f"Investment Decision Matrix — {label} Pricing",
                 fontsize=13, fontweight="bold", color=TXT_LIGHT, pad=12)

    # Legend
    from matplotlib.patches import Patch
    legend_elements = [
        Patch(facecolor=GREEN, alpha=0.4, label="Strong Buy (MOIC>2.5, P(L)<10%)"),
        Patch(facecolor=CYAN, alpha=0.4, label="Attractive (MOIC>1.5, P(L)<25%)"),
        Patch(facecolor=AMBER, alpha=0.4, label="Marginal (MOIC>1.0, P(L)<40%)"),
        Patch(facecolor=RED, alpha=0.4, label="Avoid"),
    ]
    ax.legend(handles=legend_elements, loc="upper right", fontsize=7)

    return _save(fig, "10_scenario_decision_matrix", out_dir)


# ===================================================================
# Chart 11: Monthly Cashflow Profile
# ===================================================================

def chart_monthly_cashflow_profile(
    sim: SimulationResults,
    claims: list[ClaimConfig],
    out_dir: Optional[Path] = None,
) -> str:
    """Mean monthly legal cost burn per claim (stacked area)."""
    _apply_dark_theme()
    out_dir = out_dir or _ensure_output_dir()

    fig, ax = plt.subplots(figsize=(12, 6))

    # Find max timeline length across all paths
    max_months = 0
    for cid in sim.claim_ids:
        for p in sim.results[cid]:
            dur = int(np.ceil(p.total_duration_months))
            if dur > max_months:
                max_months = dur

    max_months = min(max_months, MI.MAX_TIMELINE_MONTHS)
    months_x = np.arange(max_months + 1)

    # Compute mean monthly legal burn per claim
    claim_burns = {}
    for cid in sim.claim_ids:
        all_burns = np.zeros(max_months + 1)
        count = 0
        for p in sim.results[cid]:
            if p.monthly_legal_burn is not None:
                burn = p.monthly_legal_burn
                length = min(len(burn), max_months + 1)
                all_burns[:length] += burn[:length]
                count += 1
        if count > 0:
            all_burns /= count
        claim_burns[cid] = all_burns

    # Stacked area plot
    prev = np.zeros(max_months + 1)
    for idx, cid in enumerate(sim.claim_ids):
        color = ACCENT_CYCLE[idx % len(ACCENT_CYCLE)]
        current = prev + claim_burns[cid]
        ax.fill_between(months_x, prev, current, alpha=0.5, color=color, label=cid)
        prev = current

    ax.set_xlabel("Month", fontsize=10)
    ax.set_ylabel("Mean Legal Cost Burn (₹ Cr/month)", fontsize=10)
    ax.set_title("Portfolio Monthly Legal Cost Profile",
                 fontsize=13, fontweight="bold", color=TXT_LIGHT, pad=12)
    ax.legend(fontsize=7, ncol=2, loc="upper right")

    return _save(fig, "11_monthly_cashflow_profile", out_dir)


# ===================================================================
# Master: Generate All Charts
# ===================================================================

def generate_all_charts(
    sim: SimulationResults,
    claims: list[ClaimConfig],
    grid: InvestmentGridResults,
    basis: str = "soc",
    output_dir: str | None = None,
) -> dict[str, str]:
    """Generate all 11 charts. Returns dict of chart_name → file_path.

    Parameters
    ----------
    sim : SimulationResults — completed MC simulation.
    claims : list[ClaimConfig] — claim configs.
    grid : InvestmentGridResults — investment grid analysis.
    basis : str — primary pricing basis ("soc" or "eq").
    output_dir : str, optional — override charts output directory.

    Returns
    -------
    dict[str, str] mapping chart identifiers to saved PNG paths.
    """
    if output_dir:
        out_dir = Path(output_dir) / "charts"
        out_dir.mkdir(parents=True, exist_ok=True)
    else:
        out_dir = _ensure_output_dir()
    print(f"  Generating charts in {out_dir}/...")

    charts: dict[str, str] = {}

    charts["win_waterfall"] = chart_win_probability_waterfall(sim, claims, out_dir)
    print("    [1/11] Win Probability Waterfall")

    charts["quantum_dist"] = chart_quantum_distribution(sim, claims, out_dir)
    print("    [2/11] Quantum Distribution")

    charts["timeline_box"] = chart_timeline_boxplots(sim, out_dir)
    print("    [3/11] Timeline Box Plots")

    charts["moic_heatmap_soc"] = chart_moic_heatmap_soc(grid, out_dir)
    print("    [4/11] MOIC Heatmap (SOC)")

    # EQ heatmap: only if 'eq' data exists
    if "eq" in grid.pricing_bases:
        charts["moic_heatmap_eq"] = chart_moic_heatmap_eq(grid, out_dir)
        print("    [5/11] MOIC Heatmap (EQ)")
    else:
        print("    [5/11] MOIC Heatmap (EQ) — skipped (no EQ data)")

    charts["irr_dist"] = chart_irr_distribution(grid, basis=basis, out_dir=out_dir)
    print("    [6/11] IRR Distribution")

    charts["ploss_heatmap"] = chart_ploss_heatmap(grid, basis=basis, out_dir=out_dir)
    print("    [7/11] P(Loss) Heatmap")

    charts["claim_moic_bars"] = chart_per_claim_moic_bars(
        grid, basis=basis, out_dir=out_dir
    )
    print("    [8/11] Per-Claim MOIC Bars")

    charts["inv_vs_return"] = chart_investment_vs_return(
        grid, basis=basis, out_dir=out_dir
    )
    print("    [9/11] Investment vs Return")

    charts["decision_matrix"] = chart_scenario_decision_matrix(
        grid, basis=basis, out_dir=out_dir
    )
    print("    [10/11] Scenario Decision Matrix")

    charts["cashflow_profile"] = chart_monthly_cashflow_profile(
        sim, claims, out_dir
    )
    print("    [11/11] Monthly Cashflow Profile")

    print(f"  All charts saved ({len(charts)} files).")
    return charts
