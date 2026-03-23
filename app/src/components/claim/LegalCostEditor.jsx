/**
 * @module LegalCostEditor
 * @description Per-stage legal cost range editor with overrun parameters.
 *
 * Allows editing one-time costs (tribunal, expert) and per-stage cost
 * ranges (low/high).  Also configures ScaledBeta overrun distribution
 * parameters (α, β, low, high).  Maps to LegalCostConfig in schema.
 *
 * @prop {Object} claim - Current claim state.
 * @prop {Function} onChange - Callback with updated claim.
 */
import { useMemo } from 'react';
import { NumberField, RangeField, SectionTitle } from './FormFields';

const STAGE_LABELS = {
  dab: 'DAB', arb_counsel: 'Arb Counsel', s34: 'S.34', s37: 'S.37',
  slp_dismissed: 'SLP Dismissed', slp_admitted: 'SLP Admitted',
  siac_hc: 'High Court (SIAC)', siac_coa: 'CoA (SIAC)',
  hk_cfi: 'CFI (Hong Kong)', hk_ca: 'CA (Hong Kong)', hk_cfa: 'CFA (Hong Kong)',
};

export default function LegalCostEditor({ draft, updateField }) {
  const lc = draft?.legal_costs || {};
  const perStage = lc.per_stage_costs || {};

  const updateTop = (key, value) => updateField('legal_costs', { ...lc, [key]: value });

  const updateStage = (stageKey, field, value) => {
    const updated = { ...perStage, [stageKey]: { ...perStage[stageKey], [field]: value } };
    updateField('legal_costs', { ...lc, per_stage_costs: updated });
  };

  // Expected overrun factor
  const overrunFactor = useMemo(() => {
    const a = lc.overrun_alpha || 2;
    const b = lc.overrun_beta || 5;
    const lo = lc.overrun_low ?? -0.1;
    const hi = lc.overrun_high ?? 0.6;
    return (a / (a + b)) * (hi - lo) + lo;
  }, [lc.overrun_alpha, lc.overrun_beta, lc.overrun_low, lc.overrun_high]);

  // Expected total cost
  const expectedTotal = useMemo(() => {
    let base = (lc.one_time_tribunal_cr || 0) + (lc.one_time_expert_cr || 0) + (lc.arb_counsel_cr || 0);
    for (const key of Object.keys(perStage)) {
      const s = perStage[key];
      base += ((s.legal_cost_low || 0) + (s.legal_cost_high || 0)) / 2;
    }
    return base * (1 + overrunFactor);
  }, [lc, perStage, overrunFactor]);

  const stageKeys = Object.keys(perStage);

  return (
    <div className="space-y-6">
      <SectionTitle>Legal Cost Configuration</SectionTitle>

      {/* Summary */}
      <div className="p-4 rounded-xl border border-white/5 bg-slate-800/30 flex items-center justify-between">
        <div>
          <div className="text-xs text-slate-500 uppercase tracking-wider">Expected Total Legal Costs</div>
          <div className="text-2xl font-bold text-teal-400">{expectedTotal.toFixed(2)} Cr</div>
        </div>
        <div className="text-right">
          <div className="text-xs text-slate-500">Expected Overrun</div>
          <div className={'text-sm font-bold ' + (overrunFactor >= 0 ? 'text-amber-400' : 'text-emerald-400')}>
            {overrunFactor >= 0 ? '+' : ''}{(overrunFactor * 100).toFixed(1)}%
          </div>
        </div>
      </div>

      {/* One-time costs */}
      <div className="p-4 rounded-xl border border-white/5 bg-slate-800/30">
        <h4 className="text-sm font-semibold text-white mb-3">One-Time Costs</h4>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-x-8">
          <NumberField
            label="Tribunal Fees"
            value={lc.one_time_tribunal_cr}
            onChange={(v) => updateTop('one_time_tribunal_cr', v)}
            min={0}
            step={0.5}
            unit="Cr"
          />
          <NumberField
            label="Expert Fees"
            value={lc.one_time_expert_cr}
            onChange={(v) => updateTop('one_time_expert_cr', v)}
            min={0}
            step={0.5}
            unit="Cr"
          />
          <NumberField
            label="Arb Counsel Fee"
            value={lc.arb_counsel_cr ?? 8.0}
            onChange={(v) => updateTop('arb_counsel_cr', v)}
            min={0}
            step={0.5}
            unit="Cr"
            help="Fixed arbitration counsel fee (one-time)"
          />
        </div>
      </div>

      {/* Per-stage costs */}
      {stageKeys.length > 0 && (
        <div className="space-y-3">
          <h4 className="text-sm font-semibold text-white">Per-Stage Legal Costs</h4>
          {stageKeys.map((key) => {
            const stage = perStage[key];
            return (
              <div key={key} className="p-4 rounded-xl border border-white/5 bg-slate-800/30">
                <div className="flex items-center justify-between mb-2">
                  <h5 className="text-sm font-medium text-slate-300">
                    {STAGE_LABELS[key] || key.replace(/_/g, ' ')}
                  </h5>
                  <span className="text-xs text-slate-500">
                    E = {(((stage.legal_cost_low || 0) + (stage.legal_cost_high || 0)) / 2).toFixed(2)} Cr
                  </span>
                </div>
                <RangeField
                  label="Cost Range"
                  low={stage.legal_cost_low}
                  high={stage.legal_cost_high}
                  onLowChange={(v) => updateStage(key, 'legal_cost_low', v)}
                  onHighChange={(v) => updateStage(key, 'legal_cost_high', v)}
                  min={0}
                  max={20}
                  step={0.1}
                  unit="Cr"
                />
              </div>
            );
          })}
        </div>
      )}

      {/* Overrun parameters */}
      <div className="p-4 rounded-xl border border-white/5 bg-slate-800/30">
        <h4 className="text-sm font-semibold text-white mb-2">Cost Overrun Distribution (Scaled Beta)</h4>
        <p className="text-xs text-slate-500 mb-4">
          Overrun factor ~ ScaledBeta(α, β, low, high). The expected overrun is (α/(α+β)) × (high−low) + low.
        </p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6">
          <NumberField
            label="Alpha (α)"
            value={lc.overrun_alpha}
            onChange={(v) => updateTop('overrun_alpha', v)}
            min={0.1}
            step={0.1}
          />
          <NumberField
            label="Beta (β)"
            value={lc.overrun_beta}
            onChange={(v) => updateTop('overrun_beta', v)}
            min={0.1}
            step={0.1}
          />
          <NumberField
            label="Low"
            value={lc.overrun_low}
            onChange={(v) => updateTop('overrun_low', v)}
            step={0.01}
          />
          <NumberField
            label="High"
            value={lc.overrun_high}
            onChange={(v) => updateTop('overrun_high', v)}
            step={0.01}
          />
        </div>
      </div>
    </div>
  );
}

