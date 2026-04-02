# Settlement Toggle — Implementation Prompts

> **Purpose**: Eight self-contained prompts for a Claude Opus 4.6 agent (192K context window).
> Each prompt targets one phase and can run in a **separate, independent session**.
> Execute phases in order (1 → 8). Each phase's output feeds the next.
>
> **Recommended Agent**: **Claude Opus 4.6** — This feature requires mathematical precision,
> game-theoretic reasoning, and correct integration with an existing stochastic simulation engine.
> Opus 4.6 provides superior reasoning for probability theory, financial mathematics, and
> multi-layer architectural changes. Opus 4.5 is acceptable for Phases 6–8 (UI/dashboard) but
> Opus 4.6 is strongly preferred for Phases 1–5 (engine mathematics).
>
> **Key docs to attach to EVERY prompt**:
> - `AGENT_CONTEXT_GUIDE.md`
> - `AGENT_DEVELOPMENT_PLAYBOOK.md`
> - This file (`SETTLEMENT_IMPLEMENTATION_PROMPTS.md`) — so the agent knows the full plan
>
> **Estimated token budget per prompt**: 40K–70K (well within 192K window with file attachments)

---

## Mathematical Foundation (attach to every session)

### Settlement Model — Formal Specification

The settlement feature adds a **competing exit process** to the existing Monte Carlo claim model.
Currently, every MC path terminates in one of three outcomes: `TRUE_WIN`, `LOSE`, or `RESTART`.
Settlement introduces a fourth outcome: `SETTLED`.

#### Hazard Process

At each litigation stage $s \in \{1, 2, \ldots, S\}$, before resolving the stage outcome in the
probability tree, a settlement draw occurs:

$$U_s \sim \text{Uniform}(0, 1)$$
$$\text{Settle at stage } s \iff U_s < \lambda_s$$

where $\lambda_s$ is the **stage-specific settlement hazard rate** (user input).

The probability of reaching stage $s$ without prior settlement:

$$P(\text{reach } s) = \prod_{j < s} (1 - \lambda_j)$$

The unconditional probability of settling at exactly stage $s$:

$$P(\text{settle at } s) = \lambda_s \cdot \prod_{j < s}(1 - \lambda_j)$$

Probability conservation (required invariant):

$$\sum_{s=1}^{S} P(\text{settle at } s) + \prod_{s=1}^{S}(1 - \lambda_s) = 1$$

#### Settlement Quantum — Two Regimes

**Regime 1 — Pre-Award Settlement** (stages before arbitration concludes):

Neither party knows the actual quantum. Settlement references the unconditional expected value:

$$A_{\text{settle}}^{\text{pre}} = \delta_s \times E[Q] = \delta_s \times SOC \times E[q\% | \text{arb win}] \times P(\text{arb win})$$

With current default parameters: $E[q\% | \text{arb win}] = 0.72$, $P(\text{arb win}) = 0.70$.

**Regime 2 — Post-Award Settlement** (stages during challenge proceedings):

The arbitration award has been issued. The drawn quantum $Q_{\text{drawn}}$ is known to both parties.

*When claimant won arbitration (Scenario A — holds the award):*

$$A_{\text{settle}}^{\text{post,A}} = \delta_s \times Q_{\text{drawn}}$$

The discount reflects the opponent's probability of overturning via court challenge.

*When claimant lost arbitration (Scenario B — challenging adverse award):*

$$A_{\text{settle}}^{\text{post,B}} = \delta_s \times E[Q | \text{re-arb win}] \times P(\text{re-arb win}) \times P(\text{post-challenge survive})$$

This is heavily discounted because the claimant's position is weak.

#### Settlement Discount Factor

The discount $\delta_s$ can be provided in two modes:

**Mode 1 — User-Specified** (default): User enters $\delta_s$ directly per stage or as a
linear ramp from $\delta_{\min}$ to $\delta_{\max}$.

**Mode 2 — Game-Theoretic** (optional): Computed from first principles using Nash Bargaining:

$$\delta^*_s = \frac{V_C(s) + V_R(s)}{2 \times Q_{\text{ref}}}$$

where:
- $V_C(s)$ = Claimant's expected payoff from continuing litigation from stage $s$ onward
  (computed analytically from the remaining probability tree)
- $V_R(s)$ = Respondent's expected cost avoided by settling at stage $s$
  (= expected payout + expected legal costs from stage $s$ onward)

Both quantities are computable from the existing tree structure and parameters. The Nash
Bargaining Solution (NBS) assumes equal bargaining power; an optional asymmetry factor
$\alpha \in (0, 1)$ can weight the split:

$$\delta^*_s(\alpha) = \alpha \times V_C(s) + (1 - \alpha) \times V_R(s)$$

where $\alpha = 0.5$ is symmetric NBS.

#### Integration with Existing Outcomes

The outcome space expands from $\{$TRUE_WIN, LOSE, RESTART$\}$ to:

$$\Omega = \{\text{TRUE\_WIN},\; \text{LOSE},\; \text{RESTART},\; \text{SETTLED}\}$$

When a path settles:
- `final_outcome = "SETTLED"`
- `collected_cr = settlement_amount`
- `total_duration_months` = time up to settlement + settlement delay
- `monthly_legal_burn` is truncated at the settlement stage (costs saved)
- No further tree traversal occurs (path exits)
- RESTART outcomes can also settle during re-arbitration

#### Impact on Metrics

No formula changes needed to MOIC, XIRR, VaR, CVaR — they operate on final cashflows.
Settlement changes the *inputs* (shorter duration, discounted quantum, truncated legal costs)
but the computation mechanics are identical.

#### Probability Conservation Verification

After simulation, verify:
$$P(\text{SETTLED}) + P(\text{TRUE\_WIN}) + P(\text{LOSE}) + P(\text{RESTART that resolves}) = 1.0$$

This must hold analytically and be verified empirically across $N$ MC paths.

---

## Design Decisions Summary (FINAL — respect in all phases)

| # | Decision | Detail |
|---|----------|--------|
| 1 | **Toggle** | Settlement is a per-claim toggle. When OFF, existing model runs unchanged (zero regression risk). When ON, settlement hazard process is active. |
| 2 | **Two modes** | Mode 1: User-specified $\lambda_s$ and $\delta_s$ per stage. Mode 2: Game-theoretic $\delta^*_s$ computed from tree structure (user still specifies $\lambda_s$). |
| 3 | **Stage mapping** | Settlement windows align with existing pipeline stages: pre-DAB, post-DAB, during-arbitration, post-award (per challenge level). |
| 4 | **Discount ramp** | If user specifies single $\delta_{\min}$ and $\delta_{\max}$, engine linearly interpolates across stages by elapsed time fraction. Per-stage override always takes precedence. |
| 5 | **Settlement delay** | Fixed months from settlement agreement to cash receipt. Default 3 months. User-configurable. |
| 6 | **Re-arbitration** | If path hits RESTART and enters re-arbitration, settlement hazard resets and runs again within the re-arb + post-re-arb challenge pipeline. |
| 7 | **Cashflow truncation** | On settlement, legal costs cease after the settlement stage. Upfront investment is NOT refunded. Only recovered via settlement quantum. |
| 8 | **No counter-offer** | Model does not simulate multi-round negotiation. Settlement is binary: offer occurs (hazard) → accepted (amount = $\delta \times Q_{\text{ref}}$). |
| 9 | **Game-theoretic mode** | Computes $V_C(s)$ and $V_R(s)$ analytically from the probability tree. Does NOT re-run Monte Carlo recursively. Pre-computes expected values at each tree node via backward induction. |
| 10 | **Backward compatibility** | When `settlement.enabled = false`, ALL existing behavior, outputs, JSON keys, dashboards are IDENTICAL. Zero regression. |
| 11 | **Documentation** | ALL documentation files (AGENT_CONTEXT_GUIDE.md, AGENT_DEVELOPMENT_PLAYBOOK.md, README) must be updated. |
| 12 | **Outcome label** | The new outcome is `"SETTLED"` (not `"SETTLEMENT"`, not `"settled"`). Uppercase, past tense. |

---

## PHASE 1 — Schema, Config & Data Model

### Goal
Add `SettlementConfig` and `SettlementResult` models, integrate into `ClaimConfig` and
`PathResult`, add master input defaults, update config validation.

### Attach These Files
```
engine/config/schema.py              (full file — you will edit this)
engine/config/defaults.py            (full file — you will edit this)
engine/v2_core/v2_config.py          (full file — you will edit this)
engine/v2_core/v2_master_inputs.py   (full file — you will edit this)
SETTLEMENT_IMPLEMENTATION_PROMPTS.md (this file — for full context)
AGENT_CONTEXT_GUIDE.md
AGENT_DEVELOPMENT_PLAYBOOK.md
```

### Prompt

````
You are implementing Phase 1 of 8 for the "Settlement Toggle" feature in the Claim Analytics Platform.

## Context

The platform models arbitration claims through Monte Carlo simulation. Currently, every MC path terminates in one of three outcomes: TRUE_WIN, LOSE, or RESTART. There is NO settlement mechanism. This phase adds the data model foundations for settlement.

Read SETTLEMENT_IMPLEMENTATION_PROMPTS.md completely — it contains the full mathematical specification and all design decisions. Phase 1 is DATA MODEL ONLY. No simulation logic changes.

## Your Task

### 1. New `SettlementStageConfig` and `SettlementConfig` models in `engine/config/schema.py`

Add these AFTER the `InterestConfig` class and BEFORE the `ClaimConfig` class:

```python
class SettlementStageConfig(BaseModel):
    """Settlement parameters for a single litigation stage."""
    stage_name: str = Field(
        description="Pipeline stage name (must match a stage in the claim's pipeline)."
    )
    hazard_rate: float = Field(
        ge=0.0, le=1.0,
        description="λ_s: probability of settlement offer at this stage. "
                    "0.0 = no settlement possible, 1.0 = guaranteed settlement."
    )
    discount_factor: Optional[float] = Field(
        default=None, ge=0.0, le=1.5,
        description="δ_s: settlement amount as fraction of reference quantum at this stage. "
                    "None = use ramp interpolation or game-theoretic computation."
    )

class SettlementConfig(BaseModel):
    """Settlement configuration for a claim. When enabled, settlement is modeled
    as a competing exit process: at each pipeline stage, a Bernoulli draw determines
    whether settlement occurs. If it does, the claim exits with a discounted quantum
    and truncated legal costs.

    Mathematical foundation:
    - Hazard process: P(settle at stage s) = λ_s × ∏(j<s)(1 − λ_j)
    - Settlement amount: A = δ_s × Q_ref(s)
    - Q_ref depends on regime (pre-award vs post-award)
    """

    enabled: bool = Field(
        default=False,
        description="Master toggle. When False, settlement is completely disabled "
                    "and the engine runs the existing three-outcome model unchanged."
    )

    # ── Mode selection ──
    mode: Literal["user_specified", "game_theoretic"] = Field(
        default="user_specified",
        description="'user_specified': user provides δ_s per stage or as a ramp. "
                    "'game_theoretic': δ*_s computed via Nash Bargaining from tree structure. "
                    "In game_theoretic mode, user still provides λ_s (hazard rates)."
    )

    # ── Global parameters (apply when per-stage overrides are absent) ──
    global_hazard_rate: float = Field(
        default=0.15, ge=0.0, le=1.0,
        description="Default λ for all stages unless overridden per-stage."
    )
    discount_min: float = Field(
        default=0.30, ge=0.0, le=1.5,
        description="δ_min: settlement discount at the earliest stage. "
                    "Used for linear ramp interpolation."
    )
    discount_max: float = Field(
        default=0.85, ge=0.0, le=1.5,
        description="δ_max: settlement discount at the latest stage. "
                    "Used for linear ramp interpolation."
    )
    settlement_delay_months: float = Field(
        default=3.0, ge=0.0, le=24.0,
        description="Months from settlement agreement to cash receipt."
    )

    # ── Per-stage overrides (optional — takes precedence over globals) ──
    stage_overrides: list[SettlementStageConfig] = Field(
        default_factory=list,
        description="Per-stage settlement parameters. Any stage listed here uses its own "
                    "hazard_rate and discount_factor instead of the global defaults."
    )

    # ── Game-theoretic mode parameters ──
    bargaining_power: float = Field(
        default=0.5, ge=0.0, le=1.0,
        description="α in Nash Bargaining: 0.5 = symmetric, >0.5 = claimant has more power. "
                    "Only used when mode='game_theoretic'."
    )
    respondent_legal_cost_cr: Optional[float] = Field(
        default=None, ge=0.0,
        description="Respondent's estimated remaining legal costs (₹ Crore). "
                    "Used in game-theoretic mode to compute respondent's settlement incentive. "
                    "If None, estimated as 1.2× claimant's legal costs."
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
```

### 2. Add `settlement` field to `ClaimConfig`

In the `ClaimConfig` class, add this field AFTER the `interest` field and BEFORE the `known_outcomes` field:

```python
    settlement: SettlementConfig = Field(
        default_factory=SettlementConfig,
        description="Settlement toggle and parameters. When enabled, settlement is modeled "
                    "as a competing exit at each pipeline stage."
    )
```

### 3. Add `SettlementResult` dataclass to `engine/v2_core/v2_config.py`

Add this AFTER the `ChallengeResult` dataclass and BEFORE the `PathResult` dataclass:

```python
@dataclass
class SettlementResult:
    """Result of settlement process for a single MC path."""
    settled: bool                          # Whether settlement occurred
    settlement_stage: Optional[str] = None  # Stage where settlement happened (e.g., "s34", "arbitration")
    settlement_amount_cr: float = 0.0      # Amount received via settlement (₹ Crore)
    settlement_discount_used: float = 0.0  # δ_s that was applied
    settlement_timing_months: float = 0.0  # Total months from start to settlement payment
    settlement_mode: str = "none"          # "user_specified", "game_theoretic", or "none"
    reference_quantum_cr: float = 0.0      # Q_ref used for computing settlement amount
```

### 4. Extend `PathResult` in `engine/v2_core/v2_config.py`

Add to the `PathResult` dataclass:
- A `settlement` field: `settlement: Optional[SettlementResult] = None`
- Update the `final_outcome` documentation to include "SETTLED" as a valid value

Ensure `final_outcome` can now be: `"TRUE_WIN"`, `"LOSE"`, `"RESTART"`, or `"SETTLED"`.

### 5. Add settlement defaults to `engine/v2_core/v2_master_inputs.py`

Add a new section called `# ══════════════════  SETTLEMENT PARAMETERS  ══════════════════` with:

```python
# Settlement master toggle (overridden by adapter per-claim)
SETTLEMENT_ENABLED = False

# Default hazard rates per stage (P of settlement offer at each stage)
SETTLEMENT_GLOBAL_HAZARD_RATE = 0.15

# Default discount ramp
SETTLEMENT_DISCOUNT_MIN = 0.30   # δ at earliest stage
SETTLEMENT_DISCOUNT_MAX = 0.85   # δ at latest stage

# Settlement delay in months (agreement → cash)
SETTLEMENT_DELAY_MONTHS = 3.0

# Settlement mode: "user_specified" or "game_theoretic"
SETTLEMENT_MODE = "user_specified"

# Game-theoretic parameters
SETTLEMENT_BARGAINING_POWER = 0.5  # α in Nash Bargaining (0.5 = symmetric)
SETTLEMENT_RESPONDENT_LEGAL_COST_CR = None  # None → estimate as 1.2× claimant's costs
```

### 6. Update `engine/config/defaults.py`

In `get_default_claim_config()`, ensure the default `settlement=SettlementConfig()` is included.
Add `SettlementConfig` to the imports from `.schema`.

## Verification

After making changes, run these commands from the platform root:

```bash
python -c "from engine.config.schema import SettlementConfig, SettlementStageConfig; print('✓ schema imports OK')"

python -c "
from engine.config.schema import SettlementConfig
sc = SettlementConfig()
print('enabled:', sc.enabled)
print('mode:', sc.mode)
print('global_hazard_rate:', sc.global_hazard_rate)
print('discount_min:', sc.discount_min, 'discount_max:', sc.discount_max)
print('✓ defaults OK')
"

python -c "
from engine.config.schema import SettlementConfig
sc = SettlementConfig(enabled=True, mode='game_theoretic', bargaining_power=0.5)
print('✓ game theoretic config OK')
"

python -c "
from engine.config.schema import SettlementConfig
try:
    SettlementConfig(discount_min=0.9, discount_max=0.3)
    print('✗ should have raised')
except Exception as e:
    print(f'✓ validation caught: {e}')
"

python -c "
from engine.v2_core.v2_config import SettlementResult, PathResult
sr = SettlementResult(settled=True, settlement_stage='s34', settlement_amount_cr=500.0,
                      settlement_discount_used=0.65, settlement_timing_months=24.0,
                      settlement_mode='user_specified', reference_quantum_cr=769.0)
print(sr)
print('✓ SettlementResult OK')
"

python -c "
from engine.v2_core import v2_master_inputs as MI
print('SETTLEMENT_ENABLED:', MI.SETTLEMENT_ENABLED)
print('SETTLEMENT_GLOBAL_HAZARD_RATE:', MI.SETTLEMENT_GLOBAL_HAZARD_RATE)
print('SETTLEMENT_MODE:', MI.SETTLEMENT_MODE)
print('✓ master inputs OK')
"
```

