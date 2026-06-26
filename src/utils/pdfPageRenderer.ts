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

export async function renderPageToBase64(
  file: File,
  pageNumber: number,
  scale = 2.0,
  password?: string,
): Promise<string> {
  const buffer = await file.arrayBuffer()
  let pdf: pdfjsLib.PDFDocumentProxy
  try {
    pdf = await pdfjsLib.getDocument({ data: buffer, password }).promise
  } catch (err) {
    throwAsPdfError(err, !!password)
  }

  const page     = await pdf!.getPage(pageNumber)
  const viewport = page.getViewport({ scale })

  const canvas   = document.createElement('canvas')
  canvas.width   = viewport.width
  canvas.height  = viewport.height

  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D context unavailable')

  await page.render({ canvas, canvasContext: ctx, viewport }).promise
  return canvas.toDataURL('image/png').split(',')[1]
}
