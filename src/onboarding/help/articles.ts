import type { HelpArticle } from '../../types/onboarding'

export const HELP_ARTICLES: HelpArticle[] = [
  {
    id: 'getting-started-overview',
    title: 'Getting Started with Organisation Finance',
    summary: 'A complete walkthrough for setting up your organisation from scratch.',
    category: 'getting-started',
    tags: ['setup', 'onboarding', 'overview'],
    relatedPageId: 'dashboard',
    updatedAt: '2026-06-01',
    content: `
## Welcome

Organisation Finance helps your organisation track every naira (or any currency) that flows in and out — with full transparency, role-based access, and powerful reporting.

## Step 1: Set Up Master Data

Before importing any transactions, configure your organisation's building blocks:

- **Departments** — ministry units or teams that transactions can be assigned to
- **Bank Accounts** — every account your organisation uses
- **Income Types** — categories for inflows (Tithes, Offerings, Donations, etc.)
- **Outflow Types** — categories for expenditure (Salaries, Utilities, Events, etc.)

Head to **Setup** to complete this step.

## Step 2: Import Your First Statement

Go to **Import** and upload a bank statement (Excel or CSV). The system will:
1. Parse all transactions automatically
2. Let you map columns to the correct fields
3. Detect and flag potential duplicates
4. Import confirmed rows into Inflows or Outflows

## Step 3: Review and Categorise

After import, review transactions in **Inflows** and **Outflows**. Assign the correct income or outflow type to any uncategorised records.

## Step 4: Generate Reports

Open **Reports** to see summaries, totals by category, and allocation breakdowns. Export to Excel or PDF as needed.
    `.trim(),
  },
  {
    id: 'import-bank-statement',
    title: 'Importing a Bank Statement',
    summary: 'How to upload, map, and confirm a bank statement import.',
    category: 'import',
    tags: ['import', 'bank', 'statement', 'excel', 'csv'],
    relatedPageId: 'import',
    updatedAt: '2026-06-01',
    content: `
## Supported Formats

- Excel (.xlsx, .xls)
- CSV (.csv)

## Steps

1. Navigate to **Import**.
2. Drag your file onto the upload zone, or click **Browse**.
3. The system previews the first few rows. Map each column to the correct field (Date, Description, Debit, Credit, etc.).
4. Review the parsed rows. De-select any duplicates or rows you don't want to import.
5. Click **Confirm Import**.

## Tips

- The system remembers column mappings per bank name — future imports from the same bank are faster.
- Transactions are imported as inflows (credits) or outflows (debits) based on the amount sign.
- You can import statements from multiple banks — just ensure each bank account exists in Setup first.
    `.trim(),
  },
  {
    id: 'understanding-categories',
    title: 'Understanding Income and Outflow Types',
    summary: 'How categories drive your financial reports and allocation rules.',
    category: 'categories',
    tags: ['categories', 'income', 'outflow', 'types', 'classification'],
    relatedPageId: 'categories',
    updatedAt: '2026-06-01',
    content: `
## What Are Categories?

Every transaction is assigned a type:
- **Income Types** for inflows (e.g. Tithes, Offerings, Building Fund)
- **Outflow Types** for expenditure (e.g. Salaries, Rent, Supplies)

Categories determine how transactions appear in reports and whether distribution rules apply.

## Why They Matter

- Reports group transactions by category — clear naming makes reports readable by leadership.
- Distribution rules are configured per income type, letting you automatically split income across departments or purposes.
- Designated Gifts (restricted funds) are linked to specific categories.

## Best Practices

- Keep category names short and recognisable (e.g. "Tithes" not "Regular Tithe Payments from Members").
- Create separate categories for funds you want to track independently (e.g. split "Building Fund" from "General Offering").
    `.trim(),
  },
  {
    id: 'roles-permissions',
    title: 'User Roles and Permissions',
    summary: 'What each role can see and do in the system.',
    category: 'team',
    tags: ['roles', 'permissions', 'access', 'team', 'invite'],
    relatedPageId: 'users',
    updatedAt: '2026-06-01',
    content: `
## Role Overview

| Role | What They Can Do |
|------|-----------------|
| Owner | Everything — including transferring ownership and managing all members |
| Admin | Manage members, all financial data, settings |
| Accountant | Import statements, edit transactions and categories |
| Viewer | View all financial data (read-only) |

## Inviting a Member

1. Go to **Team Members**.
2. Click **Invite Member**.
3. Enter their email address and choose a role.
4. They receive a secure invitation link valid for 7 days.

## Changing Roles

Owners and Admins can change any member's role from the Team Members page. Only owners can promote another member to Owner.
    `.trim(),
  },
  {
    id: 'bank-ledger-explained',
    title: 'Understanding the Bank Ledger',
    summary: 'How to read and reconcile the bank ledger view.',
    category: 'banks',
    tags: ['bank', 'ledger', 'reconciliation', 'balance'],
    relatedPageId: 'bank-ledger',
    updatedAt: '2026-06-01',
    content: `
## What Is the Bank Ledger?

The Bank Ledger shows a chronological list of all transactions for a specific bank account, with a running balance calculated after each entry.

## Entries Included

- **Inflows** — deposits and credits imported from statements
- **Outflows** — payments and debits imported from statements
- **Intra-bank Transfers** — money moved between your own accounts
- **Bank Deposits** — manually recorded deposits

## Reconciliation

Compare the running balance in the ledger against your actual bank statement balance. Discrepancies usually indicate missing transactions or import errors.

## Exporting

Use the **Export** button to download the ledger as Excel for offline reconciliation or audit purposes.
    `.trim(),
  },
]
