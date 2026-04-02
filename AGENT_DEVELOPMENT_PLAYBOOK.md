# Agent Development Playbook — Bug Fixes & Feature Development

> **For:** AI agents (Claude Opus, etc.) and human developers working on this codebase.
> **Goal:** Fix bugs and add features without breaking existing functionality, from local dev through production.

---

## Critical Rules

1. **Never modify a working file without reading it first.** Understand the full file before editing.
2. **Never remove existing functionality** when fixing a bug or adding a feature.
3. **Test locally before pushing.** Every push auto-deploys to production.
4. **One concern per commit.** Don't mix unrelated changes.
5. **Use relative URLs** — never hardcode `localhost` or IP addresses in frontend code.
6. **Use `generateUUID()`** from `utils/uuid.js` — never use `crypto.randomUUID()` directly (breaks on HTTP).

---

## Codebase Map

```
claim-analytics-platform/
│
├── app/                          ← MAIN APP (React 18 + Vite 5 + Tailwind + Zustand)
│   ├── src/
│   │   ├── App.jsx               ← Route definitions (React Router 6)
│   │   ├── main.jsx              ← Entry point
│   │   ├── index.css             ← Global styles (Tailwind)
│   │   ├── components/
│   │   │   ├── claim/            ← Claim editor form components
│   │   │   │   ├── ClaimBasicsForm.jsx
│   │   │   │   ├── JurisdictionSelector.jsx
│   │   │   │   ├── QuantumModelEditor.jsx
│   │   │   │   ├── ProbabilityTreeEditor.jsx
│   │   │   │   ├── TimelineEditor.jsx
│   │   │   │   ├── LegalCostEditor.jsx
│   │   │   │   ├── InterestEditor.jsx
│   │   │   │   └── ArbitrationConfig.jsx
│   │   │   ├── portfolio/        ← Portfolio builder components
│   │   │   │   ├── ClaimSelector.jsx
│   │   │   │   ├── StructureSelector.jsx
│   │   │   │   ├── UpfrontTailConfig.jsx
│   │   │   │   ├── LitFundingConfig.jsx
│   │   │   │   ├── FullPurchaseConfig.jsx
│   │   │   │   ├── StagedPaymentConfig.jsx
│   │   │   │   └── SimulationSettings.jsx
│   │   │   ├── simulation/       ← Simulation run & results
│   │   │   │   ├── RunPanel.jsx
│   │   │   │   ├── DownloadsPanel.jsx
│   │   │   │   └── ValidationBanner.jsx
│   │   │   ├── workspace/        ← Workspace management
│   │   │   │   ├── WorkspaceCard.jsx
│   │   │   │   └── WorkspaceSidebar.jsx
│   │   │   ├── layout/           ← Shell layout
│   │   │   │   ├── Sidebar.jsx
│   │   │   │   └── TopBar.jsx
│   │   │   ├── landing/          ← Marketing landing page
│   │   │   ├── ErrorBoundary.jsx
│   │   │   ├── Skeleton.jsx
│   │   │   └── Toast.jsx
│   │   ├── pages/                ← Full page components (routed)
│   │   │   ├── Landing.jsx       ← / (public)
│   │   │   ├── Login.jsx         ← /login
│   │   │   ├── Signup.jsx        ← /signup
│   │   │   ├── WorkspaceHome.jsx ← /workspaces
│   │   │   ├── WorkspaceDashboard.jsx ← /workspace/:wsId
│   │   │   ├── ClaimList.jsx     ← /workspace/:wsId/claims
│   │   │   ├── ClaimEditor.jsx   ← /workspace/:wsId/claim/new or /claim/:id
│   │   │   ├── ClaimResults.jsx  ← /workspace/:wsId/claim/:id/results
│   │   │   ├── PortfolioList.jsx ← /workspace/:wsId/portfolios
│   │   │   ├── PortfolioBuilder.jsx ← /workspace/:wsId/portfolio/new or /:id
│   │   │   ├── PortfolioResults.jsx ← /workspace/:wsId/portfolio/:id/results
│   │   │   ├── Home.jsx          ← /workspace/:wsId/home
│   │   │   ├── History.jsx       ← /workspace/:wsId/history
│   │   │   └── Profile.jsx       ← /workspace/:wsId/profile
│   │   ├── store/                ← Zustand state management
│   │   │   ├── authStore.js      ← Login/logout, mock JWT, localStorage "cap_auth"
│   │   │   ├── workspaceStore.js ← Workspaces CRUD, localStorage "cap_workspaces"
│   │   │   ├── claimStore.js     ← Claims CRUD, localStorage "cap_claims"
│   │   │   ├── portfolioStore.js ← Portfolios CRUD, localStorage "cap_portfolios"
│   │   │   └── themeStore.js     ← Dark/light mode
│   │   ├── hooks/                ← Custom React hooks
│   │   │   ├── useClaims.js      ← Claim operations
│   │   │   ├── useClaimSimulation.js ← Single claim sim
│   │   │   ├── usePortfolio.js   ← Portfolio operations
│   │   │   └── useSimulation.js  ← Portfolio sim
│   │   ├── utils/
│   │   │   ├── uuid.js           ← HTTP-safe UUID generator (USE THIS, not crypto.randomUUID)
│   │   │   └── demoLoader.js     ← Demo data loader
│   │   └── layouts/
│   │       ├── DashboardLayout.jsx ← Authenticated shell (TopBar + Sidebar + Outlet)
│   │       └── PublicLayout.jsx    ← Public shell
│   └── vite.config.js            ← Dev proxy: /api → :3001, alias @dashboard
│
├── dashboard/                    ← RESULTS DASHBOARD (React 18 + Vite 6 + Recharts + D3 + Plotly)
│   ├── src/
│   │   ├── App.jsx               ← Dashboard root (tab-based UI)
│   │   ├── main.jsx              ← Entry point
│   │   ├── data/dashboardData.js ← Data fetcher for dashboard JSON
│   │   ├── components/v2/        ← Active components (use these)
│   │   │   ├── ExecutiveSummary.jsx
│   │   │   ├── ProbabilityAnalysis.jsx
│   │   │   ├── ProbabilityOutcomes.jsx
│   │   │   ├── ProbabilityTree.jsx
│   │   │   ├── ProbabilitySensitivity.jsx
│   │   │   ├── QuantumTimeline.jsx
│   │   │   ├── CashflowAnalysis.jsx
│   │   │   ├── CashflowWaterfall.jsx
│   │   │   ├── InvestmentAnalysis.jsx
│   │   │   ├── InvestmentSOC.jsx
│   │   │   ├── InvestmentEQ.jsx
│   │   │   ├── LegalCosts.jsx
│   │   │   ├── PricingSurface.jsx
│   │   │   ├── StochasticPricing.jsx
│   │   │   ├── BreakevenAnalysis.jsx
│   │   │   ├── PerClaimAnalysis.jsx
│   │   │   ├── ScenarioMatrix.jsx
│   │   │   ├── D3ProbabilityTree.jsx
│   │   │   ├── DistributionExplorer.jsx
│   │   │   ├── JCurveFanChart.jsx
│   │   │   ├── ReportCharts.jsx
│   │   │   ├── WaterfallChart.jsx
│   │   │   ├── PortfolioSelector.jsx
│   │   │   ├── Shared.jsx
│   │   │   ├── theme.js
│   │   │   └── index.js
│   │   └── components/           ← Legacy components (may still be imported)
│   └── vite.config.js            ← VITE_BASE_PATH for /dashboard/ prefix
│
├── server/                       ← API SERVER (Node.js 20 + Express 4)
│   ├── server.js                 ← Main entry — middleware, routes, static serving
│   ├── routes/
│   │   ├── simulate.js           ← POST /api/simulate/claim, /api/simulate/portfolio
│   │   ├── results.js            ← GET /api/status/:runId, /api/results/:runId/*
│   │   ├── jurisdictions.js      ← GET /api/jurisdictions, /api/jurisdictions/:id
│   │   ├── claims.js             ← GET/POST /api/claims
│   │   ├── portfolios.js         ← GET/POST /api/portfolios
│   │   └── templates.js          ← GET /api/templates
│   ├── services/
│   │   ├── simulationRunner.js   ← Spawns Python engine as child process
│   │   ├── configService.js      ← Loads defaults, merges configs
│   │   └── storageService.js     ← File-based storage for claims/portfolios
│   └── config/
│       └── defaults.json         ← Default simulation parameters
│
├── engine/                       ← PYTHON SIMULATION ENGINE (Python 3.11)
│   ├── adapter.py                ← Platform → V2 bridge (monkey-patches v2_master_inputs)
│   ├── run.py                    ← Entry point for server-spawned runs
│   ├── run_v2.py                 ← Direct V2 runner
│   ├── config/
│   │   ├── schema.py             ← Pydantic models (ClaimConfig, PortfolioConfig, etc.)
│   │   ├── defaults.py           ← Default values
│   │   └── loader.py             ← Config loading utilities
│   ├── v2_core/                  ← V2 simulation engine (23 modules)
│   │   ├── v2_config.py          ← ClaimConfig dataclass, PathResult, SimulationResults
│   │   ├── v2_master_inputs.py   ← All simulation constants (monkey-patched by adapter)
│   │   ├── v2_monte_carlo.py     ← Core Monte Carlo simulation
│   │   ├── v2_probability_tree.py ← Challenge probability tree
│   │   ├── v2_quantum_model.py   ← Quantum outcome model
│   │   ├── v2_timeline_model.py  ← Timeline duration model
│   │   ├── v2_legal_cost_model.py ← Legal cost model
│   │   ├── v2_cashflow_builder.py ← Cashflow construction
│   │   ├── v2_metrics.py         ← MOIC, IRR, breakeven calculations
│   │   ├── v2_investment_analysis.py ← Grid analysis
│   │   ├── v2_stochastic_pricing.py ← Stochastic pricing
│   │   ├── v2_pricing_surface.py  ← Pricing surface
│   │   ├── v2_probability_sensitivity.py ← Sensitivity analysis
│   │   ├── v2_json_exporter.py   ← JSON export for dashboard
│   │   ├── v2_excel_writer.py    ← Excel export
│   │   ├── v2_comprehensive_excel.py ← Comprehensive Excel report
│   │   ├── v2_pdf_report.py      ← PDF report
│   │   ├── v2_report_charts.py   ← Chart images
│   │   ├── v2_run.py             ← V2 run orchestrator
│   │   ├── v2_validate.py        ← Input validation
│   │   ├── v2_audit.py           ← Audit trail
│   │   ├── v2_cashflow_builder_ext.py ← Extended cashflow (lit funding, full purchase, staged)
│   │   ├── v2_investment_analysis_ext.py ← Extended investment analysis
│   │   └── v2_json_exporter_ext.py ← Extended JSON export
│   ├── models/                   ← Platform-native models (wrapping V2)
│   ├── simulation/               ← Platform simulation runners
│   ├── analysis/                 ← Platform analysis modules
│   ├── export/                   ← Platform export modules
│   ├── jurisdictions/            ← Jurisdiction templates (JSON)
│   │   ├── indian_domestic.json
│   │   └── siac_singapore.json
│   ├── templates/                ← Claim templates (JSON)
│   └── tests/                    ← Python tests
│
├── deploy/                       ← DEPLOYMENT CONFIG
│   ├── Dockerfile                ← Multi-stage Docker build
│   ├── docker-compose.yml        ← Local Docker Compose
│   ├── nginx.conf                ← Nginx reverse proxy config
│   ├── supervisord.conf          ← Process manager config
│   ├── deploy.sh                 ← Manual deploy script
│   └── .env.example              ← Example environment variables
│
├── .github/workflows/
│   └── deploy.yml                ← CI/CD pipeline (GitHub Actions)
│
├── scripts/                      ← Utility scripts
├── docs/                         ← Additional documentation
├── DEPLOYMENT_WORKFLOW.md         ← How to deploy (step-by-step)
└── package.json                  ← Root workspace scripts (npm run dev, test, build)
```

