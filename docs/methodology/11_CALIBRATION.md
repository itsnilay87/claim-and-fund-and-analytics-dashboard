# Calibration Guide

> **Document**: 11_CALIBRATION.md  
> **Version**: 2.0  
> **Scope**: Parameter estimation, data requirements, validation methodology

---

## 1. Calibration Philosophy

### Model Parameters

The simulation requires calibration of:

| Category | Parameters | Source |
|----------|------------|--------|
| **Probability** | Stage transition probabilities | Legal database, expert judgment |
| **Quantum** | Band distribution, E[Q\|WIN] | Historical awards data |
| **Timeline** | Stage duration distributions | Court statistics |
| **Settlement** | Hazard rates, discount factors | Settlement data |
| **Legal costs** | Burn rates, overrun distribution | Fee data, budgets |
| **Interest** | Statutory rates, compounding | Statute, contracts |

### Calibration Hierarchy

```
Level 1: Regulatory/Statutory (Known with certainty)
         → Interest rates, limitation periods
         
Level 2: Historical/Statistical (Data-derived)
         → Win rates, duration distributions
         
Level 3: Expert Judgment (Model assumptions)
         → Quantum bands, settlement hazards
         
Level 4: Sensitivity Analysis (Uncertain)
         → Correlation, overrun parameters
```

---

## 2. Probability Calibration

### Data Sources

| Source | Coverage | Quality |
|--------|----------|---------|
| Tribunal databases | Published awards | High (for arbitration) |
| Law firm records | Challenge outcomes | Medium (selective) |
| Case law databases | Court decisions | High (S.34, S.37) |
| SCI website | SLP outcomes | Medium (searchable) |

### Parameter Estimation

For a stage with $n$ observed outcomes:

$$
\hat{p}_{win} = \frac{n_{win}}{n_{total}}
$$

**Confidence interval** (Wilson score):

$$
\hat{p} \pm z_\alpha \sqrt{\frac{\hat{p}(1-\hat{p})}{n}}
$$

### Bayesian Update

Start with prior $\text{Beta}(\alpha_0, \beta_0)$, update with data:

$$
p_{win} \sim \text{Beta}(\alpha_0 + n_{win}, \beta_0 + n_{lose})
$$

### Example: S.34 Win Rate

```python
# Prior: Weak belief around 70%
alpha_0, beta_0 = 7, 3

# Observed data: 85 wins out of 120
n_win, n_lose = 85, 35

# Posterior
alpha_post = alpha_0 + n_win  # 92
beta_post = beta_0 + n_lose   # 38

# Point estimate
p_hat = alpha_post / (alpha_post + beta_post)  # 0.708

# 95% credible interval
from scipy.stats import beta
ci_95 = beta.ppf([0.025, 0.975], alpha_post, beta_post)
# [0.62, 0.78]
```

### Jurisdiction-Specific Calibration

| Jurisdiction | Stage | Data Source | Sample Size | Estimated p_win |
|--------------|-------|-------------|-------------|-----------------|
| Indian Domestic | S.34 | Arbitration database | 200 | 0.70 ± 0.06 |
| Indian Domestic | S.37 | HC case law | 150 | 0.65 ± 0.07 |
| Indian Domestic | SLP Admit | SCI database | 300 | 0.18 ± 0.04 |
| SIAC | HC | SGHC judgments | 80 | 0.85 ± 0.07 |

---

## 3. Quantum Calibration

### Data Requirements

- Historical arbitration awards
- Claimed vs awarded amounts
- Recovery ratios by category

### Band Distribution Estimation

1. **Collect** recovery ratio data: $q_i = \text{Award}_i / \text{Claim}_i$
2. **Bin** into bands: [0-20%], [20-40%], ..., [80-100%]
3. **Estimate** band probabilities: $\hat{p}_k = n_k / n_{total}$
4. **Validate**: Check that $\mathbb{E}[Q | WIN] \approx 0.72 \times SOC$

### Example Estimation

