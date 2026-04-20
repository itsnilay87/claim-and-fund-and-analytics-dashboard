# Phase 3 — Settlement Bugs 5, 6 + Known Outcomes Conditional Math

> **Purpose**: Fix the mathematical model deficiencies in the backward induction engine: replace uniform per-stage survival with actual tree probabilities, add respondent legal costs to make Nash Bargaining meaningful, and fix known outcomes conditional probability logic.
>
> **Prerequisites**: Phase 2 complete (discount ramp wired, game-theoretic mode active, survival probabilities fixed).
>
> **Implementation Standard**: These changes rewrite the core game theory — the math must be derived from first principles with full analytical verification. Industry-standard Nash Bargaining Solution applied correctly.

---

## Session Architecture

Phase 3 has **4 sessions** (3A–3D).

### Cross-Session Context

Every session reads:
1. `AGENT_CONTEXT_GUIDE.md`
2. `docs/PHASE_1_KNOWN_BUGS.md` — SETTLE-003, SETTLE-004, SETTLE-005
3. `docs/PHASE_2_CHANGE_LOG.md` — What Phase 2 fixed
4. `docs/PHASE_3_CHANGE_LOG.md` — Running log (created by Session 3A)

---

## Session 3A — Replace Uniform Survival with Actual Tree Transition Probabilities (SETTLE-003)

### Prompt

```
You are a quantitative litigation finance expert and game theorist implementing Phase 3, Session 3A of a 6-phase platform remediation plan.

## YOUR TASK

Replace the uniform per-stage survival approximation `p_win^(1/N)` in `compute_continuation_values()` with actual stage-specific transition probabilities extracted from the challenge tree.

## CONTEXT — READ THESE FILES FIRST

1. `AGENT_CONTEXT_GUIDE.md`
2. `docs/PHASE_1_KNOWN_BUGS.md` — SETTLE-003 specification
3. `docs/PHASE_2_CHANGE_LOG.md` — Phase 2 changes applied
4. `engine/v2_core/v2_settlement.py` — Full file. Focus on `compute_continuation_values()`
5. `engine/v2_core/v2_master_inputs.py` — DOMESTIC_PATHS_A/B, SIAC_PATHS_A/B (full path tables)
6. `engine/v2_core/v2_probability_tree.py` — Understand tree level structure
7. `engine/config/schema.py` — ChallengeTreeConfig, TreeNode, StageConfig
8. `engine/tests/test_settlement_math.py` — TestContinuationValues class

## THE MATHEMATICAL PROBLEM

### Current (buggy) approach:
```
per_stage_survival = P(overall_win)^(1/N_stages)
V_C(stage_i) = per_stage_survival^(N-i) × Q_ref
```

This distributes survival uniformly. But the actual challenge tree has HIGHLY non-uniform stage risks.

### Correct approach:

Extract per-stage conditional survival probabilities from the path tables:

**Indian Domestic Scenario A** (arb won, respondent challenges):
- Stage S.34: P(survive S.34) = P(S.34 dismissed) + P(S.34 admitted × award restored at S.37) + ...
  - Direct: P(S.34 dismissed) = 0.30 → auto TRUE_WIN
  - Admitted (0.70): need to survive S.37
  - **P(survive from S.34 onward)** = sum of all TRUE_WIN paths = 0.7360
- Stage S.37 (given admitted at S.34): P(survive S.37 | admitted)
  - S.37 dismissed = 0.50 → TRUE_WIN (prob from S.37 onward)
  - S.37 admitted: need to survive SLP
  - **P(survive from S.37 | admitted at S.34)** = compute from remaining paths
- Stage SLP (given admitted at S.37): P(SLP dismissed | admitted at S.37)
  - SLP ranges: dismissed prob varies by path (0.10 to 0.50)

### Implementation Strategy

Instead of computing per-stage conditional probabilities (which is complex due to tree branching), use a **direct backward induction on the path table**:

```python
def compute_continuation_values(jurisdiction, arb_won, expected_quantum_cr, soc_value_cr):
    stages = _get_stages(jurisdiction)
    paths = _get_paths(jurisdiction, arb_won)
    
    if arb_won is None:
        # Pre-award: same as before
        ...
    
    if arb_won:
        q_ref = expected_quantum_cr
    else:
        eq_frac = _expected_quantum_fraction()
        q_ref = soc_value_cr * eq_frac * MI.RE_ARB_WIN_PROBABILITY
    
    # For each stage s, V_C(s) = Σ over paths that reach stage s of:
    #   P(path outcome | reached stage s) × payoff(outcome)
    #
    # Payoff(TRUE_WIN) = q_ref
    # Payoff(RESTART) = q_ref × P(re-arb win) for Scenario B
    # Payoff(LOSE) = 0
    
    result = {}
    for i, stage in enumerate(stages):
        # Sum probability of favorable outcomes from this stage forward
        # relative to reaching this stage
        p_favorable = _survival_from_stage(paths, stage, stages, arb_won)
        v_c = p_favorable * q_ref
        result[stage] = {"v_claimant": v_c, "v_respondent": v_c}  # V_R fix in Session 3B
    
    return result
