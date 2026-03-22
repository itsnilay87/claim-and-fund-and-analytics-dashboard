import { BarChart3, GitBranch, Calculator, PieChart, DollarSign, LineChart, Layers } from 'lucide-react'

const features = [
  {
    icon: BarChart3,
    title: 'Monte Carlo Simulation',
    description: '10,000-path stochastic engine models every variable from arbitration outcome to court challenge, capturing full uncertainty across all scenarios.',
    detail: 'Correlated random draws, ScaledBeta distributions, configurable path counts',
    color: 'from-teal-500 to-teal-600',
  },
  {
    icon: GitBranch,
    title: 'Probability Trees',
    description: 'Multi-level challenge trees for Domestic (S.34 → S.37 → SLP) and SIAC (HC → CoA) jurisdictions with scenario-dependent branching.',
    detail: 'Conditional probabilities, restart modeling, jurisdiction-specific paths',
    color: 'from-cyan-500 to-cyan-600',
  },
  {
    icon: Calculator,
    title: 'Stochastic Pricing',
    description: '156 investment combinations across upfront and tail percentages, with MOIC/IRR percentile distributions and VaR metrics.',
    detail: 'Upfront 5–30%, tail 5–50%, MOIC percentile grids, break-even analysis',
    color: 'from-teal-600 to-emerald-500',
  },
  {
    icon: PieChart,
    title: 'Portfolio Optimization',
    description: 'Analyze full portfolio, SIAC-only, or Domestic-only claim sets with correlated outcomes and aggregated metrics.',
    detail: 'Diversification benefit, correlation modeling, portfolio-level VaR',
    color: 'from-emerald-500 to-teal-500',
  },
  {
    icon: DollarSign,
    title: 'Legal Cost Modeling',
    description: 'Duration-based stochastic cost engine with tribunal fees, expert costs, and ScaledBeta overrun distributions.',
    detail: 'Phase-by-phase costs, overrun scenarios, enforcement cost modeling',
    color: 'from-cyan-600 to-teal-500',
  },
  {
    icon: LineChart,
    title: 'Cashflow & XIRR',
    description: 'Monthly cashflow vectors with payment delays, computing true XIRR (actual/365), MOIC, VaR, and CVaR per simulation path.',
    detail: 'J-curve visualization, monthly granularity, payment delay modeling',
    color: 'from-teal-500 to-cyan-500',
  },
]

export default function Features() {
  return (
    <section id="features" className="py-24 relative">
      <div className="max-w-7xl mx-auto px-6">
        <div className="text-center mb-16">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-teal-500/10 border border-teal-500/20 mb-4">
            <Layers size={14} className="text-teal-500 dark:text-teal-400" />
            <span className="text-xs font-medium text-teal-600 dark:text-teal-400">Core Capabilities</span>
          </div>
          <h2 className="text-3xl md:text-4xl font-bold text-slate-900 dark:text-white mb-4">
            Institutional-Grade Analytics
          </h2>
          <p className="text-slate-500 dark:text-slate-400 max-w-2xl mx-auto">
            Every tool litigation finance professionals need to price, structure,
            and de-risk arbitration claim investments.
          </p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 stagger-children">
          {features.map((f, i) => (
            <div key={i} className="glass-card p-6 hover:shadow-md dark:hover:bg-white/[0.08] transition-all group">
              <div className={`w-10 h-10 rounded-lg bg-gradient-to-br ${f.color} flex items-center justify-center mb-4 group-hover:scale-110 transition-transform`}>
                <f.icon size={20} className="text-white" />
              </div>
              <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-2">{f.title}</h3>
              <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed mb-3">{f.description}</p>
              <p className="text-xs text-teal-600 dark:text-teal-400/60 font-medium">{f.detail}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
