import { parseDate, type DateFormat } from './parseDate'

/**
 * Audit the date column of a statement BEFORE anything is written.
 *
 * Dates were being accepted silently whether or not they parsed sensibly, and
 * the damage only surfaced months later in reports. Three real failures, all
 * traced back to parseDate's `new Date(s)` fallback ignoring the chosen format:
 *
 *   the number 2026        an Excel serial read as a date -> 1905-07-18
 *   the string "2026"      -> 2026-01-01, the year right and the day invented
 *   "5-Jan" (no year)      -> 2001-01-05, V8's default year
 *
 * A fourth is quieter and worse: "18-07-2025", "18/07/25" and "18.07.2025" all
 * parse to null, and a null date makes the import skip the row entirely. A
 * statement in any of those formats loses transactions with no error.
 *
 * Running here rather than against stored data means the RAW cell is still in
 * hand, so these are identified exactly rather than guessed at from the wreckage.
 */

export type DateSymptom =
  | 'unparsed'
  | 'year-as-serial'
  | 'bare-year'
  | 'missing-year'
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

// Excel serials count days from 1899-12-30. A real statement date is ~45000 and
// climbing; 20000 is 1954. Anything below that in a date column is not a date —
// overwhelmingly it is a bare year (2024, 2025, 2026) that landed in the cell.
const MIN_PLAUSIBLE_SERIAL = 20000

// V8 defaults the year to 2001 when a string carries only a day and a month
// ("5-Jan", "22-Dec"). No statement this app imports predates 2024, so a parsed
// year of 2001 with no "2001" in the cell is that default, not a real date.
const JS_DEFAULT_YEAR = '2001'

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

    if (parsed === null) { add('unparsed', sample); continue }

    // A number too small to be a date. The parsed result is meaningless, but the
    // number itself is almost always the year.
    if (typeof raw === 'number' && raw < MIN_PLAUSIBLE_SERIAL) {
      add('year-as-serial', sample); continue
    }
    // A bare four-digit year as text: the year survives, the day and month were
    // never in the cell.
    if (/^\d{4}$/.test(rawText)) { add('bare-year', sample); continue }
    // Day and month present, year absent — parsed year is JS's default and the
    // cell says nothing of the sort.
    if (parsed.startsWith(`${JS_DEFAULT_YEAR}-`) && !rawText.includes(JS_DEFAULT_YEAR)) {
      add('missing-year', sample); continue
    }
    if (bounds && (parsed < bounds.lo || parsed > bounds.hi)) {
      add('out-of-range', sample); continue
    }
  }

  // Everything except out-of-range is a structural certainty: the cell cannot
  // mean what it parsed to. Out-of-range is inference, so it warns instead.
  const BLOCKING: Record<DateSymptom, boolean> = {
    'unparsed':       true,
    'year-as-serial': true,
    'bare-year':      true,
    'missing-year':   true,
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
            'formats like 18-07-2025, 18/07/25 and 18.07.2025 are not recognised.',
  },
  'year-as-serial': {
    title:  'contain a year, not a date',
    detail: 'The cell holds a plain number such as 2026. Read as a date it lands in 1905. ' +
            'The date column may be pointing at the wrong column.',
  },
  'bare-year': {
    title:  'contain only a year',
    detail: 'There is no day or month in the cell, so importing these would invent 1 January.',
  },
  'missing-year': {
    title:  'have a day and month but no year',
    detail: 'Cells like "5-Jan" carry no year, and importing them would date the transaction to 2001.',
  },
  'out-of-range': {
    title:  'fall well outside the rest of the statement',
    detail: 'These may be genuine — check them against the file before continuing.',
  },
}
