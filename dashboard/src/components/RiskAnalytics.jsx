/**
 * RiskAnalytics.jsx — Risk Analytics tab (NEW universal tab).
 *
 * Sections:
 *   1. Distribution Dashboards — MOIC, IRR, Duration histograms
 *   2. Capital at Risk — cumulative capital deployed over time
 *   3. Concentration Metrics — Herfindahl indices, portfolio weights
 *   4. Sensitivity — E[MOIC] vs P(win) sweep
 *   5. Stress Scenarios — table of portfolio metrics under stress
 */

import React, { useMemo } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Cell, Legend,
  LineChart, Line, ReferenceLine, ComposedChart, Area,
} from 'recharts';
import { COLORS, FONT, CHART_COLORS, useUISettings, fmtCr, fmtPct, fmtMOIC, fmtMo } from '../theme';
import { Card, SectionTitle, KPI, CustomTooltip, DataTable } from './Shared';

const NODATA = <span style={{ color: COLORS.textMuted }}>Data not available</span>;

/* ── Gauge component for Herfindahl index ── */
function HerfindahlGauge({ value, label, style }) {
  const pct = Math.min(value || 0, 1);
  const color = pct > 0.7 ? COLORS.accent5 : pct > 0.4 ? COLORS.accent3 : COLORS.accent4;
  const desc = pct > 0.7 ? 'Concentrated' : pct > 0.4 ? 'Moderate' : 'Diversified';

  return (
    <div style={{ textAlign: 'center', ...style }}>
      <div style={{ fontSize: 13, color: COLORS.textMuted, fontWeight: 600, marginBottom: 8, fontFamily: FONT }}>{label}</div>
      <div style={{ position: 'relative', width: 120, height: 12, borderRadius: 6, background: '#1F2937', margin: '0 auto' }}>
        <div style={{
          position: 'absolute', top: 0, left: 0, height: 12, borderRadius: 6,
          width: `${pct * 100}%`, background: color, transition: 'width 0.6s ease',
        }} />
      </div>
      <div style={{ marginTop: 6, fontSize: 22, fontWeight: 800, color, fontFamily: FONT }}>{pct.toFixed(3)}</div>
      <div style={{ fontSize: 12, color: COLORS.textMuted }}>{desc}</div>
    </div>
  );
}

/* ── Build distribution bar data from percentiles ── */
function buildDistBars(distObj, formatter) {
  if (!distObj) return [];
  const keys = ['p1', 'p5', 'p10', 'p25', 'p50', 'p75', 'p90', 'p95', 'p99'];
  return keys.filter(k => distObj[k] != null).map(k => ({
    label: k.toUpperCase(),
    value: distObj[k],
    formatted: formatter ? formatter(distObj[k]) : distObj[k],
  }));
}

