"""
TATA_code_v2/v2_pdf_report.py — 15-page PDF investment analysis report.
========================================================================

Uses matplotlib PdfPages to produce a multi-page PDF embedding charts
and formatted data tables.

Pages:
  1.  Title Page
  2.  Portfolio Executive Summary
  3.  Claim Overview Table
  4.  Probability Tree Summary
  5.  Quantum Model
  6.  Timeline Analysis
  7.  Legal Cost Summary
  8.  Investment Grid (MOIC heatmap)
  9.  Investment Grid (P(Loss) heatmap)
  10. Per-Claim MOIC & IRR
  11. Investment vs Return
  12. Decision Matrix
  13. Breakeven Analysis
  14. Cashflow Profile
  15. Appendix — Methodology & Caveats

Theme matches v2_report_charts.py (dark background).
"""

from __future__ import annotations

import os
from datetime import datetime
from pathlib import Path
from typing import Optional

import numpy as np
import matplotlib
matplotlib.use("Agg")

import matplotlib.pyplot as plt
from matplotlib.backends.backend_pdf import PdfPages

from . import v2_master_inputs as MI
from .v2_config import ClaimConfig, SimulationResults
from .v2_investment_analysis import InvestmentGridResults


# ===================================================================
# Theme Constants (shared with v2_report_charts.py)
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
FONT_FAMILY = "Segoe UI"


def _apply_theme():
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
        "savefig.facecolor": BG_DARK,
    })


def _text_page(pdf: PdfPages, lines: list[tuple[float, str, dict]],
               title: Optional[str] = None) -> None:
    """Create a text-only page. lines = [(y_pos, text, kwargs)]."""
    fig = plt.figure(figsize=(11.69, 8.27))  # A4 landscape
    fig.patch.set_facecolor(BG_DARK)

    if title:
        fig.text(0.5, 0.92, title, ha="center", va="top",
                 fontsize=18, fontweight="bold", color=TXT_LIGHT,
                 fontfamily=FONT_FAMILY)

    for y, txt, kw in lines:
        defaults = dict(ha="left", va="top", fontsize=10,
                        color=TXT_LIGHT, fontfamily=FONT_FAMILY,
                        transform=fig.transFigure)
        defaults.update(kw)
        fig.text(0.08, y, txt, **defaults)

    pdf.savefig(fig)
    plt.close(fig)


def _table_page(pdf: PdfPages, title: str, headers: list[str],
                rows: list[list], col_widths: Optional[list] = None) -> None:
    """Create a page with a formatted table."""
    fig, ax = plt.subplots(figsize=(11.69, 8.27))
    fig.patch.set_facecolor(BG_DARK)
    ax.axis("off")

    n_cols = len(headers)
    n_rows = len(rows)

    if col_widths is None:
        col_widths = [1.0 / n_cols] * n_cols

    # Title
    fig.text(0.5, 0.95, title, ha="center", va="top",
             fontsize=16, fontweight="bold", color=TXT_LIGHT,
             fontfamily=FONT_FAMILY)

    # Table setup
    table_data = [headers] + rows
    table = ax.table(
        cellText=table_data,
        colWidths=col_widths,
        loc="center",
        cellLoc="center",
    )
    table.auto_set_font_size(False)
    table.set_fontsize(8)
    table.scale(1, 1.5)

    # Style cells
    for (i, j), cell in table.get_celld().items():
        cell.set_edgecolor(GRID_CLR)
        cell.set_text_props(color=TXT_LIGHT, fontfamily=FONT_FAMILY)
        if i == 0:
            cell.set_facecolor("#2E75B6")
            cell.set_text_props(fontweight="bold", color="white")
        else:
            cell.set_facecolor(BG_PANEL)

    pdf.savefig(fig)
    plt.close(fig)


def _chart_page(pdf: PdfPages, chart_path: str, title: str = "") -> None:
    """Embed a pre-generated chart PNG as a full page."""
    fig = plt.figure(figsize=(11.69, 8.27))
    fig.patch.set_facecolor(BG_DARK)

    if title:
        fig.text(0.5, 0.97, title, ha="center", va="top",
                 fontsize=14, fontweight="bold", color=TXT_LIGHT,
                 fontfamily=FONT_FAMILY)

    if os.path.exists(chart_path):
        img = plt.imread(chart_path)
        ax = fig.add_axes([0.05, 0.02, 0.9, 0.9])
        ax.imshow(img)
        ax.axis("off")
    else:
        fig.text(0.5, 0.5, f"Chart not found: {chart_path}",
                 ha="center", va="center", color=RED, fontsize=12)

    pdf.savefig(fig)
    plt.close(fig)


