import type { DateFormat } from './parseDate'

/**
 * Decide which arrangement a statement's date column uses, from the DISPLAYED
 * text of the cells (the same text the preview shows — see ParsedSheet.
 * displayRows in ImportModal.tsx). This never chooses silently: the caller
 * always gets back which format it picked and, critically, WHY — a row and its
 * two numbers — so a wrong guess is visible and fixable rather than a black box
 * the user has to trust.
 *
 * The one case detection cannot resolve on its own is the one that matters
 * most to get right: every date in the column has both components ≤ 12, so
 * 5/7/2026 could be 5 July or 7 May and nothing in the file says which. That is
 * reported as `ambiguous`, not guessed at — the radios stay live, pre-selected
 * on the safer default, and the user decides.
 */

export type DetectionResult =
  | { kind: 'excel-serial' }                                    // numeric cells — no ambiguity, format is moot
  | { kind: 'iso' }                                              // YYYY-MM-DD / leading 4-digit year — no ambiguity
  | { kind: 'month-name' }                                       // e.g. "18-Jul-2025" — day/month order is spelled out
  | { kind: 'decided'; format: DateFormat; row: number; a: number; b: number }
  | { kind: 'ambiguous'; sampleCount: number }
  | { kind: 'no-evidence' }                                      // column empty, or nothing recognisable

const MONTHS = new Set(['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'])

// Same invisible-character set normalizeId strips (soft hyphen U+00AD, NBSP
// U+00A0, ZWSP/ZWNJ/ZWJ U+200B-200D, LS/PS U+2028-2029, BOM U+FEFF) — a
// display string pulled from a cell can carry these even though nothing about
// it looks unusual on screen.
function clean(text: string): string {
  return text
    .normalize('NFC')
    .replace(/\u00ad|\u00a0|\u200b|\u200c|\u200d|\u2028|\u2029|\ufeff/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Pulls the two non-year numeric components out of a date-shaped string cell. */
function splitComponents(text: string): { a: number; b: number } | null {
  const m = text.match(/^(\d{1,2})[\s\-./](\d{1,2})[\s\-./](\d{2,4})$/)
  if (!m) return null
  return { a: Number(m[1]), b: Number(m[2]) }
}

/**
 * True for a cell that spells the month out — "18-Jul-2025", "18 July 2025",
 * "Jul 18, 2025". Common as Excel's OWN default rendering for a date cell, not
 * just a manually-typed format, so this is not a rare case to special-case
 * around: without it, a file using this display never produces numeric
 * evidence at all and detection falls all the way through to "no-evidence" —
 * exactly the silent-miss this function exists to avoid.
 * Day/month order needs no decision here — the name says which is which,
 * independent of the DD/MM vs MM/DD selection (parseDate's named-month branch
 * ignores that argument for the same reason).
 */
function isMonthNameDate(text: string): boolean {
  const named = text.match(/^(\d{1,2})[\s\-./]+([A-Za-z]{3,})[\s\-./,]+(\d{2,4})$/)
             ?? text.match(/^([A-Za-z]{3,})[\s\-./]+(\d{1,2})[\s\-./,]+(\d{2,4})$/)
  if (!named) return false
  const monthFirst = /^[A-Za-z]/.test(named[1])
  const mName = (monthFirst ? named[1] : named[2]).slice(0, 3).toLowerCase()
  return MONTHS.has(mName)
}

export function detectDateFormat(displayCells: unknown[]): DetectionResult {
  let sawNumeric   = false
  let sawIso       = false
  let sawMonthName = false
  let decisive: { row: number; a: number; b: number; format: DateFormat } | null = null
  let ambiguousCount = 0

  for (let i = 0; i < displayCells.length; i++) {
    const raw = displayCells[i]
    if (raw == null || raw === '') continue

    if (typeof raw === 'number') { sawNumeric = true; continue }

    const text = clean(String(raw))
    if (text === '') continue
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) { sawIso = true; continue }
    if (isMonthNameDate(text)) { sawMonthName = true; continue }

    const parts = splitComponents(text)
    if (!parts) continue
    const { a, b } = parts

    // A component over 12 can only be a day — no month goes past 12 — which
    // fixes which position is which, definitively, from this row alone.
    if (!decisive) {
      // First number > 12: it must be the day, so the day comes first.
      if (a > 12 && b <= 12) decisive = { row: i + 1, a, b, format: 'DD/MM/YYYY' }
      // Second number > 12: IT must be the day, so the day comes second.
      else if (b > 12 && a <= 12) decisive = { row: i + 1, a, b, format: 'MM/DD/YYYY' }
    }
    if (a <= 12 && b <= 12) ambiguousCount++
  }

  if (decisive) return { kind: 'decided', format: decisive.format, row: decisive.row, a: decisive.a, b: decisive.b }
  if (sawNumeric && !sawIso && !sawMonthName) return { kind: 'excel-serial' }
  if (sawIso) return { kind: 'iso' }
  if (sawMonthName) return { kind: 'month-name' }
  if (ambiguousCount > 0) return { kind: 'ambiguous', sampleCount: ambiguousCount }
  return { kind: 'no-evidence' }
}
