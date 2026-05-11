import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { useFundStore } from '../../store/fundStore'
import { Search, Filter, CheckCircle2, Loader2, AlertCircle, Trash2, RefreshCw, Bookmark } from 'lucide-react'

const statusConfig = {
  completed: { icon: CheckCircle2, color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
  running: { icon: Loader2, color: 'text-amber-400', bg: 'bg-amber-500/10', spin: true },
  queued: { icon: Loader2, color: 'text-blue-400', bg: 'bg-blue-500/10', spin: true },
  failed: { icon: AlertCircle, color: 'text-red-400', bg: 'bg-red-500/10' },
}

export default function FundHistory() {
  const { simulations, fetchSimulations, deleteSimulation, saveSimulation, loading } = useFundStore()
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all')
  const [error, setError] = useState(null)

  const fetchRuns = useCallback(async () => {
    setError(null)
    try {
      await fetchSimulations('limit=50')
    } catch (err) {
      setError(err.message)
    }
  }, [fetchSimulations])

  useEffect(() => { fetchRuns() }, [fetchRuns])

  const handleDelete = async (id) => {
    await deleteSimulation(id)
  }

  const handleSave = async (id, name) => {
    await saveSimulation(id, name)
  }

  const filtered = simulations.filter((r) => {
    if (filter !== 'all' && r.status !== filter) return false
    if (search && !(r.name || '').toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  const formatDate = (iso) => {
    if (!iso) return '-'
    return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  }

  return (
    <div className="space-y-6 animate-fade-in-up">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Fund Simulation History</h1>
        <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">View and manage past fund simulations</p>
      </div>

      <div className="flex flex-col md:flex-row gap-3">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500" />
          <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search simulations..."
            className="w-full pl-10 pr-4 py-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-white/10 text-sm text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500" />
        </div>
        <div className="flex items-center gap-2">
          <Filter size={14} className="text-slate-400 dark:text-slate-500" />
          {['all', 'completed', 'running', 'queued', 'failed'].map((f) => (
            <button key={f} onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                filter === f ? 'bg-blue-50 dark:bg-blue-500/20 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-500/30' : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-50 dark:hover:bg-white/5'
              }`}>
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
          <button onClick={fetchRuns} className="ml-2 p-1.5 rounded-lg text-slate-400 hover:text-blue-500 hover:bg-slate-50 dark:hover:bg-white/5 transition-colors" title="Refresh">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {error && <div className="p-3 rounded-lg bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400 text-sm">{error}</div>}

      {loading ? (
        <div className="py-16 text-center text-slate-400"><Loader2 size={24} className="animate-spin mx-auto mb-2" />Loading simulations…</div>
      ) : (
        <div className="bg-white dark:bg-slate-900/50 rounded-xl border border-slate-200 dark:border-white/5 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="text-xs text-slate-500 uppercase tracking-wider border-b border-slate-200 dark:border-white/5">
                  <th className="text-left py-3 px-5 font-medium">Simulation</th>
                  <th className="text-left py-3 px-5 font-medium">Mode</th>
                  <th className="text-left py-3 px-5 font-medium">Status</th>
                  <th className="text-left py-3 px-5 font-medium">Profile</th>
                  <th className="text-left py-3 px-5 font-medium">Sims</th>
                  <th className="text-left py-3 px-5 font-medium">Date</th>
                  <th className="text-right py-3 px-5 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((run) => {
                  const sc = statusConfig[run.status] || statusConfig.completed
                  return (
                    <tr key={run.id} className="border-b border-slate-100 dark:border-white/5 hover:bg-slate-50 dark:hover:bg-white/[0.02] transition-colors">
                      <td className="py-3.5 px-5 text-sm text-slate-900 dark:text-white font-medium">
                        <div className="flex items-center gap-2">
                          <span>{run.name || `Simulation ${run.id.slice(0, 8)}`}</span>
                          {run.saved && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-500/20">Saved</span>
                          )}
                        </div>
                      </td>
                      <td className="py-3.5 px-5 text-sm">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium capitalize ${
                          run.mode === 'case' ? 'bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-500/20' : 'bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-500/20'
                        }`}>{run.mode || 'fund'}</span>
                      </td>
                      <td className="py-3.5 px-5">
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${sc.bg} ${sc.color}`}>
                          <sc.icon size={12} className={sc.spin ? 'animate-spin' : ''} /> {run.status}
                        </span>
                      </td>
                      <td className="py-3.5 px-5 text-sm text-slate-500 dark:text-slate-400">{run.funding_profile || '-'}</td>
                      <td className="py-3.5 px-5 text-sm text-slate-500 dark:text-slate-400 font-mono">{run.num_simulations?.toLocaleString() || '-'}</td>
                      <td className="py-3.5 px-5 text-sm text-slate-500 dark:text-slate-400">{formatDate(run.created_at)}</td>
                      <td className="py-3.5 px-5 text-right space-x-2">
                        {run.status === 'completed' && (
                          <Link to={`/fund-analytics/results/${run.id}`} className="text-xs text-blue-600 dark:text-blue-400 hover:text-blue-500 dark:hover:text-blue-300">View</Link>
                        )}
                        {!run.saved && run.status === 'completed' && (
                          <button onClick={() => handleSave(run.id, run.name)} className="text-xs text-slate-500 hover:text-blue-400"><Bookmark size={12} className="inline" /></button>
                        )}
                        <button onClick={() => handleDelete(run.id)} className="text-xs text-slate-500 hover:text-red-400"><Trash2 size={12} className="inline" /></button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {filtered.length === 0 && (
            <div className="py-12 text-center text-slate-500 text-sm">No fund simulations found</div>
          )}
        </div>
      )}
    </div>
  )
}
