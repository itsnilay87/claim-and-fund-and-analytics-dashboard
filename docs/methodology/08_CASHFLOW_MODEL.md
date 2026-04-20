# Cashflow Model Specification

> **Document**: 08_CASHFLOW_MODEL.md  
> **Version**: 2.0  
> **Scope**: Investment structures, cash flow construction, waterfall distributions

---

## 1. Cashflow Framework

### Funder's Cash Flow Profile

Litigation funding involves:

1. **Outflows (negative cash flows)**:
   - Upfront investment premium
   - Monthly legal cost burn
   - Disbursements, insurance, monitoring

2. **Inflows (positive cash flows)**:
   - Recovery at resolution (if WIN/settlement)
   - Interim distributions (rare)
   - Interest component of recovery

### Timeline-Based Model

Cash flows occur over a 96-month maximum horizon:

$$
CF_t = \begin{cases}
-\text{Investment}_t - \text{LegalCost}_t & \text{if } t < T_{resolution} \\
\text{Recovery}_t - \text{Tax}_t & \text{if } t = T_{payment} \\
0 & \text{otherwise}
\end{cases}
$$

---

## 2. Investment Structures

### Structure 1: Litigation Funding

The funder provides capital for legal costs and receives a portion of recovery.

**Cash Flows**:
- Month 0: $-\text{Upfront Premium}$
- Months 1 to $T$: $-\text{Legal Cost}_t$
- Month $T_{payment}$: $+\text{Funder Share} \times \text{Recovery}$

**Funder Share Calculation**:

$$
\text{Funder Share} = \min\left(\frac{\text{Multiple} \times \text{Total Deployed}}{\text{Recovery}}, \text{Cap Rate}\right)
$$

where:
- Multiple = Target return multiple (e.g., 3.0x)
- Total Deployed = Upfront + cumulative legal costs
- Cap Rate = Maximum percentage of recovery (e.g., 50%)

### Structure 2: Monetisation - Full Purchase

Funder purchases the claim outright for upfront price.

**Cash Flows**:
- Month 0: $-\text{Purchase Price}$
- Month 0: $-\text{Legal Cost Reserve}$ (if structured)
- Months 1 to $T$: $-\text{Legal Cost}_t$
- Month $T_{payment}$: $+\text{Recovery}$ (100% to funder)

**Purchase Price**:

$$
\text{Purchase Price} = \delta \times \mathbb{E}[\text{Recovery}]
$$

where $\delta \in (0.3, 0.6)$ is the purchase discount.

### Structure 3: Monetisation - Upfront + Tail

Hybrid: Partial purchase plus retained interest.

**Cash Flows**:
- Month 0: $-\text{Upfront Payment}$
- Months 1 to $T$: Legal costs split or funder-funded
- Month $T_{payment}$: $+\alpha \times \text{Recovery}$ where $\alpha$ is funder's share

**Share Split**:

$$
\alpha = \frac{\text{Upfront Payment}}{\text{Purchase Price}_{full}} + \text{Tail Rate}
$$

### Structure 4: Staged Investment

Capital deployed in stages based on milestones.

**Milestones**:
- Stage 1: Initial funding (signing fee for legal engagement)
- Stage 2: Arbitration commencement
- Stage 3: Hearing stage
- Stage 4: Post-award enforcement

**Cash Flows**:
- Each stage: $-\text{Stage Commitment}_s$
- Month $T_{payment}$: $+\text{Funder Share} \times \text{Recovery}$

---

## 3. Monthly Cashflow Construction

### Algorithm

```python
def construct_monthly_cashflows(
    investment_structure: InvestmentStructure,
    path: PathOutcome,
    timeline: TimelineResult,
    legal_costs: LegalCostResult,
    recovery: RecoveryResult,
) -> np.ndarray:
    """
    Construct monthly cash flow vector for a path.
    
    Returns
    -------
    cashflows : np.ndarray
        Shape (96,), monthly cash flows (positive = inflow)
    """
    cf = np.zeros(96)
    
    # Month 0: Upfront investment
    cf[0] -= investment_structure.upfront_cr
    
    # Legal costs: Apply negative cash flows
    cf -= legal_costs.monthly_burn
    
    # Recovery: Apply at payment month
    if path.outcome in ("TRUE_WIN", "SETTLED"):
        payment_month = int(np.floor(timeline.payment_month))
        payment_month = min(payment_month, 95)
        
        funder_recovery = compute_funder_share(
            investment_structure,
            recovery.total_recovery_cr,
            legal_costs.total_cost_cr + investment_structure.upfront_cr,
        )
        cf[payment_month] += funder_recovery
    
    return cf
```

### Funder Share Computation

