# Phase 5 — Frontend Hardening + API Contract Enforcement

> **Purpose**: Add TypeScript types generated from Pydantic schemas, enforce API contracts via Express middleware, add localStorage versioning/migration, and harden the dashboard data pipeline.
>
> **Prerequisites**: Phase 4 complete (unified engine, explicit SimulationParams, no MI patching).
>
> **Architecture**: Three frontend targets: `app/` (Zustand workspace editor, port 5180), `dashboard/` (read-only results viewer, port 5173), `server/` (Express API, port 3001). All currently JavaScript — TypeScript migration is incremental.

---

## Session Architecture

Phase 5 has **4 sessions** (5A–5D).

### Cross-Session Context

Every session reads:
1. `AGENT_CONTEXT_GUIDE.md`
2. `docs/PHASE_4_CHANGE_LOG.md` — Engine changes affecting API shape
3. `docs/PHASE_5_CHANGE_LOG.md` — Running log (created by Session 5A)

---

## Session 5A — Generate TypeScript Types from Pydantic Schemas

### Prompt

```
You are a senior full-stack engineer implementing Phase 5, Session 5A of a 6-phase platform remediation plan.

## YOUR TASK

Generate TypeScript type definitions from the Pydantic models in `engine/config/schema.py` and the simulation output structures. These types will be the single source of truth for both frontend apps.

## CONTEXT — READ THESE FILES FIRST

1. `AGENT_CONTEXT_GUIDE.md`
2. `engine/config/schema.py` — ALL Pydantic models: ClaimConfig, ChallengeTreeConfig, TreeNode, SettlementConfig, SimulationConfig, KnownOutcomes, InterestConfig, LegalCostConfig, etc.
3. `engine/v2_core/v2_config.py` — SimulationResults, PathResult, ClaimConfig dataclasses
4. `engine/v2_core/v2_json_exporter.py` — What JSON keys are output by the engine
5. `dashboard/src/data/dashboardData.js` — What the dashboard expects in its data shape
6. `server/routes/simulate.js` — Request/response shape for simulation endpoints
7. `server/routes/results.js` — How results are served
8. `app/src/store/claimStore.js` — How claims are stored client-side
9. `app/src/services/api.js` — API client

## DESIGN

### Types Location: `shared/types/`

Create a shared types package at `claim-analytics-platform/shared/types/`:

```
shared/
├── types/
│   ├── index.ts              (Re-exports all)
│   ├── claim.ts              (ClaimConfig, TreeNode, ChallengeTreeConfig)
│   ├── simulation.ts         (SimulationRequest, SimulationStatus, SimulationConfig)
│   ├── results.ts            (DashboardData, ClaimSummary, OutcomeDistribution)
│   ├── settlement.ts         (SettlementConfig, SettlementResult)
│   ├── financial.ts          (CashflowEntry, InvestmentMetrics, PricingGrid)
│   ├── api.ts                (API response wrappers: ApiResponse<T>, PaginatedResponse<T>)
│   └── tsconfig.json         (Strict mode, declaration emit)
```

### Generation Strategy

DO NOT use automatic Pydantic-to-TS generators (they produce unreadable output). Instead:

1. **Read each Pydantic model** in `schema.py`
2. **Manually create** the corresponding TypeScript interface
3. **Add JSDoc comments** that reference the Pydantic source model name

Example mapping:

```python
# Pydantic (schema.py)
class TreeNode(BaseModel):
    name: str
    probability: float = Field(ge=0, le=1)
    children: list["TreeNode"] = []
    outcome: Optional[Literal["TRUE_WIN", "RESTART", "LOSE"]] = None
    duration_distribution: Optional[DurationDistribution] = None
```

```typescript
// TypeScript (claim.ts)
/** Maps to Pydantic: engine.config.schema.TreeNode */
export interface TreeNode {
  name: string;
  probability: number; // 0-1
  children: TreeNode[];
  outcome?: 'TRUE_WIN' | 'RESTART' | 'LOSE';
  duration_distribution?: DurationDistribution;
}
```

### Dashboard Data Types

Read `dashboard/src/data/dashboardData.js` and `engine/v2_core/v2_json_exporter.py` to understand the actual JSON shape. Create types for:

```typescript
// results.ts
export interface DashboardData {
  metadata: SimulationMetadata;
  portfolio_summary: PortfolioSummary;
  claims: Record<string, ClaimResult>;
  structure_type: StructureType;
}

