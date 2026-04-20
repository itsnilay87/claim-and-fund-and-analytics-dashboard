# Legal Framework Specification

> **Document**: 01_LEGAL_FRAMEWORK.md  
> **Version**: 2.0  
> **Scope**: Jurisdiction-specific arbitration challenge processes

---

## Overview

This document specifies the **legal process model** for post-arbitration challenges across three jurisdictions:

1. **Indian Domestic** — Arbitration & Conciliation Act, 1996
2. **SIAC Singapore** — International Arbitration Act, Singapore
3. **HKIAC Hong Kong** — Arbitration Ordinance, Cap 609

Each jurisdiction defines a **challenge tree** — the sequence of court stages through which an arbitration award may be contested.

---

## 1. Indian Domestic Arbitration

### Legal Authority

- **Arbitration & Conciliation Act, 1996** (as amended 2015, 2019, 2021)
- **Section 34**: Application for setting aside arbitral award
- **Section 37**: Appeals from orders under Section 34
- **Article 136, Constitution of India**: Special Leave Petition to Supreme Court

### Challenge Tree Structure

```
Arbitration Award
       │
       ▼
   Section 34 (District/High Court)
       │
   ┌───┴───┐
   │       │
   ▼       ▼
Respondent   Respondent
  Fails       Wins
(Award       (Award Set
Upheld)       Aside)
   │           │
   ▼           ▼
Section 37  Section 37
 Appeal      Appeal
   │           │
   ▼           ▼
  ...         ...
   │           │
   ▼           ▼
Supreme Court SLP
(Leave + Merits)
   │
   ▼
Terminal Outcome
```

### Scenario A: Claimant Won Arbitration (Respondent Challenges)

When the award holder (claimant) prevailed at arbitration, the respondent initiates challenges. The **outcome notation** from claimant's perspective:

| Outcome | Legal Meaning | Financial Result |
|---------|---------------|------------------|
| **TRUE_WIN** | Award survives all challenges, becomes enforceable | Claimant collects $Q$ |
| **LOSE** | Award set aside, no further recourse | Claimant collects $0$ |

**Note**: No RESTART outcome in Scenario A because if claimant already won, a remand would still yield a favorable position (award intact or new hearing with same merits).

### Scenario B: Claimant Lost Arbitration (Claimant Challenges)

When the claimant lost at arbitration, they initiate challenges to vacate the adverse award.

| Outcome | Legal Meaning | Financial Result |
|---------|---------------|------------------|
| **RESTART** | Adverse award vacated, matter remanded for fresh arbitration | New arbitration with fresh outcome draw |
| **LOSE** | Adverse award upheld | Claimant collects $0$ |

**Note**: No TRUE_WIN in Scenario B because vacating an adverse award doesn't itself create a recovery — it merely permits re-arbitration.

### S.34 — Setting Aside Application

**Grounds (Section 34(2)):**
- Incapacity of party
- Invalid arbitration agreement
- Improper notice or inability to present case
- Award beyond scope of submission
- Tribunal composition not per agreement
- Subject matter not arbitrable
- Award conflicts with public policy of India

**Limitation Period**: 3 months from receipt of award (+ 30 days condonable)

**Forum**: 
- Principal Civil Court (pre-2015 amendment)
- Commercial Court/High Court (post-2015 for commercial disputes > ₹1 Cr)

**Duration Model**: $T_{S.34} \sim \text{Uniform}(9, 18)$ months

**Legal Cost Model**: ₹2.0 - 3.0 Crore (counsel + filing fees)

### S.37 — Appeal

**Scope**: Appeal lies from:
- Order setting aside award (S.34)
- Order refusing to set aside award (S.34)
- Certain interim orders

**Forum**: Commercial Appellate Division or Division Bench of High Court

**Duration Model**: $T_{S.37} \sim \text{Uniform}(6, 12)$ months

**Legal Cost Model**: ₹1.0 - 2.0 Crore

### SLP — Special Leave Petition to Supreme Court

**Two-Stage Process**:
1. **Leave Stage**: Petition for permission to appeal
2. **Merits Stage**: Substantive hearing (if leave granted)

**Leave Criteria** (Article 136):
- Substantial question of law
- Grave injustice or miscarriage
- Judicial discretion, not entitlement

**Duration Model**:
- Leave Refused: $T_{SLP} = 4$ months (fixed)
- Leave Granted: $T_{SLP} = 24$ months (fixed, includes merits hearing)

