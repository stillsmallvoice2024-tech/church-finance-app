import { useState, useEffect } from 'react'
import { X, Info } from 'lucide-react'

interface Props {
  storageKey: string
  title:      string
  children:   React.ReactNode
}

export function PageHelpBanner({ storageKey, title, children }: Props) {
  const [dismissed, setDismissed] = useState(() => {
    try { return localStorage.getItem(storageKey) === '1' } catch { return false }
  })

  useEffect(() => {
    if (dismissed) {
      try { localStorage.setItem(storageKey, '1') } catch {}
    }
  }, [dismissed, storageKey])

  if (dismissed) return null

  return (
    <div
      role="note"
      className="flex items-start gap-3 rounded-xl border border-blue-200 bg-blue-50 dark:border-blue-800/50 dark:bg-blue-900/20 px-4 py-3 text-sm print:hidden"
    >
      <Info className="w-4 h-4 text-blue-500 dark:text-blue-400 shrink-0 mt-0.5" aria-hidden="true" />
      <div className="flex-1 min-w-0">
        <p className="font-medium text-blue-800 dark:text-blue-300 mb-0.5">{title}</p>
        <div className="text-blue-700 dark:text-blue-400 text-xs leading-relaxed">{children}</div>
      </div>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        className="shrink-0 text-blue-400 hover:text-blue-600 dark:hover:text-blue-300 transition-colors"
        aria-label="Dismiss help banner"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  )
}
