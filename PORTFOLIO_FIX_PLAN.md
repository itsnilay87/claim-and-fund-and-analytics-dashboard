# Portfolio Analytics Fix Plan — v2.1

## Date: 2026-04-16
## Status: IMPLEMENTED + VERIFIED

---

## Executive Summary

This plan addresses critical bugs in the portfolio monetisation analysis pipeline discovered during ORIGO Portfolio Monetisation testing. The issues span the full stack: Python engine (IRR methodology, missing concentration data), Node.js server (config enrichment), and React dashboard (missing claim names, empty chart sections).

---

## Bug Inventory

### BUG-1: INCORRECT E[IRR] METHODOLOGY (CRITICAL — Mathematical Error) ✅ FIXED

**Status:** FIXED (2026-04-16)

**Symptom:** E[IRR] displays -15.8% for a portfolio that shows E[MOIC] of 2.30x — mathematically inconsistent.

**Root Cause:** The system computed per-path IRRs (including -100% for total-loss paths) and then took the arithmetic mean. Paths where the portfolio loses everything return IRR = -1.0, which severely skewed the mean downward.

**Fix Applied — Expected Cashflow IRR:**
1. Added `compute_expected_cashflow_irr()` to `engine/analysis/risk_metrics.py`
2. For each date point across all MC paths, computes the arithmetic mean cashflow (expected cashflow)
3. Computes XIRR on the resulting expected cashflow stream
4. Added `expected_xirr` field to `GridCellMetrics` in both `engine/v2_core/v2_investment_analysis.py` (dataclass) and `engine/config/schema.py` (Pydantic model)
5. Updated `_postprocess_dashboard_json()` in `engine/run_v2.py` to use `expected_xirr` as primary E[IRR] display value
6. Updated `_build_grid_section()` in `engine/export/json_exporter.py` to include `expected_xirr` in every grid cell
7. Updated `engine/analysis/investment_grid.py` and `engine/analysis/waterfall_analysis.py` with expected-cashflow IRR computation
8. `mean_xirr` retained for backward compatibility and comparison

**Files Changed:**
- `engine/analysis/risk_metrics.py` — Added `compute_expected_cashflow_irr()`, included in `compute_portfolio_risk()` return
- `engine/v2_core/v2_investment_analysis.py` — Added `expected_xirr` to dataclass, computed in `_compute_grid_cell()`
- `engine/config/schema.py` — Added `expected_xirr` field to Pydantic `GridCellMetrics`
- `engine/run_v2.py` — IRR display uses `expected_xirr`, added `expected_irr` to `mc_distributions`
- `engine/export/json_exporter.py` — Grid section exports `expected_xirr`
- `engine/analysis/investment_grid.py` — Added expected-cashflow IRR to grid cells
- `engine/analysis/waterfall_analysis.py` — Added expected-cashflow IRR to waterfall cells

**Tests Added:**
- `engine/tests/test_expected_irr.py` — 8 tests covering: no-loss-skew, MOIC consistency, all-win, all-loss, multi-claim portfolio, staggered timing, single path, high-loss-probability

**Validation:** E[IRR] for portfolio with E[MOIC]=2.30x / ~5yr should now show ~15-25% instead of -15.8%

### BUG-2: MISSING JURISDICTION & CLAIM TYPE BREAKDOWNS (HIGH) ✅ FIXED

**Status:** FIXED (2026-04-16)

**Symptom:** Dashboard shows "No jurisdiction data" and "No type data" in Executive Summary charts (see screenshot arrows).

**Root Cause:** The `_compute_concentration()` function in `risk_metrics.py` correctly computes breakdowns, but the data isn't reaching the dashboard JSON properly. Two failure paths:
1. `_postprocess_dashboard_json()` in `run_v2.py` **overwrites** the `risk.concentration` section with only `mean_p_loss`, dropping the `jurisdiction_breakdown` and `type_breakdown` computed by `risk_metrics.py`
2. Claims may have empty `jurisdiction` or `claim_type` fields if the frontend doesn't send them

