/**
 * theme.js — Design tokens matching v1 breakeven_analysis.jsx dark theme.
 *
 * IMPORTANT: All constants (SPACE, CHART_HEIGHT, SIZES) must be defined
 * BEFORE functions that reference them, since createContext() calls
 * createUITheme() during module initialization.
 */

import React, { createContext, useContext, useMemo, useState } from 'react';

/* ═══════════════════════════════════════════════════════════
 * 1. PRIMITIVE CONSTANTS — defined first, no dependencies
 * ═══════════════════════════════════════════════════════════ */

/**
 * Cyberpunk Neon palette — high-contrast, saturated, dark-bg native.
 * Keys preserved (accent1..7) so all consumers continue to work.
 *
 *   accent1  cyan       #00F0FF
 *   accent2  magenta    #FF2E97
 *   accent3  yellow     #FFEE00
 *   accent4  green      #39FF14   (success / positive)
 *   accent5  red        #FF3864   (loss / risk)
 *   accent6  purple     #B026FF
 *   accent7  orange     #FF6B00
 */
export const COLORS = {
  bg: '#08090F',
  card: '#0F1320',
  cardBorder: '#1B2138',
  cardHover: '#161B2E',
  text: '#E8ECF7',
  textMuted: '#8C95B8',
  textBright: '#FFFFFF',
  accent1: '#00F0FF',   // neon cyan
  accent2: '#FF2E97',   // neon magenta
  accent3: '#FFEE00',   // neon yellow
  accent4: '#39FF14',   // neon green (positive)
  accent5: '#FF3864',   // neon red (loss)
  accent6: '#B026FF',   // neon purple
  accent7: '#FF6B00',   // neon orange
  breakeven: '#FFEE00',
  gridLine: '#1B2138',
  gradient1: 'linear-gradient(135deg, #00F0FF 0%, #B026FF 100%)',
  gradient2: 'linear-gradient(135deg, #39FF14 0%, #00F0FF 100%)',
  gradient3: 'linear-gradient(135deg, #FFEE00 0%, #FF3864 100%)',
};

export const FONT = "'Segoe UI', system-ui, -apple-system, sans-serif";

/* ── Typography scale (bumped +2 for financial-dashboard readability) ── */
export const SIZES = {
  xs: 13,
  sm: 14,
  md: 15,
  base: 15,
  lg: 18,
  xl: 22,
  xxl: 28,
  hero: 32,
};

/* ── Spacing tokens ── */
export const SPACE = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  section: 40,
};

/* ── Standardized chart heights (increased for breathing room) ── */
export const CHART_HEIGHT = {
  sm: 300,
  md: 380,
  lg: 440,
  xl: 500,
};

/* ── Reusable chart font configs (floors raised to match new SIZES) ── */
export const CHART_FONT = {
  axisTick:   { fontSize: Math.max(SIZES.sm, 13), fontFamily: FONT, fill: '#8C95B8' },
  axisLabel:  { fontSize: Math.max(SIZES.md, 14), fontFamily: FONT, fill: '#E8ECF7', fontWeight: 600 },
  legendItem: { fontSize: Math.max(SIZES.sm, 13), fontFamily: FONT },
};

export const CHART_COLORS = [
  COLORS.accent1, COLORS.accent2, COLORS.accent3,
  COLORS.accent4, COLORS.accent6, COLORS.accent7,
  COLORS.accent5,
  '#7DF9FF',  // electric blue
  '#CCFF00',  // chartreuse
  '#FF61F6',  // hot pink
  '#00FFC6',  // mint
  '#FFB000',  // amber-neon
];

/* ═══════════════════════════════════════════════════════════
 * 2. UI SETTINGS — scaling & density system
 * ═══════════════════════════════════════════════════════════ */

export const UI_TEXT_SCALE_OPTIONS = [1.0, 1.15, 1.30];
export const UI_DENSITY_OPTIONS = ['compact', 'comfortable'];

export const DEFAULT_UI_SETTINGS = {
  textScale: 1.0,
  density: 'comfortable',
};

const DENSITY_FACTORS = {
  compact: {
    spacing: 0.9,
    chartHeight: 0.94,
    cardPadding: 0.9,
  },
  comfortable: {
    spacing: 1,
    chartHeight: 1,
    cardPadding: 1,
  },
};

const clampMin = (value, min) => Math.max(min, Math.round(value));

