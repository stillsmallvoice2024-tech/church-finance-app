import { describe, it, expect } from 'vitest'
import { claimRef } from '../claimRef'

describe('claimRef', () => {
  it('returns the base reference the first time it is seen', () => {
    const counts = new Map<string, number>()
    expect(claimRef(counts, 'REF001')).toBe('REF001')
  })

  it('suffixes repeats so both rows survive the unique index', () => {
    const counts = new Map<string, number>()
    expect(claimRef(counts, 'REF001')).toBe('REF001')
    expect(claimRef(counts, 'REF001')).toBe('REF001-1')
    expect(claimRef(counts, 'REF001')).toBe('REF001-2')
  })

  it('keeps distinct references untouched', () => {
    const counts = new Map<string, number>()
    expect(claimRef(counts, 'A')).toBe('A')
    expect(claimRef(counts, 'B')).toBe('B')
    expect(claimRef(counts, 'C')).toBe('C')
  })

  // The statement may already contain the very string the suffix would produce.
  it('never hands out a reference the statement itself uses', () => {
    const counts = new Map<string, number>()
    expect(claimRef(counts, 'REF001-1')).toBe('REF001-1')
    expect(claimRef(counts, 'REF001')).toBe('REF001')
    expect(claimRef(counts, 'REF001')).toBe('REF001-2')
  })

  it('produces no duplicates across a pathological batch', () => {
    const counts = new Map<string, number>()
    const bases = ['X', 'X', 'X-1', 'X', 'X-1', 'X-2', 'X']
    const issued = bases.map(b => claimRef(counts, b))
    expect(new Set(issued).size).toBe(issued.length)
  })
})
