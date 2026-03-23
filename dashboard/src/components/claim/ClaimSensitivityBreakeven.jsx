/**
 * ClaimSensitivityBreakeven.jsx — Single-claim Sensitivity & Breakeven tab (Tab 7).
 *
 * The "claim viability surface" — the most analytical tab.
 *
 * Sections:
 *   1. Arb Win Probability Sensitivity (full-width chart + table)
 *   2. Breakeven Analysis Summary
 *   3. Claim Viability Heatmap (if waterfall_grid available)
 *   4. Legal Cost Sensitivity Text Block
 */

import React, { useMemo } from 'react';
import {
  ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, Legend,
} from 'recharts';
import { COLORS, FONT, CHART_HEIGHT, useUISettings, fmtCr, fmtPct, fmtMOIC } from '../../theme';
import { Card, SectionTitle, KPI, DataTable, CustomTooltip } from '../Shared';

/* ═══════════════════════════════════════════════════════════
 *  HELPERS
 * ═══════════════════════════════════════════════════════════ */

/** Find the P(Win) at which MOIC crosses 1.0 by linear interpolation. */
function findBreakevenProb(sensitivity) {
  if (!sensitivity || sensitivity.length < 2) return null;
  for (let i = 1; i < sensitivity.length; i++) {
    const prev = sensitivity[i - 1];
    const curr = sensitivity[i];
    if (prev.e_moic < 1.0 && curr.e_moic >= 1.0) {
      const frac = (1.0 - prev.e_moic) / (curr.e_moic - prev.e_moic);
      return prev.arb_win_prob + frac * (curr.arb_win_prob - prev.arb_win_prob);
    }
  }
  if (sensitivity[0].e_moic >= 1.0) return sensitivity[0].arb_win_prob;
  return null;
}

/* ═══════════════════════════════════════════════════════════
 *  § 1 — Arb Win Probability Sensitivity
 * ═══════════════════════════════════════════════════════════ */
