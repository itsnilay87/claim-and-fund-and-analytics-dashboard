# Correlation Model Specification

> **Document**: 10_CORRELATION_MODEL.md  
> **Version**: 2.0  
> **Scope**: Multi-claim dependencies, correlation structures, copula modeling

---

## 1. Why Correlation Matters

### Portfolio Risk

For a portfolio of claims, **diversification benefit** depends on correlation:

- **Independent claims**: Risk reduces as $\sigma_P \propto 1/\sqrt{n}$
- **Perfectly correlated**: No diversification, $\sigma_P = \sigma_i$
- **Real portfolios**: Partial correlation, partial diversification

### Correlation Sources

| Source | Nature | Impact |
|--------|--------|--------|
| **Same respondent** | Credit/payment risk correlation | High |
| **Same tribunal/arbitrators** | Consistency in rulings | Moderate |
| **Same sector** | Industry-specific factors | Moderate |
| **Same jurisdiction** | Legal system consistency | Low-Moderate |
| **Macro-economic** | Enforcement environment | Low |

---

## 2. Correlation Types

### Outcome Correlation

Probability that two claims have the same judicial outcome:

$$
\rho_{outcome} = \text{Corr}(\mathbb{1}_{WIN_1}, \mathbb{1}_{WIN_2})
$$

### Quantum Correlation

Conditional on both winning, correlation of recovery amounts:

$$
\rho_{quantum} = \text{Corr}(Q_1 | WIN, Q_2 | WIN)
$$

### Timeline Correlation

Correlation of resolution times (e.g., both affected by court backlog):

$$
\rho_{timeline} = \text{Corr}(T_1, T_2)
$$

### MOIC Correlation

Net correlation of investment returns:

$$
\rho_{MOIC} = \text{Corr}(\text{MOIC}_1, \text{MOIC}_2)
$$

---

## 3. Respondent Risk Model

### Single Respondent, Multiple Claims

When multiple claims are against the same respondent:

1. **Outcome correlation**: Win/lose correlation due to respondent strategy
2. **Payment risk**: If respondent becomes insolvent, all claims affected
3. **Settlement dynamics**: Joint settlement negotiations

### Credit Factor Model

Introduce latent respondent credit factor $Z_R$:

$$
Z_R \sim \text{Normal}(0, 1)
$$

Respondent defaults if $Z_R < \Phi^{-1}(PD_R)$ where $PD_R$ is default probability.

For each claim against respondent $R$:

$$
\text{Payment}_{i|R} = \begin{cases}
\text{Award}_i & \text{if } Z_R \geq \Phi^{-1}(PD_R) \\
\text{Recovery Rate} \times \text{Award}_i & \text{otherwise}
\end{cases}
$$

### Implementation

```python
def sample_respondent_credit(
    respondent_id: str,
    pd: float,  # Probability of default
    lgd: float,  # Loss given default
    rng: Generator,
) -> Tuple[bool, float]:
    """
    Sample respondent credit state.
    
    Returns
    -------
    defaulted : bool
        True if respondent defaults
    recovery_rate : float
        1.0 if solvent, (1-lgd) if defaulted
    """
    z = rng.standard_normal()
    threshold = scipy.stats.norm.ppf(pd)
    
    if z < threshold:
        return True, 1.0 - lgd
    else:
        return False, 1.0
```

---

## 4. Copula Framework

### What is a Copula?

A copula $C(u_1, u_2, \ldots, u_n)$ is a multivariate distribution with uniform marginals that captures the dependence structure.

**Sklar's Theorem**: Any joint distribution can be decomposed:

$$
F(x_1, \ldots, x_n) = C(F_1(x_1), \ldots, F_n(x_n))
$$

### Gaussian Copula

The standard choice for correlated Monte Carlo:

$$
C(u_1, \ldots, u_n) = \Phi_n(\Phi^{-1}(u_1), \ldots, \Phi^{-1}(u_n); \Sigma)
$$

