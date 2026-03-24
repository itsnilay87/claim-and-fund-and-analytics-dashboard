/**
 * DistributionExplorer.jsx — D3-rendered histogram with summary stats overlay.
 *
 * Shows a histogram of MC simulation outcomes with vertical reference lines
 * for mean, median, and percentile markers.
 *
 * Data sources:
 *   - data.sample_cashflows[].moic — raw MOIC values for binning
 *   - data.cashflow_analysis.distribution — percentile summary stats
 *   - stochasticData.grid[key].moic_hist — pre-binned histograms
 *
 * Supports metric selection: Net Recovery, MOIC, IRR, Duration.
 */

import React, { useRef, useEffect, useState, useMemo, useCallback } from 'react';
import * as d3 from 'd3';
import { COLORS, FONT, useUISettings, fmtCr, fmtPct, fmtMOIC } from '../theme';

/* Preferred display order for metric toggle buttons */
const METRIC_ORDER = ['irr', 'moic', 'net_recovery', 'duration'];

/** Compute approximate summary stats from pre-binned histogram data. */
function _statsFromHist(bins, totalN) {
  if (!bins || bins.length === 0) return {};
  const n = totalN || bins.reduce((s, b) => s + b.count, 0);
  if (n === 0) return {};
  // mean: weighted midpoints
  const mean = bins.reduce((s, b) => s + (b.x0 + b.x1) / 2 * b.count, 0) / n;
  // cumulative counts → quantiles
  const targets = [0.05, 0.25, 0.50, 0.75, 0.95];
  const result = { mean, n };
  let cumulative = 0;
  let ti = 0;
  for (const b of bins) {
    cumulative += b.count;
    while (ti < targets.length && cumulative / n >= targets[ti]) {
      const key = ['p5', 'p25', 'median', 'p75', 'p95'][ti];
      // Interpolate within bin
      const prev = cumulative - b.count;
      const frac = b.count > 0 ? (targets[ti] * n - prev) / b.count : 0;
      result[key] = b.x0 + frac * (b.x1 - b.x0);
      if (key === 'median') result.median = result[key];
      ti++;
    }
    if (ti >= targets.length) break;
  }
  return result;
}

const METRIC_CONFIGS = {
  moic: {
    label: 'MOIC',
    format: v => `${v.toFixed(2)}×`,
    color: COLORS.accent1,
    thresholdLine: 1.0,
    thresholdLabel: 'Breakeven (1.0×)',
  },
  net_recovery: {
    label: 'Net Recovery (₹ Cr)',
    format: v => `₹${v.toFixed(0)}`,
    color: COLORS.accent4,
    thresholdLine: 0,
    thresholdLabel: 'Breakeven',
  },
  irr: {
    label: 'Portfolio IRR',
    format: v => `${(v * 100).toFixed(1)}%`,
    color: COLORS.accent2,
    thresholdLine: 0.30,
    thresholdLabel: '30% hurdle',
  },
  duration: {
    label: 'Duration (months)',
    format: v => `${v.toFixed(0)}m`,
    color: COLORS.accent3,
    thresholdLine: null,
    thresholdLabel: null,
  },
};

