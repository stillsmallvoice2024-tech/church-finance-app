/**
 * Regression tests for parseDate — ensures transaction_date is preserved exactly
 * as shown in the bank statement, with no timezone-induced day shift.
 *
 * Root cause (fixed): the old fallback used new Date(s).toISOString().slice(0,10)
 * which converts local midnight to UTC. In UTC+1 (WAT, Nigeria) that shifts
 * "31 May" to "30 May". Fix uses local date getters instead.
 */

import { describe, it, expect } from 'vitest'
import { parseDate } from '../parseDate'

// ---------------------------------------------------------------------------


// ---------------------------------------------------------------------------
// 1. Excel date serial numbers (XLSX.SSF.parse_date_code path)
// ---------------------------------------------------------------------------

describe('parseDate — Excel serial numbers', () => {
  it('converts serial 45808 (31 May 2025) to 2025-05-31', () => {
    expect(parseDate(45808)).toBe('2025-05-31')
  })

  it('converts serial 45809 (1 Jun 2025) to 2025-06-01', () => {
    expect(parseDate(45809)).toBe('2025-06-01')
  })

  it('converts serial 45778 (1 May 2025) to 2025-05-01', () => {
    expect(parseDate(45778)).toBe('2025-05-01')
  })
})

// ---------------------------------------------------------------------------
// 2. ISO string pass-through
// ---------------------------------------------------------------------------

describe('parseDate — ISO YYYY-MM-DD strings', () => {
  it('returns 2025-05-31 unchanged', () => {
    expect(parseDate('2025-05-31')).toBe('2025-05-31')
  })

  it('returns 2025-01-01 unchanged', () => {
    expect(parseDate('2025-01-01')).toBe('2025-01-01')
  })
})

// ---------------------------------------------------------------------------
// 3. DD/MM/YYYY slash format (default — most Nigerian bank statements)
// ---------------------------------------------------------------------------

describe('parseDate — DD/MM/YYYY (default format)', () => {
  it('31/05/2025 → 2025-05-31', () => {
    expect(parseDate('31/05/2025')).toBe('2025-05-31')
  })

  it('01/05/2025 → 2025-05-01', () => {
    expect(parseDate('01/05/2025')).toBe('2025-05-01')
  })

  it('01/01/2026 → 2026-01-01', () => {
    expect(parseDate('01/01/2026')).toBe('2026-01-01')
  })
})

// ---------------------------------------------------------------------------
// 4. MM/DD/YYYY slash format
// ---------------------------------------------------------------------------

describe('parseDate — MM/DD/YYYY format', () => {
  it('05/31/2025 → 2025-05-31', () => {
    expect(parseDate('05/31/2025', 'MM/DD/YYYY')).toBe('2025-05-31')
  })

  it('01/01/2026 → 2026-01-01', () => {
    expect(parseDate('01/01/2026', 'MM/DD/YYYY')).toBe('2026-01-01')
  })
})

// ---------------------------------------------------------------------------
// 5. Fallback (JS Date constructor path) — THIS IS WHERE THE BUG WAS
//    PDF statements and unusual Excel text cells produce formats like:
//    "31 May 2025", "May 31, 2025", "31-May-25", "31-May-2025"
//
//    The fix uses getFullYear/getMonth/getDate (LOCAL) instead of toISOString (UTC)
//    so the calendar date is preserved regardless of the runtime's UTC offset.
// ---------------------------------------------------------------------------

describe('parseDate — fallback string formats (timezone-safe)', () => {
  it('"31 May 2025" → 2025-05-31 (no day shift in any UTC offset)', () => {
    const result = parseDate('31 May 2025')
    expect(result).toBe('2025-05-31')
  })

  it('"May 31, 2025" → 2025-05-31', () => {
    const result = parseDate('May 31, 2025')
    expect(result).toBe('2025-05-31')
  })

  it('"01 May 2025" → 2025-05-01', () => {
    expect(parseDate('01 May 2025')).toBe('2025-05-01')
  })

  it('"1 June 2025" → 2025-06-01', () => {
    expect(parseDate('1 June 2025')).toBe('2025-06-01')
  })

  it('"31 December 2025" → 2025-12-31', () => {
    expect(parseDate('31 December 2025')).toBe('2025-12-31')
  })

  it('"January 1, 2026" → 2026-01-01', () => {
    expect(parseDate('January 1, 2026')).toBe('2026-01-01')
  })
})

// ---------------------------------------------------------------------------
// 6. Edge / null cases
// ---------------------------------------------------------------------------

describe('parseDate — null / empty / invalid inputs', () => {
  it('null → null', () => {
    expect(parseDate(null)).toBeNull()
  })

  it('empty string → null', () => {
    expect(parseDate('')).toBeNull()
  })

  it('undefined → null', () => {
    expect(parseDate(undefined)).toBeNull()
  })

  it('garbage string → null', () => {
    expect(parseDate('not a date')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// 7. Regression: verify result is never off by one day
//    Simulate UTC+1 by checking the local-getter result matches the expected date.
//    (These pass in every timezone because local getters are used.)
// ---------------------------------------------------------------------------

describe('parseDate — regression: no off-by-one day across UTC offsets', () => {
  const cases: Array<[unknown, string]> = [
    ['31 May 2025',  '2025-05-31'],
    ['30 May 2025',  '2025-05-30'],
    ['1 May 2025',   '2025-05-01'],
    ['31/05/2025',   '2025-05-31'],
    ['30/05/2025',   '2025-05-30'],
    [45808,          '2025-05-31'], // Excel serial for 31 May 2025
    ['2025-05-31',   '2025-05-31'],
  ]

  for (const [input, expected] of cases) {
    it(`parseDate(${JSON.stringify(input)}) === ${expected}`, () => {
      expect(parseDate(input)).toBe(expected)
    })
  }
})
