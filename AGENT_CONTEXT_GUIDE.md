# Agent Context Guide — Claim Analytics Platform

> **Purpose**: Use this guide every time you give a prompt to an AI agent working on this codebase.
> Attach the files listed for your change category so the agent has full context and won't introduce regressions.

---

## Architecture Overview (attach THIS file always)

```
┌─ App (React :5180) ──────────┐   ┌─ Dashboard (React :5173) ──────┐
│ Login, Claims, Portfolios,   │   │ Results viewer, 30+ chart      │
│ Workspace mgmt, Run trigger  │   │ components, adaptive tabs      │
└──────────┬───────────────────┘   └─────────────┬──────────────────┘
           │ /api/* calls                        │ loads dashboard_data.json
           ▼                                     ▼
┌─ Node Express Server (:3001) ─────────────────────────────────────┐
│ Routes: auth, simulate, runs, results, claims, portfolios         │
│ Services: simulationRunner (spawns Python), configService, email  │
│ DB: PostgreSQL via pg pool, 7 tables, migration runner            │
└──────────┬────────────────────────────────────────────────────────┘
           │ spawns subprocess
           ▼
┌─ Python Engine ───────────────────────────────────────────────────┐
│ entry: engine/run_v2.py                                           │
│ Pydantic config → adapter → V2 Monte Carlo → analysis → export   │
│ Outputs: dashboard_data.json, portfolio_summary.xlsx, results.pdf │
└───────────────────────────────────────────────────────────────────┘
           │
           ▼
┌─ Deploy: Docker + Nginx + Supervisor ─────────────────────────────┐
│ Dockerfile (multi-stage), nginx.conf, supervisord.conf            │
│ Production: Hetzner VPS, PostgreSQL container                     │
└───────────────────────────────────────────────────────────────────┘
```

---

## GOLDEN RULE: Always Attach These 3 Files

No matter what change you're making, **always** attach:

| # | File | Why |
|---|------|-----|
| 1 | `AGENT_CONTEXT_GUIDE.md` (this file) | Architecture map + dependency chains |
| 2 | `package.json` (root) | Build scripts, port config, concurrently setup |
| 3 | `server/server.js` | All route mounts, middleware order, static serving |

---

## Change Category → Files to Attach

### 1. Engine / Simulation Logic Changes
> Changing how simulations run, what gets computed, Monte Carlo params, analysis modules

| File | Purpose |
|------|---------|
| `engine/config/schema.py` | Pydantic models — THE source of truth for all config shapes |
| `engine/run_v2.py` | Platform orchestrator — dispatches to V2 core |
| `engine/adapter.py` | Translates platform schema ↔ V2 format, monkey-patches MI |
| `engine/v2_core/v2_master_inputs.py` | Module-level constants that adapter patches per-claim |
| `engine/v2_core/v2_config.py` | V2ClaimConfig, PathResult, SimulationResults classes |
| `engine/v2_core/v2_run.py` | V2 simulation entry point |
| `engine/v2_core/v2_monte_carlo.py` | MC path generation |
| `engine/v2_core/v2_metrics.py` | MOIC, XIRR, VaR, CVaR calculations |
| `engine/export/json_exporter.py` | **CRITICAL** — defines dashboard_data.json schema |
| `engine/export/excel_writer.py` | Excel output format |
| `engine/export/pdf_report.py` | PDF report format |
| `server/services/simulationRunner.js` | How server spawns + monitors Python process |
| `server/routes/simulate.js` | Config enrichment before engine dispatch |
| `dashboard/src/data/dashboardData.js` | Frontend data hook that consumes engine outputs |

**Also attach the specific module you're changing:**
- Cashflow: `engine/simulation/cashflow_builder.py`, `engine/v2_core/v2_cashflow_builder.py`
- Pricing: `engine/analysis/pricing_surface.py`, `engine/v2_core/v2_stochastic_pricing.py`
- Sensitivity: `engine/analysis/sensitivity.py`, `engine/v2_core/v2_probability_sensitivity.py`
- Waterfall: `engine/analysis/waterfall_analysis.py`
- Investment grid: `engine/analysis/investment_grid.py`
- Risk: `engine/analysis/risk_metrics.py`

### 2. Structure Type Changes (Adding/Modifying Deal Structures)
> Adding a new structure type or modifying litigation_funding, monetisation_*, comparative

