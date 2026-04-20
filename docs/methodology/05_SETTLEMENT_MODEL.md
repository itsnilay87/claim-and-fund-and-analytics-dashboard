# Settlement Model Specification

> **Document**: 05_SETTLEMENT_MODEL.md  
> **Version**: 2.0  
> **Scope**: Negotiated exit process, game-theoretic modeling

---

## 1. Settlement in Litigation Funding

### Definition

**Settlement**: A negotiated agreement to resolve the claim before final judicial determination, typically involving:

1. **Payment amount** = $\delta \times Q_{ref}$ where $\delta \in (0, 1)$ is the discount factor
2. **Timing** = Earlier than judicial resolution
3. **Legal cost truncation** = No further litigation costs incurred

### When Settlement Can Occur

| Stage Category | Example Stages | Settlement Possible |
|----------------|----------------|---------------------|
| Pre-Award | DAB, Arbitration | ✓ |
| Post-Award (Claimant Won) | S.34, S.37, SLP, HC, COA | ✓ |
| Post-Award (Claimant Lost) | S.34, S.37, SLP (Scenario B) | ✓ |
| Terminal | TRUE_WIN, LOSE | ✗ (already resolved) |

### Settlement Impact on Funder

- **Positive**: Earlier resolution, reduced legal costs, certainty
- **Negative**: Lower recovery than full judicial WIN

---

## 2. Hazard Rate Model

### Continuous-Time Framework

Settlement is modeled as a **Poisson process** with stage-dependent intensity:

$$
P(\text{settle in stage } s) = \lambda_s \cdot \Delta t_s
$$

where:
- $\lambda_s$ = hazard rate for stage $s$
- $\Delta t_s$ = duration of stage $s$

For simplicity, discretize to **per-stage settlement probability**:

$$
P(\text{settle at stage } s) = \lambda_s
$$

### Stage-Specific Hazard Rates

| Stage | $\lambda_s$ | Rationale |
|-------|-------------|-----------|
| DAB | 0.05 | Low — parties want tribunal assessment |
| Arbitration | 0.10 | Moderate — information revealed during hearings |
| S.34 | 0.15 | High — after award, parties assess appeal risks |
| S.37 | 0.15 | High — second data point |
| SLP | 0.08 | Moderate — leave uncertainty drives settlement |
| HC (SIAC) | 0.12 | Moderate |
| COA (SIAC) | 0.10 | Lower — committed parties |
| CFI (HKIAC) | 0.12 | Moderate |
| CA (HKIAC) | 0.10 | Lower |
| CFA (HKIAC) | 0.08 | Low — rare to settle at final appeal |

**Global Default**: If stage-specific rate not defined, use $\lambda_{default} = 0.10$.

### Settlement Attempt Algorithm

```python
def attempt_settlement(
    stage: str,
    elapsed_months: float,
    arb_won: Optional[bool],
    quantum_cr: Optional[float],
    soc_value_cr: float,
    rng: Generator,
) -> Optional[SettlementResult]:
    """
    Attempt settlement at current stage.
    
    Steps:
    1. Look up λ_s for this stage
    2. Draw U ~ Uniform(0,1)
    3. If U < λ_s: settlement occurs
       - Compute reference quantum Q_ref
       - Compute discount factor δ_s
       - Settlement amount = δ_s × Q_ref
       - Settlement timing = elapsed + delay
    4. Else: no settlement, return None
    """
    lambda_s = get_hazard_rate(stage)
    
    if rng.random() >= lambda_s:
        return None  # No settlement
    
    # Settlement occurs
    q_ref = compute_reference_quantum(arb_won, quantum_cr, soc_value_cr)
    delta_s = compute_discount_factor(stage, arb_won)
    
    return SettlementResult(
        settled=True,
        stage=stage,
        amount_cr=delta_s * q_ref,
        discount=delta_s,
        timing_months=elapsed_months + SETTLEMENT_DELAY,
    )
```

---

## 3. Discount Factor Models

### User-Specified Ramp Model

The simplest model uses a linear ramp:

$$
\delta_s = \delta_{min} + \frac{s}{S} \times (\delta_{max} - \delta_{min})
$$

