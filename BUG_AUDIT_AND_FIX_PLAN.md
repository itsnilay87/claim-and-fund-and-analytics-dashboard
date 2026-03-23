# Comprehensive Bug Audit & Fix Plan — Claim Analytics Platform

> **Audit Date**: 2026-03-22  
> **Auditor**: Copilot (Claude Opus 4.6)  
> **Scope**: Full codebase audit — server, engine, dashboard, app  
> **Root Cause Pattern**: AI agent code generation introduced structural mismatches between the V2 engine's output format, the platform's Pydantic schemas, and the dashboard's expected data shape. Multiple layers were built independently without end-to-end integration testing.

---

## Executive Summary

| Severity | Count | User Impact |
|----------|-------|-------------|
| 🔴 CRITICAL | 4 | Portfolio simulation won't start; dashboard shows wrong/zero metrics |
| 🟠 HIGH | 4 | Development mode broken; interest rates may be wrong; missing data |
| 🟡 MEDIUM | 4 | UX issues, resource leaks, misleading fallback values |

**Primary Failure Mode**: A user creates a portfolio → selects claims → configures Upfront+Tail structure → clicks "Run Analysis" → simulation CRASHES because the app sends grid range fields as `start/stop` but the Python engine expects `min/max`. Even if this is fixed, the results dashboard would show ALL ZEROS because the V2 engine outputs data in a different JSON format than what the dashboard components read.

---

## 🔴 CRITICAL BUGS (Must Fix First)

### C1: Portfolio Simulation Crashes — Grid Range Field Name Mismatch

**Files**: `app/src/hooks/usePortfolio.js` (line ~233), `engine/config/schema.py` (line ~615)

**What Happens**:
- `buildConfig()` constructs the API payload with:
  ```js
  upfront_range: { start: ur.min / 100, stop: ur.max / 100, step: ur.step / 100 }
  ```
- The Python `_GridRange` Pydantic model expects:
  ```python
  class _GridRange(BaseModel):
      min: float = Field(...)  # REQUIRED — no default
      max: float = Field(...)  # REQUIRED — no default
      step: float = Field(...)
  ```
- Result: `PortfolioConfig.model_validate(raw)` in `run_v2.py` raises `ValidationError` because `min` and `max` are missing (it sees `start` and `stop` instead).
- Python exits with code 1. `simulationRunner.js` marks run as "failed".

**Why It Happened**: The AI agent wrote the frontend `buildConfig()` independently from the Python schema, using NumPy-style naming (`start/stop`) instead of the Pydantic schema's naming (`min/max`).

**Fix**:
```js
// app/src/hooks/usePortfolio.js — change buildConfig() for monetisation_upfront_tail:
upfront_range: { min: ur.min / 100, max: ur.max / 100, step: ur.step / 100 },
tail_range: { min: tr.min / 100, max: tr.max / 100, step: tr.step / 100 },
```

**Verification**: Submit a portfolio with Upfront+Tail structure → Python process should complete without Pydantic error.

---

### C2: Dashboard Shows Zero Metrics — investment_grid Format Mismatch

**Files**: `engine/v2_core/v2_json_exporter.py` (line ~1280), `dashboard/src/components/ExecutiveSummary.jsx` (line ~32), `dashboard/src/data/dashboardData.js`

**What Happens**:
- V2 JSON exporter outputs:
  ```json
  { "investment_grid_soc": [ {"upfront_pct": 0.05, "tata_tail_pct": 0.10, "mean_moic": 2.34, ...}, ... ] }
  ```
  This is a **flat LIST OF DICTS** keyed by `investment_grid_soc`.

- The dashboard reads:
  ```js
  const ig = data.investment_grid || {};   // ← undefined, falls back to {}
  const refKey = ig['10_20'] ? '10_20' : ig['10_10'] ? '10_10' : Object.keys(ig)[0];
  const ref = ig[refKey] || {};            // ← empty
  const eMoic = ref.mean_moic || 0;        // ← 0
  ```
  The dashboard expects a **DICT keyed by "10_20" strings** under `investment_grid`.

