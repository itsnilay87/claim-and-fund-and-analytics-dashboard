/**
 * ProbabilityTree.jsx — SVG-based interactive probability tree visualization.
 *
 * Renders hierarchical decision trees for domestic (S.34→S.37→SLP→Merits),
 * SIAC (HC→COA), and HKIAC (CFI→CA→CFA) litigation paths with animated transitions.
 *
 * Data: data.probability_summary.tree_nodes.{domestic,siac,hkiac}.{scenario_a,scenario_b}
 */

import React, { useState, useMemo, useRef, useEffect } from 'react';
import { COLORS, FONT, SIZES, SPACE, useUISettings, fmtPct } from '../theme';
import { Card, SectionTitle, KPI } from './Shared';

/* ─── outcome colors ─── */
const OUTCOME_COLORS = {
  TRUE_WIN:  '#10B981',
  RESTART:   '#F59E0B',
  LOSE:      '#EF4444',
};
const OUTCOME_LABELS = {
  TRUE_WIN: 'Win',
  RESTART:  'Restart',
  LOSE:     'Lose',
};
const OUTCOME_ICONS = {
  TRUE_WIN: '✓',
  RESTART:  '⟳',
  LOSE:     '✗',
};

/* ─── Tree layout engine (overlap-free, bottom-up sizing) ─── */
function layoutTree(root, config) {
  const {
    nodeW = 130, nodeH = 48, gapX = 55, gapY = 18,
    leafPadding = 22,   // extra space below terminal nodes for P= label
  } = config || {};

  /**
   * Phase 1 — bottom-up: compute the MINIMUM height each subtree requires
   * so that no node overlaps.  Every leaf needs nodeH + leafPadding;
   * every internal node is the sum of its children's minH + inter-child gaps.
   */
  function computeMinHeight(node) {
    if (!node.children || node.children.length === 0) {
      node._minH = nodeH + leafPadding;
      return node._minH;
    }
    let sum = 0;
    for (const c of node.children) {
      sum += computeMinHeight(c);
    }
    sum += (node.children.length - 1) * gapY;
    node._minH = Math.max(nodeH + leafPadding, sum);
    return node._minH;
  }
  computeMinHeight(root);

  const positions = [];
  const edges = [];

  /**
   * Phase 2 — top-down: lay out each node within its allocated vertical band
   * [yMin, yMax].  Children receive at least their _minH; any surplus is
   * distributed proportionally to probability so that high-prob branches
   * get more breathing room (but never less than their minimum).
   */
  function layout(node, x, yMin, yMax, depth) {
    const cy = (yMin + yMax) / 2;
    positions.push({ node, x, y: cy - nodeH / 2, w: nodeW, h: nodeH, depth });

    if (!node.children || node.children.length === 0) return;

    const childX = x + nodeW + gapX;
    const nChildren = node.children.length;
    const totalGap = (nChildren - 1) * gapY;
    const available = yMax - yMin - totalGap;

    // Base allocation = each child's minimum height
    const minHeights = node.children.map(c => c._minH);
    const totalMin = minHeights.reduce((a, b) => a + b, 0);

    // Surplus above the minimum — distribute proportionally to probability
    const surplus = Math.max(0, available - totalMin);
    const weights = node.children.map(c => Math.max(0.15, c.prob || 0.5));
    const wSum = weights.reduce((a, b) => a + b, 0);

    let cursor = yMin;
    for (let ci = 0; ci < nChildren; ci++) {
      const child = node.children[ci];
      const childH = minHeights[ci] + (wSum > 0 ? surplus * weights[ci] / wSum : 0);
      layout(child, childX, cursor, cursor + childH, depth + 1);
      edges.push({
        x1: x + nodeW,
        y1: cy,
        x2: childX,
        y2: cursor + childH / 2,
        prob: child.prob,
      });
      cursor += childH + gapY;
    }
  }

  const totalH = root._minH;
  layout(root, 30, 0, totalH, 0);

  const maxX = Math.max(...positions.map(p => p.x + p.w));
  const maxY = Math.max(...positions.map(p => p.y + p.h));

  return { positions, edges, width: maxX + 60, height: maxY + 30 };
}

