import { Trash2 } from 'lucide-react'
import { Modal } from './Modal'
import type { ReactNode } from 'react'

interface DeleteDialogProps {
  open: boolean
  onClose: () => void
  onConfirm: () => void
  loading?: boolean
  /** Short description of what is being deleted — shown in the body. */
  label?: string
  /**
   * Optional record summary (date, amount, description…) so the user
   * confirms WHAT is being deleted, not just whether.
   */
  detail?: ReactNode
}

export function DeleteDialog({
  open,
  onClose,
  onConfirm,
  loading = false,
  label = 'this record',
  detail,
}: DeleteDialogProps) {
  return (
    <Modal open={open} onClose={onClose} title="Delete record" size="max-w-sm">
      <div className="flex flex-col gap-4 pb-2">
        <div className="flex items-start gap-3">
          <div className="p-2 bg-red-50 rounded-lg shrink-0 mt-0.5">
            <Trash2 className="w-4 h-4 text-danger" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-gray-800">
              Delete <span className="text-gray-900">{label}</span>?
            </p>
            <p className="text-xs text-gray-500 mt-1">
              This will permanently remove the record and cannot be undone.
            </p>
          </div>
        </div>

        {detail && (
          <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm text-gray-700 break-words">
            {detail}
          </div>
        )}

        <div className="flex flex-col-reverse sm:flex-row gap-2 sm:gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="flex-1 px-4 py-2 min-h-[44px] text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className="flex-1 px-4 py-2 min-h-[44px] text-sm font-medium text-white bg-danger rounded-lg hover:bg-red-700 transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
          >
            {loading && (
              <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            )}
            {loading ? 'Deleting…' : 'Yes, delete'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
