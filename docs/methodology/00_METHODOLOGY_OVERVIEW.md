# Litigation Funding Analytics Platform — Methodology Overview

> **Version**: 2.0  
> **Last Updated**: 2025-01-15  
> **Status**: Reference Specification  
> **Audience**: AI Agents, Developers, Quantitative Analysts, Legal Counsel

---

## Purpose of This Document

This methodology specification defines the **mathematical, statistical, legal, and financial foundations** for the Claim Analytics Platform. It serves as the authoritative reference for:

1. **AI Agents**: Understanding domain requirements before code generation
2. **Developers**: Implementing features that conform to specification
3. **Validators**: Verifying that implementation matches theory
4. **Auditors**: Assessing model risk and regulatory compliance

**Critical Rule**: Code implementation MUST follow this specification. Any deviation requires explicit documentation with justification.

---

## Executive Summary

The platform models **litigation funding investments** for international arbitration claims. The core problem:

> Given a portfolio of arbitration claims with uncertain legal outcomes, what is the probability distribution of investment returns under various funding structures?

### Model Components

| Component | Purpose | Primary Document |
|-----------|---------|------------------|
| **Legal Framework** | Define challenge trees per jurisdiction | [01_LEGAL_FRAMEWORK.md](./01_LEGAL_FRAMEWORK.md) |
| **Probability Model** | Outcome probabilities, independence assumptions | [02_PROBABILITY_MODEL.md](./02_PROBABILITY_MODEL.md) |
| **Quantum Model** | Award amount distributions | [03_QUANTUM_MODEL.md](./03_QUANTUM_MODEL.md) |
| **Timeline Model** | Stage durations, cap enforcement | [04_TIMELINE_MODEL.md](./04_TIMELINE_MODEL.md) |
| **Settlement Model** | Negotiated exit process | [05_SETTLEMENT_MODEL.md](./05_SETTLEMENT_MODEL.md) |
| **Legal Cost Model** | Fee structures, overrun distributions | [06_LEGAL_COST_MODEL.md](./06_LEGAL_COST_MODEL.md) |
| **Interest Model** | Award accrual, statutory rates | [07_INTEREST_MODEL.md](./07_INTEREST_MODEL.md) |
| **Cashflow Model** | Investment structures, waterfalls | [08_CASHFLOW_MODEL.md](./08_CASHFLOW_MODEL.md) |
| **Risk Metrics** | VaR, CVaR, MOIC, IRR calculations | [09_RISK_METRICS.md](./09_RISK_METRICS.md) |
| **Correlation Model** | Multi-claim dependencies | [10_CORRELATION_MODEL.md](./10_CORRELATION_MODEL.md) |
| **Calibration** | Parameter estimation, validation | [11_CALIBRATION.md](./11_CALIBRATION.md) |
| **System Architecture** | Technical implementation design | [12_SYSTEM_ARCHITECTURE.md](./12_SYSTEM_ARCHITECTURE.md) |

---

## Mathematical Framework

### Notation Convention

| Symbol | Meaning | Units |
|--------|---------|-------|
| $C_i$ | Claim $i$ in portfolio | — |
| $SOC_i$ | Statement of Claim value for claim $i$ | ₹ Crore |
| $Q_i$ | Realized quantum (award) for claim $i$ | ₹ Crore |
| $P(\cdot)$ | Probability measure | [0, 1] |
| $\mathbb{E}[\cdot]$ | Expectation operator | varies |
| $T$ | Time to resolution | months |
| $r$ | Discount rate / IRR | annual % |
| $\lambda$ | Hazard rate (settlement) | per-stage prob |
| $\delta$ | Settlement discount factor | [0, 1] |
| $\alpha$ | Bargaining power parameter | [0, 1] |

### State Space

Each claim $C_i$ evolves through a discrete state space:

$$
\mathcal{S} = \{\text{DAB}, \text{ARB}, \text{S34}, \text{S37}, \text{SLP}, \text{HC}, \text{COA}, \ldots, \text{RESOLVED}\}
$$

States are jurisdiction-specific. Terminal states are:
- **TRUE_WIN**: Award enforced, quantum collected
- **LOSE**: Claim fails, zero recovery
- **RESTART**: Award vacated, re-arbitration required
- **SETTLED**: Negotiated exit at discount $\delta$

---

## Monte Carlo Simulation Framework

### Algorithm Overview

For $N$ simulation paths (default $N = 10{,}000$):

