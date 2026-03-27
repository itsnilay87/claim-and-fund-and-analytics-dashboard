# DEV Sprint 1 — Jira Ticket Definitions

> **Sprint:** DEV Sprint 1
> **Project:** Claim Analytics Platform (CAP)
> **Sprint Goal:** Establish production-grade infrastructure (auth, database, payments), integrate fund simulation, develop & validate all 5 structure dashboards, and eliminate all hardcoded/legacy values from the codebase.

---

## Sprint Structure Overview

| # | Ticket ID | Type | Summary | Priority |
|---|-----------|------|---------|----------|
| 1 | CAP-001 | Epic | PostgreSQL Database & User Management | Critical |
| 2 | CAP-002 | Epic | Payment Gateway Integration | High |
| 3 | CAP-003 | Story | Integrate Fund-Level Simulation Dashboard | High |
| 4 | CAP-004 | Story | Develop & Validate Monetisation — Staged Milestone Payments Dashboard | High |
| 5 | CAP-005 | Story | Develop & Validate Monetisation — Full Upfront Purchase Dashboard | High |
| 6 | CAP-006 | Story | Develop & Validate Litigation Funding Dashboard | High |
| 7 | CAP-007 | Story | Comprehensive Bug Audit — Results Dashboard | Critical |
| 8 | CAP-008 | Story | Fix All Identified Dashboard Bugs (Post-Audit) | Critical |
| 9 | CAP-009 | Story | Hardcoded Values Audit & Fix — Simulation Engine | Critical |
| 10 | CAP-010 | Story | Remove TATA-Specific Branding & Terminology | High |
| 11 | CAP-011 | Story | Server-Side Authentication & JWT Middleware | Critical |
| 12 | CAP-012 | Story | Simulation Results Persistence — DB Integration | High |
| 13 | CAP-013 | Story | Input Validation & Sanitisation — Full Stack | High |
| 14 | CAP-014 | Story | Jurisdiction-Agnostic Probability Engine Verification | High |
| 15 | CAP-015 | Story | End-to-End Test Suite — All 5 Structure Types | High |
| 16 | CAP-016 | Story | Environment Configuration & Deployment Hardening | Medium |
| 17 | CAP-017 | Story | Dashboard Export Functionality — Excel & PDF | Medium |
| 18 | CAP-018 | Story | API Rate Limiting, Logging & Monitoring | Medium |
| 19 | CAP-019 | Story | Comparative Analysis Dashboard Validation | High |
| 20 | CAP-020 | Story | User Workspace & Data Isolation | High |

---

## Ticket Details

---

### CAP-001 — PostgreSQL Database & User Management

| Field | Value |
|-------|-------|
| **Type** | Epic |
| **Priority** | Critical |

**Summary:** Set up PostgreSQL database with user authentication, claim storage, portfolio storage, and simulation results persistence.

**Description:**

**Objective:** Replace the current file-system-only storage (localStorage + server/runs/ JSON files) with a PostgreSQL database to support user registration, authentication, claim/portfolio persistence, and simulation result archival.

**Current State:**
- Authentication is mocked in `app/src/store/authStore.js` (fake JWT with `btoa()`, no server verification)
- Claims stored in browser localStorage via Zustand `claimStore.js`
- Portfolios stored in browser localStorage via Zustand `portfolioStore.js`
- Simulation results written to `server/runs/{uuid}/` as JSON files on disk
- No user isolation — all data is client-side only

**Requirements:**

1. **Database Setup**
   - Install and configure PostgreSQL (v15+)
   - Create database `claim_analytics`
   - Schema design with the following tables:
     - `users` (id UUID PK, email UNIQUE, password_hash, full_name, company, role, created_at, updated_at)
     - `workspaces` (id UUID PK, user_id FK, name, created_at, updated_at)
     - `claims` (id UUID PK, workspace_id FK, name, jurisdiction, claim_value_cr, currency, config JSONB, created_at, updated_at)
     - `portfolios` (id UUID PK, workspace_id FK, name, structure_type, claim_ids UUID[], config JSONB, created_at, updated_at)
     - `simulation_runs` (id UUID PK, portfolio_id FK NULL, claim_id FK NULL, user_id FK, status ENUM, config JSONB, results_path TEXT, started_at, completed_at, error_message TEXT)
     - `subscriptions` (id UUID PK, user_id FK, plan, status, stripe_customer_id, stripe_subscription_id, current_period_start, current_period_end)
   - Add proper indexes on foreign keys and frequently queried columns
   - Create migration files for version control

2. **ORM / Query Layer**
   - Use `pg` (node-postgres) or Prisma ORM in the Express server
   - Connection pooling configuration
   - Transaction support for multi-table operations

3. **Data Migration**
   - Migrate existing localStorage claim/portfolio data structure to DB
   - Ensure existing simulation run outputs (JSON files) are indexed in DB
   - Backward-compatible: old runs still accessible during migration

**Acceptance Criteria:**
- [ ] PostgreSQL database running and accessible from Express server
- [ ] All 6 tables created with proper constraints and indexes
- [ ] CRUD operations working for users, workspaces, claims, portfolios
- [ ] Migration scripts versioned and repeatable
- [ ] Connection pooling configured (max 20 connections)
- [ ] Existing simulation run data indexed in DB

**Technical Notes:**
- Consider using Prisma for type-safe queries and auto-migration
- Store large simulation JSONs on filesystem, only metadata in DB
- Use JSONB for flexible config storage (claim parameters vary by jurisdiction)

---

### CAP-002 — Payment Gateway Integration

| Field | Value |
|-------|-------|
| **Type** | Epic |
| **Priority** | High |
| **Blocked By** | CAP-001, CAP-011 |

**Summary:** Integrate Stripe payment gateway to enable subscription-based access and pay-per-simulation models.

**Description:**

**Objective:** Implement a complete payment flow using Stripe that supports subscription plans and usage-based billing for simulation runs.

**Current State:**
- Zero payment infrastructure exists
- No subscription model defined
- All features currently free/unrestricted
- `subscriptions` table planned in CAP-001

**Requirements:**

1. **Stripe Account & Setup**
   - Create Stripe account and obtain API keys
   - Configure webhooks for: `checkout.session.completed`, `invoice.paid`, `invoice.payment_failed`, `customer.subscription.updated`, `customer.subscription.deleted`
   - Define products and pricing:
     - **Free Tier:** 5 simulations/month, single-claim only
     - **Professional:** Unlimited simulations, portfolio analysis, export features
     - **Enterprise:** All features + priority support + custom jurisdiction templates

2. **Server-Side Implementation** (`server/routes/payments.js`)
   - `POST /api/payments/create-checkout` — Create Stripe Checkout Session
   - `POST /api/payments/webhook` — Handle Stripe webhooks (verify signature)
   - `GET /api/payments/subscription` — Get current user's subscription status
   - `POST /api/payments/portal` — Create Stripe Customer Portal session
   - Middleware: check subscription status before allowing simulation runs

3. **Frontend Integration** (`app/`)
   - Pricing page component with plan comparison
   - Checkout flow: plan selection → Stripe Checkout → success/cancel handling
   - Subscription status display in user profile/settings
   - Usage tracking display (simulations remaining on free tier)
   - Upgrade prompts when free tier limits reached

4. **Entitlement Enforcement**
   - Server-side middleware checks subscription status before:
     - Running simulations (all tiers)
     - Portfolio analysis (Professional+)
     - Export features (Professional+)
     - Custom jurisdiction templates (Enterprise)
   - Graceful handling: return 402 with clear upgrade message

5. **Testing**
   - Use Stripe test mode and test card numbers
   - Test full lifecycle: subscribe → use → renew → cancel
   - Test webhook reliability and idempotency

**Acceptance Criteria:**
- [ ] Stripe Checkout flow works end-to-end (test mode)
- [ ] Webhooks correctly update subscription status in DB
- [ ] Free tier limits enforced (5 simulations/month)
- [ ] Professional tier unlocks portfolio + export features
- [ ] Customer portal accessible for subscription management
- [ ] Webhook signature verification implemented
- [ ] Error handling for failed payments

**Technical Notes:**
- Use `stripe` npm package on server, `@stripe/stripe-js` + `@stripe/react-stripe-js` on frontend
- Webhook endpoint must be excluded from JSON body parsing (raw body required for signature verification)
- Store Stripe customer ID and subscription ID in `subscriptions` table

---

### CAP-003 — Integrate Fund-Level Simulation Dashboard

| Field | Value |
|-------|-------|
| **Type** | Story |
| **Priority** | High |
| **Blocked By** | CAP-001 |

**Summary:** Integrate the standalone fund-level simulation dashboard into the main claim-analytics-platform as a unified experience.

**Description:**

**Objective:** The fund-level simulation dashboard (located at `TATA_code_v2/simulation-dashboard/` and `TATA_code_v2/simulation-server/`) allows users to simulate a fund of claims and cases. This needs to be integrated into the claim-analytics-platform as a unified experience.

**Current State:**
- Fund simulation dashboard exists as standalone app at `TATA_code_v2/simulation-dashboard/` (Vite + React)
- Simulation server exists at `TATA_code_v2/simulation-server/` (Express.js with routes: simulate, results, runs, status, defaults)
- These are completely separate from claim-analytics-platform
- No routing or navigation connects them

**Requirements:**

1. **Code Integration Strategy** (choose one):
   - **Option A — Monorepo merge**: Copy simulation-dashboard components into `claim-analytics-platform/dashboard/` as a new tab/section
   - **Option B — Micro-frontend**: Embed simulation-dashboard as an iframe or Module Federation remote in the App shell
   - **Option C — Unified server proxy**: Keep simulation-server separate but proxy through claim-analytics-platform server

   Recommended: Option A for single codebase simplicity

2. **Navigation Integration**
   - Add "Fund Simulation" section in App sidebar navigation
   - Route: `/fund-simulation` in App router
   - Link fund simulation results to individual claim results

3. **API Unification**
   - Merge simulation-server routes into claim-analytics-platform server:
     - `POST /api/simulate/fund` — fund-level simulation
     - `GET /api/fund-results/:runId` — fund results
   - Ensure shared Python engine can run both claim-level and fund-level simulations

4. **Data Flow**
   - Fund simulation should pull claims from the user's workspace (database after CAP-001)
   - Fund results should be accessible from the same results navigation
   - Cross-link: individual claim results → fund context, and fund results → drill-down to claim

5. **UI Consistency**
   - Apply claim-analytics-platform theme (COLORS, FONT from theme.js) to fund dashboard components
   - Ensure consistent KPI formatting, chart styling, and responsive behavior

**Acceptance Criteria:**
- [ ] Fund simulation accessible from main app navigation
- [ ] Fund simulation can run using claims from user's workspace
- [ ] Fund results render correctly within claim-analytics-platform
- [ ] API routes unified under single Express server
- [ ] Consistent visual styling across claim and fund dashboards
- [ ] No duplicate dependencies or conflicting package versions

