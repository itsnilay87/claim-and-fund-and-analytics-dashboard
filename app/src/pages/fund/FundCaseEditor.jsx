import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useFundStore } from '../../store/fundStore'
import { Play, Loader2, Plus, Trash2 } from 'lucide-react'

const EMPTY_CASE = {
  name: '',
  claim_amount: 1000000,
  probability_success: 0.6,
  expected_duration_months: 24,
  cost_to_litigate: 200000,
  settlement_ratio: 0.7,
}

export default function FundCaseEditor() {
  const navigate = useNavigate()
  const { submitCase, error, clearError } = useFundStore()
  const [cases, setCases] = useState([{ ...EMPTY_CASE, name: 'Case 1' }])
  const [submitting, setSubmitting] = useState(false)

  const updateCase = (idx, field, value) => {
    setCases((prev) => prev.map((c, i) => i === idx ? { ...c, [field]: value } : c))
  }

  const addCase = () => {
    setCases((prev) => [...prev, { ...EMPTY_CASE, name: `Case ${prev.length + 1}` }])
  }

  const removeCase = (idx) => {
    if (cases.length <= 1) return
    setCases((prev) => prev.filter((_, i) => i !== idx))
  }

  const handleSubmit = async () => {
    setSubmitting(true)
    clearError()
    try {
      const result = await submitCase({ cases })
      navigate(`/fund-analytics/results/${result.id}`)
    } catch {
      setSubmitting(false)
    }
  }

  return (
    <div className="max-w-3xl space-y-6 animate-fade-in-up">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Case Simulation</h1>
        <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">Define individual cases to simulate their combined fund impact</p>
      </div>

      {error && <div className="p-3 rounded-lg bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400 text-sm">{error}</div>}

      {cases.map((c, idx) => (
        <div key={idx} className="bg-white dark:bg-slate-900/50 rounded-xl border border-slate-200 dark:border-white/5 p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Case {idx + 1}</h3>
            {cases.length > 1 && (
              <button onClick={() => removeCase(idx)} className="text-slate-400 hover:text-red-400"><Trash2 size={14} /></button>
            )}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">Name</label>
              <input type="text" value={c.name} onChange={(e) => updateCase(idx, 'name', e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-white/10 text-sm text-slate-900 dark:text-white" />
            </div>
            <div>
              <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">Claim Amount ($)</label>
              <input type="number" value={c.claim_amount} onChange={(e) => updateCase(idx, 'claim_amount', Number(e.target.value))}
                className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-white/10 text-sm text-slate-900 dark:text-white font-mono" />
            </div>
            <div>
              <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">Probability of Success (%)</label>
              <input type="number" value={c.probability_success * 100} onChange={(e) => updateCase(idx, 'probability_success', Number(e.target.value) / 100)}
                min={0} max={100} step={5}
                className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-white/10 text-sm text-slate-900 dark:text-white font-mono" />
            </div>
            <div>
              <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">Expected Duration (months)</label>
              <input type="number" value={c.expected_duration_months} onChange={(e) => updateCase(idx, 'expected_duration_months', Number(e.target.value))}
                min={1} max={120}
                className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-white/10 text-sm text-slate-900 dark:text-white font-mono" />
            </div>
            <div>
              <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">Cost to Litigate ($)</label>
              <input type="number" value={c.cost_to_litigate} onChange={(e) => updateCase(idx, 'cost_to_litigate', Number(e.target.value))}
                className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-white/10 text-sm text-slate-900 dark:text-white font-mono" />
            </div>
            <div>
              <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">Settlement Ratio</label>
              <input type="number" value={c.settlement_ratio} onChange={(e) => updateCase(idx, 'settlement_ratio', Number(e.target.value))}
                min={0} max={1} step={0.05}
                className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-white/10 text-sm text-slate-900 dark:text-white font-mono" />
            </div>
          </div>
        </div>
      ))}

      <button onClick={addCase} className="w-full py-3 rounded-xl border-2 border-dashed border-slate-200 dark:border-white/10 text-sm text-slate-500 dark:text-slate-400 hover:text-blue-500 hover:border-blue-300 dark:hover:border-blue-500/30 transition-all flex items-center justify-center gap-2">
        <Plus size={16} /> Add Case
      </button>

      <button onClick={handleSubmit} disabled={submitting}
        className="w-full px-6 py-3 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-white text-sm font-semibold disabled:opacity-50 flex items-center justify-center gap-2 transition-all">
        {submitting ? <Loader2 size={18} className="animate-spin" /> : <Play size={18} />}
        Run Case Simulation
      </button>
    </div>
  )
}
