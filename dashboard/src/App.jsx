/**
 * App.jsx — Adaptive tab router for claim analytics dashboard.
 *
 * Reads structureType from useDashboardData and shows ONLY the relevant tabs.
 * Structure types: litigation_funding, monetisation_full_purchase,
 *   monetisation_upfront_tail, monetisation_staged, comparative.
 *
 * Universal tabs use V2 components for Probability, Quantum, and Cashflow.
 * Structure-specific tabs use V2 or platform components as appropriate.
 */

import React, { useState } from 'react';
import { COLORS, FONT, UI_TEXT_SCALE_OPTIONS, useUISettings } from './theme';
import { getClaimDisplayName } from './utils/claimNames';
import { useDashboardData } from './data/dashboardData';
import { TabBar, LoadingScreen, ErrorScreen, Card, ErrorBoundary } from './components/Shared';

/* ── Platform components ── */
import ExecutiveSummary from './components/ExecutiveSummary';
import PerClaimContribution from './components/PerClaimContribution';
import RiskAnalytics from './components/RiskAnalytics';
import LitFundingWaterfall from './components/LitFundingWaterfall';
import PurchaseSensitivity from './components/PurchaseSensitivity';
import MilestoneAnalysis from './components/MilestoneAnalysis';
import ComparativeView from './components/ComparativeView';
import ExportPanel from './components/ExportPanel';

/* ── Single-Claim components ── */
import ClaimExecutiveSummary from './components/claim/ClaimExecutiveSummary';
import ClaimProbabilityOutcomes from './components/claim/ClaimProbabilityOutcomes';
import ClaimQuantumTimeline from './components/claim/ClaimQuantumTimeline';
import ClaimInvestmentAnalysis from './components/claim/ClaimInvestmentAnalysis';
import ClaimCashflow from './components/claim/ClaimCashflow';
import ClaimRiskAnalytics from './components/claim/ClaimRiskAnalytics';
import ClaimSensitivityBreakeven from './components/claim/ClaimSensitivityBreakeven';
import ClaimExport from './components/claim/ClaimExport';

/* ── V2 components (rich, data-driven) ── */
import {
  V2ProbabilityOutcomes,
  V2QuantumTimeline,
  V2CashflowWaterfall,
  V2InvestmentAnalysis,
  V2PricingView,
  V2PricingSurface,
  V2PerClaimAnalysis,
  V2LegalCosts,
  V2ReportView,
  V2ProbabilitySensitivity,
  V2SettlementAnalysis,
} from './components/v2';

/* ── Tab definitions ── */
const UNIVERSAL_TABS = [
  { id: 'executive',    label: 'Executive Summary',      icon: '📋' },
  { id: 'per_claim',    label: 'Per-Claim Contribution', icon: '🎯' },
  { id: 'probability',  label: 'Probability & Outcomes', icon: '🎲' },
  { id: 'quantum',      label: 'Quantum & Timeline',     icon: '⏱️' },
  { id: 'cashflow',     label: 'Cashflow & Waterfall',   icon: '💰' },
  { id: 'risk',         label: 'Risk Analytics',         icon: '⚠️' },
  { id: 'export',       label: 'Export & Reports',       icon: '📤' },
];

const SINGLE_CLAIM_TABS = [
  { id: 'claim_executive',    label: 'Executive Summary',       icon: '📋' },
  { id: 'claim_probability',  label: 'Probability & Outcomes',  icon: '🎲' },
  { id: 'claim_quantum',      label: 'Quantum & Timeline',      icon: '⏱️' },
  { id: 'claim_investment',   label: 'Investment Analysis',     icon: '📊' },
  { id: 'claim_cashflow',     label: 'Cashflow & Waterfall',    icon: '💰' },
  { id: 'claim_risk',         label: 'Risk Analytics',          icon: '⚠️' },
  { id: 'claim_sensitivity',  label: 'Sensitivity & Breakeven', icon: '📈' },
  { id: 'claim_export',       label: 'Export & Reports',        icon: '📤' },
];

const STRUCTURE_TABS = {
  litigation_funding: [
    { id: 'waterfall_analysis', label: 'Waterfall Analysis', icon: '🏗️' },
  ],
  monetisation_full_purchase: [
    { id: 'purchase_sensitivity', label: 'Purchase Sensitivity', icon: '💹' },
  ],
  monetisation_upfront_tail: [
    { id: 'investment_analysis', label: 'Investment Analysis', icon: '📊' },
    { id: 'pricing_grid',       label: 'Pricing Grid',        icon: '📐' },
    { id: 'pricing_surface',    label: 'Pricing Surface',     icon: '🌊' },
    { id: 'per_claim_analysis', label: 'Per-Claim Analysis',  icon: '🔍' },
    { id: 'legal_costs',        label: 'Legal Costs',         icon: '⚖️' },
    { id: 'report_charts',      label: 'Report Charts',       icon: '📑' },
    { id: 'prob_sensitivity',   label: 'Prob. Sensitivity',   icon: '📈' },
  ],
  monetisation_staged: [
    { id: 'milestone', label: 'Milestone Analysis', icon: '🏁' },
  ],
  comparative: [
    { id: 'comparative', label: 'Comparative View', icon: '🔄' },
  ],
};

