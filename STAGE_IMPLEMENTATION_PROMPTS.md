# Jurisdiction-Specific Legal Stages with Known Outcomes — Implementation Prompts

> **Purpose**: Six self-contained prompts for an Opus 4.6 agent (192 K context window).
> Each prompt targets one phase and can run in a **separate, independent session**.
> Execute phases in order (1 → 6). Each phase's output feeds the next.
>
> **Key docs to attach to EVERY prompt**:
> - `engine/config/schema.py` (full file)
> - `AGENT_CONTEXT_GUIDE.md`
> - `AGENT_DEVELOPMENT_PLAYBOOK.md`
> - This file (`STAGE_IMPLEMENTATION_PROMPTS.md`) — so the agent knows the full plan

---

## Design Decisions Summary (attach to every session)

These decisions are FINAL and must be respected by all implementation phases:

| # | Decision | Detail |
|---|----------|--------|
| 1 | **Architecture** | Option B — Stage + Outcome Field. `ClaimConfig` gets a `known_outcomes: KnownOutcomes` sub-model. |
| 2 | **known_quantum** | Supports BOTH `known_quantum_cr` (absolute, in currency Cr) and `known_quantum_pct` (fraction of SOC). When set by user, the MC engine draws from a **distribution centered on the known value** (NOT deterministic). The award can still change through further legal stages. Use truncated normal: μ = known_quantum_pct, σ = 0.10, clipped to [0, 1]. |
| 3 | **Re-referral / re-arbitration** | Engine-internal only. NOT user-selectable stages. Removed from available_stages in all jurisdiction JSONs. |
| 4 | **dab_found_premature** | Keep for Indian Domestic only. Remove from SIAC and HKIAC. |
| 5 | **Enforcement stage** | Available for ALL jurisdictions as the final user-selectable stage. |
| 6 | **Duration calibration** | Keep identical values across jurisdictions for now (same durations/costs). |
| 7 | **known_interest_rate** | Deferred to a later sprint. Do NOT implement. |
| 8 | **Post-award stages** | When current_stage is a post-award stage (e.g., s34_pending, hc_challenge_pending), arb_won is FORCED (not drawn randomly). The MC engine enters the correct scenario tree and skips already-decided nodes. |
| 9 | **Documentation** | ALL documentation files must be updated for future developer/AI agent use. |

---

## PHASE 1 — Schema & Data Model

### Goal
Add `KnownOutcomes` Pydantic model to `schema.py`, add `known_outcomes` field to `ClaimConfig`, update `defaults.py`, add validation rules.

### Attach These Files
```
engine/config/schema.py          (full file — you will edit this)
engine/config/defaults.py        (full file — you will edit this)
STAGE_IMPLEMENTATION_PROMPTS.md  (this file — for context)
AGENT_CONTEXT_GUIDE.md
```

### Prompt

```
You are implementing Phase 1 of 6 for the "Jurisdiction-Specific Legal Stages with Known Outcomes" feature in the Claim Analytics Platform.

## Context

The platform models arbitration claims through Monte Carlo simulation. Currently, `ClaimConfig.current_stage` is a simple string that indicates where a claim sits in the pipeline, but there is NO mechanism to record known legal outcomes (e.g., "we already won arbitration", "S.34 challenge was dismissed"). This causes a critical modeling bug: the MC engine draws arb_won randomly even when the arbitration award is already known.

## Your Task

Add a `KnownOutcomes` Pydantic model and integrate it into `ClaimConfig`.

### 1. New `KnownOutcomes` model in `engine/config/schema.py`

Add this between the `ArbitrationConfig` class (Section 10, ~line 520) and the `ClaimConfig` class (Section 11, ~line 527):

```python
class KnownOutcomes(BaseModel):
    """Known legal outcomes for claims at post-decision stages.

    When a claim has progressed past arbitration or past specific court
    challenges, these fields record the known results.  The MC engine
    uses these to SKIP random draws for already-decided events and to
    enter the correct scenario tree branch.

    All fields default to None (= not yet decided / unknown).
    """

    # ── Arbitration-level outcomes ──
    dab_outcome: Optional[Literal["favorable", "adverse", "premature"]] = Field(
        default=None,
        description="DAB decision outcome. 'favorable' = DAB awarded in claimant's favor, "
                    "'adverse' = DAB ruled against claimant, "
                    "'premature' = DAB found claim premature (Indian Domestic only).",
    )
    arb_outcome: Optional[Literal["won", "lost"]] = Field(
        default=None,
        description="Arbitration award outcome. 'won' = claimant won arbitration, "
                    "'lost' = claimant lost arbitration.",
    )

    # ── Known quantum (when arb_outcome = 'won') ──
    known_quantum_cr: Optional[float] = Field(
        default=None, ge=0.0,
        description="Known awarded quantum in currency Cr. "
                    "Used as the CENTER of a stochastic distribution (not deterministic). "
                    "The actual quantum in simulation is drawn from "
                    "TruncatedNormal(μ=known_quantum_pct, σ=0.10, [0, 1]).",
    )
    known_quantum_pct: Optional[float] = Field(
        default=None, ge=0.0, le=2.0,
        description="Known awarded quantum as fraction of SOC (e.g. 0.85 = 85% of SOC). "
                    "If both known_quantum_cr and known_quantum_pct are set, "
                    "known_quantum_pct takes precedence for the distribution center.",
    )

    # ── Indian Domestic challenge outcomes (S.34 → S.37 → SLP) ──
    s34_outcome: Optional[Literal["claimant_won", "respondent_won"]] = Field(
        default=None,
        description="S.34 challenge result. 'claimant_won' = S.34 challenge dismissed "
                    "(award upheld), 'respondent_won' = S.34 set aside award.",
    )
    s37_outcome: Optional[Literal["claimant_won", "respondent_won"]] = Field(
        default=None,
        description="S.37 appeal result. Same semantics as s34_outcome.",
    )
    slp_gate_outcome: Optional[Literal["dismissed", "admitted"]] = Field(
        default=None,
        description="SLP gate decision. 'dismissed' = SLP not admitted (final win), "
                    "'admitted' = SLP proceeds to merits hearing.",
    )
    slp_merits_outcome: Optional[Literal["claimant_won", "respondent_won"]] = Field(
        default=None,
        description="SLP merits hearing result.",
    )

    # ── SIAC Singapore challenge outcomes (HC → COA) ──
    hc_outcome: Optional[Literal["claimant_won", "respondent_won"]] = Field(
        default=None,
        description="High Court challenge result (SIAC Singapore).",
    )
    coa_outcome: Optional[Literal["claimant_won", "respondent_won"]] = Field(
        default=None,
        description="Court of Appeal result (SIAC Singapore).",
    )

    # ── HKIAC Hong Kong challenge outcomes (CFI → CA → CFA) ──
    cfi_outcome: Optional[Literal["claimant_won", "respondent_won"]] = Field(
        default=None,
        description="Court of First Instance challenge result (HKIAC Hong Kong).",
    )
    ca_outcome: Optional[Literal["claimant_won", "respondent_won"]] = Field(
        default=None,
        description="Court of Appeal result (HKIAC Hong Kong).",
    )
    cfa_gate_outcome: Optional[Literal["dismissed", "admitted"]] = Field(
        default=None,
        description="Court of Final Appeal leave-to-appeal decision (HKIAC HK).",
    )
    cfa_merits_outcome: Optional[Literal["claimant_won", "respondent_won"]] = Field(
        default=None,
        description="Court of Final Appeal merits result (HKIAC HK).",
    )

    @model_validator(mode="after")
    def _quantum_requires_arb_won(self) -> "KnownOutcomes":
        """known_quantum fields only valid when arb_outcome = 'won'."""
        if (self.known_quantum_cr is not None or self.known_quantum_pct is not None):
            if self.arb_outcome != "won":
                raise ValueError(
                    "KnownOutcomes: known_quantum_cr/known_quantum_pct require arb_outcome='won'."
                )
        return self

    @model_validator(mode="after")
    def _challenge_requires_arb_outcome(self) -> "KnownOutcomes":
        """Post-award challenge outcomes require arb_outcome to be set."""
        challenge_fields = [
            's34_outcome', 's37_outcome', 'slp_gate_outcome', 'slp_merits_outcome',
            'hc_outcome', 'coa_outcome',
            'cfi_outcome', 'ca_outcome', 'cfa_gate_outcome', 'cfa_merits_outcome',
        ]
        has_challenge = any(getattr(self, f) is not None for f in challenge_fields)
        if has_challenge and self.arb_outcome is None:
            raise ValueError(
                "KnownOutcomes: post-award challenge outcomes require arb_outcome to be set."
            )
        return self

    @model_validator(mode="after")
    def _sequential_consistency(self) -> "KnownOutcomes":
        """Validate that outcomes are sequentially consistent.
        e.g., s37_outcome requires s34_outcome; slp_gate requires s37_outcome."""
        # Indian Domestic chain
        if self.s37_outcome and not self.s34_outcome:
            raise ValueError("KnownOutcomes: s37_outcome requires s34_outcome to be set.")
        if self.slp_gate_outcome and not self.s37_outcome:
            raise ValueError("KnownOutcomes: slp_gate_outcome requires s37_outcome to be set.")
        if self.slp_merits_outcome and self.slp_gate_outcome != "admitted":
            raise ValueError("KnownOutcomes: slp_merits_outcome requires slp_gate_outcome='admitted'.")
        # SIAC chain
        if self.coa_outcome and not self.hc_outcome:
            raise ValueError("KnownOutcomes: coa_outcome requires hc_outcome to be set.")
        # HKIAC chain
        if self.ca_outcome and not self.cfi_outcome:
            raise ValueError("KnownOutcomes: ca_outcome requires cfi_outcome to be set.")
        if self.cfa_gate_outcome and not self.ca_outcome:
            raise ValueError("KnownOutcomes: cfa_gate_outcome requires ca_outcome to be set.")
        if self.cfa_merits_outcome and self.cfa_gate_outcome != "admitted":
            raise ValueError("KnownOutcomes: cfa_merits_outcome requires cfa_gate_outcome='admitted'.")
        return self
```

### 2. Add `known_outcomes` to `ClaimConfig`

In the `ClaimConfig` class (~line 527-630), add this field AFTER the `current_stage` field and BEFORE the `perspective` field:

```python
    known_outcomes: KnownOutcomes = Field(
        default_factory=KnownOutcomes,
        description="Known legal outcomes for claims at post-decision stages. "
                    "Used by the MC engine to skip random draws for decided events.",
    )
```

### 3. Update `engine/config/defaults.py`

In `get_default_claim_config()` (around line 973-1065), the function creates a ClaimConfig. Ensure the default `known_outcomes=KnownOutcomes()` is included. Since `KnownOutcomes` has `default_factory`, this should work automatically, but add the import:

At the top imports section, add `KnownOutcomes` to the import from `.schema`.

### 4. Validation Rules

The `KnownOutcomes` model already contains its own validators. No additional ClaimConfig-level validators are needed at this phase — the stage↔outcome consistency validation will be added in Phase 2 (Adapter) where we have access to jurisdiction context.

## Verification

After making changes:
1. Run: `python -c "from engine.config.schema import KnownOutcomes, ClaimConfig; print('✓ imports OK')"` from the platform root.
2. Run: `python -c "from engine.config.schema import KnownOutcomes; ko = KnownOutcomes(); print(ko.model_dump()); print('✓ defaults OK')"`
3. Run: `python -c "from engine.config.schema import KnownOutcomes; ko = KnownOutcomes(arb_outcome='won', known_quantum_pct=0.85); print(ko.model_dump()); print('✓ arb won + quantum OK')"`
4. Run: `python -c "
from engine.config.schema import KnownOutcomes
try:
    KnownOutcomes(known_quantum_pct=0.85)  # no arb_outcome — should fail
    print('✗ should have raised')
