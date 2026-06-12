import type { LucideIcon } from 'lucide-react'

/**
 * Mobile-only floating action button for a page's primary action.
 * Sits in the thumb zone above the bottom tab bar; hidden at lg+ where the
 * page-header button is reachable. Keep ONE per page.
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
      className="lg:hidden fixed right-4 z-40 bottom-[calc(var(--tab-bar-height)+1rem)] flex items-center gap-2 pl-4 pr-5 min-h-[52px] rounded-full bg-primary text-white text-sm font-semibold shadow-lg shadow-primary/30 active:scale-95 transition-transform"
    >
      <Icon className="w-5 h-5" />
      {label}
    </button>
  )
}
