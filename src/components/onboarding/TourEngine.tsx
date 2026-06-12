import { useEffect, useState, useRef } from 'react'
import { createPortal } from 'react-dom'
import { X, ChevronLeft, ChevronRight, HelpCircle } from 'lucide-react'
import { useOnboardingStore } from '../../store/onboardingStore'
import { useUserPreferences } from '../../hooks/useUserPreferences'
import { getTourById } from '../../onboarding/tours'
import type { TourStep, TourStepPlacement } from '../../types/onboarding'

// ── Spotlight ────────────────────────────────────────────────────────────────

interface SpotlightProps {
  rect: DOMRect
  padding: number
}

function Spotlight({ rect, padding }: SpotlightProps) {
  return (
    <div
      aria-hidden="true"
      className="fixed rounded-lg transition-all duration-200 pointer-events-none"
      style={{
        top:       rect.top    - padding,
        left:      rect.left   - padding,
        width:     rect.width  + padding * 2,
        height:    rect.height + padding * 2,
        boxShadow: '0 0 0 9999px rgba(0,0,0,0.65)',
        zIndex:    9998,
      }}
    />
  )
}

// ── Card position calculation ────────────────────────────────────────────────

const CARD_WIDTH  = 320
const CARD_GAP    = 16
const EDGE_MARGIN = 16

interface CardPos {
  top:       number
  left:      number
  centered?: boolean
}

function computeCardPos(
  rect:      DOMRect | null,
  placement: TourStepPlacement = 'bottom',
): CardPos {
  const W = window.innerWidth
  const H = window.innerHeight

  if (!rect || W < 640 || placement === 'center') {
    return { top: 0, left: 0, centered: true }
  }

  let top  = 0
  let left = 0

  switch (placement) {
    case 'top': {
      top  = rect.top - CARD_GAP - 200  // approximate card height
      left = rect.left + rect.width / 2 - CARD_WIDTH / 2
      if (top < EDGE_MARGIN) top = rect.bottom + CARD_GAP
      break
    }
    case 'left': {
      left = rect.left - CARD_WIDTH - CARD_GAP
      top  = rect.top + rect.height / 2 - 100
      if (left < EDGE_MARGIN) left = rect.right + CARD_GAP
      break
    }
    case 'right': {
      left = rect.right + CARD_GAP
      top  = rect.top + rect.height / 2 - 100
      if (left + CARD_WIDTH + EDGE_MARGIN > W) left = rect.left - CARD_WIDTH - CARD_GAP
      break
    }
    case 'bottom':
    default: {
      top  = rect.bottom + CARD_GAP
      left = rect.left + rect.width / 2 - CARD_WIDTH / 2
      if (top + 220 > H) top = rect.top - 220 - CARD_GAP
      break
    }
  }

  // Clamp to viewport
  left = Math.max(EDGE_MARGIN, Math.min(left, W - CARD_WIDTH - EDGE_MARGIN))
  top  = Math.max(EDGE_MARGIN, Math.min(top, H - 220 - EDGE_MARGIN))

  return { top, left }
}

// ── Tour card ────────────────────────────────────────────────────────────────

interface TourCardProps {
  step:       TourStep
  stepIndex:  number
  totalSteps: number
  pos:        CardPos
  onNext:     () => void
  onPrev:     () => void
  onExit:     () => void
}

