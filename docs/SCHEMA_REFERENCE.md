# Schema Reference

**Auto-generated:** 2026-03-20 07:19
**Source:** `engine/config/schema.py`

Total Pydantic models: **23**

## `QuantumBand`

A single quantum band — fraction-of-SOC range with discrete probability.

| Field | Type |
|-------|------|
| `low` | `float` |
| `high` | `float` |
| `probability` | `float` |

**Validators:** `_low_lt_high` (model_validator)

---

## `QuantumConfig`

Quantum band configuration — conditional on arbitration WIN.

| Field | Type |
|-------|------|
| `bands` | `list[QuantumBand]` |
| `expected_quantum_pct (computed)` | `property` |

**Validators:** `_probs_sum_to_one` (field_validator)

---

## `TreeNode`

A single node in a jurisdiction challenge tree.

| Field | Type |
|-------|------|
| `name` | `str` |
| `probability` | `float` |
| `children` | `list["TreeNode"]` |
| `outcome` | `Optional[Literal["TRUE_WIN", "RESTART", "LOSE"]]` |
| `duration_distribution` | `Optional[dict[str, Any]]` |
| `legal_cost` | `Optional[dict[str, float]]` |

**Validators:** `_leaf_or_interior` (model_validator), `_children_probs_sum` (model_validator)

---

## `ScenarioTree`

One scenario (A or B) of a jurisdiction challenge tree.

| Field | Type |
|-------|------|
| `root` | `TreeNode` |
| `description` | `str` |

**Validators:** `_terminal_probs_sum` (model_validator)

---

## `ChallengeTreeConfig`

Complete challenge tree with both post-arbitration scenarios.

| Field | Type |
|-------|------|
| `scenario_a` | `ScenarioTree` |
| `scenario_b` | `ScenarioTree` |

**Validators:** `_scenario_a_no_restart` (model_validator), `_scenario_b_no_true_win` (model_validator)

---

## `StageConfig`

Duration and cost parameters for a single arbitration/court stage.

| Field | Type |
|-------|------|
| `name` | `str` |
| `duration_low` | `float` |
| `duration_high` | `float` |
| `legal_cost_low` | `float` |
| `legal_cost_high` | `float` |

**Validators:** `_low_le_high` (model_validator)

---

## `TimelineConfig`

Timeline parameters for pre-arbitration stages and payment collection.

| Field | Type |
|-------|------|
| `pre_arb_stages` | `list[StageConfig]` |
| `payment_delay_months` | `float` |
| `max_horizon_months` | `int` |

---

## `LegalCostConfig`

Legal cost structure for a claim.

| Field | Type |
|-------|------|
| `one_time_tribunal_cr` | `float` |
| `one_time_expert_cr` | `float` |
| `per_stage_costs` | `dict[str, StageConfig]` |
| `overrun_alpha` | `float` |
| `overrun_beta` | `float` |
| `overrun_low` | `float` |
| `overrun_high` | `float` |

**Validators:** `_overrun_range` (model_validator)

---

## `InterestConfig`

Pre/post-award interest accrual configuration.

| Field | Type |
|-------|------|
| `enabled` | `bool` |
| `rate` | `float` |
| `compounding` | `Literal["simple", "compound"]` |
| `commencement_date` | `Optional[str]` |

---

## `ArbitrationConfig`

Core arbitration outcome probabilities.

| Field | Type |
|-------|------|
| `win_probability` | `float` |
| `re_arb_win_probability` | `float` |

---

## `ClaimConfig`

Full configuration for a single arbitration claim.

| Field | Type |
|-------|------|
| `id` | `str` |
| `name` | `str` |
| `claimant` | `str` |
| `respondent` | `str` |
| `jurisdiction` | `str` |
| `claim_type` | `str` |
| `soc_value_cr` | `float` |
| `currency` | `str` |
| `claimant_share_pct` | `float` |
| `current_stage` | `str` |
| `perspective` | `Literal["claimant", "respondent"]` |
| `arbitration` | `ArbitrationConfig` |
| `quantum` | `QuantumConfig` |
| `challenge_tree` | `ChallengeTreeConfig` |
| `timeline` | `TimelineConfig` |
| `legal_costs` | `LegalCostConfig` |
| `interest` | `InterestConfig` |
| `no_restart_mode` | `bool` |
| `description` | `str` |

---

## `_GridRange`

Defines a numeric range with step size for grid generation.

| Field | Type |
|-------|------|
| `min` | `float` |
| `max` | `float` |
| `step` | `float` |

