import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../store/authStore'
import { Eye, EyeOff, ArrowRight } from 'lucide-react'

export default function Login() {
  const navigate = useNavigate()
  const login = useAuthStore((s) => s.login)
  const [form, setForm] = useState({ email: '', password: '' })
  const [showPw, setShowPw] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    // Prototype: accept demo credentials or any non-empty input
    await new Promise((r) => setTimeout(r, 800))

    if (form.email === 'demo@claimanalytics.com' && form.password === 'demo123') {
      login(form.email, form.password)
      navigate('/workspaces')
    } else if (form.email && form.password) {
      login(form.email, form.password)
      navigate('/workspaces')
    } else {
      setError('Please enter email and password')
    }
    setLoading(false)
  }

  const fillDemo = () => {
    setForm({ email: 'demo@claimanalytics.com', password: 'demo123' })
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-6 bg-grid relative">
      <div className="absolute top-1/3 left-1/4 w-72 h-72 rounded-full bg-teal-600/10 blur-[100px]" />
      <div className="absolute bottom-1/3 right-1/4 w-72 h-72 rounded-full bg-cyan-600/10 blur-[100px]" />

      <div className="relative w-full max-w-md">
        <div className="text-center mb-8">
          <Link to="/" className="inline-flex items-center gap-2 mb-6">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-teal-500 to-cyan-500 flex items-center justify-center">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <path d="M8 16 L12 20 L20 8"/>
              </svg>
            </div>
            <span className="text-xl font-bold text-slate-900 dark:text-white">Claim Analytics</span>
          </Link>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Welcome back</h1>
          <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">Sign in to your account</p>
        </div>

        <div className="glass-card p-8">
          <form onSubmit={handleSubmit} className="space-y-5">
            {error && (
              <div className="text-sm text-red-500 bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-2">{error}</div>
            )}

            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Email</label>
              <input type="email" value={form.email} onChange={(e) => setForm({...form, email: e.target.value})}
                className="w-full px-4 py-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-white/10 text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 text-sm"
                placeholder="you@company.com" />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Password</label>
              <div className="relative">
                <input type={showPw ? 'text' : 'password'} value={form.password}
                  onChange={(e) => setForm({...form, password: e.target.value})}
                  className="w-full px-4 py-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-white/10 text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 text-sm pr-10"
                  placeholder="Enter your password" />
                <button type="button" onClick={() => setShowPw(!showPw)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300">
                  {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between text-sm">
              <label className="flex items-center gap-2 text-slate-500 dark:text-slate-400">
                <input type="checkbox" className="rounded border-slate-300 dark:border-white/20 bg-white dark:bg-slate-800" />
                Remember me
              </label>
              <a href="#" className="text-teal-600 dark:text-teal-400 hover:text-teal-500 dark:hover:text-teal-300">Forgot password?</a>
            </div>

            <button type="submit" disabled={loading}
              className="w-full py-3 rounded-lg bg-gradient-to-r from-teal-600 to-cyan-600 text-white font-semibold hover:from-teal-500 hover:to-cyan-500 transition-all shadow-lg shadow-teal-500/25 flex items-center justify-center gap-2 disabled:opacity-60">
              {loading ? <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <>Sign In <ArrowRight size={16} /></>}
            </button>
          </form>

          <div className="mt-6 text-center">
            <button onClick={fillDemo} className="text-xs text-teal-600 dark:text-cyan-400 hover:text-teal-500 dark:hover:text-cyan-300 underline underline-offset-2">
              Use demo account (demo@claimanalytics.com / demo123)
            </button>
          </div>

          <div className="relative my-6">
            <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-slate-200 dark:border-white/10" /></div>
            <div className="relative flex justify-center"><span className="bg-white dark:bg-slate-900 px-3 text-xs text-slate-500">or continue with</span></div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <button className="flex items-center justify-center gap-2 py-2.5 rounded-lg bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/10 transition-all">
              <svg width="16" height="16" viewBox="0 0 24 24"><path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/><path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
              Google
            </button>
            <button className="flex items-center justify-center gap-2 py-2.5 rounded-lg bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/10 transition-all">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
              Twitter
            </button>
          </div>
        </div>

        <p className="text-center mt-6 text-sm text-slate-500">
          Don't have an account? <Link to="/signup" className="text-teal-600 dark:text-teal-400 hover:text-teal-500 dark:hover:text-teal-300">Sign up</Link>
        </p>
      </div>
    </div>
  )
}