**Technical Notes:**
- The simulation-dashboard uses its own `src/components/`, `src/hooks/`, `src/utils/` — audit for conflicts before merging
- The simulation-server has its own `config/`, `services/`, `routes/` — check for naming collisions
- Both use Vite + React, so merge should be straightforward

---

### CAP-004 — Develop & Validate Monetisation — Staged Milestone Payments Dashboard

| Field | Value |
|-------|-------|
| **Type** | Story |
| **Priority** | High |
| **Related** | CAP-007, CAP-009 |

**Summary:** Develop, validate, and fix the results dashboard for the `monetisation_staged` structure type (staged milestone payments).

**Description:**

**Objective:** Ensure the results dashboard for the staged milestone payments structure correctly renders all tabs, charts, KPIs, and data with no hardcoded values, no broken components, and accurate simulation outputs.

**Current State:**
- Structure handler exists: `engine/structures/monetisation_staged.py` → `StagedHandler`
- Dashboard has structure-specific components: `MilestoneAnalysis.jsx`, `StagedKPIs.jsx`
- Dashboard App.jsx shows structure-specific tabs based on `structure_type`
- Potential issues: hardcoded TATA references, untested edge cases, missing data fields

**Validation Checklist:**

1. **Engine Output Verification**
   - Run staged milestone simulation: `python -m engine.run_v2 --config <staged_config> --output-dir test_outputs/staged_test --n 1000`
   - Verify `dashboard_data.json` contains all required keys for staged structure
   - Verify milestone-specific fields: milestone payment schedule, draw-down timing, staged IRR/MOIC
   - Confirm no NaN, null, or missing values in output

2. **Dashboard Tab Verification — MONETISATION: STAGED MILESTONE PAYMENTS (11 Tabs)**

   **Tab 1 — Executive Summary**
   - Portfolio Overview: Structure type, number of claims, jurisdiction breakdown
   - Headline KPIs: Expected Portfolio MOIC, Expected Portfolio IRR, Total Investment Required, Expected Weighted Award, Probability of Overall Profit
   - Milestone Schedule Summary: Number of milestone stages, total committed capital, draw-down timeline
   - Risk Summary: Probability of total loss, downside MOIC (5th percentile), upside MOIC (95th percentile)

   **Tab 2 — Milestone Analysis** (MilestoneAnalysis.jsx)
   - Milestone Payment Schedule: Table showing milestone #, trigger event, payment amount, cumulative invested, expected timing
   - Milestone Draw-Down Chart: Bar/area chart showing capital deployment over time per milestone
   - Scenario Comparison: Expected / Base / Stress milestone outcomes with IRR and MOIC for each
   - Milestone Risk Matrix: Probability of reaching each milestone stage, conditional returns

   **Tab 3 — Probability Outcomes** (ProbabilityOutcomes.jsx)
   - Probability Tree: Interactive tree showing jurisdiction-specific challenge paths with probabilities at each node
   - Scenario Paths Table: All terminal scenarios with path description, cumulative probability, expected award, MOIC, IRR
   - Probability Sensitivity: Tornado chart showing which probability nodes have the greatest impact on portfolio MOIC
   - Outcome Distribution: Histogram of MOIC outcomes across all Monte Carlo iterations

   **Tab 4 — Quantum & Timeline** (QuantumTimeline.jsx)
   - Quantum Band Distribution: Table/chart of quantum bands with probabilities and expected award values
   - Timeline Distribution: Histogram of case duration outcomes (years)
   - Expected Timeline by Scenario: Table showing scenario path, expected duration, milestone timing impact
   - Interest Accumulation: Pre-award and post-award interest rates applied, total interest impact on quantum

   **Tab 5 — Investment Analysis** (InvestmentSOC.jsx)
   - Investment Grid: Sensitivity grid of milestone schedule configurations vs. expected MOIC/IRR
   - Breakeven Analysis: Minimum win probability required for breakeven at each milestone configuration
   - Capital Deployment Timeline: Chart showing staged capital deployment vs. cumulative exposure
   - Return Waterfall: Waterfall chart showing invested capital, milestone payments, award recovery, net return

   **Tab 6 — Per-Claim Analysis** (PerClaimContribution.jsx)
   - Claim Contribution Table: Each claim with name, jurisdiction, claim value, expected award, contribution to portfolio MOIC, weight
   - Per-Claim Milestone Breakdown: How each claim milestone schedule contributes to overall draw-down
   - Claim Risk Ranking: Claims ranked by risk-adjusted return contribution

   **Tab 7 — Legal Costs** (LegalCosts.jsx)
   - Legal Cost Breakdown: Table showing cost stage, amount, timing, cumulative legal spend
   - Cost vs. Award Ratio: Legal costs as percentage of expected award per claim
   - Cost Sensitivity: Impact of legal cost overruns on portfolio IRR and MOIC

   **Tab 8 — Cashflow & Waterfall** (ClaimCashflow.jsx)
   - Cashflow Timeline: Time-series chart of milestone outflows, legal cost outflows, award inflows
   - J-Curve Visualisation: Cumulative cashflow chart showing capital deployment trough and recovery
   - Net Cashflow Table: Period-by-period breakdown of outflows, inflows, net, cumulative
   - Waterfall Chart: Priority of payments — milestone recovery, legal cost recovery, profit split

   **Tab 9 — Stochastic Pricing** (StochasticPricing.jsx)
   - Monte Carlo Distribution: Histogram of portfolio returns across n iterations
   - Confidence Intervals: Table showing 5th, 25th, 50th, 75th, 95th percentile MOIC and IRR
   - VaR Analysis: Value at Risk at 95% and 99% confidence levels
   - Pricing Range: Suggested milestone pricing range based on target return thresholds

   **Tab 10 — Pricing Surface** (PricingSurface.jsx)
   - 3D/Heatmap Surface: Milestone schedule (x-axis) vs. win probability (y-axis) vs. expected MOIC (z-axis/colour)
   - Breakeven Contour: Contour line showing MOIC = 1.0x boundary
   - Optimal Pricing Point: Highlighted optimal milestone configuration for target MOIC

   **Tab 11 — Report Charts** (ReportCharts.jsx)
   - Exportable Chart Pack: All key charts formatted for PDF/presentation export
   - Summary Dashboard: Compact single-page view with headline KPIs and key charts

3. **Data Binding Audit**
   - Ensure all KPIs read from `dashboard_data.json` dynamically (no hardcoded numbers)
   - Verify milestone payment amounts come from simulation, not defaults
   - Check that `StagedKPIs.jsx` correctly maps data from the staged handler output
   - Verify all 11 tabs render with no missing data keys or undefined values

4. **Edge Cases**
   - Run with 1 claim, 5 claims, 20 claims
   - Run with extreme milestone values (very small, very large)
   - Run with 0% probability scenarios
   - Verify error boundaries catch rendering failures gracefully

**Acceptance Criteria:**
- [ ] Staged milestone simulation runs end-to-end without errors (n=1000)
- [ ] All 11 dashboard tabs render correctly for staged structure
- [ ] MilestoneAnalysis.jsx displays dynamic milestone schedule and scenarios
- [ ] StagedKPIs.jsx shows accurate staged-specific KPIs
- [ ] Stochastic Pricing tab shows Monte Carlo distribution and confidence intervals
- [ ] Pricing Surface tab renders 3D/heatmap surface correctly
- [ ] No hardcoded TATA references in staged-specific components
- [ ] Edge cases handled (empty results, extreme values)
- [ ] Screenshot evidence of all 11 tabs for QA

---

### CAP-005 — Develop & Validate Monetisation — Full Upfront Purchase Dashboard

| Field | Value |
|-------|-------|
| **Type** | Story |
| **Priority** | High |
| **Related** | CAP-007, CAP-009 |

**Summary:** Develop, validate, and fix the results dashboard for the `monetisation_full_purchase` structure type (full upfront purchase).

**Description:**

**Objective:** Ensure the results dashboard for the full upfront purchase structure correctly renders all tabs, charts, KPIs, and data with no hardcoded values, no broken components, and accurate simulation outputs.

**Current State:**
- Structure handler exists: `engine/structures/monetisation_full_purchase.py` → `FullPurchaseHandler`
- Dashboard has structure-specific components: `PurchaseSensitivity.jsx`, `FullPurchaseKPIs.jsx`
- Potential issues: hardcoded default award ratio (0.70 in `InvestmentSOC.jsx` line 31), TATA tail references

**Validation Checklist:**

1. **Engine Output Verification**
   - Run full purchase simulation with varied purchase price parameters
   - Verify `dashboard_data.json` contains: purchase_sensitivity grid, breakeven pricing, expected MOIC at various purchase prices
   - Confirm pricing sensitivity surface is correctly computed
   - Validate that purchase price inputs flow through to outputs (no hardcoded 0.70 award share)

2. **Dashboard Tab Verification — MONETISATION: FULL UPFRONT PURCHASE (10 Tabs)**

   **Tab 1 — Executive Summary**
   - Portfolio Overview: Structure type, number of claims, jurisdiction breakdown
   - Headline KPIs: Expected Portfolio MOIC, Expected Portfolio IRR, Purchase Price, Breakeven Probability, Expected Net Return
   - Purchase Structure Summary: Full upfront purchase price, implied discount to claim value, funding deployment
   - Risk Summary: Probability of total loss, downside MOIC (5th percentile), upside MOIC (95th percentile)

   **Tab 2 — Probability Outcomes** (ProbabilityOutcomes.jsx)
   - Probability Tree: Interactive tree showing jurisdiction-specific challenge paths with probabilities at each node
   - Scenario Paths Table: All terminal scenarios with path description, cumulative probability, expected award, MOIC, IRR
   - Probability Sensitivity: Tornado chart showing which probability nodes have the greatest impact on portfolio MOIC
   - Outcome Distribution: Histogram of MOIC outcomes across all Monte Carlo iterations

   **Tab 3 — Quantum & Timeline** (QuantumTimeline.jsx)
   - Quantum Band Distribution: Table/chart of quantum bands with probabilities and expected award values
   - Timeline Distribution: Histogram of case duration outcomes (years)
   - Expected Timeline by Scenario: Table showing scenario path, expected duration, recovery timing
   - Interest Accumulation: Pre-award and post-award interest rates applied, total interest impact on quantum

   **Tab 4 — Investment Analysis** (InvestmentSOC.jsx)
   - Purchase Price Sensitivity Grid: Purchase price vs. expected MOIC/IRR matrix
   - Breakeven Analysis: Minimum win probability required for breakeven at each purchase price level
   - Capital Efficiency: Single upfront deployment vs. expected recovery timeline
   - Return Waterfall: Waterfall chart showing purchase price paid, award recovered, fees/costs, net return

   **Tab 5 — Per-Claim Analysis** (PerClaimContribution.jsx)
   - Claim Contribution Table: Each claim with name, jurisdiction, claim value, purchase price, expected award, contribution to portfolio MOIC, weight
   - Per-Claim Purchase Pricing: Individual claim purchase price vs. expected value analysis
   - Claim Risk Ranking: Claims ranked by risk-adjusted return contribution

   **Tab 6 — Legal Costs** (LegalCosts.jsx)
   - Legal Cost Breakdown: Table showing cost stage, amount, timing, cumulative legal spend
   - Cost vs. Purchase Price: Legal costs as percentage of purchase price and expected award per claim
   - Cost Sensitivity: Impact of legal cost overruns on portfolio IRR and MOIC

   **Tab 7 — Cashflow & Waterfall** (ClaimCashflow.jsx)
   - Cashflow Timeline: Time-series chart of single upfront purchase outflow, legal cost outflows, award inflows
   - J-Curve Visualisation: Cumulative cashflow chart showing upfront capital deployment and recovery
   - Net Cashflow Table: Period-by-period breakdown of outflows, inflows, net, cumulative
   - Waterfall Chart: Priority of payments — purchase price recovery, legal cost recovery, profit

   **Tab 8 — Stochastic Pricing** (StochasticPricing.jsx)
   - Monte Carlo Distribution: Histogram of portfolio returns across n iterations
   - Confidence Intervals: Table showing 5th, 25th, 50th, 75th, 95th percentile MOIC and IRR
   - VaR Analysis: Value at Risk at 95% and 99% confidence levels
   - Optimal Purchase Price: Suggested purchase price range based on target return thresholds

   **Tab 9 — Pricing Surface** (PricingSurface.jsx)
   - 3D/Heatmap Surface: Purchase price (x-axis) vs. win probability (y-axis) vs. expected MOIC (z-axis/colour)
   - Breakeven Contour: Contour line showing MOIC = 1.0x boundary across purchase price levels
   - Optimal Pricing Point: Highlighted optimal purchase price for target MOIC

   **Tab 10 — Report Charts** (ReportCharts.jsx)
   - Exportable Chart Pack: All key charts formatted for PDF/presentation export
   - Summary Dashboard: Compact single-page view with headline KPIs and key charts

