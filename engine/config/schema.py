"""
engine/config/schema.py — Pydantic v2 schema definitions for the Claim Analytics Platform.
===========================================================================================

This is the canonical data contract for the entire platform.  Every JSON payload,
engine configuration, simulation result, and jurisdiction template conforms to
one of the models defined here.

All monetary values are in the claim's native currency (default ₹ Crore).
All durations are in months unless otherwise noted.

Validation philosophy:
  • Catch structural errors at parse time (missing fields, wrong types).
  • Catch domain errors via field_validator / model_validator decorators
    (probability sums, low < high, outcome constraints per scenario).
  • Provide human-readable error messages that include field context.
"""

from __future__ import annotations

from typing import Any, Literal, Optional, Union

from pydantic import (
    BaseModel,
    Field,
    computed_field,
    field_validator,
    model_validator,
)


# ============================================================================
# 1. QuantumBand
# ============================================================================

class QuantumBand(BaseModel):
    """A single quantum band — fraction-of-SOC range with discrete probability.

    Within a band the MC engine draws Uniform(low, high) as the quantum
    percentage of SOC.
    """

    low: float = Field(
        ..., ge=0.0, le=1.0,
        description="Lower bound of quantum band as fraction of SOC (0-1).",
    )
    high: float = Field(
        ..., ge=0.0, le=1.0,
        description="Upper bound of quantum band as fraction of SOC (0-1).",
    )
    probability: float = Field(
        ..., ge=0.0, le=1.0,
        description="Discrete probability weight for this band (0-1).",
    )

    @model_validator(mode="after")
    def _low_lt_high(self) -> "QuantumBand":
        if self.low >= self.high:
            raise ValueError(
                f"QuantumBand: low ({self.low}) must be strictly less than high ({self.high})."
            )
        return self

    model_config = {
        "json_schema_extra": {
            "examples": [{"low": 0.80, "high": 1.00, "probability": 0.70}]
        }
    }


# ============================================================================
# 2. QuantumConfig
# ============================================================================

class QuantumConfig(BaseModel):
    """Quantum band configuration — conditional on arbitration WIN.

    The MC engine selects one band by multinomial draw, then draws
    Uniform(low, high) within the selected band.
    """

    bands: list[QuantumBand] = Field(
        ..., min_length=1,
        description="Quantum bands as fractions of SOC. Probabilities must sum to 1.0.",
    )

    @field_validator("bands")
    @classmethod
    def _probs_sum_to_one(cls, bands: list[QuantumBand]) -> list[QuantumBand]:
        total = sum(b.probability for b in bands)
        if abs(total - 1.0) > 1e-4:
            raise ValueError(
                f"QuantumConfig: band probabilities sum to {total:.6f}, must equal 1.0 (±1e-4)."
            )
        return bands

    @computed_field
    @property
    def expected_quantum_pct(self) -> float:
        """E[Q|WIN] — probability-weighted midpoint of all bands."""
        return sum(
            b.probability * (b.low + b.high) / 2.0 for b in self.bands
        )


# ============================================================================
# 3. TreeNode (recursive)
# ============================================================================

class TreeNode(BaseModel):
    """A single node in a jurisdiction challenge tree.

    Leaf nodes carry an ``outcome``; interior nodes carry ``children``.
    This is a generic recursive structure that works for any jurisdiction —
    Indian domestic (S.34 → S.37 → SLP) or SIAC (HC → COA) or future trees.
    """

    name: str = Field(
        ..., min_length=1,
        description="Human-readable stage/decision name, e.g. 'S.34', 'SLP Gate'.",
    )
    probability: float = Field(
        ..., ge=0.0, le=1.0,
        description="Conditional probability of arriving at this node from its parent.",
    )
    children: list["TreeNode"] = Field(
        default_factory=list,
        description="Child nodes.  Empty for terminal (leaf) nodes.",
    )
    outcome: Optional[Literal["TRUE_WIN", "RESTART", "LOSE"]] = Field(
        default=None,
        description="Terminal outcome.  Must be set on leaf nodes; must be None on interior nodes.",
    )
    duration_distribution: Optional[dict[str, Any]] = Field(
        default=None,
        description=(
            "Duration draw config for this stage, e.g. "
            '{"type": "uniform", "low": 9.0, "high": 18.0} or '
            '{"type": "fixed", "value": 4.0}.'
        ),
    )
    legal_cost: Optional[dict[str, float]] = Field(
        default=None,
        description=(
            "Legal cost range for this stage in native currency Cr, "
            'e.g. {"low": 2.0, "high": 3.0}.'
        ),
    )

    @model_validator(mode="after")
    def _leaf_or_interior(self) -> "TreeNode":
        is_leaf = len(self.children) == 0
        if is_leaf and self.outcome is None:
            raise ValueError(
                f"TreeNode '{self.name}': leaf node must have an outcome "
                f"(TRUE_WIN, RESTART, or LOSE)."
            )
        if not is_leaf and self.outcome is not None:
            raise ValueError(
                f"TreeNode '{self.name}': interior node must not have an outcome "
                f"(has children and outcome='{self.outcome}')."
            )
        return self

    @model_validator(mode="after")
    def _children_probs_sum(self) -> "TreeNode":
        if self.children:
            total = sum(c.probability for c in self.children)
            if abs(total - 1.0) > 1e-4:
                raise ValueError(
                    f"TreeNode '{self.name}': children probabilities sum to {total:.6f}, "
                    f"must equal 1.0 (±1e-4)."
                )
        return self


# ============================================================================
# 4. ScenarioTree
# ============================================================================

