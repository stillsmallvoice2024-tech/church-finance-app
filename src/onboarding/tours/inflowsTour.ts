import type { TourDefinition } from '../../types/onboarding'

export const inflowsTour: TourDefinition = {
  id: 'inflowsTour',
  pageId: 'inflows',
  title: 'Inflows Tour',
  description: 'Learn how to view and manage incoming transactions.',
  lastVerified: '2026-06-19',
  steps: [
    {
      id: 'inflows-header',
      target: '[data-tour="page-header"]',
      title: 'Inflows',
      content:
        'All income recorded for your organisation appears here. Transactions are imported from bank statements — this page is for viewing, filtering, and editing records.',
      placement: 'bottom',
    },
    {
      id: 'inflows-filters',
      target: '[data-tour="data-controls"]',
      title: 'Search & Filter',
      content:
        'Filter by date range, category, bank account, or search by description. Combine filters to find exactly the records you need.',
      placement: 'bottom',
    },
    {
      id: 'inflows-table',
      target: '[data-tour="data-table"]',
      title: 'Transaction Table',
      content:
        'Click any row to edit its category, description, or notes. You can also bulk-select rows to re-categorise multiple transactions at once.',
      placement: 'top',
    },
    {
      id: 'inflows-import-cta',
      target: '[data-tour="import-link"]',
      title: 'Adding Transactions',
      content:
        'Transactions are added via the Import page. Head there to upload a bank statement and have transactions automatically parsed and categorised.',
      placement: 'left',
    },
  ],
}
