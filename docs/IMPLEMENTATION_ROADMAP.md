# Implementation Roadmap — Claim Analytics Platform Remediation

> **Last Updated**: Phase prompts complete for all 6 phases  
> **Total Sessions**: 24 independent Opus agent sessions  
> **Status**: Phase 1 COMPLETE (686 tests) → Phases 2–6 ready for execution

---

## Executive Summary

This roadmap guides the transformation of the claim-analytics-platform from a working prototype with 8 documented bugs and architectural debt into a production-grade Monte Carlo valuation engine for litigation finance.

### Scope
- **8 bugs fixed** (SETTLE-001 through SETTLE-005, TREE-001 through TREE-003)
- **Engine unification** (dual architecture → single canonical engine)
- **Frontend hardening** (TypeScript types, API validation, localStorage migration)
- **New feature** (re-simulation lifecycle with claim history and comparison UI)

---

## Phase Summary

| Phase | Focus | Sessions | Status | Dependencies |
|-------|-------|----------|--------|--------------|
| **1** | Safety Net (regression tests) | 5 (1A–1E) | ✅ COMPLETE — 686 tests, 0 failures | None |
| **2** | Settlement Bugs 1–4 | 3 (2A–2C) | 📋 READY | Phase 1 |
| **3** | Settlement Math + Known Outcomes | 4 (3A–3D) | 📋 READY | Phase 2 |
| **4** | Engine Convergence + Tree Bugs | 5 (4A–4E) | 📋 READY | Phase 3 |
| **5** | Frontend Hardening | 4 (5A–5D) | 📋 READY | Phase 4 |
| **6** | Re-simulation Lifecycle | 4 (6A–6D) | 📋 READY | Phase 5 |

---

## Dependency Graph

```
Phase 1 (Tests) ──→ Phase 2 (Settlement Bugs) ──→ Phase 3 (Settlement Math)
                                                          │
                                                          ▼
                                                   Phase 4 (Engine Convergence)
                                                          │
                                                          ▼
                                                   Phase 5 (Frontend Hardening)
                                                          │
                                                          ▼
                                                   Phase 6 (Re-simulation)
```

Phases are strictly sequential. Each phase's integration session (final session) must pass before the next phase begins.

---

## Phase 1 — Safety Net (COMPLETE)

**Prompt File**: `docs/PHASE_1_PROMPTS.md`  
**Testing Log**: `docs/PHASE_1_TESTING_LOG.md`  
**Bugs Found**: `docs/PHASE_1_KNOWN_BUGS.md`

| Session | Tests | Description |
|---------|-------|-------------|
| 1A | 63 | Settlement math: ramp, continuation values, NBS, hazard, amounts |
| 1B | 195 | MC regression snapshots: win rates, outcomes, quantum, duration, cashflow |
| 1C | 95 | Probability tree: analytical probs, MC convergence, structural invariants |
| 1D | 65 | Financial: cashflow identity, XIRR, MOIC, legal costs, interest |
| 1E | 76 | JSON schema (47) + E2E pipeline (29) |
| **Total** | **686** | **All passing, 0 failures** |

### Bugs Cataloged

| Bug ID | Description | Severity | Fix Phase |
|--------|-------------|----------|-----------|
| SETTLE-001 | Hardcoded `post_challenge_survival = 0.50` | High | 2 |
| SETTLE-002 | `_survival_prob_from_paths()` counts TRUE_WIN only | Medium | 2 |
| SETTLE-003 | Uniform per-stage survival `p_win^(1/N)` | High | 3 |
| SETTLE-004 | Symmetric `V_R = V_C` (no respondent costs) | High | 3 |
| SETTLE-005 | Bargaining power α irrelevant (due to SETTLE-004) | Medium | 3 |
| TREE-001 | S.34 forcing node name mismatch | Medium | 3 |
| TREE-002 | HKIAC probability rounding ≤0.001 | Low | 4 |
| TREE-003 | SIAC fixed 12-month challenge durations | Medium | 4 |

