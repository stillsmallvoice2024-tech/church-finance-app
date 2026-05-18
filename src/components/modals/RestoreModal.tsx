import { useState, useRef, useCallback } from 'react'
import {
  Upload, AlertTriangle, CheckCircle2, XCircle, Loader2, ShieldAlert, Info,
} from 'lucide-react'
import { Modal } from '../ui/Modal'
import { useToastStore } from '../../store/toastStore'
import {
  parseBackupFile,
  validateBackup,
  getRestoreSummary,
  restoreFromBackup,
  type BackupFile,
  type RestoreSummary,
  type TableProgress,
  BACKUP_TABLES,
} from '../../utils/backupRestore'

type Step = 'select' | 'preview' | 'confirm' | 'restoring' | 'done'
type Mode = 'merge' | 'replace'

interface Props {
  open:    boolean
  onClose: () => void
  onDone?: () => void
}

const MODULE_ORDER = ['Transactions', 'Configuration', 'Allocation', 'Projects', 'Reports']

export function RestoreModal({ open, onClose, onDone }: Props) {
  const { push: toast } = useToastStore()

  const [step,     setStep]     = useState<Step>('select')
  const [mode,     setMode]     = useState<Mode>('merge')
  const [backup,   setBackup]   = useState<BackupFile | null>(null)
  const [summary,  setSummary]  = useState<RestoreSummary | null>(null)
  const [fileErr,  setFileErr]  = useState<string | null>(null)
  const [items,    setItems]    = useState<TableProgress[]>([])
  const [result,   setResult]   = useState<{ success: boolean; errors: string[] } | null>(null)
  const [loading,  setLoading]  = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const reset = () => {
    setStep('select')
    setMode('merge')
    setBackup(null)
    setSummary(null)
    setFileErr(null)
    setItems([])
    setResult(null)
    setLoading(false)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const handleClose = () => {
    if (step !== 'restoring') {
      reset()
      onClose()
    }
  }

  const setItemStatus = useCallback(
    (key: string, status: TableProgress['status'], count?: number) => {
      setItems(prev =>
        prev.map(it =>
          it.key === key ? { ...it, status, ...(count !== undefined ? { count } : {}) } : it,
        ),
      )
    },
    [],
  )

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setFileErr(null)
    setLoading(true)
    try {
      const parsed   = await parseBackupFile(file)
      const { valid, errors } = validateBackup(parsed)
      if (!valid) {
        setFileErr(errors.join('; '))
        setLoading(false)
        return
      }
      const sum = getRestoreSummary(parsed)
      setBackup(parsed)
      setSummary(sum)
      setStep('preview')
    } catch (e) {
      setFileErr(e instanceof Error ? e.message : 'Could not read file')
    } finally {
      setLoading(false)
    }
  }

  const handleRestore = async () => {
    if (!backup) return
    setStep('restoring')

    // Initialise progress items for tables that have data
    const activeTables = BACKUP_TABLES.filter(
      def => Array.isArray(backup.data[def.key]) && (backup.data[def.key]?.length ?? 0) > 0,
    )
    setItems(activeTables.map(def => ({ key: def.key, label: def.label, status: 'pending' })))

    try {
      const res = await restoreFromBackup(backup, mode, (key, status, count) => {
        setItemStatus(key, status, count)
      })
      setResult({
        success: res.success,
        errors:  res.errors.map(e => `${e.table}: ${e.message}`),
      })
      setStep('done')
      if (res.success) {
        toast('Restore completed successfully', 'success')
        onDone?.()
      }
    } catch (e) {
      setResult({
        success: false,
        errors:  [e instanceof Error ? e.message : 'Restore failed'],
      })
      setStep('done')
    }
  }

  const groupedSummary = summary
    ? MODULE_ORDER.map(mod => ({
        module: mod,
        tables: summary.tables.filter(t => {
          const def = BACKUP_TABLES.find(d => d.key === t.key)
          return def?.module === mod && t.count > 0
        }),
      })).filter(g => g.tables.length > 0)
    : []

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
              Upload a Church Finance backup file (<code className="text-xs bg-gray-100 px-1 rounded">.json</code>) to restore your account.
            </p>

            <label
              className="flex flex-col items-center justify-center gap-3 border-2 border-dashed border-gray-200 rounded-xl p-8 cursor-pointer hover:border-primary/40 hover:bg-primary/2 transition-colors"
            >
              <Upload className="w-8 h-8 text-gray-300" />
              <div className="text-center">
                <p className="text-sm font-medium text-gray-700">Click to choose backup file</p>
                <p className="text-xs text-gray-400 mt-0.5">church-finance-backup-*.json</p>
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
                <XCircle className="w-4 h-4 shrink-0 mt-0.5" />
                {fileErr}
              </div>
            )}

            <div className="flex justify-end">
              <button
                onClick={handleClose}
                className="px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Cancel
              </button>
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
                <p><span className="font-medium">Total records:</span> {summary.totalRecords.toLocaleString()}</p>
                <p><span className="font-medium">Modules:</span> {summary.modules.join(', ')}</p>
              </div>
            </div>

            {/* Record counts by module */}
            <div className="space-y-2">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Records to restore</p>
              {groupedSummary.map(g => (
                <div key={g.module} className="rounded-lg border border-gray-100 overflow-hidden">
                  <div className="px-3 py-2 bg-gray-50 text-xs font-semibold text-gray-600">{g.module}</div>
                  <div className="divide-y divide-gray-50">
                    {g.tables.map(t => (
                      <div key={t.key} className="flex items-center justify-between px-3 py-1.5 text-sm">
                        <span className="text-gray-700">{BACKUP_TABLES.find(d => d.key === t.key)?.label ?? t.key}</span>
                        <span className="font-mono text-xs text-gray-500">{t.count.toLocaleString()}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {/* Mode selector */}
            <div className="space-y-2">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Restore Mode</p>
              <div className="space-y-2">
                <label className={`flex items-start gap-3 cursor-pointer rounded-xl border-2 px-4 py-3 transition-colors ${mode === 'merge' ? 'border-primary bg-primary/5' : 'border-gray-200 hover:border-gray-300'}`}>
                  <input
                    type="radio"
                    name="restore-mode"
                    value="merge"
                    checked={mode === 'merge'}
                    onChange={() => setMode('merge')}
                    className="mt-0.5"
                  />
                  <div>
                    <p className="text-sm font-medium text-gray-900">Merge</p>
                    <p className="text-xs text-gray-500 mt-0.5">Add backup records alongside existing data. Conflicts (same ID) are skipped.</p>
                  </div>
                </label>
                <label className={`flex items-start gap-3 cursor-pointer rounded-xl border-2 px-4 py-3 transition-colors ${mode === 'replace' ? 'border-danger bg-red-50' : 'border-gray-200 hover:border-gray-300'}`}>
                  <input
                    type="radio"
                    name="restore-mode"
                    value="replace"
                    checked={mode === 'replace'}
                    onChange={() => setMode('replace')}
                    className="mt-0.5"
                  />
                  <div>
                    <p className="text-sm font-medium text-gray-900">Replace</p>
                    <p className="text-xs text-gray-500 mt-0.5">Delete all existing data first, then insert backup records. <span className="text-danger font-medium">This is irreversible.</span></p>
                  </div>
                </label>
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-2 border-t border-gray-100">
              <button
                onClick={reset}
                className="px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Back
              </button>
              <button
                onClick={() => setStep('confirm')}
                className="px-4 py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary-dark"
              >
                Continue
              </button>
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
                  <p>All current transactions, categories, banks, allocation configs, and project entries will be permanently removed before the backup is applied. This cannot be undone.</p>
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-3 rounded-xl bg-amber-50 border border-amber-200 px-4 py-3">
                <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                <div className="text-sm text-amber-700 space-y-1">
                  <p className="font-semibold">Merge mode — existing records are preserved</p>
                  <p>Backup records with IDs that already exist will be skipped. New records from backup will be added.</p>
                </div>
              </div>
            )}

            <p className="text-sm text-gray-600">
              You are about to restore <strong>{summary?.totalRecords.toLocaleString()}</strong> records in <strong>{mode}</strong> mode. Confirm to proceed.
            </p>

            <div className="flex justify-end gap-3 pt-2 border-t border-gray-100">
              <button
                onClick={() => setStep('preview')}
                className="px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Back
              </button>
              <button
                onClick={handleRestore}
                className={`px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors ${
                  mode === 'replace'
                    ? 'bg-danger hover:bg-red-700'
                    : 'bg-primary hover:bg-primary-dark'
                }`}
              >
                Restore Now
              </button>
            </div>
          </>
        )}

        {/* ── Step 4: Restoring ── */}
        {step === 'restoring' && (
          <>
            <p className="text-sm text-gray-600">
              Restoring data. Do not close this window.
            </p>
            <div className="space-y-1.5 max-h-64 overflow-y-auto rounded-lg border border-gray-100 p-3 bg-gray-50">
              {items.map(item => (
                <div key={item.key} className="flex items-center gap-2.5 text-sm">
                  {item.status === 'pending' && (
                    <div className="w-4 h-4 rounded-full border-2 border-gray-200 shrink-0" />
                  )}
                  {item.status === 'running' && (
                    <Loader2 className="w-4 h-4 text-primary animate-spin shrink-0" />
                  )}
                  {item.status === 'done' && (
                    <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" />
                  )}
                  {item.status === 'error' && (
                    <XCircle className="w-4 h-4 text-red-500 shrink-0" />
                  )}
                  <span className={
                    item.status === 'done'    ? 'text-gray-700' :
                    item.status === 'error'   ? 'text-red-600' :
                    item.status === 'running' ? 'text-gray-900 font-medium' :
                    'text-gray-400'
                  }>
                    {item.label}
                    {item.status === 'done' && item.count !== undefined && (
                      <span className="ml-1.5 text-xs text-gray-400">
                        ({item.count.toLocaleString()} records)
                      </span>
                    )}
                  </span>
                </div>
              ))}
            </div>
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
                  <p>All records have been restored. Refresh the page to see your data.</p>
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-3 rounded-xl bg-red-50 border border-red-200 px-4 py-3">
                <XCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
                <div className="text-sm text-red-700 space-y-1">
                  <p className="font-semibold">Restore completed with errors</p>
                  <ul className="list-disc pl-4 space-y-0.5 text-xs">
                    {result.errors.slice(0, 5).map((e, i) => <li key={i}>{e}</li>)}
                    {result.errors.length > 5 && (
                      <li>…and {result.errors.length - 5} more</li>
                    )}
                  </ul>
                </div>
              </div>
            )}

            {/* Progress summary */}
            <div className="space-y-1 max-h-48 overflow-y-auto rounded-lg border border-gray-100 p-3 bg-gray-50">
              {items.map(item => (
                <div key={item.key} className="flex items-center gap-2.5 text-sm">
                  {item.status === 'done'  && <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" />}
                  {item.status === 'error' && <XCircle      className="w-4 h-4 text-red-500 shrink-0" />}
                  <span className={item.status === 'error' ? 'text-red-600' : 'text-gray-700'}>
                    {item.label}
                    {item.status === 'done' && item.count !== undefined && (
                      <span className="ml-1.5 text-xs text-gray-400">({item.count.toLocaleString()})</span>
                    )}
                  </span>
                </div>
              ))}
            </div>

            <div className="flex justify-end gap-3 pt-2 border-t border-gray-100">
              {result.success && (
                <button
                  onClick={() => window.location.reload()}
                  className="px-4 py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary-dark"
                >
                  Reload Page
                </button>
              )}
              <button
                onClick={handleClose}
                className="px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Close
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}