export type StructureType = 
  | 'litigation_funding'
  | 'monetisation_full_purchase'
  | 'monetisation_upfront_tail'
  | 'monetisation_staged'
  | 'comparative';

export interface ClaimResult {
  claim_id: string;
  jurisdiction: string;
  win_rate: number;
  outcome_distribution: OutcomeDistribution;
  quantum_stats: QuantumStats;
  duration_stats: DurationStats;
  settlement_stats?: SettlementStats;
  cashflows: CashflowEntry[];
  pricing_grid?: PricingGridEntry[];
}
```

### API Response Types

```typescript
// api.ts
export interface ApiResponse<T> {
  data: T;
  error?: string;
}

export interface SimulationRequest {
  jurisdiction: 'indian_domestic' | 'siac_singapore' | 'hkiac_hongkong';
  claim_type: string;
  soc_value_cr: number;
  currency: 'INR' | 'SGD' | 'HKD';
  challenge_tree: ChallengeTreeConfig;
  timeline: TimelineConfig;
  legal_costs: LegalCostConfig;
  settlement?: SettlementConfig;
  n: number;
  seed?: number;
}

export interface SimulationStatusResponse {
  runId: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  progress: number; // 0-100
  error?: string;
}
```

## TESTS

Not unit tests — type validation:
1. Create `shared/types/__tests__/type_check.ts` that imports all types and creates sample objects
2. Run `npx tsc --noEmit shared/types/__tests__/type_check.ts` to verify types compile

## DOCUMENTATION

Create `docs/PHASE_5_CHANGE_LOG.md` with Session 5A entry.
Update `README.md` to reference shared types.
```

---

## Session 5B — API Contract Validation Middleware (Express Server)

### Prompt

```
You are a senior full-stack engineer implementing Phase 5, Session 5B.

## YOUR TASK

Add request/response validation middleware to the Express server using the TypeScript types as the schema source. Ensure that invalid simulation requests are rejected with clear error messages, and responses conform to expected shapes.

## CONTEXT — READ THESE FILES FIRST

1. `AGENT_CONTEXT_GUIDE.md`
2. `docs/PHASE_5_CHANGE_LOG.md` — Session 5A types
3. `shared/types/simulation.ts` — Request/response types
4. `shared/types/claim.ts` — Claim types
5. `server/server.js` — Express app setup, existing middleware
6. `server/routes/simulate.js` — Simulation route handlers
7. `server/routes/claims.js` — Claim CRUD handlers
8. `server/services/configService.js` — Existing config validation (if any)
9. `server/package.json` — Current dependencies

## DESIGN

### Use AJV (Already Installed) with JSON Schema

The server already has AJV. Convert the TypeScript types to JSON Schema for runtime validation.

### Create: `server/middleware/validate.js`

```javascript
const Ajv = require('ajv');
const ajv = new Ajv({ allErrors: true, coerceTypes: false });

// JSON Schemas derived from TypeScript types
const simulationRequestSchema = {
  type: 'object',
  required: ['jurisdiction', 'soc_value_cr', 'challenge_tree', 'n'],
  properties: {
    jurisdiction: { type: 'string', enum: ['indian_domestic', 'siac_singapore', 'hkiac_hongkong'] },
    soc_value_cr: { type: 'number', minimum: 0 },
    challenge_tree: {
      type: 'object',
      required: ['scenario_a', 'scenario_b'],
      properties: {
        scenario_a: { $ref: '#/$defs/scenarioTree' },
        scenario_b: { $ref: '#/$defs/scenarioTree' },
      }
    },
    n: { type: 'integer', minimum: 100, maximum: 100000 },
    seed: { type: 'integer' },
    settlement: { $ref: '#/$defs/settlementConfig' },
  },
  $defs: {
    scenarioTree: {
      type: 'object',
      required: ['root'],
      properties: {
        root: { $ref: '#/$defs/treeNode' }
      }
    },
    treeNode: {
      type: 'object',
      required: ['name', 'probability'],
      properties: {
        name: { type: 'string' },
        probability: { type: 'number', minimum: 0, maximum: 1 },
        children: { type: 'array', items: { $ref: '#/$defs/treeNode' } },
        outcome: { type: 'string', enum: ['TRUE_WIN', 'RESTART', 'LOSE'] },
      }
    },
    settlementConfig: {
      type: 'object',
      properties: {
        enabled: { type: 'boolean' },
        mode: { type: 'string', enum: ['user_specified', 'game_theoretic'] },
        global_hazard_rate: { type: 'number', minimum: 0, maximum: 1 },
      }
    }
  },
  additionalProperties: false,
};

