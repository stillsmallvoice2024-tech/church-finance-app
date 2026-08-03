// ── Import row grouping ──────────────────────────────────────────────────────
//
// A 10,000-row bank statement typically contains only 50–200 distinct narration
// patterns. Configuring patterns instead of rows is what turns a 10k import
// from thousands of dropdown interactions into a few dozen.
//
// The grouping key comes from `normalizeNarration`, which already exists and is
// used by useTransactions / Outflows / useDashboard for display.
//
// IMPORTANT — the cleaned narration is used for BUCKETING AND LABELLING ONLY.
// It never reaches storage, deduplication or hashing, and it never replaces the
// raw description on a row: `sampleRaw` carries the full statement text so the
// group header can show it verbatim beneath the cleaned label, and each row
// still renders its own untouched `description`.
// See import-rules.md: "NEVER use normalizeNarration output for deduplication,
// reconciliation, or audit matching".

import { normalizeNarration } from './normalizeNarration'
import type { ImportRow } from '../types/importRow'
import { needsAttention } from '../types/importRow'

export interface ImportRowGroup {
  /** Bucketing key — cleaned narration, or a stable placeholder when blank. */
  key:       string
  /** Header label. Same as `key`; shown with `sampleRaw` directly beneath it. */
  label:     string
  /** FULL raw description of the first member row, displayed verbatim. */
  sampleRaw: string
  ris:       number[]
  rows:      ImportRow[]
  count:     number
  /** Summed amount across the group, for the header. */
  total:     number
  /** True when every row in the group is resolved — drives the section split. */
  configured: boolean
}

const NO_DESCRIPTION = '(no description)'

/**
 * Group rows by cleaned narration, largest group first.
 *
 * A group's `configured` state is the weakest of its rows: any group still
 * containing an unresolved or catch-all-only row surfaces in "Needs attention"
 * rather than hiding behind its already-configured siblings.
 */
export function groupImportRows(rows: ImportRow[]): ImportRowGroup[] {
  const byKey = new Map<string, ImportRowGroup>()

  for (const row of rows) {
    const cleaned = row.description ? normalizeNarration(row.description) : ''
    const key = cleaned || row.description || NO_DESCRIPTION

    let group = byKey.get(key)
    if (!group) {
      group = {
        key,
        label:      key,
        sampleRaw:  row.description || NO_DESCRIPTION,
        ris:        [],
        rows:       [],
        count:      0,
        total:      0,
        configured: true,
      }
      byKey.set(key, group)
    }

    group.ris.push(row.ri)
    group.rows.push(row)
    group.count += 1
    group.total += row.amount
    if (needsAttention(row)) group.configured = false
  }

  return [...byKey.values()].sort((a, b) =>
    b.count - a.count || b.total - a.total || a.key.localeCompare(b.key),
  )
}

/** Split groups into the two Step 4 sections. */
export function splitGroups(groups: ImportRowGroup[]): {
  needsAttention: ImportRowGroup[]
  sorted:         ImportRowGroup[]
} {
  return {
    needsAttention: groups.filter(g => !g.configured),
    sorted:         groups.filter(g =>  g.configured),
  }
}
