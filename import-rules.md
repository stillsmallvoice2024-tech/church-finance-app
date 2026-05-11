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