where:
- $s$ = stage index (0 = first stage)
- $S$ = total number of stages
- $\delta_{min}$ = minimum discount (early settlement)
- $\delta_{max}$ = maximum discount (late settlement)

**Rationale**: Later stages have less uncertainty, so respondent offers less discount.

**Example**: $\delta_{min} = 0.40$, $\delta_{max} = 0.85$

| Stage | Index | Discount |
|-------|-------|----------|
| DAB | 0 | 0.40 |
| Arbitration | 1 | 0.51 |
| S.34 | 2 | 0.63 |
| S.37 | 3 | 0.74 |
| SLP | 4 | 0.85 |

### Game-Theoretic Model (Nash Bargaining)

For sophisticated users, compute discount via Nash Bargaining Solution.

---

## 4. Nash Bargaining Solution

### Setup

Two parties:
- **Claimant (C)**: Holds claim, seeks recovery
- **Respondent (R)**: Must pay award, seeks to minimize payout

### Continuation Values

At stage $s$, each party has a **continuation value** — expected payoff from proceeding with litigation.

**Claimant's Continuation Value**:

$$
V_C(s) = P(\text{WIN from stage } s) \times \mathbb{E}[Q | \text{WIN}] - C_{legal}(s \to T)
$$

where $C_{legal}(s \to T)$ is expected legal cost from stage $s$ to terminal.

**Respondent's Continuation Value**:

$$
V_R(s) = P(\text{WIN from stage } s) \times \mathbb{E}[Q | \text{WIN}] + R_{legal}(s \to T)
$$

Note: For respondent, costs are additive (they must pay litigation costs too).

### Bargaining Zone

Settlement is possible when:

$$
V_C(s) < V_R(s)
$$

The **surplus** available for negotiation:

$$
\Pi(s) = V_R(s) - V_C(s) = C_{legal}(s \to T) + R_{legal}(s \to T)
$$

(Surplus equals avoided legal costs for both sides)

### Nash Bargaining Solution

The settlement amount $S^*$ is:

$$
S^* = V_C(s) + \alpha \times \Pi(s)
$$

where $\alpha \in [0, 1]$ is claimant's **bargaining power**.

- $\alpha = 0.5$: Symmetric bargaining (parties split surplus)
- $\alpha > 0.5$: Claimant has more power
- $\alpha < 0.5$: Respondent has more power

### Discount Factor from NBS

$$
\delta^*(s) = \frac{S^*}{Q_{ref}} = \frac{V_C(s) + \alpha \times \Pi(s)}{Q_{ref}}
$$

### Backward Induction Algorithm

To compute $V_C(s)$ at each stage, work backwards from terminal:

```
For final stage T (terminal):
    V_C(T) = P(WIN at T) × E[Q|WIN]

For each earlier stage s (backward):
    V_C(s) = P(survive_s) × V_C(s+1) × exp(-r_f × Δt_s) - LC_C(s)
    V_R(s) = P(survive_s) × V_R(s+1) × exp(-r_f × Δt_s) + LC_R(s)
```

### Time-Value Adjustment

Future payoffs are discounted to present value using the risk-free rate $r_f$ (`SimulationConfig.risk_free_rate`, default 7% annual). Each backward step applies a continuous discount factor:

$$
\text{df}(s) = e^{-r_f \times \Delta t_s / 12}
$$

where $\Delta t_s$ is the **expected stage duration in months** (from `v2_master_inputs.py` stage constants):

| Stage | Expected Duration (months) |
|-------|---------------------------|
| S.34 | $(9 + 18) / 2 = 13.5$ |
| S.37 | $(6 + 12) / 2 = 9.0$ |
| SLP | $(4 + 24) / 2 = 14.0$ |
| SIAC HC | $6.0$ |
| SIAC COA | $6.0$ |
| HKIAC CFI | $(6 + 12) / 2 = 9.0$ |
| HKIAC CA | $(6 + 9) / 2 = 7.5$ |

