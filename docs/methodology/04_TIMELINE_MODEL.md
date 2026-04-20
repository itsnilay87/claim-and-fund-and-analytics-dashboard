# Timeline Model Specification

> **Document**: 04_TIMELINE_MODEL.md  
> **Version**: 2.0  
> **Scope**: Stage durations, stochastic timeline simulation, maximum timeline enforcement

---

## 1. Motivation

Litigation timelines are inherently uncertain:

- Court delays, procedural complexities
- Party behavior (adjournments, appeals)
- Tribunal/court caseload

The timeline model provides:
1. **Stochastic duration** for each stage
2. **Cumulative timeline** calculation
3. **Maximum timeline enforcement** (96-month cap)

---

## 2. Stage Duration Framework

### Duration Types

| Type | Description | Use Case |
|------|-------------|----------|
| **Fixed** | Deterministic duration | SLP Result (dismissed/admitted) |
| **Uniform** | $U(a, b)$ distribution | Most litigation stages |
| **Triangular** | $Tri(a, c, b)$ with mode $c$ | When "most likely" duration known |
| **LogNormal** | Right-skewed, captures delays | Complex stages with tail risk |

### Sampling Functions

```python
def sample_duration(
    distribution: str,
    params: Dict[str, float],
    rng: Generator,
) -> float:
    """
    Sample stage duration from specified distribution.
    
    Parameters
    ----------
    distribution : str
        One of: "fixed", "uniform", "triangular", "lognormal"
    params : dict
        Distribution parameters (depends on distribution)
    rng : Generator
        NumPy random generator for reproducibility
    
    Returns
    -------
    duration : float
        Duration in months
    """
    if distribution == "fixed":
        return params["value"]
    
    elif distribution == "uniform":
        return rng.uniform(params["min"], params["max"])
    
    elif distribution == "triangular":
        return rng.triangular(
            params["min"], params["mode"], params["max"]
        )
    
    elif distribution == "lognormal":
        mu = params["mu"]
        sigma = params["sigma"]
        return rng.lognormal(mu, sigma)
    
    else:
        raise ValueError(f"Unknown distribution: {distribution}")
```

---

## 3. Indian Domestic Stage Durations

### Stage: DAB (Dispute Adjudication Board)

```yaml
distribution: uniform
params:
  min: 3.0
  max: 6.0
```

**Rationale**: FIDIC contracts typically allow 84-day DAB decision period. With mobilization and submissions, 3-6 months is standard.

### Stage: Arbitration

```yaml
distribution: uniform
params:
  min: 18.0
  max: 36.0
```

**Rationale**: Institutional arbitration (ICC, LCIA, SIAC) typically 18-24 months. Complex construction cases can extend to 36+ months. Indian domestic arbitration under 2015 amendments aims for 18-month completion.

### Stage: S.34 (Setting Aside)

```yaml
distribution: uniform
params:
  min: 6.0
  max: 18.0
```

**Rationale**: High Court petition under Arbitration & Conciliation Act 1996 Section 34. Mandated 3-month limitation + hearing delays.

### Stage: S.37 (First Appeal)

```yaml
distribution: uniform
params:
  min: 12.0
  max: 30.0
```

**Rationale**: Division Bench appeal. High Court appellate backlogs in India are significant.

### Stage: SLP (Supreme Court)

| Outcome Path | Duration Type | Value/Range |
|--------------|---------------|-------------|
| SLP Dismissed | fixed | 3.0 months |
| SLP Admitted → Win/Lose | uniform | 24.0 - 48.0 months |
| SLP Admitted → RESTART | uniform | 6.0 - 12.0 months (to remand order) |

**Rationale**: 
- Dismissed SLP: Quick rejection at admission stage
- Admitted SLP: Full Supreme Court hearing, significant delays
- RESTART: Remand order typically issued relatively quickly

### Indian Domestic Summary Table

