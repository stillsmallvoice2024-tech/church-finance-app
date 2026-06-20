import { useEffect, useRef } from 'react'
import { useUserPreferences } from './useUserPreferences'
import { useOnboardingStore } from '../store/onboardingStore'
import { getTourByPage } from '../onboarding/tours'
import { useAuthStore } from '../store/authStore'
import type { PageId } from '../types/onboarding'

// ── User-scoped localStorage layer (resilient to DB failures / cold cache) ─────

function lsKey(userId: string) {
  return `clariva-first-visit-pages-${userId}`
}

function getLocalVisited(userId: string | undefined): PageId[] {
  if (!userId) return []
  try { return JSON.parse(localStorage.getItem(lsKey(userId)) ?? '[]') as PageId[] }
  catch { return [] }
}

function markLocalVisited(userId: string | undefined, pageId: PageId) {
  if (!userId) return
  const existing = getLocalVisited(userId)
  if (!existing.includes(pageId)) {
    try {
      localStorage.setItem(lsKey(userId), JSON.stringify([...existing, pageId]))
    } catch { /* storage unavailable */ }
  }
}

/**
 * Auto-shows the page tour the first time a user visits a page.
 * Marks the page as visited immediately so the tour never shows twice.
 * Skips if the wizard is open, another tour is running, or prefs are loading.
 * Falls back to localStorage when the DB row is absent or the write fails.
 */
export function useFirstVisitTour(pageId: PageId) {
  const { prefs, loading, updatePrefs } = useUserPreferences()
  const startTour    = useOnboardingStore(s => s.startTour)
  const isTourOpen   = useOnboardingStore(s => s.isTourOpen)
  const isWizardOpen = useOnboardingStore(s => s.isWizardOpen)
  const user         = useAuthStore(s => s.user)
  const triggered    = useRef(false)

  useEffect(() => {
    if (loading)                                                            return
    if (triggered.current)                                                  return
    if (isTourOpen || isWizardOpen)                                         return

    const alreadyVisited =
      prefs.first_visit_pages.includes(pageId) ||
      getLocalVisited(user?.id).includes(pageId)
    if (alreadyVisited)                                                     return

    const tour = getTourByPage(pageId)
    if (!tour)                                                              return

    triggered.current = true
    updatePrefs({ first_visit_pages: [...prefs.first_visit_pages, pageId] })
    markLocalVisited(user?.id, pageId)

    const timer = setTimeout(() => { startTour(tour.id) }, 800)
    return () => clearTimeout(timer)
  }, [loading, isTourOpen, isWizardOpen]) // eslint-disable-line react-hooks/exhaustive-deps
}
