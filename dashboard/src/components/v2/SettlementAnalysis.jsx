/**
 * SettlementAnalysis.jsx — Settlement Analytics Dashboard Tab.
 *
 * Sections:
 *   § A  Settlement KPI Row (4 cards)
 *   § B  Settlement vs. Judgment Comparison (bar chart)
 *   § C  Settlement by Stage (horizontal bar + detail table)
 *   § D  Settlement Timing Distribution (histogram)
 *   § E  Per-Claim Settlement Rates (table)
 *   § F  Game-Theoretic Details (conditional)
 *
 * Reads from data.settlement (Phase 5 JSON export).
 */

import React from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Cell, Legend,
} from 'recharts';
import { COLORS, FONT, SIZES, useUISettings, fmtCr, fmtPct, fmtMo, fmtMOIC, BAR_CURSOR } from '../theme';
import { Card, SectionTitle, KPI, CustomTooltip } from './Shared';
import { getClaimDisplayName } from '../../utils/claimNames';

/* ═══════════════════════════════════════════════════════════
 * Constants
 * ═══════════════════════════════════════════════════════════ */

const SETTLED_COLOR  = '#10B981';
const JUDGMENT_COLOR = '#F59E0B';
const STAGE_COLORS   = ['#3B82F6', '#8B5CF6', '#06B6D4', '#EC4899', '#F59E0B', '#EF4444', '#34D399', '#A78BFA'];

const TABLE_STYLE = { width: '100%', borderCollapse: 'collapse', fontFamily: FONT };
const TH_STYLE = {
  padding: '10px 12px', textAlign: 'center', color: '#fff', fontWeight: 700,
  fontSize: 11, background: 'linear-gradient(135deg, #1e3a5f 0%, #2563EB 100%)',
  borderBottom: `2px solid ${COLORS.accent1}`, whiteSpace: 'nowrap',
};
const TD_STYLE = { padding: '8px 12px', textAlign: 'right', color: COLORS.text, borderBottom: `1px solid ${COLORS.cardBorder}`, fontSize: 12 };
const TD_LEFT  = { ...TD_STYLE, textAlign: 'left', fontWeight: 600 };

const MODE_LABELS = {
  user_specified: 'User-Specified',
  game_theoretic: 'Game-Theoretic',
};

/* ═══════════════════════════════════════════════════════════
 * Main Component
 * ═══════════════════════════════════════════════════════════ */

