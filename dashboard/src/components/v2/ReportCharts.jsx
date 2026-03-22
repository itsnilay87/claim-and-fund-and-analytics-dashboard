/**
 * ReportCharts.jsx — 3 presentation-ready line charts (white background) for reports.
 *
 * 1. E[MOIC] vs Upfront % — one line per tail level
 * 2. E[IRR] vs Upfront % — one line per tail level
 * 3. P(Loss) vs Upfront % — one line per tail level
 *
 * Data source: stochasticData = { meta, grid }
 */

import React, { useState, useMemo } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend, ReferenceLine,
} from 'recharts';
import { COLORS, FONT, CHART_COLORS, SIZES, SPACE, CHART_HEIGHT, CHART_FONT, fmtPct, fmtMOIC, BAR_CURSOR } from '../theme';
import { Card, SectionTitle, CustomTooltip } from './Shared';

const REPORT_BG = '#FFFFFF';
const REPORT_TEXT = '#1E293B';
const REPORT_MUTED = '#64748B';
const REPORT_GRID = '#E2E8F0';

const TAIL_COLORS = [
  '#2563EB', '#7C3AED', '#059669', '#D97706', '#DC2626',
  '#0891B2', '#4F46E5', '#16A34A', '#EA580C',
];

function ReportTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: 8,
      padding: '10px 14px', fontFamily: FONT, boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
    }}>
      <div style={{ fontSize: SIZES.sm, fontWeight: 700, color: REPORT_TEXT, marginBottom: 6 }}>{label}</div>
      {payload.map((p, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: SPACE.sm, fontSize: SIZES.sm, marginBottom: 2 }}>
          <div style={{ width: 8, height: 8, borderRadius: 4, background: p.color }} />
          <span style={{ color: REPORT_MUTED }}>{p.name}:</span>
          <span style={{ fontWeight: 600, color: REPORT_TEXT }}>{typeof p.value === 'number' && p.value < 1 ? fmtPct(p.value) : fmtMOIC(p.value)}</span>
        </div>
      ))}
    </div>
  );
}

