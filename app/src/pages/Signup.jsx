import { useState, useRef, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../store/authStore'
import { ArrowRight, ArrowLeft, Eye, EyeOff, MailCheck } from 'lucide-react'

export default function Signup() {
  const navigate = useNavigate()
  const requestOtp = useAuthStore((s) => s.requestOtp)
  const verifyOtp = useAuthStore((s) => s.verifyOtp)
  const resendOtp = useAuthStore((s) => s.resendOtp)

  // Step 1 = signup form, Step 2 = OTP input
  const [step, setStep] = useState(1)
  const [form, setForm] = useState({ name: '', email: '', company: '', password: '', confirm: '' })
  const [showPw, setShowPw] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [resendCooldown, setResendCooldown] = useState(0)

  // 6-digit OTP input refs
  const [otpDigits, setOtpDigits] = useState(['', '', '', '', '', ''])
  const inputRefs = useRef([])

  const set = (field) => (e) => setForm({ ...form, [field]: e.target.value })

  // Resend cooldown timer
  useEffect(() => {
    if (resendCooldown <= 0) return
    const t = setTimeout(() => setResendCooldown(resendCooldown - 1), 1000)
    return () => clearTimeout(t)
  }, [resendCooldown])

  // ── Step 1: Submit form → request OTP ──

  const handleRequestOtp = async (e) => {
    e.preventDefault()
    setError('')
    if (!form.name || !form.email || !form.password) {
      setError('Please fill in all required fields')
      return
    }
    if (form.password.length < 8) {
      setError('Password must be at least 8 characters')
      return
    }
    if (form.password !== form.confirm) {
      setError('Passwords do not match')
      return
    }
    setLoading(true)
    try {
      await requestOtp(form.email, form.password, form.name)
      setStep(2)
      setResendCooldown(30)
    } catch (err) {
      setError(err.message || 'Failed to send verification code')
    } finally {
      setLoading(false)
    }
  }

  // ── Step 2: OTP digit handling ──

  const handleOtpChange = (index, value) => {
    // Only allow single digit
    if (value && !/^\d$/.test(value)) return
    const next = [...otpDigits]
    next[index] = value
    setOtpDigits(next)

    // Auto-focus next input
    if (value && index < 5) {
      inputRefs.current[index + 1]?.focus()
    }
  }

  const handleOtpKeyDown = (index, e) => {
    if (e.key === 'Backspace' && !otpDigits[index] && index > 0) {
      inputRefs.current[index - 1]?.focus()
    }
  }

  const handleOtpPaste = (e) => {
    e.preventDefault()
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6)
    if (!pasted) return
    const next = [...otpDigits]
    for (let i = 0; i < 6; i++) next[i] = pasted[i] || ''
    setOtpDigits(next)
    // Focus last filled or first empty
    const focusIdx = Math.min(pasted.length, 5)
    inputRefs.current[focusIdx]?.focus()
  }

  const handleVerifyOtp = async (e) => {
    e.preventDefault()
    setError('')
    const otp = otpDigits.join('')
    if (otp.length !== 6) {
      setError('Please enter the 6-digit code')
      return
    }
    setLoading(true)
    try {
      await verifyOtp(form.email, otp)
      navigate('/workspaces')
    } catch (err) {
      setError(err.message || 'Verification failed')
      setOtpDigits(['', '', '', '', '', ''])
      inputRefs.current[0]?.focus()
    } finally {
      setLoading(false)
    }
  }

  const handleResend = async () => {
    if (resendCooldown > 0) return
    setError('')
    try {
      await resendOtp(form.email)
      setResendCooldown(30)
      setOtpDigits(['', '', '', '', '', ''])
      inputRefs.current[0]?.focus()
    } catch (err) {
      setError(err.message || 'Failed to resend code')
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
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M8 16 L12 20 L20 8"/></svg>
            </div>
            <span className="text-xl font-bold text-slate-900 dark:text-white">Claim Analytics</span>
          </Link>
          {step === 1 ? (
            <>
              <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Create your account</h1>
              <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">Start analyzing claims in minutes</p>
            </>
          ) : (
            <>
              <MailCheck className="mx-auto mb-2 text-teal-500" size={36} />
              <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Verify your email</h1>
              <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">
                We sent a 6-digit code to <span className="font-medium text-slate-700 dark:text-slate-300">{form.email}</span>
              </p>
            </>
          )}
        </div>

        <div className="glass-card p-8">
          {step === 1 ? (
            <form onSubmit={handleRequestOtp} className="space-y-4">
              {error && (
                <div className="text-sm text-red-500 bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-2">{error}</div>
              )}

              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Full Name *</label>
                <input type="text" value={form.name} onChange={set('name')}
                  className="w-full px-4 py-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-white/10 text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 text-sm"
                  placeholder="John Smith" />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Work Email *</label>
                <input type="email" value={form.email} onChange={set('email')}
                  className="w-full px-4 py-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-white/10 text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 text-sm"
                  placeholder="you@company.com" />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Company</label>
                <input type="text" value={form.company} onChange={set('company')}
                  className="w-full px-4 py-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-white/10 text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 text-sm"
                  placeholder="Your organization" />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Password *</label>
                <div className="relative">
                  <input type={showPw ? 'text' : 'password'} value={form.password} onChange={set('password')}
                    className="w-full px-4 py-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-white/10 text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 text-sm pr-10"
                    placeholder="Min. 8 characters" />
                  <button type="button" onClick={() => setShowPw(!showPw)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300">
                    {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Confirm Password *</label>
                <input type="password" value={form.confirm} onChange={set('confirm')}
                  className="w-full px-4 py-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-white/10 text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 text-sm"
                  placeholder="Repeat your password" />
              </div>

              <button type="submit" disabled={loading}
                className="w-full py-3 rounded-lg bg-gradient-to-r from-teal-600 to-cyan-600 text-white font-semibold hover:from-teal-500 hover:to-cyan-500 transition-all shadow-lg shadow-teal-500/25 flex items-center justify-center gap-2 disabled:opacity-60">
                {loading ? <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <>Continue <ArrowRight size={16} /></>}
              </button>
            </form>
          ) : (
            <form onSubmit={handleVerifyOtp} className="space-y-5">
              {error && (
                <div className="text-sm text-red-500 bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-2">{error}</div>
              )}

              <div className="flex justify-center gap-2" onPaste={handleOtpPaste}>
                {otpDigits.map((digit, i) => (
                  <input
                    key={i}
                    ref={(el) => (inputRefs.current[i] = el)}
                    type="text"
                    inputMode="numeric"
                    maxLength={1}
                    value={digit}
                    onChange={(e) => handleOtpChange(i, e.target.value)}
                    onKeyDown={(e) => handleOtpKeyDown(i, e)}
                    className="w-12 h-14 text-center text-xl font-bold rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-white/10 text-slate-900 dark:text-white focus:border-teal-500 focus:ring-1 focus:ring-teal-500 outline-none transition-all"
                    autoFocus={i === 0}
                  />
                ))}
              </div>

              <button type="submit" disabled={loading}
                className="w-full py-3 rounded-lg bg-gradient-to-r from-teal-600 to-cyan-600 text-white font-semibold hover:from-teal-500 hover:to-cyan-500 transition-all shadow-lg shadow-teal-500/25 flex items-center justify-center gap-2 disabled:opacity-60">
                {loading ? <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <>Verify & Create Account <ArrowRight size={16} /></>}
              </button>

              <div className="flex items-center justify-between text-sm">
                <button type="button" onClick={() => { setStep(1); setError(''); setOtpDigits(['', '', '', '', '', '']) }}
                  className="text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 flex items-center gap-1">
                  <ArrowLeft size={14} /> Back
                </button>
                <button type="button" onClick={handleResend} disabled={resendCooldown > 0}
                  className="text-teal-600 dark:text-teal-400 hover:text-teal-500 disabled:text-slate-400 disabled:dark:text-slate-600">
                  {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : 'Resend code'}
                </button>
              </div>
            </form>
          )}
        </div>

        <p className="text-center mt-6 text-sm text-slate-500">
          Already have an account? <Link to="/login" className="text-teal-600 dark:text-teal-400 hover:text-teal-500 dark:hover:text-teal-300">Sign in</Link>
        </p>
      </div>
    </div>
  )
}
