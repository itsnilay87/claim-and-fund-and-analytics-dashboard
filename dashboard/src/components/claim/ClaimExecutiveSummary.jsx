/**
 * ClaimExecutiveSummary.jsx — Single-claim executive summary tab.
 *
 * Sections:
 *   1. Claim Identity Card
 *   2. Portfolio Recovery Calculation (collapsible formula)
 *   3. Portfolio Value Chain KPI Row (7 cards)
 *   4. Supporting Metrics Row (4 cards)
 *   5. Claim Overview Card (single claim with outcome bar)
 *   6. Return Distribution (DistributionExplorer — 4 metric toggles)
 *   7. Cashflow J-Curve (JCurveFanChart — D3 fan chart)
 */

import React, { useState, useMemo } from 'react';
import { COLORS, FONT, useUISettings, fmtCr, fmtPct, fmtMOIC, fmtMo } from '../../theme';
import { Card, SectionTitle, KPI, Badge } from '../Shared';
import DistributionExplorer from '../DistributionExplorer';
import JCurveFanChart from '../JCurveFanChart';

/* ═══════════════════════════════════════════════════════════
 *  § 1 — Claim Identity Card
 * ═══════════════════════════════════════════════════════════ */
function ClaimIdentityCard({ claim }) {
  const { ui } = useUISettings();
  const claimName = claim.name || claim.claim_id || 'N/A';
  const fields = [
    { label: 'Claim Name',     value: claimName },
    { label: 'Jurisdiction',   value: (claim.jurisdiction || 'N/A').toUpperCase() },
    { label: 'Claim Type',     value: (claim.archetype || 'N/A').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) },
    { label: 'Current Stage',  value: (claim.current_gate || 'N/A').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) },
    { label: 'SOC',            value: fmtCr(claim.soc_value_cr) },
    { label: 'Currency',       value: '₹ (INR Crore)' },
  ];
  return (
    <Card>
      <SectionTitle number="1" title={`Claim Identity — ${claimName}`} subtitle="Core claim attributes and parameters" />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: ui.space.md }}>
        {fields.map(f => (
          <div key={f.label} style={{ padding: `${ui.space.sm}px ${ui.space.md}px` }}>
            <div style={{ color: COLORS.textMuted, fontSize: ui.sizes.sm, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>
              {f.label}
            </div>
            <div style={{ color: COLORS.textBright, fontSize: ui.sizes.lg, fontWeight: 700 }}>
              {f.value}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

/* ═══════════════════════════════════════════════════════════
 *  § 2 — Portfolio Recovery Calculation
 * ═══════════════════════════════════════════════════════════ */
function RecoveryCalculation({ claim, metrics }) {
  const { ui } = useUISettings();
  const [showFormulas, setShowFormulas] = useState(false);
  const { totalPrincipal, totalInterest, totalCollected, totalLegal, netRecovery, recoveryRate, interestEnabled } = metrics;
  const claimName = claim.name || claim.claim_id || 'Claim';

  return (
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
        {showFormulas && (
          <div style={{ color: COLORS.textMuted, fontSize: ui.sizes.xs, lineHeight: 1.8 }}>
            <div style={{ marginBottom: 8 }}>
              <strong style={{ color: COLORS.textBright }}>E[Principal]</strong> = Σ (E[Quantum|Win]ᵢ × Win_Rateᵢ) for each claim i
            </div>
            <div style={{ background: '#111827', padding: '6px 10px', borderRadius: 6, fontSize: ui.sizes.xs, marginBottom: 8 }}>
              <span style={{ color: COLORS.textBright, fontWeight: 600 }}>{claimName}:</span>{' '}
              <span style={{ color: COLORS.accent4 }}>{fmtCr(claim.expected_quantum_cr)}</span>{' × '}
              <span style={{ color: COLORS.accent2 }}>{fmtPct(claim.win_rate)}</span>{' = '}
              <span style={{ color: COLORS.accent3, fontWeight: 700 }}>{fmtCr((claim.expected_quantum_cr || 0) * (claim.win_rate || 0))}</span>
            </div>
            <div style={{ padding: '8px 12px', background: '#111827', borderRadius: 6 }}>
              <strong style={{ color: COLORS.accent3 }}>Total E[Principal]</strong> = <strong style={{ color: COLORS.accent3 }}>{fmtCr(totalPrincipal)}</strong>
              {interestEnabled && totalInterest > 0 && (
                <><br /><strong style={{ color: COLORS.accent4 }}>+ E[Interest]</strong> = {fmtCr(totalInterest)}</>
              )}
              <br /><strong style={{ color: COLORS.accent6 }}>= E[Collected]</strong> = <strong style={{ color: COLORS.accent6 }}>{fmtCr(totalCollected)}</strong> ({fmtPct(recoveryRate)} of SOC)
              <br /><strong style={{ color: COLORS.accent5 }}>- E[Legal]</strong> = {fmtCr(totalLegal)}
              <br /><strong style={{ color: netRecovery >= 0 ? '#22C55E' : COLORS.accent5 }}>= E[Net Recovery]</strong> = <strong style={{ color: netRecovery >= 0 ? '#22C55E' : COLORS.accent5 }}>{fmtCr(netRecovery)}</strong>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

/* ═══════════════════════════════════════════════════════════
 *  § 5 — Claim Overview Card
 * ═══════════════════════════════════════════════════════════ */
function ClaimOverviewCard({ claim }) {
  const { ui } = useUISettings();
  const od = claim.outcome_distribution || {};
  const total = (od.TRUE_WIN || 0) + (od.RESTART || 0) + (od.LOSE || 0);
  const isViable = claim.economically_viable !== false;
  const claimName = claim.name || claim.claim_id || 'Claim';

  return (
    <Card>
      <SectionTitle number="3" title="Claim Overview" subtitle="Summary statistics from Monte Carlo simulation" />
      <div style={{
        background: '#0F1219',
        border: `1px solid ${isViable ? COLORS.cardBorder : '#EF4444'}`,
        borderRadius: 10, padding: 16,
        opacity: isViable ? 1 : 0.85,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <span style={{ color: COLORS.textBright, fontSize: 14, fontWeight: 700 }}>
            {claimName}
            {!isViable && <span style={{ color: '#EF4444', fontSize: ui.sizes.xs, marginLeft: 6 }}>⚠️ UNVIABLE</span>}
          </span>
          <Badge
            text={(claim.archetype || '').replace(/_/g, ' ').toUpperCase()}
            color={claim.jurisdiction === 'siac' ? COLORS.accent2 : COLORS.accent1}
          />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: ui.space.sm, fontSize: ui.sizes.sm }}>
          <div>
            <span style={{ color: COLORS.textMuted }}>SOC:</span>{' '}
            <span style={{ color: COLORS.text, fontWeight: 600 }}>{fmtCr(claim.soc_value_cr)}</span>
          </div>
          <div>
            <span style={{ color: COLORS.textMuted }}>Win Rate:</span>{' '}
            <span style={{ color: COLORS.accent4, fontWeight: 600 }}>{fmtPct(claim.win_rate)}</span>
          </div>
          <div>
            <span style={{ color: COLORS.textMuted }}>Avg Dur:</span>{' '}
            <span style={{ color: COLORS.text, fontWeight: 600 }}>{(claim.mean_duration_months || 0).toFixed(1)}m</span>
          </div>
          <div>
            <span style={{ color: COLORS.textMuted }}>Jurisdiction:</span>{' '}
            <span style={{ color: COLORS.accent6, fontWeight: 600 }}>{(claim.jurisdiction || '').toUpperCase()}</span>
          </div>
        </div>
        {total > 0 && (
          <>
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
          </>
        )}
      </div>
    </Card>
  );
}

/* ═══════════════════════════════════════════════════════════
 *  Main Component
 * ═══════════════════════════════════════════════════════════ */
export default function ClaimExecutiveSummary({ data, stochasticData }) {
  const { ui } = useUISettings();
  const claim = data?.claims?.[0];

  if (!claim) {
    return (
      <Card>
        <div style={{ textAlign: 'center', padding: 40, color: COLORS.textMuted }}>
          No claim data available.
        </div>
      </Card>
    );
  }

  // ── Derived portfolio metrics (single claim) ──
  const meta = data?.simulation_meta || {};
  const totalSOC = claim.soc_value_cr || 0;
  const totalEQ = claim.expected_quantum_cr || 0;
  const totalPrincipal = totalEQ * (claim.win_rate || 0);
  const totalInterest = claim.interest_stats?.mean || 0;
  const totalCollected = totalPrincipal + totalInterest;
  const totalLegal = claim.legal_cost_stats?.mean || 0;
  const netRecovery = totalCollected - totalLegal;
  const recoveryRate = totalSOC > 0 ? totalCollected / totalSOC : 0;
  const eqToSOC = totalSOC > 0 ? totalEQ / totalSOC : 0;
  const principalToSOC = totalSOC > 0 ? totalPrincipal / totalSOC : 0;
  const legalRatio = totalCollected > 0 ? totalLegal / totalCollected : 0;
  const interestEnabled = meta.interest_enabled || totalInterest > 0;

  // ── Normalize mc_distributions keys for DistributionExplorer ──
  const normalizedData = useMemo(() => {
    if (!data) return data;
    const mc = data.mc_distributions;
    if (mc) {
      if (mc.xirr && !mc.irr) mc.irr = mc.xirr;
      if (mc.net_return_cr && !mc.net_recovery) mc.net_recovery = mc.net_return_cr;
    }
    return data;
  }, [data]);

  const metrics = { totalSOC, totalEQ, totalPrincipal, totalInterest, totalCollected, totalLegal, netRecovery, recoveryRate, interestEnabled };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: ui.space.xl }}>

      {/* §1 — Claim Identity Card */}
      <ClaimIdentityCard claim={claim} />

      {/* §2 — Portfolio Recovery Calculation (collapsible) */}
      <RecoveryCalculation claim={claim} metrics={metrics} />

      {/* §3 — Portfolio Value Chain KPI Row */}
      <div>
        <div style={{
          fontSize: ui.sizes.xs, color: COLORS.textMuted, textTransform: 'uppercase',
          letterSpacing: '0.08em', fontWeight: 700, marginBottom: ui.space.sm, paddingLeft: 4,
        }}>Portfolio Value Chain — SOC → E[Q|Win] → Principal → Collected → Net</div>
        <div style={{ display: 'grid', gridTemplateColumns: interestEnabled ? 'repeat(7, 1fr)' : 'repeat(6, 1fr)', gap: ui.space.md }}>
          <KPI label="Total SOC" value={fmtCr(totalSOC)} sub="1 claim" color={COLORS.accent1} />
          <KPI label="E[Quantum|Win]" value={fmtCr(totalEQ)} sub={`${fmtPct(eqToSOC)} of SOC`} color={COLORS.accent4} />
          <KPI label="Avg Win Rate" value={fmtPct(claim.win_rate)} sub="simple avg" color={COLORS.accent2} />
          <KPI label="E[Principal]" value={fmtCr(totalPrincipal)} sub={`${fmtPct(principalToSOC)} of SOC`} color={COLORS.accent3} />
          {interestEnabled && (
            <KPI label="E[Interest]" value={fmtCr(totalInterest)} sub={`${fmtPct(totalSOC > 0 ? totalInterest / totalSOC : 0)} of SOC`} color={COLORS.accent4} />
          )}
          <KPI label="E[Collected]" value={fmtCr(totalCollected)} sub="Principal + Interest" color={COLORS.accent6} />
          <KPI label="E[Net Recovery]" value={fmtCr(netRecovery)} sub={`After ₹${totalLegal.toFixed(0)} Cr legal`} color={netRecovery >= 0 ? '#22C55E' : COLORS.accent5} />
        </div>
      </div>

      {/* §4 — Supporting Metrics Row */}
      <div>
        <div style={{
          fontSize: ui.sizes.xs, color: COLORS.textMuted, textTransform: 'uppercase',
          letterSpacing: '0.08em', fontWeight: 700, marginBottom: ui.space.sm, paddingLeft: 4,
        }}>Supporting Metrics</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: ui.space.md }}>
          <KPI label="Avg Quantum/Claim" value={fmtCr(totalEQ)} sub={`Total E[Q|Win] ${fmtCr(totalEQ)}`} color={COLORS.accent4} />
          <KPI label="Avg Duration" value={`${(claim.mean_duration_months || 0).toFixed(1)}m`} sub="Time to resolution" color={COLORS.accent3} />
          <KPI label="E[Legal Costs]" value={fmtCr(totalLegal)} sub={`${fmtPct(legalRatio)} of collected`} color={COLORS.accent5} />
          <KPI label="Recovery Rate" value={fmtPct(recoveryRate)} sub="E[Collected] / SOC" color={COLORS.accent6} />
        </div>
      </div>

      {/* §5 — Claim Overview Card */}
      <ClaimOverviewCard claim={claim} />

      {/* §6 — Return Distribution (DistributionExplorer with 4 toggles) */}
      <Card>
        <SectionTitle number="4" title="Return Distribution" subtitle="Monte Carlo simulated outcomes — toggle metric, hover bars for details" />
        <DistributionExplorer data={normalizedData} defaultMetric="irr" height={280} compact />
      </Card>

      {/* §7 — Cashflow J-Curve (JCurveFanChart) */}
      <Card>
        <SectionTitle number="5" title="Cashflow J-Curve" subtitle="Cumulative cashflow — legal cost burn then settlement inflow" />
        <JCurveFanChart data={data} height={340} showControls={false} />
      </Card>
    </div>
  );
}
