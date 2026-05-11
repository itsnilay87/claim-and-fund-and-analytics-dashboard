import { NavLink, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../../store/authStore'
import { BarChart3, Settings2, Play, History, FlaskConical, FileText, HelpCircle, LogOut, ChevronLeft, ChevronRight } from 'lucide-react'
import { useState } from 'react'
import ProductSwitcher from './ProductSwitcher'

const navItems = [
  { to: '/fund-analytics', icon: BarChart3, label: 'Dashboard', end: true },
  { to: '/fund-analytics/parameters', icon: Settings2, label: 'Parameters' },
  { to: '/fund-analytics/simulate', icon: Play, label: 'Simulate' },
  { to: '/fund-analytics/history', icon: History, label: 'History' },
  { to: '/fund-analytics/case/new', icon: FlaskConical, label: 'Case Simulation' },
  { to: '/fund-analytics/case/history', icon: FileText, label: 'Case History' },
]

export default function FundSidebar() {
  const [collapsed, setCollapsed] = useState(false)
  const logout = useAuthStore((s) => s.logout)
  const navigate = useNavigate()

  const handleLogout = async () => { await logout(); navigate('/') }

  return (
    <aside className={`flex flex-col bg-white dark:bg-slate-900/50 border-r border-slate-200 dark:border-white/5 transition-all duration-300 ${collapsed ? 'w-16' : 'w-60'}`}>
      {/* Logo */}
      <div className="h-16 flex items-center px-4 border-b border-slate-200 dark:border-white/5">
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-purple-500 flex items-center justify-center flex-shrink-0">
          <BarChart3 size={16} className="text-white" />
        </div>
        {!collapsed && <span className="ml-3 text-sm font-bold text-slate-900 dark:text-white whitespace-nowrap">Fund Analytics</span>}
      </div>

      {/* Product switcher */}
      <div className="px-2 pt-4 pb-2">
        <ProductSwitcher collapsed={collapsed} />
      </div>

      {/* Nav items */}
      <nav className="flex-1 py-4 space-y-1 px-2">
        {navItems.map((item) => (
          <NavLink key={item.to} to={item.to} end={item.end}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all ${
                isActive
                  ? 'bg-blue-50 dark:bg-blue-600/20 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-500/20'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-50 dark:hover:bg-white/5'
              }`
            }
          >
            <item.icon size={18} className="flex-shrink-0" />
            {!collapsed && <span>{item.label}</span>}
          </NavLink>
        ))}
      </nav>

      {/* Bottom */}
      <div className="p-2 border-t border-slate-200 dark:border-white/5 space-y-1">
        <button className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-50 dark:hover:bg-white/5 w-full transition-all">
          <HelpCircle size={18} className="flex-shrink-0" />
          {!collapsed && <span>Help & Docs</span>}
        </button>
        <button onClick={handleLogout} className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-red-500 dark:text-red-400 hover:text-red-600 dark:hover:text-red-300 hover:bg-red-50 dark:hover:bg-red-500/10 w-full transition-all">
          <LogOut size={18} className="flex-shrink-0" />
          {!collapsed && <span>Sign Out</span>}
        </button>
        <button onClick={() => setCollapsed(!collapsed)} className="flex items-center justify-center py-2 rounded-lg text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 w-full transition-all">
          {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
        </button>
      </div>
    </aside>
  )
}
