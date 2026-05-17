import { useState } from 'react'

export type ViewMode = 'table' | 'cards'

interface ViewToggleProps {
  storageKey: string
  value: ViewMode
  onChange: (v: ViewMode) => void
}

export function ViewToggle({ storageKey, value, onChange }: ViewToggleProps) {
  return (
    <div className="inline-flex items-center rounded-lg border border-gray-200 overflow-hidden text-sm font-medium">
      {(['table', 'cards'] as ViewMode[]).map(mode => (
        <button
          key={mode}
          type="button"
          onClick={() => {
            onChange(mode)
            try { localStorage.setItem(storageKey, mode) } catch { /* ignore */ }
          }}
          className={`px-3 py-1.5 transition-colors ${
            value === mode
              ? 'bg-primary text-white'
              : 'bg-white text-gray-600 hover:bg-gray-50'
          }`}
        >
          {mode === 'table' ? 'Table' : 'Cards'}
        </button>
      ))}
    </div>
  )
}

function getDefaultView(storageKey: string): ViewMode {
  try {
    const stored = localStorage.getItem(storageKey)
    if (stored === 'table' || stored === 'cards') return stored as ViewMode
  } catch { /* ignore */ }
  return typeof window !== 'undefined' && window.matchMedia('(min-width: 768px)').matches
    ? 'table'
    : 'cards'
}

export function useViewToggle(storageKey: string) {
  const [view, setView] = useState<ViewMode>(() => getDefaultView(storageKey))
  return { view, setView }
}
