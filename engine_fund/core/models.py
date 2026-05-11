import pandas as pd
import numpy as np
from datetime import date
from dateutil.relativedelta import relativedelta
from math import ceil
from typing import Optional, List, Literal

from ..utils.cashflow import USDINR
from .claims import Claim, CaseTimeline, ChallengeStage, ChallengeStageType, simulate_claim_with_timeline, aggregate_claim_outcomes

MIN_INITIAL_COMMITMENT_INR = 200_000_000.0


# Default claims configuration for stochastic generation
DEFAULT_CLAIMS_CONFIG = {
    "average_claims_per_case": 3,
    "claims_per_case_std_dev": 1,
    "min_claims_per_case": 1,
    "max_claims_per_case": 6,
    # Claim quantum is a fraction of total case quantum
    "claim_quantum_distribution": "dirichlet",  # or "equal", "normal"
    "dirichlet_alpha": 2.0,  # Controls concentration of quantum across claims
    # Per-claim probability of success
    "average_prob_success": 0.65,
    "prob_success_std_dev": 0.10,
    # Per-claim duration (months)
    "average_duration": 42,
    "duration_std_dev": 8,
    # Settlement parameters
    "average_settlement_probability": 0.30,
    "settlement_probability_std_dev": 0.10,
    "average_settlement_recovery_pct": 0.50,
    "settlement_recovery_pct_std_dev": 0.10,
    # Dismissal parameters
    "average_dismissal_probability": 0.05,
    "dismissal_probability_std_dev": 0.03,
    "dismissal_stage_months": 12,
    # Timeline configuration
    "timeline_type": "india_section_34_37",  # or "generic_single_appeal", "custom"
    "initiate_challenge_probability": 0.40,
    # Custom timeline stages (used when timeline_type="custom")
    "challenge_stages": [
        {
            "stage_type": "section_34",
            "description": "Section 34: Setting aside application",
            "duration_months": 6,
            "success_probability": 0.15,
            "time_limit_months": 4,
            "discretionary": False,
        },
        {
            "stage_type": "section_37",
            "description": "Section 37: Appeal on questions of law",
            "duration_months": 8,
            "success_probability": 0.20,
            "time_limit_months": 3,
            "discretionary": False,
        },
        {
            "stage_type": "discretionary_appeal",
            "description": "Discretionary Supreme Court appeal",
            "duration_months": 12,
            "success_probability": 0.10,
            "time_limit_months": 0,
            "discretionary": True,
        },
    ],
}

class Investor:
    """Stores all information about a single investor."""

    def __init__(
        self,
        name,
        committed_capital,
        investment_date,
        address="",
        contact="",
        jurisdiction="",
        *,
        management_fee_rate: float | None = None,
        carry_rate: float | None = None,
    ):
        self.investor_id = None
        self.name = name
        self.committed_capital = committed_capital
        self.investment_date = investment_date
        self.address = address
        self.contact = contact
        self.jurisdiction = jurisdiction
        self.management_fee_rate = management_fee_rate
        self.carry_rate = carry_rate

class UnitClass:
    """Defines the rules and fee structure for a class of units (e.g., A1, B)."""

    def __init__(self, class_name, management_fee_rate=0.0, performance_fee_rate=0.0, unit_face_value=100_000.0):
        self.class_name = class_name
        self.management_fee_rate = management_fee_rate
        self.performance_fee_rate = performance_fee_rate  # To be implemented later
        self.unit_face_value = unit_face_value

class UnitHolding:
    """Represents an investor's ownership of a specific number of units of a particular class."""
    def __init__(self, investor, unit_class, number_of_units, unit_price):
        self.investor = investor
        self.unit_class = unit_class
        self.number_of_units = number_of_units
        self.unit_price = unit_price

