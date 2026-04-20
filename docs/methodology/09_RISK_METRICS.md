# Risk Metrics Specification

> **Document**: 09_RISK_METRICS.md  
> **Version**: 2.0  
> **Scope**: MOIC, IRR/XIRR, VaR, CVaR, probability distributions, portfolio metrics

---

## 1. Overview of Risk Metrics

### Metric Categories

| Category | Metrics | Purpose |
|----------|---------|---------|
| **Return** | MOIC, IRR, NPV | Measure profitability |
| **Risk** | VaR, CVaR, σ | Measure downside exposure |
| **Probability** | P(Win), P(Profit) | Success likelihood |
| **Distributional** | Percentiles, skewness | Shape of outcomes |

### Monte Carlo Foundation

All metrics are computed from the empirical distribution of MC paths:

$$
\{(CF_i, w_i)\}_{i=1}^{N}
$$

where $CF_i$ is the cash flow vector for path $i$ and $w_i$ is the path probability.

---

## 2. Multiple on Invested Capital (MOIC)

### Definition

$$
\text{MOIC} = \frac{\text{Total Inflows}}{\text{Total Outflows}}
$$

### Per-Path Calculation

```python
def compute_moic(cashflows: np.ndarray) -> float:
    """
    Compute MOIC from monthly cash flow vector.
    
    Returns
    -------
    moic : float
        Multiple on invested capital
    """
    outflows = -np.sum(cashflows[cashflows < 0])
    inflows = np.sum(cashflows[cashflows > 0])
    
    if outflows <= 0:
        return np.nan  # No investment
    
    return inflows / outflows
```

### Interpretation

| MOIC | Meaning |
|------|---------|
| 0.0 | Total loss |
| 0.5 | 50% loss |
| 1.0 | Break-even |
| 2.0 | 2x return (100% profit) |
| 3.0 | 3x return (200% profit) |

### Distribution Statistics

From MC simulation:

```python
def moic_statistics(
    path_moics: List[float],
    path_weights: List[float],
) -> Dict[str, float]:
    """Compute statistical summary of MOIC distribution."""
    arr = np.array(path_moics)
    wts = np.array(path_weights)
    wts = wts / wts.sum()  # Normalize
    
    return {
        "mean": np.average(arr, weights=wts),
        "median": weighted_percentile(arr, wts, 0.50),
        "p10": weighted_percentile(arr, wts, 0.10),
        "p25": weighted_percentile(arr, wts, 0.25),
        "p75": weighted_percentile(arr, wts, 0.75),
        "p90": weighted_percentile(arr, wts, 0.90),
        "std": weighted_std(arr, wts),
        "p_profit": np.sum(wts[arr > 1.0]),
        "p_loss": np.sum(wts[arr < 1.0]),
        "p_total_loss": np.sum(wts[arr == 0.0]),
    }
```

---

## 3. Internal Rate of Return (IRR/XIRR)

### Definition

IRR is the discount rate $r$ that makes NPV = 0:

$$
\text{NPV} = \sum_{t=0}^{T} \frac{CF_t}{(1+r)^{t/12}} = 0
$$

### XIRR for Irregular Timing

When cash flows have irregular timing:

$$
\sum_{i} \frac{CF_i}{(1+r)^{(d_i - d_0)/365}} = 0
$$

where $d_i$ is the date of cash flow $i$.

### Implementation

```python
from scipy.optimize import brentq

def compute_xirr(
    cashflows: List[float],
    dates: List[date],
    guess: float = 0.10,
) -> Optional[float]:
    """
    Compute XIRR (extended IRR) for irregular cash flows.
    
    Returns
    -------
    xirr : float or None
        Annualized IRR, or None if no solution
    """
    if len(cashflows) < 2:
        return None
    
    # Reference date
    d0 = dates[0]
    year_fracs = [(d - d0).days / 365.0 for d in dates]
    
    def npv(r):
        return sum(cf / (1 + r) ** yf for cf, yf in zip(cashflows, year_fracs))
    
    # Search for root
    try:
        # Try range from -90% to +1000%
        return brentq(npv, -0.9, 10.0, xtol=1e-8)
    except ValueError:
        # No root in range
        return None
```

### Monthly IRR (from monthly vector)

