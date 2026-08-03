/**
 * Geometry-driven table extraction for PDF bank statements.
 *
 * Deliberately free of any pdfjs import so the logic stays unit-testable in a
 * plain Node environment — `pdfParser.ts` owns the pdfjs plumbing and feeds
 * positioned text runs in here.
 */

// ── Geometry primitives ────────────────────────────────────────────────────────

/** A single text run positioned on the page. `y` grows downwards. */
export interface PdfTextItem {
  x: number
  xEnd: number
  y: number
  height: number
  text: string
}

export interface PdfPageItems {
  height: number
  items: PdfTextItem[]
}

interface TextRow {
  /** Page-local Y (top-down). */
  y: number
  /** Y offset by all preceding page heights — safe for cross-page comparisons. */
  globalY: number
  items: PdfTextItem[]
}

const DEFAULT_FONT_SIZE = 10

// ── Cell content classifiers ───────────────────────────────────────────────────

const MONTH = '(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)'

const NUMERIC_DATE_RE = /(?:^|[^\d])\d{1,4}[-/.]\d{1,2}[-/.]\d{2,4}(?:[^\d]|$)/
const NAMED_DATE_RE   = new RegExp(`\\d{1,2}\\s*[-/ ]\\s*${MONTH}[a-z]*\\s*[-/ ]\\s*\\d{2,4}`, 'i')
const NAMED_DATE_ALT  = new RegExp(`${MONTH}[a-z]*\\s+\\d{1,2},?\\s+\\d{4}`, 'i')

/** True when the cell contains something that reads as a calendar date. */
export function isDateLike(value: string): boolean {
  const v = value.trim()
  if (!v) return false
  return NUMERIC_DATE_RE.test(v) || NAMED_DATE_RE.test(v) || NAMED_DATE_ALT.test(v)
}

/**
 * True when the cell is *essentially just a number* — optionally wrapped in
 * accounting parentheses, signed, currency-prefixed or DR/CR-suffixed.
 * Deliberately strict: narration text containing digits must not match.
 */
export function isAmountLike(value: string): boolean {
  const v = value.trim()
  if (!v) return false
  return /^[(\-+]?\s*(?:[₦$£€¥₹]|[A-Z]{3}\s)?\s*\d[\d,\s]*(?:\.\d+)?\s*(?:cr|dr)?\s*\)?$/i.test(v)
}

/** Boilerplate that banks print above/below the table and must never become a row. */
const BOILERPLATE_RE = new RegExp(
  [
    'need help', 'customer (?:care|service)', 'please call', 'call us', 'contact (?:us|centre|center)',
    'e-?mail\\s*[:.]', 'https?://', 'www\\.', '@[\\w.-]+\\.\\w{2,}',
    'page\\s+\\d+\\s+of\\s+\\d+', 'all rights reserved', 'terms\\s*(?:and|&)\\s*conditions',
    'computer[- ]generated', 'no signature (?:is )?required', 'end of statement',
    'generated (?:on|by|at)\\b', 'disclaimer', 'for enquir(?:y|ies)',
    'this statement is', 'kindly note', 'subject to (?:review|confirmation)',
  ].join('|'),
  'i',
)

function looksLikeBoilerplate(cells: string[]): boolean {
  return BOILERPLATE_RE.test(cells.join(' '))
}

// ── Header recognition ─────────────────────────────────────────────────────────

const HEADER_WORD_RE = new RegExp(
  '\\b(?:' + [
    'dates?', 'descriptions?', 'narrations?', 'details?', 'particulars?', 'remarks?', 'memo',
    'credits?', 'debits?', 'deposits?', 'withdrawals?', 'lodgements?', 'amounts?', 'balances?',
    'references?', 'ref', 'refno', 'cheque', 'chq', 'instrument', 'currency', 'dr', 'cr',
    'value date', 'transaction date', 'posting date', 'post date',
    'money in', 'money out', 'paid in', 'paid out',
  ].join('|') + ')\\b',
  'i',
)

function normaliseCell(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim()
}

/** Number of cells in the row that read as bank-statement column titles. */
function scoreHeaderCells(cells: string[]): number {
  return cells.filter(c => {
    const n = normaliseCell(c)
    return n.length > 0 && HEADER_WORD_RE.test(n)
  }).length
}

