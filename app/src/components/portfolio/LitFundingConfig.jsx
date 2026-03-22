/**
 * @module LitFundingConfig
 * @description Configuration panel for litigation funding structure parameters.
 *
 * Sets cost multiple cap, award ratio cap, waterfall type (min/max),
 * and grid ranges for sensitivity analysis.  Maps to LitFundingParams.
 *
 * @prop {Object} config - Current LitFundingParams.
 * @prop {Function} onChange - Callback with updated config.
 */
import { useMemo } from 'react';

function NumberInput({ label, value, onChange, min, max, step = 0.01, suffix }) {
  return (
    <label className="block">
      <span className="text-xs text-slate-400 block mb-1">{label}</span>
      <div className="flex items-center gap-2">
        <input
          type="number"
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
          min={min}
          max={max}
          step={step}
          className="flex-1 bg-slate-900/60 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500/30"
        />
        {suffix && <span className="text-xs text-slate-500 shrink-0">{suffix}</span>}
      </div>
    </label>
  );
}

export default function LitFundingConfig({ config, onChange }) {
  const update = (key, val) => onChange({ [key]: val });

  // Real-time waterfall example
  const example = useMemo(() => {
    const legalCost = 20; // Cr
    const collected = 500; // Cr
    const costReturn = config.cost_multiple_cap * legalCost;
    const awardReturn = config.award_ratio_cap * collected;
    const finalReturn = config.waterfall_type === 'min'
      ? Math.min(costReturn, awardReturn)
      : Math.max(costReturn, awardReturn);
    return { legalCost, collected, costReturn, awardReturn, finalReturn };
  }, [config.cost_multiple_cap, config.award_ratio_cap, config.waterfall_type]);

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-semibold text-white mb-4">Litigation Funding Parameters</h3>
        <div className="grid grid-cols-2 gap-4">
          <NumberInput
            label="Cost Multiple Cap"
            value={config.cost_multiple_cap}
            onChange={(v) => update('cost_multiple_cap', v)}
            min={1} max={20} step={0.5}
            suffix="×"
          />
          <NumberInput
            label="Award Ratio Cap"
            value={config.award_ratio_cap}
            onChange={(v) => update('award_ratio_cap', v)}
            min={0.01} max={1} step={0.05}
            suffix="of collected"
          />
        </div>
      </div>

      {/* Waterfall type toggle */}
      <div>
        <span className="text-xs text-slate-400 block mb-2">Waterfall Type</span>
        <div className="flex gap-2">
          {['min', 'max'].map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => update('waterfall_type', type)}
              className={
                'px-4 py-2 rounded-lg text-sm font-medium transition-all ' +
                (config.waterfall_type === type
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
                  : 'bg-slate-800 text-slate-400 border border-slate-700 hover:border-slate-600')
              }
            >
              {type.toUpperCase()}
            </button>
          ))}
        </div>
        <p className="text-xs text-slate-500 mt-1">
          {config.waterfall_type === 'min'
            ? 'Funder return = LESSER of cost multiple and award ratio caps'
            : 'Funder return = GREATER of cost multiple and award ratio caps'}
        </p>
      </div>

      {/* Grid ranges */}
      <div>
        <h4 className="text-xs font-semibold text-slate-300 uppercase tracking-wider mb-3">Grid Ranges for Analysis</h4>
        <div className="space-y-3">
          <div className="glass-card p-3">
            <p className="text-xs text-slate-400 mb-2 font-medium">Cost Multiple Range</p>
            <div className="grid grid-cols-3 gap-3">
              <NumberInput
                label="Min" value={config.cost_multiple_range?.min ?? 2.0}
                onChange={(v) => update('cost_multiple_range', { ...config.cost_multiple_range, min: v })}
                min={1} max={10} step={0.5}
              />
              <NumberInput
                label="Max" value={config.cost_multiple_range?.max ?? 6.0}
                onChange={(v) => update('cost_multiple_range', { ...config.cost_multiple_range, max: v })}
                min={1} max={20} step={0.5}
              />
              <NumberInput
                label="Step" value={config.cost_multiple_range?.step ?? 0.5}
                onChange={(v) => update('cost_multiple_range', { ...config.cost_multiple_range, step: v })}
                min={0.1} max={2} step={0.1}
              />
            </div>
          </div>
          <div className="glass-card p-3">
            <p className="text-xs text-slate-400 mb-2 font-medium">Award Ratio Range</p>
            <div className="grid grid-cols-3 gap-3">
              <NumberInput
                label="Min" value={config.award_ratio_range?.min ?? 0.10}
                onChange={(v) => update('award_ratio_range', { ...config.award_ratio_range, min: v })}
                min={0.01} max={0.5} step={0.05}
              />
              <NumberInput
                label="Max" value={config.award_ratio_range?.max ?? 0.40}
                onChange={(v) => update('award_ratio_range', { ...config.award_ratio_range, max: v })}
                min={0.05} max={1} step={0.05}
              />
              <NumberInput
                label="Step" value={config.award_ratio_range?.step ?? 0.05}
                onChange={(v) => update('award_ratio_range', { ...config.award_ratio_range, step: v })}
                min={0.01} max={0.2} step={0.01}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Waterfall example calculator */}
      <div className="glass-card p-4 border-dashed">
        <h4 className="text-xs font-semibold text-slate-300 uppercase tracking-wider mb-3">Waterfall Example</h4>
        <p className="text-xs text-slate-500 mb-2">
          Assuming: Legal costs = ₹{example.legalCost} Cr, Collected = ₹{example.collected} Cr
        </p>
        <div className="grid grid-cols-3 gap-3 text-center">
          <div className="bg-slate-900/60 rounded-lg p-3">
            <p className="text-[10px] text-slate-500">Cost Multiple Return</p>
            <p className="text-sm font-bold text-cyan-400">₹{example.costReturn.toFixed(0)} Cr</p>
            <p className="text-[10px] text-slate-600">{config.cost_multiple_cap}× × {example.legalCost}</p>
          </div>
          <div className="bg-slate-900/60 rounded-lg p-3">
            <p className="text-[10px] text-slate-500">Award Ratio Return</p>
            <p className="text-sm font-bold text-purple-400">₹{example.awardReturn.toFixed(0)} Cr</p>
            <p className="text-[10px] text-slate-600">{config.award_ratio_cap} × {example.collected}</p>
          </div>
          <div className="bg-slate-900/60 rounded-lg p-3 border border-emerald-500/20">
            <p className="text-[10px] text-slate-500">Final ({config.waterfall_type.toUpperCase()})</p>
            <p className="text-sm font-bold text-emerald-400">₹{example.finalReturn.toFixed(0)} Cr</p>
            <p className="text-[10px] text-slate-600">Funder return</p>
          </div>
        </div>
      </div>
    </div>
  );
}
