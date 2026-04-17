# Portfolio Analytics Fix — Implementation Prompts

## Quick Reference
| Prompt | Focus | Est. Complexity | Dependencies |
|--------|-------|-----------------|--------------|
| PROMPT 1 | IRR Methodology Fix (Engine) | HIGH | None |
| PROMPT 2 | Concentration Data & Claim Name Propagation (Engine) | MEDIUM | None |
| PROMPT 3 | Remove Hardcoded Values & Dynamic Config (Engine) | MEDIUM | None |
| PROMPT 4 | Server Validation & Config Enrichment | LOW | None |
| PROMPT 5 | Dashboard Display Fixes (React) | MEDIUM | Prompts 1-3 |
| PROMPT 6 | Integration Testing & Documentation | MEDIUM | Prompts 1-5 |

**Each prompt is designed to run in an independent Opus session within the 192K token window. Read `PORTFOLIO_FIX_PLAN.md` at the start of each session for context.**

---

## PROMPT 1 — Fix IRR Methodology: Expected Cashflow IRR (Engine/Python)

```
You are a quantitative litigation finance engineer fixing a critical mathematical error in a Monte Carlo portfolio analytics engine. The codebase is a full-stack litigation finance platform (Python engine + Node.js server + React dashboard).

## CONTEXT — Read These Files First

Read these files to understand the current architecture:
1. PORTFOLIO_FIX_PLAN.md — The master fix plan (read BUG-1 section)
2. engine/analysis/risk_metrics.py — Current IRR aggregation (WRONG approach)
3. engine/run_v2.py — _postprocess_dashboard_json() function (lines 317-500)
4. engine/v2_core/v2_investment_analysis.py — _compute_grid_cell() and analyze_investment_grid()
5. engine/simulation/metrics.py — compute_xirr(), compute_moic() implementations
6. engine/simulation/cashflow_builder.py — merge_dated_cashflows(), build_upfront_tail_cashflow()
7. engine/structures/monetisation_upfront_tail.py — Structure handler
8. engine/export/json_exporter.py — export_dashboard_json() and _build_jcurve_data()
9. engine/tests/test_metrics.py — Existing metric tests

## THE BUG

The system computes E[IRR] by averaging per-path IRRs across all 10,000 Monte Carlo paths. Paths where the portfolio loses everything return IRR = -1.0 (i.e., -100%). With a ~51% P(Loss), roughly half the paths contribute -100% IRR, dragging the average to -15.8% even though E[MOIC] = 2.30x — a clear mathematical inconsistency.

### Why Averaging Per-Path IRRs Is Wrong

IRR is a non-linear function of cashflows. The arithmetic mean of IRRs does NOT equal the IRR of the mean cashflows. This is a well-known problem in finance:

- Consider two equally likely scenarios: Path A returns 300% IRR, Path B returns -100% IRR
- Average IRR = (300% + -100%) / 2 = 100%
- But the expected cashflow has IRR ≠ 100% because IRR is non-linear
- For total-loss paths, IRR = -100% is a boundary value that dominates arithmetic averages

### The Correct Approach: Expected Cashflow IRR

The industry-standard approach for litigation finance portfolio analytics:

1. For each date point across all MC paths, compute the **arithmetic mean cashflow** (expected cashflow)
2. Construct a single **expected cashflow stream**: E[CF_t] = (1/N) × Σ_{i=1}^{N} CF_{t,i}
3. Compute XIRR on this expected cashflow stream
4. This gives E[IRR] consistent with E[MOIC]

Mathematically: If CF_t^(i) is the cashflow at time t on path i, then:
- Expected cashflow at time t: E[CF_t] = mean(CF_t^(1), CF_t^(2), ..., CF_t^(N))
- E[IRR] = XIRR(dates, [E[CF_t0], E[CF_t1], ..., E[CF_tT]])

## IMPLEMENTATION TASKS

### Task 1: Add compute_expected_cashflow_irr() to risk_metrics.py

In `engine/analysis/risk_metrics.py`, add a new function:

```python
def compute_expected_cashflow_irr(
    sim: SimulationResults,
    claims: list,
    upfront_pct: float,
    award_share_pct: float,
    pricing_basis: str = "soc",
    start_date: datetime | None = None,
) -> float:
    """Compute IRR of the expected (mean) portfolio cashflow across all MC paths.

    Instead of averaging per-path IRRs (which is mathematically incorrect because
    IRR is a non-linear function and -100% loss paths dominate the arithmetic mean),
    this function:
    1. For each MC path, builds the full dated cashflow for the portfolio
    2. Merges all path cashflows into a date-aligned matrix
    3. Computes the arithmetic mean cashflow at each date
    4. Computes XIRR on the resulting expected cashflow stream

    This is the industry-standard approach for expected IRR in litigation finance
    and produces results consistent with E[MOIC].
    """
