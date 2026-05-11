from dataclasses import dataclass
from datetime import date
from typing import Any, Dict, List, Optional, Tuple
from concurrent.futures import ThreadPoolExecutor
import os

import numpy as np
import pandas as pd
from dateutil.relativedelta import relativedelta
from .models import Fund, Case
from .summary_statistics import (
    SUMMARY_METRIC_METADATA,
    summarise_simulation,
    build_summary_statistics,
    build_distribution_payload,
    _month_delta,
)
from ..accounting.bookkeeper import FundBookkeeper
from ..utils.cashflow import GST_RATE


# Default number of parallel workers (None = use cpu_count)
_DEFAULT_MAX_WORKERS: Optional[int] = None


@dataclass
class SimulationResult:
    """Result container for a single simulation run.
    
    Replaces the previous 12-element tuple return to provide:
    - Named attribute access instead of magic indices
    - Type safety and IDE autocomplete support
    - Self-documenting field names
    - Extensibility without breaking callers
    """
    forecast: pd.Series
    monthly_fees: pd.Series
    monthly_gst: pd.Series
    monthly_audit_fees: pd.Series
    sim_case_outcomes: Dict[str, tuple]
    sim_case_cashflows: Dict[str, pd.Series]
    monthly_active_cases: pd.Series
    monthly_committed_capital: pd.Series
    monthly_net_committed_capital: pd.Series
    monthly_status: pd.Series
    commitment_start_date: date
    monthly_fund_expenses: Dict[str, pd.Series]


