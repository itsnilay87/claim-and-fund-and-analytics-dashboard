/**
 * JCurveFanChart.jsx — D3-rendered percentile fan chart showing cumulative
 * portfolio cashflow over time (true J-curve shape with initial outflows).
 *
 * Uses d3.area() for smooth band rendering with p5-p95 outer band,
 * p25-p75 inner band, and p50 median line.
 *
 * Data: data.jcurve_data.scenarios[scenarioKey] → array of
 *   { month, label, p5, p25, median, p75, p95, mean }
 *
 * Props:
 *   - data: dashboard data object
 *   - height: chart height in px (default 340)
 *   - compact: reduce margins for embedded use
 *   - upfrontPct: upfront % (default 0.10)
 *   - tataTailPct: Tata tail % (default 0.20)
 *   - showControls: show upfront/tail dropdown selectors
 *   - onScenarioChange: callback({upfrontPct, tataTailPct}) when user changes
 */

import React, { useRef, useEffect, useMemo, useState, useCallback } from 'react';
import * as d3 from 'd3';
import { COLORS, FONT, useUISettings, fmtCr } from '../theme';

export default function JCurveFanChart({
  data,
  height = 340,
  compact = false,
  upfrontPct = 0.10,
  tataTailPct = 0.20,
  showControls = false,
  onScenarioChange,
}) {
  const { ui } = useUISettings();
  const svgRef = useRef(null);
  const [containerW, setContainerW] = useState(0);
  const [selectedUpfront, setSelectedUpfront] = useState(upfrontPct);
  const [selectedTail, setSelectedTail] = useState(tataTailPct);

  // Sync with props
  useEffect(() => { setSelectedUpfront(upfrontPct); }, [upfrontPct]);
  useEffect(() => { setSelectedTail(tataTailPct); }, [tataTailPct]);

  // ResizeObserver for reactivity
  const resizeRef = useCallback(node => {
    if (!node) return;
    const ro = new ResizeObserver(entries => {
      for (const entry of entries) {
        const w = entry.contentRect.width;
        if (w > 0) setContainerW(w);
      }
    });
    ro.observe(node);
    if (node.clientWidth > 0) setContainerW(node.clientWidth);
    return () => ro.disconnect();
  }, []);

  // Resolve scenario key and timeline data
  const { timelineData, scenarioKey, availableUpfronts, availableTails } = useMemo(() => {
    const jc = data?.jcurve_data;
    if (!jc || !jc.scenarios) {
      return { timelineData: null, scenarioKey: null, availableUpfronts: [], availableTails: [] };
    }

    const upInt = Math.round(selectedUpfront * 100);
    const tailInt = Math.round(selectedTail * 100);
    const key = `up${upInt}_tail${tailInt}`;
    // Fall back to default_key (e.g. "litigation_funding") or first available scenario
    const timeline = jc.scenarios[key]
      || (jc.default_key && jc.scenarios[jc.default_key])
      || jc.scenarios[Object.keys(jc.scenarios)[0]]
      || null;

    return {
      timelineData: timeline,
      scenarioKey: key,
      availableUpfronts: jc.upfront_pcts || [],
      availableTails: jc.tata_tail_pcts || [],
    };
  }, [data, selectedUpfront, selectedTail]);

  // Handle dropdown changes
  const handleUpfrontChange = (e) => {
    const val = parseFloat(e.target.value);
    setSelectedUpfront(val);
    onScenarioChange?.({ upfrontPct: val, tataTailPct: selectedTail });
  };
  const handleTailChange = (e) => {
    const val = parseFloat(e.target.value);
    setSelectedTail(val);
    onScenarioChange?.({ upfrontPct: selectedUpfront, tataTailPct: val });
  };

  // D3 rendering
  useEffect(() => {
    if (!timelineData || !svgRef.current || containerW < 50) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();
    const margin = compact
      ? { top: 20, right: 20, bottom: 38, left: 56 }
      : { top: 24, right: 30, bottom: 48, left: 64 };
    const w = containerW - margin.left - margin.right;
    const h = height - margin.top - margin.bottom;

    svg.attr('width', containerW).attr('height', height);

    const g = svg.append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    // Scales
    const xScale = d3.scaleLinear()
      .domain([0, timelineData.length - 1])
      .range([0, w]);

    const allValues = timelineData.flatMap(d =>
      [d.p5, d.p25, d.median, d.p75, d.p95].filter(v => v != null)
    );
    const yMin = Math.min(0, d3.min(allValues) || 0);
    const yMax = d3.max(allValues) || 100;
    const yPad = (yMax - yMin) * 0.08;

    const yScale = d3.scaleLinear()
      .domain([yMin - yPad, yMax + yPad])
      .range([h, 0])
      .nice();

    // Grid lines
    g.append('g')
      .selectAll('line')
      .data(yScale.ticks(compact ? 4 : 6))
      .join('line')
      .attr('x1', 0).attr('x2', w)
      .attr('y1', d => yScale(d)).attr('y2', d => yScale(d))
      .attr('stroke', COLORS.gridLine)
      .attr('stroke-dasharray', '3 3');

    // Outer band (p5-p95)
    const areaOuter = d3.area()
      .x((d, i) => xScale(i))
      .y0(d => yScale(d.p5 || 0))
      .y1(d => yScale(d.p95 || 0))
      .curve(d3.curveMonotoneX);

    g.append('path')
      .datum(timelineData)
      .attr('d', areaOuter)
      .attr('fill', COLORS.accent6)
      .attr('fill-opacity', 0.12);

    // Inner band (p25-p75)
    const areaInner = d3.area()
      .x((d, i) => xScale(i))
      .y0(d => yScale(d.p25 || 0))
      .y1(d => yScale(d.p75 || 0))
      .curve(d3.curveMonotoneX);

    g.append('path')
      .datum(timelineData)
      .attr('d', areaInner)
      .attr('fill', COLORS.accent6)
      .attr('fill-opacity', 0.25);

    // Median line
    const medianLine = d3.line()
      .x((d, i) => xScale(i))
      .y(d => yScale(d.median || 0))
      .curve(d3.curveMonotoneX);

    g.append('path')
      .datum(timelineData)
      .attr('d', medianLine)
      .attr('fill', 'none')
      .attr('stroke', COLORS.accent3)
      .attr('stroke-width', 2.5);

    // Zero reference line (breakeven)
    if (yMin < 0) {
      g.append('line')
        .attr('x1', 0).attr('x2', w)
        .attr('y1', yScale(0)).attr('y2', yScale(0))
        .attr('stroke', COLORS.accent5)
        .attr('stroke-width', 1.5)
        .attr('stroke-dasharray', '6 4');

      g.append('text')
        .attr('x', w - 4)
        .attr('y', yScale(0) - 5)
        .attr('text-anchor', 'end')
        .attr('fill', COLORS.accent5)
        .attr('font-size', 10)
        .attr('font-family', FONT)
        .text('Breakeven');

      // Find median breakeven month and mark it
      for (let i = 1; i < timelineData.length; i++) {
        if (timelineData[i - 1].median < 0 && timelineData[i].median >= 0) {
          const beX = xScale(i);
          g.append('circle')
            .attr('cx', beX).attr('cy', yScale(0))
            .attr('r', 5)
            .attr('fill', COLORS.accent4)
            .attr('stroke', '#fff').attr('stroke-width', 1.5);
          g.append('text')
            .attr('x', beX).attr('y', yScale(0) + 16)
            .attr('text-anchor', 'middle')
            .attr('fill', COLORS.accent4)
            .attr('font-size', 10)
            .attr('font-weight', 700)
            .attr('font-family', FONT)
            .text(timelineData[i].label);
          break;
        }
      }
    }

    // Find and annotate the minimum (trough) of the median J-curve
    let troughIdx = 0;
    let troughVal = timelineData[0]?.median || 0;
    for (let i = 1; i < timelineData.length; i++) {
      if ((timelineData[i].median || 0) < troughVal) {
        troughVal = timelineData[i].median || 0;
        troughIdx = i;
      }
    }
    if (troughVal < -1) {
      const tx = xScale(troughIdx);
      const ty = yScale(troughVal);
      g.append('circle')
        .attr('cx', tx).attr('cy', ty)
        .attr('r', 4)
        .attr('fill', COLORS.accent5)
        .attr('stroke', '#fff').attr('stroke-width', 1);
      g.append('text')
        .attr('x', tx + 8).attr('y', ty + 4)
        .attr('text-anchor', 'start')
        .attr('fill', COLORS.accent5)
        .attr('font-size', 10)
        .attr('font-weight', 700)
        .attr('font-family', FONT)
        .text(`₹${troughVal.toFixed(0)} Cr`);
    }

    // First cash inflow — find first month where cumulative median increases
    for (let i = 1; i < timelineData.length; i++) {
      if (timelineData[i].median > timelineData[i - 1].median + 0.01) {
        const fiX = xScale(i);
        const fiY = yScale(timelineData[i].median);
        // Pill-shaped label
        const pillW = 86, pillH = 22, pillR = 6;
        const pillX = fiX - pillW / 2;
        const pillY = fiY - pillH - 12;
        g.append('rect')
          .attr('x', pillX).attr('y', pillY)
          .attr('width', pillW).attr('height', pillH)
          .attr('rx', pillR).attr('ry', pillR)
          .attr('fill', '#6366F1').attr('fill-opacity', 0.9);
        g.append('text')
          .attr('x', fiX).attr('y', pillY + pillH / 2 + 1)
          .attr('text-anchor', 'middle')
          .attr('dominant-baseline', 'middle')
          .attr('fill', '#fff')
          .attr('font-size', 10)
          .attr('font-weight', 700)
          .attr('font-family', FONT)
          .text(`1st Inflow: ${timelineData[i].label}`);
        // Connector line
        g.append('line')
          .attr('x1', fiX).attr('y1', pillY + pillH)
          .attr('x2', fiX).attr('y2', fiY - 4)
          .attr('stroke', '#6366F1').attr('stroke-width', 1).attr('stroke-dasharray', '3 2');
        g.append('circle')
          .attr('cx', fiX).attr('cy', fiY)
          .attr('r', 4)
          .attr('fill', '#6366F1')
          .attr('stroke', '#fff').attr('stroke-width', 1.5);
        break;
      }
    }

    // X-axis — adaptive ticks
    const maxTicks = Math.max(4, Math.floor(w / 70));
    const step = Math.max(1, Math.ceil(timelineData.length / maxTicks));
    const tickIndices = timelineData
      .map((_, i) => i)
      .filter(i => i % step === 0 || i === timelineData.length - 1);

    g.append('g')
      .attr('transform', `translate(0,${h})`)
      .call(d3.axisBottom(xScale)
        .tickValues(tickIndices)
        .tickFormat(i => timelineData[i]?.label || '')
      )
      .call(g => g.selectAll('text')
        .attr('fill', COLORS.textMuted)
        .attr('font-size', compact ? 9 : 11)
        .attr('font-family', FONT)
        .attr('text-anchor', 'end')
        .attr('transform', 'rotate(-25)'))
      .call(g => g.selectAll('line').attr('stroke', COLORS.gridLine))
      .call(g => g.select('.domain').attr('stroke', COLORS.gridLine));

    // Y-axis
    g.append('g')
      .call(d3.axisLeft(yScale)
        .ticks(compact ? 4 : 6)
        .tickFormat(v => `₹${v.toFixed(0)}`)
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
        .attr('transform', `rotate(-90)`)
        .attr('x', -h / 2).attr('y', -margin.left + 14)
        .attr('text-anchor', 'middle')
        .attr('fill', COLORS.textMuted)
        .attr('font-size', 11)
        .attr('font-family', FONT)
        .text('Cumulative Cash Flow (₹ Cr)');
    }

    // Legend
    const legendY = compact ? -12 : -14;
    const legendItems = [
      { label: '5th / 95th Pctl', color: COLORS.accent6, opacity: 0.12, type: 'area' },
      { label: '25th / 75th Pctl', color: COLORS.accent6, opacity: 0.35, type: 'area' },
      { label: 'Median', color: COLORS.accent3, type: 'line' },
    ];
    let lx = 0;
    legendItems.forEach(item => {
      if (item.type === 'area') {
        g.append('rect')
          .attr('x', lx).attr('y', legendY)
          .attr('width', 14).attr('height', 10)
          .attr('fill', item.color).attr('fill-opacity', item.opacity)
          .attr('rx', 2);
      } else {
        g.append('line')
          .attr('x1', lx).attr('x2', lx + 14)
          .attr('y1', legendY + 5).attr('y2', legendY + 5)
          .attr('stroke', item.color).attr('stroke-width', 2.5);
      }
      g.append('text')
        .attr('x', lx + 18).attr('y', legendY + 9)
        .attr('fill', COLORS.textMuted)
        .attr('font-size', 10)
        .attr('font-family', FONT)
        .text(item.label);
      lx += item.label.length * 5.8 + 30;
    });

    /* ── Hover interaction layer ── */
    const hoverLine = g.append('line')
      .attr('y1', 0).attr('y2', h)
      .attr('stroke', COLORS.textMuted).attr('stroke-width', 1)
      .attr('stroke-dasharray', '4 3')
      .style('opacity', 0).style('pointer-events', 'none');

    const hoverDot = g.append('circle')
      .attr('r', 5)
      .attr('fill', COLORS.accent3).attr('stroke', COLORS.bg).attr('stroke-width', 2)
      .style('opacity', 0).style('pointer-events', 'none');

    const hoverRangeBar = g.append('line')
      .attr('stroke', COLORS.accent6).attr('stroke-width', 3)
      .attr('stroke-linecap', 'round')
      .style('opacity', 0).style('pointer-events', 'none');

    // Tooltip group
    const tooltip = g.append('g').style('opacity', 0).style('pointer-events', 'none');
    const ttRect = tooltip.append('rect')
      .attr('rx', 8).attr('ry', 8)
      .attr('fill', '#1F2937').attr('fill-opacity', 0.95)
      .attr('stroke', COLORS.cardBorder).attr('stroke-width', 1);
    const ttTexts = [];
    const ttLabels = ['Period', 'P95', 'P75', 'Median', 'P25', 'P5'];
    const ttColors = [COLORS.textBright, COLORS.accent6, COLORS.accent6, COLORS.accent3, COLORS.accent6, COLORS.accent6];
    for (let ti = 0; ti < ttLabels.length; ti++) {
      ttTexts.push(tooltip.append('text')
        .attr('font-family', FONT)
        .attr('font-size', 11)
        .attr('fill', ttColors[ti]));
    }

    // Invisible overlay to capture mouse
    g.append('rect')
      .attr('width', w).attr('height', h)
      .attr('fill', 'transparent')
      .style('cursor', 'crosshair')
      .on('mousemove', function (event) {
        const [mx] = d3.pointer(event, this);
        const idx = Math.round(xScale.invert(mx));
        const clamped = Math.max(0, Math.min(idx, timelineData.length - 1));
        const d = timelineData[clamped];
        if (!d) return;

        const cx = xScale(clamped);

        hoverLine.attr('x1', cx).attr('x2', cx).style('opacity', 0.6);
        hoverDot.attr('cx', cx).attr('cy', yScale(d.median || 0)).style('opacity', 1);
        hoverRangeBar
          .attr('x1', cx).attr('x2', cx)
          .attr('y1', yScale(d.p75 || 0)).attr('y2', yScale(d.p25 || 0))
          .style('opacity', 0.7);

        const vals = [
          d.label || `M${d.month}`,
          d.p95 != null ? `₹${d.p95.toFixed(0)} Cr` : '—',
          d.p75 != null ? `₹${d.p75.toFixed(0)} Cr` : '—',
          d.median != null ? `₹${d.median.toFixed(0)} Cr` : '—',
          d.p25 != null ? `₹${d.p25.toFixed(0)} Cr` : '—',
          d.p5 != null ? `₹${d.p5.toFixed(0)} Cr` : '—',
        ];

        const ttW = 160, ttH = ttLabels.length * 18 + 12;
        const flipX = cx + ttW + 16 > w;
        const tx = flipX ? cx - ttW - 12 : cx + 12;
        const ty = Math.max(0, Math.min(yScale(d.median || 0) - ttH / 2, h - ttH));

        tooltip.style('opacity', 1);
        ttRect.attr('x', tx).attr('y', ty).attr('width', ttW).attr('height', ttH);

        for (let ti = 0; ti < ttLabels.length; ti++) {
          const isBold = ti === 0 || ti === 3;
          ttTexts[ti]
            .attr('x', tx + 8)
            .attr('y', ty + 18 + ti * 18)
            .attr('font-weight', isBold ? 700 : 500)
            .text(`${ttLabels[ti]}: ${vals[ti]}`);
        }
      })
      .on('mouseleave', () => {
        hoverLine.style('opacity', 0);
        hoverDot.style('opacity', 0);
        hoverRangeBar.style('opacity', 0);
        tooltip.style('opacity', 0);
      });

  }, [timelineData, height, compact, containerW]);

  if (!timelineData) {
    return (
      <div style={{ padding: 16, color: COLORS.textMuted, fontSize: 13, fontFamily: FONT }}>
        No J-curve data available. Re-run simulation to generate cashflow percentile bands.
      </div>
    );
  }

  const selectStyle = {
    background: COLORS.card,
    color: COLORS.textBright,
    border: `1px solid ${COLORS.cardBorder}`,
    borderRadius: 6,
    padding: '6px 12px',
    fontSize: 13,
    fontFamily: FONT,
    cursor: 'pointer',
    minWidth: 90,
  };

  return (
    <div style={{ width: '100%' }}>
      {showControls && (
        <div style={{
          display: 'flex', gap: 16, alignItems: 'center', marginBottom: 12,
          flexWrap: 'wrap',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ color: COLORS.textMuted, fontSize: 12, fontWeight: 600 }}>Upfront %:</span>
            <select value={selectedUpfront} onChange={handleUpfrontChange} style={selectStyle}>
              {availableUpfronts.map(v => (
                <option key={v} value={v}>{(v * 100).toFixed(0)}%</option>
              ))}
            </select>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ color: COLORS.textMuted, fontSize: 12, fontWeight: 600 }}>Tata Tail %:</span>
            <select value={selectedTail} onChange={handleTailChange} style={selectStyle}>
              {availableTails.map(v => (
                <option key={v} value={v}>{(v * 100).toFixed(0)}%</option>
              ))}
            </select>
          </div>
          <span style={{
            color: COLORS.accent3, fontSize: 11, fontWeight: 600,
            background: `${COLORS.accent3}15`, padding: '4px 10px', borderRadius: 6,
          }}>
            Fund keeps {((1 - selectedTail) * 100).toFixed(0)}% of award
          </span>
        </div>
      )}
      <div ref={resizeRef} style={{ width: '100%', height }}>
        <svg ref={svgRef} style={{ width: '100%', height }} />
      </div>
    </div>
  );
}