3. **Hardcoded Value Check**
   - `InvestmentSOC.jsx` line 31: default award = 0.70 → must come from simulation config
   - `DistributionExplorer.jsx` line 156: "10% upfront / 20% TATA tail" → must be dynamic
   - Verify purchase price range comes from user config, not hardcoded `upfront_pcts = [0.05, 0.10, ...]`

4. **Edge Cases**
   - Purchase price = 100% of claim value
   - Purchase price = 1% of claim value
   - Multi-claim portfolio with mixed claim values

**Acceptance Criteria:**
- [ ] Full purchase simulation runs end-to-end without errors (n=1000)
- [ ] All 10 dashboard tabs render correctly for full_purchase structure
- [ ] PurchaseSensitivity.jsx displays dynamic sensitivity grid
- [ ] FullPurchaseKPIs.jsx shows accurate purchase-specific KPIs
- [ ] Stochastic Pricing tab shows Monte Carlo distribution and confidence intervals
- [ ] Pricing Surface tab renders 3D/heatmap surface correctly
- [ ] No hardcoded award ratios or TATA references
- [ ] Edge cases handled
- [ ] Screenshot evidence of all 10 tabs for QA

---

### CAP-006 — Develop & Validate Litigation Funding Dashboard

| Field | Value |
|-------|-------|
| **Type** | Story |
| **Priority** | High |
| **Related** | CAP-007, CAP-009 |

**Summary:** Develop, validate, and fix the results dashboard for the `litigation_funding` structure type.

**Description:**

**Objective:** Ensure the results dashboard for the litigation funding structure correctly renders all tabs, charts, KPIs, and data with no hardcoded values, no broken components, and accurate simulation outputs.

**Current State:**
- Structure handler exists: `engine/structures/litigation_funding.py` → `LitigationFundingHandler`
- Dashboard has structure-specific components: `LitFundingWaterfall.jsx`, `LitFundingKPIs.jsx`
- Litigation funding uses cost_multiple and award_ratio parameters for waterfall analysis
- Grid ranges defined in config: `cost_multiple_range`, `award_ratio_range`

**Validation Checklist:**

1. **Engine Output Verification**
   - Run litigation funding simulation with proper config: `cost_multiple_cap`, `award_ratio_cap`, `waterfall_type`
   - Verify `dashboard_data.json` contains: waterfall analysis, cost_multiple grid, IRR/MOIC at various cost multiples
   - Confirm waterfall logic: invested capital → cost multiple return → remaining to claimant
   - Validate that min/max waterfall types produce different outputs

2. **Dashboard Tab Verification — LITIGATION FUNDING PORTFOLIO (10 Tabs)**

   **Tab 1 — Executive Summary**
   - Portfolio Overview: Structure type, number of claims, jurisdiction breakdown
   - Headline KPIs: Expected Portfolio MOIC, Expected Portfolio IRR, Total Funding Deployed, Cost Multiple, Expected Return, Deployment Period
   - Funding Structure Summary: Cost multiple cap, award ratio cap, waterfall type (standard/min), total funding commitment
   - Risk Summary: Probability of total loss, downside MOIC (5th percentile), upside MOIC (95th percentile)

   **Tab 2 — Probability Outcomes** (ProbabilityOutcomes.jsx)
   - Probability Tree: Interactive tree showing jurisdiction-specific challenge paths with probabilities at each node
   - Scenario Paths Table: All terminal scenarios with path description, cumulative probability, expected award, funder return, MOIC, IRR
   - Probability Sensitivity: Tornado chart showing which probability nodes have the greatest impact on funder MOIC
   - Outcome Distribution: Histogram of funder MOIC outcomes across all Monte Carlo iterations

   **Tab 3 — Quantum & Timeline** (QuantumTimeline.jsx)
   - Quantum Band Distribution: Table/chart of quantum bands with probabilities and expected award values
   - Timeline Distribution: Histogram of case duration outcomes (years)
   - Expected Timeline by Scenario: Table showing scenario path, expected duration, funding deployment period
   - Interest Accumulation: Pre-award and post-award interest rates applied, total interest impact on quantum

   **Tab 4 — Investment & Waterfall Analysis** (LitFundingWaterfall.jsx)
   - Funding Waterfall: Visual waterfall showing priority of payments — invested capital, cost multiple return, remaining to claimant
   - Cost Multiple Sensitivity Grid: Cost multiple vs. award ratio vs. expected funder MOIC/IRR matrix
   - Breakeven Analysis: Minimum win probability required for breakeven at each cost multiple level
   - Waterfall Type Comparison: Side-by-side standard vs. min waterfall type outcomes

   **Tab 5 — Per-Claim Analysis** (PerClaimContribution.jsx)
   - Claim Contribution Table: Each claim with name, jurisdiction, claim value, funding deployed, expected funder return, contribution to portfolio MOIC, weight
   - Per-Claim Funding Breakdown: Individual claim funding cost multiple and expected recovery
   - Claim Risk Ranking: Claims ranked by risk-adjusted return contribution to funder

   **Tab 6 — Legal Costs** (LegalCosts.jsx)
   - Legal Cost Breakdown: Table showing cost stage, amount, timing, cumulative legal spend
   - Cost vs. Funding Ratio: Legal costs as percentage of total funding deployed per claim
   - Cost Sensitivity: Impact of legal cost overruns on funder IRR and MOIC

   **Tab 7 — Cashflow & J-Curve** (ClaimCashflow.jsx)
   - Cashflow Timeline: Time-series chart of funding deployment outflows, legal cost outflows, award/recovery inflows
   - J-Curve Visualisation: Cumulative cashflow chart showing funding deployment trough and recovery
   - Funder vs. Claimant Split: Period-by-period breakdown of funder share vs. claimant share
   - Net Cashflow Table: Period-by-period breakdown of outflows, inflows, net, cumulative

   **Tab 8 — Arb-Win Sensitivity** (ArbWinSensitivity.jsx)
   - Arbitration Win Rate Sensitivity: Chart showing win probability (x-axis) vs. expected funder MOIC (y-axis) at various cost multiples
   - Cost Multiple vs. Win Rate Grid: Heatmap of cost multiple vs. win probability vs. expected return
   - Breakeven Win Rate: Minimum arbitration win probability for funder breakeven at each cost multiple
   - Scenario Table: Table showing funder returns at key win probability thresholds (50%, 60%, 70%, 80%, 90%)

   **Tab 9 — Pricing Surface** (PricingSurface.jsx)
   - 3D/Heatmap Surface: Cost multiple (x-axis) vs. award ratio (y-axis) vs. expected funder MOIC (z-axis/colour)
   - Breakeven Contour: Contour line showing MOIC = 1.0x boundary across cost multiple and award ratio combinations
   - Optimal Pricing Point: Highlighted optimal cost multiple and award ratio for target funder MOIC

   **Tab 10 — Report Charts** (ReportCharts.jsx)
   - Exportable Chart Pack: All key charts formatted for PDF/presentation export
   - Summary Dashboard: Compact single-page view with headline KPIs and key charts

3. **Hardcoded Value Check**
   - Verify cost_multiple_range comes from user config not hardcoded engine defaults
   - Verify award_ratio_range comes from user config
   - Check that waterfall_type ('standard' vs 'min') is user-configurable
   - No "Tata" references in lit funding components

4. **Edge Cases**
   - Very high cost multiples (5x+)
   - Award ratio = 100% (funder takes everything)
   - Single-claim funding vs multi-claim portfolio funding

**Acceptance Criteria:**
- [ ] Litigation funding simulation runs end-to-end without errors (n=1000)
- [ ] All 10 dashboard tabs render correctly for litigation_funding structure
- [ ] LitFundingWaterfall.jsx displays dynamic waterfall from simulation
- [ ] LitFundingKPIs.jsx shows accurate funding-specific KPIs
- [ ] Arb-Win Sensitivity tab shows win rate vs. MOIC charts
- [ ] Pricing Surface tab renders 3D/heatmap surface correctly
- [ ] Waterfall logic matches documentation (standard and min types)
- [ ] No hardcoded values — all parameters from user input
- [ ] Edge cases handled
- [ ] Screenshot evidence of all 10 tabs for QA

---

### CAP-007 — Comprehensive Bug Audit — Results Dashboard

| Field | Value |
|-------|-------|
| **Type** | Story |
| **Priority** | Critical |
| **Blocks** | CAP-008 |

**Summary:** Perform a systematic, comprehensive bug audit across all results dashboard components for all 5 structure types. Document every bug with file, line, description, and severity.

**Description:**

**Objective:** Create a complete bug inventory for the results dashboard. The dashboard code was adapted from the original `claim-analytics` project (at `TATA_code_v2/claim-analytics/`) and contains numerous hardcoded values, TATA-specific references, UUIDs displayed instead of claim names, and structure-specific rendering issues.

**Known Issues (Starting Points):**

