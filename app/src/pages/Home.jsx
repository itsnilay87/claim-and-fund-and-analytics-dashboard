import { Link, useParams } from 'react-router-dom'
import { useAuthStore } from '../store/authStore'
import { useClaimStore } from '../store/claimStore'
import { usePortfolioStore } from '../store/portfolioStore'
import { BarChart3, TrendingUp, Clock, DollarSign, PlusCircle, ArrowRight, CheckCircle2, Loader2, AlertCircle, Scale, FileText, Briefcase } from 'lucide-react'
import StatsCards from '../components/dashboard/StatsCards'

const demoRuns = [
  { id: 'demo-run-001', name: 'Full Portfolio Analysis', portfolio: 'All (6 Claims)', status: 'completed', date: '2026-03-10', moic: '2.4x', irr: '28.1%' },
  { id: 'demo-run-002', name: 'SIAC Claims Only', portfolio: 'SIAC (3 Claims)', status: 'completed', date: '2026-03-08', moic: '2.7x', irr: '32.4%' },
  { id: 'demo-run-003', name: 'Domestic Claims', portfolio: 'Domestic (3 Claims)', status: 'completed', date: '2026-03-05', moic: '2.1x', irr: '24.7%' },
  { id: 'demo-run-004', name: 'Sensitivity Run A', portfolio: 'All (6 Claims)', status: 'running', date: '2026-03-15', moic: '-', irr: '-' },
]

const statusConfig = {
  completed: { icon: CheckCircle2, color: 'text-emerald-500', bg: 'bg-emerald-500/10' },
  running: { icon: Loader2, color: 'text-amber-500', bg: 'bg-amber-500/10', animate: true },
  failed: { icon: AlertCircle, color: 'text-red-500', bg: 'bg-red-500/10' },
}