export function getScaledSizes(textScale = DEFAULT_UI_SETTINGS.textScale) {
  const scale = UI_TEXT_SCALE_OPTIONS.includes(textScale) ? textScale : DEFAULT_UI_SETTINGS.textScale;
  return {
    xs: clampMin(SIZES.xs * scale, 13),
    sm: clampMin(SIZES.sm * scale, 13),
    md: clampMin(SIZES.md * scale, 14),
    base: clampMin(SIZES.base * scale, 15),
    lg: clampMin(SIZES.lg * scale, 18),
    xl: clampMin(SIZES.xl * scale, 22),
    xxl: clampMin(SIZES.xxl * scale, 28),
    hero: clampMin(SIZES.hero * scale, 32),
  };
}

export function getScaledSpace(density = DEFAULT_UI_SETTINGS.density) {
  const factor = DENSITY_FACTORS[density] || DENSITY_FACTORS[DEFAULT_UI_SETTINGS.density];
  return {
    xs: Math.round(SPACE.xs * factor.spacing),
    sm: Math.round(SPACE.sm * factor.spacing),
    md: Math.round(SPACE.md * factor.spacing),
    lg: Math.round(SPACE.lg * factor.spacing),
    xl: Math.round(SPACE.xl * factor.spacing),
    xxl: Math.round(SPACE.xxl * factor.spacing),
    section: Math.round(SPACE.section * factor.spacing),
  };
}

export function getScaledChartHeight(density = DEFAULT_UI_SETTINGS.density) {
  const factor = DENSITY_FACTORS[density] || DENSITY_FACTORS[DEFAULT_UI_SETTINGS.density];
  return {
    sm: Math.round(CHART_HEIGHT.sm * factor.chartHeight),
    md: Math.round(CHART_HEIGHT.md * factor.chartHeight),
    lg: Math.round(CHART_HEIGHT.lg * factor.chartHeight),
    xl: Math.round(CHART_HEIGHT.xl * factor.chartHeight),
  };
}

export function getChartFont(sizes = SIZES) {
  return {
    axisTick: {
      fontSize: clampMin(sizes.sm, 13),
      fontFamily: FONT,
      fill: '#8C95B8',
    },
    axisLabel: {
      fontSize: clampMin(sizes.md, 14),
      fontFamily: FONT,
      fill: '#E8ECF7',
      fontWeight: 600,
    },
    legendItem: {
      fontSize: clampMin(sizes.sm, 13),
      fontFamily: FONT,
    },
    tooltipLabel: {
      fontSize: clampMin(sizes.md, 14),
      fontFamily: FONT,
    },
    tooltipValue: {
      fontSize: clampMin(sizes.md, 14),
      fontFamily: FONT,
      fontWeight: 600,
    },
  };
}

export function createUITheme(settings = DEFAULT_UI_SETTINGS) {
  const safeSettings = {
    textScale: UI_TEXT_SCALE_OPTIONS.includes(settings?.textScale) ? settings.textScale : DEFAULT_UI_SETTINGS.textScale,
    density: UI_DENSITY_OPTIONS.includes(settings?.density) ? settings.density : DEFAULT_UI_SETTINGS.density,
  };
  const sizes = getScaledSizes(safeSettings.textScale);
  return {
    settings: safeSettings,
    sizes,
    chartFont: getChartFont(sizes),
    space: getScaledSpace(safeSettings.density),
    chartHeight: getScaledChartHeight(safeSettings.density),
    cardPadding: Math.round(SPACE.xl * (DENSITY_FACTORS[safeSettings.density] || DENSITY_FACTORS.comfortable).cardPadding),
  };
}

export const SHARED_TEXT_TOKENS = {
  title: { fontSize: SIZES.lg, fontWeight: 700 },
  subtitle: { fontSize: SIZES.md, fontWeight: 400 },
  kpiLabel: { fontSize: SIZES.sm, fontWeight: 600 },
  kpiSub: { fontSize: SIZES.sm, fontWeight: 400 },
  tableHeader: { fontSize: SIZES.sm, fontWeight: 700 },
  tableCell: { fontSize: SIZES.base, fontWeight: 400 },
};

/* ═══════════════════════════════════════════════════════════
 * 3. REACT CONTEXT — UISettingsProvider + useUISettings
 * ═══════════════════════════════════════════════════════════ */

const UISettingsContext = createContext({
  ui: createUITheme(DEFAULT_UI_SETTINGS),
  settings: DEFAULT_UI_SETTINGS,
  setTextScale: () => {},
  setDensity: () => {},
  reset: () => {},
});

