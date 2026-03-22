/**
 * ExecutiveSummary.jsx — Tab 1: Adaptive executive summary.
 *
 * Sections:
 *   1. KPI cards (structure-adaptive)
 *   2. Claim breakdown (donut + jurisdiction bar + type bar)
 *   3. Portfolio MOIC distribution (DistributionExplorer)
 *   4. J-Curve fan chart (JCurveFanChart)
 */

import React, { useMemo } from 'react';
import {
  Tooltip, ResponsiveContainer, PieChart, Pie, Cell,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
} from 'recharts';
import { COLORS, FONT, CHART_COLORS, useUISettings, fmtCr, fmtPct, fmtMOIC } from '../theme';
import { Card, SectionTitle, KPI, CustomTooltip, Badge } from './Shared';
import JCurveFanChart from './JCurveFanChart';
import DistributionExplorer from './DistributionExplorer';

/* ═══════════════════════════════════════════════════════════
 *  Structure-adaptive KPI row
 * ═══════════════════════════════════════════════════════════ */
function KPIRow({ data, structureType }) {
  const { ui } = useUISettings();
  const meta = data.simulation_meta || {};
  const ig = data.investment_grid || {};
  const ca = data.cashflow_analysis || {};
  const risk = data.risk || {};
  const moicDist = risk.moic_distribution || {};
  const irrDist = risk.irr_distribution || {};

  // Reference deal point — pick a sensible default from investment_grid
  const refKey = ig['10_20'] ? '10_20' : ig['10_10'] ? '10_10' : Object.keys(ig)[0];
  const ref = ig[refKey] || {};
  const totalSOC = meta.total_soc_cr || 0;
  const ps = ca.portfolio_summary || {};
  const totalCollected = ps.total_e_collected_cr || 0;
  const totalLegal = ps.total_e_legal_cr || 0;
  const totalNet = ps.total_e_net_cr || 0;

  const eMoic = ref.mean_moic || moicDist.p50 || 0;
  const eIrr = ref.mean_xirr || irrDist.p50 || 0;
  const pLoss = ref.p_loss ?? 0;
  const pHurdle = ref.p_hurdle ?? 0;

  const favorColor = (v, good, bad) => v >= good ? '#34D399' : v >= bad ? COLORS.accent3 : COLORS.accent5;

  if (structureType === 'litigation_funding') {
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

  if (structureType === 'monetisation_full_purchase') {
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

  if (structureType === 'monetisation_staged') {
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

  if (structureType === 'comparative') {
    // Side-by-side — show two key reference points
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

  // Default: monetisation_upfront_tail
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

/* ═══════════════════════════════════════════════════════════
 *  Main component
 * ═══════════════════════════════════════════════════════════ */
export default function ExecutiveSummary({ data, structureType }) {
  const { ui } = useUISettings();
  const claims = data?.claims || [];
  const meta = data?.simulation_meta || {};
  const risk = data?.risk || {};

  // Pie data — SOC distribution
  const pieData = useMemo(() =>
    claims.map((c, i) => ({
      name: c.name || c.claim_id,
      value: c.soc_value_cr,
      fill: CHART_COLORS[i % CHART_COLORS.length],
    })),
  [claims]);

  // Jurisdiction bar data
  const jurisdictionData = useMemo(() => {
    const jb = risk.concentration?.jurisdiction_breakdown || {};
    return Object.entries(jb).map(([k, v]) => ({
      name: k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
      weight: +(v * 100).toFixed(1),
    }));
  }, [risk]);

  // Claim type bar data
  const typeData = useMemo(() => {
    const tb = risk.concentration?.type_breakdown || {};
    return Object.entries(tb).map(([k, v]) => ({
      name: k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
      weight: +(v * 100).toFixed(1),
    }));
  }, [risk]);

  // J-curve default scenario key
  const jcDefault = data?.jcurve_data?.default_key || null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: ui.space.xl }}>

      {/* Section 1 — KPI Cards */}
      <div>
        <div style={{
          fontSize: ui.sizes.xs, color: COLORS.textMuted, textTransform: 'uppercase',
          letterSpacing: '0.08em', fontWeight: 700, marginBottom: ui.space.sm, paddingLeft: 4,
        }}>Portfolio KPIs</div>
        <KPIRow data={data} structureType={structureType} />
      </div>

      {/* Section 2 — Claim Breakdown */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: ui.space.lg }}>
        {/* Donut */}
        <Card>
          <SectionTitle number="1" title="SOC Distribution" subtitle="₹ Crore by claim" />
          <ResponsiveContainer width="100%" height={ui.chartHeight.sm}>
            <PieChart>
              <Pie
                data={pieData} cx="50%" cy="50%"
                innerRadius={55} outerRadius={90} paddingAngle={3} dataKey="value"
                label={({ name, value }) => `${name.length > 12 ? name.slice(0, 12) + '…' : name}: ₹${value.toFixed(0)}`}
                labelLine={{ stroke: COLORS.textMuted }}
              >
                {pieData.map((d, i) => <Cell key={i} fill={d.fill} />)}
              </Pie>
              <Tooltip content={<CustomTooltip />} />
            </PieChart>
          </ResponsiveContainer>
        </Card>

        {/* Jurisdiction */}
        <Card>
          <SectionTitle number="2" title="Jurisdiction Breakdown" subtitle="SOC weight by jurisdiction" />
          {jurisdictionData.length > 0 ? (
            <ResponsiveContainer width="100%" height={ui.chartHeight.sm}>
              <BarChart data={jurisdictionData} layout="vertical" margin={{ top: 5, right: 30, left: 10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={COLORS.gridLine} />
                <XAxis type="number" tick={{ fill: COLORS.textMuted, fontSize: ui.sizes.sm }} unit="%" />
                <YAxis type="category" dataKey="name" width={120} tick={{ fill: COLORS.text, fontSize: ui.sizes.sm }} />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="weight" name="Weight %" fill={COLORS.accent6} radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div style={{ color: COLORS.textMuted, padding: 40, textAlign: 'center' }}>No jurisdiction data</div>
          )}
        </Card>

        {/* Claim type */}
        <Card>
          <SectionTitle number="3" title="Claim Type Distribution" subtitle="SOC weight by type" />
          {typeData.length > 0 ? (
            <ResponsiveContainer width="100%" height={ui.chartHeight.sm}>
              <BarChart data={typeData} layout="vertical" margin={{ top: 5, right: 30, left: 10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={COLORS.gridLine} />
                <XAxis type="number" tick={{ fill: COLORS.textMuted, fontSize: ui.sizes.sm }} unit="%" />
                <YAxis type="category" dataKey="name" width={120} tick={{ fill: COLORS.text, fontSize: ui.sizes.sm }} />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="weight" name="Weight %" fill={COLORS.accent2} radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div style={{ color: COLORS.textMuted, padding: 40, textAlign: 'center' }}>No type data</div>
          )}
        </Card>
      </div>

      {/* Section 3 — Portfolio MOIC Distribution */}
      <Card>
        <SectionTitle number="4" title="Return Distribution" subtitle="Monte Carlo simulated outcomes — toggle metric, hover bars for details" />
        <DistributionExplorer data={data} defaultMetric="moic" height={300} />
      </Card>

      {/* Section 3b — MC Distribution Summary (V2 enhanced) */}
      {data?.mc_distributions && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: ui.space.lg }}>
          {['moic', 'irr', 'duration'].map(metric => {
            const dist = data.mc_distributions[metric];
            if (!dist) return null;
            const label = metric === 'moic' ? 'MOIC' : metric === 'irr' ? 'IRR' : 'Duration (months)';
            return (
              <Card key={metric}>
                <SectionTitle title={`${label} Distribution`} subtitle="P5 / P25 / P50 / P75 / P95" />
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8, textAlign: 'center' }}>
                  {['p5', 'p25', 'p50', 'p75', 'p95'].map(pct => (
                    <div key={pct}>
                      <div style={{ color: COLORS.textMuted, fontSize: ui.sizes.xs, fontWeight: 600, textTransform: 'uppercase' }}>{pct}</div>
                      <div style={{ color: COLORS.textBright, fontSize: ui.sizes.lg, fontWeight: 800, marginTop: 4 }}>
                        {metric === 'moic' ? fmtMOIC(dist[pct] || 0) :
                         metric === 'irr' ? fmtPct(dist[pct] || 0) :
                         (dist[pct] || 0).toFixed(0) + 'm'}
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Section 4 — J-Curve Fan Chart */}
      <Card>
        <SectionTitle number="5" title="Cashflow J-Curve" subtitle="Cumulative portfolio cashflow over time — percentile bands" />
        {jcDefault ? (
          <JCurveFanChart data={data} height={ui.chartHeight.md} scenarioKey={jcDefault} showControls />
        ) : (
          <div style={{ color: COLORS.textMuted, padding: 40, textAlign: 'center' }}>
            No J-curve data available. Re-run simulation to generate cashflow percentile bands.
          </div>
        )}
      </Card>
    </div>
  );
}
