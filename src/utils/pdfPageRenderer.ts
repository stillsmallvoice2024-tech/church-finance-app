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
 * Floor for the back-off below — beneath this, small print stops being legible
 * and OCR accuracy falls off faster than the payload shrinks.
 */
const MIN_RENDER_SCALE = 1.5

/**
 * Ceiling on the base64 payload for one page. The vision API rejects a single
 * base64 image above 5MB outright, so this leaves headroom for the surrounding
 * JSON envelope rather than sitting on the limit.
 */
const MAX_OCR_IMAGE_BYTES = 3_500_000

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
  const base = page.getViewport({ scale: 1 })

  const renderAt = async (s: number): Promise<string> => {
    const viewport = page.getViewport({ scale: s })
    const canvas   = document.createElement('canvas')
    canvas.width   = viewport.width
    canvas.height  = viewport.height

    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas 2D context unavailable')

    await page.render({ canvas, canvasContext: ctx, viewport }).promise
    return canvas.toDataURL('image/png').split(',')[1]
  }

  // An explicit scale is honoured as given — the caller has decided.
  if (scale !== undefined) return renderAt(scale)

  // Otherwise fill the resolution budget, then back off if the encoded image
  // would breach the payload ceiling. A dense page can encode far larger than a
  // sparse one at the same pixel count, so this has to be measured rather than
  // predicted: an over-large image is rejected by the API outright, which would
  // fail the whole page for the sake of detail the model never sees.
  let current = fitScale(base.width, base.height)
  for (let attempt = 0; attempt < 3; attempt++) {
    const encoded = await renderAt(current)
    if (encoded.length <= MAX_OCR_IMAGE_BYTES || current <= MIN_RENDER_SCALE) return encoded
    current = Math.max(MIN_RENDER_SCALE, current * 0.75)
  }
  return renderAt(MIN_RENDER_SCALE)
}
