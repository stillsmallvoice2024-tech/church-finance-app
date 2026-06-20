// ── Tutorial chapter manifest ─────────────────────────────────────────────────
// The full step-by-step user tutorial, surfaced in the Help Center "Tutorial"
// tab and on the /tutorial page. See README.md in this folder for how to
// update or add chapters.

import ch01 from './chapters/01-getting-started.md?raw'
import ch02 from './chapters/02-onboarding-setup.md?raw'
import ch03 from './chapters/03-dashboard.md?raw'
import ch04 from './chapters/04-import.md?raw'
import ch05 from './chapters/05-inflows.md?raw'
import ch06 from './chapters/06-outflows.md?raw'
import ch07 from './chapters/07-categories.md?raw'
import ch08 from './chapters/08-banks.md?raw'
import ch09 from './chapters/09-foreign-currency.md?raw'
import ch10 from './chapters/10-fund-transfers.md?raw'
import ch11 from './chapters/11-distribution-rules.md?raw'
import ch12 from './chapters/12-designated-savings.md?raw'
import ch13 from './chapters/13-refunds-reversals.md?raw'
import ch14 from './chapters/14-receipts.md?raw'
import ch15 from './chapters/15-reports.md?raw'
import ch16 from './chapters/16-settings.md?raw'
import ch17 from './chapters/17-team.md?raw'
import ch18 from './chapters/18-glossary.md?raw'

export interface TutorialChapter {
  /** URL slug, used in /tutorial/:chapterId */
  id: string
  /** Display order / chapter number */
  number: number
  title: string
  summary: string
  /** Bump when the chapter content changes */
  updatedAt: string
  /** Markdown body (rendered by src/onboarding/help/markdown.tsx) */
  content: string
}

export const TUTORIAL_CHAPTERS: TutorialChapter[] = [
  {
    id: 'getting-started',
    number: 1,
    title: 'Getting Started: Sign In & Accounts',
    summary: 'Create an account, sign in, reset a forgotten password, and accept an invitation.',
    updatedAt: '2026-06-12',
    content: ch01,
  },
  {
    id: 'onboarding-setup',
    number: 2,
    title: 'First-Time Setup',
    summary: 'The onboarding wizard and the Setup page: banks, income types, outflow types, departments, currencies.',
    updatedAt: '2026-06-20',
    content: ch02,
  },
  {
    id: 'dashboard',
    number: 3,
    title: 'The Dashboard',
    summary: 'Your home page: the big numbers, the monthly chart, and the quick action buttons.',
    updatedAt: '2026-06-12',
    content: ch03,
  },
  {
    id: 'import',
    number: 4,
    title: 'Importing Bank Statements',
    summary: 'The main way transactions enter the app: file upload, column mapping, duplicates, and manual entry.',
    updatedAt: '2026-06-20',
    content: ch04,
  },
  {
    id: 'inflows',
    number: 5,
    title: 'Inflows (Money In)',
    summary: 'Find, check, edit, bulk-edit, delete, and export incoming transactions.',
    updatedAt: '2026-06-12',
    content: ch05,
  },
  {
    id: 'outflows',
    number: 6,
    title: 'Outflows (Money Out)',
    summary: 'Track spending: categories, fund types, outflow types, pending payments, and net amounts.',
    updatedAt: '2026-06-12',
    content: ch06,
  },
  {
    id: 'categories',
    number: 7,
    title: 'Categories & Category Accounts',
    summary: 'Create money buckets, group them, set opening balances, and read their ledgers.',
    updatedAt: '2026-06-20',
    content: ch07,
  },
  {
    id: 'banks',
    number: 8,
    title: 'Banks: Setup, Ledger & Reconciliation',
    summary: 'Add bank accounts in Setup, read per-bank transaction histories, and run reconciliation checks.',
    updatedAt: '2026-06-20',
    content: ch08,
  },
  {
    id: 'foreign-currency',
    number: 9,
    title: 'Foreign Currency',
    summary: 'Record gifts in other currencies and convert them into your everyday currency.',
    updatedAt: '2026-06-12',
    content: ch09,
  },
  {
    id: 'fund-transfers',
    number: 10,
    title: 'Fund Transfers & Bulk Reallocation',
    summary: 'Move money between categories and pockets — one at a time or for many categories at once.',
    updatedAt: '2026-06-20',
    content: ch10,
  },
  {
    id: 'distribution-rules',
    number: 11,
    title: 'Distribution Rules & Regular Funds',
    summary: 'The recipes that split incoming money automatically, plus special one-off configs.',
    updatedAt: '2026-06-20',
    content: ch11,
  },
  {
    id: 'designated-gifts-savings',
    number: 12,
    title: 'Designated Gifts, Savings & Upcoming Deductions',
    summary: 'Restricted gifts, reserve funds, and approved payments that have not left the bank yet.',
    updatedAt: '2026-06-20',
    content: ch12,
  },
  {
    id: 'refunds-reversals',
    number: 13,
    title: 'Refunds & Reversals',
    summary: 'Money paid back vs records cancelled — and how matched pairs work.',
    updatedAt: '2026-06-20',
    content: ch13,
  },
  {
    id: 'receipts',
    number: 14,
    title: 'Receipts',
    summary: 'Attach, find, download, and delete proof-of-payment files.',
    updatedAt: '2026-06-12',
    content: ch14,
  },
  {
    id: 'reports',
    number: 15,
    title: 'Reports',
    summary: 'Ready-made summaries, the Financial Report builder, and live Custom Reports.',
    updatedAt: '2026-06-20',
    content: ch15,
  },
  {
    id: 'settings',
    number: 16,
    title: 'Settings, Backups & Security',
    summary: 'Your profile, password, 2FA, theme, backups, restore, and CSV exports.',
    updatedAt: '2026-06-12',
    content: ch16,
  },
  {
    id: 'team',
    number: 17,
    title: 'Team & Activity History',
    summary: 'Roles, invitations, removing members, ownership, and the diary of every change.',
    updatedAt: '2026-06-20',
    content: ch17,
  },
  {
    id: 'glossary',
    number: 18,
    title: 'Glossary',
    summary: 'Every app word explained in simple language.',
    updatedAt: '2026-06-12',
    content: ch18,
  },
]

export function getTutorialChapter(id: string): TutorialChapter | undefined {
  return TUTORIAL_CHAPTERS.find(c => c.id === id)
}
