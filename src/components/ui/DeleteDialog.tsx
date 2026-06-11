import { Trash2 } from 'lucide-react'
import { Modal } from './Modal'

interface DeleteDialogProps {
  open: boolean
  onClose: () => void
  onConfirm: () => void
  loading?: boolean
  /** Short description of what is being deleted — shown in the body. */
  label?: string
}

export function DeleteDialog({
  open,
  onClose,
  onConfirm,
  loading = false,
  label = 'this record',
}: DeleteDialogProps) {
  return (
    <Modal open={open} onClose={onClose} title="Delete record" size="max-w-sm">
      <div className="flex flex-col gap-4 pb-2">
        <div className="flex items-start gap-3">
          <div className="p-2 bg-red-50 rounded-lg shrink-0 mt-0.5">
            <Trash2 className="w-4 h-4 text-danger" />
          </div>
          <div>
            <p className="text-sm font-medium text-gray-800">
              Delete <span className="text-gray-900">{label}</span>?
            </p>
            <p className="text-xs text-gray-400 mt-1">
              This will permanently remove the record and cannot be undone.
            </p>
          </div>
        </div>

        <div className="flex gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="flex-1 px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className="flex-1 px-4 py-2 text-sm font-medium text-white bg-danger rounded-lg hover:bg-red-700 transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
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