---

## User Flow & Route Map

```
Landing (/)  ──►  Login (/login)  ──►  Workspace List (/workspaces)
                                              │
                                    ┌─────────┘
                                    ▼
                    Workspace Dashboard (/workspace/:wsId)
                    ├── Claims (/workspace/:wsId/claims)
                    │   ├── New Claim (/workspace/:wsId/claim/new)
                    │   ├── Edit Claim (/workspace/:wsId/claim/:id)
                    │   └── Claim Results (/workspace/:wsId/claim/:id/results)
                    ├── Portfolios (/workspace/:wsId/portfolios)
                    │   ├── New Portfolio (/workspace/:wsId/portfolio/new)
                    │   ├── Edit Portfolio (/workspace/:wsId/portfolio/:id)
                    │   └── Portfolio Results (/workspace/:wsId/portfolio/:id/results)
                    ├── Home (/workspace/:wsId/home)
                    ├── History (/workspace/:wsId/history)
                    └── Profile (/workspace/:wsId/profile)
```

---

## API Endpoints

| Method | Path | Purpose | Handler |
|--------|------|---------|---------|
| GET | `/api/health` | Health check | `server.js` |
| GET | `/api/defaults` | Server default config | `server.js` → `configService.js` |
| GET | `/api/jurisdictions` | List jurisdictions | `routes/jurisdictions.js` |
| GET | `/api/jurisdictions/:id` | Get jurisdiction template | `routes/jurisdictions.js` |
| GET | `/api/jurisdictions/:id/defaults` | Jurisdiction defaults | `routes/jurisdictions.js` |
| POST | `/api/simulate/claim` | Run single-claim simulation | `routes/simulate.js` |
| POST | `/api/simulate/portfolio` | Run portfolio simulation | `routes/simulate.js` |
| GET | `/api/status/:runId` | Poll simulation status | `routes/results.js` |
| GET | `/api/results/:runId/files` | List output files | `routes/results.js` |
| GET | `/api/results/:runId/*` | Serve output file | `routes/results.js` |
| GET | `/api/claims` | List stored claims | `routes/claims.js` |
| POST | `/api/claims` | Store a claim | `routes/claims.js` |
| GET | `/api/templates` | List templates | `routes/templates.js` |

