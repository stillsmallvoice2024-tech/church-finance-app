## What is this chapter about?

Mistakes and money-backs happen. The app has two pages for them, at **Review & Processing → Refunds** and **Review & Processing → Reversals**.

## Refund or Reversal — which one is it?

- A **Refund** is real money moving back. Example: you paid a supplier too much and they sent money back to your bank. Cash actually moved.
- A **Reversal** is fixing a record. Example: a transaction was entered twice, so you cancel one out. No real cash moved.

## How pairs work

Both pages show transactions in **matched pairs**:

- The **Original** (also called the Root) — the first transaction.
- The **Offset** — the refund or reversal that cancels or adjusts it.

Matched pairs are grouped together with a green header saying **Matched pair**. Rows with no partner appear at the bottom under **Unmatched**.

## How to record a refund

1. Go to **Import → Manual Entry** (or it may already be in your imported statement).
2. If money came BACK INTO your bank, record an **Inflow**; if your organisation PAID money back, record an **Outflow**.
3. Set **Transaction Type** to **Refund**.
4. Set **Offset Role** to **Offset (linked to root)**.
5. In **Root / Original Transaction**, search for and pick the original transaction this refund belongs to.
6. Save. The pair now shows matched on the Refunds page.

A reversal is recorded the same way — just choose **Reversal** as the Transaction Type.

## How to read the Refunds / Reversals pages

1. The summary cards show **Total rows**, **Originals**, **Refunds** (or **Reversals**), and **Unmatched**. Unmatched turns red when something needs linking.
2. Use the date filters at the top to narrow the period.
3. Click the chevron on any row to expand its full details.
4. Switch between table and card layout with the two small buttons at the top right.

## How to link an unmatched refund

1. Scroll to the **Unmatched** section.
2. Click the **link** icon on the row.
3. Search for the original transaction and pick it.
4. The row moves up into a matched pair.

## If something goes wrong

- **A refund shows as unmatched** — it was saved without a root. Use the link icon to connect it.
- **The totals look double-counted** — make sure the offset row really has Offset Role = Offset; otherwise the app can't subtract it.
- **"Showing first 5,000 refunds"** — you have a lot of rows; narrow the date filter or export from Settings for the full list.
