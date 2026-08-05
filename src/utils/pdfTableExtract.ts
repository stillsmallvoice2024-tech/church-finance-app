/**
 * Geometry-driven table extraction for PDF bank statements.
 *
 * Deliberately free of any pdfjs import so the logic stays unit-testable in a
 * plain Node environment — `pdfParser.ts` owns the pdfjs plumbing and feeds
 * positioned text runs in here.
 *
 * Three properties of real bank statements drive the design:
 *
 *  1. Reported glyph widths cannot be trusted. Some generators emit runs whose
 *     advertised width overlaps the next run on the same line, so column
 *     geometry is derived from *start* positions, which are always reliable.
 *  2. A header may be stacked over several lines (`Value` above `Date`), so the
 *     header is resolved as a band of lines rather than a single line.
 *  3. One transaction may span several lines when a narrow column wraps, and
 *     only one of those lines carries the amounts. The amount-bearing line is
 *     the record anchor; the rest are continuations folded into it.
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

interface TextLine {
  /** Page-local Y (top-down). */
  y: number
  /** Y offset by all preceding page heights — safe for cross-page comparisons. */
  globalY: number
  items: PdfTextItem[]
}

const DEFAULT_FONT_SIZE = 10

/** Widest gap between two runs that can still be one cell (fraction of em). */
const INTRA_CELL_GAP = 0.35
/** Overlap this deep means broken widths or colliding cells — never merge. */
const MAX_MERGE_OVERLAP = 0.15
/** Gap above which a space is re-inserted when joining runs inside one cell. */
const SPACE_GAP = 0.12
/** Start positions closer than this (fraction of em) belong to one column. */
const COLUMN_CLUSTER = 1.2

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

/** Columns whose values are monetary — used to find each record's anchor line. */
const AMOUNT_HEADER_RE =
  /\b(?:credits?|debits?|amounts?|balances?|deposits?|withdrawals?|lodgements?|money in|money out|paid in|paid out|dr|cr)\b/i

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

/**
 * Repairs letter-spaced headers. Some generators emit `R e f e r e n c e` as a
 * run of single characters; three or more in a row are re-joined into a word.
 */
export function collapseLetterSpacing(value: string): string {
  const tokens = value.split(' ')
  const out: string[] = []
  let i = 0
  while (i < tokens.length) {
    let j = i
    while (j < tokens.length && tokens[j].length === 1 && /[A-Za-z]/.test(tokens[j])) j++
    if (j - i >= 3) {
      out.push(tokens.slice(i, j).join(''))
      i = j
    } else {
      out.push(tokens[i])
      i++
    }
  }
  return out.join(' ')
}

/** `Credit(₦)` → `Credit`, `Amount (NGN)` → `Amount`. */
export function cleanHeaderCell(value: string): string {
  return collapseLetterSpacing(value.replace(/\s+/g, ' ').trim())
    .replace(/\s*[([]\s*(?:[₦$£€¥₹]|[A-Za-z]{3})\s*[)\]]\s*$/, '')
    .trim()
}

// ── Line assembly ──────────────────────────────────────────────────────────────

function medianOf(values: number[]): number {
  if (values.length === 0) return 0
  const s = [...values].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}

function fontSizeOf(items: PdfTextItem[]): number {
  return medianOf(items.map(i => i.height).filter(h => h > 0)) || DEFAULT_FONT_SIZE
}

/**
 * Groups items into visual lines by clustering on Y with a font-size-derived
 * tolerance. Clustering (rather than snapping to a fixed grid) prevents two
 * items on the same baseline landing in different lines because they straddle a
 * snap boundary.
 */
function groupIntoLines(items: PdfTextItem[]): PdfTextItem[][] {
  if (items.length === 0) return []
  const tol = Math.max(2, fontSizeOf(items) * 0.5)

  const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x)
  const lines: PdfTextItem[][] = []
  let current: PdfTextItem[] = []
  let anchorY = 0

  for (const item of sorted) {
    if (current.length === 0 || Math.abs(item.y - anchorY) <= tol) {
      if (current.length === 0) anchorY = item.y
      current.push(item)
      // Track the running mean so a slowly-drifting baseline stays one line.
      anchorY = (anchorY * (current.length - 1) + item.y) / current.length
    } else {
      lines.push(current)
      current = [item]
      anchorY = item.y
    }
  }
  if (current.length > 0) lines.push(current)
  return lines
}