```

Write `_survival_from_stage()` that:
1. Identifies which paths "pass through" a given stage (based on the path's route)
2. Among those paths, computes the conditional probability of a favorable outcome
3. Returns this conditional survival probability

**Key insight**: The flat path tables use **implicit boolean fields** to identify which stages a path passes through:
- **Domestic**: `s34_tata_wins` (bool), `s37_tata_wins` (bool), `slp_admitted` (bool), `slp_merits_tata_wins` (bool), plus per-stage conditional probabilities `s34_prob`, `s37_prob`, `slp_gate_prob`, `slp_merits_prob`
- **SIAC**: `hc_tata_wins` (bool), `coa_tata_wins` (bool), plus `hc_prob`, `coa_prob`
- **HKIAC**: Similar boolean outcome fields per stage

A path "passes through" stage S if it is NOT terminated (won/lost) at an earlier stage. Use the boolean outcome fields and conditional probabilities to determine which paths reach each stage and their outcomes from that point forward.

**There is NO `stages_detail` field** — stage identification is implicit via the boolean outcome columns.

Also add a helper `_expected_stage_duration_months(stage)` that returns the mean expected duration for each challenge stage, using the constants from `v2_master_inputs.py`:

```python
_STAGE_DURATION_MONTHS: dict[str, float] = {
    "s34": (MI.S34_DURATION["low"] + MI.S34_DURATION["high"]) / 2.0,   # 13.5
    "s37": (MI.S37_DURATION["low"] + MI.S37_DURATION["high"]) / 2.0,   # 9.0
    "slp": (MI.SLP_DISMISSED_DURATION + MI.SLP_ADMITTED_DURATION) / 2.0,# 14.0
    "hc":  MI.SIAC_HC_DURATION,                                         # 6.0
    "coa": MI.SIAC_COA_DURATION,                                         # 6.0
    "cfi": (MI.HK_CFI_DURATION["low"] + MI.HK_CFI_DURATION["high"]) / 2.0, # 9.0
    "ca":  (MI.HK_CA_DURATION["low"] + MI.HK_CA_DURATION["high"]) / 2.0,   # 7.5
}

def _expected_stage_duration_months(stage: str) -> float:
    return _STAGE_DURATION_MONTHS.get(stage, 12.0)  # 12-month fallback
```

This helper is used by Session 3B's time-value discounting in the backward induction. Add it now to keep the diff focused per session.

### ANALYTICAL VERIFICATION VALUES

Compute these by hand from the path tables and hardcode as test expectations:

**Domestic Scenario A** (arb_won=True, Q_ref = eq_cr):
- V_C(s34) = 0.7360 × Q_ref (full tree survival)
- V_C(s37|admitted) = need to compute from paths that survive S.34
- V_C(slp|admitted at s37) = need to compute from paths that survive S.37

**SIAC Scenario A** (arb_won=True):
- V_C(hc) = 0.8200 × Q_ref
- V_C(coa|challenged at hc) = compute from paths that survive HC

## IMPLEMENTATION INSTRUCTIONS

### Modify: `engine/v2_core/v2_settlement.py`

1. Add new helper `_survival_from_stage(paths, stage_name, all_stages, arb_won)` 
2. Rewrite `compute_continuation_values()` to use actual path-based computation
3. Keep the function signature identical — callers don't change

### Add Tests: `engine/tests/test_settlement_math.py`

Add to `TestContinuationValues`:
- `test_domestic_v_c_s34_matches_total_survival`: V_C(s34)/Q_ref = 0.7360
- `test_siac_v_c_hc_matches_total_survival`: V_C(hc)/Q_ref = 0.8200
- `test_later_stages_higher_survival`: V_C(slp) > V_C(s37) > V_C(s34) (monotonic)
- `test_scenario_b_uses_restart_survival`: Scenario B V_C uses RESTART probability

### Create: `docs/PHASE_3_CHANGE_LOG.md`

## VERIFICATION

Run tests, confirm all pass, update documentation.
```

