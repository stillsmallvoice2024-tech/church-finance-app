import * as pdfjsLib from 'pdfjs-dist'
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc

export interface ParsedSheet {
  name: string
  headers: string[]
  rows: unknown[][]
  rowCount: number
}

interface TextItem {
  x: number
  y: number
  text: string
}

const ROW_SNAP = 4    // px tolerance for grouping items into the same row
const COL_SNAP = 15   // px tolerance for snapping to a column position

function snapToGrid(val: number, snap: number): number {
  return Math.round(val / snap) * snap
}

function detectColumns(rows: TextItem[][]): number[] {
  // Collect all distinct X positions across rows
  const xSet = new Set<number>()
  for (const row of rows) {
    for (const item of row) {
      xSet.add(snapToGrid(item.x, COL_SNAP))
    }
  }
  // Sort and deduplicate nearby positions
  const sorted = [...xSet].sort((a, b) => a - b)
  const cols: number[] = []
  for (const x of sorted) {
    if (cols.length === 0 || x - cols[cols.length - 1] > COL_SNAP) {
      cols.push(x)
    }
  }
  return cols
}

function assignToColumns(items: TextItem[], cols: number[]): string[] {
  const cells = new Array<string>(cols.length).fill('')
  for (const item of items) {
    const snapped = snapToGrid(item.x, COL_SNAP)
    let best = 0
    let bestDist = Infinity
    for (let i = 0; i < cols.length; i++) {
      const dist = Math.abs(cols[i] - snapped)
      if (dist < bestDist) { bestDist = dist; best = i }
    }
    cells[best] = cells[best] ? `${cells[best]} ${item.text}` : item.text
  }
  return cells
}

function looksLikeHeader(row: string[]): boolean {
  // A header row has no cells that look purely like amounts/numbers and has text
  const nonEmpty = row.filter(c => c.trim())
  if (nonEmpty.length < 2) return false
  const numericCount = nonEmpty.filter(c => /^[\d,.]+$/.test(c.trim())).length
  return numericCount < nonEmpty.length / 2
}