export default function RiskAnalytics({ data }) {
  const { ui } = useUISettings();
  const risk = data?.risk;
  const sensitivity = data?.sensitivity;
  const simMeta = data?.simulation_meta || {};

  if (!risk && !sensitivity) return <Card>{NODATA}</Card>;

  const moicDist = risk?.moic_distribution;
  const irrDist = risk?.irr_distribution;
  const durDist = risk?.duration_distribution;
  const carTimeline = risk?.capital_at_risk_timeline || [];
  const concentration = risk?.concentration;
  const stress = risk?.stress_scenarios || [];

  /* ── Distribution bar data ── */
  const moicBars = buildDistBars(moicDist, v => fmtMOIC(v));
  const irrBars = buildDistBars(irrDist, v => fmtPct(v));
  const durBars = buildDistBars(durDist?.portfolio, v => fmtMo(v));

  /* ── VaR / CVaR markers ── */
  const var1 = moicDist?.p1;

  /* ── Capital at Risk line data ── */
  const carData = carTimeline.map(d => ({
    month: `M${d.month}`,
    p50: d.p50_deployed_cr,
    p95: d.p95_deployed_cr,
  }));

  /* ── Concentration breakdown data ── */
  const jurBreakdown = concentration?.jurisdiction_breakdown || {};
  const typeBreakdown = concentration?.type_breakdown || {};
  const weightData = [
    ...Object.entries(jurBreakdown).map(([k, v]) => ({ name: k.replace(/_/g, ' '), weight: +(v * 100).toFixed(1), type: 'jurisdiction' })),
    ...Object.entries(typeBreakdown).map(([k, v]) => ({ name: k.replace(/_/g, ' '), weight: +(v * 100).toFixed(1), type: 'claim_type' })),
  ];

  /* ── Sensitivity data ── */
  const sensData = useMemo(() => {
    if (!sensitivity || !Array.isArray(sensitivity)) return [];
    return sensitivity.map(s => ({
      pWin: +(s.arb_win_prob * 100).toFixed(0),
      moic: s.e_moic,
      irr: s.e_irr,
      pLoss: s.p_loss,
    }));
  }, [sensitivity]);

  /* Find current arb_win_prob from claims */
  const currentPWin = useMemo(() => {
    const claims = data?.claims || [];
    if (claims.length === 0) return null;
    const avgWin = claims.reduce((s, c) => s + (c.win_rate || 0), 0) / claims.length;
    return avgWin;
  }, [data]);

  /* Find breakeven P(win) ≈ where MOIC crosses 1.0 */
  const breakevenPWin = useMemo(() => {
    if (!sensData.length) return null;
    for (let i = 1; i < sensData.length; i++) {
      if (sensData[i - 1].moic < 1.0 && sensData[i].moic >= 1.0) {
        // Linear interpolation
        const frac = (1.0 - sensData[i - 1].moic) / (sensData[i].moic - sensData[i - 1].moic);
        return sensData[i - 1].pWin + frac * (sensData[i].pWin - sensData[i - 1].pWin);
      }
    }
    return null;
  }, [sensData]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: ui.space.xl }}>

      {/* KPI Row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: ui.space.md }}>
        {moicDist?.p50 != null && <KPI label="Median MOIC" value={fmtMOIC(moicDist.p50)} color={COLORS.accent4} />}
        {irrDist?.p50 != null && <KPI label="Median IRR" value={fmtPct(irrDist.p50)} color={COLORS.accent2} />}
        {var1 != null && <KPI label="VaR (1st pctl) MOIC" value={fmtMOIC(var1)} color={COLORS.accent5} />}
        {durDist?.portfolio?.p50 != null && <KPI label="Portfolio P50 Duration" value={fmtMo(durDist.portfolio.p50)} color={COLORS.accent3} />}
        {concentration?.herfindahl_by_jurisdiction != null && (
          <KPI label="HHI (Jurisdiction)" value={concentration.herfindahl_by_jurisdiction.toFixed(3)} color={COLORS.accent1} />
        )}
      </div>

      {/* ═══ SECTION 1: DISTRIBUTION DASHBOARDS ═══ */}

      {/* MOIC Distribution */}
      {moicBars.length > 0 && (
        <Card>
          <SectionTitle number="1" title="MOIC Distribution"
            subtitle="Portfolio multiple on invested capital across MC percentiles. VaR (P1) and median marked." />
          <ResponsiveContainer width="100%" height={320}>
            <BarChart data={moicBars} margin={{ top: 10, right: 20, left: 10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={COLORS.gridLine} />
              <XAxis dataKey="label" tick={{ fill: COLORS.textMuted, fontSize: ui.sizes.sm }} />
              <YAxis tick={{ fill: COLORS.textMuted, fontSize: ui.sizes.sm }} />
              <Tooltip cursor={{ fill: 'rgba(6,182,212,0.06)' }} content={<CustomTooltip />} />
              <ReferenceLine y={1.0} stroke={COLORS.accent3} strokeDasharray="6 3" strokeWidth={1.5}
                label={{ value: '1.0× (Breakeven)', fill: COLORS.accent3, fontSize: 11, position: 'right' }} />
              <Bar dataKey="value" name="MOIC" radius={[6, 6, 0, 0]} barSize={36}>
                {moicBars.map((d, i) => (
                  <Cell key={i} fill={d.value >= 1 ? COLORS.accent4 : COLORS.accent5} fillOpacity={d.label === 'P1' || d.label === 'P5' ? 0.6 : 0.9} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>
      )}

      {/* IRR Distribution */}
      {irrBars.length > 0 && (
        <Card>
          <SectionTitle number="2" title="IRR Distribution"
            subtitle="Portfolio internal rate of return across MC percentiles." />
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={irrBars} margin={{ top: 10, right: 20, left: 10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={COLORS.gridLine} />
              <XAxis dataKey="label" tick={{ fill: COLORS.textMuted, fontSize: ui.sizes.sm }} />
              <YAxis tick={{ fill: COLORS.textMuted, fontSize: ui.sizes.sm }} tickFormatter={v => `${(v * 100).toFixed(0)}%`} />
              <Tooltip cursor={{ fill: 'rgba(6,182,212,0.06)' }} content={<CustomTooltip />} />
              <ReferenceLine y={0} stroke={COLORS.textMuted} strokeDasharray="4 3" />
              <Bar dataKey="value" name="IRR" radius={[6, 6, 0, 0]} barSize={36}>
                {irrBars.map((d, i) => (
                  <Cell key={i} fill={d.value >= 0 ? COLORS.accent2 : COLORS.accent5} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>
      )}

      {/* Duration Distribution */}
      {durBars.length > 0 && (
        <Card>
          <SectionTitle number="3" title="Portfolio Duration Distribution"
            subtitle="Time to portfolio resolution (last claim) across MC percentiles, in months." />
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={durBars} margin={{ top: 10, right: 20, left: 10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={COLORS.gridLine} />
              <XAxis dataKey="label" tick={{ fill: COLORS.textMuted, fontSize: ui.sizes.sm }} />
              <YAxis tick={{ fill: COLORS.textMuted, fontSize: ui.sizes.sm }} tickFormatter={v => v + 'm'} />
              <Tooltip cursor={{ fill: 'rgba(6,182,212,0.06)' }} content={<CustomTooltip />} />
              <ReferenceLine y={96} stroke={COLORS.accent5} strokeDasharray="6 3" strokeWidth={1.5}
                label={{ value: '96m cap', fill: COLORS.accent5, fontSize: 11, position: 'right' }} />
              <Bar dataKey="value" name="Duration (months)" radius={[6, 6, 0, 0]} barSize={36}>
                {durBars.map((d, i) => (
                  <Cell key={i} fill={d.value > 96 ? COLORS.accent5 : COLORS.accent6} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>
      )}

      {/* ═══ SECTION 2: CAPITAL AT RISK ═══ */}
      {carData.length > 0 && (
        <Card>
          <SectionTitle number="4" title="Cumulative Capital Deployed Over Time"
            subtitle="Shows when the fund's money is most at risk. P50 (median) and P95 (stress) capital paths." />
          <ResponsiveContainer width="100%" height={360}>
            <ComposedChart data={carData} margin={{ top: 10, right: 30, left: 20, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={COLORS.gridLine} />
              <XAxis dataKey="month" tick={{ fill: COLORS.textMuted, fontSize: 11 }}
                interval={Math.max(0, Math.floor(carData.length / 12) - 1)} />
              <YAxis tick={{ fill: COLORS.textMuted, fontSize: 11 }} tickFormatter={v => `₹${v.toFixed(0)}`} />
              <Tooltip cursor={{ fill: 'rgba(6,182,212,0.06)' }} content={<CustomTooltip />} />
              <Legend wrapperStyle={{ fontSize: ui.sizes.sm, color: COLORS.textMuted }} />
              <Area dataKey="p95" name="P95 Capital (₹ Cr)" fill={COLORS.accent5} fillOpacity={0.1} stroke={COLORS.accent5} strokeWidth={1.5} strokeDasharray="6 3" />
              <Line dataKey="p50" name="P50 Capital (₹ Cr)" stroke={COLORS.accent1} strokeWidth={2.5} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </Card>
      )}

      {/* ═══ SECTION 3: CONCENTRATION METRICS ═══ */}
      {concentration && (
        <Card>
          <SectionTitle number="5" title="Concentration Metrics"
            subtitle="Herfindahl–Hirschman Index: 0 = fully diversified, 1 = fully concentrated in one bucket." />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: ui.space.xl, marginBottom: ui.space.xl }}>
            <HerfindahlGauge value={concentration.herfindahl_by_jurisdiction} label="By Jurisdiction" />
            <HerfindahlGauge value={concentration.herfindahl_by_type} label="By Claim Type" />
          </div>

          {/* Portfolio weight bars */}
          {weightData.length > 0 && (
            <>
              <div style={{ fontSize: ui.sizes.sm, fontWeight: 600, color: COLORS.textMuted, marginBottom: 12 }}>
                Portfolio Weights
              </div>
              <ResponsiveContainer width="100%" height={Math.max(200, weightData.length * 40 + 40)}>
                <BarChart data={weightData} layout="vertical" margin={{ top: 5, right: 30, left: 120, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={COLORS.gridLine} />
                  <XAxis type="number" tick={{ fill: COLORS.textMuted, fontSize: 11 }} unit="%" />
                  <YAxis dataKey="name" type="category" tick={{ fill: COLORS.textMuted, fontSize: 12 }} width={110} />
                  <Tooltip cursor={{ fill: 'rgba(6,182,212,0.06)' }} content={<CustomTooltip />} />
                  <Bar dataKey="weight" name="Weight %" radius={[0, 6, 6, 0]} barSize={20}>
                    {weightData.map((d, i) => (
                      <Cell key={i} fill={d.type === 'jurisdiction' ? COLORS.accent1 : COLORS.accent2} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </>
          )}
        </Card>
      )}

      {/* ═══ SECTION 4: SENSITIVITY ═══ */}
      {sensData.length > 0 && (
        <Card>
          <SectionTitle number="6" title="Probability Sensitivity Curve"
            subtitle="E[MOIC] as P(arb win) sweeps from 30% to 90%. Shows breakeven and current P(win)." />
          <ResponsiveContainer width="100%" height={360}>
            <ComposedChart data={sensData} margin={{ top: 10, right: 30, left: 20, bottom: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={COLORS.gridLine} />
              <XAxis dataKey="pWin" tick={{ fill: COLORS.textMuted, fontSize: 11 }} unit="%" label={{ value: 'P(Arb Win) %', fill: COLORS.textMuted, fontSize: 12, position: 'insideBottom', offset: -5 }} />
              <YAxis tick={{ fill: COLORS.textMuted, fontSize: 11 }} />
              <Tooltip cursor={{ fill: 'rgba(6,182,212,0.06)' }} content={<CustomTooltip />} />
              <Legend wrapperStyle={{ fontSize: ui.sizes.sm, color: COLORS.textMuted }} />
              <ReferenceLine y={1.0} stroke={COLORS.accent3} strokeDasharray="6 3" strokeWidth={1.5}
                label={{ value: '1.0× Breakeven', fill: COLORS.accent3, fontSize: 11, position: 'right' }} />
              {currentPWin != null && (
                <ReferenceLine x={+(currentPWin * 100).toFixed(0)} stroke={COLORS.accent4} strokeDasharray="4 4" strokeWidth={1.5}
                  label={{ value: `Current ${fmtPct(currentPWin)}`, fill: COLORS.accent4, fontSize: 11, position: 'top' }} />
              )}
              {breakevenPWin != null && (
                <ReferenceLine x={+breakevenPWin.toFixed(0)} stroke={COLORS.accent5} strokeDasharray="4 4" strokeWidth={1.5}
                  label={{ value: `Breakeven ~${breakevenPWin.toFixed(0)}%`, fill: COLORS.accent5, fontSize: 11, position: 'top' }} />
              )}
              <Line dataKey="moic" name="E[MOIC]" stroke={COLORS.accent1} strokeWidth={2.5} dot={{ r: 4, fill: COLORS.accent1 }} />
              <Line dataKey="pLoss" name="P(Loss)" stroke={COLORS.accent5} strokeWidth={1.5} strokeDasharray="4 3" dot={{ r: 3 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </Card>
      )}

      {/* ═══ SECTION 5: STRESS SCENARIOS ═══ */}
      {stress.length > 0 && (
        <Card>
          <SectionTitle number="7" title="Stress Scenarios"
            subtitle="Portfolio metrics under different stress conditions." />
          <DataTable
            headers={['Scenario', 'Description', 'MOIC', 'IRR', 'P(Loss)', 'Severity']}
            rows={stress.map(s => {
              const moic = s.portfolio_moic ?? s.mean_moic ?? 0;
              const irr = s.portfolio_irr ?? s.mean_xirr ?? 0;
              const pLoss = s.p_loss ?? null;
              const severity = moic < 0.5 ? 'Critical' : moic < 1.0 ? 'Severe' : moic < 1.5 ? 'Moderate' : 'Mild';
              const sevColor = moic < 0.5 ? COLORS.accent5 : moic < 1.0 ? '#F59E0B' : moic < 1.5 ? COLORS.accent3 : COLORS.accent4;
              return [
                <span style={{ fontWeight: 700, color: COLORS.textBright }}>{s.name}</span>,
                <span style={{ fontSize: 12 }}>{s.description}</span>,
                <span style={{
                  fontWeight: 700,
                  color: moic >= 1 ? COLORS.accent4 : COLORS.accent5,
                }}>{fmtMOIC(moic)}</span>,
                <span style={{
                  fontWeight: 700,
                  color: irr >= 0 ? COLORS.accent4 : COLORS.accent5,
                }}>{fmtPct(irr)}</span>,
                pLoss != null
                  ? <span style={{ fontWeight: 600, color: pLoss > 0.5 ? COLORS.accent5 : COLORS.textMuted }}>{fmtPct(pLoss)}</span>
                  : <span style={{ color: COLORS.textMuted }}>—</span>,
                <span style={{ fontWeight: 700, color: sevColor }}>{severity}</span>,
              ];
            })}
          />
        </Card>
      )}
    </div>
  );
}
