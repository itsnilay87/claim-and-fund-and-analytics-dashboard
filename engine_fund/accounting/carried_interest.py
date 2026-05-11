"""Carried interest calculation and management."""

from __future__ import annotations

from datetime import date
from decimal import Decimal, ROUND_HALF_UP
from typing import TYPE_CHECKING, Callable, List, Optional

from .journal import JournalEntry, JournalEntryLine
from .models import InvestorState
from .postings import create_carried_interest_accrual, create_carried_interest_distribution
from .utils import CENT, ZERO, to_decimal, normalize_date

if TYPE_CHECKING:
    from .chart_of_accounts import ChartOfAccounts
    from .ledger import Ledger


class CarriedInterestCalculator:
    """
    Calculates and manages carried interest for fund investors.
    
    Handles:
    - Carry accrual and withholding
    - Clawback reserves
    - Carry distribution to Class B (GP) investors
    - Target carry calculations based on fund economics
    """

    def __init__(
        self,
        chart: "ChartOfAccounts",
        ledger: "Ledger",
        investors: List[InvestorState],
        *,
        post_entry_callback: Callable[[str, JournalEntry], JournalEntry],
        next_reference_callback: Callable[[str], str],
        record_event_callback: Callable[..., None],
    ) -> None:
        """
        Initialize the carried interest calculator.
        
        Args:
            chart: Chart of accounts reference
            ledger: Ledger for balance lookups
            investors: List of investor states
            post_entry_callback: Callback to post journal entries
            next_reference_callback: Callback to generate references
            record_event_callback: Callback to record investor events
        """
        self._chart = chart
        self._ledger = ledger
        self._investors = investors
        self._post_entry = post_entry_callback
        self._next_reference = next_reference_callback
        self._record_event = record_event_callback
        
        # Tracking accumulators
        self._carry_accrued = ZERO
        self._clawback_reserved = ZERO

    @property
    def carry_accrued(self) -> Decimal:
        """Total carried interest accrued."""
        return self._carry_accrued

    @property
    def clawback_reserved(self) -> Decimal:
        """Total clawback reserve."""
        return self._clawback_reserved

    def set_carry_accrued(self, value: Decimal) -> None:
        """Set the carry accrued value (for bookkeeper initialization)."""
        self._carry_accrued = value

    def set_clawback_reserved(self, value: Decimal) -> None:
        """Set the clawback reserved value (for bookkeeper initialization)."""
        self._clawback_reserved = value

    def target_carry_payable(self, investor: InvestorState) -> Decimal:
        """
        Calculate the target carried interest payable for an investor.
        
        Uses the formula: target = net_cash * (rate / (1 - rate))
        where net_cash = capital_returned + profit_distributed - contributed
        
        Args:
            investor: The investor state
            
        Returns:
            Target carried interest amount
        """
        rate = investor.carry_rate
        if rate <= ZERO or rate >= Decimal("1"):
            return ZERO
        
        net_cash = (
            investor.capital_returned
            + investor.profit_distributed
            - investor.contributed
        )
        if net_cash <= ZERO:
            return ZERO
        
        ratio = rate / (Decimal("1") - rate)
        return (net_cash * ratio).quantize(CENT, rounding=ROUND_HALF_UP)

    def apply_carry_withholding(
        self,
        investor: InvestorState,
        amount: Decimal,
        entry_date: date,
        *,
        memo: Optional[str] = None,
    ) -> Optional[JournalEntry]:
        """
        Accrue carried interest for an investor.
        
        Args:
            investor: The investor state
            amount: Amount to withhold
            entry_date: Date of the entry
            memo: Optional memo text
            
        Returns:
            The journal entry if created, None otherwise
        """
        value = to_decimal(amount)
        if value <= ZERO:
            return None
        
        memo_text = memo or f"Accrue carried interest ({investor.name})"
        entry = create_carried_interest_accrual(
            chart=self._chart,
            amount=value,
            entry_date=entry_date,
            memo=memo_text,
        )
        entry.reference = entry.reference or self._next_reference(f"carried_interest:{investor.name}")
        entry = self._post_entry("carried_interest_accrual", entry)
        
        investor.carried_interest = (investor.carried_interest + value).quantize(CENT, rounding=ROUND_HALF_UP)
        self._carry_accrued = (self._carry_accrued + value).quantize(CENT, rounding=ROUND_HALF_UP)
        
        return entry

    def post_carry_to_clawback(
        self,
        investor: InvestorState,
        amount: Decimal,
        entry_date: date,
        *,
        memo: Optional[str] = None,
    ) -> JournalEntry:
        """
        Reclassify carried interest to clawback reserve.
        
        Args:
            investor: The investor state
            amount: Amount to move to clawback
            entry_date: Date of the entry
            memo: Optional memo text
            
        Returns:
            The journal entry
        """
        value = to_decimal(amount)
        entry = JournalEntry(
            entry_date=entry_date,
            memo=memo or f"Reclassify carried interest to clawback ({investor.name})",
        )
        entry.add_line(JournalEntryLine(account_code="2820", debit=value))
        entry.add_line(JournalEntryLine(account_code="2830", credit=value))
        entry.reference = entry.reference or self._next_reference(f"carry.clawback:{investor.name}")
        entry = self._post_entry("carried_interest_clawback", entry)
        
        self._carry_accrued = (self._carry_accrued - value).quantize(CENT, rounding=ROUND_HALF_UP)
        self._clawback_reserved = (self._clawback_reserved + value).quantize(CENT, rounding=ROUND_HALF_UP)
        
        return entry

    def post_carry_from_clawback(
        self,
        investor: InvestorState,
        amount: Decimal,
        entry_date: date,
        *,
        memo: Optional[str] = None,
    ) -> JournalEntry:
        """
        Release clawback reserve back to carried interest.
        
        Args:
            investor: The investor state
            amount: Amount to release
            entry_date: Date of the entry
            memo: Optional memo text
            
        Returns:
            The journal entry
        """
        value = to_decimal(amount)
        entry = JournalEntry(
            entry_date=entry_date,
            memo=memo or f"Release clawback reserve to carried interest ({investor.name})",
        )
        entry.add_line(JournalEntryLine(account_code="2830", debit=value))
        entry.add_line(JournalEntryLine(account_code="2820", credit=value))
        entry.reference = entry.reference or self._next_reference(f"carry.clawback_release:{investor.name}")
        entry = self._post_entry("carried_interest_clawback_release", entry)
        
        self._carry_accrued = (self._carry_accrued + value).quantize(CENT, rounding=ROUND_HALF_UP)
        self._clawback_reserved = (self._clawback_reserved - value).quantize(CENT, rounding=ROUND_HALF_UP)
        
        return entry

    def adjust_investor_carry(
        self,
        investor: InvestorState,
        entry_date: date,
        *,
        memo: Optional[str] = None,
    ) -> None:
        """
        Adjust an investor's carried interest to match target.
        
        If target < current, moves excess to clawback.
        If target > current, releases from clawback then accrues more.
        
        Args:
            investor: The investor state
            entry_date: Date of the adjustment
            memo: Optional memo text
        """
        target = self.target_carry_payable(investor)
        current = investor.carried_interest
        
        if target == current:
            return
        
        memo_text = memo or "Rebalance carried interest"
        
        if target < current:
            # Move excess to clawback
            difference = (current - target).quantize(CENT, rounding=ROUND_HALF_UP)
            if difference <= ZERO:
                return
            
            investor.carried_interest = (investor.carried_interest - difference).quantize(
                CENT, rounding=ROUND_HALF_UP
            )
            investor.carry_clawback = (investor.carry_clawback + difference).quantize(
                CENT, rounding=ROUND_HALF_UP
            )
            
            entry = self.post_carry_to_clawback(investor, difference, entry_date, memo=memo_text)
            self._record_event(
                investor=investor,
                event_type="carried_interest_clawback",
                amount=-difference,
                entry=entry,
                entry_date=entry_date,
                memo=memo_text,
                sequence=0,
            )
        else:
            # Need more carry - release from clawback first, then accrue
            difference = (target - current).quantize(CENT, rounding=ROUND_HALF_UP)
            if difference <= ZERO:
                return
            
            release = min(difference, investor.carry_clawback)
            remaining = difference
            
            if release > ZERO:
                investor.carry_clawback = (investor.carry_clawback - release).quantize(
                    CENT, rounding=ROUND_HALF_UP
                )
                investor.carried_interest = (investor.carried_interest + release).quantize(
                    CENT, rounding=ROUND_HALF_UP
                )
                
                entry = self.post_carry_from_clawback(investor, release, entry_date, memo=memo_text)
                self._record_event(
                    investor=investor,
                    event_type="carried_interest_clawback_release",
                    amount=release,
                    entry=entry,
                    entry_date=entry_date,
                    memo=memo_text,
                    sequence=0,
                )
                remaining = (difference - release).quantize(CENT, rounding=ROUND_HALF_UP)
            
            if remaining > ZERO:
                entry = self.apply_carry_withholding(
                    investor, remaining, entry_date, memo=memo_text
                )
                if entry is not None:
                    self._record_event(
                        investor=investor,
                        event_type="carried_interest_adjustment",
                        amount=remaining,
                        entry=entry,
                        entry_date=entry_date,
                        memo=memo_text,
                        sequence=0,
                    )

    def ensure_clawback_state(self, entry_date: date) -> None:
        """
        Ensure all investors have correct clawback state.
        
        Args:
            entry_date: Date for any adjustments
        """
        normalized_date = normalize_date(entry_date)
        for investor in self._investors:
            self.adjust_investor_carry(investor, normalized_date)

    def release_remaining_clawback(self, entry_date: date) -> None:
        """
        Release all remaining clawback reserves (typically at fund close).
        
        Args:
            entry_date: Date of the release
        """
        normalized_date = normalize_date(entry_date)
        
        for investor in self._investors:
            release_amount = investor.carry_clawback
            if release_amount <= ZERO:
                continue
            
            release_amount = release_amount.quantize(CENT, rounding=ROUND_HALF_UP)
            if release_amount <= ZERO:
                continue
            
            investor.carry_clawback = ZERO
            investor.carried_interest = (investor.carried_interest + release_amount).quantize(
                CENT, rounding=ROUND_HALF_UP
            )
            
            entry = self.post_carry_from_clawback(
                investor, release_amount, normalized_date,
                memo="Release clawback reserve on fund close",
            )
            self._record_event(
                investor=investor,
                event_type="carried_interest_clawback_release",
                amount=release_amount,
                entry=entry,
                entry_date=normalized_date,
                memo="Release clawback reserve on fund close",
                sequence=0,
            )

        # Handle any residual clawback balance
        residual = (-self._ledger.get_balance("2830")).quantize(CENT, rounding=ROUND_HALF_UP)
        if residual > ZERO:
            sponsor = next(
                (inv for inv in self._investors if (inv.unit_class or "").upper() == "B"),
                None,
            )
            if sponsor is not None:
                sponsor_event_entry = self.post_carry_from_clawback(
                    sponsor, residual, normalized_date,
                    memo="Release remaining clawback reserve",
                )
                sponsor.carry_clawback = ZERO
                sponsor.carried_interest = (sponsor.carried_interest + residual).quantize(
                    CENT, rounding=ROUND_HALF_UP
                )
                self._record_event(
                    investor=sponsor,
                    event_type="carried_interest_clawback_release",
                    amount=residual,
                    entry=sponsor_event_entry,
                    entry_date=normalized_date,
                    memo="Release remaining clawback reserve",
                    sequence=0,
                )

    def accrue_carried_interest(
        self,
        amount: Decimal,
        entry_date: date,
        *,
        memo: Optional[str] = None,
    ) -> None:
        """
        Accrue carried interest without associating with specific investor.
        
        Args:
            amount: Amount to accrue
            entry_date: Date of the accrual
            memo: Optional memo text
        """
        value = to_decimal(amount)
        if value <= ZERO:
            return
        
        entry = create_carried_interest_accrual(
            chart=self._chart,
            amount=value,
            entry_date=entry_date,
            memo=memo or "Accrue carried interest",
        )
        entry.reference = entry.reference or self._next_reference("carried_interest")
        self._post_entry("carried_interest_accrual", entry)
        self._carry_accrued = (self._carry_accrued + value).quantize(CENT, rounding=ROUND_HALF_UP)

    def distribute_carry_to_class_b(
        self,
        entry_date: date,
        *,
        memo: Optional[str] = None,
        currency: str = "INR",
    ) -> None:
        """
        Distribute accrued carried interest to Class B (GP) investors.
        
        Args:
            entry_date: Date of the distribution
            memo: Optional memo text
            currency: Currency for the distribution
        """
        from .postings import create_distribution_entry
        
        carry_balance = -self._ledger.get_balance("2820")
        if carry_balance <= ZERO:
            return
        
        gp_investors = [inv for inv in self._investors if (inv.unit_class or "").upper() == "B"]
        if not gp_investors:
            return
        
        sponsor_investor = next(
            (inv for inv in gp_investors if inv.name.strip().lower() == "sponsor"),
            None,
        )
        if sponsor_investor is None:
            return
        
        allocated = to_decimal(carry_balance)
        if allocated <= ZERO:
            return
        
        # Create distribution entries
        entry = create_carried_interest_distribution(
            chart=self._chart,
            amount=allocated,
            entry_date=entry_date,
            memo=memo or "Distribute carried interest",
            investor_name=sponsor_investor.name,
        )
        entry.reference = entry.reference or self._next_reference(
            f"carried_interest_distribution:{sponsor_investor.name}"
        )
        entry = self._post_entry("carried_interest_distribution", entry)
        
        payout_entry = create_distribution_entry(
            chart=self._chart,
            investor_name=sponsor_investor.name,
            amount=allocated,
            entry_date=entry_date,
            memo=memo or "Distribute carried interest",
            currency=currency,
        )
        payout_entry.reference = payout_entry.reference or self._next_reference(
            f"distribution:{sponsor_investor.name}"
        )
        payout_entry = self._post_entry("distribution", payout_entry)
        
        sponsor_investor.profit_distributed = (
            sponsor_investor.profit_distributed + allocated
        ).quantize(CENT, rounding=ROUND_HALF_UP)
        sponsor_investor.distributed = (
            sponsor_investor.distributed + allocated
        ).quantize(CENT, rounding=ROUND_HALF_UP)
        
        self._record_event(
            investor=sponsor_investor,
            event_type="carried_interest_paid",
            amount=allocated,
            entry=payout_entry,
            entry_date=entry_date,
            memo=memo or "Distribute carried interest",
            sequence=0,
        )