function TourCard({ step, stepIndex, totalSteps, pos, onNext, onPrev, onExit }: TourCardProps) {
  const isFirst = stepIndex === 0
  const isLast  = stepIndex === totalSteps - 1

  const card = (
    <div
      role="dialog"
      aria-modal="false"
      aria-label={`Tour step ${stepIndex + 1} of ${totalSteps}: ${step.title}`}
      className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-700 p-5 w-80 max-w-[calc(100vw-2rem)]"
      onClick={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-2 gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <HelpCircle className="w-4 h-4 text-primary flex-shrink-0 mt-0.5" />
          <h3 className="font-semibold text-gray-900 dark:text-white text-sm leading-tight">
            {step.title}
          </h3>
        </div>
        <button
          onClick={onExit}
          aria-label="Close tour"
          className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 flex-shrink-0 -mt-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 rounded"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Body */}
      <p className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed mb-4">
        {step.content}
      </p>

      {/* Footer */}
      <div className="flex items-center justify-between">
        <span className="text-xs text-gray-500 dark:text-gray-500">
          {stepIndex + 1} / {totalSteps}
        </span>
        <div className="flex items-center gap-2">
          {!isFirst && (
            <button
              onClick={onPrev}
              className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 px-2 py-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              Back
            </button>
          )}
          <button
            onClick={onNext}
            className="flex items-center gap-1 text-xs bg-primary text-white px-3 py-1.5 rounded-lg hover:bg-primary-dark font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
          >
            {isLast ? 'Done' : 'Next'}
            {!isLast && <ChevronRight className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>
    </div>
  )

  if (pos.centered) {
    return (
      <div
        className="fixed inset-0 flex items-center justify-center p-4 pointer-events-none"
        style={{ zIndex: 9999 }}
      >
        <div className="pointer-events-auto">{card}</div>
      </div>
    )
  }

  return (
    <div
      className="fixed"
      style={{ top: pos.top, left: pos.left, zIndex: 9999, width: CARD_WIDTH }}
    >
      {card}
    </div>
  )
}

// ── Target measurement hook ───────────────────────────────────────────────────

function useMeasureTarget(selector: string, stepKey: string) {
  const [rect, setRect] = useState<DOMRect | null>(null)
  const rafRef = useRef<number | null>(null)

  useEffect(() => {
    const measure = () => {
      const el = document.querySelector<HTMLElement>(selector)
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
        // Wait for scroll to settle before measuring
        rafRef.current = requestAnimationFrame(() => {
          rafRef.current = requestAnimationFrame(() => {
            setRect(el.getBoundingClientRect())
          })
        })
      } else {
        setRect(null)
      }
    }

    const t = setTimeout(measure, 80)
    return () => {
      clearTimeout(t)
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    }
  }, [selector, stepKey]) // eslint-disable-line react-hooks/exhaustive-deps

  // Re-measure on resize
  useEffect(() => {
    const onResize = () => {
      const el = document.querySelector<HTMLElement>(selector)
      if (el) setRect(el.getBoundingClientRect())
    }
    window.addEventListener('resize', onResize, { passive: true })
    return () => window.removeEventListener('resize', onResize)
  }, [selector])

  return rect
}

// ── TourEngine ────────────────────────────────────────────────────────────────

export function TourEngine() {
  const {
    activeTourId,
    activeTourStep,
    isTourOpen,
    nextStep,
    prevStep,
    exitTour,
  } = useOnboardingStore()

  const { prefs, updatePrefs } = useUserPreferences()

  const tour = activeTourId ? getTourById(activeTourId) : null
  const step = tour ? (tour.steps[activeTourStep] ?? null) : null

  const targetRect = useMeasureTarget(
    step?.target ?? '',
    step?.id ?? '',
  )

  const handleNext = () => {
    if (!tour) return
    if (activeTourStep >= tour.steps.length - 1) {
      // Mark tour complete
      const already = prefs.tours_completed
      if (!already.includes(tour.id)) {
        updatePrefs({ tours_completed: [...already, tour.id] })
      }
      exitTour()
    } else {
      nextStep()
    }
  }

  // Keyboard navigation
  useEffect(() => {
    if (!isTourOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape')      { e.preventDefault(); exitTour()   }
      if (e.key === 'ArrowRight')  { e.preventDefault(); handleNext() }
      if (e.key === 'ArrowLeft')   { e.preventDefault(); prevStep()   }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTourOpen, activeTourStep, tour])

  if (!isTourOpen || !tour || !step) return null

  const spotlightPadding = step.spotlightPadding ?? 8
  const pos = computeCardPos(targetRect, step.placement)

  return createPortal(
    <>
      {/* Backdrop / spotlight */}
      {targetRect && window.innerWidth >= 640 ? (
        <Spotlight rect={targetRect} padding={spotlightPadding} />
      ) : (
        <div
          aria-hidden="true"
          className="fixed inset-0 bg-black/65"
          style={{ zIndex: 9998 }}
          onClick={exitTour}
        />
      )}

      {/* Tour card */}
      <TourCard
        step={step}
        stepIndex={activeTourStep}
        totalSteps={tour.steps.length}
        pos={pos}
        onNext={handleNext}
        onPrev={prevStep}
        onExit={exitTour}
      />
    </>,
    document.body,
  )
}
