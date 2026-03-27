import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useClaimStore } from '../store/claimStore';
import { api } from '../services/api';

/**
 * useClaimEditor — manages form state for the claim editor.
 * Loads from store, tracks dirty state, validates, saves.
 */
export function useClaimEditor(wsId, claimId) {
  const store = useClaimStore();
  const [draft, setDraft] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [errors, setErrors] = useState([]);
  const [jurisdictionDefaults, setJurisdictionDefaults] = useState(null);
  const [loadingDefaults, setLoadingDefaults] = useState(false);
  const originalRef = useRef(null);

  // Load existing claim if editing
  useEffect(() => {
    if (claimId && wsId) {
      (async () => {
        await store.loadClaims(wsId);
        const claims = store.getClaimsByWorkspace(wsId);
        const existing = claims.find((c) => c.id === claimId);
        if (existing) {
          setDraft({ ...existing });
          originalRef.current = JSON.stringify(existing);
          setDirty(false);
        }
      })();
    }
  }, [claimId, wsId]);

  /** Fetch jurisdiction defaults from server */
  const fetchDefaults = useCallback(async (jurisdictionId) => {
    setLoadingDefaults(true);
    try {
      const data = await api.get(`/api/jurisdictions/${encodeURIComponent(jurisdictionId)}/defaults`);
      setJurisdictionDefaults(data);
      return data;
    } catch {
      return null;
    } finally {
      setLoadingDefaults(false);
    }
  }, []);

  /** Fetch jurisdiction template (full tree structure) */
  const fetchTemplate = useCallback(async (jurisdictionId) => {
    try {
      return await api.get(`/api/jurisdictions/${encodeURIComponent(jurisdictionId)}`);
    } catch {
      return null;
    }
  }, []);

  /** Initialize a new claim with jurisdiction defaults */
  const initNewClaim = useCallback(async (jurisdictionId) => {
    const [defaults, template] = await Promise.all([
      fetchDefaults(jurisdictionId),
      fetchTemplate(jurisdictionId),
    ]);
    const merged = { ...defaults };
    if (template?.default_challenge_tree) {
      merged.challenge_tree = template.default_challenge_tree;
    }
    const claim = await store.createClaim(wsId, jurisdictionId, merged);
    setDraft({ ...claim });
    originalRef.current = JSON.stringify(claim);
    setDirty(false);
    return claim;
  }, [wsId, fetchDefaults, fetchTemplate, store]);

  /** Update a single field or nested path in the draft */
  const updateField = useCallback((path, value) => {
    setDraft((prev) => {
      if (!prev) return prev;
      const next = { ...prev };
      // Support dot-notation: 'arbitration.win_probability'
      const parts = path.split('.');
      if (parts.length === 1) {
        next[parts[0]] = value;
      } else {
        let target = next;
        for (let i = 0; i < parts.length - 1; i++) {
          target[parts[i]] = { ...target[parts[i]] };
          target = target[parts[i]];
        }
        target[parts[parts.length - 1]] = value;
      }
      return next;
    });
    setDirty(true);
  }, []);

  /** Validate the current draft */
  const validate = useCallback(() => {
    if (!draft) return ['No claim loaded'];
    const errs = [];
    if (!draft.name?.trim()) errs.push('Claim name is required');
    if (!draft.jurisdiction) errs.push('Jurisdiction is required');

    // SOC
    if (draft.soc_value_cr == null || draft.soc_value_cr <= 0)
      errs.push('SOC must be positive');

    // Claimant share
    if (draft.claimant_share_pct != null && (draft.claimant_share_pct <= 0 || draft.claimant_share_pct > 1))
      errs.push('Claimant share must be in (0, 1]');

    // Quantum bands
    if (draft.quantum?.bands?.length) {
      const sum = draft.quantum.bands.reduce((s, b) => s + (b.probability || 0), 0);
      if (Math.abs(sum - 1.0) > 0.001) errs.push(`Quantum band probabilities sum to ${sum.toFixed(4)}, must equal 1.0`);
      for (let i = 0; i < draft.quantum.bands.length; i++) {
        const b = draft.quantum.bands[i];
        if (b.low < 0 || b.low > 1) errs.push(`Band #${i + 1}: low must be in [0,1]`);
        if (b.high < 0 || b.high > 1) errs.push(`Band #${i + 1}: high must be in [0,1]`);
        if (b.low >= b.high) errs.push(`Band #${i + 1}: low (${b.low}) must be < high (${b.high})`);
      }
    }

    // Arbitration probs
    if (draft.arbitration) {
      const { win_probability, re_arb_win_probability } = draft.arbitration;
      if (win_probability != null && (win_probability < 0 || win_probability > 1))
        errs.push('Arb win probability must be in [0, 1]');
      if (re_arb_win_probability != null && (re_arb_win_probability < 0 || re_arb_win_probability > 1))
        errs.push('Re-arb win probability must be in [0, 1]');
    }

    // Timeline stages
    if (draft.timeline?.pre_arb_stages?.length) {
      for (const s of draft.timeline.pre_arb_stages) {
        if (s.duration_low != null && s.duration_high != null) {
          if (s.duration_low < 0 || s.duration_high < 0)
            errs.push(`Stage '${s.name}': durations must be ≥ 0`);
          if (s.duration_low > s.duration_high)
            errs.push(`Stage '${s.name}': duration low must be ≤ high`);
        }
        if (s.legal_cost_low != null && s.legal_cost_high != null) {
          if (s.legal_cost_low < 0 || s.legal_cost_high < 0)
            errs.push(`Stage '${s.name}': legal costs must be ≥ 0`);
          if (s.legal_cost_low > s.legal_cost_high)
            errs.push(`Stage '${s.name}': legal cost low must be ≤ high`);
        }
      }
    }

    // Legal costs overrun
    if (draft.legal_costs?.overrun_low != null && draft.legal_costs?.overrun_high != null) {
      if (draft.legal_costs.overrun_low > draft.legal_costs.overrun_high)
        errs.push('Legal cost overrun low must be ≤ high');
    }

    setErrors(errs);
    return errs;
  }, [draft]);

  // Auto-validate on draft changes
  useEffect(() => {
    if (draft) validate();
  }, [draft, validate]);

  /** Save draft to store */
  const save = useCallback(async () => {
    if (!draft) return;
    if (claimId) {
      await store.updateClaim(draft.id, draft);
    } else if (draft.id) {
      await store.updateClaim(draft.id, draft);
    }
    originalRef.current = JSON.stringify(draft);
    setDirty(false);
  }, [draft, claimId, store]);

  /** Computed metrics from current draft */
  const metrics = useMemo(() => {
    if (!draft) return {};

    // E[Quantum | Win]
    let eQuantum = 0;
    const bands = draft.quantum?.bands || [];
    for (const b of bands) {
      eQuantum += ((b.low + b.high) / 2) * (b.probability || 0);
    }
    const eQuantumCr = eQuantum * (draft.soc_value_cr || 0);

    // E[Duration] from timeline — only remaining stages from current_stage
    let eDuration = 0;
    const stages = draft.timeline?.pre_arb_stages || [];
    const currentStage = draft.current_stage || '';
    let foundStage = !currentStage; // if no stage set, sum all
    for (const s of stages) {
      if (!foundStage && s.name === currentStage) foundStage = true;
      if (foundStage) {
        eDuration += ((s.duration_low || 0) + (s.duration_high || 0)) / 2;
      }
    }
    // If current_stage not found in stages, sum all (conservative fallback)
    if (!foundStage) {
      eDuration = 0;
      for (const s of stages) {
        eDuration += ((s.duration_low || 0) + (s.duration_high || 0)) / 2;
      }
    }
    eDuration += (draft.timeline?.payment_delay_months || 0);

    // E[Legal Costs]
    let eLegalCosts = (draft.legal_costs?.one_time_tribunal_cr || 0) + (draft.legal_costs?.one_time_expert_cr || 0);
    const perStage = draft.legal_costs?.per_stage_costs || {};
    for (const key of Object.keys(perStage)) {
      const s = perStage[key];
      eLegalCosts += ((s.legal_cost_low || 0) + (s.legal_cost_high || 0)) / 2;
    }
    const overrunFactor = 1 + (
      ((draft.legal_costs?.overrun_alpha || 2) /
        ((draft.legal_costs?.overrun_alpha || 2) + (draft.legal_costs?.overrun_beta || 5))) *
      ((draft.legal_costs?.overrun_high || 0.6) - (draft.legal_costs?.overrun_low || -0.1)) +
      (draft.legal_costs?.overrun_low || -0.1)
    );
    eLegalCosts *= overrunFactor;

    // Win rate from arbitration prob
    const arbWin = draft.arbitration?.win_probability ?? 0.7;
    const reArbWin = draft.arbitration?.re_arb_win_probability ?? 0.7;

    return {
      eQuantumPct: eQuantum,
      eQuantumCr,
      eDuration: Math.round(eDuration),
      eLegalCosts: eLegalCosts.toFixed(2),
      arbWinProb: arbWin,
      reArbWinProb: reArbWin,
      overrunFactor: ((overrunFactor - 1) * 100).toFixed(1),
    };
  }, [draft]);

  return {
    draft,
    setDraft,
    dirty,
    errors,
    metrics,
    loadingDefaults,
    updateField,
    validate,
    save,
    initNewClaim,
    fetchDefaults,
    fetchTemplate,
  };
}

/**
 * useJurisdictions — fetch list of available jurisdictions
 */
export function useJurisdictions() {
  const [jurisdictions, setJurisdictions] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await api.get('/api/jurisdictions');
        if (!cancelled) setJurisdictions(data.jurisdictions || []);
      } catch {
        if (!cancelled) setJurisdictions([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return { jurisdictions, loading };
}
