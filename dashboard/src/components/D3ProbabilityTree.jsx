/**
 * D3ProbabilityTree.jsx — Horizontal (left → right) probability tree using D3.
 *
 * Uses d3-hierarchy for layout, d3-zoom for pan/zoom, d3-selection for rendering.
 * Data: data.probability_summary.tree_nodes.{domestic,siac}.{scenario_a,scenario_b}
 *   Each tree node: { id, label, prob, children[], outcome?, abs_prob? }
 */

import React, { useRef, useEffect, useState, useMemo } from 'react';
import * as d3 from 'd3';
import { COLORS, FONT, useUISettings, fmtPct } from '../theme';

/* ── outcome palette ── */
const OUTCOME_COLORS = {
  TRUE_WIN: '#10B981',
  RESTART:  '#F59E0B',
  LOSE:     '#EF4444',
};
const OUTCOME_ICONS = { TRUE_WIN: '✓', RESTART: '⟳', LOSE: '✗' };
const OUTCOME_LABELS = { TRUE_WIN: 'Win', RESTART: 'Restart', LOSE: 'Lose' };

/* depth-based border colors */
const DEPTH_COLORS = [
  COLORS.accent1, COLORS.accent2, COLORS.accent3,
  COLORS.accent6, COLORS.accent4, COLORS.accent7,
];

/**
 * Renders a horizontal D3 tree into an SVG container.
 */
