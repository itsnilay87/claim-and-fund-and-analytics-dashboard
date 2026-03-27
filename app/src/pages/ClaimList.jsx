/**
 * @module ClaimList
 * @description Claim listing page with create and delete actions.
 *
 * Shows all claims in the current workspace as cards.  Provides
 * "New Claim" button (opens jurisdiction selector), delete confirmation,
 * and navigation to the claim editor.  Reads from claimStore.
 *
 * Route: /workspace/:wsId/claims
 */
import { useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useClaimStore } from '../store/claimStore';
import { FileText, Plus, Trash2, ArrowRight } from 'lucide-react';

export default function ClaimList() {
  const { wsId } = useParams();
  const navigate = useNavigate();
  const claims = useClaimStore((s) => s.claims);
  const loadClaims = useClaimStore((s) => s.loadClaims);
  const removeClaim = useClaimStore((s) => s.removeClaim);

  useEffect(() => { loadClaims(wsId); }, [wsId, loadClaims]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Claims</h1>
          <p className="mt-1 text-sm text-slate-400">{claims.length} claim{claims.length !== 1 ? 's' : ''} in this workspace</p>
        </div>
        <button
          onClick={() => navigate(`/workspace/${wsId}/claim/new`)}
          className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg transition-colors"
        >
          <Plus className="w-4 h-4" /> New Claim
        </button>
      </div>

      {claims.length === 0 ? (
        <div className="glass-card p-12 text-center">
          <div className="w-14 h-14 rounded-2xl bg-slate-800 flex items-center justify-center mx-auto mb-4">
            <FileText className="w-7 h-7 text-slate-600" />
          </div>
          <h3 className="text-base font-semibold text-slate-300 mb-2">No claims yet</h3>
          <p className="text-sm text-slate-500 mb-5">Create your first claim to get started with analysis.</p>
          <button
            onClick={() => navigate(`/workspace/${wsId}/claim/new`)}
            className="px-5 py-2 text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg transition-colors"
          >
            Create Claim
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {claims.map((claim) => (
            <div
              key={claim.id}
              className="glass-card p-4 flex items-center justify-between group hover:border-slate-600 transition-colors cursor-pointer"
              onClick={() => navigate(`/workspace/${wsId}/claim/${claim.id}`)}
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-9 h-9 rounded-lg bg-indigo-500/10 flex items-center justify-center shrink-0">
                  <FileText className="w-4 h-4 text-indigo-400" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-white truncate">{claim.name || 'Untitled Claim'}</p>
                  <p className="text-xs text-slate-500">{claim.jurisdiction || 'No jurisdiction'}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={(e) => { e.stopPropagation(); removeClaim(wsId, claim.id); }}
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
