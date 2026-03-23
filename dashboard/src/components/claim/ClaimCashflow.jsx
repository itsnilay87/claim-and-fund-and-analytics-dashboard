/**
 * ClaimCashflow.jsx — Single-claim Cashflow & Waterfall tab (Tab 5).
 *
 * Sections:
 *   1. KPI Row: SOC, E[Collected], E[Legal Costs], E[Net Recovery]
 *   2. J-Curve Fan Chart (P5/P25/P50/P75/P95)
 *   3. Waterfall Decomposition Bar Chart (Nominal / PV toggle)
 *   4. Recovery Distribution Table (percentile × gross × legal × net)
 */

import React, { useMemo, useState } from 'react';
import {
  ComposedChart, Area, Line, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, Cell, BarChart,
} from 'recharts';
import { COLORS, FONT, CHART_HEIGHT, useUISettings, fmtCr, fmtPct, fmtMOIC } from '../../theme';
import { Card, SectionTitle, KPI, DataTable, CustomTooltip } from '../Shared';

/* ═══════════════════════════════════════════════════════════
 *  § 1 — KPI Row
 * ═══════════════════════════════════════════════════════════ */
function CashflowKPIs({ data }) {
  const claim = data?.claims?.[0] || {};
  const waterfall = data?.waterfall?.nominal || {};
  const { ui } = useUISettings();

  const soc = claim.soc_value_cr || waterfall.soc_cr || 0;
  const collected = claim.collected_stats?.mean || claim.mean_collected_cr || waterfall.prob_adjusted_cr || 0;
  const legal = claim.legal_cost_stats?.mean || claim.mean_legal_costs_cr || waterfall.legal_costs_cr || 0;
  const net = collected - legal;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: ui.space.md }}>
      <KPI label="SOC Value" value={fmtCr(soc)} sub="Statement of Claim" color={COLORS.accent1} />
      <KPI label="E[Collected]" value={fmtCr(collected)} sub="Expected Recovery" color={COLORS.accent4} />
      <KPI label="E[Legal Costs]" value={fmtCr(legal)} sub="Total Legal" color={COLORS.accent5} />
      <KPI label="E[Net Recovery]" value={fmtCr(net)} sub="Collected − Legal" color={net >= 0 ? '#34D399' : COLORS.accent5} />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
 *  § 2 — J-Curve Fan Chart
 * ═══════════════════════════════════════════════════════════ */
