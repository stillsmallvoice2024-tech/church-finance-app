import * as pdfjsLib from 'pdfjs-dist'
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc

// ── Exported error types ───────────────────────────────────────────────────────

export class PdfPasswordError extends Error {
  readonly reason: 'required' | 'incorrect'
  constructor(reason: 'required' | 'incorrect') {
    super(reason === 'required' ? 'Password required' : 'Incorrect password')
    this.name   = 'PdfPasswordError'
    this.reason = reason
  }
}

export class PdfDecryptError extends Error {
  constructor(detail: string) {
    super(detail)
    this.name = 'PdfDecryptError'
  }
}

/**
 * Converts a raw pdfjs load error into a typed PdfPasswordError / PdfDecryptError.
 * Exported so pdfPageRenderer can reuse the same logic without duplicating it.
 *
 * Always throws — return type is `never`.
 */
export function throwAsPdfError(err: unknown, hadPassword: boolean): never {
  if (err && typeof err === 'object') {
    const e = err as Record<string, unknown>
    if (e.name === 'PasswordException') {
      // pdfjs PasswordResponses: 1 = NEED_PASSWORD, 2 = INCORRECT_PASSWORD
      throw new PdfPasswordError(e.code === 2 ? 'incorrect' : 'required')
    }
  }
  const msg = err instanceof Error ? err.message : String(err)
  // Surface a clear "unable to decrypt" for any encryption-related failure, whether or
  // not a password was already supplied (covers unsupported algorithms, certificate
  // security, corrupted encryption dictionaries, unknown cipher handlers, etc.).
  if (hadPassword || /encrypt|decrypt|password|cipher|crypt|security|handler/i.test(msg)) {
    throw new PdfDecryptError(
      'This PDF uses an encryption format that cannot be opened here. ' +
      'Try one of the following:\n' +
      '1. Open it in Adobe Acrobat, Preview, or any PDF reader, then use File → Print → Save as PDF — this usually removes the encryption.\n' +
      '2. Log in to your bank\'s online portal and re-download the statement; many banks offer an unencrypted option.\n' +
      '3. Contact your bank and ask for the statement in CSV or Excel format instead.',
    )
  }
  throw err instanceof Error ? err : new Error(msg)
}

export interface ParsedSheet {
  name: string
  headers: string[]
  rows: unknown[][]
  rowCount: number
  /**
   * True when a real transaction table (header row + data rows) was located.
   * False means the whole-page fallback grid was used and the output is a
   * best-effort dump — callers may prefer OCR in that case.
   */
  tableDetected: boolean
  pageCount: number
}

export type { PdfTextItem, PdfPageItems, ExtractedTable } from './pdfTableExtract'
export {
  extractTableFromPages,
  mergeRowFragments,
  cleanHeaderCell,
  isDateLike,
  isAmountLike,
} from './pdfTableExtract'

import { extractTableFromPages, type PdfTextItem, type PdfPageItems } from './pdfTableExtract'

const DEFAULT_FONT_SIZE = 10

// ── pdfjs entry point ──────────────────────────────────────────────────────────

export async function parsePDF(file: File, password?: string): Promise<ParsedSheet[]> {
  const buffer = await file.arrayBuffer()
  let pdf: pdfjsLib.PDFDocumentProxy
  try {
    pdf = await pdfjsLib.getDocument({ data: buffer, password }).promise
  } catch (err) {
    throwAsPdfError(err, !!password)
  }

  const pages: PdfPageItems[] = []

  for (let p = 1; p <= pdf!.numPages; p++) {
    const page     = await pdf!.getPage(p)
    const viewport = page.getViewport({ scale: 1 })
    const content  = await page.getTextContent()

    const items: PdfTextItem[] = []
    for (const item of content.items) {
      if (!('str' in item) || !item.str.trim()) continue
      const tx = item.transform
      // tx is [scaleX, skewX, skewY, scaleY, x, y]
      const x      = tx[4]
      const height = Math.abs(item.height || tx[3]) || DEFAULT_FONT_SIZE
      const width  = item.width || item.str.length * height * 0.5
      items.push({
        x,
        xEnd: x + width,
        y: viewport.height - tx[5],   // flip to top-down
        height,
        text: item.str.trim(),
      })
    }

    pages.push({ height: viewport.height, items })
  }

  const { headers, rows, tableDetected } = extractTableFromPages(pages)
  if (rows.length === 0 && headers.length === 0) return []

  return [{
    name: file.name.replace(/\.pdf$/i, ''),
    headers,
    rows,
    rowCount: rows.length,
    tableDetected,
    pageCount: pdf!.numPages,
  }]
}
