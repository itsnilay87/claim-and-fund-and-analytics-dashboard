import { ArrowRight, IndianRupee, Scale, Clock, TrendingUp } from 'lucide-react'

const caseStudies = [
  {
    category: 'SIAC Arbitration',
    title: 'Cross-Border Construction Dispute — $120M Quantum',
    description: 'Monte Carlo analysis revealed a 68% base-case recovery probability with 2.7x MOIC at P50, enabling precise structuring of an upfront + tail investment.',
    metrics: [
      { label: 'Quantum', value: '₹960 Cr' },
      { label: 'MOIC (P50)', value: '2.7x' },
      { label: 'IRR', value: '32.4%' },
      { label: 'Duration', value: '4.2 yrs' },
    ],
    color: 'from-teal-500 to-cyan-500',
  },
  {
    category: 'Domestic S.34',
    title: 'Energy Sector Arbitration — ₹450 Cr Claim',
    description: 'Probability tree modeling of S.34 → S.37 → SLP challenge chain showed 22% enforcement attrition, adjusting expected recovery downward from initial estimates.',
    metrics: [
      { label: 'Quantum', value: '₹450 Cr' },
      { label: 'MOIC (P50)', value: '2.1x' },
      { label: 'IRR', value: '24.7%' },
      { label: 'Duration', value: '5.8 yrs' },
    ],
    color: 'from-cyan-500 to-teal-500',
  },
  {
    category: 'Portfolio Analysis',
    title: 'Six-Claim Portfolio Optimization',
    description: 'Running the full 6-claim portfolio through 10,000 simulated paths showed diversification benefit of 15% lower VaR vs. sum of individual claim VaRs.',
    metrics: [
      { label: 'Total SOC', value: '₹5,144 Cr' },
      { label: 'Portfolio MOIC', value: '2.4x' },
      { label: 'VaR (5%)', value: '0.8x' },
      { label: 'Claims', value: '6' },
    ],
    color: 'from-teal-600 to-emerald-500',
  },
]

export default function CaseStudies() {
  return (
    <section className="py-24 relative">
      <div className="max-w-7xl mx-auto px-6">
        <div className="text-center mb-16">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-teal-500/10 border border-teal-500/20 mb-4">
            <Scale size={14} className="text-teal-500 dark:text-teal-400" />
            <span className="text-xs font-medium text-teal-600 dark:text-teal-400">Analytics in Action</span>
          </div>
          <h2 className="text-3xl md:text-4xl font-bold text-slate-900 dark:text-white mb-4">
            Real-World Claim Analysis
          </h2>
          <p className="text-slate-500 dark:text-slate-400 max-w-2xl mx-auto">
            See how quantitative analysis transforms raw claim data into
            actionable investment intelligence across jurisdictions and quantum ranges.
          </p>
        </div>

        <div className="space-y-6">
          {caseStudies.map((study, i) => (
            <div key={i} className="glass-card overflow-hidden hover:shadow-md dark:hover:bg-white/[0.06] transition-all group">
              <div className="flex flex-col lg:flex-row">
                {/* Content */}
                <div className="flex-1 p-8">
                  <div className={`inline-flex items-center gap-2 px-3 py-1 rounded-full bg-gradient-to-r ${study.color} text-white text-xs font-medium mb-4`}>
                    {study.category}
                  </div>
                  <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-3">{study.title}</h3>
                  <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed mb-6">{study.description}</p>
                  <button className="inline-flex items-center gap-1 text-sm text-teal-600 dark:text-teal-400 hover:text-teal-500 dark:hover:text-teal-300 font-medium group-hover:gap-2 transition-all">
                    View Full Analysis <ArrowRight size={14} />
                  </button>
                </div>

                {/* Metrics */}
                <div className="lg:w-80 bg-slate-50 dark:bg-white/[0.03] border-t lg:border-t-0 lg:border-l border-slate-200 dark:border-white/10 p-8 grid grid-cols-2 gap-6">
                  {study.metrics.map((m, j) => (
                    <div key={j}>
                      <div className="text-xs text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-1">{m.label}</div>
                      <div className="text-xl font-bold text-slate-900 dark:text-white">{m.value}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
