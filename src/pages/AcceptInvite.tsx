import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Eye, EyeOff, Loader2, AlertCircle, CheckCircle2 } from 'lucide-react'
import { supabase } from '../lib/supabase'

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

interface Invitation {
  id:         string
  email:      string
  role:       string
  org_name?:  string
  status:     string
  expires_at: string | null
}

export default function AcceptInvite() {
  const { token } = useParams<{ token: string }>()
  const navigate  = useNavigate()

  const [invitation,    setInvitation]    = useState<Invitation | null>(null)
  const [loadingInvite, setLoadingInvite] = useState(true)
  const [inviteError,   setInviteError]   = useState<string | null>(null)

  // 'register' = new user sign-up; 'signin' = existing account detected
  const [flow,      setFlow]      = useState<'register' | 'signin'>('register')
  const [fullName,  setFullName]  = useState('')
  const [username,  setUsername]  = useState('')
  const [password,  setPassword]  = useState('')
  const [confirm,   setConfirm]   = useState('')
  const [showPw,    setShowPw]    = useState(false)
  const [showConf,  setShowConf]  = useState(false)
  const [loading,   setLoading]   = useState(false)
  const [error,     setError]     = useState<string | null>(null)
  const [done,      setDone]      = useState(false)

  useEffect(() => {
    if (!token) {
      setInviteError('Invalid invite link.')
      setLoadingInvite(false)
      return
    }
    const fetchInvite = async () => {
      const { data, error: err } = await supabase
        .rpc('get_invitation_by_token', { p_token: token })

      setLoadingInvite(false)
      const invite = Array.isArray(data) ? data[0] : null
      if (err || !invite) {
        setInviteError('This invite link is invalid or has expired.')
        return
      }
      setInvitation(invite)
    }
    fetchInvite()
  }, [token])

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!fullName.trim()) { setError('Full name is required.'); return }
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return }
    if (password !== confirm) { setError('Passwords do not match.'); return }
    if (!invitation) return

    setLoading(true)

    const { data: signUpData, error: signUpErr } = await supabase.auth.signUp({
      email:    invitation.email,
      password,
      options:  { data: { full_name: fullName.trim(), username: username.trim().toLowerCase() || null } },
    })

    // Supabase signals "already registered" either via an error message or by
    // returning no user (when email confirmation is required for existing accounts).
    const alreadyRegistered =
      (signUpErr && /already.*(registered|exists)|user.*exist/i.test(signUpErr.message)) ||
      (!signUpErr && !signUpData.user)

    if (alreadyRegistered) {
      setLoading(false)
      setFlow('signin')
      setPassword('')
      setConfirm('')
      return
    }

    if (signUpErr) {
      setLoading(false)
      setError(signUpErr.message)
      return
    }

    const userId = signUpData.user?.id
    if (userId) {
      const trimmedUsername = username.trim().toLowerCase() || null
      const { error: profileErr } = await supabase.from('profiles').update({
        full_name:  fullName.trim(),
        username:   trimmedUsername,
        updated_at: new Date().toISOString(),
      }).eq('id', userId)

      if (profileErr) {
        console.error('[invite] profile update failed:', profileErr)
        // 23505 = unique_violation (username taken). Non-fatal — profile exists;
        // user can set a different username from their account settings.
        if (profileErr.code !== '23505') {
          setLoading(false)
          setError('Account created but profile update failed. Please contact support.')
          return
        }
      }

      const { error: acceptErr } = await supabase
        .rpc('accept_invitation', { p_token: token, p_user_id: userId })
      if (acceptErr) {
        console.error('[invite] accept_invitation failed:', acceptErr)
        setLoading(false)
        setError(
          acceptErr.message.includes('Unauthorized')
            ? 'Session error — please refresh and try again.'
            : 'Failed to activate your account. The invite may have already been used.',
        )
        return
      }
    }

    setLoading(false)
    setDone(true)
    setTimeout(() => navigate('/', { replace: true }), 3000)
  }

  // Existing account: sign in then accept the invitation under this org.
  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return }
    if (!invitation) return

    setLoading(true)
    const { data: signInData, error: signInErr } = await supabase.auth.signInWithPassword({
      email:    invitation.email,
      password,
    })
    if (signInErr) {
      setLoading(false)
      setError(signInErr.message)
      return
    }
    const userId = signInData.user?.id
    if (!userId) {
      setLoading(false)
      setError('Sign in failed. Please try again.')
      return
    }
    const { error: acceptErr } = await supabase
      .rpc('accept_invitation', { p_token: token, p_user_id: userId })
    if (acceptErr) {
      console.error('[invite] accept_invitation (signin flow) failed:', acceptErr)
      setLoading(false)
      setError(
        acceptErr.message.includes('Unauthorized')
          ? 'Session error — please refresh and try again.'
          : 'Failed to accept invitation. It may have already been used.',
      )
      return
    }
    setLoading(false)
    setDone(true)
    setTimeout(() => navigate('/', { replace: true }), 3000)
  }

  const orgDisplay = invitation?.org_name ?? 'Finance Manager'

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4 py-12">
      <div className="w-full max-w-md">

        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 inline-flex h-20 w-20 items-center justify-center rounded-2xl bg-primary text-white shadow-lg">
            <AppIcon />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">
            {orgDisplay}
          </h1>
          <p className="mt-1 text-sm font-semibold uppercase tracking-widest text-accent">
            Financial Management System
          </p>
        </div>

        <div className="rounded-2xl border border-gray-100 bg-white px-8 py-8 shadow-md">
          {loadingInvite ? (
            <div className="flex justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-primary" />
            </div>
          ) : inviteError ? (
            <div className="flex flex-col items-center gap-3 py-4 text-center">
              <AlertCircle className="w-8 h-8 text-red-400" />
              <p className="text-sm text-gray-700 font-medium">{inviteError}</p>
              <button
                onClick={() => navigate('/login', { replace: true })}
                className="text-xs text-primary hover:underline mt-1"
              >
                ← Back to sign in
              </button>
            </div>
          ) : done ? (
            <div className="flex flex-col items-center gap-3 py-4 text-center">
              <CheckCircle2 className="w-10 h-10 text-success" />
              <p className="text-sm font-medium text-gray-700">Account created!</p>
              <p className="text-xs text-gray-500">
                {invitation?.email && `Signed in as ${invitation.email}. `}
                Redirecting to the dashboard…
              </p>
            </div>
          ) : flow === 'signin' ? (
            <>
              <p className="mb-2 text-center text-sm font-semibold text-gray-700">
                Account already exists
              </p>
              <p className="mb-4 text-center text-xs text-gray-500">
                An account for <strong>{invitation?.email}</strong> already exists.
                Sign in to accept this invitation and join the organisation.
              </p>

              <div className="mb-4 rounded-lg bg-blue-50 border border-blue-200 px-3 py-2.5 text-xs text-blue-700">
                Joining as <strong>{invitation?.email}</strong> with{' '}
                <strong className="capitalize">{invitation?.role}</strong> role.
              </div>

              {error && (
                <div className="mb-4 flex items-start gap-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2.5 text-xs text-danger">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  {error}
                </div>
              )}

              <form onSubmit={handleSignIn} className="space-y-4">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-gray-600">Password *</label>
                  <div className="relative">
                    <input
                      type={showPw ? 'text' : 'password'}
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      placeholder="Your existing password"
                      required
                      autoFocus
                      autoComplete="current-password"
                      className={`${inputCls} pr-10`}
                    />
                    <button type="button" onClick={() => setShowPw(v => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                      {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={loading || !password}
                  className="w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-primary text-white text-sm font-semibold rounded-lg hover:bg-primary-light disabled:opacity-60 transition-colors"
                >
                  {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                  {loading ? 'Signing in…' : 'Sign in & accept invitation'}
                </button>
              </form>

              <button
                onClick={() => { setFlow('register'); setError(null) }}
                className="mt-3 w-full text-xs text-gray-400 hover:text-gray-600 hover:underline"
              >
                ← Back
              </button>
            </>
          ) : (
            <>
              <p className="mb-2 text-center text-sm font-semibold text-gray-700">
                You've been invited!
              </p>
              <p className="mb-6 text-center text-xs text-gray-500">
                Set up your account to access the finance system.
              </p>

              <div className="mb-4 rounded-lg bg-blue-50 border border-blue-200 px-3 py-2.5 text-xs text-blue-700">
                Joining as <strong>{invitation?.email}</strong> with{' '}
                <strong className="capitalize">{invitation?.role}</strong> role.
              </div>

              {error && (
                <div className="mb-4 flex items-start gap-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2.5 text-xs text-danger">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  {error}
                </div>
              )}

              <form onSubmit={handleRegister} className="space-y-4">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-gray-600">Full Name *</label>
                  <input
                    type="text"
                    value={fullName}
                    onChange={e => setFullName(e.target.value)}
                    placeholder="Your full name"
                    required
                    autoFocus
                    className={inputCls}
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-medium text-gray-600">Username</label>
                  <input
                    type="text"
                    value={username}
                    onChange={e => setUsername(e.target.value.replace(/\s/g, ''))}
                    placeholder="Optional — used to log in"
                    className={inputCls}
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-medium text-gray-600">Password *</label>
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
                    <button type="button" onClick={() => setShowPw(v => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                      {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-medium text-gray-600">Confirm Password *</label>
                  <div className="relative">
                    <input
                      type={showConf ? 'text' : 'password'}
                      value={confirm}
                      onChange={e => setConfirm(e.target.value)}
                      placeholder="Re-enter password"
                      required
                      autoComplete="new-password"
                      className={`${inputCls} pr-10`}
                    />
                    <button type="button" onClick={() => setShowConf(v => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                      {showConf ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={loading || !fullName || !password || !confirm}
                  className="w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-primary text-white text-sm font-semibold rounded-lg hover:bg-primary-light disabled:opacity-60 transition-colors"
                >
                  {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                  {loading ? 'Creating account…' : 'Create account'}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
