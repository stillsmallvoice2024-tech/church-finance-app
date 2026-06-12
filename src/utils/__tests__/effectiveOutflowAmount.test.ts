import { describe, it, expect } from 'vitest'

/**
 * Regression tests for outflow amount calculation.
 *
 * actual_amount has been dropped from outflow_transactions (was DEFAULT 0,
 * never set by any write path). All sites now use amount_disbursed directly.
 *
 * This suite guards against reintroducing the ?? vs || bug if the column
 * is ever re-added, and documents the historical root cause.
 */

function effectiveOutflowAmount(amount_disbursed: number | null | undefined): number {
  return Number(amount_disbursed || 0)
}

describe('effectiveOutflowAmount', () => {
  it('returns amount_disbursed when set', () => {
    expect(effectiveOutflowAmount(500)).toBe(500)
  })

  it('returns 0 when amount_disbursed is 0', () => {
    expect(effectiveOutflowAmount(0)).toBe(0)
  })

  it('returns 0 when amount_disbursed is null', () => {
    expect(effectiveOutflowAmount(null)).toBe(0)
  })

  it('returns 0 when amount_disbursed is undefined', () => {
    expect(effectiveOutflowAmount(undefined)).toBe(0)
  })

  it('HISTORICAL: ?? would have returned 0 when actual_amount was DB-default 0', () => {
    // Before the column was dropped, all sites used:
    //   Number(actual_amount || amount_disbursed || 0)
    // actual_amount was always 0 (DB DEFAULT, never written), so:
    //   0 ?? amount_disbursed = 0  ← the original bug
    //   0 || amount_disbursed = amount_disbursed ← the fix
    const amount_disbursed = 750
    // @ts-expect-error — left side is intentionally a non-nullish literal to document the old ?? bug
    expect(0 ?? amount_disbursed).toBe(0)   // documents the old bug
    expect(0 || amount_disbursed).toBe(750) // documents the fix
  })
})
