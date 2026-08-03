## How to Import a Bank Statement

**What you'll need:** A bank statement from your bank saved as Excel (.xlsx or .xls) or CSV. PDF files are also supported but column mapping is manual.

**Where to go:** Daily Finance → Import

**Time:** ~5 minutes on a first import; ~2 minutes once you have a saved template.

---

### Steps

1. Open **Daily Finance → Import** in the left sidebar. Only Admins and Accountants can access this page.
2. Click the **File Import** tab if it is not already active.
3. Drag your file onto the upload zone, or click **Browse** and pick your file.
4. Wait for the system to read the file. You will see the filename and a row count appear.
5. Choose the **Bank** this statement belongs to from the dropdown. This links transactions to the correct bank ledger.
6. Click **Continue to Import Wizard**.

![Screenshot: the upload zone with a file selected and the bank dropdown filled in](./screenshots/04-import-step-06.png)

7. **Sheet and table selection:** If your file has multiple sheets, pick the right one. Leave Target Table as "Bank Statement (auto-split → Inflow / Outflow)" unless you have a specific reason to change it.
8. **Column mapping:** The system shows your file's column headers and guesses which Clariva field each one represents. Check every dropdown and correct any wrong guesses. Set any unwanted columns to **Skip**.
9. To save this mapping for future imports from the same bank, type a name in the **Save mapping as template** field and click **Save template**.
10. Click **Configure Rows** to proceed to the next step.

![Screenshot: the column mapping screen with dropdowns set for Date, Description, Credit, and Debit](./screenshots/04-import-step-10.png)

11. Review the **Inflow** tab. For each row you want to categorise now, choose an **Income Type** and a **Config** from the dropdowns. Use the batch bar at the top to apply one choice to many rows at once.
12. Click the **Outflow** tab and repeat for expenditure rows.
13. Deselect any rows that are duplicates or that you do not want to import (click the checkbox on the row).
14. Click **Next** to start the import. Watch the progress bar.
15. **Optional but recommended:** When the import finishes, type the **Statement Date** and **Closing Balance** printed on your actual bank statement, then click **Save Statement Balance**. The Reconciliation Centre uses this figure to check your records.
16. Click **Import Another** to continue with the next statement, or **Back to Dashboard** when done.

### Result

All imported transactions appear immediately in **Daily Finance → Inflows** and **Daily Finance → Outflows**, in the **Banking → Bank Ledger** for the selected bank, and in all report totals.

---

### Common issues

- **Duplicate warning (amber or red box):** Click **Skip Duplicates & Import** to leave out already-imported rows. Only use **Import Anyway** if you are certain none of the flagged rows are real duplicates — importing duplicates inflates your totals.
- **"No reference / transaction ID column":** Your file has no reference column, but duplicate checking still runs — the wizard fingerprints each row by date, description, amount and bank, and skips rows already in the database. Only caveat: two different transactions with an identical date, amount and description look the same to this check, so the second is flagged in the results panel for you to review.
- **Wrong amounts after import:** The Debit and Credit columns were probably swapped in step 8. Find the affected rows in Inflows/Outflows and edit them, or re-import with the corrected mapping.
- **Import page is not in the menu:** Your account role is Viewer. Ask an Admin or Accountant to import.
- **PDF detected:** Column mapping is fully manual for PDFs — the system cannot read column headers from a PDF. You will need to identify each column yourself in step 8.

---

## How to Add One Transaction by Hand (Manual Entry)

**What you'll need:** The date, amount, and bank account for the transaction.

**Where to go:** Daily Finance → Import → Manual Entry tab

**Time:** ~1–2 minutes per transaction.

---

### Steps

1. Open **Daily Finance → Import** and click the **Manual Entry** tab.
2. Click **Inflow** (green, money coming in) or **Outflow** (red, money going out).
3. Fill in the required fields (marked with a star): **Date**, **Amount**, and **Bank**.
4. Add a **Description** so the entry is identifiable later (e.g. "Generator fuel — June 2026").
5. For outflows: optionally pick a **Category**, **Fund Type**, and **Outflow Type**. Tick **Mark as Pending Deduction** if the payment is approved but has not left the bank yet.
6. Click **Save Inflow** or **Save Outflow**.

### Result

The transaction appears in Inflows or Outflows, the Bank Ledger, and all reports immediately.

### Common issues

- **"Possible Duplicate" warning:** A transaction with the same reference already exists. Click **Cancel** and check Inflows/Outflows before saving to avoid double-counting.
- **Bank dropdown is empty:** No bank accounts are configured yet. Go to Administration → Setup → Banks tab and add one.
