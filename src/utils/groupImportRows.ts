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
  /** True when this group exists because the user split rows out by hand. */
  isSplit:    boolean
}

const NO_DESCRIPTION = '(no description)'

/**
 * Group rows by cleaned narration, largest group first.
 *
 * A group's `configured` state is the weakest of its rows: any group still
 * containing an unresolved or catch-all-only row surfaces in "Needs attention"
 * rather than hiding behind its already-configured siblings.
 */
export function groupImportRows(
  rows: ImportRow[],
  /**
   * Manual overrides: `ri → forced group key`. Rows listed here bypass
   * narration bucketing entirely, which is how "split these rows out" works
   * without the splitting concern leaking into the narration logic.
   */
  overrides?: Map<number, string>,
  /** Display labels for split groups, keyed by the forced group key. */
  overrideLabels?: Map<string, string>,
): ImportRowGroup[] {
  const byKey = new Map<string, ImportRowGroup>()

  for (const row of rows) {
    const forced = overrides?.get(row.ri)
    const cleaned = row.description ? normalizeNarration(row.description) : ''
    const key = forced ?? (cleaned || row.description || NO_DESCRIPTION)

    let group = byKey.get(key)
    if (!group) {
      group = {
        key,
        label:      forced ? (overrideLabels?.get(forced) ?? 'Split group') : key,
        sampleRaw:  row.description || NO_DESCRIPTION,
        ris:        [],
        rows:       [],
        count:      0,
        total:      0,
        configured: true,
        isSplit:    !!forced,
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

/**
 * Split groups into the two Step 4 sections.
 *
 * A manual override wins over the computed state in BOTH directions: a group
 * can be forced to Sorted while still incomplete, or pulled back to Needs
 * attention after the fact. Without this the sections were purely derived and
 * the user had no way to disagree with them.
 */
export function splitGroups(
  groups: ImportRowGroup[],
  manualSections?: Record<string, 'sorted' | 'attention'>,
): {
  needsAttention: ImportRowGroup[]
  sorted:         ImportRowGroup[]
} {
  const isSorted = (g: ImportRowGroup) => {
    const override = manualSections?.[g.key]
    if (override) return override === 'sorted'
    return g.configured
  }
  return {
    needsAttention: groups.filter(g => !isSorted(g)),
    sorted:         groups.filter(g =>  isSorted(g)),
  }
}