```python
def compute_monthly_irr(
    monthly_cashflows: np.ndarray,
) -> Optional[float]:
    """
    Compute monthly IRR and annualize.
    
    Returns
    -------
    annual_irr : float or None
        Annualized IRR
    """
    # Filter to non-zero months
    nonzero_mask = monthly_cashflows != 0
    if nonzero_mask.sum() < 2:
        return None
    
    months = np.where(nonzero_mask)[0]
    values = monthly_cashflows[nonzero_mask]
    
    def npv(r):
        return sum(cf / (1 + r) ** m for cf, m in zip(values, months))
    
    try:
        monthly_irr = brentq(npv, -0.5, 2.0, xtol=1e-10)
        annual_irr = (1 + monthly_irr) ** 12 - 1
        return annual_irr
    except ValueError:
        return None
```

### Handling Edge Cases

| Scenario | IRR |
|----------|-----|
| All negative (total loss) | -100% |
| All positive | Undefined (no sign change) |
| Very high returns | Cap at reasonable max (e.g., 500%) |
| No solution | Report as NaN, use MOIC instead |

---

## 4. Net Present Value (NPV)

### Definition

$$
\text{NPV} = \sum_{t=0}^{T} \frac{CF_t}{(1 + r)^{t/12}}
$$

where $r$ is the annual discount rate.

### Implementation

```python
def compute_npv(
    cashflows: np.ndarray,
    discount_rate: float = 0.10,
) -> float:
    """
    Compute NPV at given discount rate.
    
    Parameters
    ----------
    discount_rate : float
        Annual discount rate (e.g., 0.10 for 10%)
    
    Returns
    -------
    npv : float
        Net present value
    """
    monthly_rate = (1 + discount_rate) ** (1/12) - 1
    months = np.arange(len(cashflows))
    discount_factors = (1 + monthly_rate) ** (-months)
    
    return np.sum(cashflows * discount_factors)
```

---

## 5. Value at Risk (VaR)

### Definition

VaR at confidence level $\alpha$ is the loss exceeded with probability $1 - \alpha$:

$$
P(\text{Loss} \geq \text{VaR}_\alpha) = 1 - \alpha
$$

Or equivalently, the $\alpha$-quantile of the loss distribution.

### MOIC-Based VaR

For litigation funding, express VaR in MOIC terms:

$$
\text{VaR}_\alpha^{MOIC} = \text{percentile}(\text{MOIC}, 1-\alpha)
$$

**Example**: VaR₉₅ MOIC = 0.6 means "95% of outcomes have MOIC ≥ 0.6"

### Dollar VaR

$$
\text{VaR}_\alpha^{\$} = \text{Invested Capital} \times (1 - \text{VaR}_\alpha^{MOIC})
$$

### Implementation

```python
def compute_var(
    outcomes: np.ndarray,
    weights: np.ndarray,
    alpha: float = 0.95,
) -> float:
    """
    Compute Value at Risk at confidence level alpha.
    
    For MOIC: returns the (1-alpha) percentile
    """
    return weighted_percentile(outcomes, weights, 1 - alpha)


def compute_dollar_var(
    moic_var: float,
    invested_capital: float,
) -> float:
    """Convert MOIC VaR to dollar loss."""
    return invested_capital * max(0, 1 - moic_var)
```

---

## 6. Conditional Value at Risk (CVaR / Expected Shortfall)

### Definition

CVaR is the expected value given that we're in the tail:

$$
\text{CVaR}_\alpha = \mathbb{E}[\text{MOIC} | \text{MOIC} \leq \text{VaR}_\alpha]
$$

### Implementation

```python
def compute_cvar(
    outcomes: np.ndarray,
    weights: np.ndarray,
    alpha: float = 0.95,
) -> float:
    """
    Compute Conditional Value at Risk (Expected Shortfall).
    
    Returns expected value in the worst (1-alpha) of outcomes.
    """
    var = compute_var(outcomes, weights, alpha)
    
    # Filter to tail
    tail_mask = outcomes <= var
    tail_outcomes = outcomes[tail_mask]
    tail_weights = weights[tail_mask]
    
    if tail_weights.sum() == 0:
        return var  # Edge case
    
    # Weighted mean of tail
    tail_weights_norm = tail_weights / tail_weights.sum()
    return np.average(tail_outcomes, weights=tail_weights_norm)
```

### Interpretation

- VaR₉₅ = 0.60: "5% probability of MOIC below 0.60"
- CVaR₉₅ = 0.25: "In that worst 5%, average MOIC is 0.25"

---

## 7. Probability Metrics

### Win Probability

$$
P(\text{WIN}) = \sum_{i: \text{outcome}_i = \text{WIN}} w_i
$$

### Profit Probability

$$
P(\text{Profit}) = P(\text{MOIC} > 1) = \sum_{i: \text{MOIC}_i > 1} w_i
$$

### Loss Probability

$$
P(\text{Loss}) = P(\text{MOIC} < 1) = 1 - P(\text{Profit})
$$