def _verdict(moic: float, p_loss: float) -> str:
    if moic > 2.5 and p_loss < 0.10:
        return "Strong Buy"
    elif moic > 1.5 and p_loss < 0.25:
        return "Attractive"
    elif moic > 1.0 and p_loss < 0.40:
        return "Marginal"
    return "Avoid"


# ===================================================================
# Page Builders
# ===================================================================

def _page_title(pdf: PdfPages, sim: SimulationResults) -> None:
    """Page 1: Title page."""
    fig = plt.figure(figsize=(11.69, 8.27))
    fig.patch.set_facecolor(BG_DARK)

    fig.text(0.5, 0.65, "TATA v2", ha="center", va="center",
             fontsize=48, fontweight="bold", color=CYAN,
             fontfamily=FONT_FAMILY)
    fig.text(0.5, 0.55, "Monte Carlo Investment Valuation Model",
             ha="center", va="center", fontsize=22, color=TXT_LIGHT,
             fontfamily=FONT_FAMILY)
    fig.text(0.5, 0.42, "TATA Arbitration Claims Portfolio",
             ha="center", va="center", fontsize=16, color=TXT_DIM,
             fontfamily=FONT_FAMILY)

    fig.text(0.5, 0.30, f"N = {sim.n_paths:,} paths  |  Seed = {sim.seed}  |  "
             f"{len(sim.claim_ids)} claims",
             ha="center", va="center", fontsize=12, color=SLATE,
             fontfamily=FONT_FAMILY)

    fig.text(0.5, 0.15, f"Generated: {datetime.now().strftime('%Y-%m-%d %H:%M')}",
             ha="center", va="center", fontsize=10, color=SLATE,
             fontfamily=FONT_FAMILY)
    fig.text(0.5, 0.10, "CONFIDENTIAL — For Investment Committee Use Only",
             ha="center", va="center", fontsize=10, fontweight="bold",
             color=AMBER, fontfamily=FONT_FAMILY)

    pdf.savefig(fig)
    plt.close(fig)


def _page_portfolio_summary(
    pdf: PdfPages,
    sim: SimulationResults,
    claims: list[ClaimConfig],
    grid: InvestmentGridResults,
    basis: str,
) -> None:
    """Page 2: Portfolio Executive Summary."""
    total_soc = sum(c.soc_value_cr for c in claims)
    total_eq = sum(sim.expected_quantum_map.get(c.claim_id, 0) for c in claims)

    ref_key = (0.10, 0.80, basis)
    cell = grid.cells.get(ref_key)

    lines = [
        (0.82, f"Total SOC:  ₹{total_soc:,.2f} Crore", {"fontsize": 14, "color": CYAN}),
        (0.77, f"Total E[Q]:  ₹{total_eq:,.2f} Crore", {"fontsize": 14, "color": CYAN}),
        (0.72, f"Claims: {len(claims)}  |  MC Paths: {sim.n_paths:,}", {"fontsize": 12}),
        (0.67, f"Arb Win Probability: {MI.ARB_WIN_PROBABILITY:.0%}", {"fontsize": 12}),
        (0.62, f"Quantum E[Q|WIN]: 72.00% of SOC", {"fontsize": 12}),
    ]

    if cell:
        v = _verdict(cell.mean_moic, cell.p_loss)
        lines += [
            (0.54, f"Reference Scenario: 10% Upfront / 20% Tata Tail ({basis.upper()})",
             {"fontsize": 13, "fontweight": "bold", "color": AMBER}),
            (0.49, f"  E[MOIC]:       {cell.mean_moic:.2f}×", {"fontsize": 12}),
            (0.45, f"  E[XIRR]:       {cell.mean_xirr:.1%}", {"fontsize": 12}),
            (0.41, f"  P(Loss):       {cell.p_loss:.1%}", {"fontsize": 12}),
            (0.37, f"  E[Net Return]: ₹{cell.mean_net_return_cr:,.2f} Cr", {"fontsize": 12}),
            (0.33, f"  VaR 1%:        ₹{cell.var_1:,.2f} Cr", {"fontsize": 12}),
            (0.29, f"  P(IRR > 30%):  {cell.p_irr_gt_30:.1%}", {"fontsize": 12}),
            (0.24, f"  Verdict:       {v}", {"fontsize": 14, "fontweight": "bold",
                                              "color": GREEN if "Buy" in v else
                                              (CYAN if v == "Attractive" else
                                               (AMBER if v == "Marginal" else RED))}),
        ]

    _text_page(pdf, lines, title="Portfolio Executive Summary")


