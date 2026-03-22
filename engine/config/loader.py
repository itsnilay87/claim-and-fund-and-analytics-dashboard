"""
engine/config/loader.py — Load, merge, and validate configuration from JSON files.
==================================================================================

Provides four entry points:
  load_claim_config(json_path)           → ClaimConfig
  load_portfolio_config(json_path)       → PortfolioConfig
  merge_with_defaults(overrides, jur.)   → ClaimConfig
  validate_portfolio(portfolio, claims)  → list[str]   (empty = valid)

All functions raise ``pydantic.ValidationError`` on structural problems and
return human-readable warning strings for soft issues (e.g. duplicate IDs).
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

from pydantic import ValidationError

from .defaults import (
    DEFAULT_ARBITRATION_CONFIG,
    DEFAULT_DOMESTIC_TIMELINE,
    DEFAULT_DOMESTIC_TREE,
    DEFAULT_INTEREST_DOMESTIC,
    DEFAULT_INTEREST_SIAC,
    DEFAULT_LEGAL_COSTS,
    DEFAULT_QUANTUM_CONFIG,
    DEFAULT_SIAC_TIMELINE,
    DEFAULT_SIAC_TREE,
    DEFAULT_SIMULATION_CONFIG,
    get_default_claim_config,
)
from .schema import (
    ClaimConfig,
    PortfolioConfig,
    SimulationConfig,
)

logger = logging.getLogger(__name__)


# ============================================================================
# 1. load_claim_config — parse a single ClaimConfig from JSON
# ============================================================================

def load_claim_config(json_path: str | Path) -> ClaimConfig:
    """Load and validate a single ``ClaimConfig`` from a JSON file.

    Parameters
    ----------
    json_path : str | Path
        Path to a JSON file whose top-level object conforms to ``ClaimConfig``.

    Returns
    -------
    ClaimConfig
        Fully validated claim configuration.

    Raises
    ------
    FileNotFoundError
        If *json_path* does not exist.
    json.JSONDecodeError
        If the file is not valid JSON.
    pydantic.ValidationError
        If the JSON payload violates schema constraints.
    """
    path = Path(json_path)
    if not path.is_file():
        raise FileNotFoundError(f"Claim config file not found: {path}")

    raw = json.loads(path.read_text(encoding="utf-8"))
    claim = ClaimConfig.model_validate(raw)
    logger.info("Loaded claim config '%s' from %s", claim.id, path)
    return claim


# ============================================================================
# 2. load_portfolio_config — parse a PortfolioConfig from JSON
# ============================================================================

def load_portfolio_config(json_path: str | Path) -> PortfolioConfig:
    """Load and validate a ``PortfolioConfig`` from a JSON file.

    Parameters
    ----------
    json_path : str | Path
        Path to a JSON file whose top-level object conforms to ``PortfolioConfig``.

    Returns
    -------
    PortfolioConfig
        Fully validated portfolio configuration.

    Raises
    ------
    FileNotFoundError
        If *json_path* does not exist.
    json.JSONDecodeError
        If the file is not valid JSON.
    pydantic.ValidationError
        If the JSON payload violates schema constraints.
    """
    path = Path(json_path)
    if not path.is_file():
        raise FileNotFoundError(f"Portfolio config file not found: {path}")

    raw = json.loads(path.read_text(encoding="utf-8"))
    portfolio = PortfolioConfig.model_validate(raw)
    logger.info(
        "Loaded portfolio '%s' (%d claims) from %s",
        portfolio.name, len(portfolio.claim_ids), path,
    )
    return portfolio


# ============================================================================
# 3. merge_with_defaults — overlay user overrides onto jurisdiction defaults
# ============================================================================

_JURISDICTION_DEFAULTS: dict[str, dict[str, Any]] = {
    "indian_domestic": {
        "challenge_tree": DEFAULT_DOMESTIC_TREE,
        "timeline": DEFAULT_DOMESTIC_TIMELINE,
        "legal_costs": DEFAULT_LEGAL_COSTS,
        "interest": DEFAULT_INTEREST_DOMESTIC,
        "arbitration": DEFAULT_ARBITRATION_CONFIG,
        "quantum": DEFAULT_QUANTUM_CONFIG,
    },
    "siac_singapore": {
        "challenge_tree": DEFAULT_SIAC_TREE,
        "timeline": DEFAULT_SIAC_TIMELINE,
        "legal_costs": DEFAULT_LEGAL_COSTS,
        "interest": DEFAULT_INTEREST_SIAC,
        "arbitration": DEFAULT_ARBITRATION_CONFIG,
        "quantum": DEFAULT_QUANTUM_CONFIG,
    },
}


def merge_with_defaults(
    overrides: dict[str, Any],
    jurisdiction: str = "indian_domestic",
) -> ClaimConfig:
    """Create a ``ClaimConfig`` by merging user *overrides* with jurisdiction defaults.

    The merge strategy is **shallow**: any top-level key present in *overrides*
    completely replaces the default value for that key.  Keys not present in
    *overrides* are filled from the jurisdiction defaults.

    Parameters
    ----------
    overrides : dict
        Partial claim configuration.  Must include at least ``id``, ``name``,
        and ``soc_value_cr``.
    jurisdiction : str
        Jurisdiction key (``'indian_domestic'`` or ``'siac_singapore'``).

    Returns
    -------
    ClaimConfig
        Fully populated and validated claim configuration.

    Raises
    ------
    ValueError
        If *jurisdiction* is not supported.
    pydantic.ValidationError
        If the merged payload fails schema validation.
    """
    if jurisdiction not in _JURISDICTION_DEFAULTS:
        raise ValueError(
            f"Unsupported jurisdiction '{jurisdiction}'. "
            f"Supported: {sorted(_JURISDICTION_DEFAULTS.keys())}."
        )

    defaults = _JURISDICTION_DEFAULTS[jurisdiction]

    # Build merged dict: start with jurisdiction defaults (serialised to dict),
    # then overlay user overrides.
    merged: dict[str, Any] = {"jurisdiction": jurisdiction}

    for key, default_model in defaults.items():
        # Serialise Pydantic model defaults to plain dicts for merging
        if hasattr(default_model, "model_dump"):
            merged[key] = default_model.model_dump()
        else:
            merged[key] = default_model

    # User overrides take precedence
    merged.update(overrides)

    # Normalize interest rates: convert percentage (>1) to decimal (e.g. 9 → 0.09)
    interest = merged.get("interest")
    if isinstance(interest, dict):
        if isinstance(interest.get("rate"), (int, float)) and interest["rate"] > 1:
            interest["rate"] = interest["rate"] / 100
        for band in interest.get("rate_bands", []):
            if isinstance(band, dict) and isinstance(band.get("rate"), (int, float)) and band["rate"] > 1:
                band["rate"] = band["rate"] / 100

    claim = ClaimConfig.model_validate(merged)
    logger.info(
        "Merged claim '%s' with '%s' defaults (overrides: %d keys)",
        claim.id, jurisdiction, len(overrides),
    )
    return claim


# ============================================================================
# 4. validate_portfolio — cross-check portfolio against loaded claims
# ============================================================================

def validate_portfolio(
    portfolio: PortfolioConfig,
    claims: list[ClaimConfig],
) -> list[str]:
    """Validate a ``PortfolioConfig`` against its constituent claims.

    Returns a list of human-readable warning/error strings.
    An empty list means the portfolio is fully valid.

    Checks performed:
      1. Every ``claim_id`` in the portfolio references an existing claim.
      2. No duplicate claim IDs in the portfolio.
      3. No duplicate claim IDs across the provided claims list.
      4. All claims share the same currency (warning if mixed).
      5. Simulation config is within sensible bounds.

    Parameters
    ----------
    portfolio : PortfolioConfig
        The portfolio to validate.
    claims : list[ClaimConfig]
        All available claim configs (superset of portfolio.claim_ids).

    Returns
    -------
    list[str]
        List of warning/error messages.  Empty if no issues found.
    """
    issues: list[str] = []
    claims_by_id = {c.id: c for c in claims}

    # 1. Missing claims
    for cid in portfolio.claim_ids:
        if cid not in claims_by_id:
            issues.append(
                f"Portfolio '{portfolio.id}': claim_id '{cid}' not found "
                f"in provided claims."
            )

    # 2. Duplicate claim IDs in portfolio
    seen: set[str] = set()
    for cid in portfolio.claim_ids:
        if cid in seen:
            issues.append(
                f"Portfolio '{portfolio.id}': duplicate claim_id '{cid}'."
            )
        seen.add(cid)

    # 3. Duplicate claim IDs across claims list
    claim_id_counts: dict[str, int] = {}
    for c in claims:
        claim_id_counts[c.id] = claim_id_counts.get(c.id, 0) + 1
    for cid, count in claim_id_counts.items():
        if count > 1:
            issues.append(
                f"Claims list: claim_id '{cid}' appears {count} times."
            )

    # 4. Mixed currencies (warning)
    portfolio_claims = [claims_by_id[cid] for cid in portfolio.claim_ids if cid in claims_by_id]
    currencies = {c.currency for c in portfolio_claims}
    if len(currencies) > 1:
        issues.append(
            f"Portfolio '{portfolio.id}': mixed currencies detected — "
            f"{currencies}.  Monetary aggregation may be misleading."
        )

    # 5. Simulation bounds
    sim = portfolio.simulation
    if sim.n_paths < 1000:
        issues.append(
            f"Portfolio '{portfolio.id}': n_paths={sim.n_paths} is very low — "
            f"consider ≥ 1,000 for stable estimates."
        )
    if sim.discount_rate <= sim.risk_free_rate:
        issues.append(
            f"Portfolio '{portfolio.id}': discount_rate ({sim.discount_rate}) "
            f"≤ risk_free_rate ({sim.risk_free_rate}) — "
            f"risk premium is zero or negative."
        )

    if issues:
        for msg in issues:
            logger.warning(msg)
    else:
        logger.info("Portfolio '%s' passed all validation checks.", portfolio.id)

    return issues


# ============================================================================
# Convenience: load_claims_dir — bulk-load claim configs from a directory
# ============================================================================

def load_claims_dir(directory: str | Path) -> list[ClaimConfig]:
    """Load all ``*.json`` claim configs from a directory.

    Parameters
    ----------
    directory : str | Path
        Directory containing one or more claim JSON files.

    Returns
    -------
    list[ClaimConfig]
        Successfully loaded claim configs (sorted by id).
        Files that fail validation are logged and skipped.
    """
    dir_path = Path(directory)
    if not dir_path.is_dir():
        raise FileNotFoundError(f"Claims directory not found: {dir_path}")

    claims: list[ClaimConfig] = []
    for json_file in sorted(dir_path.glob("*.json")):
        try:
            claims.append(load_claim_config(json_file))
        except (ValidationError, json.JSONDecodeError) as exc:
            logger.warning("Skipping %s: %s", json_file.name, exc)

    logger.info("Loaded %d claim(s) from %s", len(claims), dir_path)
    return sorted(claims, key=lambda c: c.id)
