import { useCallback } from 'react'
import { Megaphone, X, Play, ExternalLink } from 'lucide-react'
import { useUserPreferences } from '../../hooks/useUserPreferences'
import { useOnboardingStore } from '../../store/onboardingStore'
import { ANNOUNCEMENTS } from '../../onboarding/announcements/definitions'
import type { AnnouncementDefinition, UserPreferences } from '../../types/onboarding'

// ── Hook ─────────────────────────────────────────────────────────────────────

/** Returns announcements the current user has not yet read. Used by Sidebar badge. */
export function useUnreadAnnouncements() {
  const { prefs, loading } = useUserPreferences()
  if (loading) return []
  return ANNOUNCEMENTS.filter(a => !prefs.announcements_read.includes(a.id))
}

// ── Component ─────────────────────────────────────────────────────────────────

interface AnnouncementBannerItemProps {
  announcement: AnnouncementDefinition
  prefs: UserPreferences
  updatePrefs: (partial: Partial<UserPreferences>) => void
}

function AnnouncementBannerItem({ announcement, prefs, updatePrefs }: AnnouncementBannerItemProps) {
  const startTour    = useOnboardingStore(s => s.startTour)
  const openWhatsNew = useOnboardingStore(s => s.openHelpCenterWhatsNew)

  const dismiss = useCallback(() => {
    updatePrefs({ announcements_read: [...prefs.announcements_read, announcement.id] })
  }, [announcement.id, prefs.announcements_read, updatePrefs])

  const handleShowMe = useCallback(() => {
    dismiss()
    if (announcement.tourId) {
      setTimeout(() => startTour(announcement.tourId!), 150)
    }
  }, [dismiss, announcement.tourId, startTour])

  return (
    <div className="flex items-start gap-3 rounded-xl border border-primary/20 bg-primary/5 dark:bg-primary/10 dark:border-primary/30 px-4 py-3">
      <div className="w-7 h-7 rounded-lg bg-primary/10 dark:bg-primary/20 flex items-center justify-center shrink-0 mt-0.5">
        <Megaphone className="w-4 h-4 text-primary" />
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold text-primary uppercase tracking-wide mb-0.5">
          What's New · v{announcement.version}
        </p>
        <p className="text-sm font-semibold text-gray-800 dark:text-gray-100 leading-snug">
          {announcement.title}
        </p>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 leading-relaxed">
          {announcement.summary}
        </p>
        <div className="flex items-center flex-wrap gap-2 mt-2">
          {announcement.tourId && (
            <button
              type="button"
              onClick={handleShowMe}
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-primary text-white text-xs font-semibold hover:bg-primary/90 transition-colors"
            >
              <Play className="w-3 h-3" />
              Show me
            </button>
          )}
          <button
            type="button"
            onClick={() => { dismiss(); openWhatsNew() }}
            className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg border border-primary/30 text-primary text-xs font-semibold hover:bg-primary/10 transition-colors"
          >
            <ExternalLink className="w-3 h-3" />
            What's New
          </button>
          <button
            type="button"
            onClick={dismiss}
            className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors ml-auto"
          >
            Got it
          </button>
        </div>
      </div>

      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss announcement"
        className="shrink-0 p-1 rounded-md text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-white/50 dark:hover:bg-white/10 transition-colors"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}

// ── Public export — renders the topmost unread announcement ───────────────────

export function AnnouncementBanner() {
  const { prefs, loading, updatePrefs } = useUserPreferences()
  if (loading) return null
  const unread = ANNOUNCEMENTS.filter(a => !prefs.announcements_read.includes(a.id))
  if (unread.length === 0) return null
  return <AnnouncementBannerItem announcement={unread[0]} prefs={prefs} updatePrefs={updatePrefs} />
}
