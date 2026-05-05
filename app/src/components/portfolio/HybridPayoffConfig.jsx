/**
 * @module HybridPayoffConfig
 * @description Configuration UI for the monetisation_hybrid_payoff structure.
 *
 * Investor pays an upfront amount (% of SOC or fixed ₹ Cr) plus legal costs
 * and on a winning resolution receives ``op(A, B)`` where each leg is either
 * a multiple of the upfront or a fraction of the recovery.  The combined
 * payout is optionally clipped to ``[min_payout, max_payout]``.
 *
 * Maps to ``HybridPayoffParams`` in ``engine/config/schema.py``.
 *
 * @prop {Object} config - Current HybridPayoffParams.
 * @prop {Function} onChange - Callback with updated config.
 */
import { Layers } from 'lucide-react';

function NumField({ label, value, onChange, suffix, step = 0.01, min = 0 }) {
  return (
    <label className="block">
      <span className="text-[10px] text-slate-500 block mb-1">{label}</span>
      <div className="flex items-center gap-1">
        <input
          type="number"
          value={value ?? ''}
          onChange={(e) => {
            const v = e.target.value;
            onChange(v === '' ? null : parseFloat(v));
          }}
          step={step}
          min={min}
          className="flex-1 bg-slate-900/60 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:border-indigo-500 focus:outline-none"
        />
        {suffix && <span className="text-xs text-slate-500">{suffix}</span>}
      </div>
    </label>
  );
}

function RangeRow({ label, rangeKey, config, onChange, step = 0.05, suffix = '' }) {
  const range = config[rangeKey] || { min: 0, max: 1, step: 0.05 };
  const update = (field, val) =>
    onChange({ [rangeKey]: { ...range, [field]: val } });
  return (
    <div className="glass-card p-3">
      <p className="text-xs text-slate-400 mb-2 font-medium">{label}</p>
      <div className="grid grid-cols-3 gap-3">
        <NumField label="Min" value={range.min} onChange={(v) => update('min', v)} suffix={suffix} step={step} />
        <NumField label="Max" value={range.max} onChange={(v) => update('max', v)} suffix={suffix} step={step} />
        <NumField label="Step" value={range.step} onChange={(v) => update('step', v)} suffix={suffix} step={step} />
      </div>
    </div>
  );
}

