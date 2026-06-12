## What is the Settings page?

Settings is about YOUR account and your data's safety: your name, password, theme, two-step security, backups, and exports. Find it at **Administration → Settings**.

## My Profile

1. Type your **Full Name** (and an optional **Username** you can use to log in).
2. Click **Save Changes**.
3. Your email and role are shown but can't be changed here — roles are set by an administrator.

## How to change your password

1. Find the **Change Password** section.
2. Type a **New Password** (at least 8 characters) and the same again in **Confirm New Password**.
3. Click **Update Password**. You'll see "Password updated successfully."

## How to turn on two-step security (2FA) — admins and owners

2FA means a thief can't get in with just your password — they'd also need your phone.

1. Find **Two-Factor Authentication** and click **Enable 2FA**.
2. Click **Begin setup**. A square QR code appears.
3. On your phone, open an authenticator app (Google Authenticator, Authy, or 1Password) and scan the QR code.
4. Click **I've scanned it — continue**.
5. Type the 6-digit code your phone shows and click **Verify & enable 2FA**.
6. Done! From now on, signing in asks for a fresh code from your phone.

## How to switch Light / Dark mode

In the **Theme** section, click **Light** or **Dark**. Your choice is saved automatically. (There's also a sun/moon button in the top bar.)

## Data Management — keep your data safe

### How to make a backup

1. Click the **Backup Account** card.
2. Click **Start Backup** and wait while it gathers every table.
3. Click **Download Backup File** — a file saves to your computer. Keep it somewhere safe!
4. Or click **Get Shareable Link** for a secure link that lasts 7 days.
5. Note: receipt files themselves are not inside the backup — only their details.

Make a backup before any big change, and regularly (for example monthly).

### How to restore from a backup

1. Click the **Restore Backup** card.
2. Click **Click to choose backup file** and pick your backup file (ends in .json).
3. Read the summary, then choose a mode: **Merge** (adds the backup's records next to what you have — safe) or **Replace** (deletes everything first, then restores — cannot be undone!).
4. Click **Continue**, read the warning, then click **Restore Now**.
5. When it says **Restore completed successfully**, click **Reload Page**.

### How to export everything as spreadsheets

Click the **Export CSVs** card. Every table (Inflows, Outflows, Transfers, FX, Receipts list, Ledgers, Audit Log…) downloads as its own CSV file automatically. Click **Done** when finished.

## App Information

Shows the app version and whether the database is **Connected**. If it says **Offline**, check your internet and click **Recheck**.

## If something goes wrong

- **"Passwords do not match."** — the two boxes aren't identical. Retype them.
- **Restore looks scary** — choose **Merge**, never **Replace**, unless you truly want to wipe current data first.
- **Lost your phone with the authenticator app** — ask another admin to remove 2FA from your account in their session, or use your backup codes if you saved them.
