import type { TourDefinition } from '../../types/onboarding'

export const reportsTour: TourDefinition = {
  id: 'reportsTour',
  pageId: 'reports',
  title: 'Reports Tour',
  description: 'Learn how to generate and customise financial reports.',
  lastVerified: '2026-06-19',
  steps: [
    {
      id: 'reports-header',
      target: '[data-tour="page-header"]',
      title: 'Financial Reports',
      content:
        'Generate summary and detailed financial reports for any period. Reports show inflows, outflows, allocations, and category balances.',
      placement: 'bottom',
    },
    {
      id: 'reports-period',
      target: '[data-tour="period-selector"]',
      title: 'Select a Period',
      content:
        'Choose the date range for your report. You can select a single month, quarter, year, or a custom range.',
      placement: 'bottom',
    },
    {
      id: 'reports-template',
      target: '[data-tour="report-template"]',
      title: 'Report Templates',
      content:
        'Save and reload custom report configurations. Templates remember which categories, columns, and groupings you\'ve set up.',
      placement: 'bottom',
    },
    {
      id: 'reports-export',
      target: '[data-tour="export-button"]',
      title: 'Export Report',
      content:
        'Export to Excel or PDF for sharing with leadership, auditors, or congregation members.',
      placement: 'left',
    },
  ],
}