class ScenarioTree(BaseModel):
    """One scenario (A or B) of a jurisdiction challenge tree.

    Scenario A: claimant won arbitration — respondent challenges.
    Scenario B: claimant lost arbitration — claimant challenges.
    """

    root: TreeNode = Field(
        ...,
        description="Root node of the challenge tree for this scenario.",
    )
    description: str = Field(
        default="",
        description="Human-readable description of this scenario.",
    )

    def _collect_leaf_probs(
        self, node: TreeNode, cumulative: float = 1.0,
    ) -> list[tuple[float, str]]:
        """Walk the tree and return (cumulative_prob, outcome) for every leaf."""
        p = cumulative * node.probability
        if not node.children:
            return [(p, node.outcome)]  # type: ignore[list-item]
        leaves: list[tuple[float, str]] = []
        for child in node.children:
            leaves.extend(self._collect_leaf_probs(child, p))
        return leaves

    @model_validator(mode="after")
    def _terminal_probs_sum(self) -> "ScenarioTree":
        leaves = self._collect_leaf_probs(self.root)
        total = sum(p for p, _ in leaves)
        if abs(total - self.root.probability) > 1e-3:
            raise ValueError(
                f"ScenarioTree: terminal path probabilities sum to {total:.6f}, "
                f"expected {self.root.probability:.6f}."
            )
        return self


# ============================================================================
# 5. ChallengeTreeConfig
# ============================================================================

class ChallengeTreeConfig(BaseModel):
    """Complete challenge tree with both post-arbitration scenarios.

    Scenario A (claimant won):  terminal outcomes ∈ {TRUE_WIN, LOSE}.
    Scenario B (claimant lost): terminal outcomes ∈ {RESTART, LOSE}.
    """

    scenario_a: ScenarioTree = Field(
        ...,
        description="Challenge tree when claimant won arbitration (respondent challenges).",
    )
    scenario_b: ScenarioTree = Field(
        ...,
        description="Challenge tree when claimant lost arbitration (claimant challenges).",
    )

    @model_validator(mode="after")
    def _scenario_a_no_restart(self) -> "ChallengeTreeConfig":
        leaves = self.scenario_a._collect_leaf_probs(self.scenario_a.root)
        bad = [outcome for _, outcome in leaves if outcome == "RESTART"]
        if bad:
            raise ValueError(
                "ChallengeTreeConfig: Scenario A (claimant won) must not contain "
                f"RESTART outcomes — found {len(bad)} RESTART terminal node(s)."
            )
        return self

    @model_validator(mode="after")
    def _scenario_b_no_true_win(self) -> "ChallengeTreeConfig":
        leaves = self.scenario_b._collect_leaf_probs(self.scenario_b.root)
        bad = [outcome for _, outcome in leaves if outcome == "TRUE_WIN"]
        if bad:
            raise ValueError(
                "ChallengeTreeConfig: Scenario B (claimant lost) must not contain "
                f"TRUE_WIN outcomes — found {len(bad)} TRUE_WIN terminal node(s)."
            )
        return self


# ============================================================================
# 6. StageConfig
# ============================================================================

class StageConfig(BaseModel):
    """Duration and cost parameters for a single arbitration/court stage."""

    name: str = Field(
        ..., min_length=1,
        description="Stage identifier, e.g. 'dab', 's34', 'siac_hc'.",
    )
    duration_low: float = Field(
        ..., ge=0.0,
        description="Minimum stage duration in months.",
    )
    duration_high: float = Field(
        ..., ge=0.0,
        description="Maximum stage duration in months.",
    )
    legal_cost_low: float = Field(
        default=0.0, ge=0.0,
        description="Minimum total legal cost for this stage (currency Cr).",
    )
    legal_cost_high: float = Field(
        default=0.0, ge=0.0,
        description="Maximum total legal cost for this stage (currency Cr).",
    )

    @model_validator(mode="after")
    def _low_le_high(self) -> "StageConfig":
        if self.duration_low > self.duration_high:
            raise ValueError(
                f"StageConfig '{self.name}': duration_low ({self.duration_low}) "
                f"must be ≤ duration_high ({self.duration_high})."
            )
        if self.legal_cost_low > self.legal_cost_high:
            raise ValueError(
                f"StageConfig '{self.name}': legal_cost_low ({self.legal_cost_low}) "
                f"must be ≤ legal_cost_high ({self.legal_cost_high})."
            )
        return self


# ============================================================================
# 7a. PaymentDelays
# ============================================================================

class PaymentDelays(BaseModel):
    """Jurisdiction-specific payment delay configuration (months)."""

    domestic: float = Field(
        default=6.0, ge=0.0, le=36.0,
        description="Payment delay for Indian domestic claims (months).",
    )
    siac: float = Field(
        default=4.0, ge=0.0, le=36.0,
        description="Payment delay for SIAC/Singapore claims (months).",
    )
    re_arb: float = Field(
        default=6.0, ge=0.0, le=36.0,
        description="Payment delay after re-arbitration (months).",
    )


# ============================================================================
# 7. TimelineConfig
# ============================================================================

class TimelineConfig(BaseModel):
    """Timeline parameters for pre-arbitration stages and payment collection."""

    pre_arb_stages: list[StageConfig] = Field(
        default_factory=list,
        description=(
            "Ordered list of stages before/during arbitration "
            "(e.g. DAB, arbitration, re-referral).  Empty if claim starts "
            "at the challenge tree."
        ),
    )
    payment_delay_months: float = Field(
        default=6.0, ge=0.0,
        description="Months from final court resolution to cash receipt.",
    )
    payment_delays: PaymentDelays = Field(
        default_factory=PaymentDelays,
        description="Jurisdiction-specific payment delays (overrides payment_delay_months when set).",
    )
    max_horizon_months: int = Field(
        default=96, ge=12, le=360,
        description="Maximum timeline horizon — paths exceeding this are capped.",
    )


