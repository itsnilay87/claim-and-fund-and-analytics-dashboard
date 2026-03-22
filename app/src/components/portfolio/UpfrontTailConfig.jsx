/**
 * @module UpfrontTailConfig
 * @description Upfront + tail range configuration for monetisation structure.
 *
 * Sets upfront and tail percentage ranges (min, max, step) and pricing
 * basis (SOC vs EV).  These ranges define the investment grid axes.
 * Maps to UpfrontTailParams.
 *
 * @prop {Object} config - Current UpfrontTailParams.
 * @prop {Function} onChange - Callback with updated config.
 */
import { useState, useMemo } from 'react';
import { ChevronDown, ChevronUp, Grid3X3 } from 'lucide-react';

function RangeInput({ label, rangeKey, config, onChange, suffix = '%' }) {
  const range = config[rangeKey] || { min: 5, max: 50, step: 5 };
  const update = (field, val) => {
    onChange({ [rangeKey]: { ...range, [field]: val } });
  };

  return (
    <div className="glass-card p-3">
      <p className="text-xs text-slate-400 mb-2 font-medium">{label}</p>
      <div className="grid grid-cols-3 gap-3">
        <label className="block">
          <span className="text-[10px] text-slate-500 block mb-1">Min</span>
          <div className="flex items-center gap-1">
            <input
              type="number"
              value={range.min}
              onChange={(e) => update('min', parseFloat(e.target.value) || 0)}
              min={0} max={100} step={1}
              className="flex-1 bg-slate-900/60 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:border-indigo-500 focus:outline-none"
            />
            <span className="text-xs text-slate-500">{suffix}</span>
          </div>
        </label>
        <label className="block">
          <span className="text-[10px] text-slate-500 block mb-1">Max</span>
          <div className="flex items-center gap-1">
            <input
              type="number"
              value={range.max}
              onChange={(e) => update('max', parseFloat(e.target.value) || 0)}
              min={0} max={100} step={1}
              className="flex-1 bg-slate-900/60 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:border-indigo-500 focus:outline-none"
            />
            <span className="text-xs text-slate-500">{suffix}</span>
          </div>
        </label>
        <label className="block">
          <span className="text-[10px] text-slate-500 block mb-1">Step</span>
          <div className="flex items-center gap-1">
            <input
              type="number"
              value={range.step}
              onChange={(e) => update('step', parseFloat(e.target.value) || 1)}
              min={1} max={25} step={1}
              className="flex-1 bg-slate-900/60 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:border-indigo-500 focus:outline-none"
            />
            <span className="text-xs text-slate-500">{suffix}</span>
          </div>
        </label>
      </div>
    </div>
  );
}