| # | File | Line(s) | Issue | Severity |
|---|------|---------|-------|----------|
| 1 | `dashboard/src/components/claim/ClaimCashflow.jsx` | 234, 258, 296-297 | "Tata Tail" hardcoded in labels and flow descriptions | High |
| 2 | `dashboard/src/components/v2/ProbabilityOutcomes.jsx` | 318-319 | Scenario labels: "A: TATA Wins Arb", "B: TATA Loses Arb" | High |
| 3 | `dashboard/src/components/v2/ProbabilityOutcomes.jsx` | 941 | Text: "If TATA wins the arbitration..." | High |
| 4 | `dashboard/src/components/v2/InvestmentSOC.jsx` | 30-31 | Default award = 0.70 (hardcoded "30% Tata Tail") | High |
| 5 | `dashboard/src/components/v2/DistributionExplorer.jsx` | 156 | Default "10% upfront / 20% TATA tail" text | High |
| 6 | `dashboard/src/components/ExecutiveSummary.jsx` | 67 | Claim IDs prefixed with "TP-" (TATA project) | Medium |
| 7 | Multiple components | — | UUID displayed instead of claim name in headers/titles | High |
| 8 | `dashboard/src/components/v2/ProbabilityOutcomes.jsx` | — | "TATA Project" name hardcoded in probability tab | High |

**Audit Strategy:**

1. **Automated Scan (Phase 1)**
   - Grep all dashboard `src/` files for: `TATA`, `tata`, `Tata`, `TP-`, hardcoded numeric defaults
   - Grep for hardcoded probabilities: `0.70`, `0.30`, `0.80`, `0.20`, `0.10`, `0.90`
   - Grep for hardcoded monetary values and percentages
   - Grep for raw UUID patterns in display strings

2. **Manual Visual Audit (Phase 2)**
   - Run simulation for each of the 5 structure types
   - Open results dashboard and screenshot every tab
   - Compare rendered values against `dashboard_data.json` to verify data binding
   - Note any UI that shows raw data keys instead of human-readable labels

3. **Cross-Component Audit (Phase 3)**
   - Check shared components (`Shared.jsx`, `theme.js`) for TATA-specific defaults
   - Check KPI components: `ComparativeKPIs`, `FullPurchaseKPIs`, `LitFundingKPIs`, `StagedKPIs`, `UpfrontTailKPIs`
   - Check chart components for hardcoded axis labels, legends, tooltips
   - Check `dashboardData.js` hook for data transformation assumptions

4. **Output Format**
   - Create `BUG_AUDIT_REPORT.md` with:
     - Bug ID, File, Line(s), Description, Severity (Critical/High/Medium/Low), Suggested Fix
     - Grouped by component
     - Summary statistics

**Acceptance Criteria:**
- [ ] All dashboard `.jsx` files scanned for hardcoded values
- [ ] All 5 structure types tested visually (simulation run + dashboard review)
- [ ] Bug audit report created with every identified issue catalogued
- [ ] Each bug has: file path, line numbers, description, severity, suggested fix
- [ ] Report reviewed and prioritised for CAP-008 implementation

**Technical Notes:**
- Use `grep -rn "TATA\|tata\|Tata\|TP-\|0\.70\|0\.30" dashboard/src/` as starting point
- Compare with original `claim-analytics/src/` to identify carried-over hardcoded values
- Pay special attention to `v2/` subdirectory which has the most structure-specific logic

---

### CAP-008 — Fix All Identified Dashboard Bugs (Post-Audit)

| Field | Value |
|-------|-------|
| **Type** | Story |
| **Priority** | Critical |
| **Blocked By** | CAP-007 |

**Summary:** Implement fixes for all bugs identified in the comprehensive audit (CAP-007). Replace all hardcoded values with dynamic data, fix UUID display issues, and remove all TATA-specific references.

**Description:**

**Objective:** Resolve every bug documented in the Bug Audit Report (CAP-007 output). Make the dashboard fully dynamic, data-driven, and brand-agnostic.

**Fix Categories:**

1. **TATA Branding Removal**
   - Replace all "TATA" / "Tata" references with generic terms:
     - "Tata Tail" → "Claimant Retained Share" or "Tail Payment"
     - "A: TATA Wins Arb" → "Scenario A: Claimant Wins Arbitration"
     - "B: TATA Loses Arb" → "Scenario B: Claimant Loses Arbitration"
     - "If TATA wins..." → "If the claimant wins..."
     - "TP-" prefix → remove or use claim name directly
   - Make all labels configurable from `dashboard_data.json` where possible

2. **Hardcoded Default Values**
   - `InvestmentSOC.jsx`: Replace hardcoded `0.70` with value from simulation output `data.config.award_share` or `data.structure.params.award_ratio`
   - `DistributionExplorer.jsx`: Replace hardcoded "10% upfront / 20% TATA tail" with dynamic structure description from data
   - All probability defaults: must come from simulation config, not inline constants

3. **UUID Display Fixes**
   - Identify all locations where raw UUIDs are displayed
   - Replace with `claim.name || claim.display_name || claim.claim_id.substring(0, 8)`
   - Ensure Executive Summary, Per-Claim Contribution, and any claim-referencing component uses human-readable names

4. **Data Binding Fixes**
   - Ensure every KPI, chart label, and metric reads from `dashboard_data.json`
   - Add null/undefined guards for optional fields
   - Ensure correct number formatting (₹ Cr, percentages, MOICs)

**Implementation Approach:**
- Fix in priority order: Critical → High → Medium → Low
- After each fix, verify the specific component renders correctly
- Run full visual regression for all 5 structure types after all fixes
- Build dashboard (`npx vite build`) after all changes to verify no build errors

**Acceptance Criteria:**
- [ ] Zero "TATA" / "Tata" / "tata" references remaining in dashboard source
- [ ] Zero hardcoded numeric defaults in display components
- [ ] UUIDs never shown to users — always claim names or truncated IDs
- [ ] All 5 structure type dashboards render correctly after fixes
- [ ] `npx vite build` succeeds with zero errors
- [ ] Visual regression screenshots for all 5 structures, all tabs

---

### CAP-009 — Hardcoded Values Audit & Fix — Simulation Engine

| Field | Value |
|-------|-------|
| **Type** | Story |
| **Priority** | Critical |

**Summary:** Audit the Python simulation engine for all hardcoded values and ensure all simulation parameters come exclusively from user input configuration. No default value should override user-supplied inputs.

**Description:**

**Objective:** Ensure that when a user enters simulation inputs (probabilities, quantum values, cost multiples, award ratios, durations, interest rates), those exact values are used throughout the simulation pipeline with zero hardcoded overrides.

**Known Hardcoded Values in Engine:**

| # | File | Description | Values |
|---|------|-------------|--------|
| 1 | `engine/config/defaults.py` | Quantum bands | 5 bands with hardcoded probabilities (0.15, 0.05, 0.05, 0.05, 0.70) |
| 2 | `engine/config/defaults.py` | Arbitration win probability | 0.70 |
| 3 | `engine/config/defaults.py` | Re-arbitration win probability | 0.70 |
| 4 | `engine/config/defaults.py` | Domestic S.34 win probabilities | A: 0.70 win / 0.30 lose, B: 0.30 win / 0.70 lose |
| 5 | `engine/config/defaults.py` | S.37, SLP probabilities | S.37 win: 0.80, SLP admitted: 0.10, SLP merits: 0.90/0.50 |
| 6 | `engine/v2_core/v2_json_exporter.py` L968 | Investment grid ranges | upfront: [0.05..0.30], tail: [0.10..0.40], reference award: 0.70 |
| 7 | `engine/v2_core/v2_probability_sensitivity.py` | Sensitivity shifts & deal structures | Shifts: [-0.20..+0.20], Deals: (0.10,0.20), (0.15,0.25), etc. |
| 8 | `engine/v2_core/v2_monte_carlo.py` L163-165 | Timeline horizon cap | 12.0 if SIAC, else 22.5 |
| 9 | `engine/v2_core/v2_monte_carlo.py` L318-324 | Interest rate bands | Separate domestic vs SIAC bands |

**Audit & Fix Approach:**

1. **Config Passthrough Verification**
   - For every simulation parameter, trace the data flow:
     `User Input (App UI) → API request body → configService.js → engine CLI args → config/loader.py → simulation modules`
   - At each stage, verify the user's value is preserved and not overwritten by defaults
   - Document the flow for: probabilities, quantum values, timeline durations, legal costs, interest rates, structure parameters

2. **Default vs Override Logic**
   - Defaults should ONLY apply when no user input is provided (null/undefined in config)
   - When user provides a value, it must always take precedence
   - Add logging to flag when defaults are used vs user values

3. **Jurisdiction-Specific Defaults**
   - Verify jurisdiction templates (`engine/jurisdictions/templates/*.json`) provide sensible starting points
   - Ensure user overrides from the claim editor always supersede jurisdiction defaults
   - Test with different jurisdictions: domestic, SIAC, any custom

4. **Investment Grid Ranges**
   - `v2_json_exporter.py` hardcodes `upfront_pcts` and `tata_tail_pcts` — these must come from structure params
   - If user specifies custom grid ranges in structure config, those must be used

5. **Testing Protocol**
   - Create test configs with unusual values (e.g., win probability = 0.99, quantum = 0.01)
   - Run simulation and verify output reflects exact input values
   - Compare outputs: default config vs custom config to confirm differences

**Acceptance Criteria:**
- [ ] Every simulation parameter traced from UI → engine → output
- [ ] All hardcoded defaults only apply when user input is absent
- [ ] User-supplied probabilities always used in simulation (verified by output comparison)
- [ ] Investment grid ranges driven by structure config
- [ ] Sensitivity analysis shifts/ranges configurable
- [ ] Timeline horizon caps come from jurisdiction config
- [ ] Test runs with extreme values produce expected outputs

---

### CAP-010 — Remove TATA-Specific Branding & Terminology

| Field | Value |
|-------|-------|
| **Type** | Story |
| **Priority** | High |

**Summary:** Make the entire platform brand-agnostic by replacing all TATA-specific terminology, labels, variable names, and references across all layers.

**Description:**

**Objective:** The platform was originally developed for the TATA project and contains project-specific terminology throughout the codebase. This must be genericised for production use with any client/claimant.

**Scope of Changes:**

1. **Dashboard Layer** (most impacted)
   - "Tata Tail" → "Claimant Tail" or "Retained Share"
   - "TATA Wins/Loses Arb" → "Claimant Wins/Loses Arbitration"
   - "TP-" prefix on claim IDs → remove
   - "tata_receives_cr" data key → "claimant_receives_cr" (requires engine + dashboard change)
   - All scenario descriptions referencing TATA

2. **Engine Layer**
   - Variable names: `tata_tail_pcts` → `claimant_tail_pcts` or `retained_share_pcts`
   - JSON export keys: any `tata_*` prefixed keys → generic equivalents
   - Config parameter names
   - Comment references