export default function HybridPayoffConfig({ config, onChange }) {
  const update = (updates) => onChange(updates);

  const upfrontBasis = config.upfront_basis || 'pct_soc';
  const upfrontSuffix = upfrontBasis === 'fixed_amount' ? '₹ Cr' : '×';
  const upfrontStep = upfrontBasis === 'fixed_amount' ? 0.5 : 0.01;

  const renderLegSuffix = (kind) =>
    kind === 'multiple_of_upfront' ? '×' : '×';

  return (
    <div className="space-y-5">
      <h3 className="text-sm font-semibold text-white flex items-center gap-2">
        <Layers className="h-4 w-4 text-indigo-400" />
        Hybrid Payoff Configuration
      </h3>
      <p className="text-xs text-slate-400 leading-relaxed">
        Investor pays an upfront amount and bears legal costs.  On a winning
        resolution the payout is the chosen <em>min</em> or <em>max</em> of
        two legs (Return A and Return B), each parameterised independently as
        a multiple of the upfront or a fraction of the recovery — optionally
        clipped to a minimum and maximum.
      </p>

      {/* Upfront */}
      <div className="glass-card p-4 space-y-3">
        <h4 className="text-xs font-semibold text-slate-300 uppercase tracking-wider">Upfront Payment</h4>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-[10px] text-slate-500 block mb-1">Basis</span>
            <select
              value={upfrontBasis}
              onChange={(e) => update({ upfront_basis: e.target.value })}
              className="w-full bg-slate-900/60 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:border-indigo-500 focus:outline-none"
            >
              <option value="pct_soc">% of SOC</option>
              <option value="fixed_amount">Fixed Amount (₹ Cr)</option>
            </select>
          </label>
          <NumField
            label="Reference Value"
            value={config.upfront_value}
            onChange={(v) => update({ upfront_value: v })}
            suffix={upfrontBasis === 'fixed_amount' ? '₹ Cr' : ''}
            step={upfrontStep}
          />
        </div>
        <RangeRow
          label="Upfront Sweep Range (grid axis)"
          rangeKey="upfront_range"
          config={config}
          onChange={update}
          step={upfrontStep}
          suffix={upfrontBasis === 'fixed_amount' ? '₹' : ''}
        />
      </div>

      {/* Return A */}
      <div className="glass-card p-4 space-y-3">
        <h4 className="text-xs font-semibold text-slate-300 uppercase tracking-wider">Return Leg A</h4>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-[10px] text-slate-500 block mb-1">Type</span>
            <select
              value={config.return_a_type || 'multiple_of_upfront'}
              onChange={(e) => update({ return_a_type: e.target.value })}
              className="w-full bg-slate-900/60 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:border-indigo-500 focus:outline-none"
            >
              <option value="multiple_of_upfront">Multiple of Upfront</option>
              <option value="pct_of_recovery">% of Recovery</option>
            </select>
          </label>
          <NumField
            label="Reference Value"
            value={config.return_a_value}
            onChange={(v) => update({ return_a_value: v })}
            suffix={renderLegSuffix(config.return_a_type)}
            step={0.1}
          />
        </div>
        <RangeRow
          label="Return A Sweep Range (grid axis)"
          rangeKey="return_a_range"
          config={config}
          onChange={update}
          step={0.1}
        />
      </div>

      {/* Return B */}
      <div className="glass-card p-4 space-y-3">
        <h4 className="text-xs font-semibold text-slate-300 uppercase tracking-wider">Return Leg B</h4>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-[10px] text-slate-500 block mb-1">Type</span>
            <select
              value={config.return_b_type || 'pct_of_recovery'}
              onChange={(e) => update({ return_b_type: e.target.value })}
              className="w-full bg-slate-900/60 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:border-indigo-500 focus:outline-none"
            >
              <option value="multiple_of_upfront">Multiple of Upfront</option>
              <option value="pct_of_recovery">% of Recovery</option>
            </select>
          </label>
          <NumField
            label="Value"
            value={config.return_b_value}
            onChange={(v) => update({ return_b_value: v })}
            suffix={renderLegSuffix(config.return_b_type)}
            step={0.05}
          />
        </div>
      </div>

      {/* Combine + clip */}
      <div className="glass-card p-4 space-y-3">
        <h4 className="text-xs font-semibold text-slate-300 uppercase tracking-wider">Combine &amp; Clip</h4>
        <div className="grid grid-cols-3 gap-3">
          <label className="block">
            <span className="text-[10px] text-slate-500 block mb-1">Operator</span>
            <select
              value={config.operator || 'max'}
              onChange={(e) => update({ operator: e.target.value })}
              className="w-full bg-slate-900/60 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:border-indigo-500 focus:outline-none"
            >
              <option value="max">Max(A, B)</option>
              <option value="min">Min(A, B)</option>
            </select>
          </label>
          <NumField
            label="Min Payout (₹ Cr)"
            value={config.min_payout}
            onChange={(v) => update({ min_payout: v })}
            suffix="₹"
            step={0.5}
          />
          <NumField
            label="Max Payout (₹ Cr)"
            value={config.max_payout}
            onChange={(v) => update({ max_payout: v })}
            suffix="₹"
            step={0.5}
          />
        </div>
        <p className="text-[11px] text-slate-500 leading-relaxed">
          Leave Min/Max blank to disable clipping.  The combined payout is
          always capped at the actual recovery amount.
        </p>
      </div>
    </div>
  );
}
