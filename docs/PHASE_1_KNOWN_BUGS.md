# Phase 1 — Known Bugs Catalog

> **Created**: Phase 1, Session 1E
> **Purpose**: Catalog ALL known bugs discovered/documented in Sessions 1A–1E. Each entry includes the module, current (buggy) behavior, expected (correct) behavior, mathematical impact, fix phase, and the test(s) that verify current behavior.

---

## Settlement Model Bugs

### SETTLE-001: Hardcoded `post_challenge_survival = 0.50`

| Field | Detail |
|-------|--------|
| **Module** | `engine/v2_core/v2_monte_carlo.py` → `_attempt_settlement()` |
| **Current behavior** | `post_challenge_survival` is hardcoded to `0.50` regardless of jurisdiction or challenge tree structure |
| **Expected behavior** | Should be computed from the analytical challenge tree: P(TRUE_WIN\|arb_won, ScenarioA) = 0.736 (domestic), 0.82 (SIAC), 0.811 (HKIAC) |
| **Mathematical impact** | Reference quantum for post-award losers (Q_ref regime 3) uses `SOC × E[q%] × 0.50` instead of the correct `SOC × E[q%] × P(TRUE_WIN\|ScB)`. This underestimates Q_ref for SIAC (0.42 vs 0.50) and overestimates for domestic (0.297 vs 0.50). Settlement amounts are correspondingly distorted by up to ~40%. |
| **Fix phase** | Phase 2 |
| **Verification test** | `test_settlement_math.py::TestReferenceQuantum::test_regime3_post_award_claimant_lost` |
| **Verified in** | Session 1A |

---

### SETTLE-002: `_survival_prob_from_paths()` only counts TRUE_WIN, ignores RESTART

| Field | Detail |
|-------|--------|
| **Module** | `engine/v2_core/v2_settlement.py` → `_survival_prob_from_paths()` |
| **Current behavior** | Scenario B survival probability only counts paths with outcome == "TRUE_WIN". Since Scenario B never has TRUE_WIN (structural invariant), survival = 0.0 for all Scenario B paths. |
| **Expected behavior** | Should count RESTART paths as "survival" (claimant recovers via re-arbitration), giving P(recovery\|ScB) = 0.297 (domestic), 0.42 (SIAC) |
| **Mathematical impact** | Continuation values for Scenario B collapse to zero → settlement discounts for post-award losers are incorrectly computed → game-theoretic settlement amounts for this regime are wrong |
| **Fix phase** | Phase 2 |
| **Verification test** | `test_settlement_math.py::TestContinuationValues::test_scenario_b_survival` |
| **Verified in** | Session 1A |

---

### SETTLE-003: Per-stage survival approximation uses `p_win^(1/N)` uniform approximation

| Field | Detail |
|-------|--------|
| **Module** | `engine/v2_core/v2_settlement.py` → `compute_continuation_values()` |
| **Current behavior** | Per-stage survival probability is approximated as `overall_p_win^(1/N_stages)`, distributing total survival uniformly across stages |
| **Expected behavior** | Stage-specific survival probabilities should be extracted from the challenge tree (e.g., P(survive S.34) = 0.30 dismissed + 0.70×0.50 S.37 survived = 0.65, not uniform) |
| **Mathematical impact** | For a 5-stage domestic tree with overall P=0.736, uniform gives `0.736^(1/5) ≈ 0.940` per stage. Real stage probabilities vary: P(S.34 dismissed) = 0.30, P(S.37 dismissed\|admitted) = 0.50, etc. Continuation values are smoothed/monotonic instead of reflecting actual stage-specific risk changes. |
| **Fix phase** | Phase 3 |
| **Verification test** | `test_settlement_math.py::TestContinuationValues::test_domestic_backward_induction` |
| **Verified in** | Session 1A |

---

### SETTLE-004: Symmetric respondent model (`V_R = V_C`)

| Field | Detail |
|-------|--------|
| **Module** | `engine/v2_core/v2_settlement.py` → `compute_continuation_values()` |
| **Current behavior** | Respondent's continuation value V_R is set equal to claimant's V_C at every stage |
| **Expected behavior** | V_R should be independently computed: V_R(s) = Q_ref − V_C(s) (respondent pays what claimant expects to receive). In Nash bargaining, claimant and respondent values should be complementary. |
| **Mathematical impact** | With V_R = V_C, the Nash bargaining formula `δ* = V_C / Q_ref` is correct only for the symmetric case. For the general case with bargaining power α ≠ 0.5, the formula should be `δ* = α × V_C + (1-α) × (Q_ref - V_R)` / Q_ref. Symmetric model makes this reduce to just `V_C/Q_ref` regardless of α. |
| **Fix phase** | Phase 3 |
| **Verification test** | `test_settlement_math.py::TestContinuationValues::test_respondent_value_equals_claimant` |
| **Verified in** | Session 1A |