3. **App Layer**
   - Any form labels referencing TATA
   - Store field names
   - Placeholder text

4. **Server Layer**
   - Config service default values
   - Log messages
   - Documentation/comments

5. **Documentation**
   - README.md
   - METHODOLOGY.md
   - Any inline documentation

**Implementation Notes:**
- This should be done as a coordinated rename across all layers
- Use search-and-replace with review (not blind replace)
- Ensure dashboard_data.json key changes are reflected in both engine export AND dashboard consumption
- Backward compatibility: if existing simulation runs use old keys, add fallback in dashboardData.js

**Acceptance Criteria:**
- [ ] Zero occurrences of "TATA" / "Tata" / "tata" in source code (excluding git history)
- [ ] Zero occurrences of `tata_tail`, `tata_receives` in JSON keys/variable names
- [ ] All UI labels use generic terminology
- [ ] Existing simulation outputs still loadable (backward-compatible key fallback)
- [ ] Full build succeeds for dashboard, app, and engine tests pass

---

### CAP-011 — Server-Side Authentication & JWT Middleware

| Field | Value |
|-------|-------|
| **Type** | Story |
| **Priority** | Critical |
| **Blocked By** | CAP-001 |

**Summary:** Implement proper server-side authentication with secure JWT tokens, bcrypt password hashing, and auth middleware for all protected API routes.

**Description:**

**Objective:** Replace the current mock authentication (client-side fake JWT generation in `authStore.js`) with a real server-side authentication system backed by the PostgreSQL database.

**Current State:**
- `app/src/store/authStore.js` generates fake JWTs using `btoa()` — NOT cryptographically secure
- No server-side auth middleware exists
- No password hashing
- All API routes are unprotected
- Demo credentials hardcoded in original `claim-analytics` project (`'demo123'`)

**Requirements:**

1. **Auth API Routes** (`server/routes/auth.js`)
   - `POST /api/auth/register` — email, password, full_name → create user + return JWT
   - `POST /api/auth/login` — email, password → verify + return JWT
   - `POST /api/auth/refresh` — refresh token → new JWT pair
   - `GET /api/auth/me` — return current user profile (requires auth)
   - `PUT /api/auth/me` — update user profile (requires auth)
   - `POST /api/auth/forgot-password` — initiate password reset (stretch goal)

2. **JWT Implementation**
   - Use `jsonwebtoken` npm package
   - Access token: 15-minute expiry, signed with RS256 or HS256 with strong secret
   - Refresh token: 7-day expiry, stored in HttpOnly cookie
   - JWT payload: `{ sub: userId, email, role, iat, exp }`
   - Secret stored in environment variable `JWT_SECRET` (min 256-bit)

3. **Auth Middleware** (`server/middleware/auth.js`)
   - Extract Bearer token from Authorization header
   - Verify JWT signature and expiry
   - Attach `req.user = { id, email, role }` for downstream routes
   - Return 401 for missing/invalid/expired tokens
   - Apply to: `/api/simulate/*`, `/api/claims/*`, `/api/results/*`, `/api/payments/*`

4. **Frontend Integration**
   - Update `authStore.js` to call server auth endpoints instead of generating fake JWTs
   - Store access token in memory (not localStorage for security)
   - Store refresh token as HttpOnly cookie
   - Add axios/fetch interceptor to attach Authorization header
   - Handle 401 responses: trigger token refresh or redirect to login

5. **Security Requirements**
   - Rate limit auth endpoints: max 5 attempts per minute per IP
   - Passwords: bcrypt with salt rounds >= 12
   - No plaintext passwords in logs, errors, or responses
   - CORS: restrict to known origins only
   - HttpOnly, Secure, SameSite=Strict for cookies in production

**Acceptance Criteria:**
- [ ] Registration creates user in PostgreSQL with hashed password
- [ ] Login returns valid JWT verified by server middleware
- [ ] All protected routes return 401 without valid token
- [ ] Token refresh flow works without re-login
- [ ] Frontend login/logout flow works end-to-end
- [ ] Rate limiting on auth endpoints
- [ ] No plaintext passwords stored or logged anywhere

---

### CAP-012 — Simulation Results Persistence — DB Integration

| Field | Value |
|-------|-------|
| **Type** | Story |
| **Priority** | High |
| **Blocked By** | CAP-001, CAP-011 |

**Summary:** Persist simulation run metadata in PostgreSQL and associate runs with authenticated users, enabling run history, re-loading, and comparison.

**Description:**

**Objective:** Currently simulation results are written to `server/runs/{uuid}/` as JSON files with no user association. Integrate database persistence so each user can view their run history, reload past results, and compare runs.

**Requirements:**

1. **Run Lifecycle Database Integration**
   - On simulation start: create `simulation_runs` record (status=running, user_id, config, started_at)
   - On completion: update record (status=completed, completed_at, results_path)
   - On error: update record (status=failed, error_message)
   - Keep file-system output for large JSON files; DB stores metadata only

2. **User Run History API**
   - `GET /api/runs` — list current user's simulation runs (paginated)
   - `GET /api/runs/:id` — get run metadata + result file paths
   - `DELETE /api/runs/:id` — delete run (soft delete or archive)
   - Filter by: structure_type, status, date range
   - Sort by: created_at desc (default)

3. **Run Comparison**
   - Allow user to select 2 runs for side-by-side comparison
   - `GET /api/runs/compare?ids=uuid1,uuid2` — return both run summaries

4. **Data Isolation**
   - Users can only access their own runs (enforced at query level: `WHERE user_id = req.user.id`)
   - Admin role can access all runs (future)

**Acceptance Criteria:**
- [ ] Simulation runs create DB records on start
- [ ] Run status updates reflected in DB on completion/failure
- [ ] `GET /api/runs` returns authenticated user's runs only
- [ ] Run history accessible from App UI
- [ ] Old file-system runs still accessible (backward compatible)
- [ ] Data isolation verified — user A cannot see user B's runs

---

### CAP-013 — Input Validation & Sanitisation — Full Stack

| Field | Value |
|-------|-------|
| **Type** | Story |
| **Priority** | High |

**Summary:** Implement comprehensive input validation and sanitisation across all layers — frontend forms, API endpoints, and engine config loading.

**Description:**

**Objective:** Ensure all user inputs are validated and sanitised before processing to prevent invalid simulations, injection attacks, and data corruption.

**Requirements:**

1. **Frontend Validation (App)**
   - Claim Editor: validate all 7 tabs before allowing simulation
     - Claim value: positive number, reasonable range (0.01 - 100,000 Cr)
     - Probabilities: 0.0 - 1.0, sum constraints where applicable
     - Durations: positive, within jurisdiction-specific bounds
     - Legal costs: non-negative
     - Interest rates: 0% - 50%
   - Portfolio Builder: validate structure params
     - Cost multiples: positive, reasonable range
     - Award ratios: 0.0 - 1.0
     - Upfront/tail percentages: sum <= 1.0
   - Show inline validation errors with field-level messages

2. **Server Validation (Express)**
   - Use `express-validator` or `joi` for schema validation on all API endpoints
   - Validate: types, ranges, required fields, string lengths
   - Sanitise: trim strings, escape HTML entities, reject SQL/XSS patterns
   - Return 400 with structured error response: `{ errors: [{ field, message }] }`

3. **Engine Validation (Python)**
   - `engine/config/schema.py` already defines Pydantic models — verify all constraints
   - Add validation in `loader.py` with clear error messages
   - Validate probability trees sum to 1.0 at each node
   - Validate timeline durations are positive and consistent
   - Reject config files that would cause mathematical errors (division by zero, negative values)

4. **Cross-Layer Consistency**
   - Frontend validation rules should mirror server validation
   - Server should NEVER trust frontend validation alone
   - Engine should NEVER trust server validation alone (defence in depth)

**Acceptance Criteria:**
- [ ] All claim editor fields have inline validation
- [ ] All portfolio builder fields have inline validation
- [ ] All API endpoints validate and sanitise inputs
- [ ] Invalid inputs return clear error messages
- [ ] Engine rejects malformed configs with descriptive errors
- [ ] No SQL injection vulnerability in any endpoint
- [ ] No XSS vulnerability in any rendered output

---

### CAP-014 — Jurisdiction-Agnostic Probability Engine Verification

| Field | Value |
|-------|-------|
| **Type** | Story |
| **Priority** | High |
| **Related** | CAP-009 |

**Summary:** Verify that the simulation engine correctly uses jurisdiction-specific probability trees, timelines, and legal costs for all supported jurisdictions — and that user overrides always take precedence.

**Description:**

**Objective:** The simulation engine supports multiple jurisdictions (domestic India, SIAC Singapore, planned HKIAC Hong Kong). Ensure that each jurisdiction's probability tree, timeline model, legal costs, and challenge paths are correctly loaded and that user customizations override defaults.

**Verification Matrix:**

| Jurisdiction | Probability Tree | Timeline | Legal Costs | Challenge Paths | Interest Rates |
|-------------|-----------------|----------|-------------|-----------------|----------------|
| Domestic India | 4-level (S.34→S.37→SLP→merits) | Up to 22.5 years | INR stage costs | Scenario A + B | Domestic bands |
| SIAC Singapore | 2-level (HC→COA) | Up to 12 years | SGD/INR stage costs | Scenario A + B | SIAC bands |
| HKIAC Hong Kong (if implemented) | 3-level (CFI→CA→CFA) | TBD | HKD/INR stage costs | Scenario A + B | HK bands |

**Test Protocol:**

1. **Default Probability Flow**
   - For each jurisdiction: run simulation with ONLY jurisdiction selected (all other defaults)
   - Verify probability tree structure matches jurisdiction template
   - Verify probabilities at each node match template defaults

2. **User Override Flow**
   - For each jurisdiction: run simulation with custom probabilities (e.g., 99% win at every node)
   - Verify output probabilities reflect 99% input, NOT jurisdiction defaults
   - Verify scenario paths compute correctly with custom values

3. **Cross-Jurisdiction Comparison**
   - Same claim, same quantum, different jurisdictions
   - Verify timelines differ (domestic longer than SIAC)
   - Verify challenge tree depth differs
   - Verify legal cost structures differ

4. **Probability Sensitivity Outputs**
   - Verify sensitivity analysis tab uses actual configured probabilities as base
   - Verify shifts are applied relative to user's input, not hardcoded defaults

**Acceptance Criteria:**
- [ ] Domestic jurisdiction: all probability paths verified with custom inputs
- [ ] SIAC jurisdiction: all probability paths verified with custom inputs
- [ ] User overrides ALWAYS supersede jurisdiction defaults
- [ ] Sensitivity analysis uses actual config values as base
- [ ] No path uses hardcoded constants when user provides values
- [ ] Test report with inputs, expected outputs, actual outputs for each jurisdiction

---

### CAP-015 — End-to-End Test Suite — All 5 Structure Types

| Field | Value |
|-------|-------|
| **Type** | Story |
| **Priority** | High |

