/**
 * @module Hub
 * @description Post-login landing page. Lets the user choose between the
 * two product surfaces (Claim Analytics, Fund Analytics) and shows a few
 * lightweight visuals so the page feels alive.
 *
 * Route: /hub
 */
import { useEffect, useMemo, useState, useRef } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  Scale,
  BarChart3,
  ArrowRight,
  Briefcase,
  TrendingUp,
  Activity,
  LogOut,
  Settings,
  Sparkles,
} from 'lucide-react'
import { useAuthStore } from '../store/authStore'
import { useWorkspaceStore } from '../store/workspaceStore'
import { useFundStore } from '../store/fundStore'
import ThemeToggle from '../components/common/ThemeToggle'

// ── Small SVG sparkline (no extra deps) ────────────────────────
function Sparkline({ data, stroke = '#22d3ee', fill = 'rgba(34,211,238,0.18)' }) {
  const w = 220
  const h = 60
  if (!data || data.length === 0) return <div style={{ width: w, height: h }} />
  const max = Math.max(...data, 1)
  const min = Math.min(...data, 0)
  const range = max - min || 1
  const step = w / Math.max(data.length - 1, 1)
  const points = data.map((v, i) => {
    const x = i * step
    const y = h - ((v - min) / range) * h
    return [x, y]
  })
  const path = points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
  const area = `${path} L${w},${h} L0,${h} Z`
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} preserveAspectRatio="none" className="overflow-visible">
      <path d={area} fill={fill} />
      <path d={path} fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

// Pseudo-random but stable series so visuals feel populated even before any data
function syntheticSeries(seed, len = 16) {
  const out = []
  let v = 50 + (seed % 30)
  for (let i = 0; i < len; i++) {
    v += Math.sin(i * 0.7 + seed) * 6 + ((i * (seed + 3)) % 7) - 3
    out.push(Math.max(5, v))
  }
  return out
}

