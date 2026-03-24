/**
 * ClaimProbabilityOutcomes.jsx — Single-claim probability & outcomes tab.
 *
 * Thin wrapper around V2ProbabilityOutcomes, adding:
 *   1. KPI Row (P(Win), P(Restart), P(Lose), P(Arb Win))
 *   2. Existing V2 D3 probability tree + analysis
 *   3. Outcome Distribution stacked bar
 */

import React from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, Cell, Legend,
} from 'recharts';
import { COLORS, FONT, useUISettings, fmtPct } from '../../theme';
import { Card, SectionTitle, KPI } from '../Shared';
import { V2ProbabilityOutcomes } from '../v2';

const OUTCOME_COLORS = { TRUE_WIN: '#10B981', RESTART: '#F59E0B', LOSE: '#EF4444' };

/* ═══════════════════════════════════════════════════════════
 *  § 1 — KPI Row
 * ═══════════════════════════════════════════════════════════ */
function ProbabilityKPIRow({ data }) {
  const { ui } = useUISettings();
  const prob = data?.probability_summary || {};
  const claim = data?.claims?.[0] || {};
  const jur = claim.jurisdiction || 'domestic';

  // Get aggregate from the claim's jurisdiction
  const agg = prob[jur]?.aggregate || prob.domestic?.aggregate || prob.siac?.aggregate || {};
  const arbWin = prob.arb_win_probability ?? 0;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: ui.space.md }}>
      <KPI
        label="P(Win)"
        value={fmtPct(agg.true_win)}
        sub={`${jur.toUpperCase()} jurisdiction`}
        color="#10B981"
      />
      <KPI
        label="P(Restart)"
        value={fmtPct(agg.restart)}
        sub="Re-arbitration path"
        color="#F59E0B"
      />
      <KPI
        label="P(Lose)"
        value={fmtPct(agg.lose)}
        sub="Total loss probability"
        color="#EF4444"
      />
      <KPI
        label="P(Arb Win)"
        value={fmtPct(arbWin)}
        sub="First arbitration"
        color={COLORS.accent6}
      />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
 *  § 3 — Outcome Distribution Bar
 * ═══════════════════════════════════════════════════════════ */
function OutcomeDistributionBar({ data }) {
  const { ui } = useUISettings();
  const claim = data?.claims?.[0] || {};
  const dist = claim.outcome_distribution;
  if (!dist) return null;

  const total = (dist.TRUE_WIN || 0) + (dist.RESTART || 0) + (dist.LOSE || 0);
  if (total === 0) return null;

  const winPct = ((dist.TRUE_WIN || 0) / total * 100);
  const restartPct = ((dist.RESTART || 0) / total * 100);
  const losePct = ((dist.LOSE || 0) / total * 100);

  const barData = [{ name: 'Outcomes', win: winPct, restart: restartPct, lose: losePct }];

  return (
    <Card>
      <SectionTitle title="Outcome Distribution" subtitle={`Based on ${total} Monte Carlo paths`} />

      {/* Visual stacked bar */}
      <div style={{
        display: 'flex', height: 44, borderRadius: 10, overflow: 'hidden',
        border: `1px solid ${COLORS.cardBorder}`,
      }}>
        {winPct > 0 && (
          <div style={{
            width: `${winPct}%`, background: OUTCOME_COLORS.TRUE_WIN,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#fff', fontSize: ui.sizes.sm, fontWeight: 700, fontFamily: FONT,
            minWidth: winPct > 8 ? 'auto' : 0,
          }}>
            {winPct > 8 ? `Win ${winPct.toFixed(1)}%` : ''}
          </div>
        )}
        {restartPct > 0 && (
          <div style={{
            width: `${restartPct}%`, background: OUTCOME_COLORS.RESTART,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#fff', fontSize: ui.sizes.sm, fontWeight: 700, fontFamily: FONT,
            minWidth: restartPct > 8 ? 'auto' : 0,
          }}>
            {restartPct > 8 ? `Restart ${restartPct.toFixed(1)}%` : ''}
          </div>
        )}
        {losePct > 0 && (
          <div style={{
            width: `${losePct}%`, background: OUTCOME_COLORS.LOSE,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#fff', fontSize: ui.sizes.sm, fontWeight: 700, fontFamily: FONT,
            minWidth: losePct > 8 ? 'auto' : 0,
          }}>
            {losePct > 8 ? `Lose ${losePct.toFixed(1)}%` : ''}
          </div>
        )}
      </div>

      {/* Legend row */}
      <div style={{ display: 'flex', gap: ui.space.xl, marginTop: ui.space.md, justifyContent: 'center' }}>
        {[
          { label: 'Win', color: OUTCOME_COLORS.TRUE_WIN, count: dist.TRUE_WIN || 0, pct: winPct },
          { label: 'Restart', color: OUTCOME_COLORS.RESTART, count: dist.RESTART || 0, pct: restartPct },
          { label: 'Lose', color: OUTCOME_COLORS.LOSE, count: dist.LOSE || 0, pct: losePct },
        ].map(item => (
          <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 12, height: 12, borderRadius: 3, background: item.color }} />
            <span style={{ color: COLORS.text, fontSize: ui.sizes.sm, fontFamily: FONT }}>
              {item.label}: {item.count} paths ({item.pct.toFixed(1)}%)
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
}

/* ═══════════════════════════════════════════════════════════
 *  Main Component
 * ═══════════════════════════════════════════════════════════ */
export default function ClaimProbabilityOutcomes({ data, stochasticData }) {
  const { ui } = useUISettings();

  // Extract the claim's jurisdiction to lock probability displays
  const claim = data?.claims?.[0] || {};
  const jur = claim.jurisdiction || 'domestic';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: ui.space.xl }}>
      <ProbabilityKPIRow data={data} />
      <V2ProbabilityOutcomes data={data} stochasticData={stochasticData} claimJurisdiction={jur} />
      <OutcomeDistributionBar data={data} />
    </div>
  );
}