/**
 * Merges text runs that belong to the same cell.
 *
 * pdfjs splits a rendered string wherever the font, kerning or encoding
 * changes, so `Credit(`, `₦`, `)` arrive as three items. Two guards keep this
 * conservative, because it only has to be good enough to read column titles —
 * data cells are assembled from column membership instead:
 *
 *  • an overlap beyond a rounding tolerance means the advertised widths are
 *    broken (or the cells genuinely collide), so the runs are left apart;
 *  • the gap must be under roughly one space.
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

    if (gap >= -font * MAX_MERGE_OVERLAP && gap <= font * INTRA_CELL_GAP) {
      // Re-insert a space only when the glyphs were actually separated.
      const joiner = gap > font * SPACE_GAP && !/\s$/.test(prev.text) && !/^\s/.test(cur.text) ? ' ' : ''
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
 * Column geometry, expressed as start-position anchors plus the cut positions
 * between them. Start positions are used rather than full extents because
 * advertised widths are unreliable across generators — a run's left edge is the
 * only measurement that is always correct.
 */
export interface ColumnModel {
  starts: number[]
  bounds: number[]
  headers: string[]
}

function boundsFromStarts(starts: number[]): number[] {
  const bounds: number[] = []
  for (let i = 0; i < starts.length - 1; i++) bounds.push((starts[i] + starts[i + 1]) / 2)
  return bounds
}

function columnIndexFor(x: number, bounds: number[]): number {
  let i = 0
  while (i < bounds.length && x >= bounds[i]) i++
  return i
}

/** Joins runs that share a column, restoring the spaces the layout implied. */
function joinRunsInCell(items: PdfTextItem[]): string {
  const sorted = [...items].sort((a, b) => a.x - b.x)
  let text = sorted[0].text.trim()
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]
    const cur  = sorted[i]
    const font = Math.max(prev.height, cur.height) || DEFAULT_FONT_SIZE
    const gap  = cur.x - prev.xEnd
    // A deep negative gap means the widths are broken, not that the runs touch.
    const spaced = gap > font * SPACE_GAP || gap < -font * 0.5
    // A trailing hyphen is a wrapped word, never a word break.
    const joiner = /-$/.test(text) ? '' : spaced ? ' ' : ''
    text = text + joiner + cur.text.trim()
  }
  return text
}

/**
 * Assigns runs to columns by their start position and joins each column's runs.
 *
 * Start-position assignment is immune to the over-wide and overlapping widths
 * some generators report, and it handles right-aligned amount columns and
 * over-wide narration alike, because a cell's left edge always sits inside its
 * own column even when its text does not.
 */
function assignToColumns(items: PdfTextItem[], bounds: number[]): string[] {
  const buckets: PdfTextItem[][] = Array.from({ length: bounds.length + 1 }, () => [])
  for (const item of items) {
    if (!item.text.trim()) continue
    buckets[columnIndexFor(item.x, bounds)].push(item)
  }
  return buckets.map(b => (b.length === 0 ? '' : joinRunsInCell(b)))
}

/**
 * Clusters the start positions of every run in the header band into columns.
 * A stacked header (`Value` above `Date`) contributes the same start twice and
 * collapses to one column; distinct columns sit far further apart than the
 * clustering tolerance.
 */
function buildColumnModel(band: PdfTextItem[][]): ColumnModel {
  const items = band.flat().filter(i => i.text.trim())
  if (items.length === 0) return { starts: [], bounds: [], headers: [] }

  const tol = Math.max(4, fontSizeOf(items) * COLUMN_CLUSTER)
  const sorted = [...items].sort((a, b) => a.x - b.x)

  const groups: PdfTextItem[][] = [[sorted[0]]]
  for (let i = 1; i < sorted.length; i++) {
    const group = groups[groups.length - 1]
    if (sorted[i].x - group[0].x <= tol) group.push(sorted[i])
    else groups.push([sorted[i]])
  }

  const starts = groups.map(g => Math.min(...g.map(i => i.x)))
  const headers = groups.map(g =>
    cleanHeaderCell(
      [...g].sort((a, b) => a.y - b.y || a.x - b.x).map(i => i.text.trim()).join(' '),
    ),
  )
  return { starts, bounds: boundsFromStarts(starts), headers }
}

