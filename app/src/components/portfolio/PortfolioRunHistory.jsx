/**
 * @module PortfolioRunHistory
 * @description Compact list of previous simulation runs for a single portfolio.
 *
 * Fetches GET /api/portfolios/:portfolioId/runs and provides View / Save / Delete
 * actions per run.
 */
import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import {
  CheckCircle2,
  Loader2,
  AlertCircle,
  Trash2,
  Save,
  RefreshCw,
} from 'lucide-react';
import { api } from '../../services/api';

const statusConfig = {
  completed: { icon: CheckCircle2, color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
  running: { icon: Loader2, color: 'text-amber-400', bg: 'bg-amber-500/10', spin: true },
  queued: { icon: Loader2, color: 'text-blue-400', bg: 'bg-blue-500/10', spin: true },
  failed: { icon: AlertCircle, color: 'text-red-400', bg: 'bg-red-500/10' },
};

function formatDate(iso) {
  if (!iso) return '-';
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function formatMoic(v) {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return '-';
  return `${Number(v).toFixed(2)}x`;
}

function formatIrr(v) {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return '-';
  const n = Number(v);
  const pct = Math.abs(n) <= 1 ? n * 100 : n;
  return `${pct.toFixed(1)}%`;
}

export default function PortfolioRunHistory({ workspaceId, portfolioId }) {
  const [runs, setRuns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [pendingId, setPendingId] = useState(null);

  const fetchRuns = useCallback(async () => {
    if (!portfolioId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await api.get(`/api/portfolios/${encodeURIComponent(portfolioId)}/runs`);
      setRuns(data.runs || []);
    } catch (err) {
      setError(err.message);
      setRuns([]);
    } finally {
      setLoading(false);
    }
  }, [portfolioId]);

  useEffect(() => { fetchRuns(); }, [fetchRuns]);

  const handleSave = async (runId) => {
    setPendingId(runId);
    try {
      await api.post(`/api/runs/${encodeURIComponent(runId)}/save`, {});
      setRuns((prev) => prev.map((r) => (r.id === runId ? { ...r, saved: true } : r)));
    } catch (err) {
      console.error('Failed to save run:', err.message);
    } finally {
      setPendingId(null);
    }
  };

  const handleDelete = async (runId) => {
    setPendingId(runId);
    try {
      await api.delete(`/api/runs/${encodeURIComponent(runId)}`);
      setRuns((prev) => prev.filter((r) => r.id !== runId));
    } catch (err) {
      console.error('Failed to delete run:', err.message);
    } finally {
      setPendingId(null);
    }
  };

  return (
    <div className="glass-card overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200 dark:border-white/5">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Previous Runs</h3>
        <button
          onClick={fetchRuns}
          className="p-1.5 rounded-lg text-slate-400 hover:text-teal-400 hover:bg-white/5 transition-colors"
          title="Refresh"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {error && (
        <div className="px-5 py-3 text-xs text-red-400 bg-red-500/5 border-b border-red-500/10">
          {error}
        </div>
      )}

      {loading ? (
        <div className="py-10 text-center text-slate-500 text-sm">
          <Loader2 size={20} className="animate-spin mx-auto mb-2" />
          Loading runs…
        </div>
      ) : runs.length === 0 ? (
        <div className="py-10 text-center text-slate-500 text-sm">
          No previous runs for this portfolio yet.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="text-[11px] text-slate-500 uppercase tracking-wider border-b border-slate-200 dark:border-white/5">
                <th className="text-left py-2.5 px-5 font-medium">Name</th>
                <th className="text-left py-2.5 px-5 font-medium">Date</th>
                <th className="text-left py-2.5 px-5 font-medium">Status</th>
                <th className="text-right py-2.5 px-5 font-medium">MOIC</th>
                <th className="text-right py-2.5 px-5 font-medium">IRR</th>
                <th className="text-left py-2.5 px-5 font-medium">Saved</th>
                <th className="text-right py-2.5 px-5 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => {
                const sc = statusConfig[run.status] || statusConfig.completed;
                const summary = run.summary || {};
                const moicValue = summary.portfolio_moic ?? summary.moic;
                const irrValue = summary.portfolio_irr ?? summary.irr;
                const isPending = pendingId === run.id;
                return (
                  <tr
                    key={run.id}
                    className="border-b border-slate-100 dark:border-white/5 hover:bg-slate-50 dark:hover:bg-white/[0.02] transition-colors"
                  >
                    <td className="py-3 px-5 text-sm text-slate-900 dark:text-white font-medium">
                      {run.name || `Run ${run.id.slice(0, 8)}`}
                    </td>
                    <td className="py-3 px-5 text-xs text-slate-500 dark:text-slate-400">
                      {formatDate(run.created_at)}
                    </td>
                    <td className="py-3 px-5">
                      <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium ${sc.bg} ${sc.color}`}>
                        <sc.icon size={11} className={sc.spin ? 'animate-spin' : ''} />
                        {run.status}
                      </span>
                    </td>
                    <td className="py-3 px-5 text-sm text-slate-900 dark:text-white text-right font-mono">
                      {formatMoic(moicValue)}
                    </td>
                    <td className="py-3 px-5 text-sm text-slate-900 dark:text-white text-right font-mono">
                      {formatIrr(irrValue)}
                    </td>
                    <td className="py-3 px-5">
                      {run.saved === true ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-teal-50 dark:bg-teal-500/10 text-teal-700 dark:text-teal-300 border border-teal-200 dark:border-teal-500/20">
                          Saved
                        </span>
                      ) : (
                        <span className="text-[10px] text-slate-500">—</span>
                      )}
                    </td>
                    <td className="py-3 px-5 text-right">
                      <div className="inline-flex items-center gap-3">
                        {run.status === 'completed' && (
                          <Link
                            to={`/workspace/${workspaceId}/portfolio/${portfolioId}/results?runId=${encodeURIComponent(run.id)}`}
                            className="text-xs text-teal-600 dark:text-teal-400 hover:text-teal-300"
                          >
                            View
                          </Link>
                        )}
                        {run.saved !== true && run.status === 'completed' && (
                          <button
                            onClick={() => handleSave(run.id)}
                            disabled={isPending}
                            className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-emerald-400 disabled:opacity-50"
                            title="Save run"
                          >
                            <Save size={12} /> Save
                          </button>
                        )}
                        <button
                          onClick={() => handleDelete(run.id)}
                          disabled={isPending}
                          className="text-xs text-slate-500 hover:text-red-400 disabled:opacity-50"
                          title="Delete run"
                        >
                          <Trash2 size={12} className="inline" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
