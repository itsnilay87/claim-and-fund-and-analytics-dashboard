/**
 * ScenariosAndPricing.jsx — Two exported views: PricingView + ReportView.
 *
 * PricingView — interactive sliders, histograms, MOIC + IRR confidence bands, heatmap
 * ReportView  — presentation-ready line charts (white background) for export
 *
 * Imported directly in App.jsx as separate top-level tabs.
 */

import React, { useState, useMemo } from 'react';
import {
  ComposedChart, BarChart, Bar, Line, Area, LineChart,
  XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend, ReferenceLine, Cell,
} from 'recharts';
import {
  COLORS, FONT, SIZES, SPACE, CHART_HEIGHT, CHART_FONT,
  useUISettings, fmtCr, fmtPct, fmtMOIC, moicColor, lossColor, getVerdictStyle, BAR_CURSOR,
} from '../theme';
import { Card, SectionTitle, KPI, CustomTooltip, Badge } from './Shared';

/* ═══════════════════════════════════════════════════════
   Confidence band colour palettes (professional HFT style)
   ═══════════════════════════════════════════════════════ */
const MOIC_BAND = {
  outer: '#3B82F6',   // blue
  inner: '#06B6D4',   // teal
  median: '#F59E0B',  // amber
  mean: '#34D399',    // emerald
};
const IRR_BAND = {
  outer: '#8B5CF6',   // violet
  inner: '#A78BFA',   // lavender
  median: '#F59E0B',  // amber
  mean: '#34D399',    // emerald
};

/* ═══════════════════════════════════════════════════════
   Colour helpers (from StochasticPricing)
   ═══════════════════════════════════════════════════════ */
function irrColor(v) {
  if (v >= 0.30) return '#065F46';
  if (v >= 0.20) return '#047857';
  if (v >= 0.10) return '#059669';
  if (v >= 0.00) return '#7C3AED40';
  return '#EF444480';
}
function hurdleColor(v) {
  if (v >= 0.80) return '#065F46';
  if (v >= 0.60) return '#047857';
  if (v >= 0.40) return '#059669';
  if (v >= 0.20) return '#D97706';
  return '#EF444480';
}

/** Find closest bin label for a given numeric value */
function nearestBinLabel(bins, value) {
  if (!bins || bins.length === 0) return undefined;
  let bestIdx = -1, bestDist = Infinity;
  for (let i = 0; i < bins.length; i++) {
    const dist = Math.abs(bins[i].edge - value);
    if (dist < bestDist) { bestDist = dist; bestIdx = i; }
  }
  return bestIdx >= 0 ? bins[bestIdx].bin : undefined;
}

const METRIC_OPTIONS = [
  { key: 'e_moic', label: 'E[MOIC]', fmt: v => fmtMOIC(v), colorFn: moicColor },
  { key: 'e_irr', label: 'E[IRR]', fmt: v => fmtPct(v), colorFn: irrColor },
  { key: 'prob_loss', label: 'P(Loss)', fmt: v => fmtPct(v), colorFn: lossColor },
  { key: 'prob_hurdle', label: 'P(IRR>30%)', fmt: v => fmtPct(v), colorFn: hurdleColor },
];

/* Report-mode colours (white background charts) */
const REPORT_BG   = '#FFFFFF';
const REPORT_TEXT  = '#1E293B';
const REPORT_MUTED = '#64748B';
const REPORT_GRID  = '#E2E8F0';
const TAIL_COLORS  = ['#2563EB','#7C3AED','#059669','#D97706','#DC2626','#0891B2','#4F46E5','#16A34A','#EA580C'];

/* ═══════════════════════════════════════════════════════
   Slider component
   ═══════════════════════════════════════════════════════ */
function ParamSlider({ label, value, options, onChange, color }) {
  const idx = options.indexOf(value);
  return (
    <div style={{ flex: 1, minWidth: 280 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ color: COLORS.textMuted, fontSize: SIZES.sm, fontWeight: 600, textTransform: 'uppercase' }}>{label}</span>
        <span style={{
          color: color, fontSize: SIZES.xl, fontWeight: 800,
          background: `${color}15`, padding: '2px 12px', borderRadius: 6,
        }}>{value}%</span>
      </div>
      <input type="range" min={0} max={options.length - 1}
        value={idx >= 0 ? idx : 0}
        onChange={e => onChange(options[parseInt(e.target.value)])}
        style={{
          WebkitAppearance: 'none', appearance: 'none', width: '100%',
          height: 8, borderRadius: 4, outline: 'none', cursor: 'pointer',
          background: `linear-gradient(90deg, ${color} ${(idx / (options.length - 1)) * 100}%, #1F2937 ${(idx / (options.length - 1)) * 100}%)`,
          accentColor: color,
        }} />
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
        <span style={{ color: COLORS.textMuted, fontSize: SIZES.xs }}>{options[0]}%</span>
        <span style={{ color: COLORS.textMuted, fontSize: SIZES.xs }}>{options[options.length - 1]}%</span>
      </div>
    </div>
  );
}

/* Report tooltip (white background) */
function ReportTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: '#FFF', border: '1px solid #E2E8F0', borderRadius: 8, padding: '10px 14px', fontFamily: FONT, boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}>
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

/* ═══════════════════════════════════════════════════════
   EXPORTED VIEW: Stochastic Pricing (top-level tab)
   ═══════════════════════════════════════════════════════ */
