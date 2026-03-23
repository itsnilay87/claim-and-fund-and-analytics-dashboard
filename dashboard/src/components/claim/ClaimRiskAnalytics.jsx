/**
 * ClaimRiskAnalytics.jsx — Single-claim Risk Analytics tab (Tab 6).
 *
 * Sections:
 *   1. KPI Row (4 cards): Median MOIC, Median IRR, VaR(1%), P50 Duration
 *   2. MOIC Percentile Bar Chart
 *   3. IRR Percentile Bar Chart
 *   4. Capital at Risk Timeline (area chart)
 *   5. Stress Scenarios Table
 */

import React, { useMemo } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  Cell, ReferenceLine, AreaChart, Area,
} from 'recharts';
import { COLORS, FONT, CHART_HEIGHT, useUISettings, fmtCr, fmtPct, fmtMOIC, fmtMo } from '../../theme';
import { Card, SectionTitle, KPI, DataTable, CustomTooltip } from '../Shared';

const PCTL_KEYS = ['p5', 'p10', 'p25', 'p50', 'p75', 'p90', 'p95'];

/* ═══════════════════════════════════════════════════════════
 *  § 1 — KPI Row
 * ═══════════════════════════════════════════════════════════ */
function RiskKPIs({ data }) {
  const { ui } = useUISettings();
  const risk = data?.risk || {};
  const moicDist = risk.moic_distribution || {};
  const irrDist = risk.irr_distribution || {};
  const durDist = risk.duration_distribution || {};
  const claim = data?.claims?.[0] || {};

  const medianMoic = moicDist.p50 ?? 0;
  const medianIrr = irrDist.p50 ?? 0;
  const var1 = moicDist.p1 ?? 0;
  const p50Dur = durDist.portfolio?.p50 ?? durDist.per_claim?.[0]?.p50 ?? claim.mean_duration_months ?? 0;

  const favorColor = (v, good, bad) => v >= good ? '#34D399' : v >= bad ? COLORS.accent3 : COLORS.accent5;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: ui.space.md }}>
      <KPI label="Median MOIC" value={fmtMOIC(medianMoic)} sub="P50 Return Multiple" color={favorColor(medianMoic, 2.0, 1.0)} />
      <KPI label="Median IRR" value={fmtPct(medianIrr)} sub="P50 Internal Rate" color={favorColor(medianIrr, 0.25, 0.10)} />
      <KPI label="VaR (1%)" value={fmtMOIC(var1)} sub="1st Percentile MOIC" color={var1 >= 1.0 ? '#34D399' : COLORS.accent5} />
      <KPI label="P50 Duration" value={fmtMo(p50Dur)} sub="Median Timeline" color={COLORS.accent6} />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
 *  § 2 — MOIC Percentile Bar Chart
 * ═══════════════════════════════════════════════════════════ */
