# Phase 2 — Settlement Bugs 2, 3, 4: Critical Mathematical Fixes

> **Purpose**: Fix the three highest-impact settlement model bugs that produce incorrect settlement pricing. These are mechanical fixes — replacing hardcoded constants and wiring existing but disconnected code — contained within 2-3 files.
>
> **Prerequisites**: Phase 1 complete (686 tests passing). Read `docs/PHASE_1_KNOWN_BUGS.md` for exact bug specifications.
>
> **Implementation Standard**: Fixes must be mathematically rigorous. Every change must cite the correct formula, derive the expected values analytically, and be verified by both existing Phase 1 tests (which will need updated assertions) and new targeted tests.

---

## Session Architecture

Phase 2 has **3 sessions** (2A–2C). Each modifies engine source files and updates tests.

### Cross-Session Context

Every session reads:
1. `AGENT_CONTEXT_GUIDE.md` — Architecture map
2. `docs/PHASE_1_KNOWN_BUGS.md` — Bug specifications (SETTLE-001, SETTLE-002)
3. `docs/PHASE_2_CHANGE_LOG.md` — Running log (created by Session 2A)

---

## Session 2A — Wire Settlement Discount Ramp (Bug 2) + Game-Theoretic Mode Switch (Bug 3)

### Prompt

```
You are a quantitative litigation finance expert implementing Phase 2, Session 2A of a 6-phase platform remediation plan for the claim-analytics-platform.

## YOUR TASK

Fix two settlement bugs:
1. **Discount ramp never applied** (Bug 2): `compute_settlement_discount_ramp()` exists in `engine/adapter.py` but is never called. Every settlement uses δ = SETTLEMENT_DISCOUNT_MIN = 0.30 (the floor) instead of the stage-appropriate ramp value.
2. **Game-theoretic mode is dead code** (Bug 3): `compute_game_theoretic_discounts()` in `v2_settlement.py` is fully implemented but `_attempt_settlement()` in `v2_monte_carlo.py` never calls it regardless of `SETTLEMENT_MODE`.

## CONTEXT — READ THESE FILES FIRST (in order)

1. `AGENT_CONTEXT_GUIDE.md` — Architecture map
2. `docs/PHASE_1_KNOWN_BUGS.md` — Full bug specifications
3. `engine/adapter.py` — Read the full file. Focus on:
   - `compute_settlement_discount_ramp()` (≈line 604)
   - `get_settlement_params_for_claim()` (≈line 650)
   - `_patch_mi_from_claim()` — where MI attributes get patched per-claim
   - `_MI_PATCHABLE_ATTRS` list — what MI attributes the adapter knows about
4. `engine/v2_core/v2_monte_carlo.py` — Read the full file. Focus on:
   - `_attempt_settlement()` (≈line 70) — current settlement logic
   - How `MI.SETTLEMENT_STAGE_DISCOUNT_FACTORS` is used (line ~143)
   - How `MI.SETTLEMENT_MODE` is passed in the return statement (line ~149) but never checked for dispatch
5. `engine/v2_core/v2_settlement.py` — Full file. Focus on:
   - `compute_game_theoretic_discounts()` — returns dict[stage_name, δ*]
   - What inputs it needs (jurisdiction, arb_won, expected_quantum_cr, soc_value_cr, bargaining_power)
6. `engine/v2_core/v2_master_inputs.py` — Search for all `SETTLEMENT_` attributes
7. `engine/tests/test_settlement_math.py` — Understand which tests verify current (buggy) behavior
8. `engine/tests/test_regression_snapshot.py` — Understand which assertions will need tolerance adjustment

## BUG 2 FIX: Wire the Discount Ramp

### Root Cause
In `engine/adapter.py`, function `patch_master_inputs_for_claim()` (line ~363) patches many MI attributes from the Pydantic claim config — but it NEVER calls `compute_settlement_discount_ramp()` and NEVER patches `MI.SETTLEMENT_STAGE_DISCOUNT_FACTORS`. Note: `compute_settlement_discount_ramp()` IS called inside `get_settlement_params_for_claim()` (line ~666), but that function is NEVER invoked by any caller. So `MI.SETTLEMENT_STAGE_DISCOUNT_FACTORS` stays empty (set to `{}` in `v2_master_inputs.py`), and `_attempt_settlement()` always falls through to `MI.SETTLEMENT_DISCOUNT_MIN = 0.30`.

### Fix (in `engine/adapter.py`, function `patch_master_inputs_for_claim()`)

At the end of the settlement patching section, after setting `MI.SETTLEMENT_DISCOUNT_MIN`, `MI.SETTLEMENT_DISCOUNT_MAX`, etc., ADD:

```python
# Compute per-stage discount ramp from min/max/overrides
eligible_stages = SETTLEMENT_ELIGIBLE_STAGES.get(
    claim.jurisdiction.lower().replace(" ", "_"), []
)
override_discounts = {}
if sc.stage_overrides:
    override_discounts = {
        so.stage_name: so.discount_factor
        for so in sc.stage_overrides
        if so.discount_factor is not None
    }
