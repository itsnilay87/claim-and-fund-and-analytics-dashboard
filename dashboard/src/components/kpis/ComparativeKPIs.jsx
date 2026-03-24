import React from 'react';
import { COLORS, fmtPct, fmtMOIC } from '../../theme';
import { Card, KPI } from '../Shared';
import useKPIData from './useKPIData';

export default function ComparativeKPIs({ data }) {
  const { ui, ig, favorColor } = useKPIData(data);
  const keys = Object.keys(ig).slice(0, 2);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: ui.space.lg }}>
      {keys.map(k => {
        const r = ig[k] || {};
        const [up, tail] = k.split('_');
        return (
          <Card key={k} style={{ padding: ui.space.md }}>
            <div style={{ color: COLORS.textMuted, fontSize: ui.sizes.xs, fontWeight: 700, textTransform: 'uppercase', marginBottom: 8, textAlign: 'center' }}>
              {up}% Upfront / {tail}% Tail
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: ui.space.sm }}>
              <KPI label="E[MOIC]" value={fmtMOIC(r.mean_moic || 0)} color={favorColor(r.mean_moic || 0, 2.0, 1.0)} />
              <KPI label="E[IRR]" value={fmtPct(r.mean_xirr || 0)} color={favorColor(r.mean_xirr || 0, 0.25, 0.10)} />
              <KPI label="P(Loss)" value={fmtPct(r.p_loss || 0)} color={(r.p_loss || 0) < 0.2 ? '#34D399' : COLORS.accent5} />
            </div>
          </Card>
        );
      })}
    </div>
  );
}