/* ─── animated edge path ─── */
function TreeEdge({ x1, y1, x2, y2, prob, animate, showLabel, onHoverStart, onHoverEnd }) {
  const midX = (x1 + x2) / 2;
  const d = `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`;
  const opacity = 0.3 + prob * 0.7;
  const width = 1 + prob * 3;

  return (
    <g>
      <path d={d} fill="none" stroke={COLORS.accent1} strokeWidth={width} opacity={opacity}
        strokeLinecap="round"
        onMouseEnter={onHoverStart}
        onMouseLeave={onHoverEnd}
        style={animate ? {
          strokeDasharray: 1000,
          strokeDashoffset: 1000,
          animation: 'drawLine 1.2s ease-out forwards',
        } : {}} />
      {/* probability label on edge */}
      {showLabel && (
        <text x={midX} y={(y1 + y2) / 2 - 6} fill={COLORS.accent2}
          fontSize={SIZES.sm} fontWeight={700} textAnchor="middle" fontFamily={FONT}>
          {fmtPct(prob)}
        </text>
      )}
    </g>
  );
}

/* ─── node component ─── */
function TreeNode({ node, x, y, w, h, depth, hoveredId, setHoveredId }) {
  const isTerminal = !!(node.outcome);
  const isHovered = hoveredId === node.id;
  const outcomeColor = isTerminal ? OUTCOME_COLORS[node.outcome] || COLORS.textMuted : null;

  // Node gradient based on depth
  const depthColors = [
    COLORS.accent1, COLORS.accent2, COLORS.accent3,
    COLORS.accent6, COLORS.accent4,
  ];
  const borderColor = isTerminal ? outcomeColor : depthColors[depth % depthColors.length];

  const lines = (node.label || '').split('\n');

  return (
    <g
      onMouseEnter={() => setHoveredId(node.id)}
      onMouseLeave={() => setHoveredId(null)}
      style={{ cursor: 'pointer' }}
    >
      {/* glow on hover */}
      {isHovered && (
        <rect x={x - 3} y={y - 3} width={w + 6} height={h + 6} rx={14}
          fill="none" stroke={borderColor} strokeWidth={2} opacity={0.4}
          filter="url(#glow)" />
      )}

      {/* main rect */}
      <rect x={x} y={y} width={w} height={h} rx={10}
        fill={isTerminal ? `${outcomeColor}18` : '#111827'}
        stroke={borderColor} strokeWidth={isHovered ? 2.5 : 1.5}
        opacity={isHovered ? 1 : 0.9} />

      {/* terminal icon badge */}
      {isTerminal && (
        <g>
          <circle cx={x + w - 12} cy={y + 12} r={10} fill={outcomeColor} opacity={0.9} />
          <text x={x + w - 12} y={y + 16} fill="#fff" fontSize={SIZES.sm} fontWeight={800}
            textAnchor="middle" fontFamily={FONT}>
            {OUTCOME_ICONS[node.outcome]}
          </text>
        </g>
      )}

      {/* label */}
      {lines.map((line, i) => (
        <text key={i} x={x + w / 2} y={y + (h / 2) + (i - (lines.length - 1) / 2) * 14}
          fill={i === 0 ? COLORS.textMuted : COLORS.textBright}
          fontSize={i === 0 ? SIZES.sm : SIZES.md} fontWeight={i === 0 ? 600 : 700}
          textAnchor="middle" fontFamily={FONT}>
          {line}
        </text>
      ))}

      {/* absolute prob for terminal nodes */}
      {isTerminal && node.abs_prob != null && (
        <text x={x + w / 2} y={y + h + 14} fill={outcomeColor}
          fontSize={SIZES.sm} fontWeight={700} textAnchor="middle" fontFamily={FONT}>
          P = {(node.abs_prob * 100).toFixed(2)}%
        </text>
      )}
    </g>
  );
}

/* ─── SVG filter for glow ─── */
function SvgDefs() {
  return (
    <defs>
      <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur in="SourceGraphic" stdDeviation="4" result="blur" />
        <feMerge>
          <feMergeNode in="blur" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
      <style>{`
        @keyframes drawLine {
          to { stroke-dashoffset: 0; }
        }
      `}</style>
    </defs>
  );
}