---

## State Management (Zustand Stores)

All stores persist to localStorage. **Never remove persisted keys** or change key names without migration.

| Store | localStorage Key | State | Notes |
|-------|-----------------|-------|-------|
| `authStore` | `cap_auth` | `{ user, token, isAuthenticated }` | Mock JWT auth |
| `workspaceStore` | `cap_workspaces` | `{ workspaces[], activeWorkspaceId }` | Workspace CRUD |
| `claimStore` | `cap_claims` | `{ claims[] }` | Claim CRUD, filtered by workspace |
| `portfolioStore` | `cap_portfolios` | `{ portfolios[] }` | Portfolio CRUD |
| `themeStore` | `cap_theme` | `{ theme }` | Dark/light mode |

---

## How to Fix a Bug (Step-by-Step)

### 1. Identify the Problem

- **UI bug?** → Check browser console (F12) for errors. The bug is in `app/src/`.
- **Dashboard chart wrong?** → Check `dashboard/src/components/v2/`.
- **API error (4xx/5xx)?** → Check `server/routes/` and `server/services/`.
- **Simulation wrong numbers?** → Check `engine/v2_core/` and `engine/adapter.py`.
- **Blank page?** → Check the route in `App.jsx`, check for missing imports.

### 2. Read the Affected File(s)

