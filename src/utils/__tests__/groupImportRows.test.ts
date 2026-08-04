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

// A group counts as sorted only when its rows are actually COMPLETE, not merely
// touched — so a fixture that wants a sorted row has to fill the fields in.
// For outflows that means fund + fund type + outflow type.
function completeOutflowConfig() {
  return {
    ...emptyRowConfig(),
    stageCode1:    'Utilities',
    stageCode2:    'Percentage Allocation',
    outflowTypeId: 'type-1',
  }
}

function row(
  description: string,
  amount = 1000,
  resolution: RowResolution = 'unresolved',
  kind: 'inflow' | 'outflow' = 'outflow',
): ImportRow {
  const ri = nextRi++
  const complete = resolution === 'rule' || resolution === 'manual'
  return {
    ri, kind, date: '2026-03-01', amount, description,
    ref: null, txnId: `id-${ri}`, isDuplicate: false,
    config: complete
      ? (kind === 'outflow' ? completeOutflowConfig() : { ...emptyRowConfig(), incomeTypeId: 'income-1' })
      : emptyRowConfig(),
    resolution,
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

describe('manual splitting', () => {
  it('pulls overridden rows out of their narration group', () => {
    const a = row('NIP TRANSFER TO JOHN DOE REF 1 SUCCESSFUL')
    const b = row('NIP TRANSFER TO JOHN DOE REF 2 SUCCESSFUL')
    const c = row('NIP TRANSFER TO JOHN DOE REF 3 SUCCESSFUL')
    // Without an override all three bucket together.
    expect(groupImportRows([a, b, c])).toHaveLength(1)

    const overrides = new Map([[c.ri, 'split:abc']])
    const labels    = new Map([['split:abc', 'Handled separately']])
    const groups    = groupImportRows([a, b, c], overrides, labels)

    expect(groups).toHaveLength(2)
    const split = groups.find(g => g.isSplit)
    expect(split?.count).toBe(1)
    expect(split?.label).toBe('Handled separately')
    expect(groups.find(g => !g.isSplit)?.count).toBe(2)
  })

  it('keeps the raw description on split rows', () => {
    const raw = 'POS PAYMT SHOPRITE IKEJA TERMINAL 9'
    const r = row(raw)
    const groups = groupImportRows([r], new Map([[r.ri, 'split:x']]), new Map())
    expect(groups[0].rows[0].description).toBe(raw)
    expect(groups[0].sampleRaw).toBe(raw)
  })

  it('falls back to a generic label when none was supplied', () => {
    const r = row('ANYTHING')
    const groups = groupImportRows([r], new Map([[r.ri, 'split:y']]), new Map())
    expect(groups[0].label).toBe('Split group')
  })

  it('marks only split groups as split', () => {
    const a = row('AAA')
    const b = row('BBB')
    const groups = groupImportRows([a, b], new Map([[a.ri, 'split:z']]), new Map())
    expect(groups.filter(g => g.isSplit)).toHaveLength(1)
  })
})

describe('manual section overrides', () => {
  it('forces an incomplete group into Sorted', () => {
    const groups = groupImportRows([row('INCOMPLETE', 100, 'unresolved')])
    expect(splitGroups(groups).sorted).toHaveLength(0)

    const forced = splitGroups(groups, { [groups[0].key]: 'sorted' })
    expect(forced.sorted).toHaveLength(1)
    expect(forced.needsAttention).toHaveLength(0)
  })

  it('pulls a complete group back to Needs attention', () => {
    const groups = groupImportRows([row('DONE', 100, 'manual')])
    expect(splitGroups(groups).sorted).toHaveLength(1)

    const forced = splitGroups(groups, { [groups[0].key]: 'attention' })
    expect(forced.needsAttention).toHaveLength(1)
    expect(forced.sorted).toHaveLength(0)
  })

  it('returns to the computed state once the override is cleared', () => {
    const groups = groupImportRows([row('DONE', 100, 'manual')])
    expect(splitGroups(groups, {}).sorted).toHaveLength(1)
  })

  it('still accounts for every group exactly once under overrides', () => {
    const groups = groupImportRows([
      row('A', 100, 'unresolved'),
      row('B', 100, 'manual'),
    ])
    const { needsAttention, sorted } = splitGroups(groups, { [groups[0].key]: 'sorted' })
    expect(needsAttention.length + sorted.length).toBe(groups.length)
  })
})