function validateBody(schema) {
  const validate = ajv.compile(schema);
  return (req, res, next) => {
    if (!validate(req.body)) {
      return res.status(400).json({
        error: 'Validation failed',
        details: validate.errors.map(e => ({
          path: e.instancePath,
          message: e.message,
        })),
      });
    }
    next();
  };
}

module.exports = { validateBody, simulationRequestSchema };
```

### Wire into routes

In `server/routes/simulate.js`:
```javascript
const { validateBody, simulationRequestSchema } = require('../middleware/validate');

router.post('/claim', authenticateToken, validateBody(simulationRequestSchema), async (req, res) => {
  // ... existing handler
});
```

### Tree Probability Validation

Add a custom AJV keyword or post-validation check:
- At each tree level, children probabilities must sum to ≈1.0 (within 0.01)
- Leaf nodes must have `outcome` set
- Non-leaf nodes must have `children`

### Response Validation (Development Only)

In dev mode, add response validation middleware that warns (not blocks) when responses don't match expected schema:

```javascript
if (process.env.NODE_ENV !== 'production') {
  function validateResponse(schema) {
    return (req, res, next) => {
      const originalJson = res.json;
      res.json = function(body) {
        const valid = ajv.validate(schema, body);
        if (!valid) {
          console.warn(`Response validation warning: ${JSON.stringify(ajv.errors)}`);
        }
        return originalJson.call(this, body);
      };
      next();
    };
  }
}
```

## TESTS

Add to `server/tests/`:
- `validate.test.js`:
  - Valid simulation request passes
  - Missing required fields rejected
  - Invalid jurisdiction rejected
  - Tree probabilities not summing to 1.0 rejected
  - soc_value_cr < 0 rejected
  - n > 100000 rejected

## DOCUMENTATION

Append Session 5B to `docs/PHASE_5_CHANGE_LOG.md`.
```

---

## Session 5C — localStorage Versioning + Dashboard Type Safety

### Prompt

```
You are a senior frontend engineer implementing Phase 5, Session 5C.

## YOUR TASK

Add localStorage versioning/migration for the `app/` frontend and improve type safety in the `dashboard/` data loading pipeline.

## CONTEXT — READ THESE FILES FIRST

1. `AGENT_CONTEXT_GUIDE.md`
2. `docs/PHASE_5_CHANGE_LOG.md` — Sessions 5A-5B
3. `app/src/store/themeStore.js` — Uses `cap-theme` localStorage
4. `app/src/store/workspaceStore.js` — Uses `cap-active-workspace` localStorage
5. `app/src/store/authStore.js` — Token management
6. `dashboard/src/data/dashboardData.js` — Data loading logic
7. `dashboard/src/App.jsx` — Tab routing based on data shape
8. `shared/types/results.ts` — DashboardData types from 5A

## DESIGN

### localStorage Versioning

Create `app/src/utils/storage.js`:

```javascript
const STORAGE_VERSION = 1;
const VERSION_KEY = 'cap-storage-version';

/**
 * Storage manager with version migration.
 * When STORAGE_VERSION changes, migrations run automatically.
 */
const migrations = {
  // Version 0 → 1: Rename old keys, add defaults
  1: () => {
    // Migrate any legacy keys
    const oldTheme = localStorage.getItem('theme');
    if (oldTheme && !localStorage.getItem('cap-theme')) {
      localStorage.setItem('cap-theme', oldTheme);
      localStorage.removeItem('theme');
    }
  },
  // Future: Version 1 → 2
  // 2: () => { ... }
};

export function initStorage() {
  const currentVersion = parseInt(localStorage.getItem(VERSION_KEY) || '0');
  if (currentVersion < STORAGE_VERSION) {
    for (let v = currentVersion + 1; v <= STORAGE_VERSION; v++) {
      if (migrations[v]) {
        try {
          migrations[v]();
        } catch (e) {
          console.error(`Storage migration v${v} failed:`, e);
        }
      }
    }
    localStorage.setItem(VERSION_KEY, String(STORAGE_VERSION));
  }
}

