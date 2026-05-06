/**
 * InvestmentSOC.jsx — Tab 4: SOC-based investment grid, heatmap, MOIC lines.
 * Labels use "Tata Tail %" (the percentage Tata retains of the award).
 */

import React, { useState } from 'react';
import {
  ComposedChart, Line, Bar, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend, ReferenceLine,
} from 'recharts';
import { COLORS, FONT, CHART_COLORS, SIZES, SPACE, CHART_HEIGHT, CHART_FONT, fmtCr, fmtPct, fmtMOIC, moicColor, lossColor } from '../theme';
import { Card, SectionTitle, KPI, CustomTooltip } from './Shared';

export default function InvestmentSOC({ data }) {
  const grid = data.investment_grid_soc || [];
  const meta = data.simulation_meta;
  const claims = data.claims;

  if (grid.length === 0) {
    return <Card><SectionTitle title="No SOC grid data" subtitle="Run with --pricing-basis soc or both" /></Card>;
  }

  const totalSOC = meta.total_soc_cr;
  const upfrontPcts = [...new Set(grid.map(g => g.upfront_pct))].sort((a, b) => a - b);
  // Extract tata_tail_pct (with fallback to 1 - award_share_pct)
  const tailPcts = [...new Set(grid.map(g => g.tata_tail_pct ?? +(1 - g.award_share_pct).toFixed(2)))].sort((a, b) => a - b);
  // Keep award_share_pcts for data lookup (reverse sorted to align with ascending tail)
  const awardPcts = [...new Set(grid.map(g => g.award_share_pct))].sort((a, b) => a - b);

  // Default selection: 30% Tata Tail = 0.70 award share
  const defaultAward = awardPcts.find(a => Math.abs(a - 0.70) < 0.001) || awardPcts[Math.floor(awardPcts.length / 2)];
  const [selectedAward, setSelectedAward] = useState(defaultAward);
  const selectedTail = +(1 - selectedAward).toFixed(2);

  // Filter grid for selected award share
  const lineData = upfrontPcts.map(up => {
    const cell = grid.find(g => g.upfront_pct === up && g.award_share_pct === selectedAward);
    return {
      pct: `${(up * 100).toFixed(0)}%`,
      upfront_pct: up,
      moic: cell?.mean_moic || 0,
      xirr: cell?.mean_xirr || 0,
      p_loss: cell?.p_loss || 0,
      net_return_cr: cell?.mean_net_return_cr || 0,
      investment_cr: totalSOC * up,
    };
  });

  // Heatmap: rows=upfront, cols=tail (ascending)
  const heatmapRows = upfrontPcts.map(up => {
    const row = { upfront: `${(up * 100).toFixed(0)}%` };
    for (const aw of awardPcts) {
      const cell = grid.find(g => g.upfront_pct === up && g.award_share_pct === aw);
      row[`aw_${aw}`] = cell?.mean_moic || 0;
      row[`loss_${aw}`] = cell?.p_loss || 0;
    }
    return row;
  });

  // Best cell
  const bestCell = grid.reduce((a, b) => (a.mean_moic > b.mean_moic ? a : b), grid[0]);
  const bestTail = bestCell.tata_tail_pct ?? +(1 - bestCell.award_share_pct).toFixed(2);

  // Display awardPcts reversed so that Tata-tail reads left-to-right ascending
  const displayAwards = [...awardPcts].sort((a, b) => b - a); // 0.90, 0.85, ... → tail 10%, 15%, ...

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: SPACE.xl }}>
      {/* Investment Statistics — comprehensive overview at top */}
      <Card>
        <SectionTitle title="Investment Statistics — SOC Pricing"
          subtitle={`Portfolio summary across ${grid.length} grid cells (${upfrontPcts.length} upfront × ${tailPcts.length} tail combinations). ${meta.n_paths.toLocaleString()} MC paths.`} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: SPACE.md, marginTop: 8 }}>
          {(() => {
            // Compute aggregate stats at reference 30% tail (70% award)
            const refCells = grid.filter(g => Math.abs(g.award_share_pct - 0.70) < 0.001);
            const avgMoic = refCells.length > 0 ? refCells.reduce((s, c) => s + c.mean_moic, 0) / refCells.length : 0;
            const avgIrr = refCells.length > 0 ? refCells.reduce((s, c) => s + (c.mean_xirr || 0), 0) / refCells.length : 0;
            const avgPloss = refCells.length > 0 ? refCells.reduce((s, c) => s + c.p_loss, 0) / refCells.length : 0;
            const minInvest = refCells.length > 0 ? Math.min(...refCells.map(c => totalSOC * c.upfront_pct)) : 0;
            const maxInvest = refCells.length > 0 ? Math.max(...refCells.map(c => totalSOC * c.upfront_pct)) : 0;
            // Find sweet spot: highest MOIC with P(Loss) < 30%
            const safe = grid.filter(g => g.p_loss < 0.30).sort((a, b) => b.mean_moic - a.mean_moic);
            const sweetSpot = safe[0];
            const sweetTail = sweetSpot ? (sweetSpot.tata_tail_pct ?? +(1 - sweetSpot.award_share_pct).toFixed(2)) : 0;

            return [
              { label: 'Total SOC', value: fmtCr(totalSOC), sub: '6 claims', color: COLORS.accent1 },
              { label: 'Best E[MOIC]', value: fmtMOIC(bestCell.mean_moic), sub: `@ ${fmtPct(bestCell.upfront_pct)} up / ${fmtPct(bestTail)} tail`, color: COLORS.accent4 },
              { label: 'Best E[IRR]', value: fmtPct(bestCell.mean_xirr || 0), sub: 'annualized', color: COLORS.accent2 },
              { label: 'Best P(Loss)', value: fmtPct(bestCell.p_loss), sub: 'lowest in grid', color: COLORS.accent5 },
              { label: 'Avg MOIC @30% Tail', value: fmtMOIC(avgMoic), sub: 'across all upfronts', color: COLORS.accent3 },
              { label: 'Avg IRR @30% Tail', value: fmtPct(avgIrr), sub: 'across all upfronts', color: COLORS.accent6 },
              { label: 'Investment Range', value: `₹${minInvest.toFixed(0)}–${maxInvest.toFixed(0)} Cr`, sub: '@30% tail', color: COLORS.textMuted },
              { label: 'Sweet Spot', value: sweetSpot ? `${fmtPct(sweetSpot.upfront_pct)} / ${fmtPct(sweetTail)}` : 'N/A',
                sub: sweetSpot ? `MOIC ${fmtMOIC(sweetSpot.mean_moic)}, P(Loss)<30%` : '', color: COLORS.accent4 },
            ].map((stat, i) => (
              <div key={i} style={{
                textAlign: 'center', padding: 14, borderRadius: 10,
                background: '#0F1219', border: `1px solid ${COLORS.cardBorder}`,
              }}>
                <div style={{ color: COLORS.textMuted, fontSize: SIZES.xs, fontWeight: 600, marginBottom: 4, textTransform: 'uppercase' }}>{stat.label}</div>
                <div style={{ color: stat.color, fontSize: SIZES.xl, fontWeight: 800 }}>{stat.value}</div>
                {stat.sub && <div style={{ color: COLORS.textMuted, fontSize: SIZES.xs, marginTop: 2 }}>{stat.sub}</div>}
              </div>
            ));
          })()}
        </div>
      </Card>

      {/* MOIC Heatmap */}
      <Card>
        <SectionTitle number="1" title="E[MOIC] Heatmap — SOC Pricing" subtitle="Rows = upfront to Tata %, Columns = Tail %. Green = attractive, red = loss." />
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 3, fontFamily: FONT }}>
            <thead>
              <tr>
                <th style={{ padding: '10px 14px', color: COLORS.textMuted, fontSize: SIZES.sm, fontWeight: 600, textAlign: 'left' }}>Upfront</th>
                {displayAwards.map(aw => (
                  <th key={aw} style={{ padding: '10px 14px', color: COLORS.textMuted, fontSize: SIZES.sm, fontWeight: 600, textAlign: 'center' }}>
                    {fmtPct(1 - aw)}
                  </th>
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
                        background: moicColor(moic),
                        color: COLORS.textBright, fontSize: SIZES.base, fontWeight: 700,
                      }}>
                        {fmtMOIC(moic)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* IRR + MOIC vs Upfront line chart */}
      <Card>
        <SectionTitle number="1b" title={`E[MOIC] & E[IRR] vs Upfront — Tail ${fmtPct(selectedTail)}`}
          subtitle="Dual-axis: MOIC (left, bars) and annualised IRR (right, line) across upfront purchase levels." />
        <ResponsiveContainer width="100%" height={380}>
          <ComposedChart data={lineData} margin={{ top: 10, right: 30, left: 10, bottom: 20 }}>
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
            <Bar yAxisId="left" dataKey="moic" name="E[MOIC]" fill={COLORS.accent1} radius={[6, 6, 0, 0]} barSize={36} fillOpacity={0.8} />
            <Line yAxisId="right" type="monotone" dataKey="xirr" stroke={COLORS.accent2} strokeWidth={3}
              dot={{ fill: COLORS.accent2, r: 5, stroke: COLORS.bg, strokeWidth: 2 }} name="E[IRR]" />
          </ComposedChart>
        </ResponsiveContainer>
        <div style={{ display: 'flex', justifyContent: 'center', gap: SPACE.xl, marginTop: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 20, height: 3, background: COLORS.breakeven, borderRadius: 2 }} />
            <span style={{ color: COLORS.textMuted, fontSize: SIZES.sm }}>Breakeven (1.0×)</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 20, height: 3, background: COLORS.accent3, borderRadius: 2, borderStyle: 'dashed' }} />
            <span style={{ color: COLORS.textMuted, fontSize: SIZES.sm }}>30% IRR hurdle</span>
          </div>
        </div>
      </Card>

      {/* Tail selector */}
      <div style={{ display: 'flex', alignItems: 'center', gap: SPACE.md, flexWrap: 'wrap' }}>
        <span style={{ color: COLORS.textMuted, fontSize: SIZES.sm }}>Tail:</span>
        {displayAwards.map(aw => {
          const tail = +(1 - aw).toFixed(2);
          return (
            <button key={aw} onClick={() => setSelectedAward(aw)} style={{
              padding: '6px 14px', borderRadius: 6, border: 'none', cursor: 'pointer',
              fontFamily: FONT, fontSize: SIZES.sm, fontWeight: 600,
              color: selectedAward === aw ? '#fff' : COLORS.textMuted,
              background: selectedAward === aw ? COLORS.accent1 : COLORS.card,
            }}>
              {fmtPct(tail)}
            </button>
          );
        })}
      </div>

      {/* MOIC + P(Loss) dual axis chart */}
      <Card>
        <SectionTitle number="3" title={`MOIC vs P(Loss) — Tail ${fmtPct(selectedTail)}`}
          subtitle="As upfront % increases, MOIC drops and loss probability rises." />
        <ResponsiveContainer width="100%" height={360}>
          <ComposedChart data={lineData} margin={{ top: 10, right: 30, left: 10, bottom: 20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={COLORS.gridLine} />
            <XAxis dataKey="pct" tick={{ fill: COLORS.textMuted, fontSize: SIZES.sm }} />
            <YAxis yAxisId="left" tick={{ fill: COLORS.textMuted, fontSize: SIZES.sm }} tickFormatter={v => v + '×'}>
            </YAxis>
            <YAxis yAxisId="right" orientation="right" tick={{ fill: COLORS.textMuted, fontSize: SIZES.sm }} tickFormatter={v => fmtPct(v)} />
            <Tooltip cursor={{ fill: 'rgba(6,182,212,0.06)' }} content={<CustomTooltip />} />
            <Legend wrapperStyle={{ fontSize: SIZES.sm,color: COLORS.textMuted }} />
            <ReferenceLine yAxisId="left" y={1} stroke={COLORS.breakeven} strokeDasharray="8 4" strokeWidth={2} />
            <Bar yAxisId="left" dataKey="moic" name="E[MOIC]" fill={COLORS.accent1} radius={[6, 6, 0, 0]} barSize={36} fillOpacity={0.8} />
            <Line yAxisId="right" type="monotone" dataKey="p_loss" stroke={COLORS.accent5} strokeWidth={2.5} dot={{ fill: COLORS.accent5, r: 5, stroke: COLORS.bg, strokeWidth: 2 }} name="P(Loss)" />
          </ComposedChart>
        </ResponsiveContainer>
      </Card>

      {/* Net return chart */}
      <Card>
        <SectionTitle number="4" title={`E[Net Return] vs Investment — Tail ${fmtPct(selectedTail)}`}
          subtitle="Investment required (₹ Crore) and expected net return." />
        <ResponsiveContainer width="100%" height={320}>
          <ComposedChart data={lineData} margin={{ top: 10, right: 30, left: 20, bottom: 20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={COLORS.gridLine} />
            <XAxis dataKey="pct" tick={{ fill: COLORS.textMuted, fontSize: SIZES.sm }} />
            <YAxis tick={{ fill: COLORS.textMuted, fontSize: SIZES.sm }} tickFormatter={v => '₹' + v.toFixed(0)} />
            <Tooltip cursor={{ fill: 'rgba(6,182,212,0.06)' }} content={<CustomTooltip />} />
            <Legend wrapperStyle={{ fontSize: SIZES.sm, color: COLORS.textMuted }} />
            <Bar dataKey="investment_cr" name="Investment (₹ Cr)" fill={COLORS.accent5} fillOpacity={0.3} radius={[4, 4, 0, 0]} barSize={32} />
            <Line type="monotone" dataKey="net_return_cr" stroke={COLORS.accent4} strokeWidth={3} dot={{ fill: COLORS.accent4, r: 5, stroke: COLORS.bg, strokeWidth: 2 }} name="E[Net Return] (₹ Cr)" />
          </ComposedChart>
        </ResponsiveContainer>
      </Card>

      {/* P(Loss) heatmap */}
      <Card>
        <SectionTitle number="5" title="P(Loss) Heatmap — SOC Pricing" subtitle="Probability that MOIC < 1.0×. Green = safe, red = risky." />
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 3, fontFamily: FONT }}>
            <thead>
              <tr>
                <th style={{ padding: '10px 14px', color: COLORS.textMuted, fontSize: SIZES.sm, fontWeight: 600, textAlign: 'left' }}>Upfront</th>
                {displayAwards.map(aw => (
                  <th key={aw} style={{ padding: '10px 14px', color: COLORS.textMuted, fontSize: SIZES.sm, fontWeight: 600, textAlign: 'center' }}>
                    {fmtPct(1 - aw)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {heatmapRows.map((row, ri) => (
                <tr key={ri}>
                  <td style={{ padding: '10px 14px', color: COLORS.textBright, fontSize: SIZES.sm, fontWeight: 600 }}>{row.upfront}</td>
                  {displayAwards.map(aw => {
                    const pLoss = row[`loss_${aw}`];
                    return (
                      <td key={aw} style={{
                        padding: '10px 14px', textAlign: 'center', borderRadius: 6,
                        background: lossColor(pLoss),
                        color: COLORS.textBright, fontSize: SIZES.base, fontWeight: 700,
                      }}>
                        {fmtPct(pLoss)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
