/**
 * PricingSurface.jsx — 3D/Contour/Heatmap surface of MOIC/IRR/P(Loss).
 * Structure: monetisation_upfront_tail
 *
 * Uses Plotly for 3D surface + contour, falls back to Recharts table heatmap.
 * Metric toggle: MOIC, IRR, P(Loss), P(Hurdle), VaR, CVaR.
 * Bilinear interpolation for continuous slider readout.
 */

import React, { useState, useMemo, useCallback, useEffect } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, ReferenceLine,
} from 'recharts';
import { COLORS, FONT, BAR_CURSOR, useUISettings, fmtPct, fmtMOIC, moicColor, irrColor, lossColor } from '../theme';
import { Card, SectionTitle, KPI } from './Shared';

function usePlotly() {
  const [Plot, setPlot] = useState(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const createPlotlyComponent = (await import('react-plotly.js/factory')).default;
        const Plotly = (await import('plotly.js/dist/plotly.min')).default;
        if (!cancelled) setPlot(() => createPlotlyComponent(Plotly));
      } catch (_) { /* Plotly unavailable — heatmap only */ }
    })();
    return () => { cancelled = true; };
  }, []);
  return Plot;
}

/* ── Bilinear interpolation ── */
function bilinearInterp(grid, upfronts, tailsList, upVal, tailVal, accessor) {
  const uClamped = Math.max(upfronts[0], Math.min(upfronts[upfronts.length - 1], upVal));
  const tClamped = Math.max(tailsList[0], Math.min(tailsList[tailsList.length - 1], tailVal));
  let i0 = 0, j0 = 0;
  for (let i = 0; i < upfronts.length - 1; i++) { if (upfronts[i] <= uClamped && upfronts[i + 1] >= uClamped) { i0 = i; break; } if (i === upfronts.length - 2) i0 = i; }
  for (let j = 0; j < tailsList.length - 1; j++) { if (tailsList[j] <= tClamped && tailsList[j + 1] >= tClamped) { j0 = j; break; } if (j === tailsList.length - 2) j0 = j; }
  const i1 = Math.min(i0 + 1, upfronts.length - 1);
  const j1 = Math.min(j0 + 1, tailsList.length - 1);
  const uR = upfronts[i1] - upfronts[i0] || 1;
  const tR = tailsList[j1] - tailsList[j0] || 1;
  const uF = (uClamped - upfronts[i0]) / uR;
  const tF = (tClamped - tailsList[j0]) / tR;
  const v = (u, t) => { const c = grid[`${u}_${t}`]; return c ? accessor(c) : 0; };
  return v(upfronts[i0], tailsList[j0]) * (1 - uF) * (1 - tF) +
         v(upfronts[i1], tailsList[j0]) * uF * (1 - tF) +
         v(upfronts[i0], tailsList[j1]) * (1 - uF) * tF +
         v(upfronts[i1], tailsList[j1]) * uF * tF;
}

/* ── Colour scale for heatmap cells ── */
function surfaceRGB(val, min, max) {
  const t = max > min ? (val - min) / (max - min) : 0.5;
  const r = t < 0.5 ? 239 : Math.round(239 - (t - 0.5) * 2 * (239 - 16));
  const g = t < 0.5 ? Math.round(68 + t * 2 * (158 - 68)) : Math.round(158 + (t - 0.5) * 2 * (185 - 158));
  const b = t < 0.5 ? Math.round(68 - t * 2 * 68) : Math.round((t - 0.5) * 2 * 129);
  return `rgb(${r},${g},${b})`;
}

const METRIC_OPTS = [
  { key: 'mean_moic', label: 'E[MOIC]', fmt: v => fmtMOIC(v), pct: false },
  { key: 'mean_xirr', label: 'E[IRR]', fmt: v => fmtPct(v), pct: true },
  { key: 'p_loss', label: 'P(Loss)', fmt: v => fmtPct(v), pct: true },
  { key: 'p_hurdle', label: 'P(IRR>30%)', fmt: v => fmtPct(v), pct: true },
  { key: 'median_moic', label: 'Median MOIC', fmt: v => fmtMOIC(v), pct: false },
  { key: 'var_1', label: 'VaR(1%)', fmt: v => fmtMOIC(v), pct: false },
  { key: 'cvar_1', label: 'CVaR(1%)', fmt: v => fmtMOIC(v), pct: false },
];