# ============================================================================
# 8. LegalCostConfig
# ============================================================================

class LegalCostConfig(BaseModel):
    """Legal cost structure for a claim.

    One-time costs are incurred at Month 0.  Per-stage costs are spread
    across the stage's duration.  A stochastic overrun multiplier is applied
    via a ScaledBeta distribution.
    """

    one_time_tribunal_cr: float = Field(
        default=6.0, ge=0.0,
        description="One-time tribunal fee at Month 0 (currency Cr).",
    )
    one_time_expert_cr: float = Field(
        default=2.0, ge=0.0,
        description="One-time expert engagement cost at Month 0 (currency Cr).",
    )
    per_stage_costs: dict[str, StageConfig] = Field(
        default_factory=dict,
        description=(
            "Legal cost parameters keyed by stage name.  "
            "E.g. {'dab': StageConfig(...), 's34': StageConfig(...)}."
        ),
    )
    overrun_alpha: float = Field(
        default=2.0, gt=0.0,
        description="ScaledBeta alpha parameter for cost overrun multiplier.",
    )
    overrun_beta: float = Field(
        default=5.0, gt=0.0,
        description="ScaledBeta beta parameter for cost overrun multiplier.",
    )
    overrun_low: float = Field(
        default=-0.10,
        description="ScaledBeta lower bound for cost overrun (e.g. -0.10 = 10% underrun).",
    )
    overrun_high: float = Field(
        default=0.60,
        description="ScaledBeta upper bound for cost overrun (e.g. 0.60 = 60% overrun).",
    )
    arb_counsel_cr: float = Field(
        default=8.0, ge=0.0,
        description="Fixed arbitration counsel fee (one-time, currency Cr).",
    )

    @model_validator(mode="after")
    def _overrun_range(self) -> "LegalCostConfig":
        if self.overrun_low > self.overrun_high:
            raise ValueError(
                f"LegalCostConfig: overrun_low ({self.overrun_low}) "
                f"must be ≤ overrun_high ({self.overrun_high})."
            )
        return self


# ============================================================================
# 9a. RateBand
# ============================================================================

class RateBand(BaseModel):
    """A single interest rate band with type and probability weight."""

    rate: float = Field(
        default=0.09, ge=0.0, le=1.0,
        description="Annual interest rate (e.g. 0.09 = 9% p.a.).",
    )
    type: Literal["simple", "compound"] = Field(
        default="simple",
        description="Interest calculation type for this band.",
    )
    probability: float = Field(
        default=1.0, ge=0.0, le=1.0,
        description="Probability weight for this rate band (0-1).",
    )


# ============================================================================
# 9. InterestConfig
# ============================================================================

class InterestConfig(BaseModel):
    """Pre/post-award interest accrual configuration."""

    enabled: bool = Field(
        default=False,
        description="Whether interest accrues on the awarded quantum.",
    )
    rate: float = Field(
        default=0.09, ge=0.0, le=1.0,
        description="Annual interest rate (e.g. 0.09 = 9% p.a.).",
    )
    compounding: Literal["simple", "compound"] = Field(
        default="simple",
        description="Interest calculation type.",
    )
    start_basis: Literal["award_date", "dab_commencement"] = Field(
        default="award_date",
        description="Basis date for interest accrual start.",
    )
    rate_bands: list[RateBand] = Field(
        default_factory=lambda: [RateBand(rate=0.09, type="simple", probability=1.0)],
        description="Interest rate bands with probabilities. MC engine samples one per path.",
    )
    commencement_date: Optional[str] = Field(
        default=None,
        description=(
            "ISO 8601 date (YYYY-MM-DD) from which interest accrues.  "
            "If None, accrues from arbitration award date."
        ),
    )

    @field_validator("rate_bands")
    @classmethod
    def _rate_bands_sum_to_one(cls, bands: list[RateBand]) -> list[RateBand]:
        if bands:
            total = sum(b.probability for b in bands)
            if abs(total - 1.0) > 1e-4:
                raise ValueError(
                    f"InterestConfig: rate_bands probabilities sum to {total:.6f}, "
                    f"must equal 1.0 (±1e-4)."
                )
        return bands


# ============================================================================
# 10. SettlementStageConfig & SettlementConfig
# ============================================================================

class SettlementStageConfig(BaseModel):
    """Settlement parameters for a single litigation stage."""
    stage_name: str = Field(
        description="Pipeline stage name (must match a stage in the claim's pipeline)."
    )
    hazard_rate: Optional[float] = Field(
        default=None, ge=0.0, le=1.0,
        description="\u03bb_s: probability of settlement offer at this stage. "
                    "0.0 = no settlement possible, 1.0 = guaranteed settlement. "
                    "None = use global_hazard_rate."
    )
    discount_factor: Optional[float] = Field(
        default=None, ge=0.0, le=1.5,
        description="\u03b4_s: settlement amount as fraction of reference quantum at this stage. "
                    "None = use ramp interpolation or game-theoretic computation."
    )

    @model_validator(mode="before")
    @classmethod
    def _normalize_stage_field(cls, data):
        """Accept both 'stage' and 'stage_name' for backward compatibility."""
        if isinstance(data, dict) and "stage_name" not in data and "stage" in data:
            data["stage_name"] = data.pop("stage")
        return data