### Total Loss Probability

$$
P(\text{Total Loss}) = P(\text{MOIC} = 0)
$$

### Breakeven Probability

$$
P(\text{Breakeven}) = P(\text{MOIC} \geq 1)
$$

### Implementation

```python
def compute_probability_metrics(
    moics: np.ndarray,
    outcomes: List[str],
    weights: np.ndarray,
) -> Dict[str, float]:
    """Compute all probability metrics."""
    wts = weights / weights.sum()
    
    return {
        "p_win": sum(w for o, w in zip(outcomes, wts) if o == "TRUE_WIN"),
        "p_lose": sum(w for o, w in zip(outcomes, wts) if o == "LOSE"),
        "p_settle": sum(w for o, w in zip(outcomes, wts) if o == "SETTLED"),
        
        "p_profit": np.sum(wts[moics > 1.0]),
        "p_loss": np.sum(wts[moics < 1.0]),
        "p_breakeven": np.sum(wts[moics >= 1.0]),
        "p_total_loss": np.sum(wts[moics == 0.0]),
        
        "p_moic_2x": np.sum(wts[moics >= 2.0]),
        "p_moic_3x": np.sum(wts[moics >= 3.0]),
    }
```

---

## 8. Distributional Metrics

### Moments

| Moment | Formula | Interpretation |
|--------|---------|----------------|
| Mean | $\mu = \sum w_i \cdot x_i$ | Expected outcome |
| Variance | $\sigma^2 = \sum w_i \cdot (x_i - \mu)^2$ | Dispersion |
| Skewness | $\gamma_1 = \frac{\sum w_i (x_i-\mu)^3}{\sigma^3}$ | Asymmetry |
| Kurtosis | $\gamma_2 = \frac{\sum w_i (x_i-\mu)^4}{\sigma^4} - 3$ | Tail heaviness |

### Implementation

```python
def compute_distribution_metrics(
    values: np.ndarray,
    weights: np.ndarray,
) -> Dict[str, float]:
    """Compute distributional statistics."""
    wts = weights / weights.sum()
    
    mean = np.average(values, weights=wts)
    variance = np.average((values - mean) ** 2, weights=wts)
    std = np.sqrt(variance)
    
    if std > 0:
        skewness = np.average(((values - mean) / std) ** 3, weights=wts)
        kurtosis = np.average(((values - mean) / std) ** 4, weights=wts) - 3
    else:
        skewness = 0.0
        kurtosis = 0.0
    
    return {
        "mean": mean,
        "std": std,
        "variance": variance,
        "skewness": skewness,
        "kurtosis": kurtosis,
        "cv": std / mean if mean != 0 else np.nan,  # Coefficient of variation
    }
```

### MOIC Distribution Shape

Typical litigation funding MOIC distribution:

- **Bimodal**: Mass at 0 (total loss) and 2-4x (wins)
- **Right-skewed**: Positive skewness from large wins
- **Heavy left tail**: Total loss scenarios

---

## 9. Portfolio Metrics

### Portfolio Diversification

For $n$ claims with correlation $\rho$:

$$
\sigma_P^2 = \sum_{i} w_i^2 \sigma_i^2 + 2 \sum_{i < j} w_i w_j \rho_{ij} \sigma_i \sigma_j
$$

### Diversification Ratio

$$
DR = \frac{\sum_i w_i \sigma_i}{\sigma_P}
$$

Higher DR indicates more diversification benefit.

### Portfolio VaR

Use MC simulation with correlated claim outcomes:

```python
def compute_portfolio_var(
    claim_moics: np.ndarray,       # Shape (n_claims, n_paths)
    claim_weights: np.ndarray,     # Shape (n_claims,) portfolio weights
    path_probabilities: np.ndarray, # Shape (n_paths,)
    alpha: float = 0.95,
) -> float:
    """
    Compute portfolio-level VaR.
    
    Each column represents a joint outcome across all claims.
    """
    # Portfolio MOIC for each path
    portfolio_moics = np.sum(claim_moics * claim_weights[:, np.newaxis], axis=0)
    
    return compute_var(portfolio_moics, path_probabilities, alpha)
```

---

## 10. Sharpe-like Ratios

### Return-to-Risk Ratio

$$
\text{RRR} = \frac{\mathbb{E}[\text{MOIC}] - 1}{\sigma_{MOIC}}
$$

**Interpretation**: Expected excess return (over break-even) per unit risk.

### Sortino-like Ratio

Use only downside deviation:

$$
\text{Sortino} = \frac{\mathbb{E}[\text{MOIC}] - 1}{\sqrt{\mathbb{E}[\min(0, \text{MOIC}-1)^2]}}
$$

### Implementation

```python
def compute_risk_ratios(
    moics: np.ndarray,
    weights: np.ndarray,
) -> Dict[str, float]:
    """Compute risk-adjusted return metrics."""
    wts = weights / weights.sum()
    
    mean = np.average(moics, weights=wts)
    std = np.sqrt(np.average((moics - mean) ** 2, weights=wts))
    
    # Downside deviation (below target = 1.0)
    downside = np.minimum(0, moics - 1.0)
    downside_dev = np.sqrt(np.average(downside ** 2, weights=wts))
    
    return {
        "rrr": (mean - 1) / std if std > 0 else np.nan,
        "sortino": (mean - 1) / downside_dev if downside_dev > 0 else np.nan,
    }
```

---

## 11. Results Data Structure

```python
@dataclass
class RiskMetrics:
    """Complete risk metrics for a claim or portfolio."""
    
    # Return metrics
    moic_mean: float
    moic_median: float
    moic_std: float
    irr_mean: Optional[float]
    irr_median: Optional[float]
    npv_mean: float
    
    # Percentiles
    moic_p5: float
    moic_p10: float
    moic_p25: float
    moic_p75: float
    moic_p90: float
    moic_p95: float
    
    # Risk metrics
    var_95: float
    var_99: float
    cvar_95: float
    cvar_99: float
    
    # Probability metrics
    p_win: float
    p_profit: float
    p_loss: float
    p_total_loss: float
    
    # Distributional
    skewness: float
    kurtosis: float
    
    # Risk-adjusted
    sharpe_like: float
    sortino_like: float
    
    # Monte Carlo info
    n_paths: int
    seed: int


@dataclass
class PortfolioRiskMetrics(RiskMetrics):
    """Extended metrics for portfolio."""
    
    diversification_ratio: float
    marginal_var: Dict[str, float]       # Claim → marginal VaR contribution
    component_var: Dict[str, float]      # Claim → component VaR
```

---

## 12. Weighted Percentile Utility

### Implementation

```python
def weighted_percentile(
    values: np.ndarray,
    weights: np.ndarray,
    percentile: float,
) -> float:
    """
    Compute weighted percentile.
    
    Parameters
    ----------
    percentile : float
        Percentile in [0, 1]
    
    Returns
    -------
    value : float
        Weighted percentile value
    """
    # Sort by values
    sorted_idx = np.argsort(values)
    sorted_values = values[sorted_idx]
    sorted_weights = weights[sorted_idx]
    
    # Cumulative weight
    cumsum = np.cumsum(sorted_weights)
    cumsum_norm = cumsum / cumsum[-1]
    
    # Find first index where cumulative weight >= percentile
    idx = np.searchsorted(cumsum_norm, percentile)
    
    if idx >= len(sorted_values):
        return sorted_values[-1]
    
    return sorted_values[idx]
```

---

## 13. Numerical Precision

### IRR Solver Tolerance

- Use tolerance `xtol=1e-8` for Brentq
- Verify NPV at solution is near zero
- Handle convergence failures gracefully

### Weight Normalization

- Always normalize weights before computing statistics
- Check for zero total weight

### Extreme Values

- Cap extreme IRRs (e.g., > 1000% annual)
- Handle NaN/Inf from edge cases

---

## 14. Validation & Testing

### Test Cases

1. **All win**: MOIC should equal recovery / investment
2. **All lose**: MOIC = 0, IRR = -100%
3. **50/50**: Mean MOIC should be average of win/lose scenarios
4. **Degenerate**: Single path should give exact values

### Boundary Tests

```python
def test_moic_bounds():
    """MOIC must be non-negative."""
    assert all(m >= 0 for m in moics)

def test_prob_sum():
    """Probabilities must sum to 1."""
    assert abs(sum(path_probs) - 1.0) < 1e-6

def test_var_cvar_relationship():
    """CVaR must be ≤ VaR (since we're looking at losses)."""
    assert cvar_95 <= var_95  # For MOIC (higher is better)
```

---

## 15. Limitations & Future Work

### Current Limitations

1. **No tail distribution fitting**: Just empirical quantiles
2. **No confidence intervals**: Point estimates only
3. **Static correlation**: No dynamic dependencies

### Future Enhancements

1. **Bootstrap confidence intervals**: For all metrics
2. **Extreme value theory**: Fit GPD to tail
3. **Scenario-conditional metrics**: VaR given specific events
4. **Real-time updating**: Bayesian metric updates
