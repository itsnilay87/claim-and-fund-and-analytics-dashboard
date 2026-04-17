# Claim Analytics Platform — API Contracts

**Version:** 1.0
**Date:** 20 March 2026

Complete request/response specifications for every server endpoint and data contract.

---

## Table of Contents

1. [Server Endpoints](#1-server-endpoints)
   - [Health Check](#11-get-apihealth)
   - [Simulate Claim](#12-post-apisimulateclaim)
   - [Simulate Portfolio](#13-post-apisimulateportfolio)
   - [Status Polling](#14-get-apistatusrunid)
   - [List Result Files](#15-get-apiresultsrunidfiles)
   - [Serve Result File](#16-get-apiresultsrunid)
   - [List Jurisdictions](#17-get-apijurisdictions)
   - [Get Jurisdiction Template](#18-get-apijurisdictionsid)
   - [Get Jurisdiction Defaults](#19-get-apijurisdictionsiddefaults)
   - [List Claims](#110-get-apiclaims)
   - [Store Claim](#111-post-apiclaims)
   - [Get Defaults](#112-get-apidefaults)
2. [dashboard_data.json Contract](#2-dashboard_datajson-contract)
3. [Jurisdiction Template JSON Format](#3-jurisdiction-template-json-format)
4. [Error Response Format](#4-error-response-format)

---

## 1. Server Endpoints

Base URL: `http://localhost:3001` (development)

### 1.1 GET /api/health

Health check endpoint.

**Request:** No body, no query params.

**Response (200):**
```json
{
  "status": "ok",
  "timestamp": "2026-03-20T10:30:00.000Z"
}
```

---

### 1.2 POST /api/simulate/claim

Launch a single-claim Monte Carlo simulation.

**Request Body:**
```json
{
  "claim_config": {
    "id": "CLAIM-001",
    "name": "TP-301-6 Prolongation",
    "jurisdiction": "indian_domestic",
    "soc_value_cr": 1000.0,
    "currency": "INR",
    "claim_type": "prolongation",
    "claimant": "TATA Projects",
    "respondent": "DFCCIL",
    "claimant_share_pct": 1.0,
    "current_stage": "",
    "perspective": "claimant",
    "no_restart_mode": false,
    "arbitration": {
      "win_probability": 0.70,
      "re_arb_win_probability": 0.70
    },
    "quantum": {
      "bands": [
        {"low": 0.0,  "high": 0.2, "probability": 0.15},
        {"low": 0.2,  "high": 0.4, "probability": 0.05},
        {"low": 0.4,  "high": 0.6, "probability": 0.05},
        {"low": 0.6,  "high": 0.8, "probability": 0.05},
        {"low": 0.8,  "high": 1.0, "probability": 0.70}
      ]
    },
    "challenge_tree": {
      "scenario_a": {
        "root": { "name": "root", "probability": 1.0, "children": [...] },
        "description": "Claimant won arbitration"
      },
      "scenario_b": {
        "root": { "name": "root", "probability": 1.0, "children": [...] },
        "description": "Claimant lost arbitration"
      }
    },
    "timeline": {
      "pre_arb_stages": [
        {"name": "dab", "duration_low": 3, "duration_high": 6, "legal_cost_low": 1.0, "legal_cost_high": 2.0}
      ],
      "payment_delay_months": 6.0,
      "max_horizon_months": 96
    },
    "legal_costs": {
      "one_time_tribunal_cr": 6.0,
      "one_time_expert_cr": 2.0,
      "per_stage_costs": {},
      "overrun_alpha": 2.0,
      "overrun_beta": 5.0,
      "overrun_low": -0.10,
      "overrun_high": 0.60
    },
    "interest": {
      "enabled": false,
      "rate": 0.09,
      "compounding": "simple"
    }
  },
  "simulation": {
    "n_paths": 10000,
    "seed": 42,
    "discount_rate": 0.12,
    "risk_free_rate": 0.07,
    "start_date": "2026-04-30"
  }
}
```

**Response (200):**
```json
{
  "runId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "status": "queued"
}
```

**Error Responses:**

| Status | Body | Condition |
|--------|------|-----------|
| 400 | `{"error": "Missing claim_config"}` | No claim_config in body |
| 400 | `{"error": "Validation failed: ..."}` | Config validation failure |
| 500 | `{"error": "Failed to start run"}` | Server error spawning subprocess |

---

### 1.3 POST /api/simulate/portfolio

Launch a portfolio-level Monte Carlo simulation.

**Request Body:**
```json
{
  "portfolio_config": {
    "id": "PORT-001",
    "name": "TATA 6-Claim Portfolio",
    "claim_ids": ["CLAIM-001", "CLAIM-002", "CLAIM-003"],
    "structure": {
      "type": "monetisation_upfront_tail",
      "params": {
        "upfront_range": {"min": 0.05, "max": 0.50, "step": 0.05},
        "tail_range": {"min": 0.0, "max": 0.50, "step": 0.05},
        "pricing_basis": "soc"
      }
    },
    "simulation": {
      "n_paths": 10000,
      "seed": 42,
      "discount_rate": 0.12,
      "risk_free_rate": 0.07,
      "start_date": "2026-04-30"
    }
  },
  "claims": [
    { "id": "CLAIM-001", "name": "...", "jurisdiction": "indian_domestic", ... },
    { "id": "CLAIM-002", "name": "...", "jurisdiction": "siac_singapore", ... }
  ]
}
```

**Response (200):**
```json
{
  "runId": "f1e2d3c4-b5a6-7890-abcd-ef1234567890",
  "status": "queued"
}
```

**Error Responses:** Same as `/api/simulate/claim`.

---

### 1.4 GET /api/status/:runId

Poll the status of a running simulation.

**Path Params:** `runId` — UUID returned by simulate endpoint.

**Response (200) — Running:**
```json
{
  "status": "running",
  "progress": 60,
  "stage": "Monte Carlo simulation",
  "startedAt": "2026-03-20T10:30:00.000Z",
  "completedAt": null,
  "error": null
}
```

**Response (200) — Completed:**
```json
{
  "status": "completed",
  "progress": 100,
  "stage": "done",
  "startedAt": "2026-03-20T10:30:00.000Z",
  "completedAt": "2026-03-20T10:31:45.000Z",
  "error": null
}
```

**Response (200) — Failed:**
```json
{
  "status": "failed",
  "progress": 60,
  "stage": "Monte Carlo simulation",
  "startedAt": "2026-03-20T10:30:00.000Z",
  "completedAt": "2026-03-20T10:30:30.000Z",
  "error": "Python process exited with code 1: ValueError: band probabilities sum to 0.950000"
}
```

**Status Values:** `queued` → `running` → `completed` | `failed`

**Progress Milestones:**

| Progress | Stage |
|----------|-------|
| 0 | Queued |
| 10 | Config loaded |
| 30 | Templates loaded |
| 60 | MC simulation complete |
| 70 | Computing grids |
| 80 | Risk metrics |
| 90 | JSON export |
| 100 | Done |

| Status | Body | Condition |
|--------|------|-----------|
| 404 | `{"error": "Run not found"}` | Invalid or expired runId |

---

### 1.5 GET /api/results/:runId/files

List all output files for a completed run.

**Response (200):**
```json
{
  "files": [
    {"name": "dashboard_data.json", "path": "outputs/dashboard_data.json", "type": "data", "size": 245760},
    {"name": "stochastic_pricing.json", "path": "outputs/stochastic_pricing.json", "type": "data", "size": 51200},
    {"name": "results.xlsx", "path": "outputs/results.xlsx", "type": "excel", "size": 102400},
    {"name": "moic_histogram.png", "path": "outputs/charts/moic_histogram.png", "type": "chart", "size": 32768},
    {"name": "log.txt", "path": "log.txt", "type": "log", "size": 4096}
  ]
}
```

**File Type Categories:** `data` (JSON), `excel`, `pdf`, `chart` (PNG/SVG), `log`

---

### 1.6 GET /api/results/:runId/*

Serve an individual output file.

**Examples:**
- `GET /api/results/abc123/outputs/dashboard_data.json` → JSON (Content-Type: application/json)
- `GET /api/results/abc123/outputs/results.xlsx` → Excel (Content-Type: application/vnd.openxmlformats...)
- `GET /api/results/abc123/outputs/charts/moic_histogram.png` → PNG (Content-Type: image/png)

**Security:** Path traversal prevention — `..` segments are stripped and paths are resolved relative to the run directory.

| Status | Body | Condition |
|--------|------|-----------|
| 404 | `{"error": "File not found"}` | File does not exist |
| 404 | `{"error": "Run not found"}` | Invalid runId |

---

### 1.7 GET /api/jurisdictions

List all available jurisdiction templates.

**Response (200):**
```json
[
  {
    "id": "indian_domestic",
    "name": "Indian Domestic Arbitration",
    "description": "Ad-hoc arbitration under Indian Arbitration Act with S.34/S.37/SLP challenge path",
    "country": "IN"
  },
  {
    "id": "siac_singapore",
    "name": "SIAC Singapore",
    "description": "SIAC institutional arbitration with HC/COA setting aside under Singapore IAA",
    "country": "SG"
  }
]
```

---

### 1.8 GET /api/jurisdictions/:id

Get the full jurisdiction template.

**Path Params:** `id` — jurisdiction key (e.g. `indian_domestic`).

**Response (200):**
```json
{
  "id": "indian_domestic",
  "name": "Indian Domestic Arbitration",
  "description": "...",
  "country": "IN",
  "institution": "Ad-hoc (Indian Arbitration Act)",
  "default_challenge_tree": {
    "scenario_a": { "root": {...}, "description": "..." },
    "scenario_b": { "root": {...}, "description": "..." }
  },
  "default_timeline": {
    "pre_arb_stages": [...],
    "payment_delay_months": 6.0,
    "max_horizon_months": 96
  },
  "default_legal_costs": {
    "one_time_tribunal_cr": 6.0,
    "one_time_expert_cr": 2.0,
    "per_stage_costs": {...},
    "overrun_alpha": 2.0,
    "overrun_beta": 5.0,
    "overrun_low": -0.10,
    "overrun_high": 0.60
  },
  "default_payment_delay_months": 6.0,
  "supports_restart": true,
  "enforcement_notes": "..."
}
```

| Status | Body | Condition |
|--------|------|-----------|
| 404 | `{"error": "Jurisdiction not found: xyz"}` | Unknown jurisdiction ID |

---

### 1.9 GET /api/jurisdictions/:id/defaults

Get default `ClaimConfig` for the specified jurisdiction (pre-populated with jurisdiction-specific challenge trees, timelines, and costs).

**Response (200):** Full `ClaimConfig` JSON (same shape as simulate request body `claim_config`, with jurisdiction-appropriate defaults).

---

### 1.10 GET /api/claims

List stored claims on the server.

**Response (200):**
```json
[
  {"id": "CLAIM-001", "name": "TP-301-6", "jurisdiction": "indian_domestic", "soc_value_cr": 1000.0},
  {"id": "CLAIM-002", "name": "TP-302-3", "jurisdiction": "siac_singapore", "soc_value_cr": 750.0}
]
```

---

### 1.11 POST /api/claims

Store a claim configuration to disk.

**Request Body:** Full `ClaimConfig` JSON.

**Response (201):**
```json
{
  "id": "CLAIM-001",
  "status": "saved"
}
```

**Security:** Claim ID is sanitised to allow only alphanumeric, dash, and underscore characters.

| Status | Body | Condition |
|--------|------|-----------|
| 400 | `{"error": "Invalid claim ID"}` | ID contains disallowed characters |

---

### 1.12 GET /api/defaults

Return the server's default configuration values.

**Response (200):** Contents of `server/config/defaults.json` including simulation params, quantum bands, timeline stages, legal cost structures, claim defaults.

---

## 2. dashboard_data.json Contract

This is the primary data contract between the Python engine and the React dashboard.

### 2.1 Top-Level Interface

```typescript
interface DashboardData {
  // ── Metadata ──
  structure_type: "litigation_funding" | "monetisation_full_purchase" |
                  "monetisation_upfront_tail" | "monetisation_staged" | "comparative";
  simulation_meta: SimulationMeta;

  // ── Always present ──
  claims: ClaimSummary[];
  probability_summary: ProbabilitySummary;
  quantum_summary: QuantumSummary;
  timeline_summary: TimelineSummary;
  legal_cost_summary: LegalCostSummary;
  cashflow_analysis: CashflowAnalysis;
  waterfall: WaterfallData;
  sensitivity: SensitivityData;
  risk: RiskMetrics;

  // ── Structure-specific (present only for applicable types) ──
  investment_grid?: Record<string, GridCell>;     // upfront_tail, full_purchase, comparative
  waterfall_grid?: Record<string, GridCell>;       // litigation_funding, comparative
  breakeven_data?: BreakevenCurve[];               // upfront_tail
  jcurve_data?: JCurveDataPoint[];                 // upfront_tail
}
```

### 2.2 SimulationMeta

```typescript
interface SimulationMeta {
  n_paths: number;            // e.g. 10000
  seed: number;               // e.g. 42
  discount_rate: number;      // e.g. 0.12
  risk_free_rate: number;     // e.g. 0.07
  start_date: string;         // ISO 8601, e.g. "2026-04-30"
  n_claims: number;           // number of claims in portfolio
  total_soc_cr: number;       // sum of all claims' soc_value_cr
  structure_type: string;     // redundant with top-level
}
```

### 2.3 ClaimSummary

```typescript
interface ClaimSummary {
  id: string;
  name: string;
  jurisdiction: string;
  soc_value_cr: number;
  claim_type: string;

  // MC statistics
  win_rate: number;           // fraction of paths with TRUE_WIN
  effective_win_rate: number; // win_rate adjusted for RESTART paths
  mean_quantum_cr: number;
  mean_quantum_pct: number;
  mean_duration_months: number;
  mean_legal_costs_cr: number;
  mean_collected_cr: number;

  // Outcome distribution
  outcome_distribution: {
    TRUE_WIN: number;         // count
    RESTART: number;
    LOSE: number;
  };

  // Percentiles
  quantum_percentiles: Percentiles;
  duration_percentiles: Percentiles;
  legal_cost_percentiles: Percentiles;
}

interface Percentiles {
  p1: number; p5: number; p10: number; p25: number; p50: number;
  p75: number; p90: number; p95: number; p99: number;
}
```

### 2.4 ProbabilitySummary

```typescript
interface ProbabilitySummary {
  claims: Record<string, {
    analytical: {
      scenario_a: { TRUE_WIN: number; LOSE: number; };
      scenario_b: { RESTART: number; LOSE: number; };
    };
    unconditional: {
      TRUE_WIN: number;
      RESTART: number;
      LOSE: number;
    };
    simulated: {
      TRUE_WIN: number;
      RESTART: number;
      LOSE: number;
    };
  }>;
}
```

### 2.5 QuantumSummary

```typescript
interface QuantumSummary {
  claims: Record<string, {
    soc_value_cr: number;
    expected_quantum_pct: number;
    expected_quantum_cr: number;
    bands: Array<{low: number; high: number; probability: number}>;
  }>;
}
```

### 2.6 Investment Grid (Upfront + Tail)

```typescript
// Keys are "upfront_tail" format, e.g. "10_30" = 10% upfront, 30% tail
interface GridCell {
  mean_moic: number;
  median_moic: number;
  mean_xirr: number;
  expected_xirr: number;      // primary E[IRR]: XIRR of expected cashflow stream
  p_loss: number;             // probability MOIC < 1.0
  p_hurdle: number;           // probability XIRR > discount_rate
  var_1: number;              // 1% VaR (MOIC)
  cvar_1: number;             // 1% CVaR (MOIC)
  per_claim: Record<string, {
    mean_moic: number;
    win_rate: number;
    mean_duration: number;
    mean_invested_cr: number;
    mean_return_cr: number;
  }>;
}
```

### 2.7 Waterfall Grid (Litigation Funding)

```typescript
// Keys are "cm_ar" format, e.g. "30_25" = 3.0× cost multiple, 25% award ratio
// Same GridCell structure as investment_grid
```

### 2.8 CashflowAnalysis

```typescript
interface CashflowAnalysis {
  per_claim: Record<string, {
    mean_invested_cr: number;
    mean_return_cr: number;
    mean_net_cr: number;
    mean_moic: number;
    breakdown: { legal_costs_cr: number; quantum_cr: number; interest_cr: number; };
  }>;
  portfolio: {
    total_invested_cr: number;
    total_return_cr: number;
    total_net_cr: number;
    annual_cashflow: Array<{year: number; invested: number; returned: number; net: number}>;
  };
  distribution: {
    moic_histogram: Array<{bin_start: number; bin_end: number; count: number}>;
    xirr_histogram: Array<{bin_start: number; bin_end: number; count: number}>;
  };
}
```

### 2.9 RiskMetrics

```typescript
interface RiskMetrics {
  moic_distribution: Percentiles;
  xirr_distribution: Percentiles;
  duration_stats: { mean: number; p50: number; p95: number; max: number; };
  capital_at_risk: Array<{month: number; p50_deployed: number; p95_deployed: number}>;
  concentration: {
    herfindahl_jurisdiction: number;
    herfindahl_claim_type: number;
    top_3_concentration: number;
  };
  stress_scenarios: {
    total_loss: { probability: number; cost_cr: number; };
    p25_downside: { moic: number; xirr: number; };
    p50_base: { moic: number; xirr: number; };
    extended_timeline: { p95_months: number; moic_impact: number; };
  };
}
```

### 2.10 JCurveData

```typescript
interface JCurveDataPoint {
  month: number;
  deal_label: string;          // e.g. "UP10_T30"
  p5: number;                  // 5th percentile cumulative CF
  p25: number;
  p50: number;
  p75: number;
  p95: number;
}
```

### 2.11 SensitivityData

```typescript
interface SensitivityData {
  arb_win_sensitivity: Array<{
    arb_win_prob: number;      // 0.0 to 1.0
    e_moic: number;
    e_irr: number;
    p_loss: number;
  }>;
}
```

### 2.12 Structure-Specific Field Presence

| Field | lit_funding | full_purchase | upfront_tail | staged | comparative |
|-------|:-:|:-:|:-:|:-:|:-:|
| `investment_grid` | | ✓ | ✓ | | ✓ |
| `waterfall_grid` | ✓ | | | | ✓ |
| `breakeven_data` | | | ✓ | | ✓ |
| `jcurve_data` | | | ✓ | | ✓ |
| `claims` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `probability_summary` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `quantum_summary` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `cashflow_analysis` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `risk` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `sensitivity` | ✓ | ✓ | ✓ | ✓ | ✓ |

### 2.13 Portfolio Fix Contract Notes (2026-04-16)

The following fields are now required by the dashboard integration contract for portfolio runs:

- `risk.concentration.jurisdiction_breakdown` is always present as an object
- `risk.concentration.type_breakdown` is always present as an object
- per-claim sections include `name` for human-readable display (no UUID-only fallback)
- every `investment_grid` cell includes `expected_xirr` in addition to `mean_xirr`
- `jcurve_data.default_key` reflects the user-selected upfront/tail combination
- `mc_distributions` reflects user-selected upfront/tail parameters and no longer uses hardcoded `10/20`

---

## 3. Jurisdiction Template JSON Format

### 3.1 Complete Schema

```typescript
interface JurisdictionTemplate {
  id: string;                              // Unique key, e.g. "indian_domestic"
  name: string;                            // Display name
  description: string;                     // Brief description
  country: string;                         // ISO 3166-1 alpha-2
  institution: string;                     // Arbitral institution
  default_challenge_tree: ChallengeTree;
  default_timeline: Timeline;
  default_legal_costs: LegalCosts;
  default_payment_delay_months: number;
  supports_restart: boolean;
  enforcement_notes: string;
}

interface ChallengeTree {
  scenario_a: Scenario;                    // Claimant won — respondent challenges
  scenario_b: Scenario;                    // Claimant lost — claimant challenges
}

interface Scenario {
  root: TreeNode;
  description: string;
}

interface TreeNode {
  name: string;                            // Stage name, e.g. "S.34"
  probability: number;                     // Conditional probability (0–1)
  children: TreeNode[];                    // Empty for leaves
  outcome?: "TRUE_WIN" | "RESTART" | "LOSE";  // Required on leaves, null on interior
  duration_distribution?: {
    type: "uniform" | "fixed";
    low?: number;                          // months (for uniform)
    high?: number;                         // months (for uniform)
    value?: number;                        // months (for fixed)
  };
  legal_cost?: {
    low: number;                           // ₹ Cr
    high: number;                          // ₹ Cr
  };
}
```

### 3.2 Example: Adding a New Jurisdiction (ICC Paris)

```json
{
  "id": "icc_paris",
  "name": "ICC Paris (French Seat)",
  "description": "ICC institutional arbitration seated in Paris with Cour d'appel annulment and Cour de cassation appeal",
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
                    "outcome": "TRUE_WIN"
                  },
                  {
                    "name": "Cour de cassation",
                    "probability": 0.20,
                    "children": [
                      {
                        "name": "Cassation Rejected",
                        "probability": 0.85,
                        "children": [],
                        "outcome": "TRUE_WIN"
                      },
                      {
                        "name": "Cassation Granted",
                        "probability": 0.15,
                        "children": [],
                        "outcome": "LOSE"
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
      "description": "Scenario A: Claimant won ICC award; respondent seeks annulment before Cour d'appel de Paris"
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
            "outcome": "LOSE"
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
      "description": "Scenario B: Claimant lost ICC award; claimant seeks annulment"
    }
  },
  "default_timeline": {
    "pre_arb_stages": [
      {"name": "icc_filing", "duration_low": 1, "duration_high": 2, "legal_cost_low": 2.0, "legal_cost_high": 4.0},
      {"name": "tribunal_constitution", "duration_low": 2, "duration_high": 4, "legal_cost_low": 1.0, "legal_cost_high": 2.0},
      {"name": "proceedings", "duration_low": 12, "duration_high": 24, "legal_cost_low": 8.0, "legal_cost_high": 15.0},
      {"name": "award", "duration_low": 3, "duration_high": 6, "legal_cost_low": 1.0, "legal_cost_high": 3.0}
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
  "enforcement_notes": "France is a signatory to the New York Convention. Awards are generally enforceable, but annulment at the seat precludes enforcement. Exequatur required for domestic enforcement."
}
```

---

## 4. Error Response Format

All error responses follow a consistent format:

```json
{
  "error": "Human-readable error message"
}
```

### 4.1 HTTP Status Code Usage

| Code | Meaning | Usage |
|------|---------|-------|
| 200 | OK | Successful GET or completed POST |
| 201 | Created | Successful resource creation (POST /api/claims) |
| 400 | Bad Request | Validation errors, missing fields, malformed JSON |
| 404 | Not Found | Unknown runId, jurisdiction, file |
| 500 | Internal Server Error | Unexpected server errors, subprocess failures |

### 4.2 Validation Error Details

Config validation errors include field context:

```json
{
  "error": "Validation failed: QuantumConfig: band probabilities sum to 0.950000, must equal 1.0 (±1e-4)."
}
```

---

<!-- AUTO-GENERATED: ROUTES -->

## Auto-Discovered Routes

**Scanned:** 2026-03-20 07:19

| Method | Path | Source | Description |
|--------|------|--------|-------------|
| `GET` | `/` | `claims.js` | / |
| `POST` | `/` | `claims.js` | / |
| `GET` | `/` | `jurisdictions.js` | / |
| `GET` | `/:id` | `jurisdictions.js` | / |
| `GET` | `/:id/defaults` | `jurisdictions.js` | / |
| `GET` | `/status/:runId` | `results.js` | / |
| `GET` | `/results/:runId/files` | `results.js` | / |
| `GET` | `/results/:runId/*` | `results.js` | / |
| `POST` | `/claim` | `simulate.js` | / |
| `POST` | `/portfolio` | `simulate.js` | / |
| `GET` | `/` | `templates.js` | / |
| `GET` | `/:id` | `templates.js` | / |
<!-- /AUTO-GENERATED: ROUTES -->
<!-- This section is updated by scripts/update_docs.py -->
