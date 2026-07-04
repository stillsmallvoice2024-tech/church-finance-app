import { Sparkles, Upload } from 'lucide-react'

export type ImportMode = 'guided' | 'quick'

interface Option {
  mode:  ImportMode
  icon:  React.ElementType
  title: string
  desc:  string
  files: string
}

const OPTIONS: Option[] = [
  {
    mode:  'guided',
    icon:  Sparkles,
    title: 'Guided Import',
    desc:  'Step-by-step: auto-detects columns, picks category & budget plan, checks duplicates, then imports.',
    files: 'Excel only — .xlsx, .xls',
  },
  {
    mode:  'quick',
    icon:  Upload,
    title: 'Quick Import',
    desc:  'Drag a file in, map columns yourself, review and commit. Fastest for familiar statements.',
    files: 'Excel, CSV or PDF — .xlsx, .xls, .csv, .pdf',
  },
]

// Persisted last choice (localStorage — mirrors ViewToggle pattern).
const STORAGE_KEY = 'import-mode'

export function getDefaultImportMode(): ImportMode {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === 'guided' || stored === 'quick') return stored
  } catch { /* ignore */ }
  return 'guided'
}

interface Props {
  value:    ImportMode
  onChange: (mode: ImportMode) => void
}

export function ImportModeChooser({ value, onChange }: Props) {
  const select = (mode: ImportMode) => {
    try { localStorage.setItem(STORAGE_KEY, mode) } catch { /* ignore */ }
    onChange(mode)
  }

  return (
    <div role="radiogroup" aria-label="Import method" className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {OPTIONS.map(({ mode, icon: Icon, title, desc, files }) => {
        const active = value === mode
        return (
          <button
            key={mode}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => select(mode)}
            className={`text-left rounded-xl border p-4 transition-colors ${
              active
                ? 'border-primary bg-primary/5 ring-1 ring-primary'
                : 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50'
            }`}
          >
            <div className="flex items-center gap-2 mb-1.5">
              <span className={`p-1.5 rounded-lg ${active ? 'bg-primary/10 text-primary' : 'bg-gray-100 text-gray-500'}`}>
                <Icon className="w-4 h-4" />
              </span>
              <span className="text-sm font-semibold text-gray-800 dark:text-gray-100">{title}</span>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400">{desc}</p>
            <p className="text-[11px] font-medium text-gray-400 mt-2">{files}</p>
          </button>
        )
      })}
    </div>
  )
}
