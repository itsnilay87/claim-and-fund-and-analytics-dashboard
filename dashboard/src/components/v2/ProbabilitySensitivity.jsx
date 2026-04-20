/**
 * ProbabilitySensitivity.jsx — Probability Shift Sensitivity Analysis.
 *
 * Visualises how shifting key probability parameters affects investment metrics.
 * Four shift categories: arb_win, court, quantum, combined.
 * Uses analytical reweighting — no re-simulation needed.
 *
 * Sections:
 *   1. Category selector + Deal point selector
 *   2. Sensitivity curves (E[MOIC], P(loss), P(recovery) vs δ)
 *   3. Tornado chart (which category matters most)
 *   4. Per-claim sensitivity table
 *   5. Shifted probability detail panel
 */

import React, { useState, useMemo } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, BarChart, Bar, Cell, ReferenceLine, Legend,
} from 'recharts';
import { COLORS, FONT, SIZES, SPACE, useUISettings, fmtPct, fmtMOIC } from '../theme';
import { Card, SectionTitle, KPI, Divider } from './Shared';
import { getClaimDisplayName } from '../../utils/claimNames';


/* ═══════════════════════════════════════════════════════════
 * Constants
 * ═══════════════════════════════════════════════════════════ */

const CATEGORY_META = {
  arb_win:  { label: 'Arbitration Win Prob',  color: COLORS.accent1, desc: 'Shift P(arb win) and P(re-arb win) by δ' },
  court:    { label: 'Court Probabilities',    color: COLORS.accent2, desc: 'Shift all favorable court-node probs by δ' },
  quantum:  { label: 'Quantum Distribution',   color: COLORS.accent3, desc: 'Tilt quantum band mass toward higher/lower bands' },
  combined: { label: 'Combined (All Three)',   color: COLORS.accent4, desc: 'Shift all probability parameters simultaneously' },
};

const METRIC_OPTIONS = [
  { id: 'e_moic',     label: 'E[MOIC]',       format: v => v?.toFixed(2) + 'x' || '—' },
  { id: 'p_loss',     label: 'P(Loss)',        format: v => (v * 100).toFixed(1) + '%' },
  { id: 'p_recovery', label: 'P(Recovery)',    format: v => (v * 100).toFixed(1) + '%' },
  { id: 'e_collected', label: 'E[Collected] ₹Cr', format: v => v?.toFixed(0) || '—' },
];


/* ═══════════════════════════════════════════════════════════
 * Helper: extract chart data from sensitivity results
 * ═══════════════════════════════════════════════════════════ */

function buildCurveData(results, dealKey, metric) {
  const categories = ['arb_win', 'court', 'quantum', 'combined'];
  const dataByDelta = {};

  for (const r of results) {
    const delta = r.delta;
    if (!dataByDelta[delta]) dataByDelta[delta] = { delta, label: `${delta >= 0 ? '+' : ''}${(delta * 100).toFixed(0)}%` };

    let value;
    if (metric === 'p_recovery') {
      value = r.portfolio?.p_recovery;
    } else if (metric === 'e_collected') {
      value = r.portfolio?.e_collected_cr;
    } else {
      value = r.portfolio?.deals?.[dealKey]?.[metric];
    }
    dataByDelta[delta][r.category] = value;
  }

  return Object.values(dataByDelta).sort((a, b) => a.delta - b.delta);
}

function buildPerClaimTable(results, dealKey, claims) {
  // At delta=0 (base) vs delta=±0.15 for combined category
  const base = results.find(r => r.category === 'combined' && r.delta === 0);
  const pessimistic = results.find(r => r.category === 'combined' && r.delta === -0.15);
  const optimistic = results.find(r => r.category === 'combined' && r.delta === 0.15);

  if (!base || !pessimistic || !optimistic) return [];

  const claimIds = claims?.map(c => c.claim_id) || Object.keys(base.per_claim || {});
  return claimIds.map(cid => ({
    claim_id: cid,
    base_moic: base.per_claim?.[cid]?.deals?.[dealKey]?.e_moic,
    pess_moic: pessimistic.per_claim?.[cid]?.deals?.[dealKey]?.e_moic,
    opt_moic: optimistic.per_claim?.[cid]?.deals?.[dealKey]?.e_moic,
    base_ploss: base.per_claim?.[cid]?.deals?.[dealKey]?.p_loss,
    pess_ploss: pessimistic.per_claim?.[cid]?.deals?.[dealKey]?.p_loss,
    opt_ploss: optimistic.per_claim?.[cid]?.deals?.[dealKey]?.p_loss,
    base_recovery: base.per_claim?.[cid]?.p_recovery,
    pess_recovery: pessimistic.per_claim?.[cid]?.p_recovery,
    opt_recovery: optimistic.per_claim?.[cid]?.p_recovery,
  }));
}


