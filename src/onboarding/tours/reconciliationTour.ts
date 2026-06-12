import type { TourDefinition } from '../../types/onboarding'

export const reconciliationTour: TourDefinition = {
  id: 'reconciliationTour',
  pageId: 'reconciliation',
  title: 'Reconciliation Center Tour',
  description: 'Learn how to verify your records and resolve discrepancies.',
  steps: [
    {
      id: 'recon-header',
      target: '[data-tour="recon-header"]',
      title: 'Reconciliation Center',
      content:
        'This page verifies that your app records match your actual bank records. Run a check at any time — the system will flag any discrepancies so you can act on them.',
      placement: 'bottom',
    },
    {
      id: 'recon-run-button',
      target: '[data-tour="recon-run-button"]',
      title: 'Run a Check',
      content:
        'Click here to start a reconciliation check. It examines all transactions, bank balances, and fund allocations, then reports the overall health of your records.',
      placement: 'left',
    },
    {
      id: 'recon-health-summary',
      target: '[data-tour="recon-health-summary"]',
      title: 'Health Summary',
      content:
        'After a check, this panel shows your overall financial health: Healthy, Warning, or Critical. A Healthy status means everything is in order. Aim to keep this green.',
      placement: 'bottom',
    },
    {
      id: 'recon-account-status',
      target: '[data-tour="recon-account-status"]',
      title: 'Account Status',
      content:
        'This table shows each bank account\'s book balance versus your reference bank statement balance. Enter your actual statement figures here to compare them against your records.',
      placement: 'top',
    },
    {
      id: 'recon-issues',
      target: '[data-tour="recon-issues"]',
      title: 'Issues to Resolve',
      content:
        'Discrepancies are grouped here by severity. Each issue includes a plain-language explanation of what went wrong and a direct link to the page where it can be fixed.',
      placement: 'top',
    },
  ],
}
