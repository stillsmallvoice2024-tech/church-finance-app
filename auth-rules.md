# Auth & Roles Rules

> Load when tasks involve: auth flows, login, invites, password reset, roles, permissions, RLS policies, protected routes.

---

## Role System

- Three roles: `admin`, `accountant`, `viewer` — stored in `profiles.role`
- Roles are enforced at **both** the frontend (`useRole`) and database (RLS) layers
- `useRole()` returns actual role-based booleans — checks `profile.role`, guards on `loading`
- During profile hydration (`loading === true`), all permission methods return `false` — prevents flash

### `useRole()` helpers

| Helper | Access |
|---|---|
| `isAdmin()` | `role === 'admin'` |
| `isAccountant()` | `role === 'accountant'` |
| `isViewer()` / `isReadOnly()` | `role === 'viewer'` |
| `canWrite()` | admin \| accountant |
| `canDelete()` | admin \| accountant |
| `canEditTransactions()` | admin \| accountant |
| `canImportTransactions()` | admin \| accountant |
| `canManageConfigs()` | admin only |

### `RoleGates` components

| Component | Access |
|---|---|
| `<AdminOnly>` | admin only |
| `<CanWrite>` | admin \| accountant |
| `<CanImport>` | admin \| accountant |
| `<CanManageConfigs>` | admin only |

### Route-level guards (`App.tsx`)

- `<CanWriteGuard>` — wraps `/import`, `/setup`; redirects viewer → `/`
- `<AdminOnlyGuard>` — wraps `/users`, `/change-log`; redirects non-admin → `/`
- Route guards are primary enforcement; page-level guards in `Import.tsx`, `Setup.tsx`, `UserManagement.tsx` are defense-in-depth

### Navigation visibility

- Sidebar and BottomTabBar items support `adminOnly?: boolean` and `canWriteOnly?: boolean` flags
- `canWriteOnly: true` → hidden for viewers (Import, Setup)
- `adminOnly: true` → hidden for non-admins (User Management, Change Log)
- Import tab removed from primary bottom bar for viewers

## Critical: Loading guard replaces the old `!!user` gate

`useRole()` uses `!loading && !!user` as the base (`resolved`), then checks `role` on top.
Old pattern `isAdmin: () => !!user` has been removed — it bypassed all role checks.
`role` is safe to use because it is set atomically with `profile` in `setProfile()` in authStore.

---

## Auth Flows

### Login
- Accepts email **or** username
- `resolveEmail()` in `LoginPage.tsx` maps username → email via `profiles` table lookup before calling Supabase auth

### Invite (`/invite/:token`)
- `AcceptInvite.tsx` validates token via `get_invitation_by_token(p_token)` RPC — security-definer, anon-safe, returns only pending non-expired rows
- On valid token: calls Supabase `signUp`, updates profile display fields (name, username — NOT role), then calls `accept_invitation(p_token, p_user_id)` RPC
- `accept_invitation` atomically sets `profiles.role` from the invite and marks it accepted; enforces `p_user_id = auth.uid()` to block impersonation
- Role is never set via a direct `profiles` UPDATE from the client — always through the RPC
- Invite tokens are single-use UUIDs

### Password Reset (`/reset-password`)
- Listens for `PASSWORD_RECOVERY` Supabase auth event
- Renders new-password form only after that event fires

---

## Routes

- **Public (no auth):** `/login`, `/reset-password`, `/invite/:token`
- **Protected:** all other routes wrapped in `<AuthGuard>` (defined in `App.tsx`)

---

## Auth Store & Hook

- `src/store/authStore.ts` — Zustand: `user`, `profile`, `role`, `loading`, `profileFetchFailed`
  - `setProfile()` atomically sets `profile` + `role` + resets `profileFetchFailed`
  - `clearAuth()` resets all fields including `profileFetchFailed`
- `src/hooks/useAuth.ts` — manages Supabase auth event listeners + `fetchProfile` call
- Uses request ownership model (monotonic `requestIdRef` + `AbortController`) for background-tab resilience — see `miscellaneous.md`

### fetchProfile rules (critical)
- Uses raw `fetch` with **no** `credentials: 'include'` — Supabase REST authenticates via `Authorization: Bearer <token>`; adding `credentials: 'include'` causes browsers to apply the credentialed-CORS check, which fails against Supabase's default `Access-Control-Allow-Origin: *`, silently dropping the response
- Retries up to 3 times (0 / 500 / 1 000 ms backoff) before marking `profileFetchFailed = true`
- `AuthGuard` shows `ProfileErrorScreen` (with sign-out button) when `!profile && profileFetchFailed` — prevents silent viewer-like state for authenticated users whose profile could not load

