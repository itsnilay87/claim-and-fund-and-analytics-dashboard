# Phase 4 — Engine Convergence + Tree Bug Fixes

> **Purpose**: Unify the dual-engine architecture (platform-native + V2 core) into a single canonical simulation engine. Fix remaining probability tree bugs (TREE-002, TREE-003). Eliminate global-state monkey-patching in favor of explicit configuration objects.
>
> **Prerequisites**: Phase 3 complete (settlement math correct, known outcomes working).
>
> **Architecture Goal**: After Phase 4, there is ONE simulation function that takes a Pydantic `ClaimConfig` and returns `SimulationResults`. No MI monkey-patching. No flat path tables. The generic tree walker in `models/probability_tree.py` is the sole tree traversal engine.

---

## Session Architecture

Phase 4 has **5 sessions** (4A–4E).

### Cross-Session Context

Every session reads:
1. `AGENT_CONTEXT_GUIDE.md`
2. `docs/PHASE_1_KNOWN_BUGS.md` — TREE-002, TREE-003
3. `docs/PHASE_3_CHANGE_LOG.md` — Phase 3 changes
4. `docs/PHASE_4_CHANGE_LOG.md` — Running log (created by Session 4A)

---

## Session 4A — Replace MI Global State with Explicit SimulationConfig (v2_monte_carlo.py)

### Prompt

```
You are a senior software engineer implementing Phase 4, Session 4A of a 6-phase platform remediation plan for a Monte Carlo litigation finance simulation engine.

## YOUR TASK

Refactor `engine/v2_core/v2_monte_carlo.py` to accept explicit configuration objects instead of reading from the global `v2_master_inputs` module. This is the foundational change that makes engine unification possible.

## CONTEXT — READ THESE FILES FIRST

1. `AGENT_CONTEXT_GUIDE.md`
2. `docs/PHASE_3_CHANGE_LOG.md` — Phase 3 changes
3. `engine/v2_core/v2_monte_carlo.py` — FULL read. Note every `MI.` reference
4. `engine/v2_core/v2_master_inputs.py` — All MI constants being accessed
5. `engine/adapter.py` — `save_and_restore_mi()` and `patch_master_inputs_for_claim()`
6. `engine/config/schema.py` — Pydantic models (ClaimConfig, SimulationConfig, SettlementConfig)
7. `engine/v2_core/v2_config.py` — Existing V2 dataclasses (PathResult, SimulationResults)
8. `engine/tests/conftest.py` — Shared fixtures

## DESIGN

### New: `SimulationParams` dataclass

Create a lightweight dataclass in `engine/v2_core/v2_config.py`:

```python
@dataclass
class SimulationParams:
    """All parameters needed to simulate a single claim. Replaces MI module reads."""
    arb_win_probability: float
    quantum_bands: list[dict]
    soc_value_cr: float
    jurisdiction: str
    
    # Timeline
    dab_duration: float
    arb_duration: float
    arb_duration_std: float
    challenge_durations: dict  # stage_name → months
    
    # Legal costs
    legal_costs: dict  # phase → {"low": float, "high": float}
    
    # Interest
    interest_rate: float
    interest_type: str  # "simple" or "compound"
    interest_start: str
    
    # Settlement
    settlement_enabled: bool
    settlement_mode: str  # "user_specified" or "game_theoretic"
    settlement_hazard_rate: float
    settlement_discount_factors: dict  # stage → δ
    settlement_bargaining_power: float
    settlement_respondent_legal_cost_cr: float | None
    
    # Challenge tree (flat paths — temporary, replaced in 4C)
    paths_a: list[dict]
    paths_b: list[dict]
    
    # Known outcomes
    known_outcomes: dict | None
    
    # Re-arb
    re_arb_win_probability: float
