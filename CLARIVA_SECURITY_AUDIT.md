# Clariva — Production-Readiness Security & Architecture Audit

**Scope:** Public multi-tenant SaaS launch (non-technical church / NGO users)
**Codebase:** `stillsmallvoice2024-tech/church-finance-app` — ~79k LOC TypeScript, ~13.8k LOC SQL, 245 RLS policies, 6 Edge Functions, 74 migrations
**Method:** Static trace of data flow from frontend forms → hooks → service layer → Edge Functions → Postgres RLS → schema. No live database was available; all findings are code-verified against the repository.
**Excluded:** `node_modules`, `dist`, `.next`, `build`, lock files.

---

## RELEASE VERDICT: **NOT READY**

| | |
|---|---|
| **CRITICAL** | 9 |
| **HIGH** | 12 |
| **MEDIUM** | 14 |
| **LOW** | 7 |

Two findings cause **irreversible customer data loss** (CRITICAL-FIN-01, CRITICAL-FIN-02). Two allow **any paying customer to take the product for free** (CRITICAL-SEC-01, CRITICAL-SEC-02). One **blocks the second tenant from onboarding at all** (CRITICAL-TEN-01).

The engineering quality here is genuinely above average — the RLS coverage is systematic, the audit trail is server-side and forgery-resistant, the FX conversion RPC is properly locked and server-computed, and the accessibility work in the UI primitives is better than most commercial products. The failures are concentrated in a specific and recognisable place: **operations that cross the client/server trust boundary, and error paths that fail silently instead of loudly.** That is a fixable class of problem, but it is not fixable after launch, because the affected data is other people's money.

---

## TABLE OF CONTENTS

