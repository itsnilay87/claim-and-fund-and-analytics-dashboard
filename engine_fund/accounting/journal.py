"""Journal entry primitives."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal, ROUND_HALF_UP
from typing import Iterable, List, Optional


@dataclass(frozen=True)
class JournalEntryLine:
    """Represents a single debit or credit within a journal entry."""

    account_code: str
    debit: Decimal = Decimal("0")
    credit: Decimal = Decimal("0")

    def __post_init__(self) -> None:
        if self.debit < 0 or self.credit < 0:
            raise ValueError("Debit and credit amounts must be non-negative")
        if self.debit > 0 and self.credit > 0:
            raise ValueError("A line cannot have both debit and credit values set")

    @property
    def amount(self) -> Decimal:
        return self.debit if self.debit > 0 else self.credit

    @property
    def is_debit(self) -> bool:
        return self.debit > 0

    @property
    def is_credit(self) -> bool:
        return self.credit > 0


@dataclass
class JournalEntry:
    """Container for a balanced journal entry."""

    entry_date: date
    memo: str
    lines: List[JournalEntryLine] = field(default_factory=list)
    reference: Optional[str] = None
    entry_number: Optional[int] = None

    def add_line(self, line: JournalEntryLine) -> None:
        self.lines.append(line)

    def extend(self, lines: Iterable[JournalEntryLine]) -> None:
        for line in lines:
            self.add_line(line)

    @property
    def total_debits(self) -> Decimal:
        return sum((line.debit for line in self.lines), start=Decimal("0"))

    @property
    def total_credits(self) -> Decimal:
        return sum((line.credit for line in self.lines), start=Decimal("0"))

    def is_balanced(self, tolerance: Decimal = Decimal("0.01")) -> bool:
        difference = (self.total_debits - self.total_credits).copy_abs().quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        return difference <= tolerance

    def validate_balanced(self) -> None:
        if not self.is_balanced():
            raise ValueError(
                f"Journal entry out of balance: debits {self.total_debits} != credits {self.total_credits}"
            )