```

### Refactoring Strategy

1. **Add `params` argument** to every function that currently reads `MI.*`:
   - `simulate_one_path(claims, rng, n)` → `simulate_one_path(claims, rng, n, params_by_claim)`
   - `_attempt_settlement(...)` → add `params` arg
   - `draw_quantum(rng)` → `draw_quantum(rng, params)`
   - `draw_pipeline_duration(rng)` → `draw_pipeline_duration(rng, params)`
   - `run_simulation(n_sims, seed)` → `run_simulation(n_sims, seed, params_by_claim)`

2. **Replace every `MI.` read** with `params.` read. Search for all `MI\.` in the file.

3. **Keep backward compatibility**: Add a factory function:
   ```python
   def params_from_mi(claim_id=None) -> SimulationParams:
       """Build SimulationParams from current MI state. Transitional."""
       return SimulationParams(
           arb_win_probability=MI.ARB_WIN_PROBABILITY,
           quantum_bands=MI.QUANTUM_BANDS,
           ...
       )
   ```

4. **Keep `run_simulation()` backward compatible** by defaulting `params_by_claim=None` and calling `params_from_mi()` when None.

### DO NOT CHANGE
- The `adapter.py` file — it still monkey-patches MI for now (cleaned up in 4B)
- The `run_v2.py` entry point — it calls adapter which calls MC
- Any test expectations — behavior must be identical

## TESTS

1. Run ALL existing tests: `python -m pytest engine/tests/ -v --tb=short`
2. All must pass with zero changes to test code (backward compat)
3. Add one new test:
   ```python
   def test_explicit_params_match_mi_params():
       """SimulationParams from MI gives identical simulation to MI-based path."""
   ```

## DOCUMENTATION

Create `docs/PHASE_4_CHANGE_LOG.md` with Session 4A entry.
```

---

## Session 4B — Eliminate MI Monkey-Patching in adapter.py

### Prompt

```
You are a senior software engineer implementing Phase 4, Session 4B.

## YOUR TASK

Refactor `engine/adapter.py` to build `SimulationParams` objects directly from Pydantic `ClaimConfig` instead of monkey-patching the MI module. Eliminate `save_and_restore_mi()` and `patch_master_inputs_for_claim()`.

## CONTEXT — READ THESE FILES FIRST

1. `AGENT_CONTEXT_GUIDE.md`
2. `docs/PHASE_4_CHANGE_LOG.md` — Session 4A changes
3. `engine/adapter.py` — FULL read. Focus on `_patch_mi_from_claim()` and `save_and_restore_mi()`
4. `engine/v2_core/v2_config.py` — `SimulationParams` dataclass (added in 4A)
5. `engine/v2_core/v2_monte_carlo.py` — Now takes `params_by_claim` dict
6. `engine/config/schema.py` — Pydantic models (full ClaimConfig fields)
7. `engine/run_v2.py` — How adapter is called in the pipeline

## DESIGN

### New function: `build_simulation_params(claim: ClaimConfig, settlement_config: SettlementConfig) -> SimulationParams`

This replaces the monkey-patching. It reads the Pydantic model directly:

```python
def build_simulation_params(claim: ClaimConfig, settlement_config: SettlementConfig) -> SimulationParams:
    """Convert Pydantic ClaimConfig to SimulationParams for MC engine."""
    # Extract tree paths (still flat for now; 4C replaces with recursive)
    paths_a = tree_to_v2_flat_paths(claim.challenge_tree.scenario_a, claim.jurisdiction)
    paths_b = tree_to_v2_flat_paths(claim.challenge_tree.scenario_b, claim.jurisdiction)
    
    # Build settlement discount factors
    discount_factors = compute_settlement_discount_ramp(
        claim.jurisdiction,
        settlement_config.discount_min,
        settlement_config.discount_max,
        settlement_config.stage_overrides,
    )
    
    return SimulationParams(
        arb_win_probability=claim.arb_win_probability,
        quantum_bands=claim.quantum_bands,
        soc_value_cr=claim.soc_value_cr,
        jurisdiction=claim.jurisdiction,
        dab_duration=claim.dab_duration,
        arb_duration=claim.arb_duration,
        arb_duration_std=claim.arb_duration_std,
        challenge_durations=_extract_durations_from_tree(claim.challenge_tree),
        legal_costs=claim.legal_costs,
        interest_rate=claim.interest_config.rate,
        interest_type=claim.interest_config.type,
        interest_start=claim.interest_config.start,
        settlement_enabled=settlement_config.enabled,
        settlement_mode=settlement_config.mode,
        settlement_hazard_rate=settlement_config.global_hazard_rate,
        settlement_discount_factors=discount_factors,
        settlement_bargaining_power=settlement_config.bargaining_power,
        settlement_respondent_legal_cost_cr=settlement_config.respondent_legal_cost_cr,
        paths_a=paths_a,
        paths_b=paths_b,
        known_outcomes=claim.known_outcomes.dict() if claim.known_outcomes else None,
        re_arb_win_probability=claim.re_arb_win_probability,
    )