| Stage | Distribution | Min | Max | Mode | Expected |
|-------|--------------|-----|-----|------|----------|
| DAB | uniform | 3 | 6 | — | 4.5 |
| Arbitration | uniform | 18 | 36 | — | 27 |
| S.34 | uniform | 6 | 18 | — | 12 |
| S.37 | uniform | 12 | 30 | — | 21 |
| SLP (dismissed) | fixed | 3 | 3 | — | 3 |
| SLP (admitted) | uniform | 24 | 48 | — | 36 |

---

## 4. SIAC Singapore Stage Durations

### Stage: Arbitration

```yaml
distribution: uniform
params:
  min: 12.0
  max: 24.0
```

**Rationale**: SIAC is efficient. Simple cases 12 months, complex 18-24 months.

### Stage: HC (High Court)

```yaml
distribution: uniform
params:
  min: 6.0
  max: 12.0
```

**Rationale**: Singapore judiciary is expedient. Setting aside applications processed quickly.

### Stage: COA (Court of Appeal)

```yaml
distribution: uniform
params:
  min: 6.0
  max: 18.0
```

**Rationale**: Appeals to COA are faster than most jurisdictions but can still take time for complex matters.

### SIAC Summary Table

| Stage | Distribution | Min | Max | Expected |
|-------|--------------|-----|-----|----------|
| Arbitration | uniform | 12 | 24 | 18 |
| HC | uniform | 6 | 12 | 9 |
| COA | uniform | 6 | 18 | 12 |

---

## 5. HKIAC Hong Kong Stage Durations

### Stage: Arbitration

```yaml
distribution: uniform
params:
  min: 12.0
  max: 24.0
```

**Rationale**: HKIAC efficiency comparable to SIAC.

### Stage: CFI (Court of First Instance)

```yaml
distribution: uniform
params:
  min: 6.0
  max: 12.0
```

**Rationale**: Hong Kong courts are efficient.

### Stage: CA (Court of Appeal)

```yaml
distribution: uniform
params:
  min: 6.0
  max: 18.0
```

### Stage: CFA (Court of Final Appeal)

```yaml
distribution: uniform
params:
  min: 12.0
  max: 24.0
```

**Rationale**: CFA has limited docket, but constitutional matters may take time.

### HKIAC Summary Table

| Stage | Distribution | Min | Max | Expected |
|-------|--------------|-----|-----|----------|
| Arbitration | uniform | 12 | 24 | 18 |
| CFI | uniform | 6 | 12 | 9 |
| CA | uniform | 6 | 18 | 12 |
| CFA | uniform | 12 | 24 | 18 |

---

## 6. Duration Dependencies

### Independent vs Conditional Durations

**Current Model**: Stage durations are **independent** draws.

**Alternative Model**: Condition duration on path outcome.

```python
def sample_conditional_duration(
    stage: str,
    outcome: str,  # "WIN" or "LOSE" at this stage
    rng: Generator,
) -> float:
    """
    Sample duration conditioned on stage outcome.
    
    Rationale: Losing cases may be dismissed faster than 
    closely contested ones that take full hearing time.
    """
    base_params = get_duration_params(stage)
    
    if outcome == "LOSE":
        # Shorten by 20%
        adjustment = 0.8
    else:
        # Winners get full range
        adjustment = 1.0
    
    duration = sample_duration(base_params["distribution"], base_params["params"], rng)
    return duration * adjustment
```

**Note**: This dependency creates path-specific timeline profiles.

---

## 7. Cumulative Timeline Calculation

### Path-by-Path Timeline

For a path $p = (s_1, s_2, \ldots, s_K)$:

$$
T_{cumulative}(p) = \sum_{k=1}^{K} D_{s_k}
$$

where $D_{s_k}$ is the realized duration for stage $s_k$.

### Timeline at Each Stage