## DO NOT
- Do NOT change any simulation logic (v2_monte_carlo.py, v2_probability_tree.py, etc.)
- Do NOT modify any frontend files
- Do NOT change any existing field types or defaults on ClaimConfig
- Do NOT change the existing three outcomes (TRUE_WIN, LOSE, RESTART) — only ADD "SETTLED"
- Do NOT add settlement logic to the adapter yet (that's Phase 2)

## File Change Summary
| File | Action |
|------|--------|
| `engine/config/schema.py` | Add SettlementStageConfig, SettlementConfig classes; add settlement field to ClaimConfig |
| `engine/config/defaults.py` | Add import, ensure default works |
| `engine/v2_core/v2_config.py` | Add SettlementResult dataclass; extend PathResult |
| `engine/v2_core/v2_master_inputs.py` | Add SETTLEMENT_* constants |
````

---

## PHASE 2 — Adapter & Master Input Patching

### Goal
Wire settlement config through the adapter: patch `v2_master_inputs` with per-claim settlement
parameters, add settlement stage mapping per jurisdiction, compute the linear discount ramp.

### Attach These Files
```
engine/adapter.py                    (full file — you will edit this)
engine/config/schema.py              (with Phase 1 changes)
engine/v2_core/v2_config.py          (with Phase 1 changes)
engine/v2_core/v2_master_inputs.py   (with Phase 1 changes)
SETTLEMENT_IMPLEMENTATION_PROMPTS.md (this file)
AGENT_CONTEXT_GUIDE.md
AGENT_DEVELOPMENT_PLAYBOOK.md
```

### Prompt

````
You are implementing Phase 2 of 8 for the "Settlement Toggle" feature in the Claim Analytics Platform.

Phase 1 (COMPLETED) added:
- `SettlementConfig` and `SettlementStageConfig` to `engine/config/schema.py`
- `SettlementResult` to `engine/v2_core/v2_config.py`, extended `PathResult` with `settlement` field
- Settlement constants to `engine/v2_core/v2_master_inputs.py`
- `settlement` field to `ClaimConfig`

Read SETTLEMENT_IMPLEMENTATION_PROMPTS.md completely for the mathematical specification.

## Your Task

### 1. Update `_MI_PATCHABLE_ATTRS` in `engine/adapter.py`

Add ALL new settlement-related master input attribute names to the `_MI_PATCHABLE_ATTRS` set:
- `SETTLEMENT_ENABLED`
- `SETTLEMENT_GLOBAL_HAZARD_RATE`
- `SETTLEMENT_DISCOUNT_MIN`
- `SETTLEMENT_DISCOUNT_MAX`
- `SETTLEMENT_DELAY_MONTHS`
- `SETTLEMENT_MODE`
- `SETTLEMENT_BARGAINING_POWER`
- `SETTLEMENT_RESPONDENT_LEGAL_COST_CR`
- `SETTLEMENT_STAGE_HAZARD_RATES` (new — dict of stage_name → λ_s)
- `SETTLEMENT_STAGE_DISCOUNT_FACTORS` (new — dict of stage_name → δ_s)

Also add these two new constants to `v2_master_inputs.py`:
```python
SETTLEMENT_STAGE_HAZARD_RATES = {}       # dict: stage_name → λ_s (per-stage override)
SETTLEMENT_STAGE_DISCOUNT_FACTORS = {}   # dict: stage_name → δ_s (per-stage override)
```

### 2. Update `patch_master_inputs_for_claim()` in `engine/adapter.py`

In the function that patches `v2_master_inputs` per-claim, add settlement parameter patching:

```python
# ── Settlement parameters ──
settlement = claim_config.settlement
MI.SETTLEMENT_ENABLED = settlement.enabled
if settlement.enabled:
    MI.SETTLEMENT_GLOBAL_HAZARD_RATE = settlement.global_hazard_rate
    MI.SETTLEMENT_DISCOUNT_MIN = settlement.discount_min
    MI.SETTLEMENT_DISCOUNT_MAX = settlement.discount_max
    MI.SETTLEMENT_DELAY_MONTHS = settlement.settlement_delay_months
    MI.SETTLEMENT_MODE = settlement.mode
    MI.SETTLEMENT_BARGAINING_POWER = settlement.bargaining_power
    MI.SETTLEMENT_RESPONDENT_LEGAL_COST_CR = settlement.respondent_legal_cost_cr

    # Build per-stage override dicts from stage_overrides list
    MI.SETTLEMENT_STAGE_HAZARD_RATES = {
        so.stage_name: so.hazard_rate
        for so in settlement.stage_overrides
    }
    MI.SETTLEMENT_STAGE_DISCOUNT_FACTORS = {
        so.stage_name: so.discount_factor
        for so in settlement.stage_overrides
        if so.discount_factor is not None
    }
```

### 3. Add `compute_settlement_discount_ramp()` helper in `engine/adapter.py`

This function computes the linear interpolation of δ across stages for a given jurisdiction's pipeline:

```python
def compute_settlement_discount_ramp(pipeline_stages: list[str],
                                      discount_min: float,
                                      discount_max: float,
                                      stage_overrides: dict[str, float]) -> dict[str, float]:
    """Compute δ_s for each stage via linear interpolation with per-stage overrides.

    Args:
        pipeline_stages: Ordered list of stage names for this claim's pipeline.
        discount_min: δ_min (earliest stage discount).
        discount_max: δ_max (latest stage discount).
        stage_overrides: Dict of stage_name → δ_s user overrides (take precedence).

    Returns:
        Dict of stage_name → δ_s for every stage in the pipeline.

    Mathematical basis:
        δ(s) = δ_min + (δ_max − δ_min) × (index(s) / (S − 1))
        where S = len(pipeline_stages), index(s) = 0-based position.
        Single-stage pipeline: δ(s) = (δ_min + δ_max) / 2.
    """
    n = len(pipeline_stages)
    if n == 0:
        return {}
    if n == 1:
        base = (discount_min + discount_max) / 2.0
        stage = pipeline_stages[0]
        return {stage: stage_overrides.get(stage, base)}

    ramp = {}
    for i, stage in enumerate(pipeline_stages):
        if stage in stage_overrides:
            ramp[stage] = stage_overrides[stage]
        else:
            frac = i / (n - 1)
            ramp[stage] = discount_min + (discount_max - discount_min) * frac
    return ramp
```

### 4. Add settlement-eligible stage lists per jurisdiction

Add a constant that maps jurisdiction → ordered list of stages where settlement can occur:

```python
SETTLEMENT_ELIGIBLE_STAGES = {
    "domestic": ["dab", "arbitration", "s34", "s37", "slp"],
    "indian_domestic": ["dab", "arbitration", "s34", "s37", "slp"],
    "siac": ["dab", "arbitration", "hc", "coa"],
    "siac_singapore": ["dab", "arbitration", "hc", "coa"],
    "hkiac": ["dab", "arbitration", "cfi", "ca", "cfa"],
    "hkiac_hongkong": ["dab", "arbitration", "cfi", "ca", "cfa"],
}
```

Place this in the adapter module. The Monte Carlo engine will use it to know at which points
to check the settlement hazard.

### 5. Add `get_settlement_params_for_claim()` convenience function

This function returns a fully resolved settlement parameter dict for the Monte Carlo engine:

```python
def get_settlement_params_for_claim(claim_config) -> dict:
    """Return fully-resolved settlement parameters for a single claim.

    Returns dict with keys:
        enabled, mode, hazard_rates (dict stage→λ), discount_factors (dict stage→δ),
        delay_months, bargaining_power, respondent_legal_cost_cr,
        eligible_stages (ordered list)
    """
    sc = claim_config.settlement
    if not sc.enabled:
        return {"enabled": False}

    jurisdiction = claim_config.jurisdiction.lower().replace(" ", "_")
    eligible = SETTLEMENT_ELIGIBLE_STAGES.get(jurisdiction, [])

    # Resolve hazard rates: per-stage override → global default
    hazard_rates = {}
    override_map = {so.stage_name: so.hazard_rate for so in sc.stage_overrides}
    for stage in eligible:
        hazard_rates[stage] = override_map.get(stage, sc.global_hazard_rate)

    # Resolve discount factors: per-stage override → ramp interpolation
    override_discounts = {
        so.stage_name: so.discount_factor
        for so in sc.stage_overrides
        if so.discount_factor is not None
    }
    discount_factors = compute_settlement_discount_ramp(
        eligible, sc.discount_min, sc.discount_max, override_discounts
    )

    return {
        "enabled": True,
        "mode": sc.mode,
        "hazard_rates": hazard_rates,
        "discount_factors": discount_factors,
        "delay_months": sc.settlement_delay_months,
        "bargaining_power": sc.bargaining_power,
        "respondent_legal_cost_cr": sc.respondent_legal_cost_cr,
        "eligible_stages": eligible,
    }
```

## Verification

```bash
python -c "
from engine.adapter import compute_settlement_discount_ramp
stages = ['dab', 'arbitration', 's34', 's37', 'slp']
ramp = compute_settlement_discount_ramp(stages, 0.30, 0.85, {})
for s, d in ramp.items():
    print(f'  {s}: δ = {d:.3f}')
# Expected: dab=0.300, arb=0.438, s34=0.575, s37=0.713, slp=0.850
print('✓ ramp interpolation OK')
"

python -c "
from engine.adapter import compute_settlement_discount_ramp
# With per-stage override
ramp = compute_settlement_discount_ramp(
    ['dab', 'arbitration', 's34'], 0.20, 0.80, {'arbitration': 0.50}
)
print(ramp)
assert abs(ramp['dab'] - 0.20) < 1e-6
assert abs(ramp['arbitration'] - 0.50) < 1e-6  # override
assert abs(ramp['s34'] - 0.80) < 1e-6
print('✓ override precedence OK')
"

python -c "
from engine.adapter import SETTLEMENT_ELIGIBLE_STAGES
for j, stages in SETTLEMENT_ELIGIBLE_STAGES.items():
    print(f'{j}: {stages}')
print('✓ eligible stages OK')
"

python -c "
from engine.config.schema import ClaimConfig, SettlementConfig, SettlementStageConfig
claim = ClaimConfig(
    name='test', soc_value_cr=100.0, jurisdiction='indian_domestic',
    settlement=SettlementConfig(
        enabled=True, mode='user_specified',
        global_hazard_rate=0.20, discount_min=0.25, discount_max=0.90,
        stage_overrides=[
            SettlementStageConfig(stage_name='s34', hazard_rate=0.30, discount_factor=0.70)
        ]
    )
)
from engine.adapter import get_settlement_params_for_claim
params = get_settlement_params_for_claim(claim)
print('enabled:', params['enabled'])
print('hazard_rates:', params['hazard_rates'])
print('discount_factors:', params['discount_factors'])
print('✓ full settlement resolution OK')
"
```

## DO NOT
- Do NOT modify v2_monte_carlo.py (simulation logic is Phase 3)
- Do NOT modify any frontend files
- Do NOT break existing adapter functionality
- Do NOT change existing `_MI_PATCHABLE_ATTRS` entries — only ADD new ones
- Do NOT remove any imports or functions from adapter.py

## File Change Summary
| File | Action |
|------|--------|
| `engine/v2_core/v2_master_inputs.py` | Add SETTLEMENT_STAGE_HAZARD_RATES, SETTLEMENT_STAGE_DISCOUNT_FACTORS |
| `engine/adapter.py` | Update _MI_PATCHABLE_ATTRS; add settlement patching to patch_master_inputs_for_claim(); add compute_settlement_discount_ramp(), SETTLEMENT_ELIGIBLE_STAGES, get_settlement_params_for_claim() |
````

---

## PHASE 3 — Monte Carlo Settlement Logic (Core Engine)

### Goal
Implement the settlement hazard process inside the Monte Carlo path simulation. This is the
mathematical core — the most critical phase for correctness.

### Attach These Files
```
engine/v2_core/v2_monte_carlo.py     (full file — you will edit this)
engine/v2_core/v2_probability_tree.py (full file — read-only reference)
engine/v2_core/v2_config.py          (with Phase 1 changes — read for dataclass shapes)
engine/v2_core/v2_master_inputs.py   (with Phase 1+2 changes)
engine/v2_core/v2_timeline_model.py  (read-only reference)
engine/v2_core/v2_cashflow_builder.py (read-only reference — for understanding cashflow inputs)
engine/adapter.py                    (with Phase 2 changes — read for settlement param resolution)
engine/config/schema.py              (with Phase 1 changes)
SETTLEMENT_IMPLEMENTATION_PROMPTS.md (this file)
AGENT_CONTEXT_GUIDE.md
AGENT_DEVELOPMENT_PLAYBOOK.md
```

### Prompt

````
You are implementing Phase 3 of 8 for the "Settlement Toggle" feature. THIS IS THE MATHEMATICAL CORE — correctness is paramount.

Phase 1 (COMPLETED) added data models: SettlementConfig, SettlementResult, PathResult.settlement field.
Phase 2 (COMPLETED) added adapter wiring: settlement parameters are now patched into v2_master_inputs per-claim.

Read SETTLEMENT_IMPLEMENTATION_PROMPTS.md completely for the mathematical specification (hazard process, two-regime quantum, probability conservation).

## Your Task

Modify `engine/v2_core/v2_monte_carlo.py` to implement the settlement hazard process.

### 1. Add settlement draw function

Add this function to the module (place it before `_simulate_claim_path`):

```python
def _attempt_settlement(stage_name: str, elapsed_months: float, arb_won: Optional[bool],
                         quantum_cr: Optional[float], soc_value_cr: float,
                         rng: np.random.Generator) -> Optional[SettlementResult]:
    """Attempt settlement at a given litigation stage.

    Mathematical specification:
    1. Look up λ_s for this stage (per-stage override → global default)
    2. Draw U ~ Uniform(0,1); if U >= λ_s → no settlement, return None
    3. Determine reference quantum Q_ref based on regime:
       - Pre-award: Q_ref = SOC × E[q%|win] × P(win)
       - Post-award (claimant won): Q_ref = quantum_cr (drawn quantum)
       - Post-award (claimant lost): Q_ref = SOC × E[q%|win] × P(re-arb win) × P(post-challenge)
    4. Look up δ_s for this stage
    5. settlement_amount = δ_s × Q_ref
    6. settlement_timing = elapsed_months + MI.SETTLEMENT_DELAY_MONTHS

    Args:
        stage_name: Current pipeline stage (e.g., "dab", "s34", "arbitration")
        elapsed_months: Total months elapsed from start to this stage
        arb_won: True if claimant won arbitration, False if lost, None if pre-award
        quantum_cr: Drawn quantum in ₹Cr (None if pre-award)
        soc_value_cr: Statement of Claim value in ₹Cr
        rng: NumPy random generator for this path

    Returns:
        SettlementResult if settlement occurs, None otherwise.
    """
    if not MI.SETTLEMENT_ENABLED:
        return None

    # 1. Get hazard rate for this stage
    stage_hazards = MI.SETTLEMENT_STAGE_HAZARD_RATES  # dict or empty
    lambda_s = stage_hazards.get(stage_name, MI.SETTLEMENT_GLOBAL_HAZARD_RATE)

    if lambda_s <= 0.0:
        return None

    # 2. Bernoulli draw
    u = rng.random()
    if u >= lambda_s:
        return None

    # 3. Determine Q_ref based on regime
    is_pre_award = (arb_won is None)
    if is_pre_award:
        # Pre-award regime: Q_ref = SOC × E[q%|win] × P(win)
        eq_given_win = sum(
            band["prob"] * (band["low"] + band["high"]) / 2.0
            for band in MI.QUANTUM_BANDS
        )
        q_ref = soc_value_cr * eq_given_win * MI.ARB_WIN_PROBABILITY
    elif arb_won:
        # Post-award, claimant won: Q_ref = actual drawn quantum
        q_ref = quantum_cr if quantum_cr is not None else 0.0
    else:
        # Post-award, claimant lost: Q_ref = SOC × E[q%|win] × P(re-arb win) × survival
        eq_given_win = sum(
            band["prob"] * (band["low"] + band["high"]) / 2.0
            for band in MI.QUANTUM_BANDS
        )
        # Survival probability depends on jurisdiction — approximate with 0.5
        # (this is refined in game-theoretic mode)
        post_challenge_survival = 0.50
        q_ref = soc_value_cr * eq_given_win * MI.RE_ARB_WIN_PROBABILITY * post_challenge_survival

    # 4. Get discount factor for this stage
    stage_discounts = MI.SETTLEMENT_STAGE_DISCOUNT_FACTORS  # dict or empty
    if stage_name in stage_discounts:
        delta_s = stage_discounts[stage_name]
    else:
        # Fall back to linear ramp (pre-computed or compute inline)
        delta_s = MI.SETTLEMENT_DISCOUNT_MIN  # safe fallback; ramp is pre-computed by adapter

    # 5. Compute settlement amount
    settlement_amount = delta_s * q_ref

    # 6. Compute timing
    timing = elapsed_months + MI.SETTLEMENT_DELAY_MONTHS

    return SettlementResult(
        settled=True,
        settlement_stage=stage_name,
        settlement_amount_cr=settlement_amount,
        settlement_discount_used=delta_s,
        settlement_timing_months=timing,
        settlement_mode=MI.SETTLEMENT_MODE,
        reference_quantum_cr=q_ref,
    )
```

**IMPORTANT NOTES FOR THE IMPLEMENTATION:**
- The QUANTUM_BANDS format in v2_master_inputs.py is a list of dicts with keys `prob`, `low`, `high`. Verify the exact key names by reading the file.
- MI.ARB_WIN_PROBABILITY and MI.RE_ARB_WIN_PROBABILITY are floats (default 0.70).
- Import SettlementResult from v2_config at the top of the file.

### 2. Integrate settlement checks into `_simulate_claim_path()`

The existing function follows this structure:
1. Draw pipeline timeline
2. Draw arbitration outcome
3. Draw quantum (if arb won)
4. Traverse challenge tree
5. Handle RESTART → re-arbitration
6. Compute interest
7. Build legal burn + return PathResult

**Insert settlement checks at these points:**

**Check A — Pre-award settlement** (between step 1 and step 2):
After drawing the pipeline timeline, check settlement for each pre-arb stage.
If the pipeline contains "dab" and/or "arbitration", check settlement at each:

```python
# After drawing pipeline durations, before arb outcome
elapsed = 0.0
for stage_name, stage_duration in timeline.stage_durations.items():
    elapsed += stage_duration
    if stage_name in ("dab", "arbitration", "re_referral", "arb_remaining"):
        settle_result = _attempt_settlement(
            stage_name=stage_name,
            elapsed_months=elapsed,
            arb_won=None,  # pre-award
            quantum_cr=None,
            soc_value_cr=claim.soc_value_cr,
            rng=rng,
        )
        if settle_result is not None:
            # Early exit: build PathResult with SETTLED outcome
            # Legal costs only up to this point
            legal_burn_truncated = _truncate_legal_burn(monthly_legal_burn, elapsed)
            return PathResult(
                claim_id=claim.claim_id,
                path_idx=path_idx,
                timeline=timeline,
                challenge=None,  # no challenge occurred
                arb_won=None,
                quantum=None,
                final_outcome="SETTLED",
                total_duration_months=settle_result.settlement_timing_months,
                monthly_legal_burn=legal_burn_truncated,
                legal_cost_total_cr=sum(legal_burn_truncated),
                collected_cr=settle_result.settlement_amount_cr,
                interest_earned_cr=0.0,
                settlement=settle_result,
            )
```

**Check B — Post-award settlement** (between step 4 and step 5, i.e., after challenge tree but before outcome processing):
If the challenge tree gives an outcome that isn't RESTART, check settlement during each challenge stage:

```python
# After challenge tree traversal, if outcome is TRUE_WIN or LOSE
if challenge.outcome in ("TRUE_WIN", "LOSE"):
    # Check settlement at each challenge stage
    elapsed_so_far = timeline.total_months  # pre-arb duration
    for stage_detail in challenge.stages_detail:
        elapsed_so_far += stage_detail['duration']
        settle_result = _attempt_settlement(
            stage_name=stage_detail['stage'],
            elapsed_months=elapsed_so_far,
            arb_won=arb_won,
            quantum_cr=quantum.quantum_cr if quantum else None,
            soc_value_cr=claim.soc_value_cr,
            rng=rng,
        )
        if settle_result is not None:
            legal_burn_truncated = _truncate_legal_burn(monthly_legal_burn, elapsed_so_far)
            return PathResult(
                claim_id=claim.claim_id,
                path_idx=path_idx,
                timeline=timeline,
                challenge=challenge,
                arb_won=arb_won,
                quantum=quantum,
                final_outcome="SETTLED",
                total_duration_months=settle_result.settlement_timing_months,
                monthly_legal_burn=legal_burn_truncated,
                legal_cost_total_cr=sum(legal_burn_truncated),
                collected_cr=settle_result.settlement_amount_cr,
                interest_earned_cr=0.0,
                settlement=settle_result,
            )
```

**Check C — Settlement during re-arbitration** (inside the RESTART handler):
If path hits RESTART and enters re-arbitration, check settlement during re-arb and post-re-arb challenge stages. Follow the same pattern as checks A and B.

### 3. Add `_truncate_legal_burn()` helper

```python
def _truncate_legal_burn(monthly_legal_burn: np.ndarray, months: float) -> np.ndarray:
    """Truncate legal burn array at settlement point.

    Args:
        monthly_legal_burn: Full legal burn array (one entry per month)
        months: Settlement month (fractional OK — ceil to int)

    Returns:
        Truncated copy of legal burn, zeroed after settlement month.
    """
    truncated = monthly_legal_burn.copy()
    cutoff = int(np.ceil(months))
    if cutoff < len(truncated):
        truncated[cutoff:] = 0.0
    return truncated
```

### 4. CRITICAL — Preserve existing behavior when settlement is disabled

The settlement checks MUST be wrapped in `if MI.SETTLEMENT_ENABLED:` guards. When `SETTLEMENT_ENABLED = False` (default), the function must produce IDENTICAL results to the current implementation. Zero regression.

Test this by running the full pipeline with settlement disabled and comparing output to a known baseline.

### 5. Update the numerical audit in `print_numerical_audit()`

Add a settlement summary section:

```python
if any(pr.settlement and pr.settlement.settled for pr in all_paths):
    n_settled = sum(1 for pr in all_paths if pr.settlement and pr.settlement.settled)
    pct = n_settled / len(all_paths) * 100
    print(f"\n  Settlement: {n_settled}/{len(all_paths)} paths ({pct:.1f}%)")

    # Per-stage breakdown
    from collections import Counter
    stage_counts = Counter(
        pr.settlement.settlement_stage
        for pr in all_paths
        if pr.settlement and pr.settlement.settled
    )
    for stage, cnt in sorted(stage_counts.items()):
        print(f"    {stage}: {cnt} ({cnt/len(all_paths)*100:.1f}%)")
```

## Verification

Run from platform root with settlement DISABLED (regression check):
```bash
python -m engine.run_v2 --config engine/tests/test_tata_portfolio.json \
    --output-dir test_outputs/settlement_regression --n 100 2>&1
# Compare output metrics to a known baseline — they must be IDENTICAL
```

Run with settlement ENABLED (create a test config):
```bash
python -c "
import json
with open('engine/tests/test_tata_portfolio.json') as f:
    cfg = json.load(f)
# Enable settlement on all claims
for claim in cfg.get('claims', []):
    claim['settlement'] = {
        'enabled': True, 'mode': 'user_specified',
        'global_hazard_rate': 0.20,
        'discount_min': 0.30, 'discount_max': 0.85,
        'settlement_delay_months': 3.0
    }
with open('test_outputs/settlement_test_config.json', 'w') as f:
    json.dump(cfg, f, indent=2)
print('Config saved')
"

python -m engine.run_v2 --config test_outputs/settlement_test_config.json \
    --output-dir test_outputs/settlement_test --n 1000 2>&1
# Verify: some paths should show SETTLED outcome in audit output
```

Probability conservation check:
```bash
python -c "
import json
with open('test_outputs/settlement_test/dashboard_data.json') as f:
    data = json.load(f)
# Sum of outcome probabilities should = 1.0
# (this check may need to wait until Phase 5 JSON export is done)
print('Manual check: look at audit output for settlement percentages')
"
```

## DO NOT
- Do NOT change v2_probability_tree.py (tree traversal is unchanged)
- Do NOT change v2_cashflow_builder.py (cashflow construction is unchanged)
- Do NOT change v2_metrics.py
- Do NOT modify any frontend files
- Do NOT implement game-theoretic mode computation yet (that's Phase 4)
- Do NOT break the existing PathResult construction for non-settled paths
- Do NOT change the RNG sequence for non-settlement paths (reproducibility must be preserved when settlement is disabled)

## File Change Summary
| File | Action |
|------|--------|
| `engine/v2_core/v2_monte_carlo.py` | Add _attempt_settlement(), _truncate_legal_burn(); modify _simulate_claim_path() with settlement checks; update print_numerical_audit() |
````

---

## PHASE 4 — Game-Theoretic Settlement Mode (Backward Induction)

### Goal
Implement the Nash Bargaining computation for game-theoretic settlement discount factors.
This phase computes $V_C(s)$ and $V_R(s)$ analytically via backward induction on the
probability tree, producing optimal $\delta^*_s$ at each stage.

### Attach These Files
```
engine/v2_core/v2_probability_tree.py (full file — read for tree structure)
engine/v2_core/v2_master_inputs.py    (with Phase 1+2 changes)
engine/v2_core/v2_monte_carlo.py      (with Phase 3 changes — read for integration point)
engine/v2_core/v2_config.py           (with Phase 1 changes)
engine/adapter.py                     (with Phase 2 changes — read for eligible stages)
engine/config/schema.py               (with Phase 1 changes)
SETTLEMENT_IMPLEMENTATION_PROMPTS.md  (this file)
AGENT_CONTEXT_GUIDE.md
AGENT_DEVELOPMENT_PLAYBOOK.md
```

### Prompt

````
You are implementing Phase 4 of 8 for the "Settlement Toggle" feature. This phase implements the game-theoretic settlement mode.

Phases 1-3 (COMPLETED) added: data models, adapter wiring, and the user-specified settlement hazard process in the Monte Carlo engine.

Read SETTLEMENT_IMPLEMENTATION_PROMPTS.md for the game-theoretic specification.

## Mathematical Background

In game-theoretic mode, the settlement discount factor δ*_s is computed via backward induction on the probability tree, rather than being specified by the user.

### Nash Bargaining Solution (NBS)

At each stage s, both parties compute their expected payoff from continuing:

**Claimant's continuation value** $V_C(s)$:
$$V_C(s) = E[\text{quantum received} | \text{continue from } s] - E[\text{legal costs remaining from } s]$$

**Respondent's continuation cost** $V_R(s)$:
$$V_R(s) = E[\text{quantum paid out} | \text{continue from } s] + E[\text{respondent legal costs from } s]$$

**Optimal settlement amount:**
$$S^*(s) = \alpha \cdot V_C(s) + (1 - \alpha) \cdot V_R(s)$$

**Settlement discount factor:**
$$\delta^*(s) = \frac{S^*(s)}{Q_{\text{ref}}(s)}$$

where $\alpha$ = bargaining power (0.5 = symmetric NBS) and $Q_{\text{ref}}$ = reference quantum for the regime.

### Backward Induction on the Tree

For a domestic claim (Scenario A, won arbitration), the tree has 4 levels: S.34 → S.37 → SLP gate → SLP merits.

Working backwards from the terminal nodes:

1. **At SLP merits (Level 4):** $V_C = P(\text{win merits}) \times Q - \text{merits\_cost}$
2. **At SLP gate (Level 3):** $V_C = P(\text{dismissed}) \times Q + P(\text{admitted}) \times V_C(\text{Level 4}) - \text{gate\_cost}$
3. **At S.37 (Level 2):** $V_C = P(\text{win S.37}) \times V_C(\text{Level 3 | S.37 won}) + P(\text{lose S.37}) \times V_C(\text{Level 3 | S.37 lost}) - \text{S.37\_cost}$
4. **At S.34 (Level 1):** Similar recursive computation.

**IMPORTANT**: This computation does NOT require Monte Carlo sampling. It uses the analytical probabilities from the probability tree and the expected quantum.

## Your Task

### 1. Create a new module `engine/v2_core/v2_settlement.py`

This module contains:

**A) `compute_continuation_values(jurisdiction, arb_won, expected_quantum_cr, soc_value_cr)` → dict**

Computes $V_C(s)$ and $V_R(s)$ at each stage via backward induction. Returns a dict:
```python
{
    "s34": {"v_claimant": 850.0, "v_respondent": 920.0},
    "s37": {"v_claimant": 780.0, "v_respondent": 870.0},
    "slp": {"v_claimant": 700.0, "v_respondent": 800.0},
    ...
}
```

The computation reads probabilities from `MI.DOMESTIC_SCENARIO_A_PATHS` (or SIAC/HKIAC equivalents) and legal costs from `MI.LEGAL_COSTS` per stage.

For pre-award stages (dab, arbitration), the continuation value includes the full expected value from the arbitration + challenge tree.

**B) `compute_game_theoretic_discounts(jurisdiction, arb_won, expected_quantum_cr, soc_value_cr, bargaining_power, respondent_legal_cost_cr)` → dict[str, float]**

