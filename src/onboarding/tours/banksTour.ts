import type { TourDefinition } from '../../types/onboarding'

export const banksTour: TourDefinition = {
  id: 'banksTour',
  pageId: 'bank-ledger',
  title: 'Bank Ledger Tour',
  description: 'Understand how to manage and monitor your bank accounts.',
  steps: [
    {
      id: 'banks-header',
      target: '[data-tour="page-header"]',
      title: 'Bank Ledger',
      content:
        'The Bank Ledger shows every transaction for a selected bank account — inflows, outflows, transfers, and running balances.',
      placement: 'bottom',
    },
    {
      id: 'banks-selector',
      target: '[data-tour="bank-selector"]',
      title: 'Select a Bank Account',
      content:
        'Use this selector to switch between your bank accounts. Each account has its own ledger with a separate balance.',
      placement: 'bottom',
    },
    {
      id: 'banks-ledger-table',
      target: '[data-tour="ledger-table"]',
      title: 'Transaction Ledger',
      content:
        'Every entry is listed here in date order with a running balance. Use the search and filter controls to narrow down specific transactions.',
      placement: 'top',
    },
    {
      id: 'banks-export',
      target: '[data-tour="export-button"]',
      title: 'Export Ledger',
      content:
        'Export the current ledger view to Excel for reconciliation or offline reporting.',
      placement: 'left',
    },
  ],
}
