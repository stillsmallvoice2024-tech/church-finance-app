# Regression Audit — 2026-06-05 21:00 → 2026-06-06 23:58

**Branch:** `claude/regression-investigation-audit-2nGLE`
**Audited:** main commits in window above
**Focus:** import propagation regressions, allocation calculation regressions
**Status:** Audit complete. No code changes made.

---

## Commits in Window (chronological)

| # | SHA | Time (UTC) | Message |
|---|-----|-----------|---------|
| 1 | `53a393eb` | 2026-06-05 21:47 | fix(audit): N-3 retention + N-4 GDPR erasure workflow |
| 2 | `84184c0b` | 2026-06-05 22:07 | chore: merge main into branch, resolve schema.sql conflict |
| 3 | `951e8dc4` | 2026-06-05 21:56 | fix(audit): fix dollar-quote collision in pg_cron schedule block |
| 4 | `a4ae4114` | 2026-06-05 21:48 | chore: update package-lock.json after dep install |
| 5 | `584fd155` | 2026-06-05 23:08 | Merge PR #269 — N-3 retention + N-4 GDPR |
| 6 | `66cb3b2d` | 2026-06-06 07:17 | feat: UX Phase 1 — CTA, drill-through, date presets, toast, identity challenge |
| 7 | `f770606` | 2026-06-06 07:42 | Remove FX fields from Add Inflow/Outflow modals |
| 8 | `95d5200f` | 2026-06-06 10:18 | Phase 2 UX — reduced-motion, a11y, connection, backup ts, import templates |
| 9 | `a701a49e` | 2026-06-06 10:54 | Fix pre-existing unused var in useFXConversions |
| 10 | `1099cbb2` | 2026-06-06 05:11 | security: root-cause remediation C1-C5, H1-H6, H8 |
| 11 | `2a60be1b` | 2026-06-06 12:09 | feat: UX Phase 3 — onboarding, reports hub, command palette, 2FA |
| 12 | `f04f152e` | 2026-06-06 19:42 | Fix special config Percentage Allocation budget_portion propagation |
| 13 | `28111fdb` | 2026-06-06 20:21 | fix: handle amount-type special config rows in allocation loops |

---

## Risk Rankings

### RANK 1 — CRITICAL `28111fdb` — Amount-type allocation per-inflow injection

**Probability of regression: very high**

#### What changed
Three `if (!catRow.percentage) continue` guards in:
- `src/hooks/useReportEngine.ts` (report engine allocation map)
- `src/pages/CategoryLedger.tsx` (summary allocMap, detail ledger — 2 sites)

...were replaced with a three-way branch: `catRow.amount > 0` → use fixed amount, `catRow.percentage` → use percent, else → skip.

#### Which paths are now different

**CategoryLedger summary allocMap** (`CategoryLedger.tsx` ~line 217):
- Before: every config row without a percentage was skipped → amount-type configs contributed 0 to `allocMap`
- After: every config row with `catRow.amount > 0` contributes `catRow.amount` to `allocMap` for **each** inflow transaction
- `allocMap` feeds `percentageAllocated` on every CategoryRow, displayed as the "Allocation" column

**CategoryLedger detail ledger — Percentage tab** (`CategoryLedger.tsx` ~line 326):
- Before: inflows with amount-type configs had no ledger entries in the Percentage tab
- After: each such inflow creates a ledger entry with `inflow = catRow.amount`
- Running balance is recalculated from these entries

**CategoryLedger detail ledger — config-split tab** (`CategoryLedger.tsx` ~line 407):
- Same pattern. Config-split inflows for a selected category now show `catRow.amount` per inflow instead of 0.

**useReportEngine** (`useReportEngine.ts` ~line 185):
- Allocation totals per category (used by reports and Dashboard KPIs) now include `catRow.amount × N` where N = number of inflows pointing at that config.

#### Regression surface
Any org that has **at least one amount-type special allocation config** with inflows linked via `allocation_config_id` will see **all** of the following change simultaneously:
- CategoryLedger "Allocation" column values inflate by `catRow.amount × inflow_count`
- Category ledger line-by-line entries appear for transactions that previously showed nothing
- Running balance totals change for the affected categories
- Report engine aggregate totals change

