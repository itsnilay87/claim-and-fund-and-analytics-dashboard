import { useNavigate, useLocation } from 'react-router-dom'
import { Scale, BarChart3 } from 'lucide-react'

const products = [
  { key: 'claims', label: 'Claim Analytics', icon: Scale, path: '/workspaces', gradient: 'from-teal-500 to-cyan-500' },
  { key: 'fund', label: 'Fund Analytics', icon: BarChart3, path: '/fund-analytics', gradient: 'from-blue-500 to-purple-500' },
]

export default function ProductSwitcher({ collapsed = false }) {
  const navigate = useNavigate()
  const location = useLocation()

  const isFund = location.pathname.startsWith('/fund-analytics')
  const otherProduct = isFund ? products[0] : products[1]

  return (
    <button
      onClick={() => navigate(otherProduct.path)}
      className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-50 dark:hover:bg-white/5 transition-all w-full"
      title={`Switch to ${otherProduct.label}`}
    >
      <div className={`w-5 h-5 rounded bg-gradient-to-br ${otherProduct.gradient} flex items-center justify-center flex-shrink-0`}>
        <otherProduct.icon size={12} className="text-white" />
      </div>
      {!collapsed && <span>{otherProduct.label}</span>}
    </button>
  )
}
