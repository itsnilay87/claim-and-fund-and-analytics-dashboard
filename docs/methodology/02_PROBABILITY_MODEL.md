# Probability Model Specification

> **Document**: 02_PROBABILITY_MODEL.md  
> **Version**: 2.0  
> **Scope**: Stochastic model for outcome probabilities

---

## 1. Foundational Framework

### Probability Space

The litigation outcome is modeled on a probability space $(\Omega, \mathcal{F}, \mathbb{P})$ where:

- $\Omega$ = sample space of all possible litigation paths
- $\mathcal{F}$ = σ-algebra of events (path outcomes)
- $\mathbb{P}$ = probability measure defined by tree traversal

### Filtration Structure

Information is revealed sequentially through stages:

$$
\mathcal{F}_0 \subseteq \mathcal{F}_{ARB} \subseteq \mathcal{F}_{S.34} \subseteq \mathcal{F}_{S.37} \subseteq \mathcal{F}_{SLP} \subseteq \mathcal{F}_T
$$

where $\mathcal{F}_t$ represents information available after stage $t$.

**Implication**: Probabilities at later stages are **conditional** on outcomes at earlier stages.

---

## 2. Arbitration Outcome Model

### Primary Arbitration

$$
A \sim \text{Bernoulli}(p_{win})
$$

where:
- $A = 1$ represents claimant wins arbitration
- $A = 0$ represents claimant loses arbitration
- $p_{win}$ = probability of claimant victory (calibrated parameter)

**Default**: $p_{win} = 0.70$ (expert judgment based on historical DFCCIL outcomes)

### Re-Arbitration (After RESTART)

When a Scenario B path yields RESTART, fresh arbitration occurs:

$$
A_{re} \sim \text{Bernoulli}(p_{re-win})
$$

**Critical Modeling Question**: Is $A_{re}$ independent of initial $A = 0$?

**Current Assumption**: $p_{re-win} = p_{win} = 0.70$ (independence)

**More Realistic Model** (future enhancement):

$$
p_{re-win} = p_{win} + \epsilon_{remand}
$$

where $\epsilon_{remand}$ captures the information revealed by prior court findings. If the court remanded due to procedural issues rather than merits, the fresh hearing may favor the original loser.

---

## 3. Challenge Tree Probabilities

### Level-by-Level Traversal

At each stage $s$ in the challenge tree, the outcome is:

$$
X_s | X_{s-1} \sim \text{Categorical}(\{p_{s,k}\})
$$

where $\{p_{s,k}\}$ are **conditional** probabilities given the outcome at stage $s-1$.

### Conditional Independence Assumption

The model assumes:

$$
P(X_s | X_{s-1}, X_{s-2}, \ldots, X_1) = P(X_s | X_{s-1})
$$

This is a **Markov assumption** — each stage depends only on its immediate predecessor, not the full history.

**Validity**: This is a simplification. In reality:
- Judges may review the full procedural history
- Appellate courts consider lower court reasoning
- Cumulative wins/losses affect judicial psychology

**Risk**: Underestimates path dependence in highly contested matters.

### Probability Tables

Each jurisdiction has explicit conditional probability tables stored in `v2_master_inputs.py`:

**Indian Domestic (Scenario A)**:

| Parent State | Child State | Probability |
|--------------|-------------|-------------|
| ROOT | S.34_Resp_Fails | 0.70 |
| ROOT | S.34_Resp_Wins | 0.30 |
| S.34_Resp_Fails | S.37_Resp_Fails | 0.80 |
| S.34_Resp_Fails | S.37_Resp_Wins | 0.20 |
| ... | ... | ... |

### Path Probability Computation

For a path $\pi = (s_1, s_2, \ldots, s_k, \omega)$ ending in terminal outcome $\omega$:

$$
P(\pi) = \prod_{i=1}^{k} P(s_i | s_{i-1})
$$

where $s_0$ is the root node.

**Validation Constraint**:

$$
\sum_{\pi \in \Pi_A} P(\pi) = 1.0 \quad \text{(for Scenario A)}
$$

$$
\sum_{\pi \in \Pi_B} P(\pi) = 1.0 \quad \text{(for Scenario B)}
$$

