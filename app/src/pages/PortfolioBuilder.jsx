/**
 * @module PortfolioBuilder
 * @description Multi-step portfolio builder wizard.
 *
 * 4 steps: (1) Select Claims, (2) Choose Structure, (3) Configure Structure,
 * (4) Simulation Settings.  Saves portfolio config to portfolioStore
 * on each step.  Navigates to results page on submit.
 *
 * Route: /workspace/:wsId/portfolios/:portfolioId/build
 */
import { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Check, Play, Loader2, X } from 'lucide-react';
import { usePortfolioStore } from '../store/portfolioStore';
import { usePortfolioBuilder, usePortfolioRun } from '../hooks/usePortfolio';
import ClaimSelector from '../components/portfolio/ClaimSelector';
import StructureSelector from '../components/portfolio/StructureSelector';
import LitFundingConfig from '../components/portfolio/LitFundingConfig';
import FullPurchaseConfig from '../components/portfolio/FullPurchaseConfig';
import UpfrontTailConfig from '../components/portfolio/UpfrontTailConfig';
import StagedPaymentConfig from '../components/portfolio/StagedPaymentConfig';
import SimulationSettings from '../components/portfolio/SimulationSettings';
import PortfolioSummaryCard from '../components/portfolio/PortfolioSummaryCard';

const STRUCTURE_LABELS = {
  litigation_funding: 'Litigation Funding',
  monetisation_full_purchase: 'Full Purchase',
  monetisation_upfront_tail: 'Upfront + Tail',
  monetisation_staged: 'Staged Payments',
  comparative: 'Comparative',
};

