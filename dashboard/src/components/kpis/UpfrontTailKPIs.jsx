import React from 'react';
import { COLORS, fmtCr, fmtPct, fmtMOIC } from '../../theme';
import { KPI } from '../Shared';
import useKPIData from './useKPIData';

export default function UpfrontTailKPIs({ data }) {
  const { ui, meta, refKey, totalSOC, totalCollected, totalNet, eMoic, eIrr, pLoss, pHurdle, favorColor } = useKPIData(data);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: ui.space.md }}>
      <KPI label="Total SOC" value={fmtCr(totalSOC)} sub={`${meta.n_claims} claims`} color={COLORS.accent1} />
      <KPI label="E[MOIC]" value={fmtMOIC(eMoic)} sub={refKey ? `at ${refKey.replace('_', '/')}` : ''} color={favorColor(eMoic, 2.0, 1.0)} />
      <KPI label="E[IRR]" value={fmtPct(eIrr)} sub={refKey ? `at ${refKey.replace('_', '/')}` : ''} color={favorColor(eIrr, 0.25, 0.10)} />
      <KPI label="P(Loss)" value={fmtPct(pLoss)} color={pLoss < 0.2 ? '#34D399' : COLORS.accent5} />
      <KPI label="P(Hurdle)" value={fmtPct(pHurdle)} color={pHurdle > 0.4 ? '#34D399' : COLORS.accent3} />
      <KPI label="E[Recovery]" value={fmtCr(totalCollected)} sub={`Net ${fmtCr(totalNet)}`} color={totalNet >= 0 ? '#34D399' : COLORS.accent5} />
    </div>
  );
}
