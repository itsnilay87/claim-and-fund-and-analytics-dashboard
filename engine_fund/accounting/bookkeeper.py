"""Fund accounting integration helpers."""

from __future__ import annotations

from collections import defaultdict
from datetime import date
from decimal import Decimal, ROUND_HALF_UP, InvalidOperation, localcontext
from typing import Dict, List, Optional

import pandas as pd

from .allocator import ProRataAllocator
from .carried_interest import CarriedInterestCalculator
from .chart_of_accounts import ChartOfAccounts
from .exporter import BookkeeperExporter
from .journal import JournalEntry, JournalEntryLine
from .ledger import Ledger
from .models import InvestorState, OrganizationalCostSchedule
from .postings import (
    create_audit_fee_entry,
    create_case_deployment_entry,
    create_case_recovery_entry,
    create_distribution_entry,
    create_drawdown_entry,
    create_fund_expense_entry,
    create_management_fee_entry,
    create_write_off_entry,
    create_carried_interest_accrual,
    create_carried_interest_distribution,
)
from .utils import CENT, TOLERANCE, ZERO, to_decimal, normalize_date, month_start, add_months

# Fund-specific constants
CARRY_RATE = Decimal("0.20")
FUND_CLOSURE_EXPENSE = Decimal("880000")
SPONSOR_MIN_COMMITMENT_ABSOLUTE = Decimal("50000000")
SPONSOR_MIN_COMMITMENT_PCT = Decimal("0.025")


