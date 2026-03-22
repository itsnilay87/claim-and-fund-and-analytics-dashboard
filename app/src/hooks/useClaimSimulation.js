import { useState, useCallback, useRef, useEffect } from 'react';

/**
 * useClaimRun — manages single-claim simulation submission and polling.
 */
export function useClaimRun() {
  const [runId, setRunId] = useState(null);
  const [status, setStatus] = useState(null);
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState('');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const pollRef = useRef(null);

  const submit = useCallback(async (claimConfig, simulation) => {
    setSubmitting(true);
    setError(null);
    setStatus(null);
    setProgress(0);
    setStage('');

    try {
      const res = await fetch('/api/simulate/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ claim_config: claimConfig, simulation }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(err.error || err.details || `Server error ${res.status}`);
      }

      const data = await res.json();
      setRunId(data.runId);
      setStatus('queued');
      return data.runId;
    } catch (err) {
      setError(err.message);
      return null;
    } finally {
      setSubmitting(false);
    }
  }, []);

  // Poll status
  useEffect(() => {
    if (!runId || status === 'completed' || status === 'failed') {
      if (pollRef.current) clearInterval(pollRef.current);
      return;
    }

    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/status/${encodeURIComponent(runId)}`);
        if (!res.ok) return;
        const data = await res.json();
        setStatus(data.status);
        setProgress(data.progress || 0);
        if (data.stage) setStage(data.stage);
        if (data.error) setError(data.error);
        if (data.status === 'completed' || data.status === 'failed') {
          clearInterval(pollRef.current);
        }
      } catch { /* ignore transient errors */ }
    }, 1500);

    return () => clearInterval(pollRef.current);
  }, [runId, status]);

  const reset = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    setRunId(null);
    setStatus(null);
    setProgress(0);
    setStage('');
    setError(null);
    setSubmitting(false);
  }, []);

  return {
    runId,
    status,
    progress,
    stage,
    error,
    submitting,
    submit,
    reset,
    isRunning: status === 'queued' || status === 'running',
    isComplete: status === 'completed',
    isFailed: status === 'failed',
  };
}

/**
 * useClaimResults — fetch V2 dashboard results for a given runId.
 * Loads dashboard_data.json (main) and stochastic_pricing.json (supplementary).
 */
export function useClaimResults(runId) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!runId) return;
    let cancelled = false;

    (async () => {
      setLoading(true);
      setError(null);
      try {
        const base = `/api/results/${encodeURIComponent(runId)}`;
        // Fetch main dashboard data (required)
        const mainRes = await fetch(`${base}/dashboard_data.json`);
        if (!mainRes.ok) throw new Error(`HTTP ${mainRes.status}`);
        const dashboard = await mainRes.json();

        // Fetch stochastic pricing (optional, may not exist)
        let stochastic = null;
        try {
          const stochRes = await fetch(`${base}/stochastic_pricing.json`);
          if (stochRes.ok) stochastic = await stochRes.json();
        } catch { /* optional */ }

        if (!cancelled) {
          // Merge stochastic into top-level if not already embedded
          if (stochastic && !dashboard.stochastic_pricing?.grid) {
            dashboard.stochastic_pricing = stochastic;
          }
          setData(dashboard);
        }
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [runId]);

  return { data, loading, error };
}
