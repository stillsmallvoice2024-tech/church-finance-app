import type { LucideIcon } from 'lucide-react'

/**
 * Mobile-only floating action button for a page's primary action.
 * Sits in the thumb zone above the bottom tab bar; hidden at lg+ where the
 * page-header button is reachable. Keep ONE per page.
 *
 * Icon-only (no text pill) so it stays small enough not to cover the
 * pagination controls / bulk action bar that also live in the bottom-right
 * corner of list pages.
 */
export function MobileFab({ icon: Icon, label, onClick }: {
  icon: LucideIcon
  label: string
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      className="lg:hidden fixed right-4 z-40 bottom-[calc(var(--tab-bar-height)+1rem)] flex items-center justify-center w-12 h-12 rounded-full bg-primary text-white shadow-lg shadow-primary/30 active:scale-95 transition-transform"
    >
      <Icon className="w-5 h-5" />
    </button>
  )
}
