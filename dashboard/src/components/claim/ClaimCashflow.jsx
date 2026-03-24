/**
 * ClaimCashflow.jsx — Single-claim Cashflow & Waterfall tab (Tab 5).
 *
 * Sections:
 *   1. KPI Row: SOC, E[Collected], E[Legal Costs], E[Net Recovery]
 *   1b. Annual Resolution & Recovery Timeline (dual charts)
 *   1c. Nominal/PV Toggle for Value Decomposition
 *   2. J-Curve Fan Chart (P5/P25/P50/P75/P95)
 *   3. Waterfall Decomposition Bar Chart (Nominal / PV toggle)
 *   4. Value Decomposition: SOC → E[Collected]
 *   5. Recovery Distribution Table (percentile × gross × legal × net)
 */

import React, { useMemo, useState } from 'react';
import {
  ComposedChart, Area, Line, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, Cell, BarChart, Legend,
} from 'recharts';
import { COLORS, FONT, CHART_HEIGHT, useUISettings, fmtCr, fmtPct, fmtMOIC, BAR_CURSOR } from '../../theme';
import { Card, SectionTitle, KPI, DataTable, CustomTooltip } from '../Shared';

/* ── local formatters ── */
const fmt = (v, dec = 2) => `₹${Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: dec, maximumFractionDigits: dec })} Cr`;
const pct = (v, dec = 1) => `${(Number(v || 0) * 100).toFixed(dec)}%`;

/* ═══════════════════════════════════════════════════════════
 *  § 1 — KPI Row
 * ═══════════════════════════════════════════════════════════ */
function CashflowKPIs({ data, mode }) {
  const claim = data?.claims?.[0] || {};
  const waterfall = mode === 'nominal' ? data?.waterfall?.nominal : data?.waterfall?.present_value;
  const nomWaterfall = data?.waterfall?.nominal || {};
  const { ui } = useUISettings();

  const soc = claim.soc_value_cr || nomWaterfall.soc_cr || 0;
  const collected = waterfall?.prob_adjusted_cr || claim.collected_stats?.mean || claim.mean_collected_cr || 0;
  const legal = waterfall?.legal_costs_cr || claim.legal_cost_stats?.mean || claim.mean_legal_costs_cr || 0;
  const net = waterfall?.net_after_legal_cr || (collected - legal);
  const discountRate = data?.waterfall?.present_value?.discount_rate || 0.07;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: ui.space.md }}>
      <KPI label="SOC Value" value={fmtCr(soc)} sub="Statement of Claim" color={COLORS.accent1} />
      <KPI label="E[Collected]" value={fmtCr(collected)} sub={mode === 'nominal' ? 'Expected Recovery' : `PV @ ${pct(discountRate, 0)}`} color={COLORS.accent4} />
      <KPI label="E[Legal Costs]" value={fmtCr(legal)} sub="Total Legal" color={COLORS.accent5} />
      <KPI label="E[Net Recovery]" value={fmtCr(net)} sub="Collected − Legal" color={net >= 0 ? '#34D399' : COLORS.accent5} />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
 *  § 1b — Annual Resolution & Recovery Timeline
 * ═══════════════════════════════════════════════════════════ */