function SensitivityChart({ data }) {
  const { ui } = useUISettings();
  const sensitivity = data?.sensitivity;
  const claim = data?.claims?.[0] || {};

  const chartData = useMemo(() => {
    if (!sensitivity || sensitivity.length === 0) return [];
    return sensitivity.map(s => ({
      pWin: (s.arb_win_prob * 100).toFixed(0) + '%',
      pWinRaw: s.arb_win_prob,
      eMoic: s.e_moic,
      eIrr: s.e_irr,
      pLoss: s.p_loss,
    }));
  }, [sensitivity]);

  const breakevenProb = useMemo(() => findBreakevenProb(sensitivity), [sensitivity]);
  const currentWinProb = claim.win_rate || claim.effective_win_rate;

  if (chartData.length === 0) {
    return (
      <Card>
        <SectionTitle number="1" title="Sensitivity Analysis" subtitle="No sensitivity data available" />
        <div style={{ color: COLORS.textMuted, textAlign: 'center', padding: 40 }}>N/A</div>
      </Card>
    );
  }

  const headers = ['P(Arb Win)', 'E[MOIC]', 'E[IRR]', 'P(Loss)'];
  const rows = (sensitivity || []).map(s => [
    fmtPct(s.arb_win_prob),
    fmtMOIC(s.e_moic),
    fmtPct(s.e_irr),
    fmtPct(s.p_loss),
  ]);

  return (
    <Card>
      <SectionTitle number="1" title="Arb Win Probability Sensitivity"
        subtitle="How E[MOIC], E[IRR], and P(Loss) vary with the probability of winning arbitration" />

      <ResponsiveContainer width="100%" height={ui.chartHeight.xl}>
        <ComposedChart data={chartData} margin={{ top: 10, right: 60, left: 20, bottom: 10 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={COLORS.gridLine} />
          <XAxis
            dataKey="pWin"
            tick={{ fill: COLORS.textMuted, fontSize: ui.sizes.sm, fontFamily: FONT }}
            label={{ value: 'P(Arb Win)', position: 'insideBottom', offset: -4, fill: COLORS.text, fontSize: ui.sizes.md, fontWeight: 600 }}
          />
          <YAxis
            yAxisId="moic"
            tick={{ fill: COLORS.textMuted, fontSize: ui.sizes.sm, fontFamily: FONT }}
            tickFormatter={v => `${v.toFixed(1)}×`}
            label={{ value: 'E[MOIC]', angle: -90, position: 'insideLeft', offset: 10, fill: COLORS.accent6, fontSize: ui.sizes.md, fontWeight: 600 }}
          />
          <YAxis
            yAxisId="ploss"
            orientation="right"
            tick={{ fill: COLORS.textMuted, fontSize: ui.sizes.sm, fontFamily: FONT }}
            tickFormatter={v => `${(v * 100).toFixed(0)}%`}
            label={{ value: 'P(Loss)', angle: 90, position: 'insideRight', offset: 10, fill: COLORS.accent5, fontSize: ui.sizes.md, fontWeight: 600 }}
          />
          <Tooltip content={<CustomTooltip />} />
          <Legend wrapperStyle={{ fontFamily: FONT, fontSize: ui.sizes.sm }} />

          <ReferenceLine yAxisId="moic" y={1.0} stroke={COLORS.accent3} strokeDasharray="6 3" strokeWidth={1.5}
            label={{ value: '1.0× Breakeven', fill: COLORS.accent3, fontSize: ui.sizes.xs }} />

          {currentWinProb && (
            <ReferenceLine
              yAxisId="moic"
              x={`${(currentWinProb * 100).toFixed(0)}%`}
              stroke={COLORS.accent1}
              strokeDasharray="4 4"
              strokeWidth={1.5}
              label={{ value: `Current (${fmtPct(currentWinProb)})`, fill: COLORS.accent1, fontSize: ui.sizes.xs, position: 'top' }}
            />
          )}
          {breakevenProb != null && (
            <ReferenceLine
              yAxisId="moic"
              x={`${(breakevenProb * 100).toFixed(0)}%`}
              stroke={COLORS.accent3}
              strokeDasharray="4 4"
              strokeWidth={1.5}
              label={{ value: `Breakeven (${fmtPct(breakevenProb)})`, fill: COLORS.accent3, fontSize: ui.sizes.xs, position: 'top' }}
            />
          )}

          <Line yAxisId="moic" dataKey="eMoic" stroke={COLORS.accent6} strokeWidth={2.5} dot={{ r: 4 }} name="E[MOIC]" />
          <Line yAxisId="ploss" dataKey="pLoss" stroke={COLORS.accent5} strokeWidth={2} strokeDasharray="6 3" dot={{ r: 3 }} name="P(Loss)" />
        </ComposedChart>
      </ResponsiveContainer>

      {/* Detail table below chart */}
      <div style={{ marginTop: ui.space.lg }}>
        <DataTable headers={headers} rows={rows} />
      </div>
    </Card>
  );
}

/* ═══════════════════════════════════════════════════════════
 *  § 2 — Breakeven Analysis Summary
 * ═══════════════════════════════════════════════════════════ */
function BreakevenSummary({ data }) {
  const { ui } = useUISettings();
  const sensitivity = data?.sensitivity;
  const breakevenProb = useMemo(() => findBreakevenProb(sensitivity), [sensitivity]);
  const claim = data?.claims?.[0] || {};
  const currentWin = claim.win_rate || claim.effective_win_rate || 0;

  if (breakevenProb == null && (!sensitivity || sensitivity.length === 0)) return null;

  const headroom = currentWin - (breakevenProb || 0);
  const aboveBreakeven = breakevenProb != null && currentWin >= breakevenProb;

  return (
    <Card>
      <SectionTitle number="2" title="Breakeven Analysis"
        subtitle="Minimum win probability required for MOIC ≥ 1.0×" />

      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: ui.space.xxl,
        padding: `${ui.space.xxl}px 0`, flexWrap: 'wrap',
      }}>
        {/* Breakeven callout */}
        <div style={{
          textAlign: 'center', padding: `${ui.space.xl}px ${ui.space.xxl}px`,
          background: aboveBreakeven ? 'rgba(16, 185, 129, 0.08)' : 'rgba(239, 68, 68, 0.08)',
          borderRadius: 16,
          border: `2px solid ${aboveBreakeven ? '#34D39940' : COLORS.accent5 + '40'}`,
        }}>
          <div style={{ color: COLORS.textMuted, fontSize: ui.sizes.md, fontWeight: 600, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            Breakeven P(Win)
          </div>
          <div style={{
            fontSize: ui.sizes.hero,
            fontWeight: 800,
            color: aboveBreakeven ? '#34D399' : COLORS.accent5,
            fontFamily: FONT,
          }}>
            {breakevenProb != null ? fmtPct(breakevenProb) : 'N/A'}
          </div>
          <div style={{ color: COLORS.textMuted, fontSize: ui.sizes.sm, marginTop: 8 }}>
            {breakevenProb != null
              ? `You break even (MOIC ≥ 1.0×) when P(Win) ≥ ${fmtPct(breakevenProb)}`
              : sensitivity?.[0]?.e_moic >= 1.0 ? 'Always above breakeven across tested range' : 'Breakeven not reached in tested range'}
          </div>
        </div>

        {/* Headroom KPIs */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: ui.space.md }}>
          <KPI label="Current P(Win)" value={fmtPct(currentWin)} color={COLORS.accent1} />
          <KPI label="Headroom" value={breakevenProb != null ? `${(headroom * 100).toFixed(1)}pp` : 'N/A'}
            sub={aboveBreakeven ? 'Above breakeven' : 'Below breakeven'}
            color={aboveBreakeven ? '#34D399' : COLORS.accent5} />
        </div>
      </div>
    </Card>
  );
}

/* ═══════════════════════════════════════════════════════════
 *  § 3 — Claim Viability Heatmap
 * ═══════════════════════════════════════════════════════════ */
function ViabilityHeatmap({ data }) {
  const { ui } = useUISettings();
  const grid = data?.waterfall_grid;
  if (!grid || Object.keys(grid).length === 0) return null;

  // Parse grid keys: expected format "cost_award" e.g. "1_10", "2_20" etc.
  // or "upfront_tail" e.g. "10_20"
  const entries = useMemo(() => {
    const items = [];
    for (const [key, val] of Object.entries(grid)) {
      const parts = key.split('_');
      if (parts.length === 2) {
        items.push({
          x: parseFloat(parts[0]),
          y: parseFloat(parts[1]),
          moic: val.mean_moic ?? val.e_moic ?? 0,
          key,
        });
      }
    }
    return items;
  }, [grid]);

  if (entries.length === 0) return null;

  const xValues = [...new Set(entries.map(e => e.x))].sort((a, b) => a - b);
  const yValues = [...new Set(entries.map(e => e.y))].sort((a, b) => a - b);

  const lookup = {};
  entries.forEach(e => { lookup[`${e.x}_${e.y}`] = e.moic; });

  const cellColor = (moic) => {
    if (moic >= 2.0) return 'rgba(16,185,129,0.50)';
    if (moic >= 1.5) return 'rgba(6,182,212,0.35)';
    if (moic >= 1.0) return 'rgba(245,158,11,0.35)';
    return 'rgba(239,68,68,0.35)';
  };

  return (
    <Card>
      <SectionTitle number="3" title="Claim Viability Heatmap"
        subtitle="Return multiples across different parameter combinations — green > 2.0×, yellow 1.0–2.0×, red < 1.0×" />

      <div style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'separate', borderSpacing: 3, fontFamily: FONT, margin: '0 auto' }}>
          <thead>
            <tr>
              <th style={{ padding: '10px 14px', color: COLORS.textMuted, fontSize: ui.sizes.sm, fontWeight: 700 }}></th>
              {xValues.map(x => (
                <th key={x} style={{ padding: '10px 14px', color: COLORS.textBright, fontSize: ui.sizes.sm, fontWeight: 700, textAlign: 'center' }}>
                  {x}%
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {yValues.map(y => (
              <tr key={y}>
                <td style={{ padding: '10px 14px', color: COLORS.textBright, fontSize: ui.sizes.sm, fontWeight: 700, textAlign: 'right' }}>
                  {y}%
                </td>
                {xValues.map(x => {
                  const moic = lookup[`${x}_${y}`];
                  return (
                    <td key={`${x}_${y}`} style={{
                      padding: '10px 14px',
                      textAlign: 'center',
                      borderRadius: 6,
                      backgroundColor: moic != null ? cellColor(moic) : '#1F293730',
                      color: COLORS.textBright,
                      fontSize: ui.sizes.sm,
                      fontWeight: 700,
                      minWidth: 60,
                    }}>
                      {moic != null ? fmtMOIC(moic) : '—'}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/* ═══════════════════════════════════════════════════════════
 *  § 4 — Legal Cost Sensitivity
 * ═══════════════════════════════════════════════════════════ */
function LegalCostSensitivity({ data }) {
  const { ui } = useUISettings();
  const claim = data?.claims?.[0] || {};
  const risk = data?.risk || {};
  const ig = data?.investment_grid || {};
  const moicDist = risk.moic_distribution || {};
  const irrDist = risk.irr_distribution || {};

  // Get base metrics
  const refKey = Object.keys(ig)[0];
  const ref = ig[refKey] || {};
  const baseMoic = ref.mean_moic || moicDist.p50 || moicDist.mean || 0;
  const baseIrr = ref.mean_xirr || irrDist.p50 || irrDist.mean || 0;
  const baseLegal = claim.legal_cost_stats?.mean || claim.mean_legal_costs_cr || data?.waterfall?.nominal?.legal_costs_cr || 0;

  if (baseMoic === 0 && baseLegal === 0) return null;

  const scenarios = [
    { name: 'Base Case', factor: 1.0 },
    { name: '+20% Legal Costs', factor: 1.20 },
    { name: '+50% Legal Costs', factor: 1.50 },
  ];

  const headers = ['Scenario', 'E[Legal Costs] (₹ Cr)', 'E[MOIC]', 'E[IRR]'];
  const rows = scenarios.map(s => {
    // MOIC scales inversely with cost increase (simplified)
    const adjustedLegal = baseLegal * s.factor;
    const collected = claim.collected_stats?.mean || claim.mean_collected_cr || data?.waterfall?.nominal?.prob_adjusted_cr || 0;
    const adjustedNet = collected - adjustedLegal;
    const baseNet = collected - baseLegal;
    const moicAdj = baseNet > 0 ? baseMoic * (adjustedNet / baseNet) : baseMoic / s.factor;
    const irrAdj = baseIrr / s.factor;

    return [
      s.name,
      fmtCr(adjustedLegal),
      fmtMOIC(Math.max(0, moicAdj)),
      fmtPct(irrAdj),
    ];
  });

  return (
    <Card>
      <SectionTitle number="4" title="Legal Cost Sensitivity"
        subtitle="Impact of legal cost increases on expected returns" />

      <div style={{ marginBottom: ui.space.md, padding: `${ui.space.md}px ${ui.space.lg}px`, background: '#0F1219', borderRadius: 8, border: `1px solid ${COLORS.cardBorder}` }}>
        <span style={{ color: COLORS.textMuted, fontSize: ui.sizes.sm }}>
          Base legal costs: <strong style={{ color: COLORS.textBright }}>{fmtCr(baseLegal)}</strong>
          {' — '}If costs rise, net recovery drops and MOIC compresses proportionally.
        </span>
      </div>

      <DataTable headers={headers} rows={rows} />
    </Card>
  );
}

/* ═══════════════════════════════════════════════════════════
 *  MAIN EXPORT
 * ═══════════════════════════════════════════════════════════ */
export default function ClaimSensitivityBreakeven({ data }) {
  const { ui } = useUISettings();

  if (!data) {
    return <div style={{ color: COLORS.textMuted, textAlign: 'center', padding: 60 }}>No data available</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: ui.space.xl }}>
      <SensitivityChart data={data} />
      <BreakevenSummary data={data} />
      <ViabilityHeatmap data={data} />
      <LegalCostSensitivity data={data} />
    </div>
  );
}
