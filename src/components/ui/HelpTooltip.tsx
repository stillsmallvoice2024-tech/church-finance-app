import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { HelpCircle } from 'lucide-react'

interface HelpTooltipProps {
  content: string
  /** Tooltip position relative to trigger. Defaults to 'top'. */
  placement?: 'top' | 'bottom' | 'left' | 'right'
  /** Icon size class. Defaults to 'w-3.5 h-3.5'. */
  iconSize?: string
  className?: string
}

/**
 * Lightweight contextual help tooltip.
 * Usage: <HelpTooltip content="Tithes are regular income contributions from members." />
 */
export function HelpTooltip({
  content,
  placement = 'top',
  iconSize = 'w-3.5 h-3.5',
  className = '',
}: HelpTooltipProps) {
  const [visible, setVisible] = useState(false)
  const [pos, setPos]         = useState({ top: 0, left: 0 })
  const triggerRef = useRef<HTMLButtonElement>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)

  const TOOLTIP_WIDTH = 240
  const GAP           = 8

  const computePos = () => {
    if (!triggerRef.current) return
    const r  = triggerRef.current.getBoundingClientRect()
    const W  = window.innerWidth

    let top  = 0
    let left = 0

    switch (placement) {
      case 'bottom':
        top  = r.bottom + GAP
        left = r.left + r.width / 2 - TOOLTIP_WIDTH / 2
        break
      case 'left':
        top  = r.top + r.height / 2 - 20
        left = r.left - TOOLTIP_WIDTH - GAP
        break
      case 'right':
        top  = r.top + r.height / 2 - 20
        left = r.right + GAP
        break
      case 'top':
      default:
        top  = r.top - GAP - 50 // approximate
        left = r.left + r.width / 2 - TOOLTIP_WIDTH / 2
        break
    }

    // Clamp horizontally
    left = Math.max(8, Math.min(left, W - TOOLTIP_WIDTH - 8))

    setPos({ top, left })
  }

  const show = () => {
    computePos()
    setVisible(true)
  }
  const hide = () => setVisible(false)

  // Close on Escape
  useEffect(() => {
    if (!visible) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') hide() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [visible])

  // Close on outside click
  useEffect(() => {
    if (!visible) return
    const onClick = (e: MouseEvent) => {
      if (
        triggerRef.current && !triggerRef.current.contains(e.target as Node) &&
        tooltipRef.current  && !tooltipRef.current.contains(e.target as Node)
      ) {
        hide()
      }
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [visible])

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label="Help"
        aria-expanded={visible}
        className={`inline-flex items-center justify-center text-gray-400 hover:text-primary dark:hover:text-primary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 rounded ${className}`}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        onClick={(e) => { e.stopPropagation(); visible ? hide() : show() }}
      >
        <HelpCircle className={iconSize} />
      </button>

      {visible && createPortal(
        <div
          ref={tooltipRef}
          role="tooltip"
          className="fixed z-[9990] bg-gray-900 dark:bg-[#1c1c1e] text-white text-xs rounded-lg px-3 py-2 shadow-xl leading-snug pointer-events-none"
          style={{ top: pos.top, left: pos.left, width: TOOLTIP_WIDTH, maxWidth: 'calc(100vw - 16px)' }}
        >
          {content}
        </div>,
        document.body,
      )}
    </>
  )
}