**Always read the full file before editing.** Key files to check for common bugs:

```
# UI / Routing
app/src/App.jsx                    ← All routes defined here
app/src/layouts/DashboardLayout.jsx ← Auth-protected layout wrapper
app/src/store/*.js                 ← State management (check persistence)

# API
server/server.js                   ← Route registration order matters
server/routes/simulate.js          ← Simulation dispatch
server/services/simulationRunner.js ← Python process spawning

# Engine
engine/adapter.py                  ← Platform→V2 bridge (complex, be careful)
engine/run.py                      ← Entry point for simulations
engine/config/schema.py            ← Pydantic schemas (config validation)
```

### 3. Make the Fix

**Rules for safe edits:**

- **Edit only the broken part.** Don't reformat, restructure, or "clean up" surrounding code.
- **Keep all existing imports.** Don't remove imports even if they look unused (they may be used dynamically).
- **Match existing style.** If the file uses `const`, don't switch to `let`. If it uses arrow functions, keep using them.
- **Preserve existing JSDoc/comments.** Don't add or remove comments unless directly related to your fix.

### 4. Test Locally

```bash
# Start all services
cd claim-analytics-platform
npm run dev

# Test full flow:
# 1. Open http://localhost:5180
# 2. Login (any email/password)
# 3. Create workspace
# 4. Create claim → run simulation
# 5. Create portfolio → run simulation
# 6. View results dashboard
```

