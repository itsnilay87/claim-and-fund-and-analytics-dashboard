/**
 * @module ArbitrationConfig
 * @description Arbitration configuration editor for a claim.
 *
 * Provides sliders for win probability and re-arbitration win probability.
 * Values are stored as decimals (0–1) on the claim's `arbitration` config.
 *
 * @prop {Object} claim - Current claim state.
 * @prop {Function} onChange - Callback with updated claim.
 */
import { useMemo } from 'react';
import { SliderField, SectionTitle } from './FormFields';

export default function ArbitrationConfig({ draft, updateField }) {
  const arb = draft?.arbitration || {};
  const arbWin = arb.win_probability ?? 0.7;
  const reArbWin = arb.re_arb_win_probability ?? 0.7;

  // Compute unconditional effective win probability
  // P(effective win) ≈ arbWin × P(TRUE_WIN|A) + (1-arbWin) × P(RESTART|B) × reArbWin
  // Simplified estimate without full tree traversal
  const effectiveWin = useMemo(() => {
    // Simple approximation: arb win prob alone, plus restart path
    // In practice, this depends on the challenge tree, but we show an approximation
    const pTrueWinScenarioA = 0.75; // typical fraction
    const pRestartScenarioB = 0.30; // typical fraction
    return (
      arbWin * pTrueWinScenarioA +
      (1 - arbWin) * pRestartScenarioB * reArbWin
    );
  }, [arbWin, reArbWin]);

  return (
    <div className="space-y-6">
      <SectionTitle>Arbitration Outcome Probabilities</SectionTitle>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8">
        <SliderField
          label="P(Win at Arbitration)"
          value={arbWin}
          onChange={(v) => updateField('arbitration.win_probability', v)}
          min={0}
          max={1}
          step={0.01}
          showPct
          help="Probability that the tribunal rules in claimant's favor. Default: 70%"
        />
        <SliderField
          label="P(Win at Re-Arbitration)"
          value={reArbWin}
          onChange={(v) => updateField('arbitration.re_arb_win_probability', v)}
          min={0}
          max={1}
          step={0.01}
          showPct
          help="Probability of winning re-arbitration after a RESTART outcome. Default: 70%"
        />
      </div>

      {/* Computed preview */}
      <div className="p-4 rounded-lg bg-teal-500/10 border border-teal-500/20">
        <div className="text-sm text-teal-300">
          <strong className="text-teal-200">Unconditional P(Effective Win) ≈ </strong>
          <span className="text-lg font-bold text-teal-400">
            {(effectiveWin * 100).toFixed(1)}%
          </span>
        </div>
        <p className="text-xs text-teal-400/70 mt-2">
          Computed as: P(arb win) × P(TRUE_WIN | Scenario A) + P(arb lose) × P(RESTART | Scenario B) × P(re-arb win).
          Actual values depend on the challenge tree configuration.
        </p>
      </div>

      <div className="p-4 rounded-lg bg-slate-800/30 border border-white/5 text-sm text-slate-400">
        <strong className="text-slate-300">Note:</strong> These are the base probabilities for the
        arbitration tribunal ruling in the claimant's favor. They are independent of the court
        challenge probability trees configured in Tab 4.
      </div>
    </div>
  );
}