function AnnualResolutionTimeline({ data }) {
  const { ui } = useUISettings();
  const timeline = data?.cashflow_analysis?.annual_timeline || [];

  if (timeline.length === 0) {
    return null;
  }

  return (
    <Card>
      <SectionTitle number="1c" title="Annual Resolution & Recovery Timeline"
        subtitle="When do claims resolve? Expected recovery in ₹ Crore per year." />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
        {/* Resolution % Chart */}
        <div>
          <div style={{ fontSize: ui.sizes.sm, fontWeight: 600, color: COLORS.textMuted, marginBottom: 12, textAlign: 'center' }}>
            Claims Resolution Timeline (%)
          </div>
          <ResponsiveContainer width="100%" height={280}>
            <ComposedChart data={timeline.map(t => ({
              year: `Y${t.year}`,
              resolving: +(t.pct_resolving * 100).toFixed(1),
              cumulative: +(t.pct_cumulative * 100).toFixed(1),
            }))}>
              <CartesianGrid strokeDasharray="3 3" stroke={COLORS.gridLine} />
              <XAxis dataKey="year" tick={{ fill: COLORS.textMuted, fontSize: 11, fontFamily: FONT }} />
              <YAxis tick={{ fill: COLORS.textMuted, fontSize: 11, fontFamily: FONT }} unit="%" domain={[0, 100]} />
              <Tooltip
                cursor={{ fill: 'rgba(6,182,212,0.06)' }}
                contentStyle={{ background: '#1F2937', border: `1px solid ${COLORS.cardBorder}`, borderRadius: 8, fontFamily: FONT }}
                labelStyle={{ color: COLORS.textBright, fontWeight: 700 }}
                itemStyle={{ color: COLORS.text }}
                formatter={(v) => [`${v}%`]}
              />
              <Bar dataKey="resolving" name="This Year %" fill={COLORS.accent1} opacity={0.7} radius={[4, 4, 0, 0]} cursor={BAR_CURSOR || 'pointer'} />
              <Line dataKey="cumulative" name="Cumulative %" stroke={COLORS.accent3} strokeWidth={2.5} dot={{ r: 4, fill: COLORS.accent3 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        {/* Recovery ₹ Chart */}
        <div>
          <div style={{ fontSize: ui.sizes.sm, fontWeight: 600, color: COLORS.textMuted, marginBottom: 12, textAlign: 'center' }}>
            Expected Recovery by Year (₹ Crore)
          </div>
          <ResponsiveContainer width="100%" height={280}>
            <ComposedChart data={timeline.map(t => ({
              year: `Y${t.year}`,
              recovery: +t.e_recovery_cr,
              cumulRecovery: +t.cumul_recovery_cr,
            }))}>
              <CartesianGrid strokeDasharray="3 3" stroke={COLORS.gridLine} />
              <XAxis dataKey="year" tick={{ fill: COLORS.textMuted, fontSize: 11, fontFamily: FONT }} />
              <YAxis tick={{ fill: COLORS.textMuted, fontSize: 11, fontFamily: FONT }} />
              <Tooltip
                cursor={{ fill: 'rgba(6,182,212,0.06)' }}
                contentStyle={{ background: '#1F2937', border: `1px solid ${COLORS.cardBorder}`, borderRadius: 8, fontFamily: FONT }}
                labelStyle={{ color: COLORS.textBright, fontWeight: 700 }}
                itemStyle={{ color: COLORS.text }}
                formatter={(v) => [`₹${Number(v).toLocaleString('en-IN', { maximumFractionDigits: 1 })} Cr`]}
              />
              <Bar dataKey="recovery" name="E[Recovery] this year" fill={COLORS.accent4} opacity={0.7} radius={[4, 4, 0, 0]} cursor={BAR_CURSOR || 'pointer'} />
              <Line dataKey="cumulRecovery" name="Cumulative E[Recovery]" stroke={COLORS.accent3} strokeWidth={2.5} dot={{ r: 4, fill: COLORS.accent3 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>
    </Card>
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
 *  § 3 — Nominal/PV Value Decomposition Bar Chart
 * ═══════════════════════════════════════════════════════════ */
function NominalValueDecompositionChart({ data, mode }) {
  const { ui } = useUISettings();
  const waterfall = data?.waterfall || {};
  const pvView = waterfall.present_value || {};
  const isNominal = mode === 'nominal';

  const bars = useMemo(() => {
    const src = isNominal ? waterfall.nominal : waterfall.present_value;
    if (!src) return [];

    const soc = src.soc_cr || 0;
    const collected = src.prob_adjusted_cr || src.e_collected_cr || 0;
    const legal = src.legal_costs_cr || 0;
    const net = src.net_after_legal_cr || (collected - legal);
    const tailPct = src.reference_tail_pct || 0.20;
    const tataTail = src.tata_receives_cr || 0;
    const fundProfit = src.fund_net_profit_cr || (net - tataTail);

    const steps = [];
    
    // Step 1: SOC
    steps.push({ name: 'SOC', value: soc, delta: soc, color: COLORS.accent1, type: 'total' });

    if (!isNominal && pvView.pv_soc_cr) {
      // PV Discount step
      const pvDiscount = pvView.pv_soc_cr - soc;
      steps.push({ name: 'PV Discount', value: pvView.pv_soc_cr, delta: pvDiscount, color: COLORS.accent5, type: 'subtract' });
      // Win/Quantum Adj from PV SOC
      const winAdj = collected - pvView.pv_soc_cr;
      steps.push({ name: 'Win + Quantum Adj', value: collected, delta: winAdj, color: winAdj < 0 ? COLORS.accent5 : COLORS.accent4, type: 'subtract' });
    } else {
      // Nominal: direct from SOC → collected
      const winAdj = collected - soc;
      steps.push({ name: 'Win + Quantum Adj', value: collected, delta: winAdj, color: winAdj < 0 ? COLORS.accent5 : COLORS.accent4, type: 'subtract' });
    }

    steps.push({ name: 'E[Recovery]', value: collected, delta: collected, color: COLORS.accent4, type: 'subtotal' });
    steps.push({ name: 'Legal Costs', value: net, delta: -legal, color: COLORS.accent5, type: 'subtract' });
    steps.push({ name: 'Net After Legal', value: net, delta: net, color: COLORS.accent2, type: 'subtotal' });
    steps.push({ name: `Tata Tail (${pct(tailPct, 0)})`, value: fundProfit, delta: -tataTail, color: COLORS.accent5, type: 'subtract' });
    steps.push({ name: 'Fund Profit', value: fundProfit, delta: fundProfit, color: fundProfit >= 0 ? COLORS.accent4 : COLORS.accent5, type: 'total' });

    // Build waterfall bars with invisible base + visible bar
    let running = 0;
    return steps.map((s, i) => {
      if (s.type === 'total' || s.type === 'subtotal') {
        running = s.value;
        return { name: s.name, base: 0, bar: s.value, value: s.value, fill: s.color, type: s.type };
      }
      const start = running;
      running = s.value;
      return {
        name: s.name,
        base: Math.min(start, running),
        bar: Math.abs(s.delta),
        value: s.delta,
        fill: s.color,
        type: s.type,
      };
    });
  }, [waterfall, isNominal, pvView]);

  if (bars.length === 0) {
    return (
      <Card>
        <SectionTitle number="1" title="Value Decomposition" subtitle="No waterfall data available" />
        <div style={{ color: COLORS.textMuted, textAlign: 'center', padding: 40 }}>N/A</div>
      </Card>
    );
  }

  return (
    <Card>
      <SectionTitle
        number="1"
        title={isNominal ? 'Nominal Value Decomposition' : `PV Decomposition @ ${pct(pvView.discount_rate || 0.07, 1)}`}
        subtitle={isNominal
          ? 'SOC → Win/Quantum Adj → Legal Costs → Tata Tail → Fund Profit'
          : `SOC → PV Discount (~${(pvView.avg_timeline_months || 0).toFixed(0)}m) → Win/Quantum Adj → Legal → Tata → Fund`}
      />

      <ResponsiveContainer width="100%" height={ui.chartHeight.lg}>
        <BarChart data={bars} margin={{ top: 20, right: 30, left: 30, bottom: 60 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={COLORS.gridLine} />
          <XAxis
            dataKey="name"
            tick={{ fill: COLORS.textMuted, fontSize: ui.sizes.sm, fontFamily: FONT, fontWeight: 600 }}
            interval={0}
            angle={-20}
            textAnchor="end"
            height={60}
          />
          <YAxis
            tick={{ fill: COLORS.textMuted, fontSize: ui.sizes.sm, fontFamily: FONT }}
            tickFormatter={v => `₹${v.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`}
            width={60}
          />
          <Tooltip
            cursor={{ fill: 'rgba(6,182,212,0.06)' }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const d = payload[0]?.payload;
              return (
                <div style={{
                  background: COLORS.card,
                  border: `1px solid ${COLORS.cardBorder}`,
                  borderRadius: 8,
                  padding: '10px 14px',
                  fontFamily: FONT,
                }}>
                  <div style={{ color: COLORS.textBright, fontWeight: 700, fontSize: ui.sizes.sm, marginBottom: 4 }}>{d.name}</div>
                  <div style={{ color: COLORS.text, fontSize: ui.sizes.sm }}>
                    {d.type === 'subtract' ? 'Change' : 'Value'}: ₹{(d.value || 0).toLocaleString('en-IN', { maximumFractionDigits: 1 })} Cr
                  </div>
                </div>
              );
            }}
          />
          <Bar dataKey="base" stackId="waterfall" fill="transparent" />
          <Bar dataKey="bar" stackId="waterfall" radius={[4, 4, 0, 0]}>
            {bars.map((entry, idx) => (
              <Cell key={idx} fill={entry.fill} fillOpacity={entry.type === 'subtotal' ? 0.6 : 0.9} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      {/* Legend */}
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
  );
}

/* ═══════════════════════════════════════════════════════════
 *  § 4 — Value Decomposition: SOC → E[Collected]
 * ═══════════════════════════════════════════════════════════ */
function ValueDecomposition({ data }) {
  const { ui } = useUISettings();
  const decomp = data?.cashflow_analysis?.decomposition || [];
  const claim = data?.claims?.[0] || {};
  const waterfall = data?.waterfall?.nominal || {};

  if (decomp.length === 0) {
    return null;
  }

  return (
    <Card>
      <SectionTitle number="4" title="Value Decomposition: SOC → E[Collected]"
        subtitle="Step-by-step walkthrough showing how SOC becomes expected collected amount." />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 0, marginTop: 16 }}>
        {decomp.map((step, i) => {
          const isResult = step.step.includes('E[Collected]');
          const isLegal = step.step.includes('Legal');
          const isRestart = step.step.includes('RESTART');
          const bgColor = isResult ? '#10B98115' : (isLegal ? '#EF444415' : (isRestart ? '#06B6D415' : 'transparent'));
          const borderColor = isResult ? COLORS.accent4 : (isLegal ? COLORS.accent5 : (isRestart ? '#06B6D4' : COLORS.cardBorder));
          const stepColor = isResult ? COLORS.accent4 : (isLegal ? COLORS.accent5 : (isRestart ? '#06B6D4' : COLORS.accent1));
          
          return (
            <div key={i} style={{
              display: 'grid',
              gridTemplateColumns: '160px 280px 120px 140px 1fr',
              gap: 0,
              padding: '14px 16px',
              background: bgColor,
              borderLeft: `4px solid ${borderColor}`,
              borderBottom: `1px solid ${COLORS.cardBorder}`,
              alignItems: 'center',
            }}>
              <div style={{
                fontSize: 13,
                fontWeight: 800,
                color: stepColor,
                fontFamily: FONT,
              }}>{step.step}</div>
              <div style={{ fontSize: 12, color: COLORS.text }}>{step.label}</div>
              <div style={{
                fontSize: 12,
                fontWeight: 700,
                textAlign: 'center',
                color: COLORS.accent3,
                fontFamily: 'monospace',
              }}>{step.factor}</div>
              <div style={{
                fontSize: 14,
                fontWeight: 700,
                textAlign: 'right',
                color: isResult ? COLORS.accent4 : (isLegal ? COLORS.accent5 : COLORS.textBright),
              }}>{fmt(step.value_cr, 1)}</div>
              <div style={{
                fontSize: 11,
                color: COLORS.textMuted,
                paddingLeft: 16,
                lineHeight: 1.4,
              }}>{step.note}</div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

/* ═══════════════════════════════════════════════════════════
 *  § 5 — Recovery Distribution Table
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
      <SectionTitle number="5" title="Recovery Distribution"
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
  const [valueMode, setValueMode] = useState('nominal');
  const pvView = data?.waterfall?.present_value || {};
  const discountRate = pvView.discount_rate || 0.07;

  if (!data) {
    return <div style={{ color: COLORS.textMuted, textAlign: 'center', padding: 60 }}>No data available</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: ui.space.xl }}>
      {/* Nominal/PV Toggle */}
      <div style={{ display: 'flex', gap: ui.space.sm }}>
        {[
          { key: 'nominal', label: 'Nominal (No Discounting)' },
          { key: 'pv', label: `Present Value @ ${pct(discountRate, 1)}` },
        ].map(m => (
          <button key={m.key} onClick={() => setValueMode(m.key)} style={{
            padding: '10px 22px',
            borderRadius: 8,
            border: 'none',
            cursor: 'pointer',
            fontFamily: FONT,
            fontSize: ui.sizes.base,
            fontWeight: valueMode === m.key ? 700 : 500,
            color: valueMode === m.key ? '#fff' : COLORS.textMuted,
            background: valueMode === m.key ? COLORS.gradient1 : COLORS.card,
            transition: 'all 0.2s ease',
          }}>
            {m.label}
          </button>
        ))}
      </div>

      {/* KPIs (responsive to toggle) */}
      <CashflowKPIs data={data} mode={valueMode} />

      {/* Annual Resolution & Recovery Timeline */}
      <AnnualResolutionTimeline data={data} />

      {/* Nominal Value Decomposition (Waterfall Bar Chart) */}
      <NominalValueDecompositionChart data={data} mode={valueMode} />

      {/* Value Decomposition: SOC → E[Collected] */}
      <ValueDecomposition data={data} />

      {/* J-Curve Fan Chart */}
      <JCurveFanChart data={data} />

      {/* Recovery Distribution Table */}
      <RecoveryDistributionTable data={data} />
    </div>
  );
}
