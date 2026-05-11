import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useFundStore } from '../../store/fundStore'
import { Save, RotateCcw, Trash2, Loader2, Plus, FileJson } from 'lucide-react'

export default function FundParameterEditor() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { parameters, defaultParameters, fetchParameters, fetchDefaultParameters, saveParameters, updateParameters, deleteParameters } = useFundStore()

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [jsonText, setJsonText] = useState('')
  const [parseError, setParseError] = useState(null)
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)

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
        setJsonText(JSON.stringify(param.parameters, null, 2))
      }
    } else if (!id && defaultParameters) {
      setName('')
      setDescription('')
      setJsonText(JSON.stringify(defaultParameters, null, 2))
    }
  }, [id, parameters, defaultParameters])

  const handleJsonChange = (val) => {
    setJsonText(val)
    try {
      JSON.parse(val)
      setParseError(null)
    } catch (e) {
      setParseError(e.message)
    }
  }

  const handleSave = async () => {
    if (parseError) return
    setSaving(true)
    try {
      const parsed = JSON.parse(jsonText)
      if (id) {
        await updateParameters(id, { name, description, parameters: parsed })
      } else {
        const created = await saveParameters({ name: name || 'Untitled Parameters', description, parameters: parsed })
        navigate(`/fund-analytics/parameters/${created.id}`, { replace: true })
      }
    } catch (err) {
      console.error('Failed to save parameters:', err)
    }
    setSaving(false)
  }

  const handleReset = () => {
    if (defaultParameters) {
      setJsonText(JSON.stringify(defaultParameters, null, 2))
      setParseError(null)
    }
  }

  const handleDelete = async () => {
    if (!id) return
    await deleteParameters(id)
    navigate('/fund-analytics/parameters')
  }

  if (loading) return <div className="py-16 text-center text-slate-400"><Loader2 size={24} className="animate-spin mx-auto mb-2" />Loading parameters…</div>

  return (
    <div className="space-y-6 animate-fade-in-up">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{id ? 'Edit Parameters' : 'Fund Parameters'}</h1>
          <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">Configure simulation input parameters</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => navigate('/fund-analytics/parameters')} className="px-3 py-2 rounded-lg text-sm text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5">
            <Plus size={14} className="inline mr-1" /> New
          </button>
        </div>
      </div>

      {/* Saved parameter sets */}
      {parameters.length > 0 && (
        <div className="flex gap-2 flex-wrap">
          {parameters.map((p) => (
            <button key={p.id} onClick={() => navigate(`/fund-analytics/parameters/${p.id}`)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all border ${
                p.id === id
                  ? 'bg-blue-50 dark:bg-blue-500/20 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-500/30'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white border-slate-200 dark:border-white/10 hover:bg-slate-50 dark:hover:bg-white/5'
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

      {/* JSON editor */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="block text-xs text-slate-500 dark:text-slate-400">Parameters JSON</label>
          {parseError && <span className="text-xs text-red-400">{parseError}</span>}
        </div>
        <textarea value={jsonText} onChange={(e) => handleJsonChange(e.target.value)} rows={24} spellCheck={false}
          className={`w-full px-4 py-3 rounded-lg bg-slate-50 dark:bg-slate-800/50 border text-sm font-mono text-slate-900 dark:text-white resize-y ${
            parseError ? 'border-red-400 dark:border-red-500/50' : 'border-slate-200 dark:border-white/10'
          }`} />
      </div>

      {/* Actions */}
      <div className="flex items-center gap-3">
        <button onClick={handleSave} disabled={!!parseError || saving}
          className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium disabled:opacity-50 flex items-center gap-2">
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          {id ? 'Update' : 'Save'}
        </button>
        <button onClick={handleReset} className="px-4 py-2 rounded-lg text-sm text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/5 flex items-center gap-2">
          <RotateCcw size={14} /> Reset to Default
        </button>
        {id && (
          <button onClick={handleDelete} className="px-4 py-2 rounded-lg text-sm text-red-500 hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 flex items-center gap-2 ml-auto">
            <Trash2 size={14} /> Delete
          </button>
        )}
      </div>
    </div>
  )
}
