import { useState, useEffect } from 'react'

export interface TooltipState {
  id: string
  text: string
  x: number
  y: number
}

export function useDescriptionExpand() {
  const [tooltip, setTooltip] = useState<TooltipState | null>(null)

  useEffect(() => {
    if (!tooltip) return
    const dismiss = () => setTooltip(null)
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') dismiss() }
    document.addEventListener('click', dismiss)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('click', dismiss)
      document.removeEventListener('keydown', onKey)
    }
  }, [tooltip])

  return { tooltip, setTooltip }
}
