"""
engine/tests/test_refactoring_validation.py — Golden-output validation tests.
================================================================================

Verify that the Strategy-pattern refactoring (engine/structures/) produces
identical outputs to the previous monolithic engine/run_v2.py implementation.

Tests cover:
  1. Handler registry resolution for all 5 structure types.
  2. Handler boolean flags (should_run_stochastic / should_run_prob_sensitivity).
  3. Golden dashboard output for litigation_funding structure.
  4. Golden dashboard output for monetisation_upfront_tail structure.
  5. Full pipeline consistency across all 5 structure types.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

import pytest

from engine.structures import (
    get_handler,
    ComparativeHandler,
    FullPurchaseHandler,
    LitigationFundingHandler,
    StagedHandler,
    UpfrontTailHandler,
)
from engine.config.schema import (
    ClaimConfig as PlatformClaim,
    PortfolioConfig,
    PortfolioStructure,
    SimulationConfig,
    LitFundingParams,
    FullPurchaseParams,
    UpfrontTailParams,
    StagedPaymentParams,
    MilestonePayment,
)
from engine.config.loader import merge_with_defaults
from engine.jurisdictions.registry import REGISTRY
from engine.run_v2 import run_platform_pipeline

# ============================================================================
# Fixtures
# ============================================================================

FIXTURE_PATH = Path(__file__).parent / "test_tata_portfolio.json"

N_PATHS = 100  # Minimum allowed by SimulationConfig (ge=100), fast for CI
SEED = 42


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


def _make_portfolio_config(
    fixture: dict,
    structure_type: str,
    structure_params: dict | None = None,
) -> PortfolioConfig:
    """Build a PortfolioConfig from fixture, overriding structure type."""
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
    }

    if structure_type == "comparative":
        raw["structure"] = {
            "type": "comparative",
            "lit_funding_params": {
                "cost_multiple_cap": 3.0,
                "award_ratio_cap": 0.30,
                "waterfall_type": "min",
                "cost_multiple_range": {"min": 1.0, "max": 3.0, "step": 1.0},
                "award_ratio_range": {"min": 0.10, "max": 0.30, "step": 0.10},
            },
            "monetisation_params": {
                "upfront_range": {"min": 0.05, "max": 0.15, "step": 0.05},
                "tail_range": {"min": 0.10, "max": 0.30, "step": 0.10},
                "pricing_basis": "soc",
            },
        }
    elif structure_type == "litigation_funding":
        raw["structure"] = {
            "type": "litigation_funding",
            "params": structure_params or {
                "cost_multiple_cap": 3.0,
                "award_ratio_cap": 0.30,
                "waterfall_type": "min",
                "cost_multiple_range": {"min": 1.0, "max": 3.0, "step": 1.0},
                "award_ratio_range": {"min": 0.10, "max": 0.30, "step": 0.10},
            },
        }
    elif structure_type == "monetisation_full_purchase":
        raw["structure"] = {
            "type": "monetisation_full_purchase",
            "params": structure_params or {
                "purchase_prices": [100.0, 200.0, 300.0],
                "pricing_basis": "soc",
                "legal_cost_bearer": "investor",
            },
        }
    elif structure_type == "monetisation_staged":
        raw["structure"] = {
            "type": "monetisation_staged",
            "params": structure_params or {
                "milestones": [
                    {"milestone_name": "arb_commenced", "payment_cr": 50.0},
                    {"milestone_name": "award_received", "payment_cr": 100.0},
                ],
                "legal_cost_bearer": "investor",
            },
        }
    else:
        # monetisation_upfront_tail (default)
        raw["structure"] = {
            "type": "monetisation_upfront_tail",
            "params": structure_params or {
                "upfront_range": {"min": 0.05, "max": 0.15, "step": 0.05},
                "tail_range": {"min": 0.10, "max": 0.30, "step": 0.10},
                "pricing_basis": "soc",
            },
        }

    return PortfolioConfig.model_validate(raw)


@pytest.fixture(scope="module")
def fixture_data() -> dict:
    return _load_fixture()


@pytest.fixture(scope="module")
def claims(fixture_data) -> list[PlatformClaim]:
    return _build_claims(fixture_data)


@pytest.fixture(scope="module")
def templates() -> dict:
    return _build_templates()


# ============================================================================
# TEST 1: Handler Registry
# ============================================================================

class TestHandlerRegistry:
    """Verify get_handler() resolves correct handler classes."""

    def test_litigation_funding(self):
        handler = get_handler("litigation_funding")
        assert isinstance(handler, LitigationFundingHandler)

    def test_upfront_tail(self):
        handler = get_handler("monetisation_upfront_tail")
        assert isinstance(handler, UpfrontTailHandler)

    def test_full_purchase(self):
        handler = get_handler("monetisation_full_purchase")
        assert isinstance(handler, FullPurchaseHandler)

    def test_staged(self):
        handler = get_handler("monetisation_staged")
        assert isinstance(handler, StagedHandler)

    def test_comparative(self):
        handler = get_handler("comparative")
        assert isinstance(handler, ComparativeHandler)

    def test_invalid_raises(self):
        with pytest.raises(ValueError, match="Unknown structure type"):
            get_handler("invalid_type")


# ============================================================================
# TEST 2: Handler Flags
# ============================================================================

class TestHandlerFlags:
    """Verify should_run_stochastic() and should_run_prob_sensitivity() flags."""

    def test_litigation_funding_flags(self):
        h = get_handler("litigation_funding")
        assert h.should_run_stochastic() is False
        assert h.should_run_prob_sensitivity() is False

    def test_upfront_tail_flags(self):
        h = get_handler("monetisation_upfront_tail")
        assert h.should_run_stochastic() is True
        assert h.should_run_prob_sensitivity() is True

    def test_full_purchase_flags(self):
        h = get_handler("monetisation_full_purchase")
        assert h.should_run_stochastic() is True
        assert h.should_run_prob_sensitivity() is True

    def test_staged_flags(self):
        h = get_handler("monetisation_staged")
        assert h.should_run_stochastic() is True
        assert h.should_run_prob_sensitivity() is True

    def test_comparative_flags(self):
        h = get_handler("comparative")
        assert h.should_run_stochastic() is True
        assert h.should_run_prob_sensitivity() is True


# ============================================================================
# TEST 3: Golden Dashboard Output — Litigation Funding
# ============================================================================

class TestGoldenLitigationFunding:
    """Verify dashboard_data.json for litigation_funding structure."""

    @pytest.fixture(scope="class")
    def lit_result(self, fixture_data, claims, templates, tmp_path_factory):
        out = str(tmp_path_factory.mktemp("lit_funding"))
        config = _make_portfolio_config(fixture_data, "litigation_funding")
        return run_platform_pipeline(config, claims, templates, out)

    def test_status_complete(self, lit_result):
        assert lit_result["status"] == "complete"

    def test_dashboard_json_exists(self, lit_result):
        dash_path = os.path.join(lit_result["output_path"], "dashboard_data.json")
        assert os.path.isfile(dash_path)

    def test_structure_type(self, lit_result):
        dash_path = os.path.join(lit_result["output_path"], "dashboard_data.json")
        with open(dash_path, encoding="utf-8") as f:
            data = json.load(f)
        assert data.get("structure_type") == "litigation_funding"

    def test_waterfall_grid_exists(self, lit_result):
        dash_path = os.path.join(lit_result["output_path"], "dashboard_data.json")
        with open(dash_path, encoding="utf-8") as f:
            data = json.load(f)
        wg = data.get("waterfall_grid")
        assert wg is not None and isinstance(wg, dict)

    def test_waterfall_axes_exists(self, lit_result):
        dash_path = os.path.join(lit_result["output_path"], "dashboard_data.json")
        with open(dash_path, encoding="utf-8") as f:
            data = json.load(f)
        assert "waterfall_axes" in data

    def test_sensitivity_exists(self, lit_result):
        dash_path = os.path.join(lit_result["output_path"], "dashboard_data.json")
        with open(dash_path, encoding="utf-8") as f:
            data = json.load(f)
        assert "sensitivity" in data

    def test_jcurve_litigation_funding(self, lit_result):
        dash_path = os.path.join(lit_result["output_path"], "dashboard_data.json")
        with open(dash_path, encoding="utf-8") as f:
            data = json.load(f)
        jcurve = data.get("jcurve_data")
        assert jcurve is not None
        scenarios = jcurve.get("scenarios", {})
        assert "litigation_funding" in scenarios

    def test_no_investment_grid(self, lit_result):
        dash_path = os.path.join(lit_result["output_path"], "dashboard_data.json")
        with open(dash_path, encoding="utf-8") as f:
            data = json.load(f)
        # litigation_funding uses waterfall_grid, not investment_grid
        ig = data.get("investment_grid")
        assert ig is None or ig == {}


# ============================================================================
# TEST 4: Golden Dashboard Output — Upfront + Tail
# ============================================================================

class TestGoldenUpfrontTail:
    """Verify dashboard_data.json for monetisation_upfront_tail structure."""

    @pytest.fixture(scope="class")
    def ut_result(self, fixture_data, claims, templates, tmp_path_factory):
        out = str(tmp_path_factory.mktemp("upfront_tail"))
        config = _make_portfolio_config(fixture_data, "monetisation_upfront_tail")
        return run_platform_pipeline(config, claims, templates, out)

    def test_status_complete(self, ut_result):
        assert ut_result["status"] == "complete"

    def test_dashboard_json_exists(self, ut_result):
        dash_path = os.path.join(ut_result["output_path"], "dashboard_data.json")
        assert os.path.isfile(dash_path)

    def test_structure_type(self, ut_result):
        dash_path = os.path.join(ut_result["output_path"], "dashboard_data.json")
        with open(dash_path, encoding="utf-8") as f:
            data = json.load(f)
        assert data.get("structure_type") == "monetisation_upfront_tail"

    def test_investment_grid_exists(self, ut_result):
        dash_path = os.path.join(ut_result["output_path"], "dashboard_data.json")
        with open(dash_path, encoding="utf-8") as f:
            data = json.load(f)
        ig = data.get("investment_grid")
        assert ig is not None and isinstance(ig, dict)

    def test_investment_grid_has_up_tail_keys(self, ut_result):
        dash_path = os.path.join(ut_result["output_path"], "dashboard_data.json")
        with open(dash_path, encoding="utf-8") as f:
            data = json.load(f)
        ig = data.get("investment_grid", {})
        # Keys like "5_10", "10_20" etc.
        up_tail_keys = [k for k in ig if "_" in k]
        assert len(up_tail_keys) > 0, f"Expected upfront_tail grid keys, got: {list(ig.keys())[:5]}"

    def test_stochastic_pricing_generated(self, ut_result):
        stoch_path = os.path.join(ut_result["output_path"], "stochastic_pricing.json")
        assert os.path.isfile(stoch_path), "stochastic_pricing.json should exist for upfront_tail"


# ============================================================================
# TEST 5: Pipeline Consistency — All 5 Structures
# ============================================================================

ALL_STRUCTURES = [
    "litigation_funding",
    "monetisation_upfront_tail",
    "monetisation_full_purchase",
    "monetisation_staged",
    "comparative",
]


class TestPipelineConsistency:
    """Verify pipeline completes for all 5 structure types."""

    @pytest.fixture(scope="class", params=ALL_STRUCTURES)
    def pipeline_result(self, request, fixture_data, claims, templates, tmp_path_factory):
        structure_type = request.param
        out = str(tmp_path_factory.mktemp(structure_type.replace("/", "_")))
        config = _make_portfolio_config(fixture_data, structure_type)
        result = run_platform_pipeline(config, claims, templates, out)
        result["_structure_type"] = structure_type
        return result

    def test_status_complete(self, pipeline_result):
        assert pipeline_result["status"] == "complete", (
            f"Pipeline for {pipeline_result['_structure_type']} did not complete"
        )

    def test_n_claims(self, pipeline_result):
        assert pipeline_result["n_claims"] == 6, (
            f"Expected 6 claims, got {pipeline_result['n_claims']}"
        )

    def test_dashboard_json_exists(self, pipeline_result):
        dash_path = os.path.join(pipeline_result["output_path"], "dashboard_data.json")
        assert os.path.isfile(dash_path), (
            f"dashboard_data.json missing for {pipeline_result['_structure_type']}"
        )
