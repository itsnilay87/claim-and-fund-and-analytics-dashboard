"""Standardised journal entry builders for fund activity."""

from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Optional

from .chart_of_accounts import ChartOfAccounts
from .journal import JournalEntry, JournalEntryLine


def _to_decimal(amount: float | Decimal) -> Decimal:
    return amount if isinstance(amount, Decimal) else Decimal(str(amount))


def _resolve_cash_account(chart: ChartOfAccounts, currency: str | None = None) -> str:
    if "1000" in chart:
        return "1000"
    if "1010" in chart:
        return "1010"
    if "1020" in chart:
        return "1020"
    return "1000"


def _resolve_investor_account(chart: ChartOfAccounts, investor_name: str) -> str:
    """Resolve investor name to capital account code using COA data.

    The mapping is derived from the chart of accounts by parsing account
    descriptions that match "Capital Account - {Investor Name}".
    """
    return chart.get_investor_account(investor_name)


def create_drawdown_entry(
    *,
    chart: ChartOfAccounts,
    investor_name: str,
    amount: float | Decimal,
    entry_date: date,
    memo: str = "Capital drawdown",
    currency: Optional[str] = None,
) -> JournalEntry:
    value = _to_decimal(amount)
    cash_account = _resolve_cash_account(chart, currency)
    investor_account = _resolve_investor_account(chart, investor_name)

    entry = JournalEntry(entry_date=entry_date, memo=memo)
    entry.add_line(JournalEntryLine(account_code=cash_account, debit=value))
    entry.add_line(JournalEntryLine(account_code=investor_account, credit=value))
    return entry


def create_distribution_entry(
    *,
    chart: ChartOfAccounts,
    investor_name: str,
    amount: float | Decimal,
    entry_date: date,
    memo: str = "Capital distribution",
    currency: Optional[str] = None,
) -> JournalEntry:
    value = _to_decimal(amount)
    cash_account = _resolve_cash_account(chart, currency)
    investor_account = _resolve_investor_account(chart, investor_name)

    entry = JournalEntry(entry_date=entry_date, memo=memo)
    entry.add_line(JournalEntryLine(account_code=investor_account, debit=value))
    entry.add_line(JournalEntryLine(account_code=cash_account, credit=value))
    return entry


def create_case_deployment_entry(
    *,
    chart: ChartOfAccounts,
    case_name: str,
    amount: float | Decimal,
    entry_date: date,
    memo: str | None = None,
    currency: Optional[str] = None,
) -> JournalEntry:
    value = _to_decimal(amount)
    cash_account = _resolve_cash_account(chart, currency)

    entry = JournalEntry(
        entry_date=entry_date,
        memo=memo or f"Deploy capital to {case_name}",
    )
    entry.add_line(JournalEntryLine(account_code="1350", debit=value))
    entry.add_line(JournalEntryLine(account_code=cash_account, credit=value))
    return entry


def create_case_recovery_entry(
    *,
    chart: ChartOfAccounts,
    case_name: str,
    capital_return: float | Decimal,
    gain_amount: float | Decimal,
    entry_date: date,
    memo: str | None = None,
    currency: Optional[str] = None,
) -> JournalEntry:
    capital_value = _to_decimal(capital_return)
    gain_value = _to_decimal(gain_amount)
    cash_account = _resolve_cash_account(chart, currency)

    entry = JournalEntry(
        entry_date=entry_date,
        memo=memo or f"Recovery from {case_name}",
    )

    if capital_value > 0:
        entry.add_line(JournalEntryLine(account_code=cash_account, debit=capital_value))
        entry.add_line(JournalEntryLine(account_code="1350", credit=capital_value))

    if gain_value > 0:
        entry.add_line(JournalEntryLine(account_code=cash_account, debit=gain_value))
        entry.add_line(JournalEntryLine(account_code="4000", credit=gain_value))

    if not entry.lines:
        raise ValueError("Case recovery entry requires either capital return or gain amount")

    return entry


def create_write_off_entry(
    *,
    chart: ChartOfAccounts,
    case_name: str,
    amount: float | Decimal,
    entry_date: date,
    memo: str | None = None,
) -> JournalEntry:
    value = _to_decimal(amount)
    entry = JournalEntry(
        entry_date=entry_date,
        memo=memo or f"Write-off for {case_name}",
    )
    entry.add_line(JournalEntryLine(account_code="5000", debit=value))
    entry.add_line(JournalEntryLine(account_code="1350", credit=value))
    return entry


