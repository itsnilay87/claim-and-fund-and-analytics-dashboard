/**
 * PerClaimAnalysis.jsx — Tab 6: Per-claim deep dive with dropdown selector.
 */

import React, { useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, ReferenceLine, Cell,
  ComposedChart, Line,
} from 'recharts';
import { COLORS, FONT, CHART_COLORS, SIZES, SPACE, useUISettings, fmtCr, fmtPct, fmtMOIC, fmtMo, moicColor, BAR_CURSOR } from '../theme';
import { Card, SectionTitle, KPI, CustomTooltip, Badge, getAxisMeta } from './Shared';
import { getClaimDisplayName } from '../../utils/claimNames';

export default function PerClaimAnalysis({ data }) {
  const { ui } = useUISettings();
  const { claims, per_claim_grid, simulation_meta, cashflow_analysis } = data;
  const axisMeta = getAxisMeta(data.structure_type, data.hybrid_payoff_params);
  const [selectedClaim, setSelectedClaim] = useState(claims[0]?.claim_id || '');
  const [selectedTail, setSelectedTail] = useState(axisMeta.isHybrid ? Math.round(axisMeta.defaultSecond * 100) : 30);

  const claim = claims.find(c => c.claim_id === selectedClaim);
  if (!claim) return <Card><SectionTitle title="No claim data" /></Card>;

  const claimScenarios = per_claim_grid[selectedClaim] || [];

  // Get per-claim cashflow data (if available)
  const claimCashflow = cashflow_analysis?.per_claim?.find(c => c.claim_id === selectedClaim) || {};

  // Available tail percentages from the data
  // For hybrid: use return_a_value (× 100 to keep dropdown integer-friendly)
  const tailOptions = axisMeta.isHybrid
    ? [...new Set(claimScenarios.map(s => Math.round((s.return_a_value ?? s.award_share_pct ?? 0) * 100)))].sort((a, b) => a - b)
    : [...new Set(claimScenarios.map(s => Math.round(s.tata_tail_pct * 100)))].sort((a, b) => a - b);

  // SOC scenarios filtered by selected tail %
  const socScenarios = claimScenarios.filter(s => s.basis === 'soc' && (
    axisMeta.isHybrid
      ? Math.abs((s.return_a_value ?? s.award_share_pct ?? 0) - selectedTail / 100) < 0.001
      : Math.abs(s.tata_tail_pct - selectedTail / 100) < 0.001
  ));

  const socBarData = socScenarios.map(s => ({
    pct: `${(s.upfront_pct * 100).toFixed(0)}%`,
    moic: s.mean_moic,
    xirr: s.conditional_xirr_win || s.mean_xirr,   // prefer conditional E[IRR|win]
    mean_xirr: s.mean_xirr,
    median_xirr: s.median_xirr,
    conditional_xirr: s.conditional_xirr_win,
    p_xirr_gt_0: s.p_xirr_gt_0,
    p_loss: s.p_loss,
  }));

  // Check economic viability
  const isViable = claim.economically_viable !== false;
  const viabilityNote = claim.viability_note || '';

  // Derived recovery metrics using CORRECT ANALYTICAL FORMULA
  // ★★★ E[Principal] = E[Q|Win] × Win_Rate (verifiable formula) ★★★
  const principal = (claim.expected_quantum_cr || 0) * (claim.win_rate || 0);
  const interestEarned = claimCashflow.e_interest_cr || claim.interest_stats?.mean || 0;
  const totalCollectedWithInterest = principal + interestEarned;  // Correct: Principal + Interest
  const legalCost = claimCashflow.e_legal_cr || claim.legal_cost_stats?.mean || 0;
  const netRecovery = totalCollectedWithInterest - legalCost;
  const interestEnabled = simulation_meta?.interest_enabled;
  const [showClaimFormula, setShowClaimFormula] = useState(false);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: SPACE.xl }}>
      {/* Claim selector */}
      <div style={{ display: 'flex', gap: SPACE.sm, flexWrap: 'wrap' }}>
        {claims.map(c => (
          <button key={c.claim_id} onClick={() => setSelectedClaim(c.claim_id)} style={{
            padding: '10px 18px', borderRadius: 8, border: 'none', cursor: 'pointer',
            fontFamily: FONT, fontSize: SIZES.sm, fontWeight: selectedClaim === c.claim_id ? 700 : 500,
            color: selectedClaim === c.claim_id ? '#fff' : COLORS.textMuted,
            background: selectedClaim === c.claim_id ? COLORS.gradient1 : COLORS.card,
            transition: 'all 0.2s ease',
          }}>
            {getClaimDisplayName(c)}
          </button>
        ))}
      </div>

      {/* Claim detail card - enhanced with more KPIs */}
      <Card>
        <SectionTitle title={getClaimDisplayName(claim)} subtitle={`${claim.archetype.replace('_', ' ')} | ${claim.jurisdiction.toUpperCase()} | Pipeline: ${claim.pipeline.join(' → ')}`} />
        {/* Viability warning */}
        {!isViable && (
          <div style={{
            background: '#2D1515', border: '1px solid #EF4444', borderRadius: 8,
            padding: '10px 14px', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 10,
          }}>
            <span style={{ fontSize: ui.sizes.xl }}>⚠️</span>
            <div>
              <div style={{ color: '#EF4444', fontSize: ui.sizes.sm, fontWeight: 700, marginBottom: 2 }}>
                ECONOMICALLY UNVIABLE
              </div>
              <div style={{ color: '#FCA5A5', fontSize: ui.sizes.xs }}>
                {viabilityNote || 'SOC is too small relative to legal costs — guaranteed loss at all pricing levels.'}
              </div>
            </div>
          </div>
        )}
        {/* Row 1: Core metrics */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: ui.space.md }}>
          <KPI label="SOC" value={fmtCr(claim.soc_value_cr)} sub="Statement of Claim" color={COLORS.accent1} />
          <KPI label="E[Quantum|Win]" value={fmtCr(claim.expected_quantum_cr)} sub={`${fmtPct(claim.expected_quantum_cr / claim.soc_value_cr)} of SOC`} color={COLORS.accent4} />
          <KPI label="Win Rate" value={fmtPct(claim.win_rate)} sub="P(final win)" color={COLORS.accent2} />
          <KPI label="Avg Duration" value={`${claim.mean_duration_months?.toFixed(1)}m`} sub={`P5: ${claim.duration_stats?.p5?.toFixed(0)}m, P95: ${claim.duration_stats?.p95?.toFixed(0)}m`} color={COLORS.accent3} />
        </div>
        {/* Row 2: Recovery metrics */}
        <div style={{ display: 'grid', gridTemplateColumns: interestEnabled ? 'repeat(5, 1fr)' : 'repeat(4, 1fr)', gap: ui.space.md, marginTop: ui.space.md }}>
          <KPI label="E[Principal]" value={fmtCr(principal)} sub={`E[Q|Win] × Win Rate`} color={COLORS.accent3} />
          {interestEnabled && (
            <KPI label="E[Interest]" value={fmtCr(interestEarned)} sub={`${fmtPct(interestEarned / claim.soc_value_cr)} of SOC`} color={COLORS.accent4} />
          )}
          <KPI label="E[Total Collected]" value={fmtCr(totalCollectedWithInterest)} sub={`Principal + Interest`} color={COLORS.accent6} />
          <KPI label="E[Legal Cost]" value={fmtCr(legalCost)} sub={`${fmtPct(legalCost / claim.soc_value_cr)} of SOC`} color={COLORS.accent5} />
          <KPI label="E[Net Recovery]" value={fmtCr(netRecovery)} sub={netRecovery >= 0 ? 'net positive' : 'net negative'} color={netRecovery >= 0 ? '#22C55E' : COLORS.accent5} />
        </div>
        
        {/* Calculation verification formula */}
        <div style={{ marginTop: ui.space.md, padding: '10px 14px', borderRadius: 8, background: '#0c1622', border: `1px solid ${COLORS.accent2}40` }}>
          <div 
            onClick={() => setShowClaimFormula(!showClaimFormula)}
            style={{ color: COLORS.accent2, fontSize: ui.sizes.xs, fontWeight: 700, marginBottom: showClaimFormula ? 4 : 0, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <span style={{ transition: 'transform 0.2s', transform: showClaimFormula ? 'rotate(90deg)' : 'rotate(0deg)' }}>▶</span>
            📐 CALCULATION FORMULA (Verifiable) — Click to {showClaimFormula ? 'hide' : 'show'}
          </div>
          {showClaimFormula && <div style={{ color: COLORS.textMuted, fontSize: ui.sizes.xs, lineHeight: 1.7 }}>
            <strong style={{ color: COLORS.textBright }}>E[Principal]</strong> = E[Quantum|Win] × Win_Rate = {fmtCr(claim.expected_quantum_cr)} × {fmtPct(claim.win_rate)} = <strong style={{ color: COLORS.accent3 }}>{fmtCr(principal)}</strong>
            {interestEnabled && <><br /><strong style={{ color: COLORS.textBright }}>E[Collected]</strong> = E[Principal] + E[Interest] = {fmtCr(principal)} + {fmtCr(interestEarned)} = <strong style={{ color: COLORS.accent6 }}>{fmtCr(totalCollectedWithInterest)}</strong></>}
            <br /><strong style={{ color: COLORS.textBright }}>E[Net]</strong> = E[Collected] - E[Legal] = {fmtCr(totalCollectedWithInterest)} - {fmtCr(legalCost)} = <strong style={{ color: netRecovery >= 0 ? '#22C55E' : COLORS.accent5 }}>{fmtCr(netRecovery)}</strong>
          </div>}
        </div>
      </Card>

      {/* Per-Claim Recovery Funnel */}
      <Card>
        <SectionTitle title={`${getClaimDisplayName(claim)} Recovery Funnel — SOC to Net`}
          subtitle={`E[Principal] = E[Q|Win] × Win Rate = ${fmtCr(claim.expected_quantum_cr)} × ${fmtPct(claim.win_rate)} = ${fmtCr(principal)}`} />
        
        {/* Visual flow */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 16 }}>
          {[
            { label: 'SOC', value: fmtCr(claim.soc_value_cr), color: COLORS.accent1 },
            { label: '→' },
            { label: 'E[Q|Win]', value: fmtCr(claim.expected_quantum_cr), color: COLORS.accent4 },
            { label: '×' },
            { label: 'Win Rate', value: fmtPct(claim.win_rate), color: COLORS.accent2 },
            { label: '→' },
            { label: 'E[Principal]', value: fmtCr(principal), color: COLORS.accent3 },
            ...(interestEnabled ? [
              { label: '+' },
              { label: 'E[Interest]', value: fmtCr(interestEarned), color: COLORS.accent4 },
            ] : []),
            { label: '−' },
            { label: 'E[Legal]', value: fmtCr(legalCost), color: COLORS.accent5 },
            { label: '=' },
            { label: 'E[Net]', value: fmtCr(netRecovery), color: netRecovery >= 0 ? '#22C55E' : COLORS.accent5 },
          ].map((item, i) => (
            item.value ? (
              <div key={i} style={{
                textAlign: 'center', padding: '8px 14px', borderRadius: 8,
                background: '#0F1219', border: `1px solid ${item.color}40`,
              }}>
                <div style={{ color: COLORS.textMuted, fontSize: 10, fontWeight: 600, textTransform: 'uppercase' }}>{item.label}</div>
                <div style={{ color: item.color, fontSize: ui.sizes.base, fontWeight: 700 }}>{item.value}</div>
              </div>
            ) : (
              <div key={i} style={{ color: COLORS.textMuted, fontSize: 16, fontWeight: 700 }}>{item.label}</div>
            )
          ))}
        </div>

        {/* Bar visualization */}
        <div style={{ marginTop: 20 }}>
          <div style={{ color: COLORS.textMuted, fontSize: ui.sizes.xs, fontWeight: 600, textTransform: 'uppercase', marginBottom: 6 }}>Recovery Breakdown (as % of SOC)</div>
          {(() => {
            const bar = (v) => Math.max(2, Math.min(100, (v / claim.soc_value_cr) * 100));
            return (
              <div style={{ display: 'flex', height: 24, borderRadius: 6, overflow: 'hidden', background: '#1F2937' }}>
                <div style={{ width: `${bar(principal)}%`, background: `linear-gradient(90deg, ${COLORS.accent1}, ${COLORS.accent3})`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <span style={{ color: '#fff', fontSize: 10, fontWeight: 700 }}>Principal {fmtPct(principal / claim.soc_value_cr)}</span>
                </div>
                {interestEnabled && interestEarned > 0 && (
                  <div style={{ width: `${bar(interestEarned)}%`, background: COLORS.accent4, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <span style={{ color: '#fff', fontSize: 9, fontWeight: 700 }}>Int {fmtPct(interestEarned / claim.soc_value_cr)}</span>
                  </div>
                )}
                <div style={{ width: `${bar(legalCost)}%`, background: COLORS.accent5 + 'AA', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <span style={{ color: '#fff', fontSize: 9, fontWeight: 700 }}>Legal {fmtPct(legalCost / claim.soc_value_cr)}</span>
                </div>
              </div>
            );
          })()}
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
            <span style={{ color: COLORS.textMuted, fontSize: ui.sizes.xs }}>0%</span>
            <span style={{ color: COLORS.textMuted, fontSize: ui.sizes.xs }}>← Total Collected ({fmtPct(totalCollectedWithInterest / claim.soc_value_cr)}) →</span>
            <span style={{ color: COLORS.textMuted, fontSize: ui.sizes.xs }}>100% of SOC</span>
          </div>
        </div>
      </Card>

      {/* SOC scenarios MOIC + IRR */}
      {socBarData.length > 0 && (
        <Card>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: ui.space.md }}>
            <SectionTitle number="1" title={`${selectedClaim} — SOC Pricing MOIC & IRR`}
              subtitle={`Dual axis: E[MOIC] (bars, left) and E[IRR|Win] (line, right) at ${axisMeta.isHybrid ? axisMeta.formatSecond(selectedTail / 100) : selectedTail + '%'} ${axisMeta.secondAxisLabel}`} />
            {tailOptions.length > 1 && (
              <select
                value={selectedTail}
                onChange={e => setSelectedTail(Number(e.target.value))}
                style={{
                  background: COLORS.card, color: COLORS.textBright, border: `1px solid ${COLORS.cardBorder}`,
                  borderRadius: 6, padding: '6px 12px', fontSize: SIZES.sm, fontWeight: 600,
                  marginLeft: 'auto', cursor: 'pointer',
                }}
              >
                {tailOptions.map(t => <option key={t} value={t}>{axisMeta.isHybrid ? `${axisMeta.formatSecond(t / 100)} ${axisMeta.secondAxisLabel}` : `${t}% Tata Tail`}</option>)}
              </select>
            )}
          </div>
          <ResponsiveContainer width="100%" height={300}>
            <ComposedChart data={socBarData} margin={{ top: 10, right: 30, left: 10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={COLORS.gridLine} />
              <XAxis dataKey="pct" tick={{ fill: COLORS.textMuted, fontSize: SIZES.sm }} />
              <YAxis yAxisId="left" tick={{ fill: COLORS.textMuted, fontSize: SIZES.sm }} tickFormatter={v => v + '×'}
                label={{ value: 'E[MOIC]', angle: -90, position: 'insideLeft', fill: COLORS.textMuted, fontSize: SIZES.sm, dx: -5 }} />
              <YAxis yAxisId="right" orientation="right" tick={{ fill: COLORS.textMuted, fontSize: SIZES.sm }} tickFormatter={v => (v * 100).toFixed(0) + '%'}
                label={{ value: 'E[IRR]', angle: 90, position: 'insideRight', fill: COLORS.textMuted, fontSize: SIZES.sm, dx: 5 }} />
              <Tooltip cursor={{ fill: 'rgba(6,182,212,0.06)' }} content={<CustomTooltip />} />
              <Legend wrapperStyle={{ fontSize: SIZES.sm, color: COLORS.textMuted }} />
              <ReferenceLine yAxisId="left" y={1} stroke={COLORS.breakeven} strokeDasharray="8 4" strokeWidth={2} />
              <ReferenceLine yAxisId="right" y={0.15} stroke={COLORS.accent3} strokeDasharray="6 3" strokeWidth={1.5} />
              <Bar yAxisId="left" dataKey="moic" name="E[MOIC]" fill={COLORS.accent1} radius={[4, 4, 0, 0]} barSize={32} cursor={BAR_CURSOR}>
                {socBarData.map((d, i) => (
                  <Cell key={i} fill={d.moic >= 1.0 ? COLORS.accent1 : COLORS.accent5} fillOpacity={0.85} />
                ))}
              </Bar>
              <Line yAxisId="right" type="monotone" dataKey="xirr" stroke={COLORS.accent2} strokeWidth={3}
                dot={{ fill: COLORS.accent2, r: 5, stroke: COLORS.bg, strokeWidth: 2 }} name="E[IRR|Win]" />
            </ComposedChart>
          </ResponsiveContainer>
        </Card>
      )}

      {/* IRR Metrics Breakdown */}
      {socBarData.length > 0 && socBarData[0]?.p_xirr_gt_0 != null && (
        <Card>
          <SectionTitle number="2" title="IRR Metrics Breakdown" subtitle="Mean IRR can be negative due to total-loss paths; use E[IRR|Win] for investment decisions" />
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 2, fontFamily: FONT }}>
              <thead>
                <tr>
                  {['Upfront', 'Mean IRR', 'Median IRR', 'E[IRR|Win]', 'P(IRR>0)', 'E[MOIC]', 'P(Loss)'].map(h => (
                    <th key={h} style={{
                      padding: '8px 12px', color: COLORS.textMuted, fontSize: SIZES.xs,
                      fontWeight: 700, textAlign: 'center', textTransform: 'uppercase',
                      letterSpacing: '0.06em', borderBottom: `1px solid ${COLORS.cardBorder}`,
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {socBarData.map((d, i) => (
                  <tr key={i} style={{ background: i % 2 === 0 ? 'transparent' : '#ffffff05' }}>
                    <td style={{ padding: '6px 12px', color: COLORS.textBright, fontSize: SIZES.sm, fontWeight: 600, textAlign: 'center' }}>{d.pct}</td>
                    <td style={{ padding: '6px 12px', color: d.mean_xirr < 0 ? COLORS.accent5 : COLORS.accent4, fontSize: SIZES.sm, textAlign: 'center' }}>{fmtPct(d.mean_xirr)}</td>
                    <td style={{ padding: '6px 12px', color: d.median_xirr < 0 ? COLORS.accent5 : COLORS.accent4, fontSize: SIZES.sm, textAlign: 'center' }}>{fmtPct(d.median_xirr)}</td>
                    <td style={{ padding: '6px 12px', color: COLORS.accent4, fontSize: SIZES.base, fontWeight: 700, textAlign: 'center' }}>{d.conditional_xirr != null ? fmtPct(d.conditional_xirr) : '—'}</td>
                    <td style={{ padding: '6px 12px', color: COLORS.accent2, fontSize: SIZES.sm, textAlign: 'center' }}>{d.p_xirr_gt_0 != null ? fmtPct(d.p_xirr_gt_0) : '—'}</td>
                    <td style={{ padding: '6px 12px', color: COLORS.text, fontSize: SIZES.sm, textAlign: 'center' }}>{d.moic.toFixed(2)}×</td>
                    <td style={{ padding: '6px 12px', color: d.p_loss > 0.30 ? COLORS.accent5 : COLORS.accent3, fontSize: SIZES.sm, textAlign: 'center' }}>{fmtPct(d.p_loss)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ marginTop: 12, padding: '10px 14px', borderRadius: 6, background: '#111827', fontSize: SIZES.xs, color: COLORS.textMuted, lineHeight: 1.6 }}>
            <strong style={{ color: COLORS.textBright }}>Why Mean IRR can be negative:</strong> When a claim loses (P(Loss) = {fmtPct(1 - claim.win_rate)}), the investor receives 0 recovery but incurs legal costs, resulting in XIRR = -100%. This extreme negative value pulls the <strong>Mean IRR</strong> down even if winning paths have high IRR.
            <br /><br />
            <strong style={{ color: COLORS.accent4 }}>E[IRR|Win]</strong> = Expected IRR conditional on winning — excludes total-loss paths, giving a clearer picture of returns when the investment succeeds. This is the key metric for comparing investment opportunities.
            <br />
            <strong style={{ color: COLORS.accent2 }}>P(IRR&gt;0)</strong> = Probability of achieving positive IRR — combines win rate with outcome distribution.
          </div>
        </Card>
      )}

    </div>
  );
}
