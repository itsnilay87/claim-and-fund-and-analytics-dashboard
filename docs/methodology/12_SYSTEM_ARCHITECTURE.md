# System Architecture Specification

> **Document**: 12_SYSTEM_ARCHITECTURE.md  
> **Version**: 2.0  
> **Scope**: Technical design, module structure, data flow, deployment

---

## 1. Architecture Overview

### System Components

```
┌─────────────────────────────────────────────────────────────────┐
│                         Frontend Layer                          │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐ │
│  │   Web App   │  │  Dashboard  │  │   Configuration UI      │ │
│  │  (React)    │  │  (React)    │  │   (Forms/Validation)    │ │
│  └─────────────┘  └─────────────┘  └─────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                          API Layer                              │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │              REST API (Node.js/Express)                     ││
│  │    /api/claims  /api/simulations  /api/portfolios          ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Simulation Engine                           │
│  ┌───────────┐  ┌───────────┐  ┌───────────┐  ┌───────────┐   │
│  │ MC Core   │  │ Prob Tree │  │  Quantum  │  │Settlement │   │
│  │           │  │           │  │  Model    │  │  Model    │   │
│  └───────────┘  └───────────┘  └───────────┘  └───────────┘   │
│  ┌───────────┐  ┌───────────┐  ┌───────────┐  ┌───────────┐   │
│  │ Timeline  │  │Legal Cost │  │ Interest  │  │ Cashflow  │   │
│  │  Model    │  │  Model    │  │  Model    │  │  Builder  │   │
│  └───────────┘  └───────────┘  └───────────┘  └───────────┘   │
│  ┌───────────┐  ┌───────────┐  ┌───────────────────────────┐   │
│  │  Metrics  │  │Risk Calc  │  │    Output Generation      │   │
│  │           │  │           │  │   (JSON/Excel/PDF)        │   │
│  └───────────┘  └───────────┘  └───────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                       Data Layer                                │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐ │
│  │  PostgreSQL │  │    Redis    │  │    File Storage         │ │
│  │  (Claims,   │  │  (Session,  │  │    (Outputs, Reports)   │ │
│  │   Config)   │  │   Cache)    │  │                         │ │
│  └─────────────┘  └─────────────┘  └─────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. Engine Module Structure

### Directory Layout

```
engine/
├── __init__.py
├── run_v2.py                    # Main entry point
│
├── v2_core/                     # Core simulation modules
│   ├── __init__.py
│   ├── v2_monte_carlo.py        # MC simulation orchestration
│   ├── v2_probability_tree.py   # Challenge tree traversal
│   ├── v2_quantum_model.py      # Award distribution
│   ├── v2_settlement.py         # Settlement logic
│   ├── v2_timeline_model.py     # Duration sampling
│   ├── v2_legal_cost_model.py   # Legal cost burn
│   ├── v2_interest_model.py     # Interest calculation
│   ├── v2_cashflow_builder.py   # Cash flow construction
│   ├── v2_metrics.py            # MOIC, IRR, risk metrics
│   └── v2_master_inputs.py      # Default parameters
│
├── config/                      # Configuration handling
│   ├── __init__.py
│   ├── schema.py                # Pydantic models
│   ├── loader.py                # JSON/YAML config loading
│   └── validator.py             # Input validation
│
├── outputs/                     # Output generation
│   ├── __init__.py
│   ├── json_exporter.py         # JSON output
│   ├── excel_writer.py          # Excel reports
│   ├── pdf_report.py            # PDF generation
│   └── chart_generator.py       # Visualization
│
├── adapter.py                   # Platform↔Engine bridge
│
└── tests/                       # Test suite
    ├── test_monte_carlo.py
    ├── test_probability_tree.py
    ├── test_quantum_model.py
    └── test_integration.py
