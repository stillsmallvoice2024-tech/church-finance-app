import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

interface ModalProps {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  /** Optional extra width class, e.g. 'max-w-2xl'. Defaults to max-w-lg */
  size?: string
  /** Optional element rendered to the left of the close button */
  headerExtra?: ReactNode
  /**
   * Sticky footer rendered below the scrollable body.
   * Pass action buttons here so they remain visible on mobile.
   */
  footer?: ReactNode
  /**
   * When true, ESC / backdrop / × button show a "Discard changes?" confirmation
   * before calling onClose. Cancel buttons inside the form bypass this guard.
   */
  isDirty?: boolean
}

export function Modal({
  open,
  onClose,
  title,
  children,
  size = 'max-w-lg',
  headerExtra,
  footer,
  isDirty,
}: ModalProps) {
  const [confirmingClose, setConfirmingClose] = useState(false)

  const requestClose = () => {
    if (isDirty) {
      setConfirmingClose(true)
    } else {
      onClose()
    }
  }

  // ESC — with dirty guard
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (confirmingClose) {
        setConfirmingClose(false)
      } else {
        requestClose()
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, isDirty, confirmingClose]) // eslint-disable-line react-hooks/exhaustive-deps

  // Reset confirmation state whenever modal closes
  useEffect(() => {
    if (!open) setConfirmingClose(false)
  }, [open])

  // Prevent body scroll while open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => { document.body.style.overflow = '' }
  }, [open])

  if (!open) return null

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-stretch sm:items-center sm:justify-center sm:p-4"
      aria-modal="true"
      role="dialog"
      aria-labelledby="modal-title"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={requestClose}
        aria-hidden="true"
      />

      {/* Panel — full-screen on mobile, centered card on sm+ */}
      <div
        className={`relative w-full bg-white flex flex-col h-full sm:h-auto sm:rounded-2xl sm:shadow-2xl sm:${size} sm:max-h-[90vh]`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 shrink-0">
          <h2 id="modal-title" className="text-base font-semibold text-gray-900">
            {title}
          </h2>
          <div className="flex items-center gap-2">
            {headerExtra}
            <button
              onClick={requestClose}
              className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
              aria-label="Close modal"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Body — scrollable */}
        <div className="overflow-y-auto flex-1 px-6 py-5">
          {children}
        </div>

        {/* Sticky footer for action buttons */}
        {footer && (
          <div className="shrink-0 px-6 py-4 border-t border-gray-100 bg-white sm:rounded-b-2xl">
            {footer}
          </div>
        )}

        {/* Discard-changes confirmation overlay */}
        {confirmingClose && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/90 backdrop-blur-sm sm:rounded-2xl p-6">
            <div className="text-center space-y-4 max-w-xs w-full">
              <p className="font-semibold text-gray-900 text-base">Discard changes?</p>
              <p className="text-sm text-gray-500">You have unsaved changes that will be lost.</p>
              <div className="flex gap-3 justify-center">
                <button
                  type="button"
                  onClick={() => setConfirmingClose(false)}
                  className="flex-1 px-4 min-h-[44px] text-sm font-medium text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  Continue Editing
                </button>
                <button
                  type="button"
                  onClick={() => { setConfirmingClose(false); onClose() }}
                  className="flex-1 px-4 min-h-[44px] text-sm font-medium text-white bg-danger rounded-lg hover:opacity-90 transition-colors"
                >
                  Discard Changes
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}
