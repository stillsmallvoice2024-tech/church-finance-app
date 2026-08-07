import { describe, it, expect } from 'vitest'
import { rowFingerprint, nextOccurrence } from '../refOccurrence'

describe('rowFingerprint', () => {
  it('collapses whitespace in the description, as the database does', () => {
    expect(rowFingerprint('R', '2026-01-01', 100, '  TRF   TO VENDOR '))
      .toBe(rowFingerprint('R', '2026-01-01', 100, 'TRF TO VENDOR'))
  })

  it('strips invisible characters from the description', () => {
    expect(rowFingerprint('R', '2026-01-01', 100, 'TRF TO​VENDOR'))
      .toBe(rowFingerprint('R', '2026-01-01', 100, 'TRFTOVENDOR'))
  })

  it('treats numerically equal amounts as the same', () => {
    expect(rowFingerprint('R', '2026-01-01', 1000, 'x'))
      .toBe(rowFingerprint('R', '2026-01-01', 1000.0, 'x'))
  })

  it('separates fields so concatenation cannot collide', () => {
    expect(rowFingerprint('A', '2026-01-01', 1, 'B')).not.toBe(rowFingerprint('AB', '2026-01-01', 1, ''))
  })

  // The transfer / fee / VAT triple a bank posts under one Session ID.
  it('distinguishes postings that share a reference but differ in amount', () => {
    const a = rowFingerprint('S10081464', '2026-03-01', 990000, 'TRF')
    const b = rowFingerprint('S10081464', '2026-03-01', 50, 'COMMISSION')
    const c = rowFingerprint('S10081464', '2026-03-01', 3.75, 'VAT')
    expect(new Set([a, b, c]).size).toBe(3)
  })
})

describe('nextOccurrence', () => {
  it('gives 0 to the first row of an identity', () => {
    expect(nextOccurrence(new Map(), rowFingerprint('R', '2026-01-01', 1, 'x'))).toBe(0)
  })

  // A failed transfer, reversed and retried: two byte-identical debits under
  // one Session ID. Both are real and must survive.
  it('numbers byte-identical rows apart', () => {
    const counts = new Map<string, number>()
    const fp = rowFingerprint('260507140300997717113989', '2026-05-07', 600, 'TRF TO VENDOR')
    expect(nextOccurrence(counts, fp)).toBe(0)
    expect(nextOccurrence(counts, fp)).toBe(1)
    expect(nextOccurrence(counts, fp)).toBe(2)
  })

  it('leaves rows that share only a reference at occurrence 0', () => {
    const counts = new Map<string, number>()
    expect(nextOccurrence(counts, rowFingerprint('S10081464', '2026-03-01', 990000, 'TRF'))).toBe(0)
    expect(nextOccurrence(counts, rowFingerprint('S10081464', '2026-03-01', 50, 'COMMISSION'))).toBe(0)
    expect(nextOccurrence(counts, rowFingerprint('S10081464', '2026-03-01', 3.75, 'VAT'))).toBe(0)
  })

  // A statement imported in overlapping parts must keep counting up rather than
  // restart at 0 and collide with what is already stored.
  it('continues from the count already in the database', () => {
    const counts = new Map<string, number>()
    const fp = rowFingerprint('R', '2026-01-01', 100, 'x')
    expect(nextOccurrence(counts, fp, 2)).toBe(2)
    expect(nextOccurrence(counts, fp, 2)).toBe(3)
  })
})
