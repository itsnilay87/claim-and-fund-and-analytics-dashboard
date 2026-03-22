/**
 * @module TemplateSelector
 * @description Claim template picker with preset configs and JSON file upload.
 *
 * Offers pre-built claim templates (e.g. "Standard TATA claim") and
 * a file upload option for importing custom JSON configs.  Populates
 * all claim fields from the selected template.
 *
 * @prop {Function} onSelect - Callback with the selected template config object.
 */
import { useState, useEffect } from 'react';
import { FileInput, Loader2, X, ChevronDown } from 'lucide-react';

const JURISDICTION_LABELS = {
  indian_domestic: '🇮🇳 Indian Domestic',
  siac_singapore: '🇸🇬 SIAC Singapore',
};

export default function TemplateSelector({ onSelect, disabled }) {
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    if (!open || templates.length > 0) return;
    setLoading(true);
    fetch('/api/templates')
      .then((r) => r.json())
      .then((data) => setTemplates(data.templates || []))
      .catch(() => setTemplates([]))
      .finally(() => setLoading(false));
  }, [open, templates.length]);

  const handleSelect = async (templateId) => {
    setApplying(true);
    try {
      const res = await fetch(`/api/templates/${encodeURIComponent(templateId)}`);
      if (!res.ok) throw new Error('Failed to load template');
      const tmpl = await res.json();
      onSelect(tmpl);
      setOpen(false);
    } catch {
      // silently fail
    } finally {
      setApplying(false);
    }
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        disabled={disabled}
        className={
          'flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-all ' +
          'bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-400 border border-indigo-500/20 ' +
          'disabled:opacity-40 disabled:cursor-not-allowed'
        }
      >
        <FileInput className="w-3.5 h-3.5" />
        Load Template
        <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <>
          {/* Backdrop */}
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />

          {/* Dropdown */}
          <div className="absolute right-0 top-full mt-1 z-50 w-96 max-h-[420px] overflow-y-auto rounded-xl bg-slate-900 border border-white/10 shadow-2xl">
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
              <h4 className="text-sm font-semibold text-white">Claim Templates</h4>
              <button onClick={() => setOpen(false)} className="p-1 text-slate-500 hover:text-slate-300">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            {loading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
              </div>
            ) : templates.length === 0 ? (
              <div className="py-8 text-center text-sm text-slate-500">No templates available</div>
            ) : (
              <div className="p-2 space-y-1">
                {templates.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => handleSelect(t.id)}
                    disabled={applying}
                    className="w-full text-left px-3 py-3 rounded-lg hover:bg-slate-800 transition-colors group"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-white group-hover:text-primary-400 transition-colors">
                        {t.name}
                      </span>
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 border border-white/5">
                        {JURISDICTION_LABELS[t.jurisdiction] || t.jurisdiction}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-[11px] text-slate-500">
                      <span>SOC: ₹{t.soc_value_cr?.toLocaleString()} Cr</span>
                      <span>•</span>
                      <span>{(t.claim_type || '').replace(/_/g, ' ')}</span>
                    </div>
                    {t.description && (
                      <p className="text-[10px] text-slate-600 mt-1 line-clamp-2">{t.description}</p>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
