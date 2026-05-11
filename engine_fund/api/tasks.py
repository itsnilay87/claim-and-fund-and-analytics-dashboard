"""Background task management for simulations."""

from __future__ import annotations

import json
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Optional

from .schemas import SimulationMetadata, SimulationStatus


class SimulationTask:
    """Manages state and metadata for a simulation task."""

    def __init__(
        self,
        task_id: str,
        inputs_path: str,
        simulations: Optional[int] = None,
        sensitivity: bool = False,
        sensitivity_divisor: Optional[int] = None,
    ):
        self.task_id = task_id
        self.inputs_path = inputs_path
        self.simulations = simulations
        self.sensitivity = sensitivity
        self.sensitivity_divisor = sensitivity_divisor

        self.status = SimulationStatus.PENDING
        self.created_at = datetime.utcnow()
        self.started_at: Optional[datetime] = None
        self.completed_at: Optional[datetime] = None
        self.error_message: Optional[str] = None
        self.result_path: Optional[Path] = None
        self.dashboard_data: Optional[Dict[str, Any]] = None

    def to_metadata(self) -> SimulationMetadata:
        """Convert task to metadata schema."""
        duration = None
        if self.completed_at and self.started_at:
            duration = (self.completed_at - self.started_at).total_seconds()

        return SimulationMetadata(
            id=self.task_id,
            status=self.status,
            created_at=self.created_at.isoformat(),
            started_at=self.started_at.isoformat() if self.started_at else None,
            completed_at=self.completed_at.isoformat() if self.completed_at else None,
            error_message=self.error_message,
            duration_seconds=duration,
        )


class TaskManager:
    """Simple in-memory task manager with file-based persistence."""

    def __init__(self, storage_dir: Path = Path("reports/simulation_tasks")):
        self.storage_dir = storage_dir
        self.tasks: Dict[str, SimulationTask] = {}
        self.storage_dir.mkdir(parents=True, exist_ok=True)
        self._load_persisted_tasks()

    def create_task(
        self,
        inputs_path: str,
        simulations: Optional[int] = None,
        sensitivity: bool = False,
        sensitivity_divisor: Optional[int] = None,
    ) -> SimulationTask:
        """Create a new simulation task."""
        task_id = str(uuid.uuid4())
        task = SimulationTask(
            task_id=task_id,
            inputs_path=inputs_path,
            simulations=simulations,
            sensitivity=sensitivity,
            sensitivity_divisor=sensitivity_divisor,
        )
        self.tasks[task_id] = task
        self._persist_task(task)
        return task

    def get_task(self, task_id: str) -> Optional[SimulationTask]:
        """Retrieve a task by ID."""
        if task_id not in self.tasks:
            self._load_task(task_id)
        return self.tasks.get(task_id)

    def update_task(self, task: SimulationTask) -> None:
        """Update a task's state."""
        self.tasks[task.task_id] = task
        self._persist_task(task)

    def _persist_task(self, task: SimulationTask) -> None:
        """Save task metadata to disk."""
        metadata = {
            "task_id": task.task_id,
            "inputs_path": task.inputs_path,
            "simulations": task.simulations,
            "sensitivity": task.sensitivity,
            "sensitivity_divisor": task.sensitivity_divisor,
            "status": task.status.value,
            "created_at": task.created_at.isoformat(),
            "started_at": task.started_at.isoformat() if task.started_at else None,
            "completed_at": task.completed_at.isoformat() if task.completed_at else None,
            "error_message": task.error_message,
            "result_path": str(task.result_path) if task.result_path else None,
        }
        task_file = self.storage_dir / f"{task.task_id}.json"
        with open(task_file, "w") as f:
            json.dump(metadata, f, indent=2)

    def _load_task(self, task_id: str) -> Optional[SimulationTask]:
        """Load a persisted task from disk."""
        task_file = self.storage_dir / f"{task_id}.json"
        if not task_file.exists():
            return None

        try:
            with open(task_file, "r") as f:
                metadata = json.load(f)

            # Skip files that don't have the required fields (old format)
            if "task_id" not in metadata or "inputs_path" not in metadata:
                return None

            task = SimulationTask(
                task_id=metadata["task_id"],
                inputs_path=metadata["inputs_path"],
                simulations=metadata.get("simulations"),
                sensitivity=metadata.get("sensitivity", False),
                sensitivity_divisor=metadata.get("sensitivity_divisor"),
            )
            task.status = SimulationStatus(metadata.get("status", "pending"))
            task.created_at = datetime.fromisoformat(metadata["created_at"])
            if metadata.get("started_at"):
                task.started_at = datetime.fromisoformat(metadata["started_at"])
            if metadata.get("completed_at"):
                task.completed_at = datetime.fromisoformat(metadata["completed_at"])
            task.error_message = metadata.get("error_message")
            if metadata.get("result_path"):
                task.result_path = Path(metadata["result_path"])

            self.tasks[task_id] = task
            return task
        except (json.JSONDecodeError, KeyError, ValueError) as e:
            # Skip corrupted or incompatible task files
            return None

    def _load_persisted_tasks(self) -> None:
        """Load all persisted tasks on startup."""
        for task_file in self.storage_dir.glob("*.json"):
            if task_file.name.endswith("_results.json"):
                continue  # Skip result files
            task_id = task_file.stem
            self._load_task(task_id)


# Global task manager instance
_task_manager: Optional[TaskManager] = None


def get_task_manager() -> TaskManager:
    """Get or initialize the global task manager."""
    global _task_manager
    if _task_manager is None:
        _task_manager = TaskManager()
    return _task_manager