```

Implementation steps:
- For each path_i in range(n_paths):
  - For each claim, build dated cashflows using build_upfront_tail_cashflow() (or structure-appropriate builder)
  - Merge claim cashflows for this path using merge_dated_cashflows()
  - Store the merged (dates, cashflows) for this path
- Create a union of ALL dates across ALL paths
- Build a matrix: rows = paths, columns = dates, values = cashflows (0 if no cashflow at that date for that path)
- Compute column means → expected cashflow at each date
- Call compute_xirr(all_dates_sorted, expected_cashflows) → E[IRR]

### Task 2: Add expected_xirr to GridCellMetrics

In `engine/v2_core/v2_investment_analysis.py`:
- In `_compute_grid_cell()`, after computing path_xirrs, also compute the expected-cashflow IRR
- Add `expected_xirr` field to the GridCellMetrics (or dict) returned
- The existing `mean_xirr` should remain for backward compatibility but be clearly labeled as "mean of per-path IRRs"

### Task 3: Update _postprocess_dashboard_json() in run_v2.py

In `engine/run_v2.py`, function `_postprocess_dashboard_json()`:
- The `risk.irr_distribution.mean` should use `ref.get("expected_xirr")` instead of `ref.get("mean_xirr")`
- The mc_distributions IRR histogram should ALSO compute and include the expected-cashflow IRR as a reference line
- Keep `mean_xirr` in the data for comparison/debugging, but display `expected_xirr` as the primary metric

### Task 4: Update export_dashboard_json() in json_exporter.py

Ensure the grid cell export includes `expected_xirr` alongside `mean_xirr` in every grid cell dict.

### Task 5: Add Comprehensive Tests

In `engine/tests/test_metrics.py` (or a new `test_expected_irr.py`):

```python
def test_expected_cashflow_irr_no_loss_skew():
    """E[IRR] from expected cashflows should not be dominated by -100% loss paths.

    Setup: 2-path scenario
    - Path 1: invest 100 at t=0, receive 300 at t=2years → IRR ≈ 73%
    - Path 2: invest 100 at t=0, receive 0 (total loss) → IRR = -100%

    Wrong approach: mean(73%, -100%) = -13.5%
    Correct approach: expected cashflow = [-100, 0, 150], XIRR ≈ 22.5%
    """

def test_expected_irr_consistent_with_moic():
    """If E[MOIC] = 2.3x over ~5 years, E[IRR] should be ~18-22%, not negative."""

def test_expected_irr_all_win():
    """When P(Loss) = 0%, expected IRR should equal single-path IRR."""

def test_expected_irr_all_loss():
    """When P(Loss) = 100%, expected IRR should be -100%."""
```

### Task 6: Update PORTFOLIO_FIX_PLAN.md

Mark BUG-1 as FIXED with implementation notes describing the mathematical rationale.

## VALIDATION CRITERIA
- E[IRR] for a portfolio with E[MOIC] = 2.30x and ~5yr duration should be approximately 15-25%, NOT negative
- E[IRR] should be consistent with E[MOIC] given the average duration
- All existing tests must still pass
- New tests must cover edge cases (all-win, all-loss, mixed)
- Both `mean_xirr` and `expected_xirr` should be present in output for comparison

## DO NOT
- Change compute_xirr() itself — it correctly computes XIRR for a single cashflow stream
- Remove mean_xirr from outputs — keep it for backward compatibility
- Change the per-path simulation logic — the MC paths are correct, only the aggregation is wrong
- Hard-code any IRR values — everything should be computed from actual cashflows
```

---

## PROMPT 2 — Fix Concentration Data & Claim Name Propagation (Engine/Python)

```
You are a litigation finance analytics engineer fixing data propagation bugs in a Monte Carlo portfolio analytics engine. The platform analyzes portfolios of arbitration claims with stochastic modeling.

## CONTEXT — Read These Files First

Read these files to understand the current architecture:
1. PORTFOLIO_FIX_PLAN.md — The master fix plan (read BUG-2 and BUG-3 sections)
2. engine/run_v2.py — _postprocess_dashboard_json() function (focus on lines 350-380 where risk.concentration is built)
3. engine/analysis/risk_metrics.py — _compute_concentration() function (lines 272-297) and compute_portfolio_risk() return value
4. engine/export/json_exporter.py — export_dashboard_json() function and how claims section is serialized
5. engine/v2_core/v2_investment_analysis.py — How per_claim_contributions are built
6. engine/adapter.py — merge_portfolio_results() and how claim metadata flows
7. engine/models/ — ClaimConfig model definition (check for jurisdiction, claim_type, name fields)
8. engine/config/schema.py — Pydantic config schemas

## BUG-2: CONCENTRATION DATA OVERWRITTEN

### The Problem

In `engine/run_v2.py`, the `_postprocess_dashboard_json()` function builds a `risk.concentration` object but ONLY includes `mean_p_loss`:

```python
# Current (BROKEN) code in _postprocess_dashboard_json():
"concentration": {
    "mean_p_loss": round(ref.get("p_loss", 0.0), 4),
},
```

Meanwhile, `engine/analysis/risk_metrics.py` → `_compute_concentration()` correctly computes:
- `jurisdiction_breakdown`: {"indian_domestic": 0.60, "siac_singapore": 0.40}
- `type_breakdown`: {"prolongation": 0.70, "variation": 0.30}
- Herfindahl indices

But these values are returned from `compute_portfolio_risk()` → written to dashboard JSON by `export_dashboard_json()` → then OVERWRITTEN by `_postprocess_dashboard_json()` which replaces the entire `risk` key.

### The Fix

In `_postprocess_dashboard_json()`, when building the `risk` section:
1. Preserve the existing `risk` data from the JSON (written by `export_dashboard_json()`)
2. MERGE new fields into it rather than replacing
3. Specifically, preserve `risk.concentration.jurisdiction_breakdown` and `risk.concentration.type_breakdown`

Implementation approach:
```python
# Read existing risk data
existing_risk = data.get("risk", {})
existing_concentration = existing_risk.get("concentration", {})

# Build new risk fields
new_risk = {
    "moic_distribution": {...},
    "irr_distribution": {...},
    "concentration": {
        **existing_concentration,  # Preserve jurisdiction_breakdown, type_breakdown, herfindahl
        "mean_p_loss": round(ref.get("p_loss", 0.0), 4),  # Add/override p_loss
    },
}