export default function Home() {
  const user = useAuthStore((s) => s.user)
  const { wsId } = useParams()
  const claims = useClaimStore((s) => s.claims)
  const portfolios = usePortfolioStore((s) => s.portfolios)

  const totalClaims = claims.length
  const totalPortfolios = portfolios.length

  const stats = [
    { label: 'Total Claims', value: String(totalClaims || '0'), icon: Scale, bgColor: 'bg-teal-500/10', iconColor: 'text-teal-500' },
    { label: 'Total Portfolios', value: String(totalPortfolios || '0'), icon: Briefcase, bgColor: 'bg-emerald-500/10', iconColor: 'text-emerald-500' },
    { label: 'Last Run', value: '-', icon: Clock, bgColor: 'bg-cyan-500/10', iconColor: 'text-cyan-500' },
    { label: 'Portfolio Value', value: '-', icon: DollarSign, bgColor: 'bg-amber-500/10', iconColor: 'text-amber-500' },
  ]

  return (
    <div className="space-y-6 animate-fade-in-up">
      {/* Welcome */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Welcome back, {user?.name?.split(' ')[0] || 'Analyst'}</h1>
          <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">Here is an overview of your litigation analytics</p>
        </div>
        <Link to={`/workspace/${wsId}/portfolio/new`}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-teal-600 to-cyan-600 text-white font-medium text-sm hover:from-teal-500 hover:to-cyan-500 transition-all shadow-lg shadow-teal-500/25">
          <PlusCircle size={16} /> New Portfolio
        </Link>
      </div>

      {/* Stats */}
      <StatsCards stats={stats} />

      {/* Portfolio Summary */}
      <div className="grid md:grid-cols-2 gap-4">
        <div className="glass-card p-6">
          <div className="flex items-center gap-2 mb-4">
            <Scale size={18} className="text-teal-500" />
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Portfolio Overview</h3>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="text-xs text-slate-500 mb-1">Total Quantum (SOC)</div>
              <div className="text-lg font-bold text-slate-900 dark:text-white">{'\u20B9'}5,144 Cr</div>
            </div>
            <div>
              <div className="text-xs text-slate-500 mb-1">Active Claims</div>
              <div className="text-lg font-bold text-slate-900 dark:text-white">6</div>
            </div>
            <div>
              <div className="text-xs text-slate-500 mb-1">SIAC Claims</div>
              <div className="text-lg font-bold text-teal-600 dark:text-teal-400">3</div>
            </div>
            <div>
              <div className="text-xs text-slate-500 mb-1">Domestic Claims</div>
              <div className="text-lg font-bold text-cyan-600 dark:text-cyan-400">3</div>
            </div>
          </div>
          <div className="mt-4 pt-4 border-t border-slate-200 dark:border-white/10">
            <div className="flex justify-between text-xs">
              <span className="text-slate-500">VaR (5%)</span>
              <span className="font-medium text-slate-900 dark:text-white">0.8x</span>
            </div>
            <div className="flex justify-between text-xs mt-1">
              <span className="text-slate-500">CVaR (5%)</span>
              <span className="font-medium text-slate-900 dark:text-white">0.6x</span>
            </div>
          </div>
        </div>
        <div className="glass-card p-6">
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp size={18} className="text-emerald-500" />
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Performance Snapshot</h3>
          </div>
          <div className="space-y-3">
            {[
              { label: 'Full Portfolio MOIC (P50)', value: '2.4x', color: 'bg-teal-500' },
              { label: 'SIAC MOIC (P50)', value: '2.7x', color: 'bg-cyan-500' },
              { label: 'Domestic MOIC (P50)', value: '2.1x', color: 'bg-emerald-500' },
            ].map((row, i) => (
              <div key={i}>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-slate-500">{row.label}</span>
                  <span className="font-medium text-slate-900 dark:text-white">{row.value}</span>
                </div>
                <div className="h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                  <div className={`h-full rounded-full ${row.color}`} style={{ width: `${parseFloat(row.value) / 3 * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
          <div className="mt-4 pt-4 border-t border-slate-200 dark:border-white/10">
            <div className="flex justify-between text-xs">
              <span className="text-slate-500">Avg. IRR</span>
              <span className="font-medium text-emerald-500">28.1%</span>
            </div>
          </div>
        </div>
      </div>

      {/* Recent Runs */}
      <div className="glass-card overflow-hidden">
        <div className="flex items-center justify-between p-5 border-b border-slate-200 dark:border-white/5">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Recent Simulations</h2>
          <Link to={`/workspace/${wsId}/history`} className="text-sm text-teal-600 dark:text-teal-400 hover:text-teal-500 dark:hover:text-teal-300 flex items-center gap-1">
            View All <ArrowRight size={14} />
          </Link>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="text-xs text-slate-500 uppercase tracking-wider border-b border-slate-200 dark:border-white/5">
                <th className="text-left py-3 px-5 font-medium">Name</th>
                <th className="text-left py-3 px-5 font-medium">Portfolio</th>
                <th className="text-left py-3 px-5 font-medium">Status</th>
                <th className="text-left py-3 px-5 font-medium">Date</th>
                <th className="text-left py-3 px-5 font-medium">MOIC</th>
                <th className="text-left py-3 px-5 font-medium">IRR</th>
                <th className="text-right py-3 px-5 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {demoRuns.map((run) => {
                const sc = statusConfig[run.status] || statusConfig.completed
                return (
                  <tr key={run.id} className="border-b border-slate-100 dark:border-white/5 hover:bg-slate-50 dark:hover:bg-white/[0.02] transition-colors">
                    <td className="py-3.5 px-5 text-sm text-slate-900 dark:text-white font-medium">{run.name}</td>
                    <td className="py-3.5 px-5 text-sm text-slate-500 dark:text-slate-400">{run.portfolio}</td>
                    <td className="py-3.5 px-5">
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${sc.bg} ${sc.color}`}>
                        <sc.icon size={12} className={sc.animate ? 'animate-spin' : ''} />
                        {run.status}
                      </span>
                    </td>
                    <td className="py-3.5 px-5 text-sm text-slate-500 dark:text-slate-400">{run.date}</td>
                    <td className="py-3.5 px-5 text-sm text-slate-900 dark:text-white font-mono">{run.moic}</td>
                    <td className="py-3.5 px-5 text-sm text-slate-900 dark:text-white font-mono">{run.irr}</td>
                    <td className="py-3.5 px-5 text-right">
                      {run.status === 'completed' && (
                        <Link to={`/workspace/${wsId}/portfolio/${run.id}/results`} className="text-xs text-teal-600 dark:text-teal-400 hover:text-teal-500 dark:hover:text-teal-300">
                          View Results
                        </Link>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="grid md:grid-cols-3 gap-4">
        <Link to={`/workspace/${wsId}/portfolio/new`} className="glass-card p-5 hover:shadow-md dark:hover:bg-white/[0.06] transition-all group">
          <PlusCircle size={24} className="text-teal-500 mb-3" />
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-1">New Portfolio</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">Create a portfolio and run Monte Carlo analysis</p>
        </Link>
        <Link to={`/workspace/${wsId}/history`} className="glass-card p-5 hover:shadow-md dark:hover:bg-white/[0.06] transition-all group">
          <Clock size={24} className="text-cyan-500 mb-3" />
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-1">Compare Runs</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">Side-by-side comparison of simulation results</p>
        </Link>
        <div className="glass-card p-5 hover:shadow-md dark:hover:bg-white/[0.06] transition-all opacity-60">
          <FileText size={24} className="text-amber-500 mb-3" />
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-1">Portfolio Report</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">Generate comprehensive PDF report (Coming soon)</p>
        </div>
      </div>
    </div>
  )
}