/**
 * Re-cuts the boundaries once the body content is known, placing each cut
 * midway between the rightmost start in one column and the leftmost start in
 * the next. Applied only where the two columns remain disjoint.
 */
function refineBounds(lines: PdfTextItem[][], model: ColumnModel): number[] {
  const colCount = model.bounds.length + 1
  const minX = new Array<number>(colCount).fill(Infinity)
  const maxX = new Array<number>(colCount).fill(-Infinity)

  for (const line of lines) {
    for (const item of line) {
      if (!item.text.trim()) continue
      const ci = columnIndexFor(item.x, model.bounds)
      minX[ci] = Math.min(minX[ci], item.x)
      maxX[ci] = Math.max(maxX[ci], item.x)
    }
  }
  // Seed with the header starts so a column with no body content keeps its anchor.
  for (let ci = 0; ci < colCount; ci++) {
    const s = model.starts[ci]
    if (s !== undefined) {
      minX[ci] = Math.min(minX[ci], s)
      maxX[ci] = Math.max(maxX[ci], s)
    }
  }

  return model.bounds.map((b, i) => {
    const left  = maxX[i]
    const right = minX[i + 1]
    if (!Number.isFinite(left) || !Number.isFinite(right) || left >= right) return b
    return (left + right) / 2
  })
}

// ── Header band location ───────────────────────────────────────────────────────

