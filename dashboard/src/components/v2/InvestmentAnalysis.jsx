/**
 * InvestmentAnalysis.jsx — Tab 4: SOC-based investment grid + breakeven analysis.
 *
 * Merged from InvestmentSOC + BreakevenAnalysis.
 * Keeps: Stats KPIs, MOIC heatmap, tail selector, MOIC/IRR dual-axis,
 *        MOIC vs P(Loss), per-claim breakeven bars, breakeven cards.
 * Removed: P(Loss) heatmap (redundant), breakeven surface, capital deployed,
 *          duplicate portfolio MOIC curve, net-return chart.
 */

import React, { useState, useMemo } from 'react';
import {
  ComposedChart, Line, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend, ReferenceLine, Cell,
  BarChart, ScatterChart, Scatter, ZAxis,
} from 'recharts';
import { COLORS, FONT, SIZES, SPACE, useUISettings, fmtCr, fmtPct, fmtMOIC, moicColor, irrColor, lossColor, varColor, BAR_CURSOR } from '../theme';
import { Card, SectionTitle, KPI, CustomTooltip, getAxisMeta } from './Shared';
import { getClaimDisplayName } from '../../utils/claimNames';

export default function InvestmentAnalysis({ data }) {
  const { ui } = useUISettings();
  const grid   = data.investment_grid_soc || [];
  const meta   = data.simulation_meta;
  const be     = data.breakeven_data;
  const ca     = data.cashflow_analysis || {};
  const ps     = ca.portfolio_summary || {};
  const perClaim = ca.per_claim || [];
  const claims = data.claims || [];
  const axisMeta = getAxisMeta(data.structure_type, data.hybrid_payoff_params);
  const [heatmapMetric, setHeatmapMetric] = useState('irr');
  const [showFunnelFormula, setShowFunnelFormula] = useState(false);

  if (grid.length === 0) {
    return <Card><SectionTitle title="No SOC grid data" subtitle="Run with --pricing-basis soc or both" /></Card>;
  }

  const totalSOC   = meta.total_soc_cr;
  const upfrontPcts = [...new Set(grid.map(g => g.upfront_pct))].sort((a, b) => a - b);
  const awardPcts   = [...new Set(grid.map(g => g.award_share_pct))].sort((a, b) => a - b);
  // Hybrid: ascending second-axis values; upfront-tail: tail-ascending = award-descending
  const displayAwards = axisMeta.isHybrid
    ? [...awardPcts].sort((a, b) => a - b)
    : [...awardPcts].sort((a, b) => b - a);

  // Default: 30% Tata Tail = 70% award (or hybrid default return_a)
  const defaultAward = axisMeta.isHybrid
    ? (awardPcts.find(a => Math.abs(a - axisMeta.defaultSecond) < 0.001) || awardPcts[Math.floor(awardPcts.length / 2)])
    : (awardPcts.find(a => Math.abs(a - 0.70) < 0.001) || awardPcts[Math.floor(awardPcts.length / 2)]);
  const [selectedAward, setSelectedAward] = useState(defaultAward);
  const selectedTail = axisMeta.isHybrid
    ? selectedAward
    : +(1 - selectedAward).toFixed(2);
  const fmtSecond = axisMeta.formatSecond;
  const secondLabel = axisMeta.secondAxisLabel;

  /* ── line data for selected tail ── */
  const lineData = upfrontPcts.map(up => {
    const cell = grid.find(g => g.upfront_pct === up && g.award_share_pct === selectedAward);
    return {
      pct: `${(up * 100).toFixed(0)}%`,
      upfront_pct: up,
      moic: cell?.mean_moic || 0,
      // Prefer expected_xirr (XIRR of E[cashflows]) over mean_xirr (avg of
      // per-path IRRs). The latter is heavily skewed by -100% loss paths and
      // is not what investors typically reason about.
      xirr: cell?.expected_xirr ?? cell?.mean_xirr ?? 0,
      p_loss: cell?.p_loss || 0,
      net_return_cr: cell?.mean_net_return_cr || 0,
      investment_cr: totalSOC * up,
    };
  });

  /* ── heatmap rows ── */
  const heatmapRows = upfrontPcts.map(up => {
    const row = { upfront: `${(up * 100).toFixed(0)}%` };
    for (const aw of awardPcts) {
      const cell = grid.find(g => g.upfront_pct === up && g.award_share_pct === aw);
      row[`aw_${aw}_moic`] = cell?.mean_moic || 0;
      row[`aw_${aw}_xirr`] = cell?.expected_xirr ?? cell?.mean_xirr ?? 0;
    }
    return row;
  });

  /* ── best cell ── */
  const bestCell = grid.reduce((a, b) => (a.mean_moic > b.mean_moic ? a : b), grid[0]);
  const bestTail = axisMeta.rowToSecond(bestCell);

  /* ── breakeven data ──
     The exporter previously used the key `per_claim_at_30_tata_tail`; older
     dashboards expect `per_claim_at_30_tail`. Fall through any of them. */
  const perClaimBE   = be?.per_claim_at_30_tail
                    || be?.per_claim_at_30_tata_tail
                    || be?.per_claim_at_40_award
                    || {};
  const claimNameMap = useMemo(() => {
    const m = {};
    (claims || []).forEach(c => { m[c.claim_id] = getClaimDisplayName(c); });
    return m;
  }, [claims]);
  const claimIds     = Object.keys(perClaimBE);
  const breakevenMax = claimIds.map(cid => {
    const info = perClaimBE[cid];
    return {
      claim: claimNameMap[cid] || cid.replace('TP-', ''),
      fullId: claimNameMap[cid] || cid,
      socBE: (info?.soc_breakeven_pct || 0) * 100,
      soc: info?.soc_cr || 0,
      archetype: info?.archetype || '',
    };
  });

  /* ── aggregate stats ── */
  const refCells  = grid.filter(g => Math.abs(g.award_share_pct - 0.70) < 0.001);
  const avgMoic   = refCells.length ? refCells.reduce((s, c) => s + c.mean_moic, 0) / refCells.length : 0;
  const avgIrr    = refCells.length ? refCells.reduce((s, c) => s + (c.expected_xirr ?? c.mean_xirr ?? 0), 0) / refCells.length : 0;
  // Sweet spot: best MOIC among cells with the lowest achievable P(Loss).
  // Originally hard-required p_loss < 30% which yields N/A whenever the
  // entire grid is riskier than that. Now we relax dynamically so a sensible
  // best-available cell is always shown.
  const sortedByMoic = [...grid].sort((a, b) => b.mean_moic - a.mean_moic);
  const minLoss      = grid.length ? Math.min(...grid.map(g => g.p_loss ?? 1)) : 1;
  const lossCutoff   = Math.max(0.30, minLoss + 0.05);  // allow 5pp above floor
  const safe         = sortedByMoic.filter(g => (g.p_loss ?? 1) <= lossCutoff);
  const sweetSpot    = safe[0] || sortedByMoic[0];
  const sweetTail    = sweetSpot ? axisMeta.rowToSecond(sweetSpot) : 0;
  const sweetThresholdNote = lossCutoff > 0.301
    ? `MOIC ${sweetSpot ? fmtMOIC(sweetSpot.mean_moic) : ''}, P(Loss)\u2264${(lossCutoff * 100).toFixed(0)}%`
    : `MOIC ${sweetSpot ? fmtMOIC(sweetSpot.mean_moic) : ''}, P(Loss)<30%`;

  /* ───────────────────── Render ───────────────────── */
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: ui.space.xl }}>

      {/* ── Stats KPIs ── */}
      <Card>
        <SectionTitle title="Investment Statistics — SOC Pricing"
          subtitle={`Portfolio across ${grid.length} grid cells (${upfrontPcts.length} upfront × ${displayAwards.length} tail). ${meta.n_paths.toLocaleString()} MC paths.`} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: ui.space.md, marginTop: 8 }}>
          {[
            { label: 'Total SOC', value: fmtCr(totalSOC), sub: '6 claims', color: COLORS.accent1 },
            { label: 'Best E[MOIC]', value: fmtMOIC(bestCell.mean_moic), sub: `@ ${fmtPct(bestCell.upfront_pct)} up / ${fmtPct(bestTail)} tail`, color: COLORS.accent4 },
            { label: 'Best E[IRR]', value: fmtPct(bestCell.expected_xirr ?? bestCell.mean_xirr ?? 0), sub: 'XIRR of E[cashflows]', color: COLORS.accent2 },
            { label: 'Best P(Loss)', value: fmtPct(bestCell.p_loss), sub: 'lowest in grid', color: COLORS.accent5 },
            { label: 'Avg MOIC @30%', value: fmtMOIC(avgMoic), sub: 'across all upfronts', color: COLORS.accent3 },
            { label: 'Avg IRR @30%', value: fmtPct(avgIrr), sub: 'across all upfronts', color: COLORS.accent6 },
            { label: 'Sweet Spot', value: sweetSpot ? `${fmtPct(sweetSpot.upfront_pct)} / ${fmtSecond(sweetTail)}` : 'N/A',
              sub: sweetSpot ? sweetThresholdNote : '', color: COLORS.accent4 },
            { label: 'Max Breakeven', value: breakevenMax.length ? `${Math.max(...breakevenMax.map(b => b.socBE)).toFixed(0)}%` : 'N/A',
              sub: 'highest across claims', color: COLORS.accent1 },
          ].map((stat, i) => (
            <div key={i} style={{
              textAlign: 'center', padding: 14, borderRadius: 10,
              background: '#0F1219', border: `1px solid ${COLORS.cardBorder}`,
            }}>
              <div style={{ color: COLORS.textMuted, fontSize: ui.sizes.xs, fontWeight: 600, marginBottom: 4, textTransform: 'uppercase' }}>{stat.label}</div>
              <div style={{ color: stat.color, fontSize: ui.sizes.xl, fontWeight: 800 }}>{stat.value}</div>
              {stat.sub && <div style={{ color: COLORS.textMuted, fontSize: ui.sizes.xs, marginTop: 2 }}>{stat.sub}</div>}
            </div>
          ))}
        </div>
      </Card>

      {/* ══════════════════════════════════════════════════════════════════
         Portfolio Recovery Funnel: SOC → E[Q|Win] × Win Rate → E[Principal] + E[Interest] → Net
         FORMULA: E[Principal] = Σ(E[Q|Win]ᵢ × Win_Rateᵢ) for each claim i
         This is the ANALYTICAL formula that can be manually verified.
         ══════════════════════════════════════════════════════════════════ */}
      {ps.total_soc_cr > 0 && (() => {
        const totalEQ        = ps.total_eq_cr || 0;
        const eqOverSoc      = ps.eq_over_soc || 0;
        const avgWinRate     = ps.avg_win_rate || 0;
        const totalCollectedWithInterest = ps.total_e_collected_cr || 0;  // Includes interest
        const totalInterest  = perClaim.reduce((s, c) => s + (c.e_interest_cr || 0), 0);
        
        // ★★★ CORRECT FORMULA: E[Principal] = Σ(E[Q|Win]ᵢ × Win_Rateᵢ) ★★★
        // This is verifiable: Total SOC × (Avg E[Q|Win]/SOC) × (Avg Win Rate) ≈ E[Principal]
        const totalPrincipal = claims.reduce((sum, cl) => {
          return sum + (cl.expected_quantum_cr || 0) * (cl.win_rate || 0);
        }, 0);
        
        const colOverSoc     = ps.collected_over_soc || 0;
        const principalOverSoc = totalPrincipal / totalSOC;
        const totalLegal     = ps.total_e_legal_cr || 0;
        const totalNet       = ps.total_e_net_cr || 0;
        const interestEnabled = meta.interest_enabled;
        // Flow bar widths (relative to SOC) — use principal + interest separately
        const bar = (v) => Math.max(2, Math.min(100, (v / totalSOC) * 100));
        return (
          <Card>
            <SectionTitle title="Portfolio Recovery Funnel — SOC to Net"
              subtitle={`E[Principal] = Σ(E[Q|Win] × Win Rate) = ${fmtCr(totalPrincipal)}. Total SOC: ${fmtCr(totalSOC)}. ${meta.n_paths.toLocaleString()} MC paths.`} />
            
            {/* Calculation verification formula */}
            <div style={{ padding: '10px 14px', borderRadius: 8, background: '#0c1622', border: `1px solid ${COLORS.accent2}40`, marginTop: 8, marginBottom: 12 }}>
              <div 
                onClick={() => setShowFunnelFormula(!showFunnelFormula)}
                style={{ color: COLORS.accent2, fontSize: ui.sizes.xs, fontWeight: 700, marginBottom: showFunnelFormula ? 4 : 0, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
              >
                <span style={{ transition: 'transform 0.2s', transform: showFunnelFormula ? 'rotate(90deg)' : 'rotate(0deg)' }}>▶</span>
                📐 CALCULATION FORMULA (Verifiable) — Click to {showFunnelFormula ? 'hide' : 'show'}
              </div>
              {showFunnelFormula && <div style={{ color: COLORS.textMuted, fontSize: ui.sizes.xs, lineHeight: 1.7 }}>
                <strong style={{ color: COLORS.textBright }}>E[Principal]</strong> = Σ (E[Quantum|Win]ᵢ × Win_Rateᵢ) for each claim<br />
                = ({claims.map((c, i) => `${fmtCr(c.expected_quantum_cr)} × ${fmtPct(c.win_rate)}`).join(') + (')})<br />
                = <strong style={{ color: COLORS.accent3 }}>{fmtCr(totalPrincipal)}</strong> ({fmtPct(principalOverSoc)} of SOC)
                {interestEnabled && <><br /><strong style={{ color: COLORS.textBright }}>E[Collected]</strong> = E[Principal] + E[Interest] = {fmtCr(totalPrincipal)} + {fmtCr(totalInterest)} = <strong style={{ color: COLORS.accent6 }}>{fmtCr(totalPrincipal + totalInterest)}</strong></>}
              </div>}
            </div>

            {/* ── Row 1: Big funnel KPIs ── */}
            <div style={{ display: 'grid', gridTemplateColumns: interestEnabled ? 'repeat(6, 1fr)' : 'repeat(5, 1fr)', gap: ui.space.md, marginTop: 12 }}>
              {[
                { label: 'Total SOC',       value: fmtCr(totalSOC),        sub: `${claims.length} claims`, color: COLORS.accent1 },
                { label: 'E[Quantum|Win]',  value: fmtCr(totalEQ),         sub: `${fmtPct(eqOverSoc)} of SOC`, color: COLORS.accent4 },
                { label: 'Avg Win Rate',    value: fmtPct(avgWinRate),     sub: 'SOC-weighted', color: COLORS.accent2 },
                { label: 'E[Principal]',    value: fmtCr(totalPrincipal),  sub: `${fmtPct(principalOverSoc)} of SOC`, color: COLORS.accent3 },
                ...(interestEnabled ? [{
                  label: 'E[Interest]',
                  value: fmtCr(totalInterest),
                  sub: `${fmtPct(totalInterest / totalSOC)} of SOC`,
                  color: COLORS.accent4,
                }] : []),
                { label: 'E[Net Recovery]', value: fmtCr(totalNet), sub: `after ₹${totalLegal.toFixed(0)} Cr legal`, color: totalNet > 0 ? '#22C55E' : COLORS.accent5 },
              ].map((stat, i, arr) => (
                <div key={i} style={{
                  textAlign: 'center', padding: 14, borderRadius: 10,
                  background: '#0F1219', border: `1px solid ${COLORS.cardBorder}`, position: 'relative',
                }}>
                  <div style={{ color: COLORS.textMuted, fontSize: ui.sizes.xs, fontWeight: 600, marginBottom: 4, textTransform: 'uppercase' }}>{stat.label}</div>
                  <div style={{ color: stat.color, fontSize: ui.sizes.xl, fontWeight: 800 }}>{stat.value}</div>
                  {stat.sub && <div style={{ color: COLORS.textMuted, fontSize: ui.sizes.xs, marginTop: 2 }}>{stat.sub}</div>}
                  {i < arr.length - 1 && <div style={{ position: 'absolute', right: -14, top: '50%', transform: 'translateY(-50%)', color: COLORS.textMuted, fontSize: 18, fontWeight: 700 }}>→</div>}
                </div>
              ))}
            </div>

            {/* ── Row 2: Supporting analytics ── */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: ui.space.md, marginTop: ui.space.md }}>
              {[
                { label: 'E[Legal Costs]', value: fmtCr(totalLegal), sub: `${fmtPct(totalLegal / totalSOC)} of SOC`, color: COLORS.accent5 },
                { label: 'Total Collected', value: fmtCr(totalCollectedWithInterest), sub: `Principal + Interest`, color: COLORS.accent6 },
                { label: 'Collection Ratio', value: fmtPct(colOverSoc), sub: 'Total Collected / SOC', color: COLORS.accent3 },
                { label: 'Net / SOC', value: fmtPct(totalNet / totalSOC), sub: totalNet > 0 ? 'net positive' : 'net negative', color: totalNet > 0 ? '#22C55E' : COLORS.accent5 },
              ].map((stat, i) => (
                <div key={i} style={{
                  textAlign: 'center', padding: 12, borderRadius: 8,
                  background: '#0F1219', border: `1px solid ${COLORS.cardBorder}`,
                }}>
                  <div style={{ color: COLORS.textMuted, fontSize: ui.sizes.xs, fontWeight: 600, marginBottom: 3, textTransform: 'uppercase' }}>{stat.label}</div>
                  <div style={{ color: stat.color, fontSize: ui.sizes.lg, fontWeight: 800 }}>{stat.value}</div>
                  {stat.sub && <div style={{ color: COLORS.textMuted, fontSize: ui.sizes.xs, marginTop: 2 }}>{stat.sub}</div>}
                </div>
              ))}
            </div>

            {/* ── Flow breakdown bar — Principal + Interest = Total Collected (no double counting) ── */}
            <div style={{ marginTop: ui.space.lg }}>
              <div style={{ color: COLORS.textMuted, fontSize: ui.sizes.xs, fontWeight: 600, textTransform: 'uppercase', marginBottom: 6 }}>Recovery Flow (as % of SOC) — Principal + Interest - Legal = Net</div>
              <div style={{ display: 'flex', height: 28, borderRadius: 8, overflow: 'hidden', background: '#1F2937' }}>
                <div style={{ width: `${bar(totalPrincipal)}%`, background: `linear-gradient(90deg, ${COLORS.accent1}, ${COLORS.accent3})`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <span style={{ color: '#fff', fontSize: ui.sizes.xs, fontWeight: 700 }}>Principal {fmtPct(principalOverSoc)}</span>
                </div>
                {interestEnabled && totalInterest > 0 && (
                  <div style={{ width: `${bar(totalInterest)}%`, background: COLORS.accent4, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <span style={{ color: '#fff', fontSize: 9, fontWeight: 700 }}>Interest {fmtPct(totalInterest / totalSOC)}</span>
                  </div>
                )}
                <div style={{ width: `${bar(totalLegal)}%`, background: COLORS.accent5 + 'AA', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <span style={{ color: '#fff', fontSize: 9, fontWeight: 700 }}>Legal {fmtPct(totalLegal / totalSOC)}</span>
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
                <span style={{ color: COLORS.textMuted, fontSize: ui.sizes.xs }}>0%</span>
                <span style={{ color: COLORS.textMuted, fontSize: ui.sizes.xs }}>← Total Collected ({fmtPct(colOverSoc)}) →</span>
                <span style={{ color: COLORS.textMuted, fontSize: ui.sizes.xs }}>100% of SOC</span>
              </div>
              {/* Calculation verification note */}
              <div style={{ marginTop: 8, padding: '8px 12px', borderRadius: 6, background: '#111827', fontSize: ui.sizes.xs, color: COLORS.textMuted, lineHeight: 1.6 }}>
                <strong style={{ color: COLORS.textBright }}>Calculation:</strong> E[Principal] ({fmtCr(totalPrincipal)}) + E[Interest] ({fmtCr(totalInterest)}) = E[Total Collected] ({fmtCr(totalCollectedWithInterest)}) → minus E[Legal] ({fmtCr(totalLegal)}) = E[Net] ({fmtCr(totalNet)})
              </div>
            </div>
          </Card>
        );
      })()}

      {/* ══════════════════════════════════════════════════════════════════
         Per-Claim Recovery Analytics Table
         NOTE: E[Collected] includes interest. E[Principal] = E[Collected] - E[Interest]
         ══════════════════════════════════════════════════════════════════ */}
      {perClaim.length > 0 && (
        <Card>
          <SectionTitle title="Per-Claim Recovery Analytics"
            subtitle="Breakdown of expected recovery per claim — E[Total Collected] = E[Principal] + E[Interest]. Net = Total Collected - Legal." />
          <div style={{ overflowX: 'auto', marginTop: 8 }}>
            <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: '0 4px', fontFamily: FONT }}>
              <thead>
                <tr>
                  {['Claim', 'Jurisdiction', 'SOC', 'E[Q|Win]', 'Win Rate', ...(meta.interest_enabled ? ['E[Principal]', 'E[Interest]'] : []), 'E[Total Collected]', 'E[Legal]', 'E[Net]', 'Collected/SOC'].map(h => (
                    <th key={h} style={{
                      padding: '10px 12px', color: COLORS.textMuted, fontSize: ui.sizes.xs,
                      fontWeight: 700, textAlign: h === 'Claim' || h === 'Jurisdiction' ? 'left' : 'right',
                      textTransform: 'uppercase', borderBottom: `1px solid ${COLORS.cardBorder}`,
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {perClaim.map((c, i) => {
                  const claimMeta = claims.find(cl => cl.claim_id === c.claim_id) || {};
                  const colRatio = c.soc_cr > 0 ? c.e_collected_cr / c.soc_cr : 0;
                  const netColor = c.e_net_cr >= 0 ? '#22C55E' : COLORS.accent5;
                  const interest = c.e_interest_cr || 0;
                  // ★★★ CORRECT FORMULA: E[Principal] = E[Q|Win] × Win_Rate ★★★
                  const principal = (claimMeta.expected_quantum_cr || 0) * (c.win_rate || 0);
                  return (
                    <tr key={i} style={{ background: i % 2 === 0 ? '#0F121980' : 'transparent' }}>
                      <td style={{ padding: '10px 12px', color: COLORS.textBright, fontSize: ui.sizes.sm, fontWeight: 700 }}>{getClaimDisplayName(claimMeta || c)}</td>
                      <td style={{ padding: '10px 12px', color: COLORS.textMuted, fontSize: ui.sizes.sm }}>
                        <span style={{
                          display: 'inline-block', padding: '2px 8px', borderRadius: 4, fontSize: ui.sizes.xs, fontWeight: 600,
                          background: c.jurisdiction === 'siac' ? '#06B6D420' : '#A78BFA20',
                          color: c.jurisdiction === 'siac' ? COLORS.accent1 : '#A78BFA',
                        }}>{c.jurisdiction?.toUpperCase()}</span>
                      </td>
                      <td style={{ padding: '10px 12px', color: COLORS.textBright, fontSize: ui.sizes.sm, fontWeight: 600, textAlign: 'right' }}>{fmtCr(c.soc_cr)}</td>
                      <td style={{ padding: '10px 12px', color: COLORS.accent4, fontSize: ui.sizes.sm, fontWeight: 600, textAlign: 'right' }}>{fmtCr(claimMeta.expected_quantum_cr || c.eq_cr)}</td>
                      <td style={{ padding: '10px 12px', color: COLORS.accent2, fontSize: ui.sizes.sm, fontWeight: 600, textAlign: 'right' }}>{fmtPct(c.win_rate)}</td>
                      {meta.interest_enabled && (
                        <>
                          <td style={{ padding: '10px 12px', color: COLORS.accent3, fontSize: ui.sizes.sm, fontWeight: 600, textAlign: 'right' }}>{fmtCr(principal)}</td>
                          <td style={{ padding: '10px 12px', color: COLORS.accent4, fontSize: ui.sizes.sm, fontWeight: 600, textAlign: 'right' }}>{fmtCr(interest)}</td>
                        </>
                      )}
                      <td style={{ padding: '10px 12px', color: COLORS.accent6, fontSize: ui.sizes.sm, fontWeight: 700, textAlign: 'right' }}>{fmtCr(c.e_collected_cr)}</td>
                      <td style={{ padding: '10px 12px', color: COLORS.accent5, fontSize: ui.sizes.sm, fontWeight: 600, textAlign: 'right' }}>{fmtCr(c.e_legal_cr)}</td>
                      <td style={{ padding: '10px 12px', color: netColor, fontSize: ui.sizes.sm, fontWeight: 700, textAlign: 'right' }}>{fmtCr(c.e_net_cr)}</td>
                      <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6 }}>
                          <div style={{ width: 50, height: 6, background: '#1F2937', borderRadius: 3, overflow: 'hidden' }}>
                            <div style={{ height: '100%', width: `${Math.min(colRatio * 100, 100)}%`, background: colRatio > 0.4 ? COLORS.accent3 : COLORS.accent7, borderRadius: 3 }} />
                          </div>
                          <span style={{ color: COLORS.textMuted, fontSize: ui.sizes.xs, fontWeight: 600, minWidth: 36, textAlign: 'right' }}>{fmtPct(colRatio)}</span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {/* Totals row */}
                {(() => {
                  const totalInterest = perClaim.reduce((s, c) => s + (c.e_interest_cr || 0), 0);
                  // ★★★ CORRECT FORMULA: E[Principal] = Σ(E[Q|Win] × Win_Rate) ★★★
                  const totalPrincipal = claims.reduce((sum, cl) => sum + (cl.expected_quantum_cr || 0) * (cl.win_rate || 0), 0);
                  return (
                    <tr style={{ borderTop: `2px solid ${COLORS.cardBorder}` }}>
                      <td style={{ padding: '12px 12px', color: COLORS.textBright, fontSize: ui.sizes.sm, fontWeight: 800 }}>PORTFOLIO</td>
                      <td style={{ padding: '12px 12px', color: COLORS.textMuted, fontSize: ui.sizes.xs }}>{claims.length} claims</td>
                      <td style={{ padding: '12px 12px', color: COLORS.textBright, fontSize: ui.sizes.sm, fontWeight: 800, textAlign: 'right' }}>{fmtCr(ps.total_soc_cr)}</td>
                      <td style={{ padding: '12px 12px', color: COLORS.accent4, fontSize: ui.sizes.sm, fontWeight: 800, textAlign: 'right' }}>{fmtCr(ps.total_eq_cr)}</td>
                      <td style={{ padding: '12px 12px', color: COLORS.accent2, fontSize: ui.sizes.sm, fontWeight: 800, textAlign: 'right' }}>{fmtPct(ps.avg_win_rate)}</td>
                      {meta.interest_enabled && (
                        <>
                          <td style={{ padding: '12px 12px', color: COLORS.accent3, fontSize: ui.sizes.sm, fontWeight: 800, textAlign: 'right' }}>{fmtCr(totalPrincipal)}</td>
                          <td style={{ padding: '12px 12px', color: COLORS.accent4, fontSize: ui.sizes.sm, fontWeight: 800, textAlign: 'right' }}>{fmtCr(totalInterest)}</td>
                        </>
                      )}
                      <td style={{ padding: '12px 12px', color: COLORS.accent6, fontSize: ui.sizes.sm, fontWeight: 800, textAlign: 'right' }}>{fmtCr(ps.total_e_collected_cr)}</td>
                      <td style={{ padding: '12px 12px', color: COLORS.accent5, fontSize: ui.sizes.sm, fontWeight: 800, textAlign: 'right' }}>{fmtCr(ps.total_e_legal_cr)}</td>
                      <td style={{ padding: '12px 12px', color: ps.total_e_net_cr >= 0 ? '#22C55E' : COLORS.accent5, fontSize: ui.sizes.sm, fontWeight: 800, textAlign: 'right' }}>{fmtCr(ps.total_e_net_cr)}</td>
                      <td style={{ padding: '12px 12px', color: COLORS.accent6, fontSize: ui.sizes.sm, fontWeight: 800, textAlign: 'right' }}>{fmtPct(ps.collected_over_soc)}</td>
                    </tr>
                  );
                })()}
              </tbody>
            </table>
          </div>
          {/* Calculation note */}
          <div style={{ marginTop: 12, padding: '8px 12px', borderRadius: 6, background: '#111827', fontSize: ui.sizes.xs, color: COLORS.textMuted, lineHeight: 1.6 }}>
            <strong style={{ color: COLORS.textBright }}>How to verify:</strong> E[Principal] + E[Interest] = E[Total Collected]. Then: E[Total Collected] − E[Legal] = E[Net]. Collected/SOC = E[Total Collected] ÷ SOC.
          </div>
        </Card>
      )}

      {/* ── MOIC / IRR Heatmap with Toggle ── */}
      <Card>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 12 }}>
          <SectionTitle number="1" title={`${heatmapMetric === 'irr' ? 'E[IRR]' : 'E[MOIC]'} Heatmap — SOC Pricing`}
            subtitle={`Rows = upfront % of SOC, Columns = ${secondLabel}. ${heatmapMetric === 'irr' ? 'IRR computed as XIRR of expected cashflows (probability‑weighted), not the average of per‑path IRRs.' : 'Toggle between IRR and MOIC views.'}`} />
          <div style={{ display: 'flex', gap: 2, background: '#0F1219', borderRadius: 8, padding: 2 }}>
            {[
              { key: 'irr', label: 'E[IRR]' },
              { key: 'moic', label: 'E[MOIC]' },
            ].map(opt => (
              <button key={opt.key} onClick={() => setHeatmapMetric(opt.key)} style={{
                padding: '6px 16px', borderRadius: 6, border: 'none', cursor: 'pointer',
                fontFamily: FONT, fontSize: ui.sizes.sm, fontWeight: 700,
                color: heatmapMetric === opt.key ? '#fff' : COLORS.textMuted,
                background: heatmapMetric === opt.key
                  ? `linear-gradient(135deg, ${COLORS.accent1}, ${COLORS.accent2})`
                  : 'transparent',
                transition: 'all 0.2s',
              }}>{opt.label}</button>
            ))}
          </div>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 3, fontFamily: FONT }}>
            <thead>
              <tr>
                <th style={{ padding: '10px 14px', color: COLORS.textMuted, fontSize: ui.sizes.sm, fontWeight: 600, textAlign: 'left' }}>Upfront</th>
                {displayAwards.map(aw => (
                  <th key={aw} style={{ padding: '10px 14px', color: COLORS.textMuted, fontSize: ui.sizes.sm, fontWeight: 600, textAlign: 'center' }}>
                    {axisMeta.isHybrid ? fmtSecond(aw) : fmtPct(1 - aw)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {heatmapRows.map((row, ri) => (
                <tr key={ri}>
                  <td style={{ padding: '10px 14px', color: COLORS.textBright, fontSize: ui.sizes.sm, fontWeight: 600 }}>{row.upfront}</td>
                  {displayAwards.map(aw => {
                    const moic = row[`aw_${aw}_moic`];
                    const xirr = row[`aw_${aw}_xirr`];
                    const value = heatmapMetric === 'irr' ? xirr : moic;
                    const bgColor = heatmapMetric === 'irr' ? irrColor(value) : moicColor(value);
                    const formatted = heatmapMetric === 'irr' ? fmtPct(value) : fmtMOIC(value);
                    return (
                      <td key={aw} style={{
                        padding: '10px 14px', textAlign: 'center', borderRadius: 6,
                        background: bgColor,
                        color: COLORS.textBright, fontSize: ui.sizes.base, fontWeight: 700,
                      }}>
                        {formatted}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* ── Tail Selector ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: ui.space.md, flexWrap: 'wrap' }}>
        <span style={{ color: COLORS.textMuted, fontSize: ui.sizes.sm, fontWeight: 600 }}>{secondLabel}:</span>
        {displayAwards.map(aw => {
          const tail = axisMeta.isHybrid ? aw : +(1 - aw).toFixed(2);
          return (
            <button key={aw} onClick={() => setSelectedAward(aw)} style={{
              padding: '6px 14px', borderRadius: 6, border: 'none', cursor: 'pointer',
              fontFamily: FONT, fontSize: ui.sizes.sm, fontWeight: 600,
              color: selectedAward === aw ? '#fff' : COLORS.textMuted,
              background: selectedAward === aw ? COLORS.accent1 : COLORS.card,
            }}>
              {axisMeta.isHybrid ? fmtSecond(tail) : fmtPct(tail)}
            </button>
          );
        })}
      </div>

      {/* ── MOIC & IRR vs Upfront ── */}
      <Card>
        <SectionTitle number="2" title={`E[MOIC] & E[IRR] vs Upfront — ${secondLabel} ${fmtSecond(selectedTail)}`}
          subtitle="Dual-axis: MOIC (left, bars) and annualised IRR (right, line) across upfront purchase levels." />
        <ResponsiveContainer width="100%" height={ui.chartHeight.md}>
          <ComposedChart data={lineData} margin={{ top: 10, right: 30, left: 10, bottom: 20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={COLORS.gridLine} />
            <XAxis dataKey="pct" tick={{ fill: COLORS.textMuted, fontSize: ui.sizes.sm }} />
            <YAxis yAxisId="left" tick={{ fill: COLORS.textMuted, fontSize: ui.sizes.sm }} tickFormatter={v => v + '×'}
              label={{ value: 'E[MOIC]', angle: -90, position: 'insideLeft', fill: COLORS.textMuted, fontSize: ui.sizes.sm, dx: -5 }} />
            <YAxis yAxisId="right" orientation="right" tick={{ fill: COLORS.textMuted, fontSize: ui.sizes.sm }} tickFormatter={v => (v * 100).toFixed(0) + '%'}
              label={{ value: 'E[IRR]', angle: 90, position: 'insideRight', fill: COLORS.textMuted, fontSize: ui.sizes.sm, dx: 5 }} />
            <Tooltip cursor={{ fill: 'rgba(6,182,212,0.06)' }} content={<CustomTooltip />} />
            <Legend wrapperStyle={{ fontSize: ui.sizes.sm, color: COLORS.textMuted }} />
            <ReferenceLine yAxisId="left" y={1} stroke={COLORS.breakeven} strokeDasharray="8 4" strokeWidth={2} />
            <ReferenceLine yAxisId="right" y={0.30} stroke={COLORS.accent3} strokeDasharray="6 3" strokeWidth={1.5} />
            <Bar yAxisId="left" dataKey="moic" name="E[MOIC]" fill={COLORS.accent1} radius={[6, 6, 0, 0]} barSize={36} fillOpacity={0.8} cursor={BAR_CURSOR} />
            <Line yAxisId="right" type="monotone" dataKey="xirr" stroke={COLORS.accent2} strokeWidth={3}
              dot={{ fill: COLORS.accent2, r: 5, stroke: COLORS.bg, strokeWidth: 2 }} name="E[IRR]" />
          </ComposedChart>
        </ResponsiveContainer>
        <div style={{ display: 'flex', justifyContent: 'center', gap: ui.space.xl, marginTop: 8 }}>
          {[
            { color: COLORS.breakeven, label: 'Breakeven (1.0×)' },
            { color: COLORS.accent3, label: '30% IRR hurdle' },
          ].map(({ color, label }, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ width: 20, height: 3, background: color, borderRadius: 2, borderTop: `2px dashed ${color}`, boxSizing: 'border-box' }} />
              <span style={{ color: COLORS.textMuted, fontSize: ui.sizes.sm }}>{label}</span>
            </div>
          ))}
        </div>
      </Card>

      {/* ── Plot 3: IRR vs P(Loss) ── */}
      <Card>
        <SectionTitle number="3" title={`E[IRR] vs P(Loss) — ${secondLabel} ${fmtSecond(selectedTail)}`}
          subtitle="As upfront % increases, annualised IRR drops and loss probability rises." />
        <ResponsiveContainer width="100%" height={ui.chartHeight.md}>
          <ComposedChart data={lineData} margin={{ top: 10, right: 30, left: 10, bottom: 20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={COLORS.gridLine} />
            <XAxis dataKey="pct" tick={{ fill: COLORS.textMuted, fontSize: ui.sizes.sm }} />
            <YAxis yAxisId="left" tick={{ fill: COLORS.textMuted, fontSize: ui.sizes.sm }} tickFormatter={v => (v * 100).toFixed(0) + '%'}
              label={{ value: 'E[IRR]', angle: -90, position: 'insideLeft', fill: COLORS.textMuted, fontSize: ui.sizes.sm, dx: -5 }} />
            <YAxis yAxisId="right" orientation="right" tick={{ fill: COLORS.textMuted, fontSize: ui.sizes.sm }} tickFormatter={v => fmtPct(v)}
              label={{ value: 'P(Loss)', angle: 90, position: 'insideRight', fill: COLORS.textMuted, fontSize: ui.sizes.sm, dx: 5 }} />
            <Tooltip cursor={{ fill: 'rgba(6,182,212,0.06)' }} content={<CustomTooltip />} />
            <Legend wrapperStyle={{ fontSize: ui.sizes.sm, color: COLORS.textMuted }} />
            <ReferenceLine yAxisId="left" y={0.30} stroke={COLORS.accent3} strokeDasharray="6 3" strokeWidth={1.5} />
            <ReferenceLine yAxisId="left" y={0} stroke={COLORS.accent5} strokeDasharray="8 4" strokeWidth={1} />
            <Bar yAxisId="left" dataKey="xirr" name="E[IRR]" fill={COLORS.accent2} radius={[6, 6, 0, 0]} barSize={36} fillOpacity={0.8} cursor={BAR_CURSOR} />
            <Line yAxisId="right" type="monotone" dataKey="p_loss" stroke={COLORS.accent5} strokeWidth={2.5}
              dot={{ fill: COLORS.accent5, r: 5, stroke: COLORS.bg, strokeWidth: 2 }} name="P(Loss)" />
          </ComposedChart>
        </ResponsiveContainer>
        <div style={{ display: 'flex', justifyContent: 'center', gap: ui.space.xl, marginTop: 8 }}>
          {[
            { color: COLORS.accent3, label: '30% IRR hurdle' },
            { color: COLORS.accent5, label: '0% IRR breakeven' },
          ].map(({ color, label }, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ width: 20, height: 3, background: color, borderRadius: 2 }} />
              <span style={{ color: COLORS.textMuted, fontSize: ui.sizes.sm }}>{label}</span>
            </div>
          ))}
        </div>
      </Card>

      {/* ── Plot 4: MOIC vs P(Loss) ── */}
      <Card>
        <SectionTitle number="4" title={`MOIC vs P(Loss) — ${secondLabel} ${fmtSecond(selectedTail)}`}
          subtitle="As upfront % increases, MOIC drops and loss probability rises." />
        <ResponsiveContainer width="100%" height={ui.chartHeight.md}>
          <ComposedChart data={lineData} margin={{ top: 10, right: 30, left: 10, bottom: 20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={COLORS.gridLine} />
            <XAxis dataKey="pct" tick={{ fill: COLORS.textMuted, fontSize: ui.sizes.sm }} />
            <YAxis yAxisId="left" tick={{ fill: COLORS.textMuted, fontSize: ui.sizes.sm }} tickFormatter={v => v + '×'} />
            <YAxis yAxisId="right" orientation="right" tick={{ fill: COLORS.textMuted, fontSize: ui.sizes.sm }} tickFormatter={v => fmtPct(v)} />
            <Tooltip cursor={{ fill: 'rgba(6,182,212,0.06)' }} content={<CustomTooltip />} />
            <Legend wrapperStyle={{ fontSize: ui.sizes.sm, color: COLORS.textMuted }} />
            <ReferenceLine yAxisId="left" y={1} stroke={COLORS.breakeven} strokeDasharray="8 4" strokeWidth={2} />
            <Bar yAxisId="left" dataKey="moic" name="E[MOIC]" fill={COLORS.accent1} radius={[6, 6, 0, 0]} barSize={36} fillOpacity={0.8} cursor={BAR_CURSOR} />
            <Line yAxisId="right" type="monotone" dataKey="p_loss" stroke={COLORS.accent5} strokeWidth={2.5}
              dot={{ fill: COLORS.accent5, r: 5, stroke: COLORS.bg, strokeWidth: 2 }} name="P(Loss)" />
          </ComposedChart>
        </ResponsiveContainer>
      </Card>

      {/* ── Plot 5: Per-Claim Breakeven Bars ── */}
      {breakevenMax.length > 0 && (
        <Card>
          <SectionTitle number="5" title="Maximum Breakeven Purchase Price (MOIC ≥ 1.0×)"
            subtitle="Max upfront % of SOC an investor can pay and still expect breakeven. At 30% Tail." />
          <ResponsiveContainer width="100%" height={Math.max(280, breakevenMax.length * 50)}>
            <BarChart data={breakevenMax} layout="vertical" margin={{ top: 10, right: 30, left: 10, bottom: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={COLORS.gridLine} />
              <XAxis type="number" tick={{ fill: COLORS.textMuted, fontSize: ui.sizes.sm }} tickFormatter={v => v + '%'} domain={[0, 'auto']} />
              <YAxis dataKey="claim" type="category" tick={{ fill: COLORS.textMuted, fontSize: ui.sizes.sm }} width={80} />
              <Tooltip cursor={{ fill: 'rgba(6,182,212,0.06)' }} content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const d = payload[0]?.payload;
                return (
                  <div style={{ background: COLORS.card, border: `1px solid ${COLORS.cardBorder}`, borderRadius: 8, padding: '10px 14px', fontFamily: FONT }}>
                    <div style={{ color: COLORS.textBright, fontWeight: 700, fontSize: ui.sizes.sm }}>{d.fullId}</div>
                    <div style={{ color: COLORS.accent1, fontSize: ui.sizes.sm }}>Max Breakeven: {d.socBE.toFixed(1)}% of SOC</div>
                    <div style={{ color: COLORS.textMuted, fontSize: ui.sizes.sm }}>= ₹{(d.soc * d.socBE / 100).toFixed(0)} Cr</div>
                  </div>
                );
              }} />
              <Bar dataKey="socBE" name="Max % of SOC" radius={[0, 6, 6, 0]} barSize={18} cursor={BAR_CURSOR}>
                {breakevenMax.map((entry, idx) => (
                  <Cell key={idx} fill={entry.socBE < 15 ? COLORS.accent5 : entry.socBE < 25 ? COLORS.accent7 : COLORS.accent1} fillOpacity={0.85} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>
      )}

      {/* ── Breakeven Cards ── */}
      {breakevenMax.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: ui.space.lg }}>
          {breakevenMax.map((c, i) => {
            const isWeak   = c.socBE < 15;
            const isMedium = c.socBE >= 15 && c.socBE < 25;
            const beInvest = c.soc * c.socBE / 100;
            return (
              <div key={i} style={{
                background: COLORS.card, border: `1px solid ${isWeak ? '#EF444440' : COLORS.cardBorder}`,
                borderRadius: 12, padding: 20, position: 'relative', overflow: 'hidden',
              }}>
                {isWeak && (
                  <div style={{
                    position: 'absolute', top: 12, right: 12,
                    background: '#EF444430', color: COLORS.accent5,
                    padding: '2px 8px', borderRadius: 4, fontSize: ui.sizes.xs, fontWeight: 700,
                  }}>HIGH RISK</div>
                )}
                {isMedium && (
                  <div style={{
                    position: 'absolute', top: 12, right: 12,
                    background: '#F59E0B30', color: COLORS.accent7,
                    padding: '2px 8px', borderRadius: 4, fontSize: ui.sizes.xs, fontWeight: 700,
                  }}>MODERATE</div>
                )}
                <div style={{ color: COLORS.textBright, fontSize: ui.sizes.lg, fontWeight: 700, marginBottom: 4 }}>{c.fullId}</div>
                <div style={{ color: COLORS.textMuted, fontSize: ui.sizes.sm, marginBottom: 16 }}>
                  {c.archetype} | SOC ₹{c.soc.toLocaleString()} Cr
                </div>
                <div>
                  <div style={{ color: COLORS.textMuted, fontSize: ui.sizes.xs, fontWeight: 600, marginBottom: 4, textTransform: 'uppercase' }}>SOC BREAKEVEN</div>
                  <div style={{ color: isWeak ? COLORS.accent5 : COLORS.accent1, fontSize: ui.sizes.hero, fontWeight: 800 }}>{c.socBE.toFixed(0)}%</div>
                  <div style={{ color: COLORS.textMuted, fontSize: ui.sizes.sm, marginTop: 2 }}>
                    = ₹{beInvest.toFixed(0)} Cr max investment
                  </div>
                </div>
                {/* headroom bar */}
                <div style={{ marginTop: 14 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ color: COLORS.textMuted, fontSize: ui.sizes.xs }}>Headroom</span>
                    <span style={{ color: COLORS.textMuted, fontSize: ui.sizes.xs }}>{c.socBE.toFixed(0)}%</span>
                  </div>
                  <div style={{ height: 8, background: '#1F2937', borderRadius: 4, overflow: 'hidden' }}>
                    <div style={{
                      height: '100%', width: `${Math.min(c.socBE, 100)}%`,
                      background: isWeak
                        ? `linear-gradient(90deg, ${COLORS.accent5}, #EF444480)`
                        : `linear-gradient(90deg, ${COLORS.accent1}, ${COLORS.accent4})`,
                      borderRadius: 4,
                    }} />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════
         Plot 6: Comprehensive Risk Analytics
         ═══════════════════════════════════════════════════════════════════ */}
      <RiskAnalytics grid={grid} upfrontPcts={upfrontPcts} awardPcts={awardPcts} displayAwards={displayAwards}
        selectedAward={selectedAward} selectedTail={selectedTail} lineData={lineData} totalSOC={totalSOC} ui={ui} axisMeta={axisMeta} />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Risk Analytics sub-component — four advanced risk visualizations
   ═══════════════════════════════════════════════════════════════════════════ */
function RiskAnalytics({ grid, upfrontPcts, awardPcts, displayAwards, selectedAward, selectedTail, lineData, totalSOC, ui, axisMeta }) {
  const fmtSecond = axisMeta?.formatSecond || (v => fmtPct(v));
  const secondLabel = axisMeta?.secondAxisLabel || 'Tail';
  const [riskMetric, setRiskMetric] = useState('var');

  /* ── VaR/CVaR heatmap data ── */
  const riskHeatmapRows = useMemo(() => {
    return upfrontPcts.map(up => {
      const row = { upfront: `${(up * 100).toFixed(0)}%` };
      for (const aw of awardPcts) {
        const cell = grid.find(g => g.upfront_pct === up && g.award_share_pct === aw);
        row[`aw_${aw}_var`] = cell?.var_1 ?? null;
        row[`aw_${aw}_cvar`] = cell?.cvar_1 ?? null;
      }
      return row;
    });
  }, [grid, upfrontPcts, awardPcts]);

  /* ── Risk-Return scatter data ── */
  const scatterData = useMemo(() => {
    const tailPcts = [...new Set(grid.map(g => axisMeta.rowToSecond(g)))].sort((a, b) => a - b);
    const SCATTER_COLORS = [COLORS.accent1, COLORS.accent2, COLORS.accent3, COLORS.accent4, COLORS.accent6, COLORS.accent7];
    return grid.map(g => {
      const tail = axisMeta.rowToSecond(g);
      const tailIdx = tailPcts.indexOf(tail);
      return {
        p_loss: g.p_loss,
        mean_moic: g.mean_moic,
        investment: totalSOC * g.upfront_pct,
        tail,
        upfront_pct: g.upfront_pct,
        mean_xirr: g.mean_xirr,
        fill: SCATTER_COLORS[tailIdx % SCATTER_COLORS.length],
        label: `${fmtPct(g.upfront_pct)} up / ${fmtSecond(tail)} ${secondLabel}`,
      };
    });
  }, [grid, totalSOC]);

  /* ── Sharpe-like ratio data (for selected tail) ── */
  const sharpeData = useMemo(() => {
    return lineData.map(d => {
      const cell = grid.find(g =>
        g.upfront_pct === d.upfront_pct && Math.abs(g.award_share_pct - selectedAward) < 0.001
      );
      const stdMoic = cell?.std_moic || 1;
      const sharpe = stdMoic > 0 ? (d.moic - 1) / stdMoic : 0;
      return {
        pct: d.pct,
        sharpe: Math.max(sharpe, -2),
        moic: d.moic,
        std_moic: stdMoic,
      };
    });
  }, [lineData, grid, selectedTail]);

  /* ── Tail risk data (for selected tail) ── */
  const tailRiskData = useMemo(() => {
    return lineData.map(d => {
      const cell = grid.find(g =>
        g.upfront_pct === d.upfront_pct && Math.abs(g.award_share_pct - selectedAward) < 0.001
      );
      return {
        pct: d.pct,
        p_loss: d.p_loss,
        cvar: cell?.cvar_1 ?? 0,
        var5: cell?.var_1 ?? 0,
      };
    });
  }, [lineData, grid, selectedTail]);

  return (
    <Card>
      <SectionTitle number="6" title="Risk Analytics" subtitle="Comprehensive downside risk assessment — VaR/CVaR heatmaps, risk-return frontier, Sharpe ratios, and tail risk." />

      <div style={{ display: 'flex', flexDirection: 'column', gap: ui.space.xl }}>

        {/* ── 6a. VaR/CVaR Heatmap ── */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
            <span style={{ color: COLORS.textBright, fontSize: ui.sizes.base, fontWeight: 700 }}>6a. Value at Risk Heatmap</span>
            <div style={{ display: 'flex', gap: 2, background: '#0F1219', borderRadius: 6, padding: 2 }}>
              {[
                { key: 'var', label: 'VaR 1%' },
                { key: 'cvar', label: 'CVaR 1%' },
              ].map(opt => (
                <button key={opt.key} onClick={() => setRiskMetric(opt.key)} style={{
                  padding: '4px 12px', borderRadius: 4, border: 'none', cursor: 'pointer',
                  fontFamily: FONT, fontSize: ui.sizes.sm, fontWeight: 600,
                  color: riskMetric === opt.key ? '#fff' : COLORS.textMuted,
                  background: riskMetric === opt.key ? COLORS.accent5 + 'CC' : 'transparent',
                  transition: 'all 0.2s',
                }}>{opt.label}</button>
              ))}
            </div>
            <span style={{ color: COLORS.textMuted, fontSize: ui.sizes.xs, marginLeft: 'auto' }}>
              {riskMetric === 'var' ? 'VaR 1%: worst 1st-percentile net return (₹ Cr)' : 'CVaR 1%: expected loss in worst 1% scenarios (₹ Cr)'}
            </span>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 3, fontFamily: FONT }}>
              <thead>
                <tr>
                  <th style={{ padding: '8px 12px', color: COLORS.textMuted, fontSize: ui.sizes.sm, fontWeight: 600, textAlign: 'left' }}>Upfront</th>
                  {displayAwards.map(aw => (
                    <th key={aw} style={{ padding: '8px 12px', color: COLORS.textMuted, fontSize: ui.sizes.sm, fontWeight: 600, textAlign: 'center' }}>
                      {axisMeta?.isHybrid ? fmtSecond(aw) : fmtPct(1 - aw)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {riskHeatmapRows.map((row, ri) => (
                  <tr key={ri}>
                    <td style={{ padding: '8px 12px', color: COLORS.textBright, fontSize: ui.sizes.sm, fontWeight: 600 }}>{row.upfront}</td>
                    {displayAwards.map(aw => {
                      const val = riskMetric === 'var' ? row[`aw_${aw}_var`] : row[`aw_${aw}_cvar`];
                      const otherVal = riskMetric === 'var' ? row[`aw_${aw}_cvar`] : row[`aw_${aw}_var`];
                      return (
                        <td key={aw} title={otherVal != null ? `${riskMetric === 'var' ? 'CVaR' : 'VaR'}: ₹${otherVal?.toFixed(1)} Cr` : ''} style={{
                          padding: '8px 12px', textAlign: 'center', borderRadius: 6,
                          background: val != null ? varColor(val) : '#1F2937',
                          color: COLORS.textBright, fontSize: ui.sizes.sm, fontWeight: 700,
                          cursor: 'help',
                        }}>
                          {val != null ? `₹${val.toFixed(0)}` : '—'}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* ── 6b. Risk-Return Scatter Plot ── */}
        <div>
          <div style={{ marginBottom: 8 }}>
            <span style={{ color: COLORS.textBright, fontSize: ui.sizes.base, fontWeight: 700 }}>6b. Risk-Return Frontier</span>
            <span style={{ color: COLORS.textMuted, fontSize: ui.sizes.sm, marginLeft: 12 }}>Each dot = one grid cell. Size = investment amount. Quadrants separated at P(Loss) = 10%, MOIC = 2.0×.</span>
          </div>
          <ResponsiveContainer width="100%" height={ui.chartHeight.lg}>
            <ScatterChart margin={{ top: 20, right: 30, left: 20, bottom: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={COLORS.gridLine} />
              <XAxis type="number" dataKey="p_loss" name="P(Loss)" tick={{ fill: COLORS.textMuted, fontSize: ui.sizes.sm }}
                tickFormatter={v => fmtPct(v)} label={{ value: 'P(Loss)', position: 'bottom', fill: COLORS.textMuted, fontSize: ui.sizes.sm }} />
              <YAxis type="number" dataKey="mean_moic" name="E[MOIC]" tick={{ fill: COLORS.textMuted, fontSize: ui.sizes.sm }}
                tickFormatter={v => v + '×'} label={{ value: 'E[MOIC]', angle: -90, position: 'insideLeft', fill: COLORS.textMuted, fontSize: ui.sizes.sm }} />
              <ZAxis type="number" dataKey="investment" range={[30, 300]} />
              <Tooltip cursor={{ fill: 'rgba(6,182,212,0.06)' }} content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const d = payload[0]?.payload;
                return (
                  <div style={{ background: '#1F2937', border: `1px solid ${COLORS.cardBorder}`, borderRadius: 10, padding: '12px 16px', fontFamily: FONT, minWidth: 200 }}>
                    <div style={{ color: COLORS.textBright, fontWeight: 700, fontSize: ui.sizes.base, marginBottom: 6 }}>{d.label}</div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 12px', fontSize: ui.sizes.sm }}>
                      <span style={{ color: COLORS.textMuted }}>E[MOIC]:</span>
                      <span style={{ color: COLORS.accent1, fontWeight: 600 }}>{fmtMOIC(d.mean_moic)}</span>
                      <span style={{ color: COLORS.textMuted }}>E[IRR]:</span>
                      <span style={{ color: COLORS.accent2, fontWeight: 600 }}>{fmtPct(d.mean_xirr)}</span>
                      <span style={{ color: COLORS.textMuted }}>P(Loss):</span>
                      <span style={{ color: COLORS.accent5, fontWeight: 600 }}>{fmtPct(d.p_loss)}</span>
                      <span style={{ color: COLORS.textMuted }}>Investment:</span>
                      <span style={{ color: COLORS.text, fontWeight: 600 }}>{fmtCr(d.investment)}</span>
                    </div>
                  </div>
                );
              }} />
              <ReferenceLine x={0.10} stroke={COLORS.accent5} strokeDasharray="6 3" strokeWidth={1.5}
                label={{ value: 'P(Loss)=10%', fill: COLORS.accent5, fontSize: 10, position: 'top' }} />
              <ReferenceLine y={2.0} stroke={COLORS.accent4} strokeDasharray="6 3" strokeWidth={1.5}
                label={{ value: 'MOIC=2.0×', fill: COLORS.accent4, fontSize: 10, position: 'right' }} />
              <Scatter data={scatterData} shape="circle">
                {scatterData.map((entry, idx) => (
                  <Cell key={idx} fill={entry.fill} fillOpacity={0.7} stroke={entry.fill} strokeWidth={1} />
                ))}
              </Scatter>
            </ScatterChart>
          </ResponsiveContainer>
          {/* Quadrant labels */}
          <div style={{ display: 'flex', justifyContent: 'center', gap: ui.space.xl, marginTop: 6 }}>
            {[
              { color: COLORS.accent4, label: '★ Low Risk / High Return' },
              { color: COLORS.accent3, label: 'Low Risk / Low Return' },
              { color: COLORS.accent2, label: 'High Risk / High Return' },
              { color: COLORS.accent5, label: '✗ High Risk / Low Return' },
            ].map(({ color, label }, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <div style={{ width: 10, height: 10, borderRadius: '50%', background: color }} />
                <span style={{ color: COLORS.textMuted, fontSize: ui.sizes.xs }}>{label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* ── 6c. Risk-Adjusted Return (Sharpe-like) ── */}
        <div>
          <div style={{ marginBottom: 8 }}>
            <span style={{ color: COLORS.textBright, fontSize: ui.sizes.base, fontWeight: 700 }}>6c. Risk-Adjusted Return (Sharpe-like Ratio)</span>
            <span style={{ color: COLORS.textMuted, fontSize: ui.sizes.sm, marginLeft: 12 }}>(MOIC − 1) / σ(MOIC) at {secondLabel} {fmtSecond(selectedTail)}. Higher = better risk-adjusted return.</span>
          </div>
          <ResponsiveContainer width="100%" height={ui.chartHeight.md}>
            <BarChart data={sharpeData} margin={{ top: 10, right: 30, left: 10, bottom: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={COLORS.gridLine} />
              <XAxis dataKey="pct" tick={{ fill: COLORS.textMuted, fontSize: ui.sizes.sm }}
                label={{ value: 'Upfront %', position: 'bottom', fill: COLORS.textMuted, fontSize: ui.sizes.sm }} />
              <YAxis tick={{ fill: COLORS.textMuted, fontSize: ui.sizes.sm }}
                label={{ value: 'Sharpe Ratio', angle: -90, position: 'insideLeft', fill: COLORS.textMuted, fontSize: ui.sizes.sm }} />
              <Tooltip cursor={{ fill: 'rgba(6,182,212,0.06)' }} content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const d = payload[0]?.payload;
                return (
                  <div style={{ background: '#1F2937', border: `1px solid ${COLORS.cardBorder}`, borderRadius: 8, padding: '10px 14px', fontFamily: FONT }}>
                    <div style={{ color: COLORS.textBright, fontWeight: 700, fontSize: ui.sizes.sm }}>Upfront: {d.pct}</div>
                    <div style={{ color: COLORS.accent4, fontSize: ui.sizes.sm }}>Sharpe: {d.sharpe.toFixed(3)}</div>
                    <div style={{ color: COLORS.textMuted, fontSize: ui.sizes.sm }}>MOIC: {fmtMOIC(d.moic)} | σ: {d.std_moic?.toFixed(2)}</div>
                  </div>
                );
              }} />
              <ReferenceLine y={1} stroke={COLORS.accent3} strokeDasharray="6 3" strokeWidth={1}
                label={{ value: 'Sharpe=1', fill: COLORS.accent3, fontSize: 10, position: 'right' }} />
              <Bar dataKey="sharpe" name="Sharpe Ratio" radius={[6, 6, 0, 0]} barSize={36} cursor={BAR_CURSOR}>
                {sharpeData.map((entry, idx) => (
                  <Cell key={idx}
                    fill={entry.sharpe >= 1.5 ? COLORS.accent4 : entry.sharpe >= 1.0 ? COLORS.accent1 : entry.sharpe >= 0.5 ? COLORS.accent3 : COLORS.accent5}
                    fillOpacity={0.85} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <div style={{ display: 'flex', justifyContent: 'center', gap: ui.space.lg, marginTop: 6 }}>
            {[
              { color: COLORS.accent4, label: 'Excellent (≥1.5)' },
              { color: COLORS.accent1, label: 'Good (≥1.0)' },
              { color: COLORS.accent3, label: 'Fair (≥0.5)' },
              { color: COLORS.accent5, label: 'Poor (<0.5)' },
            ].map(({ color, label }, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <div style={{ width: 14, height: 14, background: color, borderRadius: 3, opacity: 0.85 }} />
                <span style={{ color: COLORS.textMuted, fontSize: ui.sizes.xs }}>{label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* ── 6d. Tail Risk Distribution ── */}
        <div>
          <div style={{ marginBottom: 8 }}>
            <span style={{ color: COLORS.textBright, fontSize: ui.sizes.base, fontWeight: 700 }}>6d. Tail Risk Distribution</span>
            <span style={{ color: COLORS.textMuted, fontSize: ui.sizes.sm, marginLeft: 12 }}>P(Loss) and CVaR 1% across upfront levels at {secondLabel} {fmtSecond(selectedTail)}.</span>
          </div>
          <ResponsiveContainer width="100%" height={ui.chartHeight.md}>
            <ComposedChart data={tailRiskData} margin={{ top: 10, right: 30, left: 10, bottom: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={COLORS.gridLine} />
              <XAxis dataKey="pct" tick={{ fill: COLORS.textMuted, fontSize: ui.sizes.sm }}
                label={{ value: 'Upfront %', position: 'bottom', fill: COLORS.textMuted, fontSize: ui.sizes.sm }} />
              <YAxis yAxisId="left" tick={{ fill: COLORS.textMuted, fontSize: ui.sizes.sm }} tickFormatter={v => fmtPct(v)}
                label={{ value: 'P(Loss)', angle: -90, position: 'insideLeft', fill: COLORS.textMuted, fontSize: ui.sizes.sm }} />
              <YAxis yAxisId="right" orientation="right" tick={{ fill: COLORS.textMuted, fontSize: ui.sizes.sm }}
                tickFormatter={v => `₹${v.toFixed(0)}`}
                label={{ value: 'CVaR 1% (₹ Cr)', angle: 90, position: 'insideRight', fill: COLORS.textMuted, fontSize: ui.sizes.sm }} />
              <Tooltip cursor={{ fill: 'rgba(6,182,212,0.06)' }} content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const d = payload[0]?.payload;
                return (
                  <div style={{ background: '#1F2937', border: `1px solid ${COLORS.cardBorder}`, borderRadius: 8, padding: '10px 14px', fontFamily: FONT }}>
                    <div style={{ color: COLORS.textBright, fontWeight: 700, fontSize: ui.sizes.sm }}>Upfront: {d.pct}</div>
                    <div style={{ color: COLORS.accent5, fontSize: ui.sizes.sm }}>P(Loss): {fmtPct(d.p_loss)}</div>
                    <div style={{ color: COLORS.accent7, fontSize: ui.sizes.sm }}>CVaR 1%: ₹{d.cvar?.toFixed(1)} Cr</div>
                    <div style={{ color: COLORS.textMuted, fontSize: ui.sizes.sm }}>VaR 1%: ₹{d.var5?.toFixed(1)} Cr</div>
                  </div>
                );
              }} />
              <ReferenceLine yAxisId="left" y={0.10} stroke={COLORS.accent3} strokeDasharray="6 3" strokeWidth={1.5}
                label={{ value: '10% threshold', fill: COLORS.accent3, fontSize: 10, position: 'right' }} />
              <Bar yAxisId="left" dataKey="p_loss" name="P(Loss)" fill={COLORS.accent5} radius={[6, 6, 0, 0]} barSize={36} fillOpacity={0.7} cursor={BAR_CURSOR} />
              <Line yAxisId="right" type="monotone" dataKey="cvar" stroke={COLORS.accent7} strokeWidth={2.5}
                dot={{ fill: COLORS.accent7, r: 5, stroke: COLORS.bg, strokeWidth: 2 }} name="CVaR 1% (₹ Cr)" />
            </ComposedChart>
          </ResponsiveContainer>
          <div style={{ display: 'flex', justifyContent: 'center', gap: ui.space.xl, marginTop: 8 }}>
            {[
              { color: COLORS.accent5, label: 'P(Loss)', style: 'bar' },
              { color: COLORS.accent7, label: 'CVaR 1% (₹ Cr)', style: 'line' },
              { color: COLORS.accent3, label: '10% loss threshold', style: 'dash' },
            ].map(({ color, label, style }, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                {style === 'bar' ? (
                  <div style={{ width: 14, height: 14, background: color, borderRadius: 3, opacity: 0.7 }} />
                ) : style === 'line' ? (
                  <div style={{ width: 20, height: 3, background: color, borderRadius: 2 }} />
                ) : (
                  <div style={{ width: 20, height: 2, borderTop: `2px dashed ${color}` }} />
                )}
                <span style={{ color: COLORS.textMuted, fontSize: ui.sizes.sm }}>{label}</span>
              </div>
            ))}
          </div>
        </div>

      </div>
    </Card>
  );
}
