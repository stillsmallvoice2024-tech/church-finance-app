interface RowWindowBarProps {
  /** 0-indexed window number. Window size is `pageSize`. */
  page: number
  pageSize: number
  total: number
  onPageChange: (p: number) => void
  onPageSizeChange?: (s: number) => void
  pageSizeOptions?: number[]
}

/**
 * A sliding window over a long list: "Load next 50" / "Load previous 50".
 *
 * Deliberately not page numbers. For import rows the user is working through a
 * list rather than navigating to a known position, so numbered pages are noise —
 * what matters is moving forward and being able to step back. The window
 * replaces its contents rather than appending, so the mounted row count stays
 * flat no matter how far in the user goes.
 */
export function RowWindowBar({
  page, pageSize, total, onPageChange, onPageSizeChange, pageSizeOptions = [25, 50, 100, 200],
}: RowWindowBarProps) {
  if (total === 0) return null

  const start = page * pageSize
  const end   = Math.min(start + pageSize, total)
  const hasPrev = start > 0
  const hasNext = end < total

  const btn = 'px-2.5 py-1 text-xs font-medium rounded-lg border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:hover:bg-white'

  return (
    <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-t border-gray-100">
      <span className="text-xs text-gray-500">
        Showing <span className="font-medium text-gray-700">{(start + 1).toLocaleString()}–{end.toLocaleString()}</span>
        {' '}of {total.toLocaleString()}
      </span>

      <div className="ml-auto flex items-center gap-1.5">
        {onPageSizeChange && (
          <>
            <span className="text-xs text-gray-500">Per load:</span>
            <select
              value={pageSize}
              onChange={e => onPageSizeChange(parseInt(e.target.value, 10))}
              className="text-xs border border-gray-200 rounded-lg px-2 py-1 bg-white text-gray-600 focus:outline-none focus:ring-2 focus:ring-primary/20"
            >
              {pageSizeOptions.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          </>
        )}
        <button type="button" className={btn} disabled={!hasPrev}
          onClick={() => onPageChange(Math.max(0, page - 1))}>
          Load previous {Math.min(pageSize, start)}
        </button>
        <button type="button" className={btn} disabled={!hasNext}
          onClick={() => onPageChange(page + 1)}>
          Load next {Math.min(pageSize, total - end)}
        </button>
      </div>
    </div>
  )
}