export default function UpfrontTailConfig({ config, onChange }) {
  const update = (updates) => onChange(updates);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [useCustomGrid, setUseCustomGrid] = useState(
    !!(config.upfront_pcts?.length || config.tata_tail_pcts?.length)
  );

  const ur = config.upfront_range || { min: 5, max: 50, step: 5 };
  const tr = config.tail_range || { min: 0, max: 50, step: 5 };

  // Grid size preview
  const gridSize = useMemo(() => {
    const stepU = config.fine_grained ? 1 : (ur.step || 5);
    const stepT = config.fine_grained ? 1 : (tr.step || 5);
    const cols = Math.max(1, Math.floor((ur.max - ur.min) / stepU) + 1);
    const rows = Math.max(1, Math.floor((tr.max - tr.min) / stepT) + 1);
    return { cols, rows, total: cols * rows };
  }, [ur, tr, config.fine_grained]);

  return (
    <div className="space-y-5">
      <h3 className="text-sm font-semibold text-white">Upfront + Tail Configuration</h3>

      <RangeInput
        label="Upfront Range"
        rangeKey="upfront_range"
        config={config}
        onChange={update}
      />

      <RangeInput
        label="Tail Range"
        rangeKey="tail_range"
        config={config}
        onChange={update}
      />

      {/* Grid size preview */}
      <div className="glass-card p-4 flex items-center gap-3 border-dashed">
        <Grid3X3 className="w-5 h-5 text-indigo-400 shrink-0" />
        <div>
          <p className="text-sm font-medium text-white">
            {gridSize.cols} × {gridSize.rows} = {gridSize.total.toLocaleString()} combinations
          </p>
          <p className="text-xs text-slate-500">
            Upfront: {ur.min}%–{ur.max}% (step {config.fine_grained ? '1' : ur.step}%)
            {' · '}Tail: {tr.min}%–{tr.max}% (step {config.fine_grained ? '1' : tr.step}%)
          </p>
        </div>
      </div>

      {/* Pricing basis */}
      <div>
        <span className="text-xs text-slate-400 block mb-2">Pricing Basis</span>
        <div className="flex gap-2">
          {[
            { id: 'soc', label: 'SOC' },
            { id: 'expected_value', label: 'Expected Value' },
            { id: 'both', label: 'Both' },
          ].map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => update({ pricing_basis: opt.id })}
              className={
                'px-4 py-2 rounded-lg text-sm font-medium transition-all ' +
                (config.pricing_basis === opt.id
                  ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30'
                  : 'bg-slate-800 text-slate-400 border border-slate-700 hover:border-slate-600')
              }
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Custom grid points toggle */}
      <div className="glass-card p-4 space-y-3">
        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={useCustomGrid}
            onChange={(e) => {
              setUseCustomGrid(e.target.checked);
              if (!e.target.checked) {
                update({ upfront_pcts: null, tata_tail_pcts: null });
              }
            }}
            className="w-4 h-4 rounded border-slate-600 bg-slate-800 text-indigo-500 focus:ring-indigo-500/30"
          />
          <div>
            <span className="text-sm text-white">Custom Grid Points</span>
            <p className="text-xs text-slate-500">Specify exact percentages instead of using range</p>
          </div>
        </label>
        {useCustomGrid && (
          <div className="space-y-3 mt-2">
            <label className="block">
              <span className="text-xs text-slate-400 block mb-1">Upfront Percentages (comma-separated)</span>
              <input
                type="text"
                value={(config.upfront_pcts || [5, 7.5, 10, 12.5, 15, 17.5, 20, 25, 30, 35]).join(', ')}
                onChange={(e) => {
                  const vals = e.target.value.split(',').map(s => parseFloat(s.trim())).filter(v => !isNaN(v));
                  update({ upfront_pcts: vals });
                }}
                placeholder="5, 7.5, 10, 12.5, 15, 17.5, 20, 25, 30, 35"
                className="w-full bg-slate-900/60 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:border-indigo-500 focus:outline-none"
              />
              <p className="text-[10px] text-slate-500 mt-1">{(config.upfront_pcts || []).length || 0} points defined</p>
            </label>
            <label className="block">
              <span className="text-xs text-slate-400 block mb-1">Tail Percentages (comma-separated)</span>
              <input
                type="text"
                value={(config.tata_tail_pcts || [5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60]).join(', ')}
                onChange={(e) => {
                  const vals = e.target.value.split(',').map(s => parseFloat(s.trim())).filter(v => !isNaN(v));
                  update({ tata_tail_pcts: vals });
                }}
                placeholder="5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60"
                className="w-full bg-slate-900/60 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:border-indigo-500 focus:outline-none"
              />
              <p className="text-[10px] text-slate-500 mt-1">{(config.tata_tail_pcts || []).length || 0} points defined</p>
            </label>
          </div>
        )}
      </div>

      {/* Advanced grid settings */}
      <div>
        <button
          type="button"
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="flex items-center gap-2 text-xs text-slate-400 hover:text-slate-300 transition-colors"
        >
          {showAdvanced ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          Advanced Grid Settings
        </button>
        {showAdvanced && (
          <div className="mt-3 glass-card p-4 space-y-3">
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={config.fine_grained || false}
                onChange={(e) => update({ fine_grained: e.target.checked })}
                className="w-4 h-4 rounded border-slate-600 bg-slate-800 text-indigo-500 focus:ring-indigo-500/30"
              />
              <div>
                <span className="text-sm text-white">Enable fine-grained surface (1% steps)</span>
                <p className="text-xs text-slate-500">Generates a denser grid — slower but more precise surface</p>
              </div>
            </label>
            {!config.fine_grained && (
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-xs text-slate-400 block mb-1">Custom Upfront Step (%)</span>
                  <input
                    type="number"
                    value={config.custom_step_upfront || ur.step}
                    onChange={(e) => {
                      const v = parseFloat(e.target.value) || 5;
                      update({
                        custom_step_upfront: v,
                        upfront_range: { ...ur, step: v },
                      });
                    }}
                    min={1} max={25} step={1}
                    className="w-full bg-slate-900/60 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:border-indigo-500 focus:outline-none"
                  />
                </label>
                <label className="block">
                  <span className="text-xs text-slate-400 block mb-1">Custom Tail Step (%)</span>
                  <input
                    type="number"
                    value={config.custom_step_tail || tr.step}
                    onChange={(e) => {
                      const v = parseFloat(e.target.value) || 5;
                      update({
                        custom_step_tail: v,
                        tail_range: { ...tr, step: v },
                      });
                    }}
                    min={1} max={25} step={1}
                    className="w-full bg-slate-900/60 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:border-indigo-500 focus:outline-none"
                  />
                </label>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
