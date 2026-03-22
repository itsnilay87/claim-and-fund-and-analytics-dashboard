/**
 * @module InterestEditor
 * @description Interest rate and compounding configuration editor.
 *
 * Toggle interest on/off, set annual rate, choose simple vs compound
 * compounding, configure rate bands with probabilities, and set
 * advanced simulation options.  Maps to the claim's `interest` config
 * (InterestConfig).
 *
 * @prop {Object} draft - Current claim draft state.
 * @prop {Function} updateField - Callback with (key, value) to update claim.
 */
import { useState, useMemo } from 'react';
import { ToggleField, NumberField, SelectField, SectionTitle } from './FormFields';

const COMPOUNDING_OPTIONS = [
  { value: 'simple', label: 'Simple Interest' },
  { value: 'compound', label: 'Compound Interest' },
];

const START_BASIS_OPTIONS = [
  { value: 'award_date', label: 'Award Date' },
  { value: 'dab_commencement', label: 'DAB Commencement' },
];

const BAND_COLORS = [
  'hsl(210, 70%, 55%)',  // blue
  'hsl(160, 60%, 50%)',  // teal
  'hsl(45, 80%, 55%)',   // amber
  'hsl(340, 65%, 55%)',  // rose
  'hsl(270, 60%, 55%)',  // purple
];

function computeInterest(principal, rate, years, type) {
  if (type === 'compound') return principal * Math.pow(1 + rate, years) - principal;
  return principal * rate * years;
}

