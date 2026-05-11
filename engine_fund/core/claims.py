"""
Claims-based case modeling for arbitration finance.

This module provides the architecture for modeling litigation cases as collections
of claims, each with its own probability of success, duration, and quantum. Cases
also have an internal timeline encompassing the arbitration lifecycle and potential
post-award challenges.
"""

from __future__ import annotations
from dataclasses import dataclass, field
from datetime import date
from typing import Optional, List, Dict, Literal
from dateutil.relativedelta import relativedelta
import numpy as np
from enum import Enum


class ClaimStatus(str, Enum):
    """Status of a claim during case lifecycle."""
    PENDING = "pending"           # Awaiting decision
    DISMISSED = "dismissed"        # Dismissed at procedural stage
    DECIDED_SUCCESS = "decided_success"  # Decided in favor at award
    DECIDED_FAILURE = "decided_failure"  # Decided against at award
    SETTLED = "settled"            # Settled before award
    APPEALED_PENDING = "appealed_pending"  # Under appeal
    APPEAL_UPHELD = "appeal_upheld"        # Appeal upheld
    APPEAL_DISMISSED = "appeal_dismissed"  # Appeal dismissed


class ChallengeStageType(str, Enum):
    """Types of post-award challenge stages (jurisdiction-specific)."""
    SECTION_34 = "section_34"  # India: Setting aside application
    SECTION_37 = "section_37"  # India: Appeal on questions of law
    DISCRETIONARY_APPEAL = "discretionary_appeal"  # India: Supreme Court appeal
    ANNULMENT = "annulment"    # Generic annulment/setting aside
    APPEAL = "appeal"          # Generic appeal


@dataclass
class ChallengeStage:
    """Defines a post-award challenge stage with prescribed timelines and procedural rules."""
    stage_type: ChallengeStageType
    description: str
    duration_months: int
    success_probability: float
    time_limit_months: int  # Time limit to initiate challenge (from award date)
    discretionary: bool = False  # Whether initiating this stage is discretionary
    successor_stages: List[ChallengeStageType] = field(default_factory=list)


@dataclass
class Claim:
    """Represents a single claim within a case."""
    claim_id: str
    description: str
    quantum: float  # Claimed amount
    prob_success: float  # Probability of success at final award
    duration_months: int  # Expected duration to reach award
    settlement_probability: float = 0.5
    settlement_recovery_pct: float = 0.5  # Fraction of quantum recovered on settlement
    
    # State tracking during simulation
    status: ClaimStatus = ClaimStatus.PENDING
    dismissal_probability: float = 0.0  # Probability of dismissal at procedural stage
    dismissal_stage_months: int = 12  # When dismissal decision occurs (if happens)
    
    def __post_init__(self):
        """Validate claim parameters."""
        if not (0 <= self.prob_success <= 1):
            raise ValueError(f"prob_success must be in [0, 1], got {self.prob_success}")
        if not (0 <= self.settlement_probability <= 1):
            raise ValueError(f"settlement_probability must be in [0, 1], got {self.settlement_probability}")
        if self.quantum < 0:
            raise ValueError(f"quantum must be non-negative, got {self.quantum}")
        if self.duration_months < 1:
            raise ValueError(f"duration_months must be >= 1, got {self.duration_months}")


@dataclass
class CaseTimeline:
    """
    Defines the lifecycle of a case encompassing arbitration and post-award challenges.
    
    The timeline consists of:
    1. Arbitration phase: All claims progress toward award decision
    2. Challenge phases: Post-award review and appeal stages (jurisdiction-specific)
    """
    # Arbitration phase
    arbitration_end_months: int  # When the final award is issued
    
    # Challenge phases (ordered)
    challenge_stages: List[ChallengeStage] = field(default_factory=list)
    
    # Configuration
    jurisdiction: str = "india"  # Jurisdiction governing challenge rules
    initiate_challenge_probability: float = 0.5  # Probability of initiating any challenge
    
    @classmethod
    def india_section_34_37(cls, arbitration_months: int) -> CaseTimeline:
        """
        Creates a timeline with India's Arbitration Act challenge sequence:
        - Section 34: Setting aside application (4 months time limit)
        - Section 37: Appeal (3 months time limit)  
        - Discretionary Supreme Court appeal (Depends on NDPS/jurisdiction)
        """
        section_34 = ChallengeStage(
            stage_type=ChallengeStageType.SECTION_34,
            description="Section 34: Setting aside application",
            duration_months=6,
            success_probability=0.15,
            time_limit_months=4,
            discretionary=False,
            successor_stages=[ChallengeStageType.SECTION_37],
        )
        
        section_37 = ChallengeStage(
            stage_type=ChallengeStageType.SECTION_37,
            description="Section 37: Appeal on questions of law",
            duration_months=8,
            success_probability=0.20,
            time_limit_months=3,
            discretionary=False,
            successor_stages=[ChallengeStageType.DISCRETIONARY_APPEAL],
        )
        
        supreme_court = ChallengeStage(
            stage_type=ChallengeStageType.DISCRETIONARY_APPEAL,
            description="Discretionary Supreme Court appeal",
            duration_months=12,
            success_probability=0.10,
            time_limit_months=0,  # No strict time limit, but rare
            discretionary=True,
            successor_stages=[],
        )
        
        return cls(
            arbitration_end_months=arbitration_months,
            challenge_stages=[section_34, section_37, supreme_court],
            jurisdiction="india",
            initiate_challenge_probability=0.40,
        )
    
    @classmethod
    def generic_single_appeal(cls, arbitration_months: int) -> CaseTimeline:
        """Creates a simple timeline with a single appeal stage."""
        appeal = ChallengeStage(
            stage_type=ChallengeStageType.APPEAL,
            description="Generic appeal stage",
            duration_months=6,
            success_probability=0.15,
            time_limit_months=3,
            discretionary=False,
            successor_stages=[],
        )
        
        return cls(
            arbitration_end_months=arbitration_months,
            challenge_stages=[appeal],
            jurisdiction="generic",
            initiate_challenge_probability=0.30,
        )