| File | Purpose |
|------|---------|
| `engine/structures/__init__.py` | Structure handler registry (get_handler) |
| `engine/structures/base.py` | Base class all structures inherit from |
| The specific handler, e.g. `engine/structures/litigation_funding.py` | Structure logic |
| `engine/config/schema.py` | Structure params in Pydantic |
| `engine/export/json_exporter.py` | Structure-specific export fields |
| `dashboard/src/App.jsx` | Tab routing by structure_type |
| `dashboard/src/components/` (relevant component) | Structure-specific dashboard tab |
| `app/src/pages/PortfolioBuilder.jsx` | Structure selection + config UI |
| `app/src/store/portfolioStore.js` | Portfolio state including structure_type |
| `server/routes/simulate.js` | Structure-aware config enrichment |

### 3. Dashboard / Visualization Changes
> Changing charts, adding tabs, modifying KPIs, fixing dashboard rendering

| File | Purpose |
|------|---------|
| `dashboard/src/App.jsx` | Tab definitions + routing logic |
| `dashboard/src/data/dashboardData.js` | Data loading hook — what's available to components |
| `dashboard/src/theme.js` | UI settings (zoom, fonts, colors) |
| `dashboard/src/main.jsx` | Entry point, providers |
| `dashboard/src/components/Shared.jsx` | Card, TabBar, LoadingScreen shared components |
| `dashboard/vite.config.js` | Port, aliases, data proxy plugin |
| `engine/export/json_exporter.py` | **ALWAYS** — the schema of what data exists |

**Also attach the specific component + its V2 counterpart:**
- Executive Summary: `dashboard/src/components/ExecutiveSummary.jsx`
- Per-Claim: `dashboard/src/components/PerClaimContribution.jsx`
- Probability: `dashboard/src/components/v2/V2ProbabilityOutcomes.jsx`
- Quantum/Timeline: `dashboard/src/components/v2/V2QuantumTimeline.jsx`
- Cashflow: `dashboard/src/components/v2/V2CashflowWaterfall.jsx`, `dashboard/src/components/CashflowWaterfall.jsx`
- J-Curve: `dashboard/src/components/JCurveFanChart.jsx`
- Risk: `dashboard/src/components/RiskAnalytics.jsx`
- Pricing: `dashboard/src/components/v2/V2PricingView.jsx`, `dashboard/src/components/PricingGrid.jsx`
- Investment: `dashboard/src/components/v2/V2InvestmentAnalysis.jsx`
- Export: `dashboard/src/components/ExportPanel.jsx`
- Lit Funding: `dashboard/src/components/LitFundingWaterfall.jsx`
- Distributions: `dashboard/src/components/v2/DistributionExplorer.jsx`

### 4. App Shell / Frontend UI Changes
> Login, signup, claim editor, portfolio builder, workspace management, navigation

| File | Purpose |
|------|---------|
| `app/src/App.jsx` | Root router with all page routes |
| `app/src/main.jsx` | Entry point, providers |
| `app/src/services/api.js` | API client (token handling, interceptors) |
| `app/src/layouts/DashboardLayout.jsx` | Sidebar + top bar layout |
| `app/src/layouts/PublicLayout.jsx` | Public pages layout |
| `app/vite.config.js` | Port 5180, @dashboard alias, /api proxy |
| `app/tailwind.config.js` | Tailwind theme config |
| `app/src/index.css` | Global styles |

**Also attach relevant stores + pages:**
- Auth: `app/src/store/authStore.js`, `app/src/pages/Login.jsx`, `app/src/pages/Signup.jsx`
- Claims: `app/src/store/claimStore.js`, `app/src/pages/ClaimEditor.jsx`, `app/src/pages/ClaimList.jsx`, `app/src/pages/ClaimResults.jsx`
- Portfolios: `app/src/store/portfolioStore.js`, `app/src/pages/PortfolioBuilder.jsx`, `app/src/pages/PortfolioList.jsx`, `app/src/pages/PortfolioResults.jsx`
- Workspaces: `app/src/store/workspaceStore.js`, `app/src/pages/WorkspaceHome.jsx`, `app/src/pages/WorkspaceDashboard.jsx`
- Theme: `app/src/store/themeStore.js`, `app/src/theme.js`

### 5. API / Server Route Changes
> Adding/modifying endpoints, changing response shapes, middleware changes

