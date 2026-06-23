# Module 5: Your Banks and Cash Position

The most important number your organization needs to know at any time is this: **how much money do we actually have, and where is it?**

This module covers bank accounts — the real, physical places where your money lives — and how to track them accurately. It also covers what Clariva tracks and, honestly, what it does not.

---

## Your Bank Accounts Are Your Assets

In accounting, anything your organization owns or holds of value is called an **asset**. Your most important assets — by far — are your bank account balances. Cash is the most liquid asset: it can be used immediately to pay for anything.

When we talk about "your cash position," we mean the sum of all your bank account balances across every account your organization holds.

**Common account types in a mission organization:**

| Account Type | Purpose |
|---|---|
| **Main operating account** | Day-to-day income and expenses |
| **Savings account** | Reserved funds, building projects, emergency reserves |
| **Building fund account** | Segregated designated giving for construction |
| **Foreign currency account** | Holds USD, GBP, EUR, or other currencies |
| **Petty cash** | Physical cash on hand for minor daily expenses |

Each account has its own balance. Your total cash position is the sum of all of them.

---

## Opening Balances

When you start using a financial system for the first time, you need to tell it where you are starting from. This is called the **opening balance** — the amount in each bank account on the day you begin keeping records in the system.

Getting opening balances right is critical. Every calculation that follows — running balances, reports, reconciliation — starts from this number. If the opening balance is wrong, everything built on top of it is wrong.

Before setting up your banking records:
1. Obtain your actual bank statement for the start date
2. Confirm the closing balance on that statement
3. Enter that as your opening balance in the system

If you have been keeping records elsewhere (a spreadsheet, a previous system), your opening balance should match what those records show — not just what the bank statement shows, because you may have outstanding transactions.

---

## Bank Reconciliation

**Bank reconciliation** is the process of comparing your internal records to your bank statement — and confirming they match.

This is one of the most important financial controls that exists. It should be done every month, without exception.

### Why Reconcile?

- Catches recording errors: a wrong amount entered, a transaction recorded twice, or a transaction missed
- Detects unauthorized transactions: a payment you did not make, a charge you did not authorize
- Confirms timing differences: money you recorded that the bank has not yet processed (or vice versa)

### How Reconciliation Works

At the end of each month:

**Step 1:** Get your bank statement — the official record from the bank of every transaction in and out.

**Step 2:** Compare it, line by line, to your internal records.

**Step 3:** Identify differences:

| Difference Type | What it means |
|---|---|
| **In your records, not on the statement** | Outstanding — you recorded it but it hasn't cleared the bank yet (common with cheques) |
| **On the statement, not in your records** | Missing — you need to record it (bank charges, interest, direct credits you missed) |
| **Same transaction, different amount** | Error — investigate; one side needs correcting |

**Step 4:** After accounting for all timing differences, your adjusted book balance should equal your adjusted bank balance. If it doesn't, keep looking — there is an error somewhere.

> A small unresolved difference is not a small problem. A ₦500 discrepancy you ignore today might be a ₦500 pattern that becomes a ₦50,000 problem next year.

---

## Foreign Currency Accounts

If your organization receives funds in foreign currencies (USD, GBP, EUR, CNY), those currencies are assets too — but their value in your home currency changes with exchange rates.

When foreign currency is received:
- Record the amount in the original currency
- Note the exchange rate at the time
- Calculate the home currency equivalent

When foreign currency is converted (sold or transferred):
- Record the conversion as a separate transaction
- Record any gain or loss from the rate difference

Foreign currency management adds complexity, but the principle is the same: every movement of money is recorded, with the amount, the currency, and the rate.

---

## What Clariva Tracks vs. What It Does Not

This is an important moment of honesty, because understanding the limits of any tool helps you use it well.

**What Clariva tracks:**
- All your bank account balances (automatically updated as you record inflows and outflows)
- Foreign currency holdings and FX conversions
- Running balance per bank account, per transaction
- Fund transfers between accounts

**What Clariva does not currently track:**
- **Loans and borrowings** — if your organization has taken a loan, the outstanding balance is not tracked in Clariva
- **Fixed assets** — equipment, vehicles, buildings the organization owns are not recorded
- **Amounts owed to you** — if someone owes your organization money (a grant payment coming, a receivable), there is no formal tracking for this

These items — loans, fixed assets, receivables — are part of the "what you have and what you owe" picture that a full balance sheet captures. Clariva gives you the cash layer of that picture very well. For the complete picture, larger organizations typically work with an accountant who maintains a full set of accounts separately, using Clariva's data as the primary transaction record.

We will return to this in Module 7 when we cover reports.

---

## What Clariva Does With This

In Clariva, each bank account is set up with:
- A name
- A type (checking, savings, foreign currency, special)
- An opening balance and opening date
- A currency

Once set up:
- Every inflow and outflow is tagged to a bank account
- The **Bank Ledger** shows a running balance for each account — every transaction in chronological order, with the balance after each one
- The **Dashboard** shows your total cash position across all accounts at a glance
- Transfers between accounts are recorded as **Fund Transfers** — neither income nor expense, just a movement of money between your own accounts

> *"Confidence you can audit. Every time."* — Clariva

**Next: Module 6 — Designated Funds and Donor Trust**
