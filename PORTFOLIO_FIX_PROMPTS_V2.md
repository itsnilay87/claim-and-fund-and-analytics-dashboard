# Portfolio Analytics Fix Prompts — V2 (Root-Cause Targeted)

> **Context**: The fixes from V1 prompts were committed and deployed but two issues persist:
> 1. **E[IRR] Heatmap** still shows deeply negative values (e.g. −18% at 10/20)
> 2. **Per-Claim Analysis tab** still shows UUIDs instead of human-readable names
>
> **Root cause diagnosis** (completed in this session):
> - The `expected_xirr` field is **`null` in the output JSON** — the frontend falls back to `mean_xirr` (arithmetic average of per-path XIRRs where ~51% are −100%, producing deeply negative values even when E[MOIC] > 1x).
> - The `_pct()` helper in `v2_json_exporter.py` will **crash on `None`** (`float(None)` → TypeError), and the export is wrapped in a try/except that **silently catches** the failure.
> - The `PerClaimAnalysis.jsx` component (in `dashboard/src/components/v2/`) was **never updated** — plus 5 other v2 components still display raw `claim_id` UUIDs.
>
> Each prompt below is **self-contained** and can be run in an independent Opus session within a 192K-token context window.

---

## Prompt 1 — Engine: Bulletproof `expected_xirr` Serialization

```
You are a senior quant finance engineer working on a litigation-finance portfolio analytics platform. The codebase is at claim-analytics-platform/.

PROBLEM:
The E[IRR] heatmap on the dashboard shows deeply negative IRR values (e.g. -18% at 10%/20%) even when E[MOIC] is 2-3x. This happens because:
1. The output JSON has `"expected_xirr": null` for every grid cell.
2. The frontend does `cell.expected_xirr ?? cell.mean_xirr` — so null falls back to `mean_xirr`, which is the arithmetic average of per-path XIRRs. With ~51% of paths being total losses (XIRR = -100%), this mean is deeply negative even when the expected cashflow produces a strongly positive IRR.
3. The `_pct()` helper function at `engine/v2_core/v2_json_exporter.py` does `round(float(v), 6)` — if `v` is `None`, `float(None)` raises TypeError. The export is wrapped in a try/except at `engine/run_v2.py` lines 884-905 that silently catches the failure, leaving old/stale JSON in place.

THE COMPUTATION IS CORRECT — `engine/v2_core/v2_investment_analysis.py` `_compute_grid_cell()` DOES compute `cell.expected_xirr` (always a float — the dataclass default is 0.0, `compute_xirr()` never returns None). The bug is in the SERIALIZATION LAYER.

FILES TO MODIFY (read each file thoroughly before editing):

1. **`engine/v2_core/v2_json_exporter.py`**:
   - `_pct()` (line ~45): Change to handle None defensively:
     ```python
     def _pct(v: float) -> float:
         """Round to 6 decimal places, treating None as 0."""
         if v is None:
             return 0.0
         return round(float(v), 6)
     ```
   - `_cr()` (line ~50): Same None guard:
     ```python
     def _cr(v: float) -> float:
         """Round currency to 2dp, treating None as 0."""
         if v is None:
             return 0.0
         return round(float(v), 2)
     ```
   - `_build_investment_grid()` (line ~880): Change the `expected_xirr` serialization from:
     ```python
     "expected_xirr": _pct(getattr(cell, "expected_xirr", cell.mean_xirr)),
     ```
     to:
     ```python
     "expected_xirr": _pct(cell.expected_xirr if cell.expected_xirr is not None and cell.expected_xirr != 0.0 else cell.mean_xirr),
     ```
     Rationale: `getattr(obj, attr, default)` returns `None` when `attr` EXISTS but is `None` — the default is only used when the attribute doesn't exist at all. Using explicit None/zero check ensures a valid value is always serialized.
     
     ACTUALLY — since the dataclass default is 0.0, a value of 0.0 could mean "never computed." To be truly safe:
     ```python
     _exp = cell.expected_xirr
     "expected_xirr": _pct(_exp if _exp is not None else cell.mean_xirr),
     ```
   
   - `_build_claims_section()` (line ~104): Fix the undefined variable bug:
     ```python
     # CURRENT (buggy):
     "name": getattr(c, 'name', '') or c.archetype.replace('_', ' ').title() or f"Claim {i+1}",
     # The loop is `for c in claims:` — variable `i` is NOT defined!
     
     # FIX: Change to use enumerate in the loop:
     for i, c in enumerate(claims):
     ```
     
2. **`engine/run_v2.py`**:
   - Lines 884-905: The try/except around `export_dashboard_json()` silently swallows errors. Add `import traceback` at the top, then change:
     ```python
     except Exception as exc:
         print(f"  Warning: dashboard JSON export failed: {exc}")
     ```
     to:
     ```python
     except Exception as exc:
         import traceback
         print(f"  *** ERROR: dashboard JSON export failed: {exc}")
         traceback.print_exc()
     ```
     This ensures export failures are VISIBLE, not silent.

   - Lines 421-426: The `grid_expected_xirrs` computation should also guard against 0.0 as "uncomputed":
     ```python
     grid_expected_xirrs = sorted(
         row.get("expected_xirr") or row.get("mean_xirr", 0.0)
         for row in ig_dict.values()
     )
     ```

3. **`engine/v2_core/v2_investment_analysis.py`**:
   - Verify `_compute_grid_cell()` computes `expected_xirr` correctly (it does — lines 270-284). NO CHANGES needed here. Just confirm:
     - `all_dates_set` and `path_cf_dicts` ARE initialized before the path loop (lines 196-197)
     - `compute_xirr()` is imported from `.v2_metrics` (line 24)
     - `compute_xirr()` NEVER returns None (returns -1.0 for total loss, 0.0 for single CF, float otherwise)

TESTING:
After making changes, run:
```
cd engine && python -m pytest tests/ -x -q
```
All 750+ tests should pass. If any fail, fix them.

Also create a quick sanity check:
```python
# engine/tests/test_expected_xirr_serialization.py
"""Verify expected_xirr is never None in serialized grid."""
from engine.v2_core.v2_json_exporter import _pct, _cr