Uses `compute_continuation_values()` to compute $\delta^*_s$ at each eligible stage:
```python
def compute_game_theoretic_discounts(
    jurisdiction: str,
    arb_won: Optional[bool],
    expected_quantum_cr: float,
    soc_value_cr: float,
    bargaining_power: float = 0.5,
    respondent_legal_cost_cr: Optional[float] = None,
) -> dict[str, float]:
    """Compute game-theoretic settlement discount factors via Nash Bargaining.

    Returns dict of stage_name → δ*_s (clamped to [0.05, 1.0]).
    """
```

**C) `compute_expected_quantum()` → float**

Helper that computes $E[Q | \text{win}] \times P(\text{win})$ from MI constants.

### 2. Reading the probability tree data

The probability tree data is stored in `v2_master_inputs.py` as:
- `DOMESTIC_SCENARIO_A_PATHS`: list of dicts, each with keys like `path_id`, `outcome`, `probability`, `l1_prob`, etc.
- `DOMESTIC_SCENARIO_B_PATHS`: same structure
- `SIAC_SCENARIO_A_PATHS`, `SIAC_SCENARIO_B_PATHS`
- `HKIAC_SCENARIO_A_PATHS`, `HKIAC_SCENARIO_B_PATHS`

Read the actual key names from `v2_master_inputs.py` before coding. The backward induction must use the EXACT probability values and path structures defined there.

