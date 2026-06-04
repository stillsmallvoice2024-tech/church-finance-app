/**
 * Finance-safe arithmetic for monetary allocation calculations.
 *
 * Native JS floating-point (IEEE 754) cannot exactly represent 1/100, so
 * expressions like `amount * (pct / 100)` accumulate rounding errors when
 * summed across many transactions. This module eliminates that by performing
 * the multiplication entirely in integer minor-unit (kobo/cent) space:
 *
 *   amountMinor   = round(amount × 100)          — major units → kobo
 *   basisPoints   = round(percentage × 100)       — percent → basis points
 *   allocMinor    = round(amountMinor × basisPoints / 10_000)
 *   result        = allocMinor / 100              — kobo → major units
 *
 * The largest intermediate value (amountMinor × basisPoints) is bounded by
 * ~10^14 for realistic NGN amounts (≤ 10^8), safely within MAX_SAFE_INTEGER.
 */

/**
 * Allocate a percentage of an amount with finance-safe integer arithmetic.
 * Both inputs are in major currency units / plain percent (e.g. 16.67 for 16.67%).
 * Returns a value rounded to 2 decimal places (kobo precision).
 */
export function allocatePercent(amount: number, percentage: number): number {
  const amountMinor = Math.round(amount * 100)
  const basisPoints = Math.round(percentage * 100)
  const allocatedMinor = Math.round((amountMinor * basisPoints) / 10_000)
  return allocatedMinor / 100
}
