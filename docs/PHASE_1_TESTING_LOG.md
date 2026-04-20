# Phase 1 — Testing Log

> **Phase**: Phase 1 — Safety Net: Regression & Mathematical Verification Tests
> **Started**: 2026-04-03
> **Purpose**: Build a comprehensive Python test suite that snapshots current engine behavior and provides mathematical verification before any engine changes in Phases 2–6.

---

## Session 1A — Test Infrastructure + Settlement Mathematics Unit Tests

**Status**: ✅ Complete
**Date**: 2026-04-03

### Files Created

| File | Purpose |
|------|---------|
| `engine/tests/conftest.py` | Shared test fixtures: `mi_context`, `default_settlement_mi`, `rng`, `tata_portfolio_config` |
| `engine/tests/test_settlement_math.py` | Settlement mathematics verification (6 test classes, 35+ tests) |

### Test Classes

| Class | Tests | Property Verified |
|-------|-------|-------------------|
| `TestDiscountRamp` | 10 | Linear interpolation δ_i = δ_min + (δ_max - δ_min) × i/(N-1) |
| `TestReferenceQuantum` | 5 | Q_ref regimes: pre-award, post-award won, post-award lost |
| `TestContinuationValues` | 6 | Backward induction: V_C(s) = per_stage_surv^(N-i) × Q_ref |
| `TestNashBargaining` | 7 | δ*_s = V_C(s)/Q_ref (symmetric model) |
| `TestHazardProcess` | 4 | Bernoulli P(settle) = λ, survival = (1-λ)^N |
| `TestSettlementAmount` | 5 | End-to-end: amount = δ × Q_ref |
| `TestPathTableInvariants` | 8 | Path table sums, outcome exclusivity, quantum band bounds |

### Known Bugs Documented

| Bug | Location | Current Behavior | Fix Phase |
|-----|----------|-----------------|-----------|
| Hardcoded survival | `v2_monte_carlo._attempt_settlement` | `post_challenge_survival = 0.50` | Phase 2 |
| Per-stage survival approximation | `v2_settlement.compute_continuation_values` | Uses `p_win^(1/N)` uniform approx | Phase 3 |
| Symmetric V_R = V_C | `v2_settlement.compute_continuation_values` | V_R = V_C (no respondent model) | Phase 3 |
| α irrelevant in NBS | `v2_settlement.compute_game_theoretic_discounts` | bargaining_power has no effect | Phase 3 |
| Scenario B P(TRUE_WIN)=0 | `v2_settlement._survival_prob_from_paths` | Only counts TRUE_WIN, not RESTART | Phase 2 |

### Coverage Notes

- **Discount ramp**: Full coverage including edge cases (N=0, N=1, overrides)
- **Q_ref computation**: All 3 regimes tested with exact analytical expectations
- **Continuation values**: Domestic, SIAC, pre-award, Scenario B tested
- **Hazard process**: Stochastic tests at 100K draws (marked `@pytest.mark.slow`)
- **Path tables**: Probability sums, outcome exclusivity, quantum band invariants

### Test Results

```
63 passed in 2.98s
0 failures, 0 errors, 0 warnings
Python 3.11.5, pytest 9.0.2
```

All 63 tests pass against the current (buggy) engine code. Tests verify actual behavior
and document known bugs with `# KNOWN BUG (Phase N fix)` comments for future remediation.

---

## Session 1B — Monte Carlo Output Snapshot & Regression Tests

**Status**: ✅ Complete
**Date**: 2026-04-03

### Files Created

| File | Purpose |
|------|---------|
| `engine/tests/test_regression_snapshot.py` | V2 MC engine regression snapshots (9 test classes, 195 tests) |

### Files Modified

| File | Change |
|------|--------|
| `engine/tests/conftest.py` | Registered `regression` pytest mark |

### Test Classes

