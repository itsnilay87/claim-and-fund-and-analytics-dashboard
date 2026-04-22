import { useState, useRef, useEffect } from 'react'
import { useAuthStore } from '../../store/authStore'
import { useNavigate, useParams } from 'react-router-dom'
import { Bell, Search, ArrowLeft, Settings, LogOut } from 'lucide-react'
import ThemeToggle from '../common/ThemeToggle'

export default function TopBar() {
  const user = useAuthStore((s) => s.user)
  const logout = useAuthStore((s) => s.logout)
  const navigate = useNavigate()
  const { wsId } = useParams()
  const [showMenu, setShowMenu] = useState(false)
  const menuRef = useRef(null)

  useEffect(() => {
    function handleClickOutside(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setShowMenu(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleLogout = async () => {
    setShowMenu(false)
    await logout()
    navigate('/')
  }

  const displayName = user?.full_name || user?.name || 'User'
  const initials = displayName.charAt(0).toUpperCase()

  return (
    <header className="h-16 flex items-center justify-between px-6 border-b border-slate-200 dark:border-white/5 bg-white/50 dark:bg-slate-950/50 backdrop-blur-sm">
      <div className="flex items-center gap-3 flex-1">
        {wsId && (
          <button
            onClick={() => navigate('/workspaces')}
            className="flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-200 dark:border-white/10 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/5 transition-all whitespace-nowrap"
            title="Back to workspace list"
          >
            <ArrowLeft size={14} /> Workspaces
          </button>
        )}
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

        {/* Clickable user avatar with dropdown */}
        <div className="relative pl-4 border-l border-slate-200 dark:border-white/10" ref={menuRef}>
          <button
            onClick={() => setShowMenu(!showMenu)}
            className="flex items-center gap-2.5 hover:opacity-80 transition-opacity"
          >
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-teal-500 to-cyan-500 flex items-center justify-center text-white text-xs font-bold select-none">
              {initials}
            </div>
            <div className="hidden md:block text-left">
              <div className="text-sm font-medium text-slate-900 dark:text-white leading-tight">{displayName}</div>
              <div className="text-xs text-slate-500 capitalize">{user?.role || 'user'}</div>
            </div>
          </button>

          {showMenu && (
            <div className="absolute right-0 mt-3 w-52 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-2xl py-1.5 z-50">
              <div className="px-4 py-2.5 border-b border-slate-100 dark:border-slate-800">
                <p className="text-xs font-semibold text-slate-900 dark:text-white truncate">{displayName}</p>
                <p className="text-xs text-slate-500 truncate">{user?.email}</p>
              </div>
              <button
                onClick={() => { setShowMenu(false); navigate('/account'); }}
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
    </header>
  )
}

