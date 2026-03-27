# Structure-Specific Refactoring — Implementation Prompts

> **Purpose**: Copy-paste each prompt into a **separate Copilot/AI session** to implement the refactoring safely and incrementally. Each prompt is self-contained with exact file paths, function signatures, line references, and constraints so the implementing agent can work without re-exploring.
>
> **Execution Order**: Prompt 1 → Prompt 2 → Prompt 3 → Prompt 4 (strictly sequential — each depends on the prior).

---

## PROMPT 1 — Engine: Create `engine/structures/` Strategy Module

```text
You are refactoring the claim-analytics-platform engine to separate per-portfolio-structure
logic into a clean Strategy pattern. The project root is:
  claim-analytics-platform/

============================
BACKGROUND — WHAT EXISTS NOW
============================

The engine has 5 portfolio structure types:
  1. litigation_funding
  2. monetisation_upfront_tail
  3. monetisation_full_purchase
  4. monetisation_staged
  5. comparative

Currently, all structure-specific branching lives in ONE file:
  engine/run_v2.py

The tangled functions are:

A) _run_analysis_and_export() (lines ~694–884)
   - 190-line function with if/elif branches per structure_type.
   - Decides which analysis to run:
       litigation_funding → evaluate_waterfall_grid (from engine.analysis.waterfall_analysis)
       all others → analyze_investment_grid (from engine.v2_core.v2_investment_analysis)
   - Decides what to SKIP:
       litigation_funding → skips stochastic pricing grid and probability sensitivity
       all others → runs both
   - Function signature:
       def _run_analysis_and_export(
           sim: SimulationResults,
           claims: list[PlatformClaim],
           ctx: PortfolioContext,
           portfolio_config: Optional[PortfolioConfig],
           output_dir: str,
       ) -> dict

B) _postprocess_dashboard_json() (lines ~500–693)
   - 193-line function that enriches dashboard_data.json after export.
   - litigation_funding branch (lines ~520–560):
       Injects waterfall_grid, waterfall_axes, waterfall_breakeven.
       Removes investment_grid, investment_grid_soc, investment_grid_eq keys.
   - All other structures branch (lines ~562–595):
       Converts investment_grid_soc list → dict keyed by "up_tail" strings.
       Adds p_hurdle and e_moic aliases.
   - Common section (lines ~600–693):
       Builds risk section, mc_distributions, histogram helper _histogram().
       For litigation_funding: adds arb_win_prob sensitivity + litigation J-curve.
   - Function signature:
       def _postprocess_dashboard_json(
           sim: SimulationResults, grid, output_dir: str,
           pricing_basis: str, structure_type: str,
           waterfall_grid_results: dict | None,
       ) -> None

C) Two litigation-funding-specific helpers in run_v2.py:
   - _build_arb_sensitivity(sim, waterfall_grid_results) → list[dict]  (line ~331)
   - _build_litigation_jcurve(sim) → dict  (line ~428)

D) _v2_paths_to_platform(sim) → dict  (line ~56)
   - Converts V2 PathResult → platform PathResult for waterfall analysis.
   - Used ONLY by litigation_funding branch.

Additionally, in engine/v2_core/v2_cashflow_builder_ext.py:
   _dispatch_builder() (lines ~400–460) has a 5-way if/elif.
   → DO NOT TOUCH this file. The cashflow builder dispatch is already clean enough
     and tightly coupled to the numpy cashflow math.

In engine/v2_core/v2_json_exporter_ext.py:
   extend_dashboard_json() dispatches to _extend_litigation_funding(),
   _extend_full_purchase(), _extend_staged(), _extend_comparative().
   → DO NOT TOUCH this file. It already follows the strategy pattern at function level.

============================
WHAT TO BUILD
============================

Create a new module: engine/structures/

Files to create:
  engine/structures/__init__.py
  engine/structures/base.py
  engine/structures/litigation_funding.py
  engine/structures/monetisation_upfront_tail.py
  engine/structures/monetisation_full_purchase.py
  engine/structures/monetisation_staged.py
  engine/structures/comparative.py

1. engine/structures/base.py — Abstract base class:

   from abc import ABC, abstractmethod
   from typing import Optional
   from engine.v2_core.v2_config import PortfolioContext, SimulationResults
   from engine.config.schema import ClaimConfig as PlatformClaim, PortfolioConfig

   class StructureHandler(ABC):
       """Base class for portfolio-structure-specific analysis logic."""

       @abstractmethod
       def run_grid_analysis(self, sim, claims, ctx, portfolio_config, output_dir):
           """Run the structure-specific grid analysis. Returns (grid, extra_results)."""

       @abstractmethod
       def should_run_stochastic(self) -> bool:
           """Whether stochastic pricing grid applies to this structure."""

       @abstractmethod
       def should_run_prob_sensitivity(self) -> bool:
           """Whether probability sensitivity analysis applies."""

       @abstractmethod
       def postprocess_dashboard(self, data, sim, grid, waterfall_grid_results,
                                  pricing_basis, output_dir):
           """Structure-specific postprocessing of dashboard_data.json.
              Mutates `data` dict in-place. Returns None."""

       @abstractmethod
       def get_extra_dashboard_fields(self, sim, waterfall_grid_results) -> dict:
           """Return extra fields to add to dashboard JSON (sensitivity, jcurve, etc.)."""

2. engine/structures/__init__.py — Registry:

   from .base import StructureHandler
   from .litigation_funding import LitigationFundingHandler
   from .monetisation_upfront_tail import UpfrontTailHandler
   from .monetisation_full_purchase import FullPurchaseHandler
   from .monetisation_staged import StagedHandler
   from .comparative import ComparativeHandler

   _REGISTRY = {
       "litigation_funding": LitigationFundingHandler,
       "monetisation_upfront_tail": UpfrontTailHandler,
       "monetisation_full_purchase": FullPurchaseHandler,
       "monetisation_staged": StagedHandler,
       "comparative": ComparativeHandler,
   }

   def get_handler(structure_type: str) -> StructureHandler:
       cls = _REGISTRY.get(structure_type)
       if cls is None:
           raise ValueError(f"Unknown structure type: {structure_type}")
       return cls()

3. Per-structure handler files:

   A) litigation_funding.py:
      - run_grid_analysis: imports evaluate_waterfall_grid from engine.analysis.waterfall_analysis,
        imports _arange from engine.analysis.investment_grid.
        Uses _v2_paths_to_platform (move this helper INTO this file or into a shared utils).
        Reads params from portfolio_config.structure.params (cost_multiple_range, award_ratio_range,
        waterfall_type). Creates dummy InvestmentGridResults for downstream exporters.
      - should_run_stochastic: returns False
      - should_run_prob_sensitivity: returns False
      - postprocess_dashboard: contains the litigation_funding branch from _postprocess_dashboard_json
        (waterfall_grid injection, waterfall_axes, waterfall_breakeven, remove upfront/tail keys).
      - get_extra_dashboard_fields: calls _build_arb_sensitivity and _build_litigation_jcurve
        (move BOTH of these functions into this file).

   B) monetisation_upfront_tail.py:
      - run_grid_analysis: imports analyze_investment_grid from engine.v2_core.v2_investment_analysis.
        Calls it with sim, v2_claims, pricing_bases=[pricing_basis], ctx=ctx.
      - should_run_stochastic: returns True
      - should_run_prob_sensitivity: returns True
      - postprocess_dashboard: contains the monetisation branch (convert investment_grid_soc list → dict,
        add p_hurdle and e_moic aliases).
      - get_extra_dashboard_fields: returns empty dict.

   C) monetisation_full_purchase.py:
      - Identical to upfront_tail for grid analysis (uses same analyze_investment_grid).
      - should_run_stochastic: True
      - should_run_prob_sensitivity: True
      - postprocess_dashboard: same as upfront_tail (investment_grid_soc list → dict conversion).
      - get_extra_dashboard_fields: empty dict.

   D) monetisation_staged.py:
      - Same pattern as full_purchase.

   E) comparative.py:
      - run_grid_analysis: runs TWO sub-analyses (per structure_a and structure_b from
        portfolio_config.structure.params). Uses handler dispatch internally.
      - should_run_stochastic: True (for the monetisation side)
      - should_run_prob_sensitivity: True
      - postprocess_dashboard: same as upfront_tail for the monetisation portion.
      - get_extra_dashboard_fields: empty dict.

4. Refactor engine/run_v2.py — _run_analysis_and_export():

   Replace the entire if/elif chain with:

       from engine.structures import get_handler

       handler = get_handler(structure_type)

       # Structure-specific grid analysis
       grid, extra = handler.run_grid_analysis(sim, claims, ctx, portfolio_config, output_dir)
       result.update(extra)
       result["grid"] = grid

       # Universal exports (charts, Excel, PDF) — keep as-is

       # Conditional stochastic + sensitivity
       if handler.should_run_stochastic():
           # existing stochastic pricing code
       if handler.should_run_prob_sensitivity():
           # existing probability sensitivity code

       # Dashboard JSON postprocessing
       _postprocess_dashboard_json(sim, grid, output_dir, pricing_basis,
                                    structure_type, handler, ...)

5. Refactor engine/run_v2.py — _postprocess_dashboard_json():

   Replace the structure-specific branches with handler delegation:

       handler.postprocess_dashboard(data, sim, grid, waterfall_grid_results, pricing_basis, output_dir)

   Keep the COMMON sections in _postprocess_dashboard_json (risk, mc_distributions, _histogram).

   For the extra fields (sensitivity, jcurve):
       extra = handler.get_extra_dashboard_fields(sim, waterfall_grid_results)
       data.update(extra)

============================
CRITICAL CONSTRAINTS
============================

- DO NOT modify engine/v2_core/v2_cashflow_builder_ext.py
- DO NOT modify engine/v2_core/v2_json_exporter_ext.py
- DO NOT modify engine/analysis/ files (they are already clean)
- DO NOT change any function signatures that are called from engine/run_v2.py's
  run_platform_pipeline() or run_single_claim() — those are the public API
- The refactored _run_analysis_and_export() MUST produce IDENTICAL dashboard_data.json output
  for every structure type (byte-for-byte when formatted with indent=2)
- Preserve all print() progress messages (the dashboard reads these via stdout)
- Preserve all try/except blocks around Excel, PDF, and chart generation
- Move _build_arb_sensitivity() and _build_litigation_jcurve() into
  engine/structures/litigation_funding.py (they are litigation-funding-only)
- Move _v2_paths_to_platform() into engine/structures/litigation_funding.py
  (only used by waterfall analysis)
- Keep sim_config_start_date() in run_v2.py (it's used by CLI entry point too)

============================
VERIFICATION
============================

After implementation, run the existing tests:
   cd claim-analytics-platform
   python -m pytest engine/tests/test_structures.py -v

All 5 structure tests must still pass. If any test references _run_analysis_and_export
directly (they shouldn't — they test via run_portfolio_simulation), verify imports still work.

Also run a quick smoke test:
   python -m engine.run_v2 --config engine/tests/test_tata_portfolio.json --output-dir test_outputs/ --n 100

The dashboard_data.json produced should be structurally identical to output before refactoring.
```