interface HeaderBand {
  /** Indices of every line forming the header, in document order. */
  lineIndices: number[]
  model: ColumnModel
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

/** A line carrying no date and no number cannot be part of the data body. */
function isHeaderish(items: PdfTextItem[]): boolean {
  return !items.some(i => isDateLike(i.text) || isAmountLike(i.text))
}

/**
 * Picks the transaction-table header on a page.
 *
 * Keyword score alone is not enough — a statement's summary block
 * (`Opening Balance | Closing Balance | Date Printed | Start Date | End Date`)
 * scores as highly as the real header. The discriminator is what *follows*:
 * the real header is trailed by an unbroken run of transaction lines, the
 * summary block by exactly one value line. Candidates are therefore ranked by
 * that run length first and keyword score only as a tie-break.
 *
 * The winning line is then grown into a band, absorbing adjacent lines that
 * carry no data of their own, so a stacked header resolves to one row of titles.
 */
function findHeaderBand(lines: PdfTextItem[][]): HeaderBand | null {
  const merged = lines.map(mergeRowFragments)
  let best: { index: number; score: number; run: number } | null = null

  for (let i = 0; i < merged.length; i++) {
    const cells = merged[i]
    if (cells.length < 3) continue
    const score = scoreHeaderCells(cells.map(c => c.text))
    if (score < 2) continue

    const bounds = boundsFromStarts(cells.map(c => c.x))
    let run = 0
    for (let j = i + 1; j < merged.length; j++) {
      const assigned = assignToColumns(lines[j], bounds)
      if (isDataLike(assigned)) { run++; continue }
      // Wrapped narration and stacked header lines interleave — skip, don't break.
      if (isSparse(assigned) || looksLikeBoilerplate(assigned)) continue
      break
    }
    if (run < 1) continue

    if (
      best === null || run > best.run ||
      (run === best.run && score > best.score) ||
      (run === best.run && score === best.score && i > best.index)
    ) {
      best = { index: i, score, run }
    }
  }

  if (!best) return null

  // Grow the band across adjacent lines that hold no data of their own. A
  // stacked header renders as several such lines a few points apart; the first
  // transaction line stops the walk because it carries dates and amounts.
  const font   = fontSizeOf(lines[best.index])
  const maxGap = font * 2.2
  const yOf    = (idx: number) => Math.min(...lines[idx].map(i => i.y))

  let first = best.index
  let last  = best.index
  while (first - 1 >= 0 && isHeaderish(lines[first - 1]) && yOf(first) - yOf(first - 1) <= maxGap) first--
  while (last + 1 < lines.length && isHeaderish(lines[last + 1]) && yOf(last + 1) - yOf(last) <= maxGap) last++

  const lineIndices: number[] = []
  for (let i = first; i <= last; i++) lineIndices.push(i)

  return {
    lineIndices,
    model: buildColumnModel(lineIndices.map(i => merged[i])),
    score: best.score,
    run: best.run,
  }
}

// ── Record assembly ────────────────────────────────────────────────────────────

interface GridLine {
  globalY: number
  cells: string[]
}

/** Column indices whose values are monetary, by header name then by content. */
function findAmountColumns(headers: string[], body: GridLine[]): Set<number> {
  const byHeader = new Set<number>()
  headers.forEach((h, ci) => { if (AMOUNT_HEADER_RE.test(normaliseCell(h))) byHeader.add(ci) })
  if (byHeader.size > 0) return byHeader

  const byContent = new Set<number>()
  for (let ci = 0; ci < headers.length; ci++) {
    const values = body.map(r => r.cells[ci]?.trim()).filter((v): v is string => !!v)
    if (values.length >= 2 && values.filter(isAmountLike).length >= values.length * 0.6) byContent.add(ci)
  }
  return byContent
}

function appendCell(existing: string, addition: string): string {
  const add = addition.trim()
  if (!add) return existing
  if (!existing) return add
  // A trailing hyphen is a wrapped word (`01-Aug-` + `2026`), not a separator.
  return /-$/.test(existing) ? existing + add : `${existing} ${add}`
}

/**
 * Folds continuation lines into the transaction they belong to.
 *
 * A record's anchor is the line carrying its amounts: every transaction has one,
 * while a wrapped narration or a split date fragment has none. Each continuation
 * attaches to the nearer anchor by Y:
 *   • closer to the next anchor → "leading": text rendered above the amounts,
 *     prepended in document order.
 *   • otherwise → "trailing", appended to the previous anchor.
 *
 * This handles both statements whose description wraps below the amounts and
 * those whose narrow date column wraps above and below them.
 */
function mergeContinuationLines(lines: GridLine[], amountCols: Set<number>): string[][] {
  const isAnchor = (cells: string[]) =>
    amountCols.size > 0
      ? [...amountCols].some(ci => cells[ci]?.trim())
      : !!cells[0]?.trim() && cells.filter(c => c.trim()).length >= Math.ceil(cells.length / 2)

  const merged: string[][] = []
  const pending: GridLine[] = []
  let prevAnchorY: number | null = null

  const flushTrailing = (conts: string[][]) => {
    if (conts.length === 0 || merged.length === 0) return
    const prev = merged[merged.length - 1]
    for (const cont of conts) {
      cont.forEach((cell, ci) => { prev[ci] = appendCell(prev[ci] ?? '', cell) })
    }
  }

  for (const { globalY, cells } of lines) {
    if (!isAnchor(cells)) {
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
      let acc = ''
      for (const cont of leading) acc = appendCell(acc, cont[ci] ?? '')
      if (acc) anchorCells[ci] = appendCell(acc, anchorCells[ci] ?? '')
    }

    pending.length = 0
    prevAnchorY = globalY
    merged.push(anchorCells)
  }

  flushTrailing(pending.map(p => p.cells))
  return merged
}

// ── Core extraction ────────────────────────────────────────────────────────────

export interface ExtractedTable {
  headers: string[]
  rows: string[][]
  tableDetected: boolean
}

export function extractTableFromPages(pages: PdfPageItems[]): ExtractedTable {
  // 1. Lines are built per page so two pages never collide on Y, then tagged
  //    with a global Y for the cross-page continuation logic.
  let yOffset = 0
  const pageLines: TextLine[][] = []
  for (const page of pages) {
    const lines = groupIntoLines(page.items)
      .filter(items => items.some(i => i.text.trim()))
      .map(items => ({ y: items[0].y, globalY: yOffset + items[0].y, items }))
    pageLines.push(lines)
    yOffset += page.height
  }

  const allLines = pageLines.flat()
  if (allLines.length === 0) return { headers: [], rows: [], tableDetected: false }

  // 2. Locate the header band on each page independently. Continuation pages
  //    that reprint no header inherit the previous page's column model.
  const perPageBand = pageLines.map(lines => findHeaderBand(lines.map(l => l.items)))
  const primary = perPageBand.find(b => b !== null) ?? null

  if (!primary || primary.model.headers.length < 2) return fallbackExtraction(allLines)

  const headers  = primary.model.headers
  const colCount = headers.length

  // 3. Collect body lines page by page, using that page's own column model when
  //    its header has the same shape (X positions drift slightly between pages
  //    on some generators), otherwise the primary model.
  const collected: GridLine[] = []
  let lastModel = primary.model

  for (let p = 0; p < pageLines.length; p++) {
    const band   = perPageBand[p]
    const useOwn = band !== null && band.model.headers.length === colCount
    const model  = useOwn ? band!.model : lastModel
    if (useOwn) lastModel = band!.model

    // Everything up to and including the header band is page preamble, not data.
    const startIdx  = band ? Math.max(...band.lineIndices) + 1 : 0
    const bodyLines = pageLines[p].slice(startIdx)

    const bounds = refineBounds(bodyLines.map(l => l.items), model)
    for (const line of bodyLines) {
      collected.push({ globalY: line.globalY, cells: assignToColumns(line.items, bounds) })
    }
  }

  // 4. Drop reprinted headers, page furniture and anything that is neither a
  //    transaction nor a wrapped continuation line.
  const headerKey = headers.map(normaliseCell).join('|')
  const body = collected.filter(({ cells }) => {
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

  const rows = mergeContinuationLines(body, findAmountColumns(headers, body))

  // 6. Drop columns that are empty in both the header and every data row.
  const keep: number[] = []
  for (let ci = 0; ci < colCount; ci++) {
    if (headers[ci]?.trim() || rows.some(r => r[ci]?.trim())) keep.push(ci)
  }

  return {
    headers: keep.map((ci, i) => headers[ci]?.trim() || `Column ${i + 1}`),
    rows: rows.map(r => keep.map(ci => r[ci] ?? '')),
    tableDetected: true,
  }
}

/** Best-effort grid for PDFs with no recognisable table header. */
function fallbackExtraction(allLines: TextLine[]): ExtractedTable {
  const merged = allLines.map(l => mergeRowFragments(l.items))
  const model  = buildColumnModel(merged)
  if (model.starts.length === 0) return { headers: [], rows: [], tableDetected: false }

  const grid = allLines
    .map((l, i) => ({ globalY: l.globalY, cells: assignToColumns(merged[i], model.bounds) }))
    .filter(({ cells }) => cells.some(c => c.trim()))

  if (grid.length === 0) return { headers: [], rows: [], tableDetected: false }

  const first = grid[0].cells
  const firstNonEmpty = first.filter(c => c.trim())
  const firstIsHeader = firstNonEmpty.length >= 2 &&
    firstNonEmpty.filter(c => isAmountLike(c) || isDateLike(c)).length < firstNonEmpty.length / 2

  const headers = firstIsHeader
    ? first.map((h, i) => cleanHeaderCell(h) || `Column ${i + 1}`)
    : first.map((_, i) => `Column ${i + 1}`)

  const bodyLines = firstIsHeader ? grid.slice(1) : grid
  const rows = mergeContinuationLines(bodyLines, findAmountColumns(headers, bodyLines))

  const keep: number[] = []
  for (let ci = 0; ci < headers.length; ci++) {
    if (rows.some(r => r[ci]?.trim())) keep.push(ci)
  }

  const outRows = rows.map(r => keep.map(ci => r[ci] ?? ''))

  // A guessed grid is only worth returning if it plausibly *is* a statement
  // table: more than one column, and at least one row carrying a date or an
  // amount. Without this, a page whose sole text layer is a `Page N of M`
  // stamp — everything else drawn as vector outlines — yields a tidy-looking
  // one-column grid that the caller would accept as an extraction instead of
  // falling through to OCR, which is the only thing that can read such a file.
  const plausible = keep.length >= 2 && outRows.some(isDataLike)
  if (!plausible) return { headers: [], rows: [], tableDetected: false }

  return {
    headers: keep.map((ci, i) => headers[ci] || `Column ${i + 1}`),
    rows: outRows,
    tableDetected: false,
  }
}
