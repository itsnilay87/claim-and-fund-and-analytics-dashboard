import { useState } from 'react'
import { useAuthStore } from '../store/authStore'
import { User, Mail, Building2, Shield, Camera, Check, Eye, EyeOff, AlertCircle, KeyRound } from 'lucide-react'

export default function Profile() {
  const user = useAuthStore((s) => s.user)
  const updateUser = useAuthStore((s) => s.updateUser)
  const changePassword = useAuthStore((s) => s.changePassword)

  // Profile form
  const [form, setForm] = useState({
    name: user?.full_name || user?.name || '',
    company: user?.company || '',
  })
  const [profileSaved, setProfileSaved] = useState(false)
  const [profileError, setProfileError] = useState('')

  // Password form
  const [pwForm, setPwForm] = useState({ current: '', next: '', confirm: '' })
  const [showCurrent, setShowCurrent] = useState(false)
  const [showNext, setShowNext] = useState(false)
  const [pwLoading, setPwLoading] = useState(false)
  const [pwSuccess, setPwSuccess] = useState(false)
  const [pwError, setPwError] = useState('')

  const handleProfileSave = async (e) => {
    e.preventDefault()
    setProfileError('')
    try {
      await updateUser({ full_name: form.name, company: form.company })
      setProfileSaved(true)
      setTimeout(() => setProfileSaved(false), 2500)
    } catch (err) {
      setProfileError(err.message || 'Failed to save changes')
    }
  }

  const handlePasswordChange = async (e) => {
    e.preventDefault()
    setPwError('')
    setPwSuccess(false)

    if (pwForm.next.length < 8) {
      return setPwError('New password must be at least 8 characters')
    }
    if (pwForm.next !== pwForm.confirm) {
      return setPwError('New passwords do not match')
    }

    setPwLoading(true)
    try {
      await changePassword(pwForm.current, pwForm.next)
      setPwSuccess(true)
      setPwForm({ current: '', next: '', confirm: '' })
      setTimeout(() => setPwSuccess(false), 3000)
    } catch (err) {
      setPwError(err.message || 'Failed to update password')
    } finally {
      setPwLoading(false)
    }
  }

  const inputClass = 'w-full px-4 py-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-white/10 text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-500'
  const iconInputClass = 'w-full pl-9 pr-4 py-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-white/10 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-500'

  return (
    <div className="max-w-2xl space-y-6 animate-fade-in-up">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Account Settings</h1>
        <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">Manage your profile and security settings</p>
      </div>

      {/* Avatar card */}
      <div className="glass-card p-6">
        <div className="flex items-center gap-5">
          <div className="relative">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-500 to-cyan-500 flex items-center justify-center text-white text-2xl font-bold select-none">
              {(user?.full_name || user?.name || 'U').charAt(0).toUpperCase()}
            </div>
            <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-white/10 flex items-center justify-center text-slate-400">
              <Camera size={11} />
            </div>
          </div>
          <div>
            <div className="text-base font-semibold text-slate-900 dark:text-white">{user?.full_name || user?.name}</div>
            <div className="text-sm text-slate-500 dark:text-slate-400">{user?.email}</div>
            <div className="flex items-center gap-1.5 mt-1">
              <Shield size={11} className="text-indigo-500" />
              <span className="text-xs text-indigo-500 capitalize">{user?.role || 'user'}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Profile information */}
      <form onSubmit={handleProfileSave} className="glass-card p-6 space-y-5">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-2">
          <User size={15} className="text-slate-400" /> Personal Information
        </h3>

        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1.5">Full Name</label>
            <div className="relative">
              <User size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className={iconInputClass}
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1.5">Email</label>
            <div className="relative">
              <Mail size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="email"
                value={user?.email || ''}
                disabled
                className="w-full pl-9 pr-4 py-2.5 rounded-lg bg-slate-100 dark:bg-slate-800/30 border border-slate-200 dark:border-white/5 text-slate-400 dark:text-slate-500 text-sm cursor-not-allowed"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1.5">Company</label>
            <div className="relative">
              <Building2 size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={form.company}
                onChange={(e) => setForm({ ...form, company: e.target.value })}
                placeholder="Your organisation"
                className={iconInputClass}
              />
            </div>
          </div>
        </div>

        {profileError && (
          <p className="flex items-center gap-2 text-sm text-red-400">
            <AlertCircle size={14} /> {profileError}
          </p>
        )}

        <div className="flex items-center gap-3 pt-1">
          <button
            type="submit"
            className="px-5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-sm transition-colors flex items-center gap-2"
          >
            {profileSaved ? <><Check size={14} /> Saved!</> : 'Save Changes'}
          </button>
        </div>
      </form>

      {/* Change password */}
      <form onSubmit={handlePasswordChange} className="glass-card p-6 space-y-5">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-2">
          <KeyRound size={15} className="text-slate-400" /> Change Password
        </h3>

        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1.5">Current Password</label>
            <div className="relative">
              <input
                type={showCurrent ? 'text' : 'password'}
                value={pwForm.current}
                onChange={(e) => setPwForm({ ...pwForm, current: e.target.value })}
                placeholder="Enter your current password"
                className={inputClass + ' pr-10'}
                autoComplete="current-password"
              />
              <button
                type="button"
                onClick={() => setShowCurrent(!showCurrent)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                {showCurrent ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1.5">New Password</label>
              <div className="relative">
                <input
                  type={showNext ? 'text' : 'password'}
                  value={pwForm.next}
                  onChange={(e) => setPwForm({ ...pwForm, next: e.target.value })}
                  placeholder="Min. 8 characters"
                  className={inputClass + ' pr-10'}
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  onClick={() => setShowNext(!showNext)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                >
                  {showNext ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1.5">Confirm New Password</label>
              <input
                type="password"
                value={pwForm.confirm}
                onChange={(e) => setPwForm({ ...pwForm, confirm: e.target.value })}
                placeholder="Repeat new password"
                className={inputClass}
                autoComplete="new-password"
              />
            </div>
          </div>
        </div>

        {pwError && (
          <p className="flex items-center gap-2 text-sm text-red-400">
            <AlertCircle size={14} /> {pwError}
          </p>
        )}
        {pwSuccess && (
          <p className="flex items-center gap-2 text-sm text-emerald-400">
            <Check size={14} /> Password updated successfully
          </p>
        )}

        <div className="pt-1">
          <button
            type="submit"
            disabled={pwLoading || !pwForm.current || !pwForm.next || !pwForm.confirm}
            className="px-5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium text-sm transition-colors flex items-center gap-2"
          >
            {pwLoading ? (
              <><span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Updating…</>
            ) : (
              'Update Password'
            )}
          </button>
        </div>
      </form>
    </div>
  )
}