class SettlementConfig(BaseModel):
    """Settlement configuration for a claim. When enabled, settlement is modeled
    as a competing exit process: at each pipeline stage, a Bernoulli draw determines
    whether settlement occurs. If it does, the claim exits with a discounted quantum
    and truncated legal costs.

    Mathematical foundation:
    - Hazard process: P(settle at stage s) = \u03bb_s \u00d7 \u220f(j<s)(1 \u2212 \u03bb_j)
    - Settlement amount: A = \u03b4_s \u00d7 Q_ref(s)
    - Q_ref depends on regime (pre-award vs post-award)
    """

    enabled: bool = Field(
        default=False,
        description="Master toggle. When False, settlement is completely disabled "
                    "and the engine runs the existing three-outcome model unchanged."
    )

    # \u2500\u2500 Mode selection \u2500\u2500
    mode: Literal["user_specified", "game_theoretic"] = Field(
        default="user_specified",
        description="'user_specified': user provides \u03b4_s per stage or as a ramp. "
                    "'game_theoretic': \u03b4*_s computed via Nash Bargaining from tree structure. "
                    "In game_theoretic mode, user still provides \u03bb_s (hazard rates)."
    )

    # \u2500\u2500 Global parameters (apply when per-stage overrides are absent) \u2500\u2500
    global_hazard_rate: float = Field(
        default=0.15, ge=0.0, le=1.0,
        description="Default \u03bb for all stages unless overridden per-stage."
    )
    discount_min: float = Field(
        default=0.30, ge=0.0, le=1.5,
        description="\u03b4_min: settlement discount at the earliest stage. "
                    "Used for linear ramp interpolation."
    )
    discount_max: float = Field(
        default=0.85, ge=0.0, le=1.5,
        description="\u03b4_max: settlement discount at the latest stage. "
                    "Used for linear ramp interpolation."
    )
    settlement_delay_months: float = Field(
        default=3.0, ge=0.0, le=24.0,
        description="Months from settlement agreement to cash receipt."
    )

    # \u2500\u2500 Per-stage overrides (optional \u2014 takes precedence over globals) \u2500\u2500
    stage_overrides: list[SettlementStageConfig] = Field(
        default_factory=list,
        description="Per-stage settlement parameters. Any stage listed here uses its own "
                    "hazard_rate and discount_factor instead of the global defaults."
    )

    @model_validator(mode='after')
    def _deduplicate_stage_overrides(self):
        """Merge duplicate stage_name entries (keeps last value for each field)."""
        if not self.stage_overrides:
            return self
        merged: dict[str, dict] = {}
        for so in self.stage_overrides:
            name = so.stage_name
            if name in merged:
                if so.hazard_rate is not None:
                    merged[name]['hazard_rate'] = so.hazard_rate
                if so.discount_factor is not None:
                    merged[name]['discount_factor'] = so.discount_factor
            else:
                merged[name] = {
                    'stage_name': name,
                    'hazard_rate': so.hazard_rate,
                    'discount_factor': so.discount_factor,
                }
        self.stage_overrides = [
            SettlementStageConfig(**v) for v in merged.values()
        ]
        return self

    # \u2500\u2500 Game-theoretic mode parameters \u2500\u2500
    bargaining_power: float = Field(
        default=0.5, ge=0.0, le=1.0,
        description="\u03b1 in Nash Bargaining: 0.5 = symmetric, >0.5 = claimant has more power. "
                    "Only used when mode='game_theoretic'."
    )
    respondent_legal_cost_cr: Optional[float] = Field(
        default=None, ge=0.0,
        description="Respondent's estimated remaining legal costs (\u20b9 Crore). "
                    "Used in game-theoretic mode to compute respondent's settlement incentive. "
                    "If None, estimated as 1.2\u00d7 claimant's legal costs."
    )

    @model_validator(mode="after")
    def _validate_discount_ramp(self) -> "SettlementConfig":
        """Ensure discount_min <= discount_max for consistent ramp interpolation."""
        if self.discount_min > self.discount_max:
            raise ValueError(
                f"SettlementConfig: discount_min ({self.discount_min}) must be "
                f"<= discount_max ({self.discount_max})."
            )
        return self

    @model_validator(mode="after")
    def _validate_game_theoretic_params(self) -> "SettlementConfig":
        """Warn if game_theoretic mode but bargaining_power is extreme."""
        if self.mode == "game_theoretic":
            if self.bargaining_power < 0.1 or self.bargaining_power > 0.9:
                import warnings
                warnings.warn(
                    f"SettlementConfig: bargaining_power={self.bargaining_power} is extreme. "
                    f"Values near 0 or 1 produce settlements that one party would reject."
                )
        return self


# ============================================================================
# 10a. ArbitrationConfig
# ============================================================================

class ArbitrationConfig(BaseModel):
    """Core arbitration outcome probabilities."""

    win_probability: float = Field(
        default=0.70, ge=0.0, le=1.0,
        description="Probability that claimant wins at first arbitration.",
    )
    re_arb_win_probability: float = Field(
        default=0.70, ge=0.0, le=1.0,
        description="Probability that claimant wins at re-arbitration (after RESTART).",
    )


# ============================================================================
# 10a. KnownOutcomes
# ============================================================================