```

### Module Dependency Graph

```
            run_v2.py
                │
                ▼
        v2_monte_carlo.py
       /     │      │     \
      ▼      ▼      ▼      ▼
  prob_   quantum  time   legal
  tree    model    line   cost
    │        │       │      │
    └───────┬───────┬──────┘
            │
            ▼
        cashflow
            │
            ▼
         metrics
```

---

## 3. Core Module Specifications

### 3.1 Monte Carlo Orchestrator

**File**: `v2_monte_carlo.py`

**Responsibilities**:
- Initialize RNG with seed
- Generate N path samples
- Coordinate sub-model calls
- Aggregate results

**Key Interface**:

```python
def run_simulation(
    config: ClaimConfig,
    n_paths: int = 10000,
    seed: int = 42,
) -> SimulationResult:
    """
    Run Monte Carlo simulation for single claim.
    
    Parameters
    ----------
    config : ClaimConfig
        Claim configuration with all parameters
    n_paths : int
        Number of simulation paths
    seed : int
        Base random seed
    
    Returns
    -------
    SimulationResult
        Complete simulation results with statistics
    """
```

### 3.2 Probability Tree

**File**: `v2_probability_tree.py`

**Responsibilities**:
- Define challenge stage sequences
- Compute path probabilities
- Handle conditional probabilities
- Support path enumeration

**Key Interface**:

```python
def enumerate_paths(
    jurisdiction: str,
    arb_won: Optional[bool] = None,
) -> List[PathOutcome]:
    """
    Enumerate all possible outcome paths for jurisdiction.
    
    Returns list of PathOutcome objects with stage sequences
    and path probabilities.
    """


def sample_outcome(
    jurisdiction: str,
    rng: Generator,
) -> PathOutcome:
    """
    Sample a single outcome path.
    
    Uses sequential sampling through challenge tree.
    """
```

### 3.3 Quantum Model

**File**: `v2_quantum_model.py`

**Responsibilities**:
- Sample quantum from band distribution
- Handle known quantum mode
- Apply SOC scaling

**Key Interface**:

```python
def sample_quantum(
    soc_cr: float,
    quantum_config: QuantumConfig,
    known_quantum_cr: Optional[float],
    rng: Generator,
) -> float:
    """
    Sample quantum (award amount) for winning path.
    
    Returns quantum in ₹ Cr.
    """
```

### 3.4 Settlement Model

**File**: `v2_settlement.py`

**Responsibilities**:
- Attempt settlement at each stage
- Compute discount factors
- Determine settlement amounts

**Key Interface**:

```python
def attempt_settlement(
    stage: str,
    elapsed_months: float,
    rng: Generator,
    settlement_config: SettlementConfig,
) -> Optional[SettlementResult]:
    """
    Attempt settlement at current stage.
    
    Returns SettlementResult if settled, None otherwise.
    """
```

---

## 4. Configuration Schema

### Pydantic Models

```python
from pydantic import BaseModel, Field
from typing import List, Optional, Literal

class QuantumBand(BaseModel):
    """Single quantum recovery band."""
    lower: float = Field(ge=0, le=1)
    upper: float = Field(ge=0, le=1)
    probability: float = Field(ge=0, le=1)

class QuantumConfig(BaseModel):
    """Quantum model configuration."""
    bands: List[QuantumBand]
    default_lower: float = 0.80
    default_upper: float = 1.00
    known_quantum_cr: Optional[float] = None
    known_uncertainty_pct: float = 0.10

class TimelineConfig(BaseModel):
    """Timeline model configuration."""
    max_months: int = 96
    stage_durations: Dict[str, DurationSpec]

class ClaimConfig(BaseModel):
    """Complete claim configuration."""
    claim_id: str
    jurisdiction: Literal["indian_domestic", "siac", "hkiac"]
    soc_cr: float = Field(gt=0)
    
    quantum: QuantumConfig
    timeline: TimelineConfig
    legal_costs: LegalCostConfig
    settlement: SettlementConfig
    investment: InvestmentConfig
    
    # Probabilities (override defaults)
    probability_overrides: Optional[Dict[str, float]] = None
