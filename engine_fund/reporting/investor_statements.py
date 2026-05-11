"""Investor statement PDF generator.

This module generates professional investor statement PDFs with comprehensive
metrics, KPIs, tables, and visualizations following best practices for fund
investor reporting.
"""

from __future__ import annotations

import io
from datetime import datetime
from pathlib import Path
from typing import TYPE_CHECKING, Any, Dict, List, Optional, Tuple

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.dates as mdates
from matplotlib import font_manager as fm
from matplotlib.ticker import FuncFormatter
import numpy as np
import pandas as pd

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch, mm
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT, TA_JUSTIFY
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    Image,
    KeepTogether,
    PageBreak,
    PageTemplate,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)
from reportlab.graphics.shapes import Drawing, Line

if TYPE_CHECKING:
    from ..core.models import Fund


# Color scheme
BRAND_PRIMARY = colors.HexColor("#1a365d")  # Dark navy blue
BRAND_SECONDARY = colors.HexColor("#2c5282")  # Medium blue
BRAND_ACCENT = colors.HexColor("#38a169")  # Green for positive values
BRAND_NEGATIVE = colors.HexColor("#c53030")  # Red for negative values
BRAND_LIGHT = colors.HexColor("#e2e8f0")  # Light gray background
BRAND_TEXT = colors.HexColor("#2d3748")  # Dark text

FONT_REGULAR = "Helvetica"
FONT_BOLD = "Helvetica-Bold"


def _register_fonts() -> None:
    """Register a font that supports the INR symbol."""
    if getattr(_register_fonts, "_done", False):
        return
    try:
        regular_path = fm.findfont("DejaVu Sans", fallback_to_default=True)
        bold_path = fm.findfont("DejaVu Sans:bold", fallback_to_default=True)
        if regular_path:
            pdfmetrics.registerFont(TTFont("DejaVuSans", regular_path))
        if bold_path:
            pdfmetrics.registerFont(TTFont("DejaVuSans-Bold", bold_path))
        global FONT_REGULAR, FONT_BOLD
        if regular_path:
            FONT_REGULAR = "DejaVuSans"
        if bold_path:
            FONT_BOLD = "DejaVuSans-Bold"
    except Exception:
        FONT_REGULAR = "Helvetica"
        FONT_BOLD = "Helvetica-Bold"
    _register_fonts._done = True


def _format_currency(value: float, currency: str = "INR", decimals: int = 0) -> str:
    """Format a number as currency without abbreviating units."""
    if pd.isna(value) or value == 0:
        return "-"

    amount = float(value)
    prefix = "₹" if currency.upper() == "INR" else "$"
    return f"{prefix}{amount:,.{decimals}f}"


def _format_crore(value: float, currency: str = "INR", decimals: int = 1) -> str:
    """Format a number in crores for KPI readability."""
    if pd.isna(value) or value == 0:
        return "-"
    amount = float(value)
    prefix = "₹" if currency.upper() == "INR" else "$"
    return f"{prefix}{amount / 1e7:,.{decimals}f} Cr"


def _format_percentage(value: float, decimals: int = 2) -> str:
    """Format a number as percentage."""
    if pd.isna(value):
        return "-"
    return f"{value * 100:.{decimals}f}%"


def _format_number(value: float, decimals: int = 2) -> str:
    """Format a number with commas."""
    if pd.isna(value):
        return "-"
    return f"{value:,.{decimals}f}"


def _format_date(date_value: Any) -> str:
    """Format a date value."""
    if pd.isna(date_value):
        return "-"
    if isinstance(date_value, str):
        try:
            date_value = pd.to_datetime(date_value)
        except (ValueError, TypeError):
            return str(date_value)
    if hasattr(date_value, "strftime"):
        return date_value.strftime("%d %b %Y")
    return str(date_value)


