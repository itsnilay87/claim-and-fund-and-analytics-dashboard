# Claim Analytics Platform — V2 Engine Port Implementation Plan

**Architecture**: Option B — Engine Port  
**Objective**: Bring the full computational depth and UI richness of the V2 codebase into the platform's superior architecture (workspaces, per-claim modelling, multiple investment structures, jurisdiction templates).

**Codebase sizes** (measured):
- V2 Python engine: 23 files, ~16,000 lines  
- V2 dashboard: 29 components, ~8,000 lines  
- claim-analytics UI: 45 files, ~2,500 lines  
- Platform (current): 49 app + 22 dashboard + 30 engine + 13 server + 7 deploy source files

---

## PHASE 1: FILE COPYING — V2 Core into Platform

**Goal**: Copy all V2 Python files verbatim into `engine/v2_core/`, copy V2 dashboard components, and copy claim-analytics UI components. No logic changes — purely mechanical.

**Dependencies**: None

### 1A. V2 Python Engine → engine/v2_core/

Create `engine/v2_core/` directory. Copy these 23 files verbatim:

| # | Source (relative to TATA_code_v2/) | Destination (relative to claim-analytics-platform/) |
|---|---|---|
| 1 | `v2_config.py` | `engine/v2_core/v2_config.py` |
| 2 | `v2_master_inputs.py` | `engine/v2_core/v2_master_inputs.py` |
| 3 | `v2_validate.py` | `engine/v2_core/v2_validate.py` |
| 4 | `v2_monte_carlo.py` | `engine/v2_core/v2_monte_carlo.py` |
| 5 | `v2_probability_tree.py` | `engine/v2_core/v2_probability_tree.py` |
| 6 | `v2_quantum_model.py` | `engine/v2_core/v2_quantum_model.py` |
| 7 | `v2_timeline_model.py` | `engine/v2_core/v2_timeline_model.py` |
| 8 | `v2_legal_cost_model.py` | `engine/v2_core/v2_legal_cost_model.py` |
| 9 | `v2_cashflow_builder.py` | `engine/v2_core/v2_cashflow_builder.py` |
| 10 | `v2_metrics.py` | `engine/v2_core/v2_metrics.py` |
| 11 | `v2_investment_analysis.py` | `engine/v2_core/v2_investment_analysis.py` |
| 12 | `v2_stochastic_pricing.py` | `engine/v2_core/v2_stochastic_pricing.py` |
| 13 | `v2_pricing_surface.py` | `engine/v2_core/v2_pricing_surface.py` |
| 14 | `v2_probability_sensitivity.py` | `engine/v2_core/v2_probability_sensitivity.py` |
| 15 | `v2_json_exporter.py` | `engine/v2_core/v2_json_exporter.py` |
| 16 | `v2_excel_writer.py` | `engine/v2_core/v2_excel_writer.py` |
| 17 | `v2_comprehensive_excel.py` | `engine/v2_core/v2_comprehensive_excel.py` |
| 18 | `v2_pdf_report.py` | `engine/v2_core/v2_pdf_report.py` |
| 19 | `v2_report_charts.py` | `engine/v2_core/v2_report_charts.py` |
| 20 | `v2_run.py` | `engine/v2_core/v2_run.py` |
| 21 | `v2_audit.py` | `engine/v2_core/v2_audit.py` |
| 22 | `v2_comparison_excel.py` | `engine/v2_core/v2_comparison_excel.py` |
| 23 | `v2_chart_data_excel.py` | `engine/v2_core/v2_chart_data_excel.py` |

**New file — `engine/v2_core/__init__.py`** (~40 lines):
```python
"""
V2 Core Engine — verbatim copy of TATA_code_v2 simulation engine.
All imports rewritten from `from TATA_code_v2.v2_xxx` to relative `from .v2_xxx`.
No mathematical or logical changes — only import path rewiring.
"""
```

**Modification needed in ALL 23 copied files — import rewriting**:

Every V2 file imports via `from TATA_code_v2.v2_xxx import ...` or `from TATA_code_v2 import v2_xxx as MI`. These must be changed to relative imports within `engine/v2_core/`:

| Original import pattern | Replacement |
|---|---|
| `from TATA_code_v2 import v2_master_inputs as MI` | `from . import v2_master_inputs as MI` |
| `from TATA_code_v2.v2_config import ClaimConfig, ...` | `from .v2_config import ClaimConfig, ...` |
| `from TATA_code_v2.v2_monte_carlo import run_simulation` | `from .v2_monte_carlo import run_simulation` |
| `from TATA_code_v2.v2_timeline_model import ...` | `from .v2_timeline_model import ...` |
| (all other `from TATA_code_v2.v2_*` patterns) | `from .v2_*` |

**No other modifications.** The math, logic, constants, and function signatures remain identical.

### 1B. V2 Dashboard Components → dashboard/src/

Copy the rich V2 dashboard components to REPLACE the platform's simpler versions. This table shows source, destination, and whether it REPLACES an existing file or is NEW.

| # | Source (relative to TATA_code_v2/dashboard/src/) | Destination (relative to claim-analytics-platform/dashboard/src/) | Action |
|---|---|---|---|
| 1 | `theme.js` | `theme.js` | REPLACE |
| 2 | `data/dashboardData.js` | `data/dashboardData.js` | REPLACE |
| 3 | `components/Shared.jsx` | `components/Shared.jsx` | REPLACE |
| 4 | `components/ExecutiveSummary.jsx` | `components/v2/ExecutiveSummary.jsx` | NEW (v2 subfolder) |
| 5 | `components/ProbabilityOutcomes.jsx` | `components/v2/ProbabilityOutcomes.jsx` | NEW |
| 6 | `components/QuantumTimeline.jsx` | `components/v2/QuantumTimeline.jsx` | NEW |
| 7 | `components/InvestmentAnalysis.jsx` | `components/v2/InvestmentAnalysis.jsx` | NEW |
| 8 | `components/PerClaimAnalysis.jsx` | `components/v2/PerClaimAnalysis.jsx` | NEW |
| 9 | `components/LegalCosts.jsx` | `components/v2/LegalCosts.jsx` | NEW |
| 10 | `components/CashflowWaterfall.jsx` | `components/v2/CashflowWaterfall.jsx` | NEW |
| 11 | `components/ScenariosAndPricing.jsx` | `components/v2/ScenariosAndPricing.jsx` | NEW |
| 12 | `components/PricingSurface.jsx` | `components/v2/PricingSurface.jsx` | NEW |
| 13 | `components/D3ProbabilityTree.jsx` | `components/D3ProbabilityTree.jsx` | REPLACE |
| 14 | `components/JCurveFanChart.jsx` | `components/JCurveFanChart.jsx` | REPLACE |
| 15 | `components/DistributionExplorer.jsx` | `components/DistributionExplorer.jsx` | REPLACE |
| 16 | `components/PortfolioSelector.jsx` | `components/v2/PortfolioSelector.jsx` | NEW |
| 17 | `components/ProbabilitySensitivity.jsx` | `components/v2/ProbabilitySensitivity.jsx` | NEW |
| 18 | `components/ProbabilityTree.jsx` | `components/v2/ProbabilityTree.jsx` | NEW |
| 19 | `components/StochasticPricing.jsx` | `components/v2/StochasticPricing.jsx` | NEW |
| 20 | `components/WaterfallChart.jsx` | `components/v2/WaterfallChart.jsx` | NEW |
| 21 | `components/CashflowAnalysis.jsx` | `components/v2/CashflowAnalysis.jsx` | NEW |
| 22 | `components/InvestmentSOC.jsx` | `components/v2/InvestmentSOC.jsx` | NEW |
| 23 | `components/InvestmentEQ.jsx` | `components/v2/InvestmentEQ.jsx` | NEW |
| 24 | `components/BreakevenAnalysis.jsx` | `components/v2/BreakevenAnalysis.jsx` | NEW |
| 25 | `components/ScenarioMatrix.jsx` | `components/v2/ScenarioMatrix.jsx` | NEW |
| 26 | `components/ReportCharts.jsx` | `components/v2/ReportCharts.jsx` | NEW |
| 27 | `components/ProbabilityAnalysis.jsx` | `components/v2/ProbabilityAnalysis.jsx` | NEW |

**Why `v2/` subfolder?** The platform ALREADY has its own `ExecutiveSummary.jsx`, `ProbabilityOutcomes.jsx`, etc. with structure-aware tab routing. We place V2 versions in `components/v2/` so the platform's `App.jsx` can import EITHER the platform-native OR the V2 version depending on structure_type. The shared utility components (Shared.jsx, D3ProbabilityTree.jsx, JCurveFanChart.jsx, DistributionExplorer.jsx) replace in-place because they are used by both.

**Modifications needed in copied V2 dashboard components**:
- `theme.js` REPLACE: Merge the two theme files. V2's theme has `fmtCr()`, `fmtPct()`, `fmtMOIC()`, `fmtMo()`, `moicColor()`, `irrColor()`, `lossColor()`, `hurdleColor()`, `UISettingsProvider`, `useUISettings`, `CHART_COLORS`, etc. The platform's theme is a simpler copy. **Action**: Use V2's theme.js wholesale (it's a superset).
- `dashboardData.js` REPLACE: V2's version fetches from `/data/` paths and has portfolio mode switching. Platform's version fetches from `/api/results/{runId}/...`. **Action**: Merge — keep the platform's API-based fetching (`?runId=X&apiBase=...`) and add V2's normalization logic and portfolio modes. ~250 lines merged.
- V2 components in `v2/` subfolder: Change imports from `../theme` to `../../theme` (one level deeper). No logic changes.

