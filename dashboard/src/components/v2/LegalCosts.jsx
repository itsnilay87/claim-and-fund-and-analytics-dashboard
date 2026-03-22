/**
 * LegalCosts.jsx — Tab 8: Legal cost breakdown, overrun, % of SOC.
 */

import React from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, Cell, PieChart, Pie,
  ComposedChart, Line,
} from 'recharts';
import { COLORS, FONT, CHART_COLORS, SIZES, SPACE, CHART_HEIGHT, CHART_FONT, fmtCr, fmtPct } from '../theme';
import { Card, SectionTitle, KPI, CustomTooltip } from './Shared';

export default function LegalCosts({ data }) {
  const { legal_cost_summary: lc, claims } = data;

  if (!lc) return <Card><SectionTitle title="No legal cost data" /></Card>;

  const portfolioMean = lc.portfolio_mean_total_cr;
  const overrun = lc.overrun_params;
  const totalSOC = claims.reduce((s, c) => s + c.soc_value_cr, 0);

  // Per-claim bar data
  const claimData = Object.entries(lc.per_claim).map(([cid, info]) => ({
    claim: cid.replace('TP-', ''),
    fullId: cid,
    mean: info.mean_total_cr,
    median: info.median_total_cr,
    p5: info.p5,
    p95: info.p95,
    pct_of_soc: info.pct_of_soc,
    tribunal: info.onetime_total_cr,
  }));

  // Pie data (mean cost distribution)
  const pieData = claimData.map((c, i) => ({
    name: c.claim,
    value: c.mean,
    fill: CHART_COLORS[i % CHART_COLORS.length],
  }));

  // Stage breakdown from duration_stages
  const stageData = [];
  Object.entries(lc.per_claim).forEach(([cid, info]) => {
    const stages = info.duration_stages || {};
    Object.entries(stages).forEach(([stage, rates]) => {
      const val = typeof rates === 'object' && rates.midpoint != null
        ? rates.midpoint
        : (typeof rates === 'object' && rates.fixed != null ? rates.fixed : 0);
      stageData.push({
        claim: cid.replace('TP-', ''),
        stage,
        total: val,
      });
    });
  });

  // Group stages by claim for stacked view
  const allStages = [...new Set(stageData.map(s => s.stage))];
  const stageByClaimData = claimData.map(c => {
    const row = { claim: c.claim };
    const claimStages = stageData.filter(s => s.claim === c.claim);
    for (const s of claimStages) {
      row[s.stage] = s.total;
    }
    row.tribunal = c.tribunal;
    return row;
  });

  // % of SOC chart
  const pctSOCData = claimData.map(c => ({
    claim: c.claim,
    pct_of_soc: c.pct_of_soc,
  }));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: SPACE.xl }}>
      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: SPACE.md }}>
        <KPI label="Portfolio Mean" value={fmtCr(portfolioMean)} color={COLORS.accent1} />
        <KPI label="% of Total SOC" value={fmtPct(portfolioMean / totalSOC)} color={COLORS.accent3} />
        <KPI label="E[Overrun]" value={fmtPct(overrun.expected_overrun_pct)} sub="ScaledBeta" color={COLORS.accent5} />
        <KPI label="Overrun Range" value={`${(overrun.low * 100).toFixed(0)}% to +${(overrun.high * 100).toFixed(0)}%`} color={COLORS.accent3} />
        <KPI label="Claims" value={claimData.length} color={COLORS.accent6} />
      </div>

      {/* Two column: bar + pie */}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: SPACE.lg }}>
        <Card>
          <SectionTitle number="1" title="Mean Legal Costs by Claim"
            subtitle="P5–P95 range shown. Includes counsel, expert, and tribunal fees with stochastic overrun." />
          <ResponsiveContainer width="100%" height={320}>
            <BarChart data={claimData} margin={{ top: 10, right: 20, left: 20, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={COLORS.gridLine} />
              <XAxis dataKey="claim" tick={{ fill: COLORS.textMuted, fontSize: SIZES.sm }} />
              <YAxis tick={{ fill: COLORS.textMuted, fontSize: SIZES.sm }} tickFormatter={v => '₹' + v.toFixed(1)} />
              <Tooltip cursor={{ fill: 'rgba(6,182,212,0.06)' }} content={({ active, payload }) => {
                if (!active || !payload?.[0]) return null;
                const d = payload[0].payload;
                return (
                  <div style={{ background: '#1F2937', border: `1px solid ${COLORS.cardBorder}`, borderRadius: 8, padding: '10px 14px', fontFamily: FONT }}>
                    <div style={{ color: COLORS.textBright, fontSize: SIZES.sm, fontWeight: 700 }}>{d.fullId}</div>
                    <div style={{ color: COLORS.textMuted, fontSize: SIZES.sm, marginTop: 4 }}>
                      Mean: {fmtCr(d.mean)} | Median: {fmtCr(d.median)}
                    </div>
                    <div style={{ color: COLORS.textMuted, fontSize: SIZES.sm }}>
                      P5: {fmtCr(d.p5)} | P95: {fmtCr(d.p95)}
                    </div>
                    <div style={{ color: COLORS.accent3, fontSize: SIZES.sm, marginTop: 4 }}>
                      % of SOC: {fmtPct(d.pct_of_soc)}
                    </div>
                  </div>
                );
              }} />
              <Bar dataKey="mean" name="Mean Legal Cost (₹ Cr)" radius={[6, 6, 0, 0]} barSize={36}>
                {claimData.map((d, i) => <Cell key={i} fill={CHART_COLORS[i]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card>
          <SectionTitle number="2" title="Cost Distribution" subtitle="Share of portfolio legal costs by claim" />
          <ResponsiveContainer width="100%" height={280}>
            <PieChart>
              <Pie data={pieData} cx="50%" cy="50%" innerRadius={45} outerRadius={80} paddingAngle={3} dataKey="value"
                label={({ name, value }) => `${name}: ₹${value.toFixed(1)}`} labelLine={{ stroke: COLORS.textMuted }}>
                {pieData.map((d, i) => <Cell key={i} fill={d.fill} />)}
              </Pie>
              <Tooltip cursor={{ fill: 'rgba(6,182,212,0.06)' }} content={<CustomTooltip />} />
            </PieChart>
          </ResponsiveContainer>
        </Card>
      </div>

      {/* Stage breakdown stacked bar */}
      {stageByClaimData.length > 0 && (
        <Card>
          <SectionTitle number="3" title="Total Cost Breakdown by Stage"
            subtitle="Fixed total cost per stage (₹ Cr). Counsel = ₹8 Cr total for entire arbitration. Expert (₹2 Cr) + Tribunal (₹6 Cr) = one-time at Month 0." />
          <ResponsiveContainer width="100%" height={360}>
            <BarChart data={stageByClaimData} margin={{ top: 10, right: 20, left: 20, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={COLORS.gridLine} />
              <XAxis dataKey="claim" tick={{ fill: COLORS.textMuted, fontSize: SIZES.sm }} />
              <YAxis tick={{ fill: COLORS.textMuted, fontSize: SIZES.sm }} tickFormatter={v => '₹' + v.toFixed(1)} />
              <Tooltip cursor={{ fill: 'rgba(6,182,212,0.06)' }} content={<CustomTooltip />} />
              <Legend wrapperStyle={{ fontSize: SIZES.sm, color: COLORS.textMuted }} />
              {allStages.map((stage, i) => (
                <Bar key={stage} dataKey={stage} name={stage} stackId="stages"
                  fill={CHART_COLORS[i % CHART_COLORS.length]} radius={i === allStages.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]} />
              ))}
              <Bar dataKey="tribunal" name="Tribunal (one-time)" stackId="stages" fill={COLORS.accent5} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
      )}

      {/* % of SOC */}
      <Card>
        <SectionTitle number="4" title="Legal Cost as % of SOC"
          subtitle="How much of the claim value is consumed by legal costs?" />
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={pctSOCData} margin={{ top: 10, right: 20, left: 10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={COLORS.gridLine} />
            <XAxis dataKey="claim" tick={{ fill: COLORS.textMuted, fontSize: SIZES.sm }} />
            <YAxis tick={{ fill: COLORS.textMuted, fontSize: SIZES.sm }} tickFormatter={v => fmtPct(v)} />
            <Tooltip cursor={{ fill: 'rgba(6,182,212,0.06)' }} content={<CustomTooltip />} />
            <Bar dataKey="pct_of_soc" name="% of SOC" radius={[6, 6, 0, 0]} barSize={36}>
              {pctSOCData.map((d, i) => (
                <Cell key={i} fill={d.pct_of_soc > 0.10 ? COLORS.accent5 : d.pct_of_soc > 0.05 ? COLORS.accent3 : COLORS.accent4} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </Card>

      {/* Overrun parameters card */}
      <Card>
        <SectionTitle number="5" title="Stochastic Overrun Model"
          subtitle="Legal costs are multiplied by (1 + ε) where ε ~ ScaledBeta(α, β, low, high)" />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: SPACE.lg, marginTop: 8 }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ color: COLORS.textMuted, fontSize: SIZES.xs, fontWeight: 600 }}>Alpha (α)</div>
            <div style={{ color: COLORS.accent1, fontSize: SIZES.xl, fontWeight: 800 }}>{overrun.alpha}</div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ color: COLORS.textMuted, fontSize: SIZES.xs, fontWeight: 600 }}>Beta (β)</div>
            <div style={{ color: COLORS.accent2, fontSize: SIZES.xl, fontWeight: 800 }}>{overrun.beta}</div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ color: COLORS.textMuted, fontSize: SIZES.xs, fontWeight: 600 }}>Range</div>
            <div style={{ color: COLORS.accent3, fontSize: SIZES.xl, fontWeight: 800 }}>{(overrun.low * 100).toFixed(0)}% to +{(overrun.high * 100).toFixed(0)}%</div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ color: COLORS.textMuted, fontSize: SIZES.xs, fontWeight: 600 }}>E[Overrun]</div>
            <div style={{ color: COLORS.accent5, fontSize: SIZES.xl, fontWeight: 800 }}>+{(overrun.expected_overrun_pct * 100).toFixed(0)}%</div>
          </div>
        </div>
      </Card>
    </div>
  );
}
