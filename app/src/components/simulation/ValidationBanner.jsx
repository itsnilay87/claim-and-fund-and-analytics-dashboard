const PATH_MAP = [
  ['/investment_grid/tata_tail_pcts', 'Investment Grid > Tata Tail % (Financial tab)'],
  ['/investment_grid/upfront_pcts', 'Investment Grid > Upfront % (Financial tab)'],
  ['/simulation/n_simulations', 'Simulation Count (Simulation tab)'],
  ['/arbitration/arb_win_probability', 'Arb Win Probability (Arbitration tab)'],
  ['/quantum_bands', 'Quantum Bands (Quantum tab)'],
  ['/domestic_tree', 'Domestic Probability Tree (Prob. Trees tab)'],
  ['/siac_tree', 'SIAC Probability Tree (Prob. Trees tab)'],
  ['/timeline', 'Timeline (Timeline tab)'],
  ['/interest', 'Interest (Interest tab)'],
];

function humanizeError(err) {
  if (typeof err !== 'string') return String(err);
  for (const [path, label] of PATH_MAP) {
    if (err.includes(path)) return err.replace(new RegExp(path.replace(/\//g,'\\/') + '([/:]|$)'), label + '$1').trim();
  }
  return err;
}

export default function ValidationBanner({ errors, onDismiss }) {
  if (!errors || errors.length === 0) return null;
  return (
    <div className="bg-red-500/10 border-b border-red-500/20 px-6 py-3">
      <div className="flex items-start gap-2">
        <span className="text-red-400 font-bold text-sm mt-0.5">!</span>
        <div className="flex-1">
          <p className="text-sm font-semibold text-red-400">{errors.length} validation {errors.length === 1 ? 'error' : 'errors'} - fix before running</p>
          <ul className="mt-1.5 space-y-1">
            {errors.slice(0,8).map((err,i) => <li key={i} className="text-xs text-red-300 flex items-start gap-1.5"><span className="mt-0.5">-</span><span>{humanizeError(err)}</span></li>)}
            {errors.length > 8 && <li className="text-xs text-red-400/70 italic ml-3">...and {errors.length - 8} more</li>}
          </ul>
        </div>
        {onDismiss && <button onClick={onDismiss} className="text-red-400 hover:text-red-300 text-xs">Dismiss</button>}
      </div>
    </div>
  );
}
