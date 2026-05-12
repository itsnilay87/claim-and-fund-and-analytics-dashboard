import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useFundStore } from '../../store/fundStore'
import { useFundSimulationPolling } from '../../hooks/useFundSimulation'
import { Save, RotateCcw, Trash2, Loader2, Plus, FileJson, Download, Code, Play, X } from 'lucide-react'
import ParameterTable, { ArrayParameterTable } from '../../components/fund/ParameterTable'
import {
  FUND_FIELDS, UNIT_CLASS_FIELDS, INVESTOR_FIELDS,
  PORTFOLIO_FIELDS, SIMULATION_FIELDS, CLAIMS_FIELDS,
  CHALLENGE_STAGE_FIELDS, SCENARIO_FUND_FIELDS, SCENARIO_CLAIMS_FIELDS,
} from '../../components/fund/parameterConfig'

const TABS = [
  { key: 'fund', label: 'Fund Parameters' },
  { key: 'portfolio', label: 'Portfolio' },
  { key: 'simulation', label: 'Simulation' },
  { key: 'claims', label: 'Claims' },
  { key: 'scenarios', label: 'Scenarios' },
]

const SCENARIO_NAMES = ['base', 'upside', 'downside', 'stress', 'failure']

const DEFAULT_INVESTOR = { name: '', class_name: 'A1', commitment: 0, unit_price: 1000, carry_rate: 0.2 }
const DEFAULT_UNIT_CLASS = { class_name: '', management_fee_rate: 0.02, performance_fee_rate: 0.2, unit_face_value: 1000 }
const DEFAULT_CHALLENGE_STAGE = { stage_type: '', description: '', duration_months: 6, success_probability: 0.15, time_limit_months: 3, discretionary: false }

const FUNDING_PROFILES = [
  { value: 'UF', label: 'Unfunded (UF)' },
  { value: 'PF', label: 'Pre-Funded (PF)' },
  { value: 'HY', label: 'Hybrid (HY)' },
]

