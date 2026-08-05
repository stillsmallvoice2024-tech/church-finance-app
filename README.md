# Church Finance App

A full-featured financial management system for **The Standing Church International**, built with React, TypeScript, and Supabase.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, TypeScript (strict), Vite |
| Styling | Tailwind CSS v3 |
| Routing | React Router v6 |
| State | Zustand v5 |
| Forms | react-hook-form + zod |
| Charts | Recharts |
| Backend | Supabase (PostgreSQL + RLS) |
| Excel Import | SheetJS (xlsx) |
| Auth | Supabase Auth (email/password) |

---

## Features

- **Dashboard** — KPI cards, monthly inflow/outflow chart, account balances, FX overview, real-time updates
- **Inflows** — Paginated transaction list, filters, CSV export, Excel import, keyboard shortcut `Ctrl+N`/`Cmd+N`
- **Outflows** — Disbursements with refund and transfer charge tracking
- **Accounts** — Chart of accounts, ledger entry history with sparkline charts, balance snapshots
- **Special Projects** — Project-specific fund tracking with inline ledger, department units tab
- **Foreign Currency** — USD/GBP/EUR/CNY balances, manual Naira rate inputs, FX transaction log
- **Fund-to-Fund Transfer** — Internal fund movement tracking with fund-to-fund mapping
- **Reports** — Annual summary, monthly breakdown, account balances, FX holdings, audit log (admin only)
- **User Management** — Role management (admin/accountant/viewer), invite users, revoke access
- **Settings** — Profile update, password reset, live DB status ping
- **Excel Import** — 4-step wizard: Upload → Sheet → Column Mapping → Preview & Import (all 5 tables)

### Role-based Access

| Feature | Admin | Accountant | Viewer |
|---------|-------|-----------|--------|
| View all data | ✅ | ✅ | ✅ |
| Add / Edit records | ✅ | ✅ | ❌ |
| Delete records | ✅ | ❌ | ❌ |
| User Management | ✅ | ❌ | ❌ |
| Audit Log | ✅ | ❌ | ❌ |
| Import Excel | ✅ | ✅ | ❌ |

---

## Project Structure

```
src/
├── components/
│   ├── auth/           # AuthGuard, RoleGates, LoginPage
│   ├── layout/         # Layout, Sidebar, TopBar, BottomTabBar
│   ├── modals/         # AddInflowModal, AddOutflowModal, ImportModal, …
│   └── ui/             # Card, Badge, Pagination, Toast, ErrorBoundary, …
├── hooks/              # useTransactions, useLedger, useFX, useMutations, …
├── pages/              # One file per route
├── store/              # Zustand: authStore, toastStore
├── types/              # Shared TypeScript types
└── utils/              # formatters, csvExport, accountNames, constants
supabase/
└── schema.sql          # Full DB schema with RLS policies
```

---

## Local Setup

### Prerequisites

