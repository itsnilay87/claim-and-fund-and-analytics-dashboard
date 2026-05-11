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
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
    task_track_started=True,
    task_time_limit=3600,  # 1 hour hard limit
    task_soft_time_limit=3300,  # 55 minutes soft limit
    worker_prefetch_multiplier=1,  # Only fetch one task at a time
    worker_max_tasks_per_child=10,  # Restart worker after 10 tasks to prevent memory leaks
    result_expires=86400,  # Results expire after 24 hours
    broker_connection_retry_on_startup=True,
)

# CRITICAL: Import tasks to register them with Celery
# This must be imported after celery_app is created
from engine_fund.api import celery_tasks  # noqa: F401, E402