def _get_styles() -> Dict[str, ParagraphStyle]:
    """Create custom paragraph styles."""
    _register_fonts()
    styles = getSampleStyleSheet()
    
    custom_styles = {
        "Title": ParagraphStyle(
            "CustomTitle",
            parent=styles["Heading1"],
            fontSize=24,
            textColor=BRAND_PRIMARY,
            spaceAfter=12,
            alignment=TA_CENTER,
            fontName=FONT_BOLD,
        ),
        "Subtitle": ParagraphStyle(
            "CustomSubtitle",
            parent=styles["Heading2"],
            fontSize=14,
            textColor=BRAND_SECONDARY,
            spaceAfter=6,
            alignment=TA_CENTER,
            fontName=FONT_REGULAR,
        ),
        "SectionHeader": ParagraphStyle(
            "SectionHeader",
            parent=styles["Heading2"],
            fontSize=14,
            textColor=BRAND_PRIMARY,
            spaceBefore=12,
            spaceAfter=8,
            fontName=FONT_BOLD,
            borderPadding=4,
        ),
        "BodyText": ParagraphStyle(
            "CustomBody",
            parent=styles["Normal"],
            fontSize=10,
            textColor=BRAND_TEXT,
            spaceBefore=2,
            spaceAfter=2,
            fontName=FONT_REGULAR,
            leading=12,
        ),
        "TableHeader": ParagraphStyle(
            "TableHeader",
            parent=styles["Normal"],
            fontSize=9,
            textColor=colors.white,
            fontName=FONT_BOLD,
            alignment=TA_CENTER,
        ),
        "TableCell": ParagraphStyle(
            "TableCell",
            parent=styles["Normal"],
            fontSize=9,
            textColor=BRAND_TEXT,
            fontName=FONT_REGULAR,
            alignment=TA_RIGHT,
        ),
        "TableCellLeft": ParagraphStyle(
            "TableCellLeft",
            parent=styles["Normal"],
            fontSize=9,
            textColor=BRAND_TEXT,
            fontName=FONT_REGULAR,
            alignment=TA_LEFT,
        ),
        "KPIValue": ParagraphStyle(
            "KPIValue",
            parent=styles["Normal"],
            fontSize=16,
            textColor=BRAND_PRIMARY,
            fontName=FONT_BOLD,
            alignment=TA_CENTER,
        ),
        "KPILabel": ParagraphStyle(
            "KPILabel",
            parent=styles["Normal"],
            fontSize=9,
            textColor=BRAND_SECONDARY,
            fontName=FONT_REGULAR,
            alignment=TA_CENTER,
        ),
        "Footer": ParagraphStyle(
            "Footer",
            parent=styles["Normal"],
            fontSize=8,
            textColor=colors.gray,
            fontName=FONT_REGULAR,
            alignment=TA_CENTER,
        ),
        "Disclaimer": ParagraphStyle(
            "Disclaimer",
            parent=styles["Normal"],
            fontSize=7,
            textColor=colors.gray,
            fontName=FONT_REGULAR,
            alignment=TA_JUSTIFY,
            spaceBefore=12,
        ),
    }
    
    return custom_styles


