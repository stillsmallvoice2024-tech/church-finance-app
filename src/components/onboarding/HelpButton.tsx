import { HelpCircle } from 'lucide-react'
import { useOnboardingStore } from '../../store/onboardingStore'
import { getTourById } from '../../onboarding/tours'
import type { TourId } from '../../types/onboarding'

interface HelpButtonProps {
  tourId: TourId
  /** Optional label shown beside the icon. Defaults to none (icon only). */
  label?: string
  /** Size variant. Defaults to 'md'. */
  size?: 'sm' | 'md'
  className?: string
}

/**
 * Drop-in help button for page headers.
 * Usage: <HelpButton tourId="dashboardTour" />
 */
export function HelpButton({ tourId, label, size = 'md', className = '' }: HelpButtonProps) {
  const startTour = useOnboardingStore(s => s.startTour)
  const tour = getTourById(tourId)

  if (!tour) return null

  const iconSize  = size === 'sm' ? 'w-3.5 h-3.5' : 'w-4 h-4'
  const textSize  = size === 'sm' ? 'text-xs'      : 'text-sm'
  const padding   = size === 'sm' ? 'px-2 py-1'    : 'px-2.5 py-1.5'

  return (
    <button
      type="button"
      onClick={() => startTour(tourId)}
      aria-label={`Start ${tour.title}`}
      title={tour.description}
      data-tour="help-button"
      className={`
        inline-flex items-center gap-1.5 rounded-lg
        text-gray-500 hover:text-primary
        border border-gray-200 hover:border-primary/40
        hover:bg-primary/5 dark:hover:bg-primary/10
        dark:text-gray-400 dark:border-white/[0.07] dark:hover:text-primary
        transition-colors focus-visible:outline-none focus-visible:ring-2
        focus-visible:ring-primary/50
        ${padding} ${textSize} ${className}
      `}
    >
      <HelpCircle className={iconSize} />
      {label && <span>{label}</span>}
    </button>
  )
}
