/**
 * @module ClaimSelector
 * @description Claim checkbox selector for portfolio composition.
 *
 * Lists all claims in the workspace with checkboxes.  Shows claim name,
 * jurisdiction, SOC value, and validation status.  Selected claim IDs
 * are stored on the portfolio's `claim_ids` array.
 *
 * @prop {Array} claims - Available claims in the workspace.
 * @prop {Array} selectedIds - Currently selected claim IDs.
 * @prop {Function} onToggle - Callback when a claim is toggled.
 */
import { CheckSquare, Square, AlertTriangle, Scale } from 'lucide-react';

const JURISDICTION_LABELS = {
  indian_domestic: 'Indian Domestic',
  siac_singapore: 'SIAC Singapore',
  icc_paris: 'ICC Paris',
  lcia_london: 'LCIA London',
};

export default function ClaimSelector({
  claims,
  selectedClaims,
  toggleClaim,
  totalSOC,
  jurisdictions,
  avgWinRate,
}) {
  return (
    <div className="space-y-4">
      {/* Summary panel */}
      <div className="glass-card p-4">
        <div className="grid grid-cols-4 gap-4">
          <div>
            <p className="text-xs text-slate-500 uppercase tracking-wider">Selected</p>
            <p className="text-xl font-bold text-white">{selectedClaims.length}</p>
          </div>
          <div>
            <p className="text-xs text-slate-500 uppercase tracking-wider">Total SOC</p>
            <p className="text-xl font-bold text-cyan-400">₹{totalSOC.toLocaleString()} Cr</p>
          </div>
          <div>
            <p className="text-xs text-slate-500 uppercase tracking-wider">Jurisdictions</p>
            <p className="text-sm font-medium text-white mt-1">
              {jurisdictions.length > 0
                ? jurisdictions.map((j) => JURISDICTION_LABELS[j] || j).join(', ')
                : '—'}
            </p>
          </div>
          <div>
            <p className="text-xs text-slate-500 uppercase tracking-wider">Avg Win Rate</p>
            <p className="text-xl font-bold text-emerald-400">
              {avgWinRate > 0 ? `${(avgWinRate * 100).toFixed(0)}%` : '—'}
            </p>
          </div>
        </div>
      </div>

      {/* Claim list */}
      {claims.length === 0 ? (
        <div className="glass-card p-10 text-center">
          <Scale className="w-10 h-10 text-slate-600 mx-auto mb-3" />
          <p className="text-sm text-slate-400">No claims in this workspace yet.</p>
          <p className="text-xs text-slate-500 mt-1">Create claims first in the Claims section.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {claims.map((claim) => {
            const selected = selectedClaims.includes(claim.id);
            const isSimulated = claim.status === 'simulated';
            return (
              <button
                key={claim.id}
                type="button"
                onClick={() => toggleClaim(claim.id)}
                className={
                  'w-full text-left glass-card p-4 flex items-center gap-4 transition-all cursor-pointer ' +
                  (selected
                    ? 'border-cyan-500/40 bg-cyan-500/5'
                    : 'hover:border-slate-600')
                }
              >
                {selected ? (
                  <CheckSquare className="w-5 h-5 text-cyan-400 shrink-0" />
                ) : (
                  <Square className="w-5 h-5 text-slate-600 shrink-0" />
                )}

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-white truncate">
                      {claim.name || 'Unnamed Claim'}
                    </p>
                    {!isSimulated && (
                      <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20 shrink-0">
                        <AlertTriangle className="w-2.5 h-2.5" />
                        Simulate first
                      </span>
                    )}
                    {isSimulated && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 shrink-0">
                        Simulated
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {JURISDICTION_LABELS[claim.jurisdiction] || claim.jurisdiction}
                    {' · '}SOC: ₹{(claim.soc_value_cr || 0).toLocaleString()} Cr
                    {' · '}Win: {((claim.arbitration?.win_probability || 0) * 100).toFixed(0)}%
                  </p>
                </div>

                <p className="text-sm font-mono text-slate-400 shrink-0">
                  ₹{(claim.soc_value_cr || 0).toLocaleString()} Cr
                </p>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