class InvestorStatementGenerator:
    """Generate professional PDF investor statements.
    
    This class creates comprehensive investor statements including:
    - Executive summary with key metrics
    - Capital account summary
    - Transaction history
    - Performance charts
    - Waterfall analysis
    - Fund overview
    """
    
    def __init__(
        self,
        fund_name: str,
        fund_metadata: Dict[str, Any],
        fund_metrics: Dict[str, Any],
        statement_date: Optional[datetime] = None,
        currency: str = "INR",
        valuation_currency: str = "INR",
    ):
        """Initialize the statement generator.
        
        Args:
            fund_name: Name of the fund.
            fund_metadata: Fund metadata dictionary.
            fund_metrics: Fund metrics dictionary.
            statement_date: Date for the statement (defaults to today).
            currency: Currency code for formatting.
        """
        self.fund_name = fund_name
        self.fund_metadata = fund_metadata
        self.fund_metrics = fund_metrics
        if statement_date is not None:
            self.statement_date = statement_date
        else:
            # Default to last date available in fund metadata timeseries if present
            last_date = None
            try:
                timeseries = fund_metrics.get("timeseries") or {}
                if isinstance(timeseries, dict) and timeseries.get("date") is not None:
                    dates = pd.to_datetime(timeseries.get("date"))
                    if len(dates) > 0:
                        last_date = dates.max()
            except Exception:
                last_date = None
            self.statement_date = last_date if last_date is not None else datetime.now()
        self.currency = currency
        self.valuation_currency = valuation_currency
        self.styles = _get_styles()
        self.page_width, self.page_height = letter
        
    def _create_header_footer(self, canvas, doc) -> None:
        """Add header and footer to each page."""
        _register_fonts()
        canvas.saveState()
        
        # Header line
        canvas.setStrokeColor(BRAND_PRIMARY)
        canvas.setLineWidth(2)
        canvas.line(0.5 * inch, self.page_height - 0.5 * inch, 
                   self.page_width - 0.5 * inch, self.page_height - 0.5 * inch)
        
        # Fund name in header
        canvas.setFont("Helvetica-Bold", 10)
        canvas.setFillColor(BRAND_PRIMARY)
        canvas.setFont(FONT_BOLD, 10)
        canvas.drawString(0.75 * inch, self.page_height - 0.4 * inch, self.fund_name)
        
        # Statement date in header
        canvas.setFont(FONT_REGULAR, 9)
        canvas.setFillColor(BRAND_TEXT)
        date_str = f"Statement Date: {self.statement_date.strftime('%d %B %Y')}"
        canvas.drawRightString(self.page_width - 0.75 * inch, 
                               self.page_height - 0.4 * inch, date_str)
        
        # Footer line
        canvas.setStrokeColor(BRAND_LIGHT)
        canvas.setLineWidth(1)
        canvas.line(0.5 * inch, 0.65 * inch, 
                   self.page_width - 0.5 * inch, 0.65 * inch)
        
        # Page number
        canvas.setFont(FONT_REGULAR, 8)
        canvas.setFillColor(colors.gray)
        page_num = f"Page {doc.page}"
        canvas.drawCentredString(self.page_width / 2, 0.4 * inch, page_num)
        
        # Confidential notice
        canvas.setFont(FONT_REGULAR, 7)
        canvas.drawString(0.75 * inch, 0.4 * inch, "CONFIDENTIAL")
        
        canvas.restoreState()
    
    def _build_kpi_box(
        self,
        value: str,
        label: str,
        width: float = 1.5 * inch * 1.25,
    ) -> Table:
        """Create a KPI display box."""
        data = [
            [Paragraph(value, self.styles["KPIValue"])],
            [Paragraph(label, self.styles["KPILabel"])],
        ]
        
        table = Table(data, colWidths=[width])
        table.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), BRAND_LIGHT),
            ("BOX", (0, 0), (-1, -1), 1, BRAND_SECONDARY),
            ("TOPPADDING", (0, 0), (-1, -1), 8),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
            ("LEFTPADDING", (0, 0), (-1, -1), 6),
            ("RIGHTPADDING", (0, 0), (-1, -1), 6),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ]))
        
        return table
    
    def _build_kpi_row(
        self,
        kpis: List[Tuple[str, str]],
        col_width: float = 1.3 * inch * 1.25,
    ) -> Table:
        """Create a row of KPI boxes."""
        boxes = [self._build_kpi_box(value, label, col_width) for value, label in kpis]
        
        outer_table = Table([boxes], colWidths=[col_width + 4] * len(boxes))
        outer_table.setStyle(TableStyle([
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("ALIGN", (0, 0), (-1, -1), "CENTER"),
            ("LEFTPADDING", (0, 0), (-1, -1), 4),
            ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ]))
        
        return outer_table
    
    def _build_data_table(
        self,
        headers: List[str],
        data: List[List[str]],
        col_widths: Optional[List[float]] = None,
        highlight_totals: bool = False,
    ) -> Table:
        """Create a formatted data table."""
        # Create header row with styled paragraphs
        header_row = [Paragraph(h, self.styles["TableHeader"]) for h in headers]
        
        # Create data rows
        table_data = [header_row]
        for i, row in enumerate(data):
            styled_row = []
            for j, cell in enumerate(row):
                if j == 0:
                    styled_row.append(Paragraph(str(cell), self.styles["TableCellLeft"]))
                else:
                    styled_row.append(Paragraph(str(cell), self.styles["TableCell"]))
            table_data.append(styled_row)
        
        # Calculate column widths if not provided
        if col_widths is None:
            available_width = self.page_width - 1.5 * inch
            col_widths = [available_width / len(headers)] * len(headers)
        
        table = Table(table_data, colWidths=col_widths)
        
        # Define table style
        style_commands = [
            # Header styling
            ("BACKGROUND", (0, 0), (-1, 0), BRAND_PRIMARY),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("FONTNAME", (0, 0), (-1, 0), FONT_BOLD),
            ("FONTSIZE", (0, 0), (-1, 0), 9),
            ("ALIGN", (0, 0), (-1, 0), "CENTER"),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            
            # Body styling
            ("FONTNAME", (0, 1), (-1, -1), FONT_REGULAR),
            ("FONTSIZE", (0, 1), (-1, -1), 9),
            ("ALIGN", (0, 1), (0, -1), "LEFT"),
            ("ALIGN", (1, 1), (-1, -1), "RIGHT"),
            
            # Grid
            ("GRID", (0, 0), (-1, -1), 0.5, BRAND_LIGHT),
            ("BOX", (0, 0), (-1, -1), 1, BRAND_SECONDARY),
            
            # Padding
            ("TOPPADDING", (0, 0), (-1, -1), 4),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
            ("LEFTPADDING", (0, 0), (-1, -1), 6),
            ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ]
        
        # Alternate row colors
        for i in range(1, len(table_data)):
            if i % 2 == 0:
                style_commands.append(
                    ("BACKGROUND", (0, i), (-1, i), colors.HexColor("#f7fafc"))
                )
        
        # Highlight totals row if requested
        if highlight_totals and len(table_data) > 1:
            style_commands.extend([
                ("BACKGROUND", (0, -1), (-1, -1), BRAND_LIGHT),
                ("FONTNAME", (0, -1), (-1, -1), FONT_BOLD),
            ])
        
        table.setStyle(TableStyle(style_commands))
        
        return table
    
    def _create_cashflow_chart(
        self,
        timeseries: pd.DataFrame,
        width: float = 6.5,
        height: float = 3.0,
    ) -> Optional[Image]:
        """Create a cashflow chart as an image."""
        try:
            if timeseries.empty:
                return None
            
            fig, ax = plt.subplots(figsize=(width, height))
            
            # Get data
            dates = pd.to_datetime(timeseries.index)
            
            # Plot drawdowns and distributions
            if "drawdowns" in timeseries.columns:
                drawdowns = timeseries["drawdowns"].astype(float).fillna(0).cumsum()
                ax.fill_between(
                    dates,
                    0,
                    -drawdowns / 1e7,
                    alpha=0.6,
                    color="#c53030",
                    label="Contributions",
                )
            
            distributions = pd.Series(0.0, index=timeseries.index)
            for col in ["return_of_capital", "profit_distribution", "carry_income"]:
                if col in timeseries.columns:
                    distributions = distributions + timeseries[col].astype(float).fillna(0)
            
            if distributions.sum() > 0:
                ax.fill_between(
                    dates,
                    0,
                    distributions.cumsum() / 1e7,
                    alpha=0.6,
                    color="#38a169",
                    label="Distributions",
                )
            
            # Net position
            if "net_cashflow" in timeseries.columns:
                net_cf = timeseries["net_cashflow"].astype(float).fillna(0).cumsum()
                ax.plot(
                    dates,
                    net_cf / 1e7,
                    color="#1a365d",
                    linewidth=2,
                    label="Net Position",
                )
            
            # NAV line
            if "nav" in timeseries.columns:
                nav_series = timeseries["nav"].astype(float).fillna(0)
                ax.plot(
                    dates,
                    nav_series / 1e7,
                    color="#805ad5",
                    linewidth=2,
                    linestyle="--",
                    label="NAV",
                )
            
            ax.axhline(y=0, color="gray", linestyle="-", linewidth=0.5)
            ax.set_xlabel("")
            ax.set_ylabel("INR (Crore)", fontsize=9)
            ax.legend(loc="upper left", fontsize=8)
            ax.xaxis.set_major_formatter(mdates.DateFormatter("%b %Y"))
            ax.xaxis.set_major_locator(mdates.YearLocator())
            plt.xticks(rotation=45, ha="right", fontsize=8)
            plt.yticks(fontsize=8)
            ax.yaxis.set_major_formatter(FuncFormatter(lambda val, _: f"{val:,.1f} Cr"))
            ax.grid(True, alpha=0.3)
            ax.spines["top"].set_visible(False)
            ax.spines["right"].set_visible(False)
            
            plt.tight_layout()
            
            # Save to buffer
            buf = io.BytesIO()
            fig.savefig(buf, format="png", dpi=150, bbox_inches="tight")
            buf.seek(0)
            plt.close(fig)
            
            return Image(buf, width=width * inch, height=height * inch)
            
        except Exception as e:
            print(f"Warning: Could not generate cashflow chart: {e}")
            return None
    
    def _create_nav_chart(
        self,
        timeseries: pd.DataFrame,
        width: float = 6.5,
        height: float = 2.5,
    ) -> Optional[Image]:
        """Create a NAV history chart."""
        try:
            if timeseries.empty or "nav" not in timeseries.columns:
                return None
            
            fig, ax = plt.subplots(figsize=(width, height))
            
            dates = pd.to_datetime(timeseries.index)
            nav = timeseries["nav"].astype(float).fillna(0) / 1e7
            
            ax.fill_between(dates, 0, nav, alpha=0.3, color="#2c5282")
            ax.plot(dates, nav, color="#1a365d", linewidth=2)
            
            ax.set_xlabel("")
            ax.set_ylabel("NAV (INR Crore)", fontsize=9)
            ax.xaxis.set_major_formatter(mdates.DateFormatter("%b %Y"))
            ax.xaxis.set_major_locator(mdates.YearLocator())
            plt.xticks(rotation=45, ha="right", fontsize=8)
            plt.yticks(fontsize=8)
            ax.yaxis.set_major_formatter(FuncFormatter(lambda val, _: f"{val:,.1f} Cr"))
            ax.grid(True, alpha=0.3)
            ax.spines["top"].set_visible(False)
            ax.spines["right"].set_visible(False)
            
            plt.tight_layout()
            
            buf = io.BytesIO()
            fig.savefig(buf, format="png", dpi=150, bbox_inches="tight")
            buf.seek(0)
            plt.close(fig)
            
            return Image(buf, width=width * inch, height=height * inch)
            
        except Exception as e:
            print(f"Warning: Could not generate NAV chart: {e}")
            return None
    
    def _create_unit_price_chart(
        self,
        timeseries: pd.DataFrame,
        width: float = 6.5,
        height: float = 2.5,
    ) -> Optional[Image]:
        """Create a unit price history chart."""
        try:
            if timeseries.empty or "unit_price" not in timeseries.columns:
                return None
            
            fig, ax = plt.subplots(figsize=(width, height))
            
            dates = pd.to_datetime(timeseries.index)
            unit_price = timeseries["unit_price"].astype(float).fillna(0)
            
            # Color based on whether above or below initial
            initial_price = unit_price.iloc[0] if len(unit_price) > 0 else 1000
            colors_line = ["#38a169" if p >= initial_price else "#c53030" for p in unit_price]
            
            ax.plot(dates, unit_price, color="#1a365d", linewidth=2)
            ax.axhline(y=initial_price, color="gray", linestyle="--", 
                      linewidth=1, alpha=0.5, label=f"Initial ({initial_price:,.0f})")
            
            ax.set_xlabel("")
            ax.set_ylabel("Unit Price", fontsize=9)
            ax.legend(loc="upper left", fontsize=8)
            ax.xaxis.set_major_formatter(mdates.DateFormatter("%b %Y"))
            ax.xaxis.set_major_locator(mdates.YearLocator())
            plt.xticks(rotation=45, ha="right", fontsize=8)
            plt.yticks(fontsize=8)
            ax.grid(True, alpha=0.3)
            ax.spines["top"].set_visible(False)
            ax.spines["right"].set_visible(False)
            
            plt.tight_layout()
            
            buf = io.BytesIO()
            fig.savefig(buf, format="png", dpi=150, bbox_inches="tight")
            buf.seek(0)
            plt.close(fig)
            
            return Image(buf, width=width * inch, height=height * inch)
            
        except Exception as e:
            print(f"Warning: Could not generate unit price chart: {e}")
            return None
    
    def generate_statement(
        self,
        investor_name: str,
        investor_data: Dict[str, Any],
        investor_timeseries: pd.DataFrame,
        capital_account: Dict[str, float],
        output_path: Path,
    ) -> Path:
        """Generate a complete investor statement PDF.
        
        Args:
            investor_name: Name of the investor.
            investor_data: Investor summary data from investors.csv.
            investor_timeseries: Time series data for this investor.
            capital_account: Capital account data for this investor.
            output_path: Path to save the PDF.
            
        Returns:
            Path to the generated PDF file.
        """
        output_path = Path(output_path)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        
        doc = SimpleDocTemplate(
            str(output_path),
            pagesize=letter,
            rightMargin=0.75 * inch,
            leftMargin=0.75 * inch,
            topMargin=0.75 * inch,
            bottomMargin=0.75 * inch,
        )
        
        story = []
        
        # --- COVER / TITLE ---
        story.append(Spacer(1, 0.4 * inch))
        story.append(Paragraph(self.fund_name, self.styles["Title"]))
        story.append(Spacer(1, 0.1 * inch))
        story.append(Paragraph("Investor Statement", self.styles["Subtitle"]))
        story.append(Spacer(1, 0.3 * inch))
        story.append(Paragraph(
            f"<b>{investor_name}</b>", 
            ParagraphStyle(
                "InvestorName",
                parent=self.styles["Subtitle"],
                fontSize=18,
                textColor=BRAND_PRIMARY,
            )
        ))
        story.append(Spacer(1, 0.1 * inch))
        story.append(Paragraph(
            f"Statement Period: {self.statement_date.strftime('%d %B %Y')}",
            self.styles["Subtitle"]
        ))
        story.append(Spacer(1, 0.35 * inch))
        
        # --- KEY METRICS SUMMARY ---
        story.append(Paragraph("Investment Summary", self.styles["SectionHeader"]))
        
        # Extract key values
        commitment = investor_data.get("committed_capital", 0)
        contributed = capital_account.get("contributed", 0)
        distributed = capital_account.get("distributed", 0)
        nav = investor_timeseries["nav"].iloc[-1] if not investor_timeseries.empty and "nav" in investor_timeseries.columns else 0
        net_irr = investor_data.get("net_irr_after_fees", 0)
        moic = (distributed + nav) / contributed if contributed > 0 else 0
        dpi = distributed / contributed if contributed > 0 else 0
        
        # KPI Row 1
        kpi_row1 = self._build_kpi_row([
            (_format_crore(commitment, self.currency, 1), "Commitment"),
            (_format_crore(contributed, self.currency, 1), "Contributed"),
            (_format_crore(distributed, self.currency, 1), "Distributed"),
            (_format_crore(nav, self.currency, 1), "Current NAV"),
        ])
        story.append(kpi_row1)
        story.append(Spacer(1, 0.2 * inch))
        
        # KPI Row 2
        kpi_row2 = self._build_kpi_row([
            (_format_percentage(net_irr), "Net IRR"),
            (_format_number(moic, 2) + "x", "MOIC"),
            (_format_number(dpi, 2) + "x", "DPI"),
            (_format_crore(distributed + nav - contributed, self.currency, 1), "Net Profit"),
        ])
        story.append(kpi_row2)
        story.append(Spacer(1, 0.3 * inch))
        
        # --- CAPITAL ACCOUNT SUMMARY ---
        story.append(Paragraph("Capital Account Summary", self.styles["SectionHeader"]))
        
        cap_account_data = [
            ["Committed Capital", _format_currency(capital_account.get("commitment", commitment), self.currency)],
            ["Capital Contributions", _format_currency(capital_account.get("contributed", contributed), self.currency)],
            ["Return of Capital", _format_currency(capital_account.get("capital_returned", 0), self.currency)],
            ["Profit Distributions", _format_currency(capital_account.get("profit_distributed", 0), self.currency)],
            ["Management Fees Paid", _format_currency(capital_account.get("management_fees", 0), self.currency)],
            ["Carried Interest", _format_currency(capital_account.get("carried_interest", 0), self.currency)],
            ["Total Distributions", _format_currency(capital_account.get("distributed", 0), self.currency)],
            ["Remaining Commitment", _format_currency(capital_account.get("outstanding", 0), self.currency)],
        ]
        
        cap_table = self._build_data_table(
            headers=["Description", "Amount"],
            data=cap_account_data,
            col_widths=[4 * inch, 2.5 * inch],
        )
        story.append(KeepTogether([cap_table]))
        story.append(Spacer(1, 0.25 * inch))
        
        # --- CASHFLOW CHART ---
        story.append(Paragraph("Cashflow History", self.styles["SectionHeader"]))
        
        cashflow_chart = self._create_cashflow_chart(investor_timeseries)
        if cashflow_chart:
            story.append(KeepTogether([cashflow_chart]))
        else:
            story.append(Paragraph("Cashflow chart not available.", self.styles["BodyText"]))
        story.append(Spacer(1, 0.25 * inch))
        
        # --- PAGE BREAK ---
        story.append(PageBreak())
        
        # --- UNIT HOLDINGS ---
        story.append(Paragraph("Unit Holdings", self.styles["SectionHeader"]))
        
        units_subscribed = investor_data.get("units_subscribed", 0)
        unit_price = investor_timeseries["unit_price"].iloc[-1] if not investor_timeseries.empty and "unit_price" in investor_timeseries.columns else 1000
        class_a_units = investor_data.get("Class A", 0)
        class_b_units = investor_data.get("Class B", 0)
        
        holdings_data = []
        if class_a_units > 0:
            holdings_data.append([
                "Class A",
                _format_number(class_a_units, 2),
                _format_currency(unit_price, self.valuation_currency, 2),
                _format_currency(class_a_units * unit_price, self.valuation_currency, 2),
            ])
        if class_b_units > 0:
            holdings_data.append([
                "Class B",
                _format_number(class_b_units, 2),
                _format_currency(unit_price, self.valuation_currency, 2),
                _format_currency(class_b_units * unit_price, self.valuation_currency, 2),
            ])
        
        if holdings_data:
            holdings_data.append(["Total", _format_number(units_subscribed, 2), "", _format_currency(nav, self.valuation_currency, 2)])
            
            holdings_table = self._build_data_table(
                headers=["Unit Class", "Units Held", "Unit Price", "Value"],
                data=holdings_data,
                col_widths=[2 * inch, 1.5 * inch, 1.5 * inch, 1.5 * inch],
                highlight_totals=True,
            )
            story.append(KeepTogether([holdings_table]))
        else:
            story.append(Paragraph("No unit holdings on record.", self.styles["BodyText"]))
        story.append(Spacer(1, 0.25 * inch))
        
        # --- UNIT PRICE CHART ---
        story.append(Paragraph("Unit Price History", self.styles["SectionHeader"]))
        
        unit_price_chart = self._create_unit_price_chart(investor_timeseries)
        if unit_price_chart:
            story.append(KeepTogether([unit_price_chart]))
        else:
            story.append(Paragraph("Unit price chart not available.", self.styles["BodyText"]))
        story.append(Spacer(1, 0.25 * inch))
        
        # --- NAV HISTORY CHART ---
        story.append(Paragraph("NAV History", self.styles["SectionHeader"]))
        
        nav_chart = self._create_nav_chart(investor_timeseries)
        if nav_chart:
            story.append(KeepTogether([nav_chart]))
        else:
            story.append(Paragraph("NAV chart not available.", self.styles["BodyText"]))
        story.append(Spacer(1, 0.25 * inch))
        
        # --- TRANSACTION HISTORY (Recent) ---
        story.append(PageBreak())
        story.append(Paragraph("Recent Transaction History", self.styles["SectionHeader"]))
        
        if not investor_timeseries.empty:
            # Get last 12 months of data
            recent_ts = investor_timeseries.tail(12)
            
            transaction_data = []
            for date_idx in recent_ts.index:
                row = recent_ts.loc[date_idx]
                date_str = _format_date(date_idx)
                drawdown = row.get("drawdowns", 0)
                roc = row.get("return_of_capital", 0)
                profit = row.get("profit_distribution", 0)
                fee = row.get("management_fee", 0)
                carry = row.get("carried_interest", 0)
                net_cf = row.get("net_cashflow", 0)
                
                if abs(drawdown) > 1 or abs(roc) > 1 or abs(profit) > 1 or abs(fee) > 1 or abs(carry) > 1:
                    transaction_data.append([
                        date_str,
                        _format_currency(drawdown, self.currency),
                        _format_currency(roc + profit, self.currency),
                        _format_currency(fee + carry, self.currency),
                        _format_currency(net_cf, self.currency),
                    ])
            
            if transaction_data:
                txn_table = self._build_data_table(
                    headers=["Date", "Contributions", "Distributions", "Fees", "Net"],
                    data=transaction_data[-12:],  # Last 12 transactions
                    col_widths=[1.2 * inch, 1.3 * inch, 1.3 * inch, 1.3 * inch, 1.4 * inch],
                )
                story.append(KeepTogether([txn_table]))
            else:
                story.append(Paragraph("No recent transactions.", self.styles["BodyText"]))
        else:
            story.append(Paragraph("Transaction history not available.", self.styles["BodyText"]))
        story.append(Spacer(1, 0.25 * inch))
        
        # --- FUND OVERVIEW ---
        story.append(Paragraph("Fund Overview", self.styles["SectionHeader"]))
        
        fund_size = self.fund_metadata.get("fund_size", 0)
        fund_irr = self.fund_metrics.get("net_annualised_irr", 0)
        fund_roic = self.fund_metrics.get("roic", 0)
        break_even = self.fund_metrics.get("break_even_date", "-")
        fund_duration = self.fund_metrics.get("fund_duration_months", 0)
        
        fund_overview_data = [
            ["Fund Size", _format_currency(fund_size, self.currency, 0)],
            ["Fund Net IRR (Annualized)", _format_percentage(fund_irr)],
            ["Fund ROIC", _format_number(fund_roic, 2) + "x"],
            ["Break-Even Date", _format_date(break_even)],
            ["Fund Duration", f"{fund_duration:.0f} months" if fund_duration else "-"],
        ]
        
        fund_table = self._build_data_table(
            headers=["Metric", "Value"],
            data=fund_overview_data,
            col_widths=[4 * inch, 2.5 * inch],
        )
        story.append(KeepTogether([fund_table]))
        story.append(Spacer(1, 0.25 * inch))
        
        # --- HYBRID OVERLAY SUMMARY (if available) ---
        if not investor_timeseries.empty and "hybrid_nav" in investor_timeseries.columns:
            story.append(Paragraph("Hybrid Investment Summary", self.styles["SectionHeader"]))
            
            hybrid_nav = investor_timeseries["hybrid_nav"].iloc[-1] if "hybrid_nav" in investor_timeseries.columns else 0
            hybrid_interest = investor_timeseries["hybrid_cumulative_interest"].iloc[-1] if "hybrid_cumulative_interest" in investor_timeseries.columns else 0
            hybrid_cagr = investor_timeseries["hybrid_rolling_cagr"].iloc[-1] if "hybrid_rolling_cagr" in investor_timeseries.columns else 0
            
            hybrid_data = [
                ["Hybrid NAV", _format_currency(hybrid_nav, self.currency, 0)],
                ["Cumulative Interest Earned", _format_currency(hybrid_interest, self.currency, 0)],
                ["Rolling CAGR", _format_percentage(hybrid_cagr)],
            ]
            
            hybrid_table = self._build_data_table(
                headers=["Metric", "Value"],
                data=hybrid_data,
                col_widths=[4 * inch, 2.5 * inch],
            )
            story.append(KeepTogether([hybrid_table]))
            story.append(Spacer(1, 0.25 * inch))
        
        # --- DISCLAIMER ---
        disclaimer_text = (
            "This statement is provided for informational purposes only and does not constitute "
            "an offer to sell or a solicitation of an offer to buy any securities. Past performance "
            "is not indicative of future results. The values shown are estimates and may differ from "
            "final audited figures. This document is confidential and intended solely for the named "
            "recipient. Please consult with your financial advisor regarding your investment."
        )
        story.append(Paragraph(disclaimer_text, self.styles["Disclaimer"]))
        
        # Build the document
        doc.build(story, onFirstPage=self._create_header_footer, 
                  onLaterPages=self._create_header_footer)
        
        return output_path


