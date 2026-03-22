/**
 * PricingGrid.jsx — Pricing heatmaps (MOIC, IRR, P(Loss)) + breakeven curve.
 * Structure: monetisation_upfront_tail
 *
 * Sections:
 *  1 MOIC Heatmap (upfront% × tail%)
 *  2 IRR Heatmap
 *  3 P(Loss) Heatmap
 *  4 Breakeven Curve
 *  5 Selected Cell Detail
 */

import React, { useState, useMemo } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts';
import { COLORS, FONT, useUISettings, fmtPct, fmtMOIC, moicColor, irrColor, lossColor } from '../theme';
import { Card, SectionTitle, KPI, CustomTooltip } from './Shared';

/* ── Colour helpers ── */
function moicCellColor(v) {
  if (v >= 2.0) return '#065F46';
  if (v >= 1.5) return '#047857';
  if (v >= 1.0) return '#D97706';
  if (v >= 0.5) return '#C2410C';
  return '#991B1B';
}
function irrCellColor(v) {
  if (v >= 0.30) return '#065F46';
  if (v >= 0.20) return '#047857';
  if (v >= 0.10) return '#D97706';
  if (v >= 0.0)  return '#C2410C';
  return '#991B1B';
}
function lossCellColor(v) {
  if (v <= 0.20) return '#065F46';
  if (v <= 0.30) return '#047857';
  if (v <= 0.40) return '#D97706';
  if (v <= 0.50) return '#C2410C';
  return '#991B1B';
}