# Merge with existing risk (new values override, but existing keys not in new_risk are preserved)
data["risk"] = {**existing_risk, **new_risk}
```

### Defensive Measures

In `_compute_concentration()` (risk_metrics.py), add defensive handling:
- If a claim has empty string or None for `jurisdiction`, use "unknown" as the key
- If a claim has empty string or None for `claim_type`, use "unclassified" as the key
- Log a warning when this happens

In `export_dashboard_json()` (json_exporter.py), ensure the `risk` key includes the full concentration data from `compute_portfolio_risk()` and is not just the raw dict but matches the expected schema.

## BUG-3: CLAIM NAMES NOT PROPAGATING

### The Problem

Several sections of dashboard_data.json reference claims but don't include the human-readable `name` field:
- `investment_grid[key].per_claim_contributions[i]` — may use claim_id only
- `cashflow_analysis.per_claim[i]` — may use claim_id only
- `per_claim_breakdowns` — may use claim_id only

The dashboard's `getClaimDisplayName()` function looks for `claim.name`, `claim.claim_id`, `claim.archetype` — but if the objects only have `claim_id` (which may be a UUID), it falls back to "N/A".

### The Fix

Ensure every claim reference in dashboard_data.json includes the `name` field.

1. In `engine/export/json_exporter.py`:
   - Every place where a claim's data is serialized into a sub-section, include `"name": claim.name`
   - Search for all occurrences where `claim_id` or `cid` is written to a dict and ensure `name` is alongside it

2. In `engine/v2_core/v2_investment_analysis.py`:
   - In per_claim_contributions, include claim name: `{"claim_id": cid, "name": claim.name, ...}`

3. In `engine/run_v2.py` (`_postprocess_dashboard_json`):
   - When building cashflow_analysis.per_claim or any per-claim section, look up claim name from the claims list and include it
   - Build a `claim_name_map` dict at the start: {claim_id: claim_name for each claim}
   - Use it whenever writing per-claim data

4. In `engine/adapter.py`:
   - In `merge_portfolio_results()`, ensure `SimulationResults` carries claim names (add `.claim_name_map` attribute if not present)

## IMPLEMENTATION STEPS

### Step 1: Fix risk.concentration merge in run_v2.py
- Find the line where `data["risk"] = {...}` is assigned in `_postprocess_dashboard_json()`
- Change to merge pattern: `data["risk"] = {**existing_risk, ...new_fields}`
- Ensure concentration preserves existing breakdowns

### Step 2: Add defensive defaults in risk_metrics.py
- In `_compute_concentration()`, handle None/empty jurisdiction and claim_type
- Add INFO-level logging for claims with missing metadata

### Step 3: Propagate claim names in json_exporter.py
- Audit every section builder function for claim name inclusion
- Add `name` field to all per-claim dicts

### Step 4: Propagate claim names in v2_investment_analysis.py
- Add name to per_claim_contributions entries

### Step 5: Build claim_name_map in run_v2.py
- At top of _postprocess_dashboard_json(), build name lookup from claims data
- Use it when enriching per-claim sections

### Step 6: Update adapter.py
- Ensure claim_name_map available in SimulationResults

### Step 7: Add tests
- Test that dashboard_data.json output includes jurisdiction_breakdown in risk.concentration
- Test that all per-claim sections include name field
- Test defensive handling of empty jurisdiction/claim_type

### Step 8: Update PORTFOLIO_FIX_PLAN.md
- Mark BUG-2 and BUG-3 as FIXED

## VALIDATION CRITERIA
- dashboard_data.json must contain risk.concentration.jurisdiction_breakdown with actual jurisdiction data
- dashboard_data.json must contain risk.concentration.type_breakdown with actual claim type data
- Every per-claim object in dashboard_data.json must have a `name` field with a human-readable string (not UUID, not empty)
- Claims with missing jurisdiction should appear as "unknown" in breakdown (not silently dropped)
- All existing tests must pass
```

---

## PROMPT 3 — Remove Hardcoded Values & Dynamic Config Propagation (Engine/Python)

```
You are a litigation finance analytics engineer removing hardcoded values from a Monte Carlo portfolio analytics engine, replacing them with dynamic configuration parameters passed from the user interface.

## CONTEXT — Read These Files First

Read these files to understand the current architecture:
1. PORTFOLIO_FIX_PLAN.md — The master fix plan (read BUG-4 and BUG-5 sections)
2. engine/run_v2.py — _postprocess_dashboard_json() function, especially lines where ref_upfront_pct, ref_tata_tail are hardcoded
3. engine/export/json_exporter.py — _build_jcurve_data() function with hardcoded upfront_pcts, tail_pcts, max_months, legal cost splits
4. engine/structures/monetisation_upfront_tail.py — How structure params are passed
5. app/src/hooks/usePortfolio.js — What structure params the UI sends (upfront_range, tail_range)
6. server/routes/simulate.js — enrichClaimConfig() and how portfolio_config is passed to engine

## THE PROBLEM

Multiple hardcoded values exist in the engine that should come from user configuration:

### Hardcoded in run_v2.py (_postprocess_dashboard_json):
- `ref_upfront_pct = 0.10` (10% upfront) — should be the user's selected upfront %
- `ref_tata_tail = 0.20` (20% tail) — should be the user's selected tail %
- `ref_fund_share = 1.0 - ref_tata_tail` (80%) — derived from tail %
- These are used for mc_distributions (per-path MOIC/IRR histograms)

### Hardcoded in json_exporter.py (_build_jcurve_data):
- `max_months = 96` — should be derived from actual claim max_horizon_months
- `upfront_pcts = [0.05, 0.10, 0.15, 0.20, 0.25, 0.30]` — should include user's selected values
- `tail_pcts = [0.10, 0.15, 0.20, 0.25, 0.30, 0.35, 0.40]` — should include user's selected values
- `default_key = "up10_tail20"` — should default to user's selected combo
- Legal cost allocation: `0.30 / 0.70` split — should be configurable or derived from claim data

### Hardcoded in run_v2.py (reference cell selection):
- `ref_key = "10_20"` — the reference grid cell for KPI display should match user's selection

## IMPLEMENTATION TASKS

### Task 1: Thread portfolio_config Through _postprocess_dashboard_json()

Currently `_postprocess_dashboard_json()` signature:
```python
def _postprocess_dashboard_json(sim, grid, output_dir, pricing_basis, structure_type, waterfall_grid_results)
```

Add `portfolio_config` parameter and extract user-selected values:
```python
def _postprocess_dashboard_json(sim, grid, output_dir, pricing_basis, structure_type, waterfall_grid_results, portfolio_config=None):
    # Extract user-selected parameters
    structure_params = (portfolio_config or {}).get("structure", {}).get("params", {})

    # For monetisation_upfront_tail:
    user_upfront_pct = structure_params.get("upfront_pct", 0.10)  # Selected upfront %
    user_tail_pct = structure_params.get("tail_pct", 0.20)  # Selected tail %

    # If ranges were provided, use midpoint or first value
    upfront_range = structure_params.get("upfront_range", {})
    tail_range = structure_params.get("tail_range", {})
    if upfront_range:
        user_upfront_pct = upfront_range.get("min", 0.10)
    if tail_range:
        user_tail_pct = tail_range.get("min", 0.20)
