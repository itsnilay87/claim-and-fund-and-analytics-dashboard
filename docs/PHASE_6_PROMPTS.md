# Phase 6 — Re-simulation Lifecycle + Claim History + Comparison UI

> **Purpose**: Add the ability to re-run simulations with updated parameters (known outcomes, revised probabilities), store claim snapshots over time, and compare results across simulation runs in the dashboard.
>
> **Prerequisites**: Phase 5 complete (TypeScript types, API validation, unified engine, all settlement bugs fixed).
>
> **Business Value**: This is the core workflow for litigation finance professionals — as arbitration proceedings advance and outcomes become known, the platform re-simulates the remaining uncertain stages while tracking how the investment thesis evolves.

---

## Session Architecture

Phase 6 has **4 sessions** (6A–6D).

### Cross-Session Context

Every session reads:
1. `AGENT_CONTEXT_GUIDE.md`
2. `docs/PHASE_5_CHANGE_LOG.md` — Phase 5 changes
3. `docs/PHASE_6_CHANGE_LOG.md` — Running log (created by Session 6A)

---

## Session 6A — Claim History Model + Snapshot Storage

### Prompt

```
You are a senior full-stack engineer implementing Phase 6, Session 6A of a 6-phase platform remediation plan for a litigation finance analytics platform.

## YOUR TASK

Design and implement the claim history model — the ability to store snapshots of claim parameters and simulation results over time, enabling re-simulation and comparison.

## CONTEXT — READ THESE FILES FIRST

1. `AGENT_CONTEXT_GUIDE.md`
2. `engine/config/schema.py` — ClaimConfig, KnownOutcomes, SimulationConfig
3. `server/db/models/SimulationRun.js` — Existing run model
4. `server/db/pool.js` — PostgreSQL connection
5. `server/db/migrate.js` — Migration system
6. `shared/types/claim.ts` — TypeScript claim types
7. `shared/types/results.ts` — Dashboard data types

## DESIGN

### Database Schema

Create a new migration: `server/db/migrations/004_claim_history.sql`

```sql
-- Claim history tracks each distinct configuration of a claim
CREATE TABLE claim_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    claim_id UUID NOT NULL,              -- FK to claims table
    workspace_id UUID NOT NULL,          -- FK to workspaces table
    version INTEGER NOT NULL DEFAULT 1,  -- Auto-increment per claim_id
    
    -- Snapshot of claim configuration at this point in time
    config_snapshot JSONB NOT NULL,      -- Full ClaimConfig serialized
    known_outcomes JSONB,                -- KnownOutcomes at this version
    
    -- What changed
    change_description TEXT,             -- Human-readable: "S.34 dismissed, updated to known outcome"
    change_type VARCHAR(50),             -- "initial", "known_outcome", "parameter_update", "re_simulation"
    
    -- Linked simulation run (if any)
    simulation_run_id UUID,             -- FK to simulation_runs table
    
    -- Metadata
    created_at TIMESTAMP DEFAULT NOW(),
    created_by UUID,                    -- FK to users table
    
    UNIQUE(claim_id, version)
);

-- Index for fast version lookups per claim
CREATE INDEX idx_claim_snapshots_claim_id ON claim_snapshots(claim_id, version DESC);

