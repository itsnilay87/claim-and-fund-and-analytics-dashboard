/**
 * CashflowWaterfall.jsx — Tab 7: Unified cashflow analysis + waterfall decomposition.
 *
 * Merged from WaterfallChart + CashflowAnalysis.
 * Sections: Portfolio KPIs, Waterfall (Nominal/PV), Annual Timeline, Value
 * Decomposition, Per-Claim Table, Distribution Percentiles, Investor Scenarios.
 * Removed: duplicate assumptions card, quarterly detail, per-claim bar chart.
 */

import React, { useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Cell, Legend,
  ComposedChart, Line,
} from 'recharts';
import { COLORS, FONT, SIZES, useUISettings, fmtCr, fmtPct, fmtMOIC, fmtMo, BAR_CURSOR } from '../theme';
import { Card, SectionTitle, KPI, CustomTooltip } from './Shared';
import JCurveFanChart from './JCurveFanChart';

/* ── local formatters (kept from CashflowAnalysis) ── */
const fmt  = (v, dec = 2) => `₹${Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: dec, maximumFractionDigits: dec })} Cr`;
const pct  = (v, dec = 1) => `${(Number(v || 0) * 100).toFixed(dec)}%`;

const TABLE_STYLE = { width: '100%', borderCollapse: 'collapse', fontFamily: FONT };
const TH_STYLE = {
  padding: '10px 12px', textAlign: 'center', color: '#fff', fontWeight: 700,
  fontSize: 11, background: 'linear-gradient(135deg, #1e3a5f 0%, #2563EB 100%)',
  borderBottom: `2px solid ${COLORS.accent1}`, whiteSpace: 'nowrap',
};
const TD_STYLE = { padding: '8px 12px', textAlign: 'right', color: COLORS.text, borderBottom: `1px solid ${COLORS.cardBorder}`, fontSize: 12 };
const TD_LEFT  = { ...TD_STYLE, textAlign: 'left', fontWeight: 600 };

/* ── waterfall builder (from WaterfallChart) ── */
function buildWaterfallSteps(view, isNominal) {
  const tailPct = view.reference_tail_pct || 0.20;
  const steps = [];
  steps.push({ label: 'SOC', value: view.soc_cr, type: 'total' });
  if (!isNominal) {
    steps.push({ label: `PV Disc (${fmtPct(view.discount_rate)})`, value: -(view.soc_cr - view.pv_soc_cr), type: 'subtract' });
    steps.push({ label: 'PV SOC', value: view.pv_soc_cr, type: 'subtotal' });
    steps.push({ label: 'Win + Quantum Adj', value: -(view.pv_soc_cr - view.prob_adjusted_cr), type: 'subtract' });
  } else {
    steps.push({ label: 'Win + Quantum Adj', value: -(view.soc_cr - view.prob_adjusted_cr), type: 'subtract' });
  }
  steps.push({ label: 'E[Recovery]', value: view.prob_adjusted_cr, type: 'subtotal' });
  steps.push({ label: 'Legal Costs', value: -view.legal_costs_cr, type: 'subtract' });
  steps.push({ label: 'Net After Legal', value: view.net_after_legal_cr, type: 'subtotal' });
  steps.push({ label: `Tata Tail (${fmtPct(tailPct)})`, value: -view.tata_receives_cr, type: 'subtract' });
  steps.push({ label: 'Fund Profit', value: view.fund_net_profit_cr, type: 'total' });

  let running = 0;
  return steps.map(step => {
    if (step.type === 'total' || step.type === 'subtotal') {
      running = step.value;
      return { label: step.label, base: 0, bar: step.value, value: step.value, type: step.type };
    }
    const start = running;
    running += step.value;
    return { label: step.label, base: Math.min(start, running), bar: Math.abs(step.value), value: step.value, type: step.type };
  });
}

const barColor = (type, value) => {
  if (type === 'total') return COLORS.accent1;
  if (type === 'subtotal') return COLORS.accent2;
  return value < 0 ? COLORS.accent5 : COLORS.accent4;
};

/* ════════════════════════════════════════════════════
                     MAIN COMPONENT
   ════════════════════════════════════════════════════ */
