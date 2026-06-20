import type { TourDefinition } from '../../types/onboarding'

export const outflowsTour: TourDefinition = {
  id: 'outflowsTour',
  pageId: 'outflows',
  title: 'Outflows Tour',
  description: 'Learn how to view and manage outgoing transactions.',
  lastVerified: '2026-06-19',
  steps: [
    {
      id: 'outflows-header',
      target: '[data-tour="page-header"]',
      title: 'Outflows',
      content:
        'All expenditure recorded for your organisation is listed here. Like inflows, outflow records arrive via bank statement import.',
      placement: 'bottom',
    },
    {
      id: 'outflows-filters',
      target: '[data-tour="data-controls"]',
      title: 'Search & Filter',
      content:
        'Filter by date, outflow type, bank, or search keywords. The period selector helps you view spending for a specific month or quarter.',
      placement: 'bottom',
    },
    {
      id: 'outflows-table',
      target: '[data-tour="data-table"]',
      title: 'Outflow Records',
      content:
        'Edit individual records to correct categories or descriptions. Bulk selection lets you update multiple records simultaneously.',
      placement: 'top',
    },
  ],
}
