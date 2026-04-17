"""Regression tests for Prompt 2 fixes.

Verifies:
1) risk.concentration preserves jurisdiction/type breakdowns after post-processing
2) per-claim sections include human-readable names
3) concentration fallback buckets handle missing jurisdiction/claim_type
"""

from __future__ import annotations

import json
import os
from pathlib import Path

import pytest

from engine.analysis.risk_metrics import _compute_concentration
from engine.config.loader import merge_with_defaults
from engine.config.schema import ClaimConfig as PlatformClaim, PortfolioConfig
from engine.jurisdictions.registry import REGISTRY
from engine.run_v2 import run_platform_pipeline

FIXTURE_PATH = Path(__file__).parent / "test_tata_portfolio.json"
N_PATHS = 150
SEED = 99


def _load_fixture() -> dict:
    with open(FIXTURE_PATH, encoding="utf-8") as f:
        return json.load(f)


def _build_claims(fixture: dict) -> list[PlatformClaim]:
    claims = []
    for c in fixture["claims"]:
        jurisdiction = c.get("jurisdiction", "indian_domestic")
        claims.append(merge_with_defaults(c, jurisdiction=jurisdiction))
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
                "upfront_range": {"min": 0.05, "max": 0.15, "step": 0.05},
                "tail_range": {"min": 0.10, "max": 0.30, "step": 0.10},
                "pricing_basis": "soc",
            },
        },
    }
    return PortfolioConfig.model_validate(raw)


@pytest.fixture(scope="module")
def prompt2_dashboard(tmp_path_factory):
    fixture = _load_fixture()
    claims = _build_claims(fixture)
    templates = _build_templates()
    config = _make_config(fixture)
    out_dir = str(tmp_path_factory.mktemp("prompt2_fix"))

    result = run_platform_pipeline(config, claims, templates, out_dir)
    assert result.get("status") in {"success", "complete"}

    dash_path = os.path.join(out_dir, "dashboard_data.json")
    assert os.path.isfile(dash_path), "dashboard_data.json was not produced"

    with open(dash_path, encoding="utf-8") as f:
        data = json.load(f)

    return data


def test_prompt2_risk_concentration_preserved(prompt2_dashboard):
    concentration = (prompt2_dashboard.get("risk") or {}).get("concentration") or {}

    assert isinstance(concentration.get("jurisdiction_breakdown"), dict)
    assert concentration.get("jurisdiction_breakdown"), (
        "risk.concentration.jurisdiction_breakdown should be non-empty"
    )

    assert isinstance(concentration.get("type_breakdown"), dict)
    assert concentration.get("type_breakdown"), (
        "risk.concentration.type_breakdown should be non-empty"
    )


def test_prompt2_per_claim_sections_include_name(prompt2_dashboard):
    claims = prompt2_dashboard.get("claims") or []
    claim_name_map = {c.get("claim_id"): c.get("name") for c in claims}

    cashflow_rows = (prompt2_dashboard.get("cashflow_analysis") or {}).get("per_claim") or []
    assert cashflow_rows, "cashflow_analysis.per_claim should be non-empty"
    for row in cashflow_rows:
        assert isinstance(row.get("name"), str) and row["name"].strip(), (
            f"cashflow_analysis row missing name for claim_id={row.get('claim_id')}"
        )

    investment_grid = prompt2_dashboard.get("investment_grid") or {}
    assert investment_grid, "investment_grid should be present after post-processing"

    for grid_key, row in investment_grid.items():
        contribs = row.get("per_claim_contributions") or []
        assert contribs, f"investment_grid[{grid_key}] missing per_claim_contributions"
        for contrib in contribs:
            cid = contrib.get("claim_id")
            assert cid in claim_name_map, f"Unknown claim_id in per_claim_contributions: {cid}"
            assert isinstance(contrib.get("name"), str) and contrib["name"].strip(), (
                f"Missing name in investment_grid[{grid_key}] per_claim_contributions for {cid}"
            )


def test_prompt2_concentration_handles_missing_metadata(caplog):
    fixture = _load_fixture()
    claim_a = _build_claims(fixture)[0]
    claim_b = claim_a.model_copy(update={
        "id": "CLAIM-B",
        "name": "Claim B",
        "soc_value_cr": max(1.0, claim_a.soc_value_cr / 2.0),
        "jurisdiction": "",
        "claim_type": "",
    })

    with caplog.at_level("WARNING"):
        concentration = _compute_concentration([claim_a, claim_b])

    assert "unknown" in concentration.get("jurisdiction_breakdown", {})
    assert "unclassified" in concentration.get("type_breakdown", {})
    assert "missing jurisdiction" in caplog.text
    assert "missing claim_type" in caplog.text
