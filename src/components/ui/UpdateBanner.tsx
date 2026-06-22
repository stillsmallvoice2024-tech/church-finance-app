import { RefreshCw, X } from 'lucide-react'
import { useVersionCheck } from '../../hooks/useVersionCheck'

export function UpdateBanner() {
  const { updateAvailable, dismiss } = useVersionCheck()
  if (!updateAvailable) return null

  return (
    <div
      className="flex items-center justify-between gap-3 bg-primary dark:bg-primary-dm px-4 py-2 text-white text-sm shrink-0"
      role="status"
      aria-live="polite"
    >
      <span className="flex items-center gap-2">
        <RefreshCw className="w-3.5 h-3.5 shrink-0" />
        App updated — refresh to get the latest version.
      </span>
      <div className="flex items-center gap-2 shrink-0">
        <button
          onClick={() => window.location.reload()}
          className="px-3 py-0.5 bg-white/20 hover:bg-white/30 rounded text-white font-medium transition-colors text-xs"
        >
          Refresh now
        </button>
        <button
          onClick={dismiss}
          className="p-1 rounded hover:bg-white/20 transition-colors"
          aria-label="Dismiss"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  )
}
