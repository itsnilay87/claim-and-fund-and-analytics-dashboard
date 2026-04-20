# Legal Cost Model Specification

> **Document**: 06_LEGAL_COST_MODEL.md  
> **Version**: 2.0  
> **Scope**: Legal fee structures, cost burn modeling, stochastic overruns

---

## 1. Legal Costs in Litigation Funding

### Cost Categories

| Category | Description | Who Pays |
|----------|-------------|----------|
| **Legal fees** | Counsel hourly/fixed fees | Funder |
| **Disbursements** | Experts, translation, travel | Funder |
| **Tribunal fees** | Arbitrator fees, admin fees | Funder |
| **Enforcement costs** | Post-award collection | Funder |
| **Adverse costs** | If claimant loses (rare in arb) | Funder (if ordered) |

### Funder Perspective

Legal costs are **invested capital**:

$$
\text{Total Investment} = \text{Upfront Premium} + \sum_{t=1}^{T} \text{Legal Cost}_t
$$

---

## 2. Fee Structure Types

### Type 1: Fixed Stages

Each stage has a fixed fee, payable at stage start.

```yaml
fee_structure: fixed_stages
stages:
  DAB: 10.0           # ₹ Lakhs
  Arbitration: 150.0
  S.34: 40.0
  S.37: 50.0
  SLP: 80.0
```

**Pros**: Simple, predictable  
**Cons**: Ignores duration variability

### Type 2: Monthly Burn Rate

Constant monthly fee throughout case lifecycle.

```yaml
fee_structure: monthly_burn
monthly_rate: 5.0     # ₹ Lakhs/month
```

**Total Cost**: $C_{legal} = \text{rate} \times T_{resolution}$

### Type 3: Stage-Specific Burn Rates

Different burn rates per stage.

```yaml
fee_structure: stage_burn_rates
rates:
  DAB: 3.0            # ₹ Lakhs/month
  Arbitration: 8.0
  S.34: 4.0
  S.37: 5.0
  SLP: 6.0
```

### Type 4: Hybrid (Fixed + Variable)

Fixed retainer + hourly excess.

```yaml
fee_structure: hybrid
fixed_per_stage:
  DAB: 10.0
  Arbitration: 100.0
hourly_rate: 0.5       # ₹ Lakhs/hour
expected_hours:
  Arbitration: 150
```

---

## 3. Monthly Legal Burn Model

### Framework

Legal costs are distributed across the timeline as a **monthly burn vector**:

$$
\mathbf{B} = [B_1, B_2, \ldots, B_{96}]
$$

where $B_t$ = legal cost incurred in month $t$.

### Stage-Based Construction

```python
def construct_legal_burn(
    stage_sequence: List[str],
    stage_timings: Dict[str, Tuple[float, float]],  # stage → (start, end)
    burn_rates: Dict[str, float],                    # stage → rate/month
    max_months: int = 96,
) -> np.ndarray:
    """
    Construct monthly legal burn vector from stage sequence.
    
    Returns
    -------
    burn : np.ndarray
        Shape (max_months,), monthly legal cost
    """
    burn = np.zeros(max_months)
    
    for stage in stage_sequence:
        start, end = stage_timings[stage]
        rate = burn_rates.get(stage, 0.0)
        
        # Distribute burn across stage months
        for month in range(int(np.floor(start)), int(np.ceil(end))):
            if month >= max_months:
                break
            fraction = compute_month_fraction(month, start, end)
            burn[month] += rate * fraction
    
    return burn


def compute_month_fraction(
    month: int,
    start: float,
    end: float,
) -> float:
    """Compute fraction of month covered by stage."""
    month_start = float(month)
    month_end = float(month + 1)
    
    overlap_start = max(month_start, start)
    overlap_end = min(month_end, end)
    
    return max(0.0, overlap_end - overlap_start)
```

---

## 4. Cost Overrun Model

### Rationale

Legal costs often exceed budget:
- Discovery expansion
- Additional hearings
- Expert scope creep
- Unforeseen procedural issues

### Overrun Distribution

Model overrun multiplier $\Omega$ as **Beta distribution**:

$$
\Omega \sim \text{Beta}(\alpha, \beta) \text{ scaled to } [1, \omega_{max}]
$$

where:
- $\alpha, \beta$ = shape parameters (empirical: $\alpha=2, \beta=5$)
- $\omega_{max}$ = maximum overrun factor (e.g., 2.0 = 100% overrun)

### Transformed Beta

To map $\text{Beta}(\alpha, \beta) \in [0, 1]$ to $[1, \omega_{max}]$:

$$
\Omega = 1 + (\omega_{max} - 1) \times X, \quad X \sim \text{Beta}(\alpha, \beta)
$$

### Statistics

With $\alpha = 2, \beta = 5, \omega_{max} = 2.0$:

- $\mathbb{E}[\Omega] = 1 + (2-1) \times \frac{2}{2+5} = 1.286$ (28.6% expected overrun)
- $\text{Median}[\Omega] \approx 1.24$
- $P(\Omega > 1.5) \approx 12\%$ (50%+ overrun)
- $P(\Omega > 1.8) \approx 3\%$ (80%+ overrun)

### Application

```python
def sample_legal_cost_overrun(
    base_cost: float,
    alpha: float = 2.0,
    beta: float = 5.0,
    omega_max: float = 2.0,
    rng: Generator,
) -> float:
    """
    Sample realized legal cost with overrun.
    
    Returns
    -------
    realized_cost : float
        Base cost × overrun multiplier
    """
    x = rng.beta(alpha, beta)
    omega = 1.0 + (omega_max - 1.0) * x
    
    return base_cost * omega
```

---

## 5. Jurisdiction-Specific Defaults

### Indian Domestic

| Stage | Base Burn Rate (₹ Lakhs/month) | Notes |
|-------|--------------------------------|-------|
| DAB | 3.0 | Lower complexity |
| Arbitration | 8.0 | High activity |
| S.34 | 4.0 | Court proceedings |
| S.37 | 5.0 | Appeal proceedings |
| SLP | 6.0 | Supreme Court expertise |

**Expected Total**: For 48-month case ≈ ₹ 2.0 - 3.5 Cr

### SIAC Singapore

| Stage | Base Burn Rate (SGD K/month) | Notes |
|-------|------------------------------|-------|
| Arbitration | 80.0 | Singapore rates higher |
| HC | 40.0 | Court setting aside |
| COA | 50.0 | Appeal costs |

### HKIAC Hong Kong

| Stage | Base Burn Rate (HKD K/month) | Notes |
|-------|------------------------------|-------|
| Arbitration | 600.0 | HK rates premium |
| CFI | 300.0 | |
| CA | 400.0 | |
| CFA | 500.0 | Supreme court specialists |

---

## 6. Fee Scaling Models

### Scale with Claim Size

For large claims, legal costs scale (but sub-linearly):

$$
C_{legal} = C_{base} \times \left(\frac{SOC}{SOC_{ref}}\right)^\gamma
$$

where:
- $SOC_{ref}$ = reference claim size (e.g., ₹50 Cr)
- $\gamma$ = scaling exponent (typically 0.3-0.5)

**Rationale**: Large claims require more preparation, but fixed costs dominate.

### Implementation

```python
def scale_legal_costs(
    base_cost: float,
    soc: float,
    soc_ref: float = 50.0,  # ₹ Cr
    gamma: float = 0.4,
) -> float:
    """Scale base legal cost by claim size."""
    return base_cost * (soc / soc_ref) ** gamma
```

---

## 7. Adverse Cost Risk

### When Adverse Costs Apply

| Jurisdiction | Adverse Cost Rule |
|--------------|-------------------|
| Indian Domestic | Generally each party bears own costs |
| SIAC | "Costs follow event" - loser may pay |
| HKIAC | "Costs follow event" with exceptions |

### Modeling Adverse Costs

```python
def sample_adverse_costs(
    jurisdiction: str,
    path_outcome: str,
    opponent_legal_cost_cr: float,
    rng: Generator,
) -> float:
    """
    Sample adverse costs if claimant loses.
    
    Returns
    -------
    adverse_cost : float
        Additional cost burden (₹ Cr)
    """
    if path_outcome == "WIN":
        return 0.0  # No adverse costs when winning
    
    # Get probability of adverse cost order
    p_adverse = get_adverse_cost_prob(jurisdiction)
    
    if rng.random() >= p_adverse:
        return 0.0  # No order
    
    # Proportion of opponent's costs awarded
    proportion = rng.uniform(0.5, 0.8)
    
    return opponent_legal_cost_cr * proportion
```

### Default Probabilities

| Jurisdiction | P(Adverse Cost Order | LOSE) |
|--------------|----------------------|
| Indian Domestic | 0.10 |
| SIAC | 0.60 |
| HKIAC | 0.55 |

---

## 8. Third-Party Funding Costs

### Funders' Own Costs

The funder incurs costs beyond legal fees:
- Due diligence costs
- Monitoring costs
- ATE insurance premiums

### After-the-Event (ATE) Insurance

Insurance against adverse costs risk:

```python
def compute_ate_premium(
    max_adverse_exposure: float,
    coverage_limit: float,
    premium_rate: float = 0.25,
) -> float:
    """
    Compute ATE insurance premium.
    
    Typical premium: 25-35% of coverage limit
    """
    coverage = min(max_adverse_exposure, coverage_limit)
    return coverage * premium_rate
```

---

## 9. Cost Accumulation Algorithm

### Per-Path Cost Calculation

