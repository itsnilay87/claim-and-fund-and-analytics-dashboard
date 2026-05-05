/**
 * BreakdownTreemap.jsx — Sophisticated hierarchical breakdown for portfolio
 * composition. Groups claims by an attribute (jurisdiction, claim_type, …)
 * and renders each claim as a tile sized by SOC.
 *
 * Works for any cardinality:
 *   • 1 group  → tiles fill the canvas, group label shown as overline.
 *   • N groups → group rectangles divided into per-claim tiles, group
 *                label and weight shown on the parent rect.
 *
 * Colors: claims within the same group share a hue family (neon palette);
 * different groups use distinct hues for instant visual separation.
 */

import React, { useMemo } from 'react';
import { ResponsiveContainer, Treemap, Tooltip } from 'recharts';
import { COLORS, FONT, CHART_COLORS, useUISettings, fmtCr } from '../theme';
import { getClaimDisplayName } from '../utils/claimNames';

const prettyKey = (value) =>
  String(value || 'Unknown')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());

/**
 * Build a slightly lighter / darker variant of a hex color for sibling tiles
 * within the same group. Keeps hue, varies lightness via simple HSL nudge.
 */
function shadeHex(hex, amount) {
  const m = hex.replace('#', '').match(/.{2}/g);
  if (!m) return hex;
  const [r, g, b] = m.map((h) => parseInt(h, 16));
  const adj = (v) => Math.max(0, Math.min(255, Math.round(v + amount)));
  return `#${[adj(r), adj(g), adj(b)]
    .map((v) => v.toString(16).padStart(2, '0'))
    .join('')}`;
}

/* ── Custom tile renderer ─────────────────────────────────────── */
function Tile(props) {
  const { x, y, width, height, name, value, fill, totalSOC, group, depth } = props;
  if (width <= 0 || height <= 0) return null;
  const isLeaf = depth === 2;
  const pct = totalSOC > 0 ? (value / totalSOC) * 100 : 0;

  // Skip rendering tiny labels
  const showLabel = isLeaf && width > 70 && height > 36;
  const showSubLabel = isLeaf && width > 110 && height > 60;
  const showGroupLabel = !isLeaf && width > 90 && height > 28;

  return (
    <g>
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        rx={isLeaf ? 4 : 6}
        ry={isLeaf ? 4 : 6}
        style={{
          fill: isLeaf ? fill : 'transparent',
          stroke: isLeaf ? 'rgba(8,9,15,0.85)' : COLORS.cardBorder,
          strokeWidth: isLeaf ? 2 : 1.5,
          cursor: 'pointer',
        }}
      />
      {showGroupLabel && (
        <>
          <text
            x={x + 10}
            y={y + 18}
            fill={COLORS.textBright}
            fontSize={12}
            fontFamily={FONT}
            fontWeight={700}
            style={{ textTransform: 'uppercase', letterSpacing: '0.06em' }}
          >
            {name}
          </text>
          <text
            x={x + width - 10}
            y={y + 18}
            fill={COLORS.textMuted}
            fontSize={11}
            fontFamily={FONT}
            fontWeight={600}
            textAnchor="end"
          >
            {pct.toFixed(1)}%
          </text>
        </>
      )}
      {showLabel && (
        <text
          x={x + width / 2}
          y={y + height / 2 - (showSubLabel ? 8 : 0)}
          textAnchor="middle"
          fill="#08090F"
          fontSize={Math.min(14, Math.max(11, width / 12))}
          fontFamily={FONT}
          fontWeight={800}
          style={{ pointerEvents: 'none' }}
        >
          {name.length > Math.floor(width / 8) ? name.slice(0, Math.floor(width / 8) - 1) + '…' : name}
        </text>
      )}
      {showSubLabel && (
        <>
          <text
            x={x + width / 2}
            y={y + height / 2 + 10}
            textAnchor="middle"
            fill="#08090F"
            fontSize={11}
            fontFamily={FONT}
            fontWeight={700}
            opacity={0.85}
            style={{ pointerEvents: 'none' }}
          >
            {fmtCr(value)}
          </text>
          <text
            x={x + width / 2}
            y={y + height / 2 + 24}
            textAnchor="middle"
            fill="#08090F"
            fontSize={10}
            fontFamily={FONT}
            fontWeight={600}
            opacity={0.7}
            style={{ pointerEvents: 'none' }}
          >
            {pct.toFixed(1)}% · {prettyKey(group)}
          </text>
        </>
      )}
    </g>
  );
}

