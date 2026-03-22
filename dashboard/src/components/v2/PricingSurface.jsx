/**
 * PricingSurface.jsx — Continuous Upfront × Tail Pricing Surface
 * ================================================================
 *
 * Visualises a fine-grained grid of (upfront %, tail %) combinations
 * produced by v2_pricing_surface.py.  Three visualisation modes:
 *   1. Enhanced Heatmap with contour-iso lines
 *   2. 2-D Contour Plot (Plotly)
 *   3. 3-D Surface Plot (Plotly)
 *
 * Sliders give a continuous feel; KPI panel shows interpolated metrics;
 * histograms snap to the nearest pre-computed grid point.
 */

import React, { useState, useMemo, useCallback } from 'react';
import {
  COLORS, FONT, BAR_CURSOR,
  useUISettings, fmtPct, fmtMOIC,
  moicColor, irrColor, lossColor, hurdleColor,
} from '../theme';
import { Card, SectionTitle, KPI } from './Shared';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, ReferenceLine,
} from 'recharts';
import createPlotlyComponent from 'react-plotly.js/factory';
import Plotly from 'plotly.js-dist-min';

const Plot = createPlotlyComponent(Plotly);


/* ═══════════════════════════════════════════════════════════
 * Helpers
 * ═══════════════════════════════════════════════════════════ */

/** Bilinear interpolation on a 2-D surface array */
function bilinearInterpolate(surface, upfrontGrid, tailGrid, upfrontVal, tailVal) {
  if (!surface || !surface.length) return null;
  // Clamp to grid bounds
  const uMin = upfrontGrid[0], uMax = upfrontGrid[upfrontGrid.length - 1];
  const tMin = tailGrid[0], tMax = tailGrid[tailGrid.length - 1];
  const u = Math.max(uMin, Math.min(uMax, upfrontVal));
  const t = Math.max(tMin, Math.min(tMax, tailVal));

  // Find surrounding indices
  let i0 = 0;
  for (let i = 0; i < upfrontGrid.length - 1; i++) {
    if (upfrontGrid[i] <= u && upfrontGrid[i + 1] >= u) { i0 = i; break; }
    if (i === upfrontGrid.length - 2) i0 = i;
  }
  let j0 = 0;
  for (let j = 0; j < tailGrid.length - 1; j++) {
    if (tailGrid[j] <= t && tailGrid[j + 1] >= t) { j0 = j; break; }
    if (j === tailGrid.length - 2) j0 = j;
  }
  const i1 = Math.min(i0 + 1, upfrontGrid.length - 1);
  const j1 = Math.min(j0 + 1, tailGrid.length - 1);

  const uRange = upfrontGrid[i1] - upfrontGrid[i0] || 1;
  const tRange = tailGrid[j1] - tailGrid[j0] || 1;
  const uFrac = (u - upfrontGrid[i0]) / uRange;
  const tFrac = (t - tailGrid[j0]) / tRange;

  const v00 = surface[i0][j0];
  const v10 = surface[i1][j0];
  const v01 = surface[i0][j1];
  const v11 = surface[i1][j1];

  return v00 * (1 - uFrac) * (1 - tFrac)
       + v10 * uFrac * (1 - tFrac)
       + v01 * (1 - uFrac) * tFrac
       + v11 * uFrac * tFrac;
}

/** Snap to nearest grid key */
function nearestGridKey(upfrontGrid, tailGrid, upfrontVal, tailVal) {
  const nearU = upfrontGrid.reduce((a, b) => Math.abs(b - upfrontVal) < Math.abs(a - upfrontVal) ? b : a);
  const nearT = tailGrid.reduce((a, b) => Math.abs(b - tailVal) < Math.abs(a - tailVal) ? b : a);
  const fmtN = v => v % 1 === 0 ? String(Math.round(v)) : String(v);
  return `${fmtN(nearU)}_${fmtN(nearT)}`;
}

/** Prepare histogram bins for BarChart */
function prepHistBins(hist) {
  if (!hist || hist.length < 2) return null;
  return hist.slice(0, -1).map((b, i) => ({
    edge: b.edge,
    count: b.count,
    bin: b.edge.toFixed(3),
    midpoint: (b.edge + (hist[i + 1]?.edge ?? b.edge)) / 2,
  }));
}