- Result: Every KPI shows `0.00x` MOIC, `0.0%` IRR, `0.0%` P(Loss).

**Why It Happened**: The V2 engine was copied verbatim from the standalone TATA_code_v2 project. Its JSON format was designed for its own dashboard (which renders lists). The platform's dashboard was built to read a dict-keyed format. The AI agent never reconciled these two formats.

**Fix** — Add normalization in `dashboardData.js` after loading data:
```js
function normalizeV2GridFormat(data) {
  // Convert V2's investment_grid_soc list → platform's investment_grid dict
  if (!data.investment_grid && data.investment_grid_soc) {
    const grid = {};
    for (const row of data.investment_grid_soc) {
      const up = Math.round(row.upfront_pct * 100);
      const tail = Math.round(row.tata_tail_pct * 100);
      grid[`${up}_${tail}`] = row;
    }
    data.investment_grid = grid;
  }
}
```

**Verification**: After simulation completes, the Executive Summary tab should show non-zero E[MOIC], E[IRR], P(Loss) values.

---

### C3: Risk Analytics Tab Blank — V2 JSON Missing `risk` Section

**Files**: `engine/v2_core/v2_json_exporter.py`, `dashboard/src/components/RiskAnalytics.jsx`

**What Happens**:
- V2 JSON has NO `risk` block — no `moic_distribution`, `irr_distribution`, `stress_scenarios`, etc.
- `RiskAnalytics.jsx` reads `data.risk` which is `undefined`.
- Result: Risk Analytics tab either shows nothing or crashes with `Cannot read properties of undefined`.

**Why It Happened**: The V2 engine was designed for a different dashboard that calculates risk metrics client-side from raw grid data. The platform dashboard expects pre-computed risk metrics in the JSON.

**Fix** — Build a `risk` section in the V2 export by adding post-processing in `run_v2.py`:
```python
# After V2 export, post-process to add risk section from grid data
def _build_risk_section(grid, sim):
    """Build platform-compatible risk section from V2 grid results."""
    # Extract MOIC and XIRR distributions from grid cells
    moics = [cell.mean_moic for cell in grid.cells.values()]
    xirrs = [cell.mean_xirr for cell in grid.cells.values()]
    return {
        "moic_distribution": { "p5": ..., "p25": ..., "p50": ..., "p75": ..., "p95": ... },
        "irr_distribution": { ... },
        "concentration": { ... },
    }
```

**Verification**: Risk Analytics tab displays MOIC distribution histogram and percentile stats.

---

### C4: Dashboard Tab Routing Missing `structure_type`

**Files**: `engine/v2_core/v2_json_exporter.py` (line ~1276), `dashboard/src/App.jsx`, `dashboard/src/data/dashboardData.js`

**What Happens**:
- V2 JSON has no top-level `structure_type` field.
- Dashboard's `useDashboardData()` returns:
  ```js
  structureType: data?.structure_type || data?.simulation_meta?.structure_type || 'monetisation_upfront_tail'
  ```
- Since neither key exists in V2 data, it hardcodes to `monetisation_upfront_tail`.
- For portfolio simulations using `litigation_funding` or `comparative` structures, wrong tabs are shown.

**Fix** — Add `structure_type` to V2 JSON export OR to the `run_v2.py` post-processing:
```python
data["structure_type"] = portfolio_config.structure.type if portfolio_config else "monetisation_upfront_tail"
```

AND add fallback in `dashboardData.js`:
```js
structureType: data?.structure_type || data?.simulation_meta?.structure_type ||
  data?.simulation_meta?.portfolio_mode || 'monetisation_upfront_tail'
```

**Verification**: Portfolio sim with "Litigation Funding" structure → dashboard shows correct tabs.

---

## 🟠 HIGH BUGS

### H1: PortfolioResults Missing `apiBase` in Dashboard Iframe URL

**File**: `app/src/pages/PortfolioResults.jsx` (lines 147, 157)