```python
# Historical recovery ratios
recovery_ratios = np.array([0.65, 0.85, 0.72, 0.90, 0.55, ...])

# Define bands
band_edges = [0.0, 0.20, 0.40, 0.60, 0.80, 1.00]
band_midpoints = [0.10, 0.30, 0.50, 0.70, 0.90]

# Count in each band
counts, _ = np.histogram(recovery_ratios, bins=band_edges)
probs = counts / counts.sum()

# Verify expected value
e_q = sum(p * m for p, m in zip(probs, band_midpoints))
print(f"E[Q|WIN] = {e_q:.2f}")  # Target: ~0.72
```

### Known Quantum Mode

When quantum is known from DAB/earlier award:

```python
# Use truncated normal centered on known value
known_quantum_cr = 85.0
uncertainty_pct = 0.10  # ±10%

mean = known_quantum_cr
std = known_quantum_cr * uncertainty_pct
quantum_dist = TruncatedNormal(mean, std, lower=0.5 * mean, upper=1.2 * mean)
```

---

## 4. Timeline Calibration

### Data Sources

| Source | Data Type |
|--------|-----------|
| Court statistics | Average disposal times |
| Case management systems | Stage-by-stage durations |
| Law firm records | Client matter timelines |
| Published research | Academic studies |

### Distribution Fitting

For stage $s$, fit distribution to observed durations $\{d_1, d_2, \ldots, d_n\}$:

```python
from scipy.stats import uniform, lognorm, triang
from scipy.stats import kstest

def fit_duration_distribution(
    durations: np.ndarray,
) -> Dict[str, Any]:
    """
    Fit multiple distributions and select best by KS test.
    """
    results = {}
    
    # Uniform
    a, b = durations.min(), durations.max()
    ks_stat, p_val = kstest(durations, 'uniform', args=(a, b-a))
    results['uniform'] = {'params': (a, b), 'ks': ks_stat, 'p': p_val}
    
    # Lognormal
    shape, loc, scale = lognorm.fit(durations, floc=0)
    ks_stat, p_val = kstest(durations, 'lognorm', args=(shape, loc, scale))
    results['lognorm'] = {'params': (shape, loc, scale), 'ks': ks_stat, 'p': p_val}
    
    # Select best (highest p-value)
    best = max(results.items(), key=lambda x: x[1]['p'])
    
    return {'best_fit': best[0], 'results': results}
```

### Example: Arbitration Duration

```python
# Historical arbitration durations (months)
arb_durations = [18, 22, 24, 30, 36, 19, 25, 28, 33, ...]

# Fit
result = fit_duration_distribution(np.array(arb_durations))
# Best fit: uniform(18, 36) or lognormal(μ=3.3, σ=0.3)

# Use uniform for simplicity
duration_spec = {"distribution": "uniform", "min": 18, "max": 36}
```

---

## 5. Settlement Calibration

### Hazard Rate Estimation

From settlement data with N claims:

$$
\hat{\lambda}_s = \frac{\text{Number settled at stage } s}{\text{Number reaching stage } s}
$$

### Discount Factor Estimation

From settlement amounts vs expected awards:

$$
\hat{\delta}_s = \frac{\sum_i \text{Settlement}_i}{\sum_i \text{Expected Award}_i}
$$

### Challenge: Data Scarcity

Settlement data is often:
- Confidential
- Selection-biased (harder cases settle less)
- Small sample

**Solution**: Use expert judgment with sensitivity analysis.

---

## 6. Legal Cost Calibration

### Fee Analysis

1. **Collect** fee quotes from law firms
2. **Standardize** to monthly burn rate
3. **Adjust** for claim size (scaling factor)

### Overrun Distribution

From historical budget vs actual:

```python
# Historical data: (budgeted, actual) pairs
budget_actual = [(100, 120), (80, 95), (150, 180), ...]

# Compute overrun ratios
ratios = [a / b for b, a in budget_actual]

# Fit Beta distribution
from scipy.stats import beta
alpha, beta_param, loc, scale = beta.fit(ratios, floc=1.0)

# Scale to [1, omega_max]
omega_max = max(ratios) * 1.1  # Allow some margin
```

