"""Monetisation upfront + tail structure handler."""

from __future__ import annotations

import time

from .base import StructureHandler


class UpfrontTailHandler(StructureHandler):

    def should_run_stochastic(self) -> bool:
        return True

    def should_run_prob_sensitivity(self) -> bool:
        return True

    def run_grid_analysis(self, sim, claims, ctx, portfolio_config, output_dir):
        from engine.v2_core.v2_investment_analysis import analyze_investment_grid

        print("\nComputing investment grid...")
        t1 = time.time()
        grid = analyze_investment_grid(
            sim, ctx.claims, pricing_bases=["soc"], ctx=ctx,
        )
        elapsed_grid = time.time() - t1
        print(f"  Grid analysis completed in {elapsed_grid:.1f}s")
        return grid, {}

    def postprocess_dashboard(self, data, sim, grid, waterfall_grid_results,
                              pricing_basis, output_dir):
        for basis_key in ("investment_grid_soc", "investment_grid_eq"):
            if isinstance(data.get(basis_key), list) and len(data[basis_key]) > 0:
                ig = {}
                for row in data[basis_key]:
                    if "p_hurdle" not in row:
                        row["p_hurdle"] = row.get("p_irr_gt_30", 0.0)
                    if "e_moic" not in row:
                        row["e_moic"] = row.get("mean_moic", 0.0)
                    up = round((row.get("upfront_pct", 0)) * 100)
                    tail = round((row.get("tata_tail_pct", 0)) * 100)
                    ig[f"{up}_{tail}"] = row
                data["investment_grid"] = ig

        if not data.get("structure_type"):
            data["structure_type"] = "monetisation_upfront_tail"

        return data.get("investment_grid", {})

    def get_extra_dashboard_fields(self, sim, waterfall_grid_results) -> dict:
        return {}