**Legal Cost Model**:
- Dismissed: ₹0.5 - 1.0 Crore
- Admitted: ₹2.0 - 3.0 Crore

### Conditional Probability Structure (Scenario A)

```
Level 1: S.34
├── P(Respondent Fails S.34) = 0.70  → Claimant favorable
│   │
│   Level 2: S.37 (Respondent appeals)
│   ├── P(Respondent Fails S.37 | Resp failed S.34) = 0.80
│   │   │
│   │   Level 3: SLP (Respondent files, very weak)
│   │   ├── P(SLP Dismissed) = 0.90 → TRUE_WIN (A1)
│   │   └── P(SLP Admitted) = 0.10
│   │       │
│   │       Level 4: SLP Merits
│   │       ├── P(Claimant Wins) = 0.90 → TRUE_WIN (A3)
│   │       └── P(Respondent Wins) = 0.10 → LOSE (A2)
│   │
│   └── P(Respondent Wins S.37 | Resp failed S.34) = 0.20
│       │
│       Level 3: SLP (Claimant files)
│       ├── P(SLP Dismissed) = 0.50 → LOSE (A4)
│       └── P(SLP Admitted) = 0.50
│           │
│           Level 4: SLP Merits  
│           ├── P(Claimant Wins) = 0.50 → TRUE_WIN (A5)
│           └── P(Claimant Loses) = 0.50 → LOSE (A6)
│
└── P(Respondent Wins S.34) = 0.30  → Award set aside
    │
    Level 2: S.37 (Claimant appeals)
    ├── P(Claimant Wins S.37 | Resp won S.34) = 0.50
    │   │
    │   Level 3: SLP (Respondent files)
    │   ... [similar structure]
    │
    └── P(Claimant Loses S.37 | Resp won S.34) = 0.50
        │
        Level 3: SLP (Claimant files, very weak)
        ... [similar structure]
```

### Terminal Path Probabilities (Scenario A)

| Path | S.34 | S.37 | SLP | Merits | Conditional Prob | Outcome |
|------|------|------|-----|--------|------------------|---------|
| A1 | Resp Fails | Resp Fails | Dismissed | — | 0.504 | TRUE_WIN |
| A2 | Resp Fails | Resp Fails | Admitted | Resp Wins | 0.0056 | LOSE |
| A3 | Resp Fails | Resp Fails | Admitted | Claim Wins | 0.0504 | TRUE_WIN |
| A4 | Resp Fails | Resp Wins | Dismissed | — | 0.07 | LOSE |
| A5 | Resp Fails | Resp Wins | Admitted | Claim Wins | 0.035 | TRUE_WIN |
| A6 | Resp Fails | Resp Wins | Admitted | Claim Loses | 0.035 | LOSE |
| A7 | Resp Wins | Claim Wins | Dismissed | — | 0.1125 | TRUE_WIN |
| A8 | Resp Wins | Claim Wins | Admitted | Resp Wins | 0.0094 | LOSE |
| A9 | Resp Wins | Claim Wins | Admitted | Claim Wins | 0.0281 | TRUE_WIN |
| A10 | Resp Wins | Claim Loses | Dismissed | — | 0.12 | LOSE |
| A11 | Resp Wins | Claim Loses | Admitted | Claim Wins | 0.006 | TRUE_WIN |
| A12 | Resp Wins | Claim Loses | Admitted | Claim Loses | 0.024 | LOSE |

**Verification**: $\sum = 1.0000$ ✓

**Outcome Totals**:
- TRUE_WIN: 0.7360 (73.6%)
- LOSE: 0.2640 (26.4%)
- RESTART: 0.0000 (0%) ← Structural constraint

---

## 2. SIAC Singapore Arbitration

### Legal Authority

- **International Arbitration Act** (Cap 143A)
- **UNCITRAL Model Law** (scheduled to IAA)
- **Article 34**: Setting aside of arbitral award
- **Singapore Court of Appeal** jurisdiction

### Challenge Tree Structure (2 Levels)

```
Arbitration Award
       │
       ▼
High Court (Setting Aside under Art. 34)
       │
   ┌───┴───┐
   ▼       ▼
Award     Award
Upheld    Set Aside
   │         │
   ▼         ▼
Court of Appeal
   │
   ▼
Terminal Outcome
```

### Grounds for Setting Aside (Article 34)

Same as UNCITRAL Model Law:
- Incapacity or invalid agreement
- Lack of proper notice
- Award beyond scope
- Tribunal composition issues
- Non-arbitrable subject matter
- Award contrary to public policy

### Duration Model

