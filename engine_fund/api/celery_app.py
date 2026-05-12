"""Celery application configuration for distributed task processing."""

from __future__ import annotations

import os

from celery import Celery

_redis_url = os.environ.get("REDIS_URL", "redis://localhost:6379/0")

celery_app = Celery(
    "fund_simulations",
    broker=_redis_url,
    backend=_redis_url,
)

# Celery configuration
celery_app.conf.update(
    # ── Serialization ──────────────────────────────────────
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
    # ── Lifecycle / progress ───────────────────────────────
    task_track_started=True,
    task_time_limit=3600,         # hard kill after 1h
    task_soft_time_limit=3300,    # SoftTimeLimitExceeded after 55m
    # ── Reliability (production-grade) ─────────────────────
    # Only ack the message after the task body returns (or raises a non-
    # retryable exception). If the worker dies mid-task (SIGKILL, OOM,
    # container recreate), the broker re-delivers the message to the next
    # worker that comes online instead of silently losing it.
    task_acks_late=True,
    task_reject_on_worker_lost=True,
    # Don't ack on failure — let the consumer/reaper decide whether to retry.
    task_acks_on_failure_or_timeout=False,
    # ── Worker tuning ──────────────────────────────────────
    worker_prefetch_multiplier=1,        # one task at a time (solo)
    worker_max_tasks_per_child=10,       # cycle worker to free memory
    worker_send_task_events=True,        # required for inspect().active() visibility
    worker_cancel_long_running_tasks_on_connection_loss=False,
    # ── Result backend ─────────────────────────────────────
    result_expires=86400,                # 24h
    result_extended=True,                # store args/kwargs for debuggability
    # ── Broker resilience ──────────────────────────────────
    broker_connection_retry_on_startup=True,
    broker_connection_retry=True,
    broker_connection_max_retries=10,
    broker_heartbeat=30,
    redis_socket_keepalive=True,
    redis_retry_on_timeout=True,
)

# CRITICAL: Import tasks to register them with Celery
# This must be imported after celery_app is created
from engine_fund.api import celery_tasks  # noqa: F401, E402
