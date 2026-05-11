import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { useFundStore } from '../../store/fundStore'
import { Play, History, Settings2, FlaskConical, BarChart3, Loader2, TrendingUp, ArrowRight } from 'lucide-react'

export default function FundDashboard() {
  const { simulations, fetchSimulations, loading } = useFundStore()
  const [recentLoaded, setRecentLoaded] = useState(false)

  const loadRecent = useCallback(async () => {
    await fetchSimulations('limit=5')
    setRecentLoaded(true)
  }, [fetchSimulations])

  useEffect(() => { loadRecent() }, [loadRecent])

  const completedCount = simulations.filter((s) => s.status === 'completed').length
  const runningCount = simulations.filter((s) => s.status === 'running' || s.status === 'queued').length

  const quickActions = [
    { to: '/fund-analytics/simulate', icon: Play, label: 'New Simulation', desc: 'Run a fund Monte Carlo simulation', color: 'from-blue-500 to-cyan-500' },
    { to: '/fund-analytics/parameters', icon: Settings2, label: 'Parameters', desc: 'Configure fund parameters', color: 'from-purple-500 to-indigo-500' },
    { to: '/fund-analytics/case/new', icon: FlaskConical, label: 'Case Simulation', desc: 'Simulate individual case outcomes', color: 'from-amber-500 to-orange-500' },
    { to: '/fund-analytics/history', icon: History, label: 'History', desc: 'View past simulations', color: 'from-green-500 to-emerald-500' },
  ]

  return (
    <div className="space-y-8 animate-fade-in-up">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Fund Analytics</h1>
        <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">Monte Carlo simulation engine for litigation fund analysis</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white dark:bg-slate-900/50 rounded-xl border border-slate-200 dark:border-white/5 p-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-blue-50 dark:bg-blue-500/10 flex items-center justify-center">
              <BarChart3 size={18} className="text-blue-500" />
            </div>
            <div>
              <div className="text-2xl font-bold text-slate-900 dark:text-white">{simulations.length}</div>
              <div className="text-xs text-slate-500 dark:text-slate-400">Total Simulations</div>
            </div>
          </div>
        </div>
        <div className="bg-white dark:bg-slate-900/50 rounded-xl border border-slate-200 dark:border-white/5 p-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-green-50 dark:bg-green-500/10 flex items-center justify-center">
              <TrendingUp size={18} className="text-green-500" />
            </div>
            <div>
              <div className="text-2xl font-bold text-slate-900 dark:text-white">{completedCount}</div>
              <div className="text-xs text-slate-500 dark:text-slate-400">Completed</div>
            </div>
          </div>
        </div>
        <div className="bg-white dark:bg-slate-900/50 rounded-xl border border-slate-200 dark:border-white/5 p-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-amber-50 dark:bg-amber-500/10 flex items-center justify-center">
              <Loader2 size={18} className={`text-amber-500 ${runningCount > 0 ? 'animate-spin' : ''}`} />
            </div>
            <div>
              <div className="text-2xl font-bold text-slate-900 dark:text-white">{runningCount}</div>
              <div className="text-xs text-slate-500 dark:text-slate-400">In Progress</div>
            </div>
          </div>
        </div>
      </div>

      {/* Quick actions */}
      <div>
        <h2 className="text-sm font-semibold text-slate-900 dark:text-white mb-3">Quick Actions</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          {quickActions.map(({ to, icon: Icon, label, desc, color }) => (
            <Link key={to} to={to} className="group bg-white dark:bg-slate-900/50 rounded-xl border border-slate-200 dark:border-white/5 p-5 hover:border-blue-300 dark:hover:border-blue-500/30 transition-all">
              <div className={`w-10 h-10 rounded-lg bg-gradient-to-br ${color} flex items-center justify-center mb-3`}>
                <Icon size={18} className="text-white" />
              </div>
              <div className="text-sm font-semibold text-slate-900 dark:text-white">{label}</div>
              <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">{desc}</div>
            </Link>
          ))}
        </div>
      </div>

      {/* Recent simulations */}
      {recentLoaded && simulations.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Recent Simulations</h2>
            <Link to="/fund-analytics/history" className="text-xs text-blue-500 hover:text-blue-400 flex items-center gap-1">
              View all <ArrowRight size={12} />
            </Link>
          </div>
          <div className="bg-white dark:bg-slate-900/50 rounded-xl border border-slate-200 dark:border-white/5 overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="text-xs text-slate-500 uppercase tracking-wider border-b border-slate-200 dark:border-white/5">
                  <th className="text-left py-3 px-5 font-medium">Name</th>
                  <th className="text-left py-3 px-5 font-medium">Status</th>
                  <th className="text-left py-3 px-5 font-medium">Date</th>
                  <th className="text-right py-3 px-5 font-medium">Action</th>
                </tr>
              </thead>
              <tbody>
                {simulations.slice(0, 5).map((sim) => (
                  <tr key={sim.id} className="border-b border-slate-100 dark:border-white/5 hover:bg-slate-50 dark:hover:bg-white/[0.02] transition-colors">
                    <td className="py-3 px-5 text-sm text-slate-900 dark:text-white">{sim.name || `Simulation ${sim.id.slice(0, 8)}`}</td>
                    <td className="py-3 px-5">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                        sim.status === 'completed' ? 'bg-emerald-500/10 text-emerald-400' :
                        sim.status === 'running' ? 'bg-amber-500/10 text-amber-400' :
                        sim.status === 'failed' ? 'bg-red-500/10 text-red-400' :
                        'bg-blue-500/10 text-blue-400'
                      }`}>{sim.status}</span>
                    </td>
                    <td className="py-3 px-5 text-sm text-slate-500 dark:text-slate-400">
                      {sim.created_at ? new Date(sim.created_at).toLocaleDateString() : '-'}
                    </td>
                    <td className="py-3 px-5 text-right">
                      {sim.status === 'completed' && (
                        <Link to={`/fund-analytics/results/${sim.id}`} className="text-xs text-blue-500 hover:text-blue-400">View Results</Link>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