export function UISettingsProvider({ children }) {
  const [settings, setSettings] = useState(DEFAULT_UI_SETTINGS);

  const value = useMemo(() => {
    const ui = createUITheme(settings);
    return {
      ui,
      settings,
      setTextScale: (textScale) => {
        setSettings((prev) => ({
          ...prev,
          textScale: UI_TEXT_SCALE_OPTIONS.includes(textScale) ? textScale : prev.textScale,
        }));
      },
      setDensity: (density) => {
        setSettings((prev) => ({
          ...prev,
          density: UI_DENSITY_OPTIONS.includes(density) ? density : prev.density,
        }));
      },
      reset: () => setSettings(DEFAULT_UI_SETTINGS),
    };
  }, [settings]);

  return React.createElement(UISettingsContext.Provider, { value }, children);
}

export function useUISettings() {
  return useContext(UISettingsContext);
}

/* ═══════════════════════════════════════════════════════════
 * 4. FORMATTERS & UTILITY FUNCTIONS
 * ═══════════════════════════════════════════════════════════ */

/** Format number as ₹Cr */
export const fmtCr = (v) => `₹${Number(v || 0).toLocaleString('en-IN', { maximumFractionDigits: 1 })} Cr`;

/** Format as percentage */
export const fmtPct = (v, dec = 1) => `${(Number(v || 0) * 100).toFixed(dec)}%`;

/** Format as MOIC multiplier */
export const fmtMOIC = (v) => `${Number(v || 0).toFixed(2)}×`;

/** Format months */
export const fmtMo = (v) => `${Number(v || 0).toFixed(1)}m`;

/** Get verdict style — neon palette */
export const getVerdictStyle = (verdict) => {
  switch (verdict) {
    case 'STRONG BUY': return { color: '#39FF14', bg: 'rgba(57,255,20,0.12)' };
    case 'ATTRACTIVE': return { color: '#00F0FF', bg: 'rgba(0,240,255,0.12)' };
    case 'MARGINAL':   return { color: '#FFEE00', bg: 'rgba(255,238,0,0.12)' };
    case 'AVOID':      return { color: '#FF3864', bg: 'rgba(255,56,100,0.14)' };
    default:           return { color: '#8C95B8', bg: 'rgba(140,149,184,0.12)' };
  }
};

/** Colour scale for heatmap cells based on MOIC — neon green/cyan/yellow/red */
export const moicColor = (moic) => {
  if (moic >= 3.0) return 'rgba(57,255,20,0.45)';
  if (moic >= 2.0) return 'rgba(57,255,20,0.30)';
  if (moic >= 1.5) return 'rgba(0,240,255,0.30)';
  if (moic >= 1.0) return 'rgba(255,238,0,0.25)';
  return 'rgba(255,56,100,0.30)';
};

/** Colour scale for P(loss) cells */
export const lossColor = (pLoss) => {
  const v = pLoss * 100;
  if (v > 45) return `rgba(255,56,100,${0.3 + (v/60) * 0.4})`;
  if (v > 35) return `rgba(255,107,0,${0.2 + (v/60) * 0.3})`;
  if (v > 25) return `rgba(255,238,0,${0.15 + (v/60) * 0.2})`;
  return `rgba(57,255,20,${0.15 + (1 - v/60) * 0.2})`;
};

/** Colour scale for heatmap cells based on IRR */
export const irrColor = (v) => {
  if (v >= 0.40) return 'rgba(57,255,20,0.50)';
  if (v >= 0.30) return 'rgba(57,255,20,0.35)';
  if (v >= 0.20) return 'rgba(0,240,255,0.30)';
  if (v >= 0.12) return 'rgba(255,238,0,0.25)';
  if (v >= 0.00) return 'rgba(176,38,255,0.22)';
  return 'rgba(255,56,100,0.32)';
};

/** Colour scale for P(IRR>hurdle) cells */
export const hurdleColor = (v) => {
  if (v >= 0.80) return 'rgba(57,255,20,0.45)';
  if (v >= 0.60) return 'rgba(57,255,20,0.30)';
  if (v >= 0.40) return 'rgba(0,240,255,0.28)';
  if (v >= 0.20) return 'rgba(255,238,0,0.25)';
  return 'rgba(255,56,100,0.30)';
};

/** Colour scale for VaR/CVaR cells (higher magnitude = worse) */
export const varColor = (v) => {
  const absV = Math.abs(v);
  if (absV > 500) return 'rgba(255,56,100,0.45)';
  if (absV > 200) return 'rgba(255,56,100,0.30)';
  if (absV > 100) return 'rgba(255,107,0,0.25)';
  if (absV > 50)  return 'rgba(255,238,0,0.22)';
  return 'rgba(57,255,20,0.20)';
};

/** Standard cursor style for Bar hover across the dark theme */
export const BAR_CURSOR = { fill: 'rgba(0,240,255,0.18)' };
