import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Menu, X } from 'lucide-react'
import ThemeToggle from '../common/ThemeToggle'

export default function Navbar() {
  const [scrolled, setScrolled] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)

  useEffect(() => {
    const handler = () => setScrolled(window.scrollY > 20)
    window.addEventListener('scroll', handler)
    return () => window.removeEventListener('scroll', handler)
  }, [])

  return (
    <nav className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
      scrolled
        ? 'bg-white/80 dark:bg-slate-950/80 backdrop-blur-xl border-b border-slate-200 dark:border-white/10 shadow-sm dark:shadow-none'
        : 'bg-transparent'
    }`}>
      <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-teal-500 to-cyan-500 flex items-center justify-center">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <path d="M8 16 L12 20 L20 8"/>
            </svg>
          </div>
          <span className="text-lg font-bold text-slate-900 dark:text-white">Claim Analytics</span>
        </Link>

        <div className="hidden md:flex items-center gap-8">
          <a href="#features" className="text-sm text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors">Features</a>
          <a href="#how-it-works" className="text-sm text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors">How It Works</a>
          <a href="#case-studies" className="text-sm text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors">Case Studies</a>
          <a href="#pricing" className="text-sm text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors">Pricing</a>
          <ThemeToggle />
          <Link to="/login" className="text-sm text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition-colors">Log In</Link>
          <Link to="/signup" className="px-4 py-2 rounded-lg bg-gradient-to-r from-teal-600 to-cyan-600 text-white text-sm font-medium hover:from-teal-500 hover:to-cyan-500 transition-all shadow-lg shadow-teal-500/25">
            Get Started
          </Link>
        </div>

        <button className="md:hidden text-slate-900 dark:text-white" onClick={() => setMobileOpen(!mobileOpen)}>
          {mobileOpen ? <X size={24} /> : <Menu size={24} />}
        </button>
      </div>

      {mobileOpen && (
        <div className="md:hidden bg-white/95 dark:bg-slate-900/95 backdrop-blur-xl border-b border-slate-200 dark:border-white/10 px-6 py-4 space-y-3">
          <a href="#features" className="block text-sm text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white">Features</a>
          <a href="#how-it-works" className="block text-sm text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white">How It Works</a>
          <a href="#case-studies" className="block text-sm text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white">Case Studies</a>
          <a href="#pricing" className="block text-sm text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white">Pricing</a>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <span className="text-xs text-slate-400">Toggle theme</span>
          </div>
          <Link to="/login" className="block text-sm text-slate-600 dark:text-slate-300">Log In</Link>
          <Link to="/signup" className="block px-4 py-2 rounded-lg bg-gradient-to-r from-teal-600 to-cyan-600 text-white text-sm font-medium text-center">Get Started</Link>
        </div>
      )}
    </nav>
  )
}
