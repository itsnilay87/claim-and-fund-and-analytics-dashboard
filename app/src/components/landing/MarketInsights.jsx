import { BookOpen, FileText, TrendingUp, ExternalLink } from 'lucide-react'

const insights = [
  {
    type: 'Research',
    icon: BookOpen,
    title: 'Quantifying Enforcement Risk in Indian Arbitration',
    description: 'How multi-level challenge trees (S.34 → S.37 → SLP) impact expected recovery rates and what funders should model.',
    readTime: '8 min read',
  },
  {
    type: 'Methodology',
    icon: FileText,
    title: 'Monte Carlo Simulation for Litigation Finance',
    description: 'Why 10,000 simulation paths provide robust confidence intervals for MOIC, IRR, and VaR—and the math behind our engine.',
    readTime: '12 min read',
  },
  {
    type: 'Market Update',
    icon: TrendingUp,
    title: 'SIAC vs. Domestic: Portfolio Diversification Benefits',
    description: 'Analysis of correlation structures across jurisdiction types and how blended portfolios reduce tail risk by up to 15%.',
    readTime: '6 min read',
  },
]

const platformStats = [
  { value: '₹5,144 Cr', label: 'Total Claim Quantum Analyzed' },
  { value: '10,000+', label: 'Monte Carlo Paths Per Simulation' },
  { value: '156', label: 'Pricing Combinations Computed' },
  { value: '6', label: 'Active Claim Pipelines' },
  { value: '2.4x', label: 'Average Portfolio MOIC' },
  { value: '28.1%', label: 'Average Portfolio IRR' },
]

export default function MarketInsights() {
  return (
    <section className="py-24 relative">
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-teal-50/50 dark:via-teal-950/10 to-transparent" />
      <div className="relative max-w-7xl mx-auto px-6">
        {/* Platform Stats Bar */}
        <div className="glass-card p-8 mb-20 glow-teal">
          <div className="text-center mb-8">
            <h2 className="text-2xl md:text-3xl font-bold text-slate-900 dark:text-white mb-2">
              Platform at a Glance
            </h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">Real-time analytics across all claim portfolios</p>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-6">
            {platformStats.map((stat, i) => (
              <div key={i} className="text-center">
                <div className="text-2xl md:text-3xl font-bold text-teal-600 dark:text-teal-400">{stat.value}</div>
                <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">{stat.label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Insights */}
        <div className="text-center mb-12">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-teal-500/10 border border-teal-500/20 mb-4">
            <BookOpen size={14} className="text-teal-500 dark:text-teal-400" />
            <span className="text-xs font-medium text-teal-600 dark:text-teal-400">Insights & Research</span>
          </div>
          <h2 className="text-3xl md:text-4xl font-bold text-slate-900 dark:text-white mb-4">
            Thought Leadership
          </h2>
          <p className="text-slate-500 dark:text-slate-400 max-w-xl mx-auto">
            Deep dives into methodology, market trends, and analytical frameworks
            for litigation finance decision-making.
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-6">
          {insights.map((item, i) => (
            <article key={i} className="glass-card overflow-hidden hover:shadow-md dark:hover:bg-white/[0.08] transition-all group cursor-pointer">
              {/* Top accent bar */}
              <div className="h-1 bg-gradient-to-r from-teal-500 to-cyan-500" />
              <div className="p-6">
                <div className="flex items-center gap-2 mb-4">
                  <item.icon size={14} className="text-teal-500 dark:text-teal-400" />
                  <span className="text-xs font-medium text-teal-600 dark:text-teal-400 uppercase tracking-wider">{item.type}</span>
                </div>
                <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-2 group-hover:text-teal-600 dark:group-hover:text-teal-400 transition-colors">
                  {item.title}
                </h3>
                <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed mb-4">{item.description}</p>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-slate-400 dark:text-slate-500">{item.readTime}</span>
                  <ExternalLink size={14} className="text-slate-400 dark:text-slate-500 group-hover:text-teal-500 dark:group-hover:text-teal-400 transition-colors" />
                </div>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  )
}