```
FOR path_idx = 1 TO N:
    rng = RandomGenerator(base_seed + path_idx)
    
    FOR each claim C_i in portfolio:
        1. Draw pre-arbitration timeline: T_pre ~ Timeline_Distribution
        2. Draw arbitration outcome: A_i ~ Bernoulli(p_win)
        3. IF A_i = WIN:
             Draw quantum: Q_i ~ QuantumDistribution(SOC_i)
           ELSE:
             Q_i = 0 (or expected value for settlement reference)
        4. Traverse challenge tree: C_i ~ ChallengeTree(jurisdiction, A_i)
        5. At each stage, evaluate settlement opportunity
        6. Compute total duration, legal costs, collected amount
        7. Build cashflow vector
    
    Aggregate portfolio cashflows
    Compute path metrics: MOIC_path, IRR_path

Compute distributional statistics over N paths
```

### Reproducibility Requirements

1. **Deterministic seeding**: Path $k$ uses seed = `base_seed + k`
2. **No global RNG state**: All draws via explicit `rng.random()` calls
3. **Draw ordering**: Documented sequence to ensure cross-implementation consistency
4. **Validation**: Same seed MUST produce identical results across runs

---

## Investment Structure Types

### 1. Litigation Funding (Base Case)

Funder provides:
- Legal cost coverage (month-by-month as incurred)

Funder receives:
- Priority return of capital
- Success fee / carried interest on recovery

Claimant retains:
- Residual after funder's share ("tail")

### 2. Monetisation — Full Purchase

Funder provides:
- Upfront payment = $\alpha \times SOC$ (or $\alpha \times \mathbb{E}[Q]$)
- Ongoing legal cost coverage

Funder receives:
- 100% of recovery

### 3. Monetisation — Upfront + Tail

Funder provides:
- Upfront payment = $\alpha \times \text{pricing\_basis}$
- Ongoing legal cost coverage

Funder receives:
- $(1 - \tau) \times \text{recovery}$ where $\tau$ = claimant's tail share

Claimant receives:
- $\tau \times \text{recovery}$

### 4. Monetisation — Staged Payments

Funder provides:
- Payment_1 at signing
- Payment_2 at milestone_1 (e.g., DAB completion)
- Payment_3 at milestone_2 (e.g., arbitration award)
- Legal cost coverage

Funder receives:
- $(1 - \tau) \times \text{recovery}$

---

## Key Modeling Assumptions

### Explicitly Stated Assumptions

1. **No Counterparty Default**: Respondent (e.g., DFCCIL) pays 100% of enforced awards
2. **No Currency Risk**: All values in native currency (₹), no FX modeling
3. **No Regulatory/Political Risk**: Judicial system functions as designed
4. **Discrete Monthly Timestep**: Cashflows occur at month-end dates
5. **No Reinvestment**: Intermediate cashflows not reinvested within model

### Assumptions Requiring Validation

| Assumption | Current Treatment | Risk if Violated |
|------------|-------------------|------------------|
| Court stage independence | Independent draws per level | Understates correlation, overestimates diversification |
| Same-respondent claims independent | No correlation modeled | Significant if DFCCIL payment capacity is systemically constrained |
| Re-arbitration same as initial | Same $P(\text{win})$ used | Overstates RESTART value if incumbency effects exist |
| Quantum bands calibrated | Hardcoded probabilities | Misprices expected recovery |

---

## Risk Framework

### Model Risk Categories

| Category | Description | Mitigation |
|----------|-------------|------------|
| **Specification Risk** | Model structure incorrect | Expert legal review, backtesting |
| **Parameter Risk** | Calibration estimates wrong | Sensitivity analysis, confidence intervals |
| **Implementation Risk** | Code doesn't match spec | Unit tests, validation suite |
| **Data Risk** | Input data errors | Schema validation, input checks |

### Stress Testing Requirements

Before production use, the model MUST be stress tested:

1. **P(win) shock**: ±20% on arbitration win probability
2. **Duration shock**: +50% on all stage durations
3. **Recovery shock**: -30% on quantum percentiles
4. **Correlation stress**: 50% common factor on all claims

---

## Document Change Control

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2025-12-01 | Initial | Initial specification |
| 2.0 | 2026-04-03 | Copilot | Comprehensive rewrite, added settlement, correlation |

### Review Requirements

- **Material changes**: Require domain expert sign-off
- **Parameter changes**: Require calibration documentation
- **Code changes**: MUST reference this spec in commit messages

---

## Quick Reference: Implementation Checklist

When implementing a new feature, verify:

- [ ] Mathematical specification exists in this document
- [ ] Edge cases are defined
- [ ] Units and conventions match specification
- [ ] Test cases derived from specification examples
- [ ] Error handling matches specification error states