#### Interaction with `f04f152e` (Rank 2)
Both commits modify `CategoryLedger.tsx`. The `f04f152e` commit (applied first) changed the `catRow` lookup filter at line 324 to also accept `budget_portion === 'Percentage Allocation'`. The `28111fdb` commit then changed the `allocated` calculation at that same site. The two changes are additive: more rows are now matched (f04f152e) AND those rows now use amount instead of percentage (28111fdb).

---

### RANK 2 — HIGH `f04f152e` — budget_portion 'Percentage Allocation' normalisation

**Probability of regression: high**

#### What changed
- `src/components/modals/CreateSpecialConfigModal.tsx`: `<option value>` changed from `"Percentage Allocation"` to `"Percentage"` (label unchanged). Pre-fill normalises old `"Percentage Allocation"` values → `"Percentage"`.
- `src/pages/CategoryLedger.tsx` line 324: catRow lookup now accepts `c.budget_portion === 'Percentage Allocation'` in addition to `'Percentage'` and falsy.
- `src/pages/PercentageAllocation.tsx` line 125: config-split loop now passes rows where `budget_portion === 'Percentage Allocation'` instead of skipping them.

#### Which paths are now different

**PercentageAllocation config-split deposited totals:**
- Before: `if (row.budget_portion && row.budget_portion !== 'Percentage') continue` → rows with `budget_portion = 'Percentage Allocation'` were **skipped**
- After: same rows now contribute `allocatePercent(inflow.amount, pct)` to `ensure(cat).deposited`
- Any org that previously created configs via the modal (which stored `'Percentage Allocation'`) will see these rows now **add to deposited totals for the first time**. Deposited column and Balance column will increase.

**CategoryLedger Percentage tab — catRow lookup:**
- Before: only matched `budget_portion === 'Percentage'` or null/empty
- After: also matches `budget_portion === 'Percentage Allocation'`
- Inflows with configs where rows had `budget_portion = 'Percentage Allocation'` now appear in the Percentage tab ledger. They were invisible before.

**CreateSpecialConfigModal forward writes:**
- New configs saved after this commit store `'Percentage'` instead of `'Percentage Allocation'`. The backward-compat guards in CategoryLedger and PercentageAllocation mean old rows (stored as 'Percentage Allocation') and new rows (stored as 'Percentage') both now match. No double-counting risk from `.find()` returning only one row, but the presence of rows that were previously hidden inflates totals.

---

### RANK 3 — HIGH `1099cbb2` (H1) — createNewVersion replaced by RPC

**Probability of regression: high if DB migration not applied, zero otherwise**

#### What changed
`src/hooks/useSpecialConfigGroups.ts` `createNewVersion()`:
- Before: ~35 lines of direct Supabase inserts — SELECT covering version, UPDATE effective_to, INSERT new allocation_configs row
- After: single `supabase.rpc('create_special_config_version', {...})` call

#### Which paths are now different

**Special config version creation flow:**
- The RPC `create_special_config_version` must exist in the live Postgres database (migration `20260606000003_security_fixes.sql`).
- If that migration has **not** been applied, every call to "Create New Version" in the Special Config UI will throw: `function create_special_config_version(...) does not exist`
- This blocks all version branching, including effective-date range management and import config assignment

**Concurrent version creation:**
- Old path: no row-level lock → race condition possible under concurrent saves
- New path: RPC uses `FOR UPDATE` on the group row → serialised server-side
- This is the correct direction, but the RPC's version-numbering and `effective_to` computation logic must exactly replicate the removed client-side logic (`subtractOneDay`, `covering` version closure). If the RPC has a bug, version date ranges will be wrong.

**`subtractOneDay` removed:**
- Was the only consumer of the helper; helper deleted. No other impact.

---

### RANK 4 — MEDIUM `1099cbb2` (H8) — MISSING_COL_RE silent-retry removal

**Probability of regression: medium (only if live DB schema is stale)**

#### What changed
`src/hooks/useMutations.ts`:
- `MISSING_COL_RE` regex deleted
- `useAddFXTransaction`: removed retry-without-missing-column loop → single insert, throws on any error
- `useBulkUpdateTransaction`: removed per-chunk while-loop that stripped unknown columns → single update per chunk, throws on error
- Return type changed from `{ failed, total, strippedCols }` to `{ failed, total }`
- BulkEdit modals (`BulkEditInflowModal`, `BulkEditOutflowModal`, `BulkEditIntraFlowModal`): removed `strippedCols` usage; now only read `failed`

