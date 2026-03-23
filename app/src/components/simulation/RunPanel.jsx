import { useState } from 'react';

const STATUS_COLORS = { queued:'bg-slate-500', running:'bg-amber-500 animate-pulse', completed:'bg-emerald-400', failed:'bg-red-400' };
const STATUS_LABELS = { queued:'Queued', running:'Running...', completed:'Completed', failed:'Failed' };

export default function RunPanel({ config, defaults, onRun, activeRun, polling, runs, onViewResults, onOpenDownloads, serverAvailable }) {
  const runHistory = runs || [];
  const [selectedPortfolios, setSelectedPortfolios] = useState(['all']);
  const PORTFOLIO_OPTIONS = [{ value:'all', label:'All Claims' }, { value:'siac', label:'SIAC Only' }, { value:'domestic', label:'Domestic Only' }, { value:'hkiac', label:'HKIAC Only' }];

  const togglePortfolio = (val) => {
    setSelectedPortfolios(prev => {
      if(prev.includes(val)) { const next=prev.filter(v=>v!==val); return next.length===0 ? [val] : next; }
      return [...prev, val];
    });
  };

  return (
    <div className="glass-card flex flex-col overflow-hidden">
      <div className="p-4 border-b border-white/5"><h2 className="text-lg font-bold text-white">Run Simulation</h2></div>
      <div className="p-4 border-b border-white/5">
        <h3 className="text-sm font-semibold text-slate-400 mb-2">Portfolios</h3>
        <div className="space-y-1">
          {PORTFOLIO_OPTIONS.map(opt => (
            <label key={opt.value} className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
              <input type="checkbox" checked={selectedPortfolios.includes(opt.value)} onChange={()=>togglePortfolio(opt.value)} className="rounded border-white/20 bg-slate-800 text-teal-500 focus:ring-teal-500" />
              {opt.label}
            </label>
          ))}
        </div>
      </div>
      <div className="p-4 border-b border-white/5">
        <button onClick={()=>onRun(selectedPortfolios)} disabled={(activeRun && activeRun.status==='running') || serverAvailable === false}
          className="w-full py-2.5 rounded-lg font-semibold text-white bg-gradient-to-r from-teal-600 to-cyan-600 hover:from-teal-500 hover:to-cyan-500 transition-all shadow-lg shadow-teal-500/25 disabled:opacity-50 disabled:cursor-not-allowed">
          {activeRun?.status === 'running' ? 'Running...' : serverAvailable === false ? 'Server Offline' : 'Run Simulation'}
        </button>
      </div>
      {activeRun && (
        <div className="p-4 border-b border-white/5">
          <h3 className="text-sm font-semibold text-slate-400 mb-2">Active Run</h3>
          <div className="bg-slate-800/30 rounded-lg p-3 text-sm space-y-2 border border-white/5">
            <div className="flex items-center gap-2"><span className={'w-2.5 h-2.5 rounded-full ' + (STATUS_COLORS[activeRun.status]||'')} /><span className="font-medium text-slate-300">{STATUS_LABELS[activeRun.status]}</span></div>
            <div className="text-xs text-slate-500 font-mono truncate">{activeRun.runId}</div>
            {activeRun.status==='completed' && (
              <div className="space-y-1.5 mt-1">
                <button onClick={()=>onViewResults(activeRun.runId, activeRun.portfolios?.[0]||'all', activeRun.completedPortfolios||activeRun.portfolios||['all'])} className="w-full py-1.5 px-3 text-white text-xs font-semibold rounded-lg bg-gradient-to-r from-emerald-500 to-cyan-500 transition-colors">View Results</button>
                <button onClick={()=>onOpenDownloads && onOpenDownloads(activeRun.runId, activeRun.portfolios?.[0]||'all')} className="w-full py-1.5 px-3 text-xs font-semibold rounded-lg border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10 transition-colors">Download Files</button>
              </div>
            )}
          </div>
        </div>
      )}
      <div className="p-4 flex-1 overflow-y-auto">
        <h3 className="text-sm font-semibold text-slate-400 mb-2">History</h3>
        {runHistory.length === 0 ? <p className="text-xs text-slate-600">No previous runs.</p> : (
          <div className="space-y-2">{runHistory.map(run => (
            <div key={run.runId} className="bg-slate-800/30 rounded-lg p-2.5 text-xs border border-white/5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5"><span className={'w-2 h-2 rounded-full ' + (STATUS_COLORS[run.status]||'')} /><span className="font-medium text-slate-300">{STATUS_LABELS[run.status]}</span></div>
                {run.status==='completed' && <button onClick={()=>onViewResults(run.runId,run.portfolios?.[0]||'all',run.completedPortfolios||run.portfolios||['all'])} className="text-teal-400 hover:text-teal-300 font-semibold">View</button>}
              </div>
              <div className="text-slate-600 font-mono mt-1 truncate">{run.runId}</div>
            </div>
          ))}</div>
        )}
      </div>
    </div>
  );
}