- High Court: $T_{HC} = 6$ months (fixed)
- Court of Appeal: $T_{COA} = 6$ months (fixed)

**Note**: Singapore courts are significantly faster than Indian courts due to specialized Commercial Division and efficient case management.

### Probability Structure

**Scenario A (Claimant Won Arbitration)**:
```
HC: P(Award Upheld) = 0.80
    │
    ├── COA: P(Upheld at COA | Upheld at HC) = 0.90 → TRUE_WIN
    └── COA: P(Set Aside at COA | Upheld at HC) = 0.10 → LOSE
    
HC: P(Award Set Aside) = 0.20
    │
    ├── COA: P(Restored at COA | Set Aside at HC) = 0.50 → TRUE_WIN
    └── COA: P(Affirmed SA at COA | Set Aside at HC) = 0.50 → LOSE
```

| Path | HC | COA | Conditional Prob | Outcome |
|------|-----|-----|------------------|---------|
| SIAC_A1 | Upheld | Upheld | 0.72 | TRUE_WIN |
| SIAC_A2 | Upheld | Set Aside | 0.08 | LOSE |
| SIAC_A3 | Set Aside | Restored | 0.10 | TRUE_WIN |
| SIAC_A4 | Set Aside | Affirmed | 0.10 | LOSE |

**Totals**: TRUE_WIN = 0.82, LOSE = 0.18

---

## 3. HKIAC Hong Kong Arbitration

### Legal Authority

- **Arbitration Ordinance** (Cap 609)
- **UNCITRAL Model Law** (scheduled)
- **Court of First Instance** (CFI) — equivalent to High Court
- **Court of Appeal** (CA)
- **Court of Final Appeal** (CFA) — highest court

### Challenge Tree Structure (3 Levels with Leave Gate)

```
Arbitration Award
       │
       ▼
Court of First Instance (CFI)
       │
   ┌───┴───┐
   ▼       ▼
Upheld   Set Aside
   │         │
   ▼         ▼
Court of Appeal (CA)
       │
   ┌───┴───┐
   ▼       ▼
[result] [result]
       │
       ▼
CFA Leave Application
   │
   ├── Refused → Terminal (use CA result)
   └── Granted → CFA Merits Hearing
                       │
                       ▼
                 Terminal Outcome
```

### CFA Leave Gate

Leave to appeal to CFA is **not automatic**. Criteria:
- Question of great general or public importance
- Substantial and grave injustice
- Discretionary, rarely granted

**Model**: Leave is an independent Bernoulli draw at each branch.

### Duration Model

- CFI: $T_{CFI} \sim \text{Uniform}(6, 12)$ months
- CA: $T_{CA} \sim \text{Uniform}(6, 9)$ months
- CFA (Leave Refused): $T_{CFA} = 2$ months (fixed)
- CFA (Leave Granted): $T_{CFA} \sim \text{Uniform}(9, 15)$ months

### Probability Structure (Scenario A)

```
CFI: P(Award Upheld) = 0.85
│
├── CA Outcome (conditional on CFI upheld)
│   ├── P(CA Upholds | CFI Upheld) = 0.88
│   │   └── CFA Leave Gate
│   │       ├── P(Leave Refused) = 0.85 → TRUE_WIN
│   │       └── P(Leave Granted) = 0.15
│   │           ├── P(CFA Upholds) = 0.75 → TRUE_WIN
│   │           └── P(CFA Reverses) = 0.25 → LOSE
│   │
│   └── P(CA Sets Aside | CFI Upheld) = 0.12
│       └── CFA Leave Gate
│           ├── P(Leave Refused) = 0.60 → LOSE
│           └── P(Leave Granted) = 0.40
│               ├── P(CFA Restores) = 0.60 → TRUE_WIN
│               └── P(CFA Affirms SA) = 0.40 → LOSE
│
└── CFI: P(Award Set Aside) = 0.15
    │
    └── [symmetric structure]
```

**12 Terminal Paths for Scenario A**

| Path | CFI | CA | CFA Leave | CFA Merits | Cond Prob | Outcome |
|------|-----|-----|-----------|------------|-----------|---------|
| HK_A1 | Up | Up | Refused | — | 0.6358 | TRUE_WIN |
| HK_A2 | Up | Up | Granted | Upholds | 0.0841 | TRUE_WIN |
| HK_A3 | Up | Up | Granted | Reverses | 0.0280 | LOSE |
| HK_A4 | Up | SA | Refused | — | 0.0612 | LOSE |
| HK_A5 | Up | SA | Granted | Restores | 0.0245 | TRUE_WIN |
| HK_A6 | Up | SA | Granted | Affirms | 0.0163 | LOSE |
| ... | | | | | | |

