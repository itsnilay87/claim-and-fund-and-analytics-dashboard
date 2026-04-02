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

const FLAG_EMOJI = { IN: '🇮🇳', SG: '🇸🇬', HK: '🇭🇰' };
const JURISDICTION_LABELS = {
  indian_domestic: '🇮🇳 Indian Domestic Arbitration',
  siac_singapore: '🇸🇬 SIAC Singapore',
  hkiac_hongkong: '🇭🇰 HKIAC Hong Kong',
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
  { value: 'HKD', label: 'HKD (HK$)' },
];

const CURRENCY_SYMBOL = { INR: '₹', USD: '$', SGD: 'S$', HKD: 'HK$' };

const POST_ARB_STAGES = new Set([
  'arb_award_done', 'challenge_pending', 'enforcement',
  's34_pending', 's34_decided', 's37_pending', 's37_decided', 'slp_pending',
  'hc_challenge_pending', 'hc_decided', 'coa_pending', 'coa_decided',
  'cfi_challenge_pending', 'cfi_decided', 'ca_pending', 'ca_decided', 'cfa_pending',
]);

function isPostArbStage(stage) {
  return POST_ARB_STAGES.has(stage);
}

function getRequiredOutcomeFields(stage, jurisdiction) {
  const fields = [];
  if (!isPostArbStage(stage)) return fields;

  fields.push('arb_outcome');

  // Indian Domestic chain
  if (jurisdiction === 'indian_domestic') {
    if (['s34_decided', 's37_pending', 's37_decided', 'slp_pending'].includes(stage)) {
      fields.push('s34_outcome');
    }
    if (['s37_decided', 'slp_pending'].includes(stage)) {
      fields.push('s37_outcome');
    }
    if (stage === 'slp_pending') {
      fields.push('slp_gate_outcome');
    }
  }

  // SIAC chain
  if (jurisdiction === 'siac_singapore') {
    if (['hc_decided', 'coa_pending', 'coa_decided'].includes(stage)) {
      fields.push('hc_outcome');
    }
    if (stage === 'coa_decided') {
      fields.push('coa_outcome');
    }
  }

  // HKIAC chain
  if (jurisdiction === 'hkiac_hongkong') {
    if (['cfi_decided', 'ca_pending', 'ca_decided', 'cfa_pending'].includes(stage)) {
      fields.push('cfi_outcome');
    }
    if (['ca_decided', 'cfa_pending'].includes(stage)) {
      fields.push('ca_outcome');
    }
    if (stage === 'cfa_pending') {
      fields.push('cfa_gate_outcome');
    }
  }

  return fields;
}