**What Happens**:
- Iframe src: `/dashboard/?runId=<uuid>` — no `apiBase` param.
- In dev mode (dashboard on :5173, API on :3001), the dashboard iframe fetches `/api/results/...` against its own port (5173), which doesn't serve the API.
- In production (behind Nginx), this works because relative URLs are same-origin.

**Why**: The AI agent copied ClaimResults (which has apiBase) but missed adding it to PortfolioResults.

**Fix**:
```jsx
// Both the <a> link and the <iframe> src:
src={`/dashboard/?runId=${encodeURIComponent(effectiveRunId)}&apiBase=${encodeURIComponent(window.location.origin)}`}
```

**Impact**: Broken in development mode. Works (fragile) in production.

---

### H2: Interest Rate Normalization Logic is Ambiguous

**File**: `server/routes/simulate.js` (lines 72-82)

**Code**:
```js
if (claim.interest.rate != null && claim.interest.rate > 1) {
  claim.interest.rate = claim.interest.rate / 100;
}
```

**Problem**: A rate of exactly `1.0` (100%) or between 0-1 is assumed to already be a decimal fraction. But user could input "1" meaning 1%. This creates ambiguity for rates near the boundary.

**Fix**: Use a consistent convention — since the UI defaults store rates as percentages (e.g., 9 = 9%), always normalize by dividing by 100 when > 1:
```js
// This is already correct for the current use case (Indian arbitration rates 6-18%).
// Document the convention clearly and add a comment.
```

---

### H3: dashboardData.js API URL Has Extra Mode Prefix

**File**: `dashboard/src/data/dashboardData.js` (line ~153)

**Code**:
```js
const dashUrl = `${apiBase}/api/results/${runId}/${mode}/dashboard_data.json`;
```

**Problem**: Adds `/${mode}/` (e.g., `/all/`) to the URL. Server has specific routes for `dashboard_data.json` that don't include a mode segment. Falls back to the wildcard `/:runId/*` route which strips the prefix.

**Impact**: Works due to the fallback, but fragile. The stochastic and surface fetch paths also have this prefix and rely on the same fallback.

**Fix**: For simulation context (single run), don't add mode prefix:
```js
const dashUrl = `${apiBase}/api/results/${runId}/dashboard_data.json`;
```

---

### H4: V2 Pipeline Missing `mc_distributions` Data

**File**: `engine/v2_core/v2_json_exporter.py`

**Problem**: The DistributionExplorer component reads `data.mc_distributions` which contains per-path MOIC/XIRR/NPV arrays for histogram rendering. V2 JSON doesn't include this.

**Impact**: DistributionExplorer shows "No data available" or renders empty.

**Fix**: Build `mc_distributions` from the simulation results in `run_v2.py`'s post-processing step.

---

## 🟡 MEDIUM BUGS

### M1: No Subprocess Timeout in simulationRunner.js

**File**: `server/services/simulationRunner.js`

**Problem**: Python process could run forever (infinite loop, memory leak).

**Fix**: Add `timeout` option to `child_process.spawn` or use `setTimeout` to kill after 10 minutes.

---

### M2: Expected Quantum Fallback Misleading for Zero-Win Claims

**File**: `engine/v2_core/v2_json_exporter.py`, `engine/analysis/investment_grid.py`

**Problem**: When a claim has 0% win rate, expected quantum falls back to `SOC × 0.72` instead of 0.

**Fix**: Return 0.0 for expected quantum when win_rate ≈ 0.

---

### M3: Portfolio MOIC Silently Skips Missing Claim Path Results

**File**: `engine/analysis/investment_grid.py` (line ~145)

**Problem**: `if path_i >= len(results): continue` silently skips missing data.

**Fix**: Add a warning or raise an error when `all_path_results` is missing a claim.

---

### M4: ClaimStore Auto-Stales on Non-Calculation Changes

**File**: `app/src/store/claimStore.js`

**Problem**: Any edit to a claim (even name changes) marks the claim as "stale" (needs re-simulation).

**Fix**: Only mark stale when changing calculation-relevant fields (SOC, jurisdiction, quantum, timeline, costs, interest, probabilities).

