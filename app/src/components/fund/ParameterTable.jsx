import { FIELD_TYPES, toDisplay, fromDisplay } from './parameterConfig'

const T = FIELD_TYPES

function FieldInput({ field, value, onChange }) {
  const displayVal = toDisplay(value, field.type)

  const handleChange = (rawVal) => {
    onChange(field.key, fromDisplay(rawVal, field.type))
  }

  const baseClass = 'w-full px-3 py-1.5 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-white/10 text-sm text-slate-900 dark:text-white text-right font-mono focus:border-blue-500/50 focus:outline-none'

  if (field.type === T.BOOLEAN) {
    return (
      <input type="checkbox" checked={!!displayVal} onChange={(e) => onChange(field.key, e.target.checked)}
        className="rounded border-slate-300 dark:border-slate-600 text-blue-500" />
    )
  }

  if (field.type === T.SELECT) {
    return (
      <select value={displayVal || ''} onChange={(e) => onChange(field.key, e.target.value)} className={baseClass + ' text-left'}>
        {(field.options || []).map((opt) => <option key={opt} value={opt}>{opt}</option>)}
      </select>
    )
  }

  if (field.type === T.DATE) {
    return (
      <input type="date" value={displayVal || ''} onChange={(e) => onChange(field.key, e.target.value)}
        className={baseClass + ' text-left'} />
    )
  }

  if (field.type === T.TEXT) {
    return (
      <input type="text" value={displayVal || ''} onChange={(e) => onChange(field.key, e.target.value)}
        className={baseClass + ' text-left'} />
    )
  }

  return (
    <input type="number" value={displayVal} onChange={(e) => handleChange(e.target.value)}
      step={field.step || (field.type === T.INTEGER ? 1 : field.type === T.PERCENT ? 0.01 : 0.01)}
      min={field.min} max={field.max}
      className={baseClass} />
  )
}

export default function ParameterTable({ fields, data, onChange, title }) {
  if (!data) return null

  const visibleFields = fields.filter((f) => data[f.key] !== undefined || f.showAlways)

  return (
    <div>
      {title && <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-3">{title}</h3>}
      <div className="border border-slate-200 dark:border-white/5 rounded-xl overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="text-xs text-slate-500 uppercase tracking-wider border-b border-slate-200 dark:border-white/5 bg-slate-50 dark:bg-slate-800/30">
              <th className="text-left py-2.5 px-4 font-medium w-1/2">Parameter</th>
              <th className="text-right py-2.5 px-4 font-medium">Value</th>
              <th className="text-left py-2.5 px-4 font-medium w-20"></th>
            </tr>
          </thead>
          <tbody>
            {(visibleFields.length > 0 ? visibleFields : fields).map((field) => (
              <tr key={field.key} className="border-b border-slate-100 dark:border-white/5 hover:bg-slate-50/50 dark:hover:bg-white/[0.02]">
                <td className="py-2 px-4 text-sm text-slate-700 dark:text-slate-300">{field.label}</td>
                <td className="py-2 px-4">
                  <FieldInput field={field} value={data[field.key]} onChange={onChange} />
                </td>
                <td className="py-2 px-4 text-xs text-slate-400 dark:text-slate-500 whitespace-nowrap">{field.unit || ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export function ArrayParameterTable({ fields, items, onChange, onAdd, onRemove, title, itemLabel = 'Item' }) {
  if (!items) return null

  const handleFieldChange = (index, key, value) => {
    const updated = items.map((item, i) => i === index ? { ...item, [key]: value } : item)
    onChange(updated)
  }

  return (
    <div>
      {title && <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-3">{title}</h3>}
      <div className="border border-slate-200 dark:border-white/5 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="text-xs text-slate-500 uppercase tracking-wider border-b border-slate-200 dark:border-white/5 bg-slate-50 dark:bg-slate-800/30">
                <th className="text-left py-2.5 px-3 font-medium w-8">#</th>
                {fields.map((f) => (
                  <th key={f.key} className="text-left py-2.5 px-3 font-medium whitespace-nowrap">
                    {f.label} {f.unit && <span className="text-slate-400 font-normal">({f.unit})</span>}
                  </th>
                ))}
                {onRemove && <th className="w-8"></th>}
              </tr>
            </thead>
            <tbody>
              {items.map((item, idx) => (
                <tr key={idx} className="border-b border-slate-100 dark:border-white/5">
                  <td className="py-1.5 px-3 text-xs text-slate-400">{idx + 1}</td>
                  {fields.map((field) => (
                    <td key={field.key} className="py-1.5 px-3">
                      <FieldInput field={field} value={item[field.key]} onChange={(_, val) => handleFieldChange(idx, field.key, val)} />
                    </td>
                  ))}
                  {onRemove && (
                    <td className="py-1.5 px-3">
                      <button onClick={() => onRemove(idx)} className="text-xs text-slate-400 hover:text-red-400">×</button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {onAdd && (
        <button onClick={onAdd} className="mt-2 text-xs text-blue-500 hover:text-blue-400 px-3 py-1.5">
          + Add {itemLabel}
        </button>
      )}
    </div>
  )
}
