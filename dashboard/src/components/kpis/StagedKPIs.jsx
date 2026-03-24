import React from 'react';
import { COLORS, fmtCr, fmtPct, fmtMOIC } from '../../theme';
import { KPI } from '../Shared';
import useKPIData from './useKPIData';

export default function StagedKPIs({ data }) {
  const { ui, meta, totalSOC, totalNet, eMoic, eIrr, pLoss, favorColor } = useKPIData(data);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: ui.space.md }}>
      <KPI label="Total Expected Investment" value={fmtCr(totalSOC * 0.10)} sub={`${meta.n_claims} claims`} color={COLORS.accent1} />
      <KPI label="E[MOIC]" value={fmtMOIC(eMoic)} color={favorColor(eMoic, 2.0, 1.0)} />
      <KPI label="E[IRR]" value={fmtPct(eIrr)} color={favorColor(eIrr, 0.25, 0.10)} />
      <KPI label="P(Loss)" value={fmtPct(pLoss)} color={pLoss < 0.2 ? '#34D399' : COLORS.accent5} />
      <KPI label="E[Net Recovery]" value={fmtCr(totalNet)} color={totalNet >= 0 ? '#34D399' : COLORS.accent5} />
    </div>
  );
}
