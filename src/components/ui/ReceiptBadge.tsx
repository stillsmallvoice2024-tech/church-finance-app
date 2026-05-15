import { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { Paperclip, X, Download, Trash2, Loader2, Upload, AlertTriangle, Terminal } from 'lucide-react'
import { useReceipts, type ReceiptEntityType, type Receipt } from '../../hooks/useReceipts'
import { useToastStore } from '../../store/toastStore'

const MIGRATION_SQL =
`CREATE TABLE IF NOT EXISTS public.receipts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type text NOT NULL CHECK (entity_type IN ('outflow','inflow','bank_deposit')),
  entity_id   uuid NOT NULL,
  file_name   text NOT NULL,
  file_path   text NOT NULL,
  file_size   bigint,
  mime_type   text,
  uploaded_by uuid REFERENCES public.profiles(id),
  created_at  timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS receipts_entity
  ON public.receipts(entity_type, entity_id);

-- Storage bucket (run in SQL editor):
INSERT INTO storage.buckets (id, name, public)
VALUES ('receipts', 'receipts', false)
ON CONFLICT (id) DO NOTHING;`

interface Props {
  entityType: ReceiptEntityType
  entityId:   string
}

export function ReceiptBadge({ entityType, entityId }: Props) {
  const { receipts, loading, error, upload, remove, getDownloadUrl } = useReceipts(entityType, entityId)
  const { push: toast } = useToastStore()
  const [open,      setOpen]      = useState(false)
  const [uploading, setUploading] = useState(false)
  const [panelPos,  setPanelPos]  = useState({ top: 0, left: 0 })
  const btnRef    = useRef<HTMLButtonElement>(null)
  const panelRef  = useRef<HTMLDivElement>(null)
  const inputRef  = useRef<HTMLInputElement>(null)

  const reposition = useCallback(() => {
    if (!btnRef.current) return
    const rect   = btnRef.current.getBoundingClientRect()
    const panelW = 288
    const panelH = 380
    const gap    = 6
    const left   = Math.min(Math.max(rect.left, 8), window.innerWidth - panelW - 8)
    const spaceBelow = window.innerHeight - rect.bottom
    const top = spaceBelow >= panelH
      ? rect.bottom + gap
      : rect.top - panelH - gap
    setPanelPos({ top: Math.max(8, top), left })
  }, [])

  const toggle = () => {
    if (!open) reposition()
    setOpen(v => !v)
  }

  // Close on outside click or scroll
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => {
      if (btnRef.current?.contains(e.target as Node)) return
      if (panelRef.current?.contains(e.target as Node)) return
      setOpen(false)
    }
    const onScroll = () => setOpen(false)
    document.addEventListener('mousedown', close)
    document.addEventListener('scroll', onScroll, true)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('scroll', onScroll, true)
    }
  }, [open])

  const handleFiles = async (files: FileList | null) => {
    if (!files?.length) return
    console.log('[ReceiptBadge] uploading', files.length, 'file(s) for', entityType, entityId)
    setUploading(true)
    let failed = 0
    for (const file of Array.from(files)) {
      try {
        await upload(file)
        console.log('[ReceiptBadge] upload ok:', file.name)
      } catch (e) {
        failed++
        console.error('[ReceiptBadge] upload failed:', file.name, e)
      }
    }
    if (inputRef.current) inputRef.current.value = ''
    setUploading(false)
    console.log('[ReceiptBadge] done —', files.length - failed, 'ok,', failed, 'failed')
    if (failed > 0) {
      toast(
        failed === files.length
          ? 'Upload failed — check storage permissions or bucket setup'
          : `${failed} of ${files.length} file(s) failed to upload`,
        'error',
      )
    } else {
      toast(`${files.length} receipt${files.length > 1 ? 's' : ''} uploaded`, 'success')
    }
  }

  const handleDownload = async (r: Receipt) => {
    const url = await getDownloadUrl(r.file_path)
    if (!url) return
    const a = document.createElement('a')
    a.href = url; a.download = r.file_name; a.click()
  }

  const isMigrationError = !!error && /relation.*does not exist|receipts|Could not find/i.test(error)

  return (
    <>
      <button
        ref={btnRef}
        onClick={toggle}
        className="relative p-1.5 rounded-lg text-gray-400 hover:text-primary hover:bg-primary/10 transition-colors"
        title={`${receipts.length} receipt${receipts.length !== 1 ? 's' : ''}`}
      >
        <Paperclip className="w-4 h-4" />
        {receipts.length > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[14px] h-[14px] flex items-center justify-center text-[9px] font-bold bg-primary text-white rounded-full px-0.5 leading-none">
            {receipts.length > 9 ? '9+' : receipts.length}
          </span>
        )}
      </button>

      {open && createPortal(
        <div
          ref={panelRef}
          className="fixed z-[9999] w-72 bg-white border border-gray-200 rounded-xl shadow-xl overflow-hidden"
          style={{ top: panelPos.top, left: panelPos.left }}
          onMouseDown={e => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-3 py-2 bg-gray-50 border-b border-gray-100">
            <span className="text-xs font-semibold text-gray-600 capitalize">
              {entityType.replace('_', ' ')} receipts ({receipts.length})
            </span>
            <button onClick={() => setOpen(false)} className="p-0.5 rounded text-gray-400 hover:text-gray-600">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Migration error */}
          {error && (
            <div className="p-2 space-y-1">
              <div className="flex items-start gap-1.5 text-[11px] text-red-700 bg-red-50 border border-red-200 rounded-lg px-2 py-1.5">
                <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />
                <span>
                  {isMigrationError
                    ? 'Receipts table not found. Run the SQL below in Supabase SQL Editor.'
                    : error}
                </span>
              </div>
              {isMigrationError && (
                <div className="rounded-lg border border-gray-200 bg-gray-900 overflow-hidden">
                  <div className="flex items-center gap-1.5 px-2 py-1 bg-gray-800 border-b border-gray-700">
                    <Terminal className="w-3 h-3 text-gray-400" />
                    <span className="text-[9px] text-gray-400 font-mono">Supabase SQL Editor</span>
                  </div>
                  <pre className="px-2 py-2 text-[10px] text-green-300 font-mono overflow-x-auto whitespace-pre">{MIGRATION_SQL}</pre>
                </div>
              )}
            </div>
          )}

          {/* File list */}
          {!error && (
            <div className="max-h-52 overflow-y-auto divide-y divide-gray-50">
              {loading ? (
                <div className="py-5 flex justify-center">
                  <Loader2 className="w-4 h-4 text-gray-300 animate-spin" />
                </div>
              ) : receipts.length === 0 ? (
                <p className="py-5 text-center text-xs text-gray-400">No receipts attached yet</p>
              ) : (
                receipts.map(r => (
                  <div key={r.id} className="flex items-center gap-2 px-3 py-2 hover:bg-gray-50 group">
                    <Paperclip className="w-3.5 h-3.5 text-gray-300 shrink-0" />
                    <span className="text-xs text-gray-700 truncate flex-1 min-w-0" title={r.file_name}>
                      {r.file_name}
                    </span>
                    <div className="flex gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => handleDownload(r)}
                        className="p-0.5 text-gray-400 hover:text-primary rounded"
                        title="Download"
                      >
                        <Download className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => remove(r)}
                        className="p-0.5 text-gray-400 hover:text-danger rounded"
                        title="Delete"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {/* Upload */}
          {!error && (
            <div className="px-3 py-2 border-t border-gray-100 bg-gray-50">
              <label className="flex items-center gap-1.5 cursor-pointer text-xs font-medium text-primary hover:text-primary-light transition-colors">
                {uploading
                  ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Uploading…</>
                  : <><Upload className="w-3.5 h-3.5" /> Attach files</>
                }
                <input
                  ref={inputRef}
                  type="file" multiple accept="image/*,.pdf"
                  className="hidden" disabled={uploading}
                  onChange={e => handleFiles(e.target.files)}
                />
              </label>
            </div>
          )}
        </div>,
        document.body
      )}
    </>
  )
}
