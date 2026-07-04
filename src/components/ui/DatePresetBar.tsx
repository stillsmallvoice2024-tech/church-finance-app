import {
  startOfMonth, endOfMonth,
  subMonths,
  startOfYear, endOfYear,
  format,
} from 'date-fns'

export type DatePreset = 'this_month' | 'last_month' | 'ytd' | 'custom'

interface DatePresetBarProps {
  activePreset: DatePreset | null
  onPreset: (preset: DatePreset, from: string, to: string) => void
  onCustom: () => void
  hideCustom?: boolean
}

const PRESETS: { key: DatePreset; label: string }[] = [
  { key: 'this_month', label: 'This Month' },
  { key: 'last_month', label: 'Last Month' },
  { key: 'ytd',        label: 'This Year' },
  { key: 'custom',     label: 'Custom' },
]

function isoDate(d: Date) {
  return format(d, 'yyyy-MM-dd')
}

export function DatePresetBar({ activePreset, onPreset, onCustom, hideCustom = false }: DatePresetBarProps) {
  const today = new Date()
  const presets = hideCustom ? PRESETS.filter(p => p.key !== 'custom') : PRESETS

  const handleClick = (preset: DatePreset) => {
    if (preset === 'custom') {
      onCustom()
      return
    }
    let from: string
    let to: string
    if (preset === 'this_month') {
      from = isoDate(startOfMonth(today))
      to   = isoDate(endOfMonth(today))
    } else if (preset === 'last_month') {
      const prev = subMonths(today, 1)
      from = isoDate(startOfMonth(prev))
      to   = isoDate(endOfMonth(prev))
    } else {
      from = isoDate(startOfYear(today))
      to   = isoDate(endOfYear(today))
    }
    onPreset(preset, from, to)
  }

  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label="Date presets">
      {presets.map(({ key, label }) => {
        const active = activePreset === key
        return (
          <button
            key={key}
            type="button"
            onClick={() => handleClick(key)}
            aria-pressed={active}
            className={`px-3 py-1 text-xs font-medium rounded-full border transition-colors ${
              active
                ? 'bg-primary text-white border-primary'
                : 'bg-white text-gray-600 border-gray-200 hover:border-primary/40 hover:text-primary'
            }`}
          >
            {label}
          </button>
        )
      })}
    </div>
  )
}
