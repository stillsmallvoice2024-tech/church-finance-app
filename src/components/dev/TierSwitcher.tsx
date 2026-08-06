import { useState } from 'react'
import { FlaskConical, X } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useOrgStore } from '../../store/orgStore'
import { useRole } from '../../hooks/useRole'
import { usePlan, TIER_DISPLAY_NAME } from '../../hooks/usePlan'
import { useToastStore } from '../../store/toastStore'
import { friendlyError } from '../../utils/friendlyError'
import type { PlanTier } from '../../types'

const TIERS: PlanTier[] = ['free', 'level1', 'full']

/**
 * TEMPORARY — pre-launch tool for trying out gated routes/caps as each plan
 * tier before this ships to main. Writes directly to organizations.plan_tier
 * (clearing plan_expires_at so the switch isn't overridden by the
 * grandfather-expiry lazy check), so every gate in the app — routes, the
 * import cap, the custom-distribution-rule cap — responds exactly as it
 * would for a real org on that tier. Remove this component (and its mount
 * in Layout.tsx) before merging to main.
 */
export function TierSwitcher() {
  const { isOwner } = useRole()
  const orgId = useOrgStore(s => s.orgId)
  const { tier } = usePlan()
  const { push: toast } = useToastStore()
  const [open, setOpen] = useState(false)
  const [switching, setSwitching] = useState<PlanTier | null>(null)

  if (!orgId || !isOwner()) return null

  const switchTo = async (target: PlanTier) => {
    if (target === tier || switching) return
    setSwitching(target)
    const { error } = await supabase
      .from('organizations')
      .update({ plan_tier: target, plan_expires_at: null })
      .eq('id', orgId)
    setSwitching(null)
    if (error) {
      toast(friendlyError(error, 'switch plan tier'), 'error')
      return
    }
    useOrgStore.getState().setPlanTier(target, null)
    toast(`Previewing as ${TIER_DISPLAY_NAME[target]}`, 'success')
  }

  return (
    <div
      className="fixed bottom-[calc(var(--tab-bar-height)+5rem)] left-4 lg:bottom-6 lg:left-6 z-[49]"
      style={{ pointerEvents: 'auto' }}
    >
      {open && (
        <div className="mb-2 w-56 rounded-xl border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/30 shadow-card-md p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-bold uppercase tracking-wide text-amber-700 dark:text-amber-300">
              Dev — Preview Tier
            </span>
            <button
              onClick={() => setOpen(false)}
              aria-label="Close"
              className="p-0.5 rounded text-amber-600 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-800/40"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="flex flex-col gap-1.5">
            {TIERS.map(t => (
              <button
                key={t}
                onClick={() => switchTo(t)}
                disabled={switching !== null}
                className={`text-left px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors disabled:opacity-60 ${
                  t === tier
                    ? 'bg-amber-500 text-white'
                    : 'bg-white dark:bg-white/10 text-gray-700 dark:text-gray-200 hover:bg-amber-100 dark:hover:bg-white/20'
                }`}
              >
                {switching === t ? 'Switching…' : TIER_DISPLAY_NAME[t]}
              </button>
            ))}
          </div>
          <p className="text-[10px] text-amber-700/80 dark:text-amber-300/70 mt-2 leading-snug">
            Writes to this org's real plan_tier. Remove before shipping to main.
          </p>
        </div>
      )}

      <button
        onClick={() => setOpen(v => !v)}
        aria-label="Toggle plan tier preview switcher"
        className="flex items-center gap-1.5 pl-3 pr-3.5 py-2.5 rounded-full bg-amber-500 text-white text-xs font-bold shadow-card-md hover:bg-amber-600 transition-colors"
      >
        <FlaskConical className="w-4 h-4" />
        {open ? 'Close' : TIER_DISPLAY_NAME[tier]}
      </button>
    </div>
  )
}