class Case:
    """Represents a single litigation finance investment with all its unique parameters.
    
    Supports two modeling modes:
    - 'legacy': Case-level parameters (quantum, prob_success, duration) defined top-down
    - 'claims': Case composed of multiple claims with individual parameters and timelines
    """
    def __init__(
        self,
        name,
        start_date,
        case_type='Cost Financing',
        initial_payment_pct=0.10,
        monetisation_multiples=None,
        payout_cap_pct=1.0,
        settlement_quantum_pct=0.5,
        settlement_duration_pct=0.5,
        monthly_base_cost=16666.67 * USDINR,
        excess_cost_threshold=20_000_000 * USDINR,
        excess_cost_rate=0.05,
        payout_multiple=4.0,
        award_ratio=0.30,
        modeling_mode: Literal["legacy", "claims"] = "legacy",
    ):
        # Core & Type Attributes
        self.case_id = None
        self.name = name
        self.start_date = start_date
        self.case_type = case_type
        self.modeling_mode = modeling_mode
        
        # Claims-based mode attributes
        self.claims: List[Claim] = []
        self.case_timeline: Optional[CaseTimeline] = None
        self._claim_outcomes: Optional[List] = None
        
        # Attributes to be generated by the Fund
        self.quantum = None
        self.prob_success = None
        self.original_duration_months = None
        self._settlement_override: bool | None = None
        self.last_settlement_outcome: bool | None = None
        self.last_trial_result: bool | None = None
        self.settlement_probability = 0.5
        # Configurable parameters
        self.settlement_quantum_pct = float(settlement_quantum_pct)
        self.settlement_duration_pct = float(settlement_duration_pct)
        self.payout_cap_pct = float(payout_cap_pct)
        self.initial_payment_pct = float(initial_payment_pct)
        if monetisation_multiples is None:
            self.monetisation_multiples = {1: 1, 2: 2, 3: 3, 4: 4, 5: 5} # Default year-based multiples
        else:
            self.monetisation_multiples = monetisation_multiples
        self.monthly_base_cost = float(monthly_base_cost)
        self.excess_cost_threshold = float(excess_cost_threshold)
        self.excess_cost_rate = float(excess_cost_rate)
        self.payout_multiple = float(payout_multiple)
        self.award_ratio = float(award_ratio)

    def add_claim(self, claim: Claim) -> None:
        """Add a claim to a claims-based case."""
        if self.modeling_mode != "claims":
            raise ValueError("Can only add claims to cases with modeling_mode='claims'")
        self.claims.append(claim)

    def enable_claims_mode_from_legacy(self) -> None:
        """Convert a legacy case into a claims-mode case using its existing parameters.

        This preserves the original quantum, probability of success, and duration by
        wrapping them into a single claim and attaching a generic appeal timeline.
        """
        self.modeling_mode = "claims"
        arbitration_months = max(1, int(self.original_duration_months or 1))

        base_claim = Claim(
            claim_id=f"{self.case_id or 'CASE'}-CLAIM-1",
            description=self.name,
            quantum=float(self.quantum or 0.0),
            prob_success=float(self.prob_success or 0.0),
            duration_months=arbitration_months,
            settlement_probability=float(self.settlement_probability or 0.0),
            dismissal_probability=0.0,
        )

        self.claims = [base_claim]
        self.case_timeline = CaseTimeline.generic_single_appeal(arbitration_months=arbitration_months)
        self._compute_aggregated_case_parameters()
    
    def set_timeline(self, timeline: CaseTimeline) -> None:
        """Set the case timeline for claims-based cases."""
        if self.modeling_mode != "claims":
            raise ValueError("Can only set timeline for cases with modeling_mode='claims'")
        self.case_timeline = timeline
    
    def _compute_aggregated_case_parameters(self) -> None:
        """Compute quantum, prob_success, duration from component claims."""
        if not self.claims or self.case_timeline is None:
            self.quantum = 0
            self.prob_success = 0
            self.original_duration_months = 1
            return
        
        # Sum quantum across all claims
        self.quantum = sum(c.quantum for c in self.claims)
        
        # Weighted average success probability
        total_quantum = self.quantum
        if total_quantum > 0:
            self.prob_success = sum(
                c.prob_success * c.quantum for c in self.claims
            ) / total_quantum
        else:
            self.prob_success = 0.0
        
        # Duration: use the case timeline's arbitration duration
        self.original_duration_months = self.case_timeline.arbitration_end_months

    @property
    def settlement_outcome(self) -> bool | None:
        """Return override if present, otherwise the most recent simulated outcome."""
        if self._settlement_override is not None:
            return self._settlement_override
        return self.last_settlement_outcome

    @settlement_outcome.setter
    def settlement_outcome(self, value: bool | None) -> None:
        self._settlement_override = None if value is None else bool(value)
    
    def get_simulated_outcome_claims(self):
        """Simulates a claims-based case with full arbitration and post-award challenges."""
        if not self.claims or self.case_timeline is None:
            return self.get_simulated_outcome()
        
        # Simulate each claim through the case timeline
        claim_outcomes = []
        max_end_date = self.start_date
        for claim in self.claims:
            outcome, end_date = simulate_claim_with_timeline(
                claim, self.case_timeline, self.start_date
            )
            claim_outcomes.append(outcome)
            max_end_date = max(max_end_date, end_date)
        
        # Aggregate outcomes
        aggregated = aggregate_claim_outcomes(claim_outcomes)
        total_recovery = aggregated["total_recovery"]
        max_duration = aggregated["max_duration_months"]
        
        # Calculate costs
        total_monthly_cost, initial_payment = self.get_case_costs()
        final_investment = (total_monthly_cost * max_duration) + initial_payment
        
        # Determine payout
        uncapped_payout = 0.0
        trial_success = total_recovery > 0
        
        if self.case_type == 'Cost Financing':
            if trial_success:
                payout_from_costs = final_investment * self.payout_multiple
                payout_from_recovery = total_recovery * self.award_ratio
                uncapped_payout = payout_from_costs + payout_from_recovery
            else:
                uncapped_payout = 0.0
        elif self.case_type == 'Monetisation':
            resolution_year = ceil(max_duration / 12)
            monetisation_multiple = self.monetisation_multiples.get(
                resolution_year, max(self.monetisation_multiples.values())
            )
            uncapped_payout = final_investment * (1 + monetisation_multiple)
        
        # Apply payout cap
        if total_recovery > 0:
            capped_recovery = total_recovery * self.payout_cap_pct
            final_payout = min(uncapped_payout, capped_recovery)
        else:
            final_payout = 0.0 if not trial_success else uncapped_payout
        
        # Store outcomes and update state
        self._claim_outcomes = claim_outcomes
        self.last_settlement_outcome = any(o.settlement_occurred for o in claim_outcomes)
        self.last_trial_result = trial_success
        
        return final_payout, total_monthly_cost, max_end_date, initial_payment, final_investment, trial_success
    
    def get_case_costs(self):
        """Helper to calculate the cost structure based on generated parameters."""
        total_excess_cost = (self.quantum - self.excess_cost_threshold) * self.excess_cost_rate
        monthly_excess_cost = total_excess_cost / self.original_duration_months if self.original_duration_months > 0 else 0
        total_monthly_cost = self.monthly_base_cost + max(0, monthly_excess_cost)
        initial_payment = self.quantum * self.initial_payment_pct if self.case_type == 'Monetisation' else 0
        return total_monthly_cost, initial_payment

    def get_simulated_outcome(self):
        """
        Dispatcher: routes to claims-based or legacy simulation based on modeling_mode.
        This is the core of the case-level simulation, handling settlement vs. trial logic.
        Returns:
            - final_payout (float): The total cash returned to the fund.
            - total_monthly_cost (float): The recurring monthly expense for this case.
            - final_end_date (date): The date the case resolves.
            - initial_payment (float): The upfront payment for Monetisation cases.
            - final_investment (float): The total capital invested in the case.
        """
        if self.modeling_mode == "claims":
            return self.get_simulated_outcome_claims()
        else:
            return self._get_simulated_outcome_legacy()
    
    def _get_simulated_outcome_legacy(self):
        """
        Legacy case simulation: determines outcome based on settlement vs. trial logic.
        This preserves the original behavior for backward compatibility.
        """
        case_recovery = 0
        trial_success = None
        total_monthly_cost, initial_payment = self.get_case_costs()

        # Determine final duration and recovery amount based on settlement or trial outcome
        if self._settlement_override is not None:
            did_settle = bool(self._settlement_override)
        else:
            did_settle = bool(np.random.rand() < float(self.settlement_probability))

        if did_settle:
            final_duration = max(1, int(round(self.original_duration_months * self.settlement_duration_pct)))
            case_recovery = self.quantum * self.settlement_quantum_pct
            trial_success = None
        else:
            final_duration = self.original_duration_months
            trial_success = bool(np.random.rand() < self.prob_success)
            case_recovery = self.quantum if trial_success else 0
        
        final_end_date = self.start_date + relativedelta(months=+final_duration)
        final_investment = (total_monthly_cost * final_duration) + initial_payment
        uncapped_payout = 0

        # Payout logic branches based on case type
        if self.case_type == 'Cost Financing':
            if trial_success is False:
                uncapped_payout = 0.0
            else:
                payout_from_costs = final_investment * self.payout_multiple
                payout_from_recovery = case_recovery * self.award_ratio
                uncapped_payout = payout_from_costs + payout_from_recovery
        elif self.case_type == 'Monetisation':
            resolution_year = ceil(final_duration / 12)
            monetisation_multiple = self.monetisation_multiples.get(resolution_year, max(self.monetisation_multiples.values()))
            uncapped_payout = final_investment * (1 + monetisation_multiple)
            
        # Apply the universal payout cap
        if case_recovery > 0:
            capped_recovery = case_recovery * self.payout_cap_pct
            final_payout = min(uncapped_payout, capped_recovery)
        else:
            final_payout = 0.0 if trial_success is False else uncapped_payout

        self.last_settlement_outcome = did_settle
        self.last_trial_result = trial_success

        return final_payout, total_monthly_cost, final_end_date, initial_payment, final_investment, trial_success

