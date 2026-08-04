# Import Rules

## Import is the Sole Entry Point

**All standard transaction creation goes through `Import.tsx`.** Inflows and Outflows pages are display-only — no Add buttons, no import triggers. Edit and delete remain on those pages.

**Exception — FX transactions:** All foreign currency transactions are entered exclusively through `ForeignCurrency.tsx` via `AddFXModal`. `Import.tsx` ManualEntryForm filters out FX banks and shows a redirect notice. See `ledger-rules.md → FX Transaction Entry` for enforcement details.

---

## Import Wizard Flow (`Import.tsx`)

5-step wizard:
1. Upload file (Excel `.xlsx` or PDF bank statement)
2. Parse
3. Map columns
4. Configure rows (allocation config, income type, FX fields per row)
5. Bulk insert

Also contains `ManualEntryForm` for single-transaction entry.

---

## Import Row Model (`ImportRow`)

**Types:** `src/types/importRow.ts` · **Builder:** `src/utils/buildImportRows.ts`

Per-row import state is **one object per (row, kind)**, not the ~11 parallel `Record<number, T>` maps it replaced. Built once in `proceedToRowConfig`.

```ts
ImportRow { ri, kind: 'inflow'|'outflow', date, amount, description, ref, txnId, isDuplicate, config, resolution }
```

- **`description` is the RAW statement text.** It is what is displayed, what is stored, and what is hashed. `normalizeNarration` output is for grouping/labelling only and must never reach storage, dedup, or matching.
- A row carrying both a credit and a debit produces **two** `ImportRow`s sharing one `ri` — mirroring the old separate inflow/outflow ID maps.
- **`ri` is stable** across the whole pipeline; restored per-row config realigns on re-parse of the same file.
- Legacy maps (`rowConfigs`, `rowStageCodes`, …) are still derived from the model for the Step 4 and `runImport` call sites not yet migrated. **Write to both when adding state.**

**Column indices are derived once** via `deriveColumnIndices` and carried on the model. Previously recomputed at seven sites — which is why the "four debit read-sites" rule existed. Do not re-derive them.

`parseNumber` / `parseDebitAmount` now live in `buildImportRows.ts`, shared with the component. `normalizeId` is imported from `src/utils/normalizeId.ts` — **there must not be a second local copy** (there was one; the copies matched, but divergence would have broken dedup silently).

### Completeness — drives the Step 4 split

**`isRowComplete(row)` decides the section, NOT the fact that an edit happened.**
Marking rows resolved on any control change meant picking a fund alone promoted a whole group to Sorted with two fields still blank.

| Kind | Complete when |
|---|---|
| Outflow | `stageCode1` **and** `stageCode2` **and** `outflowTypeId` — all three |
| Inflow | `incomeTypeId` set **and** `resolution` is `rule` or `manual` |
| Any non-Normal `txnType` | Always — these skip allocation by design |

`resolution` records *how* a value was arrived at, and gates inflows only:

| Value | Meaning |
|---|---|
| `unresolved` | Nothing resolved |
| `fallback` | Matched only the generic catch-all (no rule fired) — still needs attention |
| `rule` | A real keyword / stage-code rule matched |
| `manual` | User set it explicitly |

`resolveDefaultIncomeType` falls back to a catch-all income type, so nearly every credit row resolves to *something*. Counting that as sorted would swallow the whole file into "Sorted" on load — hence `fallback` does not count as complete.

**Every control that changes row config must call `applyToGroup`**, which writes the legacy `Record<number, T>` map *and* `importRows`. Writing only the legacy map leaves completeness un-recomputable and the row stuck in the wrong section.

**Golden test:** `src/utils/__tests__/importRowModel.golden.test.ts` reimplements the pre-refactor ID algorithm verbatim and asserts byte-identical output. Transaction IDs feed both dedup and insert; if this test fails, dedup has moved and the change must not ship.

---

## Step 4 Scale Rules

- **Rows load in sliding windows** (`RowWindowBar`, 50 at a time — "Load next" / "Load previous", no page numbers). **Select-all and bulk apply target the full filtered set, never the visible page** — narrowing them silently changes what a bulk action does.
- **Step 4 row lists are memoized** (`step4Rows`). They previously rebuilt and re-parsed every row on every render, so one keystroke in the filter box re-ran `parseDebitAmount` across the whole file.
- **Insert `BATCH` is 250** (a POST body). **`DEDUP_CHUNK_SIZE` stays 100** — that one is bounded by GET URL length, not throughput. Do not "align" them.
- Failed insert batches are collected into `ImportResult.failedRows` and offered as **Retry N failed row(s)**. Retry replays only those rows; already-inserted rows are untouched and IDs are unchanged, so retrying cannot duplicate.

---

## `recorded_at` at Import

