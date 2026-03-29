/**
 * DownloadsPanel.jsx — Slide-out panel listing all downloadable files from a simulation run.
 *
 * Fetches file list from /api/results/:runId/files and groups them
 * by category (Excel, PDF, Data, Charts, Logs).
 */
import { useState, useEffect, useCallback } from 'react';
import { api, getAccessToken } from '../../services/api';

const API_BASE = '';  // Relative — Nginx proxies /api/ to Node backend

/* ── Category icons & labels ── */
const CATEGORY_CONFIG = {
  excel: {
    label: 'Excel Reports',
    icon: (
      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
      </svg>
    ),
    color: 'text-green-400',
    bgColor: 'bg-green-500/10',
    borderColor: 'border-green-500/20',
  },
  pdf: {
    label: 'PDF Reports',
    icon: (
      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m.75 12l3 3m0 0l3-3m-3 3v-6m-1.5-9H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
      </svg>
    ),
    color: 'text-red-400',
    bgColor: 'bg-red-500/10',
    borderColor: 'border-red-500/20',
  },
  data: {
    label: 'Data Files',
    icon: (
      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 0v3.75m-16.5-3.75v3.75m16.5 0v3.75C20.25 16.153 16.556 18 12 18s-8.25-1.847-8.25-4.125v-3.75m16.5 0c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125" />
      </svg>
    ),
    color: 'text-blue-400',
    bgColor: 'bg-blue-500/10',
    borderColor: 'border-blue-500/20',
  },
  chart: {
    label: 'Charts (PNG)',
    icon: (
      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M2.25 18.75h18a2.25 2.25 0 002.25-2.25V6.108a2.25 2.25 0 00-2.25-2.25H4.5A2.25 2.25 0 002.25 6v10.5a2.25 2.25 0 002.25 2.25z" />
      </svg>
    ),
    color: 'text-purple-400',
    bgColor: 'bg-purple-500/10',
    borderColor: 'border-purple-500/20',
  },
  log: {
    label: 'Run Logs',
    icon: (
      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 7.5l3 2.25-3 2.25m4.5 0h3m-9 8.25h13.5A2.25 2.25 0 0021 18V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v12a2.25 2.25 0 002.25 2.25z" />
      </svg>
    ),
    color: 'text-gray-400',
    bgColor: 'bg-gray-500/10',
    borderColor: 'border-gray-500/20',
  },
};

/* File descriptions for known files */
const FILE_DESCRIPTIONS = {
  'TATA_V2_Valuation_Model.xlsx': 'Standard 14-sheet valuation workbook',
  'TATA_V2_Valuation_Model_SIAC.xlsx': 'SIAC portfolio valuation workbook',
  'TATA_V2_Valuation_Model_Domestic.xlsx': 'Domestic portfolio valuation workbook',
  'TATA_V2_Valuation_Model_HKIAC.xlsx': 'HKIAC portfolio valuation workbook',
  'Investment_Analysis_Report.xlsx': 'Comprehensive 20-sheet investment report',
  'Investment_Analysis_Report_SIAC.xlsx': 'SIAC comprehensive investment report',
  'Investment_Analysis_Report_Domestic.xlsx': 'Domestic comprehensive investment report',
  'Investment_Analysis_Report_HKIAC.xlsx': 'HKIAC comprehensive investment report',
  'Chart_Data.xlsx': 'Chart data for presentations (IRR, MOIC, cashflows)',
  'Chart_Data_SIAC.xlsx': 'SIAC chart data for presentations',
  'Chart_Data_Domestic.xlsx': 'Domestic chart data for presentations',
  'Chart_Data_HKIAC.xlsx': 'HKIAC chart data for presentations',
  'TATA_V2_Investment_Analysis.pdf': 'PDF investment analysis report',
  'dashboard_data.json': 'Dashboard visualization data',
  'stochastic_pricing.json': 'Stochastic pricing grid results',
  'run_log.txt': 'Simulation run output log',
};

function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getFileDescription(name) {
  return FILE_DESCRIPTIONS[name] || '';
}

