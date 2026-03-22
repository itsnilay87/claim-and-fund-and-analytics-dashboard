# Claim Analytics Platform — Jurisdiction Guide

**Version:** 1.0
**Date:** 20 March 2026

Step-by-step guide for adding a new arbitration jurisdiction to the Claim Analytics Platform. Includes a complete worked example for ICC Paris (French seat).

---

## Table of Contents

1. [Overview](#1-overview)
2. [Prerequisites](#2-prerequisites)
3. [Step 1: Research the Legal Process](#step-1-research-the-legal-process)
4. [Step 2: Build the Probability Tree](#step-2-build-the-probability-tree)
5. [Step 3: Estimate Stage Durations](#step-3-estimate-stage-durations)
6. [Step 4: Estimate Legal Costs per Stage](#step-4-estimate-legal-costs-per-stage)
7. [Step 5: Create the JSON Template](#step-5-create-the-json-template)
8. [Step 6: Validate Using the Registry](#step-6-validate-using-the-registry)
9. [Step 7: Test with a Sample Claim](#step-7-test-with-a-sample-claim)
10. [Worked Example: ICC Paris (French Seat)](#worked-example-icc-paris-french-seat)
11. [Available Jurisdictions](#available-jurisdictions)

---

## 1. Overview

The Claim Analytics Platform uses a **jurisdiction template system** to model post-arbitration court challenge paths. Each template is a JSON file encoding:

- A **probability tree** for two scenarios (claimant won / claimant lost arbitration)
- **Stage durations** (pre-arbitration pipeline + challenge stages)
- **Legal costs** (one-time + per-stage + stochastic overrun)
- **Metadata** (institution, country, restart support, enforcement notes)

Adding a new jurisdiction requires **zero engine code changes**. You create a JSON file, drop it into `engine/jurisdictions/templates/`, and the `JurisdictionRegistry` auto-discovers it on next startup.

---

## 2. Prerequisites

Before creating a new jurisdiction template, you need:

1. **Legal expertise** on the jurisdiction's post-award challenge mechanisms
2. **Empirical data** (or informed estimates) for outcome probabilities at each stage
3. **Duration estimates** for each court/challenge stage
4. **Cost estimates** for legal fees at each stage (in ₹ Crore or equivalent)

---

## Step 1: Research the Legal Process

For each jurisdiction, you must answer:

### Questions to Answer

| # | Question | Example (Indian Domestic) |
|---|----------|---------------------------|
| 1 | What courts can challenge the award? | S.34 (District), S.37 (High Court), SLP (Supreme Court) |
| 2 | Is there automatic right of appeal at each level? | S.34: automatic. S.37: automatic. SLP: requires admission. |
| 3 | What are the possible outcomes at each stage? | Upheld, set aside, partially set aside |
| 4 | Does setting aside a claimant-won award create a RESTART? | No — if claimant won and award is set aside, that's LOSE (no second arb) |
| 5 | Does setting aside a claimant-lost award create a RESTART? | Yes — vacating adverse award may lead to fresh arbitration |
| 6 | Is there a "gate" mechanism (e.g., leave to appeal)? | SLP requires admission (gate probability ~15%) |
| 7 | Does this jurisdiction support re-arbitration? | Yes (for Scenario B RESTART outcomes) |
| 8 | What are the enforcement characteristics? | Domestic enforcement via executing court; NY Convention signatory |

### Key Structural Rules

- **Scenario A** (claimant won arbitration): Terminal outcomes ∈ {`TRUE_WIN`, `LOSE`}. Never `RESTART`.
- **Scenario B** (claimant lost arbitration): Terminal outcomes ∈ {`RESTART`, `LOSE`}. Never `TRUE_WIN`.

**Why no RESTART in Scenario A?** If the claimant has a favourable award that is then set aside on challenge, the claimant has no mechanism to benefit from re-arbitration — the award in their favour is gone. This is a LOSE, not a RESTART.

**Why no TRUE_WIN in Scenario B?** If the claimant has an adverse award and challenges it, the best outcome is vacating that adverse award (RESTART — fresh arbitration on the merits), not an immediate win.

---

## Step 2: Build the Probability Tree

### 2.1 Tree Structure

Each scenario has a single root node with `probability: 1.0`. The tree branches at each decision point:

```
root (1.0)
├── No Challenge (p₁)  →  terminal outcome
├── Challenge at Level 1 (p₂ = 1 - p₁)
│   ├── Challenge Fails (p₃)  →  terminal outcome
│   ├── Challenge Succeeds (p₄)
│   │   ├── No Further Appeal (p₅)  →  terminal outcome
│   │   └── Appeal to Level 2 (p₆)
│   │       ├── Appeal Fails (p₇)  →  terminal
│   │       └── Appeal Succeeds (p₈)  →  terminal
```

### 2.2 Probability Rules

1. **Children probabilities must sum to 1.0** at every node (±1e-4 tolerance)
2. **Root probability is always 1.0**
3. **Leaf nodes must have an `outcome`** (`TRUE_WIN`, `RESTART`, or `LOSE`)
4. **Interior nodes must NOT have an `outcome`**
5. **Scenario A leaves**: Only `TRUE_WIN` or `LOSE`
6. **Scenario B leaves**: Only `RESTART` or `LOSE`

### 2.3 Probability Sources

Calibrate probabilities from:

- Published set-aside/annulment rates in the jurisdiction
- Legal counsel estimates
- Institutional statistics (e.g., ICC, SIAC publish annual data)
- Academic studies on challenge success rates

Document your sources in the template's `description` field.

### 2.4 Probability Verification

After building the tree, compute the total probabilities analytically:

For Scenario A:
- P(TRUE_WIN) = sum of all `TRUE_WIN` leaf probabilities
- P(LOSE) = sum of all `LOSE` leaf probabilities
- Verify: P(TRUE_WIN) + P(LOSE) = 1.0

For Scenario B:
- P(RESTART) = sum of all `RESTART` leaf probabilities
- P(LOSE) = sum of all `LOSE` leaf probabilities
- Verify: P(RESTART) + P(LOSE) = 1.0

---

## Step 3: Estimate Stage Durations

Each stage has a duration distribution. The platform supports:

| Type | JSON | Meaning |
|------|------|---------|
| Uniform | `{"type": "uniform", "low": 9, "high": 18}` | Duration drawn uniformly between low and high months |
| Fixed | `{"type": "fixed", "value": 4}` | Deterministic duration (no randomness) |

### Duration Sources

- Official court statistics (time to judgment at each level)
- Practitioner experience (handling time for specific court types)
- Published case studies

### Pre-Arbitration Stages

These are defined in `default_timeline.pre_arb_stages` and represent the stages *before* the arbitral award is issued. Examples: filing, tribunal constitution, proceedings, award drafting.

---

## Step 4: Estimate Legal Costs per Stage

Legal costs have two components:

### One-Time Costs (Month 0)

| Cost | Field | Description |
|------|-------|-------------|
| Tribunal fees | `one_time_tribunal_cr` | Filing, admin, arbitrator fees |
| Expert costs | `one_time_expert_cr` | Expert witnesses, technical advisors |

### Per-Stage Costs

Each stage in `per_stage_costs` (and challenge tree levels) has:
- `legal_cost.low` — minimum counsel fees + expenses for this stage
- `legal_cost.high` — maximum counsel fees + expenses for this stage

### Cost Overrun Multiplier

A ScaledBeta distribution models cost overruns:

```
overrun_multiplier = 1 + ScaledBeta(α, β, low, high)
```

Default parameters (which model a right-skewed +10% mean overrun):
- `overrun_alpha: 2.0` (shape)
- `overrun_beta: 5.0` (shape)
- `overrun_low: -0.10` (10% underrun possible)
- `overrun_high: 0.60` (60% overrun possible)

---

## Step 5: Create the JSON Template

Create a new file: `engine/jurisdictions/templates/<jurisdiction_id>.json`

The filename (without `.json`) becomes the jurisdiction `id`. Use lowercase with underscores.

```json
{
  "id": "<jurisdiction_id>",
  "name": "<Display Name>",
  "description": "<Brief description of the jurisdiction and challenge path>",
  "country": "<ISO 3166-1 alpha-2 code>",
  "institution": "<Arbitral institution name>",
  "default_challenge_tree": {
    "scenario_a": {
      "root": { ... },
      "description": "Scenario A: claimant won arbitration"
    },
    "scenario_b": {
      "root": { ... },
      "description": "Scenario B: claimant lost arbitration"
    }
  },
  "default_timeline": {
    "pre_arb_stages": [ ... ],
    "payment_delay_months": 6.0,
    "max_horizon_months": 96
  },
  "default_legal_costs": {
    "one_time_tribunal_cr": 6.0,
    "one_time_expert_cr": 2.0,
    "per_stage_costs": {},
    "overrun_alpha": 2.0,
    "overrun_beta": 5.0,
    "overrun_low": -0.10,
    "overrun_high": 0.60
  },
  "default_payment_delay_months": 6.0,
  "supports_restart": true,
  "enforcement_notes": "<Notes on enforcement in this jurisdiction>"
}
```

---

## Step 6: Validate Using the Registry

Run the following Python script to validate your template:

```python
import sys
sys.path.insert(0, '.')

from engine.jurisdictions.registry import REGISTRY

# List all discovered jurisdictions
for jid, name, desc in REGISTRY.list_jurisdictions():
    print(f"  {jid}: {name}")

# Load your new template
template = REGISTRY.get_template("your_jurisdiction_id")
print(f"\nLoaded: {template.name}")
print(f"Country: {template.country}")
print(f"Institution: {template.institution}")
print(f"Supports restart: {template.supports_restart}")

# Validate trees
from engine.models.probability_tree import validate_tree, compute_tree_probabilities
errors = validate_tree(template.default_challenge_tree)
if errors:
    print(f"ERRORS: {errors}")
else:
    print("Tree validation: PASSED")

# Check probabilities
probs_a = compute_tree_probabilities(template.default_challenge_tree.scenario_a)
probs_b = compute_tree_probabilities(template.default_challenge_tree.scenario_b)
print(f"\nScenario A: {probs_a}")
print(f"Scenario B: {probs_b}")
```

### Expected Output

- No validation errors
- Scenario A probabilities sum to 1.0 (TRUE_WIN + LOSE)
- Scenario B probabilities sum to 1.0 (RESTART + LOSE)
- Probabilities are reasonable for the jurisdiction

---

## Step 7: Test with a Sample Claim

Run a single-claim simulation with your new jurisdiction:

```bash
cd claim-analytics-platform

python -c "
from engine.config.schema import ClaimConfig, SimulationConfig
from engine.config.defaults import get_default_claim_config
from engine.jurisdictions.registry import REGISTRY
from engine.simulation.monte_carlo import run_claim_simulation, compute_claim_summary

# Load defaults for your jurisdiction
claim = get_default_claim_config('your_jurisdiction_id')
template = REGISTRY.get_template('your_jurisdiction_id')
sim = SimulationConfig(n_paths=1000, seed=42)

# Run simulation
paths = run_claim_simulation(claim, template, sim)
summary = compute_claim_summary(paths)

print(f'Win rate: {summary[\"win_rate\"]:.3f}')
print(f'Mean quantum: {summary[\"mean_quantum_cr\"]:.1f} Cr')
print(f'Mean duration: {summary[\"mean_duration_months\"]:.1f} months')
print(f'Mean legal costs: {summary[\"mean_legal_costs_cr\"]:.1f} Cr')
"
```

### Verify

- Win rate aligns with your analytical probability calculation
- Durations are reasonable (not exceeding max_horizon_months)
- Legal costs match your cost estimates
- No errors or warnings

---

## Worked Example: ICC Paris (French Seat)

### Background

The International Chamber of Commerce (ICC) is the world's largest arbitral institution. When seated in Paris, post-award challenges follow French law:

1. **Cour d'appel de Paris** — annulment action (recours en annulation) under Article 1520 of the French Code of Civil Procedure
2. **Cour de cassation** — appeal of the Cour d'appel decision (limited to errors of law)

### Step 1: Legal Process Research

| Stage | Description |
|-------|-------------|
| Cour d'appel (Annulment) | Primary challenge mechanism. Grounds: excess of jurisdiction, tribunal irregularity, due process violation, public policy |
| Cour de cassation | Appeal of Cour d'appel decision. Very limited; only procedural errors by the Cour d'appel itself |
| No remand to arbitration | Under French law, annulment of an award does NOT automatically restart the dispute — the party must commence fresh ICC proceedings |

### Step 2: Probability Tree

**Scenario A** (claimant won, respondent challenges):

```
root (1.0)
├── No Challenge (0.60) → TRUE_WIN
│   [Most winners are not challenged; ICC awards have strong finality]
└── Cour d'appel Annulment (0.40)
    ├── Annulment Rejected (0.75)
    │   ├── No Further Appeal (0.80) → TRUE_WIN
    │   └── Cour de cassation (0.20)
    │       ├── Cassation Rejected (0.85) → TRUE_WIN
    │       └── Cassation Granted (0.15) → LOSE
    └── Award Annulled (0.25) → LOSE
```

P(TRUE_WIN) = 0.60 + 0.40 × 0.75 × 0.80 + 0.40 × 0.75 × 0.20 × 0.85 = 0.60 + 0.24 + 0.051 = **0.891**
P(LOSE) = 0.40 × 0.25 + 0.40 × 0.75 × 0.20 × 0.15 = 0.10 + 0.009 = **0.109**
Sum = 1.000 ✓

**Scenario B** (claimant lost, claimant challenges):

```
root (1.0)
├── No Challenge (0.50) → LOSE
│   [Challenging an adverse ICC award is expensive; ~50% accept the loss]
└── Cour d'appel Annulment (0.50)
    ├── Annulment Granted → RESTART (0.35)
    │   [If claimant succeeds in annulment, may commence fresh arbitration]
    └── Annulment Rejected → LOSE (0.65)
```

P(RESTART) = 0.50 × 0.35 = **0.175**
P(LOSE) = 0.50 + 0.50 × 0.65 = 0.50 + 0.325 = **0.825**
Sum = 1.000 ✓

### Step 3: Durations

| Stage | Duration (months) | Notes |
|-------|-------------------|-------|
| ICC filing & constitution | 1–2 | ICC Secretariat acknowledges within 5 days; tribunal constituted in 2–4 months |
| Tribunal constitution | 2–4 | ICC Court confirms arbitrators |
| Proceedings | 12–24 | Written phase + hearing + post-hearing briefs |
| Award drafting | 3–6 | Tribunal deliberation + ICC scrutiny |
| Cour d'appel | 12–18 | Annulment proceedings typically 12–18 months in Paris |
| Cour de cassation | 12–24 | If pursued, typically 12–24 months |
| Payment delay | 6 | Post-final-judgment to cash receipt |

### Step 4: Legal Costs

| Stage | Cost Range (₹ Cr) | Notes |
|-------|-------------------|-------|
| ICC filing fees | 8.0 (one-time tribunal) | ICC admin fee + arbitrator advance |
| Expert costs | 3.0 (one-time expert) | Quantum experts, technical advisors |
| Cour d'appel | 4.0–8.0 | French counsel + translation + filing |
| Cour de cassation | 3.0–6.0 | Specialist cassation counsel required |

### Step 5: Complete JSON Template

```json
{
  "id": "icc_paris",
  "name": "ICC Paris (French Seat)",
  "description": "ICC institutional arbitration seated in Paris. Post-award challenges via Cour d'appel de Paris (annulment under Art. 1520 CPC) and potentially Cour de cassation. France is a model jurisdiction for international arbitration with strong pro-arbitration courts.",
  "country": "FR",
  "institution": "International Chamber of Commerce (ICC)",
  "default_challenge_tree": {
    "scenario_a": {
      "root": {
        "name": "root",
        "probability": 1.0,
        "children": [
          {
            "name": "No Challenge",
            "probability": 0.60,
            "children": [],
            "outcome": "TRUE_WIN",
            "duration_distribution": {"type": "fixed", "value": 0},
            "legal_cost": {"low": 0, "high": 0}
          },
          {
            "name": "Cour d'appel (Annulment)",
            "probability": 0.40,
            "children": [
              {
                "name": "Annulment Rejected",
                "probability": 0.75,
                "children": [
                  {
                    "name": "No Further Appeal",
                    "probability": 0.80,
                    "children": [],
                    "outcome": "TRUE_WIN",
                    "duration_distribution": {"type": "fixed", "value": 0},
                    "legal_cost": {"low": 0, "high": 0}
                  },
                  {
                    "name": "Cour de cassation",
                    "probability": 0.20,
                    "children": [
                      {
                        "name": "Cassation Rejected",
                        "probability": 0.85,
                        "children": [],
                        "outcome": "TRUE_WIN",
                        "duration_distribution": {"type": "fixed", "value": 0},
                        "legal_cost": {"low": 0, "high": 0}
                      },
                      {
                        "name": "Cassation Granted",
                        "probability": 0.15,
                        "children": [],
                        "outcome": "LOSE",
                        "duration_distribution": {"type": "fixed", "value": 0},
                        "legal_cost": {"low": 0, "high": 0}
                      }
                    ],
                    "duration_distribution": {"type": "uniform", "low": 12, "high": 24},
                    "legal_cost": {"low": 3.0, "high": 6.0}
                  }
                ],
                "duration_distribution": {"type": "uniform", "low": 12, "high": 18},
                "legal_cost": {"low": 4.0, "high": 8.0}
              },
              {
                "name": "Award Annulled",
                "probability": 0.25,
                "children": [],
                "outcome": "LOSE",
                "duration_distribution": {"type": "uniform", "low": 12, "high": 18},
                "legal_cost": {"low": 4.0, "high": 8.0}
              }
            ]
          }
        ]
      },
      "description": "Scenario A: Claimant won ICC award; respondent seeks annulment before Cour d'appel de Paris under Art. 1520 CPC"
    },
    "scenario_b": {
      "root": {
        "name": "root",
        "probability": 1.0,
        "children": [
          {
            "name": "No Challenge",
            "probability": 0.50,
            "children": [],
            "outcome": "LOSE",
            "duration_distribution": {"type": "fixed", "value": 0},
            "legal_cost": {"low": 0, "high": 0}
          },
          {
            "name": "Cour d'appel (Annulment)",
            "probability": 0.50,
            "children": [
              {
                "name": "Annulment Granted (Restart)",
                "probability": 0.35,
                "children": [],
                "outcome": "RESTART",
                "duration_distribution": {"type": "uniform", "low": 12, "high": 18},
                "legal_cost": {"low": 4.0, "high": 8.0}
              },
              {
                "name": "Annulment Rejected (Lose)",
                "probability": 0.65,
                "children": [],
                "outcome": "LOSE",
                "duration_distribution": {"type": "uniform", "low": 12, "high": 18},
                "legal_cost": {"low": 4.0, "high": 8.0}
              }
            ]
          }
        ]
      },
      "description": "Scenario B: Claimant lost ICC award; claimant seeks annulment before Cour d'appel de Paris"
    }
  },
  "default_timeline": {
    "pre_arb_stages": [
      {
        "name": "icc_filing",
        "duration_low": 1,
        "duration_high": 2,
        "legal_cost_low": 2.0,
        "legal_cost_high": 4.0
      },
      {
        "name": "tribunal_constitution",
        "duration_low": 2,
        "duration_high": 4,
        "legal_cost_low": 1.0,
        "legal_cost_high": 2.0
      },
      {
        "name": "proceedings",
        "duration_low": 12,
        "duration_high": 24,
        "legal_cost_low": 8.0,
        "legal_cost_high": 15.0
      },
      {
        "name": "award_drafting",
        "duration_low": 3,
        "duration_high": 6,
        "legal_cost_low": 1.0,
        "legal_cost_high": 3.0
      }
    ],
    "payment_delay_months": 6.0,
    "max_horizon_months": 96
  },
  "default_legal_costs": {
    "one_time_tribunal_cr": 8.0,
    "one_time_expert_cr": 3.0,
    "per_stage_costs": {},
    "overrun_alpha": 2.0,
    "overrun_beta": 5.0,
    "overrun_low": -0.10,
    "overrun_high": 0.50
  },
  "default_payment_delay_months": 6.0,
  "supports_restart": true,
  "enforcement_notes": "France is a signatory to the New York Convention (1959). Awards are generally enforceable worldwide. However, annulment of the award at the seat (Paris) precludes enforcement of that specific award within France. Exequatur is required for domestic enforcement under Art. 1516 CPC. Cross-border enforcement of annulled awards is possible in some jurisdictions (Hilmarton doctrine) but uncertain."
}
```

### Step 6: Validation

Save the file to `engine/jurisdictions/templates/icc_paris.json` and run the validation script from Step 6 above. Expected output:

```
  indian_domestic: Indian Domestic Arbitration
  siac_singapore: SIAC Singapore
  icc_paris: ICC Paris (French Seat)

Loaded: ICC Paris (French Seat)
Country: FR
Institution: International Chamber of Commerce (ICC)
Supports restart: True
Tree validation: PASSED

Scenario A: {'TRUE_WIN': 0.891, 'LOSE': 0.109}
Scenario B: {'RESTART': 0.175, 'LOSE': 0.825}
```

### Step 7: Test Simulation

Run a sample claim and verify:
- Win rate ≈ 70% × 0.891 + 30% × 0.175 × 70% ≈ 0.624 + 0.037 = **~66%** (approximate, depends on re-arb)
- Costs reflect ICC fee structure
- Durations fit within 96-month horizon

---

## Available Jurisdictions

<!-- AUTO-GENERATED: JURISDICTIONS -->
⚠️ engine/jurisdictions/templates/ not found

<!-- /AUTO-GENERATED: JURISDICTIONS -->