where $\Phi_n$ is the multivariate normal CDF and $\Sigma$ is the correlation matrix.

### Algorithm: Correlated MC Paths

```python
def sample_correlated_uniforms(
    n_claims: int,
    n_paths: int,
    correlation_matrix: np.ndarray,
    rng: Generator,
) -> np.ndarray:
    """
    Sample correlated uniform random variables via Gaussian copula.
    
    Returns
    -------
    uniforms : np.ndarray
        Shape (n_claims, n_paths), each column is correlated uniforms
    """
    # Sample multivariate normal
    L = np.linalg.cholesky(correlation_matrix)
    z = rng.standard_normal((n_claims, n_paths))
    correlated_z = L @ z
    
    # Transform to uniform via Phi
    uniforms = scipy.stats.norm.cdf(correlated_z)
    
    return uniforms


def apply_copula_to_outcomes(
    uniforms: np.ndarray,        # Shape (n_claims, n_paths)
    marginal_win_probs: np.ndarray,  # Shape (n_claims,)
) -> np.ndarray:
    """
    Convert correlated uniforms to correlated binary outcomes.
    
    Returns
    -------
    outcomes : np.ndarray
        Shape (n_claims, n_paths), 1=WIN, 0=LOSE
    """
    outcomes = np.zeros_like(uniforms, dtype=int)
    
    for i in range(len(marginal_win_probs)):
        outcomes[i, :] = (uniforms[i, :] < marginal_win_probs[i]).astype(int)
    
    return outcomes
```

---

## 5. Correlation Matrix Construction

### Block Structure

For claims grouped by respondent:

```
Σ = | I   ρ_R  0   |
    | ρ_R  I   0   |
    | 0    0   I_k |
```

where:
- Same respondent block: correlation $\rho_R$
- Different respondents: correlation 0 or base correlation $\rho_{base}$

### Construction Algorithm

```python
def build_correlation_matrix(
    claims: List[ClaimConfig],
    base_correlation: float = 0.10,
    respondent_correlation: float = 0.50,
    sector_correlation: float = 0.20,
) -> np.ndarray:
    """
    Build correlation matrix from claim attributes.
    
    Returns
    -------
    corr_matrix : np.ndarray
        Shape (n_claims, n_claims), symmetric positive definite
    """
    n = len(claims)
    corr = np.eye(n)
    
    for i in range(n):
        for j in range(i + 1, n):
            rho = base_correlation
            
            # Same respondent: add respondent correlation
            if claims[i].respondent_id == claims[j].respondent_id:
                rho = max(rho, respondent_correlation)
            
            # Same sector: add sector correlation
            if claims[i].sector == claims[j].sector:
                rho = max(rho, sector_correlation)
            
            corr[i, j] = rho
            corr[j, i] = rho
    
    # Ensure positive definite
    corr = nearest_positive_definite(corr)
    
    return corr
```

### Positive Definiteness

The correlation matrix must be positive definite. Use nearest PD projection:

```python
def nearest_positive_definite(A: np.ndarray) -> np.ndarray:
    """Find nearest positive definite matrix to A."""
    B = (A + A.T) / 2
    _, s, V = np.linalg.svd(B)
    H = V.T @ np.diag(np.maximum(s, 1e-6)) @ V
    A2 = (B + H) / 2
    A3 = (A2 + A2.T) / 2
    
    # Verify
    if is_positive_definite(A3):
        return A3
    
    # Fallback: regularize diagonal
    return A3 + np.eye(len(A)) * 1e-4
```

---

## 6. Quantum Correlation

### Correlated Quantum Draws

When two claims win, their quantum realizations may be correlated:

```python
def sample_correlated_quantums(
    n_claims: int,
    quantum_configs: List[QuantumConfig],
    win_outcomes: np.ndarray,       # Shape (n_claims, n_paths)
    quantum_correlation: float,
    rng: Generator,
) -> np.ndarray:
    """
    Sample correlated quantum draws for winning paths.
    
    Returns
    -------
    quantums : np.ndarray
        Shape (n_claims, n_paths), quantum recovery ratios
    """
    n_paths = win_outcomes.shape[1]
    quantums = np.zeros((n_claims, n_paths))
    
    # Build quantum correlation matrix
    quantum_corr = np.full((n_claims, n_claims), quantum_correlation)
    np.fill_diagonal(quantum_corr, 1.0)
    
    # Sample correlated uniforms
    uniforms = sample_correlated_uniforms(n_claims, n_paths, quantum_corr, rng)
    
    # Convert to quantum bands
    for i in range(n_claims):
        for j in range(n_paths):
            if win_outcomes[i, j]:
                quantums[i, j] = inverse_cdf_quantum(
                    uniforms[i, j],
                    quantum_configs[i],
                )
    
    return quantums
```

---

## 7. Timeline Correlation

### Correlated Durations

Claims in same jurisdiction may have correlated court delays:

```python
def sample_correlated_timelines(
    n_claims: int,
    duration_params: List[DurationConfig],
    timeline_correlation: float,
    rng: Generator,
) -> List[TimelineResult]:
    """
    Sample correlated timeline durations.
    
    Uses Gaussian copula for stage durations.
    """
    corr_matrix = np.full((n_claims, n_claims), timeline_correlation)
    np.fill_diagonal(corr_matrix, 1.0)
    
    uniforms = sample_correlated_uniforms(n_claims, 1, corr_matrix, rng)
    
    timelines = []
    for i in range(n_claims):
        # Use uniform to perturb base duration
        base = duration_params[i].expected
        scale = duration_params[i].scale
        
        # Map uniform to duration
        z = scipy.stats.norm.ppf(uniforms[i, 0])
        duration = base + scale * z
        duration = max(duration_params[i].min, duration)
        
        timelines.append(sample_timeline_with_seed(duration, rng))
    
    return timelines
```

---

## 8. Full Correlated Simulation

### Algorithm

```python
def simulate_portfolio_correlated(
    claims: List[ClaimConfig],
    correlation_config: CorrelationConfig,
    n_paths: int,
    base_seed: int,
) -> PortfolioSimResult:
    """
    Run correlated Monte Carlo across all claims.
    
    Steps:
    1. Build correlation matrices (outcome, quantum, timeline)
    2. Sample correlated uniform seeds
    3. Apply to each claim's marginal distributions
    4. Aggregate to portfolio level
    """
    rng = np.random.default_rng(base_seed)
    n_claims = len(claims)
    
    # 1. Build correlation matrix
    outcome_corr = build_correlation_matrix(
        claims,
        base_correlation=correlation_config.base,
        respondent_correlation=correlation_config.respondent,
    )
    
    # 2. Sample correlated uniforms for outcomes
    outcome_uniforms = sample_correlated_uniforms(
        n_claims, n_paths, outcome_corr, rng
    )
    
    # 3. Convert to outcomes using marginal probabilities
    marginal_probs = np.array([c.win_probability for c in claims])
    outcomes = apply_copula_to_outcomes(outcome_uniforms, marginal_probs)
    
    # 4. Sample correlated quantums (conditional on wins)
    quantums = sample_correlated_quantums(
        n_claims,
        [c.quantum_config for c in claims],
        outcomes,
        correlation_config.quantum,
        rng,
    )
    
    # 5. Compute per-claim metrics
    claim_moics = compute_all_moics(claims, outcomes, quantums)
    
    # 6. Aggregate to portfolio
    portfolio_results = aggregate_to_portfolio(claim_moics)
    
    return PortfolioSimResult(
        claim_results=claim_moics,
        portfolio_moic_distribution=portfolio_results,
        correlation_matrix_used=outcome_corr,
    )
```

---

## 9. Calibration

### Estimating Correlation Parameters

