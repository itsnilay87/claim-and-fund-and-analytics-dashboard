import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import { CHART_COLORS, AXIS_STYLE, TOOLTIP_STYLE, formatCurrency } from '../../utils/chartTheme'

export default function FundNAVChart({ data }) {
  if (!data || data.length === 0) return <div className="text-slate-500 text-sm text-center py-12">No NAV data available</div>

  return (
    <div className="bg-white dark:bg-slate-900/50 rounded-xl border border-slate-200 dark:border-white/5 p-6">
      <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-4">Net Asset Value</h3>
      <div className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
            <XAxis dataKey="date" {...AXIS_STYLE} tickFormatter={(d) => d?.slice(0, 7)} interval="preserveStartEnd" />
            <YAxis {...AXIS_STYLE} tickFormatter={formatCurrency} />
            <Tooltip {...TOOLTIP_STYLE} formatter={(v) => formatCurrency(v)} labelFormatter={(l) => `Date: ${l}`} />
            <Legend wrapperStyle={{ fontSize: '11px' }} />
            <Line type="monotone" dataKey="total_nav" name="Total NAV" stroke={CHART_COLORS.cyan} strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="market_nav" name="Market NAV" stroke={CHART_COLORS.purple} strokeWidth={2} dot={false} />
            {data[0]?.hybrid_nav !== undefined && (
              <Line type="monotone" dataKey="hybrid_nav" name="Hybrid NAV" stroke={CHART_COLORS.amber} strokeWidth={2} dot={false} />
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
