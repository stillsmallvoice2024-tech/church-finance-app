import { AlertTriangle } from 'lucide-react'
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
    <Modal open={open} onClose={onClose} title="Confirm Delete" size="max-w-sm">
      <div className="flex flex-col items-center gap-4 text-center pb-2">
        <div className="p-3 bg-red-50 rounded-full">
          <AlertTriangle className="w-7 h-7 text-danger" />
        </div>
        <div>
          <p className="text-sm text-gray-700">
            Are you sure you want to delete <strong>{label}</strong>?
          </p>
          <p className="text-xs text-gray-400 mt-1">This action cannot be undone.</p>
        </div>

        <div className="flex gap-3 w-full">
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
            {loading ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