export default function D3ProbabilityTree({ treeData, jurisdiction, scenario, height = 600 }) {
  const { ui } = useUISettings();
  const svgRef = useRef(null);
  const containerRef = useRef(null);
  const [tooltipData, setTooltipData] = useState(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });

  // Node sizing
  const nodeW = 170;
  const nodeH = 54;
  const isDomestic = jurisdiction === 'domestic';

  // Build d3 hierarchy
  const root = useMemo(() => {
    if (!treeData) return null;
    const h = d3.hierarchy(treeData, d => d.children);
    return h;
  }, [treeData]);

  useEffect(() => {
    if (!root || !svgRef.current || !containerRef.current) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const containerW = containerRef.current.clientWidth || 900;
    const containerH = height;

    // Set SVG dimensions
    svg.attr('width', containerW).attr('height', containerH);

    // Create tree layout — horizontal: x = vertical position, y = horizontal depth
    const treeLayout = d3.tree()
      .nodeSize([nodeH + 22, nodeW + 80])
      .separation((a, b) => {
        // Give more space to nodes with different parents
        return a.parent === b.parent ? 1.1 : 1.4;
      });

    treeLayout(root);

    // Compute bounds for auto-fit
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    root.each(d => {
      minX = Math.min(minX, d.x);
      maxX = Math.max(maxX, d.x);
      minY = Math.min(minY, d.y);
      maxY = Math.max(maxY, d.y);
    });

    const treeW = (maxY - minY) + nodeW + 120;
    const treeH = (maxX - minX) + nodeH + 60;

    // Auto-fit scale
    const scaleX = containerW / treeW;
    const scaleY = containerH / treeH;
    const fitScale = Math.min(scaleX, scaleY, 1) * 0.92;

    const offsetX = (containerW - treeW * fitScale) / 2 - minY * fitScale + 40;
    const offsetY = (containerH - treeH * fitScale) / 2 - minX * fitScale;

    // Main group that gets transformed — must be created before zoom binding
    const mainGroup = svg.append('g');

    // Create zoom behavior
    const zoomBehavior = d3.zoom()
      .scaleExtent([0.3, 2.5])
      .on('zoom', (event) => {
        mainGroup.attr('transform', event.transform);
      });

    svg.call(zoomBehavior);

    // Set initial transform
    const initialTransform = d3.zoomIdentity
      .translate(offsetX, offsetY)
      .scale(fitScale);
    svg.call(zoomBehavior.transform, initialTransform);

    // Draw glow filter
    const defs = svg.append('defs');
    const filter = defs.append('filter').attr('id', 'nodeGlow')
      .attr('x', '-50%').attr('y', '-50%').attr('width', '200%').attr('height', '200%');
    filter.append('feGaussianBlur').attr('in', 'SourceGraphic').attr('stdDeviation', 5).attr('result', 'blur');
    const merge = filter.append('feMerge');
    merge.append('feMergeNode').attr('in', 'blur');
    merge.append('feMergeNode').attr('in', 'SourceGraphic');

    // Draw links (edges)
    const links = root.links();
    mainGroup.selectAll('.link')
      .data(links)
      .join('path')
      .attr('class', 'link')
      .attr('d', d => {
        const sx = d.source.y + nodeW / 2;
        const sy = d.source.x;
        const tx = d.target.y - nodeW / 2;
        const ty = d.target.x;
        const midX = (sx + tx) / 2;
        return `M ${sx} ${sy} C ${midX} ${sy}, ${midX} ${ty}, ${tx} ${ty}`;
      })
      .attr('fill', 'none')
      .attr('stroke', COLORS.accent1)
      .attr('stroke-width', d => 1.5 + (d.target.data.prob || 0.5) * 3)
      .attr('stroke-opacity', d => 0.3 + (d.target.data.prob || 0.5) * 0.6)
      .attr('stroke-linecap', 'round')
      // draw-in animation
      .each(function() {
        const len = this.getTotalLength();
        d3.select(this)
          .attr('stroke-dasharray', len)
          .attr('stroke-dashoffset', len)
          .transition()
          .duration(900)
          .ease(d3.easeCubicOut)
          .attr('stroke-dashoffset', 0);
      });

    // Probability labels on edges
    mainGroup.selectAll('.edge-label')
      .data(links)
      .join('g')
      .attr('class', 'edge-label')
      .each(function(d) {
        const g = d3.select(this);
        const sx = d.source.y + nodeW / 2;
        const sy = d.source.x;
        const tx = d.target.y - nodeW / 2;
        const ty = d.target.x;
        const mx = (sx + tx) / 2;
        const my = (sy + ty) / 2 - 8;
        const prob = d.target.data.prob;
        if (prob == null) return;

        const text = `${(prob * 100).toFixed(1)}%`;

        // pill background
        g.append('rect')
          .attr('x', mx - 22)
          .attr('y', my - 9)
          .attr('width', 44)
          .attr('height', 18)
          .attr('rx', 9)
          .attr('fill', '#111827')
          .attr('stroke', COLORS.accent2)
          .attr('stroke-width', 0.8)
          .attr('opacity', 0.9);

        g.append('text')
          .attr('x', mx)
          .attr('y', my + 4)
          .attr('text-anchor', 'middle')
          .attr('fill', COLORS.accent2)
          .attr('font-size', 11)
          .attr('font-weight', 700)
          .attr('font-family', FONT)
          .text(text);
      });

    // Draw nodes
    const nodes = root.descendants();
    const nodeGroups = mainGroup.selectAll('.node')
      .data(nodes)
      .join('g')
      .attr('class', 'node')
      .attr('transform', d => `translate(${d.y - nodeW / 2}, ${d.x - nodeH / 2})`)
      .style('cursor', 'pointer');

    // Node background rect
    nodeGroups.append('rect')
      .attr('width', nodeW)
      .attr('height', nodeH)
      .attr('rx', 10)
      .attr('fill', d => {
        const oc = d.data.outcome;
        if (oc) return `${OUTCOME_COLORS[oc]}18`;
        return '#111827';
      })
      .attr('stroke', d => {
        const oc = d.data.outcome;
        if (oc) return OUTCOME_COLORS[oc];
        return DEPTH_COLORS[d.depth % DEPTH_COLORS.length];
      })
      .attr('stroke-width', 1.5);

    // Terminal node icon badge
    nodeGroups.filter(d => !!d.data.outcome)
      .each(function(d) {
        const g = d3.select(this);
        const oc = d.data.outcome;
        const color = OUTCOME_COLORS[oc];

        g.append('circle')
          .attr('cx', nodeW - 14)
          .attr('cy', 14)
          .attr('r', 10)
          .attr('fill', color)
          .attr('opacity', 0.9);

        g.append('text')
          .attr('x', nodeW - 14)
          .attr('y', 18)
          .attr('text-anchor', 'middle')
          .attr('fill', '#fff')
          .attr('font-size', 13)
          .attr('font-weight', 800)
          .attr('font-family', FONT)
          .text(OUTCOME_ICONS[oc]);
      });

    // Node label text
    nodeGroups.each(function(d) {
      const g = d3.select(this);
      const lines = (d.data.label || '').split('\n');
      const isTerminal = !!d.data.outcome;

      lines.forEach((line, i) => {
        g.append('text')
          .attr('x', nodeW / 2)
          .attr('y', nodeH / 2 + (i - (lines.length - 1) / 2) * 15)
          .attr('text-anchor', 'middle')
          .attr('dominant-baseline', 'central')
          .attr('fill', i === 0 ? COLORS.textMuted : COLORS.textBright)
          .attr('font-size', i === 0 ? 12 : 13)
          .attr('font-weight', i === 0 ? 600 : 700)
          .attr('font-family', FONT)
          .text(line);
      });

      // Absolute probability below terminal nodes
      if (isTerminal && d.data.abs_prob != null) {
        const oc = OUTCOME_COLORS[d.data.outcome];
        g.append('text')
          .attr('x', nodeW / 2)
          .attr('y', nodeH + 14)
          .attr('text-anchor', 'middle')
          .attr('fill', oc)
          .attr('font-size', 12)
          .attr('font-weight', 700)
          .attr('font-family', FONT)
          .text(`P = ${(d.data.abs_prob * 100).toFixed(2)}%`);
      }
    });

    // Hover effects
    nodeGroups
      .on('mouseenter', function(event, d) {
        d3.select(this).select('rect')
          .attr('filter', 'url(#nodeGlow)')
          .attr('stroke-width', 2.5);

        const rect = containerRef.current.getBoundingClientRect();
        setTooltipData(d.data);
        setTooltipPos({
          x: event.clientX - rect.left + 12,
          y: event.clientY - rect.top - 10,
        });
      })
      .on('mouseleave', function() {
        d3.select(this).select('rect')
          .attr('filter', null)
          .attr('stroke-width', 1.5);
        setTooltipData(null);
      });

    // Double-click to reset view
    svg.on('dblclick.zoom', () => {
      svg.transition().duration(500).call(zoomBehavior.transform, initialTransform);
    });

  }, [root, height, jurisdiction, nodeW, nodeH]);

  if (!treeData) {
    return <div style={{ color: COLORS.textMuted, padding: 20 }}>No tree data available.</div>;
  }

  return (
    <div ref={containerRef} style={{ position: 'relative', width: '100%', height }}>
      <svg ref={svgRef} style={{ width: '100%', height: '100%', background: `radial-gradient(ellipse at 20% 50%, ${COLORS.accent1}08, transparent 70%)`, borderRadius: 8 }} />

      {/* Tooltip overlay */}
      {tooltipData && (
        <div style={{
          position: 'absolute',
          left: tooltipPos.x,
          top: tooltipPos.y,
          pointerEvents: 'none',
          zIndex: 100,
          background: '#1F2937',
          border: `1px solid ${COLORS.cardBorder}`,
          borderRadius: 8,
          padding: '10px 14px',
          fontFamily: FONT,
          maxWidth: 280,
          boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
        }}>
          <div style={{ color: COLORS.textBright, fontSize: 13, fontWeight: 700, marginBottom: 4 }}>
            {tooltipData.label?.replace('\n', ' — ')}
          </div>
          {tooltipData.prob != null && (
            <div style={{ color: COLORS.accent2, fontSize: 12 }}>
              Conditional: {fmtPct(tooltipData.prob)}
            </div>
          )}
          {tooltipData.abs_prob != null && (
            <div style={{ color: COLORS.accent4, fontSize: 12 }}>
              Absolute: {fmtPct(tooltipData.abs_prob)}
            </div>
          )}
          {tooltipData.outcome && (
            <div style={{
              marginTop: 4, display: 'inline-block',
              padding: '2px 8px', borderRadius: 4,
              background: `${OUTCOME_COLORS[tooltipData.outcome]}25`,
              color: OUTCOME_COLORS[tooltipData.outcome],
              fontSize: 12, fontWeight: 700,
            }}>
              {OUTCOME_ICONS[tooltipData.outcome]} {OUTCOME_LABELS[tooltipData.outcome]}
            </div>
          )}
        </div>
      )}

      {/* Controls overlay */}
      <div style={{
        position: 'absolute', top: 10, left: 10,
        display: 'flex', gap: 6, zIndex: 10,
      }}>
        <div style={{
          padding: '5px 10px', borderRadius: 6,
          fontSize: 12, fontFamily: FONT, fontWeight: 600,
          color: COLORS.textMuted, background: '#111827cc',
          border: `1px solid ${COLORS.cardBorder}`,
        }}>
          Scroll to zoom · Drag to pan · Double-click to reset
        </div>
      </div>
    </div>
  );
}
