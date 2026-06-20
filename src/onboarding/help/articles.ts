import type { HelpArticle } from '../../types/onboarding'

export const HELP_ARTICLES: HelpArticle[] = [
  // ── Reference articles ────────────────────────────────────────────────────
  {
    id: 'getting-started-overview',
    title: 'Getting Started with Clariva',
    summary: 'A complete walkthrough for setting up your organisation from scratch.',
    category: 'getting-started',
    tags: ['setup', 'onboarding', 'overview'],
    relatedPageId: 'dashboard',
    updatedAt: '2026-06-19',
    lastVerified: '2026-06-19',
    content: `
## Welcome

Clariva helps your organisation track every naira (or any currency) that flows in and out — with full transparency, role-based access, and powerful reporting.

## Step 1: Set Up Master Data

Before importing any transactions, configure your organisation's building blocks in **Administration → Setup**:

- **Banks** — every account your organisation uses
- **Income Types** — categories for inflows (Tithes, Offerings, Donations, etc.)
- **Outflow Types** — categories for expenditure (Salaries, Utilities, Events, etc.)

## Step 2: Import Your First Statement

Go to **Daily Finance → Import** and upload a bank statement (Excel or CSV). The system will:
1. Parse all transactions automatically
2. Let you map columns to the correct fields
3. Detect and flag potential duplicates
4. Import confirmed rows into Inflows or Outflows

## Step 3: Review and Categorise

After import, review transactions in **Daily Finance → Inflows** and **Daily Finance → Outflows**. Assign the correct income or outflow type to any uncategorised records.

## Step 4: Generate Reports

Open **Reports → Reports** to see summaries, totals by category, and allocation breakdowns. Export to CSV as needed.
    `.trim(),
  },

  {
    id: 'understanding-categories',
    title: 'Understanding Income and Outflow Types',
    summary: 'How categories drive your financial reports and allocation rules.',
    category: 'categories',
    tags: ['categories', 'income', 'outflow', 'types', 'classification'],
    relatedPageId: 'categories',
    updatedAt: '2026-06-19',
    lastVerified: '2026-06-19',
    breadcrumb: ['Budget & Allocation', 'Categories'],
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
    updatedAt: '2026-06-19',
    lastVerified: '2026-06-19',
    breadcrumb: ['Administration', 'User Management'],
    content: `
## Role Overview

| Role | What They Can Do |
|------|-----------------|
| Owner | Everything — including transferring ownership and managing all members |
| Admin | Manage members, all financial data, settings |
| Accountant | Import statements, edit transactions and categories |
| Viewer | View all financial data (read-only) |

## Inviting a Member

1. Go to **Administration → User Management**.
2. Click **Invite User**.
3. Enter their email address and choose a role.
4. They receive a secure invitation link valid for 7 days.

## Changing Roles

Owners and Admins can change any member's role from the User Management page. Only owners can promote another member to Owner.
    `.trim(),
  },

  {
    id: 'bank-ledger-explained',
    title: 'Understanding the Bank Ledger',
    summary: 'How to read and reconcile the bank ledger view.',
    category: 'banks',
    tags: ['bank', 'ledger', 'reconciliation', 'balance'],
    relatedPageId: 'bank-ledger',
    updatedAt: '2026-06-19',
    lastVerified: '2026-06-19',
    breadcrumb: ['Banking', 'Bank Ledger'],
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

Use the **Export** button to download the ledger as CSV for offline reconciliation or audit purposes.
    `.trim(),
  },

  // ── How To articles ───────────────────────────────────────────────────────
  {
    id: 'import-bank-statement',
    title: 'How to Import a Bank Statement',
    summary: 'Upload, map columns, review rows, and confirm your bank statement import.',
    category: 'import',
    tags: ['import', 'bank', 'statement', 'excel', 'csv'],
    relatedPageId: 'import',
    updatedAt: '2026-06-19',
    lastVerified: '2026-06-19',
    howTo: true,
    estimatedMinutes: 3,
    breadcrumb: ['Daily Finance', 'Import'],
    content: `
## How to Import a Bank Statement

**What you'll need:** A bank statement file in Excel (.xlsx, .xls) or CSV format.

**Where to go:** Daily Finance → Import

**Time:** ~3 minutes

---

### Steps

1. Open **Daily Finance → Import** in the left sidebar.
2. Click the **File Import** tab if it is not already active.
3. Drag your bank statement file onto the upload zone, or click **Browse** to pick it.
4. Wait for the system to read the file. You will see the filename and row count appear.
5. Use the **Bank** dropdown to choose which bank account this statement belongs to.
6. Click **Continue to Import Wizard**.
7. On the column mapping screen, match each of your file's columns (Date, Description, Debit, Credit, etc.) to the correct Clariva field. Set any unwanted columns to **Skip**.
8. Click **Save as template** if you want Clariva to remember these mappings for this bank.
9. Review the **Inflow** and **Outflow** tabs. Deselect any rows that are duplicates or errors.
10. Click **Confirm Import**.

### Result

Your transactions appear immediately in **Inflows**, **Outflows**, the **Bank Ledger**, and all reports.

---

### Common issues

- **Duplicate warning (red box):** Choose "Skip Duplicates & Import" to skip repeated rows, or "Import Anyway" only if you are certain the rows are genuinely new.
- **Wrong amounts after import:** Check that Debit and Credit columns are mapped correctly in step 7. Edit individual transactions from Inflows/Outflows if needed.
- **Import page not visible:** Your role is Viewer. Ask an Admin or Accountant to import.
    `.trim(),
  },

  {
    id: 'add-bank-account',
    title: 'How to Add a Bank Account',
    summary: 'Create a bank account record in Setup so it can receive imported transactions.',
    category: 'banks',
    tags: ['bank', 'account', 'setup', 'add'],
    relatedPageId: 'setup',
    updatedAt: '2026-06-19',
    lastVerified: '2026-06-19',
    howTo: true,
    estimatedMinutes: 2,
    breadcrumb: ['Administration', 'Setup', 'Banks tab'],
    content: `
## How to Add a Bank Account

**What you'll need:** The bank account name and its starting (opening) balance.

**Where to go:** Administration → Setup → Banks tab

**Time:** ~2 minutes

---

### Steps

1. Open **Administration → Setup** in the left sidebar.
2. Click the **Banks** tab at the top of the page.
3. Click **Add Bank**.
4. Type the **Bank Name** — this must match exactly what you will choose during import (e.g. "Zenith Bank — Ministry Account").
5. Enter the **Starting Balance** — the account balance before you started using Clariva. Enter 0 if you are starting fresh.
6. If this is a foreign-currency account, tick **Foreign Currency Account** and choose the currency.
7. Click **Save**.

### Result

The bank account appears in the Banks list and is now available in the Bank dropdown during statement import and in all bank ledger views.

---

### Common issues

- **Bank not appearing in Import dropdown:** The bank name must be saved first before importing. Return to Setup → Banks tab and confirm it was saved.
- **Starting balance is wrong:** Click the pencil icon on the bank row to edit and correct it.
- **You see "Access denied":** Only Admins and Owners can manage bank accounts.
    `.trim(),
  },

  {
    id: 'record-inflow-manually',
    title: 'How to Record an Inflow Manually',
    summary: 'Add a single income transaction by hand using the Import manual entry form.',
    category: 'import',
    tags: ['inflow', 'manual', 'entry', 'transaction'],
    relatedPageId: 'import',
    updatedAt: '2026-06-19',
    lastVerified: '2026-06-19',
    howTo: true,
    estimatedMinutes: 2,
    breadcrumb: ['Daily Finance', 'Import'],
    content: `
## How to Record an Inflow Manually

**What you'll need:** The transaction date, amount, and bank account it came in on.

**Where to go:** Daily Finance → Import → Manual Entry tab

**Time:** ~2 minutes

---

**Note:** Import is the only entry point for transactions. The Inflows page is display-only (view, edit, delete existing records — not add new ones).

---

### Steps

1. Open **Daily Finance → Import** in the left sidebar.
2. Click the **Manual Entry** tab.
3. Click the **Inflow** button (green) to open the inflow form.
4. Fill in the required fields (marked with a star):
   - **Date** — the date the money was received
   - **Amount** — the total received (no negative sign)
   - **Bank** — the account the money came into
5. Add a **Description** to identify the transaction (e.g. "Sunday offering — June 15").
6. Optionally choose an **Income Type** to categorise it for reports.
7. Click **Save Inflow**.

### Result

The transaction appears immediately in **Inflows**, the **Bank Ledger**, and all reports.

---

### Common issues

- **"Possible Duplicate" warning:** A transaction with the same reference already exists. Click **Cancel** to check, or **Save Anyway** if you are certain it is a new record.
- **Bank dropdown is empty:** You have no bank accounts configured yet. Go to Administration → Setup → Banks tab and add one first.
- **Import page not visible:** Your role is Viewer. Ask an Admin or Accountant.
    `.trim(),
  },

  {
    id: 'create-budget-category',
    title: 'How to Create a Budget Category',
    summary: 'Add a new category (money bucket) in the Categories page.',
    category: 'categories',
    tags: ['category', 'budget', 'setup', 'allocation'],
    relatedPageId: 'categories',
    updatedAt: '2026-06-19',
    lastVerified: '2026-06-19',
    howTo: true,
    estimatedMinutes: 2,
    breadcrumb: ['Budget & Allocation', 'Categories'],
    content: `
## How to Create a Budget Category

**What you'll need:** A name for the category and optionally a group to organise it under.

**Where to go:** Budget & Allocation → Categories

**Time:** ~2 minutes

---

### Steps

1. Open **Budget & Allocation → Categories** in the left sidebar.
2. Click **Add Category**.
3. Type the **Category Name** (e.g. "Welfare", "Building Fund", "Missions").
4. Optional: select or create a **Group** to keep related categories together. Click the folder-plus icon to create a new group inline.
5. Optional: add a **Description** to explain what this category is for.
6. Optional: add **Opening Balances** if this category already had money before you started using Clariva. Click **Add**, choose a portion type, and enter the amount.
7. Click **Create**.

### Result

The category appears in the Categories list and is immediately available for allocation rules, reports, and the Category Accounts ledger.

---

### Common issues

- **Cannot delete a category:** It already has transactions. Use **Hide Category** instead — it removes it from active lists while keeping the history.
- **Category not appearing in allocation rules:** Check that your allocation config is active and covers the current date. See Administration → Setup → Allocation tab.
    `.trim(),
  },

  {
    id: 'generate-monthly-report',
    title: 'How to Generate a Monthly Report',
    summary: 'View monthly income and expenditure totals and export them as CSV.',
    category: 'reports',
    tags: ['reports', 'monthly', 'export', 'summary'],
    relatedPageId: 'reports',
    updatedAt: '2026-06-19',
    lastVerified: '2026-06-19',
    howTo: true,
    estimatedMinutes: 3,
    breadcrumb: ['Reports', 'Reports'],
    content: `
## How to Generate a Monthly Report

**What you'll need:** Nothing — the report reads live data automatically.

**Where to go:** Reports → Reports → Monthly Breakdown tab

**Time:** ~3 minutes

---

### Steps

1. Open **Reports → Reports** in the left sidebar.
2. Click the **Monthly Breakdown** tab.
3. Use the **Year** selector to choose the year you want to review.
4. The table shows each month with its total inflows, total outflows, and net balance.
5. Click any month row to drill into that month's transactions (if available).
6. To export, click the **CSV** button — the table downloads to your device as a spreadsheet.

### Result

You have a month-by-month summary of all financial activity for the selected year, ready to share or file.

---

### Common issues

- **All months show zero:** No transactions have been imported yet for that year. Import statements via Daily Finance → Import first.
- **Totals look wrong:** Check that all statements for the year have been imported and that bank names were selected correctly during import.
- **CSV button missing:** Scroll to find it — it appears at the top right of the tab.
    `.trim(),
  },

  {
    id: 'invite-team-member',
    title: 'How to Invite a Team Member',
    summary: 'Send an invitation email to a new user and assign their access role.',
    category: 'team',
    tags: ['invite', 'team', 'user', 'access', 'role'],
    relatedPageId: 'users',
    updatedAt: '2026-06-19',
    lastVerified: '2026-06-19',
    howTo: true,
    estimatedMinutes: 2,
    breadcrumb: ['Administration', 'User Management'],
    content: `
## How to Invite a Team Member

**What you'll need:** The new member's email address and the role you want them to have.

**Where to go:** Administration → User Management

**Time:** ~2 minutes

---

### Steps

1. Open **Administration → User Management** in the left sidebar.
2. Click **Invite User**.
3. Type the person's **Email Address**.
4. Choose a **Role**:
   - **Admin** — full access (setup, imports, team management)
   - **Accountant** — can import and edit transactions, no setup or team access
   - **Viewer** — read-only access to all financial data
5. Click **Send Invitation**.
6. The app sends them an email and also shows you an **Invite Link**. Copy it and send via WhatsApp or any messenger in case the email doesn't arrive.
7. The link expires after 7 days. If it expires, repeat these steps to resend.

### Result

The invited person receives a link, creates their account, and appears in the **All Members** table once they accept.

---

### Common issues

- **Invitation email never arrived:** Use the "Copy invite link" option shown after sending and share it directly.
- **"Email delivery failed":** Copy and share the invite link manually — the account is still created and waiting.
- **User Management page not visible:** Only Admins and Owners can manage team members.
    `.trim(),
  },
]
