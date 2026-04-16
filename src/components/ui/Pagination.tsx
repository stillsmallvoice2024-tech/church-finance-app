import { ChevronLeft, ChevronRight } from 'lucide-react'

interface PaginationProps {
  page: number          // 0-indexed
  pageSize: number
  total: number         // total matching rows
  onChange: (page: number) => void
}

export function Pagination({ page, pageSize, total, onChange }: PaginationProps) {
  const totalPages = Math.ceil(total / pageSize)
  if (totalPages <= 1) return null

  const from = page * pageSize + 1
  const to   = Math.min((page + 1) * pageSize, total)

  // Build visible page numbers: always show first, last, and ±1 around current
  const pages: (number | '…')[] = []
  for (let i = 0; i < totalPages; i++) {
    if (i === 0 || i === totalPages - 1 || Math.abs(i - page) <= 1) {
      pages.push(i)
    } else if (pages[pages.length - 1] !== '…') {
      pages.push('…')
    }
  }

  return (
    <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-4 py-3 border-t border-gray-100">
      <p className="text-xs text-gray-500">
        Showing <span className="font-medium text-gray-700">{from}–{to}</span> of{' '}
        <span className="font-medium text-gray-700">{total.toLocaleString()}</span> records
      </p>

      <div className="flex items-center gap-1">
        <PageBtn
          onClick={() => onChange(page - 1)}
          disabled={page === 0}
          aria-label="Previous page"
        >
          <ChevronLeft className="w-4 h-4" />
        </PageBtn>

        {pages.map((p, i) =>
          p === '…' ? (
            <span key={`ellipsis-${i}`} className="px-2 text-gray-400 text-sm select-none">
              …
            </span>
          ) : (
            <PageBtn
              key={p}
              onClick={() => onChange(p as number)}
              active={p === page}
            >
              {(p as number) + 1}
            </PageBtn>
          ),
        )}

        <PageBtn
          onClick={() => onChange(page + 1)}
          disabled={page >= totalPages - 1}
          aria-label="Next page"
        >
          <ChevronRight className="w-4 h-4" />
        </PageBtn>
      </div>
    </div>
  )
}

// ── Tiny button helper ─────────────────────────────────────────────────────────

function PageBtn({
  children,
  onClick,
  disabled,
  active,
  'aria-label': ariaLabel,
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
      className={`min-w-[2rem] h-8 px-2 text-sm rounded-lg font-medium transition-colors
        ${active
          ? 'bg-primary text-white'
          : 'text-gray-600 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed'
        }`}
    >
      {children}
    </button>
  )
}
