/**
 * ClaimExecutiveSummary.jsx — Single-claim executive summary tab.
 *
 * Sections:
 *   1. Claim Identity Card
 *   2. KPI Row (6 cards)
 *   3. Value Chain Decomposition (horizontal flow)
 *   4. MOIC Distribution Histogram
 *   5. MC Percentile Summary Table
 *   6. J-Curve Preview
 */

import React, { useMemo } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, ReferenceLine,
  AreaChart, Area, LineChart, Line,
} from 'recharts';
import { COLORS, FONT, CHART_HEIGHT, useUISettings, fmtCr, fmtPct, fmtMOIC, fmtMo } from '../../theme';
import { Card, SectionTitle, KPI, DataTable } from '../Shared';

/* ═══════════════════════════════════════════════════════════
 *  § 1 — Claim Identity Card
 * ═══════════════════════════════════════════════════════════ */
function ClaimIdentityCard({ claim }) {
  const { ui } = useUISettings();
  const fields = [
    { label: 'Claim Name',     value: claim.name || claim.claim_id || 'N/A' },
    { label: 'Jurisdiction',   value: (claim.jurisdiction || 'N/A').toUpperCase() },
    { label: 'Claim Type',     value: (claim.archetype || 'N/A').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) },
    { label: 'Current Stage',  value: (claim.current_gate || 'N/A').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) },
    { label: 'SOC',            value: fmtCr(claim.soc_value_cr) },
    { label: 'Currency',       value: '₹ (INR Crore)' },
  ];
  return (
    <Card>
      <SectionTitle number="1" title="Claim Identity" subtitle="Core claim attributes and parameters" />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: ui.space.md }}>
        {fields.map(f => (
          <div key={f.label} style={{ padding: `${ui.space.sm}px ${ui.space.md}px` }}>
            <div style={{ color: COLORS.textMuted, fontSize: ui.sizes.sm, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>
              {f.label}
            </div>
            <div style={{ color: COLORS.textBright, fontSize: ui.sizes.lg, fontWeight: 700 }}>
              {f.value}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

/* ═══════════════════════════════════════════════════════════
 *  § 2 — KPI Row
 * ═══════════════════════════════════════════════════════════ */
function ClaimKPIRow({ data }) {
  const { ui } = useUISettings();
  const claim = data?.claims?.[0] || {};
  const risk = data?.risk || {};
  const moicDist = risk.moic_distribution || {};
  const irrDist = risk.irr_distribution || {};

  // Try to get reference metrics from investment_grid or waterfall_grid
  const ig = data?.investment_grid || {};
  const wg = data?.waterfall_grid || {};
  const refKey = ig['10_20'] ? '10_20' : ig['10_10'] ? '10_10' : Object.keys(ig)[0];
  const ref = ig[refKey] || {};
  const wgRefKey = Object.keys(wg)[0];
  const wgRef = wg[wgRefKey] || {};

  const eMoic = ref.mean_moic || wgRef.mean_moic || moicDist.mean || moicDist.p50 || 0;
  const eIrr = ref.mean_xirr || wgRef.mean_xirr || irrDist.mean || irrDist.p50 || 0;
  const pLoss = ref.p_loss ?? wgRef.p_loss ?? 0;

  const collected = claim.collected_stats?.mean || 0;
  const legalCost = claim.legal_cost_stats?.mean || 0;
  const netRecovery = collected - legalCost;

  const favorColor = (v, good, bad) => v >= good ? '#34D399' : v >= bad ? COLORS.accent3 : COLORS.accent5;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: ui.space.md }}>
      <KPI label="SOC Value" value={fmtCr(claim.soc_value_cr)} sub="Statement of Claim" color={COLORS.accent1} />
      <KPI label="Win Rate" value={fmtPct(claim.win_rate)} color={favorColor(claim.win_rate, 0.6, 0.4)} />
      <KPI label="E[MOIC]" value={fmtMOIC(eMoic)} color={favorColor(eMoic, 2.0, 1.0)} />
      <KPI label="E[IRR]" value={fmtPct(eIrr)} color={favorColor(eIrr, 0.25, 0.10)} />
      <KPI label="P(Loss)" value={fmtPct(pLoss)} color={pLoss < 0.2 ? '#34D399' : COLORS.accent5} />
      <KPI label="E[Net Recovery]" value={fmtCr(netRecovery)} sub={`Collected − Legal`} color={netRecovery >= 0 ? '#34D399' : COLORS.accent5} />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
 *  § 3 — Value Chain Decomposition
 * ═══════════════════════════════════════════════════════════ */
function ValueChainDecomposition({ data }) {
  const { ui } = useUISettings();
  const decomp = data?.cashflow_analysis?.decomposition || data?.waterfall?.nominal;
  if (!decomp) return null;

  // If decomposition is an array (from cashflow_analysis)
  const steps = Array.isArray(decomp) ? decomp : [];
  if (steps.length === 0) return null;

  return (
    <Card>
      <SectionTitle number="3" title="Value Chain Decomposition" subtitle="How SOC flows through probability gates to net recovery" />
      <div style={{
        display: 'flex', alignItems: 'center', gap: 0,
        overflowX: 'auto', padding: `${ui.space.md}px 0`,
      }}>
        {steps.map((s, i) => (
          <React.Fragment key={i}>
            {i > 0 && (
              <div style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center',
                padding: '0 4px', flexShrink: 0,
              }}>
                <div style={{ color: COLORS.accent3, fontSize: ui.sizes.sm, fontWeight: 700, marginBottom: 2 }}>
                  {s.step}
                </div>
                <div style={{ color: COLORS.textMuted, fontSize: 18 }}>→</div>
              </div>
            )}
            <div style={{
              background: i === 0 ? `${COLORS.accent1}15` : i === steps.length - 1 ? `${COLORS.accent4}15` : '#0F1219',
              border: `1px solid ${i === 0 ? COLORS.accent1 + '40' : i === steps.length - 1 ? COLORS.accent4 + '40' : COLORS.cardBorder}`,
              borderRadius: 10, padding: `${ui.space.md}px ${ui.space.lg}px`,
              textAlign: 'center', minWidth: 120, flexShrink: 0,
            }}>
              <div style={{ color: COLORS.textMuted, fontSize: ui.sizes.xs, fontWeight: 600, marginBottom: 4 }}>
                {s.label?.substring(0, 30)}
              </div>
              <div style={{
                color: COLORS.textBright, fontSize: ui.sizes.lg, fontWeight: 800,
              }}>
                {fmtCr(s.value_cr)}
              </div>
              {s.factor && s.factor !== '—' && (
                <div style={{ color: COLORS.accent2, fontSize: ui.sizes.xs, marginTop: 2 }}>
                  {s.factor}
                </div>
              )}
            </div>
          </React.Fragment>
        ))}
      </div>
    </Card>
  );
}

/* ═══════════════════════════════════════════════════════════
 *  § 4 — MOIC Distribution Histogram
 * ═══════════════════════════════════════════════════════════ */
function MOICHistogram({ data }) {
  const { ui } = useUISettings();
  const moicData = data?.mc_distributions?.moic;
  if (!moicData?.bins || !moicData?.counts) return null;

  const chartData = moicData.bins.map((bin, i) => ({
    bin: +bin.toFixed(2),
    count: moicData.counts[i],
    aboveBreakeven: bin >= 1.0,
  }));

  return (
    <Card>
      <SectionTitle number="4" title="MOIC Distribution" subtitle="Monte Carlo outcome distribution. Green = profit (MOIC ≥ 1.0), Red = loss." />
      <ResponsiveContainer width="100%" height={CHART_HEIGHT.md}>
        <BarChart data={chartData} margin={{ top: 10, right: 20, left: 10, bottom: 30 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={COLORS.gridLine} />
          <XAxis
            dataKey="bin"
            tick={{ fill: COLORS.textMuted, fontSize: ui.sizes.sm, fontFamily: FONT }}
            label={{ value: 'MOIC', position: 'insideBottom', offset: -15, fill: COLORS.text, fontSize: ui.sizes.md, fontWeight: 600 }}
          />
          <YAxis
            tick={{ fill: COLORS.textMuted, fontSize: ui.sizes.sm, fontFamily: FONT }}
            label={{ value: 'Frequency', angle: -90, position: 'insideLeft', offset: 10, fill: COLORS.text, fontSize: ui.sizes.md, fontWeight: 600 }}
          />
          <Tooltip
            contentStyle={{ background: '#1F2937', border: `1px solid ${COLORS.cardBorder}`, borderRadius: 8, fontFamily: FONT }}
            labelStyle={{ color: COLORS.textBright, fontWeight: 700 }}
            itemStyle={{ color: COLORS.text }}
            formatter={(value, name) => [value, 'Count']}
            labelFormatter={(v) => `MOIC: ${fmtMOIC(v)}`}
          />
          <ReferenceLine x={1.0} stroke={COLORS.accent3} strokeWidth={2} strokeDasharray="5 5" label={{ value: 'Breakeven', fill: COLORS.accent3, fontSize: ui.sizes.sm, fontWeight: 700 }} />
          <Bar dataKey="count" radius={[4, 4, 0, 0]}>
            {chartData.map((entry, i) => (
              <Cell key={i} fill={entry.aboveBreakeven ? '#10B981' : '#EF4444'} fillOpacity={0.85} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </Card>
  );
}

/* ═══════════════════════════════════════════════════════════
 *  § 5 — MC Percentile Summary Table
 * ═══════════════════════════════════════════════════════════ */
function PercentileTable({ data }) {
  const risk = data?.risk || {};
  const moicDist = risk.moic_distribution || {};
  const irrDist = risk.irr_distribution || {};

  const headers = ['Metric', 'P5', 'P25', 'P50', 'P75', 'P95', 'Mean'];
  const rows = [
    ['MOIC', fmtMOIC(moicDist.p5), fmtMOIC(moicDist.p25), fmtMOIC(moicDist.p50), fmtMOIC(moicDist.p75), fmtMOIC(moicDist.p95), fmtMOIC(moicDist.mean)],
    ['IRR', fmtPct(irrDist.p5), fmtPct(irrDist.p25), fmtPct(irrDist.p50), fmtPct(irrDist.p75), fmtPct(irrDist.p95), fmtPct(irrDist.mean)],
  ];

  return (
    <Card>
      <SectionTitle number="5" title="MC Percentile Summary" subtitle="Distribution quantiles across all Monte Carlo paths" />
      <DataTable headers={headers} rows={rows} />
    </Card>
  );
}

/* ═══════════════════════════════════════════════════════════
 *  § 6 — J-Curve Preview
 * ═══════════════════════════════════════════════════════════ */
function JCurvePreview({ data }) {
  const { ui } = useUISettings();
  const jc = data?.jcurve_data;
  if (!jc?.scenarios) return null;

  const scenarioKey = jc.default_key || Object.keys(jc.scenarios)[0];
  const scen = jc.scenarios[scenarioKey];
  if (!scen) return null;

  // Handle both row-oriented (array of {month, median, ...}) and column-oriented ({month: [...], median: [...]}) data
  const chartData = Array.isArray(scen)
    ? scen.map(d => ({
        month: d.month,
        median: d.median ?? d.p50 ?? 0,
        p25: d.p25 ?? 0,
        p75: d.p75 ?? 0,
      }))
    : (scen.month || []).map((m, i) => ({
        month: m,
        median: scen.median?.[i] ?? 0,
        p25: scen.p25?.[i] ?? 0,
        p75: scen.p75?.[i] ?? 0,
      }));

  if (chartData.length === 0) return null;

  return (
    <Card>
      <SectionTitle number="6" title="J-Curve Preview" subtitle={`Cumulative cashflow over time (scenario: ${scenarioKey})`} />
      <ResponsiveContainer width="100%" height={280}>
        <AreaChart data={chartData} margin={{ top: 10, right: 20, left: 10, bottom: 30 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={COLORS.gridLine} />
          <XAxis
            dataKey="month"
            tick={{ fill: COLORS.textMuted, fontSize: ui.sizes.sm, fontFamily: FONT }}
            label={{ value: 'Month', position: 'insideBottom', offset: -15, fill: COLORS.text, fontSize: ui.sizes.md, fontWeight: 600 }}
          />
          <YAxis
            tick={{ fill: COLORS.textMuted, fontSize: ui.sizes.sm, fontFamily: FONT }}
            tickFormatter={(v) => `${(v / 1).toFixed(0)}`}
            label={{ value: '₹ Cr', angle: -90, position: 'insideLeft', offset: 10, fill: COLORS.text, fontSize: ui.sizes.md, fontWeight: 600 }}
          />
          <Tooltip
            contentStyle={{ background: '#1F2937', border: `1px solid ${COLORS.cardBorder}`, borderRadius: 8, fontFamily: FONT }}
            labelStyle={{ color: COLORS.textBright, fontWeight: 700 }}
            labelFormatter={(v) => `Month ${v}`}
            formatter={(v) => [fmtCr(v)]}
          />
          <ReferenceLine y={0} stroke={COLORS.accent3} strokeDasharray="3 3" />
          <Area type="monotone" dataKey="p75" stackId="band" stroke="none" fill={COLORS.accent1} fillOpacity={0.15} />
          <Area type="monotone" dataKey="p25" stackId="band_low" stroke="none" fill={COLORS.accent1} fillOpacity={0.08} />
          <Line type="monotone" dataKey="median" stroke={COLORS.accent1} strokeWidth={2.5} dot={false} />
        </AreaChart>
      </ResponsiveContainer>
    </Card>
  );
}

/* ═══════════════════════════════════════════════════════════
 *  Main Component
 * ═══════════════════════════════════════════════════════════ */
export default function ClaimExecutiveSummary({ data, stochasticData }) {
  const { ui } = useUISettings();
  const claim = data?.claims?.[0];

  if (!claim) {
    return (
      <Card>
        <div style={{ textAlign: 'center', padding: 40, color: COLORS.textMuted }}>
          No claim data available.
        </div>
      </Card>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: ui.space.xl }}>
      <ClaimIdentityCard claim={claim} />
      <ClaimKPIRow data={data} />
      <ValueChainDecomposition data={data} />
      <MOICHistogram data={data} />
      <PercentileTable data={data} />
      <JCurvePreview data={data} />
    </div>
  );
}
