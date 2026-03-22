/**
 * @module StagedPaymentConfig
 * @description Staged milestone payment configuration editor.
 *
 * Add/remove milestone rows (name + payment amount in Cr).  Sets
 * legal cost bearer and purchased share.  Maps to StagedPaymentParams.
 *
 * @prop {Object} config - Current StagedPaymentParams.
 * @prop {Function} onChange - Callback with updated config.
 */
import { Plus, Trash2 } from 'lucide-react';

const MILESTONE_OPTIONS = [
  'Signing',
  'DAB Filing',
  'DAB Award',
  'Arbitration Filing',
  'Arbitration Hearing',
  'Arbitration Award',
  'Enforcement Filing',
  'Enforcement Order',
  'Collection',
];

export default function StagedPaymentConfig({ config, onChange }) {
  const update = (key, val) => onChange({ [key]: val });
  const milestones = config.milestones || [];

  const addMilestone = () => {
    const used = new Set(milestones.map((m) => m.name));
    const next = MILESTONE_OPTIONS.find((o) => !used.has(o)) || 'Custom';
    update('milestones', [...milestones, { name: next, amount: 5, unit: 'pct_soc' }]);
  };

  const removeMilestone = (idx) => {
    update('milestones', milestones.filter((_, i) => i !== idx));
  };

  const updateMilestone = (idx, field, val) => {
    const updated = milestones.map((m, i) => i === idx ? { ...m, [field]: val } : m);
    update('milestones', updated);
  };

  const totalPct = milestones
    .filter((m) => m.unit === 'pct_soc')
    .reduce((sum, m) => sum + (m.amount || 0), 0);
  const totalCr = milestones
    .filter((m) => m.unit === 'cr')
    .reduce((sum, m) => sum + (m.amount || 0), 0);

  return (
    <div className="space-y-5">
      <h3 className="text-sm font-semibold text-white">Staged Payment Configuration</h3>

      {/* Milestone table */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-slate-400">Milestone Schedule</span>
          <button
            type="button"
            onClick={addMilestone}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-500/10 text-emerald-400 text-xs border border-emerald-500/20 hover:bg-emerald-500/20 transition-colors"
          >
            <Plus className="w-3 h-3" /> Add Milestone
          </button>
        </div>

        <div className="space-y-2">
          {milestones.map((m, idx) => (
            <div key={idx} className="glass-card p-3 flex items-center gap-3">
              <span className="text-xs text-slate-500 w-6 shrink-0">{idx + 1}.</span>

              {/* Milestone name dropdown */}
              <select
                value={m.name}
                onChange={(e) => updateMilestone(idx, 'name', e.target.value)}
                className="flex-1 bg-slate-900/60 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none appearance-none"
              >
                {MILESTONE_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
                {!MILESTONE_OPTIONS.includes(m.name) && (
                  <option value={m.name}>{m.name}</option>
                )}
              </select>

              {/* Amount */}
              <input
                type="number"
                value={m.amount}
                onChange={(e) => updateMilestone(idx, 'amount', parseFloat(e.target.value) || 0)}
                min={0} step={0.5}
                className="w-20 bg-slate-900/60 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
              />

              {/* Unit toggle */}
              <select
                value={m.unit}
                onChange={(e) => updateMilestone(idx, 'unit', e.target.value)}
                className="w-28 bg-slate-900/60 border border-slate-700 rounded-lg px-2 py-2 text-xs text-white focus:border-emerald-500 focus:outline-none appearance-none"
              >
                <option value="pct_soc">% of SOC</option>
                <option value="cr">Cr (abs)</option>
              </select>

              {/* Remove */}
              <button
                type="button"
                onClick={() => removeMilestone(idx)}
                className="p-1.5 text-slate-500 hover:text-red-400 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}

          {milestones.length === 0 && (
            <div className="glass-card p-6 text-center">
              <p className="text-xs text-slate-500">No milestones configured. Add milestones above.</p>
            </div>
          )}
        </div>

        {/* Total display */}
        {milestones.length > 0 && (
          <div className="mt-3 flex gap-4 text-sm">
            {totalPct > 0 && (
              <span className="text-emerald-400 font-medium">Total: {totalPct}% of SOC</span>
            )}
            {totalCr > 0 && (
              <span className="text-cyan-400 font-medium">+ ₹{totalCr} Cr absolute</span>
            )}
          </div>
        )}
      </div>

      {/* Legal cost bearer */}
      <div>
        <span className="text-xs text-slate-400 block mb-2">Legal Cost Bearer</span>
        <div className="flex gap-2">
          {['investor', 'claimant'].map((opt) => (
            <button
              key={opt}
              type="button"
              onClick={() => update('legal_cost_bearer', opt)}
              className={
                'px-4 py-2 rounded-lg text-sm font-medium capitalize transition-all ' +
                (config.legal_cost_bearer === opt
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                  : 'bg-slate-800 text-slate-400 border border-slate-700 hover:border-slate-600')
              }
            >
              {opt}
            </button>
          ))}
        </div>
      </div>

      {/* Purchased share */}
      <div>
        <label className="block">
          <span className="text-xs text-slate-400 block mb-1">Purchased Share %</span>
          <input
            type="number"
            value={config.purchased_share_pct}
            onChange={(e) => update('purchased_share_pct', parseFloat(e.target.value) || 100)}
            min={1} max={100} step={1}
            className="w-32 bg-slate-900/60 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
          />
        </label>
      </div>
    </div>
  );
}
