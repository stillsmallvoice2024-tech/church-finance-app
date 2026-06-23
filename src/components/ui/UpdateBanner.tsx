import { RefreshCw, X } from 'lucide-react'
import { useVersionCheck } from '../../hooks/useVersionCheck'

export function UpdateBanner() {
  const { updateAvailable, dismiss } = useVersionCheck()
  if (!updateAvailable) return null

  return (
    <div
      className="relative bg-primary dark:bg-primary-dm px-4 py-2 text-white text-sm shrink-0"
      role="status"
      aria-live="polite"
    >
      {/* Centred content — pr-8 leaves room so dismiss button never overlaps text */}
      <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 pr-8">
        <span className="flex items-center gap-2 text-center">
          <RefreshCw className="w-3.5 h-3.5 shrink-0" />
          App updated — refresh to get the latest version.
        </span>
        <button
          onClick={() => window.location.reload()}
          className="px-3 py-0.5 bg-white/20 hover:bg-white/30 rounded font-medium transition-colors text-xs whitespace-nowrap"
        >
          Refresh now
        </button>
      </div>

      {/* Dismiss — absolutely positioned so it never disrupts centred layout */}
      <button
        onClick={dismiss}
        className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-white/20 transition-colors"
        aria-label="Dismiss"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}