**Fix Applied:**
1. Updated `engine/run_v2.py` (`_postprocess_dashboard_json`) to merge with existing `risk` payload instead of replacing it, preserving concentration breakdowns from upstream risk computation.
2. Updated `engine/analysis/risk_metrics.py` (`_compute_concentration`) to default missing `jurisdiction` to `unknown` and missing `claim_type` to `unclassified`, with warning logs.
3. Updated `engine/export/json_exporter.py` to normalize the exported `risk.concentration` payload to a stable schema with required concentration keys.

**Files Changed:**
| File | Change |
|------|--------|
| `engine/run_v2.py` (`_postprocess_dashboard_json`) | Merged `risk` payload and preserved existing concentration breakdown fields |
| `engine/analysis/risk_metrics.py` | Added defensive defaults + warning logging for missing jurisdiction/claim_type |
| `engine/export/json_exporter.py` | Normalized `risk.concentration` schema in exported dashboard JSON |

### BUG-3: CLAIM NAMES NOT APPEARING IN TABS (HIGH) ✅ FIXED

**Status:** FIXED (2026-04-16)

**Symptom:** Several dashboard tabs show UUIDs or "N/A" instead of human-readable claim names.

**Root Cause:** The `getClaimDisplayName()` utility checks `claim.name`, `claim.claim_id`, and `claim.archetype` — but some tabs pass different object shapes that don't match these keys.

**Fix Applied:**
1. Updated `engine/v2_core/v2_investment_analysis.py` to include `claim_id` and `name` in each per-claim contribution payload.
2. Updated `engine/run_v2.py` postprocessing to build `claim_name_map` from `claims[]`, enrich `cashflow_analysis.per_claim` and `per_claim_breakdowns` with names, and add `investment_grid[*].per_claim_contributions` with names.
3. Updated `engine/export/json_exporter.py` to include `name` fields across per-claim sections (`cashflow_analysis`, `quantum_summary`, `timeline_summary`, `legal_cost_summary`, and grid `per_claim`).
4. Updated `engine/adapter.py` to populate `SimulationResults.claim_name_map` for downstream usage.

**Files Changed:**
| File | Change |
|------|--------|
| `engine/v2_core/v2_investment_analysis.py` | Added claim `name` and `claim_id` in per-claim contribution data |
| `engine/export/json_exporter.py` | Ensure `name` field is always populated in every claim reference throughout the JSON |
| `engine/run_v2.py` | Ensure claim name propagation in all sections (cashflow_analysis.per_claim, per_claim_contributions, etc.) |
| `engine/adapter.py` | Added `sim.claim_name_map` to carry names through merged simulation results |

### BUG-4: HARDCODED REFERENCE DEAL (MEDIUM) ✅ FIXED

**Status:** FIXED (2026-04-16)

**Symptom:** mc_distributions always use 10% upfront / 20% tail regardless of user-selected parameters.

**Root Cause:** `_postprocess_dashboard_json()` hardcodes `ref_upfront_pct = 0.10` and `ref_tata_tail = 0.20`.

**Fix Applied:**
- Updated `engine/run_v2.py` to thread `portfolio_config` through `_postprocess_dashboard_json()`.
- Replaced hardcoded `10/20` reference-cell logic with dynamic user-selected `upfront_range.min` / `tail_range.min` (with safe defaults).
- Updated `mc_distributions` per-path calculations to use user-selected upfront/tail values.
- Updated fallback stochastic histogram reference combo to use the same dynamic reference key.
- Threaded `portfolio_config` through `run_platform_pipeline()` → `_run_analysis_and_export()` → `_postprocess_dashboard_json()`.

**Files Changed:**
| File | Change |
|------|--------|
| `engine/run_v2.py` | Read actual upfront/tail from `portfolio_config.structure.params` instead of hardcoding |
| `engine/v2_core/v2_json_exporter.py` | Pass user-selected upfront/tail to J-curve generation as the default scenario |
| `engine/export/json_exporter.py` | Updated legacy exporter to use same dynamic config behavior |

### BUG-5: J-CURVE FAN CHART DATA (LOW-MEDIUM) ✅ FIXED

**Status:** FIXED (2026-04-16)

**Symptom:** J-curve shows flat median line at zero for extended period, with percentile bands appearing only near end.

**Root Cause:** Hardcoded `max_months = 96` and legal cost burn assumptions (30%/70% split) may not match actual claim timelines. Also, the J-curve uses hardcoded upfront/tail scenarios rather than user-selected values.