### 1C. Claim-Analytics UI Components → app/src/

Copy the polished UI components from claim-analytics to replace/upgrade the platform's simpler versions.

| # | Source (relative to claim-analytics/src/) | Destination (relative to claim-analytics-platform/app/src/) | Action |
|---|---|---|---|
| 1 | `index.css` | `index.css` | REPLACE (adds gradient-text, glass-card, glow classes, stagger-children) |
| 2 | `pages/Landing.jsx` | `pages/Landing.jsx` | REPLACE (9-section landing vs current minimal) |
| 3 | `pages/Login.jsx` | `pages/Login.jsx` | REPLACE (glass card, demo button, polished styling) |
| 4 | `pages/Signup.jsx` | `pages/Signup.jsx` | NEW (platform has no signup page) |
| 5 | `layouts/PublicLayout.jsx` | `layouts/PublicLayout.jsx` | NEW |
| 6 | `layouts/DashboardLayout.jsx` | `layouts/DashboardLayout.jsx` | REPLACE (backdrop blur, polished) |
| 7 | `components/dashboard/Sidebar.jsx` | `components/layout/Sidebar.jsx` | REPLACE |
| 8 | `components/dashboard/TopBar.jsx` | `components/layout/TopBar.jsx` | REPLACE |
| 9 | `components/dashboard/StatsCards.jsx` | `components/dashboard/StatsCards.jsx` | NEW |
| 10 | `components/common/ThemeToggle.jsx` | `components/common/ThemeToggle.jsx` | NEW |
| 11 | `components/landing/Navbar.jsx` | `components/landing/Navbar.jsx` | NEW |
| 12 | `components/landing/Hero.jsx` | `components/landing/Hero.jsx` | NEW |
| 13 | `components/landing/Features.jsx` | `components/landing/Features.jsx` | NEW |
| 14 | `components/landing/HowItWorks.jsx` | `components/landing/HowItWorks.jsx` | NEW |
| 15 | `components/landing/CaseStudies.jsx` | `components/landing/CaseStudies.jsx` | NEW |
| 16 | `components/landing/MarketInsights.jsx` | `components/landing/MarketInsights.jsx` | NEW |
| 17 | `components/landing/Testimonials.jsx` | `components/landing/Testimonials.jsx` | NEW |
| 18 | `components/landing/Pricing.jsx` | `components/landing/Pricing.jsx` | NEW |
| 19 | `components/landing/Footer.jsx` | `components/landing/Footer.jsx` | NEW |
| 20 | `pages/Home.jsx` | `pages/Home.jsx` | NEW (replaces WorkspaceHome or supplements it) |
| 21 | `pages/Profile.jsx` | `pages/Profile.jsx` | NEW |
| 22 | `pages/Wallet.jsx` | `pages/Wallet.jsx` | NEW |
| 23 | `pages/History.jsx` | `pages/History.jsx` | NEW |
| 24 | `store/themeStore.js` | `store/themeStore.js` | NEW |
| 25 | `components/simulation/DownloadsPanel.jsx` | `components/simulation/DownloadsPanel.jsx` | NEW |
| 26 | `components/simulation/ValidationBanner.jsx` | `components/simulation/ValidationBanner.jsx` | NEW |
| 27 | `components/simulation/RunPanel.jsx` | `components/simulation/RunPanel.jsx` | NEW |
| 28 | `components/simulation/FormFields.jsx` | `components/simulation/FormFields.jsx` | NEW (co-exists with claim/FormFields.jsx) |
| 29 | `utils/validation.js` | `utils/validation.js` | NEW |
| 30 | `hooks/useDashboardData.js` | `hooks/useDashboardData.js` | NEW (supplements useClaimSimulation) |

**Modifications needed**:
- **Sidebar.jsx**: Change nav items from claim-analytics routes (`/dashboard`, `/dashboard/simulation/new`, `/dashboard/history`) to platform routes (`/workspaces`, `/workspace/:wsId/claims`, `/workspace/:wsId/portfolios`). Keep visual design. Change import of `authStore` from `../store/authStore` to `../../store/authStore`.
- **TopBar.jsx**: Change import paths. Keep the search bar, theme toggle, notification bell, user avatar.
- **Landing.jsx**: Change the 9 section component imports from `../components/landing/X` to `../components/landing/X`. Keep all content but update CTA button links from `/login` → `/login`, `/signup` → `/signup` (same routes).
- **Login.jsx / Signup.jsx**: Change import of `authStore` from `../store/authStore` to `../store/authStore`. Change post-login redirect from `/dashboard` to `/workspaces`.
- **DashboardLayout.jsx**: Change import paths for Sidebar/TopBar from `../components/dashboard/` to `../components/layout/`. Keep the structure (sidebar + topbar + outlet).
- **Home.jsx**: Adapt stats to pull from workspaceStore (total claims, total portfolios, recent runs) instead of hardcoded demo data. Keep visual design.

### 1D. New Config Files

| # | File | Purpose | Lines |
|---|---|---|---|
| 1 | `engine/v2_core/__init__.py` | Package marker, re-exports key classes | ~40 |

### Verification — Phase 1

```powershell
# 1. Verify all V2 files copied
Get-ChildItem -Path "claim-analytics-platform/engine/v2_core/v2_*.py" | Measure-Object
# Expected: 23 files

# 2. Verify imports rewritten (no TATA_code_v2 references)
Select-String -Path "claim-analytics-platform/engine/v2_core/*.py" -Pattern "from TATA_code_v2"
# Expected: 0 matches

# 3. Verify Python can import the package
cd claim-analytics-platform
python -c "from engine.v2_core.v2_config import ClaimConfig; print('OK')"
# Expected: OK

# 4. Verify V2 dashboard components exist
Get-ChildItem -Path "claim-analytics-platform/dashboard/src/components/v2/*.jsx" | Measure-Object
# Expected: 17 files

# 5. Verify landing components exist
Get-ChildItem -Path "claim-analytics-platform/app/src/components/landing/*.jsx" | Measure-Object
# Expected: 9 files

# 6. Verify both React apps still build
cd claim-analytics-platform/dashboard; npm run build
cd ../app; npm run build
```

---

## PHASE 2: THE ADAPTER — Bridge Platform Config to V2 Engine

**Goal**: Build `engine/adapter.py` that translates the platform's Pydantic `ClaimConfig` / `PortfolioConfig` into the format V2 functions expect, then runs V2 simulation per claim and merges. Build `engine/run_v2.py` as the new entry point.

**Dependencies**: Phase 1 (v2_core files must be importable)

### 2A. engine/adapter.py (~450 lines)

**Purpose**: Converts platform's Pydantic schemas → V2's expected data structures. The V2 engine reads parameters from `v2_master_inputs.py` (module-level constants) and `v2_config.py` (dataclasses). The adapter must populate these before calling V2 functions.

**Key challenge**: V2 reads `v2_master_inputs` (MI) as module-level constants. The adapter must **monkey-patch** MI's attributes per-claim, OR wrap V2 calls to pass config directly. We choose monkey-patching MI because it requires zero changes to V2 functions.

