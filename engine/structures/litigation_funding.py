"""Litigation-funding structure handler.

Moves _v2_paths_to_platform, _build_arb_sensitivity, and _build_litigation_jcurve
out of engine/run_v2.py into this structure-specific module.
"""

from __future__ import annotations

import math
import time
from typing import Optional

from .base import StructureHandler


# ── helpers (moved from run_v2.py) ──────────────────────────────────

def _v2_paths_to_platform(sim) -> dict:
    """Convert V2 PathResult objects to platform PathResult for analysis modules."""
    from engine.config.schema import PathResult as PlatformPathResult

    converted: dict[str, list] = {}
    for claim_id, v2_paths in sim.results.items():
        platform_paths = []
        for pr in v2_paths:
            platform_paths.append(PlatformPathResult(
                outcome=pr.final_outcome,
                quantum_cr=pr.quantum.expected_quantum_cr if pr.quantum else 0.0,
                timeline_months=pr.total_duration_months,
                legal_costs_cr=pr.legal_cost_total_cr,
                collected_cr=pr.collected_cr,
                interest_cr=pr.interest_earned_cr,
            ))
        converted[claim_id] = platform_paths
    return converted


def _build_arb_sensitivity(sim, waterfall_grid_results: dict) -> list[dict]:
    """Compute arb-win-prob sensitivity via analytical path reweighting.

    Uses the litigation-funding waterfall at a reference (cost_multiple,
    award_ratio) mid-point.  Classifies each MC path as 'won' or 'lost'
    and reweights at shifted arb_win_prob values.

    Returns list of {arb_win_prob, e_moic, e_irr, p_loss}.
    """
    import numpy as np
    from engine.v2_core import v2_master_inputs as MI

    keys = sorted(waterfall_grid_results.keys())
    if not keys:
        return []
    mid_key = keys[len(keys) // 2]
    parts = mid_key.split("_")
    ref_cm = int(parts[0]) / 10.0
    ref_ar = int(parts[1]) / 100.0

    n_paths = sim.n_paths
    path_moics = np.zeros(n_paths)
    path_irrs = np.zeros(n_paths)
    path_won = np.zeros(n_paths, dtype=bool)

    for path_i in range(n_paths):
        total_inv = 0.0
        total_ret = 0.0
        any_won = False
        mean_dur = 0.0
        n_claims = 0

        for cid in sim.claim_ids:
            paths = sim.results.get(cid, [])
            if path_i >= len(paths):
                continue
            p = paths[path_i]
            legal = float(p.legal_cost_total_cr)
            total_inv += legal

            if p.final_outcome == "TRUE_WIN" and p.collected_cr > 0:
                any_won = True
                leg_a = ref_cm * legal
                leg_b = ref_ar * float(p.collected_cr)
                total_ret += min(leg_a, leg_b)

            mean_dur += float(p.total_duration_months)
            n_claims += 1

        if total_inv > 0:
            moic = total_ret / total_inv
        else:
            moic = 0.0

        path_moics[path_i] = moic
        path_won[path_i] = any_won

        avg_dur = mean_dur / max(n_claims, 1)
        if moic > 0 and avg_dur > 0:
            path_irrs[path_i] = moic ** (12.0 / avg_dur) - 1.0
        else:
            path_irrs[path_i] = -1.0

    p_orig = MI.ARB_WIN_PROBABILITY
    n_won = int(path_won.sum())
    n_lost = n_paths - n_won

    results = []
    for p_s_raw in np.arange(0.30, 0.96, 0.05):
        p_s = float(max(0.01, min(0.99, p_s_raw)))
        if n_won > 0 and n_lost > 0 and p_orig > 0 and p_orig < 1:
            w_won = p_s / p_orig
            w_lost = (1.0 - p_s) / (1.0 - p_orig)
            weights = np.where(path_won, w_won, w_lost)
            weights /= weights.sum()
            e_moic = float(np.dot(weights, path_moics))
            e_irr = float(np.dot(weights, path_irrs))
            p_loss = float(np.dot(weights, (path_moics < 1.0).astype(float)))
        else:
            e_moic = float(np.mean(path_moics))
            e_irr = float(np.mean(path_irrs))
            p_loss = float(np.mean(path_moics < 1.0))

        results.append({
            "arb_win_prob": round(p_s, 4),
            "e_moic": round(e_moic, 4),
            "e_irr": round(e_irr, 4),
            "p_loss": round(p_loss, 4),
        })

    return results


def _build_litigation_jcurve(sim) -> dict:
    """Build J-curve data for litigation funding from actual MC path cashflows."""
    import numpy as np

    MAX_MONTHS = 96
    n_paths = sim.n_paths

    portfolio_cumul = np.zeros((n_paths, MAX_MONTHS))

    for cid in sim.claim_ids:
        paths = sim.results.get(cid, [])
        for path_idx in range(min(len(paths), n_paths)):
            p = paths[path_idx]
            burn = p.monthly_legal_burn
            if burn is None or len(burn) == 0:
                continue

            payment_month = max(int(math.ceil(p.total_duration_months)), 1)

            cf = np.zeros(MAX_MONTHS)
            burn_len = min(len(burn), MAX_MONTHS)
            for m in range(burn_len):
                cf[m] = -float(burn[m])

            if payment_month < MAX_MONTHS and p.collected_cr > 0:
                cf[payment_month] += p.collected_cr

            portfolio_cumul[path_idx] += np.cumsum(cf)

    months_to_sample = list(range(0, min(24, MAX_MONTHS)))
    months_to_sample += list(range(24, MAX_MONTHS, 3))
    months_to_sample = sorted(set(m for m in months_to_sample if m < MAX_MONTHS))

    timeline = []
    for m in months_to_sample:
        col = portfolio_cumul[:, m]
        year = 2026 + (m + 4) // 12
        month_num = ((m + 4) % 12) or 12
        month_names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                       'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
        label = f"{month_names[month_num - 1]} {year}"
        timeline.append({
            "month": m,
            "label": label,
            "p5": round(float(np.percentile(col, 5)), 2),
            "p25": round(float(np.percentile(col, 25)), 2),
            "median": round(float(np.percentile(col, 50)), 2),
            "p75": round(float(np.percentile(col, 75)), 2),
            "p95": round(float(np.percentile(col, 95)), 2),
            "mean": round(float(np.mean(col)), 2),
        })

    return {
        "scenarios": {"litigation_funding": timeline},
        "available_combos": [],
        "upfront_pcts": [],
        "tata_tail_pcts": [],
        "default_key": "litigation_funding",
        "max_months": MAX_MONTHS,
    }


# ── Handler ─────────────────────────────────────────────────────────

class LitigationFundingHandler(StructureHandler):

    def should_run_stochastic(self) -> bool:
        return False

    def should_run_prob_sensitivity(self) -> bool:
        return False

    # ----------------------------------------------------------------
    def run_grid_analysis(self, sim, claims, ctx, portfolio_config, output_dir):
        from engine.analysis.waterfall_analysis import evaluate_waterfall_grid
        from engine.analysis.investment_grid import _arange
        from engine.v2_core.v2_investment_analysis import InvestmentGridResults
        from engine.run_v2 import sim_config_start_date

        params = portfolio_config.structure.params
        cm_list = _arange(params.cost_multiple_range)
        ar_list = _arange(params.award_ratio_range)

        print(f"\nComputing waterfall grid ({len(cm_list)} × {len(ar_list)})...")
        t1 = time.time()

        platform_path_results = _v2_paths_to_platform(sim)

        waterfall_grid_results = evaluate_waterfall_grid(
            claims, platform_path_results,
            cost_multiple_range=cm_list,
            award_ratio_range=ar_list,
            waterfall_type=params.waterfall_type,
            start_date=sim_config_start_date(portfolio_config),
        )
        elapsed_grid = time.time() - t1
        print(f"  Waterfall grid completed in {elapsed_grid:.1f}s ({len(waterfall_grid_results)} cells)")

        grid = InvestmentGridResults(
            upfront_pcts=[],
            award_share_pcts=[],
            pricing_bases=["soc"],
            n_paths=sim.n_paths,
            n_claims=len(claims),
        )

        extra = {"waterfall_grid": waterfall_grid_results}
        return grid, extra

    # ----------------------------------------------------------------
    def postprocess_dashboard(self, data, sim, grid, waterfall_grid_results,
                              pricing_basis, output_dir):
        if not waterfall_grid_results:
            return data.get("investment_grid", {})

        # Build waterfall_grid dict from GridCellMetrics
        wf_grid = {}
        for key, cell in waterfall_grid_results.items():
            cell_dict = cell.model_dump() if hasattr(cell, "model_dump") else cell.dict()
            cell_dict["e_moic"] = cell_dict.get("mean_moic", 0.0)
            cell_dict["p_hurdle"] = cell_dict.get("p_hurdle", 0.0)
            wf_grid[key] = cell_dict

        data["waterfall_grid"] = wf_grid
        data["structure_type"] = "litigation_funding"
        if data.get("simulation_meta"):
            data["simulation_meta"]["structure_type"] = "litigation_funding"

        # Build waterfall_axes from grid keys
        cm_set = set()
        ar_set = set()
        for key in waterfall_grid_results:
            parts = key.split("_")
            if len(parts) == 2:
                cm_set.add(int(parts[0]))
                ar_set.add(int(parts[1]))
        data["waterfall_axes"] = {
            "cost_multiples": sorted(v / 10.0 for v in cm_set),
            "award_ratios": sorted(v / 100.0 for v in ar_set),
        }

        # Build waterfall_breakeven
        breakeven = []
        for ar_val in sorted(ar_set):
            ar_frac = ar_val / 100.0
            max_cm = None
            for cm_val in sorted(cm_set):
                key = f"{cm_val}_{ar_val}"
                cell = waterfall_grid_results.get(key)
                if cell and cell.mean_moic >= 1.0:
                    max_cm = cm_val / 10.0
            if max_cm is not None:
                breakeven.append({"award_ratio": ar_frac, "max_cost_multiple": max_cm})
        data["waterfall_breakeven"] = breakeven

        # Remove upfront/tail keys that don't apply
        data.pop("investment_grid", None)
        data.pop("investment_grid_soc", None)
        data.pop("investment_grid_eq", None)

        return wf_grid

    # ----------------------------------------------------------------
    def get_extra_dashboard_fields(self, sim, waterfall_grid_results) -> dict:
        extra = {}
        if waterfall_grid_results:
            sensitivity = _build_arb_sensitivity(sim, waterfall_grid_results)
            if sensitivity:
                extra["sensitivity"] = sensitivity
        extra["jcurve_data"] = _build_litigation_jcurve(sim)
        return extra