/** `Credit(₦)` → `Credit`, `Amount (NGN)` → `Amount`. */
export function cleanHeaderCell(value: string): string {
  return value
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\s*[([]\s*(?:[₦$£€¥₹]|[A-Za-z]{3})\s*[)\]]\s*$/, '')
    .trim()
}

// ── Row assembly ───────────────────────────────────────────────────────────────

function medianOf(values: number[]): number {
  if (values.length === 0) return 0
  const s = [...values].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}

/**
 * Groups items into visual lines by clustering on Y with a font-size-derived
 * tolerance. Clustering (rather than snapping to a fixed grid) prevents two
 * items on the same baseline landing in different rows because they straddle a
 * snap boundary — a major source of the "scattered" output.
 */
function groupIntoRows(items: PdfTextItem[]): PdfTextItem[][] {
  if (items.length === 0) return []
  const medianHeight = medianOf(items.map(i => i.height).filter(h => h > 0)) || DEFAULT_FONT_SIZE
  const tol = Math.max(2, medianHeight * 0.5)

  const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x)
  const rows: PdfTextItem[][] = []
  let current: PdfTextItem[] = []
  let anchorY = 0

  for (const item of sorted) {
    if (current.length === 0 || Math.abs(item.y - anchorY) <= tol) {
      if (current.length === 0) anchorY = item.y
      current.push(item)
      // Track the running mean so a slowly-drifting baseline stays one row.
      anchorY = (anchorY * (current.length - 1) + item.y) / current.length
    } else {
      rows.push(current)
      current = [item]
      anchorY = item.y
    }
  }
  if (current.length > 0) rows.push(current)
  return rows
}

/**
 * Merges text runs that belong to the same cell.
 *
 * pdfjs splits a rendered string wherever the font, kerning or encoding
 * changes, so `Credit(`, `₦`, `)` arrive as three items. The gap between a
 * run's right edge and the next run's left edge is the only reliable signal:
 * anything under ~half an em is intra-cell, anything larger is a column gutter.
 *
 * The previous implementation compared *left edges* and only merged when one
 * side was ≤3 chars, which both missed long fragments and stopped merging as
 * soon as the accumulated text grew wider than the threshold.
 */
export function mergeRowFragments(items: PdfTextItem[]): PdfTextItem[] {
  if (items.length <= 1) return items.map(i => ({ ...i }))
  const sorted = [...items].sort((a, b) => a.x - b.x)
  const out: PdfTextItem[] = [{ ...sorted[0] }]

  for (let i = 1; i < sorted.length; i++) {
    const prev = out[out.length - 1]
    const cur  = sorted[i]
    const font = Math.max(prev.height, cur.height) || DEFAULT_FONT_SIZE
    const gap  = cur.x - prev.xEnd

    if (gap <= font * 0.55) {
      // Re-insert a space only when the glyphs were actually separated.
      const joiner = gap > font * 0.12 && !/\s$/.test(prev.text) && !/^\s/.test(cur.text) ? ' ' : ''
      prev.text   = prev.text + joiner + cur.text
      prev.xEnd   = Math.max(prev.xEnd, cur.xEnd)
      prev.height = font
    } else {
      out.push({ ...cur })
    }
  }
  return out
}

// ── Column model ───────────────────────────────────────────────────────────────

/**
 * Vertical cut positions between columns. `bounds.length === columnCount - 1`;
 * the axis is fully partitioned so every item lands in exactly one column.
 */
function boundsFromItems(cells: PdfTextItem[]): number[] {
  const bounds: number[] = []
  for (let i = 0; i < cells.length - 1; i++) {
    bounds.push((cells[i].xEnd + cells[i + 1].x) / 2)
  }
  return bounds
}

function columnIndexFor(item: PdfTextItem, bounds: number[]): number {
  const colCount = bounds.length + 1
  const start = item.x
  const end   = Math.max(item.xEnd, item.x + 0.01)

  let bestIdx = 0
  let bestOverlap = -1
  for (let ci = 0; ci < colCount; ci++) {
    const lo = ci === 0 ? -Infinity : bounds[ci - 1]
    const hi = ci === colCount - 1 ? Infinity : bounds[ci]
    const overlap = Math.min(end, hi) - Math.max(start, lo)
    if (overlap > bestOverlap) { bestOverlap = overlap; bestIdx = ci }
  }
  return bestIdx
}