---

## PROMPT 2 — Dashboard: Extract Per-Structure KPI Components

```text
You are refactoring the claim-analytics-platform dashboard to extract structure-specific
KPI rendering into separate components. The project root is:
  claim-analytics-platform/

============================
BACKGROUND — WHAT EXISTS NOW
============================

File: dashboard/src/components/ExecutiveSummary.jsx

The KPIRow function (lines ~24–127) has a 5-way if/else chain based on structureType:

  function KPIRow({ data, structureType }) {
    // ... shared data extraction (meta, ig, ca, risk, moicDist, irrDist, ref) ...
    
    if (structureType === 'litigation_funding') {
      return <div style={grid6}> ... 6 KPIs: Total Legal Costs, E[MOIC], E[IRR], P(Loss), P(Total Loss), Fund Return </div>;
    }
    if (structureType === 'monetisation_full_purchase') {
      return <div style={grid5}> ... 5 KPIs: Total Purchase Price, E[MOIC], E[IRR], P(Loss), Breakeven Price </div>;
    }
    if (structureType === 'monetisation_staged') {
      return <div style={grid5}> ... 5 KPIs: Total Expected Investment, E[MOIC], E[IRR], P(Loss), E[Net Recovery] </div>;
    }
    if (structureType === 'comparative') {
      return <div> ... side-by-side Cards for 2 grid keys with 3 KPIs each </div>;
    }
    // Default: monetisation_upfront_tail
    return <div style={grid6}> ... 6 KPIs: Total SOC, E[MOIC], E[IRR], P(Loss), P(Hurdle), E[Recovery] </div>;
  }

The ExecutiveSummary component itself (lines ~128+) is universal — it renders KPIRow, then
claim breakdown (donut + bar charts), DistributionExplorer, and JCurveFanChart. Only KPIRow
needs refactoring.

Imports used by KPIRow:
  import { COLORS, FONT, CHART_COLORS, useUISettings, fmtCr, fmtPct, fmtMOIC } from '../theme';
  import { Card, SectionTitle, KPI, CustomTooltip, Badge } from './Shared';

Dashboard tab routing (in App.jsx) already handles structure-specific tabs via STRUCTURE_TABS config.
Structure-specific full-tab components already exist as separate files:
  - LitFundingWaterfall.jsx, PurchaseSensitivity.jsx, MilestoneAnalysis.jsx, ComparativeView.jsx
  - V2InvestmentAnalysis.jsx, V2PricingSurface.jsx, V2StochasticPricing.jsx, etc.

Only KPIRow inside ExecutiveSummary.jsx has the tangled 5-way branching.

============================
WHAT TO BUILD
============================

Create directory: dashboard/src/components/kpis/

Files to create:
  dashboard/src/components/kpis/index.jsx
  dashboard/src/components/kpis/LitFundingKPIs.jsx
  dashboard/src/components/kpis/UpfrontTailKPIs.jsx
  dashboard/src/components/kpis/FullPurchaseKPIs.jsx
  dashboard/src/components/kpis/StagedKPIs.jsx
  dashboard/src/components/kpis/ComparativeKPIs.jsx

1. Each KPI file exports a single component that receives { data, ui } props.
   It extracts the same shared data (meta, ig, ca, risk, moicDist, irrDist, ref, totalSOC, etc.)
   and returns the JSX for that structure's KPI cards.

   The shared data extraction logic (lines 26–46 of current KPIRow) should be in a
   shared hook or utility. Create:
     dashboard/src/components/kpis/useKPIData.js
   
   This hook takes `data` and returns:
     { meta, ig, ca, risk, moicDist, irrDist, refKey, ref, totalSOC, totalCollected,
       totalLegal, totalNet, eMoic, eIrr, pLoss, pHurdle, favorColor }

2. dashboard/src/components/kpis/index.jsx — Router component:

   import LitFundingKPIs from './LitFundingKPIs';
   import UpfrontTailKPIs from './UpfrontTailKPIs';
   import FullPurchaseKPIs from './FullPurchaseKPIs';
   import StagedKPIs from './StagedKPIs';
   import ComparativeKPIs from './ComparativeKPIs';

   const KPI_MAP = {
     litigation_funding: LitFundingKPIs,
     monetisation_upfront_tail: UpfrontTailKPIs,
     monetisation_full_purchase: FullPurchaseKPIs,
     monetisation_staged: StagedKPIs,
     comparative: ComparativeKPIs,
   };

   export default function KPIRow({ data, structureType }) {
     const Component = KPI_MAP[structureType] || UpfrontTailKPIs;
     return <Component data={data} />;
   }

3. Refactor ExecutiveSummary.jsx:
   - Remove the old inline KPIRow function (lines ~24–127).
   - Add: import KPIRow from './kpis';
   - The rest of ExecutiveSummary stays unchanged.

============================
STRUCTURE-SPECIFIC KPI DETAILS
============================

LitFundingKPIs: 6-column grid
  - Total Legal Costs (fmtCr(totalLegal), sub: "{n_claims} claims", color: accent5)
  - E[MOIC] (fmtMOIC(eMoic), color: favorColor(eMoic, 2.0, 1.0))
  - E[IRR] (fmtPct(eIrr), color: favorColor(eIrr, 0.25, 0.10))
  - P(Loss) (fmtPct(pLoss), color: pLoss < 0.2 ? '#34D399' : accent5)
  - P(Total Loss) (fmtPct(moicDist.p5 === 0 ? pLoss : pLoss * 0.5), color: accent5)
  - Fund Return (fmtMOIC(eMoic), sub: "E[Portfolio MOIC]", color: accent2)

FullPurchaseKPIs: 5-column grid
  - Total Purchase Price (fmtCr(purchasePrice), sub: "{n_claims} claims", color: accent1)
    where purchasePrice = totalSOC * (refKey first segment / 100 or 0.10)
  - E[MOIC], E[IRR], P(Loss) — same as above
  - Breakeven Price (fmtPct(0), sub: "See pricing grid", color: accent3)

StagedKPIs: 5-column grid
  - Total Expected Investment (fmtCr(totalSOC * 0.10), sub: "{n_claims} claims", color: accent1)
  - E[MOIC], E[IRR], P(Loss) — same
  - E[Net Recovery] (fmtCr(totalNet), color: totalNet >= 0 ? '#34D399' : accent5)

ComparativeKPIs: 2-column grid of Cards
  - For first 2 keys of ig: Card with "X% Upfront / Y% Tail" heading + 3 KPIs each (MOIC, IRR, P(Loss))

UpfrontTailKPIs: 6-column grid (default)
  - Total SOC (fmtCr(totalSOC), sub: "{n_claims} claims", color: accent1)
  - E[MOIC] (with refKey sub), E[IRR] (with refKey sub)
  - P(Loss), P(Hurdle), E[Recovery] (with "Net {fmtCr(totalNet)}" sub)

============================
CRITICAL CONSTRAINTS
============================

- DO NOT modify App.jsx tab routing
- DO NOT modify any other component files
- The visual output must be PIXEL-IDENTICAL to current behavior
- All imports from '../theme' and './Shared' must be preserved
- useUISettings() hook must still be called for ui spacing/sizes
- favorColor helper must be consistent (v >= good → '#34D399', v >= bad → accent3, else accent5)

============================
VERIFICATION
============================

1. Start the dashboard dev server:
     cd claim-analytics-platform/dashboard
     npm run dev

2. Load each structure type by switching the portfolio config in the app's PortfolioBuilder
   and running a simulation. Verify that the Executive Summary tab shows identical KPI cards
   for each of the 5 structure types.

3. Check browser console for React warnings or errors — there should be none.
```