**Summary:** Create a comprehensive end-to-end test suite that validates the full simulation pipeline (config → engine → JSON output → dashboard rendering) for all 5 structure types.

**Description:**

**Objective:** Build an automated test suite that runs representative simulations for all 5 structure types and validates the outputs, ensuring no regressions as the codebase evolves.

**Test Configurations to Create:**

1. **litigation_funding** — standard waterfall, cost_multiple_cap=3.0, award_ratio_cap=0.30
2. **monetisation_upfront_tail** — 10% upfront, 20% tail, pricing grid enabled
3. **monetisation_full_purchase** — full purchase at 60% of claim value
4. **monetisation_staged** — 3 milestones at 25%, 25%, 50%
5. **comparative** — compare all 4 non-comparative structures

**For Each Structure Type:**
- Single-claim simulation (n=100, fast)
- Multi-claim portfolio (3 claims, n=100)
- Validation assertions:
  - `dashboard_data.json` exists and is valid JSON
  - `structure_type` field matches config
  - Required top-level keys present (varies by structure)
  - KPI values are within reasonable ranges (MOIC > 0, probabilities 0-1)
  - No NaN, null, or undefined in critical fields
  - Charts data arrays are non-empty

**Implementation:**
- Python test file: `engine/tests/test_e2e_structures.py`
- Use `pytest` with parametrize for all 5 structures
- Config files: `engine/tests/configs/` — one per structure type
- Can also extend `scripts/e2e_test.sh` for bash-level testing

**Acceptance Criteria:**
- [ ] 5 test configs created (one per structure type)
- [ ] All 5 simulations run successfully (n=100)
- [ ] Output validation assertions pass for all structures
- [ ] Tests run in CI-friendly mode (< 5 minutes total)
- [ ] Test report shows pass/fail per structure with details

---

### CAP-016 — Environment Configuration & Deployment Hardening

| Field | Value |
|-------|-------|
| **Type** | Story |
| **Priority** | Medium |

**Summary:** Implement proper environment configuration management with .env files, production build optimization, and deployment security hardening.

**Description:**

**Requirements:**

1. **Environment Variables**
   - Create `.env.example` with all required variables (no secrets)
   - Variables: `DATABASE_URL`, `JWT_SECRET`, `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`, `NODE_ENV`, `PORT`, `CORS_ORIGINS`, `PYTHON_PATH`
   - Use `dotenv` in server for loading
   - Vite env vars for frontend: `VITE_API_URL`, `VITE_STRIPE_PUBLISHABLE_KEY`

2. **Production Build**
   - Dashboard: `vite build` with minification and code splitting
   - App: `vite build` with minification and code splitting
   - Server: PM2 or similar process manager config
   - Docker: update `Dockerfile` and `docker-compose.yml` with PostgreSQL service

3. **Security Headers**
   - Add `helmet` middleware to Express server
   - CSP, X-Frame-Options, X-Content-Type-Options, Strict-Transport-Security
   - Remove `X-Powered-By` header

4. **CORS Hardening**
   - Production: restrict to known domains only
   - Development: allow localhost ports
   - No wildcard (`*`) in production

**Acceptance Criteria:**
- [ ] `.env.example` file created with all variables documented
- [ ] Server reads from env vars (no hardcoded secrets)
- [ ] `helmet` middleware active on all routes
- [ ] CORS configured per environment
- [ ] Docker compose includes PostgreSQL service
- [ ] Production build scripts documented in README

---

### CAP-017 — Dashboard Export Functionality — Excel & PDF

| Field | Value |
|-------|-------|
| **Type** | Story |
| **Priority** | Medium |

**Summary:** Complete and validate the Excel and PDF export functionality for all 5 structure types.

**Description:**

**Current State:**
- Excel export partially implemented (`engine/export/excel_writer.py` with openpyxl)
- PDF export exists (`engine/export/pdf_report.py`) — status unknown
- `ExportPanel.jsx` has download buttons, Excel enabled when runId present
- PDF button currently disabled

**Requirements:**

1. **Excel Export — All Structures**
   - Verify Excel export works for all 5 structure types
   - Each structure should have appropriate sheets:
     - Common: Executive Summary, Risk Metrics, Model Assumptions
     - Structure-specific: Investment Grid (upfront_tail), Waterfall Analysis (lit_funding), Purchase Sensitivity (full_purchase), Milestone Schedule (staged), Comparison Summary (comparative)
   - Professional formatting: headers, conditional coloring, currency formats
   - File naming: `{claim_name}_{structure_type}_{date}.xlsx`

2. **PDF Export — All Structures**
   - Enable PDF generation in engine pipeline
   - Include: summary page, key charts as images, KPI table, assumptions
   - Branded header/footer with run metadata
   - Enable PDF download button in ExportPanel.jsx

3. **CSV Export Enhancement**
   - Ensure CSV export includes all KPIs and key metrics
   - Proper column headers, consistent number formatting

**Acceptance Criteria:**
- [ ] Excel download works for all 5 structure types
- [ ] Excel files open correctly in Excel/Google Sheets
- [ ] PDF download button enabled and functional
- [ ] PDF includes charts, KPIs, and assumptions
- [ ] CSV export complete with all metrics
- [ ] No build errors in dashboard after export changes

---

### CAP-018 — API Rate Limiting, Logging & Monitoring

| Field | Value |
|-------|-------|
| **Type** | Story |
| **Priority** | Medium |

**Summary:** Implement API rate limiting, structured request logging, and basic health monitoring for the Express server.

**Description:**

**Requirements:**

1. **Rate Limiting**
   - Use `express-rate-limit` package
   - Global: 100 requests/minute per IP
   - Auth endpoints: 5 requests/minute per IP
   - Simulation endpoints: 10 requests/minute per user
   - Return `429 Too Many Requests` with `Retry-After` header

2. **Structured Logging**
   - Use `winston` or `pino` for structured JSON logging
   - Log levels: error, warn, info, debug
   - Log: request method, URL, status code, response time, user ID (if authenticated)
   - Separate log files: `error.log` (errors only), `combined.log` (all levels)
   - Do NOT log: passwords, tokens, full request bodies with sensitive data

3. **Health Monitoring**
   - Enhance `GET /api/health` to include:
     - Server uptime
     - Database connection status
     - Python engine availability
     - Memory usage
     - Active simulation count

**Acceptance Criteria:**
- [ ] Rate limiting active on all endpoints
- [ ] Auth endpoints have stricter rate limit
- [ ] Structured logs written with request metadata
- [ ] Health endpoint returns system status
- [ ] No sensitive data in log files

---

### CAP-019 — Comparative Analysis Dashboard Validation

| Field | Value |
|-------|-------|
| **Type** | Story |
| **Priority** | High |
| **Related** | CAP-004, CAP-005, CAP-006 |

**Summary:** Develop, validate, and fix the results dashboard for the `comparative` structure type which compares all other structures side-by-side.

**Description:**

**Objective:** The comparative structure runs all 4 non-comparative structures and presents a side-by-side analysis. Validate that all comparison views render correctly and data is consistent.

**Validation Checklist:**

1. **Engine Output Verification**
   - Run comparative simulation: verify `dashboard_data.json` contains outputs for all 4 structures
   - Verify each sub-structure's KPIs are independently computed
   - Confirm comparison metrics (which structure yields best MOIC, lowest risk, etc.)

2. **Dashboard Tab Verification**
   - **Executive Summary**: Side-by-side KPI comparison table
   - **Comparative View** (`ComparativeView.jsx`): Bar charts / radar charts comparing structures
   - **Per-Structure Drill-Down**: User can click into any structure's detailed view
   - **Risk Comparison**: Downside risk across all structures

3. **Data Consistency Check**
   - Run each structure individually AND via comparative
   - Compare: same claim with same config should produce statistically similar results
   - Document any discrepancies

4. **Component-Specific Check**
   - `ComparativeKPIs.jsx`: Verify all 4 structures appear
   - Ensure no structure is missing or showing stale data

**Acceptance Criteria:**
- [ ] Comparative simulation runs with all 4 sub-structures
- [ ] Dashboard correctly shows all 4 structures in comparison views
- [ ] KPIs match individual structure runs (within statistical tolerance)
- [ ] User can drill down into individual structure details
- [ ] ComparativeView.jsx renders all comparison charts
- [ ] Screenshot evidence for QA

---

### CAP-020 — User Workspace & Data Isolation

| Field | Value |
|-------|-------|
| **Type** | Story |
| **Priority** | High |
| **Blocked By** | CAP-001, CAP-011 |

**Summary:** Implement proper user workspace isolation ensuring each user's claims, portfolios, and simulation results are private and inaccessible to other users.

**Description:**

**Objective:** With multi-user support (CAP-001, CAP-011), ensure complete data isolation between users at the database query level, API level, and file system level.

**Requirements:**

1. **Database-Level Isolation**
   - All queries include `WHERE user_id = req.user.id` (or workspace_id scoped to user)
   - No API endpoint returns data belonging to another user
   - Foreign key constraints prevent cross-user data references

2. **File System Isolation**
   - Simulation output directories: `server/runs/{userId}/{runId}/` (namespace by user)
   - Existing runs in `server/runs/{uuid}/` migrated to default workspace
   - File access API validates ownership before serving files

3. **API Isolation Audit**
   - Review every `GET /api/*` endpoint for user scoping
   - Review every `DELETE /api/*` endpoint for ownership verification
   - Prevent IDOR (Insecure Direct Object Reference) on all endpoints

4. **Frontend Isolation**
   - Zustand stores scoped to authenticated user
   - On logout: clear all client-side state (claims, portfolios, runs)
   - On login: load only authenticated user's data from server

**Acceptance Criteria:**
- [ ] All API queries scoped to authenticated user
- [ ] File system outputs namespaced by user
- [ ] User A cannot access User B's claims/runs via API
- [ ] IDOR vulnerability test passed on all endpoints
- [ ] Logout clears all client-side user data

---

## Additional Suggested Tickets (Stretch / Next Sprint Candidates)

---

### CAP-021 — HKIAC Hong Kong Jurisdiction Implementation

| Field | Value |
|-------|-------|
| **Type** | Story |
| **Priority** | Medium |

**Summary:** Implement HKIAC Hong Kong jurisdiction with 3-level challenge tree (CFI→CA→CFA), Hong Kong-specific timelines, legal costs, and interest rates.

**Technical Notes:** Full audit of required changes documented in repo memory — 17 files across engine, app, dashboard, and server.

---

### CAP-022 — Performance Optimization — Simulation Engine

| Field | Value |
|-------|-------|
| **Type** | Story |
| **Priority** | Medium |
| **Related** | CAP-009, CAP-015 |

**Summary:** Optimize simulation engine for speed — target <=30s for 10,000-iteration single-claim simulation. Profile Python engine, optimize hot paths, consider NumPy vectorization for Monte Carlo loops.

**Description:**

