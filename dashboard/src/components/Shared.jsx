/**
 * Shared.jsx — Reusable UI components matching dark theme.
 * v2: Enhanced typography, tooltips, card hover, skeleton loading, divider, count-up.
 */

import React, { useState, useEffect, useRef, Component } from 'react';
import { COLORS, FONT, SIZES, SPACE, SHARED_TEXT_TOKENS, useUISettings, fmtCr, fmtPct, fmtMOIC, fmtMo } from '../theme';

/* ── ErrorBoundary ── */
export class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 40, textAlign: 'center', color: COLORS.textMuted, fontFamily: FONT }}>
          <h3 style={{ color: COLORS.loss }}>Something went wrong{this.props.label ? ` in ${this.props.label}` : ''}</h3>
          <pre style={{ fontSize: 12, opacity: 0.7, whiteSpace: 'pre-wrap' }}>{this.state.error.message}</pre>
        </div>
      );
    }
    return this.props.children;
  }
}

/* ── Card ── */
export function Card({ children, style, onClick }) {
  const { ui } = useUISettings();
  const [hovered, setHovered] = useState(false);
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: COLORS.card,
        border: `1px solid ${hovered ? COLORS.accent1 + '60' : COLORS.cardBorder}`,
        borderRadius: 12,
        padding: ui.cardPadding,
        transition: 'all 0.25s ease',
        transform: hovered ? 'translateY(-2px)' : 'translateY(0)',
        boxShadow: hovered ? '0 8px 24px rgba(0,0,0,0.25)' : 'none',
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/* ── Section Divider ── */
export function Divider({ style }) {
  const { ui } = useUISettings();
  return (
    <hr style={{
      border: 'none',
      borderTop: `1px solid ${COLORS.cardBorder}`,
      opacity: 0.4,
      margin: `${ui.space.sm}px 0`,
      ...style,
    }} />
  );
}

/* ── Section Title ── */
export function SectionTitle({ number, title, subtitle }) {
  const { ui } = useUISettings();
  return (
    <div style={{ marginBottom: ui.space.xl - 4 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: ui.space.md, marginBottom: 6 }}>
        {number && (
          <div style={{
            width: 28, height: 28, borderRadius: 14,
            background: COLORS.gradient1,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#fff', fontSize: ui.sizes.md, fontWeight: 800,
            flexShrink: 0,
          }}>
            {number}
          </div>
        )}
        <h3 style={{
          fontSize: Math.max(SHARED_TEXT_TOKENS.title.fontSize, ui.sizes.lg), fontWeight: SHARED_TEXT_TOKENS.title.fontWeight, color: COLORS.textBright,
          fontFamily: FONT, margin: 0,
        }}>
          {title}
        </h3>
      </div>
      {subtitle && (
        <p style={{
          fontSize: Math.max(SHARED_TEXT_TOKENS.subtitle.fontSize, ui.sizes.md), color: COLORS.textMuted,
          fontFamily: FONT, margin: 0, paddingLeft: number ? 40 : 0,
          lineHeight: 1.5,
        }}>
          {subtitle}
        </p>
      )}
    </div>
  );
}

/* ── KPI Box ── */
export function KPI({ label, value, sub, color, style }) {
  const { ui } = useUISettings();
  return (
    <div style={{
      textAlign: 'center', padding: `${ui.space.lg}px ${ui.space.sm}px`,
      background: `${color || COLORS.accent1}10`,
      borderRadius: 10, minWidth: 120,
      ...style,
    }}>
      <div style={{
        color: COLORS.textMuted, fontSize: Math.max(SHARED_TEXT_TOKENS.kpiLabel.fontSize, ui.sizes.sm), fontWeight: SHARED_TEXT_TOKENS.kpiLabel.fontWeight,
        textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6,
      }}>
        {label}
      </div>
      <div style={{ color: color || COLORS.accent1, fontSize: ui.sizes.xxl, fontWeight: 800, fontFamily: FONT }}>
        {value}
      </div>
      {sub && (
        <div style={{ color: COLORS.textMuted, fontSize: Math.max(SHARED_TEXT_TOKENS.kpiSub.fontSize, ui.sizes.sm), marginTop: 4 }}>
          {sub}
        </div>
      )}
    </div>
  );
}

/* ── Custom Tooltip for Recharts — Enhanced ── */
export function CustomTooltip({ active, payload, label }) {
  const { ui } = useUISettings();
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div style={{
      background: '#1F2937',
      borderRadius: 10,
      padding: '14px 18px',
      fontFamily: FONT,
      boxShadow: '0 4px 20px rgba(0,0,0,0.35)',
      borderLeft: `3px solid ${payload[0]?.color || COLORS.accent1}`,
      maxWidth: 320,
    }}>
      <div style={{ color: COLORS.textBright, fontSize: ui.sizes.md, fontWeight: 700, marginBottom: 8 }}>
        {label}
      </div>
      {payload.map((p, i) => {
        let formatted = p.value;
        const n = (p.dataKey || '').toLowerCase();
        if (n.includes('moic')) formatted = fmtMOIC(p.value);
        else if (n.includes('pct') || n.includes('loss') || n.includes('prob') || n.includes('irr') || n.includes('rate') || n.includes('ploss'))
          formatted = typeof p.value === 'number' && Math.abs(p.value) < 5 ? fmtPct(p.value) : `${p.value?.toFixed?.(1) ?? p.value}%`;
        else if (n.includes('cr') || n.includes('inv') || n.includes('return') || n.includes('cost'))
          formatted = fmtCr(p.value);
        else if (n.includes('month') || n.includes('dur'))
          formatted = fmtMo(p.value);
        else if (typeof p.value === 'number')
          formatted = p.value.toLocaleString('en-IN', { maximumFractionDigits: 2 });

        return (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <div style={{
              width: 10, height: 10, borderRadius: '50%',
              background: p.color || COLORS.accent1,
              flexShrink: 0,
            }} />
            <span style={{ color: COLORS.textMuted, fontSize: ui.sizes.sm, letterSpacing: '0.02em' }}>
              {p.name || p.dataKey}:
            </span>
            <span style={{ color: COLORS.textBright, fontSize: ui.sizes.md, fontWeight: 600, marginLeft: 'auto' }}>
              {formatted}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/* ── Badge ── */
export function Badge({ text, color, bg }) {
  const { ui } = useUISettings();
  return (
    <span style={{
      background: bg || `${color}20`,
      color: color || COLORS.accent1,
      padding: '3px 10px',
      borderRadius: 4,
      fontSize: ui.sizes.sm,
      fontWeight: 700,
    }}>
      {text}
    </span>
  );
}

/* ── Table with dark styling ── */
export function DataTable({ headers, rows, style }) {
  const { ui } = useUISettings();
  return (
    <div style={{ overflowX: 'auto', ...style }}>
      <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 2, fontFamily: FONT }}>
        <thead>
          <tr>
            {headers.map((h, i) => (
              <th key={i} style={{
                padding: '12px 16px',
                color: COLORS.textMuted,
                fontSize: Math.max(SHARED_TEXT_TOKENS.tableHeader.fontSize, ui.sizes.sm),
                fontWeight: SHARED_TEXT_TOKENS.tableHeader.fontWeight,
                textAlign: 'center',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                borderBottom: `1px solid ${COLORS.cardBorder}`,
              }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri} style={{ background: ri % 2 === 0 ? 'transparent' : '#ffffff05' }}>
              {row.map((cell, ci) => (
                <td key={ci} style={{
                  padding: '10px 16px',
                  textAlign: 'center',
                  fontSize: Math.max(SHARED_TEXT_TOKENS.tableCell.fontSize, ui.sizes.base),
                  fontWeight: SHARED_TEXT_TOKENS.tableCell.fontWeight,
                  color: COLORS.text,
                }}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ── Tab bar ── */
export function TabBar({ tabs, active, onChange }) {
  const { ui } = useUISettings();
  return (
    <div style={{
      display: 'flex', flexWrap: 'wrap', gap: 4,
      background: '#0F1219', borderRadius: 10, padding: 4,
      border: `1px solid ${COLORS.cardBorder}`,
    }}>
      {tabs.map((t) => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          style={{
            padding: '10px 18px',
            borderRadius: 8,
            border: 'none',
            cursor: 'pointer',
            fontFamily: FONT,
            fontSize: ui.sizes.md,
            fontWeight: active === t.id ? 700 : 500,
            color: active === t.id ? '#fff' : COLORS.textMuted,
            background: active === t.id ? COLORS.gradient1 : 'transparent',
            whiteSpace: 'nowrap',
          }}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

/* ── Loading Skeleton ── */
function SkeletonPulse({ width, height, borderRadius = 8, style }) {
  return (
    <div style={{
      width, height, borderRadius,
      background: `linear-gradient(90deg, #1F2937 0%, #2d3a4a 50%, #1F2937 100%)`,
      backgroundSize: '200% 100%',
      animation: 'shimmer 1.5s ease-in-out infinite',
      ...style,
    }} />
  );
}

export function LoadingScreen() {
  const { ui } = useUISettings();
  return (
    <div style={{
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      minHeight: '100vh', background: COLORS.bg, fontFamily: FONT,
      padding: 40,
    }}>
      <style>{`
        @keyframes shimmer {
          0% { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
      `}</style>
      <div style={{ display: 'flex', gap: 16, marginBottom: 32, width: '100%', maxWidth: 900 }}>
        {[1,2,3,4,5].map(i => (
          <SkeletonPulse key={i} width="100%" height={80} borderRadius={10} />
        ))}
      </div>
      <div style={{ display: 'flex', gap: 16, width: '100%', maxWidth: 900, marginBottom: 24 }}>
        <SkeletonPulse width="40%" height={280} borderRadius={12} />
        <SkeletonPulse width="60%" height={280} borderRadius={12} />
      </div>
      <SkeletonPulse width="100%" height={320} borderRadius={12} style={{ maxWidth: 900 }} />
      <p style={{ color: COLORS.textMuted, fontSize: ui.sizes.base, marginTop: 24 }}>
        Loading dashboard data...
      </p>
    </div>
  );
}

export function ErrorScreen({ message }) {
  const { ui } = useUISettings();
  return (
    <div style={{
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      height: '100vh', background: COLORS.bg, fontFamily: FONT,
      padding: 40,
    }}>
      <div style={{ color: COLORS.accent5, fontSize: 48, marginBottom: 16 }}>!</div>
      <h2 style={{ color: COLORS.textBright, marginBottom: 8 }}>Data Not Found</h2>
      <p style={{ color: COLORS.textMuted, fontSize: ui.sizes.md, textAlign: 'center', maxWidth: 500 }}>
        {message}
      </p>
      <code style={{
        display: 'block', marginTop: 16, padding: 12, borderRadius: 8,
        background: COLORS.card, border: `1px solid ${COLORS.cardBorder}`,
        color: COLORS.accent1, fontSize: ui.sizes.sm,
      }}>
        python -m TATA_code_v2.v2_run --n 10000 --seed 42 --pricing-basis both
      </code>
    </div>
  );
}

/* ── Count-up animation hook ── */
export function useCountUp(target, duration = 800) {
  const [value, setValue] = useState(0);
  const ref = useRef(null);

  useEffect(() => {
    if (typeof target !== 'number' || isNaN(target)) {
      setValue(target);
      return;
    }
    const startTime = performance.now();
    function animate(now) {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = progress === 1 ? 1 : 1 - Math.pow(2, -10 * progress);
      setValue(target * eased);
      if (progress < 1) {
        ref.current = requestAnimationFrame(animate);
      }
    }
    ref.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(ref.current);
  }, [target, duration]);

  return value;
}
