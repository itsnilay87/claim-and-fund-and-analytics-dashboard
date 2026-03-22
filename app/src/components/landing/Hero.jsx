import { useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, BarChart3, Shield, TrendingUp, Zap } from 'lucide-react'

function AnimatedCounter({ end, suffix = '', prefix = '' }) {
  const ref = useRef(null)
  useEffect(() => {
    let frame
    const duration = 2000
    const startTime = Date.now()
    function animate() {
      const elapsed = Date.now() - startTime
      const progress = Math.min(elapsed / duration, 1)
      const eased = 1 - Math.pow(1 - progress, 3)
      const current = Math.floor(end * eased)
      if (ref.current) ref.current.textContent = prefix + current.toLocaleString() + suffix
      if (progress < 1) frame = requestAnimationFrame(animate)
    }
    frame = requestAnimationFrame(animate)
    return () => cancelAnimationFrame(frame)
  }, [end, suffix, prefix])
  return <span ref={ref}>{prefix}0{suffix}</span>
}

export default function Hero() {
  return (
    <section className="relative min-h-screen flex items-center justify-center overflow-hidden">
      <div className="absolute inset-0 bg-grid" />
      <div className="absolute top-1/4 -left-32 w-96 h-96 rounded-full bg-teal-600/20 blur-[128px]" />
      <div className="absolute bottom-1/4 -right-32 w-96 h-96 rounded-full bg-cyan-600/15 blur-[128px]" />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full bg-teal-500/5 blur-[200px]" />

      <div className="relative z-10 max-w-6xl mx-auto px-6 pt-24 pb-16 text-center">
        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-teal-500/10 dark:bg-white/5 border border-teal-500/20 dark:border-white/10 mb-8">
          <span className="w-2 h-2 rounded-full bg-teal-400 animate-pulse" />
          <span className="text-sm text-teal-700 dark:text-slate-300">Powered by 10,000-path Monte Carlo Simulation</span>
        </div>

        <h1 className="text-5xl md:text-7xl font-extrabold tracking-tight mb-6">
          <span className="text-slate-900 dark:text-white">Quantitative</span><br />
          <span className="gradient-text">Litigation Intelligence</span>
        </h1>

        <p className="text-lg md:text-xl text-slate-500 dark:text-slate-400 max-w-2xl mx-auto mb-6 leading-relaxed">
          Transform arbitration claims into data-driven investment decisions.
          Stochastic pricing, probability trees, and portfolio optimization
          for litigation finance professionals.
        </p>

        {/* Value props */}
        <div className="flex flex-wrap justify-center gap-4 mb-10">
          {['10K+ Monte Carlo Paths', 'SIAC & Domestic Jurisdictions', 'Real-Time VaR & CVaR', 'Institutional-Grade Reports'].map((text, i) => (
            <div key={i} className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-100 dark:bg-white/5 text-xs text-slate-600 dark:text-slate-400">
              <Zap size={10} className="text-teal-500" />
              {text}
            </div>
          ))}
        </div>

        <div className="flex flex-col sm:flex-row gap-4 justify-center mb-16">
          <Link to="/signup" className="inline-flex items-center justify-center gap-2 px-8 py-3.5 rounded-xl bg-gradient-to-r from-teal-600 to-cyan-600 text-white font-semibold text-lg hover:from-teal-500 hover:to-cyan-500 transition-all shadow-2xl shadow-teal-500/25 group">
            Start Analyzing
            <ArrowRight size={20} className="group-hover:translate-x-1 transition-transform" />
          </Link>
          <Link to="/login" className="inline-flex items-center justify-center gap-2 px-8 py-3.5 rounded-xl bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-900 dark:text-white font-semibold text-lg hover:bg-slate-200 dark:hover:bg-white/10 transition-all">
            Sign In
          </Link>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-6 max-w-3xl mx-auto">
          {[
            { icon: BarChart3, value: 10000, suffix: '+', label: 'Monte Carlo Paths' },
            { icon: Shield, value: 6, suffix: '', label: 'Claim Pipelines' },
            { icon: TrendingUp, value: 156, suffix: '', label: 'Pricing Combos' },
            { icon: BarChart3, value: 5144, suffix: ' Cr', prefix: '\u20B9', label: 'Total SOC Analyzed' },
          ].map((stat, i) => (
            <div key={i} className="glass-card p-4 text-center glow-teal">
              <stat.icon size={20} className="mx-auto mb-2 text-teal-500 dark:text-teal-400" />
              <div className="text-2xl font-bold text-slate-900 dark:text-white">
                <AnimatedCounter end={stat.value} suffix={stat.suffix} prefix={stat.prefix || ''} />
              </div>
              <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">{stat.label}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
