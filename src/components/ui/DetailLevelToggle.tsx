import { LayoutGrid, List } from 'lucide-react'
import type { DetailLevel } from '../../hooks/useDetailLevel'

interface Props {
  value:    DetailLevel
  onChange: (level: DetailLevel) => void
}

// Segmented Simple / Full switch for progressive-disclosure pages.
export function DetailLevelToggle({ value, onChange }: Props) {
  const opts: { level: DetailLevel; label: string; icon: React.ElementType }[] = [
    { level: 'simple', label: 'Simple', icon: LayoutGrid },
    { level: 'full',   label: 'Full',   icon: List },
  ]
  return (
    <div
      role="group"
      aria-label="Detail level"
      className="inline-flex items-center rounded-lg border border-gray-200 overflow-hidden text-sm font-medium"
    >
      {opts.map(({ level, label, icon: Icon }) => (
        <button
          key={level}
          type="button"
          aria-pressed={value === level}
          onClick={() => onChange(level)}
          className={`flex items-center gap-1.5 px-3 py-1.5 min-h-[40px] transition-colors ${
            value === level ? 'bg-primary text-white' : 'bg-white text-gray-600 hover:bg-gray-50'
          }`}
        >
          <Icon className="w-3.5 h-3.5" />
          {label}
        </button>
      ))}
    </div>
  )
}