**Not hardcoded to import time.** `recorded_at` is a reporting axis (`ReportBasis = 'transaction_date' | 'recorded_at'`, `ReportDateFilter.tsx`), so stamping a backdated statement with "now" skews every recorded-basis report.

Step 4 offers **Today** (default, previous behaviour) · **Specific date** · **Match each transaction's date**, plus a per-row override via the bulk apply bar (`rowRecordedDates`, which wins over the import-level setting).

Format is `${date}T00:00:00.000Z`, matching `BulkEditInflowModal.tsx`, `AddInflowModal.tsx` and `AddOutflowModal.tsx`. Note `recorded_at` is `timestamptz`, so midnight UTC renders as the previous day west of UTC — the existing modals share this, and diverging would be worse.

---

## Grouped View & Classification Rules

**Grouping:** `src/utils/groupImportRows.ts` · **UI:** `src/components/modals/import/GroupedRowList.tsx`

Third mode on `useViewToggle('import-step4-view', STEP4_VIEW_MODES)`. Opt-in — table view is unchanged and remains the default.

- Group key = `normalizeNarration(description)`. **Bucketing and labelling only.**
- Header shows the cleaned label **with the full raw sample directly beneath it**; expanding lists rows each showing their **own** raw description.
- A group's `configured` state is the **weakest** of its rows, so a group containing any unresolved row surfaces in Needs attention.
- Table and card views get the same concept via the **Needs attention only** filter toggle.

**Manual section override** — `manualGroupSections: Record<groupKey, 'sorted' | 'attention'>` beats the computed state in both directions, so a group can be forced Sorted while incomplete or pulled back after the fact. Overridden groups carry a `manual` badge; a forced-Sorted group must stay visibly distinct from one that earned it.

**Manual splitting** — `groupImportRows(rows, overrides, overrideLabels)` takes `ri → forced group key`. Rows with an override bypass narration bucketing entirely, keeping the splitting concern out of the narration logic. Split groups carry `isSplit` and a `split` badge. Session-only; cleared by `reset()`.

**Naming** — `stage_code_1` is **Fund**, `stage_code_2` is **Fund Type**. Values come from `BUDGET_PORTIONS` (`src/utils/constants.ts`): stored values stay `Percentage Allocation` / `Specific Seed` / `Savings`; labels are Regular Funds / Designated Gift / Savings. **Do not add a seventh inline copy of this mapping.** (`AddOutflowModal` and `BulkEditOutflowModal` still say "Category" — an app-wide rename is separate work.)

**Long lists load in sliding windows, not pages** — `RowWindowBar` (`src/components/ui/RowWindowBar.tsx`) for Step 4 rows, and the same idea inside an expanded group. The window replaces its contents rather than appending, so mounted row count stays flat however far the user goes. Verified: 564 → 565 DOM nodes across a "Load next 50" on a 997-row group.

**Outflow rules:** `outflow_classification_rules` table (mirrors `income_type_rules`) + `src/utils/classifyOutflow.ts` + `src/hooks/useOutflowClassificationRules.ts`.

- Precedence: rule match → `getDefaultOutflowTypeForCategory` (category map) → exact category-name match (the previous *sole* behaviour, now last).
- **Rules match the RAW description**, like `classifyIncomeType`. `rule_value` saved by "Save as rule" is the group's raw sample text, not the cleaned label.
- The hook degrades to an empty rule set if the table is missing, so an unmigrated org can still import.
- Registered in `schema.sql` in **six** places: table, RLS enable, four policies, two indexes, the org-lifecycle table list, and the org delete cascade (before `outflow_types`, its FK target).

---

## ImportModal Dismiss Guard & Session Autosave

### Dismiss guard

- **Backdrop:** permanently disabled (`disableBackdropClose` always passed to `Modal`). No click-outside close at any step.
- **Processing lock:** `isProcessing = importing || parsing || dupCheckLoading` → when true, `disableClose={true}` is passed to `Modal`, disabling X button, ESC, and backdrop entirely.
- **Dirty state:** `isDirty = !result && (step > 1 || fileName !== '' || sheets.length > 0)`. When dirty and not processing, X / ESC / Reset all show a confirm dialog.
- **Confirm dialog copy:** "Discard import progress?" / "Current import setup and unsaved work will be lost." / "Continue Import" / "Discard Changes".
- **Reset button** (header, visible at step > 1): guarded by `confirmingReset` state when dirty; calls `reset()` after confirmation.
- **Route change:** `useBlocker(open && isDirty && !isProcessing && !result)` — blocks React Router navigation; renders a portal confirm dialog at `z-[60]`.
- **Page refresh / tab close:** `beforeunload` handler added when `isDirty && !isProcessing`; removed on cleanup.

### Session autosave