| Class | Tests | Property Verified |
|-------|-------|-------------------|
| `TestPerClaimWinRates` | 6 | Per-claim win rate in expected ranges (domestic 0.43–0.63, SIAC 0.52–0.72) |
| `TestOutcomeDistribution` | 24 | Outcome completeness: TRUE_WIN + LOSE + SETTLED = N, no settled when disabled |
| `TestQuantumStatistics` | 24 | E[q%\|win] → 0.72 ±0.03, q% ∈ [0,1], quantum_cr = pct × SOC, LOSE → collected=0 |
| `TestDurationBounds` | 18 | total_duration ∈ [0, 97], non-negative interest, no NaN durations |
| `TestCashflowConsistency` | 30 | legal_cost = Σ(burn), non-negative costs/collected, TRUE_WIN → collected > 0, LOSE → collected = 0 |
| `TestSettlementRegression` | 42 | Settlement-enabled: paths settle, amount > 0, discount ∈ [0,1], timing > 0, collected = settlement_amount |
| `TestReproducibility` | 3 | Deterministic seed=42: domestic, SIAC, and settlement-enabled runs bit-for-bit identical |
| `TestCrossClaimInvariants` | 45 | Path count = N, sequential indices, correct claim_id, scenario A/B consistency, no NaN monetary fields |
| `TestReArbitrationPaths` | 21 | re_arb_won=True → TRUE_WIN or LOSE, re_arb_won=False → LOSE, non-negative durations, domestic has RESTART paths |

### Test Approach

- **V2 core layer**: Tests run through `engine.v2_core.v2_monte_carlo.run_simulation` with MI patching via `engine.adapter`, matching the exact pipeline of `engine/run_v2.py`.
- **Module-scoped fixtures**: Two expensive simulation runs (settlement disabled, settlement enabled) cached at module scope — executed once, shared across all 195 tests.
- **Parametrized by claim**: All per-claim tests use `@pytest.mark.parametrize` over the 6 TATA claim IDs.
- **N=2000, seed=42**: Sufficient for ±5pp confidence intervals while keeping runtime < 3s.
- **Settlement dual-mode**: Both disabled (baseline) and enabled (λ=0.15) runs verified.

### Tolerance Justification

| Metric | Tolerance | Justification |
|--------|-----------|---------------|
| Win rate | ±5pp | 95% CI for binomial at N=2000: p ± 1.96√(p(1-p)/N) ≈ ±2.2pp; widened for cross-platform FP |
| E[q%\|win] | ±0.03 | CLT: σ/√n × 1.96 ≈ 0.29/√2000 × 1.96 ≈ ±0.013; doubled for safety |
| Duration cap | +1 month | Floating-point accumulation across 5+ stages |
| Monetary identities | 1e-6 | Exact within IEEE 754 double precision |

### Test Results

```
195 passed in 2.75s
0 failures, 0 errors, 0 warnings
Python 3.11.5, pytest 9.0.2
```

All 195 tests pass against the current engine code. Tests verify actual V2 MC behaviour
and serve as a regression safety net for Phases 2–4.

---

## Session 1C — Probability Tree Verification Tests

**Status**: ✅ Complete
**Date**: 2026-04-03

### Files Created

| File | Purpose |
|------|---------|
| `engine/tests/test_tree_verification.py` | Probability tree mathematical verification (6 test classes, 95 tests) |

### Test Classes

| Class | Tests | Property Verified |
|-------|-------|-------------------|
| `TestAnalyticalProbabilities` | 30 | V2 flat path table exact probabilities: path counts, ΣP=1, outcome subtotals, individual high-P paths, node-level consistency, valid outcomes per scenario |
| `TestMCConvergence` | 14 | V2 `simulate_*_challenge()` 100K-path convergence to analytical values ±0.01 for all 3 jurisdictions × 2 scenarios |
| `TestStructuralInvariants` | 21 | V2 ChallengeResult invariants: path_id format (A1–A12, HA1–HA12, etc.), scenario labels, timeline non-negativity, stages_detail keys, timeline = Σ(stages), duration ranges, determinism |
| `TestKnownOutcomesLogic` | 10 | Platform-native `simulate_challenge_tree_with_known_outcomes()`: forced node selection, stochastic continuation, deterministic fully-forced paths, known-flag in stages_traversed |
| `TestTreeConversion` | 16 | Cross-verification: platform analytical ↔ V2 flat tables, terminal path counts, required dict keys, V2 `validate_tree()`, first-path convention |
| `TestV2ValidateTree` | 4 | Quantum band invariants: ΣP=1, low < high, [0,1] bounds, E[Q\|WIN]≈0.72 |

