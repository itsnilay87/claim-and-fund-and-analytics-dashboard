/**
 * StochasticPricing.jsx — Per-cell stochastic analysis with histograms.
 * Structure: monetisation_upfront_tail
 *
 * Cell selector (upfront%, tail% dropdowns).
 * Histograms for MOIC, IRR, net recovery, duration.
 * Percentile table (P5 .. P95 for key metrics).
 * Confidence band charts (MOIC and IRR across upfront at fixed tail).
 */

import React, { useState, useMemo } from 'react';
import {
  BarChart, Bar, ComposedChart, Area, Line,
  XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine, Cell, Legend,
} from 'recharts';
import { COLORS, FONT, BAR_CURSOR, useUISettings, fmtPct, fmtMOIC, moicColor, irrColor, lossColor } from '../theme';
import { Card, SectionTitle, KPI, DataTable } from './Shared';

function nearestBinLabel(bins, value) {
  if (!bins?.length) return undefined;
  let best = bins[0].bin, bestD = Math.abs(bins[0].edge - value);
  for (const b of bins) { const d = Math.abs(b.edge - value); if (d < bestD) { bestD = d; best = b.bin; } }
  return best;
}

function prepHist(hist) {
  if (!hist || hist.length < 2) return null;
  return hist.slice(0, -1).map((b, i) => ({
    edge: b.edge, count: b.count,
    bin: b.edge.toFixed(3),
    midpoint: (b.edge + (hist[i + 1]?.edge ?? b.edge)) / 2,
  }));
}