class FundBookkeeper:
    """Coordinates journal postings for fund activity."""

    def __init__(
        self,
        fund,
        *,
        chart: Optional[ChartOfAccounts] = None,
        currency: str = "USD",
        cash_account: Optional[str] = None,
        cash_buffer: float | Decimal = 0,
    ) -> None:
        self.fund = fund
        self.chart = chart or ChartOfAccounts.load_default()
        self.ledger = Ledger(self.chart)
        self.currency = currency
        self.cash_account = cash_account or self._resolve_cash_account()
        self.cash_buffer = to_decimal(cash_buffer)

        self._case_investments: Dict[int, Decimal] = defaultdict(Decimal)
        self._reference_counters: Dict[str, int] = defaultdict(int)
        holdings_by_investor: Dict[str, Dict[str, object]] = defaultdict(
            lambda: {"unit_class": "", "unit_price": None, "units": Decimal("0")}
        )
        for holding in getattr(fund, "unit_holdings", []):
            info = holdings_by_investor[holding.investor.name]
            info["unit_class"] = holding.unit_class.class_name
            unit_price_value = getattr(holding, "unit_price", None)
            if unit_price_value is None:
                unit_price_value = getattr(holding.unit_class, "unit_face_value", None)
            if unit_price_value is not None:
                info["unit_price"] = unit_price_value
            units_value = getattr(holding, "number_of_units", 0)
            if isinstance(units_value, Decimal):
                info["units"] = info["units"] + units_value
            else:
                info["units"] = info["units"] + Decimal(str(units_value))

        self._investors: List[InvestorState] = []
        for inv in fund.investors:
            metadata = holdings_by_investor.get(inv.name, {})
            unit_class = metadata.get("unit_class", "")
            unit_price_value = metadata.get("unit_price")
            if unit_price_value is None and unit_class and unit_class in fund.unit_classes:
                unit_price_value = getattr(fund.unit_classes[unit_class], "unit_face_value", None)
            if unit_price_value is None:
                unit_price_value = Decimal("100000")
            unit_price_decimal = to_decimal(unit_price_value)
            units_value = metadata.get("units", Decimal("0"))
            if not isinstance(units_value, Decimal):
                units_value = Decimal(str(units_value))
            unit_class_obj = fund.unit_classes.get(unit_class) if unit_class else None
            if inv.management_fee_rate is not None:
                management_rate_value = Decimal(str(inv.management_fee_rate))
            elif unit_class_obj is not None and getattr(unit_class_obj, "management_fee_rate", None) is not None:
                management_rate_value = Decimal(str(unit_class_obj.management_fee_rate))
            else:
                management_rate_value = ZERO
            if inv.carry_rate is not None:
                carry_rate_value = Decimal(str(inv.carry_rate))
            elif unit_class_obj is not None and getattr(unit_class_obj, "performance_fee_rate", None) is not None:
                carry_rate_value = Decimal(str(unit_class_obj.performance_fee_rate))
            elif (unit_class or "").upper() != "B":
                carry_rate_value = CARRY_RATE
            else:
                carry_rate_value = ZERO
            investor_state = InvestorState(
                name=inv.name,
                commitment=to_decimal(inv.committed_capital),
                unit_class=unit_class,
                unit_price=unit_price_decimal,
                units=units_value,
                management_fee_rate=management_rate_value,
                carry_rate=carry_rate_value,
            )
            self._investors.append(investor_state)

        self._total_commitment: Decimal = sum((inv.commitment for inv in self._investors), start=ZERO)
        self._class_commitments: Dict[str, Decimal] = defaultdict(Decimal)
        for investor in self._investors:
            key = investor.unit_class or "UNSPECIFIED"
            self._class_commitments[key] = self._class_commitments[key] + investor.commitment

        self._investor_lookup: Dict[str, InvestorState] = {investor.name: investor for investor in self._investors}

        self._validate_sponsor_commitment()

        self._entry_sequence = 0
        self._investor_events: List[Dict[str, object]] = []
        self._lp_surplus_distributed: Decimal = ZERO

        self._organizational_amortisations: List[OrganizationalCostSchedule] = []

        # Allocator for pro-rata capital flow distribution
        self._allocator = ProRataAllocator()

        # Carried interest calculator with callbacks
        self._carry_calculator = CarriedInterestCalculator(
            chart=self.chart,
            ledger=self.ledger,
            investors=self._investors,
            post_entry_callback=self._post_entry,
            next_reference_callback=self._next_reference,
            record_event_callback=self._record_investor_event,
        )

        # Exporter for DataFrame exports
        self._exporter = BookkeeperExporter(self)

        self._post_initial_commitments()

    def _validate_sponsor_commitment(self) -> None:
        if self._total_commitment <= ZERO:
            return

        sponsor_commitment = self._class_commitments.get("B", ZERO)
        minimum_by_percent = (self._total_commitment * SPONSOR_MIN_COMMITMENT_PCT).quantize(
            CENT,
            rounding=ROUND_HALF_UP,
        )
        required_commitment = min(SPONSOR_MIN_COMMITMENT_ABSOLUTE, minimum_by_percent)
        if required_commitment <= ZERO:
            return
        if sponsor_commitment >= required_commitment:
            return
        raise ValueError(
            "Sponsor commitments below required minimum: "
            f"expected >= {required_commitment}, found {sponsor_commitment}"
        )

    # ------------------------------------------------------------------
    # Public export helpers (delegated to BookkeeperExporter)
    # ------------------------------------------------------------------

    def export_ledger_lines(self) -> pd.DataFrame:
        """Return posted journal lines as a DataFrame."""
        return self._exporter.export_ledger_lines()

    def export_trial_balance(self) -> pd.DataFrame:
        """Return the current trial balance as a DataFrame."""
        return self._exporter.export_trial_balance()

    def export_capital_accounts(self) -> pd.DataFrame:
        """Summarise investor capital activity."""
        return self._exporter.export_capital_accounts()

    def export_investor_subledger(self) -> pd.DataFrame:
        """Return detailed investor-level activity suitable for diagnostics exports."""
        return self._exporter.export_investor_subledger()

    # ------------------------------------------------------------------
    # Event handlers (drawdowns, distributions, investments, fees)
    # ------------------------------------------------------------------

    def record_case_deployment(
        self,
        *,
        case_id: int,
        case_name: str,
        amount: float | Decimal,
        entry_date: date | pd.Timestamp,
        memo: Optional[str] = None,
    ) -> None:
        value = to_decimal(amount)
        if value <= Decimal("0"):
            return
        entry = create_case_deployment_entry(
            chart=self.chart,
            case_name=case_name,
            amount=value,
            entry_date=normalize_date(entry_date),
            memo=memo,
            currency=self.currency,
        )
        entry.reference = entry.reference or self._next_reference(f"case_deployment:{case_id}")
        self._post_entry("case_deployment", entry)
        self._case_investments[case_id] = self._case_investments[case_id] + value
        self._ensure_positive_cash(entry.entry_date, source="investment")

    def record_case_resolution(
        self,
        *,
        case_id: int,
        case_name: str,
        payout: float | Decimal,
        final_investment: float | Decimal,
        entry_date: date | pd.Timestamp,
    ) -> None:
        resolution_date = normalize_date(entry_date)
        payout_value = to_decimal(payout)
        final_value = to_decimal(final_investment)

        outstanding = self._case_investments.get(case_id, Decimal("0"))
        if final_value > outstanding:
            outstanding = final_value
        capital_return = min(outstanding, payout_value)
        gain_amount = payout_value - capital_return

        if capital_return > Decimal("0") or gain_amount > Decimal("0"):
            entry = create_case_recovery_entry(
                chart=self.chart,
                case_name=case_name,
                capital_return=capital_return,
                gain_amount=gain_amount,
                entry_date=resolution_date,
                currency=self.currency,
            )
            entry.reference = entry.reference or self._next_reference(f"case_recovery:{case_id}")
            self._post_entry("case_recovery", entry)

        outstanding -= capital_return
        if outstanding > TOLERANCE:
            write_off_entry = create_write_off_entry(
                chart=self.chart,
                case_name=case_name,
                amount=outstanding,
                entry_date=resolution_date,
            )
            write_off_entry.reference = write_off_entry.reference or self._next_reference(
                f"case_write_off:{case_id}"
            )
            self._post_entry("case_write_off", write_off_entry)
            outstanding = Decimal("0")
        else:
            outstanding = Decimal("0")

        self._case_investments[case_id] = outstanding
        self.distribute_surplus(resolution_date, buffer=ZERO)

    def record_management_fee(
        self,
        *,
        allocations: List[Dict[str, object]],
        entry_date: date | pd.Timestamp,
        memo: str = "Accrue management fee",
    ) -> None:
        if not allocations:
            return

        normalized_date = normalize_date(entry_date)
        parsed_allocations: List[tuple[InvestorState, Decimal, Decimal]] = []
        total_fee = ZERO
        total_gst = ZERO

        for item in allocations:
            name = item.get("investor") or item.get("name")
            if not name:
                continue
            investor = self._investor_lookup.get(str(name))
            if investor is None:
                continue
            fee_value = to_decimal(item.get("fee", 0))
            gst_value = to_decimal(item.get("gst", 0))
            if fee_value <= ZERO and gst_value <= ZERO:
                continue
            parsed_allocations.append((investor, fee_value, gst_value))
            total_fee = (total_fee + fee_value).quantize(CENT, rounding=ROUND_HALF_UP)
            total_gst = (total_gst + gst_value).quantize(CENT, rounding=ROUND_HALF_UP)

        if not parsed_allocations:
            return

        entry = create_management_fee_entry(
            chart=self.chart,
            amount=total_fee,
            entry_date=normalized_date,
            memo=memo,
            settle_in_cash=True,
            gst_amount=total_gst,
            currency=self.currency,
        )
        entry.reference = entry.reference or self._next_reference("management_fee")
        entry = self._post_entry("management_fee", entry)

        for sequence, (investor, fee_value, gst_value) in enumerate(parsed_allocations, start=1):
            total_amount = (fee_value + gst_value).quantize(CENT, rounding=ROUND_HALF_UP)
            investor.management_fees = (investor.management_fees + total_amount).quantize(
                CENT, rounding=ROUND_HALF_UP
            )
            self._record_investor_event(
                investor=investor,
                event_type="management_fee",
                amount=total_amount,
                entry=entry,
                entry_date=normalized_date,
                memo=memo,
                sequence=sequence,
            )

        self._ensure_positive_cash(entry.entry_date, source="operating")

    def record_audit_fee(
        self,
        *,
        amount: float | Decimal,
        entry_date: date | pd.Timestamp,
        memo: str = "Accrue audit fee",
        gst_amount: float | Decimal = 0,
    ) -> None:
        value = to_decimal(amount)
        gst_value = to_decimal(gst_amount)
        if value <= Decimal("0") and gst_value <= ZERO:
            return
        entry = create_audit_fee_entry(
            chart=self.chart,
            amount=value,
            entry_date=normalize_date(entry_date),
            memo=memo,
            settle_in_cash=True,
            gst_amount=gst_value,
            currency=self.currency,
        )
        entry.reference = entry.reference or self._next_reference("audit_fee")
        self._post_entry("audit_fee", entry)
        self._ensure_positive_cash(entry.entry_date, source="operating")


    def settle_gst_liability(self, *, entry_date: date | pd.Timestamp) -> None:
        self._settle_gst_liability(entry_date)
    def record_fund_expense(
        self,
        *,
        account_code: str,
        amount: float | Decimal,
        entry_date: date | pd.Timestamp,
        memo: str,
        gst_amount: float | Decimal = 0,
    ) -> None:
        value = to_decimal(amount)
        gst_value = to_decimal(gst_amount)
        if value <= ZERO and gst_value <= ZERO:
            return
        normalized_date = normalize_date(entry_date)
        entry = create_fund_expense_entry(
            chart=self.chart,
            account_code=account_code,
            amount=value,
            entry_date=normalized_date,
            memo=memo,
            gst_amount=gst_value,
            currency=self.currency,
        )
        entry.reference = entry.reference or self._next_reference(f"expense.{account_code}")
        self._post_entry(f"expense_{account_code}", entry)
        if account_code == "1710":
            asset_amount = (value + gst_value).quantize(CENT, rounding=ROUND_HALF_UP)
            if asset_amount > ZERO:
                self._register_organizational_amortisation(asset_amount, normalized_date)
        self._ensure_positive_cash(entry.entry_date, source="operating")

    def record_drawdown(
        self,
        *,
        amount: float | Decimal,
        entry_date: date | pd.Timestamp,
        memo: str = "Capital call",
        purpose: str = "investment",
    ) -> None:
        value = to_decimal(amount)
        if value <= ZERO:
            return
        allocations = self._allocate_drawdown(value)
        posting_date = normalize_date(entry_date)
        for sequence, (investor, allocated) in enumerate(allocations, start=1):
            entry = create_drawdown_entry(
                chart=self.chart,
                investor_name=investor.name,
                amount=allocated,
                entry_date=posting_date,
                memo=memo,
                currency=self.currency,
            )
            entry.reference = entry.reference or self._next_reference(f"drawdown:{investor.name}")
            entry = self._post_entry("drawdown", entry)
            investor.contributed = (investor.contributed + allocated).quantize(CENT, rounding=ROUND_HALF_UP)
            if purpose == "operating":
                investor.operating_contributed = (
                    investor.operating_contributed + allocated
                ).quantize(CENT, rounding=ROUND_HALF_UP)
            self._reclass_commitment_on_drawdown(allocated, posting_date)
            self._record_investor_event(
                investor=investor,
                event_type="drawdown",
                amount=allocated,
                entry=entry,
                entry_date=posting_date,
                memo=memo,
                sequence=sequence,
            )
        self._ensure_clawback_state(posting_date)

    def record_distribution(
        self,
        *,
        amount: float | Decimal,
        entry_date: date | pd.Timestamp,
        memo: str = "Capital distribution",
    ) -> None:
        value = to_decimal(amount)
        if value <= ZERO:
            return
        posting_date = normalize_date(entry_date)
        self._apply_organizational_amortisation(posting_date)
        self._ensure_clawback_state(posting_date)

        total_outstanding = sum((inv.outstanding_capital for inv in self._investors), start=ZERO)
        remaining = value
        sequence_counter = 1
        operating_repaid_total = ZERO

        if total_outstanding > ZERO:
            roc_amount = remaining if remaining <= total_outstanding else total_outstanding
            if roc_amount > ZERO:
                roc_allocations = self._allocate_return_of_capital(roc_amount)
                for investor, allocated in roc_allocations:
                    entry = create_distribution_entry(
                        chart=self.chart,
                        investor_name=investor.name,
                        amount=allocated,
                        entry_date=posting_date,
                        memo=f"{memo} (return of capital)",
                        currency=self.currency,
                    )
                    entry.reference = entry.reference or self._next_reference(
                        f"distribution:{investor.name}"
                    )
                    entry = self._post_entry("distribution", entry)
                    investor.capital_returned = (investor.capital_returned + allocated).quantize(
                        CENT, rounding=ROUND_HALF_UP
                    )
                    investor.distributed = (investor.distributed + allocated).quantize(
                        CENT, rounding=ROUND_HALF_UP
                    )
                    if investor.operating_contributed > ZERO:
                        repay_amount = min(investor.operating_contributed, allocated)
                        if repay_amount > ZERO:
                            investor.operating_contributed = (
                                investor.operating_contributed - repay_amount
                            ).quantize(CENT, rounding=ROUND_HALF_UP)
                            investor.operating_recallable = (
                                investor.operating_recallable + repay_amount
                            ).quantize(CENT, rounding=ROUND_HALF_UP)
                            operating_repaid_total = (
                                operating_repaid_total + repay_amount
                            ).quantize(CENT, rounding=ROUND_HALF_UP)
                    remaining -= allocated
                    self._record_investor_event(
                        investor=investor,
                        event_type="return_of_capital",
                        amount=allocated,
                        entry=entry,
                        entry_date=posting_date,
                        memo=memo,
                        sequence=sequence_counter,
                    )
                    sequence_counter += 1
                    self._adjust_investor_carry(
                        investor,
                        posting_date,
                        memo=f"Rebalance carried interest ({memo})",
                    )

        if operating_repaid_total > ZERO:
            self._reclass_commitment_on_return(operating_repaid_total, posting_date)

        if remaining < ZERO:
            remaining = ZERO

        if remaining > ZERO:
            profit_allocations = self._allocate_surplus_to_lps(remaining)
            lp_total = ZERO

            for investor, gross_amount in profit_allocations:
                carry_rate = investor.carry_rate if investor.carry_rate is not None else ZERO
                if carry_rate < ZERO or carry_rate >= Decimal("1"):
                    carry_rate = ZERO
                base_net_cash = (
                    investor.capital_returned
                    + investor.profit_distributed
                    - investor.contributed
                )
                prev_total_carry = investor.carried_interest + investor.carry_clawback
                if carry_rate > ZERO:
                    desired = (
                        carry_rate * (base_net_cash + gross_amount)
                        - prev_total_carry * (Decimal("1") - carry_rate)
                    )
                    carry_amount = desired.quantize(CENT, rounding=ROUND_HALF_UP)
                    if carry_amount < ZERO:
                        carry_amount = ZERO
                else:
                    carry_amount = ZERO
                if carry_amount > gross_amount:
                    carry_amount = gross_amount
                net_amount = (gross_amount - carry_amount).quantize(CENT, rounding=ROUND_HALF_UP)

                if net_amount <= ZERO and carry_amount <= ZERO:
                    continue

                entry = create_distribution_entry(
                    chart=self.chart,
                    investor_name=investor.name,
                    amount=net_amount,
                    entry_date=posting_date,
                    memo=f"{memo} (profit)",
                    currency=self.currency,
                )
                entry.reference = entry.reference or self._next_reference(
                    f"distribution:{investor.name}"
                )
                entry = self._post_entry("distribution", entry)

                investor.profit_distributed = (
                    investor.profit_distributed + net_amount
                ).quantize(CENT, rounding=ROUND_HALF_UP)
                investor.distributed = (investor.distributed + net_amount).quantize(
                    CENT, rounding=ROUND_HALF_UP
                )

                lp_total = (lp_total + net_amount).quantize(CENT, rounding=ROUND_HALF_UP)

                self._record_investor_event(
                    investor=investor,
                    event_type="profit_distribution",
                    amount=net_amount,
                    entry=entry,
                    entry_date=posting_date,
                    memo=memo,
                    sequence=sequence_counter,
                )
                sequence_counter += 1
                if carry_amount > ZERO:
                    accrual_entry = self._apply_carry_withholding(
                        investor,
                        carry_amount,
                        posting_date,
                        memo=f"{memo} (carried interest)"
                    )
                    self._record_investor_event(
                        investor=investor,
                        event_type="carried_interest_withheld",
                        amount=carry_amount,
                        entry=accrual_entry if accrual_entry is not None else entry,
                        entry_date=posting_date,
                        memo=f"{memo} (carried interest)",
                        sequence=sequence_counter,
                    )
                    sequence_counter += 1

                self._adjust_investor_carry(
                    investor,
                    posting_date,
                    memo=f"Rebalance carried interest ({memo})",
                )

            if lp_total > ZERO:
                self._lp_surplus_distributed = (
                    self._lp_surplus_distributed + lp_total
                ).quantize(CENT, rounding=ROUND_HALF_UP)

        # Route any accrued carry on this distribution to the sponsor immediately
        self._distribute_carry_to_class_b(
            posting_date,
            memo="Distribute carried interest from profit allocation",
        )

    def distribute_surplus(self, entry_date: date | pd.Timestamp, *, buffer: Optional[Decimal] = None) -> None:
        normalized_date = normalize_date(entry_date)
        self._apply_organizational_amortisation(normalized_date)
        target_buffer = buffer if buffer is not None else self.cash_buffer
        cash_balance = self.ledger.get_balance(self.cash_account)
        carry_liability = -self.ledger.get_balance("2820")
        clawback_reserve = -self.ledger.get_balance("2830")
        adjusted_cash = cash_balance - carry_liability - clawback_reserve
        excess = adjusted_cash - target_buffer
        if excess <= CENT:
            return
        self.record_distribution(amount=excess, entry_date=normalized_date, memo="Distribute surplus cash")

    def finalise(self, entry_date: date | pd.Timestamp) -> None:
        """Perform any end-of-period allocations (e.g., distribute remaining cash)."""
        self.distribute_surplus(entry_date)
        self._settle_gst_liability(entry_date)

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _resolve_cash_account(self) -> str:
        if "1000" in self.chart:
            return "1000"
        if "1010" in self.chart:
            return "1010"
        if "1020" in self.chart:
            return "1020"
        return "1000"

    def _next_reference(self, prefix: str) -> str:
        self._reference_counters[prefix] += 1
        return f"{prefix}:{self._reference_counters[prefix]:04d}"

    def _post_initial_commitments(self) -> None:
        if self._total_commitment <= ZERO:
            return
        investment_dates = [
            getattr(investor, "investment_date", None)
            for investor in getattr(self.fund, "investors", [])
            if getattr(investor, "investment_date", None) is not None
        ]
        entry_date = min(investment_dates) if investment_dates else date.today()
        normalized_date = normalize_date(entry_date)
        entry = JournalEntry(
            entry_date=normalized_date,
            memo="Record investor capital commitments",
        )
        entry.add_line(JournalEntryLine(account_code="1500", debit=self._total_commitment))
        entry.add_line(JournalEntryLine(account_code="2050", credit=self._total_commitment))
        entry.reference = entry.reference or self._next_reference("commitments")
        self._post_entry("initial_commitments", entry)

    def _settle_gst_liability(self, entry_date: date | pd.Timestamp) -> None:
        normalized_date = normalize_date(entry_date)
        balance_raw = self.ledger.get_balance("2450")
        try:
            balance = Decimal(balance_raw)
        except (InvalidOperation, TypeError, ValueError):
            return
        if not balance.is_finite():
            return
        if balance >= -TOLERANCE:
            return
        with localcontext() as ctx:
            ctx.prec = max(ctx.prec, len(balance.as_tuple().digits) + 2)
            ctx.traps[InvalidOperation] = False
            try:
                liability = (-balance).quantize(CENT, rounding=ROUND_HALF_UP)
            except InvalidOperation:
                return
        if not liability.is_finite():
            return
        if liability <= ZERO:
            return
        entry = JournalEntry(
            entry_date=normalized_date,
            memo="Settle GST payable",
        )
        entry.add_line(JournalEntryLine(account_code="2450", debit=liability))
        entry.add_line(JournalEntryLine(account_code=self.cash_account, credit=liability))
        entry.reference = entry.reference or self._next_reference("gst.settlement")
        self._post_entry("gst_settlement", entry)
        self._ensure_positive_cash(entry.entry_date, source="operating")

    def _post_entry(self, event_type: str, entry: JournalEntry) -> JournalEntry:
        self._entry_sequence += 1
        entry.entry_number = self._entry_sequence
        self.ledger.post(entry)
        return entry

    def _register_organizational_amortisation(self, amount: Decimal, entry_date: date) -> None:
        normalized_date = normalize_date(entry_date)
        schedule = OrganizationalCostSchedule(
            next_month=month_start(normalized_date),
            periods_remaining=60,
            remaining_amount=amount,
            total_amount=amount,
        )
        self._organizational_amortisations.append(schedule)

    def _apply_organizational_amortisation(self, entry_date: date) -> None:
        if not self._organizational_amortisations:
            return
        current_month = month_start(entry_date)
        updated_schedules: List[OrganizationalCostSchedule] = []
        for schedule in self._organizational_amortisations:
            while (
                schedule.periods_remaining > 0
                and schedule.remaining_amount > ZERO
                and schedule.next_month <= current_month
            ):
                periods = Decimal(schedule.periods_remaining)
                amount = (schedule.remaining_amount / periods).quantize(CENT, rounding=ROUND_HALF_UP)
                if amount <= ZERO and schedule.remaining_amount > ZERO:
                    amount = schedule.remaining_amount
                if amount > schedule.remaining_amount:
                    amount = schedule.remaining_amount
                if amount <= ZERO:
                    break
                self._post_organizational_amortisation_entry(amount, entry_date)
                schedule.remaining_amount = (schedule.remaining_amount - amount).quantize(
                    CENT,
                    rounding=ROUND_HALF_UP,
                )
                schedule.periods_remaining -= 1
                schedule.next_month = add_months(schedule.next_month, 1)
            if schedule.periods_remaining > 0 and schedule.remaining_amount > ZERO:
                updated_schedules.append(schedule)
        self._organizational_amortisations = updated_schedules

    def _post_organizational_amortisation_entry(self, amount: Decimal, entry_date: date) -> Optional[JournalEntry]:
        value = to_decimal(amount)
        if value <= ZERO:
            return None
        entry = JournalEntry(
            entry_date=entry_date,
            memo="Amortise organisational costs",
        )
        entry.add_line(JournalEntryLine(account_code="7050", debit=value))
        entry.add_line(JournalEntryLine(account_code="1710", credit=value))
        entry.reference = self._next_reference("organizational.amortisation")
        return self._post_entry("organizational_amortisation", entry)

    def _record_investor_event(
        self,
        *,
        investor: InvestorState,
        event_type: str,
        amount: Decimal,
        entry: JournalEntry,
        entry_date: date,
        memo: Optional[str] = None,
        sequence: int = 0,
    ) -> None:
        record = {
            "investor": investor.name,
            "date": entry_date.isoformat(),
            "event_type": event_type,
            "amount": float(amount),
            "entry_number": entry.entry_number,
            "reference": entry.reference or "",
            "memo": memo or entry.memo,
            "sequence": sequence,
        }
        self._investor_events.append(record)

    def _reclass_commitment_on_drawdown(self, amount: Decimal, entry_date: date) -> None:
        reclass_amount = to_decimal(amount)
        if reclass_amount <= ZERO:
            return
        outstanding = -self.ledger.get_balance("2050")
        if outstanding <= ZERO:
            return
        reclass_amount = reclass_amount if reclass_amount <= outstanding else outstanding
        if reclass_amount <= ZERO:
            return
        entry = JournalEntry(
            entry_date=entry_date,
            memo="Reclassify capital commitment to drawn",
        )
        entry.add_line(JournalEntryLine(account_code="2050", debit=reclass_amount))
        entry.add_line(JournalEntryLine(account_code="2065", credit=reclass_amount))
        entry.reference = self._next_reference("commitment.draw")
        self._post_entry("commitment_reclass_draw", entry)

    def _reclass_commitment_on_return(self, amount: Decimal, entry_date: date) -> None:
        reclass_amount = to_decimal(amount)
        if reclass_amount <= ZERO:
            return
        drawn_balance_raw = self.ledger.get_balance("2065")
        try:
            drawn_balance = Decimal(drawn_balance_raw)
        except (InvalidOperation, TypeError, ValueError):
            drawn_balance = ZERO
        if not drawn_balance.is_finite():
            drawn_balance = ZERO
        available_to_reclass = (-drawn_balance) if drawn_balance < ZERO else ZERO
        if available_to_reclass <= ZERO:
            return
        if reclass_amount > available_to_reclass:
            reclass_amount = available_to_reclass
        if reclass_amount <= ZERO:
            return
        entry = JournalEntry(
            entry_date=entry_date,
            memo="Reclassify drawn capital back to commitment",
        )
        entry.add_line(JournalEntryLine(account_code="2065", debit=reclass_amount))
        entry.add_line(JournalEntryLine(account_code="2050", credit=reclass_amount))
        entry.reference = self._next_reference("commitment.return")
        self._post_entry("commitment_reclass_return", entry)

    # ------------------------------------------------------------------
    # Carried interest methods (delegated to CarriedInterestCalculator)
    # ------------------------------------------------------------------

    @property
    def _carry_accrued(self) -> Decimal:
        """Total carried interest accrued (delegated to calculator)."""
        return self._carry_calculator.carry_accrued

    @property
    def _clawback_reserved(self) -> Decimal:
        """Total clawback reserve (delegated to calculator)."""
        return self._carry_calculator.clawback_reserved

    def _apply_carry_withholding(
        self,
        investor: InvestorState,
        amount: Decimal,
        entry_date: date,
        *,
        memo: Optional[str] = None,
    ) -> Optional[JournalEntry]:
        """Accrue carried interest for an investor."""
        return self._carry_calculator.apply_carry_withholding(investor, amount, entry_date, memo=memo)

    def _post_carry_to_clawback(
        self,
        investor: InvestorState,
        amount: Decimal,
        entry_date: date,
        *,
        memo: Optional[str] = None,
    ) -> JournalEntry:
        """Reclassify carried interest to clawback reserve."""
        return self._carry_calculator.post_carry_to_clawback(investor, amount, entry_date, memo=memo)

    def _post_carry_from_clawback(
        self,
        investor: InvestorState,
        amount: Decimal,
        entry_date: date,
        *,
        memo: Optional[str] = None,
    ) -> JournalEntry:
        """Release clawback reserve back to carried interest."""
        return self._carry_calculator.post_carry_from_clawback(investor, amount, entry_date, memo=memo)

    def _distribute_carry_to_class_b(self, entry_date: date, *, memo: Optional[str] = None) -> None:
        """Distribute accrued carried interest to Class B (GP) investors."""
        self._carry_calculator.distribute_carry_to_class_b(entry_date, memo=memo, currency=self.currency)

    def close_fund(self, entry_date: date | pd.Timestamp) -> None:
        closing_date = normalize_date(entry_date)
        self._ensure_clawback_state(closing_date)
        if FUND_CLOSURE_EXPENSE > ZERO:
            self.record_fund_expense(
                account_code="6850",
                amount=FUND_CLOSURE_EXPENSE,
                entry_date=closing_date,
                memo="Fund closure legal expense",
            )
        self._ensure_clawback_state(closing_date)
        self._release_remaining_clawback(closing_date)
        self._distribute_carry_to_class_b(
            closing_date,
            memo="Distribute carried interest on fund close",
        )
        self.distribute_surplus(closing_date, buffer=ZERO)

    def _target_carry_payable(self, investor: InvestorState) -> Decimal:
        """Calculate target carried interest payable for an investor."""
        return self._carry_calculator.target_carry_payable(investor)

    def _adjust_investor_carry(
        self,
        investor: InvestorState,
        entry_date: date,
        *,
        memo: Optional[str] = None,
    ) -> None:
        """Adjust an investor's carried interest to match target."""
        self._carry_calculator.adjust_investor_carry(investor, entry_date, memo=memo)

    def _accrue_carried_interest(self, amount: Decimal, entry_date: date, *, memo: Optional[str] = None) -> None:
        """Accrue carried interest without associating with specific investor."""
        self._carry_calculator.accrue_carried_interest(amount, entry_date, memo=memo)

    def _ensure_clawback_state(self, entry_date: date) -> None:
        """Ensure all investors have correct clawback state."""
        self._carry_calculator.ensure_clawback_state(entry_date)

    def _release_remaining_clawback(self, entry_date: date) -> None:
        """Release all remaining clawback reserves (typically at fund close)."""
        self._carry_calculator.release_remaining_clawback(entry_date)

    def _ensure_positive_cash(self, entry_date: date, *, source: str = "investment") -> None:
        cash_balance_raw = self.ledger.get_balance(self.cash_account)
        try:
            cash_balance = Decimal(cash_balance_raw)
        except (InvalidOperation, TypeError, ValueError):
            return
        if not cash_balance.is_finite():
            return
        if cash_balance >= -TOLERANCE:
            return
        try:
            required = (-cash_balance).quantize(CENT, rounding=ROUND_HALF_UP)
        except InvalidOperation:
            return
        try:
            purpose = "operating" if source == "operating" else "investment"
            memo = (
                "Capital call to fund operations"
                if purpose == "operating"
                else "Capital call to fund investments"
            )
            self.record_drawdown(
                amount=required,
                entry_date=entry_date,
                memo=memo,
                purpose=purpose,
            )
        except ValueError:
            return

    def _allocate_drawdown(self, total_amount: Decimal) -> List[tuple[InvestorState, Decimal]]:
        """Allocate drawdown pro-rata based on available commitment."""
        return self._allocator.allocate_drawdown(self._investors, total_amount)

    def _allocate_return_of_capital(self, total_amount: Decimal) -> List[tuple[InvestorState, Decimal]]:
        """Allocate return of capital pro-rata based on outstanding capital."""
        return self._allocator.allocate_return_of_capital(self._investors, total_amount)

    def _allocate_surplus_to_lps(self, total_amount: Decimal) -> List[tuple[InvestorState, Decimal]]:
        """Allocate surplus/profit pro-rata based on commitment."""
        return self._allocator.allocate_surplus_to_lps(self._investors, total_amount)

    def _allocate_distribution(self, total_amount: Decimal) -> List[tuple[InvestorState, Decimal]]:
        """Allocate distribution pro-rata based on outstanding capital or commitment."""
        return self._allocator.allocate_distribution(self._investors, total_amount)