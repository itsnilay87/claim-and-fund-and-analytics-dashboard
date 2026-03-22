/**
 * CashflowAnalysis.jsx — Detailed Expected Cashflow Analysis tab.
 *
 * Shows: Portfolio summary, per-claim E[Collected] breakdown, annual/quarterly
 * recovery timeline, value decomposition chain, distribution percentiles,
 * and investor scenario comparisons. All values in ₹ Crore.
 */

import React, { useState } from 'react';
import { COLORS, FONT, CHART_COLORS, fmtCr, fmtPct, fmtMOIC, fmtMo, getVerdictStyle, BAR_CURSOR } from '../theme';
import { Card, SectionTitle, KPI, CustomTooltip } from './Shared';
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend, Cell, ComposedChart, Area,
} from 'recharts';


/* ───────────────── Helpers ───────────────── */

const fmt = (v, dec = 2) => `₹${Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: dec, maximumFractionDigits: dec })} Cr`;
const fmtShort = (v) => `₹${Number(v || 0).toLocaleString('en-IN', { maximumFractionDigits: 1 })}`;
const pct = (v, dec = 1) => `${(Number(v || 0) * 100).toFixed(dec)}%`;

const CARD_STYLE = {
  marginBottom: 24,
};

const TABLE_STYLE = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: 12,
  fontFamily: FONT,
};

const TH_STYLE = {
  padding: '10px 12px',
  textAlign: 'center',
  color: '#fff',
  fontWeight: 700,
  fontSize: 11,
  background: 'linear-gradient(135deg, #1e3a5f 0%, #2563EB 100%)',
  borderBottom: `2px solid ${COLORS.accent1}`,
  whiteSpace: 'nowrap',
};

const TD_STYLE = {
  padding: '8px 12px',
  textAlign: 'right',
  color: COLORS.text,
  borderBottom: `1px solid ${COLORS.cardBorder}`,
  fontSize: 12,
};

const TD_LEFT = { ...TD_STYLE, textAlign: 'left', fontWeight: 600 };


/* ───────────────── Sub-Components ───────────────── */

function PortfolioSummaryKPIs({ summary }) {
  if (!summary) return null;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 24 }}>
      <KPI label="Total SOC" value={fmt(summary.total_soc_cr, 0)} color={COLORS.accent6} />
      <KPI label="E[Quantum]" value={fmt(summary.total_eq_cr, 1)} sub={pct(summary.eq_over_soc) + ' of SOC'} color={COLORS.accent1} />
      <KPI label="E[Collected]" value={fmt(summary.total_e_collected_cr, 1)} sub={pct(summary.collected_over_soc) + ' of SOC'} color={COLORS.accent4} />
      <KPI label="E[Legal Costs]" value={fmt(summary.total_e_legal_cr, 1)} color={COLORS.accent5} />
      <KPI label="E[Net Cashflow]" value={fmt(summary.total_e_net_cr, 1)} color={summary.total_e_net_cr >= 0 ? COLORS.accent4 : COLORS.accent5} />
      <KPI label="P(Win) avg" value={pct(summary.avg_win_rate)} color={COLORS.accent2} />
    </div>
  );
}