MI.SETTLEMENT_STAGE_DISCOUNT_FACTORS = compute_settlement_discount_ramp(
    eligible_stages,
    sc.discount_min,
    sc.discount_max,
    override_discounts,
)
```

### Verify
- `MI.SETTLEMENT_STAGE_DISCOUNT_FACTORS` must be non-empty after patching
- For domestic 5-stage with defaults: dab=0.30, arbitration=0.4375, s34=0.575, s37=0.7125, slp=0.85
- `_attempt_settlement()` now picks up stage-specific δ from the dict instead of falling to the floor

## BUG 3 FIX: Activate Game-Theoretic Mode

### Root Cause
`_attempt_settlement()` always uses the user-specified discount factor from `MI.SETTLEMENT_STAGE_DISCOUNT_FACTORS`. It never checks `MI.SETTLEMENT_MODE` to decide whether to call `compute_game_theoretic_discounts()`.

### Fix (in `engine/v2_core/v2_monte_carlo.py`, function `_attempt_settlement()`)

Replace the discount factor lookup block (step 4, approximately lines 140-147) with mode-aware logic:

```python
# 4. Get discount factor for this stage
if MI.SETTLEMENT_MODE == "game_theoretic":
    from .v2_settlement import compute_game_theoretic_discounts, _expected_quantum_fraction
    eq_given_win = _expected_quantum_fraction()
    eq_cr = soc_value_cr * eq_given_win
    gt_discounts = compute_game_theoretic_discounts(
        jurisdiction=getattr(MI, 'CURRENT_JURISDICTION', 'domestic'),
        arb_won=arb_won,
        expected_quantum_cr=eq_cr,
        soc_value_cr=soc_value_cr,
        bargaining_power=MI.SETTLEMENT_BARGAINING_POWER,
    )
    delta_s = gt_discounts.get(stage_name, MI.SETTLEMENT_DISCOUNT_MIN)
else:
    # user_specified mode: use pre-computed ramp
    stage_discounts = MI.SETTLEMENT_STAGE_DISCOUNT_FACTORS
    if stage_name in stage_discounts:
        delta_s = stage_discounts[stage_name]
    else:
        delta_s = MI.SETTLEMENT_DISCOUNT_MIN