### 5. Deploy

```bash
git add .
git commit -m "fix: description of what was broken and how it was fixed"
git push
```

Monitor at: `gh run watch` or https://github.com/itsnilay87/claim-analytics-platform/actions

### 6. Verify in Production

```bash
ssh root@178.104.35.208 "docker logs claim-analytics-web-1 --tail 30"
# Visit http://178.104.35.208 and test the fix
```

---

## How to Add a New Feature (Step-by-Step)

### 1. Plan the Changes

Before writing code, identify ALL files that need to change:

- **New page?** → Page component + route in `App.jsx` + sidebar link in `Sidebar.jsx`
- **New API endpoint?** → Route file + register in `server.js`
- **New store?** → Store file + hook + import in components
- **New engine feature?** → V2 module + adapter update + JSON exporter update

### 2. Add in This Order (Dependencies First)

```
1. Engine changes (Python)      ← data layer
2. Server changes (Node.js)     ← API layer
3. Store changes (Zustand)      ← state layer
4. Hooks changes                ← data access layer
5. Component changes (React)    ← UI layer
6. Route changes (App.jsx)      ← navigation layer
```

### 3. Don't Break Existing Features

**Checklist before committing:**

- [ ] Existing login flow still works
- [ ] Existing workspace creation still works
- [ ] Existing claim editor loads and saves
- [ ] Existing portfolio builder loads and saves
- [ ] Existing simulation still runs and returns results
- [ ] Existing dashboard tabs still render
- [ ] Existing download/export still works
- [ ] No hardcoded `localhost` URLs anywhere
- [ ] No direct `crypto.randomUUID()` calls
- [ ] No removed localStorage keys that existing users depend on

### 4. Test the Full Flow Locally

```bash
npm run dev
# Walk through the FULL user journey:
# Landing → Login → Create Workspace → Create Claim → Edit Claim →
# Run Claim Sim → View Results → Create Portfolio → Add Claims →
# Run Portfolio Sim → View Portfolio Results → Download Files
```

### 5. Deploy

Same as bug fix: `git add . && git commit -m "feat: description" && git push`

---

## Known Gotchas & Pitfalls

### 1. `crypto.randomUUID()` — WILL BREAK ON HTTP

```javascript
// ❌ WRONG — crashes on http://178.104.35.208 (non-secure context)
const id = crypto.randomUUID();

// ✅ CORRECT — import the safe version
import { generateUUID } from '../utils/uuid';
const id = generateUUID();
```

This has been fixed in: `authStore.js`, `workspaceStore.js`, `claimStore.js`, `portfolioStore.js`, `demoLoader.js`, `Toast.jsx`. **If you create any new code that needs UUIDs, always use `generateUUID()`.**

### 2. Hardcoded URLs — WILL BREAK IN PRODUCTION

```javascript
// ❌ WRONG — only works on localhost
fetch('http://localhost:3001/api/simulate/claim', ...)

// ✅ CORRECT — works everywhere (Vite proxy in dev, Nginx in prod)
fetch('/api/simulate/claim', ...)
```

### 3. Vite Proxy vs Nginx

In **development**, Vite proxies `/api` requests to `localhost:3001`:
```javascript
// app/vite.config.js
proxy: { '/api': { target: 'http://localhost:3001' } }
```

In **production**, Nginx proxies `/api` to the Node server:
```nginx
location /api/ { proxy_pass http://127.0.0.1:3001; }
```

**Always use relative paths** (`/api/...`) so the same code works in both environments.

### 4. Dashboard Base Path

The dashboard is served at `/dashboard/` in production. The Vite build uses `VITE_BASE_PATH=/dashboard/` (set in the Dockerfile). All dashboard asset paths are automatically prefixed.

**If loading data in the dashboard**, use paths relative to the current origin:
```javascript
// ✅ Works in both dev and prod
fetch('/api/results/...')
```

### 5. V2 Engine Adapter Pattern

The adapter (`engine/adapter.py`) monkey-patches `v2_master_inputs` module attributes per claim. This is intentional — it avoids modifying V2 core code.

