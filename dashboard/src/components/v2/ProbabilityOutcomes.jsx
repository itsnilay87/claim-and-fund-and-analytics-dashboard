/**
 * ProbabilityOutcomes.jsx — Tab 2: Comprehensive Probability Analysis.
 *
 * A world-class probability dashboard combining:
 *   § 0  Foundational Probability KPIs (3 rows)
 *   § 1  Probability Mechanics Explainer — how conditional ↔ absolute probs work
 *   § 2  Interactive D3 Decision Tree (jurisdiction × scenario)
 *   § 3  Path Probability Waterfall — visual flow from root to terminal
 *   § 4  Derived Probability Matrix — Bayesian reverse conditionals, marginals
 *   § 5  Per-Claim Probability Breakdown — MC-based outcome profiles
 *   § 6  Terminal Outcome Summary Table (enhanced)
 *   § 7  Domestic vs SIAC Comparison
 *   § 8  Probability Sensitivity Analysis (integrated from ProbabilitySensitivity)
 *   § 9  Quantum Band Distribution — hidden data surfaced
 *   § 10 Outcome Legend
 *
 * Designed for finance professionals, quants, and lawyers.
 */

import React, { useState, useMemo } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, Cell,
  PieChart, Pie,
} from 'recharts';
import { COLORS, FONT, SIZES, SPACE, CHART_COLORS, useUISettings, fmtPct, fmtMOIC, fmtCr, BAR_CURSOR } from '../theme';
import { Card, SectionTitle, KPI, CustomTooltip } from './Shared';
import D3ProbabilityTree from './D3ProbabilityTree';
import ProbabilitySensitivity from './ProbabilitySensitivity';

/* ═══════════════════════════════════════════════════════════
 * Constants & Palettes
 * ═══════════════════════════════════════════════════════════ */

const OUTCOME_COLORS = { TRUE_WIN: '#10B981', RESTART: '#F59E0B', LOSE: '#EF4444' };
const OUTCOME_ICONS  = { TRUE_WIN: '✓', RESTART: '⟳', LOSE: '✗' };
const OUTCOME_LABELS = { TRUE_WIN: 'Win', RESTART: 'Restart', LOSE: 'Lose' };

const PROB_BLUE   = '#3B82F6';
const PROB_VIOLET = '#8B5CF6';
const PROB_TEAL   = '#14B8A6';
const PROB_AMBER  = '#F59E0B';
const PROB_ROSE   = '#F43F5E';

/* Quantum band labels and colors */
const QUANTUM_BANDS = [
  { label: '< 50% of SOC',      range: [0, 0.50], color: '#EF4444' },
  { label: '50 – 65% of SOC',   range: [0.50, 0.65], color: '#F59E0B' },
  { label: '65 – 80% of SOC',   range: [0.65, 0.80], color: '#FBBF24' },
  { label: '80 – 95% of SOC',   range: [0.80, 0.95], color: '#34D399' },
  { label: '95 – 100% of SOC',  range: [0.95, 1.00], color: '#10B981' },
];

/* ═══════════════════════════════════════════════════════════
 * Helper functions
 * ═══════════════════════════════════════════════════════════ */

/** Safe percentage formatter that handles nulls */
const safePct = (v) => v != null ? ((v * 100).toFixed(2) + '%') : '—';

/** Collect all terminal paths with depth info */
function collectPaths(node, depth = 0, chain = [], results = []) {
  if (!node) return results;
  const step = { label: node.label?.replace('\n', ' '), prob: node.prob, depth };
  const currentChain = [...chain, step];
  if (!node.children || node.children.length === 0) {
    results.push({ chain: currentChain, outcome: node.outcome, abs_prob: node.abs_prob });
  } else {
    for (const child of node.children) {
      collectPaths(child, depth + 1, currentChain, results);
    }
  }
  return results;
}

/** Inline math-style span */
const MathSpan = ({ children, color = COLORS.accent2 }) => (
  <span style={{
    fontFamily: "'Cambria Math', 'Georgia', serif",
    fontStyle: 'italic', color, fontWeight: 600,
  }}>{children}</span>
);

/** Small styled tag */
const Tag = ({ text, color, bg }) => (
  <span style={{
    display: 'inline-block', padding: '3px 10px', borderRadius: 6,
    background: bg || `${color}20`, color: color, fontSize: 12, fontWeight: 700,
    fontFamily: FONT,
  }}>{text}</span>
);

/* ═══════════════════════════════════════════════════════════
 * Flow-box style (used by § 1 diagram)
 * ═══════════════════════════════════════════════════════════ */
const flowBox = {
  padding: '10px 16px', borderRadius: 10,
  background: '#0F1219', border: '2px solid',
  textAlign: 'center', minWidth: 90,
};

/* ═══════════════════════════════════════════════════════════
 * Main Component
 * ═══════════════════════════════════════════════════════════ */