### Exact Analytical Values Verified

| Jurisdiction | Scenario | P(TRUE_WIN) | P(RESTART) | P(LOSE) | Paths |
|-------------|----------|-------------|------------|---------|-------|
| Indian Domestic | A | 0.736025 | 0.0 | 0.263975 | 12 |
| Indian Domestic | B | 0.0 | 0.296575 | 0.703425 | 12 |
| SIAC Singapore | A | 0.8200 | 0.0 | 0.1800 | 4 |
| SIAC Singapore | B | 0.0 | 0.4200 | 0.5800 | 4 |
| HKIAC Hong Kong | A | 0.810765 | 0.0 | 0.189235 | 12 |
| HKIAC Hong Kong | B | 0.0 | 0.313250 | 0.686750 | 12 |

### Known Observations Documented

| Finding | Location | Detail |
|---------|----------|--------|
| Domestic S.34 forcing name mismatch | `_forced_child_domestic()` in `probability_tree.py` | Tree uses "Respondent Fails/Wins S.34" but forcer looks for "dismissed"/"tata wins" — forcing doesn't engage for domestic S.34 level |
| HKIAC stored path prob rounding | `v2_master_inputs.py` HKIAC_PATHS_A/B | 4-digit stored conditional_prob values → subtotals differ from exact by ≤0.001 |
| SIAC fixed durations | V2 `simulate_siac_challenge()` | Always returns exactly 12.0 months (HC=6 + COA=6) — no stochastic draw |

### Tolerance Justification

| Test Type | Tolerance | Justification |
|-----------|-----------|---------------|
| Flat path probs (Domestic, SIAC) | ±1e-4 | Stored values have 4-digit precision |
| Flat path probs (HKIAC) | ±2e-3 | 12 paths × 4-digit rounding accumulates |
| MC convergence (100K paths) | ±0.01 | SE ≈ √(0.25/100K) ≈ 0.0016; ±0.01 > 6 SE |
| Structural invariants | Exact | Checked on every simulated path |
| Platform ↔ V2 cross-check | ±1e-3 | Accounts for independent computation paths |

### Test Results

```
95 passed in 21.92s (81 fast + 14 slow)
0 failures, 0 errors, 0 warnings
Python 3.11.5, pytest 9.0.2
```

All 95 tests pass. The 14 slow MC convergence tests (100K paths each) take ~21s.
Fast structural + analytical tests complete in <1s.

---

## Session 1D — Cashflow, Metrics & Investment Grid Verification Tests

**Status**: ✅ Complete
**Date**: 2026-04-04

### Files Created

| File | Purpose |
|------|---------|
| `engine/tests/test_financial_verification.py` | Financial computation layer verification (9 test classes, 65 tests) |

### Test Classes

