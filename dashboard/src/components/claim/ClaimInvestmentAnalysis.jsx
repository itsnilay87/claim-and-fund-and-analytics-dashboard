/**
 * ClaimInvestmentAnalysis.jsx — Single-claim Tab 4: Investment Analysis.
 *
 * Frames legal costs as the investment for a single claim.
 *
 * Sections:
 *   1. KPI Row (7 cards): Investment, E[Collected], E[MOIC], E[IRR], P(Loss), Breakeven Win Rate, Collection Ratio
 *   2. Recovery Funnel (styled divs with arrows, collapsible formula)
 *   3. Legal Cost Stage Breakdown (horizontal bar chart)
 *   4. Legal Costs as % of SOC (single large metric)
 */

import React, { useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell,
} from 'recharts';
import { COLORS, FONT, CHART_COLORS, CHART_HEIGHT, useUISettings, fmtCr, fmtPct, fmtMOIC, moicColor } from '../../theme';
import { Card, SectionTitle, KPI } from '../Shared';

/* ── Recovery Funnel Card with collapsible formula ── */
function RecoveryFunnelCard({ ui, soc, eqGivenWin, eqPctOfSoc, winRate, ePrincipal, eInterest, eCollected, eNet, legalCost, collectionRatio, netOverSoc }) {
  const [showFormula, setShowFormula] = React.useState(false);

  const mcPaths = ''; // placeholder if needed

  return (
    <Card>
      <SectionTitle number="1" title="Portfolio Recovery Funnel — SOC to Net"
        subtitle={`E[Principal] = Σ(E[Q]Win) × Win Rate) = ${fmtCr(ePrincipal)}. Total SOC: ${fmtCr(soc)}.`} />

      {/* Collapsible Calculation Formula */}
      <div style={{
        marginBottom: ui.space.md, borderRadius: 8,
        border: `1px solid ${COLORS.accent4}40`,
        background: '#0c1622',
        overflow: 'hidden',
      }}>
        <button
          onClick={() => setShowFormula(v => !v)}
          style={{
            width: '100%', display: 'flex', alignItems: 'center', gap: 8,
            padding: '10px 14px', cursor: 'pointer',
            background: 'transparent', border: 'none', textAlign: 'left',
          }}
        >
          <span style={{ color: COLORS.accent4, fontSize: 14 }}>{showFormula ? '▼' : '▶'}</span>
          <span style={{ fontSize: 14 }}>📄</span>
          <span style={{ color: COLORS.accent4, fontSize: ui.sizes.sm, fontWeight: 700, textTransform: 'uppercase' }}>
            Calculation Formula (Verifiable)
          </span>
          <span style={{ color: COLORS.textMuted, fontSize: ui.sizes.xs, marginLeft: 'auto' }}>
            — Click to {showFormula ? 'hide' : 'show'}
          </span>
        </button>
        {showFormula && (
          <div style={{
            padding: '0 14px 14px 38px',
            color: COLORS.text, fontSize: ui.sizes.sm, lineHeight: 1.7,
            fontFamily: FONT,
          }}>
            <div>
              <span style={{ fontWeight: 700, color: COLORS.textBright }}>E[Principal]</span> = Σ (E[Quantum|Win]<sub>i</sub> × Win_Rate<sub>i</sub>) for each claim
            </div>
            <div style={{ marginLeft: 16, color: COLORS.textMuted }}>
              = ({fmtCr(eqGivenWin)} × {fmtPct(winRate)})
            </div>
            <div style={{ marginLeft: 16 }}>
              = <span style={{ color: COLORS.accent1, fontWeight: 700 }}>{fmtCr(ePrincipal)}</span>{' '}
              <span style={{ color: COLORS.textMuted }}>({fmtPct(soc > 0 ? ePrincipal / soc : 0)} of SOC)</span>
            </div>
            <div style={{ marginTop: 6 }}>
              <span style={{ fontWeight: 700, color: COLORS.textBright }}>E[Collected]</span> = E[Principal] + E[Interest] = {fmtCr(ePrincipal)} + {fmtCr(eInterest)} = <span style={{ color: COLORS.accent2, fontWeight: 700 }}>{fmtCr(eCollected)}</span>
            </div>
          </div>
        )}
      </div>

      {/* KPI metric cards row */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: ui.space.md,
        marginBottom: ui.space.md,
      }}>
        {[
          { label: 'TOTAL SOC', value: fmtCr(soc), sub: `${soc > 0 ? 1 : 0} claims`, color: COLORS.accent1 },
          { label: 'E[QUANTUM|WIN]', value: fmtCr(eqGivenWin), sub: `${fmtPct(eqPctOfSoc)} of SOC`, color: COLORS.accent4 },
          { label: 'AVG WIN RATE', value: fmtPct(winRate), sub: 'SOC-weighted', color: COLORS.accent3 },
          { label: 'E[PRINCIPAL]', value: fmtCr(ePrincipal), sub: `${fmtPct(soc > 0 ? ePrincipal / soc : 0)} of SOC`, color: COLORS.accent2 },
          { label: 'E[INTEREST]', value: fmtCr(eInterest), sub: `${fmtPct(soc > 0 ? eInterest / soc : 0)} of SOC`, color: COLORS.accent3 },
          { label: 'E[NET RECOVERY]', value: fmtCr(eNet), sub: `after ${fmtCr(legalCost)} legal`, color: eNet >= 0 ? '#22C55E' : COLORS.accent5 },
        ].map((card, i) => (
          <div key={i} style={{
            background: '#0F1219', border: `1px solid ${COLORS.cardBorder}`,
            borderRadius: 10, padding: `${ui.space.sm}px ${ui.space.md}px`, textAlign: 'center',
          }}>
            <div style={{ color: COLORS.textMuted, fontSize: 10, fontWeight: 600, textTransform: 'uppercase', marginBottom: 4 }}>{card.label}</div>
            <div style={{ color: card.color, fontSize: ui.sizes.lg, fontWeight: 800 }}>{card.value}</div>
            <div style={{ color: COLORS.textMuted, fontSize: 10, marginTop: 2 }}>{card.sub}</div>
          </div>
        ))}
      </div>

      {/* Second row: Legal Costs, Total Collected, Collection Ratio, Net/SOC */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: ui.space.md,
        marginBottom: ui.space.md,
      }}>
        {[
          { label: 'E[LEGAL COSTS]', value: fmtCr(legalCost), sub: `${fmtPct(soc > 0 ? legalCost / soc : 0)} of SOC`, color: COLORS.accent5 },
          { label: 'TOTAL COLLECTED', value: fmtCr(eCollected), sub: 'Principal + Interest', color: COLORS.accent4 },
          { label: 'COLLECTION RATIO', value: fmtPct(collectionRatio), sub: 'Total Collected / SOC', color: collectionRatio >= 0.9 ? '#34D399' : collectionRatio >= 0.5 ? COLORS.accent3 : COLORS.accent5 },
          { label: 'NET / SOC', value: fmtPct(netOverSoc), sub: netOverSoc >= 0 ? 'net positive' : 'net negative', color: netOverSoc >= 0 ? '#34D399' : COLORS.accent5 },
        ].map((card, i) => (
          <div key={i} style={{
            background: '#0F1219', border: `1px solid ${COLORS.cardBorder}`,
            borderRadius: 10, padding: `${ui.space.sm}px ${ui.space.md}px`, textAlign: 'center',
          }}>
            <div style={{ color: COLORS.textMuted, fontSize: 10, fontWeight: 600, textTransform: 'uppercase', marginBottom: 4 }}>{card.label}</div>
            <div style={{ color: card.color, fontSize: ui.sizes.lg, fontWeight: 800 }}>{card.value}</div>
            <div style={{ color: COLORS.textMuted, fontSize: 10, marginTop: 2 }}>{card.sub}</div>
          </div>
        ))}
      </div>

      {/* Recovery flow bar */}
      <div style={{ marginTop: ui.space.sm }}>
        <div style={{ color: COLORS.textMuted, fontSize: ui.sizes.xs, fontWeight: 600, textTransform: 'uppercase', marginBottom: 6 }}>
          Recovery Flow (as % of SOC) — Principal + Interest - Legal = Net
        </div>
        <div style={{ display: 'flex', height: 32, borderRadius: 8, overflow: 'hidden', background: '#1F2937' }}>
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
                  <span style={{ color: '#fff', fontSize: 9, fontWeight: 700 }}>Interest {fmtPct(eInterest / soc)}</span>
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
          <span style={{ color: COLORS.textMuted, fontSize: ui.sizes.xs }}>← Total Collected ({fmtPct(collectionRatio)}) →</span>
          <span style={{ color: COLORS.textMuted, fontSize: ui.sizes.xs }}>100% of SOC</span>
        </div>
      </div>

      {/* Calculation summary line */}
      <div style={{
        marginTop: ui.space.md, padding: '10px 14px', borderRadius: 8,
        background: '#0c162280', border: `1px solid ${COLORS.cardBorder}`,
      }}>
        <span style={{ color: COLORS.textMuted, fontSize: ui.sizes.sm, fontWeight: 600 }}>Calculation: </span>
        <span style={{ color: COLORS.accent2, fontSize: ui.sizes.sm, fontWeight: 700 }}>E[Principal]</span>
        <span style={{ color: COLORS.textMuted, fontSize: ui.sizes.sm }}> ({fmtCr(ePrincipal)}) + </span>
        <span style={{ color: COLORS.accent3, fontSize: ui.sizes.sm, fontWeight: 700 }}>E[Interest]</span>
        <span style={{ color: COLORS.textMuted, fontSize: ui.sizes.sm }}> ({fmtCr(eInterest)}) = </span>
        <span style={{ color: COLORS.accent4, fontSize: ui.sizes.sm, fontWeight: 700 }}>E[Total Collected]</span>
        <span style={{ color: COLORS.textMuted, fontSize: ui.sizes.sm }}> ({fmtCr(eCollected)}) → minus </span>
        <span style={{ color: COLORS.accent5, fontSize: ui.sizes.sm, fontWeight: 700 }}>E[Legal]</span>
        <span style={{ color: COLORS.textMuted, fontSize: ui.sizes.sm }}> ({fmtCr(legalCost)}) = </span>
        <span style={{ color: eNet >= 0 ? '#22C55E' : COLORS.accent5, fontSize: ui.sizes.sm, fontWeight: 700 }}>E[Net]</span>
        <span style={{ color: COLORS.textMuted, fontSize: ui.sizes.sm }}> ({fmtCr(eNet)})</span>
      </div>
    </Card>
  );
}

