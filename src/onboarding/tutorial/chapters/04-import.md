## What is the Import page?

Import is where transactions enter the app. You upload your bank statement (an Excel or PDF file from your bank), and the app reads every line and saves it as inflows (money in) and outflows (money out). You can also type one transaction by hand using **Manual Entry**.

Only **Admins** and **Accountants** can import. Find it in the left menu: **Daily Finance → Import**.

## The two tabs

- **File Import** — upload a whole bank statement file. Use this most of the time.
- **Manual Entry** — type one transaction yourself.

## How to import a bank statement (step by step)

### Step A: Choose your file

1. Get your bank statement from your bank as an Excel file (.xlsx or .xls) or a PDF.
2. On the Import page, find the big box that says **Drop your file here, or click to browse**.
3. Click it and pick your file (or drag the file onto the box).

### Step B: Review and confirm

1. The app reads the file and shows its name and how many rows it found.
2. The app checks for **duplicates** — lines you already imported before. Wait for the check to finish.
3. If it says **No duplicates found** (green), great.
4. If duplicates ARE found (red box), you get two choices: **Skip Duplicates & Import** (recommended — leaves out the repeated lines) or **Import Anyway** (keeps everything, may double-count!).
5. Pick the **Bank** this statement belongs to from the Bank dropdown. This is important — transactions without a bank don't show in the Bank Ledger.
6. Click **Continue to Import Wizard**.

### Step C: The Import Wizard

1. **Pick the sheet and table.** If your Excel file has several sheets, choose the right one. The Target Table is usually **Bank Statement (auto-split → Inflow / Outflow)** — the app sorts money-in and money-out lines for you.
2. **Map the columns.** The app shows your file's column names and guesses what each one means (Date, Description, Credit, Debit, Reference…). Check each dropdown and fix any wrong guesses. Pick SKIP for columns you don't need. Tip: click **Save as template** so the app remembers this mapping for next time.
3. **Configure the rows.** You see two tabs: **Inflow** and **Outflow**. For inflow rows, the app suggests an **Income Type** from the description (you can change it) and an allocation **Config**. For outflow rows, pick a **Category**, **Fund Type**, and **Outflow Type** where needed. Use the batch bar at the top to apply one choice to many selected rows at once.
4. **Import.** Click Next and watch the progress bar. At the end you see how many rows were imported and how many were skipped.
5. **Optional but smart:** type the **Statement Date** and **Closing Balance** printed on your bank statement and click **Save Statement Balance**. The Reconciliation Center uses this to check your records.
6. Click **Import Another** for the next statement, or **Back to Dashboard**.

## How to add one transaction by hand (Manual Entry)

1. Click the **Manual Entry** tab.
2. Click **Inflow** (money in, green) or **Outflow** (money out, red).
3. Fill the boxes. The ones with a star are required: **Date**, **Amount**, and **Bank**.
4. Add a **Description** so you remember what it was (example: "Generator fuel purchase").
5. For outflows, you can pick a **Category**, **Fund Type**, and **Outflow Type**, and tick **Mark as Pending Deduction** if the money has been approved but hasn't left the bank yet.
6. Click **Save Inflow** or **Save Outflow**.
7. If the app warns **Possible Duplicate**, it means a transaction with the same ID already exists. Click **Cancel** to check, or **Save Anyway** if you are sure.

## What you'll see afterwards

Your new transactions appear on the **Inflows** and **Outflows** pages, in the **Bank Ledger**, and in all reports.

## If something goes wrong

- **"No transaction ID column detected"** — your file has no reference column, so duplicates can't be checked. You can still import; just be careful not to import the same file twice.
- **PDF detected** — duplicate checking is skipped for PDFs. The wizard will still read and map the columns.
- **Wrong numbers after import** — open Inflows/Outflows, find the row, and edit it (Chapters 5 and 6). Or check your column mapping next time.
- **You can't see the Import page** — your role is Viewer. Ask an Admin or Accountant to import.
