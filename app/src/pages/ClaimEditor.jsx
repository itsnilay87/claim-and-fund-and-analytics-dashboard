/**
 * @module ClaimEditor
 * @description Multi-tab claim editor page.
 *
 * Tabs: Basics, Quantum, Timeline, Legal Costs, Arbitration, Interest,
 * Probability Tree.  Each tab renders the corresponding editor component.
 * Auto-saves claim state to localStorage via claimStore on change.
 *
 * Route: /workspace/:wsId/claims/:claimId/edit
 */
import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Save, FileText, Scale, TreePine, Calculator, Clock, Banknote, Settings, Play, Loader2, ExternalLink } from 'lucide-react';
import { useClaimEditor } from '../hooks/useClaims';
import { useClaimRun } from '../hooks/useClaimSimulation';
import { useClaimStore } from '../store/claimStore';
import JurisdictionSelector from '../components/claim/JurisdictionSelector';
import ClaimBasicsForm from '../components/claim/ClaimBasicsForm';
import ArbitrationConfig from '../components/claim/ArbitrationConfig';
import QuantumModelEditor from '../components/claim/QuantumModelEditor';
import ProbabilityTreeEditor from '../components/claim/ProbabilityTreeEditor';
import TimelineEditor from '../components/claim/TimelineEditor';
import LegalCostEditor from '../components/claim/LegalCostEditor';
import InterestEditor from '../components/claim/InterestEditor';
import ClaimSummaryCard from '../components/claim/ClaimSummaryCard';
import TemplateSelector from '../components/claim/TemplateSelector';

const TABS = [
  { id: 'basics', label: 'Basics', icon: FileText },
  { id: 'arbitration', label: 'Arbitration', icon: Scale },
  { id: 'quantum', label: 'Quantum', icon: Calculator },
  { id: 'tree', label: 'Prob. Tree', icon: TreePine },
  { id: 'timeline', label: 'Timeline', icon: Clock },
  { id: 'costs', label: 'Legal Costs', icon: Banknote },
  { id: 'interest', label: 'Interest & Adv.', icon: Settings },
];

