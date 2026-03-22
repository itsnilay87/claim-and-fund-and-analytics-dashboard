/**
 * QuantumTimeline.jsx — Quantum Distribution + Timeline Analysis tab.
 *
 * Section 1 — Quantum Distribution:
 *   Quantum band visualization, per-claim SOC vs E[Q], table with % of SOC.
 *
 * Section 2 — Timeline Analysis:
 *   Per-claim duration range chart, stage breakdown, portfolio duration.
 */

import React from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, ComposedChart, Line,
  ReferenceLine, Cell,
} from 'recharts';
import { COLORS, FONT, CHART_COLORS, useUISettings, fmtCr, fmtPct, fmtMo } from '../theme';
import { Card, SectionTitle, KPI, CustomTooltip, DataTable } from './Shared';

const NODATA = <span style={{ color: COLORS.textMuted }}>Data not available</span>;

export default function QuantumTimeline({ data }) {
  const { ui } = useUISettings();
  const qs = data?.quantum_summary;
  const ts = data?.timeline_summary;
  const claims = data?.claims || [];
  const riskDuration = data?.risk?.duration_distribution;

  if (!qs && !ts) return <Card>{NODATA}</Card>;

  const totalSOC = claims.reduce((s, c) => s + (c.soc_value_cr || 0), 0);

  /* ── Quantum band data ── */
  const bandData = (qs?.bands || []).map(b => ({
    band: `${(b.low * 100).toFixed(0)}–${(b.high * 100).toFixed(0)}%`,
    probability: b.probability,
    midpoint: b.midpoint,
  }));

  /* ── Per-claim quantum table ── */
  const perClaimQ = qs?.per_claim || {};
  const claimQuantumRows = claims.map(c => {
    const q = perClaimQ[c.claim_id] || {};
    return {
      id: c.claim_id,
      name: c.name || c.claim_id,
      soc: c.soc_value_cr || 0,
      eq: q.eq_cr || c.mean_quantum_cr || 0,
      eqPct: q.eq_pct || (c.mean_quantum_cr && c.soc_value_cr > 0 ? c.mean_quantum_cr / c.soc_value_cr : 0),
    };
  });

  const claimQuantumBarData = claimQuantumRows.map(r => ({
    claim: r.id.replace('TP-', ''),
    soc: r.soc,
    eq: r.eq,
  }));

  /* ── Timeline data per claim ── */
  const perClaimT = ts?.per_claim || {};
  const timelineData = claims.map(c => {
    const t = perClaimT[c.claim_id] || c.duration_stats || {};
    return {
      claim: c.claim_id.replace('TP-', ''),
      fullId: c.claim_id,
      mean: t.mean || 0,
      median: t.median || 0,
      p5: t.p5 || 0,
      p25: t.p25 || 0,
      p75: t.p75 || 0,
      p95: t.p95 || 0,
      jurisdiction: c.jurisdiction || '—',
    };
  });

  /* ── Portfolio duration ── */
  const portfolioDuration = riskDuration?.portfolio || {};
  const maxClaimDuration = Math.max(...timelineData.map(d => d.p95), 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: ui.space.xl }}>

      {/* KPI Row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: ui.space.md }}>
        <KPI label="E[Q|Win] % SOC" value={fmtPct(qs?.expected_quantum_pct || 0)} color={COLORS.accent1} />
        <KPI label="Total SOC" value={fmtCr(totalSOC)} color={COLORS.accent6} />
        <KPI label="Quantum Bands" value={bandData.length} color={COLORS.accent3} />
        <KPI label="Max P95 Duration" value={fmtMo(maxClaimDuration)} color={COLORS.accent5} />
        {portfolioDuration.p50 != null && (
          <KPI label="Portfolio P50 Duration" value={fmtMo(portfolioDuration.p50)} color={COLORS.accent2} />
        )}
      </div>

      {/* ═══ SECTION 1: QUANTUM DISTRIBUTION ═══ */}

      {/* Quantum Bands */}
      {bandData.length > 0 && (
        <Card>
          <SectionTitle number="1" title="Quantum Band Distribution"
            subtitle="Probability of each quantum band (% of SOC), conditional on win." />
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={bandData} margin={{ top: 10, right: 20, left: 10, bottom: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={COLORS.gridLine} />
              <XAxis dataKey="band" tick={{ fill: COLORS.textMuted, fontSize: ui.sizes.sm }} />
              <YAxis tick={{ fill: COLORS.textMuted, fontSize: ui.sizes.sm }} tickFormatter={v => fmtPct(v)} />
              <Tooltip cursor={{ fill: 'rgba(6,182,212,0.06)' }} content={<CustomTooltip />} />
              <Bar dataKey="probability" name="Probability" radius={[6, 6, 0, 0]} barSize={48}>
                {bandData.map((_, i) => <Cell key={i} fill={CHART_COLORS[i]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>
      )}

      {/* Per-claim quantum: SOC vs E[Q] */}
      {claimQuantumBarData.length > 0 && (
        <Card>
          <SectionTitle number="2" title="Per-Claim Quantum: SOC vs E[Q|Win]"
            subtitle="Expected quantum conditional on winning, compared to Statement of Claim value." />
          <ResponsiveContainer width="100%" height={320}>
            <BarChart data={claimQuantumBarData} margin={{ top: 10, right: 20, left: 10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={COLORS.gridLine} />
              <XAxis dataKey="claim" tick={{ fill: COLORS.textMuted, fontSize: ui.sizes.sm }} />
              <YAxis tick={{ fill: COLORS.textMuted, fontSize: ui.sizes.sm }} tickFormatter={v => '₹' + v.toFixed(0)} />
              <Tooltip cursor={{ fill: 'rgba(6,182,212,0.06)' }} content={<CustomTooltip />} />
              <Legend wrapperStyle={{ fontSize: ui.sizes.sm, color: COLORS.textMuted }} />
              <Bar dataKey="soc" name="SOC (₹ Cr)" fill={COLORS.accent1} radius={[3, 3, 0, 0]} barSize={20} />
              <Bar dataKey="eq" name="E[Q|Win] (₹ Cr)" fill={COLORS.accent2} radius={[3, 3, 0, 0]} barSize={20} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
      )}

      {/* Per-claim quantum table */}
      <Card>
        <SectionTitle number="3" title="Quantum Summary Table"
          subtitle="Per-claim SOC, expected quantum, and quantum as percentage of SOC." />
        <DataTable
          headers={['Claim', 'SOC (₹ Cr)', 'E[Q|Win] (₹ Cr)', 'E[Q] % of SOC']}
          rows={claimQuantumRows.map(r => [
            r.id,
            fmtCr(r.soc),
            fmtCr(r.eq),
            fmtPct(r.eqPct),
          ])}
        />
      </Card>

      {/* ═══ SECTION 2: TIMELINE ANALYSIS ═══ */}

      {/* Duration range chart */}
      {timelineData.length > 0 && (
        <Card>
          <SectionTitle number="4" title="Timeline Distribution by Claim"
            subtitle="P5–P95 range with mean marker. Horizontal bar shows duration in months." />
          <ResponsiveContainer width="100%" height={Math.max(300, timelineData.length * 60 + 80)}>
            <ComposedChart data={timelineData} layout="vertical" margin={{ top: 10, right: 30, left: 80, bottom: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={COLORS.gridLine} />
              <XAxis type="number" tick={{ fill: COLORS.textMuted, fontSize: ui.sizes.sm }} tickFormatter={v => v + 'm'} domain={[0, 'auto']} />
              <YAxis dataKey="claim" type="category" tick={{ fill: COLORS.textMuted, fontSize: ui.sizes.sm }} width={70} />
              <Tooltip cursor={{ fill: 'rgba(6,182,212,0.06)' }} content={({ active, payload }) => {
                if (!active || !payload?.[0]) return null;
                const d = payload[0].payload;
                return (
                  <div style={{ background: '#1F2937', border: `1px solid ${COLORS.cardBorder}`, borderRadius: 8, padding: '10px 14px', fontFamily: FONT }}>
                    <div style={{ color: COLORS.textBright, fontSize: ui.sizes.sm, fontWeight: 700 }}>{d.fullId} ({d.jurisdiction})</div>
                    <div style={{ color: COLORS.textMuted, fontSize: ui.sizes.sm, marginTop: 4 }}>
                      Mean: {fmtMo(d.mean)} | Median: {fmtMo(d.median)}
                    </div>
                    <div style={{ color: COLORS.textMuted, fontSize: ui.sizes.sm }}>
                      P5: {fmtMo(d.p5)} | P25: {fmtMo(d.p25)} | P75: {fmtMo(d.p75)} | P95: {fmtMo(d.p95)}
                    </div>
                  </div>
                );
              }} />
              <ReferenceLine x={96} stroke={COLORS.accent5} strokeDasharray="8 4" strokeWidth={1.5}
                label={{ value: '96m cap', fill: COLORS.accent5, fontSize: ui.sizes.xs, position: 'top' }} />
              <Bar dataKey="p95" name="P95" fill={COLORS.accent1} fillOpacity={0.15} radius={[0, 4, 4, 0]} barSize={18} />
              <Line dataKey="mean" type="monotone" stroke={COLORS.accent1} strokeWidth={0}
                dot={{ fill: COLORS.accent1, r: 6, stroke: COLORS.bg, strokeWidth: 2 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </Card>
      )}

      {/* Portfolio Duration Percentiles */}
      {portfolioDuration.p50 != null && (
        <Card>
          <SectionTitle number="5" title="Portfolio Duration (Last Claim Resolved)"
            subtitle="Percentile distribution of when the entire portfolio resolves." />
          <DataTable
            headers={['Percentile', 'Duration (months)']}
            rows={['p5', 'p10', 'p25', 'p50', 'p75', 'p90', 'p95'].filter(k => portfolioDuration[k] != null).map(k => [
              k.toUpperCase(),
              fmtMo(portfolioDuration[k]),
            ])}
          />
        </Card>
      )}

      {/* Per-Claim Duration Table */}
      <Card>
        <SectionTitle number="6" title="Per-Claim Duration Statistics"
          subtitle="Duration in months across MC simulation paths." />
        <DataTable
          headers={['Claim', 'Jurisdiction', 'Mean', 'Median', 'P5', 'P25', 'P75', 'P95']}
          rows={timelineData.map(d => [
            d.fullId,
            <span style={{
              padding: '2px 8px', borderRadius: 4, fontSize: 10,
              background: d.jurisdiction.includes('domestic') ? '#1e3a5f' : '#3b1f5e',
              color: d.jurisdiction.includes('domestic') ? COLORS.accent1 : COLORS.accent2,
            }}>{d.jurisdiction}</span>,
            fmtMo(d.mean),
            fmtMo(d.median),
            fmtMo(d.p5),
            fmtMo(d.p25),
            fmtMo(d.p75),
            fmtMo(d.p95),
          ])}
        />
      </Card>
    </div>
  );
}
