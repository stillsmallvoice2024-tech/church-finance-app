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
  children?: React.ReactNode
}

export function SortableHeader({
  field,
  activeSortKey,
  activeSortDir,
  onSort,
  className = '',
  rightAlign = false,
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
    <th className={`px-4 py-3 font-medium ${className}`}>
      <button
        type="button"
        onClick={handleClick}
        className={`inline-flex items-center gap-1 transition-colors group whitespace-nowrap ${
          rightAlign ? 'ml-auto flex-row-reverse' : ''
        } ${isActive ? 'text-primary' : 'text-gray-500 hover:text-gray-700'}`}
      >
        {label}
        <span className={`transition-opacity ${isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-40'}`}>
          {isActive
            ? (activeSortDir === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)
            : <ChevronDown className="w-3 h-3" />
          }
        </span>
      </button>
    </th>
  )
}