export default function ReportCharts({ stochasticData }) {
  const [selectedTails, setSelectedTails] = useState([10, 20, 30, 40, 50]);

  if (!stochasticData || !stochasticData.grid) {
    return (
      <Card>
        <SectionTitle title="No Stochastic Pricing Data"
          subtitle="Run with stochastic pricing enabled to generate report charts." />
      </Card>
    );
  }

  const { meta, grid } = stochasticData;
  const upfrontGrid = meta.upfront_grid || [];
  const tailGrid = meta.tail_grid || [];

  // Build line data: one row per upfront, one column per tail level
  const moicData = useMemo(() => {
    return upfrontGrid.map(up => {
      const row = { pct: `${up}%`, upfront: up };
      for (const t of tailGrid) {
        const cell = grid[`${up}_${t}`];
        row[`tail_${t}`] = cell?.e_moic ?? null;
      }
      return row;
    });
  }, [upfrontGrid, tailGrid, grid]);

  const irrData = useMemo(() => {
    return upfrontGrid.map(up => {
      const row = { pct: `${up}%`, upfront: up };
      for (const t of tailGrid) {
        const cell = grid[`${up}_${t}`];
        row[`tail_${t}`] = cell?.e_irr ?? null;
      }
      return row;
    });
  }, [upfrontGrid, tailGrid, grid]);

  const lossData = useMemo(() => {
    return upfrontGrid.map(up => {
      const row = { pct: `${up}%`, upfront: up };
      for (const t of tailGrid) {
        const cell = grid[`${up}_${t}`];
        row[`tail_${t}`] = cell?.prob_loss ?? null;
      }
      return row;
    });
  }, [upfrontGrid, tailGrid, grid]);

  const toggleTail = (t) => {
    setSelectedTails(prev =>
      prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t].sort((a, b) => a - b)
    );
  };

  const chartStyle = {
    background: REPORT_BG, borderRadius: 12, padding: 24,
    border: '1px solid #E2E8F0',
  };

  const titleStyle = {
    color: REPORT_TEXT, fontSize: SIZES.lg, fontWeight: 700, fontFamily: FONT, marginBottom: 4,
  };

  const subtitleStyle = {
    color: REPORT_MUTED, fontSize: SIZES.sm, fontFamily: FONT, marginBottom: 20,
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: SPACE.xl }}>
      {/* Tail selector */}
      <div style={{ display: 'flex', alignItems: 'center', gap: SPACE.md, flexWrap: 'wrap' }}>
        <span style={{ color: COLORS.textMuted, fontSize: SIZES.sm }}>Show Tata Tail lines:</span>
        {tailGrid.map((t, i) => (
          <button key={t} onClick={() => toggleTail(t)} style={{
            padding: '6px 14px', borderRadius: 6, border: 'none', cursor: 'pointer',
            fontFamily: FONT, fontSize: SIZES.sm, fontWeight: 600,
            color: selectedTails.includes(t) ? '#fff' : COLORS.textMuted,
            background: selectedTails.includes(t) ? TAIL_COLORS[i % TAIL_COLORS.length] : COLORS.card,
          }}>
            {t}%
          </button>
        ))}
      </div>

      {/* Chart 1: E[MOIC] vs Upfront */}
      <div style={chartStyle}>
        <div style={titleStyle}>E[MOIC] vs Upfront Purchase %</div>
        <div style={subtitleStyle}>Multi-line comparison across Tata Tail levels. Higher is better.</div>
        <ResponsiveContainer width="100%" height={400}>
          <LineChart data={moicData} margin={{ top: 10, right: 30, left: 10, bottom: 20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={REPORT_GRID} />
            <XAxis dataKey="pct" tick={{ fill: REPORT_MUTED, fontSize: SIZES.sm }}
              label={{ value: 'Upfront Purchase %', position: 'bottom', fill: REPORT_MUTED, fontSize: SIZES.sm }} />
            <YAxis tick={{ fill: REPORT_MUTED, fontSize: SIZES.sm }} tickFormatter={v => v + '×'}
              label={{ value: 'E[MOIC]', angle: -90, position: 'insideLeft', fill: REPORT_MUTED, fontSize: SIZES.sm }} />
            <Tooltip content={<ReportTooltip />} />
            <ReferenceLine y={1} stroke="#94A3B8" strokeDasharray="8 4" strokeWidth={1.5} />
            {tailGrid.filter(t => selectedTails.includes(t)).map((t, i) => (
              <Line key={t} type="monotone" dataKey={`tail_${t}`}
                stroke={TAIL_COLORS[tailGrid.indexOf(t) % TAIL_COLORS.length]}
                strokeWidth={2.5}
                dot={{ r: 3, fill: TAIL_COLORS[tailGrid.indexOf(t) % TAIL_COLORS.length], stroke: REPORT_BG, strokeWidth: 2 }}
                name={`Tail ${t}%`}
                connectNulls
              />
            ))}
            <Legend wrapperStyle={{ fontSize: SIZES.sm, color: REPORT_MUTED }} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Chart 2: E[IRR] vs Upfront */}
      <div style={chartStyle}>
        <div style={titleStyle}>E[IRR] vs Upfront Purchase %</div>
        <div style={subtitleStyle}>Expected annual IRR across pricing combinations. 30% hurdle shown dashed.</div>
        <ResponsiveContainer width="100%" height={400}>
          <LineChart data={irrData} margin={{ top: 10, right: 30, left: 10, bottom: 20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={REPORT_GRID} />
            <XAxis dataKey="pct" tick={{ fill: REPORT_MUTED, fontSize: SIZES.sm }}
              label={{ value: 'Upfront Purchase %', position: 'bottom', fill: REPORT_MUTED, fontSize: SIZES.sm }} />
            <YAxis tick={{ fill: REPORT_MUTED, fontSize: SIZES.sm }} tickFormatter={v => (v * 100).toFixed(0) + '%'}
              label={{ value: 'E[IRR]', angle: -90, position: 'insideLeft', fill: REPORT_MUTED, fontSize: SIZES.sm }} />
            <Tooltip content={<ReportTooltip />} />
            <ReferenceLine y={0.30} stroke="#D97706" strokeDasharray="8 4" strokeWidth={1.5}
              label={{ value: '30% hurdle', fill: '#D97706', fontSize: SIZES.xs, position: 'right' }} />
            {tailGrid.filter(t => selectedTails.includes(t)).map((t, i) => (
              <Line key={t} type="monotone" dataKey={`tail_${t}`}
                stroke={TAIL_COLORS[tailGrid.indexOf(t) % TAIL_COLORS.length]}
                strokeWidth={2.5}
                dot={{ r: 3, fill: TAIL_COLORS[tailGrid.indexOf(t) % TAIL_COLORS.length], stroke: REPORT_BG, strokeWidth: 2 }}
                name={`Tail ${t}%`}
                connectNulls
              />
            ))}
            <Legend wrapperStyle={{ fontSize: SIZES.sm, color: REPORT_MUTED }} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Chart 3: P(Loss) vs Upfront */}
      <div style={chartStyle}>
        <div style={titleStyle}>P(Loss) vs Upfront Purchase %</div>
        <div style={subtitleStyle}>Probability of MOIC &lt; 1.0×. Lower is safer. Red zone above 20%.</div>
        <ResponsiveContainer width="100%" height={400}>
          <LineChart data={lossData} margin={{ top: 10, right: 30, left: 10, bottom: 20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={REPORT_GRID} />
            <XAxis dataKey="pct" tick={{ fill: REPORT_MUTED, fontSize: SIZES.sm }}
              label={{ value: 'Upfront Purchase %', position: 'bottom', fill: REPORT_MUTED, fontSize: SIZES.sm }} />
            <YAxis tick={{ fill: REPORT_MUTED, fontSize: SIZES.sm }} tickFormatter={v => (v * 100).toFixed(0) + '%'}
              label={{ value: 'P(Loss)', angle: -90, position: 'insideLeft', fill: REPORT_MUTED, fontSize: SIZES.sm }} />
            <Tooltip content={<ReportTooltip />} />
            <ReferenceLine y={0.20} stroke="#DC2626" strokeDasharray="8 4" strokeWidth={1.5}
              label={{ value: '20% threshold', fill: '#DC2626', fontSize: SIZES.xs, position: 'right' }} />
            {tailGrid.filter(t => selectedTails.includes(t)).map((t, i) => (
              <Line key={t} type="monotone" dataKey={`tail_${t}`}
                stroke={TAIL_COLORS[tailGrid.indexOf(t) % TAIL_COLORS.length]}
                strokeWidth={2.5}
                dot={{ r: 3, fill: TAIL_COLORS[tailGrid.indexOf(t) % TAIL_COLORS.length], stroke: REPORT_BG, strokeWidth: 2 }}
                name={`Tail ${t}%`}
                connectNulls
              />
            ))}
            <Legend wrapperStyle={{ fontSize: SIZES.sm, color: REPORT_MUTED }} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