---

## Session 3B — Respondent Legal Cost Model + Asymmetric NBS (SETTLE-004, SETTLE-005)

### Prompt

```
You are a quantitative litigation finance expert and game theorist implementing Phase 3, Session 3B.

## YOUR TASK

Fix SETTLE-004 (V_R = V_C symmetric model) and SETTLE-005 (bargaining power α irrelevant). Implement proper respondent continuation values and make Nash Bargaining Solution asymmetric.

## CONTEXT — READ THESE FILES FIRST

1. `AGENT_CONTEXT_GUIDE.md`
2. `docs/PHASE_1_KNOWN_BUGS.md` — SETTLE-004, SETTLE-005
3. `docs/PHASE_3_CHANGE_LOG.md` — Session 3A changes
4. `engine/v2_core/v2_settlement.py` — Focus on V_R computation in `compute_continuation_values()`
5. `engine/v2_core/v2_master_inputs.py` — `SETTLEMENT_RESPONDENT_LEGAL_COST_CR`, `SETTLEMENT_BARGAINING_POWER`, stage duration constants (S34_DURATION, S37_DURATION, etc.)
6. `engine/v2_core/v2_legal_cost_model.py` — How claimant's costs are computed (to estimate respondent's)
7. `engine/config/schema.py` — `SettlementConfig.respondent_legal_cost_cr`, `SimulationConfig.risk_free_rate`
8. `docs/methodology/05_SETTLEMENT_MODEL.md` §4 — Time-discounted backward induction formulas

## THE MATHEMATICAL MODEL

### Nash Bargaining Solution (Correct Formulation)

The settlement price δ*_s at stage s satisfies:

```
δ*_s = argmax (U_C(δ) - d_C)^α × (U_R(δ) - d_R)^(1-α)
```

Where (per methodology doc 05_SETTLEMENT_MODEL.md §4):
- d_C = V_C(s) = claimant’s disagreement point (expected payoff minus remaining legal costs)
- d_R = -V_R(s) = respondent’s disagreement point (expected liability plus remaining legal costs)

The **surplus** (bargaining zone) is:
```
Π(s) = V_R(s) - V_C(s) = LC_C_remaining(s) + LC_R_remaining(s)
```

Both sides’ avoided legal costs drive the surplus — NOT just the respondent’s.

The NBS settlement amount is:
```
S* = V_C(s) + α × Π(s) = V_C(s) + α × (LC_C_remaining(s) + LC_R_remaining(s))
```

As discount factor:
```
δ*(s) = S* / Q_ref
```

### Computing Continuation Values (Backward Induction with Time-Value Discounting)

Per methodology §4, future continuation values are discounted to present value at the risk-free rate. Each backward step applies:

```
df(s) = exp(-r_f × Δt_s / 12)
```

where `r_f` = `SimulationConfig.risk_free_rate` (default 0.07) and `Δt_s` = expected stage duration in months (from `_expected_stage_duration_months(stage)` added in Session 3A).

The full backward induction:
```
V_C(s) = P(survive_s) × V_C(s+1) × df(s) - LC_C(s)
V_R(s) = P(survive_s) × V_R(s+1) × df(s) + LC_R(s)
```

Note the asymmetry: claimant PAYS legal costs (subtracted), respondent ALSO pays legal costs (added to what they owe). The discount factor `df(s)` applies to the **next-stage continuation value** only — legal costs are incurred now and not discounted.

So the surplus at each stage is:
```
Π(s) = V_R(s) - V_C(s) = Σ [LC_C(k) + LC_R(k)] for k = s to terminal
        + discounting effects on continuation values