**Fix Applied:**
- Updated J-curve builders to derive `max_months` from claim/path horizon data instead of hardcoding `96`.
- Ensured user-selected upfront/tail combo is included in scenario grids.
- Set `jcurve_data.default_key` dynamically to the selected user combo.
- Added support for configurable legal-cost split inputs in the legacy exporter with safe fallback behavior.

**Files Changed:**
| File | Change |
|------|--------|
| `engine/export/json_exporter.py` | Derive `max_months` from actual claim timelines; use user-selected upfront/tail as default scenario |
| `engine/v2_core/v2_json_exporter.py` | Derive `max_months` from simulated path durations/claim metadata; default combo now user-selected |

---

## Implementation Phases

### Phase 1: Engine Fixes (Python — Backend Mathematical Corrections)
- Fix IRR methodology (BUG-1)
- Fix concentration data propagation (BUG-2 backend)
- Fix claim name propagation (BUG-3 backend)
- Remove hardcoded reference deal (BUG-4)
- Add comprehensive tests

### Phase 2: Server Validation (Node.js — Config Enrichment)
- Validate claim fields in enrichClaimConfig (BUG-2, BUG-3)
- Add logging for missing fields

### PROMPT-4: Server Validation & Config Enrichment (Node.js) ✅ FIXED

**Status:** FIXED (2026-04-16)

**Scope implemented:**
1. Strengthened `enrichClaimConfig()` in `server/routes/simulate.js`:
	- Defaults missing/blank `jurisdiction` to `indian_domestic` with warning log.
	- Defaults missing/blank `claim_type` to `prolongation` with warning log.
	- Backfills missing/blank `name` from `archetype` → `claimant` → short ID with warning log.
	- Logs an explicit error when `soc_value_cr` is missing/invalid (no silent default).
2. Added portfolio structure validation for `monetisation_upfront_tail`:
	- Ensures `upfront_range` or `upfront_pct` is present.
	- Ensures `tail_range` or `tail_pct` is present.
	- Applies safe defaults (`0.05-0.30`, `0.10-0.40`) when missing.
3. Added structured portfolio request logging in `POST /api/simulate/portfolio`:
	- Logs portfolio name, structure type, claim count, claim IDs, and upfront/tail params.
4. Verified engine config handoff path remains intact:
	- `simulationRunner.startRun()` writes full run `config.json`.
	- `engine/run_v2.py` reads full JSON and parses portfolio structure params from it.
5. Added server-side tests in `server/tests/simulate.enrich.test.js` for:
	- jurisdiction defaulting
	- claim_type defaulting
	- name backfill
	- invalid SOC warning behavior
	- interest normalization
	- structure param defaulting

### Phase 3: Dashboard Fixes (React — Display Corrections)
- Fix KPI data source for E[IRR] (BUG-1 frontend)
- Fix jurisdiction/type chart rendering (BUG-2 frontend)
- Fix claim name display across all tabs (BUG-3 frontend)
- Fix J-curve default scenario selection (BUG-5 frontend)

### PROMPT-5: Dashboard Display Fixes (React Frontend) ✅ FIXED

**Status:** FIXED (2026-04-16)

**Scope implemented:**
1. Updated KPI extraction to prefer `expected_xirr` over `mean_xirr` and exposed a dynamic IRR label (`E[IRR]` vs `Mean IRR`) in `dashboard/src/components/kpis/useKPIData.js` and `dashboard/src/components/kpis/UpfrontTailKPIs.jsx`.
2. Updated `dashboard/src/components/ExecutiveSummary.jsx` concentration charts to:
	- Read `risk.concentration.jurisdiction_breakdown` and `risk.concentration.type_breakdown` safely.
	- Fall back to SOC-weighted computation from `claims[]` when breakdowns are missing.
	- Show more informative empty-state messages.
3. Expanded claim name utility in `dashboard/src/utils/claimNames.js`:
	- Broader fallback chain (`name`, `claim_name`, `display_name`, `label`, IDs, archetype/type).
	- Added `buildClaimNameMap(claims)` helper for top-level lookup.
4. Audited and updated tab-level claim display usage in:
	- `dashboard/src/components/PerClaimContribution.jsx`
	- `dashboard/src/components/CashflowWaterfall.jsx`
	- `dashboard/src/components/QuantumTimeline.jsx`
	- `dashboard/src/components/PricingGrid.jsx`
	- `dashboard/src/components/ProbabilityOutcomes.jsx`
	These now prefer human-readable names from claim maps instead of raw IDs/UUID-like fields.