- Key: `church-import-session` in `sessionStorage` (auto-cleared on browser/tab close). Payload is versioned — `v: 2`.
- **Bulk row data is NEVER persisted.** Saving `sheets` + `processedRows` meant serializing two full copies of the file on every state change: past ~5MB that threw `QuotaExceededError` into a swallowing `catch {}`, so crash recovery silently stopped working exactly when it was needed, and every checkbox click stalled the main thread.
- Saved: step, fileName, rowCount, mapping, dateFormat, fxCurrency, bankId/bankName, all per-row config maps, bsConfigTab, batchOffsetRole. **Debounced 500ms**, skipped while `importing`.
- Quota failures raise a **one-time toast** — never fail silently.
- **Restore:** runs once on `false→true` open transition (`prevOpenRef` guard), requires `v === 2 && fileName && step >= 2`. Applies mapping + per-row config, then shows a banner asking the user to re-select the file. Safe because `ri` is stable and fallback IDs are deterministic, so everything realigns on re-parse. Numeric-keyed `Record<number, T>` objects are re-keyed (JSON.parse coerces number keys to strings).
- **Session cleared** on: deliberate close (`handleClose` → `reset()`), explicit `reset()`, route-blocker "Discard Changes".
- **`preloadedFile` skips save/restore** — parent-provided file re-parses on open; session state would conflict.

---

## `bank_name` Propagation During Import

- `ManualEntryForm` — `doSaveInflow` and `doSaveOutflow` resolve `bank_id` → `bank_name` before calling mutation
- `ImportModal.tsx` batch wizard — sets `bank_name` from the `bank` prop passed in from `Import.tsx` (the bank selected on the import page before opening the wizard)
- Transactions without `bank_name` set will **not appear in BankLedger**
- **FX banks excluded from ManualEntryForm bank dropdowns** — banks with `is_foreign_currency = true` are filtered out of both inflow and outflow bank selectors. An amber notice links to `/foreign-currency` when at least one FX bank exists.
- **No FX amount/rate/currency fields** in ManualEntryForm — the previously present "Foreign Currency (optional)" panels (`fx_currency`, `fx_amount`, `fx_rate`) have been removed entirely.

## `stage_code_1` / `stage_code_2` in ManualEntryForm Outflow

- ManualEntryForm outflow form includes a **Budget Allocation** panel with:
  - `stage_code_1` — category dropdown (populated from live `categories` table)
  - `stage_code_2` — budget portion dropdown (`Percentage Allocation` | `Specific Seed` | `Savings`)
- Both passed to `doSaveOutflow` → `AddOutflowInput`; omitted if blank
- Setting `stage_code_1` is what links a manually-entered outflow to **CategoryLedger**
- Batch wizard outflow tab has per-row stage code dropdowns and a per-row **Pending Deduction** checkbox (column 7 of the debit grid)
- **`outflow_type_id` auto-mapping** (batch wizard): after `stage_code_1` is set for a row, `runImport` looks up `outflowTypeOptions` by case-insensitive name match and sets `outflow_type_id` if found — non-blocking, no UX change; `useOutflowTypeOptions()` called at modal top level
- Pending deduction state: `rowPendingDeductions: Set<number>` (by `ri`); bulk "Mark Pending" / "Clear Pending" buttons in the apply bar target selected rows or all filtered rows; `runImport` writes `is_pending_deduction = true` only for rows in the set

---

## Column Auto-Mapping (`autoMapColumn`, `ImportModal.tsx`)

- Called in `proceedToMapping` for every spreadsheet header; returns field key or `SKIP`
- Step 1: exact field key match (`f.key.replace(/_/g,'') === h`)
- Step 2: alias lookup via `ALIAS_MAP[f.key]`
  - Aliases **≤ 2 chars** (`'in'`, `'cr'`, `'dr'`): `startsWith` / `endsWith` only — **not** mid-word substring. Prevents short aliases stealing unrelated headers (e.g. `'in'` must not match `'maindr'` mid-word).
  - Aliases **> 2 chars**: exact OR `h.includes(alias)`

**`ALIAS_MAP` — bank_statement virtual fields:**
- `credit`: `credit`, `cr`, `deposit`, `deposits`, `inflow`, `in`, `income`, `incoming`, `inward`, `creditamt`
- `debit`: `debit`, `dr`, `withdrawal`, `withdrawals`, `outflow`, `out`, `payment`, `payments`, `charge`, `charges`, `debitamt`

**Do not add 2-char aliases to `credit` or `debit` without verifying they cannot appear as mid-word substrings in the other field's common headers.**

## Debit Amount Parsing (`parseDebitAmount`, `ImportModal.tsx`)

Banks store debit amounts in multiple sign conventions. `parseNumber` returns raw signed values and does not handle accounting notation, so **never use `parseNumber` on raw debit column cells** — use `parseDebitAmount` instead.