### 3. Legal cost estimation for respondent

If `respondent_legal_cost_cr` is None, estimate as 1.2× claimant's legal costs per stage. Read legal cost parameters from MI to compute claimant's expected costs per stage.

### 4. Integrate with the Monte Carlo engine

In `_attempt_settlement()` in `v2_monte_carlo.py`, add a code path for game-theoretic mode:

```python
if MI.SETTLEMENT_MODE == "game_theoretic":
    from v2_settlement import compute_game_theoretic_discounts
    gt_discounts = compute_game_theoretic_discounts(
        jurisdiction=...,  # read from claim config or MI
        arb_won=arb_won,
        expected_quantum_cr=...,
        soc_value_cr=soc_value_cr,
        bargaining_power=MI.SETTLEMENT_BARGAINING_POWER,
        respondent_legal_cost_cr=MI.SETTLEMENT_RESPONDENT_LEGAL_COST_CR,
    )
    delta_s = gt_discounts.get(stage_name, MI.SETTLEMENT_DISCOUNT_MIN)
```

**Performance note**: `compute_game_theoretic_discounts()` should be called ONCE per claim (not per MC path) and cached. The backward induction is deterministic — it doesn't depend on any random draws. Consider caching at the claim level.

### 5. Clamping and sanity checks

All computed δ*_s values must be clamped to [0.05, 1.0]:
- Below 0.05 (5% of Q_ref) is economically irrational — claimant would reject
- Above 1.0 (100%) only possible if respondent's legal costs are very high relative to quantum

Print a warning if any δ*_s is clamped.

## Verification

```bash
python -c "
from engine.v2_core.v2_settlement import compute_continuation_values, compute_game_theoretic_discounts
import engine.v2_core.v2_master_inputs as MI

# Test domestic, Scenario A (claimant won arbitration)
cv = compute_continuation_values('domestic', arb_won=True, expected_quantum_cr=800.0, soc_value_cr=1100.0)
print('Domestic Scenario A continuation values:')
for stage, vals in cv.items():
    print(f'  {stage}: V_C={vals[\"v_claimant\"]:.1f}, V_R={vals[\"v_respondent\"]:.1f}')

gt = compute_game_theoretic_discounts('domestic', arb_won=True, 800.0, 1100.0)
print('Game-theoretic discounts (domestic, won):')
for stage, delta in gt.items():
    print(f'  {stage}: δ*={delta:.3f}')
# δ should increase from early to late stages (later = less discount)
print('✓ game theoretic computation OK')
"

python -c "
from engine.v2_core.v2_settlement import compute_game_theoretic_discounts
# Test SIAC
gt = compute_game_theoretic_discounts('siac', arb_won=True, 900.0, 1245.0)
print('SIAC game-theoretic discounts:')
for s, d in gt.items():
    print(f'  {s}: δ*={d:.3f}')
print('✓ SIAC OK')
"
```

Full simulation test with game-theoretic mode:
```bash
python -c "
import json
with open('engine/tests/test_tata_portfolio.json') as f:
    cfg = json.load(f)
for claim in cfg.get('claims', []):
    claim['settlement'] = {
        'enabled': True, 'mode': 'game_theoretic',
        'global_hazard_rate': 0.20,
        'bargaining_power': 0.5,
        'settlement_delay_months': 3.0
    }
with open('test_outputs/settlement_gt_config.json', 'w') as f:
    json.dump(cfg, f, indent=2)
"

python -m engine.run_v2 --config test_outputs/settlement_gt_config.json \
    --output-dir test_outputs/settlement_gt_test --n 500 2>&1
```

## DO NOT
- Do NOT modify v2_probability_tree.py — read the tree data structures from MI, don't alter them
- Do NOT modify v2_cashflow_builder.py or v2_metrics.py
- Do NOT modify any frontend files
- Do NOT add recursion or MC sampling inside the backward induction — it must be ANALYTICAL
- Do NOT cache game-theoretic results globally (each claim has different parameters)

## File Change Summary
| File | Action |
|------|--------|
| `engine/v2_core/v2_settlement.py` | NEW FILE: compute_continuation_values(), compute_game_theoretic_discounts(), compute_expected_quantum() |
| `engine/v2_core/v2_monte_carlo.py` | Minor edit: integrate game-theoretic δ lookup in _attempt_settlement() with caching |
````

---

## PHASE 5 — JSON Export & Dashboard Data

### Goal
Add settlement data to the dashboard JSON export so the frontend can render settlement analytics.

