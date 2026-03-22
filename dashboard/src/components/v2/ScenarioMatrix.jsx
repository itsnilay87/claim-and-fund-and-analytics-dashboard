/**
 * ScenarioMatrix.jsx — Tab 9: Sortable scenario table, decision matrix, CSV download.
 */

import React, { useState, useMemo } from 'react';
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend, ReferenceLine, Cell,
} from 'recharts';
import { COLORS, FONT, SIZES, SPACE, CHART_HEIGHT, CHART_FONT, fmtCr, fmtPct, fmtMOIC, getVerdictStyle, BAR_CURSOR } from '../theme';
import { Card, SectionTitle, KPI, CustomTooltip, Badge } from './Shared';

export default function ScenarioMatrix({ data }) {
  const { scenario_comparison, simulation_meta, investment_grid_soc } = data;
  const [sortKey, setSortKey] = useState('mean_moic');
  const [sortAsc, setSortAsc] = useState(false);

  // Sort scenarios
  const sorted = useMemo(() => {
    const arr = [...scenario_comparison];
    arr.sort((a, b) => {
      const va = a[sortKey] ?? 0;
      const vb = b[sortKey] ?? 0;
      return sortAsc ? va - vb : vb - va;
    });
    return arr;
  }, [scenario_comparison, sortKey, sortAsc]);

  const handleSort = (key) => {
    if (sortKey === key) {
      setSortAsc(!sortAsc);
    } else {
      setSortKey(key);
      setSortAsc(false);
    }
  };

  // CSV download
  const downloadCSV = () => {
    const headers = ['Scenario', 'Basis', 'Upfront%', 'TataTail%', 'Investment_Cr', 'E_MOIC', 'Median_MOIC', 'E_XIRR', 'P_Loss', 'P_IRR_30', 'E_NetReturn_Cr', 'VaR_1', 'CVaR_1', 'Verdict'];
    const rows = sorted.map(s => [
      s.scenario, s.basis, s.upfront_pct, s.tata_tail_pct ?? (1 - (s.award_share_pct || 0)),
      s.investment_cr, s.mean_moic, s.median_moic, s.mean_xirr,
      s.p_loss, s.p_irr_gt_30, s.mean_net_return_cr, s.var_1, s.cvar_1, s.verdict,
    ]);
    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'scenario_comparison.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const best = sorted[0] || {};
  const worst = [...scenario_comparison].sort((a, b) => a.mean_moic - b.mean_moic)[0] || {};

  // Chart data
  const chartData = sorted.map(s => ({
    scenario: s.scenario,
    moic: s.mean_moic,
    xirr: (s.mean_xirr || 0) * 100,
    ploss: s.p_loss * 100,
  }));

  const columns = [
    { key: 'scenario', label: 'Scenario', fmt: v => v },
    { key: 'basis', label: 'Basis', fmt: v => v },
    { key: 'investment_cr', label: 'Investment (₹ Cr)', fmt: v => fmtCr(v) },
    { key: 'mean_moic', label: 'E[MOIC]', fmt: v => fmtMOIC(v) },
    { key: 'median_moic', label: 'Med MOIC', fmt: v => fmtMOIC(v) },
    { key: 'mean_xirr', label: 'E[XIRR]', fmt: v => fmtPct(v) },
    { key: 'p_loss', label: 'P(Loss)', fmt: v => fmtPct(v) },
    { key: 'p_irr_gt_30', label: 'P(IRR>30%)', fmt: v => fmtPct(v) },
    { key: 'mean_net_return_cr', label: 'E[Net Return]', fmt: v => fmtCr(v) },
    { key: 'var_1', label: 'VaR 1%', fmt: v => fmtCr(v) },
    { key: 'verdict', label: 'Verdict', fmt: v => v },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: SPACE.xl }}>
      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: SPACE.md }}>
        <KPI label="Best Scenario" value={best.scenario || 'N/A'} sub={fmtMOIC(best.mean_moic)} color={COLORS.accent4} />
        <KPI label="Best Verdict" value={best.verdict || 'N/A'} color={getVerdictStyle(best.verdict).color} />
        <KPI label="Worst MOIC" value={fmtMOIC(worst.mean_moic)} sub={worst.scenario} color={COLORS.accent5} />
        <KPI label="Scenarios" value={sorted.length} color={COLORS.accent6} />
        <KPI label="N Paths" value={simulation_meta.n_paths.toLocaleString()} color={COLORS.textMuted} />
      </div>

      {/* Chart: MOIC + P(Loss) dual axis */}
      <Card>
        <SectionTitle number="1" title="Scenario MOIC vs IRR vs P(Loss)"
          subtitle="Higher MOIC with lower P(Loss) is better. IRR line shows annualized return." />
        <ResponsiveContainer width="100%" height={380}>
          <ComposedChart data={chartData} margin={{ top: 10, right: 30, left: 10, bottom: 20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={COLORS.gridLine} />
            <XAxis dataKey="scenario" tick={{ fill: COLORS.textMuted, fontSize: SIZES.sm }} />
            <YAxis yAxisId="left" tick={{ fill: COLORS.textMuted, fontSize: SIZES.sm }} tickFormatter={v => v + '×'} />
            <YAxis yAxisId="right" orientation="right" tick={{ fill: COLORS.textMuted, fontSize: SIZES.sm }} tickFormatter={v => v + '%'} />
            <Tooltip cursor={{ fill: 'rgba(6,182,212,0.06)' }} content={<CustomTooltip />} />
            <Legend wrapperStyle={{ fontSize: SIZES.sm }} />
            <ReferenceLine yAxisId="left" y={1} stroke={COLORS.breakeven} strokeDasharray="8 4" strokeWidth={2} />
            <Bar yAxisId="left" dataKey="moic" name="E[MOIC]" radius={[6, 6, 0, 0]} barSize={40}
              fill={COLORS.accent1} fillOpacity={0.85} cursor={BAR_CURSOR}>
              {chartData.map((entry, idx) => (
                <Cell key={idx} fill={COLORS.accent1} fillOpacity={entry.moic < 1.1 ? 0.5 : 0.85} />
              ))}
            </Bar>
            <Line yAxisId="right" type="monotone" dataKey="xirr" stroke={COLORS.accent2} strokeWidth={3}
              dot={{ fill: COLORS.accent2, r: 5, stroke: COLORS.bg, strokeWidth: 2 }} name="E[IRR] %" />
            <Line yAxisId="right" type="monotone" dataKey="ploss" stroke={COLORS.accent5} strokeWidth={2.5}
              dot={{ fill: COLORS.accent5, r: 5, stroke: COLORS.bg, strokeWidth: 2 }} name="P(Loss) %" />
          </ComposedChart>
        </ResponsiveContainer>
      </Card>

      {/* Sortable table */}
      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <SectionTitle number="2" title="Scenario Decision Matrix"
            subtitle="Click column headers to sort. Download CSV for further analysis." />
          <button onClick={downloadCSV} style={{
            padding: '8px 16px', borderRadius: 6, border: `1px solid ${COLORS.accent1}`,
            background: 'transparent', color: COLORS.accent1, cursor: 'pointer',
            fontFamily: FONT, fontSize: SIZES.sm, fontWeight: 600,
          }}>
            Download CSV
          </button>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 2, fontFamily: FONT }}>
            <thead>
              <tr>
                {columns.map(col => (
                  <th key={col.key}
                    onClick={() => handleSort(col.key)}
                    style={{
                      padding: '12px 12px', color: sortKey === col.key ? COLORS.accent1 : COLORS.textMuted,
                      fontSize: SIZES.xs, fontWeight: 700, textAlign: 'center', textTransform: 'uppercase',
                      letterSpacing: '0.04em', borderBottom: `1px solid ${COLORS.cardBorder}`,
                      cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap',
                    }}>
                    {col.label} {sortKey === col.key ? (sortAsc ? '▲' : '▼') : ''}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((s, i) => {
                const vs = getVerdictStyle(s.verdict);
                return (
                  <tr key={i} style={{ background: i % 2 === 0 ? 'transparent' : '#ffffff05' }}>
                    <td style={{ padding: '10px 12px', color: COLORS.textBright, fontSize: SIZES.base, fontWeight: 700, textAlign: 'center' }}>{s.scenario}</td>
                    <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                      <Badge text={s.basis} color={COLORS.accent1} />
                    </td>
                    <td style={{ padding: '10px 12px', color: COLORS.text, fontSize: SIZES.sm, textAlign: 'center', fontWeight: 600 }}>{fmtCr(s.investment_cr)}</td>
                    <td style={{
                      padding: '10px 12px', fontSize: SIZES.base, fontWeight: 800, textAlign: 'center',
                      color: s.mean_moic >= 2 ? '#34D399' : s.mean_moic >= 1.2 ? '#F59E0B' : '#EF4444',
                    }}>{fmtMOIC(s.mean_moic)}</td>
                    <td style={{ padding: '10px 12px', color: COLORS.text, fontSize: SIZES.sm, textAlign: 'center' }}>{fmtMOIC(s.median_moic)}</td>
                    <td style={{ padding: '10px 12px', color: COLORS.text, fontSize: SIZES.sm, textAlign: 'center' }}>{fmtPct(s.mean_xirr)}</td>
                    <td style={{
                      padding: '10px 12px', fontSize: SIZES.sm, fontWeight: 700, textAlign: 'center',
                      color: s.p_loss > 0.30 ? '#EF4444' : s.p_loss > 0.10 ? '#F59E0B' : '#34D399',
                    }}>{fmtPct(s.p_loss)}</td>
                    <td style={{ padding: '10px 12px', color: COLORS.text, fontSize: SIZES.sm, textAlign: 'center' }}>{fmtPct(s.p_irr_gt_30)}</td>
                    <td style={{ padding: '10px 12px', color: COLORS.text, fontSize: SIZES.sm, textAlign: 'center' }}>{fmtCr(s.mean_net_return_cr)}</td>
                    <td style={{ padding: '10px 12px', color: COLORS.text, fontSize: SIZES.sm, textAlign: 'center' }}>{fmtCr(s.var_1)}</td>
                    <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                      <span style={{
                        background: vs.bg, color: vs.color,
                        padding: '4px 12px', borderRadius: 6,
                        fontSize: SIZES.xs, fontWeight: 800, letterSpacing: '0.05em',
                      }}>{s.verdict}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Model parameters summary */}
      <Card>
        <SectionTitle number="3" title="Model Parameters" subtitle="Key simulation parameters used to generate these results" />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: SPACE.lg }}>
          {[
            { label: 'MC Paths', value: simulation_meta.n_paths.toLocaleString() },
            { label: 'Seed', value: simulation_meta.seed },
            { label: 'Claims', value: simulation_meta.n_claims },
            { label: 'Total SOC', value: fmtCr(simulation_meta.total_soc_cr) },
            { label: 'Arb Win %', value: fmtPct(simulation_meta.arb_win_probability) },
            { label: 'Max Timeline', value: `${simulation_meta.max_timeline_months}m` },
            { label: 'Discount Rate', value: fmtPct(simulation_meta.discount_rate) },
            { label: 'Risk-Free Rate', value: fmtPct(simulation_meta.risk_free_rate) },
          ].map((p, i) => (
            <div key={i} style={{ textAlign: 'center', padding: 12, background: '#0F1219', borderRadius: 8 }}>
              <div style={{ color: COLORS.textMuted, fontSize: SIZES.xs, fontWeight: 600, marginBottom: 4, textTransform: 'uppercase' }}>{p.label}</div>
              <div style={{ color: COLORS.textBright, fontSize: SIZES.lg, fontWeight: 700 }}>{p.value}</div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