export default function DistributionExplorer({
  data,
  defaultMetric = 'irr',
  height = 320,
  compact = false,
  showSelector = true,
  gridKey = null,          // override grid key, e.g. '10_20'
}) {
  const { ui } = useUISettings();
  const svgRef = useRef(null);
  const containerRef = useRef(null);
  const tooltipRef = useRef(null);
  const [metric, setMetric] = useState(defaultMetric);
  const [containerW, setContainerW] = useState(0);

  // ResizeObserver for reactivity
  const resizeRef = useCallback(node => {
    if (!node) return;
    containerRef.current = node;
    const ro = new ResizeObserver(entries => {
      for (const entry of entries) {
        const cw = entry.contentRect.width;
        if (cw > 0) setContainerW(cw);
      }
    });
    ro.observe(node);
    if (node.clientWidth > 0) setContainerW(node.clientWidth);
    return () => ro.disconnect();
  }, []);

  // Extract histogram data based on metric
  const histData = useMemo(() => {
    if (!data) return null;

    const nBins = compact ? 25 : 40;

    // Try to get pre-binned data first
    // Key aliases: Python exporter uses xirr / net_return_cr
    const MC_KEY_ALIASES = { irr: 'xirr', net_recovery: 'net_return_cr' };
    const mcKey = (data.mc_distributions?.[metric]) ? metric : MC_KEY_ALIASES[metric];
    if (data.mc_distributions && mcKey && data.mc_distributions[mcKey]) {
      const dist = data.mc_distributions[mcKey];

      // Handle {bins: [midpoints], counts: [counts], edges?: [edges]} format from run_v2.py
      if (dist.counts && Array.isArray(dist.counts) && dist.counts.length > 0) {
        let bins;
        if (dist.edges && dist.edges.length > 1) {
          // Use edges for precise x0/x1 boundaries
          bins = dist.counts.map((count, i) => ({
            x0: dist.edges[i],
            x1: dist.edges[i + 1] ?? dist.edges[i] + (dist.edges[1] - dist.edges[0]),
            count,
          }));
        } else if (dist.bins && dist.bins.length > 0 && typeof dist.bins[0] === 'number') {
          // Reconstruct from midpoints
          const step = dist.bins.length > 1 ? dist.bins[1] - dist.bins[0] : 1;
          bins = dist.bins.map((mid, i) => ({
            x0: mid - step / 2,
            x1: mid + step / 2,
            count: dist.counts[i] || 0,
          }));
        }
        if (bins && bins.length > 0) {
          const totalN = data.mc_distributions.n_paths || bins.reduce((s, b) => s + b.count, 0);
          return { bins, stats: _statsFromHist(bins, totalN) };
        }
      }

      // Handle pre-formatted {bins: [{x0, x1, count}], stats: {}} format
      if (dist.bins && dist.bins.length > 0 && typeof dist.bins[0] === 'object') {
        return { bins: dist.bins, stats: dist.stats || {} };
      }
    }

    // Use stochastic pricing grid histograms (full N=10,000 paths).
    // Default to 10% upfront / 20% TATA tail as a representative deal structure.
    // duration_hist and net_recovery_hist are deal-independent / deal-dependent respectively.
    const GRID_HIST_METRICS = { moic: 'moic_hist', irr: 'irr_hist', net_recovery: 'net_recovery_hist', duration: 'duration_hist' };
    if (GRID_HIST_METRICS[metric]) {
      const grid = data.stochastic_pricing?.grid;
      if (grid) {
        const defaultKey = gridKey || '10_20';
        const combo = grid[defaultKey] || grid[Object.keys(grid)[0]];
        if (combo) {
          const histKey = GRID_HIST_METRICS[metric];
          const rawHist = combo[histKey];
          if (rawHist && rawHist.length > 1) {
            const binWidth = rawHist[1].edge - rawHist[0].edge;
            const bins = rawHist.map((b, i) => ({
              x0: b.edge,
              x1: i + 1 < rawHist.length ? rawHist[i + 1].edge : b.edge + binWidth,
              count: b.count,
            }));
            const totalN = data.simulation_meta?.n_paths
              || bins.reduce((s, b) => s + b.count, 0);

            // For moic/irr use pre-computed percentiles; for others derive from histogram
            let stats;
            if (metric === 'moic' || metric === 'irr') {
              const sk = metric === 'moic' ? 'moic' : 'irr';
              stats = {
                mean: combo[`e_${sk}`],
                median: combo[`p50_${sk}`],
                p5: combo[`p5_${sk}`],
                p25: combo[`p25_${sk}`],
                p75: combo[`p75_${sk}`],
                p95: combo[`p95_${sk}`],
                n: totalN,
              };
            } else {
              // Prefer pre-computed stats fields (injected by patch_stochastic_hists),
              // otherwise derive approximate stats from histogram bins
              const statsKey = metric === 'net_recovery' ? 'net_recovery_stats' : 'duration_stats';
              const precomputed = combo[statsKey];
              stats = precomputed
                ? { ...precomputed, n: totalN }
                : _statsFromHist(bins, totalN);
            }

            const dealLabel = (metric === 'duration')
              ? null
              : `${combo.upfront_pct}% upfront / ${combo.tata_tail_pct}% Tata tail`;

            return { bins, stats, dealLabel };
          }
        }
      }
    }

    // Extract raw values from sample_cashflows based on metric
    const samples = data.sample_cashflows;
    if (samples && samples.length > 0) {
      let values = null;

      if (metric === 'moic') {
        values = samples.map(s => s.moic).filter(v => v != null && isFinite(v));
      } else if (metric === 'net_recovery') {
        // net recovery = total_return - total_invested
        values = samples
          .map(s => (s.total_return_cr != null && s.total_invested_cr != null)
            ? s.total_return_cr - s.total_invested_cr : null)
          .filter(v => v != null && isFinite(v));
      } else if (metric === 'irr') {
        // Approximate IRR from MOIC and duration: IRR ≈ (MOIC^(12/months) - 1)
        values = samples
          .map(s => {
            if (s.moic != null && s.timeline_months > 0) {
              const yrs = s.timeline_months / 12;
              return yrs > 0 ? Math.pow(Math.max(s.moic, 0.001), 1 / yrs) - 1 : 0;
            }
            return null;
          })
          .filter(v => v != null && isFinite(v) && v > -1 && v < 10);
      } else if (metric === 'duration') {
        values = samples.map(s => s.timeline_months).filter(v => v != null && isFinite(v) && v > 0);
      }

      if (values && values.length > 0) {
        const binGen = d3.bin().thresholds(nBins);
        const bins = binGen(values);
        const sorted = [...values].sort(d3.ascending);
        return {
          bins: bins.map(b => ({ x0: b.x0, x1: b.x1, count: b.length })),
          stats: {
            mean: d3.mean(values),
            median: d3.median(values),
            p5: d3.quantile(sorted, 0.05),
            p25: d3.quantile(sorted, 0.25),
            p75: d3.quantile(sorted, 0.75),
            p95: d3.quantile(sorted, 0.95),
            min: d3.min(values),
            max: d3.max(values),
            std: d3.deviation(values),
            n: values.length,
          },
        };
      }
    }

    // Fallback: scenario_comparison for MOIC stats-only
    if (metric === 'moic') {
      const sc = data.scenario_comparison;
      if (sc && sc.length > 0) {
        const best = sc.reduce((a, b) => a.mean_moic > b.mean_moic ? a : b, sc[0]);
        return { bins: [], stats: { mean: best.mean_moic, median: best.median_moic } };
      }
    }

    // Fallback: cashflow_analysis.distribution for net_recovery stats
    if (metric === 'net_recovery' && data.cashflow_analysis?.distribution) {
      const dist = data.cashflow_analysis.distribution.net_cr || data.cashflow_analysis.distribution.gross_cr;
      if (dist) {
        return { bins: [], stats: { mean: dist.mean, median: dist.p50, p5: dist.p5, p25: dist.p25, p75: dist.p75, p95: dist.p95 } };
      }
    }

    return null;
  }, [data, metric, compact, gridKey]);

  useEffect(() => {
    if (!svgRef.current || containerW < 50 || !histData) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();
    const margin = compact
      ? { top: 28, right: 16, bottom: 30, left: 46 }
      : { top: 36, right: 24, bottom: 40, left: 56 };
    const w = containerW - margin.left - margin.right;
    const h = height - margin.top - margin.bottom;

    svg.attr('width', containerW).attr('height', height);

    const config = METRIC_CONFIGS[metric] || METRIC_CONFIGS.moic;

    if (histData.bins.length === 0) {
      // No histogram bins — show message
      svg.append('text')
        .attr('x', containerW / 2)
        .attr('y', height / 2)
        .attr('text-anchor', 'middle')
        .attr('fill', COLORS.textMuted)
        .attr('font-size', 13)
        .attr('font-family', FONT)
        .text(`No histogram data available for ${config.label}`);
      return;
    }

    const g = svg.append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    // Scales
    const xDomain = [
      d3.min(histData.bins, d => d.x0),
      d3.max(histData.bins, d => d.x1),
    ];
    const xScale = d3.scaleLinear().domain(xDomain).range([0, w]).nice();

    const maxCount = d3.max(histData.bins, d => d.count) || 1;
    const yScale = d3.scaleLinear().domain([0, maxCount * 1.1]).range([h, 0]);

    // Grid lines
    g.append('g')
      .selectAll('line')
      .data(yScale.ticks(5))
      .join('line')
      .attr('x1', 0).attr('x2', w)
      .attr('y1', d => yScale(d)).attr('y2', d => yScale(d))
      .attr('stroke', COLORS.gridLine)
      .attr('stroke-dasharray', '3 3');

    // Histogram bars
    const barPad = Math.max(1, w / histData.bins.length * 0.08);
    g.selectAll('.bar')
      .data(histData.bins)
      .join('rect')
      .attr('class', 'bar')
      .attr('x', d => xScale(d.x0) + barPad / 2)
      .attr('y', d => yScale(d.count))
      .attr('width', d => Math.max(0, xScale(d.x1) - xScale(d.x0) - barPad))
      .attr('height', d => h - yScale(d.count))
      .attr('fill', d => {
        if (config.thresholdLine != null) {
          return d.x0 >= config.thresholdLine ? config.color : '#EF444490';
        }
        return config.color;
      })
      .attr('fill-opacity', 0.8)
      .attr('rx', 1.5);

    // Reference lines for stats
    const stats = histData.stats;
    const refLines = [];

    if (stats.mean != null) refLines.push({ value: stats.mean, label: 'Mean', color: COLORS.accent6, dash: '6 3' });
    if (stats.median != null) refLines.push({ value: stats.median, label: 'Median', color: COLORS.accent1, dash: '4 4' });
    if (stats.p25 != null) refLines.push({ value: stats.p25, label: 'P25', color: COLORS.accent3, dash: '3 3' });
    if (stats.p75 != null) refLines.push({ value: stats.p75, label: 'P75', color: COLORS.accent3, dash: '3 3' });

    // Threshold line (breakeven/hurdle)
    if (config.thresholdLine != null) {
      refLines.push({ value: config.thresholdLine, label: config.thresholdLabel, color: COLORS.accent5, dash: '8 4' });
    }

    refLines.forEach(ref => {
      if (ref.value < xDomain[0] || ref.value > xDomain[1]) return;
      g.append('line')
        .attr('x1', xScale(ref.value)).attr('x2', xScale(ref.value))
        .attr('y1', 0).attr('y2', h)
        .attr('stroke', ref.color)
        .attr('stroke-width', 1.5)
        .attr('stroke-dasharray', ref.dash);

      g.append('text')
        .attr('x', xScale(ref.value))
        .attr('y', -4)
        .attr('text-anchor', 'middle')
        .attr('fill', ref.color)
        .attr('font-size', 10)
        .attr('font-weight', 600)
        .attr('font-family', FONT)
        .text(ref.label);
    });

    // X-axis
    g.append('g')
      .attr('transform', `translate(0,${h})`)
      .call(d3.axisBottom(xScale)
        .ticks(compact ? 6 : 10)
        .tickFormat(v => config.format(v))
      )
      .call(g => g.selectAll('text')
        .attr('fill', COLORS.textMuted)
        .attr('font-size', compact ? 10 : 11)
        .attr('font-family', FONT))
      .call(g => g.selectAll('line').attr('stroke', COLORS.gridLine))
      .call(g => g.select('.domain').attr('stroke', COLORS.gridLine));

    // Y-axis
    g.append('g')
      .call(d3.axisLeft(yScale)
        .ticks(compact ? 3 : 5)
        .tickFormat(d3.format(','))
      )
      .call(g => g.selectAll('text')
        .attr('fill', COLORS.textMuted)
        .attr('font-size', compact ? 10 : 11)
        .attr('font-family', FONT))
      .call(g => g.selectAll('line').attr('stroke', COLORS.gridLine))
      .call(g => g.select('.domain').attr('stroke', COLORS.gridLine));

    // Y-axis label
    if (!compact) {
      g.append('text')
        .attr('transform', 'rotate(-90)')
        .attr('x', -h / 2).attr('y', -42)
        .attr('text-anchor', 'middle')
        .attr('fill', COLORS.textMuted)
        .attr('font-size', 11)
        .attr('font-family', FONT)
        .text('Frequency');
    }

    // ── Hover tooltip overlay ──
    const tooltipEl = tooltipRef.current;
    if (tooltipEl) {
      g.append('rect')
        .attr('x', 0).attr('y', 0)
        .attr('width', w).attr('height', h)
        .attr('fill', 'transparent')
        .style('cursor', 'crosshair')
        .on('mousemove', function (event) {
          const [mx] = d3.pointer(event);
          const xVal = xScale.invert(mx);
          const bin = histData.bins.find(b => xVal >= b.x0 && xVal < b.x1)
            || histData.bins.reduce((best, b) => {
              const bDist = Math.abs((b.x0 + b.x1) / 2 - xVal);
              const bestDist = Math.abs((best.x0 + best.x1) / 2 - xVal);
              return bDist < bestDist ? b : best;
            }, histData.bins[0]);
          if (!bin) return;

          const tipX = xScale(bin.x0) + margin.left + 10;
          const tipY = Math.max(0, yScale(bin.count) + margin.top - 10);
          tooltipEl.style.display = 'block';
          tooltipEl.style.left = `${tipX}px`;
          tooltipEl.style.top  = `${tipY}px`;
          tooltipEl.innerHTML = [
            `<div style="color:#f9fafb;font-weight:700;font-size:12px">${config.format((bin.x0 + bin.x1) / 2)}</div>`,
            `<div style="color:${config.color};font-size:12px">Count: ${bin.count.toLocaleString()}</div>`,
            `<div style="color:#9ca3af;font-size:11px">${config.format(bin.x0)} – ${config.format(bin.x1)}</div>`,
          ].join('');
        })
        .on('mouseleave', function () {
          tooltipEl.style.display = 'none';
        });
    }

  }, [histData, height, compact, metric, containerW, gridKey]);

  // Summary stats header
  const stats = histData?.stats;
  const dealLabel = histData?.dealLabel;
  const config = METRIC_CONFIGS[metric];

  return (
    <div style={{ width: '100%' }}>
      {/* Header with metric selector + stats */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexWrap: 'wrap', gap: 8, marginBottom: compact ? 4 : 8,
      }}>
        {showSelector && (
          <div style={{ display: 'flex', gap: 4 }}>
            {METRIC_ORDER.map(key => {
              const cfg = METRIC_CONFIGS[key];
              return (
                <button key={key} onClick={() => setMetric(key)} style={{
                  padding: compact ? '3px 8px' : '5px 12px',
                  borderRadius: 5, border: 'none', cursor: 'pointer',
                  fontFamily: FONT,
                  fontSize: compact ? 11 : 12,
                  fontWeight: metric === key ? 700 : 500,
                  color: metric === key ? '#fff' : COLORS.textMuted,
                  background: metric === key ? cfg.color + 'CC' : '#111827',
                }}>
                  {cfg.label}
                </button>
              );
            })}
          </div>
        )}

        {stats && (
          <div style={{
            display: 'flex', gap: compact ? 10 : 16,
            fontSize: compact ? 11 : 12, fontFamily: FONT, color: COLORS.textMuted,
          }}>
            {stats.mean != null && (
              <span>Mean: <span style={{ color: COLORS.accent6, fontWeight: 700 }}>{config.format(stats.mean)}</span></span>
            )}
            {stats.median != null && (
              <span>Median: <span style={{ color: COLORS.accent1, fontWeight: 700 }}>{config.format(stats.median)}</span></span>
            )}
            {stats.p25 != null && stats.p75 != null && (
              <span>IQR: <span style={{ color: COLORS.accent3, fontWeight: 600 }}>{config.format(stats.p25)} – {config.format(stats.p75)}</span></span>
            )}
            {stats.n != null && (
              <span>n = {stats.n.toLocaleString()}</span>
            )}
            {dealLabel && (
              <span style={{ color: COLORS.textMuted, fontStyle: 'italic', opacity: 0.7 }}>
                @ {dealLabel}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Chart */}
      <div ref={resizeRef} style={{ width: '100%', height, position: 'relative' }}>
        <svg ref={svgRef} style={{ width: '100%', height }} />
        {/* D3-managed hover tooltip */}
        <div
          ref={tooltipRef}
          style={{
            display: 'none',
            position: 'absolute',
            pointerEvents: 'none',
            background: '#1F2937',
            border: `1px solid ${COLORS.cardBorder}`,
            borderRadius: 8,
            padding: '7px 12px',
            fontFamily: FONT,
            zIndex: 99,
            whiteSpace: 'nowrap',
            boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
          }}
        />
      </div>
    </div>
  );
}
