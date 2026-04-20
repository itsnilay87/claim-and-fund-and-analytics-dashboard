# Phase 1 — Safety Net: Regression & Mathematical Verification Tests

> **Purpose**: Build a comprehensive Python test suite that snapshots current engine behavior and provides mathematical verification of settlement, probability tree, quantum, and cashflow computations. This safety net must be in place BEFORE any engine changes in Phases 2–6.
>
> **Context**: This is Phase 1 of a 6-phase remediation plan for the claim-analytics-platform. Subsequent phases will fix settlement bugs, unify dual engines, and harden the frontend. Every future change will run these tests to catch regressions.
>
> **Implementation Standard**: Write tests as a professional quantitative litigation finance expert would — verify mathematical identities analytically, not just "it doesn't crash." Every tolerance must be justified. Every invariant must be grounded in the domain.

---

## Session Architecture

Phase 1 is divided into **5 independent prompts** (Sessions 1A–1E). Each session:
- Can be run in a fresh Opus agent window
- Produces a self-contained test file (or small set of files)
- Reads existing code but does NOT modify any engine source files
- Updates the `PHASE_1_TESTING_LOG.md` documentation file at the end

### Cross-Session Context File

Every session must **first read** these files for context:
1. `AGENT_CONTEXT_GUIDE.md` — Architecture overview
2. `AGENT_DEVELOPMENT_PLAYBOOK.md` — Development rules
3. `docs/PHASE_1_TESTING_LOG.md` — Running log of what previous sessions completed (created by Session 1A)

---

## Session 1A — Test Infrastructure + Settlement Mathematics Unit Tests

### Prompt

