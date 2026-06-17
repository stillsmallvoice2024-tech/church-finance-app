import { useState, useRef, useCallback } from 'react'
import * as XLSX from 'xlsx'
import { useNavigate, Navigate } from 'react-router-dom'
import {
  FileText, Download, ArrowRight, AlertTriangle,
  Loader2, X, RotateCcw, ChevronDown, ScanText,
} from 'lucide-react'
import { parsePDF } from '../utils/pdfParser'
import { getPdfPageCount, renderPageToBase64 } from '../utils/pdfPageRenderer'
import { supabase } from '../lib/supabase'
import { useToastStore } from '../store/toastStore'
import { usePageTitle } from '../hooks/usePageTitle'
import { useRole } from '../hooks/useRole'

// ── Types ─────────────────────────────────────────────────────────────────────

type Phase = 'idle' | 'extracting' | 'preview' | 'error'

interface ExtractionResult {
  headers:   string[]
  rawRows:   string[][]
  confidence: number[][]
  warnings:  string[]
  method:    'native' | 'ocr'
  pageCount: number
}

interface OcrProgress {
  current:    number
  total:      number
  statusText: string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function cellCls(confidence: number): string {
  if (confidence >= 0.85) return ''
  if (confidence >= 0.70) return 'bg-amber-50 text-amber-900'
  return 'bg-red-50 text-red-900'
}

// Defined outside the component so it doesn't need to be in any dependency arrays.
// Calls setProgress with current state — caller passes a stable setter ref.
async function runOcrPipeline(
  file: File,
  onProgress: (p: OcrProgress) => void,
): Promise<Pick<ExtractionResult, 'headers' | 'rawRows' | 'confidence' | 'warnings' | 'pageCount'>> {
  const pageCount = await getPdfPageCount(file)
  onProgress({ current: 0, total: pageCount, statusText: 'Scanned PDF detected, starting OCR…' })

  const allHeaders:    string[]   = []
  const allRawRows:    string[][] = []
  const allConfidence: number[][] = []
  const allWarnings:   string[]   = []

  for (let p = 1; p <= pageCount; p++) {
    onProgress({ current: p, total: pageCount, statusText: `OCR: page ${p} of ${pageCount}…` })

    const base64 = await renderPageToBase64(file, p)
    const { data, error } = await supabase.functions.invoke('pdf-ocr', {
      body: { image: base64, mimeType: 'image/png', pageNumber: p },
    })

    if (error || !data?.ok) {
      const msg = (data?.error as string | undefined) ?? (error as Error | null)?.message ?? 'OCR failed'
      allWarnings.push(`Page ${p}: ${msg}`)
      continue
    }

    if (allHeaders.length === 0 && Array.isArray(data.headers) && (data.headers as unknown[]).length > 0) {
      allHeaders.push(...(data.headers as string[]))
    }

    if (Array.isArray(data.rows) && (data.rows as unknown[]).length > 0) {
      const rows = data.rows as string[][]
      const conf: number[][] = Array.isArray(data.confidence)
        ? (data.confidence as number[][])
        : rows.map(r => r.map(() => 0.9))
      allRawRows.push(...rows)
      allConfidence.push(...conf)
      if (Array.isArray(data.warnings)) {
        allWarnings.push(...(data.warnings as string[]).map(w => `Page ${p}: ${w}`))
      }
    }
  }

  return { headers: allHeaders, rawRows: allRawRows, confidence: allConfidence, warnings: allWarnings, pageCount }
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function PdfConverter() {
  const { canWrite }        = useRole()
  usePageTitle('PDF Converter')
  const navigate            = useNavigate()
  const { push: toast }     = useToastStore()

  const [phase,        setPhase]        = useState<Phase>('idle')
  const [file,         setFile]         = useState<File | null>(null)
  const [dragging,     setDragging]     = useState(false)
  const [result,       setResult]       = useState<ExtractionResult | null>(null)
  const [editedRows,   setEditedRows]   = useState<string[][]>([])
  const [editingCell,  setEditingCell]  = useState<{ r: number; c: number } | null>(null)
  const [editValue,    setEditValue]    = useState('')
  const [ocrProgress,  setOcrProgress]  = useState<OcrProgress>({ current: 0, total: 0, statusText: '' })
  const [extractError, setExtractError] = useState<string | null>(null)
  const [warningsOpen, setWarningsOpen] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Route guard — must come after all hooks
  if (!canWrite()) return <Navigate to="/" replace />

  // ── Extraction ──────────────────────────────────────────────────────────────

  const applyResult = (res: ExtractionResult) => {
    setResult(res)
    setEditedRows(res.rawRows.map(r => [...r]))
    setPhase('preview')
  }

  const extract = useCallback(async (f: File) => {
    if (!f.name.match(/\.pdf$/i)) {
      toast('Only PDF files are supported', 'error')
      return
    }
    setFile(f)
    setPhase('extracting')
    setExtractError(null)
    setOcrProgress({ current: 0, total: 0, statusText: 'Analysing PDF…' })

    try {
      // Attempt native text extraction first
      setOcrProgress(p => ({ ...p, statusText: 'Extracting native text…' }))
      const sheets = await parsePDF(f)
      const sheet  = sheets[0]

      if (sheet && sheet.rows.length >= 5) {
        const rawRows    = sheet.rows.map(r => r.map(c => String(c ?? '')))
        const confidence = rawRows.map(r => r.map(() => 1.0))
        applyResult({ headers: sheet.headers, rawRows, confidence, warnings: [], method: 'native', pageCount: 1 })
        return
      }

      // Fall back to OCR
      const { headers, rawRows, confidence, warnings, pageCount } =
        await runOcrPipeline(f, setOcrProgress)

      if (rawRows.length === 0) {
        throw new Error(
          'No data could be extracted. The PDF may be empty, password-protected, or contain only images that could not be read.',
        )
      }

      const finalHeaders = headers.length > 0
        ? headers
        : ['Date', 'Description', 'Credit', 'Debit', 'Balance', 'Reference']

      applyResult({ headers: finalHeaders, rawRows, confidence, warnings, method: 'ocr', pageCount })
    } catch (e) {
      setExtractError(e instanceof Error ? e.message : 'Extraction failed')
      setPhase('error')
    }
  }, [toast]) // eslint-disable-line react-hooks/exhaustive-deps

  const reExtractWithOcr = useCallback(async () => {
    if (!file) return
    setPhase('extracting')
    setExtractError(null)

    try {
      const { headers, rawRows, confidence, warnings, pageCount } =
        await runOcrPipeline(file, setOcrProgress)

      const finalHeaders = headers.length > 0
        ? headers
        : (result?.headers ?? ['Date', 'Description', 'Credit', 'Debit', 'Balance', 'Reference'])

      applyResult({ headers: finalHeaders, rawRows, confidence, warnings, method: 'ocr', pageCount })
    } catch (e) {
      setExtractError(e instanceof Error ? e.message : 'Re-extraction failed')
      setPhase('error')
    }
  }, [file, result]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Cell editing ────────────────────────────────────────────────────────────

  const startEdit = (r: number, c: number) => {
    setEditingCell({ r, c })
    setEditValue(editedRows[r]?.[c] ?? '')
  }

  const commitEdit = () => {
    if (!editingCell) return
    const { r, c } = editingCell
    setEditedRows(prev => {
      const next = prev.map(row => [...row])
      if (next[r]) next[r][c] = editValue
      return next
    })
    setEditingCell(null)
  }

  const resetCell = (r: number, c: number) => {
    if (!result) return
    setEditedRows(prev => {
      const next = prev.map(row => [...row])
      if (next[r]) next[r][c] = result.rawRows[r]?.[c] ?? ''
      return next
    })
  }

  // ── Export ──────────────────────────────────────────────────────────────────

  const downloadFullXlsx = () => {
    if (!result || !file) return
    const wb = XLSX.utils.book_new()

    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([result.headers, ...result.rawRows]),
      'Raw Extracted Data',
    )
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([result.headers, ...editedRows]),
      'Normalized Data',
    )

    const warnRows: string[][] = [['Row', 'Column', 'Issue', 'Original Value', 'Confidence']]
    result.confidence.forEach((row, ri) => {
      row.forEach((conf, ci) => {
        if (conf < 0.85) {
          warnRows.push([
            String(ri + 1),
            result.headers[ci] ?? `Col ${ci + 1}`,
            conf < 0.7
              ? 'Low confidence — value may be incorrect'
              : 'Moderate confidence — verify value',
            result.rawRows[ri]?.[ci] ?? '',
            conf.toFixed(2),
          ])
        }
      })
    })
    result.warnings.forEach(w => warnRows.push(['', '', w, '', '']))
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(warnRows), 'Extraction Warnings')

    XLSX.writeFile(wb, `${file.name.replace(/\.pdf$/i, '')}-full-report.xlsx`)
  }