```python
# engine/adapter.py uses a context manager:
with save_and_restore_mi():
    MI.N_SIMULATIONS = config.n_paths    # temporary patch
    results = run_simulation(...)          # V2 runs with patched values
# MI attributes are restored after the block
```

**If you change V2 master_inputs parameter names**, you MUST update `adapter.py`'s `_MI_PATCHABLE_ATTRS` list.

### 6. Express Route Order Matters

In `server.js`, routes are registered in this order:
```javascript
app.use('/api/simulate', simulateRouter);
app.use('/api/jurisdictions', jurisdictionsRouter);
app.use('/api/claims', claimsRouter);
app.use('/api/templates', templatesRouter);
app.use('/api', resultsRouter);          // ← wildcard, must be LAST
```

The `resultsRouter` catches `/api/status/:runId` and `/api/results/:runId/*` via wildcard patterns. **Always register new routes BEFORE the results router** or they'll be swallowed.

### 7. Docker Build Stages

The Dockerfile has two stages:
1. **frontend-build:** Builds dashboard (with `VITE_BASE_PATH=/dashboard/`) then app
2. **runtime:** Python 3.11 + Node 20 + Nginx + Supervisor

If you add a new `npm` dependency to `app/` or `dashboard/`, the Docker build will pick it up from `package.json` automatically via `npm ci`.

If you add a new Python dependency, add it to `engine/requirements.txt`.

### 8. Persistent Docker Volume

Simulation run outputs are stored in `/app/server/runs` inside the container, mounted as a Docker volume `runs-data`. This data **survives container restarts and re-deployments**.

### 9. Known Outcomes & Post-Arb Stages

Claims at post-arbitration stages (s34_pending, hc_challenge_pending, etc.) use
`known_outcomes` to FORCE the arb_won draw and partially traverse the challenge tree.

**Key rules:**
- `arb_won` is NEVER drawn randomly when `known_outcomes.arb_outcome` is set
- `known_quantum` uses a TruncatedNormal distribution (NOT deterministic) centered on the known amount
- Challenge tree traversal forces known nodes but draws stochastically for remaining nodes
- The RNG still consumes draws even when outcomes are forced (for seed reproducibility)
- `enforcement` stage bypasses the entire MC pipeline and returns a fixed PathResult
- Post-arb stages return an empty pipeline from `derive_pipeline()` — the MC engine handles everything

**Validation chain:**
KnownOutcomes.s37_outcome requires s34_outcome,
slp_gate_outcome requires s37_outcome,
slp_merits_outcome requires slp_gate_outcome='admitted', etc.
The Pydantic model enforces this at parse time.

---

## Simulation Data Flow

```
Browser (ClaimEditor)
    │
    ├── POST /api/simulate/claim
    │   Body: { claim_config: {...}, simulation: {n_paths, seed} }
    │
    ▼
Express (routes/simulate.js)
    │
    ├── enrichClaimConfig() — merges jurisdiction defaults
    ├── startRun() — creates run directory, spawns Python
    │
    ▼
Python (engine/run.py)
    │
    ├── adapter.py — translates Platform config → V2 format
    ├── save_and_restore_mi() — patches v2_master_inputs
    ├── v2_monte_carlo.run_simulation() — runs N paths
    ├── v2_json_exporter — writes dashboard_data.json
    ├── v2_stochastic_pricing — writes stochastic_pricing.json
    ├── v2_pricing_surface — writes pricing_surface.json
    ├── v2_excel_writer — writes comprehensive Excel
    │
    ▼
Express (routes/results.js)
    │
    ├── GET /api/status/:runId — returns {status, progress}
    ├── GET /api/results/:runId/files — lists output files
    └── GET /api/results/:runId/dashboard_data.json — serves JSON
                │
                ▼
        Browser (Dashboard) renders charts from JSON
```

---

## Production Request Flow

```
Browser → http://178.104.35.208
    │
    ▼
Nginx (:80)
    ├── /              → static files from /app/static/app/
    ├── /dashboard/*   → static files from /app/static/dashboard/
    └── /api/*         → proxy_pass → Node (:3001)
                           └── spawns python3 engine/run.py
```

---

## Common Bug Fix Patterns

### Pattern: Component crashes on render

1. Check browser console for the error
2. Common causes: accessing `.property` on `undefined`, missing data
3. Add optional chaining: `data?.results?.summary`
4. Don't add excessive null checks everywhere — only guard the specific crash point