| Class | Tests | Property Verified |
|-------|-------|-------------------|
| `TestCashflowIdentity` | 6 | CF sum = ret - inv, dated/simple consistency, SOC vs EQ pricing, tata_tail override, LOSE→0 return |
| `TestXIRRProperties` | 10 | 2× in 12m → XIRR≈1.0, breakeven→0, total loss→-1, all positive→10 cap, sign consistency, NPV(XIRR)≈0, high/low return convergence, dayfrac match |
| `TestMOICProperties` | 6 | MOIC ≥ 0 always, exact calculation, zero return→0, zero invested→0, MOIC>1 iff profitable, net return identity |
| `TestLegalCostAccumulation` | 12 | One-time = tribunal+expert = 8 Cr, zero-duration→onetime only, Σ(monthly)=total (exact), month 0 = onetime, non-negative, monotonic with stages, SLP cost bifurcation, overrun E[factor]=1.10, MC convergence |
| `TestInterestAccrual` | 9 | Simple: I=P×r×t/12 exact, compound: I=P×((1+r/12)^t−1) exact, zero quantum/rate/duration→0, compound>simple, linear in P and t |
| `TestInvestmentGrid` | 7 | MOIC↑ with award_share, MOIC↓ with upfront, grid dims 6×9=54, XIRR↑ with award_share, CVaR≤VaR, merge monthly/dated sum-preserving |
| `TestExpectedQuantum` | 9 | E[Q\|WIN]=0.7200 (exact), E[Q]=SOC×0.72, linear in SOC, band probs sum to 1, valid ranges, MC convergence 100K→0.72±0.005, band frequency convergence, draws within band |
| `TestMonthlyIRRProperties` | 3 | Positive/negative IRR sign, total loss→-1 |
| `TestEndToEndFinancialPath` | 3 | WIN path: legal→cashflow→MOIC→XIRR chain, LOSE path: MOIC=0, XIRR=-1, interest adds to collected |

### Financial Identities Verified

| Identity | Type | Tolerance |
|----------|------|-----------|
| Σ(cashflows) = total_return − total_invested | Exact | 1e-6 (IEEE 754) |
| MOIC = total_return / total_invested | Exact | 1e-9 |
| Σ(monthly_legal_burn) = total_legal_cost | Exact | 1e-6 |
| Simple interest: I = P × r × t/12 | Exact | 1e-9 |
| Compound interest: I = P × ((1+r/12)^t − 1) | Exact | 1e-6 |
| E[Q\|WIN] = Σ prob_i × midpoint_i = 0.7200 | Exact | 1e-9 |
| NPV(XIRR) = 0 | Numerical | 0.01 (brentq tolerance) |
| E[overrun_factor] = 1.10 | Exact | 1e-9 |

### Tolerance Justification

| Test Type | Tolerance | Justification |
|-----------|-----------|---------------|
| Financial identities (sums) | 1e-6 | IEEE 754 double precision accumulation |
| Exact formulas (interest, MOIC) | 1e-9 | Single-step computation, no accumulation |
| XIRR root (NPV=0) | ±0.01 | brentq solver xtol=1e-8, verified at root |
| XIRR edge cases (2×, breakeven) | ±0.01 | Newton-Raphson convergence tolerance |
| MC quantum convergence (100K) | ±0.005 | SE ≈ 0.29/√100K ≈ 0.0009; 0.005 > 5 SE |
| MC band frequencies (100K) | ±0.01 | SE ≈ √(0.25/100K) ≈ 0.0016; 0.01 > 6 SE |
| MC overrun convergence (100K) | ±0.01 | σ(ScaledBeta) ≈ 0.15; SE ≈ 0.0005 |

### Test Results

```
65 passed in 3.16s (63 fast + 2 slow)
0 failures, 0 errors, 0 warnings
Python 3.11.5, pytest 9.0.2
```

All 65 tests pass against current engine code. Tests verify both exact analytical
identities and MC convergence properties of the financial computation layer.

---

## Session 1E — JSON Export Schema Validation & End-to-End Pipeline Tests

**Status**: ✅ Complete
**Date**: 2026-04-04

### Files Created

| File | Purpose |
|------|---------|
| `engine/tests/test_json_schema.py` | Dashboard JSON schema validation (4 test classes, 47 tests) |
| `engine/tests/test_pipeline_e2e.py` | End-to-end pipeline integration tests (4 test classes, 29 tests) |
| `docs/PHASE_1_KNOWN_BUGS.md` | Comprehensive bug catalog — 8 bugs across settlement model and probability tree |

### Conftest Update

- Added `integration` marker registration to `engine/tests/conftest.py`

### Test Classes — test_json_schema.py (47 tests)

