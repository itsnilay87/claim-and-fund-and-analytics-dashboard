import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../store/authStore'
import { ArrowRight, ArrowLeft, Eye, EyeOff, MailCheck } from 'lucide-react'

export default function ForgotPassword() {
  const navigate = useNavigate()
  const requestPasswordResetOtp = useAuthStore((s) => s.requestPasswordResetOtp)
  const resetPasswordWithOtp = useAuthStore((s) => s.resetPasswordWithOtp)

  const [step, setStep] = useState(1)
  const [email, setEmail] = useState('')
  const [otp, setOtp] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showNew, setShowNew] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)

  const handleRequest = async (e) => {
    e.preventDefault()
    setError('')
    setMessage('')
    if (!email.trim()) {
      setError('Email is required')
      return
    }

    setLoading(true)
    try {
      await requestPasswordResetOtp(email.trim())
      setStep(2)
      setMessage('Verification code sent. Check your email.')
    } catch (err) {
      setError(err.message || 'Failed to send verification code')
    } finally {
      setLoading(false)
    }
  }

  const handleReset = async (e) => {
    e.preventDefault()
    setError('')
    setMessage('')

    if (!otp.trim() || !newPassword || !confirmPassword) {
      setError('Please fill all required fields')
      return
    }
    if (newPassword.length < 8) {
      setError('Password must be at least 8 characters')
      return
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match')
      return
    }

    setLoading(true)
    try {
      await resetPasswordWithOtp(email.trim(), otp.trim(), newPassword)
      setMessage('Password reset successful. Redirecting to login...')
      setTimeout(() => navigate('/login'), 900)
    } catch (err) {
      setError(err.message || 'Failed to reset password')
    } finally {
      setLoading(false)
    }
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
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Reset your password</h1>
          <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">{step === 1 ? 'Request a verification code' : 'Verify code and set new password'}</p>
        </div>

        <div className="glass-card p-8">
          {error && <div className="text-sm text-red-500 bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-2 mb-4">{error}</div>}
          {message && <div className="text-sm text-teal-500 bg-teal-500/10 border border-teal-500/20 rounded-lg px-4 py-2 mb-4">{message}</div>}

          {step === 1 ? (
            <form onSubmit={handleRequest} className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-white/10 text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 text-sm"
                  placeholder="you@company.com"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 rounded-lg bg-gradient-to-r from-teal-600 to-cyan-600 text-white font-semibold hover:from-teal-500 hover:to-cyan-500 transition-all shadow-lg shadow-teal-500/25 flex items-center justify-center gap-2 disabled:opacity-60"
              >
                {loading ? <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <>Send Code <ArrowRight size={16} /></>}
              </button>
            </form>
          ) : (
            <form onSubmit={handleReset} className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-white/10 text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 text-sm"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Verification Code</label>
                <input
                  type="text"
                  value={otp}
                  maxLength={6}
                  onChange={(e) => setOtp(e.target.value.replace(/[^0-9]/g, ''))}
                  className="w-full px-4 py-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-white/10 text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 text-sm"
                  placeholder="6-digit code"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">New Password</label>
                <div className="relative">
                  <input
                    type={showNew ? 'text' : 'password'}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-white/10 text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 text-sm pr-10"
                    placeholder="At least 8 characters"
                  />
                  <button type="button" onClick={() => setShowNew(!showNew)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300">
                    {showNew ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Confirm New Password</label>
                <div className="relative">
                  <input
                    type={showConfirm ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-white/10 text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 text-sm pr-10"
                  />
                  <button type="button" onClick={() => setShowConfirm(!showConfirm)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300">
                    {showConfirm ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  className="py-3 rounded-lg border border-slate-200 dark:border-white/10 text-slate-700 dark:text-slate-200 font-semibold hover:bg-slate-100 dark:hover:bg-white/5 transition-all flex items-center justify-center gap-2"
                >
                  <ArrowLeft size={16} /> Back
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="py-3 rounded-lg bg-gradient-to-r from-teal-600 to-cyan-600 text-white font-semibold hover:from-teal-500 hover:to-cyan-500 transition-all shadow-lg shadow-teal-500/25 flex items-center justify-center gap-2 disabled:opacity-60"
                >
                  {loading ? <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <>Reset <MailCheck size={16} /></>}
                </button>
              </div>
            </form>
          )}
        </div>

        <p className="text-center mt-6 text-sm text-slate-500">
          Remembered your password? <Link to="/login" className="text-teal-600 dark:text-teal-400 hover:text-teal-500 dark:hover:text-teal-300">Sign in</Link>
        </p>
      </div>
    </div>
  )
}