export default function PricingSurface({ data }) {
  const { ui } = useUISettings();
  const Plot = usePlotly();
  const grid = data?.investment_grid || {};
  const meta = data?.simulation_meta || {};

  const gridKeys = Object.keys(grid);
  if (gridKeys.length === 0) {
    return <Card><SectionTitle title="Pricing Surface" subtitle="No investment grid data available." /></Card>;
  }

  const upfronts = [...new Set(gridKeys.map(k => parseInt(k.split('_')[0])))].sort((a, b) => a - b);
  const tails = [...new Set(gridKeys.map(k => parseInt(k.split('_')[1])))].sort((a, b) => a - b);

  const [vizMode, setVizMode] = useState('heatmap');
  const [metricKey, setMetricKey] = useState('mean_moic');
  const [selUp, setSelUp] = useState(upfronts[Math.floor(upfronts.length / 2)]);
  const [selTail, setSelTail] = useState(tails[Math.floor(tails.length / 3)]);

  const metricDef = METRIC_OPTS.find(m => m.key === metricKey) || METRIC_OPTS[0];
  const accessor = (cell) => cell[metricKey] || 0;

  // Build surface array for Plotly
  const surfaceArr = useMemo(() =>
    upfronts.map(u => tails.map(t => { const c = grid[`${u}_${t}`]; return c ? accessor(c) : 0; })),
    [grid, upfronts, tails, metricKey]
  );

  const range = useMemo(() => {
    let min = Infinity, max = -Infinity;
    for (const row of surfaceArr) for (const v of row) { if (v < min) min = v; if (v > max) max = v; }
    return { min, max };
  }, [surfaceArr]);

  // Interpolated KPIs
  const interpVals = useMemo(() => {
    const out = {};
    for (const m of METRIC_OPTS) {
      out[m.key] = bilinearInterp(grid, upfronts, tails, selUp, selTail, c => c[m.key] || 0);
    }
    return out;
  }, [grid, upfronts, tails, selUp, selTail]);

  // Plotly data
  const plotlyData = useMemo(() => {
    const scale = metricDef.pct ? 100 : 1;
    if (vizMode === 'surface3d') {
      return [{
        type: 'surface', x: tails, y: upfronts,
        z: surfaceArr.map(r => r.map(v => v * scale)),
        colorscale: 'RdYlGn',
        colorbar: { title: metricDef.label, titlefont: { color: '#ccc' }, tickfont: { color: '#aaa' } },
        hovertemplate: `Tail: %{x}%<br>Upfront: %{y}%<br>${metricDef.label}: %{z:.2f}<extra></extra>`,
      }];
    }
    return [{
      type: 'contour', x: tails, y: upfronts,
      z: surfaceArr.map(r => r.map(v => v * scale)),
      colorscale: 'RdYlGn',
      contours: { showlabels: true, labelfont: { size: 11, color: '#fff' } },
      colorbar: { title: metricDef.label, titlefont: { color: '#ccc' }, tickfont: { color: '#aaa' } },
      hovertemplate: `Tail: %{x}%<br>Upfront: %{y}%<br>${metricDef.label}: %{z:.2f}<extra></extra>`,
    }, {
      type: 'scatter', x: [selTail], y: [selUp], mode: 'markers',
      marker: { size: 14, color: '#fff', symbol: 'x', line: { width: 2, color: '#000' } },
      showlegend: false, hoverinfo: 'skip',
    }];
  }, [surfaceArr, tails, upfronts, metricDef, vizMode, selTail, selUp]);

  const plotlyLayout = useMemo(() => vizMode === 'surface3d' ? {
    paper_bgcolor: 'rgba(0,0,0,0)', font: { family: FONT, color: '#ccc' },
    margin: { l: 10, r: 10, t: 30, b: 10 },
    scene: {
      xaxis: { title: 'Tail %', gridcolor: '#1E293B', backgroundcolor: '#0B0E17' },
      yaxis: { title: 'Upfront %', gridcolor: '#1E293B', backgroundcolor: '#0B0E17' },
      zaxis: { title: metricDef.label, gridcolor: '#1E293B', backgroundcolor: '#0B0E17' },
      bgcolor: '#0B0E17',
    }, height: 520,
  } : {
    paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(11,14,23,0.9)',
    font: { family: FONT, color: '#ccc' },
    margin: { l: 60, r: 30, t: 40, b: 60 },
    xaxis: { title: 'Tail %', gridcolor: '#1E293B' },
    yaxis: { title: 'Upfront %', gridcolor: '#1E293B' },
    height: 480,
  }, [vizMode, metricDef]);

  const handleCellClick = useCallback((u, t) => { setSelUp(u); setSelTail(t); }, []);

  const step = upfronts.length > 1 ? upfronts[1] - upfronts[0] : 5;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: ui.space.xl }}>

      {/* ── KPI banner ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: ui.space.md }}>
        <KPI label="Grid" value={`${upfronts.length}×${tails.length}`} sub={`${gridKeys.length} cells`} color={COLORS.accent6} />
        <KPI label="Portfolio SOC" value={`₹${(meta.total_soc_cr || 0).toLocaleString('en-IN')} Cr`} color={COLORS.accent1} />
        <KPI label="MC Paths" value={(meta.n_paths || 0).toLocaleString()} color={COLORS.accent2} />
        <KPI label="Claims" value={meta.n_claims || '—'} color={COLORS.accent3} />
      </div>

      {/* ── Controls ── */}
      <Card>
        <SectionTitle number="1" title="Controls" subtitle="Adjust sliders and toggle visualisation mode." />

        <div style={{ display: 'flex', gap: ui.space.xxl, flexWrap: 'wrap', marginBottom: ui.space.lg }}>
          {/* Upfront slider */}
          <div style={{ flex: 1, minWidth: 260 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ color: COLORS.textMuted, fontSize: ui.sizes.sm, fontWeight: 600 }}>Upfront %</span>
              <span style={{ color: COLORS.accent1, fontSize: ui.sizes.lg, fontWeight: 800 }}>{selUp}%</span>
            </div>
            <input type="range" min={upfronts[0]} max={upfronts[upfronts.length - 1]} step={step}
              value={selUp} onChange={e => setSelUp(parseInt(e.target.value))}
              style={{ width: '100%', accentColor: COLORS.accent1, height: 6 }} />
          </div>
          {/* Tail slider */}
          <div style={{ flex: 1, minWidth: 260 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ color: COLORS.textMuted, fontSize: ui.sizes.sm, fontWeight: 600 }}>Tail %</span>
              <span style={{ color: COLORS.accent2, fontSize: ui.sizes.lg, fontWeight: 800 }}>{selTail}%</span>
            </div>
            <input type="range" min={tails[0]} max={tails[tails.length - 1]} step={step}
              value={selTail} onChange={e => setSelTail(parseInt(e.target.value))}
              style={{ width: '100%', accentColor: COLORS.accent2, height: 6 }} />
          </div>
        </div>

        {/* Viz mode + metric */}
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ color: COLORS.textMuted, fontSize: ui.sizes.sm, fontWeight: 600 }}>View:</span>
          {[
            { id: 'heatmap', label: 'Heatmap' },
            ...(Plot ? [{ id: 'contour', label: 'Contour' }, { id: 'surface3d', label: '3D Surface' }] : []),
          ].map(m => (
            <button key={m.id} onClick={() => setVizMode(m.id)} style={{
              padding: '6px 14px', borderRadius: 6, border: 'none', cursor: 'pointer', fontFamily: FONT,
              fontSize: ui.sizes.sm, fontWeight: vizMode === m.id ? 700 : 500,
              color: vizMode === m.id ? '#fff' : COLORS.textMuted,
              background: vizMode === m.id ? COLORS.accent1 : COLORS.card,
            }}>{m.label}</button>
          ))}
          <span style={{ color: COLORS.textMuted, fontSize: ui.sizes.sm, fontWeight: 600, marginLeft: 16 }}>Metric:</span>
          <select value={metricKey} onChange={e => setMetricKey(e.target.value)}
            style={{ padding: '6px 10px', borderRadius: 6, border: `1px solid ${COLORS.cardBorder}`, background: COLORS.card, color: COLORS.textBright, fontFamily: FONT, fontSize: ui.sizes.sm }}>
            {METRIC_OPTS.map(m => <option key={m.key} value={m.key}>{m.label}</option>)}
          </select>
        </div>
      </Card>

      {/* ── Main visual + KPI panel ── */}
      <div style={{ display: 'flex', gap: ui.space.lg, flexWrap: 'wrap' }}>
        <Card style={{ flex: 3, minWidth: 500 }}>
          <SectionTitle number="2"
            title={`${metricDef.label} — ${vizMode === 'heatmap' ? 'Heatmap' : vizMode === 'contour' ? 'Contour' : '3D Surface'}`}
            subtitle={`Upfront ${upfronts[0]}–${upfronts[upfronts.length - 1]}% × Tail ${tails[0]}–${tails[tails.length - 1]}%`} />

          {vizMode === 'heatmap' && (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ borderCollapse: 'separate', borderSpacing: 1, width: '100%', fontSize: 11 }}>
                <thead>
                  <tr>
                    <th style={{ padding: '6px 4px', color: COLORS.textMuted, fontWeight: 700, fontSize: 11, position: 'sticky', left: 0, background: COLORS.card, zIndex: 2 }}>Up\Tail</th>
                    {tails.map(t => <th key={t} style={{ padding: '4px 2px', color: COLORS.textMuted, fontWeight: 600, fontSize: 10, minWidth: 40, textAlign: 'center' }}>{t}%</th>)}
                  </tr>
                </thead>
                <tbody>
                  {upfronts.map((u, ri) => (
                    <tr key={u}>
                      <td style={{ padding: '4px 6px', color: COLORS.accent1, fontWeight: 700, fontSize: 11, position: 'sticky', left: 0, background: COLORS.card, zIndex: 1 }}>{u}%</td>
                      {tails.map((t, ci) => {
                        const val = surfaceArr[ri][ci];
                        const isSelected = u === selUp && t === selTail;
                        return (
                          <td key={t} onClick={() => handleCellClick(u, t)} style={{
                            padding: '3px 1px', textAlign: 'center', cursor: 'pointer',
                            background: surfaceRGB(val, range.min, range.max),
                            border: isSelected ? '2px solid #fff' : '1px solid transparent',
                            borderRadius: 2, fontWeight: isSelected ? 800 : 500,
                            color: 'rgba(255,255,255,0.85)', fontSize: 10,
                          }} title={`${u}% up / ${t}% tail → ${metricDef.fmt(val)}`}>
                            {metricDef.pct ? (val * 100).toFixed(1) : val.toFixed(2)}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {vizMode !== 'heatmap' && Plot && (
            <Plot data={plotlyData} layout={plotlyLayout} config={{ responsive: true, displayModeBar: true, displaylogo: false }} style={{ width: '100%' }}
              onClick={(ev) => { if (ev.points?.[0]) { setSelTail(ev.points[0].x); setSelUp(ev.points[0].y); } }} />
          )}
        </Card>

        {/* KPI panel */}
        <Card style={{ flex: 1, minWidth: 240 }}>
          <SectionTitle title="Selected Point" subtitle={`${selUp}% up · ${selTail}% tail`} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {METRIC_OPTS.map((m, i) => {
              const val = interpVals[m.key];
              return (
                <div key={i} style={{
                  textAlign: 'center', padding: '10px 6px', borderRadius: 8,
                  background: '#0F1219', border: `1px solid ${COLORS.cardBorder}`,
                }}>
                  <div style={{ color: '#ffffffAA', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', marginBottom: 3 }}>{m.label}</div>
                  <div style={{ color: '#fff', fontSize: ui.sizes.md, fontWeight: 800 }}>{m.fmt(val)}</div>
                </div>
              );
            })}
          </div>
          <div style={{
            marginTop: 16, padding: '10px 12px', borderRadius: 8,
            background: 'rgba(139,92,246,0.12)', border: '1px solid rgba(139,92,246,0.3)', textAlign: 'center',
          }}>
            <div style={{ color: '#ffffffAA', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', marginBottom: 3 }}>Fund Share</div>
            <div style={{ color: COLORS.accent2, fontSize: ui.sizes.lg, fontWeight: 800 }}>{100 - selTail}%</div>
          </div>
        </Card>
      </div>
    </div>
  );
}