class KnownOutcomes(BaseModel):
    """Known legal outcomes for claims at post-decision stages.

    When a claim has progressed past arbitration or past specific court
    challenges, these fields record the known results.  The MC engine
    uses these to SKIP random draws for already-decided events and to
    enter the correct scenario tree branch.

    All fields default to None (= not yet decided / unknown).
    """

    # ── Arbitration-level outcomes ──
    dab_outcome: Optional[Literal["favorable", "adverse", "premature"]] = Field(
        default=None,
        description="DAB decision outcome. 'favorable' = DAB awarded in claimant's favor, "
                    "'adverse' = DAB ruled against claimant, "
                    "'premature' = DAB found claim premature (Indian Domestic only).",
    )
    arb_outcome: Optional[Literal["won", "lost"]] = Field(
        default=None,
        description="Arbitration award outcome. 'won' = claimant won arbitration, "
                    "'lost' = claimant lost arbitration.",
    )

    # ── Known quantum (when arb_outcome = 'won') ──
    known_quantum_cr: Optional[float] = Field(
        default=None, ge=0.0,
        description="Known awarded quantum in currency Cr. "
                    "Used as the CENTER of a stochastic distribution (not deterministic). "
                    "The actual quantum in simulation is drawn from "
                    "TruncatedNormal(\u03bc=known_quantum_pct, \u03c3=0.10, [0, 1]).",
    )
    known_quantum_pct: Optional[float] = Field(
        default=None, ge=0.0, le=2.0,
        description="Known awarded quantum as fraction of SOC (e.g. 0.85 = 85% of SOC). "
                    "If both known_quantum_cr and known_quantum_pct are set, "
                    "known_quantum_pct takes precedence for the distribution center.",
    )

    # ── Indian Domestic challenge outcomes (S.34 \u2192 S.37 \u2192 SLP) ──
    s34_outcome: Optional[Literal["claimant_won", "respondent_won"]] = Field(
        default=None,
        description="S.34 challenge result. 'claimant_won' = S.34 challenge dismissed "
                    "(award upheld), 'respondent_won' = S.34 set aside award.",
    )
    s37_outcome: Optional[Literal["claimant_won", "respondent_won"]] = Field(
        default=None,
        description="S.37 appeal result. Same semantics as s34_outcome.",
    )
    slp_gate_outcome: Optional[Literal["dismissed", "admitted"]] = Field(
        default=None,
        description="SLP gate decision. 'dismissed' = SLP not admitted (final win), "
                    "'admitted' = SLP proceeds to merits hearing.",
    )
    slp_merits_outcome: Optional[Literal["claimant_won", "respondent_won"]] = Field(
        default=None,
        description="SLP merits hearing result.",
    )

    # ── SIAC Singapore challenge outcomes (HC \u2192 COA) ──
    hc_outcome: Optional[Literal["claimant_won", "respondent_won"]] = Field(
        default=None,
        description="High Court challenge result (SIAC Singapore).",
    )
    coa_outcome: Optional[Literal["claimant_won", "respondent_won"]] = Field(
        default=None,
        description="Court of Appeal result (SIAC Singapore).",
    )

    # ── HKIAC Hong Kong challenge outcomes (CFI \u2192 CA \u2192 CFA) ──
    cfi_outcome: Optional[Literal["claimant_won", "respondent_won"]] = Field(
        default=None,
        description="Court of First Instance challenge result (HKIAC Hong Kong).",
    )
    ca_outcome: Optional[Literal["claimant_won", "respondent_won"]] = Field(
        default=None,
        description="Court of Appeal result (HKIAC Hong Kong).",
    )
    cfa_gate_outcome: Optional[Literal["dismissed", "admitted"]] = Field(
        default=None,
        description="Court of Final Appeal leave-to-appeal decision (HKIAC HK).",
    )
    cfa_merits_outcome: Optional[Literal["claimant_won", "respondent_won"]] = Field(
        default=None,
        description="Court of Final Appeal merits result (HKIAC HK).",
    )

    @model_validator(mode="after")
    def _quantum_requires_arb_won(self) -> "KnownOutcomes":
        """known_quantum fields only valid when arb_outcome = 'won'."""
        if (self.known_quantum_cr is not None or self.known_quantum_pct is not None):
            if self.arb_outcome != "won":
                raise ValueError(
                    "KnownOutcomes: known_quantum_cr/known_quantum_pct require arb_outcome='won'."
                )
        return self

    @model_validator(mode="after")
    def _challenge_requires_arb_outcome(self) -> "KnownOutcomes":
        """Post-award challenge outcomes require arb_outcome to be set."""
        challenge_fields = [
            's34_outcome', 's37_outcome', 'slp_gate_outcome', 'slp_merits_outcome',
            'hc_outcome', 'coa_outcome',
            'cfi_outcome', 'ca_outcome', 'cfa_gate_outcome', 'cfa_merits_outcome',
        ]
        has_challenge = any(getattr(self, f) is not None for f in challenge_fields)
        if has_challenge and self.arb_outcome is None:
            raise ValueError(
                "KnownOutcomes: post-award challenge outcomes require arb_outcome to be set."
            )
        return self

    @model_validator(mode="after")
    def _sequential_consistency(self) -> "KnownOutcomes":
        """Validate that outcomes are sequentially consistent.
        e.g., s37_outcome requires s34_outcome; slp_gate requires s37_outcome."""
        # Indian Domestic chain
        if self.s37_outcome and not self.s34_outcome:
            raise ValueError("KnownOutcomes: s37_outcome requires s34_outcome to be set.")
        if self.slp_gate_outcome and not self.s37_outcome:
            raise ValueError("KnownOutcomes: slp_gate_outcome requires s37_outcome to be set.")
        if self.slp_merits_outcome and self.slp_gate_outcome != "admitted":
            raise ValueError("KnownOutcomes: slp_merits_outcome requires slp_gate_outcome='admitted'.")
        # SIAC chain
        if self.coa_outcome and not self.hc_outcome:
            raise ValueError("KnownOutcomes: coa_outcome requires hc_outcome to be set.")
        # HKIAC chain
        if self.ca_outcome and not self.cfi_outcome:
            raise ValueError("KnownOutcomes: ca_outcome requires cfi_outcome to be set.")
        if self.cfa_gate_outcome and not self.ca_outcome:
            raise ValueError("KnownOutcomes: cfa_gate_outcome requires ca_outcome to be set.")
        if self.cfa_merits_outcome and self.cfa_gate_outcome != "admitted":
            raise ValueError("KnownOutcomes: cfa_merits_outcome requires cfa_gate_outcome='admitted'.")
        return self


