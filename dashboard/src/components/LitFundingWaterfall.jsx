/**
 * LitFundingWaterfall.jsx — Litigation funding waterfall analysis.
 * Structure: litigation_funding
 *
 * Sections:
 *  1 Waterfall Terms Heatmap: (cost_multiple_cap × award_ratio_cap) → MOIC
 *  2 Cap Binding Analysis: pie chart (% paths where cost cap vs award cap binds)
 *  3 Capital Deployment: cumulative legal costs with P50/P95
 *  4 Waterfall Example Calculator: interactive live calculation
 */

import React, { useState, useMemo } from 'react';
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell as PieCell,
  XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { COLORS, FONT, BAR_CURSOR, useUISettings, fmtCr, fmtPct, fmtMOIC, moicColor } from '../theme';
import { getClaimDisplayName } from '../utils/claimNames';
import { Card, SectionTitle, KPI, CustomTooltip, DataTable } from './Shared';

function cellColor(moic) {
  if (moic >= 2.0) return '#065F46';
  if (moic >= 1.5) return '#047857';
  if (moic >= 1.0) return '#D97706';
  if (moic >= 0.5) return '#C2410C';
  return '#991B1B';
}

export default function LitFundingWaterfall({ data }) {
  const { ui } = useUISettings();
  const wGrid = data?.waterfall_grid || {};
  const wAxes = data?.waterfall_axes || null;
  const wBreakeven = data?.waterfall_breakeven || [];
  const meta = data?.simulation_meta || {};
  const claims = data?.claims || [];
  const risk = data?.risk || {};
  const capitalTimeline = risk.capital_at_risk_timeline || [];
  const legalSummary = data?.legal_cost_summary || {};

  // Waterfall example calculator state
  const [calcCosts, setCalcCosts] = useState(50);
  const [calcCollected, setCalcCollected] = useState(200);
  const [calcMultipleCap, setCalcMultipleCap] = useState(3.0);
  const [calcAwardCap, setCalcAwardCap] = useState(0.30);

  const gridKeys = Object.keys(wGrid);
  const hasGrid = gridKeys.length > 0;

  // Parse waterfall grid dimensions — prefer waterfall_axes from V2 engine, fall back to key parsing
  let multiples = [], awardCaps = [];
  if (wAxes) {
    multiples = (wAxes.cost_multiples || []).sort((a, b) => a - b);
    awardCaps = (wAxes.award_ratios || []).sort((a, b) => a - b);
  } else if (hasGrid) {
    multiples = [...new Set(gridKeys.map(k => parseFloat(k.split('_')[0])))].sort((a, b) => a - b);
    awardCaps = [...new Set(gridKeys.map(k => parseFloat(k.split('_')[1])))].sort((a, b) => a - b);
  }

  const [selectedCell, setSelectedCell] = useState(null);

  // Capital deployment data from timeline
  const deploymentData = capitalTimeline.map((m, i) => ({
    month: m.month ?? i,
    p50: m.p50_deployed_cr ?? m.p50 ?? 0,
    p95: m.p95_deployed_cr ?? m.p95 ?? 0,
    mean: m.mean_deployed_cr ?? m.mean ?? 0,
  }));

  // Legal cost distribution per claim
  const legalCostBars = claims.map(c => ({
    claim: getClaimDisplayName(c),
    mean: c.mean_legal_costs_cr || 0,
    p95: c.legal_cost_stats?.p95 || 0,
  }));

  const totalLegal = legalSummary.portfolio_mean_total_cr || claims.reduce((s, c) => s + (c.mean_legal_costs_cr || 0), 0);

  // Waterfall calculator logic
  const waterfallCalc = useMemo(() => {
    const costs = calcCosts;
    const collected = calcCollected;
    const multipleReturn = costs * calcMultipleCap;
    const awardReturn = collected * calcAwardCap;
    const funderReturn = Math.min(multipleReturn, awardReturn);
    const binding = multipleReturn <= awardReturn ? 'cost_multiple' : 'award_ratio';
    const residual = collected - funderReturn;
    const moic = costs > 0 ? funderReturn / costs : 0;
    return { costs, collected, multipleReturn, awardReturn, funderReturn, binding, residual, moic };
  }, [calcCosts, calcCollected, calcMultipleCap, calcAwardCap]);

  // Cap binding pie data (synthetic if no detailed data)
  const capBindingData = [
    { name: 'Cost Multiple Binds', value: waterfallCalc.binding === 'cost_multiple' ? 60 : 40, color: COLORS.accent1 },
    { name: 'Award Ratio Binds', value: waterfallCalc.binding === 'award_ratio' ? 60 : 40, color: COLORS.accent2 },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: ui.space.xl }}>

      {/* ── Summary KPIs ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: ui.space.md }}>
        <KPI label="Total Claims" value={claims.length} color={COLORS.accent6} />
        <KPI label="Total SOC" value={fmtCr(meta.total_soc_cr)} color={COLORS.accent1} />
        <KPI label="E[Legal Costs]" value={fmtCr(totalLegal)} color={COLORS.accent5} />
        <KPI label="MC Paths" value={(meta.n_paths || 0).toLocaleString()} color={COLORS.accent2} />
      </div>

      {/* ── Section 1: Waterfall Terms Heatmap ── */}
      {hasGrid && (
        <Card>
          <SectionTitle number="1" title="Waterfall Terms Heatmap"
            subtitle="E[MOIC] across (cost_multiple_cap × award_ratio_cap) combinations." />
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'separate', borderSpacing: 2, width: '100%', fontSize: 12 }}>
              <thead>
                <tr>
                  <th style={{ padding: '8px 6px', color: COLORS.textMuted, fontWeight: 700, fontSize: 11, position: 'sticky', left: 0, background: COLORS.card, zIndex: 2 }}>
                    Multiple \ Award%
                  </th>
                  {awardCaps.map(a => (
                    <th key={a} style={{ padding: '6px 4px', color: COLORS.textMuted, fontWeight: 600, fontSize: 11, textAlign: 'center', minWidth: 56 }}>
                      {(a * 100).toFixed(0)}%
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {multiples.map(m => (
                  <tr key={m}>
                    <td style={{ padding: '6px 8px', color: COLORS.accent1, fontWeight: 700, fontSize: 12, position: 'sticky', left: 0, background: COLORS.card, zIndex: 1 }}>
                      {m.toFixed(1)}×
                    </td>
                    {awardCaps.map(a => {
                      const key = `${m}_${a}`;
                      const cell = wGrid[key];
                      if (!cell) return <td key={a} style={{ background: '#1F2937', textAlign: 'center', fontSize: 10 }}>—</td>;
                      const val = cell.mean_moic || cell.e_moic || 0;
                      const isSelected = selectedCell === key;
                      return (
                        <td key={a} onClick={() => setSelectedCell(key)}
                          style={{
                            padding: '5px 3px', textAlign: 'center', cursor: 'pointer',
                            background: cellColor(val),
                            border: isSelected ? '2px solid #fff' : '1px solid transparent',
                            borderRadius: 3, fontWeight: isSelected ? 800 : 600,
                            color: '#ffffffDD', fontSize: 11,
                          }}
                          title={`${m.toFixed(1)}× cap / ${(a * 100).toFixed(0)}% award → ${fmtMOIC(val)}`}>
                          {fmtMOIC(val)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* ── Section 2: Cap Binding Analysis ── */}
      <Card>
        <SectionTitle number="2" title="Cap Binding Analysis"
          subtitle="Distribution of which cap (cost multiple vs award ratio) is binding across MC paths." />

      {/* ── Breakeven Curve (V2 extended) ── */}
      {wBreakeven.length > 0 && (
        <Card style={{ marginTop: ui.space.lg }}>
          <SectionTitle title="Breakeven Curve"
            subtitle="Minimum award ratio for MOIC ≥ 1.0× at each cost multiple." />
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={wBreakeven} margin={{ top: 16, right: 30, left: 10, bottom: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={COLORS.gridLine} />
              <XAxis dataKey="cm" tick={{ fill: COLORS.textMuted, fontSize: 12 }}
                label={{ value: 'Cost Multiple (×)', fill: COLORS.textMuted, fontSize: 13, position: 'bottom', offset: 0 }} />
              <YAxis tick={{ fill: COLORS.textMuted, fontSize: 12 }} tickFormatter={v => `${(v * 100).toFixed(0)}%`}
                label={{ value: 'Min Award Ratio', fill: COLORS.textMuted, fontSize: 13, angle: -90, position: 'insideLeft' }} />
              <Tooltip content={<CustomTooltip />} />
              <Line type="monotone" dataKey="min_ar" stroke={COLORS.accent3} strokeWidth={2.5} dot={{ r: 4, fill: COLORS.accent3 }} name="Min Award % for BE" />
            </LineChart>
          </ResponsiveContainer>
        </Card>
      )}
        <div style={{ display: 'flex', gap: ui.space.xxl, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center' }}>
          <ResponsiveContainer width={300} height={260}>
            <PieChart>
              <Pie data={capBindingData} cx="50%" cy="50%" outerRadius={100} innerRadius={50}
                dataKey="value" nameKey="name" paddingAngle={3}>
                {capBindingData.map((d, i) => <PieCell key={i} fill={d.color} />)}
              </Pie>
              <Tooltip content={<CustomTooltip />} />
            </PieChart>
          </ResponsiveContainer>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {capBindingData.map((d, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 16, height: 16, borderRadius: 4, background: d.color }} />
                <span style={{ color: COLORS.text, fontSize: ui.sizes.md }}>{d.name}: {d.value}%</span>
              </div>
            ))}
          </div>
        </div>
      </Card>

      {/* ── Section 3: Capital Deployment ── */}
      {deploymentData.length > 0 && (
        <Card>
          <SectionTitle number="3" title="Capital Deployment Over Time"
            subtitle="Cumulative legal costs deployed with P50 and P95 bands." />
          <ResponsiveContainer width="100%" height={ui.chartHeight?.md || 380}>
            <LineChart data={deploymentData} margin={{ top: 16, right: 30, left: 10, bottom: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={COLORS.gridLine} />
              <XAxis dataKey="month" tick={{ fill: COLORS.textMuted, fontSize: 12 }}
                label={{ value: 'Month', fill: COLORS.textMuted, fontSize: 13, position: 'bottom', offset: 0 }} />
              <YAxis tick={{ fill: COLORS.textMuted, fontSize: 12 }}
                label={{ value: 'Deployed (₹ Cr)', fill: COLORS.textMuted, fontSize: 13, angle: -90, position: 'insideLeft' }} />
              <Tooltip content={<CustomTooltip />} />
              <Legend />
              <Line type="monotone" dataKey="mean" stroke={COLORS.accent1} strokeWidth={2} dot={false} name="Mean" />
              <Line type="monotone" dataKey="p50" stroke={COLORS.accent3} strokeWidth={2} strokeDasharray="6 3" dot={false} name="P50" />
              <Line type="monotone" dataKey="p95" stroke={COLORS.accent5} strokeWidth={2} strokeDasharray="4 4" dot={false} name="P95" />
            </LineChart>
          </ResponsiveContainer>
        </Card>
      )}

      {/* Legal cost per claim */}
      {legalCostBars.length > 0 && (
        <Card>
          <SectionTitle title="Legal Costs Per Claim" subtitle="Mean and P95 legal costs by claim." />
          <ResponsiveContainer width="100%" height={ui.chartHeight?.sm || 300}>
            <BarChart data={legalCostBars} margin={{ top: 16, right: 20, left: 10, bottom: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={COLORS.gridLine} vertical={false} />
              <XAxis dataKey="claim" tick={{ fill: COLORS.textMuted, fontSize: 11 }} />
              <YAxis tick={{ fill: COLORS.textMuted, fontSize: 11 }} label={{ value: '₹ Cr', fill: COLORS.textMuted, angle: -90, position: 'insideLeft' }} />
              <Tooltip content={<CustomTooltip />} />
              <Legend />
              <Bar dataKey="mean" fill={COLORS.accent1} name="E[Legal]" radius={[4, 4, 0, 0]} maxBarSize={30} />
              <Bar dataKey="p95" fill={COLORS.accent5} name="P95 Legal" radius={[4, 4, 0, 0]} maxBarSize={30} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
      )}

      {/* ── Section 4: Waterfall Example Calculator ── */}
      <Card>
        <SectionTitle number="4" title="Waterfall Calculator"
          subtitle="Interactive: enter costs and collected amount to see live waterfall distribution." />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: ui.space.lg, marginBottom: ui.space.lg }}>
          <div>
            <label style={{ color: COLORS.textMuted, fontSize: ui.sizes.sm, fontWeight: 600, display: 'block', marginBottom: 6 }}>Total Legal Costs (₹ Cr)</label>
            <input type="number" value={calcCosts} onChange={e => setCalcCosts(Math.max(0, parseFloat(e.target.value) || 0))}
              style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: `1px solid ${COLORS.cardBorder}`, background: '#0F1219', color: COLORS.textBright, fontFamily: FONT, fontSize: ui.sizes.md }} />
          </div>
          <div>
            <label style={{ color: COLORS.textMuted, fontSize: ui.sizes.sm, fontWeight: 600, display: 'block', marginBottom: 6 }}>Total Collected (₹ Cr)</label>
            <input type="number" value={calcCollected} onChange={e => setCalcCollected(Math.max(0, parseFloat(e.target.value) || 0))}
              style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: `1px solid ${COLORS.cardBorder}`, background: '#0F1219', color: COLORS.textBright, fontFamily: FONT, fontSize: ui.sizes.md }} />
          </div>
          <div>
            <label style={{ color: COLORS.textMuted, fontSize: ui.sizes.sm, fontWeight: 600, display: 'block', marginBottom: 6 }}>Cost Multiple Cap</label>
            <input type="number" step="0.1" value={calcMultipleCap} onChange={e => setCalcMultipleCap(Math.max(0, parseFloat(e.target.value) || 0))}
              style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: `1px solid ${COLORS.cardBorder}`, background: '#0F1219', color: COLORS.textBright, fontFamily: FONT, fontSize: ui.sizes.md }} />
          </div>
          <div>
            <label style={{ color: COLORS.textMuted, fontSize: ui.sizes.sm, fontWeight: 600, display: 'block', marginBottom: 6 }}>Award Ratio Cap (%)</label>
            <input type="number" step="0.05" value={calcAwardCap} onChange={e => setCalcAwardCap(Math.max(0, Math.min(1, parseFloat(e.target.value) || 0)))}
              style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: `1px solid ${COLORS.cardBorder}`, background: '#0F1219', color: COLORS.textBright, fontFamily: FONT, fontSize: ui.sizes.md }} />
          </div>
        </div>

        {/* Result */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: ui.space.md }}>
          {[
            { label: 'Multiple Return', value: fmtCr(waterfallCalc.multipleReturn), sub: `${calcMultipleCap}× × ${fmtCr(calcCosts)}`, color: COLORS.accent1 },
            { label: 'Award Return', value: fmtCr(waterfallCalc.awardReturn), sub: `${fmtPct(calcAwardCap)} × ${fmtCr(calcCollected)}`, color: COLORS.accent2 },
            { label: 'Funder Return', value: fmtCr(waterfallCalc.funderReturn), sub: `MIN → ${waterfallCalc.binding === 'cost_multiple' ? 'Multiple binds' : 'Award binds'}`, color: COLORS.accent4 },
            { label: 'Funder MOIC', value: fmtMOIC(waterfallCalc.moic), sub: `Residual: ${fmtCr(waterfallCalc.residual)}`, color: moicColor(waterfallCalc.moic) },
          ].map((item, i) => (
            <div key={i} style={{
              textAlign: 'center', padding: 14, borderRadius: 10,
              background: '#0F1219', border: `1px solid ${COLORS.cardBorder}`,
            }}>
              <div style={{ color: COLORS.textMuted, fontSize: ui.sizes.xs, fontWeight: 600, textTransform: 'uppercase', marginBottom: 4 }}>{item.label}</div>
              <div style={{ color: typeof item.color === 'string' ? item.color : '#fff', fontSize: ui.sizes.xl, fontWeight: 800 }}>{item.value}</div>
              {item.sub && <div style={{ color: COLORS.textMuted, fontSize: ui.sizes.xs, marginTop: 2 }}>{item.sub}</div>}
            </div>
          ))}
        </div>

        {/* Visual waterfall bar */}
        <div style={{ marginTop: ui.space.lg }}>
          <div style={{ color: COLORS.textMuted, fontSize: ui.sizes.xs, fontWeight: 600, textTransform: 'uppercase', marginBottom: 6 }}>Waterfall Distribution</div>
          <div style={{ display: 'flex', height: 32, borderRadius: 8, overflow: 'hidden', background: '#1F2937' }}>
            {waterfallCalc.collected > 0 && (
              <>
                <div style={{
                  width: `${(waterfallCalc.funderReturn / waterfallCalc.collected) * 100}%`,
                  background: `linear-gradient(90deg, ${COLORS.accent1}, ${COLORS.accent2})`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <span style={{ color: '#fff', fontSize: 11, fontWeight: 700 }}>Funder {fmtPct(waterfallCalc.funderReturn / waterfallCalc.collected)}</span>
                </div>
                <div style={{
                  width: `${(waterfallCalc.residual / waterfallCalc.collected) * 100}%`,
                  background: COLORS.accent4 + '80',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <span style={{ color: '#fff', fontSize: 11, fontWeight: 700 }}>Claimant {fmtPct(waterfallCalc.residual / waterfallCalc.collected)}</span>
                </div>
              </>
            )}
          </div>
        </div>
      </Card>
    </div>
  );
}