```python
def compute_path_legal_costs(
    path: PathOutcome,
    timeline: TimelineResult,
    burn_rates: Dict[str, float],
    overrun_config: OverrunConfig,
    rng: Generator,
) -> LegalCostResult:
    """
    Compute total legal costs for a path.
    
    Returns
    -------
    LegalCostResult
        Monthly burn vector, total cost, overrun multiplier
    """
    # Construct stage timings
    stage_timings = construct_stage_intervals(
        path.stage_sequence,
        timeline.stage_start_months,
        timeline.stage_durations,
    )
    
    # Build base monthly burn
    base_burn = construct_legal_burn(
        path.stage_sequence,
        stage_timings,
        burn_rates,
    )
    
    # Sample overrun
    omega = sample_overrun(
        overrun_config.alpha,
        overrun_config.beta,
        overrun_config.max_overrun,
        rng,
    )
    
    # Apply overrun
    realized_burn = base_burn * omega
    
    # Truncate at resolution/settlement
    effective_end = get_effective_end_month(path, timeline)
    truncated_burn = truncate_burn_at(realized_burn, effective_end)
    
    return LegalCostResult(
        monthly_burn=truncated_burn,
        total_cost=truncated_burn.sum(),
        overrun_multiplier=omega,
        base_cost=base_burn.sum(),
    )
```

### Settlement Truncation

When settlement occurs at month $T_s$:

```python
def truncate_burn_at(
    burn: np.ndarray,
    end_month: float,
) -> np.ndarray:
    """Zero out legal burn after end_month."""
    truncated = burn.copy()
    cutoff = int(np.ceil(end_month))
    if cutoff < len(truncated):
        truncated[cutoff:] = 0.0
    return truncated
```

---

## 10. Data Structures

```python
@dataclass
class LegalCostConfig:
    """Configuration for legal cost model."""
    
    fee_structure: Literal["fixed_stages", "monthly_burn", "stage_burn_rates", "hybrid"]
    
    # For monthly_burn
    monthly_rate_cr: Optional[float] = None
    
    # For stage_burn_rates
    stage_rates_cr: Optional[Dict[str, float]] = None
    
    # For fixed_stages
    stage_fixed_cr: Optional[Dict[str, float]] = None
    
    # Overrun parameters
    overrun_enabled: bool = True
    overrun_alpha: float = 2.0
    overrun_beta: float = 5.0
    overrun_max: float = 2.0
    
    # Scaling
    soc_scaling_enabled: bool = False
    soc_ref_cr: float = 50.0
    soc_gamma: float = 0.4


@dataclass
class LegalCostResult:
    """Legal cost computation result."""
    
    monthly_burn: np.ndarray          # shape (96,)
    total_cost_cr: float              # Sum of burn
    base_cost_cr: float               # Before overrun
    overrun_multiplier: float         # Omega applied
    stage_costs: Dict[str, float]     # Per-stage breakdown
    adverse_cost_cr: float = 0.0      # If losing
```

---

## 11. Calibration Guidance

### Data Sources

| Source | What It Provides |
|--------|------------------|
| Historical matters | Actual vs budgeted costs |
| Law firm fee quotes | Stage-by-stage estimates |
| Arbitration institution schedules | Tribunal fee scales |
| Industry surveys | Average costs by jurisdiction |

### Calibration Process

1. **Collect** historical cost data for similar claims
2. **Compute** actual/budget ratio for overrun calibration
3. **Estimate** stage burn rates from payment schedules
4. **Fit** Beta distribution to overrun ratio data
5. **Validate** against hold-out sample

### Validation Metrics

- Mean Absolute Percentage Error (MAPE) < 20%
- 90% of actual costs within model's 5th-95th percentile
- No systematic bias (over/under estimation)

---

## 12. Sensitivity Analysis

### Key Parameters

| Parameter | Range | Impact |
|-----------|-------|--------|
| Monthly burn rate | ±50% | Linear on total cost |
| Overrun max ($\omega_{max}$) | 1.5 - 3.0 | Tail outcomes |
| Overrun shape ($\alpha, \beta$) | Various | Cost distribution skew |
| SOC scaling ($\gamma$) | 0.2 - 0.6 | Large claim economics |

### Scenarios

1. **Conservative**: High burn rates, $\omega_{max} = 2.5$
2. **Base**: Default parameters
3. **Optimistic**: Low burn rates, $\omega_{max} = 1.5$

---

## 13. Limitations & Future Work

### Current Limitations

1. **No counsel efficiency modeling**: All lawyers assumed similarly efficient
2. **No scope creep dynamics**: Overrun is static multiplier
3. **No milestone-based fees**: All fees are time-based
4. **Currency risk**: Fees in different currencies not modeled

### Future Enhancements

1. **Dynamic cost evolution**: Update burn rates based on case developments
2. **Success fees**: Model contingency fee arrangements
3. **Multi-currency**: Handle GBP, USD, SGD, HKD fee payments
4. **Lawyer selection**: Different burn profiles for different counsel
