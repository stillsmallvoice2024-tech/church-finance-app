import type { TourDefinition } from '../../types/onboarding'

export const setupTour: TourDefinition = {
  id: 'setupTour',
  pageId: 'setup',
  title: 'Setup Tour',
  description: 'Learn how to configure your organisation\'s master data.',
  steps: [
    {
      id: 'setup-header',
      target: '[data-tour="page-header"]',
      title: 'Organisation Setup',
      content:
        'The Setup page is where you configure the building blocks your organisation uses: departments, income types, outflow types, and bank accounts.',
      placement: 'bottom',
    },
    {
      id: 'setup-departments',
      target: '[data-tour="departments-section"]',
      title: 'Departments',
      content:
        'Departments (or ministry units) let you track finances by team or project. Transactions can be assigned to a department for granular reporting.',
      placement: 'bottom',
    },
    {
      id: 'setup-banks',
      target: '[data-tour="banks-section"]',
      title: 'Bank Accounts',
      content:
        'Add every bank account your organisation uses here. Each account needs a name and currency. Bank names are used when importing statements.',
      placement: 'top',
    },
  ],
}