### Attach These Files
```
engine/v2_core/v2_json_exporter.py   (full file — you will edit this)
engine/v2_core/v2_config.py          (with all previous changes)
engine/v2_core/v2_monte_carlo.py     (with Phase 3 changes — read for PathResult structure)
engine/v2_core/v2_master_inputs.py   (with all previous changes)
engine/v2_core/v2_settlement.py      (Phase 4 — read for game-theoretic exports)
SETTLEMENT_IMPLEMENTATION_PROMPTS.md (this file)
AGENT_CONTEXT_GUIDE.md
AGENT_DEVELOPMENT_PLAYBOOK.md
```

### Prompt

````
You are implementing Phase 5 of 8 for the "Settlement Toggle" feature.

Phases 1-4 (COMPLETED) added: data models, adapter, MC settlement logic, game-theoretic computation.

Read SETTLEMENT_IMPLEMENTATION_PROMPTS.md for full context.

## Your Task

Modify `engine/v2_core/v2_json_exporter.py` to export settlement analytics in dashboard_data.json.

### 1. Add `_build_settlement_summary()` function

This function builds the settlement section of the JSON output:

```python
def _build_settlement_summary(sim: SimulationResults, claims: list) -> dict:
    """Build settlement analytics for the dashboard.

    Returns a dict with:
    - enabled: bool
    - mode: str ("user_specified" or "game_theoretic")
    - overall_settlement_rate: float (fraction of paths that settled)
    - overall_mean_settlement_pct: float (avg settlement amount / SOC)
    - per_stage_breakdown: list of {stage, count, pct, mean_amount_cr, mean_discount}
    - per_claim_settlement: dict of claim_id → {settlement_rate, mean_amount_cr, ...}
    - settlement_vs_judgment: {settled: {count, mean_moic, mean_duration}, judgment: {...}}
    - timing_distribution: {percentiles: {p10, p25, p50, p75, p90}, histogram: [...]}
    - game_theoretic_discounts: dict of stage → δ* (only if mode = game_theoretic)
    """
```

### 2. Detailed JSON structure

The `settlement` key in dashboard_data.json should contain:

```json
{
  "settlement": {
    "enabled": true,
    "mode": "user_specified",
    "config": {
      "global_hazard_rate": 0.20,
      "discount_min": 0.30,
      "discount_max": 0.85,
      "delay_months": 3.0,
      "stage_overrides": []
    },
    "summary": {
      "total_paths": 10000,
      "settled_paths": 1847,
      "settlement_rate": 0.1847,
      "judgment_paths": 8153,
      "mean_settlement_amount_cr": 456.2,
      "mean_settlement_as_pct_of_soc": 0.089
    },
    "per_stage": [
      {
        "stage": "dab",
        "count": 312,
        "pct_of_total": 0.0312,
        "pct_of_settlements": 0.169,
        "mean_discount_used": 0.32,
        "mean_amount_cr": 245.8,
        "mean_timing_months": 11.2
      },
      {
        "stage": "arbitration",
        "count": 498,
        "pct_of_total": 0.0498,
        "pct_of_settlements": 0.270,
        "mean_discount_used": 0.45,
        "mean_amount_cr": 382.1,
        "mean_timing_months": 22.5
      }
    ],
    "per_claim": {
      "TP-301-6": {
        "settlement_rate": 0.195,
        "mean_amount_cr": 612.3,
        "mean_discount": 0.55,
        "mean_timing_months": 24.1
      }
    },
    "comparison": {
      "settled_paths": {
        "mean_moic": 1.85,
        "mean_irr": 0.32,
        "mean_duration_months": 22.4,
        "mean_legal_cost_cr": 8.2
      },
      "judgment_paths": {
        "mean_moic": 2.41,
        "mean_irr": 0.18,
        "mean_duration_months": 48.6,
        "mean_legal_cost_cr": 18.7
      }
    },
    "timing_histogram": [
      {"month_bin": 6, "count": 89},
      {"month_bin": 12, "count": 234},
      {"month_bin": 18, "count": 412}
    ],
    "game_theoretic": null
  }
}
```

When game_theoretic mode, the `game_theoretic` key contains:
```json
{
  "game_theoretic": {
    "bargaining_power": 0.5,
    "per_stage_discounts": {
      "dab": 0.28,
      "arbitration": 0.42,
      "s34": 0.58,
      "s37": 0.71,
      "slp": 0.83
    },
    "per_stage_continuation_values": {
      "s34": {"v_claimant_cr": 850.0, "v_respondent_cr": 920.0}
    }
  }
}
```

### 3. Integration into the main export function

Find the main export function in v2_json_exporter.py (likely `export_dashboard_json()` or similar). Add the settlement summary to the output dict:

```python
# After existing sections
if MI.SETTLEMENT_ENABLED:
    data["settlement"] = _build_settlement_summary(sim, claims)
else:
    data["settlement"] = {"enabled": False}
```

### 4. Update the outcome distribution in existing summary sections

The existing probability/outcome summary sections show TRUE_WIN/LOSE/RESTART rates. Update these to also include SETTLED when settlement is enabled:

- In the outcome counts/percentages, add SETTLED
- In the probability pie chart data, add a "SETTLED" slice
- Ensure all outcome percentages still sum to 100%

### 5. Backward compatibility

When settlement is disabled (`MI.SETTLEMENT_ENABLED = False`), the `settlement` key should be `{"enabled": false}`. ALL other JSON keys must remain unchanged. Test by comparing a settlement-disabled run to a pre-settlement baseline.

## Verification

```bash
# Run with settlement enabled
python -m engine.run_v2 --config test_outputs/settlement_test_config.json \
    --output-dir test_outputs/settlement_json_test --n 1000 2>&1

# Check JSON output
python -c "
import json
with open('test_outputs/settlement_json_test/dashboard_data.json') as f:
    data = json.load(f)
s = data.get('settlement', {})
print('enabled:', s.get('enabled'))
print('mode:', s.get('mode'))
print('summary:', json.dumps(s.get('summary', {}), indent=2))
print('per_stage count:', len(s.get('per_stage', [])))
print('✓ settlement JSON exported')
"

# Regression check — disabled
python -m engine.run_v2 --config engine/tests/test_tata_portfolio.json \
    --output-dir test_outputs/settlement_disabled_check --n 100 2>&1

python -c "
import json
with open('test_outputs/settlement_disabled_check/dashboard_data.json') as f:
    data = json.load(f)
print('settlement:', data.get('settlement'))
assert data['settlement'] == {'enabled': False} or data['settlement']['enabled'] == False
print('✓ disabled regression OK')
"
```

## DO NOT
- Do NOT modify v2_monte_carlo.py (MC logic is done)
- Do NOT modify any frontend files
- Do NOT change existing JSON keys or their shapes
- Do NOT remove any existing export functions
- Do NOT add settlement JSON when settlement is disabled (only `{"enabled": false}`)

## File Change Summary
| File | Action |
|------|--------|
| `engine/v2_core/v2_json_exporter.py` | Add _build_settlement_summary(); integrate into main export; update outcome distributions |
````

---

## PHASE 6 — Frontend: Claim Editor Settlement Tab

### Goal
Add a "Settlement" tab to the Claim Editor with toggle, mode selector, parameter inputs, 
and per-stage configuration.

### Attach These Files
```
app/src/pages/ClaimEditor.jsx            (full file — you will edit this)
app/src/components/claim/ClaimBasicsForm.jsx (read-only — for pattern reference)
app/src/store/claimStore.js              (full file — you will edit this)
app/src/hooks/useClaimSimulation.js      (read-only reference)
engine/config/schema.py                  (with Phase 1 changes — for field reference)
SETTLEMENT_IMPLEMENTATION_PROMPTS.md     (this file)
AGENT_CONTEXT_GUIDE.md
AGENT_DEVELOPMENT_PLAYBOOK.md
```

### Prompt

````
You are implementing Phase 6 of 8 for the "Settlement Toggle" feature.

Phases 1-5 (COMPLETED) added: full engine support (data models, adapter, MC simulation, game-theoretic mode, JSON export). The backend is complete.

Read SETTLEMENT_IMPLEMENTATION_PROMPTS.md for design decisions and mathematical context.

## Your Task

### 1. Create `app/src/components/claim/SettlementEditor.jsx`

Create a new component that renders settlement configuration for a claim. Follow the EXACT same patterns used in the existing form components (ClaimBasicsForm.jsx, InterestEditor.jsx).

**Component structure:**

```
SettlementEditor
├── Master Toggle (enabled: true/false)
│   "Enable Settlement Modeling"
│   Help text: "When enabled, the simulation models settlement as a competing exit..."
│
├── (Only shown when enabled = true)
│   ├── Mode Selector (radio buttons)
│   │   ○ User-Specified — "You provide discount factors per stage"
│   │   ○ Game-Theoretic — "Discounts computed via Nash Bargaining Solution"
│   │
│   ├── Global Parameters
│   │   ├── Default Hazard Rate λ (slider 0%–50%, default 15%)
│   │   │   Help: "Probability of settlement offer at each stage"
│   │   ├── Settlement Delay (input, months, default 3)
│   │   │   Help: "Months from settlement agreement to cash receipt"
│   │   ├── (User-Specified mode only) Discount Ramp
│   │   │   ├── δ_min (slider 5%–80%, default 30%)
│   │   │   │   Help: "Settlement discount at earliest stage (% of reference quantum)"
│   │   │   └── δ_max (slider 20%–100%, default 85%)
│   │   │       Help: "Settlement discount at latest stage"
│   │   └── (Game-Theoretic mode only)
│   │       ├── Bargaining Power α (slider 0.1–0.9, default 0.5)
│   │       │   Help: "0.5 = symmetric Nash Bargaining. >0.5 favors claimant"
│   │       └── Respondent Legal Costs (optional input, ₹ Cr)
│   │           Help: "Estimated respondent's remaining legal costs. Leave blank to auto-estimate"
│   │
│   └── Per-Stage Overrides (collapsible, optional)
│       "Override global settings for specific stages"
│       Table with jurisdiction-specific stages:
│       | Stage | Hazard Rate (λ) | Discount Factor (δ) |
│       | DAB | [slider] | [slider or "auto"] |
│       | Arbitration | [slider] | [slider or "auto"] |
│       | S.34 | [slider] | [slider or "auto"] |
│       | ... | ... | ... |
│       (stages shown depend on claim's jurisdiction)
```

**UI requirements:**
- Use Tailwind CSS classes consistent with existing components
- Use the same input styling (rounded-md, border-gray-300, etc.)
- For sliders, show the percentage value next to the slider
- Disable per-stage discount column when mode = game_theoretic (those are computed)
- Show jurisdiction-appropriate stages (domestic: dab/arb/s34/s37/slp, SIAC: dab/arb/hc/coa, HKIAC: dab/arb/cfi/ca/cfa)