/** Find the bin label nearest to a value */
function nearestBinLabel(bins, value) {
  if (!bins || !bins.length) return null;
  let best = bins[0].bin;
  let bestDist = Math.abs(bins[0].edge - value);
  for (const b of bins) {
    const d = Math.abs(b.edge - value);
    if (d < bestDist) { bestDist = d; best = b.bin; }
  }
  return best;
}

/** Colour scale for surface metric value (normalised 0-1 → green-red) */
function surfaceColorRGB(value, min, max) {
  const t = max > min ? (value - min) / (max - min) : 0.5;
  // RdYlGn: red → yellow → green
  const r = t < 0.5 ? 239 : Math.round(239 - (t - 0.5) * 2 * (239 - 16));
  const g = t < 0.5 ? Math.round(68 + t * 2 * (158 - 68)) : Math.round(158 + (t - 0.5) * 2 * (185 - 158));
  const b = t < 0.5 ? Math.round(68 - t * 2 * 68) : Math.round((t - 0.5) * 2 * 129);
  return `rgb(${r},${g},${b})`;
}

/* ═══════════════════════════════════════════════════════════
 * Metric definitions
 * ═══════════════════════════════════════════════════════════ */

const METRIC_OPTIONS = [
  { key: 'e_irr', label: 'E[IRR]', fmt: v => fmtPct(v), isPercent: true },
  { key: 'e_moic', label: 'E[MOIC]', fmt: v => fmtMOIC(v), isPercent: false },
  { key: 'p50_irr', label: 'Median IRR', fmt: v => fmtPct(v), isPercent: true },
  { key: 'p50_moic', label: 'Median MOIC', fmt: v => fmtMOIC(v), isPercent: false },
  { key: 'p5_irr', label: 'IRR VaR(5%)', fmt: v => fmtPct(v), isPercent: true },
  { key: 'p5_moic', label: 'MOIC VaR(5%)', fmt: v => fmtMOIC(v), isPercent: false },
  { key: 'irr_cvar_5', label: 'IRR CVaR(5%)', fmt: v => fmtPct(v), isPercent: true },
  { key: 'prob_loss', label: 'P(Loss)', fmt: v => fmtPct(v), isPercent: true },
  { key: 'prob_hurdle', label: 'P(IRR>30%)', fmt: v => fmtPct(v), isPercent: true },
  { key: 'p95_irr', label: 'P95 IRR', fmt: v => fmtPct(v), isPercent: true },
  { key: 'p95_moic', label: 'P95 MOIC', fmt: v => fmtMOIC(v), isPercent: false },
];


/* ═══════════════════════════════════════════════════════════
 * Main Component
 * ═══════════════════════════════════════════════════════════ */

