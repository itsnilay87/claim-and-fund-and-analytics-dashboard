/**
 * @module QuantumModelEditor
 * @description Quantum band distribution editor.
 *
 * Editable table of quantum bands (low, high, probability) with
 * add/remove rows.  Shows E[Q|WIN] calculation and validates
 * that band probabilities sum to 1.0.  Maps to QuantumConfig.
 *
 * @prop {Object} claim - Current claim state with quantum config.
 * @prop {Function} onChange - Callback with updated claim.
 */
import { useMemo } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { SectionTitle } from './FormFields';

const CELL_CLS =
  'w-20 px-2 py-1 border border-white/10 bg-slate-800/50 text-white rounded text-sm focus:ring-1 focus:ring-primary-500 outline-none';

export default function QuantumModelEditor({ draft, updateField }) {
  const bands = draft?.quantum?.bands || [];
  const socCr = draft?.soc_value_cr || 0;

  const probSum = bands.reduce((s, b) => s + (b.probability || 0), 0);
  const sumOk = Math.abs(probSum - 1.0) < 0.001;

  // E[Q|WIN] = Σ midpoint × probability
  const eQuantumPct = useMemo(
    () => bands.reduce((s, b) => s + ((b.low + b.high) / 2) * (b.probability || 0), 0),
    [bands],
  );

  const updateBand = (idx, key, value) => {
    const next = bands.map((b, i) => (i === idx ? { ...b, [key]: value } : b));
    updateField('quantum', { ...draft.quantum, bands: next });
  };

  const addBand = () => {
    const next = [...bands, { low: 0, high: 0.2, probability: 0 }];
    updateField('quantum', { ...draft.quantum, bands: next });
  };

  const removeBand = (idx) => {
    const next = bands.filter((_, i) => i !== idx);
    updateField('quantum', { ...draft.quantum, bands: next });
  };

  const autoNormalize = () => {
    if (bands.length === 0) return;
    const allButLast = bands.slice(0, -1).reduce((s, b) => s + (b.probability || 0), 0);
    const remainder = Math.max(0, Math.min(1, 1 - allButLast));
    const next = bands.map((b, i) =>
      i === bands.length - 1 ? { ...b, probability: parseFloat(remainder.toFixed(4)) } : b,
    );
    updateField('quantum', { ...draft.quantum, bands: next });
  };

  return (
    <div className="space-y-6">
      <SectionTitle>Quantum Model — Award Recovery Bands</SectionTitle>

      <p className="text-sm text-slate-400">
        Define recovery bands as fractions of SOC value. Each band has a low/high range (0–1) and
        its probability. Probabilities must sum to exactly 1.0.
      </p>

      {/* Computed E[Q|WIN] */}
      <div className="p-4 rounded-xl border border-white/5 bg-slate-800/30 flex items-center justify-between">
        <div>
          <div className="text-xs text-slate-500 uppercase tracking-wider">E[Quantum | Win]</div>
          <div className="text-2xl font-bold text-teal-400">{(eQuantumPct * 100).toFixed(1)}%</div>
          <div className="text-xs text-slate-500 mt-0.5">
            of SOC = {(eQuantumPct * socCr).toFixed(1)} Cr
          </div>
        </div>
        <div className="w-48 h-6 rounded-full bg-slate-700 overflow-hidden flex">
          {bands.map((b, i) => (
            <div
              key={i}
              className="h-full transition-all"
              style={{
                width: ((b.probability || 0) * 100) + '%',
                backgroundColor: `hsl(${160 + i * 30}, 60%, ${45 + i * 5}%)`,
              }}
            />
          ))}
        </div>
      </div>

      {/* Band table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-800/50 text-left">
              <th className="px-3 py-2 font-medium text-slate-400">#</th>
              <th className="px-3 py-2 font-medium text-slate-400">Low (%)</th>
              <th className="px-3 py-2 font-medium text-slate-400">High (%)</th>
              <th className="px-3 py-2 font-medium text-slate-400">Probability</th>
              <th className="px-3 py-2 font-medium text-slate-400">Visual</th>
              <th className="px-3 py-2 font-medium text-slate-400"></th>
            </tr>
          </thead>
          <tbody>
            {bands.map((band, idx) => (
              <tr key={idx} className="border-t border-white/5">
                <td className="px-3 py-2 font-mono text-slate-500">#{idx + 1}</td>
                <td className="px-3 py-2">
                  <input
                    type="number"
                    value={band.low}
                    onChange={(e) => updateBand(idx, 'low', Number(e.target.value))}
                    min={0}
                    max={1}
                    step={0.05}
                    className={CELL_CLS}
                  />
                </td>
                <td className="px-3 py-2">
                  <input
                    type="number"
                    value={band.high}
                    onChange={(e) => updateBand(idx, 'high', Number(e.target.value))}
                    min={0}
                    max={1}
                    step={0.05}
                    className={CELL_CLS}
                  />
                </td>
                <td className="px-3 py-2">
                  <input
                    type="number"
                    value={band.probability}
                    onChange={(e) => updateBand(idx, 'probability', Number(e.target.value))}
                    min={0}
                    max={1}
                    step={0.01}
                    className={CELL_CLS}
                  />
                </td>
                <td className="px-3 py-2">
                  <div className="w-32 h-4 bg-slate-700 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-teal-500 rounded-full transition-all"
                      style={{ width: ((band.probability || 0) * 100) + '%' }}
                    />
                  </div>
                </td>
                <td className="px-3 py-2">
                  <button
                    onClick={() => removeBand(idx)}
                    className="p-1 text-slate-500 hover:text-red-400 transition-colors"
                    title="Remove band"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-white/10">
              <td colSpan={3} className="px-3 py-2 text-right font-medium text-slate-300">
                Sum:
              </td>
              <td className={'px-3 py-2 font-bold ' + (sumOk ? 'text-emerald-400' : 'text-red-400')}>
                {probSum.toFixed(4)}
              </td>
              <td className="px-3 py-2">
                {sumOk ? (
                  <span className="text-emerald-400 text-xs">✓ Valid</span>
                ) : (
                  <span className="text-red-400 text-xs">Must equal 1.0</span>
                )}
              </td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Action buttons */}
      <div className="flex gap-3">
        <button
          onClick={addBand}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-slate-800 border border-white/10 rounded-lg text-slate-300 hover:bg-slate-700 transition"
        >
          <Plus className="w-3.5 h-3.5" /> Add Band
        </button>
        {!sumOk && (
          <button
            onClick={autoNormalize}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-amber-500/10 border border-amber-500/20 rounded-lg text-amber-400 hover:bg-amber-500/20 transition"
          >
            Auto-Normalize
          </button>
        )}
      </div>
    </div>
  );
}

