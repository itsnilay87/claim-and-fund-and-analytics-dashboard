"""Regression tests for Prompt 3 dynamic config propagation fixes.

Verifies:
1) Reference KPI cell selection follows user-selected upfront/tail combo
2) mc_distributions are built from user-selected structure params (not hardcoded 10/20)
3) J-curve default key matches user-selected combo
4) J-curve max_months is derived from claim/path horizons (not hardcoded 96)
"""

from __future__ import annotations

import json
import os
from pathlib import Path

import pytest

from engine.config.loader import merge_with_defaults
from engine.config.schema import ClaimConfig as PlatformClaim, PortfolioConfig
from engine.jurisdictions.registry import REGISTRY
from engine.run_v2 import run_platform_pipeline

FIXTURE_PATH = Path(__file__).parent / "test_tata_portfolio.json"
N_PATHS = 120
SEED = 123

USER_UPFRONT = 0.15
USER_TAIL = 0.25


def _load_fixture() -> dict:
    with open(FIXTURE_PATH, encoding="utf-8") as f:
        return json.load(f)


def _build_claims(fixture: dict) -> list[PlatformClaim]:
    claims = []
    for c in fixture["claims"]:
        jurisdiction = c.get("jurisdiction", "indian_domestic")
        claim = merge_with_defaults(c, jurisdiction=jurisdiction)
        if claim.timeline is not None:
            claim.timeline.max_horizon_months = 84
        claims.append(claim)
    return claims


def _build_templates() -> dict:
    templates = {}
    for jur_id in REGISTRY.list_jurisdictions():
        templates[jur_id] = REGISTRY.get_template(jur_id)
    return templates


def _make_config(fixture: dict) -> PortfolioConfig:
    raw = {
        "id": fixture["id"],
        "name": fixture["name"],
        "claim_ids": fixture["claim_ids"],
        "simulation": {
            "n_paths": N_PATHS,
            "seed": SEED,
            "discount_rate": fixture["simulation"]["discount_rate"],
            "risk_free_rate": fixture["simulation"]["risk_free_rate"],
            "start_date": fixture["simulation"]["start_date"],
        },
        "structure": {
            "type": "monetisation_upfront_tail",
            "params": {
                "upfront_range": {"min": USER_UPFRONT, "max": USER_UPFRONT, "step": 0.05},
                "tail_range": {"min": USER_TAIL, "max": USER_TAIL, "step": 0.05},
                "pricing_basis": "soc",
            },
        },
    }
    return PortfolioConfig.model_validate(raw)


def _hist_mean(hist: dict) -> float:
    bins = hist.get("bins") or []
    counts = hist.get("counts") or []
    if not bins or not counts or len(bins) != len(counts):
        return 0.0
    total = sum(counts)
    if total <= 0:
        return 0.0
    return sum(float(b) * int(c) for b, c in zip(bins, counts)) / float(total)


def _compute_mean_path_moic(sim, soc_map: dict[str, float], upfront_pct: float, tail_pct: float) -> float:
    moics = []
    fund_share = 1.0 - tail_pct
    for path_i in range(sim.n_paths):
        total_invested = 0.0
        total_return = 0.0
        for cid in sim.claim_ids:
            p = sim.results[cid][path_i]
            soc_cr = soc_map.get(cid, 0.0)
            total_invested += (upfront_pct * soc_cr) + float(p.legal_cost_total_cr)
            total_return += fund_share * float(p.collected_cr)
        moics.append(total_return / total_invested if total_invested > 0 else 0.0)
    return sum(moics) / max(len(moics), 1)


@pytest.fixture(scope="module")
def prompt3_result(tmp_path_factory):
    fixture = _load_fixture()
    claims = _build_claims(fixture)
    templates = _build_templates()
    config = _make_config(fixture)
    out_dir = str(tmp_path_factory.mktemp("prompt3_fix"))

    result = run_platform_pipeline(config, claims, templates, out_dir)
    assert result.get("status") in {"success", "complete"}

    dash_path = os.path.join(out_dir, "dashboard_data.json")
    assert os.path.isfile(dash_path), "dashboard_data.json was not produced"

    with open(dash_path, encoding="utf-8") as f:
        data = json.load(f)

    return {
        "result": result,
        "dashboard": data,
        "claims": claims,
    }


def test_dynamic_ref_cell_selection(prompt3_result):
    data = prompt3_result["dashboard"]
    ig = data.get("investment_grid") or {}

    assert "15_25" in ig, "Expected user-selected 15_25 grid cell to exist"

    ref_cell = ig["15_25"]
    risk_moic_mean = (data.get("risk") or {}).get("moic_distribution", {}).get("mean")
    assert risk_moic_mean == pytest.approx(ref_cell.get("mean_moic", 0.0), abs=1e-4)


def test_mc_distributions_use_user_params(prompt3_result):
    data = prompt3_result["dashboard"]
    sim = prompt3_result["result"]["sim"]
    claims = prompt3_result["claims"]

    soc_map = {c.id: float(c.soc_value_cr) for c in claims}

    hist_moic_mean = _hist_mean((data.get("mc_distributions") or {}).get("moic") or {})
    expected_user_mean = _compute_mean_path_moic(sim, soc_map, USER_UPFRONT, USER_TAIL)
    expected_hardcoded_mean = _compute_mean_path_moic(sim, soc_map, 0.10, 0.20)

    user_gap = abs(hist_moic_mean - expected_user_mean)
    hardcoded_gap = abs(hist_moic_mean - expected_hardcoded_mean)

    assert user_gap < hardcoded_gap, (
        f"mc_distributions appears closer to hardcoded 10/20 than user params: "
        f"hist={hist_moic_mean:.4f}, user={expected_user_mean:.4f}, hardcoded={expected_hardcoded_mean:.4f}"
    )


def test_jcurve_default_key_matches_user_selection(prompt3_result):
    jcurve = prompt3_result["dashboard"].get("jcurve_data") or {}

    assert jcurve.get("default_key") == "up15_tail25"
    assert "up15_tail25" in (jcurve.get("scenarios") or {})

    available_keys = {entry.get("key") for entry in (jcurve.get("available_combos") or [])}
    assert "up15_tail25" in available_keys


def test_jcurve_max_months_from_claims(prompt3_result):
    data = prompt3_result["dashboard"]
    claims = prompt3_result["claims"]

    expected_max = max(int(c.timeline.max_horizon_months) for c in claims if c.timeline is not None)
    assert data.get("jcurve_data", {}).get("max_months") == expected_max
    assert data.get("jcurve_data", {}).get("max_months") != 96
