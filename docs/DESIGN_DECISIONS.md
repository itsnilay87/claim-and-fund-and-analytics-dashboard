# Claim Analytics Platform — Design Decisions

**Version:** 1.0
**Date:** 20 March 2026

A record of every significant architectural and design decision made during the development of the Claim Analytics Platform. For each decision: the decision itself, the alternatives that were considered, and the rationale for the choice made.

---

## Table of Contents

1. [Claim vs Portfolio Separation](#1-claim-vs-portfolio-separation)
2. [Probability Tree as Data](#2-probability-tree-as-data)
3. [Five Investment Structures](#3-five-investment-structures)
4. [Litigation Funding Waterfall Design](#4-litigation-funding-waterfall-design)
5. [On-Demand Simulation (Model A)](#5-on-demand-simulation-model-a)
6. [Smart Defaults with Override Capability](#6-smart-defaults-with-override-capability)
7. [Full Depth for Both Per-Claim and Portfolio Analysis](#7-full-depth-for-both-per-claim-and-portfolio-analysis)
8. [localStorage for Prototype](#8-localstorage-for-prototype)
9. [No-Restart Mode is Per-Claim](#9-no-restart-mode-is-per-claim)
10. [Single-Claim Portfolios Allowed](#10-single-claim-portfolios-allowed)
11. [Uniform Deal Terms Across Portfolio](#11-uniform-deal-terms-across-portfolio)
12. [Claimant Perspective Only](#12-claimant-perspective-only)
13. [Structure-Specific Dashboard Tabs](#13-structure-specific-dashboard-tabs)
14. [Two Jurisdictions Only (Extensible)](#14-two-jurisdictions-only-extensible)

---

## 1. Claim vs Portfolio Separation

### Decision

A **Claim** is a legal object; a **Portfolio** is a financial object. They are fundamentally different entities with different lifecycles and different concerns.

### Alternatives Considered

- **Monolithic model**: Combine claim parameters and investment structure into a single config. This is simpler to implement but conflates legal modelling (probability trees, quantum distributions) with financial structuring (upfront percentages, tail rates).
- **Portfolio-first model**: Define everything at the portfolio level, with claims as embedded sub-objects. This makes it hard to reuse claims across different portfolio structures.

### Rationale

A single claim (e.g., TP-301-6) exists as a legal matter regardless of how it is financed. The same claim can appear in a litigation funding portfolio *and* a monetisation portfolio with completely different economics. By separating them:

- Claims are reusable across portfolios
- Legal parameters (jurisdiction trees, quantum, timelines) live on the claim
- Financial parameters (upfront%, tail%, cost multiples) live on the portfolio structure
- Users can define claims once, then explore multiple investment approaches
- The simulation engine processes claims independently (path results are structure-agnostic) and only applies deal economics post-simulation

This mirrors how litigation finance professionals actually work: diligence on the legal merits (claim) is separate from structuring the investment (portfolio).

---

## 2. Probability Tree as Data

### Decision

Jurisdiction-specific court challenge paths are encoded as **JSON data templates** with a generic recursive `TreeNode` structure, not as hardcoded Python functions per jurisdiction.

### Alternatives Considered

- **Hardcoded functions**: One Python function per jurisdiction (e.g., `simulate_indian_domestic()`, `simulate_siac()`). This was the approach in v1 of the TATA model. Each function manually encoded the S.34 → S.37 → SLP chain with hardcoded probabilities.
- **Decision matrix**: Encode outcomes as a flat probability matrix without tree structure. Simpler but loses the sequential stage information needed for timeline and cost modelling.

### Rationale

The generic tree approach was chosen because:

1. **Extensibility**: Adding ICC Paris or ICSID requires only a new JSON file, not new Python code. Zero engine changes needed.
2. **Transparency**: The tree structure is visible, editable, and renderable in the UI (D3ProbabilityTree component). Users can see exactly what probabilities drive the model.
3. **Validation**: Pydantic validators ensure structural correctness (probability sums, outcome constraints per scenario, leaf/interior node rules) at parse time.
4. **Unification**: A single `simulate_challenge_tree()` function handles all jurisdictions. Indian domestic (3-level: S.34 → S.37 → SLP = 24 terminal paths) and SIAC (2-level: HC → COA = 8 terminal paths) use the same code.
5. **Analytical computation**: `compute_tree_probabilities()` can walk any tree and compute exact outcome probabilities — useful for validation and display.

The hardcoded approach was rejected because adding a new jurisdiction required modifying core simulation code, creating a tight coupling between legal knowledge and software engineering.

---

## 3. Five Investment Structures

### Decision

The platform supports exactly five investment structures: Litigation Funding, Full Purchase, Upfront + Tail, Staged Payments, and Comparative.

### Alternatives Considered

- **Two structures only**: Litigation Funding and Monetisation (as in v1). This was the original TATA model scope.
- **Arbitrary custom structures**: Allow users to define custom cashflow formulas. This is extremely flexible but complex to implement and validate.
- **Three structures**: Lit Funding, Full Purchase, Upfront+Tail. This covers the most common structures but misses staged acquisitions.

### Rationale

The five structures cover the major transaction types observed in litigation finance practice:

| Structure | Use Case |
|-----------|----------|
| Litigation Funding | Fund bears costs, collects multiple of costs or % of award |
| Full Purchase | Outright claim acquisition at fixed price |
| Upfront + Tail | Upfront cash to claimant, investor keeps majority of award |
| Staged Payments | Milestone-based acquisition (lower upfront risk) |
| Comparative | Side-by-side comparison of lit funding vs monetisation |

The Comparative structure is particularly important: it allows investors to compare the risk/return profile of funding vs acquiring the same portfolio, which is a real strategic decision in the market. Four base structures + one comparative mode was the right balance between completeness and complexity.

---

## 4. Litigation Funding Waterfall Design

### Decision

Litigation Funding uses a `min`/`max` waterfall: the funder's return is `waterfall_fn(cost_multiple × total_costs, award_ratio × collected)` where `waterfall_fn` is either `min()` or `max()`.

### Alternatives Considered

- **Fixed return**: Funder gets a fixed multiple of costs, regardless of award size. Simple but doesn't account for the relationship between costs and award.
- **Tiered waterfall**: Multiple tiers (e.g., first 2× costs, then 25% of excess). More realistic for complex deals but adds significant parameter complexity.
- **Pure award-ratio**: Funder gets a fixed percentage of the award. Ignores the cost basis.

### Rationale

The `min`/`max` waterfall captures the two most common commercial structures:

- **`min` (conservative)**: Funder gets the *lesser* of their cost multiple and their award ratio. This protects the claimant — the funder's return is capped by both mechanisms.
- **`max` (aggressive)**: Funder gets the *greater* of the two. This benefits the funder when one mechanism produces a higher return.

This two-parameter model with a toggle creates a 2D grid (cost_multiple × award_ratio) that can be evaluated across the full parameter space, giving investors a clear view of how their returns change across deal terms. The grid evaluation runs in reasonable time because each cell computation is O(N_paths) with pre-computed path results.

---

## 5. On-Demand Simulation (Model A)

### Decision

Simulations run on demand when the user clicks "Run", not pre-computed or cached at claim creation time. Results are cached on the server for re-viewing but not reused across different portfolio configurations.

### Alternatives Considered

- **Model B (Pre-compute)**: Run simulation automatically when a claim is saved. Store path results permanently. Portfolio construction just queries stored results. Faster for portfolio iteration but expensive in storage and compute.
- **Model C (Lazy cache)**: Pre-compute claim-level paths once, then reuse across portfolios (since path results are structure-agnostic). Only recompute deal economics.

### Rationale

Model A was chosen because:

1. **Simplicity**: Each run is self-contained. No dependency management between claim changes and cached results. No stale cache invalidation logic.
2. **Correctness**: When a user changes a claim parameter (e.g., win_probability), they must explicitly re-simulate. The claim status framework (`draft` → `simulated` → `stale`) makes this visible. No risk of displaying results from an outdated config.
3. **Resource management**: 10K paths × 6 claims takes ~3 seconds on modern hardware. This is fast enough for on-demand use. Pre-computing would waste resources on portfolios that may never be viewed.
4. **Portfolio-aware simulation**: Path alignment (all claims use the same RNG seed progression in a portfolio run) requires knowing which claims are in the portfolio at simulation time. This is natural in on-demand mode.

Model C (lazy cache) is a valid future optimisation — claim-level path results *are* structure-agnostic and could be reused. The architecture supports this (server stores full path results, grid evaluation is a separate step), but the implementation complexity was deferred.

---

## 6. Smart Defaults with Override Capability

### Decision

Every claim field has a jurisdiction-calibrated default value. Users can accept defaults for rapid modelling or override any parameter for custom analysis.

### Alternatives Considered

- **No defaults / blank slate**: User must fill in every field. Accurate but slow — there are 50+ parameters across the 7 claim editor tabs.
- **Fixed defaults / no customisation**: Load jurisdiction template and lock parameters. Fast but inflexible — users can't model non-standard claims.
- **Wizard-only creation**: Step through mandatory questions, compute defaults from answers. Good UX but overly prescriptive.

### Rationale

Smart defaults with full override capability provides the best balance:

- **Speed**: A new claim can be created and simulated in under 30 seconds by selecting a jurisdiction and setting the SOC value. All other parameters use calibrated defaults.
- **Depth**: Power users can customise every node probability in the challenge tree, every quantum band, every legal cost parameter. Nothing is locked.
- **Accuracy**: Defaults come from jurisdiction templates that encode empirically calibrated probabilities (e.g., Indian S.34 set-aside rate ≈ 30%, SLP admission rate ≈ 15%).
- **Override tracking**: The UI shows which parameters differ from defaults, making it clear what the user has customised.

The defaults cascade: jurisdiction template → server defaults → claim config override. The `merge_with_defaults()` function in `loader.py` implements deep merging.

---

## 7. Full Depth for Both Per-Claim and Portfolio Analysis

### Decision

The platform provides full analytical depth at both the individual claim level (via `ClaimResults` and `claim_exporter.py`) and the portfolio level (via the main Dashboard and `json_exporter.py`).

### Alternatives Considered

- **Portfolio-only analysis**: Only show aggregate portfolio metrics. Simpler but investors need to understand claim-level drivers.
- **Claim-only then aggregate**: Analyse claims individually, manually aggregate. Misses portfolio effects (diversification, concentration risk).

### Rationale

Litigation finance decisions require understanding at both levels:

- **Claim level**: What is the probability tree? What are the quantum bands? How long will this claim take? What are the legal costs? This drives claim selection and due diligence.
- **Portfolio level**: What is the portfolio MOIC at (10% upfront, 30% tail)? What is the VaR? Which claims contribute most to risk? This drives investment structuring and risk management.

The platform computes both in a single simulation run: claim-level statistics are aggregated from per-path results, and portfolio-level metrics are computed from merged cashflows. The `per_claim` field in `GridCellMetrics` provides claim attribution within each grid cell.

---

## 8. localStorage for Prototype

### Decision

All client-side state (workspaces, claims, portfolios) is persisted to `localStorage`. The architecture is designed for eventual migration to a PostgreSQL database.

### Alternatives Considered

- **Server-side database from day one**: PostgreSQL or MongoDB. More robust but adds deployment complexity and development overhead for a prototype.
- **IndexedDB**: Larger storage limits, async API, better for structured data. More complex client-side code.
- **No persistence**: Pure in-memory. Simplest but users lose all work on page refresh.

### Rationale

localStorage was chosen because:

1. **Zero server dependency for state**: The Express server handles simulation jobs and file serving. Adding a database would require schema design, migrations, CRUD endpoints, and connection management — significant overhead for a prototype.
2. **Instant setup**: No database installation required. `npm install && npm run dev` is the complete setup.
3. **Sufficient for prototype scale**: localStorage provides 5–10 MB. A workspace with 20 claims is approximately 200 KB. This is more than adequate for single-user prototyping.
4. **Migration path**: Zustand stores use a clean interface (`createClaim()`, `updateClaim()`, `deleteClaim()`) that can be redirected to API calls without changing components. Store keys use a consistent `cap_ws_{wsId}_` prefix.

The `storageService.js` in the server directory is a placeholder for future database integration.

---

## 9. No-Restart Mode is Per-Claim

### Decision

The `no_restart_mode` flag is a per-claim setting, not a portfolio-level or simulation-level setting.

### Alternatives Considered

- **Portfolio-level toggle**: Apply no-restart to all claims simultaneously. Simpler but inappropriate when a portfolio contains mixed jurisdictions (SIAC doesn't support restart at all).
- **Simulation-level toggle**: A run-time parameter rather than a claim property. This would require re-running to compare, rather than having both results available.

### Rationale

No-restart mode remaps all `RESTART` outcomes to `LOSE` — this is a conservative sensitivity analysis that asks "what if re-arbitration never succeeds?" This is fundamentally a property of the legal claim, not the investment structure:

- Indian domestic claims have RESTART outcomes (S.34 set-aside of adverse award → re-arb). The investor may want to see the impact of assuming re-arb never works.
- SIAC claims never produce RESTART outcomes (setting aside under Singapore IAA is final). `no_restart_mode` has no effect.
- A mixed portfolio might need no-restart on the domestic claims but not the SIAC claims.

Making it per-claim allows fine-grained sensitivity analysis without re-simulation of the entire portfolio.

---

## 10. Single-Claim Portfolios Allowed

### Decision

A portfolio can contain exactly one claim. There is no minimum requirement of multiple claims.

### Alternatives Considered

- **Minimum 2 claims**: Force users to always model multi-claim portfolios, as "portfolio" implies multiple assets.
- **Separate single-claim mode vs portfolio mode with different UIs.**

### Rationale

Single-claim portfolios are legitimate and useful:

1. **Investment structuring for a single claim**: An investor may want to evaluate a single claim under different deal structures (Upfront+Tail grid) without needing a second claim.
2. **Simplicity**: Users can use the same workflow (claim → portfolio → simulate → dashboard) regardless of claim count. No need for a separate "single claim analysis" path beyond the basic `ClaimResults` page.
3. **The portfolio just happens to have one member**: All portfolio-level metrics still compute correctly (concentration = 1.0, per-claim = portfolio, etc.).

The `PortfolioConfig.claim_ids` field has `min_length=1`, not `min_length=2`.

---

## 11. Uniform Deal Terms Across Portfolio

### Decision

In the current implementation, a single set of deal terms (e.g., one upfront% and one tail%) applies uniformly to all claims in a portfolio. Per-claim deal terms are a planned future feature.

### Alternatives Considered

- **Per-claim deal terms from day one**: Each claim carries its own upfront%, tail%, cost multiple. This allows optimally different pricing for each claim but makes the grid evaluation explosively complex (it becomes an N-dimensional optimisation problem instead of a 2D grid).
- **Claim-weighted terms**: Apply terms proportional to SOC or risk profile. Novel but hard to explain and validate.

### Rationale

Uniform deal terms were chosen because:

1. **Tractable grid evaluation**: With uniform terms, the investment grid is 2D (upfront% × tail%) with ~100 cells. Per-claim terms would create an N×2-dimensional space per claim — with 6 claims, that's a 12-dimensional grid, which is computationally intractable to exhaustively evaluate.
2. **Portfolio standard practice**: Many lit finance deals apply the same structure terms across all claims in a package. Non-uniform terms are negotiated exceptions, not the default.
3. **Clear visualisation**: A 2D heat map is natural and interpretable. Higher-dimensional grids cannot be directly visualised.

The schema (`PortfolioConfig`) is designed so that per-claim terms *can* be added without breaking backward compatibility — each claim would carry optional override fields within the structure definition.

---

## 12. Claimant Perspective Only

### Decision

The platform currently models only from the claimant's perspective. Respondent perspective is supported in the schema (`ClaimConfig.perspective`) but not implemented in the engine.

### Alternatives Considered

- **Dual perspective from day one**: Model both claimant and respondent views. This would double the complexity of the challenge tree logic (who is the "challenger" in each scenario) and the cashflow builders.
- **Perspective-agnostic engine**: Make the engine produce neutral results, with perspective applied at the UI layer. Conceptually cleaner but harder to implement correctly for asymmetric structures.

### Rationale

Claimant perspective was prioritised because:

1. **Primary use case**: Litigation funders and claim monetisation investors are evaluating from the claimant's side. This is the TATA project's core scenario.
2. **Complexity management**: Challenge tree logic is already nuanced (Scenario A = won arbitration = award survives vs set aside; Scenario B = lost = restart vs confirmed). Adding respondent perspective flips the semantics of every outcome. Getting claimant right first, then extending to respondent, is the safer approach.
3. **Schema readiness**: The `perspective` field is already in `ClaimConfig`, so the data model is ready. The engine just needs conditional logic to swap scenario interpretation.

---

## 13. Structure-Specific Dashboard Tabs

### Decision

The dashboard shows only the tabs relevant to the selected investment structure. Irrelevant tabs are hidden, not greyed out.

### Alternatives Considered

- **Show all tabs always**: Display every possible tab, with "N/A" for inapplicable structures. Discoverable but cluttered.
- **Grey out inapplicable tabs**: Show them but mark as disabled. Communicates capability but adds visual noise.

### Rationale

Hiding irrelevant tabs was chosen because:

1. **Cognitive load**: A Litigation Funding analysis has no upfront% or tail%. Showing a "Pricing Grid" tab with "N/A" content is confusing and implies the data is missing rather than inapplicable.
2. **Clean UX**: Each structure type has a curated set of tabs. The user sees exactly what's relevant.
3. **Implementation simplicity**: The dashboard's `App.jsx` builds the tab list dynamically based on `structure_type`. This is simpler than maintaining enabled/disabled states across all tab combinations.

The universal tabs (Executive Summary, Per-Claim, Probability, Quantum/Timeline, Cashflow, Risk, Export) appear for *every* structure type. Structure-specific tabs (Pricing Grid, Waterfall Analysis, etc.) appear only when the corresponding data exists in `dashboard_data.json`.

---

## 14. Two Jurisdictions Only (Extensible)

### Decision

The platform ships with two jurisdiction templates — Indian Domestic Arbitration and SIAC Singapore — but the architecture supports adding new jurisdictions by dropping a JSON file into `engine/jurisdictions/templates/`.

### Alternatives Considered

- **Single jurisdiction (Indian Domestic only)**: Simpler but too limited for a platform positioning.
- **Many jurisdictions upfront**: ICC, LCIA, HKIAC, ICSID, etc. More impressive but each requires thorough legal research for accurate probability calibration.
- **User-defined jurisdictions only**: No pre-built templates; users always build their own trees. Maximum flexibility but high barrier to entry.

### Rationale

Two well-calibrated jurisdictions demonstrate the platform's multi-jurisdiction capability while keeping quality high:

1. **Indian Domestic**: The primary use case (TATA claims). Deep 3-level tree (S.34 → S.37 → SLP) with 24 terminal paths. Demonstrates complex tree handling including RESTART outcomes.
2. **SIAC Singapore**: Contrasting 2-level tree (HC → COA) with 8 terminal paths and no restart support (setting aside under Singapore IAA is final). Demonstrates jurisdiction-specific behaviour.

These two templates serve as reference implementations for the JSON format. Adding ICC Paris, LCIA London, HKIAC Hong Kong, or ICSID follows the same pattern (see `docs/JURISDICTION_GUIDE.md`). The `JurisdictionRegistry` auto-discovers all `.json` files in the templates directory — zero code changes required for new jurisdictions.

---

## 15. 2026-04-16: Expected Cashflow IRR Methodology

### Decision

Replaced arithmetic mean of per-path IRRs with expected-cashflow IRR as the primary E[IRR] metric.

### Context

The original implementation averaged per-path IRRs across Monte Carlo paths. With high loss-probability portfolios, many paths can produce IRR = -100%, which disproportionately drags the arithmetic mean and can create a mismatch versus E[MOIC].

### Rationale

IRR is a non-linear function of cashflows. In general, the mean of non-linear transforms is not equal to the transform of means. The selected approach computes:

1. expected (mean) cashflow at each date across all Monte Carlo paths
2. XIRR on this single expected cashflow stream

This produces a portfolio-level E[IRR] that is internally consistent with E[MOIC] and less sensitive to boundary effects from total-loss paths.

### Impact

- `expected_xirr` is the primary KPI metric for E[IRR]
- `mean_xirr` is retained for backward compatibility and per-path distribution diagnostics