#### Which paths are now different

**useAddFXTransaction:**
- Any FX insert that previously succeeded via silent column strip now throws. If live DB is missing a column that the client sends, FX inserts fail hard with a DB error message.

**useBulkUpdateTransaction — error semantics:**
- Before: a column-mismatch error on chunk N caused that column to be stripped from all subsequent chunks; the chunk was counted as failed but remaining chunks continued
- After: any error on any chunk throws immediately, leaving all un-processed chunks unexecuted
- This changes partial-success semantics: old code returned `{ failed: n }` accumulating partial failures; new code throws on first failure

**Audit log correctness:**
- Old code passed `appliedUpdates` (baseUpdates minus stripped columns) to audit functions
- New code passes `baseUpdates` directly — always correct (no stripped columns possible)

---

### RANK 5 — LOW `95d5200f` — Import template feature in ImportModal

**Probability of regression: low**

#### What changed
`src/components/modals/ImportModal.tsx`: added template save/load/delete backed by `localStorage` key `church-import-templates`.

#### Which paths are now different

**Column mapping step (Step 3):**
- `handleApplyTemplate` calls `setMapping(prev => ({ ...prev, ...applied }))` — merges onto existing mapping
- If a template contains a header→field mapping for a column that the user has already manually assigned, the template application silently overrides it
- The import pipeline itself (`importRows`, `buildRow`, column-normalisation) is unchanged
- Regression scope is limited to users who create and apply templates; standard import flow is unaffected

---

### RANK 6 — MINIMAL `f770606` — Remove FX fields from Add Inflow/Outflow modals

- `src/components/modals/AddInflowModal.tsx`, `AddOutflowModal.tsx`
- UI-only: FX currency/amount/rate fields removed from manual-add modals
- Import pipeline flows through `ImportModal` → `importRows` — completely separate path
- Allocation logic is not triggered by these modals
- **No import or allocation regression risk**

---

### RANK 7 — MINIMAL UX commits (`66cb3b2d`, `2a60be1b`)

- `66cb3b2d`: DatePresetBar, StatCard links, toast duration system, ResetDataModal identity challenge. No allocation or import logic.
- `2a60be1b`: PageHelpBanner on CategoryLedger, PercentageAllocation, and others; CommandPalette; MFA modals; glossary. Additive only; no mutation or calculation logic changed.

---

### RANK 8 — MINIMAL Audit/GDPR commits (`53a393eb`, `584fd155`)

- Migration files only (`20260606000001_audit_log_n3_retention.sql`, `20260606000002_audit_log_n4_gdpr.sql`)
- `schema.sql` updated for fresh installs
- `field_changes_trigger_fn` now skips metadata fields — reduces audit noise, does not change transaction data
- No client-side import, allocation, or mutation logic changed

---

## Exact Paths Changed Per Suspect Commit

### `28111fdb` — changed paths

| File | Function/Site | Change |
|------|--------------|--------|
| `src/hooks/useReportEngine.ts` | allocation map loop ~line 185 | `allocatePercent(r.amount, catRow.percentage)` → fixed `catRow.amount` when present |
| `src/pages/CategoryLedger.tsx` | summary `allocMap` loop ~line 217 | same logic change |
| `src/pages/CategoryLedger.tsx` | detail ledger Percentage tab ~line 326 | same; also guard changed from `!catRow?.percentage` to `!catRow` |
| `src/pages/CategoryLedger.tsx` | detail ledger config-split ~line 407 | same; guard changed from `!catRow?.percentage` to `!catRow` |

### `f04f152e` — changed paths

| File | Function/Site | Change |
|------|--------------|--------|
| `src/components/modals/CreateSpecialConfigModal.tsx` | `<option value>` for Percentage row | `"Percentage Allocation"` → `"Percentage"` |
| `src/components/modals/CreateSpecialConfigModal.tsx` | pre-fill row normalisation | maps old `'Percentage Allocation'` → `'Percentage'` on load |
| `src/pages/CategoryLedger.tsx` | catRow lookup ~line 324 | adds `c.budget_portion === 'Percentage Allocation'` to filter |
| `src/pages/PercentageAllocation.tsx` | config-split loop ~line 125 | adds `&& row.budget_portion !== 'Percentage Allocation'` to skip guard (inverse: now included) |

