export const CHART_COLORS = {
  cyan: '#06B6D4',
  purple: '#8B5CF6',
  amber: '#F59E0B',
  green: '#10B981',
  red: '#EF4444',
  blue: '#3B82F6',
  pink: '#EC4899',
  indigo: '#6366F1',
  teal: '#14B8A6',
  orange: '#F97316',
}

export const CHART_SEQUENCE = [
  CHART_COLORS.cyan,
  CHART_COLORS.purple,
  CHART_COLORS.amber,
  CHART_COLORS.green,
  CHART_COLORS.red,
  CHART_COLORS.blue,
  CHART_COLORS.pink,
  CHART_COLORS.indigo,
]

export const PERCENTILE_COLORS = {
  p5: '#EF4444',
  p25: '#F59E0B',
  p50: '#06B6D4',
  p75: '#10B981',
  p95: '#8B5CF6',
}

export const DARK_BG = '#0B0E17'
export const CARD_BG = '#111827'
export const CARD_BORDER = '#1F2937'

export const AXIS_STYLE = {
  tick: { fill: '#94A3B8', fontSize: 11 },
  axisLine: { stroke: '#334155' },
  tickLine: { stroke: '#334155' },
}

export const TOOLTIP_STYLE = {
  contentStyle: {
    backgroundColor: '#1E293B',
    border: '1px solid #334155',
    borderRadius: '8px',
    color: '#F1F5F9',
    fontSize: '12px',
  },
}

export function formatCurrency(value) {
  if (value === null || value === undefined) return '-'
  const abs = Math.abs(value)
  if (abs >= 1e9) return `$${(value / 1e9).toFixed(1)}B`
  if (abs >= 1e6) return `$${(value / 1e6).toFixed(1)}M`
  if (abs >= 1e3) return `$${(value / 1e3).toFixed(0)}K`
  return `$${value.toFixed(0)}`
}

export function formatPercent(value) {
  if (value === null || value === undefined) return '-'
  const n = Number(value)
  const pct = Math.abs(n) <= 1 ? n * 100 : n
  return `${pct.toFixed(1)}%`
}

export function formatMultiple(value) {
  if (value === null || value === undefined) return '-'
  return `${Number(value).toFixed(2)}x`
}
