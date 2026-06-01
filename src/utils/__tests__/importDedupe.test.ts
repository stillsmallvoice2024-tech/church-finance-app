/**
 * Regression tests for import duplicate-detection scope.
 *
 * Root cause (fixed): duplicate detection used a global query
 * (no bank_name filter), so a transaction ID that already existed
 * in Bank A was incorrectly rejected when importing from Bank B.
 *
 * Correct rules:
 *  - Same txn ID, different bank  → NOT a duplicate (must import)
 *  - Same txn ID, same bank        → IS a duplicate (must skip)
 *  - Inflow in Bank A, outflow in Bank B sharing a reference ID → both must import
 */

import { describe, it, expect } from 'vitest'

// ---------------------------------------------------------------------------
// Pure-logic helper: given a set of existing (bankName, txnId) pairs and an
// incoming (bankName, txnId), decide if it is a duplicate.
// This mirrors the scoped check now used in proceedToRowConfig and
// Import.tsx's useEffect.
// ---------------------------------------------------------------------------

type ExistingRecord = { bank_name: string | null; id: string }

function isScopedDuplicate(
  existing: ExistingRecord[],
  incoming: { bankName: string | null; id: string },
): boolean {
  return existing.some(
    r => r.id === incoming.id && r.bank_name === incoming.bankName,
  )
}

// ---------------------------------------------------------------------------
// 1. Same ID in different banks → NOT a duplicate
// ---------------------------------------------------------------------------

describe('importDedupe — same ID, different banks', () => {
  const existing: ExistingRecord[] = [
    { bank_name: 'Access Bank', id: 'TXN-001' },
  ]

  it('identical ID in a different bank must NOT be treated as duplicate', () => {
    expect(isScopedDuplicate(existing, { bankName: 'Zenith Bank', id: 'TXN-001' })).toBe(false)
  })

  it('identical ID in the same bank IS a duplicate', () => {
    expect(isScopedDuplicate(existing, { bankName: 'Access Bank', id: 'TXN-001' })).toBe(true)
  })

  it('different ID in the same bank is NOT a duplicate', () => {
    expect(isScopedDuplicate(existing, { bankName: 'Access Bank', id: 'TXN-002' })).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 2. Inflow in Bank A and Outflow in Bank B sharing the same reference ID
// ---------------------------------------------------------------------------

describe('importDedupe — inflow in Bank A and outflow in Bank B share reference', () => {
  const existingInflows: ExistingRecord[] = [
    { bank_name: 'GTBank', id: 'REF-X99' },
  ]
  const existingOutflows: ExistingRecord[] = []

  it('outflow with same reference in a different bank must NOT be treated as duplicate', () => {
    // The outflow being imported is from First Bank — should not conflict with
    // the inflow already recorded against GTBank.
    expect(isScopedDuplicate(existingInflows, { bankName: 'First Bank', id: 'REF-X99' })).toBe(false)
    expect(isScopedDuplicate(existingOutflows, { bankName: 'First Bank', id: 'REF-X99' })).toBe(false)
  })

  it('inflow with same reference in the same bank IS a duplicate', () => {
    expect(isScopedDuplicate(existingInflows, { bankName: 'GTBank', id: 'REF-X99' })).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 3. Null / missing bank_name edge cases
// ---------------------------------------------------------------------------

describe('importDedupe — null bank_name handling', () => {
  const existing: ExistingRecord[] = [
    { bank_name: null, id: 'TXN-NULL' },
    { bank_name: 'UBA', id: 'TXN-UBA' },
  ]

  it('null bank matches null bank (no-bank-selected case)', () => {
    expect(isScopedDuplicate(existing, { bankName: null, id: 'TXN-NULL' })).toBe(true)
  })

  it('null bank does NOT match a named bank', () => {
    expect(isScopedDuplicate(existing, { bankName: null, id: 'TXN-UBA' })).toBe(false)
  })

  it('named bank does NOT match null bank record', () => {
    expect(isScopedDuplicate(existing, { bankName: 'UBA', id: 'TXN-NULL' })).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 4. Multiple banks — batch of incoming rows
// ---------------------------------------------------------------------------

describe('importDedupe — batch check across multiple banks', () => {
  const existingInflows: ExistingRecord[] = [
    { bank_name: 'Access Bank', id: 'A-100' },
    { bank_name: 'Access Bank', id: 'A-101' },
    { bank_name: 'Zenith Bank', id: 'Z-200' },
  ]

  const incoming = [
    { bankName: 'Access Bank', id: 'A-100' }, // dup — same bank
    { bankName: 'Access Bank', id: 'A-102' }, // new — same bank, new id
    { bankName: 'Zenith Bank', id: 'A-100' }, // NOT dup — different bank, same id as Access row
    { bankName: 'Zenith Bank', id: 'Z-200' }, // dup — same bank
    { bankName: 'GTBank',      id: 'Z-200' }, // NOT dup — different bank
  ]

  const expectedDups = [true, false, false, true, false]

  incoming.forEach((row, i) => {
    it(`row ${i} (bank="${row.bankName}", id="${row.id}") isDup=${expectedDups[i]}`, () => {
      expect(isScopedDuplicate(existingInflows, row)).toBe(expectedDups[i])
    })
  })
})
