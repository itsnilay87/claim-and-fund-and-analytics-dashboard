/**
 * ClaimInvestmentAnalysis.jsx — Single-claim Tab 4: Investment Analysis.
 *
 * Frames legal costs as the investment for a single claim.
 *
 * Sections:
 *   1. KPI Row (6 cards): Investment, E[Collected], E[MOIC], E[IRR], P(Loss), Breakeven Win Rate
 *   2. Recovery Funnel (styled divs with arrows)
 *   3. Legal Cost Stage Breakdown (horizontal bar chart)
 *   4. Legal Costs as % of SOC (single large metric)
 *   5. Waterfall Terms Grid (heatmap table, if waterfall_grid data available)
 */

import React, { useMemo } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell,
} from 'recharts';
import { COLORS, FONT, CHART_COLORS, CHART_HEIGHT, useUISettings, fmtCr, fmtPct, fmtMOIC, moicColor } from '../../theme';
import { Card, SectionTitle, KPI } from '../Shared';

/* ── Waterfall heatmap cell color ── */
function cellColor(moic) {
  if (moic >= 2.0) return '#065F46';
  if (moic >= 1.5) return '#047857';
  if (moic >= 1.0) return '#D97706';
  if (moic >= 0.5) return '#C2410C';
  return '#991B1B';
}

