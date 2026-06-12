import { useState, type ReactNode, type UIEvent } from 'react'
import { TableRowSkeleton } from './LoadingSkeleton'

export interface Column<T> {
  key: string
  header: string
  render?: (row: T) => ReactNode
  className?: string
  rightAlign?: boolean
}

interface DataTableProps<T> {
  columns: Column<T>[]
  data: T[]
  keyExtractor: (row: T) => string
  isLoading?: boolean
  emptyMessage?: string
  emptyIcon?: ReactNode
}

export function DataTable<T>({
  columns,
  data,
  keyExtractor,
  isLoading = false,
  emptyMessage = 'No records found.',
  emptyIcon,
}: DataTableProps<T>) {
  // Headers stick inside this scroll container; a soft shadow appears once
  // rows have scrolled beneath them so the boundary stays visible.
  const [scrolled, setScrolled] = useState(false)
  const onScroll = (e: UIEvent<HTMLDivElement>) => {
    const isScrolled = e.currentTarget.scrollTop > 0
    setScrolled(prev => (prev === isScrolled ? prev : isScrolled))
  }
  return (
    <div className="overflow-auto max-h-[70vh]" onScroll={onScroll}>
      <table className="min-w-full">
        <thead className={`sticky top-0 z-10 transition-shadow ${scrolled ? 'shadow-sm' : ''}`}>
          <tr className="bg-gray-50 dark:bg-gray-800/50 border-b border-gray-100 dark:border-gray-700">
            {columns.map((col) => (
              <th
                key={col.key}
                scope="col"
                className={`px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 ${col.rightAlign ? 'text-right' : 'text-left'} ${col.className ?? ''}`}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 dark:divide-gray-700/50">
          {isLoading ? (
            Array.from({ length: 5 }).map((_, i) => (
              <TableRowSkeleton key={i} cols={columns.length} />
            ))
          ) : data.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="px-4 py-12 text-center">
                <div className="flex flex-col items-center gap-2 text-gray-400">
                  {emptyIcon && <div className="text-gray-300">{emptyIcon}</div>}
                  <p className="text-sm">{emptyMessage}</p>
                </div>
              </td>
            </tr>
          ) : (
            data.map((row) => (
              <tr key={keyExtractor(row)} className="hover:bg-gray-50 transition-colors">
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={`px-4 py-3 text-sm text-gray-700 ${col.className ?? ''}`}
                  >
                    {col.render
                      ? col.render(row)
                      : String((row as Record<string, unknown>)[col.key] ?? '')}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}