5. Updated `dashboard/src/components/JCurveFanChart.jsx` to honor `jcurve_data.default_key`/passed `scenarioKey` for initial selection and derive dropdown options from `available_combos` when explicit percent arrays are absent.

**Validation notes:**
- No TypeScript/JS language-service errors in updated frontend files.
- Concentration and claim-name rendering paths now include defensive fallbacks for missing fields.

### Phase 4: Integration Testing & Documentation
- End-to-end test with 2-claim portfolio
- Verify all KPIs match expected values
- Update documentation

### PROMPT-6: Integration Testing, Verification & Documentation ✅ FIXED

**Status:** FIXED (2026-04-16)

**Scope implemented:**
1. Added end-to-end integration tests in `engine/tests/test_portfolio_integration.py` for:
	- expected-cashflow E[IRR] usage in KPI/risk reference metrics
	- E[IRR] consistency with E[MOIC] and average duration
	- concentration payload presence
	- claim-name propagation in all per-claim sections
	- dynamic config propagation checks (15/25 vs legacy 10/20)
2. Added schema contract tests in `engine/tests/test_dashboard_schema.py` for:
	- claims schema, concentration schema, risk percentile schema
	- investment grid `expected_xirr` field presence
	- `mc_distributions` structure checks
	- `jcurve_data` key shape checks
3. Updated technical docs:
	- `docs/ARCHITECTURE.md` (IRR methodology section)
	- `docs/SCHEMA_REFERENCE.md` (added `expected_xirr` in `GridCellMetrics`)
	- `docs/API_CONTRACTS.md` (dashboard contract updates)
	- `docs/DESIGN_DECISIONS.md` (dated methodology decision record)
4. Added deployment checklist document: `PORTFOLIO_FIX_VERIFICATION.md`.

**Verification notes:**
- Engine test suites executed successfully, including targeted Prompt-1/2/3 and schema tests.
- Server test suite (`vitest`) executed successfully.
- All bugs BUG-1 through BUG-5 remain marked FIXED with implementation evidence.

---

## Files Inventory (All Files That May Need Changes)

### Python Engine
1. `engine/analysis/risk_metrics.py` — IRR methodology, concentration
2. `engine/run_v2.py` — Post-processing, mc_distributions, hardcoded values
3. `engine/v2_core/v2_investment_analysis.py` — Grid cell expected IRR
4. `engine/export/json_exporter.py` — Dashboard JSON export, J-curve
5. `engine/simulation/metrics.py` — XIRR computation (reference only, no changes)
6. `engine/simulation/cashflow_builder.py` — Cashflow merging (reference only)
7. `engine/structures/monetisation_upfront_tail.py` — Structure handler
8. `engine/models/` — Data models (may need `expected_xirr` field)
9. `engine/tests/test_metrics.py` — Add expected-cashflow IRR tests
10. `engine/tests/test_structures.py` — Add grid analysis tests

### Node.js Server
11. `server/routes/simulate.js` — enrichClaimConfig validation
12. `server/services/simulationRunner.js` — Config passing

### React Dashboard
13. `dashboard/src/components/kpis/useKPIData.js` — KPI data source
14. `dashboard/src/components/kpis/UpfrontTailKPIs.jsx` — KPI display
15. `dashboard/src/components/ExecutiveSummary.jsx` — Concentration charts
16. `dashboard/src/components/PerClaimContribution.jsx` — Claim names
17. `dashboard/src/components/CashflowWaterfall.jsx` — Claim names
18. `dashboard/src/components/RiskAnalytics.jsx` — Concentration data
19. `dashboard/src/utils/claimNames.js` — Name resolution
20. `app/src/pages/PortfolioResults.jsx` — Data passing

### Documentation
21. `docs/SCHEMA_REFERENCE.md` — Update with expected_xirr field
22. `docs/API_CONTRACTS.md` — Update dashboard_data.json contract
23. `docs/ARCHITECTURE.md` — Update IRR methodology description
24. `docs/DESIGN_DECISIONS.md` — Document expected-cashflow IRR rationale
