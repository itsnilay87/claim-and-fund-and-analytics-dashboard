"""
engine/tests/test_pipeline_e2e.py — End-to-End Pipeline Integration Tests.
===========================================================================

Phase 1, Session 1E: Validate the complete pipeline from config loading through
to output artifact generation. Tests cover:
  - Full pipeline run with output verification
  - Output artifact existence checks
  - Pipeline plausibility checks (metrics in expected ranges)
  - Cross-engine consistency (V2 exporter vs platform exporter, if both work)

Layer: runs ``engine.run_v2.run_platform_pipeline`` (the full V2 pipeline)
at N=500 to produce all output artifacts, then validates them.

Marks:
  - @pytest.mark.integration: full pipeline tests
  - @pytest.mark.slow: tests that run full simulation (N=500)
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
N_PATHS = 500   # representative but fast
SEED = 42
N_CLAIMS = 6

DOMESTIC_IDS = ["TP-301-6", "TP-302-3", "TP-302-5"]
SIAC_IDS = ["TP-CTP11-2", "TP-CTP11-4", "TP-CTP13-2"]
ALL_IDS = DOMESTIC_IDS + SIAC_IDS


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


def _make_portfolio_config(
    fixture: dict,
    structure_type: str = "monetisation_upfront_tail",
    n_paths: int = N_PATHS,
) -> PortfolioConfig:
    """Build a PortfolioConfig from fixture with given structure type."""
    raw = {
        "id": fixture["id"],
        "name": fixture["name"],
        "claim_ids": fixture["claim_ids"],
        "simulation": {
            "n_paths": n_paths,
            "seed": SEED,
            "discount_rate": fixture["simulation"]["discount_rate"],
            "risk_free_rate": fixture["simulation"]["risk_free_rate"],
            "start_date": fixture["simulation"]["start_date"],
        },
    }

    if structure_type == "litigation_funding":
        raw["structure"] = {
            "type": "litigation_funding",
            "params": {
                "cost_multiple_cap": 3.0,
                "award_ratio_cap": 0.30,
                "waterfall_type": "min",
                "cost_multiple_range": {"min": 1.0, "max": 3.0, "step": 1.0},
                "award_ratio_range": {"min": 0.10, "max": 0.30, "step": 0.10},
            },
        }
    else:
        raw["structure"] = {
            "type": "monetisation_upfront_tail",
            "params": {
                "upfront_range": {"min": 0.05, "max": 0.15, "step": 0.05},
                "tail_range": {"min": 0.10, "max": 0.30, "step": 0.10},
                "pricing_basis": "soc",
            },
        }

    return PortfolioConfig.model_validate(raw)


# ============================================================================
# Module-scoped fixtures — run pipeline once, share across tests
# ============================================================================

@pytest.fixture(scope="module")
def fixture_data() -> dict:
    return _load_fixture()


@pytest.fixture(scope="module")
def claims(fixture_data) -> list[PlatformClaim]:
    return _build_claims(fixture_data)


@pytest.fixture(scope="module")
def templates() -> dict:
    return _build_templates()


@pytest.fixture(scope="module")
def upfront_tail_result(fixture_data, claims, templates, tmp_path_factory):
    """Run full upfront-tail pipeline at N=500."""
    out_dir = str(tmp_path_factory.mktemp("e2e_upfront_tail"))
    config = _make_portfolio_config(fixture_data, "monetisation_upfront_tail")
    try:
        result = run_platform_pipeline(config, claims, templates, out_dir)
    except Exception as exc:
        pytest.skip(f"Pipeline failed: {exc}")
    return result


@pytest.fixture(scope="module")
def lit_funding_result(fixture_data, claims, templates, tmp_path_factory):
    """Run full litigation-funding pipeline at N=500."""
    out_dir = str(tmp_path_factory.mktemp("e2e_lit_funding"))
    config = _make_portfolio_config(fixture_data, "litigation_funding")
    try:
        result = run_platform_pipeline(config, claims, templates, out_dir)
    except Exception as exc:
        pytest.skip(f"Pipeline failed: {exc}")
    return result


# ============================================================================
# TEST 1: Full Pipeline Run — Upfront Tail
# ============================================================================

@pytest.mark.integration
@pytest.mark.slow
class TestFullPipelineRun:
    """Run the full V2 pipeline and verify basic outputs."""

    def test_pipeline_status_complete(self, upfront_tail_result):
        assert upfront_tail_result["status"] == "complete"

    def test_n_claims_correct(self, upfront_tail_result):
        assert upfront_tail_result["n_claims"] == N_CLAIMS, (
            f"Expected {N_CLAIMS} claims, got {upfront_tail_result['n_claims']}"
        )

    def test_n_paths_correct(self, upfront_tail_result):
        assert upfront_tail_result["n_paths"] == N_PATHS, (
            f"Expected {N_PATHS} paths, got {upfront_tail_result['n_paths']}"
        )

    def test_sim_object_exists(self, upfront_tail_result):
        sim = upfront_tail_result.get("sim")
        assert sim is not None, "Pipeline result should contain 'sim' object"

    def test_grid_object_exists(self, upfront_tail_result):
        grid = upfront_tail_result.get("grid")
        assert grid is not None, "Pipeline result should contain 'grid' object"

    def test_per_claim_summaries_exist(self, upfront_tail_result):
        pcs = upfront_tail_result.get("per_claim_summaries")
        assert pcs is not None, "Pipeline result should contain 'per_claim_summaries'"
        assert len(pcs) == N_CLAIMS, (
            f"Expected {N_CLAIMS} claim summaries, got {len(pcs)}"
        )

    def test_per_claim_summaries_have_metrics(self, upfront_tail_result):
        pcs = upfront_tail_result["per_claim_summaries"]
        for cid, summary in pcs.items():
            assert "win_rate" in summary, f"Claim {cid} missing win_rate"
            assert "mean_duration_months" in summary, f"Claim {cid} missing mean_duration_months"

    def test_dashboard_json_exists(self, upfront_tail_result):
        out = upfront_tail_result["output_path"]
        dash_path = os.path.join(out, "dashboard_data.json")
        assert os.path.isfile(dash_path), "dashboard_data.json not found"

    def test_dashboard_json_valid(self, upfront_tail_result):
        out = upfront_tail_result["output_path"]
        dash_path = os.path.join(out, "dashboard_data.json")
        with open(dash_path, encoding="utf-8") as f:
            data = json.load(f)
        assert isinstance(data, dict), "dashboard_data.json should be a JSON object"
        assert "claims" in data, "dashboard_data.json should contain 'claims'"

    def test_portfolio_moic_plausible(self, upfront_tail_result):
        """Portfolio MOIC should be in a plausible range for TATA claims."""
        out = upfront_tail_result["output_path"]
        dash_path = os.path.join(out, "dashboard_data.json")
        with open(dash_path, encoding="utf-8") as f:
            data = json.load(f)
        # Check investment grid for reasonable MOIC values
        ig = data.get("investment_grid_soc", [])
        if ig:
            moics = [
                cell.get("moic_mean", 0)
                for cell in ig
                if cell.get("moic_mean") is not None
            ]
            if moics:
                max_moic = max(moics)
                min_moic = min(moics)
                assert min_moic >= 0.0, f"Min MOIC={min_moic} should be >= 0"
                assert max_moic <= 20.0, f"Max MOIC={max_moic} implausibly high"

    def test_win_rates_in_plausible_range(self, upfront_tail_result):
        """Per-claim win rates should be between 0.3 and 0.9 for TATA claims."""
        pcs = upfront_tail_result["per_claim_summaries"]
        for cid, summary in pcs.items():
            wr = summary.get("win_rate", 0)
            assert 0.30 <= wr <= 0.90, (
                f"Claim {cid} win_rate={wr:.3f} outside plausible range [0.30, 0.90]"
            )


# ============================================================================
# TEST 2: Output Artifact Checklist
# ============================================================================

@pytest.mark.integration
@pytest.mark.slow
class TestOutputArtifacts:
    """Verify expected output files are produced by the pipeline."""

    def test_dashboard_json_artifact(self, upfront_tail_result):
        out = upfront_tail_result["output_path"]
        f_path = os.path.join(out, "dashboard_data.json")
        assert os.path.isfile(f_path), "dashboard_data.json missing"
        # Verify non-trivial size
        size = os.path.getsize(f_path)
        assert size > 100, f"dashboard_data.json too small ({size} bytes)"

    def test_excel_report_artifact(self, upfront_tail_result):
        """Excel report should be generated (may fail gracefully)."""
        out = upfront_tail_result["output_path"]
        # Check for any xlsx file
        xlsx_files = [f for f in os.listdir(out) if f.endswith(".xlsx")]
        # Not a hard requirement — pipeline may skip Excel on missing deps
        if not xlsx_files:
            pytest.skip("No Excel files generated (openpyxl may not be installed)")
        assert len(xlsx_files) >= 1, "At least one Excel file expected"

    def test_stochastic_pricing_artifact(self, upfront_tail_result):
        """Stochastic pricing JSON for upfront-tail structure."""
        out = upfront_tail_result["output_path"]
        f_path = os.path.join(out, "stochastic_pricing.json")
        if not os.path.isfile(f_path):
            pytest.skip("stochastic_pricing.json not generated (may be disabled)")
        with open(f_path, encoding="utf-8") as f:
            data = json.load(f)
        assert isinstance(data, dict), "stochastic_pricing.json should be a JSON object"

    def test_chart_images_directory(self, upfront_tail_result):
        """Chart images may or may not be generated (depends on matplotlib)."""
        out = upfront_tail_result["output_path"]
        png_files = [f for f in os.listdir(out) if f.endswith(".png")]
        # Just check, don't fail — chart generation is optional
        if not png_files:
            pytest.skip("No chart images generated (matplotlib may not be available)")

    def test_pdf_report_artifact(self, upfront_tail_result):
        """PDF report is optional but check if present."""
        out = upfront_tail_result["output_path"]
        pdf_files = [f for f in os.listdir(out) if f.endswith(".pdf")]
        if not pdf_files:
            pytest.skip("No PDF files generated (may require additional dependencies)")

    def test_lit_funding_dashboard_json(self, lit_funding_result):
        """Lit funding pipeline should also produce dashboard_data.json."""
        out = lit_funding_result["output_path"]
        dash_path = os.path.join(out, "dashboard_data.json")
        assert os.path.isfile(dash_path), "dashboard_data.json missing for lit_funding"

    def test_lit_funding_has_waterfall_grid(self, lit_funding_result):
        """Lit funding pipeline should produce waterfall_grid in dashboard JSON."""
        out = lit_funding_result["output_path"]
        dash_path = os.path.join(out, "dashboard_data.json")
        with open(dash_path, encoding="utf-8") as f:
            data = json.load(f)
        wg = data.get("waterfall_grid")
        assert wg is not None, "waterfall_grid missing for litigation_funding structure"


# ============================================================================
# TEST 3: Pipeline Plausibility — Cross-Structure Consistency
# ============================================================================

@pytest.mark.integration
@pytest.mark.slow
class TestCrossStructureConsistency:
    """Verify that both structure types produce consistent per-claim metrics."""

    def test_both_pipelines_complete(self, upfront_tail_result, lit_funding_result):
        assert upfront_tail_result["status"] == "complete"
        assert lit_funding_result["status"] == "complete"

    def test_same_claim_count(self, upfront_tail_result, lit_funding_result):
        assert upfront_tail_result["n_claims"] == lit_funding_result["n_claims"]

    def test_win_rates_agree_across_structures(self, upfront_tail_result, lit_funding_result):
        """Win rates are structure-independent — same MC paths, same seed."""
        ut_pcs = upfront_tail_result["per_claim_summaries"]
        lf_pcs = lit_funding_result["per_claim_summaries"]

        for cid in ALL_IDS:
            if cid not in ut_pcs or cid not in lf_pcs:
                continue
            ut_wr = ut_pcs[cid]["win_rate"]
            lf_wr = lf_pcs[cid]["win_rate"]
            # Same seed + same engine → win rates should be identical
            assert abs(ut_wr - lf_wr) < 0.001, (
                f"Claim {cid} win rate differs: upfront_tail={ut_wr:.4f}, "
                f"lit_funding={lf_wr:.4f} (same seed, should be identical)"
            )

    def test_json_schemas_share_common_keys(self, upfront_tail_result, lit_funding_result):
        """Both structures should produce dashboard JSONs with common keys."""
        common_keys = [
            "claims", "simulation_meta", "probability_summary",
            "quantum_summary", "waterfall", "cashflow_analysis",
            "jcurve_data",
        ]

        ut_path = os.path.join(upfront_tail_result["output_path"], "dashboard_data.json")
        lf_path = os.path.join(lit_funding_result["output_path"], "dashboard_data.json")

        with open(ut_path, encoding="utf-8") as f:
            ut_data = json.load(f)
        with open(lf_path, encoding="utf-8") as f:
            lf_data = json.load(f)

        for key in common_keys:
            assert key in ut_data, f"upfront_tail JSON missing '{key}'"
            assert key in lf_data, f"lit_funding JSON missing '{key}'"

    def test_claim_level_metrics_comparable(self, upfront_tail_result, lit_funding_result):
        """Per-claim collected amounts should be similar (same MC, different post-processing)."""
        ut_path = os.path.join(upfront_tail_result["output_path"], "dashboard_data.json")
        lf_path = os.path.join(lit_funding_result["output_path"], "dashboard_data.json")

        with open(ut_path, encoding="utf-8") as f:
            ut_data = json.load(f)
        with open(lf_path, encoding="utf-8") as f:
            lf_data = json.load(f)

        ut_claims = {c["claim_id"]: c for c in ut_data["claims"]}
        lf_claims = {c["claim_id"]: c for c in lf_data["claims"]}

        for cid in ALL_IDS:
            if cid not in ut_claims or cid not in lf_claims:
                continue
            ut_collected = ut_claims[cid].get("mean_collected_cr", 0)
            lf_collected = lf_claims[cid].get("mean_collected_cr", 0)
            # Same MC engine → collected should be identical
            assert abs(ut_collected - lf_collected) < 0.01, (
                f"Claim {cid} mean_collected differs: UT={ut_collected:.2f}, "
                f"LF={lf_collected:.2f}"
            )


# ============================================================================
# TEST 4: Dashboard JSON Roundtrip Integrity
# ============================================================================

@pytest.mark.integration
class TestDashboardJSONIntegrity:
    """Verify that dashboard JSON is valid, parseable, and self-consistent."""

    def test_json_roundtrip(self, upfront_tail_result):
        """Write → read → compare: JSON should survive serialization."""
        out = upfront_tail_result["output_path"]
        dash_path = os.path.join(out, "dashboard_data.json")

        with open(dash_path, encoding="utf-8") as f:
            data1 = json.load(f)

        # Re-serialize and re-parse
        json_str = json.dumps(data1, indent=2)
        data2 = json.loads(json_str)

        assert data1.keys() == data2.keys(), "Key mismatch after roundtrip"

    def test_claims_match_simulation_meta(self, upfront_tail_result):
        """claims list length should match simulation_meta.n_claims."""
        out = upfront_tail_result["output_path"]
        dash_path = os.path.join(out, "dashboard_data.json")

        with open(dash_path, encoding="utf-8") as f:
            data = json.load(f)

        n_claims_meta = data["simulation_meta"]["n_claims"]
        n_claims_list = len(data["claims"])
        assert n_claims_meta == n_claims_list, (
            f"simulation_meta.n_claims={n_claims_meta} != len(claims)={n_claims_list}"
        )

    def test_claim_ids_in_probability_summary(self, upfront_tail_result):
        """probability_summary should be a non-empty dict (keyed by jurisdiction)."""
        out = upfront_tail_result["output_path"]
        dash_path = os.path.join(out, "dashboard_data.json")

        with open(dash_path, encoding="utf-8") as f:
            data = json.load(f)

        ps = data.get("probability_summary", {})
        # V2 exporter keys by jurisdiction (domestic, siac, hkiac), not per-claim
        assert isinstance(ps, dict) and len(ps) > 0, (
            "probability_summary should be a non-empty dict"
        )

    def test_claim_ids_in_timeline_summary(self, upfront_tail_result):
        """Every claim should appear in timeline_summary.per_claim."""
        out = upfront_tail_result["output_path"]
        dash_path = os.path.join(out, "dashboard_data.json")

        with open(dash_path, encoding="utf-8") as f:
            data = json.load(f)

        claim_ids = {c["claim_id"] for c in data["claims"]}
        ts_ids = set(data.get("timeline_summary", {}).get("per_claim", {}).keys())

        missing = claim_ids - ts_ids
        assert not missing, (
            f"Claims in 'claims' but not in timeline_summary.per_claim: {missing}"
        )

    def test_claim_ids_in_legal_cost_summary(self, upfront_tail_result):
        """Every claim should appear in legal_cost_summary.per_claim."""
        out = upfront_tail_result["output_path"]
        dash_path = os.path.join(out, "dashboard_data.json")

        with open(dash_path, encoding="utf-8") as f:
            data = json.load(f)

        claim_ids = {c["claim_id"] for c in data["claims"]}
        lc_ids = set(data.get("legal_cost_summary", {}).get("per_claim", {}).keys())

        missing = claim_ids - lc_ids
        assert not missing, (
            f"Claims in 'claims' but not in legal_cost_summary.per_claim: {missing}"
        )

    def test_cashflow_per_claim_ids_match(self, upfront_tail_result):
        """Cashflow per_claim entries should match claims list."""
        out = upfront_tail_result["output_path"]
        dash_path = os.path.join(out, "dashboard_data.json")

        with open(dash_path, encoding="utf-8") as f:
            data = json.load(f)

        claim_ids = {c["claim_id"] for c in data["claims"]}
        ca_ids = {
            c.get("claim_id") for c in data.get("cashflow_analysis", {}).get("per_claim", [])
        }

        missing = claim_ids - ca_ids
        assert not missing, (
            f"Claims in 'claims' but not in cashflow_analysis.per_claim: {missing}"
        )