---

## 4. SLP Gate Model (Indian Domestic)

The Supreme Court leave stage has a **two-stage structure**:

### Stage 1: Leave Decision

$$
L \sim \text{Bernoulli}(p_{admitted})
$$

where $p_{admitted}$ varies by branch:

| Prior Outcome Pattern | $p_{admitted}$ | Rationale |
|----------------------|----------------|-----------|
| Respondent lost S.34 + S.37, files SLP | 0.10 | Weak petition, unlikely to show substantial question |
| Claimant won S.34, lost S.37, files SLP | 0.50 | Mixed record, arguable |
| Claimant lost both S.34 + S.37, files SLP | 0.20 | Very weak, but possible procedural errors |
| Respondent won S.34, lost S.37, files SLP | 0.25 | Arguable, divided lower courts |

### Stage 2: Merits Decision (if $L = 1$)

$$
M | L = 1 \sim \text{Bernoulli}(p_{merits|admitted})
$$

**Note**: $p_{merits|admitted}$ is the probability that the claimant's position prevails on merits, given leave was granted.

### Combined Probability

$$
P(\text{Claimant Wins SLP}) = p_{admitted} \times p_{merits|admitted}
$$

$$
P(\text{Claimant Loses SLP}) = (1 - p_{admitted}) \times 1 + p_{admitted} \times (1 - p_{merits|admitted})
$$

---

## 5. Probability Parameter Calibration

### Expert Elicitation Method

Current probabilities are derived from expert legal judgment, not statistical estimation. The process:

1. **Identify base rate**: Historical success rates in similar proceedings
2. **Adjust for case specifics**: Strength of legal arguments, tribunal composition
3. **Validate with counsel**: External legal opinion on reasonableness

### Required Documentation

Each probability parameter MUST have documented:
- **Source**: Expert name, historical data source, or assumption
- **Confidence**: High / Medium / Low
- **Sensitivity**: How sensitive are outputs to ±20% change?

**Example Documentation**:

```yaml
parameter: ARB_WIN_PROBABILITY
value: 0.70
source: "Expert judgment — Partner, AZB Partners (2025-06-15)"
basis: "Historical DFCCIL tribunal outcomes 2018-2024 (n=12), adjusted for claim-specific strength"
confidence: Medium
sensitivity: High (E[MOIC] changes by ±15% for ±10% change in parameter)
validation: "To be backtested against eventual outcomes"
```

### Bayesian Updating (Future Enhancement)

As stages resolve, posterior probabilities should be updated:

$$
P(p_{win} | \text{data}) \propto P(\text{data} | p_{win}) \times P(p_{win})
$$

This is NOT currently implemented but should be for portfolio monitoring.

---

## 6. Independence Assumptions

### Within-Claim Independence

**Assumed Independent**:
- Timeline duration draws (each stage drawn independently)
- Legal cost overrun draw

**Assumed Dependent**:
- Challenge tree traversal (conditional on parent nodes)
- Quantum draw (conditional on arbitration win)

### Cross-Claim Independence (CRITICAL LIMITATION)

**Current Assumption**: Claims are mutually independent.

$$
P(A_1 \cap A_2 \cap \ldots \cap A_n) = \prod_{i=1}^{n} P(A_i)
$$

**Reality**: Claims against the same respondent share:
- Common legal risk factors (same counsel, similar legal issues)
- Common counterparty risk (DFCCIL payment capacity)
- Settlement linkage (one settlement affects negotiation on others)
- Judicial efficiency correlation (same court backlog affects all)

**Consequence**: Portfolio diversification benefits are **overstated**.

### Proposed Correlation Structure

Define a latent factor $Z$ representing "respondent legal health":

$$
P(A_i = 1 | Z) = \Phi(\rho_i Z + \sqrt{1 - \rho_i^2} \epsilon_i)
$$

where:
- $Z \sim N(0, 1)$ is the common factor
- $\epsilon_i \sim N(0, 1)$ is idiosyncratic
- $\rho_i$ is claim $i$'s loading on the common factor
- $\Phi$ is the standard normal CDF

