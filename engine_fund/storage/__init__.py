"""Storage backends for simulation results."""

from abc import ABC, abstractmethod
from typing import Dict, Optional, Any


class StorageBackend(ABC):
    """Abstract base class for storage backends."""

    @abstractmethod
    def save_dashboard_data(self, task_id: str, data: Dict[str, Any]) -> None:
        """
        Save dashboard data for a simulation task.

        Args:
            task_id: Unique task identifier
            data: Dashboard data dictionary containing summary_metrics, j_curve, etc.

        Raises:
            Exception: If save operation fails
        """
        pass

    @abstractmethod
    def load_dashboard_data(self, task_id: str) -> Optional[Dict[str, Any]]:
        """
        Load dashboard data for a simulation task.

        Args:
            task_id: Unique task identifier

        Returns:
            Dashboard data dictionary if found, None otherwise

        Raises:
            Exception: If load operation fails
        """
        pass

    @abstractmethod
    def delete_dashboard_data(self, task_id: str) -> bool:
        """
        Delete dashboard data for a simulation task.

        Args:
            task_id: Unique task identifier

        Returns:
            True if deleted, False if not found

        Raises:
            Exception: If delete operation fails
        """
        pass

    @abstractmethod
    def exists(self, task_id: str) -> bool:
        """
        Check if dashboard data exists for a task.

        Args:
            task_id: Unique task identifier

        Returns:
            True if data exists, False otherwise
        """
        pass


__all__ = ["StorageBackend"]