**Validators:** `_min_le_max` (model_validator)

---

## `LitFundingParams`

Litigation funding waterfall parameters.

| Field | Type |
|-------|------|
| `cost_multiple_cap` | `float` |
| `award_ratio_cap` | `float` |
| `waterfall_type` | `Literal["min", "max"]` |
| `cost_multiple_range` | `_GridRange` |
| `award_ratio_range` | `_GridRange` |

---

## `FullPurchaseParams`

Full claim purchase (monetisation) parameters.

| Field | Type |
|-------|------|
| `purchase_prices` | `list[float]` |
| `pricing_basis` | `Literal["soc", "ev"]` |
| `legal_cost_bearer` | `Literal["investor", "claimant", "shared"]` |
| `investor_cost_share_pct` | `float` |
| `purchased_share_pct` | `float` |

---

## `UpfrontTailParams`

Upfront payment + tail (success fee) monetisation parameters.

| Field | Type |
|-------|------|
| `upfront_range` | `_GridRange` |
| `tail_range` | `_GridRange` |
| `pricing_basis` | `Literal["soc", "ev", "both"]` |

---

## `MilestonePayment`

A single milestone-triggered payment in a staged acquisition.

| Field | Type |
|-------|------|
| `milestone_name` | `str` |
| `payment_cr` | `float` |

---

## `StagedPaymentParams`

Staged (milestone-based) claim acquisition parameters.

| Field | Type |
|-------|------|
| `milestones` | `list[MilestonePayment]` |
| `legal_cost_bearer` | `Literal["investor", "claimant", "shared"]` |
| `purchased_share_pct` | `float` |

---

## `PortfolioStructure`

Investment structure selection and parameters.

| Field | Type |
|-------|------|
| `type` | `Literal[
        "litigation_funding",
        "monetisation_full_purchase",
        "monetisation_upfront_tail",
        "monetisation_staged",
        "comparative",
    ]` |
| `params` | `Optional[
        Union[LitFundingParams, FullPurchaseParams, UpfrontTailParams, StagedPaymentParams]
    ]` |
| `lit_funding_params` | `Optional[LitFundingParams]` |
| `monetisation_params` | `Optional[
        Union[FullPurchaseParams, UpfrontTailParams, StagedPaymentParams]
    ]` |

**Validators:** `_validate_structure` (model_validator)

---

## `SimulationConfig`

Monte Carlo simulation engine settings.

| Field | Type |
|-------|------|
| `n_paths` | `int` |
| `seed` | `int` |
| `discount_rate` | `float` |
| `risk_free_rate` | `float` |
| `start_date` | `str` |

---

## `PortfolioConfig`

Complete portfolio definition — claims + structure + simulation settings.

| Field | Type |
|-------|------|
| `id` | `str` |
| `name` | `str` |
| `claim_ids` | `list[str]` |
| `structure` | `PortfolioStructure` |
| `simulation` | `SimulationConfig` |

---

## `PathResult`

Per-path, per-claim simulation output record.

| Field | Type |
|-------|------|
| `outcome` | `str` |
| `quantum_cr` | `float` |
| `quantum_pct` | `float` |
| `timeline_months` | `float` |
| `legal_costs_cr` | `float` |
| `collected_cr` | `float` |
| `challenge_path_id` | `str` |
| `stages_traversed` | `list[str]` |
| `band_idx` | `int` |
| `interest_cr` | `float` |

---

## `GridCellMetrics`

Aggregated metrics for one cell of an investment parameter grid.

| Field | Type |
|-------|------|
| `mean_moic` | `float` |
| `median_moic` | `float` |
| `mean_xirr` | `float` |
| `p_loss` | `float` |
| `p_hurdle` | `float` |
| `var_1` | `float` |
| `cvar_1` | `float` |
| `per_claim` | `dict[str, dict[str, Any]]` |

---

## `JurisdictionTemplate`

Jurisdiction template — pre-built defaults for a specific legal system.

| Field | Type |
|-------|------|
| `id` | `str` |
| `name` | `str` |
| `description` | `str` |
| `country` | `str` |
| `institution` | `str` |
| `default_challenge_tree` | `ChallengeTreeConfig` |
| `default_timeline` | `TimelineConfig` |
| `default_legal_costs` | `LegalCostConfig` |
| `default_payment_delay_months` | `float` |
| `supports_restart` | `bool` |
| `enforcement_notes` | `str` |

---