```

### Refactoring Strategy

1. Add `build_simulation_params()` function to `adapter.py`
2. Update `run_v2.py` pipeline to:
   - Build `params_by_claim = {claim.claim_id: build_simulation_params(claim, settlement_config) for claim in config.claims}`
   - Pass `params_by_claim` to `run_simulation()`
   - Remove MI patching loop
3. Mark `save_and_restore_mi()` and `patch_master_inputs_for_claim()` as `@deprecated`
4. Keep them functional for backward compatibility (old entry points)

### TESTS

1. Run ALL existing tests
2. Add test:
   ```python
   def test_build_params_matches_patch_mi():
       """build_simulation_params() gives identical params to patch_mi + params_from_mi()."""
   ```

## DOCUMENTATION

Append Session 4B to `docs/PHASE_4_CHANGE_LOG.md`.
```

---

## Session 4C — Replace Flat Path Tables with Generic Tree Walker

### Prompt

```
You are a senior software engineer implementing Phase 4, Session 4C.

## YOUR TASK

Replace the hardcoded flat path tables (DOMESTIC_PATHS_A/B, SIAC_PATHS_A) in the MC engine with the generic recursive tree walker from `engine/models/probability_tree.py`. This also fixes TREE-003 (SIAC fixed durations).

## CONTEXT — READ THESE FILES FIRST

1. `AGENT_CONTEXT_GUIDE.md`
2. `docs/PHASE_4_CHANGE_LOG.md` — Sessions 4A-4B changes
3. `docs/PHASE_1_KNOWN_BUGS.md` — TREE-003
4. `engine/v2_core/v2_monte_carlo.py` — How flat paths are consumed in `simulate_one_path()`
5. `engine/v2_core/v2_probability_tree.py` — Hardcoded flat path tables
6. `engine/models/probability_tree.py` — Generic tree walker: `simulate_challenge_tree()`, `ChallengeResult`
7. `engine/v2_core/v2_config.py` — SimulationParams (has paths_a/paths_b fields)

## DESIGN

### Current flow (buggy):
```
adapter flattens tree → 12 paths stored in SimulationParams.paths_a/b
MC engine: rng draws random number, walks flat path list to pick outcome
```

### New flow (correct):
```
SimulationParams stores ScenarioTree directly (recursive Pydantic model)
MC engine: calls simulate_challenge_tree(tree, rng) at each challenge point
Returns ChallengeResult with outcome, duration, path description
```

### Changes to SimulationParams:

```python
@dataclass
class SimulationParams:
    ...
    # REPLACE:
    # paths_a: list[dict]
    # paths_b: list[dict]
    # WITH:
    challenge_tree: ChallengeTreeConfig  # Pydantic model with scenario_a, scenario_b
    ...