# ============================================================================
# 11. ClaimConfig
# ============================================================================

class ClaimConfig(BaseModel):
    """Full configuration for a single arbitration claim.

    This is the primary input object for the simulation engine.
    Each claim carries its own jurisdiction tree, quantum model,
    timeline stages, legal cost structure, and interest parameters.
    """

    id: str = Field(
        ..., min_length=1,
        description="Unique claim identifier, e.g. 'TP-301-6'.",
    )
    name: str = Field(
        ..., min_length=1,
        description="Human-readable claim name.",
    )
    claimant: str = Field(
        default="",
        description="Claimant entity name.",
    )
    respondent: str = Field(
        default="",
        description="Respondent entity name.",
    )
    jurisdiction: str = Field(
        ...,
        description="Jurisdiction key — 'indian_domestic', 'siac_singapore', or custom.",
    )
    claim_type: str = Field(
        default="other",
        description=(
            "Claim archetype — 'prolongation', 'change_of_law', "
            "'scope_variation', 'breach_of_contract', or 'other'."
        ),
    )
    soc_value_cr: float = Field(
        ..., gt=0.0,
        description="Statement of Claim value in native currency Cr.",
    )
    currency: str = Field(
        default="INR",
        description="ISO 4217 currency code.",
    )
    claimant_share_pct: float = Field(
        default=1.0, ge=0.0, le=1.0,
        description="Claimant's share of the claim (1.0 = 100%).",
    )
    current_stage: str = Field(
        default="",
        description="Current pipeline position, e.g. 'dab_commenced', 'arb_hearings_ongoing'.",
    )
    known_outcomes: KnownOutcomes = Field(
        default_factory=KnownOutcomes,
        description="Known legal outcomes for claims at post-decision stages. "
                    "Used by the MC engine to skip random draws for decided events.",
    )
    perspective: Literal["claimant", "respondent"] = Field(
        default="claimant",
        description="Modelling perspective — determines who is challenger in each scenario.",
    )
    arbitration: ArbitrationConfig = Field(
        default_factory=ArbitrationConfig,
        description="Arbitration outcome probability config.",
    )
    quantum: QuantumConfig = Field(
        ...,
        description="Quantum band configuration (conditional on WIN).",
    )
    challenge_tree: ChallengeTreeConfig = Field(
        ...,
        description="Post-arbitration challenge tree for both scenarios.",
    )
    timeline: TimelineConfig = Field(
        default_factory=TimelineConfig,
        description="Pre-arbitration stage durations and payment delay.",
    )
    legal_costs: LegalCostConfig = Field(
        default_factory=LegalCostConfig,
        description="Legal cost model parameters.",
    )
    interest: InterestConfig = Field(
        default_factory=InterestConfig,
        description="Interest accrual configuration.",
    )
    settlement: SettlementConfig = Field(
        default_factory=SettlementConfig,
        description="Settlement toggle and parameters. When enabled, settlement is modeled "
                    "as a competing exit at each pipeline stage."
    )
    no_restart_mode: bool = Field(
        default=False,
        description=(
            "If True, all RESTART outcomes are remapped to LOSE — "
            "conservative no-re-arbitration sensitivity."
        ),
    )
    description: str = Field(
        default="",
        description="Free-text claim description or notes.",
    )

    model_config = {
        "json_schema_extra": {
            "examples": [
                {
                    "id": "CLAIM-001",
                    "name": "Sample Prolongation Claim",
                    "jurisdiction": "indian_domestic",
                    "soc_value_cr": 1000.0,
                    "claim_type": "prolongation",
                }
            ]
        }
    }


# ============================================================================
# 12. LitFundingParams
# ============================================================================

class _GridRange(BaseModel):
    """Defines a numeric range with step size for grid generation."""

    min: float = Field(..., description="Grid lower bound.")
    max: float = Field(..., description="Grid upper bound.")
    step: float = Field(..., gt=0.0, description="Grid step size.")

    @model_validator(mode="after")
    def _min_le_max(self) -> "_GridRange":
        if self.min > self.max:
            raise ValueError(
                f"GridRange: min ({self.min}) must be ≤ max ({self.max})."
            )
        return self


class LitFundingParams(BaseModel):
    """Litigation funding waterfall parameters.

    The funder's return is min/max of (cost_multiple × costs, award_ratio × award).
    """

    cost_multiple_cap: float = Field(
        default=3.0, gt=0.0,
        description="Maximum return as multiple of deployed legal costs.",
    )
    award_ratio_cap: float = Field(
        default=0.30, gt=0.0, le=1.0,
        description="Maximum return as fraction of the total award.",
    )
    waterfall_type: Literal["min", "max"] = Field(
        default="min",
        description=(
            "How to combine cost_multiple and award_ratio caps: "
            "'min' = lesser of two, 'max' = greater of two."
        ),
    )
    cost_multiple_range: _GridRange = Field(
        default_factory=lambda: _GridRange(min=1.0, max=5.0, step=0.5),
        description="Grid range for cost_multiple sweep.",
    )
    award_ratio_range: _GridRange = Field(
        default_factory=lambda: _GridRange(min=0.10, max=0.50, step=0.05),
        description="Grid range for award_ratio sweep.",
    )


