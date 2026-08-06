import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Lock } from 'lucide-react'
import { Card } from '../ui/Card'
import { usePlan, FEATURE_TIERS, TIER_DISPLAY_NAME, type PlanFeature } from '../../hooks/usePlan'
import type { PlanTier } from '../../types'

interface GateProps {
  children: ReactNode
  /** Rendered when the gate condition is NOT met. Defaults to nothing. */
  fallback?: ReactNode
}

/** Default fallback shown by the plan gates below when no custom fallback is passed. */
export function UpsellCard({ requiredTier, locked }: { requiredTier: PlanTier; locked?: PlanFeature }) {
  return (
    <Card variant="outlined" className="flex flex-col items-center gap-2 text-center py-10">
      <Lock className="w-6 h-6 text-gray-400" />
      <p className="text-sm font-medium text-gray-700 dark:text-gray-200">
        This feature requires the {TIER_DISPLAY_NAME[requiredTier]} plan
      </p>
      <Link
        to={`/settings?tab=billing${locked ? `&locked=${locked}` : ''}`}
        className="text-sm text-primary font-medium hover:underline"
      >
        View plans
      </Link>
    </Card>
  )
}

/** Renders children when the org's plan is Level 1 or above. */
export function RequiresLevel1({ children, fallback }: GateProps) {
  const { isLevel1OrAbove } = usePlan()
  return isLevel1OrAbove() ? <>{children}</> : <>{fallback ?? <UpsellCard requiredTier="level1" />}</>
}

/** Renders children when the org's plan is Full. */
export function RequiresFull({ children, fallback }: GateProps) {
  const { isFull } = usePlan()
  return isFull() ? <>{children}</> : <>{fallback ?? <UpsellCard requiredTier="full" />}</>
}

/** Renders children when the org's plan unlocks the given feature. */
export function PlanGate({ feature, children, fallback }: GateProps & { feature: PlanFeature }) {
  const { hasFeature } = usePlan()
  return hasFeature(feature)
    ? <>{children}</>
    : <>{fallback ?? <UpsellCard requiredTier={FEATURE_TIERS[feature]} locked={feature} />}</>
}