**Stage labels (display names):**
```javascript
const SETTLEMENT_STAGE_LABELS = {
  domestic: [
    { name: 'dab', label: 'DAB (Dispute Board)' },
    { name: 'arbitration', label: 'Arbitration' },
    { name: 's34', label: 'S.34 Challenge' },
    { name: 's37', label: 'S.37 Appeal' },
    { name: 'slp', label: 'SLP (Supreme Court)' },
  ],
  indian_domestic: [/* same as domestic */],
  siac: [
    { name: 'dab', label: 'DAB (Dispute Board)' },
    { name: 'arbitration', label: 'Arbitration' },
    { name: 'hc', label: 'High Court' },
    { name: 'coa', label: 'Court of Appeal' },
  ],
  siac_singapore: [/* same as siac */],
  hkiac: [
    { name: 'dab', label: 'DAB (Dispute Board)' },
    { name: 'arbitration', label: 'Arbitration' },
    { name: 'cfi', label: 'Court of First Instance' },
    { name: 'ca', label: 'Court of Appeal' },
    { name: 'cfa', label: 'Court of Final Appeal' },
  ],
  hkiac_hongkong: [/* same as hkiac */],
};
```

### 2. Add "Settlement" tab to ClaimEditor.jsx

Add a new tab to the TABS array:
```javascript
{ id: 'settlement', label: 'Settlement', icon: Handshake }
```

Import the `Handshake` icon from lucide-react.
Import and render `SettlementEditor` in the tab content switch.

### 3. Update claim store defaults

In `claimStore.js`, add `settlement` to the default claim object shape:
```javascript
settlement: {
  enabled: false,
  mode: 'user_specified',
  global_hazard_rate: 0.15,
  discount_min: 0.30,
  discount_max: 0.85,
  settlement_delay_months: 3.0,
  stage_overrides: [],
  bargaining_power: 0.5,
  respondent_legal_cost_cr: null,
}
```

### 4. Wire SettlementEditor data flow

The component should:
- Receive `claim` and `onChange` props (same pattern as other editors)
- Update `claim.settlement` object via `onChange`
- Handle nested updates (e.g., updating a single stage override without losing others)

### 5. CRITICAL — Use generateUUID() not crypto.randomUUID()

If you need UUIDs anywhere, import from `../utils/uuid.js`. Never use `crypto.randomUUID()`.

### 6. CRITICAL — No hardcoded localhost URLs

All API calls must use relative paths (`/api/...`).

## Verification

```bash
cd claim-analytics-platform/app
npx vite build 2>&1 | tail -10
# Must compile without errors
```

Then test manually:
1. Start `npm run dev` from platform root
2. Login → create workspace → create new claim
3. Check that "Settlement" tab appears
4. Toggle settlement on/off
5. Switch between User-Specified and Game-Theoretic modes
6. Adjust sliders and verify values update
7. Check per-stage overrides table shows correct stages for the jurisdiction
8. Save claim → reload → verify settlement settings persisted

## DO NOT
- Do NOT modify any engine Python files
- Do NOT modify dashboard components (that's Phase 7)
- Do NOT modify server routes (claim save/load already handles arbitrary JSON)
- Do NOT remove any existing tabs or form components
- Do NOT use crypto.randomUUID()
- Do NOT hardcode localhost URLs

## File Change Summary
| File | Action |
|------|--------|
| `app/src/components/claim/SettlementEditor.jsx` | NEW FILE: Settlement configuration form component |
| `app/src/pages/ClaimEditor.jsx` | Add "Settlement" tab, import SettlementEditor |
| `app/src/store/claimStore.js` | Add settlement defaults to claim object |
````

---

## PHASE 7 — Dashboard: Settlement Analytics Tab

### Goal
Create a Settlement Analytics dashboard component that visualizes settlement simulation results.

### Attach These Files
```
dashboard/src/App.jsx                        (full file — you will edit this)
dashboard/src/components/v2/index.js         (full file — you will edit this)
dashboard/src/components/v2/V2ProbabilityOutcomes.jsx (read — for pattern reference)
dashboard/src/components/v2/V2CashflowWaterfall.jsx   (read — for chart patterns)
dashboard/src/data/dashboardData.js          (read — for data loading pattern)
dashboard/src/components/Shared.jsx          (read — for Card, KPI components)
SETTLEMENT_IMPLEMENTATION_PROMPTS.md         (this file)
AGENT_CONTEXT_GUIDE.md
AGENT_DEVELOPMENT_PLAYBOOK.md
```

### Prompt

````
You are implementing Phase 7 of 8 for the "Settlement Toggle" feature.

Phases 1-6 (COMPLETED) added: full engine support, JSON export, and claim editor settlement tab.

Read SETTLEMENT_IMPLEMENTATION_PROMPTS.md for the JSON output structure (Phase 5 specification).

## Your Task

### 1. Create `dashboard/src/components/v2/V2SettlementAnalysis.jsx`

Create a dashboard component that renders settlement analytics. Follow the EXACT same patterns used in existing V2 components (V2ProbabilityOutcomes.jsx, V2CashflowWaterfall.jsx).

**Component sections:**

**A) Settlement KPI Row (top)**
Four metric cards:
- Settlement Rate: `{summary.settlement_rate * 100}%` of paths settled
- Mean Settlement Amount: `₹{summary.mean_settlement_amount_cr} Cr`
- Mean Settlement Timing: `{per_stage weighted avg timing} months`
- Mode: `{mode}` (User-Specified or Game-Theoretic)

**B) Settlement vs. Judgment Comparison (bar chart)**
Side-by-side comparison:
- Mean MOIC: settled vs judgment paths
- Mean IRR: settled vs judgment paths
- Mean Duration: settled vs judgment paths
- Mean Legal Cost: settled vs judgment paths

Use Recharts BarChart with two bars (settled = blue, judgment = orange).

**C) Settlement by Stage (horizontal bar chart or donut)**
Breakdown of settlements by stage (from `per_stage` array).
Show: count, percentage, mean discount factor, mean amount per stage.

**D) Settlement Timing Distribution (histogram)**
Histogram of settlement timing from `timing_histogram` array.
X-axis: months, Y-axis: count of paths.

**E) Per-Claim Settlement Rates (table)**
Table showing settlement rate, mean amount, mean timing per claim.
Use data from `per_claim` dict.

**F) Game-Theoretic Details (conditional — only when mode = game_theoretic)**
Show computed discount factors per stage as a step chart or table.
Show continuation values (V_C, V_R) per stage.

### 2. Handle missing settlement data gracefully

When `data.settlement` is `undefined` or `{enabled: false}`, show a centered message:
"Settlement modeling is disabled for this simulation. Enable it in the Claim Editor → Settlement tab."

### 3. Add to dashboard App.jsx

Add "Settlement" to the UNIVERSAL_TABS array:
```javascript
{ id: 'settlement', label: 'Settlement Analysis', icon: '🤝' }
```

Add the rendering case in the tab switch:
```javascript
case 'settlement':
  return <V2SettlementAnalysis data={data} />;
```

**IMPORTANT**: Only show this tab when `data.settlement?.enabled === true`. If settlement is disabled, either hide the tab or show it grayed out with the disabled message.

### 4. Update outcome visualizations in existing components

In V2ProbabilityOutcomes.jsx (or wherever outcome distributions are shown), add SETTLED as a fourth outcome:
- Color: `#10B981` (green-500, indicating successful resolution)
- Label: "Settled"
- Show alongside TRUE_WIN, LOSE, RESTART

### 5. Export from index.js

Add `V2SettlementAnalysis` to the barrel exports in `dashboard/src/components/v2/index.js`.

### 6. Chart library usage

Use the same libraries already in the dashboard:
- Recharts for bar charts, histograms
- D3 if needed for custom visualizations
- Follow existing color/style conventions from theme.js

## Verification

```bash
cd claim-analytics-platform/dashboard
npx vite build 2>&1 | tail -15
# Must compile without errors
```

Then test manually:
1. Run a simulation with settlement enabled
2. Open results dashboard
3. Verify "Settlement Analysis" tab appears
4. Check all 6 sections render with data
5. Run a simulation WITH settlement disabled
6. Verify tab is hidden or shows disabled message
7. Check that existing tabs (Executive Summary, Probability, etc.) still work correctly

## DO NOT
- Do NOT modify any engine Python files
- Do NOT modify the claim editor (Phase 6 is done)
- Do NOT modify server code
- Do NOT remove any existing dashboard components or tabs
- Do NOT use hardcoded data — always read from the `data` prop
- Do NOT break existing chart rendering

## File Change Summary
| File | Action |
|------|--------|
| `dashboard/src/components/v2/V2SettlementAnalysis.jsx` | NEW FILE: Settlement analytics dashboard component |
| `dashboard/src/components/v2/index.js` | Add V2SettlementAnalysis export |
| `dashboard/src/App.jsx` | Add Settlement tab, render V2SettlementAnalysis |
| `dashboard/src/components/v2/V2ProbabilityOutcomes.jsx` | Add SETTLED to outcome distribution charts |
````

---

## PHASE 8 — Documentation, Integration Testing & Production Push

### Goal
Update all documentation, run full integration tests, verify backward compatibility,
build for production, and push.

### Attach These Files
```
AGENT_CONTEXT_GUIDE.md               (full file — you will edit this)
AGENT_DEVELOPMENT_PLAYBOOK.md        (full file — you will edit this)
README.md                            (full file — you will edit this)
SETTLEMENT_IMPLEMENTATION_PROMPTS.md (this file — for reference)
deploy/Dockerfile                    (read — verify no changes needed)
package.json (root)                  (read — for build scripts)
```

### Prompt

````
You are implementing Phase 8 of 8 (FINAL) for the "Settlement Toggle" feature.

Phases 1-7 (COMPLETED) added the complete settlement feature:
- Phase 1: SettlementConfig, SettlementResult data models
- Phase 2: Adapter wiring, discount ramp, eligible stages
- Phase 3: Monte Carlo settlement hazard process
- Phase 4: Game-theoretic Nash Bargaining backward induction
- Phase 5: JSON export with settlement analytics
- Phase 6: Claim editor Settlement tab
- Phase 7: Dashboard Settlement Analysis component

## Your Task

### 1. Update AGENT_CONTEXT_GUIDE.md

Add settlement to the change category guides. Under "1. Engine / Simulation Logic Changes", add:
```
- Settlement: `engine/v2_core/v2_settlement.py`, `engine/v2_core/v2_monte_carlo.py` (settlement draw), `engine/adapter.py` (settlement params)
```