```

### Task 2: Use Dynamic Values for mc_distributions

Replace:
```python
ref_upfront_pct = 0.10
ref_tata_tail = 0.20
```

With the user-selected values from Task 1. The per-path MOIC/IRR calculations should use these dynamic values.

### Task 3: Use Dynamic Reference Cell

Replace:
```python
ref_key = "10_20" if "10_20" in ig_dict else next(iter(ig_dict), None)
```

With:
```python
user_up = round(user_upfront_pct * 100)
user_tail = round(user_tail_pct * 100)
ref_key = f"{user_up}_{user_tail}" if f"{user_up}_{user_tail}" in ig_dict else next(iter(ig_dict), None)
```

### Task 4: Update _build_jcurve_data() for Dynamic Scenarios

In `engine/export/json_exporter.py`, update `_build_jcurve_data()`:
1. Accept `portfolio_config` parameter
2. Derive `max_months` from actual claim timelines: `max_months = max(claim.timeline.max_horizon_months for claim in claims)`
3. Ensure user's selected upfront/tail combo is included in the scenario grid
4. Set `default_key` to match user's selection
5. Accept the legal cost allocation parameters from config if available

### Task 5: Update All Callers

Trace the call chain and ensure `portfolio_config` is passed through:
1. `run_platform_pipeline()` → `_run_analysis_and_export()` → `_postprocess_dashboard_json()`
2. `_build_jcurve_data()` callers in `export_dashboard_json()`

### Task 6: Add Tests

```python
def test_dynamic_ref_cell_selection():
    """Reference cell should match user-selected upfront/tail combo."""

def test_mc_distributions_use_user_params():
    """mc_distributions should use user-selected upfront % and tail %, not hardcoded 10/20."""

def test_jcurve_default_key_matches_user_selection():
    """J-curve default_key should match user's selected upfront/tail combo."""

def test_jcurve_max_months_from_claims():
    """max_months should be derived from claim timelines, not hardcoded to 96."""
```

### Task 7: Update PORTFOLIO_FIX_PLAN.md

Mark BUG-4 and BUG-5 as FIXED.

## VALIDATION CRITERIA
- No hardcoded upfront_pct or tail_pct values remain in run_v2.py or json_exporter.py for business logic (only for fallback defaults)
- mc_distributions reflect user's selected upfront/tail parameters
- J-curve default scenario matches user selection
- KPI reference cell matches user selection
- All existing tests pass
- Backward compatibility maintained: if no portfolio_config is provided, defaults are used

## DO NOT
- Change the grid analysis itself — it already evaluates multiple upfront/tail combinations
- Remove the grid — the grid should still cover a range of scenarios, but the DEFAULT/reference should match user selection
- Change simulation parameters (n_paths, seed) — those are already configurable
```

---

## PROMPT 4 — Server Validation & Config Enrichment (Node.js)

