import type { LucideIcon } from 'lucide-react'
import { InboxIcon } from 'lucide-react'

interface EmptyStateProps {
  icon?:         LucideIcon
  title?:        string
  message?:      string
  action?:       { label: string; onClick: () => void }
  compact?:      boolean
}

export function EmptyState({
  icon: Icon = InboxIcon,
  title   = 'No records found',
  message,
  action,
  compact = false,
}: EmptyStateProps) {
  return (
    <div className={`flex flex-col items-center justify-center text-center ${compact ? 'py-8' : 'py-16'}`}>
      <div className={`rounded-full bg-primary/8 dark:bg-primary/12 flex items-center justify-center mb-4 ${compact ? 'w-10 h-10' : 'w-14 h-14'}`}>
        <Icon className={`text-primary/50 dark:text-primary-dm/60 ${compact ? 'w-5 h-5' : 'w-7 h-7'}`} />
      </div>
      <p className={`font-semibold text-gray-600 ${compact ? 'text-sm' : 'text-base'}`}>{title}</p>
      {message && (
        <p className="text-sm text-gray-400 mt-1.5 max-w-xs leading-relaxed">{message}</p>
      )}
      {action && (
        <button
          onClick={action.onClick}
          className="mt-5 px-5 min-h-[40px] inline-flex items-center justify-center text-sm font-semibold text-white bg-primary rounded-lg hover:bg-primary-dark transition-colors shadow-sm"
        >
          {action.label}
        </button>
      )}
    </div>
  )
}

// ── Chart variant ──────────────────────────────────────────────────────────────
export function ChartEmpty({ message = 'No data yet for this period' }: { message?: string }) {
  return (
    <div className="flex items-center justify-center h-full min-h-[120px] text-sm font-medium text-gray-400">
      {message}
    </div>
  )
}
