"""Testing utilities package."""

from importlib import import_module
from typing import Any

__all__ = ["DiagnosticsPayload", "run_diagnostics", "save_payload"]


def __getattr__(name: str) -> Any:
	if name in __all__:
		module = import_module(".diagnostics", __name__)
		return getattr(module, name)
	raise AttributeError(f"module '{__name__}' has no attribute '{name}'")