export default function StochasticPricing({ data }) {
  const { ui } = useUISettings();
  const grid = data?.investment_grid || {};
  const meta = data?.simulation_meta || {};
  const stochastic = data?.stochastic_pricing;

  // Use stochastic_pricing if available, otherwise fall back to investment_grid
  const effectiveGrid = stochastic?.grid || grid;
  const effectiveMeta = stochastic?.meta || null;

  const gridKeys = Object.keys(effectiveGrid);
  if (gridKeys.length === 0) {
    return <Card><SectionTitle title="Stochastic Pricing" subtitle="No grid data available." /></Card>;
  }

  const upfronts = [...new Set(gridKeys.map(k => parseInt(k.split('_')[0])))].sort((a, b) => a - b);
  const tails = [...new Set(gridKeys.map(k => parseInt(k.split('_')[1])))].sort((a, b) => a - b);

  const [selUp, setSelUp] = useState(upfronts[Math.floor(upfronts.length / 2)]);
  const [selTail, setSelTail] = useState(tails[Math.floor(tails.length / 3)]);

  const activeKey = `${selUp}_${selTail}`;
  const activeCell = effectiveGrid[activeKey];

  // Histogram bins
  const moicBins = useMemo(() => prepHist(activeCell?.moic_hist), [activeCell]);
  const irrBins = useMemo(() => prepHist(activeCell?.irr_hist), [activeCell]);

  // Confidence band data — MOIC across upfront at fixed tail
  const moicBandData = useMemo(() => upfronts.map(up => {
    const c = effectiveGrid[`${up}_${selTail}`];
    if (!c) return { pct: `${up}%`, upfront: up };
    return {
      pct: `${up}%`, upfront: up,
      p5: c.p5_moic, p25: c.p25_moic, median: c.p50_moic ?? c.median_moic,
      p75: c.p75_moic, p95: c.p95_moic, mean: c.e_moic ?? c.mean_moic,
    };
  }), [upfronts, selTail, effectiveGrid]);

  // Confidence band data — IRR
  const irrBandData = useMemo(() => upfronts.map(up => {
    const c = effectiveGrid[`${up}_${selTail}`];
    if (!c) return { pct: `${up}%`, upfront: up };
    return {
      pct: `${up}%`, upfront: up,
      p5: c.p5_irr, p25: c.p25_irr, median: c.p50_irr,
      p75: c.p75_irr, p95: c.p95_irr, mean: c.e_irr ?? c.mean_xirr,
    };
  }), [upfronts, selTail, effectiveGrid]);

  const hasBands = moicBandData.some(d => d.p5 != null);

  // Percentile table
  const percRows = activeCell ? [
    ['E[MOIC]', fmtMOIC(activeCell.e_moic ?? activeCell.mean_moic)],
    ['Median MOIC', fmtMOIC(activeCell.p50_moic ?? activeCell.median_moic)],
    ['P5 MOIC', activeCell.p5_moic != null ? fmtMOIC(activeCell.p5_moic) : '—'],
    ['P25 MOIC', activeCell.p25_moic != null ? fmtMOIC(activeCell.p25_moic) : '—'],
    ['P75 MOIC', activeCell.p75_moic != null ? fmtMOIC(activeCell.p75_moic) : '—'],
    ['P95 MOIC', activeCell.p95_moic != null ? fmtMOIC(activeCell.p95_moic) : '—'],
    ['E[IRR]', fmtPct(activeCell.e_irr ?? activeCell.mean_xirr)],
    ['Median IRR', activeCell.p50_irr != null ? fmtPct(activeCell.p50_irr) : '—'],
    ['P(Loss)', fmtPct(activeCell.prob_loss ?? activeCell.p_loss)],
    ['P(IRR>30%)', fmtPct(activeCell.prob_hurdle ?? activeCell.p_hurdle)],
    ['VaR(1%)', activeCell.var_1 != null ? fmtMOIC(activeCell.var_1) : '—'],
    ['CVaR(1%)', activeCell.cvar_1 != null ? fmtMOIC(activeCell.cvar_1) : '—'],
  ] : [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: ui.space.xl }}>

      {/* ── Cell selector ── */}
      <Card>
        <SectionTitle number="1" title="Cell Selector"
          subtitle={`Choose a pricing cell to explore. ${(meta.n_paths || effectiveMeta?.sims_per_combo || 0).toLocaleString()} MC paths per cell.`} />
        <div style={{ display: 'flex', gap: ui.space.xxl, flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ color: COLORS.textMuted, fontSize: ui.sizes.sm, fontWeight: 600 }}>Upfront %:</span>
            <select value={selUp} onChange={e => setSelUp(parseInt(e.target.value))}
              style={{ padding: '6px 10px', borderRadius: 6, border: `1px solid ${COLORS.cardBorder}`, background: COLORS.card, color: COLORS.accent1, fontFamily: FONT, fontSize: ui.sizes.md, fontWeight: 700 }}>
              {upfronts.map(u => <option key={u} value={u}>{u}%</option>)}
            </select>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ color: COLORS.textMuted, fontSize: ui.sizes.sm, fontWeight: 600 }}>Tail %:</span>
            <select value={selTail} onChange={e => setSelTail(parseInt(e.target.value))}
              style={{ padding: '6px 10px', borderRadius: 6, border: `1px solid ${COLORS.cardBorder}`, background: COLORS.card, color: COLORS.accent2, fontFamily: FONT, fontSize: ui.sizes.md, fontWeight: 700 }}>
              {tails.map(t => <option key={t} value={t}>{t}%</option>)}
            </select>
          </div>
        </div>

        {/* KPI row for selected cell */}
        {activeCell && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: ui.space.md, marginTop: ui.space.lg }}>
            {[
              { label: 'E[MOIC]', value: fmtMOIC(activeCell.e_moic ?? activeCell.mean_moic), color: moicColor(activeCell.e_moic ?? activeCell.mean_moic) },
              { label: 'E[IRR]', value: fmtPct(activeCell.e_irr ?? activeCell.mean_xirr), color: irrColor(activeCell.e_irr ?? activeCell.mean_xirr) },
              { label: 'P(Loss)', value: fmtPct(activeCell.prob_loss ?? activeCell.p_loss), color: lossColor(activeCell.prob_loss ?? activeCell.p_loss) },
              { label: 'P(IRR>30%)', value: fmtPct(activeCell.prob_hurdle ?? activeCell.p_hurdle), color: COLORS.accent4 },
            ].map((item, i) => (
              <div key={i} style={{
                textAlign: 'center', padding: 14, borderRadius: 10,
                background: typeof item.color === 'string' ? `${item.color}15` : '#0F1219',
                border: `1px solid ${COLORS.cardBorder}`,
              }}>
                <div style={{ color: COLORS.textMuted, fontSize: ui.sizes.xs, fontWeight: 600, textTransform: 'uppercase', marginBottom: 4 }}>{item.label}</div>
                <div style={{ color: '#fff', fontSize: ui.sizes.xl, fontWeight: 800 }}>{item.value}</div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* ── MOIC Histogram ── */}
      {moicBins && (
        <Card>
          <SectionTitle number="2a" title={`MOIC Distribution — ${selUp}% Up / ${selTail}% Tail`}
            subtitle="Histogram of simulated MOIC outcomes." />
          <ResponsiveContainer width="100%" height={ui.chartHeight?.md || 380}>
            <BarChart data={moicBins} margin={{ top: 16, right: 20, left: 10, bottom: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={COLORS.gridLine} vertical={false} />
              <XAxis dataKey="bin" tick={{ fill: COLORS.textMuted, fontSize: 11 }} interval={Math.max(0, Math.floor(moicBins.length / 10) - 1)} />
              <YAxis tick={{ fill: COLORS.textMuted, fontSize: 11 }} width={48} />
              <Tooltip cursor={BAR_CURSOR} content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const d = payload[0].payload;
                return (<div style={{ background: '#1F2937', border: `1px solid ${COLORS.cardBorder}`, borderRadius: 8, padding: '8px 14px', fontFamily: FONT }}>
                  <div style={{ color: COLORS.textBright, fontSize: 13, fontWeight: 600 }}>MOIC: {d.edge.toFixed(3)}×</div>
                  <div style={{ color: COLORS.accent1, fontSize: 13 }}>Count: {d.count.toLocaleString()}</div>
                </div>);
              }} />
              <ReferenceLine x={nearestBinLabel(moicBins, 1.0)} stroke={COLORS.accent5} strokeDasharray="8 4" strokeWidth={2}
                label={{ value: '1.0× BE', fill: COLORS.accent5, fontSize: 10, position: 'top' }} />
              {(activeCell?.e_moic ?? activeCell?.mean_moic) != null &&
                <ReferenceLine x={nearestBinLabel(moicBins, activeCell.e_moic ?? activeCell.mean_moic)}
                  stroke={COLORS.accent6} strokeDasharray="6 3" strokeWidth={1.5}
                  label={{ value: 'Mean', fill: COLORS.accent6, fontSize: 10, position: 'top' }} />}
              <Bar dataKey="count" radius={[2, 2, 0, 0]} maxBarSize={14} cursor={BAR_CURSOR}>
                {moicBins.map((e, i) => <Cell key={i} fill={e.midpoint >= 1.0 ? COLORS.accent1 : '#F59E0B80'} fillOpacity={0.85} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>
      )}

      {/* ── IRR Histogram ── */}
      {irrBins && (
        <Card>
          <SectionTitle number="2b" title={`IRR Distribution — ${selUp}% Up / ${selTail}% Tail`}
            subtitle="Histogram of annualized IRR outcomes." />
          <ResponsiveContainer width="100%" height={ui.chartHeight?.md || 380}>
            <BarChart data={irrBins} margin={{ top: 16, right: 20, left: 10, bottom: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={COLORS.gridLine} vertical={false} />
              <XAxis dataKey="bin" tick={{ fill: COLORS.textMuted, fontSize: 11 }} interval={Math.max(0, Math.floor(irrBins.length / 10) - 1)} />
              <YAxis tick={{ fill: COLORS.textMuted, fontSize: 11 }} width={48} />
              <Tooltip cursor={BAR_CURSOR} content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const d = payload[0].payload;
                return (<div style={{ background: '#1F2937', border: `1px solid ${COLORS.cardBorder}`, borderRadius: 8, padding: '8px 14px', fontFamily: FONT }}>
                  <div style={{ color: COLORS.textBright, fontSize: 13, fontWeight: 600 }}>IRR: {fmtPct(d.edge)}</div>
                  <div style={{ color: COLORS.accent2, fontSize: 13 }}>Count: {d.count.toLocaleString()}</div>
                </div>);
              }} />
              <ReferenceLine x={nearestBinLabel(irrBins, 0.30)} stroke={COLORS.accent5} strokeDasharray="8 4" strokeWidth={2}
                label={{ value: '30% Hurdle', fill: COLORS.accent5, fontSize: 10, position: 'top' }} />
              <ReferenceLine x={nearestBinLabel(irrBins, 0.0)} stroke={COLORS.accent4} strokeDasharray="8 4" strokeWidth={1.5}
                label={{ value: '0% BE', fill: COLORS.accent4, fontSize: 9, position: 'top' }} />
              <Bar dataKey="count" radius={[2, 2, 0, 0]} maxBarSize={14} cursor={BAR_CURSOR}>
                {irrBins.map((e, i) => <Cell key={i} fill={e.midpoint >= 0.30 ? COLORS.accent2 : '#F59E0B80'} fillOpacity={0.85} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>
      )}

      {/* ── MOIC Confidence Band ── */}
      {hasBands && (
        <Card>
          <SectionTitle number="3" title={`MOIC Confidence Band — Tail ${selTail}%`}
            subtitle="P5–P95 outer band, P25–P75 inner band, median and mean lines." />
          <ResponsiveContainer width="100%" height={ui.chartHeight?.md || 380}>
            <ComposedChart data={moicBandData} margin={{ top: 16, right: 30, left: 10, bottom: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={COLORS.gridLine} />
              <XAxis dataKey="pct" tick={{ fill: COLORS.textMuted, fontSize: 12 }} />
              <YAxis tick={{ fill: COLORS.textMuted, fontSize: 12 }} label={{ value: 'MOIC', fill: COLORS.textMuted, angle: -90, position: 'insideLeft' }} />
              <Tooltip content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null;
                return (<div style={{ background: '#1F2937', border: `1px solid ${COLORS.cardBorder}`, borderRadius: 8, padding: '10px 14px', fontFamily: FONT }}>
                  <div style={{ color: COLORS.textBright, fontSize: 13, fontWeight: 700, marginBottom: 6 }}>{label}</div>
                  {payload.map((p, i) => (
                    <div key={i} style={{ display: 'flex', gap: 8, fontSize: 12, marginBottom: 2 }}>
                      <span style={{ color: p.color }}>{p.name}:</span>
                      <span style={{ color: COLORS.textBright, fontWeight: 600 }}>{fmtMOIC(p.value)}</span>
                    </div>
                  ))}
                </div>);
              }} />
              <ReferenceLine y={1.0} stroke={COLORS.accent5} strokeDasharray="6 4" label={{ value: '1.0× BE', fill: COLORS.accent5, fontSize: 10 }} />
              <Area dataKey="p95" stackId="outer" fill="transparent" stroke="transparent" />
              <Area dataKey="p5" stackId="outer" fill="#3B82F620" stroke="#3B82F640" name="P5–P95" />
              <Area dataKey="p75" stackId="inner" fill="transparent" stroke="transparent" />
              <Area dataKey="p25" stackId="inner" fill="#06B6D420" stroke="#06B6D440" name="P25–P75" />
              <Line type="monotone" dataKey="median" stroke="#F59E0B" strokeWidth={2} dot={false} name="Median" />
              <Line type="monotone" dataKey="mean" stroke="#34D399" strokeWidth={2} dot={false} strokeDasharray="6 3" name="Mean" />
              <Legend />
            </ComposedChart>
          </ResponsiveContainer>
        </Card>
      )}

      {/* ── Percentile Table ── */}
      {activeCell && (
        <Card>
          <SectionTitle number="4" title="Percentile Table"
            subtitle={`Full distributional metrics at ${selUp}% up / ${selTail}% tail.`} />
          <DataTable headers={['Metric', 'Value']} rows={percRows} />
        </Card>
      )}
    </div>
  );
}
