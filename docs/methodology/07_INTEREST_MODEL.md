# Interest Model Specification

> **Document**: 07_INTEREST_MODEL.md  
> **Version**: 2.0  
> **Scope**: Pre-award interest, post-award interest, statutory rates, compound vs simple interest

---

## 1. Interest in Arbitration Awards

### Types of Interest

| Type | Period | Governed By |
|------|--------|-------------|
| **Pendente lite** | Claim date → Award date | Contract / Tribunal discretion |
| **Post-award / Pre-judgment** | Award date → Judgment date | Statute / Tribunal discretion |
| **Post-judgment** | Judgment date → Payment | Statutory (usually) |

### Economic Significance

For long-running disputes, interest can exceed 50% of principal:

$$
\text{Total Recovery} = Q_{principal} + I_{pendente} + I_{post-award}
$$

---

## 2. Statutory Interest Rates

### India - Interest Act 1978 / Arbitration Act 1996

| Period | Rate | Basis |
|--------|------|-------|
| Pre-award | Contract rate or 12% p.a. (simple) | S.31(7)(a) |
| Post-award | 2% above current rate, typically 18% p.a. | S.31(7)(b) |

**Note**: Tribunals have discretion; rates vary by case.

### Singapore - IAA

| Period | Rate | Basis |
|--------|------|-------|
| Pre-award | Tribunal discretion | Often contractual |
| Post-award | 5.33% p.a. (statutory) | Supreme Court of Judicature Act |

### Hong Kong

| Period | Rate | Basis |
|--------|------|-------|
| Pre-award | Tribunal discretion | Contract or reasonable rate |
| Post-award | Judgment rate (currently 8% p.a.) | High Court Ordinance |

---

## 3. Interest Calculation Methods

### Simple Interest

$$
I_{simple} = P \times r \times t
$$

where:
- $P$ = Principal
- $r$ = Annual interest rate (decimal)
- $t$ = Time in years

### Compound Interest

$$
I_{compound} = P \times \left[(1 + r)^t - 1\right]
$$

or with compounding frequency $n$:

$$
I_{compound} = P \times \left[\left(1 + \frac{r}{n}\right)^{n \times t} - 1\right]
$$

### Indian Practice

Most Indian tribunals award **simple interest** on principal, though compound interest is sometimes awarded on delayed payment.

---

## 4. Interest Tranches Model

### Multi-Tranche Framework

Arbitration awards often involve multiple payment dates with interest accruing from different reference dates:

```
Tranche 1: Principal   = ₹50 Cr, Reference Date = 2018-01-01
Tranche 2: Principal   = ₹30 Cr, Reference Date = 2019-06-15
Tranche 3: Retention   = ₹10 Cr, Reference Date = 2020-03-01
```

### Data Structure

```python
@dataclass
class InterestTranche:
    """Individual interest tranche."""
    
    principal_cr: float              # Principal amount (₹ Cr)
    reference_date: date             # Date from which interest accrues
    rate_pct_annual: float           # Interest rate (%, not decimal)
    compound_frequency: int = 0      # 0=simple, 1=annual, 12=monthly
    label: str = ""                  # Description


@dataclass
class InterestConfiguration:
    """Complete interest configuration for a claim."""
    
    tranches: List[InterestTranche]
    post_award_rate_pct: float = 18.0      # Post-award statutory rate
    post_award_compound: bool = False
    post_judgment_rate_pct: float = 18.0   # Post-judgment rate
```

---

## 5. Interest Calculation Algorithm

### Pre-Award Interest

For each tranche, calculate interest from reference_date to award_date:

```python
def compute_pre_award_interest(
    tranche: InterestTranche,
    reference_date: date,
    award_date: date,
) -> float:
    """
    Compute pendente lite interest for one tranche.
    
    Returns
    -------
    interest_cr : float
        Accrued interest (₹ Cr)
    """
    # Time in years
    days = (award_date - reference_date).days
    years = days / 365.25
    
    if years <= 0:
        return 0.0
    
    rate = tranche.rate_pct_annual / 100.0
    
    if tranche.compound_frequency == 0:
        # Simple interest
        return tranche.principal_cr * rate * years
    else:
        # Compound interest
        n = tranche.compound_frequency
        return tranche.principal_cr * ((1 + rate / n) ** (n * years) - 1)
```

### Post-Award Interest

Interest accruing between award and resolution:

```python
def compute_post_award_interest(
    principal_cr: float,
    pendente_interest_cr: float,
    award_date: date,
    resolution_date: date,
    rate_pct: float = 18.0,
    compound: bool = False,
) -> float:
    """
    Compute post-award interest.
    
    Post-award interest typically accrues on (principal + pendente interest).
    """
    # Base for post-award interest
    base = principal_cr + pendente_interest_cr
    
    days = (resolution_date - award_date).days
    years = days / 365.25
    
    if years <= 0:
        return 0.0
    
    rate = rate_pct / 100.0
    
    if compound:
        return base * ((1 + rate) ** years - 1)
    else:
        return base * rate * years
```

### Total Interest

```python
def compute_total_interest(
    config: InterestConfiguration,
    claim_date: date,
    award_date: date,
    resolution_date: date,
    payment_date: date,
) -> InterestResult:
    """
    Compute all interest components.
    
    Returns
    -------
    InterestResult
        Breakdown of interest by type
    """
    # Pre-award (pendente lite)
    pre_award = sum(
        compute_pre_award_interest(t, t.reference_date, award_date)
        for t in config.tranches
    )
    
    # Total principal
    principal = sum(t.principal_cr for t in config.tranches)
    
    # Post-award (award to resolution)
    post_award = compute_post_award_interest(
        principal_cr=principal,
        pendente_interest_cr=pre_award,
        award_date=award_date,
        resolution_date=resolution_date,
        rate_pct=config.post_award_rate_pct,
        compound=config.post_award_compound,
    )
    
    # Post-judgment (resolution to payment)
    base_for_judgment = principal + pre_award + post_award
    post_judgment = compute_post_judgment_interest(
        base_cr=base_for_judgment,
        resolution_date=resolution_date,
        payment_date=payment_date,
        rate_pct=config.post_judgment_rate_pct,
    )
    
    return InterestResult(
        pre_award_interest_cr=pre_award,
        post_award_interest_cr=post_award,
        post_judgment_interest_cr=post_judgment,
        total_interest_cr=pre_award + post_award + post_judgment,
        total_recovery_cr=principal + pre_award + post_award + post_judgment,
    )
```

---

## 6. Timeline Integration

### With Monte Carlo Simulation

In the MC framework, timeline is stochastic. Interest calculation uses simulated dates:

```python
def compute_interest_for_path(
    path: PathOutcome,
    timeline: TimelineResult,
    interest_config: InterestConfiguration,
    investment_date: date,
    quantum_cr: float,  # Drawn quantum for this path
) -> InterestResult:
    """
    Compute interest for a specific MC path.
    
    Uses the path's realized timeline for date calculations.
    """
    # Convert timeline months to dates
    award_month = timeline.stage_start_months.get("Arbitration_END", 0)
    resolution_month = timeline.resolution_month
    payment_month = timeline.payment_month
    
    award_date = add_months(investment_date, award_month)
    resolution_date = add_months(investment_date, resolution_month)
    payment_date = add_months(investment_date, payment_month)
    
    # Scale tranches to realized quantum
    scaled_config = scale_tranches_to_quantum(
        interest_config,
        target_quantum_cr=quantum_cr,
    )
    
    return compute_total_interest(
        config=scaled_config,
        claim_date=investment_date,  # Approximation
        award_date=award_date,
        resolution_date=resolution_date,
        payment_date=payment_date,
    )
```

### Date Utilities

```python
from dateutil.relativedelta import relativedelta

def add_months(base_date: date, months: float) -> date:
    """Add months to a date, handling partial months."""
    full_months = int(months)
    partial = months - full_months
    
    new_date = base_date + relativedelta(months=full_months)
    
    if partial > 0:
        days_to_add = int(partial * 30)  # Approximate
        new_date += timedelta(days=days_to_add)
    
    return new_date
```

---

## 7. Quantum Proportion Adjustment

### Interest as Fraction of Award

When quantum is sampled stochastically, interest principals should scale proportionally:

$$
Q_{drawn} = q \times SOC
$$

If original interest tranches sum to $SOC$, scale each:

$$
\text{Tranche}_i^{scaled} = \text{Tranche}_i \times \frac{Q_{drawn}}{SOC}
$$

### Implementation