**Objective:** Improve simulation performance to provide faster feedback for users running large Monte Carlo simulations, enabling more iterations and better statistical confidence without excessive wait times.

**Current State:**
- Engine can run 1,000-iteration simulations in reasonable time (~5-10s)
- 10,000-iteration simulations currently take 60-90+ seconds for single-claim
- Multi-claim portfolios scale linearly with claim count
- No formal profiling has been done to identify bottlenecks
- Monte Carlo loops use standard Python iteration in some areas

**Performance Targets:**
- Single-claim, 10,000 iterations: ≤30 seconds
- 5-claim portfolio, 10,000 iterations: ≤60 seconds
- Memory usage: no more than 2GB peak for 10,000 iterations

**Requirements:**

1. **Profiling & Bottleneck Identification**
   - Use `cProfile` to identify top 10 time-consuming functions
   - Use `line_profiler` on hot functions for line-level analysis
   - Use `memory_profiler` to identify memory allocation patterns
   - Document findings in performance report before optimization

2. **Monte Carlo Loop Optimization**
   - Review `engine/v2_core/v2_monte_carlo.py` for vectorization opportunities
   - Replace Python `for` loops with NumPy vectorized operations where possible
   - Consider using `numba` JIT compilation for compute-intensive inner loops
   - Evaluate `scipy.stats` vs custom sampling for probability distributions

3. **Probability Tree Optimization**
   - Cache compiled probability trees per jurisdiction
   - Avoid redundant tree traversals across iterations
   - Pre-compute node probabilities as NumPy arrays

4. **Timeline & Cashflow Calculation**
   - Pre-allocate output arrays for timeline calculations
   - Use NumPy broadcasting for cashflow computations across iterations
   - Avoid DataFrame operations inside iteration loops

5. **JSON Export Optimization**
   - Profile `v2_json_exporter.py` — may be significant portion of runtime
   - Consider streaming JSON output for large result sets
   - Compress output arrays (percentiles only, not full distributions)

6. **Parallel Processing (Optional/Stretch)**
   - Evaluate `multiprocessing.Pool` for claim-level parallelism
   - Consider `concurrent.futures` for embarrassingly parallel Monte Carlo batches
   - Note: Python GIL limits threading; multiprocessing or numba required for true parallelism

**Profiling Protocol:**
- Create `engine/tests/benchmark_performance.py` script
- Run baseline benchmark: single-claim n=10,000, record time and memory
- Profile with cProfile: `python -m cProfile -s cumtime -m engine.run_v2 ...`
- After each optimization, re-run benchmark and compare
- Document % improvement per optimization

**Acceptance Criteria:**
- [ ] Profiling report created documenting top 10 bottlenecks
- [ ] Single-claim 10,000-iteration simulation completes in ≤30 seconds
- [ ] 5-claim portfolio 10,000-iteration simulation completes in ≤60 seconds
- [ ] Memory usage remains under 2GB for 10,000 iterations
- [ ] No change to simulation output accuracy (results identical within floating-point tolerance)
- [ ] Benchmark script added to `engine/tests/` for future regression testing
- [ ] Performance improvements documented in CHANGELOG

**Technical Notes:**
- Profile on representative hardware (8-core CPU, 16GB RAM) for consistent benchmarks
- Consider adding `--profile` flag to engine CLI for on-demand profiling
- NumPy vectorization typically provides 10-100x speedup over Python loops
- `numba` can provide additional 2-10x on top of NumPy for tight numerical loops

---

### CAP-023 — Responsive Design — Mobile & Tablet

| Field | Value |
|-------|-------|
| **Type** | Story |
| **Priority** | Low |

**Summary:** Ensure claim editor, portfolio builder, and results dashboard are usable on tablet (1024px) and mobile (375px) breakpoints. Currently optimized for desktop only.

---

### CAP-024 — Notification System — Simulation Completion

| Field | Value |
|-------|-------|
| **Type** | Story |
| **Priority** | Medium |
| **Blocked By** | CAP-001, CAP-011 |

**Summary:** Implement email and in-app notifications when long-running simulations complete. Use WebSocket or SSE for real-time status. Email via SendGrid/AWS SES.

**Description:**

**Objective:** Provide users with real-time and email notifications when their simulations complete, eliminating the need to poll or keep the browser tab open for long-running simulations.

**Current State:**
- No notification system exists
- Users must keep browser tab open and poll for results
- No email integration configured
- Simulation status available only via API polling

**Requirements:**

1. **Real-Time Notifications — WebSocket/SSE**
   - Implement Server-Sent Events (SSE) for simulation status updates (simpler than WebSocket for one-way server→client)
   - Endpoint: `GET /api/notifications/stream` — authenticated SSE stream per user
   - Events to emit:
     - `simulation_started` — { runId, claimNames, n_iterations, estimated_time }
     - `simulation_progress` — { runId, percent_complete } (optional, if engine supports)
     - `simulation_completed` — { runId, status, duration, results_url }
     - `simulation_failed` — { runId, error_message }
   - Reconnection handling: client should auto-reconnect on connection drop
   - Alternative: WebSocket implementation via `socket.io` if bidirectional needed in future

2. **Email Notifications — SendGrid/AWS SES**
   - Integrate email provider (SendGrid preferred for simplicity)
   - Environment variables: `EMAIL_PROVIDER` (sendgrid|ses), `SENDGRID_API_KEY`, `EMAIL_FROM_ADDRESS`
   - Trigger email on simulation completion:
     - Subject: "Simulation Complete: {claim_name}"
     - Body: HTML template with run summary, key KPIs, link to results dashboard
   - Trigger email on simulation failure:
     - Subject: "Simulation Failed: {claim_name}"
     - Body: Error details, troubleshooting suggestions, link to re-run

3. **Notification Preferences — Database**
   - Add `notification_preferences` table:
     ```
     user_id (FK)
     email_on_completion BOOLEAN DEFAULT true
     email_on_failure BOOLEAN DEFAULT true
     in_app_notifications BOOLEAN DEFAULT true
     created_at, updated_at
     ```
   - API endpoints:
     - `GET /api/users/me/notifications/preferences`
     - `PUT /api/users/me/notifications/preferences`

4. **In-App Notification Center — Frontend**
   - Add notification bell icon in App header (top-right)
   - Notification dropdown showing recent notifications (last 20)
   - Notification item: icon, title, timestamp, link to resource
   - Unread count badge on bell icon
   - Mark as read on click / mark all as read button
   - Connect to SSE stream on app mount

5. **Notification Storage — Database**
   - Add `notifications` table:
     ```
     id UUID PRIMARY KEY
     user_id (FK)
     type VARCHAR (simulation_completed, simulation_failed, etc.)
     title VARCHAR
     message TEXT
     resource_type VARCHAR (simulation_run)
     resource_id UUID
     is_read BOOLEAN DEFAULT false
     created_at TIMESTAMP
     ```
   - API endpoints:
     - `GET /api/notifications` — list user's notifications (paginated, filterable)
     - `PUT /api/notifications/:id/read` — mark as read
     - `PUT /api/notifications/read-all` — mark all as read
     - `DELETE /api/notifications/:id` — dismiss notification

6. **Server Integration**
   - Update `simulationService.js` to emit SSE events on status change
   - Update `simulationService.js` to trigger email on completion/failure
   - Create `notificationService.js` for centralized notification logic
   - Create email templates in `server/templates/` (HTML + plain text)

**Acceptance Criteria:**
- [ ] SSE endpoint established and emits simulation completion events
- [ ] Email sent to user on simulation completion (if preference enabled)
- [ ] Email sent to user on simulation failure (if preference enabled)
- [ ] Notification preferences settable per user via API
- [ ] Notification center UI visible in App header
- [ ] Unread notification count badge updates in real-time
- [ ] Clicking notification navigates to results dashboard
- [ ] Notifications persist in database and survive page refresh
- [ ] Email templates professional and include key run summary
- [ ] SendGrid integration tested with actual email delivery

**Technical Notes:**
- SSE is simpler than WebSocket and sufficient for server→client push
- Use `eventsource` package on client for SSE reconnection handling
- SendGrid free tier: 100 emails/day — sufficient for development/demo
- Consider queue (Bull/Redis) for email sending to avoid blocking simulation completion
- Email templates should be responsive (mobile-friendly)

---

### CAP-025 — Audit Logging & Activity Trail

| Field | Value |
|-------|-------|
| **Type** | Story |
| **Priority** | Medium |
| **Blocked By** | CAP-001, CAP-011 |

**Summary:** Log all user actions (login, simulation run, claim edit, export) to an audit trail table for compliance and troubleshooting. Include: user_id, action, resource, timestamp, IP address.

**Description:**

**Objective:** Create a comprehensive audit logging system that records all significant user actions for compliance, security, and troubleshooting purposes. Provide API endpoints for viewing and exporting audit trails.

**Current State:**
- No structured audit logging exists
- Server logs (`console.log`) capture some request info but not user-attributed
- No database table for audit records
- No UI for viewing historical activity

**Requirements:**

1. **Audit Log Table Schema**
   - Create `audit_logs` table:
     ```
     id UUID PRIMARY KEY DEFAULT gen_random_uuid()
     user_id UUID (FK users.id, nullable for unauthenticated actions)
     action VARCHAR(100) NOT NULL
     resource_type VARCHAR(50)
     resource_id UUID
     details JSONB (flexible payload for action-specific data)
     ip_address INET
     user_agent TEXT
     created_at TIMESTAMP DEFAULT NOW()
     ```
   - Index on: `(user_id, created_at)`, `(action, created_at)`, `(resource_type, resource_id)`

2. **Actions to Log**

   **Authentication:**
   - `auth.login_success` — user_id, email
   - `auth.login_failure` — email, failure_reason
   - `auth.logout` — user_id
   - `auth.password_reset_request` — email
   - `auth.password_reset_complete` — user_id

   **Claims:**
   - `claim.create` — claim_id, claim_name
   - `claim.update` — claim_id, changed_fields (list of field names modified)
   - `claim.delete` — claim_id, claim_name
   - `claim.clone` — source_claim_id, new_claim_id

   **Portfolios:**
   - `portfolio.create` — portfolio_id, name, claim_count
   - `portfolio.update` — portfolio_id, changed_fields
   - `portfolio.delete` — portfolio_id, name

   **Simulations:**
   - `simulation.start` — run_id, claim_ids, structure_type, n_iterations
   - `simulation.complete` — run_id, duration_seconds, status
   - `simulation.cancel` — run_id
   - `simulation.delete` — run_id

   **Exports:**
   - `export.excel` — run_id, file_name
   - `export.pdf` — run_id, file_name
   - `export.csv` — run_id, file_name

   **Admin (if applicable):**
   - `admin.user_create` — created_user_id, email
   - `admin.user_delete` — deleted_user_id, email
   - `admin.user_role_change` — target_user_id, old_role, new_role

