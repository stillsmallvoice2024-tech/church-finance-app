import { createPortal } from 'react-dom'
import type { TooltipState } from '../../hooks/useDescriptionExpand'

interface DescriptionCellProps {
  id: string
  text: string | null
  tooltip: TooltipState | null
  setTooltip: (t: TooltipState | null) => void
  textCls?: string
}

export function DescriptionCell({
  id,
  text,
  tooltip,
  setTooltip,
  textCls = 'text-gray-700',
}: DescriptionCellProps) {
  if (!text) return <span className={`${textCls} select-none`}>—</span>

  const show = (el: HTMLElement) => {
    const rect = el.getBoundingClientRect()
    setTooltip({ id, text, x: rect.left, y: rect.bottom + 4 })
  }

  return (
    <div className="min-w-0">
      <div
        role="button"
        tabIndex={0}
        aria-label={text}
        className={`${textCls} truncate cursor-pointer select-none rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/50`}
        style={{ touchAction: 'manipulation' }}
        onPointerEnter={e => { if (e.pointerType === 'mouse') show(e.currentTarget) }}
        onPointerLeave={e => { if (e.pointerType === 'mouse') setTooltip(null) }}
        onClick={e => { e.stopPropagation(); show(e.currentTarget) }}
        onFocus={e => show(e.currentTarget)}
        onBlur={() => setTooltip(null)}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); show(e.currentTarget) }
        }}
      >
        {text}
      </div>
    </div>
  )
}

export function DescriptionTooltip({ tooltip }: { tooltip: TooltipState | null }) {
  if (!tooltip) return null
  const left = Math.min(Math.max(tooltip.x, 8), window.innerWidth - 328)
  return createPortal(
    <div
      className="fixed z-[9999] max-w-xs sm:max-w-sm bg-gray-900 text-white text-xs rounded-lg px-3 py-2 shadow-xl pointer-events-none break-words leading-snug"
      style={{ top: tooltip.y, left }}
    >
      {tooltip.text}
    </div>,
    document.body,
  )
}
