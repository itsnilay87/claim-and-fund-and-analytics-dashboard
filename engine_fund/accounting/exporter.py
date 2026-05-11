"""Export functionality for fund bookkeeper data."""

from __future__ import annotations

from collections import defaultdict
from decimal import Decimal
from typing import TYPE_CHECKING, Dict, List

import pandas as pd

from .utils import ZERO

if TYPE_CHECKING:
    from .bookkeeper import FundBookkeeper
    from .models import InvestorState


class BookkeeperExporter:
    """
    Handles export of bookkeeper data to pandas DataFrames.
    
    This class extracts reporting logic from FundBookkeeper to maintain
    separation of concerns between accounting operations and data export.
    """

    def __init__(self, bookkeeper: "FundBookkeeper") -> None:
        """
        Initialize exporter with reference to bookkeeper.
        
        Args:
            bookkeeper: The FundBookkeeper instance to export data from
        """
        self._bookkeeper = bookkeeper

    @property
    def ledger(self):
        """Access the bookkeeper's ledger."""
        return self._bookkeeper.ledger

    @property
    def chart(self):
        """Access the bookkeeper's chart of accounts."""
        return self._bookkeeper.chart

    @property
    def investors(self) -> List["InvestorState"]:
        """Access the bookkeeper's investor list."""
        return self._bookkeeper._investors

    @property
    def investor_events(self) -> List[dict]:
        """Access the bookkeeper's investor events."""
        return self._bookkeeper._investor_events

    def export_ledger_lines(self) -> pd.DataFrame:
        """
        Return posted journal lines as a DataFrame.
        
        Returns:
            DataFrame with columns: date, reference, memo, entry_number,
            account_code, debit, credit
        """
        records: List[Dict[str, object]] = []
        for posting in self.ledger.postings():
            entry = posting.entry
            for line in posting.lines:
                records.append(
                    {
                        "date": entry.entry_date.isoformat(),
                        "reference": entry.reference or "",
                        "memo": entry.memo,
                        "entry_number": entry.entry_number,
                        "account_code": line.account_code,
                        "debit": float(line.debit),
                        "credit": float(line.credit),
                    }
                )
        columns = [
            "date",
            "reference",
            "memo",
            "entry_number",
            "account_code",
            "debit",
            "credit",
        ]
        return pd.DataFrame.from_records(records, columns=columns)

    def export_trial_balance(self) -> pd.DataFrame:
        """
        Return the current trial balance as a DataFrame.
        
        Returns:
            DataFrame with columns: account_code, description, normal_balance,
            debits, credits, balance
        """
        debit_totals: Dict[str, Decimal] = defaultdict(Decimal)
        credit_totals: Dict[str, Decimal] = defaultdict(Decimal)

        for posting in self.ledger.postings():
            for line in posting.lines:
                if line.debit > ZERO:
                    debit_totals[line.account_code] = (
                        debit_totals[line.account_code] + line.debit
                    )
                if line.credit > ZERO:
                    credit_totals[line.account_code] = (
                        credit_totals[line.account_code] + line.credit
                    )

        account_codes = sorted(set(debit_totals) | set(credit_totals))
        records: List[Dict[str, object]] = []
        total_debits = ZERO
        total_credits = ZERO

        for code in account_codes:
            account = self.chart.require(code)
            debits = debit_totals.get(code, ZERO)
            credits = credit_totals.get(code, ZERO)
            balance = debits - credits
            total_debits += debits
            total_credits += credits
            records.append(
                {
                    "account_code": account.code,
                    "description": account.description,
                    "normal_balance": account.normal_balance,
                    "debits": float(debits),
                    "credits": float(credits),
                    "balance": float(balance),
                }
            )

        records.append(
            {
                "account_code": "TOTAL",
                "description": "Total",
                "normal_balance": "",
                "debits": float(total_debits),
                "credits": float(total_credits),
                "balance": float(total_debits - total_credits),
            }
        )

        columns = ["account_code", "description", "normal_balance", "debits", "credits", "balance"]
        return pd.DataFrame.from_records(records, columns=columns)

    def export_capital_accounts(self) -> pd.DataFrame:
        """
        Summarise investor capital activity.
        
        Returns:
            DataFrame with columns: investor, commitment, contributed,
            capital_returned, profit_distributed, management_fees,
            carried_interest, distributed, outstanding. Contributed and
            capital_returned exclude any operating drawdowns that were
            repaid from proceeds.
        """
        records: List[Dict[str, object]] = []
        for investor in self.investors:
            records.append(
                {
                    "investor": investor.name,
                    "commitment": float(investor.commitment),
                    "contributed": float(investor.reporting_contributed),
                    "capital_returned": float(investor.reporting_capital_returned),
                    "profit_distributed": float(investor.profit_distributed),
                    "management_fees": float(investor.management_fees),
                    "carried_interest": float(getattr(investor, "carried_interest", ZERO)),
                    "distributed": float(investor.distributed),
                    "outstanding": float(investor.reporting_outstanding_capital),
                }
            )
        columns = [
            "investor",
            "commitment",
            "contributed",
            "capital_returned",
            "profit_distributed",
            "management_fees",
            "carried_interest",
            "distributed",
            "outstanding",
        ]
        return pd.DataFrame.from_records(records, columns=columns)

    def export_investor_subledger(self) -> pd.DataFrame:
        """
        Return detailed investor-level activity suitable for diagnostics exports.
        
        Returns:
            DataFrame with columns: investor, date, event_type, amount,
            entry_number, reference, memo
        """
        if not self.investor_events:
            columns = ["investor", "date", "event_type", "amount", "entry_number", "reference", "memo"]
            return pd.DataFrame(columns=columns)

        ordered = sorted(
            self.investor_events,
            key=lambda item: (item["date"], item["entry_number"], item.get("sequence", 0)),
        )
        records = [
            {key: value for key, value in record.items() if key != "sequence"}
            for record in ordered
        ]
        columns = ["investor", "date", "event_type", "amount", "entry_number", "reference", "memo"]
        return pd.DataFrame.from_records(records, columns=columns)
