/**
 * ExportPanel.jsx — Download buttons for JSON, Excel, PDF, workspace save.
 * Universal tab — shown for all structure types.
 */

import React, { useState, useCallback } from 'react';
import { COLORS, FONT, useUISettings } from '../theme';
import { Card, SectionTitle, KPI } from './Shared';
import { authFetch } from '../data/dashboardData';

function DownloadButton({ icon, label, sub, onClick, disabled, color }) {
  const { ui } = useUISettings();
  const [hovered, setHovered] = useState(false);
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        padding: '24px 20px', borderRadius: 12,
        background: hovered && !disabled ? `${color}20` : '#0F1219',
        border: `1px solid ${hovered && !disabled ? color : COLORS.cardBorder}`,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.4 : 1,
        transition: 'all 0.2s ease',
        minWidth: 180,
        fontFamily: FONT,
      }}
    >
      <div style={{ fontSize: 36, marginBottom: 12 }}>{icon}</div>
      <div style={{ color: COLORS.textBright, fontSize: ui.sizes.md, fontWeight: 700, marginBottom: 4 }}>{label}</div>
      <div style={{ color: COLORS.textMuted, fontSize: ui.sizes.xs }}>{sub}</div>
    </button>
  );
}

export default function ExportPanel({ data }) {
  const { ui } = useUISettings();
  const meta = data?.simulation_meta || {};
  const [lastAction, setLastAction] = useState(null);

  const downloadJSON = useCallback(() => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `dashboard_data_${meta.structure_type || 'export'}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setLastAction('JSON downloaded');
  }, [data, meta]);

  const downloadCSV = useCallback(() => {
    const claims = data?.claims || [];
    if (claims.length === 0) return;
    const headers = ['claim_id', 'name', 'jurisdiction', 'archetype', 'soc_value_cr', 'win_rate',
      'mean_quantum', 'mean_duration', 'mean_collected', 'mean_legal_cost',
      'current_gate', 'tpl_share'];
    const rows = claims.map(c => headers.map(h => {
      const v = c[h] ?? '';
      // Escape CSV values that contain commas or quotes
      if (typeof v === 'string' && (v.includes(',') || v.includes('"'))) {
        return `"${v.replace(/"/g, '""')}"`;
      }
      return v;
    }).join(','));
    const csv = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `claims_summary_${meta.structure_type || 'export'}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setLastAction('CSV downloaded');
  }, [data, meta]);

  const downloadExcel = useCallback(async () => {
    const params = new URLSearchParams(window.location.search);
    const runId = params.get('runId');
    const apiBase = params.get('apiBase') || import.meta.env.VITE_API_BASE || '';
    if (!runId) {
      setLastAction('Excel export requires a server run (use runId mode)');
      return;
    }
    try {
      setLastAction('Downloading Excel…');
      // Try multiple known Excel filenames in order of preference
      const filenames = ['Investment_Analysis_Report.xlsx', 'TATA_V2_Valuation_Model.xlsx', 'Chart_Data.xlsx'];
      let blob = null;
      let usedName = filenames[0];
      for (const fname of filenames) {
        const url = `${apiBase}/api/results/${encodeURIComponent(runId)}/${fname}`;
        const res = await authFetch(url, apiBase);
        if (res.ok) {
          blob = await res.blob();
          usedName = fname;
          break;
        }
      }
      if (!blob) throw new Error('No Excel file found for this run');
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = usedName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
      setLastAction('Excel downloaded');
    } catch (err) {
      setLastAction('Excel download failed: ' + err.message);
    }
  }, [meta]);

  const downloadPDF = useCallback(async () => {
    const params = new URLSearchParams(window.location.search);
    const runId = params.get('runId');
    const apiBase = params.get('apiBase') || import.meta.env.VITE_API_BASE || '';
    if (!runId) {
      setLastAction('PDF export requires a server run (use runId mode)');
      return;
    }
    try {
      setLastAction('Downloading PDF…');
      const url = `${apiBase}/api/results/${encodeURIComponent(runId)}/TATA_V2_Investment_Analysis.pdf`;
      const res = await authFetch(url, apiBase);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = 'TATA_V2_Investment_Analysis.pdf';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
      setLastAction('PDF downloaded');
    } catch (err) {
      setLastAction('PDF download failed: ' + err.message);
    }
  }, [meta]);

  const triggerSave = useCallback(() => {
    // Dispatch custom event for parent app integration
    window.dispatchEvent(new CustomEvent('claimAnalytics:saveWorkspace', {
      detail: { data, structureType: meta.structure_type, timestamp: new Date().toISOString() },
    }));
    setLastAction('Workspace save triggered');
  }, [data, meta]);

  const claimCount = data?.claims?.length || 0;
  const hasGrid = Object.keys(data?.investment_grid || {}).length > 0;
  const structureType = meta.structure_type || 'unknown';
  const hasRunId = !!(typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('runId'));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: ui.space.xl }}>

      {/* ── Export Summary ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: ui.space.md }}>
        <KPI label="Structure" value={structureType.replace(/_/g, ' ')} color={COLORS.accent2} />
        <KPI label="Claims" value={claimCount} color={COLORS.accent1} />
        <KPI label="MC Paths" value={(meta.n_paths || 0).toLocaleString()} color={COLORS.accent3} />
        <KPI label="Generated" value={meta.generated_at?.split(' ')[0] || 'N/A'} color={COLORS.accent6} />
      </div>

      {/* ── Download Buttons ── */}
      <Card>
        <SectionTitle number="1" title="Export Data"
          subtitle="Download analysis results in various formats." />

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: ui.space.lg, marginTop: ui.space.md }}>
          <DownloadButton
            icon="📋"
            label="JSON Data"
            sub="Full dashboard_data.json"
            onClick={downloadJSON}
            color={COLORS.accent1}
          />
          <DownloadButton
            icon="📊"
            label="CSV Summary"
            sub="Claims table export"
            onClick={downloadCSV}
            disabled={claimCount === 0}
            color={COLORS.accent4}
          />
          <DownloadButton
            icon="📑"
            label="Excel Workbook"
            sub={hasRunId ? "5-sheet formatted report" : "Requires server run"}
            onClick={downloadExcel}
            disabled={!hasRunId}
            color={COLORS.accent3}
          />
          <DownloadButton
            icon="📄"
            label="PDF Report"
            sub={hasRunId ? "Investment analysis report" : "Requires server run"}
            onClick={downloadPDF}
            disabled={!hasRunId}
            color={COLORS.accent5}
          />
        </div>
      </Card>

      {/* ── Workspace Save ── */}
      <Card>
        <SectionTitle number="2" title="Workspace Integration"
          subtitle="Save results to parent application workspace." />
        <div style={{ display: 'flex', gap: ui.space.lg, alignItems: 'center', flexWrap: 'wrap' }}>
          <DownloadButton
            icon="💾"
            label="Save to Workspace"
            sub="Dispatch event to parent app"
            onClick={triggerSave}
            color={COLORS.accent6}
          />
          {lastAction && (
            <div style={{
              padding: '12px 20px', borderRadius: 8,
              background: `${COLORS.accent4}15`, border: `1px solid ${COLORS.accent4}40`,
            }}>
              <span style={{ color: COLORS.accent4, fontSize: ui.sizes.sm, fontWeight: 600 }}>✓ {lastAction}</span>
            </div>
          )}
        </div>
      </Card>

      {/* ── Data Summary ── */}
      <Card>
        <SectionTitle number="3" title="Data Contents"
          subtitle="Summary of what's included in the export." />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: ui.space.md }}>
          {[
            { label: 'Claims', value: claimCount, available: claimCount > 0 },
            { label: 'Investment Grid', value: `${Object.keys(data?.investment_grid || {}).length} cells`, available: hasGrid },
            { label: 'Risk Analytics', value: data?.risk ? 'Available' : 'N/A', available: !!data?.risk },
            { label: 'Cashflow Analysis', value: data?.cashflow_analysis ? 'Available' : 'N/A', available: !!data?.cashflow_analysis },
            { label: 'Breakeven Data', value: data?.breakeven_data ? `${data.breakeven_data.length} points` : 'N/A', available: !!data?.breakeven_data },
            { label: 'Sensitivity', value: data?.sensitivity ? `${data.sensitivity.length} sweeps` : 'N/A', available: !!data?.sensitivity },
            { label: 'Probability Tree', value: data?.probability_summary ? 'Available' : 'N/A', available: !!data?.probability_summary },
            { label: 'Timeline', value: data?.timeline_summary ? 'Available' : 'N/A', available: !!data?.timeline_summary },
          ].map((item, i) => (
            <div key={i} style={{
              padding: '12px 16px', borderRadius: 8,
              background: '#0F1219', border: `1px solid ${COLORS.cardBorder}`,
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
              <span style={{ color: COLORS.textMuted, fontSize: ui.sizes.sm, fontWeight: 600 }}>{item.label}</span>
              <span style={{
                color: item.available ? COLORS.accent4 : COLORS.textMuted,
                fontSize: ui.sizes.sm, fontWeight: 700,
              }}>
                {item.available ? '✓' : '—'} {item.value}
              </span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