def generate_investor_statements(
    output_dir: Path,
    fund_name: str,
    fund_metadata: Dict[str, Any],
    fund_metrics: Dict[str, Any],
    investors_df: pd.DataFrame,
    capital_accounts_df: pd.DataFrame,
    investor_timeseries: Dict[str, pd.DataFrame],
    statement_date: Optional[datetime] = None,
    currency: str = "INR",
    valuation_currency: str = "INR",
) -> List[Path]:
    """Generate PDF statements for all investors.
    
    Args:
        output_dir: Directory to save statements.
        fund_name: Name of the fund.
        fund_metadata: Fund metadata dictionary.
        fund_metrics: Fund metrics dictionary.
        investors_df: DataFrame with investor summary data.
        capital_accounts_df: DataFrame with capital account data.
        investor_timeseries: Dictionary mapping investor names to timeseries.
        statement_date: Date for statements (defaults to today).
        currency: Currency code for formatting.
        valuation_currency: Currency to use for unit price and valuation metrics.
        
    Returns:
        List of paths to generated PDF files.
    """
    output_dir = Path(output_dir)
    statements_dir = output_dir / "investor_statements"
    statements_dir.mkdir(parents=True, exist_ok=True)
    
    generator = InvestorStatementGenerator(
        fund_name=fund_name,
        fund_metadata=fund_metadata,
        fund_metrics=fund_metrics,
        statement_date=statement_date,
        currency=currency,
        valuation_currency=valuation_currency,
    )
    
    generated_files = []
    
    # Convert capital accounts to dictionary format
    capital_accounts_dict = {}
    if not capital_accounts_df.empty:
        for _, row in capital_accounts_df.iterrows():
            investor_name = row.get("investor", "")
            capital_accounts_dict[investor_name] = row.to_dict()
    
    # Generate statement for each investor
    for _, investor_row in investors_df.iterrows():
        investor_name = investor_row.get("name", "")
        if not investor_name:
            continue
        
        # Create slug for filename
        slug = "".join(
            ch.lower() if ch.isalnum() else "_" for ch in investor_name
        ).strip("_")
        
        investor_data = investor_row.to_dict()
        capital_account = capital_accounts_dict.get(investor_name, {})
        timeseries = investor_timeseries.get(investor_name, pd.DataFrame())
        
        output_path = statements_dir / f"{slug}_statement.pdf"
        
        try:
            generated_path = generator.generate_statement(
                investor_name=investor_name,
                investor_data=investor_data,
                investor_timeseries=timeseries,
                capital_account=capital_account,
                output_path=output_path,
            )
            generated_files.append(generated_path)
            print(f"  📄 Generated statement: {generated_path.name}")
        except Exception as e:
            print(f"  ⚠️  Failed to generate statement for {investor_name}: {e}")
    
    return generated_files