def test_pct_handles_none():
    assert _pct(None) == 0.0
    assert _pct(0.0) == 0.0
    assert _pct(0.1234567) == 0.123457

def test_cr_handles_none():
    assert _cr(None) == 0.0
    assert _cr(1.234) == 1.23
```

IMPORTANT: Do NOT modify the expected_xirr computation logic in v2_investment_analysis.py. The computation is correct. The bug is ONLY in serialization (None handling) and silent error swallowing.
```

---

## Prompt 2 — Dashboard: Replace ALL UUID Displays with Human-Readable Claim Names

```
You are a senior frontend engineer working on a litigation-finance analytics dashboard. The codebase is at claim-analytics-platform/.

PROBLEM:
Multiple dashboard components show raw UUID claim_id values (e.g. "a1b2c3d4-e5f6-...") as button labels, section titles, and chart names instead of human-readable claim names. The `getClaimDisplayName()` utility at `dashboard/src/utils/claimNames.js` already exists and works correctly — it just hasn't been imported/used in these components.

The JSON data DOES include a `name` field in each claim object (e.g. "Arb Case 113/2023 — Tender 2019 PMS Claims"). The utility uses this with proper fallback chain.

COMPONENTS TO FIX (7 files, all in `dashboard/src/components/v2/`):

### 1. `PerClaimAnalysis.jsx` — THE MOST VISIBLE ISSUE
Add import at top:
```js
import { getClaimDisplayName } from '../../utils/claimNames';
```

Fix these four display locations:
- Line ~71: `{c.claim_id}` → `{getClaimDisplayName(c)}`  (claim selector button text)
- Line ~78: `title={claim.claim_id}` → `title={getClaimDisplayName(claim)}`  (section title)
- Line ~133: `title={`${claim.claim_id} Recovery Funnel — SOC to Net`}` → `title={`${getClaimDisplayName(claim)} Recovery Funnel — SOC to Net`}`

The `key={c.claim_id}` React keys and `onClick={() => setSelectedClaim(c.claim_id)}` state values MUST remain as claim_id (they're identifiers, not display text).

### 2. `ExecutiveSummary.jsx`
Add import:
```js
import { getClaimDisplayName } from '../../utils/claimNames';
```

Fix these locations:
- Line ~67: `name: c.claim_id.replace('TP-', ''),` → `name: getClaimDisplayName(c),` (chart data)
- Line ~92: `{c.claim_id}:` → `{getClaimDisplayName(c)}:` (claim label in text)
- Line ~189: `{c.claim_id}` → `{getClaimDisplayName(c)}` (claim card title)
- Line ~374: `claim: c.claim_id.replace('TP-', ''),` → `claim: getClaimDisplayName(c),` (comparison chart data)
- Line ~375: `fullName: c.claim_id,` → `fullName: getClaimDisplayName(c),` (tooltip data)

### 3. `CashflowAnalysis.jsx`
Add import:
```js
import { getClaimDisplayName } from '../../utils/claimNames';
```

Fix:
- Line ~105: `<td style={TD_LEFT}>{c.claim_id}</td>` → `<td style={TD_LEFT}>{getClaimDisplayName(c)}</td>`
- Line ~420: `name: c.claim_id,` → `name: getClaimDisplayName(c),` (chart data series name)

### 4. `CashflowWaterfall.jsx`
Add import:
```js
import { getClaimDisplayName } from '../../utils/claimNames';
```

Fix:
- Line ~365: `<td style={TD_LEFT}>{c.claim_id}</td>` → `<td style={TD_LEFT}>{getClaimDisplayName(c)}</td>`
  
### 5. `InvestmentAnalysis.jsx`
Add import:
```js
import { getClaimDisplayName } from '../../utils/claimNames';
```

Fix:
- Line ~284: `{c.claim_id}` → `{getClaimDisplayName(c)}` (table cell showing claim name)
  Note: Line ~276 uses `claims.find(cl => cl.claim_id === c.claim_id)` — this is a lookup by ID and must stay as-is. But at ~284, use the found `claimMeta` object: `{getClaimDisplayName(claimMeta || c)}`

### 6. `ProbabilitySensitivity.jsx`
Add import:
```js
import { getClaimDisplayName } from '../../utils/claimNames';
```

Fix:
- Line ~459: `{row.claim_id}` → In this case, `row` is likely a processed object. Need to check: does the `claims` array (from props) contain the full claim objects? If yes, create a lookup at the top of the component:
  ```js
  const claimNameMap = useMemo(() => {
    const map = {};
    (claims || []).forEach(c => { map[c.claim_id] = getClaimDisplayName(c); });
    return map;
  }, [claims]);
  ```
  Then use: `{claimNameMap[row.claim_id] || row.claim_id}`

IMPORTANT RULES:
1. Only change DISPLAY text — never change React `key` props, state values, or data lookups using claim_id
2. Import `getClaimDisplayName` from `'../../utils/claimNames'` (relative path from v2/ directory)
3. The utility already handles: UUID detection, name/claim_name/display_name/label fields, archetype fallback, and N/A default
4. If a component already imports and uses `getClaimDisplayName` (check ProbabilityOutcomes.jsx and SettlementAnalysis.jsx as reference examples), skip it

After changes, verify the dashboard builds:
```
cd dashboard && npm run build
```

No test files need modification — these are display-only changes.
```

