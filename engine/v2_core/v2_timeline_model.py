"""
TATA_code_v2/v2_timeline_model.py — Pipeline duration draws.
=============================================================

For each claim, draw durations for all remaining pipeline stages
(from current_gate to arbitration). Challenge tree durations are
handled separately by v2_probability_tree.py.

All durations in months. Never calls np.random.seed().
Every random function takes rng: np.random.Generator as final argument.
"""

from __future__ import annotations

import numpy as np

from .v2_config import ClaimConfig, TimelineResult
from . import v2_master_inputs as MI


# ===================================================================
# Stage Duration Draw
# ===================================================================

def _draw_stage_duration(
    claim: ClaimConfig,
    stage: str,
    rng: np.random.Generator,
) -> float:
    """Draw duration for one pipeline stage.

    Parameters
    ----------
    claim : ClaimConfig
        The claim (used for claim-specific stage overrides).
    stage : str
        Pipeline stage name from claim.pipeline.
    rng : np.random.Generator

    Returns
    -------
    float — duration in months.

    Stage-to-distribution mapping:
      "dab"           → Uniform(DAB_DURATION)
      "arbitration"   → Uniform(ARB_DURATION)
      "arb_remaining" → Uniform(ARB_REMAINING_302_5)  [TP-302-5 only]
      "re_referral"   → Uniform(RE_REFERRAL_CTP11_2)  [TP-CTP11-2 only]
      "challenge_tree" → 0.0  (handled by probability tree, not here)
    """
    if stage == "dab":
        return float(rng.uniform(MI.DAB_DURATION["low"], MI.DAB_DURATION["high"]))

    if stage == "arbitration":
        return float(rng.uniform(MI.ARB_DURATION["low"], MI.ARB_DURATION["high"]))

    if stage == "arb_remaining":
        return float(rng.uniform(
            MI.ARB_REMAINING_302_5["low"], MI.ARB_REMAINING_302_5["high"]
        ))

    if stage == "re_referral":
        return float(rng.uniform(
            MI.RE_REFERRAL_CTP11_2["low"], MI.RE_REFERRAL_CTP11_2["high"]
        ))

    if stage == "challenge_tree":
        # Challenge tree duration is computed separately by v2_probability_tree.py
        return 0.0

    raise ValueError(
        f"Unknown pipeline stage '{stage}' for claim {claim.claim_id}"
    )


# ===================================================================
# Full Pipeline Duration Draw
# ===================================================================

def draw_pipeline_duration(
    claim: ClaimConfig,
    rng: np.random.Generator,
) -> TimelineResult:
    """Draw durations for all pipeline stages for one claim.

    Parameters
    ----------
    claim : ClaimConfig
        Claim configuration with pipeline list.
    rng : np.random.Generator

    Returns
    -------
    TimelineResult with per-stage durations and total pre-challenge months.

    The challenge_tree stage returns 0.0 here — its duration is added
    by the MC engine after calling v2_probability_tree.simulate_*_challenge().
    """
    stage_durations: dict[str, float] = {}
    total = 0.0

    for stage in claim.pipeline:
        dur = _draw_stage_duration(claim, stage, rng)

        assert dur >= 0.0, (
            f"{claim.claim_id} stage '{stage}': duration={dur:.4f} < 0"
        )

        stage_durations[stage] = dur
        total += dur

    return TimelineResult(
        stage_durations=stage_durations,
        total_months=total,
    )


# ===================================================================
# Validation: Print expected ranges for all claims
# ===================================================================

def validate_timeline_ranges() -> None:
    """Print expected duration ranges for each claim's pipeline.

    Useful for sanity-checking that pipeline configurations are correct
    and durations fall within reasonable bounds.
    """
    from .v2_config import build_claim_configs

    claims = build_claim_configs()

    print("=" * 70)
    print("TIMELINE VALIDATION — Expected Duration Ranges")
    print("=" * 70)

    for claim in claims:
        low_total = 0.0
        high_total = 0.0
        parts = []

        for stage in claim.pipeline:
            if stage == "dab":
                lo, hi = MI.DAB_DURATION["low"], MI.DAB_DURATION["high"]
            elif stage == "arbitration":
                lo, hi = MI.ARB_DURATION["low"], MI.ARB_DURATION["high"]
            elif stage == "arb_remaining":
                lo, hi = MI.ARB_REMAINING_302_5["low"], MI.ARB_REMAINING_302_5["high"]
            elif stage == "re_referral":
                lo, hi = MI.RE_REFERRAL_CTP11_2["low"], MI.RE_REFERRAL_CTP11_2["high"]
            elif stage == "challenge_tree":
                # Domestic: S.34 + S.37 + SLP = (9+6+4) to (18+12+24)
                # SIAC: HC + COA = 6+6 = 12
                if claim.jurisdiction == "domestic":
                    lo = MI.S34_DURATION["low"] + MI.S37_DURATION["low"] + MI.SLP_DISMISSED_DURATION
                    hi = MI.S34_DURATION["high"] + MI.S37_DURATION["high"] + MI.SLP_ADMITTED_DURATION
                else:
                    lo = MI.SIAC_HC_DURATION + MI.SIAC_COA_DURATION
                    hi = MI.SIAC_HC_DURATION + MI.SIAC_COA_DURATION
            else:
                lo, hi = 0.0, 0.0

            parts.append(f"  {stage}: [{lo:.1f}, {hi:.1f}]")
            low_total += lo
            high_total += hi

        print(f"\n{claim.claim_id} ({claim.jurisdiction}):")
        for p in parts:
            print(p)
        print(f"  TOTAL (excl payment delay): [{low_total:.1f}, {high_total:.1f}] months")

    print("\n" + "=" * 70)


if __name__ == "__main__":
    validate_timeline_ranges()