/* ═══════════════════════════════════════════════════════════
 * Custom Tooltip
 * ═══════════════════════════════════════════════════════════ */

function SensTooltip({ active, payload, label, metric }) {
  if (!active || !payload?.length) return null;
  const fmt = METRIC_OPTIONS.find(m => m.id === metric)?.format || (v => v?.toFixed(3));
  return (
    <div style={{
      background: '#1a1f2e', border: `1px solid ${COLORS.cardBorder}`,
      borderRadius: 8, padding: 12, fontFamily: FONT, fontSize: 13,
    }}>
      <div style={{ color: COLORS.textMuted, fontWeight: 700, marginBottom: 6 }}>
        δ = {label}
      </div>
      {payload.map((entry, i) => (
        <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 3 }}>
          <div style={{ width: 10, height: 10, borderRadius: 5, background: entry.color, flexShrink: 0 }} />
          <span style={{ color: COLORS.textMuted, minWidth: 120 }}>{CATEGORY_META[entry.dataKey]?.label || entry.dataKey}:</span>
          <span style={{ color: COLORS.text, fontWeight: 600 }}>{fmt(entry.value)}</span>
        </div>
      ))}
    </div>
  );
}


/* ═══════════════════════════════════════════════════════════
 * Main Component
 * ═══════════════════════════════════════════════════════════ */