Add a new section "9. Settlement Changes":
```
### 9. Settlement Model Changes
> Modifying settlement hazard rates, discount factors, game-theoretic computation

| File | Purpose |
|------|---------|
| `engine/v2_core/v2_settlement.py` | Game-theoretic backward induction, continuation values |
| `engine/v2_core/v2_monte_carlo.py` | Settlement hazard draw in MC path simulation |
| `engine/adapter.py` | Settlement param resolution, eligible stages, discount ramp |
| `engine/config/schema.py` | SettlementConfig, SettlementStageConfig models |
| `engine/v2_core/v2_config.py` | SettlementResult dataclass |
| `engine/v2_core/v2_master_inputs.py` | SETTLEMENT_* constants |
| `engine/v2_core/v2_json_exporter.py` | Settlement JSON export section |
| `app/src/components/claim/SettlementEditor.jsx` | Settlement config UI |
| `app/src/pages/ClaimEditor.jsx` | Settlement tab |
| `dashboard/src/components/v2/V2SettlementAnalysis.jsx` | Settlement dashboard |
```

### 2. Update AGENT_DEVELOPMENT_PLAYBOOK.md

**A)** In the "Codebase Map" section, add `v2_settlement.py` to the engine/v2_core listing.

**B)** In the "Simulation Data Flow" diagram, add settlement branch:
```
Python (engine/run.py)
    ├── v2_monte_carlo.run_simulation()
    │   ├── _simulate_claim_path() — per path
    │   │   ├── _attempt_settlement() — hazard check at each stage
    │   │   │   └── (game_theoretic mode) → v2_settlement.compute_game_theoretic_discounts()
    │   │   └── Returns PathResult with final_outcome ∈ {TRUE_WIN, LOSE, RESTART, SETTLED}
```

**C)** In the "State Management" section, note that claim objects now include a `settlement` sub-object.

**D)** In "Known Gotchas", add:
```
### 9. Settlement Backward Compatibility
When settlement.enabled = false (default), the MC engine produces IDENTICAL results to the pre-settlement version. The settlement hazard process is completely bypassed. This is critical — if you modify settlement code, always verify regression by running with settlement disabled.
```

**E)** In the "Verification Checklist", add:
```
| 15 | Settlement toggle works | Enable/disable in claim editor, correct behavior |
| 16 | Settlement mode switch | User-specified vs game-theoretic modes work |
| 17 | Settlement results show | Dashboard "Settlement Analysis" tab renders |
| 18 | Settlement disabled regression | Identical results when settlement is off |
```

### 3. Update README.md

Add settlement to the features list and any relevant sections.

### 4. Integration Tests

Run these tests from the platform root:

**Test A — Regression (settlement disabled):**
```bash
cd claim-analytics-platform
python -m engine.run_v2 --config engine/tests/test_tata_portfolio.json \
    --output-dir test_outputs/settlement_regression_final --n 500 --seed 42 2>&1
# Output metrics must match pre-settlement baseline exactly
```

**Test B — User-specified settlement:**
```bash
python -c "
import json
with open('engine/tests/test_tata_portfolio.json') as f:
    cfg = json.load(f)
for claim in cfg.get('claims', []):
    claim['settlement'] = {
        'enabled': True, 'mode': 'user_specified',
        'global_hazard_rate': 0.20,
        'discount_min': 0.30, 'discount_max': 0.85,
        'settlement_delay_months': 3.0
    }
with open('test_outputs/settlement_user_config.json', 'w') as f:
    json.dump(cfg, f, indent=2)
"
python -m engine.run_v2 --config test_outputs/settlement_user_config.json \
    --output-dir test_outputs/settlement_user_final --n 1000 --seed 42 2>&1
```

**Test C — Game-theoretic settlement:**
```bash
python -c "
import json
with open('engine/tests/test_tata_portfolio.json') as f:
    cfg = json.load(f)
for claim in cfg.get('claims', []):
    claim['settlement'] = {
        'enabled': True, 'mode': 'game_theoretic',
        'global_hazard_rate': 0.20,
        'bargaining_power': 0.5,
        'settlement_delay_months': 3.0
    }
with open('test_outputs/settlement_gt_config.json', 'w') as f:
    json.dump(cfg, f, indent=2)
"
python -m engine.run_v2 --config test_outputs/settlement_gt_config.json \
    --output-dir test_outputs/settlement_gt_final --n 1000 --seed 42 2>&1
```

**Test D — Probability conservation:**
```bash
python -c "
import json
with open('test_outputs/settlement_user_final/dashboard_data.json') as f:
    data = json.load(f)
# Verify outcome rates sum to ~1.0
summary = data.get('summary', data.get('executive_summary', {}))
settled = data.get('settlement', {}).get('summary', {}).get('settlement_rate', 0)
# Check that SETTLED + TRUE_WIN + LOSE + RESTART ≈ 1.0
print('Settlement rate:', settled)
print('✓ Check audit output for probability conservation')
"
```

**Test E — Frontend builds:**
```bash
cd claim-analytics-platform/dashboard
npx vite build 2>&1 | tail -5

cd ../app
npx vite build 2>&1 | tail -5
```

**Test F — Full end-to-end (manual):**
1. Start `npm run dev` from platform root
2. Login → create workspace → create claim
3. Go to Settlement tab → enable → set parameters → save
4. Run simulation
5. View results → verify Settlement Analysis tab appears
6. Check KPIs, charts, per-stage breakdown
7. Disable settlement → re-run → verify no Settlement tab in results
8. All other tabs still work correctly

### 5. Production Build Verification

```bash
cd claim-analytics-platform
# Dashboard build
cd dashboard && npx vite build && cd ..
# App build
cd app && npx vite build && cd ..
```

Verify no new dependencies were added that aren't in package.json. If the settlement feature uses any new npm packages, ensure they're listed.

### 6. Git Commit

```bash
cd claim-analytics-platform
git add -A
git commit -m "feat(settlement): Add settlement toggle with user-specified and game-theoretic modes

Settlement modeling as a competing exit process in the Monte Carlo engine:
- Hazard process at each pipeline stage (configurable λ per stage)
- Two regimes: pre-award (discounted E[Q]) and post-award (discounted drawn quantum)
- User-specified mode: discount ramp δ_min to δ_max with per-stage overrides
- Game-theoretic mode: Nash Bargaining backward induction on probability tree
- New outcome type: SETTLED (alongside TRUE_WIN, LOSE, RESTART)
- Legal cost truncation at settlement point
- Claim editor Settlement tab with full configuration UI
- Dashboard Settlement Analysis tab with KPIs, stage breakdown, timing histogram
- Full backward compatibility: settlement.enabled=false produces identical results
- Probability conservation verified across all jurisdictions

Files changed:
  engine/config/schema.py - SettlementConfig, SettlementStageConfig models
  engine/v2_core/v2_config.py - SettlementResult dataclass, PathResult extension
  engine/v2_core/v2_master_inputs.py - SETTLEMENT_* constants
  engine/adapter.py - Settlement param resolution, discount ramp, eligible stages
  engine/v2_core/v2_monte_carlo.py - Settlement hazard process in MC simulation
  engine/v2_core/v2_settlement.py - Game-theoretic backward induction (NEW)
  engine/v2_core/v2_json_exporter.py - Settlement JSON export section
  app/src/components/claim/SettlementEditor.jsx - Settlement config UI (NEW)
  app/src/pages/ClaimEditor.jsx - Settlement tab
  app/src/store/claimStore.js - Settlement defaults
  dashboard/src/components/v2/V2SettlementAnalysis.jsx - Dashboard component (NEW)
  dashboard/src/App.jsx - Settlement tab in dashboard"
```

### 7. Push to production

```bash
git push origin main
```

Monitor deployment via GitHub Actions. After deployment:
```bash
ssh root@178.104.35.208 "curl -s http://localhost/api/health"
ssh root@178.104.35.208 "docker logs claim-analytics-web-1 --tail 30"
```

## DO NOT
- Do NOT modify any engine logic in this phase (all logic is complete)
- Do NOT skip any integration test
- Do NOT push without verifying frontend builds compile
- Do NOT amend published commits
- Do NOT remove any existing documentation sections

## File Change Summary
| File | Action |
|------|--------|
| `AGENT_CONTEXT_GUIDE.md` | Add settlement section to change categories |
| `AGENT_DEVELOPMENT_PLAYBOOK.md` | Add settlement to codebase map, data flow, gotchas, checklist |
| `README.md` | Add settlement to features |
````

---

## Phase Dependency Map

```
Phase 1 (Schema)
    │
    ▼
Phase 2 (Adapter)
    │
    ▼
Phase 3 (Monte Carlo) ──► Phase 4 (Game Theory)
    │                          │
    ▼                          ▼
Phase 5 (JSON Export) ◄────────┘
    │
    ├──► Phase 6 (Frontend Editor)
    │
    └──► Phase 7 (Dashboard)
              │
              ▼
         Phase 8 (Docs, Tests, Deploy)
```

Phases 6 and 7 can run **in parallel** after Phase 5 is complete (they are independent: one is app/, the other is dashboard/).

---

## Token Budget Estimate Per Phase

| Phase | Files Attached | Est. Context (tokens) | Remaining for Output |
|-------|---------------|----------------------|---------------------|
| 1 | 7 files + this doc | ~45K | ~147K |
| 2 | 7 files + this doc | ~50K | ~142K |
| 3 | 10 files + this doc | ~65K | ~127K |
| 4 | 9 files + this doc | ~55K | ~137K |
| 5 | 7 files + this doc | ~50K | ~142K |
| 6 | 7 files + this doc | ~45K | ~147K |
| 7 | 8 files + this doc | ~50K | ~142K |
| 8 | 6 files + this doc | ~35K | ~157K |

All phases are well within the 192K window.

---

## Context Continuity Between Sessions

Each prompt is self-contained, but to maintain context:

1. **This file** (`SETTLEMENT_IMPLEMENTATION_PROMPTS.md`) contains the complete mathematical specification and design decisions. Attach to every session.

2. **Phase completion markers**: Each prompt starts with "Phase X (COMPLETED) added: ..." so the agent knows what's already done.

3. **Verification commands**: Each phase ends with verification commands. Run them and save output. If a later phase's agent needs to verify, re-run the earlier phase's checks.

4. **File change summaries**: Each phase lists exactly which files it modifies. The next phase can verify those files exist with the expected changes.

---

## Quick Reference: New Files Created

| Phase | New File |
|-------|----------|
| 4 | `engine/v2_core/v2_settlement.py` |
| 6 | `app/src/components/claim/SettlementEditor.jsx` |
| 7 | `dashboard/src/components/v2/V2SettlementAnalysis.jsx` |

All other changes are modifications to existing files.