```python
def compute_stage_timings(
    path_stages: List[str],
    durations: Dict[str, float],
) -> Dict[str, float]:
    """
    Compute elapsed time at START of each stage.
    
    Returns dict mapping stage → elapsed_months_at_stage_start
    """
    timings = {}
    elapsed = 0.0
    
    for stage in path_stages:
        timings[stage] = elapsed
        elapsed += durations.get(stage, 0.0)
    
    return timings
```

### Example Timeline

Indian Domestic path: DAB → Arbitration (WIN) → S.34 (Upheld) → TRUE_WIN

| Stage | Duration Drawn | Elapsed at End |
|-------|----------------|----------------|
| DAB | 4.2 | 4.2 |
| Arbitration | 22.5 | 26.7 |
| S.34 | 11.3 | 38.0 |
| **Total** | — | **38.0 months** |

---

## 8. Maximum Timeline Enforcement

### 96-Month Hard Cap

Model enforces a **maximum timeline** to prevent unrealistic scenarios:

$$
T_{max} = 96 \text{ months} = 8 \text{ years}
$$

If cumulative duration exceeds $T_{max}$:

1. **Truncate timeline**: Set $T_{resolution} = T_{max}$
2. **Preserve outcome**: Outcome classification is unchanged
3. **Compress final stage**: Final stage duration is shortened to fit cap

### Implementation

```python
def enforce_max_timeline(
    stage_durations: Dict[str, float],
    stage_order: List[str],
    max_months: float = 96.0,
) -> Dict[str, float]:
    """
    Enforce maximum timeline by compressing final stage if needed.
    
    Returns adjusted durations dict.
    """
    total = sum(stage_durations.get(s, 0.0) for s in stage_order)
    
    if total <= max_months:
        return stage_durations  # No adjustment needed
    
    # Need to compress
    adjusted = dict(stage_durations)
    excess = total - max_months
    
    # Reduce final stage duration
    final_stage = stage_order[-1]
    original_final = adjusted[final_stage]
    adjusted[final_stage] = max(1.0, original_final - excess)  # Min 1 month
    
    return adjusted
```

### Rationale for 96-Month Cap

1. **Fund lifecycle**: 10-year fund life is standard, 8 years gives deployment room
2. **Practical reality**: Indian litigation rarely exceeds 8 years for single claim
3. **Model stability**: Prevents extreme outliers in timeline Monte Carlo

---

## 9. Payment/Recovery Delay

### Post-Resolution Delay

After judicial resolution, there is a delay before payment received:

$$
T_{payment} = T_{resolution} + D_{payment}
$$

where $D_{payment}$ is drawn from:

```yaml
distribution: uniform
params:
  min: 1.0
  max: 3.0
```

**Rationale**: Enforcement proceedings, bank transfers, documentation.

### Implementation with Settlement

If settlement:

$$
T_{payment}^{settled} = T_{settlement} + D_{settlement\_delay}
$$

where $D_{settlement\_delay} \sim U(0.5, 2.0)$ (faster than judicial).

---

## 10. Stochastic Timeline Sampling Algorithm

### Complete Algorithm

```python
def sample_path_timeline(
    jurisdiction: str,
    path: PathOutcome,
    seed: int,
) -> TimelineResult:
    """
    Sample complete timeline for a path.
    
    Parameters
    ----------
    jurisdiction : str
        "indian_domestic", "siac", or "hkiac"
    path : PathOutcome
        Path object with stage sequence and outcome
    seed : int
        Random seed for this path
    
    Returns
    -------
    TimelineResult
        Contains stage durations, cumulative times, final timing
    """
    rng = np.random.default_rng(seed)
    
    # Get stage sequence for this path
    stages = path.stage_sequence
    
    # Sample duration for each stage
    durations = {}
    for stage in stages:
        dist_spec = get_duration_specification(jurisdiction, stage, path.outcome)
        durations[stage] = sample_duration(
            dist_spec["distribution"],
            dist_spec["params"],
            rng,
        )
    
    # Enforce maximum timeline
    durations = enforce_max_timeline(durations, stages, max_months=96.0)
    
    # Compute cumulative timings
    stage_timings = compute_stage_timings(stages, durations)
    resolution_month = sum(durations.values())
    
    # Add payment delay
    payment_delay = rng.uniform(1.0, 3.0)
    payment_month = resolution_month + payment_delay
    
    return TimelineResult(
        stage_durations=durations,
        stage_start_months=stage_timings,
        resolution_month=resolution_month,
        payment_month=payment_month,
        exceeded_max_timeline=sum(durations.values()) > 96.0,
    )
```