export default function SettlementAnalysis({ data }) {
  const { ui } = useUISettings();
  const settlement = data?.settlement;

  /* ── Disabled / missing state ── */
  if (!settlement || settlement.enabled === false) {
    return (
      <Card style={{ textAlign: 'center', padding: 60 }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>🤝</div>
        <div style={{ fontSize: ui.sizes.lg, fontWeight: 700, color: COLORS.textBright, marginBottom: 8 }}>
          Settlement Modeling Disabled
        </div>
        <div style={{ fontSize: ui.sizes.md, color: COLORS.textMuted, maxWidth: 480, margin: '0 auto' }}>
          Settlement modeling is disabled for this simulation. Enable it in the Claim Editor → Settlement tab.
        </div>
      </Card>
    );
  }

  const summary   = settlement.summary || {};
  const perStage  = settlement.per_stage || [];
  const perClaim  = settlement.per_claim || {};
  const comparison = settlement.comparison || {};
  const timingHist = settlement.timing_histogram || [];
  const gameTheoretic = settlement.game_theoretic;
  const config    = settlement.config || {};
  const mode      = settlement.mode || 'user_specified';
  const claims    = data?.claims || [];

  /* ── Derived: weighted average timing across stages ── */
  const totalSettled = perStage.reduce((s, st) => s + (st.count || 0), 0);
  const weightedTiming = totalSettled > 0
    ? perStage.reduce((s, st) => s + (st.mean_timing_months || 0) * (st.count || 0), 0) / totalSettled
    : 0;

  /* ── Comparison chart data ── */
  const settled  = comparison.settled_paths || {};
  const judgment = comparison.judgment_paths || {};
  const comparisonData = [
    { metric: 'Mean MOIC',     settled: settled.mean_moic || 0,            judgment: judgment.mean_moic || 0 },
    { metric: 'Mean IRR',      settled: (settled.mean_irr || 0) * 100,     judgment: (judgment.mean_irr || 0) * 100 },
    { metric: 'Duration (mo)', settled: settled.mean_duration_months || 0,  judgment: judgment.mean_duration_months || 0 },
    { metric: 'Legal Cost (₹Cr)', settled: settled.mean_legal_cost_cr || 0, judgment: judgment.mean_legal_cost_cr || 0 },
  ];

  /* ── Stage chart data ── */
  const stageChartData = perStage.map((st, i) => ({
    stage: st.stage || `Stage ${i + 1}`,
    count: st.count || 0,
    pct: ((st.pct_of_settlements || 0) * 100),
    mean_amount: st.mean_amount_cr || 0,
    mean_discount: st.mean_discount_used || 0,
    fill: STAGE_COLORS[i % STAGE_COLORS.length],
  }));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: ui.space.xl }}>

      {/* ═══════════════════════════════════════════════════════
       *  § A  SETTLEMENT KPI ROW
       * ═══════════════════════════════════════════════════════ */}
      <Card>
        <SectionTitle number="A" title="Settlement Overview"
          subtitle="Key settlement metrics across all Monte Carlo paths" />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: ui.space.md }}>
          <KPI label="Settlement Rate" value={fmtPct(summary.settlement_rate)}
            sub={`${summary.settled_paths || 0} of ${summary.total_paths || 0} paths`}
            color={SETTLED_COLOR} />
          <KPI label="Mean Sett. Amount" value={fmtCr(summary.mean_settlement_amount_cr)}
            sub={`${fmtPct(summary.mean_settlement_as_pct_of_soc)} of SOC`}
            color={COLORS.accent1} />
          <KPI label="Mean Sett. Timing" value={fmtMo(weightedTiming)}
            sub="Weighted avg across stages"
            color={COLORS.accent3} />
          <KPI label="Mode" value={MODE_LABELS[mode] || mode}
            sub={mode === 'game_theoretic' ? `α = ${config.bargaining_power ?? 0.5}` : `λ = ${fmtPct(config.global_hazard_rate)}`}
            color={COLORS.accent2} />
        </div>
      </Card>

      {/* ═══════════════════════════════════════════════════════
       *  § B  SETTLEMENT vs JUDGMENT COMPARISON
       * ═══════════════════════════════════════════════════════ */}
      {(comparison.settled_paths || comparison.judgment_paths) && (
        <Card>
          <SectionTitle number="B" title="Settlement vs. Judgment Comparison"
            subtitle="Side-by-side metrics for paths that settled vs. went to judgment" />
          <ResponsiveContainer width="100%" height={340}>
            <BarChart data={comparisonData} barGap={8} margin={{ top: 10, right: 30, left: 10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={COLORS.gridLine} />
              <XAxis dataKey="metric" tick={{ fill: COLORS.text, fontSize: ui.sizes.sm, fontFamily: FONT }} />
              <YAxis tick={{ fill: COLORS.textMuted, fontSize: ui.sizes.sm, fontFamily: FONT }} />
              <Tooltip content={<CustomTooltip />} cursor={BAR_CURSOR} />
              <Legend wrapperStyle={{ fontSize: ui.sizes.sm, fontFamily: FONT }} />
              <Bar dataKey="settled" name="Settled Paths" fill={SETTLED_COLOR} radius={[4, 4, 0, 0]} />
              <Bar dataKey="judgment" name="Judgment Paths" fill={JUDGMENT_COLOR} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>

          {/* Detail table below chart */}
          <div style={{ overflowX: 'auto', marginTop: ui.space.lg }}>
            <table style={TABLE_STYLE}>
              <thead>
                <tr>
                  <th style={{ ...TH_STYLE, textAlign: 'left' }}>Metric</th>
                  <th style={TH_STYLE}>Settled Paths</th>
                  <th style={TH_STYLE}>Judgment Paths</th>
                  <th style={TH_STYLE}>Difference</th>
                </tr>
              </thead>
              <tbody>
                {[
                  { label: 'Mean MOIC',       s: settled.mean_moic,            j: judgment.mean_moic,            fmt: fmtMOIC },
                  { label: 'Mean IRR',        s: settled.mean_irr,             j: judgment.mean_irr,             fmt: fmtPct },
                  { label: 'Mean Duration',   s: settled.mean_duration_months, j: judgment.mean_duration_months, fmt: fmtMo },
                  { label: 'Mean Legal Cost', s: settled.mean_legal_cost_cr,   j: judgment.mean_legal_cost_cr,   fmt: fmtCr },
                ].map(({ label, s, j, fmt }, i) => (
                  <tr key={label} style={{ background: i % 2 === 0 ? 'transparent' : '#ffffff03' }}>
                    <td style={TD_LEFT}>{label}</td>
                    <td style={{ ...TD_STYLE, color: SETTLED_COLOR, fontWeight: 600 }}>{fmt(s)}</td>
                    <td style={{ ...TD_STYLE, color: JUDGMENT_COLOR, fontWeight: 600 }}>{fmt(j)}</td>
                    <td style={{
                      ...TD_STYLE, fontWeight: 600,
                      color: (s || 0) > (j || 0) ? SETTLED_COLOR : JUDGMENT_COLOR,
                    }}>
                      {fmt((s || 0) - (j || 0))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* ═══════════════════════════════════════════════════════
       *  § C  SETTLEMENT BY STAGE
       * ═══════════════════════════════════════════════════════ */}
      {perStage.length > 0 && (
        <Card>
          <SectionTitle number="C" title="Settlement by Stage"
            subtitle="Breakdown of where settlements occur in the litigation pipeline" />

          {/* Horizontal bar chart */}
          <ResponsiveContainer width="100%" height={Math.max(200, perStage.length * 50 + 40)}>
            <BarChart data={stageChartData} layout="vertical" margin={{ top: 5, right: 30, left: 80, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={COLORS.gridLine} />
              <XAxis type="number" tick={{ fill: COLORS.textMuted, fontSize: ui.sizes.sm, fontFamily: FONT }}
                label={{ value: 'Settlement Count', position: 'insideBottom', offset: -2, fill: COLORS.textMuted, fontSize: ui.sizes.sm }} />
              <YAxis type="category" dataKey="stage" tick={{ fill: COLORS.text, fontSize: ui.sizes.sm, fontFamily: FONT }} width={75} />
              <Tooltip content={<CustomTooltip />} cursor={BAR_CURSOR} />
              <Bar dataKey="count" name="Settlements" radius={[0, 4, 4, 0]}>
                {stageChartData.map((entry, idx) => (
                  <Cell key={idx} fill={entry.fill} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>

          {/* Stage detail table */}
          <div style={{ overflowX: 'auto', marginTop: ui.space.lg }}>
            <table style={TABLE_STYLE}>
              <thead>
                <tr>
                  <th style={{ ...TH_STYLE, textAlign: 'left' }}>Stage</th>
                  <th style={TH_STYLE}>Count</th>
                  <th style={TH_STYLE}>% of Total</th>
                  <th style={TH_STYLE}>% of Settlements</th>
                  <th style={TH_STYLE}>Mean δ</th>
                  <th style={TH_STYLE}>Mean Amount (₹Cr)</th>
                  <th style={TH_STYLE}>Mean Timing</th>
                </tr>
              </thead>
              <tbody>
                {perStage.map((st, i) => (
                  <tr key={st.stage || i} style={{ background: i % 2 === 0 ? 'transparent' : '#ffffff03' }}>
                    <td style={{ ...TD_LEFT, color: STAGE_COLORS[i % STAGE_COLORS.length] }}>
                      {st.stage || `Stage ${i + 1}`}
                    </td>
                    <td style={TD_STYLE}>{st.count || 0}</td>
                    <td style={TD_STYLE}>{fmtPct(st.pct_of_total)}</td>
                    <td style={TD_STYLE}>{fmtPct(st.pct_of_settlements)}</td>
                    <td style={TD_STYLE}>{(st.mean_discount_used || 0).toFixed(3)}</td>
                    <td style={TD_STYLE}>{fmtCr(st.mean_amount_cr)}</td>
                    <td style={TD_STYLE}>{fmtMo(st.mean_timing_months)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* ═══════════════════════════════════════════════════════
       *  § D  SETTLEMENT TIMING DISTRIBUTION
       * ═══════════════════════════════════════════════════════ */}
      {timingHist.length > 0 && (
        <Card>
          <SectionTitle number="D" title="Settlement Timing Distribution"
            subtitle="Histogram of settlement timing across Monte Carlo paths" />
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={timingHist} margin={{ top: 10, right: 30, left: 10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={COLORS.gridLine} />
              <XAxis dataKey="month_bin"
                tick={{ fill: COLORS.text, fontSize: ui.sizes.sm, fontFamily: FONT }}
                label={{ value: 'Months', position: 'insideBottom', offset: -2, fill: COLORS.textMuted, fontSize: ui.sizes.sm }} />
              <YAxis tick={{ fill: COLORS.textMuted, fontSize: ui.sizes.sm, fontFamily: FONT }}
                label={{ value: 'Path Count', angle: -90, position: 'insideLeft', fill: COLORS.textMuted, fontSize: ui.sizes.sm }} />
              <Tooltip content={<CustomTooltip />} cursor={BAR_CURSOR} />
              <Bar dataKey="count" name="Settlements" fill={SETTLED_COLOR} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
      )}

      {/* ═══════════════════════════════════════════════════════
       *  § E  PER-CLAIM SETTLEMENT RATES
       * ═══════════════════════════════════════════════════════ */}
      {Object.keys(perClaim).length > 0 && (
        <Card>
          <SectionTitle number="E" title="Per-Claim Settlement Rates"
            subtitle="Settlement metrics broken down by individual claim" />
          <div style={{ overflowX: 'auto' }}>
            <table style={TABLE_STYLE}>
              <thead>
                <tr>
                  <th style={{ ...TH_STYLE, textAlign: 'left' }}>Claim</th>
                  <th style={TH_STYLE}>Settlement Rate</th>
                  <th style={TH_STYLE}>Mean Amount (₹Cr)</th>
                  <th style={TH_STYLE}>Mean Discount (δ)</th>
                  <th style={TH_STYLE}>Mean Timing</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(perClaim).map(([claimId, stats], i) => {
                  const claim = claims.find(c => c.claim_id === claimId);
                  return (
                    <tr key={claimId} style={{ background: i % 2 === 0 ? 'transparent' : '#ffffff03' }}>
                      <td style={TD_LEFT}>
                        {claim ? getClaimDisplayName(claim) : claimId}
                      </td>
                      <td style={{ ...TD_STYLE, color: SETTLED_COLOR, fontWeight: 700 }}>
                        {fmtPct(stats.settlement_rate)}
                      </td>
                      <td style={TD_STYLE}>{fmtCr(stats.mean_amount_cr)}</td>
                      <td style={TD_STYLE}>{(stats.mean_discount || 0).toFixed(3)}</td>
                      <td style={TD_STYLE}>{fmtMo(stats.mean_timing_months)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* ═══════════════════════════════════════════════════════
       *  § F  GAME-THEORETIC DETAILS (conditional)
       * ═══════════════════════════════════════════════════════ */}
      {mode === 'game_theoretic' && gameTheoretic && (
        <Card>
          <SectionTitle number="F" title="Game-Theoretic Settlement Analysis"
            subtitle={`Nash Bargaining Solution with α = ${gameTheoretic.bargaining_power ?? 0.5}`} />

          {/* Computed discount factors per stage */}
          {gameTheoretic.per_stage_discounts && (
            <div style={{ marginBottom: ui.space.xl }}>
              <div style={{
                fontSize: ui.sizes.sm, color: COLORS.textMuted, fontWeight: 700,
                textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: ui.space.md,
              }}>Computed Discount Factors (δ*) by Stage</div>

              <ResponsiveContainer width="100%" height={Math.max(200, Object.keys(gameTheoretic.per_stage_discounts).length * 45 + 40)}>
                <BarChart
                  data={Object.entries(gameTheoretic.per_stage_discounts).map(([stage, delta], i) => ({
                    stage, delta, fill: STAGE_COLORS[i % STAGE_COLORS.length],
                  }))}
                  layout="vertical"
                  margin={{ top: 5, right: 30, left: 80, bottom: 5 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke={COLORS.gridLine} />
                  <XAxis type="number" domain={[0, 1]}
                    tick={{ fill: COLORS.textMuted, fontSize: ui.sizes.sm, fontFamily: FONT }}
                    label={{ value: 'Discount Factor (δ*)', position: 'insideBottom', offset: -2, fill: COLORS.textMuted, fontSize: ui.sizes.sm }} />
                  <YAxis type="category" dataKey="stage" tick={{ fill: COLORS.text, fontSize: ui.sizes.sm, fontFamily: FONT }} width={75} />
                  <Tooltip content={<CustomTooltip />} cursor={BAR_CURSOR} />
                  <Bar dataKey="delta" name="δ*" radius={[0, 4, 4, 0]}>
                    {Object.entries(gameTheoretic.per_stage_discounts).map(([, ], idx) => (
                      <Cell key={idx} fill={STAGE_COLORS[idx % STAGE_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Continuation values table */}
          {gameTheoretic.per_stage_continuation_values && (
            <div>
              <div style={{
                fontSize: ui.sizes.sm, color: COLORS.textMuted, fontWeight: 700,
                textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: ui.space.md,
              }}>Continuation Values by Stage</div>
              <div style={{ overflowX: 'auto' }}>
                <table style={TABLE_STYLE}>
                  <thead>
                    <tr>
                      <th style={{ ...TH_STYLE, textAlign: 'left' }}>Stage</th>
                      <th style={TH_STYLE}>V_C (Claimant) ₹Cr</th>
                      <th style={TH_STYLE}>V_R (Respondent) ₹Cr</th>
                      <th style={TH_STYLE}>δ*</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(gameTheoretic.per_stage_continuation_values).map(([stage, vals], i) => {
                      const delta = gameTheoretic.per_stage_discounts?.[stage];
                      return (
                        <tr key={stage} style={{ background: i % 2 === 0 ? 'transparent' : '#ffffff03' }}>
                          <td style={{ ...TD_LEFT, color: STAGE_COLORS[i % STAGE_COLORS.length] }}>{stage}</td>
                          <td style={TD_STYLE}>{fmtCr(vals.v_claimant_cr)}</td>
                          <td style={TD_STYLE}>{fmtCr(vals.v_respondent_cr)}</td>
                          <td style={{ ...TD_STYLE, color: COLORS.accent2, fontWeight: 700 }}>
                            {delta != null ? delta.toFixed(3) : '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
