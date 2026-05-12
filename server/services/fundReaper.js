/**
 * Fund Simulation Reaper
 * ----------------------
 * Production-grade orphan recovery for the Celery-backed fund simulation
 * pipeline. Marks `running` / `queued` rows as `failed` if their underlying
 * Celery task is no longer alive (worker crash, container recreate, OOM,
 * SIGKILL during deploy).
 *
 * Liveness signals (any one is sufficient to keep a row alive):
 *   1. Redis heartbeat key  fund:hb:<celery_task_id>      (TTL = 180s, refreshed by worker)
 *   2. Celery `inspect().active()` / reserved() / scheduled()
 *
 * Grace window: a row must be older than REAPER_MIN_AGE_MS before we touch
 * it (avoids racing the freshly-submitted task that hasn't yet emitted its
 * first heartbeat).
 */

const { query } = require('../db/pool');
const fundSidecar = require('./fundSidecarClient');
const FundSimulation = require('../db/models/FundSimulation');

const REAPER_INTERVAL_MS = parseInt(process.env.FUND_REAPER_INTERVAL_MS || '60000', 10);   // 60s default
const REAPER_MIN_AGE_MS = parseInt(process.env.FUND_REAPER_MIN_AGE_MS || '180000', 10);    // 3 min grace

let _timer = null;
let _running = false;

async function _fetchActiveTaskIds() {
  // Hit the sidecar's internal endpoint. Returns null if unreachable so we
  // can fail-safe (do nothing rather than mark live tasks failed).
  try {
    const url = `${process.env.FUND_SIDECAR_URL || 'http://localhost:8000'}/fund-api/_internal/active-tasks`;
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(t);
    if (!res.ok) return null;
    const body = await res.json();
    const set = new Set();
    for (const id of body.active || []) set.add(id);
    for (const id of body.reserved || []) set.add(id);
    for (const id of body.scheduled || []) set.add(id);
    for (const id of body.heartbeats || []) set.add(id);
    return { liveIds: set, inspectOk: !!body.inspect_ok };
  } catch (err) {
    return null;
  }
}

async function reapStuckSimulations() {
  if (_running) return { skipped: true, reason: 'already running' };
  _running = true;
  try {
    // Pull candidate rows: active status, older than the grace window.
    const { rows: candidates } = await query(
      `SELECT id, name, celery_task_id, status, started_at, created_at
         FROM fund_simulations
        WHERE status IN ('queued', 'running')
          AND deleted_at IS NULL
          AND COALESCE(started_at, created_at) < NOW() - ($1 || ' milliseconds')::interval`,
      [REAPER_MIN_AGE_MS]
    );

    if (candidates.length === 0) {
      return { checked: 0, reaped: 0 };
    }

    const liveness = await _fetchActiveTaskIds();
    if (!liveness) {
      // Sidecar unreachable — fail safe, do not mark anything failed.
      console.warn('[fund-reaper] Sidecar unreachable; skipping this cycle');
      return { checked: candidates.length, reaped: 0, skipped: true };
    }

    const reaped = [];
    for (const row of candidates) {
      const taskId = row.celery_task_id;
      // No celery_task_id at all after grace window → submit failed silently.
      if (!taskId) {
        await FundSimulation.updateStatus(row.id, {
          status: 'failed',
          errorMessage: 'No Celery task ID assigned within grace window (sidecar likely rejected the submit).',
        });
        reaped.push({ id: row.id, name: row.name, reason: 'no_task_id' });
        continue;
      }
      if (liveness.liveIds.has(taskId)) continue; // alive

      // Not in any active/reserved/scheduled set AND no heartbeat key.
      // This is a definitive orphan.
      await FundSimulation.updateStatus(row.id, {
        status: 'failed',
        errorMessage:
          'Worker died before completing this run (no heartbeat for >' +
          Math.round(REAPER_MIN_AGE_MS / 1000) +
          's and not in Celery active/reserved set). Likely killed by deploy or OOM. Safe to re-run.',
      });
      reaped.push({ id: row.id, name: row.name, taskId, reason: 'no_heartbeat' });
    }

    if (reaped.length > 0) {
      console.warn(
        `[fund-reaper] Reaped ${reaped.length} orphan simulation(s):`,
        reaped.map((r) => `${r.name || r.id}(${r.reason})`).join(', ')
      );
    }
    return { checked: candidates.length, reaped: reaped.length, details: reaped };
  } catch (err) {
    console.error('[fund-reaper] Cycle failed:', err.message);
    return { error: err.message };
  } finally {
    _running = false;
  }
}

function startFundReaper() {
  if (_timer) return; // idempotent
  // Run once shortly after boot (gives sidecar time to start), then on interval.
  setTimeout(() => {
    reapStuckSimulations().catch((e) =>
      console.error('[fund-reaper] startup sweep failed:', e.message)
    );
  }, 15_000);
  _timer = setInterval(() => {
    reapStuckSimulations().catch((e) =>
      console.error('[fund-reaper] cycle failed:', e.message)
    );
  }, REAPER_INTERVAL_MS);
  // Don't keep the event loop alive solely for this timer.
  if (typeof _timer.unref === 'function') _timer.unref();
  console.log(
    `[fund-reaper] Started — interval=${REAPER_INTERVAL_MS}ms, minAge=${REAPER_MIN_AGE_MS}ms`
  );
}

function stopFundReaper() {
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
  }
}

module.exports = { startFundReaper, stopFundReaper, reapStuckSimulations };
