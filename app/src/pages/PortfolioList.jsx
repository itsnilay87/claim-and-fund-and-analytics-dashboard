/**
 * @module PortfolioList
 * @description Portfolio listing page with create and delete actions.
 *
 * Shows all portfolios in the current workspace as summary cards.
 * Provides "New Portfolio" button and delete confirmation.  Reads
 * from portfolioStore.
 *
 * Route: /workspace/:wsId/portfolios
 */
import { useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { usePortfolioStore } from '../store/portfolioStore';
import { Briefcase, Plus, Trash2, ArrowRight } from 'lucide-react';

export default function PortfolioList() {
  const { wsId } = useParams();
  const navigate = useNavigate();
  const portfolios = usePortfolioStore((s) => s.portfolios);
  const loadPortfolios = usePortfolioStore((s) => s.loadPortfolios);
  const deletePortfolio = usePortfolioStore((s) => s.deletePortfolio);

  useEffect(() => { loadPortfolios(wsId); }, [wsId, loadPortfolios]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Portfolios</h1>
          <p className="mt-1 text-sm text-slate-400">{portfolios.length} portfolio{portfolios.length !== 1 ? 's' : ''} in this workspace</p>
        </div>
        <button
          onClick={() => navigate(`/workspace/${wsId}/portfolio/new`)}
          className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg transition-colors"
        >
          <Plus className="w-4 h-4" /> New Portfolio
        </button>
      </div>

      {portfolios.length === 0 ? (
        <div className="glass-card p-12 text-center">
          <div className="w-14 h-14 rounded-2xl bg-slate-800 flex items-center justify-center mx-auto mb-4">
            <Briefcase className="w-7 h-7 text-slate-600" />
          </div>
          <h3 className="text-base font-semibold text-slate-300 mb-2">No portfolios yet</h3>
          <p className="text-sm text-slate-500 mb-5">Build a portfolio by selecting claims and choosing an investment structure.</p>
          <button
            onClick={() => navigate(`/workspace/${wsId}/portfolio/new`)}
            className="px-5 py-2 text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg transition-colors"
          >
            Create Portfolio
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {portfolios.map((portfolio) => (
            <div
              key={portfolio.id}
              className="glass-card p-4 flex items-center justify-between group hover:border-slate-600 transition-colors cursor-pointer"
              onClick={() => navigate(`/workspace/${wsId}/portfolio/${portfolio.id}`)}
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-9 h-9 rounded-lg bg-cyan-500/10 flex items-center justify-center shrink-0">
                  <Briefcase className="w-4 h-4 text-cyan-400" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-white truncate">{portfolio.name || 'Untitled Portfolio'}</p>
                  <p className="text-xs text-slate-500">
                    {portfolio.structure ? portfolio.structure.replace(/_/g, ' ') : 'No structure'}
                    {portfolio.claim_ids?.length ? ` · ${portfolio.claim_ids.length} claim${portfolio.claim_ids.length !== 1 ? 's' : ''}` : ''}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={(e) => { e.stopPropagation(); deletePortfolio(portfolio.id); }}
                  className="opacity-0 group-hover:opacity-100 p-1.5 text-slate-500 hover:text-red-400 transition-all"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
                <ArrowRight className="w-4 h-4 text-slate-600 group-hover:text-slate-400" />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
