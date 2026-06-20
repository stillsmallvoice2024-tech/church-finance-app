import type { TourDefinition } from '../../types/onboarding'

export const dashboardTour: TourDefinition = {
  id: 'dashboardTour',
  pageId: 'dashboard',
  title: 'Dashboard Tour',
  description: 'Learn how to read your financial overview at a glance.',
  lastVerified: '2026-06-19',
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
        'These cards show your total inflows, outflows, and net balance for the selected period. Use the sidebar to navigate to Inflows or Outflows for a detailed view.',
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
        'The latest transactions appear here. Navigate to Daily Finance → Inflows or Outflows in the sidebar for advanced filtering and bulk editing.',
      placement: 'top',
    },
  ],
}
