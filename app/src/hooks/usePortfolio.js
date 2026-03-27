import { useState, useCallback, useRef, useEffect } from 'react';
import { usePortfolioStore } from '../store/portfolioStore';
import { useClaimStore } from '../store/claimStore';
import { api } from '../services/api';

const STEPS = ['claims', 'structure', 'configure', 'review'];
const STEP_LABELS = ['Select Claims', 'Choose Structure', 'Configure', 'Review & Run'];

/**
 * usePortfolioBuilder — manages the multi-step wizard state for portfolio building.
 */
export function usePortfolioBuilder(wsId, portfolioId) {
  const store = usePortfolioStore();
  const claimStore = useClaimStore();

  // Load data on mount
  useEffect(() => {
    store.loadPortfolios(wsId);
    claimStore.loadClaims(wsId);
  }, [wsId]);

  const portfolio = store.portfolios.find((p) => p.id === portfolioId) || null;
  const claims = claimStore.claims;

  const [step, setStep] = useState(0);
  const [selectedClaims, setSelectedClaims] = useState(portfolio?.claim_ids || []);
  const [structure, setStructure] = useState(portfolio?.structure || null);
  const [structureConfig, setStructureConfig] = useState(portfolio?.structure_config || {});
  const [simulation, setSimulation] = useState(portfolio?.simulation || {
    n_paths: 10000,
    seed: 42,
    discount_rate: 0.12,
    risk_free_rate: 0.07,
    start_date: '2026-04-30',
  });
  const [portfolioName, setPortfolioName] = useState(portfolio?.name || '');

  // Sync if portfolio loads after initial render
  useEffect(() => {
    if (portfolio) {
      setSelectedClaims(portfolio.claim_ids || []);
      setStructure(portfolio.structure || null);
      setStructureConfig(portfolio.structure_config || {});
      setSimulation(portfolio.simulation || simulation);
      setPortfolioName(portfolio.name || '');
    }
  }, [portfolio?.id]);

  const toggleClaim = useCallback((claimId) => {
    setSelectedClaims((prev) =>
      prev.includes(claimId)
        ? prev.filter((c) => c !== claimId)
        : [...prev, claimId]
    );
  }, []);

  const selectStructure = useCallback((type) => {
    setStructure(type);
    // Set default config for each structure type
    if (type === 'litigation_funding') {
      setStructureConfig((prev) => ({
        cost_multiple_cap: 4.0,
        award_ratio_cap: 0.25,
        waterfall_type: 'min',
        cost_multiple_range: { min: 2.0, max: 6.0, step: 0.5 },
        award_ratio_range: { min: 0.10, max: 0.40, step: 0.05 },
        ...prev,
      }));
    } else if (type === 'monetisation_full_purchase') {
      setStructureConfig((prev) => ({
        purchase_prices: [5, 7.5, 10, 15, 20, 25],
        pricing_basis: 'soc',
        legal_cost_bearer: 'investor',
        shared_split_pct: 50,
        purchased_share_pct: 100,
        ...prev,
      }));
    } else if (type === 'monetisation_upfront_tail') {
      setStructureConfig((prev) => ({
        upfront_range: { min: 5, max: 50, step: 5 },
        tail_range: { min: 0, max: 50, step: 5 },
        pricing_basis: 'soc',
        fine_grained: false,
        custom_step_upfront: 5,
        custom_step_tail: 5,
        ...prev,
      }));
    } else if (type === 'monetisation_staged') {
      setStructureConfig((prev) => ({
        milestones: [
          { name: 'Signing', amount: 5, unit: 'pct_soc' },
          { name: 'DAB Award', amount: 5, unit: 'pct_soc' },
        ],
        legal_cost_bearer: 'investor',
        purchased_share_pct: 100,
        ...prev,
      }));
    } else if (type === 'comparative') {
      setStructureConfig((prev) => ({
        lit_funding: {
          cost_multiple_cap: 4.0,
          award_ratio_cap: 0.25,
          waterfall_type: 'min',
          cost_multiple_range: { min: 2.0, max: 6.0, step: 0.5 },
          award_ratio_range: { min: 0.10, max: 0.40, step: 0.05 },
        },
        monetisation: {
          upfront_range: { min: 5, max: 50, step: 5 },
          tail_range: { min: 0, max: 50, step: 5 },
          pricing_basis: 'soc',
        },
        ...prev,
      }));
    }
  }, []);

  const updateStructureConfig = useCallback((updates) => {
    setStructureConfig((prev) => ({ ...prev, ...updates }));
  }, []);

  const updateSimulation = useCallback((updates) => {
    setSimulation((prev) => ({ ...prev, ...updates }));
  }, []);

  const nextStep = useCallback(() => {
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  }, []);

  const prevStep = useCallback(() => {
    setStep((s) => Math.max(s - 1, 0));
  }, []);

  const goToStep = useCallback((idx) => {
    if (idx >= 0 && idx < STEPS.length) setStep(idx);
  }, []);

  // Validation for each step + validation errors for step 2
  const configErrors = (() => {
    if (step !== 2) return [];
    const errs = [];

    // Grid ranges validation
    const checkRange = (range, name) => {
      if (!range) return;
      if (range.min != null && range.max != null && range.min >= range.max)
        errs.push(`${name}: min must be < max`);
      if (range.step != null && range.step <= 0)
        errs.push(`${name}: step must be > 0`);
      if (range.min != null && range.max != null && range.step != null && range.step > (range.max - range.min))
        errs.push(`${name}: step must be ≤ (max - min)`);
    };

    if (structure === 'litigation_funding') {
      if (structureConfig.cost_multiple_cap != null && structureConfig.cost_multiple_cap <= 0)
        errs.push('Cost multiple cap must be > 0');
      if (structureConfig.award_ratio_cap != null && (structureConfig.award_ratio_cap <= 0 || structureConfig.award_ratio_cap > 1))
        errs.push('Award ratio cap must be in (0, 1]');
      checkRange(structureConfig.cost_multiple_range, 'Cost multiple range');
      checkRange(structureConfig.award_ratio_range, 'Award ratio range');
    } else if (structure === 'monetisation_upfront_tail') {
      checkRange(structureConfig.upfront_range, 'Upfront range');
      checkRange(structureConfig.tail_range, 'Tail range');
    } else if (structure === 'monetisation_staged') {
      const milestones = structureConfig.milestones || [];
      if (milestones.length === 0) errs.push('At least one milestone payment is required');
      for (const m of milestones) {
        if (m.amount != null && m.amount <= 0) errs.push(`Milestone '${m.name}': payment must be > 0`);
      }
    }

    // Simulation settings
    if (simulation.n_paths != null && simulation.n_paths < 100)
      errs.push('N paths must be ≥ 100');

    return errs;
  })();

  const canProceed = (() => {
    switch (step) {
      case 0: return selectedClaims.length > 0;
      case 1: return !!structure;
      case 2: return configErrors.length === 0;
      case 3: return true;
      default: return false;
    }
  })();

  // Save current state back to store
  const saveToStore = useCallback(() => {
    if (!portfolioId) return null;
    store.updatePortfolio(portfolioId, {
      name: portfolioName,
      claim_ids: selectedClaims,
      structure,
      structure_config: structureConfig,
      simulation,
    });
    return portfolioId;
  }, [portfolioId, portfolioName, selectedClaims, structure, structureConfig, simulation]);

  // Build the config object for API submission
  const buildConfig = useCallback(() => {
    const selectedClaimObjects = claims.filter((c) => selectedClaims.includes(c.id));

    let structurePayload;
    if (structure === 'litigation_funding') {
      structurePayload = {
        type: 'litigation_funding',
        params: {
          cost_multiple_cap: structureConfig.cost_multiple_cap,
          award_ratio_cap: structureConfig.award_ratio_cap,
          waterfall_type: structureConfig.waterfall_type,
          cost_multiple_range: structureConfig.cost_multiple_range,
          award_ratio_range: structureConfig.award_ratio_range,
        },
      };
    } else if (structure === 'monetisation_full_purchase') {
      structurePayload = {
        type: 'monetisation_full_purchase',
        params: {
          purchase_prices: structureConfig.purchase_prices,
          pricing_basis: structureConfig.pricing_basis,
          legal_cost_bearer: structureConfig.legal_cost_bearer,
          shared_split_pct: structureConfig.shared_split_pct,
          purchased_share_pct: structureConfig.purchased_share_pct,
        },
      };
    } else if (structure === 'monetisation_upfront_tail') {
      const ur = structureConfig.upfront_range;
      const tr = structureConfig.tail_range;
      structurePayload = {
        type: 'monetisation_upfront_tail',
        params: {
          upfront_range: { min: ur.min / 100, max: ur.max / 100, step: ur.step / 100 },
          tail_range: { min: tr.min / 100, max: tr.max / 100, step: tr.step / 100 },
          pricing_basis: structureConfig.pricing_basis,
        },
      };
    } else if (structure === 'monetisation_staged') {
      structurePayload = {
        type: 'monetisation_staged',
        params: {
          milestones: structureConfig.milestones,
          legal_cost_bearer: structureConfig.legal_cost_bearer,
          purchased_share_pct: structureConfig.purchased_share_pct,
        },
      };
    } else if (structure === 'comparative') {
      structurePayload = {
        type: 'comparative',
        params: {
          lit_funding: structureConfig.lit_funding,
          monetisation: structureConfig.monetisation,
        },
      };
    }

    return {
      portfolio_config: {
        id: portfolioId || `portfolio_${Date.now()}`,
        name: portfolioName || 'Portfolio Analysis',
        claim_ids: selectedClaims,
        structure: structurePayload,
        simulation,
      },
      claims: selectedClaimObjects,
    };
  }, [claims, selectedClaims, structure, structureConfig, simulation, portfolioId, portfolioName]);

  // Summary stats
  const selectedClaimObjects = claims.filter((c) => selectedClaims.includes(c.id));
  const totalSOC = selectedClaimObjects.reduce((sum, c) => sum + (parseFloat(c.soc_value_cr) || 0), 0);
  const jurisdictions = [...new Set(selectedClaimObjects.map((c) => c.jurisdiction))];
  const avgWinRate = selectedClaimObjects.length > 0
    ? selectedClaimObjects.reduce((sum, c) => sum + (c.arbitration?.win_probability || 0), 0) / selectedClaimObjects.length
    : 0;

  return {
    // Wizard state
    step,
    stepName: STEPS[step],
    stepLabel: STEP_LABELS[step],
    steps: STEPS,
    stepLabels: STEP_LABELS,
    nextStep,
    prevStep,
    goToStep,
    canProceed,

    // Portfolio data
    portfolio,
    portfolioName,
    setPortfolioName,

    // Claim selection
    claims,
    selectedClaims,
    toggleClaim,
    setSelectedClaims,

    // Structure
    structure,
    selectStructure,
    structureConfig,
    updateStructureConfig,

    // Simulation
    simulation,
    updateSimulation,

    // Actions
    saveToStore,
    buildConfig,

    // Summary
    totalSOC,
    jurisdictions,
    avgWinRate,
    selectedClaimObjects,

    // Validation
    configErrors,
  };
}

