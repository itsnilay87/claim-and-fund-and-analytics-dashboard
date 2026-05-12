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
from .celery_tasks import (
    HEARTBEAT_KEY_PREFIX,
    HEARTBEAT_TTL_SECONDS,
    run_case_simulation,
    run_simulation_task,
)
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


# ── Internal: liveness of in-flight tasks (used by Node reaper) ────────────


@app.get("/fund-api/_internal/active-tasks")
async def internal_active_tasks():
    """Return celery-known live task IDs and Redis heartbeat IDs.

    Consumed by the Node-side reaper to decide whether a `running`/`queued`
    DB row corresponds to a task that is still alive. Trusts the sidecar's
    network position (loopback only via supervisord). NOT exposed externally
    by the nginx config.
    """
    active_ids: set[str] = set()
    reserved_ids: set[str] = set()
    scheduled_ids: set[str] = set()
    inspect_ok = False

    try:
        inspect = celery_app.control.inspect(timeout=2)
        active = inspect.active() or {}
        reserved = inspect.reserved() or {}
        scheduled = inspect.scheduled() or {}
        for tasks in active.values():
            for t in tasks:
                if t.get("id"):
                    active_ids.add(t["id"])
        for tasks in reserved.values():
            for t in tasks:
                if t.get("id"):
                    reserved_ids.add(t["id"])
        for tasks in scheduled.values():
            for t in tasks:
                request = t.get("request") if isinstance(t, dict) else None
                tid = (request or t).get("id") if isinstance(request or t, dict) else None
                if tid:
                    scheduled_ids.add(tid)
        inspect_ok = True
    except Exception:
        # During long solo-worker runs, ping/inspect may time out. The
        # heartbeat list below remains the authoritative liveness signal.
        inspect_ok = False

    heartbeat_ids: List[str] = []
    try:
        import redis as redis_lib

        r = redis_lib.from_url(
            os.environ.get("REDIS_URL", "redis://localhost:6379/0"),
            socket_timeout=2,
            socket_connect_timeout=2,
        )
        cursor = 0
        while True:
            cursor, keys = r.scan(cursor=cursor, match=f"{HEARTBEAT_KEY_PREFIX}*", count=200)
            for k in keys:
                key_str = k.decode() if isinstance(k, (bytes, bytearray)) else str(k)
                heartbeat_ids.append(key_str[len(HEARTBEAT_KEY_PREFIX):])
            if cursor == 0:
                break
    except Exception:
        pass

    return {
        "inspect_ok": inspect_ok,
        "active": sorted(active_ids),
        "reserved": sorted(reserved_ids),
        "scheduled": sorted(scheduled_ids),
        "heartbeats": heartbeat_ids,
        "heartbeat_ttl_seconds": HEARTBEAT_TTL_SECONDS,
    }


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

    # Reading state/info can raise if the result backend has a corrupted or
    # legacy exception payload (e.g. KeyError: 'exc_type' for tasks killed
    # mid-run by a container restart). Treat any such failure as a failed
    # task so the caller can mark the row failed instead of polling 500s
    # forever.
    try:
        state = result.state
    except Exception as exc:
        return ProgressResponse(
            status="failed",
            progress=0,
            message=f"Task result unreadable ({type(exc).__name__}); likely killed mid-run.",
        )

    def _safe_info():
        try:
            return result.info or {}
        except Exception:
            return {}

    if state == "PENDING":
        return ProgressResponse(status="queued", progress=0, message="Waiting in queue")
    elif state == "STARTED":
        meta = _safe_info()
        return ProgressResponse(
            status="running",
            progress=0,
            message=meta.get("message", "Starting..."),
        )
    elif state == "PROGRESS":
        meta = _safe_info()
        return ProgressResponse(
            status="running",
            progress=meta.get("percent", 0),
            stage=meta.get("message", ""),
            message=meta.get("message", ""),
        )
    elif state == "SUCCESS":
        return ProgressResponse(status="completed", progress=100, message="Done")
    elif state == "FAILURE":
        meta = _safe_info()
        if isinstance(meta, dict):
            msg = meta.get("message", str(meta) or "Task failed")
        else:
            msg = str(meta) or "Task failed"
        return ProgressResponse(status="failed", progress=0, message=msg)
    else:
        return ProgressResponse(status=str(state).lower(), progress=0)


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
