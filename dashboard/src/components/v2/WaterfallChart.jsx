/**
 * WaterfallChart.jsx — Dual waterfall: Nominal (no discounting) + PV @ 7%.
 *
 * Data source: data.waterfall = {
 *   nominal: { soc_cr, win_rate, eq_multiplier, win_adjusted_cr, prob_adjusted_cr,
 *              legal_costs_cr, net_after_legal_cr, reference_tail_pct,
 *              tata_receives_cr, fund_net_profit_cr },
 *   present_value: { ..same + discount_rate, avg_timeline_months, pv_factor, pv_soc_cr },
 *   // backward-compat top-level fields (PV defaults)
 * }
 */

import React, { useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Cell,
} from 'recharts';
import { COLORS, FONT, SIZES, SPACE, CHART_HEIGHT, CHART_FONT, useUISettings, fmtCr, fmtPct, BAR_CURSOR } from '../theme';
import { Card, SectionTitle, KPI } from './Shared';

/* --- build waterfall chart data from one view --- */
function buildWaterfallSteps(view, isNominal) {
  const tailPct = view.reference_tail_pct || 0.20;
  const steps = [];

  // Step 1: SOC
  steps.push({ label: 'SOC', value: view.soc_cr, type: 'total' });

  if (!isNominal) {
    // PV discount step
    steps.push({ label: `PV Disc (${fmtPct(view.discount_rate)})`, value: -(view.soc_cr - view.pv_soc_cr), type: 'subtract' });
    steps.push({ label: 'PV SOC', value: view.pv_soc_cr, type: 'subtotal' });
    // Win-adj from PV SOC
    steps.push({ label: 'Win + Quantum Adj', value: -(view.pv_soc_cr - view.prob_adjusted_cr), type: 'subtract' });
  } else {
    // Nominal: direct from SOC → probability-adjusted
    steps.push({ label: 'Win + Quantum Adj', value: -(view.soc_cr - view.prob_adjusted_cr), type: 'subtract' });
  }

  steps.push({ label: 'E[Recovery]', value: view.prob_adjusted_cr, type: 'subtotal' });
  steps.push({ label: 'Legal Costs', value: -view.legal_costs_cr, type: 'subtract' });
  steps.push({ label: 'Net After Legal', value: view.net_after_legal_cr, type: 'subtotal' });
  steps.push({ label: `Tata Tail (${fmtPct(tailPct)})`, value: -view.tata_receives_cr, type: 'subtract' });
  steps.push({ label: 'Fund Profit', value: view.fund_net_profit_cr, type: 'total' });

  // Build floating bars
  let running = 0;
  return steps.map(step => {
    if (step.type === 'total' || step.type === 'subtotal') {
      running = step.value;
      return { label: step.label, base: 0, bar: step.value, value: step.value, type: step.type };
    } else {
      const start = running;
      running = running + step.value;
      return {
        label: step.label,
        base: Math.min(start, running),
        bar: Math.abs(step.value),
        value: step.value,
        type: step.type,
      };
    }
  });
}

const barColor = (type, value) => {
  if (type === 'total') return COLORS.accent1;
  if (type === 'subtotal') return COLORS.accent2;
  return value < 0 ? COLORS.accent5 : COLORS.accent4;
};