export function PricingView({ stochasticData }) {
  const { ui } = useUISettings();
  const [metric, setMetric] = useState('e_moic');
  const [selectedUpfront, setSelectedUpfront] = useState(null);
  const [selectedTail, setSelectedTail] = useState(null);
  const isNarrow = typeof window !== 'undefined' && window.innerWidth < 1400;

  if (!stochasticData || !stochasticData.grid) {
    return (
      <Card><SectionTitle title="No Stochastic Pricing Data" subtitle="Run v2_run.py with stochastic pricing enabled." /></Card>
    );
  }

  const { meta, grid } = stochasticData;
  const upfrontGrid = meta.upfront_grid || [];
  const tailGrid = meta.tail_grid || [];
  const simsPerCombo = meta.sims_per_combo || 0;
  const nCombos = meta.n_combos || Object.keys(grid).length;

  const activeUpfront = selectedUpfront ?? upfrontGrid[Math.floor(upfrontGrid.length / 2)] ?? upfrontGrid[0];
  const activeTail = selectedTail ?? tailGrid[Math.floor(tailGrid.length / 3)] ?? tailGrid[0];
  const activeKey = `${activeUpfront}_${activeTail}`;
  const activeCell = grid[activeKey];
  const currentMetric = METRIC_OPTIONS.find(m => m.key === metric) || METRIC_OPTIONS[0];

  const bestKey = useMemo(() =>
    Object.keys(grid).reduce((best, k) => (!grid[best] || (grid[k]?.e_moic > grid[best]?.e_moic)) ? k : best, Object.keys(grid)[0]),
    [grid]);
  const bestCell = grid[bestKey] || {};

  /* confidence band data — MOIC */
  const bandData = useMemo(() => upfrontGrid.map(up => {
    const c = grid[`${up}_${activeTail}`]; if (!c) return { pct: `${up}%`, upfront: up };
    return { pct: `${up}%`, upfront: up, p5: c.p5_moic, p25: c.p25_moic, median: c.p50_moic, p75: c.p75_moic, p95: c.p95_moic, mean: c.e_moic };
  }), [upfrontGrid, activeTail, grid]);

  /* confidence band data — IRR */
  const irrBandData = useMemo(() => upfrontGrid.map(up => {
    const c = grid[`${up}_${activeTail}`]; if (!c) return { pct: `${up}%`, upfront: up };
    return { pct: `${up}%`, upfront: up, p5: c.p5_irr, p25: c.p25_irr, median: c.p50_irr, p75: c.p75_irr, p95: c.p95_irr, mean: c.e_irr };
  }), [upfrontGrid, activeTail, grid]);

  /* heatmap rows */
  const heatmapRows = useMemo(() => upfrontGrid.map(up => {
    const row = { upfront: `${up}%`, upVal: up };
    for (const t of tailGrid) { const k = `${up}_${t}`, c = grid[k]; row[`t_${t}`] = c ? c[metric] : null; row[`cell_${t}`] = c; }
    return row;
  }), [upfrontGrid, tailGrid, grid, metric]);

  /* histograms */
  const moicBins = useMemo(() => {
    const h = activeCell?.moic_hist; if (!h || h.length < 2) return null;
    return h.slice(0, -1).map((b, i) => ({ bin: `${b.edge.toFixed(2)}×`, edge: b.edge, count: b.count, midpoint: (b.edge + h[i + 1].edge) / 2 }));
  }, [activeCell]);

  const irrBins = useMemo(() => {
    const h = activeCell?.irr_hist; if (!h || h.length < 2) return null;
    return h.slice(0, -1).map((b, i) => ({ bin: fmtPct(b.edge), edge: b.edge, count: b.count, midpoint: (b.edge + h[i + 1].edge) / 2 }));
  }, [activeCell]);

  // P1/P99: histogram is clipped to [P1, P99] by _compute_histogram, so first/last bin edges equal those percentiles
  const moicP1  = activeCell?.moic_hist?.[0]?.edge ?? null;
  const moicP99 = activeCell?.moic_hist?.length > 1 ? activeCell.moic_hist[activeCell.moic_hist.length - 1].edge : null;
  const irrP1   = activeCell?.irr_hist?.[0]?.edge ?? null;
  const irrP99  = activeCell?.irr_hist?.length > 1 ? activeCell.irr_hist[activeCell.irr_hist.length - 1].edge : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: ui.space.xl }}>
      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: ui.space.md }}>
        <KPI label="Grid Combos" value={nCombos} sub={`${upfrontGrid.length}×${tailGrid.length}`} color={COLORS.accent6} />
        <KPI label="Sims / Combo" value={simsPerCombo.toLocaleString()} color={COLORS.accent3} />
        <KPI label="Best E[MOIC]" value={fmtMOIC(bestCell.e_moic)} sub={`${bestCell.upfront_pct}% up / ${bestCell.tata_tail_pct}% tail`} color={COLORS.accent4} />
        <KPI label="Best E[IRR]" value={fmtPct(bestCell.e_irr)} color={COLORS.accent2} />
        <KPI label="Portfolio SOC" value={`₹${meta.portfolio_soc_cr?.toLocaleString()} Cr`} color={COLORS.accent1} />
      </div>

      {/* ── Section 1: Sliders + Detail ── */}
      <Card>
        <SectionTitle number="1" title="Interactive Pricing Explorer" subtitle="Drag sliders to explore any upfront % / Tata tail % combination." />
        <div style={{ display: 'flex', gap: ui.space.xxl, flexWrap: 'wrap', marginBottom: 24 }}>
          <ParamSlider label="Upfront Purchase %" value={activeUpfront} options={upfrontGrid} onChange={setSelectedUpfront} color={COLORS.accent1} />
          <ParamSlider label="Tata Tail %" value={activeTail} options={tailGrid} onChange={setSelectedTail} color={COLORS.accent2} />
        </div>
        {activeCell && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: ui.space.lg }}>
            {[
              { label: 'E[MOIC]', value: fmtMOIC(activeCell.e_moic), bg: moicColor(activeCell.e_moic) },
              { label: 'E[IRR]', value: fmtPct(activeCell.e_irr), bg: irrColor(activeCell.e_irr) },
              { label: 'P(Loss)', value: fmtPct(activeCell.prob_loss), bg: lossColor(activeCell.prob_loss) },
              { label: 'P(IRR>30%)', value: fmtPct(activeCell.prob_hurdle), bg: hurdleColor(activeCell.prob_hurdle) },
              { label: 'P5 MOIC', value: fmtMOIC(activeCell.p5_moic), bg: '#0F1219' },
              { label: 'P25 MOIC', value: fmtMOIC(activeCell.p25_moic), bg: '#0F1219' },
              { label: 'Median MOIC', value: fmtMOIC(activeCell.p50_moic), bg: '#0F1219' },
              { label: 'P95 MOIC', value: fmtMOIC(activeCell.p95_moic), bg: '#0F1219' },
            ].map((item, i) => (
              <div key={i} style={{
                textAlign: 'center', padding: 14, borderRadius: 10,
                background: item.bg, border: `1px solid ${i < 4 ? item.bg + '40' : COLORS.cardBorder}`,
              }}>
                <div style={{ color: '#ffffffAA', fontSize: ui.sizes.sm, fontWeight: 600, marginBottom: 4, textTransform: 'uppercase' }}>{item.label}</div>
                <div style={{ color: '#fff', fontSize: ui.sizes.xl, fontWeight: 800 }}>{item.value}</div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* ── Section 2a: IRR histogram ── */}
      {irrBins && (
        <Card>
          <SectionTitle number="2a" title={`IRR Distribution — ${activeUpfront}% Up / ${activeTail}% Tail`} subtitle="20-bin histogram of annualized IRR. Vertical lines: 30% hurdle · mean · median · IQR." />
          <ResponsiveContainer width="100%" height={ui.chartHeight.md}>
            <BarChart data={irrBins} margin={{ top: 16, right: 30, left: 10, bottom: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={COLORS.gridLine} vertical={false} />
              <XAxis dataKey="bin" tick={{ fill: COLORS.textMuted, fontSize: ui.sizes.sm }} interval={Math.max(0, Math.floor(irrBins.length / (isNarrow ? 8 : 12)) - 1)} />
              <YAxis tick={{ fill: COLORS.textMuted, fontSize: ui.sizes.sm }} width={isNarrow ? 44 : 56} />
              <Tooltip cursor={{ fill: 'rgba(6,182,212,0.06)' }} content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const d = payload[0].payload;
                return (<div style={{ background: '#1F2937', border: `1px solid ${COLORS.cardBorder}`, borderRadius: 8, padding: '8px 14px', fontFamily: FONT }}>
                  <div style={{ color: COLORS.textBright, fontSize: ui.sizes.sm, fontWeight: 600 }}>IRR: {fmtPct(d.edge)}</div>
                  <div style={{ color: COLORS.accent2, fontSize: ui.sizes.sm }}>Count: {d.count.toLocaleString()}</div>
                </div>);
              }} />
              <ReferenceLine x={nearestBinLabel(irrBins, 0.30)}
                stroke={COLORS.accent5} strokeDasharray="8 4" strokeWidth={2}
                label={{ value: '30% Hurdle', fill: COLORS.accent5, fontSize: 10, position: 'top' }} />
              <ReferenceLine x={nearestBinLabel(irrBins, 0.0)}
                stroke={COLORS.accent4} strokeDasharray="8 4" strokeWidth={1.5}
                label={{ value: '0% BE', fill: COLORS.accent4, fontSize: 9, position: 'top' }} />
              {activeCell?.e_irr != null && <ReferenceLine x={nearestBinLabel(irrBins, activeCell.e_irr)}
                stroke={COLORS.accent6} strokeDasharray="6 3" strokeWidth={1.5}
                label={{ value: 'Mean', fill: COLORS.accent6, fontSize: 10, position: 'top' }} />}
              {activeCell?.p50_irr != null && <ReferenceLine x={nearestBinLabel(irrBins, activeCell.p50_irr)}
                stroke={COLORS.accent1} strokeDasharray="4 4" strokeWidth={1.5}
                label={{ value: 'Median', fill: COLORS.accent1, fontSize: 10, position: 'top' }} />}
              {activeCell?.p25_irr != null && <ReferenceLine x={nearestBinLabel(irrBins, activeCell.p25_irr)}
                stroke={COLORS.accent3} strokeDasharray="3 3" strokeWidth={1}
                label={{ value: 'P25', fill: COLORS.accent3, fontSize: 9, position: 'top' }} />}
              {activeCell?.p75_irr != null && <ReferenceLine x={nearestBinLabel(irrBins, activeCell.p75_irr)}
                stroke={COLORS.accent3} strokeDasharray="3 3" strokeWidth={1}
                label={{ value: 'P75', fill: COLORS.accent3, fontSize: 9, position: 'top' }} />}
              {/* P5 / P95 tail band */}
              {activeCell?.p5_irr != null && <ReferenceLine x={nearestBinLabel(irrBins, activeCell.p5_irr)}
                stroke="#F97316" strokeDasharray="5 3" strokeWidth={1}
                label={{ value: 'P5', fill: '#F97316', fontSize: 9, position: 'top' }} />}
              {activeCell?.p95_irr != null && <ReferenceLine x={nearestBinLabel(irrBins, activeCell.p95_irr)}
                stroke="#F97316" strokeDasharray="5 3" strokeWidth={1}
                label={{ value: 'P95', fill: '#F97316', fontSize: 9, position: 'top' }} />}
              {/* P1 / P99 extreme tail (derived from histogram clip bounds) */}
              {irrP1 != null && <ReferenceLine x={nearestBinLabel(irrBins, irrP1)}
                stroke="#EF4444" strokeDasharray="2 2" strokeWidth={1}
                label={{ value: 'P1', fill: '#EF4444', fontSize: 9, position: 'top' }} />}
              {irrP99 != null && <ReferenceLine x={nearestBinLabel(irrBins, irrP99)}
                stroke="#EF4444" strokeDasharray="2 2" strokeWidth={1}
                label={{ value: 'P99', fill: '#EF4444', fontSize: 9, position: 'top' }} />}
              <Bar dataKey="count" radius={[2, 2, 0, 0]} maxBarSize={12} cursor={BAR_CURSOR}>
                {irrBins.map((e, i) => <Cell key={i} fill={e.midpoint >= 0.30 ? COLORS.accent2 : '#F59E0B80'} fillOpacity={0.85} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          {/* Rich stat legend */}
          <div style={{ display: 'flex', justifyContent: 'center', gap: 14, marginTop: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <div style={{ width: 14, height: 14, background: COLORS.accent2, borderRadius: 3 }} />
              <span style={{ color: COLORS.textMuted, fontSize: ui.sizes.sm }}>Above hurdle (≥30%)</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <div style={{ width: 14, height: 14, background: '#F59E0B80', borderRadius: 3 }} />
              <span style={{ color: COLORS.textMuted, fontSize: ui.sizes.sm }}>Below hurdle (&lt;30%)</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <div style={{ width: 20, height: 2, background: COLORS.accent6 }} />
              <span style={{ color: COLORS.textMuted, fontSize: ui.sizes.sm }}>Mean: <span style={{ color: COLORS.accent6, fontWeight: 700 }}>{fmtPct(activeCell?.e_irr)}</span></span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <div style={{ width: 20, height: 2, background: COLORS.accent1 }} />
              <span style={{ color: COLORS.textMuted, fontSize: ui.sizes.sm }}>Median: <span style={{ color: COLORS.accent1, fontWeight: 700 }}>{fmtPct(activeCell?.p50_irr)}</span></span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <div style={{ width: 20, height: 2, background: COLORS.accent3 }} />
              <span style={{ color: COLORS.textMuted, fontSize: ui.sizes.sm }}>IQR: <span style={{ color: COLORS.accent3, fontWeight: 600 }}>{fmtPct(activeCell?.p25_irr)} – {fmtPct(activeCell?.p75_irr)}</span></span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <div style={{ width: 20, height: 2, background: COLORS.accent5 }} />
              <span style={{ color: COLORS.textMuted, fontSize: ui.sizes.sm }}>30% Hurdle</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <div style={{ width: 20, height: 2, background: COLORS.accent4 }} />
              <span style={{ color: COLORS.textMuted, fontSize: ui.sizes.sm }}>Breakeven (0%)</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <div style={{ width: 20, height: 2, background: '#F97316' }} />
              <span style={{ color: COLORS.textMuted, fontSize: ui.sizes.sm }}>P5: <span style={{ color: '#F97316', fontWeight: 700 }}>{fmtPct(activeCell?.p5_irr)}</span> / P95: <span style={{ color: '#F97316', fontWeight: 700 }}>{fmtPct(activeCell?.p95_irr)}</span></span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <div style={{ width: 20, height: 2, background: '#EF4444' }} />
              <span style={{ color: COLORS.textMuted, fontSize: ui.sizes.sm }}>P1: <span style={{ color: '#EF4444', fontWeight: 700 }}>{irrP1 != null ? fmtPct(irrP1) : '—'}</span> / P99: <span style={{ color: '#EF4444', fontWeight: 700 }}>{irrP99 != null ? fmtPct(irrP99) : '—'}</span></span>
            </div>
          </div>
        </Card>
      )}

      {/* ── Section 2b: MOIC histogram ── */}
      {moicBins && (
        <Card>
          <SectionTitle number="2b" title={`MOIC Distribution — ${activeUpfront}% Up / ${activeTail}% Tail`} subtitle="20-bin histogram of simulated outcomes. Vertical lines: mean · median · IQR · breakeven." />
          <ResponsiveContainer width="100%" height={ui.chartHeight.md}>
            <BarChart data={moicBins} margin={{ top: 16, right: 30, left: 10, bottom: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={COLORS.gridLine} vertical={false} />
              <XAxis dataKey="bin" tick={{ fill: COLORS.textMuted, fontSize: ui.sizes.sm }} interval={Math.max(0, Math.floor(moicBins.length / (isNarrow ? 8 : 12)) - 1)} />
              <YAxis tick={{ fill: COLORS.textMuted, fontSize: ui.sizes.sm }} width={isNarrow ? 44 : 56} />
              <Tooltip cursor={{ fill: 'rgba(6,182,212,0.06)' }} content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const d = payload[0].payload;
                return (<div style={{ background: '#1F2937', border: `1px solid ${COLORS.cardBorder}`, borderRadius: 8, padding: '8px 14px', fontFamily: FONT }}>
                  <div style={{ color: COLORS.textBright, fontSize: ui.sizes.sm, fontWeight: 600 }}>MOIC: {d.edge.toFixed(3)}×</div>
                  <div style={{ color: COLORS.accent1, fontSize: ui.sizes.sm }}>Count: {d.count.toLocaleString()}</div>
                </div>);
              }} />
              <ReferenceLine x={nearestBinLabel(moicBins, 1.0)}
                stroke={COLORS.accent5} strokeDasharray="8 4" strokeWidth={2}
                label={{ value: 'Breakeven', fill: COLORS.accent5, fontSize: 10, position: 'top' }} />
              {activeCell?.e_moic != null && <ReferenceLine x={nearestBinLabel(moicBins, activeCell.e_moic)}
                stroke={COLORS.accent6} strokeDasharray="6 3" strokeWidth={1.5}
                label={{ value: 'Mean', fill: COLORS.accent6, fontSize: 10, position: 'top' }} />}
              {activeCell?.p50_moic != null && <ReferenceLine x={nearestBinLabel(moicBins, activeCell.p50_moic)}
                stroke={COLORS.accent1} strokeDasharray="4 4" strokeWidth={1.5}
                label={{ value: 'Median', fill: COLORS.accent1, fontSize: 10, position: 'top' }} />}
              {activeCell?.p25_moic != null && <ReferenceLine x={nearestBinLabel(moicBins, activeCell.p25_moic)}
                stroke={COLORS.accent3} strokeDasharray="3 3" strokeWidth={1}
                label={{ value: 'P25', fill: COLORS.accent3, fontSize: 9, position: 'top' }} />}
              {activeCell?.p75_moic != null && <ReferenceLine x={nearestBinLabel(moicBins, activeCell.p75_moic)}
                stroke={COLORS.accent3} strokeDasharray="3 3" strokeWidth={1}
                label={{ value: 'P75', fill: COLORS.accent3, fontSize: 9, position: 'top' }} />}
              {/* P5 / P95 tail band */}
              {activeCell?.p5_moic != null && <ReferenceLine x={nearestBinLabel(moicBins, activeCell.p5_moic)}
                stroke="#F97316" strokeDasharray="5 3" strokeWidth={1}
                label={{ value: 'P5', fill: '#F97316', fontSize: 9, position: 'top' }} />}
              {activeCell?.p95_moic != null && <ReferenceLine x={nearestBinLabel(moicBins, activeCell.p95_moic)}
                stroke="#F97316" strokeDasharray="5 3" strokeWidth={1}
                label={{ value: 'P95', fill: '#F97316', fontSize: 9, position: 'top' }} />}
              {/* P1 / P99 extreme tail (derived from histogram clip bounds) */}
              {moicP1 != null && <ReferenceLine x={nearestBinLabel(moicBins, moicP1)}
                stroke="#EF4444" strokeDasharray="2 2" strokeWidth={1}
                label={{ value: 'P1', fill: '#EF4444', fontSize: 9, position: 'top' }} />}
              {moicP99 != null && <ReferenceLine x={nearestBinLabel(moicBins, moicP99)}
                stroke="#EF4444" strokeDasharray="2 2" strokeWidth={1}
                label={{ value: 'P99', fill: '#EF4444', fontSize: 9, position: 'top' }} />}
              <Bar dataKey="count" radius={[2, 2, 0, 0]} maxBarSize={12} cursor={BAR_CURSOR}>
                {moicBins.map((e, i) => <Cell key={i} fill={e.midpoint >= 1.0 ? COLORS.accent1 : '#EF444490'} fillOpacity={0.85} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          {/* Rich stat legend */}
          <div style={{ display: 'flex', justifyContent: 'center', gap: 14, marginTop: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <div style={{ width: 14, height: 14, background: COLORS.accent1, borderRadius: 3 }} />
              <span style={{ color: COLORS.textMuted, fontSize: ui.sizes.sm }}>Profit (≥1.0×)</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <div style={{ width: 14, height: 14, background: '#EF444490', borderRadius: 3 }} />
              <span style={{ color: COLORS.textMuted, fontSize: ui.sizes.sm }}>Loss (&lt;1.0×)</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <div style={{ width: 20, height: 2, background: COLORS.accent6 }} />
              <span style={{ color: COLORS.textMuted, fontSize: ui.sizes.sm }}>Mean: <span style={{ color: COLORS.accent6, fontWeight: 700 }}>{fmtMOIC(activeCell?.e_moic)}</span></span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <div style={{ width: 20, height: 2, background: COLORS.accent1 }} />
              <span style={{ color: COLORS.textMuted, fontSize: ui.sizes.sm }}>Median: <span style={{ color: COLORS.accent1, fontWeight: 700 }}>{fmtMOIC(activeCell?.p50_moic)}</span></span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <div style={{ width: 20, height: 2, background: COLORS.accent3 }} />
              <span style={{ color: COLORS.textMuted, fontSize: ui.sizes.sm }}>IQR: <span style={{ color: COLORS.accent3, fontWeight: 600 }}>{fmtMOIC(activeCell?.p25_moic)} – {fmtMOIC(activeCell?.p75_moic)}</span></span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <div style={{ width: 20, height: 2, background: COLORS.accent5 }} />
              <span style={{ color: COLORS.textMuted, fontSize: ui.sizes.sm }}>Breakeven (1.0×)</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <div style={{ width: 20, height: 2, background: '#F97316' }} />
              <span style={{ color: COLORS.textMuted, fontSize: ui.sizes.sm }}>P5: <span style={{ color: '#F97316', fontWeight: 700 }}>{fmtMOIC(activeCell?.p5_moic)}</span> / P95: <span style={{ color: '#F97316', fontWeight: 700 }}>{fmtMOIC(activeCell?.p95_moic)}</span></span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <div style={{ width: 20, height: 2, background: '#EF4444' }} />
              <span style={{ color: COLORS.textMuted, fontSize: ui.sizes.sm }}>P1: <span style={{ color: '#EF4444', fontWeight: 700 }}>{moicP1 != null ? moicP1.toFixed(2) + '×' : '—'}</span> / P99: <span style={{ color: '#EF4444', fontWeight: 700 }}>{moicP99 != null ? moicP99.toFixed(2) + '×' : '—'}</span></span>
            </div>
          </div>
        </Card>
      )}

      {/* ── Section 3: MOIC Confidence Bands ── */}
      <Card>
        <SectionTitle number="3" title={`MOIC Confidence Bands — Tail ${activeTail}%`} subtitle="P5–P95 outer, P25–P75 inner. Line = median. Dot = mean." />
        <ResponsiveContainer width="100%" height={ui.chartHeight.lg}>
          <ComposedChart data={bandData} margin={{ top: 10, right: 30, left: 10, bottom: 20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={COLORS.gridLine} />
            <XAxis dataKey="pct" tick={{ fill: COLORS.textMuted, fontSize: ui.sizes.sm }} interval={isNarrow ? 1 : 0} />
            <YAxis tick={{ fill: COLORS.textMuted, fontSize: ui.sizes.sm }} tickFormatter={v => v + '×'} width={isNarrow ? 44 : 56} />
            <Tooltip cursor={{ fill: 'rgba(6,182,212,0.06)' }} content={<CustomTooltip />} />
            <ReferenceLine y={1} stroke={COLORS.breakeven} strokeDasharray="8 4" strokeWidth={2} />
            <Area type="monotone" dataKey="p95" stroke="none" fill={MOIC_BAND.outer} fillOpacity={0.12} name="P95" />
            <Area type="monotone" dataKey="p5" stroke="none" fill={COLORS.bg} fillOpacity={1} name="P5" />
            <Area type="monotone" dataKey="p75" stroke="none" fill={MOIC_BAND.inner} fillOpacity={0.22} name="P75" />
            <Area type="monotone" dataKey="p25" stroke="none" fill={COLORS.bg} fillOpacity={1} name="P25" />
            <Line type="monotone" dataKey="median" stroke={MOIC_BAND.median} strokeWidth={3} dot={false} name="Median" />
            <Line type="monotone" dataKey="mean" stroke={MOIC_BAND.mean} strokeWidth={2} strokeDasharray="6 3" dot={{ fill: MOIC_BAND.mean, r: 4, stroke: COLORS.bg, strokeWidth: 2 }} name="Mean" />
          </ComposedChart>
        </ResponsiveContainer>
        <div style={{ display: 'flex', justifyContent: 'center', gap: ui.space.xl, marginTop: 12 }}>
          {[
            { bg: MOIC_BAND.outer, op: 0.12, label: 'P5–P95' },
            { bg: MOIC_BAND.inner, op: 0.22, label: 'P25–P75' },
            { bg: MOIC_BAND.median, op: 1, label: 'Median', h: 3 },
            { bg: MOIC_BAND.mean, op: 1, label: 'Mean', h: 3 },
          ].map(({ bg, op, label, h }, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ width: 20, height: h || 10, background: bg, opacity: op, borderRadius: 2 }} />
              <span style={{ color: COLORS.textMuted, fontSize: ui.sizes.sm }}>{label}</span>
            </div>
          ))}
        </div>
      </Card>

      {/* ── Section 3b: IRR Confidence Bands ── */}
      <Card>
        <SectionTitle number="3b" title={`IRR Confidence Bands — Tail ${activeTail}%`} subtitle="P5–P95 outer, P25–P75 inner. Line = median. Dot = mean. Dashed = 30% hurdle." />
        <ResponsiveContainer width="100%" height={ui.chartHeight.lg}>
          <ComposedChart data={irrBandData} margin={{ top: 10, right: 30, left: 10, bottom: 20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={COLORS.gridLine} />
            <XAxis dataKey="pct" tick={{ fill: COLORS.textMuted, fontSize: ui.sizes.sm }} interval={isNarrow ? 1 : 0} />
            <YAxis tick={{ fill: COLORS.textMuted, fontSize: ui.sizes.sm }} tickFormatter={v => (v * 100).toFixed(0) + '%'} width={isNarrow ? 44 : 56} />
            <Tooltip cursor={{ fill: 'rgba(6,182,212,0.06)' }} content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null;
              return (
                <div style={{ background: COLORS.card, border: `1px solid ${COLORS.cardBorder}`, borderRadius: 8, padding: '10px 14px', fontFamily: FONT }}>
                  <div style={{ color: COLORS.textBright, fontWeight: 700, fontSize: ui.sizes.sm, marginBottom: 6 }}>Upfront: {label}</div>
                  {payload.filter(p => p.value != null).map((p, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: ui.sizes.sm, marginBottom: 2 }}>
                      <div style={{ width: 8, height: 8, borderRadius: 4, background: p.color || p.stroke }} />
                      <span style={{ color: COLORS.textMuted }}>{p.name}:</span>
                      <span style={{ fontWeight: 600, color: COLORS.textBright }}>{fmtPct(p.value)}</span>
                    </div>
                  ))}
                </div>
              );
            }} />
            <ReferenceLine y={0.30} stroke="#D97706" strokeDasharray="8 4" strokeWidth={1.5} label={{ value: '30% hurdle', fill: '#D97706', fontSize: 10, position: 'right' }} />
            <ReferenceLine y={0} stroke={COLORS.accent5} strokeDasharray="6 4" strokeWidth={1} />
            <Area type="monotone" dataKey="p95" stroke="none" fill={IRR_BAND.outer} fillOpacity={0.12} name="P95" />
            <Area type="monotone" dataKey="p5" stroke="none" fill={COLORS.bg} fillOpacity={1} name="P5" />
            <Area type="monotone" dataKey="p75" stroke="none" fill={IRR_BAND.inner} fillOpacity={0.22} name="P75" />
            <Area type="monotone" dataKey="p25" stroke="none" fill={COLORS.bg} fillOpacity={1} name="P25" />
            <Line type="monotone" dataKey="median" stroke={IRR_BAND.median} strokeWidth={3} dot={false} name="Median" />
            <Line type="monotone" dataKey="mean" stroke={IRR_BAND.mean} strokeWidth={2} strokeDasharray="6 3" dot={{ fill: IRR_BAND.mean, r: 4, stroke: COLORS.bg, strokeWidth: 2 }} name="Mean" />
          </ComposedChart>
        </ResponsiveContainer>
        <div style={{ display: 'flex', justifyContent: 'center', gap: ui.space.xl, marginTop: 12 }}>
          {[
            { bg: IRR_BAND.outer, op: 0.12, label: 'P5–P95' },
            { bg: IRR_BAND.inner, op: 0.22, label: 'P25–P75' },
            { bg: IRR_BAND.median, op: 1, label: 'Median', h: 3 },
            { bg: IRR_BAND.mean, op: 1, label: 'Mean', h: 3 },
            { bg: '#D97706', op: 1, label: '30% Hurdle', h: 3 },
          ].map(({ bg, op, label, h }, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ width: 20, height: h || 10, background: bg, opacity: op, borderRadius: 2 }} />
              <span style={{ color: COLORS.textMuted, fontSize: ui.sizes.sm }}>{label}</span>
            </div>
          ))}
        </div>
      </Card>

      {/* ── Section 4: Metric Selector + Heatmap ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: ui.space.md, flexWrap: 'wrap' }}>
        <span style={{ color: COLORS.textMuted, fontSize: ui.sizes.sm, fontWeight: 600 }}>Heatmap Metric:</span>
        {METRIC_OPTIONS.map(m => (
          <button key={m.key} onClick={() => setMetric(m.key)} style={{
            padding: '8px 16px', borderRadius: 8, border: 'none', cursor: 'pointer',
            fontFamily: FONT, fontSize: ui.sizes.sm, fontWeight: 600,
            color: metric === m.key ? '#fff' : COLORS.textMuted,
            background: metric === m.key ? COLORS.gradient1 : COLORS.card,
            transition: 'all 0.2s',
          }}>{m.label}</button>
        ))}
      </div>

      <Card>
        <SectionTitle number="4" title={`${currentMetric.label} Heatmap — Full Pricing Grid`}
          subtitle={`Rows = upfront %, Columns = Tata Tail %. ${simsPerCombo.toLocaleString()} MC paths per cell. Click to select.`} />
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 3, fontFamily: FONT }}>
            <thead>
              <tr>
                <th style={{ padding: '10px 14px', color: COLORS.textMuted, fontSize: ui.sizes.sm, fontWeight: 600, textAlign: 'left' }}>Up↓ / Tail→</th>
                {tailGrid.map(t => (
                  <th key={t} style={{ padding: '10px 14px', color: t === activeTail ? COLORS.accent2 : COLORS.textMuted,
                    fontSize: ui.sizes.sm, fontWeight: t === activeTail ? 800 : 600, textAlign: 'center',
                    borderBottom: t === activeTail ? `2px solid ${COLORS.accent2}` : 'none' }}>{t}%</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {heatmapRows.map((row, ri) => {
                const isActiveRow = row.upVal === activeUpfront;
                return (
                  <tr key={ri}>
                    <td style={{ padding: '10px 14px', fontSize: ui.sizes.sm, fontWeight: isActiveRow ? 800 : 600, color: isActiveRow ? COLORS.accent1 : COLORS.textBright }}>{row.upfront}</td>
                    {tailGrid.map(t => {
                      const val = row[`t_${t}`], cell = row[`cell_${t}`];
                      const isActive = row.upVal === activeUpfront && t === activeTail;
                      return (
                        <td key={t} onClick={() => { if (cell) { setSelectedUpfront(cell.upfront_pct); setSelectedTail(cell.tata_tail_pct); } }}
                          style={{
                            padding: '10px 14px', textAlign: 'center', borderRadius: 6,
                            background: val != null ? currentMetric.colorFn(val) : '#1F2937',
                            color: COLORS.textBright, fontSize: SIZES.base, fontWeight: 700,
                            cursor: cell ? 'pointer' : 'default',
                            outline: isActive ? `3px solid ${COLORS.accent1}` : 'none',
                            outlineOffset: isActive ? -2 : 0,
                            boxShadow: isActive ? `0 0 12px ${COLORS.accent1}40` : 'none',
                          }}>{val != null ? currentMetric.fmt(val) : '—'}</td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   Legend dot helper used in histograms
   ═══════════════════════════════════════════════════════ */
function ColorLegend({ color, label }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div style={{ width: 14, height: 14, background: color, borderRadius: 3 }} />
      <span style={{ color: COLORS.textMuted, fontSize: SIZES.sm }}>{label}</span>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   EXPORTED VIEW: Report Charts (white-bg presentation-ready)
   ═══════════════════════════════════════════════════════ */
export function ReportView({ stochasticData }) {
  const { ui } = useUISettings();
  const [selectedTails, setSelectedTails] = useState([10, 20, 30, 40, 50]);

  if (!stochasticData || !stochasticData.grid) {
    return (
      <Card><SectionTitle title="No Stochastic Pricing Data" subtitle="Run with stochastic pricing enabled to generate report charts." /></Card>
    );
  }

  const { meta, grid } = stochasticData;
  const upfrontGrid = meta.upfront_grid || [];
  const tailGrid = meta.tail_grid || [];

  const moicData = useMemo(() => upfrontGrid.map(up => {
    const row = { pct: `${up}%`, upfront: up };
    for (const t of tailGrid) { const c = grid[`${up}_${t}`]; row[`tail_${t}`] = c?.e_moic ?? null; }
    return row;
  }), [upfrontGrid, tailGrid, grid]);

  const irrData = useMemo(() => upfrontGrid.map(up => {
    const row = { pct: `${up}%`, upfront: up };
    for (const t of tailGrid) { const c = grid[`${up}_${t}`]; row[`tail_${t}`] = c?.e_irr ?? null; }
    return row;
  }), [upfrontGrid, tailGrid, grid]);

  const lossData = useMemo(() => upfrontGrid.map(up => {
    const row = { pct: `${up}%`, upfront: up };
    for (const t of tailGrid) { const c = grid[`${up}_${t}`]; row[`tail_${t}`] = c?.prob_loss ?? null; }
    return row;
  }), [upfrontGrid, tailGrid, grid]);

  const toggleTail = t => setSelectedTails(prev => prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t].sort((a, b) => a - b));

  const chartBox = { background: REPORT_BG, borderRadius: 12, padding: 24, border: '1px solid #E2E8F0' };
  const title = { color: REPORT_TEXT, fontSize: SIZES.lg, fontWeight: 700, fontFamily: FONT, marginBottom: 4 };
  const sub = { color: REPORT_MUTED, fontSize: SIZES.sm, fontFamily: FONT, marginBottom: 20 };

  const charts = [
    { data: moicData, label: 'E[MOIC] vs Upfront Purchase %', sub: 'Multi-line comparison across Tata Tail levels. Higher is better.',
      yFmt: v => v + '×', yLabel: 'E[MOIC]', refY: 1, refStroke: '#94A3B8', refLabel: null },
    { data: irrData, label: 'E[IRR] vs Upfront Purchase %', sub: 'Expected annual IRR. 30% hurdle shown dashed.',
      yFmt: v => (v * 100).toFixed(0) + '%', yLabel: 'E[IRR]', refY: 0.30, refStroke: '#D97706', refLabel: '30% hurdle' },
    { data: lossData, label: 'P(Loss) vs Upfront Purchase %', sub: 'Probability of MOIC < 1.0×. Lower is safer. Red zone above 20%.',
      yFmt: v => (v * 100).toFixed(0) + '%', yLabel: 'P(Loss)', refY: 0.20, refStroke: '#DC2626', refLabel: '20% threshold' },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: ui.space.xl }}>
      {/* Tail selector */}
      <div style={{ display: 'flex', alignItems: 'center', gap: SPACE.md, flexWrap: 'wrap' }}>
        <span style={{ color: COLORS.textMuted, fontSize: SIZES.sm }}>Show Tata Tail lines:</span>
        {tailGrid.map((t, i) => (
          <button key={t} onClick={() => toggleTail(t)} style={{
            padding: '6px 14px', borderRadius: 6, border: 'none', cursor: 'pointer',
            fontFamily: FONT, fontSize: SIZES.sm, fontWeight: 600,
            color: selectedTails.includes(t) ? '#fff' : COLORS.textMuted,
            background: selectedTails.includes(t) ? TAIL_COLORS[i % TAIL_COLORS.length] : COLORS.card,
          }}>{t}%</button>
        ))}
      </div>

      {charts.map((ch, ci) => (
        <div key={ci} style={chartBox}>
          <div style={title}>{ch.label}</div>
          <div style={sub}>{ch.sub}</div>
          <ResponsiveContainer width="100%" height={400}>
            <LineChart data={ch.data} margin={{ top: 10, right: 30, left: 10, bottom: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={REPORT_GRID} />
              <XAxis dataKey="pct" tick={{ fill: REPORT_MUTED, fontSize: SIZES.sm }} label={{ value: 'Upfront Purchase %', position: 'bottom', fill: REPORT_MUTED, fontSize: SIZES.sm }} />
              <YAxis tick={{ fill: REPORT_MUTED, fontSize: SIZES.sm }} tickFormatter={ch.yFmt} label={{ value: ch.yLabel, angle: -90, position: 'insideLeft', fill: REPORT_MUTED, fontSize: SIZES.sm }} />
              <Tooltip cursor={{ fill: 'rgba(6,182,212,0.06)' }} content={<ReportTooltip />} />
              {ch.refY != null && (
                <ReferenceLine y={ch.refY} stroke={ch.refStroke} strokeDasharray="8 4" strokeWidth={1.5}
                  label={ch.refLabel ? { value: ch.refLabel, fill: ch.refStroke, fontSize: SIZES.xs, position: 'right' } : undefined} />
              )}
              {tailGrid.filter(t => selectedTails.includes(t)).map(t => (
                <Line key={t} type="monotone" dataKey={`tail_${t}`}
                  stroke={TAIL_COLORS[tailGrid.indexOf(t) % TAIL_COLORS.length]}
                  strokeWidth={2.5}
                  dot={{ r: 3, fill: TAIL_COLORS[tailGrid.indexOf(t) % TAIL_COLORS.length], stroke: REPORT_BG, strokeWidth: 2 }}
                  name={`Tail ${t}%`} connectNulls />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      ))}
    </div>
  );
}