/**
 * Assigns each run to the column it overlaps most.
 *
 * Overlap (not left-edge proximity) is what makes right-aligned amount columns
 * and over-wide narration cells land correctly: a wide description that bleeds
 * under the Credit header still has most of its width inside Description, and a
 * long right-aligned balance whose left edge falls in the Debit gutter still has
 * most of its width inside Balance.
 */
function assignToColumns(items: PdfTextItem[], bounds: number[]): string[] {
  const cells = new Array<string>(bounds.length + 1).fill('')
  for (const item of items) {
    const ci = columnIndexFor(item, bounds)
    const text = item.text.trim()
    if (!text) continue
    cells[ci] = cells[ci] ? `${cells[ci]} ${text}` : text
  }
  return cells
}

/**
 * Second pass: header text is often narrower or offset relative to the data
 * beneath it, so re-cut the boundaries using the real extent of everything that
 * landed in each column. Only widens where the columns stay disjoint.
 */
function refineBounds(rows: PdfTextItem[][], bounds: number[]): number[] {
  const colCount = bounds.length + 1
  const minX = new Array<number>(colCount).fill(Infinity)
  const maxX = new Array<number>(colCount).fill(-Infinity)

  for (const row of rows) {
    for (const item of row) {
      if (!item.text.trim()) continue
      const ci = columnIndexFor(item, bounds)
      minX[ci] = Math.min(minX[ci], item.x)
      maxX[ci] = Math.max(maxX[ci], item.xEnd)
    }
  }

  return bounds.map((b, i) => {
    const left  = maxX[i]
    const right = minX[i + 1]
    if (!Number.isFinite(left) || !Number.isFinite(right) || left >= right) return b
    return (left + right) / 2
  })
}

// ── Table location ─────────────────────────────────────────────────────────────

interface HeaderCandidate {
  rowIndex: number
  cells: PdfTextItem[]
  bounds: number[]
  score: number
  run: number
}

function isDataLike(cells: string[]): boolean {
  return cells.some(c => isDateLike(c)) || cells.some(c => isAmountLike(c))
}

function isSparse(cells: string[]): boolean {
  const nonEmpty = cells.filter(c => c.trim()).length
  return nonEmpty > 0 && nonEmpty <= Math.max(1, Math.floor(cells.length / 2))
}

/**
 * Picks the transaction-table header on a page.
 *
 * Keyword score alone is not enough — a statement's summary block
 * (`Opening Balance | Closing Balance | Date Printed | Start Date | End Date`)
 * scores as highly as the real header. The discriminator is what *follows*:
 * the real header is trailed by an unbroken run of transaction rows, the
 * summary block by exactly one value row. Candidates are therefore ranked by
 * that run length first and keyword score only as a tie-break.
 */
function findHeaderRow(rows: PdfTextItem[][]): HeaderCandidate | null {
  let best: HeaderCandidate | null = null

  for (let i = 0; i < rows.length; i++) {
    const cells = rows[i]
    if (cells.length < 3) continue
    const texts = cells.map(c => c.text)
    const score = scoreHeaderCells(texts)
    if (score < 2) continue

    const bounds = boundsFromItems(cells)
    let run = 0
    for (let j = i + 1; j < rows.length; j++) {
      const assigned = assignToColumns(rows[j], bounds)
      if (isDataLike(assigned)) { run++; continue }
      // Wrapped narration lines interleave with data rows — skip, don't break.
      if (isSparse(assigned) || looksLikeBoilerplate(assigned)) continue
      break
    }
    if (run < 1) continue

    const candidate: HeaderCandidate = { rowIndex: i, cells, bounds, score, run }
    if (
      best === null ||
      candidate.run > best.run ||
      (candidate.run === best.run && candidate.score > best.score) ||
      (candidate.run === best.run && candidate.score === best.score && candidate.rowIndex > best.rowIndex)
    ) {
      best = candidate
    }
  }

  return best
}

// ── Continuation-row merging ───────────────────────────────────────────────────

interface GridRow {
  globalY: number
  cells: string[]
}

/**
 * Folds sparse wrap rows into the transaction they belong to.
 *
 * Direction is decided by Y-proximity to the surrounding anchor rows:
 *   • distToNext <= distToPrev → "leading" wrap: description text rendered
 *     above the row's own date/amount baseline, so it belongs to the NEXT
 *     anchor — prepend in document order.
 *   • otherwise → "trailing" wrap, appended to the PREVIOUS anchor.
 *
 * This handles Oracle-style statements where a multi-line description starts
 * rendering before (above) the row's date and amount columns.
 */
