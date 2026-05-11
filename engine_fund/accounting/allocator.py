"""Allocation strategies for fund capital flows."""

from __future__ import annotations

from decimal import Decimal, ROUND_HALF_UP
from typing import List, Tuple, TYPE_CHECKING

from .utils import CENT, ZERO

if TYPE_CHECKING:
    from .models import InvestorState


class ProRataAllocator:
    """
    Allocates capital flows pro-rata among investors.
    
    This class implements pro-rata allocation logic for:
    - Capital calls (drawdowns)
    - Return of capital distributions
    - Surplus/profit distributions
    
    All allocations ensure the total is exactly distributed with no
    rounding leakage by assigning any remainder to the last investor.
    """

    def allocate_drawdown(
        self,
        investors: List["InvestorState"],
        total_amount: Decimal,
    ) -> List[Tuple["InvestorState", Decimal]]:
        """
        Allocate a drawdown amount pro-rata based on available commitment.
        
        Args:
            investors: List of investor states
            total_amount: Total amount to draw down
            
        Returns:
            List of (investor, amount) tuples
            
        Raises:
            ValueError: If no investors have remaining commitments
        """
        available = [inv for inv in investors if inv.available_commitment > ZERO]
        if not available:
            raise ValueError("No remaining investor commitments to fund drawdown")

        total_available = sum(inv.available_commitment for inv in available)
        remaining = total_amount
        allocations: List[Tuple["InvestorState", Decimal]] = []

        for index, investor in enumerate(available):
            if index == len(available) - 1:
                # Last investor gets the remainder to avoid rounding issues
                allocated = remaining
            else:
                weight = (
                    investor.available_commitment / total_available
                    if total_available > ZERO
                    else ZERO
                )
                allocated = (total_amount * weight).quantize(CENT, rounding=ROUND_HALF_UP)
                allocated = min(allocated, investor.available_commitment, remaining)
            
            if allocated > ZERO:
                allocations.append((investor, allocated))
                remaining -= allocated

        # Handle any remaining amount due to rounding
        if remaining > CENT and allocations:
            investor, current = allocations[-1]
            allocations[-1] = (investor, (current + remaining).quantize(CENT, rounding=ROUND_HALF_UP))

        return allocations

    def allocate_return_of_capital(
        self,
        investors: List["InvestorState"],
        total_amount: Decimal,
    ) -> List[Tuple["InvestorState", Decimal]]:
        """
        Allocate return of capital pro-rata based on outstanding capital.
        
        Args:
            investors: List of investor states
            total_amount: Total amount to return
            
        Returns:
            List of (investor, amount) tuples
        """
        eligible = [inv for inv in investors if inv.outstanding_capital > ZERO]
        if not eligible:
            return []

        total_basis = sum((inv.outstanding_capital for inv in eligible), start=ZERO)
        remaining = total_amount
        allocations: List[Tuple["InvestorState", Decimal]] = []

        for index, investor in enumerate(eligible):
            if index == len(eligible) - 1:
                allocated = remaining
            else:
                weight = investor.outstanding_capital / total_basis if total_basis > ZERO else ZERO
                allocated = (total_amount * weight).quantize(CENT, rounding=ROUND_HALF_UP)
                allocated = min(allocated, investor.outstanding_capital, remaining)
            
            if allocated > ZERO:
                allocations.append((investor, allocated))
                remaining -= allocated

        if remaining > CENT and allocations:
            investor, current = allocations[-1]
            allocations[-1] = (investor, (current + remaining).quantize(CENT, rounding=ROUND_HALF_UP))

        return allocations

    def allocate_surplus_to_lps(
        self,
        investors: List["InvestorState"],
        total_amount: Decimal,
    ) -> List[Tuple["InvestorState", Decimal]]:
        """
        Allocate surplus/profit pro-rata based on commitment.
        
        Args:
            investors: List of investor states
            total_amount: Total surplus amount to allocate
            
        Returns:
            List of (investor, amount) tuples
        """
        eligible = [inv for inv in investors if inv.commitment > ZERO]
        if not eligible:
            eligible = list(investors)

        total_basis = sum((inv.commitment for inv in eligible), start=ZERO)
        if total_basis <= ZERO:
            return []

        remaining = total_amount
        allocations: List[Tuple["InvestorState", Decimal]] = []

        for index, investor in enumerate(eligible):
            if index == len(eligible) - 1:
                allocated = remaining
            else:
                weight = investor.commitment / total_basis if total_basis > ZERO else ZERO
                allocated = (total_amount * weight).quantize(CENT, rounding=ROUND_HALF_UP)
                allocated = min(allocated, remaining)
            
            if allocated > ZERO:
                allocations.append((investor, allocated))
                remaining -= allocated

        if remaining > CENT and allocations:
            investor, current = allocations[-1]
            allocations[-1] = (investor, (current + remaining).quantize(CENT, rounding=ROUND_HALF_UP))

        return allocations

    def allocate_distribution(
        self,
        investors: List["InvestorState"],
        total_amount: Decimal,
    ) -> List[Tuple["InvestorState", Decimal]]:
        """
        Allocate distribution pro-rata based on outstanding capital or commitment.
        
        Uses outstanding_capital as primary basis, falls back to contributed or
        commitment if no outstanding capital exists.
        
        Args:
            investors: List of investor states
            total_amount: Total amount to distribute
            
        Returns:
            List of (investor, amount) tuples
            
        Raises:
            ValueError: If unable to determine allocation basis
        """
        if total_amount <= ZERO:
            return []

        # Determine allocation basis
        base_values = [inv.outstanding_capital for inv in investors]
        total_base = sum(base_values)
        
        if total_base <= ZERO:
            # Fall back to contributed or commitment
            base_values = [
                inv.contributed if inv.contributed > ZERO else inv.commitment
                for inv in investors
            ]
            total_base = sum(base_values)

        if total_base <= ZERO:
            raise ValueError("Cannot allocate distribution without investor commitments")

        remaining = total_amount
        allocations: List[Tuple["InvestorState", Decimal]] = []

        for index, investor in enumerate(investors):
            weight = base_values[index] / total_base if total_base > ZERO else ZERO
            
            if index == len(investors) - 1:
                allocated = remaining
            else:
                allocated = (total_amount * weight).quantize(CENT, rounding=ROUND_HALF_UP)
                allocated = min(allocated, remaining)
            
            if allocated > ZERO:
                allocations.append((investor, allocated))
                remaining -= allocated

        if remaining > CENT and allocations:
            investor, current = allocations[-1]
            allocations[-1] = (investor, (current + remaining).quantize(CENT, rounding=ROUND_HALF_UP))

        return allocations