```

### JSON Configuration Example

```json
{
  "claim_id": "CLAIM-001",
  "jurisdiction": "indian_domestic",
  "soc_cr": 100.0,
  
  "quantum": {
    "bands": [
      {"lower": 0.0, "upper": 0.2, "probability": 0.02},
      {"lower": 0.2, "upper": 0.4, "probability": 0.05},
      {"lower": 0.4, "upper": 0.6, "probability": 0.08},
      {"lower": 0.6, "upper": 0.8, "probability": 0.15},
      {"lower": 0.8, "upper": 1.0, "probability": 0.70}
    ]
  },
  
  "timeline": {
    "max_months": 96,
    "stage_durations": {
      "dab": {"distribution": "uniform", "min": 3, "max": 6},
      "arbitration": {"distribution": "uniform", "min": 18, "max": 36}
    }
  },
  
  "investment": {
    "type": "litigation_funding",
    "upfront_cr": 5.0,
    "target_multiple": 3.0,
    "cap_rate": 0.50
  }
}
```

---

## 5. Data Flow

### Simulation Flow

```
1. INPUT PARSING
   JSON Config → ClaimConfig (Pydantic validation)
                      │
                      ▼
2. INITIALIZATION
   Create RNG with seed
   Load default parameters
   Apply config overrides
                      │
                      ▼
3. PATH ENUMERATION (optional)
   Generate all possible paths
   Compute analytical probabilities
                      │
                      ▼
4. MONTE CARLO LOOP
   For path_idx in range(n_paths):
       │
       ├─→ Sample outcome path (prob_tree)
       │
       ├─→ If WIN: Sample quantum (quantum_model)
       │
       ├─→ Sample timeline (timeline_model)
       │
       ├─→ Attempt settlement (settlement_model)
       │
       ├─→ Compute legal costs (legal_cost_model)
       │
       ├─→ Compute interest (interest_model)
       │
       └─→ Build cash flows (cashflow_builder)
                      │
                      ▼
5. AGGREGATION
   Compute statistics across all paths
   Calculate risk metrics
                      │
                      ▼
6. OUTPUT GENERATION
   JSON results
   Excel report
   PDF document
```

---

## 6. API Specification

### REST Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /api/claims | Create new claim |
| GET | /api/claims/:id | Get claim details |
| PUT | /api/claims/:id | Update claim |
| DELETE | /api/claims/:id | Delete claim |
| POST | /api/simulations | Run simulation |
| GET | /api/simulations/:id | Get simulation results |
| GET | /api/portfolios | List portfolios |
| POST | /api/portfolios/:id/simulate | Run portfolio simulation |

### Request/Response Format

**Run Simulation**:

```http
POST /api/simulations
Content-Type: application/json

{
  "claim_id": "CLAIM-001",
  "n_paths": 10000,
  "seed": 42,
  "include_paths": false
}
```

**Response**:

```json
{
  "simulation_id": "SIM-20240115-001",
  "claim_id": "CLAIM-001",
  "status": "completed",
  "runtime_ms": 1250,
  "results": {
    "moic_mean": 2.15,
    "moic_median": 2.40,
    "moic_std": 1.05,
    "irr_mean": 0.45,
    "var_95": 0.60,
    "cvar_95": 0.25,
    "p_win": 0.70,
    "p_profit": 0.65,
    "percentiles": {
      "p5": 0.0,
      "p25": 1.50,
      "p50": 2.40,
      "p75": 3.10,
      "p95": 3.80
    }
  }
}
```

---

## 7. Database Schema

### PostgreSQL Tables

```sql
-- Claims table
CREATE TABLE claims (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    claim_id VARCHAR(50) UNIQUE NOT NULL,
    jurisdiction VARCHAR(20) NOT NULL,
    soc_cr DECIMAL(15,2) NOT NULL,
    config JSONB NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Simulations table
CREATE TABLE simulations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    claim_id UUID REFERENCES claims(id),
    n_paths INTEGER NOT NULL,
    seed INTEGER NOT NULL,
    status VARCHAR(20) NOT NULL,
    results JSONB,
    created_at TIMESTAMP DEFAULT NOW(),
    completed_at TIMESTAMP
);

