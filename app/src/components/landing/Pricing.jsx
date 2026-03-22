import { Check, CreditCard } from 'lucide-react'
import { Link } from 'react-router-dom'

const plans = [
  {
    name: 'Starter',
    price: 'Free',
    period: 'for prototype',
    description: 'Explore the platform with sample data',
    features: ['5 simulation runs / month', '1,000 Monte Carlo paths', 'Basic results dashboard', 'Email support'],
    cta: 'Get Started',
    highlight: false,
  },
  {
    name: 'Professional',
    price: '$299',
    period: '/ month',
    description: 'Full analytics for litigation finance teams',
    features: ['Unlimited simulations', '10,000 Monte Carlo paths', 'Full 8-tab dashboard', 'Excel & PDF exports', 'Priority support', 'Custom claim configuration'],
    cta: 'Start Free Trial',
    highlight: true,
  },
  {
    name: 'Enterprise',
    price: 'Custom',
    period: '',
    description: 'Dedicated deployment for institutions',
    features: ['Everything in Professional', 'Custom Monte Carlo paths (50K+)', 'API access', 'SSO & role management', 'Dedicated account manager', 'On-premise deployment option'],
    cta: 'Contact Sales',
    highlight: false,
  },
]

export default function Pricing() {
  return (
    <section id="pricing" className="py-24 relative">
      <div className="max-w-6xl mx-auto px-6">
        <div className="text-center mb-16">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-teal-500/10 border border-teal-500/20 mb-4">
            <CreditCard size={14} className="text-teal-500 dark:text-teal-400" />
            <span className="text-xs font-medium text-teal-600 dark:text-teal-400">Pricing</span>
          </div>
          <h2 className="text-3xl md:text-4xl font-bold text-slate-900 dark:text-white mb-4">
            Simple, Transparent Pricing
          </h2>
          <p className="text-slate-500 dark:text-slate-400 max-w-xl mx-auto">
            Start free, scale as your portfolio grows.
          </p>
          <div className="inline-flex items-center gap-2 mt-4 px-3 py-1 rounded-full bg-amber-500/10 border border-amber-500/20">
            <span className="text-xs text-amber-600 dark:text-amber-400 font-medium">Coming Soon — Currently in Beta</span>
          </div>
        </div>

        <div className="grid md:grid-cols-3 gap-6">
          {plans.map((plan, i) => (
            <div key={i} className={`rounded-2xl p-8 transition-all ${
              plan.highlight
                ? 'bg-gradient-to-b from-teal-50 dark:from-teal-950/80 to-white dark:to-slate-900/80 border-2 border-teal-500/50 shadow-2xl shadow-teal-500/10 scale-105'
                : 'glass-card hover:shadow-md dark:hover:bg-white/[0.06]'
            }`}>
              {plan.highlight && (
                <div className="text-xs font-semibold text-teal-600 dark:text-teal-400 uppercase tracking-wider mb-4">Most Popular</div>
              )}
              <h3 className="text-xl font-bold text-slate-900 dark:text-white">{plan.name}</h3>
              <div className="mt-4 flex items-baseline gap-1">
                <span className="text-4xl font-extrabold text-slate-900 dark:text-white">{plan.price}</span>
                <span className="text-slate-500 dark:text-slate-400 text-sm">{plan.period}</span>
              </div>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-2">{plan.description}</p>

              <Link to="/signup" className={`block w-full text-center mt-6 px-6 py-3 rounded-lg font-medium transition-all ${
                plan.highlight
                  ? 'bg-gradient-to-r from-teal-600 to-cyan-600 text-white hover:from-teal-500 hover:to-cyan-500 shadow-lg shadow-teal-500/25'
                  : 'bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-900 dark:text-white hover:bg-slate-200 dark:hover:bg-white/10'
              }`}>
                {plan.cta}
              </Link>

              <ul className="mt-8 space-y-3">
                {plan.features.map((f, j) => (
                  <li key={j} className="flex items-start gap-3 text-sm text-slate-600 dark:text-slate-300">
                    <Check size={16} className="text-teal-500 mt-0.5 flex-shrink-0" />
                    {f}
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