---

## PROMPT 3 — Engine: Validate Refactoring with Golden-Output Tests

```text
You are writing golden-output validation tests for the claim-analytics-platform engine
after a Strategy-pattern refactoring. The project root is:
  claim-analytics-platform/

============================
BACKGROUND
============================

The engine was refactored to move structure-specific logic from engine/run_v2.py into
engine/structures/ (strategy pattern with StructureHandler base class).

The existing test file is:
  engine/tests/test_structures.py
It has end-to-end tests for all 5 structures that exercise the simulation + analysis pipeline.

Additionally, quick golden-snapshot tests exist in:
  engine/tests/test_golden.py

The refactoring MUST NOT change any output. We need to verify:
  1. dashboard_data.json output is identical for all 5 structure types.
  2. The handler registry correctly resolves all 5 types.
  3. Importing engine.structures.get_handler works.
  4. Each handler's should_run_stochastic() and should_run_prob_sensitivity() return correct booleans.
  5. The full pipeline (run_platform_pipeline) still works end-to-end.

============================
WHAT TO BUILD
============================

Create or update: engine/tests/test_refactoring_validation.py

Tests to write:

1. test_handler_registry():
   - Verify get_handler("litigation_funding") returns LitigationFundingHandler instance
   - Verify get_handler("monetisation_upfront_tail") returns UpfrontTailHandler instance
   - Same for full_purchase, staged, comparative
   - Verify get_handler("invalid_type") raises ValueError

2. test_handler_flags():
   - LitigationFundingHandler: should_run_stochastic() == False, should_run_prob_sensitivity() == False
   - UpfrontTailHandler: both True
   - FullPurchaseHandler: both True
   - StagedHandler: both True
   - ComparativeHandler: should_run_stochastic() == True, should_run_prob_sensitivity() == True

3. test_golden_dashboard_output_litigation_funding():
   - Load engine/tests/test_tata_portfolio.json
   - Modify structure.type to "litigation_funding" with appropriate params
   - Run run_platform_pipeline with n=50, seed=42
   - Verify dashboard_data.json contains:
       structure_type == "litigation_funding"
       "waterfall_grid" key exists and is a dict
       "waterfall_axes" key exists
       "sensitivity" key exists (arb win prob)
       "jcurve_data" key exists with "scenarios.litigation_funding"
       "investment_grid" key does NOT exist

4. test_golden_dashboard_output_upfront_tail():
   - Same config with structure.type = "monetisation_upfront_tail"
   - Verify:
       structure_type == "monetisation_upfront_tail"
       "investment_grid" is a dict with "up_tail" keys like "10_20"
       "stochastic_pricing" data was generated (stochastic_pricing.json exists)

5. test_pipeline_consistency():
   - For each structure type, run with n=50, seed=42
   - Verify the output status is "complete"
   - Verify n_claims matches expected count
   - Verify output files exist: dashboard_data.json

============================
CRITICAL CONSTRAINTS
============================

- Tests must run fast (n=50 paths max) for CI
- Use tmp_path pytest fixture for output directories
- Import from engine.structures import get_handler
- Import run_platform_pipeline from engine.run_v2
- Use the test portfolio config at engine/tests/test_tata_portfolio.json as base

============================
HOW TO RUN
============================

   cd claim-analytics-platform
   python -m pytest engine/tests/test_refactoring_validation.py -v --tb=short

All tests must pass. If any fail, debug and fix the engine/structures/ code (NOT the tests).
```

