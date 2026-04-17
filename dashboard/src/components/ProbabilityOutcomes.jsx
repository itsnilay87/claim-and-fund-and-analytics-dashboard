/**
 * ProbabilityOutcomes.jsx — Probability & Outcomes tab.
 *
 * Sections:
 *   1. Aggregate probability table (per-claim P(WIN), P(RESTART), P(LOSE))
 *   2. Claim selector + D3 decision tree for selected claim
 *   3. Conditional probability tables per scenario
 *   4. Portfolio outcome distribution histogram
 */

import React, { useState, useMemo } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, Legend,
} from 'recharts';
import { COLORS, FONT, CHART_COLORS, useUISettings, fmtPct } from '../theme';
import { Card, SectionTitle, KPI, CustomTooltip, DataTable } from './Shared';
import D3ProbabilityTree from './D3ProbabilityTree';
import { buildClaimNameMap, getClaimDisplayName, truncateClaimName } from '../utils/claimNames';

const OUTCOME_COLORS = { TRUE_WIN: '#10B981', RESTART: '#F59E0B', LOSE: '#EF4444' };
const OUTCOME_LABELS = { TRUE_WIN: 'Win', RESTART: 'Restart', LOSE: 'Lose' };
const NODATA = <span style={{ color: COLORS.textMuted }}>Data not available</span>;

/* ── Build a tree hierarchy from terminal paths ── */
function buildTreeFromPaths(paths, scenarioLabel) {
  if (!paths || paths.length === 0) return null;

  const root = { label: scenarioLabel || 'Root', children: [] };

  paths.forEach(tp => {
    const steps = (tp.path || '').split(' → ').filter(Boolean);
    let current = root;

    steps.forEach((step, idx) => {
      const isTerminal = idx === steps.length - 1;
      let child = current.children.find(c => c.label === step);
      if (!child) {
        child = { label: step, children: [] };
        if (isTerminal) {
          child.outcome = tp.outcome;
          child.abs_prob = tp.probability;
          child.prob = tp.probability;
          delete child.children;
        }
        current.children.push(child);
      }
      if (!isTerminal) {
        current = child;
      }
    });
  });

  // Infer conditional probabilities: at each branching node, prob = sum of descendant abs_prob
  function assignProbs(node) {
    if (!node.children || node.children.length === 0) return node.abs_prob || 0;
    let total = 0;
    node.children.forEach(c => { total += assignProbs(c); });
    node.children.forEach(c => {
      if (c.abs_prob != null) {
        c.prob = total > 0 ? c.abs_prob / total : 0;
      } else {
        const childSum = c.children ? c.children.reduce((s, gc) => s + (gc.abs_prob || 0), 0) : 0;
        c.prob = total > 0 ? childSum / total : 0;
      }
    });
    node.abs_prob = total;
    return total;
  }
  assignProbs(root);

  return root;
}