function RateDistributionAnalysis({ rateBands, useRateBands, singleRate, compounding, quantum, expectedYears }) {
  const bands = useMemo(() => {
    if (!useRateBands) {
      const r = singleRate ?? 0.09;
      return [{ rate: r * 100, type: compounding, probability: 1.0 }];
    }
    return rateBands;
  }, [rateBands, useRateBands, singleRate, compounding]);

  const probSum = bands.reduce((s, b) => s + (b.probability || 0), 0);
  const weightedRate = probSum > 0
    ? bands.reduce((s, b) => s + (b.rate || 0) * (b.probability || 0), 0) / probSum
    : 0;

  const maxRate = Math.max(...bands.map((b) => b.rate || 0), 1);

  // Interest accumulation over time for each band
  const years = Array.from({ length: Math.ceil(expectedYears) + 1 }, (_, i) => i);
  const bandAccum = bands.map((b) => {
    const r = (b.rate || 0) / 100;
    return years.map((y) => computeInterest(quantum, r, y, b.type || 'simple'));
  });

  const expectedInterest = bands.reduce((s, b) => {
    const r = (b.rate || 0) / 100;
    return s + computeInterest(quantum, r, expectedYears, b.type || 'simple') * (b.probability || 0);
  }, 0);

  const maxAccum = Math.max(...bandAccum.flat(), 1);

  return (
    <div className="p-4 rounded-xl border border-white/5 bg-slate-800/30 space-y-5">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-white">Distribution Analysis</h4>
        <span className="text-xs text-slate-500">{bands.length} band{bands.length !== 1 ? 's' : ''}</span>
      </div>

      {/* Summary metrics */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-slate-900/40 rounded-lg p-3 text-center">
          <div className="text-[10px] text-slate-500 uppercase tracking-wider">Weighted Rate</div>
          <div className="text-lg font-bold text-teal-400">{weightedRate.toFixed(2)}%</div>
          <div className="text-[10px] text-slate-500">probability-weighted</div>
        </div>
        <div className="bg-slate-900/40 rounded-lg p-3 text-center">
          <div className="text-[10px] text-slate-500 uppercase tracking-wider">Expected Interest</div>
          <div className="text-lg font-bold text-amber-400">₹{expectedInterest >= 1e7 ? (expectedInterest / 1e7).toFixed(2) + ' Cr' : expectedInterest >= 1e5 ? (expectedInterest / 1e5).toFixed(2) + ' L' : expectedInterest.toFixed(0)}</div>
          <div className="text-[10px] text-slate-500">over {expectedYears.toFixed(1)} yrs</div>
        </div>
        <div className="bg-slate-900/40 rounded-lg p-3 text-center">
          <div className="text-[10px] text-slate-500 uppercase tracking-wider">Interest Multiplier</div>
          <div className="text-lg font-bold text-indigo-400">{quantum > 0 ? ((expectedInterest / quantum) * 100).toFixed(1) : 0}%</div>
          <div className="text-[10px] text-slate-500">of quantum</div>
        </div>
      </div>

      {/* Rate band probability bars */}
      <div>
        <div className="text-xs text-slate-400 font-semibold mb-2">Rate Band Probabilities</div>
        <div className="space-y-2">
          {bands.map((b, i) => {
            const pct = (b.probability || 0) * 100;
            const barW = maxRate > 0 ? ((b.rate || 0) / maxRate) * 100 : 0;
            const color = BAND_COLORS[i % BAND_COLORS.length];
            return (
              <div key={i} className="flex items-center gap-3">
                <div className="w-20 text-right">
                  <span className="text-sm font-mono text-white">{(b.rate || 0).toFixed(1)}%</span>
                  <span className="text-[10px] text-slate-500 ml-1">{b.type === 'compound' ? 'C' : 'S'}</span>
                </div>
                <div className="flex-1 h-5 bg-slate-700/50 rounded-full overflow-hidden relative">
                  <div
                    className="h-full rounded-full transition-all duration-300"
                    style={{ width: barW + '%', backgroundColor: color, opacity: 0.7 + (b.probability || 0) * 0.3 }}
                  />
                  <span className="absolute inset-0 flex items-center justify-end pr-2 text-[10px] font-bold text-white/80">
                    {pct.toFixed(0)}%
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Interest accumulation chart (SVG sparklines) */}
      {bands.length > 0 && expectedYears > 0 && (
        <div>
          <div className="text-xs text-slate-400 font-semibold mb-2">Interest Accumulation Over Time</div>
          <div className="bg-slate-900/40 rounded-lg p-3">
            <svg viewBox={`0 0 300 120`} className="w-full" style={{ maxHeight: 140 }}>
              {/* Grid lines */}
              {[0, 0.25, 0.5, 0.75, 1].map((f) => (
                <line key={f} x1="40" y1={10 + f * 100} x2="290" y2={10 + f * 100} stroke="rgba(100,116,139,0.15)" strokeDasharray="2,2" />
              ))}
              {/* Y axis labels */}
              {[0, 0.5, 1].map((f) => (
                <text key={f} x="38" y={112 - f * 100} fill="#64748b" fontSize="7" textAnchor="end">
                  {maxAccum >= 1e7
                    ? (maxAccum * f / 1e7).toFixed(1) + 'Cr'
                    : maxAccum >= 1e5
                    ? (maxAccum * f / 1e5).toFixed(0) + 'L'
                    : (maxAccum * f).toFixed(0)}
                </text>
              ))}
              {/* X axis labels */}
              {years.filter((_, i) => i % Math.max(1, Math.floor(years.length / 5)) === 0 || i === years.length - 1).map((y) => (
                <text key={y} x={40 + (y / Math.max(years.length - 1, 1)) * 250} y="118" fill="#64748b" fontSize="7" textAnchor="middle">
                  {y}y
                </text>
              ))}
              {/* Lines for each band */}
              {bandAccum.map((pts, bi) => {
                const points = pts.map((v, yi) =>
                  `${40 + (yi / Math.max(years.length - 1, 1)) * 250},${110 - (v / maxAccum) * 100}`
                ).join(' ');
                return (
                  <polyline
                    key={bi}
                    points={points}
                    fill="none"
                    stroke={BAND_COLORS[bi % BAND_COLORS.length]}
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                );
              })}
              {/* Expected duration marker */}
              <line
                x1={40 + (expectedYears / Math.max(years.length - 1, 1)) * 250}
                y1="10"
                x2={40 + (expectedYears / Math.max(years.length - 1, 1)) * 250}
                y2="110"
                stroke="#f59e0b"
                strokeWidth="1"
                strokeDasharray="3,2"
                opacity="0.6"
              />
              <text
                x={40 + (expectedYears / Math.max(years.length - 1, 1)) * 250}
                y="8"
                fill="#f59e0b"
                fontSize="6"
                textAnchor="middle"
              >
                E[T]
              </text>
            </svg>
            <div className="flex flex-wrap gap-3 mt-2 justify-center">
              {bands.map((b, i) => (
                <span key={i} className="flex items-center gap-1 text-[10px] text-slate-400">
                  <span className="inline-block w-3 h-1.5 rounded" style={{ backgroundColor: BAND_COLORS[i % BAND_COLORS.length] }} />
                  {(b.rate || 0).toFixed(1)}% {b.type}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Per-band outcome table */}
      <div>
        <div className="text-xs text-slate-400 font-semibold mb-2">Per-Band Outcome at Expected Duration</div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-slate-500 border-b border-white/5">
                <th className="text-left py-1.5 px-2">Band</th>
                <th className="text-right py-1.5 px-2">Rate</th>
                <th className="text-right py-1.5 px-2">Type</th>
                <th className="text-right py-1.5 px-2">Prob</th>
                <th className="text-right py-1.5 px-2">Interest</th>
                <th className="text-right py-1.5 px-2">Total (Q + I)</th>
              </tr>
            </thead>
            <tbody>
              {bands.map((b, i) => {
                const r = (b.rate || 0) / 100;
                const intAmt = computeInterest(quantum, r, expectedYears, b.type || 'simple');
                const total = quantum + intAmt;
                const fmt = (v) => v >= 1e7 ? '₹' + (v / 1e7).toFixed(2) + ' Cr' : v >= 1e5 ? '₹' + (v / 1e5).toFixed(2) + ' L' : '₹' + v.toFixed(0);
                return (
                  <tr key={i} className="border-b border-white/5 hover:bg-white/[0.02]">
                    <td className="py-1.5 px-2">
                      <span className="inline-block w-2 h-2 rounded-full mr-1.5" style={{ backgroundColor: BAND_COLORS[i % BAND_COLORS.length] }} />
                      Band {i + 1}
                    </td>
                    <td className="text-right py-1.5 px-2 text-white font-mono">{(b.rate || 0).toFixed(1)}%</td>
                    <td className="text-right py-1.5 px-2 text-slate-400">{b.type === 'compound' ? 'Compound' : 'Simple'}</td>
                    <td className="text-right py-1.5 px-2 text-slate-300">{((b.probability || 0) * 100).toFixed(0)}%</td>
                    <td className="text-right py-1.5 px-2 text-amber-400">{fmt(intAmt)}</td>
                    <td className="text-right py-1.5 px-2 text-teal-400 font-semibold">{fmt(total)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default function InterestEditor({ draft, updateField }) {
  const interest = draft?.interest || {};
  const rateBands = interest.rate_bands || [{ rate: 9, type: 'simple', probability: 1.0 }];
  const [useRateBands, setUseRateBands] = useState(rateBands.length > 1);

  const updateInterest = (key, value) => {
    updateField('interest', { ...interest, [key]: value });
  };

  const updateBand = (idx, field, value) => {
    const next = rateBands.map((b, i) => (i === idx ? { ...b, [field]: value } : b));
    updateInterest('rate_bands', next);
  };

  const addBand = () => {
    updateInterest('rate_bands', [...rateBands, { rate: 9, type: 'simple', probability: 0 }]);
  };

  const removeBand = (idx) => {
    if (rateBands.length <= 1) return;
    updateInterest('rate_bands', rateBands.filter((_, i) => i !== idx));
  };

  const bandProbSum = rateBands.reduce((s, b) => s + (b.probability || 0), 0);

  return (
    <div className="space-y-6">
      <SectionTitle>Interest &amp; Advanced Settings</SectionTitle>

      {/* Interest config */}
      <div className="p-4 rounded-xl border border-white/5 bg-slate-800/30">
        <h4 className="text-sm font-semibold text-white mb-4">Interest Accrual</h4>

        <ToggleField
          label="Enable Interest Calculation"
          value={interest.enabled ?? false}
          onChange={(v) => updateInterest('enabled', v)}
          help="Compute pre/post-award interest on the quantum"
        />

        {interest.enabled && (
          <div className="mt-4 space-y-4">
            {/* Start basis */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8">
              <SelectField
                label="Interest Start Basis"
                value={interest.start_basis || 'award_date'}
                onChange={(v) => updateInterest('start_basis', v)}
                options={START_BASIS_OPTIONS}
                help="Date from which interest calculation begins"
              />
              <div className="mb-4">
                <label className="block text-sm font-medium text-slate-300 mb-1">
                  DAB Commencement Date
                </label>
                <input
                  type="date"
                  value={interest.commencement_date || ''}
                  onChange={(e) => updateInterest('commencement_date', e.target.value)}
                  className="w-full px-3 py-2 bg-slate-800/50 border border-white/10 rounded-lg text-sm text-white focus:ring-1 focus:ring-primary-500 outline-none"
                />
                <p className="mt-1 text-xs text-slate-500">Date from which interest starts accruing</p>
              </div>
            </div>

            {/* Single rate vs rate bands toggle */}
            <div className="flex items-center gap-3 mb-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={useRateBands}
                  onChange={(e) => {
                    setUseRateBands(e.target.checked);
                    if (!e.target.checked) {
                      // Collapse to single band using current rate/compounding
                      updateInterest('rate_bands', [{
                        rate: interest.rate != null ? interest.rate * 100 : 9,
                        type: interest.compounding || 'simple',
                        probability: 1.0,
                      }]);
                    }
                  }}
                  className="w-4 h-4 rounded border-slate-600 bg-slate-800 text-indigo-500 focus:ring-indigo-500/30"
                />
                <span className="text-sm text-slate-300">Use multiple rate bands</span>
              </label>
              <p className="text-xs text-slate-500">MC engine samples one band per path based on probability</p>
            </div>

            {!useRateBands ? (
              /* Single rate mode */
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8">
                <NumberField
                  label="Interest Rate"
                  value={interest.rate != null ? interest.rate * 100 : ''}
                  onChange={(v) => updateInterest('rate', v === '' ? '' : v / 100)}
                  min={0}
                  max={50}
                  step={0.5}
                  unit="%"
                  help="Annual interest rate"
                />
                <SelectField
                  label="Compounding"
                  value={interest.compounding || 'simple'}
                  onChange={(v) => updateInterest('compounding', v)}
                  options={COMPOUNDING_OPTIONS}
                />
              </div>
            ) : (
              /* Rate bands table */
              <div className="space-y-2">
                <div className="flex items-center justify-between mb-1">
                  <h5 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Rate Bands</h5>
                  <span className={
                    'text-xs font-bold px-2 py-0.5 rounded ' +
                    (Math.abs(bandProbSum - 1.0) < 0.001
                      ? 'bg-emerald-500/20 text-emerald-400'
                      : 'bg-red-500/20 text-red-400')
                  }>
                    Σ = {(bandProbSum * 100).toFixed(1)}%
                    {Math.abs(bandProbSum - 1.0) < 0.001 ? ' ✓' : ' (must = 100%)'}
                  </span>
                </div>
                {/* Header */}
                <div className="grid grid-cols-[1fr_1fr_1fr_40px] gap-2 text-[10px] text-slate-500 font-semibold uppercase px-1">
                  <span>Rate (%)</span>
                  <span>Type</span>
                  <span>Probability</span>
                  <span />
                </div>
                {rateBands.map((band, idx) => (
                  <div key={idx} className="grid grid-cols-[1fr_1fr_1fr_40px] gap-2 items-center">
                    <input
                      type="number"
                      value={band.rate}
                      onChange={(e) => updateBand(idx, 'rate', parseFloat(e.target.value) || 0)}
                      min={0} max={50} step={0.5}
                      className="bg-slate-800/50 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:ring-1 focus:ring-primary-500 outline-none"
                    />
                    <select
                      value={band.type || 'simple'}
                      onChange={(e) => updateBand(idx, 'type', e.target.value)}
                      className="bg-slate-800/50 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:ring-1 focus:ring-primary-500 outline-none"
                    >
                      <option value="simple">Simple</option>
                      <option value="compound">Compound</option>
                    </select>
                    <input
                      type="number"
                      value={band.probability}
                      onChange={(e) => updateBand(idx, 'probability', parseFloat(e.target.value) || 0)}
                      min={0} max={1} step={0.05}
                      className="bg-slate-800/50 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:ring-1 focus:ring-primary-500 outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => removeBand(idx)}
                      disabled={rateBands.length <= 1}
                      className="text-red-400 hover:text-red-300 disabled:text-slate-600 text-lg font-bold"
                      title="Remove band"
                    >
                      ×
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={addBand}
                  className="text-xs text-indigo-400 hover:text-indigo-300 mt-1"
                >
                  + Add Rate Band
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Distribution Analysis */}
      {interest.enabled && rateBands.length >= 1 && (
        <RateDistributionAnalysis
          rateBands={rateBands}
          useRateBands={useRateBands}
          singleRate={interest.rate}
          compounding={interest.compounding || 'simple'}
          quantum={draft?.quantum?.claim_amount_inr || 100}
          expectedYears={(() => {
            const tl = draft?.timeline || {};
            const stages = tl.pre_arb_stages || [];
            let months = stages.reduce((s, st) => s + ((st.duration_low || 0) + (st.duration_high || 0)) / 2, 0);
            months += tl.payment_delay_months || 0;
            return Math.max(months / 12, 1);
          })()}
        />
      )}

      {/* Advanced settings */}
      <div className="p-4 rounded-xl border border-white/5 bg-slate-800/30">
        <h4 className="text-sm font-semibold text-white mb-4">Advanced Options</h4>

        <ToggleField
          label="No-Restart Mode"
          value={draft?.no_restart_mode ?? false}
          onChange={(v) => updateField('no_restart_mode', v)}
          help="Conservative mode: maps all RESTART outcomes to LOSE. Use when re-arbitration is unlikely or unwanted."
        />

        <div className="grid grid-cols-1 md:grid-cols-3 gap-x-8 mt-2">
          <NumberField
            label="Simulation Seed"
            value={draft?.simulation_seed}
            onChange={(v) => updateField('simulation_seed', v)}
            min={0}
            step={1}
            help="Random seed for reproducible simulations"
          />
          <NumberField
            label="Number of Simulations"
            value={draft?.n_simulations}
            onChange={(v) => updateField('n_simulations', v)}
            min={100}
            max={100000}
            step={100}
            help="Monte Carlo paths for individual claim simulation"
          />
          <NumberField
            label="Sims Per Combo"
            value={draft?.sims_per_combo ?? 2000}
            onChange={(v) => updateField('sims_per_combo', v)}
            min={100}
            max={10000}
            step={100}
            help="Simulations per grid combination (investment analysis)"
          />
        </div>
      </div>

      {/* Info box */}
      <div className="p-4 rounded-lg bg-slate-800/30 border border-white/5 text-sm text-slate-400">
        <strong className="text-slate-300">Note:</strong> Interest is computed on the awarded quantum
        from the commencement date to the payment date. The payment date is determined by the
        timeline simulation (total stage durations + payment delay).
      </div>
    </div>
  );
}