function mergeContinuationRows(rows: GridRow[]): string[][] {
  const merged: string[][] = []
  const pending: GridRow[] = []
  let prevAnchorY: number | null = null

  const flushTrailing = (conts: string[][]) => {
    if (conts.length === 0 || merged.length === 0) return
    const prev = merged[merged.length - 1]
    for (const cont of conts) {
      cont.forEach((cell, ci) => {
        if (cell.trim()) prev[ci] = prev[ci] ? `${prev[ci]} ${cell.trim()}` : cell.trim()
      })
    }
  }

  for (const { globalY, cells } of rows) {
    const firstEmpty     = !cells[0]?.trim()
    const nonEmptyCount  = cells.filter(c => c.trim()).length
    const isContinuation = firstEmpty && nonEmptyCount < Math.ceil(cells.length / 2)

    if (isContinuation) {
      pending.push({ globalY, cells: [...cells] })
      continue
    }

    const leading:  string[][] = []
    const trailing: string[][] = []
    for (const cont of pending) {
      const distToPrev = prevAnchorY !== null ? Math.abs(cont.globalY - prevAnchorY) : Infinity
      const distToNext = Math.abs(cont.globalY - globalY)
      if (distToNext <= distToPrev) leading.push(cont.cells)
      else trailing.push(cont.cells)
    }

    flushTrailing(trailing)

    const anchorCells = [...cells]
    for (let ci = 0; ci < anchorCells.length; ci++) {
      const parts = leading.map(cont => cont[ci]?.trim()).filter(Boolean)
      if (parts.length > 0) anchorCells[ci] = [...parts, anchorCells[ci]].filter(Boolean).join(' ')
    }

    pending.length = 0
    prevAnchorY = globalY
    merged.push(anchorCells)
  }

  flushTrailing(pending.map(p => p.cells))
  return merged
}

// ── Fallback grid (no header found) ────────────────────────────────────────────

/**
 * Whitespace-projection column detection, used only when no transaction-table
 * header can be located. Columns are the maximal X ranges covered by text,
 * separated by gutters wider than ~0.8em.
 */
function fallbackBounds(rows: PdfTextItem[][]): number[] {
  const spans: Array<[number, number]> = []
  const heights: number[] = []
  for (const row of rows) {
    for (const item of row) {
      if (!item.text.trim()) continue
      spans.push([item.x, item.xEnd])
      if (item.height > 0) heights.push(item.height)
    }
  }
  if (spans.length === 0) return []

  const gutter = Math.max(6, (medianOf(heights) || DEFAULT_FONT_SIZE) * 0.8)
  spans.sort((a, b) => a[0] - b[0])

  const merged: Array<[number, number]> = [[...spans[0]] as [number, number]]
  for (let i = 1; i < spans.length; i++) {
    const last = merged[merged.length - 1]
    if (spans[i][0] - last[1] <= gutter) last[1] = Math.max(last[1], spans[i][1])
    else merged.push([...spans[i]] as [number, number])
  }

  const bounds: number[] = []
  for (let i = 0; i < merged.length - 1; i++) bounds.push((merged[i][1] + merged[i + 1][0]) / 2)
  return bounds
}

// ── Core extraction (pure — unit-testable without pdfjs) ───────────────────────

export interface ExtractedTable {
  headers: string[]
  rows: string[][]
  tableDetected: boolean
}

