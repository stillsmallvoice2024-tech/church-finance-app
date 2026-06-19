import type { TourDefinition } from '../../types/onboarding'

export const categoriesTour: TourDefinition = {
  id: 'categoriesTour',
  pageId: 'categories',
  title: 'Categories Tour',
  description: 'Learn how categories organise your financial transactions.',
  lastVerified: '2026-06-19',
  steps: [
    {
      id: 'categories-header',
      target: '[data-tour="page-header"]',
      title: 'Categories',
      content:
        'Categories group your transactions for reporting. Every inflow and outflow is assigned a category, driving your financial reports and budget analysis.',
      placement: 'bottom',
    },
    {
      id: 'categories-controls',
      target: '[data-tour="data-controls"]',
      title: 'Search & Sort',
      content:
        'Use the search bar and sort controls to find specific categories. Switch between card and table views using the view toggle.',
      placement: 'bottom',
    },
    {
      id: 'categories-list',
      target: '[data-tour="categories-list"]',
      title: 'Category List',
      content:
        'All your income and expense categories are listed here. Click any category to edit its name, colour, or group. Well-named categories make your reports easier to read.',
      placement: 'top',
    },
    {
      id: 'categories-add',
      target: '[data-tour="add-button"]',
      title: 'Adding Categories',
      content:
        'Click Add to create a new income or outflow category. Changes take effect immediately for all future transaction imports.',
      placement: 'left',
    },
  ],
}