```

**Also needed**: Ensure `MI.CURRENT_JURISDICTION` is patched per-claim in `_patch_mi_from_claim()`. Add this attribute to `_MI_PATCHABLE_ATTRS` and set it during claim patching:
```python
MI.CURRENT_JURISDICTION = claim.jurisdiction.lower().replace(" ", "_")
```

And add the default in `v2_master_inputs.py`:
```python
CURRENT_JURISDICTION = "domestic"  # patched per-claim by adapter
```

## TEST UPDATES

### Tests that must be UPDATED (current behavior changes)

1. **`test_settlement_math.py::TestSettlementAmount`**: Tests that verify δ = 0.30 for all stages must now verify δ follows the ramp. Update expected values per stage.

2. **`test_regression_snapshot.py::TestSettlementRegression`**: Settlement-enabled tests may show different settlement amounts (ramp δ > 0.30 for later stages). Widen tolerances or update expected ranges.

### New Tests to ADD

Add to `engine/tests/test_settlement_math.py`:

```python
class TestDiscountRampWiring:
    """Verify that adapter properly wires discount ramp into MI."""
    
    def test_mi_discount_factors_populated_after_patch(self, ...):
        """After _patch_mi_from_claim, MI.SETTLEMENT_STAGE_DISCOUNT_FACTORS is non-empty."""
        
    def test_domestic_ramp_values_match_analytical(self, ...):
        """5-stage domestic ramp matches linear interpolation formula."""
        
    def test_siac_ramp_values_match_analytical(self, ...):
        """4-stage SIAC ramp matches formula."""

class TestGameTheoreticModeSwitch:
    """Verify game-theoretic mode produces different discounts than user_specified."""
    
    def test_game_theoretic_mode_uses_computed_discounts(self, ...):
        """When SETTLEMENT_MODE="game_theoretic", discounts come from NBS computation."""
        
    def test_user_specified_mode_uses_ramp(self, ...):
        """When SETTLEMENT_MODE="user_specified", discounts come from ramp."""
        
    def test_mode_switch_changes_settlement_amounts(self, ...):
        """Same settlement scenario produces different amounts under different modes."""
```

## DOCUMENTATION

Create `docs/PHASE_2_CHANGE_LOG.md` with:
- Session 2A header with date
- Files modified with exact changes
- Bug IDs fixed (reference PHASE_1_KNOWN_BUGS.md)
- Tests added/updated
- Test results

## VERIFICATION

1. Run: `python -m pytest engine/tests/test_settlement_math.py -v --tb=short`
2. Run: `python -m pytest engine/tests/test_regression_snapshot.py -v --tb=short`
3. Run full suite: `python -m pytest engine/tests/ -v --tb=short -m "not slow"`
4. All tests must pass. Document any tests whose expected values you updated and WHY.

## CRITICAL CONSTRAINTS

- Only modify: `engine/adapter.py`, `engine/v2_core/v2_monte_carlo.py`, `engine/v2_core/v2_master_inputs.py`
- Only modify test files: `engine/tests/test_settlement_math.py`
- Do NOT touch probability tree, quantum, cashflow, or JSON export files
- Keep changes minimal and surgical — these are contained bug fixes, not refactors
```

---

## Session 2B — Fix Hardcoded Survival Probability (Bug 4: SETTLE-001)

### Prompt

```
You are a quantitative litigation finance expert implementing Phase 2, Session 2B of a 6-phase platform remediation plan.

## YOUR TASK

Fix SETTLE-001: The hardcoded `post_challenge_survival = 0.50` in `_attempt_settlement()`. Replace it with the actual analytical survival probability computed from the challenge tree paths.

## CONTEXT — READ THESE FILES FIRST

1. `AGENT_CONTEXT_GUIDE.md`
2. `docs/PHASE_1_KNOWN_BUGS.md` — SETTLE-001 specification
3. `docs/PHASE_2_CHANGE_LOG.md` — Session 2A changes (discount ramp + mode switch)
4. `engine/v2_core/v2_monte_carlo.py` — Find `post_challenge_survival = 0.50` in `_attempt_settlement()`
5. `engine/v2_core/v2_settlement.py` — `_survival_prob_from_paths()` and `_get_paths()`
6. `engine/v2_core/v2_master_inputs.py` — DOMESTIC_PATHS_A/B, SIAC_PATHS_A/B, HKIAC_PATHS_A/B

## THE BUG

In `_attempt_settlement()`, regime 3 (post-award, claimant lost):
```python
post_challenge_survival = 0.50  # HARDCODED
q_ref = soc_value_cr * eq_given_win * MI.RE_ARB_WIN_PROBABILITY * post_challenge_survival
```

The 0.50 should be the actual P(RESTART|Scenario B) from the path tables:
- Domestic: P(RESTART|ScB) = 0.2966
- SIAC: P(RESTART|ScB) = 0.4200
- HKIAC: P(RESTART|ScB) = 0.3133

## THE FIX

### Step 1: Fix `_survival_prob_from_paths()` in `v2_settlement.py` (also fixes SETTLE-002)

The function currently only counts `TRUE_WIN`. For Scenario B, survival means RESTART (re-arbitration). Change:

```python
def _survival_prob_from_paths(paths: list[dict], scenario_b: bool = False) -> float:
    """Compute survival probability from conditional-probability paths.
    
    For Scenario A (arb won): P(TRUE_WIN) — claimant's award survives challenge
    For Scenario B (arb lost): P(RESTART) — claimant gets another chance via re-arb
    """
    if scenario_b:
        return sum(p["conditional_prob"] for p in paths if p["outcome"] == "RESTART")
    return sum(p["conditional_prob"] for p in paths if p["outcome"] == "TRUE_WIN")