```
You are a quantitative litigation finance expert and mathematical modelling specialist implementing Phase 1 of a 6-phase platform remediation plan for the claim-analytics-platform.

## YOUR TASK

Build the test infrastructure and write comprehensive unit tests for the settlement mathematics module (`engine/v2_core/v2_settlement.py`). These tests will serve as the mathematical verification baseline BEFORE any settlement bugs are fixed in Phase 2.

## CONTEXT — READ THESE FILES FIRST (in order)

1. `AGENT_CONTEXT_GUIDE.md` — Full architecture map
2. `AGENT_DEVELOPMENT_PLAYBOOK.md` — Development rules and constraints
3. `engine/v2_core/v2_settlement.py` — The module under test (≈210 lines)
4. `engine/v2_core/v2_master_inputs.py` — Module-level constants that settlement reads (search for "SETTLEMENT_" and "QUANTUM_BANDS" and "ARB_WIN_PROBABILITY" and "DOMESTIC_PATHS_A" and "SIAC_PATHS_A")
5. `engine/v2_core/v2_monte_carlo.py` — The `_attempt_settlement()` function (≈lines 55–155) that calls settlement logic within MC paths
6. `engine/adapter.py` — `compute_settlement_discount_ramp()` function (≈line 604) and `get_settlement_params_for_claim()` (≈line 650)
7. `engine/config/schema.py` — `SettlementConfig`, `SettlementStageOverride` Pydantic models
8. `engine/tests/test_known_outcomes.py` — Example of existing test patterns (fixtures, conftest, imports)

## MATHEMATICAL SPECIFICATIONS TO VERIFY

### 1. Settlement Discount Ramp (`compute_settlement_discount_ramp`)

For N ordered stages with no overrides:
- δ_0 = discount_min
- δ_{N-1} = discount_max
- δ_i = discount_min + (discount_max - discount_min) × i/(N-1)

Test cases:
- **Domestic 5-stage**: stages = ["dab", "arbitration", "s34", "s37", "slp"], δ_min=0.30, δ_max=0.85
  - Expected: dab=0.30, arbitration=0.4375, s34=0.575, s37=0.7125, slp=0.85
- **SIAC 4-stage**: stages = ["dab", "arbitration", "hc", "coa"], δ_min=0.30, δ_max=0.85
  - Expected: dab=0.30, arbitration=≈0.4833, hc=≈0.6667, coa=0.85
- **Single stage**: N=1 → δ = (δ_min + δ_max)/2
- **Empty stages**: N=0 → empty dict
- **With overrides**: override s34=0.60 → s34=0.60, others interpolated normally
- **All overrides**: every stage overridden → all override values used

### 2. Reference Quantum Computation (`_attempt_settlement`)

Three regimes in `_attempt_settlement()`:
- **Pre-award**: Q_ref = SOC × E[q%|win] × P(win)
  - With default bands: E[q%|win] = 0.15×0.10 + 0.05×0.30 + 0.05×0.50 + 0.05×0.70 + 0.70×0.90 = 0.72
  - With P(win)=0.70: Q_ref = SOC × 0.72 × 0.70 = SOC × 0.504
- **Post-award, claimant won**: Q_ref = quantum_cr (the drawn quantum amount)
- **Post-award, claimant lost**: Q_ref = SOC × E[q%|win] × P(re-arb win) × post_challenge_survival
  - **KNOWN BUG TO DOCUMENT**: post_challenge_survival is hardcoded at 0.50
  - Actual values: Domestic Scenario B P(RESTART)=0.2966, SIAC Scenario B P(RESTART)=0.42
  - Test should verify the CURRENT behavior (0.50 hardcode), and add a comment documenting the bug
  - This bug will be fixed in Phase 2

### 3. Continuation Values (`compute_continuation_values`)

The backward induction currently uses a uniform per-stage survival approximation:
- per_stage_survival = P(win)^(1/N)
- V_C(stage_i) = per_stage_survival^(N-i) × Q_ref

For Domestic Scenario A (arb_won=True):
- P(TRUE_WIN) from DOMESTIC_PATHS_A = 0.7360
- N = 3 stages (s34, s37, slp)
- per_stage_survival = 0.7360^(1/3) ≈ 0.9019
- V_C(slp) = 0.9019^1 × Q_ref = 0.9019 × Q_ref
- V_C(s37) = 0.9019^2 × Q_ref = 0.8134 × Q_ref
- V_C(s34) = 0.9019^3 × Q_ref = 0.7334 × Q_ref
- **KNOWN BUG TO DOCUMENT**: These approximate values diverge from actual tree probabilities
  - Actual S.34 survival: 0.70, S.37 survival: varies by branch (0.50–0.80), SLP survival: varies (0.10–0.50)
  - This bug will be fixed in Phase 3

### 4. Nash Bargaining Discount Factors (`compute_game_theoretic_discounts`)

δ*_s = (α × V_C(s) + (1-α) × V_R(s)) / Q_ref

Currently V_R(s) = V_C(s) (symmetric respondent model — another known bug), so:
- δ*_s = V_C(s) / Q_ref regardless of α

Test with α=0.5:
- For Domestic arb_won=True: δ*_s34 ≈ 0.7334, δ*_s37 ≈ 0.8134, δ*_slp ≈ 0.9019
- Verify δ* is always in [0, 1]
- Verify δ* monotonically increases from early to late stages
- **KNOWN BUG TO DOCUMENT**: V_R ≠ V_C in real NBS. V_R should include respondent's avoided legal costs.

### 5. Hazard Process Verification

`_attempt_settlement()` draws U ~ Uniform(0,1) and settles if U < λ_s.
- For λ_s = 0.15 (default): P(settle at any one stage) = 0.15
- Over 100K draws: settlement count / 100K should be within ±1% of 0.15
- For λ_s = 0: never settles
- For λ_s = 1: always settles
- For λ_s = 0.15 with multi-stage sequential: P(settle before trial completion) = 1 - (1-0.15)^N

## IMPLEMENTATION INSTRUCTIONS

### Create Files

1. **`engine/tests/conftest.py`** — Shared test fixtures:
   - `mi_context()` fixture that saves/restores MI attributes (use `save_and_restore_mi` from adapter or manual save/restore)
   - `default_settlement_mi()` fixture that patches MI with settlement enabled, default parameters
   - `rng(seed=42)` fixture returning `np.random.default_rng(42)`
   - Fixture for loading `test_tata_portfolio.json`

2. **`engine/tests/test_settlement_math.py`** — Settlement mathematics verification:
   - Class: `TestDiscountRamp` — all ramp computation tests
   - Class: `TestReferenceQuantum` — Q_ref regime tests with MI patching
   - Class: `TestContinuationValues` — backward induction verification
   - Class: `TestNashBargaining` — game-theoretic δ* verification
   - Class: `TestHazardProcess` — stochastic settlement draw verification (100K paths)
   - Class: `TestSettlementAmount` — end-to-end δ × Q_ref verification

3. **`docs/PHASE_1_TESTING_LOG.md`** — Create this documentation file:
   - Header with date and phase
   - Section for Session 1A with: files created, tests written, known bugs documented, coverage notes
   - Placeholder sections for Sessions 1B–1E

### Test Style Requirements

- Use `pytest` with descriptive test names: `test_domestic_5stage_ramp_without_overrides`
- All tolerances must be justified in comments: `# ±0.001: analytical exact, float rounding only`
- Known bugs must be documented with `# KNOWN BUG (Phase 2 fix): <description>`
- Every assertion must have a descriptive message: `assert abs(actual - expected) < tol, f"S.34 discount expected {expected}, got {actual}"`
- Use `@pytest.mark.parametrize` for jurisdiction variations (domestic, siac, hkiac)
- Mark stochastic tests with `@pytest.mark.slow` for CI gating
- Each test class must have a docstring explaining the mathematical property being verified

### CRITICAL CONSTRAINTS

- Do NOT modify any existing engine source files
- Do NOT modify any existing test files
- Python executable: use `python` (the venv is pre-activated)
- Working directory: `claim-analytics-platform/`
- Run tests with: `python -m pytest engine/tests/test_settlement_math.py -v`
- All tests should PASS against the current (buggy) code — they verify current behavior, not desired behavior
- Where current behavior is buggy, test the actual current output and add a `# KNOWN BUG` comment

### VERIFICATION