export default function FundParameterEditor() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { parameters, defaultParameters, fetchParameters, fetchDefaultParameters, saveParameters, updateParameters, deleteParameters, startSimulation, error: storeError, clearError } = useFundStore()

  const [activeTab, setActiveTab] = useState('fund')
  const [activeScenario, setActiveScenario] = useState('base')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [params, setParams] = useState(null)
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [showJson, setShowJson] = useState(false)

  // ── Run Simulation modal state ──
  const [showRunModal, setShowRunModal] = useState(false)
  const [runName, setRunName] = useState('')
  const [runSims, setRunSims] = useState(1000)
  const [runScenario, setRunScenario] = useState('base')
  const [runFundingProfile, setRunFundingProfile] = useState('UF')
  const [runSensitivity, setRunSensitivity] = useState(false)
  const [runSensitivityDivisor, setRunSensitivityDivisor] = useState(5)
  const [runSubmitting, setRunSubmitting] = useState(false)
  const [activeRunId, setActiveRunId] = useState(null)
  const [runError, setRunError] = useState(null)

  const { status: runStatus, progress: runProgress, stage: runStage, isTerminal: runTerminal } =
    useFundSimulationPolling(activeRunId, { enabled: !!activeRunId })

  useEffect(() => {
    if (runTerminal && runStatus === 'completed' && activeRunId) {
      navigate(`/fund-analytics/results/${activeRunId}`)
    }
  }, [runTerminal, runStatus, activeRunId, navigate])

  const SCENARIO_OPTIONS = ['base', 'upside', 'downside', 'stress', 'failure']

  const handleLaunchRun = async () => {
    setRunSubmitting(true)
    setRunError(null)
    clearError && clearError()
    try {
      const result = await startSimulation({
        parametersId: id || undefined,
        name: runName || name || `Run ${new Date().toLocaleString()}`,
        simulations: runSims,
        scenario: runScenario,
        fundingProfile: runFundingProfile,
        sensitivity: runSensitivity,
        sensitivityDivisor: runSensitivity ? runSensitivityDivisor : undefined,
        // Use the in-editor parameters as a live override so unsaved edits
        // are still respected without forcing the user to save first.
        customParameters: params,
      })
      setActiveRunId(result.id)
    } catch (err) {
      setRunError(err?.message || 'Failed to start simulation')
      setRunSubmitting(false)
    }
  }

  const closeRunModal = () => {
    if (runSubmitting && !runTerminal) return // don't allow close mid-submit
    setShowRunModal(false)
    setActiveRunId(null)
    setRunSubmitting(false)
    setRunError(null)
  }

  const loadData = useCallback(async () => {
    setLoading(true)
    await fetchParameters()
    if (!defaultParameters) await fetchDefaultParameters()
    setLoading(false)
  }, [fetchParameters, fetchDefaultParameters, defaultParameters])

  useEffect(() => { loadData() }, [loadData])

  useEffect(() => {
    if (id && parameters.length > 0) {
      const param = parameters.find((p) => p.id === id)
      if (param) {
        setName(param.name || '')
        setDescription(param.description || '')
        setParams(JSON.parse(JSON.stringify(param.parameters || {})))
      }
    } else if (!id && defaultParameters) {
      setName('')
      setDescription('')
      setParams(JSON.parse(JSON.stringify(defaultParameters)))
    }
  }, [id, parameters, defaultParameters])

  const updateSection = (section, key, value) => {
    setParams((prev) => ({
      ...prev,
      [section]: { ...prev[section], [key]: value },
    }))
  }

  const updateScenario = (scenario, subSection, key, value) => {
    setParams((prev) => ({
      ...prev,
      scenarios: {
        ...prev.scenarios,
        [scenario]: {
          ...prev.scenarios?.[scenario],
          [subSection]: {
            ...prev.scenarios?.[scenario]?.[subSection],
            [key]: value,
          },
        },
      },
    }))
  }

  const updateArray = (section, arrayKey, newArray) => {
    setParams((prev) => ({
      ...prev,
      [section]: { ...prev[section], [arrayKey]: newArray },
    }))
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      if (id) {
        await updateParameters(id, { name, description, parameters: params })
      } else {
        const created = await saveParameters({ name: name || 'Untitled Parameters', description, parameters: params })
        navigate(`/fund-analytics/parameters/${created.id}`, { replace: true })
      }
    } catch (err) {
      console.error('Failed to save:', err)
    }
    setSaving(false)
  }

  const handleReset = () => {
    if (defaultParameters) {
      setParams(JSON.parse(JSON.stringify(defaultParameters)))
    }
  }

  const handleDelete = async () => {
    if (!id) return
    await deleteParameters(id)
    navigate('/fund-analytics/parameters')
  }

  const handleDownloadJson = () => {
    const blob = new Blob([JSON.stringify(params, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${name || 'fund_parameters'}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (loading || !params) return <div className="py-16 text-center text-slate-400"><Loader2 size={24} className="animate-spin mx-auto mb-2" />Loading parameters…</div>

  return (
    <div className="space-y-6 animate-fade-in-up">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{id ? 'Edit Parameters' : 'Fund Parameters'}</h1>
          <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">Edit fund parameters in the table below</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowJson(!showJson)}
            className="px-3 py-2 rounded-lg text-sm text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5 flex items-center gap-1.5">
            <Code size={14} /> {showJson ? 'Table View' : 'JSON View'}
          </button>
          <button onClick={handleDownloadJson}
            className="px-3 py-2 rounded-lg text-sm text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5 flex items-center gap-1.5">
            <Download size={14} /> Download JSON
          </button>
          <button onClick={() => { setRunName(name || ''); setShowRunModal(true) }}
            className="px-4 py-2 rounded-lg text-sm font-semibold bg-gradient-to-r from-blue-600 to-cyan-500 hover:from-blue-500 hover:to-cyan-400 text-white flex items-center gap-1.5 shadow-sm">
            <Play size={14} /> Run Simulation
          </button>
        </div>
      </div>

      {/* Run Simulation Modal */}
      {showRunModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-white/10 shadow-2xl">
            <div className="flex items-center justify-between p-5 border-b border-slate-200 dark:border-white/5">
              <h2 className="text-lg font-bold text-slate-900 dark:text-white">
                {activeRunId ? (runTerminal ? (runStatus === 'completed' ? 'Simulation Complete' : 'Simulation Failed') : 'Simulation Running') : 'Run Simulation'}
              </h2>
              <button onClick={closeRunModal}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/5 disabled:opacity-30"
                disabled={!!activeRunId && !runTerminal}>
                <X size={18} />
              </button>
            </div>

            <div className="p-5 space-y-4">
              {!activeRunId && (
                <>
                  <div>
                    <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">Run Name</label>
                    <input type="text" value={runName} onChange={(e) => setRunName(e.target.value)}
                      placeholder="e.g., Stress test — Q2 2026"
                      className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-white/10 text-sm text-slate-900 dark:text-white" />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">Simulations</label>
                      <input type="number" value={runSims}
                        onChange={(e) => setRunSims(Math.max(100, Math.min(50000, Number(e.target.value) || 0)))}
                        min={100} max={50000} step={100}
                        className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-white/10 text-sm text-slate-900 dark:text-white" />
                      <p className="text-[11px] text-slate-400 mt-1">100–50,000</p>
                    </div>
                    <div>
                      <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">Scenario</label>
                      <select value={runScenario} onChange={(e) => setRunScenario(e.target.value)}
                        className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-white/10 text-sm text-slate-900 dark:text-white">
                        {SCENARIO_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">Funding Profile</label>
                    <div className="flex gap-2">
                      {FUNDING_PROFILES.map(({ value, label }) => (
                        <button key={value} onClick={() => setRunFundingProfile(value)}
                          className={`flex-1 px-3 py-2 rounded-lg text-xs font-medium border transition-all ${
                            runFundingProfile === value
                              ? 'bg-blue-50 dark:bg-blue-500/20 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-500/30'
                              : 'text-slate-500 dark:text-slate-400 border-slate-200 dark:border-white/10 hover:bg-slate-50 dark:hover:bg-white/5'
                          }`}>
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" checked={runSensitivity} onChange={(e) => setRunSensitivity(e.target.checked)} className="rounded" />
                      <span className="text-sm text-slate-700 dark:text-slate-300">Enable sensitivity analysis</span>
                    </label>
                    {runSensitivity && (
                      <div className="mt-2">
                        <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">Sensitivity divisor</label>
                        <input type="number" value={runSensitivityDivisor}
                          onChange={(e) => setRunSensitivityDivisor(Math.max(2, Math.min(20, Number(e.target.value) || 5)))}
                          min={2} max={20}
                          className="w-32 px-3 py-1.5 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-white/10 text-sm text-slate-900 dark:text-white" />
                      </div>
                    )}
                  </div>
                  {(runError || storeError) && (
                    <div className="p-3 rounded-lg bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400 text-sm">
                      {runError || storeError}
                    </div>
                  )}
                  <p className="text-[11px] text-slate-400">Uses the parameters currently in the editor as a live override (no save required).</p>
                </>
              )}

              {activeRunId && !runTerminal && (
                <div className="text-center py-4 space-y-4">
                  <Loader2 size={32} className="text-blue-500 animate-spin mx-auto" />
                  <p className="text-sm text-slate-500 dark:text-slate-400">{runStage || 'Initializing…'}</p>
                  <div className="w-full bg-slate-200 dark:bg-slate-800 rounded-full h-2">
                    <div className="bg-blue-500 h-2 rounded-full transition-all duration-500" style={{ width: `${runProgress}%` }} />
                  </div>
                  <p className="text-xs text-slate-400">{runProgress}% complete</p>
                </div>
              )}

              {activeRunId && runTerminal && runStatus === 'failed' && (
                <div className="text-center py-4 space-y-3">
                  <p className="text-red-500 text-sm font-medium">Simulation failed.</p>
                  <p className="text-xs text-slate-400">{runStage || storeError || 'See logs for details.'}</p>
                </div>
              )}
            </div>

            {!activeRunId && (
              <div className="flex items-center justify-end gap-2 p-5 border-t border-slate-200 dark:border-white/5">
                <button onClick={closeRunModal}
                  className="px-4 py-2 rounded-lg text-sm text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/5">
                  Cancel
                </button>
                <button onClick={handleLaunchRun} disabled={runSubmitting}
                  className="px-5 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold disabled:opacity-50 flex items-center gap-2">
                  {runSubmitting ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
                  Launch
                </button>
              </div>
            )}
            {activeRunId && runTerminal && runStatus === 'failed' && (
              <div className="flex items-center justify-end gap-2 p-5 border-t border-slate-200 dark:border-white/5">
                <button onClick={closeRunModal}
                  className="px-5 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold">
                  Close
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Saved parameter sets */}
      {parameters.length > 0 && (
        <div className="flex gap-2 flex-wrap">
          <button onClick={() => navigate('/fund-analytics/parameters')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all border ${
              !id ? 'bg-blue-50 dark:bg-blue-500/20 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-500/30' : 'text-slate-500 dark:text-slate-400 border-slate-200 dark:border-white/10 hover:bg-slate-50 dark:hover:bg-white/5'
            }`}>
            Default
          </button>
          {parameters.map((p) => (
            <button key={p.id} onClick={() => navigate(`/fund-analytics/parameters/${p.id}`)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all border ${
                p.id === id ? 'bg-blue-50 dark:bg-blue-500/20 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-500/30' : 'text-slate-500 dark:text-slate-400 border-slate-200 dark:border-white/10 hover:bg-slate-50 dark:hover:bg-white/5'
              }`}>
              <FileJson size={12} className="inline mr-1" />{p.name}
            </button>
          ))}
        </div>
      )}

      {/* Name & description */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">Name</label>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g., Conservative Scenario"
            className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-white/10 text-sm text-slate-900 dark:text-white" />
        </div>
        <div>
          <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">Description</label>
          <input type="text" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional description"
            className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-white/10 text-sm text-slate-900 dark:text-white" />
        </div>
      </div>

      {showJson ? (
        /* JSON view */
        <div>
          <textarea value={JSON.stringify(params, null, 2)} readOnly rows={30} spellCheck={false}
            className="w-full px-4 py-3 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-white/10 text-sm font-mono text-slate-900 dark:text-white resize-y" />
        </div>
      ) : (
        <>
          {/* Tabs */}
          <div className="flex gap-1 border-b border-slate-200 dark:border-white/5">
            {TABS.map((tab) => (
              <button key={tab.key} onClick={() => setActiveTab(tab.key)}
                className={`px-4 py-2.5 text-sm font-medium transition-all border-b-2 -mb-px ${
                  activeTab === tab.key
                    ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                    : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}>
                {tab.label}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div className="space-y-8">
            {activeTab === 'fund' && (
              <>
                <ParameterTable fields={FUND_FIELDS} data={params.fund || {}} onChange={(key, val) => updateSection('fund', key, val)} />
                <ArrayParameterTable fields={UNIT_CLASS_FIELDS} items={params.fund?.unit_classes || []}
                  onChange={(arr) => updateArray('fund', 'unit_classes', arr)}
                  onAdd={() => updateArray('fund', 'unit_classes', [...(params.fund?.unit_classes || []), { ...DEFAULT_UNIT_CLASS }])}
                  onRemove={(idx) => updateArray('fund', 'unit_classes', (params.fund?.unit_classes || []).filter((_, i) => i !== idx))}
                  title="Unit Classes" itemLabel="Unit Class" />
                <ArrayParameterTable fields={INVESTOR_FIELDS} items={params.fund?.investors || []}
                  onChange={(arr) => updateArray('fund', 'investors', arr)}
                  onAdd={() => updateArray('fund', 'investors', [...(params.fund?.investors || []), { ...DEFAULT_INVESTOR, name: `LP Investor ${(params.fund?.investors?.length || 0) + 1}` }])}
                  onRemove={(idx) => updateArray('fund', 'investors', (params.fund?.investors || []).filter((_, i) => i !== idx))}
                  title="Investors" itemLabel="Investor" />
              </>
            )}

            {activeTab === 'portfolio' && (
              <ParameterTable fields={PORTFOLIO_FIELDS} data={params.portfolio || {}} onChange={(key, val) => updateSection('portfolio', key, val)} />
            )}

            {activeTab === 'simulation' && (
              <ParameterTable fields={SIMULATION_FIELDS} data={params.simulation || {}} onChange={(key, val) => updateSection('simulation', key, val)} />
            )}

            {activeTab === 'claims' && (
              <>
                <ParameterTable fields={CLAIMS_FIELDS} data={params.claims || {}} onChange={(key, val) => updateSection('claims', key, val)} />
                <ArrayParameterTable fields={CHALLENGE_STAGE_FIELDS} items={params.claims?.challenge_stages || []}
                  onChange={(arr) => updateArray('claims', 'challenge_stages', arr)}
                  onAdd={() => updateArray('claims', 'challenge_stages', [...(params.claims?.challenge_stages || []), { ...DEFAULT_CHALLENGE_STAGE }])}
                  onRemove={(idx) => updateArray('claims', 'challenge_stages', (params.claims?.challenge_stages || []).filter((_, i) => i !== idx))}
                  title="Challenge Stages" itemLabel="Stage" />
              </>
            )}

            {activeTab === 'scenarios' && (
              <>
                <div className="flex gap-2 flex-wrap">
                  {SCENARIO_NAMES.map((s) => (
                    <button key={s} onClick={() => setActiveScenario(s)}
                      className={`px-4 py-2 rounded-lg text-sm font-medium transition-all border capitalize ${
                        activeScenario === s
                          ? 'bg-blue-50 dark:bg-blue-500/20 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-500/30'
                          : 'text-slate-500 dark:text-slate-400 border-slate-200 dark:border-white/10 hover:bg-slate-50 dark:hover:bg-white/5'
                      }`}>
                      {s === 'base' ? 'Base Case' : s}
                    </button>
                  ))}
                </div>

                {activeScenario === 'base' ? (
                  <div className="p-6 bg-white dark:bg-slate-900/50 rounded-xl border border-slate-200 dark:border-white/5 text-center text-slate-500 dark:text-slate-400 text-sm">
                    Base scenario uses the default fund and claims parameters above — no overrides.
                  </div>
                ) : (
                  <div className="space-y-6">
                    <ParameterTable
                      title={`${activeScenario.charAt(0).toUpperCase() + activeScenario.slice(1)} — Fund Overrides`}
                      fields={SCENARIO_FUND_FIELDS}
                      data={params.scenarios?.[activeScenario]?.fund || {}}
                      onChange={(key, val) => updateScenario(activeScenario, 'fund', key, val)}
                    />
                    <ParameterTable
                      title={`${activeScenario.charAt(0).toUpperCase() + activeScenario.slice(1)} — Claims Overrides`}
                      fields={SCENARIO_CLAIMS_FIELDS}
                      data={params.scenarios?.[activeScenario]?.claims || {}}
                      onChange={(key, val) => updateScenario(activeScenario, 'claims', key, val)}
                    />
                  </div>
                )}
              </>
            )}
          </div>
        </>
      )}

      {/* Actions */}
      <div className="flex items-center gap-3 pt-4 border-t border-slate-200 dark:border-white/5">
        <button onClick={handleSave} disabled={saving}
          className="px-5 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium disabled:opacity-50 flex items-center gap-2">
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          {id ? 'Update' : 'Save as New'}
        </button>
        <button onClick={handleReset}
          className="px-4 py-2.5 rounded-lg text-sm text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/5 flex items-center gap-2">
          <RotateCcw size={14} /> Reset to Default
        </button>
        {id && (
          <button onClick={handleDelete}
            className="px-4 py-2.5 rounded-lg text-sm text-red-500 hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 flex items-center gap-2 ml-auto">
            <Trash2 size={14} /> Delete
          </button>
        )}
      </div>
    </div>
  )
}