```python
# engine/adapter.py

from engine.config.schema import (
    ClaimConfig as PlatformClaim,
    PortfolioConfig,
    PortfolioStructure,
    SimulationConfig,
    JurisdictionTemplate,
)
from engine.v2_core import v2_master_inputs as MI
from engine.v2_core.v2_config import ClaimConfig as V2ClaimConfig

def platform_claim_to_v2_claim(claim: PlatformClaim, template: JurisdictionTemplate) -> V2ClaimConfig:
    """Convert platform Pydantic ClaimConfig → V2 dataclass ClaimConfig.
    
    Maps:
      claim.id → claim_id
      claim.claim_type → archetype
      claim.soc_value_cr → soc_value_cr
      claim.jurisdiction → jurisdiction  
      claim.current_stage → current_gate
      claim.claimant_share_pct → tpl_share
      Derive pipeline from current_stage + jurisdiction
      claim.interest.commencement_date → dab_commencement_date
    """

def patch_master_inputs_for_claim(claim: PlatformClaim, template: JurisdictionTemplate) -> None:
    """Monkey-patch v2_master_inputs module attributes for this claim.
    
    Patches:
      MI.ARB_WIN_PROBABILITY ← claim.arbitration.win_probability
      MI.RE_ARB_WIN_PROBABILITY ← claim.arbitration.re_arb_win_probability
      MI.QUANTUM_BANDS ← [(b.low, b.high, b.probability) for b in claim.quantum.bands]
      MI.NO_RESTART_MODE ← claim.no_restart_mode
      MI.MAX_TIMELINE_MONTHS ← claim.timeline.max_horizon_months
      
      MI.DAB_DURATION ← from claim.timeline.pre_arb_stages['dab']
      MI.ARB_DURATION ← from claim.timeline.pre_arb_stages['arbitration']
      MI.S34_DURATION ← from claim.timeline.pre_arb_stages['s34'] 
      MI.S37_DURATION ← from claim.timeline.pre_arb_stages['s37']
      MI.SLP_DISMISSED_DURATION ← from claim.timeline.pre_arb_stages['slp_dismissed']
      MI.SLP_ADMITTED_DURATION ← from claim.timeline.pre_arb_stages['slp_admitted']
      MI.SIAC_HC_DURATION ← from claim.timeline.pre_arb_stages['siac_hc']
      MI.SIAC_COA_DURATION ← from claim.timeline.pre_arb_stages['siac_coa']
      MI.DOMESTIC_PAYMENT_DELAY ← claim.timeline.payment_delay_months (if domestic)
      MI.SIAC_PAYMENT_DELAY ← claim.timeline.payment_delay_months (if siac)
      
      MI.INTEREST_ENABLED ← claim.interest.enabled
      MI.INTEREST_RATE ← claim.interest.rate
      MI.INTEREST_COMPOUNDING ← claim.interest.compounding
      MI.DAB_COMMENCEMENT_DATE ← claim.interest.commencement_date
      
      MI.LEGAL_COSTS ← from claim.legal_costs (one_time + per_stage_costs + overrun)
    """

def tree_to_v2_flat_paths(claim: PlatformClaim) -> None:
    """Convert platform's hierarchical TreeNode → V2's flat probability tables.
    
    V2 expects MI.DOMESTIC_TREE_SCENARIO_A = {...branch probabilities...}
    Platform stores a recursive TreeNode with children[].
    
    Walk the tree DFS, extract branch probabilities at each decision point.
    For domestic trees: extract s34_tata_wins, s37_tata_wins_given_s34_win/lose,
      slp_gate_dismiss probabilities, slp_merits probabilities.
    For SIAC trees: extract hc_tata_wins, coa_tata_wins_given_hc_win/lose.
    
    Patch the result into MI.DOMESTIC_TREE_SCENARIO_A/B or MI.SIAC_TREE_SCENARIO_A/B.
    """

def save_and_restore_mi() -> contextmanager:
    """Context manager that saves MI attributes before patching and restores after.
    
    Usage:
        with save_and_restore_mi():
            patch_master_inputs_for_claim(claim1, template1)
            results = run_v2_for_claim(claim1)
        # MI is now restored to original values
    """

def derive_pipeline(claim: PlatformClaim, template: JurisdictionTemplate) -> list[str]:
    """Determine which V2 stages this claim goes through.
    
    Based on claim.current_stage and claim.jurisdiction:
    - Domestic claims: ['dab', 'arb', 's34', 's37', 'slp', 'payment']
    - SIAC claims: ['dab', 'arb', 'siac_hc', 'siac_coa', 'payment']
    - If current_stage is mid-pipeline (e.g., 'arbitration'), truncate stages before it
    """

def merge_portfolio_results(
    per_claim_results: dict[str, list],  # {claim_id: [PathResult × N]}
    claims: list[PlatformClaim],
    n_paths: int,
) -> SimulationResults:
    """Merge per-claim path results into a V2 SimulationResults object.
    
    V2's SimulationResults has .all_paths = list of list[PathResult] (one outer list per path,
    inner list per claim). We must align paths across claims by index.
    
    For path i: portfolio_path[i] = [claim_1_path[i], claim_2_path[i], ...]
    """
```

**Key functions — 7 total**:

| Function | Inputs | Outputs | Lines |
|---|---|---|---|
| `platform_claim_to_v2_claim()` | PlatformClaim, JurisdictionTemplate | V2ClaimConfig | ~40 |
| `patch_master_inputs_for_claim()` | PlatformClaim, JurisdictionTemplate | None (mutates MI) | ~100 |
| `tree_to_v2_flat_paths()` | PlatformClaim | None (mutates MI) | ~80 |
| `save_and_restore_mi()` | None | context manager | ~30 |
| `derive_pipeline()` | PlatformClaim, JurisdictionTemplate | list[str] | ~30 |
| `merge_portfolio_results()` | per_claim dict, claims, n_paths | SimulationResults | ~50 |
| `map_legal_costs()` | PlatformClaim | dict (V2 format) | ~40 |

### 2B. engine/run_v2.py (~350 lines)

**Purpose**: New entry point that orchestrates the full pipeline using V2 core functions, called by the platform's server.

```python
# engine/run_v2.py

def run_platform_pipeline(
    portfolio_config: PortfolioConfig,
    claims: list[PlatformClaim],
    templates: dict[str, JurisdictionTemplate],
    output_dir: str = "outputs",
) -> dict:
    """Full pipeline orchestrator.
    
    Steps:
    1. For each claim in portfolio:
       a. patch_master_inputs_for_claim(claim, template)
       b. tree_to_v2_flat_paths(claim)
       c. v2_claims = [platform_claim_to_v2_claim(claim, template)]
       d. sim_results = v2_monte_carlo.run_simulation(v2_claims, n, seed)
       e. Collect per-claim path results
       f. Restore MI
    2. merge_portfolio_results() → SimulationResults
    3. Route to appropriate analysis based on structure_type:
       - 'monetisation_upfront_tail' → v2_investment_analysis.analyze_investment_grid()
       - 'litigation_funding' → NEW waterfall grid analysis
       - 'monetisation_full_purchase' → NEW purchase price analysis
       - 'monetisation_staged' → NEW milestone analysis
       - 'comparative' → Run two structures
    4. v2_stochastic_pricing.run_stochastic_grid() (for upfront_tail)
    5. v2_probability_sensitivity.run_probability_sensitivity()
    6. Export:
       - v2_json_exporter.export_dashboard_json() → dashboard_data.json
       - v2_excel_writer.generate_excel_report() → results.xlsx
       - v2_comprehensive_excel.generate_comprehensive_report() → comprehensive.xlsx
       - v2_report_charts.generate_all_charts() → charts/*.png
       - v2_pdf_report.generate_pdf_report() → report.pdf
       - v2_chart_data_excel.generate_chart_data_excel() → chart_data.xlsx
    7. Return {output_path, status, per_claim_summaries, grid_results, ...}
    """

def run_single_claim(
    claim: PlatformClaim,
    template: JurisdictionTemplate,
    simulation_config: SimulationConfig,
    output_dir: str = "outputs",
) -> dict:
    """Single-claim pipeline (for the claim results page).
    
    Steps 1-6 as above but with a single claim.
    """

def main():
    """CLI entry point: python -m engine.run_v2 --config config.json --output-dir outputs/"""
    # argparse: --config, --output-dir, --mode (portfolio|claim), --n, --seed
    # Load JSON → PortfolioConfig + ClaimConfigs
    # Load templates via JurisdictionRegistry
    # Call run_platform_pipeline() or run_single_claim()
    # Print summary to stdout (for subprocess progress parsing)
```

**Key functions — 3 total**:

| Function | Inputs | Outputs | Lines |
|---|---|---|---|
| `run_platform_pipeline()` | PortfolioConfig, claims, templates, output_dir | dict with all results | ~180 |
| `run_single_claim()` | PlatformClaim, template, SimulationConfig, output_dir | dict | ~80 |
| `main()` | CLI args | None (writes files, prints progress) | ~60 |

### 2C. engine/adapter_test.py (~150 lines)

Quick sanity test:
```python
def test_patch_and_restore():
    """Verify MI attributes are patched then restored."""

def test_tree_conversion():
    """Verify hierarchical tree → flat path table gives same probabilities."""

def test_single_claim_matches_v2():
    """Run TP-301-6 through adapter → V2 and compare to direct V2 output.
    MOIC values should match to 3 decimal places."""
```

### Verification — Phase 2

```powershell
# 1. Run adapter unit tests
cd claim-analytics-platform
python -m pytest engine/adapter_test.py -v

# 2. Run single-claim pipeline with test config
python -m engine.run_v2 --config engine/tests/test_tata_portfolio.json --output-dir test_outputs/ --mode claim

# 3. Check output exists
Test-Path "test_outputs/dashboard_data.json"
# Expected: True

# 4. Verify JSON has simulation_meta section
python -c "import json; d=json.load(open('test_outputs/dashboard_data.json')); print(d['simulation_meta']['n_paths'])"
# Expected: 10000

# 5. Run full portfolio pipeline
python -m engine.run_v2 --config engine/tests/test_tata_portfolio.json --output-dir test_outputs/ --mode portfolio

# 6. Golden test: compare MOIC at (10%, 20% tail) against V2 reference
python -c "
import json
v2 = json.load(open('../outputs/dashboard_data.json'))
plat = json.load(open('test_outputs/dashboard_data.json'))
# Find matching grid cell and compare E[MOIC]
"
```

---

## PHASE 3: INVESTMENT STRUCTURE EXTENSIONS

**Goal**: Add new cashflow/analysis functions for Litigation Funding, Full Purchase, Staged Payments, and Comparative structures. These are NEW functions alongside existing V2 functions — no existing V2 functions are modified.

**Dependencies**: Phase 2 (adapter must work, V2 core must be importable)

### 3A. engine/v2_core/v2_cashflow_builder_ext.py (~350 lines)

New file with 4 functions that ADD to v2_cashflow_builder.py's capabilities:

