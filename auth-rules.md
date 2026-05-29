# Auth & Roles Rules

> Load when tasks involve: auth flows, login, invites, password reset, roles, permissions, RLS policies, protected routes.

---

## Org Context (`src/store/orgStore.ts`)

- New Zustand store (Phase 4); holds the active org session for the signed-in user
- Fields: `orgId: string | null`, `orgName: string | null`, `orgRole: UserRole | null`
- Actions: `setOrg(OrgMembership)`, `clearOrg()`
- `OrgMembership`: `{ org_id, org_name, role }`
- Populated by `useAuth.ts` after every successful auth event; cleared on sign-out

---

## Role System

- Three roles: `admin`, `accountant`, `viewer` — stored in **`org_members.role`** (not `profiles.role`)
- Roles are enforced at **both** the frontend (`useRole`) and database (RLS) layers
- `useRole()` reads `orgRole` from `useOrgStore` — safe because `setLoading(false)` is deferred until org membership loads
- During loading (`loading === true`), all permission methods return `false` — prevents flash

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

## Critical: Loading guard

`useRole()` uses `!loading && !!user` as `resolved`, then checks `orgRole` from `orgStore`.
`orgRole` is safe to access when `resolved = true` because `setLoading(false)` in `useAuth.ts` is deferred until BOTH profile AND org membership have been fetched — no race window.

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
- `src/hooks/useAuth.ts` — manages Supabase auth event listeners + `fetchProfile` + `fetchOrgMembership`
- Uses request ownership model (monotonic `requestIdRef` + `AbortController`) for background-tab resilience — see `miscellaneous.md`

### Auth event sequence (Phase 4)

1. Supabase auth event fires
2. `fetchProfile` — raw fetch, up to 3 retries → sets `authStore` (`profile`, `role`)
3. `fetchOrgMembership` — raw fetch on `org_members?user_id=eq.{uid}&status=eq.active&select=org_id,role,organizations(name)&limit=1`
   - On success: `orgStore.setOrg({ org_id, org_name, role })`
   - On failure / no row: `orgStore.clearOrg()`
4. **`setLoading(false)` called only after step 3 completes** — ensures `useRole().resolved` is never `true` before org role is known

### On sign-out / no session

`useAuth.ts` calls all three in order: `authStore.clearAuth()`, `orgStore.clearOrg()`, `allocationStore.reset()`, `accountCodesStore.reset()`

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
  - `profiles_select` — `auth.uid() IS NOT NULL`
  - `profiles_insert` — `auth.uid() IS NOT NULL` (trigger handles most profile creation)
  - `profiles_update_self` — `USING (id = auth.uid())` + `WITH CHECK (role = old.role)` — blocks self-role-escalation
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
| `accept_invitation(p_token uuid, p_user_id uuid)` | newly registered user | Sets role from invite, marks invite accepted; enforces `p_user_id = auth.uid()` |
