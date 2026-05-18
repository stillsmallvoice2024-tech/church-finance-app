import { useState, useEffect, useCallback, useRef } from 'react'
import {
  CheckCircle2, XCircle, Loader2, Download, Link2, Copy, Check,
  AlertCircle, AlertTriangle, ChevronDown, ShieldCheck,
} from 'lucide-react'
import { Modal } from '../ui/Modal'
import { useAuth } from '../../hooks/useAuth'
import { useToastStore } from '../../store/toastStore'
import {
  MANAGED_TABLES,
  SCHEMA_DISCOVERY_MIGRATION_SQL,
  createBackup,
  downloadBackup,
  uploadBackupForLink,
  type BackupFileV2,
  type TableProgress,
} from '../../utils/backupRestore'

type Step = 'configuring' | 'collecting' | 'ready' | 'sharing' | 'link-ready' | 'error'

interface Props {
  open:    boolean
  onClose: () => void
}

const MANAGED_INITIAL: TableProgress[] = MANAGED_TABLES.filter(t => t.backupEnabled).map(def => ({
  key:     def.key,
  label:   def.label,
  section: 'managed' as const,
  status:  'pending' as const,
}))

export function BackupModal({ open, onClose }: Props) {
  const { user }         = useAuth()
  const { push: toast }  = useToastStore()

  const [step,           setStep]           = useState<Step>('configuring')
  const [strictMode,     setStrictMode]     = useState(false)
  const [items,          setItems]          = useState<TableProgress[]>(MANAGED_INITIAL)
  const [backup,         setBackup]         = useState<BackupFileV2 | null>(null)
  const [sharing,        setSharing]        = useState(false)
  const [link,           setLink]           = useState<string | null>(null)
  const [copied,         setCopied]         = useState(false)
  const [errMsg,         setErrMsg]         = useState<string | null>(null)
  const [showUnmanaged,  setShowUnmanaged]  = useState(false)
  const [showMigSQL,     setShowMigSQL]     = useState(false)
  const cancelRef = useRef(false)

  // Reset everything when modal closes
  useEffect(() => {
    if (!open) {
      cancelRef.current = true
      setStep('configuring')
      setStrictMode(false)
      setItems(MANAGED_INITIAL)
      setBackup(null)
      setLink(null)
      setCopied(false)
      setErrMsg(null)
      setShowUnmanaged(false)
      setShowMigSQL(false)
    } else {
      cancelRef.current = false
    }
  }, [open])

  const upsertItem = useCallback((
    section: TableProgress['section'],
    key: string,
    label: string,
    status: TableProgress['status'],
    count?: number,
  ) => {
    setItems(prev => {
      const idx = prev.findIndex(it => it.key === key)
      const updated = { key, label, section, status, ...(count !== undefined ? { count } : {}) }
      if (idx === -1) return [...prev, updated]
      return prev.map((it, i) => i === idx ? { ...it, ...updated } : it)
    })
  }, [])

  const startBackup = async () => {
    if (!user?.id || !user?.email) return
    cancelRef.current = false
    setStep('collecting')
    setItems(MANAGED_INITIAL)
    setBackup(null)
    setErrMsg(null)

    try {
      const result = await createBackup(
        user.id,
        user.email,
        { strictMode },
        (section, key, status, count) => {
          if (cancelRef.current) return
          const label = section === 'managed'
            ? (MANAGED_TABLES.find(t => t.key === key)?.label ?? key)
            : key
          upsertItem(section, key, label, status, count)
        },
      )
      if (!cancelRef.current) {
        setBackup(result)
        setStep('ready')
      }
    } catch (e) {
      if (!cancelRef.current) {
        setErrMsg(e instanceof Error ? e.message : 'Backup failed')
        setStep('error')
      }
    }
  }

  const handleDownload = () => {
    if (!backup) return
    downloadBackup(backup)
    toast('Backup downloaded', 'success')
    onClose()
  }

  const handleShareLink = async () => {
    if (!backup || !user?.id) return
    setSharing(true)
    setStep('sharing')
    try {
      const url = await uploadBackupForLink(backup, user.id)
      setLink(url)
      setStep('link-ready')
    } catch (e) {
      setErrMsg(e instanceof Error ? e.message : 'Could not generate link')
      setStep('error')
    } finally {
      setSharing(false)
    }
  }

  const handleCopyLink = async () => {
    if (!link) return
    await navigator.clipboard.writeText(link)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const managedItems   = items.filter(it => it.section === 'managed')
  const unmanagedItems = items.filter(it => it.section === 'unmanaged')
  const totalRecords   = items.reduce((s, it) => s + (it.count ?? 0), 0)
  const warnings       = backup?._meta.warnings ?? []
  const discoveryMissing = backup && !backup._meta.schemaDiscoveryAvailable

  const isCollecting = step === 'collecting'
  const isReady      = step === 'ready' || step === 'link-ready'

  return (
    <Modal
      open={open}
      onClose={() => { if (!isCollecting) onClose() }}
      title="Backup Account"
      size="max-w-lg"
    >
      <div className="space-y-4">

        {/* ── Step 1: Configure ── */}
        {step === 'configuring' && (
          <>
            <p className="text-sm text-gray-600">
              Create a complete backup of all account data — transactions, categories, banks, allocations, projects, and report templates.
            </p>

            {/* Strict mode */}
            <div className="rounded-xl border border-gray-200 px-4 py-3 space-y-1">
              <label className="flex items-center justify-between cursor-pointer gap-4">
                <div>
                  <p className="text-sm font-medium text-gray-900 flex items-center gap-1.5">
                    <ShieldCheck className="w-4 h-4 text-primary" />
                    Strict Mode
                  </p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    Fail the backup if unregistered tables are found. Recommended for production QA and release validation.
                  </p>
                </div>
                <button
                  role="switch"
                  aria-checked={strictMode}
                  onClick={() => setStrictMode(v => !v)}
                  className={`relative shrink-0 w-10 h-6 rounded-full transition-colors ${strictMode ? 'bg-primary' : 'bg-gray-200'}`}
                >
                  <span className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-transform ${strictMode ? 'translate-x-5' : 'translate-x-1'}`} />
                </button>
              </label>
            </div>

            <div className="flex justify-end gap-3 pt-2 border-t border-gray-100">
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={startBackup}
                className="px-4 py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary-dark"
              >
                Start Backup
              </button>
            </div>
          </>
        )}

        {/* ── Step 2: Collecting ── */}
        {(isCollecting || isReady) && (
          <>
            {isReady && (
              <p className="text-sm text-gray-600">
                Backup ready —{' '}
                <span className="font-medium">{totalRecords.toLocaleString()} records</span>,{' '}
                {managedItems.filter(i => i.status === 'done').length} managed tables
                {unmanagedItems.length > 0 && `, ${unmanagedItems.length} unmanaged`}.
              </p>
            )}

            {/* Discovery warning */}
            {isReady && discoveryMissing && (
              <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2.5 space-y-1.5">
                <p className="text-xs font-semibold text-amber-800 flex items-center gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  Schema discovery not available
                </p>
                <p className="text-xs text-amber-700">
                  Unmanaged tables could not be detected. Install the discovery view to enable full protection.
                </p>
                <button
                  onClick={() => setShowMigSQL(v => !v)}
                  className="text-xs text-amber-700 underline"
                >
                  {showMigSQL ? 'Hide' : 'Show'} migration SQL
                </button>
                {showMigSQL && (
                  <pre className="text-[10px] font-mono bg-white border border-amber-200 rounded p-2 whitespace-pre-wrap break-all select-all text-gray-700 mt-1">
                    {SCHEMA_DISCOVERY_MIGRATION_SQL}
                  </pre>
                )}
              </div>
            )}

            {/* Other warnings */}
            {isReady && warnings.filter(w => !w.includes('Schema discovery')).map((w, i) => (
              <div key={i} className="flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                {w}
              </div>
            ))}

            {/* Managed tables progress */}
            <div className="space-y-1">
              <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide px-1">
                Managed tables ({managedItems.length})
              </p>
              <div className="space-y-0.5 max-h-48 overflow-y-auto rounded-lg border border-gray-100 p-2.5 bg-gray-50">
                {managedItems.map(item => (
                  <ProgressRow key={item.key} item={item} />
                ))}
              </div>
            </div>

            {/* Unmanaged tables */}
            {(unmanagedItems.length > 0 || (isCollecting && !backup?._meta.schemaDiscoveryAvailable)) && (
              <div className="space-y-1">
                <button
                  onClick={() => setShowUnmanaged(v => !v)}
                  className="w-full flex items-center justify-between text-[11px] font-semibold text-gray-400 uppercase tracking-wide px-1"
                >
                  <span>
                    Unmanaged tables
                    {unmanagedItems.length > 0 && (
                      <span className="ml-1.5 px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 normal-case font-medium">
                        {unmanagedItems.length}
                      </span>
                    )}
                  </span>
                  {unmanagedItems.length > 0 && (
                    <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showUnmanaged ? 'rotate-180' : ''}`} />
                  )}
                </button>
                {showUnmanaged && unmanagedItems.length > 0 && (
                  <div className="space-y-0.5 max-h-32 overflow-y-auto rounded-lg border border-amber-100 p-2.5 bg-amber-50/40">
                    {unmanagedItems.map(item => (
                      <ProgressRow key={item.key} item={item} muted />
                    ))}
                  </div>
                )}
                {unmanagedItems.length === 0 && isReady && (
                  <p className="px-1 text-xs text-gray-400">None detected.</p>
                )}
              </div>
            )}

            {isCollecting && (
              <div className="flex justify-end">
                <button
                  onClick={() => { cancelRef.current = true; onClose() }}
                  className="px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50"
                >
                  Cancel
                </button>
              </div>
            )}
          </>
        )}

        {/* ── Sharing in progress ── */}
        {step === 'sharing' && (
          <div className="flex items-center gap-3 py-6 justify-center text-sm text-gray-500">
            <Loader2 className="w-5 h-5 animate-spin text-primary shrink-0" />
            Uploading backup to secure cloud storage…
          </div>
        )}

        {/* ── Error ── */}
        {step === 'error' && (
          <>
            <div className="flex items-start gap-3 rounded-xl bg-red-50 border border-red-200 px-4 py-3">
              <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
              <div className="text-sm text-red-700 space-y-1">
                <p className="font-semibold">Backup failed</p>
                <p>{errMsg}</p>
              </div>
            </div>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setStep('configuring')}
                className="px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Back to Settings
              </button>
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Close
              </button>
            </div>
          </>
        )}

        {/* ── Cloud link ready ── */}
        {step === 'link-ready' && link && (
          <div className="space-y-3">
            <p className="text-sm text-gray-600">
              Secure download link (expires in 7 days). Share via email or messaging.
            </p>
            <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
              <span className="flex-1 text-xs font-mono text-gray-600 truncate">{link}</span>
              <button
                onClick={handleCopyLink}
                className="shrink-0 flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-primary border border-primary/30 rounded-lg hover:bg-primary/5 transition-colors"
              >
                {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>
          </div>
        )}

        {/* ── Ready actions ── */}
        {step === 'ready' && (
          <div className="space-y-3 pt-2 border-t border-gray-100">
            <p className="text-xs text-gray-400">Receipt files are not included — only attachment metadata is saved.</p>
            <div className="flex flex-col sm:flex-row gap-2">
              <button
                onClick={handleDownload}
                className="flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary-dark transition-colors"
              >
                <Download className="w-4 h-4" /> Download Backup File
              </button>
              <button
                onClick={handleShareLink}
                disabled={sharing}
                className="flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors"
              >
                {sharing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />}
                Get Shareable Link
              </button>
            </div>
          </div>
        )}

        {/* ── Link-ready actions ── */}
        {step === 'link-ready' && (
          <div className="flex justify-end gap-3 pt-2 border-t border-gray-100">
            <button onClick={handleDownload} className="flex items-center gap-2 px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50">
              <Download className="w-3.5 h-3.5" /> Also Download
            </button>
            <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary-dark">
              Done
            </button>
          </div>
        )}
      </div>
    </Modal>
  )
}

