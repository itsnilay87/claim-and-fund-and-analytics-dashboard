"""Template loader for D3 dashboard generation.

This module provides functions to load and assemble HTML templates from
external files, making the dashboard code more maintainable.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Dict

# Template directory relative to this module
_TEMPLATE_DIR = Path(__file__).parent / "templates"


class TemplateLoadError(Exception):
    """Raised when a template file cannot be loaded."""

    pass


@lru_cache(maxsize=16)
def _load_template_file(filename: str) -> str:
    """Load a template file from the templates directory.

    Args:
        filename: Name of the template file (e.g., 'dashboard_template_v2.html')

    Returns:
        The contents of the template file as a string.

    Raises:
        TemplateLoadError: If the file cannot be found or read.
    """
    filepath = _TEMPLATE_DIR / filename
    if not filepath.exists():
        raise TemplateLoadError(f"Template file not found: {filepath}")
    try:
        return filepath.read_text(encoding="utf-8")
    except IOError as e:
        raise TemplateLoadError(f"Failed to read template file {filepath}: {e}") from e


def load_dashboard_template(**kwargs) -> str:
    """Load the main dashboard HTML template."""
    return _load_template_file("dashboard_template_v2.html")


def load_dashboard_styles(**kwargs) -> str:
    """Load the dashboard CSS styles."""
    return _load_template_file("dashboard_styles_v2.css")


def load_dashboard_charts_js(**kwargs) -> str:
    """Load the dashboard JavaScript code."""
    return _load_template_file("dashboard_charts_v2.js")


def assemble_dashboard(
    data_replacements: Dict[str, str],
    **kwargs,
) -> str:
    """Assemble the complete dashboard HTML from templates and data.

    This function:
    1. Loads the HTML template
    2. Injects CSS styles
    3. Injects JavaScript code
    4. Replaces data placeholders with actual JSON data

    Args:
        data_replacements: Dictionary mapping placeholder names to JSON data strings.
            Expected keys: J_CURVE_DATA, IRR_DATA, METADATA_DATA, METRICS_DATA,
            SENSITIVITY_DATA, NAV_DATA, ALPHA_CASHFLOW_DATA, SIM_STATS_DATA,
            SIM_DISTRIBUTIONS_DATA

    Returns:
        The complete HTML content ready to be written to a file.
    """
    # Load all template components
    html_template = load_dashboard_template()
    styles = load_dashboard_styles()
    charts_js = load_dashboard_charts_js()

    # First, inject CSS and JS into the template
    html_content = html_template.replace("{{STYLES}}", styles)
    html_content = html_content.replace("{{CHARTS_JS}}", charts_js)

    # Then replace all data placeholders
    for placeholder, data in data_replacements.items():
        html_content = html_content.replace(f"{{{{{placeholder}}}}}", data)

    return html_content


def clear_template_cache() -> None:
    """Clear the template file cache.

    Call this if templates are modified during runtime (e.g., in development).
    """
    _load_template_file.cache_clear()


__all__ = [
    "TemplateLoadError",
    "assemble_dashboard",
    "clear_template_cache",
    "load_dashboard_charts_js",
    "load_dashboard_styles",
    "load_dashboard_template",
]
