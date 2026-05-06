/**
 * StochasticPricing.jsx — Stochastic pricing grid with interactive sliders.
 *
 * Layout (reordered): KPIs → Sliders + Detail → Histograms → Confidence Bands → Heatmap
 *
 * Data source: stochasticData = { meta, grid }
 *   meta.upfront_grid: [5, 7.5, ..., 30]
 *   meta.tail_grid: [10, 15, ..., 50]
 *   grid["5_10"] = { upfront_pct, tata_tail_pct, e_moic, e_irr,
 *     p5_moic, p25_moic, p50_moic, p75_moic, p95_moic,
 *     p5_irr, p25_irr, p50_irr, p75_irr, p95_irr,
 *     prob_loss, prob_hurdle, moic_hist, irr_hist }
 */

import React, { useState, useMemo, useCallback } from 'react';
import {
  ComposedChart, BarChart, Bar, Line, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine, Cell,
} from 'recharts';
import { COLORS, FONT, SIZES, SPACE, CHART_HEIGHT, CHART_FONT, useUISettings, fmtPct, fmtMOIC, moicColor, lossColor, irrColor, hurdleColor, BAR_CURSOR } from '../theme';
import { Card, SectionTitle, KPI, CustomTooltip } from './Shared';

/* ---------- color helpers ---------- */
const METRIC_OPTIONS = [
  { key: 'e_moic', label: 'E[MOIC]', fmt: v => fmtMOIC(v), colorFn: moicColor },
  { key: 'e_irr', label: 'E[IRR]', fmt: v => fmtPct(v), colorFn: irrColor },
  { key: 'prob_loss', label: 'P(Loss)', fmt: v => fmtPct(v), colorFn: lossColor },
  { key: 'prob_hurdle', label: 'P(IRR>30%)', fmt: v => fmtPct(v), colorFn: hurdleColor },
];

/** Find nearest bin label for a given value */
function nearestBinLabel(bins, value) {
  if (!bins || bins.length === 0) return undefined;
  let bestIdx = -1;
  let bestDist = Infinity;
  for (let i = 0; i < bins.length; i++) {
    const dist = Math.abs(bins[i].edge - value);
    if (dist < bestDist) { bestDist = dist; bestIdx = i; }
  }
  return bestIdx >= 0 ? bins[bestIdx].bin : undefined;
}

/* ---------- slider style ---------- */
const sliderTrackStyle = {
  WebkitAppearance: 'none',
  appearance: 'none',
  width: '100%',
  height: 8,
  borderRadius: 4,
  outline: 'none',
  cursor: 'pointer',
};

/* ---------- Slider component ---------- */
function ParamSlider({ label, value, options, onChange, color, formatValue }) {
  const idx = options.indexOf(value);
  return (
    <div style={{ flex: 1, minWidth: 280 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ color: COLORS.textMuted, fontSize: SIZES.sm, fontWeight: 600, textTransform: 'uppercase' }}>{label}</span>
        <span style={{
          color: color || COLORS.accent1, fontSize: SIZES.xl, fontWeight: 800,
          background: `${color || COLORS.accent1}15`, padding: '2px 12px', borderRadius: 6,
        }}>
          {formatValue ? formatValue(value) : `${value}%`}
        </span>
      </div>
      <input
        type="range"
        min={0}
        max={options.length - 1}
        value={idx >= 0 ? idx : 0}
        onChange={e => onChange(options[parseInt(e.target.value)])}
        style={{
          ...sliderTrackStyle,
          background: `linear-gradient(90deg, ${color || COLORS.accent1} ${(idx / (options.length - 1)) * 100}%, #1F2937 ${(idx / (options.length - 1)) * 100}%)`,
          accentColor: color || COLORS.accent1,
        }}
      />
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
        <span style={{ color: COLORS.textMuted, fontSize: SIZES.xs }}>{options[0]}%</span>
        <span style={{ color: COLORS.textMuted, fontSize: SIZES.xs }}>{options[options.length - 1]}%</span>
      </div>
    </div>
  );
}