def _page_claim_overview(
    pdf: PdfPages,
    sim: SimulationResults,
    claims: list[ClaimConfig],
) -> None:
    """Page 3: Claim overview table."""
    headers = ["Claim", "Archetype", "SOC (₹ Cr)", "Jurisdiction",
               "Win Rate", "E[Dur] (mo)", "E[Q] (₹ Cr)"]
    rows = []
    claim_map = {c.claim_id: c for c in claims}
    for cid in sim.claim_ids:
        c = claim_map[cid]
        wr = sim.win_rate_map.get(cid, 0)
        dur = sim.mean_duration_map.get(cid, 0)
        eq = sim.expected_quantum_map.get(cid, 0)
        rows.append([
            cid, c.archetype.title(), f"₹{c.soc_value_cr:,.2f}",
            c.jurisdiction.upper(), f"{wr:.1%}", f"{dur:.1f}",
            f"₹{eq:,.2f}",
        ])

    _table_page(pdf, "Claim Portfolio Overview", headers, rows,
                col_widths=[0.12, 0.14, 0.12, 0.12, 0.10, 0.12, 0.12])


def _page_probability_trees(
    pdf: PdfPages,
    sim: SimulationResults,
) -> None:
    """Page 4: Probability tree combined outcomes."""
    headers = ["Claim", "P(TRUE_WIN)", "P(RESTART)", "P(LOSE)",
               "Final Win Rate"]
    rows = []
    for cid in sim.claim_ids:
        paths = sim.results[cid]
        n = len(paths)
        p_tw = sum(1 for p in paths if p.final_outcome == "TRUE_WIN") / n
        p_re = sum(1 for p in paths if p.final_outcome == "RESTART") / n
        p_lo = sum(1 for p in paths if p.final_outcome == "LOSE") / n
        wr = sim.win_rate_map.get(cid, 0)
        rows.append([cid, f"{p_tw:.1%}", f"{p_re:.1%}", f"{p_lo:.1%}", f"{wr:.1%}"])

    _table_page(pdf, "Probability Tree — Combined Outcomes", headers, rows)


def _page_quantum_model(
    pdf: PdfPages,
    sim: SimulationResults,
    claims: list[ClaimConfig],
) -> None:
    """Page 5: Quantum model summary."""
    headers = ["Band", "Range (% SOC)", "Probability", "E[Q] contribution"]
    rows = []
    for i, b in enumerate(MI.QUANTUM_BANDS):
        lo, hi, prob = b["low"], b["high"], b["probability"]
        contrib = prob * (lo + hi) / 2
        rows.append([f"Band {i+1}", f"{lo:.0%} – {hi:.0%}",
                      f"{prob:.0%}", f"{contrib:.4f}"])
    total = sum(b["probability"] * (b["low"] + b["high"]) / 2 for b in MI.QUANTUM_BANDS)
    rows.append(["TOTAL E[Q|WIN]", "", "", f"{total:.4f} ({total:.2%} of SOC)"])

    # Add per-claim E[Q]
    rows.append(["", "", "", ""])
    rows.append(["Claim", "SOC (₹ Cr)", "E[Q] (₹ Cr)", "E[Q]/SOC"])
    claim_map = {c.claim_id: c for c in claims}
    for cid in sim.claim_ids:
        c = claim_map[cid]
        eq = sim.expected_quantum_map.get(cid, 0)
        rows.append([cid, f"₹{c.soc_value_cr:,.2f}", f"₹{eq:,.2f}",
                      f"{eq / c.soc_value_cr:.2%}" if c.soc_value_cr > 0 else "N/A"])

    _table_page(pdf, "Quantum Model", headers, rows)


def _page_timeline_analysis(pdf: PdfPages, charts: dict[str, str]) -> None:
    """Page 6: Timeline box plots (embed chart)."""
    path = charts.get("timeline_box", "")
    _chart_page(pdf, path, "Timeline Analysis — Duration Distributions")