---

## Prompt 3 — Integration Verification & Production Deployment

```
You are a senior DevOps engineer working on a litigation-finance analytics platform. The codebase is at claim-analytics-platform/.

After Prompts 1 and 2 have been implemented, perform the following verification and deployment steps:

### Step 1: Run All Tests
```bash
# Engine tests
cd engine && python -m pytest tests/ -x -q --tb=short

# Server tests  
cd server && npx vitest run

# Dashboard build check
cd dashboard && npm run build
```

All tests must pass. Fix any failures.

### Step 2: Verify Expected XIRR Is Non-Null
Run a quick local analysis (if a test config exists):
```bash
cd engine && python run_v2.py --config ../test_litfunding/config.json --output ../test_outputs/quick_test
```

Then verify the output:
```python
import json
d = json.load(open("test_outputs/quick_test/dashboard_data.json"))
ig = d.get("investment_grid", {})
for k in list(ig.keys())[:5]:
    cell = ig[k]
    exp = cell.get("expected_xirr")
    mean = cell.get("mean_xirr")
    moic = cell.get("mean_moic")
    print(f"{k}: expected_xirr={exp}, mean_xirr={mean}, mean_moic={moic}")
    assert exp is not None, f"expected_xirr is None for cell {k}!"
    if moic and moic > 1.0:
        print(f"  → MOIC > 1.0x so expected_xirr should be positive: {exp > 0}")
