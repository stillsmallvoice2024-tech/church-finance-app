import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Eye, EyeOff, Loader2, AlertCircle, CheckCircle2 } from 'lucide-react'
import { supabase } from '../lib/supabase'

function AppLogo() {
  return (
    <svg viewBox="0 0 32 32" className="h-10 w-10" fill="currentColor" aria-hidden="true">
      <rect x="13" y="2" width="6" height="28" rx="2" />
      <rect x="4" y="9" width="24" height="6" rx="2" />
    </svg>
  )
}

const inputCls =
  'w-full px-3 py-2.5 text-sm border border-gray-300 rounded-lg outline-none ' +
  'focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors'

export default function ResetPassword() {
  const navigate = useNavigate()

  const [password,   setPassword]   = useState('')
  const [confirm,    setConfirm]    = useState('')
  const [showPw,     setShowPw]     = useState(false)
  const [showConf,   setShowConf]   = useState(false)
  const [loading,    setLoading]    = useState(false)
  const [error,      setError]      = useState<string | null>(null)
  const [done,       setDone]       = useState(false)
  const [hasSession, setHasSession] = useState(false)

  // Supabase appends the recovery token in the URL hash; the SDK processes it
  // on page load and fires a PASSWORD_RECOVERY event. We listen for that event
  // to confirm we have a valid recovery session before showing the form.
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        setHasSession(true)
      }
    })
    // Also check if we already have a session (handles page refresh after recovery link)
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setHasSession(true)
    })
    return () => subscription.unsubscribe()
  }, [])

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    if (password !== confirm) {
      setError('Passwords do not match.')
      return
    }
    setLoading(true)
    const { error: err } = await supabase.auth.updateUser({ password })
    setLoading(false)
    if (err) {
      setError(err.message)
    } else {
      setDone(true)
      setTimeout(() => navigate('/', { replace: true }), 2500)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4 py-12">
      <div className="w-full max-w-md">

        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 inline-flex h-20 w-20 items-center justify-center rounded-2xl bg-primary text-white shadow-lg">
            <AppLogo />
          </div>
          <h1 className="text-3xl font-semibold text-gray-900">
            The Standing Church International
          </h1>
          <p className="mt-1 text-sm font-semibold uppercase tracking-widest text-accent">
            Financial Management System
          </p>
        </div>

        <div className="rounded-2xl border border-gray-100 bg-white px-8 py-8 shadow-md">
          <p className="mb-2 text-center text-sm font-semibold text-gray-700">Set a new password</p>
          <p className="mb-6 text-center text-xs text-gray-500">
            Choose a strong password to secure your account.
          </p>

          {done ? (
            <div className="flex flex-col items-center gap-3 py-4">
              <CheckCircle2 className="w-10 h-10 text-success" />
              <p className="text-sm font-medium text-gray-700">Password updated!</p>
              <p className="text-xs text-gray-500">Redirecting you to the dashboard…</p>
            </div>
          ) : !hasSession ? (
            <div className="flex flex-col items-center gap-3 py-4 text-center">
              <AlertCircle className="w-8 h-8 text-amber-400" />
              <p className="text-sm text-gray-600">
                This link appears invalid or has expired.
              </p>
              <button
                onClick={() => navigate('/login', { replace: true })}
                className="text-xs text-primary hover:underline mt-1"
              >
                ← Back to sign in
              </button>
            </div>
          ) : (
            <>
              {error && (
                <div className="mb-4 flex items-start gap-2.5 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-danger">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  {error}
                </div>
              )}

              <form onSubmit={handleReset} className="space-y-4">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-gray-600">New Password</label>
                  <div className="relative">
                    <input
                      type={showPw ? 'text' : 'password'}
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      placeholder="Minimum 8 characters"
                      required
                      autoComplete="new-password"
                      className={`${inputCls} pr-10`}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPw(v => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                      aria-label={showPw ? 'Hide password' : 'Show password'}
                    >
                      {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-medium text-gray-600">Confirm New Password</label>
                  <div className="relative">
                    <input
                      type={showConf ? 'text' : 'password'}
                      value={confirm}
                      onChange={e => setConfirm(e.target.value)}
                      placeholder="Re-enter your new password"
                      required
                      autoComplete="new-password"
                      className={`${inputCls} pr-10`}
                    />
                    <button
                      type="button"
                      onClick={() => setShowConf(v => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                      aria-label={showConf ? 'Hide password' : 'Show password'}
                    >
                      {showConf ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={loading || !password || !confirm}
                  className="w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-primary text-white text-sm font-semibold rounded-lg hover:bg-primary-light disabled:opacity-60 transition-colors"
                >
                  {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                  {loading ? 'Updating…' : 'Set new password'}
                </button>
              </form>
            </>
          )}
        </div>

        <div className="mt-6 text-center">
          <p className="text-xs text-gray-500">
            © {new Date().getFullYear()} The Standing Church International
          </p>
        </div>
      </div>
    </div>
  )
}