-- Path results (optional, for detailed analysis)
CREATE TABLE simulation_paths (
    id SERIAL PRIMARY KEY,
    simulation_id UUID REFERENCES simulations(id),
    path_idx INTEGER NOT NULL,
    outcome VARCHAR(20) NOT NULL,
    moic DECIMAL(10,4),
    irr DECIMAL(10,4),
    timeline_months DECIMAL(10,2),
    data JSONB
);

-- Portfolios
CREATE TABLE portfolios (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    description TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE portfolio_claims (
    portfolio_id UUID REFERENCES portfolios(id),
    claim_id UUID REFERENCES claims(id),
    weight DECIMAL(5,4) DEFAULT 1.0,
    PRIMARY KEY (portfolio_id, claim_id)
);
```

---

## 8. Error Handling

### Error Codes

| Code | Description | HTTP Status |
|------|-------------|-------------|
| E001 | Invalid configuration | 400 |
| E002 | Claim not found | 404 |
| E003 | Simulation failed | 500 |
| E004 | Invalid jurisdiction | 400 |
| E005 | Probability validation failed | 400 |

### Error Response Format

```json
{
  "error": {
    "code": "E001",
    "message": "Invalid configuration: quantum bands must sum to 1.0",
    "field": "config.quantum.bands",
    "details": {
      "actual_sum": 0.95,
      "expected_sum": 1.0
    }
  }
}
```

### Validation Layer

```python
from pydantic import ValidationError

def validate_claim_config(config: dict) -> ClaimConfig:
    """
    Validate claim configuration.
    
    Raises
    ------
    ValidationError
        If configuration is invalid
    """
    try:
        claim = ClaimConfig(**config)
        
        # Additional business logic validation
        validate_probabilities(claim)
        validate_quantum_bands(claim.quantum)
        
        return claim
    
    except ValidationError as e:
        raise ConfigurationError(
            code="E001",
            message="Invalid configuration",
            details=e.errors()
        )
```

---

## 9. Performance Considerations

### Optimization Strategies

| Area | Strategy | Impact |
|------|----------|--------|
| RNG | Use numpy Generator (not legacy) | 10x faster |
| Vectorization | NumPy arrays over lists | 50x faster |
| Parallelization | multiprocessing for paths | N-core speedup |
| Caching | Cache path enumeration | ~20% time saved |

### Memory Management

```python
# For large simulations, process in batches
def run_batched_simulation(
    config: ClaimConfig,
    n_paths: int,
    batch_size: int = 10000,
) -> SimulationResult:
    """
    Run simulation in memory-efficient batches.
    """
    n_batches = (n_paths + batch_size - 1) // batch_size
    
    all_moics = []
    
    for i in range(n_batches):
        start = i * batch_size
        end = min((i + 1) * batch_size, n_paths)
        
        batch_result = simulate_batch(config, start, end)
        all_moics.extend(batch_result.moics)
        
        # Allow GC between batches
        gc.collect()
    
    return aggregate_results(all_moics)
```

### Benchmark Targets

| Operation | Target | Acceptable |
|-----------|--------|------------|
| 10K paths, single claim | < 2s | < 5s |
| 100K paths, single claim | < 15s | < 30s |
| 10K paths, 50-claim portfolio | < 20s | < 60s |

---

## 10. Testing Strategy

### Test Levels

```
Unit Tests           Integration Tests       End-to-End Tests
    │                      │                       │
    ▼                      ▼                       ▼
┌─────────┐           ┌─────────┐            ┌─────────┐
│Individual│          │ Module  │            │ Full    │
│ Function │          │Interaction│          │Pipeline │
│  Logic  │          │          │            │         │
└─────────┘           └─────────┘            └─────────┘
```

### Test Coverage Requirements

| Module | Unit Test | Integration |
|--------|-----------|-------------|
| probability_tree | 95% | Required |
| quantum_model | 90% | Required |
| settlement | 90% | Required |
| timeline | 85% | Required |
| monte_carlo | 80% | Required |
| metrics | 95% | Required |

### Property-Based Testing

```python
from hypothesis import given, strategies as st

@given(
    soc=st.floats(min_value=1, max_value=1000),
    n_paths=st.integers(min_value=100, max_value=10000),
)
def test_moic_bounds(soc, n_paths):
    """MOIC must be in [0, reasonable_max]."""
    config = make_config(soc_cr=soc)
    result = run_simulation(config, n_paths=n_paths)
    
    assert all(0 <= m <= 10 for m in result.path_moics)
    assert 0 <= result.moic_mean <= 5


@given(
    bands=st.lists(
        st.tuples(st.floats(0, 1), st.floats(0, 1)),
        min_size=2, max_size=10
    )
)
def test_quantum_sampling(bands):
    """Quantum sampling must respect bounds."""
    # ... test logic
```

---

## 11. Deployment Architecture

### Containerized Deployment

```dockerfile
# Dockerfile for simulation engine
FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY engine/ ./engine/

CMD ["python", "-m", "engine.run_v2", "--config", "/config/claim.json"]
```

### Kubernetes Setup

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: simulation-engine
spec:
  replicas: 3
  selector:
    matchLabels:
      app: simulation-engine
  template:
    metadata:
      labels:
        app: simulation-engine
    spec:
      containers:
      - name: engine
        image: claim-analytics/engine:v2.0
        resources:
          requests:
            memory: "512Mi"
            cpu: "500m"
          limits:
            memory: "2Gi"
            cpu: "2000m"
```

---

## 12. Security Considerations

### Input Validation

- All user inputs validated through Pydantic
- SQL injection prevented via parameterized queries
- File path injection prevented

### Authentication/Authorization

- API key authentication for external access
- Role-based access control (RBAC) for internal users
- Audit logging for sensitive operations

### Data Protection

- Encryption at rest for sensitive claim data
- TLS for all API communication
- PII handling per GDPR/local regulations

---

## 13. Monitoring & Logging

### Structured Logging

```python
import structlog

logger = structlog.get_logger()

def run_simulation(config, n_paths, seed):
    logger.info(
        "simulation_started",
        claim_id=config.claim_id,
        n_paths=n_paths,
        seed=seed,
    )
    
    try:
        result = _run_simulation(config, n_paths, seed)
        logger.info(
            "simulation_completed",
            claim_id=config.claim_id,
            runtime_ms=result.runtime_ms,
            moic_mean=result.moic_mean,
        )
        return result
    
    except Exception as e:
        logger.error(
            "simulation_failed",
            claim_id=config.claim_id,
            error=str(e),
            exc_info=True,
        )
        raise
```

### Metrics

| Metric | Type | Purpose |
|--------|------|---------|
| simulation_duration_seconds | Histogram | Performance |
| simulation_paths_total | Counter | Usage |
| simulation_errors_total | Counter | Reliability |
| active_simulations | Gauge | Capacity |

---

## 14. Future Roadmap

### Phase 1: Core Engine (Current)

- [x] Monte Carlo simulation
- [x] Probability trees
- [x] Basic settlement model
- [x] Output generation

### Phase 2: Enhanced Features

- [ ] Correlation modeling
- [ ] Advanced settlement (game theory)
- [ ] Multi-currency support
- [ ] Real-time updates

### Phase 3: Enterprise

- [ ] Multi-tenancy
- [ ] Advanced analytics dashboard
- [ ] API rate limiting
- [ ] Audit trail
- [ ] SSO integration
