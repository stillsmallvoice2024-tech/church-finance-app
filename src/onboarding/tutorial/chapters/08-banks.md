## How to Add a Bank Account

**What you'll need:** The account name and its opening balance before you started using Clariva.

**Where to go:** Administration → Setup → Banks tab

**Time:** ~2 minutes per account.

---

### Steps

1. Open **Administration → Setup** in the left sidebar.
2. Click the **Banks** tab at the top of the Setup page.
3. Click **Add Bank**.
4. Type the **Bank Name** — use the exact name you will choose when importing statements (e.g. "Zenith Bank — Ministry Account"). Consistency matters: a transaction imported under "Zenith Bank" will not appear in the Bank Ledger if the account is saved as "Zenith".
5. Optional: type the **Account Number** and choose the **Account Type** (e.g. Savings, Current).
6. Under **Opening Balance**, enter the **Starting Balance** — the amount held in this account on the day you began using Clariva. Enter 0 if you are starting fresh.
7. If this is a foreign-currency account, change the **Account Currency** dropdown from the default to the relevant currency.
8. Optional: under **Allocations**, add rows to specify which categories and budget portions transactions imported from this bank should default to.
9. Click **Add Bank**.

![Screenshot: the Add Bank form filled in with a bank name, account type, and starting balance](./screenshots/08-banks-step-07.png)

### Result

The bank account appears in the Banks list and is immediately available in the bank dropdown during statement import, in the Bank Ledger, and in Bank Deposits.

---

### Common issues

- **Bank not showing in the Import dropdown:** The bank must be saved in Setup before you import. Return to Administration → Setup → Banks tab and confirm it is listed.
- **Starting balance is wrong:** Click the pencil icon on the bank row, correct the balance, and save. The Bank Ledger's opening Balance Brought Forward row will update.
- **You see "Access denied":** Only Admins and Owners can add or edit bank accounts.

---

## How to Read the Bank Ledger

**What you'll need:** At least one bank account configured and some imported transactions.

**Where to go:** Banking → Bank Ledger

**Time:** ~2 minutes.

---

### Steps

1. Open **Banking → Bank Ledger** in the left sidebar.
2. Use the **Bank** dropdown in the filter card to select the account you want to review.
3. Optionally set a **From** and **To** date range to narrow the view.
4. Three summary cards appear: **Total Inflows**, **Total Outflows**, and **Net Balance** for the selected period.
5. The transaction table shows each entry in date order with a running **Balance** column.
6. The blue **Balance Brought Forward** row at the top shows the account's opening balance.
7. Click the small **arrow** on any row to expand and see full transaction details.
8. Click the **pencil** on a row to correct a mistake.

![Screenshot: the Bank Ledger with a bank selected, summary cards visible, and the transaction table below](./screenshots/08-banks-step-08.png)

### Result

You can see every transaction for that account and verify the running balance matches your real bank statement.

---

### Common issues

- **"Select a bank above to view its ledger":** Pick a bank from the dropdown — the ledger is blank until a bank is chosen.
- **Net Balance does not match your statement:** Run a reconciliation check via **Review & Processing → Reconciliation** and follow the issue links to identify the discrepancy.

---

## How to Run a Reconciliation Check

**What you'll need:** At least one bank account with transactions. Ideally, your paper or PDF bank statement for reference balances.

**Where to go:** Review & Processing → Reconciliation

**Time:** ~5 minutes including fixing any issues.

---

### Steps

1. Open **Review & Processing → Reconciliation** in the left sidebar.
2. Click **Run Reconciliation** at the top right.
3. Wait while the system checks your records.
4. Read the result card — green **Healthy**, amber **Warning**, or red **Critical**.
5. Open the **Issues to Resolve** section. Start with red (critical) issues.
6. Each issue card explains the problem in plain words and provides a direct link (e.g. **View Bank Ledger**) — click it to go straight to the affected record.
7. Fix the record on that page, return here, and click **Run Reconciliation** again.
8. In the **Account Status** table, click the pencil next to a bank's Reference Balance to enter the closing balance and date from your actual bank statement.

### Result

When all issues are resolved you see **Everything looks good** — your app records are consistent with your bank statements.

### Common issues

- **"You can't edit reference balances":** You need write access. Ask an Admin.
- **Issues keep reappearing after fixing:** The fix may not have saved. Check that you clicked Save or Confirm on the affected record before re-running.