export default function ProbabilityOutcomes({ data }) {
  const { ui } = useUISettings();
  const prob = data?.probability_summary;
  const claims = data?.claims || [];
  const claimNameMap = useMemo(() => buildClaimNameMap(claims), [claims]);
  const claimIds = claims.map(c => c.claim_id);

  const [selectedClaim, setSelectedClaim] = useState(claimIds[0] || '');
  const [selectedScenario, setSelectedScenario] = useState('scenario_a');

  if (!prob) return <Card>{NODATA}</Card>;

  const claimProb = prob[selectedClaim] || {};

  /* ── Build tree from terminal_paths ── */
  const treeData = useMemo(() => {
    const scenData = claimProb[selectedScenario];
    if (!scenData?.terminal_paths) return null;
    const label = selectedScenario === 'scenario_a' ? 'A: TATA Wins Arb' : 'B: TATA Loses Arb';
    return buildTreeFromPaths(scenData.terminal_paths, label);
  }, [claimProb, selectedScenario]);

  const treeHeight = typeof window !== 'undefined'
    ? Math.max(440, Math.round(window.innerHeight * 0.55))
    : 520;

  /* ── Aggregate probability table data ── */
  const aggTableRows = claimIds.map(cid => {
    const c = prob[cid]?.aggregate || {};
    const claim = claims.find(cl => cl.claim_id === cid) || {};
    return [
      claimNameMap[cid] || getClaimDisplayName({ claim_id: cid, ...claim }),
      claim.jurisdiction || '—',
      fmtPct(c.p_true_win || 0),
      fmtPct(c.p_restart || 0),
      fmtPct(c.p_lose || 0),
      fmtPct(prob[cid]?.arb_win_probability || 0),
    ];
  });

  /* ── Per-claim outcome bar chart data ── */
  const outcomeBarData = claimIds.map(cid => {
    const c = prob[cid]?.aggregate || {};
    return {
      claim: truncateClaimName(claimNameMap[cid] || cid.replace('TP-', ''), 18),
      TRUE_WIN: +(c.p_true_win * 100 || 0).toFixed(1),
      RESTART: +(c.p_restart * 100 || 0).toFixed(1),
      LOSE: +(c.p_lose * 100 || 0).toFixed(1),
    };
  });

  /* ── Conditional probability tables ── */
  const scenarioData = claimProb[selectedScenario];
  const terminalPaths = scenarioData?.terminal_paths || [];

  /* ── Portfolio outcome distribution (# claims winning per path) ── */
  const portfolioOutcomeDist = useMemo(() => {
    // For each unique win count (0 through N), estimate probability
    // Simplified: use aggregate win rates and combinatorial approach
    const winRates = claimIds.map(cid => prob[cid]?.aggregate?.p_true_win || 0);
    const n = winRates.length;
    // Use dynamic programming for exact distribution
    let dp = [1.0]; // dp[k] = P(exactly k wins)
    for (let i = 0; i < n; i++) {
      const pw = winRates[i];
      const newDp = new Array(dp.length + 1).fill(0);
      for (let k = 0; k < dp.length; k++) {
        newDp[k] += dp[k] * (1 - pw);
        newDp[k + 1] += dp[k] * pw;
      }
      dp = newDp;
    }
    return dp.map((p, k) => ({
      wins: `${k} of ${n}`,
      probability: +(p * 100).toFixed(2),
      pRaw: p,
    }));
  }, [claimIds, prob]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: ui.space.xl }}>

      {/* KPI Row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: ui.space.md }}>
        {claimIds.length > 0 && (() => {
          const avgWin = claimIds.reduce((s, cid) => s + (prob[cid]?.aggregate?.p_true_win || 0), 0) / claimIds.length;
          const avgRestart = claimIds.reduce((s, cid) => s + (prob[cid]?.aggregate?.p_restart || 0), 0) / claimIds.length;
          const avgLose = claimIds.reduce((s, cid) => s + (prob[cid]?.aggregate?.p_lose || 0), 0) / claimIds.length;
          return (
            <>
              <KPI label="Avg P(Win)" value={fmtPct(avgWin)} color={OUTCOME_COLORS.TRUE_WIN} />
              <KPI label="Avg P(Restart)" value={fmtPct(avgRestart)} color={OUTCOME_COLORS.RESTART} />
              <KPI label="Avg P(Lose)" value={fmtPct(avgLose)} color={OUTCOME_COLORS.LOSE} />
              <KPI label="Claims" value={claimIds.length} color={COLORS.accent1} />
            </>
          );
        })()}
      </div>

      {/* §1 Aggregate Probability Table */}
      <Card>
        <SectionTitle number="1" title="Aggregate Outcome Probabilities"
          subtitle="Per-claim probability of each terminal outcome, combining all challenge paths." />
        <DataTable
          headers={['Claim', 'Jurisdiction', 'P(Win)', 'P(Restart)', 'P(Lose)', 'P(Arb Win)']}
          rows={aggTableRows}
        />
      </Card>

      {/* §2 Per-Claim Outcome Bar Chart */}
      <Card>
        <SectionTitle number="2" title="Per-Claim Outcome Distribution"
          subtitle="Stacked bar showing probability breakdown for each claim." />
        <ResponsiveContainer width="100%" height={320}>
          <BarChart data={outcomeBarData} margin={{ top: 10, right: 20, left: 10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={COLORS.gridLine} />
            <XAxis dataKey="claim" tick={{ fill: COLORS.textMuted, fontSize: ui.sizes.sm }} />
            <YAxis tick={{ fill: COLORS.textMuted, fontSize: ui.sizes.sm }} unit="%" />
            <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(6,182,212,0.06)' }} />
            <Legend wrapperStyle={{ fontSize: ui.sizes.sm, color: COLORS.textMuted }} />
            <Bar dataKey="TRUE_WIN" name="Win %" stackId="out" fill={OUTCOME_COLORS.TRUE_WIN} radius={[0, 0, 0, 0]} />
            <Bar dataKey="RESTART" name="Restart %" stackId="out" fill={OUTCOME_COLORS.RESTART} />
            <Bar dataKey="LOSE" name="Lose %" stackId="out" fill={OUTCOME_COLORS.LOSE} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </Card>

      {/* §3 D3 Decision Tree */}
      <Card>
        <SectionTitle number="3" title="Decision Tree Visualization"
          subtitle="Interactive probability tree. Scroll to zoom, drag to pan, double-click to reset." />
        <div style={{ display: 'flex', gap: ui.space.md, marginBottom: ui.space.md, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ color: COLORS.textMuted, fontSize: ui.sizes.sm, fontWeight: 600 }}>Claim:</span>
            <select
              value={selectedClaim}
              onChange={e => setSelectedClaim(e.target.value)}
              style={{
                background: COLORS.card, color: COLORS.textBright,
                border: `1px solid ${COLORS.cardBorder}`, borderRadius: 6,
                padding: '6px 12px', fontSize: 13, fontFamily: FONT, cursor: 'pointer',
              }}
            >
              {claimIds.map(cid => (
                <option key={cid} value={cid}>{claimNameMap[cid] || cid}</option>
              ))}
            </select>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ color: COLORS.textMuted, fontSize: ui.sizes.sm, fontWeight: 600 }}>Scenario:</span>
            {['scenario_a', 'scenario_b'].map(s => (
              <button
                key={s}
                onClick={() => setSelectedScenario(s)}
                style={{
                  padding: '6px 14px', borderRadius: 6, border: 'none', cursor: 'pointer',
                  fontFamily: FONT, fontSize: ui.sizes.sm,
                  fontWeight: selectedScenario === s ? 700 : 500,
                  color: selectedScenario === s ? '#fff' : COLORS.textMuted,
                  background: selectedScenario === s ? COLORS.gradient1 : COLORS.card,
                }}
              >
                {s === 'scenario_a' ? 'A: TATA Wins Arb' : 'B: TATA Loses Arb'}
              </button>
            ))}
          </div>
        </div>
        <D3ProbabilityTree treeData={treeData} height={treeHeight} />
      </Card>

      {/* §4 Terminal Paths Table */}
      {terminalPaths.length > 0 && (
        <Card>
          <SectionTitle number="4" title="Terminal Path Details"
            subtitle={`${terminalPaths.length} terminal paths for ${claimNameMap[selectedClaim] || selectedClaim} (${selectedScenario === 'scenario_a' ? 'Arb Won' : 'Arb Lost'})`} />
          <DataTable
            headers={['Path', 'Probability', 'Outcome']}
            rows={terminalPaths.map(tp => [
              <span style={{ fontSize: 12, textAlign: 'left', display: 'block' }}>{tp.path}</span>,
              fmtPct(tp.probability),
              <span style={{
                padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 700,
                background: `${OUTCOME_COLORS[tp.outcome]}20`,
                color: OUTCOME_COLORS[tp.outcome],
              }}>
                {OUTCOME_LABELS[tp.outcome] || tp.outcome}
              </span>,
            ])}
          />
        </Card>
      )}

      {/* §5 Portfolio Outcome Distribution */}
      <Card>
        <SectionTitle number="5" title="Portfolio Outcome Distribution"
          subtitle="Probability of exactly N claims winning (using aggregate win rates, independent claims assumption)." />
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={portfolioOutcomeDist} margin={{ top: 10, right: 20, left: 10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={COLORS.gridLine} />
            <XAxis dataKey="wins" tick={{ fill: COLORS.textMuted, fontSize: ui.sizes.sm }} />
            <YAxis tick={{ fill: COLORS.textMuted, fontSize: ui.sizes.sm }} unit="%" />
            <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(6,182,212,0.06)' }} />
            <Bar dataKey="probability" name="Probability %" radius={[6, 6, 0, 0]} barSize={48}>
              {portfolioOutcomeDist.map((d, i) => (
                <Cell key={i} fill={d.pRaw > 0.2 ? COLORS.accent4 : d.pRaw > 0.1 ? COLORS.accent1 : COLORS.accent6} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </Card>

      {/* Outcome Legend */}
      <div style={{ display: 'flex', justifyContent: 'center', gap: ui.space.xl }}>
        {Object.entries(OUTCOME_COLORS).map(([key, color]) => (
          <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 14, height: 14, borderRadius: 4, background: color }} />
            <span style={{ color: COLORS.textMuted, fontSize: ui.sizes.sm }}>{OUTCOME_LABELS[key]}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
