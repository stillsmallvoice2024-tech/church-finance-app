## What is this chapter about?

Three pages help you watch your bank accounts: the **Bank Ledger** (every transaction per bank with a running balance), **Bank Deposits & Transfers** (cash put into the bank, and money moved between your own banks), and the **Reconciliation Center** (a health check that your app records match the real bank).

## Part 1: Bank Ledger

Find it at **Banking → Bank Ledger** (or the **Ledger** button at the bottom on a phone).

### How to view a bank's history

1. Pick a bank from the **Bank** dropdown in the filter card.
2. Optional: set **From** and **To** dates, or use the quick date buttons.
3. Three cards appear: **Total Inflows**, **Total Outflows**, and **Net Balance**.
4. Below is the list. Each row shows the Date, Description, Inflow (green), Outflow (red), and the running **Balance** after that row.
5. The blue row at the top called **Balance Brought Forward** is the bank's opening balance.
6. Click the small arrow on a row to see full details; click the **pencil** to fix a mistake.

## Part 2: Bank Deposits & Transfers

Find it at **Banking → Bank Deposits & Transfers**. Two tabs:

- **Bank Deposits** — records of physical cash being deposited into a bank account.
- **Intrabank Transfers** — money moved between two of your own bank accounts.

Both use pairs: a **Root** (the original entry) and an **Offset** (its matching entry). The summary cards show **Originals**, the paired entries, and **Needs review** — rows that haven't been classified yet.

### How to link an unclassified row

1. Find a row with the amber **link** icon (it has no pair yet).
2. Click the link icon and choose the matching original transaction.
3. Once linked, the pair shows together and the "Needs review" count goes down.

### The reconciliation panel (Deposits tab)

Click **Reconciliation — Tagged Inflows vs Tagged Outflows** to expand it. It compares deposit-tagged inflows against deposit-tagged outflows. The **Net** should be zero — if it's amber, a pair is missing somewhere.

## Part 3: Reconciliation Center

Find it at **Review & Processing → Reconciliation**. This is your record health check — run it weekly or after every import.

### How to run a check

1. Click **Run Reconciliation** at the top right.
2. Wait while it says **Checking your records…**
3. You get a result card: green **Healthy**, amber **Warnings Detected**, or red **Critical Issues Found**, with counts.

### How to fix issues

1. Open the **Issues to Resolve** section. Start with the red (critical) ones.
2. Each issue card explains the problem in plain words, shows the affected record, and gives a link like **View Bank Ledger** or **View Deposits** that takes you straight to the right page.
3. Fix the record on that page, come back, and click **Run Reconciliation** again.
4. When everything is fixed you'll see **Everything looks good**.

### Reference balances

In the **Account Status** table, each bank shows a **Book Balance** (what the app calculates) and a **Reference Balance** (what your real bank statement says). Click the **pencil** next to the reference balance to type the closing balance and date from your bank statement. The **Difference** column shows any gap.

## If something goes wrong

- **"Select a bank above to view its ledger."** — pick a bank from the dropdown first.
- **Net Balance doesn't match your bank statement** — run a reconciliation check and follow the issue links.
- **You can't edit reference balances** — you need write access; ask an Admin.
