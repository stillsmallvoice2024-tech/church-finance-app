import { Link } from 'react-router-dom'
import {
  ArrowDownCircle, ArrowUpCircle, Landmark, Tag, BarChart2, Users,
  Upload, Receipt, RotateCcw, CornerUpLeft, Banknote, ArrowLeftRight,
  PiggyBank, Gift, InboxIcon,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { getEmptyState } from '../../onboarding/emptyStates/definitions'
import { useOnboardingStore } from '../../store/onboardingStore'
import { getTourById } from '../../onboarding/tours'
import type { PageId } from '../../types/onboarding'

const ICON_MAP: Record<string, LucideIcon> = {
  ArrowDownCircle,
  ArrowUpCircle,
  Landmark,
  Tag,
  BarChart2,
  Users,
  Upload,
  Receipt,
  RotateCcw,
  CornerUpLeft,
  Banknote,
  ArrowLeftRight,
  PiggyBank,
  Gift,
}

interface PageEmptyStateProps {
  pageId: PageId
  /** Override the definition's description (e.g. to add filter context). */
  descriptionOverride?: string
  compact?: boolean
}

/**
 * Renders the onboarding-aware empty state for a given page.
 * Looks up the EmptyStateDefinition, resolves the icon, and wires
 * the action to either a Link or a tour launch.
 */
export function PageEmptyState({ pageId, descriptionOverride, compact = false }: PageEmptyStateProps) {
  const def = getEmptyState(pageId)
  const startTour = useOnboardingStore(s => s.startTour)

  if (!def) return null

  const Icon = ICON_MAP[def.iconName] ?? InboxIcon

  const handleAction = () => {
    if (def.action?.tourId) {
      const tour = getTourById(def.action.tourId)
      if (tour) startTour(tour.id)
    }
  }

  return (
    <div className={`flex flex-col items-center justify-center text-center ${compact ? 'py-8' : 'py-16'}`}>
      <div className={`rounded-2xl bg-primary/5 flex items-center justify-center mb-4 ${compact ? 'w-10 h-10' : 'w-16 h-16'}`}>
        <Icon className={`text-primary/60 ${compact ? 'w-5 h-5' : 'w-8 h-8'}`} />
      </div>
      <p className={`font-semibold text-gray-800 ${compact ? 'text-sm' : 'text-base'}`}>
        {def.title}
      </p>
      <p className={`text-gray-500 mt-1 max-w-sm ${compact ? 'text-xs' : 'text-sm'}`}>
        {descriptionOverride ?? def.description}
      </p>
      {def.action && (
        def.action.href ? (
          <Link
            to={def.action.href}
            className={`mt-4 inline-flex items-center gap-1.5 px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary-light transition-colors font-medium ${compact ? 'text-xs' : 'text-sm'}`}
          >
            {def.action.label}
          </Link>
        ) : def.action.tourId ? (
          <button
            type="button"
            onClick={handleAction}
            className={`mt-4 inline-flex items-center gap-1.5 px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary-light transition-colors font-medium ${compact ? 'text-xs' : 'text-sm'}`}
          >
            {def.action.label}
          </button>
        ) : null
      )}
    </div>
  )
}