---

## PROMPT 4 — Full Integration Smoke Test (Run Last)

```text
You are performing a final integration smoke test of the claim-analytics-platform after
engine strategy-pattern refactoring (engine/structures/) and dashboard KPI extraction
(dashboard/src/components/kpis/). The project root is:
  claim-analytics-platform/

============================
WHAT TO VERIFY
============================

A) ENGINE VERIFICATION

1. Run ALL existing tests:
     cd claim-analytics-platform
     python -m pytest engine/tests/ -v --tb=short

   Expected: ALL tests pass including test_structures.py, test_golden.py, test_metrics.py, etc.

2. Run pipeline for each structure type with CLI:

     python -m engine.run_v2 --config engine/tests/test_tata_portfolio.json --output-dir test_outputs/smoke_upfront_tail --n 100
     
   Then modify the config's structure.type to "litigation_funding" and run again:
     python -m engine.run_v2 --config <modified_config> --output-dir test_outputs/smoke_lit_funding --n 100

   For each output dir, verify:
   - dashboard_data.json exists and is valid JSON
   - structure_type field matches expected
   - Investment_Analysis_Report.xlsx exists
   - TATA_V2_Valuation_Model.xlsx exists
   - charts/ directory has PNG files

3. Verify the imports are clean:
     python -c "from engine.structures import get_handler; print(get_handler('litigation_funding'))"
     python -c "from engine.structures import get_handler; print(get_handler('monetisation_upfront_tail'))"

B) DASHBOARD VERIFICATION

1. Check for build errors:
     cd claim-analytics-platform/dashboard
     npm run build

   Expected: build succeeds with no errors.

2. Check for import errors in the new kpis/ directory:
   - Verify dashboard/src/components/kpis/index.jsx imports all 5 KPI components
   - Verify ExecutiveSummary.jsx imports KPIRow from './kpis'
   - Verify NO remaining structureType if/else chain in ExecutiveSummary.jsx

C) SERVER INTEGRATION

1. Start the server:
     cd claim-analytics-platform/server
     node server.js

2. Start the dashboard:
     cd claim-analytics-platform/dashboard
     npm run dev

3. In the browser, create a portfolio with:
   - 2+ claims
   - Select "Litigation Funding" structure
   - Run simulation
   - Verify Executive Summary tab shows correct KPIs (Total Legal Costs, etc.)
   - Switch to "Upfront + Tail" and re-run
   - Verify the KPI row switches to Total SOC, P(Hurdle), E[Recovery], etc.

============================
IF SOMETHING BREAKS
============================

Common issues:
1. ImportError in engine/structures/:
   → Check __init__.py exports and relative imports.
   → Ensure all moved functions (_build_arb_sensitivity, _build_litigation_jcurve, _v2_paths_to_platform)
     have their imports (numpy, math, engine.v2_core modules) brought along.

2. dashboard_data.json missing keys:
   → Compare with a pre-refactoring output. The postprocess_dashboard handler methods must produce
     identical key/value structure.
   → Run: python -c "import json; d=json.load(open('test_outputs/smoke_lit_funding/dashboard_data.json')); print(sorted(d.keys()))"

3. Dashboard KPIs appear blank:
   → Check that useKPIData hook correctly extracts all fields.
   → Check that favorColor helper is defined consistently in each KPI component (or shared via hook).
   → Browser DevTools console for prop-type or undefined errors.

4. Test failures in test_structures.py:
   → These tests exercise run_portfolio_simulation (engine/simulation/monte_carlo.py), NOT run_v2.py.
     They should be unaffected. If they fail, you have a dependency that leaked.

DO NOT modify the refactored code to make tests pass differently — fix the refactoring
to match the existing behavior exactly.
```