export default function PricingGrid({ data }) {
  const { ui } = useUISettings();
  const grid = data?.investment_grid || {};
  const meta = data?.simulation_meta || {};
  const beData = data?.breakeven_data || [];
  const [selectedCell, setSelectedCell] = useState(null);
  const [heatmapType, setHeatmapType] = useState('moic'); // moic | irr | ploss

  const gridKeys = Object.keys(grid);
  if (gridKeys.length === 0) {
    return <Card><SectionTitle title="Pricing Grid" subtitle="No investment_grid data available. Run the engine with monetisation_upfront_tail structure." /></Card>;
  }

  // Parse grid dimensions
  const upfronts = [...new Set(gridKeys.map(k => parseInt(k.split('_')[0])))].sort((a, b) => a - b);
  const tails = [...new Set(gridKeys.map(k => parseInt(k.split('_')[1])))].sort((a, b) => a - b);

  // Best cell
  const bestEntry = gridKeys.reduce((best, k) => {
    const c = grid[k];
    return (!best || c.mean_moic > grid[best].mean_moic) ? k : best;
  }, null);
  const bestCell = grid[bestEntry] || {};
  const [bestUp, bestTail] = (bestEntry || '0_0').split('_').map(Number);

  // Breakeven curve data
  const breakevenLine = beData.map(b => ({
    tail: `${(b.tail_pct * 100).toFixed(0)}%`,
    tailVal: b.tail_pct * 100,
    maxUpfront: b.max_upfront_pct * 100,
  }));

  const colorFn = heatmapType === 'moic' ? moicCellColor
    : heatmapType === 'irr' ? irrCellColor : lossCellColor;

  const fmtCell = (val) => {
    if (heatmapType === 'moic') return fmtMOIC(val);
    if (heatmapType === 'irr') return fmtPct(val);
    return fmtPct(val);
  };

  const getValue = (cell) => {
    if (heatmapType === 'moic') return cell.mean_moic;
    if (heatmapType === 'irr') return cell.mean_xirr;
    return cell.p_loss;
  };

  const activeCell = selectedCell ? grid[selectedCell] : null;
  const [selUp, selTail] = selectedCell ? selectedCell.split('_').map(Number) : [null, null];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: ui.space.xl }}>

      {/* ── Summary KPIs ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: ui.space.md }}>
        <KPI label="Grid Size" value={`${upfronts.length}×${tails.length}`} sub={`${gridKeys.length} cells`} color={COLORS.accent6} />
        <KPI label="MC Paths" value={(meta.n_paths || 0).toLocaleString()} color={COLORS.accent2} />
        <KPI label="Best E[MOIC]" value={fmtMOIC(bestCell.mean_moic)} sub={`${bestUp}% up / ${bestTail}% tail`} color={COLORS.accent4} />
        <KPI label="Best E[IRR]" value={fmtPct(bestCell.mean_xirr)} color={COLORS.accent1} />
        <KPI label="Best P(Loss)" value={fmtPct(bestCell.p_loss)} sub="lowest" color={COLORS.accent5} />
      </div>

      {/* ── Metric toggle ── */}
      <Card>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: ui.space.lg }}>
          <span style={{ color: COLORS.textMuted, fontSize: ui.sizes.sm, fontWeight: 600 }}>Heatmap Metric:</span>
          {[
            { id: 'moic', label: 'E[MOIC]' },
            { id: 'irr', label: 'E[IRR]' },
            { id: 'ploss', label: 'P(Loss)' },
          ].map(m => (
            <button key={m.id} onClick={() => setHeatmapType(m.id)} style={{
              padding: '6px 14px', borderRadius: 6, border: 'none', cursor: 'pointer',
              fontFamily: FONT, fontSize: ui.sizes.sm, fontWeight: heatmapType === m.id ? 700 : 500,
              color: heatmapType === m.id ? '#fff' : COLORS.textMuted,
              background: heatmapType === m.id ? COLORS.accent1 : COLORS.card,
            }}>{m.label}</button>
          ))}
        </div>

        <SectionTitle number="1" title={`${heatmapType === 'moic' ? 'E[MOIC]' : heatmapType === 'irr' ? 'E[IRR]' : 'P(Loss)'} Heatmap`}
          subtitle={`Upfront % (rows) × Tail % (columns). Click any cell to inspect. ${(meta.n_paths || 0).toLocaleString()} MC paths.`} />

        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'separate', borderSpacing: 2, width: '100%', fontSize: 12 }}>
            <thead>
              <tr>
                <th style={{ padding: '8px 6px', color: COLORS.textMuted, fontWeight: 700, fontSize: 11, position: 'sticky', left: 0, background: COLORS.card, zIndex: 2 }}>
                  Up \ Tail
                </th>
                {tails.map(t => (
                  <th key={t} style={{ padding: '6px 4px', color: COLORS.textMuted, fontWeight: 600, fontSize: 11, textAlign: 'center', minWidth: 52 }}>
                    {t}%
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {upfronts.map(u => (
                <tr key={u}>
                  <td style={{ padding: '6px 8px', color: COLORS.accent1, fontWeight: 700, fontSize: 12, position: 'sticky', left: 0, background: COLORS.card, zIndex: 1 }}>
                    {u}%
                  </td>
                  {tails.map(t => {
                    const key = `${u}_${t}`;
                    const cell = grid[key];
                    if (!cell) return <td key={t} style={{ background: '#1F2937', textAlign: 'center', fontSize: 10 }}>—</td>;
                    const val = getValue(cell);
                    const isSelected = selectedCell === key;
                    return (
                      <td key={t}
                        onClick={() => setSelectedCell(key)}
                        style={{
                          padding: '5px 3px', textAlign: 'center', cursor: 'pointer',
                          background: colorFn(val),
                          border: isSelected ? '2px solid #fff' : '1px solid transparent',
                          borderRadius: 3, fontWeight: isSelected ? 800 : 600,
                          color: '#ffffffDD', fontSize: 11,
                          transition: 'all 0.15s ease',
                        }}
                        title={`${u}% up / ${t}% tail → ${fmtCell(val)}`}
                      >
                        {fmtCell(val)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* ── Breakeven Curve ── */}
      {breakevenLine.length > 0 && (
        <Card>
          <SectionTitle number="2" title="Breakeven Curve"
            subtitle="Maximum viable upfront % at each tail % where E[MOIC] ≥ 1.0×." />
          <ResponsiveContainer width="100%" height={ui.chartHeight?.md || 380}>
            <LineChart data={breakevenLine} margin={{ top: 16, right: 30, left: 10, bottom: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={COLORS.gridLine} />
              <XAxis dataKey="tail" tick={{ fill: COLORS.textMuted, fontSize: 12 }} label={{ value: 'Tail %', fill: COLORS.textMuted, fontSize: 13, position: 'bottom', offset: 0 }} />
              <YAxis tick={{ fill: COLORS.textMuted, fontSize: 12 }} label={{ value: 'Max Upfront %', fill: COLORS.textMuted, fontSize: 13, angle: -90, position: 'insideLeft' }} domain={[0, 'auto']} />
              <Tooltip content={<CustomTooltip />} />
              <ReferenceLine y={0} stroke={COLORS.accent5} strokeDasharray="4 4" />
              <Line type="monotone" dataKey="maxUpfront" stroke={COLORS.accent3} strokeWidth={3} dot={{ r: 5, fill: COLORS.accent3 }} name="Max Upfront %" />
            </LineChart>
          </ResponsiveContainer>
        </Card>
      )}

      {/* ── Selected Cell Detail ── */}
      {activeCell && (
        <Card>
          <SectionTitle number="3" title={`Cell Detail — ${selUp}% Upfront / ${selTail}% Tail`}
            subtitle="Full metrics for the selected pricing cell." />

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: ui.space.md, marginBottom: ui.space.lg }}>
            {[
              { label: 'E[MOIC]', value: fmtMOIC(activeCell.mean_moic), color: moicColor(activeCell.mean_moic) },
              { label: 'Median MOIC', value: fmtMOIC(activeCell.median_moic), color: COLORS.accent1 },
              { label: 'E[IRR]', value: fmtPct(activeCell.mean_xirr), color: irrColor(activeCell.mean_xirr) },
              { label: 'P(Loss)', value: fmtPct(activeCell.p_loss), color: lossColor(activeCell.p_loss) },
              { label: 'P(IRR>30%)', value: fmtPct(activeCell.p_hurdle), color: COLORS.accent4 },
              { label: 'VaR (1%)', value: fmtMOIC(activeCell.var_1), color: COLORS.accent5 },
              { label: 'CVaR (1%)', value: fmtMOIC(activeCell.cvar_1), color: COLORS.accent5 },
              { label: 'Fund Share', value: `${100 - selTail}%`, color: COLORS.accent2 },
            ].map((item, i) => (
              <div key={i} style={{
                textAlign: 'center', padding: 14, borderRadius: 10,
                background: '#0F1219', border: `1px solid ${COLORS.cardBorder}`,
              }}>
                <div style={{ color: COLORS.textMuted, fontSize: ui.sizes.xs, fontWeight: 600, textTransform: 'uppercase', marginBottom: 4 }}>{item.label}</div>
                <div style={{ color: typeof item.color === 'function' ? '#fff' : item.color, fontSize: ui.sizes.xl, fontWeight: 800 }}>{item.value}</div>
              </div>
            ))}
          </div>

          {/* Per-claim breakdown */}
          {activeCell.per_claim && (
            <>
              <SectionTitle title="Per-Claim Breakdown" subtitle="Individual claim metrics at this pricing point." />
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: '0 4px', fontFamily: FONT }}>
                  <thead>
                    <tr>
                      {['Claim', 'E[MOIC]', 'Median MOIC', 'E[IRR]', 'P(Loss)', 'P(Hurdle)'].map(h => (
                        <th key={h} style={{
                          padding: '10px 12px', color: COLORS.textMuted, fontSize: ui.sizes.xs,
                          fontWeight: 700, textAlign: h === 'Claim' ? 'left' : 'right',
                          textTransform: 'uppercase', borderBottom: `1px solid ${COLORS.cardBorder}`,
                        }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(activeCell.per_claim).map(([claimId, cl], i) => (
                      <tr key={claimId} style={{ background: i % 2 === 0 ? '#0F121980' : 'transparent' }}>
                        <td style={{ padding: '10px 12px', color: COLORS.textBright, fontSize: ui.sizes.sm, fontWeight: 700 }}>{claimId}</td>
                        <td style={{ padding: '10px 12px', color: moicColor(cl.mean_moic), fontSize: ui.sizes.sm, fontWeight: 600, textAlign: 'right' }}>{fmtMOIC(cl.mean_moic)}</td>
                        <td style={{ padding: '10px 12px', color: COLORS.text, fontSize: ui.sizes.sm, textAlign: 'right' }}>{fmtMOIC(cl.median_moic)}</td>
                        <td style={{ padding: '10px 12px', color: irrColor(cl.mean_xirr), fontSize: ui.sizes.sm, fontWeight: 600, textAlign: 'right' }}>{fmtPct(cl.mean_xirr)}</td>
                        <td style={{ padding: '10px 12px', color: lossColor(cl.p_loss), fontSize: ui.sizes.sm, fontWeight: 600, textAlign: 'right' }}>{fmtPct(cl.p_loss)}</td>
                        <td style={{ padding: '10px 12px', color: COLORS.accent4, fontSize: ui.sizes.sm, fontWeight: 600, textAlign: 'right' }}>{fmtPct(cl.p_hurdle)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </Card>
      )}
    </div>
  );
}
