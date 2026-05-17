import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { CheckCircle2, XCircle, AlertTriangle, Info, X } from 'lucide-react'
import { useToastStore, type Toast } from '../../store/toastStore'

// ── Per-type config ────────────────────────────────────────────────────────────

const STYLES = {
  success: {
    bar:  'bg-success',
    icon: <CheckCircle2 className="w-4 h-4 text-success shrink-0" />,
    text: 'text-success',
  },
  error: {
    bar:  'bg-danger',
    icon: <XCircle      className="w-4 h-4 text-danger  shrink-0" />,
    text: 'text-danger',
  },
  warning: {
    bar:  'bg-accent',
    icon: <AlertTriangle className="w-4 h-4 text-accent  shrink-0" />,
    text: 'text-accent',
  },
  info: {
    bar:  'bg-primary',
    icon: <Info          className="w-4 h-4 text-primary shrink-0" />,
    text: 'text-primary',
  },
} as const

// ── Single toast ───────────────────────────────────────────────────────────────

function ToastItem({ toast }: { toast: Toast }) {
  const { dismiss } = useToastStore()
  const s = STYLES[toast.type]

  useEffect(() => {
    const timer = setTimeout(() => dismiss(toast.id), 4000)
    return () => clearTimeout(timer)
  }, [toast.id, dismiss])

  return (
    <div
      className="flex items-center gap-3 bg-white border border-gray-100 rounded-xl shadow-lg px-4 py-3 w-80 max-w-[calc(100vw-2.5rem)]"
      style={{ animation: 'fadeUp 0.2s ease-out' }}
      role="alert"
      aria-live="polite"
    >
      <span className={`w-1 self-stretch rounded-full shrink-0 ${s.bar}`} />
      {s.icon}
      <p className="text-sm text-gray-800 flex-1 leading-snug">{toast.message}</p>
      <button
        onClick={() => dismiss(toast.id)}
        className="p-1 rounded text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors shrink-0"
        aria-label="Dismiss"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}

// ── Container ──────────────────────────────────────────────────────────────────

export function ToastContainer() {
  const { toasts } = useToastStore()
  if (toasts.length === 0) return null

  return createPortal(
    <div
      className="toast-safe-bottom fixed right-4 md:bottom-5 md:right-5 z-[200] flex flex-col gap-2 pointer-events-none"
      aria-label="Notifications"
    >
      {toasts.map((t) => (
        <div key={t.id} className="pointer-events-auto">
          <ToastItem toast={t} />
        </div>
      ))}
    </div>,
    document.body,
  )
}