| File | Purpose |
|------|---------|
| `server/server.js` | Route mounting + middleware stack |
| The specific route file (e.g., `server/routes/claims.js`) | Endpoint logic |
| `server/middleware/auth.js` | JWT verification middleware |
| `server/utils/jwt.js` | Token generation/verification |
| `server/db/models/index.js` | All model exports |
| The specific model (e.g., `server/db/models/Claim.js`) | DB queries |
| `server/db/pool.js` | Database connection |
| `app/src/services/api.js` | Frontend API client — must match endpoints |
| The relevant Zustand store (e.g., `app/src/store/claimStore.js`) | Frontend state that calls the API |

### 6. Database Schema Changes
> Adding tables, columns, migrations

| File | Purpose |
|------|---------|
| `server/db/migrations/` (ALL migration files) | Migration history |
| `server/db/migrate.js` | Migration runner logic |
| `server/db/models/index.js` | Model registry |
| The affected model(s) in `server/db/models/` | SQL queries to update |
| The affected route(s) in `server/routes/` | Endpoints that read/write the table |
| `deploy/docker-compose.yml` | PostgreSQL config |

### 7. Authentication / Security Changes
> Login flow, OTP, JWT, permissions, rate limiting

| File | Purpose |
|------|---------|
| `server/routes/auth.js` | Auth endpoints (register, login, OTP, refresh) |
| `server/middleware/auth.js` | JWT verification + optional auth |
| `server/utils/jwt.js` | Token generation (access + refresh) |
| `server/db/models/User.js` | User model |
| `server/db/models/RefreshToken.js` | Token storage |
| `server/db/models/PendingRegistration.js` | OTP flow |
| `server/services/email.js` | SMTP for OTP delivery |
| `app/src/store/authStore.js` | Frontend auth state |
| `app/src/services/api.js` | Token refresh interceptor |
| `app/src/pages/Login.jsx` | Login form |
| `app/src/pages/Signup.jsx` | Registration + OTP form |

### 8. Deployment / Infrastructure Changes
> Docker, Nginx, environment vars, CI/CD

| File | Purpose |
|------|---------|
| `deploy/Dockerfile` | Multi-stage build definition |
| `deploy/docker-compose.yml` | Service orchestration |
| `deploy/nginx.conf` | Reverse proxy routing |
| `deploy/supervisord.conf` | Process management |
| `deploy/.env.example` | Required environment variables |
| `package.json` (root) | Build scripts |
| `app/vite.config.js` | Frontend build config |
| `dashboard/vite.config.js` | Dashboard build config |
| `server/server.js` | Port binding, static file serving |

### 9. Jurisdiction / Template Changes
> Adding jurisdictions, modifying claim templates, default configs

| File | Purpose |
|------|---------|
| `engine/jurisdictions/` (all JSON files) | Jurisdiction templates |
| `engine/config/schema.py` | JurisdictionTemplate Pydantic model |
| `server/routes/jurisdictions.js` | Template serving API |
| `server/routes/simulate.js` | Jurisdiction-aware config enrichment |
| `app/src/pages/ClaimEditor.jsx` | Jurisdiction picker UI |

---

## Prompt Template for AI Agent

Use this template when prompting the agent:

```
CONTEXT FILES ATTACHED: [list the files you attached per the guide above]

ARCHITECTURE: This is a 3-layer app:
- Frontend: React (app/ on :5180 for UI, dashboard/ on :5173 for results)
- Server: Node/Express on :3001 with PostgreSQL
- Engine: Python with Pydantic schemas, Monte Carlo simulation
- Deploy: Docker + Nginx + Supervisor on Hetzner VPS

The simulation flow is:
  Frontend → POST /api/simulate/portfolio → server enriches config →
  spawns Python engine/run_v2.py → writes dashboard_data.json →
  server marks run complete → frontend fetches results → dashboard renders

CRITICAL RULES:
1. If you change engine/export/json_exporter.py fields, update dashboard/src/data/dashboardData.js AND every component that reads those fields
2. If you change engine/config/schema.py, update server/routes/simulate.js enrichment AND app/src/pages/ClaimEditor.jsx or PortfolioBuilder.jsx
3. If you change any API endpoint shape, update app/src/services/api.js AND the relevant Zustand store
4. If you add a DB column, create a new migration file (next sequential number), update the model, and update routes
5. If you change structure types, update engine/structures/__init__.py, dashboard/src/App.jsx tabs, and app/src/pages/PortfolioBuilder.jsx
6. NEVER break the monkey-patching in engine/adapter.py — always restore MI state
7. All DB migrations must have DEFAULT values for new NOT NULL columns
8. Test the vite build for BOTH app/ and dashboard/ after any frontend change

TASK: [your specific request here]
```

