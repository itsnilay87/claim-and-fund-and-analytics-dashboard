# Quantum Model Specification

> **Document**: 03_QUANTUM_MODEL.md  
> **Version**: 2.0  
> **Scope**: Award amount distribution modeling

---

## 1. Quantum Definition

### Terminology

| Term | Definition | Units |
|------|------------|-------|
| **SOC** | Statement of Claim — total amount claimed | ₹ Crore |
| **Quantum** | Amount actually awarded by tribunal | ₹ Crore |
| **Quantum Percentage** | $q = Q / SOC \in [0, 1]$ | fraction |
| **Expected Quantum** | $\mathbb{E}[Q \mid \text{WIN}]$ | ₹ Crore |

### Conditional Structure

Quantum is **conditional on arbitration outcome**:

$$
Q = \begin{cases}
Q_{win} & \text{if arbitration won} \\
0 & \text{if arbitration lost}
\end{cases}
$$

where $Q_{win} \sim \text{QuantumDistribution}(SOC)$.

---

## 2. Quantum Band Model

### Distribution Specification

The quantum percentage $q \in [0, 1]$ follows a **mixture distribution**:

$$
q \mid \text{WIN} \sim \sum_{k=1}^{K} w_k \cdot \text{Uniform}(a_k, b_k)
$$

where:
- $K$ = number of bands
- $w_k$ = probability weight for band $k$ (must sum to 1)
- $[a_k, b_k)$ = range for band $k$

### Default Band Configuration

| Band | Low ($a_k$) | High ($b_k$) | Probability ($w_k$) | Midpoint | Interpretation |
|------|-------------|--------------|---------------------|----------|----------------|
| 1 | 0.00 | 0.20 | 0.15 | 0.10 | Token / partial award |
| 2 | 0.20 | 0.40 | 0.05 | 0.30 | Significantly reduced |
| 3 | 0.40 | 0.60 | 0.05 | 0.50 | Moderate reduction |
| 4 | 0.60 | 0.80 | 0.05 | 0.70 | Minor reduction |
| 5 | 0.80 | 1.00 | 0.70 | 0.90 | Near-full award |

### Expected Quantum Calculation

$$
\mathbb{E}[q \mid \text{WIN}] = \sum_{k=1}^{K} w_k \cdot \frac{a_k + b_k}{2}
$$

**Numerical Example**:

$$
\mathbb{E}[q \mid \text{WIN}] = 0.15 \times 0.10 + 0.05 \times 0.30 + 0.05 \times 0.50 + 0.05 \times 0.70 + 0.70 \times 0.90
$$

$$
= 0.015 + 0.015 + 0.025 + 0.035 + 0.630 = 0.720
$$

So $\mathbb{E}[Q \mid \text{WIN}] = 0.72 \times SOC$.

### Unconditional Expected Quantum

$$
\mathbb{E}[Q] = P(\text{WIN}) \times \mathbb{E}[Q \mid \text{WIN}] = p_{win} \times 0.72 \times SOC
$$

For $p_{win} = 0.70$:

$$
\mathbb{E}[Q] = 0.70 \times 0.72 \times SOC = 0.504 \times SOC
$$

---

## 3. Sampling Algorithm

### Two-Stage Draw

```python
def draw_quantum(soc_cr: float, rng: Generator) -> QuantumResult:
    """
    Sample quantum from mixture distribution.
    
    Stage 1: Select band from categorical distribution
    Stage 2: Draw uniformly within selected band
    
    Returns QuantumResult with band_idx, quantum_pct, quantum_cr.
    """
    # Stage 1: Band selection
    band_probs = [b.probability for b in QUANTUM_BANDS]
    band_idx = rng.choice(len(QUANTUM_BANDS), p=band_probs)
    
    # Stage 2: Uniform draw within band
    band = QUANTUM_BANDS[band_idx]
    quantum_pct = rng.uniform(band.low, band.high)
    
    # Compute absolute quantum
    quantum_cr = soc_cr * quantum_pct
    
    return QuantumResult(
        band_idx=band_idx,
        quantum_pct=quantum_pct,
        quantum_cr=quantum_cr,
        expected_quantum_cr=soc_cr * EXPECTED_QUANTUM_PCT,
    )
```

### Draw Ordering

Quantum draw MUST occur in fixed position within the path simulation sequence to ensure reproducibility. Current position: after arbitration outcome, before challenge tree traversal.

---

## 4. Known Quantum (Post-Award Stages)

When a claim is at a post-award stage with a known award amount:

### TruncatedNormal Model

$$
q \mid q_{known} \sim \text{TruncatedNormal}(\mu = q_{known}, \sigma = 0.10, a = 0, b = 1)
$$

**Rationale**: The award is issued but may be partially modified on appeal (e.g., interest calculations revised, specific heads disallowed). The 10% standard deviation captures this uncertainty.

### Implementation

```python
def draw_known_quantum(
    soc_cr: float,
    known_pct: float,
    rng: Generator,
    sigma: float = 0.10,
) -> QuantumResult:
    """
    Draw quantum when award amount is approximately known.
    
    Uses TruncatedNormal centered on known_pct.
    """
    # Draw from normal, then clip
    raw = rng.normal(known_pct, sigma)
    quantum_pct = float(np.clip(raw, 0.0, 1.0))
    
    return QuantumResult(
        band_idx=-2,  # Sentinel for "known quantum mode"
        quantum_pct=quantum_pct,
        quantum_cr=soc_cr * quantum_pct,
        expected_quantum_cr=soc_cr * known_pct,
    )
```

---

## 5. Quantum in Settlement Context

