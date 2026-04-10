import { useState, useEffect, useCallback } from 'react'
import { User, Lock, Info, Palette, CheckCircle2, XCircle, Loader2 } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth }  from '../hooks/useAuth'
import { useRole }  from '../hooks/useRole'
import { useToastStore } from '../store/toastStore'
import { ROLE_LABELS } from '../utils/constants'

const APP_VERSION = '1.0.0'

function Section({ icon: Icon, title, children }: {
  icon: React.ElementType
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
      <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2.5">
        <Icon className="w-4 h-4 text-gray-500" />
        <h2 className="text-sm font-semibold text-gray-800">{title}</h2>
      </div>
      <div className="p-5">{children}</div>
    </div>
  )
}

// ── Database status ────────────────────────────────────────────────────────────

type DbStatus = 'checking' | 'online' | 'offline'

function useDbStatus() {
  const [status, setStatus] = useState<DbStatus>('checking')
  const [latency, setLatency] = useState<number | null>(null)

  const check = useCallback(async () => {
    setStatus('checking')
    const t0 = Date.now()
    try {
      const { error } = await supabase.from('profiles').select('id').limit(1)
      if (error) throw error
      setLatency(Date.now() - t0)
      setStatus('online')
    } catch {
      setStatus('offline')
      setLatency(null)
    }
  }, [])

  useEffect(() => { check() }, [check])

  return { status, latency, recheck: check }
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function Settings() {
  const { user, profile } = useAuth()
  const { role }          = useRole()
  const { push: toast }   = useToastStore()
  const { status: dbStatus, latency, recheck } = useDbStatus()

  const [fullName,      setFullName]      = useState(profile?.full_name ?? '')
  const [savingName,    setSavingName]    = useState(false)
  const [sendingReset,  setSendingReset]  = useState(false)
  const [resetSent,     setResetSent]     = useState(false)
  const [themeMode,     setThemeMode]     = useState<'light' | 'dark'>('light')

  // Sync when profile loads
  useEffect(() => {
    if (profile?.full_name) setFullName(profile.full_name)
  }, [profile?.full_name])

  const handleSaveName = async () => {
    if (!fullName.trim() || !user?.id) return
    setSavingName(true)
    const { error } = await supabase
      .from('profiles')
      .update({ full_name: fullName.trim(), updated_at: new Date().toISOString() })
      .eq('id', user.id)
    setSavingName(false)
    if (error) toast(error.message, 'error')
    else        toast('Name updated successfully', 'success')
  }

  const handleResetPassword = async () => {
    if (!user?.email) return
    setSendingReset(true)
    const { error } = await supabase.auth.resetPasswordForEmail(user.email, {
      redirectTo: `${window.location.origin}/reset-password`,
    })
    setSendingReset(false)
    if (error) {
      toast(error.message, 'error')
    } else {
      setResetSent(true)
      toast(`Password reset email sent to ${user.email}`, 'success')
    }
  }

  const lastSync = new Date().toLocaleString()

  return (
    <div className="space-y-5 max-w-2xl">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-gray-900">Settings</h1>
        <p className="text-sm text-gray-500 mt-0.5">Manage your account and preferences</p>
      </div>

      {/* ── My Profile ──────────────────────────────────────────────────── */}
      <Section icon={User} title="My Profile">
        <div className="space-y-4">
          {/* Avatar + info row */}
          <div className="flex items-center gap-4 p-4 bg-gray-50 rounded-xl">
            <div className="w-12 h-12 rounded-full bg-primary flex items-center justify-center text-white text-sm font-bold shrink-0">
              {(fullName || user?.email || 'U')
                .split(' ')
                .map(w => w[0])
                .join('')
                .toUpperCase()
                .slice(0, 2)}
            </div>
            <div>
              <div className="font-semibold text-gray-900">{fullName || '—'}</div>
              <div className="text-sm text-gray-500">{user?.email}</div>
              <div className="mt-1 text-xs font-medium inline-block px-2 py-0.5 rounded-full bg-primary/10 text-primary">
                {role ? ROLE_LABELS[role] : '—'}
              </div>
            </div>
          </div>

          {/* Full name field */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-gray-600">Full Name</label>
            <input
              type="text"
              value={fullName}
              onChange={e => setFullName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSaveName()}
              placeholder="Your full name"
              className="w-full px-3 py-2.5 text-sm border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
            />
          </div>

          {/* Email (read-only) */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-gray-600">Email Address</label>
            <input
              type="email"
              value={user?.email ?? ''}
              readOnly
              className="w-full px-3 py-2.5 text-sm border border-gray-100 rounded-lg bg-gray-50 text-gray-400 cursor-not-allowed"
            />
            <p className="text-xs text-gray-400">Email address cannot be changed here.</p>
          </div>

          {/* Role (read-only) */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-gray-600">Role</label>
            <input
              type="text"
              value={role ? ROLE_LABELS[role] : '—'}
              readOnly
              className="w-full px-3 py-2.5 text-sm border border-gray-100 rounded-lg bg-gray-50 text-gray-400 cursor-not-allowed"
            />
            <p className="text-xs text-gray-400">Roles are assigned by an administrator.</p>
          </div>

          <button
            onClick={handleSaveName}
            disabled={savingName || !fullName.trim()}
            className="px-4 py-2 bg-primary text-white text-sm font-medium rounded-lg hover:bg-primary-light disabled:opacity-60 flex items-center gap-2"
          >
            {savingName && <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
            {savingName ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </Section>

      {/* ── Change Password ──────────────────────────────────────────────── */}
      <Section icon={Lock} title="Change Password">
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            We'll send a secure password reset link to <strong>{user?.email}</strong>.
            Click the link in the email to set a new password.
          </p>

          {resetSent ? (
            <div className="flex items-center gap-2.5 rounded-lg bg-green-50 border border-green-200 px-4 py-3 text-sm text-success">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              Reset email sent. Check your inbox.
            </div>
          ) : (
            <button
              onClick={handleResetPassword}
              disabled={sendingReset}
              className="px-4 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 disabled:opacity-60 flex items-center gap-2"
            >
              {sendingReset && <Loader2 className="w-4 h-4 animate-spin" />}
              {sendingReset ? 'Sending…' : 'Send Password Reset Email'}
            </button>
          )}
        </div>
      </Section>

      {/* ── App Info ────────────────────────────────────────────────────── */}
      <Section icon={Info} title="App Information">
        <div className="space-y-3 text-sm">
          <InfoRow label="Version" value={`v${APP_VERSION}`} />
          <InfoRow label="Last sync" value={lastSync} />
          <div className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
            <span className="text-gray-500">Database</span>
            <div className="flex items-center gap-2">
              {dbStatus === 'checking' && (
                <span className="flex items-center gap-1.5 text-gray-400">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> Checking…
                </span>
              )}
              {dbStatus === 'online' && (
                <span className="flex items-center gap-1.5 text-success text-xs font-medium">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Connected {latency !== null ? `(${latency}ms)` : ''}
                </span>
              )}
              {dbStatus === 'offline' && (
                <span className="flex items-center gap-1.5 text-danger text-xs font-medium">
                  <XCircle className="w-3.5 h-3.5" /> Offline
                </span>
              )}
              <button
                onClick={recheck}
                className="text-xs text-primary underline ml-1"
              >
                Recheck
              </button>
            </div>
          </div>
          <InfoRow label="Environment" value={import.meta.env.MODE === 'production' ? 'Production' : 'Development'} />
        </div>
      </Section>

      {/* ── Theme ───────────────────────────────────────────────────────── */}
      <Section icon={Palette} title="Theme">
        <div className="space-y-3">
          <p className="text-sm text-gray-500">Dark mode is coming soon. This toggle is a placeholder.</p>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setThemeMode('light')}
              className={`px-4 py-2 text-sm rounded-lg border transition-colors ${
                themeMode === 'light'
                  ? 'bg-primary text-white border-primary'
                  : 'border-gray-300 text-gray-600 hover:bg-gray-50'
              }`}
            >
              ☀️ Light
            </button>
            <button
              onClick={() => setThemeMode('dark')}
              className={`px-4 py-2 text-sm rounded-lg border transition-colors ${
                themeMode === 'dark'
                  ? 'bg-gray-900 text-white border-gray-900'
                  : 'border-gray-300 text-gray-600 hover:bg-gray-50'
              }`}
            >
              🌙 Dark <span className="ml-1 text-xs opacity-60">(soon)</span>
            </button>
          </div>
        </div>
      </Section>
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
      <span className="text-gray-500">{label}</span>
      <span className="font-medium text-gray-800">{value}</span>
    </div>
  )
}
