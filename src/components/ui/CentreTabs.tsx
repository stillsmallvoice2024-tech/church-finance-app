import { useSearchParams } from 'react-router-dom'
import { Lock } from 'lucide-react'

export interface CentreTabDef {
  id: string
  label: string
  /** Hide the tab entirely (e.g. role-gated sections). */
  hidden?: boolean
  /** Tab stays visible but renders muted with a lock icon + tier chip — the plan doesn't unlock it. */
  locked?: boolean
  /** Short tier label shown in the chip when locked, e.g. "Impact". */
  lockedTierLabel?: string
}

/**
 * Tab state for a "centre" page, synced to the `?tab=` URL param so old
 * routes can deep-link into a specific tab via redirects. Falls back to
 * `defaultId` when the param is absent or points at a hidden/unknown tab.
 */
export function useCentreTab(tabs: CentreTabDef[], defaultId: string) {
  const [params, setParams] = useSearchParams()
  const visible = tabs.filter(t => !t.hidden)
  const requested = params.get('tab')
  const active = requested && visible.some(t => t.id === requested) ? requested : defaultId
  const setActive = (id: string) => setParams(id === defaultId ? {} : { tab: id }, { replace: true })
  return { active, setActive, visible }
}

export function CentreTabs({ tabs, active, onChange }: {
  tabs: CentreTabDef[]
  active: string
  onChange: (id: string) => void
}) {
  return (
    <div
      role="tablist"
      aria-label="Page sections"
      className="flex items-center gap-1 border-b border-black/[0.06] dark:border-white/[0.07] overflow-x-auto"
    >
      {tabs.map(tab => {
        const isActive = tab.id === active
        return (
          <button
            key={tab.id}
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(tab.id)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-semibold whitespace-nowrap border-b-2 -mb-px transition-colors ${
              tab.locked
                ? 'border-transparent text-gray-400 dark:text-gray-500 hover:text-gray-500 dark:hover:text-gray-400'
                : isActive
                  ? 'border-primary text-primary'
                  : 'border-transparent text-gray-500 hover:text-gray-800 dark:hover:text-gray-300'
            }`}
          >
            {tab.locked && <Lock className="w-3 h-3" />}
            {tab.label}
            {tab.locked && tab.lockedTierLabel && (
              <span className="text-[9px] font-bold uppercase tracking-wide bg-gray-100 dark:bg-white/10 text-gray-400 px-1.5 py-0.5 rounded-full">
                {tab.lockedTierLabel}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