export default function Hub() {
  const user = useAuthStore((s) => s.user)
  const logout = useAuthStore((s) => s.logout)
  const navigate = useNavigate()
  const workspaces = useWorkspaceStore((s) => s.workspaces)
  const fetchWorkspaces = useWorkspaceStore((s) => s.fetchWorkspaces)
  const simulations = useFundStore((s) => s.simulations)
  const fetchSimulations = useFundStore((s) => s.fetchSimulations)

  const [showMenu, setShowMenu] = useState(false)
  const menuRef = useRef(null)

  useEffect(() => {
    try { fetchWorkspaces?.()?.catch?.(() => {}) } catch { /* noop */ }
  }, [fetchWorkspaces])
  useEffect(() => {
    try { fetchSimulations?.('limit=10')?.catch?.(() => {}) } catch { /* noop */ }
  }, [fetchSimulations])

  useEffect(() => {
    function handler(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) setShowMenu(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const claimSeries = useMemo(() => syntheticSeries(((workspaces && workspaces.length) || 1) * 7 + 11), [workspaces])
  const fundSeries = useMemo(() => syntheticSeries(((simulations && simulations.length) || 1) * 5 + 3), [simulations])

  const safeSims = Array.isArray(simulations) ? simulations : []
  const completedSims = safeSims.filter((s) => s && s.status === 'completed').length
  const runningSims = safeSims.filter((s) => s && (s.status === 'running' || s.status === 'queued')).length

  const displayName = (user && (user.full_name || user.name || user.email)) || 'there'
  const firstName = String(displayName).split(' ')[0] || 'there'
  const greeting = greetingFor(new Date())

  const handleLogout = async () => {
    setShowMenu(false)
    try { await logout() } catch { /* noop */ }
    navigate('/')
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 relative overflow-hidden">
      {/* Decorative background glows */}
      <div aria-hidden className="pointer-events-none absolute -top-32 -left-32 w-[420px] h-[420px] rounded-full bg-teal-500/15 blur-[110px]" />
      <div aria-hidden className="pointer-events-none absolute top-1/2 -right-40 w-[460px] h-[460px] rounded-full bg-blue-500/15 blur-[120px]" />
      <div aria-hidden className="pointer-events-none absolute bottom-0 left-1/3 w-[360px] h-[360px] rounded-full bg-purple-500/10 blur-[110px]" />

      {/* Top bar */}
      <header className="relative z-10 border-b border-slate-200 dark:border-white/5 bg-white/60 dark:bg-slate-950/60 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-indigo-500 via-cyan-500 to-teal-500 flex items-center justify-center">
              <Sparkles className="w-4 h-4 text-white" />
            </div>
            <div>
              <div className="text-sm font-bold text-slate-900 dark:text-white leading-tight">Analytics Platform</div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400">Claim & Fund Insights</div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <ThemeToggle />
            <button
              onClick={() => navigate('/account')}
              className="hidden sm:flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-200 dark:border-white/10 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/5 transition-colors"
            >
              <Settings size={14} /> Account
            </button>
            <div className="relative" ref={menuRef}>
              <button
                onClick={() => setShowMenu((v) => !v)}
                className="flex items-center gap-2 hover:opacity-80 transition-opacity"
              >
                <div className="w-9 h-9 rounded-full bg-gradient-to-br from-teal-500 to-cyan-500 flex items-center justify-center text-white text-xs font-bold">
                  {(displayName.charAt(0) || 'U').toUpperCase()}
                </div>
                <div className="hidden md:block text-left">
                  <div className="text-sm font-medium text-slate-900 dark:text-white leading-tight">{displayName}</div>
                  <div className="text-xs text-slate-500 capitalize">{user?.role || 'member'}</div>
                </div>
              </button>
              {showMenu && (
                <div className="absolute right-0 mt-3 w-52 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-2xl py-1.5 z-50">
                  <button
                    onClick={() => { setShowMenu(false); navigate('/account') }}
                    className="w-full flex items-center gap-2.5 px-4 py-2 text-sm text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                  >
                    <Settings size={14} /> Account Settings
                  </button>
                  <button
                    onClick={handleLogout}
                    className="w-full flex items-center gap-2.5 px-4 py-2 text-sm text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors"
                  >
                    <LogOut size={14} /> Sign Out
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="relative z-10 max-w-7xl mx-auto px-6 py-12">
        {/* Hero */}
        <section className="mb-10">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium bg-white/60 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-300">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            All systems operational
          </div>
          <h1 className="mt-4 text-3xl md:text-4xl font-bold text-slate-900 dark:text-white">
            {greeting}, {firstName}
          </h1>
          <p className="mt-2 text-slate-500 dark:text-slate-400 max-w-2xl">
            Pick a workspace to continue. You can switch between Claim Analytics and Fund Analytics any time
            from the sidebar — each product runs its own simulations and keeps its own history.
          </p>
        </section>

        {/* Mini stats row */}
        <section className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-10">
          <StatTile icon={Briefcase} label="Workspaces" value={Array.isArray(workspaces) ? workspaces.length : 0} color="from-teal-500 to-cyan-500" />
          <StatTile icon={Activity} label="Fund Simulations" value={safeSims.length} color="from-blue-500 to-indigo-500" />
          <StatTile icon={TrendingUp} label="Completed" value={completedSims} color="from-emerald-500 to-green-500" />
          <StatTile icon={Sparkles} label="Running" value={runningSims} color="from-amber-500 to-orange-500" />
        </section>

        {/* Two product cards */}
        <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <ProductCard
            to="/workspaces"
            title="Claim Analytics"
            subtitle="Build claims, run portfolio simulations, study outcomes."
            Icon={Scale}
            accent="from-teal-500 via-cyan-500 to-emerald-500"
            sparkColor={{ stroke: '#14b8a6', fill: 'rgba(20,184,166,0.18)' }}
            data={claimSeries}
            chips={[
              { k: 'Workspaces', v: Array.isArray(workspaces) ? workspaces.length : 0 },
              { k: 'Engine', v: 'Monte Carlo' },
            ]}
            cta="Open Claim Analytics"
          />
          <ProductCard
            to="/fund-analytics"
            title="Fund Analytics"
            subtitle="Fund-level Monte Carlo, J-curves, NAV, IRR distributions."
            Icon={BarChart3}
            accent="from-blue-500 via-indigo-500 to-purple-500"
            sparkColor={{ stroke: '#6366f1', fill: 'rgba(99,102,241,0.20)' }}
            data={fundSeries}
            chips={[
              { k: 'Simulations', v: safeSims.length },
              { k: 'Sidecar', v: 'Online' },
            ]}
            cta="Open Fund Analytics"
          />
        </section>

        {/* Footer hint */}
        <p className="mt-10 text-xs text-slate-400 dark:text-slate-500 text-center">
          Tip: each product has a sidebar switcher to jump back here or into the other product.
        </p>
      </main>
    </div>
  )
}

function greetingFor(date) {
  const h = date.getHours()
  if (h < 5) return 'Working late'
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  if (h < 21) return 'Good evening'
  return 'Good night'
}

function StatTile({ icon: Icon, label, value, color }) {
  return (
    <div className="rounded-xl border border-slate-200 dark:border-white/5 bg-white/70 dark:bg-slate-900/50 backdrop-blur-sm p-4">
      <div className="flex items-center gap-3">
        <div className={`w-9 h-9 rounded-lg bg-gradient-to-br ${color} flex items-center justify-center`}>
          <Icon size={16} className="text-white" />
        </div>
        <div>
          <div className="text-xl font-bold text-slate-900 dark:text-white leading-tight">{value}</div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400">{label}</div>
        </div>
      </div>
    </div>
  )
}

function ProductCard({ to, title, subtitle, Icon, accent, sparkColor, data, chips, cta }) {
  return (
    <Link
      to={to}
      className="group relative overflow-hidden rounded-2xl border border-slate-200 dark:border-white/10 bg-white/80 dark:bg-slate-900/60 backdrop-blur-sm p-6 hover:border-slate-300 dark:hover:border-white/20 transition-all"
    >
      {/* Accent glow */}
      <div aria-hidden className={`absolute -top-16 -right-16 w-56 h-56 rounded-full bg-gradient-to-br ${accent} opacity-20 blur-3xl group-hover:opacity-30 transition-opacity`} />

      <div className="relative flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${accent} flex items-center justify-center shadow-lg`}>
            <Icon size={22} className="text-white" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-slate-900 dark:text-white">{title}</h3>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5 max-w-md">{subtitle}</p>
          </div>
        </div>
        <ArrowRight className="text-slate-400 group-hover:text-slate-600 dark:group-hover:text-white group-hover:translate-x-1 transition-all" size={20} />
      </div>

      <div className="relative mt-6">
        <Sparkline data={data} stroke={sparkColor.stroke} fill={sparkColor.fill} />
      </div>

      <div className="relative mt-5 flex items-center justify-between">
        <div className="flex flex-wrap gap-2">
          {chips.map((c) => (
            <span
              key={c.k}
              className="text-[11px] px-2.5 py-1 rounded-full bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-300"
            >
              <span className="text-slate-400 dark:text-slate-500 mr-1">{c.k}</span>
              <span className="font-semibold text-slate-700 dark:text-slate-100">{c.v}</span>
            </span>
          ))}
        </div>
        <span className={`text-xs font-semibold bg-gradient-to-r ${accent} bg-clip-text text-transparent`}>
          {cta} →
        </span>
      </div>
    </Link>
  )
}
