import type { TourDefinition } from '../../types/onboarding'

export const setupTour: TourDefinition = {
  id: 'setupTour',
  pageId: 'setup',
  title: 'Setup Tour',
  description: 'Learn how to configure your organisation\'s master data.',
  lastVerified: '2026-06-19',
  steps: [
    {
      id: 'setup-header',
      target: '[data-tour="page-header"]',
      title: 'Organisation Setup',
      content:
        'The Setup page is where you configure the building blocks your organisation uses: bank accounts, allocation rules, income types, outflow types, and currencies.',
      placement: 'bottom',
    },
    {
      id: 'setup-banks',
      target: '[data-tour="banks-section"]',
      title: 'Bank Accounts',
      content:
        'Click the Banks tab to add every account your organisation uses. Each account needs a name and starting balance. Bank names must be set here before you can import statements.',
      placement: 'bottom',
    },
    {
      id: 'setup-income-types',
      target: '[data-tour="income-types-section"]',
      title: 'Income & Outflow Types',
      content:
        'Use the Income Types and Outflow Types tabs to define your reporting categories — for example "Tithes", "Offerings", "Salaries", and "Utilities".',
      placement: 'top',
    },
  ],
}
