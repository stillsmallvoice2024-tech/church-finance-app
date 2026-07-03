import { useSearchParams } from 'react-router-dom'

export interface CentreTabDef {
  id: string
  label: string
  /** Hide the tab entirely (e.g. role-gated sections). */
  hidden?: boolean
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
            className={`px-4 py-2.5 text-sm font-semibold whitespace-nowrap border-b-2 -mb-px transition-colors ${
              isActive
                ? 'border-primary text-primary'
                : 'border-transparent text-gray-500 hover:text-gray-800 dark:hover:text-gray-300'
            }`}
          >
            {tab.label}
          </button>
        )
      })}
    </div>
  )
}
