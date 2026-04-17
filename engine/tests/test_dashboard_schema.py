"""Schema validation tests for dashboard_data.json contract.

Ensures output includes required sections and key fields introduced by
portfolio-fix prompts (expected_xirr, concentration breakdowns, dynamic J-curve).
"""

from __future__ import annotations

import json
import os

import pytest

from engine.config.loader import merge_with_defaults
from engine.config.schema import ClaimConfig as PlatformClaim, PortfolioConfig
from engine.jurisdictions.registry import REGISTRY
from engine.run_v2 import run_platform_pipeline

N_PATHS = 300
SEED = 42


def _build_templates() -> dict:
    templates = {}
    for jur_id in REGISTRY.list_jurisdictions():
        templates[jur_id] = REGISTRY.get_template(jur_id)
    return templates


def _build_claims() -> list[PlatformClaim]:
    raw_claims = [
        {
            "id": "SCHEMA-A",
            "name": "Schema Claim A",
            "claimant": "TATA Projects",
            "respondent": "Respondent A",
            "jurisdiction": "indian_domestic",
            "claim_type": "prolongation",
            "soc_value_cr": 125.0,
            "currency": "INR",
        },
        {
            "id": "SCHEMA-B",
            "name": "Schema Claim B",
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


def _make_config(claims: list[PlatformClaim]) -> PortfolioConfig:
    raw = {
        "id": "SCHEMA-PORT",
        "name": "Schema Validation Portfolio",
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
                "upfront_range": {"min": 0.10, "max": 0.10, "step": 0.05},
                "tail_range": {"min": 0.20, "max": 0.20, "step": 0.05},
                "pricing_basis": "soc",
            },
        },
    }
    return PortfolioConfig.model_validate(raw)


@pytest.fixture(scope="module")
def dashboard_data(tmp_path_factory) -> dict:
    claims = _build_claims()
    templates = _build_templates()
    config = _make_config(claims)
    out_dir = str(tmp_path_factory.mktemp("dashboard_schema"))

    result = run_platform_pipeline(config, claims, templates, out_dir)
    assert result.get("status") in {"success", "complete"}

    dash_path = os.path.join(out_dir, "dashboard_data.json")
    assert os.path.isfile(dash_path), "dashboard_data.json was not produced"

    with open(dash_path, encoding="utf-8") as f:
        return json.load(f)


def test_dashboard_data_schema_contract(dashboard_data):
    claims = dashboard_data.get("claims")
    assert isinstance(claims, list) and claims, "claims must be a non-empty array"

    required_claim_fields = ["claim_id", "name", "jurisdiction", "claim_type", "soc_value_cr"]
    for claim in claims:
        for field in required_claim_fields:
            assert field in claim, f"claims[] missing required field '{field}'"

    concentration = ((dashboard_data.get("risk") or {}).get("concentration") or {})
    assert isinstance(concentration.get("jurisdiction_breakdown"), dict)
    assert isinstance(concentration.get("type_breakdown"), dict)

    irr_distribution = ((dashboard_data.get("risk") or {}).get("irr_distribution") or {})
    for key in ["p5", "p25", "p50", "p75", "p95", "mean"]:
        assert key in irr_distribution, f"risk.irr_distribution missing '{key}'"
    assert float(irr_distribution.get("mean", -1.0)) > -0.50

    ig = dashboard_data.get("investment_grid")
    assert isinstance(ig, dict) and ig, "investment_grid must contain at least one cell"

    first_cell = next(iter(ig.values()))
    for key in ["mean_moic", "mean_xirr", "expected_xirr", "p_loss"]:
        assert key in first_cell, f"investment_grid cell missing '{key}'"

    mc_distributions = dashboard_data.get("mc_distributions") or {}
    assert "moic" in mc_distributions
    assert "irr" in mc_distributions
    assert "n_paths" in mc_distributions

    jcurve_data = dashboard_data.get("jcurve_data") or {}
    assert isinstance(jcurve_data.get("scenarios"), dict)
    assert isinstance(jcurve_data.get("available_combos"), list)
    assert isinstance(jcurve_data.get("default_key"), str)