```
You are a backend engineer fixing configuration validation in a Node.js/Express server that bridges a React frontend with a Python Monte Carlo simulation engine for litigation finance analytics.

## CONTEXT — Read These Files First

Read these files to understand the current architecture:
1. PORTFOLIO_FIX_PLAN.md — The master fix plan (BUG-2 server-side and BUG-3 server-side)
2. server/routes/simulate.js — enrichClaimConfig() function (lines 23-110) and POST /api/simulate/portfolio handler
3. server/services/simulationRunner.js — startRun(), _spawnPython()
4. server/services/configService.js — mergeConfig(), loadDefaults()
5. server/routes/results.js — Results serving endpoints
6. app/src/hooks/usePortfolio.js — What the frontend sends
7. app/src/store/portfolioStore.js — How portfolio state is managed
8. app/src/store/claimStore.js — How claims are stored and selected

## THE PROBLEMS

### Problem A: Claims Missing Required Fields

When the frontend sends claims to `POST /api/simulate/portfolio`, some claims may have:
- Empty `jurisdiction` — enrichClaimConfig() doesn't validate this
- Empty `claim_type` — defaults to "prolongation" which is good, but no validation log
- Empty `name` — backfilled from archetype/ID, but the logic may not cover all cases
- Missing `soc_value_cr` — could be 0 or undefined

### Problem B: Structure Config Not Fully Validated

The `portfolio_config.structure.params` may not contain the expected fields for the structure type:
- For `monetisation_upfront_tail`: should have `upfront_range` or `upfront_pct`, `tail_range` or `tail_pct`
- Missing params would cause the engine to use hardcoded defaults

### Problem C: Config Not Passed to Engine

The `portfolio_config` needs to be passed through to the Python engine so it can read user-selected parameters. Currently verify how `startRun()` passes the config to the Python subprocess.

## IMPLEMENTATION TASKS

### Task 1: Strengthen enrichClaimConfig() Validation

In `server/routes/simulate.js`, add validation in `enrichClaimConfig()`:

```javascript
function enrichClaimConfig(claim, templates) {
    // ... existing logic ...

    // VALIDATE REQUIRED FIELDS
    if (!claim.jurisdiction || typeof claim.jurisdiction !== 'string' || claim.jurisdiction.trim() === '') {
        console.warn(`[enrichClaimConfig] Claim ${claim.id || 'unknown'} missing jurisdiction, defaulting to "indian_domestic"`);
        claim.jurisdiction = 'indian_domestic';
    }

    if (!claim.claim_type || typeof claim.claim_type !== 'string' || claim.claim_type.trim() === '') {
        console.warn(`[enrichClaimConfig] Claim ${claim.id || 'unknown'} missing claim_type, defaulting to "prolongation"`);
        claim.claim_type = 'prolongation';
    }

    if (!claim.name || typeof claim.name !== 'string' || claim.name.trim() === '') {
        // Build name from available fields
        claim.name = claim.archetype || claim.claimant || `Claim-${claim.id?.substring(0, 8) || 'unknown'}`;
        console.warn(`[enrichClaimConfig] Claim ${claim.id || 'unknown'} missing name, using: "${claim.name}"`);
    }

    if (!claim.soc_value_cr || claim.soc_value_cr <= 0) {
        console.error(`[enrichClaimConfig] Claim ${claim.id || 'unknown'} has invalid SOC: ${claim.soc_value_cr}`);
        // Don't default this — it's a critical field that must come from the user
    }

    // ... rest of existing logic ...
}
```

### Task 2: Validate Portfolio Structure Config

In the POST /api/simulate/portfolio handler, add structure config validation:

```javascript
router.post('/portfolio', authenticateToken, async (req, res) => {
    const { portfolio_config, claims, templates } = req.body;

    // Validate structure config
    const structType = portfolio_config?.structure?.type;
    const structParams = portfolio_config?.structure?.params || {};

    if (structType === 'monetisation_upfront_tail') {
        if (!structParams.upfront_range && !structParams.upfront_pct) {
            console.warn('[simulate/portfolio] Missing upfront_range/upfront_pct, using defaults');
            structParams.upfront_range = structParams.upfront_range || { min: 0.05, max: 0.30, step: 0.05 };
        }
        if (!structParams.tail_range && !structParams.tail_pct) {
            console.warn('[simulate/portfolio] Missing tail_range/tail_pct, using defaults');
            structParams.tail_range = structParams.tail_range || { min: 0.10, max: 0.40, step: 0.05 };
        }
    }

    // Ensure structure.params is set back
    portfolio_config.structure.params = structParams;

    // ... continue with existing logic ...
});
```

### Task 3: Ensure portfolio_config Reaches Python Engine

Check `simulationRunner.js` → `_spawnPython()`:
- Verify the `config.json` written to the run directory includes `portfolio_config` with structure params
- The engine reads this config.json and should have access to `portfolio_config.structure.params`

Read the config.json format used by the engine (check `run_v2.py` argument parsing) and ensure the full portfolio_config is available.

### Task 4: Add Request Logging

Add structured logging for portfolio simulation requests:
```javascript
console.log(`[simulate/portfolio] Starting portfolio analysis:
  name: ${portfolio_config?.name}
  structure: ${structType}
  claims: ${claims?.length}
  claim_ids: ${claims?.map(c => c.id).join(', ')}
  upfront: ${JSON.stringify(structParams.upfront_range || structParams.upfront_pct)}
  tail: ${JSON.stringify(structParams.tail_range || structParams.tail_pct)}
`);
```

### Task 5: Add Server-Side Tests

If test files exist in `server/tests/`, add tests for enrichClaimConfig:

```javascript
describe('enrichClaimConfig', () => {
    it('should default missing jurisdiction to indian_domestic', () => { ... });
    it('should default missing claim_type to prolongation', () => { ... });
    it('should generate name from archetype when name is empty', () => { ... });
    it('should warn for zero SOC but not override', () => { ... });
    it('should normalize interest rate from percentage to fraction', () => { ... });
});
```

### Task 6: Update PORTFOLIO_FIX_PLAN.md

Note the server-side validations added.

## VALIDATION CRITERIA
- No claim reaches the Python engine with empty jurisdiction, claim_type, or name
- Portfolio structure params are validated and defaulted for each structure type
- Config.json written to run directory includes full portfolio_config
- Server logs show clear validation warnings for missing fields
- All existing server tests pass
- No breaking changes to the API contract
```

---

## PROMPT 5 — Dashboard Display Fixes (React Frontend)

```
You are a frontend engineer fixing data display issues in a React dashboard for litigation finance portfolio analytics. The dashboard renders Monte Carlo simulation results with charts, KPIs, and per-claim breakdowns.

## CONTEXT — Read These Files First

Read these files to understand the current architecture:
1. PORTFOLIO_FIX_PLAN.md — The master fix plan (all BUG frontend sections)
2. dashboard/src/components/kpis/useKPIData.js — KPI data extraction
3. dashboard/src/components/kpis/UpfrontTailKPIs.jsx — KPI card rendering
4. dashboard/src/components/ExecutiveSummary.jsx — Summary page with charts (jurisdiction bar, type bar, SOC pie)
5. dashboard/src/components/PerClaimContribution.jsx — Per-claim breakdown tab
6. dashboard/src/components/CashflowWaterfall.jsx — Cashflow & waterfall tab
7. dashboard/src/components/RiskAnalytics.jsx — Risk analytics tab
8. dashboard/src/utils/claimNames.js — Claim name resolution utility
9. app/src/pages/PortfolioResults.jsx — How dashboard data is loaded and passed

Also read these dashboard files to understand the full tab structure:
10. dashboard/src/components/QuantumTimeline.jsx
11. dashboard/src/components/PricingGrid.jsx
12. dashboard/src/components/ProbabilityOutcomes.jsx
13. dashboard/src/components/StochasticPricing.jsx
14. List all files in dashboard/src/ to find any other components

## THE PROBLEMS

### Problem 1: E[IRR] KPI Shows Wrong Value
After PROMPT 1 fixes the engine to output `expected_xirr` alongside `mean_xirr`, the dashboard needs to prefer `expected_xirr`.

### Problem 2: "No jurisdiction data" and "No type data" 
After PROMPT 2 fixes the engine to properly propagate concentration data, verify the dashboard correctly reads and renders it. The dashboard code in ExecutiveSummary.jsx reads from `risk.concentration.jurisdiction_breakdown` — if the engine now properly outputs this, the chart should work. But we need to verify the component handles edge cases.

### Problem 3: Claim Names Not Appearing
Several tabs show UUIDs or "N/A" instead of claim names. The `getClaimDisplayName()` function needs to handle more input shapes, and each tab component needs to use it consistently.

## IMPLEMENTATION TASKS

### Task 1: Update useKPIData.js for expected_xirr

In `dashboard/src/components/kpis/useKPIData.js`:

```javascript
// Current:
const eIrr = ref.mean_xirr || irrDist.p50 || 0;