function FileRow({ file, runId }) {
  const handleDownload = async () => {
    const url = `${API_BASE}/api/results/${encodeURIComponent(runId)}/${file.path}?download=1`;
    const token = getAccessToken();
    const res = await fetch(url, {
      headers: token ? { 'Authorization': `Bearer ${token}` } : {},
      credentials: 'include',
    });
    if (!res.ok) return;
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = file.name;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const desc = getFileDescription(file.name);

  return (
    <div className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-white/5 transition-colors group">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-slate-200 truncate">{file.name}</span>
          <span className="text-xs text-slate-500 flex-shrink-0">{formatFileSize(file.size)}</span>
        </div>
        {desc && <p className="text-xs text-slate-500 mt-0.5 truncate">{desc}</p>}
      </div>
      <button
        onClick={handleDownload}
        className="ml-3 flex-shrink-0 p-1.5 rounded-md text-slate-400 hover:text-white hover:bg-white/10 transition-colors opacity-70 group-hover:opacity-100"
        title={`Download ${file.name}`}
      >
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
        </svg>
      </button>
    </div>
  );
}

function CategorySection({ catKey, files, runId, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  const config = CATEGORY_CONFIG[catKey] || CATEGORY_CONFIG.data;

  if (!files || files.length === 0) return null;

  return (
    <div className={`border rounded-lg ${config.borderColor} overflow-hidden`}>
      <button
        onClick={() => setOpen(!open)}
        className={`w-full flex items-center justify-between px-4 py-3 ${config.bgColor} hover:bg-opacity-20 transition-colors`}
      >
        <div className="flex items-center gap-3">
          <span className={config.color}>{config.icon}</span>
          <span className="text-sm font-semibold text-slate-200">{config.label}</span>
          <span className="text-xs text-slate-500 bg-slate-800 px-2 py-0.5 rounded-full">{files.length}</span>
        </div>
        <svg
          className={`w-4 h-4 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`}
          viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
        </svg>
      </button>
      {open && (
        <div className="px-2 py-1 space-y-0.5">
          {files.map(file => (
            <FileRow key={file.path} file={file} runId={runId} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function DownloadsPanel({ runId, isOpen, onClose }) {
  const [fileData, setFileData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchFiles = useCallback(async () => {
    if (!runId) return;
    setLoading(true);
    setError(null);

    try {
      const data = await api.get(`/api/results/${encodeURIComponent(runId)}/files`);
      setFileData(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [runId]);

  useEffect(() => {
    if (isOpen) fetchFiles();
  }, [isOpen, fetchFiles]);

  const handleDownloadAll = () => {
    if (!fileData) return;
    const downloadable = [
      ...(fileData.categories.excel || []),
      ...(fileData.categories.pdf || []),
    ];
    const token = getAccessToken();
    downloadable.forEach((file, i) => {
      setTimeout(async () => {
        const url = `${API_BASE}/api/results/${encodeURIComponent(runId)}/${file.path}?download=1`;
        const res = await fetch(url, {
          headers: token ? { 'Authorization': `Bearer ${token}` } : {},
          credentials: 'include',
        });
        if (!res.ok) return;
        const blob = await res.blob();
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = file.name;
        a.click();
        URL.revokeObjectURL(a.href);
      }, i * 500);
    });
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="relative w-full max-w-md bg-slate-900 border-l border-slate-700 shadow-2xl flex flex-col animate-slide-in-right">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700">
          <div>
            <h2 className="text-lg font-bold text-white">Downloads</h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Run: <span className="font-mono">{runId?.slice(0, 8)}...</span>
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleDownloadAll}
              disabled={!fileData || loading}
              className="px-3 py-1.5 text-xs font-semibold rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-white"
              style={{ background: 'linear-gradient(135deg, #10B981 0%, #06B6D4 100%)' }}
              title="Download all Excel & PDF files"
            >
              Download All
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-md text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {loading && (
            <div className="flex items-center justify-center py-12">
              <div className="w-8 h-8 border-4 border-slate-700 border-t-cyan-500 rounded-full animate-spin" />
            </div>
          )}

          {error && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 text-center">
              <p className="text-sm text-red-400 font-medium">Failed to load files</p>
              <p className="text-xs text-red-400/70 mt-1">{error}</p>
              <button
                onClick={fetchFiles}
                className="mt-3 px-4 py-1.5 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 rounded-md transition-colors"
              >
                Retry
              </button>
            </div>
          )}

          {fileData && !loading && (
            <>
              <div className="text-xs text-slate-500 mb-2">
                {fileData.totalFiles} files available
              </div>

              <CategorySection catKey="excel" files={fileData.categories.excel} runId={runId} defaultOpen={true} />
              <CategorySection catKey="pdf" files={fileData.categories.pdf} runId={runId} defaultOpen={true} />
              <CategorySection catKey="data" files={fileData.categories.data} runId={runId} />
              <CategorySection catKey="chart" files={fileData.categories.charts} runId={runId} />
              <CategorySection catKey="log" files={fileData.categories.logs} runId={runId} />
            </>
          )}

          {fileData && !loading && fileData.totalFiles === 0 && (
            <div className="text-center py-12">
              <svg className="w-12 h-12 text-slate-600 mx-auto mb-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 13.5h3.86a2.25 2.25 0 012.012 1.244l.256.512a2.25 2.25 0 002.013 1.244h3.218a2.25 2.25 0 002.013-1.244l.256-.512a2.25 2.25 0 012.013-1.244h3.859m-17.5 0a8.25 8.25 0 0114.5 0M2.25 13.5V19.5a2.25 2.25 0 002.25 2.25h15a2.25 2.25 0 002.25-2.25v-6" />
              </svg>
              <p className="text-sm text-slate-500">No files found for this portfolio</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
