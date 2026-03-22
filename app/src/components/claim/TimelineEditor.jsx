/**
 * @module TimelineEditor
 * @description Full timeline configuration editor with categorized sections.
 *
 * Organized into:
 *   1. Pre-Arbitration stages (DAB, Arbitration) with visual timeline bar
 *   2. Domestic Court Durations (S.34, S.37, SLP Dismissed, SLP Admitted)
 *   3. SIAC Enforcement Durations (HC, CoA)
 *   4. Re-Arbitration Durations (Re-referral, Arb Remaining)
 *   5. Payment Delays (jurisdiction-specific)
 *   6. Max Horizon
 *
 * @prop {Object} draft - Current claim state with timeline config.
 * @prop {Function} updateField - Callback with (key, value) to update claim.
 */
import { useMemo } from 'react';
import { RangeField, NumberField, SectionTitle } from './FormFields';

const STAGE_LABELS = {
  dab: 'DAB (Dispute Adjudication Board)',
  arbitration: 'Arbitration',
  arb_remaining: 'Arbitration Remaining',
  re_referral: 'Re-Referral',
  re_arbitration: 'Re-Arbitration',
};

export default function TimelineEditor({ draft, updateField }) {
  const timeline = draft?.timeline || {};
  const stages = timeline.pre_arb_stages || [];
  const jurisdiction = draft?.jurisdiction || '';
  const isDomestic = jurisdiction.includes('domestic') || !jurisdiction;
  const isSiac = jurisdiction.includes('siac');

  const updateStage = (idx, key, value) => {
    const next = stages.map((s, i) => (i === idx ? { ...s, [key]: value } : s));
    updateField('timeline', { ...timeline, pre_arb_stages: next });
  };

  const updateTimelineField = (key, value) => {
    updateField('timeline', { ...timeline, [key]: value });
  };

  // Court durations — stored at timeline.court_durations level
  const court = timeline.court_durations || {};
  const updateCourt = (key, value) => {
    updateField('timeline', {
      ...timeline,
      court_durations: { ...court, [key]: value },
    });
  };
  const updateCourtRange = (key, field, value) => {
    const current = court[key] || {};
    updateField('timeline', {
      ...timeline,
      court_durations: { ...court, [key]: { ...current, [field]: value } },
    });
  };

  // Total expected duration
  const { totalDuration, stageWidths } = useMemo(() => {
    let total = 0;
    const currentStage = draft?.current_stage || '';
    let foundStage = !currentStage;
    const widths = stages.map((s) => {
      if (!foundStage && s.name === currentStage) foundStage = true;
      const mid = foundStage ? ((s.duration_low || 0) + (s.duration_high || 0)) / 2 : 0;
      total += mid;
      return mid;
    });
    if (!foundStage) {
      total = 0;
      for (let i = 0; i < stages.length; i++) {
        widths[i] = ((stages[i].duration_low || 0) + (stages[i].duration_high || 0)) / 2;
        total += widths[i];
      }
    }
    // Add estimated court + payment delay
    const paymentDelay = timeline.payment_delay_months || 0;
    // Add court duration estimate for the visual bar
    let courtEst = 0;
    if (isDomestic) {
      const s34Mid = ((court.s34?.low ?? 9) + (court.s34?.high ?? 18)) / 2;
      const s37Mid = ((court.s37?.low ?? 6) + (court.s37?.high ?? 12)) / 2;
      courtEst = s34Mid + s37Mid + (court.slp_dismissed ?? 4);
    } else if (isSiac) {
      courtEst = (court.siac_hc ?? 6) + (court.siac_coa ?? 6);
    }
    total += courtEst + paymentDelay;
    return { totalDuration: total, stageWidths: widths };
  }, [stages, timeline.payment_delay_months, draft?.current_stage, court, isDomestic, isSiac]);

  return (
    <div className="space-y-6">
      <SectionTitle>Timeline Configuration</SectionTitle>

      {/* ── Expected Total Duration + Visual Bar ── */}
      <div className="p-4 rounded-xl border border-white/5 bg-slate-800/30">
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="text-xs text-slate-500 uppercase tracking-wider">Expected Total Duration</div>
            <div className="text-2xl font-bold text-teal-400">{totalDuration.toFixed(1)} months</div>
            <div className="text-xs text-slate-500">({(totalDuration / 12).toFixed(1)} years)</div>
          </div>
          <div className="text-right">
            <div className="text-xs text-slate-500">Max Horizon</div>
            <div className="text-sm font-semibold text-white">{timeline.max_horizon_months || 96} months</div>
          </div>
        </div>

        {stages.length > 0 && (
          <div className="mt-3">
            <div className="h-6 w-full rounded-full overflow-hidden flex bg-slate-700">
              {stages.map((s, i) => {
                const pct = totalDuration > 0 ? (stageWidths[i] / totalDuration) * 100 : 0;
                return (
                  <div
                    key={i}
                    className="h-full flex items-center justify-center text-[9px] font-bold text-white/80 overflow-hidden"
                    style={{
                      width: pct + '%',
                      backgroundColor: `hsl(${160 + i * 35}, 55%, ${40 + i * 4}%)`,
                      minWidth: pct > 3 ? undefined : '2px',
                    }}
                    title={`${STAGE_LABELS[s.name] || s.name}: ${stageWidths[i].toFixed(1)}m`}
                  >
                    {pct > 8 ? (s.name || '').replace(/_/g, ' ') : ''}
                  </div>
                );
              })}
              {/* Court duration segment */}
              {isDomestic && (
                <div
                  className="h-full flex items-center justify-center text-[9px] font-bold text-white/60 bg-purple-600/60"
                  style={{
                    width: totalDuration > 0
                      ? ((((court.s34?.low??9)+(court.s34?.high??18))/2 + ((court.s37?.low??6)+(court.s37?.high??12))/2 + (court.slp_dismissed??4)) / totalDuration * 100) + '%'
                      : '0%',
                  }}
                >
                  courts
                </div>
              )}
              {isSiac && (
                <div
                  className="h-full flex items-center justify-center text-[9px] font-bold text-white/60 bg-purple-600/60"
                  style={{
                    width: totalDuration > 0
                      ? (((court.siac_hc??6)+(court.siac_coa??6)) / totalDuration * 100) + '%'
                      : '0%',
                  }}
                >
                  enforce
                </div>
              )}
              {(timeline.payment_delay_months || 0) > 0 && (
                <div
                  className="h-full flex items-center justify-center text-[9px] font-bold text-white/60 bg-slate-600"
                  style={{ width: ((timeline.payment_delay_months / totalDuration) * 100) + '%' }}
                >
                  delay
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Section 1: Arbitration Phase Durations ── */}
      <div className="p-4 rounded-xl border border-white/5 bg-slate-800/30">
        <h4 className="text-sm font-semibold text-white mb-1">Arbitration Phase Durations</h4>
        <p className="text-xs text-slate-500 mb-4">Duration ranges for pre-award stages. The MC engine draws Uniform(low, high) per path.</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-2">
          {stages.map((stage, idx) => (
            <RangeField
              key={idx}
              label={STAGE_LABELS[stage.name] || stage.name}
              low={stage.duration_low}
              high={stage.duration_high}
              onLowChange={(v) => updateStage(idx, 'duration_low', v)}
              onHighChange={(v) => updateStage(idx, 'duration_high', v)}
              min={0}
              max={120}
              step={0.1}
              unit="months"
            />
          ))}
        </div>
      </div>

      {/* ── Section 2: Domestic Court Durations ── */}
      {isDomestic && (
        <div className="p-4 rounded-xl border border-white/5 bg-slate-800/30">
          <h4 className="text-sm font-semibold text-white mb-1">Domestic Court Durations</h4>
          <p className="text-xs text-slate-500 mb-4">
            Post-award challenge court stage durations. These apply during the S.34 → S.37 → SLP challenge tree traversal.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-2">
            <RangeField
              label="S.34 Duration"
              low={court.s34?.low ?? 9}
              high={court.s34?.high ?? 18}
              onLowChange={(v) => updateCourtRange('s34', 'low', v)}
              onHighChange={(v) => updateCourtRange('s34', 'high', v)}
              min={1}
              max={36}
              step={1}
              unit="months"
            />
            <RangeField
              label="S.37 Duration"
              low={court.s37?.low ?? 6}
              high={court.s37?.high ?? 12}
              onLowChange={(v) => updateCourtRange('s37', 'low', v)}
              onHighChange={(v) => updateCourtRange('s37', 'high', v)}
              min={1}
              max={24}
              step={1}
              unit="months"
            />
            <NumberField
              label="SLP Dismissed Duration"
              value={court.slp_dismissed ?? 4.0}
              onChange={(v) => updateCourt('slp_dismissed', v)}
              min={0}
              max={24}
              step={0.5}
              unit="months"
              help="Time for SC to dismiss SLP petition"
            />
            <NumberField
              label="SLP Admitted Duration"
              value={court.slp_admitted ?? 24.0}
              onChange={(v) => updateCourt('slp_admitted', v)}
              min={0}
              max={60}
              step={1}
              unit="months"
              help="Full hearing + judgment duration once SLP admitted"
            />
          </div>
        </div>
      )}

      {/* ── Section 3: SIAC Enforcement Durations ── */}
      {isSiac && (
        <div className="p-4 rounded-xl border border-white/5 bg-slate-800/30">
          <h4 className="text-sm font-semibold text-white mb-1">SIAC Enforcement Durations</h4>
          <p className="text-xs text-slate-500 mb-4">
            Post-award enforcement court stage durations in Singapore.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-2">
            <NumberField
              label="High Court (HC) Duration"
              value={court.siac_hc ?? 6.0}
              onChange={(v) => updateCourt('siac_hc', v)}
              min={0}
              max={24}
              step={0.5}
              unit="months"
            />
            <NumberField
              label="Court of Appeal (CoA) Duration"
              value={court.siac_coa ?? 6.0}
              onChange={(v) => updateCourt('siac_coa', v)}
              min={0}
              max={24}
              step={0.5}
              unit="months"
            />
          </div>
        </div>
      )}

      {/* ── Section 4: Re-Arbitration Durations ── */}
      {(() => {
        const currentStage = draft?.current_stage || '';
        const showArbRemaining = ['arbitration', 'arb_hearings_ongoing', 'arb_commenced'].some(
          (s) => currentStage.includes(s),
        );
        const showReReferral = currentStage.includes('re_referral');

        if (!showArbRemaining && !showReReferral) return null;

        return (
          <div className="p-4 rounded-xl border border-white/5 bg-slate-800/30">
            <h4 className="text-sm font-semibold text-white mb-1">Re-Arbitration & Continuation</h4>
            <p className="text-xs text-slate-500 mb-4">
              These fields apply when the claim is mid-arbitration or in re-referral stage.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-2">
              {showArbRemaining && (
                <RangeField
                  label="Arb Remaining Duration"
                  low={timeline.arb_remaining_low ?? 6}
                  high={timeline.arb_remaining_high ?? 12}
                  onLowChange={(v) => updateTimelineField('arb_remaining_low', v)}
                  onHighChange={(v) => updateTimelineField('arb_remaining_high', v)}
                  min={0}
                  max={60}
                  step={0.5}
                  unit="months"
                />
              )}
              {showReReferral && (
                <RangeField
                  label="Re-Referral Duration"
                  low={timeline.re_referral_low ?? 3}
                  high={timeline.re_referral_high ?? 7}
                  onLowChange={(v) => updateTimelineField('re_referral_low', v)}
                  onHighChange={(v) => updateTimelineField('re_referral_high', v)}
                  min={0}
                  max={24}
                  step={0.5}
                  unit="months"
                />
              )}
            </div>
          </div>
        );
      })()}

      {/* ── Section 5: Payment Delays ── */}
      <div className="p-4 rounded-xl border border-white/5 bg-slate-800/30">
        <h4 className="text-sm font-semibold text-white mb-1">Payment Delays</h4>
        <p className="text-xs text-slate-500 mb-4">
          Jurisdiction-specific delays from final resolution to cash receipt.
        </p>
        {(() => {
          const delays = timeline.payment_delays || {};
          const updateDelay = (key, value) => {
            updateField('timeline', {
              ...timeline,
              payment_delays: { ...delays, [key]: value },
            });
          };

          return (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-x-8 gap-y-2">
              {isDomestic && (
                <NumberField
                  label="Domestic Payment Delay"
                  value={delays.domestic ?? 6.0}
                  onChange={(v) => updateDelay('domestic', v)}
                  min={0}
                  max={24}
                  step={0.5}
                  unit="months"
                  help="Delay for Indian domestic claims"
                />
              )}
              {isSiac && (
                <NumberField
                  label="SIAC Payment Delay"
                  value={delays.siac ?? 4.0}
                  onChange={(v) => updateDelay('siac', v)}
                  min={0}
                  max={24}
                  step={0.5}
                  unit="months"
                  help="Delay for SIAC claims"
                />
              )}
              <NumberField
                label="Re-Arb Payment Delay"
                value={delays.re_arb ?? 6.0}
                onChange={(v) => updateDelay('re_arb', v)}
                min={0}
                max={24}
                step={0.5}
                unit="months"
                help="Delay after re-arbitration"
              />
            </div>
          );
        })()}
      </div>

      {/* ── Section 6: Horizon ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8">
        <NumberField
          label="Payment Delay (Legacy Fallback)"
          value={timeline.payment_delay_months}
          onChange={(v) => updateTimelineField('payment_delay_months', v)}
          min={0}
          max={36}
          step={0.5}
          unit="months"
          help="Used when jurisdiction-specific delays are not set"
        />
        <NumberField
          label="Max Horizon"
          value={timeline.max_horizon_months}
          onChange={(v) => updateTimelineField('max_horizon_months', v)}
          min={12}
          max={240}
          step={1}
          unit="months"
          help="Maximum simulation horizon (default 96)"
        />
      </div>
    </div>
  );
}

