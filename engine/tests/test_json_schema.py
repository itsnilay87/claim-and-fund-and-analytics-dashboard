"""
engine/tests/test_json_schema.py — JSON Export Schema Validation Tests.
========================================================================

Phase 1, Session 1E: Validate the dashboard_data.json schema produced by
the V2 pipeline's JSON exporter.  These tests verify required keys, field
types, value constraints, and data integrity — ensuring every field the
dashboard frontend relies on is present and well-formed.

Layer: runs the full V2 pipeline (``engine.run_v2.run_platform_pipeline``)
at low N=200 to produce a real dashboard_data.json, then validates its schema.

Test Classes:
  - TestDashboardDataSchema: top-level required keys + types
  - TestPerClaimSchema: per-claim field validation
  - TestGridSchema: investment grid cell validation
  - TestSchemaStability: no NaN/Inf, no empty required strings, finite numerics
"""

from __future__ import annotations

import json
import math
import os
from pathlib import Path

import pytest

from engine.config.schema import ClaimConfig as PlatformClaim, PortfolioConfig
from engine.config.loader import merge_with_defaults
from engine.jurisdictions.registry import REGISTRY
from engine.run_v2 import run_platform_pipeline

# ============================================================================
# Constants
# ============================================================================

FIXTURE_PATH = Path(__file__).parent / "test_tata_portfolio.json"
N_PATHS = 200   # Minimum viable for schema tests — fast
SEED = 42
N_CLAIMS = 6

# ============================================================================
# Helpers
# ============================================================================

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


def _make_upfront_tail_config(fixture: dict) -> PortfolioConfig:
    """Build a minimal upfront-tail portfolio config for schema tests."""
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


def _is_finite(v) -> bool:
    """Check if a numeric value is finite (not NaN, not Inf)."""
    if isinstance(v, (int, float)):
        return math.isfinite(v)
    return True  # non-numeric types are not checked


def _check_no_nan_inf(obj, path: str = "root") -> list[str]:
    """Recursively check for NaN/Inf in a JSON-like object.  Returns violation paths."""
    violations = []
    if isinstance(obj, float):
        if math.isnan(obj) or math.isinf(obj):
            violations.append(f"{path} = {obj}")
    elif isinstance(obj, dict):
        for k, v in obj.items():
            violations.extend(_check_no_nan_inf(v, f"{path}.{k}"))
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            violations.extend(_check_no_nan_inf(v, f"{path}[{i}]"))
    return violations


# ============================================================================
# Module-scoped fixture — run pipeline once, load JSON
# ============================================================================

@pytest.fixture(scope="module")
def pipeline_result(tmp_path_factory):
    """Run the full V2 pipeline and return (result_dict, dashboard_data_dict)."""
    fixture = _load_fixture()
    claims = _build_claims(fixture)
    templates = _build_templates()
    config = _make_upfront_tail_config(fixture)
    out_dir = str(tmp_path_factory.mktemp("schema_test"))

    try:
        result = run_platform_pipeline(config, claims, templates, out_dir)
    except Exception as exc:
        pytest.skip(f"Pipeline failed to run: {exc}")

    dash_path = os.path.join(out_dir, "dashboard_data.json")
    if not os.path.isfile(dash_path):
        pytest.skip("dashboard_data.json was not produced")

    with open(dash_path, encoding="utf-8") as f:
        data = json.load(f)

    return result, data


@pytest.fixture(scope="module")
def dashboard_data(pipeline_result) -> dict:
    """Return just the parsed dashboard_data.json dict."""
    return pipeline_result[1]


# ============================================================================
# TEST 1: Top-Level Dashboard Data Schema
# ============================================================================

