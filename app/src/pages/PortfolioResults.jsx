/**
 * @module PortfolioResults
 * @description Portfolio simulation results page.
 *
 * Submits portfolio config to the Express server, polls for completion,
 * then embeds the interactive Recharts/D3 dashboard with all analysis
 * tabs (Executive Summary, Pricing Grid, Risk, Cashflow, etc.).
 *
 * Route: /workspace/:wsId/portfolios/:portfolioId/results
 */
import { useState, useEffect } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Briefcase, Loader2, AlertCircle, ExternalLink, Download } from 'lucide-react';
import { usePortfolioStore } from '../store/portfolioStore';
import DownloadsPanel from '../components/simulation/DownloadsPanel';

const STRUCTURE_LABELS = {
  litigation_funding: 'Litigation Funding',
  monetisation_full_purchase: 'Full Purchase',
  monetisation_upfront_tail: 'Upfront + Tail',
  monetisation_staged: 'Staged Payments',
  comparative: 'Comparative',
};

export default function PortfolioResults() {
  const { wsId, id } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const runId = searchParams.get('runId');

  const portfolios = usePortfolioStore((s) => s.portfolios);
  const loadPortfolios = usePortfolioStore((s) => s.loadPortfolios);

  useEffect(() => { loadPortfolios(wsId); }, [wsId, loadPortfolios]);

  const portfolio = portfolios.find((p) => p.id === id);
  const effectiveRunId = runId || portfolio?.run_id;

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [downloadsOpen, setDownloadsOpen] = useState(false);

  // Load dashboard data from server
  useEffect(() => {
    if (!effectiveRunId) {
      setLoading(false);
      setError('No run ID available. Run the analysis first.');
      return;
    }

    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/results/${encodeURIComponent(effectiveRunId)}/dashboard_data.json`);
        if (!res.ok) throw new Error(`Failed to load results: HTTP ${res.status}`);
        const json = await res.json();
        if (!cancelled) setData(json);
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [effectiveRunId]);

  const structureType = data?.structure_type || portfolio?.structure || 'monetisation_upfront_tail';

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate(`/workspace/${wsId}/portfolio/${id}`)}
            className="p-1.5 text-slate-500 hover:text-slate-300 rounded-md hover:bg-slate-800"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="flex items-center gap-3">
            <Briefcase className="w-5 h-5 text-cyan-400" />
            <div>
              <h1 className="text-xl font-bold text-white">
                {portfolio?.name || 'Portfolio'} — Results
              </h1>
              <p className="text-xs text-slate-500">
                Run: {effectiveRunId ? effectiveRunId.slice(0, 8) + '…' : 'N/A'}
              </p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {structureType && (
            <span className="text-xs px-2.5 py-1 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 font-medium">
              {STRUCTURE_LABELS[structureType] || structureType}
            </span>
          )}
          <button
            onClick={() => navigate(`/workspace/${wsId}/portfolio/${id}`)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-slate-400 hover:text-white hover:bg-slate-800 transition-all"
          >
            <ArrowLeft className="w-3 h-3" /> Back to Portfolio
          </button>
          {effectiveRunId && data && (
            <button
              onClick={() => setDownloadsOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-white transition-all"
              style={{ background: 'linear-gradient(135deg, #10B981 0%, #06B6D4 100%)' }}
            >
              <Download className="w-3 h-3" /> Downloads
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      {loading && (
        <div className="glass-card p-16 text-center">
          <Loader2 className="w-8 h-8 text-cyan-400 animate-spin mx-auto mb-3" />
          <p className="text-sm text-slate-400">Loading results…</p>
        </div>
      )}

      {error && (
        <div className="glass-card p-12 text-center">
          <AlertCircle className="w-8 h-8 text-red-400 mx-auto mb-3" />
          <p className="text-sm text-red-400 mb-2">{error}</p>
          <button
            onClick={() => navigate(`/workspace/${wsId}/portfolio/${id}`)}
            className="px-4 py-2 rounded-lg text-sm font-medium text-white bg-slate-800 hover:bg-slate-700 transition-colors"
          >
            Back to Portfolio Builder
          </button>
        </div>
      )}

      {data && !loading && (
        <div className="space-y-4">
          {/* Open in full dashboard link */}
          <div className="flex justify-end">
            <a
              href={`/dashboard/?runId=${encodeURIComponent(effectiveRunId)}&apiBase=${encodeURIComponent(window.location.origin)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-cyan-400 transition-colors"
            >
              <ExternalLink className="w-3 h-3" /> Open Full Dashboard
            </a>
          </div>

          {/* Embedded dashboard via iframe for isolation */}
          <div className="glass-card overflow-hidden" style={{ minHeight: '80vh' }}>
            <iframe
              src={`/dashboard/?runId=${encodeURIComponent(effectiveRunId)}&apiBase=${encodeURIComponent(window.location.origin)}`}
              className="w-full border-0"
              style={{ height: '85vh' }}
              title="Portfolio Results Dashboard"
            />
          </div>
        </div>
      )}

      {/* Downloads slide-out panel */}
      <DownloadsPanel
        runId={effectiveRunId}
        isOpen={downloadsOpen}
        onClose={() => setDownloadsOpen(false)}
      />
    </div>
  );
}