export default function ClaimInvestmentAnalysis({ data }) {
  const { ui } = useUISettings();
  const claim = data?.claims?.[0];
  const meta = data?.simulation_meta || {};
  const ca = data?.cashflow_analysis || {};
  const ps = ca.portfolio_summary || {};
  const perClaim = ca.per_claim || [];
  const lc = data?.legal_cost_summary;
  const wGrid = data?.waterfall_grid || {};
  const wAxes = data?.waterfall_axes || null;
  const risk = data?.risk || {};
  const ig = data?.investment_grid_soc || [];
  const decomp = ca.decomposition || [];

  if (!claim) {
    return <Card><SectionTitle title="No claim data available" /></Card>;
  }

  const claimId = claim.claim_id;
  const soc = claim.soc_value_cr;

  // Investment = E[Legal Costs]
  const legalCost = claim.legal_cost_stats?.mean || ps.total_e_legal_cr || 0;
  const collected = claim.collected_stats?.mean || ps.total_e_collected_cr || 0;

  // MOIC & IRR from various sources
  const moicDist = risk.moic_distribution || {};
  const irrDist = risk.irr_distribution || {};
  const wgKeys = Object.keys(wGrid);
  const wgRefKey = wgKeys[0];
  const wgRef = wGrid[wgRefKey] || {};

  // Try investment_grid_soc reference cell, then waterfall_grid, then risk distributions
  const igRef = Array.isArray(ig) && ig.length > 0 ? ig.find(g => Math.abs(g.award_share_pct - 0.70) < 0.001) || ig[0] : null;
  const eMoic = igRef?.mean_moic || wgRef.mean_moic || moicDist.mean || moicDist.p50 || (legalCost > 0 ? collected / legalCost : 0);
  const eIrr = igRef?.mean_xirr || wgRef.mean_xirr || irrDist.mean || irrDist.p50 || 0;
  const pLoss = igRef?.p_loss ?? wgRef.p_loss ?? risk.concentration?.mean_p_loss ?? 0;

  // Breakeven win rate: the win probability where MOIC drops to 1.0
  // At breakeven: collected_at_breakeven = legal_cost → E[Q|Win] × breakeven_win_rate = legal_cost
  const eqGivenWin = claim.expected_quantum_cr || (soc * (data?.quantum_summary?.expected_quantum_pct_of_soc || 0.8));
  const breakevenWinRate = eqGivenWin > 0 ? Math.min(1, legalCost / eqGivenWin) : null;

  // Recovery funnel values
  const winRate = claim.win_rate || ps.avg_win_rate || 0;
  const eqPctOfSoc = data?.quantum_summary?.expected_quantum_pct_of_soc || (eqGivenWin / soc);
  const ePrincipal = eqGivenWin * winRate;
  const eInterest = claim.interest_stats?.mean || perClaim[0]?.e_interest_cr || 0;
  const eCollected = ePrincipal + eInterest;
  const eNet = eCollected - legalCost;

  // Legal cost stage data
  const lcPerClaim = lc?.per_claim?.[claimId] || {};
  const stageEntries = Object.entries(lcPerClaim.duration_stages || {});
  const stageCostData = stageEntries.map(([stage, info], i) => ({
    stage: stage.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
    cost: typeof info === 'object' ? (info.midpoint ?? info.fixed ?? 0) : 0,
  })).filter(s => s.cost > 0);

  // Add one-time costs
  if (lcPerClaim.onetime_total_cr > 0) {
    stageCostData.push({ stage: 'Tribunal + Expert (one-time)', cost: lcPerClaim.onetime_total_cr });
  }

  const legalPctOfSoc = soc > 0 ? legalCost / soc : 0;

  // Waterfall grid parsing
  const gridKeys = Object.keys(wGrid);
  const hasGrid = gridKeys.length > 0;
  const gridData = useMemo(() => {
    if (!hasGrid) return { multiples: [], awardCaps: [] };
    let multiples, awardCaps;
    if (wAxes) {
      multiples = (wAxes.cost_multiples || []).sort((a, b) => a - b);
      awardCaps = (wAxes.award_ratios || []).sort((a, b) => a - b);
    } else {
      multiples = [...new Set(gridKeys.map(k => parseFloat(k.split('_')[0])))].sort((a, b) => a - b);
      awardCaps = [...new Set(gridKeys.map(k => parseFloat(k.split('_')[1])))].sort((a, b) => a - b);
    }
    return { multiples, awardCaps };
  }, [hasGrid, gridKeys, wAxes]);

  const favorColor = (v, good, bad) => v >= good ? '#34D399' : v >= bad ? COLORS.accent3 : COLORS.accent5;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: ui.space.xl }}>

      {/* ═══ § 1 — KPI Row ═══ */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: ui.space.md }}>
        <KPI
          label="Investment (Legal Costs)"
          value={fmtCr(legalCost)}
          sub="E[Total Legal Spend]"
          color={COLORS.accent5}
        />
        <KPI
          label="E[Collected]"
          value={fmtCr(collected)}
          sub="Expected recovery"
          color={COLORS.accent4}
        />
        <KPI
          label="E[MOIC]"
          value={fmtMOIC(eMoic)}
          color={favorColor(eMoic, 2.0, 1.0)}
        />
        <KPI
          label="E[IRR]"
          value={fmtPct(eIrr)}
          sub="Annualized"
          color={favorColor(eIrr, 0.25, 0.10)}
        />
        <KPI
          label="P(Loss)"
          value={fmtPct(pLoss)}
          color={pLoss < 0.25 ? '#34D399' : COLORS.accent5}
        />
        <KPI
          label="Breakeven Win Rate"
          value={breakevenWinRate != null ? fmtPct(breakevenWinRate) : '—'}
          sub="Win rate where MOIC = 1.0"
          color={breakevenWinRate != null && breakevenWinRate < winRate ? '#34D399' : COLORS.accent5}
        />
      </div>

      {/* ═══ § 2 — Recovery Funnel ═══ */}
      <Card>
        <SectionTitle number="1" title="Recovery Funnel — SOC to Net"
          subtitle={`How the Statement of Claim flows through probability gates to net recovery. E[Principal] = E[Q|Win] × Win Rate = ${fmtCr(ePrincipal)}`} />

        <div style={{
          display: 'flex', alignItems: 'center', gap: 0,
          overflowX: 'auto', padding: `${ui.space.md}px 0`,
        }}>
          {[
            { label: 'SOC', value: soc, sub: 'Statement of Claim', color: COLORS.accent1 },
            { label: `× E[Q|Win] (${fmtPct(eqPctOfSoc)})`, value: eqGivenWin, sub: 'Expected Quantum', color: COLORS.accent4, isOp: false },
            { label: `× Win Rate (${fmtPct(winRate)})`, value: ePrincipal, sub: 'E[Principal]', color: COLORS.accent3, isOp: false },
            ...(eInterest > 0 ? [{ label: `+ Interest`, value: eCollected, sub: `+${fmtCr(eInterest)}`, color: COLORS.accent6, isOp: false }] : []),
            { label: 'E[Collected]', value: eCollected, sub: 'Total expected', color: COLORS.accent2 },
            { label: `− Legal Costs`, value: eNet, sub: `−${fmtCr(legalCost)}`, color: eNet >= 0 ? '#22C55E' : COLORS.accent5, isOp: false },
            { label: 'E[Net Recovery]', value: eNet, sub: eNet >= 0 ? 'Positive return' : 'Negative return', color: eNet >= 0 ? '#22C55E' : COLORS.accent5 },
          ].map((step, i, arr) => (
            <React.Fragment key={i}>
              {i > 0 && (
                <div style={{
                  display: 'flex', alignItems: 'center', padding: '0 2px', flexShrink: 0,
                }}>
                  <div style={{ color: COLORS.textMuted, fontSize: 20, fontWeight: 700 }}>→</div>
                </div>
              )}
              <div style={{
                background: i === 0 ? `${COLORS.accent1}15` : i === arr.length - 1 ? (eNet >= 0 ? '#22C55E15' : `${COLORS.accent5}15`) : '#0F1219',
                border: `1px solid ${i === 0 ? COLORS.accent1 + '40' : i === arr.length - 1 ? (eNet >= 0 ? '#22C55E40' : COLORS.accent5 + '40') : COLORS.cardBorder}`,
                borderRadius: 10, padding: `${ui.space.sm}px ${ui.space.md}px`,
                textAlign: 'center', minWidth: 110, flexShrink: 0,
              }}>
                <div style={{ color: COLORS.textMuted, fontSize: ui.sizes.xs, fontWeight: 600, marginBottom: 3, whiteSpace: 'nowrap' }}>
                  {step.label}
                </div>
                <div style={{ color: step.color, fontSize: ui.sizes.lg, fontWeight: 800 }}>
                  {fmtCr(step.value)}
                </div>
                {step.sub && (
                  <div style={{ color: COLORS.textMuted, fontSize: ui.sizes.xs, marginTop: 2 }}>
                    {step.sub}
                  </div>
                )}
              </div>
            </React.Fragment>
          ))}
        </div>

        {/* Recovery flow bar */}
        <div style={{ marginTop: ui.space.md }}>
          <div style={{ color: COLORS.textMuted, fontSize: ui.sizes.xs, fontWeight: 600, textTransform: 'uppercase', marginBottom: 6 }}>
            Recovery as % of SOC
          </div>
          <div style={{ display: 'flex', height: 28, borderRadius: 8, overflow: 'hidden', background: '#1F2937' }}>
            {soc > 0 && (
              <>
                <div style={{
                  width: `${Math.max(2, Math.min(100, (ePrincipal / soc) * 100))}%`,
                  background: `linear-gradient(90deg, ${COLORS.accent1}, ${COLORS.accent3})`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <span style={{ color: '#fff', fontSize: ui.sizes.xs, fontWeight: 700 }}>Principal {fmtPct(ePrincipal / soc)}</span>
                </div>
                {eInterest > 0 && (
                  <div style={{
                    width: `${Math.max(2, Math.min(30, (eInterest / soc) * 100))}%`,
                    background: COLORS.accent4,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <span style={{ color: '#fff', fontSize: 9, fontWeight: 700 }}>Interest</span>
                  </div>
                )}
                <div style={{
                  width: `${Math.max(2, Math.min(30, (legalCost / soc) * 100))}%`,
                  background: COLORS.accent5 + 'AA',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <span style={{ color: '#fff', fontSize: 9, fontWeight: 700 }}>Legal {fmtPct(legalCost / soc)}</span>
                </div>
              </>
            )}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
            <span style={{ color: COLORS.textMuted, fontSize: ui.sizes.xs }}>0%</span>
            <span style={{ color: COLORS.textMuted, fontSize: ui.sizes.xs }}>← Collected ({fmtPct(eCollected / soc)}) →</span>
            <span style={{ color: COLORS.textMuted, fontSize: ui.sizes.xs }}>100% SOC</span>
          </div>
        </div>
      </Card>

      {/* ═══ § 3 — Legal Cost Stage Breakdown ═══ */}
      {stageCostData.length > 0 && (
        <Card>
          <SectionTitle number="2" title="Legal Cost Breakdown by Stage"
            subtitle="Estimated legal costs at each litigation stage. Includes counsel, expert, and tribunal fees." />
          <ResponsiveContainer width="100%" height={Math.max(200, stageCostData.length * 50 + 60)}>
            <BarChart data={stageCostData} layout="vertical" margin={{ top: 10, right: 30, left: 120, bottom: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={COLORS.gridLine} />
              <XAxis type="number" tick={{ fill: COLORS.textMuted, fontSize: ui.sizes.sm }} tickFormatter={v => `₹${v.toFixed(1)}`} />
              <YAxis dataKey="stage" type="category" tick={{ fill: COLORS.textMuted, fontSize: ui.sizes.sm }} width={110} />
              <Tooltip
                cursor={{ fill: 'rgba(6,182,212,0.06)' }}
                contentStyle={{ background: '#1F2937', border: `1px solid ${COLORS.cardBorder}`, borderRadius: 8, fontFamily: FONT }}
                labelStyle={{ color: COLORS.textBright, fontWeight: 700 }}
                formatter={(v) => [fmtCr(v), 'Cost']}
              />
              <Bar dataKey="cost" name="Legal Cost (₹ Cr)" radius={[0, 6, 6, 0]} barSize={24}>
                {stageCostData.map((d, i) => (
                  <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>

          {/* Overrun model params if available */}
          {lc?.overrun_params && (
            <div style={{
              marginTop: ui.space.md, padding: '10px 14px', borderRadius: 8,
              background: '#0c1622', border: `1px solid ${COLORS.accent5}40`,
            }}>
              <div style={{ color: COLORS.accent5, fontSize: ui.sizes.xs, fontWeight: 700, marginBottom: 6 }}>
                Stochastic Overrun Model: ε ~ ScaledBeta(α={lc.overrun_params.alpha}, β={lc.overrun_params.beta})
              </div>
              <div style={{ color: COLORS.textMuted, fontSize: ui.sizes.xs }}>
                Range: {(lc.overrun_params.low * 100).toFixed(0)}% to +{(lc.overrun_params.high * 100).toFixed(0)}% | E[Overrun]: +{(lc.overrun_params.expected_overrun_pct * 100).toFixed(0)}%
              </div>
            </div>
          )}
        </Card>
      )}

      {/* ═══ § 4 — Legal Costs as % of SOC ═══ */}
      <Card>
        <SectionTitle number="3" title="Legal Costs as % of SOC"
          subtitle="How much of the claim value is consumed by expected legal spend?" />
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          padding: `${ui.space.xl}px 0`,
        }}>
          <div style={{
            color: legalPctOfSoc > 0.10 ? COLORS.accent5 : legalPctOfSoc > 0.05 ? COLORS.accent3 : COLORS.accent4,
            fontSize: 64, fontWeight: 900, fontFamily: FONT, lineHeight: 1,
          }}>
            {fmtPct(legalPctOfSoc)}
          </div>
          <div style={{ color: COLORS.textMuted, fontSize: ui.sizes.md, marginTop: ui.space.sm, textAlign: 'center', maxWidth: 500 }}>
            Expected legal costs of <span style={{ color: COLORS.textBright, fontWeight: 700 }}>{fmtCr(legalCost)}</span> represent{' '}
            <span style={{ color: COLORS.textBright, fontWeight: 700 }}>{fmtPct(legalPctOfSoc)}</span> of the{' '}
            <span style={{ color: COLORS.textBright, fontWeight: 700 }}>{fmtCr(soc)}</span> Statement of Claim.
          </div>
          <div style={{
            marginTop: ui.space.md, padding: '8px 20px', borderRadius: 20,
            background: legalPctOfSoc > 0.10 ? '#EF444420' : legalPctOfSoc > 0.05 ? '#F59E0B20' : '#10B98120',
            color: legalPctOfSoc > 0.10 ? COLORS.accent5 : legalPctOfSoc > 0.05 ? COLORS.accent3 : '#34D399',
            fontSize: ui.sizes.sm, fontWeight: 700,
          }}>
            {legalPctOfSoc > 0.10 ? 'High cost intensity — monitor closely'
              : legalPctOfSoc > 0.05 ? 'Moderate cost intensity'
              : 'Low cost intensity — favorable'}
          </div>
        </div>
      </Card>

      {/* ═══ § 5 — Waterfall Terms Grid ═══ */}
      {hasGrid ? (
        <Card>
          <SectionTitle number="4" title="Waterfall Terms Heatmap"
            subtitle="E[MOIC] across (cost_multiple_cap × award_ratio_cap) combinations. Green = MOIC > 2.0, Yellow = 1.0–2.0, Red < 1.0." />
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'separate', borderSpacing: 2, width: '100%', fontSize: 12 }}>
              <thead>
                <tr>
                  <th style={{
                    padding: '8px 6px', color: COLORS.textMuted, fontWeight: 700, fontSize: 11,
                    position: 'sticky', left: 0, background: COLORS.card, zIndex: 2,
                  }}>
                    Multiple \ Award%
                  </th>
                  {gridData.awardCaps.map(a => (
                    <th key={a} style={{
                      padding: '6px 4px', color: COLORS.textMuted, fontWeight: 600, fontSize: 11,
                      textAlign: 'center', minWidth: 56,
                    }}>
                      {(a * 100).toFixed(0)}%
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {gridData.multiples.map(m => (
                  <tr key={m}>
                    <td style={{
                      padding: '6px 8px', color: COLORS.accent1, fontWeight: 700, fontSize: 12,
                      position: 'sticky', left: 0, background: COLORS.card, zIndex: 1,
                    }}>
                      {m.toFixed(1)}×
                    </td>
                    {gridData.awardCaps.map(a => {
                      const key = wAxes
                        ? `${Math.round(m * 10)}_${Math.round(a * 100)}`
                        : `${m}_${a}`;
                      const cell = wGrid[key];
                      if (!cell) return <td key={a} style={{ background: '#1F2937', textAlign: 'center', fontSize: 10 }}>—</td>;
                      const val = cell.mean_moic || cell.e_moic || 0;
                      return (
                        <td key={a} style={{
                          padding: '5px 3px', textAlign: 'center',
                          background: cellColor(val),
                          borderRadius: 3, fontWeight: 600,
                          color: '#ffffffDD', fontSize: 11,
                        }}
                          title={`${m.toFixed(1)}× cap / ${(a * 100).toFixed(0)}% award → ${fmtMOIC(val)}`}>
                          {fmtMOIC(val)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : (
        <Card>
          <SectionTitle number="4" title="Waterfall Terms Grid" />
          <div style={{
            textAlign: 'center', padding: `${ui.space.xxl}px`,
            color: COLORS.textMuted, fontSize: ui.sizes.md,
          }}>
            <div style={{ fontSize: 48, marginBottom: ui.space.md }}>🏗️</div>
            <div style={{ fontWeight: 600 }}>Run simulation to see waterfall analysis</div>
            <div style={{ fontSize: ui.sizes.sm, marginTop: ui.space.sm }}>
              Waterfall grid requires litigation funding structure type with cost_multiple and award_ratio parameters.
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