# ============================================================================
# 13. FullPurchaseParams
# ============================================================================

class FullPurchaseParams(BaseModel):
    """Full claim purchase (monetisation) parameters.

    Investor buys the claim outright for a fixed price.
    """

    purchase_prices: list[float] = Field(
        ..., min_length=1,
        description="List of purchase prices to evaluate (in currency Cr or as fraction of SOC).",
    )
    pricing_basis: Literal["soc", "ev"] = Field(
        default="soc",
        description="Whether purchase_prices are fractions of SOC or of expected value.",
    )
    legal_cost_bearer: Literal["investor", "claimant", "shared"] = Field(
        default="investor",
        description="Who bears ongoing legal costs after purchase.",
    )
    investor_cost_share_pct: float = Field(
        default=1.0, ge=0.0, le=1.0,
        description="Investor's share of legal costs when bearer is 'shared'.",
    )
    purchased_share_pct: float = Field(
        default=1.0, ge=0.0, le=1.0,
        description="Fraction of the claim being purchased (1.0 = 100%).",
    )


# ============================================================================
# 14. UpfrontTailParams
# ============================================================================

class UpfrontTailParams(BaseModel):
    """Upfront payment + tail (success fee) monetisation parameters.

    Investor pays upfront_pct × basis at close and receives
    (1 - tata_tail_pct) × award on success.
    """

    upfront_range: _GridRange = Field(
        default_factory=lambda: _GridRange(min=0.05, max=0.50, step=0.05),
        description="Grid range for upfront payment as fraction of pricing basis.",
    )
    tail_range: _GridRange = Field(
        default_factory=lambda: _GridRange(min=0.0, max=0.50, step=0.05),
        description="Grid range for claimant's tail (claimant keeps this fraction of award).",
    )
    pricing_basis: Literal["soc", "ev", "both"] = Field(
        default="soc",
        description="Basis for upfront calculation: SOC, expected value, or both.",
    )


# ============================================================================
# 15. MilestonePayment / StagedPaymentParams
# ============================================================================

class MilestonePayment(BaseModel):
    """A single milestone-triggered payment in a staged acquisition."""

    milestone_name: str = Field(
        ..., min_length=1,
        description="Stage/event that triggers payment, e.g. 'arb_commenced', 'award_received'.",
    )
    payment_cr: float = Field(
        ..., gt=0.0,
        description="Payment amount in currency Cr triggered at this milestone.",
    )


class StagedPaymentParams(BaseModel):
    """Staged (milestone-based) claim acquisition parameters."""

    milestones: list[MilestonePayment] = Field(
        ..., min_length=1,
        description="Ordered list of milestone payments.",
    )
    legal_cost_bearer: Literal["investor", "claimant", "shared"] = Field(
        default="investor",
        description="Who bears ongoing legal costs.",
    )
    purchased_share_pct: float = Field(
        default=1.0, ge=0.0, le=1.0,
        description="Fraction of the claim being purchased.",
    )


# ============================================================================
# 16. PortfolioStructure
# ============================================================================

class PortfolioStructure(BaseModel):
    """Investment structure selection and parameters.

    ``type`` selects the structure; ``params`` carries the matching config.
    For ``comparative`` type, both lit_funding_params and monetisation_params
    must be supplied.
    """

    type: Literal[
        "litigation_funding",
        "monetisation_full_purchase",
        "monetisation_upfront_tail",
        "monetisation_staged",
        "comparative",
    ] = Field(
        ...,
        description="Investment structure type.",
    )
    params: Optional[
        Union[LitFundingParams, FullPurchaseParams, UpfrontTailParams, StagedPaymentParams]
    ] = Field(
        default=None,
        description="Structure-specific parameters (not used for 'comparative' type).",
    )
    lit_funding_params: Optional[LitFundingParams] = Field(
        default=None,
        description="Litigation funding config (required for 'comparative' type).",
    )
    monetisation_params: Optional[
        Union[FullPurchaseParams, UpfrontTailParams, StagedPaymentParams]
    ] = Field(
        default=None,
        description="Monetisation config (required for 'comparative' type).",
    )

    @model_validator(mode="after")
    def _validate_structure(self) -> "PortfolioStructure":
        if self.type == "comparative":
            if self.lit_funding_params is None:
                raise ValueError(
                    "PortfolioStructure: 'comparative' type requires lit_funding_params."
                )
            if self.monetisation_params is None:
                raise ValueError(
                    "PortfolioStructure: 'comparative' type requires monetisation_params."
                )
        else:
            if self.params is None:
                raise ValueError(
                    f"PortfolioStructure: type '{self.type}' requires params."
                )
        return self


# ============================================================================
# 17. SimulationConfig
# ============================================================================

class SimulationConfig(BaseModel):
    """Monte Carlo simulation engine settings."""

    n_paths: int = Field(
        default=10_000, ge=100, le=1_000_000,
        description="Number of Monte Carlo simulation paths.",
    )
    seed: int = Field(
        default=42, ge=0,
        description="Base RNG seed for reproducibility.",
    )
    discount_rate: float = Field(
        default=0.12, ge=0.0, le=1.0,
        description="Annual discount / hurdle rate (e.g. 0.12 = 12%).",
    )
    risk_free_rate: float = Field(
        default=0.07, ge=0.0, le=1.0,
        description="Annual risk-free rate (e.g. 0.07 = 7%).",
    )
    start_date: str = Field(
        default="2026-04-30",
        description="Investment start date (ISO 8601 YYYY-MM-DD).  All cashflows anchored here.",
    )


# ============================================================================
# 18. PortfolioConfig
# ============================================================================

