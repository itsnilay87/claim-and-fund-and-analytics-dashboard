/**
 * @module JurisdictionSelector
 * @description Jurisdiction picker with visual cards and flag icons.
 *
 * Presents available jurisdictions (Indian Domestic, SIAC Singapore)
 * as selectable cards.  On selection, loads jurisdiction-specific defaults
 * for challenge tree, timeline, legal costs, and interest config.
 *
 * @prop {string} selected - Currently selected jurisdiction ID.
 * @prop {Function} onSelect - Callback with new jurisdiction ID.
 */
import { Globe, Scale, Building2 } from 'lucide-react';
import { useJurisdictions } from '../../hooks/useClaims';

const FLAG_EMOJI = { IN: '🇮🇳', SG: '🇸🇬', US: '🇺🇸', GB: '🇬🇧' };

export default function JurisdictionSelector({ onSelect }) {
  const { jurisdictions, loading } = useJurisdictions();

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-pulse-slow text-slate-400 text-sm">Loading jurisdictions…</div>
      </div>
    );
  }

  if (!jurisdictions.length) {
    return (
      <div className="text-center py-20">
        <Globe className="w-12 h-12 text-slate-600 mx-auto mb-3" />
        <p className="text-slate-400">No jurisdiction templates available.</p>
        <p className="text-xs text-slate-600 mt-1">Ensure the server is running on port 3001.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="text-center">
        <Scale className="w-10 h-10 text-primary-500 mx-auto mb-3" />
        <h2 className="text-xl font-bold text-white">Select Jurisdiction</h2>
        <p className="text-sm text-slate-400 mt-1">Choose the arbitration jurisdiction for this claim</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-2xl mx-auto">
        {jurisdictions.map((j) => (
          <button
            key={j.id}
            onClick={() => onSelect(j.id)}
            className="glass-card p-5 text-left hover:border-primary-500/50 hover:bg-slate-800/80 transition-all group"
          >
            <div className="flex items-start gap-3">
              <span className="text-2xl">{FLAG_EMOJI[j.country] || '🏛️'}</span>
              <div className="flex-1 min-w-0">
                <h3 className="font-semibold text-white group-hover:text-primary-400 transition-colors">
                  {j.name}
                </h3>
                <div className="flex items-center gap-1.5 mt-1">
                  <Building2 className="w-3 h-3 text-slate-500" />
                  <span className="text-xs text-slate-500 truncate">{j.institution}</span>
                </div>
                {j.description && (
                  <p className="text-xs text-slate-400 mt-2 line-clamp-2">{j.description}</p>
                )}
                <div className="flex gap-2 mt-2">
                  {j.supports_restart && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20">
                      RESTART
                    </span>
                  )}
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-teal-500/10 text-teal-400 border border-teal-500/20">
                    {j.country}
                  </span>
                </div>
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
