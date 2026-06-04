import { describe, it, expect } from 'vitest'
import { allocatePercent } from '../financeMath'

describe('allocatePercent', () => {
  // ── Basic correctness ───────────────────────────────────────────────────────

  it('10% of 10000 = 1000.00', () => {
    expect(allocatePercent(10_000, 10)).toBe(1_000)
  })

  it('50% of 5000 = 2500.00', () => {
    expect(allocatePercent(5_000, 50)).toBe(2_500)
  })

  it('100% of any amount = same amount', () => {
    expect(allocatePercent(12_345.67, 100)).toBe(12_345.67)
  })

  it('0% of any amount = 0', () => {
    expect(allocatePercent(99_999, 0)).toBe(0)
  })

  // ── Fractional percentages (the classic IEEE 754 failure case) ──────────────

  it('16.67% of 10000 = 1667.00 (not 1667.0000000000002)', () => {
    // Native FP: 10000 * (16.67 / 100) === 1667.0000000000002
    expect(allocatePercent(10_000, 16.67)).toBe(1_667)
  })

  it('33.33% of 1000 = 333.30', () => {
    expect(allocatePercent(1_000, 33.33)).toBe(333.3)
  })

  it('sums of split percentages round-trip without drift', () => {
    // Config with 3 rows: 40% + 40% + 20% = 100%
    const amount = 7_500
    const a = allocatePercent(amount, 40)
    const b = allocatePercent(amount, 40)
    const c = allocatePercent(amount, 20)
    // Each individually: 3000, 3000, 1500 → sum = 7500
    expect(a + b + c).toBe(7_500)
  })

  it('handles amounts with decimal kobo values', () => {
    expect(allocatePercent(1_234.56, 25)).toBe(308.64)
  })

  it('15.5% of 8000 = 1240.00', () => {
    expect(allocatePercent(8_000, 15.5)).toBe(1_240)
  })

  // ── Regression: the exact cases that fail with naive FP ────────────────────

  it('REGRESSION: naive FP 10000 * (16.67/100) has trailing bits', () => {
    // Documents the original bug — this assertion should remain true:
    expect(10_000 * (16.67 / 100)).not.toBe(1_667)
    // And our fix resolves it:
    expect(allocatePercent(10_000, 16.67)).toBe(1_667)
  })

  it('REGRESSION: naive FP 5000 * (16.67/100) has trailing bits', () => {
    // 5000 * (16.67 / 100) === 833.5000000000001 in IEEE 754
    expect(5_000 * (16.67 / 100)).not.toBe(833.5)
    expect(allocatePercent(5_000, 16.67)).toBe(833.5)
  })

  // ── Edge cases ──────────────────────────────────────────────────────────────

  it('very small amounts allocate without going negative', () => {
    expect(allocatePercent(0.01, 50)).toBe(0.01)
  })

  it('very large NGN amounts stay within safe integer range', () => {
    // 100 million NGN — largest realistic church income
    expect(allocatePercent(100_000_000, 16.67)).toBe(16_670_000)
  })
})
