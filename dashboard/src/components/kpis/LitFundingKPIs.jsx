import React from 'react';
import { COLORS, fmtCr, fmtPct, fmtMOIC } from '../../theme';
import { KPI } from '../Shared';
import useKPIData from './useKPIData';

export default function LitFundingKPIs({ data }) {
  const { ui, meta, moicDist, eMoic, eIrr, pLoss, totalLegal, favorColor } = useKPIData(data);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: ui.space.md }}>
      <KPI label="Total Legal Costs" value={fmtCr(totalLegal)} sub={`${meta.n_claims} claims`} color={COLORS.accent5} />
      <KPI label="E[MOIC]" value={fmtMOIC(eMoic)} color={favorColor(eMoic, 2.0, 1.0)} />
      <KPI label="E[IRR]" value={fmtPct(eIrr)} color={favorColor(eIrr, 0.25, 0.10)} />
      <KPI label="P(Loss)" value={fmtPct(pLoss)} color={pLoss < 0.2 ? '#34D399' : COLORS.accent5} />
      <KPI label="P(Total Loss)" value={fmtPct(moicDist.p5 === 0 ? pLoss : pLoss * 0.5)} color={COLORS.accent5} />
      <KPI label="Fund Return" value={fmtMOIC(eMoic)} sub="E[Portfolio MOIC]" color={COLORS.accent2} />
    </div>
  );
}
