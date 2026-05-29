import { useState, useRef, useEffect } from 'react'
import { Building2, ChevronDown, Check, Loader2 } from 'lucide-react'
import { useOrgStore, type OrgMembership } from '../../store/orgStore'
import { useOrgSwitch } from '../../hooks/useAuth'
import { ROLE_LABELS } from '../../utils/constants'

export function OrgSwitcher() {
  const memberships = useOrgStore(s => s.memberships)
  const orgId       = useOrgStore(s => s.orgId)
  const orgName     = useOrgStore(s => s.orgName)
  const switching   = useOrgStore(s => s.switching)
  const { switchOrg } = useOrgSwitch()

  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  // Only render the switcher when the user belongs to multiple orgs
  if (memberships.length <= 1) {
    return (
      <div className="flex items-center gap-1.5 text-sm font-medium text-gray-700 dark:text-gray-200">
        <Building2 className="w-4 h-4 shrink-0 text-gray-400" />
        <span className="max-w-[180px] truncate">{orgName ?? 'Finance'}</span>
      </div>
    )
  }

  const handleSwitch = (m: OrgMembership) => {
    setOpen(false)
    if (m.org_id === orgId) return
    switchOrg(m)
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        disabled={switching}
        className="flex items-center gap-1.5 text-sm font-medium text-gray-700 hover:text-primary dark:text-gray-200 dark:hover:text-accent transition-colors rounded-lg px-1.5 py-1 hover:bg-gray-100 dark:hover:bg-gray-700"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        {switching
          ? <Loader2 className="w-4 h-4 shrink-0 animate-spin text-gray-400" />
          : <Building2 className="w-4 h-4 shrink-0 text-gray-400" />
        }
        <span className="max-w-[160px] truncate">{orgName ?? 'Finance'}</span>
        <ChevronDown className={`w-3.5 h-3.5 text-gray-400 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute left-0 top-full mt-1 z-50 w-64 rounded-xl border border-gray-100 bg-white shadow-lg py-1 dark:bg-gray-800 dark:border-gray-700"
        >
          <p className="px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-gray-400">
            Switch organization
          </p>
          {memberships.map(m => (
            <button
              key={m.org_id}
              role="option"
              aria-selected={m.org_id === orgId}
              onClick={() => handleSwitch(m)}
              className="w-full flex items-center justify-between gap-3 px-3 py-2.5 text-left hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
            >
              <div className="min-w-0">
                <div className="text-sm font-medium text-gray-800 dark:text-gray-100 truncate">
                  {m.org_name}
                </div>
                <div className="text-xs text-gray-400">{ROLE_LABELS[m.role]}</div>
              </div>
              {m.org_id === orgId && (
                <Check className="w-4 h-4 text-primary shrink-0" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
