import * as XLSX from 'xlsx'

export type DateFormat = 'DD/MM/YYYY' | 'MM/DD/YYYY' | 'YYYY-MM-DD'

/**
 * Excel stores a date as a count of days from 1899-12-30. A real statement date
 * is ~45000 and climbing; 20000 is 1954. A smaller number in a date column is
 * not a date — overwhelmingly it is a bare year (2024, 2025, 2026) sitting in
 * the cell, which read as a serial lands in 1905.
 */
const MIN_PLAUSIBLE_SERIAL = 20000

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
}

/** Reject 31 April and friends — the calendar has to agree. */
function ymd(y: number, m: number, d: number): string | null {
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return null
  if (m < 1 || m > 12 || d < 1 || d > 31) return null
  const probe = new Date(Date.UTC(y, m - 1, d))
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) return null
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

/** Two-digit years: 00-79 are this century, 80-99 the last. */
function expandYear(y: number, digits: number): number {
  if (digits >= 4) return y
  return y < 80 ? 2000 + y : 1900 + y
}

/**
 * Parse a raw cell value into a YYYY-MM-DD string, or null when the cell does
 * not carry a date.
 *
 * `format` is the arrangement the user chose for THIS file, and it is honoured
 * everywhere. It previously governed one branch only: anything the strict
 * `d/m/yyyy` regex missed fell through to `new Date(s)`, which applied its own
 * rules and produced silent, confident nonsense —
 *
 *   "5-Jan"      -> 2001-01-05   a year nobody wrote, V8's default
 *   "2026"       -> 2026-01-01   a day and month nobody wrote
 *   "18-07-2025" -> null         and the row was dropped without a word
 *
 * There is no such fallback now. A cell either matches a shape this function
 * understands, under the chosen arrangement, or it returns null and the import's
 * date audit reports it before anything is written.
 *
 * The arrangement settles ONE question: whether the day or the month comes
 * first. Everything else is read from the cell itself — a leading four-digit
 * group is a year wherever the user's choice says otherwise, because that is
 * structural rather than a matter of convention.
 *
 * All dates are treated as date-only. Using toISOString() would shift them in
 * UTC+ timezones (WAT/UTC+1 turns 31 May midnight local into 30 May 23:00 UTC).
 */
export function parseDate(raw: unknown, format: DateFormat = 'DD/MM/YYYY'): string | null {
  if (raw == null || raw === '') return null

  // Excel may hand back a real Date when the workbook is read with cellDates.
  if (raw instanceof Date) {
    return isNaN(raw.getTime()) ? null : ymd(raw.getFullYear(), raw.getMonth() + 1, raw.getDate())
  }

  if (typeof raw === 'number') {
    if (!isFinite(raw) || raw < MIN_PLAUSIBLE_SERIAL) return null
    const d = XLSX.SSF.parse_date_code(raw)
    return d ? ymd(d.y, d.m, d.d) : null
  }

  const s = String(raw).trim()
  if (s === '') return null

  // ── Month-name forms: 18-Jul-2025, 18 July 2025, Jul 18 2025, Jul-18-2025 ──
  // The month is named, so the arrangement has nothing to settle. A year must be
  // present: without one there is nothing to infer it from here.
  const named = s.match(/^(\d{1,2})[\s\-./]+([A-Za-z]{3,})[\s\-./,]+(\d{2,4})$/)
             ?? s.match(/^([A-Za-z]{3,})[\s\-./]+(\d{1,2})[\s\-./,]+(\d{2,4})$/)
  if (named) {
    const monthFirst = /^[A-Za-z]/.test(named[1])
    const mName = (monthFirst ? named[1] : named[2]).slice(0, 3).toLowerCase()
    const day   = Number(monthFirst ? named[2] : named[1])
    const yText = named[3]
    const month = MONTHS[mName]
    if (!month) return null
    return ymd(expandYear(Number(yText), yText.length), month, day)
  }

  // ── Numeric forms: separated by / - . or whitespace ────────────────────────
  const parts = s.match(/^(\d{1,4})[\s\-./](\d{1,2})[\s\-./](\d{1,4})$/)
  if (!parts) return null
  const [, p1, p2, p3] = parts

  // A leading four-digit group is a year — structural, not conventional, so it
  // is read that way whatever arrangement was chosen.
  if (p1.length === 4) return ymd(Number(p1), Number(p2), Number(p3))

  // Otherwise the year is last, and the arrangement decides the other two.
  if (p3.length === 3) return null                    // 3-digit year is not a year
  const year = expandYear(Number(p3), p3.length)
  return format === 'MM/DD/YYYY'
    ? ymd(year, Number(p1), Number(p2))
    : ymd(year, Number(p2), Number(p1))
}