### Pre-Award Settlement

Before arbitration concludes, settlement quantum reference is:

$$
Q_{ref}^{pre} = SOC \times \mathbb{E}[q \mid \text{WIN}] \times P(\text{WIN})
$$

This is the expected value accounting for both the probability of winning and the expected award conditional on winning.

### Post-Award Settlement (Claimant Won)

After a favorable award:

$$
Q_{ref}^{post,won} = Q_{drawn}
$$

The reference is the **actual drawn quantum**, not the expected value.

### Post-Award Settlement (Claimant Lost)

After an adverse award (Scenario B):

$$
Q_{ref}^{post,lost} = SOC \times \mathbb{E}[q \mid \text{WIN}] \times P(\text{RE-ARB WIN}) \times P(\text{RESTART})
$$

This accounts for the probability of successfully vacating the adverse award AND winning re-arbitration.

---

## 6. Calibration Requirements

### Data Sources for Calibration

| Source Type | Description | Availability |
|-------------|-------------|--------------|
| Tribunal statistics | SIAC/HKIAC/ICC annual reports | Public |
| Academic studies | Published research on award amounts | Limited |
| Practitioner data | Law firm internal statistics | Confidential |
| Claim-specific assessment | Legal opinion on merits | Required per-claim |

### Calibration Process

1. **Collect historical awards**: Sample of n ≥ 30 comparable awards
2. **Compute empirical distribution**: Histogram of $q = Q/SOC$
3. **Fit band model**: Choose bands and weights to match empirical CDF
4. **Validate with experts**: Legal review of bands

### Sensitivity Analysis

Compute $\partial \mathbb{E}[\text{MOIC}] / \partial \mathbb{E}[Q]$:

- A 10% increase in expected quantum → ~10% increase in expected MOIC
- Quantum sensitivity is nearly linear for reasonable ranges

---

## 7. Alternative Distribution Models

### Continuous Distributions

Instead of bands, could use continuous distributions:

**Beta Distribution**:

$$
q \sim \text{Beta}(\alpha, \beta)
$$

Fit $\alpha, \beta$ to match historical mean and variance.

**Pros**: Smoother, more parameters
**Cons**: Less interpretable, harder to calibrate from expert judgment

**Log-Normal Distribution**:

$$
\log(q) \sim N(\mu, \sigma^2)
$$

**Pros**: Captures right-skew typical of awards
**Cons**: Support is $(0, \infty)$, must truncate at 1

### Current Choice Rationale

The band model is chosen for:
1. **Interpretability**: Legal teams can relate to "60-80% of claim" scenarios
2. **Expert elicitation**: Easier to validate probabilities
3. **Scenario analysis**: Can stress-test specific bands

---

## 8. Quantum Variance Decomposition

Total variance in investment returns due to quantum:

$$
\text{Var}(R) = \text{Var}(\mathbb{E}[R \mid Q]) + \mathbb{E}[\text{Var}(R \mid Q)]
$$

The first term captures outcome uncertainty (win/lose).
The second term captures quantum uncertainty conditional on winning.

**Empirically**: ~60% of return variance from outcome, ~40% from quantum.

---

## 9. Multi-Claim Quantum Correlation

### Independence Assumption (Current)

$$
Q_i \perp\!\!\!\perp Q_j \mid A_i, A_j
$$

Quantum draws are independent across claims, conditional on their arbitration outcomes.

### Proposed Enhancement

Common factors affecting quantum:
- Tribunal calibration (conservative vs liberal)
- Interest rate environment
- Regulatory changes affecting damages calculations

Could model via **copula**:

$$
(q_1, q_2, \ldots, q_n) \sim \text{GaussianCopula}(F_1, F_2, \ldots, F_n; \Sigma)
$$

where $F_i$ is the marginal distribution for claim $i$ and $\Sigma$ is the correlation matrix.

---

## 10. Implementation Validation

### Unit Tests Required

```python
def test_quantum_bands_sum_to_one():
    """Band probabilities must sum to 1.0."""
    total = sum(b.probability for b in QUANTUM_BANDS)
    assert abs(total - 1.0) < 1e-6

def test_quantum_bands_ordered():
    """Bands must be contiguous and ordered."""
    for i in range(len(QUANTUM_BANDS) - 1):
        assert QUANTUM_BANDS[i].high == QUANTUM_BANDS[i + 1].low

def test_quantum_draw_in_bounds():
    """Drawn quantum must be within [0, SOC]."""
    rng = np.random.default_rng(42)
    for _ in range(1000):
        result = draw_quantum(100.0, rng)
        assert 0.0 <= result.quantum_cr <= 100.0

def test_expected_quantum_matches():
    """Monte Carlo mean should converge to analytical E[Q]."""
    rng = np.random.default_rng(42)
    samples = [draw_quantum(100.0, rng).quantum_cr for _ in range(10000)]
    empirical_mean = np.mean(samples)
    analytical_mean = 100.0 * EXPECTED_QUANTUM_PCT
    assert abs(empirical_mean - analytical_mean) < 1.0  # Within 1%
```

---

## 11. Data Structures

```python
@dataclass
class QuantumBand:
    low: float           # Lower bound (inclusive)
    high: float          # Upper bound (exclusive)
    probability: float   # Weight in mixture

@dataclass
class QuantumResult:
    band_idx: int        # Which band was selected (-1 for loss, -2 for known)
    quantum_pct: float   # Drawn percentage of SOC
    quantum_cr: float    # Absolute quantum in ₹ Crore
    expected_quantum_cr: float  # Analytical E[Q] for reference
```