---

## 7. Validation Methodology

### In-Sample Validation

Check model fits observed data:

```python
def validate_probability_fit(
    observed_outcomes: List[str],
    model_probs: Dict[str, float],
) -> Dict[str, float]:
    """
    Compare model predictions to observed frequencies.
    """
    observed_freq = {}
    for outcome in set(observed_outcomes):
        observed_freq[outcome] = observed_outcomes.count(outcome) / len(observed_outcomes)
    
    # Chi-squared test
    from scipy.stats import chisquare
    observed = [observed_freq.get(k, 0) * len(observed_outcomes) for k in model_probs]
    expected = [model_probs[k] * len(observed_outcomes) for k in model_probs]
    
    chi2, p_value = chisquare(observed, expected)
    
    return {'chi2': chi2, 'p_value': p_value, 'pass': p_value > 0.05}
```

### Out-of-Sample Validation

Hold out recent data, calibrate on historical:

```python
def cross_validate_model(
    data: List[ClaimOutcome],
    n_folds: int = 5,
) -> Dict[str, float]:
    """
    K-fold cross-validation of model parameters.
    """
    fold_size = len(data) // n_folds
    errors = []
    
    for i in range(n_folds):
        # Split
        test = data[i*fold_size : (i+1)*fold_size]
        train = data[:i*fold_size] + data[(i+1)*fold_size:]
        
        # Calibrate on train
        params = calibrate_parameters(train)
        
        # Evaluate on test
        predictions = simulate_with_params(test, params)
        error = compute_prediction_error(predictions, test)
        errors.append(error)
    
    return {'mean_error': np.mean(errors), 'std_error': np.std(errors)}
```

### Backtesting

Run simulation on historical claims, compare to actual outcomes:

```python
def backtest_portfolio(
    historical_claims: List[ClaimConfig],
    actual_outcomes: List[ClaimOutcome],
    n_simulations: int = 10000,
) -> BacktestResult:
    """
    Backtest model against historical outcomes.
    """
    # Run simulation
    simulated = simulate_claims(historical_claims, n_simulations)
    
    # Compare distributions
    actual_moics = compute_actual_moics(actual_outcomes)
    simulated_moics = simulated.moic_distribution
    
    # KS test
    ks_stat, p_value = kstest(actual_moics, simulated_moics)
    
    # Coverage: What fraction of actuals fall within model's 5-95% CI?
    p5, p95 = np.percentile(simulated_moics, [5, 95])
    coverage = np.mean((actual_moics >= p5) & (actual_moics <= p95))
    
    return BacktestResult(
        ks_statistic=ks_stat,
        ks_pvalue=p_value,
        coverage_90=coverage,
    )
```

---

## 8. Sensitivity Analysis Protocol

### Parameter Ranges

| Parameter | Base | Low | High |
|-----------|------|-----|------|
| p_win_arb | 0.70 | 0.60 | 0.80 |
| p_win_s34 | 0.70 | 0.60 | 0.80 |
| E[Q\|WIN] | 0.72 | 0.60 | 0.85 |
| Duration | 27mo | 18mo | 36mo |
| Settlement λ | 0.10 | 0.05 | 0.20 |
| Overrun ω | 1.3 | 1.1 | 1.8 |

### One-at-a-Time (OAT) Sensitivity

```python
def sensitivity_analysis_oat(
    base_params: Dict[str, float],
    param_ranges: Dict[str, Tuple[float, float]],
    output_metric: str = "moic_mean",
) -> Dict[str, List[Tuple[float, float]]]:
    """
    One-at-a-time sensitivity analysis.
    
    Returns mapping from param → [(value, metric_value), ...]
    """
    results = {}
    
    for param, (low, high) in param_ranges.items():
        param_results = []
        
        for value in np.linspace(low, high, 10):
            params = base_params.copy()
            params[param] = value
            
            sim_result = run_simulation(params)
            metric = getattr(sim_result, output_metric)
            
            param_results.append((value, metric))
        
        results[param] = param_results
    
    return results
```

### Tornado Diagram

Visualize parameter impact:

```python
def create_tornado_data(
    sensitivity_results: Dict[str, List[Tuple[float, float]]],
    base_value: float,
) -> List[Dict]:
    """
    Create tornado chart data.
    
    Returns list of {param, low_delta, high_delta} sorted by impact.
    """
    tornado = []
    
    for param, values in sensitivity_results.items():
        low_metric = values[0][1]   # Metric at low param value
        high_metric = values[-1][1]  # Metric at high param value
        
        tornado.append({
            'param': param,
            'low_delta': low_metric - base_value,
            'high_delta': high_metric - base_value,
            'impact': abs(high_metric - low_metric),
        })
    
    # Sort by impact
    return sorted(tornado, key=lambda x: x['impact'], reverse=True)
```

---

## 9. Calibration Workflow

### Step-by-Step Process

```
1. COLLECT DATA
   ├── Historical outcomes by jurisdiction/stage
   ├── Award data (claim vs recovery)
   ├── Timeline data (stage durations)
   └── Legal cost records

2. CLEAN & PREPARE
   ├── Remove outliers
   ├── Handle missing values
   ├── Standardize formats
   └── Split train/test

3. ESTIMATE PARAMETERS
   ├── Win probabilities (Bayesian update)
   ├── Quantum distribution (histogram bins)
   ├── Duration distributions (fit)
   └── Legal costs (regression)

4. VALIDATE
   ├── In-sample: Chi-squared, KS tests
   ├── Out-of-sample: Cross-validation
   ├── Backtest: Historical simulation
   └── Expert review: Sanity checks

5. SENSITIVITY ANALYSIS
   ├── OAT for each parameter
   ├── Tornado diagram
   └── Scenario analysis

6. DOCUMENT
   ├── Data sources
   ├── Estimation methodology
   ├── Uncertainty ranges
   └── Known limitations
```

---

## 10. Calibration File Format

### YAML Specification

```yaml
calibration:
  version: "2.0"
  date: "2024-01-15"
  author: "Risk Team"
  
  jurisdiction: "indian_domestic"
  
  probabilities:
    arbitration_win:
      value: 0.70
      confidence: 0.95
      source: "Internal database, n=150"
      ci_low: 0.62
      ci_high: 0.78
    s34_upheld:
      value: 0.70
      source: "High Court records"
    s37_upheld:
      value: 0.65
    slp_admitted:
      value: 0.18
  
  quantum:
    mode: "band_distribution"
    bands:
      - range: [0.0, 0.20]
        probability: 0.02
      - range: [0.20, 0.40]
        probability: 0.05
      - range: [0.40, 0.60]
        probability: 0.08
      - range: [0.60, 0.80]
        probability: 0.15
      - range: [0.80, 1.00]
        probability: 0.70
    expected_value: 0.72
    source: "Historical awards, 2018-2023"
  
  timeline:
    stages:
      dab:
        distribution: uniform
        min: 3
        max: 6
      arbitration:
        distribution: uniform
        min: 18
        max: 36
      s34:
        distribution: uniform
        min: 6
        max: 18
  
  legal_costs:
    monthly_burn_rate: 5.0  # ₹ Lakhs/month
    overrun:
      distribution: beta
      alpha: 2.0
      beta: 5.0
      max_multiplier: 2.0
      
  validation:
    last_backtest_date: "2023-12-01"
    backtest_coverage: 0.87
    ks_pvalue: 0.32
```

---

## 11. Limitations

### Data Limitations

1. **Sample size**: Small samples → high uncertainty
2. **Selection bias**: Published awards may differ from settled
3. **Time period**: Historical data may not reflect current environment
4. **Jurisdiction coverage**: Non-Indian data sparse

### Model Limitations

1. **Parameter stability**: Assumed constant over time
2. **Independence**: Stages assumed conditionally independent
3. **Expert judgment**: Introduces subjectivity
4. **Distribution choice**: Parametric forms may be wrong

### Mitigation

- Use wide confidence intervals
- Run extensive sensitivity analysis
- Document assumptions clearly
- Update calibration regularly
