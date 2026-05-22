# Import Rules

## Import is the Sole Entry Point

**All transaction creation goes through `Import.tsx`.** Inflows and Outflows pages are display-only — no Add buttons, no import triggers. Edit and delete remain on those pages.

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

## `bank_name` Propagation During Import

- `ManualEntryForm` — `doSaveInflow` and `doSaveOutflow` resolve `bank_id` → `bank_name` before calling mutation
- `ImportModal.tsx` batch wizard — sets `bank_name` from the `bank` prop passed in from `Import.tsx` (the bank selected on the import page before opening the wizard)
- Transactions without `bank_name` set will **not appear in BankLedger**

## `stage_code_1` / `stage_code_2` in ManualEntryForm Outflow

- ManualEntryForm outflow form includes a **Budget Allocation** panel with:
  - `stage_code_1` — category dropdown (populated from live `categories` table)
  - `stage_code_2` — budget portion dropdown (`Percentage Allocation` | `Specific Seed` | `Savings`)
- Both passed to `doSaveOutflow` → `AddOutflowInput`; omitted if blank
- Setting `stage_code_1` is what links a manually-entered outflow to **CategoryLedger**
- Batch wizard outflow tab has per-row stage code dropdowns and a per-row **Pending Deduction** checkbox (column 7 of the debit grid)
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
5. **Query DB** — `Promise.all` over `inflow_transactions.transaction_ref IN (...)` and `outflow_transactions.transaction_id IN (...)` for all computed IDs
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

## Config Propagation Precedence (Import Modal)

**Resolver:** `src/utils/resolveImportConfig.ts` — single source of truth.

```ts
resolveFinalRowConfig({ manualConfigId, incomeTypeId, incomeTypes, generalConfigId }) → string | null
resolveConfigForIncomeType(incomeTypeId, incomeTypes) → string  // UI onChange helper
```

**`rowConfigs[ri]` semantics:**
- `undefined` (key absent) — no explicit decision; fall through to income type logic
- `''` (empty string) — user explicitly chose General
- `uuid` — user or propagation chose a specific special config

**Precedence (highest first):**
1. Manual/propagated override (`ri in rowConfigs`) — `''` maps to general; uuid maps to that config
2. Income type linked config (`incomeType.special_config_id`)
3. General date-based fallback (`getConfigForDate`)

**Critical:** `runImport` uses `ri in rowConfigs` (not truthiness) to detect any explicit decision. `''` must never be treated as "no decision" — it is an explicit choice of General. The old `if (overrideCfgId)` truthiness check caused `''` to fall through to the income type's linked config, overriding an explicit General selection.

**Per-row propagation:** Income type `onChange` calls `resolveConfigForIncomeType` and writes the linked config (or `''`) into `rowConfigs[ri]`. Next income type change overwrites. Manual config change overwrites too — and is preserved until next income type change.

**Auto-classified rows:** `displaySelId` uses `ri in rowConfigs` guard so rows with auto-detected income types show the linked config in the UI without polluting `rowConfigs` (runImport handles them via the income type branch directly).

**Bulk Apply:** Income type applied without an explicit config → propagates the linked config into `rowConfigs` for target rows. Explicit config always wins when both are set.

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
