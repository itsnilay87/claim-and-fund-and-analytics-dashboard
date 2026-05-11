import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import { PERCENTILE_COLORS, AXIS_STYLE, TOOLTIP_STYLE, formatCurrency } from '../../utils/chartTheme'

export default function FundJCurveChart({ data }) {
  if (!data || data.length === 0) return <div className="text-slate-500 text-sm text-center py-12">No J-Curve data available</div>

  return (
    <div className="bg-white dark:bg-slate-900/50 rounded-xl border border-slate-200 dark:border-white/5 p-6">
      <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-4">J-Curve — Cumulative Net Cashflow</h3>
      <div className="h-80">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
            <XAxis dataKey="date" {...AXIS_STYLE} tickFormatter={(d) => d?.slice(0, 7)} interval="preserveStartEnd" />
            <YAxis {...AXIS_STYLE} tickFormatter={formatCurrency} />
            <Tooltip {...TOOLTIP_STYLE} formatter={(v) => formatCurrency(v)} labelFormatter={(l) => `Date: ${l}`} />
            <Legend wrapperStyle={{ fontSize: '11px' }} />
            <Area type="monotone" dataKey="p95" name="P95" stroke={PERCENTILE_COLORS.p95} fill={PERCENTILE_COLORS.p95} fillOpacity={0.08} strokeWidth={1} dot={false} />
            <Area type="monotone" dataKey="p75" name="P75" stroke={PERCENTILE_COLORS.p75} fill={PERCENTILE_COLORS.p75} fillOpacity={0.1} strokeWidth={1} dot={false} />
            <Area type="monotone" dataKey="median" name="Median" stroke={PERCENTILE_COLORS.p50} fill={PERCENTILE_COLORS.p50} fillOpacity={0.15} strokeWidth={2} dot={false} />
            <Area type="monotone" dataKey="p25" name="P25" stroke={PERCENTILE_COLORS.p25} fill={PERCENTILE_COLORS.p25} fillOpacity={0.1} strokeWidth={1} dot={false} />
            <Area type="monotone" dataKey="p5" name="P5" stroke={PERCENTILE_COLORS.p5} fill={PERCENTILE_COLORS.p5} fillOpacity={0.08} strokeWidth={1} dot={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