```python
def compute_funder_share(
    structure: InvestmentStructure,
    total_recovery_cr: float,
    total_deployed_cr: float,
) -> float:
    """
    Compute funder's share of recovery based on structure.
    
    Returns
    -------
    funder_recovery_cr : float
        Amount funder receives (₹ Cr)
    """
    if structure.type == "litigation_funding":
        # Multiple of deployed up to cap
        target = structure.target_multiple * total_deployed_cr
        capped = min(target, structure.cap_rate * total_recovery_cr)
        return min(capped, total_recovery_cr)  # Can't exceed recovery
    
    elif structure.type == "full_purchase":
        # 100% of recovery to funder
        return total_recovery_cr
    
    elif structure.type == "upfront_tail":
        # Fixed percentage share
        return structure.funder_share_pct * total_recovery_cr
    
    elif structure.type == "staged":
        return compute_staged_share(structure, total_recovery_cr, total_deployed_cr)
    
    else:
        raise ValueError(f"Unknown structure: {structure.type}")
```

---

## 4. Waterfall Distribution

### Priority Structure

For multi-party transactions with waterfall:

```
Priority 1: Return of invested capital (Funder)
Priority 2: Preferred return (e.g., 12% IRR hurdle)
Priority 3: Legal fee arrears (if success-fee counsel)
Priority 4: Residual split (e.g., 70/30 Claimant/Funder)
```

### Waterfall Algorithm

```python
def apply_waterfall(
    recovery_cr: float,
    invested_capital_cr: float,
    preferred_rate: float,
    years: float,
    residual_split_funder: float,
) -> WaterfallResult:
    """
    Apply waterfall distribution to recovery.
    
    Returns
    -------
    WaterfallResult
        Breakdown by priority tier
    """
    remaining = recovery_cr
    
    # Priority 1: Return of capital
    capital_return = min(invested_capital_cr, remaining)
    remaining -= capital_return
    
    # Priority 2: Preferred return (simple)
    preferred_amt = invested_capital_cr * preferred_rate * years
    preferred_paid = min(preferred_amt, remaining)
    remaining -= preferred_paid
    
    # Priority 3: Skip for now (no success-fee counsel)
    
    # Priority 4: Residual split
    funder_residual = remaining * residual_split_funder
    claimant_residual = remaining * (1 - residual_split_funder)
    
    funder_total = capital_return + preferred_paid + funder_residual
    claimant_total = claimant_residual
    
    return WaterfallResult(
        capital_return_cr=capital_return,
        preferred_return_cr=preferred_paid,
        funder_residual_cr=funder_residual,
        claimant_residual_cr=claimant_residual,
        funder_total_cr=funder_total,
        claimant_total_cr=claimant_total,
    )
```

---

## 5. Currency Handling

### Multi-Currency Claims

Construction arbitration often involves:
- Claim in USD (FIDIC contracts)
- Legal costs in INR
- Recovery in USD, converted to INR

### FX Conversion

```python
def convert_cashflows_to_base_currency(
    cashflows: Dict[str, np.ndarray],  # currency → monthly CF
    fx_rates: Dict[str, float],         # currency → base rate
    base_currency: str = "INR",
) -> np.ndarray:
    """
    Convert all currency cash flows to base currency.
    
    Returns
    -------
    consolidated : np.ndarray
        All cash flows in base currency
    """
    consolidated = np.zeros(96)
    
    for currency, cf in cashflows.items():
        if currency == base_currency:
            consolidated += cf
        else:
            rate = fx_rates.get(f"{currency}/{base_currency}", 1.0)
            consolidated += cf * rate
    
    return consolidated
```

### FX Risk

**Current Model**: Static FX rate (no stochastic FX).

**Future Enhancement**: Model FX as correlated stochastic process.

---

## 6. Loss Scenarios

### Claimant Loses

When path.outcome == "LOSE":

```python
cf = np.zeros(96)
cf[0] -= upfront_cr
cf -= legal_costs.monthly_burn

# No positive recovery
# Total loss = upfront + legal costs
```

### Recovery Metrics for Loss

- MOIC = 0
- IRR = undefined (or -100%)
- Total Loss = sum of deployed capital

### Adverse Costs (if applicable)

```python
# Additional outflow at resolution
adverse_month = int(timeline.resolution_month)
cf[adverse_month] -= adverse_cost_cr
```

---

## 7. Settlement Cash Flows

### Settlement Before Award

```python
def construct_settlement_cashflows(
    settlement: SettlementResult,
    investment_structure: InvestmentStructure,
    legal_costs: LegalCostResult,
) -> np.ndarray:
    """
    Construct cash flows for settlement path.
    
    Truncates legal costs at settlement date and applies
    recovery at settlement month.
    """
    cf = np.zeros(96)
    
    # Upfront
    cf[0] -= investment_structure.upfront_cr
    
    # Truncated legal costs
    truncated_burn = truncate_at(
        legal_costs.monthly_burn,
        settlement.timing_months
    )
    cf -= truncated_burn
    
    # Settlement payment
    settlement_month = int(np.floor(settlement.timing_months))
    settlement_month = min(settlement_month, 95)
    
    total_deployed = investment_structure.upfront_cr + truncated_burn.sum()
    funder_share = compute_funder_share(
        investment_structure,
        settlement.amount_cr,
        total_deployed,
    )
    cf[settlement_month] += funder_share
    
    return cf
```

---

## 8. Discounting & Present Value

### Time Value of Money

For present value calculations:

$$
PV = \sum_{t=0}^{95} \frac{CF_t}{(1 + r/12)^t}
$$

