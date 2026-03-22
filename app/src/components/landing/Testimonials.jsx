import { TrendingUp, Scale, Globe, Award } from 'lucide-react'

const testimonials = [
  {
    quote: "The Monte Carlo simulation engine transformed how we evaluate arbitration claims. We can now quantify risk with institutional-grade precision.",
    author: "Senior Investment Director",
    firm: "Global Litigation Fund",
    icon: TrendingUp,
  },
  {
    quote: "Having 156 pricing combinations instantly computed lets our team explore deal structures that would have taken weeks to model manually.",
    author: "Head of Analytics",
    firm: "Arbitration Capital Partners",
    icon: Scale,
  },
  {
    quote: "The probability tree modeling across SIAC and Domestic jurisdictions gives us a true picture of enforcement risk for Indian arbitration claims.",
    author: "Managing Partner",
    firm: "Asia Disputes Finance",
    icon: Globe,
  },
]

const logos = [
  'Institutional Capital', 'Arbitration Finance', 'Disputes Fund', 'Claims Capital', 'Litigation Partners'
]

export default function Testimonials() {
  return (
    <section className="py-24 relative">
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-teal-950/10 dark:via-teal-950/20 to-transparent" />
      <div className="relative max-w-7xl mx-auto px-6">
        <div className="text-center mb-16">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-teal-500/10 border border-teal-500/20 mb-4">
            <Award size={14} className="text-teal-500 dark:text-teal-400" />
            <span className="text-xs font-medium text-teal-600 dark:text-teal-400">Trusted by Professionals</span>
          </div>
          <h2 className="text-3xl md:text-4xl font-bold text-slate-900 dark:text-white mb-4">
            Built for Litigation Finance
          </h2>
          <p className="text-slate-500 dark:text-slate-400 max-w-2xl mx-auto">
            Designed in partnership with litigation finance professionals who need
            institutional-grade analytics to price and manage arbitration claim portfolios.
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-6 mb-16">
          {testimonials.map((t, i) => (
            <div key={i} className="glass-card p-8 hover:shadow-md dark:hover:bg-white/[0.08] transition-all relative">
              <div className="absolute top-6 right-6">
                <t.icon size={20} className="text-teal-500/30 dark:text-teal-400/20" />
              </div>
              <div className="mb-6">
                <svg width="32" height="24" viewBox="0 0 32 24" className="text-teal-500/20 dark:text-teal-400/20">
                  <path fill="currentColor" d="M0 24V14.4C0 6.08 5.12.48 13.44 0l1.28 3.84C9.92 5.12 7.36 8.64 7.04 12H13.44V24H0Zm18.56 0V14.4C18.56 6.08 23.68.48 32 0l1.28 3.84C28.48 5.12 25.92 8.64 25.6 12H32V24H18.56Z"/>
                </svg>
              </div>
              <p className="text-slate-600 dark:text-slate-300 text-sm leading-relaxed mb-6">{t.quote}</p>
              <div className="border-t border-slate-200 dark:border-white/10 pt-4">
                <div className="text-sm font-semibold text-slate-900 dark:text-white">{t.author}</div>
                <div className="text-xs text-slate-500 dark:text-slate-400">{t.firm}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Trust logos */}
        <div className="border-t border-slate-200 dark:border-white/10 pt-12">
          <p className="text-center text-xs text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-8">Designed for Leading Institutions</p>
          <div className="flex flex-wrap justify-center gap-8 md:gap-16">
            {logos.map((name, i) => (
              <div key={i} className="text-sm font-semibold text-slate-300 dark:text-slate-700 tracking-wide">{name}</div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
