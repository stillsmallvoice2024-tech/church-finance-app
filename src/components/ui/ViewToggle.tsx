import { useState } from 'react'

export type ViewMode = 'table' | 'cards' | 'grouped'

/** Modes offered by default. 'grouped' is opt-in — see `modes`. */
const DEFAULT_MODES: ViewMode[] = ['table', 'cards']

const LABELS: Record<ViewMode, string> = {
  table:   'Table',
  cards:   'Cards',
  grouped: 'Grouped',
}

interface ViewToggleProps {
  storageKey: string
  value: ViewMode
  onChange: (v: ViewMode) => void
  /**
   * Which modes to offer. Defaults to table + cards so existing callers are
   * unaffected; the import wizard opts into 'grouped' as a third mode.
   */
  modes?: ViewMode[]
}

export function ViewToggle({ storageKey, value, onChange, modes = DEFAULT_MODES }: ViewToggleProps) {
  return (
    <div
      role="group"
      aria-label="View mode"
      className="inline-flex items-center rounded-lg border border-gray-200 overflow-hidden text-sm font-medium"
    >
      {modes.map(mode => (
        <button
          key={mode}
          type="button"
          aria-pressed={value === mode}
          onClick={() => {
            onChange(mode)
            try { localStorage.setItem(storageKey, mode) } catch { /* ignore */ }
          }}
          className={`px-3 py-1.5 min-h-[40px] transition-colors ${
            value === mode
              ? 'bg-primary text-white'
              : 'bg-white text-gray-600 hover:bg-gray-50'
          }`}
        >
          {LABELS[mode]}
        </button>
      ))}
    </div>
  )
}

function getDefaultView(storageKey: string, modes: ViewMode[]): ViewMode {
  try {
    const stored = localStorage.getItem(storageKey) as ViewMode | null
    // Ignore a stored mode the caller no longer offers — otherwise a persisted
    // 'grouped' would leak into a toggle that only renders table/cards.
    if (stored && modes.includes(stored)) return stored
  } catch { /* ignore */ }
  const wide = typeof window !== 'undefined' && window.matchMedia('(min-width: 768px)').matches
  const preferred: ViewMode = wide ? 'table' : 'cards'
  return modes.includes(preferred) ? preferred : modes[0]
}

export function useViewToggle(storageKey: string, modes: ViewMode[] = DEFAULT_MODES) {
  const [view, setView] = useState<ViewMode>(() => getDefaultView(storageKey, modes))
  return { view, setView }
}
