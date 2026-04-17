# Claim Analytics Platform — Architecture Document

**Version:** 1.0
**Date:** 20 March 2026
**Scope:** Complete system architecture for the Claim Analytics Platform — a professional litigation finance analytics system for modelling, simulating, and valuing arbitration claims and portfolios.

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [System Architecture Diagram](#2-system-architecture-diagram)
3. [Data Flow](#3-data-flow)
4. [Component Descriptions](#4-component-descriptions)
5. [Python Engine Module Map](#5-python-engine-module-map)
6. [React Dashboard Component Map](#6-react-dashboard-component-map)
7. [App Shell Page Map](#7-app-shell-page-map)
8. [Server API Reference](#8-server-api-reference)
9. [Investment Structure Reference](#9-investment-structure-reference)
10. [Jurisdiction Template Reference](#10-jurisdiction-template-reference)
11. [Data Schemas](#11-data-schemas)
12. [Port Assignments](#12-port-assignments)
13. [localStorage Schema](#13-localstorage-schema)
14. [Known Limitations](#14-known-limitations)
15. [IRR Methodology](#15-irr-methodology)

---

## 1. Executive Summary

The Claim Analytics Platform is a full-stack litigation finance analytics system designed for investment professionals evaluating arbitration claims. It models the complete lifecycle of an arbitration claim — from filing through post-award court challenges to cash collection — using stochastic Monte Carlo simulation. The platform supports two jurisdictions (Indian Domestic Arbitration and SIAC Singapore) with an extensible template system, and evaluates claims across five distinct investment structures: Litigation Funding, Full Purchase, Upfront + Tail, Staged Payments, and Comparative Analysis.

The platform separates the concept of a **Claim** (a legal object with jurisdiction-specific probability trees, quantum distributions, timelines, and legal costs) from a **Portfolio** (a financial object that bundles claims under an investment structure with pricing parameters). Users create workspaces, define claims with jurisdiction-calibrated defaults, run Monte Carlo simulations (10,000 paths default), and explore results through interactive dashboards featuring investment grids, cashflow waterfalls, J-curves, risk analytics, and 3D pricing surfaces.

The architecture follows a 4-component design: a **Python simulation engine** (NumPy/SciPy/Pydantic) handles all mathematical modelling; a **Node.js Express API server** orchestrates simulation jobs and serves results; a **React App Shell** manages workspaces, claim editing, and portfolio construction; and a **React Dashboard** provides rich data visualisation. All components communicate through well-defined JSON contracts, and the system is deployable via Docker Compose behind an Nginx reverse proxy.

---

## 2. System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                            USER BROWSER                                │
│                                                                        │
│   ┌──────────────────────┐         ┌──────────────────────────────┐   │
│   │    APP SHELL          │         │       DASHBOARD              │   │
│   │    React + Zustand    │         │       React + Recharts/D3   │   │
│   │    Port 5180          │         │       Port 5173             │   │
│   │                       │         │                              │   │
│   │  • Workspaces         │         │  • ExecutiveSummary          │   │
│   │  • ClaimEditor (7tab) │         │  • PricingGrid / Surface    │   │
│   │  • PortfolioBuilder   │         │  • CashflowWaterfall        │   │
│   │  • ClaimResults       │         │  • RiskAnalytics            │   │
│   │  • PortfolioResults   │  ──→    │  • StochasticPricing        │   │
│   │                       │ (opens) │  • D3ProbabilityTree        │   │
│   │  Stores:              │         │  • JCurveFanChart           │   │
│   │   authStore           │         │  • DistributionExplorer     │   │
│   │   claimStore          │         │  • ExportPanel              │   │
│   │   portfolioStore      │         │                              │   │
│   │   workspaceStore      │         │  Data: ?runId= or /data/    │   │
│   └──────────┬───────────┘         └──────────────┬───────────────┘   │
│              │ /api/*                              │ /api/results/*    │
└──────────────┼─────────────────────────────────────┼──────────────────┘
               │                                     │
┌──────────────▼─────────────────────────────────────▼──────────────────┐
│                        EXPRESS API SERVER                              │
│                        Node.js — Port 3001                            │
│                                                                        │
│  Routes:                        Services:                              │
│   /api/simulate/claim            configService (merge, validate)      │
│   /api/simulate/portfolio        simulationRunner (spawn, status)     │
│   /api/jurisdictions[/:id]       storageService (file I/O)            │
│   /api/claims                                                          │
│   /api/status/:runId            Config:                                │
│   /api/results/:runId/*          defaults.json (simulation params)    │
│   /api/defaults                                                        │
│   /api/health                   Runs:                                  │
│                                  runs/<runId>/config.json              │
│                                  runs/<runId>/status.json              │
│                                  runs/<runId>/outputs/*                │
└──────────────────────────────────┬────────────────────────────────────┘
                                   │ child_process.spawn()
                                   │ python engine/run.py --config ...
┌──────────────────────────────────▼────────────────────────────────────┐
│                        PYTHON ENGINE                                   │
│                        Python 3.11+ — NumPy, SciPy, Pydantic v2       │
│                                                                        │
│  Pipeline:                                                             │
│   1. Load & validate config (Pydantic v2)                             │
│   2. Load jurisdiction templates                                       │
│   3. Monte Carlo simulation (N paths × M claims)                      │
│   4. Compute claim summaries                                           │
│   5. Evaluate investment grid (structure-specific)                     │
│   6. Compute risk metrics (VaR, CVaR, concentration)                  │
│   7. Compute sensitivity (arb-win reweighting)                        │
│   8. Export JSON (dashboard_data.json)                                 │
│   9. Optional Excel export (openpyxl)                                  │
│                                                                        │
│  Models:   probability_tree, quantum_model, timeline_model,            │
│            legal_cost_model                                            │
│  Analysis: investment_grid, waterfall_analysis, risk_metrics,          │
│            sensitivity, pricing_surface                                │
│  Export:   json_exporter, claim_exporter, excel_writer, pdf_report    │
│  Config:   schema.py (21 Pydantic models), loader.py, defaults.py    │
│  Templates:indian_domestic.json, siac_singapore.json                  │
└───────────────────────────────────────────────────────────────────────┘
```

---

## 3. Data Flow

### 3.1 End-to-End: User Clicks "Run" to Seeing Results

```
User (App)                 Server (Express)              Engine (Python)
    │                           │                              │
    │  POST /api/simulate/      │                              │
    │  portfolio                │                              │
    │  {portfolio_config,       │                              │
    │   claims[]}               │                              │
    ├──────────────────────────→│                              │
    │                           │  validateConfig()            │
    │                           │  Create runs/<runId>/        │
    │                           │  Write config.json           │
    │                           │  Init status.json            │
    │                           │                              │
    │                           │  spawn python engine/run.py  │
    │  {runId, status:'queued'} │  --config config.json        │
    │←──────────────────────────│  --output-dir outputs/       │
    │                           │──────────────────────────────→
    │                           │                              │
    │  GET /api/status/:runId   │                              │ Load config
    │  (polling every 2s)       │                              │ Load templates
    ├──────────────────────────→│                              │
    │  {status:'running',       │                              │ MC simulation
    │   progress: 60}           │                              │ (10K paths)
    │←──────────────────────────│   Parse stdout progress      │
    │                           │←─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─│ stdout: "MC done"
    │                           │                              │
    │                           │                              │ Grid evaluation
    │                           │                              │ Risk metrics
    │                           │                              │ JSON export
    │                           │                              │
    │  GET /api/status/:runId   │                              │ Write files:
    ├──────────────────────────→│                              │  dashboard_data.json
    │  {status:'completed',     │   Read status.json           │  *.xlsx
    │   progress: 100}          │←─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─│  charts/
    │←──────────────────────────│                              │
    │                           │                              │
    │  Open Dashboard with      │                              │
    │  ?runId=<uuid>            │                              │
    │───────────────────→       │                              │
    │  (Dashboard)              │                              │
    │  GET /api/results/:runId/ │                              │
    │  dashboard_data.json      │                              │
    ├──────────────────────────→│                              │
    │  {structure_type,claims,  │  Serve from                  │
    │   investment_grid,...}    │  runs/<runId>/outputs/       │
    │←──────────────────────────│                              │
    │                           │                              │
    │  Render charts, grids,    │                              │
    │  tables, exports          │                              │
    └───────────────────────────┘──────────────────────────────┘
```

### 3.2 Claim Creation Flow

1. User selects jurisdiction in `ClaimEditor` → `JurisdictionSelector` component
2. `useClaims.fetchTemplate(jurisdictionId)` → `GET /api/jurisdictions/:id/defaults`
3. Server reads jurisdiction template JSON, merges with defaults → returns full `ClaimConfig`
4. User edits 7 tabs (Basics, Arbitration, Quantum, Tree, Timeline, Costs, Interest)
5. `claimStore.createClaim()` or `updateClaim()` → persisted to `localStorage`
6. Config changes mark claim status as `stale` (re-simulation needed)

### 3.3 Portfolio Construction Flow

1. User selects claims from workspace → `ClaimSelector` (multi-select)
2. User chooses investment structure → `StructureSelector` (5 types)
3. User configures structure parameters → structure-specific config component
4. User reviews summary + sets simulation params → `SimulationSettings`
5. `usePortfolioRun.submit()` → `POST /api/simulate/portfolio`
6. Polling loop → `GET /api/status/:runId` (every 2s)
7. On completion → redirect to `PortfolioResults` → opens Dashboard with `?runId=`

---

## 4. Component Descriptions

### 4.1 Python Engine

| Attribute | Value |
|-----------|-------|
| **Purpose** | Monte Carlo simulation, financial analytics, data export |
| **Tech Stack** | Python 3.11+, NumPy, SciPy, Pydantic v2, openpyxl (optional) |
| **Entry Point** | `engine/run.py` (CLI — invoked by server as subprocess) |
| **Port** | N/A (subprocess, not a service) |
| **Input** | `config.json` (PortfolioConfig + ClaimConfig[]) |
| **Output** | `dashboard_data.json`, `*.xlsx`, `charts/`, `claim_results.json` |

### 4.2 Express API Server

| Attribute | Value |
|-----------|-------|
| **Purpose** | API orchestration, Python job dispatch, file serving, config management |
| **Tech Stack** | Node.js 18+, Express 4, CORS, UUID, AJV |
| **Entry Point** | `server/server.js` |
| **Port** | 3001 (or `PORT` env var) |
| **State** | In-memory run status map + file-based persistence in `runs/` |

### 4.3 App Shell

| Attribute | Value |
|-----------|-------|
| **Purpose** | Workspace management, claim editing (7-tab wizard), portfolio construction (4-step wizard) |
| **Tech Stack** | React 18, Vite 5, React Router 6, Zustand, Tailwind CSS 3, Framer Motion, D3 |
| **Entry Point** | `app/src/main.jsx` |
| **Port** | 5180 |
| **State** | Zustand stores persisted to `localStorage` |

### 4.4 Results Dashboard

| Attribute | Value |
|-----------|-------|
| **Purpose** | Read-only interactive results visualisation (charts, grids, surfaces, exports) |
| **Tech Stack** | React 18, Vite 6, Recharts, D3.js, Plotly.js |
| **Entry Point** | `dashboard/src/main.jsx` |
| **Port** | 5173 |
| **Data** | Loads `dashboard_data.json` via `?runId=` param or static `/data/` path |

---

## 5. Python Engine Module Map

### 5.1 Configuration (`engine/config/`)

| File | Purpose | Key Exports | Dependencies |
|------|---------|-------------|-------------|
| `schema.py` | Canonical Pydantic v2 data contract (21 models) | `ClaimConfig`, `PortfolioConfig`, `SimulationConfig`, `PathResult`, `GridCellMetrics`, `JurisdictionTemplate`, all sub-models | pydantic |
| `loader.py` | Config loading, merging, validation | `load_claim_config()`, `load_portfolio_config()`, `merge_with_defaults()`, `validate_portfolio()` | schema.py, defaults.py |
| `defaults.py` | Default configurations and pre-built trees | `get_default_claim_config()`, `DEFAULT_QUANTUM_BANDS`, `DEFAULT_ARBITRATION_CONFIG` | schema.py |

### 5.2 Models (`engine/models/`)

| File | Purpose | Key Functions | Dependencies |
|------|---------|--------------|-------------|
| `probability_tree.py` | Generic jurisdiction tree walker | `simulate_challenge_tree()` — stochastic MC traversal; `simulate_full_challenge()` — scenario selector; `compute_tree_probabilities()` — exact DFS; `validate_tree()` | schema.py (`TreeNode`, `ChallengeResult`) |
| `quantum_model.py` | Quantum band draw and interest | `draw_quantum()` — band select + uniform draw; `compute_expected_quantum()` — analytical E[Q\|WIN]; `compute_interest_on_quantum()` — simple/compound | schema.py (`QuantumConfig`) |
| `timeline_model.py` | Pipeline duration simulation | `get_remaining_stages()` — filter from current stage; `draw_pipeline_duration()` — uniform draws per stage | schema.py (`TimelineConfig`, `StageConfig`) |
| `legal_cost_model.py` | Stage-based legal cost accrual | `_draw_overrun()` — ScaledBeta multiplier; `compute_stage_cost()` — base × overrun; `build_monthly_legal_costs()` — monthly burn array | schema.py (`LegalCostConfig`), scipy.stats |

### 5.3 Simulation (`engine/simulation/`)

| File | Purpose | Key Functions | Dependencies |
|------|---------|--------------|-------------|
| `monte_carlo.py` | Core MC loop orchestrating all models | `simulate_one_path()` — 6-layer stochastic path; `run_claim_simulation()` — N paths for one claim; `run_portfolio_simulation()` — aligned paths across claims; `compute_claim_summary()` — aggregate statistics | All 4 model files, schema.py |
| `cashflow_builder.py` | Structure-aware cashflow construction | `build_litigation_funding_cashflow()`, `build_full_purchase_cashflow()`, `build_upfront_tail_cashflow()`, `build_staged_payment_cashflow()` | metrics.py |
| `metrics.py` | Pure financial analytics | `compute_xirr()` — date-based; `compute_moic()`, `compute_var()`, `compute_cvar()`, `merge_dated_cashflows()` | numpy, scipy.optimize |

### 5.4 Analysis (`engine/analysis/`)

| File | Purpose | Key Functions | Dependencies |
|------|---------|--------------|-------------|
| `investment_grid.py` | Upfront × Tail pricing grid | `evaluate_upfront_tail_grid()` — Cartesian product evaluation; `find_breakeven_curve()` — max upfront where E[MOIC] ≥ 1.0 | cashflow_builder.py, metrics.py |
| `waterfall_analysis.py` | Litigation funding parameter grid | `evaluate_waterfall_grid()` — cost_multiple × award_ratio grid | cashflow_builder.py, metrics.py |
| `risk_metrics.py` | Portfolio risk analytics | `compute_portfolio_risk()` — VaR/CVaR, concentration, stress scenarios, capital-at-risk timeline | metrics.py |
| `sensitivity.py` | Arb-win probability sensitivity | `compute_arb_win_sensitivity()` — importance-weighted reweighting (no re-simulation) | cashflow_builder.py, metrics.py |
| `pricing_surface.py` | Fine-grained pricing surface | (Stub — fine-grained surface generation placeholder) | — |

### 5.5 Export (`engine/export/`)

| File | Purpose | Key Exports | Dependencies |
|------|---------|-------------|-------------|
| `json_exporter.py` | Dashboard JSON export | `build_dashboard_json()` → `dashboard_data.json` — 13+ sections for UI | All analysis modules |
| `claim_exporter.py` | Single claim results | `export_claim_results()` → `claim_results.json` | monte_carlo.py, probability_tree.py |
| `excel_writer.py` | Professional Excel workbook | 5 sheets: Executive Summary, Investment Grid, Per-Claim Analysis, Risk Metrics, Model Assumptions | openpyxl |
| `pdf_report.py` | PDF report generation | (Placeholder — ReportLab-based) | reportlab |

### 5.6 Jurisdictions (`engine/jurisdictions/`)

| File | Purpose |
|------|---------|
| `registry.py` | `JurisdictionRegistry` singleton — loads all `*.json` templates on init |
| `templates/indian_domestic.json` | Indian Domestic Arbitration: 24 terminal paths (S.34 → S.37 → SLP) |
| `templates/siac_singapore.json` | SIAC Singapore: 8 terminal paths (HC → COA), no restart support |

### 5.7 Orchestrator

| File | Purpose | Key Functions |
|------|---------|--------------|
| `run.py` | CLI entry point (invoked by server) | `run_pipeline()` — 10-step portfolio analysis; `run_claim_pipeline()` — single-claim analysis |

---

## 6. React Dashboard Component Map

### 6.1 Tab System

The dashboard uses an adaptive tab router — tabs shown depend on `structure_type`:

| Tab | Component | All Structures | Lit Funding | Full Purchase | Upfront+Tail | Staged | Comparative |
|-----|-----------|:-:|:-:|:-:|:-:|:-:|:-:|
| Executive Summary | `ExecutiveSummary` | ✓ | | | | | |
| Per-Claim Contribution | `PerClaimContribution` | ✓ | | | | | |
| Probability & Outcomes | `ProbabilityOutcomes` | ✓ | | | | | |
| Quantum & Timeline | `QuantumTimeline` | ✓ | | | | | |
| Cashflow & Waterfall | `CashflowWaterfall` | ✓ | | | | | |
| Risk Analytics | `RiskAnalytics` | ✓ | | | | | |
| Waterfall Analysis | `LitFundingWaterfall` | | ✓ | | | | |
| Purchase Sensitivity | `PurchaseSensitivity` | | | ✓ | | | |
| Pricing Grid | `PricingGrid` | | | | ✓ | | ✓ |
| Pricing Surface | `PricingSurface` | | | | ✓ | | ✓ |
| Stochastic Pricing | `StochasticPricing` | | | | ✓ | | ✓ |
| Milestone Analysis | `MilestoneAnalysis` | | | | | ✓ | |
| Comparative View | `ComparativeView` | | | | | | ✓ |
| Export & Reports | `ExportPanel` | ✓ | | | | | |

### 6.2 Component Details

| Component | Purpose | Data Requirements |
|-----------|---------|-------------------|
| `ExecutiveSummary` | Portfolio KPIs: total SOC, E[MOIC], P(Loss), XIRR, claim count | `claims[]`, `simulation_meta`, `investment_grid`/`waterfall_grid` |
| `PerClaimContribution` | Individual claim attribution charts | `claims[]`, `cashflow_analysis.per_claim` |
| `ProbabilityOutcomes` | Win/loss/challenge pie charts, tree probabilities | `probability_summary`, `claims[].outcome_distribution` |
| `QuantumTimeline` | Quantum distribution + payment timeline | `quantum_summary`, `timeline_summary`, `claims[]` |
| `CashflowWaterfall` | Cashflow breakdown and waterfall chart | `cashflow_analysis`, `waterfall` |
| `RiskAnalytics` | VaR, CVaR, concentration indices, stress scenarios | `risk` |
| `PricingGrid` | 2D heat map (upfront% × tail%) with E[MOIC] and P(Loss) | `investment_grid` |
| `PricingSurface` | 3D Plotly surface of MOIC across parameter space | `investment_grid` |
| `StochasticPricing` | Distribution analysis for selected grid cells | `investment_grid`, `jcurve_data` |
| `LitFundingWaterfall` | Litigation funding waterfall grid | `waterfall_grid` |
| `PurchaseSensitivity` | Price vs return sensitivity charts | `investment_grid` |
| `MilestoneAnalysis` | Staged payment milestone analysis | `cashflow_analysis` |
| `ComparativeView` | Multi-structure comparison | All grid/waterfall data |
| `ExportPanel` | Download JSON, CSV, Excel, PDF | `runId` for server download |
| `D3ProbabilityTree` | D3-rendered interactive probability tree | `probability_summary.trees` |
| `DistributionExplorer` | Interactive distribution histogram/CDF | `claims[].moic_distribution` |
| `JCurveFanChart` | Monthly cumulative cashflow percentile bands | `jcurve_data` |

### 6.3 Shared Components (`Shared.jsx`)

| Export | Purpose |
|--------|---------|
| `TabBar` | Horizontal tab navigation |
| `Card` | Container with border and padding |
| `SectionTitle` | Section heading with optional subtitle |
| `KPI` | Key performance indicator box |
| `LoadingScreen` | Full-screen skeleton loading animation |
| `ErrorScreen` | Error display with retry button |
| `ErrorBoundary` | React error boundary wrapper |
| `SkeletonPulse` | Pulsing skeleton loader element |
| `ChartLoading` | Chart-sized loading placeholder |

### 6.4 Theme System

The dashboard uses a design token system defined in `theme.js`:

- **COLORS**: `accent1`–`accent6`, `bg`, `card`, `cardBorder`, `text`, `textBright`, `textMuted`, `gradient1`/`gradient2`
- **FONT**: Default system font stack
- **UI Sizing**: `useUISettings()` hook → `ui.sizes.{xs, sm, md, lg, xl, xxl}`, `ui.space.{xs, sm, md, lg, xl, xxl}`
- **Text Scale**: 0.8 (compact), 1.0 (default), 1.2 (large) multipliers
- **Number Formatting**: `fmtCr()` — INR Crore formatter with adaptive decimal places

---

## 7. App Shell Page Map

### 7.1 Routes

| Route | Page | Purpose | Stores Used | Auth |
|-------|------|---------|-------------|------|
| `/` | `Landing` | Marketing landing page with features | — | Public |
| `/login` | `Login` | Authentication (mock login) | `authStore` | Guest only |
| `/workspaces` | `WorkspaceHome` | List/create workspaces | `workspaceStore` | Protected |
| `/workspace/:wsId` | `WorkspaceDashboard` | Workspace overview | `claimStore`, `portfolioStore` | Protected |
| `/workspace/:wsId/claims` | `ClaimList` | List claims with filters | `claimStore` | Protected |
| `/workspace/:wsId/claim/new` | `ClaimEditor` | Create new claim (7-tab wizard) | `claimStore`, `useClaims` | Protected |
| `/workspace/:wsId/claim/:id` | `ClaimEditor` | Edit existing claim | `claimStore`, `useClaims` | Protected |
| `/workspace/:wsId/claim/:id/results` | `ClaimResults` | Single claim results | `useClaimResults` | Protected |
| `/workspace/:wsId/portfolios` | `PortfolioList` | List portfolios | `portfolioStore` | Protected |
| `/workspace/:wsId/portfolio/new` | `PortfolioBuilder` | Create portfolio (4-step wizard) | `portfolioStore`, `usePortfolio` | Protected |
| `/workspace/:wsId/portfolio/:id` | `PortfolioBuilder` | Edit portfolio | `portfolioStore`, `usePortfolio` | Protected |
| `/workspace/:wsId/portfolio/:id/results` | `PortfolioResults` | Portfolio results + dashboard link | `usePortfolioRun` | Protected |

### 7.2 Claim Editor Tabs

| Tab | Component | Fields |
|-----|-----------|--------|
| Basics | `ClaimBasicsForm` | name, claimant, respondent, jurisdiction, soc_value_cr, currency, claim_type, claimant_share_pct, current_stage, perspective |
| Arbitration | `ArbitrationConfig` | win_probability (slider), re_arb_win_probability (slider) |
| Quantum | `QuantumModelEditor` | Bands table (low, high, probability), auto-normalize, E[Q\|WIN] display |
| Tree | `ProbabilityTreeEditor` | D3 tree for Scenario A/B, editable node probabilities and durations |
| Timeline | `TimelineEditor` | pre_arb_stages[], payment_delay_months, max_horizon_months |
| Costs | `LegalCostEditor` | One-time costs, per-stage cost table, ScaledBeta overrun params |
| Interest | `InterestEditor` | enabled toggle, rate slider, compounding radio, commencement_date |

### 7.3 Portfolio Builder Steps

| Step | Component | Purpose |
|------|-----------|---------|
| 0 | `ClaimSelector` | Multi-select claims from workspace (shows SOC, jurisdictions, avg win rate) |
| 1 | `StructureSelector` | Choose from 5 investment structures (card grid) |
| 2 | Structure-specific config | `LitFundingConfig`, `FullPurchaseConfig`, `UpfrontTailConfig`, `StagedPaymentConfig` |
| 3 | `SimulationSettings` + Review | n_paths, seed, discount_rate, risk_free_rate, start_date → Run button |

### 7.4 Zustand Stores

| Store | Key State | Persistence |
|-------|-----------|-------------|
| `authStore` | `user`, `isAuthenticated` | `localStorage` |
| `workspaceStore` | `workspaces[]`, `activeWorkspaceId` | `localStorage` key: `cap_workspaces` |
| `claimStore` | `claims[]`, `activeClaim` | `localStorage` key: `cap_ws_{wsId}_claims` |
| `portfolioStore` | `portfolios[]`, `activePortfolio` | `localStorage` key: `cap_ws_{wsId}_portfolios` |

---

## 8. Server API Reference

### 8.1 Simulation Endpoints

| Method | Path | Body | Response | Description |
|--------|------|------|----------|-------------|
| `POST` | `/api/simulate/claim` | `{claim_config, simulation}` | `{runId, status:'queued'}` | Launch single-claim simulation |
| `POST` | `/api/simulate/portfolio` | `{portfolio_config, claims[]}` | `{runId, status:'queued'}` | Launch portfolio simulation |

### 8.2 Status & Results

| Method | Path | Response | Description |
|--------|------|----------|-------------|
| `GET` | `/api/status/:runId` | `{status, progress, stage, startedAt, completedAt, error}` | Poll run status |
| `GET` | `/api/results/:runId/files` | `{files: [{name, path, type, size}]}` | List output files (categorised) |
| `GET` | `/api/results/:runId/*` | File content with appropriate Content-Type | Serve individual output files |

### 8.3 Jurisdiction & Claims

| Method | Path | Response | Description |
|--------|------|----------|-------------|
| `GET` | `/api/jurisdictions` | `[{id, name, description, country}]` | List jurisdiction templates |
| `GET` | `/api/jurisdictions/:id` | Full `JurisdictionTemplate` JSON | Get complete jurisdiction template |
| `GET` | `/api/jurisdictions/:id/defaults` | Default `ClaimConfig` for the jurisdiction | Get jurisdiction defaults |
| `GET` | `/api/claims` | `[{id, name, ...}]` | List stored claims |
| `POST` | `/api/claims` | `ClaimConfig` body | Store claim to disk |

### 8.4 Utility

| Method | Path | Response | Description |
|--------|------|----------|-------------|
| `GET` | `/api/defaults` | Server default config | Return defaults.json |
| `GET` | `/api/health` | `{status:'ok', timestamp}` | Health check |

---

## 9. Investment Structure Reference

### 9.1 Litigation Funding (`litigation_funding`)

The funder pays the claimant's legal costs in exchange for a share of any award.

**Investor cashflows:**
- **Outflow**: Cumulative legal costs over the claim lifecycle
- **Inflow (on WIN)**: `min(cost_multiple × total_costs, award_ratio × collected)` if `waterfall_type = "min"`, or `max(...)` if `waterfall_type = "max"`
- **Inflow (on LOSE)**: ₹0

**Parameters**: `cost_multiple_cap`, `award_ratio_cap`, `waterfall_type` (min/max), `cost_multiple_range`, `award_ratio_range`

**Grid**: Cost Multiple axis × Award Ratio axis → MOIC heat map

### 9.2 Full Purchase (`monetisation_full_purchase`)

The investor buys the claim outright for a fixed purchase price.

**Investor cashflows:**
- **Outflow (Month 0)**: `purchase_price` (as fraction of SOC or EV)
- **Outflow (ongoing, if `legal_cost_bearer = "investor"`)**: Legal costs
- **Inflow (on WIN)**: `purchased_share_pct × collected_cr`
- **Inflow (on LOSE)**: ₹0

**Parameters**: `purchase_prices[]`, `pricing_basis` (soc/ev), `legal_cost_bearer`, `investor_cost_share_pct`, `purchased_share_pct`

### 9.3 Upfront + Tail (`monetisation_upfront_tail`)

The investor pays an upfront percentage at close; the claimant keeps a "tail" percentage of any award.

**Investor cashflows:**
- **Outflow (Month 0)**: `upfront_pct × pricing_basis` (SOC or EV)
- **Inflow (on WIN)**: `(1 - claimant_tail_pct) × collected_cr`
- **Inflow (on LOSE)**: ₹0

**Parameters**: `upfront_range` (min, max, step), `tail_range` (min, max, step), `pricing_basis` (soc/ev/both)

**Grid**: Upfront% axis × Tail% axis → MOIC/XIRR/P(Loss) heat map

### 9.4 Staged Payments (`monetisation_staged`)

The investor makes milestone-triggered payments as the claim progresses through stages.

**Investor cashflows:**
- **Outflow**: Milestone payments triggered at specific stages (e.g., arb_commenced → ₹X Cr, award_received → ₹Y Cr)
- **Outflow (if `legal_cost_bearer = "investor"`)**: Legal costs
- **Inflow (on WIN)**: `purchased_share_pct × collected_cr`
- **Inflow (on LOSE)**: Partial recovery limited to milestones already paid

**Parameters**: `milestones[]` (milestone_name, payment_cr), `legal_cost_bearer`, `purchased_share_pct`

### 9.5 Comparative (`comparative`)

Runs both Litigation Funding and one Monetisation structure side-by-side for the same portfolio.

**Parameters**: `lit_funding_params` + `monetisation_params` (one of Full Purchase, Upfront+Tail, or Staged)

**Grid**: Shows both grids + comparative metrics

---

## 10. Jurisdiction Template Reference

### 10.1 JSON Format

```json
{
  "id": "string — unique key (e.g. 'indian_domestic')",
  "name": "string — display name (e.g. 'Indian Domestic Arbitration')",
  "description": "string — brief description",
  "country": "string — ISO 3166-1 alpha-2 (e.g. 'IN')",
  "institution": "string — arbitral institution name",
  "default_challenge_tree": {
    "scenario_a": {
      "root": {
        "name": "root",
        "probability": 1.0,
        "children": [
          {
            "name": "Stage Name",
            "probability": 0.XX,
            "children": [...],
            "outcome": null | "TRUE_WIN" | "LOSE",
            "duration_distribution": {"type": "uniform", "low": N, "high": M},
            "legal_cost": {"low": X, "high": Y}
          }
        ]
      },
      "description": "Scenario A: claimant won arbitration"
    },
    "scenario_b": {
      "root": { ... },
      "description": "Scenario B: claimant lost arbitration"
    }
  },
  "default_timeline": {
    "pre_arb_stages": [
      {"name": "stage_name", "duration_low": N, "duration_high": M, "legal_cost_low": X, "legal_cost_high": Y}
    ],
    "payment_delay_months": 6.0,
    "max_horizon_months": 96
  },
  "default_legal_costs": {
    "one_time_tribunal_cr": 6.0,
    "one_time_expert_cr": 2.0,
    "per_stage_costs": { ... },
    "overrun_alpha": 2.0,
    "overrun_beta": 5.0,
    "overrun_low": -0.10,
    "overrun_high": 0.60
  },
  "default_payment_delay_months": 6.0,
  "supports_restart": true | false,
  "enforcement_notes": "string — enforcement guidance"
}
```

### 10.2 Available Jurisdictions

| ID | Name | Country | Institution | Terminal Paths | Supports Restart |
|----|------|---------|-------------|----------------|:---------------:|
| `indian_domestic` | Indian Domestic Arbitration | IN | Ad-hoc (Indian Arbitration Act) | 24 (S.34 → S.37 → SLP) | ✓ |
| `siac_singapore` | SIAC Singapore | SG | SIAC | 8 (HC → COA) | ✗ |

### 10.3 Scenario Outcome Constraints

| Scenario | Allowed Outcomes | Meaning |
|----------|------------------|---------|
| Scenario A (claimant won) | `TRUE_WIN`, `LOSE` | Award survives or is permanently set aside |
| Scenario B (claimant lost) | `RESTART`, `LOSE` | Adverse award vacated (re-arb) or confirmed |

---

## 11. Data Schemas

### 11.1 Pydantic Model Hierarchy

```
QuantumBand
└─ QuantumConfig
    └─ ClaimConfig

TreeNode (recursive)
└─ ScenarioTree
    └─ ChallengeTreeConfig
        ├─ ClaimConfig
        └─ JurisdictionTemplate

StageConfig
└─ TimelineConfig
    ├─ ClaimConfig
    └─ JurisdictionTemplate

LegalCostConfig
├─ ClaimConfig
└─ JurisdictionTemplate

InterestConfig
└─ ClaimConfig

ArbitrationConfig
└─ ClaimConfig

ClaimConfig (central — carries all sub-configs)

_GridRange
├─ LitFundingParams
└─ UpfrontTailParams

LitFundingParams ─┐
FullPurchaseParams  ├─ PortfolioStructure.params (Union)
UpfrontTailParams  │
StagedPaymentParams┘

SimulationConfig
└─ PortfolioConfig

PortfolioStructure
└─ PortfolioConfig

PathResult (simulation output)
GridCellMetrics (grid evaluation output)
JurisdictionTemplate (jurisdiction definition)
```

### 11.2 Key Model Field Counts

| Model | Fields | Validators |
|-------|--------|-----------|
| `ClaimConfig` | 17 | 0 (sub-model validators handle this) |
| `PortfolioConfig` | 5 | 0 |
| `ChallengeTreeConfig` | 2 | 2 (scenario outcome constraints) |
| `TreeNode` | 6 | 2 (leaf/interior, children prob sum) |
| `QuantumConfig` | 1 (bands list) | 1 (prob sum) + computed field |
| `LegalCostConfig` | 8 | 1 (overrun range) |
| `PathResult` | 10 | 0 |
| `GridCellMetrics` | 8 | 0 |
| `JurisdictionTemplate` | 12 | 0 |

---

## 12. Port Assignments

| Service | Port | Protocol | Proxy Path (Nginx) |
|---------|------|----------|-------------------|
| App Shell | 5180 | HTTP | `/` (default) |
| Dashboard | 5173 | HTTP | `/dashboard/` |
| API Server | 3001 | HTTP | `/api/` |
| Python Engine | — | subprocess | N/A (invoked by server) |

In development, the App and Dashboard Vite configs proxy `/api/*` requests to `localhost:3001`.

---

## 13. localStorage Schema

All keys use the prefix `cap_` (Claim Analytics Platform).

| Key Pattern | Data Shape | Scope |
|-------------|------------|-------|
| `cap_auth` | `{user: {name, email}, isAuthenticated: bool}` | Global |
| `cap_workspaces` | `[{id, name, description, createdAt}]` | Global |
| `cap_ws_{wsId}_claims` | `[ClaimConfig]` — array of full claim configs | Per workspace |
| `cap_ws_{wsId}_portfolios` | `[{id, name, claimIds[], structure, simulation, status, runId}]` | Per workspace |

### Storage Size Estimates

| Workspace Size | Claims | Estimated Storage |
|----------------|--------|-------------------|
| Small | 1–5 claims | ~50 KB |
| Medium | 10–20 claims | ~200 KB |
| Large | 50+ claims | ~1 MB |

The platform is designed for eventual migration to a proper database. localStorage is used for prototype-stage development only.

---

## 14. Known Limitations

### 14.1 Not Yet Implemented

| Feature | Status | Notes |
|---------|--------|-------|
| PDF report generation | Placeholder | `engine/export/pdf_report.py` — ReportLab scaffolding only |
| Pricing surface analysis | Stub | `engine/analysis/pricing_surface.py` — header only |
| Respondent perspective | Schema supported | `perspective` field exists but engine always models claimant |
| Per-claim deal terms | Schema supports | Currently all claims share portfolio-level structure params |
| Database persistence | Designed for | Uses `localStorage`; migration path to PostgreSQL documented |
| Authentication | Mock only | `authStore` uses mock login; needs JWT/OAuth integration |
| Multi-user workspaces | Not started | Single-user only; workspace sharing not implemented |
| Real-time collaboration | Not started | No WebSocket layer |
| Enforcement risk modelling | Not modelled | Jurisdiction templates include `enforcement_notes` but no probabilistic model |
| Currency conversion | Not supported | All values in single currency (₹ Cr default) |
| Correlation between claims | Not modelled | Claims are independent; no portfolio correlation structure |

### 14.2 Known Constraints

- **Maximum simulation paths**: 1,000,000 (Pydantic validation limit)
- **Maximum horizon**: 360 months / 30 years (capped in `TimelineConfig`)
- **Grid resolution**: Limited by combinatorial explosion — 10×10 = 100 cells × N paths each
- **Browser storage**: `localStorage` limited to ~5–10 MB depending on browser
- **Python subprocess**: Each simulation run spawns a new Python process (no persistent worker pool)

---

## 15. IRR Methodology

### Expected Cashflow IRR (Primary Metric)

The platform computes E[IRR] using the expected cashflow method:

1. For each Monte Carlo path, build the full dated cashflow stream for the portfolio
2. Aggregate cashflows across all paths at each date point to compute the expected (mean) cashflow
3. Compute XIRR on the resulting expected cashflow stream

This approach is preferred over averaging per-path IRRs because:

- IRR is a non-linear function, so arithmetic mean of IRRs is not equal to IRR of mean cashflows
- Total-loss paths (IRR = -100%) can dominate arithmetic averages and distort E[IRR]
- Expected-cashflow IRR is consistent with E[MOIC] and better reflects investor expected return

### Per-Path IRR Distribution (Secondary Metric)

The system still computes per-path IRRs for distribution analytics (histograms, percentiles, VaR/CVaR, hurdle probability), but these are secondary diagnostics and are not used as the primary E[IRR] KPI.

---

<!-- AUTO-GENERATED: FILE_MAP -->

## Project File Map

**Generated:** 2026-03-20 07:19

```
claim-analytics-platform/
├── app/
│   ├── src/
│   │   ├── components/
│   │   ├── hooks/
│   │   ├── layouts/
│   │   ├── pages/
│   │   ├── store/
│   │   ├── App.jsx
│   │   ├── index.css
│   │   └── main.jsx
│   ├── index.html
│   ├── package-lock.json
│   ├── package.json
│   ├── postcss.config.js
│   ├── tailwind.config.js
│   └── vite.config.js
├── dashboard/
│   ├── src/
│   │   ├── components/
│   │   ├── data/
│   │   ├── App.jsx
│   │   ├── main.jsx
│   │   └── theme.js
│   ├── index.html
│   ├── package-lock.json
│   ├── package.json
│   └── vite.config.js
├── deploy/
│   ├── .env.example
│   ├── deploy.sh
│   ├── docker-compose.yml
│   ├── Dockerfile
│   ├── nginx.conf
│   ├── README.md
│   └── supervisord.conf
├── docs/
│   ├── API_CONTRACTS.md
│   ├── ARCHITECTURE.md
│   ├── DESIGN_DECISIONS.md
│   ├── JURISDICTION_GUIDE.md
│   └── SCHEMA_REFERENCE.md
├── engine/
│   ├── analysis/
│   │   ├── __init__.py
│   │   ├── investment_grid.py
│   │   ├── pricing_surface.py
│   │   ├── risk_metrics.py
│   │   ├── sensitivity.py
│   │   └── waterfall_analysis.py
│   ├── config/
│   │   ├── __init__.py
│   │   ├── defaults.py
│   │   ├── loader.py
│   │   └── schema.py
│   ├── export/
│   │   ├── __init__.py
│   │   ├── claim_exporter.py
│   │   ├── excel_writer.py
│   │   ├── json_exporter.py
│   │   └── pdf_report.py
│   ├── jurisdictions/
│   │   ├── __init__.py
│   │   ├── indian_domestic.json
│   │   ├── registry.py
│   │   └── siac_singapore.json
│   ├── models/
│   │   ├── __init__.py
│   │   ├── legal_cost_model.py
│   │   ├── probability_tree.py
│   │   ├── quantum_model.py
│   │   └── timeline_model.py
│   ├── simulation/
│   │   ├── __init__.py
│   │   ├── cashflow_builder.py
│   │   ├── metrics.py
│   │   └── monte_carlo.py
│   ├── templates/
│   │   ├── indian_domestic_change_of_law.json
│   │   ├── indian_domestic_prolongation.json
│   │   ├── siac_construction_dispute.json
│   │   └── siac_jv_dispute.json
│   ├── tests/
│   │   ├── __init__.py
│   │   ├── test_jurisdictions.py
│   │   ├── test_metrics.py
│   │   ├── test_monte_carlo.py
│   │   ├── test_probability_tree.py
│   │   ├── test_quantum.py
│   │   └── test_tata_portfolio.json
│   ├── __init__.py
│   ├── requirements.txt
│   └── run.py
├── outputs_test/
│   └── dashboard_data.json
├── scripts/
│   └── update_docs.py
├── server/
│   ├── config/
│   │   └── defaults.json
│   ├── routes/
│   │   ├── claims.js
│   │   ├── jurisdictions.js
│   │   ├── portfolios.js
│   │   ├── results.js
│   │   ├── simulate.js
│   │   └── templates.js
│   ├── services/
│   │   ├── configService.js
│   │   ├── simulationRunner.js
│   │   └── storageService.js
│   ├── package-lock.json
│   ├── package.json
│   └── server.js
├── test_outputs/
│   └── dashboard_data.json
├── .dockerignore
└── README.md
```
<!-- /AUTO-GENERATED: FILE_MAP -->
<!-- This section is updated by scripts/update_docs.py -->
<!-- AUTO-GENERATED: DEPENDENCIES -->

## Dependency Versions

**Generated:** 2026-03-20 07:19

### Python Engine (`engine/requirements.txt`)

| Package | Version |
|---------|---------|
| numpy | ≥1.24 |
| scipy | ≥1.11 |
| matplotlib | ≥3.7 |
| openpyxl | ≥3.1 |
| reportlab | ≥4.0 |
| pydantic | ≥2.0 |

### Server (`server/package.json`)

| Package | Version | Type |
|---------|---------|------|
| ajv | ^8.17.0 | prod |
| cors | ^2.8.5 | prod |
| express | ^4.21.0 | prod |
| uuid | ^10.0.0 | prod |

### App (`app/package.json`)

| Package | Version | Type |
|---------|---------|------|
| d3 | ^7.9.0 | prod |
| framer-motion | ^11.12.0 | prod |
| lucide-react | ^0.460.0 | prod |
| react | ^18.3.0 | prod |
| react-dom | ^18.3.0 | prod |
| react-router-dom | ^6.28.0 | prod |
| zustand | ^4.5.0 | prod |
| @vitejs/plugin-react | ^4.3.0 | dev |
| autoprefixer | ^10.4.0 | dev |
| postcss | ^8.4.0 | dev |
| tailwindcss | ^3.4.0 | dev |
| vite | ^5.4.0 | dev |

### Dashboard (`dashboard/package.json`)

| Package | Version | Type |
|---------|---------|------|
| d3 | ^7.9.0 | prod |
| plotly.js | ^2.35.0 | prod |
| react | ^18.3.0 | prod |
| react-dom | ^18.3.0 | prod |
| react-plotly.js | ^2.6.0 | prod |
| recharts | ^2.13.0 | prod |
| @vitejs/plugin-react | ^4.3.0 | dev |
| vite | ^6.0.0 | dev |

<!-- /AUTO-GENERATED: DEPENDENCIES -->
<!-- This section is updated by scripts/update_docs.py -->