class Fund:
    """Manages the portfolio of cases, investors, and defines the fund's overall strategy."""

    def __init__(
        self,
        name,
        committed_capital=60_000_000 * USDINR,
        fund_size=60_000_000 * USDINR,
        capital_reserve=0.10,
        regulatory_concentration_limit=0.25,
        fund_concentration_limit=0.15,
        deployment_limit_tolerance=0.05,
        monetisation_ratio=0.5,
        case_origination_rate=1,
        average_quantum=40_000_000 * USDINR,
        quantum_std_dev=11_679_953 * USDINR,
        average_prob_success=0.65,
        prob_success_std_dev=0.0827,
        average_duration=55.2,
        duration_std_dev=12.56,
        initial_committed_capital=None,
        initial_closing_date: Optional[date] = None,
        final_closing_date: Optional[date] = None,
        fiscal_year_end_month=3,
        fiscal_year_end_day=31,
        audit_base_fee_inr=1_400_000,
        audit_fee_per_case_inr=250_000,
        organizational_costs_inr=8_800_000,
        origination_cost_per_case_inr=1_760_000,
        trustee_fee_monthly_inr=8_333.33,
        compliance_cost_monthly_inr=183_333.33,
        fundraising_cost_inr=8_800_000,
        insurance_cost_monthly_inr=110_000,
        marketing_cost_monthly_inr=366_667.67,
        management_fee_frequency="quarterly",
        management_fee_timing="advance",
        claims_config=None,
    ):
        # Core attributes
        self.name = name
        self.investors = []
        self.unit_classes = {}
        self.unit_holdings = []
        self.investor_counter = 0
        self.portfolio = []
        self.case_counter = 0
        # Closings
        if initial_closing_date is None:
            raise ValueError("Fund requires an initial_closing_date")
        self.initial_closing_date: date = initial_closing_date
        self.final_closing_date: date = (
            final_closing_date if final_closing_date is not None else self.initial_closing_date + relativedelta(months=+24)
        )
        if self.final_closing_date < self.initial_closing_date:
            raise ValueError("Final closing date must be on or after the initial closing date")
        months_to_final = relativedelta(self.final_closing_date, self.initial_closing_date)
        total_months_to_final = months_to_final.years * 12 + months_to_final.months
        if total_months_to_final > 24:
            raise ValueError("Final closing must occur within 24 months of the initial closing")
        # Fund structure and capital
        self.fund_size = fund_size
        self.committed_capital = float(committed_capital)
        default_initial = min(float(committed_capital), float(fund_size)) if fund_size is not None else float(committed_capital)
        self.initial_committed_capital = float(initial_committed_capital) if initial_committed_capital is not None else default_initial
        if self.initial_committed_capital < MIN_INITIAL_COMMITMENT_INR:
            raise ValueError(
                f"Initial committed capital must be at least INR {MIN_INITIAL_COMMITMENT_INR:,.0f}; got {self.initial_committed_capital:,.0f}"
            )
        self.initial_committed_capital = min(self.initial_committed_capital, self.committed_capital)
        self.final_committed_capital = float(self.committed_capital)
        self.capital_reserve = capital_reserve # % of fund size to hold back
        self.regulatory_concentration_limit = regulatory_concentration_limit # Max single investment as % of fund size
        self.fund_concentration_limit = fund_concentration_limit # Stricter internal limit
        self.deployment_limit_tolerance = deployment_limit_tolerance # Target zone for capital deployment
        # Portfolio construction strategy
        self.monetisation_ratio = monetisation_ratio # % of cases that are Monetisation type
        self.case_origination_rate = case_origination_rate # Number of new cases per month
        # Statistical distributions for case parameters
        self.average_quantum = average_quantum
        self.quantum_std_dev = quantum_std_dev
        self.average_prob_success = average_prob_success
        self.prob_success_std_dev = prob_success_std_dev
        self.average_duration = average_duration
        self.duration_std_dev = duration_std_dev
        # Fund expenses
        self.fiscal_year_end_month = fiscal_year_end_month
        self.fiscal_year_end_day = fiscal_year_end_day
        self.audit_base_fee_inr = audit_base_fee_inr
        self.audit_fee_per_case_inr = audit_fee_per_case_inr
        # Fund-level expenses
        self.organizational_costs_inr = organizational_costs_inr
        self.origination_cost_per_case_inr = origination_cost_per_case_inr
        self.trustee_fee_monthly_inr = trustee_fee_monthly_inr
        self.compliance_cost_monthly_inr = compliance_cost_monthly_inr
        self.fundraising_cost_inr = fundraising_cost_inr
        self.insurance_cost_monthly_inr = insurance_cost_monthly_inr
        self.marketing_cost_monthly_inr = marketing_cost_monthly_inr
        self.management_fee_frequency = management_fee_frequency
        self.management_fee_timing = management_fee_timing
        # Claims configuration for claims-based modeling
        self.claims_config = {**DEFAULT_CLAIMS_CONFIG, **(claims_config or {})}

    def set_case_modeling_mode(self, mode: Literal["legacy", "claims"]) -> None:
        """Apply modeling mode to all cases in the portfolio."""
        mode_normalized = str(mode or "legacy").lower()
        for case in self.portfolio:
            if mode_normalized == "claims":
                self._generate_claims_for_case(case)
            else:
                case.modeling_mode = "legacy"
    
    def _build_timeline_from_config(self, arbitration_months: int) -> CaseTimeline:
        """Build a CaseTimeline from the fund's claims_config."""
        cfg = self.claims_config
        timeline_type = cfg.get("timeline_type", "india_section_34_37")
        
        if timeline_type == "india_section_34_37":
            timeline = CaseTimeline.india_section_34_37(arbitration_months=arbitration_months)
        elif timeline_type == "generic_single_appeal":
            timeline = CaseTimeline.generic_single_appeal(arbitration_months=arbitration_months)
        elif timeline_type == "custom":
            # Build custom timeline from config
            stages = []
            for stage_cfg in cfg.get("challenge_stages", []):
                stage_type_str = stage_cfg.get("stage_type", "appeal")
                stage_type = ChallengeStageType(stage_type_str)
                stages.append(ChallengeStage(
                    stage_type=stage_type,
                    description=stage_cfg.get("description", f"{stage_type_str} stage"),
                    duration_months=int(stage_cfg.get("duration_months", 6)),
                    success_probability=float(stage_cfg.get("success_probability", 0.15)),
                    time_limit_months=int(stage_cfg.get("time_limit_months", 3)),
                    discretionary=bool(stage_cfg.get("discretionary", False)),
                    successor_stages=[],
                ))
            timeline = CaseTimeline(
                arbitration_end_months=arbitration_months,
                challenge_stages=stages,
                jurisdiction=cfg.get("jurisdiction", "custom"),
                initiate_challenge_probability=float(cfg.get("initiate_challenge_probability", 0.40)),
            )
        else:
            # Default to India timeline
            timeline = CaseTimeline.india_section_34_37(arbitration_months=arbitration_months)
        
        # Override challenge initiation probability if specified
        if "initiate_challenge_probability" in cfg:
            timeline.initiate_challenge_probability = float(cfg["initiate_challenge_probability"])
        
        return timeline
    
    def _generate_claims_for_case(self, case: Case) -> None:
        """Generate stochastic claims for a case based on claims_config."""
        cfg = self.claims_config
        case.modeling_mode = "claims"
        
        # Determine number of claims
        avg_claims = float(cfg.get("average_claims_per_case", 3))
        claims_std = float(cfg.get("claims_per_case_std_dev", 1))
        min_claims = int(cfg.get("min_claims_per_case", 1))
        max_claims = int(cfg.get("max_claims_per_case", 6))
        
        num_claims = int(round(np.random.normal(avg_claims, claims_std)))
        num_claims = max(min_claims, min(max_claims, num_claims))
        
        # Distribute total quantum across claims
        total_quantum = float(case.quantum or 0.0)
        distribution = cfg.get("claim_quantum_distribution", "dirichlet")
        
        if distribution == "equal":
            quantum_fractions = np.ones(num_claims) / num_claims
        elif distribution == "dirichlet":
            alpha = float(cfg.get("dirichlet_alpha", 2.0))
            quantum_fractions = np.random.dirichlet([alpha] * num_claims)
        else:  # "normal" or default
            raw_fractions = np.abs(np.random.normal(1.0, 0.3, num_claims))
            quantum_fractions = raw_fractions / raw_fractions.sum()
        
        claim_quanta = quantum_fractions * total_quantum
        
        # Generate claims
        claims = []
        for i in range(num_claims):
            # Per-claim probability of success
            avg_prob = float(cfg.get("average_prob_success", 0.65))
            prob_std = float(cfg.get("prob_success_std_dev", 0.10))
            prob_success = np.clip(np.random.normal(avg_prob, prob_std), 0.05, 0.95)
            
            # Per-claim duration
            avg_duration = float(cfg.get("average_duration", 42))
            duration_std = float(cfg.get("duration_std_dev", 8))
            duration_months = max(6, int(round(np.random.normal(avg_duration, duration_std))))
            
            # Settlement parameters
            avg_settle_prob = float(cfg.get("average_settlement_probability", 0.30))
            settle_prob_std = float(cfg.get("settlement_probability_std_dev", 0.10))
            settlement_probability = np.clip(np.random.normal(avg_settle_prob, settle_prob_std), 0.0, 0.8)
            
            avg_settle_recovery = float(cfg.get("average_settlement_recovery_pct", 0.50))
            settle_recovery_std = float(cfg.get("settlement_recovery_pct_std_dev", 0.10))
            settlement_recovery_pct = np.clip(np.random.normal(avg_settle_recovery, settle_recovery_std), 0.2, 0.9)
            
            # Dismissal parameters
            avg_dismiss_prob = float(cfg.get("average_dismissal_probability", 0.05))
            dismiss_prob_std = float(cfg.get("dismissal_probability_std_dev", 0.03))
            dismissal_probability = np.clip(np.random.normal(avg_dismiss_prob, dismiss_prob_std), 0.0, 0.3)
            dismissal_stage_months = int(cfg.get("dismissal_stage_months", 12))
            
            claim = Claim(
                claim_id=f"{case.case_id or 'CASE'}-CLAIM-{i+1}",
                description=f"{case.name} - Claim {i+1}",
                quantum=float(claim_quanta[i]),
                prob_success=float(prob_success),
                duration_months=duration_months,
                settlement_probability=float(settlement_probability),
                settlement_recovery_pct=float(settlement_recovery_pct),
                dismissal_probability=float(dismissal_probability),
                dismissal_stage_months=dismissal_stage_months,
            )
            claims.append(claim)
        
        case.claims = claims
        
        # Build timeline - use max claim duration as arbitration end
        max_duration = max(c.duration_months for c in claims) if claims else int(case.original_duration_months or 36)
        case.case_timeline = self._build_timeline_from_config(max_duration)
        
        # Recompute aggregated parameters
        case._compute_aggregated_case_parameters()
    def _months_between(self, start: date, end: date) -> int:
        delta = relativedelta(end, start)
        return delta.years * 12 + delta.months

    def committed_capital_on(self, when: date) -> float:
        """Return committed capital available as of the month containing ``when``.

        Commitments ramp linearly from the initial committed capital at initial closing
        to the final committed capital by the final closing.
        """
        dt = pd.to_datetime(when).date()
        if dt < self.initial_closing_date:
            return 0.0
        if dt >= self.final_closing_date:
            return float(self.final_committed_capital)

        total_months = max(1, self._months_between(self.initial_closing_date, self.final_closing_date))
        months_elapsed = max(0, self._months_between(self.initial_closing_date, dt))
        ramp_ratio = min(1.0, months_elapsed / total_months)
        incremental = self.final_committed_capital - self.initial_committed_capital
        return float(self.initial_committed_capital + incremental * ramp_ratio)

    def committed_capital_curve(self, dates: pd.DatetimeIndex) -> pd.Series:
        """Return a pandas Series of committed capital values aligned to the provided dates."""
        values = []
        for ts in dates:
            values.append(self.committed_capital_on(ts.date()))
        return pd.Series(values, index=dates, dtype=float)
        
    def add_unit_class(self, unit_class):
        self.unit_classes[unit_class.class_name] = unit_class
    def add_investor(self, investor):
        self.investor_counter += 1
        investor.investor_id = self.investor_counter
        self.investors.append(investor)
    def issue_units(self, investor_name, unit_class_name, committed_amount, unit_price=None):
        investor = next((inv for inv in self.investors if inv.name == investor_name), None)
        unit_class = self.unit_classes.get(unit_class_name)
        if not investor or not unit_class: return
        face_value = unit_price if unit_price is not None else getattr(unit_class, "unit_face_value", 100_000.0)
        if face_value and face_value > 0:
            unit_class.unit_face_value = face_value
        number_of_units = committed_amount / face_value if face_value else 0
        holding = UnitHolding(investor, unit_class, number_of_units, face_value)
        self.unit_holdings.append(holding)
    def get_total_capital_by_class(self, class_name):
        total = 0.0
        for holding in self.unit_holdings:
            if holding.unit_class.class_name != class_name:
                continue
            total += holding.number_of_units * holding.unit_price
        return total
    def _generate_case_properties(self, case):
        """Assigns random properties to a case from the fund's statistical distributions."""
        case.quantum = max(0, np.random.normal(loc=self.average_quantum, scale=self.quantum_std_dev))
        case.prob_success = np.clip(np.random.normal(loc=self.average_prob_success, scale=self.prob_success_std_dev), 0, 1)
        case.original_duration_months = max(1, int(round(np.random.normal(loc=self.average_duration, scale=self.duration_std_dev))))
        case.settlement_probability = 0.5
        case.settlement_outcome = None
        return case
    def generate_portfolio(self, total_cases, fund_start_date):
        """Builds the case portfolio automatically based on the fund's strategic parameters."""
        reg_limit_amount = self.fund_size * self.regulatory_concentration_limit
        fund_limit_amount = self.fund_size * self.fund_concentration_limit
        total_committed_investments = 0.0

        # Ensure origination does not begin before the initial closing
        start_anchor = fund_start_date if fund_start_date >= self.initial_closing_date else self.initial_closing_date
        final_deployment_limit = self.final_committed_capital * (1 - self.capital_reserve)

        month_index = 0
        max_months = max(total_cases * 24, 36)

        while len(self.portfolio) < total_cases and month_index < max_months:
            month_start = start_anchor + relativedelta(months=+month_index)
            committed_capital_now = self.committed_capital_on(month_start)
            deployment_limit_now = committed_capital_now * (1 - self.capital_reserve)
            lower_bound_target = deployment_limit_now * (1 - self.deployment_limit_tolerance)

            # If we've met the final deployment limit after the commitment period, stop trying
            if month_start >= self.final_closing_date and total_committed_investments >= final_deployment_limit:
                break

            # Originate up to case_origination_rate cases in this month if capital allows
            for _ in range(int(self.case_origination_rate)):
                if len(self.portfolio) >= total_cases:
                    break

                # If we are inside tolerance for current month, wait for more commitments
                if total_committed_investments >= lower_bound_target:
                    break

                case_type = 'Monetisation' if np.random.rand() < self.monetisation_ratio else 'Cost Financing'
                temp_case = self._generate_case_properties(
                    Case(name=f"Case {self.case_counter + 1}", start_date=month_start, case_type=case_type)
                )
                total_monthly_cost, initial_payment = temp_case.get_case_costs()
                est_investment = (total_monthly_cost * temp_case.original_duration_months) + initial_payment

                rejection_reason = ""
                if est_investment > reg_limit_amount:
                    rejection_reason = "breaches Regulatory Limit"
                elif est_investment > fund_limit_amount:
                    rejection_reason = "breaches Fund Limit"

                within_capital = (total_committed_investments + est_investment) <= deployment_limit_now

                if not rejection_reason and within_capital:
                    self.case_counter += 1
                    temp_case.case_id = self.case_counter
                    self.portfolio.append(temp_case)
                    total_committed_investments += est_investment

            month_index += 1
