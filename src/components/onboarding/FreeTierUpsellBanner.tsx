import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Sparkles, X } from 'lucide-react'
import { usePlan } from '../../hooks/usePlan'
import { useAuth } from '../../hooks/useAuth'

// Per-session dismiss (sessionStorage, not localStorage) — reappears next
// login rather than being gone forever after one click, since the point is
// a recurring nudge toward paid tiers, not a one-time announcement.
const dismissKey = (userId: string) => `free-tier-upsell-dismissed-${userId}`

/** Shown on the Dashboard for Free-tier orgs, once onboarding is complete. */
export function FreeTierUpsellBanner() {
  const { user } = useAuth()
  const { isFree } = usePlan()
  const [dismissed, setDismissed] = useState(
    () => !!user && sessionStorage.getItem(dismissKey(user.id)) === '1',
  )

  if (!isFree() || dismissed) return null

  const dismiss = () => {
    if (user) sessionStorage.setItem(dismissKey(user.id), '1')
    setDismissed(true)
  }

  return (
    <div className="flex items-start gap-3 rounded-xl border border-primary/20 bg-primary/5 dark:bg-primary/10 dark:border-primary/30 px-4 py-3">
      <div className="w-7 h-7 rounded-lg bg-primary/10 dark:bg-primary/20 flex items-center justify-center shrink-0 mt-0.5">
        <Sparkles className="w-4 h-4 text-primary" />
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-gray-800 dark:text-gray-100 leading-snug">
          You're on Clariva Start
        </p>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 leading-relaxed">
          Unlock multi-bank tracking, foreign currency, reports, receipts, reconciliation and team invites on
          Growth — or go Impact for unlimited custom distribution rules, bulk reallocation, bank movement
          tracking, backups and audit trail.
        </p>
        <div className="flex items-center flex-wrap gap-2 mt-2">
          <Link
            to="/settings?tab=billing"
            className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-primary text-white text-xs font-semibold hover:bg-primary/90 transition-colors"
          >
            View plans
          </Link>
        </div>
      </div>

      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss"
        className="shrink-0 p-1 rounded-md text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-white/50 dark:hover:bg-white/10 transition-colors"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}