```python
def build_litigation_funding_cashflow(
    claims: list[V2ClaimConfig],
    all_paths: list[list[PathResult]],  # one outer list per path
    path_idx: int,
    cost_multiple: float,       # e.g., 3.0
    award_ratio: float,         # e.g., 0.30
    waterfall_type: str = "min", # "min" or "max"
    start_date: str = "2026-04-30",
) -> tuple[np.ndarray, float, float]:
    """Litigation Funding: fund bears legal costs only, return is MIN/MAX of two caps.
    
    Investment = sum of all legal costs across all claims for this path
    
    On success (any claim wins):
      return_cap_1 = cost_multiple × total_legal_costs
      return_cap_2 = award_ratio × total_collected
      if waterfall_type == "min":
          fund_return = min(return_cap_1, return_cap_2)
      else:
          fund_return = max(return_cap_1, return_cap_2)
      fund_return = max(fund_return, total_legal_costs)  # floor at cost recovery
    
    On total loss (all claims lose):
      fund_return = 0  (total loss of legal cost investment)
    
    Cashflow vector: [-legal_cost_m0, -legal_cost_m1, ..., +fund_return_at_final_month]
    
    Returns: (monthly_cashflow_vector, total_invested, fund_return)
    """

def build_full_purchase_cashflow(
    claims: list[V2ClaimConfig],
    all_paths: list[list[PathResult]],
    path_idx: int,
    purchase_price_cr: float,
    legal_cost_bearer: str = "investor",  # "investor" | "seller" | "shared"
    purchased_share_pct: float = 1.0,
    start_date: str = "2026-04-30",
) -> tuple[np.ndarray, float, float]:
    """Full Purchase: single upfront price for entire claim/portfolio.
    
    Investment = purchase_price_cr (at month 0)
                + legal costs (if legal_cost_bearer == "investor")
    
    Return = purchased_share_pct × total_collected (quantum + interest)
    
    Cashflow: [-purchase_price, -legal_m1, ..., +return_at_final_month]
    """

def build_staged_payment_cashflow(
    claims: list[V2ClaimConfig],
    all_paths: list[list[PathResult]],
    path_idx: int,
    milestones: list[dict],  # [{name: "dab_complete", payment_cr: 50.0}, ...]
    legal_cost_bearer: str = "investor",
    purchased_share_pct: float = 1.0,
    start_date: str = "2026-04-30",
) -> tuple[np.ndarray, float, float]:
    """Staged Payments: milestone-triggered investment tranches.
    
    Each milestone maps to a pipeline event:
      "dab_complete" → month = sum(pre_arb durations)
      "arb_complete" → month = dab + arb duration
      "s34_complete" → month = ... + s34 duration
      "signing" → month 0
    
    Investment = sum of milestone payments that occur before claim resolution
               + legal costs (if bearer == "investor")
    
    Stochastic element: if claim loses at stage X, later milestones are NOT paid.
    
    Return = purchased_share_pct × total_collected
    """

def build_comparative_cashflows(
    claims: list[V2ClaimConfig],
    all_paths: list[list[PathResult]],
    path_idx: int,
    structure_a: PortfolioStructure,  # e.g., litigation_funding
    structure_b: PortfolioStructure,  # e.g., monetisation_upfront_tail
    start_date: str = "2026-04-30",
) -> tuple[tuple, tuple]:
    """Comparative: run two structures on same paths.
    
    Returns: ((cf_a, inv_a, ret_a), (cf_b, inv_b, ret_b))
    """
```

### 3B. engine/v2_core/v2_investment_analysis_ext.py (~500 lines)

New file with 4 analysis functions:

```python
def analyze_litigation_funding_grid(
    claims: list[V2ClaimConfig],
    sim_results: SimulationResults,
    cost_multiple_range: tuple = (1.0, 5.0, 0.5),  # (min, max, step)
    award_ratio_range: tuple = (0.05, 0.50, 0.05),
    waterfall_type: str = "min",
    discount_rate: float = 0.12,
) -> dict:
    """Evaluate litigation funding across cost_multiple × award_ratio grid.
    
    For each (cm, ar) combo:
      For each path:
        build_litigation_funding_cashflow(claims, path, cm, ar, waterfall_type)
        compute_moic(), compute_xirr()
      Aggregate: E[MOIC], E[XIRR], P(Loss), VaR(5%), P(Hurdle)
    
    Returns: {
      grid: {f"{cm}_{ar}": GridCellMetrics, ...},
      axes: {cost_multiples: [...], award_ratios: [...]},
      best_cell: {cm, ar, moic, irr},
      breakeven_curve: [{cm, min_ar_for_moic_1}, ...],
    }
    """

def analyze_full_purchase_sensitivity(
    claims: list[V2ClaimConfig],
    sim_results: SimulationResults,
    purchase_prices: list[float],  # e.g., [100, 200, ..., 2000] in Cr
    legal_cost_bearer: str = "investor",
    purchased_share_pct: float = 1.0,
    discount_rate: float = 0.12,
) -> dict:
    """Evaluate full purchase at multiple price points.
    
    For each price:
      For each path:
        build_full_purchase_cashflow()
        compute_moic(), compute_xirr()
      Aggregate: E[MOIC], E[XIRR], P(Loss), breakeven_price
    
    Returns: {
      sensitivity: [{price, mean_moic, mean_xirr, p_loss, p5_moic, p95_moic}, ...],
      breakeven_price: float,  # price where E[MOIC] = 1.0
      optimal_price: float,    # price where IRR is maximized while P(Loss) < 20%
    }
    """

def analyze_staged_payment_grid(
    claims: list[V2ClaimConfig],
    sim_results: SimulationResults,
    milestones: list[dict],
    legal_cost_bearer: str = "investor",
    purchased_share_pct: float = 1.0,
    discount_rate: float = 0.12,
) -> dict:
    """Evaluate staged payment structure.
    
    For each path:
      build_staged_payment_cashflow()
      compute_moic(), compute_xirr()
    
    Aggregate stats + per-milestone analysis (which milestones get triggered,
    conditional on claim outcomes).
    
    Returns: {
      summary: {mean_moic, mean_xirr, p_loss, ...},
      per_milestone: [{name, trigger_rate, mean_payment, total_expected}, ...],
      total_expected_investment: float,
      milestone_timing: {P50, P25, P75 timing for each milestone},
    }
    """

def analyze_comparative(
    claims: list[V2ClaimConfig],
    sim_results: SimulationResults,
    structure_a: PortfolioStructure,
    structure_b: PortfolioStructure,
    discount_rate: float = 0.12,
) -> dict:
    """Run two structures side-by-side on same paths.
    
    Returns: {
      structure_a: {summary_metrics, grid_or_sensitivity},
      structure_b: {summary_metrics, grid_or_sensitivity},
      comparison: {
        moic_advantage: "A" or "B",
        irr_advantage: "A" or "B",
        risk_advantage: "A" or "B",
        correlation: float,  # correlation of path-level returns
      }
    }
    """
```

### 3C. engine/v2_core/v2_json_exporter_ext.py (~200 lines)

New file extending the JSON export for structure-specific sections:

```python
def extend_dashboard_json(
    base_json: dict,          # output of v2_json_exporter.export_dashboard_json
    structure_type: str,
    grid_results: dict,       # from analysis functions above
    portfolio_structure: PortfolioStructure,
) -> dict:
    """Add structure-specific sections to the dashboard JSON.
    
    For litigation_funding:
      base_json["waterfall_grid"] = {grid cells with cost_multiple × award_ratio axes}
      base_json["waterfall_axes"] = {cost_multiples: [...], award_ratios: [...]}
      base_json["waterfall_breakeven"] = [{cm, min_ar}, ...]
    
    For monetisation_full_purchase:
      base_json["purchase_sensitivity"] = [{price, moic, irr, p_loss}, ...]
      base_json["purchase_breakeven"] = float
    
    For monetisation_staged:
      base_json["milestone_analysis"] = {per_milestone: [...], timing: {...}}
    
    For comparative:
      base_json["comparative"] = {structure_a: {...}, structure_b: {...}, comparison: {...}}
    
    Always sets:
      base_json["structure_type"] = structure_type
      base_json["structure_params"] = portfolio_structure dict repr
    
    Returns: base_json (mutated)
    """
```

### Verification — Phase 3

```powershell
# 1. Unit test new cashflow functions
python -m pytest engine/tests/test_cashflow_ext.py -v

# 2. Run LF pipeline on test data
python -c "
from engine.run_v2 import run_platform_pipeline
from engine.config.loader import load_portfolio_config
config = load_portfolio_config('engine/tests/test_lf_portfolio.json')
# config.structure.type == 'litigation_funding'
result = run_platform_pipeline(config, ...)
print(result['grid_results']['best_cell'])
"

# 3. Verify JSON has waterfall_grid for LF structure
python -c "
import json
d = json.load(open('test_outputs/dashboard_data.json'))
assert 'waterfall_grid' in d
assert d['structure_type'] == 'litigation_funding'
print('LF JSON OK')
"

# 4. Verify upfront_tail still works (regression)
python -m engine.run_v2 --config engine/tests/test_tata_portfolio.json --output-dir test_outputs/

# 5. Verify comparative JSON has both structures
# (create test_comparative_portfolio.json config first)
```

---

## PHASE 4: DASHBOARD ADAPTATION

**Goal**: Modify `dashboard/src/App.jsx` to route V2 components based on `structure_type` in JSON data. Make existing platform dashboard components work with the V2-powered JSON output.

**Dependencies**: Phase 1 (V2 components copied), Phase 3 (extended JSON schema)

### 4A. Modify dashboard/src/App.jsx (~300 lines, major rewrite)