except Exception as e:
    print(f'✓ validation caught: {e}')
"`
5. Run: `python -c "from engine.config.defaults import get_default_claim_config; c = get_default_claim_config('indian_domestic'); print(c.known_outcomes); print('✓ default claim OK')"`

## DO NOT

- Do NOT touch any other files in this phase.
- Do NOT add known_interest_rate — that is deferred.
- Do NOT change any existing field types or defaults on ClaimConfig.
- Do NOT add stage-list changes to jurisdiction JSONs (that's Phase 2).
```

---

## PHASE 2 — Jurisdiction Stage Lists & Adapter/Pipeline

### Goal
Replace the `available_stages` arrays in all three jurisdiction JSONs with the full jurisdiction-specific stage lists (including post-award stages), update `_STAGE_SKIP_MAP` and `derive_pipeline()` in `adapter.py`, and add a helper `derive_known_outcomes_from_stage()`.

### Attach These Files
```
engine/config/schema.py              (with Phase 1 changes applied)
engine/adapter.py                    (full file — you will edit this)
engine/jurisdictions/indian_domestic.json  (full file — you will edit this)
engine/jurisdictions/siac_singapore.json   (full file — you will edit this)
engine/jurisdictions/hkiac_hongkong.json   (full file — you will edit this)
STAGE_IMPLEMENTATION_PROMPTS.md
engine/models/timeline_model.py      (read-only — for understanding pipeline)
```

### Prompt

```
You are implementing Phase 2 of 6 for the "Jurisdiction-Specific Legal Stages with Known Outcomes" feature.

Phase 1 (COMPLETED) added `KnownOutcomes` model to `schema.py` and `known_outcomes` field to `ClaimConfig`.

## Task A: Update Jurisdiction JSON Files

Replace the `available_stages` arrays in all three jurisdiction template JSON files. The new stage lists include post-award stages and remove `re_referral`/`re_arbitration` from user-selectable options.

**IMPORTANT**: Duration/cost values stay the same for now (per design decision #6). The `pipeline_after` field is critical — it tells the frontend which stages follow the selected stage.

### Indian Domestic (`engine/jurisdictions/indian_domestic.json`)

Replace the entire `available_stages` array with:

```json
"available_stages": [
    {
      "name": "pre_dab",
      "label": "Pre-DAB (Claim Preparation)",
      "duration_low": 0, "duration_high": 0,
      "legal_cost_low": 0, "legal_cost_high": 0,
      "pipeline_after": ["dab", "arbitration"],
      "stage_category": "pre_arb"
    },
    {
      "name": "dab",
      "label": "DAB (Dispute Adjudication Board)",
      "duration_low": 4.8, "duration_high": 13.1,
      "legal_cost_low": 0.50, "legal_cost_high": 1.0,
      "pipeline_after": ["arbitration"],
      "stage_category": "pre_arb"
    },
    {
      "name": "dab_found_premature",
      "label": "DAB — Found Premature (Re-referral Required)",
      "duration_low": 0, "duration_high": 0,
      "legal_cost_low": 0, "legal_cost_high": 0,
      "pipeline_after": ["dab", "arbitration"],
      "stage_category": "pre_arb",
      "notes": "Engine inserts re_referral stage internally"
    },
    {
      "name": "dab_award_done",
      "label": "DAB Award Issued",
      "duration_low": 0, "duration_high": 0,
      "legal_cost_low": 0, "legal_cost_high": 0,
      "pipeline_after": ["arbitration"],
      "stage_category": "pre_arb",
      "requires_outcome": ["dab_outcome"]
    },
    {
      "name": "arb_commenced",
      "label": "Arbitration Filed / Commenced",
      "duration_low": 20.3, "duration_high": 23.4,
      "legal_cost_low": 8.0, "legal_cost_high": 8.0,
      "pipeline_after": [],
      "stage_category": "arb"
    },
    {
      "name": "arb_hearings_ongoing",
      "label": "Arbitration Hearings Ongoing",
      "duration_low": 6.0, "duration_high": 12.0,
      "legal_cost_low": 4.0, "legal_cost_high": 4.0,
      "pipeline_after": [],
      "stage_category": "arb",
      "notes": "Partial arbitration remaining"
    },
    {
      "name": "arb_award_done",
      "label": "Arbitration Award Issued",
      "duration_low": 0, "duration_high": 0,
      "legal_cost_low": 0, "legal_cost_high": 0,
      "pipeline_after": [],
      "stage_category": "post_arb",
      "requires_outcome": ["arb_outcome"]
    },
    {
      "name": "s34_pending",
      "label": "S.34 Challenge Pending",
      "duration_low": 9.0, "duration_high": 18.0,
      "legal_cost_low": 2.0, "legal_cost_high": 3.0,
      "pipeline_after": [],
      "stage_category": "post_arb",
      "requires_outcome": ["arb_outcome"]
    },
    {
      "name": "s34_decided",
      "label": "S.34 Challenge Decided",
      "duration_low": 0, "duration_high": 0,
      "legal_cost_low": 0, "legal_cost_high": 0,
      "pipeline_after": [],
      "stage_category": "post_arb",
      "requires_outcome": ["arb_outcome", "s34_outcome"]
    },
    {
      "name": "s37_pending",
      "label": "S.37 Appeal Pending",
      "duration_low": 6.0, "duration_high": 12.0,
      "legal_cost_low": 1.0, "legal_cost_high": 2.0,
      "pipeline_after": [],
      "stage_category": "post_arb",
      "requires_outcome": ["arb_outcome", "s34_outcome"]
    },
    {
      "name": "s37_decided",
      "label": "S.37 Appeal Decided",
      "duration_low": 0, "duration_high": 0,
      "legal_cost_low": 0, "legal_cost_high": 0,
      "pipeline_after": [],
      "stage_category": "post_arb",
      "requires_outcome": ["arb_outcome", "s34_outcome", "s37_outcome"]
    },
    {
      "name": "slp_pending",
      "label": "SLP Before Supreme Court — Pending",
      "duration_low": 4.0, "duration_high": 24.0,
      "legal_cost_low": 2.0, "legal_cost_high": 3.0,
      "pipeline_after": [],
      "stage_category": "post_arb",
      "requires_outcome": ["arb_outcome", "s34_outcome", "s37_outcome"]
    },
    {
      "name": "enforcement",
      "label": "Enforcement / Collection",
      "duration_low": 3.0, "duration_high": 6.0,
      "legal_cost_low": 0.5, "legal_cost_high": 1.0,
      "pipeline_after": [],
      "stage_category": "post_arb",
      "notes": "Final stage — all legal challenges resolved, collecting award"
    }
]
```

### SIAC Singapore (`engine/jurisdictions/siac_singapore.json`)

Replace the entire `available_stages` array with:

```json
"available_stages": [
    {
      "name": "pre_dab",
      "label": "Pre-DAB (Claim Preparation)",
      "duration_low": 0, "duration_high": 0,
      "legal_cost_low": 0, "legal_cost_high": 0,
      "pipeline_after": ["dab", "arbitration"],
      "stage_category": "pre_arb"
    },
    {
      "name": "dab",
      "label": "DAB (Dispute Adjudication Board)",
      "duration_low": 4.8, "duration_high": 13.1,
      "legal_cost_low": 0.50, "legal_cost_high": 1.0,
      "pipeline_after": ["arbitration"],
      "stage_category": "pre_arb"
    },
    {
      "name": "dab_award_done",
      "label": "DAB Award Issued",
      "duration_low": 0, "duration_high": 0,
      "legal_cost_low": 0, "legal_cost_high": 0,
      "pipeline_after": ["arbitration"],
      "stage_category": "pre_arb",
      "requires_outcome": ["dab_outcome"]
    },
    {
      "name": "arb_commenced",
      "label": "Arbitration Filed / Commenced",
      "duration_low": 20.3, "duration_high": 23.4,
      "legal_cost_low": 8.0, "legal_cost_high": 8.0,
      "pipeline_after": [],
      "stage_category": "arb"
    },
    {
      "name": "arb_hearings_ongoing",
      "label": "Arbitration Hearings Ongoing",
      "duration_low": 6.0, "duration_high": 12.0,
      "legal_cost_low": 4.0, "legal_cost_high": 4.0,
      "pipeline_after": [],
      "stage_category": "arb"
    },
    {
      "name": "arb_award_done",
      "label": "Arbitration Award Issued",
      "duration_low": 0, "duration_high": 0,
      "legal_cost_low": 0, "legal_cost_high": 0,
      "pipeline_after": [],
      "stage_category": "post_arb",
      "requires_outcome": ["arb_outcome"]
    },
    {
      "name": "hc_challenge_pending",
      "label": "High Court Challenge Pending",
      "duration_low": 6.0, "duration_high": 12.0,
      "legal_cost_low": 2.0, "legal_cost_high": 3.0,
      "pipeline_after": [],
      "stage_category": "post_arb",
      "requires_outcome": ["arb_outcome"]
    },
    {
      "name": "hc_decided",
      "label": "High Court Challenge Decided",
      "duration_low": 0, "duration_high": 0,
      "legal_cost_low": 0, "legal_cost_high": 0,
      "pipeline_after": [],
      "stage_category": "post_arb",
      "requires_outcome": ["arb_outcome", "hc_outcome"]
    },
    {
      "name": "coa_pending",
      "label": "Court of Appeal — Pending",
      "duration_low": 6.0, "duration_high": 12.0,
      "legal_cost_low": 2.0, "legal_cost_high": 3.0,
      "pipeline_after": [],
      "stage_category": "post_arb",
      "requires_outcome": ["arb_outcome", "hc_outcome"]
    },
    {
      "name": "coa_decided",
      "label": "Court of Appeal — Decided",
      "duration_low": 0, "duration_high": 0,
      "legal_cost_low": 0, "legal_cost_high": 0,
      "pipeline_after": [],
      "stage_category": "post_arb",
      "requires_outcome": ["arb_outcome", "hc_outcome", "coa_outcome"]
    },
    {
      "name": "enforcement",
      "label": "Enforcement / Collection",
      "duration_low": 3.0, "duration_high": 6.0,
      "legal_cost_low": 0.5, "legal_cost_high": 1.0,
      "pipeline_after": [],
      "stage_category": "post_arb",
      "notes": "Final stage — collecting award"
    }
]
```

### HKIAC Hong Kong (`engine/jurisdictions/hkiac_hongkong.json`)

Replace the entire `available_stages` array with:

```json
"available_stages": [
    {
      "name": "pre_dab",
      "label": "Pre-DAB (Claim Preparation)",
      "duration_low": 0, "duration_high": 0,
      "legal_cost_low": 0, "legal_cost_high": 0,
      "pipeline_after": ["dab", "arbitration"],
      "stage_category": "pre_arb"
    },
    {
      "name": "dab",
      "label": "DAB (Dispute Adjudication Board)",
      "duration_low": 4.8, "duration_high": 13.1,
      "legal_cost_low": 0.50, "legal_cost_high": 1.0,
      "pipeline_after": ["arbitration"],
      "stage_category": "pre_arb"
    },
    {
      "name": "dab_award_done",
      "label": "DAB Award Issued",
      "duration_low": 0, "duration_high": 0,
      "legal_cost_low": 0, "legal_cost_high": 0,
      "pipeline_after": ["arbitration"],
      "stage_category": "pre_arb",
      "requires_outcome": ["dab_outcome"]
    },
    {
      "name": "arb_commenced",
      "label": "Arbitration Filed / Commenced",
      "duration_low": 20.3, "duration_high": 23.4,
      "legal_cost_low": 8.0, "legal_cost_high": 8.0,
      "pipeline_after": [],
      "stage_category": "arb"
    },
    {
      "name": "arb_hearings_ongoing",
      "label": "Arbitration Hearings Ongoing",
      "duration_low": 6.0, "duration_high": 12.0,
      "legal_cost_low": 4.0, "legal_cost_high": 4.0,
      "pipeline_after": [],
      "stage_category": "arb"
    },
    {
      "name": "arb_award_done",
      "label": "Arbitration Award Issued",
      "duration_low": 0, "duration_high": 0,
      "legal_cost_low": 0, "legal_cost_high": 0,
      "pipeline_after": [],
      "stage_category": "post_arb",
      "requires_outcome": ["arb_outcome"]
    },
    {
      "name": "cfi_challenge_pending",
      "label": "Court of First Instance Challenge Pending",
      "duration_low": 6.0, "duration_high": 12.0,
      "legal_cost_low": 2.0, "legal_cost_high": 3.0,
      "pipeline_after": [],
      "stage_category": "post_arb",
      "requires_outcome": ["arb_outcome"]
    },
    {
      "name": "cfi_decided",
      "label": "Court of First Instance — Decided",
      "duration_low": 0, "duration_high": 0,
      "legal_cost_low": 0, "legal_cost_high": 0,
      "pipeline_after": [],
      "stage_category": "post_arb",
      "requires_outcome": ["arb_outcome", "cfi_outcome"]
    },
    {
      "name": "ca_pending",
      "label": "Court of Appeal — Pending",
      "duration_low": 3.0, "duration_high": 12.0,
      "legal_cost_low": 2.0, "legal_cost_high": 3.0,
      "pipeline_after": [],
      "stage_category": "post_arb",
      "requires_outcome": ["arb_outcome", "cfi_outcome"]
    },
    {
      "name": "ca_decided",
      "label": "Court of Appeal — Decided",
      "duration_low": 0, "duration_high": 0,
      "legal_cost_low": 0, "legal_cost_high": 0,
      "pipeline_after": [],
      "stage_category": "post_arb",
      "requires_outcome": ["arb_outcome", "cfi_outcome", "ca_outcome"]
    },
    {
      "name": "cfa_pending",
      "label": "Court of Final Appeal — Pending",
      "duration_low": 3.0, "duration_high": 6.0,
      "legal_cost_low": 2.0, "legal_cost_high": 3.0,
      "pipeline_after": [],
      "stage_category": "post_arb",
      "requires_outcome": ["arb_outcome", "cfi_outcome", "ca_outcome"]
    },
    {
      "name": "enforcement",
      "label": "Enforcement / Collection",
      "duration_low": 3.0, "duration_high": 6.0,
      "legal_cost_low": 0.5, "legal_cost_high": 1.0,
      "pipeline_after": [],
      "stage_category": "post_arb",
      "notes": "Final stage — collecting award"
    }
]
```

## Task B: Update `engine/adapter.py`

### B1. Expand `_STAGE_SKIP_MAP`

The current `_STAGE_SKIP_MAP` (around line 198) maps stage names to an integer skip count into the pipeline `["dab", "arbitration", "challenge_tree"]`.

Replace it with a categorized mapping that handles pre-arb stages (skip 0, 1, or 2), and marks post-arb stages as pipeline-complete (skip = `len(full_pipeline)` = 3, meaning the pipeline is empty and we go straight to challenge tree handling):

```python
# Stage categories:
#   "pre_arb"  → skip into ["dab", "arbitration", "challenge_tree"]
#   "post_arb" → pipeline is empty (all pre-arb stages completed)
#
# Post-arb stages are handled by the MC engine itself using known_outcomes
# to determine which tree branch to enter and how far to skip.

_STAGE_SKIP_MAP: dict[str, int] = {
    # ── Pre-arbitration stages (pipeline = dab → arb → challenge_tree) ──
    "": 0,
    "not_started": 0,
    "pre_dab": 0,
    "soc_filed_at_dab": 0,
    "dab_constituted": 0,
    "dab_commenced": 0,
    "dab": 0,
    "dab_found_premature": 0,  # special-cased in derive_pipeline()
    "dab_award_done": 1,       # DAB done → skip DAB stage
    "dab_completed": 1,
    "arb_commenced": 1,        # in arbitration → skip DAB
    "arb_hearings_ongoing": 1, # special-cased: uses arb_remaining
    # ── Post-arbitration stages (pipeline is empty) ──
    "arb_award_done": 3,
    "challenge_pending": 3,
    # Indian Domestic post-arb
    "s34_pending": 3,
    "s34_decided": 3,
    "s37_pending": 3,
    "s37_decided": 3,
    "slp_pending": 3,
    # SIAC Singapore post-arb
    "hc_challenge_pending": 3,
    "hc_decided": 3,
    "coa_pending": 3,
    "coa_decided": 3,
    # HKIAC Hong Kong post-arb
    "cfi_challenge_pending": 3,
    "cfi_decided": 3,
    "ca_pending": 3,
    "ca_decided": 3,
    "cfa_pending": 3,
    # All jurisdictions
    "enforcement": 3,
}
```

### B2. Update `derive_pipeline()`

The current function (around line 201-234) has special cases for `dab_found_premature` and `arb_hearings_ongoing`. Enhance it to also handle post-arb stages:

```python
def derive_pipeline(
    claim: PlatformClaim,
    template: Optional[JurisdictionTemplate] = None,
) -> list[str]:
    """Determine remaining V2 pipeline stages for this claim.

    Post-arbitration stages return an EMPTY pipeline — the MC engine
    handles them directly using known_outcomes.
    """
    stage = claim.current_stage or ""

    # Special: re-referral needed (Indian Domestic only)
    if stage == "dab_found_premature":
        return ["re_referral", "dab", "arbitration", "challenge_tree"]

    # Special: mid-arbitration
    if stage == "arb_hearings_ongoing":
        return ["arb_remaining", "challenge_tree"]

    skip = _STAGE_SKIP_MAP.get(stage, 0)
    jurisdiction = _JURISDICTION_MAP.get(claim.jurisdiction, claim.jurisdiction)

    if jurisdiction == "siac":
        full = list(_SIAC_FULL_PIPELINE)
    else:
        full = list(_DOMESTIC_FULL_PIPELINE)

    # Post-arb stages: pipeline is empty (skip >= len(full))
    if skip >= len(full):
        return []

    return full[skip:]
```

### B3. Add `derive_known_outcomes_from_stage()` helper

Add a NEW function after `derive_pipeline()` that automatically populates `known_outcomes` fields based on the selected `current_stage`. This is called by the frontend and by the adapter when preparing claims for simulation:

```python
def derive_known_outcomes_from_stage(
    stage: str,
    jurisdiction: str,
) -> dict:
    """Return the MINIMUM known_outcomes fields implied by a current_stage.

    For post-arb stages, the arb_outcome is automatically set.
    For challenge stages, preceding challenge outcomes must be set.
    Returns a dict that can be merged into known_outcomes.

    The user must still fill in the SPECIFIC outcome values (won/lost),
    but this function determines WHICH fields must be non-null.

    Example: stage='s37_pending' implies arb_outcome and s34_outcome
    must be set (but the user chooses won/lost for each).
    """
    result = {}

    # All post-arb stages require arb_outcome
    _POST_ARB_STAGES = {
        'arb_award_done', 'challenge_pending', 'enforcement',
        # Indian Domestic
        's34_pending', 's34_decided', 's37_pending', 's37_decided', 'slp_pending',
        # SIAC
        'hc_challenge_pending', 'hc_decided', 'coa_pending', 'coa_decided',
        # HKIAC
        'cfi_challenge_pending', 'cfi_decided', 'ca_pending', 'ca_decided', 'cfa_pending',
    }

    if stage not in _POST_ARB_STAGES:
        return result

    # Stage → which known_outcomes fields are REQUIRED (must be non-null)
    _STAGE_REQUIRED_OUTCOMES: dict[str, list[str]] = {
        'arb_award_done': ['arb_outcome'],
        'challenge_pending': ['arb_outcome'],
        # Indian Domestic
        's34_pending': ['arb_outcome'],
        's34_decided': ['arb_outcome', 's34_outcome'],
        's37_pending': ['arb_outcome', 's34_outcome'],
        's37_decided': ['arb_outcome', 's34_outcome', 's37_outcome'],
        'slp_pending': ['arb_outcome', 's34_outcome', 's37_outcome'],
        # SIAC
        'hc_challenge_pending': ['arb_outcome'],
        'hc_decided': ['arb_outcome', 'hc_outcome'],
        'coa_pending': ['arb_outcome', 'hc_outcome'],
        'coa_decided': ['arb_outcome', 'hc_outcome', 'coa_outcome'],
        # HKIAC
        'cfi_challenge_pending': ['arb_outcome'],
        'cfi_decided': ['arb_outcome', 'cfi_outcome'],
        'ca_pending': ['arb_outcome', 'cfi_outcome'],
        'ca_decided': ['arb_outcome', 'cfi_outcome', 'ca_outcome'],
        'cfa_pending': ['arb_outcome', 'cfi_outcome', 'ca_outcome'],
        # Final
        'enforcement': ['arb_outcome'],
    }

    return {
        'required_fields': _STAGE_REQUIRED_OUTCOMES.get(stage, []),
        'is_post_arb': True,
    }
```

### B4. Update `_JURISDICTION_MAP`

Add HKIAC mapping:

```python
_JURISDICTION_MAP: dict[str, str] = {
    "indian_domestic": "domestic",
    "siac_singapore": "siac",
    "hkiac_hongkong": "hkiac",
    # Direct V2 values pass through
    "domestic": "domestic",
    "siac": "siac",
    "hkiac": "hkiac",
}
```

## Verification

1. Load each jurisdiction template JSON and verify it parses:
   ```python
   import json
   from engine.config.schema import JurisdictionTemplate
   for jur in ['indian_domestic', 'siac_singapore', 'hkiac_hongkong']:
       with open(f'engine/jurisdictions/{jur}.json') as f:
           data = json.load(f)
       print(f'{jur}: {len(data["available_stages"])} stages ✓')
   ```

2. Test derive_pipeline for post-arb stages:
   ```python
   from engine.config.schema import ClaimConfig, KnownOutcomes
   from engine.adapter import derive_pipeline
   # Create minimal claim at s34_pending
   claim = get_default_claim_config('indian_domestic')
   claim.current_stage = 's34_pending'
   claim.known_outcomes = KnownOutcomes(arb_outcome='won')
   pipeline = derive_pipeline(claim)
   assert pipeline == [], f'Expected empty pipeline, got {pipeline}'
   print('✓ post-arb pipeline is empty')
   ```

3. Test derive_known_outcomes_from_stage:
   ```python
   from engine.adapter import derive_known_outcomes_from_stage
   result = derive_known_outcomes_from_stage('s37_pending', 'indian_domestic')
   assert 'arb_outcome' in result['required_fields']
   assert 's34_outcome' in result['required_fields']
   print(f'✓ s37_pending requires: {result["required_fields"]}')
   ```

## DO NOT
- Do NOT touch schema.py (already done in Phase 1).
- Do NOT touch the MC engine files (that's Phase 3).
- Do NOT change the challenge tree definitions in the JSON files.
- Do NOT modify duration/cost values (keep identical across jurisdictions per design decision).
```

---

## PHASE 3 — Monte Carlo Engines (Critical)

### Goal
Modify BOTH MC engines to use `known_outcomes` for forcing arb_won, using a distribution around known_quantum, and partially traversing the challenge tree.

### Attach These Files
```
engine/config/schema.py                  (with Phase 1 changes)
engine/simulation/monte_carlo.py         (full file — NEW engine, you will edit)
engine/v2_core/v2_monte_carlo.py         (full file — V2 engine, you will edit)
engine/models/probability_tree.py        (full file — you will edit)
engine/models/quantum_model.py           (full file — you will edit)
engine/models/timeline_model.py          (full file — read only)
engine/adapter.py                        (with Phase 2 changes — read only)
STAGE_IMPLEMENTATION_PROMPTS.md
```

### Prompt

```
You are implementing Phase 3 of 6 — the MOST CRITICAL phase. This modifies the Monte Carlo simulation engines to correctly handle known legal outcomes.

Phase 1 added `KnownOutcomes` to `ClaimConfig`. Phase 2 updated jurisdiction stage lists and the adapter.

## The Bug Being Fixed

Currently, the MC engine at `engine/simulation/monte_carlo.py` line 170:
```python
arb_won = rng.random() < claim.arbitration.win_probability
```
...draws arb_won RANDOMLY even when the arbitration award is already known (e.g., current_stage = 's34_pending' means the award already exists). With 70% win probability, 30% of MC paths incorrectly simulate a loss for a claim where we KNOW the claimant won. This is a fundamental modeling error.

Similarly in `engine/v2_core/v2_monte_carlo.py` line ~100:
```python
arb_won = rng.random() < MI.ARB_WIN_PROBABILITY
```

## Task A: `engine/models/quantum_model.py` — Add known quantum distribution

Add a NEW function `draw_known_quantum()` that draws quantum from a distribution CENTERED on the known amount, rather than from the standard quantum bands. This reflects that even known awards can change through further legal proceedings.

```python
def draw_known_quantum(
    soc_cr: float,
    known_quantum_pct: float,
    rng: np.random.Generator,
    sigma: float = 0.10,
) -> QuantumResult:
    """Draw quantum centered on a KNOWN award amount.

    When a claim has a known arbitration award, the quantum is not fully
    deterministic — it could still change through court challenges
    (partial set-aside, remand, etc.).  We model this uncertainty as a
    truncated normal distribution centered on the known percentage.

    Parameters
    ----------
    soc_cr : float
        Statement of Claim value in currency Cr.
    known_quantum_pct : float
        Known quantum as fraction of SOC (the award amount / SOC).
    rng : np.random.Generator
    sigma : float
        Standard deviation for the normal distribution (default 0.10 = 10%).
        Controls how much the quantum can vary from the known amount.

    Returns
    -------
    QuantumResult

    Distribution:
        quantum_pct ~ TruncatedNormal(μ=known_quantum_pct, σ=sigma, [0, max(1.5, μ+3σ)])

    The truncation ensures:
      - quantum_pct ≥ 0 (can't be negative)
      - quantum_pct has a reasonable upper bound
      - ~68% of draws fall within ±σ of known_quantum_pct
      - ~95% of draws fall within ±2σ
    """
    # Draw from normal, clip to valid range
    upper_bound = max(1.5, known_quantum_pct + 3 * sigma)
    raw = rng.normal(known_quantum_pct, sigma)
    quantum_pct = float(np.clip(raw, 0.0, upper_bound))
    quantum_cr = soc_cr * quantum_pct

    return QuantumResult(
        band_idx=-2,  # -2 signals "known quantum distribution" (vs -1 for loss)
        quantum_pct=quantum_pct,
        quantum_cr=quantum_cr,
    )
```

## Task B: `engine/models/probability_tree.py` — Add partial tree traversal

Add a NEW function `simulate_challenge_tree_with_known_outcomes()` that starts the traversal at the correct point in the tree when prior nodes are already decided:

```python
def simulate_challenge_tree_with_known_outcomes(
    tree: ScenarioTree,
    known_outcomes: "KnownOutcomes",
    jurisdiction: str,
    rng: np.random.Generator,
    *,
    scenario_label: str = "",
) -> ChallengeResult:
    """Traverse a challenge tree with some nodes already decided.

    For each level of the tree, checks if a known_outcome exists for
    that court stage. If known:
      - Forces the selection to the known branch (no RNG draw)
      - Still draws duration from that node's duration_distribution
    If unknown:
      - Falls back to standard stochastic selection (rng.random())

    Parameters
    ----------
    tree : ScenarioTree
    known_outcomes : KnownOutcomes
        The claim's known outcome record.
    jurisdiction : str
        One of 'domestic', 'siac', 'hkiac' — used to map tree node
        names to known_outcomes fields.
    rng : np.random.Generator
    scenario_label : str

    Returns
    -------
    ChallengeResult
    """
    # Build a mapping from tree node name patterns → known outcome values.
    # This maps what the TREE calls each level to what the known_outcomes field says.
    _KNOWN_MAP = _build_known_outcome_map(known_outcomes, jurisdiction)

    node = tree.root
    path_names: list[str] = []
    stages: list[dict[str, Any]] = []
    total_duration = 0.0
    slp_admitted = False

    while node.children:
        known_selection = _match_known_outcome(node, _KNOWN_MAP)

        if known_selection is not None:
            # ── Known outcome: force this child ──
            selected = known_selection
            u = -1.0  # sentinel: not drawn
        else:
            # ── Unknown: standard stochastic draw ──
            u = rng.random()
            cumulative = 0.0
            selected = None
            for child in node.children:
                cumulative += child.probability
                if u < cumulative:
                    selected = child
                    break
            if selected is None:
                selected = node.children[-1]

        # Draw duration (always stochastic, even for known nodes)
        dur = _draw_duration(selected, rng) if selected.duration_distribution else 0.0
        if dur > 0.0 or selected.duration_distribution:
            stages.append({
                "stage": selected.name,
                "duration": dur,
                "draw": float(u),
                "known": known_selection is not None,
            })
            total_duration += dur

        path_names.append(selected.name)
        if "slp admitted" in selected.name.lower():
            slp_admitted = True

        node = selected

    return ChallengeResult(
        scenario=scenario_label,
        outcome=node.outcome,
        path_description=" → ".join(path_names),
        challenge_duration_months=total_duration,
        stages_traversed=stages,
        slp_admitted=slp_admitted,
    )


def _build_known_outcome_map(
    known_outcomes: "KnownOutcomes",
    jurisdiction: str,
) -> dict[str, str]:
    """Build a mapping from tree node name patterns → forced child selection.

    Returns dict like:
    {
        "S.34": "dismissed"  (maps to the child whose name contains "dismissed")
        "S.37": "wins"       (maps to the child whose name contains "wins", etc.)
    }

    The keys are substrings that appear in tree node PARENT names.
    The values indicate which CHILD to select.
    """
    result = {}

    if jurisdiction == "domestic":
        if known_outcomes.s34_outcome:
            # Tree has children like "S.34 DFCCIL dismissed" and "S.34 DFCCIL wins"
            if known_outcomes.s34_outcome == "claimant_won":
                result["S.34"] = "dismissed"  # respondent's challenge dismissed
            else:
                result["S.34"] = "wins"  # respondent won S.34

        if known_outcomes.s37_outcome:
            if known_outcomes.s37_outcome == "claimant_won":
                result["S.37"] = "dismissed"
            else:
                result["S.37"] = "wins"

        if known_outcomes.slp_gate_outcome:
            if known_outcomes.slp_gate_outcome == "dismissed":
                result["SLP"] = "dismissed"
            else:
                result["SLP"] = "admitted"

        if known_outcomes.slp_merits_outcome:
            if known_outcomes.slp_merits_outcome == "claimant_won":
                result["SLP_MERITS"] = "TATA"  # "SLP TATA wins merits"
            else:
                result["SLP_MERITS"] = "DFCCIL"

    elif jurisdiction == "siac":
        if known_outcomes.hc_outcome:
            if known_outcomes.hc_outcome == "claimant_won":
                result["HC"] = "dismissed"
            else:
                result["HC"] = "set aside"

        if known_outcomes.coa_outcome:
            if known_outcomes.coa_outcome == "claimant_won":
                result["COA"] = "upheld"  # award restored
            else:
                result["COA"] = "dismissed"  # claimant's appeal dismissed

    elif jurisdiction == "hkiac":
        if known_outcomes.cfi_outcome:
            if known_outcomes.cfi_outcome == "claimant_won":
                result["CFI"] = "dismissed"
            else:
                result["CFI"] = "set aside"

        if known_outcomes.ca_outcome:
            if known_outcomes.ca_outcome == "claimant_won":
                result["CA"] = "restored"
            else:
                result["CA"] = "upheld"  # upheld the set-aside

        if known_outcomes.cfa_gate_outcome:
            if known_outcomes.cfa_gate_outcome == "dismissed":
                result["CFA_GATE"] = "refused"
            else:
                result["CFA_GATE"] = "granted"

        if known_outcomes.cfa_merits_outcome:
            if known_outcomes.cfa_merits_outcome == "claimant_won":
                result["CFA_MERITS"] = "claimant"
            else:
                result["CFA_MERITS"] = "respondent"

    return result


def _match_known_outcome(
    parent_node: TreeNode,
    known_map: dict[str, str],
) -> Optional[TreeNode]:
    """Given a parent node and the known outcome map, find the forced child.

    Checks if any key in known_map is a substring of the parent node's name.
    If found, searches children for one whose name contains the corresponding value.
    Returns that child, or None if no match.
    """
    parent_name_upper = parent_node.name.upper()
    for pattern, child_indicator in known_map.items():
        if pattern.upper() in parent_name_upper:
            # Found a match — find the child
            for child in parent_node.children:
                if child_indicator.lower() in child.name.lower():
                    return child
            # If no child matched the indicator, fall through to stochastic
            break
    return None
```

**IMPORTANT**: The `_build_known_outcome_map` and `_match_known_outcome` functions use fuzzy name matching against the tree node names. You MUST verify these match the actual node names in the default trees defined in `defaults.py`. Read the tree definitions carefully. The Indian Domestic tree has nodes named like "S.34 DFCCIL dismissed", "S.34 DFCCIL wins", "S.37 DFCCIL dismissed", "S.37 DFCCIL wins", "SLP dismissed", "SLP admitted", "SLP DFCCIL wins merits", "SLP TATA wins merits".

## Task C: `engine/simulation/monte_carlo.py` — New Engine

Modify `simulate_one_path()` (starts ~line 155) to use known_outcomes:

### C1. After Step 1 (timeline draw, ~line 167), BEFORE Step 2:

```python
    # ── Step 2: Draw arbitration outcome ──
    ko = claim.known_outcomes  # KnownOutcomes object (all None if not set)

    if ko.arb_outcome is not None:
        # FORCED: arb outcome is already known
        arb_won = (ko.arb_outcome == "won")
        # Still consume an RNG draw to maintain reproducibility
        _ = rng.random()
    else:
        arb_won = rng.random() < claim.arbitration.win_probability
```

### C2. Replace Step 3 (quantum draw, ~line 173) with:

```python
    # ── Step 3: Draw quantum (conditional on arb outcome) ──
    quantum_result: Optional[QuantumResult] = None
    if arb_won:
        # Check if we have a known quantum amount
        if ko.known_quantum_pct is not None:
            quantum_result = draw_known_quantum(
                claim.soc_value_cr, ko.known_quantum_pct, rng,
            )
        elif ko.known_quantum_cr is not None:
            # Convert absolute to percentage
            known_pct = ko.known_quantum_cr / claim.soc_value_cr if claim.soc_value_cr > 0 else 0.0
            quantum_result = draw_known_quantum(
                claim.soc_value_cr, known_pct, rng,
            )
        else:
            quantum_result = draw_quantum(claim.soc_value_cr, claim.quantum, rng)
```

### C3. Replace Step 4 (challenge tree, ~line 179) with:

```python
    # ── Step 4: Simulate post-award challenge tree ──
    if arb_won:
        tree = claim.challenge_tree.scenario_a
        scenario_label = "A"
    else:
        tree = claim.challenge_tree.scenario_b
        scenario_label = "B"

    # Use partial traversal if any challenge outcomes are known
    _has_known_challenge = any([
        ko.s34_outcome, ko.s37_outcome, ko.slp_gate_outcome, ko.slp_merits_outcome,
        ko.hc_outcome, ko.coa_outcome,
        ko.cfi_outcome, ko.ca_outcome, ko.cfa_gate_outcome, ko.cfa_merits_outcome,
    ])

    if _has_known_challenge:
        jurisdiction = claim.jurisdiction.replace("indian_", "").replace("_singapore", "").replace("_hongkong", "")
        # Map to engine jurisdiction codes
        _jur_map = {"domestic": "domestic", "siac": "siac", "hkiac": "hkiac",
                     "indian_domestic": "domestic", "siac_singapore": "siac", "hkiac_hongkong": "hkiac"}
        engine_jur = _jur_map.get(claim.jurisdiction, "domestic")

        challenge_result = simulate_challenge_tree_with_known_outcomes(
            tree, ko, engine_jur, rng, scenario_label=scenario_label,
        )
    else:
        challenge_result = simulate_challenge_tree(
            tree, rng, scenario_label=scenario_label,
        )
```

Add the import at the top of the file:
```python
from engine.models.quantum_model import draw_known_quantum
from engine.models.probability_tree import simulate_challenge_tree_with_known_outcomes
```

### C4. Handle `enforcement` stage

When `current_stage == 'enforcement'`, the claim has passed ALL legal stages. The MC engine should skip everything and just compute the collection:

Add this check near the START of `simulate_one_path()`, right after loading claim params:

```python
    # ── Special case: enforcement stage ──
    # All legal proceedings complete — just compute collection
    if claim.current_stage == 'enforcement':
        ko = claim.known_outcomes
        arb_won = (ko.arb_outcome == 'won') if ko.arb_outcome else True
        if arb_won:
            if ko.known_quantum_pct is not None:
                quantum_pct = ko.known_quantum_pct
            elif ko.known_quantum_cr is not None:
                quantum_pct = ko.known_quantum_cr / claim.soc_value_cr if claim.soc_value_cr > 0 else 0.0
            else:
                quantum_pct = claim.quantum.expected_quantum_pct
            quantum_cr = claim.soc_value_cr * quantum_pct
            collected = quantum_cr * claim.claimant_share_pct
        else:
            quantum_pct = 0.0
            quantum_cr = 0.0
            collected = 0.0

        return PathResult(
            outcome="TRUE_WIN" if arb_won else "LOSE",
            quantum_cr=quantum_cr,
            quantum_pct=quantum_pct,
            timeline_months=payment_delay,
            legal_costs_cr=0.0,
            collected_cr=collected,
            challenge_path_id="ENFORCEMENT",
            stages_traversed=["enforcement"],
            band_idx=-3,
            interest_cr=0.0,
        )
```

## Task D: `engine/v2_core/v2_monte_carlo.py` — Legacy V2 Engine

Apply the SAME logic changes to `_simulate_claim_path()`. The V2 engine reads from MI module globals instead of claim objects, so the known_outcomes must come through the adapter.

In `engine/adapter.py`, in `patch_master_inputs_for_claim()`, add a new attribute patch:

```python
    # ── Known outcomes (for post-arb stage handling) ──
    MI.KNOWN_OUTCOMES = claim.known_outcomes if hasattr(claim, 'known_outcomes') else None
```

Then in `_simulate_claim_path()` in `v2_monte_carlo.py`:

```python
    # ── Step 2: Draw arbitration outcome ──
    ko = getattr(MI, 'KNOWN_OUTCOMES', None)
    if ko is not None and ko.arb_outcome is not None:
        arb_won = (ko.arb_outcome == "won")
        _ = rng.random()  # consume draw for reproducibility
    else:
        arb_won = rng.random() < MI.ARB_WIN_PROBABILITY
```

And similar changes for quantum and challenge tree parallel to the new engine.

## Verification

After all changes:

1. Basic import test:
   ```python
   from engine.models.quantum_model import draw_known_quantum
   from engine.models.probability_tree import simulate_challenge_tree_with_known_outcomes
   print('✓ imports OK')
   ```

2. Known quantum distribution test:
   ```python
   import numpy as np
   from engine.models.quantum_model import draw_known_quantum
   rng = np.random.default_rng(42)
   results = [draw_known_quantum(1000.0, 0.85, rng).quantum_pct for _ in range(1000)]
   mean_pct = np.mean(results)
   assert 0.80 < mean_pct < 0.90, f'Expected ~0.85, got {mean_pct}'
   print(f'✓ Known quantum mean={mean_pct:.4f} (expected ~0.85)')
   ```

3. Post-arb claim simulation test:
   ```python
   from engine.config.schema import KnownOutcomes
   from engine.config.defaults import get_default_claim_config
   claim = get_default_claim_config('indian_domestic')
   claim.current_stage = 's34_pending'
   claim.known_outcomes = KnownOutcomes(arb_outcome='won', known_quantum_pct=0.85)
   # simulate... (or at least verify engine accepts this)
   ```

## DO NOT
- Do NOT change schema.py or the jurisdiction JSONs (Phases 1-2).
- Do NOT modify the analytical `compute_tree_probabilities()` function.
- Do NOT change the RNG seed management or path indexing.
- Do NOT implement known_interest_rate (deferred).
```

---

## PHASE 4 — Frontend (App)

### Goal
Update the claim editor UI to show jurisdiction-specific stage dropdowns, conditional outcome fields, known quantum inputs, and HKIAC support.

### Attach These Files
```
app/src/components/claim/ClaimBasicsForm.jsx  (full — you will edit)
app/src/pages/ClaimEditor.jsx                 (full — you will edit)
app/src/store/claimStore.js                   (full — you will edit)
engine/config/schema.py                       (read-only — for field reference)
engine/adapter.py                             (read-only — for derive_known_outcomes_from_stage)
STAGE_IMPLEMENTATION_PROMPTS.md
AGENT_CONTEXT_GUIDE.md
```

### Prompt

```
You are implementing Phase 4 of 6 — Frontend UI changes for the "Jurisdiction-Specific Legal Stages with Known Outcomes" feature.

Phases 1-3 (COMPLETED) added KnownOutcomes to the schema, updated jurisdiction JSONs with ~12 stages each, and modified the MC engines.

## Task A: `app/src/store/claimStore.js`

### A1. Add `known_outcomes` to the default claim template

In `createClaim()` (around line 38-67), add `known_outcomes` to the `claimData` object:

```javascript
known_outcomes: defaults.known_outcomes ?? {
    dab_outcome: null,
    arb_outcome: null,
    known_quantum_cr: null,
    known_quantum_pct: null,
    s34_outcome: null,
    s37_outcome: null,
    slp_gate_outcome: null,
    slp_merits_outcome: null,
    hc_outcome: null,
    coa_outcome: null,
    cfi_outcome: null,
    ca_outcome: null,
    cfa_gate_outcome: null,
    cfa_merits_outcome: null,
},
```

### A2. Add HKIAC currency

Update the currency default logic:
```javascript
currency: defaults.currency ?? (
    jurisdiction === 'siac_singapore' ? 'SGD' :
    jurisdiction === 'hkiac_hongkong' ? 'HKD' :
    'INR'
),
```
(This may already be present — verify before editing.)

## Task B: `app/src/components/claim/ClaimBasicsForm.jsx`

### B1. Add HKIAC to jurisdiction constants

```javascript
const FLAG_EMOJI = { IN: '🇮🇳', SG: '🇸🇬', HK: '🇭🇰' };
const JURISDICTION_LABELS = {
    indian_domestic: '🇮🇳 Indian Domestic Arbitration',
    siac_singapore: '🇸🇬 SIAC Singapore',
    hkiac_hongkong: '🇭🇰 HKIAC Hong Kong',
};
```

### B2. Update the jurisdiction badge

In the jurisdiction display section (~line 73), update the flag lookup:

```javascript
<span className="text-lg">
    {FLAG_EMOJI[
        draft.jurisdiction === 'siac_singapore' ? 'SG' :
        draft.jurisdiction === 'hkiac_hongkong' ? 'HK' : 'IN'
    ]}
</span>
```

### B3. Add Known Outcomes section

After the Current Stage selector and before the Claimant's Share slider, add a conditional section that appears when a post-arb stage is selected:

```jsx
{/* Known Outcomes — shown for post-arbitration stages */}
{draft.current_stage && isPostArbStage(draft.current_stage) && (
    <KnownOutcomesSection
        draft={draft}
        updateField={updateField}
        jurisdiction={draft.jurisdiction}
        currentStage={draft.current_stage}
    />
)}
```

Create a `KnownOutcomesSection` component (either inline or as a separate file `app/src/components/claim/KnownOutcomesSection.jsx`):

```jsx
function KnownOutcomesSection({ draft, updateField, jurisdiction, currentStage }) {
    const ko = draft.known_outcomes || {};
    const updateKO = (field, value) => {
        updateField('known_outcomes', { ...ko, [field]: value || null });
    };

    // Determine which fields to show based on stage and jurisdiction
    const requiredFields = getRequiredOutcomeFields(currentStage, jurisdiction);

    return (
        <div className="col-span-2 space-y-4 p-4 bg-amber-500/5 border border-amber-500/20 rounded-lg">
            <SectionTitle>Known Legal Outcomes</SectionTitle>
            <p className="text-xs text-slate-400 -mt-2">
                Record decisions already made. The simulation will use these instead of random draws.
            </p>

            {/* Arbitration outcome — always shown for post-arb stages */}
            {requiredFields.includes('arb_outcome') && (
                <SelectField
                    label="Arbitration Outcome"
                    value={ko.arb_outcome || ''}
                    onChange={(v) => updateKO('arb_outcome', v)}
                    options={[
                        { value: '', label: '— Select —' },
                        { value: 'won', label: 'Claimant Won' },
                        { value: 'lost', label: 'Claimant Lost' },
                    ]}
                />
            )}

            {/* Known quantum — shown when arb_outcome = 'won' */}
            {ko.arb_outcome === 'won' && (
                <div className="grid grid-cols-2 gap-4">
                    <NumberField
                        label="Known Quantum (₹ Cr)"
                        value={ko.known_quantum_cr}
                        onChange={(v) => updateKO('known_quantum_cr', v === '' ? null : Number(v))}
                        placeholder="e.g. 850"
                        help="Absolute award amount. Used as center of distribution (±10%)."
                    />
                    <NumberField
                        label="Known Quantum (% of SOC)"
                        value={ko.known_quantum_pct != null ? ko.known_quantum_pct * 100 : ''}
                        onChange={(v) => updateKO('known_quantum_pct', v === '' ? null : Number(v) / 100)}
                        placeholder="e.g. 85"
                        help="Award as percentage of SOC. Takes precedence over absolute."
                    />
                </div>
            )}

            {/* Indian Domestic challenge outcomes */}
            {jurisdiction === 'indian_domestic' && requiredFields.includes('s34_outcome') && (
                <SelectField
                    label="S.34 Challenge Result"
                    value={ko.s34_outcome || ''}
                    onChange={(v) => updateKO('s34_outcome', v)}
                    options={[
                        { value: '', label: '— Select —' },
                        { value: 'claimant_won', label: 'Award Upheld (Challenge Dismissed)' },
                        { value: 'respondent_won', label: 'Award Set Aside (Respondent Won)' },
                    ]}
                />
            )}

            {/* S.37 — shown when s34_outcome is set */}
            {jurisdiction === 'indian_domestic' && requiredFields.includes('s37_outcome') && (
                <SelectField
                    label="S.37 Appeal Result"
                    value={ko.s37_outcome || ''}
                    onChange={(v) => updateKO('s37_outcome', v)}
                    options={[
                        { value: '', label: '— Select —' },
                        { value: 'claimant_won', label: 'Award Upheld' },
                        { value: 'respondent_won', label: 'Award Overturned' },
                    ]}
                />
            )}

            {/* SLP — shown for slp-level stages */}
            {jurisdiction === 'indian_domestic' && requiredFields.includes('slp_gate_outcome') && (
                <SelectField
                    label="SLP Gate Decision"
                    value={ko.slp_gate_outcome || ''}
                    onChange={(v) => updateKO('slp_gate_outcome', v)}
                    options={[
                        { value: '', label: '— Select —' },
                        { value: 'dismissed', label: 'SLP Dismissed (Final Win)' },
                        { value: 'admitted', label: 'SLP Admitted (Proceeds to Merits)' },
                    ]}
                />
            )}

            {/* SIAC challenge outcomes */}
            {jurisdiction === 'siac_singapore' && requiredFields.includes('hc_outcome') && (
                <SelectField
                    label="High Court Challenge Result"
                    value={ko.hc_outcome || ''}
                    onChange={(v) => updateKO('hc_outcome', v)}
                    options={[
                        { value: '', label: '— Select —' },
                        { value: 'claimant_won', label: 'Award Upheld' },
                        { value: 'respondent_won', label: 'Award Set Aside' },
                    ]}
                />
            )}

            {jurisdiction === 'siac_singapore' && requiredFields.includes('coa_outcome') && (
                <SelectField
                    label="Court of Appeal Result"
                    value={ko.coa_outcome || ''}
                    onChange={(v) => updateKO('coa_outcome', v)}
                    options={[
                        { value: '', label: '— Select —' },
                        { value: 'claimant_won', label: 'Award Restored' },
                        { value: 'respondent_won', label: 'Set-Aside Upheld' },
                    ]}
                />
            )}

            {/* HKIAC challenge outcomes */}
            {jurisdiction === 'hkiac_hongkong' && requiredFields.includes('cfi_outcome') && (
                <SelectField
                    label="Court of First Instance Result"
                    value={ko.cfi_outcome || ''}
                    onChange={(v) => updateKO('cfi_outcome', v)}
                    options={[
                        { value: '', label: '— Select —' },
                        { value: 'claimant_won', label: 'Award Upheld' },
                        { value: 'respondent_won', label: 'Award Set Aside' },
                    ]}
                />
            )}
            {jurisdiction === 'hkiac_hongkong' && requiredFields.includes('ca_outcome') && (
                <SelectField
                    label="Court of Appeal Result"
                    value={ko.ca_outcome || ''}
                    onChange={(v) => updateKO('ca_outcome', v)}
                    options={[
                        { value: '', label: '— Select —' },
                        { value: 'claimant_won', label: 'Award Restored' },
                        { value: 'respondent_won', label: 'Set-Aside Upheld' },
                    ]}
                />
            )}
            {jurisdiction === 'hkiac_hongkong' && requiredFields.includes('cfa_gate_outcome') && (
                <SelectField
                    label="CFA Leave to Appeal"
                    value={ko.cfa_gate_outcome || ''}
                    onChange={(v) => updateKO('cfa_gate_outcome', v)}
                    options={[
                        { value: '', label: '— Select —' },
                        { value: 'dismissed', label: 'Leave Refused (Final)' },
                        { value: 'admitted', label: 'Leave Granted' },
                    ]}
                />
            )}
        </div>
    );
}
```

### B4. Helper functions

Add these helper functions (can be at the top of ClaimBasicsForm.jsx or in a shared util):

```javascript
const POST_ARB_STAGES = new Set([
    'arb_award_done', 'challenge_pending', 'enforcement',
    's34_pending', 's34_decided', 's37_pending', 's37_decided', 'slp_pending',
    'hc_challenge_pending', 'hc_decided', 'coa_pending', 'coa_decided',
    'cfi_challenge_pending', 'cfi_decided', 'ca_pending', 'ca_decided', 'cfa_pending',
]);

function isPostArbStage(stage) {
    return POST_ARB_STAGES.has(stage);
}

function getRequiredOutcomeFields(stage, jurisdiction) {
    const fields = [];
    if (!isPostArbStage(stage)) return fields;

    fields.push('arb_outcome');

    // Indian Domestic chain
    if (jurisdiction === 'indian_domestic') {
        if (['s34_decided', 's37_pending', 's37_decided', 'slp_pending'].includes(stage)) {
            fields.push('s34_outcome');
        }
        if (['s37_decided', 'slp_pending'].includes(stage)) {
            fields.push('s37_outcome');
        }
        if (stage === 'slp_pending') {
            fields.push('slp_gate_outcome');
        }
    }

    // SIAC chain
    if (jurisdiction === 'siac_singapore') {
        if (['hc_decided', 'coa_pending', 'coa_decided'].includes(stage)) {
            fields.push('hc_outcome');
        }
        if (stage === 'coa_decided') {
            fields.push('coa_outcome');
        }
    }

    // HKIAC chain
    if (jurisdiction === 'hkiac_hongkong') {
        if (['cfi_decided', 'ca_pending', 'ca_decided', 'cfa_pending'].includes(stage)) {
            fields.push('cfi_outcome');
        }
        if (['ca_decided', 'cfa_pending'].includes(stage)) {
            fields.push('ca_outcome');
        }
        if (stage === 'cfa_pending') {
            fields.push('cfa_gate_outcome');
        }
    }

    return fields;
}
```

## Task C: `app/src/pages/ClaimEditor.jsx`

### C1. Update `handleStageChange()`

When the user changes the current_stage to a post-arb stage, auto-reset the known_outcomes fields that are no longer relevant, and preserve ones that are:

```javascript
const handleStageChange = (stageName) => {
    updateField('current_stage', stageName);

    // For post-arb stages, the pipeline is empty (no pre_arb_stages to set)
    const isPostArb = POST_ARB_STAGES.has(stageName);

    if (isPostArb) {
        // Clear pre_arb_stages since we're past arbitration
        updateField('timeline', {
            ...(draft?.timeline || {}),
            pre_arb_stages: [],
        });
        return;
    }

    // For pre-arb stages, build pipeline as before
    const stagePool = template?.available_stages || [];
    if (stagePool.length === 0) return;

    const selected = stagePool.find((s) => s.name === stageName);
    if (!selected) return;

    const pipeline = [selected];
    const afterNames = selected.pipeline_after || [];
    for (const afterName of afterNames) {
        const afterStage = stagePool.find((s) => s.name === afterName);
        if (afterStage) pipeline.push(afterStage);
    }

    const preArbStages = pipeline.map((s) => ({
        name: s.name,
        duration_low: s.duration_low,
        duration_high: s.duration_high,
        legal_cost_low: s.legal_cost_low ?? 0,
        legal_cost_high: s.legal_cost_high ?? 0,
    }));

    updateField('timeline', {
        ...(draft?.timeline || {}),
        pre_arb_stages: preArbStages,
    });

    // Reset known_outcomes when switching to pre-arb stage
    updateField('known_outcomes', {
        dab_outcome: null, arb_outcome: null,
        known_quantum_cr: null, known_quantum_pct: null,
        s34_outcome: null, s37_outcome: null,
        slp_gate_outcome: null, slp_merits_outcome: null,
        hc_outcome: null, coa_outcome: null,
        cfi_outcome: null, ca_outcome: null,
        cfa_gate_outcome: null, cfa_merits_outcome: null,
    });
};
```

### C2. Import POST_ARB_STAGES

Either import from a shared module or define at the top of ClaimEditor.jsx (same set as in ClaimBasicsForm).

## Task D: Add `HKD` to currencies

In `ClaimBasicsForm.jsx`, add HKD:
```javascript
const CURRENCIES = [
    { value: 'INR', label: 'INR (₹)' },
    { value: 'USD', label: 'USD ($)' },
    { value: 'SGD', label: 'SGD (S$)' },
    { value: 'HKD', label: 'HKD (HK$)' },
];

const CURRENCY_SYMBOL = { INR: '₹', USD: '$', SGD: 'S$', HKD: 'HK$' };
```

## Verification

1. Start the app dev server: `cd app && npm run dev`
2. Create a new Indian Domestic claim — verify 13 stages appear in the dropdown
3. Select "Arbitration Award Issued" — verify Known Outcomes section appears
4. Set arb_outcome = "won" — verify known quantum fields appear
5. Select "S.34 Challenge Decided" — verify S.34 outcome field appears
6. Switch to SIAC claim — verify HC/COA fields appear for post-arb stages
7. Switch to HKIAC — verify CFI/CA/CFA fields appear

## DO NOT
- Do NOT modify any Python engine files.
- Do NOT add validation logic to the frontend — validation is in the Pydantic schema.
- Do NOT modify the server API routes (they just pass through JSON).
```

---

## PHASE 5 — Dashboard, Server & Documentation

### Goal
Update the dashboard milestone analysis, ensure server routes handle `known_outcomes`, and update all documentation files.

### Attach These Files
```
dashboard/src/components/MilestoneAnalysis.jsx  (you will edit)
server/routes/claims.js or equivalent           (you will edit if needed)
AGENT_CONTEXT_GUIDE.md                          (you will update)
AGENT_DEVELOPMENT_PLAYBOOK.md                   (you will update)
METHODOLOGY.md (from root)                      (you will update)
README.md                                       (you will update)
STAGE_IMPLEMENTATION_PROMPTS.md                 (read-only reference)
engine/config/schema.py                         (read-only — field reference)
```

### Prompt

```
You are implementing Phase 5 of 6 — Dashboard updates, server verification, and documentation.

Phases 1-4 (COMPLETED) added KnownOutcomes schema, new jurisdiction stages, MC engine changes, and frontend forms.

## Task A: `dashboard/src/components/MilestoneAnalysis.jsx`

Update the stage labels and stage list (around line 40-46):

```javascript
const stages = [
    'pre_dab', 'dab', 'dab_award_done',
    'arb_commenced', 'arb_hearings_ongoing', 'arb_award_done',
    's34_pending', 's37_pending', 'slp_pending',
    'hc_challenge_pending', 'coa_pending',
    'cfi_challenge_pending', 'ca_pending', 'cfa_pending',
    'enforcement',
];

const stageLabels = {
    pre_dab: 'Pre-DAB',
    dab: 'DAB',
    dab_award_done: 'DAB Award',
    arb_commenced: 'Arb Filed',
    arb_hearings_ongoing: 'Arb Hearing',
    arb_award_done: 'Arb Award',
    s34_pending: 'S.34',
    s37_pending: 'S.37',
    slp_pending: 'SLP',
    hc_challenge_pending: 'HC Challenge',
    coa_pending: 'COA',
    cfi_challenge_pending: 'CFI',
    ca_pending: 'CA',
    cfa_pending: 'CFA',
    enforcement: 'Enforcement',
};
```

## Task B: Server Routes

Check the server's claim storage routes (likely `server/routes/claims.js` or `server/routes/api.js`). The server stores claims as JSON blobs in SQLite. Verify that:

1. The server does NOT strip unknown fields from the claim JSON — it should pass through `known_outcomes` transparently.
2. If the server has explicit field whitelisting, add `known_outcomes` to the whitelist.

This is typically a NO-OP because the server stores the full claim JSON, but verify.

## Task C: Documentation Updates

### C1. `AGENT_CONTEXT_GUIDE.md`

Add a new section "### 10. Known Outcomes / Legal Stage Changes" under the "Change Category → Files to Attach" section:

```markdown
### 10. Known Outcomes / Legal Stage Changes

When modifying how legal stages or known outcomes work:

**Always attach:**
- `engine/config/schema.py` — `KnownOutcomes` model, `ClaimConfig.known_outcomes`
- `engine/adapter.py` — `_STAGE_SKIP_MAP`, `derive_pipeline()`, `derive_known_outcomes_from_stage()`
- `engine/simulation/monte_carlo.py` — `simulate_one_path()` (known_outcomes logic)
- `engine/v2_core/v2_monte_carlo.py` — `_simulate_claim_path()` (V2 known_outcomes logic)

**For tree traversal changes:**
- `engine/models/probability_tree.py` — `simulate_challenge_tree_with_known_outcomes()`
- `engine/models/quantum_model.py` — `draw_known_quantum()`

**For frontend stage/outcome changes:**
- `app/src/components/claim/ClaimBasicsForm.jsx` — Stage dropdown, known outcomes section
- `app/src/pages/ClaimEditor.jsx` — `handleStageChange()`

**For jurisdiction template changes:**
- `engine/jurisdictions/indian_domestic.json`
- `engine/jurisdictions/siac_singapore.json`
- `engine/jurisdictions/hkiac_hongkong.json`
```

### C2. `AGENT_DEVELOPMENT_PLAYBOOK.md`

Under "Known Gotchas & Pitfalls", add:

```markdown
### 9. Known Outcomes & Post-Arb Stages

Claims at post-arbitration stages (s34_pending, hc_challenge_pending, etc.) use
`known_outcomes` to FORCE the arb_won draw and partially traverse the challenge tree.

**Key rules:**
- `arb_won` is NEVER drawn randomly when `known_outcomes.arb_outcome` is set
- `known_quantum` uses a TruncatedNormal distribution (NOT deterministic) centered on the known amount
- Challenge tree traversal forces known nodes but draws stochastically for remaining nodes
- The RNG still consumes draws even when outcomes are forced (for seed reproducibility)
- `enforcement` stage bypasses the entire MC pipeline and returns a fixed PathResult
- Post-arb stages return an empty pipeline from `derive_pipeline()` — the MC engine handles everything

**Validation chain:**
KnownOutcomes.s37_outcome requires s34_outcome,
slp_gate_outcome requires s37_outcome,
slp_merits_outcome requires slp_gate_outcome='admitted', etc.
The Pydantic model enforces this at parse time.
```

### C3. `METHODOLOGY.md` (root directory)

Add a section on Known Outcomes modeling:

```markdown
## Known Legal Outcomes

When a claim has progressed past arbitration and court challenges, the system
records known results in the `known_outcomes` field. This fundamentally changes
the Monte Carlo engine's behavior:

### Arbitration Outcome Forcing
When `known_outcomes.arb_outcome` is 'won' or 'lost', the MC engine forces
`arb_won = True/False` instead of drawing from `win_probability`. This eliminates
the 30% error rate that occurs when randomly drawing outcomes for decided awards.

### Known Quantum Distribution
When a quantum amount is known (e.g., an arbitration award of ₹850 Cr against
SOC of ₹1000 Cr = 85%), the engine does NOT use the standard quantum bands.
Instead, it draws from:

$$Q_{pct} \sim \text{TruncatedNormal}(\mu = q_{known}, \sigma = 0.10, [0, \max(1.5, \mu + 3\sigma)])$$

This reflects the reality that even known awards can change through subsequent
legal proceedings (partial set-aside, remand, appellate modification). The σ=0.10
default means:
- 68% of paths fall within ±10% of the known amount
- 95% within ±20%
- The distribution is truncated to prevent negative quantum

### Partial Challenge Tree Traversal
When some court challenges have known outcomes (e.g., S.34 dismissed, S.37 pending),
the tree walker forces the known selections while drawing stochastically for
remaining undecided nodes. Duration draws remain stochastic for all nodes
(even decided ones) to model timing uncertainty.

### Enforcement Stage
Claims at the enforcement stage bypass the entire MC pipeline. All legal proceedings
are complete; the only remaining parameters are payment delay and collection.
```

### C4. `README.md`

Add "Known Outcomes" to the feature list under Project Status.

## Verification

1. Review all modified documentation files for accuracy
2. Start the dashboard and verify MilestoneAnalysis renders with new stage labels
3. Verify server accepts a claim payload with `known_outcomes` field

## DO NOT
- Do NOT modify engine files (Phases 1-3).
- Do NOT modify app frontend files (Phase 4).
```

---

## PHASE 6 — Testing, Integration & Production Deployment

### Goal
Write integration tests, run full end-to-end validation, and deploy to production.

### Attach These Files
```
engine/config/schema.py                   (read-only)
engine/simulation/monte_carlo.py          (read-only)
engine/models/quantum_model.py            (read-only)
engine/models/probability_tree.py         (read-only)
engine/adapter.py                         (read-only)
STAGE_IMPLEMENTATION_PROMPTS.md
AGENT_DEVELOPMENT_PLAYBOOK.md             (deployment section)
deploy/                                   (deployment scripts)
tests/                                    (existing test directory)
```

### Prompt

```
You are implementing Phase 6 of 6 — Testing and production deployment for the "Jurisdiction-Specific Legal Stages with Known Outcomes" feature.

All previous phases (1-5) are COMPLETED. The code is ready for testing and deployment.

## Task A: Integration Tests

Create `tests/test_known_outcomes.py` with comprehensive tests:

```python
"""
tests/test_known_outcomes.py — Integration tests for Known Outcomes feature.

Tests the full pipeline: KnownOutcomes schema → adapter → MC engine.
Verifies that:
  1. KnownOutcomes validates correctly (positive and negative cases)
  2. Post-arb stages produce empty pipelines
  3. MC engine forces arb_won when arb_outcome is set
  4. Known quantum produces distribution centered on known amount
  5. Partial tree traversal forces known nodes
  6. Enforcement stage bypasses MC pipeline
  7. RNG reproducibility is maintained with known outcomes
"""

import numpy as np
import pytest

from engine.config.schema import ClaimConfig, KnownOutcomes
from engine.config.defaults import get_default_claim_config
from engine.adapter import derive_pipeline, derive_known_outcomes_from_stage
from engine.models.quantum_model import draw_known_quantum
from engine.models.probability_tree import simulate_challenge_tree_with_known_outcomes
from engine.simulation.monte_carlo import simulate_one_path


# ============================================================================
# A. Schema Validation Tests
# ============================================================================

class TestKnownOutcomesSchema:
    def test_empty_known_outcomes(self):
        """All-None KnownOutcomes is valid."""
        ko = KnownOutcomes()
        assert ko.arb_outcome is None
        assert ko.known_quantum_cr is None

    def test_arb_won_with_quantum(self):
        """arb_outcome='won' + known_quantum_pct is valid."""
        ko = KnownOutcomes(arb_outcome='won', known_quantum_pct=0.85)
        assert ko.known_quantum_pct == 0.85

    def test_quantum_without_arb_raises(self):
        """known_quantum_cr without arb_outcome should raise."""
        with pytest.raises(ValueError, match="require arb_outcome"):
            KnownOutcomes(known_quantum_cr=850.0)

    def test_sequential_consistency_s37(self):
        """s37_outcome without s34_outcome should raise."""
        with pytest.raises(ValueError, match="s37_outcome requires s34_outcome"):
            KnownOutcomes(arb_outcome='won', s37_outcome='claimant_won')

    def test_slp_requires_admitted(self):
        """slp_merits without slp_gate='admitted' should raise."""
        with pytest.raises(ValueError, match="slp_gate_outcome='admitted'"):
            KnownOutcomes(
                arb_outcome='won',
                s34_outcome='claimant_won',
                s37_outcome='claimant_won',
                slp_gate_outcome='dismissed',
                slp_merits_outcome='claimant_won',
            )

    def test_full_domestic_chain_valid(self):
        """Full Indian Domestic chain is valid."""
        ko = KnownOutcomes(
            arb_outcome='won',
            known_quantum_pct=0.85,
            s34_outcome='claimant_won',
            s37_outcome='claimant_won',
            slp_gate_outcome='dismissed',
        )
        assert ko.s34_outcome == 'claimant_won'

    def test_siac_chain_valid(self):
        """SIAC chain hc→coa is valid."""
        ko = KnownOutcomes(
            arb_outcome='won',
            hc_outcome='claimant_won',
            coa_outcome='claimant_won',
        )
        assert ko.coa_outcome == 'claimant_won'

    def test_hkiac_chain_valid(self):
        """HKIAC chain cfi→ca→cfa is valid."""
        ko = KnownOutcomes(
            arb_outcome='won',
            cfi_outcome='claimant_won',
            ca_outcome='claimant_won',
            cfa_gate_outcome='dismissed',
        )
        assert ko.cfa_gate_outcome == 'dismissed'


# ============================================================================
# B. Pipeline / Adapter Tests
# ============================================================================

class TestPipelineDerivation:
    def test_pre_arb_stage_has_pipeline(self):
        """Pre-arb stages should produce non-empty pipeline."""
        claim = get_default_claim_config('indian_domestic')
        claim.current_stage = 'dab'
        pipeline = derive_pipeline(claim)
        assert 'dab' in pipeline or 'arbitration' in pipeline

    def test_post_arb_stage_empty_pipeline(self):
        """Post-arb stages should produce empty pipeline."""
        claim = get_default_claim_config('indian_domestic')
        claim.current_stage = 's34_pending'
        pipeline = derive_pipeline(claim)
        assert pipeline == []

    def test_enforcement_empty_pipeline(self):
        """Enforcement stage should produce empty pipeline."""
        claim = get_default_claim_config('indian_domestic')
        claim.current_stage = 'enforcement'
        pipeline = derive_pipeline(claim)
        assert pipeline == []

    def test_derive_required_outcomes(self):
        """derive_known_outcomes_from_stage returns correct fields."""
        result = derive_known_outcomes_from_stage('s37_pending', 'indian_domestic')
        assert 'arb_outcome' in result['required_fields']
        assert 's34_outcome' in result['required_fields']


# ============================================================================
# C. Known Quantum Tests
# ============================================================================

class TestKnownQuantum:
    def test_distribution_centered(self):
        """Known quantum draws should center around the known value."""
        rng = np.random.default_rng(42)
        draws = [draw_known_quantum(1000.0, 0.85, rng).quantum_pct for _ in range(5000)]
        mean = np.mean(draws)
        assert 0.82 < mean < 0.88, f"Mean {mean} not centered around 0.85"

    def test_distribution_spread(self):
        """Known quantum should have meaningful variance (not deterministic)."""
        rng = np.random.default_rng(42)
        draws = [draw_known_quantum(1000.0, 0.85, rng).quantum_pct for _ in range(1000)]
        std = np.std(draws)
        assert std > 0.05, f"Std {std} too low — distribution appears deterministic"
        assert std < 0.20, f"Std {std} too high — distribution too spread"

    def test_quantum_non_negative(self):
        """Known quantum should never be negative."""
        rng = np.random.default_rng(42)
        for _ in range(1000):
            result = draw_known_quantum(1000.0, 0.10, rng)  # low quantum, might go negative
            assert result.quantum_pct >= 0.0

    def test_band_idx_marker(self):
        """Known quantum should have band_idx = -2."""
        rng = np.random.default_rng(42)
        result = draw_known_quantum(1000.0, 0.85, rng)
        assert result.band_idx == -2


# ============================================================================
# D. MC Engine Tests (New Engine)
# ============================================================================

class TestMCEngineKnownOutcomes:
    def _make_claim(self, jurisdiction, stage, arb_outcome='won', quantum_pct=0.85):
        """Create a test claim at a post-arb stage with known outcomes."""
        claim = get_default_claim_config(jurisdiction)
        claim.current_stage = stage
        claim.known_outcomes = KnownOutcomes(
            arb_outcome=arb_outcome,
            known_quantum_pct=quantum_pct if arb_outcome == 'won' else None,
        )
        return claim

    def test_forced_arb_won(self):
        """When arb_outcome='won', ALL paths should have arb_won=True."""
        claim = self._make_claim('indian_domestic', 'arb_award_done')
        # Check that no path returns LOSE due to random arb draw
        rng = np.random.default_rng(42)
        from engine.config.defaults import get_default_claim_config
        import json
        with open('engine/jurisdictions/indian_domestic.json') as f:
            template_data = json.load(f)
        from engine.config.schema import JurisdictionTemplate
        template = JurisdictionTemplate(**template_data)

        win_count = 0
        n = 100
        for i in range(n):
            path_rng = np.random.default_rng(42 + i)
            result = simulate_one_path(claim, template, i, 42 + i, path_rng)
            if result.outcome == 'TRUE_WIN':
                win_count += 1
            # With forced arb_won, no path should lose due to arb draw
            # (they can still lose in challenge tree)
        # Win rate should be much higher than 70% × tree_win_rate
        assert win_count > 0, "No wins at all — arb_outcome forcing may not be working"

    def test_forced_arb_lost(self):
        """When arb_outcome='lost', ALL paths should go to scenario B."""
        claim = self._make_claim('indian_domestic', 'arb_award_done', arb_outcome='lost')
        rng = np.random.default_rng(42)
        import json
        with open('engine/jurisdictions/indian_domestic.json') as f:
            template_data = json.load(f)
        from engine.config.schema import JurisdictionTemplate
        template = JurisdictionTemplate(**template_data)

        for i in range(50):
            path_rng = np.random.default_rng(42 + i)
            result = simulate_one_path(claim, template, i, 42 + i, path_rng)
            # Scenario B outcomes: RESTART or LOSE (never TRUE_WIN)
            assert result.outcome in ('RESTART', 'LOSE'), \
                f"Path {i}: outcome={result.outcome} — should never be TRUE_WIN with arb_outcome='lost'"

    def test_enforcement_stage(self):
        """Enforcement stage should bypass MC and return quickly."""
        claim = self._make_claim('indian_domestic', 'enforcement')
        import json
        with open('engine/jurisdictions/indian_domestic.json') as f:
            template_data = json.load(f)
        from engine.config.schema import JurisdictionTemplate
        template = JurisdictionTemplate(**template_data)

        path_rng = np.random.default_rng(42)
        result = simulate_one_path(claim, template, 0, 42, path_rng)
        assert result.outcome == 'TRUE_WIN'
        assert result.quantum_cr > 0
        assert 'enforcement' in result.stages_traversed


# ============================================================================
# E. Reproducibility Test
# ============================================================================

class TestReproducibility:
    def test_same_seed_same_result(self):
        """Same seed should give identical results with known outcomes."""
        claim = get_default_claim_config('indian_domestic')
        claim.current_stage = 's34_pending'
        claim.known_outcomes = KnownOutcomes(arb_outcome='won', known_quantum_pct=0.85)

        import json
        with open('engine/jurisdictions/indian_domestic.json') as f:
            template_data = json.load(f)
        from engine.config.schema import JurisdictionTemplate
        template = JurisdictionTemplate(**template_data)

        results = []
        for _ in range(2):
            path_rng = np.random.default_rng(12345)
            r = simulate_one_path(claim, template, 0, 12345, path_rng)
            results.append(r)

        assert results[0].outcome == results[1].outcome
        assert results[0].quantum_cr == results[1].quantum_cr
        assert results[0].timeline_months == results[1].timeline_months
```

## Task B: Run All Tests

```bash
cd claim-analytics-platform
python -m pytest tests/test_known_outcomes.py -v
```

Fix any failures before proceeding.

## Task C: Run Existing Tests

Ensure no regressions:
```bash
python -m pytest tests/ -v --tb=short
```

## Task D: Manual Integration Test

Run a full simulation with a post-arb claim:

```python
import json
from engine.config.schema import ClaimConfig, KnownOutcomes, JurisdictionTemplate
from engine.config.defaults import get_default_claim_config
from engine.simulation.monte_carlo import simulate_one_path
import numpy as np

# Load template
with open('engine/jurisdictions/indian_domestic.json') as f:
    template = JurisdictionTemplate(**json.load(f))

# Create claim at S.34 pending (we know we won arb, award = 85% of SOC)
claim = get_default_claim_config('indian_domestic')
claim.current_stage = 's34_pending'
claim.known_outcomes = KnownOutcomes(
    arb_outcome='won',
    known_quantum_pct=0.85,
)

# Run 1000 paths
outcomes = {'TRUE_WIN': 0, 'RESTART': 0, 'LOSE': 0}
quantum_values = []
for i in range(1000):
    rng = np.random.default_rng(42 + i)
    result = simulate_one_path(claim, template, i, 42 + i, rng)
    outcomes[result.outcome] += 1
    if result.quantum_cr > 0:
        quantum_values.append(result.quantum_pct)

print(f"Outcomes: {outcomes}")
print(f"Win rate: {outcomes['TRUE_WIN']/1000:.1%}")
print(f"Mean quantum%: {np.mean(quantum_values):.2%}" if quantum_values else "No wins")
print(f"Quantum std: {np.std(quantum_values):.2%}" if quantum_values else "")
# Expected: win rate should be ~60-70% (all arb wins, but challenge tree losses)
# Expected: mean quantum should be ~85% (centered on known amount)
```

## Task E: Production Deployment

Follow the deployment workflow in `DEPLOYMENT_WORKFLOW.md`:

1. Commit all changes:
   ```bash
   git add -A
   git commit -m "feat: jurisdiction-specific legal stages with known outcomes

   - Add KnownOutcomes Pydantic model with 14 outcome fields
   - Expand available_stages to 12-13 per jurisdiction (incl. post-award)
   - MC engines force arb_won when outcome is known (fixes 30% error rate bug)
   - Known quantum uses TruncatedNormal distribution centered on known amount
   - Partial challenge tree traversal for decided court stages
   - Enforcement stage bypasses MC pipeline
   - Frontend: conditional outcome fields, HKIAC support, HKD currency
   - Dashboard: updated stage labels for all jurisdictions
   - Documentation: METHODOLOGY, AGENT_CONTEXT_GUIDE, PLAYBOOK updated"
   ```

2. Push and deploy per standard workflow.

## DO NOT
- Do NOT modify any source files in this phase (only create test files).
- Do NOT skip failing tests — fix the underlying issue.
- Do NOT deploy if any test fails.
```

---

## Quick Reference: File Changes by Phase

| Phase | Files Modified | Files Created |
|-------|---------------|---------------|
| 1 | `engine/config/schema.py`, `engine/config/defaults.py` | — |
| 2 | `engine/adapter.py`, `engine/jurisdictions/*.json` (×3) | — |
| 3 | `engine/simulation/monte_carlo.py`, `engine/v2_core/v2_monte_carlo.py`, `engine/models/probability_tree.py`, `engine/models/quantum_model.py`, `engine/adapter.py` (MI patch) | — |
| 4 | `app/src/store/claimStore.js`, `app/src/components/claim/ClaimBasicsForm.jsx`, `app/src/pages/ClaimEditor.jsx` | `app/src/components/claim/KnownOutcomesSection.jsx` (optional) |
| 5 | `dashboard/src/components/MilestoneAnalysis.jsx`, `AGENT_CONTEXT_GUIDE.md`, `AGENT_DEVELOPMENT_PLAYBOOK.md`, `METHODOLOGY.md`, `README.md` | — |
| 6 | — | `tests/test_known_outcomes.py` |

**Total: ~14 files modified, 1 file created, 1 test file created.**