```

### Changes to v2_monte_carlo.py:

In `simulate_one_path()`, replace flat path lookup:
```python
# OLD:
outcome, stages_detail = simulate_domestic_challenge(rng, paths_a)

# NEW:
from engine.models.probability_tree import simulate_challenge_tree
if arb_won:
    result = simulate_challenge_tree(params.challenge_tree.scenario_a, rng)
else:
    result = simulate_challenge_tree(params.challenge_tree.scenario_b, rng)
outcome = result.outcome  # "TRUE_WIN", "RESTART", "LOSE"
duration = result.total_duration_months
stages_detail = result.stages
```

### TREE-003 Fix

SIAC trees currently use a fixed 12-month duration per stage. The fix is already in the `TreeNode` model — each node has `duration_distribution` with type "uniform|fixed" and range. By using the generic tree walker (which reads `duration_distribution` from each node), SIAC durations become stochastic.

Verify by:
1. Reading SIAC tree config in test portfolio
2. Confirming that HC and COA stages have duration distributions (not fixed)
3. Running simulations and checking that SIAC challenge durations vary

### RNG Compatibility

**CRITICAL**: The generic tree walker must consume RNG draws in the same pattern as the flat-path simulation. Otherwise, seeded simulations will produce different results.

The generic walker draws: 1 `rng.random()` per tree level for branch selection + 1 `rng.uniform()` per level for duration. Verify this matches the flat-path RNG consumption.

If it doesn't match exactly, update regression baselines with analytical justification.

### TESTS

1. Run ALL existing tests
2. **Expected**: Some regression tests may have different values due to RNG ordering change. Update with justification.
3. Add tests:
   - `test_tree_walker_outcomes_match_flat_paths`: For 100K sims, outcome distribution matches analytical ± 2%
   - `test_siac_durations_are_stochastic`: SIAC challenge durations have non-zero variance (TREE-003 fix)

## DOCUMENTATION

Append Session 4C to `docs/PHASE_4_CHANGE_LOG.md`.
Mark TREE-003 as FIXED in `docs/PHASE_1_KNOWN_BUGS.md`.
```

---

## Session 4D — Fix TREE-002 (HKIAC Rounding) + Deprecate V2 Tree Module

### Prompt

```
You are a senior software engineer implementing Phase 4, Session 4D.

## YOUR TASK

Fix TREE-002 (HKIAC stored probability rounding error) and deprecate the old `engine/v2_core/v2_probability_tree.py` module.

## CONTEXT — READ THESE FILES FIRST

1. `AGENT_CONTEXT_GUIDE.md`
2. `docs/PHASE_1_KNOWN_BUGS.md` — TREE-002
3. `docs/PHASE_4_CHANGE_LOG.md` — Sessions 4A-4C changes
4. `engine/v2_core/v2_probability_tree.py` — The module being deprecated
5. `engine/models/probability_tree.py` — The canonical tree module
6. `engine/config/schema.py` — Tree validators

## TREE-002 BUG

HKIAC trees store probabilities with ≤0.001 rounding error. The total probability at each level may sum to 0.999 or 1.001 instead of exactly 1.0.

### Fix

In `engine/config/schema.py`, in the `TreeNode` validator or `ScenarioTree` validator:
- For each level of children, verify `sum(child.probability for child in children)` is within [0.999, 1.001]
- If within tolerance, normalize: `child.probability /= total` so they sum to exactly 1.0
- If outside tolerance, raise ValidationError

This normalization happens at config load time (Pydantic validator), so all downstream consumers see exact probabilities.

### Deprecation of v2_probability_tree.py

1. Add deprecation header to `engine/v2_core/v2_probability_tree.py`:
   ```python
   """DEPRECATED: This module is replaced by engine.models.probability_tree.
   Kept only for backward compatibility with v2_run.py entry point.
   All new code should use engine.models.probability_tree.simulate_challenge_tree().
   """
   import warnings
   warnings.warn("v2_probability_tree is deprecated", DeprecationWarning, stacklevel=2)
   ```
2. Remove all imports of this module from `v2_monte_carlo.py`
3. Verify ONLY `v2_run.py` (old entry point) still references it

## TESTS

1. Run ALL existing tests
2. Add test:
   ```python
   def test_tree_probability_normalization():
       """Probabilities summing to 0.999 are auto-normalized to 1.0."""
   
   def test_tree_probability_outside_tolerance_rejected():
       """Probabilities summing to 0.95 raise ValidationError."""
   ```

**Note**: `test_tata_portfolio.json` has NO HKIAC claims (only domestic + SIAC). To verify the HKIAC rounding fix end-to-end, either:
- (a) Add a minimal HKIAC test claim to the test portfolio, OR
- (b) Create a standalone HKIAC tree fixture in `test_tree_verification.py` with probabilities that sum to 0.999

Option (b) is preferred — keeps the test portfolio stable while still verifying the normalization fix.

## DOCUMENTATION

Append Session 4D to `docs/PHASE_4_CHANGE_LOG.md`.
Mark TREE-002 as FIXED in `docs/PHASE_1_KNOWN_BUGS.md`.
```

