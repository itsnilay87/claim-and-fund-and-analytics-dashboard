/**
 * @module HybridPayoffCurve
 * @description Visualises the hybrid payoff function across recovery outcomes.
 *
 * For a fixed upfront and a parametric scan over recovered amount, plots the
 * three lines (Return A, Return B, combined op(A,B)) clipped to
 * [min_payout, max_payout].  Designed to make the asymmetric payoff
 * intuitive at a glance for the investor and the claim-holder.
 */
import { useMemo } from 'react';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ReferenceLine,
} from 'recharts';
import { COLORS, FONT } from '../theme';

function _leg(kind, value, upfront, recovery) {
  if (kind === 'multiple_of_upfront') return value * upfront;
  if (kind === 'pct_of_recovery') return value * recovery;
  return 0;
}

export default function HybridPayoffCurve({ data }) {
  const params = data?.hybrid_payoff_params || {};
  const meanSOC = useMemo(() => {
    const claims = data?.portfolio_summary?.claims_breakdown
      || data?.per_claim_breakdowns
      || [];
    if (Array.isArray(claims) && claims.length) {
      const total = claims.reduce(
        (s, c) => s + Number(c.soc_value_cr || c.soc_cr || 0), 0,
      );
      return total / claims.length;
    }
    return 100;
  }, [data]);

  const upfrontBasis = params.upfront_basis || 'pct_soc';
  const upfrontValue = Number(params.upfront_value ?? 0.10);
  const upfront = upfrontBasis === 'fixed_amount'
    ? upfrontValue
    : upfrontValue * meanSOC;

  const returnAType = params.return_a_type || 'multiple_of_upfront';
  const returnAValue = Number(params.return_a_value ?? 3.0);
  const returnBType = params.return_b_type || 'pct_of_recovery';
  const returnBValue = Number(params.return_b_value ?? 0.30);
  const operator = params.operator || 'max';
  const minPayout = params.min_payout != null ? Number(params.min_payout) : null;
  const maxPayout = params.max_payout != null ? Number(params.max_payout) : null;

  const series = useMemo(() => {
    const rows = [];
    const maxR = Math.max(meanSOC * 1.2, upfront * (returnAValue || 1) * 1.5);
    const N = 80;
    for (let i = 0; i <= N; i++) {
      const r = (maxR * i) / N;
      const a = _leg(returnAType, returnAValue, upfront, r);
      const b = _leg(returnBType, returnBValue, upfront, r);
      let combined = operator === 'max' ? Math.max(a, b) : Math.min(a, b);
      if (minPayout != null) combined = Math.max(combined, minPayout);
      if (maxPayout != null) combined = Math.min(combined, maxPayout);
      combined = Math.min(combined, r);
      combined = Math.max(combined, 0);
      rows.push({
        recovery: Number(r.toFixed(2)),
        returnA: Number(a.toFixed(2)),
        returnB: Number(b.toFixed(2)),
        combined: Number(combined.toFixed(2)),
      });
    }
    return rows;
  }, [meanSOC, upfront, returnAType, returnAValue, returnBType, returnBValue, operator, minPayout, maxPayout]);

  return (
    <div style={{ padding: '20px 24px', fontFamily: FONT, color: COLORS.text }}>
      <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>
        Hybrid Payoff Curve
      </h2>
      <p style={{ fontSize: 13, color: COLORS.textMuted, marginBottom: 16 }}>
        For a representative claim (mean SOC ≈ ₹{meanSOC.toFixed(1)} Cr,
        upfront ≈ ₹{upfront.toFixed(2)} Cr), the chart plots both return legs
        and the combined investor payout ({operator === 'max' ? 'max' : 'min'}
        {' '}of A and B), clipped to{' '}
        <strong>[{minPayout ?? '–∞'}, {maxPayout ?? '+∞'}]</strong> and capped
        at the actual recovered amount.
      </p>

      <div style={{ height: 420, background: COLORS.bgCard, borderRadius: 12, padding: 16 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={series} margin={{ top: 10, right: 30, bottom: 30, left: 10 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={COLORS.gridLine} />
            <XAxis
              dataKey="recovery"
              label={{ value: 'Recovery (₹ Cr)', position: 'insideBottom', offset: -5, fill: COLORS.textMuted }}
              tick={{ fill: COLORS.textMuted, fontSize: 11 }}
            />
            <YAxis
              label={{ value: 'Investor Payout (₹ Cr)', angle: -90, position: 'insideLeft', fill: COLORS.textMuted }}
              tick={{ fill: COLORS.textMuted, fontSize: 11 }}
            />
            <Tooltip
              contentStyle={{ background: COLORS.bgCard, border: `1px solid ${COLORS.gridLine}`, borderRadius: 8 }}
              labelStyle={{ color: COLORS.text }}
            />
            <Legend wrapperStyle={{ paddingTop: 10 }} />
            <Line
              type="monotone" dataKey="returnA"
              name={`A: ${returnAType === 'multiple_of_upfront' ? `${returnAValue}× upfront` : `${(returnAValue * 100).toFixed(0)}% of recovery`}`}
              stroke={COLORS.accent2 || '#22d3ee'} strokeWidth={2} dot={false}
            />
            <Line
              type="monotone" dataKey="returnB"
              name={`B: ${returnBType === 'multiple_of_upfront' ? `${returnBValue}× upfront` : `${(returnBValue * 100).toFixed(0)}% of recovery`}`}
              stroke={COLORS.accent3 || '#a78bfa'} strokeWidth={2} dot={false}
            />
            <Line
              type="monotone" dataKey="combined"
              name={`Combined (${operator}, clipped)`}
              stroke={COLORS.accent || '#34d399'} strokeWidth={3} dot={false}
            />
            {minPayout != null && (
              <ReferenceLine y={minPayout} stroke={COLORS.warning || '#fbbf24'} strokeDasharray="4 4" label={{ value: 'Min', position: 'right', fill: COLORS.warning }} />
            )}
            {maxPayout != null && (
              <ReferenceLine y={maxPayout} stroke={COLORS.warning || '#fbbf24'} strokeDasharray="4 4" label={{ value: 'Max', position: 'right', fill: COLORS.warning }} />
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div style={{
        marginTop: 16, padding: 16, background: COLORS.bgCard,
        borderRadius: 12, fontSize: 12, color: COLORS.textMuted, lineHeight: 1.6,
      }}>
        <strong style={{ color: COLORS.text }}>Reading the chart.</strong>{' '}
        The investor's expected return depends on how the recovery falls
        relative to the crossover point of the two legs.  Use{' '}
        <em>Investment Analysis</em> for the (upfront × return-A) heatmap,
        and <em>Per-Claim Analysis</em> for the per-claim contribution to
        portfolio MOIC and XIRR.
      </div>
    </div>
  );
}