---

### SETTLE-005: Bargaining power (α) is irrelevant in NBS

| Field | Detail |
|-------|--------|
| **Module** | `engine/v2_core/v2_settlement.py` → `compute_game_theoretic_discounts()` |
| **Current behavior** | The `bargaining_power` parameter (α) has no effect on computed discounts because V_R = V_C (see SETTLE-004), making the NBS formula degenerate |
| **Expected behavior** | α should shift settlement amounts: α > 0.5 favors claimant (higher settlement), α < 0.5 favors respondent (lower settlement) |
| **Mathematical impact** | Users who set α ≠ 0.5 expecting it to affect settlement pricing get no effect — misleading model output |
| **Fix phase** | Phase 3 (depends on SETTLE-004 fix) |
| **Verification test** | `test_settlement_math.py::TestNashBargaining::test_alpha_irrelevance_bug` |
| **Verified in** | Session 1A |

---

## Probability Tree Observations

### TREE-001: Domestic S.34 forcing name mismatch in known outcomes

| Field | Detail |
|-------|--------|
| **Module** | `engine/models/probability_tree.py` → `_forced_child_domestic()` |
| **Current behavior** | Tree uses node labels like "Respondent Fails S.34" / "Respondent Wins S.34", but the forcing logic looks for "dismissed" / "tata wins" — matching never engages for domestic S.34 level |
| **Expected behavior** | The forcing function should match the actual tree node labels, so `s34_outcome="dismissed"` correctly forces the S.34 dismissed branch |
| **Mathematical impact** | Known outcomes for S.34 stage do not take effect when specified via the platform-native tree — forcing falls through to stochastic draw. No impact when using V2 flat path tables directly. |
| **Fix phase** | Phase 3 (Session 3C) |
| **Verification test** | `test_tree_verification.py::TestKnownOutcomesLogic::test_forced_node_selection` |
| **Verified in** | Session 1C |

---

### TREE-002: HKIAC stored path probability rounding

| Field | Detail |
|-------|--------|
| **Module** | `engine/v2_core/v2_master_inputs.py` → `HKIAC_PATHS_A`, `HKIAC_PATHS_B` |
| **Current behavior** | HKIAC path conditional_prob values are stored with 4-digit precision, causing subtotals to differ from exact analytical values by ≤ 0.001 |
| **Expected behavior** | Path probabilities should sum to exactly 1.0 per scenario (within floating-point precision) |
| **Mathematical impact** | Negligible (≤ 0.1% error). The sum is 0.999 or 1.001 instead of exactly 1.000. |
| **Fix phase** | Phase 4 (low priority) |
| **Verification test** | `test_tree_verification.py::TestAnalyticalProbabilities::test_hkiac_a_path_count_and_prob_sum` |
| **Verified in** | Session 1C |

---

### TREE-003: SIAC challenge tree uses fixed 12-month durations

| Field | Detail |
|-------|--------|
| **Module** | V2 `simulate_siac_challenge()` |
| **Current behavior** | SIAC challenge paths always return exactly 12.0 months (HC=6 + COA=6), with no stochastic draw |
| **Expected behavior** | Duration should have some stochastic variation reflecting real-world timing uncertainty in Singapore High Court and Court of Appeal proceedings |
| **Mathematical impact** | Timeline distributions for SIAC claims have zero variance in the challenge phase — all paths take exactly 12 months. This understates timeline risk. |
| **Fix phase** | Phase 4 (enhancement) |
| **Verification test** | `test_tree_verification.py::TestStructuralInvariants::test_siac_timeline_deterministic` |
| **Verified in** | Session 1C |

---

## Summary

| Bug ID | Severity | Module | Fix Phase | Category |
|--------|----------|--------|-----------|----------|
| SETTLE-001 | High | v2_monte_carlo | Phase 2 | Settlement — hardcoded survival |
| SETTLE-002 | High | v2_settlement | Phase 2 | Settlement — survival counts |
| SETTLE-003 | Medium | v2_settlement | Phase 3 | Settlement — stage approximation |
| SETTLE-004 | Medium | v2_settlement | Phase 3 | Settlement — symmetric model |
| SETTLE-005 | Medium | v2_settlement | Phase 3 | Settlement — α irrelevant |
| TREE-001 | Low | probability_tree | Phase 3 | Tree — forcing name mismatch |
| TREE-002 | Low | v2_master_inputs | Phase 4 | Tree — rounding precision |
| TREE-003 | Low | simulate_siac | Phase 4 | Tree — fixed duration |

**Phase 2 fixes** (settlement critical bugs): SETTLE-001, SETTLE-002
**Phase 3 fixes** (settlement model improvements + tree forcing): SETTLE-003, SETTLE-004, SETTLE-005, TREE-001
**Phase 4 fixes** (tree & duration enhancements): TREE-002, TREE-003
