/**
 * ClaimExport.jsx — Single-claim Export & Reports tab (Tab 8).
 *
 * Thin wrapper around ExportPanel with a Claim Score Card header.
 * Shows: Claim Name, Jurisdiction, SOC, Win Rate, E[MOIC], E[IRR], P(Loss), Risk Grade.
 */

import React, { useMemo } from 'react';
import { COLORS, FONT, useUISettings, fmtCr, fmtPct, fmtMOIC } from '../../theme';
import { Card, SectionTitle } from '../Shared';
import ExportPanel from '../ExportPanel';

/* ═══════════════════════════════════════════════════════════
 *  Risk Grade Computation
 * ═══════════════════════════════════════════════════════════ */
function getRiskGrade(pLoss) {
  if (pLoss == null) return { label: 'N/A', color: COLORS.textMuted };
  if (pLoss < 0.20) return { label: 'Low Risk', color: '#34D399' };
  if (pLoss <= 0.40) return { label: 'Moderate', color: COLORS.accent3 };
  return { label: 'High Risk', color: COLORS.accent5 };
}

/* ═══════════════════════════════════════════════════════════
 *  Claim Score Card
 * ═══════════════════════════════════════════════════════════ */
function ScoreCard({ data }) {
  const { ui } = useUISettings();
  const claim = data?.claims?.[0] || {};
  const risk = data?.risk || {};
  const ig = data?.investment_grid || {};
  const moicDist = risk.moic_distribution || {};
  const irrDist = risk.irr_distribution || {};

  const refKey = Object.keys(ig)[0];
  const ref = ig[refKey] || {};

  const eMoic = ref.mean_moic || moicDist.mean || moicDist.p50 || 0;
  const eIrr = ref.mean_xirr || irrDist.mean || irrDist.p50 || 0;
  const pLoss = ref.p_loss ?? null;

  const grade = useMemo(() => getRiskGrade(pLoss), [pLoss]);

  const fields = [
    { label: 'Claim Name', value: claim.name || claim.claim_id || 'N/A' },
    { label: 'Jurisdiction', value: (claim.jurisdiction || 'N/A').toUpperCase().replace(/_/g, ' ') },
    { label: 'SOC', value: fmtCr(claim.soc_value_cr) },
    { label: 'Win Rate', value: fmtPct(claim.win_rate || claim.effective_win_rate || 0) },
    { label: 'E[MOIC]', value: fmtMOIC(eMoic), color: eMoic >= 2.0 ? '#34D399' : eMoic >= 1.0 ? COLORS.accent3 : COLORS.accent5 },
    { label: 'E[IRR]', value: fmtPct(eIrr), color: eIrr >= 0.25 ? '#34D399' : eIrr >= 0.10 ? COLORS.accent3 : COLORS.accent5 },
    { label: 'P(Loss)', value: pLoss != null ? fmtPct(pLoss) : 'N/A', color: pLoss != null ? (pLoss < 0.2 ? '#34D399' : COLORS.accent5) : COLORS.textMuted },
    { label: 'Risk Grade', value: grade.label, color: grade.color },
  ];

  return (
    <Card>
      <SectionTitle number="" title="Claim Score Card"
        subtitle="Summary of key metrics for this claim" />
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: ui.space.md,
        marginTop: ui.space.md,
      }}>
        {fields.map(f => (
          <div key={f.label} style={{
            padding: `${ui.space.md}px ${ui.space.lg}px`,
            background: '#0F1219',
            borderRadius: 10,
            border: `1px solid ${COLORS.cardBorder}`,
          }}>
            <div style={{
              color: COLORS.textMuted, fontSize: ui.sizes.sm, fontWeight: 600,
              textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6,
            }}>
              {f.label}
            </div>
            <div style={{
              color: f.color || COLORS.textBright,
              fontSize: ui.sizes.lg, fontWeight: 700, fontFamily: FONT,
            }}>
              {f.value}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

/* ═══════════════════════════════════════════════════════════
 *  MAIN EXPORT
 * ═══════════════════════════════════════════════════════════ */
export default function ClaimExport({ data }) {
  const { ui } = useUISettings();

  if (!data) {
    return <div style={{ color: COLORS.textMuted, textAlign: 'center', padding: 60 }}>No data available</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: ui.space.xl }}>
      <ScoreCard data={data} />
      <ExportPanel data={data} />
    </div>
  );
}
