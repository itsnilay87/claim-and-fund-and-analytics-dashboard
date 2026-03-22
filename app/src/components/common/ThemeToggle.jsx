import { Sun, Moon } from 'lucide-react'
import { useThemeStore } from '../../store/themeStore'

export default function ThemeToggle({ className = '' }) {
  const { theme, toggleTheme } = useThemeStore()

  return (
    <button
      onClick={toggleTheme}
      className={`relative p-2 rounded-lg transition-all ${
        theme === 'dark'
          ? 'text-slate-400 hover:text-white hover:bg-white/5'
          : 'text-slate-500 hover:text-slate-900 hover:bg-slate-100'
      } ${className}`}
      aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
    >
      {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
    </button>
  )
}