This **one-factor Gaussian copula** model captures correlation while preserving marginal probabilities.

---

## 7. Edge Cases and Boundary Conditions

### Zero Probability Events

If any probability is exactly 0 or 1:
- The corresponding branch is **deterministic**
- No random draw required
- Implementation must handle gracefully

### Probability Clamping

For numerical stability:

$$
p_{clamped} = \max(\epsilon, \min(1 - \epsilon, p))
$$

where $\epsilon = 0.001$.

### Probability Table Validation

On initialization, validate:

1. All probabilities ∈ (0, 1)
2. Children probabilities sum to 1.0 (within tolerance 1e-4)
3. All leaf nodes have defined outcomes
4. Scenario A has no RESTART outcomes
5. Scenario B has no TRUE_WIN outcomes

---

## 8. Random Number Generation

### Generator Specification

Use NumPy's `default_rng` (PCG64 algorithm):

```python
rng = np.random.default_rng(seed)
```

### Seeding Convention

For simulation path $k$ with base seed $S$:

$$
\text{seed}_k = S + k
$$

This ensures:
1. Different paths use independent streams
2. Same base seed reproduces identical results
3. Adding paths doesn't change existing paths

### Draw Ordering

Within a single path, draws are made in **fixed order**:

1. Pre-arbitration stage durations
2. Arbitration outcome (Bernoulli)
3. Quantum band selection (Categorical)
4. Quantum percentage within band (Uniform)
5. Challenge tree traversal (level by level)
6. Legal cost overruns (Beta)
7. Settlement attempts (at each stage)

**This order MUST be preserved** for reproducibility across implementations.

---

## 9. Sensitivity Analysis Specification

### Parameter Shift Analysis

For key probability parameters, compute:

$$
\Delta \text{MOIC} = \frac{\partial \mathbb{E}[\text{MOIC}]}{\partial p} \times \Delta p
$$

### Analytical Reweighting

Instead of re-simulation, use path reweighting:

$$
\mathbb{E}[\text{MOIC}]_{p'} = \sum_{\pi} \text{MOIC}(\pi) \times \frac{P_{p'}(\pi)}{P_p(\pi)} \times P_p(\pi)
$$

where $P_{p'}(\pi)$ is the path probability under shifted parameter $p'$.

### Computed Sensitivities

| Parameter | Shift | E[MOIC] Change | E[IRR] Change |
|-----------|-------|----------------|---------------|
| $p_{win}$ | +10% | +8-12% | +3-5% |
| $p_{win}$ | -10% | -10-15% | -4-6% |
| Court probs | +10% all nodes | +5-8% | +2-3% |
| Quantum E[Q] | +10% | +10% | +2% |

---

## 10. Implementation Reference

### Data Structures

```python
# Path probability table entry
@dataclass
class PathEntry:
    path_id: str                    # e.g., "A1", "B7"
    conditional_prob: float         # P(this path | scenario)
    outcome: Literal["TRUE_WIN", "LOSE", "RESTART"]
    node_trace: List[str]           # Sequence of node names
```

### Core Functions

```python
def draw_bernoulli(p: float, rng: Generator) -> bool:
    """Draw from Bernoulli(p). Returns True with probability p."""
    return rng.random() < p

def draw_categorical(probs: List[float], rng: Generator) -> int:
    """Draw from Categorical distribution. Returns index."""
    return int(rng.choice(len(probs), p=probs))

def validate_probability_table(paths: List[PathEntry], scenario: str) -> None:
    """
    Validate that:
    1. All conditional probs sum to 1.0
    2. All outcomes are valid for scenario
    
    Raises ValueError if validation fails.
    """
    total = sum(p.conditional_prob for p in paths)
    if abs(total - 1.0) > 1e-4:
        raise ValueError(f"Probabilities sum to {total}, expected 1.0")
    
    if scenario == "A":
        invalid = [p for p in paths if p.outcome == "RESTART"]
    else:
        invalid = [p for p in paths if p.outcome == "TRUE_WIN"]
    
    if invalid:
        raise ValueError(f"Invalid outcomes for Scenario {scenario}: {invalid}")
```
