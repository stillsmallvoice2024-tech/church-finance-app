/**
 * Grouping is what makes a 10k-row import tractable: ~150 narration patterns
 * instead of 10,000 rows. These tests pin the two properties that matter —
 * rows that mean the same thing land together, and the RAW statement text is
 * never lost or replaced by the cleaned label used for bucketing.
 */

import { describe, it, expect } from 'vitest'
import { groupImportRows, splitGroups } from '../groupImportRows'
import type { ImportRow, RowResolution } from '../../types/importRow'
import { emptyRowConfig } from '../../types/importRow'

let nextRi = 0
function row(
  description: string,
  amount = 1000,
  resolution: RowResolution = 'unresolved',
  kind: 'inflow' | 'outflow' = 'outflow',
): ImportRow {
  const ri = nextRi++
  return {
    ri, kind, date: '2026-03-01', amount, description,
    ref: null, txnId: `id-${ri}`, isDuplicate: false,
    config: emptyRowConfig(), resolution,
  }
}

describe('groupImportRows', () => {
  it('groups transfers to the same payee despite differing reference tokens', () => {
    const rows = [
      row('NIP TRANSFER TO JOHN DOE REF 48291 SUCCESSFUL'),
      row('NIP TRANSFER TO JOHN DOE REF 99117 SUCCESSFUL'),
      row('NIP TRANSFER TO JANE ROE REF 22222 SUCCESSFUL'),
    ]
    const groups = groupImportRows(rows)
    const john = groups.find(g => g.label.includes('John'))
    expect(john?.count).toBe(2)
    expect(groups).toHaveLength(2)
  })

  it('orders groups by size, largest first', () => {
    const rows = [
      row('POS PAYMT SHOPRITE IKEJA TERMINAL 1'),
      row('POS PAYMT SHOPRITE IKEJA TERMINAL 2'),
      row('POS PAYMT SHOPRITE IKEJA TERMINAL 3'),
      row('BANK CHARGE'),
    ]
    const groups = groupImportRows(rows)
    expect(groups[0].count).toBe(3)
    expect(groups[0].count).toBeGreaterThanOrEqual(groups[1].count)
  })

  it('keeps the FULL raw description as the sample, not the cleaned label', () => {
    const raw = 'NIP TRANSFER TO JOHN DOE REF 48291 SUCCESSFUL'
    const groups = groupImportRows([row(raw)])
    expect(groups[0].sampleRaw).toBe(raw)
    // The label is the cleaned form used for bucketing — it must NOT have
    // overwritten the raw text.
    expect(groups[0].label).not.toBe(raw)
  })

  it('never mutates a row description', () => {
    const raw = 'COMM - To pay/Volunteers Tag/Alice'
    const r = row(raw)
    groupImportRows([r])
    expect(r.description).toBe(raw)
  })

  it('sums amounts and collects row indices per group', () => {
    const a = row('BANK CHARGE', 100)
    const b = row('BANK CHARGE', 250)
    const groups = groupImportRows([a, b])
    expect(groups[0].total).toBe(350)
    expect(groups[0].ris).toEqual([a.ri, b.ri])
  })

  it('buckets blank descriptions rather than dropping them', () => {
    const groups = groupImportRows([row(''), row('')])
    expect(groups).toHaveLength(1)
    expect(groups[0].count).toBe(2)
    expect(groups[0].label).toBe('(no description)')
  })

  it('marks a group unconfigured when ANY row still needs attention', () => {
    const groups = groupImportRows([
      row('BANK CHARGE', 100, 'rule'),
      row('BANK CHARGE', 100, 'unresolved'),
    ])
    expect(groups[0].configured).toBe(false)
  })

  it('treats a catch-all-only match as still needing attention', () => {
    const groups = groupImportRows([row('SOME NARRATION', 100, 'fallback')])
    expect(groups[0].configured).toBe(false)
  })

  it('counts rule-matched and manually-set rows as configured', () => {
    const groups = groupImportRows([
      row('A', 100, 'rule'),
      row('B', 100, 'manual'),
    ])
    expect(groups.every(g => g.configured)).toBe(true)
  })
})

describe('splitGroups', () => {
  it('separates groups needing attention from sorted ones', () => {
    const groups = groupImportRows([
      row('NEEDS ONE', 100, 'unresolved'),
      row('DONE ONE',  100, 'manual'),
    ])
    const { needsAttention, sorted } = splitGroups(groups)
    expect(needsAttention).toHaveLength(1)
    expect(sorted).toHaveLength(1)
    expect(needsAttention[0].rows[0].description).toBe('NEEDS ONE')
  })

  it('accounts for every group exactly once', () => {
    const groups = groupImportRows([
      row('A', 100, 'unresolved'),
      row('B', 100, 'fallback'),
      row('C', 100, 'rule'),
      row('D', 100, 'manual'),
    ])
    const { needsAttention, sorted } = splitGroups(groups)
    expect(needsAttention.length + sorted.length).toBe(groups.length)
  })
})