class PortfolioConfig(BaseModel):
    """Complete portfolio definition — claims + structure + simulation settings."""

    id: str = Field(
        ..., min_length=1,
        description="Unique portfolio identifier.",
    )
    name: str = Field(
        ..., min_length=1,
        description="Human-readable portfolio name.",
    )
    claim_ids: list[str] = Field(
        ..., min_length=1,
        description="IDs of claims included in this portfolio.",
    )
    structure: PortfolioStructure = Field(
        ...,
        description="Investment structure selection and parameters.",
    )
    simulation: SimulationConfig = Field(
        default_factory=SimulationConfig,
        description="Monte Carlo simulation settings.",
    )


# ============================================================================
# 19. PathResult
# ============================================================================

class PathResult(BaseModel):
    """Per-path, per-claim simulation output record.

    Produced by the MC engine for every (claim, path) combination.
    """

    outcome: str = Field(
        ...,
        description="Final outcome: 'TRUE_WIN', 'RESTART', or 'LOSE'.",
    )
    quantum_cr: float = Field(
        default=0.0,
        description="Awarded quantum in currency Cr (0 if LOSE).",
    )
    quantum_pct: float = Field(
        default=0.0, ge=0.0, le=1.0,
        description="Awarded quantum as fraction of SOC.",
    )
    timeline_months: float = Field(
        default=0.0, ge=0.0,
        description="Total timeline from start to cash receipt (months).",
    )
    legal_costs_cr: float = Field(
        default=0.0, ge=0.0,
        description="Total legal costs incurred (currency Cr).",
    )
    collected_cr: float = Field(
        default=0.0,
        description="Net cash collected by claimant (currency Cr).",
    )
    challenge_path_id: str = Field(
        default="",
        description="Terminal path ID from challenge tree, e.g. 'A1', 'SB3'.",
    )
    stages_traversed: list[str] = Field(
        default_factory=list,
        description="Ordered list of stages traversed, e.g. ['dab', 'arb', 's34', 's37', 'slp'].",
    )
    band_idx: int = Field(
        default=-1,
        description="Index of the quantum band drawn (-1 if LOSE/no draw).",
    )
    interest_cr: float = Field(
        default=0.0, ge=0.0,
        description="Interest earned on awarded quantum (currency Cr).",
    )


# ============================================================================
# 20. GridCellMetrics
# ============================================================================

class GridCellMetrics(BaseModel):
    """Aggregated metrics for one cell of an investment parameter grid.

    Each cell represents a specific (upfront%, tail%) or (cost_multiple, award_ratio)
    combination, aggregated across all MC paths.
    """

    mean_moic: float = Field(
        default=0.0,
        description="Mean MOIC across all MC paths.",
    )
    median_moic: float = Field(
        default=0.0,
        description="Median MOIC (P50).",
    )
    mean_xirr: float = Field(
        default=0.0,
        description="Mean annualised XIRR across all MC paths (arithmetic average of per-path IRRs).",
    )
    expected_xirr: float = Field(
        default=0.0,
        description="IRR of the expected (mean) cashflow stream across all MC paths. Industry-standard approach.",
    )
    p_loss: float = Field(
        default=0.0, ge=0.0, le=1.0,
        description="Probability of loss (MOIC < 1.0).",
    )
    p_hurdle: float = Field(
        default=0.0, ge=0.0, le=1.0,
        description="Probability of exceeding hurdle rate.",
    )
    var_1: float = Field(
        default=0.0,
        description="Value at Risk at 1% level (MOIC).",
    )
    cvar_1: float = Field(
        default=0.0,
        description="Conditional VaR (Expected Shortfall) at 1% level (MOIC).",
    )
    per_claim: dict[str, dict[str, Any]] = Field(
        default_factory=dict,
        description=(
            "Per-claim breakdown: {claim_id: {mean_moic, win_rate, mean_duration, ...}}."
        ),
    )


# ============================================================================
# 21. JurisdictionTemplate
# ============================================================================

class JurisdictionTemplate(BaseModel):
    """Jurisdiction template — pre-built defaults for a specific legal system.

    Provides default challenge trees, timelines, and legal costs that users
    can adopt as-is or customise per claim.
    """

    id: str = Field(
        ..., min_length=1,
        description="Unique jurisdiction key, e.g. 'indian_domestic'.",
    )
    name: str = Field(
        ..., min_length=1,
        description="Display name, e.g. 'Indian Domestic Arbitration'.",
    )
    description: str = Field(
        default="",
        description="Brief description of the jurisdiction and its challenge path.",
    )
    country: str = Field(
        default="",
        description="ISO 3166-1 alpha-2 country code, e.g. 'IN', 'SG'.",
    )
    institution: str = Field(
        default="",
        description="Arbitral institution, e.g. 'Ad-hoc (Indian Arbitration Act)', 'SIAC'.",
    )
    default_challenge_tree: ChallengeTreeConfig = Field(
        ...,
        description="Pre-built challenge tree with calibrated probabilities.",
    )
    default_timeline: TimelineConfig = Field(
        ...,
        description="Default stage durations and payment delays.",
    )
    default_legal_costs: LegalCostConfig = Field(
        ...,
        description="Default legal cost structure.",
    )
    default_payment_delay_months: float = Field(
        default=6.0, ge=0.0,
        description="Default months from court resolution to cash receipt.",
    )
    supports_restart: bool = Field(
        default=True,
        description=(
            "Whether this jurisdiction supports re-arbitration. "
            "False for SIAC (setting aside is final under Singapore IAA)."
        ),
    )
    enforcement_notes: str = Field(
        default="",
        description="Notes on award enforcement in this jurisdiction.",
    )