---

## Fix Execution Plan

### Phase 1: Unblock Portfolio Simulation (C1 + C4)
> **Priority**: IMMEDIATE — users cannot run portfolio simulations at all

| Step | File | Change |
|------|------|--------|
| 1.1 | `app/src/hooks/usePortfolio.js` | Fix `buildConfig()`: `start` → `min`, `stop` → `max` |
| 1.2 | `engine/v2_core/v2_json_exporter.py` | Add `structure_type` to `data` dict |
| 1.3 | Test: submit portfolio simulation | Verify Python doesn't crash |

### Phase 2: Fix Dashboard Data (C2 + C3 + H3 + H4)
> **Priority**: HIGH — even if simulation runs, dashboard shows zeros

| Step | File | Change |
|------|------|--------|
| 2.1 | `dashboard/src/data/dashboardData.js` | Add `normalizeV2GridFormat()` to convert `investment_grid_soc` list → `investment_grid` dict |
| 2.2 | `dashboard/src/data/dashboardData.js` | Remove `/${mode}/` prefix from simulation API URLs |
| 2.3 | `engine/run_v2.py` | Add post-processing: build `risk` section from V2 sim results |
| 2.4 | `engine/run_v2.py` | Add post-processing: build `mc_distributions` from V2 sim data |
| 2.5 | Test: run simulation → open dashboard | Verify KPIs show real MOIC/IRR values |

### Phase 3: Fix Development Mode (H1 + H2)
> **Priority**: HIGH — dev workflow broken

| Step | File | Change |
|------|------|--------|
| 3.1 | `app/src/pages/PortfolioResults.jsx` | Add `apiBase` to iframe src and link href |
| 3.2 | `server/routes/simulate.js` | Add comment documenting rate convention; no logic change needed |
| 3.3 | Test: run `npm run dev` → submit portfolio → check results page | Verify dashboard loads in iframe |

### Phase 4: Robustness & Safety (M1-M4)
> **Priority**: MEDIUM — improve reliability

| Step | File | Change |
|------|------|--------|
| 4.1 | `server/services/simulationRunner.js` | Add 10-minute timeout on Python subprocess |
| 4.2 | `engine/analysis/investment_grid.py` | Add warning log for missing claim path results |
| 4.3 | `engine/v2_core/v2_json_exporter.py` | Fix expected quantum fallback: 0.0 when win_rate < 0.01 |
| 4.4 | `app/src/store/claimStore.js` | Only auto-stale on calculation-relevant field changes |

### Phase 5: End-to-End Verification
> **Priority**: Required after all fixes

| Test | Expected Result |
|------|----------------|
| Create a single claim → Run simulation | Completes; dashboard shows correct MOIC, IRR, P(Loss) |
| Create portfolio (2+ claims) → Upfront+Tail → Run | Completes; dashboard shows investment grid heatmap |
| Create portfolio → Litigation Funding → Run | Completes; dashboard shows waterfall tab |
| Check dev mode (all 3 ports) | All pages load; iframe renders dashboard |
| Push to production | CI/CD passes; `http://178.104.35.208` serves updated code |

---

## Files Modified (Summary)

| File | Phase | Changes |
|------|-------|---------|
| `app/src/hooks/usePortfolio.js` | 1 | Fix `start`/`stop` → `min`/`max` in buildConfig |
| `app/src/pages/PortfolioResults.jsx` | 3 | Add `apiBase` to iframe URL |
| `dashboard/src/data/dashboardData.js` | 2 | V2 grid normalization + API URL fix |
| `engine/v2_core/v2_json_exporter.py` | 1,2,4 | Add `structure_type`, fix quantum fallback |
| `engine/run_v2.py` | 2 | Post-process JSON: add `risk`, `mc_distributions`, `investment_grid` |
| `server/services/simulationRunner.js` | 4 | Add subprocess timeout |
| `engine/analysis/investment_grid.py` | 4 | Add missing claim warning |
| `app/src/store/claimStore.js` | 4 | Selective auto-stale |