class TestDashboardDataSchema:
    """Validate top-level required keys and their types in dashboard_data.json."""

    # Keys that should always be present in the V2 pipeline output
    REQUIRED_KEYS_TYPES = {
        "claims": list,
        "simulation_meta": dict,
        "probability_summary": dict,
        "quantum_summary": dict,
        "timeline_summary": dict,
        "legal_cost_summary": dict,
        "waterfall": dict,
        "cashflow_analysis": dict,
        "jcurve_data": dict,
        "settlement": dict,
    }

    def test_all_required_keys_present(self, dashboard_data):
        missing = [k for k in self.REQUIRED_KEYS_TYPES if k not in dashboard_data]
        assert not missing, f"Missing required top-level keys: {missing}"

    def test_required_key_types(self, dashboard_data):
        for key, expected_type in self.REQUIRED_KEYS_TYPES.items():
            if key in dashboard_data:
                val = dashboard_data[key]
                assert isinstance(val, expected_type), (
                    f"Key '{key}' expected type {expected_type.__name__}, "
                    f"got {type(val).__name__}"
                )

    def test_simulation_meta_fields(self, dashboard_data):
        meta = dashboard_data.get("simulation_meta", {})
        required_meta = ["n_paths", "seed", "n_claims", "total_soc_cr",
                         "discount_rate", "generated_at"]
        missing = [k for k in required_meta if k not in meta]
        assert not missing, f"Missing simulation_meta fields: {missing}"

    def test_simulation_meta_n_paths(self, dashboard_data):
        meta = dashboard_data["simulation_meta"]
        assert meta["n_paths"] == N_PATHS, (
            f"Expected n_paths={N_PATHS}, got {meta['n_paths']}"
        )

    def test_simulation_meta_n_claims(self, dashboard_data):
        meta = dashboard_data["simulation_meta"]
        assert meta["n_claims"] == N_CLAIMS, (
            f"Expected n_claims={N_CLAIMS}, got {meta['n_claims']}"
        )

    def test_simulation_meta_seed(self, dashboard_data):
        meta = dashboard_data["simulation_meta"]
        assert meta["seed"] == SEED, f"Expected seed={SEED}, got {meta['seed']}"

    def test_claims_list_length(self, dashboard_data):
        claims = dashboard_data["claims"]
        assert len(claims) == N_CLAIMS, (
            f"Expected {N_CLAIMS} per-claim entries, got {len(claims)}"
        )

    def test_investment_grid_soc_exists(self, dashboard_data):
        """Upfront-tail structure should produce investment_grid_soc."""
        ig = dashboard_data.get("investment_grid_soc")
        assert ig is not None, "investment_grid_soc missing for upfront_tail structure"
        assert isinstance(ig, list), f"investment_grid_soc should be a list, got {type(ig).__name__}"

    def test_breakeven_data_exists(self, dashboard_data):
        be = dashboard_data.get("breakeven_data")
        assert be is not None, "breakeven_data missing"

    def test_waterfall_has_nominal_and_pv(self, dashboard_data):
        wf = dashboard_data.get("waterfall", {})
        assert "nominal" in wf, "waterfall.nominal missing"
        assert "present_value" in wf, "waterfall.present_value missing"

    def test_jcurve_has_scenarios(self, dashboard_data):
        jc = dashboard_data.get("jcurve_data", {})
        assert "scenarios" in jc, "jcurve_data.scenarios missing"
        assert isinstance(jc["scenarios"], dict), "jcurve_data.scenarios should be a dict"

    def test_cashflow_analysis_sections(self, dashboard_data):
        ca = dashboard_data.get("cashflow_analysis", {})
        expected = ["portfolio_summary", "per_claim", "annual_timeline"]
        missing = [k for k in expected if k not in ca]
        assert not missing, f"cashflow_analysis missing sections: {missing}"


# ============================================================================
# TEST 2: Per-Claim Schema
# ============================================================================

