import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Eye, EyeOff, Loader2, AlertCircle, CheckCircle2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'

function AppIcon() {
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

export default function LoginPage() {
  const { isAuthenticated } = useAuth()
  const navigate = useNavigate()

  const [mode,        setMode]        = useState<'signin' | 'forgot'>('signin')
  const [identifier,  setIdentifier]  = useState('')
  const [password,    setPassword]    = useState('')
  const [showPw,      setShowPw]      = useState(false)
  const [loading,     setLoading]     = useState(false)
  const [error,       setError]       = useState<string | null>(null)
  const [resetSent,   setResetSent]   = useState(false)

  useEffect(() => {
    if (isAuthenticated) navigate('/', { replace: true })
  }, [isAuthenticated, navigate])

  const resolveEmail = async (input: string): Promise<string | null> => {
    if (input.includes('@')) return input
    const { data } = await supabase
      .from('profiles')
      .select('email')
      .eq('username', input.trim().toLowerCase())
      .maybeSingle()
    return data?.email ?? null
  }

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)
    const email = await resolveEmail(identifier)
    if (!email) {
      setLoading(false)
      setError('No account found for that username.')
      return
    }
    const { error: err } = await supabase.auth.signInWithPassword({ email, password })
    setLoading(false)
    if (err) setError(err.message)
  }

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)
    const email = await resolveEmail(identifier)
    if (!email) {
      setLoading(false)
      setError('No account found for that username or email.')
      return
    }
    const { error: err } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    })
    setLoading(false)
    if (err) setError(err.message)
    else setResetSent(true)
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4 py-12">
      <div className="w-full max-w-md">

        {/* Logo & title */}
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 inline-flex h-20 w-20 items-center justify-center rounded-2xl bg-primary text-white shadow-lg">
            <AppIcon />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">
            Finance Manager
          </h1>
          <p className="mt-1 text-sm font-semibold uppercase tracking-widest text-accent">
            Financial Management System
          </p>
        </div>

        {/* Auth card */}
        <div className="rounded-2xl border border-gray-100 bg-white px-8 py-8 shadow-md">

          {mode === 'signin' ? (
            <>
              <p className="mb-6 text-center text-sm font-medium text-gray-600">
                Sign in to your account
              </p>

              {error && (
                <div className="mb-4 flex items-start gap-2.5 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-danger">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  {error}
                </div>
              )}

              <form onSubmit={handleSignIn} className="space-y-4">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-gray-600">Email or Username</label>
                  <input
                    type="text"
                    value={identifier}
                    onChange={e => setIdentifier(e.target.value)}
                    placeholder="you@example.com or username"
                    required
                    autoComplete="username"
                    className={inputCls}
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-medium text-gray-600">Password</label>
                  <div className="relative">
                    <input
                      type={showPw ? 'text' : 'password'}
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      placeholder="Enter your password"
                      required
                      autoComplete="current-password"
                      className={`${inputCls} pr-10`}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPw(v => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                      aria-label={showPw ? 'Hide password' : 'Show password'}
                    >
                      {showPw
                        ? <EyeOff className="w-4 h-4" />
                        : <Eye    className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={loading || !identifier || !password}
                  className="w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-primary text-white text-sm font-semibold rounded-lg hover:bg-primary-light disabled:opacity-60 transition-colors"
                >
                  {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                  {loading ? 'Signing in…' : 'Sign in'}
                </button>
              </form>

              <button
                onClick={() => { setMode('forgot'); setError(null) }}
                className="mt-4 w-full text-center text-xs text-primary hover:underline"
              >
                Forgot your password?
              </button>
            </>
          ) : (
            <>
              <p className="mb-2 text-center text-sm font-semibold text-gray-700">Reset your password</p>
              <p className="mb-6 text-center text-xs text-gray-500">
                Enter your email or username and we'll send a reset link.
              </p>

              {error && (
                <div className="mb-4 flex items-start gap-2.5 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-danger">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  {error}
                </div>
              )}

              {resetSent ? (
                <div className="flex flex-col items-center gap-3 py-4">
                  <CheckCircle2 className="w-10 h-10 text-success" />
                  <p className="text-sm font-medium text-gray-700">Reset email sent!</p>
                  <p className="text-xs text-gray-500 text-center">
                    Check your inbox and click the link to set a new password.
                  </p>
                </div>
              ) : (
                <form onSubmit={handleForgotPassword} className="space-y-4">
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-gray-600">Email or Username</label>
                    <input
                      type="text"
                      value={identifier}
                      onChange={e => setIdentifier(e.target.value)}
                      placeholder="you@example.com or username"
                      required
                      autoComplete="username"
                      className={inputCls}
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={loading || !identifier}
                    className="w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-primary text-white text-sm font-semibold rounded-lg hover:bg-primary-light disabled:opacity-60 transition-colors"
                  >
                    {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                    {loading ? 'Sending…' : 'Send reset link'}
                  </button>
                </form>
              )}

              <button
                onClick={() => { setMode('signin'); setError(null); setResetSent(false) }}
                className="mt-4 w-full text-center text-xs text-primary hover:underline"
              >
                ← Back to sign in
              </button>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="mt-6 space-y-2 text-center">
          <p className="text-xs text-gray-500">
            Need access?{' '}
            <span className="font-medium text-primary">
              Contact your administrator to request an account.
            </span>
          </p>
        </div>
      </div>
    </div>
  )
}