3. **Audit Middleware Implementation**
   - Create `server/middleware/auditLogger.js`
   - Middleware extracts: user_id (from JWT), IP address, user agent
   - Provide helper function: `auditLog(action, resourceType, resourceId, details)`
   - Call `auditLog()` at appropriate points in route handlers/services
   - Non-blocking: write to database asynchronously (don't slow down request)

4. **API Endpoints**
   - `GET /api/audit-logs` — list audit logs (admin only or user's own)
     - Query params: `userId`, `action`, `resourceType`, `startDate`, `endDate`, `page`, `limit`
     - Response: paginated list with total count
   - `GET /api/audit-logs/export` — export as CSV (admin only)
   - `GET /api/audit-logs/me` — current user's own activity trail

5. **Retention Policy**
   - Default retention: 90 days
   - Environment variable: `AUDIT_LOG_RETENTION_DAYS`
   - Scheduled cleanup job (daily) to purge old records
   - Consider archiving to cold storage before deletion (stretch)

6. **Admin UI (Stretch/Future)**
   - Audit log viewer in admin panel (if admin panel exists)
   - Filter by user, action type, date range
   - Export to CSV button
   - For initial implementation, API-only is sufficient

**Implementation Notes:**
- Use PostgreSQL's JSONB for flexible `details` field
- Consider partitioning `audit_logs` table by `created_at` for large deployments
- IP address: extract from `req.ip` or `X-Forwarded-For` header (behind proxy)
- Use database transactions where audit log must be atomic with the action
- For high-volume deployments, consider write-ahead queue (Redis/Bull) to buffer writes

**Acceptance Criteria:**
- [ ] `audit_logs` table created with proper schema and indexes
- [ ] All authentication actions logged (login, logout, failed attempts)
- [ ] All claim CRUD actions logged with resource IDs
- [ ] All simulation runs logged (start, complete, cancel)
- [ ] All export actions logged with file names
- [ ] IP address and user agent captured for each log entry
- [ ] `GET /api/audit-logs/me` returns current user's activity
- [ ] `GET /api/audit-logs` returns filtered logs (admin scoped or user's own)
- [ ] Retention cleanup job purges records older than configured threshold
- [ ] Audit logging does not noticeably slow down API responses
- [ ] No sensitive data (passwords, tokens) logged in details field

**Technical Notes:**
- GDPR consideration: audit logs may contain PII — include in data retention policy
- For login_failure, log email but NOT attempted password
- Use `ON DELETE SET NULL` for user_id FK so logs persist if user deleted
- Consider separate read replica connection for audit log queries to avoid impacting main DB

---

### CAP-026 — ICC (Paris) & LCIA (London) Jurisdiction Implementation

| Field | Value |
|-------|-------|
| **Type** | Story |
| **Priority** | Medium |
| **Related** | CAP-014, CAP-021 |

**Summary:** Implement ICC (International Chamber of Commerce, Paris) and LCIA (London Court of International Arbitration, London) as new jurisdictions with full probability trees, timelines, legal costs, and interest rates.

**Description:**

**Objective:** Expand the platform's jurisdiction coverage by adding two of the world's most widely used international arbitration institutions. Each jurisdiction requires a complete template defining its challenge tree, duration distributions, legal cost stages, and interest rate bands.

**Current Jurisdiction Support:**
- Domestic India (indian_domestic) — 3-level tree: S.34 > S.37 > SLP
- SIAC Singapore (siac_singapore) — 2-level tree: HC > COA
- HKIAC Hong Kong (hkiac_hongkong) — 3-level tree: CFI > CA > CFA

**Implementation Approach:**

The engine uses auto-discovery — dropping a conforming JSON template into `engine/jurisdictions/` makes it available immediately with no code changes. Both jurisdictions primarily require template authoring and optional UI tuning.

**1. ICC (Paris) — `icc_paris.json`**

- **Institution:** International Chamber of Commerce (ICC)
- **Seat of Arbitration:** Paris, France
- **Governing Law for Challenge:** French Code of Civil Procedure (Art. 1520)
- **Challenge Tree — Scenario A (Claimant Won, Respondent Challenges):**
  - Level 1: Cour d'appel de Paris (annulment application under Art. 1520)
  - Level 2: Cour de cassation (appeal on point of law)
  - Tree depth: 2 levels
- **Challenge Tree — Scenario B (Claimant Lost, Claimant Challenges):**
  - Mirror structure: Cour d'appel > Cour de cassation
- **Key Parameters to Define:**
  - Probabilities at each challenge node (research French court annulment rates — historically low, ~5-10% success rate at Cour d'appel)
  - Duration distributions: ICC arbitration typically 12–24 months; Cour d'appel 12–18 months; Cour de cassation 12–24 months
  - Legal costs per stage: EUR-denominated, converted to INR Crore equivalent
  - Interest rates: French statutory interest rate (taux d'interet legal) + any contractual rate
  - Supports restart: Yes (if award annulled, arbitration can be re-commenced)
  - Enforcement notes: New York Convention signatory; French courts highly arbitration-friendly

**2. LCIA (London) — `lcia_london.json`**

- **Institution:** London Court of International Arbitration (LCIA)
- **Seat of Arbitration:** London, England
- **Governing Law for Challenge:** English Arbitration Act 1996
- **Challenge Tree — Scenario A (Claimant Won, Respondent Challenges):**
  - Level 1: High Court (s.67 jurisdiction / s.68 serious irregularity / s.69 appeal on point of law)
  - Level 2: Court of Appeal (permission required)
  - Level 3: Supreme Court (rare, permission required)
  - Tree depth: 3 levels
- **Challenge Tree — Scenario B (Claimant Lost, Claimant Challenges):**
  - Mirror structure: High Court > Court of Appeal > Supreme Court
- **Key Parameters to Define:**
  - Probabilities: English courts rarely overturn awards; s.68 success rate ~1-2%; s.69 slightly higher but still low
  - Duration distributions: LCIA arbitration typically 12–18 months; High Court 6–12 months; Court of Appeal 6–12 months; Supreme Court 6–18 months
  - Legal costs per stage: GBP-denominated, converted to INR Crore equivalent
  - Interest rates: Bank of England base rate + contractual rate; English statutory interest (Judgments Act 1838 rate: 8%)
  - Supports restart: Yes (if award set aside, fresh arbitration possible)
  - Enforcement notes: New York Convention signatory; London considered gold standard for international arbitration enforcement

**3. Template Files to Create:**
- `engine/jurisdictions/icc_paris.json` — Full JurisdictionTemplate conforming to schema
- `engine/jurisdictions/lcia_london.json` — Full JurisdictionTemplate conforming to schema

**4. Optional UI Updates:**
- `app/src/components/claim/TimelineEditor.jsx` — Add ICC/LCIA-specific stage labels if needed
- `app/src/components/claim/TemplateSelector.jsx` — Verify new jurisdictions appear in dropdown
- `dashboard/src/components/v2/ProbabilityOutcomes.jsx` — Verify D3 tree renders correctly for 2-level (ICC) and 3-level (LCIA) trees

**5. Validation:**
- Run simulations for all 5 structure types with ICC jurisdiction
- Run simulations for all 5 structure types with LCIA jurisdiction
- Verify probability trees render correctly in dashboard
- Verify timeline distributions match template values
- Verify legal costs in correct currency denomination
- Cross-jurisdiction comparison: same claim across all 5 jurisdictions

**Research Required:**
- Actual annulment/challenge success rates at French and English courts (academic papers, ICC/LCIA statistics reports)
- Current legal cost benchmarks for ICC and LCIA proceedings (by stage)
- Current statutory/judicial interest rates for France and England
- Typical arbitration and court challenge durations from recent case data

**Acceptance Criteria:**
- [ ] `icc_paris.json` template created with complete challenge tree, timelines, costs, and interest rates
- [ ] `lcia_london.json` template created with complete challenge tree, timelines, costs, and interest rates
- [ ] Both jurisdictions auto-discovered and available via `GET /api/jurisdictions`
- [ ] Simulations run successfully for both jurisdictions across all 5 structure types
- [ ] Probability tree renders correctly in dashboard for both jurisdictions
- [ ] Timeline distributions reflect jurisdiction-specific durations
- [ ] Legal costs denominated correctly (EUR for ICC, GBP for LCIA, with INR Crore conversion)
- [ ] User can select ICC or LCIA in claim editor and override all defaults

---

## Recommended Sprint Execution Order

**Phase 1 — Foundation (Week 1)**
| Priority | Tickets | Why |
|----------|---------|-----|
| 1st | CAP-001 (Database) | Everything depends on this |
| 2nd | CAP-011 (Auth) | Depends on DB, blocks most other work |
| Parallel | CAP-007 (Bug Audit) | Can run independently while infra is being built |
| Parallel | CAP-009 (Engine Hardcoded Audit) | Can run independently |

**Phase 2 — Core Fixes (Week 2)**
| Priority | Tickets | Why |
|----------|---------|-----|
| 1st | CAP-008 (Fix Bugs) | Depends on CAP-007 audit |
| 2nd | CAP-010 (Remove TATA) | Can merge with bug fixes |
| Parallel | CAP-014 (Jurisdiction Verification) | Depends on engine audit |
| Parallel | CAP-013 (Input Validation) | Independent |

**Phase 3 — Features & Validation (Week 3)**
| Priority | Tickets | Why |
|----------|---------|-----|
| 1st | CAP-004 (Staged Dashboard — 11 tabs) | Structure validation |
| 2nd | CAP-005 (Full Purchase Dashboard — 10 tabs) | Structure validation |
| 3rd | CAP-006 (Lit Funding Dashboard — 10 tabs) | Structure validation |
| 4th | CAP-019 (Comparative Dashboard) | Depends on 004-006 |
| Parallel | CAP-012 (Results Persistence) | Depends on DB + Auth |
| Parallel | CAP-002 (Payments) | Depends on DB + Auth |

**Phase 4 — Integration & Hardening (Week 4)**
| Priority | Tickets | Why |
|----------|---------|-----|
| 1st | CAP-003 (Fund Simulation Integration) | Major integration work |
| 2nd | CAP-020 (Data Isolation) | Security requirement |
| 3rd | CAP-015 (E2E Tests) | Validates everything |
| Parallel | CAP-016 (Environment Config) | Deployment prep |
| Parallel | CAP-017 (Export) | Feature completion |
| Parallel | CAP-018 (Rate Limiting) | Security hardening |

---

## Sprint Notes

- **Sprint Scope:** 20 tickets across infrastructure, validation, security, and quality
- **Recommended with AI agent (Opus 4.6):** Highly parallelizable tasks enable concurrent execution of audit + implementation tracks
- **Critical Path:** CAP-001 → CAP-011 → CAP-012/CAP-020 (database must be first)
- **Independent Tracks:** Bug audit + engine audit can run day 1 in parallel with DB setup
- **Agent Efficiency Tip:** For bug fix tickets (CAP-008), provide the agent with the bug audit report from CAP-007 as input — this allows precise, targeted fixes rather than exploratory work