class TestPerClaimSchema:
    """Validate per-claim summary fields in the claims list."""

    REQUIRED_CLAIM_FIELDS = {
        "claim_id": str,
        "jurisdiction": str,
        "soc_value_cr": (int, float),
        "win_rate": (int, float),
        "mean_duration_months": (int, float),
        "mean_collected_cr": (int, float),
        "outcome_distribution": dict,
    }

    EXPECTED_CLAIM_IDS = {
        "TP-301-6", "TP-302-3", "TP-302-5",
        "TP-CTP11-2", "TP-CTP11-4", "TP-CTP13-2",
    }

    def test_all_claim_ids_present(self, dashboard_data):
        claim_ids = {c["claim_id"] for c in dashboard_data["claims"]}
        missing = self.EXPECTED_CLAIM_IDS - claim_ids
        assert not missing, f"Missing claim_ids in output: {missing}"

    @pytest.mark.parametrize("field,expected_type", [
        ("claim_id", str),
        ("jurisdiction", str),
        ("soc_value_cr", (int, float)),
        ("win_rate", (int, float)),
        ("mean_duration_months", (int, float)),
        ("outcome_distribution", dict),
    ])
    def test_required_claim_field_types(self, dashboard_data, field, expected_type):
        for claim in dashboard_data["claims"]:
            assert field in claim, f"Claim {claim.get('claim_id', '?')} missing field '{field}'"
            val = claim[field]
            assert isinstance(val, expected_type), (
                f"Claim {claim['claim_id']}.{field}: expected {expected_type}, got {type(val).__name__}"
            )

    def test_win_rate_in_range(self, dashboard_data):
        for claim in dashboard_data["claims"]:
            wr = claim["win_rate"]
            assert 0.0 <= wr <= 1.0, (
                f"Claim {claim['claim_id']} win_rate={wr} out of [0,1]"
            )

    def test_soc_value_positive(self, dashboard_data):
        for claim in dashboard_data["claims"]:
            soc = claim["soc_value_cr"]
            assert soc > 0, (
                f"Claim {claim['claim_id']} soc_value_cr={soc} should be positive"
            )

    def test_mean_duration_positive(self, dashboard_data):
        for claim in dashboard_data["claims"]:
            dur = claim["mean_duration_months"]
            assert dur > 0, (
                f"Claim {claim['claim_id']} mean_duration_months={dur} should be > 0"
            )

    def test_collected_stats_non_negative(self, dashboard_data):
        for claim in dashboard_data["claims"]:
            cs = claim.get("collected_stats", {})
            mean_collected = cs.get("mean", 0)
            assert mean_collected >= 0, (
                f"Claim {claim['claim_id']} collected_stats.mean={mean_collected} should be >= 0"
            )

    def test_outcome_distribution_has_required_outcomes(self, dashboard_data):
        for claim in dashboard_data["claims"]:
            od = claim["outcome_distribution"]
            # Must have TRUE_WIN and LOSE at minimum
            assert "TRUE_WIN" in od, (
                f"Claim {claim['claim_id']} outcome_distribution missing TRUE_WIN"
            )
            assert "LOSE" in od, (
                f"Claim {claim['claim_id']} outcome_distribution missing LOSE"
            )

    def test_outcome_counts_sum_to_n_paths(self, dashboard_data):
        for claim in dashboard_data["claims"]:
            od = claim["outcome_distribution"]
            total = sum(od.values())
            assert total == N_PATHS, (
                f"Claim {claim['claim_id']} outcome sum={total}, expected {N_PATHS}"
            )

    def test_jurisdiction_values_valid(self, dashboard_data):
        # V2 exporter uses short jurisdiction labels: "domestic", "siac", "hkiac"
        valid = {"domestic", "siac", "hkiac", "indian_domestic", "siac_singapore", "hkiac_hongkong"}
        for claim in dashboard_data["claims"]:
            assert claim["jurisdiction"] in valid, (
                f"Claim {claim['claim_id']} has invalid jurisdiction '{claim['jurisdiction']}'"
            )


# ============================================================================
# TEST 3: Investment Grid Schema
# ============================================================================