---

## Phase 2 — Settlement Bugs 1–4

**Prompt File**: `docs/PHASE_2_PROMPTS.md`  
**Change Log**: `docs/PHASE_2_CHANGE_LOG.md` (created during execution)

| Session | Focus | Bugs Fixed |
|---------|-------|------------|
| 2A | Wire discount ramp + activate game-theoretic mode | Bug 2 (ramp dead code), Bug 3 (game-theoretic dead code) |
| 2B | Fix hardcoded survival + count RESTART paths | SETTLE-001, SETTLE-002 |
| 2C | Integration verification + baseline updates | — |

### Key Changes
- `compute_settlement_discount_ramp()` called during config patching
- `SETTLEMENT_MODE` reads from config (not hardcoded "user_specified")
- `_survival_prob_from_paths()` includes RESTART outcomes
- `post_challenge_survival` computed from actual path data

---

## Phase 3 — Settlement Math + Known Outcomes

**Prompt File**: `docs/PHASE_3_PROMPTS.md`  
**Change Log**: `docs/PHASE_3_CHANGE_LOG.md` (created during execution)

| Session | Focus | Bugs Fixed |
|---------|-------|------------|
| 3A | Replace uniform survival with actual tree transition probabilities | SETTLE-003 |
| 3B | Respondent legal cost model + asymmetric Nash Bargaining | SETTLE-004, SETTLE-005 |
| 3C | Known outcomes conditional tree traversal | TREE-001 |
| 3D | Integration verification + hand-computed NBS validation | — |

### Key Changes
- `compute_continuation_values()` uses path-specific survival at each stage
- `V_R(s) = V_C(s) + LC_R_remaining(s)` (respondent pays: expected loss + avoided legal costs)
- Nash Bargaining: `δ*_s = (α × V_C + (1-α) × V_R) / Q_ref` — α now affects pricing
- Known outcomes node matching with label mapping

---

## Phase 4 — Engine Convergence + Tree Bugs

**Prompt File**: `docs/PHASE_4_PROMPTS.md`  
**Change Log**: `docs/PHASE_4_CHANGE_LOG.md` (created during execution)

| Session | Focus | Bugs Fixed |
|---------|-------|------------|
| 4A | Replace MI global state with `SimulationParams` dataclass | — |
| 4B | Eliminate monkey-patching in `adapter.py` | — |
| 4C | Replace flat path tables with generic tree walker | TREE-003 |
| 4D | Fix HKIAC rounding + deprecate old tree module | TREE-002 |
| 4E | Integration verification + architecture validation | — |

### Key Changes
- New `SimulationParams` dataclass passes all config explicitly
- `build_simulation_params(ClaimConfig)` replaces `patch_master_inputs_for_claim()`
- `save_and_restore_mi()` deprecated (no longer needed in main flow)
- Generic `simulate_challenge_tree()` replaces all flat path lookups
- Tree probability normalization at Pydantic validation layer

---

## Phase 5 — Frontend Hardening

**Prompt File**: `docs/PHASE_5_PROMPTS.md`  
**Change Log**: `docs/PHASE_5_CHANGE_LOG.md` (created during execution)

| Session | Focus |
|---------|-------|
| 5A | Generate TypeScript types from Pydantic schemas (`shared/types/`) |
| 5B | API contract validation middleware (AJV schemas in Express) |
| 5C | localStorage versioning + dashboard data validation |
| 5D | Integration verification + full-stack smoke test |

### Key Changes
- `shared/types/` — TypeScript interfaces for claims, simulation, results, API
- `server/middleware/validate.js` — AJV request validation on mutation endpoints
- `app/src/utils/storage.js` — Versioned localStorage with migration system
- Dashboard validates loaded JSON before rendering

---

## Phase 6 — Re-simulation Lifecycle