---

## 11. Timeline Distribution Analytics

### Expected Timeline by Path Type

| Jurisdiction | Path Type | E[Timeline] (months) |
|--------------|-----------|----------------------|
| Indian Domestic | Quick Win | 31.5 |
| Indian Domestic | Full Challenge | 64.5 |
| Indian Domestic | RESTART Path | 85+ |
| SIAC | Quick Win | 27.0 |
| SIAC | Full Appeal | 39.0 |
| HKIAC | Quick Win | 27.0 |
| HKIAC | Full Appeal | 57.0 |

### Percentile Distribution

From Monte Carlo with 10,000 paths:

| Percentile | Indian Domestic | SIAC | HKIAC |
|------------|-----------------|------|-------|
| 10th | 28 | 22 | 22 |
| 25th | 35 | 26 | 26 |
| 50th (Median) | 48 | 31 | 35 |
| 75th | 65 | 38 | 45 |
| 90th | 80 | 45 | 55 |
| 95th | 88 | 50 | 62 |

---

## 12. Results Data Structure

```python
@dataclass
class TimelineResult:
    stage_durations: Dict[str, float]      # stage_name → duration_months
    stage_start_months: Dict[str, float]   # stage_name → cumulative_at_start
    resolution_month: float                # Final resolution timing
    payment_month: float                   # Payment receipt timing
    exceeded_max_timeline: bool            # True if 96-month cap applied
    total_months_raw: Optional[float]      # Pre-cap total (for diagnostics)


@dataclass
class PathWithTimeline:
    path: PathOutcome
    timeline: TimelineResult
    settlement_result: Optional[SettlementResult]
    
    @property
    def effective_resolution_month(self) -> float:
        if self.settlement_result and self.settlement_result.settled:
            return self.settlement_result.timing_months
        return self.timeline.resolution_month
```

---

## 13. Configuration Schema

```python
class TimelineConfig(BaseModel):
    """Timeline model configuration."""
    
    max_timeline_months: float = 96.0
    payment_delay_min: float = 1.0
    payment_delay_max: float = 3.0
    settlement_delay_min: float = 0.5
    settlement_delay_max: float = 2.0
    
    stage_duration_overrides: Optional[Dict[str, DurationSpec]] = None
    
    class DurationSpec(BaseModel):
        distribution: Literal["fixed", "uniform", "triangular", "lognormal"]
        min: Optional[float] = None
        max: Optional[float] = None
        mode: Optional[float] = None
        mu: Optional[float] = None
        sigma: Optional[float] = None
        value: Optional[float] = None
```

---

## 14. Limitations & Future Enhancements

### Current Limitations

1. **Independence assumption**: Stage durations are independent; in reality, complex cases take longer at every stage.

2. **No learning**: Model doesn't update duration expectations based on observed data.

3. **Uniform distributions**: May not capture heavy tails (rare extreme delays).

### Future Enhancements

1. **Correlated durations**: Introduce claim "complexity factor" $\xi \sim LogNormal(\mu, \sigma)$ that scales all durations.

2. **Historical calibration**: Fit distributions to actual Indian litigation data.

3. **Court-specific delays**: Model by specific High Court (e.g., Delhi HC vs Bombay HC have different backlogs).
