"""
engine/jurisdictions/registry.py — Load all jurisdiction templates and provide lookup.
======================================================================================

On import, scans the ``engine/jurisdictions/`` directory for ``*.json`` files,
validates each against ``JurisdictionTemplate``, and exposes them through a
singleton registry.

Exports:
  JurisdictionRegistry  — class with list_jurisdictions() / get_template()
  REGISTRY              — module-level singleton instance
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Iterator

from pydantic import ValidationError

from engine.config.schema import JurisdictionTemplate

logger = logging.getLogger(__name__)

# Directory containing .json jurisdiction files (sibling of this module)
_JURISDICTIONS_DIR = Path(__file__).resolve().parent


class JurisdictionRegistry:
    """Registry of jurisdiction templates loaded from JSON files.

    On initialization, scans the jurisdictions directory for all ``*.json``
    files, parses and validates each against :class:`JurisdictionTemplate`,
    and stores them in a dictionary keyed by ``id``.

    Usage::

        from engine.jurisdictions import REGISTRY

        ids = REGISTRY.list_jurisdictions()
        tmpl = REGISTRY.get_template("indian_domestic")
    """

    def __init__(self, directory: Path | None = None) -> None:
        self._templates: dict[str, JurisdictionTemplate] = {}
        self._directory = directory or _JURISDICTIONS_DIR
        self._load_all()

    # ── Loading ──────────────────────────────────────────────────────────

    def _load_all(self) -> None:
        """Scan directory for .json files and load each as a template."""
        json_files = sorted(self._directory.glob("*.json"))
        if not json_files:
            logger.warning(
                "No jurisdiction JSON files found in %s", self._directory
            )
            return

        for path in json_files:
            self._load_one(path)

        logger.info(
            "JurisdictionRegistry: loaded %d template(s) from %s — %s",
            len(self._templates),
            self._directory,
            sorted(self._templates.keys()),
        )

    def _load_one(self, path: Path) -> None:
        """Parse a single JSON file and register the template."""
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            raise ValueError(
                f"Invalid JSON in jurisdiction file {path.name}: {exc}"
            ) from exc

        try:
            template = JurisdictionTemplate.model_validate(raw)
        except ValidationError as exc:
            raise ValueError(
                f"Jurisdiction template validation failed for {path.name}:\n{exc}"
            ) from exc

        if template.id in self._templates:
            raise ValueError(
                f"Duplicate jurisdiction id '{template.id}' — "
                f"found in both {path.name} and a previously loaded file."
            )

        self._templates[template.id] = template
        logger.debug("Loaded jurisdiction template '%s' from %s", template.id, path.name)

    # ── Public API ───────────────────────────────────────────────────────

    def list_jurisdictions(self) -> list[str]:
        """Return sorted list of all registered jurisdiction IDs."""
        return sorted(self._templates.keys())

    def get_template(self, jurisdiction_id: str) -> JurisdictionTemplate:
        """Return the ``JurisdictionTemplate`` for *jurisdiction_id*.

        Raises
        ------
        KeyError
            If no template is registered for the given ID.
        """
        try:
            return self._templates[jurisdiction_id]
        except KeyError:
            available = self.list_jurisdictions()
            raise KeyError(
                f"Unknown jurisdiction '{jurisdiction_id}'. "
                f"Available: {available}"
            ) from None

    def __contains__(self, jurisdiction_id: str) -> bool:
        return jurisdiction_id in self._templates

    def __len__(self) -> int:
        return len(self._templates)

    def __iter__(self) -> Iterator[str]:
        return iter(sorted(self._templates.keys()))

    def __repr__(self) -> str:
        return (
            f"JurisdictionRegistry({len(self._templates)} templates: "
            f"{self.list_jurisdictions()})"
        )


# ============================================================================
# Module-level singleton — loaded on first import
# ============================================================================

REGISTRY = JurisdictionRegistry()
