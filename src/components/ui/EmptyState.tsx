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
      <div className={`rounded-full bg-gray-100 flex items-center justify-center mb-3 ${compact ? 'w-10 h-10' : 'w-14 h-14'}`}>
        <Icon className={`text-gray-300 ${compact ? 'w-5 h-5' : 'w-7 h-7'}`} />
      </div>
      <p className={`font-medium text-gray-500 ${compact ? 'text-sm' : 'text-base'}`}>{title}</p>
      {message && (
        <p className="text-xs text-gray-400 mt-1 max-w-xs">{message}</p>
      )}
      {action && (
        <button
          onClick={action.onClick}
          className="mt-3 text-xs font-medium text-primary underline hover:no-underline"
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
    <div className="flex items-center justify-center h-full min-h-[120px] text-sm text-gray-400">
      {message}
    </div>
  )
}