/**
 * usePortfolioRun — manages simulation submission and polling.
 */
export function usePortfolioRun() {
  const [runId, setRunId] = useState(null);
  const [status, setStatus] = useState(null); // queued, running, completed, failed
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState('');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const pollRef = useRef(null);

  const submit = useCallback(async (config) => {
    setSubmitting(true);
    setError(null);
    setStatus(null);
    setProgress(0);

    try {
      const data = await api.post('/api/simulate/portfolio', {
        ...config,
        workspace_id: config.portfolio_config?.workspace_id,
        portfolio_id: config.portfolio_config?.id,
      });
      setRunId(data.runId);
      setStatus('queued');
      return data.runId;
    } catch (err) {
      setError(err.message);
      return null;
    } finally {
      setSubmitting(false);
    }
  }, []);

  // Poll status
  useEffect(() => {
    if (!runId || status === 'completed' || status === 'failed') {
      if (pollRef.current) clearInterval(pollRef.current);
      return;
    }

    pollRef.current = setInterval(async () => {
      try {
        const data = await api.get(`/api/status/${encodeURIComponent(runId)}`);
        setStatus(data.status);
        setProgress(data.progress || 0);
        if (data.stage) setStage(data.stage);
        if (data.error) setError(data.error);
        if (data.status === 'completed' || data.status === 'failed') {
          clearInterval(pollRef.current);
        }
      } catch { /* ignore transient errors */ }
    }, 2000);

    return () => clearInterval(pollRef.current);
  }, [runId, status]);

  const reset = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    setRunId(null);
    setStatus(null);
    setProgress(0);
    setStage('');
    setError(null);
    setSubmitting(false);
  }, []);

  return {
    runId,
    status,
    progress,
    stage,
    error,
    submitting,
    submit,
    reset,
    isRunning: status === 'queued' || status === 'running',
    isComplete: status === 'completed',
    isFailed: status === 'failed',
  };
}
