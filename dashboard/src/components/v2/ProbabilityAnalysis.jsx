/**
 * ProbabilityAnalysis.jsx — Tab 2: Probability tree paths, outcome distributions.
 */

import React, { useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, Cell,
  PieChart, Pie, ComposedChart, Line, Area,
} from 'recharts';
import { COLORS, FONT, CHART_COLORS, SIZES, SPACE, CHART_HEIGHT, CHART_FONT, useUISettings, fmtPct, BAR_CURSOR } from '../theme';
import { Card, SectionTitle, KPI, CustomTooltip, Badge } from './Shared';

const OUTCOME_COLORS = { TRUE_WIN: COLORS.accent4, RESTART: COLORS.accent3, LOSE: COLORS.accent5 };

export default function ProbabilityAnalysis({ data }) {
  const { ui } = useUISettings();
  const { probability_summary: prob } = data;
  const [treeView, setTreeView] = useState('domestic');
  const isNarrow = typeof window !== 'undefined' && window.innerWidth < 1400;

  const arbWin = prob.arb_win_probability;

  // Domestic aggregate
  const domAgg = prob.domestic.aggregate;
  const siacAgg = prob.siac.aggregate;

  // Combined outcome (weighted by jurisdiction usage):
  // 3 domestic + 3 SIAC claims → 50/50 weight for visual
  const combinedOutcome = [
    { name: 'TRUE_WIN', domestic: domAgg.true_win, siac: siacAgg.true_win, fill: COLORS.accent4 },
    { name: 'RESTART', domestic: domAgg.restart, siac: siacAgg.restart, fill: COLORS.accent3 },
    { name: 'LOSE', domestic: domAgg.lose, siac: siacAgg.lose, fill: COLORS.accent5 },
  ];

  // Pie data for domestic
  const domPie = [
    { name: 'TRUE_WIN', value: domAgg.true_win, fill: COLORS.accent4 },
    { name: 'RESTART', value: domAgg.restart, fill: COLORS.accent3 },
    { name: 'LOSE', value: domAgg.lose, fill: COLORS.accent5 },
  ];
  const siacPie = [
    { name: 'TRUE_WIN', value: siacAgg.true_win, fill: COLORS.accent4 },
    { name: 'RESTART', value: siacAgg.restart, fill: COLORS.accent3 },
    { name: 'LOSE', value: siacAgg.lose, fill: COLORS.accent5 },
  ];

  // Path data for bar charts
  const domPathsA = prob.domestic.scenario_a.map(p => ({
    path: p.path_id,
    prob: p.absolute_prob,
    outcome: p.outcome,
    desc: p.description,
  }));
  const domPathsB = prob.domestic.scenario_b.map(p => ({
    path: p.path_id,
    prob: p.absolute_prob,
    outcome: p.outcome,
    desc: p.description,
  }));
  const siacPathsA = prob.siac.scenario_a.map(p => ({
    path: p.path_id,
    prob: p.absolute_prob,
    outcome: p.outcome,
    desc: p.description,
  }));
  const siacPathsB = prob.siac.scenario_b.map(p => ({
    path: p.path_id,
    prob: p.absolute_prob,
    outcome: p.outcome,
    desc: p.description,
  }));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: ui.space.xl }}>
      {/* KPI row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: ui.space.md }}>
        <KPI label="Arb Win Prob" value={fmtPct(arbWin)} color={COLORS.accent4} />
        <KPI label="Dom. TRUE_WIN" value={fmtPct(domAgg.true_win)} sub="absolute" color={COLORS.accent4} />
        <KPI label="Dom. RESTART" value={fmtPct(domAgg.restart)} color={COLORS.accent3} />
        <KPI label="SIAC TRUE_WIN" value={fmtPct(siacAgg.true_win)} color={COLORS.accent2} />
        <KPI label="SIAC LOSE" value={fmtPct(siacAgg.lose)} color={COLORS.accent5} />
      </div>

      {/* Outcome pies side by side */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: ui.space.lg }}>
        <Card>
          <SectionTitle number="1" title="Domestic Outcome Distribution" subtitle="Absolute probabilities (arb_win × conditional)" />
          <ResponsiveContainer width="100%" height={ui.chartHeight.sm}>
            <PieChart>
              <Pie data={domPie} cx="50%" cy="50%" innerRadius={50} outerRadius={85} paddingAngle={3} dataKey="value"
                label={({ name, value }) => `${name} ${fmtPct(value)}`} labelLine={{ stroke: COLORS.textMuted }}>
                {domPie.map((d, i) => <Cell key={i} fill={d.fill} />)}
              </Pie>
              <Tooltip cursor={{ fill: 'rgba(6,182,212,0.06)' }} content={<CustomTooltip />} />
            </PieChart>
          </ResponsiveContainer>
        </Card>
        <Card>
          <SectionTitle number="2" title="SIAC Outcome Distribution" subtitle="Absolute probabilities (arb_win × conditional)" />
          <ResponsiveContainer width="100%" height={ui.chartHeight.sm}>
            <PieChart>
              <Pie data={siacPie} cx="50%" cy="50%" innerRadius={50} outerRadius={85} paddingAngle={3} dataKey="value"
                label={({ name, value }) => `${name} ${fmtPct(value)}`} labelLine={{ stroke: COLORS.textMuted }}>
                {siacPie.map((d, i) => <Cell key={i} fill={d.fill} />)}
              </Pie>
              <Tooltip cursor={{ fill: 'rgba(6,182,212,0.06)' }} content={<CustomTooltip />} />
            </PieChart>
          </ResponsiveContainer>
        </Card>
      </div>

      {/* Toggle for tree view */}
      <div style={{ display: 'flex', gap: ui.space.sm }}>
        {['domestic', 'siac'].map(v => (
          <button key={v} onClick={() => setTreeView(v)} style={{
            padding: '8px 20px', borderRadius: 6, border: 'none', cursor: 'pointer',
            fontFamily: FONT, fontSize: ui.sizes.sm, fontWeight: 600,
            color: treeView === v ? '#fff' : COLORS.textMuted,
            background: treeView === v ? COLORS.gradient1 : COLORS.card,
          }}>
            {v === 'domestic' ? 'Domestic (24 paths)' : 'SIAC (8 paths)'}
          </button>
        ))}
      </div>

      {/* Path probability bars — Scenario A */}
      <Card>
        <SectionTitle
          number="3"
          title={`${treeView === 'domestic' ? 'Domestic' : 'SIAC'} Scenario A — TATA Won Arbitration (${fmtPct(arbWin)})`}
          subtitle="Path probabilities (absolute = arb_win × conditional)"
        />
        <ResponsiveContainer width="100%" height={treeView === 'domestic' ? ui.chartHeight.md : Math.round(ui.chartHeight.sm * 0.8)}>
          <BarChart
            data={treeView === 'domestic' ? domPathsA : siacPathsA}
            margin={{ top: 10, right: 20, left: 10, bottom: 20 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke={COLORS.gridLine} />
            <XAxis dataKey="path" tick={{ fill: COLORS.textMuted, fontSize: ui.sizes.sm }} interval={isNarrow ? 1 : 0} />
            <YAxis tick={{ fill: COLORS.textMuted, fontSize: ui.sizes.sm }} tickFormatter={v => fmtPct(v)} width={isNarrow ? 44 : 56} />
            <Tooltip cursor={{ fill: 'rgba(6,182,212,0.06)' }} content={({ active, payload }) => {
              if (!active || !payload?.[0]) return null;
              const d = payload[0].payload;
              return (
                <div style={{ background: '#1F2937', border: `1px solid ${COLORS.cardBorder}`, borderRadius: 8, padding: '10px 14px', fontFamily: FONT }}>
                  <div style={{ color: COLORS.textBright, fontSize: ui.sizes.sm, fontWeight: 700 }}>{d.path}</div>
                  <div style={{ color: COLORS.textMuted, fontSize: ui.sizes.sm, marginTop: 4 }}>{d.desc}</div>
                  <div style={{ color: OUTCOME_COLORS[d.outcome], fontSize: ui.sizes.base, fontWeight: 700, marginTop: 4 }}>
                    {d.outcome} — {fmtPct(d.prob)}
                  </div>
                </div>
              );
            }} />
            <Bar dataKey="prob" radius={[4, 4, 0, 0]} barSize={treeView === 'domestic' ? 18 : 36} cursor={BAR_CURSOR}>
              {(treeView === 'domestic' ? domPathsA : siacPathsA).map((d, i) => (
                <Cell key={i} fill={OUTCOME_COLORS[d.outcome]} fillOpacity={0.85} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
        <div style={{ display: 'flex', justifyContent: 'center', gap: ui.space.xl, marginTop: 8 }}>
          {Object.entries(OUTCOME_COLORS).map(([k, c]) => (
            <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ width: 12, height: 12, borderRadius: 3, background: c }} />
              <span style={{ color: COLORS.textMuted, fontSize: ui.sizes.sm }}>{k}</span>
            </div>
          ))}
        </div>
      </Card>

      {/* Path probability bars — Scenario B */}
      <Card>
        <SectionTitle
          number="4"
          title={`${treeView === 'domestic' ? 'Domestic' : 'SIAC'} Scenario B — TATA Lost Arbitration (${fmtPct(1 - arbWin)})`}
          subtitle="Path probabilities (absolute = arb_lose × conditional)"
        />
        <ResponsiveContainer width="100%" height={treeView === 'domestic' ? ui.chartHeight.md : Math.round(ui.chartHeight.sm * 0.8)}>
          <BarChart
            data={treeView === 'domestic' ? domPathsB : siacPathsB}
            margin={{ top: 10, right: 20, left: 10, bottom: 20 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke={COLORS.gridLine} />
            <XAxis dataKey="path" tick={{ fill: COLORS.textMuted, fontSize: ui.sizes.sm }} interval={isNarrow ? 1 : 0} />
            <YAxis tick={{ fill: COLORS.textMuted, fontSize: ui.sizes.sm }} tickFormatter={v => fmtPct(v)} width={isNarrow ? 44 : 56} />
            <Tooltip cursor={{ fill: 'rgba(6,182,212,0.06)' }} content={({ active, payload }) => {
              if (!active || !payload?.[0]) return null;
              const d = payload[0].payload;
              return (
                <div style={{ background: '#1F2937', border: `1px solid ${COLORS.cardBorder}`, borderRadius: 8, padding: '10px 14px', fontFamily: FONT }}>
                  <div style={{ color: COLORS.textBright, fontSize: ui.sizes.sm, fontWeight: 700 }}>{d.path}</div>
                  <div style={{ color: COLORS.textMuted, fontSize: ui.sizes.sm, marginTop: 4 }}>{d.desc}</div>
                  <div style={{ color: OUTCOME_COLORS[d.outcome], fontSize: ui.sizes.base, fontWeight: 700, marginTop: 4 }}>
                    {d.outcome} — {fmtPct(d.prob)}
                  </div>
                </div>
              );
            }} />
            <Bar dataKey="prob" radius={[4, 4, 0, 0]} barSize={treeView === 'domestic' ? 18 : 36} cursor={BAR_CURSOR}>
              {(treeView === 'domestic' ? domPathsB : siacPathsB).map((d, i) => (
                <Cell key={i} fill={OUTCOME_COLORS[d.outcome]} fillOpacity={0.85} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </Card>

      {/* Combined outcome comparison */}
      <Card>
        <SectionTitle number="5" title="Domestic vs SIAC — Outcome Comparison" subtitle="Absolute outcome probabilities by jurisdiction" />
        <ResponsiveContainer width="100%" height={ui.chartHeight.sm}>
          <BarChart data={combinedOutcome} margin={{ top: 10, right: 20, left: 10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={COLORS.gridLine} />
            <XAxis dataKey="name" tick={{ fill: COLORS.textMuted, fontSize: ui.sizes.sm }} />
            <YAxis tick={{ fill: COLORS.textMuted, fontSize: ui.sizes.sm }} tickFormatter={v => fmtPct(v)} />
            <Tooltip cursor={{ fill: 'rgba(6,182,212,0.06)' }} content={<CustomTooltip />} />
            <Legend wrapperStyle={{ fontSize: ui.sizes.sm, color: COLORS.textMuted }} />
            <Bar dataKey="domestic" name="Domestic" fill={COLORS.accent1} radius={[4, 4, 0, 0]} barSize={28} cursor={BAR_CURSOR} />
            <Bar dataKey="siac" name="SIAC" fill={COLORS.accent2} radius={[4, 4, 0, 0]} barSize={28} cursor={BAR_CURSOR} />
          </BarChart>
        </ResponsiveContainer>
      </Card>
    </div>
  );
}