export default function ProbabilitySensitivity({ data }) {
  const { ui } = useUISettings();
  const sensitivity = data?.probability_sensitivity;

  const [selectedDeal, setSelectedDeal] = useState(0);
  const [selectedMetric, setSelectedMetric] = useState('e_moic');
  const [selectedCategory, setSelectedCategory] = useState('combined');

  if (!sensitivity) {
    return (
      <Card style={{ padding: 40, textAlign: 'center' }}>
        <h3 style={{ color: COLORS.textMuted }}>Probability Sensitivity Not Available</h3>
        <p style={{ color: COLORS.textMuted, fontSize: ui.sizes.sm }}>
          Re-run the simulation to generate probability sensitivity data.
        </p>
      </Card>
    );
  }

  const { results, tornado, reference_deals, base_probabilities, shift_levels } = sensitivity;
  const dealMeta = reference_deals?.[selectedDeal] || reference_deals?.[0];
  const dealKey = dealMeta?.key || '10_30';

  // Build chart data
  const curveData = useMemo(
    () => buildCurveData(results, dealKey, selectedMetric),
    [results, dealKey, selectedMetric]
  );

  const perClaimData = useMemo(
    () => buildPerClaimTable(results, dealKey, data?.claims),
    [results, dealKey, data?.claims]
  );

  const claimNameMap = useMemo(() => {
    const map = {};
    (data?.claims || []).forEach(c => { map[c.claim_id] = getClaimDisplayName(c); });
    return map;
  }, [data?.claims]);

  // Category-specific curve for the selected single category
  const singleCurve = useMemo(() => {
    return results
      .filter(r => r.category === selectedCategory)
      .sort((a, b) => a.delta - b.delta)
      .map(r => ({
        delta: r.delta,
        label: `${r.delta >= 0 ? '+' : ''}${(r.delta * 100).toFixed(0)}%`,
        e_moic: r.portfolio?.deals?.[dealKey]?.e_moic,
        p_loss: r.portfolio?.deals?.[dealKey]?.p_loss,
        p_recovery: r.portfolio?.p_recovery,
        arb_win: r.shifted_params?.arb_win_prob,
        eq_pct: r.shifted_params?.e_q_win_pct,
      }));
  }, [results, selectedCategory, dealKey]);

  // Base values for reference
  const baseResult = results.find(r => r.category === 'combined' && r.delta === 0);
  const baseMOIC = baseResult?.portfolio?.deals?.[dealKey]?.e_moic;
  const basePLoss = baseResult?.portfolio?.deals?.[dealKey]?.p_loss;
  const baseRecovery = baseResult?.portfolio?.p_recovery;

  return (
    <div>
      <SectionTitle
        number="S"
        title="Probability Sensitivity Analysis"
        subtitle="How shifting key probability parameters affects investment metrics — analytical reweighting, no re-simulation"
      />

      {/* ─── Control Bar ─── */}
      <Card style={{ marginBottom: ui.space.xl, padding: ui.space.lg }}>
        <div style={{ display: 'flex', gap: ui.space.xl, flexWrap: 'wrap', alignItems: 'center' }}>
          {/* Deal selector */}
          <div>
            <div style={{ color: COLORS.textMuted, fontSize: ui.sizes.xs, fontWeight: 700, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Reference Deal
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              {reference_deals?.map((d, i) => (
                <button key={i} onClick={() => setSelectedDeal(i)} style={{
                  padding: '6px 14px', borderRadius: 6, border: 'none', cursor: 'pointer',
                  fontFamily: FONT, fontSize: ui.sizes.sm, fontWeight: selectedDeal === i ? 700 : 500,
                  color: selectedDeal === i ? '#fff' : COLORS.textMuted,
                  background: selectedDeal === i ? COLORS.accent1 : COLORS.card,
                  transition: 'all 0.2s',
                }}>
                  {d.label}
                </button>
              ))}
            </div>
          </div>

          {/* Metric selector */}
          <div>
            <div style={{ color: COLORS.textMuted, fontSize: ui.sizes.xs, fontWeight: 700, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Metric
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              {METRIC_OPTIONS.map(m => (
                <button key={m.id} onClick={() => setSelectedMetric(m.id)} style={{
                  padding: '6px 14px', borderRadius: 6, border: 'none', cursor: 'pointer',
                  fontFamily: FONT, fontSize: ui.sizes.sm, fontWeight: selectedMetric === m.id ? 700 : 500,
                  color: selectedMetric === m.id ? '#fff' : COLORS.textMuted,
                  background: selectedMetric === m.id ? COLORS.accent2 : COLORS.card,
                  transition: 'all 0.2s',
                }}>
                  {m.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </Card>

      {/* ─── KPI Row: base values ─── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: ui.space.lg, marginBottom: ui.space.xl }}>
        <KPI label="Base E[MOIC]" value={baseMOIC?.toFixed(2) + 'x'} color={COLORS.accent1} />
        <KPI label="Base P(Loss)" value={(basePLoss * 100)?.toFixed(1) + '%'} color={COLORS.accent5} />
        <KPI label="Base P(Recovery)" value={(baseRecovery * 100)?.toFixed(1) + '%'} color={COLORS.accent4} />
        <KPI label="E[Q|WIN]" value={(base_probabilities?.e_q_win_pct * 100)?.toFixed(1) + '%'} color={COLORS.accent3} />
      </div>

      {/* ─── Section 1: All Categories Comparison ─── */}
      <Card style={{ marginBottom: ui.space.xl }}>
        <h4 style={{ color: COLORS.textBright, fontSize: ui.sizes.lg, fontWeight: 700, margin: `0 0 ${ui.space.md}px` }}>
          Sensitivity Curves — All Categories
        </h4>
        <p style={{ color: COLORS.textMuted, fontSize: ui.sizes.sm, margin: `0 0 ${ui.space.lg}px` }}>
          {METRIC_OPTIONS.find(m => m.id === selectedMetric)?.label} vs probability shift (δ) at {dealMeta?.label} deal
        </p>
        <ResponsiveContainer width="100%" height={360}>
          <LineChart data={curveData} margin={{ top: 10, right: 30, left: 10, bottom: 10 }}>
            <CartesianGrid stroke={COLORS.gridLine} strokeDasharray="3 3" />
            <XAxis
              dataKey="label"
              tick={{ fill: COLORS.textMuted, fontSize: 12 }}
              axisLine={{ stroke: COLORS.gridLine }}
            />
            <YAxis
              tick={{ fill: COLORS.textMuted, fontSize: 12 }}
              axisLine={{ stroke: COLORS.gridLine }}
              tickFormatter={v => selectedMetric === 'e_moic' ? v.toFixed(1) + 'x' :
                selectedMetric === 'e_collected' ? Math.round(v) :
                (v * 100).toFixed(0) + '%'}
            />
            <Tooltip cursor={{ fill: 'rgba(6,182,212,0.06)' }} content={<SensTooltip metric={selectedMetric} />} />
            <ReferenceLine x="+0%" stroke={COLORS.textMuted} strokeDasharray="4 4" label={{ value: 'Base', fill: COLORS.textMuted, fontSize: 11 }} />
            {Object.entries(CATEGORY_META).map(([key, meta]) => (
              <Line
                key={key}
                type="monotone"
                dataKey={key}
                stroke={meta.color}
                strokeWidth={key === 'combined' ? 3 : 2}
                dot={{ r: key === 'combined' ? 4 : 3, fill: meta.color }}
                name={meta.label}
                connectNulls
              />
            ))}
            <Legend
              wrapperStyle={{ fontSize: 12, fontFamily: FONT, color: COLORS.textMuted }}
              formatter={(value) => <span style={{ color: COLORS.textMuted }}>{CATEGORY_META[value]?.label || value}</span>}
            />
          </LineChart>
        </ResponsiveContainer>
      </Card>

      {/* ─── Section 2: Tornado Chart ─── */}
      {tornado && (
        <Card style={{ marginBottom: ui.space.xl }}>
          <h4 style={{ color: COLORS.textBright, fontSize: ui.sizes.lg, fontWeight: 700, margin: `0 0 ${ui.space.md}px` }}>
            Tornado Chart — E[MOIC] Impact at {dealMeta?.label}
          </h4>
          <p style={{ color: COLORS.textMuted, fontSize: ui.sizes.sm, margin: `0 0 ${ui.space.lg}px` }}>
            Range of E[MOIC] when each category is shifted from {(shift_levels?.[0] * 100).toFixed(0)}% to +{(shift_levels?.[shift_levels.length - 1] * 100).toFixed(0)}%. Wider bar = more impactful.
          </p>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart
              data={tornado.bars}
              layout="vertical"
              margin={{ top: 10, right: 40, left: 140, bottom: 10 }}
            >
              <CartesianGrid stroke={COLORS.gridLine} strokeDasharray="3 3" horizontal={false} />
              <XAxis
                type="number"
                tick={{ fill: COLORS.textMuted, fontSize: 12 }}
                tickFormatter={v => v.toFixed(1) + 'x'}
                domain={['auto', 'auto']}
              />
              <YAxis
                type="category"
                dataKey="category"
                tick={{ fill: COLORS.text, fontSize: 13, fontWeight: 600 }}
                tickFormatter={cat => CATEGORY_META[cat]?.label || cat}
                width={130}
              />
              <Tooltip cursor={{ fill: 'rgba(6,182,212,0.06)' }}
                formatter={(v, name) => [v.toFixed(2) + 'x', name === 'low_moic' ? 'Pessimistic' : 'Optimistic']}
                contentStyle={{ background: '#1a1f2e', border: `1px solid ${COLORS.cardBorder}`, borderRadius: 8, fontFamily: FONT, fontSize: 13 }}
                labelStyle={{ color: COLORS.textBright, fontWeight: 700 }}
                itemStyle={{ color: COLORS.text }}
              />
              <ReferenceLine x={tornado.base_e_moic} stroke={COLORS.accent3} strokeDasharray="4 4" strokeWidth={2}
                label={{ value: `Base: ${tornado.base_e_moic?.toFixed(2)}x`, fill: COLORS.accent3, fontSize: 12, position: 'top' }}
              />
              <Bar dataKey="low_moic" fill={COLORS.accent5} name="Pessimistic" barSize={24} radius={[4, 0, 0, 4]}>
                {tornado.bars.map((_, i) => <Cell key={i} fill={COLORS.accent5 + 'CC'} />)}
              </Bar>
              <Bar dataKey="high_moic" fill={COLORS.accent4} name="Optimistic" barSize={24} radius={[0, 4, 4, 0]}>
                {tornado.bars.map((_, i) => <Cell key={i} fill={COLORS.accent4 + 'CC'} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <div style={{ display: 'flex', gap: ui.space.xl, justifyContent: 'center', marginTop: ui.space.md }}>
            {tornado.bars.map(bar => (
              <div key={bar.category} style={{ textAlign: 'center' }}>
                <div style={{ color: CATEGORY_META[bar.category]?.color, fontWeight: 700, fontSize: ui.sizes.sm }}>
                  {CATEGORY_META[bar.category]?.label}
                </div>
                <div style={{ color: COLORS.textMuted, fontSize: ui.sizes.xs }}>
                  Range: {bar.range?.toFixed(2)}x ({bar.low_moic?.toFixed(2)}x → {bar.high_moic?.toFixed(2)}x)
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* ─── Section 3: Single Category Deep Dive ─── */}
      <Card style={{ marginBottom: ui.space.xl }}>
        <h4 style={{ color: COLORS.textBright, fontSize: ui.sizes.lg, fontWeight: 700, margin: `0 0 ${ui.space.md}px` }}>
          Category Deep Dive
        </h4>
        <div style={{ display: 'flex', gap: 8, marginBottom: ui.space.lg }}>
          {Object.entries(CATEGORY_META).map(([key, meta]) => (
            <button key={key} onClick={() => setSelectedCategory(key)} style={{
              padding: '8px 16px', borderRadius: 8, border: `2px solid ${selectedCategory === key ? meta.color : 'transparent'}`,
              cursor: 'pointer', fontFamily: FONT, fontSize: ui.sizes.sm, fontWeight: 600,
              color: selectedCategory === key ? '#fff' : COLORS.textMuted,
              background: selectedCategory === key ? meta.color + '30' : COLORS.card,
              transition: 'all 0.2s',
            }}>
              {meta.label}
            </button>
          ))}
        </div>
        <p style={{ color: COLORS.textMuted, fontSize: ui.sizes.sm, margin: `0 0 ${ui.space.md}px` }}>
          {CATEGORY_META[selectedCategory]?.desc}
        </p>

        {/* Dual metric chart */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: ui.space.lg }}>
          <div>
            <div style={{ color: COLORS.textMuted, fontSize: ui.sizes.xs, fontWeight: 700, marginBottom: 8, textTransform: 'uppercase' }}>
              E[MOIC] vs Shift
            </div>
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={singleCurve} margin={{ top: 10, right: 20, left: 10, bottom: 10 }}>
                <CartesianGrid stroke={COLORS.gridLine} strokeDasharray="3 3" />
                <XAxis dataKey="label" tick={{ fill: COLORS.textMuted, fontSize: 11 }} />
                <YAxis tick={{ fill: COLORS.textMuted, fontSize: 11 }} tickFormatter={v => v?.toFixed(1) + 'x'} />
                <Line type="monotone" dataKey="e_moic" stroke={CATEGORY_META[selectedCategory]?.color}
                  strokeWidth={2.5} dot={{ r: 4, fill: CATEGORY_META[selectedCategory]?.color }} />
                <ReferenceLine y={1.0} stroke={COLORS.accent5} strokeDasharray="4 4"
                  label={{ value: 'Breakeven', fill: COLORS.accent5, fontSize: 11, position: 'right' }} />
                <Tooltip cursor={{ fill: 'rgba(6,182,212,0.06)' }}
                  formatter={v => [v?.toFixed(3) + 'x', 'E[MOIC]']}
                  contentStyle={{ background: '#1a1f2e', border: `1px solid ${COLORS.cardBorder}`, borderRadius: 8, fontFamily: FONT }}
                  labelStyle={{ color: COLORS.textBright, fontWeight: 700 }}
                  itemStyle={{ color: COLORS.text }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div>
            <div style={{ color: COLORS.textMuted, fontSize: ui.sizes.xs, fontWeight: 700, marginBottom: 8, textTransform: 'uppercase' }}>
              P(Loss) vs Shift
            </div>
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={singleCurve} margin={{ top: 10, right: 20, left: 10, bottom: 10 }}>
                <CartesianGrid stroke={COLORS.gridLine} strokeDasharray="3 3" />
                <XAxis dataKey="label" tick={{ fill: COLORS.textMuted, fontSize: 11 }} />
                <YAxis tick={{ fill: COLORS.textMuted, fontSize: 11 }} tickFormatter={v => (v * 100)?.toFixed(0) + '%'}
                  domain={[0, 'auto']} />
                <Line type="monotone" dataKey="p_loss" stroke={COLORS.accent5}
                  strokeWidth={2.5} dot={{ r: 4, fill: COLORS.accent5 }} />
                <ReferenceLine y={0.5} stroke={COLORS.accent3} strokeDasharray="4 4"
                  label={{ value: '50%', fill: COLORS.accent3, fontSize: 11, position: 'right' }} />
                <Tooltip cursor={{ fill: 'rgba(6,182,212,0.06)' }}
                  formatter={v => [(v * 100)?.toFixed(1) + '%', 'P(Loss)']}
                  contentStyle={{ background: '#1a1f2e', border: `1px solid ${COLORS.cardBorder}`, borderRadius: 8, fontFamily: FONT }}
                  labelStyle={{ color: COLORS.textBright, fontWeight: 700 }}
                  itemStyle={{ color: COLORS.text }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </Card>

      {/* ─── Section 4: Per-Claim Sensitivity Table ─── */}
      <Card style={{ marginBottom: ui.space.xl }}>
        <h4 style={{ color: COLORS.textBright, fontSize: ui.sizes.lg, fontWeight: 700, margin: `0 0 ${ui.space.md}px` }}>
          Per-Claim Sensitivity — Combined Shift at {dealMeta?.label}
        </h4>
        <p style={{ color: COLORS.textMuted, fontSize: ui.sizes.sm, margin: `0 0 ${ui.space.lg}px` }}>
          Comparison of base case vs pessimistic (δ=−15%) and optimistic (δ=+15%) combined shifts
        </p>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: FONT, fontSize: ui.sizes.sm }}>
            <thead>
              <tr style={{ borderBottom: `2px solid ${COLORS.cardBorder}` }}>
                <th style={{ ...thStyle, textAlign: 'left' }}>Claim</th>
                <th style={thStyle} colSpan={3}>E[MOIC]</th>
                <th style={thStyle} colSpan={3}>P(Loss)</th>
                <th style={thStyle} colSpan={3}>P(Recovery)</th>
              </tr>
              <tr style={{ borderBottom: `1px solid ${COLORS.cardBorder}` }}>
                <th style={{ ...thSubStyle }}></th>
                {['Pessimistic', 'Base', 'Optimistic'].map(l => (
                  <th key={l + '1'} style={{ ...thSubStyle, color: l === 'Pessimistic' ? COLORS.accent5 : l === 'Optimistic' ? COLORS.accent4 : COLORS.text }}>
                    {l}
                  </th>
                ))}
                {['Pessimistic', 'Base', 'Optimistic'].map(l => (
                  <th key={l + '2'} style={{ ...thSubStyle, color: l === 'Pessimistic' ? COLORS.accent5 : l === 'Optimistic' ? COLORS.accent4 : COLORS.text }}>
                    {l}
                  </th>
                ))}
                {['Pessimistic', 'Base', 'Optimistic'].map(l => (
                  <th key={l + '3'} style={{ ...thSubStyle, color: l === 'Pessimistic' ? COLORS.accent5 : l === 'Optimistic' ? COLORS.accent4 : COLORS.text }}>
                    {l}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {perClaimData.map((row, i) => (
                <tr key={row.claim_id} style={{ borderBottom: `1px solid ${COLORS.cardBorder}20` }}>
                  <td style={{ ...tdStyle, fontWeight: 700, color: COLORS.accent1 }}>{claimNameMap[row.claim_id] || row.claim_id}</td>
                  <td style={{ ...tdStyle, color: moicColor(row.pess_moic) }}>{row.pess_moic?.toFixed(2)}x</td>
                  <td style={{ ...tdStyle, fontWeight: 700 }}>{row.base_moic?.toFixed(2)}x</td>
                  <td style={{ ...tdStyle, color: moicColor(row.opt_moic) }}>{row.opt_moic?.toFixed(2)}x</td>
                  <td style={{ ...tdStyle, color: plossColor(row.pess_ploss) }}>{(row.pess_ploss * 100)?.toFixed(1)}%</td>
                  <td style={{ ...tdStyle, fontWeight: 700 }}>{(row.base_ploss * 100)?.toFixed(1)}%</td>
                  <td style={{ ...tdStyle, color: plossColor(row.opt_ploss) }}>{(row.opt_ploss * 100)?.toFixed(1)}%</td>
                  <td style={{ ...tdStyle, color: recovColor(row.pess_recovery) }}>{(row.pess_recovery * 100)?.toFixed(1)}%</td>
                  <td style={{ ...tdStyle, fontWeight: 700 }}>{(row.base_recovery * 100)?.toFixed(1)}%</td>
                  <td style={{ ...tdStyle, color: recovColor(row.opt_recovery) }}>{(row.opt_recovery * 100)?.toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* ─── Section 5: Shifted Parameters Panel ─── */}
      <Card>
        <h4 style={{ color: COLORS.textBright, fontSize: ui.sizes.lg, fontWeight: 700, margin: `0 0 ${ui.space.md}px` }}>
          Shifted Probability Parameters
        </h4>
        <p style={{ color: COLORS.textMuted, fontSize: ui.sizes.sm, margin: `0 0 ${ui.space.lg}px` }}>
          Key probability values at each shift level for the selected category
        </p>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: FONT, fontSize: ui.sizes.xs }}>
            <thead>
              <tr style={{ borderBottom: `2px solid ${COLORS.cardBorder}` }}>
                <th style={thStyle}>δ</th>
                <th style={thStyle}>P(Arb Win)</th>
                <th style={thStyle}>E[Q|WIN]</th>
                <th style={thStyle}>Dom A P(TW)</th>
                <th style={thStyle}>Dom B P(RST)</th>
                <th style={thStyle}>SIAC A P(TW)</th>
                <th style={thStyle}>SIAC B P(RST)</th>
              </tr>
            </thead>
            <tbody>
              {singleCurve.map((row, i) => {
                const res = results.find(r => r.category === selectedCategory && r.delta === row.delta);
                const sp = res?.shifted_params;
                const isBase = row.delta === 0;
                return (
                  <tr key={i} style={{
                    borderBottom: `1px solid ${COLORS.cardBorder}20`,
                    background: isBase ? COLORS.accent1 + '10' : 'transparent',
                    fontWeight: isBase ? 700 : 400,
                  }}>
                    <td style={tdStyle}>{row.label}</td>
                    <td style={tdStyle}>{(sp?.arb_win_prob * 100)?.toFixed(1)}%</td>
                    <td style={tdStyle}>{(sp?.e_q_win_pct * 100)?.toFixed(1)}%</td>
                    <td style={tdStyle}>{(sp?.dom_a_tw * 100)?.toFixed(1)}%</td>
                    <td style={tdStyle}>{(sp?.dom_b_restart * 100)?.toFixed(1)}%</td>
                    <td style={tdStyle}>{(sp?.siac_a_tw * 100)?.toFixed(1)}%</td>
                    <td style={tdStyle}>{(sp?.siac_b_restart * 100)?.toFixed(1)}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
 * Table Styles
 * ═══════════════════════════════════════════════════════════ */

const thStyle = {
  padding: '10px 12px',
  color: COLORS.textMuted,
  fontWeight: 700,
  fontSize: 12,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  textAlign: 'center',
};

const thSubStyle = {
  padding: '6px 10px',
  fontWeight: 600,
  fontSize: 11,
  textAlign: 'center',
};

const tdStyle = {
  padding: '8px 12px',
  textAlign: 'center',
  color: COLORS.text,
};

function moicColor(v) {
  if (v == null) return COLORS.textMuted;
  if (v >= 2.0) return COLORS.accent4;
  if (v >= 1.0) return COLORS.accent1;
  return COLORS.accent5;
}

function plossColor(v) {
  if (v == null) return COLORS.textMuted;
  if (v <= 0.15) return COLORS.accent4;
  if (v <= 0.35) return COLORS.accent3;
  return COLORS.accent5;
}

function recovColor(v) {
  if (v == null) return COLORS.textMuted;
  if (v >= 0.7) return COLORS.accent4;
  if (v >= 0.4) return COLORS.accent3;
  return COLORS.accent5;
}
