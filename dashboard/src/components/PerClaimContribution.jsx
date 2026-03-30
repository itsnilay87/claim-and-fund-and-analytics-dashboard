/**
 * PerClaimContribution.jsx — Tab 2: Per-claim metrics, MOIC bar chart,
 * marginal contribution analysis, and capital allocation.
 *
 * Sections:
 *   1. Per-claim metrics table (sortable by capital weight)
 *   2. Per-claim MOIC horizontal bar chart (green/red at 1.0x)
 *   3. Marginal "drop-one" contribution (2+ claims only)
 *   4. Capital allocation pie + stacked bar
 */

import React, { useMemo, useState } from 'react';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ReferenceLine, Cell, PieChart, Pie,
  Legend,
} from 'recharts';
import { COLORS, FONT, CHART_COLORS, useUISettings, fmtCr, fmtPct, fmtMOIC, BAR_CURSOR } from '../theme';
import { Card, SectionTitle, KPI, CustomTooltip, DataTable, Badge } from './Shared';
import { getClaimDisplayName, truncateClaimName } from '../utils/claimNames';

/* ── helpers ── */
const safeDivide = (a, b) => b > 0.001 ? a / b : 0;

const JURISDICTION_LABELS = {
  indian_domestic: 'India (Domestic)',
  siac_singapore: 'SIAC (Singapore)',
  icc: 'ICC',
  lcia: 'LCIA',
};

const JURISDICTION_FLAGS = {
  indian_domestic: '🇮🇳',
  siac_singapore: '🇸🇬',
  icc: '🌐',
  lcia: '🇬🇧',
};

