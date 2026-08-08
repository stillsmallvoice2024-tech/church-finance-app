import { useState, useRef, useCallback } from 'react'
import {
  Upload, AlertTriangle, CheckCircle2, XCircle, Loader2, ShieldAlert, Info, ChevronDown,
} from 'lucide-react'
import { Modal } from '../ui/Modal'
import { useToastStore } from '../../store/toastStore'
import { useOrgStore } from '../../store/orgStore'
import { useAuthStore } from '../../store/authStore'
import {
  MANAGED_TABLES,
  parseBackupFile,
  validateBackup,
  getRestoreSummary,
  restoreFromBackup,
  preflightReplace,
  isAtomicRestoreAvailable,
  createBackup,
  downloadBackup,
  ATOMIC_RESTORE_MIGRATION,
  type ReplacePreflight,
  type BackupFileV2,
  type RestoreSummaryV2,
  type RestoreResultV2,
  type TableProgress,
  type RestoreMode,
} from '../../utils/backupRestore'

type Step = 'select' | 'preview' | 'confirm' | 'restoring' | 'done'
type Mode = 'merge' | 'replace'
type SnapshotState = 'idle' | 'running' | 'done' | 'error'

interface Props {
  open:    boolean
  onClose: () => void
  onDone?: () => void
}

const MODULE_ORDER = ['Transactions', 'Configuration', 'Allocation', 'Projects', 'Reports', 'Reconciliation', 'Audit']

/** Typed exactly to unlock a replace that the preflight says will lose rows. */
const ACK_PHRASE = 'DELETE'

const RESTORE_MODE_COLORS: Record<RestoreMode, string> = {
  replace: 'bg-red-50 text-red-600',
  merge:   'bg-blue-50 text-blue-600',
  append:  'bg-green-50 text-green-700',
}