/* ─── main component ─── */
export default function ProbabilityTree({ data }) {
  const { ui } = useUISettings();
  const probData = data?.probability_summary;
  const treeNodes = probData?.tree_nodes;

  const [jurisdiction, setJurisdiction] = useState('domestic');
  const [scenario, setScenario] = useState('scenario_a');
  const [viewMode, setViewMode] = useState('overview');
  const [hoveredId, setHoveredId] = useState(null);
  const [hoveredEdgeIndex, setHoveredEdgeIndex] = useState(null);
  const [animate, setAnimate] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [fitScale, setFitScale] = useState(1);
  const [containerHeight, setContainerHeight] = useState(520);
  const containerRef = useRef(null);

  // Trigger re-animation on tree change
  useEffect(() => {
    setAnimate(false);
    const t = setTimeout(() => setAnimate(true), 50);
    return () => clearTimeout(t);
  }, [jurisdiction, scenario]);

  if (!probData || !treeNodes) {
    return <Card><SectionTitle title="No Probability Tree Data" subtitle="Tree nodes not found in dataset." /></Card>;
  }

  const currentTree = treeNodes[jurisdiction]?.[scenario];

  if (!currentTree) {
    return <Card><SectionTitle title="Tree Not Available" subtitle={`No tree for ${jurisdiction} / ${scenario}.`} /></Card>;
  }

  const layoutConfig = jurisdiction === 'domestic'
    ? { nodeW: 120, nodeH: 46, gapX: 50, gapY: 16, leafPadding: 24 }
    : jurisdiction === 'hkiac'
    ? { nodeW: 120, nodeH: 46, gapX: 50, gapY: 16, leafPadding: 24 }
    : { nodeW: 130, nodeH: 50, gapX: 60, gapY: 20, leafPadding: 24 };
  const { positions, edges, width: svgW, height: svgH } = useMemo(
    () => layoutTree(currentTree, layoutConfig),
    [currentTree, jurisdiction]
  );

  useEffect(() => {
    function updateContainerHeight() {
      const vh = typeof window !== 'undefined' ? window.innerHeight : 900;
      const target = Math.max(480, Math.min(820, Math.round(vh * 0.72)));
      setContainerHeight(target);
    }
    updateContainerHeight();
    if (typeof window !== 'undefined') {
      window.addEventListener('resize', updateContainerHeight);
      return () => window.removeEventListener('resize', updateContainerHeight);
    }
  }, []);

  useEffect(() => {
    if (viewMode !== 'overview') return;
    const node = containerRef.current;
    if (!node) return;
    const fit = () => {
      const availableW = Math.max(320, node.clientWidth - 24);
      const availableH = Math.max(260, containerHeight - 24);
      const scaleW = availableW / (svgW + 20);
      const scaleH = availableH / (svgH + 40);
      const scale = Math.max(0.35, Math.min(scaleW, scaleH, 1));
      setFitScale(scale);
    };
    fit();
    if (typeof window !== 'undefined') {
      window.addEventListener('resize', fit);
      return () => window.removeEventListener('resize', fit);
    }
  }, [viewMode, svgW, svgH, containerHeight, jurisdiction, scenario]);

  const activeScale = viewMode === 'overview' ? fitScale : zoom;

  // Collect terminal nodes for summary
  const terminals = positions.filter(p => p.node.outcome);
  const totalWinProb = terminals
    .filter(p => p.node.outcome === 'TRUE_WIN')
    .reduce((s, p) => s + (p.node.abs_prob || 0), 0);
  const totalLoseProb = terminals
    .filter(p => p.node.outcome === 'LOSE')
    .reduce((s, p) => s + (p.node.abs_prob || 0), 0);
  const totalRestartProb = terminals
    .filter(p => p.node.outcome === 'RESTART')
    .reduce((s, p) => s + (p.node.abs_prob || 0), 0);

  const jurisdictionTitle = jurisdiction === 'domestic' ? 'Domestic' : jurisdiction === 'hkiac' ? 'HKIAC' : 'SIAC';
  const jurisdictionSubtitle = jurisdiction === 'domestic'
    ? 'Arbitration → S.34 Appeal → S.37 Appeal → SLP Gate → SLP Merits'
    : jurisdiction === 'hkiac'
    ? 'Arbitration → CFI → Court of Appeal → CFA Leave → CFA Merits'
    : 'Arbitration → High Court → Court of Appeal';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: ui.space.xl }}>
      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: ui.space.md }}>
        <KPI label="Arb Win Prob" value={fmtPct(probData.arb_win_probability)} color={COLORS.accent4} />
        <KPI label="P(True Win)" value={fmtPct(totalWinProb)} color={OUTCOME_COLORS.TRUE_WIN} />
        <KPI label="P(Restart)" value={fmtPct(totalRestartProb)} color={OUTCOME_COLORS.RESTART} />
        <KPI label="P(Lose)" value={fmtPct(totalLoseProb)} color={OUTCOME_COLORS.LOSE} />
        <KPI label="Terminal Nodes" value={terminals.length} color={COLORS.accent6} />
      </div>

      {/* Toggle: Jurisdiction + Scenario */}
      <div style={{ display: 'flex', gap: ui.space.lg, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: ui.space.sm }}>
          <span style={{ color: COLORS.textMuted, fontSize: ui.sizes.sm, fontWeight: 600, lineHeight: '36px' }}>Jurisdiction:</span>
          {[
            { key: 'domestic', label: 'Domestic (S.34→SLP)' },
            { key: 'siac', label: 'SIAC (HC→COA)' },
            { key: 'hkiac', label: 'HKIAC (CFI→CFA)' },
          ].map(j => (
            <button key={j.key} onClick={() => setJurisdiction(j.key)} style={{
              padding: '8px 16px', borderRadius: 8, border: 'none', cursor: 'pointer',
              fontFamily: FONT, fontSize: ui.sizes.sm, fontWeight: jurisdiction === j.key ? 700 : 500,
              color: jurisdiction === j.key ? '#fff' : COLORS.textMuted,
              background: jurisdiction === j.key ? COLORS.gradient1 : COLORS.card,
            }}>
              {j.label}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: ui.space.sm }}>
          <span style={{ color: COLORS.textMuted, fontSize: ui.sizes.sm, fontWeight: 600, lineHeight: '36px' }}>Scenario:</span>
          {[
            { key: 'scenario_a', label: 'A: TATA Wins Arb' },
            { key: 'scenario_b', label: 'B: TATA Loses Arb' },
          ].map(s => (
            <button key={s.key} onClick={() => setScenario(s.key)} style={{
              padding: '8px 16px', borderRadius: 8, border: 'none', cursor: 'pointer',
              fontFamily: FONT, fontSize: ui.sizes.sm, fontWeight: scenario === s.key ? 700 : 500,
              color: scenario === s.key ? '#fff' : COLORS.textMuted,
              background: scenario === s.key
                ? (s.key === 'scenario_a' ? COLORS.accent4 + 'CC' : COLORS.accent5 + 'CC')
                : COLORS.card,
            }}>
              {s.label}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: ui.space.sm, marginLeft: 'auto' }}>
          {[
            { key: 'overview', label: 'Overview' },
            { key: 'detail', label: 'Detail' },
          ].map((mode) => (
            <button key={mode.key} onClick={() => setViewMode(mode.key)} style={{
              padding: '8px 14px', borderRadius: 8, border: 'none', cursor: 'pointer',
              fontFamily: FONT, fontSize: ui.sizes.sm, fontWeight: viewMode === mode.key ? 700 : 500,
              color: viewMode === mode.key ? '#fff' : COLORS.textMuted,
              background: viewMode === mode.key ? COLORS.gradient1 : COLORS.card,
            }}>
              {mode.label}
            </button>
          ))}
        </div>
      </div>

      {/* SVG Tree */}
      <Card>
        <SectionTitle number="1"
          title={`${jurisdictionTitle} Decision Tree — Scenario ${scenario === 'scenario_a' ? 'A' : 'B'}`}
          subtitle={jurisdictionSubtitle}
        />
        <div ref={containerRef} style={{
          overflowX: viewMode === 'detail' ? 'auto' : 'hidden',
          overflowY: viewMode === 'detail' ? 'auto' : 'hidden',
          maxHeight: containerHeight,
          minHeight: Math.min(520, containerHeight),
          padding: '16px 0',
          background: `radial-gradient(ellipse at 20% 50%, ${COLORS.accent1}08, transparent 70%)`,
          borderRadius: 8,
          position: 'relative',
        }}>
          {/* Zoom/fit controls */}
          <div style={{ position: 'sticky', top: 8, left: 8, zIndex: 10, display: 'flex', gap: 4, marginBottom: 8 }}>
            {viewMode === 'overview' ? (
              <span style={{
                padding: '6px 10px', borderRadius: 6,
                fontSize: ui.sizes.sm, fontFamily: FONT, fontWeight: 600,
                color: COLORS.textMuted, background: COLORS.card,
              }}>
                Auto-fit: {(activeScale * 100).toFixed(0)}%
              </span>
            ) : (
              <>
                <button onClick={() => setZoom((z) => Math.max(0.6, z - 0.1))} style={{
                  padding: '4px 10px', borderRadius: 6, border: 'none', cursor: 'pointer',
                  fontSize: ui.sizes.sm, fontFamily: FONT, fontWeight: 700,
                  color: COLORS.textMuted, background: COLORS.card,
                }}>−</button>
                <button onClick={() => setZoom(1)} style={{
                  padding: '4px 10px', borderRadius: 6, border: 'none', cursor: 'pointer',
                  fontSize: ui.sizes.sm, fontFamily: FONT, fontWeight: 600,
                  color: COLORS.textMuted, background: COLORS.card,
                }}>100%</button>
                <button onClick={() => setZoom((z) => Math.min(1.8, z + 0.1))} style={{
                  padding: '4px 10px', borderRadius: 6, border: 'none', cursor: 'pointer',
                  fontSize: ui.sizes.sm, fontFamily: FONT, fontWeight: 700,
                  color: COLORS.textMuted, background: COLORS.card,
                }}>+</button>
              </>
            )}
          </div>
          <div style={{
            width: (svgW + 20) * activeScale,
            height: (svgH + 40) * activeScale,
            minWidth: viewMode === 'detail' ? (svgW + 20) * activeScale : 0,
            margin: viewMode === 'overview' ? '0 auto' : 0,
          }}>
          <svg width={(svgW + 20) * activeScale} height={(svgH + 40) * activeScale} viewBox={`0 0 ${svgW + 20} ${svgH + 40}`}
            style={{ fontFamily: FONT }}>
            <SvgDefs />
            {/* Edges */}
            {edges.map((e, i) => (
              <TreeEdge
                key={i}
                {...e}
                animate={animate}
                showLabel={viewMode === 'detail' || hoveredEdgeIndex === i}
                onHoverStart={() => setHoveredEdgeIndex(i)}
                onHoverEnd={() => setHoveredEdgeIndex(null)}
              />
            ))}
            {/* Nodes */}
            {positions.map((p, i) => (
              <TreeNode key={p.node.id || i} {...p} hoveredId={hoveredId} setHoveredId={setHoveredId} />
            ))}
          </svg>
          </div>
        </div>
      </Card>

      {/* Outcome summary table */}
      <Card>
        <SectionTitle number="2" title="Terminal Outcome Summary"
          subtitle="All terminal paths with absolute probability and outcome classification." />
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 2, fontFamily: FONT }}>
            <thead>
              <tr>
                {['Path ID', 'Outcome', 'Absolute Probability', 'Visual'].map(h => (
                  <th key={h} style={{
                    padding: '12px 16px', color: COLORS.textMuted, fontSize: SIZES.sm,
                    fontWeight: 700, textAlign: h === 'Visual' ? 'left' : 'center',
                    textTransform: 'uppercase', borderBottom: `1px solid ${COLORS.cardBorder}`,
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {terminals
                .sort((a, b) => (b.node.abs_prob || 0) - (a.node.abs_prob || 0))
                .map((t, i) => {
                  const n = t.node;
                  const oc = OUTCOME_COLORS[n.outcome] || COLORS.textMuted;
                  const barWidth = Math.max(4, (n.abs_prob || 0) * 300);
                  return (
                    <tr key={i} style={{ background: i % 2 === 0 ? 'transparent' : '#ffffff05' }}>
                      <td style={{ padding: '10px 16px', color: COLORS.textBright, fontSize: SIZES.sm, fontWeight: 600, textAlign: 'center' }}>{n.id}</td>
                      <td style={{ padding: '10px 16px', textAlign: 'center' }}>
                        <span style={{
                          display: 'inline-block', padding: '3px 10px', borderRadius: 6,
                          background: `${oc}25`, color: oc, fontSize: SIZES.sm, fontWeight: 700,
                        }}>
                          {OUTCOME_ICONS[n.outcome]} {OUTCOME_LABELS[n.outcome]}
                        </span>
                      </td>
                      <td style={{ padding: '10px 16px', color: COLORS.text, fontSize: SIZES.base, fontWeight: 700, textAlign: 'center' }}>
                        {((n.abs_prob || 0) * 100).toFixed(2)}%
                      </td>
                      <td style={{ padding: '10px 16px' }}>
                        <div style={{
                          height: 10, width: barWidth, borderRadius: 5,
                          background: `linear-gradient(90deg, ${oc}, ${oc}60)`,
                        }} />
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Legend */}
      <div style={{ display: 'flex', justifyContent: 'center', gap: ui.space.xxl, padding: 12 }}>
        {Object.entries(OUTCOME_COLORS).map(([key, color]) => (
          <div key={key} style={{ display: 'flex', alignItems: 'center', gap: ui.space.sm }}>
            <div style={{
              width: 20, height: 20, borderRadius: 6,
              background: `${color}30`, border: `2px solid ${color}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color, fontSize: ui.sizes.sm, fontWeight: 800, fontFamily: FONT,
            }}>
              {OUTCOME_ICONS[key]}
            </div>
            <span style={{ color: COLORS.textMuted, fontSize: ui.sizes.sm, fontWeight: 600 }}>{OUTCOME_LABELS[key]}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