/* ── Tooltip ──────────────────────────────────────────────────── */
function TreemapTooltip({ active, payload, totalSOC }) {
  if (!active || !payload || !payload.length) return null;
  const p = payload[0]?.payload || {};
  if (p.depth !== 2) return null;
  const pct = totalSOC > 0 ? (p.value / totalSOC) * 100 : 0;
  return (
    <div
      style={{
        background: COLORS.card,
        border: `1px solid ${COLORS.cardBorder}`,
        borderRadius: 8,
        padding: '10px 12px',
        fontFamily: FONT,
        boxShadow: '0 8px 24px rgba(0,0,0,0.6)',
      }}
    >
      <div style={{ color: COLORS.textBright, fontSize: 13, fontWeight: 700, marginBottom: 4 }}>
        {p.name}
      </div>
      <div style={{ color: COLORS.textMuted, fontSize: 11, marginBottom: 6 }}>
        {prettyKey(p.group)}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 18 }}>
        <span style={{ color: COLORS.textMuted, fontSize: 12 }}>SOC</span>
        <span style={{ color: COLORS.accent1, fontSize: 13, fontWeight: 700 }}>{fmtCr(p.value)}</span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 18 }}>
        <span style={{ color: COLORS.textMuted, fontSize: 12 }}>Weight</span>
        <span style={{ color: COLORS.accent4, fontSize: 13, fontWeight: 700 }}>{pct.toFixed(2)}%</span>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
 *  Main component
 * ═══════════════════════════════════════════════════════════════ */
export default function BreakdownTreemap({
  claims = [],
  groupBy = 'jurisdiction',
  height = 280,
  emptyText = 'No data available.',
}) {
  const { ui } = useUISettings();

  const { tree, totalSOC, groupCount } = useMemo(() => {
    const total = claims.reduce((s, c) => s + Number(c?.soc_value_cr || 0), 0);
    if (total <= 0 || claims.length === 0) {
      return { tree: [], totalSOC: 0, groupCount: 0 };
    }

    // Group claims by attribute
    const groups = new Map();
    for (const c of claims) {
      const key = String(c?.[groupBy] || 'unknown').trim() || 'unknown';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(c);
    }

    // Sort groups by total SOC desc for stable layout
    const sorted = [...groups.entries()].sort(
      (a, b) =>
        b[1].reduce((s, c) => s + Number(c.soc_value_cr || 0), 0) -
        a[1].reduce((s, c) => s + Number(c.soc_value_cr || 0), 0),
    );

    const root = sorted.map(([groupKey, groupClaims], gi) => {
      const baseColor = CHART_COLORS[gi % CHART_COLORS.length];
      // Sort claims within group, biggest first
      const ordered = [...groupClaims].sort(
        (a, b) => Number(b.soc_value_cr || 0) - Number(a.soc_value_cr || 0),
      );
      const children = ordered.map((c, ci) => {
        // Vary shade per sibling (–18, +12, –30, +24, …)
        const nudge = ci === 0 ? 0 : ((ci % 2 === 0 ? 1 : -1) * (18 + Math.floor(ci / 2) * 14));
        return {
          name: getClaimDisplayName(c),
          size: Math.max(0.0001, Number(c.soc_value_cr || 0)),
          value: Number(c.soc_value_cr || 0),
          fill: shadeHex(baseColor, nudge),
          group: groupKey,
        };
      });
      return {
        name: prettyKey(groupKey),
        groupKey,
        children,
      };
    });

    return { tree: root, totalSOC: total, groupCount: sorted.length };
  }, [claims, groupBy]);

  if (tree.length === 0) {
    return (
      <div style={{ color: COLORS.textMuted, padding: 40, textAlign: 'center' }}>
        {emptyText}
      </div>
    );
  }

  return (
    <div>
      {/* Group legend */}
      {groupCount > 1 && (
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 10,
            marginBottom: 10,
          }}
        >
          {tree.map((g, i) => {
            const total = g.children.reduce((s, c) => s + c.value, 0);
            const pct = totalSOC > 0 ? (total / totalSOC) * 100 : 0;
            return (
              <div
                key={g.groupKey}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '4px 10px',
                  borderRadius: 999,
                  background: 'rgba(255,255,255,0.03)',
                  border: `1px solid ${COLORS.cardBorder}`,
                  fontSize: 11,
                  fontFamily: FONT,
                  color: COLORS.text,
                }}
              >
                <span
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 2,
                    background: CHART_COLORS[i % CHART_COLORS.length],
                  }}
                />
                <span style={{ fontWeight: 700 }}>{g.name}</span>
                <span style={{ color: COLORS.textMuted }}>
                  · {g.children.length} · {pct.toFixed(1)}%
                </span>
              </div>
            );
          })}
        </div>
      )}
      <ResponsiveContainer width="100%" height={height}>
        <Treemap
          data={tree}
          dataKey="size"
          stroke="#08090F"
          fill={COLORS.accent1}
          isAnimationActive={false}
          content={<Tile totalSOC={totalSOC} />}
        >
          <Tooltip content={<TreemapTooltip totalSOC={totalSOC} />} />
        </Treemap>
      </ResponsiveContainer>
    </div>
  );
}
