import { describe, it, expect } from 'vitest'
import { claimRef, rowFingerprint } from '../claimRef'

const fp = rowFingerprint

describe('rowFingerprint', () => {
  it('collapses whitespace in the description, as the database does', () => {
    expect(fp('2026-01-01', 100, '  TRF   TO VENDOR ')).toBe(fp('2026-01-01', 100, 'TRF TO VENDOR'))
  })

  // normalizeId strips these, so the fingerprint must not see them either —
  // a description pasted with a non-breaking space is the same description.
  it('strips invisible characters from the description', () => {
    expect(fp('2026-01-01', 100, 'TRF\u00a0TO\u200bVENDOR')).toBe(fp('2026-01-01', 100, 'TRFTOVENDOR'))
  })

  it('treats numerically equal amounts as the same', () => {
    expect(fp('2026-01-01', 1000, 'x')).toBe(fp('2026-01-01', 1000.0, 'x'))
  })

  it('separates fields so concatenation cannot collide', () => {
    expect(fp('2026-01-01', 1, 'AB')).not.toBe(fp('2026-01-01', 1, 'A B'))
  })
})

describe('claimRef', () => {
  it('returns the reference untouched the first time', () => {
    expect(claimRef(new Map(), 'REF001', fp('2026-01-01', 100, 'a'))).toBe('REF001')
  })

  // The case that matters: a transfer, its fee and the VAT on that fee all
  // carry one bank Session ID. All three are real, and the reference must
  // survive intact for reconciliation.
  it('leaves a shared bank reference alone when the rows differ', () => {
    const counts = new Map<string, number>()
    expect(claimRef(counts, 'S10081464', fp('2026-03-01', 990000, 'TRF TO VENDOR'))).toBe('S10081464')
    expect(claimRef(counts, 'S10081464', fp('2026-03-01', 50, 'COMMISSION'))).toBe('S10081464')
    expect(claimRef(counts, 'S10081464', fp('2026-03-01', 3.75, 'VAT'))).toBe('S10081464')
  })

  it('leaves a shared reference alone when only the description differs', () => {
    const counts = new Map<string, number>()
    expect(claimRef(counts, 'S999', fp('2026-03-02', 50, 'STAMP DUTY'))).toBe('S999')
    expect(claimRef(counts, 'S999', fp('2026-03-02', 50, 'TRANSFER FEE'))).toBe('S999')
  })

  it('leaves a shared reference alone when only the date differs', () => {
    const counts = new Map<string, number>()
    expect(claimRef(counts, 'S777', fp('2026-03-04', 50, 'CHARGE'))).toBe('S777')
    expect(claimRef(counts, 'S777', fp('2026-03-05', 50, 'CHARGE'))).toBe('S777')
  })

  // Only a row identical in every indexed column needs suffixing — otherwise
  // the index would reject it and the row would be lost.
  it('suffixes only rows identical in every indexed column', () => {
    const counts = new Map<string, number>()
    const same = fp('2026-01-01', 2000, 'Offering')
    expect(claimRef(counts, 'HASH', same)).toBe('HASH')
    expect(claimRef(counts, 'HASH', same)).toBe('HASH-1')
    expect(claimRef(counts, 'HASH', same)).toBe('HASH-2')
  })

  it('never hands out a reference the statement itself uses', () => {
    const counts = new Map<string, number>()
    const same = fp('2026-01-01', 1, 'x')
    expect(claimRef(counts, 'HASH-1', same)).toBe('HASH-1')
    expect(claimRef(counts, 'HASH', same)).toBe('HASH')
    expect(claimRef(counts, 'HASH', same)).toBe('HASH-2')
  })

  it('produces no duplicate (reference, fingerprint) pair across a mixed batch', () => {
    const counts = new Map<string, number>()
    const rows: [string, string][] = [
      ['S1', fp('2026-01-01', 100, 'a')],
      ['S1', fp('2026-01-01', 100, 'a')],   // identical → must suffix
      ['S1', fp('2026-01-01', 50, 'fee')],  // fee on same session → must not
      ['S1-1', fp('2026-01-01', 100, 'a')], // statement supplies the suffix
      ['S1', fp('2026-01-01', 100, 'a')],
    ]
    const issued = rows.map(([r, f]) => `${claimRef(counts, r, f)}|${f}`)
    expect(new Set(issued).size).toBe(issued.length)
    expect(issued[2]).toContain('S1|')       // fee kept the bare reference
  })
})
