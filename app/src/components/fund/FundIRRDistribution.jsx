import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts'
import { CHART_COLORS, AXIS_STYLE, TOOLTIP_STYLE } from '../../utils/chartTheme'
import { useMemo } from 'react'

export default function FundIRRDistribution({ data, distributions }) {
  const histogram = useMemo(() => {
    if (distributions?.net_annualised_irr_pct?.histogram) {
      return distributions.net_annualised_irr_pct.histogram.map((b) => ({
        bin: `${(b.bin_start * 100).toFixed(0)}%`,
        count: b.count,
        value: (b.bin_start + b.bin_end) / 2,
      }))
    }
    if (!data || data.length === 0) return []
    const values = data.map((v) => (typeof v === 'number' ? v : v.irr || v.value || 0))
    const min = Math.min(...values)
    const max = Math.max(...values)
    const binCount = Math.min(30, Math.max(10, Math.ceil(Math.sqrt(values.length))))
    const binWidth = (max - min) / binCount || 1
    const bins = Array.from({ length: binCount }, (_, i) => ({
      bin: `${((min + i * binWidth) * 100).toFixed(0)}%`,
      count: 0,
      value: min + (i + 0.5) * binWidth,
    }))
    values.forEach((v) => {
      const idx = Math.min(Math.floor((v - min) / binWidth), binCount - 1)
      if (idx >= 0) bins[idx].count++
    })
    return bins
  }, [data, distributions])

  if (histogram.length === 0) return <div className="text-slate-500 text-sm text-center py-12">No IRR distribution data</div>

  const median = distributions?.net_annualised_irr_pct?.summary?.median

  return (
    <div className="bg-white dark:bg-slate-900/50 rounded-xl border border-slate-200 dark:border-white/5 p-6">
      <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-4">IRR Distribution</h3>
      <div className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={histogram} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
            <XAxis dataKey="bin" {...AXIS_STYLE} interval={Math.ceil(histogram.length / 8)} />
            <YAxis {...AXIS_STYLE} />
            <Tooltip {...TOOLTIP_STYLE} />
            <Bar dataKey="count" fill={CHART_COLORS.cyan} radius={[2, 2, 0, 0]} />
            {median != null && (
              <ReferenceLine x={`${(median * 100).toFixed(0)}%`} stroke={CHART_COLORS.amber} strokeDasharray="4 4" label={{ value: `Median ${(median * 100).toFixed(1)}%`, fill: CHART_COLORS.amber, fontSize: 11, position: 'top' }} />
            )}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