// Fixed — prefer expected_xirr (expected cashflow IRR) over mean_xirr (average of per-path IRRs):
const eIrr = ref.expected_xirr ?? ref.mean_xirr ?? irrDist.p50 ?? 0;
```

Also add a tooltip/label indicator:
```javascript
const irrLabel = ref.expected_xirr != null ? 'E[IRR]' : 'Mean IRR';
```

### Task 2: Fix ExecutiveSummary.jsx Concentration Charts

In `dashboard/src/components/ExecutiveSummary.jsx`:

1. Verify jurisdiction bar chart reads from correct path:
```javascript
const jurisdictionData = useMemo(() => {
    const jb = risk?.concentration?.jurisdiction_breakdown || {};
    if (Object.keys(jb).length === 0) {
        // Fallback: try to compute from claims list
        const claims = data?.claims || [];
        const totalSOC = claims.reduce((s, c) => s + (c.soc_value_cr || 0), 0);
        if (totalSOC > 0) {
            const jurSums = {};
            claims.forEach(c => {
                const jur = c.jurisdiction || 'Unknown';
                jurSums[jur] = (jurSums[jur] || 0) + (c.soc_value_cr || 0);
            });
            return Object.entries(jurSums).map(([k, v]) => ({
                name: k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
                weight: +((v / totalSOC) * 100).toFixed(1),
            }));
        }
    }
    return Object.entries(jb).map(([k, v]) => ({
        name: k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
        weight: +(v * 100).toFixed(1),
    }));
}, [risk, data]);
```

2. Same pattern for type_breakdown → claim_type distribution chart.

3. Change "No jurisdiction data" / "No type data" fallback messages to be more informative:
```javascript
// Instead of just "No jurisdiction data":
{jurisdictionData.length === 0 ? (
    <p className="text-gray-400 text-sm">
        Jurisdiction data unavailable. Ensure claims have jurisdiction field set.
    </p>
) : (
    <BarChart ... />
)}
```

### Task 3: Fix Claim Names Across All Tabs

In `dashboard/src/utils/claimNames.js`, expand the fallback chain:

```javascript
export function getClaimDisplayName(claim) {
    if (!claim) return 'N/A';

    // Try all possible name fields in priority order
    const candidates = [
        claim.name,
        claim.claim_name,
        claim.display_name,
        claim.label,
    ];

    for (const candidate of candidates) {
        if (candidate && typeof candidate === 'string' && candidate.trim() !== '' && !isUUID(candidate)) {
            return candidate.trim();
        }
    }

    // Try ID-based fields (only if not UUID)
    const idCandidates = [claim.claim_id, claim.id, claim.cid];
    for (const candidate of idCandidates) {
        if (candidate && typeof candidate === 'string' && !isUUID(candidate)) {
            return candidate.trim();
        }
    }

    // Try archetype/type
    if (claim.archetype && typeof claim.archetype === 'string') return claim.archetype;
    if (claim.claim_type && typeof claim.claim_type === 'string') {
        return claim.claim_type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    }

    return 'N/A';
}
```

### Task 4: Audit All Tab Components for Claim Name Usage

For each dashboard tab component, verify it uses `getClaimDisplayName()` or similar for displaying claim names. Check:

1. **PerClaimContribution.jsx** — Per-claim tables/charts should use getClaimDisplayName()
2. **CashflowWaterfall.jsx** — Claim names in waterfall breakdown
3. **QuantumTimeline.jsx** — Claim names in quantum distribution
4. **PricingGrid.jsx** — Per-claim contribution columns
5. **RiskAnalytics.jsx** — Concentration by claim
6. **ProbabilityOutcomes.jsx** — Per-claim probability trees
7. **StochasticPricing.jsx** — Per-claim pricing data

For each tab, ensure:
- Import `getClaimDisplayName` from utils
- Use it wherever claim identifiers are displayed to users
- If the tab receives data as `{claim_id: "...", ...}` without `name`, look up the name from the top-level `data.claims` array

### Task 5: Add a claim name lookup utility

In `dashboard/src/utils/claimNames.js`, add a helper:

```javascript
/**
 * Build a lookup map from claim_id → display name using the top-level claims array.
 * Use this when per-claim data sections only have claim_id and you need the display name.
 */
