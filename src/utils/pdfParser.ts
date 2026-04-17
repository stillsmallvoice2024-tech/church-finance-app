import * as pdfjsLib from 'pdfjs-dist'

// Use the CDN worker to avoid bundling the 2MB worker into the main bundle
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`

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

  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p)
    const viewport = page.getViewport({ scale: 1 })
    const content = await page.getTextContent()

    for (const item of content.items) {
      if (!('str' in item) || !item.str.trim()) continue
      const tx = item.transform
      // tx is [scaleX, skewX, skewY, scaleY, x, y]
      const x = tx[4]
      const y = viewport.height - tx[5]  // flip Y (PDF coords are bottom-up)
      allItems.push({ x, y, text: item.str.trim() })
    }
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

  // Filter rows that have at least 2 non-empty items (skip title/blank lines)
  const dataRows = textRows.filter(r => r.filter(i => i.text).length >= 2)
  if (dataRows.length === 0) return []

  // Detect column positions
  const colPositions = detectColumns(dataRows)

  // Build 2D string array
  const grid: string[][] = dataRows.map(row => assignToColumns(row, colPositions))

  // Remove completely empty columns
  const usedCols: number[] = []
  for (let ci = 0; ci < colPositions.length; ci++) {
    if (grid.some(row => row[ci]?.trim())) usedCols.push(ci)
  }
  const trimmedGrid = grid.map(row => usedCols.map(ci => row[ci] ?? ''))

  if (trimmedGrid.length === 0) return []

  // Determine header row
  let headers: string[]
  let dataStart: number
  if (looksLikeHeader(trimmedGrid[0])) {
    headers   = trimmedGrid[0].map((h, i) => h.trim() || `Column ${i + 1}`)
    dataStart = 1
  } else {
    headers   = trimmedGrid[0].map((_, i) => `Column ${i + 1}`)
    dataStart = 0
  }

  const rows = trimmedGrid.slice(dataStart).filter(r => r.some(c => c.trim()))

  return [{
    name: file.name.replace(/\.pdf$/i, ''),
    headers,
    rows,
    rowCount: rows.length,
  }]
}