| Class | Tests | Property Verified |
|-------|-------|-------------------|
| `TestDashboardDataSchema` | 12 | Top-level keys (portfolio_summary, claims, probability_summary, investment_grid, mc_distributions, risk), portfolio_summary types, claim count matches portfolio |
| `TestPerClaimSchema` | 11 | Per-claim required keys (claim_id, jurisdiction, collected_stats, timeline, legal_costs, etc.), numeric types, collected_stats sub-keys, jurisdiction values ∈ {domestic, siac} |
| `TestGridSchema` | 7 | Investment grid structure: dimensions 6×9=54 cells, required cell keys (upfront_pct, award_share_pct, mean_moic, mean_xirr, cvar_5), MOIC↑ with award_share, MOIC non-negative |
| `TestSchemaStability` | 15 | Round-trip JSON serialization, no NaN/Infinity in output, key naming conventions (snake_case), claim_id format (TP-xxx), timeline stage ordering, mc_distributions shape/range, risk sub-keys present |

### Test Classes — test_pipeline_e2e.py (29 tests: 28 pass + 1 skip)

| Class | Tests | Property Verified |
|-------|-------|-------------------|
| `TestFullPipelineRun` | 11 | Both structures (upfront_tail, litigation_funding) run to completion at N=500 seed=42; dashboard_data.json produced; 6 claims in output; claim_ids match config; portfolio_summary populated; numeric sanity on mean MOIC, IRR, win rate |
| `TestOutputArtifacts` | 7 | JSON, Excel, PDF all produced; charts directory created; JSON is valid parseable; Excel >10KB; report PDF >5KB; chart images present (1 skip: individual PNGs not written) |
| `TestCrossStructureConsistency` | 5 | Win rate identical across structures; claim count matches; claim_ids identical; portfolio win rates within 5pp; jurisdiction distribution consistent |
| `TestDashboardJSONIntegrity` | 6 | investment_grid non-empty; probability_summary non-empty; mc_distributions present; risk section present; cashflow per-claim IDs match claims |

### Schema Corrections Discovered

During test development, field name mismatches between prompt specification and actual V2 JSON output were identified and corrected:

| Prompt Assumed | Actual V2 JSON | Location |
|---------------|----------------|----------|
| `mean_collected_cr` | `collected_stats.mean` | Per-claim schema |
| `"indian_domestic"` / `"siac_singapore"` | `"domestic"` / `"siac"` | Jurisdiction values |
| `moic_mean` | `mean_moic` | Investment grid cells |
| probability_summary keyed by claim_id | Keyed by jurisdiction | Top-level structure |
| `moic_p5`, `moic_p95` | Not present in grid cells | Investment grid |

### Known Bugs Cataloged (docs/PHASE_1_KNOWN_BUGS.md)

| Bug ID | Location | Issue | Fix Phase |
|--------|----------|-------|-----------|
| SETTLE-001 | `v2_monte_carlo._attempt_settlement` | Hardcoded `post_challenge_survival = 0.50` | Phase 2 |
| SETTLE-002 | `v2_settlement._survival_prob_from_paths` | Only counts TRUE_WIN for survival, ignores RESTART | Phase 2 |
| SETTLE-003 | `v2_settlement.compute_continuation_values` | Uniform per-stage approximation `p_win^(1/N)` | Phase 3 |
| SETTLE-004 | `v2_settlement.compute_continuation_values` | Symmetric V_R = V_C (no respondent model) | Phase 3 |
| SETTLE-005 | `v2_settlement.compute_game_theoretic_discounts` | bargaining_power α irrelevant in NBS | Phase 3 |
| TREE-001 | `v2_probability_tree._build_tree` | S.34 forcing name mismatch | Phase 4 |
| TREE-002 | `v2_probability_tree._build_tree` | HKIAC rounding errors | Phase 4 |
| TREE-003 | `v2_probability_tree._build_tree` | SIAC fixed 12-month duration | Phase 4 |

### Test Results

```
test_json_schema.py: 47 passed in ~72s
test_pipeline_e2e.py: 28 passed, 1 skipped in ~79s
Session 1E total: 75 passed, 1 skipped, 0 failures
Python 3.11.5, pytest 9.0.2
```

---

