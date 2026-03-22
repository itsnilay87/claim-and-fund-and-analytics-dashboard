/**
 * InvestmentEQ.jsx — Tab 5: EQ-based investment grid + SOC vs EQ comparison.
 * Labels use "Tata Tail %" (the percentage Tata retains of the award).
 */

import React, { useState } from 'react';
import {
  ComposedChart, Line, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend, ReferenceLine,
} from 'recharts';
import { COLORS, FONT, SIZES, SPACE, CHART_HEIGHT, CHART_FONT, fmtCr, fmtPct, fmtMOIC, moicColor, lossColor } from '../theme';
import { Card, SectionTitle, KPI, CustomTooltip } from './Shared';

export default function InvestmentEQ({ data }) {
  const gridEQ = data.investment_grid_eq || [];
  const gridSOC = data.investment_grid_soc || [];
  const meta = data.simulation_meta;
  const claims = data.claims;

  if (gridEQ.length === 0) {
    return <Card><SectionTitle title="No EQ grid data" subtitle="Run with --pricing-basis eq or both" /></Card>;
  }

  const totalSOC = meta.total_soc_cr;
  const totalEQ = claims.reduce((s, c) => s + c.expected_quantum_cr, 0);
  const upfrontPcts = [...new Set(gridEQ.map(g => g.upfront_pct))].sort((a, b) => a - b);
  const awardPcts = [...new Set(gridEQ.map(g => g.award_share_pct))].sort((a, b) => a - b);
  const tailPcts = [...new Set(gridEQ.map(g => g.tata_tail_pct ?? +(1 - g.award_share_pct).toFixed(2)))].sort((a, b) => a - b);

  // Default selection: 30% Tata Tail = 0.70 award share
  const defaultAward = awardPcts.find(a => Math.abs(a - 0.70) < 0.001) || awardPcts[Math.floor(awardPcts.length / 2)];
  const [selectedAward, setSelectedAward] = useState(defaultAward);
  const selectedTail = +(1 - selectedAward).toFixed(2);

  const bestCell = gridEQ.reduce((a, b) => a.mean_moic > b.mean_moic ? a : b, gridEQ[0]);
  const bestTail = bestCell.tata_tail_pct ?? +(1 - bestCell.award_share_pct).toFixed(2);

  // Heatmap
  const heatmapRows = upfrontPcts.map(up => {
    const row = { upfront: `${(up * 100).toFixed(0)}%` };
    for (const aw of awardPcts) {
      const cell = gridEQ.find(g => g.upfront_pct === up && g.award_share_pct === aw);
      row[`aw_${aw}`] = cell?.mean_moic || 0;
    }
    return row;
  });

  // SOC vs EQ comparison at selected award share
  const comparisonData = upfrontPcts.map(up => {
    const socCell = gridSOC.find(g => g.upfront_pct === up && g.award_share_pct === selectedAward);
    const eqCell = gridEQ.find(g => g.upfront_pct === up && g.award_share_pct === selectedAward);
    return {
      pct: `${(up * 100).toFixed(0)}%`,
      soc_moic: socCell?.mean_moic || 0,
      eq_moic: eqCell?.mean_moic || 0,
      soc_ploss: socCell?.p_loss || 0,
      eq_ploss: eqCell?.p_loss || 0,
      soc_inv: totalSOC * up,
      eq_inv: totalEQ * up,
    };
  });

  // EQ line data
  const lineData = upfrontPcts.map(up => {
    const cell = gridEQ.find(g => g.upfront_pct === up && g.award_share_pct === selectedAward);
    return {
      pct: `${(up * 100).toFixed(0)}%`,
      moic: cell?.mean_moic || 0,
      p_loss: cell?.p_loss || 0,
      investment_cr: totalEQ * up,
      net_return_cr: cell?.mean_net_return_cr || 0,
    };
  });

  // Display awardPcts reversed so Tata Tail reads left-to-right ascending
  const displayAwards = [...awardPcts].sort((a, b) => b - a);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: SPACE.xl }}>
      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: SPACE.md }}>
        <KPI label="Total E[Q]" value={fmtCr(totalEQ)} sub={fmtPct(totalEQ / totalSOC) + ' of SOC'} color={COLORS.accent2} />
        <KPI label="Grid Size" value={`${upfrontPcts.length}×${tailPcts.length}`} sub="upfront × tail" color={COLORS.accent6} />
        <KPI label="Best MOIC" value={fmtMOIC(bestCell.mean_moic)} sub={`${fmtPct(bestCell.upfront_pct)} upfront / ${fmtPct(bestTail)} tail`} color={COLORS.accent4} />
        <KPI label="Best P(Loss)" value={fmtPct(bestCell.p_loss)} color={COLORS.accent5} />
        <KPI label="SOC/EQ Ratio" value={`${(totalSOC / totalEQ).toFixed(2)}×`} sub="SOC is larger" color={COLORS.accent3} />
      </div>

      {/* EQ MOIC Heatmap */}
      <Card>
        <SectionTitle number="1" title="E[MOIC] Heatmap — EQ Pricing" subtitle="Rows = upfront to Tata %, Columns = Tata Tail %. EQ pricing yields higher MOIC because E[Q] < SOC." />
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 3, fontFamily: FONT }}>
            <thead>
              <tr>
                <th style={{ padding: '10px 14px', color: COLORS.textMuted, fontSize: SIZES.sm, fontWeight: 600, textAlign: 'left' }}>Upfront</th>
                {displayAwards.map(aw => (
                  <th key={aw} style={{ padding: '10px 14px', color: COLORS.textMuted, fontSize: SIZES.sm, fontWeight: 600, textAlign: 'center' }}>{fmtPct(1 - aw)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {heatmapRows.map((row, ri) => (
                <tr key={ri}>
                  <td style={{ padding: '10px 14px', color: COLORS.textBright, fontSize: SIZES.sm, fontWeight: 600 }}>{row.upfront}</td>
                  {displayAwards.map(aw => {
                    const moic = row[`aw_${aw}`];
                    return (
                      <td key={aw} style={{
                        padding: '10px 14px', textAlign: 'center', borderRadius: 6,
                        background: moicColor(moic), color: COLORS.textBright, fontSize: SIZES.base, fontWeight: 700,
                      }}>{fmtMOIC(moic)}</td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Tata Tail selector */}
      <div style={{ display: 'flex', alignItems: 'center', gap: SPACE.md, flexWrap: 'wrap' }}>
        <span style={{ color: COLORS.textMuted, fontSize: SIZES.sm }}>Tata Tail:</span>
        {displayAwards.map(aw => {
          const tail = +(1 - aw).toFixed(2);
          return (
            <button key={aw} onClick={() => setSelectedAward(aw)} style={{
              padding: '6px 14px', borderRadius: 6, border: 'none', cursor: 'pointer',
              fontFamily: FONT, fontSize: SIZES.sm, fontWeight: 600,
              color: selectedAward === aw ? '#fff' : COLORS.textMuted,
              background: selectedAward === aw ? COLORS.accent2 : COLORS.card,
            }}>{fmtPct(tail)}</button>
          );
        })}
      </div>

      {/* SOC vs EQ MOIC comparison */}
      <Card>
        <SectionTitle number="2" title={`SOC vs EQ — MOIC Comparison (Tata Tail ${fmtPct(selectedTail)})`}
          subtitle="EQ pricing consistently delivers higher MOIC because the denominator (E[Q]) is smaller than SOC." />
        <ResponsiveContainer width="100%" height={360}>
          <ComposedChart data={comparisonData} margin={{ top: 10, right: 30, left: 10, bottom: 20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={COLORS.gridLine} />
            <XAxis dataKey="pct" tick={{ fill: COLORS.textMuted, fontSize: SIZES.sm }} />
            <YAxis tick={{ fill: COLORS.textMuted, fontSize: SIZES.sm }} tickFormatter={v => v + '×'} />
            <Tooltip cursor={{ fill: 'rgba(6,182,212,0.06)' }} content={<CustomTooltip />} />
            <Legend wrapperStyle={{ fontSize: SIZES.sm, color: COLORS.textMuted }} />
            <ReferenceLine y={1} stroke={COLORS.breakeven} strokeDasharray="8 4" strokeWidth={2} />
            <Line type="monotone" dataKey="soc_moic" stroke={COLORS.accent1} strokeWidth={3} dot={{ fill: COLORS.accent1, r: 5, stroke: COLORS.bg, strokeWidth: 2 }} name="SOC E[MOIC]" />
            <Line type="monotone" dataKey="eq_moic" stroke={COLORS.accent2} strokeWidth={3} dot={{ fill: COLORS.accent2, r: 5, stroke: COLORS.bg, strokeWidth: 2 }} name="EQ E[MOIC]" />
          </ComposedChart>
        </ResponsiveContainer>
        <div style={{ display: 'flex', justifyContent: 'center', gap: SPACE.xxl, marginTop: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: SPACE.sm }}>
            <div style={{ width: 24, height: 3, background: COLORS.accent1, borderRadius: 2 }} />
            <span style={{ color: COLORS.textMuted, fontSize: SIZES.sm }}>SOC-Based</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: SPACE.sm }}>
            <div style={{ width: 24, height: 3, background: COLORS.accent2, borderRadius: 2 }} />
            <span style={{ color: COLORS.textMuted, fontSize: SIZES.sm }}>EQ-Based</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: SPACE.sm }}>
            <div style={{ width: 24, height: 3, background: COLORS.breakeven, borderRadius: 2 }} />
            <span style={{ color: COLORS.textMuted, fontSize: SIZES.sm }}>Breakeven (1.0×)</span>
          </div>
        </div>
      </Card>

      {/* Capital deployed: SOC vs EQ */}
      <Card>
        <SectionTitle number="3" title={`Capital Deployed: SOC vs EQ (Tata Tail ${fmtPct(selectedTail)})`}
          subtitle="At the same upfront %, SOC requires more capital because SOC > E[Q]." />
        <ResponsiveContainer width="100%" height={320}>
          <ComposedChart data={comparisonData} margin={{ top: 10, right: 20, left: 20, bottom: 20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={COLORS.gridLine} />
            <XAxis dataKey="pct" tick={{ fill: COLORS.textMuted, fontSize: SIZES.sm }} />
            <YAxis tick={{ fill: COLORS.textMuted, fontSize: SIZES.sm }} tickFormatter={v => '₹' + v.toFixed(0)} />
            <Tooltip cursor={{ fill: 'rgba(6,182,212,0.06)' }} content={<CustomTooltip />} />
            <Legend wrapperStyle={{ fontSize: SIZES.sm, color: COLORS.textMuted }} />
            <Bar dataKey="soc_inv" name="SOC Inv (₹ Cr)" fill={COLORS.accent1} radius={[4, 4, 0, 0]} barSize={24} />
            <Bar dataKey="eq_inv" name="EQ Inv (₹ Cr)" fill={COLORS.accent2} radius={[4, 4, 0, 0]} barSize={24} />
          </ComposedChart>
        </ResponsiveContainer>
      </Card>

      {/* P(Loss) comparison */}
      <Card>
        <SectionTitle number="4" title={`P(Loss) Comparison — SOC vs EQ`}
          subtitle="EQ pricing has lower loss probabilities because the investment amount is smaller." />
        <ResponsiveContainer width="100%" height={300}>
          <ComposedChart data={comparisonData} margin={{ top: 10, right: 20, left: 10, bottom: 20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={COLORS.gridLine} />
            <XAxis dataKey="pct" tick={{ fill: COLORS.textMuted, fontSize: SIZES.sm }} />
            <YAxis tick={{ fill: COLORS.textMuted, fontSize: SIZES.sm }} tickFormatter={v => fmtPct(v)} />
            <Tooltip cursor={{ fill: 'rgba(6,182,212,0.06)' }} content={<CustomTooltip />} />
            <Legend wrapperStyle={{ fontSize: SIZES.sm, color: COLORS.textMuted }} />
            <Line type="monotone" dataKey="soc_ploss" stroke={COLORS.accent1} strokeWidth={2.5} dot={{ fill: COLORS.accent1, r: 4 }} name="SOC P(Loss)" />
            <Line type="monotone" dataKey="eq_ploss" stroke={COLORS.accent2} strokeWidth={2.5} dot={{ fill: COLORS.accent2, r: 4 }} name="EQ P(Loss)" />
          </ComposedChart>
        </ResponsiveContainer>
      </Card>
    </div>
  );
}
