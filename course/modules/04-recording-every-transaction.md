# Module 4: Recording Every Transaction

## The Complete Record

An accounting record is only as good as its completeness. One unrecorded transaction can throw off your bank reconciliation. One missing receipt can undermine an entire audit. One undocumented payment can look like misappropriation — even when it wasn't.

The standard in accounting is clear:

> **Every financial transaction must be recorded. Every record must be supported by a source document.**

This module covers how to do that well.

---

## Source Documents

A **source document** is the original evidence that a transaction took place. Before any entry is made in your books, there should be a corresponding source document.

| Transaction Type | Source Document |
|---|---|
| Donation received | Giving slip, bank deposit slip, transfer confirmation |
| Bill paid | Invoice, receipt, supplier statement |
| Salary paid | Payroll record, signed payslip |
| Petty cash spent | Petty cash voucher, receipt |
| Bank transfer | Bank statement, transfer confirmation |
| Grant received | Grant agreement, payment advice |

The accounting principle of **verifiability** requires that any transaction can be traced back to its source document. If it cannot, it should not be in your books.

---

## The Journal Entry

In traditional bookkeeping, every transaction is first recorded in a **journal** — a chronological log of all financial activity. Each journal entry includes:
- The date
- The accounts affected (debit and credit)
- The amounts
- A brief description
- A reference to the source document

**Example — Offering received:**

| Date | Account | Debit | Credit | Description |
|---|---|---|---|---|
| 2026-06-15 | Bank — Main Account | ₦180,000 | | Sunday offering deposit |
| 2026-06-15 | Tithes & Offerings Income | | ₦180,000 | Sunday offering deposit |

Both sides balance. The record is complete.

In modern systems like Clariva, you do not write journal entries manually — the system creates them as you record transactions. But understanding the underlying structure helps you know what the system is doing.

---

## Bank Reconciliation

**Bank reconciliation** is one of the most important controls in any financial system. It is the process of comparing your internal records to your bank statement to ensure they match.

### Why Reconcile?

- Catches recording errors (wrong amounts, missed entries)
- Detects unauthorised transactions or fraud
- Confirms outstanding cheques have cleared
- Verifies deposits were received as expected

### The Reconciliation Process

1. Obtain your bank statement for the period
2. Compare each entry on the statement to your internal records
3. Identify and explain any differences:
   - **Outstanding deposits** — recorded in your books, not yet on the statement
   - **Outstanding payments** — paid out, not yet cleared the bank
   - **Bank charges** — on the statement, not yet in your books
   - **Errors** — in either your records or (rarely) the bank's
4. After accounting for all differences, your adjusted book balance should equal your adjusted bank balance

The **materiality principle** applies here: even small discrepancies should be investigated. A ₦500 difference today can signal a ₦50,000 problem tomorrow.

---

## Receipts and Evidence

Every outflow from your organization should be supported by a receipt or equivalent evidence. This is not just good practice — in many jurisdictions, it is a legal requirement for registered organizations.

A proper receipt should show:
- Date of transaction
- Vendor or payee name
- Description of what was purchased
- Amount paid
- Payment method

Keeping receipts in a disorganized pile is not enough. They must be filed in a way that allows any transaction to be retrieved and verified within minutes.

---

## The Import Pipeline

For organizations that use bank accounts (which should be all of them), the most efficient way to record transactions is to **import directly from bank statements** rather than entering each transaction manually.

This approach:
- Eliminates transcription errors
- Ensures completeness (nothing is skipped)
- Produces an automatic first draft of your records
- Creates a direct link between your books and your bank

The import process typically works like this:
1. Download your bank statement (usually as CSV or Excel)
2. Import into your financial system
3. Review and categorize each transaction
4. Attach source documents (receipts, invoices) where required
5. Reconcile — confirm the imported total matches your statement balance

---

## What Clariva Does With This

Clariva's import pipeline is designed around this workflow:

1. **Import** — upload your bank statement file; Clariva reads and parses every transaction
2. **Review** — each transaction is displayed for classification; assign categories, flag notes
3. **Receipts** — attach receipt images or files directly to any transaction
4. **Reconciliation** — Clariva tracks your running balance and flags discrepancies

The result: every transaction is in one place, every record is complete, and any transaction can be found and verified in seconds.

> *"Every transaction. In one place. In minutes."* — Clariva

---

**Next: Module 5 — Designated Funds and Donor Trust**