### `1099cbb2` — changed paths

| File | Function/Site | Change |
|------|--------------|--------|
| `src/hooks/useSpecialConfigGroups.ts` | `createNewVersion()` | 35-line DB sequence → single RPC call |
| `src/hooks/useMutations.ts` | `useAddFXTransaction` | removed MISSING_COL_RE retry |
| `src/hooks/useMutations.ts` | `useBulkUpdateTransaction` | removed per-chunk strip loop; return type narrowed |
| `src/components/modals/BulkEditInflowModal.tsx` | execute result destructure | removed `strippedCols` usage |
| `src/components/modals/BulkEditOutflowModal.tsx` | execute result destructure | removed `strippedCols` usage |
| `src/components/modals/BulkEditIntraFlowModal.tsx` | execute result destructure | removed `strippedCols` usage |
| `supabase/migrations/20260606000003_security_fixes.sql` | new migration | adds `create_special_config_version` RPC and other fixes |
| `supabase/schema.sql` | multiple | ~405 duplicate policy lines removed; allocation_configs columns added |

---

## Recommended Minimum Revert Set

### Scenario A — Confirmed allocation/balance regressions (most likely)

Revert both **`28111fdb`** and **`f04f152e`** together. They are sequential on the same branch and both modify `CategoryLedger.tsx`; reverting either alone leaves the file in an inconsistent intermediate state.

```
git revert 28111fdb f04f152e --no-commit
# review, then commit
```

What this restores:
- Amount-type config rows return to 0-contribution (previous behaviour)
- 'Percentage Allocation' rows return to invisible in PercentageAllocation deposited totals
- CategoryLedger Percentage tab returns to pre-f04f152e matching
- PercentageAllocation.tsx line 125 guard reverts

What this does NOT touch:
- Security commit (`1099cbb2`) — left in place
- UX commits — left in place
- Import pipeline — unchanged

### Scenario B — Special config version creation is broken (migration not applied)

Revert only the `useSpecialConfigGroups.ts` portion of **`1099cbb2`**, restoring direct DB inserts:

```
git checkout 1099cbb2^ -- src/hooks/useSpecialConfigGroups.ts
```

This restores `createNewVersion` to the client-side multi-step path without requiring the RPC. Apply only if the `create_special_config_version` function does not exist in the live Postgres instance.

### Scenario C — Bulk update operations are failing hard (H8 side-effect)

If bulk edits (`BulkEditInflowModal`, etc.) are now throwing where they previously soft-failed, and reverting the allocation commits (Scenario A) is not sufficient:

Restore the MISSING_COL_RE retry in `useMutations.ts` and the `strippedCols` return in `useBulkUpdateTransaction`, and restore `strippedCols` consumption in the three BulkEdit modals.

This is a targeted partial revert of `1099cbb2` for the H8 changes only.

---

## Commits that should NOT be reverted

| Commit | Reason |
|--------|--------|
| `53a393eb` / `584fd155` | DB-only; no client allocation/import logic |
| `66cb3b2d` | UX only; no calculation paths |
| `f770606` | UI-only modal change; import pipeline unaffected |
| `95d5200f` | Import template is additive localStorage feature; core import pipeline unchanged |
| `2a60be1b` | Purely additive UI components |
| `1099cbb2` (C1-C6, H2-H6) | Security fixes; correct direction; no allocation regression |

---

## Verification Steps (post-revert, before re-deploying)

1. `npm run build` — must pass with zero type errors
2. `npm test` — securityFixes.test.ts must still pass (H8 tests will need updating if H8 is reverted)
3. Spot-check: load CategoryLedger for a category that has a percentage-type allocation config → Allocation column should match known-good values
4. Spot-check: load PercentageAllocation page → Total Allocated should match pre-regression values
5. Spot-check: load CategoryLedger for a category that has an amount-type special config → confirm allocation entries are not present (Scenario A revert) or are present (if Scenario A confirmed correct)
6. End-to-end import: run a test import through ImportModal — confirm column mapping, propagation into inflow/outflow tables, and stage_code_2 values are written correctly
7. Special config: attempt to create a new version → confirm no RPC error (Scenario B check)
