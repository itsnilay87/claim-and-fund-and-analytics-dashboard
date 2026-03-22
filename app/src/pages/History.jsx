import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Search, Filter, CheckCircle2, Loader2, AlertCircle, Trash2 } from 'lucide-react'

const allRuns = [
  { id: 'demo-run-001', name: 'Full Portfolio Analysis', portfolio: 'All (6 Claims)', status: 'completed', date: '2026-03-10 14:30', moic: '2.4x', irr: '28.1%', paths: 10000 },
  { id: 'demo-run-002', name: 'SIAC Claims Only', portfolio: 'SIAC (3 Claims)', status: 'completed', date: '2026-03-08 10:15', moic: '2.7x', irr: '32.4%', paths: 10000 },
  { id: 'demo-run-003', name: 'Domestic Claims', portfolio: 'Domestic (3 Claims)', status: 'completed', date: '2026-03-05 09:00', moic: '2.1x', irr: '24.7%', paths: 10000 },
  { id: 'demo-run-004', name: 'High Win Probability Test', portfolio: 'All (6 Claims)', status: 'completed', date: '2026-03-03 16:45', moic: '2.9x', irr: '35.2%', paths: 5000 },
  { id: 'demo-run-005', name: 'Conservative Scenario', portfolio: 'All (6 Claims)', status: 'completed', date: '2026-02-28 11:20', moic: '1.8x', irr: '18.3%', paths: 10000 },
  { id: 'demo-run-006', name: 'Stress Test - Low Quantum', portfolio: 'All (6 Claims)', status: 'failed', date: '2026-02-25 08:00', moic: '-', irr: '-', paths: 10000 },
  { id: 'demo-run-007', name: 'Quick Sensitivity Check', portfolio: 'SIAC (3 Claims)', status: 'completed', date: '2026-02-20 13:10', moic: '2.5x', irr: '30.1%', paths: 1000 },
]

const statusConfig = {
  completed: { icon: CheckCircle2, color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
  running: { icon: Loader2, color: 'text-amber-400', bg: 'bg-amber-500/10', spin: true },
  failed: { icon: AlertCircle, color: 'text-red-400', bg: 'bg-red-500/10' },
}

export default function History() {
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all')
  const { wsId } = useParams()

  const filtered = allRuns.filter((r) => {
    if (filter !== 'all' && r.status !== filter) return false
    if (search && !r.name.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  return (
    <div className="space-y-6 animate-fade-in-up">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Simulation History</h1>
        <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">View and manage all your past simulation runs</p>
      </div>

      <div className="flex flex-col md:flex-row gap-3">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500" />
          <input type="text" value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search simulations..."
            className="w-full pl-10 pr-4 py-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-white/10 text-sm text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500" />
        </div>
        <div className="flex items-center gap-2">
          <Filter size={14} className="text-slate-400 dark:text-slate-500" />
          {['all', 'completed', 'running', 'failed'].map((f) => (
            <button key={f} onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                filter === f ? 'bg-teal-50 dark:bg-teal-500/20 text-teal-700 dark:text-teal-300 border border-teal-200 dark:border-teal-500/30' : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-50 dark:hover:bg-white/5'
              }`}>
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
      </div>

      <div className="glass-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="text-xs text-slate-500 uppercase tracking-wider border-b border-slate-200 dark:border-white/5">
                <th className="text-left py-3 px-5 font-medium">Simulation</th>
                <th className="text-left py-3 px-5 font-medium">Portfolio</th>
                <th className="text-left py-3 px-5 font-medium">Status</th>
                <th className="text-left py-3 px-5 font-medium">Date</th>
                <th className="text-right py-3 px-5 font-medium">Paths</th>
                <th className="text-right py-3 px-5 font-medium">MOIC</th>
                <th className="text-right py-3 px-5 font-medium">IRR</th>
                <th className="text-right py-3 px-5 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((run) => {
                const sc = statusConfig[run.status] || statusConfig.completed
                return (
                  <tr key={run.id} className="border-b border-slate-100 dark:border-white/5 hover:bg-slate-50 dark:hover:bg-white/[0.02] transition-colors">
                    <td className="py-3.5 px-5 text-sm text-slate-900 dark:text-white font-medium">{run.name}</td>
                    <td className="py-3.5 px-5 text-sm text-slate-500 dark:text-slate-400">{run.portfolio}</td>
                    <td className="py-3.5 px-5">
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${sc.bg} ${sc.color}`}>
                        <sc.icon size={12} className={sc.spin ? 'animate-spin' : ''} />
                        {run.status}
                      </span>
                    </td>
                    <td className="py-3.5 px-5 text-sm text-slate-500 dark:text-slate-400">{run.date}</td>
                    <td className="py-3.5 px-5 text-sm text-slate-500 dark:text-slate-400 text-right font-mono">{run.paths.toLocaleString()}</td>
                    <td className="py-3.5 px-5 text-sm text-slate-900 dark:text-white text-right font-mono">{run.moic}</td>
                    <td className="py-3.5 px-5 text-sm text-slate-900 dark:text-white text-right font-mono">{run.irr}</td>
                    <td className="py-3.5 px-5 text-right space-x-2">
                      {run.status === 'completed' && (
                        <Link to={`/workspace/${wsId}/portfolio/${run.id}/results`} className="text-xs text-teal-600 dark:text-teal-400 hover:text-teal-500 dark:hover:text-teal-300">View</Link>
                      )}
                      <button className="text-xs text-slate-500 hover:text-red-400"><Trash2 size={12} className="inline" /></button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {filtered.length === 0 && (
          <div className="py-12 text-center text-slate-500 text-sm">No simulations match your search</div>
        )}
      </div>
    </div>
  )
}