- Always returns unsigned magnitude (`Math.abs`)
- Handles accounting notation: `(1,000.00)` → `1000`
- Handles negative strings: `"-1,000.00"` → `1000`
- Handles positive strings: `"1,000.00"` → `1000` (no change)
- Returns `0` for null / empty / NaN

**Applied at all four debit read-sites:**
1. `proceedToRowConfig` — pre-scan debit rows for stage-code pre-population
2. Continuation-row merge guard — prevent debit rows being mislabelled
3. `runImport` main loop — `amount_disbursed` value + `debit > 0` gate
4. Step 4 IIFE `allRows` map — feeds the Debit (Outflows) tab list

Credit uses `parseNumber` (unchanged) — credits are always stored as positive.

---

## Header Detection (`detectHeaderRow`)

Exported from `ImportModal.tsx`; used by both the modal and `Import.tsx`'s pre-modal duplicate check.

Algorithm:
- Scans first 15 rows
- Scores each row by counting cells matching known field aliases (date, description, credit, debit, balance, reference, etc.)
- Returns index of best-scoring row (minimum 2 alias matches); falls back to row 0

**Both parse paths must use `detectHeaderRow`** — hardcoding `rows[0]` causes wrong row counts, missing column detection, and broken duplicate IDs for statements with title/metadata rows above the actual headers.

---

## Continuation Row Merging (`ImportModal.tsx`, bank statement mode)

Some bank statement Excel files split a single transaction across two rows — the narration or reference overflows into the next row, which has no date and no amount.

Pre-pass algorithm:
1. Build shallow copy of sheet rows (`merged`)
2. Scan each row: if no valid date, no credit, no debit, but has non-empty description or reference text → it's a continuation row
3. Append its text (space-separated) to the nearest preceding row with a valid date
4. Apply `normalizeId()` to every description cell (strips invisible Unicode, collapses whitespace, trims)
5. Store result in `processedRows` state

Row indices are preserved — per-row UI state (income type, stage codes, allocation config) remains correct. Normal imports with no continuation rows are unaffected.

**Timing:** Merging and normalization happen in `proceedToRowConfig` (Step 3→4 transition), **before** Step 4 renders. `runImport` consumes `processedRows` directly — no second merge pass. This ensures descriptions shown in Step 4 match exactly what is hashed for fallback transaction ID generation.

- `processedRows` is reset to `null` in `reset()` alongside all other Step 4 state
- Fallback: `runImport` uses `processedRows ?? sheet.rows` defensively if state is somehow missing

---

## Import Pipeline Order (`proceedToRowConfig`, bank_statement mode)

`proceedToRowConfig` is **async** — it runs a full duplicate-detection pipeline before advancing to Step 4. Step 4 receives **only genuinely new transactions**.

Pipeline stages (all before Step 4 opens):
1. **Merge continuation rows** — append overflow narration/reference rows to preceding dated row
2. **Normalize descriptions** — `normalizeId()` on every description cell; stored in `processedRows`
3. **Pre-populate `rowStageCodes`** — seed stage codes from mapped spreadsheet columns for debit rows
4. **Generate fallback IDs AFTER normalization** — SHA-256 hashes from normalized description + date + amount + bank; stored in `precomputedInflowIds` / `precomputedOutflowIds` (separate maps for inflow `transaction_ref` and outflow `transaction_id`)
5. **Query DB** — `fetchExistingTransactionIds()` (`src/utils/dedupQuery.ts`) over `inflow_transactions.transaction_ref` and `outflow_transactions.transaction_id` for all computed IDs
6. **Merge `skipTxnIds`** from `Import.tsx` pre-stage into existing-ID sets
7. **Build `duplicateRis: Set<number>`** — row indices confirmed as DB duplicates
8. **Compute `dupStats`** — `{ total, newCount, dupCount }` shown in Step 4 summary banner
9. **Advance to Step 4** — only after all above completes

**State set by this pipeline:**

| State | Type | Purpose |
|---|---|---|
| `precomputedInflowIds` | `Record<number, string>` | Per-row inflow ID (bank ref or fallback hash) |
| `precomputedOutflowIds` | `Record<number, string>` | Per-row outflow ID (bank ref or fallback hash) |
| `duplicateRis` | `Set<number>` | Row indices excluded from Step 4 and `runImport` |
| `dupStats` | `{ total, newCount, dupCount }` | Drives summary banner in Step 4 |
| `dupCheckLoading` | `boolean` | Loading spinner on Step 3 NavButton during DB check |

**Step 4 filtering:** `creditRows` and `debitRows` in the Step 4 IIFE filter `!duplicateRis.has(r.ri)` — duplicates are not rendered, not configurable, not counted.

### Dedup DB queries — MUST be chunked + error-checked

