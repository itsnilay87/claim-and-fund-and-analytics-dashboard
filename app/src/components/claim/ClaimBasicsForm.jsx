/**
 * @module ClaimBasicsForm
 * @description Basic claim information form (name, SOC value, jurisdiction, type, parties).
 *
 * First tab of the claim editor.  Fields feed into the top-level ClaimConfig
 * properties (id, name, soc_value_cr, jurisdiction, claim_type, etc.).
 *
 * @prop {Object} claim - Current claim state.
 * @prop {Function} onChange - Callback with updated claim.
 */
import { TextField, NumberField, SelectField, TextArea, SliderField, SectionTitle } from './FormFields';

const FLAG_EMOJI = { IN: '🇮🇳', SG: '🇸🇬' };
const JURISDICTION_LABELS = {
  indian_domestic: '🇮🇳 Indian Domestic Arbitration',
  siac_singapore: '🇸🇬 SIAC Singapore',
};

const CLAIM_TYPES = [
  { value: 'prolongation', label: 'Prolongation' },
  { value: 'change_of_law', label: 'Change of Law' },
  { value: 'scope_variation', label: 'Scope Variation' },
  { value: 'breach_of_contract', label: 'Breach of Contract' },
  { value: 'other', label: 'Other' },
];

const CURRENCIES = [
  { value: 'INR', label: 'INR (₹)' },
  { value: 'USD', label: 'USD ($)' },
  { value: 'SGD', label: 'SGD (S$)' },
];

const CURRENCY_SYMBOL = { INR: '₹', USD: '$', SGD: 'S$' };

export default function ClaimBasicsForm({ draft, updateField, availableStages, onStageChange }) {
  if (!draft) return null;

  const stages = (availableStages || []).map((s) => ({
    value: s.name || s,
    label: s.label || (s.name || s).replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
  }));

  return (
    <div className="space-y-6">
      <SectionTitle>Claim Basics</SectionTitle>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-0">
        <TextField
          label="Claim Name"
          value={draft.name}
          onChange={(v) => updateField('name', v)}
          placeholder="e.g. TATA Claim 1 — Prolongation"
        />

        {/* Jurisdiction (read-only badge) */}
        <div className="mb-4">
          <label className="block text-sm font-medium text-slate-300 mb-1">Jurisdiction</label>
          <div className="px-3 py-2 bg-slate-800/30 border border-white/5 rounded-lg text-sm text-white flex items-center gap-2">
            <span className="text-lg">{FLAG_EMOJI[draft.jurisdiction === 'siac_singapore' ? 'SG' : 'IN']}</span>
            <span>{JURISDICTION_LABELS[draft.jurisdiction] || draft.jurisdiction}</span>
            <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded bg-primary-500/10 text-primary-500 border border-primary-500/20">
              Locked
            </span>
          </div>
        </div>

        <TextField
          label="Claimant Name"
          value={draft.claimant}
          onChange={(v) => updateField('claimant', v)}
          placeholder="e.g. TATA Projects Ltd"
        />
        <TextField
          label="Respondent Name"
          value={draft.respondent}
          onChange={(v) => updateField('respondent', v)}
          placeholder="e.g. DFCCIL"
        />

        <SelectField
          label="Claim Type"
          value={draft.claim_type}
          onChange={(v) => updateField('claim_type', v)}
          options={CLAIM_TYPES}
        />

        <div className="mb-4">
          <label className="block text-sm font-medium text-slate-300 mb-1">
            SOC Value <span className="text-slate-500">({CURRENCY_SYMBOL[draft.currency] || '₹'} Cr)</span>
          </label>
          <input
            type="number"
            value={draft.soc_value_cr ?? ''}
            onChange={(e) => updateField('soc_value_cr', e.target.value === '' ? '' : Number(e.target.value))}
            min={0}
            step={10}
            className="w-full px-3 py-2 bg-slate-800/50 border border-white/10 rounded-lg text-sm text-white placeholder-slate-500 focus:ring-1 focus:ring-primary-500 outline-none"
          />
        </div>

        <SelectField
          label="Currency"
          value={draft.currency}
          onChange={(v) => updateField('currency', v)}
          options={CURRENCIES}
        />

        {stages.length > 0 && (
          <SelectField
            label="Current Stage"
            value={draft.current_stage}
            onChange={(v) => onStageChange ? onStageChange(v) : updateField('current_stage', v)}
            options={stages}
            help="Where the claim currently sits in the pipeline — sets remaining timeline stages"
          />
        )}
      </div>

      <SliderField
        label="Claimant's Share"
        value={draft.claimant_share_pct ?? 1}
        onChange={(v) => updateField('claimant_share_pct', v)}
        min={0}
        max={1}
        step={0.01}
        showPct
        help="Claimant's ownership percentage of the total claim"
      />

      <TextArea
        label="Description"
        value={draft.description}
        onChange={(v) => updateField('description', v)}
        placeholder="Describe the claim, facts, and key arguments…"
        rows={3}
      />
    </div>
  );
}
