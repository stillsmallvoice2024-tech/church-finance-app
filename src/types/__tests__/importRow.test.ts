/**
 * Completeness gating for the Step 4 "Needs attention" / "Sorted" split.
 *
 * The defect this pins: configuring a group used to mark every row 'manual' on
 * the first control change, so picking a fund alone promoted the whole group to
 * Sorted with fund type and outflow type still blank. Completeness must be read
 * off the row's config, never off the fact that an edit happened.
 */

import { describe, it, expect } from 'vitest'
import { isRowComplete, needsAttention, emptyRowConfig } from '../importRow'
import type { ImportRow, RowResolution } from '../importRow'

function row(
  kind: 'inflow' | 'outflow',
  config: Partial<ReturnType<typeof emptyRowConfig>> = {},
  resolution: RowResolution = 'manual',
): ImportRow {
  return {
    ri: 1, kind, date: '2026-03-01', amount: 1000,
    description: 'NIP TRANSFER TO JOHN DOE', ref: null, txnId: 'id-1',
    isDuplicate: false,
    config: { ...emptyRowConfig(), ...config },
    resolution,
  }
}

describe('isRowComplete — outflow needs all three', () => {
  it('is NOT complete with only a fund', () => {
    expect(isRowComplete(row('outflow', { stageCode1: 'Utilities' }))).toBe(false)
  })

  it('is NOT complete with fund + fund type but no outflow type', () => {
    expect(isRowComplete(row('outflow', {
      stageCode1: 'Utilities', stageCode2: 'Percentage Allocation',
    }))).toBe(false)
  })

  it('is NOT complete with fund + outflow type but no fund type', () => {
    expect(isRowComplete(row('outflow', {
      stageCode1: 'Utilities', outflowTypeId: 't1',
    }))).toBe(false)
  })

  it('is complete only once all three are set', () => {
    expect(isRowComplete(row('outflow', {
      stageCode1: 'Utilities', stageCode2: 'Percentage Allocation', outflowTypeId: 't1',
    }))).toBe(true)
  })

  it('stays in Needs attention until complete', () => {
    const partial = row('outflow', { stageCode1: 'Utilities' })
    expect(needsAttention(partial)).toBe(true)
  })
})

describe('isRowComplete — inflow', () => {
  it('is NOT complete without an income type', () => {
    expect(isRowComplete(row('inflow', {}, 'unresolved'))).toBe(false)
  })

  it('is NOT complete when the income type came only from the catch-all', () => {
    // A generic fallback is a guess, not a classification — it still wants a look.
    expect(isRowComplete(row('inflow', { incomeTypeId: 'general' }, 'fallback'))).toBe(false)
  })

  it('is complete when a real rule matched', () => {
    expect(isRowComplete(row('inflow', { incomeTypeId: 'tithe' }, 'rule'))).toBe(true)
  })

  it('is complete when the user set it by hand', () => {
    expect(isRowComplete(row('inflow', { incomeTypeId: 'tithe' }, 'manual'))).toBe(true)
  })
})

describe('isRowComplete — non-Normal transaction types', () => {
  // These skip allocation entirely by design, so holding them back for fields
  // they will never have would strand them in Needs attention forever.
  for (const txnType of ['refund', 'reversal', 'bank_deposit', 'intrabank_transfer']) {
    it(`treats a ${txnType} outflow as complete with no allocation fields`, () => {
      expect(isRowComplete(row('outflow', { txnType }, 'unresolved'))).toBe(true)
    })
    it(`treats a ${txnType} inflow as complete with no income type`, () => {
      expect(isRowComplete(row('inflow', { txnType }, 'unresolved'))).toBe(true)
    })
  }
})

describe('needsAttention is the inverse of isRowComplete', () => {
  const cases: ImportRow[] = [
    row('outflow', { stageCode1: 'Utilities' }),
    row('outflow', { stageCode1: 'U', stageCode2: 'Savings', outflowTypeId: 't' }),
    row('inflow', { incomeTypeId: 'x' }, 'rule'),
    row('inflow', {}, 'fallback'),
    row('inflow', { txnType: 'refund' }, 'unresolved'),
  ]
  it('never disagrees', () => {
    for (const r of cases) expect(needsAttention(r)).toBe(!isRowComplete(r))
  })
})
