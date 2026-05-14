# Auth & Roles Rules

> Load when tasks involve: auth flows, login, invites, password reset, roles, permissions, RLS policies, protected routes.

---

## Role System

- Three roles: `admin`, `accountant`, `viewer` — stored in `profiles.role`; displayed as UI badges only
- **All authenticated users have full read/write/delete access** — roles are not feature-restrictive
- `useRole()` → `isAdmin()`, `canWrite()`, `canDelete()` all return `!!user` (not `!!role`)
- `<AdminOnly>` and `<CanWrite>` components always pass through when user is signed in

## Critical: Gate on `!!user`, not `!!role`

`user` is set synchronously at the start of every auth event.
`role` requires a `fetchProfile` network round-trip that can fail or return null.
Using `!!role` causes edit/delete UI to disappear when profile fetch fails. Always use `!!user`.

---

## Auth Flows

### Login
- Accepts email **or** username
- `resolveEmail()` in `LoginPage.tsx` maps username → email via `profiles` table lookup before calling Supabase auth

### Invite (`/invite/:token`)
- `AcceptInvite.tsx` validates token against `invitations` table (checks `token` UUID + `expires_at`)
- On valid token: calls Supabase `signUp` with email/password, then sets `profiles` row (full_name, username)
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

- `src/store/authStore.ts` — Zustand: `user`, `profile`, `loading`, `setUser`, `setProfile`, `setLoading`
- `src/hooks/useAuth.ts` — manages Supabase auth event listeners + `fetchProfile` call
- Uses request ownership model (monotonic `requestIdRef` + `AbortController`) for background-tab resilience — see `miscellaneous.md`

---

## RLS Patterns

- All tables: `public` schema, RLS enabled
- Helper DB functions: `is_admin()`, `is_finance_user()`
- DELETE policies must check `auth.uid() IS NOT NULL`, not `is_admin()`
  - Legacy deployments may have admin-only DELETE policies that silently fail — migration SQL in `miscellaneous.md`
- **`profiles` policies must never call `is_admin()` or `is_finance_user()`** — both functions query `public.profiles`, causing infinite recursion
  - `profiles` policy set: all four operations use `auth.uid() IS NOT NULL` directly
  - Policies: `profiles_select`, `profiles_insert`, `profiles_update`, `profiles_delete`

---

## Invitations Table

| Column | Type | Notes |
|---|---|---|
| `token` | uuid | PK, single-use |
| `email` | text | Invited email address |
| `expires_at` | timestamptz | Token expiry |
| `role` | text | Role to assign on accept |
