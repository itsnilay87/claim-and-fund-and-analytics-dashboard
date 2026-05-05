/**
 * @module StructureSelector
 * @description Investment structure card picker for portfolio configuration.
 *
 * Shows 5 structure options as selectable cards: litigation_funding,
 * monetisation_full_purchase, monetisation_upfront_tail,
 * monetisation_staged, and comparative.  Each card shows a brief
 * description of the investment structure.
 *
 * @prop {string} selected - Currently selected structure type.
 * @prop {Function} onSelect - Callback with new structure type string.
 */
import { useState } from 'react';
import { Gavel, ShoppingCart, GitCompare, ChevronRight, Check } from 'lucide-react';

const STRUCTURES = [
  {
    id: 'litigation_funding',
    label: 'Litigation Funding',
    icon: Gavel,
    color: 'cyan',
    description: 'Fund legal costs only. Return = MIN or MAX of (cost multiple × costs, award ratio × collected).',
    bestFor: 'Cases where you want to limit capital outlay to legal costs',
    subOptions: null,
  },
  {
    id: 'monetisation',
    label: 'Monetisation',
    icon: ShoppingCart,
    color: 'purple',
    description: 'Purchase the claim(s) at a discount.',
    bestFor: 'Cases where you want outright ownership of claim proceeds',
    subOptions: [
      { id: 'monetisation_full_purchase', label: 'Full Upfront Purchase', desc: 'Pay a single discounted price upfront for full claim rights' },
      { id: 'monetisation_upfront_tail', label: 'Upfront % + Tail % (Grid Analysis)', desc: 'Pay upfront percentage plus tail share of outcome — grid explores all combos' },
      { id: 'monetisation_staged', label: 'Staged Milestone Payments', desc: 'Pay in stages tied to claim milestones (DAB, arbitration, etc.)' },
      { id: 'monetisation_hybrid_payoff', label: 'Hybrid Payoff (Upfront + Capped Return)', desc: 'Upfront plus min/max of (multiple-of-upfront, % of recovery), with optional payout floor & cap' },
    ],
  },
  {
    id: 'comparative',
    label: 'Comparative',
    icon: GitCompare,
    color: 'amber',
    description: 'Run Litigation Funding AND Monetisation side by side.',
    bestFor: 'When you want to compare funding vs. purchase economics',
    subOptions: null,
  },
];

const COLOR_MAP = {
  cyan: { bg: 'bg-cyan-500/10', border: 'border-cyan-500/30', text: 'text-cyan-400', ring: 'ring-cyan-500/30' },
  purple: { bg: 'bg-purple-500/10', border: 'border-purple-500/30', text: 'text-purple-400', ring: 'ring-purple-500/30' },
  amber: { bg: 'bg-amber-500/10', border: 'border-amber-500/30', text: 'text-amber-400', ring: 'ring-amber-500/30' },
};

export default function StructureSelector({ structure, onSelect }) {
  const [expandedGroup, setExpandedGroup] = useState(
    structure?.startsWith('monetisation') ? 'monetisation' : null
  );

  const handleSelect = (s) => {
    if (s.subOptions) {
      setExpandedGroup(expandedGroup === s.id ? null : s.id);
    } else {
      onSelect(s.id);
    }
  };

  const isActiveGroup = (s) => {
    if (s.id === structure) return true;
    if (s.subOptions) return s.subOptions.some((sub) => sub.id === structure);
    return false;
  };

  return (
    <div className="space-y-3">
      {STRUCTURES.map((s) => {
        const colors = COLOR_MAP[s.color];
        const active = isActiveGroup(s);
        const expanded = expandedGroup === s.id;
        const Icon = s.icon;

        return (
          <div key={s.id}>
            <button
              type="button"
              onClick={() => handleSelect(s)}
              className={
                'w-full text-left glass-card p-5 transition-all ' +
                (active ? `${colors.border} ${colors.bg}` : 'hover:border-slate-600')
              }
            >
              <div className="flex items-start gap-4">
                <div className={`w-12 h-12 rounded-xl ${colors.bg} flex items-center justify-center shrink-0`}>
                  <Icon className={`w-6 h-6 ${colors.text}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-semibold text-white">{s.label}</h3>
                    {active && !s.subOptions && (
                      <span className={`text-[10px] px-2 py-0.5 rounded-full ${colors.bg} ${colors.text} border ${colors.border}`}>
                        Selected
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-slate-400 mt-1">{s.description}</p>
                  <p className="text-xs text-slate-500 mt-2">
                    <span className="font-medium">Best for:</span> {s.bestFor}
                  </p>
                </div>
                {s.subOptions && (
                  <ChevronRight className={`w-5 h-5 text-slate-500 transition-transform shrink-0 mt-1 ${expanded ? 'rotate-90' : ''}`} />
                )}
              </div>
            </button>

            {/* Sub-options for monetisation */}
            {s.subOptions && expanded && (
              <div className="ml-8 mt-2 space-y-2">
                {s.subOptions.map((sub) => {
                  const subActive = structure === sub.id;
                  return (
                    <button
                      key={sub.id}
                      type="button"
                      onClick={() => onSelect(sub.id)}
                      className={
                        'w-full text-left glass-card p-4 transition-all flex items-center gap-3 ' +
                        (subActive ? `${colors.border} ${colors.bg}` : 'hover:border-slate-600')
                      }
                    >
                      {subActive ? (
                        <Check className={`w-4 h-4 ${colors.text} shrink-0`} />
                      ) : (
                        <div className="w-4 h-4 rounded border border-slate-600 shrink-0" />
                      )}
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-white">{sub.label}</p>
                        <p className="text-xs text-slate-500 mt-0.5">{sub.desc}</p>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
