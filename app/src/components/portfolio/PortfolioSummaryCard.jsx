/**
 * @module PortfolioSummaryCard
 * @description Portfolio summary card with structure label, claim count, and actions.
 *
 * Displays portfolio name, structure type, number of claims, total SOC,
 * and run/view actions.  Uses STRUCTURE_LABELS constant for display names.
 *
 * @prop {Object} portfolio - Portfolio configuration object.
 * @prop {Function} onOpen - Callback to open portfolio editor.
 * @prop {Function} onRun - Callback to run simulation.
 */
const STRUCTURE_LABELS = {
  litigation_funding: 'Litigation Funding',
  monetisation_full_purchase: 'Full Purchase',
  monetisation_upfront_tail: 'Upfront + Tail',
  monetisation_staged: 'Staged Payments',
  monetisation_hybrid_payoff: 'Hybrid Payoff',
  comparative: 'Comparative',
};

const JURISDICTION_LABELS = {
  indian_domestic: 'Indian Domestic',
  siac_singapore: 'SIAC Singapore',
  hkiac_hongkong: 'HKIAC Hong Kong',
  icc_paris: 'ICC Paris',
  lcia_london: 'LCIA London',
};

export default function PortfolioSummaryCard({
  portfolioName,
  selectedClaims,
  selectedClaimObjects,
  structure,
  structureConfig,
  simulation,
  totalSOC,
  jurisdictions,
  avgWinRate,
}) {
  return (
    <div className="space-y-4">
      {/* Portfolio info */}
      <div className="glass-card p-4 space-y-3">
        <h3 className="text-sm font-semibold text-white">Portfolio Summary</h3>
        <div className="space-y-2 text-xs">
          <Row label="Name" value={portfolioName || 'Untitled'} />
          <Row label="Claims" value={`${selectedClaims.length} selected`} />
          <Row label="Total SOC" value={`₹${totalSOC.toLocaleString()} Cr`} highlight />
          <Row label="Jurisdictions" value={jurisdictions.map((j) => JURISDICTION_LABELS[j] || j).join(', ') || '—'} />
          <Row label="Avg Win Rate" value={avgWinRate > 0 ? `${(avgWinRate * 100).toFixed(0)}%` : '—'} />
          <Row label="Structure" value={STRUCTURE_LABELS[structure] || '—'} />
        </div>
      </div>

      {/* Selected claims list */}
      {selectedClaimObjects.length > 0 && (
        <div className="glass-card p-4">
          <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Claims</h4>
          <div className="space-y-1.5">
            {selectedClaimObjects.map((c) => (
              <div key={c.id} className="flex items-center justify-between text-xs">
                <span className="text-slate-300 truncate">{c.name || 'Unnamed'}</span>
                <span className="text-slate-500 shrink-0 ml-2">₹{(c.soc_value_cr || 0).toLocaleString()}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Simulation params */}
      <div className="glass-card p-4">
        <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Simulation</h4>
        <div className="space-y-1.5 text-xs">
          <Row label="MC Paths" value={(simulation.n_paths || 10000).toLocaleString()} />
          <Row label="Seed" value={simulation.seed} />
          <Row label="Discount" value={`${((simulation.discount_rate || 0.12) * 100).toFixed(1)}%`} />
          <Row label="Risk-Free" value={`${((simulation.risk_free_rate || 0.07) * 100).toFixed(1)}%`} />
          <Row label="Start" value={simulation.start_date || '—'} />
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, highlight }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-slate-500">{label}</span>
      <span className={highlight ? 'text-cyan-400 font-medium' : 'text-slate-300'}>{value}</span>
    </div>
  );
}
