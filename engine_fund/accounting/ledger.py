"""General ledger and reporting helpers."""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from typing import Dict, Iterable, List, Tuple

from .chart_of_accounts import Account, ChartOfAccounts
from .journal import JournalEntry, JournalEntryLine


@dataclass
class LedgerPosting:
    entry: JournalEntry
    lines: List[JournalEntryLine]


class Ledger:
    """Tracks account balances and provides basic financial statements."""

    def __init__(self, chart: ChartOfAccounts):
        self.chart = chart
        self._balances: Dict[str, Decimal] = defaultdict(Decimal)
        self._postings: List[LedgerPosting] = []

    def post(self, entry: JournalEntry, *, validate: bool = True) -> None:
        if validate:
            entry.validate_balanced()
        for line in entry.lines:
            self._apply_line(line)
        self._postings.append(LedgerPosting(entry=entry, lines=list(entry.lines)))

    def _apply_line(self, line: JournalEntryLine) -> None:
        amount = line.debit - line.credit
        self._balances[line.account_code] = self._balances[line.account_code] + amount

    def get_balance(self, account_code: str) -> Decimal:
        return self._balances.get(account_code, Decimal("0"))

    def trial_balance(self) -> List[Tuple[Account, Decimal]]:
        return [(self.chart.require(code), balance) for code, balance in sorted(self._balances.items())]

    def balance_sheet(self) -> Dict[str, Decimal]:
        assets = Decimal("0")
        liabilities_equity = Decimal("0")
        for account, balance in self.trial_balance():
            if not account.is_balance_sheet:
                continue
            if account.normal_balance == "DEBIT":
                assets += balance
            else:
                liabilities_equity += -balance
        return {
            "assets": assets,
            "liabilities_and_equity": liabilities_equity,
        }

    def income_statement(self) -> Dict[str, Decimal]:
        income = Decimal("0")
        expense = Decimal("0")
        for account, balance in self.trial_balance():
            if not account.is_income_statement:
                continue
            if account.normal_balance == "CREDIT":
                income += -balance
            else:
                expense += balance
        return {
            "income": income,
            "expense": expense,
            "net_income": income - expense,
        }

    def postings(self) -> Iterable[LedgerPosting]:
        return list(self._postings)
