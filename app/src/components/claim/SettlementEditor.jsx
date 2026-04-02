/**
 * @module SettlementEditor
 * @description Settlement modeling configuration editor.
 *
 * Toggle settlement on/off, choose user-specified vs game-theoretic mode,
 * configure hazard rates, discount ramps, and per-stage overrides.
 * Maps to the claim's `settlement` config (SettlementConfig).
 *
 * @prop {Object} draft - Current claim draft state.
 * @prop {Function} updateField - Callback with (key, value) to update claim.
 */
import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { ToggleField, NumberField, SliderField, SectionTitle } from './FormFields';

const SETTLEMENT_STAGE_LABELS = {
  indian_domestic: [
    { name: 'dab', label: 'DAB (Dispute Board)' },
    { name: 'arbitration', label: 'Arbitration' },
    { name: 's34', label: 'S.34 Challenge' },
    { name: 's37', label: 'S.37 Appeal' },
    { name: 'slp', label: 'SLP (Supreme Court)' },
  ],
  siac_singapore: [
    { name: 'dab', label: 'DAB (Dispute Board)' },
    { name: 'arbitration', label: 'Arbitration' },
    { name: 'hc', label: 'High Court' },
    { name: 'coa', label: 'Court of Appeal' },
  ],
  hkiac_hongkong: [
    { name: 'dab', label: 'DAB (Dispute Board)' },
    { name: 'arbitration', label: 'Arbitration' },
    { name: 'cfi', label: 'Court of First Instance' },
    { name: 'ca', label: 'Court of Appeal' },
    { name: 'cfa', label: 'Court of Final Appeal' },
  ],
};

// Alias keys for convenience
SETTLEMENT_STAGE_LABELS.domestic = SETTLEMENT_STAGE_LABELS.indian_domestic;
SETTLEMENT_STAGE_LABELS.siac = SETTLEMENT_STAGE_LABELS.siac_singapore;
SETTLEMENT_STAGE_LABELS.hkiac = SETTLEMENT_STAGE_LABELS.hkiac_hongkong;

function getStagesForJurisdiction(jurisdiction) {
  return SETTLEMENT_STAGE_LABELS[jurisdiction] || SETTLEMENT_STAGE_LABELS.indian_domestic;
}

