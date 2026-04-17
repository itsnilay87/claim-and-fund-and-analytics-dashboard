/**
 * CashflowWaterfall.jsx — Cashflow & Waterfall tab.
 *
 * Sections:
 *   1. J-Curve fan chart (with deal-point selector for grid structures)
 *   2. Waterfall decomposition (nominal + PV)
 *   3. Annual cashflow timeline
 *   4. Per-claim cashflow table
 *   5. Net recovery distribution
 */

import React, { useMemo, useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Cell, Legend,
  ComposedChart, Line,
} from 'recharts';
import { COLORS, FONT, useUISettings, fmtCr, fmtPct, fmtMo } from '../theme';
import { Card, SectionTitle, KPI, CustomTooltip, DataTable } from './Shared';
import JCurveFanChart from './JCurveFanChart';
import { buildClaimNameMap, getClaimDisplayName } from '../utils/claimNames';

const fmt = (v, dec = 2) => `₹${Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: dec, maximumFractionDigits: dec })} Cr`;
const pct = (v, dec = 1) => `${(Number(v || 0) * 100).toFixed(dec)}%`;
const NODATA = <span style={{ color: COLORS.textMuted }}>Data not available</span>;

/* ── Waterfall step builder ── */
function buildWaterfallSteps(wfView, isNominal) {
  if (!wfView) return [];
  const steps = [];
  steps.push({ label: 'SOC', value: wfView.soc_cr, type: 'total' });

  if (!isNominal && wfView.pv_soc_cr != null) {
    steps.push({ label: `PV Disc (${fmtPct(wfView.discount_rate || 0.07)})`, value: -(wfView.soc_cr - wfView.pv_soc_cr), type: 'subtract' });
    steps.push({ label: 'PV SOC', value: wfView.pv_soc_cr, type: 'subtotal' });
    steps.push({ label: 'Win + Quantum Adj', value: -(wfView.pv_soc_cr - (wfView.e_collected_cr || 0)), type: 'subtract' });
  } else {
    steps.push({ label: 'Win + Quantum Adj', value: -(wfView.soc_cr - (wfView.e_collected_cr || 0)), type: 'subtract' });
  }
  steps.push({ label: 'E[Recovery]', value: wfView.e_collected_cr || 0, type: 'subtotal' });
  steps.push({ label: 'Legal Costs', value: -(wfView.legal_costs_cr || 0), type: 'subtract' });
  steps.push({ label: 'Net After Legal', value: wfView.net_after_legal_cr || 0, type: 'total' });

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

export default function CashflowWaterfall({ data, structureType }) {
  const { ui } = useUISettings();
  const wf = data?.waterfall;
  const cf = data?.cashflow_analysis;
  const [wfMode, setWfMode] = useState('nominal');
  const isGrid = structureType === 'monetisation_upfront_tail' || structureType === 'comparative';

  const hasWaterfall = !!wf;
  const hasCashflow = !!cf;

  if (!hasWaterfall && !hasCashflow && !data?.jcurve_data) {
    return <Card>{NODATA}</Card>;
  }

  const nomView = wf?.nominal || wf || {};
  const pvView = wf?.present_value || wf || {};
  const activeView = wfMode === 'nominal' ? nomView : pvView;
  const isNominal = wfMode === 'nominal';
  const chartData = hasWaterfall ? buildWaterfallSteps(activeView, isNominal) : [];

  const summary = cf?.portfolio_summary;
  const perClaim = cf?.per_claim || [];
  const claimNameMap = useMemo(() => buildClaimNameMap(data?.claims), [data?.claims]);
  const timeline = cf?.annual_timeline || [];
  const dist = cf?.distribution;

  /* ── Per-claim totals ── */
  const totals = perClaim.reduce((acc, c) => ({
    soc: acc.soc + (c.soc_cr || 0),
    eq: acc.eq + (c.eq_cr || 0),
    collected: acc.collected + (c.e_collected_cr || 0),
    legal: acc.legal + (c.e_legal_cr || 0),
    net: acc.net + (c.e_net_cr || 0),
  }), { soc: 0, eq: 0, collected: 0, legal: 0, net: 0 });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: ui.space.xl }}>

      {/* KPI Row */}
      {summary && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: ui.space.md }}>
          <KPI label="Total SOC" value={fmt(summary.total_soc_cr, 0)} color={COLORS.accent6} />
          <KPI label="E[Collected]" value={fmt(summary.total_e_collected_cr, 1)} sub={pct(summary.total_e_collected_cr / (summary.total_soc_cr || 1)) + ' of SOC'} color={COLORS.accent4} />
          <KPI label="E[Legal Costs]" value={fmt(summary.total_e_legal_cr, 1)} color={COLORS.accent5} />
          <KPI label="E[Net Cashflow]" value={fmt(summary.total_e_net_cr, 1)} color={summary.total_e_net_cr >= 0 ? COLORS.accent4 : COLORS.accent5} />
        </div>
      )}

      {/* §1 J-Curve Fan Chart */}
      {data?.jcurve_data && (
        <Card>
          <SectionTitle number="1"
            title="Portfolio Cashflow J-Curve"
            subtitle={isGrid
              ? 'Cumulative portfolio cashflow over time. Select deal terms to visualise different structures.'
              : 'Cumulative portfolio cashflow over time — P5/P25/Median/P75/P95 bands.'} />
          <JCurveFanChart
            data={data}
            height={420}
            showControls={isGrid}
          />
        </Card>
      )}

      {/* §2 Waterfall Decomposition */}
      {hasWaterfall && (
        <>
          <div style={{ display: 'flex', gap: ui.space.sm }}>
            {[
              { key: 'nominal', label: 'Nominal (No Discounting)' },
              { key: 'pv', label: `Present Value @ ${fmtPct(pvView.discount_rate || 0.07)}` },
            ].map(m => (
              <button key={m.key} onClick={() => setWfMode(m.key)} style={{
                padding: '10px 20px', borderRadius: 8, border: 'none', cursor: 'pointer',
                fontFamily: FONT, fontSize: ui.sizes.base,
                fontWeight: wfMode === m.key ? 700 : 500,
                color: wfMode === m.key ? '#fff' : COLORS.textMuted,
                background: wfMode === m.key ? COLORS.gradient1 : COLORS.card,
              }}>
                {m.label}
              </button>
            ))}
          </div>

          <Card>
            <SectionTitle number="2"
              title={isNominal ? 'Nominal Value Decomposition' : `PV Decomposition @ ${fmtPct(pvView.discount_rate)}`}
              subtitle="SOC → Win/Quantum Adj → Legal Costs → Net" />
            <ResponsiveContainer width="100%" height={ui.chartHeight?.lg || 440}>
              <BarChart data={chartData} margin={{ top: 20, right: 30, left: 30, bottom: 30 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={COLORS.gridLine} />
                <XAxis dataKey="label" tick={{ fill: COLORS.textMuted, fontSize: ui.sizes.sm, fontWeight: 600 }} angle={-20} textAnchor="end" height={60} />
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
                <Bar dataKey="base" stackId="waterfall" fill="transparent" />
                <Bar dataKey="bar" stackId="waterfall" radius={[4, 4, 0, 0]}>
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

          {/* Nominal vs PV comparison */}
          {pvView.pv_soc_cr != null && (
            <Card>
              <SectionTitle number="3" title="Nominal vs Present Value Comparison"
                subtitle={`PV discounted at ${fmtPct(pvView.discount_rate || 0.07)} over ~${pvView.avg_timeline_months?.toFixed(0) || '?'} months.`} />
              <DataTable
                headers={['Metric', 'Nominal', `PV @ ${fmtPct(pvView.discount_rate || 0.07)}`, 'Δ (Discount Impact)']}
                rows={[
                  { label: 'E[Recovery]', nom: nomView.e_collected_cr, pv: pvView.e_collected_cr },
                  { label: 'Legal Costs', nom: nomView.legal_costs_cr, pv: pvView.legal_costs_cr },
                  { label: 'Net After Legal', nom: nomView.net_after_legal_cr, pv: pvView.net_after_legal_cr },
                ].map(row => {
                  const delta = (row.nom || 0) - (row.pv || 0);
                  return [
                    row.label,
                    fmt(row.nom, 1),
                    fmt(row.pv, 1),
                    Math.abs(delta) < 0.01 ? '—' : <span style={{ color: delta > 0 ? COLORS.accent5 : COLORS.accent4, fontWeight: 600 }}>₹{delta.toFixed(1)} Cr</span>,
                  ];
                })}
              />
            </Card>
          )}
        </>
      )}

      {/* §4 Annual Timeline */}
      {timeline.length > 0 && (
        <Card>
          <SectionTitle number="4" title="Annual Resolution & Recovery Timeline"
            subtitle="When do claims resolve? Expected recovery in ₹ Crore per year." />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
            <div>
              <div style={{ fontSize: ui.sizes.sm, fontWeight: 600, color: COLORS.textMuted, marginBottom: 12, textAlign: 'center' }}>
                Expected Recovery by Year (₹ Crore)
              </div>
              <ResponsiveContainer width="100%" height={280}>
                <ComposedChart data={timeline.map(t => ({
                  year: `Y${t.year}`, recovery: +t.e_recovery_cr, cumul: +(t.cumul_recovery_cr || 0),
                }))}>
                  <CartesianGrid strokeDasharray="3 3" stroke={COLORS.gridLine} />
                  <XAxis dataKey="year" tick={{ fill: COLORS.textMuted, fontSize: 11 }} />
                  <YAxis tick={{ fill: COLORS.textMuted, fontSize: 11 }} />
                  <Tooltip cursor={{ fill: 'rgba(6,182,212,0.06)' }} content={<CustomTooltip />} />
                  <Bar dataKey="recovery" name="E[Recovery] this year (₹ Cr)" fill={COLORS.accent4} opacity={0.7} radius={[4, 4, 0, 0]} />
                  <Line dataKey="cumul" name="Cumulative E[Recovery]" stroke={COLORS.accent3} strokeWidth={2.5} dot={{ r: 4 }} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <div>
              <div style={{ fontSize: ui.sizes.sm, fontWeight: 600, color: COLORS.textMuted, marginBottom: 12, textAlign: 'center' }}>
                Claims Resolution Timeline (%)
              </div>
              <ResponsiveContainer width="100%" height={280}>
                <ComposedChart data={timeline.map(t => ({
                  year: `Y${t.year}`, resolving: +(t.pct_resolving * 100).toFixed(1), cumulative: +((t.pct_cumulative || 0) * 100).toFixed(1),
                }))}>
                  <CartesianGrid strokeDasharray="3 3" stroke={COLORS.gridLine} />
                  <XAxis dataKey="year" tick={{ fill: COLORS.textMuted, fontSize: 11 }} />
                  <YAxis tick={{ fill: COLORS.textMuted, fontSize: 11 }} unit="%" />
                  <Tooltip cursor={{ fill: 'rgba(6,182,212,0.06)' }} content={<CustomTooltip />} />
                  <Bar dataKey="resolving" name="This Year %" fill={COLORS.accent1} opacity={0.7} radius={[4, 4, 0, 0]} />
                  {timeline[0]?.pct_cumulative != null && (
                    <Line dataKey="cumulative" name="Cumulative %" stroke={COLORS.accent3} strokeWidth={2.5} dot={{ r: 4 }} />
                  )}
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>
        </Card>
      )}

      {/* §5 Per-Claim Cashflow Table */}
      {perClaim.length > 0 && (
        <Card>
          <SectionTitle number="5" title="Per-Claim Expected Cashflow Breakdown (₹ Crore)"
            subtitle="Individual claim economics from Monte Carlo simulation." />
          <DataTable
            headers={['Claim', 'Jurisdiction', 'SOC', 'E[Q]', 'P(Win)', 'E[Collected]', 'E[Legal]', 'E[Net]', 'E[Dur]']}
            rows={[
              ...perClaim.map(c => [
                claimNameMap[c.claim_id] || getClaimDisplayName(c),
                <span style={{
                  padding: '2px 8px', borderRadius: 4, fontSize: 10,
                  background: (c.jurisdiction || '').includes('domestic') ? '#1e3a5f' : '#3b1f5e',
                  color: (c.jurisdiction || '').includes('domestic') ? COLORS.accent1 : COLORS.accent2,
                }}>{c.jurisdiction || '—'}</span>,
                fmt(c.soc_cr, 1),
                fmt(c.eq_cr, 1),
                pct(c.win_rate),
                <span style={{ fontWeight: 700, color: COLORS.accent4 }}>{fmt(c.e_collected_cr, 1)}</span>,
                <span style={{ color: COLORS.accent5 }}>{fmt(c.e_legal_cr, 2)}</span>,
                <span style={{ fontWeight: 700, color: c.e_net_cr >= 0 ? COLORS.accent4 : COLORS.accent5 }}>{fmt(c.e_net_cr, 1)}</span>,
                fmtMo(c.e_duration_months),
              ]),
              [
                <span style={{ color: COLORS.accent1, fontWeight: 700 }}>PORTFOLIO</span>,
                '—',
                <strong>{fmt(totals.soc, 1)}</strong>,
                <strong>{fmt(totals.eq, 1)}</strong>,
                '—',
                <strong style={{ color: COLORS.accent4 }}>{fmt(totals.collected, 1)}</strong>,
                <strong style={{ color: COLORS.accent5 }}>{fmt(totals.legal, 1)}</strong>,
                <strong style={{ color: totals.net >= 0 ? COLORS.accent4 : COLORS.accent5 }}>{fmt(totals.net, 1)}</strong>,
                '—',
              ],
            ]}
          />
        </Card>
      )}

      {/* §6 Distribution Percentiles */}
      {dist && (
        <Card>
          <SectionTitle number="6" title="Portfolio Recovery Distribution (₹ Crore)"
            subtitle="Percentile analysis across all MC paths." />
          <DataTable
            headers={['Percentile', 'Gross Collected', 'Legal Costs', 'Net Recovery']}
            rows={['p1', 'p5', 'p10', 'p25', 'p50', 'p75', 'p90', 'p95', 'p99', 'mean']
              .filter(k => dist[k])
              .map(k => {
                const row = dist[k];
                const labels = { p1: 'P1 (worst)', p5: 'P5', p10: 'P10', p25: 'P25', p50: 'P50 (median)', p75: 'P75', p90: 'P90', p95: 'P95', p99: 'P99 (best)', mean: 'Mean' };
                return [
                  <span style={{ fontWeight: k === 'mean' ? 700 : 400, color: k === 'mean' ? COLORS.accent1 : COLORS.text }}>{labels[k]}</span>,
                  fmt(row.gross_cr, 1),
                  <span style={{ color: COLORS.accent5 }}>{fmt(row.legal_cr, 2)}</span>,
                  <span style={{ fontWeight: 600, color: row.net_cr < 0 ? COLORS.accent5 : COLORS.accent4 }}>{fmt(row.net_cr, 1)}</span>,
                ];
              })}
          />
        </Card>
      )}
    </div>
  );
}
