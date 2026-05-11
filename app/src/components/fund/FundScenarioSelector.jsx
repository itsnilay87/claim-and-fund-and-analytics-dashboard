export default function FundScenarioSelector({ scenarios, active, onChange }) {
  if (!scenarios || scenarios.length <= 1) return null

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-slate-500 dark:text-slate-400">Scenario:</span>
      {scenarios.map((s) => (
        <button key={s} onClick={() => onChange(s)}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
            active === s
              ? 'bg-blue-50 dark:bg-blue-500/20 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-500/30'
              : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-50 dark:hover:bg-white/5 border border-transparent'
          }`}>
          {s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
        </button>
      ))}
    </div>
  )
}
