/**
 * @module ClaimResults
 * @description Single-claim simulation results dashboard page.
 *
 * Polls run status until completion, then embeds the full V2 dashboard
 * as an iframe pointing to /dashboard/?runId=X&apiBase=...
 *
 * Route: /workspace/:wsId/claims/:claimId/results
 */
import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft, Loader2, AlertTriangle, ExternalLink, RefreshCw,
  Maximize2, Minimize2,
} from 'lucide-react';
import { useClaimStore } from '../store/claimStore';

// ── Poll run status hook ──
function useRunStatus(runId) {
  const [status, setStatus] = useState(null);
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(!!runId);
  const pollRef = useRef(null);

  useEffect(() => {
    if (!runId) { setLoading(false); return; }
    setLoading(true);

    const poll = async () => {
      try {
        const res = await fetch(`/api/status/${encodeURIComponent(runId)}`);
        if (!res.ok) {
          if (res.status === 404) {
            // runId not found — might be stale
            setError('Run not found. The simulation may have been cleaned up.');
            setStatus('not_found');
            setLoading(false);
            clearInterval(pollRef.current);
            return;
          }
          return;
        }
        const data = await res.json();
        setStatus(data.status);
        setProgress(data.progress || 0);
        if (data.stage) setStage(data.stage);
        if (data.error) setError(data.error);
        if (data.status === 'completed' || data.status === 'failed') {
          setLoading(false);
          clearInterval(pollRef.current);
        }
      } catch { /* ignore transient errors */ }
    };

    // Initial check
    poll();
    pollRef.current = setInterval(poll, 1500);

    return () => clearInterval(pollRef.current);
  }, [runId]);

  return { status, progress, stage, error, loading };
}

// ═══════════════════════════════════════════════════════════
// Main ClaimResults Page
// ═══════════════════════════════════════════════════════════

export default function ClaimResults() {
  const { wsId, id } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const runId = searchParams.get('runId');
  const [fullscreen, setFullscreen] = useState(false);

  const claimStore = useClaimStore();

  useEffect(() => {
    claimStore.loadClaims(wsId);
  }, [wsId]);

  const claim = claimStore.claims.find(c => c.id === id);
  const effectiveRunId = runId || claim?.run_id;

  const { status, progress, stage, error, loading } = useRunStatus(effectiveRunId);

  // Build dashboard iframe URL
  const apiBase = window.location.origin;
  const dashboardUrl = effectiveRunId
    ? `/dashboard/?runId=${encodeURIComponent(effectiveRunId)}&apiBase=${encodeURIComponent(apiBase)}`
    : null;

  // ── No run ID ──
  if (!effectiveRunId) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate(`/workspace/${wsId}/claim/${id}`)}
            className="p-1.5 text-slate-500 hover:text-slate-300 rounded-md hover:bg-slate-800"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <h1 className="text-2xl font-bold text-white">Claim Results</h1>
        </div>
        <div className="glass-card p-12 text-center">
          <AlertTriangle className="w-12 h-12 text-amber-400 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-slate-300 mb-2">No Simulation Results</h3>
          <p className="text-sm text-slate-500 mb-4">
            Run a simulation from the Claim Editor first to see results here.
          </p>
          <button
            onClick={() => navigate(`/workspace/${wsId}/claim/${id}`)}
            className="inline-flex items-center gap-2 px-5 py-2 rounded-lg bg-primary-500 text-white text-sm font-medium hover:bg-primary-600"
          >
            <ExternalLink className="w-4 h-4" /> Go to Claim Editor
          </button>
        </div>
      </div>
    );
  }

  // ── Running / Queued ──
  if (loading || (status && status !== 'completed' && status !== 'failed' && status !== 'not_found')) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate(`/workspace/${wsId}/claim/${id}`)}
            className="p-1.5 text-slate-500 hover:text-slate-300 rounded-md hover:bg-slate-800"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <h1 className="text-2xl font-bold text-white">Simulation Running…</h1>
        </div>
        <div className="glass-card p-12 text-center">
          <Loader2 className="w-10 h-10 text-cyan-400 animate-spin mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-slate-300 mb-2">
            {stage || 'Processing…'}
          </h3>
          <div className="w-64 mx-auto bg-slate-800 rounded-full h-2 mt-4">
            <div
              className="bg-cyan-500 h-2 rounded-full transition-all duration-500"
              style={{ width: `${Math.max(progress, 5)}%` }}
            />
          </div>
          <p className="text-xs text-slate-500 mt-2">{Math.round(progress)}% complete</p>
        </div>
      </div>
    );
  }

  // ── Failed ──
  if (status === 'failed' || status === 'not_found') {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate(`/workspace/${wsId}/claim/${id}`)}
            className="p-1.5 text-slate-500 hover:text-slate-300 rounded-md hover:bg-slate-800"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <h1 className="text-2xl font-bold text-white">Simulation Failed</h1>
        </div>
        <div className="glass-card p-12 text-center">
          <AlertTriangle className="w-12 h-12 text-red-400 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-slate-300 mb-2">
            {status === 'not_found' ? 'Run Not Found' : 'Simulation Failed'}
          </h3>
          <p className="text-sm text-red-400 mb-4 max-w-md mx-auto">
            {error || 'An error occurred during simulation.'}
          </p>
          <button
            onClick={() => navigate(`/workspace/${wsId}/claim/${id}`)}
            className="inline-flex items-center gap-2 px-5 py-2 rounded-lg bg-primary-500 text-white text-sm font-medium hover:bg-primary-600"
          >
            <RefreshCw className="w-4 h-4" /> Try Again
          </button>
        </div>
      </div>
    );
  }

  // ── Completed — embed full V2 dashboard ──
  return (
    <div className={fullscreen ? 'fixed inset-0 z-50 bg-slate-950' : 'space-y-4'}>
      {/* Header */}
      <div className={`flex items-center justify-between ${fullscreen ? 'px-4 py-2 bg-slate-900/80 border-b border-slate-800' : ''}`}>
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate(`/workspace/${wsId}/claim/${id}`)}
            className="p-1.5 text-slate-500 hover:text-slate-300 rounded-md hover:bg-slate-800"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <h1 className={`font-bold text-white ${fullscreen ? 'text-lg' : 'text-2xl'}`}>
              {claim?.name || 'Claim Results'}
            </h1>
            {!fullscreen && (
              <div className="flex items-center gap-2 mt-1">
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-medium">
                  completed
                </span>
                <span className="text-xs text-slate-500">Run: {effectiveRunId.slice(0, 8)}…</span>
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <a
            href={dashboardUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="p-1.5 text-slate-500 hover:text-slate-300 rounded-md hover:bg-slate-800"
            title="Open in new tab"
          >
            <ExternalLink className="w-4 h-4" />
          </a>
          <button
            onClick={() => setFullscreen(f => !f)}
            className="p-1.5 text-slate-500 hover:text-slate-300 rounded-md hover:bg-slate-800"
            title={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
          >
            {fullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Dashboard iframe */}
      <iframe
        src={dashboardUrl}
        className={`w-full border-0 rounded-lg ${fullscreen ? '' : 'mt-2'}`}
        style={{ height: fullscreen ? 'calc(100vh - 52px)' : 'calc(100vh - 180px)' }}
        title="Simulation Dashboard"
        sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
      />
    </div>
  );
}
