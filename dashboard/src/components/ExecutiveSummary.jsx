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
} from 'recharts';
import { COLORS, FONT, CHART_COLORS, useUISettings, fmtCr } from '../theme';
import { Card, SectionTitle, KPI, CustomTooltip } from './Shared';
import { getClaimDisplayName } from '../utils/claimNames';
import JCurveFanChart from './JCurveFanChart';
import DistributionExplorer from './DistributionExplorer';
import BreakdownTreemap from './BreakdownTreemap';
import KPIRow from './kpis';

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
      name: getClaimDisplayName(c),
      value: c.soc_value_cr,
      fill: CHART_COLORS[i % CHART_COLORS.length],
    })),
  [claims]);

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

        {/* Jurisdiction × Claim treemap */}
        <Card>
          <SectionTitle
            number="2"
            title="Jurisdiction × Claim"
            subtitle="Hierarchical SOC weight — tile size = SOC, hue = jurisdiction"
          />
          <BreakdownTreemap
            claims={claims}
            groupBy="jurisdiction"
            height={ui.chartHeight.sm}
            emptyText="Jurisdiction data unavailable. Ensure claims include a jurisdiction and SOC value."
          />
        </Card>

        {/* Claim type × Claim treemap */}
        <Card>
          <SectionTitle
            number="3"
            title="Claim Type × Claim"
            subtitle="Hierarchical SOC weight — tile size = SOC, hue = claim type"
          />
          <BreakdownTreemap
            claims={claims}
            groupBy="claim_type"
            height={ui.chartHeight.sm}
            emptyText="Claim type data unavailable. Ensure claims include claim_type and SOC value."
          />
        </Card>
      </div>

      {/* Section 3 — Portfolio MOIC Distribution */}
      <Card>
        <SectionTitle number="4" title="Return Distribution" subtitle="Monte Carlo simulated outcomes — toggle metric, hover bars for details" />
        <DistributionExplorer data={data} defaultMetric="moic" height={300} />
      </Card>

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
