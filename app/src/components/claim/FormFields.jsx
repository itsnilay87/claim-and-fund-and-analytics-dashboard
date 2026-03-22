/**
 * @module FormFields
 * @description Reusable form field primitives for the claim and portfolio editors.
 *
 * Exports: TextField, NumberField, SelectField, TextArea, SliderField,
 * ToggleField, SectionTitle, FieldGroup.  All styled with dark-theme
 * Tailwind classes and consistent label/help-text patterns.
 */
const INPUT_CLS =
  'w-full px-3 py-2 bg-slate-800/50 border border-white/10 rounded-lg text-sm text-white placeholder-slate-500 focus:ring-1 focus:ring-primary-500 focus:border-primary-500 outline-none transition-colors';
const SMALL_INPUT_CLS =
  'w-24 px-2 py-1.5 bg-slate-800/50 border border-white/10 rounded-lg text-sm text-white placeholder-slate-500 focus:ring-1 focus:ring-primary-500 focus:border-primary-500 outline-none';

export function NumberField({ label, value, onChange, min, max, step = 1, unit, help, error, className }) {
  return (
    <div className={className || 'mb-4'}>
      <label className="block text-sm font-medium text-slate-300 mb-1">
        {label}
        {unit && <span className="text-slate-500 ml-1">({unit})</span>}
      </label>
      <input
        type="number"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
        min={min}
        max={max}
        step={step}
        className={INPUT_CLS + (error ? ' !border-red-500/50 !ring-red-500/30' : '')}
      />
      {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
      {!error && help && <p className="mt-1 text-xs text-slate-500">{help}</p>}
    </div>
  );
}

export function TextField({ label, value, onChange, placeholder, help, className }) {
  return (
    <div className={className || 'mb-4'}>
      <label className="block text-sm font-medium text-slate-300 mb-1">{label}</label>
      <input
        type="text"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={INPUT_CLS}
      />
      {help && <p className="mt-1 text-xs text-slate-500">{help}</p>}
    </div>
  );
}

export function TextArea({ label, value, onChange, placeholder, rows = 3, help }) {
  return (
    <div className="mb-4">
      <label className="block text-sm font-medium text-slate-300 mb-1">{label}</label>
      <textarea
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={rows}
        className={INPUT_CLS + ' resize-none'}
      />
      {help && <p className="mt-1 text-xs text-slate-500">{help}</p>}
    </div>
  );
}

export function SelectField({ label, value, onChange, options, help, disabled }) {
  return (
    <div className="mb-4">
      <label className="block text-sm font-medium text-slate-300 mb-1">{label}</label>
      <select
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className={INPUT_CLS + (disabled ? ' opacity-60 cursor-not-allowed' : '')}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      {help && <p className="mt-1 text-xs text-slate-500">{help}</p>}
    </div>
  );
}

export function SliderField({ label, value, onChange, min = 0, max = 1, step = 0.01, help, showPct, error }) {
  const display = showPct
    ? (value * 100).toFixed(1) + '%'
    : value != null
      ? value.toFixed(2)
      : '—';
  return (
    <div className="mb-4">
      <label className="block text-sm font-medium text-slate-300 mb-1">
        {label}: <span className={'font-bold ' + (error ? 'text-red-400' : 'text-teal-400')}>{display}</span>
      </label>
      <input
        type="range"
        value={value ?? min}
        onChange={(e) => onChange(Number(e.target.value))}
        min={min}
        max={max}
        step={step}
        className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-teal-500"
      />
      <div className="flex justify-between text-xs text-slate-600 mt-0.5">
        <span>{showPct ? (min * 100).toFixed(0) + '%' : min}</span>
        <span>{showPct ? (max * 100).toFixed(0) + '%' : max}</span>
      </div>
      {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
      {!error && help && <p className="mt-1 text-xs text-slate-500">{help}</p>}
    </div>
  );
}

export function ToggleField({ label, value, onChange, help }) {
  return (
    <div className="mb-4 flex items-center justify-between">
      <div>
        <span className="text-sm font-medium text-slate-300">{label}</span>
        {help && <p className="text-xs text-slate-500 mt-0.5">{help}</p>}
      </div>
      <button
        type="button"
        onClick={() => onChange(!value)}
        className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ${
          value ? 'bg-teal-600' : 'bg-slate-700'
        }`}
      >
        <span
          className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition duration-200 ${
            value ? 'translate-x-5' : 'translate-x-0'
          }`}
        />
      </button>
    </div>
  );
}

export function RangeField({ label, low, high, onLowChange, onHighChange, min, max, step = 0.1, unit, help, error }) {
  return (
    <div className="mb-4">
      <label className="block text-sm font-medium text-slate-300 mb-1">
        {label}
        {unit && <span className="text-slate-500 ml-1">({unit})</span>}
      </label>
      <div className="flex gap-2 items-center">
        <input
          type="number"
          value={low ?? ''}
          onChange={(e) => onLowChange(Number(e.target.value))}
          min={min}
          max={max}
          step={step}
          placeholder="Low"
          className={SMALL_INPUT_CLS + (error ? ' !border-red-500/50' : '')}
        />
        <span className="text-slate-600">to</span>
        <input
          type="number"
          value={high ?? ''}
          onChange={(e) => onHighChange(Number(e.target.value))}
          min={min}
          max={max}
          step={step}
          placeholder="High"
          className={SMALL_INPUT_CLS + (error ? ' !border-red-500/50' : '')}
        />
      </div>
      {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
      {!error && help && <p className="mt-1 text-xs text-slate-500">{help}</p>}
    </div>
  );
}

export function SectionTitle({ children }) {
  return (
    <h3 className="text-lg font-semibold text-white mb-4 pb-2 border-b border-white/10">
      {children}
    </h3>
  );
}