function JCurveFanChart({ data }) {
  const { ui } = useUISettings();
  const jcurve = data?.jcurve_data || {};
  const scenarios = jcurve.scenarios || {};

  const chartData = useMemo(() => {
    // Pick first available scenario key
    const key = jcurve.default_key || Object.keys(scenarios)[0];
    if (!key || !scenarios[key]) return [];
    return scenarios[key].map(d => ({
      month: d.month,
      p5: d.p5,
      p25: d.p25,
      p50: d.median ?? d.p50,
      p75: d.p75,
      p95: d.p95,
    }));
  }, [jcurve, scenarios]);

  if (chartData.length === 0) {
    return (
      <Card>
        <SectionTitle number="2" title="J-Curve Fan Chart" subtitle="No J-curve data available" />
        <div style={{ color: COLORS.textMuted, textAlign: 'center', padding: 40 }}>N/A</div>
      </Card>
    );
  }

  return (
    <Card>
      <SectionTitle number="2" title="J-Curve Fan Chart"
        subtitle="Cumulative cashflow over time — shaded P25–P75 band with P50 median" />
      <ResponsiveContainer width="100%" height={ui.chartHeight.lg}>
        <ComposedChart data={chartData} margin={{ top: 10, right: 30, left: 20, bottom: 10 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={COLORS.gridLine} />
          <XAxis
            dataKey="month"
            tick={{ fill: COLORS.textMuted, fontSize: ui.sizes.sm, fontFamily: FONT }}
            label={{ value: 'Months', position: 'insideBottom', offset: -4, fill: COLORS.text, fontSize: ui.sizes.md, fontWeight: 600 }}
          />
          <YAxis
            tick={{ fill: COLORS.textMuted, fontSize: ui.sizes.sm, fontFamily: FONT }}
            label={{ value: 'Cumulative ₹ Cr', angle: -90, position: 'insideLeft', offset: 10, fill: COLORS.text, fontSize: ui.sizes.md, fontWeight: 600 }}
            tickFormatter={v => `${v.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`}
          />
          <Tooltip content={<CustomTooltip />} />
          <ReferenceLine y={0} stroke={COLORS.accent3} strokeDasharray="4 4" strokeWidth={1} />

          {/* P5-P95 outer band */}
          <Area dataKey="p95" stroke="none" fill={COLORS.accent1} fillOpacity={0.08} name="P95" />
          <Area dataKey="p5" stroke="none" fill={COLORS.bg} fillOpacity={1} name="P5 fill" />

          {/* P25-P75 inner band */}
          <Area dataKey="p75" stroke="none" fill={COLORS.accent1} fillOpacity={0.18} name="P75" />
          <Area dataKey="p25" stroke="none" fill={COLORS.bg} fillOpacity={1} name="P25 fill" />

          {/* Lines */}
          <Line dataKey="p5" stroke={COLORS.accent5} strokeWidth={1} strokeDasharray="4 4" dot={false} name="P5" />
          <Line dataKey="p25" stroke={COLORS.accent6} strokeWidth={1} strokeDasharray="3 3" dot={false} name="P25" />
          <Line dataKey="p50" stroke={COLORS.accent4} strokeWidth={2.5} dot={false} name="P50 (Median)" />
          <Line dataKey="p75" stroke={COLORS.accent6} strokeWidth={1} strokeDasharray="3 3" dot={false} name="P75" />
          <Line dataKey="p95" stroke={COLORS.accent2} strokeWidth={1} strokeDasharray="4 4" dot={false} name="P95" />
        </ComposedChart>
      </ResponsiveContainer>
    </Card>
  );
}

/* ═══════════════════════════════════════════════════════════
 *  § 3 — Waterfall Decomposition Bar Chart
 * ═══════════════════════════════════════════════════════════ */
function WaterfallDecomposition({ data }) {
  const { ui } = useUISettings();
  const [mode, setMode] = useState('nominal');
  const waterfall = data?.waterfall || {};

  const bars = useMemo(() => {
    const src = mode === 'nominal' ? waterfall.nominal : waterfall.present_value;
    if (!src) return [];

    const soc = src.soc_cr || 0;
    const collected = src.prob_adjusted_cr || src.e_collected_cr || 0;
    const legal = src.legal_costs_cr || 0;
    const net = src.net_after_legal_cr || (collected - legal);

    // Compute intermediate steps
    const winAdj = collected - soc;  // negative: discount from SOC to collected
    const pvDiscount = mode === 'nominal' ? 0 : (src.pv_soc_cr || soc) - soc;

    const steps = [
      { name: 'SOC', value: soc, delta: soc, color: COLORS.accent1 },
    ];

    if (mode !== 'nominal' && pvDiscount !== 0) {
      steps.push({ name: 'PV Discount', value: soc + pvDiscount, delta: pvDiscount, color: COLORS.accent3 });
    }

    const baseAfterPV = mode !== 'nominal' ? (src.pv_soc_cr || soc) : soc;
    steps.push({ name: 'Win/Quantum Adj', value: collected, delta: collected - baseAfterPV, color: collected < baseAfterPV ? COLORS.accent5 : COLORS.accent4 });
    steps.push({ name: 'E[Recovery]', value: collected, delta: collected, color: COLORS.accent4 });
    steps.push({ name: 'Legal Costs', value: net, delta: -legal, color: COLORS.accent5 });
    steps.push({ name: 'Net', value: net, delta: net, color: net >= 0 ? '#34D399' : COLORS.accent5 });

    // Build waterfall bars with invisible base + visible delta
    return steps.map((s, i) => {
      if (i === 0 || s.name === 'E[Recovery]' || s.name === 'Net') {
        return { name: s.name, base: 0, delta: s.value, fill: s.color };
      }
      const prevValue = steps[i - 1].value;
      const base = s.delta >= 0 ? prevValue : prevValue + s.delta;
      return { name: s.name, base: Math.max(0, base), delta: Math.abs(s.delta), fill: s.color };
    });
  }, [waterfall, mode]);

  if (bars.length === 0) {
    return (
      <Card>
        <SectionTitle number="3" title="Waterfall Decomposition" subtitle="No waterfall data available" />
        <div style={{ color: COLORS.textMuted, textAlign: 'center', padding: 40 }}>N/A</div>
      </Card>
    );
  }

  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
        <SectionTitle number="3" title="Waterfall Decomposition"
          subtitle="SOC → Recovery → Legal Costs → Net" />
        <div style={{ display: 'flex', gap: 6 }}>
          {['nominal', 'pv'].map(m => (
            <button key={m} onClick={() => setMode(m)} style={{
              padding: '6px 14px', borderRadius: 6, border: 'none', cursor: 'pointer',
              fontFamily: FONT, fontSize: ui.sizes.sm, fontWeight: mode === m ? 700 : 500,
              color: mode === m ? '#fff' : COLORS.textMuted,
              background: mode === m ? COLORS.gradient1 : COLORS.card,
            }}>
              {m === 'nominal' ? 'Nominal' : 'Present Value'}
            </button>
          ))}
        </div>
      </div>

      <ResponsiveContainer width="100%" height={ui.chartHeight.md}>
        <BarChart data={bars} margin={{ top: 10, right: 30, left: 20, bottom: 10 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={COLORS.gridLine} />
          <XAxis dataKey="name" tick={{ fill: COLORS.textMuted, fontSize: ui.sizes.sm, fontFamily: FONT }} />
          <YAxis
            tick={{ fill: COLORS.textMuted, fontSize: ui.sizes.sm, fontFamily: FONT }}
            tickFormatter={v => `₹${v.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`}
          />
          <Tooltip content={<CustomTooltip />} />
          <Bar dataKey="base" stackId="wf" fill="transparent" name="base" />
          <Bar dataKey="delta" stackId="wf" name="Value (₹ Cr)" radius={[4, 4, 0, 0]}>
            {bars.map((b, i) => (
              <Cell key={i} fill={b.fill} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </Card>
  );
}

/* ═══════════════════════════════════════════════════════════
 *  § 4 — Recovery Distribution Table
 * ═══════════════════════════════════════════════════════════ */
function RecoveryDistributionTable({ data }) {
  const dist = data?.cashflow_analysis?.distribution;
  if (!dist) return null;

  const percentiles = ['p1', 'p5', 'p10', 'p25', 'p50', 'p75', 'p90', 'p95', 'p99', 'mean'];
  const labels = { p1: 'P1', p5: 'P5', p10: 'P10', p25: 'P25', p50: 'P50', p75: 'P75', p90: 'P90', p95: 'P95', p99: 'P99', mean: 'Mean' };

  const headers = ['Percentile', 'Gross Collected (₹ Cr)', 'Legal Costs (₹ Cr)', 'Net (₹ Cr)'];
  const rows = percentiles
    .filter(p => dist[p])
    .map(p => {
      const d = dist[p];
      return [
        labels[p] || p,
        fmtCr(d.gross_cr ?? 0),
        fmtCr(d.legal_cr ?? 0),
        fmtCr(d.net_cr ?? 0),
      ];
    });

  return (
    <Card>
      <SectionTitle number="4" title="Recovery Distribution"
        subtitle="Percentile breakdown of gross collected, legal costs, and net recovery" />
      <DataTable headers={headers} rows={rows} />
    </Card>
  );
}

/* ═══════════════════════════════════════════════════════════
 *  MAIN EXPORT
 * ═══════════════════════════════════════════════════════════ */
export default function ClaimCashflow({ data }) {
  const { ui } = useUISettings();

  if (!data) {
    return <div style={{ color: COLORS.textMuted, textAlign: 'center', padding: 60 }}>No data available</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: ui.space.xl }}>
      <CashflowKPIs data={data} />
      <JCurveFanChart data={data} />
      <WaterfallDecomposition data={data} />
      <RecoveryDistributionTable data={data} />
    </div>
  );
}
