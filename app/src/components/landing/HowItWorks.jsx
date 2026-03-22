import { Upload, Cpu, BarChart3, Settings } from 'lucide-react'

const steps = [
  {
    icon: Upload,
    step: '01',
    title: 'Configure Claim Data',
    description: 'Upload a JSON configuration or manually set arbitration parameters, quantum bands, probability trees, and legal cost assumptions.',
    details: ['Claim quantum ranges', 'Jurisdiction & challenge paths', 'Legal cost assumptions', 'Investment structure'],
  },
  {
    icon: Cpu,
    step: '02',
    title: 'Run Monte Carlo Engine',
    description: '10,000 simulation paths model every scenario: arbitration outcome, court challenges, quantum recovery, timeline uncertainty, and cost overruns.',
    details: ['Stochastic outcome modeling', 'Challenge probability trees', 'Cost overrun simulation', 'Timeline uncertainty'],
  },
  {
    icon: BarChart3,
    step: '03',
    title: 'Analyze & Decide',
    description: 'Interactive dashboards show MOIC/IRR distributions, probability trees, investment grids, stochastic pricing surfaces, and portfolio-level metrics.',
    details: ['8-tab interactive dashboard', 'Excel & PDF exports', 'Pricing surface grids', 'Portfolio-level VaR'],
  },
]

export default function HowItWorks() {
  return (
    <section id="how-it-works" className="py-24 relative">
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-teal-50/50 dark:via-teal-950/20 to-transparent" />
      <div className="relative max-w-5xl mx-auto px-6">
        <div className="text-center mb-16">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-teal-500/10 border border-teal-500/20 mb-4">
            <Settings size={14} className="text-teal-500 dark:text-teal-400" />
            <span className="text-xs font-medium text-teal-600 dark:text-teal-400">How It Works</span>
          </div>
          <h2 className="text-3xl md:text-4xl font-bold text-slate-900 dark:text-white mb-4">
            Three Steps to Clarity
          </h2>
          <p className="text-slate-500 dark:text-slate-400 max-w-xl mx-auto">
            From raw claim data to actionable investment intelligence in minutes.
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-8">
          {steps.map((s, i) => (
            <div key={i} className="relative text-center">
              {i < steps.length - 1 && (
                <div className="hidden md:block absolute top-12 left-[60%] w-[80%] h-px bg-gradient-to-r from-teal-500/50 to-transparent" />
              )}
              <div className="w-24 h-24 rounded-2xl bg-slate-100 dark:bg-gradient-to-br dark:from-slate-800 dark:to-slate-900 border border-slate-200 dark:border-white/10 flex items-center justify-center mx-auto mb-6 relative">
                <s.icon size={32} className="text-teal-500 dark:text-teal-400" />
                <span className="absolute -top-2 -right-2 w-7 h-7 rounded-full bg-gradient-to-r from-teal-600 to-cyan-600 text-white text-xs font-bold flex items-center justify-center">
                  {s.step}
                </span>
              </div>
              <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-3">{s.title}</h3>
              <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed mb-4">{s.description}</p>
              <ul className="space-y-1.5">
                {s.details.map((d, j) => (
                  <li key={j} className="text-xs text-slate-400 dark:text-slate-500 flex items-center justify-center gap-1.5">
                    <span className="w-1 h-1 rounded-full bg-teal-500/50" />
                    {d}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