export function buildClaimNameMap(claims) {
    const map = {};
    (claims || []).forEach(c => {
        const id = c.claim_id || c.id;
        if (id) {
            map[id] = getClaimDisplayName(c);
        }
    });
    return map;
}
```

Then in each tab component:
```javascript
const claimNameMap = useMemo(() => buildClaimNameMap(data?.claims), [data]);
// Use: claimNameMap[item.claim_id] || getClaimDisplayName(item)
```

### Task 6: Fix J-Curve Default Selection

In the J-curve fan chart component (JCurveFanChart.jsx or similar):
- Read `jcurve_data.default_key` from the data (which the engine will now set to user's selection after PROMPT 3)
- Use it as the initial selected scenario in the dropdown
- Verify that available_combos is properly populated

### Task 7: Update PORTFOLIO_FIX_PLAN.md

Mark frontend portions of all BUGs as FIXED.

## VALIDATION CRITERIA
- E[IRR] KPI card shows the expected-cashflow IRR (should be positive for portfolios with E[MOIC] > 1.0x)
- Jurisdiction breakdown chart shows actual jurisdiction data (e.g., "Indian Domestic: 60%")
- Claim type chart shows actual claim types (e.g., "Prolongation: 70%")
- All tab components display human-readable claim names, not UUIDs
- J-curve chart defaults to user-selected upfront/tail scenario
- Charts gracefully handle edge cases (empty data, missing fields)
- No console errors in browser dev tools

## DO NOT
- Change the dashboard's data fetching mechanism
- Add new API endpoints
- Modify the dashboard routing
- Add new dependencies unless absolutely necessary
```

---

## PROMPT 6 — Integration Testing, Verification & Documentation Update

```
You are a quality assurance engineer and technical writer verifying the complete fix of a portfolio analytics platform for litigation finance. Previous prompts (1-5) fixed: IRR methodology, concentration data propagation, claim name display, hardcoded value removal, and dashboard rendering.

## CONTEXT — Read These Files First

Read these files to understand what was changed:
1. PORTFOLIO_FIX_PLAN.md — The master fix plan (check BUG status)
2. docs/ARCHITECTURE.md — Current architecture documentation
3. docs/API_CONTRACTS.md — Current API contracts
4. docs/SCHEMA_REFERENCE.md — Current schema reference
5. docs/DESIGN_DECISIONS.md — Current design decisions
6. engine/tests/ — All test files (list directory)
7. server/tests/ — All test files (list directory)

## TASK 1: Integration Test — End-to-End Portfolio Analysis

Create a comprehensive integration test that verifies the full pipeline:

### File: engine/tests/test_portfolio_integration.py

```python
"""
End-to-end integration test for portfolio analysis pipeline.

Verifies that a 2-claim portfolio produces correct and internally consistent results:
1. E[IRR] is computed from expected cashflows (not averaged per-path IRRs)
2. E[IRR] is consistent with E[MOIC] and average duration
3. Jurisdiction and claim_type breakdowns are populated
4. All per-claim sections include human-readable names
5. No hardcoded reference deal values leak into output
6. J-curve scenarios include user-selected parameters
"""
import json
import os
import tempfile
from datetime import datetime

def test_two_claim_portfolio_end_to_end():
    """
    Create a 2-claim portfolio:
    - Claim A: indian_domestic, prolongation, SOC=125 Cr
    - Claim B: indian_domestic, prolongation, SOC=219 Cr

    Run with upfront=10%, tail=20%, n_paths=1000 (fast test).
    Verify all output sections.
    """

def test_irr_moic_consistency():
    """
    Verify that E[IRR] is consistent with E[MOIC]:
    - If E[MOIC] = M and average duration = D years
    - Then E[IRR] should be approximately M^(1/D) - 1
    - Allow 20% tolerance for non-linearity
    """

def test_concentration_data_present():
    """
    Verify dashboard_data.json contains:
    - risk.concentration.jurisdiction_breakdown (non-empty dict)
    - risk.concentration.type_breakdown (non-empty dict)
    - risk.concentration.herfindahl_by_jurisdiction (float)
    - risk.concentration.herfindahl_by_type (float)
    """

def test_claim_names_in_all_sections():
    """
    Verify every per-claim reference in dashboard_data.json has 'name' field:
    - claims[]
    - investment_grid[key].per_claim_contributions[]
    - cashflow_analysis.per_claim[]
    """

def test_no_hardcoded_ref_deal():
    """
    Run with upfront=15%, tail=25%.
    Verify:
    - mc_distributions use 15/25 NOT 10/20
    - jcurve_data.default_key = "up15_tail25" NOT "up10_tail20"
    - KPI reference cell = "15_25" NOT "10_20"
    """
```

## TASK 2: Verify Existing Tests Pass

Run all existing test suites and report results:

```bash
# Python engine tests
cd engine && python -m pytest tests/ -v --tb=short 2>&1 | head -100

# Server tests (if vitest configured)
cd server && npx vitest run --reporter=verbose 2>&1 | head -100
```

Fix any test failures introduced by the changes.

## TASK 3: Schema Validation Test

Create a JSON schema validator for dashboard_data.json:

### File: engine/tests/test_dashboard_schema.py

Verify that the output JSON conforms to the expected schema:
- `claims` is a non-empty array, each with `claim_id`, `name`, `jurisdiction`, `claim_type`, `soc_value_cr`
- `risk.concentration` has `jurisdiction_breakdown` (dict), `type_breakdown` (dict)
- `risk.irr_distribution` has `p5`, `p25`, `p50`, `p75`, `p95`, `mean`; `mean` should be > -0.50 for typical portfolios
- `investment_grid` has at least one cell with `mean_moic`, `mean_xirr`, `expected_xirr`, `p_loss`
- `mc_distributions` has `moic`, `irr`, `n_paths`
- `jcurve_data` has `scenarios` (dict), `available_combos` (array), `default_key` (string)

## TASK 4: Update Documentation

### 4a: Update docs/ARCHITECTURE.md

Add a section on IRR methodology:
```markdown
## IRR Methodology

### Expected Cashflow IRR (Primary Metric)
The platform computes E[IRR] using the **expected cashflow method**:
1. For each Monte Carlo path, build the full dated cashflow stream for the portfolio
2. Aggregate cashflows across all paths at each date point to compute the expected (mean) cashflow
3. Compute XIRR on the resulting expected cashflow stream

This approach is preferred over averaging per-path IRRs because:
- IRR is a non-linear function — the arithmetic mean of IRRs ≠ IRR of mean cashflows
- Total-loss paths (IRR = -100%) dominate arithmetic averages, producing misleadingly negative E[IRR]
- The expected-cashflow IRR is consistent with E[MOIC] and represents the investor's expected return

