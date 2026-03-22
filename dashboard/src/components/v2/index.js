/**
 * v2/index.js — Barrel export for all V2 dashboard components.
 * Simplifies imports in App.jsx.
 */

export { default as V2ProbabilityOutcomes } from './ProbabilityOutcomes';
export { default as V2QuantumTimeline } from './QuantumTimeline';
export { default as V2CashflowWaterfall } from './CashflowWaterfall';
export { default as V2InvestmentAnalysis } from './InvestmentAnalysis';
export { default as V2PricingSurface } from './PricingSurface';
export { default as V2PerClaimAnalysis } from './PerClaimAnalysis';
export { default as V2LegalCosts } from './LegalCosts';
export { default as V2ProbabilitySensitivity } from './ProbabilitySensitivity';
export { default as V2StochasticPricing } from './StochasticPricing';
export { default as V2ReportCharts } from './ReportCharts';
export { PricingView as V2PricingView, ReportView as V2ReportView } from './ScenariosAndPricing';
