# Miscellaneous — Archive & Reference

> **Do not load as active startup context.**
> Load only when explicitly needed for: debugging, historical reference, edge-case investigation, or "why did we do X" questions.
>
> Active domain rules live in: `ledger-rules.md`, `ui-rules.md`, `import-rules.md`, `auth-rules.md`, `db-rules.md`

---

## Auth — Background-Tab Resilience (Request Ownership Model)

`useAuth.ts` uses a monotonically increasing `requestIdRef` (useRef) and `AbortController` ref (`controllerRef`) to enforce strict request ownership.

- Every auth event (including synthetic `FOCUS_REVALIDATE` fired by a window focus listener) increments `requestId`, aborts the previous controller, creates a new one
- State updates (profile, `setLoading`) only run when `requestIdRef.current === requestId && mounted && !signal.aborted`
- `fetchProfile` uses raw `fetch` with `credentials: 'include'` and session Bearer token
- `setLoading(false)` is guarded by `requestId + signal` in a `finally` block
- All lifecycle transitions logged with `[auth:N]` prefixes for race tracing

---

## RLS DELETE Policy Migration

Supabase RLS DELETE policies previously enforced `is_admin()`. Must be updated via Setup → Database tab:

```sql
DROP POLICY IF EXISTS "inflow_delete" ON inflow_transactions;
CREATE POLICY "inflow_delete" ON inflow_transactions FOR DELETE USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "outflow_delete" ON outflow_transactions;
CREATE POLICY "outflow_delete" ON outflow_transactions FOR DELETE USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "intraflow_delete" ON intra_flows;
CREATE POLICY "intraflow_delete" ON intra_flows FOR DELETE USING (auth.uid() IS NOT NULL);
```

Without this migration, deletes silently succeed on the client but no rows are removed. `useDeleteTransaction` detects this via `count: 'exact'` and throws a descriptive error.

---

## Dynamic Currencies Fallback

`useCurrencies()` detects "relation does not exist" errors and silently falls back to 5 defaults: NGN, USD, GBP, EUR, CNY. This matches the pattern used by `useCategoryOpeningBalances` and other hooks that degrade gracefully.

---

## FX Conversion Non-Atomic Note

`useAddFXConversion()` creates 3 records sequentially — no DB transaction. If step 2 (NGN inflow insert) fails, step 1 (FX withdrawal) is already committed. This leaves the FX ledger debited without a corresponding NGN credit. Accepted trade-off.

---

## Category Opening Balances — Legacy Migration Path

`category_opening_balances` supersedes `categories.starting_balance`. Migration is lazy per-category:
- `CategoryModal` on edit: pre-populates from new table; if no new-table rows exist, reads legacy `starting_balance` and shows it as a single row for editing
- After user saves via `CategoryModal`, rows go into `category_opening_balances` and the legacy field is no longer the source of truth for that category

---

## Stage Code 1 Field

Stage Code 1 is kept in `AddInflowModal` for data entry but **removed from the Inflows list table UI**. Historical data requirement — preserved for import/entry, hidden from display.

---

## `useSpecialConfigOptions` Reload Behavior

`useSpecialConfigOptions()` exposes a `reload()` function. `AddIncomeTypeModal` calls it on open to force a fresh fetch, ensuring newly created special configs appear immediately without requiring a page reload.

---

## Import Entry Point Change (History)

Inflows and Outflows pages previously had Add buttons and import triggers. These were removed so that `Import.tsx` is the single entry point for all transaction creation. Edit and delete remain on both pages. Centralized to avoid duplication of import logic.

---

## `useRole` Gate on `!!user` vs `!!role` (History)

Using `!!role` (instead of `!!user`) in `canWrite`/`canDelete`/`isAdmin` caused edit/delete buttons to disappear for any user whose `fetchProfile` network call failed or returned null. Changing to `!!user` fixed this because `user` is set synchronously at the start of every auth event, regardless of profile fetch success.

---

## Known Propagation Gaps (Not Yet Fixed)

Full table lives in `ledger-rules.md`. Summary of what is NOT wired:
- FX conversion inflows have no `bank_name` → invisible to BankLedger
- `intrabank_transfers` and `bank_deposits` not queried by BankLedger
- Inflows with `fx_currency` don't auto-create `fx_transactions` rows
- `project_entries` are a parallel ledger; not included in Reports or CategoryLedger totals
- `useDashboard` uses INSERT-only Supabase subscription; deletes don't update KPI cards until page reload

---

## "AbortError: signal is aborted without reason"

`src/lib/supabase.ts` wraps every PostgREST request in an `AbortController`. When
its timer fired it called `controller.abort()` with no reason, and postgrest-js
reports fetch failures as `` `${err.name}: ${err.message}` `` — producing that
exact opaque string for *any* slow request, with no indication of which one.

Now: reads time out at 20s, writes at 60s (aborting a write does not roll it
back server-side — the user retries and hits duplicate-key or lock errors), the
abort carries a reason naming the table, a caller-supplied `signal` is composed
rather than discarded, and `friendlyError()` translates it.

The server side matters too: `create_special_config_version` waited indefinitely
on `SELECT ... FOR UPDATE`, so one abandoned request kept every retry blocked
until the browser cancelled it as well. Both distribution-rule RPCs now set
`lock_timeout = 5s` and `statement_timeout = 30s`.
