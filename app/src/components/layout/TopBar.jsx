import { useAuthStore } from '../../store/authStore'
import { Bell, Search } from 'lucide-react'
import ThemeToggle from '../common/ThemeToggle'

export default function TopBar() {
  const user = useAuthStore((s) => s.user)

  return (
    <header className="h-16 flex items-center justify-between px-6 border-b border-slate-200 dark:border-white/5 bg-white/50 dark:bg-slate-950/50 backdrop-blur-sm">
      <div className="flex items-center gap-3 flex-1">
        <div className="relative max-w-md flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500" />
          <input type="text" placeholder="Search claims, portfolios..."
            className="w-full pl-10 pr-4 py-2 rounded-lg bg-slate-100 dark:bg-slate-800/50 border border-slate-200 dark:border-white/5 text-sm text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:border-teal-500/50" />
        </div>
      </div>

      <div className="flex items-center gap-4">
        <ThemeToggle />
        <button className="relative p-2 rounded-lg text-slate-400 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/5 transition-all">
          <Bell size={18} />
          <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-teal-500" />
        </button>

        <div className="flex items-center gap-3 pl-4 border-l border-slate-200 dark:border-white/10">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-teal-500 to-cyan-500 flex items-center justify-center text-white text-xs font-bold">
            {user?.name?.charAt(0) || 'U'}
          </div>
          <div className="hidden md:block">
            <div className="text-sm font-medium text-slate-900 dark:text-white">{user?.name || 'User'}</div>
            <div className="text-xs text-slate-500">{user?.role || 'Analyst'}</div>
          </div>
        </div>
      </div>
    </header>
  )
}