export default function PricingSurface({ data }) {
  const { ui } = useUISettings();

  // ─── Guard: no data ───────────────────────────────────────
  if (!data || !data.meta || !data.surfaces || !data.grid) {
    return (
      <Card>
        <SectionTitle number="" title="Pricing Surface" subtitle="No pricing surface data available." />
        <p style={{ color: COLORS.textMuted, fontSize: ui.sizes.md, lineHeight: 1.6 }}>
          Generate the pricing surface data by running:
        </p>
        <pre style={{
          background: '#1F2937', padding: 16, borderRadius: 8, color: COLORS.accent1,
          fontFamily: 'monospace', fontSize: ui.sizes.sm, overflowX: 'auto', marginTop: 8,
        }}>
{`cd TATAProjects_Code
py -m TATA_code_v2.v2_pricing_surface --n 10000 --seed 42 \\
   --upfront-min 5 --upfront-max 35 --tail-min 0 --tail-max 40`}
        </pre>
        <p style={{ color: COLORS.textMuted, fontSize: ui.sizes.sm, marginTop: 12 }}>
          This generates <code style={{ color: COLORS.accent1 }}>outputs/pricing_surface.json</code> which this tab consumes.
        </p>
      </Card>
    );
  }

  // ─── Data extraction ──────────────────────────────────────
  const { meta, surfaces, grid } = data;
  const upfrontGrid = meta.upfront_grid;
  const tailGrid = meta.tail_grid;

  // ─── State ────────────────────────────────────────────────
  const [vizMode, setVizMode] = useState('heatmap'); // heatmap | contour | surface3d
  const [surfaceMetric, setSurfaceMetric] = useState('e_irr');
  const [selectedUpfront, setSelectedUpfront] = useState(
    upfrontGrid[Math.floor(upfrontGrid.length / 2)]
  );
  const [selectedTail, setSelectedTail] = useState(
    tailGrid[Math.floor(tailGrid.length / 2)]
  );

  const metricDef = METRIC_OPTIONS.find(m => m.key === surfaceMetric) || METRIC_OPTIONS[0];
  const surfaceArr = surfaces[surfaceMetric];

  // Grid cell at nearest grid point (for histograms & exact stats)
  const gridKey = nearestGridKey(upfrontGrid, tailGrid, selectedUpfront, selectedTail);
  const activeCell = grid[gridKey] || null;

  // Interpolated KPI values
  const interpMetrics = useMemo(() => {
    const out = {};
    for (const m of METRIC_OPTIONS) {
      if (surfaces[m.key]) {
        out[m.key] = bilinearInterpolate(surfaces[m.key], upfrontGrid, tailGrid, selectedUpfront, selectedTail);
      }
    }
    return out;
  }, [surfaces, upfrontGrid, tailGrid, selectedUpfront, selectedTail]);

  // Histogram bins
  const irrBins = useMemo(() => prepHistBins(activeCell?.irr_hist), [activeCell]);
  const moicBins = useMemo(() => prepHistBins(activeCell?.moic_hist), [activeCell]);

  // Surface min/max for colour scaling
  const surfaceRange = useMemo(() => {
    if (!surfaceArr) return { min: 0, max: 1 };
    let min = Infinity, max = -Infinity;
    for (const row of surfaceArr) {
      for (const v of row) {
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }
    return { min, max };
  }, [surfaceArr]);

  // ─── Plotly data for 3D & Contour ────────────────────────
  const plotlyContourData = useMemo(() => {
    if (!surfaceArr) return null;
    const zData = surfaceArr;  // [upfront_idx][tail_idx]
    const scale = metricDef.isPercent ? 100 : 1;
    return [{
      type: 'contour',
      x: tailGrid,
      y: upfrontGrid,
      z: zData.map(row => row.map(v => v * scale)),
      colorscale: 'RdYlGn',
      contours: { showlabels: true, labelfont: { size: 11, color: '#fff' } },
      colorbar: { title: metricDef.label, titlefont: { color: '#ccc' }, tickfont: { color: '#aaa' } },
      hovertemplate: `Tail: %{x:.1f}%<br>Upfront: %{y:.1f}%<br>${metricDef.label}: %{z:.2f}${metricDef.isPercent ? '%' : '×'}<extra></extra>`,
    }, {
      type: 'scatter',
      x: [selectedTail],
      y: [selectedUpfront],
      mode: 'markers',
      marker: { size: 14, color: '#fff', symbol: 'x', line: { width: 2, color: '#000' } },
      name: 'Selected',
      showlegend: false,
      hoverinfo: 'skip',
    }];
  }, [surfaceArr, tailGrid, upfrontGrid, selectedTail, selectedUpfront, metricDef]);

  const plotly3DData = useMemo(() => {
    if (!surfaceArr) return null;
    const scale = metricDef.isPercent ? 100 : 1;
    return [{
      type: 'surface',
      x: tailGrid,
      y: upfrontGrid,
      z: surfaceArr.map(row => row.map(v => v * scale)),
      colorscale: 'RdYlGn',
      colorbar: { title: metricDef.label, titlefont: { color: '#ccc' }, tickfont: { color: '#aaa' } },
      hovertemplate: `Tail: %{x:.1f}%<br>Upfront: %{y:.1f}%<br>${metricDef.label}: %{z:.2f}${metricDef.isPercent ? '%' : '×'}<extra></extra>`,
    }, {
      type: 'scatter3d',
      x: [selectedTail],
      y: [selectedUpfront],
      z: [interpMetrics[surfaceMetric] != null ? interpMetrics[surfaceMetric] * scale : 0],
      mode: 'markers',
      marker: { size: 6, color: '#fff', symbol: 'diamond', line: { width: 1, color: '#000' } },
      name: 'Selected',
      showlegend: false,
      hoverinfo: 'skip',
    }];
  }, [surfaceArr, tailGrid, upfrontGrid, selectedTail, selectedUpfront, interpMetrics, surfaceMetric, metricDef]);

  const plotlyLayout = useMemo(() => ({
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(11,14,23,0.9)',
    font: { family: FONT, color: '#ccc' },
    margin: { l: 60, r: 30, t: 40, b: 60 },
    xaxis: { title: 'Tail %', gridcolor: '#1E293B', color: '#aaa' },
    yaxis: { title: 'Upfront %', gridcolor: '#1E293B', color: '#aaa' },
    height: 480,
  }), []);

  const plotly3DLayout = useMemo(() => ({
    paper_bgcolor: 'rgba(0,0,0,0)',
    font: { family: FONT, color: '#ccc' },
    margin: { l: 10, r: 10, t: 30, b: 10 },
    scene: {
      xaxis: { title: 'Tail %', gridcolor: '#1E293B', color: '#aaa', backgroundcolor: '#0B0E17' },
      yaxis: { title: 'Upfront %', gridcolor: '#1E293B', color: '#aaa', backgroundcolor: '#0B0E17' },
      zaxis: { title: metricDef.label, gridcolor: '#1E293B', color: '#aaa', backgroundcolor: '#0B0E17' },
      bgcolor: '#0B0E17',
    },
    height: 520,
  }), [metricDef]);

  const plotlyConfig = { responsive: true, displayModeBar: true, displaylogo: false };

  // ─── Handlers ─────────────────────────────────────────────
  const handleHeatmapClick = useCallback((u, t) => {
    setSelectedUpfront(u);
    setSelectedTail(t);
  }, []);

  // ─── Render ───────────────────────────────────────────────
  return (
    <div>
      {/* ── KPI banner ── */}
      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', alignItems: 'center', marginBottom: ui.space.md }}>
          <div>
            <h2 style={{ margin: 0, fontSize: ui.sizes.xl, fontWeight: 800, color: COLORS.textBright }}>
              Pricing Surface Explorer
            </h2>
            <p style={{ margin: '4px 0 0', color: COLORS.textMuted, fontSize: ui.sizes.sm }}>
              {meta.portfolio_label} — {meta.n_combos.toLocaleString()} grid points × {meta.sims_per_combo.toLocaleString()} MC paths — Step: {meta.step}%
            </p>
          </div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {[
              { l: 'Grid', v: `${upfrontGrid.length}×${tailGrid.length}`, c: COLORS.accent1 },
              { l: 'Portfolio SOC', v: `₹${meta.portfolio_soc_cr?.toLocaleString('en-IN')} Cr`, c: COLORS.accent6 },
              { l: 'MC Paths', v: meta.sims_per_combo?.toLocaleString(), c: COLORS.accent2 },
            ].map((k, i) => (
              <div key={i} style={{ padding: '6px 14px', borderRadius: 8, background: '#1F293780', border: `1px solid ${COLORS.cardBorder}`, textAlign: 'center' }}>
                <div style={{ color: COLORS.textMuted, fontSize: 11, fontWeight: 600, textTransform: 'uppercase' }}>{k.l}</div>
                <div style={{ color: k.c, fontSize: ui.sizes.md, fontWeight: 700 }}>{k.v}</div>
              </div>
            ))}
          </div>
        </div>
      </Card>

      {/* ── Controls: Sliders + Viz toggle + Metric selector ── */}
      <Card>
        <SectionTitle number="1" title="Controls" subtitle="Adjust upfront % and tail % to explore any combination. Toggle visualisation mode." />

        {/* Sliders */}
        <div style={{ display: 'flex', gap: ui.space.xxl, flexWrap: 'wrap', marginBottom: ui.space.lg }}>
          {/* Upfront slider */}
          <div style={{ flex: 1, minWidth: 260 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ color: COLORS.textMuted, fontSize: ui.sizes.sm, fontWeight: 600 }}>Upfront %</span>
              <span style={{ color: COLORS.accent1, fontSize: ui.sizes.lg, fontWeight: 800 }}>{selectedUpfront.toFixed(1)}%</span>
            </div>
            <input
              type="range"
              min={upfrontGrid[0]}
              max={upfrontGrid[upfrontGrid.length - 1]}
              step={meta.step}
              value={selectedUpfront}
              onChange={e => setSelectedUpfront(parseFloat(e.target.value))}
              style={{ width: '100%', accentColor: COLORS.accent1, height: 6 }}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', color: COLORS.textMuted, fontSize: 11 }}>
              <span>{upfrontGrid[0]}%</span><span>{upfrontGrid[upfrontGrid.length - 1]}%</span>
            </div>
          </div>

          {/* Tail slider */}
          <div style={{ flex: 1, minWidth: 260 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ color: COLORS.textMuted, fontSize: ui.sizes.sm, fontWeight: 600 }}>Tata Tail %</span>
              <span style={{ color: COLORS.accent2, fontSize: ui.sizes.lg, fontWeight: 800 }}>{selectedTail.toFixed(1)}%</span>
            </div>
            <input
              type="range"
              min={tailGrid[0]}
              max={tailGrid[tailGrid.length - 1]}
              step={meta.step}
              value={selectedTail}
              onChange={e => setSelectedTail(parseFloat(e.target.value))}
              style={{ width: '100%', accentColor: COLORS.accent2, height: 6 }}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', color: COLORS.textMuted, fontSize: 11 }}>
              <span>{tailGrid[0]}%</span><span>{tailGrid[tailGrid.length - 1]}%</span>
            </div>
          </div>
        </div>

        {/* Viz mode + metric selector */}
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ color: COLORS.textMuted, fontSize: ui.sizes.sm, fontWeight: 600 }}>View:</span>
          {[
            { id: 'heatmap', label: 'Heatmap' },
            { id: 'contour', label: 'Contour' },
            { id: 'surface3d', label: '3D Surface' },
          ].map(m => (
            <button key={m.id} onClick={() => setVizMode(m.id)} style={{
              padding: '6px 14px', borderRadius: 6, border: 'none', cursor: 'pointer', fontFamily: FONT,
              fontSize: ui.sizes.sm, fontWeight: vizMode === m.id ? 700 : 500,
              color: vizMode === m.id ? '#fff' : COLORS.textMuted,
              background: vizMode === m.id ? COLORS.accent1 : COLORS.card,
            }}>{m.label}</button>
          ))}

          <span style={{ color: COLORS.textMuted, fontSize: ui.sizes.sm, fontWeight: 600, marginLeft: 16 }}>Metric:</span>
          <select
            value={surfaceMetric}
            onChange={e => setSurfaceMetric(e.target.value)}
            style={{
              padding: '6px 10px', borderRadius: 6, border: `1px solid ${COLORS.cardBorder}`,
              background: COLORS.card, color: COLORS.textBright, fontFamily: FONT, fontSize: ui.sizes.sm,
              cursor: 'pointer',
            }}
          >
            {METRIC_OPTIONS.map(m => <option key={m.key} value={m.key}>{m.label}</option>)}
          </select>
        </div>
      </Card>

      {/* ── Main visual + KPI panel ── */}
      <div style={{ display: 'flex', gap: ui.space.lg, flexWrap: 'wrap' }}>
        {/* Visualisation (left ~70%) */}
        <Card style={{ flex: 3, minWidth: 500 }}>
          <SectionTitle number="2"
            title={`${metricDef.label} Surface — ${vizMode === 'heatmap' ? 'Enhanced Heatmap' : vizMode === 'contour' ? 'Contour Plot' : '3D Surface'}`}
            subtitle={`Upfront ${upfrontGrid[0]}–${upfrontGrid[upfrontGrid.length - 1]}% × Tail ${tailGrid[0]}–${tailGrid[tailGrid.length - 1]}%`}
          />

          {vizMode === 'heatmap' && surfaceArr && (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ borderCollapse: 'separate', borderSpacing: 1, width: '100%', fontSize: 11 }}>
                <thead>
                  <tr>
                    <th style={{ padding: '6px 4px', color: COLORS.textMuted, fontWeight: 700, fontSize: 11, position: 'sticky', left: 0, background: COLORS.card, zIndex: 2 }}>
                      Up\Tail
                    </th>
                    {tailGrid.map(t => (
                      <th key={t} style={{ padding: '4px 2px', color: COLORS.textMuted, fontWeight: 600, fontSize: 10, minWidth: 32, textAlign: 'center' }}>
                        {t}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {upfrontGrid.map((u, i) => (
                    <tr key={u}>
                      <td style={{ padding: '4px 6px', color: COLORS.accent1, fontWeight: 700, fontSize: 11, position: 'sticky', left: 0, background: COLORS.card, zIndex: 1 }}>
                        {u}%
                      </td>
                      {tailGrid.map((t, j) => {
                        const val = surfaceArr[i][j];
                        const isSelected = Math.abs(u - selectedUpfront) < meta.step / 2 && Math.abs(t - selectedTail) < meta.step / 2;
                        const bgColor = surfaceColorRGB(val, surfaceRange.min, surfaceRange.max);
                        return (
                          <td
                            key={t}
                            onClick={() => handleHeatmapClick(u, t)}
                            style={{
                              padding: '3px 1px', textAlign: 'center', cursor: 'pointer',
                              background: bgColor,
                              border: isSelected ? '2px solid #fff' : '1px solid transparent',
                              borderRadius: 2, fontWeight: isSelected ? 800 : 500,
                              color: isSelected ? '#fff' : 'rgba(255,255,255,0.85)',
                              fontSize: 10,
                            }}
                            title={`${u}% up / ${t}% tail → ${metricDef.fmt(val)}`}
                          >
                            {metricDef.isPercent ? (val * 100).toFixed(1) : val.toFixed(2)}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {vizMode === 'contour' && plotlyContourData && (
            <Plot data={plotlyContourData} layout={plotlyLayout} config={plotlyConfig} style={{ width: '100%' }}
              onClick={(ev) => {
                if (ev.points?.[0]) {
                  const pt = ev.points[0];
                  setSelectedTail(pt.x);
                  setSelectedUpfront(pt.y);
                }
              }}
            />
          )}

          {vizMode === 'surface3d' && plotly3DData && (
            <Plot data={plotly3DData} layout={plotly3DLayout} config={plotlyConfig} style={{ width: '100%' }} />
          )}
        </Card>

        {/* KPI panel (right ~30%) */}
        <Card style={{ flex: 1, minWidth: 240 }}>
          <SectionTitle number="" title="Selected Point" subtitle={`Upfront ${selectedUpfront.toFixed(1)}% · Tail ${selectedTail.toFixed(1)}%`} />

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {[
              { label: 'E[IRR]', value: interpMetrics.e_irr, fmt: fmtPct, bg: irrColor },
              { label: 'E[MOIC]', value: interpMetrics.e_moic, fmt: fmtMOIC, bg: moicColor },
              { label: 'Med IRR', value: interpMetrics.p50_irr, fmt: fmtPct, bg: irrColor },
              { label: 'Med MOIC', value: interpMetrics.p50_moic, fmt: fmtMOIC, bg: moicColor },
              { label: 'IRR VaR(5%)', value: interpMetrics.p5_irr, fmt: fmtPct },
              { label: 'MOIC VaR(5%)', value: interpMetrics.p5_moic, fmt: fmtMOIC },
              { label: 'IRR CVaR(5%)', value: interpMetrics.irr_cvar_5, fmt: fmtPct },
              { label: 'MOIC CVaR(5%)', value: interpMetrics.moic_cvar_5, fmt: fmtMOIC },
              { label: 'P(IRR<0)', value: interpMetrics.prob_loss != null ? null : null },
              { label: 'P(Loss)', value: interpMetrics.prob_loss, fmt: fmtPct, bg: lossColor },
              { label: 'P(IRR>30%)', value: interpMetrics.prob_hurdle, fmt: fmtPct, bg: hurdleColor },
              { label: 'P95 IRR', value: interpMetrics.p95_irr, fmt: fmtPct },
            ].filter(k => k.value != null).map((k, i) => (
              <div key={i} style={{
                textAlign: 'center', padding: '10px 6px', borderRadius: 8,
                background: k.bg ? (typeof k.bg === 'function' ? k.bg(k.value) : '#0F1219') : '#0F1219',
                border: `1px solid ${COLORS.cardBorder}`,
              }}>
                <div style={{ color: '#ffffffAA', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', marginBottom: 3 }}>{k.label}</div>
                <div style={{ color: '#fff', fontSize: ui.sizes.md, fontWeight: 800 }}>{k.fmt(k.value)}</div>
              </div>
            ))}
          </div>

          {/* Fund share callout */}
          <div style={{
            marginTop: 16, padding: '10px 12px', borderRadius: 8,
            background: 'rgba(139,92,246,0.12)', border: '1px solid rgba(139,92,246,0.3)',
            textAlign: 'center',
          }}>
            <div style={{ color: '#ffffffAA', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', marginBottom: 3 }}>Fund Award Share</div>
            <div style={{ color: COLORS.accent2, fontSize: ui.sizes.lg, fontWeight: 800 }}>{(100 - selectedTail).toFixed(1)}%</div>
          </div>
        </Card>
      </div>

      {/* ── Histograms ── */}
      {(irrBins || moicBins) && (
        <div style={{ display: 'flex', gap: ui.space.lg, flexWrap: 'wrap' }}>
          {/* IRR histogram */}
          {irrBins && (
            <Card style={{ flex: 1, minWidth: 400 }}>
              <SectionTitle number="3a"
                title={`IRR Distribution — ${selectedUpfront.toFixed(1)}% Up / ${selectedTail.toFixed(1)}% Tail`}
                subtitle="Histogram of simulated IRR outcomes with reference lines."
              />
              <ResponsiveContainer width="100%" height={360}>
                <BarChart data={irrBins} margin={{ top: 16, right: 20, left: 10, bottom: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={COLORS.gridLine} vertical={false} />
                  <XAxis dataKey="bin" tick={{ fill: COLORS.textMuted, fontSize: 11 }} interval={Math.max(0, Math.floor(irrBins.length / 10) - 1)} />
                  <YAxis tick={{ fill: COLORS.textMuted, fontSize: 11 }} width={48} />
                  <Tooltip cursor={{ fill: 'rgba(6,182,212,0.06)' }} content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const d = payload[0].payload;
                    return (<div style={{ background: '#1F2937', border: `1px solid ${COLORS.cardBorder}`, borderRadius: 8, padding: '8px 14px', fontFamily: FONT }}>
                      <div style={{ color: COLORS.textBright, fontSize: 13, fontWeight: 600 }}>IRR: {fmtPct(d.edge)}</div>
                      <div style={{ color: COLORS.accent2, fontSize: 13 }}>Count: {d.count.toLocaleString()}</div>
                    </div>);
                  }} />
                  {/* 30% hurdle */}
                  <ReferenceLine x={nearestBinLabel(irrBins, 0.30)} stroke={COLORS.accent5} strokeDasharray="8 4" strokeWidth={2}
                    label={{ value: '30%', fill: COLORS.accent5, fontSize: 10, position: 'top' }} />
                  {/* 0% breakeven */}
                  <ReferenceLine x={nearestBinLabel(irrBins, 0.0)} stroke={COLORS.accent4} strokeDasharray="8 4" strokeWidth={1.5}
                    label={{ value: '0%', fill: COLORS.accent4, fontSize: 9, position: 'top' }} />
                  {/* Mean */}
                  {activeCell?.e_irr != null && <ReferenceLine x={nearestBinLabel(irrBins, activeCell.e_irr)}
                    stroke={COLORS.accent6} strokeDasharray="6 3" strokeWidth={1.5}
                    label={{ value: 'Mean', fill: COLORS.accent6, fontSize: 10, position: 'top' }} />}
                  {/* Median */}
                  {activeCell?.p50_irr != null && <ReferenceLine x={nearestBinLabel(irrBins, activeCell.p50_irr)}
                    stroke={COLORS.accent1} strokeDasharray="4 4" strokeWidth={1.5}
                    label={{ value: 'Med', fill: COLORS.accent1, fontSize: 10, position: 'top' }} />}
                  {/* VaR(5%) */}
                  {activeCell?.p5_irr != null && <ReferenceLine x={nearestBinLabel(irrBins, activeCell.p5_irr)}
                    stroke="#F97316" strokeDasharray="5 3" strokeWidth={1}
                    label={{ value: 'P5', fill: '#F97316', fontSize: 9, position: 'top' }} />}
                  <Bar dataKey="count" radius={[2, 2, 0, 0]} maxBarSize={14} cursor={BAR_CURSOR}>
                    {irrBins.map((e, i) => <Cell key={i} fill={e.midpoint >= 0.30 ? COLORS.accent2 : '#F59E0B80'} fillOpacity={0.85} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </Card>
          )}

          {/* MOIC histogram */}
          {moicBins && (
            <Card style={{ flex: 1, minWidth: 400 }}>
              <SectionTitle number="3b"
                title={`MOIC Distribution — ${selectedUpfront.toFixed(1)}% Up / ${selectedTail.toFixed(1)}% Tail`}
                subtitle="Histogram of simulated MOIC outcomes with reference lines."
              />
              <ResponsiveContainer width="100%" height={360}>
                <BarChart data={moicBins} margin={{ top: 16, right: 20, left: 10, bottom: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={COLORS.gridLine} vertical={false} />
                  <XAxis dataKey="bin" tick={{ fill: COLORS.textMuted, fontSize: 11 }} interval={Math.max(0, Math.floor(moicBins.length / 10) - 1)} />
                  <YAxis tick={{ fill: COLORS.textMuted, fontSize: 11 }} width={48} />
                  <Tooltip cursor={{ fill: 'rgba(6,182,212,0.06)' }} content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const d = payload[0].payload;
                    return (<div style={{ background: '#1F2937', border: `1px solid ${COLORS.cardBorder}`, borderRadius: 8, padding: '8px 14px', fontFamily: FONT }}>
                      <div style={{ color: COLORS.textBright, fontSize: 13, fontWeight: 600 }}>MOIC: {d.edge.toFixed(3)}×</div>
                      <div style={{ color: COLORS.accent1, fontSize: 13 }}>Count: {d.count.toLocaleString()}</div>
                    </div>);
                  }} />
                  {/* Breakeven 1.0× */}
                  <ReferenceLine x={nearestBinLabel(moicBins, 1.0)} stroke={COLORS.accent5} strokeDasharray="8 4" strokeWidth={2}
                    label={{ value: '1.0×', fill: COLORS.accent5, fontSize: 10, position: 'top' }} />
                  {/* Mean */}
                  {activeCell?.e_moic != null && <ReferenceLine x={nearestBinLabel(moicBins, activeCell.e_moic)}
                    stroke={COLORS.accent6} strokeDasharray="6 3" strokeWidth={1.5}
                    label={{ value: 'Mean', fill: COLORS.accent6, fontSize: 10, position: 'top' }} />}
                  {/* Median */}
                  {activeCell?.p50_moic != null && <ReferenceLine x={nearestBinLabel(moicBins, activeCell.p50_moic)}
                    stroke={COLORS.accent1} strokeDasharray="4 4" strokeWidth={1.5}
                    label={{ value: 'Med', fill: COLORS.accent1, fontSize: 10, position: 'top' }} />}
                  {/* VaR(5%) */}
                  {activeCell?.p5_moic != null && <ReferenceLine x={nearestBinLabel(moicBins, activeCell.p5_moic)}
                    stroke="#F97316" strokeDasharray="5 3" strokeWidth={1}
                    label={{ value: 'P5', fill: '#F97316', fontSize: 9, position: 'top' }} />}
                  <Bar dataKey="count" radius={[2, 2, 0, 0]} maxBarSize={14} cursor={BAR_CURSOR}>
                    {moicBins.map((e, i) => <Cell key={i} fill={e.midpoint >= 1.0 ? COLORS.accent4 : '#EF444480'} fillOpacity={0.85} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