**Current state**: Has `UNIVERSAL_TABS` and `STRUCTURE_TABS` routing with placeholder components.

**Changes**:
- Replace placeholder `PlaceholderTab` usages with actual V2 components
- Add `monetisation_upfront_tail` structure tab routing that uses V2 components
- Keep existing tab structure for `litigation_funding`, `full_purchase`, `staged`, `comparative`

```
Tab routing after changes:

ALL STRUCTURES (universal tabs):
  Executive Summary     → platform ExecutiveSummary (enhanced with V2 data)
  Per-Claim Contribution → platform PerClaimContribution (enhanced)
  Probability & Outcomes → v2/ProbabilityOutcomes  ← V2 COMPONENT (rich, 10 sections)
  Quantum & Timeline    → v2/QuantumTimeline       ← V2 COMPONENT
  Cashflow & Waterfall  → v2/CashflowWaterfall     ← V2 COMPONENT (with J-curve)
  Risk Analytics        → platform RiskAnalytics
  Export & Reports      → platform ExportPanel

LITIGATION FUNDING additional tabs:
  Waterfall Analysis    → platform LitFundingWaterfall

FULL PURCHASE additional tabs:
  Purchase Sensitivity  → platform PurchaseSensitivity

UPFRONT + TAIL additional tabs:
  Investment Analysis   → v2/InvestmentAnalysis    ← V2 COMPONENT (950 lines, heatmaps)
  Pricing Grid          → v2/ScenariosAndPricing.PricingView ← V2 COMPONENT
  Pricing Surface       → v2/PricingSurface        ← V2 COMPONENT (3D Plotly)
  Per-Claim Analysis    → v2/PerClaimAnalysis      ← V2 COMPONENT
  Legal Costs           → v2/LegalCosts            ← V2 COMPONENT
  Report Charts         → v2/ScenariosAndPricing.ReportView   ← V2 COMPONENT
  Prob. Sensitivity     → v2/ProbabilitySensitivity ← V2 COMPONENT

STAGED additional tabs:
  Milestone Analysis    → platform MilestoneAnalysis

COMPARATIVE additional tabs:
  Comparative View      → platform ComparativeView
```

### 4B. Modify dashboard/src/data/dashboardData.js (~100 lines changed)

**Current state**: Fetches from `/data/` or `/api/results/{runId}/` paths.

**Changes**:
- Merge V2's grid key normalization (strip ".0" from integer keys)
- Add V2-format fields to the normalized output (ensure `stochasticData`, `pricingSurfaceData` are loaded for upfront_tail structures)
- Add `mc_distributions` extraction from the extended JSON
- Keep portfolio mode switching from V2's version
- Keep API-based loading from current platform version

### 4C. Modify platform dashboard components for V2 data

Components that need updates to consume V2-format JSON:

| Component | File | Changes | Lines changed |
|---|---|---|---|
| `ExecutiveSummary.jsx` | dashboard/src/components/ | Add V2 fields: `jcurve_data`, `mc_distributions`, claim-level SOC donut. Import `JCurveFanChart` and `DistributionExplorer` | ~80 added |
| `PerClaimContribution.jsx` | dashboard/src/components/ | Add `cashflow_analysis.per_claim[]` data, per-claim breakeven bars | ~40 added |
| `CashflowWaterfall.jsx` | dashboard/src/components/ | Already replaced by V2 version; just ensure import works | ~5 |
| `RiskAnalytics.jsx` | dashboard/src/components/ | Add V2 risk fields: `risk.stress_scenarios`, `risk.concentration` | ~30 added |
| `LitFundingWaterfall.jsx` | dashboard/src/components/ | Adapt to read `waterfall_grid` from extended JSON | ~20 changed |
| `PurchaseSensitivity.jsx` | dashboard/src/components/ | Adapt to read `purchase_sensitivity` from extended JSON | ~20 changed |
| `MilestoneAnalysis.jsx` | dashboard/src/components/ | Adapt to read `milestone_analysis` from extended JSON | ~20 changed |
| `ComparativeView.jsx` | dashboard/src/components/ | Adapt to read `comparative` from extended JSON | ~20 changed |

### 4D. New file: dashboard/src/components/v2/index.js (~30 lines)

Barrel export for all V2 components to simplify imports in App.jsx:

```javascript
export { default as V2ProbabilityOutcomes } from './ProbabilityOutcomes';
export { default as V2QuantumTimeline } from './QuantumTimeline';
export { default as V2InvestmentAnalysis } from './InvestmentAnalysis';
// ... etc
```

### 4E. Verify per-structure tab rendering

| Structure | Expected tabs | Data JSON keys required |
|---|---|---|
| `monetisation_upfront_tail` | Exec, PerClaim, Prob, Quantum, Cashflow, Risk, **InvestmentAnalysis**, **PricingGrid**, **PricingSurface**, **PerClaimAnalysis**, **LegalCosts**, **ReportCharts**, **ProbSensitivity**, Export | `investment_grid_soc`, `stochastic_pricing`, `pricing_surface`, `per_claim_grid`, `legal_cost_summary`, `probability_sensitivity` |
| `litigation_funding` | Exec, PerClaim, Prob, Quantum, Cashflow, Risk, **WaterfallAnalysis**, Export | `waterfall_grid`, `waterfall_axes`, `waterfall_breakeven` |
| `monetisation_full_purchase` | Exec, PerClaim, Prob, Quantum, Cashflow, Risk, **PurchaseSensitivity**, Export | `purchase_sensitivity`, `purchase_breakeven` |
| `monetisation_staged` | Exec, PerClaim, Prob, Quantum, Cashflow, Risk, **MilestoneAnalysis**, Export | `milestone_analysis` |
| `comparative` | Exec, PerClaim, Prob, Quantum, Cashflow, Risk, **ComparativeView**, Export | `comparative.structure_a`, `comparative.structure_b` |

### Verification — Phase 4

```powershell
# 1. Build dashboard
cd claim-analytics-platform/dashboard; npm run build
# Expected: 0 errors

# 2. Start dashboard in dev mode with test data
# Copy test_outputs/dashboard_data.json to dashboard/public/data/
# Start: npm run dev
# Expected: All 10+ tabs render for upfront_tail structure

# 3. Test each structure type:
# a. Copy LF JSON → dashboard/public/data/ → verify LF tabs appear, waterfall renders
# b. Copy UP JSON → verify pricing grid, surface, per-claim tabs appear
# c. Verify no console errors in browser DevTools

# 4. Test portfolio selector (if data has multiple portfolios)
```

---

## PHASE 5: APP SHELL — UI PORT FROM CLAIM-ANALYTICS

**Goal**: Upgrade the platform's app shell (landing, login, layout, sidebar, topbar) to match claim-analytics quality. Integrate the downloads panel. Ensure workspace management, claim editor, and portfolio builder still work.

**Dependencies**: Phase 1 (UI files copied to app/src/)

### 5A. Route + Layout Changes in app/src/App.jsx

**Current routes** (platform):
```
/workspaces                     → WorkspaceDashboard
/workspace/:wsId                → (nested routes)
  /claims                       → ClaimList
  /claim/new                    → ClaimEditor
  /claim/:id                    → ClaimEditor
  /claim/:id/results            → ClaimResults
  /portfolios                   → PortfolioList
  /portfolio/new                → PortfolioBuilder
  /portfolio/:id                → PortfolioBuilder
  /portfolio/:id/results        → PortfolioResults
```

**New routes to ADD**:
```
/                               → Landing (NEW, from claim-analytics)
/login                          → Login (UPGRADED)
/signup                         → Signup (NEW)
/workspaces                     → WorkspaceDashboard (KEEP)
/workspace/:wsId                → (nested, KEEP all existing routes)
  /home                         → Home (NEW, dashboard home with stats)
  /profile                      → Profile (NEW)
  /history                      → History (NEW, all runs across workspaces)
  (all existing routes kept)
```

**Changes to App.jsx** (~40 lines changed):
- Import PublicLayout, Landing, Login, Signup
- Add `/`, `/login`, `/signup` as public routes wrapped in PublicLayout
- Add `/workspace/:wsId/home`, `/workspace/:wsId/profile`, `/workspace/:wsId/history`
- GuestRoute wrapper for public routes (redirect to /workspaces if authenticated)
- ProtectedRoute wrapper for workspace routes (redirect to /login if not authenticated)

### 5B. File-by-File Modifications