export default function ClaimEditor() {
  const { wsId, id } = useParams();
  const navigate = useNavigate();
  const isEdit = !!id;

  const {
    draft,
    dirty,
    errors,
    metrics,
    loadingDefaults,
    updateField,
    save,
    initNewClaim,
    fetchTemplate,
  } = useClaimEditor(wsId, id);

  const [activeTab, setActiveTab] = useState('basics');
  const [jurisdictionSelected, setJurisdictionSelected] = useState(isEdit);
  const [template, setTemplate] = useState(null);

  // Simulation hook
  const simRun = useClaimRun();
  const updateClaim = useClaimStore((s) => s.updateClaim);

  // For new claims, after jurisdiction is picked, load template for available stages
  const handleJurisdictionSelect = async (jurisdictionId) => {
    const claim = await initNewClaim(jurisdictionId);
    if (claim) {
      setJurisdictionSelected(true);
      const tmpl = await fetchTemplate(jurisdictionId);
      setTemplate(tmpl);
    }
  };

  // For edit mode, load template
  useEffect(() => {
    if (isEdit && draft?.jurisdiction && !template) {
      fetchTemplate(draft.jurisdiction).then(setTemplate);
    }
  }, [isEdit, draft?.jurisdiction, template, fetchTemplate]);

  const handleLoadTemplate = (tmpl) => {
    // Populate draft fields from template, preserving id and jurisdiction
    const fieldsToApply = [
      'claim_type', 'soc_value_cr', 'currency', 'claimant_share_pct',
      'claimant', 'respondent', 'arbitration', 'quantum', 'timeline',
      'legal_costs', 'interest',
    ];
    for (const key of fieldsToApply) {
      if (tmpl[key] !== undefined) updateField(key, tmpl[key]);
    }
    if (tmpl.name && !draft?.name) updateField('name', tmpl.name);
  };

  const handleSave = () => {
    save();
  };

  const handleSimulate = async () => {
    if (dirty) save();
    if (!draft?.id) return;

    // Build the claim config for the API
    const claimConfig = { ...draft };
    const simulation = {
      n_paths: draft.n_simulations || 10000,
      seed: draft.simulation_seed || 42,
    };

    const runId = await simRun.submit(claimConfig, simulation);
    if (runId) {
      // Store runId on the claim for results retrieval
      updateClaim(draft.id, { run_id: runId, status: 'running' });
    }
  };

  // When simulation completes, update claim status and allow navigation
  useEffect(() => {
    if (simRun.isComplete && simRun.runId && draft?.id) {
      updateClaim(draft.id, { status: 'simulated', run_id: simRun.runId });
    }
  }, [simRun.isComplete, simRun.runId, draft?.id]);

  const handleViewResults = () => {
    const rid = simRun.runId || draft?.run_id;
    navigate(`/workspace/${wsId}/claim/${draft.id}/results${rid ? `?runId=${rid}` : ''}`);
  };

  // Available stages from template (all possible pipeline positions)
  const availableStages = template?.available_stages || template?.default_timeline?.pre_arb_stages || draft?.timeline?.pre_arb_stages || [];

  /**
   * When the user selects a new current_stage, rebuild the timeline pipeline.
   * Each available_stage has a `pipeline_after` field listing subsequent stages.
   * The timeline gets: [selected_stage, ...pipeline_after stages with their durations].
   */
  const handleStageChange = (stageName) => {
    updateField('current_stage', stageName);

    // Find the selected stage in available_stages
    const stagePool = template?.available_stages || [];
    if (stagePool.length === 0) return;

    const selected = stagePool.find((s) => s.name === stageName);
    if (!selected) return;

    // Build the pipeline: selected stage + stages listed in pipeline_after
    const pipeline = [selected];
    const afterNames = selected.pipeline_after || [];
    for (const afterName of afterNames) {
      const afterStage = stagePool.find((s) => s.name === afterName);
      if (afterStage) pipeline.push(afterStage);
    }

    // Convert to timeline format (strip label/pipeline_after, keep durations)
    const preArbStages = pipeline.map((s) => ({
      name: s.name,
      duration_low: s.duration_low,
      duration_high: s.duration_high,
      legal_cost_low: s.legal_cost_low ?? 0,
      legal_cost_high: s.legal_cost_high ?? 0,
    }));

    const currentTimeline = draft?.timeline || {};
    updateField('timeline', {
      ...currentTimeline,
      pre_arb_stages: preArbStages,
    });
  };

  // Show jurisdiction selector for new claims before editing
  if (!isEdit && !jurisdictionSelected) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate(`/workspace/${wsId}/claims`)}
            className="p-1.5 text-slate-500 hover:text-slate-300 rounded-md hover:bg-slate-800"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <h1 className="text-2xl font-bold text-white">New Claim</h1>
        </div>
        {loadingDefaults ? (
          <div className="glass-card p-12 text-center">
            <div className="animate-pulse-slow text-sm text-slate-400">Loading jurisdiction defaults…</div>
          </div>
        ) : (
          <JurisdictionSelector onSelect={handleJurisdictionSelect} />
        )}
      </div>
    );
  }

  if (!draft) {
    return (
      <div className="glass-card p-12 text-center">
        <div className="animate-pulse-slow text-sm text-slate-400">Loading claim…</div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate(`/workspace/${wsId}/claims`)}
            className="p-1.5 text-slate-500 hover:text-slate-300 rounded-md hover:bg-slate-800"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <h1 className="text-2xl font-bold text-white">
            {isEdit ? 'Edit Claim' : 'New Claim'}
          </h1>
          {dirty && (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20">
              Unsaved
            </span>
          )}
        </div>
        <TemplateSelector onSelect={handleLoadTemplate} disabled={simRun?.isRunning} />
        <button
          onClick={handleSave}
          disabled={!dirty}
          className={
            'flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-all ' +
            (dirty
              ? 'bg-primary-500 hover:bg-primary-600 text-white'
              : 'bg-slate-800 text-slate-500 border border-white/5 cursor-not-allowed')
          }
        >
          <Save className="w-4 h-4" /> Save
        </button>
      </div>

      {/* Main layout: 2/3 editor + 1/3 summary */}
      <div className="flex gap-6">
        {/* Left: Tab editor */}
        <div className="flex-1 min-w-0" style={{ flex: '2 1 0%' }}>
          {/* Tab bar */}
          <div className="flex gap-1 mb-4 overflow-x-auto pb-1">
            {TABS.map(({ id: tabId, label, icon: Icon }) => (
              <button
                key={tabId}
                onClick={() => setActiveTab(tabId)}
                className={
                  'flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-all ' +
                  (activeTab === tabId
                    ? 'bg-primary-500/10 text-primary-500 border border-primary-500/20'
                    : 'text-slate-400 hover:text-slate-300 hover:bg-slate-800/50')
                }
              >
                <Icon className="w-3.5 h-3.5" />
                {label}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div className="glass-card p-6">
            {activeTab === 'basics' && (
              <ClaimBasicsForm
                draft={draft}
                updateField={updateField}
                availableStages={availableStages}
                onStageChange={handleStageChange}
              />
            )}
            {activeTab === 'arbitration' && (
              <ArbitrationConfig draft={draft} updateField={updateField} />
            )}
            {activeTab === 'quantum' && (
              <QuantumModelEditor draft={draft} updateField={updateField} />
            )}
            {activeTab === 'tree' && (
              <ProbabilityTreeEditor draft={draft} updateField={updateField} />
            )}
            {activeTab === 'timeline' && (
              <TimelineEditor draft={draft} updateField={updateField} />
            )}
            {activeTab === 'costs' && (
              <LegalCostEditor draft={draft} updateField={updateField} />
            )}
            {activeTab === 'interest' && (
              <InterestEditor draft={draft} updateField={updateField} />
            )}
          </div>
        </div>

        {/* Right: Summary card */}
        <div className="hidden lg:block" style={{ flex: '1 1 0%', maxWidth: '380px' }}>
          <ClaimSummaryCard
            draft={draft}
            metrics={metrics}
            errors={errors}
            onSimulate={handleSimulate}
            simRun={simRun}
            onViewResults={handleViewResults}
          />
        </div>
      </div>
    </div>
  );
}