export default function WaterfallChart({ data }) {
  const { ui } = useUISettings();
  const wf = data?.waterfall;
  const [mode, setMode] = useState('nominal');
  const isNarrow = typeof window !== 'undefined' && window.innerWidth < 1400;

  if (!wf) {
    return <Card><SectionTitle title="No Waterfall Data" subtitle="Waterfall decomposition not available." /></Card>;
  }

  const nomView = wf.nominal || wf;
  const pvView = wf.present_value || wf;
  const activeView = mode === 'nominal' ? nomView : pvView;
  const isNominal = mode === 'nominal';
  const chartData = buildWaterfallSteps(activeView, isNominal);
  const tailPct = activeView.reference_tail_pct || 0.20;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: ui.space.xl }}>
      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: ui.space.md }}>
        <KPI label="Total SOC" value={fmtCr(nomView.soc_cr)} color={COLORS.accent1} />
        <KPI label="Win Rate" value={fmtPct(activeView.win_rate)} color={COLORS.accent4} />
        <KPI label="E[Recovery]" value={fmtCr(activeView.prob_adjusted_cr)} color={COLORS.accent2} />
        <KPI label="Legal Costs" value={fmtCr(activeView.legal_costs_cr)} color={COLORS.accent5} />
        <KPI label="Fund Profit" value={fmtCr(activeView.fund_net_profit_cr)}
          sub={isNominal ? 'Nominal' : `PV @ ${fmtPct(pvView.discount_rate)}`}
          color={activeView.fund_net_profit_cr > 0 ? COLORS.accent4 : COLORS.accent5} />
      </div>

      {/* Mode toggle */}
      <div style={{ display: 'flex', gap: ui.space.sm }}>
        {[
          { key: 'nominal', label: 'Nominal (No Discounting)' },
          { key: 'pv', label: `Present Value @ ${fmtPct(pvView.discount_rate || 0.07)}` },
        ].map(m => (
          <button key={m.key} onClick={() => setMode(m.key)} style={{
            padding: '10px 20px', borderRadius: 8, border: 'none', cursor: 'pointer',
            fontFamily: FONT, fontSize: ui.sizes.base, fontWeight: mode === m.key ? 700 : 500,
            color: mode === m.key ? '#fff' : COLORS.textMuted,
            background: mode === m.key ? COLORS.gradient1 : COLORS.card,
          }}>
            {m.label}
          </button>
        ))}
      </div>

      {/* Waterfall chart */}
      <Card>
        <SectionTitle number="1"
          title={isNominal ? 'Nominal Value Decomposition' : `PV Decomposition @ ${fmtPct(pvView.discount_rate)}`}
          subtitle={isNominal
            ? `SOC → Win/Quantum Adjusted → Legal Costs → Tata Tail → Fund Profit. No time-value discounting.`
            : `SOC → PV Discount (avg ${pvView.avg_timeline_months?.toFixed(0) || '?'}m) → Win/Quantum Adjusted → Legal → Tata → Fund. Rate: ${fmtPct(pvView.discount_rate)}.`
          } />
        <ResponsiveContainer width="100%" height={ui.chartHeight.lg}>
          <BarChart data={chartData} margin={{ top: 20, right: 30, left: 30, bottom: 30 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={COLORS.gridLine} />
            <XAxis dataKey="label" tick={{ fill: COLORS.textMuted, fontSize: ui.sizes.sm, fontWeight: 600 }} interval={isNarrow ? 1 : 0} angle={-20} textAnchor="end" height={isNarrow ? 52 : 60} />
            <YAxis tick={{ fill: COLORS.textMuted, fontSize: ui.sizes.sm }} tickFormatter={v => '₹' + v.toFixed(0)} width={isNarrow ? 44 : 60} />
            <Tooltip cursor={{ fill: 'rgba(6,182,212,0.06)' }} content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const d = payload[0]?.payload;
              return (
                <div style={{ background: COLORS.card, border: `1px solid ${COLORS.cardBorder}`, borderRadius: 8, padding: '10px 14px', fontFamily: FONT }}>
                  <div style={{ color: COLORS.textBright, fontWeight: 700, fontSize: ui.sizes.sm, marginBottom: 4 }}>{d.label}</div>
                  <div style={{ color: COLORS.text, fontSize: ui.sizes.sm }}>
                    {d.type === 'subtract' ? 'Reduction' : 'Value'}: ₹{Math.abs(d.value).toFixed(1)} Cr
                  </div>
                </div>
              );
            }} />
            <Bar dataKey="base" stackId="waterfall" fill="transparent" cursor={BAR_CURSOR} />
            <Bar dataKey="bar" stackId="waterfall" radius={[4, 4, 0, 0]} cursor={BAR_CURSOR}>
              {chartData.map((entry, idx) => (
                <Cell key={idx} fill={barColor(entry.type, entry.value)} fillOpacity={entry.type === 'subtotal' ? 0.6 : 0.9} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
        <div style={{ display: 'flex', justifyContent: 'center', gap: ui.space.xl, marginTop: 8 }}>
          {[
            { color: COLORS.accent1, label: 'Total / Starting' },
            { color: COLORS.accent2, label: 'Subtotal', opacity: 0.6 },
            { color: COLORS.accent5, label: 'Reduction' },
          ].map(({ color, label, opacity }, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ width: 14, height: 14, borderRadius: 4, background: color, opacity: opacity || 1 }} />
              <span style={{ color: COLORS.textMuted, fontSize: ui.sizes.sm }}>{label}</span>
            </div>
          ))}
        </div>
      </Card>

      {/* Comparison table: Nominal vs PV */}
      <Card>
        <SectionTitle number="2" title="Nominal vs Present Value Comparison"
          subtitle={`Side-by-side view. PV discounted at ${fmtPct(pvView.discount_rate || 0.07)} over ~${pvView.avg_timeline_months?.toFixed(0) || '?'} months.`} />
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 2, fontFamily: FONT }}>
            <thead>
              <tr>
                {['Metric', 'Nominal', `PV @ ${fmtPct(pvView.discount_rate || 0.07)}`, 'Δ (Discount Impact)'].map(h => (
                  <th key={h} style={{
                    padding: '12px 16px', color: COLORS.textMuted, fontSize: ui.sizes.sm,
                    fontWeight: 700, textAlign: 'center', textTransform: 'uppercase',
                    borderBottom: `1px solid ${COLORS.cardBorder}`,
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[
                { label: 'E[Recovery]', nom: nomView.prob_adjusted_cr, pv: pvView.prob_adjusted_cr },
                { label: 'Legal Costs', nom: nomView.legal_costs_cr, pv: pvView.legal_costs_cr },
                { label: 'Net After Legal', nom: nomView.net_after_legal_cr, pv: pvView.net_after_legal_cr },
                { label: 'Tata Receives', nom: nomView.tata_receives_cr, pv: pvView.tata_receives_cr },
                { label: 'Fund Profit', nom: nomView.fund_net_profit_cr, pv: pvView.fund_net_profit_cr },
              ].map((row, i) => {
                const delta = row.nom - row.pv;
                return (
                  <tr key={i} style={{ background: i % 2 === 0 ? 'transparent' : '#ffffff05' }}>
                    <td style={{ padding: '10px 16px', color: COLORS.textBright, fontSize: ui.sizes.base, fontWeight: 600 }}>{row.label}</td>
                    <td style={{ padding: '10px 16px', color: COLORS.text, fontSize: ui.sizes.base, textAlign: 'center' }}>₹{row.nom.toFixed(1)} Cr</td>
                    <td style={{ padding: '10px 16px', color: COLORS.text, fontSize: ui.sizes.base, textAlign: 'center' }}>₹{row.pv.toFixed(1)} Cr</td>
                    <td style={{ padding: '10px 16px', fontSize: ui.sizes.base, textAlign: 'center', fontWeight: 600,
                      color: delta > 0.01 ? COLORS.accent5 : delta < -0.01 ? COLORS.accent4 : COLORS.textMuted }}>
                      {Math.abs(delta) < 0.01 ? '—' : `₹${delta.toFixed(1)} Cr`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Key assumptions */}
      <Card>
        <SectionTitle number="3" title="Waterfall Assumptions" subtitle="Key parameters used in the decomposition" />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: ui.space.lg }}>
          {[
            { label: 'Win Rate', value: fmtPct(activeView.win_rate) },
            { label: 'E[Q] Multiplier', value: `${(activeView.eq_multiplier || 0).toFixed(3)}×` },
            { label: 'Tata Tail', value: fmtPct(tailPct) },
            { label: 'PV Discount', value: pvView.pv_factor ? pvView.pv_factor.toFixed(4) : 'N/A' },
            { label: 'PV Rate', value: fmtPct(pvView.discount_rate || 0.07) },
            { label: 'Avg Timeline', value: `${(pvView.avg_timeline_months || 0).toFixed(0)}m` },
            { label: 'Legal Costs', value: fmtCr(activeView.legal_costs_cr) },
            { label: '# Claims', value: '6' },
          ].map((p, i) => (
            <div key={i} style={{ textAlign: 'center', padding: 12, background: '#0F1219', borderRadius: 8 }}>
              <div style={{ color: COLORS.textMuted, fontSize: ui.sizes.sm, fontWeight: 600, marginBottom: 4, textTransform: 'uppercase' }}>{p.label}</div>
              <div style={{ color: COLORS.textBright, fontSize: ui.sizes.lg, fontWeight: 700 }}>{p.value}</div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