function PerClaimTable({ perClaim }) {
  if (!perClaim || perClaim.length === 0) return null;

  const totalSOC = perClaim.reduce((s, c) => s + c.soc_cr, 0);
  const totalEQ = perClaim.reduce((s, c) => s + c.eq_cr, 0);
  const totalCollected = perClaim.reduce((s, c) => s + c.e_collected_cr, 0);
  const totalLegal = perClaim.reduce((s, c) => s + c.e_legal_cr, 0);
  const totalNet = perClaim.reduce((s, c) => s + c.e_net_cr, 0);

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={TABLE_STYLE}>
        <thead>
          <tr>
            <th style={{ ...TH_STYLE, textAlign: 'left' }}>Claim</th>
            <th style={TH_STYLE}>SOC (₹ Cr)</th>
            <th style={TH_STYLE}>Jurisdiction</th>
            <th style={TH_STYLE}>E[Q] (₹ Cr)</th>
            <th style={TH_STYLE}>P(Win)</th>
            <th style={TH_STYLE}>E[Collected]</th>
            <th style={TH_STYLE}>P5</th>
            <th style={TH_STYLE}>P50</th>
            <th style={TH_STYLE}>P95</th>
            <th style={TH_STYLE}>E[Legal]</th>
            <th style={TH_STYLE}>E[Net]</th>
            <th style={TH_STYLE}>E[Dur] (mo)</th>
          </tr>
        </thead>
        <tbody>
          {perClaim.map((c, i) => (
            <tr key={c.claim_id} style={{ background: i % 2 === 0 ? 'transparent' : '#0d1321' }}>
              <td style={TD_LEFT}>{c.claim_id}</td>
              <td style={TD_STYLE}>{fmt(c.soc_cr, 1)}</td>
              <td style={{ ...TD_STYLE, textAlign: 'center', textTransform: 'uppercase', fontSize: 10 }}>
                <span style={{
                  padding: '2px 8px', borderRadius: 4, fontSize: 10,
                  background: c.jurisdiction === 'domestic' ? '#1e3a5f' : '#3b1f5e',
                  color: c.jurisdiction === 'domestic' ? COLORS.accent1 : COLORS.accent2,
                }}>
                  {c.jurisdiction}
                </span>
              </td>
              <td style={TD_STYLE}>{fmt(c.eq_cr, 1)}</td>
              <td style={{ ...TD_STYLE, color: c.win_rate >= 0.5 ? COLORS.accent4 : COLORS.accent5 }}>{pct(c.win_rate)}</td>
              <td style={{ ...TD_STYLE, fontWeight: 700, color: COLORS.accent4 }}>{fmt(c.e_collected_cr, 1)}</td>
              <td style={{ ...TD_STYLE, color: COLORS.textMuted, fontSize: 11 }}>{fmt(c.p5_collected_cr, 1)}</td>
              <td style={TD_STYLE}>{fmt(c.p50_collected_cr, 1)}</td>
              <td style={{ ...TD_STYLE, color: COLORS.accent4, fontSize: 11 }}>{fmt(c.p95_collected_cr, 1)}</td>
              <td style={{ ...TD_STYLE, color: COLORS.accent5 }}>{fmt(c.e_legal_cr, 2)}</td>
              <td style={{ ...TD_STYLE, fontWeight: 700, color: c.e_net_cr >= 0 ? COLORS.accent4 : COLORS.accent5 }}>
                {fmt(c.e_net_cr, 1)}
              </td>
              <td style={{ ...TD_STYLE, textAlign: 'center' }}>{c.e_duration_months?.toFixed(1)}</td>
            </tr>
          ))}
          {/* Portfolio totals row */}
          <tr style={{ background: '#1a2744', fontWeight: 700 }}>
            <td style={{ ...TD_LEFT, color: COLORS.accent1 }}>PORTFOLIO</td>
            <td style={{ ...TD_STYLE, fontWeight: 700 }}>{fmt(totalSOC, 1)}</td>
            <td style={{ ...TD_STYLE, textAlign: 'center' }}>—</td>
            <td style={{ ...TD_STYLE, fontWeight: 700 }}>{fmt(totalEQ, 1)}</td>
            <td style={TD_STYLE}>—</td>
            <td style={{ ...TD_STYLE, fontWeight: 700, color: COLORS.accent4 }}>{fmt(totalCollected, 1)}</td>
            <td style={TD_STYLE}>—</td>
            <td style={TD_STYLE}>—</td>
            <td style={TD_STYLE}>—</td>
            <td style={{ ...TD_STYLE, fontWeight: 700, color: COLORS.accent5 }}>{fmt(totalLegal, 1)}</td>
            <td style={{ ...TD_STYLE, fontWeight: 700, color: totalNet >= 0 ? COLORS.accent4 : COLORS.accent5 }}>
              {fmt(totalNet, 1)}
            </td>
            <td style={TD_STYLE}>—</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}


