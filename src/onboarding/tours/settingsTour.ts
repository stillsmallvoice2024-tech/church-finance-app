import type { TourDefinition } from '../../types/onboarding'

export const settingsTour: TourDefinition = {
  id: 'settingsTour',
  pageId: 'settings',
  title: 'Settings Tour',
  description: 'Learn what you can configure in Settings.',
  steps: [
    {
      id: 'settings-header',
      target: '[data-tour="page-header"]',
      title: 'Settings',
      content:
        'Settings lets you manage your organisation profile, personal preferences, appearance, and data backup.',
      placement: 'bottom',
    },
    {
      id: 'settings-org',
      target: '[data-tour="org-settings"]',
      title: 'Organisation Settings',
      content:
        'Update your organisation name, default currency, and fiscal year settings here.',
      placement: 'bottom',
    },
    {
      id: 'settings-appearance',
      target: '[data-tour="appearance-settings"]',
      title: 'Appearance',
      content:
        'Switch between light and dark mode. Your preference is saved per device.',
      placement: 'top',
    },
  ],
}
