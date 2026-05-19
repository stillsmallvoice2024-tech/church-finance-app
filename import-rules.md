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
- Batch wizard outflow tab already has per-row stage code dropdowns (unchanged)

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

## Supported File Types

- **Excel** — parsed with `xlsx`
- **PDF bank statements** — parsed with `pdfjs-dist` via `src/utils/pdfParser.ts`

---

## Auto-Classification

`classifyIncomeType.ts` exports `matchIncomeType()` — a rule engine that auto-classifies inflows during import based on keyword/stage-code rules defined in `income_type_rules`.

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
| `ImportModal.tsx` `runImport` | File ref extraction → `normalizeId(String(raw[refIdx])) \|\| null` |
| `ImportModal.tsx` `runImport` | `skipTxnIds` → `[...skipTxnIds].map(normalizeId)` |

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
- Applied inside the row-building loop via `if (!row.transaction_ref)` / `if (!row.transaction_id)`
- **Within-batch collision suffix:** if two rows in the same batch hash identically, the second gets `hash-1`, third `hash-2`, etc. (tracked by `inflowIdCounts`/`outflowIdCounts` Maps). Suffixed IDs flag potential duplicates for manual review.
- **Result panel visibility:** `ImportResult` carries `fallbackIdCount: number` and `collisions: string[]`. After import: blue line shows fallback count; amber section lists each collision-suffixed row (`type | date | amount | description | …last-10-chars-of-id`). Both hidden when zero.

**Manual entry (`Import.tsx`):** `doSaveInflow` and `doSaveOutflow` generate a fallback when the user leaves Transaction Ref/ID blank.

---

## `runImport` Safety Rules

- **Always wrap the full `runImport` body in `try/finally`** with `setImporting(false)` in the `finally` block. Any unhandled exception (network error, `crypto.subtle` failure, Supabase timeout) otherwise leaves `importing=true` forever — spinner rolls indefinitely, no result shown, no way to recover without closing the modal.
- **Duplicate skip set** (`allSkipIds`) is built exclusively from `skipTxnIds` (passed from `Import.tsx` pre-import check). No in-wizard DB queries during import. `allSkipIds = new Set(skipTxnIds ? [...skipTxnIds].map(normalizeId) : [])`.
- **In-wizard dup check removed.** The previous `proceedToImport` async DB queries and cross-batch check were removed — they blocked the Start Import button via `wizardDupLoading` and could hang indefinitely on slow DB responses.

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