function AnnualTimelineChart({ timeline }) {
  if (!timeline || timeline.length === 0) return null;

  const chartData = timeline.map(t => ({
    year: `Year ${t.year}`,
    resolving: Number((t.pct_resolving * 100).toFixed(1)),
    cumulative: Number((t.pct_cumulative * 100).toFixed(1)),
    recovery: Number(t.e_recovery_cr),
    cumulRecovery: Number(t.cumul_recovery_cr),
    phase: t.phase,
  }));

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
      {/* Resolution % chart */}
      <div>
        <div style={{ fontSize: 12, fontWeight: 600, color: COLORS.textMuted, marginBottom: 12, textAlign: 'center' }}>
          Claims Resolution Timeline (%)
        </div>
        <ResponsiveContainer width="100%" height={280}>
          <ComposedChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke={COLORS.gridLine} />
            <XAxis dataKey="year" tick={{ fill: COLORS.textMuted, fontSize: 11 }} />
            <YAxis tick={{ fill: COLORS.textMuted, fontSize: 11 }} unit="%" />
            <Tooltip cursor={{ fill: 'rgba(6,182,212,0.06)' }}
              contentStyle={{ background: '#1F2937', border: `1px solid ${COLORS.cardBorder}`, borderRadius: 8, fontFamily: FONT }}
              labelStyle={{ color: COLORS.textBright, fontWeight: 700 }}
              itemStyle={{ color: COLORS.text }}
            />
            <Bar dataKey="resolving" name="This Year %" fill={COLORS.accent1} opacity={0.7} radius={[4, 4, 0, 0]} cursor={BAR_CURSOR} />
            <Line dataKey="cumulative" name="Cumulative %" stroke={COLORS.accent3} strokeWidth={2.5} dot={{ r: 4 }} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Recovery ₹ chart */}
      <div>
        <div style={{ fontSize: 12, fontWeight: 600, color: COLORS.textMuted, marginBottom: 12, textAlign: 'center' }}>
          Expected Recovery by Year (₹ Crore)
        </div>
        <ResponsiveContainer width="100%" height={280}>
          <ComposedChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke={COLORS.gridLine} />
            <XAxis dataKey="year" tick={{ fill: COLORS.textMuted, fontSize: 11 }} />
            <YAxis tick={{ fill: COLORS.textMuted, fontSize: 11 }} />
            <Tooltip cursor={{ fill: 'rgba(6,182,212,0.06)' }}
              contentStyle={{ background: '#1F2937', border: `1px solid ${COLORS.cardBorder}`, borderRadius: 8, fontFamily: FONT }}
              labelStyle={{ color: COLORS.textBright, fontWeight: 700 }}
              itemStyle={{ color: COLORS.text }}
              formatter={(v) => [`₹${Number(v).toLocaleString('en-IN', { maximumFractionDigits: 1 })} Cr`]}
            />
            <Bar dataKey="recovery" name="E[Recovery] this year" fill={COLORS.accent4} opacity={0.7} radius={[4, 4, 0, 0]} cursor={BAR_CURSOR} />
            <Line dataKey="cumulRecovery" name="Cumulative E[Recovery]" stroke={COLORS.accent3} strokeWidth={2.5} dot={{ r: 4 }} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}


