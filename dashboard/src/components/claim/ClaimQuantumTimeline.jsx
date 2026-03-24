/**
 * ClaimQuantumTimeline.jsx — Single-claim Tab 3: Quantum & Timeline.
 *
 * Sections:
 *   1. KPI Row (5 cards): E[Q|Win]%SOC, SOC, #Bands, P50 Duration, P95 Duration
 *   2. Per-Claim Quantum: SOC vs E[Q] vs MC Mean (grouped bar)
 *   3. Quantum Band Distribution (Recharts BarChart)
 *   4. Timeline Distribution (histogram from duration_stats)
 *   5. Duration Stage Breakdown Table
 *   6. Duration Percentile Table
 */

import React from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, ReferenceLine, Legend,
} from 'recharts';
import { COLORS, FONT, CHART_COLORS, CHART_HEIGHT, useUISettings, fmtCr, fmtPct, fmtMo } from '../../theme';
import { Card, SectionTitle, KPI } from '../Shared';

export default function ClaimQuantumTimeline({ data }) {
  const { ui } = useUISettings();
  const qs = data?.quantum_summary;
  const ts = data?.timeline_summary;
  const claim = data?.claims?.[0];

  if (!claim || !qs) {
    return <Card><SectionTitle title="No quantum data available" /></Card>;
  }

  const soc = claim.soc_value_cr;
  const bands = qs.bands || [];
  const durStats = claim.duration_stats || {};
  const claimId = claim.claim_id;

  // Per-claim quantum info
  const perClaimQ = qs.per_claim?.[claimId] || {};
  // Per-claim timeline info
  const perClaimT = ts?.per_claim?.[claimId] || {};

  // Quantum band chart data
  const bandData = bands.map(b => ({
    band: `${(b.low * 100).toFixed(0)}–${(b.high * 100).toFixed(0)}%`,
    probability: b.probability,
    midpoint: b.midpoint,
  }));

  // Duration stages from timeline or legal cost summary
  const durationStages = [];
  const pipeline = perClaimT.pipeline || claim.pipeline || [];
  if (pipeline.length > 0) {
    // Build stage info from whatever data we have
    const lcPerClaim = data?.legal_cost_summary?.per_claim?.[claimId];
    const stageInfo = lcPerClaim?.duration_stages || {};
    pipeline.forEach(stage => {
      const info = stageInfo[stage];
      const low = info?.low ?? null;
      const high = info?.high ?? null;
      const mid = info?.midpoint ?? (low != null && high != null ? (low + high) / 2 : info?.fixed ?? null);
      durationStages.push({
        stage: stage.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
        low,
        high,
        expected: mid,
      });
    });
  }

  // Duration percentile rows
  const percentiles = ['p5', 'p25', 'p50', 'p75', 'p95'];
  const pctData = percentiles.map(p => ({
    label: p.toUpperCase(),
    months: durStats[p] ?? perClaimT[p] ?? null,
  })).filter(r => r.months != null);

  const tdStyle = {
    padding: '10px 14px',
    borderBottom: `1px solid ${COLORS.cardBorder}`,
    fontSize: ui.sizes.sm,
    fontFamily: FONT,
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: ui.space.xl }}>

      {/* ═══ § 1 — KPI Row ═══ */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: ui.space.md }}>
        <KPI
          label="E[Q|Win] % SOC"
          value={fmtPct(qs.expected_quantum_pct_of_soc)}
          sub="Conditional on win"
          color={COLORS.accent1}
        />
        <KPI
          label="SOC Value"
          value={fmtCr(soc)}
          sub="Statement of Claim"
          color={COLORS.accent2}
        />
        <KPI
          label="Quantum Bands"
          value={bands.length}
          sub="Discrete outcome bands"
          color={COLORS.accent4}
        />
        <KPI
          label="P50 Duration"
          value={fmtMo(durStats.p50 ?? durStats.median ?? perClaimT.median)}
          sub="Median timeline"
          color={COLORS.accent3}
        />
        <KPI
          label="P95 Duration"
          value={fmtMo(durStats.p95 ?? perClaimT.p95)}
          sub="Worst-case timeline"
          color={COLORS.accent5}
        />
      </div>

      {/* ═══ § 2 — Per-Claim Quantum: SOC vs E[Q] vs MC Mean ═══ */}
      <Card>
        <SectionTitle number="1" title="Per-Claim Quantum: SOC vs E[Q] vs MC Mean"
          subtitle="Comparing Statement of Claim value, expected quantum (conditional on win), and Monte Carlo mean quantum" />
        {(() => {
          const mcMean = perClaimQ.mc_quantum_stats?.mean || null;
          const eqCr = perClaimQ.eq_cr || claim.expected_quantum_cr || 0;
          const compData = [
            { name: 'SOC', value: soc, fill: COLORS.accent1 },
            { name: 'E[Q|Win]', value: eqCr, fill: COLORS.accent4 },
            ...(mcMean != null ? [{ name: 'MC Mean', value: mcMean, fill: COLORS.accent2 }] : []),
          ];
          return (
            <ResponsiveContainer width="100%" height={CHART_HEIGHT.md}>
              <BarChart data={compData} margin={{ top: 20, right: 30, left: 20, bottom: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={COLORS.gridLine} />
                <XAxis dataKey="name" tick={{ fill: COLORS.textBright, fontSize: ui.sizes.sm, fontWeight: 700 }} />
                <YAxis tick={{ fill: COLORS.textMuted, fontSize: ui.sizes.sm }} tickFormatter={v => `₹${(v / 1).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`} />
                <Tooltip
                  cursor={{ fill: 'rgba(6,182,212,0.06)' }}
                  contentStyle={{ background: '#1F2937', border: `1px solid ${COLORS.cardBorder}`, borderRadius: 8, fontFamily: FONT }}
                  labelStyle={{ color: COLORS.textBright, fontWeight: 700 }}
                  formatter={(v) => [fmtCr(v), 'Value']}
                />
                <Bar dataKey="value" name="₹ Cr" radius={[6, 6, 0, 0]} barSize={64}>
                  {compData.map((d, i) => (
                    <Cell key={i} fill={d.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          );
        })()}
        {/* Comparison summary */}
        <div style={{
          marginTop: ui.space.sm, padding: '10px 14px', borderRadius: 8,
          background: '#0c1622', border: `1px solid ${COLORS.accent4}40`,
          display: 'flex', justifyContent: 'center', gap: ui.space.xl, flexWrap: 'wrap',
        }}>
          <span style={{ color: COLORS.textMuted, fontSize: ui.sizes.sm }}>
            SOC: <span style={{ color: COLORS.accent1, fontWeight: 700 }}>{fmtCr(soc)}</span>
          </span>
          <span style={{ color: COLORS.textMuted, fontSize: ui.sizes.sm }}>
            E[Q|Win]: <span style={{ color: COLORS.accent4, fontWeight: 700 }}>{fmtCr(perClaimQ.eq_cr || claim.expected_quantum_cr || 0)}</span>
            {' '}({fmtPct((perClaimQ.eq_cr || claim.expected_quantum_cr || 0) / soc)} of SOC)
          </span>
          {perClaimQ.mc_quantum_stats?.mean != null && (
            <span style={{ color: COLORS.textMuted, fontSize: ui.sizes.sm }}>
              MC Mean: <span style={{ color: COLORS.accent2, fontWeight: 700 }}>{fmtCr(perClaimQ.mc_quantum_stats.mean)}</span>
              {' '}({fmtPct(perClaimQ.mc_quantum_stats.mean / soc)} of SOC)
            </span>
          )}
        </div>
      </Card>

      {/* ═══ § 3 — Quantum Band Distribution ═══ */}
      <Card>
        <SectionTitle number="2" title="Quantum Band Distribution"
          subtitle="Probability of each quantum outcome band (% of SOC), conditional on arbitration win" />
        <ResponsiveContainer width="100%" height={CHART_HEIGHT.md}>
          <BarChart data={bandData} margin={{ top: 10, right: 20, left: 10, bottom: 20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={COLORS.gridLine} />
            <XAxis dataKey="band" tick={{ fill: COLORS.textMuted, fontSize: ui.sizes.sm }} />
            <YAxis tick={{ fill: COLORS.textMuted, fontSize: ui.sizes.sm }} tickFormatter={v => fmtPct(v)} />
            <Tooltip
              cursor={{ fill: 'rgba(6,182,212,0.06)' }}
              contentStyle={{ background: '#1F2937', border: `1px solid ${COLORS.cardBorder}`, borderRadius: 8, fontFamily: FONT }}
              labelStyle={{ color: COLORS.textBright, fontWeight: 700 }}
              formatter={(v, name) => [fmtPct(v), 'Probability']}
            />
            <Bar dataKey="probability" name="Probability" radius={[6, 6, 0, 0]} barSize={48}>
              {bandData.map((d, i) => (
                <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>

        {/* MC quantum stats if available */}
        {perClaimQ.mc_quantum_stats && (
          <div style={{
            marginTop: ui.space.md, padding: '10px 14px', borderRadius: 8,
            background: '#0c1622', border: `1px solid ${COLORS.accent2}40`,
          }}>
            <div style={{ color: COLORS.accent2, fontSize: ui.sizes.xs, fontWeight: 700, marginBottom: 6 }}>
              MC Quantum Statistics (₹ Cr)
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: ui.space.sm }}>
              {[
                { label: 'Mean', val: perClaimQ.mc_quantum_stats.mean },
                { label: 'Median', val: perClaimQ.mc_quantum_stats.median },
                { label: 'P5', val: perClaimQ.mc_quantum_stats.p5 },
                { label: 'P25', val: perClaimQ.mc_quantum_stats.p25 },
                { label: 'P75', val: perClaimQ.mc_quantum_stats.p75 },
                { label: 'P95', val: perClaimQ.mc_quantum_stats.p95 },
              ].map(s => (
                <div key={s.label} style={{ textAlign: 'center' }}>
                  <div style={{ color: COLORS.textMuted, fontSize: ui.sizes.xs, fontWeight: 600 }}>{s.label}</div>
                  <div style={{ color: COLORS.textBright, fontSize: ui.sizes.md, fontWeight: 700 }}>
                    {s.val != null ? fmtCr(s.val) : '—'}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </Card>

      {/* ═══ § 4 — Timeline Distribution ═══ */}
      <Card>
        <SectionTitle number="3" title="Timeline Distribution"
          subtitle="Monte Carlo simulated duration distribution with key percentile markers" />
        {(() => {
          const ds = durStats;
          const pt = perClaimT;
          const mean = ds.mean ?? pt.mean;
          const p5 = ds.p5 ?? pt.p5;
          const p25 = ds.p25 ?? pt.p25;
          const p50 = ds.p50 ?? ds.median ?? pt.median;
          const p75 = ds.p75 ?? pt.p75;
          const p95 = ds.p95 ?? pt.p95;
          if (p5 == null || p95 == null) {
            return <div style={{ color: COLORS.textMuted, textAlign: 'center', padding: 40 }}>No timeline distribution data available.</div>;
          }
          // Build synthetic histogram from percentiles
          const markers = [
            { label: 'P5', val: p5, color: '#34D399' },
            { label: 'P25', val: p25, color: COLORS.accent4 },
            { label: 'P50', val: p50, color: COLORS.accent1 },
            { label: 'P75', val: p75, color: COLORS.accent3 },
            { label: 'P95', val: p95, color: COLORS.accent5 },
          ].filter(m => m.val != null);
          // Create bins spanning p5 to p95 range
          const lo = Math.floor(p5);
          const hi = Math.ceil(p95);
          const nBins = Math.min(20, Math.max(8, hi - lo));
          const binWidth = (hi - lo) / nBins;
          const histBins = [];
          for (let i = 0; i < nBins; i++) {
            const bLo = lo + i * binWidth;
            const bHi = lo + (i + 1) * binWidth;
            const bMid = (bLo + bHi) / 2;
            // Approximate density using normal-like shape centered on mean with spread from p5-p95
            const sigma = (p95 - p5) / 3.29;
            const z = (bMid - mean) / sigma;
            const density = Math.exp(-0.5 * z * z);
            histBins.push({
              range: `${bLo.toFixed(0)}–${bHi.toFixed(0)}`,
              months: bMid,
              density: density,
            });
          }
          // Normalize
          const maxDensity = Math.max(...histBins.map(b => b.density));
          histBins.forEach(b => { b.density = b.density / maxDensity; });
          return (
            <>
              <ResponsiveContainer width="100%" height={CHART_HEIGHT.md}>
                <BarChart data={histBins} margin={{ top: 20, right: 30, left: 20, bottom: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={COLORS.gridLine} />
                  <XAxis dataKey="range" tick={{ fill: COLORS.textMuted, fontSize: 10 }} label={{ value: 'Duration (months)', fill: COLORS.textMuted, position: 'insideBottom', offset: -10, fontSize: 11 }} />
                  <YAxis tick={{ fill: COLORS.textMuted, fontSize: ui.sizes.sm }} tickFormatter={() => ''} label={{ value: 'Relative Frequency', fill: COLORS.textMuted, angle: -90, position: 'insideLeft', fontSize: 11 }} />
                  <Tooltip
                    cursor={{ fill: 'rgba(6,182,212,0.06)' }}
                    contentStyle={{ background: '#1F2937', border: `1px solid ${COLORS.cardBorder}`, borderRadius: 8, fontFamily: FONT }}
                    labelStyle={{ color: COLORS.textBright, fontWeight: 700 }}
                    formatter={(v, name) => [(v * 100).toFixed(0) + '%', 'Relative Frequency']}
                  />
                  {markers.map(m => (
                    <ReferenceLine key={m.label} x={histBins.reduce((best, b) => Math.abs(b.months - m.val) < Math.abs(best.months - m.val) ? b : best, histBins[0]).range}
                      stroke={m.color} strokeDasharray="4 3" strokeWidth={2}
                      label={{ value: `${m.label}: ${fmtMo(m.val)}`, fill: m.color, fontSize: 10, fontWeight: 700, position: 'top' }} />
                  ))}
                  <Bar dataKey="density" name="Frequency" radius={[4, 4, 0, 0]} barSize={32}>
                    {histBins.map((d, i) => (
                      <Cell key={i} fill={d.months <= p50 ? COLORS.accent4 : COLORS.accent3} fillOpacity={0.85} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              {/* Percentile marker legend */}
              <div style={{
                display: 'flex', justifyContent: 'center', gap: ui.space.lg, flexWrap: 'wrap',
                marginTop: ui.space.sm, padding: '8px 14px', borderRadius: 8,
                background: '#0c1622', border: `1px solid ${COLORS.cardBorder}`,
              }}>
                {markers.map(m => (
                  <span key={m.label} style={{ color: COLORS.textMuted, fontSize: ui.sizes.xs }}>
                    <span style={{ color: m.color, fontWeight: 700 }}>■ {m.label}</span>: {fmtMo(m.val)}
                  </span>
                ))}
                {mean != null && (
                  <span style={{ color: COLORS.textMuted, fontSize: ui.sizes.xs }}>
                    <span style={{ color: COLORS.accent2, fontWeight: 700 }}>Mean</span>: {fmtMo(mean)}
                  </span>
                )}
              </div>
            </>
          );
        })()}
      </Card>

      {/* ═══ § 5 — Duration Stage Breakdown Table ═══ */}
      {durationStages.length > 0 && (
        <Card>
          <SectionTitle number="4" title="Duration Stage Breakdown"
            subtitle="Litigation stage durations contributing to total timeline" />
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: FONT }}>
              <thead>
                <tr>
                  {['Stage', 'Duration Low (months)', 'Duration High (months)', 'Expected (midpoint)'].map(h => (
                    <th key={h} style={{
                      ...tdStyle,
                      color: COLORS.textMuted, fontWeight: 700, fontSize: ui.sizes.xs,
                      textTransform: 'uppercase', textAlign: h === 'Stage' ? 'left' : 'right',
                      borderBottom: `2px solid ${COLORS.cardBorder}`,
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {durationStages.map((s, i) => (
                  <tr key={i} style={{ background: i % 2 === 0 ? 'transparent' : '#ffffff05' }}>
                    <td style={{ ...tdStyle, color: COLORS.textBright, fontWeight: 600, textAlign: 'left' }}>{s.stage}</td>
                    <td style={{ ...tdStyle, color: COLORS.text, textAlign: 'right' }}>{s.low != null ? fmtMo(s.low) : '—'}</td>
                    <td style={{ ...tdStyle, color: COLORS.text, textAlign: 'right' }}>{s.high != null ? fmtMo(s.high) : '—'}</td>
                    <td style={{ ...tdStyle, color: COLORS.accent3, fontWeight: 600, textAlign: 'right' }}>{s.expected != null ? fmtMo(s.expected) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* ═══ § 6 — Duration Percentile Table ═══ */}
      {pctData.length > 0 && (
        <Card>
          <SectionTitle number="5" title="Duration Percentile Distribution"
            subtitle="Monte Carlo simulated timeline percentiles for this claim" />
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${pctData.length}, 1fr)`, gap: ui.space.md }}>
            {pctData.map((p, i) => (
              <div key={p.label} style={{
                textAlign: 'center', padding: 16, borderRadius: 10,
                background: '#0F1219', border: `1px solid ${COLORS.cardBorder}`,
              }}>
                <div style={{ color: COLORS.textMuted, fontSize: ui.sizes.xs, fontWeight: 700, marginBottom: 6 }}>
                  {p.label}
                </div>
                <div style={{ color: COLORS.accent1, fontSize: ui.sizes.xl, fontWeight: 800 }}>
                  {fmtMo(p.months)}
                </div>
              </div>
            ))}
          </div>

          {/* Additional stats row */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: ui.space.md, marginTop: ui.space.md }}>
            <div style={{ textAlign: 'center', padding: 12, borderRadius: 8, background: '#0F1219', border: `1px solid ${COLORS.cardBorder}` }}>
              <div style={{ color: COLORS.textMuted, fontSize: ui.sizes.xs, fontWeight: 600, marginBottom: 4 }}>MEAN DURATION</div>
              <div style={{ color: COLORS.accent2, fontSize: ui.sizes.lg, fontWeight: 800 }}>{fmtMo(durStats.mean ?? perClaimT.mean)}</div>
            </div>
            {(perClaimT.pct_above_96m != null) && (
              <div style={{ textAlign: 'center', padding: 12, borderRadius: 8, background: '#0F1219', border: `1px solid ${COLORS.cardBorder}` }}>
                <div style={{ color: COLORS.textMuted, fontSize: ui.sizes.xs, fontWeight: 600, marginBottom: 4 }}>P(ABOVE 96 MONTHS)</div>
                <div style={{ color: perClaimT.pct_above_96m > 0.05 ? COLORS.accent5 : COLORS.accent4, fontSize: ui.sizes.lg, fontWeight: 800 }}>
                  {fmtPct(perClaimT.pct_above_96m)}
                </div>
              </div>
            )}
            <div style={{ textAlign: 'center', padding: 12, borderRadius: 8, background: '#0F1219', border: `1px solid ${COLORS.cardBorder}` }}>
              <div style={{ color: COLORS.textMuted, fontSize: ui.sizes.xs, fontWeight: 600, marginBottom: 4 }}>JURISDICTION</div>
              <div style={{ color: COLORS.accent6, fontSize: ui.sizes.lg, fontWeight: 800 }}>
                {(claim.jurisdiction || 'N/A').toUpperCase()}
              </div>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