1. [Critical Findings](#1-critical-findings)
2. [High Findings](#2-high-findings)
3. [Medium Findings](#3-medium-findings)
4. [Low Findings](#4-low-findings)
5. [Trust Boundary Audit](#5-trust-boundary-audit)
6. [Pillar Scores](#6-pillar-scores)
7. [Independent Dimension Scores](#7-independent-dimension-scores)
8. [Launch Risk Ranking](#8-launch-risk-ranking)
9. [Remediation Roadmap](#9-remediation-roadmap)
10. [Coverage Report](#10-coverage-report)
11. [What Is Already Good](#11-what-is-already-good)

---

# 1. CRITICAL FINDINGS

## 1.1 Financial Integrity

### [CRITICAL-FIN-01] Backup silently truncates at 1,000 rows; restore then deletes everything else

**Location:** `src/utils/backupRestore.ts:409-414`, `supabase/config.toml:18`

```ts
// backupRestore.ts:410
let q = supabase.from(tableKey).select('*').limit(100_000)
if (orgId) q = q.eq('org_id', orgId)
const { data, error } = await q
```

```toml
# config.toml:18
max_rows = 1000
```

PostgREST's `max_rows` overrides any client `.limit()`. The repository *documents this exact behaviour* in `src/utils/fetchAllRows.ts:1-3`:

> "Supabase PostgREST enforces a server-side db-max-rows cap (default 1000) that overrides any client `.limit()` call. This helper paginates transparently so callers always receive the full result set."

`fetchTableData` does not use that helper. Every backup of an org with more than 1,000 rows in a table silently captures the first 1,000 — and reports success, with an accurate-looking row count, through the `onProgress('done', rows.length)` callback.

Restore in `replace` mode then deletes the org's entire dataset before inserting the truncated set (`backupRestore.ts:694-703`):

```ts
if (options.mode === 'replace') {
  for (const tableKey of DELETE_TABLES) {
    try { await deleteFull(tableKey, orgId) } catch { /* non-fatal — table may be empty */ }
  }
  for (const extra of ['receipts', 'audit_log', 'field_changes']) {
    try { await supabase.from(extra).delete().eq('org_id', orgId).not('id','is',null) } catch { }
  }
}
```

**Risk (financial loss / total data loss):** A 40,000-transaction church that backs up and restores keeps 1,000 rows and loses 39,000 — including the `audit_log` and `field_changes` records that would have proven what was there. There is no second copy. This is precisely the failure the backup feature exists to prevent, and the user has no way to detect it before it is irreversible.

**Fix:** Route `fetchTableData` through `fetchAllRows`. Add a post-backup assertion comparing captured counts against `select('*', { count: 'exact', head: true })` per table, and hard-fail the backup on any mismatch. Gate `replace` mode behind a server-side snapshot.
**Effort: Low** — the pagination helper already exists and is already tested.

---

### [CRITICAL-FIN-02] Non-atomic destructive restore with swallowed errors and no rollback path

**Location:** `src/utils/backupRestore.ts:694-728`

Delete and insert are separate, un-transacted PostgREST round-trips. Deletion errors are swallowed completely (`catch { }`, line 696). Insert errors are caught per-table and execution deliberately continues:

```ts
} catch (e) {
  const msg = e instanceof Error ? e.message : 'Unknown error'
  errors.push({ table: def.key, section: 'managed', message: msg })
  onProgress?.('managed', def.key, 'error')
  // Continue — partial restore is better than full abort
}
```

**Risk (financial loss):** A network drop, a closed tab, or a single FK violation between the delete loop and the insert loop leaves the organisation permanently empty or half-populated, with no rollback and with the audit trail already deleted by the `extra` loop. The stated principle — "partial restore is better than full abort" — is inverted for a ledger: a half-restored ledger is strictly worse than an un-restored one, because it looks valid and will be reported from.

**Fix:** Move the entire restore into one `SECURITY DEFINER` RPC executing delete + insert in a single transaction, with a membership check on `p_org_id`. Until that exists, disable `replace` mode in the UI.
**Effort: Med**

---

### [CRITICAL-FIN-03] No uniqueness constraint on transaction references — duplicates are one race away

**Location:** `supabase/schema.sql:541-576` (inflows), `577-615` (outflows); `src/utils/dedupQuery.ts:26-52`

`inflow_transactions.transaction_ref` and `outflow_transactions.transaction_id` are plain nullable `text`. The only unique constraints on these tables are the primary keys. Deduplication is entirely a client-side read-before-write:

```ts
// dedupQuery.ts:37 — pre-check only, no corresponding write-side guard
const base = supabase.from(table).select(column).eq('org_id', orgId).in(column, chunk)
return bankName ? base.eq('bank_name', bankName) : base
```

The insert path (`ImportModal.tsx:1546`) writes directly with no conflict handling. `src/lib/supabase.ts:14-16` documents the exact trigger condition:

> "aborting an in-flight INSERT/UPDATE does NOT roll it back server-side, it only hides the outcome from the user, who then retries and hits duplicate-key or lock-contention errors."

Except there is no duplicate key to hit.

**Risk (financial loss):** Textbook TOCTOU. Two treasurers importing the same bank statement, one user re-importing after the 60-second write timeout, or any retry over a flaky mobile connection produces a fully duplicated month of income. Balances inflate silently. Nothing flags it — not reconciliation, not the audit log, not the dashboard. This needs no attacker: two volunteers and one bad connection are sufficient, which makes it the **highest-probability corruption path in the product**.

**Fix:**
```sql
CREATE UNIQUE INDEX CONCURRENTLY inflow_txn_ref_unique
  ON public.inflow_transactions (org_id, bank_id, transaction_ref)
  WHERE transaction_ref IS NOT NULL;
-- mirror for outflow_transactions (org_id, bank_id, transaction_id)
```
Then let the insert's conflict error drive skip-reporting, keeping `dedupQuery` only as a UX preview.
**Effort: Low** (requires a duplicate-cleanup pass on existing production data first).

---

### [CRITICAL-FIN-04] Fund/category linkage is unconstrained free text — rename or delete orphans the money

**Location:** `supabase/schema.sql:546-547`, `src/utils/fundBuckets.ts:88-110`, `src/hooks/useMutations.ts:683`

Every fund balance in the product is grouped by `stage_code_1`, a bare `text` column with no foreign key to `categories`:

```sql
-- inflow_transactions:546
stage_code_1              text,
stage_code_2              text,
```

```ts
// fundBuckets.ts:88 — the balance engine keys off the raw string
const cat = r.stage_code_1 || '(Uncategorised)'
ensure(cat).seedIn += amt
```

`useDeleteCategory` deletes with no referential check whatsoever:

```ts
// useMutations.ts:683
const { error: err } = await supabase.from('categories').delete().eq('id', id)
```

The same name-as-key pattern extends to `intra_flows.account_from` / `account_to` (text), and to `allocation_configs.rows[].category_name` (a string inside jsonb).

**Risk (financial loss / silent inconsistency):** Renaming "Building Fund" to "Building Project" detaches every historical transaction from it — the renamed fund reads ₦0 and the entire prior balance becomes an invisible orphan bucket that no page lists. Deleting a category leaves its money summed under a name absent from every dropdown, still counted in some aggregates and not others. CLAUDE.md explicitly warns about this hazard for `bank_name`, but the same defect sits undocumented on the key that drives **all** fund accounting.

**Fix:** Add `category_id uuid REFERENCES categories(id)`, backfill by name match, and demote `stage_code_1` to a display snapshot (the pattern already used correctly for `intra_flows.from_category_id`). Block category deletion when transactions reference it; make rename a pure metadata change.
**Effort: High** — but this is the structural root cause of the reconciliation drift the product exists to eliminate.

---

## 1.2 Multi-Tenant Isolation

### [CRITICAL-TEN-01] Cross-tenant unique index on `bank_name` blocks onboarding and leaks tenant existence

**Location:** `supabase/schema.sql:1737-1740`

```sql
create unique index if not exists idx_inflow_bf_unique_bank
  on public.inflow_transactions (bank_name)
  where transaction_type = 'balance_brought_forward';
```

No `org_id` in the index key. Confirmed present nowhere else:
```
grep -rn "idx_inflow_bf_unique_bank" supabase/   →   schema.sql:1738 only
```

**Risk (tenant safety / hard functional blocker):** Once *any* tenant creates a bank named "GTBank" with an opening balance, **no other tenant on the platform can ever do so.** `propagateBankOpeningBalance` (`src/utils/bankOpeningBalance.ts:88-99`) throws a raw Postgres unique violation. Nigerian churches use the same handful of banks — GTBank, Zenith, First Bank, Access, UBA. Tenant #2 onward hits a hard onboarding failure with an incomprehensible database error, on the very first setup step, in a product built for non-technical users.

It is simultaneously a cross-tenant existence oracle: a failed insert tells you another organisation banks there.

**Fix:**
```sql
DROP INDEX IF EXISTS idx_inflow_bf_unique_bank;
CREATE UNIQUE INDEX idx_inflow_bf_unique_bank
  ON public.inflow_transactions (org_id, bank_name)
  WHERE transaction_type = 'balance_brought_forward';
```
**Effort: Low** — but must ship *before* the second tenant, not after.

---

## 1.3 Security & Billing

### [CRITICAL-SEC-01] Any org admin can grant themselves the paid plan

**Location:** `supabase/migrations/20260529000000_phase3_rls_tenant_isolation.sql:189`; columns from `20260805000000_subscription_tiers.sql:11-15` and `20260806000000_stripe_billing.sql:10-14`

```sql
CREATE POLICY "orgs_update" ON public.organizations
  FOR UPDATE USING (public.is_org_admin(id));
```

Row-level only. No column-level `GRANT`/`REVOKE`, and no guard trigger exists (`grep` for any trigger touching `plan_tier` returns nothing). `plan_tier`, `plan_expires_at`, `plan_status`, `stripe_customer_id`, `stripe_subscription_id`, `imported_rows_count` and `imported_rows_period_start` all live on that table.

```js
// Runs successfully from the browser console as any org admin
await supabase.from('organizations')
  .update({ plan_tier: 'full', plan_expires_at: null, imported_rows_count: 0 })
  .eq('id', myOrgId)
```

**Risk (revenue / trust boundary):** Every paid feature becomes free to anyone who opens DevTools. The free-tier import cap resets the same way. The `increment_import_count` RPC is carefully written to be race-safe and atomic — and is completely bypassed by a direct `UPDATE` on the column it protects. A self-granted tier persists until the next Stripe subscription event; for an org that never subscribes, forever.

**Fix:**
```sql
REVOKE UPDATE (plan_tier, plan_status, plan_started_at, plan_expires_at, trial_ends_at,
               stripe_customer_id, stripe_subscription_id,
               imported_rows_count, imported_rows_period_start)
  ON public.organizations FROM authenticated;
```
Plus a `BEFORE UPDATE` trigger raising unless the caller is `service_role`, so the webhook path still works.
**Effort: Low**

---

### [CRITICAL-SEC-02] Plan enforcement is 100% client-side and fails open to the top tier

**Location:** `src/hooks/usePlan.ts:98-107, 141-147`; `src/components/auth/PlanGates.tsx`

`org_plan_at_least()` is defined, granted to `authenticated`, and **never called by anything**:

```
grep -rn "org_plan_at_least" supabase/ src/
  → definition (schema.sql:209, subscription_tiers.sql:48) + one comment. Zero call sites.
```

No RLS policy on any table references plan tier. The code states the situation plainly (`usePlan.ts:44-51`):

> "the underlying data model has no plan check of its own (RLS allows any authenticated org member to write any transaction_type), so every UI surface that lets a user pick one … must filter its options through this"

And the tier resolver fails **open**, to the most expensive tier:

```ts
// usePlan.ts:104 — "not loaded yet" and "DB not migrated" both resolve to full access
if (storedTier === null) return 'full'

// usePlan.ts:143 — every feature unlocked during hydration
if (!resolved) return true // avoid flashing a locked state during hydration
```

**Risk (revenue):** Every gate is a `<div>`. Removing a DOM node, calling the underlying Supabase query directly, or merely loading the app while the `organizations` row fails to load yields full Impact-tier access. Combined with CRITICAL-SEC-01, the entire monetisation model is unenforced end to end. **Do not accept payment cards against this.**

**Fix:** Enforce server-side in RLS (`WITH CHECK (public.org_plan_at_least(org_id, 'level1'))`) on the gated tables and transaction types, and in the Edge Functions for gated compute. Change `resolveEffectiveTier(null, …)` to return `'free'` and render a loading state rather than an unlocked one.
**Effort: Med**

---

### [CRITICAL-SEC-03] `schema.sql` — the documented fresh-install path — ships the pre-multi-tenant `org_id` default

**Location:** `supabase/schema.sql:144-147` and 31 column defaults, versus `supabase/migrations/20260605000001_fix_null_org_id.sql:100-112`

Migrations replaced the function with a deliberate hard failure:

```sql
-- fix_null_org_id.sql:106
CREATE OR REPLACE FUNCTION public.get_current_org_id()
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RAISE EXCEPTION 'get_current_org_id() invoked — all INSERT statements must supply org_id explicitly. …';
END; $$;
```

`schema.sql` still contains the original single-tenant version:

```sql
-- schema.sql:144
create or replace function public.get_current_org_id()
returns uuid language sql security definer stable as $$
  select id from public.organizations where slug = 'primary' limit 1;
$$;
```

Used by **31** column defaults (`grep -c "default public.get_current_org_id()" supabase/schema.sql` → 31), alongside a seeded bootstrap tenant (`schema.sql:932`):

```sql
insert into public.organizations (name, slug, metadata, onboarding_complete)
values ('My Church', 'primary', '{"bootstrap": true}'::jsonb, true)
```

`migrate-check.yml:98` loads this file as the CI validation baseline, and CLAUDE.md designates it the fresh-install reference.

**Risk (tenant safety):** Any environment provisioned from `schema.sql` — disaster recovery, a staging clone, a second region — silently funnels every `org_id`-omitting insert into one shared tenant, reintroducing a bug that was already found and fixed. Separately, CI validates every new migration against a schema that provably differs from production, so migration checks are testing the wrong database.

**Fix:** Regenerate `schema.sql` from a fully migrated database (`supabase db dump --schema public`). Add a CI job asserting the migrated baseline and `schema.sql` converge. Remove the bootstrap org seed.
**Effort: Med**

---

## 1.4 Operations

### [CRITICAL-OPS-01] The 400+ "security" tests cannot detect a security failure

**Location:** `src/utils/__tests__/tenantIsolation.test.ts` (138 cases), `orgScoping.test.ts` (39 cases), `securityFixes.test.ts` (45 cases)

```ts
const src = (rel: string) => readFileSync(resolve(ROOT, 'src', rel), 'utf-8')

it('filters audit_log query by org_id', () => {
  expect(code).toContain(".eq('org_id', orgId)")
})
```

These are `grep` assertions over source text. No database connection, no session, no policy evaluation. The file header is candid about it — "pure-logic / structural tests — no DB connection required" — but the suite is named and organised as tenant-isolation verification.

There is **no RLS integration test anywhere in the repository**. Nothing creates two organisations, authenticates as each, and asserts that one cannot read or write the other's rows.

**Risk (tenant safety / false assurance):** CRITICAL-TEN-01 and CRITICAL-SEC-01 both pass all 222 "isolation" test cases today. The suite would remain green after `ALTER TABLE inflow_transactions DISABLE ROW LEVEL SECURITY`. This is worse than having no tests: it manufactures confidence in a property that has never once been empirically verified, which is very likely why these defects survived to this point.

**Fix:** Add a CI job that runs `supabase start`, seeds two orgs with two users, and asserts for every business table that cross-org `SELECT` returns zero rows and cross-org `INSERT`/`UPDATE`/`DELETE` is rejected. Keep the grep tests as lint, but stop calling them isolation tests.
**Effort: Med** — the single highest-leverage investment identified in this audit.

---

# 2. HIGH FINDINGS

## 2.1 Security

### [HIGH-SEC-01] `resolve_username` hands any anonymous caller a user's email address

**Location:** `supabase/migrations/20260530000002_resolve_username_rpc.sql:15-28`

```sql
CREATE OR REPLACE FUNCTION public.resolve_username(p_username text)
RETURNS text LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT email FROM public.profiles WHERE username = lower(trim(p_username)) LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.resolve_username(text) TO anon;
```

Called pre-auth from `src/components/auth/LoginPage.tsx:60-61`.

**Risk (tenant safety / PII):** An unauthenticated, unmetered username → email oracle reachable with the public anon key. An attacker scripts a wordlist (`pastor`, `admin`, `finance`, `treasurer`, common first names) and harvests verified email addresses of church finance administrators — exactly the population targeted by payment-redirection and invoice fraud. It doubles as a membership oracle: a hit confirms the account exists.

**Fix:** Do not return the email. Either move username login entirely server-side behind an Edge Function that performs the sign-in itself, or return an opaque short-lived login handle. Add per-IP rate limiting and a constant-time miss path.
**Effort: Med**

---

### [HIGH-SEC-02] HTML injection into outbound invitation emails from your sending domain

**Location:** `supabase/functions/send-invite-email/index.ts:26-115` (template), `264-271` (send)

```ts
<strong>${inviter_name}</strong> has invited you to join
<strong>${org_name}</strong> as a <strong>${roleLabel}</strong>.
...
body: JSON.stringify({
  from:    FROM_ADDRESS,          // Clariva <noreply@clariva.app>
  to:      [row.email],
  subject: `You're invited to join ${org_name}`,
  html:    emailHtml,
}),
```

No escaping on any of the four interpolated values. `org_name` is attacker-controlled at self-signup — `create_organization(p_name)` (`schema.sql:2091`) only trims and collapses whitespace. `inviter_name` comes from `profiles.full_name`, freely editable by the user.

**Risk (brand / phishing):** Self-signup, name the org `<a href="https://evil.example">Click to verify your bank details</a>`, then invite arbitrary addresses. Recipients receive a well-formed phishing email delivered from your SPF/DKIM-signed domain with your branding. The subject line is injectable too. Cost: your Resend sender reputation, your domain, and your users' money.

**Fix:** HTML-escape `org_name`, `inviter_name`, `roleLabel` and the subject. Rate-limit invitations per org per hour.
**Effort: Low**

---

### [HIGH-SEC-03] Backups export cross-org rows and can be weaponised on restore

**Location:** `src/utils/backupRestore.ts:36-49` (registry), `468-474` (unmanaged export), `706-728` (restore)

```ts
{ key: 'organizations', label: 'Organisations', ... restoreMode: 'merge',   orgScoped: false },
{ key: 'currencies',    label: 'Currencies',    ... restoreMode: 'replace', orgScoped: false },
```
```ts
// 3. Export unmanaged tables (raw, unverified — no org filter, rely on RLS)
const rows = await fetchTableData(tableKey, ...)
```

**Risk (tenant safety / revenue):**
1. A user belonging to two organisations exports **both orgs' rows** in one file — `organizations` is unscoped and RLS returns every membership — then shares that file with a colleague who belongs to only one.
2. Restore upserts `organizations` from a **user-supplied JSON file**. A hand-edited backup setting `plan_tier: 'full'` is accepted, because `orgs_update` permits it (CRITICAL-SEC-01). Restore becomes a second, fully-supported billing bypass.
3. Unmanaged-table export sweeps in any future table before anyone has classified its sensitivity.

**Fix:** Never back up `organizations` or `currencies`; capture org settings as scalar metadata in `_meta`. Reject any restore row whose `org_id` differs from the active org. Strip plan/Stripe columns on import. Default `restoreUnmanaged` to off.
**Effort: Med**

---

## 2.2 Multi-Tenant Isolation

### [HIGH-TEN-01] `currencies` is a shared global table any org admin can rewrite or delete

**Location:** `supabase/migrations/20260609000001_fix_currencies_and_user_preferences.sql:10-37`

```sql
CREATE TABLE IF NOT EXISTS public.currencies (
  code text PRIMARY KEY, name text NOT NULL, symbol text NOT NULL DEFAULT '',
  flag text, is_active boolean NOT NULL DEFAULT true, sort_order integer NOT NULL DEFAULT 99
);   -- no org_id

CREATE POLICY "currencies_select" ON public.currencies FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "currencies_update" ON public.currencies FOR UPDATE USING (public.is_admin());
CREATE POLICY "currencies_delete" ON public.currencies FOR DELETE USING (public.is_admin());
```

`is_admin()` is deliberately org-agnostic — "owner or admin in **ANY** active org" (`schema.sql:252-262`).

**Risk (tenant safety):** Any admin of any tenant can rename USD, deactivate NGN, or `DELETE` currency rows **for every tenant on the platform**. Compounded by backup/restore: `currencies` is registered `orgScoped: false, restoreMode: 'replace'`, and `deleteFull` (`backupRestore.ts:449-451`) skips the org filter for exactly that reason — so one tenant performing a replace-restore **wipes the global currency table for all tenants**, degrading every org to the five hardcoded fallbacks.

**Fix:** Either add `org_id` and org-scope the write policies, or make it read-only reference data managed exclusively by `service_role`. Set `backupEnabled: false` in the registry either way.
**Effort: Low**

---

## 2.3 Financial Integrity

### [HIGH-FIN-01] Fund balances silently drop opening balances and internal transfers on query error

**Location:** `src/utils/fundBuckets.ts:203-217`

```ts
const fatal = seedRes.error || seedOutRes.error || savInRes.error || savOutRes.error
            || allInflowRes.error || pctOutRes.error
if (fatal) return { byCategory: new Map(), seedTargets: new Map(), error: fatal.message }

const openingBalances = (cobRes.error ? [] : (cobRes.data ?? [])).map(...)          // ← swallowed
...
intraFlows: (intraFlowRes.error ? [] : (intraFlowRes.data ?? [])) as ...,           // ← swallowed
```

Two of the nine parallel queries are excluded from the fatal check and degrade to empty arrays.

**Risk (financial loss / UX failure):** A transient timeout, an RLS denial, or a missing `category_opening_balances` table produces a **fully rendered, confidently wrong balance sheet** — every fund short by its opening balance and every internal transfer missing — with no error, no warning, and no visual difference from a correct one. A treasurer files a board report from it and cannot tell.

**Fix:** Add `cobRes.error` and `intraFlowRes.error` to `fatal`. Governing rule for a ledger: **a failed read is an error, never an empty set.**
**Effort: Low**

---

### [HIGH-FIN-02] Reconciliation reports "Healthy" when its own checks crash

**Location:** `src/utils/reconciliationEngine.ts:33-47`

```ts
const settled = await Promise.allSettled(rules.map(r => r.run(orgId)))
const issues: ReconciliationIssue[] = []
for (const r of settled) {
  if (r.status === 'fulfilled') issues.push(...r.value)
  // rejected rules are silently skipped — engine must not crash
}
```

**Risk (financial loss):** If every rule rejects — expired JWT, dropped connection, one missing column after a partial migration — `issues` is `[]`, `aggregateDiagnostics` returns a healthy status, the badge goes green, and `useReconciliation` persists that result to the store and the database. The feature whose entire purpose is telling users their books are wrong emits the strongest possible "all clear" precisely when it has verified nothing. Not crashing is correct; reporting success is not.

**Fix:** Count rejections. Return `{ partial: true, failedRules: [...] }` and refuse to emit any health status when a rule failed. Surface "N checks could not run" in the UI.
**Effort: Low**

---

### [HIGH-FIN-03] Import is non-atomic and silently drops columns the database lacks

**Location:** `src/components/modals/ImportModal.tsx:1546-1560` (inflows), `1577-1591` (outflows)

```ts
const missingInflow = err?.message.match(/Could not find (?:the ')?(\w+)'? column/)?.[1]
if (missingInflow) {
  rowsToRetry = batch.map(row => { const r = { ...row }; delete r[missingInflow]; return r })
  const { error: retryErr } = await supabase.from('inflow_transactions').insert(rowsToRetry)
  err = retryErr ?? null
  ...
}
```

Additionally: inflows and outflows commit in separate un-transacted 250-row batches, and `insertBatchResilient` bisects around failures so a run can partially succeed by design.

**Risk (financial loss):** Two distinct failure modes.
1. **Silent field loss.** If a schema column is absent, rows import **with that field stripped** — `income_type_id`, `allocation_config_id`, `bank_id` — so the money lands unclassified and unallocated while the UI reports success with a warning buried in an errors array.
2. **Partial ledgers.** A closed tab mid-import leaves half a bank statement in the ledger with no import-batch identifier and no undo. Reconciliation against the statement balance will then fail with no explanation of why.

**Fix:** Treat a missing column as fatal and actionable — never strip and continue; the DB and app must agree before any financial write. Stamp every imported row with an `import_batch_id` and expose one-click rollback of a batch.
**Effort: Med**

---

### [HIGH-FIN-04] No optimistic locking — concurrent edits silently overwrite each other

**Location:** `src/hooks/useMutations.ts:355-370`

```ts
const { data: updatedRows, error: err } = await supabase
  .from(table)
  .update(withTimestamp)
  .eq('id', id)
  .select('id')
```

No `updated_at` precondition, no version column, no `If-Match`. `updates` is typed `Record<string, unknown>` and passed through verbatim, so the caller also controls *which* columns are written.

**Risk (financial loss):** Two accountants open the same outflow record. The second save silently discards the first's edits with no conflict indication to either. `field_changes` faithfully records both writes, so the audit trail shows a change nobody intended and nobody will notice until an auditor asks. This is the standard multi-user failure mode and the product is explicitly multi-user.

**Fix:** Add `.eq('updated_at', originalUpdatedAt)` — a zero-row result means "changed by someone else, reload". Whitelist updatable columns per table rather than accepting an open record.
**Effort: Low**

---

## 2.4 Operations & Scalability

### [HIGH-OPS-01] `pdf-ocr` is an unmetered spend endpoint for any authenticated user

**Location:** `supabase/functions/pdf-ocr/index.ts:155-217`

The authorisation check is presence-of-a-valid-JWT only:

```ts
const { data: { user }, error: authErr } = await service.auth.getUser(authHeader.slice(7))
if (authErr || !user) { /* 401 */ }
```

There is no rate limit, no per-org quota, no plan check — despite `ocrImport: 'full'` in `FEATURE_TIERS` — and no size cap on the base64 `image` field. Each call is a Claude Sonnet request at up to 8,000 output tokens.

**Risk (financial loss — yours):** A free-tier viewer, or anyone with the public anon key plus one throwaway signup, can loop this endpoint and bill your Anthropic account without limit. There is no circuit breaker, no budget alert, and no per-tenant attribution. The cost lands on you, not the tenant.

**Fix:** Enforce `org_plan_at_least(org_id, 'full')` server-side inside the function. Add a per-org daily page quota persisted in Postgres and checked before the upstream call. Cap `image` byte length. Configure an Anthropic spend alert.
**Effort: Med**

---

### [HIGH-PERF-01] Every balance view downloads the org's entire transaction history to the browser

**Location:** `src/utils/fundBuckets.ts:191-201`, `src/hooks/useBankBalances.ts:41-52`, `src/hooks/useDashboard.ts`

```ts
const [seedRes, seedOutRes, savInRes, savOutRes, allInflowRes, cobRes,
       intraFlowRes, pctOutRes, incomeTypeRes] = await Promise.all([
  fetchAllRows(() => supabase.from('inflow_transactions').select('...').eq('org_id', orgId).eq('stage_code_2','Specific Seed')),
  ...
  fetchAllRows(() => supabase.from('inflow_transactions')
    .select('date, amount, stage_code_2, allocation_config_id, income_type_id, transaction_type, offset_role, description')
    .eq('org_id', orgId)),        // ← no filter at all: every inflow ever
  ...
])
```

`fetchAllRows` pages at 1,000 rows until exhausted, then all aggregation happens in JavaScript.

**Risk (UX failure / scalability wall):** At 50,000 transactions that is roughly 50 sequential round-trips for one of nine parallel queries, tens of megabytes into a phone's memory, on **every** Dashboard, Categories and Funds mount. The target user is on a mid-range Android device on Nigerian mobile data. The failure is not clean — the app gets progressively slower until it out-of-memories — and it hits your largest, most established, most likely-to-be-paying customers first.

**Fix:** Move aggregation into Postgres: a materialised `category_balances` view refreshed on write, or a `SECURITY INVOKER` RPC returning per-category sums so RLS still applies. The client should fetch tens of rows, not tens of thousands.
**Effort: High**

---

### [HIGH-PERF-02] Ledger balance recalculation is O(N²) on bulk writes

**Location:** `supabase/migrations/20260609000002_ledger_balance_trigger.sql:47-70`

```sql
CREATE TRIGGER trg_ledger_balance
  AFTER INSERT OR UPDATE OR DELETE ON public.ledger_entries
  FOR EACH ROW EXECUTE FUNCTION public.trg_ledger_balance_fn();
```

Each row fires `recalculate_ledger_balances`, which runs a full window-function recompute across **every** entry in that account.

**Risk (reliability):** Inserting N entries performs N full recomputes. A 5,000-row account import is on the order of 12.5 million row updates — it will exceed statement timeouts and take the import down with it. The trigger also holds row locks across the whole account for the duration, so concurrent entry from a second user blocks.

**Fix:** Convert to a `FOR EACH STATEMENT` trigger using `REFERENCING NEW TABLE AS nt` and recompute once per affected `account_id`.
**Effort: Med**

---

### [HIGH-OPS-02] Migrations auto-deploy to production with no staging, no backup, and no enforced gate

**Location:** `.github/workflows/migrate.yml:1-40`, `.github/workflows/migrate-check.yml:5-18`

```yaml
on:
  push:
    branches: [main]
    paths: ['supabase/migrations/**']
...
- name: Push migrations
  run: supabase db push
```

`migrate-check.yml` triggers on `pull_request` only, so a direct push to `main` — or a merge with a stale check — reaches production entirely unvalidated. The workflow's own header documents the underlying divergence:

> "supabase/migrations/ has no migration that creates the base schema (public.profiles, etc.) — that schema predates the migrations folder and was applied to production by hand."

**Risk (reliability):** Unreviewed DDL applied directly to the production database holding every customer's financial records. No pre-migration snapshot step, no rollback-migration convention, no post-apply smoke test. When (not if) a migration fails halfway, there is no defined recovery path.

**Fix:** Require `migrate-check` via branch protection on `main`. Add a `pg_dump` snapshot step immediately before `db push`, uploaded as a retained artifact. Deploy to a staging Supabase project first. Require a paired `_rollback.sql` for every migration touching data.
**Effort: Med**

---

# 3. MEDIUM FINDINGS

### [MEDIUM-FIN-01] Transaction dates default to UTC, not the organisation's timezone

**Location:** 56 call sites; e.g. `src/components/modals/AddIntraFlowModal.tsx:76`, `AddFXModal.tsx:73`, `ImportModal.tsx:556`

```ts
resetForm({ date: new Date().toISOString().slice(0, 10), ... })
```

`organizations.timezone` is stored, configurable, and used for *display* (`src/utils/formatters.ts:122-131`) but never for date defaulting. The codebase already contains the correct pattern — `FormField.tsx:19-22` in `DateQuickChips` adjusts for `getTimezoneOffset()` before slicing — which makes the divergence internally inconsistent: the "Today" chip and the default date can disagree.

**Risk (financial accuracy):** Systematic off-by-one-day errors. A Lagos church (UTC+1) entering a transaction before 01:00 local files it to the previous day; an Auckland org (UTC+12) misfiles most of its afternoon. Transactions land in the wrong month, and at year end, in the wrong fiscal year.

**Fix:** Add `todayInOrgTz(timezone)` using `Intl.DateTimeFormat(…, { timeZone })` and use it at all 56 sites.
**Effort: Low**

---

### [MEDIUM-FIN-02] FX running balance chain breaks on backdated entries

**Location:** `supabase/migrations/20260605000004_fix_perform_fx_conversion.sql:45-52`

```sql
SELECT COALESCE(running_balance, 0) INTO v_prev_balance
FROM   public.fx_transactions
WHERE  org_id = p_org_id AND currency = p_fx_currency
ORDER  BY date DESC, created_at DESC
LIMIT  1;
```

`running_balance` is a stored denormalised value derived from whichever row currently sorts last by `date`.

**Risk (financial accuracy):** Entering a *backdated* FX deposit does not re-derive the chain. The new row computes its balance from a later row's total, and every subsequent conversion reads a `running_balance` that no longer reflects actual holdings — while the insufficient-balance guard on line 57 silently validates against the wrong number.

**Fix:** Recompute the whole currency's chain within the existing advisory lock whenever a row is inserted at a non-terminal date, or drop the stored column and derive balances with a window function on read.
**Effort: Med**

---

### [MEDIUM-FIN-03] Float accumulation across thousands of rows drifts from the ledger

**Location:** `src/utils/fundBuckets.ts:70-160`

`allocatePercent` (`src/utils/financeMath.ts:23-28`) is correct — it does the multiplication entirely in integer minor units. But every accumulation afterwards is IEEE-754 float:

```ts
ensure(catRow.category_name).seedIn += allocated
ensure(cat).pctOut += r.offset_role === 'offset' ? -amt : amt
b.savIn += Number(ob.amount)
```

**Risk (financial accuracy):** The careful per-operation rounding is undone by summing thousands of two-decimal floats. Balances drift by cents, then by nairas, and the reconciliation engine reports a discrepancy no one can explain because both sides are "right".

**Fix:** Accumulate in integer minor units throughout (`Math.round(x * 100)`), divide by 100 once at the presentation boundary.
**Effort: Med**

---

### [MEDIUM-FIN-04] Bank name fallback can double-count or orphan balances after a rename

**Location:** `src/hooks/useBankBalances.ts:60-84`

```ts
if (r.bank_id) inflowById.set(r.bank_id, ...)
else if (r.bank_name) inflowByName.set(r.bank_name, ...)
...
balance: (b.starting_balance ?? 0)
  + (inflowById.get(b.id) ?? 0) + (inflowByName.get(b.name) ?? 0)
  - (outflowById.get(b.id) ?? 0) - (outflowByName.get(b.name) ?? 0),
```

**Risk (financial accuracy):** Legacy rows carrying only `bank_name` are matched by string. Rename a bank and those rows silently detach — their money vanishes from the balance. Later create a *new* bank reusing the old name and it inherits them — double-counting the same money against a different account. Neither event produces a warning.

**Fix:** Complete the `bank_id` backfill (`20260804000002_bank_id_fk_and_repair.sql` started it), then make `bank_id` `NOT NULL` and delete the name-matching path entirely.
**Effort: Med**

---

### [MEDIUM-FIN-05] Deleting an outflow does not invalidate outflow-dependent views

**Location:** `src/hooks/useMutations.ts:449-450`

```ts
if (table === 'inflow_transactions')  useTransactionSyncStore.getState().bumpInflow()
if (table === 'intra_flows')          useTransactionSyncStore.getState().bumpIntraflow()
// outflow_transactions — missing
```

The insert and update paths both bump all three correctly; only the delete path omits outflows.

**Risk (UX failure):** After deleting an outflow, dashboards, bank balances and reports continue displaying it until a manual refresh. A user who deletes a duplicate expense sees it still there and deletes "it" again — hitting a real record the second time.

**Fix:** Add `if (table === 'outflow_transactions') useTransactionSyncStore.getState().bumpOutflow()`.
**Effort: Low**

---

### [MEDIUM-SEC-01] `recalculate_ledger_balances` is `SECURITY DEFINER`, granted to `authenticated`, with no membership check

**Location:** `supabase/migrations/20260609000002_ledger_balance_trigger.sql:5-44`

```sql
CREATE OR REPLACE FUNCTION public.recalculate_ledger_balances(p_account_id uuid, p_org_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $func$
BEGIN
  ...   -- no is_org_member(p_org_id) guard anywhere
END; $func$;

GRANT EXECUTE ON FUNCTION public.recalculate_ledger_balances(uuid, uuid) TO authenticated;
```

Every other RPC in this codebase opens with an authorisation check (`complete_org_onboarding`, `increment_import_count`, `update_org_member_role`, `remove_org_member`). This one does not.

**Risk (tenant safety):** Bypasses RLS by design and writes to another org's `ledger_entries` if the caller knows the UUID pair. Direct corruption is limited because it only recomputes from existing rows, but it is an unauthenticated-by-role write into arbitrary tenants and a cheap DoS amplifier — each call is a full-account window scan.

**Fix:** Add `IF NOT public.is_org_member(p_org_id) THEN RAISE EXCEPTION …` as the first statement, or revoke the grant and let only the trigger call it.
**Effort: Low**

---

### [MEDIUM-SEC-02] Admins can demote and remove co-owners; "transfer ownership" does not transfer

**Location:** `supabase/schema.sql:2548-2660`

```sql
-- update_org_member_role: an 'admin' caller passes this check
IF v_caller_role IS NULL OR v_caller_role NOT IN ('owner', 'admin') THEN RAISE EXCEPTION ...
-- and demoting an owner is blocked only when they are the LAST owner
IF v_member.role = 'owner' AND p_new_role != 'owner' THEN
  ... IF v_owner_count <= 1 THEN RAISE EXCEPTION 'Cannot demote the last owner' ...
```

```sql
-- transfer_org_ownership: promotes the target, never demotes the caller
UPDATE public.org_members SET role = 'owner'
WHERE  org_id = p_org_id AND user_id = p_target_user_id;
```

**Risk (tenant safety):** An admin — a role explicitly below owner — can strip ownership from every co-owner down to the last one, in an org with two owners removing one of them outright. And "Transfer Ownership" silently means "Add Owner": the previous owner retains full control, contradicting what the UI promises a departing treasurer.

**Fix:** Restrict owner demotion/removal to `v_caller_role = 'owner'`. In `transfer_org_ownership`, demote the caller to `admin` in the same statement.
**Effort: Low**

---

### [MEDIUM-SEC-03] Signed backup URLs live 7 days and the bucket has no lifecycle policy

**Location:** `src/utils/backupRestore.ts:557-573`

```ts
const path = `${userId}/${orgSegment}/backup-${date}-${Date.now()}.json`
await supabase.storage.from('backups').upload(path, blob, { contentType: 'application/json', upsert: true })
const { data } = await supabase.storage.from('backups').createSignedUrl(path, 60 * 60 * 24 * 7)
```

**Risk (tenant safety):** A URL granting unauthenticated access to a complete organisational financial export — every transaction, every donor reference, every member profile — valid for a week and shareable by anyone who receives it. The `backups` bucket (500 MB/file, `20260602000005_storage_org_isolation.sql:38-45`) has no expiry or cleanup, so those objects accumulate indefinitely. `purge_org` does not clear them (see MEDIUM-OPS-01).

**Fix:** Reduce signed-URL TTL to ~15 minutes. Add a scheduled purge of `backups` objects older than 30 days. Include the bucket in the org-deletion purge path.
**Effort: Low**

---

### [MEDIUM-SEC-04] Signup flow defeats Supabase's built-in account-enumeration protection

**Location:** `src/components/auth/LoginPage.tsx:125-129`

```ts
if (!signUpData.user) {
  setLoading(false)
  setError('An account with this email already exists. Please sign in instead.')
  return
}
```

Supabase deliberately returns an obfuscated response for an already-registered email precisely so that callers *cannot* distinguish the case. This code decodes that signal and reports it to the user.

**Risk (tenant safety):** Unauthenticated email-existence oracle, pairing with HIGH-SEC-01 to let an attacker both confirm accounts and resolve usernames to addresses.

**Fix:** Show the same neutral "Check your inbox to confirm your address" message in both branches.
**Effort: Low**

---

### [MEDIUM-SEC-05] Legacy receipt paths break storage RLS evaluation

**Location:** `supabase/migrations/20260602000005_storage_org_isolation.sql:63-90`

```sql
CREATE POLICY "receipts_storage_select" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'receipts' AND auth.uid() IS NOT NULL
    AND (storage.foldername(name))[1] IS NOT NULL
    AND public.is_org_member((storage.foldername(name))[1]::uuid)
  );
```

The migration's own header notes that files under the old `{entityType}/{entityId}/{filename}` convention still exist. For those, `(storage.foldername(name))[1]` is a word like `inflow`, and `::uuid` raises `invalid input syntax for type uuid`.

**Risk (UX failure):** A cast error inside an RLS predicate aborts the entire query, so a single legacy object can make receipt listing fail for the whole org — not deny access, but error out with an opaque database message.

**Fix:** Guard with a regex before casting, or run `src/utils/migrateReceiptPaths.ts` to completion and verify zero legacy objects remain.
**Effort: Low**

---

### [MEDIUM-OPS-01] Org purge never deletes the storage backup it created

**Location:** `supabase/functions/purge-deleted-orgs/index.ts:80-84` and `112-119`

```ts
const { data: orgs, error: fetchError } = await supabase
  .from('organizations')
  .select('id, name, purge_at')          // ← deletion_backup_path not selected
  .eq('status', 'pending_deletion')
  .lte('purge_at', new Date().toISOString())
...
if (org.deletion_backup_path) {          // ← always undefined
  const { error: storageErr } = await supabase.storage
    .from('deletion-backups').remove([org.deletion_backup_path as string])
}
```

**Risk (data retention / GDPR):** The guard can never be true, so the complete financial and personal-data export of every deleted organisation is retained in storage **forever**, after the org has been told its data was purged. That is a direct contradiction of the deletion promise, a GDPR erasure defect in a codebase that has a `gdpr_erasure_requests` table, and unbounded storage cost.

**Fix:** Add `deletion_backup_path` to the `select` list. Add a reconciliation job listing orphaned objects in `deletion-backups`.
**Effort: Low**

---

### [MEDIUM-OPS-02] `reconciliation_runs` is written to but does not exist

**Location:** `src/hooks/useReconciliation.ts:52, 91, 113`; `src/utils/backupRestore.ts:240`

```
grep -rn "reconciliation_runs" supabase/   →   no matches
```

Neither `schema.sql` nor any of the 74 migrations create this table, yet the app selects from it, inserts into it, and registers it as a managed backup table.

**Risk (reliability):** Reconciliation history silently never persists — the write is wrapped in "best-effort" handling and the read simply returns nothing. Users see history vanish on reload with no explanation. It also means backup/restore silently skips a table it believes it manages.

**Fix:** Add the migration (org-scoped, RLS: select `is_org_member`, insert `is_org_finance_user`), or remove the code paths. Add a CI check asserting every table name referenced in `src/` exists in the schema.
**Effort: Low**

---

### [MEDIUM-OPS-03] Stripe webhook has no event idempotency or ordering guard

**Location:** `supabase/functions/stripe-webhook/index.ts:53-80, 96-125`

Signature verification is correct (`constructEventAsync`), but there is no store of processed `event.id` and no comparison of event timestamps before writing:

```ts
await service.from('organizations').update({
  stripe_subscription_id: sub.id,
  plan_tier: status === 'canceled' ? 'free' : tier,
  plan_status: status, ...
}).eq('id', orgId)
```

**Risk (revenue / correctness):** Stripe explicitly does not guarantee delivery order and retries on any non-2xx. An `updated` event arriving after a `deleted` event resurrects a cancelled plan; a retried stale event downgrades an active subscriber. Both fail silently and neither is alerted.

**Fix:** Persist `event.id` in a `stripe_events` table with a unique constraint and no-op on conflict. Compare `sub.created`/event `created` against a stored watermark before applying.
**Effort: Low**

---

### [MEDIUM-A11Y-01] `text-gray-400` and `text-gray-500` fail WCAG AA in both themes

**Location:** `src/index.css:149-150`; 592 usages of `text-gray-400` across `src/`

```css
html.dark .text-gray-500  { color: rgba(255,255,255,0.42) !important; }
html.dark .text-gray-400  { color: rgba(255,255,255,0.32) !important; }
```

Dark: 32% white on `#0c0c0e` ≈ **2.5:1**. Light: `#9ca3af` on white ≈ **2.85:1**. WCAG AA requires 4.5:1 for body text. Used for helper text, timestamps, empty-state copy and the auth spinner label (`AuthGuard.tsx:33`).

**Risk (UX failure):** The stated audience — non-technical church and NGO volunteers, skewing older — is exactly the population most affected by low contrast, frequently on phones in bright outdoor light. Much of the failing text is explanatory copy for users who most need it.

**Fix:** Lift `text-gray-400` to ≥ `#6b7280` (gray-500) in light mode and ≥ 0.55 alpha in dark; reserve the lighter values for non-informational decoration only. Add an automated contrast check to CI.
**Effort: Low** (two CSS values plus a usage audit).

---

### [MEDIUM-UX-01] Write timeout tells users to reload but cannot tell them what happened

**Location:** `src/lib/supabase.ts:26-30`

```ts
const message =
  `The ${resourceLabel(url)} request took longer than ${Math.round(ms / 1000)}s and was cancelled. ` +
  `It may still have completed on the server — reload before retrying.`
```

The message is honest and unusually well-written for a technical audience — and unusable for the target one. There is no idempotency key, so the user genuinely cannot know, and CRITICAL-FIN-03 means retrying is silently unsafe.

**Risk (UX failure / financial loss):** A volunteer treasurer facing "it may still have completed" will retry. With no unique constraint behind it, that produces a duplicate transaction.

**Fix:** Once CRITICAL-FIN-03 lands, retry becomes safe and the copy can simply say "Retry — duplicates are prevented automatically." Send a client-generated idempotency key with each financial write.
**Effort: Low** (dependent on CRITICAL-FIN-03).

---

# 4. LOW FINDINGS

### [LOW-FIN-01] Ledger running-balance ordering has no deterministic tiebreaker

**Location:** `supabase/migrations/20260609000002_ledger_balance_trigger.sql:26-30`

```sql
OVER (ORDER BY date ASC, created_at ASC ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)
```

Two entries sharing a `date` and a `created_at` (common in bulk inserts, where `now()` is constant across a statement) order non-deterministically, so the intermediate running balances shown to users can differ between recalculations. The final balance is unaffected.
**Fix:** Append `, id ASC`. **Effort: Low**

---

### [LOW-SEC-01] `pdf-ocr` returns upstream error bodies to the browser

**Location:** `supabase/functions/pdf-ocr/index.ts:130, 211-215`

```ts
throw new Error(`Anthropic API error ${res.status}: ${body.slice(0, 200)}`)
...
return new Response(JSON.stringify({ ok: false, error: msg, pageNumber }), { status: 200, ... })
```
Provider error payloads reach the client, potentially disclosing account/quota details. Errors are also returned with HTTP 200, defeating client and monitoring error handling.
**Fix:** Log the full error server-side, return a generic message and a correlation id, with a non-2xx status. **Effort: Low**

---

### [LOW-SEC-02] `accept_invitation` falls back to the bootstrap `primary` org

**Location:** `supabase/schema.sql:1810-1813`

```sql
if v_org_id is null then
  select id into v_org_id from public.organizations where slug = 'primary' and status = 'active' limit 1;
end if;
```
An invitation with a NULL `org_id` silently enrols the user into the shared bootstrap tenant rather than failing.
**Fix:** Raise an exception instead. Remove the bootstrap org (see CRITICAL-SEC-03). **Effort: Low**

---

### [LOW-OPS-01] CI has no dependency, secret, or security scanning

**Location:** `.github/workflows/ci.yml:14-41`

Typecheck, lint, test and build only. No `npm audit`, no Dependabot, no secret scanning, no SAST. For an application handling financial data with `xlsx` and `pdfjs-dist` — both historically CVE-prone parsers processing untrusted uploaded files — this is a meaningful gap.
**Fix:** Add `npm audit --audit-level=high`, enable Dependabot and GitHub secret scanning. **Effort: Low**

---

### [LOW-OPS-02] CSP blocks the configured error-monitoring endpoint

**Location:** `vercel.json:12`, `src/lib/errorMonitor.ts:22, 38-46`

```
connect-src 'self' https://*.supabase.co wss://*.supabase.co
```
`VITE_ERROR_MONITOR_URL` pointing anywhere else (Sentry tunnel, external sink) is blocked by CSP, and the failure is swallowed by design (`.catch(() => {})`). Production error reporting would appear configured while silently delivering nothing.
**Fix:** Add the collector origin to `connect-src`, or host the sink as a Supabase Edge Function. **Effort: Low**

---

### [LOW-FIN-02] `org_id` foreign keys use `ON DELETE SET NULL` on `NOT NULL` columns

**Location:** `supabase/schema.sql:573-574` and 30 similar declarations

```sql
org_id uuid not null default public.get_current_org_id()
       references public.organizations(id) on delete set null
```
The referential action can never succeed — deleting an organisation raises a not-null violation rather than cascading. `purge_org` deletes children explicitly so this is currently masked, but it is a latent trap for any future direct delete.
**Fix:** Change to `ON DELETE RESTRICT`, which states the actual intent. **Effort: Low**

---

### [LOW-UX-01] `Modal` uses a hardcoded DOM id for its accessible name

**Location:** `src/components/ui/Modal.tsx:174, 202`

```tsx
aria-labelledby="modal-title"
...
<h2 id="modal-title" ...>{title}</h2>
```
With two modals mounted simultaneously (the import flow nests them), the id is duplicated and `aria-labelledby` resolves ambiguously for screen readers.
**Fix:** Use `useId()`, as `FormField` already does correctly. **Effort: Low**

---

# 5. TRUST BOUNDARY AUDIT

Every path that can alter financial data, traced UI → state → hook → service → RLS.

| # | Operation | UI → Hook → Service | Server-side enforcement | Verdict |
|---|---|---|---|---|
| 1 | Add inflow | `AddInflowModal` → `useAddInflow` → `insert` | RLS `is_org_finance_user(org_id)`; audit trigger | **OK** — org_id client-supplied but RLS-verified |
| 2 | Add outflow | `AddOutflowModal` → `useAddOutflow` → `insert` | RLS + audit trigger | **OK** |
| 3 | Update transaction | inline/modal → `useUpdateTransaction` → `update` | RLS `USING` (doubles as `WITH CHECK`) | **WEAK** — open `Record<string, unknown>`; no optimistic lock (HIGH-FIN-04) |
| 4 | Delete transaction | `DeleteDialog` → `useDeleteTransaction` | RLS + `count:'exact'` guard | **OK** — but missing outflow sync bump (MEDIUM-FIN-05) |
| 5 | Internal transfer | `AddIntraFlowModal` → `useAddIntraFlow` | RLS on `intra_flows` | **WEAK** — no server check that `total_amount > 0` or that source has funds |
| 6 | FX conversion | `AddFXConversionModal` → `perform_fx_conversion` RPC | Advisory lock, server-computed naira, balance guard | **STRONG** — the reference implementation |
| 7 | FX manual entry | `AddFXModal` → RPC (`20260609000001`) | Server-side | **OK** |
| 8 | Import (bulk) | `ImportModal` → direct batched `insert` | RLS only | **WEAK** — non-atomic, no dedupe constraint, column-stripping (CRIT-FIN-03, HIGH-FIN-03) |
| 9 | Import cap | `ImportModal` → `increment_import_count` | Atomic RPC, membership-checked | **BROKEN** — client decides whether to call; column directly writable (CRIT-SEC-01) |
| 10 | Plan gating | `PlanGate` / `RequiresFull` | **none** | **BROKEN** — client-only, fails open (CRIT-SEC-02) |
| 11 | Bank opening balance | `AddBankModal` → `propagateBankOpeningBalance` | RLS; non-org-scoped unique index | **BROKEN** — cross-tenant collision (CRIT-TEN-01) |
| 12 | Category opening balance | `Categories` → `category_opening_balances` | RLS `is_org_finance_user` | **OK** |
| 13 | Distribution rules | `DistributionRulesTab` → `create_special_config_version` | SECURITY DEFINER + org check | **OK** |
| 14 | Approve rule version | → `approve_config_version` | SECURITY DEFINER | **OK** |
| 15 | Ledger entry | `useAddLedgerEntry` → `insert` | Trigger recomputes balance server-side | **OK** — balance not client-writable |
| 16 | Ledger recompute | direct RPC | **no membership check** | **WEAK** (MEDIUM-SEC-01) |
| 17 | Backup | `BackupModal` → `createBackup` | RLS on reads | **BROKEN** — truncates at 1,000 (CRIT-FIN-01) |
| 18 | Restore | `RestoreModal` → `restoreFromBackup` | RLS per statement | **BROKEN** — non-atomic destructive; accepts arbitrary JSON incl. `plan_tier` (CRIT-FIN-02, HIGH-SEC-03) |
| 19 | Reset data | `ResetDataModal` | Org-scoped deletes | **OK** |
| 20 | Org deletion | `DeleteOrgModal` → `request_org_deletion` | Owner-only, lock trigger, purge job | **OK** — but storage backup never purged (MEDIUM-OPS-01) |
| 21 | Member role change | `UserManagement` → `update_org_member_role` | Caller-role + last-owner guards | **WEAK** — admin can demote owners (MEDIUM-SEC-02) |
| 22 | Invitation | `UserManagement` → `insert` + `send-invite-email` | RLS admin-only; per-org check in function | **WEAK** — HTML injection (HIGH-SEC-02) |
| 23 | Receipt upload | `ReceiptBadge` → Storage | Storage RLS on org path prefix | **OK** |
| 24 | OCR extraction | `PdfConverterOverlay` → `pdf-ocr` | JWT only | **WEAK** — no plan/quota/rate limit (HIGH-OPS-01) |
| 25 | Checkout / Portal | `BillingTab` → Edge Functions | Per-org owner/admin check | **STRONG** |

**Summary:** 25 financial-mutation paths. 11 fully enforced server-side, 8 weak, **6 broken at the trust boundary.** The consistent pattern is that operations built as RPCs are sound, and operations built as direct PostgREST calls from the client are not.

---

# 6. PILLAR SCORES

### Pillar 1 — Multi-Tenant Isolation & Security: **42 / 100**

RLS is applied systematically and thoughtfully: 245 policies, org-scoped `SECURITY DEFINER` helpers, status-aware membership checks so suspended users lose access immediately, storage policies keyed on org path prefixes, server-side audit triggers that capture `auth.uid()` un-forgeably, and a genuinely strong CSP.

It is undermined by a cross-tenant unique index that blocks tenant #2 from onboarding, a global `currencies` table any admin can destroy for everyone, an anonymous email-harvesting RPC, and — decisively — the fact that isolation has never been empirically verified even once.

**Top blockers:** CRITICAL-TEN-01, CRITICAL-SEC-01, CRITICAL-OPS-01, HIGH-SEC-01, HIGH-TEN-01.

---

### Pillar 2 — Financial Integrity: **28 / 100**

The primitives are right: `numeric(15,2)` at rest, integer-minor-unit percentage allocation, an FX conversion RPC with an advisory lock, server-side amount computation and a balance guard, and an append-only audit trail with per-field change tracking.

They sit on top of a data model with no uniqueness constraint on transaction references, category linkage as unconstrained text, a backup that truncates, a restore that deletes non-atomically, balance code that treats query failures as zeros, and a reconciliation engine that reports "Healthy" when it crashes. Six of the twelve corruption scenarios in scope — duplicates, partial writes, non-atomic operations, orphaned records, broken rollback, silent inconsistency — are live and reachable without an attacker.

**Top blockers:** CRITICAL-FIN-01, -02, -03, -04, HIGH-FIN-01, HIGH-FIN-02.

---

### Pillar 3 — UX / UI Accessibility: **74 / 100**

The strongest pillar by a wide margin, and visibly built with the stated audience in mind. `Modal` implements a focus trap, focus restoration, `aria-modal`, `role="dialog"`, ESC handling, a dirty-state discard guard, 44px touch targets, safe-area insets and swipe-to-dismiss. `FormField` auto-wires `htmlFor`/`id`/`aria-invalid`/`aria-describedby`/`role="alert"` and renders required markers with screen-reader text. Dark mode is handled coherently through global token overrides. There is a full tutorial (18 chapters), guided tours, a help centre, an onboarding wizard, empty states and a glossary.

Held back by a systematic contrast failure and — more seriously — by silent-failure states: wrong balances, false-healthy reconciliation and truncated backups all render as confident, correct-looking UI. For non-technical users, an error they cannot see is the worst possible failure mode.

**Top blockers:** MEDIUM-A11Y-01, HIGH-FIN-01, HIGH-FIN-02, MEDIUM-UX-01.

---

### Pillar 4 — Operations & Scalability: **35 / 100**

Real strengths: CI runs typecheck, lint, tests and build; every route is wrapped in an `ErrorBoundary`; the Supabase client has method-aware timeouts and 401 auto-recovery; index coverage is thorough (60 org-scoped indexes plus composites); security headers are properly configured.

But balances are computed by downloading whole tables into the browser, the ledger trigger is O(N²), migrations auto-deploy to production without an enforced gate or a snapshot, one Edge Function is an unmetered spend endpoint, a referenced table does not exist, and deleted orgs leave their backups in storage permanently.

**Top blockers:** HIGH-PERF-01, HIGH-PERF-02, HIGH-OPS-01, HIGH-OPS-02, MEDIUM-OPS-01.

---

# 7. INDEPENDENT DIMENSION SCORES

| Dimension | Score | Rationale | Top blocker |
|---|---|---|---|
| **Security** | **40** | Strong headers, CSP, server-side audit, sound RPC design — undone by a client-side billing boundary and an anonymous PII oracle | CRITICAL-SEC-01 / -02 |
| **Multi-Tenant Isolation** | **45** | Comprehensive, consistent RLS; defeated by one non-scoped index, one global table, and zero verification | CRITICAL-TEN-01 |
| **Financial Integrity** | **28** | Correct primitives on an unconstrained data model; duplicates and orphans are reachable without an attacker | CRITICAL-FIN-03 |
| **UX / UI** | **78** | Genuinely well-crafted flows, onboarding and empty states; silent failure states are the weak point | HIGH-FIN-01 |
| **Accessibility** | **68** | Excellent primitives (focus trap, ARIA wiring, touch targets); systematic contrast failure across 592 usages | MEDIUM-A11Y-01 |
| **Reliability** | **35** | Errors are swallowed at nearly every critical path; no atomicity on multi-write operations | CRITICAL-FIN-02 |
| **Performance** | **40** | Good index coverage, but client-side aggregation of full tables and an O(N²) trigger | HIGH-PERF-01 |
| **Scalability** | **32** | Architecture degrades with tenant size and cannot survive a large org; no server-side aggregation layer | HIGH-PERF-01 |
| **Maintainability** | **62** | Exceptional comment discipline explaining *why*; strong module boundaries; undercut by schema/migration drift and misleading tests | CRITICAL-SEC-03 |
| **Operational Readiness** | **33** | No staging, no snapshot before migration, no spend controls, no real integration tests, a missing table in production | HIGH-OPS-02 |

---

# 8. LAUNCH RISK RANKING

All CRITICAL and HIGH findings, ranked by actual launch risk (probability × impact).

| Rank | ID | Blocker | Probability | Impact if realised |
|---|---|---|---|---|
| 1 | CRITICAL-TEN-01 | **Yes** | **Certain** — first tenant to name a common bank | Every subsequent tenant fails onboarding at setup |
| 2 | CRITICAL-FIN-03 | **Yes** | **Very high** — any retry or concurrent import | Duplicated income; corrupted balances; undetectable |
| 3 | CRITICAL-FIN-01 | **Yes** | **High** — any org >1,000 rows using restore | Total, irreversible loss of financial history |
| 4 | CRITICAL-SEC-02 | **Yes** | **Certain** if anyone inspects the client | Entire revenue model unenforced |
| 5 | CRITICAL-SEC-01 | **Yes** | **High** — trivially discoverable | Free access to all paid tiers; import cap void |
| 6 | CRITICAL-FIN-02 | **Yes** | **Medium** — needs a failure mid-restore | Org left empty/half-restored, audit log already gone |
| 7 | CRITICAL-FIN-04 | **Yes** | **High** — renames are routine | Fund history detaches; balances silently orphaned |
| 8 | HIGH-FIN-01 | **Yes** | **Medium** — any transient query failure | Confidently wrong balance sheet, no error shown |
| 9 | HIGH-FIN-02 | **Yes** | **Medium** — expired JWT is enough | "Healthy" verdict when nothing was checked |
| 10 | CRITICAL-OPS-01 | **Yes** | **Certain** (already true) | Isolation regressions ship undetected |
| 11 | HIGH-SEC-01 | **Yes** | **High** — one script | Mass harvest of finance-admin emails → phishing |
| 12 | HIGH-SEC-02 | **Yes** | **Medium** — needs intent | Phishing from your signed domain; reputation loss |
| 13 | HIGH-TEN-01 | **Yes** | **Medium** | Cross-tenant destruction of currency reference data |
| 14 | HIGH-OPS-01 | **Yes** | **Medium** | Unbounded AI spend billed to you |
| 15 | CRITICAL-SEC-03 | No¹ | **Low** now, certain on DR | Fixed tenancy bug reintroduced; CI tests wrong schema |
| 16 | HIGH-FIN-03 | No¹ | **Medium** | Silent loss of allocation fields; partial ledgers |
| 17 | HIGH-FIN-04 | No¹ | **High** | Silent lost updates between concurrent editors |
| 18 | HIGH-SEC-03 | No¹ | **Low** | Cross-org export; restore-based plan escalation |
| 19 | HIGH-PERF-01 | No¹ | **Low at launch**, certain at scale | App becomes unusable for your best customers |
| 20 | HIGH-PERF-02 | No¹ | **Medium** | Bulk ledger imports time out |
| 21 | HIGH-OPS-02 | No¹ | **Medium** | Unreviewed DDL on production; no recovery path |

¹ *Not a hard blocker only because it can be contained by launching in a controlled beta with restricted tenant count and feature flags. All 21 must be resolved before paid GA.*

---

# 9. REMEDIATION ROADMAP

## Phase 1 — Immediate Launch Blockers
*Must be complete before any public access. Estimated 2–3 engineer-weeks.*

| # | Action | Finding | Effort |
|---|---|---|---|
| 1 | Re-scope `idx_inflow_bf_unique_bank` to `(org_id, bank_name)` | CRITICAL-TEN-01 | Low |
| 2 | Add unique indexes on `(org_id, bank_id, transaction_ref/transaction_id)`; de-duplicate existing production data first | CRITICAL-FIN-03 | Low |
| 3 | Route `fetchTableData` through `fetchAllRows`; assert backup row counts against `count:'exact'` and hard-fail on mismatch | CRITICAL-FIN-01 | Low |
| 4 | Disable `replace`-mode restore until it is transactional | CRITICAL-FIN-02 | Low |
| 5 | `REVOKE UPDATE` on all plan/Stripe columns; add a `service_role`-only guard trigger | CRITICAL-SEC-01 | Low |
| 6 | Change `resolveEffectiveTier(null)` to `'free'`; enforce `org_plan_at_least()` in RLS for gated tables and in `pdf-ocr` | CRITICAL-SEC-02 | Med |
| 7 | Add `cobRes.error` / `intraFlowRes.error` to the `fatal` check in `computeFundBuckets` | HIGH-FIN-01 | Low |
| 8 | Surface rejected reconciliation rules; never emit a health status on partial runs | HIGH-FIN-02 | Low |
| 9 | Stop returning email from `resolve_username`; rate-limit it | HIGH-SEC-01 | Med |
| 10 | HTML-escape all interpolations in `send-invite-email` | HIGH-SEC-02 | Low |
| 11 | Org-scope or lock down `currencies`; set `backupEnabled: false` | HIGH-TEN-01 | Low |
| 12 | Add plan check, per-org quota and payload size cap to `pdf-ocr`; set an Anthropic budget alert | HIGH-OPS-01 | Med |
| 13 | **Build the two-org RLS integration test suite** and wire it into CI | CRITICAL-OPS-01 | Med |

> **Sequencing note:** item 13 is listed last but should be started **first**. Without it, there is no way to confirm items 1, 5, 6 and 11 actually worked — which is precisely how the current defects survived.

---

## Phase 2 — 30-Day Technical Debt
*Must be complete before accepting paid customers.*

| # | Action | Finding | Effort |
|---|---|---|---|
| 14 | Make restore a single transactional `SECURITY DEFINER` RPC; re-enable `replace` mode | CRITICAL-FIN-02 | Med |
| 15 | Add `category_id` FK to transactions; backfill; block delete-when-referenced; make rename metadata-only | CRITICAL-FIN-04 | High |
| 16 | Regenerate `schema.sql` from a migrated DB; add a convergence check to CI; drop the bootstrap org | CRITICAL-SEC-03 | Med |
| 17 | Add optimistic locking (`updated_at` precondition) and per-table updatable-column whitelists | HIGH-FIN-04 | Low |
| 18 | Make missing columns fatal on import; add `import_batch_id` and one-click batch rollback | HIGH-FIN-03 | Med |
| 19 | Exclude `organizations`/`currencies` from backup; reject foreign `org_id` on restore; strip plan columns | HIGH-SEC-03 | Med |
| 20 | Branch protection on `main`; `pg_dump` snapshot before `db push`; staging project; rollback-migration convention | HIGH-OPS-02 | Med |
| 21 | Convert the ledger trigger to `FOR EACH STATEMENT` | HIGH-PERF-02 | Med |
| 22 | Add the `reconciliation_runs` migration; add a CI check that every table referenced in `src/` exists | MEDIUM-OPS-02 | Low |
| 23 | Fix `deletion_backup_path` selection in the purge job; add an orphaned-object reconciliation pass | MEDIUM-OPS-01 | Low |
| 24 | Add `stripe_events` idempotency table and event-ordering watermark | MEDIUM-OPS-03 | Low |
| 25 | Add `todayInOrgTz()` and replace all 56 UTC date defaults | MEDIUM-FIN-01 | Low |
| 26 | Restrict owner demotion/removal to owners; make `transfer_org_ownership` demote the caller | MEDIUM-SEC-02 | Low |
| 27 | Add a membership check to `recalculate_ledger_balances` | MEDIUM-SEC-01 | Low |
| 28 | Raise contrast for `text-gray-400/500`; add an automated contrast gate to CI | MEDIUM-A11Y-01 | Low |
| 29 | Neutralise the signup enumeration message; shorten backup signed-URL TTL to 15 min | MEDIUM-SEC-03/-04 | Low |
| 30 | Enable `npm audit`, Dependabot and secret scanning | LOW-OPS-01 | Low |

---

## Phase 3 — 60-Day Post-Launch Optimisations

| # | Action | Finding | Effort |
|---|---|---|---|
| 31 | Move balance aggregation into Postgres (materialised view or `SECURITY INVOKER` RPC) | HIGH-PERF-01 | High |
| 32 | Convert bucket accumulation to integer minor units end to end | MEDIUM-FIN-03 | Med |
| 33 | Recompute the FX running-balance chain on backdated inserts, or derive on read | MEDIUM-FIN-02 | Med |
| 34 | Complete the `bank_id` backfill; make it `NOT NULL`; remove name-matching | MEDIUM-FIN-04 | Med |
| 35 | Add idempotency keys to financial writes; simplify the timeout copy | MEDIUM-UX-01 | Low |
| 36 | Add lifecycle policies for `backups` and `deletion-backups` storage | MEDIUM-SEC-03 | Low |
| 37 | Complete the receipt path migration; guard the RLS uuid cast | MEDIUM-SEC-05 | Low |
| 38 | Fix the missing outflow sync bump on delete | MEDIUM-FIN-05 | Low |
| 39 | Add the `id` tiebreaker to ledger ordering; change org FKs to `ON DELETE RESTRICT` | LOW-FIN-01/-02 | Low |
| 40 | `useId()` in `Modal`; sanitise `pdf-ocr` error responses; fix the CSP `connect-src` for error monitoring | LOW-UX-01, LOW-SEC-01, LOW-OPS-02 | Low |

---

# 10. COVERAGE REPORT

| Folder | Files reviewed | Findings | Confidence | Notes |
|---|---|---|---|---|
| `supabase/migrations/` | 74 files fully enumerated; 22 read in full; all grepped for policies, `SECURITY DEFINER`, grants, triggers | 14 | **High** | Full policy inventory extracted (245 policies) |
| `supabase/schema.sql` | 3,198 lines — all sections read | 9 | **High** | Complete: tables, RLS, helpers, RPCs, indexes, triggers |
| `supabase/functions/` | All 6 read in full | 6 | **High** | stripe-webhook, create-checkout-session, create-portal-session, pdf-ocr, send-invite-email, purge-deleted-orgs |
| `supabase/config.toml` | Reviewed (`max_rows` confirmed) | 1 | **High** | Drove CRITICAL-FIN-01 |
| `src/hooks/` (55 files) | `useMutations` (1,370 L), `usePlan`, `useRole`, `useBankBalances`, `useReconciliation`, `useDashboard`, `useLedger` read; rest grepped for org scoping | 8 | **Med-High** | Per-entity read hooks sampled, not exhaustively read |
| `src/utils/` (55 files) | `backupRestore`, `fundBuckets`, `financeMath`, `effectiveAmount`, `fetchAllRows`, `dedupQuery`, `flowAggregate`, `configResolver`, `bankOpeningBalance`, `transactionTypes`, `insertBatchResilient`, `reconciliationEngine`, `generateTransactionId`, `timezones`, `reportTokenParser` read in full | 12 | **High** | Core financial engine fully covered |
| `src/components/modals/` (30) | `ImportModal` (4,110 L, commit path), `Modal`, `AddInflowModal` read; all 30 grepped for submit guards | 3 | **Med** | See gaps below |
| `src/components/auth/` | All 4 read in full | 3 | **High** | AuthGuard, LoginPage, RoleGates, PlanGates |
| `src/components/ui/` (48) | `Modal`, `FormField` read; rest grepped for a11y attributes | 2 | **Med** | Primitives verified; leaf components sampled |
| `src/pages/` (38) | Structure + routing (`App.tsx`) reviewed; grepped for table access and org scoping | 1 | **Low-Med** | See gaps below |
| `src/store/` (14) | `orgStore`, `authStore` inspected via consumers | 1 | **Med** | State-shape reviewed indirectly |
| `src/lib/` | Both read in full | 2 | **High** | supabase.ts, errorMonitor.ts |
| `src/utils/__tests__/` (21) | Case counts enumerated; `tenantIsolation.test.ts` read | 1 | **High** | Drove CRITICAL-OPS-01 |
| `.github/workflows/` | All 3 read in full | 3 | **High** | ci, migrate, migrate-check |
| `vercel.json`, `tsconfig`, `eslintrc`, `.gitignore`, `.env.example` | All read | 2 | **High** | Headers/CSP verified; secrets sweep clean |
| `src/onboarding/` (30) | Structure reviewed | 0 | **Low** | Content, not logic — see gaps |

## Explicitly NOT fully analysed

These require either deeper reading or a live database. Each should be covered before GA.

1. **`src/pages/` in depth (38 files, ~20k LOC)** — including `FinancialReport.tsx` (2,197 L), `DynamicReportEditor.tsx` (2,121 L), `CategoryLedger.tsx` (1,628 L), `Reports.tsx` (1,614 L), `Outflows.tsx`, `Inflows.tsx`, `UserManagement.tsx`, `BankMovement.tsx`, `ReconciliationCenter.tsx`. Report *display* math was not line-by-line verified against the aggregation layer. **Risk: further arithmetic divergence between report surfaces — the exact class of defect `fundBuckets.ts` was created to fix.**
2. **`ImportModal.tsx` (4,110 L) — parsing and mapping stages.** Only the commit path (≈lines 1540–1720) was read in full. Column mapping, grouping, offset auto-tagging and PDF ingest were not.
3. **`src/utils/reportQueryEngine.ts` / `reportExport.ts` / `paginatedExport.ts`** — token→query translation and export correctness not verified. Export truncation of the `max_rows` class is plausible here and was **not** ruled out.
4. **`src/utils/pdfParser.ts` / `pdfTableExtract.ts` / `pdfPageRenderer.ts` (~1,500 L)** — untrusted-file parsers. Not reviewed for DoS or malformed-input handling.
5. **`src/onboarding/` (tours, wizard, help, 18 tutorial chapters)** — content correctness and whether documentation matches actual behaviour.
6. **Runtime verification of every kind.** `npm test`, `npm run lint` and `npm run build` **could not be executed** — `node_modules` is not installed in this environment and `vitest` failed at config load (`Cannot find package 'vite'`). No test was run; no build was produced; no RLS policy was executed against a live database. Every finding is static.
7. **Live production database state.** Whether production matches `schema.sql`, the migrations, or neither is **unknown and unknowable from the repository** — `migrate-check.yml` states the base schema was applied by hand. Several findings (CRITICAL-SEC-03, MEDIUM-OPS-02) hinge on this. **Verify against production before acting on the schema findings.**
8. **`src/components/ui/` leaf components (46 of 48)** — not individually reviewed for accessibility.
9. **Supabase project configuration outside the repo** — Auth settings (password policy, MFA enforcement, JWT expiry, email confirmation), rate limits, connection pooling, PITR/backup configuration. None of this is in version control and none was verifiable.

---

# 11. WHAT IS ALREADY GOOD

Worth stating plainly, because the remediation list above is long and the underlying engineering is not weak.

- **`perform_fx_conversion`** (`20260605000004`) is a model of how every financial mutation in this system should be built: advisory lock, server-side amount computation with the client value explicitly ignored, a balance guard, and three related inserts in one transaction. It is the template for fixing findings 8, 14 and 18.
- **Server-side audit triggers** (`schema.sql:1893-1950`) capture `auth.uid()` and `now()` in the database. The client-side `logAudit` functions were correctly reduced to no-op stubs rather than deleted, preserving call sites. The audit trail cannot be forged by a client.
- **RLS coverage is systematic**, not ad-hoc: consistent four-policy sets per table, org-scoped helper functions, `status = 'active'` checks so suspended users lose access immediately, and child tables correctly isolated by joining through their parent's `org_id`.
- **Member-management RPCs** enforce last-owner protection, prevent admin→owner self-promotion, and validate caller role — genuinely careful authorisation logic.
- **`Modal` and `FormField`** are better-implemented than most commercial component libraries: real focus trap, focus restoration, ARIA wiring done automatically so individual forms cannot get it wrong, 44px targets, safe-area insets.
- **The comments explain *why*, not *what*.** `fetchAllRows`, `insertBatchResilient`, `supabase.ts`, `flowAggregate` and `fundBuckets` each open by explaining the bug that motivated them. Several findings in this audit were locatable *because* a comment documented the constraint the code elsewhere violated.
- **Security headers and CSP** are correctly configured and unusually tight. No secrets in the repository; `.gitignore` is comprehensive.
- **Index coverage** is thorough — 60 org-scoped indexes plus composite `(org_id, date)` indexes matching the actual query patterns.

The gap between this quality level and the findings above is almost entirely **verification**, not competence. Build the integration test suite first; most of the rest follows.

---

*End of report.*