def _page_legal_costs(
    pdf: PdfPages,
    sim: SimulationResults,
    claims: list[ClaimConfig],
) -> None:
    """Page 7: Legal cost summary table."""
    headers = ["Claim", "E[Cost] (₹ Cr)", "Median", "P5", "P95"]
    rows = []
    total = 0
    for cid in sim.claim_ids:
        paths = sim.results.get(cid, [])
        costs = [p.legal_cost_total_cr for p in paths]
        if costs:
            e_c = float(np.mean(costs))
            total += e_c
            rows.append([
                cid, f"₹{e_c:,.2f}", f"₹{np.median(costs):,.2f}",
                f"₹{np.percentile(costs, 5):,.2f}",
                f"₹{np.percentile(costs, 95):,.2f}",
            ])
    rows.append(["PORTFOLIO TOTAL", f"₹{total:,.2f}", "", "", ""])

    _table_page(pdf, "Legal Cost Analysis", headers, rows)


def _page_moic_heatmap(pdf: PdfPages, charts: dict[str, str], basis: str) -> None:
    """Page 8: MOIC heatmap (embed chart)."""
    key = f"moic_heatmap_{basis}"
    path = charts.get(key, "")
    _chart_page(pdf, path, f"E[MOIC] Heatmap — {basis.upper()} Pricing")


def _page_ploss_heatmap(pdf: PdfPages, charts: dict[str, str]) -> None:
    """Page 9: P(Loss) heatmap (embed chart)."""
    path = charts.get("ploss_heatmap", "")
    _chart_page(pdf, path, "P(Capital Loss) Heatmap")


def _page_per_claim_moic(pdf: PdfPages, charts: dict[str, str]) -> None:
    """Page 10: Per-claim MOIC bars (embed chart)."""
    path = charts.get("claim_moic_bars", "")
    _chart_page(pdf, path, "Per-Claim E[MOIC] Analysis")


def _page_inv_vs_return(pdf: PdfPages, charts: dict[str, str]) -> None:
    """Page 11: Investment vs return (embed chart)."""
    path = charts.get("inv_vs_return", "")
    _chart_page(pdf, path, "Investment vs Expected Return")


def _page_decision_matrix(pdf: PdfPages, charts: dict[str, str]) -> None:
    """Page 12: Decision matrix (embed chart)."""
    path = charts.get("decision_matrix", "")
    _chart_page(pdf, path, "Investment Decision Matrix")


def _page_breakeven(
    pdf: PdfPages,
    grid: InvestmentGridResults,
    basis: str,
) -> None:
    """Page 13: Breakeven analysis table."""
    be = grid.breakeven.get(basis, {})
    aw_pcts = sorted(grid.award_share_pcts)

    headers = ["Tata Tail %", "Max Upfront %", "E[MOIC] at Breakeven",
               "E[XIRR] at Breakeven", "Verdict"]
    rows = []
    for aw in aw_pcts:
        max_up = be.get(aw, 0)
        key = (max_up, aw, basis)
        cell = grid.cells.get(key)
        moic = cell.mean_moic if cell else 0
        xirr = cell.mean_xirr if cell else 0
        ploss = cell.p_loss if cell else 1.0
        v = _verdict(moic, ploss)
        rows.append([f"{1-aw:.0%}", f"{max_up:.0%}" if max_up > 0 else "< 5%",
                      f"{moic:.2f}×", f"{xirr:.1%}", v])

    _table_page(pdf, f"Breakeven Analysis — {basis.upper()} Pricing", headers, rows)


def _page_cashflow_profile(pdf: PdfPages, charts: dict[str, str]) -> None:
    """Page 14: Monthly cashflow profile (embed chart)."""
    path = charts.get("cashflow_profile", "")
    _chart_page(pdf, path, "Portfolio Monthly Legal Cost Profile")