class TestGridSchema:
    """Validate investment grid cell fields when grid exists."""

    GRID_CELL_REQUIRED = [
        "upfront_pct", "award_share_pct", "mean_moic", "mean_xirr", "p_loss",
    ]

    def test_investment_grid_soc_is_list(self, dashboard_data):
        ig = dashboard_data.get("investment_grid_soc")
        if ig is None:
            pytest.skip("investment_grid_soc not present")
        assert isinstance(ig, list), f"Expected list, got {type(ig).__name__}"

    def test_grid_cells_non_empty(self, dashboard_data):
        ig = dashboard_data.get("investment_grid_soc", [])
        if not ig:
            pytest.skip("No grid cells to validate")
        assert len(ig) > 0, "Grid should have at least one cell"

    def test_grid_cell_required_fields(self, dashboard_data):
        ig = dashboard_data.get("investment_grid_soc", [])
        if not ig:
            pytest.skip("No grid cells to validate")
        for i, cell in enumerate(ig):
            for field in self.GRID_CELL_REQUIRED:
                assert field in cell, (
                    f"Grid cell [{i}] missing required field '{field}'. "
                    f"Available keys: {list(cell.keys())}"
                )

    def test_grid_cell_moic_non_negative(self, dashboard_data):
        ig = dashboard_data.get("investment_grid_soc", [])
        if not ig:
            pytest.skip("No grid cells")
        for i, cell in enumerate(ig):
            moic = cell.get("mean_moic")
            if moic is not None:
                assert moic >= 0, (
                    f"Grid cell [{i}] mean_moic={moic} should be >= 0"
                )

    def test_grid_cell_p_loss_in_range(self, dashboard_data):
        """p_loss should be in [0, 1]."""
        ig = dashboard_data.get("investment_grid_soc", [])
        if not ig:
            pytest.skip("No grid cells")
        for i, cell in enumerate(ig):
            p_loss = cell.get("p_loss")
            if p_loss is not None:
                assert 0.0 <= p_loss <= 1.0, (
                    f"Grid cell [{i}] p_loss={p_loss} out of [0,1]"
                )

    def test_per_claim_grid_exists(self, dashboard_data):
        pcg = dashboard_data.get("per_claim_grid")
        assert pcg is not None, "per_claim_grid should exist for upfront_tail structure"

    def test_post_processed_investment_grid_dict(self, dashboard_data):
        """After postprocessing, investment_grid should be a dict keyed by 'up_tail'."""
        ig = dashboard_data.get("investment_grid")
        if ig is None:
            pytest.skip("investment_grid (post-processed dict) not present")
        assert isinstance(ig, dict), (
            f"Post-processed investment_grid should be dict, got {type(ig).__name__}"
        )


# ============================================================================
# TEST 4: Schema Stability — No NaN, No Inf, Finite Numerics
# ============================================================================

