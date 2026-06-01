import * as XLSX from 'xlsx'

export type DateFormat = 'DD/MM/YYYY' | 'MM/DD/YYYY' | 'YYYY-MM-DD'

/**
 * Parse a raw cell value (number serial or string) into a YYYY-MM-DD string.
 * Treats all dates as date-only values — no timezone conversion is applied.
 * Using toISOString() would shift dates in UTC+ timezones (e.g. WAT/UTC+1 turns
 * 31 May midnight local into 30 May 23:00 UTC → off-by-one day).
 */
export function parseDate(raw: unknown, format: DateFormat = 'DD/MM/YYYY'): string | null {
  if (raw == null || raw === '') return null

  if (typeof raw === 'number') {
    const d = XLSX.SSF.parse_date_code(raw)
    if (d) {
      const yy = d.y.toString().padStart(4, '0')
      const mm = String(d.m).padStart(2, '0')
      const dd = String(d.d).padStart(2, '0')
      return `${yy}-${mm}-${dd}`
    }
    return null
  }

  const s = String(raw).trim()

  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s

  const parts = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (parts) {
    const [, g1, g2, g3] = parts
    if (format === 'MM/DD/YYYY') return `${g3}-${g1.padStart(2, '0')}-${g2.padStart(2, '0')}`
    return `${g3}-${g2.padStart(2, '0')}-${g1.padStart(2, '0')}`
  }

  // Fallback: let the JS engine attempt parsing.
  // Use local date getters (not toISOString/UTC) so the calendar date is preserved
  // regardless of the runtime's timezone offset.
  const parsed = new Date(s)
  if (!isNaN(parsed.getTime())) {
    const y = parsed.getFullYear()
    const m = String(parsed.getMonth() + 1).padStart(2, '0')
    const d = String(parsed.getDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
  }

  return null
}