  const sendToImport = () => {
    if (!result || !file) return
    const ws  = XLSX.utils.aoa_to_sheet([result.headers, ...editedRows])
    const wb  = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Data')
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
    const xlsxFile = new File(
      [buf],
      file.name.replace(/\.pdf$/i, '-converted.xlsx'),
      { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
    )
    navigate('/import', { state: { file: xlsxFile } })
  }

  const reset = () => {
    setPhase('idle')
    setFile(null)
    setResult(null)
    setEditedRows([])
    setEditingCell(null)
    setExtractError(null)
    setWarningsOpen(false)
  }

  // ── Derived ─────────────────────────────────────────────────────────────────

  const lowConfCount = result
    ? result.confidence.flat().filter(c => c < 0.85).length
    : 0

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5 max-w-6xl">

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 pb-4 border-b border-gray-100">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-gray-900">PDF Converter</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Convert PDF bank statements to spreadsheets, then send directly to Import
          </p>
        </div>
      </div>

      {/* ── Idle: upload zone ─────────────────────────────────────────────── */}
      {phase === 'idle' && (
        <div
          onDragOver={e => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={e => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f) extract(f) }}
          onClick={() => fileInputRef.current?.click()}
          className={`cursor-pointer border-2 border-dashed rounded-xl p-14 flex flex-col items-center gap-4 transition-colors ${
            dragging
              ? 'border-primary bg-primary/5'
              : 'border-gray-300 bg-gray-50 hover:border-primary hover:bg-primary/5'
          }`}
        >
          <div className={`p-5 rounded-full transition-colors ${dragging ? 'bg-primary/10' : 'bg-white shadow-sm'}`}>
            <FileText className={`w-8 h-8 ${dragging ? 'text-primary' : 'text-gray-400'}`} />
          </div>
          <div className="text-center">
            <p className="text-sm font-semibold text-gray-700">
              Drop a PDF here, or{' '}
              <span className="text-primary underline underline-offset-2">click to browse</span>
            </p>
            <p className="text-xs text-gray-500 mt-1">Bank statements, receipts and financial reports</p>
            <p className="text-xs text-gray-400 mt-2">
              Native text extraction is tried first · Scanned pages use AI-powered OCR
            </p>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf"
            className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) extract(f); e.target.value = '' }}
          />
        </div>
      )}

      {/* ── Extracting ────────────────────────────────────────────────────── */}
      {phase === 'extracting' && (
        <div className="rounded-xl border border-gray-200 bg-white p-10 flex flex-col items-center gap-5">
          <Loader2 className="w-10 h-10 text-primary animate-spin" />
          <div className="text-center space-y-1">
            <p className="text-sm font-semibold text-gray-700">{ocrProgress.statusText}</p>
            {ocrProgress.total > 0 && (
              <>
                <p className="text-xs text-gray-500">
                  Page {ocrProgress.current} of {ocrProgress.total}
                </p>
                <div className="w-52 h-1.5 bg-gray-100 rounded-full overflow-hidden mt-2 mx-auto">
                  <div
                    className="h-full bg-primary rounded-full transition-all duration-300"
                    style={{ width: `${Math.round((ocrProgress.current / ocrProgress.total) * 100)}%` }}
                  />
                </div>
              </>
            )}
          </div>
          {file && (
            <p className="text-xs text-gray-400 font-mono truncate max-w-xs">{file.name}</p>
          )}
        </div>
      )}

      {/* ── Error ─────────────────────────────────────────────────────────── */}
      {phase === 'error' && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-6 space-y-3">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-red-700">Extraction failed</p>
              <p className="text-sm text-red-600 mt-0.5">{extractError}</p>
            </div>
          </div>
          <button
            onClick={reset}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-red-700 bg-white border border-red-300 rounded-lg hover:bg-red-50 transition-colors"
          >
            <RotateCcw className="w-4 h-4" /> Try another file
          </button>
        </div>
      )}

      {/* ── Preview ───────────────────────────────────────────────────────── */}
      {phase === 'preview' && result && (
        <div className="space-y-4">

          {/* File info bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white px-5 py-3">
            <div className="flex items-center gap-3 min-w-0">
              <FileText className="w-4 h-4 text-red-500 shrink-0" />
              <span className="text-sm font-medium text-gray-700 truncate">{file?.name}</span>
              <span className="text-xs text-gray-400 shrink-0">
                · {editedRows.length.toLocaleString()} rows
              </span>
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${
                result.method === 'native'
                  ? 'bg-green-100 text-green-700'
                  : 'bg-blue-100 text-blue-700'
              }`}>
                {result.method === 'native'
                  ? 'Native text'
                  : `OCR · ${result.pageCount} page${result.pageCount !== 1 ? 's' : ''}`}
              </span>
            </div>
            <button
              onClick={reset}
              className="touch-target p-1 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors shrink-0"
              title="Start over"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Warnings banner */}
          {(result.warnings.length > 0 || lowConfCount > 0) && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 overflow-hidden">
              <button
                onClick={() => setWarningsOpen(v => !v)}
                className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-amber-800 hover:bg-amber-100/50 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>
                    {[
                      lowConfCount > 0 && `${lowConfCount} low-confidence cell${lowConfCount !== 1 ? 's' : ''}`,
                      result.warnings.length > 0 && `${result.warnings.length} warning${result.warnings.length !== 1 ? 's' : ''}`,
                    ].filter(Boolean).join(' · ')}
                    {' '}— highlighted cells below
                  </span>
                </div>
                <ChevronDown className={`w-4 h-4 transition-transform shrink-0 ${warningsOpen ? 'rotate-180' : ''}`} />
              </button>
              {warningsOpen && result.warnings.length > 0 && (
                <ul className="border-t border-amber-100 max-h-36 overflow-y-auto divide-y divide-amber-100">
                  {result.warnings.map((w, i) => (
                    <li key={i} className="px-4 py-1.5 text-xs text-amber-700">{w}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* Editable table */}
          <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
            <div className="overflow-x-auto max-h-[55vh] overflow-y-auto">
              <table className="text-xs min-w-full border-collapse">
                <thead className="sticky top-0 z-10 bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="w-8 px-2 py-2.5 text-left font-normal text-gray-400 select-none">#</th>
                    {result.headers.map((h, ci) => (
                      <th key={ci} className="px-3 py-2.5 text-left text-gray-600 font-semibold whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {editedRows.map((row, ri) => (
                    <tr key={ri} className="hover:bg-gray-50/40 group">
                      <td className="px-2 py-1.5 text-gray-300 select-none text-right">{ri + 1}</td>
                      {row.map((cell, ci) => {
                        const conf      = result.confidence[ri]?.[ci] ?? 1.0
                        const isEditing = editingCell?.r === ri && editingCell?.c === ci
                        const isEdited  = cell !== (result.rawRows[ri]?.[ci] ?? '')

                        return (
                          <td
                            key={ci}
                            className={`relative px-3 py-1.5 ${cellCls(conf)} ${isEdited ? 'font-semibold' : ''}`}
                            title={conf < 0.85
                              ? `Confidence: ${Math.round(conf * 100)}%  |  Original: ${result.rawRows[ri]?.[ci] ?? ''}`
                              : undefined}
                          >
                            {isEditing ? (
                              <input
                                autoFocus
                                value={editValue}
                                onChange={e => setEditValue(e.target.value)}
                                onBlur={commitEdit}
                                onKeyDown={e => {
                                  if (e.key === 'Enter')  commitEdit()
                                  if (e.key === 'Escape') setEditingCell(null)
                                }}
                                className="w-full min-w-[80px] px-1 py-0.5 border border-primary rounded text-xs outline-none focus:ring-1 focus:ring-primary/30 bg-white text-gray-900"
                              />
                            ) : (
                              <span
                                onClick={() => startEdit(ri, ci)}
                                className="cursor-text block min-h-[1rem] min-w-[2rem]"
                              >
                                {cell || <span className="text-gray-300">—</span>}
                              </span>
                            )}
                            {isEdited && !isEditing && (
                              <button
                                onClick={e => { e.stopPropagation(); resetCell(ri, ci) }}
                                className="absolute right-0.5 top-0.5 p-0.5 rounded text-gray-400 hover:text-gray-600 opacity-0 group-hover:opacity-100 transition-opacity"
                                title="Reset to original"
                              >
                                <RotateCcw className="w-2.5 h-2.5" />
                              </button>
                            )}
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Action bar */}
          <div className="flex flex-wrap items-center gap-3">
            {result.method === 'native' && (
              <button
                onClick={reExtractWithOcr}
                className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-black/[0.02] dark:hover:bg-white/[0.03] transition-colors"
              >
                <ScanText className="w-4 h-4" />
                Re-extract with OCR
              </button>
            )}
            <button
              onClick={downloadFullXlsx}
              className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-black/[0.02] dark:hover:bg-white/[0.03] transition-colors"
            >
              <Download className="w-4 h-4" />
              Download XLSX
            </button>
            <button
              onClick={sendToImport}
              className="flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary-light transition-colors"
            >
              Send to Import
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>

          {/* Helper notes */}
          <div className="text-xs text-gray-400 space-y-0.5">
            <p>Click any cell to edit inline. Amber and red cells have lower extraction confidence — verify before importing.</p>
            <p>Download XLSX includes raw data, your edits, and extraction warnings across three sheets.</p>
          </div>

        </div>
      )}
    </div>
  )
}
