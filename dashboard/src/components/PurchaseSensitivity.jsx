/**
 * PurchaseSensitivity.jsx — Full purchase price sensitivity analysis.
 * Structure: monetisation_full_purchase
 *
 * Line charts: MOIC, IRR, P(Loss) vs purchase price %.
 * Full metrics table at each evaluated price point.
 * Breakeven price marker. Maximum viable price at configurable hurdle.
 */

import React, { useState, useMemo } from 'react';
import {
  ComposedChart, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine, Legend,
} from 'recharts';
import { COLORS, FONT, useUISettings, fmtPct, fmtMOIC, fmtCr, moicColor, irrColor, lossColor } from '../theme';
import { Card, SectionTitle, KPI, CustomTooltip, DataTable } from './Shared';

export default function PurchaseSensitivity({ data }) {
  const { ui } = useUISettings();
  const grid = data?.investment_grid || {};
  const purchaseSensitivity = data?.purchase_sensitivity || null;
  const purchaseBreakeven = data?.purchase_breakeven || null;
  const meta = data?.simulation_meta || {};
  const [hurdleIRR, setHurdleIRR] = useState(0.30);

  // Prefer V2 purchase_sensitivity array format when available
  const gridKeys = Object.keys(grid);
  const hasPurchaseSens = Array.isArray(purchaseSensitivity) && purchaseSensitivity.length > 0;
  if (!hasPurchaseSens && gridKeys.length === 0) {
    return <Card><SectionTitle title="Purchase Sensitivity" subtitle="No investment grid data. Run with monetisation_full_purchase structure." /></Card>;
  }

  // For full_purchase, grid keys may be purchase_pct values (single dimension)
  // Try to detect: if all keys have format "X_0" or just "X", treat as 1D
  const is1D = gridKeys.every(k => k.split('_').length === 1 || k.endsWith('_0'));

  const lineData = useMemo(() => {
    // Use V2 purchase_sensitivity array if available
    if (hasPurchaseSens) {
      return purchaseSensitivity.map(pt => ({
        pricePct: pt.price || pt.price_pct || 0,
        label: `${pt.price || pt.price_pct || 0}%`,
        moic: pt.mean_moic || pt.moic || 0,
        irr: pt.mean_xirr || pt.irr || 0,
        pLoss: pt.p_loss || 0,
        pHurdle: pt.p_hurdle || 0,
        medianMoic: pt.p50_moic || pt.median_moic || 0,
        var1: pt.var_1 || 0,
        cvar1: pt.cvar_1 || 0,
      })).sort((a, b) => a.pricePct - b.pricePct);
    }
    // Fall back to investment_grid.
    // For monetisation_full_purchase the engine currently produces the full
    // 2D upfront × tail SOC grid (e.g. 13 × 12 = 156 cells). Tail share is
    // meaningless for a pure purchase, so we collapse to a 1D curve over
    // the purchase price (= upfront %). For each upfront we keep the row
    // with the smallest tail (tail=0 represents the canonical pure-purchase
    // case). Without this dedupe, recharts plots all 12 tail variants per
    // price in array order, producing a sawtooth artefact.
    const byPrice = new Map();
    for (const k of gridKeys) {
      const c = grid[k];
      const parts = k.split('_').map(Number);
      const pricePct = parts[0];
      const tailPct  = parts.length > 1 ? parts[1] : 0;
      const existing = byPrice.get(pricePct);
      if (!existing || tailPct < existing._tail) {
        byPrice.set(pricePct, {
          _tail: tailPct,
          pricePct,
          label: `${pricePct}%`,
          moic: c.mean_moic || c.e_moic || 0,
          irr: c.expected_xirr ?? c.mean_xirr ?? c.e_irr ?? 0,
          pLoss: c.p_loss || c.prob_loss || 0,
          pHurdle: c.p_hurdle || c.prob_hurdle || 0,
          medianMoic: c.median_moic || c.p50_moic || 0,
          var1: c.var_1 || 0,
          cvar1: c.cvar_1 || 0,
        });
      }
    }
    return [...byPrice.values()].sort((a, b) => a.pricePct - b.pricePct);
  }, [grid, gridKeys]);

  // Find breakeven: from V2 data or where MOIC crosses 1.0
  const breakeven = lineData.find(d => d.moic >= 1.0);
  const breakevenPct = purchaseBreakeven != null ? purchaseBreakeven : (breakeven ? breakeven.pricePct : null);

  // Max viable price at hurdle IRR
  const viableAtHurdle = [...lineData].reverse().find(d => d.irr >= hurdleIRR);
  const maxViablePct = viableAtHurdle ? viableAtHurdle.pricePct : null;

  // Best cell
  const bestIdx = lineData.reduce((bi, d, i) => d.moic > lineData[bi].moic ? i : bi, 0);
  const best = lineData[bestIdx] || {};

  // Table rows
  const tableRows = lineData.map(d => [
    d.label,
    fmtMOIC(d.moic),
    fmtMOIC(d.medianMoic),
    fmtPct(d.irr),
    fmtPct(d.pLoss),
    fmtPct(d.pHurdle),
    fmtMOIC(d.var1),
    fmtMOIC(d.cvar1),
  ]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: ui.space.xl }}>

      {/* ── Summary KPIs ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: ui.space.md }}>
        <KPI label="Price Points" value={lineData.length} color={COLORS.accent6} />
        <KPI label="Best E[MOIC]" value={fmtMOIC(best.moic)} sub={`at ${best.pricePct}%`} color={COLORS.accent4} />
        <KPI label="Best E[IRR]" value={fmtPct(best.irr)} color={COLORS.accent2} />
        <KPI label="Breakeven Price" value={breakevenPct != null ? `${breakevenPct}%` : 'N/A'} sub="MOIC ≥ 1.0×" color={COLORS.accent3} />
        <KPI label={`Max @ ${(hurdleIRR * 100).toFixed(0)}% IRR`} value={maxViablePct != null ? `${maxViablePct}%` : 'N/A'} color={COLORS.accent1} />
      </div>

      {/* ── Hurdle control ── */}
      <Card>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ color: COLORS.textMuted, fontSize: ui.sizes.sm, fontWeight: 600 }}>Target IRR Hurdle:</span>
          {[0.15, 0.20, 0.25, 0.30, 0.40].map(h => (
            <button key={h} onClick={() => setHurdleIRR(h)} style={{
              padding: '6px 12px', borderRadius: 6, border: 'none', cursor: 'pointer', fontFamily: FONT,
              fontSize: ui.sizes.sm, fontWeight: hurdleIRR === h ? 700 : 500,
              color: hurdleIRR === h ? '#fff' : COLORS.textMuted,
              background: hurdleIRR === h ? COLORS.accent2 : COLORS.card,
            }}>{fmtPct(h)}</button>
          ))}
        </div>
      </Card>

      {/* ── MOIC vs Price ── */}
      <Card>
        <SectionTitle number="1" title="E[MOIC] vs Purchase Price"
          subtitle="Expected MOIC at each purchase price point. Breakeven (1.0×) marked." />
        <ResponsiveContainer width="100%" height={ui.chartHeight?.md || 380}>
          <LineChart data={lineData} margin={{ top: 16, right: 30, left: 10, bottom: 20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={COLORS.gridLine} />
            <XAxis dataKey="label" tick={{ fill: COLORS.textMuted, fontSize: 12 }} label={{ value: 'Purchase Price %', fill: COLORS.textMuted, fontSize: 13, position: 'bottom', offset: 0 }} />
            <YAxis tick={{ fill: COLORS.textMuted, fontSize: 12 }} label={{ value: 'MOIC', fill: COLORS.textMuted, fontSize: 13, angle: -90, position: 'insideLeft' }} />
            <Tooltip content={<CustomTooltip />} />
            <ReferenceLine y={1.0} stroke={COLORS.accent5} strokeDasharray="8 4" strokeWidth={2} label={{ value: '1.0× BE', fill: COLORS.accent5, fontSize: 10 }} />
            <Line type="monotone" dataKey="moic" stroke={COLORS.accent1} strokeWidth={3} dot={{ r: 5, fill: COLORS.accent1 }} name="E[MOIC]" />
          </LineChart>
        </ResponsiveContainer>
      </Card>

      {/* ── IRR vs Price ── */}
      <Card>
        <SectionTitle number="2" title="E[IRR] vs Purchase Price"
          subtitle="Expected annualized IRR. Hurdle rate marked." />
        <ResponsiveContainer width="100%" height={ui.chartHeight?.md || 380}>
          <LineChart data={lineData} margin={{ top: 16, right: 30, left: 10, bottom: 20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={COLORS.gridLine} />
            <XAxis dataKey="label" tick={{ fill: COLORS.textMuted, fontSize: 12 }} />
            <YAxis tick={{ fill: COLORS.textMuted, fontSize: 12 }} tickFormatter={v => fmtPct(v)} />
            <Tooltip content={<CustomTooltip />} />
            <ReferenceLine y={hurdleIRR} stroke={COLORS.accent5} strokeDasharray="8 4" strokeWidth={2}
              label={{ value: `${(hurdleIRR * 100).toFixed(0)}% Hurdle`, fill: COLORS.accent5, fontSize: 10 }} />
            <ReferenceLine y={0} stroke={COLORS.accent3} strokeDasharray="4 4" />
            <Line type="monotone" dataKey="irr" stroke={COLORS.accent2} strokeWidth={3} dot={{ r: 5, fill: COLORS.accent2 }} name="E[IRR]" />
          </LineChart>
        </ResponsiveContainer>
      </Card>

      {/* ── P(Loss) vs Price ── */}
      <Card>
        <SectionTitle number="3" title="P(Loss) vs Purchase Price"
          subtitle="Probability of loss at each price point." />
        <ResponsiveContainer width="100%" height={ui.chartHeight?.md || 380}>
          <LineChart data={lineData} margin={{ top: 16, right: 30, left: 10, bottom: 20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={COLORS.gridLine} />
            <XAxis dataKey="label" tick={{ fill: COLORS.textMuted, fontSize: 12 }} />
            <YAxis tick={{ fill: COLORS.textMuted, fontSize: 12 }} tickFormatter={v => fmtPct(v)} domain={[0, 1]} />
            <Tooltip content={<CustomTooltip />} />
            <ReferenceLine y={0.50} stroke={COLORS.accent5} strokeDasharray="4 4" label={{ value: '50%', fill: COLORS.accent5, fontSize: 10 }} />
            <Line type="monotone" dataKey="pLoss" stroke={COLORS.accent5} strokeWidth={3} dot={{ r: 5, fill: COLORS.accent5 }} name="P(Loss)" />
          </LineChart>
        </ResponsiveContainer>
      </Card>

      {/* ── Full Metrics Table ── */}
      <Card>
        <SectionTitle number="4" title="Full Metrics Table"
          subtitle="All evaluated price points with complete metric set." />
        <DataTable
          headers={['Price', 'E[MOIC]', 'Med MOIC', 'E[IRR]', 'P(Loss)', 'P(Hurdle)', 'VaR(1%)', 'CVaR(1%)']}
          rows={tableRows}
        />
      </Card>
    </div>
  );
}
