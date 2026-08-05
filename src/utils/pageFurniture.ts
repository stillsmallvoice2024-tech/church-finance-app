/**
 * Removes page furniture — page numbers, support contacts, URLs, straplines —
 * that has bled into extracted table cells.
 *
 * Both extraction paths can leak it. The native parser drops furniture *rows*
 * structurally, but a vision-OCR pass reads the page as a picture and will
 * sometimes fold a footer block into the nearest transaction row, producing
 * cells like `12/01/2026 (0700PARALLEX) 070072725539` or
 * `Page: 1 of 8 MOB:TRF TO THE STANDING CHURCH INTERNATIONAL`.
 *
 * The hard constraint is that a legitimately wrapped cell must survive
 * untouched, so nothing is stripped on "looks like noise" grounds. Two tiers:
 *
 *  • Tier 1 — shapes that cannot occur in a real statement cell (a
 *    `Page: N of M` marker, an e-mail address, a URL, a known strapline).
 *    Removed unconditionally.
 *  • Tier 2 — shapes that *might* be real data (a bare domain, a long digit
 *    run, a parenthesised support code). A reference number can look exactly
 *    like these, so they are removed only with corroborating evidence: the same
 *    fragment must recur across pages. Footers repeat on every page; a wrapped
 *    narration belongs to one transaction and never does.
 */

// ── Tier 1: unambiguous furniture ──────────────────────────────────────────────

const PAGE_MARKER_RE = /\bpage\s*:?\s*\d+\s*(?:of|\/)\s*\d+\b/gi
const EMAIL_RE       = /\b[\w.+-]+@[\w-]+\.[\w.-]{2,}\b/g
const URL_RE         = /\bhttps?:\/\/\S+|\bwww\.[\w-]+(?:\.[\w-]+)+/gi

const STRAPLINE_RE = new RegExp(
  [
    'need help', 'customer (?:care|service)', 'please call', 'call us',
    'contact (?:us|centre|center)', 'for enquir(?:y|ies)',
    'all rights reserved', 'terms\\s*(?:and|&)\\s*conditions',
    'computer[- ]generated', 'no signature (?:is )?required',
    'end of statement', 'this is a system generated', 'disclaimer',
  ].join('|'),
  'gi',
)

const TIER1: RegExp[] = [PAGE_MARKER_RE, EMAIL_RE, URL_RE, STRAPLINE_RE]

// ── Tier 2: needs cross-page corroboration ─────────────────────────────────────

const BARE_DOMAIN_RE = /\b[\w-]+\.(?:com|net|org|ng|co|io|uk|us|info|biz)(?:\.[a-z]{2})?\b/gi
/** A parenthesised token mixing letters and digits, e.g. `(0700PARALLEX)`. */
const SUPPORT_CODE_RE = /\((?=[^)]*[A-Za-z])(?=[^)]*\d)[A-Za-z0-9 .-]{4,}\)/g
/** Eight or more contiguous digits/dashes — a helpline such as `070072725539`. */
const LONG_DIGITS_RE = /\b\d[\d-]{6,}\d\b/g
/** A helpline written in spaced groups, e.g. `0700 2255 2528`. */
const SPACED_PHONE_RE = /\b\d{3,4}(?:\s\d{3,4}){2,}\b/g

const TIER2: RegExp[] = [BARE_DOMAIN_RE, SUPPORT_CODE_RE, LONG_DIGITS_RE, SPACED_PHONE_RE]

// ── Tier 3: what the column itself says the cell should be ─────────────────────

/**
 * Cross-page corroboration cannot catch everything. A footer that a bank prints
 * on only some pages, or on few enough of them to miss the threshold, still
 * lands in a cell — and on a long statement the threshold is high.
 *
 * But a date column holds dates. When a column's own values establish it as a
 * single scalar type, any cell in it that is that type *plus trailing debris*
 * can be reduced to the type, whatever the debris happens to be. This needs no
 * page evidence, no pattern list, and no guess about how the bank lays out its
 * footers — the column's other 150 rows are the evidence.
 *
 * The purity threshold is what keeps it safe: a narration column is never
 * overwhelmingly bare dates or bare amounts, so it is never subject to this.
 */
const MONTH_NAME = '(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*'
const DATE_TOKEN_RE = new RegExp(
  `\\d{1,4}[-/.]\\d{1,2}[-/.]\\d{2,4}|\\d{1,2}[-/ ]${MONTH_NAME}[-/ ]\\d{2,4}`,
  'i',
)

/** A column must be at least this pure before its type is used to tidy cells. */
const COLUMN_TYPE_PURITY = 0.7
/** Below this many populated cells a column has not established anything. */
const MIN_COLUMN_SAMPLES = 4

function isPureDate(value: string): boolean {
  const m = value.trim().match(DATE_TOKEN_RE)
  return m !== null && m[0] === value.trim()
}

/**
 * Reduces cells to the column's established type. Only touches a cell that
 * *starts* with a clean value of that type — debris appended to a good value.
 * A cell that is entirely something else is left alone rather than mangled.
 */