```

**Key insight**: Time-discounting slightly reduces `V_C(s)` (claimant's value of continuing), expanding the bargaining zone. This makes settlement more attractive relative to litigation — which is economically correct. When `r_f = 0`, formulas reduce to the undiscounted case.

### Computing Respondent Legal Costs

Option A (from config): Use `SETTLEMENT_RESPONDENT_LEGAL_COST_CR` if provided, distributed proportionally across remaining stages
Option B (estimate): If None, estimate as `1.0 × claimant_remaining_costs` (symmetric assumption as baseline; respondent typically spends 1.0–1.5× what claimant spends)

Per-stage remaining cost decomposition:
- At stage s, remaining_stages = stages from s to end
- Estimated remaining cost for each party = Σ (per_stage_cost × expected_remaining_duration)

### Implementation

Rewrite `compute_continuation_values()` to compute V_C and V_R via proper backward induction with time-value discounting:

```python
def compute_continuation_values(
    jurisdiction, arb_won, expected_quantum_cr, soc_value_cr,
    risk_free_rate: float = 0.07,  # from SimulationConfig.risk_free_rate
    respondent_legal_cost_cr: Optional[float] = None,
):
    stages = _get_stages(jurisdiction)
    paths = _get_paths(jurisdiction, arb_won)
    
    # Terminal values
    p_win_terminal = _survival_prob_from_paths(paths, ...)
    v_c_next = p_win_terminal * q_ref  # Terminal claimant value
    v_r_next = p_win_terminal * q_ref  # Terminal respondent value (same at terminal)
    
    result = {}
    for i, stage in enumerate(reversed(stages)):
        # Per-stage legal costs
        lc_c = _get_claimant_stage_cost(stage)
        lc_r = _get_respondent_stage_cost(stage, respondent_legal_cost_cr)
        
        stage_survival = _survival_from_stage(paths, stage, stages, arb_won)
        
        # Time-value discount factor (per methodology §4)
        dt_months = _expected_stage_duration_months(stage)
        df = math.exp(-risk_free_rate * dt_months / 12.0)
        
        # Backward induction with time-discounting:
        v_c = stage_survival * v_c_next * df - lc_c  # Claimant PAYS costs now
        v_r = stage_survival * v_r_next * df + lc_r  # Respondent costs add to liability
        
        result[stage] = {"v_claimant": v_c, "v_respondent": v_r}
        v_c_next, v_r_next = v_c, v_r

def _get_respondent_stage_cost(stage, respondent_total_cr):
    if respondent_total_cr is not None:
        return respondent_total_cr / n_stages  # Distribute evenly
    else:
        return _get_claimant_stage_cost(stage) * 1.0  # Symmetric estimate
```

**Note on `risk_free_rate` parameter**: Read from `MI.RISK_FREE_RATE` (default 0.07, set by `run_v2.py` from `SimulationConfig.risk_free_rate`). Both `compute_game_theoretic_discounts()` and `compute_continuation_values()` must accept and forward this parameter. When callers don't provide it, the default of 0.07 (7% annual) applies. When `risk_free_rate = 0.0`, the discount factor equals 1.0 and the model reduces to the undiscounted case.

**IMPORTANT — Update the call site in `v2_monte_carlo.py`**: Phase 2A added the call to `compute_game_theoretic_discounts()` inside `_attempt_settlement()`. You MUST update that call to also pass `risk_free_rate=MI.RISK_FREE_RATE`. The updated call should be:
```python
gt_discounts = compute_game_theoretic_discounts(
    jurisdiction=getattr(MI, 'CURRENT_JURISDICTION', 'domestic'),
    arb_won=arb_won,
    expected_quantum_cr=eq_cr,
    soc_value_cr=soc_value_cr,
    bargaining_power=MI.SETTLEMENT_BARGAINING_POWER,
    risk_free_rate=MI.RISK_FREE_RATE,
)
```

In `compute_game_theoretic_discounts()`, the NBS formula:
```python
surplus = v_r - v_c  # = Σ(LC_C + LC_R) for remaining stages
s_star = v_c + alpha * surplus
delta_star = s_star / q_ref
```

With surplus from BOTH sides' legal costs, α now matters:
- α = 0.5: S* = V_C + 0.5 × (LC_C + LC_R) — split surplus equally
- α = 0.7: S* shifts toward claimant (gets 70% of surplus)
- α = 0.3: S* shifts toward respondent (claimant gets only 30%)

## TESTS

Add to `test_settlement_math.py`:

```python
class TestAsymmetricNBS:
    """Verify Nash Bargaining with V_R ≠ V_C and surplus = LC_C + LC_R."""
    
    def test_v_r_greater_than_v_c(self):
        """Respondent's continuation includes added legal costs → V_R > V_C."""
    
    def test_surplus_equals_total_avoided_costs(self):
        """Π(s) = V_R(s) - V_C(s) = Σ(LC_C + LC_R) for remaining stages."""
    
    def test_alpha_0_5_splits_surplus_equally(self):
        """α=0.5 → S* = V_C + 0.5 × Π."""
    
    def test_alpha_0_7_shifts_toward_claimant(self):
        """Higher α → higher S* (claimant captures more surplus)."""
    
    def test_alpha_0_3_shifts_toward_respondent(self):
        """Lower α → lower S* (respondent retains more surplus)."""
    
    def test_alpha_sensitivity_monotonic(self):
        """δ*(α=0.7) > δ*(α=0.5) > δ*(α=0.3)."""
    
    def test_respondent_cost_increases_surplus(self):
        """Higher respondent legal costs → larger Π → higher δ*."""
    
    def test_claimant_cost_also_increases_surplus(self):
        """Higher claimant legal costs → larger Π → higher δ* (both sides contribute to surplus)."""


