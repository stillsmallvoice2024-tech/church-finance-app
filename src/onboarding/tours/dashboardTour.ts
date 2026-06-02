import type { TourDefinition } from '../../types/onboarding'

export const dashboardTour: TourDefinition = {
  id: 'dashboardTour',
  pageId: 'dashboard',
  title: 'Dashboard Tour',
  description: 'Learn how to read your financial overview at a glance.',
  steps: [
    {
      id: 'dashboard-welcome',
      target: '[data-tour="dashboard-header"]',
      title: 'Welcome to your Dashboard',
      content:
        'This is your financial command centre. You can see key balances, recent activity, and your organisation\'s financial health at a glance.',
      placement: 'bottom',
    },
    {
      id: 'dashboard-summary-cards',
      target: '[data-tour="summary-cards"]',
      title: 'Summary Cards',
      content:
        'These cards show your total inflows, outflows, and net balance for the selected period. Click any card to drill into the detail.',
      placement: 'bottom',
    },
    {
      id: 'dashboard-chart',
      target: '[data-tour="dashboard-chart"]',
      title: 'Trend Chart',
      content:
        'The chart tracks inflows and outflows over time. Use the period selector above to zoom in on a specific range.',
      placement: 'top',
    },
    {
      id: 'dashboard-recent',
      target: '[data-tour="recent-transactions"]',
      title: 'Recent Transactions',
      content:
        'The latest transactions appear here. Click any row to see full details or navigate to the full Inflows / Outflows pages for advanced filtering.',
      placement: 'top',
    },
  ],
}