---

## RLS Patterns (Phase 3 — org-scoped)

- All tables: `public` schema, RLS enabled
- **SELECT** on all business tables: `is_org_member(org_id)` — visible only to active members of the row's own org
- **INSERT/UPDATE** on transaction tables: `is_org_finance_user(org_id)` (admin + accountant)
- **INSERT/UPDATE** on config/reference tables: `is_org_admin(org_id)` (admin only)
- **DELETE**: `is_org_finance_user(org_id)` for transactions/receipts; `is_org_admin(org_id)` for config/setup tables
- `auth.uid() IS NOT NULL` is **not** used for any business table — always use org-scoped helpers
- **`profiles` policies** (no org_id — global user registry):
  - `profiles_select` — `auth.uid() IS NOT NULL` (cross-org read acceptable for username lookup)
  - `profiles_insert` — `auth.uid() IS NOT NULL`
  - `profiles_update_self` — `USING (id = auth.uid())` + `WITH CHECK (role = old.role)` — blocks self-role-escalation
  - `profiles_update_admin` — `USING (is_admin())`
  - `profiles_delete` — `USING (is_admin())`
- **`audit_log` / `field_changes`** (no org_id): SELECT = `is_admin()`; INSERT = active org membership check
- **`dynamic_report_blocks` / `dynamic_report_snapshots`** (no direct org_id): isolated via JOIN through `dynamic_reports.org_id`; policy DO blocks are wrapped in `EXCEPTION WHEN undefined_table` so they skip silently if the table doesn't exist yet
- `intraflow_update` policy may be absent on older DBs — symptom: update returns 0 rows silently → fix: run `supabase/fix_intraflow_update_policy.sql`

### Helper functions

| Function | Source | Purpose |
|---|---|---|
| `is_org_member(p_org_id)` | `org_members` | Any active role — used by all SELECT policies |
| `is_org_finance_user(p_org_id)` | `org_members` | admin or accountant + active — used by transaction write policies |
| `is_org_admin(p_org_id)` | `org_members` | admin + active — used by config/reference write + delete policies |
| `is_admin()` | `org_members` | Any org admin + active — used by `profiles`, `audit_log`, `field_changes` |
| `is_finance_user()` | `org_members` | Any org finance user + active — used where org_id unavailable |

All helpers are `SECURITY DEFINER STABLE` — bypass RLS on `org_members` internally; no recursion risk.  
**`is_admin()` and `is_finance_user()` now query `org_members` (not `profiles`) — suspended users lose access immediately.**

---

## Invitations Table

| Column | Type | Notes |
|---|---|---|
| `token` | uuid | Single-use UUID; indexed |
| `email` | text | Invited email address |
| `expires_at` | timestamptz | Token expiry (7 days default) |
| `role` | text | Role to assign on accept |
| `status` | text | `pending` / `accepted` / `expired` |
| `org_id` | uuid | FK → `organizations(id)` — set at invite creation |

**RLS (Phase 3):** `is_org_admin(org_id)` for SELECT/INSERT/UPDATE/DELETE. No direct SELECT for non-admins.
Use `get_invitation_by_token(uuid)` RPC to validate a token (anon-safe, SECURITY DEFINER).
Use `accept_invitation(token, user_id)` RPC to consume and apply role.

## Security-Definer RPCs

| Function | Caller | Purpose |
|---|---|---|
| `get_invitation_by_token(p_token uuid)` | anon / new user | Returns pending non-expired invite row; never exposes accepted/expired rows |
| `accept_invitation(p_token uuid, p_user_id uuid)` | newly registered user | Sets `profiles.role` + upserts `org_members.role`; marks invite accepted; enforces `p_user_id = auth.uid()` |

### accept_invitation sync requirement
`accept_invitation` now upserts `org_members` alongside `profiles.role`. This is required because Phase 3 RLS helpers read `org_members`, not `profiles`. Both must stay in sync:
- `profiles.role` — read by frontend `useRole()` hook
- `org_members.role` — authoritative for all RLS policy decisions

### handle_new_user trigger (Phase 3)
`handle_new_user` now auto-enrolls every new sign-up in the primary org as `viewer` (`org_members` row with `status = 'active'`). This ensures Phase 3 RLS helpers work on first request. `accept_invitation` then promotes the role on invite acceptance.

### Bootstrap note
On a fresh install, the first admin must have **both** `profiles.role = 'admin'` AND `org_members.role = 'admin'` set via Supabase SQL editor. `handle_new_user` creates the viewer entry; manual promotion is required for the first admin.