export default function CashflowWaterfall({ data }) {
  const { ui } = useUISettings();
  const wf = data?.waterfall;
  const cf = data?.cashflow_analysis;
  const [wfMode, setWfMode] = useState('nominal');
  const [showQuarterly, setShowQuarterly] = useState(false);
  const isNarrow = typeof window !== 'undefined' && window.innerWidth < 1400;

  const hasWaterfall = !!wf;
  const hasCashflow  = !!cf;

  if (!hasWaterfall && !hasCashflow) {
    return <Card><SectionTitle title="No Cashflow / Waterfall Data" subtitle="Re-run simulation to generate." /></Card>;
  }

  /* ── waterfall state ── */
  const nomView    = wf?.nominal || wf || {};
  const pvView     = wf?.present_value || wf || {};
  const activeView = wfMode === 'nominal' ? nomView : pvView;
  const isNominal  = wfMode === 'nominal';
  const chartData  = hasWaterfall ? buildWaterfallSteps(activeView, isNominal) : [];

  /* ── cashflow analysis aliases ── */
  const summary    = cf?.portfolio_summary;
  const perClaim   = cf?.per_claim || [];
  const timeline   = cf?.annual_timeline || [];
  const decomp     = cf?.decomposition || [];
  const dist       = cf?.distribution;
  const scenarios  = cf?.investor_scenarios || [];

  /* ── totals for per-claim footer ── */
  const totals = perClaim.reduce((acc, c) => ({
    soc: acc.soc + c.soc_cr,
    eq: acc.eq + c.eq_cr,
    collected: acc.collected + c.e_collected_cr,
    legal: acc.legal + c.e_legal_cr,
    net: acc.net + c.e_net_cr,
    p5: acc.p5 + (c.p5_collected_cr || 0),
    p50: acc.p50 + (c.p50_collected_cr || 0),
    p95: acc.p95 + (c.p95_collected_cr || 0),
    winRateSum: acc.winRateSum + (c.win_rate || 0),
    durSum: acc.durSum + (c.e_duration_months || 0),
  }), { soc: 0, eq: 0, collected: 0, legal: 0, net: 0, p5: 0, p50: 0, p95: 0, winRateSum: 0, durSum: 0 });
  const nClaims = perClaim.length || 1;
  totals.avgWinRate = totals.winRateSum / nClaims;
  totals.avgDur = totals.durSum / nClaims;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: ui.space.xl }}>

      {/* ────────────── 1. Portfolio KPIs ────────────── */}
      {summary && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: ui.space.md }}>
          <KPI label="Total SOC"       value={fmt(summary.total_soc_cr, 0)}       color={COLORS.accent6} />
          <KPI label="E[Quantum]"      value={fmt(summary.total_eq_cr, 1)}        sub={pct(summary.eq_over_soc) + ' of SOC'} color={COLORS.accent1} />
          <KPI label="E[Collected]"    value={fmt(summary.total_e_collected_cr, 1)} sub={pct(summary.collected_over_soc) + ' of SOC'} color={COLORS.accent4} />
          <KPI label="E[Legal Costs]"  value={fmt(summary.total_e_legal_cr, 1)}   color={COLORS.accent5} />
          <KPI label="E[Net Cashflow]" value={fmt(summary.total_e_net_cr, 1)}     color={summary.total_e_net_cr >= 0 ? COLORS.accent4 : COLORS.accent5} />
          <KPI label="P(Win) avg"      value={pct(summary.avg_win_rate)}          color={COLORS.accent2} />
        </div>
      )}

      {/* ────────────── 1b. Interactive Cashflow J-Curve ────────────── */}
      {data?.jcurve_data && (
        <Card>
          <SectionTitle number="1b"
            title="Portfolio Cashflow J-Curve"
            subtitle="Cumulative portfolio cashflow over time. Select upfront % and Tata tail % to visualise any investment structure." />
          <JCurveFanChart
            data={data}
            height={420}
            showControls
            upfrontPct={0.10}
            tataTailPct={0.20}
          />
        </Card>
      )}

      {/* ────────────── 1c. Annual Timeline (moved before waterfall) ────────────── */}
      {timeline.length > 0 && (
        <Card>
          <SectionTitle number="1c" title="Annual Resolution & Recovery Timeline"
            subtitle="When do claims resolve? Expected recovery in ₹ Crore per year." />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
            {/* Resolution % */}
            <div>
              <div style={{ fontSize: ui.sizes.sm, fontWeight: 600, color: COLORS.textMuted, marginBottom: 12, textAlign: 'center' }}>
                Claims Resolution Timeline (%)
              </div>
              <ResponsiveContainer width="100%" height={280}>
                <ComposedChart data={timeline.map(t => ({
                  year: `Y${t.year}`, resolving: +(t.pct_resolving * 100).toFixed(1), cumulative: +(t.pct_cumulative * 100).toFixed(1),
                }))}>
                  <CartesianGrid strokeDasharray="3 3" stroke={COLORS.gridLine} />
                  <XAxis dataKey="year" tick={{ fill: COLORS.textMuted, fontSize: 11 }} />
                  <YAxis tick={{ fill: COLORS.textMuted, fontSize: 11 }} unit="%" />
                  <Tooltip cursor={{ fill: 'rgba(6,182,212,0.06)' }} contentStyle={{ background: '#1F2937', border: `1px solid ${COLORS.cardBorder}`, borderRadius: 8, fontFamily: FONT }} labelStyle={{ color: COLORS.textBright, fontWeight: 700 }} itemStyle={{ color: COLORS.text }} />
                  <Bar dataKey="resolving" name="This Year %" fill={COLORS.accent1} opacity={0.7} radius={[4, 4, 0, 0]} cursor={BAR_CURSOR} />
                  <Line dataKey="cumulative" name="Cumulative %" stroke={COLORS.accent3} strokeWidth={2.5} dot={{ r: 4 }} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            {/* Recovery ₹ */}
            <div>
              <div style={{ fontSize: ui.sizes.sm, fontWeight: 600, color: COLORS.textMuted, marginBottom: 12, textAlign: 'center' }}>
                Expected Recovery by Year (₹ Crore)
              </div>
              <ResponsiveContainer width="100%" height={280}>
                <ComposedChart data={timeline.map(t => ({
                  year: `Y${t.year}`, recovery: +t.e_recovery_cr, cumulRecovery: +t.cumul_recovery_cr,
                }))}>
                  <CartesianGrid strokeDasharray="3 3" stroke={COLORS.gridLine} />
                  <XAxis dataKey="year" tick={{ fill: COLORS.textMuted, fontSize: 11 }} />
                  <YAxis tick={{ fill: COLORS.textMuted, fontSize: 11 }} />
                  <Tooltip cursor={{ fill: 'rgba(6,182,212,0.06)' }} contentStyle={{ background: '#1F2937', border: `1px solid ${COLORS.cardBorder}`, borderRadius: 8, fontFamily: FONT }}
                    labelStyle={{ color: COLORS.textBright, fontWeight: 700 }}
                    itemStyle={{ color: COLORS.text }}
                    formatter={(v) => [`₹${Number(v).toLocaleString('en-IN', { maximumFractionDigits: 1 })} Cr`]} />
                  <Bar dataKey="recovery" name="E[Recovery] this year" fill={COLORS.accent4} opacity={0.7} radius={[4, 4, 0, 0]} cursor={BAR_CURSOR} />
                  <Line dataKey="cumulRecovery" name="Cumulative E[Recovery]" stroke={COLORS.accent3} strokeWidth={2.5} dot={{ r: 4 }} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>
        </Card>
      )}

      {/* ────────────── 2. Waterfall Decomposition ────────────── */}
      {hasWaterfall && (
        <>
          {/* Mode toggle */}
          <div style={{ display: 'flex', gap: ui.space.sm }}>
            {[
              { key: 'nominal', label: 'Nominal (No Discounting)' },
              { key: 'pv', label: `Present Value @ ${fmtPct(pvView.discount_rate || 0.07)}` },
            ].map(m => (
              <button key={m.key} onClick={() => setWfMode(m.key)} style={{
                padding: '10px 20px', borderRadius: 8, border: 'none', cursor: 'pointer',
                fontFamily: FONT, fontSize: ui.sizes.base, fontWeight: wfMode === m.key ? 700 : 500,
                color: wfMode === m.key ? '#fff' : COLORS.textMuted,
                background: wfMode === m.key ? COLORS.gradient1 : COLORS.card,
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
                ? 'SOC → Win/Quantum Adj → Legal Costs → Tata Tail → Fund Profit'
                : `SOC → PV Discount (~${pvView.avg_timeline_months?.toFixed(0) || '?'}m) → Win/Quantum Adj → Legal → Tata → Fund`} />
            <ResponsiveContainer width="100%" height={ui.chartHeight.lg}>
              <BarChart data={chartData} margin={{ top: 20, right: 30, left: 30, bottom: 30 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={COLORS.gridLine} />
                <XAxis dataKey="label" tick={{ fill: COLORS.textMuted, fontSize: ui.sizes.sm, fontWeight: 600 }} interval={isNarrow ? 1 : 0} angle={-20} textAnchor="end" height={60} />
                <YAxis tick={{ fill: COLORS.textMuted, fontSize: ui.sizes.sm }} tickFormatter={v => '₹' + v.toFixed(0)} width={60} />
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

          {/* Nominal vs PV comparison table */}
          <Card>
            <SectionTitle number="2" title="Nominal vs Present Value Comparison"
              subtitle={`PV discounted at ${fmtPct(pvView.discount_rate || 0.07)} over ~${pvView.avg_timeline_months?.toFixed(0) || '?'} months.`} />
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
                    const delta = (row.nom || 0) - (row.pv || 0);
                    return (
                      <tr key={i} style={{ background: i % 2 === 0 ? 'transparent' : '#ffffff05' }}>
                        <td style={{ padding: '10px 16px', color: COLORS.textBright, fontSize: ui.sizes.base, fontWeight: 600 }}>{row.label}</td>
                        <td style={{ padding: '10px 16px', color: COLORS.text, fontSize: ui.sizes.base, textAlign: 'center' }}>₹{(row.nom || 0).toFixed(1)} Cr</td>
                        <td style={{ padding: '10px 16px', color: COLORS.text, fontSize: ui.sizes.base, textAlign: 'center' }}>₹{(row.pv || 0).toFixed(1)} Cr</td>
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
        </>
      )}

      {/* ────────────── 4. Value Decomposition Chain ────────────── */}
      {decomp.length > 0 && (
        <Card>
          <SectionTitle number="4" title="Value Decomposition: SOC → E[Collected]"
            subtitle="Step-by-step walkthrough showing how SOC becomes expected collected amount." />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
            {decomp.map((step, i) => {
              const isResult = step.step.includes('E[Collected]');
              const isLegal  = step.step.includes('Legal');
              const bgColor     = isResult ? '#10B98115' : (isLegal ? '#EF444415' : 'transparent');
              const borderColor = isResult ? COLORS.accent4 : (isLegal ? COLORS.accent5 : COLORS.cardBorder);
              return (
                <div key={i} style={{
                  display: 'grid', gridTemplateColumns: '140px 1fr 100px 140px 1fr', gap: 0,
                  padding: '12px 16px', background: bgColor, borderLeft: `3px solid ${borderColor}`,
                  borderBottom: `1px solid ${COLORS.cardBorder}`, alignItems: 'center',
                }}>
                  <div style={{ fontSize: 13, fontWeight: 800, color: isResult ? COLORS.accent4 : (isLegal ? COLORS.accent5 : COLORS.accent1), fontFamily: FONT }}>{step.step}</div>
                  <div style={{ fontSize: 12, color: COLORS.text }}>{step.label}</div>
                  <div style={{ fontSize: 12, fontWeight: 600, textAlign: 'center', color: COLORS.accent3, fontFamily: 'monospace' }}>{step.factor}</div>
                  <div style={{ fontSize: 14, fontWeight: 700, textAlign: 'right', color: isResult ? COLORS.accent4 : (isLegal ? COLORS.accent5 : COLORS.textBright) }}>{fmt(step.value_cr, 1)}</div>
                  <div style={{ fontSize: 11, color: COLORS.textMuted, paddingLeft: 16 }}>{step.note}</div>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {/* ────────────── 5. Per-Claim Table ────────────── */}
      {perClaim.length > 0 && (
        <Card>
          <SectionTitle number="5" title="Per-Claim Expected Cashflow Breakdown (₹ Crore)"
            subtitle="Individual claim economics. P5/P50/P95 = collected percentiles from MC simulation." />
          <div style={{ overflowX: 'auto' }}>
            <table style={TABLE_STYLE}>
              <thead>
                <tr>
                  <th style={{ ...TH_STYLE, textAlign: 'left' }}>Claim</th>
                  <th style={TH_STYLE}>SOC</th>
                  <th style={TH_STYLE}>Jurisdiction</th>
                  <th style={TH_STYLE}>E[Q]</th>
                  <th style={TH_STYLE}>P(Win)</th>
                  <th style={TH_STYLE}>E[Collected]</th>
                  <th style={TH_STYLE}>P5</th>
                  <th style={TH_STYLE}>P50</th>
                  <th style={TH_STYLE}>P95</th>
                  <th style={TH_STYLE}>E[Legal]</th>
                  <th style={TH_STYLE}>E[Net]</th>
                  <th style={TH_STYLE}>E[Dur]</th>
                </tr>
              </thead>
              <tbody>
                {perClaim.map((c, i) => (
                  <tr key={c.claim_id} style={{ background: i % 2 === 0 ? 'transparent' : '#0d1321' }}>
                    <td style={TD_LEFT}>{c.claim_id}</td>
                    <td style={TD_STYLE}>{fmt(c.soc_cr, 1)}</td>
                    <td style={{ ...TD_STYLE, textAlign: 'center' }}>
                      <span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 10,
                        background: c.jurisdiction === 'domestic' ? '#1e3a5f' : '#3b1f5e',
                        color: c.jurisdiction === 'domestic' ? COLORS.accent1 : COLORS.accent2 }}>{c.jurisdiction}</span>
                    </td>
                    <td style={TD_STYLE}>{fmt(c.eq_cr, 1)}</td>
                    <td style={{ ...TD_STYLE, color: c.win_rate >= 0.5 ? COLORS.accent4 : COLORS.accent5 }}>{pct(c.win_rate)}</td>
                    <td style={{ ...TD_STYLE, fontWeight: 700, color: COLORS.accent4 }}>{fmt(c.e_collected_cr, 1)}</td>
                    <td style={{ ...TD_STYLE, color: COLORS.textMuted, fontSize: 11 }}>{fmt(c.p5_collected_cr, 1)}</td>
                    <td style={TD_STYLE}>{fmt(c.p50_collected_cr, 1)}</td>
                    <td style={{ ...TD_STYLE, color: COLORS.accent4, fontSize: 11 }}>{fmt(c.p95_collected_cr, 1)}</td>
                    <td style={{ ...TD_STYLE, color: COLORS.accent5 }}>{fmt(c.e_legal_cr, 2)}</td>
                    <td style={{ ...TD_STYLE, fontWeight: 700, color: c.e_net_cr >= 0 ? COLORS.accent4 : COLORS.accent5 }}>{fmt(c.e_net_cr, 1)}</td>
                    <td style={{ ...TD_STYLE, textAlign: 'center' }}>{c.e_duration_months?.toFixed(1)}</td>
                  </tr>
                ))}
                <tr style={{ background: '#1a2744', fontWeight: 700 }}>
                  <td style={{ ...TD_LEFT, color: COLORS.accent1 }}>PORTFOLIO</td>
                  <td style={{ ...TD_STYLE, fontWeight: 700 }}>{fmt(totals.soc, 1)}</td>
                  <td style={{ ...TD_STYLE, textAlign: 'center' }}>—</td>
                  <td style={{ ...TD_STYLE, fontWeight: 700 }}>{fmt(totals.eq, 1)}</td>
                  <td style={{ ...TD_STYLE, color: totals.avgWinRate >= 0.5 ? COLORS.accent4 : COLORS.accent5 }}>{pct(totals.avgWinRate)}</td>
                  <td style={{ ...TD_STYLE, fontWeight: 700, color: COLORS.accent4 }}>{fmt(totals.collected, 1)}</td>
                  <td style={{ ...TD_STYLE, color: COLORS.textMuted, fontSize: 11 }}>{fmt(totals.p5, 1)}</td>
                  <td style={TD_STYLE}>{fmt(totals.p50, 1)}</td>
                  <td style={{ ...TD_STYLE, color: COLORS.accent4, fontSize: 11 }}>{fmt(totals.p95, 1)}</td>
                  <td style={{ ...TD_STYLE, fontWeight: 700, color: COLORS.accent5 }}>{fmt(totals.legal, 1)}</td>
                  <td style={{ ...TD_STYLE, fontWeight: 700, color: totals.net >= 0 ? COLORS.accent4 : COLORS.accent5 }}>{fmt(totals.net, 1)}</td>
                  <td style={{ ...TD_STYLE, textAlign: 'center' }}>{totals.avgDur.toFixed(1)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* ────────────── 6. Distribution Percentiles ────────────── */}
      {dist && (
        <Card>
          <SectionTitle number="6" title="Portfolio Recovery Distribution (₹ Crore)"
            subtitle="Percentile analysis across all MC paths. Gross = before legal. Net = after legal." />
          <div style={{ overflowX: 'auto' }}>
            <table style={TABLE_STYLE}>
              <thead>
                <tr>
                  <th style={{ ...TH_STYLE, textAlign: 'left' }}>Percentile</th>
                  <th style={TH_STYLE}>Gross Collected</th>
                  <th style={TH_STYLE}>Legal Costs</th>
                  <th style={TH_STYLE}>Net Recovery</th>
                  <th style={TH_STYLE}>Net / SOC</th>
                </tr>
              </thead>
              <tbody>
                {['p1','p5','p10','p25','p50','p75','p90','p95','p99','mean'].map((key, i) => {
                  const row = dist[key];
                  if (!row) return null;
                  const isMean = key === 'mean';
                  const labels = { p1:'P1 (worst)', p5:'P5', p10:'P10', p25:'P25', p50:'P50 (median)', p75:'P75', p90:'P90', p95:'P95', p99:'P99 (best)', mean:'Mean' };
                  const netColor = row.net_cr < 0 ? COLORS.accent5 : (row.net_cr > 500 ? COLORS.accent4 : COLORS.text);
                  return (
                    <tr key={key} style={{ background: isMean ? '#1a2744' : (i % 2 === 0 ? 'transparent' : '#0d1321'), fontWeight: isMean ? 700 : 400 }}>
                      <td style={{ ...TD_LEFT, color: isMean ? COLORS.accent1 : COLORS.text }}>{labels[key]}</td>
                      <td style={TD_STYLE}>{fmt(row.gross_cr, 1)}</td>
                      <td style={{ ...TD_STYLE, color: COLORS.accent5 }}>{fmt(row.legal_cr, 2)}</td>
                      <td style={{ ...TD_STYLE, fontWeight: 600, color: netColor }}>{fmt(row.net_cr, 1)}</td>
                      <td style={{ ...TD_STYLE, color: netColor }}>{pct(row.net_over_soc)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* ────────────── 7. Investor Scenarios ────────────── */}
      {scenarios.length > 0 && (
        <Card>
          <SectionTitle number="7" title="Investor Cashflow Under Key Structures"
            subtitle="Fund performance under different upfront% / Tata tail% combinations. All ₹ Crore." />
          <div style={{ overflowX: 'auto' }}>
            <table style={TABLE_STYLE}>
              <thead>
                <tr>
                  <th style={{ ...TH_STYLE, textAlign: 'left' }}>Scenario</th>
                  <th style={TH_STYLE}>Upfront</th>
                  <th style={TH_STYLE}>Legal</th>
                  <th style={TH_STYLE}>Total Inv</th>
                  <th style={TH_STYLE}>E[Gross]</th>
                  <th style={TH_STYLE}>E[Net]</th>
                  <th style={TH_STYLE}>E[MOIC]</th>
                  <th style={TH_STYLE}>P(Loss)</th>
                </tr>
              </thead>
              <tbody>
                {scenarios.map((s, i) => {
                  return (
                    <tr key={s.label} style={{ background: i % 2 === 0 ? 'transparent' : '#0d1321' }}>
                      <td style={TD_LEFT}>{s.label}</td>
                      <td style={{ ...TD_STYLE, color: COLORS.accent6 }}>{fmt(s.upfront_cr, 1)}</td>
                      <td style={{ ...TD_STYLE, color: COLORS.accent5 }}>{fmt(s.legal_costs_cr, 1)}</td>
                      <td style={{ ...TD_STYLE, fontWeight: 700 }}>{fmt(s.total_investment_cr, 1)}</td>
                      <td style={TD_STYLE}>{fmt(s.e_gross_recovery_cr, 1)}</td>
                      <td style={{ ...TD_STYLE, fontWeight: 700, color: s.e_net_to_fund_cr >= 0 ? COLORS.accent4 : COLORS.accent5 }}>{fmt(s.e_net_to_fund_cr, 1)}</td>
                      <td style={{ ...TD_STYLE, color: s.e_moic >= 2 ? COLORS.accent4 : (s.e_moic >= 1 ? COLORS.accent3 : COLORS.accent5) }}>{fmtMOIC(s.e_moic)}</td>
                      <td style={{ ...TD_STYLE, color: s.p_loss < 0.1 ? COLORS.accent4 : (s.p_loss < 0.25 ? COLORS.accent3 : COLORS.accent5) }}>{pct(s.p_loss)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
