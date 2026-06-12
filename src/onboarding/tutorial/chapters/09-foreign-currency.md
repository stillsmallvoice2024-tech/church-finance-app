## What is the Foreign Currency page?

Sometimes people give money in other currencies — dollars, pounds, euros. This page keeps those monies separate until you exchange (convert) them into your everyday currency. Find it at **Banking → Foreign Currency**.

## What's on the page

- **Currency cards** at the top — one card per currency (with its flag), showing how much you hold right now. Click a card to filter the lists below to that currency.
- An **Equivalent (Enter Rates)** box — type today's exchange rate for each currency and the app shows what your holdings are worth in your everyday currency. This is just a preview; it doesn't change anything.
- A **Transactions** table — every foreign-currency deposit and withdrawal, with a running balance.
- A **Conversion History** table — every time you exchanged foreign money into your everyday currency.

## How to record a foreign-currency gift (deposit)

1. Click **Add Transaction** (top right).
2. Pick the **Date**.
3. Pick the **Currency** (example: USD).
4. Pick the **Bank** that holds it (a foreign-currency bank set up in Setup → Banks).
5. Choose **deposit** as the Transaction Type.
6. Type the **Amount**. The box below shows the previous balance and the new balance.
7. Optional: type a **Narration** (what it was for) and a **Transaction Ref**.
8. Click **Save Transaction**.

A withdrawal works the same way — just choose **withdrawal** instead.

## How to convert foreign money into your everyday currency

Do this when you actually exchange the money at the bank.

1. Click the green **Convert to [your currency]** button.
2. Pick the **Source Currency** by clicking its pill (it shows the available balance). Click **Use full balance** to convert everything.
3. Type the **FX Amount** (how much foreign money you exchanged) and the **Rate** the bank gave you. A green preview shows the result.
4. Pick the **Conversion Date** and the **Receiving Bank** (where the local money landed).
5. Optional: add **Notes** and pick an **Allocation Config** so the new inflow is split correctly (or leave "Auto-detect by date").
6. Click **Record Conversion**.

The app then does three things at once: takes the foreign money out, creates a local-currency inflow, and writes a line in Conversion History.

## How to fix or undo a conversion

1. In **Conversion History**, click the **pencil** on the row (admins only).
2. To fix the rate or bank: change the fields and click **Save Changes** — the linked inflow updates automatically.
3. To undo completely: click **Revert Conversion**, read the warning, and click **Confirm Revert**. The foreign money comes back and the local inflow is removed.

## If something goes wrong

- **"No FX holdings with a positive balance"** when converting — record the foreign deposit first.
- **Amount won't save** — you may be trying to convert more than you hold. Check the **Available** balance.
- **Foreign gift shows in normal Inflows instead** — foreign money must be recorded here, not on the Inflows page. Banks marked as foreign-currency are handled only in this module.