---

## Quick Reference: All API Endpoints

```
POST   /api/auth/register
POST   /api/auth/login
POST   /api/auth/refresh
POST   /api/auth/logout
GET    /api/auth/me
PUT    /api/auth/me

POST   /api/simulate
POST   /api/simulate/claim
POST   /api/simulate/portfolio

GET    /api/status/:runId
GET    /api/results/:runId/files
GET    /api/results/:runId/*

GET    /api/runs
GET    /api/runs/:id
DELETE /api/runs/:id
POST   /api/runs/:id/save
POST   /api/runs/:id/discard
GET    /api/runs/compare
GET    /api/runs/legacy

GET    /api/claims?workspace_id=UUID
GET    /api/claims/:id
POST   /api/claims
PUT    /api/claims/:id
DELETE /api/claims/:id

GET    /api/portfolios?workspace_id=UUID
GET    /api/portfolios/:id
POST   /api/portfolios
PUT    /api/portfolios/:id
DELETE /api/portfolios/:id

GET    /api/workspaces
POST   /api/workspaces
GET    /api/workspaces/:id
PUT    /api/workspaces/:id
DELETE /api/workspaces/:id

GET    /api/jurisdictions
GET    /api/jurisdictions/:id
GET    /api/jurisdictions/:id/defaults

GET    /api/templates
GET    /api/defaults
GET    /api/health
```

---

## Quick Reference: Database Tables

| Table | Key Columns | Used By |
|-------|------------|---------|
| users | id, email, password_hash, full_name, role, email_verified | auth.js, User.js |
| workspaces | id, user_id, name | workspaces.js, Workspace.js |
| claims | id, workspace_id, user_id, name, jurisdiction, config (JSONB), status | claims.js, Claim.js |
| portfolios | id, workspace_id, user_id, name, structure_type, claim_ids (JSONB) | portfolios.js, Portfolio.js |
| simulation_runs | id, user_id, mode, structure_type, config (JSONB), status, results_path, summary (JSONB) | runs.js, SimulationRun.js |
| refresh_tokens | id, user_id, token_hash, expires_at | auth.js, RefreshToken.js |
| pending_registrations | id, email, otp_hash, otp_attempts, expires_at | auth.js, PendingRegistration.js |

---

## Quick Reference: dashboard_data.json Schema (Engine Output)

The JSON exported by `engine/export/json_exporter.py` is the **contract** between engine and dashboard:

```
{
  "structure_type": "litigation_funding" | "monetisation_*" | "comparative",
  "mode": "portfolio" | "claim",
  "portfolio_summary": { n_claims, n_paths, expected_moic, expected_irr, total_investment, ... },
  "claims": [ { claim_id, name, expected_moic, win_probability, ... } ],
  "probability_outcomes": { ... },
  "quantum": { distribution, bands, ... },
  "cashflows": { nominal, pv, timeline, ... },
  "jcurve_data": { fan_chart, percentiles, ... },
  "investment_grid": { rows, cols, cells, ... },
  "pricing_surface": { ask_prices, confidences, irr_grid, ... },
  "sensitivity": { ... },
  "waterfall": { ... },           // litigation_funding only
  "risk": { var_95, cvar_95, sortino, max_drawdown, ... },
  "mc_distributions": { moic, irr, quantum, ... },
  "per_claim": [ ... ],
  "legal_costs": { ... }
}
```

---

## Checklist Before Submitting Any Agent Prompt

- [ ] Attached `AGENT_CONTEXT_GUIDE.md` (this file)
- [ ] Identified change category from sections above
- [ ] Attached ALL files listed for that category
- [ ] If touching engine output → attached `json_exporter.py` + `dashboardData.js`
- [ ] If touching API → attached route + `api.js` + relevant store
- [ ] If touching DB → attached migration files + model + route
- [ ] Used the prompt template with CRITICAL RULES
- [ ] Specified: "Test vite build for app/ and dashboard/ after changes"
- [ ] Specified: "Run engine smoke test after engine changes"
