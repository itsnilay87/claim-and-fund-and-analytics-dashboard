import { useState } from 'react'
import { useAuthStore } from '../store/authStore'
import { User, Mail, Building2, Shield, Camera, Check } from 'lucide-react'

export default function Profile() {
  const user = useAuthStore((s) => s.user)
  const updateUser = useAuthStore((s) => s.updateUser)
  const [form, setForm] = useState({
    name: user?.name || '',
    email: user?.email || '',
    company: user?.company || '',
    phone: '',
    bio: '',
  })
  const [saved, setSaved] = useState(false)

  const handleSave = async (e) => {
    e.preventDefault()
    try {
      await updateUser({ name: form.name, company: form.company })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch { /* error is in store */ }
  }

  return (
    <div className="max-w-2xl space-y-6 animate-fade-in-up">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Profile Settings</h1>
        <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">Manage your account information</p>
      </div>

      {/* Avatar */}
      <div className="glass-card p-6">
        <div className="flex items-center gap-5">
          <div className="relative">
            <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-teal-500 to-cyan-500 flex items-center justify-center text-white text-2xl font-bold">
              {user?.name?.charAt(0) || 'U'}
            </div>
            <button className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-white/10 flex items-center justify-center text-slate-400 hover:text-slate-900 dark:hover:text-white">
              <Camera size={12} />
            </button>
          </div>
          <div>
            <div className="text-lg font-semibold text-slate-900 dark:text-white">{user?.name}</div>
            <div className="text-sm text-slate-500 dark:text-slate-400">{user?.email}</div>
            <div className="flex items-center gap-1.5 mt-1">
              <Shield size={12} className="text-teal-600 dark:text-teal-400" />
              <span className="text-xs text-teal-600 dark:text-teal-400 capitalize">{user?.role || 'Analyst'}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Form */}
      <form onSubmit={handleSave} className="glass-card p-6 space-y-5">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Personal Information</h3>

        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1.5">Full Name</label>
            <div className="relative">
              <User size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500" />
              <input type="text" value={form.name} onChange={(e) => setForm({...form, name: e.target.value})}
                className="w-full pl-9 pr-4 py-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-white/10 text-slate-900 dark:text-white text-sm" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1.5">Email</label>
            <div className="relative">
              <Mail size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500" />
              <input type="email" value={form.email} disabled
                className="w-full pl-9 pr-4 py-2.5 rounded-lg bg-slate-100 dark:bg-slate-800/50 border border-slate-200 dark:border-white/10 text-slate-400 dark:text-slate-500 text-sm cursor-not-allowed" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1.5">Company</label>
            <div className="relative">
              <Building2 size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500" />
              <input type="text" value={form.company} onChange={(e) => setForm({...form, company: e.target.value})}
                className="w-full pl-9 pr-4 py-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-white/10 text-slate-900 dark:text-white text-sm" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1.5">Phone</label>
            <input type="tel" value={form.phone} onChange={(e) => setForm({...form, phone: e.target.value})}
              placeholder="+91 XXXXX XXXXX"
              className="w-full px-4 py-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-white/10 text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-600 text-sm" />
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1.5">Bio</label>
          <textarea rows={3} value={form.bio} onChange={(e) => setForm({...form, bio: e.target.value})}
            placeholder="Brief description..."
            className="w-full px-4 py-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-white/10 text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-600 text-sm resize-none" />
        </div>

        <div className="flex items-center gap-3 pt-2">
          <button type="submit"
            className="px-6 py-2.5 rounded-lg bg-gradient-to-r from-teal-600 to-cyan-600 text-white font-medium text-sm hover:from-teal-500 hover:to-cyan-500 transition-all flex items-center gap-2">
            {saved ? <><Check size={14} /> Saved!</> : 'Save Changes'}
          </button>
        </div>
      </form>

      {/* Password */}
      <div className="glass-card p-6 space-y-4">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Change Password</h3>
        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1.5">Current Password</label>
            <input type="password" placeholder="Enter current password"
              className="w-full px-4 py-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-white/10 text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-600 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1.5">New Password</label>
            <input type="password" placeholder="Enter new password"
              className="w-full px-4 py-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-white/10 text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-600 text-sm" />
          </div>
        </div>
        <button className="px-5 py-2 rounded-lg bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-white/10 transition-all">
          Update Password
        </button>
      </div>

      {/* Notifications */}
      <div className="glass-card p-6 space-y-4">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Notification Preferences</h3>
        {['Simulation complete alerts', 'Weekly portfolio digest', 'Product updates & news'].map((pref, i) => (
          <div key={i} className="flex items-center justify-between py-2">
            <span className="text-sm text-slate-600 dark:text-slate-300">{pref}</span>
            <button className="relative w-10 h-5 rounded-full bg-teal-600 transition-colors">
              <span className="absolute top-0.5 left-[22px] w-4 h-4 rounded-full bg-white transition-transform" />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
