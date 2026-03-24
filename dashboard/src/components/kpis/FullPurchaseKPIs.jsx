import React from 'react';
import { COLORS, fmtCr, fmtPct, fmtMOIC } from '../../theme';
import { KPI } from '../Shared';
import useKPIData from './useKPIData';

export default function FullPurchaseKPIs({ data }) {
  const { ui, meta, refKey, totalSOC, eMoic, eIrr, pLoss, favorColor } = useKPIData(data);
  const purchasePrice = totalSOC * (refKey ? parseFloat(refKey.split('_')[0]) / 100 : 0.10);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: ui.space.md }}>
      <KPI label="Total Purchase Price" value={fmtCr(purchasePrice)} sub={`${meta.n_claims} claims`} color={COLORS.accent1} />
      <KPI label="E[MOIC]" value={fmtMOIC(eMoic)} color={favorColor(eMoic, 2.0, 1.0)} />
      <KPI label="E[IRR]" value={fmtPct(eIrr)} color={favorColor(eIrr, 0.25, 0.10)} />
      <KPI label="P(Loss)" value={fmtPct(pLoss)} color={pLoss < 0.2 ? '#34D399' : COLORS.accent5} />
      <KPI label="Breakeven Price" value={fmtPct(0)} sub="See pricing grid" color={COLORS.accent3} />
    </div>
  );
}
