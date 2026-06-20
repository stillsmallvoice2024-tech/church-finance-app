import { useState, useEffect } from 'react'
import { User, Lock, Info, Palette, CheckCircle2, XCircle, Loader2, Sun, Moon, Eye, EyeOff, Database, Download, UploadCloud, FileDown, FolderSync, Shield, Trash2 } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth }  from '../hooks/useAuth'
import { useRole }  from '../hooks/useRole'
import { MFAEnrollModal } from '../components/modals/MFAEnrollModal'
import { useToastStore } from '../store/toastStore'
import { useThemeStore } from '../store/themeStore'
import { useDbStatus } from '../hooks/useDbStatus'
import { usePageTitle } from '../hooks/usePageTitle'
import { HelpButton }       from '../components/onboarding/HelpButton'
import { useFirstVisitTour } from '../hooks/useFirstVisitTour'
import { PageHelpBanner }   from '../components/ui/PageHelpBanner'
import { ROLE_LABELS } from '../utils/constants'
import { friendlyError } from '../utils/friendlyError'
import { BackupModal }     from '../components/modals/BackupModal'
import { RestoreModal }    from '../components/modals/RestoreModal'
import { ExportCSVsModal } from '../components/modals/ExportCSVsModal'
import { migrateReceiptPaths, auditLegacyReceiptPaths, type MigrationStats } from '../utils/migrateReceiptPaths'

const APP_VERSION = '1.0.0'