class TestTimeValueDiscounting:
    """Verify risk-free rate discounting in backward induction."""
    
    def test_discount_reduces_continuation_value(self):
        """V_C with r_f=0.07 < V_C with r_f=0.0 for all stages."""
    
    def test_zero_rate_equals_undiscounted(self):
        """risk_free_rate=0.0 produces identical results to no-discount model."""
    
    def test_earlier_stages_more_discounted(self):
        """Discount effect is larger for earlier stages (more time to terminal)."""
    
    def test_discount_expands_bargaining_zone(self):
        """Π(s, r_f=0.07) > Π(s, r_f=0.0) — discounting increases surplus."""
    
    def test_discount_factor_formula(self):
        """Verify df = exp(-r_f × dt_months / 12) for each stage."""
```

## DOCUMENTATION

Append Session 3B to `docs/PHASE_3_CHANGE_LOG.md`.

## VERIFICATION

All tests pass. α now affects settlement pricing. V_R > V_C for all stages.
```

---

## Session 3C — Known Outcomes: Conditional Tree Traversal (TREE-001)

### Prompt

```
You are a quantitative litigation finance expert and probability theorist implementing Phase 3, Session 3C.

## YOUR TASK

Fix TREE-001 (S.34 forcing name mismatch) and ensure the known outcomes logic correctly truncates the probability tree to simulate "from this point forward" when partial results are known.

## CONTEXT — READ THESE FILES FIRST

1. `AGENT_CONTEXT_GUIDE.md`
2. `docs/PHASE_1_KNOWN_BUGS.md` — TREE-001
3. `docs/PHASE_3_CHANGE_LOG.md` — Sessions 3A-3B changes
4. `engine/models/probability_tree.py` — FULL read. Focus on:
   - `simulate_challenge_tree_with_known_outcomes()`
   - `_forced_child_domestic()`, `_forced_child_siac()`
   - How node labels are matched
5. `engine/config/schema.py` — `KnownOutcomes` fields (arb_outcome, s34_outcome, s37_outcome, slp_outcome, hc_outcome, coa_outcome)
6. `engine/v2_core/v2_monte_carlo.py` — How known_outcomes are consumed in `_simulate_claim_path()`
7. `engine/tests/test_known_outcomes.py` — Existing known outcome tests
8. `engine/tests/test_tree_verification.py` — TestKnownOutcomesLogic from Phase 1

## THE BUG

In `engine/models/probability_tree.py`, `_forced_child_domestic()`:
- The function receives `known_outcomes.s34_outcome` which is "dismissed" or "admitted"
- It tries to match this against tree node labels
- But the tree uses labels like "Respondent Fails S.34" and "Respondent Wins S.34"
- The matching logic doesn't map "dismissed" → "Respondent Fails" correctly
- Result: S.34 forcing silently fails, falls through to stochastic draw

## THE FIX

Create a mapping layer in `_forced_child_domestic()`:

```python
_DOMESTIC_S34_MAP = {
    "dismissed": ["Respondent Fails", "fails", "dismissed"],
    "admitted": ["Respondent Wins", "wins", "admitted"],
}
```

For each known outcome value, check if any of the mapped labels appear in the node's label (case-insensitive). Apply the same pattern for S.37, SLP, HC, COA levels.

## MATHEMATICAL IMPACT

When S.34 outcome is known:
- If dismissed: P(TRUE_WIN) = 1.0 (immediate win — no further challenge)
- If admitted: simulation continues from S.37 with conditional probabilities

Verify that forcing S.34="admitted" gives:
- P(TRUE_WIN|admitted at S.34) = (total TRUE_WIN paths that go through S.34 admitted) / (total prob of S.34 admitted paths)
- From domestic Scenario A path table: this should be calculable

## TESTS

Update `engine/tests/test_tree_verification.py::TestKnownOutcomesLogic`:
- `test_s34_dismissed_forces_true_win`: known S.34 dismissed → 100% TRUE_WIN
- `test_s34_admitted_continues_from_s37`: known S.34 admitted → correct conditional probs from S.37
- Parametrize across jurisdictions and stages

## DOCUMENTATION

Append Session 3C to `docs/PHASE_3_CHANGE_LOG.md`.
```

