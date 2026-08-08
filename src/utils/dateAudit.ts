import { parseDate, type DateFormat } from './parseDate'

/**
 * Audit the date column of a statement BEFORE anything is written.
 *
 * parseDate now rejects a cell outright rather than guessing at it, so every
 * failure here shows up as `parsed === null`. That is correct but not, on its
 * own, informative — "could not be read" doesn't tell a treasurer whether the
 * fix is the format selector or the file itself. This classifies WHY a cell
 * failed, from its raw shape, so the three real causes stay distinguishable:
 *
 *   the number 2026     a year, not an Excel serial
 *   the string "2026"   a year with no day or month
 *   "5-Jan"              a day and month with no year
 *
 * Running here rather than against stored data means the RAW cell is still in
 * hand, so these are identified exactly rather than guessed at from wreckage.
 */

export type DateSymptom =
  | 'year-as-serial'
  | 'bare-year'
  | 'missing-year'
  | 'unparsed'
  | 'out-of-range'

export interface DateAuditSample {
  /** The cell exactly as it appears in the file. */
  raw:    string
  /** What it parsed to, or null when it did not parse at all. */
  parsed: string | null
  /** 1-based row number in the sheet, so the user can go and look. */
  row:    number
}

export interface DateAuditFinding {
  symptom: DateSymptom
  count:   number
  samples: DateAuditSample[]
  /** True when the rows are certainly wrong and the import must not proceed. */
  blocking: boolean
}

export interface DateAudit {
  /** Rows carrying a date cell — the denominator for everything below. */
  total:    number
  findings: DateAuditFinding[]
  blocking: boolean
}

const MAX_SAMPLES = 5

// Mirrors parseDate's own floor: below this a number in a date column is
// overwhelmingly a bare year, not a serial.
const MIN_PLAUSIBLE_SERIAL = 20000

/**
 * Rows whose date falls far outside the rest of the statement are flagged
 * against the statement's OWN spread rather than a fixed cut-off, so the check
 * holds for any organisation and any period.
 *
 * The spread is measured across the middle half of the dates, not min to max.
 * Using the full range lets a single wild outlier widen the range enough to
 * contain itself — one date in 2019 among a month of 2026 dates makes the span
 * seven years, and nothing is ever out of range.
 *
 * Three interquartile widths either side of the median, floored at 400 days, so
 * a statement covering a month and one covering a year are both left alone.
 */
function outOfRangeBounds(dates: string[]): { lo: string; hi: string } | null {
  const sorted = [...dates].sort()
  if (sorted.length < 4) return null
  const at = (q: number) => Date.parse(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))])
  const iqr    = Math.max(0, at(0.75) - at(0.25))
  const margin = Math.max(iqr * 3, 400 * 86_400_000)
  const median = at(0.5)
  const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10)
  return { lo: iso(median - margin), hi: iso(median + margin) }
}

/** Classifies why a cell that parseDate rejected looks the way it does. */
function classifyRejected(raw: unknown, rawText: string): DateSymptom {
  if (typeof raw === 'number' && raw < MIN_PLAUSIBLE_SERIAL) return 'year-as-serial'
  if (/^\d{4}$/.test(rawText)) return 'bare-year'
  // A day-and-month shape with no year: "5-Jan", "Jan-5", or a bare two-part
  // numeric like "5/1" with nothing that could be a year.
  const twoPartNumeric = /^(\d{1,2})[\s\-./](\d{1,2})$/.test(rawText)
  const dayMonthName   = /^(\d{1,2})[\s\-./]+[A-Za-z]{3,}$/.test(rawText)
                       || /^[A-Za-z]{3,}[\s\-./]+\d{1,2}$/.test(rawText)
  if (twoPartNumeric || dayMonthName) return 'missing-year'
  return 'unparsed'
}

export function auditDateColumn(
  cells: unknown[],
  dateFormat: DateFormat,
): DateAudit {
  const buckets = new Map<DateSymptom, DateAuditSample[]>()
  const counts  = new Map<DateSymptom, number>()
  const add = (symptom: DateSymptom, sample: DateAuditSample) => {
    counts.set(symptom, (counts.get(symptom) ?? 0) + 1)
    const arr = buckets.get(symptom) ?? []
    if (arr.length < MAX_SAMPLES) { arr.push(sample); buckets.set(symptom, arr) }
  }

  const parsedDates: string[] = []
  const rows: { raw: unknown; parsed: string | null; row: number }[] = []
  let total = 0

  for (let i = 0; i < cells.length; i++) {
    const raw = cells[i]
    if (raw == null || raw === '') continue     // no date cell — not this check's business
    total++
    const parsed = parseDate(raw, dateFormat)
    rows.push({ raw, parsed, row: i + 1 })
    if (parsed) parsedDates.push(parsed)
  }

  const bounds = outOfRangeBounds(parsedDates)

  for (const { raw, parsed, row } of rows) {
    const rawText = String(raw).trim()
    const sample: DateAuditSample = { raw: rawText, parsed, row }

    if (parsed === null) { add(classifyRejected(raw, rawText), sample); continue }
    if (bounds && (parsed < bounds.lo || parsed > bounds.hi)) { add('out-of-range', sample); continue }
  }

  // Every rejection is a structural certainty: parseDate already refused the
  // cell. Out-of-range is inference over rows that DID parse, so it warns
  // instead of blocking.
  const BLOCKING: Record<DateSymptom, boolean> = {
    'year-as-serial': true,
    'bare-year':      true,
    'missing-year':   true,
    'unparsed':       true,
    'out-of-range':   false,
  }

  const order: DateSymptom[] = ['unparsed', 'year-as-serial', 'bare-year', 'missing-year', 'out-of-range']
  const findings = order
    .filter(s => (counts.get(s) ?? 0) > 0)
    .map(s => ({
      symptom:  s,
      count:    counts.get(s) ?? 0,
      samples:  buckets.get(s) ?? [],
      blocking: BLOCKING[s],
    }))

  return { total, findings, blocking: findings.some(f => f.blocking) }
}

export const DATE_SYMPTOM_TEXT: Record<DateSymptom, { title: string; detail: string }> = {
  'unparsed': {
    title:  'could not be read as dates',
    detail: 'These rows would be dropped without warning. Check the date format above matches the file — ' +
            'formats like 18-07-2025, 18/07/25 and 18.07.2025 need the matching selection.',
  },
  'year-as-serial': {
    title:  'contain a year, not a date',
    detail: 'The cell holds a plain number such as 2026, which is not a usable date. ' +
            'The date column may be pointing at the wrong column.',
  },
  'bare-year': {
    title:  'contain only a year',
    detail: 'There is no day or month in the cell, so this row cannot be dated automatically.',
  },
  'missing-year': {
    title:  'have a day and month but no year',
    detail: 'Cells like "5-Jan" carry no year, so this row cannot be dated automatically.',
  },
  'out-of-range': {
    title:  'fall well outside the rest of the statement',
    detail: 'These may be genuine — check them against the file before continuing.',
  },
}
