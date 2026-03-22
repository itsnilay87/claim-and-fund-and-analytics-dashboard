/**
 * ExecutiveSummary.jsx — Tab 1: Portfolio KPIs, SOC donut, J-Curve fan chart,
 * Distribution Explorer, claim cards, top scenarios.
 *
 * Changes: removed SOC bar chart (redundant with donut), added J-Curve fan
 * chart and compact Distribution Explorer for "shape of returns" at a glance.
 */

import React, { useState, useMemo } from 'react';
import {
  Tooltip, ResponsiveContainer, PieChart, Pie, Cell,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Legend, ReferenceLine,
} from 'recharts';
import { COLORS, FONT, CHART_COLORS, useUISettings, fmtCr, fmtPct, fmtMOIC, BAR_CURSOR } from '../theme';
import { Card, SectionTitle, KPI, CustomTooltip, Badge } from './Shared';
import JCurveFanChart from './JCurveFanChart';
import DistributionExplorer from './DistributionExplorer';

export default function ExecutiveSummary({ data, stochasticData }) {
  const { ui } = useUISettings();
  const { claims, simulation_meta } = data;
  const [showFormulas, setShowFormulas] = useState(false);

  /* ── Stochastic grid metadata ── */
  const stocMeta  = stochasticData?.meta || {};
  const stocGrid  = stochasticData?.grid || {};
  const tailOpts  = stocMeta.tail_grid  || [];
  const upOpts    = stocMeta.upfront_grid || [];

  /* ── Dropdown state ── */
  const [selectedTail, setSelectedTail] = useState(20);           // Plot 5 scenario table
  const [ccUpfront, setCcUpfront]       = useState(10);           // Plot 6 cross-claim
  const [ccTail, setCcTail]             = useState(20);           // Plot 6 cross-claim
  const [distUpfront, setDistUpfront]   = useState(upOpts[0] || 10);  // Plot 4 distributions
  const [distTail, setDistTail]         = useState(20);               // Plot 4 distributions

  /* derived grid key for Plot 4 */
  const distKey = useMemo(() => {
    const up = upOpts.includes(distUpfront) ? distUpfront : (upOpts[0] || 10);
    const tl = tailOpts.includes(distTail)  ? distTail   : (tailOpts[0] || 20);
    return `${up}_${tl}`;
  }, [distUpfront, distTail, upOpts, tailOpts]);

  const totalSOC = simulation_meta.total_soc_cr;
  const avgWinRate = claims.reduce((s, c) => s + c.win_rate, 0) / claims.length;
  const avgDuration = claims.reduce((s, c) => s + c.mean_duration_months, 0) / claims.length;

  // Aggregated portfolio metrics using CORRECT ANALYTICAL FORMULA
  const totalEQ = claims.reduce((s, c) => s + (c.expected_quantum_cr || 0), 0);
  const avgQuantum = totalEQ / (claims.length || 1);
  
  // ★★★ CORRECT FORMULA: E[Principal] = Σ(E[Q|Win]ᵢ × Win_Rateᵢ) ★★★
  const totalPrincipal = claims.reduce((s, c) => s + (c.expected_quantum_cr || 0) * (c.win_rate || 0), 0);
  const totalInterest = claims.reduce((s, c) => s + (c.interest_stats?.mean || 0), 0);
  const totalCollected = totalPrincipal + totalInterest;  // E[Collected] = E[Principal] + E[Interest]
  
  const totalLegal = claims.reduce((s, c) => s + (c.legal_cost_stats?.mean || 0), 0);
  const netRecovery = totalCollected - totalLegal;
  const recoveryRate = totalSOC > 0 ? totalCollected / totalSOC : 0;
  const eqToSOC = totalSOC > 0 ? totalEQ / totalSOC : 0;
  const principalToSOC = totalSOC > 0 ? totalPrincipal / totalSOC : 0;
  const legalRatio = totalCollected > 0 ? totalLegal / totalCollected : 0;
  const interestEnabled = simulation_meta?.interest_enabled;

  // Claim SOC pie data
  const pieData = claims.map((c, i) => ({
    name: c.claim_id.replace('TP-', ''),
    value: c.soc_value_cr,
    fill: CHART_COLORS[i % CHART_COLORS.length],
  }));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: ui.space.xl }}>
      {/* Calculation Flow Explanation */}
      <Card>
        <SectionTitle title="Portfolio Recovery Calculation" subtitle="How E[Collected] derives from claim-level E[Q|Win] × Win Rate" />
        <div style={{ padding: '12px 16px', borderRadius: 8, background: '#0c1622', border: `1px solid ${COLORS.accent2}40`, marginTop: 8 }}>
          <div 
            onClick={() => setShowFormulas(!showFormulas)}
            style={{ color: COLORS.accent2, fontSize: ui.sizes.sm, fontWeight: 700, marginBottom: showFormulas ? 8 : 0, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}
          >
            <span style={{ transition: 'transform 0.2s', transform: showFormulas ? 'rotate(90deg)' : 'rotate(0deg)' }}>▶</span>
            📐 ANALYTICAL FORMULA (Manually Verifiable) — Click to {showFormulas ? 'hide' : 'show'}
          </div>
          {showFormulas && <div style={{ color: COLORS.textMuted, fontSize: ui.sizes.xs, lineHeight: 1.8 }}>
            <div style={{ marginBottom: 8 }}>
              <strong style={{ color: COLORS.textBright }}>E[Principal]</strong> = Σ (E[Quantum|Win]ᵢ × Win_Rateᵢ) for each claim i
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 8 }}>
              {claims.map((c, i) => (
                <div key={i} style={{ background: '#111827', padding: '6px 10px', borderRadius: 6, fontSize: ui.sizes.xs }}>
                  <span style={{ color: COLORS.textBright, fontWeight: 600 }}>{c.claim_id}:</span>{' '}
                  <span style={{ color: COLORS.accent4 }}>{fmtCr(c.expected_quantum_cr)}</span>{' × '}
                  <span style={{ color: COLORS.accent2 }}>{fmtPct(c.win_rate)}</span>{' = '}
                  <span style={{ color: COLORS.accent3, fontWeight: 700 }}>{fmtCr((c.expected_quantum_cr || 0) * (c.win_rate || 0))}</span>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 12, padding: '8px 12px', background: '#111827', borderRadius: 6 }}>
              <strong style={{ color: COLORS.accent3 }}>Total E[Principal]</strong> = {claims.map(c => fmtCr((c.expected_quantum_cr || 0) * (c.win_rate || 0))).join(' + ')} = <strong style={{ color: COLORS.accent3 }}>{fmtCr(totalPrincipal)}</strong>
              {interestEnabled && totalInterest > 0 && (
                <><br /><strong style={{ color: COLORS.accent4 }}>+ E[Interest]</strong> = {fmtCr(totalInterest)}</>
              )}
              <br /><strong style={{ color: COLORS.accent6 }}>= E[Collected]</strong> = <strong style={{ color: COLORS.accent6 }}>{fmtCr(totalCollected)}</strong> ({fmtPct(recoveryRate)} of SOC)
              <br /><strong style={{ color: COLORS.accent5 }}>- E[Legal]</strong> = {fmtCr(totalLegal)}
              <br /><strong style={{ color: netRecovery >= 0 ? '#22C55E' : COLORS.accent5 }}>= E[Net Recovery]</strong> = <strong style={{ color: netRecovery >= 0 ? '#22C55E' : COLORS.accent5 }}>{fmtCr(netRecovery)}</strong>
            </div>
          </div>}
        </div>
      </Card>

      {/* KPI Row 1 — Value Chain: follow the money */}
      <div>
        <div style={{
          fontSize: ui.sizes.xs, color: COLORS.textMuted, textTransform: 'uppercase',
          letterSpacing: '0.08em', fontWeight: 700, marginBottom: ui.space.sm, paddingLeft: 4,
        }}>Portfolio Value Chain — SOC → E[Q|Win] → Principal → Collected → Net</div>
        <div style={{ display: 'grid', gridTemplateColumns: interestEnabled ? 'repeat(7, 1fr)' : 'repeat(6, 1fr)', gap: ui.space.md }}>
          <KPI label="Total SOC" value={fmtCr(totalSOC)} sub={`${claims.length} claims`} color={COLORS.accent1} />
          <KPI label="E[Quantum|Win]" value={fmtCr(totalEQ)} sub={`${fmtPct(eqToSOC)} of SOC`} color={COLORS.accent4} />
          <KPI label="Avg Win Rate" value={fmtPct(avgWinRate)} sub="simple avg" color={COLORS.accent2} />
          <KPI label="E[Principal]" value={fmtCr(totalPrincipal)} sub={`${fmtPct(principalToSOC)} of SOC`} color={COLORS.accent3} />
          {interestEnabled && (
            <KPI label="E[Interest]" value={fmtCr(totalInterest)} sub={`${fmtPct(totalInterest / totalSOC)} of SOC`} color={COLORS.accent4} />
          )}
          <KPI label="E[Collected]" value={fmtCr(totalCollected)} sub={`Principal + Interest`} color={COLORS.accent6} />
          <KPI label="E[Net Recovery]" value={fmtCr(netRecovery)} sub={`After ₹${totalLegal.toFixed(0)} Cr legal`} color={netRecovery >= 0 ? '#22C55E' : COLORS.accent5} />
        </div>
      </div>

      {/* KPI Row 2 — Performance & Risk Metrics */}
      <div>
        <div style={{
          fontSize: ui.sizes.xs, color: COLORS.textMuted, textTransform: 'uppercase',
          letterSpacing: '0.08em', fontWeight: 700, marginBottom: ui.space.sm, paddingLeft: 4,
        }}>Supporting Metrics</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: ui.space.md }}>
          <KPI label="Avg Quantum/Claim" value={fmtCr(avgQuantum)} sub={`Total E[Q|Win] ${fmtCr(totalEQ)}`} color={COLORS.accent4} />
          <KPI label="Avg Duration" value={`${avgDuration.toFixed(1)}m`} sub="Time to resolution" color={COLORS.accent3} />
          <KPI label="E[Legal Costs]" value={fmtCr(totalLegal)} sub={`${fmtPct(legalRatio)} of collected`} color={COLORS.accent5} />
          <KPI label="Recovery Rate" value={fmtPct(recoveryRate)} sub="E[Collected] / SOC" color={COLORS.accent6} />
        </div>
      </div>

      {/* SOC Donut + J-Curve Fan Chart */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: ui.space.lg }}>
        <Card>
          <SectionTitle number="1" title="SOC Distribution" subtitle="₹ Crore by claim" />
          <ResponsiveContainer width="100%" height={ui.chartHeight.sm}>
            <PieChart>
              <Pie
                data={pieData}
                cx="50%" cy="50%"
                innerRadius={55} outerRadius={90}
                paddingAngle={3}
                dataKey="value"
                label={({ name, value }) => `${name}: ₹${value.toFixed(0)}`}
                labelLine={{ stroke: COLORS.textMuted }}
              >
                {pieData.map((d, i) => <Cell key={i} fill={d.fill} />)}
              </Pie>
              <Tooltip cursor={{ fill: 'rgba(6,182,212,0.06)' }} content={<CustomTooltip />} />
            </PieChart>
          </ResponsiveContainer>
        </Card>

        <Card>
          <SectionTitle number="2" title="Cashflow J-Curve" subtitle="Cumulative portfolio cashflow — 10% upfront, 20% Tata tail" />
          <JCurveFanChart data={data} height={ui.chartHeight.sm} compact upfrontPct={0.10} tataTailPct={0.20} />
        </Card>
      </div>

      {/* Claim Cards — 2 rows × 3 columns right below the donut */}
      <Card>
        <SectionTitle number="3" title="Claim Overview" subtitle="Summary statistics from Monte Carlo simulation" />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: ui.space.md }}>
          {claims.map((c, i) => {
            const od = c.outcome_distribution;
            const total = od.TRUE_WIN + od.RESTART + od.LOSE;
            const isViable = c.economically_viable !== false;
            return (
              <div key={c.claim_id} style={{
                background: '#0F1219', border: `1px solid ${isViable ? COLORS.cardBorder : '#EF4444'}`,
                borderRadius: 10, padding: 16,
                opacity: isViable ? 1 : 0.85,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <span style={{ color: COLORS.textBright, fontSize: 14, fontWeight: 700 }}>
                    {c.claim_id}
                    {!isViable && <span style={{ color: '#EF4444', fontSize: ui.sizes.xs, marginLeft: 6 }}>⚠️ UNVIABLE</span>}
                  </span>
                  <Badge
                    text={c.archetype.replace('_', ' ').toUpperCase()}
                    color={c.jurisdiction === 'siac' ? COLORS.accent2 : COLORS.accent1}
                  />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: ui.space.sm, fontSize: ui.sizes.sm }}>
                  <div>
                    <span style={{ color: COLORS.textMuted }}>SOC:</span>{' '}
                    <span style={{ color: COLORS.text, fontWeight: 600 }}>{fmtCr(c.soc_value_cr)}</span>
                  </div>
                  <div>
                    <span style={{ color: COLORS.textMuted }}>Win Rate:</span>{' '}
                    <span style={{ color: COLORS.accent4, fontWeight: 600 }}>{fmtPct(c.win_rate)}</span>
                  </div>
                  <div>
                    <span style={{ color: COLORS.textMuted }}>Avg Dur:</span>{' '}
                    <span style={{ color: COLORS.text, fontWeight: 600 }}>{c.mean_duration_months.toFixed(1)}m</span>
                  </div>
                  <div>
                    <span style={{ color: COLORS.textMuted }}>Jurisdiction:</span>{' '}
                    <span style={{ color: COLORS.accent6, fontWeight: 600 }}>{c.jurisdiction.toUpperCase()}</span>
                  </div>
                </div>
                {/* Outcome bar */}
                <div style={{ marginTop: 10, height: 6, borderRadius: 3, overflow: 'hidden', display: 'flex' }}>
                  <div style={{ width: `${(od.TRUE_WIN / total * 100)}%`, background: COLORS.accent4 }} />
                  <div style={{ width: `${(od.RESTART / total * 100)}%`, background: COLORS.accent3 }} />
                  <div style={{ width: `${(od.LOSE / total * 100)}%`, background: COLORS.accent5 }} />
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, fontSize: ui.sizes.xs, color: COLORS.textMuted }}>
                  <span>Win {fmtPct(od.TRUE_WIN / total)}</span>
                  <span>Restart {fmtPct(od.RESTART / total)}</span>
                  <span>Lose {fmtPct(od.LOSE / total)}</span>
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      {/* ── Plot 4: Return Distribution with upfront/tail picker ── */}
      <Card>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: ui.space.md, flexWrap: 'wrap' }}>
          <SectionTitle number="4" title="Return Distribution" subtitle="Monte Carlo simulated outcomes — toggle metric, hover bars for details" />
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ color: COLORS.textMuted, fontSize: ui.sizes.sm }}>Upfront</span>
            <select
              value={distUpfront}
              onChange={e => setDistUpfront(Number(e.target.value))}
              style={{
                background: COLORS.card, color: COLORS.textBright, border: `1px solid ${COLORS.cardBorder}`,
                borderRadius: 6, padding: '5px 10px', fontSize: ui.sizes.sm, fontWeight: 600, cursor: 'pointer',
              }}
            >
              {upOpts.map(u => <option key={u} value={u}>{u}%</option>)}
            </select>
            <span style={{ color: COLORS.textMuted, fontSize: ui.sizes.sm }}>Tata Tail</span>
            <select
              value={distTail}
              onChange={e => setDistTail(Number(e.target.value))}
              style={{
                background: COLORS.card, color: COLORS.textBright, border: `1px solid ${COLORS.cardBorder}`,
                borderRadius: 6, padding: '5px 10px', fontSize: ui.sizes.sm, fontWeight: 600, cursor: 'pointer',
              }}
            >
              {tailOpts.map(t => <option key={t} value={t}>{t}%</option>)}
            </select>
          </div>
        </div>
        <DistributionExplorer data={data} defaultMetric="irr" height={280} compact gridKey={distKey} />
      </Card>

      {/* ── Plot 5: Investment Scenario Summary with tail % dropdown ── */}
      <Card>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: ui.space.md }}>
          <SectionTitle number="5" title="Investment Scenario Summary" subtitle={`Upfront levels at ${selectedTail}% Tata Tail`} />
          <select
            value={selectedTail}
            onChange={e => setSelectedTail(Number(e.target.value))}
            style={{
              background: COLORS.card, color: COLORS.textBright, border: `1px solid ${COLORS.cardBorder}`,
              borderRadius: 6, padding: '6px 12px', fontSize: ui.sizes.sm, fontWeight: 600,
              marginLeft: 'auto', cursor: 'pointer',
            }}
          >
            {tailOpts.map(t => (
              <option key={t} value={t}>{t}% Tata Tail</option>
            ))}
          </select>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 2, fontFamily: FONT }}>
            <thead>
              <tr>
                {['Scenario', 'Investment (₹Cr)', 'E[MOIC]', 'E[IRR]', 'P(Loss)', 'E[Net Return]', 'P(Hurdle)'].map(h => (
                  <th key={h} style={{
                    padding: '12px 16px', color: COLORS.textMuted, fontSize: ui.sizes.sm,
                    fontWeight: 700, textAlign: 'center', textTransform: 'uppercase',
                    letterSpacing: '0.06em', borderBottom: `1px solid ${COLORS.cardBorder}`,
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {upOpts.map((up, i) => {
                const key = `${up}_${selectedTail}`;
                const row = stocGrid[key];
                if (!row) return null;
                const invest = (up / 100) * (stocMeta.portfolio_soc_cr || totalSOC);
                const netRet = invest * (row.e_moic - 1);
                return (
                  <tr key={key} style={{ background: i % 2 === 0 ? 'transparent' : '#ffffff05' }}>
                    <td style={{ padding: '10px 16px', color: COLORS.textBright, fontSize: ui.sizes.base, fontWeight: 700, textAlign: 'center' }}>
                      {up}% Upfront
                    </td>
                    <td style={{ padding: '10px 16px', color: COLORS.text, fontSize: ui.sizes.base, textAlign: 'center', fontWeight: 600 }}>
                      {fmtCr(invest)}
                    </td>
                    <td style={{
                      padding: '10px 16px', fontSize: ui.sizes.lg, fontWeight: 800, textAlign: 'center',
                      color: row.e_moic >= 2 ? '#34D399' : row.e_moic >= 1.2 ? '#F59E0B' : '#EF4444',
                    }}>{fmtMOIC(row.e_moic)}</td>
                    <td style={{
                      padding: '10px 16px', fontSize: ui.sizes.base, fontWeight: 700, textAlign: 'center',
                      color: row.e_irr >= 0.30 ? '#34D399' : row.e_irr >= 0.12 ? '#F59E0B' : '#EF4444',
                    }}>{fmtPct(row.e_irr)}</td>
                    <td style={{
                      padding: '10px 16px', fontSize: ui.sizes.base, fontWeight: 700, textAlign: 'center',
                      color: row.prob_loss > 0.30 ? '#EF4444' : row.prob_loss > 0.10 ? '#F59E0B' : '#34D399',
                    }}>{fmtPct(row.prob_loss)}</td>
                    <td style={{ padding: '10px 16px', color: COLORS.text, fontSize: ui.sizes.base, textAlign: 'center' }}>
                      {fmtCr(netRet)}
                    </td>
                    <td style={{
                      padding: '10px 16px', fontSize: ui.sizes.base, fontWeight: 700, textAlign: 'center',
                      color: row.prob_hurdle >= 0.5 ? '#34D399' : row.prob_hurdle >= 0.25 ? '#F59E0B' : '#EF4444',
                    }}>{fmtPct(row.prob_hurdle)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {/* ── Plot 6: Cross-Claim IRR Comparison ── */}
      <Card>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', marginBottom: ui.space.md }}>
          <SectionTitle number="6" title="Cross-Claim Comparison" subtitle="IRR & MOIC by claim at selected deal structure" />
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 10 }}>
            <select
              value={ccUpfront}
              onChange={e => setCcUpfront(Number(e.target.value))}
              style={{
                background: COLORS.card, color: COLORS.textBright, border: `1px solid ${COLORS.cardBorder}`,
                borderRadius: 6, padding: '6px 12px', fontSize: ui.sizes.sm, fontWeight: 600, cursor: 'pointer',
              }}
            >
              {upOpts.map(u => <option key={u} value={u}>{u}% Upfront</option>)}
            </select>
            <select
              value={ccTail}
              onChange={e => setCcTail(Number(e.target.value))}
              style={{
                background: COLORS.card, color: COLORS.textBright, border: `1px solid ${COLORS.cardBorder}`,
                borderRadius: 6, padding: '6px 12px', fontSize: ui.sizes.sm, fontWeight: 600, cursor: 'pointer',
              }}
            >
              {tailOpts.map(t => <option key={t} value={t}>{t}% Tata Tail</option>)}
            </select>
          </div>
        </div>

        {(() => {
          const pcGrid = data.per_claim_grid || {};
          const chartData = claims.map((c, idx) => {
            const entries = pcGrid[c.claim_id] || [];
            const match = entries.find(e =>
              Math.abs(e.upfront_pct - ccUpfront / 100) < 0.001 &&
              Math.abs(e.tata_tail_pct - ccTail / 100) < 0.001
            );
            return {
              claim: c.claim_id.replace('TP-', ''),
              fullName: c.claim_id,
              moic: match ? match.mean_moic : 0,
              irr: match ? (match.conditional_xirr_win || 0) * 100 : 0,
              pLoss: match ? match.p_loss : 0,
            };
          });

          if (chartData.every(d => d.moic === 0 && d.irr === 0)) {
            return (
              <div style={{ color: COLORS.textMuted, textAlign: 'center', padding: 32 }}>
                No per-claim data available for {ccUpfront}% Upfront / {ccTail}% Tail.
                Re-run the pipeline to generate data at all SOC × Tail combinations.
              </div>
            );
          }

          // Consistent colors: MOIC = cyan, IRR = purple, with conditional shading for viability
          const MOIC_COLOR = COLORS.accent1;  // Cyan
          const IRR_COLOR = '#A78BFA';         // Purple
          const LOSS_COLOR = COLORS.accent5;   // Red for high-risk

          return (
            <>
              <ResponsiveContainer width="100%" height={320}>
                <BarChart data={chartData} margin={{ top: 10, right: 20, left: 10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={COLORS.cardBorder} />
                  <XAxis dataKey="claim" tick={{ fill: COLORS.text, fontSize: ui.sizes.sm }} />
                  <YAxis yAxisId="left" label={{ value: 'E[MOIC]', angle: -90, position: 'insideLeft', fill: COLORS.textMuted, fontSize: 12 }}
                    tick={{ fill: COLORS.text, fontSize: ui.sizes.sm }} />
                  <YAxis yAxisId="right" orientation="right"
                    label={{ value: 'E[IRR|Win] %', angle: 90, position: 'insideRight', fill: COLORS.textMuted, fontSize: 12 }}
                    tick={{ fill: COLORS.text, fontSize: ui.sizes.sm }} />
                  <Tooltip cursor={{ fill: 'rgba(6,182,212,0.06)' }}
                    contentStyle={{ background: COLORS.card, border: `1px solid ${COLORS.cardBorder}`, borderRadius: 8 }}
                    labelStyle={{ color: COLORS.textBright }}
                    itemStyle={{ color: COLORS.text }}
                    formatter={(val, name, props) => {
                      if (name === 'E[MOIC]') return fmtMOIC(val);
                      if (name === 'E[IRR|Win]') return `${val.toFixed(1)}%`;
                      return val;
                    }}
                  />
                  <Legend 
                    wrapperStyle={{ color: COLORS.text }} 
                    payload={[
                      { value: 'E[MOIC] (bars, left axis)', type: 'rect', color: MOIC_COLOR },
                      { value: 'E[IRR|Win] (bars, right axis)', type: 'rect', color: IRR_COLOR },
                    ]}
                  />
                  <ReferenceLine yAxisId="left" y={1} stroke={COLORS.breakeven} strokeDasharray="8 4" strokeWidth={2} />
                  <Bar yAxisId="left" dataKey="moic" name="E[MOIC]" radius={[4, 4, 0, 0]} cursor={BAR_CURSOR}>
                    {chartData.map((d, i) => (
                      <Cell key={i} fill={d.moic >= 1.0 ? MOIC_COLOR : LOSS_COLOR} fillOpacity={0.85} />
                    ))}
                  </Bar>
                  <Bar yAxisId="right" dataKey="irr" name="E[IRR|Win]" radius={[4, 4, 0, 0]} cursor={BAR_CURSOR}>
                    {chartData.map((d, i) => (
                      <Cell key={i} fill={IRR_COLOR} fillOpacity={d.irr > 0 ? 0.75 : 0.4} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              <div style={{ marginTop: 8, fontSize: ui.sizes.xs, color: COLORS.textMuted, lineHeight: 1.5, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                <span><span style={{ color: MOIC_COLOR }}>●</span> MOIC ≥ 1.0× = Profitable</span>
                <span><span style={{ color: LOSS_COLOR }}>●</span> MOIC &lt; 1.0× = Loss (below breakeven)</span>
                <span style={{ color: COLORS.breakeven }}>---</span><span> 1.0× Breakeven Line</span>
              </div>
            </>
          );
        })()}
      </Card>
    </div>
  );
}