---

## Files Modified Summary

After executing all 4 prompts, the changeset should be:

### New Files Created
| File | Purpose |
|------|---------|
| `engine/structures/__init__.py` | Handler registry + `get_handler()` |
| `engine/structures/base.py` | `StructureHandler` abstract base class |
| `engine/structures/litigation_funding.py` | Waterfall grid, arb sensitivity, J-curve |
| `engine/structures/monetisation_upfront_tail.py` | Standard investment grid handler |
| `engine/structures/monetisation_full_purchase.py` | Full purchase handler |
| `engine/structures/monetisation_staged.py` | Staged payment handler |
| `engine/structures/comparative.py` | Comparative analysis handler |
| `engine/tests/test_refactoring_validation.py` | Golden-output validation tests |
| `dashboard/src/components/kpis/index.jsx` | KPI component router |
| `dashboard/src/components/kpis/useKPIData.js` | Shared KPI data extraction hook |
| `dashboard/src/components/kpis/LitFundingKPIs.jsx` | Litigation funding KPI cards |
| `dashboard/src/components/kpis/UpfrontTailKPIs.jsx` | Upfront + tail KPI cards |
| `dashboard/src/components/kpis/FullPurchaseKPIs.jsx` | Full purchase KPI cards |
| `dashboard/src/components/kpis/StagedKPIs.jsx` | Staged payment KPI cards |
| `dashboard/src/components/kpis/ComparativeKPIs.jsx` | Comparative KPI cards |

### Files Modified (2 files)
| File | Change |
|------|--------|
| `engine/run_v2.py` | Replace if/elif chains in `_run_analysis_and_export()` and `_postprocess_dashboard_json()` with handler delegation. Remove `_build_arb_sensitivity()`, `_build_litigation_jcurve()`, `_v2_paths_to_platform()` (moved to handler). |
| `dashboard/src/components/ExecutiveSummary.jsx` | Remove inline `KPIRow` function, import from `./kpis` instead. |

### Files NOT Modified (intentionally)
| File | Reason |
|------|--------|
| `engine/v2_core/v2_json_exporter_ext.py` | Already clean strategy pattern |
| `engine/v2_core/v2_cashflow_builder_ext.py` | Dispatch is tightly coupled to numpy math |
| `engine/analysis/*.py` | Already structure-specific, clean modules |
| `dashboard/src/App.jsx` | Tab routing already declarative and clean |
| All other dashboard components | Already structure-specific or universal |
