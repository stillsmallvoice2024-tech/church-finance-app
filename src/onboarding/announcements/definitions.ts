import type { AnnouncementDefinition } from '../../types/onboarding'

/**
 * Feature announcements shown to users who haven't seen them yet.
 * id is stored in user_preferences.announcements_read[] once acknowledged.
 */
export const ANNOUNCEMENTS: AnnouncementDefinition[] = [
  {
    id: 'v1.0.0-onboarding',
    version: '1.0.0',
    date: '2026-06-01',
    title: 'Welcome to the new Help & Onboarding system',
    summary:
      'We\'ve added guided tours, a dashboard checklist, a setup wizard, and a full Help Center to make getting started easier.',
    tourId: 'dashboardTour',
  },
]
