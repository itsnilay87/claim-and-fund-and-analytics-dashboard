/**
 * QuantumTimeline.jsx — Tab 3: Quantum bands, timeline boxplots, 96m breach.
 */

import React from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, ComposedChart, Line, Area,
  ReferenceLine, Cell,
} from 'recharts';
import { COLORS, FONT, CHART_COLORS, SIZES, SPACE, CHART_HEIGHT, CHART_FONT, fmtCr, fmtPct, fmtMo } from '../theme';
import { Card, SectionTitle, KPI, CustomTooltip } from './Shared';
import { getClaimDisplayName, truncateClaimName, buildClaimNameMap } from '../../utils/claimNames';

export default function QuantumTimeline({ data }) {
  const { quantum_summary: qs, timeline_summary: ts, claims } = data;
  const nameMap = buildClaimNameMap(claims);

  const totalSOC = claims.reduce((s, c) => s + c.soc_value_cr, 0);
  const totalEQ = claims.reduce((s, c) => s + c.expected_quantum_cr, 0);

  // Quantum band data
  const bandData = qs.bands.map(b => ({
    band: `${(b.low * 100).toFixed(0)}–${(b.high * 100).toFixed(0)}%`,
    probability: b.probability,
    midpoint: b.midpoint,
  }));

  // Per-claim quantum data
  const claimQuantumData = claims.map((c, i) => {
    const q = qs.per_claim[c.claim_id];
    const displayName = nameMap[c.claim_id] || getClaimDisplayName(c);
    return {
      claim: truncateClaimName(displayName, 18),
      fullName: displayName,
      soc: c.soc_value_cr,
      eq: q?.eq_cr || 0,
      mc_mean: q?.mc_quantum_stats?.mean || 0,
      mc_p5: q?.mc_quantum_stats?.p5 || 0,
      mc_p95: q?.mc_quantum_stats?.p95 || 0,
    };
  });

  // Timeline data per claim
  const timelineData = claims.map((c, i) => {
    const t = ts.per_claim[c.claim_id];
    const displayName = nameMap[c.claim_id] || getClaimDisplayName(c);
    return {
      claim: truncateClaimName(displayName, 18),
      fullName: displayName,
      mean: t?.mean || 0,
      median: t?.median || 0,
      p5: t?.p5 || 0,
      p25: t?.p25 || 0,
      p75: t?.p75 || 0,
      p95: t?.p95 || 0,
      pct_above_96m: t?.pct_above_96m || 0,
      jurisdiction: c.jurisdiction,
    };
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: SPACE.xl }}>
      {/* KPI Row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: SPACE.md }}>
        <KPI label="E[Q|Win] % SOC" value={fmtPct(qs.expected_quantum_pct_of_soc)} color={COLORS.accent1} />
        <KPI label="Recovery Ratio" value={fmtPct(totalEQ / totalSOC)} sub="E[Q] / SOC" color={COLORS.accent2} />
        <KPI label="Total E[Q]" value={fmtCr(totalEQ)} color={COLORS.accent4} />
        <KPI label="Max Timeline" value={`${ts.max_timeline_months}m`} color={COLORS.accent3} />
        <KPI label="5 Quantum Bands" value={qs.bands.length} color={COLORS.accent6} />
      </div>

      {/* Quantum Bands */}
      <Card>
        <SectionTitle number="1" title="Quantum Band Distribution" subtitle="Probability of each quantum band (% of SOC), conditional on win" />
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={bandData} margin={{ top: 10, right: 20, left: 10, bottom: 20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={COLORS.gridLine} />
            <XAxis dataKey="band" tick={{ fill: COLORS.textMuted, fontSize: SIZES.sm }}>
            </XAxis>
            <YAxis tick={{ fill: COLORS.textMuted, fontSize: SIZES.sm }} tickFormatter={v => fmtPct(v)} />
            <Tooltip cursor={{ fill: 'rgba(6,182,212,0.06)' }} content={<CustomTooltip />} />
            <Bar dataKey="probability" name="Probability" radius={[6, 6, 0, 0]} barSize={48}>
              {bandData.map((d, i) => (
                <Cell key={i} fill={CHART_COLORS[i]} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </Card>

      {/* Per-claim quantum: SOC vs E[Q] vs MC mean */}
      <Card>
        <SectionTitle number="2" title="Per-Claim Quantum: SOC vs E[Q] vs MC Mean" subtitle="MC mean quantum includes paths with Q=0 (when arb is lost)" />
        <ResponsiveContainer width="100%" height={340}>
          <BarChart data={claimQuantumData} margin={{ top: 10, right: 20, left: 10, bottom: 40 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={COLORS.gridLine} />
            <XAxis dataKey="claim" tick={{ fill: COLORS.textMuted, fontSize: SIZES.sm }} interval={0} angle={-20} textAnchor="end" height={60} />
            <YAxis tick={{ fill: COLORS.textMuted, fontSize: SIZES.sm }} tickFormatter={v => '₹' + v.toFixed(0)} />
            <Tooltip cursor={{ fill: 'rgba(6,182,212,0.06)' }} content={<CustomTooltip />} />
            <Legend wrapperStyle={{ fontSize: SIZES.sm, color: COLORS.textMuted }} />
            <Bar dataKey="soc" name="SOC (₹ Cr)" fill={COLORS.accent1} radius={[3, 3, 0, 0]} barSize={16} />
            <Bar dataKey="eq" name="E[Q|Win] (₹ Cr)" fill={COLORS.accent2} radius={[3, 3, 0, 0]} barSize={16} />
            <Bar dataKey="mc_mean" name="MC Mean Q (₹ Cr)" fill={COLORS.accent4} radius={[3, 3, 0, 0]} barSize={16} />
          </BarChart>
        </ResponsiveContainer>
      </Card>

      {/* Timeline range chart (simulated boxplots with bars) */}
      <Card>
        <SectionTitle number="3" title="Timeline Distribution by Claim" subtitle="P5–P95 range with mean marker. Includes pipeline + challenge + payment delay." />
        <ResponsiveContainer width="100%" height={Math.max(280, timelineData.length * 60)}>
          <ComposedChart data={timelineData} layout="vertical" margin={{ top: 10, right: 30, left: 20, bottom: 10 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={COLORS.gridLine} />
            <XAxis type="number" tick={{ fill: COLORS.textMuted, fontSize: SIZES.sm }} tickFormatter={v => v + 'm'} domain={[0, 'auto']} />
            <YAxis dataKey="claim" type="category" tick={{ fill: COLORS.textBright, fontSize: SIZES.sm, fontWeight: 600 }} width={140} />
            <Tooltip cursor={{ fill: 'rgba(6,182,212,0.06)' }} content={({ active, payload }) => {
              if (!active || !payload?.[0]) return null;
              const d = payload[0].payload;
              return (
                <div style={{ background: '#1F2937', border: `1px solid ${COLORS.cardBorder}`, borderRadius: 8, padding: '10px 14px', fontFamily: FONT }}>
                  <div style={{ color: COLORS.textBright, fontSize: SIZES.sm, fontWeight: 700 }}>{d.fullName || d.claim} ({d.jurisdiction})</div>
                  <div style={{ color: COLORS.textMuted, fontSize: SIZES.sm, marginTop: 4 }}>
                    Mean: {fmtMo(d.mean)} | Median: {fmtMo(d.median)}
                  </div>
                  <div style={{ color: COLORS.textMuted, fontSize: SIZES.sm }}>
                    P5: {fmtMo(d.p5)} | P25: {fmtMo(d.p25)} | P75: {fmtMo(d.p75)} | P95: {fmtMo(d.p95)}
                  </div>
                  <div style={{ color: d.pct_above_96m > 0.05 ? COLORS.accent5 : COLORS.accent4, fontSize: SIZES.sm, fontWeight: 600, marginTop: 4 }}>
                    Above 96m: {fmtPct(d.pct_above_96m)}
                  </div>
                </div>
              );
            }} />
            <ReferenceLine x={96} stroke={COLORS.accent5} strokeDasharray="8 4" strokeWidth={1.5}
              label={{ value: '96m cap', fill: COLORS.accent5, fontSize: SIZES.xs, position: 'top' }} />
            {/* P5-P95 range as stacked light bar */}
            <Bar dataKey="p95" name="P95" fill={COLORS.accent1} fillOpacity={0.15} radius={[0, 4, 4, 0]} barSize={18} />
            {/* Mean line */}
            <Line dataKey="mean" type="monotone" stroke={COLORS.accent1} strokeWidth={0} dot={{ fill: COLORS.accent1, r: 6, stroke: COLORS.bg, strokeWidth: 2 }} />
          </ComposedChart>
        </ResponsiveContainer>
      </Card>

      {/* 96-month breach analysis */}
      <Card>
        <SectionTitle number="4" title="96-Month Breach Probability" subtitle="Fraction of MC paths exceeding the re-arbitration cutoff" />
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={timelineData} margin={{ top: 10, right: 20, left: 10, bottom: 40 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={COLORS.gridLine} />
            <XAxis dataKey="claim" tick={{ fill: COLORS.textMuted, fontSize: SIZES.sm }} interval={0} angle={-20} textAnchor="end" height={60} />
            <YAxis tick={{ fill: COLORS.textMuted, fontSize: SIZES.sm }} tickFormatter={v => fmtPct(v)} domain={[0, dataMax => Math.max(0.1, dataMax * 1.2)]} />
            <Tooltip cursor={{ fill: 'rgba(6,182,212,0.06)' }} content={<CustomTooltip />} />
            <ReferenceLine y={0.05} stroke={COLORS.accent3} strokeDasharray="6 3" strokeWidth={1.5}
              label={{ value: '5% threshold', fill: COLORS.accent3, fontSize: SIZES.xs, position: 'top' }} />
            <Bar dataKey="pct_above_96m" name="P(>96m)" radius={[6, 6, 0, 0]} barSize={36}>
              {timelineData.map((d, i) => (
                <Cell key={i} fill={d.pct_above_96m > 0.05 ? COLORS.accent5 : COLORS.accent4} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </Card>
    </div>
  );
}
