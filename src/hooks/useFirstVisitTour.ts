import { useEffect, useRef } from 'react'
import { useUserPreferences } from './useUserPreferences'
import { useOnboardingStore } from '../store/onboardingStore'
import { getTourByPage } from '../onboarding/tours'
import type { PageId } from '../types/onboarding'

/**
 * Auto-shows the page tour the first time a user visits a page.
 * Marks the page as visited immediately so the tour never shows twice.
 * Skips if the wizard is open, another tour is running, or prefs are loading.
 */
export function useFirstVisitTour(pageId: PageId) {
  const { prefs, loading, updatePrefs } = useUserPreferences()
  const startTour    = useOnboardingStore(s => s.startTour)
  const isTourOpen   = useOnboardingStore(s => s.isTourOpen)
  const isWizardOpen = useOnboardingStore(s => s.isWizardOpen)
  const triggered    = useRef(false)

  useEffect(() => {
    if (loading)                                    return
    if (triggered.current)                          return
    if (isTourOpen || isWizardOpen)                 return
    if (prefs.first_visit_pages.includes(pageId))   return

    const tour = getTourByPage(pageId)
    if (!tour)                                      return

    triggered.current = true
    updatePrefs({ first_visit_pages: [...prefs.first_visit_pages, pageId] })

    const timer = setTimeout(() => { startTour(tour.id) }, 800)
    return () => clearTimeout(timer)
  }, [loading, isTourOpen, isWizardOpen]) // eslint-disable-line react-hooks/exhaustive-deps
}