| # | File (relative to app/src/) | Modification | Details |
|---|---|---|---|
| 1 | `App.jsx` | Add routes | Add public routes (/, /login, /signup), add Home/Profile/History routes, import PublicLayout |
| 2 | `layouts/DashboardLayout.jsx` | REPLACE | Use claim-analytics version. Change imports: `Sidebar` from `../components/layout/Sidebar`, `TopBar` from `../components/layout/TopBar` |
| 3 | `layouts/PublicLayout.jsx` | NEW (already copied) | No changes needed — it's a simple wrapper |
| 4 | `components/layout/Sidebar.jsx` | REPLACE + ADAPT | Use claim-analytics version. Change nav items to: Home (`/workspace/${wsId}/home`), Claims (`/workspace/${wsId}/claims`), Portfolios (`/workspace/${wsId}/portfolios`), History (`/workspace/${wsId}/history`), Profile (`/workspace/${wsId}/profile`). Import `workspaceStore` for wsId. Keep "Sign Out" and collapse toggle. |
| 5 | `components/layout/TopBar.jsx` | REPLACE + ADAPT | Use claim-analytics version. Import `authStore` from `../../store/authStore`. Import `ThemeToggle` from `../common/ThemeToggle`. Change search placeholder to "Search claims, portfolios..." |
| 6 | `pages/Landing.jsx` | REPLACE | Use claim-analytics version with all 9 sections. Change "Start Analyzing" CTA to link to `/signup`. Import all landing/ components. |
| 7 | `pages/Login.jsx` | REPLACE + ADAPT | Use claim-analytics version. Change post-login redirect from `/dashboard` to `/workspaces`. Import `authStore` from `../store/authStore`. |
| 8 | `pages/Signup.jsx` | NEW (copied) | Change post-signup redirect to `/workspaces`. |
| 9 | `pages/Home.jsx` | NEW (copied) + ADAPT | Change stats to read from `workspaceStore` and `claimStore`: Total Claims, Total Portfolios, Recent Runs, Total SOC. Replace "New Simulation" button with "New Portfolio" linking to portfolio builder. |
| 10 | `pages/Profile.jsx` | NEW (copied) | Change `authStore` import path. |
| 11 | `pages/History.jsx` | NEW (copied) + ADAPT | Fetch run history from `/api/status/*` for all portfolios in workspace. Add "View Results" link to `/workspace/${wsId}/portfolio/${pId}/results`. |
| 12 | `store/themeStore.js` | NEW (copied) | No changes — standalone Zustand store. |
| 13 | `store/authStore.js` | MODIFY | Add `login()` and `logout()` actions if not already present (check: platform version has `isAuthenticated`, `user`; claim-analytics version adds `token` and localStorage persistence). Merge to include both features. |
| 14 | `components/common/ThemeToggle.jsx` | NEW (copied) | Change `themeStore` import to `../../store/themeStore`. |
| 15 | `components/landing/*` (9 files) | NEW (copied) | No changes — self-contained presentational components. |
| 16 | `components/dashboard/StatsCards.jsx` | NEW (copied) | No changes. |
| 17 | `components/simulation/DownloadsPanel.jsx` | NEW (copied) + ADAPT | Change API URL from `/api/results/:runId/:portfolio/files` to platform's `/api/results/:runId/files`. Change download URL pattern accordingly. |
| 18 | `index.css` | REPLACE | Adds TailwindCSS custom classes: gradient-text, glass-card, glow classes, stagger-children, custom scrollbar. |

### 5C. Package.json Dependencies

**app/package.json** — add these dependencies from claim-analytics:
```json
{
  "framer-motion": "^11.0.0",   // Landing page animations
  "lucide-react": "^0.400.0"    // Icons for Sidebar, TopBar, StatsCards
}
```

**Already present**: react-router-dom, zustand, tailwindcss

### 5D. Verify existing functionality preserved

The following pages MUST still work after Phase 5:
- WorkspaceDashboard → workspace list, create workspace
- ClaimList → list claims, create/edit
- ClaimEditor → all 7 tabs
- PortfolioBuilder → all 4 steps
- ClaimResults / PortfolioResults → embedded dashboard

### Verification — Phase 5

```powershell
# 1. Install new dependencies
cd claim-analytics-platform/app; npm install framer-motion lucide-react

# 2. Build app
npm run build
# Expected: 0 errors

# 3. Start dev server
npm run dev
# Expected: Server starts on port 5180

# 4. Manual test checklist (browser):
# [ ] Landing page loads at / with all 9 sections
# [ ] Login page works with demo credentials, redirects to /workspaces
# [ ] Signup page works, redirects to /workspaces
# [ ] Sidebar shows correct nav items with workspace context
# [ ] TopBar shows search, theme toggle, user avatar
# [ ] /workspace/:wsId/claims still lists claims
# [ ] /workspace/:wsId/claim/:id still opens 7-tab editor
# [ ] /workspace/:wsId/portfolio/new still opens 4-step builder
# [ ] /workspace/:wsId/home shows stats dashboard
# [ ] /workspace/:wsId/history shows run history
# [ ] Theme toggle (light/dark) works globally
# [ ] Sidebar collapse/expand works
```

---

## PHASE 6: CLAIM EDITOR — MISSING INPUT FIELDS

**Goal**: Add all fields from claim-analytics simulation tabs that are missing from the platform's claim editor, so the adapter has all inputs it needs to drive V2.

**Dependencies**: Phase 2 (adapter defines which fields it needs)

### 6A. Field Gap Analysis (complete)

Fields in claim-analytics but MISSING from platform claim editor:

| # | Missing Field | claim-analytics Location | Platform Tab to Add To | Type | Default |
|---|---|---|---|---|---|
| 1 | `sims_per_combo` | SimulationTab | InterestEditor (adv. settings) or new SimulationSettings tab | NumberField, 100–10,000 | 2000 |
| 2 | `interest.start_basis` | InterestTab | InterestEditor | SelectField: 'award_date' \| 'dab_commencement' | 'award_date' |
| 3 | `interest.rate_bands[]` (multiple) | InterestTab | InterestEditor | Table: rate, type, probability per row | [{rate: 9, type: 'simple', prob: 1.0}] |
| 4 | `interest.dab_commencement_date` | InterestTab (per-claim date) | InterestEditor | Date input | '' |
| 5 | `financial.discount_rate` | FinancialTab | PortfolioBuilder Step 3 or new claim field | NumberField, 0–1, step 0.005 | 0.12 |
| 6 | `financial.risk_free_rate` | FinancialTab | PortfolioBuilder Step 3 or new claim field | NumberField, 0–1, step 0.005 | 0.07 |
| 7 | `investment_grid.upfront_pcts` | FinancialTab | PortfolioBuilder Step 3 (UpfrontTailConfig) | Comma-separated input | [5,7.5,10,...,35] |
| 8 | `investment_grid.tata_tail_pcts` | FinancialTab | PortfolioBuilder Step 3 (UpfrontTailConfig) | Comma-separated input | [5,10,...,60] |
| 9 | `payment_delays.domestic` | TimelineTab | TimelineEditor (separate from payment_delay_months) | NumberField, 0–24 | 6.0 |
| 10 | `payment_delays.siac` | TimelineTab | TimelineEditor | NumberField, 0–24 | 4.0 |
| 11 | `payment_delays.re_arb` | TimelineTab | TimelineEditor | NumberField, 0–24 | 6.0 |
| 12 | Timeline: `arb_remaining` (claim-specific) | TimelineTab | TimelineEditor (for claims mid-arbitration) | RangeField | {low: 6, high: 12} |
| 13 | Timeline: `re_referral` (claim-specific) | TimelineTab | TimelineEditor (for claims needing re-referral) | RangeField | {low: 3, high: 7} |
| 14 | Legal cost: `arb_counsel` (fixed cost) | FinancialTab | LegalCostEditor | NumberField (Cr) | 8.0 |

### 6B. File Modifications

#### 1. `app/src/components/claim/InterestEditor.jsx` — Add fields #1–4

**Current fields**: enabled, rate, compounding, commencement_date, no_restart_mode, simulation_seed, n_simulations

**Add**:
- `interest.start_basis` SelectField with options 'award_date', 'dab_commencement' (insert after `interest.enabled` toggle) — ~15 lines
- `interest.rate_bands` table editor: columns [Rate %, Type, Probability]. "Add Band" / "Remove" buttons. Sum validation badge. Replace the single `interest.rate` + `interest.compounding` fields — ~80 lines
- `interest.dab_commencement_date` already exists as `commencement_date` — just rename label to "DAB Commencement Date" — ~2 lines
- `sims_per_combo` NumberField in the "Advanced Settings" section — ~10 lines

**Total changes**: ~107 lines added/modified

#### 2. `app/src/components/claim/TimelineEditor.jsx` — Add fields #9–13

**Current fields**: pre_arb_stages[].duration_low/high, payment_delay_months, max_horizon_months

**Add**:
- Replace single `payment_delay_months` with three fields: `payment_delays.domestic`, `payment_delays.siac`, `payment_delays.re_arb` — shown conditionally based on claim jurisdiction — ~25 lines
- Add `arb_remaining` RangeField: shown only when `current_stage` is 'arbitration' or later — ~15 lines  
- Add `re_referral` RangeField: shown only when `current_stage` is 're_referral' — ~15 lines

**Total changes**: ~55 lines added/modified

#### 3. `app/src/components/claim/LegalCostEditor.jsx` — Add field #14

**Current fields**: one_time_tribunal_cr, one_time_expert_cr, per_stage_costs[stage], overrun params

**Add**:
- `legal_costs.arb_counsel_cr` NumberField (fixed counsel fee, not duration-based) in the "One-Time Costs" section — ~10 lines

**Total changes**: ~10 lines

#### 4. `app/src/components/portfolio/UpfrontTailConfig.jsx` — Add fields #7–8

**Current fields**: upfront_range (min, max, step), tail_range (min, max, step), pricing_basis

**Add**:
- "Custom Grid Points" toggle → when enabled, shows two comma-separated text inputs for `upfront_pcts` and `tata_tail_pcts` — ~40 lines
- When disabled (default), derive grid points from range: `np.arange(min, max+step, step)`

**Total changes**: ~40 lines

#### 5. `app/src/components/portfolio/SimulationSettings.jsx` — Add fields #5–6

