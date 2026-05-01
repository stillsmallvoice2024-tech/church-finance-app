import { useState } from 'react'

export interface TooltipState {
  id: string
  text: string
  x: number
  y: number
}

export function useDescriptionExpand() {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [tooltip, setTooltip] = useState<TooltipState | null>(null)

  const toggle = (id: string) =>
    setExpandedIds(prev => {
      const s = new Set(prev)
      s.has(id) ? s.delete(id) : s.add(id)
      return s
    })

  return { expandedIds, tooltip, setTooltip, toggle }
}