class ClaimOutcome:
    """Result of simulating a single claim through the case timeline."""
    
    def __init__(self, claim: Claim):
        self.claim = claim
        self.final_status: ClaimStatus = ClaimStatus.PENDING
        self.final_recovery: float = 0.0
        self.total_duration_months: int = 0
        self.settlement_occurred: bool = False
        self.appeal_initiated: bool = False
        self.appeal_succeeded: bool = False
    
    def __repr__(self) -> str:
        return (
            f"ClaimOutcome(claim_id={self.claim.claim_id}, "
            f"status={self.final_status}, "
            f"recovery={self.final_recovery:.0f}, "
            f"duration={self.total_duration_months}m)"
        )


def simulate_claim_with_timeline(
    claim: Claim,
    timeline: CaseTimeline,
    start_date: date,
) -> tuple[ClaimOutcome, date]:
    """
    Simulates a single claim through the full case timeline.
    
    Args:
        claim: The claim to simulate
        timeline: The case's timeline (arbitration + challenges)
        start_date: Start date of the case
    
    Returns:
        (ClaimOutcome, final_resolution_date)
    """
    outcome = ClaimOutcome(claim)
    current_date = start_date
    
    # Phase 1: Check for dismissal at procedural stage
    if claim.dismissal_probability > 0:
        if np.random.rand() < claim.dismissal_probability:
            outcome.final_status = ClaimStatus.DISMISSED
            outcome.final_recovery = 0.0
            outcome.total_duration_months = claim.dismissal_stage_months
            return outcome, current_date + relativedelta(months=+claim.dismissal_stage_months)
    
    # Phase 2: Settlement check before award
    if np.random.rand() < claim.settlement_probability:
        outcome.final_status = ClaimStatus.SETTLED
        # Settlement typically recovers a fraction of quantum
        outcome.final_recovery = claim.quantum * claim.settlement_recovery_pct
        outcome.settlement_occurred = True
        outcome.total_duration_months = int(timeline.arbitration_end_months * 0.6)
        return outcome, current_date + relativedelta(months=+outcome.total_duration_months)
    
    # Phase 3: Proceed to award decision
    outcome.total_duration_months = timeline.arbitration_end_months
    current_date += relativedelta(months=+timeline.arbitration_end_months)
    
    trial_success = np.random.rand() < claim.prob_success
    if trial_success:
        outcome.final_status = ClaimStatus.DECIDED_SUCCESS
        outcome.final_recovery = claim.quantum
    else:
        outcome.final_status = ClaimStatus.DECIDED_FAILURE
        outcome.final_recovery = 0.0
        return outcome, current_date
    
    # Phase 4: Post-award challenges (if award was successful and challenge initiated)
    if trial_success and timeline.challenge_stages:
        if np.random.rand() < timeline.initiate_challenge_probability:
            outcome.appeal_initiated = True
            challenge_elapsed = 0
            
            for stage in timeline.challenge_stages:
                # Check if initiating this challenge is discretionary and party chooses not to
                if stage.discretionary and np.random.rand() > 0.5:
                    break
                
                # Simulate challenge outcome
                challenge_elapsed += stage.duration_months
                if np.random.rand() < stage.success_probability:
                    # Challenge succeeded: reverse the award
                    outcome.final_status = ClaimStatus.APPEAL_UPHELD
                    outcome.final_recovery = 0.0
                    outcome.appeal_succeeded = True
                    break
                else:
                    # Challenge failed, award stands
                    outcome.final_status = ClaimStatus.APPEAL_DISMISSED
            
            outcome.total_duration_months += challenge_elapsed
            current_date += relativedelta(months=+challenge_elapsed)
    
    return outcome, current_date


def aggregate_claim_outcomes(
    outcomes: List[ClaimOutcome],
) -> Dict[str, float]:
    """
    Aggregates multiple claim outcomes to case-level metrics.
    
    Args:
        outcomes: List of ClaimOutcome objects
    
    Returns:
        Dictionary with aggregated metrics (total_recovery, num_dismissed, etc.)
    """
    if not outcomes:
        return {
            "total_recovery": 0.0,
            "num_successful": 0,
            "num_dismissed": 0,
            "num_settled": 0,
            "num_appealed": 0,
            "max_duration_months": 0,
        }
    
    total_recovery = sum(o.final_recovery for o in outcomes)
    num_successful = sum(1 for o in outcomes if o.final_status == ClaimStatus.DECIDED_SUCCESS)
    num_dismissed = sum(1 for o in outcomes if o.final_status == ClaimStatus.DISMISSED)
    num_settled = sum(1 for o in outcomes if o.settlement_occurred)
    num_appealed = sum(1 for o in outcomes if o.appeal_initiated)
    max_duration = max((o.total_duration_months for o in outcomes), default=0)
    
    return {
        "total_recovery": total_recovery,
        "num_successful": num_successful,
        "num_dismissed": num_dismissed,
        "num_settled": num_settled,
        "num_appealed": num_appealed,
        "max_duration_months": max_duration,
    }
