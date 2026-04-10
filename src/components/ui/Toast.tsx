import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { CheckCircle, XCircle, Info, X } from 'lucide-react'
import { useToastStore, type Toast } from '../../store/toastStore'

// ── Single toast item ──────────────────────────────────────────────────────────

function ToastItem({ toast }: { toast: Toast }) {
  const { dismiss } = useToastStore()

  // Auto-dismiss after 4 s
  useEffect(() => {
    const t = setTimeout(() => dismiss(toast.id), 4000)
    return () => clearTimeout(t)
  }, [toast.id, dismiss])

  const styles = {
    success: { bar: 'bg-success', icon: <CheckCircle className="w-5 h-5 text-success shrink-0" /> },
    error:   { bar: 'bg-danger',  icon: <XCircle    className="w-5 h-5 text-danger  shrink-0" /> },
    info:    { bar: 'bg-primary', icon: <Info        className="w-5 h-5 text-primary shrink-0" /> },
  }[toast.type]

  return (
    <div className="flex items-center gap-3 bg-white border border-gray-100 rounded-xl shadow-lg px-4 py-3 min-w-72 max-w-sm animate-[fadeUp_0.2s_ease-out]">
      {/* Left coloured bar */}
      <span className={`w-1 self-stretch rounded-full ${styles.bar}`} />
      {styles.icon}
      <p className="text-sm text-gray-800 flex-1 leading-snug">{toast.message}</p>
      <button
        onClick={() => dismiss(toast.id)}
        className="p-1 rounded text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
        aria-label="Dismiss"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  )
}

// ── Container ──────────────────────────────────────────────────────────────────

export function ToastContainer() {
  const { toasts } = useToastStore()

  return createPortal(
    <div className="fixed bottom-5 right-5 z-[100] flex flex-col gap-2 pointer-events-none">
      {toasts.map((t) => (
        <div key={t.id} className="pointer-events-auto">
          <ToastItem toast={t} />
        </div>
      ))}
    </div>,
    document.body,
  )
}
