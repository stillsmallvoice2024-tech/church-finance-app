import { ChevronUp, ChevronDown } from 'lucide-react'
import type { SortField, SortDirection } from '../../utils/sortUtils'
import { defaultDirForType } from '../../utils/sortUtils'

interface SortableHeaderProps {
  field: SortField
  activeSortKey: string
  activeSortDir: SortDirection
  onSort: (key: string, dir: SortDirection) => void
  className?: string
  rightAlign?: boolean
  /** Override inactive text colour, e.g. "text-success hover:text-success/80" */
  inactiveCls?: string
  children?: React.ReactNode
}

export function SortableHeader({
  field,
  activeSortKey,
  activeSortDir,
  onSort,
  className = '',
  rightAlign = false,
  inactiveCls = 'text-gray-500 hover:text-gray-700',
  children,
}: SortableHeaderProps) {
  const isActive = field.key === activeSortKey

  function handleClick() {
    onSort(
      field.key,
      !isActive ? defaultDirForType(field.type) : activeSortDir === 'asc' ? 'desc' : 'asc',
    )
  }

  const label = children ?? field.label

  return (
    <th
      className={`px-4 py-3 font-medium ${className}`}
      aria-sort={isActive ? (activeSortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      <button
        type="button"
        onClick={handleClick}
        className={`inline-flex items-center gap-1 min-h-[32px] transition-colors group whitespace-nowrap ${
          rightAlign ? 'ml-auto flex-row-reverse' : ''
        } ${isActive ? 'text-primary' : inactiveCls}`}
      >
        {label}
        {/* Chevron stays visible on touch devices (no hover) via opacity-40 fallback */}
        <span className={`transition-opacity ${isActive ? 'opacity-100' : 'opacity-40 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-40'}`}>
          {isActive
            ? (activeSortDir === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)
            : <ChevronDown className="w-3 h-3" />
          }
        </span>
      </button>
    </th>
  )
}