def create_management_fee_entry(
    *,
    chart: ChartOfAccounts,
    amount: float | Decimal,
    entry_date: date,
    memo: str = "Accrue management fee",
    settle_in_cash: bool = False,
    gst_amount: float | Decimal = 0,
    currency: Optional[str] = None,
) -> JournalEntry:
    value = _to_decimal(amount)
    gst_value = _to_decimal(gst_amount) if gst_amount else Decimal("0")
    entry = JournalEntry(entry_date=entry_date, memo=memo)
    entry.add_line(JournalEntryLine(account_code="6900", debit=value))
    if gst_value > 0:
        entry.add_line(JournalEntryLine(account_code="6901", debit=gst_value))

    if settle_in_cash:
        if gst_value > 0:
            entry.add_line(JournalEntryLine(account_code="2450", credit=gst_value))
        cash_account = _resolve_cash_account(chart, currency)
        entry.add_line(JournalEntryLine(account_code=cash_account, credit=value))
    else:
        if gst_value > 0:
            raise ValueError("GST amount only supported when settling management fee in cash")
        entry.add_line(JournalEntryLine(account_code="2800", credit=value))
    return entry


def create_audit_fee_entry(
    *,
    chart: ChartOfAccounts,
    amount: float | Decimal,
    entry_date: date,
    memo: str = "Accrue audit fee",
    settle_in_cash: bool = False,
    gst_amount: float | Decimal = 0,
    currency: Optional[str] = None,
) -> JournalEntry:
    value = _to_decimal(amount)
    gst_value = _to_decimal(gst_amount) if gst_amount else Decimal("0")
    expense_amount = value + gst_value
    entry = JournalEntry(entry_date=entry_date, memo=memo)
    entry.add_line(JournalEntryLine(account_code="6820", debit=expense_amount))
    if settle_in_cash:
        if gst_value > 0:
            entry.add_line(JournalEntryLine(account_code="2450", credit=gst_value))
        cash_account = _resolve_cash_account(chart, currency)
        entry.add_line(JournalEntryLine(account_code=cash_account, credit=value))
    else:
        if gst_value > 0:
            raise ValueError("GST amount only supported when settling audit fee in cash")
        entry.add_line(JournalEntryLine(account_code="2100", credit=expense_amount))
    return entry


def create_fund_expense_entry(
    *,
    chart: ChartOfAccounts,
    account_code: str,
    amount: float | Decimal,
    entry_date: date,
    memo: str,
    gst_amount: float | Decimal = 0,
    currency: Optional[str] = None,
) -> JournalEntry:
    chart.require(account_code)
    value = _to_decimal(amount)
    gst_value = _to_decimal(gst_amount) if gst_amount else Decimal("0")
    expense_amount = value + gst_value
    cash_account = _resolve_cash_account(chart, currency)
    entry = JournalEntry(entry_date=entry_date, memo=memo)
    entry.add_line(JournalEntryLine(account_code=account_code, debit=expense_amount))
    if gst_value > 0:
        entry.add_line(JournalEntryLine(account_code="2450", credit=gst_value))
    entry.add_line(JournalEntryLine(account_code=cash_account, credit=value))
    return entry


def create_carried_interest_accrual(
    *,
    chart: ChartOfAccounts,
    amount: float | Decimal,
    entry_date: date,
    memo: str = "Accrue carried interest",
) -> JournalEntry:
    value = _to_decimal(amount)
    entry = JournalEntry(entry_date=entry_date, memo=memo)
    entry.add_line(JournalEntryLine(account_code="6910", debit=value))
    entry.add_line(JournalEntryLine(account_code="2820", credit=value))
    return entry


def create_carried_interest_distribution(
    *,
    chart: ChartOfAccounts,
    amount: float | Decimal,
    entry_date: date,
    memo: str = "Distribute carried interest",
    investor_name: Optional[str] = None,
) -> JournalEntry:
    value = _to_decimal(amount)
    account_name = investor_name or "Sponsor"
    equity_account = _resolve_investor_account(chart, account_name)
    entry = JournalEntry(entry_date=entry_date, memo=memo)
    entry.add_line(JournalEntryLine(account_code="2820", debit=value))
    entry.add_line(JournalEntryLine(account_code=equity_account, credit=value))
    return entry
