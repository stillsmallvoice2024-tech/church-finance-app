import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, Building2, Download, Eye, EyeOff, Loader2, PlusCircle, ShieldAlert, Trash2 } from 'lucide-react'
import { Modal } from '../ui/Modal'
import { useOrgDeletion } from '../../hooks/useOrgDeletion'
import { useOrgStore, type OrgMembership } from '../../store/orgStore'
import { useOrgSwitch } from '../../hooks/useAuth'

interface Props {
  open:    boolean
  onClose: () => void
}

type Phase = 'warning' | 'reauth' | 'confirm' | 'async'

function daysUntil(iso: string | null): number {
  if (!iso) return 30
  const ms = new Date(iso).getTime() - Date.now()
  return Math.max(0, Math.ceil(ms / (1000 * 60 * 60 * 24)))
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
}

export function DeleteOrgModal({ open, onClose }: Props) {
  const orgName      = useOrgStore(s => s.orgName) ?? ''
  const currentOrgId = useOrgStore(s => s.orgId)
  const memberships  = useOrgStore(s => s.memberships)
  const del          = useOrgDeletion()
  const { switchOrg } = useOrgSwitch()
  const navigate     = useNavigate()

  const [phase,   setPhase]   = useState<Phase>('warning')
  const [pw,      setPw]      = useState('')
  const [showPw,  setShowPw]  = useState(false)
  const [typed,   setTyped]   = useState('')
  const [loading, setLoading] = useState(false)

  // Other active orgs the user can switch to after deletion
  const activeAlternativeOrgs = memberships.filter(
    m => m.org_id !== currentOrgId && m.org_status !== 'pending_deletion'
  )

  // Reset all local state when modal opens/closes
  useEffect(() => {
    if (!open) {
      del.reset()
      setPhase('warning')
      setPw('')
      setTyped('')
      setLoading(false)
    }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  // Forward async step transitions to 'async' phase
  useEffect(() => {
    if (
      del.step === 'generating_backup' ||
      del.step === 'backup_ready'      ||
      del.step === 'submitting'        ||
      del.step === 'done'              ||
      del.step === 'error'
    ) {
      setPhase('async')
    }
  }, [del.step])

  const isProcessing =
    del.step === 'generating_backup' ||
    del.step === 'backup_ready'      ||
    del.step === 'submitting'

  // Disable close during processing and while showing the done state
  // (force explicit navigation choice after deletion is confirmed)
  const disableClose = isProcessing || del.step === 'done'

  // ── Post-deletion navigation handlers ────────────────────────────────────────

  const handleSwitchOrg = useCallback((m: OrgMembership) => {
    del.applyDeletion()
    switchOrg(m)
    onClose()
  }, [del, switchOrg, onClose])

  const handleCreateOrg = useCallback(() => {
    del.applyDeletion()
    onClose()
    navigate('/onboarding')
  }, [del, onClose, navigate])

  const handleViewLocked = useCallback(() => {
    del.applyDeletion()
    onClose()
    // OrgLockedGuard will render OrgLockedScreen once orgStatus is pending_deletion
  }, [del, onClose])

  // ── Form handlers ─────────────────────────────────────────────────────────────

  async function handleReAuth(e: React.FormEvent) {
    e.preventDefault()
    if (!pw.trim()) return
    setLoading(true)
    const ok = await del.reAuthenticate(pw)
    setLoading(false)
    if (ok) { setPw(''); setPhase('confirm') }
  }

  async function handleConfirm(e: React.FormEvent) {
    e.preventDefault()
    if (typed !== orgName) return
    setPhase('async')
    await del.generateAndSubmit(typed)
  }

  // ── Derived display ───────────────────────────────────────────────────────────

  const title =
    phase === 'warning'     ? 'Delete Organisation'     :
    phase === 'reauth'      ? 'Confirm Your Identity'   :
    phase === 'confirm'     ? 'Type Organisation Name'  :
    del.step === 'done'     ? 'Deletion Scheduled'      :
    del.step === 'error'    ? 'Deletion Failed'         :
                              'Preparing Deletion…'

  const nameMatches = typed === orgName
  const days        = daysUntil(del.purgeAt)
  const dateStr     = formatDate(del.purgeAt)

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="max-w-md"
      headerExtra={<Trash2 className="w-5 h-5 text-red-500" />}
      disableClose={disableClose}
    >
      {/* ── Phase: Warning ─────────────────────────────────────────────────── */}
      {phase === 'warning' && (
        <div className="space-y-5">
          <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 dark:border-red-900/40 dark:bg-red-950/30 p-4">
            <ShieldAlert className="w-6 h-6 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-red-800 dark:text-red-300">This will lock your organisation</p>
              <p className="mt-1 text-sm text-red-700 dark:text-red-400">
                Deleting <span className="font-semibold">{orgName}</span> is irreversible after 30 days.
                All members will lose access immediately.
              </p>
            </div>
          </div>

          <div className="text-sm text-gray-700 dark:text-gray-300 space-y-3">
            <div>
              <p className="font-medium text-gray-900 dark:text-gray-100 mb-1">What happens immediately:</p>
              <ul className="list-disc pl-5 space-y-1">
                <li>Organisation is locked — no member access</li>
                <li>A full data backup is generated and downloaded</li>
                <li>30-day restore window begins</li>
              </ul>
            </div>
            <div>
              <p className="font-medium text-gray-900 dark:text-gray-100 mb-1">After 30 days:</p>
              <ul className="list-disc pl-5 space-y-1 text-red-600 dark:text-red-400">
                <li>All transactions, banks, categories and reports are permanently deleted</li>
                <li>All members and settings are permanently deleted</li>
                <li>This cannot be undone</li>
              </ul>
            </div>
          </div>

          <button
            onClick={() => setPhase('reauth')}
            className="w-full rounded-lg bg-red-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-700 active:bg-red-800 transition-colors"
          >
            I understand — continue
          </button>
        </div>
      )}

      {/* ── Phase: Re-authentication ────────────────────────────────────────── */}
      {phase === 'reauth' && (
        <form onSubmit={handleReAuth} className="space-y-4">
          <p className="text-sm text-gray-700 dark:text-gray-300">
            Enter your password to confirm your identity before proceeding.
          </p>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Password
            </label>
            <div className="relative">
              <input
                type={showPw ? 'text' : 'password'}
                value={pw}
                onChange={e => setPw(e.target.value)}
                autoFocus
                className="w-full rounded-lg border border-gray-300 dark:border-white/[0.10] bg-white dark:bg-[#141416] px-3 py-2 pr-10 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-red-500"
                placeholder="Your account password"
              />
              <button
                type="button"
                onClick={() => setShowPw(v => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
              >
                {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            {del.error && (
              <p className="mt-1.5 text-xs text-red-600 dark:text-red-400">{del.error}</p>
            )}
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setPhase('warning')}
              className="flex-1 rounded-lg border border-gray-300 dark:border-white/[0.10] px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
            >
              Back
            </button>
            <button
              type="submit"
              disabled={loading || !pw.trim()}
              className="flex-1 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              {loading ? 'Verifying…' : 'Verify'}
            </button>
          </div>
        </form>
      )}

      {/* ── Phase: Confirm name ─────────────────────────────────────────────── */}
      {phase === 'confirm' && (
        <form onSubmit={handleConfirm} className="space-y-4">
          <div className="rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-900/40 dark:bg-amber-950/30 p-3">
            <p className="text-sm text-amber-800 dark:text-amber-300">
              A full backup will be generated and automatically downloaded to your device before deletion is submitted.
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Type <span className="font-bold text-gray-900 dark:text-gray-100">{orgName}</span> to confirm
            </label>
            <input
              type="text"
              value={typed}
              onChange={e => setTyped(e.target.value)}
              autoFocus
              autoComplete="off"
              className={`w-full rounded-lg border px-3 py-2 text-sm bg-white dark:bg-[#141416] text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 transition-colors ${
                typed && !nameMatches
                  ? 'border-red-400 dark:border-red-600 focus:ring-red-400'
                  : nameMatches
                  ? 'border-green-400 dark:border-green-600 focus:ring-green-400'
                  : 'border-gray-300 dark:border-white/[0.10] focus:ring-red-500'
              }`}
              placeholder="Organisation name"
            />
            {del.error && (
              <p className="mt-1.5 text-xs text-red-600 dark:text-red-400">{del.error}</p>
            )}
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setPhase('reauth')}
              className="flex-1 rounded-lg border border-gray-300 dark:border-white/[0.10] px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
            >
              Back
            </button>
            <button
              type="submit"
              disabled={!nameMatches}
              className="flex-1 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Generate backup &amp; delete
            </button>
          </div>
        </form>
      )}

      {/* ── Phase: Async (loading / done / error) ───────────────────────────── */}
      {phase === 'async' && (
        <>
          {isProcessing && (
            <div className="flex flex-col items-center gap-4 py-8 text-center">
              <Loader2 className="w-10 h-10 animate-spin text-red-500" />
              <div>
                <p className="font-semibold text-gray-900 dark:text-gray-100">
                  {del.step === 'generating_backup' ? 'Generating backup…'    :
                   del.step === 'backup_ready'      ? 'Uploading backup…'     :
                                                      'Submitting request…'}
                </p>
                <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                  {del.step === 'generating_backup'
                    ? 'Exporting all organisation data. This may take a moment.'
                    : 'Almost done — do not close this window.'}
                </p>
              </div>
            </div>
          )}

          {del.step === 'done' && (
            <div className="space-y-5">
              {/* Status banner */}
              <div className="rounded-lg border border-orange-200 bg-orange-50 dark:border-orange-900/40 dark:bg-orange-950/30 p-4">
                <p className="font-semibold text-orange-800 dark:text-orange-300">
                  Organisation locked — deletion in {days} day{days !== 1 ? 's' : ''}
                </p>
                <p className="mt-1 text-sm text-orange-700 dark:text-orange-400">
                  Permanent deletion scheduled for <span className="font-semibold">{dateStr}</span>.
                  You can restore before then.
                </p>
              </div>

              {/* Backup download */}
              <div className="rounded-lg border border-gray-200 dark:border-white/[0.07] bg-gray-50 dark:bg-[#141416] p-3 space-y-2">
                <p className="text-xs font-medium text-gray-700 dark:text-gray-300">
                  Your backup was downloaded automatically.
                </p>
                <button
                  onClick={del.downloadBackupNow}
                  className="w-full flex items-center justify-center gap-2 rounded-lg border border-gray-300 dark:border-white/[0.10] px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                >
                  <Download className="w-4 h-4" />
                  Download again (.json)
                </button>
              </div>

              {/* Navigation — switch org or create new */}
              <div className="space-y-2">
                <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                  {activeAlternativeOrgs.length > 0 ? 'Continue with another organisation' : 'Next steps'}
                </p>

                {activeAlternativeOrgs.map(m => (
                  <button
                    key={m.org_id}
                    onClick={() => handleSwitchOrg(m)}
                    className="w-full flex items-center gap-3 rounded-lg border border-gray-200 dark:border-white/[0.07] bg-white dark:bg-[#0c0c0e] px-4 py-3 text-left hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                  >
                    <Building2 className="w-4 h-4 text-gray-400 shrink-0" />
                    <span className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">
                      {m.org_name}
                    </span>
                  </button>
                ))}

                <button
                  onClick={handleCreateOrg}
                  className="w-full flex items-center gap-3 rounded-lg border border-dashed border-gray-300 dark:border-white/[0.10] px-4 py-3 text-left hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                >
                  <PlusCircle className="w-4 h-4 text-gray-400 shrink-0" />
                  <span className="text-sm font-medium text-gray-600 dark:text-gray-400">
                    Create a new organisation
                  </span>
                </button>

                {activeAlternativeOrgs.length === 0 && (
                  <button
                    onClick={handleViewLocked}
                    className="w-full rounded-lg border border-gray-300 dark:border-white/[0.10] px-4 py-2.5 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                  >
                    View locked organisation
                  </button>
                )}
              </div>
            </div>
          )}

          {del.step === 'error' && (
            <div className="space-y-4">
              <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 dark:border-red-900/40 dark:bg-red-950/30 p-4">
                <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
                <p className="text-sm text-red-700 dark:text-red-300">{del.error}</p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => { del.reset(); setPhase('warning'); setTyped('') }}
                  className="flex-1 rounded-lg border border-gray-300 dark:border-white/[0.10] px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                >
                  Start over
                </button>
                <button
                  onClick={onClose}
                  className="flex-1 rounded-lg bg-gray-800 dark:bg-gray-200 px-4 py-2 text-sm font-semibold text-white dark:text-gray-900"
                >
                  Close
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </Modal>
  )
}
