/**
 * @module WorkspaceDashboard
 * @description Workspace overview page showing claims and portfolios.
 *
 * Displays workspace name, quick stats (claim/portfolio counts, total SOC),
 * recent claims list, and recent portfolios list with action buttons.
 *
 * Route: /workspace/:wsId
 */
import { useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useWorkspaceStore } from '../store/workspaceStore';
import { useClaimStore } from '../store/claimStore';
import { usePortfolioStore } from '../store/portfolioStore';
import { FileText, Briefcase, Plus, ArrowRight, FolderPlus } from 'lucide-react';

export default function WorkspaceDashboard() {
  const { wsId } = useParams();
  const navigate = useNavigate();
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const workspace = workspaces.find((w) => w.id === wsId);
  const claims = useClaimStore((s) => s.claims);
  const loadClaims = useClaimStore((s) => s.loadClaims);
  const portfolios = usePortfolioStore((s) => s.portfolios);
  const loadPortfolios = usePortfolioStore((s) => s.loadPortfolios);

  useEffect(() => { loadClaims(wsId); loadPortfolios(wsId); }, [wsId, loadClaims, loadPortfolios]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white">{workspace?.name || 'Workspace'}</h1>
        {workspace?.description && (
          <p className="mt-1 text-sm text-slate-400">{workspace.description}</p>
        )}
      </div>

      {/* Stat cards */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <div className="glass-card p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-lg bg-indigo-500/10 flex items-center justify-center">
              <FileText className="w-5 h-5 text-indigo-400" />
            </div>
            <div>
              <p className="text-2xl font-bold text-white">{claims.length}</p>
              <p className="text-xs text-slate-400">Claims</p>
            </div>
          </div>
          <button
            onClick={() => navigate(`/workspace/${wsId}/claims`)}
            className="text-xs text-indigo-400 hover:text-indigo-300 flex items-center gap-1"
          >
            View all <ArrowRight className="w-3 h-3" />
          </button>
        </div>

        <div className="glass-card p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-lg bg-cyan-500/10 flex items-center justify-center">
              <Briefcase className="w-5 h-5 text-cyan-400" />
            </div>
            <div>
              <p className="text-2xl font-bold text-white">{portfolios.length}</p>
              <p className="text-xs text-slate-400">Portfolios</p>
            </div>
          </div>
          <button
            onClick={() => navigate(`/workspace/${wsId}/portfolios`)}
            className="text-xs text-cyan-400 hover:text-cyan-300 flex items-center gap-1"
          >
            View all <ArrowRight className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Quick actions */}
      <div className="glass-card p-6">
        <h2 className="text-base font-semibold text-white mb-4">Quick Actions</h2>
        <div className="flex flex-wrap gap-3">
          <button
            onClick={() => navigate(`/workspace/${wsId}/claim/new`)}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-indigo-300 bg-indigo-500/10 hover:bg-indigo-500/20 border border-indigo-500/20 rounded-lg transition-colors"
          >
            <Plus className="w-4 h-4" /> New Claim
          </button>
          <button
            onClick={() => navigate(`/workspace/${wsId}/portfolio/new`)}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-cyan-300 bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/20 rounded-lg transition-colors"
          >
            <Plus className="w-4 h-4" /> New Portfolio
          </button>
          <button
            onClick={() => navigate('/workspaces')}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-violet-300 bg-violet-500/10 hover:bg-violet-500/20 border border-violet-500/20 rounded-lg transition-colors"
          >
            <FolderPlus className="w-4 h-4" /> All Workspaces
          </button>
        </div>
      </div>
    </div>
  );
}