- **Never pass a full ID list to one `.in()` filter.** PostgREST sends `.in()` in the GET query string; ~800 fallback SHA-256 IDs (64 hex chars) ≈ 50KB URL → exceeds server URL limits → request fails. If the error is ignored, `data ?? []` = empty set → **every existing transaction reported as new** (July 2026 bug: 772/800 "new" on re-import).
- **Sole helper:** `fetchExistingTransactionIds(table, column, ids, bankName)` in `src/utils/dedupQuery.ts` — chunks via `chunkIds()` (`src/utils/chunkIds.ts`, 100 IDs/chunk), normalizes results, **throws on any query error**.
- Both dedup call sites use it: `ImportModal.tsx` `proceedToRowConfig` Stage 4 and `Import.tsx` pre-modal check.
- **On error:** `proceedToRowConfig` catches → sets `dupCheckError` → stays on Step 3 (red banner, retry via NavButton). `Import.tsx` catch → `dupError` state → red banner; green "no duplicates" banner is gated on `!dupError`.
- Tests: `src/utils/__tests__/chunkIds.test.ts`.

**`runImport` integration:**
- Skips `duplicateRis.has(ri)` rows (`skipped++; continue`) at loop entry
- Uses `precomputedInflowIds[ri] ?? generateFallbackTransactionId(...)` — same ID used for dedup, preventing drift; within-batch collision suffix logic still applies
- `allSkipIds` (from `skipTxnIds`) retained as safety net

**UX in Step 4:** Amber/green summary banner — "X rows · Y already in database · Z new to configure". Collapsible "View skipped" shows each duplicate's row number, date, description, and amount. Step 3 NavButton shows "Checking for duplicates…" spinner during async check.

---

## Supported File Types

- **Excel** — parsed with `xlsx`
- **PDF bank statements** — parsed with `pdfjs-dist` via `src/utils/pdfParser.ts`

---

## Auto-Classification

`classifyIncomeType.ts` exports `matchIncomeType()` — a rule engine that auto-classifies inflows during import based on keyword/stage-code rules defined in `income_type_rules`.

---

## Auto-Assignment & Resume

**Every view must bind config selects to the RESOLVED value** (`buildInflowRowData().displaySelId`), never to the raw `rowConfigs[ri]` override. The grouped view bound to the raw override, so a distribution rule linked to an auto-assigned income type never appeared — every inflow read "General (date-based)".

**The date-based general config is the empty option.** `displaySelId` collapses `resolved === generalConfigId` to `''`. Leaving the UUID in place made the dropdown render a second option carrying the config's own name ("General") next to "General (date-based)" — two entries meaning the same thing.

**Outflow type carries its fund** — `getCategoryForOutflowType` (`src/hooks/useOutflowTypes.ts`) resolves the reverse of `category_outflow_type_map` and returns a category **only when exactly one** maps to that outflow type. With several there is nothing to infer, so the fund is left alone. All outflow-type controls go through `applyOutflowTypeToRows`.

### Interrupted-import resume

**Helper:** `src/utils/importSession.ts` — `readImportSession`, `clearImportSession`, `describeSavedAt`, and the shared `IMPORT_SESSION_KEY`.

- Autosave now also persists `manualGroupSections`, `groupOverrides`, `groupOverrideLabels`, `recordedMode`, `recordedDate` and `rowRecordedDates`. All are small and string/number-keyed, so the v2 no-bulk-data rule still holds.
- `Import.tsx` shows a **"Continue ongoing import?"** banner whenever a resumable session exists and the wizard is closed — this is what makes a swipe-back or tab crash recoverable, not just an X click.
- `readImportSession` returns null for `step < 2` or a missing filename: an import that never got past choosing a file has nothing to resume and would only be noise.
- **A deliberate discard clears the session** (`reset()` → `clearImportSession()`), as does a completed import. Everything else is kept — the user did not choose to lose it.

---

## Config Propagation Precedence (Import Modal)

**Resolver:** `src/utils/configResolver.ts` — single source of truth for all config resolution.

```ts
getFinalConfig(rowState: RowResolverState, generalConfigId, resolveGroupConfig?) → string | null
resolveConfigForIncomeType(incomeType, generalConfigId, resolveGroupConfig?) → string | null
resolveDefaultIncomeType(description, stageCode1, incomeTypes, userPrefs?) → IncomeType | null
```

**`RowResolverState`:**
```ts
{ incomeType: IncomeType | null; allocationConfigId: string; isManualOverride: boolean }
```

**`getFinalConfig` precedence (highest first):**
1. `isManualOverride = true` → `allocationConfigId` (falls back to `generalConfigId` when blank)
2. Income type is catch-all (zero rules) → always `generalConfigId` regardless of any linked config
3. `incomeType.special_config_id` (direct linked config)
4. `incomeType.special_config_group_id` → `resolveGroupConfig(groupId)` when provided
5. `generalConfigId` (date-based general config)

