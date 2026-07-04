import { useState, type ReactNode } from 'react'
import { ChevronDown, ArrowRight } from 'lucide-react'

// Reusable scaffold for a page's "Simple" (progressive-disclosure) view.
// Fill the slots; the shell owns the layout, the "More insights" peel (with
// per-page persistence), and the "View all" reveal. Each page supplies its own
// hero / ranges / insights / body content.

interface SimpleShellProps {
  pageId:        string        // used for the insights-open localStorage key
  hero:          ReactNode     // the headline card (e.g. total)
  filters?:      ReactNode     // optional chip row (date presets, group filters, …)
  bodyTitle:     string        // heading above the body (e.g. "Recent inflows")
  insights?:     ReactNode     // optional; when present a "More insights" toggle appears
  body:          ReactNode     // the main list/content
  onViewAll:     () => void
  viewAllLabel?: string
}

export function SimpleShell({
  pageId, hero, filters, bodyTitle, insights, body, onViewAll,
  viewAllLabel = 'View all transactions',
}: SimpleShellProps) {
  const storageKey = `${pageId}-insights-open`
  const [showInsights, setShowInsights] = useState<boolean>(() => {
    try { return localStorage.getItem(storageKey) === 'true' } catch { return false }
  })

  const toggleInsights = () => {
    setShowInsights(prev => {
      const next = !prev
      try { localStorage.setItem(storageKey, String(next)) } catch { /* ignore */ }
      return next
    })
  }

  return (
    <div className="space-y-4">
      {hero}
      {filters}

      {/* Body header + optional insights toggle */}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-700">{bodyTitle}</h2>
        {insights && (
          <button
            type="button"
            onClick={toggleInsights}
            aria-expanded={showInsights}
            className="flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-gray-700 transition-colors"
          >
            {showInsights ? 'Hide insights' : 'More insights'}
            <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showInsights ? 'rotate-180' : ''}`} />
          </button>
        )}
      </div>

      {/* Insights render before the body so the body flows into "View all" */}
      {insights && showInsights && insights}

      {body}

      <button
        type="button"
        onClick={onViewAll}
        className="w-full flex items-center justify-center gap-1.5 px-4 py-2.5 text-sm font-medium text-primary border border-primary/30 rounded-lg hover:bg-primary/5 transition-colors"
      >
        {viewAllLabel}
        <ArrowRight className="w-4 h-4" />
      </button>
    </div>
  )
}
