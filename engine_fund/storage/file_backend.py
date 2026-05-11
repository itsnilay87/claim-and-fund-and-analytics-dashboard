"""File-based storage backend for simulation results."""

import json
from pathlib import Path
from typing import Dict, Optional, Any
import logging

from . import StorageBackend

logger = logging.getLogger(__name__)


class FileStorageBackend(StorageBackend):
    """
    File-based storage backend that saves dashboard data as JSON files.
    
    This is the default backend, compatible with existing file structure.
    Results are stored in: {storage_dir}/{task_id}_results.json
    """

    def __init__(self, storage_dir: Path | str = Path("reports/simulation_tasks")):
        """
        Initialize file storage backend.

        Args:
            storage_dir: Directory to store result files (default: reports/simulation_tasks)
        """
        self.storage_dir = Path(storage_dir)
        self.storage_dir.mkdir(parents=True, exist_ok=True)
        logger.info(f"Initialized FileStorageBackend with storage_dir: {self.storage_dir}")

    def _get_file_path(self, task_id: str) -> Path:
        """Get the file path for a given task ID."""
        return self.storage_dir / f"{task_id}_results.json"

    def save_dashboard_data(self, task_id: str, data: Dict[str, Any]) -> None:
        """
        Save dashboard data to a JSON file.

        Args:
            task_id: Unique task identifier
            data: Dashboard data dictionary

        Raises:
            IOError: If file write fails
        """
        file_path = self._get_file_path(task_id)
        try:
            with open(file_path, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2)
            logger.info(f"Saved dashboard data for task {task_id} to {file_path}")
        except Exception as e:
            logger.error(f"Failed to save dashboard data for task {task_id}: {e}")
            raise

    def load_dashboard_data(self, task_id: str) -> Optional[Dict[str, Any]]:
        """
        Load dashboard data from a JSON file.

        Args:
            task_id: Unique task identifier

        Returns:
            Dashboard data dictionary if found, None if file doesn't exist

        Raises:
            JSONDecodeError: If file exists but contains invalid JSON
            IOError: If file read fails
        """
        file_path = self._get_file_path(task_id)
        
        if not file_path.exists():
            logger.debug(f"Dashboard data not found for task {task_id} at {file_path}")
            return None

        try:
            with open(file_path, "r", encoding="utf-8") as f:
                data = json.load(f)
            logger.info(f"Loaded dashboard data for task {task_id} from {file_path}")
            return data
        except Exception as e:
            logger.error(f"Failed to load dashboard data for task {task_id}: {e}")
            raise

    def delete_dashboard_data(self, task_id: str) -> bool:
        """
        Delete dashboard data file.

        Args:
            task_id: Unique task identifier

        Returns:
            True if file was deleted, False if file didn't exist

        Raises:
            OSError: If file deletion fails
        """
        file_path = self._get_file_path(task_id)
        
        if not file_path.exists():
            logger.debug(f"No file to delete for task {task_id}")
            return False

        try:
            file_path.unlink()
            logger.info(f"Deleted dashboard data for task {task_id}")
            return True
        except Exception as e:
            logger.error(f"Failed to delete dashboard data for task {task_id}: {e}")
            raise

    def exists(self, task_id: str) -> bool:
        """
        Check if dashboard data file exists.

        Args:
            task_id: Unique task identifier

        Returns:
            True if file exists, False otherwise
        """
        return self._get_file_path(task_id).exists()


__all__ = ["FileStorageBackend"]