function QuarterlyTable({ quarterly }) {
  if (!quarterly || quarterly.length === 0) return null;

  // Filter to non-trivial quarters
  const filtered = quarterly.filter(q => q.pct_resolving > 0.001 || q.e_recovery_cr > 0.01);

  if (filtered.length === 0) return <p style={{ color: COLORS.textMuted, fontSize: 12 }}>No recovery expected in first 6 years.</p>;

  return (
    <div style={{ overflowX: 'auto', maxHeight: 400, overflowY: 'auto' }}>
      <table style={TABLE_STYLE}>
        <thead>
          <tr>
            <th style={{ ...TH_STYLE, textAlign: 'left' }}>Quarter</th>
            <th style={TH_STYLE}>Month Range</th>
            <th style={TH_STYLE}>% Resolving</th>
            <th style={TH_STYLE}>E[Recovery] (₹ Cr)</th>
            <th style={TH_STYLE}>Running Total (₹ Cr)</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((q, i) => {
            const barWidth = Math.min(100, (q.pct_resolving * 100) / 0.15 * 100);
            return (
              <tr key={q.quarter} style={{ background: i % 2 === 0 ? 'transparent' : '#0d1321' }}>
                <td style={TD_LEFT}>Q{q.quarter}</td>
                <td style={{ ...TD_STYLE, textAlign: 'center', color: COLORS.textMuted }}>{q.label}</td>
                <td style={TD_STYLE}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8 }}>
                    <div style={{
                      width: 60, height: 6, background: '#1E293B', borderRadius: 3, overflow: 'hidden'
                    }}>
                      <div style={{
                        width: `${barWidth}%`, height: '100%',
                        background: COLORS.accent1, borderRadius: 3,
                      }} />
                    </div>
                    <span>{pct(q.pct_resolving)}</span>
                  </div>
                </td>
                <td style={{ ...TD_STYLE, color: q.e_recovery_cr > 10 ? COLORS.accent4 : COLORS.textMuted }}>
                  {fmt(q.e_recovery_cr, 1)}
                </td>
                <td style={{ ...TD_STYLE, fontWeight: 600 }}>{fmt(q.cumul_recovery_cr, 1)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}


function DecompositionChain({ decomposition }) {
  if (!decomposition || decomposition.length === 0) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      {decomposition.map((step, i) => {
        const isResult = step.step.includes('E[Collected]');
        const isLegal = step.step.includes('Legal');
        const bgColor = isResult ? '#10B98115' : (isLegal ? '#EF444415' : 'transparent');
        const borderColor = isResult ? COLORS.accent4 : (isLegal ? COLORS.accent5 : COLORS.cardBorder);

        return (
          <div key={i} style={{
            display: 'grid',
            gridTemplateColumns: '140px 1fr 100px 140px 1fr',
            gap: 0,
            padding: '12px 16px',
            background: bgColor,
            borderLeft: `3px solid ${borderColor}`,
            borderBottom: `1px solid ${COLORS.cardBorder}`,
            alignItems: 'center',
          }}>
            <div style={{
              fontSize: 13, fontWeight: 800,
              color: isResult ? COLORS.accent4 : (isLegal ? COLORS.accent5 : COLORS.accent1),
              fontFamily: FONT,
            }}>
              {step.step}
            </div>
            <div style={{ fontSize: 12, color: COLORS.text }}>{step.label}</div>
            <div style={{
              fontSize: 12, fontWeight: 600, textAlign: 'center',
              color: COLORS.accent3, fontFamily: 'monospace',
            }}>
              {step.factor}
            </div>
            <div style={{
              fontSize: 14, fontWeight: 700, textAlign: 'right',
              color: isResult ? COLORS.accent4 : (isLegal ? COLORS.accent5 : COLORS.textBright),
            }}>
              {fmt(step.value_cr, 1)}
            </div>
            <div style={{ fontSize: 11, color: COLORS.textMuted, paddingLeft: 16 }}>{step.note}</div>
          </div>
        );
      })}
    </div>
  );
}


function DistributionTable({ distribution }) {
  if (!distribution) return null;

  const percentiles = ['p1', 'p5', 'p10', 'p25', 'p50', 'p75', 'p90', 'p95', 'p99', 'mean'];
  const labels = { p1: 'P1 (worst)', p5: 'P5', p10: 'P10', p25: 'P25', p50: 'P50 (median)',
                   p75: 'P75', p90: 'P90', p95: 'P95', p99: 'P99 (best)', mean: 'Mean' };

  return (
    <table style={TABLE_STYLE}>
      <thead>
        <tr>
          <th style={{ ...TH_STYLE, textAlign: 'left' }}>Percentile</th>
          <th style={TH_STYLE}>Gross Collected (₹ Cr)</th>
          <th style={TH_STYLE}>Legal Costs (₹ Cr)</th>
          <th style={TH_STYLE}>Net Recovery (₹ Cr)</th>
          <th style={TH_STYLE}>Net / SOC</th>
        </tr>
      </thead>
      <tbody>
        {percentiles.map((key, i) => {
          const row = distribution[key];
          if (!row) return null;
          const isMean = key === 'mean';
          const netColor = row.net_cr < 0 ? COLORS.accent5 : (row.net_cr > 500 ? COLORS.accent4 : COLORS.text);
          return (
            <tr key={key} style={{
              background: isMean ? '#1a2744' : (i % 2 === 0 ? 'transparent' : '#0d1321'),
              fontWeight: isMean ? 700 : 400,
            }}>
              <td style={{ ...TD_LEFT, color: isMean ? COLORS.accent1 : COLORS.text }}>{labels[key] || key}</td>
              <td style={TD_STYLE}>{fmt(row.gross_cr, 1)}</td>
              <td style={{ ...TD_STYLE, color: COLORS.accent5 }}>{fmt(row.legal_cr, 2)}</td>
              <td style={{ ...TD_STYLE, fontWeight: 600, color: netColor }}>{fmt(row.net_cr, 1)}</td>
              <td style={{ ...TD_STYLE, color: netColor }}>{pct(row.net_over_soc)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}


function InvestorScenarios({ scenarios }) {
  if (!scenarios || scenarios.length === 0) return null;

  return (
    <table style={TABLE_STYLE}>
      <thead>
        <tr>
          <th style={{ ...TH_STYLE, textAlign: 'left' }}>Scenario</th>
          <th style={TH_STYLE}>Upfront (₹ Cr)</th>
          <th style={TH_STYLE}>Legal (₹ Cr)</th>
          <th style={TH_STYLE}>Total Inv (₹ Cr)</th>
          <th style={TH_STYLE}>E[Gross] (₹ Cr)</th>
          <th style={TH_STYLE}>E[Net] (₹ Cr)</th>
          <th style={TH_STYLE}>E[MOIC]</th>
          <th style={TH_STYLE}>P(Loss)</th>
          <th style={TH_STYLE}>Verdict</th>
        </tr>
      </thead>
      <tbody>
        {scenarios.map((s, i) => {
          const vs = getVerdictStyle(s.verdict);
          return (
            <tr key={s.label} style={{ background: i % 2 === 0 ? 'transparent' : '#0d1321' }}>
              <td style={TD_LEFT}>{s.label}</td>
              <td style={{ ...TD_STYLE, color: COLORS.accent6 }}>{fmt(s.upfront_cr, 1)}</td>
              <td style={{ ...TD_STYLE, color: COLORS.accent5 }}>{fmt(s.legal_costs_cr, 1)}</td>
              <td style={{ ...TD_STYLE, fontWeight: 700 }}>{fmt(s.total_investment_cr, 1)}</td>
              <td style={TD_STYLE}>{fmt(s.e_gross_recovery_cr, 1)}</td>
              <td style={{ ...TD_STYLE, fontWeight: 700, color: s.e_net_to_fund_cr >= 0 ? COLORS.accent4 : COLORS.accent5 }}>
                {fmt(s.e_net_to_fund_cr, 1)}
              </td>
              <td style={{ ...TD_STYLE, color: s.e_moic >= 2 ? COLORS.accent4 : (s.e_moic >= 1 ? COLORS.accent3 : COLORS.accent5) }}>
                {fmtMOIC(s.e_moic)}
              </td>
              <td style={{ ...TD_STYLE, color: s.p_loss < 0.1 ? COLORS.accent4 : (s.p_loss < 0.25 ? COLORS.accent3 : COLORS.accent5) }}>
                {pct(s.p_loss)}
              </td>
              <td style={{
                ...TD_STYLE, textAlign: 'center', fontWeight: 700, fontSize: 11,
                color: vs?.color || COLORS.text,
                background: vs?.bg || 'transparent',
                borderRadius: 4,
              }}>
                {s.verdict}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}


function PerClaimBarChart({ perClaim }) {
  if (!perClaim || perClaim.length === 0) return null;

  const chartData = perClaim.map(c => ({
    name: c.claim_id,
    soc: c.soc_cr,
    eq: c.eq_cr,
    collected: c.e_collected_cr,
    legal: c.e_legal_cr,
    net: c.e_net_cr,
  }));

  return (
    <ResponsiveContainer width="100%" height={320}>
      <BarChart data={chartData} barCategoryGap="20%">
        <CartesianGrid strokeDasharray="3 3" stroke={COLORS.gridLine} />
        <XAxis dataKey="name" tick={{ fill: COLORS.textMuted, fontSize: 11 }} />
        <YAxis tick={{ fill: COLORS.textMuted, fontSize: 11 }} />
        <Tooltip cursor={{ fill: 'rgba(6,182,212,0.06)' }}
          contentStyle={{ background: '#1F2937', border: `1px solid ${COLORS.cardBorder}`, borderRadius: 8, fontFamily: FONT }}
          labelStyle={{ color: COLORS.textBright, fontWeight: 700 }}
          itemStyle={{ color: COLORS.text }}
          formatter={(v) => [`₹${Number(v).toLocaleString('en-IN', { maximumFractionDigits: 1 })} Cr`]}
        />
        <Legend wrapperStyle={{ fontSize: 11, color: COLORS.textMuted }} />
        <Bar dataKey="soc" name="SOC" fill={COLORS.accent6} opacity={0.3} radius={[2, 2, 0, 0]} cursor={BAR_CURSOR} />
        <Bar dataKey="eq" name="E[Quantum]" fill={COLORS.accent1} opacity={0.6} radius={[2, 2, 0, 0]} cursor={BAR_CURSOR} />
        <Bar dataKey="collected" name="E[Collected]" fill={COLORS.accent4} radius={[2, 2, 0, 0]} cursor={BAR_CURSOR} />
        <Bar dataKey="legal" name="E[Legal]" fill={COLORS.accent5} opacity={0.7} radius={[2, 2, 0, 0]} cursor={BAR_CURSOR} />
      </BarChart>
    </ResponsiveContainer>
  );
}


/* ───────────────── Main Component ───────────────── */

export default function CashflowAnalysis({ data }) {
  const cf = data?.cashflow_analysis;
  const [showQuarterly, setShowQuarterly] = useState(false);

  if (!cf) {
    return (
      <Card style={CARD_STYLE}>
        <SectionTitle title="Cashflow Analysis" subtitle="No cashflow data available. Re-run simulation to generate." />
        <p style={{ color: COLORS.textMuted, fontSize: 13 }}>
          Run: <code style={{ color: COLORS.accent1 }}>python -m TATA_code_v2.v2_run --n 10000 --seed 42</code>
        </p>
      </Card>
    );
  }

  const { portfolio_summary, per_claim, distribution, annual_timeline, quarterly_timeline, decomposition, investor_scenarios } = cf;

  return (
    <div>
      {/* 1. Portfolio Summary KPIs */}
      <SectionTitle
        number="1"
        title="Portfolio Expected Cashflow Summary"
        subtitle="All values in ₹ Crore. MC simulation averages across all paths."
      />
      <Card style={CARD_STYLE}>
        <PortfolioSummaryKPIs summary={portfolio_summary} />

        {/* Quick context */}
        <div style={{
          padding: '12px 16px', background: '#111827', borderRadius: 8,
          border: `1px solid ${COLORS.cardBorder}`, fontSize: 12, lineHeight: 1.8,
          color: COLORS.textMuted,
        }}>
          <span style={{ color: COLORS.textBright, fontWeight: 600 }}>How E[Collected] is derived: </span>
          SOC (₹{portfolio_summary?.total_soc_cr?.toLocaleString('en-IN')} Cr)
          × P(arb win) = {pct(portfolio_summary?.arb_win_prob, 0)}
          × E[Q|WIN] = {pct(portfolio_summary?.eq_given_win)}
          × P(survive courts)
          → <span style={{ color: COLORS.accent4, fontWeight: 700 }}>E[Collected] = ₹{portfolio_summary?.total_e_collected_cr?.toLocaleString('en-IN', { maximumFractionDigits: 1 })} Cr</span>
          {' '}({pct(portfolio_summary?.collected_over_soc)} of SOC).
          {' '}There is <strong style={{ color: COLORS.accent5 }}>no separate collection efficiency layer</strong> — the probability tree outcomes determine whether the full quantum is collected (TRUE_WIN) or zero (LOSE).
        </div>
      </Card>

      {/* 2. Annual Resolution & Recovery Timeline */}
      <SectionTitle
        number="2"
        title="Annual Resolution & Recovery Timeline"
        subtitle="When do claims resolve? Expected recovery in ₹ Crore per year."
      />
      <Card style={CARD_STYLE}>
        <AnnualTimelineChart timeline={annual_timeline} />

        {/* Annual data table */}
        <div style={{ marginTop: 20, overflowX: 'auto' }}>
          <table style={TABLE_STYLE}>
            <thead>
              <tr>
                <th style={{ ...TH_STYLE, textAlign: 'left' }}>Year</th>
                <th style={TH_STYLE}>Month Range</th>
                <th style={TH_STYLE}>% Resolving</th>
                <th style={TH_STYLE}>Cumulative %</th>
                <th style={TH_STYLE}>E[Recovery] (₹ Cr)</th>
                <th style={TH_STYLE}>Cumul Recovery (₹ Cr)</th>
                <th style={TH_STYLE}>Phase</th>
              </tr>
            </thead>
            <tbody>
              {annual_timeline?.map((t, i) => (
                <tr key={t.year} style={{ background: i % 2 === 0 ? 'transparent' : '#0d1321' }}>
                  <td style={TD_LEFT}>Year {t.year}</td>
                  <td style={{ ...TD_STYLE, textAlign: 'center', color: COLORS.textMuted }}>{t.month_range}</td>
                  <td style={TD_STYLE}>{pct(t.pct_resolving)}</td>
                  <td style={{ ...TD_STYLE, fontWeight: 600 }}>{pct(t.pct_cumulative)}</td>
                  <td style={{ ...TD_STYLE, color: t.e_recovery_cr > 100 ? COLORS.accent4 : COLORS.textMuted }}>
                    {fmt(t.e_recovery_cr, 1)}
                  </td>
                  <td style={{ ...TD_STYLE, fontWeight: 700 }}>{fmt(t.cumul_recovery_cr, 1)}</td>
                  <td style={{
                    ...TD_STYLE, textAlign: 'center', fontSize: 10,
                    color: t.phase.includes('Arb') ? COLORS.accent1 : (t.phase.includes('Tail') ? COLORS.accent3 : COLORS.textMuted),
                  }}>
                    {t.phase}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* 3. Value Decomposition Chain */}
      <SectionTitle
        number="3"
        title="Value Decomposition: SOC → E[Collected]"
        subtitle="Step-by-step walkthrough showing how ₹5,144 Cr SOC becomes the expected collected amount."
      />
      <Card style={CARD_STYLE}>
        <DecompositionChain decomposition={decomposition} />
      </Card>

      {/* 4. Per-Claim Breakdown */}
      <SectionTitle
        number="4"
        title="Per-Claim Expected Cashflow Breakdown (₹ Crore)"
        subtitle="Individual claim economics. P5/P50/P95 = collected percentiles from MC simulation."
      />
      <Card style={CARD_STYLE}>
        <PerClaimTable perClaim={per_claim} />
      </Card>

      {/* 5. Per-Claim Visual */}
      <SectionTitle
        number="5"
        title="Claim-by-Claim: SOC → E[Q] → E[Collected] → E[Legal]"
        subtitle="Visual comparison of value erosion from SOC to net recovery per claim."
      />
      <Card style={CARD_STYLE}>
        <PerClaimBarChart perClaim={per_claim} />
      </Card>

      {/* 6. Quarterly Detail (collapsible) */}
      <SectionTitle
        number="6"
        title="Quarterly Recovery Distribution"
        subtitle="Granular quarterly view of when recovery occurs."
      />
      <Card style={CARD_STYLE}>
        <div
          onClick={() => setShowQuarterly(!showQuarterly)}
          style={{
            cursor: 'pointer', padding: '10px 16px', background: '#0d1321',
            borderRadius: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            marginBottom: showQuarterly ? 16 : 0,
          }}
        >
          <span style={{ fontSize: 12, fontWeight: 600, color: COLORS.accent1 }}>
            {showQuarterly ? '▼' : '▶'} Quarterly breakdown — {quarterly_timeline?.length || 0} quarters
          </span>
          <span style={{ fontSize: 10, color: COLORS.textMuted }}>Click to {showQuarterly ? 'collapse' : 'expand'}</span>
        </div>
        {showQuarterly && <QuarterlyTable quarterly={quarterly_timeline} />}
      </Card>

      {/* 7. Portfolio Distribution */}
      <SectionTitle
        number="7"
        title="Portfolio Recovery Distribution (₹ Crore)"
        subtitle="Percentile analysis across all MC paths. Gross = collected before legal costs. Net = after legal costs."
      />
      <Card style={CARD_STYLE}>
        <DistributionTable distribution={distribution} />
      </Card>

      {/* 8. Investor Scenarios */}
      <SectionTitle
        number="8"
        title="Investor Cashflow Under Key Structures"
        subtitle="How the fund performs under different upfront% / Tata tail% combinations. All ₹ Crore."
      />
      <Card style={CARD_STYLE}>
        <InvestorScenarios scenarios={investor_scenarios} />
      </Card>
    </div>
  );
}
