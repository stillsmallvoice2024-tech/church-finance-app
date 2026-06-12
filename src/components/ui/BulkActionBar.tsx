import { type ReactNode } from 'react'

export interface BulkActionConfig {
  key: string
  label: string
  icon?: ReactNode
  variant?: 'outline' | 'danger' | 'success'
  onClick: () => void
  disabled?: boolean
  loading?: boolean
  show?: boolean
}

export function BulkActionBar({ count, actions, onClear, summary }: {
  count: number
  actions: BulkActionConfig[]
  onClear: () => void
  summary?: ReactNode
}) {
  if (count === 0) return null

  return (
    <div className="flex flex-wrap items-center gap-2 sm:gap-3 px-4 py-2.5 border-b border-primary/10 bg-primary/5">
      <span className="text-sm font-medium text-primary">{count} selected</span>
      {summary}
      {actions.filter(a => a.show !== false).map(a => {
        const base = 'flex items-center gap-1.5 px-3 py-1.5 min-h-[40px] text-sm font-medium rounded-lg transition-colors disabled:opacity-50'
        const cls =
          a.variant === 'danger'
            ? `${base} text-white bg-danger hover:bg-red-700`
            : a.variant === 'success'
            ? `${base} text-green-700 bg-green-50 hover:bg-green-100`
            : `${base} text-primary bg-white border border-primary/30 hover:bg-primary/5`
        return (
          <button
            key={a.key}
            onClick={a.onClick}
            disabled={a.disabled || a.loading}
            className={cls}
          >
            {a.loading
              ? <span className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
              : a.icon}
            {a.label}
          </button>
        )
      })}
      <button
        onClick={onClear}
        className="ml-auto px-3 py-1.5 min-h-[40px] text-sm text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
      >
        Clear
      </button>
    </div>
  )
}
