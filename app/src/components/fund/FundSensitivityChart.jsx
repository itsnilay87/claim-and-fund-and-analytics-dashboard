import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import { CHART_COLORS, CHART_SEQUENCE, AXIS_STYLE, TOOLTIP_STYLE, formatPercent, formatMultiple } from '../../utils/chartTheme'
import { useState } from 'react'

export default function FundSensitivityChart({ data }) {
  const [activeMetric, setActiveMetric] = useState('net_annualised_irr_pct')

  if (!data || data.length === 0) return <div className="text-slate-500 text-sm text-center py-12">No sensitivity data available</div>

  const formatLabel = (v) => v.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
  const formatter = activeMetric.includes('irr') || activeMetric.includes('pct') ? formatPercent : formatMultiple

  return (
    <div className="bg-white dark:bg-slate-900/50 rounded-xl border border-slate-200 dark:border-white/5 p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Sensitivity Analysis</h3>
        <div className="flex gap-2">
          {['net_annualised_irr_pct', 'roic_multiple'].map((m) => (
            <button key={m} onClick={() => setActiveMetric(m)}
              className={`px-3 py-1 rounded-lg text-xs font-medium transition-all ${activeMetric === m ? 'bg-blue-50 dark:bg-blue-500/20 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-500/30' : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'}`}>
              {m.includes('irr') ? 'IRR' : 'MOIC'}
            </button>
          ))}
        </div>
      </div>
      <div className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
            <XAxis dataKey="value" {...AXIS_STYLE} type="number" domain={['auto', 'auto']} allowDuplicatedCategory={false} />
            <YAxis {...AXIS_STYLE} tickFormatter={formatter} />
            <Tooltip {...TOOLTIP_STYLE} formatter={(v) => formatter(v)} />
            <Legend wrapperStyle={{ fontSize: '11px' }} />
            {data.map((series, i) => (
              <Line key={series.variable} data={series.records} type="monotone" dataKey={activeMetric} name={formatLabel(series.variable)}
                stroke={CHART_SEQUENCE[i % CHART_SEQUENCE.length]} strokeWidth={2} dot={{ r: 3 }} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
