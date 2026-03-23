/**
 * @module ClaimSummaryCard
 * @description Claim status card with run action and key metrics.
 *
 * Displays claim name, jurisdiction, SOC value, validation status, and
 * a "Run Simulation" button.  Shows inline results (win rate, E[Q], duration)
 * after a successful simulation run.
 *
 * @prop {Object} claim - Claim configuration object.
 * @prop {Function} onRun - Callback to trigger simulation.
 * @prop {Object} [result] - Simulation result summary (optional).
 * @prop {boolean} [running] - Whether simulation is currently running.
 */
import { Play, AlertTriangle, CheckCircle, Clock, Loader2, ExternalLink } from 'lucide-react';

const FLAG_EMOJI = { indian_domestic: '🇮🇳', siac_singapore: '🇸🇬', hkiac_hongkong: '🇭🇰' };
const JURISDICTION_SHORT = { indian_domestic: 'Indian Domestic', siac_singapore: 'SIAC Singapore', hkiac_hongkong: 'HKIAC Hong Kong' };
const STATUS_STYLES = {
  draft: { bg: 'bg-slate-500/10', text: 'text-slate-400', border: 'border-slate-500/20', label: 'Draft' },
  running: { bg: 'bg-cyan-500/10', text: 'text-cyan-400', border: 'border-cyan-500/20', label: 'Running' },
  simulated: { bg: 'bg-emerald-500/10', text: 'text-emerald-400', border: 'border-emerald-500/20', label: 'Simulated' },
  stale: { bg: 'bg-amber-500/10', text: 'text-amber-400', border: 'border-amber-500/20', label: 'Stale' },
};

export default function ClaimSummaryCard({ draft, metrics, errors, onSimulate, simRun, onViewResults }) {
  if (!draft) return null;

  const statusStyle = STATUS_STYLES[draft.status] || STATUS_STYLES.draft;
  const hasErrors = errors?.length > 0;
  const canSimulate = !hasErrors && draft.name?.trim() && !simRun?.isRunning;
  const isRunning = simRun?.isRunning;
  const isComplete = simRun?.isComplete || draft.status === 'simulated';

  return (
    <div className="glass-card p-5 space-y-5 sticky top-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white">Claim Summary</h3>
        <span className={`text-[10px] px-2 py-0.5 rounded-full border ${statusStyle.bg} ${statusStyle.text} ${statusStyle.border}`}>
          {statusStyle.label}
        </span>
      </div>

      {/* Jurisdiction badge */}
      <div className="flex items-center gap-2 p-2.5 rounded-lg bg-slate-800/30 border border-white/5">
        <span className="text-lg">{FLAG_EMOJI[draft.jurisdiction] || '🏛️'}</span>
        <div>
          <div className="text-sm font-medium text-white">
            {JURISDICTION_SHORT[draft.jurisdiction] || draft.jurisdiction}
          </div>
          {draft.name && <div className="text-[11px] text-slate-500 truncate max-w-[180px]">{draft.name}</div>}
        </div>
      </div>

      {/* SOC Value */}
      <div className="p-3 rounded-lg bg-slate-800/30 border border-white/5">
        <div className="text-[10px] text-slate-500 uppercase tracking-wider">SOC Value</div>
        <div className="text-xl font-bold text-white">
          {draft.soc_value_cr?.toLocaleString() ?? '—'} <span className="text-sm text-slate-400">{draft.currency || 'INR'} Cr</span>
        </div>
      </div>

      {/* Computed metrics */}
      {metrics && (
        <div className="space-y-2.5">
          <MetricRow
            label="E[Win Rate]"
            value={(metrics.arbWinProb * 100).toFixed(1) + '%'}
            color="text-emerald-400"
          />
          <MetricRow
            label="E[Quantum | Win]"
            value={(metrics.eQuantumPct * 100).toFixed(1) + '%'}
            sub={metrics.eQuantumCr?.toFixed(1) + ' Cr'}
            color="text-teal-400"
          />
          <MetricRow
            label="E[Duration]"
            value={metrics.eDuration + ' months'}
            sub={(metrics.eDuration / 12).toFixed(1) + ' years'}
            color="text-cyan-400"
            icon={<Clock className="w-3 h-3" />}
          />
          <MetricRow
            label="E[Legal Costs]"
            value={metrics.eLegalCosts + ' Cr'}
            sub={'Overrun: +' + metrics.overrunFactor + '%'}
            color="text-amber-400"
          />
        </div>
      )}

      {/* Validation errors */}
      {hasErrors && (
        <div className="p-3 rounded-lg bg-red-500/5 border border-red-500/20">
          <div className="flex items-center gap-1.5 text-xs text-red-400 font-medium mb-1.5">
            <AlertTriangle className="w-3 h-3" /> Validation Issues
          </div>
          <ul className="space-y-0.5">
            {errors.map((err, i) => (
              <li key={i} className="text-[11px] text-red-400/80 pl-3">• {err}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Simulation progress */}
      {isRunning && (
        <div className="space-y-2 mb-3">
          <div className="flex items-center gap-2 text-xs text-cyan-400">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            <span>{simRun?.stage || 'Starting simulation...'}</span>
          </div>
          <div className="w-full bg-slate-800 rounded-full h-1.5 overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-cyan-500 to-primary-500 rounded-full transition-all duration-500"
              style={{ width: `${Math.max(simRun?.progress || 0, 5)}%` }}
            />
          </div>
          <div className="text-[10px] text-slate-500 text-right">{simRun?.progress || 0}%</div>
        </div>
      )}

      {/* View Results button (after completion) */}
      {isComplete && onViewResults && (
        <button
          onClick={onViewResults}
          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 mb-2 rounded-lg font-semibold text-sm bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/20 transition-all"
        >
          <ExternalLink className="w-4 h-4" /> View Results
        </button>
      )}

      {/* Simulate button */}
      <button
        onClick={onSimulate}
        disabled={!canSimulate}
        className={
          'w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold transition-all ' +
          (isRunning
            ? 'bg-slate-800 text-slate-500 cursor-not-allowed border border-white/5'
            : canSimulate
              ? 'bg-primary-500 hover:bg-primary-600 text-white shadow-lg shadow-primary-500/20'
              : 'bg-slate-800 text-slate-500 cursor-not-allowed border border-white/5')
        }
      >
        {isRunning ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" /> Simulating...
          </>
        ) : canSimulate ? (
          <>
            <Play className="w-4 h-4" /> {isComplete ? 'Re-Simulate' : 'Simulate Claim'}
          </>
        ) : (
          <>
            <CheckCircle className="w-4 h-4" /> Fix Errors to Simulate
          </>
        )}
      </button>
    </div>
  );
}

function MetricRow({ label, value, sub, color, icon }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-white/5 last:border-0">
      <span className="text-xs text-slate-400 flex items-center gap-1">
        {icon} {label}
      </span>
      <div className="text-right">
        <span className={`text-sm font-bold ${color}`}>{value}</span>
        {sub && <div className="text-[10px] text-slate-500">{sub}</div>}
      </div>
    </div>
  );
}

