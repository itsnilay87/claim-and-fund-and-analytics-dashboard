/**
 * BreakevenAnalysis.jsx — Tab 7: SOC-only breakeven surface, per-claim breakeven, max headroom.
 */

import React from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, ComposedChart, Line, ReferenceLine, Cell,
} from 'recharts';
import { COLORS, FONT, SIZES, SPACE, CHART_HEIGHT, CHART_FONT, fmtPct, fmtCr, fmtMOIC, BAR_CURSOR } from '../theme';
import { Card, SectionTitle, KPI, CustomTooltip } from './Shared';

export default function BreakevenAnalysis({ data }) {
  const { breakeven_data: be, claims, investment_grid_soc } = data;

  if (!be) return <Card><SectionTitle title="No breakeven data" /></Card>;

  const perClaimBE = be.per_claim_at_30_tail || be.per_claim_at_40_award || {};
  const claimIds = Object.keys(perClaimBE);

  // Max breakeven bar data (per claim, SOC-only)
  const breakevenMax = claimIds.map(cid => {
    const info = perClaimBE[cid];
    return {
      claim: cid.replace('TP-', ''),
      fullId: cid,
      socBE: (info?.soc_breakeven_pct || 0) * 100,
      soc: info?.soc_cr || 0,
      archetype: info?.archetype || '',
    };
  });

  // Surface data (tata tail → max upfront, SOC only)
  const socSurface = be.surfaces?.soc?.surface || [];
  const surfaceData = socSurface.map(s => {
    const tailPct = s.tata_tail_pct ?? (1 - (s.award_share_pct || 0));
    return {
      tail: fmtPct(tailPct),
      soc_max: (s.max_upfront_pct || 0) * 100,
    };
  });

  // MOIC curve: SOC pricing at 30% Tata Tail (= 70% award share)
  const gridSOC = investment_grid_soc || [];
  const upfrontPcts = [...new Set(gridSOC.map(g => g.upfront_pct))].sort((a, b) => a - b);
  const refAward = 0.70; // 30% Tata Tail

  const portfolioSOC = upfrontPcts.map(up => {
    const cell = gridSOC.find(g => g.upfront_pct === up && Math.abs(g.award_share_pct - refAward) < 0.001);
    return {
      pct: (up * 100),
      moic: cell?.mean_moic || 0,
      irr: (cell?.mean_xirr || 0) * 100,
      ploss: (cell?.p_loss || 0) * 100,
      inv: (data.simulation_meta?.total_soc_cr || 0) * up,
    };
  });

  // Find the breakeven point (where MOIC crosses 1.0)
  const bePct = portfolioSOC.find(p => p.moic < 1.0)?.pct || 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: SPACE.xl }}>
      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: SPACE.md }}>
        <KPI label="Max SOC Breakeven" value={`${Math.max(...breakevenMax.map(b => b.socBE)).toFixed(0)}%`}
          sub="highest breakeven across claims" color={COLORS.accent1} />
        <KPI label="Min SOC Breakeven" value={`${Math.min(...breakevenMax.map(b => b.socBE)).toFixed(0)}%`}
          sub="weakest claim" color={breakevenMax.some(b => b.socBE < 15) ? COLORS.accent5 : COLORS.accent4} />
        <KPI label="Claims Analyzed" value={claimIds.length} color={COLORS.accent6} />
        <KPI label="Tail" value="30%" sub="reference breakeven level" color={COLORS.accent3} />
      </div>

      {/* SOC MOIC curve with dual axis (MOIC + IRR) */}
      {portfolioSOC.length > 0 && (
        <Card>
          <SectionTitle number="1" title="SOC Pricing — Portfolio MOIC & IRR vs Upfront %"
            subtitle="Higher upfront investment reduces MOIC. Dashed line = breakeven (1.0×). At 30% Tail." />
          <ResponsiveContainer width="100%" height={380}>
            <ComposedChart data={portfolioSOC} margin={{ top: 10, right: 50, left: 10, bottom: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={COLORS.gridLine} />
              <XAxis dataKey="pct" tick={{ fill: COLORS.textMuted, fontSize: SIZES.sm }} type="number" domain={[0, 'auto']} tickFormatter={v => v + '%'} />
              <YAxis yAxisId="left" tick={{ fill: COLORS.textMuted, fontSize: SIZES.sm }} tickFormatter={v => v.toFixed(1) + '×'} />
              <YAxis yAxisId="right" orientation="right" tick={{ fill: COLORS.accent2, fontSize: SIZES.sm }} tickFormatter={v => v.toFixed(0) + '%'} />
              <Tooltip cursor={{ fill: 'rgba(6,182,212,0.06)' }} content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const d = payload[0]?.payload;
                return (
                  <div style={{ background: COLORS.card, border: `1px solid ${COLORS.cardBorder}`, borderRadius: 8, padding: '10px 14px', fontFamily: FONT }}>
                    <div style={{ color: COLORS.textBright, fontWeight: 700, fontSize: SIZES.sm, marginBottom: 4 }}>Upfront: {d.pct.toFixed(0)}%</div>
                    <div style={{ color: COLORS.accent1, fontSize: SIZES.sm }}>MOIC: {d.moic.toFixed(2)}×</div>
                    <div style={{ color: COLORS.accent2, fontSize: SIZES.sm }}>IRR: {d.irr.toFixed(1)}%</div>
                    <div style={{ color: COLORS.accent5, fontSize: SIZES.sm }}>P(Loss): {d.ploss.toFixed(1)}%</div>
                    <div style={{ color: COLORS.textMuted, fontSize: SIZES.sm }}>Investment: ₹{d.inv.toFixed(0)} Cr</div>
                  </div>
                );
              }} />
              <ReferenceLine yAxisId="left" y={1} stroke={COLORS.breakeven} strokeDasharray="8 4" strokeWidth={2} label={{ value: 'BE', position: 'right', fill: COLORS.breakeven, fontSize: SIZES.xs }} />
              <Line yAxisId="left" type="monotone" dataKey="moic" stroke={COLORS.accent1} strokeWidth={3}
                dot={{ fill: COLORS.accent1, r: 5, stroke: COLORS.bg, strokeWidth: 2 }} name="E[MOIC]" />
              <Line yAxisId="right" type="monotone" dataKey="irr" stroke={COLORS.accent2} strokeWidth={2} strokeDasharray="6 3"
                dot={{ fill: COLORS.accent2, r: 4, stroke: COLORS.bg, strokeWidth: 2 }} name="E[IRR] %" />
            </ComposedChart>
          </ResponsiveContainer>
          <div style={{ display: 'flex', justifyContent: 'center', gap: SPACE.xxl, marginTop: 12 }}>
            {[
              { color: COLORS.accent1, label: 'E[MOIC]', dash: false },
              { color: COLORS.accent2, label: 'E[IRR] %', dash: true },
              { color: COLORS.breakeven, label: 'Breakeven (1.0×)', dash: true },
            ].map(({ color, label, dash }, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: SPACE.sm }}>
                <div style={{ width: 24, height: 3, background: color, borderRadius: 2, ...(dash ? { borderTop: `2px dashed ${color}`, background: 'transparent' } : {}) }} />
                <span style={{ color: COLORS.textMuted, fontSize: SIZES.sm }}>{label}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Per-claim max breakeven horizontal bar */}
      <Card>
        <SectionTitle number="2" title="Maximum Breakeven Purchase Price (MOIC ≥ 1.0×)"
          subtitle="Max upfront % of SOC an investor can pay and still expect breakeven. At 30% Tail." />
        <ResponsiveContainer width="100%" height={Math.max(280, breakevenMax.length * 50)}>
          <BarChart data={breakevenMax} layout="vertical" margin={{ top: 10, right: 30, left: 10, bottom: 10 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={COLORS.gridLine} />
            <XAxis type="number" tick={{ fill: COLORS.textMuted, fontSize: SIZES.sm }} tickFormatter={v => v + '%'} domain={[0, 'auto']} />
            <YAxis dataKey="claim" type="category" tick={{ fill: COLORS.textMuted, fontSize: SIZES.sm }} width={80} />
            <Tooltip cursor={{ fill: 'rgba(6,182,212,0.06)' }} content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const d = payload[0]?.payload;
              return (
                <div style={{ background: COLORS.card, border: `1px solid ${COLORS.cardBorder}`, borderRadius: 8, padding: '10px 14px', fontFamily: FONT }}>
                  <div style={{ color: COLORS.textBright, fontWeight: 700, fontSize: SIZES.sm }}>{d.fullId}</div>
                  <div style={{ color: COLORS.accent1, fontSize: SIZES.sm }}>Max Breakeven: {d.socBE.toFixed(1)}% of SOC</div>
                  <div style={{ color: COLORS.textMuted, fontSize: SIZES.sm }}>= ₹{(d.soc * d.socBE / 100).toFixed(0)} Cr</div>
                </div>
              );
            }} />
            <Bar dataKey="socBE" name="Max % of SOC" radius={[0, 6, 6, 0]} barSize={18} cursor={BAR_CURSOR}>
              {breakevenMax.map((entry, idx) => (
                <Cell key={idx} fill={entry.socBE < 15 ? COLORS.accent5 : entry.socBE < 25 ? COLORS.accent7 : COLORS.accent1} fillOpacity={0.85} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </Card>

      {/* Breakeven cards — one per claim */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: SPACE.lg }}>
        {breakevenMax.map((c, i) => {
          const isWeak = c.socBE < 15;
          const isMedium = c.socBE >= 15 && c.socBE < 25;
          const beInvestment = c.soc * c.socBE / 100;
          return (
            <div key={i} style={{
              background: COLORS.card, border: `1px solid ${isWeak ? '#EF444440' : COLORS.cardBorder}`,
              borderRadius: 12, padding: 20, position: 'relative', overflow: 'hidden',
            }}>
              {isWeak && (
                <div style={{
                  position: 'absolute', top: 12, right: 12,
                  background: '#EF444430', color: COLORS.accent5,
                  padding: '2px 8px', borderRadius: 4, fontSize: SIZES.xs, fontWeight: 700,
                }}>HIGH RISK</div>
              )}
              {isMedium && (
                <div style={{
                  position: 'absolute', top: 12, right: 12,
                  background: '#F59E0B30', color: COLORS.accent7,
                  padding: '2px 8px', borderRadius: 4, fontSize: SIZES.xs, fontWeight: 700,
                }}>MODERATE</div>
              )}
              <div style={{ color: COLORS.textBright, fontSize: SIZES.lg, fontWeight: 700, marginBottom: 4 }}>{c.fullId}</div>
              <div style={{ color: COLORS.textMuted, fontSize: SIZES.sm, marginBottom: 16 }}>
                {c.archetype} | SOC ₹{c.soc.toLocaleString()} Cr
              </div>
              <div>
                <div style={{ color: COLORS.textMuted, fontSize: SIZES.xs, fontWeight: 600, marginBottom: 4, textTransform: 'uppercase' }}>SOC BREAKEVEN</div>
                <div style={{ color: isWeak ? COLORS.accent5 : COLORS.accent1, fontSize: SIZES.hero, fontWeight: 800 }}>{c.socBE.toFixed(0)}%</div>
                <div style={{ color: COLORS.textMuted, fontSize: SIZES.sm, marginTop: 2 }}>
                  = ₹{beInvestment.toFixed(0)} Cr max investment
                </div>
              </div>
              {/* Headroom bar */}
              <div style={{ marginTop: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ color: COLORS.textMuted, fontSize: SIZES.xs }}>Headroom</span>
                  <span style={{ color: COLORS.textMuted, fontSize: SIZES.xs }}>{c.socBE.toFixed(0)}%</span>
                </div>
                <div style={{ height: 8, background: '#1F2937', borderRadius: 4, overflow: 'hidden' }}>
                  <div style={{
                    height: '100%', width: `${Math.min(c.socBE, 100)}%`,
                    background: isWeak
                      ? `linear-gradient(90deg, ${COLORS.accent5}, #EF444480)`
                      : `linear-gradient(90deg, ${COLORS.accent1}, ${COLORS.accent4})`,
                    borderRadius: 4,
                  }} />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Breakeven surface — SOC only */}
      {surfaceData.length > 0 && (
        <Card>
          <SectionTitle number="3" title="Breakeven Surface — Tail vs Max SOC Upfront"
            subtitle="How the maximum SOC upfront % changes as Tata's retained tail percentage varies." />
          <ResponsiveContainer width="100%" height={320}>
            <ComposedChart data={surfaceData} margin={{ top: 10, right: 20, left: 10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={COLORS.gridLine} />
              <XAxis dataKey="tail" tick={{ fill: COLORS.textMuted, fontSize: SIZES.sm }} />
              <YAxis tick={{ fill: COLORS.textMuted, fontSize: SIZES.sm }} tickFormatter={v => v + '%'} />
              <Tooltip cursor={{ fill: 'rgba(6,182,212,0.06)' }} content={<CustomTooltip />} />
              <Bar dataKey="soc_max" name="SOC Max Upfront %" fill={COLORS.accent1} radius={[4, 4, 0, 0]} barSize={24} fillOpacity={0.8} cursor={BAR_CURSOR}>
                {surfaceData.map((entry, idx) => (
                  <Cell key={idx} fill={entry.soc_max < 15 ? COLORS.accent5 : COLORS.accent1} />
                ))}
              </Bar>
            </ComposedChart>
          </ResponsiveContainer>
        </Card>
      )}

      {/* Capital deployed at breakeven */}
      <Card>
        <SectionTitle number="4" title="Capital Deployed at Breakeven"
          subtitle="Total SOC investment at the maximum breakeven upfront % (30% Tail)." />
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={breakevenMax} margin={{ top: 10, right: 20, left: 20, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={COLORS.gridLine} />
            <XAxis dataKey="claim" tick={{ fill: COLORS.textMuted, fontSize: SIZES.sm }} />
            <YAxis tick={{ fill: COLORS.textMuted, fontSize: SIZES.sm }} tickFormatter={v => '₹' + v.toFixed(0)} />
            <Tooltip cursor={{ fill: 'rgba(6,182,212,0.06)' }} content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const d = payload[0]?.payload;
              return (
                <div style={{ background: COLORS.card, border: `1px solid ${COLORS.cardBorder}`, borderRadius: 8, padding: '10px 14px', fontFamily: FONT }}>
                  <div style={{ color: COLORS.textBright, fontWeight: 700, fontSize: SIZES.sm }}>{d.fullId}</div>
                  <div style={{ color: COLORS.text, fontSize: SIZES.sm }}>SOC: ₹{d.soc.toFixed(0)} Cr</div>
                  <div style={{ color: COLORS.accent1, fontSize: SIZES.sm }}>Breakeven: {d.socBE.toFixed(0)}%</div>
                  <div style={{ color: COLORS.textMuted, fontSize: SIZES.sm }}>Max Invest: ₹{(d.soc * d.socBE / 100).toFixed(0)} Cr</div>
                </div>
              );
            }} />
            <Bar dataKey="soc" name="SOC (₹ Cr)" fill={COLORS.accent1} radius={[4, 4, 0, 0]} barSize={24} fillOpacity={0.6} cursor={BAR_CURSOR} />
          </BarChart>
        </ResponsiveContainer>
      </Card>
    </div>
  );
}