export async function parsePDF(file: File): Promise<ParsedSheet[]> {
  const buffer = await file.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise

  const allItems: TextItem[] = []
  let yOffset = 0

  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p)
    const viewport = page.getViewport({ scale: 1 })
    const content = await page.getTextContent()

    for (const item of content.items) {
      if (!('str' in item) || !item.str.trim()) continue
      const tx = item.transform
      // tx is [scaleX, skewX, skewY, scaleY, x, y]
      const x = tx[4]
      const y = yOffset + (viewport.height - tx[5])  // page-offset Y so pages don't collide
      allItems.push({ x, y, text: item.str.trim() })
    }

    yOffset += viewport.height
  }

  if (allItems.length === 0) return []

  // Group items into rows by Y coordinate
  const rowMap = new Map<number, TextItem[]>()
  for (const item of allItems) {
    const yKey = snapToGrid(item.y, ROW_SNAP)
    if (!rowMap.has(yKey)) rowMap.set(yKey, [])
    rowMap.get(yKey)!.push(item)
  }

  // Sort rows top-to-bottom, then items left-to-right within each row
  const sortedYKeys = [...rowMap.keys()].sort((a, b) => a - b)
  const textRows: TextItem[][] = sortedYKeys.map(y =>
    rowMap.get(y)!.sort((a, b) => a.x - b.x)
  )

  // Keep rows with at least one text item; preserve Y so continuation direction can
  // be determined later (leading vs. trailing wraps need to know which anchor is closer).
  const dataRowsWithY = sortedYKeys
    .map((y, idx) => ({ y, row: textRows[idx] }))
    .filter(({ row }) => row.some(i => i.text))

  if (dataRowsWithY.length === 0) return []

  // Detect column positions
  const colPositions = detectColumns(dataRowsWithY.map(r => r.row))

  // Build 2D string array, keeping Y metadata
  const gridWithY = dataRowsWithY.map(({ y, row }) => ({
    y,
    cells: assignToColumns(row, colPositions),
  }))

  // Remove completely empty columns
  const usedCols: number[] = []
  for (let ci = 0; ci < colPositions.length; ci++) {
    if (gridWithY.some(({ cells }) => cells[ci]?.trim())) usedCols.push(ci)
  }
  const trimmedGridWithY = gridWithY.map(({ y, cells }) => ({
    y,
    cells: usedCols.map(ci => cells[ci] ?? ''),
  }))

  if (trimmedGridWithY.length === 0) return []

  // Determine header row
  let headers: string[]
  let dataStart: number
  if (looksLikeHeader(trimmedGridWithY[0].cells)) {
    headers   = trimmedGridWithY[0].cells.map((h, i) => h.trim() || `Column ${i + 1}`)
    dataStart = 1
  } else {
    headers   = trimmedGridWithY[0].cells.map((_, i) => `Column ${i + 1}`)
    dataStart = 0
  }

  // Normalise header key: collapse internal whitespace so minor spacing
  // differences between pages don't cause repeated header rows to slip through.
  const normalise = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim()
  const headerKey = headers.map(normalise).join('|')

  const filteredRowsWithY = trimmedGridWithY.slice(dataStart).filter(({ cells: r }) => {
    if (!r.some(c => c.trim())) return false
    // Drop any row that is an exact (normalised) repeat of the header — bank
    // statement PDFs print headers at the top of every page; those rows must not
    // appear as data rows or be merged into a preceding anchor by the continuation
    // logic, which is what causes duplicate/mangled rows in the import modal.
    const rowKey = r.map(normalise).join('|')
    return rowKey !== headerKey
  })

  // Merge continuation rows (sparse rows with empty first column) into their anchor.
  //
  // Direction is determined by Y-proximity to the surrounding anchor rows:
  //   • distToNext <= distToPrev  →  "leading" continuation: description text that
  //     starts at the TOP of a cell (above the anchor's Y), so belongs to the NEXT
  //     anchor — prepend in document order.
  //   • distToNext >  distToPrev  →  "trailing" continuation: text that wraps below
  //     the anchor's Y, so belongs to the PREVIOUS anchor — append.
  //
  // This correctly handles Oracle-style bank statements where a multi-line description
  // starts rendering before (above) the row's date/amount columns.
  const mergedRows: string[][] = []
  const pending: Array<{ y: number; cells: string[] }> = []
  let prevAnchorY: number | null = null

  for (const { y, cells } of filteredRowsWithY) {
    const firstEmpty = !cells[0]?.trim()
    const nonEmptyCount = cells.filter(c => c.trim()).length
    const isContinuation = firstEmpty && nonEmptyCount < Math.ceil(cells.length / 2)

    if (isContinuation) {
      pending.push({ y, cells: [...cells] })
    } else {
      // Classify each pending continuation as leading (→ next anchor) or trailing (→ prev)
      const leading: string[][] = []
      const trailing: string[][] = []

      for (const cont of pending) {
        const distToPrev = prevAnchorY !== null ? Math.abs(cont.y - prevAnchorY) : Infinity
        const distToNext = Math.abs(cont.y - y)
        if (distToNext <= distToPrev) {
          leading.push(cont.cells)
        } else {
          trailing.push(cont.cells)
        }
      }

      // Append trailing continuations to previous anchor
      if (trailing.length > 0 && mergedRows.length > 0) {
        const prev = mergedRows[mergedRows.length - 1]
        for (const cont of trailing) {
          cont.forEach((cell, ci) => {
            if (cell.trim()) {
              prev[ci] = prev[ci] ? `${prev[ci]} ${cell.trim()}` : cell.trim()
            }
          })
        }
      }

      // Prepend leading continuations (in Y order) before this anchor's own content
      const anchorCells = [...cells]
      for (let ci = 0; ci < anchorCells.length; ci++) {
        const leadingParts = leading.map(cont => cont[ci]?.trim()).filter(Boolean)
        if (leadingParts.length > 0) {
          anchorCells[ci] = [...leadingParts, anchorCells[ci]].filter(Boolean).join(' ')
        }
      }

      pending.length = 0
      prevAnchorY = y
      mergedRows.push(anchorCells)
    }
  }

  // Flush any remaining continuations after the last anchor as trailing
  if (pending.length > 0 && mergedRows.length > 0) {
    const prev = mergedRows[mergedRows.length - 1]
    for (const cont of pending) {
      cont.cells.forEach((cell, ci) => {
        if (cell.trim()) {
          prev[ci] = prev[ci] ? `${prev[ci]} ${cell.trim()}` : cell.trim()
        }
      })
    }
  }

  return [{
    name: file.name.replace(/\.pdf$/i, ''),
    headers,
    rows: mergedRows,
    rowCount: mergedRows.length,
  }]
}