```

### Step 3: Verify Claim Names in JSON
```python
claims = d.get("claims", [])
for c in claims:
    name = c.get("name", "MISSING")
    cid = c.get("claim_id", "?")
    print(f"{cid} → {name}")
    # Verify name is not a UUID
    import re
    assert not re.match(r'^[0-9a-f]{8}-', name), f"Name is still a UUID: {name}"
```

### Step 4: Git Commit and Push
```bash
git add -A
git status
# Review changes — expect modifications to:
#   engine/v2_core/v2_json_exporter.py
#   engine/run_v2.py  
#   engine/tests/test_expected_xirr_serialization.py (new)
#   dashboard/src/components/v2/PerClaimAnalysis.jsx
#   dashboard/src/components/v2/ExecutiveSummary.jsx
#   dashboard/src/components/v2/CashflowAnalysis.jsx
#   dashboard/src/components/v2/CashflowWaterfall.jsx
#   dashboard/src/components/v2/InvestmentAnalysis.jsx
#   dashboard/src/components/v2/ProbabilitySensitivity.jsx

git commit -m "fix: bulletproof expected_xirr serialization + claim name display across all v2 components

Root cause: _pct(None) crash in v2_json_exporter silently killed export,
leaving stale JSON with null expected_xirr. Frontend fell back to mean_xirr
(arithmetic mean of per-path XIRRs = deeply negative with high P(loss)).

Engine fixes:
- _pct()/_cr(): handle None defensively (return 0.0)
- _build_investment_grid(): explicit None guard on expected_xirr
- _build_claims_section(): fix undefined 'i' variable (use enumerate)
- run_v2.py: print traceback on export failure (no more silent swallow)

Dashboard fixes:
- Import getClaimDisplayName in 6 v2/ components
- Replace all raw claim_id UUID displays with human-readable names
- Affected: PerClaimAnalysis, ExecutiveSummary, CashflowAnalysis,
  CashflowWaterfall, InvestmentAnalysis, ProbabilitySensitivity"

git push origin main
```

### Step 5: Deploy to Production
```bash
cd deploy && bash deploy.sh
```

### Step 6: Post-Deployment Verification
After deployment, trigger a new analysis run on the production server with the user's portfolio. Then verify:
1. The E[IRR] heatmap shows positive values where E[MOIC] > 1.0x
2. The Per-Claim Analysis tab shows human-readable claim names (not UUIDs)
3. The Executive Summary shows claim names in charts and cards
4. The Cashflow Analysis table shows claim names

CRITICAL: You MUST re-run the analysis engine after deployment — the old dashboard_data.json from before the fix will still have `expected_xirr: null`. Only a fresh run will produce corrected output.
```

---

## Quick Reference: Root Cause → Fix Mapping

| Symptom | Root Cause | Fix Location | Fix |
|---------|-----------|-------------|-----|
| E[IRR] heatmap shows −18% | `expected_xirr: null` in JSON → frontend falls back to `mean_xirr` | `v2_json_exporter.py` `_pct()` | Add None guard |
| Silent export failure | `_pct(None)` → TypeError caught by try/except | `run_v2.py` lines 884-905 | Print traceback |
| Claim names show UUID | `{c.claim_id}` in JSX instead of `getClaimDisplayName(c)` | 6 files in `dashboard/src/components/v2/` | Import + replace |
| `Claim {i+1}` fallback crashes | Loop is `for c in claims:` — `i` undefined | `v2_json_exporter.py` `_build_claims_section` | Use `enumerate` |


