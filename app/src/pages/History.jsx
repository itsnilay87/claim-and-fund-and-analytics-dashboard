import { useState, useEffect, useCallback } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Search, Filter, CheckCircle2, Loader2, AlertCircle, Trash2, RefreshCw } from 'lucide-react'
import { api } from '../services/api'

const statusConfig = {
  completed: { icon: CheckCircle2, color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
  running: { icon: Loader2, color: 'text-amber-400', bg: 'bg-amber-500/10', spin: true },
  queued: { icon: Loader2, color: 'text-blue-400', bg: 'bg-blue-500/10', spin: true },
  failed: { icon: AlertCircle, color: 'text-red-400', bg: 'bg-red-500/10' },
}

export default function History() {
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all')
  const [runs, setRuns] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const { wsId } = useParams()

  const fetchRuns = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await api.get('/api/runs?limit=50')
      setRuns(data.runs || [])
    } catch (err) {
      setError(err.message)
      setRuns([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchRuns() }, [fetchRuns])

  const handleDelete = async (runId) => {
    try {
      await api.delete(`/api/runs/${encodeURIComponent(runId)}`)
      setRuns((prev) => prev.filter((r) => r.id !== runId))
    } catch (err) {
      console.error('Failed to delete run:', err.message)
    }
  }

  const filtered = runs.filter((r) => {
    if (filter !== 'all' && r.status !== filter) return false
    if (search && !(r.name || '').toLowerCase().includes(search.toLowerCase()) &&
        !(r.structure_type || '').toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  const formatDate = (iso) => {
    if (!iso) return '-'
    return new Date(iso).toLocaleString(undefined, {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    })
  }

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
          {['all', 'completed', 'running', 'queued', 'failed'].map((f) => (
            <button key={f} onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                filter === f ? 'bg-teal-50 dark:bg-teal-500/20 text-teal-700 dark:text-teal-300 border border-teal-200 dark:border-teal-500/30' : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-50 dark:hover:bg-white/5'
              }`}>
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
          <button onClick={fetchRuns} className="ml-2 p-1.5 rounded-lg text-slate-400 hover:text-teal-500 hover:bg-slate-50 dark:hover:bg-white/5 transition-colors" title="Refresh">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400 text-sm">{error}</div>
      )}

      {loading ? (
        <div className="py-16 text-center text-slate-400"><Loader2 size={24} className="animate-spin mx-auto mb-2" />Loading runs…</div>
      ) : (
      <div className="glass-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="text-xs text-slate-500 uppercase tracking-wider border-b border-slate-200 dark:border-white/5">
                <th className="text-left py-3 px-5 font-medium">Simulation</th>
                <th className="text-left py-3 px-5 font-medium">Type</th>
                <th className="text-left py-3 px-5 font-medium">Status</th>
                <th className="text-left py-3 px-5 font-medium">Date</th>
                <th className="text-right py-3 px-5 font-medium">MOIC</th>
                <th className="text-right py-3 px-5 font-medium">IRR</th>
                <th className="text-right py-3 px-5 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((run) => {
                const sc = statusConfig[run.status] || statusConfig.completed
                const summary = run.summary || {}
                return (
                  <tr key={run.id} className="border-b border-slate-100 dark:border-white/5 hover:bg-slate-50 dark:hover:bg-white/[0.02] transition-colors">
                    <td className="py-3.5 px-5 text-sm text-slate-900 dark:text-white font-medium">{run.name || `Run ${run.id.slice(0, 8)}`}</td>
                    <td className="py-3.5 px-5 text-sm text-slate-500 dark:text-slate-400 capitalize">{run.structure_type || '-'}</td>
                    <td className="py-3.5 px-5">
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${sc.bg} ${sc.color}`}>
                        <sc.icon size={12} className={sc.spin ? 'animate-spin' : ''} />
                        {run.status}
                      </span>
                    </td>
                    <td className="py-3.5 px-5 text-sm text-slate-500 dark:text-slate-400">{formatDate(run.created_at)}</td>
                    <td className="py-3.5 px-5 text-sm text-slate-900 dark:text-white text-right font-mono">{summary.moic ?? '-'}</td>
                    <td className="py-3.5 px-5 text-sm text-slate-900 dark:text-white text-right font-mono">{summary.irr ?? '-'}</td>
                    <td className="py-3.5 px-5 text-right space-x-2">
                      {run.status === 'completed' && (
                        <Link to={`/workspace/${wsId}/portfolio/${run.id}/results`} className="text-xs text-teal-600 dark:text-teal-400 hover:text-teal-500 dark:hover:text-teal-300">View</Link>
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
          <div className="py-12 text-center text-slate-500 text-sm">No simulations match your search</div>
        )}
      </div>
      )}
    </div>
  )
}