// ── Shared progress row ────────────────────────────────────────────────────────

function ProgressRow({ item, muted }: { item: TableProgress; muted?: boolean }) {
  return (
    <div className="flex items-center gap-2.5 text-sm py-0.5">
      {item.status === 'pending' && <div className="w-4 h-4 rounded-full border-2 border-gray-200 shrink-0" />}
      {item.status === 'running' && <Loader2 className="w-4 h-4 text-primary animate-spin shrink-0" />}
      {item.status === 'done'    && <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" />}
      {item.status === 'error'   && <XCircle className="w-4 h-4 text-amber-500 shrink-0" />}
      <span className={
        item.status === 'done'    ? (muted ? 'text-gray-600' : 'text-gray-700') :
        item.status === 'error'   ? 'text-amber-600' :
        item.status === 'running' ? 'text-gray-900 font-medium' :
        'text-gray-400'
      }>
        {item.label}
        {item.status === 'done' && item.count !== undefined && (
          <span className="ml-1.5 text-xs text-gray-400">({item.count.toLocaleString()})</span>
        )}
        {item.status === 'error' && (
          <span className="ml-1 text-xs">(unavailable — skipped)</span>
        )}
        {muted && item.status === 'pending' && (
          <span className="ml-1.5 text-xs text-amber-500 font-medium">unmanaged</span>
        )}
      </span>
    </div>
  )
}