export function extractTableFromPages(pages: PdfPageItems[]): ExtractedTable {
  // 1. Rows are built per page so that two pages never collide on Y, then
  //    tagged with a global Y for the cross-page continuation logic.
  let yOffset = 0
  const pageRows: TextRow[][] = []
  for (const page of pages) {
    const rows = groupIntoRows(page.items)
      .map(mergeRowFragments)
      .filter(items => items.some(i => i.text.trim()))
      .map(items => ({ y: items[0].y, globalY: yOffset + items[0].y, items }))
    pageRows.push(rows)
    yOffset += page.height
  }

  const allRows = pageRows.flat()
  if (allRows.length === 0) return { headers: [], rows: [], tableDetected: false }

  // 2. Locate the transaction table on each page independently. Continuation
  //    pages that reprint no header inherit the previous page's grid.
  const perPageHeader = pageRows.map(rows => findHeaderRow(rows.map(r => r.items)))
  const primary = perPageHeader.find(h => h !== null) ?? null

  if (!primary) return fallbackExtraction(allRows)

  const primaryHeaderTexts = primary.cells.map(c => cleanHeaderCell(c.text))
  const colCount = primaryHeaderTexts.length

  // 3. Collect data rows page by page using that page's own grid when its
  //    header matches the primary shape (X positions drift slightly between
  //    pages on some generators), otherwise the primary grid.
  const collected: GridRow[] = []
  let lastBounds = primary.bounds

  for (let p = 0; p < pageRows.length; p++) {
    const header = perPageHeader[p]
    const useOwn = header !== null && header.cells.length === colCount
    const bounds = useOwn ? header!.bounds : lastBounds
    if (useOwn) lastBounds = header!.bounds

    const startIdx = header !== null ? header.rowIndex + 1 : 0
    const bodyRows = pageRows[p].slice(startIdx)

    // Refine the cut positions against the actual body content of this page.
    const refined = refineBounds(bodyRows.map(r => r.items), bounds)

    for (const row of bodyRows) {
      collected.push({ globalY: row.globalY, cells: assignToColumns(row.items, refined) })
    }
  }

  // 4. Drop reprinted headers, page furniture and anything that is neither a
  //    transaction nor a wrapped narration line.
  const headerKey = primaryHeaderTexts.map(normaliseCell).join('|')
  let body = collected.filter(({ cells }) => {
    if (!cells.some(c => c.trim())) return false
    if (cells.map(c => normaliseCell(cleanHeaderCell(c))).join('|') === headerKey) return false
    if (!isDataLike(cells) && looksLikeBoilerplate(cells)) return false
    return isDataLike(cells) || isSparse(cells)
  })

  // 5. Trailing furniture that dodged the keyword list (bare footers such as
  //    `alat.ng | wemabank.com`) carries no date, no amount and no real number.
  while (body.length > 0) {
    const last = body[body.length - 1].cells
    if (isDataLike(last) || /\d{2,}/.test(last.join(' '))) break
    body.pop()
  }

  const rows = mergeContinuationRows(body)

  // 6. Drop columns that are empty in both the header and every data row.
  const keep: number[] = []
  for (let ci = 0; ci < colCount; ci++) {
    if (primaryHeaderTexts[ci]?.trim() || rows.some(r => r[ci]?.trim())) keep.push(ci)
  }

  return {
    headers: keep.map((ci, i) => primaryHeaderTexts[ci]?.trim() || `Column ${i + 1}`),
    rows: rows.map(r => keep.map(ci => r[ci] ?? '')),
    tableDetected: true,
  }
}

/** Best-effort whole-document grid for PDFs with no recognisable table header. */
function fallbackExtraction(allRows: TextRow[]): ExtractedTable {
  const bounds = refineBounds(allRows.map(r => r.items), fallbackBounds(allRows.map(r => r.items)))
  const grid = allRows.map(r => ({ globalY: r.globalY, cells: assignToColumns(r.items, bounds) }))
    .filter(({ cells }) => cells.some(c => c.trim()))

  if (grid.length === 0) return { headers: [], rows: [], tableDetected: false }

  const first = grid[0].cells
  const firstNonEmpty = first.filter(c => c.trim())
  const firstIsHeader = firstNonEmpty.length >= 2 &&
    firstNonEmpty.filter(c => isAmountLike(c) || isDateLike(c)).length < firstNonEmpty.length / 2

  const headers = firstIsHeader
    ? first.map((h, i) => cleanHeaderCell(h) || `Column ${i + 1}`)
    : first.map((_, i) => `Column ${i + 1}`)

  const rows = mergeContinuationRows(firstIsHeader ? grid.slice(1) : grid)

  const keep: number[] = []
  for (let ci = 0; ci < headers.length; ci++) {
    if (rows.some(r => r[ci]?.trim())) keep.push(ci)
  }

  return {
    headers: keep.map((ci, i) => headers[ci] || `Column ${i + 1}`),
    rows: rows.map(r => keep.map(ci => r[ci] ?? '')),
    tableDetected: false,
  }
}
