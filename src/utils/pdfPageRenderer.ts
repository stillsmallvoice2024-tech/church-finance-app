import * as pdfjsLib from 'pdfjs-dist'
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { throwAsPdfError } from './pdfParser'

pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc

export async function getPdfPageCount(file: File, password?: string): Promise<number> {
  const buffer = await file.arrayBuffer()
  try {
    const pdf = await pdfjsLib.getDocument({ data: buffer, password }).promise
    return pdf.numPages
  } catch (err) {
    throwAsPdfError(err, !!password)
  }
}

/**
 * Longest edge, in pixels, that the OCR vision model accepts before it
 * downscales the image itself. Rendering above this buys nothing and costs
 * upload bandwidth; rendering below it throws away legibility on the small
 * print that bank statements are made of.
 */
export const MAX_OCR_IMAGE_EDGE = 2576

/** Never magnify a page beyond this, however small its media box claims to be. */
const MAX_RENDER_SCALE = 4.0

/**
 * Scale that lands the page's longest edge as close to the model's limit as
 * possible. Derived from the page's own dimensions rather than a fixed
 * multiplier so Letter, A4 and any odd media box all arrive at full usable
 * resolution — a fixed 2× left Letter pages at 1584px, well short of the cap.
 */
function fitScale(widthPt: number, heightPt: number): number {
  const longestEdge = Math.max(widthPt, heightPt)
  if (longestEdge <= 0) return 2.0
  return Math.min(MAX_RENDER_SCALE, MAX_OCR_IMAGE_EDGE / longestEdge)
}

export async function renderPageToBase64(
  file: File,
  pageNumber: number,
  scale?: number,
  password?: string,
): Promise<string> {
  const buffer = await file.arrayBuffer()
  let pdf: pdfjsLib.PDFDocumentProxy
  try {
    pdf = await pdfjsLib.getDocument({ data: buffer, password }).promise
  } catch (err) {
    throwAsPdfError(err, !!password)
  }

  const page = await pdf!.getPage(pageNumber)
  // Measure the page at 1:1 first, then pick the scale that fills the model's
  // resolution budget.
  const base     = page.getViewport({ scale: 1 })
  const viewport = page.getViewport({ scale: scale ?? fitScale(base.width, base.height) })

  const canvas   = document.createElement('canvas')
  canvas.width   = viewport.width
  canvas.height  = viewport.height

  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D context unavailable')

  await page.render({ canvas, canvasContext: ctx, viewport }).promise
  return canvas.toDataURL('image/png').split(',')[1]
}