**Rationale**: A settlement payable today is worth more than a judgment payable in 2–3 years. Without discounting, the NBS overvalues continuation (litigation) relative to immediate settlement, producing settlement amounts that are too high. At $r_f = 0.07$:
- A 1-year delay costs $\approx 6.8\%$ of value
- A 3-year total challenge tree costs $\approx 19\%$

This discount is applied **multiplicatively** to the next-stage continuation value at each backward step.

When $r_f = 0$, the formulas reduce to the undiscounted case.

### Implementation

```python
def compute_continuation_values(
    jurisdiction: str,
    arb_won: Optional[bool],
    expected_quantum_cr: float,
    soc_value_cr: float,
    risk_free_rate: float = 0.07,
) -> Dict[str, Dict[str, float]]:
    """
    Compute V_C(s) and V_R(s) at each stage via backward induction
    with time-value discounting.
    
    Returns dict mapping stage_name → {"v_claimant": float, "v_respondent": float}
    """
    stages = get_challenge_stages(jurisdiction)
    paths = get_path_table(jurisdiction, arb_won)
    
    # Terminal value
    p_win = sum(p.prob for p in paths if p.outcome == "TRUE_WIN")
    v_terminal = p_win * expected_quantum_cr
    
    # Backward induction
    values = {}
    v_c_next = v_terminal
    v_r_next = v_terminal  # At terminal, V_R = V_C
    
    for stage in reversed(stages):
        stage_cost_c = get_stage_legal_cost(stage)
        stage_cost_r = get_respondent_stage_cost(stage)
        stage_survival = estimate_stage_survival(stage, paths)
        
        # Time-value discount factor for this stage
        dt_months = get_expected_stage_duration(stage)
        df = math.exp(-risk_free_rate * dt_months / 12.0)
        
        v_c = stage_survival * v_c_next * df - stage_cost_c
        v_r = stage_survival * v_r_next * df + stage_cost_r
        
        values[stage] = {"v_claimant": v_c, "v_respondent": v_r}
        v_c_next, v_r_next = v_c, v_r
    
    return values


def compute_game_theoretic_discount(
    jurisdiction: str,
    arb_won: Optional[bool],
    expected_quantum_cr: float,
    soc_value_cr: float,
    bargaining_power: float = 0.5,
) -> Dict[str, float]:
    """
    Compute Nash Bargaining discount factor δ* at each stage.
    
    δ*(s) = (V_C(s) + α × (V_R(s) - V_C(s))) / Q_ref
    """
    cont_vals = compute_continuation_values(
        jurisdiction, arb_won, expected_quantum_cr, soc_value_cr
    )
    
    q_ref = expected_quantum_cr if arb_won else soc_value_cr * 0.72 * 0.70
    
    discounts = {}
    for stage, vals in cont_vals.items():
        v_c = vals["v_claimant"]
        v_r = vals["v_respondent"]
        surplus = v_r - v_c
        
        s_star = v_c + bargaining_power * surplus
        delta = s_star / q_ref if q_ref > 0 else 0.0
        
        discounts[stage] = max(0.0, min(1.0, delta))
    
    return discounts
```

---

## 5. Reference Quantum Determination

### Pre-Award Regime

No award exists yet. Reference is expected value:

$$
Q_{ref}^{pre} = SOC \times \mathbb{E}[q | \text{WIN}] \times P(\text{WIN})
$$

### Post-Award, Claimant Won

Award exists in claimant's favor:

$$
Q_{ref}^{post,won} = Q_{drawn}
$$

Use the **actual drawn quantum** from MC simulation.

### Post-Award, Claimant Lost

Claimant is challenging adverse award. Reference accounts for:
1. Probability of RESTART
2. Conditional probability of winning re-arbitration
3. Expected re-arbitration quantum

$$
Q_{ref}^{post,lost} = SOC \times \mathbb{E}[q | \text{WIN}] \times P(\text{RE-ARB WIN}) \times P(\text{RESTART})
$$

---

## 6. Legal Cost Truncation

When settlement occurs at elapsed month $T_s$, legal costs are truncated:

```python
def truncate_legal_burn(
    monthly_burn: np.ndarray,
    settlement_month: float,
) -> np.ndarray:
    """
    Zero out legal costs after settlement month.
    """
    truncated = monthly_burn.copy()
    cutoff = int(np.ceil(settlement_month))
    if cutoff < len(truncated):
        truncated[cutoff:] = 0.0
    return truncated
```

---

## 7. Settlement Cash Flow

### Structure After Settlement

```
Month 0: -(upfront + legal_month_0)
Month 1: -(legal_month_1)
...
Month T_s: -(legal_month_Ts) + settlement_amount
Month T_s+1 to T: 0 (no further cash flows)
```

### MOIC/IRR Calculation

Use the truncated cash flow series for settlement paths:

$$
\text{MOIC}_{settled} = \frac{\text{Settlement Amount}}{\text{Total Invested (truncated)}}
$$

---

## 8. Settlement Mode Configuration

### Mode 1: Disabled

```python
SETTLEMENT_ENABLED = False
```

No settlement attempts are made. All paths run to judicial resolution.

### Mode 2: User-Specified Ramp

```python
SETTLEMENT_ENABLED = True
SETTLEMENT_MODE = "user_ramp"
SETTLEMENT_DISCOUNT_MIN = 0.40
SETTLEMENT_DISCOUNT_MAX = 0.85
```

Uses linear interpolation between min and max.

### Mode 3: Game-Theoretic

```python
SETTLEMENT_ENABLED = True
SETTLEMENT_MODE = "game_theoretic"
SETTLEMENT_BARGAINING_POWER = 0.50
```

Computes discount via Nash Bargaining Solution.

---

## 9. Calibration Requirements

### Hazard Rate Calibration

Data needed:
- Historical settlement rates by stage
- Settlement timing distribution
- Correlation with claim characteristics

**Challenge**: Settlement data is sparse and confidential.

**Pragmatic approach**: Use expert judgment + sensitivity analysis.

### Discount Factor Calibration

Data needed:
- Historical settlement amounts as fraction of claim/award
- Stage at which settlement occurred
- Negotiation dynamics

**Validation**: Compare model-implied discounts to actual observed settlements.

---

## 10. Sensitivity Analysis

### Key Parameters

| Parameter | Range | Impact |
|-----------|-------|--------|
| $\lambda_s$ (hazard rate) | 0.05 - 0.20 | P(settlement) changes linearly |
| $\delta_{min}$ | 0.30 - 0.50 | Early settlement value |
| $\delta_{max}$ | 0.70 - 0.95 | Late settlement value |
| $\alpha$ (bargaining power) | 0.3 - 0.7 | Settlement amount distribution |

### Scenarios to Test

1. **High settlement scenario**: $\lambda_s = 0.20$ across all stages
2. **No settlement**: $\lambda_s = 0$ (equivalent to disabled)
3. **Claimant weak**: $\alpha = 0.3$
4. **Claimant strong**: $\alpha = 0.7$

---

## 11. Results Data Structure

```python
@dataclass
class SettlementResult:
    settled: bool                      # True if settlement occurred
    settlement_stage: str              # Stage where settlement occurred
    settlement_amount_cr: float        # Amount received (₹ Cr)
    settlement_discount_used: float    # δ applied
    settlement_timing_months: float    # Months from start
    settlement_mode: str               # "user_ramp" or "game_theoretic"
    reference_quantum_cr: float        # Q_ref used for discount calc
    claimant_continuation_value: Optional[float]  # V_C(s) if game-theoretic
    respondent_continuation_value: Optional[float]  # V_R(s) if game-theoretic
```

---

## 12. Limitations & Future Enhancements

### Current Limitations

1. **No strategic modeling**: Parties are modeled as accepting settlement mechanically, not strategically.

2. **No information asymmetry**: Both parties assumed to have same continuation value estimates.

3. **No reputation effects**: Settlement on one claim doesn't affect others.

4. **No funder consent**: Model assumes funder approves all settlements.

### Future Enhancements

1. **Sequential equilibrium model**: Model parties' strategic behavior as game nodes.

2. **Learning dynamics**: Update settlement parameters as claims resolve.

3. **Multi-claim settlement**: Joint settlement across multiple claims with correlation effects.
