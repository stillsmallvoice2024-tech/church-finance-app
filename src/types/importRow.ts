// ── Import row model ─────────────────────────────────────────────────────────
//
// One object per spreadsheet row, replacing the parallel `Record<number, T>`
// maps that previously held per-row import state (rowConfigs, rowStageCodes,
// rowIncomeTypes, rowTxnTypes, precomputed*Ids, duplicateRis, …).
//
// Built once in `proceedToRowConfig` (Step 3→4), which is already the
// normalize-everything checkpoint: continuation-row merge → description
// normalization → stage-code prepopulation → ID generation → duplicate check.
//
// `description` is the RAW statement text. It is what gets displayed, what gets
// stored, and what gets hashed for transaction IDs. `normalizeNarration` output
// is used for grouping/labelling only and never reaches any of those paths.

/** How a row's income type / stage codes were arrived at. Drives the Step 4 split. */
export type RowResolution =
  /** Nothing resolved — no income type, no stage code. */
  | 'unresolved'
  /** Resolved only by the generic catch-all fallback (no rule actually fired). */
  | 'fallback'
  /** A real keyword / stage-code rule matched. */
  | 'rule'
  /** The user set it explicitly. */
  | 'manual'

export interface ImportRowConfig {
  allocationConfigId: string
  incomeTypeId:       string
  isManualOverride:   boolean
  stageCode1:         string
  stageCode2:         string
  outflowTypeId:      string
  txnType:            string
  origTxnId:          string
  isPendingDeduction: boolean
  /** null = inherit the import-level recorded-date setting. */
  recordedAt:         string | null
}

export interface ImportRow {
  /** Index into the merged sheet rows. Stable across the whole pipeline. */
  ri:          number
  kind:        'inflow' | 'outflow'
  date:        string
  amount:      number
  /** RAW description exactly as it appears in the statement file. */
  description: string
  /** Bank-provided reference, normalized; null when the statement had none. */
  ref:         string | null
  /** Bank ref or deterministic fallback hash. Used for dedup AND insert. */
  txnId:       string
  isDuplicate: boolean
  config:      ImportRowConfig
  resolution:  RowResolution
}

/** Column indices derived once from the header→field mapping. */
export interface ColumnIndices {
  date:    number
  desc:    number
  credit:  number
  debit:   number
  ref:     number
  s1:      number
  s2:      number
  balance: number
}

export function emptyRowConfig(): ImportRowConfig {
  return {
    allocationConfigId: '',
    incomeTypeId:       '',
    isManualOverride:   false,
    stageCode1:         '',
    stageCode2:         '',
    outflowTypeId:      '',
    txnType:            '',
    origTxnId:          '',
    isPendingDeduction: false,
    recordedAt:         null,
  }
}

/**
 * Is every field this row needs actually filled in?
 *
 * Completeness is read off the row's own config, never off the fact that an
 * edit happened. Marking a row resolved the moment any control changed meant
 * picking a fund alone promoted the whole group to Sorted with two fields
 * still blank.
 */
export function isRowComplete(row: ImportRow): boolean {
  // Non-Normal transaction types skip allocation entirely by design
  // (import-rules.md → Non-Normal Transaction Import Rule), so they must not
  // be held back for fields they will never have.
  if (row.config.txnType) return true

  if (row.kind === 'outflow') {
    return !!(row.config.stageCode1 && row.config.stageCode2 && row.config.outflowTypeId)
  }

  // Inflow: an income type arrived at by a real rule or set by hand. A
  // catch-all-only match stays `fallback` and still wants a look.
  return !!row.config.incomeTypeId && row.resolution !== 'unresolved' && row.resolution !== 'fallback'
}

/** Rows still needing the user's attention — drives the Step 4 section split. */
export function needsAttention(row: ImportRow): boolean {
  return !isRowComplete(row)
}
