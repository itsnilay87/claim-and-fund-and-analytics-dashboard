"""Chart of accounts utilities."""

from __future__ import annotations

import csv
import re
from dataclasses import dataclass
from decimal import Decimal
from pathlib import Path
from typing import Dict, Iterable, Optional


_CAPITAL_ACCOUNT_PREFIX = "Capital Account - "


@dataclass(frozen=True)
class Account:
    """Representation of a single account in the ledger."""

    code: str
    description: str
    posting_type: str
    category: str
    default_side: str
    status: str

    @property
    def is_active(self) -> bool:
        return self.status.upper() == "ACTIVE"

    @property
    def normal_balance(self) -> str:
        side = self.default_side.upper()
        if side not in {"DEBIT", "CREDIT"}:
            return "DEBIT"
        return side

    @property
    def is_balance_sheet(self) -> bool:
        return self.posting_type.lower() == "balance sheet"

    @property
    def is_income_statement(self) -> bool:
        return self.posting_type.lower() == "profit and loss"


class ChartOfAccounts:
    """Lightweight chart-of-accounts loader and accessor."""

    def __init__(self, accounts: Dict[str, Account]):
        self._accounts = accounts
        self._investor_account_map: Dict[str, str] = {}
        self._build_investor_map()

    def _build_investor_map(self) -> None:
        """Build investor name → account code mapping from account descriptions."""
        for code, account in self._accounts.items():
            if account.description.startswith(_CAPITAL_ACCOUNT_PREFIX):
                investor_name = account.description[len(_CAPITAL_ACCOUNT_PREFIX):].strip()
                normalised = investor_name.lower()
                self._investor_account_map[normalised] = code

    def __contains__(self, code: str) -> bool:
        return code in self._accounts

    def __getitem__(self, code: str) -> Account:
        return self._accounts[code]

    def get(self, code: str) -> Optional[Account]:
        return self._accounts.get(code)

    def active_accounts(self) -> Iterable[Account]:
        return (acct for acct in self._accounts.values() if acct.is_active)

    @classmethod
    def from_csv(cls, csv_path: Path) -> "ChartOfAccounts":
        accounts: Dict[str, Account] = {}
        with csv_path.open(newline="", encoding="utf-8") as handle:
            reader = csv.DictReader(handle)
            for row in reader:
                account = Account(
                    code=row["Code"],
                    description=row["Account Description"],
                    posting_type=row["Posting Type"],
                    category=row["Account Category Number"],
                    default_side=row["Default"],
                    status=row["Status"],
                )
                accounts[account.code] = account
        return cls(accounts)

    @classmethod
    def load_default(cls) -> "ChartOfAccounts":
        base_dir = Path(__file__).resolve().parents[3]
        csv_path = base_dir / "accounts" / "COA.csv"
        if not csv_path.exists():
            raise FileNotFoundError(f"Chart of accounts CSV not found at {csv_path}")
        return cls.from_csv(csv_path)

    def require(self, code: str) -> Account:
        try:
            return self._accounts[code]
        except KeyError as exc:
            raise KeyError(f"Account code '{code}' not found in chart of accounts") from exc

    def is_debit_account(self, code: str) -> bool:
        return self.require(code).normal_balance == "DEBIT"

    def is_credit_account(self, code: str) -> bool:
        return self.require(code).normal_balance == "CREDIT"

    def get_investor_account(self, investor_name: str) -> str:
        """Look up the capital account code for the given investor name.

        The mapping is built automatically from account descriptions matching
        the pattern "Capital Account - {Investor Name}".

        Parameters
        ----------
        investor_name
            The investor's name (case-insensitive).

        Returns
        -------
        str
            The account code associated with the investor.

        Raises
        ------
        KeyError
            If no capital account is defined for the investor.
        """
        normalised = investor_name.strip().lower()
        code = self._investor_account_map.get(normalised)
        if code is None:
            raise KeyError(
                f"No capital account found for investor '{investor_name}'. "
                f"Add a row to COA.csv with description '{_CAPITAL_ACCOUNT_PREFIX}{investor_name}'."
            )
        return code

    def list_investor_accounts(self) -> Dict[str, str]:
        """Return a copy of the investor name → account code mapping."""
        return dict(self._investor_account_map)