```

### Step 2: Replace hardcoded 0.50 in `_attempt_settlement()`

Replace the hardcoded block with:
```python
from .v2_settlement import _survival_prob_from_paths, _get_paths

# Post-award, claimant lost: Q_ref uses actual survival from Scenario B
paths_b = _get_paths(getattr(MI, 'CURRENT_JURISDICTION', 'domestic'), arb_won=False)
post_challenge_survival = _survival_prob_from_paths(paths_b, scenario_b=True)
q_ref = soc_value_cr * eq_given_win * MI.RE_ARB_WIN_PROBABILITY * post_challenge_survival
```

**Note**: `MI.CURRENT_JURISDICTION` was added in Session 2A. If Session 2A hasn't been applied yet, add it now (see 2A instructions).

## MATHEMATICAL VERIFICATION

For domestic claim with SOC=1000 Cr:
- Before fix: Q_ref = 1000 × 0.72 × 0.70 × 0.50 = 252.0 Cr
- After fix: Q_ref = 1000 × 0.72 × 0.70 × 0.2966 = 149.5 Cr (41% lower — settlements for losers were overvalued)

For SIAC claim with SOC=1000 Cr:
- Before: Q_ref = 1000 × 0.72 × 0.70 × 0.50 = 252.0 Cr
- After: Q_ref = 1000 × 0.72 × 0.70 × 0.42 = 211.7 Cr (16% lower)

## TEST UPDATES

Update `test_settlement_math.py`:
- `TestReferenceQuantum::test_regime3_post_award_claimant_lost`: Change expected from 0.50 to jurisdiction-specific values
- Add parametrized test for all 3 jurisdictions
- Add `TestSurvivalProbFromPaths` class:
  - `test_scenario_a_counts_true_win_only`
  - `test_scenario_b_counts_restart`
  - `test_domestic_scenario_b_survival_0_2966`
  - `test_siac_scenario_b_survival_0_42`
  - `test_hkiac_scenario_b_survival_0_3133`

## DOCUMENTATION

Append Session 2B to `docs/PHASE_2_CHANGE_LOG.md`.

## VERIFICATION

1. Run settlement tests: `python -m pytest engine/tests/test_settlement_math.py -v`
2. Run regression tests: `python -m pytest engine/tests/test_regression_snapshot.py -v --tb=short`
3. Run full suite: `python -m pytest engine/tests/ -v -m "not slow" --tb=short`
4. If regression tests fail due to changed settlement amounts, update test tolerances with a comment explaining why values changed.
```

---

## Session 2C — Phase 2 Integration Verification & Documentation

### Prompt

