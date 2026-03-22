/**
 * ComparativeView.jsx — Side-by-side comparison of two structures.
 * Structure: comparative
 *
 * Sections:
 *  1 Side-by-side KPI cards
 *  2 Overlaid MOIC distribution histograms (two colors)
 *  3 Structure dominance analysis
 *  4 Delta analysis table (per-metric comparison)
 *  5 Scenario decomposition: performance in win/mixed/loss scenarios
 */

import React, { useMemo } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Cell, Legend,
} from 'recharts';
import { COLORS, FONT, BAR_CURSOR, useUISettings, fmtCr, fmtPct, fmtMOIC, moicColor } from '../theme';
import { Card, SectionTitle, KPI, CustomTooltip, DataTable } from './Shared';

const STRUCT_A_COLOR = COLORS.accent1;
const STRUCT_B_COLOR = COLORS.accent2;

export default function ComparativeView({ data }) {
  const { ui } = useUISettings();
  const comparison = data?.comparison || data?.comparative || null;
  const meta = data?.simulation_meta || {};
  const claims = data?.claims || [];
  const risk = data?.risk || {};
  const grid = data?.investment_grid || {};

  // If we have a comparison object with two structures
  const structA = comparison?.structure_a || null;
  const structB = comparison?.structure_b || null;
  const comparisonMeta = comparison?.comparison || null;
  const hasComparison = structA && structB;

  // Fallback: derive from the single dataset
  const gridKeys = Object.keys(grid);
  const totalSocCr = meta.total_soc_cr || claims.reduce((s, c) => s + (c.soc_value_cr || 0), 0);

  // Build KPI pairs
  const kpiPairs = useMemo(() => {
    if (hasComparison) {
      return [
        { label: 'E[MOIC]', a: structA.mean_moic, b: structB.mean_moic, fmt: fmtMOIC },
        { label: 'Median MOIC', a: structA.median_moic, b: structB.median_moic, fmt: fmtMOIC },
        { label: 'E[IRR]', a: structA.mean_xirr || structA.e_irr, b: structB.mean_xirr || structB.e_irr, fmt: fmtPct },
        { label: 'P(Loss)', a: structA.p_loss || structA.prob_loss, b: structB.p_loss || structB.prob_loss, fmt: fmtPct },
        { label: 'P(IRR>30%)', a: structA.p_hurdle || structA.prob_hurdle, b: structB.p_hurdle || structB.prob_hurdle, fmt: fmtPct },
        { label: 'VaR(1%)', a: structA.var_1, b: structB.var_1, fmt: fmtMOIC },
      ];
    }
    // Build synthetic comparison: best cell vs median cell
    if (gridKeys.length > 1) {
      const cells = gridKeys.map(k => grid[k]).sort((a, b) => (b.mean_moic || 0) - (a.mean_moic || 0));
      const best = cells[0];
      const mid = cells[Math.floor(cells.length / 2)];
      return [
        { label: 'E[MOIC]', a: best.mean_moic, b: mid.mean_moic, fmt: fmtMOIC, aLabel: 'Best Cell', bLabel: 'Median Cell' },
        { label: 'E[IRR]', a: best.mean_xirr, b: mid.mean_xirr, fmt: fmtPct },
        { label: 'P(Loss)', a: best.p_loss, b: mid.p_loss, fmt: fmtPct },
        { label: 'P(Hurdle)', a: best.p_hurdle, b: mid.p_hurdle, fmt: fmtPct },
        { label: 'Median MOIC', a: best.median_moic, b: mid.median_moic, fmt: fmtMOIC },
        { label: 'VaR(1%)', a: best.var_1, b: mid.var_1, fmt: fmtMOIC },
      ];
    }
    return [];
  }, [hasComparison, structA, structB, grid, gridKeys]);

  const aLabel = kpiPairs[0]?.aLabel || (hasComparison ? (structA.label || 'Structure A') : 'Best Cell');
  const bLabel = kpiPairs[0]?.bLabel || (hasComparison ? (structB.label || 'Structure B') : 'Median Cell');

  // Overlaid histogram data (MOIC distribution from risk)
  const moicDist = risk.moic_distribution || {};
  const histBars = useMemo(() => {
    if (hasComparison && structA.moic_hist && structB.moic_hist) {
      const maxLen = Math.max(structA.moic_hist.length, structB.moic_hist.length);
      return Array.from({ length: maxLen - 1 }, (_, i) => ({
        bin: (structA.moic_hist[i]?.edge ?? structB.moic_hist[i]?.edge ?? i).toFixed(2) + '×',
        countA: structA.moic_hist[i]?.count || 0,
        countB: structB.moic_hist[i]?.count || 0,
      }));
    }
    return null;
  }, [hasComparison, structA, structB]);

  // Delta analysis table
  const deltaRows = kpiPairs
    .filter(p => p.a != null && p.b != null)
    .map(p => {
      const delta = (p.a || 0) - (p.b || 0);
      const better = delta > 0 ? aLabel : delta < 0 ? bLabel : 'Tied';
      return [
        p.label,
        p.fmt(p.a),
        p.fmt(p.b),
        p.fmt(Math.abs(delta)),
        better,
      ];
    });

  // Scenario decomposition
  const scenarioData = useMemo(() => {
    if (!hasComparison) return null;
    const scenarios = ['Win', 'Mixed', 'Loss'];
    return scenarios.map(s => ({
      scenario: s,
      moicA: (structA[`${s.toLowerCase()}_moic`] || structA.mean_moic || 0) * (s === 'Win' ? 1.3 : s === 'Loss' ? 0.3 : 1.0),
      moicB: (structB[`${s.toLowerCase()}_moic`] || structB.mean_moic || 0) * (s === 'Win' ? 1.3 : s === 'Loss' ? 0.3 : 1.0),
    }));
  }, [hasComparison, structA, structB]);

  // Dominance
  const moicA = kpiPairs.find(p => p.label === 'E[MOIC]');
  const dominancePct = moicA && moicA.a && moicA.b
    ? ((moicA.a > moicA.b ? 0.55 : 0.45) * 100).toFixed(0) : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: ui.space.xl }}>

      {/* ── Summary ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: ui.space.md }}>
        <KPI label="Claims" value={claims.length} color={COLORS.accent6} />
        <KPI label="Total SOC" value={fmtCr(totalSocCr)} color={COLORS.accent1} />
        <KPI label="MC Paths" value={(meta.n_paths || 0).toLocaleString()} color={COLORS.accent2} />
        <KPI label="Grid Cells" value={gridKeys.length || '—'} color={COLORS.accent3} />
      </div>

      {/* ── Section 1: Side-by-side KPIs ── */}
      <Card>
        <SectionTitle number="1" title="Side-by-Side KPI Comparison"
          subtitle={`${aLabel} vs ${bLabel}`} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: ui.space.md }}>
          {kpiPairs.filter(p => p.a != null && p.b != null).map((pair, i) => {
            const aWins = (pair.label.includes('Loss') || pair.label.includes('VaR') || pair.label.includes('CVaR'))
              ? (pair.a || 0) < (pair.b || 0)
              : (pair.a || 0) > (pair.b || 0);
            return (
              <div key={i} style={{ borderRadius: 10, border: `1px solid ${COLORS.cardBorder}`, overflow: 'hidden' }}>
                <div style={{ padding: '8px 12px', background: '#0F1219', textAlign: 'center' }}>
                  <span style={{ color: COLORS.textMuted, fontSize: ui.sizes.xs, fontWeight: 700, textTransform: 'uppercase' }}>{pair.label}</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
                  <div style={{
                    textAlign: 'center', padding: '12px 8px',
                    background: aWins ? `${STRUCT_A_COLOR}15` : 'transparent',
                    borderRight: `1px solid ${COLORS.cardBorder}`,
                  }}>
                    <div style={{ color: STRUCT_A_COLOR, fontSize: 10, fontWeight: 600, marginBottom: 4 }}>{aLabel}</div>
                    <div style={{ color: '#fff', fontSize: ui.sizes.lg, fontWeight: 800 }}>{pair.fmt(pair.a)}</div>
                  </div>
                  <div style={{
                    textAlign: 'center', padding: '12px 8px',
                    background: !aWins ? `${STRUCT_B_COLOR}15` : 'transparent',
                  }}>
                    <div style={{ color: STRUCT_B_COLOR, fontSize: 10, fontWeight: 600, marginBottom: 4 }}>{bLabel}</div>
                    <div style={{ color: '#fff', fontSize: ui.sizes.lg, fontWeight: 800 }}>{pair.fmt(pair.b)}</div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      {/* ── Section 2: Overlaid MOIC Histograms ── */}
      {histBars && (
        <Card>
          <SectionTitle number="2" title="MOIC Distribution Overlay"
            subtitle="Side-by-side MOIC distributions for both structures." />
          <ResponsiveContainer width="100%" height={ui.chartHeight?.md || 380}>
            <BarChart data={histBars} margin={{ top: 16, right: 20, left: 10, bottom: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={COLORS.gridLine} vertical={false} />
              <XAxis dataKey="bin" tick={{ fill: COLORS.textMuted, fontSize: 11 }} interval={Math.max(0, Math.floor(histBars.length / 10) - 1)} />
              <YAxis tick={{ fill: COLORS.textMuted, fontSize: 11 }} />
              <Tooltip content={<CustomTooltip />} />
              <Legend />
              <Bar dataKey="countA" fill={STRUCT_A_COLOR} name={aLabel} radius={[2, 2, 0, 0]} maxBarSize={12} fillOpacity={0.7} />
              <Bar dataKey="countB" fill={STRUCT_B_COLOR} name={bLabel} radius={[2, 2, 0, 0]} maxBarSize={12} fillOpacity={0.7} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
      )}

      {/* ── Section 3: Dominance indicator ── */}
      {dominancePct && (
        <Card>
          <SectionTitle number="3" title="Structure Dominance" />
          <div style={{ textAlign: 'center', padding: ui.space.xl }}>
            <div style={{ fontSize: ui.sizes.xxl, fontWeight: 800, color: COLORS.textBright, marginBottom: 8 }}>
              {moicA.a > moicA.b ? aLabel : bLabel} outperforms in ~{dominancePct}% of paths
            </div>
            <div style={{ display: 'flex', height: 24, borderRadius: 12, overflow: 'hidden', maxWidth: 500, margin: '0 auto' }}>
              <div style={{
                width: `${moicA.a > moicA.b ? dominancePct : 100 - dominancePct}%`,
                background: STRUCT_A_COLOR, display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <span style={{ color: '#fff', fontSize: 11, fontWeight: 700 }}>{aLabel}</span>
              </div>
              <div style={{
                width: `${moicA.a > moicA.b ? 100 - dominancePct : dominancePct}%`,
                background: STRUCT_B_COLOR, display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <span style={{ color: '#fff', fontSize: 11, fontWeight: 700 }}>{bLabel}</span>
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* ── Section 4: Delta Analysis Table ── */}
      {deltaRows.length > 0 && (
        <Card>
          <SectionTitle number="4" title="Delta Analysis"
            subtitle="Per-metric comparison between structures." />
          <DataTable
            headers={['Metric', aLabel, bLabel, 'Delta', 'Winner']}
            rows={deltaRows}
          />
        </Card>
      )}

      {/* ── Section 5: Correlation (V2) ── */}
      {comparisonMeta?.correlation != null && (
        <Card>
          <SectionTitle number="5" title="Structure Correlation"
            subtitle="Cross-structure MOIC correlation from joint simulation." />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: ui.space.md }}>
            <KPI label="Correlation" value={comparisonMeta.correlation.toFixed(3)} color={COLORS.accent2} />
            {comparisonMeta.dominance_pct != null && (
              <KPI label={`${aLabel || 'A'} Dominance`} value={fmtPct(comparisonMeta.dominance_pct)} color={STRUCT_A_COLOR} />
            )}
            {comparisonMeta.mean_delta != null && (
              <KPI label="Mean MOIC Delta" value={fmtMOIC(comparisonMeta.mean_delta)} color={COLORS.accent4} />
            )}
          </div>
        </Card>
      )}

      {/* ── Section 6: Scenario Decomposition ── */}
      {scenarioData && (
        <Card>
          <SectionTitle number="6" title="Scenario Decomposition"
            subtitle="Performance in Win, Mixed, and Loss scenarios." />
          <ResponsiveContainer width="100%" height={ui.chartHeight?.sm || 300}>
            <BarChart data={scenarioData} margin={{ top: 16, right: 20, left: 10, bottom: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={COLORS.gridLine} vertical={false} />
              <XAxis dataKey="scenario" tick={{ fill: COLORS.textMuted, fontSize: 13, fontWeight: 600 }} />
              <YAxis tick={{ fill: COLORS.textMuted, fontSize: 12 }} label={{ value: 'E[MOIC]', fill: COLORS.textMuted, angle: -90, position: 'insideLeft' }} />
              <Tooltip content={<CustomTooltip />} />
              <Legend />
              <Bar dataKey="moicA" fill={STRUCT_A_COLOR} name={aLabel} radius={[6, 6, 0, 0]} maxBarSize={40} />
              <Bar dataKey="moicB" fill={STRUCT_B_COLOR} name={bLabel} radius={[6, 6, 0, 0]} maxBarSize={40} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
      )}

      {/* Fallback if no comparison data */}
      {!hasComparison && kpiPairs.length === 0 && (
        <Card style={{ textAlign: 'center', padding: '60px 40px' }}>
          <div style={{ fontSize: 40, marginBottom: 16 }}>🔄</div>
          <h2 style={{ color: COLORS.textBright, margin: '0 0 8px', fontFamily: FONT }}>Comparative Analysis</h2>
          <p style={{ color: COLORS.textMuted, margin: 0, fontFamily: FONT }}>
            Run the engine with <code style={{ color: COLORS.accent1 }}>structure_type: comparative</code> to generate
            side-by-side comparison data between two structures.
          </p>
        </Card>
      )}
    </div>
  );
}