```python
def scale_tranches_to_quantum(
    config: InterestConfiguration,
    target_quantum_cr: float,
) -> InterestConfiguration:
    """
    Scale interest tranches proportionally to match target quantum.
    """
    original_sum = sum(t.principal_cr for t in config.tranches)
    
    if original_sum <= 0:
        return config
    
    scale_factor = target_quantum_cr / original_sum
    
    scaled_tranches = [
        InterestTranche(
            principal_cr=t.principal_cr * scale_factor,
            reference_date=t.reference_date,
            rate_pct_annual=t.rate_pct_annual,
            compound_frequency=t.compound_frequency,
            label=t.label,
        )
        for t in config.tranches
    ]
    
    return InterestConfiguration(
        tranches=scaled_tranches,
        post_award_rate_pct=config.post_award_rate_pct,
        post_award_compound=config.post_award_compound,
        post_judgment_rate_pct=config.post_judgment_rate_pct,
    )
```

---

## 8. Expected Interest Impact

### Analytical Approximation

For a claim with:
- Principal $P$
- Pre-award rate $r_1$
- Post-award rate $r_2$
- Expected time to award $T_1$ years
- Expected time from award to resolution $T_2$ years

$$
\mathbb{E}[I] \approx P \times r_1 \times T_1 + (P + P \times r_1 \times T_1) \times r_2 \times T_2
$$

### Example Calculation

Claim: ₹100 Cr, Pre-award: 12%, Post-award: 18%  
Timeline: 2.5 years to award, 2 years to resolution

$$
I_{pre} = 100 \times 0.12 \times 2.5 = 30 \text{ Cr}
$$

$$
I_{post} = (100 + 30) \times 0.18 \times 2 = 46.8 \text{ Cr}
$$

$$
\text{Total Recovery} = 100 + 30 + 46.8 = 176.8 \text{ Cr}
$$

**Interest adds 76.8% to the principal!**

---

## 9. Lost/Reduced Interest Scenarios

### When Interest May Be Reduced

- **Unjustified delay by claimant**: Tribunal may reduce interest period
- **Contributory conduct**: Partial fault reduces interest
- **Claim exaggeration**: If awarded significantly less than claimed

### Settlement Impact

If settlement occurs pre-award:
- No pendente lite interest (or reduced)
- Settlement amount replaces principal + interest

If settlement occurs post-award:
- Post-award interest truncated at settlement date
- Settlement amount may include partial interest

---

## 10. Data Structures

```python
@dataclass
class InterestResult:
    """Interest calculation result."""
    
    pre_award_interest_cr: float
    post_award_interest_cr: float
    post_judgment_interest_cr: float
    total_interest_cr: float
    
    total_recovery_cr: float          # Principal + all interest
    
    # Diagnostic fields
    pre_award_years: float = 0.0
    post_award_years: float = 0.0
    effective_rate_pct: float = 0.0   # Total interest / principal / years


@dataclass
class InterestConfig:
    """Interest model configuration."""
    
    pre_award_rate_pct: float = 12.0
    pre_award_compound: bool = False
    
    post_award_rate_pct: float = 18.0
    post_award_compound: bool = False
    
    post_judgment_rate_pct: float = 18.0
    
    use_tranches: bool = False
    tranches: Optional[List[InterestTranche]] = None
```

---

## 11. Jurisdiction-Specific Defaults

### Indian Domestic

```yaml
jurisdiction: indian_domestic
pre_award:
  rate: 12.0
  compound: false
  source: "Contract rate or S.31(7)(a)"
post_award:
  rate: 18.0
  compound: false
  source: "S.31(7)(b) - 2% above current rate"
post_judgment:
  rate: 18.0
```

### SIAC Singapore

```yaml
jurisdiction: siac
pre_award:
  rate: 5.33
  compound: false
  source: "Statutory default"
post_award:
  rate: 5.33
  compound: false
post_judgment:
  rate: 5.33
```

### HKIAC Hong Kong

```yaml
jurisdiction: hkiac
pre_award:
  rate: 8.0
  compound: false
post_award:
  rate: 8.0
post_judgment:
  rate: 8.0
  source: "Judgment rate under HCO"
```

---

## 12. Limitations & Future Work

### Current Limitations

1. **Static rates**: Rates don't evolve over claim lifetime
2. **No tribunal discretion modeling**: All paths use same rates
3. **No partial recovery**: Interest assumes full principal recovery
4. **No currency interest**: Multi-currency claims not handled

### Future Enhancements

1. **Rate term structure**: Model rate changes over time
2. **Discretion distribution**: Sample rate from tribunal-dependent distribution
3. **Currency interest**: Handle USD, GBP, SGD with respective rates
4. **Partial award interest**: When only part of claim succeeds
