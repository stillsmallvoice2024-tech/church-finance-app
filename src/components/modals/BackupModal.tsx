import { useState, useEffect, useCallback, useRef } from 'react'
import {
  CheckCircle2, XCircle, Loader2, Download, Link2, Copy, Check, AlertCircle,
} from 'lucide-react'
import { Modal } from '../ui/Modal'
import { useAuth } from '../../hooks/useAuth'
import { useToastStore } from '../../store/toastStore'
import {
  BACKUP_TABLES,
  createBackup,
  downloadBackup,
  uploadBackupForLink,
  type BackupFile,
  type TableProgress,
} from '../../utils/backupRestore'

type Step = 'collecting' | 'ready' | 'sharing' | 'link-ready' | 'error'

interface Props {
  open:    boolean
  onClose: () => void
}

const INITIAL_PROGRESS: TableProgress[] = BACKUP_TABLES.map(def => ({
  key:    def.key,
  label:  def.label,
  status: 'pending',
}))

export function BackupModal({ open, onClose }: Props) {
  const { user } = useAuth()
  const { push: toast } = useToastStore()

  const [step,     setStep]     = useState<Step>('collecting')
  const [items,    setItems]    = useState<TableProgress[]>(INITIAL_PROGRESS)
  const [backup,   setBackup]   = useState<BackupFile | null>(null)
  const [sharing,  setSharing]  = useState(false)
  const [link,     setLink]     = useState<string | null>(null)
  const [copied,   setCopied]   = useState(false)
  const [errMsg,   setErrMsg]   = useState<string | null>(null)
  const cancelRef = useRef(false)

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

  useEffect(() => {
    if (!open) return
    cancelRef.current = false
    setStep('collecting')
    setItems(INITIAL_PROGRESS)
    setBackup(null)
    setLink(null)
    setCopied(false)
    setErrMsg(null)

    if (!user?.id || !user?.email) return

    ;(async () => {
      try {
        const result = await createBackup(user.id, user.email!, (key, status, count) => {
          if (!cancelRef.current) setItemStatus(key, status, count)
        })
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
    })()

    return () => { cancelRef.current = true }
  }, [open, user?.id, user?.email, setItemStatus])

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

  const done  = step === 'ready' || step === 'link-ready'
  const total = items.reduce((s, it) => s + (it.count ?? 0), 0)

  return (
    <Modal
      open={open}
      onClose={() => { if (step !== 'collecting') onClose() }}
      title="Backup Account"
      size="max-w-lg"
    >
      <div className="space-y-4">
        {/* ── Collecting phase ── */}
        {(step === 'collecting' || done) && (
          <>
            <p className="text-sm text-gray-600">
              {step === 'collecting'
                ? 'Collecting all account data…'
                : `Backup ready — ${total.toLocaleString()} records across ${items.filter(i => i.status === 'done' && (i.count ?? 0) > 0).length} tables.`}
            </p>

            <div className="space-y-1 max-h-60 overflow-y-auto rounded-lg border border-gray-100 p-3 bg-gray-50">
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
                    <XCircle className="w-4 h-4 text-amber-500 shrink-0" />
                  )}
                  <span className={
                    item.status === 'done'    ? 'text-gray-700' :
                    item.status === 'error'   ? 'text-amber-600' :
                    item.status === 'running' ? 'text-gray-900 font-medium' :
                    'text-gray-400'
                  }>
                    {item.label}
                    {item.status === 'done' && item.count !== undefined && (
                      <span className="ml-1.5 text-xs text-gray-400">
                        ({item.count.toLocaleString()})
                      </span>
                    )}
                    {item.status === 'error' && (
                      <span className="ml-1 text-xs">(table unavailable — skipped)</span>
                    )}
                  </span>
                </div>
              ))}
            </div>

            {step === 'collecting' && (
              <div className="flex justify-end">
                <button
                  onClick={onClose}
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
          <div className="flex items-start gap-3 rounded-xl bg-red-50 border border-red-200 px-4 py-3">
            <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
            <div className="text-sm text-red-700 space-y-1">
              <p className="font-semibold">Something went wrong</p>
              <p>{errMsg}</p>
            </div>
          </div>
        )}

        {/* ── Cloud link ready ── */}
        {step === 'link-ready' && link && (
          <div className="space-y-3">
            <p className="text-sm text-gray-600">
              Secure download link (expires in 7 days). Share it via email or messaging.
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
            <p className="text-xs text-gray-400">
              Note: Receipt files are not included in the backup — only metadata is saved.
            </p>
          </div>
        )}

        {/* ── Actions (ready state) ── */}
        {done && step !== 'link-ready' && (
          <div className="space-y-3 pt-2 border-t border-gray-100">
            <p className="text-xs text-gray-400">
              Note: Receipt files are not included — only attachment metadata is saved.
            </p>
            <div className="flex flex-col sm:flex-row gap-2">
              <button
                onClick={handleDownload}
                className="flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary-dark transition-colors"
              >
                <Download className="w-4 h-4" />
                Download Backup File
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

        {/* ── Actions (link-ready state) ── */}
        {step === 'link-ready' && (
          <div className="flex justify-end gap-3 pt-2 border-t border-gray-100">
            <button
              onClick={handleDownload}
              className="flex items-center gap-2 px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50"
            >
              <Download className="w-3.5 h-3.5" /> Also Download
            </button>
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary-dark"
            >
              Done
            </button>
          </div>
        )}

        {/* ── Error action ── */}
        {step === 'error' && (
          <div className="flex justify-end">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50"
            >
              Close
            </button>
          </div>
        )}
      </div>
    </Modal>
  )
}
