import { Link } from 'react-router-dom'

export default function Footer() {
  return (
    <footer className="border-t border-slate-200 dark:border-white/10 py-16 bg-slate-50 dark:bg-slate-950/80">
      <div className="max-w-7xl mx-auto px-6">
        <div className="grid md:grid-cols-5 gap-8 mb-12">
          <div className="md:col-span-2">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-teal-500 to-cyan-500 flex items-center justify-center">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M8 16 L12 20 L20 8"/>
                </svg>
              </div>
              <span className="text-lg font-bold text-slate-900 dark:text-white">Claim Analytics</span>
            </div>
            <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed mb-4 max-w-xs">
              Quantitative litigation intelligence platform transforming arbitration claims
              into data-driven investment decisions for institutional funders.
            </p>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-teal-500 animate-pulse" />
              <span className="text-xs text-teal-600 dark:text-teal-400">Platform Active — Beta</span>
            </div>
          </div>
          <div>
            <h4 className="text-sm font-semibold text-slate-900 dark:text-white mb-4">Product</h4>
            <ul className="space-y-2.5 text-sm text-slate-500 dark:text-slate-400">
              <li><a href="#features" className="hover:text-teal-600 dark:hover:text-teal-400 transition-colors">Features</a></li>
              <li><a href="#pricing" className="hover:text-teal-600 dark:hover:text-teal-400 transition-colors">Pricing</a></li>
              <li><a href="#case-studies" className="hover:text-teal-600 dark:hover:text-teal-400 transition-colors">Case Studies</a></li>
              <li><a href="#" className="hover:text-teal-600 dark:hover:text-teal-400 transition-colors">Documentation</a></li>
              <li><a href="#" className="hover:text-teal-600 dark:hover:text-teal-400 transition-colors">API Reference</a></li>
            </ul>
          </div>
          <div>
            <h4 className="text-sm font-semibold text-slate-900 dark:text-white mb-4">Company</h4>
            <ul className="space-y-2.5 text-sm text-slate-500 dark:text-slate-400">
              <li><a href="#" className="hover:text-teal-600 dark:hover:text-teal-400 transition-colors">About Us</a></li>
              <li><a href="#" className="hover:text-teal-600 dark:hover:text-teal-400 transition-colors">Methodology</a></li>
              <li><a href="#" className="hover:text-teal-600 dark:hover:text-teal-400 transition-colors">Research</a></li>
              <li><a href="#" className="hover:text-teal-600 dark:hover:text-teal-400 transition-colors">Careers</a></li>
              <li><a href="#" className="hover:text-teal-600 dark:hover:text-teal-400 transition-colors">Contact</a></li>
            </ul>
          </div>
          <div>
            <h4 className="text-sm font-semibold text-slate-900 dark:text-white mb-4">Legal</h4>
            <ul className="space-y-2.5 text-sm text-slate-500 dark:text-slate-400">
              <li><a href="#" className="hover:text-teal-600 dark:hover:text-teal-400 transition-colors">Privacy Policy</a></li>
              <li><a href="#" className="hover:text-teal-600 dark:hover:text-teal-400 transition-colors">Terms of Service</a></li>
              <li><a href="#" className="hover:text-teal-600 dark:hover:text-teal-400 transition-colors">Disclaimer</a></li>
              <li><a href="#" className="hover:text-teal-600 dark:hover:text-teal-400 transition-colors">Cookie Policy</a></li>
            </ul>
          </div>
        </div>
        <div className="border-t border-slate-200 dark:border-white/10 pt-8 flex flex-col md:flex-row justify-between items-center gap-4">
          <p className="text-sm text-slate-400 dark:text-slate-500">&copy; 2026 Claim Analytics. All rights reserved.</p>
          <p className="text-xs text-slate-400 dark:text-slate-600">Prototype — Not for distribution</p>
        </div>
      </div>
    </footer>
  )
}