After writing tests, run them and confirm all pass. Fix any import errors or path issues. Then update `docs/PHASE_1_TESTING_LOG.md` with results.
```

---

## Session 1B — Monte Carlo Output Snapshot & Regression Tests

### Prompt

```
You are a quantitative litigation finance expert and statistical modelling specialist implementing Phase 1, Session 1B of a 6-phase platform remediation plan for the claim-analytics-platform.

## YOUR TASK

Write Monte Carlo regression tests that snapshot the current engine's statistical outputs for the 6-claim TATA portfolio. These snapshots will detect any unintended behavioral changes during Phases 2–4 (settlement bug fixes and engine convergence).

## CONTEXT — READ THESE FILES FIRST (in order)

1. `AGENT_CONTEXT_GUIDE.md` — Full architecture map
2. `docs/PHASE_1_TESTING_LOG.md` — What Session 1A completed (read to understand test infrastructure)
3. `engine/tests/conftest.py` — Shared fixtures from Session 1A
4. `engine/v2_core/v2_monte_carlo.py` — MC engine (≈800 lines) — read FULLY
5. `engine/v2_core/v2_config.py` — PathResult, SimulationResults dataclasses
6. `engine/tests/test_golden.py` — Existing golden tests (understand the pattern, don't duplicate)
7. `engine/tests/test_monte_carlo.py` — Existing MC tests (understand what's already covered)
8. `engine/tests/test_tata_portfolio.json` — 6-claim test fixture (3 Domestic, 3 SIAC)
9. `engine/adapter.py` — How platform config translates to V2 (read `patch_master_inputs_for_claim`)
10. `engine/run_v2.py` — Pipeline orchestrator (understand claim-level loop)

## STATISTICAL SPECIFICATIONS

### 1. Per-Claim Win Rate Regression (seed=42, N=2000)

For each of the 6 TATA claims, verify the win rate (P(final_outcome == "TRUE_WIN")) falls within expected ranges. These ranges capture the CURRENT behavior including all known bugs.

Expected ranges (from existing test_golden.py and test_monte_carlo.py patterns):
- **Domestic claims** (TP-301-6, TP-302-3, TP-302-5): win_rate ∈ [0.47, 0.58]
  - P(arb win) = 0.70, then P(survive challenge|win) ≈ 0.736
  - Effective: ≈0.70 × 0.736 = 0.515 + some RESTART recovery
  - Minus 96-month cap losses on RESTART paths
- **SIAC claims** (TP-CTP11-2, TP-CTP11-4, TP-CTP13-2): win_rate ∈ [0.57, 0.68]
  - P(arb win) = 0.70, P(survive|win) ≈ 0.820
  - Effective: ≈0.70 × 0.82 = 0.574 + RESTART recovery (42% RESTART rate vs 29.66% domestic)

Test at N=1000 with ±5% tolerance (MC noise at this sample size).

### 2. Outcome Distribution Completeness

For every claim, verify:
- count(TRUE_WIN) + count(LOSE) + count(SETTLED) + count(RESTART that became LOSE) = N
- If SETTLEMENT_ENABLED=False: count(SETTLED) = 0
- If NO_RESTART_MODE=True: count(RESTART) = 0 (all remapped to LOSE)

### 3. Quantum Conditional Statistics

For paths where arb_won=True AND final_outcome=="TRUE_WIN":
- Mean quantum_pct should converge to E[q%|win] = 0.72 (±0.03 at N=2000)
- All quantum_pct ∈ [0.0, 1.0] (no out-of-bounds)
- quantum_cr = quantum_pct × SOC (exact, within floating point)

### 4. Duration Bounds

For every path:
- total_duration_months ∈ [0, MAX_TIMELINE_MONTHS=96]
- If final_outcome=="SETTLED": duration = settlement_timing_months + delay
- Interest duration (if computed) ≥ 0

### 5. Cashflow Consistency

For every path:
- legal_cost_total_cr = sum(monthly_legal_burn)
- If final_outcome=="TRUE_WIN": collected_cr = quantum.quantum_cr (or re-arb quantum)
- If final_outcome=="LOSE": collected_cr = 0
- If final_outcome=="SETTLED": collected_cr = settlement.settlement_amount_cr

### 6. Settlement-Enabled Regression

Run the same portfolio with SETTLEMENT_ENABLED=True (via MI patching):
- Verify some paths settle (settlement_count > 0 for λ=0.15, N=2000)
- Verify settlement_amount > 0 for settled paths
- Verify settlement discount factor ∈ [0, 1]
- Verify settlement timing > 0

### 7. Reproducibility

Same seed + same N → identical results (bit-for-bit). Run twice, compare PathResult lists element by element.

## IMPLEMENTATION INSTRUCTIONS

### Create Files

1. **`engine/tests/test_regression_snapshot.py`** — Main regression test file:
   - Class: `TestPerClaimWinRates` — parametrized by claim_id
   - Class: `TestOutcomeDistribution` — completeness checks
   - Class: `TestQuantumStatistics` — conditional quantum verification
   - Class: `TestDurationBounds` — timeline cap enforcement
   - Class: `TestCashflowConsistency` — monetary identity checks
   - Class: `TestSettlementRegression` — settlement-enabled behavior
   - Class: `TestReproducibility` — deterministic seed verification

### Running the Simulation

The test needs to run the V2 engine for the 6-claim portfolio. Use this pattern (adapted from existing test_golden.py):

```python
from engine.config.schema import PortfolioConfig
from engine.adapter import save_and_restore_mi, patch_master_inputs_for_claim
from engine.v2_core.v2_monte_carlo import simulate_one_path
from engine.v2_core.v2_config import ClaimConfig as V2ClaimConfig
```

**Important**: The adapter's `save_and_restore_mi()` context manager must wrap any MI patching. Study how `engine/run_v2.py` and `engine/adapter.py` orchestrate per-claim simulation.

Alternatively, use the platform-native path if `test_golden.py` already has working fixtures:
```python
from engine.simulation.monte_carlo import run_claim_simulation, run_portfolio_simulation
```

Use whichever import path already works in the existing test files. Read `test_golden.py` carefully to understand the working pattern.

### Fixture Strategy

- Use a **module-scoped** fixture that runs the full simulation once and caches results
- N=2000 for speed (not 10,000) — sufficient for ±5% confidence
- seed=42 for reproducibility
- Load config from `engine/tests/test_tata_portfolio.json`

### Test Style

- Descriptive test names: `test_domestic_claim_tp301_6_win_rate_in_expected_range`
- All tolerance values justified: `# ±5%: MC sampling noise at N=2000, 95% CI for binomial proportion`
- Use `@pytest.mark.parametrize` for claim-level tests where possible
- Mark full-simulation tests with `@pytest.mark.regression`
- Each failed assertion should print diagnostic info: actual value, expected range, claim_id

### CRITICAL CONSTRAINTS

- Do NOT modify any existing engine source files
- Do NOT modify existing test files (including conftest.py from Session 1A — if you need additional fixtures, add them in a new conftest or within the test file)
- All tests should PASS against the current code
- If a simulation run fails due to import/path issues, debug and fix only the test file
- After all tests pass, update `docs/PHASE_1_TESTING_LOG.md` — append Session 1B results

### VERIFICATION

Run: `python -m pytest engine/tests/test_regression_snapshot.py -v --tb=short`
Confirm all tests pass. Record pass/fail counts in the testing log.
```

---

## Session 1C — Probability Tree & Known Outcomes Verification Tests

### Prompt

```
You are a quantitative litigation finance expert and probability theory specialist implementing Phase 1, Session 1C of a 6-phase platform remediation plan for the claim-analytics-platform.

## YOUR TASK

Write comprehensive verification tests for the probability tree module and known outcomes logic. These tests must validate the mathematical properties of the challenge tree traversal (Indian Domestic S.34→S.37→SLP and SIAC HC→COA) and verify the conditional probability mechanics when claim outcomes are known.

## CONTEXT — READ THESE FILES FIRST (in order)

1. `AGENT_CONTEXT_GUIDE.md` — Full architecture map
2. `docs/PHASE_1_TESTING_LOG.md` — What Sessions 1A-1B completed
3. `engine/v2_core/v2_probability_tree.py` — V2 tree traversal (FULL read — understand every function)
4. `engine/v2_core/v2_master_inputs.py` — Search for: DOMESTIC_PATHS_A, DOMESTIC_PATHS_B, SIAC_PATHS_A, SIAC_PATHS_B, HKIAC_PATHS_A, HKIAC_PATHS_B
5. `engine/models/probability_tree.py` — Platform-native tree with `simulate_challenge_tree_with_known_outcomes()` (FULL read)
6. `engine/config/schema.py` — `KnownOutcomes`, `ChallengeTreeConfig`, `TreeNode`, `ScenarioTree` models
7. `engine/tests/test_probability_tree.py` — Existing tree tests (understand coverage, don't duplicate)
8. `engine/tests/test_known_outcomes.py` — Existing known outcome tests

## MATHEMATICAL SPECIFICATIONS

### 1. Analytical Probability Verification

These are EXACT values computable from the path tables. They must match to ±0.0001 (floating point only).

**Domestic Scenario A** (claimant won arb, respondent challenges):
```
12 paths. Outcome distribution:
- P(TRUE_WIN) = 0.7360 (sum of paths A1,A3,A5,A7,A9,A11)
- P(LOSE) = 0.2640
- P(RESTART) = 0.0000 (structural invariant: Scenario A never produces RESTART)
All conditional_prob sum to 1.0000
```

Verify individual paths:
- A1: S.34 dismissed (0.30) → TRUE_WIN. prob=0.30
- A2: S.34 admitted (0.70) → S.37 dismissed (0.50) → award restored → TRUE_WIN. prob=0.70×0.50=0.35
- ... (verify at least the 4 highest-probability paths)

**Domestic Scenario B** (claimant lost arb, claimant challenges):
```
12 paths. Outcome distribution:
- P(TRUE_WIN) = 0.0000 (structural invariant: Scenario B never has TRUE_WIN)
- P(RESTART) = 0.2966
- P(LOSE) = 0.7034
All conditional_prob sum to 1.0000
```

**SIAC Scenario A** (claimant won arb):
```
4 paths:
- P(TRUE_WIN) = 0.8200
- P(LOSE) = 0.1800
- P(RESTART) = 0.0000
```

**SIAC Scenario B** (claimant lost arb):
```
4 paths:
- P(TRUE_WIN) = 0.0000
- P(RESTART) = 0.4200
- P(LOSE) = 0.5800
```

### 2. MC Convergence Verification (100K paths)

At N=100,000 paths, the simulated outcome frequencies must converge to the analytical values:
- For each scenario (domestic-A, domestic-B, siac-A, siac-B):
  - |simulated_P(TRUE_WIN) - analytical_P(TRUE_WIN)| < 0.01
  - |simulated_P(RESTART) - analytical_P(RESTART)| < 0.01
  - |simulated_P(LOSE) - analytical_P(LOSE)| < 0.01

### 3. Structural Invariants

These must hold for EVERY simulated path (not statistical — exact):
- Domestic Scenario A: outcome ∈ {"TRUE_WIN", "LOSE"}, never "RESTART"
- Domestic Scenario B: outcome ∈ {"RESTART", "LOSE"}, never "TRUE_WIN"
- SIAC Scenario A: outcome ∈ {"TRUE_WIN", "LOSE"}, never "RESTART"
- SIAC Scenario B: outcome ∈ {"RESTART", "LOSE"}, never "TRUE_WIN"
- All timeline_months ≥ 0
- All path_ids match expected format (A1-A12, B1-B12, SA1-SA4, SB1-SB4)

### 4. Known Outcomes Logic

When `KnownOutcomes` specifies a stage result:
- If arb_outcome="won": every path has arb_won=True, P(arb_won=False)=0
- If s34_outcome="admitted": the S.34 stage result is forced; simulation continues from S.37 onward
- If s34_outcome="dismissed" AND arb_won=True: outcome is deterministically TRUE_WIN (no further stages)

Test the PLATFORM-NATIVE implementation (`engine/models/probability_tree.py`) which has `simulate_challenge_tree_with_known_outcomes()`:
- Read this function to understand how it forces known stages
- Write tests that verify: known stage → deterministic at that stage, stochastic afterward
- Verify that probabilities from the remaining tree still sum correctly

### 5. Tree-to-Flat-Paths Conversion

Test `engine/adapter.py`'s `tree_to_v2_flat_paths()`:
- After conversion, path probabilities must still sum to 1.0 per scenario
- Outcome type distribution must match the original tree
- Stage detail durations must be non-negative

## IMPLEMENTATION INSTRUCTIONS

### Create Files

1. **`engine/tests/test_tree_verification.py`** — Tree mathematics and invariants:
   - Class: `TestAnalyticalProbabilities` — exact probability sums from path tables
   - Class: `TestMCConvergence` — 100K-path convergence to analytical values (mark `@pytest.mark.slow`)
   - Class: `TestStructuralInvariants` — outcome type constraints per scenario
   - Class: `TestKnownOutcomesLogic` — forced outcomes + conditional continuation
   - Class: `TestTreeConversion` — adapter's tree_to_v2_flat_paths round-trip

### Fixture Strategy

For analytical tests: directly access `MI.DOMESTIC_PATHS_A` etc. (or loaded from test_tata_portfolio.json via adapter patching).
For MC convergence: use N=100,000, seed=42, run tree traversal in isolation (not full MC pipeline — just `simulate_domestic_challenge(arb_won, rng)` in a loop).

### Test Style

- Analytical tests: `assert abs(actual - expected) < 1e-4, f"..."` with exact expected values in comments
- MC tests: `assert abs(actual - expected) < 0.01, f"100K-path convergence: ..."` 
- Invariant tests: loop over ALL simulated paths, fail on first violation
- Use `@pytest.mark.parametrize("scenario,jurisdiction", [...])` for cross-jurisdiction coverage
- Mark 100K-path tests with `@pytest.mark.slow`

### CRITICAL CONSTRAINTS

- Do NOT modify any existing engine source files
- Do NOT modify existing test files
- Tests must PASS against current code
- Run: `python -m pytest engine/tests/test_tree_verification.py -v --tb=short`
- After all tests pass, append Session 1C results to `docs/PHASE_1_TESTING_LOG.md`
```

---

## Session 1D — Cashflow, Metrics & Investment Grid Verification Tests

### Prompt

```
You are a quantitative litigation finance expert and financial engineering specialist implementing Phase 1, Session 1D of a 6-phase platform remediation plan for the claim-analytics-platform.

## YOUR TASK

Write verification tests for the financial computation layer: cashflow construction, XIRR/MOIC/IRR metrics, legal cost accumulation, interest accrual, and investment grid aggregation. These tests verify the financial arithmetic that converts simulation paths into investment returns.

## CONTEXT — READ THESE FILES FIRST (in order)

1. `AGENT_CONTEXT_GUIDE.md` — Full architecture map
2. `docs/PHASE_1_TESTING_LOG.md` — What Sessions 1A-1C completed
3. `engine/v2_core/v2_cashflow_builder.py` — Cashflow construction (FULL read)
4. `engine/v2_core/v2_metrics.py` — XIRR, MOIC, net return (FULL read)
5. `engine/v2_core/v2_legal_cost_model.py` — Legal cost computation (FULL read)
6. `engine/v2_core/v2_quantum_model.py` — Quantum draw + interest accrual (FULL read)
7. `engine/v2_core/v2_investment_analysis.py` — Investment grid (FULL read)
8. `engine/v2_core/v2_config.py` — PathResult fields relevant to financial computation
9. `engine/tests/test_metrics.py` — Existing metrics tests (understand coverage)
10. `engine/v2_core/v2_master_inputs.py` — Search for: LEGAL_COST_, INTEREST_, DISCOUNT_RATE, QUANTUM_BANDS

## FINANCIAL SPECIFICATIONS

### 1. Cashflow Identity

For any completed path:
```
Net Return = collected_cr + interest_earned_cr - legal_cost_total_cr - upfront_investment_cr
```

Where:
- collected_cr = quantum_cr (if TRUE_WIN) or settlement_amount_cr (if SETTLED) or 0 (if LOSE)
- legal_cost_total_cr = sum(monthly_legal_burn) — exact sum, no tolerance needed
- upfront_investment_cr = SOC × tpl_share × upfront_pct (for given grid cell)

Verify this identity holds for every path in a small simulation (N=100).

### 2. XIRR Mathematical Properties

XIRR is the discount rate r such that:
```
Σ_t  CF_t / (1 + r)^{(date_t - date_0) / 365.25} = 0
```

Properties to verify:
- XIRR is undefined (or returns fallback) when all cashflows are negative (total loss)
- For a path with 2× return in exactly 12 months: XIRR ≈ 1.0 (100%)
- For a path with 1× return in exactly 12 months: XIRR ≈ 0.0 (breakeven)
- XIRR > 0 iff net return > 0
- XIRR computation converges (does not throw) for edge cases: very high returns (10×), very low (0.01×)

### 3. MOIC Mathematical Properties

MOIC = (collected_cr + interest_earned_cr) / total_invested_cr

Properties:
- MOIC ≥ 0 always
- MOIC = 0 when collected_cr = 0 and interest_earned_cr = 0
- MOIC > 1 iff the path is profitable
- For TRUE_WIN paths: MOIC should be commensurate with quantum_pct and investment share

### 4. Legal Cost Accumulation

From `v2_legal_cost_model.py`:
- One-time costs: tribunal_cost_cr + expert_cost_cr (paid at month 0 or month 1)
- Duration-based: per_stage_cost_cr × stage_months × (1 + overrun_factor)
- Overrun factor drawn from Beta(alpha, beta) scaled to [low, high]

Verify:
- For a path with 0 duration → legal costs = one-time costs only
- Legal costs are monotonically non-decreasing with duration
- monthly_legal_burn has length = ceil(total_duration_months)
- sum(monthly_legal_burn) = legal_cost_total_cr (exact)

### 5. Interest Accrual

From `v2_quantum_model.py`:
- Simple interest: I = P × r × t/12
- Compound interest: I = P × ((1 + r/12)^t - 1)
- Where P = quantum_cr, r = annual rate, t = months

Verify:
- Interest = 0 when quantum = 0
- Interest = 0 when interest_enabled = False
- Simple interest: verify analytical formula for known (P, r, t)
- Compound interest: verify against analytical formula
- Interest ≥ 0 always (no negative interest)

### 6. Investment Grid Consistency

The grid evaluates the portfolio at each (upfront_pct, award_share) cell:
- MOIC and XIRR should vary continuously across the grid
- Higher award_share → higher expected MOIC (monotonic in expectation)
- Higher upfront_pct → lower expected MOIC (more capital deployed)
- Grid dimensions should match configuration (typically 10×11 or 6×9)

### 7. Expected Quantum

E[Q|WIN] = Σ_band P(band) × midpoint(band)

With default 5 bands:
- E[Q|WIN] = 0.15×0.10 + 0.05×0.30 + 0.05×0.50 + 0.05×0.70 + 0.70×0.90 = 0.72
- Verify analytically (exact to floating point)
- Verify via MC (100K draws, ±0.005)

## IMPLEMENTATION INSTRUCTIONS

### Create Files

1. **`engine/tests/test_financial_verification.py`** — Financial layer tests:
   - Class: `TestCashflowIdentity` — net return = collected + interest - costs - investment
   - Class: `TestXIRRProperties` — mathematical XIRR validation
   - Class: `TestMOICProperties` — MOIC bounds and monotonicity
   - Class: `TestLegalCostAccumulation` — cost model verification
   - Class: `TestInterestAccrual` — simple/compound interest formulas
   - Class: `TestInvestmentGrid` — grid consistency and monotonicity
   - Class: `TestExpectedQuantum` — analytical + MC convergence

### Test Style

- Financial tests must be EXACT where possible (no MC noise): `assert legal_cost == sum(burn), "Exact sum identity"`
- For XIRR, use ±0.01 tolerance: `# ±0.01: Newton-Raphson convergence tolerance`
- For MC-based tests (grid monotonicity), use ±5% tolerance
- Use hand-computed reference values with full derivation in comments
- Create minimal synthetic PathResult objects for unit tests (don't need full simulation)

### CRITICAL CONSTRAINTS

- Do NOT modify any existing engine source files
- Tests must PASS against current code
- Run: `python -m pytest engine/tests/test_financial_verification.py -v --tb=short`
- After all tests pass, append Session 1D results to `docs/PHASE_1_TESTING_LOG.md`
```

---

## Session 1E — JSON Export Schema Validation & End-to-End Pipeline Test

### Prompt

```
You are a quantitative litigation finance expert and software architect implementing Phase 1, Session 1E of a 6-phase platform remediation plan for the claim-analytics-platform.

## YOUR TASK

Write tests that validate the end-to-end pipeline output: the JSON schema exported by the engine for dashboard consumption, the pipeline orchestration integrity, and a full integration test that runs the complete pipeline and validates every output artifact. Also create the final Phase 1 summary documentation.

## CONTEXT — READ THESE FILES FIRST (in order)

1. `AGENT_CONTEXT_GUIDE.md` — Full architecture map
2. `docs/PHASE_1_TESTING_LOG.md` — What Sessions 1A-1D completed
3. `engine/export/json_exporter.py` — JSON export for platform engine (FULL read — understand every key in the output)
4. `engine/v2_core/v2_json_exporter.py` — V2 JSON export (FULL read)
5. `engine/run_v2.py` — V2 pipeline entry point (FULL read)
6. `engine/run.py` — Platform pipeline entry point (FULL read)
7. `engine/export/claim_exporter.py` — Claim-level export (FULL read)
8. `dashboard/src/data/dashboardData.js` — Frontend data consumer (understand required keys)
9. `engine/tests/test_structures.py` — End-to-end structure tests (understand pattern)
10. `engine/tests/test_refactoring_validation.py` — Handler/export validation pattern

## JSON SCHEMA SPECIFICATIONS

### 1. dashboard_data.json Required Keys

The dashboard frontend expects these top-level keys. Verify their presence and types:

```python
REQUIRED_KEYS = {
    "metadata": dict,          # run_id, timestamp, n_paths, seed, etc.
    "portfolio_summary": dict, # aggregate MOIC, IRR, VaR, claim_count
    "per_claim": list,         # per-claim summaries (one dict per claim)
    "outcome_distribution": dict,  # TRUE_WIN, LOSE, SETTLED counts
    "grid": dict,              # investment grid results (or null for non-upfront-tail)
    "risk_metrics": dict,      # VaR, CVaR, Sortino, max_drawdown
    "cashflow_summary": dict,  # aggregate cashflow data
}
```

### 2. Per-Claim Summary Required Fields

Each item in `per_claim` list:
```python
PER_CLAIM_REQUIRED = {
    "claim_id": str,
    "jurisdiction": str,
    "soc_value_cr": (int, float),
    "win_rate": float,          # ∈ [0, 1]
    "expected_moic": float,     # ≥ 0
    "expected_duration_months": float,  # > 0
    "mean_collected_cr": float, # ≥ 0
}
```

### 3. Grid Cell Required Fields (when grid exists)

```python
GRID_CELL_REQUIRED = {
    "upfront_pct": float,
    "award_share": float,
    "moic_mean": float,
    "moic_p5": float,
    "moic_p95": float,
    "irr_mean": float,
    "p_loss": float,           # ∈ [0, 1]
}
```

### 4. Schema Stability Assertion

Run the pipeline, capture the JSON output, and verify:
- No unexpected keys added (warns but doesn't fail — future-proof)
- No required keys missing (FAILS)
- Types match
- Numeric fields are finite (no NaN, no Inf)
- String fields are non-empty where required
- Lists have expected lengths (per_claim length = number of claims in portfolio)

## END-TO-END PIPELINE SPECIFICATIONS

### 5. Full Pipeline Run

Using `test_tata_portfolio.json`:
- Load config
- Run simulation (N=500, seed=42 — fast but representative)
- Verify outputs directory contains expected files
- Verify JSON is valid and parseable
- Verify portfolio_summary metrics are within plausible ranges:
  - portfolio_moic ∈ [0.5, 5.0]
  - portfolio_irr ∈ [-0.50, 2.0]
  - total_claims = 6
  - n_paths = 500

### 6. Pipeline Consistency: V2 vs Platform

Run the same config through both engines (if both are operational):
- V2 path: `engine/v2_core/v2_run.py` + `engine/v2_core/v2_json_exporter.py`
- Platform path: `engine/run.py` + `engine/export/json_exporter.py`

Compare:
- Both produce valid JSON
- Key structure is compatible (same top-level keys)
- Win rates agree within ±10% (different MC implementations may drift)
- If one engine fails, skip the comparison test (don't block on it)

### 7. Output Artifact Checklist

After pipeline run, verify existence of:
- `dashboard_data.json` (REQUIRED)
- `portfolio_summary.xlsx` (REQUIRED if excel writer enabled)
- `report.pdf` (OPTIONAL — may not be configured)
- `run_log.txt` or equivalent (OPTIONAL)

## DOCUMENTATION

### 8. Phase 1 Completion Documentation

After all tests pass, create/update these files:

**Update `docs/PHASE_1_TESTING_LOG.md`**:
- Complete Session 1E section
- Add "Phase 1 Summary" section with:
  - Total tests written (count by session)
  - Total test files created
  - Known bugs documented (list each with Phase where it will be fixed)
  - Coverage gaps acknowledged
  - Instructions for running all Phase 1 tests

**Create `docs/PHASE_1_KNOWN_BUGS.md`**:
- Catalog ALL known bugs discovered/documented in Sessions 1A-1E
- For each bug:
  - Bug ID (SETTLE-001, SETTLE-002, etc.)
  - Module + line reference
  - Current (buggy) behavior
  - Expected (correct) behavior
  - Mathematical impact (quantified where possible)
  - Phase where fix is scheduled
  - Test that verifies current behavior (so we know when the fix works)

## IMPLEMENTATION INSTRUCTIONS

### Create Files

1. **`engine/tests/test_json_schema.py`** — JSON output schema validation:
   - Class: `TestDashboardDataSchema` — required keys, types, constraints
   - Class: `TestPerClaimSchema` — per-claim field validation
   - Class: `TestGridSchema` — grid cell validation
   - Class: `TestSchemaStability` — no NaN/Inf, no empty required strings

2. **`engine/tests/test_pipeline_e2e.py`** — End-to-end pipeline:
   - Class: `TestFullPipelineRun` — run pipeline, check outputs
   - Class: `TestV2PlatformConsistency` — cross-engine comparison (skip if one fails)
   - Class: `TestOutputArtifacts` — file existence checks

3. **`docs/PHASE_1_KNOWN_BUGS.md`** — Bug catalog

4. **Update `docs/PHASE_1_TESTING_LOG.md`** — Final summary

### Test Style

- Schema tests should be EXACT (no tolerance — it either has the key or doesn't)
- Pipeline tests use ±10% tolerance for cross-engine comparison
- Use `@pytest.mark.integration` for full pipeline tests
- Use `@pytest.mark.slow` for tests that run full simulation
- Print diagnostic info on failure: which key was missing, what type was wrong

### CRITICAL CONSTRAINTS

- Do NOT modify any existing engine source files
- Test files from Sessions 1A-1D must still pass after your changes
- Run full suite: `python -m pytest engine/tests/ -v --tb=short -x` (stop on first failure)
- The pipeline test may need to write to a temp directory — use `tmp_path` fixture or `tempfile.mkdtemp()`
- Make sure you handle the case where the engine fails to run (skip test with informative message, don't crash the suite)

### VERIFICATION

1. Run: `python -m pytest engine/tests/test_json_schema.py engine/tests/test_pipeline_e2e.py -v --tb=short`
2. Then run FULL suite: `python -m pytest engine/tests/ -v --tb=short`
3. Confirm all tests from Sessions 1A-1E pass together
4. Update documentation files
5. Report final counts: total tests, pass, fail, skip
```

---

## Running All Phase 1 Tests

After all 5 sessions are complete, the full test suite can be run with:

```bash
cd claim-analytics-platform
python -m pytest engine/tests/ -v --tb=short

# Fast tests only (skip 100K-path convergence):
python -m pytest engine/tests/ -v --tb=short -m "not slow"

# Settlement tests only:
python -m pytest engine/tests/test_settlement_math.py -v

# Regression snapshot only:
python -m pytest engine/tests/test_regression_snapshot.py -v

# Full integration:
python -m pytest engine/tests/test_pipeline_e2e.py -v
```

## Files Created by Phase 1

| Session | New Files | Purpose |
|---------|-----------|---------|
| 1A | `engine/tests/conftest.py`, `engine/tests/test_settlement_math.py`, `docs/PHASE_1_TESTING_LOG.md` | Test infrastructure + settlement math |
| 1B | `engine/tests/test_regression_snapshot.py` | MC output snapshots |
| 1C | `engine/tests/test_tree_verification.py` | Probability tree verification |
| 1D | `engine/tests/test_financial_verification.py` | Financial layer verification |
| 1E | `engine/tests/test_json_schema.py`, `engine/tests/test_pipeline_e2e.py`, `docs/PHASE_1_KNOWN_BUGS.md` | Schema + E2E + bug catalog |

## Cross-Session Context Protocol

Each session:
1. **Reads** `docs/PHASE_1_TESTING_LOG.md` to understand what previous sessions completed
2. **Reads** `AGENT_CONTEXT_GUIDE.md` for architecture context
3. **Writes** results to `docs/PHASE_1_TESTING_LOG.md` at session end
4. **Does NOT modify** files created by earlier sessions

This ensures that even if sessions are run weeks apart or by different agents, context is preserved through the documentation files.