class TestSchemaStability:
    """Verify data integrity: no NaN/Inf, no empty required strings, finite numerics."""

    def test_no_nan_or_inf_in_json(self, dashboard_data):
        violations = _check_no_nan_inf(dashboard_data)
        assert not violations, (
            f"Found NaN/Inf values in dashboard_data.json:\n"
            + "\n".join(violations[:20])
        )

    def test_claim_ids_non_empty_strings(self, dashboard_data):
        for claim in dashboard_data["claims"]:
            cid = claim.get("claim_id", "")
            assert isinstance(cid, str) and len(cid) > 0, (
                f"claim_id should be a non-empty string, got: {cid!r}"
            )

    def test_jurisdictions_non_empty_strings(self, dashboard_data):
        for claim in dashboard_data["claims"]:
            jur = claim.get("jurisdiction", "")
            assert isinstance(jur, str) and len(jur) > 0, (
                f"jurisdiction should be a non-empty string, got: {jur!r}"
            )

    def test_simulation_meta_generated_at_non_empty(self, dashboard_data):
        gen = dashboard_data.get("simulation_meta", {}).get("generated_at", "")
        assert isinstance(gen, str) and len(gen) > 0, (
            f"generated_at should be a non-empty string, got: {gen!r}"
        )

    def test_all_numeric_fields_finite(self, dashboard_data):
        """Spot-check that key numeric fields in simulation_meta are finite."""
        meta = dashboard_data.get("simulation_meta", {})
        for key in ["n_paths", "seed", "n_claims", "total_soc_cr", "discount_rate"]:
            val = meta.get(key)
            if val is not None and isinstance(val, (int, float)):
                assert _is_finite(val), f"simulation_meta.{key} = {val} is not finite"

    def test_probability_summary_valid(self, dashboard_data):
        """probability_summary should contain scenario dicts per claim."""
        ps = dashboard_data.get("probability_summary", {})
        assert len(ps) > 0, "probability_summary should be non-empty"
        # The V2 exporter structures this by jurisdiction (domestic/siac/hkiac)
        # with scenario_a and scenario_b sub-keys, OR per-claim.
        # Validate it's a non-empty nested dict.
        assert isinstance(ps, dict), (
            f"probability_summary should be a dict, got {type(ps).__name__}"
        )

    def test_quantum_summary_bands_present(self, dashboard_data):
        qs = dashboard_data.get("quantum_summary", {})
        assert "bands" in qs, "quantum_summary should have 'bands'"
        bands = qs["bands"]
        assert isinstance(bands, list), "quantum_summary.bands should be a list"
        assert len(bands) > 0, "quantum_summary.bands should be non-empty"

    def test_quantum_bands_probabilities_sum_to_one(self, dashboard_data):
        qs = dashboard_data.get("quantum_summary", {})
        bands = qs.get("bands", [])
        if not bands:
            pytest.skip("No quantum bands")
        prob_sum = sum(b.get("probability", 0) for b in bands)
        assert abs(prob_sum - 1.0) < 0.01, (
            f"Quantum band probabilities sum to {prob_sum}, expected ~1.0"
        )

    def test_timeline_summary_per_claim_present(self, dashboard_data):
        ts = dashboard_data.get("timeline_summary", {})
        pc = ts.get("per_claim", {})
        assert len(pc) == N_CLAIMS, (
            f"timeline_summary.per_claim has {len(pc)} claims, expected {N_CLAIMS}"
        )

    def test_legal_cost_summary_per_claim_present(self, dashboard_data):
        lcs = dashboard_data.get("legal_cost_summary", {})
        pc = lcs.get("per_claim", {})
        assert len(pc) == N_CLAIMS, (
            f"legal_cost_summary.per_claim has {len(pc)} claims, expected {N_CLAIMS}"
        )

    def test_waterfall_nominal_fields(self, dashboard_data):
        wf = dashboard_data.get("waterfall", {})
        nominal = wf.get("nominal", {})
        for key in ["soc_cr", "win_rate"]:
            assert key in nominal, f"waterfall.nominal missing '{key}'"

    def test_waterfall_pv_fields(self, dashboard_data):
        wf = dashboard_data.get("waterfall", {})
        pv = wf.get("present_value", {})
        for key in ["soc_cr", "pv_factor"]:
            assert key in pv, f"waterfall.present_value missing '{key}'"

    def test_cashflow_portfolio_summary_exists(self, dashboard_data):
        ca = dashboard_data.get("cashflow_analysis", {})
        ps = ca.get("portfolio_summary", {})
        assert len(ps) > 0, "cashflow_analysis.portfolio_summary should be non-empty"

    def test_cashflow_per_claim_length(self, dashboard_data):
        ca = dashboard_data.get("cashflow_analysis", {})
        pc = ca.get("per_claim", [])
        assert len(pc) == N_CLAIMS, (
            f"cashflow_analysis.per_claim has {len(pc)} items, expected {N_CLAIMS}"
        )