**Column order:** Step 4 shows **Income Type before Distribution Rule** (row grid, card view and apply bar). The income type's linked config determines the rule, and changing it clears `isManualOverride` — showing the rule first put the effect before its cause.

**`isManualOverride` flag:**
- Set to `true` only when the user explicitly changes the Allocation Config dropdown for a row
- Cleared whenever Income Type changes → new type's linked config auto-applies
- `rowManualOverrides: Record<number, boolean>` — stored separately from `rowConfigs`

**`resolveGroupConfig` callback:**
- Required to handle income types linked via `special_config_group_id` (versioned config groups)
- Step 4 display: `(groupId) => getSpecialConfigVersionForDate(allocConfigs, groupId, rowDate)?.id ?? null`
- `runImport`: same pattern using the transaction's actual `date`
- Both passed as third arg to `getFinalConfig`

**`resolveDefaultIncomeType` fallback chain:**
1. Keyword / stage-code rule match via `classifyIncomeType`
2. `userPrefs.defaultIncomeTypeId` if provided
3. Catch-all: first income type with zero rules (no keyword/stage rules = General)
4. `null`

**Per-row state:**
- `rowIncomeTypes[ri]` — explicit user override of income type; absent = auto-classified
- `rowConfigs[ri]` — explicit config value when `isManualOverride=true`; otherwise ignored
- `autoClassifiedTypes` — `useMemo` map of `ri → IncomeType | null` computed once from `processedRows` + `incomeTypes`

**Allocation configs reload:** `useAllocationStore.reload()` called every time the modal opens to ensure group config versions are always fresh.