## Phase 1 Summary — Safety Net Complete

### Total Test Count

```
Full suite (excluding @slow): 686 passed, 0 failed, 42 deselected, 18 warnings
Runtime: ~343s (5m 43s)
```

### Per-File Breakdown

| File | Tests | Session |
|------|-------|---------|
| `test_settlement_math.py` | 61 | 1A |
| `test_regression_snapshot.py` | 195 | 1B |
| `test_tree_verification.py` | 81 | 1C (fast) + 14 slow |
| `test_known_outcomes.py` | 51 | 1C |
| `test_financial_verification.py` | 62 | 1D (fast) + 2 slow |
| `test_json_schema.py` | 47 | 1E |
| `test_pipeline_e2e.py` | 6 (fast) + 23 integration | 1E |
| `test_structures.py` | 18 | Pre-existing |
| `test_refactoring_validation.py` | 40 | Pre-existing |
| `test_metrics.py` | 34 | Pre-existing |
| `test_monte_carlo.py` | 22 | Pre-existing |
| `test_edge_cases.py` | 17 | Pre-existing |
| `test_golden.py` | 18 | Pre-existing |
| `test_probability_tree.py` | 28 | Pre-existing |
| `test_quantum.py` | 6 | Pre-existing |
| **Total (non-slow)** | **686** | |

### Tests by Session

| Session | Focus | New Tests | Cumulative |
|---------|-------|-----------|------------|
| 1A | Settlement math | 61 | 61 |
| 1B | Regression snapshots | 195 | 256 |
| 1C | Probability tree | 132 | 388 |
| 1D | Financial verification | 65 | 453 |
| 1E | JSON schema + E2E pipeline | 76 | 529 |

### Files Created in Phase 1

| File | Session |
|------|---------|
| `engine/tests/conftest.py` | 1A (updated 1E) |
| `engine/tests/test_settlement_math.py` | 1A |
| `engine/tests/test_regression_snapshot.py` | 1B |
| `engine/tests/test_tree_verification.py` | 1C |
| `engine/tests/test_known_outcomes.py` | 1C |
| `engine/tests/test_financial_verification.py` | 1D |
| `engine/tests/test_json_schema.py` | 1E |
| `engine/tests/test_pipeline_e2e.py` | 1E |
| `docs/PHASE_1_KNOWN_BUGS.md` | 1E |
| `docs/PHASE_1_TESTING_LOG.md` | 1A (updated each session) |

### Known Bugs Cataloged

8 bugs documented in `docs/PHASE_1_KNOWN_BUGS.md`:
- **Phase 2 fixes** (2): SETTLE-001, SETTLE-002
- **Phase 3 fixes** (3): SETTLE-003, SETTLE-004, SETTLE-005
- **Phase 4 fixes** (3): TREE-001, TREE-002, TREE-003

### Running the Phase 1 Suite

```bash
# All fast tests (~6 minutes)
pytest engine/tests/ -m "not slow" --tb=short

# Full suite including slow convergence tests (~15 minutes)
pytest engine/tests/ --tb=short

# Individual sessions
pytest engine/tests/test_settlement_math.py         # 1A
pytest engine/tests/test_regression_snapshot.py      # 1B
pytest engine/tests/test_tree_verification.py test_known_outcomes.py  # 1C
pytest engine/tests/test_financial_verification.py   # 1D
pytest engine/tests/test_json_schema.py test_pipeline_e2e.py          # 1E
```

### Phase 1 Completion Criteria

| Criterion | Status |
|-----------|--------|
| All 5 sessions (1A–1E) complete | ✅ |
| 686 tests pass (non-slow suite) | ✅ |
| 0 failures | ✅ |
| Settlement math verified | ✅ |
| Regression snapshots locked | ✅ |
| Probability tree verified | ✅ |
| Financial computations verified | ✅ |
| JSON schema validated | ✅ |
| E2E pipeline tested | ✅ |
| Known bugs cataloged | ✅ |

**Phase 1 is complete. The safety net is in place for Phase 2 engine modifications.**