/* ---------- main component ---------- */
export default function StochasticPricing({ stochasticData }) {
  const { ui } = useUISettings();
  const [metric, setMetric] = useState('e_moic');
  const [selectedUpfront, setSelectedUpfront] = useState(null);
  const [selectedTail, setSelectedTail] = useState(null);
  const isNarrow = typeof window !== 'undefined' && window.innerWidth < 1400;

  if (!stochasticData || !stochasticData.grid) {
    return (
      <Card>
        <SectionTitle title="No Stochastic Pricing Data"
          subtitle="Run v2_run.py with stochastic pricing enabled to generate this data." />
      </Card>
    );
  }

  const { meta, grid } = stochasticData;
  const upfrontGrid = meta.upfront_grid || [];
  const tailGrid = meta.tail_grid || [];
  const simsPerCombo = meta.sims_per_combo || 0;
  const nCombos = meta.n_combos || Object.keys(grid).length;

  // Initialize sliders to mid-range
  const activeUpfront = selectedUpfront ?? upfrontGrid[Math.floor(upfrontGrid.length / 2)] ?? upfrontGrid[0];
  const activeTail = selectedTail ?? tailGrid[Math.floor(tailGrid.length / 3)] ?? tailGrid[0];

  // Active cell from sliders
  const activeKey = `${activeUpfront}_${activeTail}`;
  const activeCell = grid[activeKey];

  const currentMetric = METRIC_OPTIONS.find(m => m.key === metric) || METRIC_OPTIONS[0];

  // Best cell by MOIC
  const bestKey = useMemo(() =>
    Object.keys(grid).reduce((best, k) => {
      if (!grid[best] || (grid[k] && grid[k].e_moic > grid[best].e_moic)) return k;
      return best;
    }, Object.keys(grid)[0]),
    [grid]
  );
  const bestCell = grid[bestKey] || {};

  // Confidence band data for active tail
  const bandData = useMemo(() => {
    return upfrontGrid.map(up => {
      const key = `${up}_${activeTail}`;
      const cell = grid[key];
      if (!cell) return { pct: `${up}%`, upfront: up };
      return {
        pct: `${up}%`, upfront: up,
        p5: cell.p5_moic, p25: cell.p25_moic, median: cell.p50_moic,
        p75: cell.p75_moic, p95: cell.p95_moic, mean: cell.e_moic,
      };
    });
  }, [upfrontGrid, activeTail, grid]);

  const irrBandData = useMemo(() => {
    return upfrontGrid.map(up => {
      const key = `${up}_${activeTail}`;
      const cell = grid[key];
      if (!cell) return { pct: `${up}%`, upfront: up };
      return {
        pct: `${up}%`, upfront: up,
        p5: cell.p5_irr, p25: cell.p25_irr, median: cell.p50_irr,
        p75: cell.p75_irr, p95: cell.p95_irr, mean: cell.e_irr,
      };
    });
  }, [upfrontGrid, activeTail, grid]);

  // Heatmap rows
  const heatmapRows = useMemo(() => {
    return upfrontGrid.map(up => {
      const row = { upfront: `${up}%`, upVal: up };
      for (const tail of tailGrid) {
        const key = `${up}_${tail}`;
        const cell = grid[key];
        row[`t_${tail}`] = cell ? cell[metric] : null;
        row[`cell_${tail}`] = cell;
      }
      return row;
    });
  }, [upfrontGrid, tailGrid, grid, metric]);

  // Histogram data
  const moicHist = activeCell?.moic_hist;
  const irrHist = activeCell?.irr_hist;

  const moicBins = useMemo(() => {
    if (!moicHist || moicHist.length < 2) return null;
    return moicHist.slice(0, -1).map((b, i) => ({
      bin: `${b.edge.toFixed(2)}×`,
      edge: b.edge,
      count: b.count,
      midpoint: (b.edge + moicHist[i + 1].edge) / 2,
    }));
  }, [moicHist]);

  const irrBins = useMemo(() => {
    if (!irrHist || irrHist.length < 2) return null;
    return irrHist.slice(0, -1).map((b, i) => ({
      bin: fmtPct(b.edge),
      edge: b.edge,
      count: b.count,
      midpoint: (b.edge + irrHist[i + 1].edge) / 2,
    }));
  }, [irrHist]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: ui.space.xl }}>

      {/* ═══════ Section 0: KPIs ═══════ */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: ui.space.md }}>
        <KPI label="Grid Combos" value={nCombos} sub={`${upfrontGrid.length}×${tailGrid.length}`} color={COLORS.accent6} />
        <KPI label="Sims / Combo" value={simsPerCombo.toLocaleString()} color={COLORS.accent3} />
        <KPI label="Best E[MOIC]" value={fmtMOIC(bestCell.e_moic)} sub={`${bestCell.upfront_pct}% up / ${bestCell.tata_tail_pct}% tail`} color={COLORS.accent4} />
        <KPI label="Best E[IRR]" value={fmtPct(bestCell.e_irr)} color={COLORS.accent2} />
        <KPI label="Portfolio SOC" value={`₹${meta.portfolio_soc_cr?.toLocaleString()} Cr`} color={COLORS.accent1} />
      </div>

      {/* ═══════ Section 1: Interactive Sliders + Detail Panel ═══════ */}
      <Card>
        <SectionTitle number="1" title="Interactive Pricing Explorer"
          subtitle="Drag sliders to explore any upfront % / tail % combination." />

        <div style={{ display: 'flex', gap: ui.space.xxl, flexWrap: 'wrap', marginBottom: 24 }}>
          <ParamSlider
            label="Upfront Purchase %"
            value={activeUpfront}
            options={upfrontGrid}
            onChange={setSelectedUpfront}
            color={COLORS.accent1}
          />
          <ParamSlider
            label="Tail %"
            value={activeTail}
            options={tailGrid}
            onChange={setSelectedTail}
            color={COLORS.accent2}
          />
        </div>

        {/* Detail KPIs for active cell */}
        {activeCell && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: ui.space.lg }}>
            {[
              { label: 'E[MOIC]', value: fmtMOIC(activeCell.e_moic), color: moicColor(activeCell.e_moic) === '#065F46' ? COLORS.accent4 : COLORS.accent4, bg: moicColor(activeCell.e_moic) },
              { label: 'E[IRR]', value: fmtPct(activeCell.e_irr), color: COLORS.accent2, bg: irrColor(activeCell.e_irr) },
              { label: 'P(Loss)', value: fmtPct(activeCell.prob_loss), color: COLORS.accent5, bg: lossColor(activeCell.prob_loss) },
              { label: 'P(IRR>30%)', value: fmtPct(activeCell.prob_hurdle), color: COLORS.accent3, bg: hurdleColor(activeCell.prob_hurdle) },
              { label: 'P5 MOIC', value: fmtMOIC(activeCell.p5_moic), color: COLORS.textMuted },
              { label: 'P25 MOIC', value: fmtMOIC(activeCell.p25_moic), color: COLORS.textMuted },
              { label: 'Median MOIC', value: fmtMOIC(activeCell.p50_moic), color: COLORS.accent6 },
              { label: 'P95 MOIC', value: fmtMOIC(activeCell.p95_moic), color: COLORS.textMuted },
            ].map((item, i) => (
              <div key={i} style={{
                textAlign: 'center', padding: 14, borderRadius: 10,
                background: i < 4 ? `${item.bg}` : '#0F1219',
                border: i < 4 ? `1px solid ${item.bg}40` : `1px solid ${COLORS.cardBorder}`,
              }}>
                  <div style={{ color: '#ffffffAA', fontSize: ui.sizes.sm, fontWeight: 600, marginBottom: 4, textTransform: 'uppercase' }}>{item.label}</div>
                <div style={{ color: '#fff', fontSize: ui.sizes.xl, fontWeight: 800 }}>{item.value}</div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* ═══════ Section 2: Histograms ═══════ */}
      {moicBins && (
        <Card>
          <SectionTitle number="2a" title={`MOIC Distribution — ${activeUpfront}% Upfront / ${activeTail}% Tail`}
            subtitle="40-bin histogram of simulated portfolio MOIC outcomes." />
          <ResponsiveContainer width="100%" height={ui.chartHeight.md}>
            <BarChart data={moicBins} margin={{ top: 10, right: 30, left: 10, bottom: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={COLORS.gridLine} vertical={false} />
              <XAxis dataKey="bin" tick={{ fill: COLORS.textMuted, fontSize: ui.sizes.sm }} interval={Math.max(isNarrow ? 2 : 0, Math.floor(moicBins.length / (isNarrow ? 8 : 12)) - 1)}
                label={{ value: 'MOIC', position: 'bottom', fill: COLORS.textMuted, fontSize: ui.sizes.sm }} />
              <YAxis tick={{ fill: COLORS.textMuted, fontSize: ui.sizes.sm }}
                label={{ value: 'Frequency', angle: -90, position: 'insideLeft', fill: COLORS.textMuted, fontSize: ui.sizes.sm }} width={isNarrow ? 44 : 56} />
              <Tooltip cursor={{ fill: 'rgba(6,182,212,0.06)' }} content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const d = payload[0].payload;
                return (
                  <div style={{ background: '#1F2937', border: `1px solid ${COLORS.cardBorder}`, borderRadius: 8, padding: '8px 14px', fontFamily: FONT }}>
                    <div style={{ color: COLORS.textBright, fontSize: ui.sizes.sm, fontWeight: 600 }}>MOIC: {d.edge.toFixed(3)}×</div>
                    <div style={{ color: COLORS.accent1, fontSize: ui.sizes.sm }}>Count: {d.count.toLocaleString()}</div>
                  </div>
                );
              }} />
              {/* Breakeven reference line */}
              <ReferenceLine x={nearestBinLabel(moicBins, 1.0)}
                stroke={COLORS.accent5} strokeDasharray="8 4" strokeWidth={2}
                label={{ value: 'Breakeven', fill: COLORS.accent5, fontSize: 10, position: 'top' }} />
              {/* Mean reference line */}
              {activeCell?.e_moic != null && <ReferenceLine x={nearestBinLabel(moicBins, activeCell.e_moic)}
                stroke={COLORS.accent6} strokeDasharray="6 3" strokeWidth={1.5}
                label={{ value: 'Mean', fill: COLORS.accent6, fontSize: 10, position: 'top' }} />}
              {/* Median reference line */}
              {activeCell?.p50_moic != null && <ReferenceLine x={nearestBinLabel(moicBins, activeCell.p50_moic)}
                stroke={COLORS.accent1} strokeDasharray="4 4" strokeWidth={1.5}
                label={{ value: 'Median', fill: COLORS.accent1, fontSize: 10, position: 'top' }} />}
              {/* IQR P25 reference line */}
              {activeCell?.p25_moic != null && <ReferenceLine x={nearestBinLabel(moicBins, activeCell.p25_moic)}
                stroke={COLORS.accent3} strokeDasharray="3 3" strokeWidth={1}
                label={{ value: 'P25', fill: COLORS.accent3, fontSize: 9, position: 'top' }} />}
              {/* IQR P75 reference line */}
              {activeCell?.p75_moic != null && <ReferenceLine x={nearestBinLabel(moicBins, activeCell.p75_moic)}
                stroke={COLORS.accent3} strokeDasharray="3 3" strokeWidth={1}
                label={{ value: 'P75', fill: COLORS.accent3, fontSize: 9, position: 'top' }} />}
              <Bar dataKey="count" radius={[2, 2, 0, 0]} maxBarSize={20} cursor={BAR_CURSOR}>
                {moicBins.map((entry, idx) => (
                  <Cell key={idx} fill={entry.midpoint >= 1.0 ? COLORS.accent1 : '#EF444490'} fillOpacity={0.85} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          {/* Rich stat legend — matches DistributionExplorer pattern */}
          <div style={{ display: 'flex', justifyContent: 'center', gap: 14, marginTop: 10, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <div style={{ width: 14, height: 14, background: COLORS.accent1, borderRadius: 3 }} />
              <span style={{ color: COLORS.textMuted, fontSize: ui.sizes.sm }}>Profit (≥1.0×)</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <div style={{ width: 14, height: 14, background: '#EF444490', borderRadius: 3 }} />
              <span style={{ color: COLORS.textMuted, fontSize: ui.sizes.sm }}>Loss (&lt;1.0×)</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <div style={{ width: 18, height: 2, background: COLORS.accent6, borderRadius: 1 }} />
              <span style={{ color: COLORS.textMuted, fontSize: ui.sizes.sm }}>Mean: <span style={{ color: COLORS.accent6, fontWeight: 700 }}>{fmtMOIC(activeCell?.e_moic)}</span></span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <div style={{ width: 18, height: 2, background: COLORS.accent1, borderRadius: 1 }} />
              <span style={{ color: COLORS.textMuted, fontSize: ui.sizes.sm }}>Median: <span style={{ color: COLORS.accent1, fontWeight: 700 }}>{fmtMOIC(activeCell?.p50_moic)}</span></span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <div style={{ width: 18, height: 2, background: COLORS.accent3, borderRadius: 1 }} />
              <span style={{ color: COLORS.textMuted, fontSize: ui.sizes.sm }}>IQR: <span style={{ color: COLORS.accent3, fontWeight: 600 }}>{fmtMOIC(activeCell?.p25_moic)} – {fmtMOIC(activeCell?.p75_moic)}</span></span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <div style={{ width: 18, height: 2, background: COLORS.accent5, borderRadius: 1 }} />
              <span style={{ color: COLORS.textMuted, fontSize: ui.sizes.sm }}>Breakeven (1.0×)</span>
            </div>
          </div>
        </Card>
      )}

      {irrBins && (
        <Card>
          <SectionTitle number="2b" title={`IRR Distribution — ${activeUpfront}% Upfront / ${activeTail}% Tail`}
            subtitle="40-bin histogram of annualized IRR outcomes. Vertical dashed line marks the 30% hurdle rate." />
          <ResponsiveContainer width="100%" height={ui.chartHeight.md}>
            <BarChart data={irrBins} margin={{ top: 10, right: 30, left: 10, bottom: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={COLORS.gridLine} vertical={false} />
              <XAxis dataKey="bin" tick={{ fill: COLORS.textMuted, fontSize: ui.sizes.sm }} interval={Math.max(isNarrow ? 2 : 0, Math.floor(irrBins.length / (isNarrow ? 8 : 12)) - 1)}
                label={{ value: 'IRR (annualized)', position: 'bottom', fill: COLORS.textMuted, fontSize: ui.sizes.sm }} />
              <YAxis tick={{ fill: COLORS.textMuted, fontSize: ui.sizes.sm }}
                label={{ value: 'Frequency', angle: -90, position: 'insideLeft', fill: COLORS.textMuted, fontSize: ui.sizes.sm }} width={isNarrow ? 44 : 56} />
              <Tooltip cursor={{ fill: 'rgba(6,182,212,0.06)' }} content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const d = payload[0].payload;
                return (
                  <div style={{ background: '#1F2937', border: `1px solid ${COLORS.cardBorder}`, borderRadius: 8, padding: '8px 14px', fontFamily: FONT }}>
                    <div style={{ color: COLORS.textBright, fontSize: ui.sizes.sm, fontWeight: 600 }}>IRR: {fmtPct(d.edge)}</div>
                    <div style={{ color: COLORS.accent2, fontSize: ui.sizes.sm }}>Count: {d.count.toLocaleString()}</div>
                  </div>
                );
              }} />
              {/* 30% hurdle reference line */}
              <ReferenceLine x={nearestBinLabel(irrBins, 0.30)}
                stroke={COLORS.accent5} strokeDasharray="8 4" strokeWidth={2}
                label={{ value: '30% Hurdle', fill: COLORS.accent5, fontSize: 10, position: 'top' }} />
              {/* Breakeven (0% IRR) reference line */}
              <ReferenceLine x={nearestBinLabel(irrBins, 0.0)}
                stroke={COLORS.accent4} strokeDasharray="8 4" strokeWidth={1.5}
                label={{ value: '0% BE', fill: COLORS.accent4, fontSize: 9, position: 'top' }} />
              {/* Mean reference line */}
              {activeCell?.e_irr != null && <ReferenceLine x={nearestBinLabel(irrBins, activeCell.e_irr)}
                stroke={COLORS.accent6} strokeDasharray="6 3" strokeWidth={1.5}
                label={{ value: 'Mean', fill: COLORS.accent6, fontSize: 10, position: 'top' }} />}
              {/* Median reference line */}
              {activeCell?.p50_irr != null && <ReferenceLine x={nearestBinLabel(irrBins, activeCell.p50_irr)}
                stroke={COLORS.accent1} strokeDasharray="4 4" strokeWidth={1.5}
                label={{ value: 'Median', fill: COLORS.accent1, fontSize: 10, position: 'top' }} />}
              {/* IQR P25 reference line */}
              {activeCell?.p25_irr != null && <ReferenceLine x={nearestBinLabel(irrBins, activeCell.p25_irr)}
                stroke={COLORS.accent3} strokeDasharray="3 3" strokeWidth={1}
                label={{ value: 'P25', fill: COLORS.accent3, fontSize: 9, position: 'top' }} />}
              {/* IQR P75 reference line */}
              {activeCell?.p75_irr != null && <ReferenceLine x={nearestBinLabel(irrBins, activeCell.p75_irr)}
                stroke={COLORS.accent3} strokeDasharray="3 3" strokeWidth={1}
                label={{ value: 'P75', fill: COLORS.accent3, fontSize: 9, position: 'top' }} />}
              <Bar dataKey="count" radius={[2, 2, 0, 0]} maxBarSize={20} cursor={BAR_CURSOR}>
                {irrBins.map((entry, idx) => (
                  <Cell key={idx} fill={entry.midpoint >= 0.30 ? COLORS.accent2 : '#F59E0B80'} fillOpacity={0.85} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          {/* Rich stat legend — matches DistributionExplorer pattern */}
          <div style={{ display: 'flex', justifyContent: 'center', gap: 14, marginTop: 10, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <div style={{ width: 14, height: 14, background: COLORS.accent2, borderRadius: 3 }} />
              <span style={{ color: COLORS.textMuted, fontSize: ui.sizes.sm }}>Above hurdle (≥30%)</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <div style={{ width: 14, height: 14, background: '#F59E0B80', borderRadius: 3 }} />
              <span style={{ color: COLORS.textMuted, fontSize: ui.sizes.sm }}>Below hurdle (&lt;30%)</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <div style={{ width: 18, height: 2, background: COLORS.accent6, borderRadius: 1 }} />
              <span style={{ color: COLORS.textMuted, fontSize: ui.sizes.sm }}>Mean: <span style={{ color: COLORS.accent6, fontWeight: 700 }}>{fmtPct(activeCell?.e_irr)}</span></span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <div style={{ width: 18, height: 2, background: COLORS.accent1, borderRadius: 1 }} />
              <span style={{ color: COLORS.textMuted, fontSize: ui.sizes.sm }}>Median: <span style={{ color: COLORS.accent1, fontWeight: 700 }}>{fmtPct(activeCell?.p50_irr)}</span></span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <div style={{ width: 18, height: 2, background: COLORS.accent3, borderRadius: 1 }} />
              <span style={{ color: COLORS.textMuted, fontSize: ui.sizes.sm }}>IQR: <span style={{ color: COLORS.accent3, fontWeight: 600 }}>{fmtPct(activeCell?.p25_irr)} – {fmtPct(activeCell?.p75_irr)}</span></span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <div style={{ width: 18, height: 2, background: COLORS.accent5, borderRadius: 1 }} />
              <span style={{ color: COLORS.textMuted, fontSize: ui.sizes.sm }}>30% Hurdle</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <div style={{ width: 18, height: 2, background: COLORS.accent4, borderRadius: 1 }} />
              <span style={{ color: COLORS.textMuted, fontSize: ui.sizes.sm }}>Breakeven (0%)</span>
            </div>
          </div>
        </Card>
      )}

      {/* ═══════ Section 3: MOIC Confidence Bands ═══════ */}
      <Card>
        <SectionTitle number="3" title={`MOIC Confidence Bands — Tail ${activeTail}%`}
          subtitle="Shaded: P5–P95 (outer) and P25–P75 (inner). Line: median. Dot: mean." />
        <ResponsiveContainer width="100%" height={ui.chartHeight.lg}>
          <ComposedChart data={bandData} margin={{ top: 10, right: 30, left: 10, bottom: 20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={COLORS.gridLine} />
            <XAxis dataKey="pct" tick={{ fill: COLORS.textMuted, fontSize: ui.sizes.sm }} interval={isNarrow ? 1 : 0} label={{ value: 'Upfront %', position: 'bottom', fill: COLORS.textMuted, fontSize: ui.sizes.sm }} />
            <YAxis tick={{ fill: COLORS.textMuted, fontSize: ui.sizes.sm }} tickFormatter={v => v + '×'} width={isNarrow ? 44 : 56} />
            <Tooltip cursor={{ fill: 'rgba(6,182,212,0.06)' }} content={<CustomTooltip />} />
            <ReferenceLine y={1} stroke={COLORS.breakeven} strokeDasharray="8 4" strokeWidth={2} />
            <Area type="monotone" dataKey="p95" stroke="none" fill={COLORS.accent1} fillOpacity={0.10} name="P95" />
            <Area type="monotone" dataKey="p5" stroke="none" fill={COLORS.bg} fillOpacity={1} name="P5" />
            <Area type="monotone" dataKey="p75" stroke="none" fill={COLORS.accent1} fillOpacity={0.20} name="P75" />
            <Area type="monotone" dataKey="p25" stroke="none" fill={COLORS.bg} fillOpacity={1} name="P25" />
            <Line type="monotone" dataKey="median" stroke={COLORS.accent2} strokeWidth={3} dot={false} name="Median" />
            <Line type="monotone" dataKey="mean" stroke={COLORS.accent4} strokeWidth={2} strokeDasharray="6 3" dot={{ fill: COLORS.accent4, r: 4, stroke: COLORS.bg, strokeWidth: 2 }} name="Mean" />
          </ComposedChart>
        </ResponsiveContainer>
        <div style={{ display: 'flex', justifyContent: 'center', gap: ui.space.xl, marginTop: 12 }}>
          {[
            { style: { width: 20, height: 10, background: COLORS.accent1, opacity: 0.1, borderRadius: 2 }, label: 'P5–P95' },
            { style: { width: 20, height: 10, background: COLORS.accent1, opacity: 0.2, borderRadius: 2 }, label: 'P25–P75' },
            { style: { width: 20, height: 3, background: COLORS.accent2, borderRadius: 2 }, label: 'Median' },
            { style: { width: 20, height: 3, background: COLORS.accent4, borderRadius: 2 }, label: 'Mean' },
          ].map(({ style, label }, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={style} />
              <span style={{ color: COLORS.textMuted, fontSize: ui.sizes.sm }}>{label}</span>
            </div>
          ))}
        </div>
      </Card>

      {/* ═══════ Section 4: IRR Confidence Bands ═══════ */}
      <Card>
        <SectionTitle number="4" title={`IRR Confidence Bands — Tail ${activeTail}%`}
          subtitle="Annual IRR distribution percentiles across upfront purchase levels." />
        <ResponsiveContainer width="100%" height={ui.chartHeight.lg}>
          <ComposedChart data={irrBandData} margin={{ top: 10, right: 30, left: 10, bottom: 20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={COLORS.gridLine} />
            <XAxis dataKey="pct" tick={{ fill: COLORS.textMuted, fontSize: ui.sizes.sm }} interval={isNarrow ? 1 : 0} label={{ value: 'Upfront %', position: 'bottom', fill: COLORS.textMuted, fontSize: ui.sizes.sm }} />
            <YAxis tick={{ fill: COLORS.textMuted, fontSize: ui.sizes.sm }} tickFormatter={v => fmtPct(v)} width={isNarrow ? 44 : 56} />
            <Tooltip cursor={{ fill: 'rgba(6,182,212,0.06)' }} content={<CustomTooltip />} />
            <ReferenceLine y={0.30} stroke={COLORS.accent3} strokeDasharray="8 4" strokeWidth={1.5} label={{ value: '30% hurdle', fill: COLORS.accent3, fontSize: ui.sizes.sm }} />
            <Area type="monotone" dataKey="p95" stroke="none" fill={COLORS.accent2} fillOpacity={0.10} name="P95 IRR" />
            <Area type="monotone" dataKey="p5" stroke="none" fill={COLORS.bg} fillOpacity={1} name="P5 IRR" />
            <Area type="monotone" dataKey="p75" stroke="none" fill={COLORS.accent2} fillOpacity={0.20} name="P75 IRR" />
            <Area type="monotone" dataKey="p25" stroke="none" fill={COLORS.bg} fillOpacity={1} name="P25 IRR" />
            <Line type="monotone" dataKey="median" stroke={COLORS.accent2} strokeWidth={3} dot={false} name="Median IRR" />
            <Line type="monotone" dataKey="mean" stroke={COLORS.accent4} strokeWidth={2} strokeDasharray="6 3" dot={{ fill: COLORS.accent4, r: 4, stroke: COLORS.bg, strokeWidth: 2 }} name="Mean IRR" />
          </ComposedChart>
        </ResponsiveContainer>
      </Card>

      {/* ═══════ Section 5: Metric Selector + Heatmap ═══════ */}
      <div style={{ display: 'flex', alignItems: 'center', gap: ui.space.md, flexWrap: 'wrap' }}>
        <span style={{ color: COLORS.textMuted, fontSize: ui.sizes.sm, fontWeight: 600 }}>Heatmap Metric:</span>
        {METRIC_OPTIONS.map(m => (
          <button key={m.key} onClick={() => setMetric(m.key)} style={{
            padding: '8px 16px', borderRadius: 8, border: 'none', cursor: 'pointer',
            fontFamily: FONT, fontSize: ui.sizes.sm, fontWeight: 600,
            color: metric === m.key ? '#fff' : COLORS.textMuted,
            background: metric === m.key ? COLORS.gradient1 : COLORS.card,
            transition: 'all 0.2s',
          }}>
            {m.label}
          </button>
        ))}
      </div>

      <Card>
        <SectionTitle number="5" title={`${currentMetric.label} Heatmap — Full Pricing Grid`}
          subtitle={`Rows = upfront %, Columns = Tail %. ${simsPerCombo.toLocaleString()} MC paths per cell. Click to select.`} />
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 3, fontFamily: FONT }}>
            <thead>
              <tr>
                <th style={{ padding: '10px 14px', color: COLORS.textMuted, fontSize: ui.sizes.sm, fontWeight: 600, textAlign: 'left' }}>Upfront ↓ / Tail →</th>
                {tailGrid.map(t => (
                  <th key={t} style={{
                    padding: '10px 14px', color: t === activeTail ? COLORS.accent2 : COLORS.textMuted,
                    fontSize: ui.sizes.sm, fontWeight: t === activeTail ? 800 : 600, textAlign: 'center',
                    borderBottom: t === activeTail ? `2px solid ${COLORS.accent2}` : 'none',
                  }}>
                    {t}%
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {heatmapRows.map((row, ri) => {
                const isActiveRow = row.upVal === activeUpfront;
                return (
                  <tr key={ri}>
                    <td style={{
                      padding: '10px 14px', fontSize: ui.sizes.sm, fontWeight: isActiveRow ? 800 : 600,
                      color: isActiveRow ? COLORS.accent1 : COLORS.textBright,
                    }}>{row.upfront}</td>
                    {tailGrid.map(t => {
                      const val = row[`t_${t}`];
                      const cell = row[`cell_${t}`];
                      const isActive = row.upVal === activeUpfront && t === activeTail;
                      return (
                        <td key={t}
                          onClick={() => {
                            if (cell) {
                              setSelectedUpfront(cell.upfront_pct);
                              setSelectedTail(cell.tata_tail_pct);
                            }
                          }}
                          style={{
                            padding: '10px 14px', textAlign: 'center', borderRadius: 6,
                            background: val != null ? currentMetric.colorFn(val) : '#1F2937',
                            color: COLORS.textBright, fontSize: SIZES.base, fontWeight: 700,
                            cursor: cell ? 'pointer' : 'default',
                            outline: isActive ? `3px solid ${COLORS.accent1}` : 'none',
                            outlineOffset: isActive ? -2 : 0,
                            boxShadow: isActive ? `0 0 12px ${COLORS.accent1}40` : 'none',
                          }}>
                          {val != null ? currentMetric.fmt(val) : '—'}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {/* ═══════ Section 6: P(Loss) Surface ═══════ */}
      <Card>
        <SectionTitle number="6" title="P(Loss) Surface"
          subtitle="How loss probability changes across the upfront-tail grid. Lower is better." />
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 3, fontFamily: FONT }}>
            <thead>
              <tr>
                <th style={{ padding: '10px 14px', color: COLORS.textMuted, fontSize: ui.sizes.sm, fontWeight: 600, textAlign: 'left' }}>Upfront ↓ / Tail →</th>
                {tailGrid.map(t => (
                  <th key={t} style={{ padding: '10px 14px', color: COLORS.textMuted, fontSize: ui.sizes.sm, fontWeight: 600, textAlign: 'center' }}>{t}%</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {upfrontGrid.map((up, ri) => (
                <tr key={ri}>
                  <td style={{ padding: '10px 14px', color: COLORS.textBright, fontSize: ui.sizes.sm, fontWeight: 600 }}>{up}%</td>
                  {tailGrid.map(t => {
                    const key = `${up}_${t}`;
                    const cell = grid[key];
                    const pLoss = cell?.prob_loss ?? null;
                    return (
                      <td key={t} style={{
                        padding: '10px 14px', textAlign: 'center', borderRadius: 6,
                        background: pLoss != null ? lossColor(pLoss) : '#1F2937',
                        color: COLORS.textBright, fontSize: SIZES.base, fontWeight: 700,
                      }}>
                        {pLoss != null ? fmtPct(pLoss) : '—'}
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
