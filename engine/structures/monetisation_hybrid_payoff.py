"""Monetisation hybrid payoff structure handler.

Hybrid payoff = upfront (% of SOC or fixed amount) + a contingent payout on
recovery determined by ``op(A, B)`` where each leg is independently
parameterised as a multiple of the upfront or a fraction of the recovery,
with optional clip to ``[min_payout, max_payout]``.

The grid sweep is over (upfront_value, return_a_value, basis) and emits
``InvestmentGridResults`` with field names that match the upfront-tail grid,
so the existing dashboard heatmap renders without modification.
"""

from __future__ import annotations

import time

from .base import StructureHandler


class HybridPayoffHandler(StructureHandler):

    def should_run_stochastic(self) -> bool:
        return True

    def should_run_prob_sensitivity(self) -> bool:
        return True

    def run_grid_analysis(self, sim, claims, ctx, portfolio_config, output_dir):
        from engine.v2_core.v2_hybrid_payoff_analysis import (
            analyze_hybrid_payoff_grid,
        )

        params = portfolio_config.structure.params

        print("\nComputing hybrid payoff investment grid...")
        t1 = time.time()
        grid = analyze_hybrid_payoff_grid(
            sim=sim,
            claims=ctx.claims,
            params=params,
        )
        elapsed = time.time() - t1
        print(f"  Grid analysis completed in {elapsed:.1f}s")
        return grid, {"hybrid_payoff_params": params.model_dump()}

    def postprocess_dashboard(self, data, sim, grid, waterfall_grid_results,
                              pricing_basis, output_dir):
        """Re-key the serialised grid so heatmap axes are (upfront × return_a).

        The shared ``_build_investment_grid`` writes ``tata_tail_pct`` with
        ``round(1 - aw, 2)`` — meaningless for the hybrid structure where the
        second axis is ``return_a_value``.  Translate that here back to the
        original ``return_a_value`` and key the dict by ``f"{up}_{ra}"``.
        """
        for basis_key in ("investment_grid_soc", "investment_grid_eq"):
            rows = data.get(basis_key)
            if not isinstance(rows, list) or not rows:
                continue
            ig = {}
            for row in rows:
                up_val = float(row.get("upfront_pct", 0.0) or 0.0)
                # award_share_pct holds the original return_a_value
                ra_val = float(row.get("award_share_pct", 0.0) or 0.0)
                row["return_a_value"] = ra_val
                # tata_tail_pct from the upfront-tail serialiser is meaningless
                # for hybrid payoff — drop the misleading key.
                row.pop("tata_tail_pct", None)
                row.setdefault("p_hurdle", row.get("p_irr_gt_30", 0.0))
                row.setdefault("e_moic", row.get("mean_moic", 0.0))

                # Keys compatible with both upfront-tail (pct, pct) and
                # arbitrary-magnitude return_a (e.g. 3.0 → "300").
                up_key = round(up_val * 100)
                ra_key = round(ra_val * 100)
                ig[f"{up_key}_{ra_key}"] = row
            data["investment_grid"] = ig

        if not data.get("structure_type"):
            data["structure_type"] = "monetisation_hybrid_payoff"

        return data.get("investment_grid", {})

    def get_extra_dashboard_fields(self, sim, waterfall_grid_results) -> dict:
        return {}