### Pattern: API returns 500

1. Check server logs: `ssh root@178.104.35.208 "docker logs claim-analytics-web-1 --tail 50"`
2. Look for the stack trace
3. Common causes: missing field in request body, Python process crash
4. Fix in the relevant `routes/*.js` or `engine/*.py` file

### Pattern: Simulation fails silently

1. Check run status: `GET /api/status/:runId` — if status is "error", check `error` field
2. Check server logs for Python traceback
3. Common cause: `engine/adapter.py` didn't translate a field correctly
4. Fix in `adapter.py` and ensure the Pydantic schema in `config/schema.py` matches

### Pattern: Dashboard shows wrong/missing data

1. Check the raw JSON: `GET /api/results/:runId/dashboard_data.json`
2. If JSON is correct → bug is in `dashboard/src/components/v2/`
3. If JSON is wrong → bug is in `engine/v2_core/v2_json_exporter.py`
4. Check the data shape matches what the component expects

### Pattern: Feature works locally but breaks in production

1. Check for hardcoded `localhost` URLs → use relative paths
2. Check for `crypto.randomUUID()` → use `generateUUID()`
3. Check for dev-only Vite features (e.g., hot module replacement)
4. Check if new files are included in the Docker build (COPY commands in Dockerfile)

---

## Verification Checklist (Run After Every Change)

### Local Verification
```bash
cd claim-analytics-platform
npm run dev
```

| # | Test | How to Verify |
|---|------|---------------|
| 1 | Landing page loads | Visit http://localhost:5180 |
| 2 | Login works | Enter any email + password, click Login |
| 3 | Workspace creation | Click "New Workspace", enter name |
| 4 | Claim creation | Navigate to claims, click "New Claim" |
| 5 | Claim editor saves | Fill out fields, save |
| 6 | Jurisdiction defaults load | Select "Indian Domestic" or "SIAC" |
| 7 | Claim simulation runs | Click "Run Simulation" on a claim |
| 8 | Simulation completes | Status goes from "running" to "completed" |
| 9 | Dashboard loads | Results page shows chart tabs |
| 10 | Portfolio creation | Navigate to portfolios, click "New Portfolio" |
| 11 | Portfolio sim runs | Add claims, configure, run |
| 12 | File download works | Click download buttons |
| 13 | Logout works | Click logout, returns to landing |
| 14 | Theme toggle works | Light/dark mode button |

### Production Verification
```bash
# After git push and pipeline completes:
ssh root@178.104.35.208 "curl -s http://localhost/api/health"
# Then repeat tests 1-14 at http://178.104.35.208
```

---

## When Debugging Server Production Issues

```bash
# View last 100 lines of logs
ssh root@178.104.35.208 "docker logs claim-analytics-web-1 --tail 100"

# Follow logs in real-time
ssh root@178.104.35.208 "docker logs -f claim-analytics-web-1"

# Check if container is running
ssh root@178.104.35.208 "docker ps"

# Shell into container
ssh root@178.104.35.208 "docker exec -it claim-analytics-web-1 bash"

# Inside container — check processes
supervisorctl status

# Check if Node server is listening
curl http://localhost:3001/api/health

# Check Nginx
nginx -t
cat /var/log/nginx/error.log

# Check Python engine
python3 -c "from engine.v2_core.v2_monte_carlo import run_simulation; print('OK')"

# Check available disk space
df -h
```

---

## Tech Stack Quick Reference

| Component | Version | Package Manager |
|-----------|---------|-----------------|
| React | 18.3 | npm |
| Vite (app) | 5.4 | npm |
| Vite (dashboard) | 6.0 | npm |
| Tailwind CSS | 3.4 | npm |
| Zustand | 4.5 | npm |
| React Router | 6.28 | npm |
| Express | 4.21 | npm |
| Node.js | 20.x | — |
| Python | 3.11 | pip |
| NumPy | ≥1.24 | pip |
| SciPy | ≥1.11 | pip |
| Pydantic | ≥2.0 | pip |
| D3 | 7.9 | npm |
| Recharts | 2.13 | npm |
| Plotly.js | 2.35+ | npm |
| Docker | 29.3+ | — |
| Nginx | latest | apt |
| Supervisor | latest | apt |
