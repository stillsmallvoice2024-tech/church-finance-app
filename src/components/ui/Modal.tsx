import { useCallback, useEffect, useImperativeHandle, useRef, useState, forwardRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

export interface ModalHandle {
  requestClose: () => void
}

function getFocusable(el: HTMLElement | null): HTMLElement[] {
  if (!el) return []
  return Array.from(
    el.querySelectorAll<HTMLElement>(
      'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'
    )
  )
}

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
  /**
   * When true, all close paths are disabled: X button hidden, ESC no-op, backdrop no-op.
   * Use during async processing to prevent accidental mid-operation dismissal.
   */
  disableClose?: boolean
  /**
   * When true, clicking the backdrop does nothing.
   * X button and ESC still work (subject to isDirty guard).
   */
  disableBackdropClose?: boolean
  /** Custom title for the dirty-state confirm overlay (default: "Discard changes?") */
  confirmTitle?: string
  /** Custom message for the dirty-state confirm overlay */
  confirmMessage?: string
  /** Label for the "keep" action in the dirty-state confirm overlay (default: "Continue Editing") */
  confirmKeepLabel?: string
  /** Label for the "discard" action in the dirty-state confirm overlay (default: "Discard Changes") */
  confirmDiscardLabel?: string
}

export const Modal = forwardRef<ModalHandle, ModalProps>(function Modal({
  open,
  onClose,
  title,
  children,
  size = 'max-w-lg',
  headerExtra,
  footer,
  isDirty,
  disableClose,
  disableBackdropClose,
  confirmTitle,
  confirmMessage,
  confirmKeepLabel,
  confirmDiscardLabel,
}: ModalProps, ref) {
  const [confirmingClose, setConfirmingClose] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)

  // Swipe-down-to-close (mobile) — drag starts from the header/handle only,
  // so body scrolling is never hijacked. Routes through the dirty guard.
  const touchStartY = useRef<number | null>(null)
  const [dragY, setDragY] = useState(0)
  const onHeaderTouchStart = (e: React.TouchEvent) => {
    if (disableClose) return
    touchStartY.current = e.touches[0].clientY
  }
  const onHeaderTouchMove = (e: React.TouchEvent) => {
    if (touchStartY.current === null) return
    const dy = e.touches[0].clientY - touchStartY.current
    if (dy > 0) setDragY(dy)
  }
  const onHeaderTouchEnd = () => {
    if (touchStartY.current === null) return
    const shouldClose = dragY > 100
    touchStartY.current = null
    setDragY(0)
    if (shouldClose) requestClose()
  }

  const requestClose = useCallback(() => {
    if (disableClose) return
    if (isDirty) {
      setConfirmingClose(true)
    } else {
      onClose()
    }
  }, [disableClose, isDirty, onClose])

  useImperativeHandle(ref, () => ({ requestClose }), [requestClose])

  // Save trigger element on open; return focus to it on close
  useEffect(() => {
    if (open) {
      returnFocusRef.current = document.activeElement as HTMLElement
      const raf = requestAnimationFrame(() => {
        const focusable = getFocusable(panelRef.current)
        focusable[0]?.focus()
      })
      return () => cancelAnimationFrame(raf)
    } else {
      returnFocusRef.current?.focus()
      returnFocusRef.current = null
    }
  }, [open])

  // Tab trap — keep focus within modal
  useEffect(() => {
    if (!open) return
    const trap = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return
      const focusable = getFocusable(panelRef.current)
      if (!focusable.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (e.shiftKey) {
        if (document.activeElement === first) { e.preventDefault(); last.focus() }
      } else {
        if (document.activeElement === last) { e.preventDefault(); first.focus() }
      }
    }
    document.addEventListener('keydown', trap)
    return () => document.removeEventListener('keydown', trap)
  }, [open])

  // ESC — with dirty guard and disableClose guard
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (disableClose) return
      if (confirmingClose) {
        setConfirmingClose(false)
      } else {
        requestClose()
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, confirmingClose, disableClose, requestClose])

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
      {/* Backdrop — pointer-events-none when close is disabled (prevents mobile tap-through) */}
      <div
        className={`absolute inset-0 bg-black/50 backdrop-blur-sm ${
          disableClose || disableBackdropClose ? 'pointer-events-none' : ''
        }`}
        onClick={requestClose}
        aria-hidden="true"
      />

      {/* Panel — full-screen on mobile, centered card on sm+ */}
      <div
        ref={panelRef}
        className={`relative w-full bg-white flex flex-col h-[100dvh] sm:h-auto sm:rounded-2xl sm:shadow-2xl sm:${size} sm:max-h-[90vh] [animation:modal-enter_150ms_ease-out]`}
        style={dragY > 0 ? { transform: `translateY(${dragY}px)`, transition: 'none' } : undefined}
      >
        {/* Header — safe-area padding clears the notch when full-screen.
            Touch-drag down on the header swipes the modal closed on phones. */}
        <div
          className="flex items-center justify-between px-6 py-4 pt-[max(1rem,env(safe-area-inset-top))] sm:pt-4 border-b border-gray-100 shrink-0 relative"
          onTouchStart={onHeaderTouchStart}
          onTouchMove={onHeaderTouchMove}
          onTouchEnd={onHeaderTouchEnd}
        >
          {/* Drag handle — visual swipe affordance, phones only */}
          <span aria-hidden="true" className="sm:hidden absolute left-1/2 top-1.5 -translate-x-1/2 w-9 h-1 rounded-full bg-gray-300" />
          <h2 id="modal-title" className="text-base font-semibold text-gray-900">
            {title}
          </h2>
          <div className="flex items-center gap-2">
            {headerExtra}
            <button
              onClick={requestClose}
              disabled={disableClose}
              className={`min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg transition-colors ${
                disableClose
                  ? 'text-gray-200 cursor-not-allowed'
                  : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'
              }`}
              aria-label="Close modal"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Body — scrollable; overscroll-contain prevents iOS scroll chaining */}
        <div className="overflow-y-auto flex-1 px-6 py-5 overscroll-contain">
          {children}
        </div>

        {/* Sticky footer for action buttons — stacked full-width on phones */}
        {footer && (
          <div className="modal-footer-mobile shrink-0 px-6 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:pb-4 border-t border-gray-100 bg-white sm:rounded-b-2xl">
            {footer}
          </div>
        )}

        {/* Discard-changes confirmation overlay */}
        {confirmingClose && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/90 backdrop-blur-sm sm:rounded-2xl p-6">
            <div className="text-center space-y-4 max-w-xs w-full">
              <p className="font-semibold text-gray-900 text-base">
                {confirmTitle ?? 'Discard changes?'}
              </p>
              <p className="text-sm text-gray-500">
                {confirmMessage ?? 'You have unsaved changes that will be lost.'}
              </p>
              <div className="flex gap-3 justify-center">
                <button
                  type="button"
                  onClick={() => setConfirmingClose(false)}
                  className="flex-1 px-4 min-h-[44px] text-sm font-medium text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  {confirmKeepLabel ?? 'Continue Editing'}
                </button>
                <button
                  type="button"
                  onClick={() => { setConfirmingClose(false); onClose() }}
                  className="flex-1 px-4 min-h-[44px] text-sm font-medium text-white bg-danger rounded-lg hover:opacity-90 transition-colors"
                >
                  {confirmDiscardLabel ?? 'Discard Changes'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
})
