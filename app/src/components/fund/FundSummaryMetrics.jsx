import { TrendingUp, TrendingDown, DollarSign, BarChart3, Clock, Target } from 'lucide-react'
import { formatCurrency, formatPercent, formatMultiple } from '../../utils/chartTheme'

const metricConfigs = [
  { key: 'net_result', label: 'Net Result', icon: DollarSign, format: formatCurrency, color: 'text-cyan-400' },
  { key: 'payout_multiple', label: 'MOIC', icon: TrendingUp, format: formatMultiple, color: 'text-purple-400' },
  { key: 'net_annualised_irr_pct', label: 'IRR', icon: BarChart3, format: formatPercent, color: 'text-green-400' },
  { key: 'total_capital_deployed', label: 'Capital Deployed', icon: Target, format: formatCurrency, color: 'text-amber-400' },
  { key: 'peak_drawdown', label: 'Peak Drawdown', icon: TrendingDown, format: formatCurrency, color: 'text-red-400' },
  { key: 'months_to_break_even', label: 'Break-Even (months)', icon: Clock, format: (v) => v != null ? `${Math.round(v)}` : '-', color: 'text-blue-400' },
]

function getStatValue(stats, key, stat = 'median') {
  if (!stats) return null
  const row = Array.isArray(stats) ? stats.find((r) => r.metric === key) : null
  if (row) return row[stat]
  if (typeof stats === 'object' && stats[key]) return stats[key].summary?.[stat] ?? stats[key][stat]
  return stats[key] ?? null
}

export default function FundSummaryMetrics({ data }) {
  if (!data) return null

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
      {metricConfigs.map(({ key, label, icon: Icon, format, color }) => {
        const value = getStatValue(data, key)
        return (
          <div key={key} className="bg-white dark:bg-slate-900/50 rounded-xl border border-slate-200 dark:border-white/5 p-4">
            <div className="flex items-center gap-2 mb-2">
              <Icon size={14} className={color} />
              <span className="text-xs text-slate-500 dark:text-slate-400">{label}</span>
            </div>
            <div className="text-xl font-bold text-slate-900 dark:text-white font-mono">
              {format(value)}
            </div>
          </div>
        )
      })}
    </div>
  )
}
