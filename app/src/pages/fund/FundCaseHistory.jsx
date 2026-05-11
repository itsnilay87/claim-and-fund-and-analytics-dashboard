import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { fundApi } from '../../services/fundApi'
import { Loader2, CheckCircle2, AlertCircle, FlaskConical } from 'lucide-react'

export default function FundCaseHistory() {
  const [cases, setCases] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const fetchCases = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const { data } = await fundApi.getCaseHistory()
      setCases(data || [])
    } catch (err) {
      setError(err.message)
    }
    setLoading(false)
  }, [])

  useEffect(() => { fetchCases() }, [fetchCases])

  const formatDate = (iso) => {
    if (!iso) return '-'
    return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  }

  return (
    <div className="space-y-6 animate-fade-in-up">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Case Simulation History</h1>
        <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">Past individual case simulations</p>
      </div>

      {error && <div className="p-3 rounded-lg bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400 text-sm">{error}</div>}

      {loading ? (
        <div className="py-16 text-center text-slate-400"><Loader2 size={24} className="animate-spin mx-auto mb-2" />Loading…</div>
      ) : cases.length === 0 ? (
        <div className="py-16 text-center">
          <FlaskConical size={32} className="mx-auto text-slate-400 mb-3" />
          <p className="text-slate-500 text-sm">No case simulations yet</p>
          <Link to="/fund-analytics/case/new" className="text-sm text-blue-500 hover:text-blue-400 mt-2 inline-block">Create your first case simulation</Link>
        </div>
      ) : (
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
              {cases.map((c) => (
                <tr key={c.id} className="border-b border-slate-100 dark:border-white/5 hover:bg-slate-50 dark:hover:bg-white/[0.02] transition-colors">
                  <td className="py-3.5 px-5 text-sm text-slate-900 dark:text-white font-medium">{c.name || `Case ${c.id.slice(0, 8)}`}</td>
                  <td className="py-3.5 px-5">
                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${
                      c.status === 'completed' ? 'bg-emerald-500/10 text-emerald-400' : c.status === 'failed' ? 'bg-red-500/10 text-red-400' : 'bg-blue-500/10 text-blue-400'
                    }`}>
                      {c.status === 'completed' ? <CheckCircle2 size={12} /> : c.status === 'failed' ? <AlertCircle size={12} /> : <Loader2 size={12} className="animate-spin" />}
                      {c.status}
                    </span>
                  </td>
                  <td className="py-3.5 px-5 text-sm text-slate-500 dark:text-slate-400">{formatDate(c.created_at)}</td>
                  <td className="py-3.5 px-5 text-right">
                    {c.status === 'completed' && (
                      <Link to={`/fund-analytics/case/${c.id}/results`} className="text-xs text-blue-500 hover:text-blue-400">View Results</Link>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