function KnownOutcomesSection({ draft, updateField, jurisdiction, currentStage }) {
  const ko = draft.known_outcomes || {};
  const updateKO = (field, value) => {
    updateField('known_outcomes', { ...ko, [field]: value || null });
  };

  const requiredFields = getRequiredOutcomeFields(currentStage, jurisdiction);

  return (
    <div className="col-span-2 space-y-4 p-4 bg-amber-500/5 border border-amber-500/20 rounded-lg">
      <SectionTitle>Known Legal Outcomes</SectionTitle>
      <p className="text-xs text-slate-400 -mt-2">
        Record decisions already made. The simulation will use these instead of random draws.
      </p>

      {requiredFields.includes('arb_outcome') && (
        <SelectField
          label="Arbitration Outcome"
          value={ko.arb_outcome || ''}
          onChange={(v) => updateKO('arb_outcome', v)}
          options={[
            { value: '', label: '— Select —' },
            { value: 'won', label: 'Claimant Won' },
            { value: 'lost', label: 'Claimant Lost' },
          ]}
        />
      )}

      {ko.arb_outcome === 'won' && (
        <div className="grid grid-cols-2 gap-4">
          <NumberField
            label="Known Quantum (₹ Cr)"
            value={ko.known_quantum_cr}
            onChange={(v) => updateKO('known_quantum_cr', v === '' ? null : Number(v))}
            placeholder="e.g. 850"
            help="Absolute award amount. Used as center of distribution (±10%)."
          />
          <NumberField
            label="Known Quantum (% of SOC)"
            value={ko.known_quantum_pct != null ? ko.known_quantum_pct * 100 : ''}
            onChange={(v) => updateKO('known_quantum_pct', v === '' ? null : Number(v) / 100)}
            placeholder="e.g. 85"
            help="Award as percentage of SOC. Takes precedence over absolute."
          />
        </div>
      )}

      {jurisdiction === 'indian_domestic' && requiredFields.includes('s34_outcome') && (
        <SelectField
          label="S.34 Challenge Result"
          value={ko.s34_outcome || ''}
          onChange={(v) => updateKO('s34_outcome', v)}
          options={[
            { value: '', label: '— Select —' },
            { value: 'claimant_won', label: 'Award Upheld (Challenge Dismissed)' },
            { value: 'respondent_won', label: 'Award Set Aside (Respondent Won)' },
          ]}
        />
      )}

      {jurisdiction === 'indian_domestic' && requiredFields.includes('s37_outcome') && (
        <SelectField
          label="S.37 Appeal Result"
          value={ko.s37_outcome || ''}
          onChange={(v) => updateKO('s37_outcome', v)}
          options={[
            { value: '', label: '— Select —' },
            { value: 'claimant_won', label: 'Award Upheld' },
            { value: 'respondent_won', label: 'Award Overturned' },
          ]}
        />
      )}

      {jurisdiction === 'indian_domestic' && requiredFields.includes('slp_gate_outcome') && (
        <SelectField
          label="SLP Gate Decision"
          value={ko.slp_gate_outcome || ''}
          onChange={(v) => updateKO('slp_gate_outcome', v)}
          options={[
            { value: '', label: '— Select —' },
            { value: 'dismissed', label: 'SLP Dismissed (Final Win)' },
            { value: 'admitted', label: 'SLP Admitted (Proceeds to Merits)' },
          ]}
        />
      )}

      {jurisdiction === 'siac_singapore' && requiredFields.includes('hc_outcome') && (
        <SelectField
          label="High Court Challenge Result"
          value={ko.hc_outcome || ''}
          onChange={(v) => updateKO('hc_outcome', v)}
          options={[
            { value: '', label: '— Select —' },
            { value: 'claimant_won', label: 'Award Upheld' },
            { value: 'respondent_won', label: 'Award Set Aside' },
          ]}
        />
      )}

      {jurisdiction === 'siac_singapore' && requiredFields.includes('coa_outcome') && (
        <SelectField
          label="Court of Appeal Result"
          value={ko.coa_outcome || ''}
          onChange={(v) => updateKO('coa_outcome', v)}
          options={[
            { value: '', label: '— Select —' },
            { value: 'claimant_won', label: 'Award Restored' },
            { value: 'respondent_won', label: 'Set-Aside Upheld' },
          ]}
        />
      )}

      {jurisdiction === 'hkiac_hongkong' && requiredFields.includes('cfi_outcome') && (
        <SelectField
          label="Court of First Instance Result"
          value={ko.cfi_outcome || ''}
          onChange={(v) => updateKO('cfi_outcome', v)}
          options={[
            { value: '', label: '— Select —' },
            { value: 'claimant_won', label: 'Award Upheld' },
            { value: 'respondent_won', label: 'Award Set Aside' },
          ]}
        />
      )}
      {jurisdiction === 'hkiac_hongkong' && requiredFields.includes('ca_outcome') && (
        <SelectField
          label="Court of Appeal Result"
          value={ko.ca_outcome || ''}
          onChange={(v) => updateKO('ca_outcome', v)}
          options={[
            { value: '', label: '— Select —' },
            { value: 'claimant_won', label: 'Award Restored' },
            { value: 'respondent_won', label: 'Set-Aside Upheld' },
          ]}
        />
      )}
      {jurisdiction === 'hkiac_hongkong' && requiredFields.includes('cfa_gate_outcome') && (
        <SelectField
          label="CFA Leave to Appeal"
          value={ko.cfa_gate_outcome || ''}
          onChange={(v) => updateKO('cfa_gate_outcome', v)}
          options={[
            { value: '', label: '— Select —' },
            { value: 'dismissed', label: 'Leave Refused (Final)' },
            { value: 'admitted', label: 'Leave Granted' },
          ]}
        />
      )}
    </div>
  );
}

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
            <span className="text-lg">{FLAG_EMOJI[
              draft.jurisdiction === 'siac_singapore' ? 'SG' :
              draft.jurisdiction === 'hkiac_hongkong' ? 'HK' : 'IN'
            ]}</span>
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

        {/* Known Outcomes — shown for post-arbitration stages */}
        {draft.current_stage && isPostArbStage(draft.current_stage) && (
          <KnownOutcomesSection
            draft={draft}
            updateField={updateField}
            jurisdiction={draft.jurisdiction}
            currentStage={draft.current_stage}
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
