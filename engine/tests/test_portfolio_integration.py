"""End-to-end integration tests for portfolio analysis pipeline fixes.

Verifies a compact 2-claim portfolio for:
1. expected-cashflow IRR usage as primary E[IRR]
2. E[IRR] consistency with E[MOIC] and duration
3. concentration payload population
4. claim-name propagation across per-claim sections
5. dynamic config propagation (no hardcoded 10/20 leakage)
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

N_PATHS = 1000
SEED = 42


def _build_templates() -> dict:
    templates = {}
    for jur_id in REGISTRY.list_jurisdictions():
        templates[jur_id] = REGISTRY.get_template(jur_id)
    return templates


def _build_two_claims() -> list[PlatformClaim]:
    raw_claims = [
        {
            "id": "PROMPT6-A",
            "name": "Claim A",
            "claimant": "TATA Projects",
            "respondent": "Respondent A",
            "jurisdiction": "indian_domestic",
            "claim_type": "prolongation",
            "soc_value_cr": 125.0,
            "currency": "INR",
        },
        {
            "id": "PROMPT6-B",
            "name": "Claim B",
            "claimant": "TATA Projects",
            "respondent": "Respondent B",
            "jurisdiction": "indian_domestic",
            "claim_type": "prolongation",
            "soc_value_cr": 219.0,
            "currency": "INR",
        },
    ]
    return [
        merge_with_defaults(c, jurisdiction=c["jurisdiction"])
        for c in raw_claims
    ]


def _make_config(claims: list[PlatformClaim], upfront_pct: float, tail_pct: float) -> PortfolioConfig:
    raw = {
        "id": f"PROMPT6-{int(upfront_pct * 100)}-{int(tail_pct * 100)}",
        "name": "Prompt 6 Integration Portfolio",
        "claim_ids": [c.id for c in claims],
        "simulation": {
            "n_paths": N_PATHS,
            "seed": SEED,
            "discount_rate": 0.12,
            "risk_free_rate": 0.07,
            "start_date": "2026-04-30",
        },
        "structure": {
            "type": "monetisation_upfront_tail",
            "params": {
                "upfront_range": {"min": upfront_pct, "max": upfront_pct, "step": 0.05},
                "tail_range": {"min": tail_pct, "max": tail_pct, "step": 0.05},
                "pricing_basis": "soc",
            },
        },
    }
    return PortfolioConfig.model_validate(raw)


def _run_pipeline_for_combo(tmp_path_factory, upfront_pct: float, tail_pct: float) -> dict:
    claims = _build_two_claims()
    templates = _build_templates()
    config = _make_config(claims, upfront_pct, tail_pct)
    out_dir = str(tmp_path_factory.mktemp(f"prompt6_{int(upfront_pct * 100)}_{int(tail_pct * 100)}"))

    result = run_platform_pipeline(config, claims, templates, out_dir)
    assert result.get("status") in {"success", "complete"}

    dash_path = Path(out_dir) / "dashboard_data.json"
    assert dash_path.is_file(), "dashboard_data.json was not produced"

    with open(dash_path, encoding="utf-8") as f:
        data = json.load(f)

    return {
        "result": result,
        "dashboard": data,
        "claims": claims,
        "upfront_pct": upfront_pct,
        "tail_pct": tail_pct,
    }


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
    fund_share = 1.0 - tail_pct
    moics = []
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


def _available_combo_keys(jcurve_data: dict) -> set[str]:
    keys = set()
    for row in (jcurve_data.get("available_combos") or []):
        if isinstance(row, str):
            keys.add(row)
        elif isinstance(row, dict):
            key = row.get("key")
            if isinstance(key, str):
                keys.add(key)
    return keys


@pytest.fixture(scope="module")
def run_10_20(tmp_path_factory):
    return _run_pipeline_for_combo(tmp_path_factory, 0.10, 0.20)


@pytest.fixture(scope="module")
def run_15_25(tmp_path_factory):
    return _run_pipeline_for_combo(tmp_path_factory, 0.15, 0.25)


def test_two_claim_portfolio_end_to_end(run_10_20):
    data = run_10_20["dashboard"]

    claims = data.get("claims") or []
    assert len(claims) == 2

    ig = data.get("investment_grid") or {}
    assert "10_20" in ig
    ref = ig["10_20"]

    risk = data.get("risk") or {}
    irr_mean = (risk.get("irr_distribution") or {}).get("mean")
    ref_irr = ref.get("expected_xirr", ref.get("mean_xirr", 0.0))
    assert irr_mean == pytest.approx(ref_irr, abs=1e-4)

    concentration = (risk.get("concentration") or {})
    assert concentration.get("jurisdiction_breakdown")
    assert concentration.get("type_breakdown")

    jcurve = data.get("jcurve_data") or {}
    assert jcurve.get("default_key") == "up10_tail20"
    assert "up10_tail20" in _available_combo_keys(jcurve)


def test_irr_moic_consistency(run_10_20):
    data = run_10_20["dashboard"]
    ig = data.get("investment_grid") or {}
    ref = ig.get("10_20") or {}

    moic = float(ref.get("mean_moic", 0.0) or 0.0)
    expected_irr = float(ref.get("expected_xirr", 0.0) or 0.0)
    mean_duration_months = (
        sum(float(c.get("mean_duration_months", 0.0) or 0.0) for c in (data.get("claims") or []))
        / max(len(data.get("claims") or []), 1)
    )

    if moic <= 0 or mean_duration_months <= 0:
        pytest.skip("Insufficient metrics for IRR/MOIC consistency check")

    duration_years = mean_duration_months / 12.0
    implied_irr = moic ** (1.0 / duration_years) - 1.0

    tolerance = max(0.05, abs(implied_irr) * 0.20)
    assert abs(expected_irr - implied_irr) <= tolerance, (
        f"E[IRR] {expected_irr:.4f} not within tolerance of implied {implied_irr:.4f}"
    )


def test_concentration_data_present(run_10_20):
    concentration = ((run_10_20["dashboard"].get("risk") or {}).get("concentration") or {})

    assert isinstance(concentration.get("jurisdiction_breakdown"), dict)
    assert concentration.get("jurisdiction_breakdown")
    assert isinstance(concentration.get("type_breakdown"), dict)
    assert concentration.get("type_breakdown")
    assert isinstance(concentration.get("herfindahl_by_jurisdiction"), (int, float))
    assert isinstance(concentration.get("herfindahl_by_type"), (int, float))


def test_claim_names_in_all_sections(run_10_20):
    data = run_10_20["dashboard"]

    for claim in (data.get("claims") or []):
        assert isinstance(claim.get("name"), str) and claim.get("name").strip()

    for cell in (data.get("investment_grid") or {}).values():
        for row in (cell.get("per_claim_contributions") or []):
            assert isinstance(row.get("name"), str) and row.get("name").strip()

    for row in ((data.get("cashflow_analysis") or {}).get("per_claim") or []):
        assert isinstance(row.get("name"), str) and row.get("name").strip()


def test_no_hardcoded_ref_deal(run_15_25):
    data = run_15_25["dashboard"]
    result = run_15_25["result"]

    ig = data.get("investment_grid") or {}
    assert "15_25" in ig

    risk = data.get("risk") or {}
    assert (risk.get("moic_distribution") or {}).get("mean") == pytest.approx(
        ig["15_25"].get("mean_moic", 0.0), abs=1e-4,
    )
    assert (risk.get("irr_distribution") or {}).get("mean") == pytest.approx(
        ig["15_25"].get("expected_xirr", ig["15_25"].get("mean_xirr", 0.0)), abs=1e-4,
    )

    jcurve = data.get("jcurve_data") or {}
    assert jcurve.get("default_key") == "up15_tail25"
    assert jcurve.get("default_key") != "up10_tail20"
    assert "up15_tail25" in _available_combo_keys(jcurve)

    soc_map = {c.id: float(c.soc_value_cr) for c in run_15_25["claims"]}
    hist_moic_mean = _hist_mean((data.get("mc_distributions") or {}).get("moic") or {})
    user_mean = _compute_mean_path_moic(result["sim"], soc_map, 0.15, 0.25)
    hardcoded_mean = _compute_mean_path_moic(result["sim"], soc_map, 0.10, 0.20)

    assert abs(hist_moic_mean - user_mean) < abs(hist_moic_mean - hardcoded_mean)
