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
1. Build shallow copy of sheet rows (`mergedRows`)
2. Scan each row: if no valid date, no credit, no debit, but has non-empty description or reference text → it's a continuation row
3. Append its text (space-separated) to the nearest preceding row with a valid date
4. Main loop iterates `mergedRows`; continuation rows are skipped (no date), but primary row carries complete merged text

Row indices are preserved — per-row UI state (income type, stage codes, allocation config) remains correct. Normal imports with no continuation rows are unaffected.

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

## Fallback Transaction ID Generation

When a row has no bank-provided reference, a deterministic SHA-256 ID is generated as a fallback — never overwriting an existing value.

**Utility:** `src/utils/generateTransactionId.ts` → `generateFallbackTransactionId(date, amount, description, bankName)`
- Inputs lowercased and trimmed before hashing
- Same inputs always produce the same ID (idempotent across imports)

**Import wizard (`ImportModal.tsx`):**
- Applied inside the row-building loop via `if (!row.transaction_ref)` / `if (!row.transaction_id)`
- **Within-batch collision suffix:** if two rows in the same batch hash identically, the second gets `hash-1`, third `hash-2`, etc. (tracked by `inflowIdCounts`/`outflowIdCounts` Maps). Suffixed IDs flag potential duplicates for manual review.
- **Cross-batch duplicate detection:** after all rows are built, `runImport` queries the DB for all pending `transaction_ref`/`transaction_id` values (bank-provided + fallback) and adds matches to `allSkipIds` before the filter step. Re-importing identical data is fully skipped.

**Manual entry (`Import.tsx`):** `doSaveInflow` and `doSaveOutflow` generate a fallback when the user leaves Transaction Ref/ID blank.

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
