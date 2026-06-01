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
- `resolveEmail()` in `LoginPage.tsx` calls `supabase.rpc('resolve_username', { p_username })` — **not** a direct table query
- Direct `profiles` SELECT is blocked by RLS for unauthenticated users (`auth.uid() IS NOT NULL`); the RPC bypasses this via `SECURITY DEFINER`
- `resolve_username` is granted to the `anon` role; returns only the `email` column

### Invite (`/invite/:token`)
- `AcceptInvite.tsx` validates token via `get_invitation_by_token(p_token)` RPC — security-definer, anon-safe, returns only pending non-expired rows
- On valid token: calls Supabase `signUp` (with `username` + `full_name` in `options.data`), then calls `accept_invitation(p_token, p_user_id)` RPC **first**, then `profiles.update()` non-fatally as a display-name overlay
- Order matters: `accept_invitation` must run before `profiles.update()` — the RPC guarantees the profile row exists (INSERT from `auth.users` if trigger failed) and sets role; `profiles_update_self` WITH CHECK will fail if no profile row exists yet
- `accept_invitation` atomically: upserts profile with `username`/`full_name` from `auth.users` metadata (COALESCE — never clobbers existing values), sets `profiles.role`, upserts `org_members`, marks invite accepted
- Org resolution in `accept_invitation`: `v_invite.org_id` → `organizations WHERE slug='primary'` → `organizations LIMIT 1` (any org) — RAISE WARNING if all fail
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

## RLS Patterns

- All tables: `public` schema, RLS enabled
- Helper DB functions: `is_admin()`, `is_finance_user()` — both are `SECURITY DEFINER STABLE`; they query `profiles` without triggering RLS (no recursion risk)
- **DELETE policies**: use `is_finance_user()` for transaction data; `is_admin()` for config/setup data
  - `inflow_transactions`, `outflow_transactions`, `intra_flows`, `receipts` DELETE → `is_finance_user()`
  - `profiles`, config tables, report tables DELETE → `is_admin()`
- **`receipts` policies**: SELECT = any auth user; INSERT/DELETE = `is_finance_user()`
- **`profiles` policies** (post-security-hardening):
  - `profiles_select` — `auth.uid() IS NOT NULL` (authenticated reads only — anon reads blocked; use `resolve_username` RPC for pre-auth lookups)
  - `profiles_insert` — `auth.uid() IS NOT NULL` (trigger handles most profile creation)
  - `profiles_update_self` — `USING (id = auth.uid())` + `WITH CHECK (id = auth.uid() AND role = (SELECT role FROM profiles WHERE id = auth.uid()))` — blocks self-role-escalation; **WITH CHECK sub-query returns NULL if no profile row exists yet**, causing 42501 — this is why `accept_invitation` must run before any client-side `profiles.update()` during invite signup
  - `profiles_update_admin` — `USING (is_admin())` — allows admins to change any user's role
  - `profiles_delete` — `USING (is_admin())`
- `is_admin()` is safe to use in `profiles` policies — it runs as `SECURITY DEFINER` and bypasses RLS on `profiles` internally; no infinite recursion
- `intraflow_update` policy may be absent on older DBs — symptom: update returns 0 rows silently → fix: run `supabase/fix_intraflow_update_policy.sql`

---

## Invitations Table

| Column | Type | Notes |
|---|---|---|
| `token` | uuid | Single-use UUID; indexed |
| `email` | text | Invited email address |
| `org_id` | uuid | FK → organizations; **may be NULL** for invites created when `orgId` is falsy in UserManagement — `accept_invitation` handles this with 3-tier org fallback |
| `expires_at` | timestamptz | Token expiry (7 days default) |
| `role` | text | Role to assign on accept |
| `status` | text | `pending` / `accepted` / `expired` |

**RLS:** Admins manage via `invitations_admin_all`. No direct SELECT for non-admins.
Use `get_invitation_by_token(uuid)` RPC to validate a token (anon-safe).
Use `accept_invitation(token, user_id)` RPC to consume and apply role.

## Security-Definer RPCs

| Function | Caller | Purpose |
|---|---|---|
| `get_invitation_by_token(p_token uuid)` | anon / new user | Returns pending non-expired invite row; never exposes accepted/expired rows |
| `accept_invitation(p_token uuid, p_user_id uuid)` | newly registered user | Upserts profile (with username from auth.users metadata), sets role, upserts org_members, marks invite accepted; enforces `p_user_id = auth.uid()`; 3-tier org fallback |
| `resolve_username(p_username text)` | anon (login page) | Maps username → email, bypassing `profiles_select` RLS; returns only `email`; granted to `anon` role |

## handle_new_user Trigger (auth.users → profiles)

- Fully defensive — never re-raises; auth user creation always succeeds regardless of profile/org_members errors
- Profile INSERT: tries with `username`; on `unique_violation` retries with `NULL` username; on any other error logs `RAISE WARNING` and continues
- org_members INSERT: wrapped in `WHEN OTHERS` — logged and swallowed
- Diagnostic `RAISE WARNING` messages include `SQLSTATE` + `SQLERRM` — visible in Supabase Dashboard → Logs → Postgres
- `accept_invitation` is the authoritative profile/org_members creator for invite flow; trigger failure is non-fatal because the RPC re-creates what's needed
