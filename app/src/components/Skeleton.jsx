/**
 * Skeleton loading components for the claim analytics app.
 * Provides visual placeholders during data loading.
 */

/** Pulsing skeleton bar */
export function SkeletonBar({ className = '', style = {} }) {
  return (
    <div
      className={`bg-slate-800 rounded-lg animate-pulse ${className}`}
      style={{ height: 16, ...style }}
    />
  );
}

/** Skeleton card — placeholder for KPI or stat cards */
export function SkeletonCard({ lines = 3 }) {
  return (
    <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-5 space-y-3">
      <SkeletonBar style={{ width: '40%', height: 12 }} />
      <SkeletonBar style={{ width: '65%', height: 24 }} />
      {Array.from({ length: lines - 2 }, (_, i) => (
        <SkeletonBar key={i} style={{ width: `${55 + Math.random() * 30}%`, height: 12 }} />
      ))}
    </div>
  );
}

/** Skeleton row — for table-like loading */
export function SkeletonRow({ cols = 5 }) {
  return (
    <div className="flex gap-4 py-3 border-b border-slate-800">
      {Array.from({ length: cols }, (_, i) => (
        <SkeletonBar
          key={i}
          style={{ flex: i === 0 ? 2 : 1, height: 14 }}
        />
      ))}
    </div>
  );
}

/** Skeleton grid — multiple skeleton cards */
export function SkeletonGrid({ cards = 4, cols = 4 }) {
  return (
    <div className={`grid gap-4`} style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
      {Array.from({ length: cards }, (_, i) => (
        <SkeletonCard key={i} />
      ))}
    </div>
  );
}

/** Skeleton table — header + rows */
export function SkeletonTable({ rows = 5, cols = 5 }) {
  return (
    <div className="bg-slate-800/40 border border-slate-700/50 rounded-xl p-4">
      <SkeletonBar style={{ width: '30%', height: 20, marginBottom: 16 }} />
      {Array.from({ length: rows }, (_, i) => (
        <SkeletonRow key={i} cols={cols} />
      ))}
    </div>
  );
}

/** Full-page placeholder for workspace loading */
export function WorkspaceSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      {/* Header area */}
      <div className="flex justify-between items-center">
        <div className="space-y-2">
          <SkeletonBar style={{ width: 240, height: 28 }} />
          <SkeletonBar style={{ width: 160, height: 14 }} />
        </div>
        <SkeletonBar style={{ width: 120, height: 36, borderRadius: 8 }} />
      </div>

      {/* KPI row */}
      <SkeletonGrid cards={4} cols={4} />

      {/* Table */}
      <SkeletonTable rows={4} cols={6} />
    </div>
  );
}

/** Simulation progress component */
export function SimulationProgress({ progress = 0, stage = '' }) {
  return (
    <div className="bg-slate-800/60 border border-indigo-500/20 rounded-xl p-6">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-5 h-5 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
        <span className="text-sm font-semibold text-white">Running Simulation...</span>
      </div>
      {stage && (
        <p className="text-xs text-slate-400 mb-3">{stage}</p>
      )}
      <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-indigo-600 to-cyan-500 rounded-full transition-all duration-700"
          style={{ width: `${Math.min(progress, 100)}%` }}
        />
      </div>
      <div className="text-right mt-1">
        <span className="text-xs text-slate-500 font-mono">{Math.round(progress)}%</span>
      </div>
    </div>
  );
}