**Current fields**: n_paths, seed, discount_rate, risk_free_rate, start_date

**Check**: The platform's SimulationSettings.jsx may already have `discount_rate` and `risk_free_rate`. If not, add them:
- `simulation.discount_rate` NumberField — ~10 lines
- `simulation.risk_free_rate` NumberField — ~10 lines

**Total changes**: ~20 lines (if fields are missing)

#### 6. `app/src/config/schema.py` — Update Pydantic models

**Add to `InterestConfig`**:
```python
start_basis: Literal["award_date", "dab_commencement"] = "award_date"
rate_bands: list[RateBand] = [RateBand(rate=0.09, type="simple", probability=1.0)]
```

**Add new model** `RateBand`:
```python
class RateBand(BaseModel):
    rate: float = 0.09
    type: Literal["simple", "compound"] = "simple"
    probability: float = 1.0
```

**Add to `TimelineConfig`**:
```python
payment_delays: PaymentDelays = PaymentDelays()
```

**Add new model** `PaymentDelays`:
```python
class PaymentDelays(BaseModel):
    domestic: float = 6.0
    siac: float = 4.0
    re_arb: float = 6.0
```

**Add to `LegalCostConfig`**:
```python
arb_counsel_cr: float = 8.0
```

**Total changes**: ~40 lines added to schema.py

### Verification — Phase 6

```powershell
# 1. Verify schema validates with new fields
python -c "
from engine.config.schema import ClaimConfig, InterestConfig, RateBand
ic = InterestConfig(
    enabled=True,
    start_basis='dab_commencement',
    rate_bands=[RateBand(rate=0.09, type='simple', probability=0.7), RateBand(rate=0.12, type='compound', probability=0.3)],
)
print(ic)
"

# 2. Verify UI builds with new fields
cd claim-analytics-platform/app; npm run build

# 3. Manual test checklist (browser):
# [ ] InterestEditor shows rate_bands table with Add/Remove
# [ ] InterestEditor shows start_basis dropdown
# [ ] TimelineEditor shows 3 payment delay fields (context-aware)
# [ ] LegalCostEditor shows arb_counsel_cr field
# [ ] UpfrontTailConfig shows custom grid toggle
# [ ] All existing fields still work
# [ ] Saving claim preserves new fields in localStorage
```

---

## PHASE 7: SERVER WIRING

**Goal**: Update the platform's Express server to call `engine/run_v2.py` (the new V2-powered entry point), serve all V2 output files, and wire up the downloads panel.

**Dependencies**: Phase 2 (run_v2.py exists), Phase 3 (all structures work)

### 7A. server/services/simulationRunner.js — Major Update (~100 lines changed)

**Current state**: Spawns `python -m engine.run` with `--config` and `--mode`.

**Changes**:
1. Change Python module from `engine.run` to `engine.run_v2`:
   ```javascript
   // OLD:  ['-m', 'engine.run', '--config', configPath, ...]
   // NEW:  ['-m', 'engine.run_v2', '--config', configPath, ...]
   ```

2. Update progress parsing for V2 output format. V2's `v2_run.py` prints:
   ```
   [PROGRESS] Running Monte Carlo... (N_PATHS paths)
   [PROGRESS] MC complete. Running analysis...
   [PROGRESS] Generating stochastic pricing grid...
   [PROGRESS] Generating pricing surface...
   [PROGRESS] Exporting dashboard JSON...
   [PROGRESS] Generating Excel reports...
   [PROGRESS] Generating charts...
   [PROGRESS] Generating PDF...
   [PROGRESS] Complete.
   ```
   Map these to progress percentages: 10%, 30%, 40%, 50%, 60%, 70%, 80%, 90%, 100%.

3. Update `_spawnPython()` working directory from `ENGINE_DIR` to `PLATFORM_DIR`:
   ```javascript
   // V2 core is now at engine/v2_core/, so working dir should be platform root
   const cwd = path.resolve(__dirname, '..', '..');  // claim-analytics-platform/
   ```

4. Add optional `--pricing-surface` flag pass-through:
   ```javascript
   if (config.pricing_surface?.enabled !== false) {
     args.push('--pricing-surface');
   }
   ```

5. Update `listRunFiles()` to include V2's additional output files:
   ```javascript
   const V2_OUTPUT_FILES = [
     'dashboard_data.json',
     'stochastic_pricing.json',
     'pricing_surface.json',
     'results.xlsx',
     'comprehensive_report.xlsx',
     'chart_data.xlsx',
     'report.pdf',
     'run_log.txt',
   ];
   ```

### 7B. server/config/defaults.json — Update (~80 lines added)

Add V2 parameters that were missing:

```json
{
  "simulation": {
    "sims_per_combo": 2000,
    "pricing_surface": {
      "enabled": true,
      "upfront_min": 5,
      "upfront_max": 35,
      "tail_min": 0,
      "tail_max": 40,
      "step": 1,
      "pricing_basis": "soc"
    }
  },
  "interest": {
    "start_basis": "award_date",
    "rate_bands": [{"rate": 9, "type": "simple", "probability": 1.0}]
  },
  "payment_delays": {
    "domestic": 6.0,
    "siac": 4.0,
    "re_arb": 6.0
  },
  "legal_costs": {
    "arb_counsel_cr": 8.0
  }
}
```

### 7C. server/routes/results.js — Update (~30 lines changed)

**Add**: Route for downloading charts as a zip:
```javascript
router.get('/:runId/charts.zip', async (req, res) => {
  // Create zip of all PNG files in runs/<runId>/outputs/charts/
});
```

**Add**: Route for serving stochastic_pricing.json and pricing_surface.json:
```javascript
router.get('/:runId/stochastic_pricing.json', ...);
router.get('/:runId/pricing_surface.json', ...);
```

(May already be covered by the wildcard `/:runId/*` route — verify and add explicit routes if needed for proper Content-Type headers.)

### 7D. server/routes/simulate.js — Update (~20 lines changed)

**Add**: Validate new config fields (sims_per_combo, interest.rate_bands, etc.)
**Add**: Pass `structure_type` to the Python process via config JSON.

### 7E. Downloads Panel Wiring

The `DownloadsPanel.jsx` (copied from claim-analytics in Phase 5) expects:
- `GET /api/results/:runId/files` → list of downloadable files
- `GET /api/results/:runId/:filename?download=1` → download file

Map to platform's routes:
- `GET /api/results/:runId/*` already serves files from run output directory
- `listRunFiles()` already categorizes files

**Integration in app/src/pages/PortfolioResults.jsx**:
- Add `<DownloadsPanel>` component overlay (slide-in from right)
- Add "Downloads" button in the results header
- Pass `runId` as prop

### Verification — Phase 7

```powershell
# 1. Start platform server
cd claim-analytics-platform/server; node server.js

# 2. Submit a simulation via API
$body = @{
  config = @{ simulation = @{ n_paths = 1000; seed = 42 } }
  mode = "portfolio"
} | ConvertTo-Json -Depth 5
Invoke-RestMethod -Uri "http://localhost:3001/api/simulate/portfolio" -Method Post -Body $body -ContentType "application/json"
# Expected: { runId: "uuid-...", status: "queued" }

# 3. Poll status
$runId = "..." # from above
Invoke-RestMethod -Uri "http://localhost:3001/api/status/$runId"
# Expected: status eventually becomes "completed"

# 4. Verify output files
Invoke-RestMethod -Uri "http://localhost:3001/api/results/$runId/files"
# Expected: lists dashboard_data.json, stochastic_pricing.json, results.xlsx, etc.

# 5. Download dashboard JSON
Invoke-RestMethod -Uri "http://localhost:3001/api/results/$runId/dashboard_data.json"
# Expected: JSON with simulation_meta, claims, investment_grid, etc.

# 6. Full E2E in browser:
# Start app (npm run dev), start dashboard (npm run dev), start server (node server.js)
# Create workspace → create claim → create portfolio → run simulation → view results
# [ ] All tabs render
# [ ] Downloads panel shows files
# [ ] Clicking download retrieves file
```

---

## PHASE 8: DEPLOYMENT

**Goal**: Update the Docker deployment to include V2 core files and handle the full pipeline.

**Dependencies**: All previous phases

### 8A. deploy/Dockerfile — Update (~15 lines changed)

**Current state**: Already has multi-stage build (frontend → runtime). Already copies `engine/`, `server/`, builds both React apps.

**Changes needed**:
1. The Dockerfile already copies `engine/` which now includes `engine/v2_core/`. **No change needed** — the `COPY engine/ ./engine/` line already captures v2_core/.

2. Update `engine/requirements.txt` to include V2's dependencies:
   ```
   # Existing
   numpy>=1.24.0
   scipy>=1.10.0
   pydantic>=2.0.0
   
   # Added for V2 core
   openpyxl>=3.1.0    # Excel generation
   matplotlib>=3.7.0   # Chart generation
   reportlab>=4.0.0    # PDF generation
   xlsxwriter>=3.1.0   # Alternative Excel
   ```

3. Verify `engine/v2_core/__init__.py` exists (created in Phase 1) so Python treats it as a package.

### 8B. deploy/nginx.conf — No changes needed

Current config already:
- Proxies `/api/` to Node Express on port 3001
- Serves dashboard SPA from `/dashboard/`
- Serves app SPA from `/` (catch-all)
- Has security headers

### 8C. deploy/supervisord.conf — No changes needed

