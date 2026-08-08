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
  | { kind: 'decided'; format: DateFormat; row: number; a: number; b: number }
  | { kind: 'ambiguous'; sampleCount: number }
  | { kind: 'no-evidence' }                                      // column empty, or nothing recognisable

/** Pulls the two non-year numeric components out of a date-shaped string cell. */
function splitComponents(text: string): { a: number; b: number } | null {
  const m = text.trim().match(/^(\d{1,2})[\s\-./](\d{1,2})[\s\-./](\d{2,4})$/)
  if (!m) return null
  return { a: Number(m[1]), b: Number(m[2]) }
}

export function detectDateFormat(displayCells: unknown[]): DetectionResult {
  let sawNumeric = false
  let sawIso     = false
  let decisive: { row: number; a: number; b: number; format: DateFormat } | null = null
  let ambiguousCount = 0

  for (let i = 0; i < displayCells.length; i++) {
    const raw = displayCells[i]
    if (raw == null || raw === '') continue

    if (typeof raw === 'number') { sawNumeric = true; continue }

    const text = String(raw).trim()
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) { sawIso = true; continue }

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
  if (sawNumeric && !sawIso) return { kind: 'excel-serial' }
  if (sawIso) return { kind: 'iso' }
  if (ambiguousCount > 0) return { kind: 'ambiguous', sampleCount: ambiguousCount }
  return { kind: 'no-evidence' }
}
