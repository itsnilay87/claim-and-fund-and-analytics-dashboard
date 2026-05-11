import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useFundStore } from '../../store/fundStore'
import { useFundSimulationPolling } from '../../hooks/useFundSimulation'
import { Play, Loader2, Settings2, CheckCircle2 } from 'lucide-react'

const SCENARIO_OPTIONS = ['base', 'bull', 'bear', 'stress']
const FUNDING_PROFILES = [
  { value: 'UF', label: 'Unfunded (UF)' },
  { value: 'PF', label: 'Pre-Funded (PF)' },
  { value: 'HY', label: 'Hybrid (HY)' },
]

export default function FundSimulate() {
  const navigate = useNavigate()
  const { parameters, fetchParameters, startSimulation, error, clearError } = useFundStore()

  const [parametersId, setParametersId] = useState('')
  const [name, setName] = useState('')
  const [simulations, setSimulations] = useState(1000)
  const [scenario, setScenario] = useState('base')
  const [scenarios, setScenarios] = useState([])
  const [allScenarios, setAllScenarios] = useState(false)
  const [sensitivity, setSensitivity] = useState(false)
  const [sensitivityDivisor, setSensitivityDivisor] = useState(5)
  const [fundingProfile, setFundingProfile] = useState('UF')
  const [submitting, setSubmitting] = useState(false)
  const [activeRunId, setActiveRunId] = useState(null)

  const { status, progress, stage, isTerminal } = useFundSimulationPolling(activeRunId, { enabled: !!activeRunId })

  useEffect(() => { fetchParameters() }, [fetchParameters])

  useEffect(() => {
    if (isTerminal && status === 'completed' && activeRunId) {
      navigate(`/fund-analytics/results/${activeRunId}`)
    }
  }, [isTerminal, status, activeRunId, navigate])

  const handleScenarioToggle = (s) => {
    setScenarios((prev) => prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s])
  }

  const handleSubmit = async () => {
    setSubmitting(true)
    clearError()
    try {
      const result = await startSimulation({
        parametersId: parametersId || undefined,
        name: name || `Fund Sim ${new Date().toLocaleDateString()}`,
        simulations,
        scenario: scenarios.length > 0 ? undefined : scenario,
        scenarios: scenarios.length > 0 ? scenarios : undefined,
        allScenarios,
        sensitivity,
        sensitivityDivisor: sensitivity ? sensitivityDivisor : undefined,
        fundingProfile,
      })
      setActiveRunId(result.id)
    } catch {
      setSubmitting(false)
    }
  }

  if (activeRunId && !isTerminal) {
    return (
      <div className="max-w-lg mx-auto mt-16 text-center space-y-6 animate-fade-in-up">
        <div className="w-16 h-16 rounded-full bg-blue-50 dark:bg-blue-500/10 flex items-center justify-center mx-auto">
          <Loader2 size={28} className="text-blue-500 animate-spin" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-white">Simulation Running</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{stage || 'Initializing...'}</p>
        </div>
        <div className="w-full bg-slate-200 dark:bg-slate-800 rounded-full h-3">
          <div className="bg-blue-500 h-3 rounded-full transition-all duration-500" style={{ width: `${progress}%` }} />
        </div>
        <p className="text-sm text-slate-500 dark:text-slate-400">{progress}% complete</p>
      </div>
    )
  }

  if (activeRunId && status === 'failed') {
    return (
      <div className="max-w-lg mx-auto mt-16 text-center space-y-4 animate-fade-in-up">
        <div className="text-red-400 text-lg font-semibold">Simulation Failed</div>
        <p className="text-sm text-slate-400">{error || 'An unexpected error occurred.'}</p>
        <button onClick={() => { setActiveRunId(null); setSubmitting(false) }} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm text-white">
          Try Again
        </button>
      </div>
    )
  }

  return (
    <div className="max-w-2xl space-y-8 animate-fade-in-up">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Run Fund Simulation</h1>
        <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">Configure and launch a Monte Carlo fund simulation</p>
      </div>

      {error && <div className="p-3 rounded-lg bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400 text-sm">{error}</div>}

      <div className="bg-white dark:bg-slate-900/50 rounded-xl border border-slate-200 dark:border-white/5 p-6 space-y-6">
        {/* Name */}
        <div>
          <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">Simulation Name</label>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Optional name"
            className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-white/10 text-sm text-slate-900 dark:text-white" />
        </div>

        {/* Parameters set */}
        <div>
          <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">
            <Settings2 size={12} className="inline mr-1" /> Parameter Set
          </label>
          <select value={parametersId} onChange={(e) => setParametersId(e.target.value)}
            className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-white/10 text-sm text-slate-900 dark:text-white">
            <option value="">Default (fund_parameters.json)</option>
            {parameters.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>

        {/* Simulations count */}
        <div>
          <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">Number of Simulations</label>
          <input type="number" value={simulations} onChange={(e) => setSimulations(Number(e.target.value))} min={100} max={50000} step={100}
            className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-white/10 text-sm text-slate-900 dark:text-white" />
          <p className="text-xs text-slate-400 mt-1">Higher = more accurate, slower (100–50,000)</p>
        </div>

        {/* Funding profile */}
        <div>
          <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">Funding Profile</label>
          <div className="flex gap-2">
            {FUNDING_PROFILES.map(({ value, label }) => (
              <button key={value} onClick={() => setFundingProfile(value)}
                className={`px-3 py-2 rounded-lg text-sm font-medium border transition-all ${
                  fundingProfile === value
                    ? 'bg-blue-50 dark:bg-blue-500/20 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-500/30'
                    : 'text-slate-500 dark:text-slate-400 border-slate-200 dark:border-white/10 hover:bg-slate-50 dark:hover:bg-white/5'
                }`}>
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Scenarios */}
        <div>
          <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">Scenarios</label>
          <div className="flex items-center gap-2 flex-wrap">
            {SCENARIO_OPTIONS.map((s) => (
              <button key={s} onClick={() => handleScenarioToggle(s)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all capitalize ${
                  scenarios.includes(s)
                    ? 'bg-blue-50 dark:bg-blue-500/20 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-500/30'
                    : 'text-slate-500 dark:text-slate-400 border-slate-200 dark:border-white/10 hover:bg-slate-50 dark:hover:bg-white/5'
                }`}>
                {s}
              </button>
            ))}
            <label className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 ml-2 cursor-pointer">
              <input type="checkbox" checked={allScenarios} onChange={(e) => setAllScenarios(e.target.checked)} className="rounded" />
              All scenarios
            </label>
          </div>
          {scenarios.length === 0 && !allScenarios && (
            <div className="mt-2">
              <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">Default scenario</label>
              <select value={scenario} onChange={(e) => setScenario(e.target.value)}
                className="px-3 py-1.5 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-white/10 text-sm text-slate-900 dark:text-white">
                {SCENARIO_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          )}
        </div>

        {/* Sensitivity */}
        <div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={sensitivity} onChange={(e) => setSensitivity(e.target.checked)} className="rounded" />
            <span className="text-sm text-slate-700 dark:text-slate-300">Enable sensitivity analysis</span>
          </label>
          {sensitivity && (
            <div className="mt-2">
              <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">Sensitivity divisor</label>
              <input type="number" value={sensitivityDivisor} onChange={(e) => setSensitivityDivisor(Number(e.target.value))} min={2} max={20}
                className="w-32 px-3 py-1.5 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-white/10 text-sm text-slate-900 dark:text-white" />
            </div>
          )}
        </div>
      </div>

      {/* Submit */}
      <button onClick={handleSubmit} disabled={submitting}
        className="w-full px-6 py-3 rounded-xl bg-gradient-to-r from-blue-600 to-cyan-500 hover:from-blue-500 hover:to-cyan-400 text-white text-sm font-semibold disabled:opacity-50 flex items-center justify-center gap-2 transition-all">
        {submitting ? <Loader2 size={18} className="animate-spin" /> : <Play size={18} />}
        Launch Simulation
      </button>
    </div>
  )
}
