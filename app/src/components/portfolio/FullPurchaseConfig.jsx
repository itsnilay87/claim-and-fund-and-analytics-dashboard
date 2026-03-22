/**
 * @module FullPurchaseConfig
 * @description Configuration panel for full claim purchase monetisation structure.
 *
 * Allows setting purchase price(s), pricing basis (SOC vs EV), legal cost
 * bearer, and purchased share percentage.  Maps to FullPurchaseParams.
 *
 * @prop {Object} config - Current FullPurchaseParams.
 * @prop {Function} onChange - Callback with updated config.
 */
import { useState } from 'react';
import { X, Plus } from 'lucide-react';

export default function FullPurchaseConfig({ config, onChange }) {
  const update = (key, val) => onChange({ [key]: val });
  const [chipInput, setChipInput] = useState('');

  const addPrice = () => {
    const val = parseFloat(chipInput);
    if (!isNaN(val) && val > 0 && val <= 100 && !config.purchase_prices.includes(val)) {
      update('purchase_prices', [...config.purchase_prices, val].sort((a, b) => a - b));
      setChipInput('');
    }
  };

  const removePrice = (price) => {
    update('purchase_prices', config.purchase_prices.filter((p) => p !== price));
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); addPrice(); }
  };

  return (
    <div className="space-y-6">
      <h3 className="text-sm font-semibold text-white">Full Purchase Configuration</h3>

      {/* Purchase price chips */}
      <div>
        <span className="text-xs text-slate-400 block mb-2">Purchase Price Percentages to Evaluate</span>
        <div className="flex flex-wrap gap-2 mb-2">
          {config.purchase_prices.map((price) => (
            <span
              key={price}
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-purple-500/10 text-purple-300 text-sm border border-purple-500/20"
            >
              {price}%
              <button
                type="button"
                onClick={() => removePrice(price)}
                className="hover:text-red-400 transition-colors"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            type="number"
            value={chipInput}
            onChange={(e) => setChipInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Add %"
            min={0.1}
            max={100}
            step={0.5}
            className="w-24 bg-slate-900/60 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:border-purple-500 focus:outline-none"
          />
          <button
            type="button"
            onClick={addPrice}
            className="px-3 py-2 rounded-lg bg-purple-500/10 text-purple-400 text-sm border border-purple-500/20 hover:bg-purple-500/20 transition-colors"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Pricing basis toggle */}
      <div>
        <span className="text-xs text-slate-400 block mb-2">Pricing Basis</span>
        <div className="flex gap-2">
          {[
            { id: 'soc', label: 'SOC Value' },
            { id: 'expected_value', label: 'Expected Value' },
          ].map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => update('pricing_basis', opt.id)}
              className={
                'px-4 py-2 rounded-lg text-sm font-medium transition-all ' +
                (config.pricing_basis === opt.id
                  ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                  : 'bg-slate-800 text-slate-400 border border-slate-700 hover:border-slate-600')
              }
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Legal cost bearer */}
      <div>
        <span className="text-xs text-slate-400 block mb-2">Legal Cost Bearer</span>
        <div className="flex gap-2">
          {['investor', 'claimant', 'shared'].map((opt) => (
            <button
              key={opt}
              type="button"
              onClick={() => update('legal_cost_bearer', opt)}
              className={
                'px-4 py-2 rounded-lg text-sm font-medium capitalize transition-all ' +
                (config.legal_cost_bearer === opt
                  ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                  : 'bg-slate-800 text-slate-400 border border-slate-700 hover:border-slate-600')
              }
            >
              {opt}
            </button>
          ))}
        </div>
        {config.legal_cost_bearer === 'shared' && (
          <div className="mt-3">
            <label className="block">
              <span className="text-xs text-slate-400 block mb-1">Investor Share %</span>
              <input
                type="number"
                value={config.shared_split_pct}
                onChange={(e) => update('shared_split_pct', parseFloat(e.target.value) || 50)}
                min={1} max={99} step={1}
                className="w-32 bg-slate-900/60 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:border-purple-500 focus:outline-none"
              />
            </label>
          </div>
        )}
      </div>

      {/* Purchased share */}
      <div>
        <label className="block">
          <span className="text-xs text-slate-400 block mb-1">Purchased Share %</span>
          <input
            type="number"
            value={config.purchased_share_pct}
            onChange={(e) => update('purchased_share_pct', parseFloat(e.target.value) || 100)}
            min={1} max={100} step={1}
            className="w-32 bg-slate-900/60 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:border-purple-500 focus:outline-none"
          />
        </label>
        <p className="text-xs text-slate-500 mt-1">Percentage of the claim being purchased (100% = full claim)</p>
      </div>
    </div>
  );
}
