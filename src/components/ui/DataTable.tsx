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
          <tr className="border-b-2 border-black/[0.06] dark:border-white/[0.07]">
            {columns.map((col) => (
              <th
                key={col.key}
                scope="col"
                className={`px-4 py-3 text-[11px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest ${col.rightAlign ? 'text-right' : 'text-left'} ${col.className ?? ''}`}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-black/[0.05] dark:divide-white/[0.05]">
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
            data.map((row, index) => (
              <tr
                key={keyExtractor(row)}
                className="hover:bg-black/[0.02] dark:hover:bg-white/[0.03] transition-colors"
                style={{ animation: `row-fade-in 200ms ease-out ${Math.min(index, 12) * 28}ms both` }}
              >
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
