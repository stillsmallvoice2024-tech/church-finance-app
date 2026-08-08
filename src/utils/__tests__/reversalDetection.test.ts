import { describe, it, expect } from 'vitest'
import { parseSignedAmount, detectReversalsWithinFile } from '../reversalDetection'
import { emptyRowConfig } from '../../types/importRow'
import type { ImportRow, ColumnIndices } from '../../types/importRow'

const IDX: ColumnIndices = { date: 0, desc: 1, credit: 2, debit: 3, ref: 4, s1: -1, s2: -1, balance: -1 }

function row(ri: number, kind: 'inflow' | 'outflow', amount: number, ref: string, desc = 'x'): ImportRow {
  return {
    ri, kind, date: '2026-01-01', amount, description: desc, ref, txnId: ref,
    isDuplicate: false, refOccurrence: 0, config: emptyRowConfig(), resolution: 'unresolved',
  }
}

describe('parseSignedAmount', () => {
  it('keeps a plain negative sign', () => {
    expect(parseSignedAmount('-600')).toBe(-600)
  })
  it('treats parentheses as negative', () => {
    expect(parseSignedAmount('(600)')).toBe(-600)
  })
  it('is positive for an unsigned number', () => {
    expect(parseSignedAmount('600')).toBe(600)
  })
  it('handles a raw number', () => {
    expect(parseSignedAmount(-600)).toBe(-600)
  })
  it('strips thousands separators', () => {
    expect(parseSignedAmount('-1,200.50')).toBe(-1200.5)
  })
})

describe('detectReversalsWithinFile', () => {
  // Case 1: same column, opposite sign.
  it('pairs same-kind rows separated only by sign', () => {
    const rows = [row(0, 'outflow', 600, 'REF1'), row(1, 'outflow', 600, 'REF1')]
    const merged = [['', '', '', '600', 'REF1'], ['', '', '', '-600', 'REF1']]
    const r = detectReversalsWithinFile(rows, merged, IDX)
    expect(r.reversalRis).toEqual(new Set([0, 1]))
    expect(r.lonelyNegative).toEqual([])
    expect(r.unpaired).toEqual([])
  })

  // Case 2: opposite column, same amount, both positive.
  it('pairs opposite-kind rows at the same amount', () => {
    const rows = [row(0, 'outflow', 600, 'REF2'), row(1, 'inflow', 600, 'REF2')]
    const merged = [['', '', '', '600', 'REF2'], ['', '', '600', '', 'REF2']]
    const r = detectReversalsWithinFile(rows, merged, IDX)
    expect(r.reversalRis).toEqual(new Set([0, 1]))
  })

  it('does not pair rows with different amounts', () => {
    const rows = [row(0, 'outflow', 600, 'REF3'), row(1, 'inflow', 50, 'REF3')]
    const merged = [['', '', '', '600', 'REF3'], ['', '', '50', '', 'REF3']]
    const r = detectReversalsWithinFile(rows, merged, IDX)
    expect(r.reversalRis.size).toBe(0)
    // Neither side has a sign, so both are just "unpaired" candidates for the
    // cross-import (opposite-table) lookup.
    expect(r.unpaired.map(c => c.ri).sort()).toEqual([0, 1])
  })

  it('does not pair rows with different references', () => {
    const rows = [row(0, 'outflow', 600, 'REF-A'), row(1, 'inflow', 600, 'REF-B')]
    const merged = [['', '', '', '600', 'REF-A'], ['', '', '600', '', 'REF-B']]
    const r = detectReversalsWithinFile(rows, merged, IDX)
    expect(r.reversalRis.size).toBe(0)
  })

  it('leaves a transfer/fee/VAT trio alone — same ref, different amounts', () => {
    const rows = [
      row(0, 'outflow', 990000, 'S1', 'TRF'),
      row(1, 'outflow', 50, 'S1', 'COMMISSION'),
      row(2, 'outflow', 3.75, 'S1', 'VAT'),
    ]
    const merged = [
      ['', '', '', '990000', 'S1'],
      ['', '', '', '50', 'S1'],
      ['', '', '', '3.75', 'S1'],
    ]
    const r = detectReversalsWithinFile(rows, merged, IDX)
    expect(r.reversalRis.size).toBe(0)
  })

  // A negative-signed row with no partner in this file: still tagged (its own
  // sign is unambiguous) but reported as needing a cross-import lookup.
  it('tags a lone negative row and reports it for the cross-import lookup', () => {
    const rows = [row(0, 'outflow', 600, 'REF4')]
    const merged = [['', '', '', '-600', 'REF4']]
    const r = detectReversalsWithinFile(rows, merged, IDX)
    expect(r.reversalRis).toEqual(new Set([0]))
    expect(r.lonelyNegative).toEqual([{ ri: 0, kind: 'outflow', ref: 'REF4', amount: 600 }])
  })

  it('prefers the sign-based pairing over the opposite-column pairing', () => {
    // Three outflow rows, same ref, same amount: two share a sign pairing,
    // the third (positive, no negative partner left) should NOT be forced
    // into a same-kind pair with itself, and stays unpaired (not reversal).
    const rows = [
      row(0, 'outflow', 600, 'REF5'),
      row(1, 'outflow', 600, 'REF5'),
      row(2, 'outflow', 600, 'REF5'),
    ]
    const merged = [
      ['', '', '', '600', 'REF5'],
      ['', '', '', '-600', 'REF5'],
      ['', '', '', '600', 'REF5'],
    ]
    const r = detectReversalsWithinFile(rows, merged, IDX)
    expect(r.reversalRis).toEqual(new Set([0, 1]))
    expect(r.unpaired.map(c => c.ri)).toEqual([2])
  })

  it('ignores rows with no reference entirely', () => {
    const rows = [row(0, 'outflow', 600, ''), row(1, 'inflow', 600, '')]
    const merged = [['', '', '', '600', ''], ['', '', '600', '', '']]
    const r = detectReversalsWithinFile(rows, merged, IDX)
    expect(r.reversalRis.size).toBe(0)
    expect(r.lonelyNegative).toEqual([])
    expect(r.unpaired).toEqual([])
  })

  it('tolerates floating point noise in the amount match', () => {
    const rows = [row(0, 'outflow', 600.0001, 'REF6'), row(1, 'inflow', 600.0002, 'REF6')]
    const merged = [['', '', '', '600.0001', 'REF6'], ['', '', '600.0002', '', 'REF6']]
    const r = detectReversalsWithinFile(rows, merged, IDX)
    expect(r.reversalRis).toEqual(new Set([0, 1]))
  })
})