export function getStorageItem(key, defaultValue = null) {
  try {
    const raw = localStorage.getItem(key);
    return raw !== null ? JSON.parse(raw) : defaultValue;
  } catch {
    return defaultValue;
  }
}

export function setStorageItem(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.error(`Failed to write ${key}:`, e);
  }
}
```

Wire `initStorage()` into `app/src/main.jsx` before React renders.

### Dashboard Data Validation

The dashboard reads raw JSON and renders it. If the engine output format changes (which it will after Phase 4), the dashboard silently breaks.

Add runtime validation to `dashboard/src/data/dashboardData.js`:

```javascript
/**
 * Validate that loaded data has required fields.
 * Returns { valid: boolean, errors: string[] }
 */
function validateDashboardData(data) {
  const errors = [];
  
  if (!data) errors.push('No data loaded');
  if (!data?.metadata) errors.push('Missing metadata');
  if (!data?.portfolio_summary) errors.push('Missing portfolio_summary');
  if (!data?.claims || typeof data.claims !== 'object') errors.push('Missing claims object');
  
  for (const [claimId, claim] of Object.entries(data?.claims || {})) {
    if (typeof claim.win_rate !== 'number') errors.push(`${claimId}: missing win_rate`);
    if (!claim.outcome_distribution) errors.push(`${claimId}: missing outcome_distribution`);
  }
  
  return { valid: errors.length === 0, errors };
}
```

Add error boundary in `dashboard/src/App.jsx` that shows validation errors:

```jsx
function App() {
  const { data, loading, error } = useDashboardData();
  
  if (loading) return <LoadingScreen />;
  if (error) return <ErrorScreen error={error} />;
  
  const validation = validateDashboardData(data);
  if (!validation.valid) {
    return <ErrorScreen error={`Data validation failed:\n${validation.errors.join('\n')}`} />;
  }
  
  // ... existing tab rendering
}
```

## TESTS

Minimal — mainly structural:
1. `storage.test.js`: Migration runs, version tracked, getter/setter work
2. `dashboardData.test.js`: Validator catches missing fields

## DOCUMENTATION

Append Session 5C to `docs/PHASE_5_CHANGE_LOG.md`.
```

---

## Session 5D — Phase 5 Integration Verification & Documentation

### Prompt

```
You are a senior full-stack engineer completing Phase 5.

## YOUR TASK

Integration-test all Phase 5 changes, verify the full stack works end-to-end, and update all documentation.

## CONTEXT — READ THESE FILES FIRST

1. `AGENT_CONTEXT_GUIDE.md`
2. `docs/PHASE_5_CHANGE_LOG.md` — All sessions

## TASKS

1. **TypeScript compilation**: Run `npx tsc --noEmit` on `shared/types/` — must compile cleanly
2. **Server validation tests**: Run `npx vitest run server/tests/validate.test.js`
3. **Full Python test suite**: `python -m pytest engine/tests/ -v --tb=short -m "not slow"` — verify Phase 4 changes still pass
4. **E2E flow test**:
   - Start server: `node server/server.js`
   - POST invalid simulation request → verify 400 with validation errors
   - POST valid simulation request → verify 200 with runId
   - Poll status → verify response matches type
   - GET results → verify dashboard data loads and validates
5. **Dashboard smoke test**: Start dashboard dev server, load a simulation result, verify no console errors
6. **Documentation**:
   - Finalize `docs/PHASE_5_CHANGE_LOG.md`
   - Update `AGENT_CONTEXT_GUIDE.md` with API contract section
   - Update `README.md` with `shared/types/` documentation

## VERIFICATION

All types compile. Server validates requests. Dashboard validates data. Tests pass.
```

---

## Files Modified/Created by Phase 5

| Session | Files Modified | Files Created |
|---------|---------------|---------------|
| 5A | — | `shared/types/index.ts`, `claim.ts`, `simulation.ts`, `results.ts`, `settlement.ts`, `financial.ts`, `api.ts`, `tsconfig.json` |
| 5B | `server/routes/simulate.js` | `server/middleware/validate.js`, `server/tests/validate.test.js` |
| 5C | `app/src/main.jsx`, `dashboard/src/data/dashboardData.js`, `dashboard/src/App.jsx` | `app/src/utils/storage.js` |
| 5D | `AGENT_CONTEXT_GUIDE.md`, `README.md` | — |