def _page_appendix(pdf: PdfPages) -> None:
    """Page 15: Methodology & caveats."""
    lines = [
        (0.82, "Monte Carlo Engine", {"fontsize": 14, "fontweight": "bold", "color": CYAN}),
        (0.78, "• N independent paths per claim, each traversing the full pipeline.", {}),
        (0.75, "• Pipeline: DAB → Arbitration → Court Challenge Tree → Re-Arbitration → Payment.", {}),
        (0.72, "• Quantum drawn from 5 discrete bands conditional on arbitration WIN.", {}),
        (0.69, "• Legal costs: per-stage annual burn × duration + stochastic overrun.", {}),
        (0.66, "• XIRR computed via scipy.optimize.brentq with monthly cashflows.", {}),
        (0.60, "Probability Trees", {"fontsize": 14, "fontweight": "bold", "color": CYAN}),
        (0.56, "• Domestic: 4-level tree (S.34 → S.37 → SLP gate → SLP merits) = 24 paths.", {}),
        (0.53, "• SIAC: 2-level tree (HC → COA) = 8 paths.", {}),
        (0.50, "• Sc.A (won arb): TRUE_WIN or LOSE. Sc.B (lost arb): RESTART or LOSE.", {}),
        (0.47, "• RESTART outcomes trigger independent re-arbitration (P(win)=70%).", {}),
        (0.44, "Investment Model", {"fontsize": 14, "fontweight": "bold", "color": CYAN}),
        (0.40, "• Upfront investment = upfront_pct × SOC (or E[Q] for EQ pricing).", {}),
        (0.37, "• Legal costs funded throughout case timeline.", {}),
        (0.34, "• Tata tail = TATA's retained % of received quantum.", {}),
        (0.31, "• MOIC = total_return / total_invested; P(loss) = P(MOIC < 1.0).", {}),
        (0.25, "Important Caveats", {"fontsize": 14, "fontweight": "bold", "color": AMBER}),
        (0.21, "[!] TPL shares set to 100% — actual JV shares are UNCONFIRMED.", {"color": AMBER}),
        (0.18, "[!] Quantum bands & arb win prob are expert-judgment calibrated.", {"color": AMBER}),
        (0.15, "[!] Collection efficiency = 100% (no sovereign default modelled).", {"color": AMBER}),
        (0.12, "[!] IRR undefined for zero-return paths (set to -100%).", {"color": AMBER}),
    ]
    _text_page(pdf, lines, title="Appendix — Methodology & Caveats")


# ===================================================================
# Main Entry Point
# ===================================================================

def generate_pdf_report(
    sim: SimulationResults,
    claims: list[ClaimConfig],
    grid: InvestmentGridResults,
    charts: dict[str, str],
    basis: str = "soc",
    output_dir: Optional[str] = None,
    filename: Optional[str] = None,
) -> str:
    """Generate the complete 15-page PDF report.

    Parameters
    ----------
    sim : SimulationResults
    claims : list[ClaimConfig]
    grid : InvestmentGridResults
    charts : dict[str, str] — chart name → PNG path (from generate_all_charts)
    basis : str — pricing basis for analysis
    output_dir : str — output directory
    filename : str — PDF filename

    Returns
    -------
    str — full path to generated PDF file.
    """
    _apply_theme()

    out_dir = output_dir or MI.REPORT_OUTPUT_DIR
    fname = filename or MI.PDF_REPORT_NAME
    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, fname)

    print("  Generating PDF report...")

    with PdfPages(out_path) as pdf:
        _page_title(pdf, sim)
        print("    [1/15] Title Page")

        _page_portfolio_summary(pdf, sim, claims, grid, basis)
        print("    [2/15] Portfolio Summary")

        _page_claim_overview(pdf, sim, claims)
        print("    [3/15] Claim Overview")

        _page_probability_trees(pdf, sim)
        print("    [4/15] Probability Trees")

        _page_quantum_model(pdf, sim, claims)
        print("    [5/15] Quantum Model")

        _page_timeline_analysis(pdf, charts)
        print("    [6/15] Timeline Analysis")

        _page_legal_costs(pdf, sim, claims)
        print("    [7/15] Legal Costs")

        _page_moic_heatmap(pdf, charts, basis)
        print("    [8/15] MOIC Heatmap")

        _page_ploss_heatmap(pdf, charts)
        print("    [9/15] P(Loss) Heatmap")

        _page_per_claim_moic(pdf, charts)
        print("    [10/15] Per-Claim MOIC")

        _page_inv_vs_return(pdf, charts)
        print("    [11/15] Investment vs Return")

        _page_decision_matrix(pdf, charts)
        print("    [12/15] Decision Matrix")

        _page_breakeven(pdf, grid, basis)
        print("    [13/15] Breakeven Analysis")

        _page_cashflow_profile(pdf, charts)
        print("    [14/15] Cashflow Profile")

        _page_appendix(pdf)
        print("    [15/15] Appendix")

    print(f"  PDF report saved: {out_path}")
    return out_path