| Parameter | Estimation Method | Typical Range |
|-----------|-------------------|---------------|
| Base correlation | Historical return correlation | 0.05 - 0.15 |
| Respondent correlation | Expert judgment | 0.30 - 0.60 |
| Sector correlation | Industry data | 0.15 - 0.30 |
| Quantum correlation | Historical recovery patterns | 0.10 - 0.40 |

### Data Requirements

- Historical portfolio outcomes
- Respondent default rates
- Sector performance data
- Timeline data by jurisdiction

### Sensitivity Testing

```python
def correlation_sensitivity_analysis(
    claims: List[ClaimConfig],
    correlation_values: List[float],
    n_paths: int = 10000,
) -> Dict[float, RiskMetrics]:
    """
    Run portfolio simulation at different correlation levels.
    
    Returns mapping from correlation → portfolio risk metrics.
    """
    results = {}
    
    for rho in correlation_values:
        config = CorrelationConfig(base=rho, respondent=rho * 2)
        sim_result = simulate_portfolio_correlated(claims, config, n_paths, seed=42)
        results[rho] = compute_portfolio_metrics(sim_result)
    
    return results
```

---

## 10. Counterparty Credit Risk

### Credit Valuation Adjustment (CVA)

Expected loss due to counterparty default:

$$
CVA = (1 - R) \times \int_0^T EE(t) \times dPD(t)
$$

where:
- $R$ = Recovery rate
- $EE(t)$ = Expected exposure at time $t$
- $PD(t)$ = Probability of default by time $t$

### Simplified CVA for Litigation

```python
def compute_simplified_cva(
    expected_recovery_cr: float,
    respondent_pd: float,
    respondent_lgd: float,
) -> float:
    """
    Compute simplified CVA adjustment.
    
    Returns
    -------
    cva_cr : float
        CVA adjustment to subtract from expected recovery
    """
    return expected_recovery_cr * respondent_pd * respondent_lgd
```

### Application

```python
expected_recovery = 100.0  # ₹ Cr
adjusted_recovery = expected_recovery - compute_simplified_cva(
    expected_recovery,
    respondent_pd=0.10,  # 10% default probability
    respondent_lgd=0.60,  # 60% loss given default
)
# adjusted_recovery = 100 - 6 = 94 ₹ Cr
```

---

## 11. Data Structures

```python
@dataclass
class CorrelationConfig:
    """Configuration for correlation model."""
    
    enabled: bool = True
    
    # Base correlations
    base_correlation: float = 0.10
    respondent_correlation: float = 0.50
    sector_correlation: float = 0.20
    jurisdiction_correlation: float = 0.15
    
    # Quantum correlation
    quantum_correlation: float = 0.20
    
    # Timeline correlation
    timeline_correlation: float = 0.30
    
    # Credit risk
    use_credit_risk: bool = False
    default_recovery_rate: float = 0.40


@dataclass
class PortfolioSimResult:
    """Result of correlated portfolio simulation."""
    
    claim_results: Dict[str, np.ndarray]      # claim_id → MOIC array
    portfolio_moic_dist: np.ndarray           # Portfolio MOIC distribution
    correlation_matrix_used: np.ndarray
    
    # Diagnostics
    realized_correlations: np.ndarray         # Empirical from simulation
    diversification_ratio: float
```

---

## 12. Limitations & Future Work

### Current Limitations

1. **Gaussian copula**: May underestimate tail dependence
2. **Static correlation**: Doesn't change over time
3. **No wrong-way risk**: Credit and exposure correlation not modeled
4. **Single period**: No multi-period dynamic correlation

### Future Enhancements

1. **t-Copula**: Better tail dependence modeling
2. **Dynamic correlation**: Correlation increases in stress
3. **Wrong-way risk**: Correlation between default and exposure
4. **Hierarchical dependence**: Nested correlation structures
5. **Contagion modeling**: Default of one triggers others