function getTabsForStructure(structureType, claimMode, data) {
  if (claimMode) return SINGLE_CLAIM_TABS;
  const extra = STRUCTURE_TABS[structureType] || [];
  // Insert structure-specific tabs before the last two universal tabs (Risk, Export)
  const universal = [...UNIVERSAL_TABS];
  const insertIdx = universal.length - 2;
  universal.splice(insertIdx, 0, ...extra);
  // Conditionally add Settlement tab when enabled
  if (data?.settlement?.enabled === true) {
    const riskIdx = universal.findIndex(t => t.id === 'risk');
    universal.splice(riskIdx, 0, { id: 'settlement', label: 'Settlement Analysis', icon: '🤝' });
  }
  return universal;
}

/* ── Structure label ── */
const STRUCTURE_LABELS = {
  litigation_funding: 'Litigation Funding',
  monetisation_full_purchase: 'Full Purchase Monetisation',
  monetisation_upfront_tail: 'Upfront + Tail Monetisation',
  monetisation_staged: 'Staged Monetisation',
  comparative: 'Comparative Analysis',
};

export default function App() {
  const { data, stochasticData, pricingSurfaceData, loading, error, structureType, claimMode, retry } = useDashboardData();
  const { ui, settings, setTextScale, reset } = useUISettings();
  const [activeTab, setActiveTab] = useState('executive');

  if (loading) return <LoadingScreen />;
  if (error)   return <ErrorScreen message={error} onRetry={retry} />;

  const tabs = getTabsForStructure(structureType, claimMode, data);
  const meta = data?.simulation_meta || {};

  // Ensure active tab is valid for current structure
  const defaultTab = claimMode ? 'claim_executive' : 'executive';
  if (!tabs.find(t => t.id === activeTab)) {
    setActiveTab(defaultTab);
  }

  const renderTab = () => {
    switch (activeTab) {
      /* ── Universal tabs ── */
      case 'executive':
        return <ExecutiveSummary data={data} structureType={structureType} />;
      case 'per_claim':
        return <PerClaimContribution data={data} structureType={structureType} />;
      case 'probability':
        return <V2ProbabilityOutcomes data={data} stochasticData={stochasticData} />;
      case 'quantum':
        return <V2QuantumTimeline data={data} />;
      case 'cashflow':
        return <V2CashflowWaterfall data={data} />;
      case 'settlement':
        return <V2SettlementAnalysis data={data} />;
      case 'risk':
        return <RiskAnalytics data={data} />;
      case 'export':
        return <ExportPanel data={data} />;

      /* ── Litigation Funding tabs ── */
      case 'waterfall_analysis':
        return <LitFundingWaterfall data={data} />;

      /* ── Full Purchase tabs ── */
      case 'purchase_sensitivity':
        return <PurchaseSensitivity data={data} />;

      /* ── Upfront + Tail tabs (V2 components) ── */
      case 'investment_analysis':
        return <V2InvestmentAnalysis data={data} />;
      case 'pricing_grid':
        return <V2PricingView stochasticData={stochasticData} />;
      case 'pricing_surface':
        return <V2PricingSurface data={data} />;
      case 'per_claim_analysis':
        return <V2PerClaimAnalysis data={data} />;
      case 'legal_costs':
        return <V2LegalCosts data={data} />;
      case 'report_charts':
        return <V2ReportView stochasticData={stochasticData} />;
      case 'prob_sensitivity':
        return <V2ProbabilitySensitivity data={data} />;

      /* ── Single-Claim tabs ── */
      case 'claim_executive':
        return <ClaimExecutiveSummary data={data} stochasticData={stochasticData} />;
      case 'claim_probability':
        return <ClaimProbabilityOutcomes data={data} stochasticData={stochasticData} />;
      case 'claim_quantum':
        return <ClaimQuantumTimeline data={data} />;
      case 'claim_investment':
        return <ClaimInvestmentAnalysis data={data} />;
      case 'claim_cashflow':
        return <ClaimCashflow data={data} />;
      case 'claim_risk':
        return <ClaimRiskAnalytics data={data} />;
      case 'claim_sensitivity':
        return <ClaimSensitivityBreakeven data={data} />;
      case 'claim_export':
        return <ClaimExport data={data} />;

      /* ── Staged tabs ── */
      case 'milestone':
        return <MilestoneAnalysis data={data} />;

      /* ── Comparative tabs ── */
      case 'comparative':
        return <ComparativeView data={data} />;

      default:
        return null;
    }
  };

  return (
    <div style={{
      minHeight: '100vh',
      background: COLORS.bg,
      fontFamily: FONT,
      color: COLORS.text,
    }}>
      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      {/* Header */}
      <header style={{
        padding: `${ui.space.lg}px ${ui.space.xxl}px 0`,
        borderBottom: `1px solid ${COLORS.cardBorder}`,
        background: 'linear-gradient(180deg, #111827 0%, #0B0E17 100%)',
      }}>
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 16,
        }}>
          <div>
            <h1 style={{
              margin: 0,
              fontSize: ui.sizes.xxl,
              fontWeight: 800,
              letterSpacing: '-0.02em',
              background: `linear-gradient(135deg, ${COLORS.accent1}, ${COLORS.accent2})`,
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}>
              Claim Analytics Dashboard
            </h1>
            <p style={{
              margin: '4px 0 0',
              fontSize: ui.sizes.md,
              color: COLORS.textMuted,
            }}>
              {claimMode
                ? `Single Claim Analysis${data?.claims?.[0] ? ` — ${getClaimDisplayName(data.claims[0])}` : ''}`
                : `${STRUCTURE_LABELS[structureType] || structureType} — ${meta.n_claims || '?'} claims`}
              {' — '}
              {(meta.n_paths || 0).toLocaleString()} MC paths
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{
              fontSize: ui.sizes.sm,
              color: COLORS.accent2,
              background: `${COLORS.accent2}15`,
              padding: '4px 12px',
              borderRadius: 6,
              fontWeight: 600,
            }}>
              {claimMode ? 'Single Claim' : (STRUCTURE_LABELS[structureType] || structureType)}
            </span>
            <span style={{
              fontSize: ui.sizes.xs,
              color: COLORS.textMuted,
              background: '#1F293780',
              padding: '4px 10px',
              borderRadius: 4,
            }}>
              Generated: {meta.generated_at || 'N/A'}
            </span>
          </div>
        </div>

        {/* Text scale controls */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: ui.space.md,
          marginBottom: ui.space.md,
          flexWrap: 'wrap',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: ui.space.sm }}>
            <span style={{ color: COLORS.textMuted, fontSize: ui.sizes.sm, fontWeight: 600 }}>Text Scale</span>
            {UI_TEXT_SCALE_OPTIONS.map((option) => (
              <button
                key={option}
                onClick={() => setTextScale(option)}
                style={{
                  padding: '6px 10px',
                  borderRadius: 6,
                  border: 'none',
                  cursor: 'pointer',
                  fontFamily: FONT,
                  fontSize: ui.sizes.sm,
                  fontWeight: settings.textScale === option ? 700 : 500,
                  color: settings.textScale === option ? '#fff' : COLORS.textMuted,
                  background: settings.textScale === option ? COLORS.gradient1 : COLORS.card,
                }}
              >
                {Math.round(option * 100)}%
              </button>
            ))}
          </div>
          <button
            onClick={reset}
            style={{
              padding: '6px 10px',
              borderRadius: 6,
              border: `1px solid ${COLORS.cardBorder}`,
              cursor: 'pointer',
              background: 'transparent',
              color: COLORS.textMuted,
              fontFamily: FONT,
              fontSize: ui.sizes.sm,
              fontWeight: 600,
            }}
          >
            Reset
          </button>
        </div>

        {/* Tab navigation */}
        <TabBar tabs={tabs} active={activeTab} onChange={setActiveTab} />
      </header>

      {/* Main content */}
      <main style={{
        padding: `${ui.space.xl}px ${ui.space.xxl}px`,
        maxWidth: 1440,
        margin: '0 auto',
      }}>
        <div key={activeTab} style={{ animation: 'fadeIn 0.3s ease' }}>
          <ErrorBoundary key={activeTab} label={tabs.find(t => t.id === activeTab)?.label}>
            {renderTab()}
          </ErrorBoundary>
        </div>
      </main>

      {/* Footer */}
      <footer style={{
        padding: `${ui.space.lg}px ${ui.space.xxl}px`,
        borderTop: `1px solid ${COLORS.cardBorder}`,
        textAlign: 'center',
      }}>
        <p style={{
          margin: 0,
          fontSize: ui.sizes.xs,
          color: '#6B7280',
        }}>
          CONFIDENTIAL — 5 Rivers Capital | Claim Analytics Platform | For internal analysis only
        </p>
      </footer>
    </div>
  );
}