export default function SettlementEditor({ draft, updateField }) {
  const settlement = draft?.settlement || {};
  const jurisdiction = draft?.jurisdiction || 'indian_domestic';
  const [showOverrides, setShowOverrides] = useState(false);

  const update = (field, value) => {
    updateField('settlement', { ...settlement, [field]: value });
  };

  const stages = getStagesForJurisdiction(jurisdiction);
  const overrides = settlement.stage_overrides || [];

  const getOverride = (stageName) => overrides.find((o) => o.stage === stageName);

  const updateOverride = (stageName, field, value) => {
    const existing = [...overrides];
    const idx = existing.findIndex((o) => o.stage === stageName);
    if (idx >= 0) {
      existing[idx] = { ...existing[idx], [field]: value };
    } else {
      existing.push({ stage: stageName, [field]: value });
    }
    update('stage_overrides', existing);
  };

  const isGameTheoretic = settlement.mode === 'game_theoretic';

  return (
    <div className="space-y-6">
      <SectionTitle>Settlement Modeling</SectionTitle>

      {/* Master toggle */}
      <ToggleField
        label="Enable Settlement Modeling"
        value={!!settlement.enabled}
        onChange={(v) => update('enabled', v)}
        help="When enabled, the simulation models settlement as a competing exit at each litigation stage"
      />

      {settlement.enabled && (
        <>
          {/* Mode selector */}
          <div className="mb-4">
            <label className="block text-sm font-medium text-slate-300 mb-2">Settlement Mode</label>
            <div className="flex gap-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="settlement_mode"
                  value="user_specified"
                  checked={settlement.mode !== 'game_theoretic'}
                  onChange={() => update('mode', 'user_specified')}
                  className="text-teal-500 focus:ring-teal-500 bg-slate-800 border-white/10"
                />
                <div>
                  <span className="text-sm text-white">User-Specified</span>
                  <p className="text-xs text-slate-500">You provide discount factors per stage</p>
                </div>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="settlement_mode"
                  value="game_theoretic"
                  checked={settlement.mode === 'game_theoretic'}
                  onChange={() => update('mode', 'game_theoretic')}
                  className="text-teal-500 focus:ring-teal-500 bg-slate-800 border-white/10"
                />
                <div>
                  <span className="text-sm text-white">Game-Theoretic</span>
                  <p className="text-xs text-slate-500">Discounts computed via Nash Bargaining Solution</p>
                </div>
              </label>
            </div>
          </div>

          {/* Global parameters */}
          <SectionTitle>Global Parameters</SectionTitle>

          <SliderField
            label="Default Hazard Rate (λ)"
            value={settlement.global_hazard_rate ?? 0.15}
            onChange={(v) => update('global_hazard_rate', v)}
            min={0}
            max={0.5}
            step={0.01}
            showPct
            help="Probability of settlement offer at each stage"
          />

          <NumberField
            label="Settlement Delay"
            value={settlement.settlement_delay_months ?? 3}
            onChange={(v) => update('settlement_delay_months', v)}
            min={0}
            max={24}
            step={0.5}
            unit="months"
            help="Months from settlement agreement to cash receipt"
          />

          {/* User-specified mode: discount ramp */}
          {!isGameTheoretic && (
            <>
              <SectionTitle>Discount Ramp</SectionTitle>
              <SliderField
                label="δ_min (Earliest Stage Discount)"
                value={settlement.discount_min ?? 0.30}
                onChange={(v) => update('discount_min', v)}
                min={0.05}
                max={0.80}
                step={0.01}
                showPct
                help="Settlement discount at earliest stage (% of reference quantum)"
              />
              <SliderField
                label="δ_max (Latest Stage Discount)"
                value={settlement.discount_max ?? 0.85}
                onChange={(v) => update('discount_max', v)}
                min={0.20}
                max={1.0}
                step={0.01}
                showPct
                help="Settlement discount at latest stage"
              />
            </>
          )}

          {/* Game-theoretic mode: bargaining params */}
          {isGameTheoretic && (
            <>
              <SectionTitle>Nash Bargaining Parameters</SectionTitle>
              <SliderField
                label="Bargaining Power (α)"
                value={settlement.bargaining_power ?? 0.5}
                onChange={(v) => update('bargaining_power', v)}
                min={0.1}
                max={0.9}
                step={0.01}
                help="0.5 = symmetric Nash Bargaining. >0.5 favors claimant"
              />
              <NumberField
                label="Respondent Legal Costs"
                value={settlement.respondent_legal_cost_cr ?? ''}
                onChange={(v) => update('respondent_legal_cost_cr', v === '' ? null : v)}
                min={0}
                step={0.1}
                unit="₹ Cr"
                help="Estimated respondent's remaining legal costs. Leave blank to auto-estimate"
              />
            </>
          )}

          {/* Per-stage overrides */}
          <div className="mt-6">
            <button
              type="button"
              onClick={() => setShowOverrides(!showOverrides)}
              className="flex items-center gap-2 text-sm font-medium text-slate-300 hover:text-white transition-colors"
            >
              {showOverrides ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
              Per-Stage Overrides
            </button>
            <p className="text-xs text-slate-500 mt-1 ml-6">Override global settings for specific stages</p>

            {showOverrides && (
              <div className="mt-4 rounded-xl border border-white/5 overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-800/50">
                      <th className="text-left px-4 py-2.5 text-slate-400 font-medium">Stage</th>
                      <th className="text-left px-4 py-2.5 text-slate-400 font-medium">Hazard Rate (λ)</th>
                      <th className="text-left px-4 py-2.5 text-slate-400 font-medium">
                        Discount Factor (δ)
                        {isGameTheoretic && <span className="ml-1 text-xs text-slate-600">(auto)</span>}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {stages.map((stage) => {
                      const ovr = getOverride(stage.name);
                      return (
                        <tr key={stage.name} className="border-t border-white/5 hover:bg-slate-800/20">
                          <td className="px-4 py-3 text-slate-300 whitespace-nowrap">{stage.label}</td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <input
                                type="range"
                                value={ovr?.hazard_rate ?? settlement.global_hazard_rate ?? 0.15}
                                onChange={(e) => updateOverride(stage.name, 'hazard_rate', Number(e.target.value))}
                                min={0}
                                max={0.5}
                                step={0.01}
                                className="w-24 h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-teal-500"
                              />
                              <span className="text-xs text-teal-400 font-mono w-12 text-right">
                                {((ovr?.hazard_rate ?? settlement.global_hazard_rate ?? 0.15) * 100).toFixed(0)}%
                              </span>
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            {isGameTheoretic ? (
                              <span className="text-xs text-slate-500 italic">auto-computed</span>
                            ) : (
                              <div className="flex items-center gap-2">
                                <input
                                  type="range"
                                  value={ovr?.discount_factor ?? ''}
                                  onChange={(e) => updateOverride(stage.name, 'discount_factor', Number(e.target.value))}
                                  min={0.05}
                                  max={1.0}
                                  step={0.01}
                                  className="w-24 h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-amber-500"
                                />
                                <span className="text-xs text-amber-400 font-mono w-12 text-right">
                                  {ovr?.discount_factor != null
                                    ? (ovr.discount_factor * 100).toFixed(0) + '%'
                                    : 'global'}
                                </span>
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