-- Comparison runs link two simulation runs for diff analysis
CREATE TABLE comparison_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL,
    
    -- The two runs being compared
    baseline_run_id UUID NOT NULL,      -- FK to simulation_runs
    comparison_run_id UUID NOT NULL,    -- FK to simulation_runs
    
    -- Comparison metadata
    comparison_data JSONB,              -- Cached diff results
    created_at TIMESTAMP DEFAULT NOW(),
    created_by UUID
);
```

### Server Model: `server/db/models/ClaimSnapshot.js`

```javascript
class ClaimSnapshot {
  static async create(claimId, workspaceId, config, knownOutcomes, changeDescription, changeType, userId) {
    // Auto-increment version for this claim
    const { rows: [{ max_version }] } = await pool.query(
      'SELECT COALESCE(MAX(version), 0) as max_version FROM claim_snapshots WHERE claim_id = $1',
      [claimId]
    );
    
    const version = max_version + 1;
    const { rows: [snapshot] } = await pool.query(
      `INSERT INTO claim_snapshots (claim_id, workspace_id, version, config_snapshot, known_outcomes, change_description, change_type, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [claimId, workspaceId, version, config, knownOutcomes, changeDescription, changeType, userId]
    );
    
    return snapshot;
  }
  
  static async getHistory(claimId) {
    const { rows } = await pool.query(
      'SELECT * FROM claim_snapshots WHERE claim_id = $1 ORDER BY version DESC',
      [claimId]
    );
    return rows;
  }
  
  static async getVersion(claimId, version) {
    const { rows: [snapshot] } = await pool.query(
      'SELECT * FROM claim_snapshots WHERE claim_id = $1 AND version = $2',
      [claimId, version]
    );
    return snapshot;
  }
  
  static async linkSimulationRun(snapshotId, runId) {
    await pool.query(
      'UPDATE claim_snapshots SET simulation_run_id = $1 WHERE id = $2',
      [runId, snapshotId]
    );
  }
}
```

### API Routes: `server/routes/history.js`

```javascript
// GET /api/claims/:claimId/history — List all versions
router.get('/:claimId/history', authenticateToken, async (req, res) => { ... });

// GET /api/claims/:claimId/history/:version — Get specific version
router.get('/:claimId/history/:version', authenticateToken, async (req, res) => { ... });

// POST /api/claims/:claimId/snapshot — Create new snapshot (manual save point)
router.post('/:claimId/snapshot', authenticateToken, async (req, res) => { ... });
```

### TypeScript Types

Add to `shared/types/`:

```typescript
// history.ts
export interface ClaimSnapshot {
  id: string;
  claim_id: string;
  version: number;
  config_snapshot: ClaimConfig;
  known_outcomes: KnownOutcomes | null;
  change_description: string;
  change_type: 'initial' | 'known_outcome' | 'parameter_update' | 're_simulation';
  simulation_run_id: string | null;
  created_at: string;
}

export interface ComparisonRun {
  id: string;
  baseline_run_id: string;
  comparison_run_id: string;
  comparison_data: ComparisonData;
  created_at: string;
}

export interface ComparisonData {
  claims: Record<string, ClaimComparison>;
  portfolio_delta: PortfolioDelta;
}

export interface ClaimComparison {
  claim_id: string;
  baseline: { win_rate: number; expected_quantum_cr: number; moic: number };
  comparison: { win_rate: number; expected_quantum_cr: number; moic: number };
  delta: { win_rate: number; expected_quantum_cr: number; moic: number };
}
```

## TESTS

1. Migration runs without error
2. ClaimSnapshot CRUD operations work
3. Version auto-increment is correct
4. History API returns versions in descending order

## DOCUMENTATION

Create `docs/PHASE_6_CHANGE_LOG.md` with Session 6A entry.
```

---

## Session 6B — Re-simulation Endpoint + Automatic Snapshots

### Prompt

```
You are a senior full-stack engineer implementing Phase 6, Session 6B.

## YOUR TASK

Add a re-simulation endpoint that accepts updated parameters (especially known outcomes), creates a claim snapshot, runs the simulation, and links the result to the snapshot.

## CONTEXT — READ THESE FILES FIRST

1. `AGENT_CONTEXT_GUIDE.md`
2. `docs/PHASE_6_CHANGE_LOG.md` — Session 6A
3. `server/routes/simulate.js` — Existing simulation endpoint
4. `server/services/simulationRunner.js` — Python process spawning
5. `server/db/models/ClaimSnapshot.js` — Created in 6A
6. `engine/config/schema.py` — KnownOutcomes model
7. `engine/models/probability_tree.py` — `simulate_challenge_tree_with_known_outcomes()`

## DESIGN

### Re-simulation Flow

```
Client → POST /api/simulate/re-run
  Body: {
    original_run_id: "uuid",          // Baseline run
    claim_updates: {
      "claim_1": {
        known_outcomes: { arb_outcome: "won", s34_outcome: "admitted" },
        // Optional: override any other claim parameter
        arb_win_probability: 0.65   
      }
    },
    n: 1000,
    seed: 42
  }
  
Server:
  1. Load original run config from disk/DB
  2. For each updated claim:
     a. Create ClaimSnapshot (change_type: "re_simulation")
     b. Merge known_outcomes into claim config
     c. Merge any parameter overrides
  3. Write merged config to new run directory
  4. Spawn Python engine with merged config
  5. On completion, link simulation_run_id to snapshots
  6. Return { runId, status: "pending" }
```

### Route: `POST /api/simulate/re-run`

Add to `server/routes/simulate.js`:

```javascript
router.post('/re-run', authenticateToken, async (req, res) => {
  const { original_run_id, claim_updates, n, seed } = req.body;
  
  // 1. Load original config
  const originalConfig = await loadRunConfig(original_run_id);
  if (!originalConfig) return res.status(404).json({ error: 'Original run not found' });
  
  // 2. Merge claim updates
  const mergedConfig = deepClone(originalConfig);
  for (const [claimId, updates] of Object.entries(claim_updates || {})) {
    const claimIdx = mergedConfig.claims.findIndex(c => c.claim_id === claimId);
    if (claimIdx < 0) continue;
    
    // Apply known outcomes
    if (updates.known_outcomes) {
      mergedConfig.claims[claimIdx].known_outcomes = {
        ...mergedConfig.claims[claimIdx].known_outcomes,
        ...updates.known_outcomes,
      };
    }
    
    // Apply parameter overrides (whitelisted fields only)
    const ALLOWED_OVERRIDES = ['arb_win_probability', 'soc_value_cr', 'quantum_bands'];
    for (const field of ALLOWED_OVERRIDES) {
      if (updates[field] !== undefined) {
        mergedConfig.claims[claimIdx][field] = updates[field];
      }
    }
    
    // Create snapshot
    await ClaimSnapshot.create(
      claimId,
      req.user.workspaceId,
      mergedConfig.claims[claimIdx],
      updates.known_outcomes,
      `Re-simulation from run ${original_run_id}`,
      're_simulation',
      req.user.id
    );
  }
  
  // 3. Spawn simulation
  mergedConfig.n = n || originalConfig.n;
  mergedConfig.seed = seed;
  const runId = await simulationRunner.launch(mergedConfig, req.user.id);
  
  res.json({ runId, status: 'pending', baseline_run_id: original_run_id });
});
```

### Validation

Use Phase 5B's validate middleware. Add schema for re-run request:
- `original_run_id` required, must be UUID
- `claim_updates` optional object, keys are claim IDs
- Known outcomes must match `KnownOutcomes` schema
- Parameter overrides must be in whitelist

### Auto-snapshot on First Simulation

When a claim is first simulated (via `/api/simulate/claim` or `/api/simulate/portfolio`), automatically create a version=1 snapshot with `change_type="initial"`.

## TESTS

1. Re-run with known outcomes creates snapshot and launches simulation
2. Invalid original_run_id returns 404
3. Unauthorized claim updates rejected
4. Auto-snapshot on first simulation creates version 1
5. Re-run preserves original config for unchanged claims

## DOCUMENTATION

Append Session 6B to `docs/PHASE_6_CHANGE_LOG.md`.
```

---

## Session 6C — Comparison UI + History Timeline (Frontend)

### Prompt

```
You are a senior frontend engineer implementing Phase 6, Session 6C.

## YOUR TASK

Add a comparison view to the dashboard and a claim history timeline to the app. Users should be able to see how simulation results changed across re-runs, and navigate a claim's version history.

## CONTEXT — READ THESE FILES FIRST

1. `AGENT_CONTEXT_GUIDE.md`
2. `docs/PHASE_6_CHANGE_LOG.md` — Sessions 6A-6B
3. `dashboard/src/App.jsx` — Tab structure
4. `dashboard/src/components/ComparativeView.jsx` — Existing comparison (if any)
5. `app/src/pages/ClaimResults.jsx` — Current results viewing
6. `app/src/store/claimStore.js` — Claim state management
7. `shared/types/history.ts` — Snapshot/comparison types

## DESIGN

### Dashboard: Comparison Tab

Add a new tab to the dashboard: **"Version Comparison"**

This tab is shown when the URL includes a `baseline` and `comparison` run ID (e.g., `/dashboard?baseline=abc&comparison=def`).

**Layout:**

```
┌──────────────────────────────────────────────┐
│ Version Comparison: Run #3 vs Run #5         │
├──────────────────────────────────────────────┤
│ ┌─────────────┐  ┌─────────────┐            │
│ │ Baseline     │  │ Updated     │  Delta     │
│ │ Win Rate: 74%│  │ Win Rate: 82%│  +8%      │
│ │ E[Q]: ₹450Cr│  │ E[Q]: ₹510Cr│  +₹60Cr   │
│ │ MOIC: 2.3x  │  │ MOIC: 2.8x  │  +0.5x    │
│ └─────────────┘  └─────────────┘            │
│                                              │
│ Per-Claim Breakdown:                         │
│ ┌────────────────────────────────────────┐   │
│ │ Claim 1: S.34 admitted → known outcome │   │
│ │ Win Rate: 65% → 82% (+17%)            │   │
│ │ [Chart: overlaid distributions]        │   │
│ └────────────────────────────────────────┘   │
│ ...                                          │
└──────────────────────────────────────────────┘
```

**Components to create:**

1. `dashboard/src/components/comparison/ComparisonView.jsx` — Main comparison layout
2. `dashboard/src/components/comparison/MetricDelta.jsx` — Side-by-side metric with delta
3. `dashboard/src/components/comparison/DistributionOverlay.jsx` — Overlaid histograms (D3)
4. `dashboard/src/components/comparison/ClaimDiffCard.jsx` — Per-claim delta summary

**Data loading:**
```javascript
// Load both runs' dashboard_data.json
const baselineData = await fetch(`/api/results/${baselineRunId}/dashboard_data.json`);
const comparisonData = await fetch(`/api/results/${comparisonRunId}/dashboard_data.json`);
```

### App: Claim History Timeline

Add a timeline component to `ClaimResults.jsx`:

```
┌──────────────────────────────────────────┐
│ Claim History                             │
│                                           │
│ ● v3 — 2025-06-20 — S.34 admitted       │
│ │  Win Rate: 82%, MOIC: 2.8x            │
│ │  [View Results] [Compare with v2]       │
│ │                                         │
│ ● v2 — 2025-04-15 — Parameter update     │
│ │  Win Rate: 74%, MOIC: 2.3x            │
│ │  [View Results] [Compare with v1]       │
│ │                                         │
│ ● v1 — 2025-01-10 — Initial simulation   │
│   Win Rate: 68%, MOIC: 1.9x             │
│   [View Results]                          │
└──────────────────────────────────────────┘
```

**Components to create:**

1. `app/src/components/claim/ClaimHistory.jsx` — Timeline component
2. `app/src/components/claim/HistoryEntry.jsx` — Single version entry

**Data fetching:** Add to `claimStore.js`:
```javascript
fetchClaimHistory: async (claimId) => {
  const data = await api.get(`/api/claims/${claimId}/history`);
  set({ claimHistory: data });
}
```

### Re-simulation Trigger

Add "Re-simulate with Updates" button to `ClaimResults.jsx`:
- Opens a modal with known outcomes form + parameter overrides
- Submits to `POST /api/simulate/re-run`
- Redirects to polling/results page

## TESTS

Frontend smoke tests (manual checklist):
1. Comparison tab renders with two runs
2. Delta values are correct (comparison - baseline)
3. History timeline shows versions in order
4. "Compare" button opens comparison view
5. Re-simulate modal submits correctly

## DOCUMENTATION

Append Session 6C to `docs/PHASE_6_CHANGE_LOG.md`.
```

---

## Session 6D — Phase 6 Integration Verification & Documentation

### Prompt

```
You are a senior full-stack engineer completing Phase 6 — the FINAL phase of the platform remediation plan.

## YOUR TASK

Full end-to-end integration test of the re-simulation lifecycle, final documentation, and production readiness verification.

## CONTEXT — READ THESE FILES FIRST

1. `AGENT_CONTEXT_GUIDE.md`
2. `docs/PHASE_6_CHANGE_LOG.md` — All sessions
3. `docs/IMPLEMENTATION_ROADMAP.md` — Master roadmap

## TASKS

### 1. Database Migration Test
- Run all migrations: `node server/db/migrate.js`
- Verify claim_snapshots and comparison_runs tables exist
- Insert test data, verify constraints

### 2. Re-simulation E2E Test
Execute the full re-simulation workflow:
1. Start server: `node server/server.js`
2. Create a claim via API
3. Run initial simulation → verify snapshot v1 created
4. Update claim with known outcome (S.34 admitted)
5. Re-simulate → verify snapshot v2 created
6. Compare run results → verify delta computation
7. Load dashboard comparison view → verify renders

### 3. Python Engine Test Suite
- `python -m pytest engine/tests/ -v --tb=short` — ALL tests pass
- Run E2E pipeline with known outcomes:
  ```
  python -m engine.run_v2 --config engine/tests/test_tata_portfolio.json --output-dir test_outputs/phase6_verify --n 500 --seed 42
  ```

### 4. Production Checklist
Verify all these are in place:
- [ ] All 8 bugs from PHASE_1_KNOWN_BUGS.md marked FIXED
- [ ] No MI monkey-patching in main simulation flow
- [ ] API request validation on all mutation endpoints
- [ ] TypeScript types compile cleanly
- [ ] localStorage version migration works
- [ ] Dashboard validates data before rendering
- [ ] Re-simulation creates snapshots
- [ ] Comparison view renders correctly
- [ ] Docker build succeeds (if Dockerfile exists)
- [ ] No hardcoded development URLs in production code

### 5. Final Documentation

Update all documentation to reflect the completed platform:

1. `AGENT_CONTEXT_GUIDE.md` — Full architecture description (final state)
2. `docs/IMPLEMENTATION_ROADMAP.md` — Mark all phases COMPLETE
3. `README.md` — Update with:
   - Current architecture
   - How to run tests
   - How to deploy
   - API documentation summary
4. `DEVELOPER_GUIDE.md` — Update with:
   - New shared types
   - Re-simulation workflow
   - Claim history model
5. `docs/PHASE_6_CHANGE_LOG.md` — Final summary

### 6. Test Coverage Summary

Create `docs/TEST_COVERAGE_SUMMARY.md`:
- List all test files with test counts
- Note which modules have coverage
- Identify any gaps for future work

## VERIFICATION

ALL tests pass. Full re-simulation lifecycle works. Documentation is complete.
This is the final session of the 6-phase plan.
```

---

## Files Modified/Created by Phase 6

| Session | Files Modified | Files Created |
|---------|---------------|---------------|
| 6A | `server/db/migrate.js` | `server/db/migrations/004_claim_history.sql`, `server/db/models/ClaimSnapshot.js`, `server/routes/history.js`, `shared/types/history.ts` |
| 6B | `server/routes/simulate.js` | — |
| 6C | `dashboard/src/App.jsx`, `app/src/pages/ClaimResults.jsx`, `app/src/store/claimStore.js` | `dashboard/src/components/comparison/ComparisonView.jsx`, `MetricDelta.jsx`, `DistributionOverlay.jsx`, `ClaimDiffCard.jsx`, `app/src/components/claim/ClaimHistory.jsx`, `HistoryEntry.jsx` |
| 6D | `AGENT_CONTEXT_GUIDE.md`, `README.md`, `DEVELOPER_GUIDE.md`, `docs/IMPLEMENTATION_ROADMAP.md` | `docs/TEST_COVERAGE_SUMMARY.md` |
