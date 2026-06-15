import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, Building2, Download, Loader2, PlusCircle, RefreshCw, ShieldOff } from 'lucide-react'
import { useOrgStore, type OrgMembership } from '../../store/orgStore'
import { useOrgDeletion } from '../../hooks/useOrgDeletion'
import { useOrgSwitch } from '../../hooks/useAuth'
import { useRole } from '../../hooks/useRole'

function daysUntil(iso: string | null): number {
  if (!iso) return 0
  const ms = new Date(iso).getTime() - Date.now()
  return Math.max(0, Math.ceil(ms / (1000 * 60 * 60 * 24)))
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
}

function downloadViaUrl(url: string, filename: string) {
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
}

export function OrgLockedScreen() {
  const { orgName, orgPurgeAt, orgDeletedAt, orgId, memberships } = useOrgStore()
  const { isOwner }   = useRole()
  const del           = useOrgDeletion()
  const { switchOrg } = useOrgSwitch()
  const navigate      = useNavigate()

  const [restoring,  setRestoring]  = useState(false)
  const [restoreErr, setRestoreErr] = useState<string | null>(null)
  const [restored,   setRestored]   = useState(false)

  const days    = daysUntil(orgPurgeAt)
  const dateStr = formatDate(orgPurgeAt)
  const owner   = isOwner()

  // Other active orgs the user can switch to (excluding this locked org)
  const activeOrgs: OrgMembership[] = memberships.filter(
    m => m.org_id !== orgId && m.org_status !== 'pending_deletion'
  )

  // Fetch a signed URL for the stored backup so the download button works
  useEffect(() => {
    if (owner) del.fetchSignedBackupUrl()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function handleSwitchOrg(m: OrgMembership) {
    switchOrg(m)
  }

  function handleDownload() {
    if (del.signedBackupUrl) {
      downloadViaUrl(del.signedBackupUrl, `${orgName ?? 'backup'}-deletion-backup.json`)
    } else if (del.backupReady) {
      del.downloadBackupNow()
    }
  }

  async function handleRestore() {
    setRestoring(true)
    setRestoreErr(null)
    try {
      await del.restoreOrg()
      setRestored(true)
      setTimeout(() => window.location.reload(), 1200)
    } catch (e) {
      setRestoreErr(e instanceof Error ? e.message : 'Restore failed')
    } finally {
      setRestoring(false)
    }
  }

  if (restored) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white dark:bg-[#0c0c0e] p-4">
        <div className="max-w-md w-full text-center space-y-4">
          <RefreshCw className="w-12 h-12 text-green-500 mx-auto" />
          <p className="text-lg font-semibold text-gray-900 dark:text-gray-100">Organisation restored!</p>
          <p className="text-sm text-gray-500 dark:text-gray-400">Reloading…</p>
        </div>
      </div>
    )
  }

  const downloadAvailable = !!(del.signedBackupUrl || del.backupReady)

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-[#0c0c0e] p-4">
      <div className="max-w-lg w-full">

        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-red-100 dark:bg-red-950/50 mb-4">
            <ShieldOff className="w-8 h-8 text-red-600 dark:text-red-400" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Organisation Locked</h1>
          <p className="mt-2 text-gray-600 dark:text-gray-400">
            <span className="font-semibold">{orgName}</span> has been scheduled for deletion
          </p>
        </div>

        {/* Switch / Create org panel */}
        <div className="rounded-xl border border-gray-200 dark:border-white/[0.07] bg-white dark:bg-[#0c0c0e] divide-y divide-gray-100 dark:divide-gray-800 overflow-hidden mb-6">
          {activeOrgs.length > 0 && (
            <div className="px-4 py-2">
              <p className="text-xs font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wide">
                Switch organisation
              </p>
            </div>
          )}
          {activeOrgs.map(m => (
            <button
              key={m.org_id}
              onClick={() => handleSwitchOrg(m)}
              className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
            >
              <Building2 className="w-4 h-4 text-gray-400 shrink-0" />
              <span className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate flex-1">
                {m.org_name}
              </span>
              <span className="text-xs text-blue-600 dark:text-blue-400 shrink-0">Switch</span>
            </button>
          ))}
          <button
            onClick={() => navigate('/onboarding?new=true')}
            className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
          >
            <PlusCircle className="w-4 h-4 text-gray-400 shrink-0" />
            <span className="text-sm font-medium text-gray-600 dark:text-gray-400">
              Create a new organisation
            </span>
          </button>
        </div>

        {/* Countdown */}
        <div className="rounded-xl border border-orange-200 bg-orange-50 dark:border-orange-900/40 dark:bg-orange-950/30 p-5 mb-6">
          <div className="text-center">
            <p className="text-4xl font-bold text-orange-700 dark:text-orange-300">{days}</p>
            <p className="text-sm text-orange-600 dark:text-orange-400 mt-1">
              day{days !== 1 ? 's' : ''} until permanent deletion
            </p>
            <p className="text-xs text-orange-500 dark:text-orange-500 mt-2">
              Scheduled for <span className="font-medium">{dateStr}</span>
              {orgDeletedAt && (
                <> · Requested on {formatDate(orgDeletedAt)}</>
              )}
            </p>
          </div>
        </div>

        {owner ? (
          /* Owner view: restore + download */
          <div className="space-y-3">
            <div className="rounded-lg border border-gray-200 dark:border-white/[0.07] bg-white dark:bg-[#0c0c0e] p-4 text-sm text-gray-600 dark:text-gray-400">
              <p className="font-medium text-gray-800 dark:text-gray-200 mb-2">You requested this deletion.</p>
              <p>You can restore the organisation and recover all data before {dateStr}.</p>
            </div>

            {restoreErr && (
              <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 dark:border-red-900/40 dark:bg-red-950/30 p-3">
                <AlertTriangle className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
                <p className="text-sm text-red-700 dark:text-red-300">{restoreErr}</p>
              </div>
            )}

            <button
              onClick={handleRestore}
              disabled={restoring || days === 0}
              className="w-full flex items-center justify-center gap-2 rounded-lg bg-green-600 px-4 py-3 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {restoring
                ? <><Loader2 className="w-4 h-4 animate-spin" /> Restoring…</>
                : <><RefreshCw className="w-4 h-4" /> Restore Organisation</>
              }
            </button>

            <button
              onClick={handleDownload}
              disabled={!downloadAvailable}
              className="w-full flex items-center justify-center gap-2 rounded-lg border border-gray-300 dark:border-white/[0.10] px-4 py-2.5 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
            >
              <Download className="w-4 h-4" />
              Download backup (.json)
            </button>

            <p className="text-center text-xs text-gray-500 dark:text-gray-500">
              {days === 0
                ? 'The restore window has passed. Organisation will be purged shortly.'
                : `Restore window closes on ${dateStr}.`}
            </p>
          </div>
        ) : (
          /* Non-owner view */
          <div className="rounded-lg border border-gray-200 dark:border-white/[0.07] bg-white dark:bg-[#0c0c0e] p-5 text-center space-y-3">
            <p className="text-sm text-gray-700 dark:text-gray-300">
              You no longer have access to <span className="font-semibold">{orgName}</span>.
            </p>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Contact the organisation owner if you believe this is an error.
            </p>
            {days > 0 && (
              <p className="text-xs text-gray-500 dark:text-gray-500">
                Data will be permanently deleted on {dateStr} unless restored by the owner.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
