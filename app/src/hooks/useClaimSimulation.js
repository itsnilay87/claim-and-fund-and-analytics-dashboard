import { useState, useCallback, useRef, useEffect } from 'react';
import { api } from '../services/api';

/**
 * useClaimRun — manages single-claim simulation submission and polling.
 * Uses the centralized api client for auth-protected simulation endpoints.
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
      const data = await api.post('/api/simulate/claim', {
        claim_config: claimConfig,
        simulation,
        workspace_id: claimConfig.workspace_id,
        claim_id: claimConfig.id,
      });
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
        const data = await api.get(`/api/status/${encodeURIComponent(runId)}`);
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
        const dashboard = await api.get(`${base}/dashboard_data.json`);

        // Fetch stochastic pricing (optional, may not exist)
        let stochastic = null;
        try {
          stochastic = await api.get(`${base}/stochastic_pricing.json`);
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