**Totals (approx)**: TRUE_WIN ≈ 0.81, LOSE ≈ 0.19

---

## 4. Implementation Specification

### Data Structure: Challenge Tree Node

```python
@dataclass
class TreeNode:
    name: str                          # e.g., "S.34", "HC"
    probability: float                 # P(reaching this node | parent)
    outcome: Optional[str]             # Terminal: "TRUE_WIN" | "LOSE" | "RESTART"
    duration_distribution: Dict        # {"type": "uniform", "low": 9, "high": 18}
    legal_cost: Dict                   # {"low": 2.0, "high": 3.0} in Crore
    children: List["TreeNode"]         # Empty for terminal nodes
```

### Traversal Algorithm

```python
def traverse_challenge_tree(root: TreeNode, rng: Generator) -> ChallengeResult:
    """
    Level-by-level stochastic traversal.
    
    At each interior node:
      1. Draw stage duration from duration_distribution
      2. Accumulate legal costs
      3. Draw child selection from probability distribution
      4. Recurse until terminal node reached
    
    Returns ChallengeResult with path_id, outcome, total_duration, total_cost.
    """
    current = root
    total_duration = 0.0
    total_cost = 0.0
    path_trace = []
    
    while current.outcome is None:  # Not terminal
        # Draw duration
        dur = draw_duration(current.duration_distribution, rng)
        total_duration += dur
        
        # Accumulate cost
        cost = draw_cost(current.legal_cost, rng)
        total_cost += cost
        
        # Select child
        child_probs = [c.probability for c in current.children]
        child_idx = rng.choice(len(current.children), p=child_probs)
        current = current.children[child_idx]
        path_trace.append(current.name)
    
    return ChallengeResult(
        path_id="_".join(path_trace),
        outcome=current.outcome,
        timeline_months=total_duration,
        legal_cost_cr=total_cost,
    )
```

### Validation Requirements

1. **Probability Conservation**: At each node, $\sum_{\text{children}} P_{\text{child}} = 1.0$
2. **Outcome Constraints**:
   - Scenario A: Only TRUE_WIN or LOSE terminals
   - Scenario B: Only RESTART or LOSE terminals
3. **Terminal Completeness**: All leaf paths have defined outcomes
4. **Path Sum**: $\sum_{\text{all paths}} P_{\text{path}} = 1.0$

---

## 5. Known Outcomes (Post-Arbitration Stages)

When a claim is at a post-arbitration stage (e.g., S.34 completed), certain outcomes are **already known**:

### Stage → Known Outcome Mapping

| Current Stage | Arbitration Outcome | Applicable Scenario | Remaining Tree |
|---------------|---------------------|---------------------|----------------|
| `s34_pending` | Known (won or lost) | A or B | S.34 → S.37 → SLP |
| `s34_done_favorable` | Won | A | S.37 → SLP onwards |
| `s34_done_adverse` | Won | A | S.37 → SLP (from loss branch) |
| `s37_pending` | Known | A or B | S.37 → SLP |
| `slp_pending` | Known | A or B | SLP only |
| `hc_pending` | Known | A or B | HC → COA |

### Implementation

For claims with known outcomes, the simulator:
1. **Forces** the arbitration outcome draw (no randomness)
2. **Skips** completed stages (duration = 0)
3. **Enters** challenge tree at the appropriate branch
4. **Uses TruncatedNormal** for known quantum (if award issued)

---

## 6. Legal References

### Indian Domestic Arbitration
- Arbitration & Conciliation Act, 1996 (No. 26 of 1996)
- Commercial Courts Act, 2015 (No. 4 of 2016)
- Bharat Aluminium Co. v. Kaiser Aluminium Technical Services Inc., (2012) 9 SCC 552
- ONGC v. Saw Pipes Ltd., (2003) 5 SCC 705

### SIAC Singapore
- International Arbitration Act (Cap 143A)
- PT First Media TBK v. Astro Nusantara International BV [2014] 1 SLR 372
- Sanum Investments Ltd v. Government of the Lao People's Democratic Republic [2016] 5 SLR 536

### HKIAC Hong Kong
- Arbitration Ordinance (Cap 609)
- Astro Nusantara International BV v. PT Ayunda Prima Mitra [2018] HKCFA 12
- City Univ of Hong Kong v. Fok Lai Ying [2012] HKCA 112
