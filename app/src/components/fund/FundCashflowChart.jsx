import { ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import { CHART_COLORS, AXIS_STYLE, TOOLTIP_STYLE, formatCurrency } from '../../utils/chartTheme'

export default function FundCashflowChart({ data }) {
  if (!data || data.length === 0) return <div className="text-slate-500 text-sm text-center py-12">No cashflow data available</div>

  return (
    <div className="bg-white dark:bg-slate-900/50 rounded-xl border border-slate-200 dark:border-white/5 p-6">
      <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-4">Cashflow Timeline</h3>
      <div className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
            <XAxis dataKey="date" {...AXIS_STYLE} tickFormatter={(d) => d?.slice(0, 7)} interval="preserveStartEnd" />
            <YAxis {...AXIS_STYLE} tickFormatter={formatCurrency} />
            <Tooltip {...TOOLTIP_STYLE} formatter={(v) => formatCurrency(v)} labelFormatter={(l) => `Date: ${l}`} />
            <Legend wrapperStyle={{ fontSize: '11px' }} />
            <Bar dataKey="outflow_amount" name="Outflows" fill={CHART_COLORS.red} fillOpacity={0.7} radius={[2, 2, 0, 0]} />
            <Bar dataKey="inflow_amount" name="Inflows" fill={CHART_COLORS.green} fillOpacity={0.7} radius={[2, 2, 0, 0]} />
            <Line type="monotone" dataKey="cumulative" name="Cumulative" stroke={CHART_COLORS.cyan} strokeWidth={2} dot={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
