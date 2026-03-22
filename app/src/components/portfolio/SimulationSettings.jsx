/**
 * @module SimulationSettings
 * @description Monte Carlo simulation settings panel.
 *
 * Configures n_paths (1K–100K), seed, discount rate, risk-free rate,
 * and start date.  Final step of portfolio builder wizard.
 *
 * @prop {Object} settings - Current SimulationConfig values.
 * @prop {Function} onChange - Callback with updated settings.
 */
import { useMemo } from 'react';
import { Settings, Clock } from 'lucide-react';

export default function SimulationSettings({ simulation, onChange }) {
  const update = (key, val) => onChange({ [key]: val });

  const estimatedRuntime = useMemo(() => {
    const paths = simulation.n_paths || 10000;
    // Rough estimate: ~0.3ms per path per claim
    const seconds = (paths / 10000) * 3;
    if (seconds < 60) return `~${Math.ceil(seconds)}s`;
    return `~${(seconds / 60).toFixed(1)}min`;
  }, [simulation.n_paths]);

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <Settings className="w-4 h-4 text-slate-400" />
        <h3 className="text-sm font-semibold text-white">Monte Carlo Simulation Settings</h3>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {/* N Paths */}
        <label className="block">
          <span className="text-xs text-slate-400 block mb-1">Number of Paths</span>
          <input
            type="number"
            value={simulation.n_paths}
            onChange={(e) => update('n_paths', parseInt(e.target.value, 10) || 10000)}
            min={100} max={100000} step={1000}
            className="w-full bg-slate-900/60 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500/30"
          />
          <p className="text-[10px] text-slate-500 mt-1">Recommended: 10,000 for accuracy</p>
        </label>

        {/* Random Seed */}
        <label className="block">
          <span className="text-xs text-slate-400 block mb-1">Random Seed</span>
          <input
            type="number"
            value={simulation.seed}
            onChange={(e) => update('seed', parseInt(e.target.value, 10) || 42)}
            min={0} max={999999}
            className="w-full bg-slate-900/60 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500/30"
          />
          <p className="text-[10px] text-slate-500 mt-1">Same seed = reproducible results</p>
        </label>

        {/* Discount Rate */}
        <label className="block">
          <span className="text-xs text-slate-400 block mb-1">Discount Rate</span>
          <div className="flex items-center gap-2">
            <input
              type="number"
              value={(simulation.discount_rate * 100).toFixed(1)}
              onChange={(e) => update('discount_rate', (parseFloat(e.target.value) || 12) / 100)}
              min={0} max={50} step={0.5}
              className="flex-1 bg-slate-900/60 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500/30"
            />
            <span className="text-xs text-slate-500">%</span>
          </div>
        </label>

        {/* Risk-Free Rate */}
        <label className="block">
          <span className="text-xs text-slate-400 block mb-1">Risk-Free Rate</span>
          <div className="flex items-center gap-2">
            <input
              type="number"
              value={(simulation.risk_free_rate * 100).toFixed(1)}
              onChange={(e) => update('risk_free_rate', (parseFloat(e.target.value) || 7) / 100)}
              min={0} max={30} step={0.5}
              className="flex-1 bg-slate-900/60 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500/30"
            />
            <span className="text-xs text-slate-500">%</span>
          </div>
        </label>

        {/* Start Date */}
        <label className="block">
          <span className="text-xs text-slate-400 block mb-1">Analysis Start Date</span>
          <input
            type="date"
            value={simulation.start_date}
            onChange={(e) => update('start_date', e.target.value)}
            className="w-full bg-slate-900/60 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500/30"
          />
        </label>

        {/* Estimated runtime */}
        <div className="flex items-center gap-2 glass-card p-3 self-end">
          <Clock className="w-4 h-4 text-amber-400 shrink-0" />
          <div>
            <p className="text-xs text-slate-400">Estimated Runtime</p>
            <p className="text-sm font-medium text-amber-300">{estimatedRuntime}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