**Prompt File**: `docs/PHASE_6_PROMPTS.md`  
**Change Log**: `docs/PHASE_6_CHANGE_LOG.md` (created during execution)

| Session | Focus |
|---------|-------|
| 6A | Claim history model + PostgreSQL migration + snapshot storage |
| 6B | Re-simulation endpoint + automatic snapshots |
| 6C | Comparison UI + claim history timeline (frontend) |
| 6D | Full E2E integration test + final documentation |

### Key Changes
- `claim_snapshots` table — versioned claim config + known outcomes history
- `comparison_runs` table — links two runs for delta analysis
- `POST /api/simulate/re-run` — Re-simulate with known outcomes and parameter overrides
- Dashboard comparison tab — side-by-side metrics, overlaid distributions
- Claim history timeline — version navigation in app

---

## Execution Guide

### How to Run Each Session

1. Open a fresh Opus 4.5/4.6 agent session (192K token context)
2. Copy the session prompt from the appropriate `PHASE_N_PROMPTS.md` file
3. The agent reads context files, implements changes, runs tests
4. Agent creates/updates the phase change log
5. Verify tests pass before proceeding to next session

### Session Ordering Rules

- **Within a phase**: Sessions must run in order (A→B→C→D→E)
- **Across phases**: Final session (integration) must pass before next phase starts
- **Rollback**: If a session fails tests, fix within that session before proceeding

### Cross-Session Communication

Sessions communicate via documentation files:
- `AGENT_CONTEXT_GUIDE.md` — Overall architecture (updated by integration sessions)
- `docs/PHASE_N_CHANGE_LOG.md` — What changed in each session
- `docs/PHASE_1_KNOWN_BUGS.md` — Bug status tracking (updated as bugs are fixed)
- Test files — Regression baselines encode expected behavior

### Environment

- **Python**: Use venv at `..\.venv\Scripts\python.exe` (bare `python` may not work on Windows)
- **Node.js**: Express server, Vite dev servers
- **PostgreSQL**: Required for server (Phase 6 adds new tables)
- **Tests**: `python -m pytest engine/tests/ -v --tb=short -m "not slow"`

---

## Architecture: Before vs After

### Before (Phase 1)
```
ClaimConfig (Pydantic) 
  → adapter.py monkey-patches MI module
    → v2_monte_carlo reads MI.* globals
      → v2_probability_tree (hardcoded flat paths)
        → Results
```

### After (Phase 6)
```
ClaimConfig (Pydantic)
  → build_simulation_params() → SimulationParams dataclass
    → run_simulation(params) — no global state
      → simulate_challenge_tree(tree, rng) — generic walker
        → Results
          → TypeScript-typed API → Validated dashboard
            → Claim history + re-simulation lifecycle
```

---

## Risk Register

| Risk | Mitigation |
|------|------------|
| RNG ordering changes in Phase 4C (tree walker) | Update regression baselines with analytical justification |
| Settlement amounts change significantly (Phase 3B) | Hand-compute expected NBS values, verify analytically |
| Frontend breaks from engine output format changes | Phase 5 dashboard validation catches mismatches early |
| PostgreSQL migration issues (Phase 6A) | Test migration on dev database first |
| Session exceeds 192K token context | Prompts designed to be self-contained; read only needed files |

---

## Post-Phase 6 Considerations

These items are out of scope for the 6-phase plan but noted for future work:

1. **HKIAC Jurisdiction Support** — Full tree templates for Hong Kong International Arbitration Centre
2. **Multi-currency Portfolio** — Mixed INR/SGD/HKD portfolios with FX risk
3. **Monte Carlo Convergence Diagnostics** — Auto-detect required N for target confidence interval
4. **Bayesian Parameter Updates** — Use known outcomes to update prior probabilities (not just truncate tree)
5. **Real-time Collaboration** — WebSocket-based multi-user claim editing
6. **Audit Trail** — Full logging of who changed what and when (regulatory compliance)
