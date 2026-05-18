import { ChevronLeft, ChevronRight } from 'lucide-react'

interface PaginationBarProps {
  page: number        // 0-indexed
  pageSize: number
  total: number
  onPageChange: (p: number) => void
  onPageSizeChange?: (s: number) => void
  pageSizeOptions?: number[]
  variant: 'compact' | 'full'
}

export function PaginationBar({
  page, pageSize, total, onPageChange,
  onPageSizeChange, pageSizeOptions = [10, 25, 50],
  variant,
}: PaginationBarProps) {
  const totalPages = Math.ceil(total / pageSize)

  // Compact: hide entirely when nothing to page through
  if (variant === 'compact' && totalPages <= 1) return null

  // Full + single page: show only the per-page selector so the user can always
  // switch to a smaller size after choosing one large enough to fit all rows
  if (variant === 'full' && totalPages <= 1) {
    if (!onPageSizeChange) return null
    return (
      <div className="flex items-center justify-end py-2 px-1">
        <div className="flex items-center gap-1.5 text-xs text-gray-500">
          <span>Per page:</span>
          <select
            value={pageSize}
            onChange={e => onPageSizeChange(parseInt(e.target.value, 10))}
            className="text-xs border border-gray-200 rounded-lg px-2 py-1 bg-white text-gray-600 focus:outline-none focus:ring-2 focus:ring-primary/20"
          >
            {pageSizeOptions.map(o => (
              <option key={o} value={o}>{o}</option>
            ))}
          </select>
        </div>
      </div>
    )
  }

  const from = total === 0 ? 0 : page * pageSize + 1
  const to = Math.min((page + 1) * pageSize, total)

  if (variant === 'compact') {
    return (
      <div className="flex items-center justify-between py-1.5 px-1">
        <button
          type="button"
          onClick={() => onPageChange(page - 1)}
          disabled={page === 0}
          className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors px-1 py-0.5 rounded"
        >
          <ChevronLeft className="w-3.5 h-3.5" />
          Prev
        </button>
        <p className="text-xs text-gray-500">
          <span className="font-medium text-gray-700">{from}–{to}</span>
          {' '}of{' '}
          <span className="font-medium text-gray-700">{total.toLocaleString()}</span>
        </p>
        <button
          type="button"
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages - 1}
          className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors px-1 py-0.5 rounded"
        >
          Next
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>
    )
  }

  // Full variant — page numbers + per-page selector
  const pages: (number | '…')[] = []
  for (let i = 0; i < totalPages; i++) {
    if (i === 0 || i === totalPages - 1 || Math.abs(i - page) <= 1) {
      pages.push(i)
    } else if (pages[pages.length - 1] !== '…') {
      pages.push('…')
    }
  }

  return (
    <div className="flex flex-col sm:flex-row items-center justify-between gap-3 py-3 px-1">
      <p className="text-xs text-gray-500 order-2 sm:order-1">
        Showing{' '}
        <span className="font-medium text-gray-700">{from}–{to}</span>
        {' '}of{' '}
        <span className="font-medium text-gray-700">{total.toLocaleString()}</span>
        {' '}records
      </p>

      <div className="flex items-center gap-3 order-1 sm:order-2">
        {onPageSizeChange && (
          <div className="flex items-center gap-1.5 text-xs text-gray-500">
            <span className="hidden sm:inline">Per page:</span>
            <select
              value={pageSize}
              onChange={e => onPageSizeChange(parseInt(e.target.value, 10))}
              className="text-xs border border-gray-200 rounded-lg px-2 py-1 bg-white text-gray-600 focus:outline-none focus:ring-2 focus:ring-primary/20"
            >
              {pageSizeOptions.map(o => (
                <option key={o} value={o}>{o}</option>
              ))}
            </select>
          </div>
        )}

        <div className="flex items-center gap-1">
          <PageBtn onClick={() => onPageChange(page - 1)} disabled={page === 0} aria-label="Previous page">
            <ChevronLeft className="w-4 h-4" />
          </PageBtn>
          {pages.map((p, i) =>
            p === '…' ? (
              <span key={`e${i}`} className="px-1.5 text-gray-400 text-sm select-none">…</span>
            ) : (
              <PageBtn key={p} onClick={() => onPageChange(p as number)} active={p === page}>
                {(p as number) + 1}
              </PageBtn>
            )
          )}
          <PageBtn onClick={() => onPageChange(page + 1)} disabled={page >= totalPages - 1} aria-label="Next page">
            <ChevronRight className="w-4 h-4" />
          </PageBtn>
        </div>
      </div>
    </div>
  )
}

function PageBtn({
  children, onClick, disabled, active, 'aria-label': ariaLabel,
}: {
  children: React.ReactNode
  onClick: () => void
  disabled?: boolean
  active?: boolean
  'aria-label'?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      className={`min-w-[2rem] h-8 px-2 text-sm rounded-lg font-medium transition-colors ${
        active
          ? 'bg-primary text-white'
          : 'text-gray-600 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed'
      }`}
    >
      {children}
    </button>
  )
}