function MOICPercentileChart({ data }) {
  const { ui } = useUISettings();
  const moicDist = data?.risk?.moic_distribution || {};

  const chartData = useMemo(() =>
    PCTL_KEYS.filter(k => moicDist[k] != null).map(k => ({
      label: k.toUpperCase(),
      value: moicDist[k],
    })),
    [moicDist]
  );

  if (chartData.length === 0) {
    return (
      <Card>
        <SectionTitle number="2" title="MOIC Distribution" subtitle="No MOIC distribution data" />
        <div style={{ color: COLORS.textMuted, textAlign: 'center', padding: 40 }}>N/A</div>
      </Card>
    );
  }

  return (
    <Card>
      <SectionTitle number="2" title="MOIC Percentile Distribution"
        subtitle="Return multiples across probability bands — breakeven at 1.0×" />
      <ResponsiveContainer width="100%" height={ui.chartHeight.md}>
        <BarChart data={chartData} margin={{ top: 10, right: 30, left: 20, bottom: 10 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={COLORS.gridLine} />
          <XAxis dataKey="label" tick={{ fill: COLORS.textMuted, fontSize: ui.sizes.sm, fontFamily: FONT }} />
          <YAxis
            tick={{ fill: COLORS.textMuted, fontSize: ui.sizes.sm, fontFamily: FONT }}
            tickFormatter={v => `${v.toFixed(1)}×`}
          />
          <Tooltip content={<CustomTooltip />} />
          <ReferenceLine y={1.0} stroke={COLORS.accent3} strokeDasharray="6 3" strokeWidth={2} label={{ value: 'Breakeven 1.0×', fill: COLORS.accent3, fontSize: ui.sizes.sm }} />
          <Bar dataKey="value" name="MOIC" radius={[4, 4, 0, 0]}>
            {chartData.map((d, i) => (
              <Cell key={i} fill={d.value >= 1.0 ? COLORS.accent4 : COLORS.accent5} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </Card>
  );
}

/* ═══════════════════════════════════════════════════════════
 *  § 3 — IRR Percentile Bar Chart
 * ═══════════════════════════════════════════════════════════ */
function IRRPercentileChart({ data }) {
  const { ui } = useUISettings();
  const irrDist = data?.risk?.irr_distribution || {};

  const chartData = useMemo(() =>
    PCTL_KEYS.filter(k => irrDist[k] != null).map(k => ({
      label: k.toUpperCase(),
      value: irrDist[k],
    })),
    [irrDist]
  );

  if (chartData.length === 0) {
    return (
      <Card>
        <SectionTitle number="3" title="IRR Distribution" subtitle="No IRR distribution data" />
        <div style={{ color: COLORS.textMuted, textAlign: 'center', padding: 40 }}>N/A</div>
      </Card>
    );
  }

  return (
    <Card>
      <SectionTitle number="3" title="IRR Percentile Distribution"
        subtitle="Internal rate of return across probability bands — reference at 0%" />
      <ResponsiveContainer width="100%" height={ui.chartHeight.md}>
        <BarChart data={chartData} margin={{ top: 10, right: 30, left: 20, bottom: 10 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={COLORS.gridLine} />
          <XAxis dataKey="label" tick={{ fill: COLORS.textMuted, fontSize: ui.sizes.sm, fontFamily: FONT }} />
          <YAxis
            tick={{ fill: COLORS.textMuted, fontSize: ui.sizes.sm, fontFamily: FONT }}
            tickFormatter={v => `${(v * 100).toFixed(0)}%`}
          />
          <Tooltip content={<CustomTooltip />} />
          <ReferenceLine y={0} stroke={COLORS.accent3} strokeDasharray="6 3" strokeWidth={2} label={{ value: '0%', fill: COLORS.accent3, fontSize: ui.sizes.sm }} />
          <Bar dataKey="value" name="IRR" radius={[4, 4, 0, 0]}>
            {chartData.map((d, i) => (
              <Cell key={i} fill={d.value >= 0 ? COLORS.accent4 : COLORS.accent5} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </Card>
  );
}

/* ═══════════════════════════════════════════════════════════
 *  § 4 — Capital at Risk Timeline
 * ═══════════════════════════════════════════════════════════ */
function CapitalAtRiskTimeline({ data }) {
  const { ui } = useUISettings();
  const timeline = data?.risk?.capital_at_risk_timeline;

  if (!timeline || timeline.length === 0) return null;

  return (
    <Card>
      <SectionTitle number="4" title="Capital at Risk Timeline"
        subtitle="Cumulative legal spend deployed over time — P50 (solid) and P95 (dashed)" />
      <ResponsiveContainer width="100%" height={ui.chartHeight.md}>
        <AreaChart data={timeline} margin={{ top: 10, right: 30, left: 20, bottom: 10 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={COLORS.gridLine} />
          <XAxis
            dataKey="month"
            tick={{ fill: COLORS.textMuted, fontSize: ui.sizes.sm, fontFamily: FONT }}
            label={{ value: 'Months', position: 'insideBottom', offset: -4, fill: COLORS.text, fontSize: ui.sizes.md, fontWeight: 600 }}
          />
          <YAxis
            tick={{ fill: COLORS.textMuted, fontSize: ui.sizes.sm, fontFamily: FONT }}
            tickFormatter={v => `₹${v.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`}
            label={{ value: 'Deployed Capital (₹ Cr)', angle: -90, position: 'insideLeft', offset: 10, fill: COLORS.text, fontSize: ui.sizes.md, fontWeight: 600 }}
          />
          <Tooltip content={<CustomTooltip />} />
          <Area dataKey="p50_deployed_cr" stroke={COLORS.accent6} fill={COLORS.accent6} fillOpacity={0.15} strokeWidth={2} name="P50 Deployed" dot={false} />
          <Area dataKey="p95_deployed_cr" stroke={COLORS.accent5} fill={COLORS.accent5} fillOpacity={0.08} strokeWidth={1.5} strokeDasharray="6 3" name="P95 Deployed" dot={false} />
        </AreaChart>
      </ResponsiveContainer>
    </Card>
  );
}

/* ═══════════════════════════════════════════════════════════
 *  § 5 — Stress Scenarios Table
 * ═══════════════════════════════════════════════════════════ */
function StressScenarios({ data }) {
  const stress = data?.risk?.stress_scenarios;
  if (!stress || stress.length === 0) return null;

  const headers = ['Scenario', 'MOIC', 'IRR', 'P(Loss)', 'Description'];
  const rows = stress.map(s => [
    s.name || 'N/A',
    fmtMOIC(s.portfolio_moic ?? s.moic ?? 0),
    fmtPct(s.portfolio_irr ?? s.irr ?? 0),
    s.p_loss != null ? fmtPct(s.p_loss) : '—',
    s.description || '',
  ]);

  return (
    <Card>
      <SectionTitle number="5" title="Stress Scenarios"
        subtitle="MOIC and IRR under adverse conditions" />
      <DataTable headers={headers} rows={rows} />
    </Card>
  );
}

/* ═══════════════════════════════════════════════════════════
 *  MAIN EXPORT
 * ═══════════════════════════════════════════════════════════ */
export default function ClaimRiskAnalytics({ data }) {
  const { ui } = useUISettings();

  if (!data) {
    return <div style={{ color: COLORS.textMuted, textAlign: 'center', padding: 60 }}>No data available</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: ui.space.xl }}>
      <RiskKPIs data={data} />
      <MOICPercentileChart data={data} />
      <IRRPercentileChart data={data} />
      <CapitalAtRiskTimeline data={data} />
      <StressScenarios data={data} />
    </div>
  );
}
