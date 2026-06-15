import type { ReleaseNote } from '../../types/onboarding'

export const RELEASE_NOTES: ReleaseNote[] = [
  {
    version: '1.0.0',
    date: '2026-06-01',
    title: 'Onboarding & Help Framework',
    highlights: [
      'New setup wizard for first-time organisation configuration',
      'Dashboard onboarding checklist tracks your setup progress',
      'Interactive page tours available on all major pages',
      'Global Help Center with articles, FAQs, and release notes',
      'Contextual tooltips for complex concepts',
      'Improved empty-state guidance throughout the app',
    ],
    details: `
This release introduces a comprehensive onboarding and help system, making it easier than ever to get started with Organisation Finance.

**Setup Wizard** — New organisations are guided through a step-by-step wizard covering organisation details, departments, bank accounts, income types, outflow types, and team members.

**Onboarding Checklist** — A dashboard widget tracks setup progress and auto-completes items as you configure your organisation.

**Page Tours** — Every major page now has a guided tour accessible via the Help button in the page header.

**Help Center** — A searchable knowledge base with getting-started guides, how-to articles, FAQs, and release notes.
    `.trim(),
  },
]
