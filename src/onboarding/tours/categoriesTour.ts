import type { TourDefinition } from '../../types/onboarding'

export const categoriesTour: TourDefinition = {
  id: 'categoriesTour',
  pageId: 'categories',
  title: 'Fund Setup Tour',
  description: 'Learn how funds organise your financial transactions.',
  lastVerified: '2026-06-19',
  steps: [
    {
      id: 'categories-header',
      target: '[data-tour="page-header"]',
      title: 'Fund Setup',
      content:
        'Funds group your transactions for reporting. Every inflow and outflow is assigned a fund, driving your financial reports and budget analysis.',
      placement: 'bottom',
    },
    {
      id: 'categories-controls',
      target: '[data-tour="data-controls"]',
      title: 'Search & Sort',
      content:
        'Use the search bar and sort controls to find specific funds. Switch between card and table views using the view toggle.',
      placement: 'bottom',
    },
    {
      id: 'categories-list',
      target: '[data-tour="categories-list"]',
      title: 'Fund List',
      content:
        'All your income and expense funds are listed here. Click any fund to edit its name, colour, or group. Well-named funds make your reports easier to read.',
      placement: 'top',
    },
    {
      id: 'categories-add',
      target: '[data-tour="add-button"]',
      title: 'Adding Funds',
      content:
        'Click Add to create a new income or outflow fund. Changes take effect immediately for all future transaction imports.',
      placement: 'left',
    },
  ],
}