class CashFlowModel:
    """The engine that runs the Monte Carlo simulation and calculates financial results."""

    def __init__(
        self,
        fund,
        forecast_start_date,
        forecast_horizon_years=10,
        num_simulations=500,
        *,
        alpha_seed: int = 0,
        alpha_label: str = "Alpha",
        parallel: bool = True,
        max_workers: Optional[int] = _DEFAULT_MAX_WORKERS,
    ):
        self.fund = fund
        self.forecast_start_date = forecast_start_date
        self.forecast_end_date = forecast_start_date + relativedelta(years=+forecast_horizon_years)
        self.num_simulations = int(num_simulations)
        self.alpha_seed = int(alpha_seed)
        self.alpha_label = alpha_label
        self.parallel = parallel
        self.max_workers = max_workers
        self.date_index = pd.date_range(self.forecast_start_date, self.forecast_end_date, freq='ME')
        # DataFrames to store simulation results
        self.results = None
        self.final_profits = None
        self.fee_results = None
        self.gst_results = None
        self.simulation_summary: Optional[pd.DataFrame] = None
        self.simulation_statistics: Optional[pd.DataFrame] = None
        self.simulation_distributions: Dict[str, Dict[str, Any]] = {}
        self.metric_metadata: Dict[str, Dict[str, Any]] = SUMMARY_METRIC_METADATA

    def _calculate_audit_fees(self, sim_case_outcomes, fund_start_date):
        """
        Calculates and allocates the annual audit fee for a single simulation run.
        This is a helper method to keep the main simulation loop clean.
        """
        last_resolution_date = max(outcome[2] for outcome in sim_case_outcomes.values()) if sim_case_outcomes else fund_start_date
        ts_fund_start_date = pd.to_datetime(fund_start_date)
        ts_last_resolution_date = pd.to_datetime(last_resolution_date)
        
        audit_fee_allocations = pd.Series(0.0, index=self.date_index)
        fye_dates = [d for d in pd.date_range(ts_fund_start_date, ts_last_resolution_date) if d.month == self.fund.fiscal_year_end_month and d.day == self.fund.fiscal_year_end_day]
        last_fye_date = ts_fund_start_date
        
        # Calculate fee for each full fiscal year
        for fye in fye_dates:
            active_cases = sum(1 for outcome in sim_case_outcomes.values() if pd.to_datetime(outcome[2]) > fye)
            annual_fee_inr = self.fund.audit_base_fee_inr + (active_cases * self.fund.audit_fee_per_case_inr)
            num_months = round((fye - last_fye_date).days / (365.25 / 12))
            num_months = max(1, num_months)
            monthly_fee = annual_fee_inr / num_months
            allocation_period = pd.date_range(start=last_fye_date, end=fye, freq='ME')
            valid_period = allocation_period[allocation_period.isin(audit_fee_allocations.index)]
            audit_fee_allocations.loc[valid_period] += monthly_fee
            last_fye_date = fye
            
        # Calculate fee for the final partial year
        if ts_last_resolution_date > last_fye_date:
            final_fee = self.fund.audit_base_fee_inr
            num_months_final = round((ts_last_resolution_date - last_fye_date).days / (365.25 / 12))
            num_months_final = max(1, num_months_final)
            monthly_final_fee = final_fee / num_months_final
            final_period = pd.date_range(start=last_fye_date, end=ts_last_resolution_date, freq='ME')
            valid_final_period = final_period[final_period.isin(audit_fee_allocations.index)]
            audit_fee_allocations.loc[valid_final_period] += monthly_final_fee
            
        return audit_fee_allocations

    def _run_single_simulation(self, bookkeeper: Optional[FundBookkeeper] = None):
        """Runs one full simulation of the fund's life, returning detailed cash flows."""
        # Initialize monthly data containers
        forecast = pd.Series(0.0, index=self.date_index)
        monthly_fees = pd.Series(0.0, index=self.date_index)
        monthly_gst = pd.Series(0.0, index=self.date_index)
        monthly_trustee_fees = pd.Series(0.0, index=self.date_index)
        monthly_trustee_fee_gst = pd.Series(0.0, index=self.date_index)
        monthly_compliance_costs = pd.Series(0.0, index=self.date_index)
        monthly_insurance_costs = pd.Series(0.0, index=self.date_index)
        monthly_marketing_costs = pd.Series(0.0, index=self.date_index)
        monthly_fundraising_costs = pd.Series(0.0, index=self.date_index)
        monthly_organizational_costs = pd.Series(0.0, index=self.date_index)
        monthly_origination_costs = pd.Series(0.0, index=self.date_index)

        scheduled_events: List[tuple[pd.Timestamp, int, str, dict]] = [] if bookkeeper else []
        schedule_counter = 0

        def schedule_event(event_date: pd.Timestamp, event_type: str, payload: dict) -> None:
            nonlocal schedule_counter
            if not bookkeeper:
                return
            schedule_counter += 1
            scheduled_events.append((pd.to_datetime(event_date), schedule_counter, event_type, payload))
        
        # Determine key dates and fee parameters for this simulation
        fund_start_date = min(c.start_date for c in self.fund.portfolio) if self.fund.portfolio else self.forecast_start_date
        last_origination_date = max(c.start_date for c in self.fund.portfolio) if self.fund.portfolio else self.forecast_start_date

        # Commitment period should start on the first day of the month in which the first case is originated
        first_origination_date = fund_start_date
        commitment_start_date = date(pd.to_datetime(first_origination_date).year, pd.to_datetime(first_origination_date).month, 1)
        commitment_start_month_end = pd.to_datetime(commitment_start_date) + pd.offsets.MonthEnd(0)

        last_orig_month_end = pd.to_datetime(last_origination_date) + pd.offsets.MonthEnd(0)

        unit_class_by_investor = {
            holding.investor.name: holding.unit_class for holding in getattr(self.fund, "unit_holdings", [])
        }
        investor_profiles: List[Dict[str, float | str]] = []
        total_investor_commitment = 0.0
        total_fee_commitment = 0.0
        for investor in self.fund.investors:
            unit_class_obj = unit_class_by_investor.get(investor.name)
            management_rate = investor.management_fee_rate
            if management_rate is None and unit_class_obj is not None:
                management_rate = getattr(unit_class_obj, "management_fee_rate", 0.0)
            if management_rate is None:
                management_rate = 0.0
            if management_rate > 0 and management_rate < 0.20:
                management_rate = management_rate / 100 if management_rate > 1 else management_rate
            carry_rate = investor.carry_rate
            if carry_rate is None and unit_class_obj is not None:
                carry_rate = getattr(unit_class_obj, "performance_fee_rate", 0.0)
            if carry_rate is None:
                carry_rate = 0.0
            commitment = float(investor.committed_capital)
            investor_profiles.append(
                {
                    "name": investor.name,
                    "commitment": commitment,
                    "management_fee_rate": float(management_rate),
                    "carry_rate": float(carry_rate),
                    "unit_class": unit_class_obj.class_name if unit_class_obj else "",
                }
            )
            total_investor_commitment += commitment
            if management_rate and management_rate > 0:
                total_fee_commitment += commitment
        if total_fee_commitment <= 0:
            total_fee_commitment = total_investor_commitment

        raw_fee_frequency = str(getattr(self.fund, "management_fee_frequency", "monthly") or "monthly").strip().lower()
        frequency_aliases = {
            "m": "monthly",
            "monthly": "monthly",
            "month": "monthly",
            "q": "quarterly",
            "quarter": "quarterly",
            "quarterly": "quarterly",
            "semiannual": "semiannual",
            "semi-annual": "semiannual",
            "biannual": "semiannual",
            "annual": "annual",
            "year": "annual",
            "yearly": "annual",
        }
        fee_frequency = frequency_aliases.get(raw_fee_frequency, "monthly")
        periods_per_year_map = {
            "monthly": 12,
            "quarterly": 4,
            "semiannual": 2,
            "annual": 1,
        }
        periods_per_year = periods_per_year_map.get(fee_frequency, 12)
        months_per_period = max(1, 12 // max(1, periods_per_year))

        raw_fee_timing = str(getattr(self.fund, "management_fee_timing", "arrears") or "arrears").strip().lower()
        timing_aliases = {
            "advance": "advance",
            "in_advance": "advance",
            "upfront": "advance",
            "prepaid": "advance",
            "arrears": "arrears",
            "in_arrears": "arrears",
            "postpaid": "arrears",
        }
        fee_timing = timing_aliases.get(raw_fee_timing.replace("-", "_"), "arrears")

        def _is_fee_billing_month(month_end: pd.Timestamp) -> bool:
            if periods_per_year >= 12:
                return True
            month_position = (month_end.month - 1) % months_per_period
            if fee_timing == "advance":
                return month_position == 0
            return month_position == months_per_period - 1
        
        # Prepare containers for per-case cashflows and monthly stats
        sim_case_outcomes = {}
        sim_case_cashflows = {}  # case_id -> Series indexed by date_index
        monthly_active_cases = pd.Series(0, index=self.date_index, dtype=int)
        committed_capital_curve = self.fund.committed_capital_curve(self.date_index)
        monthly_committed_capital = pd.Series(0.0, index=self.date_index)
        monthly_net_committed_capital = pd.Series(0.0, index=self.date_index)
        monthly_status = pd.Series("", index=self.date_index, dtype=object)

        # Get outcomes for all cases in this specific simulation run and initialize case cashflow series
        for case in self.fund.portfolio:
            outcome = case.get_simulated_outcome()
            sim_case_outcomes[case.case_id] = outcome
            sim_case_cashflows[case.case_id] = pd.Series(0.0, index=self.date_index)
        
        last_resolution_date = max(outcome[2] for outcome in sim_case_outcomes.values()) if sim_case_outcomes else self.forecast_start_date
        last_reso_month_end = pd.to_datetime(last_resolution_date) + pd.offsets.MonthEnd(0)

        # Process case cash flows (investments and payouts)
        resolved_investments = {}
        for case in self.fund.portfolio:
            payout, monthly_cost, end_date, initial_payment, final_investment, trial_outcome = sim_case_outcomes[case.case_id]
            case_series = sim_case_cashflows[case.case_id]
            # Map case dates to month-ends to avoid "nearest" picking the prior month
            start_month_end = pd.to_datetime(case.start_date) + pd.offsets.MonthEnd(0)
            end_month_end = pd.to_datetime(end_date) + pd.offsets.MonthEnd(0)

            if start_month_end in forecast.index:
                start_idx = forecast.index.get_loc(start_month_end)
            else:
                start_pos = forecast.index.searchsorted(start_month_end, side="left")
                start_idx = start_pos if start_pos < len(forecast.index) else len(forecast.index) - 1
            start_label = forecast.index[start_idx]

            origination_cost = float(self.fund.origination_cost_per_case_inr)
            if origination_cost > 0:
                forecast.loc[start_label] -= origination_cost
                monthly_origination_costs.loc[start_label] += origination_cost
                schedule_event(
                    start_month_end,
                    "fund_expense",
                    {
                        "account_code": "5100",
                        "amount": origination_cost,
                        "entry_date": start_month_end,
                        "memo": f"Origination cost for {case.name}",
                    },
                )

            # initial payment (Monetisation) -> place in the case's start month-end
            if initial_payment > 0:
                forecast.loc[start_label] -= initial_payment
                case_series.loc[start_label] -= initial_payment
                schedule_event(
                    start_month_end,
                    "case_deployment",
                    {
                        "case_id": case.case_id,
                        "case_name": case.name,
                        "amount": initial_payment,
                        "entry_date": start_month_end,
                        "memo": f"Initial payment for {case.name}",
                    },
                )

            # monthly costs (from start through resolution) using month-ends
            cost_period = pd.date_range(start_month_end, end_month_end, freq='ME')
            for month_end in cost_period:
                if month_end in forecast.index:
                    forecast.loc[month_end] -= monthly_cost
                    case_series.loc[month_end] -= monthly_cost
                    if monthly_cost > 0:
                        schedule_event(
                            month_end,
                            "case_deployment",
                            {
                                "case_id": case.case_id,
                                "case_name": case.name,
                                "amount": monthly_cost,
                                "entry_date": month_end,
                                "memo": f"{case.name} monthly cost",
                            },
                        )

            # payout at resolution -> place in the resolution month-end
            if self.forecast_start_date <= end_date <= self.forecast_end_date:
                if end_month_end in forecast.index:
                    payout_idx = forecast.index.get_loc(end_month_end)
                else:
                    payout_pos = forecast.index.searchsorted(end_month_end, side="left")
                    payout_idx = payout_pos if payout_pos < len(forecast.index) else len(forecast.index)-1
                forecast.iloc[payout_idx] += payout
                case_series.iloc[payout_idx] += payout

                if end_month_end in resolved_investments:
                    resolved_investments[end_month_end].append(final_investment)
                else:
                    resolved_investments[end_month_end] = [final_investment]

            schedule_event(
                end_month_end,
                "case_resolution",
                {
                    "case_id": case.case_id,
                    "case_name": case.name,
                    "payout": payout,
                    "final_investment": final_investment,
                    "entry_date": end_month_end,
                },
            )
        
        # Calculate and deduct audit fees
        monthly_audit_fees = self._calculate_audit_fees(sim_case_outcomes, fund_start_date)
        monthly_audit_fee_gst = monthly_audit_fees * float(GST_RATE)
        forecast -= monthly_audit_fees
        forecast -= monthly_audit_fee_gst

        organizational_recorded = False
        fundraising_recorded = False

        cumulative_returns = 0.0
        # Process monthly fund-level expenses (fees, GST) and update NCC
        net_committed_capital = float(committed_capital_curve.iloc[0]) if not committed_capital_curve.empty else 0.0
        for month_end in self.date_index:
            # reduce NCC for investments resolved in this month (i.e., capital returned)
            if month_end in resolved_investments:
                cumulative_returns += sum(resolved_investments[month_end])

            current_committed_capital = float(committed_capital_curve.get(month_end, self.fund.final_committed_capital))
            net_committed_capital = max(0.0, current_committed_capital - cumulative_returns)
            
            # compute active cases for this month
            active_count = 0
            for case in self.fund.portfolio:
                start_ts = pd.to_datetime(case.start_date)
                end_ts = pd.to_datetime(sim_case_outcomes[case.case_id][2]) + pd.offsets.MonthEnd(0)
                if (month_end >= pd.to_datetime(start_ts)) and (month_end <= end_ts):
                    active_count += 1
            monthly_active_cases.loc[month_end] = active_count
            monthly_net_committed_capital.loc[month_end] = net_committed_capital

            # Determine fund status and fee base
            # Pre-Commitment (before commitment_start), Commitment (fee on committed capital),
            # Harvest (fee on net committed capital) and Closed (no fee)
            if month_end < commitment_start_month_end:
                status = "Pre-Commitment"
            elif month_end <= last_orig_month_end:
                status = "Commitment"
            elif month_end <= last_reso_month_end:
                status = "Harvest"
            else:
                status = "Closed"
            monthly_status.loc[month_end] = status

            if not organizational_recorded and month_end >= commitment_start_month_end:
                org_amount = float(self.fund.organizational_costs_inr)
                if org_amount > 0:
                    forecast.loc[month_end] -= org_amount
                    monthly_organizational_costs.loc[month_end] += org_amount
                    schedule_event(
                        commitment_start_date,
                        "fund_expense",
                        {
                            "account_code": "1710",
                            "amount": org_amount,
                            "entry_date": commitment_start_date,
                            "memo": "Organisational costs",
                        },
                    )
                organizational_recorded = True

            if not fundraising_recorded and month_end >= commitment_start_month_end:
                fundraising_amount = float(self.fund.fundraising_cost_inr)
                if fundraising_amount > 0:
                    forecast.loc[month_end] -= fundraising_amount
                    monthly_fundraising_costs.loc[month_end] += fundraising_amount
                    schedule_event(
                        month_end,
                        "fund_expense",
                        {
                            "account_code": "6500",
                            "amount": fundraising_amount,
                            "entry_date": month_end,
                            "memo": "Fundraising costs",
                        },
                    )
                fundraising_recorded = True

            if status in {"Commitment", "Harvest"}:
                monthly_committed_capital.loc[month_end] = current_committed_capital
            else:
                monthly_committed_capital.loc[month_end] = 0.0

            total_management_fee = 0.0
            total_management_fee_gst = 0.0
            management_fee_allocations: List[Dict[str, float]] = []

            charge_management_fee = status in {"Commitment", "Harvest"} and _is_fee_billing_month(month_end)

            if charge_management_fee:
                net_capital_base = float(net_committed_capital)
                fee_base_denominator = total_fee_commitment if total_fee_commitment > 0 else total_investor_commitment
                for profile in investor_profiles:
                    rate = profile["management_fee_rate"]
                    if rate <= 0:
                        continue
                    if status == "Commitment":
                        share = profile["commitment"] / fee_base_denominator if fee_base_denominator > 0 else 0.0
                        base = float(current_committed_capital) * share
                    else:
                        if fee_base_denominator > 0:
                            share = profile["commitment"] / fee_base_denominator
                        else:
                            share = 0.0
                        base = net_capital_base * share
                    if base <= 0:
                        continue
                    period_rate = rate / max(1, periods_per_year)
                    fee = base * period_rate
                    if fee <= 0:
                        continue
                    fee = round(fee, 2)
                    gst = round(fee * float(GST_RATE), 2)
                    total_management_fee += fee
                    total_management_fee_gst += gst
                    management_fee_allocations.append(
                        {"investor": profile["name"], "fee": fee, "gst": gst}
                    )

            monthly_fees.loc[month_end] = total_management_fee
            monthly_gst.loc[month_end] = total_management_fee_gst
            if (total_management_fee > 0 or total_management_fee_gst > 0) and management_fee_allocations:
                forecast.loc[month_end] -= total_management_fee
                forecast.loc[month_end] -= total_management_fee_gst
                memo = f"Accrue management fee ({status})" if status else "Accrue management fee"
                schedule_event(
                    month_end,
                    "management_fee",
                    {
                        "allocations": management_fee_allocations,
                        "entry_date": month_end,
                        "memo": memo,
                    },
                )

            audit_fee_amount = monthly_audit_fees.get(month_end, 0.0)
            audit_fee_gst = monthly_audit_fee_gst.get(month_end, 0.0)
            if audit_fee_amount > 0 or audit_fee_gst > 0:
                if audit_fee_gst > 0:
                    monthly_audit_fee_gst.loc[month_end] = audit_fee_gst
                schedule_event(
                    month_end,
                    "audit_fee",
                    {
                        "amount": audit_fee_amount,
                        "gst_amount": audit_fee_gst,
                        "entry_date": month_end,
                    },
                )

            if status in {"Commitment", "Harvest"}:
                trustee_fee = float(self.fund.trustee_fee_monthly_inr)
                if trustee_fee > 0:
                    forecast.loc[month_end] -= trustee_fee
                    monthly_trustee_fees.loc[month_end] += trustee_fee
                    trustee_fee_gst = trustee_fee * float(GST_RATE)
                    if trustee_fee_gst > 0:
                        forecast.loc[month_end] -= trustee_fee_gst
                        monthly_trustee_fee_gst.loc[month_end] += trustee_fee_gst
                    schedule_event(
                        month_end,
                        "fund_expense",
                        {
                            "account_code": "6805",
                            "amount": trustee_fee,
                            "gst_amount": trustee_fee_gst,
                            "entry_date": month_end,
                            "memo": "Trustee fees",
                        },
                    )

                compliance_cost = float(self.fund.compliance_cost_monthly_inr)
                if compliance_cost > 0:
                    forecast.loc[month_end] -= compliance_cost
                    monthly_compliance_costs.loc[month_end] += compliance_cost
                    schedule_event(
                        month_end,
                        "fund_expense",
                        {
                            "account_code": "6855",
                            "amount": compliance_cost,
                            "entry_date": month_end,
                            "memo": "Compliance costs",
                        },
                    )

                insurance_cost = float(self.fund.insurance_cost_monthly_inr)
                if insurance_cost > 0:
                    forecast.loc[month_end] -= insurance_cost
                    monthly_insurance_costs.loc[month_end] += insurance_cost
                    schedule_event(
                        month_end,
                        "fund_expense",
                        {
                            "account_code": "6470",
                            "amount": insurance_cost,
                            "entry_date": month_end,
                            "memo": "Insurance expense",
                        },
                    )

                marketing_cost = float(self.fund.marketing_cost_monthly_inr)
                if marketing_cost > 0:
                    forecast.loc[month_end] -= marketing_cost
                    monthly_marketing_costs.loc[month_end] += marketing_cost
                    schedule_event(
                        month_end,
                        "fund_expense",
                        {
                            "account_code": "6940",
                            "amount": marketing_cost,
                            "entry_date": month_end,
                            "memo": "Marketing expense",
                        },
                    )

            if bookkeeper and status in {"Commitment", "Harvest"}:
                schedule_event(
                    month_end,
                    "settle_gst",
                    {
                        "entry_date": month_end,
                    },
                )

            if bookkeeper and status in {"Commitment", "Harvest"} and month_end != last_reso_month_end:
                schedule_event(
                    month_end,
                    "distribute_surplus",
                    {
                        "entry_date": month_end,
                    },
                )

            if bookkeeper and month_end == last_reso_month_end:
                schedule_event(
                    month_end,
                    "close_fund",
                    {
                        "entry_date": month_end,
                    },
                )
            
        if bookkeeper:
            for event_date, _, event_type, payload in sorted(scheduled_events, key=lambda item: (item[0], item[1])):
                if event_type == "case_deployment":
                    bookkeeper.record_case_deployment(**payload)
                elif event_type == "case_resolution":
                    bookkeeper.record_case_resolution(**payload)
                elif event_type == "management_fee":
                    bookkeeper.record_management_fee(**payload)
                elif event_type == "audit_fee":
                    bookkeeper.record_audit_fee(**payload)
                elif event_type == "fund_expense":
                    bookkeeper.record_fund_expense(**payload)
                elif event_type == "settle_gst":
                    bookkeeper.settle_gst_liability(**payload)
                elif event_type == "distribute_surplus":
                    bookkeeper.distribute_surplus(**payload)
                elif event_type == "close_fund":
                    bookkeeper.close_fund(**payload)
            bookkeeper.finalise(self.date_index.max())

        monthly_fund_expenses = {
            "audit_fee": monthly_audit_fees,
            "audit_fee_gst": monthly_audit_fee_gst,
            "trustee_fee": monthly_trustee_fees,
            "trustee_fee_gst": monthly_trustee_fee_gst,
            "compliance_cost": monthly_compliance_costs,
            "insurance_cost": monthly_insurance_costs,
            "marketing_expense": monthly_marketing_costs,
            "fundraising_cost": monthly_fundraising_costs,
            "organizational_cost": monthly_organizational_costs,
            "origination_cost": monthly_origination_costs,
        }

        # Return SimulationResult with named fields for type safety and clarity
        return SimulationResult(
            forecast=forecast,
            monthly_fees=monthly_fees,
            monthly_gst=monthly_gst,
            monthly_audit_fees=monthly_audit_fees,
            sim_case_outcomes=sim_case_outcomes,
            sim_case_cashflows=sim_case_cashflows,
            monthly_active_cases=monthly_active_cases,
            monthly_committed_capital=monthly_committed_capital,
            monthly_net_committed_capital=monthly_net_committed_capital,
            monthly_status=monthly_status,
            commitment_start_date=commitment_start_date,
            monthly_fund_expenses=monthly_fund_expenses,
        )

    def _simulate_once(self, seed: Optional[int], *, bookkeeper: Optional[FundBookkeeper] = None) -> SimulationResult:
        """Seed the RNG (when provided) and execute a single simulation."""

        if seed is not None:
            np.random.seed(seed)
        return self._run_single_simulation(bookkeeper=bookkeeper)

    def run_alpha_simulation(self, *, bookkeeper: Optional[FundBookkeeper] = None) -> SimulationResult:
        """Run the deterministic "Alpha" simulation and return full artefacts."""

        return self._simulate_once(self.alpha_seed, bookkeeper=bookkeeper)

    def _run_simulation_worker(self, sim_index: int) -> Tuple[str, pd.Series, Dict[str, object]]:
        """Worker function for parallel simulation execution.
        
        Args:
            sim_index: The simulation index (used as seed).
            
        Returns:
            Tuple of (label, cumulative_forecast, summary_record).
        """
        result = self._simulate_once(sim_index)
        label = f"Sim {sim_index}"
        cumulative = result.forecast.cumsum()
        summary = summarise_simulation(
            label=label,
            forecast=result.forecast,
            monthly_fees=result.monthly_fees,
            monthly_gst=result.monthly_gst,
            monthly_fund_expenses=result.monthly_fund_expenses,
            sim_case_outcomes=result.sim_case_outcomes,
            monthly_status=result.monthly_status,
            fund=self.fund,
        )
        return label, cumulative, summary

    def run_simulation(self):
        """Runs the main Monte Carlo simulation loop.
        
        Uses parallel execution via ThreadPoolExecutor when self.parallel is True
        and num_simulations > 1. Thread-based parallelism is used because:
        - NumPy releases the GIL during computation
        - No pickling overhead for large pandas objects
        - Shared memory access to Fund object
        """
        print(f"\n[INFO] Running {self.num_simulations} simulations for '{self.fund.name}'...")
        series_by_label: Dict[str, pd.Series] = {}
        summary_records: List[Dict[str, object]] = []

        # Always run alpha simulation first (may use bookkeeper)
        alpha_result = self.run_alpha_simulation()
        series_by_label[self.alpha_label] = alpha_result.forecast.cumsum()
        summary_records.append(
            summarise_simulation(
                label=self.alpha_label,
                forecast=alpha_result.forecast,
                monthly_fees=alpha_result.monthly_fees,
                monthly_gst=alpha_result.monthly_gst,
                monthly_fund_expenses=alpha_result.monthly_fund_expenses,
                sim_case_outcomes=alpha_result.sim_case_outcomes,
                monthly_status=alpha_result.monthly_status,
                fund=self.fund,
            )
        )

        # Run remaining simulations (potentially in parallel)
        remaining_sims = self.num_simulations - 1
        if remaining_sims > 0:
            sim_indices = list(range(1, self.num_simulations))
            
            if self.parallel and remaining_sims > 1:
                # Parallel execution using threads
                # ThreadPoolExecutor is preferred because numpy releases GIL
                workers = self.max_workers or min(remaining_sims, (os.cpu_count() or 4))
                with ThreadPoolExecutor(max_workers=workers) as executor:
                    results = list(executor.map(self._run_simulation_worker, sim_indices))
                
                for label, cumulative, summary in results:
                    series_by_label[label] = cumulative
                    summary_records.append(summary)
            else:
                # Sequential execution
                for sim_index in sim_indices:
                    label, cumulative, summary = self._run_simulation_worker(sim_index)
                    series_by_label[label] = cumulative
                    summary_records.append(summary)

        self.results = pd.DataFrame(series_by_label)
        summary_df = pd.DataFrame(summary_records)
        if not summary_df.empty:
            summary_df = summary_df.reset_index(drop=True)
        self.simulation_summary = summary_df
        self.simulation_statistics = build_summary_statistics(summary_df, self.alpha_label)
        self.simulation_distributions = build_distribution_payload(summary_df, self.alpha_label)
        print("[INFO] Simulation complete.")