export default function ProbabilityOutcomes({ data, stochasticData, claimJurisdiction = null }) {
  const { ui } = useUISettings();
  const prob = data?.probability_summary;
  const sensitivity = data?.probability_sensitivity;
  const claims = data?.claims || [];
  const simMeta = data?.simulation_meta || {};
  const treeNodes = prob?.tree_nodes;

  // ── Party names (from backend, fallback to generic labels) ──
  const partyNames = data?.party_names || {};
  const claimantName = partyNames.claimant || 'Claimant';
  const respondentName = partyNames.respondent || 'Respondent';
  const perspective = data?.perspective || 'claimant';

  // When claimJurisdiction is provided (single claim view), lock to that jurisdiction
  const [jurisdiction, setJurisdiction] = useState(
    claimJurisdiction || (prob?.domestic?.aggregate ? 'domestic' : 'siac')
  );
  const isLockedJurisdiction = !!claimJurisdiction;
  const [scenario, setScenario]         = useState('scenario_a');

  /* ── Safe aggregates with null guards for single-portfolio modes ── */
  const domAgg   = prob?.domestic?.aggregate  || { true_win: 0, restart: 0, lose: 0 };
  const siacAgg  = prob?.siac?.aggregate      || { true_win: 0, restart: 0, lose: 0 };
  const arbWin   = prob?.arb_win_probability  || 0;
  const reArbWin = prob?.re_arb_win_probability || 0;
  const baseProbabilities = sensitivity?.base_probabilities || {};

  /* ── Derived Bayesian Probabilities ── */
  const derivedProbs = useMemo(() => {
    const pA = arbWin;       // P(Arb Won)
    const pB = 1 - pA;      // P(Arb Lost)

    const computeForJurisdiction = (jurKey) => {
      const scenA = prob?.[jurKey]?.scenario_a || [];
      const scenB = prob?.[jurKey]?.scenario_b || [];
      const agg   = jurKey === 'domestic' ? domAgg : siacAgg;

      // Conditional probs: P(outcome | arb won) summed from scenario_a paths
      const pWinGivenA  = scenA.filter(p => p.outcome === 'TRUE_WIN').reduce((s, p) => s + (p.conditional_prob || 0), 0);
      const pLoseGivenA = scenA.filter(p => p.outcome === 'LOSE').reduce((s, p) => s + (p.conditional_prob || 0), 0);
      const pRestGivenA = scenA.filter(p => p.outcome === 'RESTART').reduce((s, p) => s + (p.conditional_prob || 0), 0);

      // P(outcome | arb lost) from scenario_b
      const pWinGivenB  = scenB.filter(p => p.outcome === 'TRUE_WIN').reduce((s, p) => s + (p.conditional_prob || 0), 0);
      const pLoseGivenB = scenB.filter(p => p.outcome === 'LOSE').reduce((s, p) => s + (p.conditional_prob || 0), 0);
      const pRestGivenB = scenB.filter(p => p.outcome === 'RESTART').reduce((s, p) => s + (p.conditional_prob || 0), 0);

      // Absolute probs
      const pWin  = agg.true_win;
      const pLose = agg.lose;
      const pRest = agg.restart;

      // Bayes' theorem: P(Arb Won | Win) = P(Win|ArbWon) * P(ArbWon) / P(Win)
      const pAGivenWin  = pWin > 0  ? (pWinGivenA * pA) / pWin   : 0;
      const pBGivenLose = pLose > 0 ? (pLoseGivenB * pB) / pLose : 0;

      // First-path-only: P(Win with no appeal) — the most direct win path
      const firstWinPath = scenA.find(p => p.outcome === 'TRUE_WIN');
      const pWinNoAppeal = firstWinPath ? firstWinPath.absolute_prob : 0;

      // Expected number of court stages to win (weighted avg of path depths for winning paths)
      const winPaths = [...scenA, ...scenB].filter(p => p.outcome === 'TRUE_WIN');
      const totalWinProb = winPaths.reduce((s, p) => s + (p.absolute_prob || 0), 0);
      const avgStepsToWin = totalWinProb > 0
        ? winPaths.reduce((s, p) => s + ((p.description?.split('→').length || 1) * (p.absolute_prob || 0)), 0) / totalWinProb
        : 0;

      return {
        pWinGivenA, pLoseGivenA, pRestGivenA,
        pWinGivenB, pLoseGivenB, pRestGivenB,
        pWin, pLose, pRest,
        pAGivenWin, pBGivenLose,
        pWinNoAppeal, avgStepsToWin,
        nPathsA: scenA.length, nPathsB: scenB.length,
      };
    };

    return {
      domestic: computeForJurisdiction('domestic'),
      siac:     computeForJurisdiction('siac'),
    };
  }, [prob, arbWin, domAgg, siacAgg]);

  /* ── Current tree & flat path list ── */
  const currentTree = treeNodes?.[jurisdiction]?.[scenario];
  const paths = prob?.[jurisdiction]?.[scenario] || [];
  const hasDomestic = !!(prob?.domestic?.aggregate);
  const hasSiac     = !!(prob?.siac?.aggregate);

  /* ── Outline the path chains for visual waterfall ── */
  const pathChains = useMemo(() => {
    if (!currentTree) return [];
    return collectPaths(currentTree).sort((a, b) => (b.abs_prob || 0) - (a.abs_prob || 0));
  }, [currentTree]);

  /* ── Viewport-relative tree height ── */
  const treeHeight = typeof window !== 'undefined'
    ? Math.max(440, Math.round(window.innerHeight * 0.55))
    : 520;

  /* ── Domestic vs SIAC outcome comparison ── */
  const combinedOutcome = [
    { name: 'Win',     domestic: domAgg.true_win, siac: siacAgg.true_win },
    { name: 'Restart', domestic: domAgg.restart,  siac: siacAgg.restart  },
    { name: 'Lose',    domestic: domAgg.lose,     siac: siacAgg.lose     },
  ];

  /* ── Quantum band data ── */
  const quantumBands = baseProbabilities.quantum_band_probs || [];

  /* ── Styles ── */
  const thStyle = {
    padding: '10px 14px', color: COLORS.textMuted, fontSize: ui.sizes.sm,
    fontWeight: 700, textAlign: 'center', textTransform: 'uppercase',
    letterSpacing: '0.05em', borderBottom: `2px solid ${COLORS.cardBorder}`,
  };
  const tdStyle = {
    padding: '8px 14px', textAlign: 'center', fontSize: ui.sizes.sm,
    color: COLORS.text, borderBottom: `1px solid ${COLORS.cardBorder}20`,
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: ui.space.xl }}>

      {/* ── Perspective Banner ── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '10px 18px', borderRadius: 10,
        background: perspective === 'claimant' ? `${PROB_BLUE}15` : `${PROB_VIOLET}15`,
        border: `1px solid ${perspective === 'claimant' ? PROB_BLUE : PROB_VIOLET}40`,
      }}>
        <span style={{ fontSize: 18 }}>{perspective === 'claimant' ? '⚖️' : '🛡️'}</span>
        <span style={{ fontSize: ui.sizes.sm, color: COLORS.text, fontWeight: 600 }}>
          Viewing from <span style={{ color: perspective === 'claimant' ? PROB_BLUE : PROB_VIOLET }}>
            {perspective === 'claimant' ? claimantName : respondentName}
          </span> ({perspective}) perspective
        </span>
        <span style={{ fontSize: ui.sizes.xs, color: COLORS.textMuted, marginLeft: 'auto' }}>
          "Win" = {claimantName} prevails &nbsp;|&nbsp; "Lose" = {respondentName} prevails
        </span>
      </div>

      {/* ═══════════════════════════════════════════════════════
       *  § 0  FOUNDATIONAL PROBABILITY KPIs
       * ═══════════════════════════════════════════════════════ */}

      {/* Row 1 — Input Parameters */}
      <div>
        <div style={{
          fontSize: ui.sizes.xs, color: COLORS.textMuted, textTransform: 'uppercase',
          letterSpacing: '0.08em', fontWeight: 700, marginBottom: ui.space.sm, paddingLeft: 4,
        }}>Input Probability Parameters</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: ui.space.md }}>
          <KPI label="P(Arb Win)" value={safePct(arbWin)}
            sub="Base arbitration success rate" color={PROB_BLUE} />
          <KPI label="P(Re-Arb Win)" value={safePct(reArbWin)}
            sub="After restart, re-arbitration" color={PROB_VIOLET} />
          <KPI label="E[Q|Win]" value={safePct(baseProbabilities.e_q_win_pct)}
            sub="Expected quantum as % of SOC" color={PROB_TEAL} />
          <KPI label="Monte Carlo Paths" value={(simMeta.n_paths || 10000).toLocaleString()}
            sub={`Seed ${simMeta.seed || 42}`} color={COLORS.textMuted} />
        </div>
      </div>

      {/* Row 2 — Domestic Aggregate */}
      {hasDomestic && (
        <div>
          <div style={{
            fontSize: ui.sizes.xs, color: COLORS.textMuted, textTransform: 'uppercase',
            letterSpacing: '0.08em', fontWeight: 700, marginBottom: ui.space.sm, paddingLeft: 4,
          }}>Aggregate Outcomes — Domestic (S.34 → SLP pipeline)</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: ui.space.md }}>
            <KPI label="P(Win)" value={safePct(domAgg.true_win)}
              sub="Weighted across both arb scenarios" color={OUTCOME_COLORS.TRUE_WIN} />
            <KPI label="P(Restart)" value={safePct(domAgg.restart)}
              sub="Case restarts from re-arbitration" color={OUTCOME_COLORS.RESTART} />
            <KPI label="P(Lose)" value={safePct(domAgg.lose)}
              sub="Fund loses — total write-off" color={OUTCOME_COLORS.LOSE} />
          </div>
        </div>
      )}

      {/* Row 3 — SIAC Aggregate */}
      {hasSiac && (
        <div>
          <div style={{
            fontSize: ui.sizes.xs, color: COLORS.textMuted, textTransform: 'uppercase',
            letterSpacing: '0.08em', fontWeight: 700, marginBottom: ui.space.sm, paddingLeft: 4,
          }}>Aggregate Outcomes — SIAC (HC → COA pipeline)</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: ui.space.md }}>
            <KPI label="P(Win)" value={safePct(siacAgg.true_win)}
              sub="Weighted across both arb scenarios" color={OUTCOME_COLORS.TRUE_WIN} />
            <KPI label="P(Restart)" value={safePct(siacAgg.restart)}
              sub="Case restarts from re-arbitration" color={OUTCOME_COLORS.RESTART} />
            <KPI label="P(Lose)" value={safePct(siacAgg.lose)}
              sub="Fund loses — total write-off" color={OUTCOME_COLORS.LOSE} />
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════
       *  § 1  INTERACTIVE D3 DECISION TREE
       * ═══════════════════════════════════════════════════════ */}

      {/* Jurisdiction + Scenario toggles */}
      <div style={{ display: 'flex', gap: ui.space.lg, flexWrap: 'wrap' }}>
        {/* jurisdiction - hidden when locked to single claim's jurisdiction */}
        {!isLockedJurisdiction && (
          <div style={{ display: 'flex', gap: ui.space.sm }}>
            <span style={{ color: COLORS.textMuted, fontSize: ui.sizes.sm, fontWeight: 600, lineHeight: '36px' }}>
              Jurisdiction:
            </span>
            {[
              { key: 'domestic', label: 'Domestic (S.34→SLP)', show: hasDomestic },
              { key: 'siac',     label: 'SIAC (HC→COA)',       show: hasSiac },
            ].filter(j => j.show).map(j => (
              <button key={j.key} onClick={() => setJurisdiction(j.key)} style={{
                padding: '8px 16px', borderRadius: 8, border: 'none', cursor: 'pointer',
                fontFamily: FONT, fontSize: ui.sizes.sm,
                fontWeight: jurisdiction === j.key ? 700 : 500,
                color: jurisdiction === j.key ? '#fff' : COLORS.textMuted,
                background: jurisdiction === j.key ? COLORS.gradient1 : COLORS.card,
              }}>
                {j.label}
              </button>
            ))}
          </div>
        )}

        {/* scenario */}
        <div style={{ display: 'flex', gap: ui.space.sm }}>
          <span style={{ color: COLORS.textMuted, fontSize: ui.sizes.sm, fontWeight: 600, lineHeight: '36px' }}>
            Scenario:
          </span>
          {[
            { key: 'scenario_a', label: `A: ${claimantName} Wins Arb` },
            { key: 'scenario_b', label: `B: ${claimantName} Loses Arb` },
          ].map(s => (
            <button key={s.key} onClick={() => setScenario(s.key)} style={{
              padding: '8px 16px', borderRadius: 8, border: 'none', cursor: 'pointer',
              fontFamily: FONT, fontSize: ui.sizes.sm,
              fontWeight: scenario === s.key ? 700 : 500,
              color: scenario === s.key ? '#fff' : COLORS.textMuted,
              background: scenario === s.key
                ? (s.key === 'scenario_a' ? OUTCOME_COLORS.TRUE_WIN + 'CC' : OUTCOME_COLORS.LOSE + 'CC')
                : COLORS.card,
            }}>
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <Card>
        <SectionTitle
          number="§1"
          title={`${jurisdiction === 'domestic' ? 'Domestic' : 'SIAC'} Decision Tree — Scenario ${scenario === 'scenario_a' ? 'A' : 'B'}`}
          subtitle={jurisdiction === 'domestic'
            ? 'Arbitration → S.34 Appeal → S.37 Appeal → SLP Gate → SLP Merits'
            : 'Arbitration → High Court → Court of Appeal'}
        />
        {currentTree ? (
          <D3ProbabilityTree
            treeData={currentTree}
            jurisdiction={jurisdiction}
            scenario={scenario}
            height={treeHeight}
          />
        ) : (
          <div style={{ padding: 40, textAlign: 'center', color: COLORS.textMuted }}>
            No tree data for {jurisdiction} / {scenario}.
          </div>
        )}
      </Card>

      {/* ═══════════════════════════════════════════════════════
       *  § 2  PROBABILITY MECHANICS EXPLAINER
       * ═══════════════════════════════════════════════════════ */}
      <Card>
        <SectionTitle number="§2" title="How Probabilities Are Derived"
          subtitle="From input parameters to portfolio outcomes — the mathematical framework" />

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: ui.space.xl }}>
          {/* Left: Explanation */}
          <div style={{ lineHeight: 1.8, fontSize: ui.sizes.sm, color: COLORS.text }}>
            <div style={{ fontWeight: 700, color: COLORS.textBright, marginBottom: 8, fontSize: ui.sizes.base }}>
              Total Probability Formula
            </div>
            <div style={{
              background: '#111827', border: `1px solid ${COLORS.cardBorder}`, borderRadius: 10,
              padding: '16px 20px', fontFamily: "'Cambria Math', Georgia, serif",
              fontSize: 15, lineHeight: 2, color: COLORS.textBright, marginBottom: 16,
            }}>
              <div>
                <MathSpan color={OUTCOME_COLORS.TRUE_WIN}>P(Win)</MathSpan>{' = '}
                <MathSpan color={PROB_BLUE}>P(Arb Won)</MathSpan>{' × '}
                <MathSpan>P(Win | Arb Won)</MathSpan>{' + '}
                <MathSpan color={PROB_ROSE}>P(Arb Lost)</MathSpan>{' × '}
                <MathSpan>P(Win | Arb Lost)</MathSpan>
              </div>
              <div style={{ fontSize: 13, color: COLORS.textMuted, marginTop: 4 }}>
                = {safePct(arbWin)} × {safePct(derivedProbs.domestic.pWinGivenA)} + {safePct(1 - arbWin)} × {safePct(derivedProbs.domestic.pWinGivenB)} = <span style={{ color: OUTCOME_COLORS.TRUE_WIN, fontWeight: 700 }}>{safePct(domAgg.true_win)}</span> (Domestic)
              </div>
            </div>

            <div style={{ fontWeight: 700, color: COLORS.textBright, marginBottom: 8, fontSize: ui.sizes.base }}>
              Bayes' Theorem — Reverse Inference
            </div>
            <div style={{
              background: '#111827', border: `1px solid ${COLORS.cardBorder}`, borderRadius: 10,
              padding: '16px 20px', fontFamily: "'Cambria Math', Georgia, serif",
              fontSize: 15, lineHeight: 2, color: COLORS.textBright,
            }}>
              <div>
                <MathSpan color={PROB_VIOLET}>P(Arb Won | Win)</MathSpan>{' = '}
                <span style={{ fontSize: 14 }}>
                  [<MathSpan>P(Win | Arb Won)</MathSpan>{' × '}<MathSpan color={PROB_BLUE}>P(Arb Won)</MathSpan>]
                  {' / '}<MathSpan color={OUTCOME_COLORS.TRUE_WIN}>P(Win)</MathSpan>
                </span>
              </div>
              <div style={{ fontSize: 13, color: COLORS.textMuted, marginTop: 4 }}>
                = [{safePct(derivedProbs.domestic.pWinGivenA)} × {safePct(arbWin)}] / {safePct(domAgg.true_win)} = <span style={{ color: PROB_VIOLET, fontWeight: 700 }}>{safePct(derivedProbs.domestic.pAGivenWin)}</span> (Domestic)
              </div>
            </div>
          </div>

          {/* Right: Visual probability flow */}
          <div>
            <div style={{ fontWeight: 700, color: COLORS.textBright, marginBottom: 12, fontSize: ui.sizes.base }}>
              Probability Flow Diagram
            </div>
            {/* Mini flow: Arb → Court → Outcome */}
            <div style={{
              display: 'flex', flexDirection: 'column', gap: 10,
              background: '#111827', border: `1px solid ${COLORS.cardBorder}`,
              borderRadius: 10, padding: 20,
            }}>
              {/* Arb level */}
              <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
                <div style={{ ...flowBox, borderColor: PROB_BLUE }}>
                  <div style={{ fontSize: 11, color: COLORS.textMuted }}>Arb Won</div>
                  <div style={{ fontSize: 18, fontWeight: 800, color: PROB_BLUE }}>{safePct(arbWin)}</div>
                </div>
                <div style={{ ...flowBox, borderColor: PROB_ROSE }}>
                  <div style={{ fontSize: 11, color: COLORS.textMuted }}>Arb Lost</div>
                  <div style={{ fontSize: 18, fontWeight: 800, color: PROB_ROSE }}>{safePct(1 - arbWin)}</div>
                </div>
              </div>
              <div style={{ textAlign: 'center', color: COLORS.textMuted, fontSize: 20 }}>↓</div>
              {/* Court pipeline */}
              <div style={{ textAlign: 'center', color: COLORS.textMuted, fontSize: 12, fontWeight: 600 }}>
                Court Challenge Pipeline (S.34 → S.37 → SLP or HC → COA)
              </div>
              <div style={{ textAlign: 'center', color: COLORS.textMuted, fontSize: 20 }}>↓</div>
              {/* Terminal outcomes */}
              <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
                {[
                  { key: 'TRUE_WIN', label: 'Win', valueDom: domAgg.true_win, valueSiac: siacAgg.true_win },
                  { key: 'RESTART', label: 'Restart', valueDom: domAgg.restart, valueSiac: siacAgg.restart },
                  { key: 'LOSE', label: 'Lose', valueDom: domAgg.lose, valueSiac: siacAgg.lose },
                ].map(o => (
                  <div key={o.key} style={{ ...flowBox, borderColor: OUTCOME_COLORS[o.key], minWidth: 110 }}>
                    <div style={{ fontSize: 11, color: COLORS.textMuted }}>{o.label}</div>
                    {(!isLockedJurisdiction ? hasDomestic : jurisdiction === 'domestic') && 
                      <div style={{ fontSize: 14, fontWeight: 700, color: OUTCOME_COLORS[o.key] }}>Dom: {safePct(o.valueDom)}</div>}
                    {(!isLockedJurisdiction ? hasSiac : jurisdiction === 'siac') && 
                      <div style={{ fontSize: 14, fontWeight: 700, color: OUTCOME_COLORS[o.key] }}>SIAC: {safePct(o.valueSiac)}</div>}
                  </div>
                ))}
              </div>
            </div>

            {/* Key insight box */}
            <div style={{
              marginTop: 12, padding: '12px 16px', borderRadius: 8,
              background: `${OUTCOME_COLORS.TRUE_WIN}10`, border: `1px solid ${OUTCOME_COLORS.TRUE_WIN}30`,
              fontSize: ui.sizes.sm, color: COLORS.text, lineHeight: 1.6,
            }}>
              <span style={{ fontWeight: 700, color: OUTCOME_COLORS.TRUE_WIN }}>Key Insight:</span>{' '}
              {hasDomestic && hasSiac && !isLockedJurisdiction ? (
                <>SIAC claims have a <strong style={{ color: OUTCOME_COLORS.TRUE_WIN }}>
                  {((siacAgg.true_win - domAgg.true_win) * 100).toFixed(1)}pp
                </strong> higher win probability than Domestic claims — a shorter appeal pipeline (2 stages vs 4) means fewer chances for the opponent to overturn the award.</>
              ) : (
                <>The aggregate probabilities are weighted across both arbitration scenarios: winning the initial arbitration (P = {safePct(arbWin)}) and losing it (P = {safePct(1 - arbWin)}).</>
              )}
            </div>
          </div>
        </div>
      </Card>

      {/* ═══════════════════════════════════════════════════════
       *  § 3  PATH PROBABILITY WATERFALL
       * ═══════════════════════════════════════════════════════ */}
      {pathChains.length > 0 && (
        <Card>
          <SectionTitle number="§3" title="Path Probability Waterfall"
            subtitle={`How conditional probabilities compound at each court stage — ${jurisdiction === 'domestic' ? 'Domestic' : 'SIAC'} Scenario ${scenario === 'scenario_a' ? 'A' : 'B'}`} />

          <div style={{ overflowX: 'auto' }}>
            {pathChains.map((path, pi) => {
              const oc = OUTCOME_COLORS[path.outcome] || COLORS.textMuted;
              const absP = path.abs_prob || 0;
              const maxBarWidth = 400;

              return (
                <div key={pi} style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '8px 0', borderBottom: pi < pathChains.length - 1 ? `1px solid ${COLORS.cardBorder}15` : 'none',
                }}>
                  {/* Path label */}
                  <div style={{ minWidth: 50, textAlign: 'center', fontSize: 12, fontWeight: 700, color: oc }}>
                    {OUTCOME_ICONS[path.outcome]} {paths[pi]?.path_id || `P${pi + 1}`}
                  </div>

                  {/* Chain of conditional pills */}
                  <div style={{ display: 'flex', gap: 3, flexShrink: 0 }}>
                    {path.chain.slice(1).map((step, si) => (
                      <div key={si} style={{
                        padding: '3px 8px', borderRadius: 5, fontSize: 10, fontWeight: 600,
                        background: si === path.chain.length - 2 ? `${oc}25` : '#1F2937',
                        color: si === path.chain.length - 2 ? oc : COLORS.textMuted,
                        border: `1px solid ${si === path.chain.length - 2 ? oc + '50' : COLORS.cardBorder}`,
                        whiteSpace: 'nowrap',
                      }}>
                        {step.label?.split(' ').slice(0, 3).join(' ')} {step.prob != null ? `(${(step.prob * 100).toFixed(0)}%)` : ''}
                      </div>
                    ))}
                  </div>

                  {/* Probability bar */}
                  <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{
                      height: 14, borderRadius: 7, minWidth: 4,
                      width: `${Math.max(2, absP * maxBarWidth)}px`,
                      background: `linear-gradient(90deg, ${oc}, ${oc}60)`,
                      transition: 'width 0.5s ease',
                    }} />
                    <span style={{
                      fontSize: 13, fontWeight: 700, color: oc, whiteSpace: 'nowrap',
                    }}>{(absP * 100).toFixed(2)}%</span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Sanity check */}
          <div style={{
            marginTop: 12, padding: '8px 16px', borderRadius: 6,
            background: '#111827', fontSize: ui.sizes.xs, color: COLORS.textMuted,
            display: 'flex', justifyContent: 'space-between',
          }}>
            <span>
              Total paths: <strong style={{ color: COLORS.textBright }}>{pathChains.length}</strong>
            </span>
            <span>
              Σ P(path) = <strong style={{ color: Math.abs(pathChains.reduce((s, p) => s + (p.abs_prob || 0), 0) - (scenario === 'scenario_a' ? arbWin : 1 - arbWin)) < 0.01 ? OUTCOME_COLORS.TRUE_WIN : OUTCOME_COLORS.LOSE }}>
                {(pathChains.reduce((s, p) => s + (p.abs_prob || 0), 0) * 100).toFixed(2)}%
              </strong>
              {' '}(expected: {scenario === 'scenario_a' ? safePct(arbWin) : safePct(1 - arbWin)})
            </span>
          </div>
        </Card>
      )}

      {/* ═══════════════════════════════════════════════════════
       *  § 4  DERIVED PROBABILITY MATRIX
       * ═══════════════════════════════════════════════════════ */}
      <Card>
        <SectionTitle number="§4" title="Derived Probability Matrix"
          subtitle="Conditional, marginal, and Bayesian reverse probabilities computed from the decision tree" />

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 2, fontFamily: FONT }}>
            <thead>
              <tr>
                <th style={{ ...thStyle, textAlign: 'left', minWidth: 200 }}>Probability Metric</th>
                {hasDomestic && <th style={thStyle}>Domestic</th>}
                {hasSiac && <th style={thStyle}>SIAC</th>}
                <th style={{ ...thStyle, textAlign: 'left', minWidth: 280 }}>Formula / Derivation</th>
              </tr>
            </thead>
            <tbody>
              {[
                {
                  label: 'P(Win | Arb Won)',
                  dom: derivedProbs.domestic.pWinGivenA,
                  siac: derivedProbs.siac.pWinGivenA,
                  formula: 'Σ conditional_prob for TRUE_WIN paths in Scenario A',
                  color: OUTCOME_COLORS.TRUE_WIN,
                },
                {
                  label: 'P(Win | Arb Lost)',
                  dom: derivedProbs.domestic.pWinGivenB,
                  siac: derivedProbs.siac.pWinGivenB,
                  formula: 'Σ conditional_prob for TRUE_WIN paths in Scenario B',
                  color: OUTCOME_COLORS.TRUE_WIN,
                },
                {
                  label: 'P(Lose | Arb Won)',
                  dom: derivedProbs.domestic.pLoseGivenA,
                  siac: derivedProbs.siac.pLoseGivenA,
                  formula: '1 − P(Win|A) − P(Restart|A)',
                  color: OUTCOME_COLORS.LOSE,
                },
                {
                  label: 'P(Lose | Arb Lost)',
                  dom: derivedProbs.domestic.pLoseGivenB,
                  siac: derivedProbs.siac.pLoseGivenB,
                  formula: '1 − P(Win|B) − P(Restart|B)',
                  color: OUTCOME_COLORS.LOSE,
                },
                {
                  label: 'P(Restart | Arb Lost)',
                  dom: derivedProbs.domestic.pRestGivenB,
                  siac: derivedProbs.siac.pRestGivenB,
                  formula: 'Σ conditional_prob for RESTART paths in Scenario B',
                  color: OUTCOME_COLORS.RESTART,
                },
                { divider: true },
                {
                  label: 'P(Arb Won | Win) — Bayes',
                  dom: derivedProbs.domestic.pAGivenWin,
                  siac: derivedProbs.siac.pAGivenWin,
                  formula: '[P(Win|A) × P(A)] / P(Win)',
                  color: PROB_VIOLET,
                },
                {
                  label: 'P(Arb Lost | Lose) — Bayes',
                  dom: derivedProbs.domestic.pBGivenLose,
                  siac: derivedProbs.siac.pBGivenLose,
                  formula: '[P(Lose|B) × P(B)] / P(Lose)',
                  color: PROB_VIOLET,
                },
                { divider: true },
                {
                  label: 'P(Win, No Appeal)',
                  dom: derivedProbs.domestic.pWinNoAppeal,
                  siac: derivedProbs.siac.pWinNoAppeal,
                  formula: "Most direct win path — opponent's S.34 dismissed",
                  color: PROB_TEAL,
                },
                {
                  label: 'Avg Court Stages to Win',
                  dom: derivedProbs.domestic.avgStepsToWin,
                  siac: derivedProbs.siac.avgStepsToWin,
                  formula: 'Σ (stages × abs_prob) / Σ abs_prob for win paths',
                  color: PROB_AMBER,
                  isCount: true,
                },
                {
                  label: '# Paths (Scenario A + B)',
                  dom: derivedProbs.domestic.nPathsA + derivedProbs.domestic.nPathsB,
                  siac: derivedProbs.siac.nPathsA + derivedProbs.siac.nPathsB,
                  formula: 'Total terminal states in the decision tree',
                  color: COLORS.textMuted,
                  isCount: true,
                },
              ].map((row, i) => {
                if (row.divider) {
                  return (
                    <tr key={`div-${i}`}>
                      <td colSpan={4} style={{ padding: 0, height: 2, background: `${COLORS.cardBorder}30` }} />
                    </tr>
                  );
                }
                const fmtVal = (v) => row.isCount ? v?.toFixed(1) : safePct(v);
                return (
                  <tr key={i} style={{ background: i % 2 === 0 ? 'transparent' : '#ffffff03' }}>
                    <td style={{ ...tdStyle, textAlign: 'left', fontWeight: 700, color: row.color }}>
                      {row.label}
                    </td>
                    {hasDomestic && (
                      <td style={{ ...tdStyle, fontWeight: 700, fontSize: ui.sizes.base }}>
                        {fmtVal(row.dom)}
                      </td>
                    )}
                    {hasSiac && (
                      <td style={{ ...tdStyle, fontWeight: 700, fontSize: ui.sizes.base }}>
                        {fmtVal(row.siac)}
                      </td>
                    )}
                    <td style={{ ...tdStyle, textAlign: 'left', color: COLORS.textMuted, fontStyle: 'italic', fontSize: ui.sizes.xs }}>
                      {row.formula}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {/* ═══════════════════════════════════════════════════════
       *  § 5  PER-CLAIM PROBABILITY BREAKDOWN
       * ═══════════════════════════════════════════════════════ */}
      {claims.length > 0 && (
        <Card>
          <SectionTitle number="§5" title="Per-Claim Probability Profiles"
            subtitle="Monte Carlo outcome distribution for each claim — win rates, durations, and outcome proportions" />

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 2, fontFamily: FONT }}>
              <thead>
                <tr>
                  {['Claim', 'Jurisdiction', 'Win Rate', 'E[Duration]', 'Outcome Distribution', 'SOC (₹Cr)', 'Viable'].map(h => (
                    <th key={h} style={thStyle}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {claims.map((c, i) => {
                  const od = c.outcome_distribution || {};
                  const total = (od.TRUE_WIN || 0) + (od.RESTART || 0) + (od.LOSE || 0);
                  const pWin  = total > 0 ? od.TRUE_WIN / total : 0;
                  const pRest = total > 0 ? od.RESTART / total : 0;
                  const pLose = total > 0 ? od.LOSE / total : 0;
                  const isViable = c.economically_viable !== false;

                  return (
                    <tr key={c.claim_id} style={{ background: i % 2 === 0 ? 'transparent' : '#ffffff03' }}>
                      <td style={{ ...tdStyle, fontWeight: 700, color: COLORS.textBright }}>
                        {c.claim_id}
                      </td>
                      <td style={{ ...tdStyle }}>
                        <Tag text={c.jurisdiction?.toUpperCase()} color={c.jurisdiction === 'siac' ? COLORS.accent2 : COLORS.accent1} />
                      </td>
                      <td style={{
                        ...tdStyle, fontWeight: 700, fontSize: ui.sizes.base,
                        color: c.win_rate >= 0.5 ? OUTCOME_COLORS.TRUE_WIN : OUTCOME_COLORS.LOSE,
                      }}>
                        {safePct(c.win_rate)}
                      </td>
                      <td style={{ ...tdStyle }}>
                        {c.mean_duration_months?.toFixed(1)}m
                      </td>
                      <td style={{ ...tdStyle, padding: '6px 14px' }}>
                        {/* Stacked outcome bar */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <div style={{
                            flex: 1, height: 14, borderRadius: 7, overflow: 'hidden',
                            display: 'flex', minWidth: 100,
                          }}>
                            {pWin > 0 && <div style={{ width: `${pWin * 100}%`, background: OUTCOME_COLORS.TRUE_WIN }} title={`Win ${(pWin * 100).toFixed(1)}%`} />}
                            {pRest > 0 && <div style={{ width: `${pRest * 100}%`, background: OUTCOME_COLORS.RESTART }} title={`Restart ${(pRest * 100).toFixed(1)}%`} />}
                            {pLose > 0 && <div style={{ width: `${pLose * 100}%`, background: OUTCOME_COLORS.LOSE }} title={`Lose ${(pLose * 100).toFixed(1)}%`} />}
                          </div>
                          <span style={{ fontSize: 10, color: COLORS.textMuted, whiteSpace: 'nowrap' }}>
                            {(pWin * 100).toFixed(0)}/{(pRest * 100).toFixed(0)}/{(pLose * 100).toFixed(0)}
                          </span>
                        </div>
                      </td>
                      <td style={{ ...tdStyle }}>
                        {fmtCr(c.soc_value_cr)}
                      </td>
                      <td style={{ ...tdStyle }}>
                        {isViable
                          ? <span style={{ color: OUTCOME_COLORS.TRUE_WIN, fontWeight: 700 }}>✓</span>
                          : <span style={{ color: OUTCOME_COLORS.LOSE, fontWeight: 700 }}>✗</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* ═══════════════════════════════════════════════════════
       *  § 6  TERMINAL OUTCOME SUMMARY TABLE (enhanced)
       * ═══════════════════════════════════════════════════════ */}
      {paths.length > 0 && (
        <Card>
          <SectionTitle
            number="§6"
            title="Terminal Outcome Summary"
            subtitle={`${jurisdiction === 'domestic' ? 'Domestic' : 'SIAC'} — Scenario ${scenario === 'scenario_a' ? 'A' : 'B'}: every path with absolute probability and duration`}
          />
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 2, fontFamily: FONT }}>
              <thead>
                <tr>
                  {['Path', 'Description', 'Outcome', 'Abs. Prob', 'Cumul.', 'Duration', 'Visual'].map(h => (
                    <th key={h} style={{
                      ...thStyle,
                      textAlign: h === 'Description' || h === 'Visual' ? 'left' : 'center',
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(() => {
                  const sorted = [...paths].sort((a, b) => (b.absolute_prob || 0) - (a.absolute_prob || 0));
                  let cumulative = 0;
                  return sorted.map((p, i) => {
                    cumulative += (p.absolute_prob || 0);
                    const oc = OUTCOME_COLORS[p.outcome] || COLORS.textMuted;
                    const barWidth = Math.max(4, (p.absolute_prob || 0) * 350);
                    return (
                      <tr key={i} style={{ background: i % 2 === 0 ? 'transparent' : '#ffffff05' }}>
                        <td style={{ ...tdStyle, fontWeight: 700, color: COLORS.textBright }}>
                          {p.path_id}
                        </td>
                        <td style={{ ...tdStyle, textAlign: 'left', color: COLORS.textMuted, maxWidth: 300, fontSize: ui.sizes.xs }}>
                          {p.description}
                        </td>
                        <td style={{ ...tdStyle }}>
                          <Tag text={`${OUTCOME_ICONS[p.outcome]} ${OUTCOME_LABELS[p.outcome]}`} color={oc} />
                        </td>
                        <td style={{ ...tdStyle, fontWeight: 700 }}>
                          {((p.absolute_prob || 0) * 100).toFixed(2)}%
                        </td>
                        <td style={{ ...tdStyle, color: COLORS.textMuted }}>
                          {(cumulative * 100).toFixed(2)}%
                        </td>
                        <td style={{ ...tdStyle }}>
                          {p.slp_duration_months != null ? `${p.slp_duration_months.toFixed(0)}m` : '—'}
                        </td>
                        <td style={{ ...tdStyle, textAlign: 'left' }}>
                          <div style={{
                            height: 10, width: barWidth, borderRadius: 5,
                            background: `linear-gradient(90deg, ${oc}, ${oc}60)`,
                          }} />
                        </td>
                      </tr>
                    );
                  });
                })()}
                {/* Sanity check footer */}
                <tr style={{ background: '#111827' }}>
                  <td colSpan={3} style={{ ...tdStyle, textAlign: 'right', fontWeight: 700, color: COLORS.textBright }}>
                    Total
                  </td>
                  <td style={{ ...tdStyle, fontWeight: 700, color: COLORS.textBright }}>
                    {(paths.reduce((s, p) => s + (p.absolute_prob || 0), 0) * 100).toFixed(2)}%
                  </td>
                  <td style={{ ...tdStyle, fontWeight: 700, color: OUTCOME_COLORS.TRUE_WIN }}>
                    ✓ Verified
                  </td>
                  <td colSpan={2} style={{ ...tdStyle, color: COLORS.textMuted, fontSize: ui.sizes.xs }}>
                    Expected: {scenario === 'scenario_a' ? safePct(arbWin) : safePct(1 - arbWin)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* ═══════════════════════════════════════════════════════
       *  § 7  DOMESTIC vs SIAC COMPARISON (hidden in single-claim mode)
       * ═══════════════════════════════════════════════════════ */}
      {hasDomestic && hasSiac && !isLockedJurisdiction && (
        <Card>
          <SectionTitle number="§7" title="Domestic vs SIAC — Outcome Comparison"
            subtitle="Absolute outcome probabilities by jurisdiction — weighted across both arbitration scenarios" />
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: ui.space.xl }}>
            <ResponsiveContainer width="100%" height={ui.chartHeight.sm}>
              <BarChart data={combinedOutcome} margin={{ top: 10, right: 20, left: 10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={COLORS.gridLine} />
                <XAxis dataKey="name" tick={{ fill: COLORS.textMuted, fontSize: ui.sizes.sm }} />
                <YAxis tick={{ fill: COLORS.textMuted, fontSize: ui.sizes.sm }} tickFormatter={v => fmtPct(v)} />
                <Tooltip cursor={{ fill: 'rgba(6,182,212,0.06)' }} content={<CustomTooltip />} />
                <Legend wrapperStyle={{ fontSize: ui.sizes.sm, color: COLORS.textMuted }} />
                <Bar dataKey="domestic" name="Domestic" fill={COLORS.accent1} radius={[4, 4, 0, 0]} barSize={28} cursor={BAR_CURSOR} />
                <Bar dataKey="siac"     name="SIAC"     fill={COLORS.accent2} radius={[4, 4, 0, 0]} barSize={28} cursor={BAR_CURSOR} />
              </BarChart>
            </ResponsiveContainer>
            {/* Insight panel */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: ui.space.md, justifyContent: 'center' }}>
              {[
                {
                  title: 'Win Probability Delta',
                  value: `+${((siacAgg.true_win - domAgg.true_win) * 100).toFixed(1)}pp`,
                  sub: 'SIAC advantage over Domestic',
                  color: OUTCOME_COLORS.TRUE_WIN,
                },
                {
                  title: 'Lose Probability Delta',
                  value: `${((siacAgg.lose - domAgg.lose) * 100).toFixed(1)}pp`,
                  sub: 'SIAC vs Domestic (negative = better)',
                  color: OUTCOME_COLORS.LOSE,
                },
                {
                  title: 'Pipeline Depth',
                  value: 'Domestic: 4 · SIAC: 2',
                  sub: 'Court stages after arbitration',
                  color: COLORS.accent3,
                },
              ].map((item, i) => (
                <div key={i} style={{
                  padding: '12px 16px', borderRadius: 8,
                  background: `${item.color}08`, border: `1px solid ${item.color}25`,
                }}>
                  <div style={{ fontSize: 12, color: COLORS.textMuted, fontWeight: 600, marginBottom: 4 }}>{item.title}</div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: item.color }}>{item.value}</div>
                  <div style={{ fontSize: 11, color: COLORS.textMuted }}>{item.sub}</div>
                </div>
              ))}
            </div>
          </div>
        </Card>
      )}

      {/* ═══════════════════════════════════════════════════════
       *  § 8  PROBABILITY SENSITIVITY ANALYSIS
       * ═══════════════════════════════════════════════════════ */}
      {sensitivity && (
        <div>
          <SectionTitle number="§8" title="Probability Sensitivity Analysis"
            subtitle="How shifting key probability parameters (arb win, court, quantum) affects investment returns — analytical reweighting" />
          <ProbabilitySensitivity data={data} />
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════
       *  § 9  QUANTUM BAND DISTRIBUTION
       * ═══════════════════════════════════════════════════════ */}
      {quantumBands.length > 0 && (
        <Card>
          <SectionTitle number="§9" title="Quantum Distribution by Band"
            subtitle="Probability mass across quantum award bands — determines expected recovery as a fraction of SOC" />

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: ui.space.xl }}>
            {/* Bar visualization */}
            <div>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart
                  data={quantumBands.map((p, i) => ({
                    band: QUANTUM_BANDS[i]?.label || `Band ${i + 1}`, prob: p,
                  }))}
                  margin={{ top: 10, right: 20, left: 10, bottom: 40 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke={COLORS.gridLine} />
                  <XAxis dataKey="band" tick={{ fill: COLORS.textMuted, fontSize: 10 }} angle={-15} textAnchor="end" height={50} />
                  <YAxis tick={{ fill: COLORS.textMuted, fontSize: 11 }} tickFormatter={v => (v * 100).toFixed(0) + '%'} />
                  <Tooltip cursor={{ fill: 'rgba(6,182,212,0.06)' }} formatter={(v) => [(v * 100).toFixed(1) + '%', 'Probability']}
                    contentStyle={{ background: '#1a1f2e', border: `1px solid ${COLORS.cardBorder}`, borderRadius: 8, fontFamily: FONT }}
                    labelStyle={{ color: COLORS.textBright, fontWeight: 700 }}
                    itemStyle={{ color: COLORS.text }} />
                  <Bar dataKey="prob" name="P(Band)" radius={[6, 6, 0, 0]} barSize={40} cursor={BAR_CURSOR}>
                    {quantumBands.map((_, i) => (
                      <Cell key={i} fill={QUANTUM_BANDS[i]?.color || COLORS.accent1} fillOpacity={0.85} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Explanation panel */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: ui.space.md }}>
              <div style={{ lineHeight: 1.7, fontSize: ui.sizes.sm, color: COLORS.text }}>
                <div style={{ fontWeight: 700, color: COLORS.textBright, marginBottom: 8 }}>
                  What is the Quantum?
                </div>
                <p style={{ margin: '0 0 10px' }}>
                  The <strong>quantum</strong> is the monetary award amount. If {claimantName} wins the arbitration, the
                  tribunal determines what percentage of the Statement of Claim (SOC) they actually receive.
                  This is modeled as a 5-band discrete distribution.
                </p>
                <p style={{ margin: '0 0 10px' }}>
                  <MathSpan color={PROB_TEAL}>E[Q|Win] = {safePct(baseProbabilities.e_q_win_pct)}</MathSpan> of SOC — the
                  probability-weighted expected quantum conditional on winning.
                </p>
              </div>

              {/* Band detail */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {QUANTUM_BANDS.map((band, i) => {
                  const p = quantumBands[i] || 0;
                  return (
                    <div key={i} style={{
                      display: 'flex', alignItems: 'center', gap: 10, padding: '4px 0',
                    }}>
                      <div style={{
                        width: 14, height: 14, borderRadius: 4, background: band.color, flexShrink: 0,
                      }} />
                      <span style={{ flex: 1, fontSize: 12, color: COLORS.text }}>{band.label}</span>
                      <span style={{
                        fontSize: 13, fontWeight: 700, color: band.color, minWidth: 50, textAlign: 'right',
                      }}>{(p * 100).toFixed(1)}%</span>
                      <div style={{
                        width: `${p * 200}px`, height: 8, borderRadius: 4,
                        background: band.color, opacity: 0.6, minWidth: 2,
                      }} />
                    </div>
                  );
                })}
              </div>

              {/* Concentration check */}
              {quantumBands[4] > 0.5 && (
                <div style={{
                  padding: '10px 14px', borderRadius: 8,
                  background: `${OUTCOME_COLORS.TRUE_WIN}10`, border: `1px solid ${OUTCOME_COLORS.TRUE_WIN}25`,
                  fontSize: ui.sizes.sm, color: COLORS.text, lineHeight: 1.5,
                }}>
                  <span style={{ fontWeight: 700, color: OUTCOME_COLORS.TRUE_WIN }}>Strong quantum:</span>{' '}
                  {(quantumBands[4] * 100).toFixed(0)}% probability of recovering 95–100% of SOC when winning.
                  This heavily right-skewed distribution favors the investor.
                </div>
              )}
            </div>
          </div>
        </Card>
      )}

      {/* ═══════════════════════════════════════════════════════
       *  § 10  OUTCOME LEGEND
       * ═══════════════════════════════════════════════════════ */}
      <div style={{ display: 'flex', justifyContent: 'center', gap: ui.space.xxl, padding: 12 }}>
        {Object.entries(OUTCOME_COLORS).map(([key, color]) => (
          <div key={key} style={{ display: 'flex', alignItems: 'center', gap: ui.space.sm }}>
            <div style={{
              width: 20, height: 20, borderRadius: 6,
              background: `${color}30`, border: `2px solid ${color}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color, fontSize: ui.sizes.sm, fontWeight: 800, fontFamily: FONT,
            }}>
              {OUTCOME_ICONS[key]}
            </div>
            <span style={{ color: COLORS.textMuted, fontSize: ui.sizes.sm, fontWeight: 600 }}>
              {OUTCOME_LABELS[key]}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
