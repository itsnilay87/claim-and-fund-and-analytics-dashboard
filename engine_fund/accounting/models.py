"""Data models for fund accounting."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from decimal import Decimal

from .utils import ZERO


@dataclass
class InvestorState:
    """
    Tracks the financial state of an individual investor in the fund.
    
    Attributes:
        name: Investor identifier
        commitment: Total capital commitment
        unit_class: Unit class (A for LPs, B for Sponsor/GP)
        unit_price: Price per unit
        units: Number of units held
        contributed: Total capital contributed
        capital_returned: Return of capital portion
        distributed: Total capital distributed
        profit_distributed: Profit portion of distributions
        management_fees: Management fees paid
        carried_interest: Accrued carried interest
        carry_clawback: Clawback reserve amount
        management_fee_rate: Fee rate for this investor
        carry_rate: Carried interest rate applicable to this investor
        operating_contributed: Capital contributed for operations
        operating_recallable: Recallable operating capital
    """
    name: str
    commitment: Decimal = ZERO
    unit_class: str = ""
    unit_price: Decimal = ZERO
    units: Decimal = ZERO
    contributed: Decimal = ZERO
    capital_returned: Decimal = ZERO
    distributed: Decimal = ZERO
    profit_distributed: Decimal = ZERO
    management_fees: Decimal = ZERO
    carried_interest: Decimal = ZERO
    carry_clawback: Decimal = ZERO
    management_fee_rate: Decimal = ZERO
    carry_rate: Decimal = ZERO
    operating_contributed: Decimal = ZERO
    operating_recallable: Decimal = ZERO

    @property
    def available_commitment(self) -> Decimal:
        """Calculate remaining callable commitment."""
        effective_contributed = self.contributed - self.operating_recallable
        remaining = self.commitment - effective_contributed
        return remaining if remaining > ZERO else ZERO

    @property
    def outstanding_capital(self) -> Decimal:
        """Calculate net capital at risk."""
        outstanding = self.contributed - self.capital_returned
        return outstanding if outstanding > ZERO else ZERO

    @property
    def surplus_distributed(self) -> Decimal:
        """Calculate surplus (profit) distributed."""
        surplus = self.profit_distributed
        return surplus if surplus > ZERO else ZERO

    @property
    def fees_paid_from_proceeds(self) -> Decimal:
        """Operating capital that has been repaid from proceeds and is recallable."""
        return self.operating_recallable if self.operating_recallable > ZERO else ZERO

    @property
    def reporting_contributed(self) -> Decimal:
        """Contributed capital excluding fees that were funded by proceeds."""
        adjusted = self.contributed - self.fees_paid_from_proceeds
        return adjusted if adjusted > ZERO else ZERO

    @property
    def reporting_capital_returned(self) -> Decimal:
        """Capital returned excluding the portion tied to repaid operating calls."""
        adjusted = self.capital_returned - self.fees_paid_from_proceeds
        return adjusted if adjusted > ZERO else ZERO

    @property
    def reporting_outstanding_capital(self) -> Decimal:
        """Outstanding capital based on reporting definitions."""
        adjusted = self.reporting_contributed - self.reporting_capital_returned
        return adjusted if adjusted > ZERO else ZERO


@dataclass
class OrganizationalCostSchedule:
    """
    Tracks amortization schedule for organizational costs.
    
    Organizational costs are typically amortized over 60 months (5 years).
    
    Attributes:
        next_month: Next month for amortization
        periods_remaining: Number of periods left
        remaining_amount: Amount yet to be amortized
        total_amount: Original total amount
    """
    next_month: date
    periods_remaining: int
    remaining_amount: Decimal
    total_amount: Decimal