export default function PerClaimContribution({ data, structureType }) {
  const { ui } = useUISettings();
  const claims = data?.claims || [];
  const meta = data?.simulation_meta || {};
  const ca = data?.cashflow_analysis || {};
  const ig = data?.investment_grid || {};
  const perClaimCashflow = ca.per_claim || [];

  const totalSOC = meta.total_soc_cr || claims.reduce((s, c) => s + (c.soc_value_cr || 0), 0) || 1;

  // Reference grid point for per-claim MOIC
  const refKey = ig['10_20'] ? '10_20' : Object.keys(ig)[0] || '';
  const refGrid = ig[refKey] || {};
  const perClaimGrid = refGrid.per_claim || {};

  // Enrich claims with computed values
  const enriched = useMemo(() => {
    return claims.map((c, i) => {
      const cf = perClaimCashflow.find(p => p.claim_id === c.claim_id) || {};
      const pcg = perClaimGrid[c.claim_id] || {};
      const capitalWeight = safeDivide(c.soc_value_cr, totalSOC);
      const eMoic = pcg.mean_moic || 0;
      const eIrr = pcg.mean_xirr || 0;
      const pLoss = pcg.p_loss ?? (1 - (c.win_rate || 0));
      const eCollected = cf.e_collected_cr || c.mean_collected_cr || 0;
      const returnWeight = safeDivide(eCollected, ca.portfolio_summary?.total_e_collected_cr || 1);
      return {
        ...c,
        cf,
        capitalWeight,
        returnWeight,
        eMoic,
        eIrr,
        pLoss,
        eCollected,
        eLegal: cf.e_legal_cr || c.mean_legal_costs_cr || 0,
        eNet: cf.e_net_cr || (eCollected - (cf.e_legal_cr || c.mean_legal_costs_cr || 0)),
        color: CHART_COLORS[i % CHART_COLORS.length],
      };
    }).sort((a, b) => b.capitalWeight - a.capitalWeight);
  }, [claims, perClaimCashflow, perClaimGrid, totalSOC, ca]);

  /* ═══════════════════════════════════════════════════════════
   * Section 1 — Per-Claim Metrics Table
   * ═══════════════════════════════════════════════════════════ */
  const tableHeaders = ['Claim', 'Jurisdiction', 'Type', 'SOC (₹Cr)', 'E[MOIC]', 'E[IRR]', 'P(Loss)', 'Capital Wt', 'Return Wt'];
  const tableRows = enriched.map(c => {
    const jLabel = JURISDICTION_LABELS[c.jurisdiction] || c.jurisdiction;
    const jFlag = JURISDICTION_FLAGS[c.jurisdiction] || '';
    return [
      <span style={{ color: COLORS.textBright, fontWeight: 700 }}>{getClaimDisplayName(c)}</span>,
      <span>{jFlag} <Badge text={jLabel} color={c.jurisdiction?.includes('siac') ? COLORS.accent2 : COLORS.accent1} /></span>,
      <span style={{ textTransform: 'capitalize' }}>{(c.claim_type || '').replace(/_/g, ' ')}</span>,
      <span style={{ fontWeight: 600 }}>{fmtCr(c.soc_value_cr)}</span>,
      <span style={{ color: c.eMoic >= 1 ? '#34D399' : COLORS.accent5, fontWeight: 700 }}>{fmtMOIC(c.eMoic)}</span>,
      <span style={{ color: c.eIrr >= 0.15 ? '#34D399' : c.eIrr >= 0 ? COLORS.accent3 : COLORS.accent5, fontWeight: 600 }}>{fmtPct(c.eIrr)}</span>,
      <span style={{ color: c.pLoss > 0.35 ? COLORS.accent5 : c.pLoss > 0.2 ? COLORS.accent3 : '#34D399', fontWeight: 600 }}>{fmtPct(c.pLoss)}</span>,
      <span style={{ fontWeight: 600 }}>{fmtPct(c.capitalWeight)}</span>,
      <span style={{ fontWeight: 600, color: c.returnWeight > c.capitalWeight ? '#34D399' : COLORS.accent3 }}>{fmtPct(c.returnWeight)}</span>,
    ];
  });

  /* ═══════════════════════════════════════════════════════════
   * Section 2 — MOIC horizontal bar chart
   * ═══════════════════════════════════════════════════════════ */
  const moicBarData = enriched.map(c => ({
    name: truncateClaimName(c, 20),
    moic: c.eMoic,
    fill: c.eMoic >= 1.0 ? '#34D399' : COLORS.accent5,
  }));

  /* ═══════════════════════════════════════════════════════════
   * Section 3 — Marginal contribution (drop-one)
   * ═══════════════════════════════════════════════════════════ */
  const portfolioMoic = refGrid.mean_moic || 0;

  const marginalData = useMemo(() => {
    if (claims.length < 2) return null;

    // For each claim, compute what happens if we remove it
    // Using capital-weighted MOIC: portfolio MOIC ≈ Σ(weight_i × moic_i)
    const totalWeight = enriched.reduce((s, c) => s + c.capitalWeight, 0);
    return enriched.map(c => {
      const othersWeightedMoic = enriched
        .filter(o => o.claim_id !== c.claim_id)
        .reduce((s, o) => s + o.capitalWeight * o.eMoic, 0);
      const othersWeight = totalWeight - c.capitalWeight;
      const moicWithout = othersWeight > 0.001 ? othersWeightedMoic / othersWeight : 0;
      const delta = portfolioMoic - moicWithout;
      return {
        claim: getClaimDisplayName(c),
        moicWith: portfolioMoic,
        moicWithout: +moicWithout.toFixed(3),
        delta: +delta.toFixed(3),
      };
    });
  }, [enriched, portfolioMoic, claims.length]);

  /* ═══════════════════════════════════════════════════════════
   * Section 4 — Capital Allocation
   * ═══════════════════════════════════════════════════════════ */
  const capitalPieData = enriched.map((c, i) => ({
    name: getClaimDisplayName(c),
    value: c.soc_value_cr,
    fill: c.color,
  }));

  const stackBarData = enriched.map(c => ({
    name: truncateClaimName(c, 15),
    investment: c.soc_value_cr * (refKey ? parseFloat(refKey.split('_')[0]) / 100 : 0.10),
    expected_return: Math.max(0, c.eCollected),
  }));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: ui.space.xl }}>

      {/* Section 1 — Metrics Table */}
      <Card>
        <SectionTitle number="1" title="Per-Claim Metrics" subtitle={`Sorted by capital weight — reference deal: ${refKey.replace('_', '% upfront / ')}% tail`} />
        <DataTable headers={tableHeaders} rows={tableRows} />
      </Card>

      {/* Section 2 — MOIC Bar Chart */}
      <Card>
        <SectionTitle number="2" title="Per-Claim E[MOIC]" subtitle="Green if above 1.0× breakeven, red if below" />
        <ResponsiveContainer width="100%" height={Math.max(200, enriched.length * 50 + 60)}>
          <BarChart data={moicBarData} layout="vertical" margin={{ top: 5, right: 30, left: 10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={COLORS.gridLine} />
            <XAxis type="number" tick={{ fill: COLORS.textMuted, fontSize: ui.sizes.sm }} tickFormatter={v => `${v.toFixed(1)}×`} />
            <YAxis type="category" dataKey="name" width={180} tick={{ fill: COLORS.text, fontSize: ui.sizes.sm }} />
            <Tooltip content={<CustomTooltip />} />
            <ReferenceLine x={1} stroke={COLORS.breakeven} strokeDasharray="8 4" strokeWidth={2} label={{ value: '1.0× Breakeven', fill: COLORS.breakeven, fontSize: 11, position: 'top' }} />
            <Bar dataKey="moic" name="E[MOIC]" radius={[0, 4, 4, 0]} cursor={BAR_CURSOR}>
              {moicBarData.map((d, i) => <Cell key={i} fill={d.fill} fillOpacity={0.85} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </Card>

      {/* Section 3 — Marginal Contribution */}
      <Card>
        <SectionTitle number="3" title="Marginal Contribution" subtitle="Drop-one analysis: how portfolio MOIC changes if each claim is removed" />
        {marginalData ? (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 2, fontFamily: FONT }}>
              <thead>
                <tr>
                  {['Claim', 'Portfolio MOIC (With)', 'Portfolio MOIC (Without)', 'Delta'].map(h => (
                    <th key={h} style={{
                      padding: '12px 16px', color: COLORS.textMuted, fontSize: ui.sizes.sm,
                      fontWeight: 700, textAlign: 'center', textTransform: 'uppercase',
                      letterSpacing: '0.05em', borderBottom: `1px solid ${COLORS.cardBorder}`,
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {marginalData.map((row, i) => (
                  <tr key={i} style={{ background: i % 2 === 0 ? 'transparent' : '#ffffff05' }}>
                    <td style={{ padding: '10px 16px', color: COLORS.textBright, fontWeight: 600, textAlign: 'center' }}>{row.claim}</td>
                    <td style={{ padding: '10px 16px', color: COLORS.text, textAlign: 'center', fontWeight: 600 }}>{fmtMOIC(row.moicWith)}</td>
                    <td style={{ padding: '10px 16px', color: COLORS.text, textAlign: 'center', fontWeight: 600 }}>{fmtMOIC(row.moicWithout)}</td>
                    <td style={{
                      padding: '10px 16px', textAlign: 'center', fontWeight: 700,
                      color: row.delta > 0 ? '#34D399' : row.delta < 0 ? COLORS.accent5 : COLORS.textMuted,
                    }}>
                      {row.delta > 0 ? '+' : ''}{row.delta.toFixed(3)}×
                      {row.delta > 0 ? ' ▲' : row.delta < 0 ? ' ▼' : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div style={{
            background: `${COLORS.accent6}10`, border: `1px solid ${COLORS.accent6}30`,
            borderRadius: 8, padding: '20px 24px', textAlign: 'center',
          }}>
            <span style={{ color: COLORS.accent6, fontWeight: 700 }}>ℹ️ Marginal analysis requires 2+ claims</span>
            <p style={{ color: COLORS.textMuted, margin: '8px 0 0', fontSize: ui.sizes.sm }}>
              This portfolio contains a single claim. Add more claims to see drop-one contribution analysis.
            </p>
          </div>
        )}
      </Card>

      {/* Section 4 — Capital Allocation */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: ui.space.lg }}>
        {/* Pie */}
        <Card>
          <SectionTitle number="4a" title="Capital Allocation" subtitle="Investment weight by claim (SOC)" />
          <ResponsiveContainer width="100%" height={ui.chartHeight.sm}>
            <PieChart>
              <Pie
                data={capitalPieData} cx="50%" cy="50%"
                innerRadius={50} outerRadius={85} paddingAngle={3} dataKey="value"
                label={({ name, value }) => `${name.length > 12 ? name.slice(0, 12) + '…' : name}: ₹${value.toFixed(0)}`}
                labelLine={{ stroke: COLORS.textMuted }}
              >
                {capitalPieData.map((d, i) => <Cell key={i} fill={d.fill} />)}
              </Pie>
              <Tooltip content={<CustomTooltip />} />
            </PieChart>
          </ResponsiveContainer>
        </Card>

        {/* Stacked bar: Investment vs Return */}
        <Card>
          <SectionTitle number="4b" title="Investment vs. Expected Return" subtitle="Per-claim investment amount vs. expected collected" />
          <ResponsiveContainer width="100%" height={ui.chartHeight.sm}>
            <BarChart data={stackBarData} layout="vertical" margin={{ top: 5, right: 30, left: 10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={COLORS.gridLine} />
              <XAxis type="number" tick={{ fill: COLORS.textMuted, fontSize: ui.sizes.sm }} tickFormatter={v => `₹${v.toFixed(0)}`} />
              <YAxis type="category" dataKey="name" width={140} tick={{ fill: COLORS.text, fontSize: ui.sizes.sm }} />
              <Tooltip content={<CustomTooltip />} />
              <Legend wrapperStyle={{ fontSize: ui.sizes.sm, color: COLORS.text }} />
              <Bar dataKey="investment" name="Investment (₹Cr)" fill={COLORS.accent5} radius={[0, 4, 4, 0]} stackId="a" />
              <Bar dataKey="expected_return" name="E[Collected] (₹Cr)" fill={COLORS.accent4} radius={[0, 4, 4, 0]} stackId="a" />
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </div>

      {/* Section 5 — Per-Claim Breakeven (V2 enhanced) */}
      {enriched.some(c => c.cf.breakeven_pct != null || c.pLoss != null) && (
        <Card>
          <SectionTitle number="5" title="Per-Claim Breakeven & Risk" subtitle="Claim-level breakeven upfront % and probability of loss" />
          <ResponsiveContainer width="100%" height={Math.max(200, enriched.length * 50 + 60)}>
            <BarChart
              data={enriched.map(c => ({
                name: truncateClaimName(c, 20),
                breakeven: c.cf.breakeven_pct != null ? c.cf.breakeven_pct * 100 : (c.pLoss < 0.5 ? (1 / (c.eMoic || 1)) * 100 : null),
                pLoss: (c.pLoss || 0) * 100,
              }))}
              layout="vertical"
              margin={{ top: 5, right: 30, left: 10, bottom: 5 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke={COLORS.gridLine} />
              <XAxis type="number" tick={{ fill: COLORS.textMuted, fontSize: ui.sizes.sm }} unit="%" />
              <YAxis type="category" dataKey="name" width={180} tick={{ fill: COLORS.text, fontSize: ui.sizes.sm }} />
              <Tooltip content={<CustomTooltip />} />
              <Legend wrapperStyle={{ fontSize: ui.sizes.sm, color: COLORS.text }} />
              <Bar dataKey="breakeven" name="Breakeven %" fill={COLORS.accent3} radius={[0, 4, 4, 0]} />
              <Bar dataKey="pLoss" name="P(Loss) %" fill={COLORS.accent5} radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
      )}
    </div>
  );
}
