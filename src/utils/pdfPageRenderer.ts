import * as pdfjsLib from 'pdfjs-dist'
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc

export async function getPdfPageCount(file: File): Promise<number> {
  const buffer = await file.arrayBuffer()
  const pdf    = await pdfjsLib.getDocument({ data: buffer }).promise
  return pdf.numPages
}

export async function renderPageToBase64(
  file: File,
  pageNumber: number,
  scale = 2.0,
): Promise<string> {
  const buffer   = await file.arrayBuffer()
  const pdf      = await pdfjsLib.getDocument({ data: buffer }).promise
  const page     = await pdf.getPage(pageNumber)
  const viewport = page.getViewport({ scale })

  const canvas   = document.createElement('canvas')
  canvas.width   = viewport.width
  canvas.height  = viewport.height

  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D context unavailable')

  await page.render({ canvasContext: ctx, viewport }).promise
  return canvas.toDataURL('image/png').split(',')[1]
}