export default function PortfolioBuilder() {
  const { wsId, id } = useParams();
  const navigate = useNavigate();
  const isEdit = !!id;

  const createPortfolio = usePortfolioStore((s) => s.createPortfolio);
  const updatePortfolio = usePortfolioStore((s) => s.updatePortfolio);

  // For new portfolios, create immediately and redirect
  useEffect(() => {
    if (!isEdit) {
      (async () => {
        const p = await createPortfolio(wsId, 'New Portfolio');
        navigate(`/workspace/${wsId}/portfolio/${p.id}`, { replace: true });
      })();
    }
  }, [isEdit]);

  const builder = usePortfolioBuilder(wsId, id);
  const run = usePortfolioRun();

  const {
    step, stepLabels, nextStep, prevStep, goToStep, canProceed,
    claims, selectedClaims, toggleClaim,
    structure, selectStructure, structureConfig, updateStructureConfig,
    simulation, updateSimulation,
    portfolioName, setPortfolioName,
    totalSOC, jurisdictions, avgWinRate, selectedClaimObjects,
    buildConfig, configErrors,
  } = builder;

  // Handle run submission
  const handleRun = async () => {
    // Save to store first
    if (id) {
      await updatePortfolio(id, {
        name: portfolioName,
        claim_ids: selectedClaims,
        structure,
        structure_config: structureConfig,
        simulation,
      });
    }

    const config = buildConfig();
    const runId = await run.submit(config);
    if (runId && id) {
      await updatePortfolio(id, { run_id: runId, status: 'running' });
    }
  };

  // Navigate to results on completion
  useEffect(() => {
    if (run.isComplete && run.runId && id) {
      updatePortfolio(id, { status: 'completed', run_id: run.runId }).then(() => {
        navigate(`/workspace/${wsId}/portfolio/${id}/results?runId=${run.runId}`);
      });
    }
  }, [run.isComplete]);

  // Don't render until portfolio exists (redirect in progress for new)
  if (!id) return null;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate(`/workspace/${wsId}/portfolios`)}
            className="p-1.5 text-slate-500 hover:text-slate-300 rounded-md hover:bg-slate-800"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <input
              type="text"
              value={portfolioName}
              onChange={(e) => setPortfolioName(e.target.value)}
              placeholder="Portfolio Name"
              className="text-2xl font-bold text-white bg-transparent border-none outline-none placeholder:text-slate-600 w-64"
            />
          </div>
        </div>
        {structure && (
          <span className="text-xs px-2.5 py-1 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 font-medium">
            {STRUCTURE_LABELS[structure] || structure}
          </span>
        )}
      </div>

      {/* Step indicator */}
      <div className="glass-card px-6 py-4">
        <div className="flex items-center gap-1">
          {stepLabels.map((label, idx) => {
            const isActive = idx === step;
            const isDone = idx < step;
            return (
              <div key={label} className="flex items-center flex-1">
                <button
                  type="button"
                  onClick={() => idx <= step && goToStep(idx)}
                  className={
                    'flex items-center gap-2 text-sm font-medium transition-all ' +
                    (isActive
                      ? 'text-cyan-400'
                      : isDone
                      ? 'text-emerald-400 cursor-pointer hover:text-emerald-300'
                      : 'text-slate-600 cursor-default')
                  }
                >
                  <span
                    className={
                      'w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ' +
                      (isActive
                        ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/40'
                        : isDone
                        ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                        : 'bg-slate-800 text-slate-600 border border-slate-700')
                    }
                  >
                    {isDone ? <Check className="w-3 h-3" /> : idx + 1}
                  </span>
                  <span className="hidden sm:inline whitespace-nowrap">{label}</span>
                </button>
                {idx < stepLabels.length - 1 && (
                  <div className={
                    'flex-1 h-px mx-2 ' +
                    (idx < step ? 'bg-emerald-500/30' : 'bg-slate-700')
                  } />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Main content: 2/3 editor + 1/3 summary */}
      <div className="flex gap-6">
        {/* Left: Step content */}
        <div className="flex-1 min-w-0" style={{ flex: '2 1 0%' }}>
          <div className="glass-card p-6">
            {/* STEP 0: Claim Selection */}
            {step === 0 && (
              <ClaimSelector
                claims={claims}
                selectedClaims={selectedClaims}
                toggleClaim={toggleClaim}
                totalSOC={totalSOC}
                jurisdictions={jurisdictions}
                avgWinRate={avgWinRate}
              />
            )}

            {/* STEP 1: Structure Selection */}
            {step === 1 && (
              <StructureSelector
                structure={structure}
                onSelect={selectStructure}
              />
            )}

            {/* STEP 2: Configure */}
            {step === 2 && (
              <div className="space-y-6">
                {structure === 'litigation_funding' && (
                  <LitFundingConfig config={structureConfig} onChange={updateStructureConfig} />
                )}
                {structure === 'monetisation_full_purchase' && (
                  <FullPurchaseConfig config={structureConfig} onChange={updateStructureConfig} />
                )}
                {structure === 'monetisation_upfront_tail' && (
                  <UpfrontTailConfig config={structureConfig} onChange={updateStructureConfig} />
                )}
                {structure === 'monetisation_staged' && (
                  <StagedPaymentConfig config={structureConfig} onChange={updateStructureConfig} />
                )}
                {structure === 'comparative' && (
                  <div className="space-y-8">
                    <div>
                      <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Litigation Funding Configuration</h3>
                      <LitFundingConfig
                        config={structureConfig.lit_funding || {}}
                        onChange={(updates) => updateStructureConfig({
                          lit_funding: { ...(structureConfig.lit_funding || {}), ...updates },
                        })}
                      />
                    </div>
                    <hr className="border-slate-700/50" />
                    <div>
                      <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Monetisation Configuration</h3>
                      <UpfrontTailConfig
                        config={structureConfig.monetisation || {}}
                        onChange={(updates) => updateStructureConfig({
                          monetisation: { ...(structureConfig.monetisation || {}), ...updates },
                        })}
                      />
                    </div>
                  </div>
                )}

                <hr className="border-slate-700/50" />

                <SimulationSettings simulation={simulation} onChange={updateSimulation} />

                {configErrors.length > 0 && (
                  <div className="p-3 rounded-lg bg-red-500/5 border border-red-500/20">
                    <div className="text-xs text-red-400 font-medium mb-1">Validation Issues</div>
                    <ul className="space-y-0.5">
                      {configErrors.map((err, i) => (
                        <li key={i} className="text-[11px] text-red-400/80 pl-3">• {err}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {/* STEP 3: Review & Run */}
            {step === 3 && (
              <div className="space-y-6">
                <h3 className="text-sm font-semibold text-white">Review Your Portfolio</h3>

                {/* Claims summary */}
                <div className="glass-card p-4">
                  <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Selected Claims ({selectedClaims.length})</h4>
                  <div className="space-y-2">
                    {selectedClaimObjects.map((c) => (
                      <div key={c.id} className="flex items-center justify-between text-sm">
                        <span className="text-white">{c.name || 'Unnamed Claim'}</span>
                        <div className="flex items-center gap-3 text-xs text-slate-500">
                          <span>₹{(c.soc_value_cr || 0).toLocaleString()} Cr</span>
                          <span>{((c.arbitration?.win_probability || 0) * 100).toFixed(0)}% win</span>
                          <span className={
                            c.status === 'simulated'
                              ? 'text-emerald-400'
                              : 'text-amber-400'
                          }>
                            {c.status}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Structure summary */}
                <div className="glass-card p-4">
                  <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Structure</h4>
                  <p className="text-sm text-white font-medium">{STRUCTURE_LABELS[structure] || structure}</p>
                </div>

                {/* Simulation summary */}
                <div className="glass-card p-4">
                  <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Simulation Parameters</h4>
                  <div className="grid grid-cols-3 gap-3 text-sm">
                    <div><span className="text-slate-500">Paths:</span> <span className="text-white">{simulation.n_paths?.toLocaleString()}</span></div>
                    <div><span className="text-slate-500">Seed:</span> <span className="text-white">{simulation.seed}</span></div>
                    <div><span className="text-slate-500">Discount:</span> <span className="text-white">{((simulation.discount_rate || 0.12) * 100).toFixed(1)}%</span></div>
                  </div>
                </div>

                {/* Run button */}
                <RunProgressPanel run={run} onRun={handleRun} />
              </div>
            )}
          </div>

          {/* Navigation buttons */}
          <div className="flex items-center justify-between mt-4">
            <button
              type="button"
              onClick={prevStep}
              disabled={step === 0}
              className={
                'flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-all ' +
                (step === 0
                  ? 'text-slate-600 cursor-not-allowed'
                  : 'text-slate-300 hover:text-white hover:bg-slate-800')
              }
            >
              <ArrowLeft className="w-4 h-4" /> Back
            </button>

            {step < 3 && (
              <button
                type="button"
                onClick={nextStep}
                disabled={!canProceed}
                className={
                  'flex items-center gap-1.5 px-5 py-2 rounded-lg text-sm font-medium transition-all ' +
                  (canProceed
                    ? 'bg-primary-500 hover:bg-primary-600 text-white'
                    : 'bg-slate-800 text-slate-500 border border-white/5 cursor-not-allowed')
                }
              >
                Next <ArrowRight className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* Right: Summary sidebar */}
        <div className="w-72 shrink-0 hidden lg:block">
          <PortfolioSummaryCard
            portfolioName={portfolioName}
            selectedClaims={selectedClaims}
            selectedClaimObjects={selectedClaimObjects}
            structure={structure}
            structureConfig={structureConfig}
            simulation={simulation}
            totalSOC={totalSOC}
            jurisdictions={jurisdictions}
            avgWinRate={avgWinRate}
          />
        </div>
      </div>
    </div>
  );
}

/* ---------- Run Progress Panel ---------- */
function RunProgressPanel({ run, onRun }) {
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef(null);

  useEffect(() => {
    if (run.isRunning) {
      const start = Date.now();
      timerRef.current = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000);
    } else {
      clearInterval(timerRef.current);
      if (!run.isRunning) setElapsed(0);
    }
    return () => clearInterval(timerRef.current);
  }, [run.isRunning]);

  const fmtTime = (s) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return m > 0 ? `${m}m ${sec}s` : `${sec}s`;
  };

  return (
    <div className="text-center pt-4">
      {run.error && !run.isRunning && (
        <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-400">
          {run.error}
        </div>
      )}

      {run.isRunning && (
        <div className="glass-card p-5 space-y-3 text-left">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm text-cyan-400 font-medium">
              <Loader2 className="w-4 h-4 animate-spin" />
              Running Simulation
            </div>
            <button
              onClick={run.reset}
              className="p-1 rounded hover:bg-slate-700 text-slate-500 hover:text-slate-300 transition-colors"
              title="Cancel"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Stage label */}
          <p className="text-xs text-slate-400">
            {run.stage || 'Initializing...'}
          </p>

          {/* Progress bar */}
          <div className="w-full bg-slate-800 rounded-full h-2 overflow-hidden">
            <div
              className="bg-gradient-to-r from-cyan-500 to-indigo-500 h-full rounded-full transition-all duration-500"
              style={{ width: `${Math.max(run.progress, 5)}%` }}
            />
          </div>

          {/* Progress % + elapsed */}
          <div className="flex items-center justify-between text-[11px] text-slate-500">
            <span>{run.progress}%</span>
            <span>Elapsed: {fmtTime(elapsed)}</span>
          </div>
        </div>
      )}

      {run.isFailed && (
        <div className="mb-4 space-y-3">
          <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-400">
            Simulation failed. {run.error || 'Check server logs.'}
          </div>
          <button
            type="button"
            onClick={run.reset}
            className="text-xs text-slate-400 hover:text-slate-300 underline"
          >
            Reset and try again
          </button>
        </div>
      )}

      {!run.isRunning && !run.isComplete && !run.isFailed && (
        <button
          type="button"
          onClick={onRun}
          disabled={run.submitting}
          className="inline-flex items-center gap-2 px-8 py-3 rounded-xl bg-gradient-to-r from-cyan-500 to-indigo-500 text-white font-semibold text-sm hover:from-cyan-400 hover:to-indigo-400 transition-all disabled:opacity-50"
        >
          {run.submitting ? (
            <><Loader2 className="w-4 h-4 animate-spin" /> Submitting…</>
          ) : (
            <><Play className="w-4 h-4" /> Run Analysis</>
          )}
        </button>
      )}
    </div>
  );
}
