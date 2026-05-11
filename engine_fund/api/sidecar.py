"""Thin FastAPI sidecar for fund simulation orchestration.

Node.js Express server calls this internally (localhost:8000).
Auth is handled by Node — this service trusts the X-User-Id header.
"""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from celery.result import AsyncResult
from fastapi import FastAPI, Header, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from .celery_app import celery_app
from .celery_tasks import run_case_simulation, run_simulation_task
from .schemas import SimulationInput

app = FastAPI(
    title="Fund Simulation Sidecar",
    version="1.0.0",
    docs_url="/fund-api/docs",
    openapi_url="/fund-api/openapi.json",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

INPUTS_DIR = Path(__file__).resolve().parents[1] / "inputs"


class SimulationStartResponse(BaseModel):
    celery_task_id: str
    status: str = "queued"


class ProgressResponse(BaseModel):
    status: str
    progress: int = 0
    stage: str = ""
    message: str = ""


class CaseSubmitRequest(BaseModel):
    case_parameters: Dict[str, Any]


# ── Health ──────────────────────────────────────────────────


@app.get("/fund-api/health")
async def health_check():
    checks = {"sidecar": "ok"}

    try:
        result = celery_app.control.ping(timeout=2)
        # With a solo worker, remote control ping may time out while a long
        # simulation task is running. Treat empty ping as "busy" instead of
        # hard "error" to avoid false degraded health during active runs.
        checks["celery"] = "ok" if result else "busy"
    except Exception:
        checks["celery"] = "busy"

    try:
        import redis as redis_lib

        r = redis_lib.from_url(
            os.environ.get("REDIS_URL", "redis://localhost:6379/0")
        )
        r.ping()
        checks["redis"] = "ok"
    except Exception:
        checks["redis"] = "error"

    all_ok = all(v in ("ok", "busy") for v in checks.values())
    return {"status": "ok" if all_ok else "degraded", **checks}


# ── Simulations ─────────────────────────────────────────────


@app.post("/fund-api/simulations", response_model=SimulationStartResponse)
async def start_simulation(
    params: SimulationInput,
    x_user_id: Optional[str] = Header(None),
):
    """Dispatch a fund simulation to Celery and return the task ID."""
    task = run_simulation_task.delay(
        inputs_path=params.inputs_path or "engine_fund/inputs/fund_parameters.json",
        simulations=params.simulations,
        sensitivity=params.sensitivity,
        sensitivity_divisor=params.sensitivity_divisor,
        scenario=params.scenario,
        scenarios=params.scenarios,
        all_scenarios=params.all_scenarios,
        case_mode=params.case_mode,
        funding_profile=params.funding_profile,
        custom_parameters=params.custom_parameters,
    )
    return SimulationStartResponse(celery_task_id=task.id)


@app.get("/fund-api/simulations/{task_id}/status", response_model=ProgressResponse)
async def get_simulation_status(task_id: str):
    """Poll Celery task progress."""
    result = AsyncResult(task_id, app=celery_app)

    if result.state == "PENDING":
        return ProgressResponse(status="queued", progress=0, message="Waiting in queue")
    elif result.state == "STARTED":
        meta = result.info or {}
        return ProgressResponse(
            status="running",
            progress=0,
            message=meta.get("message", "Starting..."),
        )
    elif result.state == "PROGRESS":
        meta = result.info or {}
        return ProgressResponse(
            status="running",
            progress=meta.get("percent", 0),
            stage=meta.get("message", ""),
            message=meta.get("message", ""),
        )
    elif result.state == "SUCCESS":
        return ProgressResponse(status="completed", progress=100, message="Done")
    elif result.state == "FAILURE":
        meta = result.info or {}
        msg = str(meta) if not isinstance(meta, dict) else meta.get("message", str(meta))
        return ProgressResponse(status="failed", progress=0, message=msg)
    else:
        return ProgressResponse(status=result.state.lower(), progress=0)


@app.get("/fund-api/simulations/{task_id}")
async def get_simulation_results(task_id: str):
    """Return full results once the Celery task is complete."""
    result = AsyncResult(task_id, app=celery_app)

    if result.state == "SUCCESS":
        return {
            "status": "completed",
            "celery_task_id": task_id,
            "data": result.result,
        }
    elif result.state == "FAILURE":
        raise HTTPException(status_code=500, detail=str(result.info))
    elif result.state in ("PENDING", "STARTED", "PROGRESS"):
        raise HTTPException(status_code=202, detail="Simulation still running")
    else:
        raise HTTPException(status_code=404, detail=f"Unknown state: {result.state}")


@app.get("/fund-api/simulations")
async def list_simulations():
    """List simulations from storage backend."""
    from ..storage.factory import get_storage_backend

    backend = get_storage_backend()
    storage_dir = getattr(backend, "storage_dir", None)
    items: List[Dict[str, Any]] = []

    if storage_dir and storage_dir.is_dir():
        for f in sorted(storage_dir.glob("*_results.json"), reverse=True):
            task_id = f.stem.replace("_results", "")
            stat = f.stat()
            items.append(
                {
                    "task_id": task_id,
                    "created_at": datetime.fromtimestamp(
                        stat.st_ctime, tz=timezone.utc
                    ).isoformat(),
                    "size_bytes": stat.st_size,
                }
            )
    return {"simulations": items}


# ── Case Simulations ────────────────────────────────────────


@app.post("/fund-api/case/submit", response_model=SimulationStartResponse)
async def submit_case_simulation(
    req: CaseSubmitRequest,
    x_user_id: Optional[str] = Header(None),
):
    """Dispatch a case simulation to Celery."""
    task = run_case_simulation.delay(req.case_parameters)
    return SimulationStartResponse(celery_task_id=task.id)


@app.get("/fund-api/case/history")
async def case_history():
    """List past case simulations from disk."""
    case_dir = Path("server/runs/fund_cases")
    items: List[Dict[str, Any]] = []

    if case_dir.is_dir():
        for f in sorted(case_dir.glob("*_case.json"), reverse=True):
            task_id = f.stem.replace("_case", "")
            try:
                data = json.loads(f.read_text())
                items.append(
                    {
                        "task_id": task_id,
                        "case_name": data.get("case_name"),
                        "status": data.get("status", "COMPLETED"),
                        "completed_at": data.get("completed_at"),
                        "num_claims": data.get("num_claims"),
                    }
                )
            except Exception:
                items.append({"task_id": task_id, "status": "error"})

    return {"case_simulations": items}


# ── Inputs ──────────────────────────────────────────────────


@app.get("/fund-api/inputs")
async def list_inputs():
    """List available input JSON files."""
    items = []
    if INPUTS_DIR.is_dir():
        for f in INPUTS_DIR.glob("*.json"):
            stat = f.stat()
            items.append(
                {
                    "filename": f.name,
                    "path": str(f.relative_to(Path.cwd())),
                    "size_bytes": stat.st_size,
                    "modified_at": datetime.fromtimestamp(
                        stat.st_mtime, tz=timezone.utc
                    ).isoformat(),
                }
            )
    return {"inputs": items}


@app.get("/fund-api/inputs/content")
async def get_input_content(
    file_path: str = Query(
        default="engine_fund/inputs/fund_parameters.json",
        description="Relative path to input JSON file",
    ),
):
    """Load and return the contents of an input JSON file."""
    path = Path(file_path)
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"File not found: {file_path}")
    if not path.suffix == ".json":
        raise HTTPException(status_code=400, detail="Only JSON files are supported")

    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=400, detail=f"Invalid JSON: {e}")
