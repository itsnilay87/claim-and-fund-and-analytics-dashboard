# Methodology: Correlation Sensitivity Analysis

## Overview

The correlation sensitivity module quantifies how **inter-claim correlation** affects portfolio risk. In the base Monte Carlo engine, claims are simulated independently. The correlation sensitivity layer post-processes those results using a **one-factor Gaussian copula** (Vasicek model) to re-weight outcomes under varying correlation assumptions without re-running the simulation.

---

## Mathematical Framework

### One-Factor Gaussian Copula

Each claim $i$ has a latent variable $Z_i$ that determines its win/lose outcome:

$$Z_i = \sqrt{\rho}\, M + \sqrt{1-\rho}\, \varepsilon_i$$

where:
- $M \sim \mathcal{N}(0,1)$ is a **common systematic factor** (market/macro risk)
- $\varepsilon_i \sim \mathcal{N}(0,1)$ is an **idiosyncratic factor**, independent of $M$ and all other $\varepsilon_j$
- $\rho \in [0, 1]$ is the **pairwise correlation** between any two claims
- Claim $i$ wins iff $Z_i \le \Phi^{-1}(p_i)$, ensuring $\Pr(\text{win}_i) = p_i$

### Conditional Win Probability

Conditioning on the realized factor $M = m$:

$$q_i(m, \rho) = \Phi\!\left(\frac{\Phi^{-1}(p_i) - \sqrt{\rho}\, m}{\sqrt{1-\rho}}\right)$$

Given $M = m$, claims are **conditionally independent** with win probability $q_i(m, \rho)$.

### Boundary Cases

| $\rho$ | Behaviour |
|--------|-----------|
| $\rho = 0$ | $q_i = p_i$ — full independence, no correlation effect |
| $\rho = 1$ | $q_i \in \{0, 1\}$ — deterministic: all claims win or lose together depending on $m$ vs $\Phi^{-1}(p_i)$ |

### Marginal Preservation

The model preserves each claim's unconditional win probability:

$$\int_{-\infty}^{\infty} q_i(m, \rho)\, \varphi(m)\, dm = p_i \quad \forall \rho$$

This is verified numerically using Gauss-Hermite quadrature.

---

## Numerical Integration: Gauss-Hermite Quadrature

Portfolio metrics are expectations over $M$:

$$\mathbb{E}[f(\text{portfolio})] = \int_{-\infty}^{\infty} f(m)\, \varphi(m)\, dm \approx \sum_{j=1}^{N} w_j\, f(m_j)$$

We use **30-node probabilist Gauss-Hermite quadrature** (`numpy.polynomial.hermite_e.hermegauss`) with weights normalized by $\frac{1}{\sqrt{2\pi}}$ to integrate directly against $\varphi(m)$.

---

## Outcome Vector Enumeration

For $K$ claims, we enumerate all $2^K$ binary outcome vectors $\mathbf{s} \in \{0,1\}^K$. Each vector represents a joint win/lose configuration. Given $M = m$:

$$\Pr(\mathbf{s} \mid M=m) = \prod_{i=1}^{K} q_i(m)^{s_i} (1-q_i(m))^{1-s_i}$$

The probability of each vector marginalized over $M$:

$$\Pr(\mathbf{s}) = \sum_{j=1}^{N} w_j \prod_{i=1}^{K} q_i(m_j)^{s_i} (1-q_i(m_j))^{1-s_i}$$

Computation is done in log-space for numerical stability.

---

## Portfolio Metrics

For each outcome vector $\mathbf{s}$, we compute MOIC and IRR for **reference deal structures**:

| Deal Key | Upfront % | Tail % |
|----------|-----------|--------|
| `10_20` | 10% | 20% |
| `15_25` | 15% | 25% |
| `20_30` | 20% | 30% |
| `30_10` | 30% | 10% |

### Portfolio MOIC

$$\text{MOIC}(\mathbf{s}) = \frac{\sum_i \text{Return}_i(\mathbf{s}_i)}{\sum_i \text{Deployed}_i}$$

where $\text{Return}_i$ and $\text{Deployed}_i$ depend on the deal structure and whether claim $i$ won or lost.

### Aggregate Metrics per $\rho$

| Metric | Formula |
|--------|---------|
| $\mathbb{E}[\text{MOIC}]$ | $\sum_{\mathbf{s}} \Pr(\mathbf{s}) \cdot \text{MOIC}(\mathbf{s})$ |
| $\sigma[\text{MOIC}]$ | $\sqrt{\sum_{\mathbf{s}} \Pr(\mathbf{s}) \cdot (\text{MOIC}(\mathbf{s}) - \mathbb{E}[\text{MOIC}])^2}$ |
| $\Pr(\text{loss})$ | $\sum_{\mathbf{s}: \text{MOIC}<1} \Pr(\mathbf{s})$ |
| $\text{VaR}_{99\%}$ | 1st percentile of $\Pr$-weighted MOIC distribution |
| $\text{CVaR}_{99\%}$ | Expected MOIC in the worst 1% tail |
| $\mathbb{E}[\text{IRR}]$ | $\Pr$-weighted average IRR across outcome vectors |

---

## 2D Heatmap Surface

A joint surface over $(\rho, \delta)$ where $\delta$ is a probability shock applied to all claims:

$$p_i' = \text{clip}(p_i + \delta, 0.01, 0.99)$$

Grid: $\rho \in \{0.0, 0.1, \ldots, 1.0\}$ (11 values) × $\delta \in \{-0.15, -0.10, \ldots, +0.15\}$ (7 values).

---

## Diversification Benefit

Quantifies the portfolio's correlation sensitivity:

| Metric | Definition |
|--------|-----------|
| $\Pr(\text{loss} \mid \rho=0)$ | Fully diversified baseline |
| $\Pr(\text{loss} \mid \rho=0.5)$ | Moderate correlation |
| $\Pr(\text{loss} \mid \rho=1)$ | Zero diversification (perfect correlation) |
| Diversification ratio | $\Pr(\text{loss} \mid \rho=0) \,/\, \Pr(\text{loss} \mid \rho=0.5)$ |

---

## Implementation Details

- **Module**: `engine/v2_core/v2_correlation_sensitivity.py`
- **Entry point**: `run_correlation_sensitivity(sim, claims, grid, pricing_basis, ctx)`
- **Complexity**: $O(N_\rho \times N_{GH} \times 2^K)$ where $K$ = number of claims (≤ 10 recommended)
- **Dependencies**: `scipy.special.ndtri`, `scipy.special.ndtr`, `numpy.polynomial.hermite_e.hermegauss`
- **Test suite**: `engine/tests/test_correlation_sensitivity.py` (67 tests)

## References

- Vasicek, O. (1987). "Probability of Loss on Loan Portfolio." KMV Corporation.
- Li, D.X. (2000). "On Default Correlation: A Copula Function Approach." *Journal of Fixed Income*.
- Abramowitz, M. & Stegun, I.A. (1964). *Handbook of Mathematical Functions* — Gauss-Hermite quadrature tables.