where $r$ = annual discount rate.

### NPV Calculation

```python
def compute_npv(
    cashflows: np.ndarray,
    annual_discount_rate: float = 0.10,
) -> float:
    """
    Compute Net Present Value of cash flow stream.
    
    Parameters
    ----------
    annual_discount_rate : float
        Discount rate (e.g., 0.10 for 10%)
    
    Returns
    -------
    npv : float
        Net present value in same units as cashflows
    """
    monthly_rate = (1 + annual_discount_rate) ** (1/12) - 1
    
    discount_factors = (1 + monthly_rate) ** (-np.arange(96))
    
    return np.sum(cashflows * discount_factors)
```

---

## 9. Cash Flow Aggregation

### Portfolio-Level Cash Flows

For multiple claims in a portfolio:

```python
def aggregate_portfolio_cashflows(
    claim_cashflows: List[np.ndarray],
    weights: Optional[List[float]] = None,
) -> np.ndarray:
    """
    Aggregate cash flows across multiple claims.
    
    Returns
    -------
    portfolio_cf : np.ndarray
        Shape (96,), sum of claim cash flows
    """
    if weights is None:
        weights = [1.0] * len(claim_cashflows)
    
    portfolio_cf = np.zeros(96)
    
    for cf, w in zip(claim_cashflows, weights):
        portfolio_cf += cf * w
    
    return portfolio_cf
```

### Expected Cash Flow Profile

Monte Carlo provides distribution at each month:

```python
def compute_expected_cashflows(
    all_path_cashflows: List[np.ndarray],
    path_probabilities: List[float],
) -> np.ndarray:
    """
    Compute probability-weighted expected cash flows.
    """
    weighted = np.zeros(96)
    
    for cf, prob in zip(all_path_cashflows, path_probabilities):
        weighted += cf * prob
    
    return weighted
```

---

## 10. Data Structures

```python
@dataclass
class InvestmentStructure:
    """Investment structure configuration."""
    
    type: Literal["litigation_funding", "full_purchase", "upfront_tail", "staged"]
    
    upfront_cr: float                         # Initial investment
    
    # Litigation funding
    target_multiple: float = 3.0              # Target return multiple
    cap_rate: float = 0.50                    # Max % of recovery
    
    # Full purchase
    purchase_discount: float = 0.40           # Purchase price = discount × E[recovery]
    
    # Upfront + tail
    funder_share_pct: float = 0.60
    
    # Staged
    stage_amounts: Optional[Dict[str, float]] = None


@dataclass
class CashflowResult:
    """Cash flow computation result."""
    
    monthly_cashflows: np.ndarray             # Shape (96,)
    total_outflows_cr: float                  # Sum of negative CF
    total_inflows_cr: float                   # Sum of positive CF
    net_cashflow_cr: float                    # Inflows - outflows
    
    # Timing
    first_outflow_month: int = 0
    last_outflow_month: int = 0
    recovery_month: Optional[int] = None
    
    # Structure-specific
    funder_share_cr: float = 0.0
    claimant_share_cr: float = 0.0


@dataclass
class WaterfallResult:
    """Waterfall distribution result."""
    
    capital_return_cr: float
    preferred_return_cr: float
    funder_residual_cr: float
    claimant_residual_cr: float
    funder_total_cr: float
    claimant_total_cr: float
```

---

## 11. Validation & Constraints

### Conservation Check

Total recovery must equal sum of distributions:

$$
\text{Recovery} = \text{Funder Share} + \text{Claimant Share} + \text{Fees}
$$

```python
def validate_cashflow_conservation(
    recovery_cr: float,
    funder_share_cr: float,
    claimant_share_cr: float,
    fees_cr: float = 0.0,
    tolerance: float = 0.001,
) -> bool:
    """Verify cash flow conservation."""
    total_distributed = funder_share_cr + claimant_share_cr + fees_cr
    return abs(recovery_cr - total_distributed) < tolerance * recovery_cr
```

### Non-Negativity

- Funder share ≥ 0
- Claimant share ≥ 0
- Total outflows ≤ fund capacity

---

## 12. Calibration & Configuration

### Default Structure Parameters

| Parameter | Default | Range |
|-----------|---------|-------|
| Upfront premium | 5% of SOC | 2-10% |
| Target multiple | 3.0x | 2.5-4.0x |
| Cap rate | 50% | 30-60% |
| Purchase discount | 40% | 30-50% |
| Preferred return | 15% | 10-20% |
| Residual split | 70/30 | 60/40 - 80/20 |

---

## 13. Limitations & Future Work

### Current Limitations

1. **Static rates**: FX and discount rates don't evolve
2. **No interim distributions**: No partial recoveries modeled
3. **No tax modeling**: Tax impacts not considered
4. **No drawdown modeling**: All capital assumed deployed month 0

### Future Enhancements

1. **Stochastic FX**: Model currency risk
2. **Tax integration**: Incorporate tax timing and rates
3. **Fund-level constraints**: Model fund lifecycle and recycling
4. **Financing costs**: Include cost of capital in cash flows
