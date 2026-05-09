import { createPortal } from 'react-dom'
import { ChevronDown } from 'lucide-react'
import type { TooltipState } from '../../hooks/useDescriptionExpand'

interface DescriptionCellProps {
  id: string
  text: string | null
  expanded: boolean
  onToggle: () => void
  tooltip: TooltipState | null
  setTooltip: (t: TooltipState | null) => void
}

export function DescriptionCell({
  id,
  text,
  expanded,
  onToggle,
  tooltip,
  setTooltip,
}: DescriptionCellProps) {
  return (
    <div className="min-w-0">
      <div
        className="text-gray-700 truncate cursor-pointer select-none flex items-center gap-1 group"
        onClick={onToggle}
        onMouseEnter={e => {
          if (!text) return
          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
          setTooltip({ id, text, x: rect.left, y: rect.bottom + 4 })
        }}
        onMouseLeave={() => setTooltip(null)}
      >
        <span className="truncate min-w-0">{text || '—'}</span>
        {text && (
          <ChevronDown
            className={`w-3 h-3 shrink-0 text-gray-300 group-hover:text-gray-500 transition-transform ${expanded ? 'rotate-180' : ''}`}
          />
        )}
      </div>
      {expanded && text && (
        <div className="mt-1 text-gray-600 break-words leading-snug bg-gray-50 rounded px-2 py-1 border border-gray-100 text-xs">
          {text}
        </div>
      )}
    </div>
  )
}

interface TooltipPortalProps {
  tooltip: TooltipState | null
}

export function DescriptionTooltip({ tooltip }: TooltipPortalProps) {
  if (!tooltip) return null
  return createPortal(
    <div
      className="fixed z-[9999] max-w-sm bg-gray-900 text-white text-xs rounded-lg px-3 py-2 shadow-xl pointer-events-none break-words leading-snug"
      style={{
        top:  tooltip.y,
        left: Math.min(tooltip.x, window.innerWidth - 320),
      }}
    >
      {tooltip.text}
    </div>,
    document.body,
  )
}