**Bulk Apply bar:**
- Income type selected → `applyInflowConfig` auto-derives from linked config (`special_config_id` → direct UUID; `special_config_group_id` → `getSpecialConfigVersionForDate` with today's date)
- Config selected explicitly → marks all target rows as `isManualOverride = true`
- Income type applied without explicit config → clears `isManualOverride` for target rows so per-row `getFinalConfig` derives the linked config automatically
- `applyBarSpecialConfigs` memo: deduplicates versioned group configs — only the today-active version per group appears in the dropdown (prevents multiple "Config 2024 / Config 2025" entries)

**`src/utils/resolveImportConfig.ts`:** Backward-compat shim; re-exports everything from `configResolver.ts`. `resolveFinalRowConfig` is deprecated — delegates to `getFinalConfig` internally.

---

## Missing Column / Schema Cache Error Handling

Both import paths use a **strip-and-retry** pattern when PostgREST rejects an INSERT due to a missing or cache-invisible column.

### `ImportModal.tsx` (batch wizard)
- `MISSING_COL_SQL` map: keyed by column name → migration SQL string shown in the results panel after retry
  - Entries: `allocation_config_id`, `income_type_id`, `recorded_at` (full ALTER + backfill + indexes + NOTIFY)
- Regex: `/Could not find (?:the ')?(\w+)'? column/` — matches both PostgREST formats:
  - Old: `Could not find the 'col' column of 'table' in the schema cache`
  - v12+: `Could not find col column in table schema cache`
- On match: strips the column from the batch, retries INSERT, pushes migration hint into `errors[]`

### `Import.tsx` ManualEntryForm (`doSaveInflow` / `doSaveOutflow`)
- Same regex (`MISSING_COL_RE`) defined at component scope
- Input built as typed `AddInflowInput` / `AddOutflowInput` variable (not inline object literal)
- On catch: extracts missing column name → deletes from a spread copy → retries mutation → toasts warning directing user to Setup → Database migration
- Only strips columns present in the input object; unrelated errors re-throw

---

## Transaction ID Normalization (`normalizeId`)

**Utility:** `src/utils/normalizeId.ts` — shared between `Import.tsx` and `ImportModal.tsx`.

```ts
export function normalizeId(raw: string): string {
  return raw
    .normalize('NFC')
    .replace(/\u00ad|\u00a0|\u200b|\u200c|\u200d|\u2028|\u2029|\ufeff/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}
```

**Apply at every ID touch-point:**

| Location | Where |
|---|---|
| `Import.tsx` pre-modal check | File row extraction → `normalizeId(String(raw))` |
| `Import.tsx` pre-modal check | DB results → `normalizeId(r.transaction_ref/id)` before push to `found[]` |
| `ImportModal.tsx` `proceedToRowConfig` | Bank-provided ref → `normalizeId(String(raw[refIdx])) \|\| null` |
| `ImportModal.tsx` `proceedToRowConfig` | DB result normalization → `normalizeId(r.transaction_ref/id)` |
| `ImportModal.tsx` `proceedToRowConfig` | `skipTxnIds` merge → `normalizeId(id)` per entry |
| `ImportModal.tsx` `runImport` | File ref extraction → `normalizeId(String(raw[refIdx])) \|\| null` |
| `ImportModal.tsx` `runImport` | `skipTxnIds` safety net → `[...skipTxnIds].map(normalizeId)` |

**Why:** Excel cells carry invisible Unicode (zero-width spaces, soft hyphen, NBSP, BOM) that survive `.trim()`. `Set.has()` is byte-exact — a visually-identical ID with a hidden character fails dedup silently.

**`skipTxnIds` is `Set<string>`, not an array.** Always spread before calling `.map()`:
- ✅ `skipTxnIds ? [...skipTxnIds].map(normalizeId) : []`
- ❌ `(skipTxnIds ?? []).map(normalizeId)` — `Set` has no `.map()`, throws at runtime and causes 0 rows imported

**Never use literal Unicode chars in the regex** — esbuild rejects them in character class ranges. Use `\uXXXX` escape sequences.

---

## Fallback Transaction ID Generation

When a row has no bank-provided reference, a deterministic SHA-256 ID is generated as a fallback — never overwriting an existing value.

**Utility:** `src/utils/generateTransactionId.ts` → `generateFallbackTransactionId(date, amount, description, bankName)`
- Inputs lowercased and trimmed before hashing
- Same inputs always produce the same ID (idempotent across imports)
- Output is a hex string — no invisible chars; `normalizeId` is not required on its output

**Import wizard (`ImportModal.tsx`):**
- **Generated in `proceedToRowConfig` (Step 3→4), not in `runImport`** — IDs are computed after description normalization, before Step 4 renders, and stored in `precomputedInflowIds` / `precomputedOutflowIds`.
- This ensures the same ID is used for both duplicate detection (Step 3→4 DB query) and actual insert (`runImport`), preventing drift.
- `runImport` reads `precomputedInflowIds[ri]` / `precomputedOutflowIds[ri]`; falls back to on-the-fly generation as a safety net.
- **Within-batch collision suffix:** if two rows in the same batch hash identically, the second gets `hash-1`, third `hash-2`, etc. (tracked by `inflowIdCounts`/`outflowIdCounts` Maps). Suffixed IDs flag potential duplicates for manual review.
- **Result panel visibility:** `ImportResult` carries `fallbackIdCount: number` and `collisions: string[]`. After import: blue line shows fallback count; amber section lists each collision-suffixed row (`type | date | amount | description | …last-10-chars-of-id`). Both hidden when zero.

**Manual entry (`Import.tsx`):** `doSaveInflow` and `doSaveOutflow` generate a fallback when the user leaves Transaction Ref/ID blank.

---

## Narration Normalization (`normalizeNarration`)

**Utility:** `src/utils/normalizeNarration.ts` — converts raw bank narration strings to clean `display_description` values for UI display.

**Pipeline order** (each step feeds the next):
1. `normalizeId()` — strip invisible Unicode, NFC, collapse whitespace
2. `extractSlashSegments()` — if first slash-segment is a known channel code (`TRF`, `USSD`, `APP`, `WEB`, `MOB`, `NIP`, `FIP`), strip it and strip the last segment when ≥3 parts (assumed reference token)
3. `extractSpecialPrefix()` — detect `VAT` or `COMM`/`COMMISSION` prefix; strip it and pass remainder to `extractTargetName()`
4. `cleanCoreNarration()` — transfer pattern (`NIP TRANSFER TO …`), POS pattern, then general leading-keyword/trailing-noise strip

**NEVER use `normalizeNarration` output for deduplication, reconciliation, or audit matching** — those paths must use the raw `description` / `bank_description` fields directly.

### `extractSpecialPrefix` — COMM/VAT separator formats

Handles both connector styles:
- `COMM ON …` / `COMMISSION FOR …` / `VAT ON …` (keyword connector)
- `COMM - …` / `VAT - …` (dash separator — common in GT Bank statements)

Strip regexes:
```
VAT:  /^VAT(?:\s*-\s*|\s+(?:ON|FOR|FROM|CHARGE[SD]?)?\s*)/i
COMM: /^COMM(?:ISSION)?(?:\s*-\s*|\s+(?:ON|FOR|FROM|CHARGE[SD]?)?\s*)/i
```

### `extractSemanticSlashSegment()` — slash narrations inside COMM/VAT context

Called from `extractTargetName()`. Handles the pattern `To <bank>/Description/PayeeName` that appears in COMM/VAT remainders.

**Rules:**
- Strip leading segment if it matches `To <single-word>` (routing label: To pay, To Gtb, To Opay, To PalmPay, To Kuda, To Moniepoint, To Access, To Uba, To Zenith, To Firstbank, To Sterling, To Fidelity)
- Strip trailing segment **only when** (a) a routing prefix was present, (b) ≥2 segments remain after prefix strip, and (c) `looksLikePersonOrBeneficiary()` returns true (2–5 uppercase-initial tokens, no digits)
- Plain slash narrations without a routing prefix are **untouched** — `School Fees/May Session` stays unchanged

**Key examples:**

| Input (remainder after COMM/VAT strip) | Output |
|---|---|
| `To pay/Volunteers Tag - God-encounters Benin/Alice Oyepeju Adeoti` | `Volunteers Tag - God-encounters Benin` |
| `To Gtb/Fuel Purchase/John Doe` | `Fuel Purchase` |
| `To Opay/Monthly Salary/Chinedu Okafor` | `Monthly Salary` |
| `To Gtb/Monthly Salary` | `Monthly Salary` |
| `School Fees/May Session` | `School Fees/May Session` (untouched) |

**Full pipeline examples:**

| Raw narration | `display_description` |
|---|---|
| `COMM - To pay/Volunteers Tag - God-encounters Benin/Alice Oyepeju Adeoti` | `COMM - Volunteers Tag - God-encounters Benin` |
| `VAT - To Gtb/Fuel Purchase/John Doe` | `VAT - Fuel Purchase` |
| `COMMISSION ON TRANSFER TO JANE` | `COMM - Jane` |
| `VAT ON NIP TRANSFER TO JOHN DOE` | `VAT - John Doe` |
| `NIP TRANSFER TO JOHN DOE REF 48291 SUCCESSFUL` | `Transfer - John Doe` |
| `POS PAYMT SHOPRITE IKEJA TERMINAL 22391` | `POS - Shoprite Ikeja` |
| `TRF MOBILE/Fuel 30/Bvshrjrb` | `Fuel 30` |

---

## `runImport` Safety Rules

- **Always wrap the full `runImport` body in `try/finally`** with `setImporting(false)` in the `finally` block. Any unhandled exception (network error, `crypto.subtle` failure, Supabase timeout) otherwise leaves `importing=true` forever — spinner rolls indefinitely, no result shown, no way to recover without closing the modal.
- **Primary dedup:** `duplicateRis.has(ri)` skip at loop entry — rows identified by the Step 3→4 DB check are skipped before any processing.
- **Safety net:** `allSkipIds` built from `skipTxnIds` (Import.tsx pre-stage) filters any remaining duplicates after `inflowRows`/`outflowRows` are built. Redundant with `duplicateRis` in normal flow but retained for edge cases.
- **Precomputed IDs:** `precomputedInflowIds[ri] ?? generateFallbackTransactionId(...)` — uses the ID generated at Step 3→4 transition; falls back to on-the-fly generation if missing. Within-batch collision suffix (`-1`, `-2`) still applies.

---

## Non-Normal Transaction Import Rule

**Transaction types:** `''` = Normal | `'refund'` | `'reversal'` | `'bank_deposit'` | `'intrabank_transfer'`

> `fx_inflow` and `fx_outflow` have been **removed** from `TXN_TYPE_OPTIONS` in both `Import.tsx` and `ImportModal.tsx`. FX transactions are entered exclusively through the FX module (`ForeignCurrency.tsx`).

**Rule:** If `transactionType !== ''` (i.e. any non-Normal type):
- Skip all allocation — do **not** set `allocation_config_id` (no general config, no income-type-linked config, no date-based fallback)
- Save the transaction record only
- Account assignment can be done later via the inflow/outflow edit modal

Applies to both:
- `ImportModal.tsx` batch wizard — guarded with `if (!txnType)` before config resolution block (inflow) and `if (!txnType && cfg)` (outflow)
- `Import.tsx` ManualEntryForm — `effectiveConfigId` set to `undefined` when `txnType` is set (inflow); `txnType ? undefined : getConfigForDate(...)` (outflow)

---

## Special Config Creation — Step 4 Integration

`CreateSpecialConfigModal` is rendered alongside `ImportModal` with `mode="new_group"`. The `onSaved(cfg)` callback **must** receive the created `AllocationConfig` — `ImportModal` uses it to:
1. Add the config to the `specialConfigs` dropdown immediately (no refetch)
2. Auto-select it for the triggering row (`createConfigPendingRow`)

- `createConfigPendingRow` tracks context: `'apply'` = bulk inflow apply, `number` = per-row assignment, `null` = standalone open
- `createGroupWithFirstVersion` returns `{ groupId, config: AllocationConfig }` — the config is the full DB row from `.select('*').single()` on the insert, available immediately without a second fetch
- **Never call `onSaved()` without the arg** in the `new_group` path — `ImportModal`'s callback guards on `!cfg` and silently exits, leaving the dropdown stale