---

## Session 3D — Phase 3 Integration Verification & Documentation

### Prompt

```
You are a quantitative litigation finance expert completing Phase 3.

## YOUR TASK

Integration-test all Phase 3 changes (3A–3C), update regression baselines, and document Phase 3 completion.

## CONTEXT — READ THESE FILES FIRST

1. `AGENT_CONTEXT_GUIDE.md`
2. `docs/PHASE_3_CHANGE_LOG.md` — All Session 3A-3C changes
3. `docs/PHASE_1_KNOWN_BUGS.md` — Bugs being fixed

## TASKS

1. **Verify all changes applied**: Read modified files, confirm fixes are in place
2. **Run full test suite**: `python -m pytest engine/tests/ -v --tb=short -m "not slow"`
3. **Update regression baselines**: Settlement amounts change with proper NBS model (including time-value discounting). Update `test_regression_snapshot.py` expected ranges with analytical justification.
4. **Run E2E pipeline**: both with settlement disabled and enabled, verify outputs
5. **Mathematical sanity check**: For one domestic claim (Q_ref = 10.0 Cr, r_f = 0.07), hand-compute:
   - Stage durations: S.34 = 13.5mo, S.37 = 9.0mo, SLP = 14.0mo
   - Discount factors: df(s34) = exp(-0.07 × 13.5/12), df(s37) = exp(-0.07 × 9.0/12), df(slp) = exp(-0.07 × 14.0/12)
   - V_C(s34), V_C(s37), V_C(slp) using Phase 3A survival × 3B backward induction with discounting
   - V_R(s34), V_R(s37), V_R(slp) using Phase 3B formula with discounting
   - δ*(s34), δ*(s37), δ*(slp) using NBS with α=0.5
   - Verify these match engine output for the same claim
   - **Compare discounted vs undiscounted**: Run with r_f=0.0 and r_f=0.07 to confirm time-value impact is ~5-20% reduction in continuation values
6. **Update documentation**:
   - `docs/PHASE_1_KNOWN_BUGS.md`: Mark SETTLE-003, SETTLE-004, SETTLE-005, TREE-001 as FIXED
   - `docs/PHASE_3_CHANGE_LOG.md`: Final summary including time-value discounting feature
   - `AGENT_CONTEXT_GUIDE.md`: Update settlement section with current model description including time-discount

## VERIFICATION

All tests pass. Hand-computed NBS values match engine. Documentation complete.
```

---

## Files Modified by Phase 3

| Session | Files Modified | Files Created |
|---------|---------------|---------------|
| 3A | `engine/v2_core/v2_settlement.py`, `engine/tests/test_settlement_math.py` | `docs/PHASE_3_CHANGE_LOG.md` |
| 3B | `engine/v2_core/v2_settlement.py`, `engine/v2_core/v2_monte_carlo.py`, `engine/tests/test_settlement_math.py` | — |
| 3C | `engine/models/probability_tree.py`, `engine/tests/test_tree_verification.py` | — |
| 3D | `engine/tests/test_regression_snapshot.py`, `docs/PHASE_1_KNOWN_BUGS.md`, `AGENT_CONTEXT_GUIDE.md` | — |