### Per-Path IRR Distribution (Secondary Metric)
The system also computes per-path IRRs for distribution analysis (histograms, percentiles).
These are used for risk metrics (VaR, CVaR, P(hurdle)) but NOT for the primary E[IRR] KPI.
```

### 4b: Update docs/SCHEMA_REFERENCE.md

Add `expected_xirr` field to the investment_grid cell schema:
```markdown
### Investment Grid Cell
| Field | Type | Description |
|-------|------|-------------|
| mean_moic | float | Mean MOIC across all MC paths |
| mean_xirr | float | Mean of per-path XIRRs (legacy, kept for backward compatibility) |
| expected_xirr | float | **NEW** — XIRR of expected cashflow stream (primary E[IRR] metric) |
| p_loss | float | Probability of MOIC < 1.0 |
| p_hurdle | float | Probability of IRR > hurdle rate (default 30%) |
```

### 4c: Update docs/API_CONTRACTS.md

Document the dashboard_data.json contract changes:
- `risk.concentration` now always includes `jurisdiction_breakdown` and `type_breakdown`
- Per-claim sections now always include `name` field
- Investment grid cells now include `expected_xirr`
- `jcurve_data.default_key` reflects user-selected parameters
- `mc_distributions` reflect user-selected upfront/tail, not hardcoded 10/20

### 4d: Update docs/DESIGN_DECISIONS.md

Add entry:
```markdown
## 2026-04-16: Expected Cashflow IRR Methodology

**Decision:** Replaced arithmetic mean of per-path IRRs with expected-cashflow IRR as the primary E[IRR] metric.

**Context:** The original implementation averaged per-path IRRs across 10,000 Monte Carlo paths. With ~51% P(Loss), roughly 5,100 paths had IRR = -100%, dominating the arithmetic mean and producing E[IRR] = -15.8% for a portfolio with E[MOIC] = 2.30x — a clear mathematical inconsistency.

**Rationale:** In quantitative finance, IRR is a non-linear function of cashflows. The arithmetic mean of non-linear functions does not, in general, equal the function of arithmetic means. The expected-cashflow approach:
1. Computes the expected (mean) cashflow at each date across all MC paths
2. Computes XIRR on this single expected cashflow stream
3. Produces E[IRR] consistent with E[MOIC] (e.g., ~18-22% instead of -15.8%)

**Impact:** The `mean_xirr` field is retained for backward compatibility and for per-path distribution analysis. The new `expected_xirr` field is the primary metric displayed in KPI cards.
```

## TASK 5: Update PORTFOLIO_FIX_PLAN.md

Update the status of all bugs to FIXED with completion dates and verification notes.

## TASK 6: Create a Verification Checklist

### File: PORTFOLIO_FIX_VERIFICATION.md

```markdown
# Portfolio Fix Verification Checklist

## Pre-Deployment Checks

### IRR Methodology (BUG-1)
- [ ] E[IRR] for ORIGO portfolio is positive (15-25% range) at 10/20 upfront/tail
- [ ] E[IRR] is consistent with E[MOIC]: if MOIC=2.3x, duration~5yr, IRR~18-22%
- [ ] mc_distributions.irr histogram shows realistic distribution (not dominated by -100%)
- [ ] Both mean_xirr and expected_xirr present in investment grid cells
- [ ] All metric tests pass (test_metrics.py, test_expected_irr.py)

### Concentration Data (BUG-2)
- [ ] Jurisdiction breakdown chart shows data (not "No jurisdiction data")
- [ ] Claim type chart shows data (not "No type data")
- [ ] Herfindahl indices are computed and in valid range [0, 1]
- [ ] Claims with missing jurisdiction default to "unknown" with warning log

### Claim Names (BUG-3)
- [ ] Executive Summary SOC chart shows claim names
- [ ] Per-Claim Contribution tab shows claim names
- [ ] Cashflow Waterfall tab shows claim names
- [ ] All other tabs show claim names where applicable
- [ ] No UUIDs visible anywhere in the dashboard

### Dynamic Config (BUG-4)
- [ ] mc_distributions correspond to user-selected upfront/tail, not 10/20
- [ ] KPI reference cell matches user-selected combo
- [ ] J-curve default_key matches user selection

### J-Curve (BUG-5)
- [ ] J-curve max_months derived from actual claim timelines
- [ ] Legal cost allocation configurable or derived from claim data
- [ ] User-selected combo is in available_combos
```

## VALIDATION CRITERIA
- All Python tests pass (0 failures)
- All server tests pass (0 failures)
- Documentation accurately reflects current implementation
- Verification checklist covers all bug fixes
- PORTFOLIO_FIX_PLAN.md shows all bugs as FIXED
```

---

## Session Continuity Notes

Each prompt above is self-contained. However, to maintain context across sessions:

1. **Start every session** by reading `PORTFOLIO_FIX_PLAN.md` — it contains the master bug inventory and status
2. **After each session**, update `PORTFOLIO_FIX_PLAN.md` with completion notes
3. Prompts 1-4 are **independent** and can run in any order
4. Prompt 5 (Dashboard) should run **after** Prompts 1-3 (it reads the new fields they produce)
5. Prompt 6 (Integration Testing) should run **last**

## Key Architecture Reference

```
Frontend (React)  →  Server (Node.js)  →  Engine (Python)  →  Dashboard JSON  →  Dashboard (React)

Portfolio Creation     enrichClaimConfig()    run_v2.py             dashboard_data.json    ExecutiveSummary
ClaimSelector.jsx      POST /simulate/        run_platform_pipeline  export_dashboard_json  PerClaimContribution
PortfolioBuilder.jsx   portfolio              _postprocess_dashboard  risk_metrics.py        useKPIData.js
usePortfolio.js        simulationRunner.js    v2_investment_analysis  json_exporter.py       claimNames.js
```