- Node.js 18+
- A [Supabase](https://supabase.com) project

### 1. Clone and install

```bash
git clone <repo-url>
cd church-finance-app
npm install
```

### 2. Configure environment

Create a `.env` file in the project root:

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

Find these values in your Supabase project under **Settings → API**.

### 3. Set up the database

In your Supabase project, open the **SQL Editor** and run the contents of:

```
supabase/schema.sql
```

This creates all tables, indexes, RLS policies, views, and functions.

### 4. Create the first admin user

1. In Supabase **Authentication**, create a user with email/password
2. In the **SQL Editor**, promote them to admin:

```sql
update public.profiles
set role = 'admin'
where email = 'your@email.com';
```

### 5. Run the dev server

```bash
npm run dev
```

Open [http://localhost:5173](http://localhost:5173)

---

## Supabase Database Schema

### Tables

| Table | Purpose |
|-------|---------|
| `profiles` | Extended user data (full_name, role) |
| `accounts` | Chart of accounts with category and currency |
| `ledger_entries` | Balance snapshots per account |
| `inflow_transactions` | Income and receipts |
| `outflow_transactions` | Disbursements and payments |
| `intra_flows` | Internal fund-to-fund transfers |
| `fx_transactions` | Foreign currency buy/sell entries |
| `special_projects` | Project/department fund tracking |
| `project_entries` | Individual ledger lines per project |
| `audit_log` | Admin-visible action history |
| `invitations` | Pending user invitations |

### Account Code Reference

| Range | Category |
|-------|---------|
| 100–199 | Income accounts |
| 200–299 | Expense / ministry |
| 300–310 | Department units |
| 400–499 | Special projects |
| 500–599 | Savings accounts |
| 600–699 | Foreign currency holdings |

---

## Deployment (Vercel)

### 1. Push to GitHub

```bash
git init
git add .
git commit -m "Initial commit: Church Finance App"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/church-finance-app.git
git push -u origin main
```

### 2. Deploy on Vercel

1. Go to [vercel.com](https://vercel.com) → **New Project** → Import from GitHub → select `church-finance-app`
2. Framework Preset: **Vite**
3. Build Command: `npm run build`
4. Output Directory: `dist`
5. Add Environment Variables:
   ```
   VITE_SUPABASE_URL      = https://your-project.supabase.co
   VITE_SUPABASE_ANON_KEY = your-anon-key
   ```
6. Click **Deploy**

The included `vercel.json` handles two things automatically:
- **SPA rewrites** — all paths serve `index.html` so React Router links work correctly
- **Security headers** — `X-Content-Type-Options`, `X-Frame-Options`, `X-XSS-Protection`

### 3. Configure Supabase for your live URL

After Vercel gives you a URL (e.g. `https://church-finance-app.vercel.app`):

1. Go to Supabase → **Authentication** → **URL Configuration**
2. Set **Site URL**: `https://church-finance-app.vercel.app`
3. Add to **Redirect URLs**: `https://church-finance-app.vercel.app/**`

This is required for password-reset emails and magic links to redirect correctly.

### 4. Create the first admin account

```sql
-- Run in Supabase SQL Editor after signing up on the live site
update public.profiles
set role = 'admin'
where email = 'your@email.com';
```

### 5. Deployment checklist

- [ ] Login page loads
- [ ] Can sign in
- [ ] Dashboard shows (empty until data is added)
- [ ] Import modal works
- [ ] Can add a transaction
- [ ] User Management visible to admin
- [ ] Works on mobile browser

### 6. Custom domain (optional, free on Vercel)

If you have a domain (e.g. `finance.standingchurch.org`):

1. Vercel → Project → **Settings** → **Domains** → Add domain
2. Update DNS records as instructed by Vercel
3. Update Supabase **Site URL** and **Redirect URLs** to the custom domain

---

## Excel Import

The Import modal supports all 5 transaction tables. Supported column name formats (case-insensitive):

| DB Field | Recognised aliases |
|----------|--------------------|
| `date` | date, dt, transdate, valuedate, transaction date |
| `amount` | amount, amt, value, sum, naira |
| `description` | description, desc, narration, particulars, memo |
| `stage_code_1` | stage code 1, stage1, account code, code |
| `transaction_id` | transaction id, txn id, ref, reference |

Dates can be in `DD/MM/YYYY`, `YYYY-MM-DD`, or Excel serial number format.

---

## Troubleshooting

**Login fails / infinite loading**
- Check that `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are correct in `.env`
- Verify the `profiles` table exists and has a trigger to auto-create entries on signup

**"Permission denied" errors**
- RLS policies require the user's `profiles.role` to be set. Ensure the user row exists in `profiles`

**Charts show no data**
- Dashboard charts rely on `inflow_transactions` and `outflow_transactions`. Add some records first

**Import fails silently**
- Check the browser console for Supabase error details
- Ensure the column mapping matches required fields (Date and at least one amount field)

---

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start development server |
| `npm run build` | Production build |
| `npm run preview` | Preview production build locally |
| `npm run lint` | Run ESLint |