---

## Session 4E — Phase 4 Integration Verification & Documentation

### Prompt

```
You are a senior software engineer completing Phase 4.

## YOUR TASK

Integration-test all Phase 4 changes, verify engine convergence works end-to-end, and update all documentation.

## CONTEXT — READ THESE FILES FIRST

1. `AGENT_CONTEXT_GUIDE.md`
2. `docs/PHASE_4_CHANGE_LOG.md` — All sessions
3. `docs/PHASE_1_KNOWN_BUGS.md` — All bugs

## TASKS

1. **Run full test suite**: `python -m pytest engine/tests/ -v --tb=short`
2. **Run E2E pipeline**: 
   - `python -m engine.run_v2 --config engine/tests/test_tata_portfolio.json --output-dir test_outputs/phase4_verify --n 500 --seed 42`
   - Verify all outputs generated (JSON, Excel, PDF)
3. **Verify convergence**: 
   - Old entry point (`v2_run.py` with MI patching) and new entry point (`run_v2.py` with explicit params) produce statistically equivalent results for same seed
4. **Update regression baselines**: If tree walker RNG changes affected seeded outputs, update `test_regression_snapshot.py` expectations with clear justification comments
5. **Architecture validation**: Verify:
   - `v2_monte_carlo.py` has ZERO `MI.` references (except in `params_from_mi()`)
   - `run_v2.py` no longer calls `save_and_restore_mi()`
   - All tests import from `engine.models.probability_tree`, not `v2_core.v2_probability_tree`
6. **Documentation updates**:
   - Mark TREE-002, TREE-003 as FIXED in `docs/PHASE_1_KNOWN_BUGS.md`
   - Finalize `docs/PHASE_4_CHANGE_LOG.md`
   - Update `AGENT_CONTEXT_GUIDE.md` with unified engine architecture description
   
## VERIFICATION

All tests pass. Pipeline runs clean. No MI monkey-patching in main flow. Generic tree walker is sole tree engine.
```

---

## Files Modified by Phase 4

| Session | Files Modified | Files Created |
|---------|---------------|---------------|
| 4A | `engine/v2_core/v2_monte_carlo.py`, `engine/v2_core/v2_config.py` | `docs/PHASE_4_CHANGE_LOG.md` |
| 4B | `engine/adapter.py`, `engine/run_v2.py` | — |
| 4C | `engine/v2_core/v2_monte_carlo.py`, `engine/v2_core/v2_config.py` | — |
| 4D | `engine/config/schema.py`, `engine/v2_core/v2_probability_tree.py` | — |
| 4E | `engine/tests/test_regression_snapshot.py`, `docs/PHASE_1_KNOWN_BUGS.md`, `AGENT_CONTEXT_GUIDE.md` | — |
