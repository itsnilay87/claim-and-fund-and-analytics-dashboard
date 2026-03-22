"""
engine/models/timeline_model.py — Pipeline duration draws.
===========================================================

For each claim, draw durations for all remaining pipeline stages
(from current_stage to arbitration).  Challenge tree durations are
handled separately by probability_tree.py.

All durations in months.  Never calls np.random.seed().
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from engine.config.schema import ClaimConfig, StageConfig


# ============================================================================
# Result dataclass
# ============================================================================

@dataclass
class TimelineResult:
    """Result of drawing durations for a claim's pre-arbitration pipeline."""

    stage_durations: dict[str, float] = field(default_factory=dict)
    """Per-stage drawn durations in months."""

    total_months: float = 0.0
    """Total pre-arbitration duration (sum of all stage draws)."""


# ============================================================================
# get_remaining_stages
# ============================================================================

def get_remaining_stages(claim: ClaimConfig) -> list[StageConfig]:
    """Return only the stages that haven't been completed yet.

    Given the claim's ``current_stage``, returns the suffix of
    ``claim.timeline.pre_arb_stages`` starting from the stage whose
    name matches ``current_stage``.  If ``current_stage`` is empty or
    not found, all stages are returned (conservative: assume nothing
    completed).

    Parameters
    ----------
    claim : ClaimConfig
        Claim with timeline configuration.

    Returns
    -------
    list[StageConfig] — remaining stages in pipeline order.
    """
    stages = claim.timeline.pre_arb_stages
    if not claim.current_stage:
        return list(stages)

    for i, stage in enumerate(stages):
        if stage.name == claim.current_stage:
            return list(stages[i:])

    # current_stage not found in pipeline — return all stages
    return list(stages)


# ============================================================================
# draw_pipeline_duration
# ============================================================================

def draw_pipeline_duration(
    claim: ClaimConfig,
    rng: np.random.Generator,
) -> tuple[float, dict[str, float]]:
    """Draw durations for all remaining pipeline stages for one claim.

    Parameters
    ----------
    claim : ClaimConfig
        Claim configuration with timeline.pre_arb_stages.
    rng : np.random.Generator

    Returns
    -------
    tuple of (total_pre_arb_months, {stage_name: drawn_duration})

    For each remaining stage, draws Uniform(duration_low, duration_high).
    Stages already completed (before current_stage) are skipped.
    """
    remaining = get_remaining_stages(claim)
    stage_durations: dict[str, float] = {}
    total = 0.0

    for stage in remaining:
        if stage.duration_low == stage.duration_high:
            dur = stage.duration_low
        else:
            dur = float(rng.uniform(stage.duration_low, stage.duration_high))
        stage_durations[stage.name] = dur
        total += dur

    return total, stage_durations