export function RestoreModal({ open, onClose, onDone }: Props) {
  const { push: toast } = useToastStore()
  const orgId = useOrgStore(s => s.orgId)
  const user  = useAuthStore(s => s.user)

  const [step,             setStep]             = useState<Step>('select')
  const [mode,             setMode]             = useState<Mode>('merge')
  const [restoreUnmanaged, setRestoreUnmanaged] = useState(false)
  const [showUnmanaged,    setShowUnmanaged]    = useState(false)
  const [backup,           setBackup]           = useState<BackupFileV2 | null>(null)
  const [summary,          setSummary]          = useState<RestoreSummaryV2 | null>(null)
  const [fileErr,          setFileErr]          = useState<string | null>(null)
  const [items,            setItems]            = useState<TableProgress[]>([])
  const [result,           setResult]           = useState<RestoreResultV2 | null>(null)
  const [loading,          setLoading]          = useState(false)
  const [preflight,        setPreflight]        = useState<ReplacePreflight | null>(null)
  const [preflightLoading, setPreflightLoading] = useState(false)
  const [preflightErr,     setPreflightErr]     = useState<string | null>(null)
  const [ack,              setAck]              = useState('')
  const [atomic,           setAtomic]           = useState<boolean | null>(null)
  const [snapshotState,    setSnapshotState]    = useState<SnapshotState>('idle')
  const [snapshotErr,      setSnapshotErr]      = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const reset = () => {
    setStep('select')
    setMode('merge')
    setRestoreUnmanaged(false)
    setShowUnmanaged(false)
    setBackup(null)
    setSummary(null)
    setFileErr(null)
    setItems([])
    setResult(null)
    setLoading(false)
    setPreflight(null)
    setPreflightLoading(false)
    setPreflightErr(null)
    setAck('')
    setAtomic(null)
    setSnapshotState('idle')
    setSnapshotErr(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  // Two independent checks before any destructive replace:
  //   1. preflight — compares live row counts against what the backup carries,
  //      so a truncated or stale file cannot silently delete the difference.
  //   2. atomic    — whether commit_restore() exists. Without it the delete and
  //      the insert cannot share a transaction and replace stays disabled.
  const goToConfirm = async () => {
    setStep('confirm')
    setAck('')
    setPreflight(null)
    setPreflightErr(null)
    setSnapshotState('idle')
    setSnapshotErr(null)
    if (mode !== 'replace' || !backup || !orgId) return
    setPreflightLoading(true)
    try {
      const [pf, hasRpc] = await Promise.all([
        preflightReplace(backup, orgId),
        isAtomicRestoreAvailable(),
      ])
      setPreflight(pf)
      setAtomic(hasRpc)
    } catch (e) {
      setPreflightErr(e instanceof Error ? e.message : 'Could not verify live row counts')
    } finally {
      setPreflightLoading(false)
    }
  }

  // Rollback path for the one failure the transaction cannot cover: restoring
  // the *wrong* file. Atomicity guarantees the commit is all-or-nothing, not
  // that the operator picked the right backup.
  const takeSafetySnapshot = async () => {
    if (!orgId || !user) return
    setSnapshotState('running')
    setSnapshotErr(null)
    try {
      const snap = await createBackup(user.id, user.email ?? 'unknown', undefined, undefined, orgId)
      downloadBackup(snap)
      setSnapshotState('done')
    } catch (e) {
      setSnapshotState('error')
      setSnapshotErr(e instanceof Error ? e.message : 'Snapshot failed')
    }
  }

  const handleClose = () => {
    if (step !== 'restoring') { reset(); onClose() }
  }

  const upsertItem = useCallback((
    section: TableProgress['section'],
    key: string,
    status: TableProgress['status'],
    count?: number,
  ) => {
    setItems(prev => {
      const idx = prev.findIndex(it => it.key === key)
      const def = MANAGED_TABLES.find(t => t.key === key)
      const label = def?.label ?? key
      const updated: TableProgress = { key, label, section, status, ...(count !== undefined ? { count } : {}) }
      if (idx === -1) return [...prev, updated]
      return prev.map((it, i) => i === idx ? { ...it, ...updated } : it)
    })
  }, [])

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setFileErr(null)
    setLoading(true)
    try {
      const parsed = await parseBackupFile(file)
      const { valid, errors } = validateBackup(parsed)
      if (!valid) { setFileErr(errors.join('; ')); setLoading(false); return }
      setSummary(getRestoreSummary(parsed))
      setBackup(parsed)
      setStep('preview')
    } catch (e) {
      setFileErr(e instanceof Error ? e.message : 'Could not read file')
    } finally {
      setLoading(false)
    }
  }

  const handleRestore = async () => {
    if (!backup) return
    if (!orgId) { toast('No active organisation — cannot restore.', 'error'); return }
    setStep('restoring')

    // Pre-populate managed progress items
    const managedActive = MANAGED_TABLES.filter(
      def => Array.isArray(backup.managed[def.key]) && (backup.managed[def.key]?.length ?? 0) > 0,
    )
    const unmanagedActive = restoreUnmanaged
      ? Object.entries(backup.unmanaged ?? {}).filter(([, rows]) => rows.length > 0).map(([k]) => k)
      : []

    setItems([
      ...managedActive.map(def => ({
        key: def.key, label: def.label, section: 'managed' as const, status: 'pending' as const,
      })),
      ...unmanagedActive.map(k => ({
        key: k, label: k, section: 'unmanaged' as const, status: 'pending' as const,
      })),
    ])

    try {
      const res = await restoreFromBackup(
        backup,
        { mode, restoreUnmanaged, acknowledgeDataLoss: ack.trim().toUpperCase() === ACK_PHRASE },
        orgId,
        (section, key, status, count) => upsertItem(section, key, status, count),
      )
      setResult(res)
      setStep('done')
      if (res.success) {
        toast('Restore completed successfully', 'success')
        onDone?.()
      }
    } catch (e) {
      setResult({
        success: false,
        managedRestored: [],
        unmanagedRestored: [],
        errors: [{ table: 'unknown', section: 'managed', message: e instanceof Error ? e.message : 'Restore failed' }],
      })
      setStep('done')
    }
  }

  const groupedManaged = summary
    ? MODULE_ORDER.map(mod => ({
        module: mod,
        tables: summary.managedTables.filter(t => {
          const def = MANAGED_TABLES.find(d => d.key === t.key)
          return def?.module === mod && t.count > 0
        }),
      })).filter(g => g.tables.length > 0)
    : []

  // Replace is blocked until: the atomic path is confirmed present, the
  // preflight has run and either cleared the backup or been explicitly
  // acknowledged, and a safety snapshot has been taken. Merge is never blocked —
  // it only ever upserts.
  const restoreBlocked =
    mode === 'replace' &&
    (preflightLoading ||
      !!preflightErr ||
      !preflight ||
      atomic !== true ||
      snapshotState !== 'done' ||
      (!preflight.safe && ack.trim().toUpperCase() !== ACK_PHRASE))

  const managedItems   = items.filter(it => it.section === 'managed')
  const unmanagedItems = items.filter(it => it.section === 'unmanaged')
  const managedErrors   = result?.errors.filter(e => e.section === 'managed') ?? []
  const unmanagedErrors = result?.errors.filter(e => e.section === 'unmanaged') ?? []

  return (
    <Modal
      open={open}
      onClose={() => { if (step !== 'restoring') handleClose() }}
      title="Restore Backup"
      size="max-w-lg"
    >
      <div className="space-y-4">

        {/* ── Step 1: File select ── */}
        {step === 'select' && (
          <>
            <p className="text-sm text-gray-600">
              Upload an Organisation Finance backup file (<code className="text-xs bg-gray-100 px-1 rounded">.json</code>) to restore your account.
            </p>

            <label className="flex flex-col items-center justify-center gap-3 border-2 border-dashed border-gray-200 rounded-xl p-8 cursor-pointer hover:border-primary/40 hover:bg-primary/5 transition-colors">
              <Upload className="w-8 h-8 text-gray-300" />
              <div className="text-center">
                <p className="text-sm font-medium text-gray-700">Click to choose backup file</p>
                <p className="text-xs text-gray-500 mt-0.5">organisation-finance-backup-*.json</p>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".json,application/json"
                onChange={handleFileChange}
                className="sr-only"
              />
            </label>

            {loading && (
              <div className="flex items-center gap-2 text-sm text-gray-500">
                <Loader2 className="w-4 h-4 animate-spin" /> Parsing file…
              </div>
            )}
            {fileErr && (
              <div className="flex items-start gap-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2.5 text-sm text-red-700">
                <XCircle className="w-4 h-4 shrink-0 mt-0.5" /> {fileErr}
              </div>
            )}

            <div className="flex justify-end">
              <button onClick={handleClose} className="px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50">Cancel</button>
            </div>
          </>
        )}

        {/* ── Step 2: Preview ── */}
        {step === 'preview' && summary && (
          <>
            {/* Backup info */}
            <div className="rounded-xl bg-blue-50 border border-blue-200 px-4 py-3 space-y-1.5">
              <div className="flex items-center gap-2">
                <Info className="w-4 h-4 text-blue-600 shrink-0" />
                <span className="text-sm font-semibold text-blue-800">Backup Summary</span>
              </div>
              <div className="text-xs text-blue-700 space-y-0.5 pl-6">
                <p><span className="font-medium">Date:</span> {new Date(summary.backupDate).toLocaleString()}</p>
                <p><span className="font-medium">Backed up by:</span> {summary.userEmail}</p>
                <p><span className="font-medium">App version:</span> {summary.appVersion}</p>
                <p><span className="font-medium">Managed records:</span> {summary.totalManagedRecords.toLocaleString()}</p>
                {summary.totalUnmanagedRecords > 0 && (
                  <p><span className="font-medium">Unmanaged records:</span> {summary.totalUnmanagedRecords.toLocaleString()}</p>
                )}
                <p><span className="font-medium">Modules:</span> {summary.modules.join(', ')}</p>
              </div>
            </div>

            {/* Backup warnings */}
            {summary.warnings.length > 0 && (
              <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2.5 space-y-1">
                {summary.warnings.map((w, i) => (
                  <p key={i} className="text-xs text-amber-800 flex items-start gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" /> {w}
                  </p>
                ))}
              </div>
            )}

            {/* Managed tables by module */}
            <div className="space-y-2">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
                Supported restore — {summary.totalManagedRecords.toLocaleString()} records
              </p>
              {groupedManaged.map(g => (
                <div key={g.module} className="rounded-lg border border-gray-100 overflow-hidden">
                  <div className="px-3 py-2 bg-gray-50 text-xs font-semibold text-gray-600">{g.module}</div>
                  <div className="divide-y divide-gray-50">
                    {g.tables.map(t => {
                      const def = MANAGED_TABLES.find(d => d.key === t.key)
                      return (
                        <div key={t.key} className="flex items-center justify-between px-3 py-1.5 text-sm">
                          <span className="text-gray-700">{t.label}</span>
                          <div className="flex items-center gap-2">
                            {def && (
                              <span className={`text-xs font-semibold px-1.5 py-0.5 rounded-full ${RESTORE_MODE_COLORS[def.restoreMode]}`}>
                                {def.restoreMode}
                              </span>
                            )}
                            <span className="font-mono text-xs text-gray-500">{t.count.toLocaleString()}</span>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>

            {/* Unmanaged tables section */}
            {summary.unmanagedTables.length > 0 && (
              <div className="rounded-lg border border-amber-200 overflow-hidden">
                <button
                  onClick={() => setShowUnmanaged(v => !v)}
                  className="w-full flex items-center justify-between px-3 py-2.5 bg-amber-50 text-left"
                >
                  <span className="text-xs font-semibold text-amber-800">
                    Unmanaged tables — {summary.totalUnmanagedRecords.toLocaleString()} records
                    <span className="ml-1.5 text-xs font-normal text-amber-600">(raw, unverified)</span>
                  </span>
                  <ChevronDown className={`w-3.5 h-3.5 text-amber-600 transition-transform ${showUnmanaged ? 'rotate-180' : ''}`} />
                </button>
                {showUnmanaged && (
                  <div className="divide-y divide-amber-100">
                    {summary.unmanagedTables.map(t => (
                      <div key={t.key} className="flex items-center justify-between px-3 py-1.5 text-sm bg-white">
                        <span className="font-mono text-xs text-gray-600">{t.key}</span>
                        <span className="font-mono text-xs text-gray-500">{t.count.toLocaleString()}</span>
                      </div>
                    ))}
                  </div>
                )}
                {/* Unmanaged restore toggle */}
                <div className="px-3 py-2.5 bg-amber-50/60 border-t border-amber-100">
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={restoreUnmanaged}
                      onChange={e => setRestoreUnmanaged(e.target.checked)}
                      className="w-4 h-4 accent-amber-600"
                    />
                    <div>
                      <p className="text-xs font-semibold text-amber-800">Attempt advanced restore for unmanaged tables</p>
                      <p className="text-xs text-amber-700 mt-0.5">Runs after managed restore, fully isolated. Failures will not affect managed data.</p>
                    </div>
                  </label>
                </div>
              </div>
            )}

            {/* Mode selector */}
            <div className="space-y-2">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Restore Mode</p>
              <div className="space-y-2">
                <label className={`flex items-start gap-3 cursor-pointer rounded-xl border-2 px-4 py-3 transition-colors ${mode === 'merge' ? 'border-primary bg-primary/5' : 'border-gray-200 hover:border-gray-300'}`}>
                  <input type="radio" name="restore-mode" value="merge" checked={mode === 'merge'} onChange={() => setMode('merge')} className="mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-gray-900">Merge</p>
                    <p className="text-xs text-gray-500 mt-0.5">Add backup records alongside existing data. Same-ID conflicts are skipped.</p>
                  </div>
                </label>
                <label className={`flex items-start gap-3 cursor-pointer rounded-xl border-2 px-4 py-3 transition-colors ${mode === 'replace' ? 'border-danger bg-red-50' : 'border-gray-200 hover:border-gray-300'}`}>
                  <input type="radio" name="restore-mode" value="replace" checked={mode === 'replace'} onChange={() => setMode('replace')} className="mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-gray-900">Replace</p>
                    <p className="text-xs text-gray-500 mt-0.5">Delete all existing data first, then restore from backup. <span className="text-danger font-medium">Irreversible.</span></p>
                  </div>
                </label>
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-2 border-t border-gray-100">
              <button onClick={reset} className="px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50">Back</button>
              <button onClick={goToConfirm} className="px-4 py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary-dark">Continue</button>
            </div>
          </>
        )}

        {/* ── Step 3: Confirm ── */}
        {step === 'confirm' && (
          <>
            {mode === 'replace' ? (
              <div className="flex items-start gap-3 rounded-xl bg-red-50 border border-red-200 px-4 py-3">
                <ShieldAlert className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
                <div className="text-sm text-red-700 space-y-1">
                  <p className="font-semibold">Replace mode will delete all existing data</p>
                  <p>All current transactions, categories, banks, distribution rules, and project entries will be permanently removed before backup data is applied. Receipts, audit logs, field-change history, and allocation snapshots are preserved.</p>
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-3 rounded-xl bg-amber-50 border border-amber-200 px-4 py-3">
                <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                <div className="text-sm text-amber-700 space-y-1">
                  <p className="font-semibold">Merge mode — existing records are preserved</p>
                  <p>Records with IDs that already exist are skipped. Only new records from the backup will be added.</p>
                </div>
              </div>
            )}

            {restoreUnmanaged && (summary?.unmanagedTables.length ?? 0) > 0 && (
              <div className="flex items-start gap-3 rounded-xl bg-amber-50 border border-amber-200 px-4 py-3">
                <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                <div className="text-sm text-amber-700 space-y-1">
                  <p className="font-semibold">Advanced restore enabled for unmanaged tables</p>
                  <p>{summary?.unmanagedTables.length} unmanaged table(s) will be restored after managed data. Each failure is isolated and will not corrupt managed results.</p>
                </div>
              </div>
            )}

            {/* Replace-mode preflight: live counts vs. what the backup carries */}
            {mode === 'replace' && preflightLoading && (
              <div className="flex items-center gap-2 text-sm text-gray-500">
                <Loader2 className="w-4 h-4 animate-spin" /> Checking live row counts…
              </div>
            )}

            {/* Transaction availability — replace is refused without it */}
            {mode === 'replace' && atomic === false && (
              <div className="flex items-start gap-2 rounded-xl bg-red-50 border-2 border-red-300 px-4 py-3 text-sm text-red-700">
                <ShieldAlert className="w-5 h-5 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p className="font-semibold">Replace is unavailable on this database</p>
                  <p className="text-xs">
                    Atomic restore is not installed, so the delete and the insert cannot be committed
                    together — an interruption would leave the ledger half-restored. Run migration{' '}
                    <code className="bg-red-100 px-1 rounded">{ATOMIC_RESTORE_MIGRATION}</code>, or use
                    merge mode, which never deletes.
                  </p>
                </div>
              </div>
            )}

            {mode === 'replace' && atomic === true && (
              <div className="flex items-start gap-2 rounded-lg bg-green-50 border border-green-200 px-3 py-2.5 text-sm text-green-700">
                <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                Atomic restore available — the delete and the insert commit as one transaction, so a
                failure at any point leaves your current data untouched.
              </div>
            )}

            {/* Safety snapshot — the rollback path for restoring the wrong file */}
            {mode === 'replace' && atomic === true && (
              <div className="rounded-xl border border-gray-200 px-4 py-3 space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="text-sm">
                    <p className="font-medium text-gray-900">Safety snapshot</p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      Downloads your current data before anything is replaced. Required — it is the
                      only way back if this turns out to be the wrong backup file.
                    </p>
                  </div>
                  <button
                    onClick={takeSafetySnapshot}
                    disabled={snapshotState === 'running' || snapshotState === 'done'}
                    className="shrink-0 px-3 py-1.5 text-xs font-medium text-white bg-gray-700 rounded-lg hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {snapshotState === 'running' ? 'Exporting…' : snapshotState === 'done' ? 'Saved' : 'Download'}
                  </button>
                </div>

                {snapshotState === 'done' && (
                  <p className="flex items-center gap-1.5 text-xs text-green-700">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Snapshot downloaded — keep it until you have verified the restore.
                  </p>
                )}
                {snapshotState === 'error' && (
                  <p className="flex items-start gap-1.5 text-xs text-red-700">
                    <XCircle className="w-3.5 h-3.5 shrink-0 mt-px" /> {snapshotErr}
                  </p>
                )}
              </div>
            )}

            {mode === 'replace' && preflightErr && (
              <div className="flex items-start gap-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2.5 text-sm text-red-700">
                <XCircle className="w-4 h-4 shrink-0 mt-0.5" /> {preflightErr}
              </div>
            )}

            {mode === 'replace' && preflight && preflight.safe && (
              <div className="flex items-start gap-2 rounded-lg bg-green-50 border border-green-200 px-3 py-2.5 text-sm text-green-700">
                <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                Verified: the backup covers every row currently stored. No data will be lost.
              </div>
            )}

            {mode === 'replace' && preflight && !preflight.safe && (
              <div className="rounded-xl bg-red-50 border-2 border-red-300 px-4 py-3 space-y-2">
                <div className="flex items-start gap-2">
                  <ShieldAlert className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
                  <div className="text-sm text-red-700">
                    <p className="font-semibold">
                      This backup is smaller than your live data — {preflight.totalShortfall.toLocaleString()} row(s) would be permanently deleted
                    </p>
                    <p className="text-xs mt-0.5">
                      The backup may be truncated, stale, or from another organisation. Merge mode carries no such risk.
                    </p>
                  </div>
                </div>

                {preflight.shortfalls.length > 0 && (
                  <div className="rounded-lg border border-red-200 bg-white overflow-hidden">
                    <div className="grid grid-cols-3 px-3 py-1.5 bg-red-100/60 text-xs font-semibold text-red-800">
                      <span>Table</span><span className="text-right">Live</span><span className="text-right">In backup</span>
                    </div>
                    <div className="divide-y divide-red-50 max-h-40 overflow-y-auto">
                      {preflight.shortfalls.map(t => (
                        <div key={t.key} className="grid grid-cols-3 px-3 py-1.5 text-xs">
                          <span className="text-gray-700 truncate">{t.label}</span>
                          <span className="text-right font-mono text-gray-700">{t.liveRows.toLocaleString()}</span>
                          <span className="text-right font-mono text-red-600 font-semibold">{t.backupRows.toLocaleString()}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {preflight.unreadable.length > 0 && (
                  <p className="text-xs text-red-700">
                    Live counts unavailable for: {preflight.unreadable.join(', ')}.
                  </p>
                )}

                <div>
                  <label className="text-xs font-semibold text-red-800">
                    Type <code className="bg-red-100 px-1 rounded">{ACK_PHRASE}</code> to confirm you accept this loss
                  </label>
                  <input
                    type="text"
                    value={ack}
                    onChange={e => setAck(e.target.value)}
                    placeholder={ACK_PHRASE}
                    className="mt-1 w-full px-3 py-2 text-sm border border-red-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-400"
                  />
                </div>
              </div>
            )}

            <p className="text-sm text-gray-600">
              Restoring <strong>{summary?.totalManagedRecords.toLocaleString()}</strong> managed records
              {restoreUnmanaged && (summary?.totalUnmanagedRecords ?? 0) > 0 && (
                <> and <strong>{summary?.totalUnmanagedRecords.toLocaleString()}</strong> unmanaged records</>
              )}{' '}
              in <strong>{mode}</strong> mode.
            </p>

            <div className="flex justify-end gap-3 pt-2 border-t border-gray-100">
              <button onClick={() => setStep('preview')} className="px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50">Back</button>
              <button
                onClick={handleRestore}
                disabled={restoreBlocked}
                className={`px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${mode === 'replace' ? 'bg-danger hover:bg-red-700' : 'bg-primary hover:bg-primary-dark'}`}
              >
                Restore Now
              </button>
            </div>
          </>
        )}

        {/* ── Step 4: Restoring ── */}
        {step === 'restoring' && (
          <>
            <p className="text-sm text-gray-600">Restoring data. Do not close this window.</p>

            {managedItems.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide px-0.5">Supported restore</p>
                <ProgressList items={managedItems} />
              </div>
            )}
            {unmanagedItems.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-semibold text-amber-500 uppercase tracking-wide px-0.5">Advanced restore</p>
                <ProgressList items={unmanagedItems} />
              </div>
            )}
          </>
        )}

        {/* ── Step 5: Done ── */}
        {step === 'done' && result && (
          <>
            {result.success ? (
              <div className="flex items-start gap-3 rounded-xl bg-green-50 border border-green-200 px-4 py-3">
                <CheckCircle2 className="w-5 h-5 text-green-600 shrink-0 mt-0.5" />
                <div className="text-sm text-green-700 space-y-1">
                  <p className="font-semibold">Restore completed successfully</p>
                  <p>All managed records restored. Refresh the page to see your data.</p>
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-3 rounded-xl bg-red-50 border border-red-200 px-4 py-3">
                <XCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
                <div className="text-sm text-red-700 space-y-1">
                  <p className="font-semibold">
                    {result.partiallyApplied ? 'Restore aborted part-way' : 'Restore failed — no data was changed'}
                  </p>
                  <p className="text-xs">
                    {result.partiallyApplied
                      ? 'This database is not on the atomic restore path, so some tables may already have been written. Compare against your safety snapshot before retrying.'
                      : 'The restore ran as a single transaction and was rolled back in full. Your existing data is exactly as it was.'}
                  </p>
                  {managedErrors.length > 0 && (
                    <>
                      <p className="text-xs font-semibold">Managed failures:</p>
                      <ul className="list-disc pl-4 space-y-0.5 text-xs">
                        {managedErrors.slice(0, 5).map((e, i) => <li key={i}>{e.table}: {e.message}</li>)}
                        {managedErrors.length > 5 && <li>…and {managedErrors.length - 5} more</li>}
                      </ul>
                    </>
                  )}
                  {unmanagedErrors.length > 0 && (
                    <>
                      <p className="text-xs font-semibold mt-1">Unmanaged failures (isolated):</p>
                      <ul className="list-disc pl-4 space-y-0.5 text-xs">
                        {unmanagedErrors.slice(0, 3).map((e, i) => <li key={i}>{e.table}: {e.message}</li>)}
                      </ul>
                    </>
                  )}
                </div>
              </div>
            )}

            {/* Result summary */}
            {managedItems.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide px-0.5">Supported restore</p>
                <ProgressList items={managedItems} compact />
              </div>
            )}
            {unmanagedItems.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-semibold text-amber-500 uppercase tracking-wide px-0.5">Advanced restore</p>
                <ProgressList items={unmanagedItems} compact />
              </div>
            )}

            <div className="flex justify-end gap-3 pt-2 border-t border-gray-100">
              {result.success && (
                <button onClick={() => window.location.reload()} className="px-4 py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary-dark">
                  Reload Page
                </button>
              )}
              <button onClick={handleClose} className="px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50">Close</button>
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}

// ── Shared progress list ───────────────────────────────────────────────────────

function ProgressList({ items, compact }: { items: TableProgress[]; compact?: boolean }) {
  return (
    <div className={`space-y-0.5 ${compact ? 'max-h-36' : 'max-h-52'} overflow-y-auto rounded-lg border border-gray-100 p-2.5 bg-gray-50`}>
      {items.map(item => (
        <div key={item.key} className="flex items-center gap-2.5 text-sm py-0.5">
          {item.status === 'pending' && <div className="w-4 h-4 rounded-full border-2 border-gray-200 shrink-0" />}
          {item.status === 'running' && <Loader2 className="w-4 h-4 text-primary animate-spin shrink-0" />}
          {item.status === 'done'    && <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" />}
          {item.status === 'error'   && <XCircle className="w-4 h-4 text-red-500 shrink-0" />}
          <span className={
            item.status === 'done'    ? 'text-gray-700' :
            item.status === 'error'   ? 'text-red-600' :
            item.status === 'running' ? 'text-gray-900 font-medium' :
            'text-gray-400'
          }>
            {item.label}
            {item.status === 'done' && item.count !== undefined && (
              <span className="ml-1.5 text-xs text-gray-500">({item.count.toLocaleString()} records)</span>
            )}
          </span>
        </div>
      ))}
    </div>
  )
}