Already runs Express server + nginx.

### 8D. deploy/docker-compose.yml — No changes needed

Already builds from Dockerfile and exposes port 80.

### 8E. engine/requirements.txt — Update

Add V2 dependencies (ensure these are in the file):

```
numpy>=1.24.0
scipy>=1.10.0
pydantic>=2.0.0
openpyxl>=3.1.0
matplotlib>=3.7.0
reportlab>=4.0.0
xlsxwriter>=3.1.0
```

### Verification — Phase 8

```powershell
# 1. Build Docker image
cd claim-analytics-platform
docker build -f deploy/Dockerfile -t claim-analytics-platform:latest .
# Expected: Build succeeds

# 2. Run container
docker run -d -p 8080:80 --name cap-test claim-analytics-platform:latest

# 3. Health check
Invoke-RestMethod -Uri "http://localhost:8080/api/health"
# Expected: { status: "ok" }

# 4. Test app shell
# Open http://localhost:8080/ in browser
# Expected: Landing page renders

# 5. Test dashboard
# Open http://localhost:8080/dashboard/ in browser
# Expected: Dashboard loading screen (needs data)

# 6. Full E2E test
# Login → Create workspace → Create claim → Create portfolio → Run simulation
# Wait for completion → View results → All tabs render → Download files

# 7. Cleanup
docker stop cap-test; docker rm cap-test
```

---

## PHASE 9: INTEGRATION TESTING & VERIFICATION

**Goal**: Verify the upgraded platform produces results matching V2's existing outputs. Create golden tests.

**Dependencies**: All previous phases

### 9A. Golden Test — TATA 6-Claim Portfolio

Create `engine/tests/test_golden.py` (~200 lines):

```python
"""Golden test: recreate the TATA 6-claim portfolio through the platform adapter
and verify results match V2's existing outputs."""

def test_6_claim_portfolio_moic():
    """Run 6-claim TATA portfolio, compare E[MOIC] at (10%, 20% tail) to V2 reference.
    
    Reference values (from outputs/dashboard_data.json):
      E[MOIC] at 10% upfront, 20% tail = X.XX (read from V2 output)
    
    Tolerance: ±0.02 (Monte Carlo variance with same seed should be deterministic)
    """

def test_6_claim_portfolio_irr():
    """Compare E[IRR] at sweet spot to V2 reference."""

def test_6_claim_portfolio_p_loss():
    """Compare P(Loss) at (10%, 20%) to V2 reference."""

def test_per_claim_win_rates():
    """Verify per-claim win rates match V2 (deterministic with same seed)."""

def test_probability_tree_path_counts():
    """Verify domestic claims produce 24 terminal paths, SIAC produce 8."""

def test_quantum_expected_value():
    """Verify E[Q|Win] ≈ 72% of SOC (matching V2's band distribution)."""
```

### 9B. Per-Structure Tests

Create `engine/tests/test_structures.py` (~250 lines):

```python
def test_litigation_funding_e2e():
    """Run LF structure: verify waterfall_grid in JSON, MOIC > 0 at reasonable points."""

def test_full_purchase_e2e():
    """Run full purchase: verify purchase_sensitivity in JSON, breakeven price exists."""

def test_staged_payment_e2e():
    """Run staged: verify milestone_analysis in JSON, trigger rates match expectations."""

def test_upfront_tail_e2e():
    """Run UT structure: verify investment_grid matches V2 format, 99+ grid cells."""

def test_comparative_e2e():
    """Run comparative: verify both structures in JSON, comparison section exists."""
```

### 9C. Edge Case Tests

Create `engine/tests/test_edge_cases.py` (~150 lines):

```python
def test_p_win_zero():
    """Claim with arb_win_probability = 0.01. All outcomes should be ~100% loss."""

def test_p_win_one():
    """Claim with arb_win_probability = 0.99. Should have near-zero loss probability."""

def test_single_claim_portfolio():
    """Portfolio with exactly 1 claim. Should match single-claim V2 output."""

def test_very_small_soc():
    """Claim with SOC = 0.01 Cr. Should not cause division errors."""

def test_single_quantum_band():
    """Claim with 1 quantum band (100% probability). Quantum should be deterministic."""

def test_mixed_jurisdiction():
    """Portfolio with 3 domestic + 3 SIAC claims. Both tree types should execute."""

def test_no_restart_mode():
    """all RESTART outcomes should remap to LOSE."""

def test_max_timeline_cap():
    """Claims exceeding max_horizon_months should be capped."""
```

### 9D. UI Integration Tests (manual checklist)

```
TATA 6-CLAIM PORTFOLIO RECREATION:
1. [ ] Create workspace "TATA v2 Verification"
2. [ ] Create 6 claims with exact TATA parameters:
       - TP-301-6: SOC=1532, domestic, prolongation
       - TP-302-3: SOC=23.13, domestic, change_of_law
       - TP-302-5: SOC=491.99, domestic, scope_variation
       - TP-CTP11-2: SOC=484, SIAC, construction
       - TP-CTP11-4: SOC=1368, SIAC, jv_dispute
       - TP-CTP13-2: SOC=1245, SIAC, construction
3. [ ] Create portfolio with Upfront+Tail structure
4. [ ] Set simulation params: n=10000, seed=42
5. [ ] Run simulation
6. [ ] Compare Executive Summary KPIs to V2 reference
7. [ ] Compare Investment Analysis heatmap to V2 reference
8. [ ] Compare Per-Claim win rates to V2 reference
9. [ ] Download Excel → spot-check 5 cells against V2 Excel

SINGLE STRUCTURE TESTS:
10. [ ] Create LF portfolio → run → verify Waterfall Analysis tab
11. [ ] Create Full Purchase portfolio → run → verify Purchase Sensitivity tab
12. [ ] Create Staged portfolio → run → verify Milestone Analysis tab
13. [ ] Create Comparative portfolio → run → verify side-by-side view

EDGE CASES:
14. [ ] Single-claim portfolio → all tabs work
15. [ ] Claim with very low P(win) → Executive Summary shows high P(Loss)
16. [ ] Toggle no_restart_mode → re-run → verify differences
```

### Verification — Phase 9

```powershell
# 1. Run all Python tests
cd claim-analytics-platform
python -m pytest engine/tests/ -v --tb=short

# 2. Run golden test specifically
python -m pytest engine/tests/test_golden.py -v

# 3. Run structure tests
python -m pytest engine/tests/test_structures.py -v

# 4. Run edge case tests
python -m pytest engine/tests/test_edge_cases.py -v

# Expected: ALL PASS
```

---

## PHASE SUMMARY & DEPENDENCY GRAPH

```
Phase 1: File Copying (mechanical)
   │
   ├──→ Phase 2: Adapter (new code)
   │       │
   │       └──→ Phase 3: Structure Extensions (new code)
   │               │
   │               └──→ Phase 4: Dashboard Adaptation
   │
   ├──→ Phase 5: App Shell UI Port
   │       │
   │       └──→ Phase 6: Claim Editor Fields
   │
   └──→ Phase 7: Server Wiring (needs Phase 2+3)
            │
            └──→ Phase 8: Deployment
                    │
                    └──→ Phase 9: Integration Testing (needs ALL)
```

**Parallel tracks**: Phases 5–6 (UI) can run in parallel with Phases 2–4 (engine + dashboard).

## FILE COUNT SUMMARY

| Phase | New Files | Modified Files | Copied Files | Deleted Files |
|---|---|---|---|---|
| 1 | 1 (__init__.py) | 23 (import rewriting) | 50+ (V2 py + dashboard + UI) | 0 |
| 2 | 3 (adapter.py, run_v2.py, adapter_test.py) | 0 | 0 | 0 |
| 3 | 3 (cashflow_ext, analysis_ext, exporter_ext) | 0 | 0 | 0 |
| 4 | 1 (v2/index.js) | 9 (App.jsx, dashboardData, 7 components) | 0 | 0 |
| 5 | 15 (landing pages, stores, utils) | 6 (App.jsx, Sidebar, TopBar, Login, Layout, authStore) | 0 | 0 |
| 6 | 0 | 6 (InterestEditor, TimelineEditor, LegalCostEditor, UpfrontTailConfig, SimSettings, schema.py) | 0 | 0 |
| 7 | 0 | 4 (simulationRunner, defaults.json, results.js, simulate.js) | 0 | 0 |
| 8 | 0 | 1 (requirements.txt) | 0 | 0 |
| 9 | 3 (test_golden, test_structures, test_edge_cases) | 0 | 0 | 0 |
| **Total** | **26** | **49** | **50+** | **0** |

## ESTIMATED SCOPE PER PHASE

| Phase | New lines | Modified lines | Complexity |
|---|---|---|---|
| 1 | ~40 | ~200 (imports) | Low — mechanical copy + find/replace |
| 2 | ~950 | 0 | High — adapter is critical bridge code |
| 3 | ~1050 | 0 | Medium — new functions following V2 patterns |
| 4 | ~330 | ~240 | Medium — wiring V2 components into platform shell |
| 5 | ~800 (from copies) | ~200 | Low-Medium — mostly copy + adapt imports |
| 6 | ~280 | ~40 | Medium — form development, schema updates |
| 7 | ~100 | ~180 | Medium — server integration |
| 8 | 0 | ~20 | Low — minimal Docker changes |
| 9 | ~600 | 0 | Medium — test writing |