export default function ClaimInvestmentAnalysis({ data }) {
  const { ui } = useUISettings();
  const claim = data?.claims?.[0];
  const ca = data?.cashflow_analysis || {};
  const ps = ca.portfolio_summary || {};
  const perClaim = ca.per_claim || [];
  const lc = data?.legal_cost_summary;
  const wGrid = data?.waterfall_grid || {};
  const risk = data?.risk || {};
  const ig = data?.investment_grid_soc || [];

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
  const collectionRatio = soc > 0 ? eCollected / soc : 0;
  const netOverSoc = soc > 0 ? eNet / soc : 0;

  const favorColor = (v, good, bad) => v >= good ? '#34D399' : v >= bad ? COLORS.accent3 : COLORS.accent5;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: ui.space.xl }}>

      {/* ═══ § 1 — KPI Row ═══ */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: ui.space.md }}>
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
          label="Collection Ratio"
          value={fmtPct(collectionRatio)}
          sub="E[Collected] / SOC"
          color={collectionRatio >= 0.9 ? '#34D399' : collectionRatio >= 0.5 ? COLORS.accent3 : COLORS.accent5}
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
      <RecoveryFunnelCard
        ui={ui} soc={soc} eqGivenWin={eqGivenWin} eqPctOfSoc={eqPctOfSoc}
        winRate={winRate} ePrincipal={ePrincipal} eInterest={eInterest}
        eCollected={eCollected} eNet={eNet} legalCost={legalCost}
        collectionRatio={collectionRatio} netOverSoc={netOverSoc}
      />

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
    </div>
  );
}
