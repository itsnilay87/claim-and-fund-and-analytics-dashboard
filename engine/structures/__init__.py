"""Portfolio-structure handler registry.

Usage::

    from engine.structures import get_handler
    handler = get_handler("litigation_funding")
"""

from .base import StructureHandler
from .litigation_funding import LitigationFundingHandler
from .monetisation_upfront_tail import UpfrontTailHandler
from .monetisation_full_purchase import FullPurchaseHandler
from .monetisation_staged import StagedHandler
from .monetisation_hybrid_payoff import HybridPayoffHandler
from .comparative import ComparativeHandler

_REGISTRY: dict[str, type[StructureHandler]] = {
    "litigation_funding": LitigationFundingHandler,
    "monetisation_upfront_tail": UpfrontTailHandler,
    "monetisation_full_purchase": FullPurchaseHandler,
    "monetisation_staged": StagedHandler,
    "monetisation_hybrid_payoff": HybridPayoffHandler,
    "comparative": ComparativeHandler,
}


def get_handler(structure_type: str) -> StructureHandler:
    """Return an instantiated handler for the given structure type."""
    cls = _REGISTRY.get(structure_type)
    if cls is None:
        raise ValueError(f"Unknown structure type: {structure_type}")
    return cls()


__all__ = [
    "StructureHandler",
    "get_handler",
    "LitigationFundingHandler",
    "UpfrontTailHandler",
    "FullPurchaseHandler",
    "StagedHandler",
    "HybridPayoffHandler",
    "ComparativeHandler",
]