function tidyTypedColumns(rows: string[][], onRemoved: (fragment: string) => void): string[][] {
  const colCount = rows.reduce((n, r) => Math.max(n, r.length), 0)
  if (rows.length < MIN_COLUMN_SAMPLES) return rows

  const dateColumns = new Set<number>()
  for (let ci = 0; ci < colCount; ci++) {
    const populated = rows.map(r => (r[ci] ?? '').trim()).filter(Boolean)
    if (populated.length < MIN_COLUMN_SAMPLES) continue
    const pure = populated.filter(isPureDate).length
    if (pure / populated.length >= COLUMN_TYPE_PURITY) dateColumns.add(ci)
  }
  if (dateColumns.size === 0) return rows

  return rows.map(row => row.map((cell, ci) => {
    if (!dateColumns.has(ci)) return cell
    const value = String(cell ?? '').trim()
    if (!value || isPureDate(value)) return cell
    const m = value.match(DATE_TOKEN_RE)
    // Only when the date leads the cell — otherwise this is not a date with
    // debris appended and guessing which part to keep would be destructive.
    if (!m || m.index !== 0) return cell
    const remainder = value.slice(m[0].length).trim()
    if (remainder) onRemoved(remainder)
    return m[0]
  }))
}

// ── Repetition evidence ────────────────────────────────────────────────────────

/**
 * Identity used for cross-page corroboration.
 *
 * Deliberately digit-*sensitive*: real Tier 2 furniture (a helpline, a support
 * code, a domain) is byte-identical on every page, whereas two distinct
 * reference numbers differ only in their digits. Blanking digits would let
 * `000013202608021` and `000013202608099` vouch for each other and get both
 * transactions' references deleted.
 */
function furnitureKey(fragment: string): string {
  return fragment.toLowerCase().replace(/\s+/g, ' ').trim()
}

function matchesOf(text: string, patterns: RegExp[]): string[] {
  const out: string[] = []
  for (const re of patterns) {
    // Each pattern is global; reset lastIndex so reuse across cells is safe.
    re.lastIndex = 0
    for (const m of text.matchAll(re)) out.push(m[0])
  }
  return out
}

export interface FurnitureStripResult {
  rows: string[][]
  /** Indices into the original array of the rows that survived, in order. */
  keptIndices: number[]
  /** Distinct fragments that were removed, for surfacing to the user. */
  removedFragments: string[]
}

/**
 * Strips page furniture from every cell.
 *
 * `rowPages` maps each row to the page it came from. Without it there is no
 * cross-page evidence, so only Tier 1 applies — the conservative choice, since
 * a Tier 2 pattern with no corroboration is indistinguishable from a reference
 * number.
 */
export function stripPageFurniture(rows: string[][], rowPages?: number[]): FurnitureStripResult {
  if (rows.length === 0) return { rows: [], keptIndices: [], removedFragments: [] }

  const removeAll = (text: string, fragments: string[]): string =>
    fragments.reduce((acc, frag) => acc.split(frag).join(' '), text)

  // Tier 2 candidates must be discovered exactly as the scrub pass will see
  // them: per cell, after Tier 1 removal. Scanning a whole joined row instead
  // would let a pattern run across a column boundary and produce a fragment
  // that never matches the per-cell one.
  const tier2Of = (cell: string): string[] =>
    matchesOf(removeAll(cell, matchesOf(cell, TIER1)), TIER2)

  // Which Tier 2 forms recur across pages? Footers do; transaction data does not.
  const pagesByKey = new Map<string, Set<number>>()
  if (rowPages) {
    rows.forEach((row, ri) => {
      const page = rowPages[ri]
      if (page === undefined) return
      for (const cell of row) {
        for (const frag of tier2Of(String(cell ?? ''))) {
          const key = furnitureKey(frag)
          if (!pagesByKey.has(key)) pagesByKey.set(key, new Set())
          pagesByKey.get(key)!.add(page)
        }
      }
    })
  }

  const distinctPages = rowPages ? new Set(rowPages.filter(p => p !== undefined)).size : 1
  // Two pages is enough to distinguish a repeating footer from row content;
  // on longer documents require the fragment to be present on most of them.
  const minPages = distinctPages >= 4 ? Math.ceil(distinctPages * 0.6) : 2

  const isCorroborated = (fragment: string): boolean => {
    if (distinctPages < 2) return false
    return (pagesByKey.get(furnitureKey(fragment))?.size ?? 0) >= minPages
  }

  const removed = new Set<string>()

  const scrub = (cell: string): string => {
    const tier1 = matchesOf(cell, TIER1)
    tier1.forEach(f => removed.add(f.trim()))
    let out = removeAll(cell, tier1)

    const tier2 = matchesOf(out, TIER2).filter(isCorroborated)
    tier2.forEach(f => removed.add(f.trim()))
    out = removeAll(out, tier2)
    // Tidy the seams left behind, without touching internal cell punctuation.
    return out.replace(/\s+/g, ' ').replace(/^[\s:;,|/-]+|[\s:;,|/-]+$/g, '').trim()
  }

  const cleanedRows: string[][] = []
  const keptIndices: number[] = []

  rows.forEach((row, ri) => {
    const cleaned = row.map(cell => scrub(String(cell ?? '')))
    // A row that was nothing but furniture disappears entirely.
    if (cleaned.some(c => c.trim())) {
      cleanedRows.push(cleaned)
      keptIndices.push(ri)
    }
  })

  const tidied = tidyTypedColumns(cleanedRows, f => removed.add(f))

  return { rows: tidied, keptIndices, removedFragments: [...removed].sort() }
}
