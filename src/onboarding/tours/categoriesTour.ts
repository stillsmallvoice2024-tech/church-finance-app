import type { TourDefinition } from '../../types/onboarding'

export const categoriesTour: TourDefinition = {
  id: 'categoriesTour',
  pageId: 'categories',
  title: 'Categories Tour',
  description: 'Learn how income and outflow categories organise your finances.',
  steps: [
    {
      id: 'categories-header',
      target: '[data-tour="page-header"]',
      title: 'Categories',
      content:
        'Categories group your transactions for reporting. Every inflow and outflow is assigned a category, which drives the financial report and budget analysis.',
      placement: 'bottom',
    },
    {
      id: 'categories-income',
      target: '[data-tour="income-types"]',
      title: 'Income Types',
      content:
        'Income types classify your inflows (e.g. Tithes, Offerings, Donations). Each type can have its own allocation rules and reporting labels.',
      placement: 'bottom',
    },
    {
      id: 'categories-outflow',
      target: '[data-tour="outflow-types"]',
      title: 'Outflow Types',
      content:
        'Outflow types classify your expenditure (e.g. Salaries, Utilities, Events). Well-named categories make your financial reports easier to read.',
      placement: 'bottom',
    },
    {
      id: 'categories-add',
      target: '[data-tour="add-button"]',
      title: 'Adding Categories',
      content:
        'Click Add to create a new income or outflow type. Changes take effect immediately for all future transaction imports.',
      placement: 'left',
    },
  ],
}