```
You are a quantitative litigation finance expert completing Phase 2 of a 6-phase platform remediation plan.

## YOUR TASK

Run the full integration validation of Phase 2 fixes (Sessions 2A + 2B), ensure all tests pass, update regression baselines, and produce final Phase 2 documentation.

## CONTEXT — READ THESE FILES FIRST

1. `AGENT_CONTEXT_GUIDE.md`
2. `docs/PHASE_2_CHANGE_LOG.md` — Sessions 2A and 2B changes
3. `docs/PHASE_1_KNOWN_BUGS.md` — Bug IDs being fixed
4. `engine/v2_core/v2_monte_carlo.py` — Verify 2A+2B changes are applied
5. `engine/adapter.py` — Verify ramp wiring from 2A
6. `engine/v2_core/v2_settlement.py` — Verify survival fix from 2B

## TASKS

### 1. Verify All Phase 2 Changes Applied

Read the modified files and confirm:
- [ ] `adapter.py`: `_patch_mi_from_claim` calls `compute_settlement_discount_ramp()` and populates `MI.SETTLEMENT_STAGE_DISCOUNT_FACTORS`
- [ ] `adapter.py`: `MI.CURRENT_JURISDICTION` is set during claim patching
- [ ] `v2_monte_carlo.py`: `_attempt_settlement()` checks `MI.SETTLEMENT_MODE` and dispatches to game-theoretic or user-specified
- [ ] `v2_monte_carlo.py`: `post_challenge_survival` uses actual path table values, not 0.50
- [ ] `v2_settlement.py`: `_survival_prob_from_paths()` handles Scenario B (counts RESTART)
- [ ] `v2_master_inputs.py`: `CURRENT_JURISDICTION = "domestic"` default added

### 2. Run Full Test Suite

```bash
python -m pytest engine/tests/ -v --tb=short 2>&1 | tee test_outputs/phase2_final.txt
```

### 3. Update Regression Baselines

If `test_regression_snapshot.py` tests fail because settlement amounts changed (expected — the fix changes settlement pricing):
- Recalculate expected ranges analytically
- Update test assertions with new mathematically-derived values
- Document EVERY change with a comment: `# Updated Phase 2: δ now uses ramp (was 0.30 floor)`

### 4. Run End-to-End Pipeline

```bash
python -m engine.run_v2 --config engine/tests/test_tata_portfolio.json --output-dir test_outputs/phase2_verification --n 500 --seed 42
```

Verify the pipeline completes and JSON output is valid.

### 5. Documentation

**Update `docs/PHASE_2_CHANGE_LOG.md`**:
- Session 2C: Integration verification results
- Final test counts: total pass/fail/skip
- Mathematical verification summary

**Update `docs/PHASE_1_KNOWN_BUGS.md`**:
- Mark SETTLE-001 as FIXED (Phase 2, Session 2B)
- Mark SETTLE-002 as FIXED (Phase 2, Session 2B)
- Mark Bug 2 (discount ramp) as FIXED (Phase 2, Session 2A)
- Mark Bug 3 (game-theoretic dead code) as FIXED (Phase 2, Session 2A)

**Update `AGENT_CONTEXT_GUIDE.md`**:
- Add note in the Settlement section: "Phase 2 applied: discount ramp wired, game-theoretic mode active, survival probabilities jurisdiction-specific"

## VERIFICATION

All tests pass. Pipeline runs. Documentation updated. Phase 2 complete.
```

---

## Files Modified by Phase 2

| Session | Files Modified | Files Created |
|---------|---------------|---------------|
| 2A | `engine/adapter.py`, `engine/v2_core/v2_monte_carlo.py`, `engine/v2_core/v2_master_inputs.py`, `engine/tests/test_settlement_math.py` | `docs/PHASE_2_CHANGE_LOG.md` |
| 2B | `engine/v2_core/v2_monte_carlo.py`, `engine/v2_core/v2_settlement.py`, `engine/tests/test_settlement_math.py` | — |
| 2C | `engine/tests/test_regression_snapshot.py` (baseline updates), `docs/PHASE_1_KNOWN_BUGS.md`, `AGENT_CONTEXT_GUIDE.md` | — |