function Section({ icon: Icon, title, iconColor, children }: {
  icon: React.ElementType
  title: string
  iconColor?: string
  children: React.ReactNode
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
      <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2.5">
        {iconColor
          ? <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${iconColor}`}><Icon className="w-4 h-4" /></div>
          : <Icon className="w-4 h-4 text-gray-500" />
        }
        <h2 className="text-sm font-semibold text-gray-800">{title}</h2>
      </div>
      <div className="p-5">{children}</div>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function Settings() {
  const { user, profile } = useAuth()
  const { role }          = useRole()
  const { push: toast }   = useToastStore()
  const { status: dbStatus, latency, recheck } = useDbStatus()

  usePageTitle('Settings')
  useFirstVisitTour('settings')

  const { theme, setTheme } = useThemeStore()

  const [fullName,      setFullName]      = useState(profile?.full_name ?? '')
  const [username,      setUsername]      = useState((profile as { username?: string | null } | null)?.username ?? '')
  const [savingName,    setSavingName]    = useState(false)

  // Data management modals
  const [backupOpen,    setBackupOpen]    = useState(false)
  const [restoreOpen,   setRestoreOpen]   = useState(false)
  const [exportOpen,    setExportOpen]    = useState(false)

  // 2FA state
  const [mfaEnrollOpen, setMfaEnrollOpen] = useState(false)
  const [mfaFactors,    setMfaFactors]    = useState<{ id: string; friendly_name: string | null }[]>([])
  const [mfaLoading,    setMfaLoading]    = useState(false)
  const [mfaError,      setMfaError]      = useState<string | null>(null)

  const [lastBackupTs, setLastBackupTs] = useState<string | null>(() => {
    try { return localStorage.getItem('church-last-backup') } catch { return null }
  })

  // Refresh last-backup display whenever the modal closes
  useEffect(() => {
    if (!backupOpen) {
      try { setLastBackupTs(localStorage.getItem('church-last-backup')) } catch {}
    }
  }, [backupOpen])

  // In-app password change
  const [newPassword,   setNewPassword]   = useState('')
  const [confirmPw,     setConfirmPw]     = useState('')
  const [showNewPw,     setShowNewPw]     = useState(false)
  const [showConfPw,    setShowConfPw]    = useState(false)
  const [changingPw,    setChangingPw]    = useState(false)
  const [pwError,       setPwError]       = useState<string | null>(null)
  const [pwDone,        setPwDone]        = useState(false)

  // Sync when profile loads
  useEffect(() => {
    if (profile?.full_name) setFullName(profile.full_name)
  }, [profile?.full_name])

  // Load enrolled MFA factors for owner/admin
  useEffect(() => {
    if (role !== 'owner' && role !== 'admin') return
    supabase.auth.mfa.listFactors().then(({ data }) => {
      setMfaFactors((data?.totp ?? []).map(f => ({ id: f.id, friendly_name: f.friendly_name ?? null })))
    })
  }, [role, mfaEnrollOpen])

  const handleRemoveMFA = async (factorId: string) => {
    setMfaLoading(true); setMfaError(null)
    const { error } = await supabase.auth.mfa.unenroll({ factorId })
    if (error) {
      setMfaError(friendlyError(error, 'update MFA'))
    } else {
      setMfaFactors(f => f.filter(x => x.id !== factorId))
    }
    setMfaLoading(false)
  }

  const handleSaveProfile = async () => {
    if (!fullName.trim() || !user?.id) return
    setSavingName(true)
    const { error } = await supabase
      .from('profiles')
      .update({
        full_name:  fullName.trim(),
        username:   username.trim().toLowerCase() || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', user.id)
    setSavingName(false)
    if (error) toast(friendlyError(error, 'save your profile'), 'error')
    else        toast('Profile updated.', 'success')
  }

  const handleChangePassword = async () => {
    setPwError(null)
    if (newPassword.length < 8) { setPwError('Password must be at least 8 characters.'); return }
    if (newPassword !== confirmPw) { setPwError('Passwords do not match.'); return }
    setChangingPw(true)
    const { error } = await supabase.auth.updateUser({ password: newPassword })
    setChangingPw(false)
    if (error) {
      setPwError(friendlyError(error, 'change your password'))
    } else {
      toast('Password updated successfully', 'success')
      setPwDone(true)
      setNewPassword(''); setConfirmPw('')
      setTimeout(() => setPwDone(false), 4000)
    }
  }

  const lastSync = new Date().toLocaleString()

  return (
    <div className="space-y-5 max-w-2xl">
      {/* Header */}
      <div data-tour="page-header" className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-gray-900">Settings</h1>
          <p className="text-sm text-gray-500 mt-0.5">Manage your account and preferences</p>
        </div>
        <HelpButton tourId="settingsTour" size="sm" />
      </div>

      <PageHelpBanner storageKey="help-dismissed-settings" title="Organisation Settings">
        Configure your profile, currency defaults, and fiscal year. Changes apply to the whole
        organisation. Some settings — such as org type — can only be changed by the owner. Use{' '}
        <strong>Backup</strong> to export a full data snapshot at any time.
      </PageHelpBanner>

      {/* Jump nav */}
      <nav className="flex flex-wrap gap-x-5 gap-y-1 pb-3 border-b border-gray-100">
        {([
          ['section-account',  'Account'],
          ['section-password', 'Password'],
          ...((role === 'owner' || role === 'admin') ? [['section-2fa', '2FA']] : []),
          ['section-theme',    'Theme'],
          ['section-data',     'Data'],
          ['section-info',     'Info'],
        ] as [string, string][]).map(([id, label]) => (
          <button
            key={id}
            onClick={() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
            className="text-sm text-gray-400 hover:text-primary font-medium transition-colors"
          >
            {label}
          </button>
        ))}
      </nav>

      {/* ── Account (Profile + Password + 2FA) ─────────────────────────── */}
      <div id="section-account" data-tour="org-settings" className="bg-white rounded-xl border border-gray-200 shadow-sm">
        {/* Card header */}
        <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 bg-blue-100 text-blue-600"><User className="w-4 h-4" /></div>
          <h2 className="text-sm font-semibold text-gray-800">Account</h2>
        </div>

        {/* Profile */}
        <div className="p-5 space-y-4">
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
              placeholder="Your full name"
              className="w-full px-3 py-2.5 text-sm border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
            />
          </div>

          {/* Username field */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-gray-600">Username</label>
            <input
              type="text"
              value={username}
              onChange={e => setUsername(e.target.value.replace(/\s/g, ''))}
              placeholder="Optional — used to log in instead of email"
              className="w-full px-3 py-2.5 text-sm border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
            />
            <p className="text-xs text-gray-500">Leave blank to log in with your email only.</p>
          </div>

          {/* Read-only account info — compact */}
          <div className="rounded-lg border border-gray-100 bg-gray-50 divide-y divide-gray-100">
            <div className="flex items-center justify-between px-3 py-2.5">
              <span className="text-xs text-gray-400 font-medium">Email</span>
              <span className="text-xs text-gray-600">{user?.email}</span>
            </div>
            <div className="flex items-center justify-between px-3 py-2.5">
              <span className="text-xs text-gray-400 font-medium">Role</span>
              <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium">{role ? ROLE_LABELS[role] : '—'}</span>
            </div>
          </div>
          <p className="text-xs text-gray-400">Email and role are managed by your administrator.</p>

          <button
            onClick={handleSaveProfile}
            disabled={savingName || !fullName.trim()}
            className="px-4 py-2 bg-primary text-white text-sm font-medium rounded-lg hover:bg-primary-light disabled:opacity-60 flex items-center gap-2"
          >
            {savingName && <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
            {savingName ? 'Saving…' : 'Save Changes'}
          </button>
        </div>

        {/* Password sub-section */}
        <div id="section-password" className="border-t border-gray-100">
          <div className="px-5 py-3 flex items-center gap-2">
            <Lock className="w-3.5 h-3.5 text-gray-400" />
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Change Password</h3>
          </div>
          <div className="px-5 pb-5 space-y-4">
            {pwDone && (
              <div className="flex items-center gap-2.5 rounded-lg bg-green-50 border border-green-200 px-4 py-3 text-sm text-success">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                Password updated successfully.
              </div>
            )}

            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-600">New Password</label>
              <div className="relative">
                <input
                  type={showNewPw ? 'text' : 'password'}
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  placeholder="Minimum 8 characters"
                  autoComplete="new-password"
                  className="w-full px-3 py-2.5 text-sm border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary pr-10"
                />
                <button type="button" onClick={() => setShowNewPw(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                  {showNewPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-600">Confirm New Password</label>
              <div className="relative">
                <input
                  type={showConfPw ? 'text' : 'password'}
                  value={confirmPw}
                  onChange={e => setConfirmPw(e.target.value)}
                  placeholder="Re-enter new password"
                  autoComplete="new-password"
                  className="w-full px-3 py-2.5 text-sm border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary pr-10"
                />
                <button type="button" onClick={() => setShowConfPw(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                  {showConfPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {pwError && (
              <div className="flex items-center gap-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-danger">
                <XCircle className="w-3.5 h-3.5 shrink-0" />
                {pwError}
              </div>
            )}

            <button
              onClick={handleChangePassword}
              disabled={changingPw || !newPassword || !confirmPw}
              className="px-4 py-2 bg-primary text-white text-sm font-medium rounded-lg hover:bg-primary-light disabled:opacity-60 flex items-center gap-2"
            >
              {changingPw && <Loader2 className="w-4 h-4 animate-spin" />}
              {changingPw ? 'Updating…' : 'Update Password'}
            </button>
          </div>
        </div>

        {/* 2FA sub-section */}
        {(role === 'owner' || role === 'admin') && (
          <div id="section-2fa" className="border-t border-gray-100">
            <div className="px-5 py-3 flex items-center gap-2">
              <Shield className="w-3.5 h-3.5 text-gray-400" />
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Two-Factor Authentication</h3>
            </div>
            <div className="px-5 pb-5 space-y-4">
              <p className="text-sm text-gray-500">
                Add an authenticator app (e.g. Google Authenticator, Authy) as a second factor.
                Once enabled, you will be asked for a time-based code each time you sign in.
              </p>

              {mfaError && (
                <div className="flex items-center gap-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-danger">
                  <XCircle className="w-3.5 h-3.5 shrink-0" />
                  {mfaError}
                </div>
              )}

              {mfaFactors.length > 0 ? (
                <div className="space-y-2">
                  {mfaFactors.map(f => (
                    <div key={f.id} className="flex items-center justify-between p-3 rounded-xl bg-green-50 border border-green-200">
                      <div className="flex items-center gap-2.5">
                        <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0" />
                        <div>
                          <p className="text-sm font-medium text-gray-900">Authenticator app</p>
                          {f.friendly_name && (
                            <p className="text-xs text-gray-500">{f.friendly_name}</p>
                          )}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleRemoveMFA(f.id)}
                        disabled={mfaLoading}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-danger border border-red-200 rounded-lg hover:bg-red-50 disabled:opacity-60 transition-colors"
                      >
                        {mfaLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setMfaEnrollOpen(true)}
                  className="flex items-center gap-2 px-4 py-2 text-sm font-medium border border-gray-300 rounded-lg hover:bg-black/[0.02] dark:hover:bg-white/[0.03] transition-colors"
                >
                  <Shield className="w-4 h-4 text-primary" />
                  Enable 2FA
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Theme ───────────────────────────────────────────────────────── */}
      <div id="section-theme" data-tour="appearance-settings">
      <Section icon={Palette} title="Theme" iconColor="bg-violet-100 text-violet-600">
        <div className="space-y-4">
          <p className="text-sm text-gray-500">Choose your preferred colour scheme. Your preference is saved automatically.</p>
          <div className="flex gap-3">
            <button
              onClick={() => setTheme('light')}
              className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 text-sm font-medium rounded-xl border-2 transition-colors ${
                theme === 'light'
                  ? 'border-primary bg-primary/5 text-primary'
                  : 'border-gray-200 text-gray-600 hover:bg-gray-50'
              }`}
            >
              <Sun className="w-4 h-4" /> Light
            </button>
            <button
              onClick={() => setTheme('dark')}
              className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 text-sm font-medium rounded-xl border-2 transition-colors ${
                theme === 'dark'
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-gray-200 text-gray-600 hover:bg-gray-50'
              }`}
            >
              <Moon className="w-4 h-4" /> Dark
            </button>
          </div>
        </div>
      </Section>
      </div>

      {/* ── Data Management ─────────────────────────────────────────────── */}
      <div id="section-data">
      <Section icon={Database} title="Data Management" iconColor="bg-emerald-100 text-emerald-700">
        <div className="space-y-4">
          <p className="text-sm text-gray-500">
            Back up your entire account, restore from a previous backup, or download your data as CSV spreadsheets.
          </p>
          <div className="space-y-2">
            <button
              onClick={() => setBackupOpen(true)}
              className="w-full flex items-center gap-3 px-4 py-3 text-left rounded-xl border border-gray-200 hover:border-primary/40 hover:bg-primary/5 transition-colors"
            >
              <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                <Download className="w-4 h-4 text-primary" />
              </div>
              <div>
                <p className="text-sm font-medium text-gray-900">Backup Account</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  {lastBackupTs
                    ? `Last backup: ${new Date(lastBackupTs).toLocaleString()}`
                    : 'Download or share a complete backup of all your data.'}
                </p>
              </div>
            </button>

            <button
              onClick={() => setRestoreOpen(true)}
              className="w-full flex items-center gap-3 px-4 py-3 text-left rounded-xl border border-gray-200 hover:border-primary/40 hover:bg-primary/5 transition-colors"
            >
              <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                <UploadCloud className="w-4 h-4 text-primary" />
              </div>
              <div>
                <p className="text-sm font-medium text-gray-900">Restore Backup</p>
                <p className="text-xs text-gray-500 mt-0.5">Upload a backup file to restore your account to a previous state.</p>
              </div>
            </button>

            <button
              onClick={() => setExportOpen(true)}
              className="w-full flex items-center gap-3 px-4 py-3 text-left rounded-xl border border-gray-200 hover:border-gray-300 hover:bg-black/[0.02] dark:hover:bg-white/[0.03] transition-colors"
            >
              <div className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center shrink-0">
                <FileDown className="w-4 h-4 text-gray-500" />
              </div>
              <div>
                <p className="text-sm font-medium text-gray-900">Export CSVs</p>
                <p className="text-xs text-gray-500 mt-0.5">Download all tables as individual CSV spreadsheets.</p>
              </div>
            </button>
          </div>
        </div>
      </Section>
      </div>

      {/* ── App Info ────────────────────────────────────────────────────── */}
      <div id="section-info">
      <Section icon={Info} title="App Information" iconColor="bg-slate-100 text-slate-500">
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
      </div>
      {/* ── Receipt Path Migration (admin only) ─────────────────────── */}
      {role === 'admin' && <ReceiptMigrationPanel />}

      <BackupModal
        open={backupOpen}
        onClose={() => setBackupOpen(false)}
      />
      <RestoreModal
        open={restoreOpen}
        onClose={() => setRestoreOpen(false)}
        onDone={() => toast('Restore complete — reload to see changes', 'success')}
      />
      <ExportCSVsModal
        open={exportOpen}
        onClose={() => setExportOpen(false)}
      />
      <MFAEnrollModal
        open={mfaEnrollOpen}
        onClose={() => setMfaEnrollOpen(false)}
        onDone={() => toast('Two-factor authentication enabled', 'success')}
      />
    </div>
  )
}

// ── Receipt Path Migration panel ──────────────────────────────────────────────

function ReceiptMigrationPanel() {
  const [legacyCount, setLegacyCount] = useState<number | null>(null)
  const [auditing,    setAuditing]    = useState(false)
  const [running,     setRunning]     = useState(false)
  const [progress,    setProgress]    = useState<{ current: number; total: number; message: string } | null>(null)
  const [stats,       setStats]       = useState<MigrationStats | null>(null)
  const [err,         setErr]         = useState<string | null>(null)

  const handleAudit = async () => {
    setAuditing(true); setErr(null); setStats(null); setLegacyCount(null)
    try {
      const count = await auditLegacyReceiptPaths()
      setLegacyCount(count)
    } catch (e) {
      setErr(String(e))
    } finally {
      setAuditing(false)
    }
  }

  const handleMigrate = async () => {
    setRunning(true); setErr(null); setStats(null); setProgress(null)
    try {
      const result = await migrateReceiptPaths((current, total, message) => {
        setProgress({ current, total, message })
      })
      setStats(result)
      setLegacyCount(result.failed + result.skipped)
    } catch (e) {
      setErr(String(e))
    } finally {
      setRunning(false); setProgress(null)
    }
  }

  return (
    <Section icon={FolderSync} title="Receipt Path Migration">
      <div className="space-y-4">
        <p className="text-sm text-gray-500">
          Moves legacy receipt files from <code className="text-xs bg-gray-100 px-1 py-0.5 rounded">entityType/entityId/file</code> to
          the org-prefixed format <code className="text-xs bg-gray-100 px-1 py-0.5 rounded">orgId/entityType/entityId/file</code>.
          Run Audit first to see how many files need migration.
        </p>

        <div className="flex gap-2">
          <button
            onClick={handleAudit}
            disabled={auditing || running}
            className="px-4 py-2 text-sm font-medium rounded-lg border border-gray-300 hover:bg-gray-50 disabled:opacity-60 flex items-center gap-2"
          >
            {auditing && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {auditing ? 'Auditing…' : 'Audit Legacy Paths'}
          </button>

          {legacyCount !== null && legacyCount > 0 && (
            <button
              onClick={handleMigrate}
              disabled={running}
              className="px-4 py-2 text-sm font-medium rounded-lg bg-primary text-white hover:bg-primary-light disabled:opacity-60 flex items-center gap-2"
            >
              {running && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {running ? 'Migrating…' : `Migrate ${legacyCount} Files`}
            </button>
          )}
        </div>

        {legacyCount === 0 && !stats && (
          <div className="flex items-center gap-2 text-sm text-success">
            <CheckCircle2 className="w-4 h-4" /> All receipt paths are already org-prefixed.
          </div>
        )}

        {progress && (
          <div className="space-y-1.5">
            <div className="flex justify-between text-xs text-gray-500">
              <span>{progress.message}</span>
              <span>{progress.current} / {progress.total}</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-1.5">
              <div
                className="bg-primary h-1.5 rounded-full transition-all"
                style={{ width: `${Math.round((progress.current / progress.total) * 100)}%` }}
              />
            </div>
          </div>
        )}

        {stats && (
          <div className="rounded-xl border border-gray-200 divide-y divide-black/[0.05] text-sm overflow-hidden">
            <div className="flex justify-between px-4 py-2.5 bg-gray-50">
              <span className="text-gray-500">Total legacy files found</span>
              <span className="font-medium">{stats.total}</span>
            </div>
            <div className="flex justify-between px-4 py-2.5">
              <span className="text-gray-500">Migrated successfully</span>
              <span className="font-medium text-success">{stats.migrated}</span>
            </div>
            <div className="flex justify-between px-4 py-2.5">
              <span className="text-gray-500">Skipped (no org_id)</span>
              <span className="font-medium text-amber-600">{stats.skipped}</span>
            </div>
            <div className="flex justify-between px-4 py-2.5">
              <span className="text-gray-500">Failed</span>
              <span className="font-medium text-danger">{stats.failed}</span>
            </div>
          </div>
        )}

        {stats && stats.errors.length > 0 && (
          <details className="text-xs">
            <summary className="cursor-pointer text-gray-500 hover:text-gray-700">
              {stats.errors.length} warning{stats.errors.length !== 1 ? 's' : ''} / errors
            </summary>
            <pre className="mt-2 p-3 bg-gray-50 rounded-lg overflow-auto text-gray-600 max-h-48 whitespace-pre-wrap">
              {stats.errors.join('\n')}
            </pre>
          </details>
        )}

        {err && (
          <div className="flex items-start gap-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-danger">
            <XCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            {err}
          </div>
        )}
      </div>
    </Section>
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
