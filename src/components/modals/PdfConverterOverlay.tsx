import { useState, useCallback, useEffect, useRef } from 'react'
import * as XLSX from 'xlsx'
import {
  FileText, Download, AlertTriangle,
  Loader2, X, RotateCcw, ChevronDown, ScanText, ArrowRight, Lock, Trash2,
} from 'lucide-react'
import { parsePDF, PdfPasswordError, PdfDecryptError } from '../../utils/pdfParser'
import { getPdfPageCount, renderPageToBase64 } from '../../utils/pdfPageRenderer'
import { supabase } from '../../lib/supabase'

// ── Types ─────────────────────────────────────────────────────────────────────

type Phase = 'extracting' | 'password' | 'preview' | 'error'

interface ExtractionResult {
  headers:    string[]
  rawRows:    string[][]
  confidence: number[][]
  warnings:   string[]
  method:     'native' | 'ocr'
  pageCount:  number
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

async function runOcrPipeline(
  file: File,
  onProgress: (p: OcrProgress) => void,
  password?: string,
): Promise<Pick<ExtractionResult, 'headers' | 'rawRows' | 'confidence' | 'warnings' | 'pageCount'>> {
  const pageCount = await getPdfPageCount(file, password)
  onProgress({ current: 0, total: pageCount, statusText: 'Scanned PDF detected, starting OCR…' })

  const allHeaders:    string[]   = []
  const allRawRows:    string[][] = []
  const allConfidence: number[][] = []
  const allWarnings:   string[]   = []

  for (let p = 1; p <= pageCount; p++) {
    onProgress({ current: p, total: pageCount, statusText: `OCR: page ${p} of ${pageCount}…` })

    const base64 = await renderPageToBase64(file, p, 2.0, password)
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

interface Props {
  file:      File
  onConfirm: (xlsxFile: File) => void
  onCancel:  () => void
}

export function PdfConverterOverlay({ file, onConfirm, onCancel }: Props) {
  const [phase,              setPhase]              = useState<Phase>('extracting')
  const [result,             setResult]             = useState<ExtractionResult | null>(null)
  const [editedRows,         setEditedRows]         = useState<string[][]>([])
  const [isDirty,            setIsDirty]            = useState(false)
  const [discardConfirm,     setDiscardConfirm]     = useState(false)
  const [editingCell,        setEditingCell]        = useState<{ r: number; c: number } | null>(null)
  const [editValue,          setEditValue]          = useState('')
  const [ocrProgress,        setOcrProgress]        = useState<OcrProgress>({ current: 0, total: 0, statusText: '' })
  const [extractError,       setExtractError]       = useState<string | null>(null)
  const [extractErrorTitle,  setExtractErrorTitle]  = useState('Extraction failed')
  const [warningsOpen,       setWarningsOpen]       = useState(false)
  const [passwordValue,      setPasswordValue]      = useState('')
  const [passwordError,      setPasswordError]      = useState<string | null>(null)
  const [deletedRowIndices,  setDeletedRowIndices]  = useState<Set<number>>(new Set())
  const [deletedColIndices,  setDeletedColIndices]  = useState<Set<number>>(new Set())
  // Retains the password that last unlocked the file so re-extract-with-OCR can reuse it
  const lastPasswordRef = useRef<string | undefined>(undefined)

  const applyResult = (res: ExtractionResult) => {
    setResult(res)
    setEditedRows(res.rawRows.map(r => [...r]))
    setIsDirty(false)
    setDeletedRowIndices(new Set())
    setDeletedColIndices(new Set())
    setPhase('preview')
  }

  // Guard close/cancel — ask for confirmation when the user has unsaved edits.
  const handleCancel = () => {
    if (isDirty) { setDiscardConfirm(true) } else { onCancel() }
  }

  const extract = useCallback(async (f: File, password?: string) => {
    setPhase('extracting')
    setExtractError(null)
    setExtractErrorTitle('Extraction failed')
    setPasswordError(null)
    setOcrProgress({ current: 0, total: 0, statusText: 'Analysing PDF…' })

    try {
      setOcrProgress(p => ({ ...p, statusText: 'Extracting native text…' }))
      const sheets = await parsePDF(f, password)
      const sheet  = sheets[0]

      if (sheet && sheet.rows.length >= 5) {
        const rawRows    = sheet.rows.map(r => r.map(c => String(c ?? '')))
        const confidence = rawRows.map(r => r.map(() => 1.0))
        lastPasswordRef.current = password
        applyResult({ headers: sheet.headers, rawRows, confidence, warnings: [], method: 'native', pageCount: 1 })
        return
      }

      const { headers, rawRows, confidence, warnings, pageCount } =
        await runOcrPipeline(f, setOcrProgress, password)

      if (rawRows.length === 0) {
        throw new Error(
          'No data could be read from this file. The PDF may be empty, unsupported, or corrupted. ' +
          'Try downloading it again from your bank\'s portal, or contact your bank and ask for the statement in CSV or Excel format.',
        )
      }

      const finalHeaders = headers.length > 0
        ? headers
        : ['Date', 'Description', 'Credit', 'Debit', 'Balance', 'Reference']

      lastPasswordRef.current = password
      applyResult({ headers: finalHeaders, rawRows, confidence, warnings, method: 'ocr', pageCount })
    } catch (e) {
      if (e instanceof PdfPasswordError) {
        setPasswordError(
          e.reason === 'incorrect'
            ? 'That password didn\'t work. Confirm the correct password with your bank or financial provider — it\'s often sent by email or SMS separately from the statement — then try again.'
            : null,
        )
        setPhase('password')
        return
      }
      if (e instanceof PdfDecryptError) {
        setExtractErrorTitle('Unable to open this PDF')
        setExtractError(e.message)
        setPhase('error')
        return
      }
      setExtractError(e instanceof Error ? e.message : 'Extraction failed')
      setPhase('error')
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const reExtractWithOcr = useCallback(async () => {
    setPhase('extracting')
    setExtractError(null)
    setExtractErrorTitle('Extraction failed')
    setPasswordError(null)

    try {
      const { headers, rawRows, confidence, warnings, pageCount } =
        await runOcrPipeline(file, setOcrProgress, lastPasswordRef.current)

      const finalHeaders = headers.length > 0
        ? headers
        : (result?.headers ?? ['Date', 'Description', 'Credit', 'Debit', 'Balance', 'Reference'])

      applyResult({ headers: finalHeaders, rawRows, confidence, warnings, method: 'ocr', pageCount })
    } catch (e) {
      if (e instanceof PdfPasswordError) {
        setPasswordError(
          e.reason === 'incorrect'
            ? 'That password didn\'t work. Confirm the correct password with your bank or financial provider — it\'s often sent by email or SMS separately from the statement — then try again.'
            : null,
        )
        setPhase('password')
        return
      }
      if (e instanceof PdfDecryptError) {
        setExtractErrorTitle('Unable to open this PDF')
        setExtractError(e.message)
        setPhase('error')
        return
      }
      setExtractError(e instanceof Error ? e.message : 'Re-extraction failed')
      setPhase('error')
    }
  }, [file, result]) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-start extraction when the overlay mounts with the provided file
  useEffect(() => { extract(file) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Cell editing ────────────────────────────────────────────────────────────

  const startEdit = (r: number, c: number) => {
    setEditingCell({ r, c })
    setEditValue(editedRows[r]?.[c] ?? '')
  }

  const commitEdit = () => {
    if (!editingCell) return
    const { r, c } = editingCell
    // Check outside the updater — calling setState inside another setState updater is a side-effect
    if (editedRows[r]?.[c] !== editValue) setIsDirty(true)
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

  // ── Row / column deletion ───────────────────────────────────────────────────

  const deleteRow = (ri: number) => {
    setDeletedRowIndices(prev => new Set([...prev, ri]))
    setIsDirty(true)
  }

  const deleteCol = (ci: number) => {
    setDeletedColIndices(prev => new Set([...prev, ci]))
    setIsDirty(true)
  }

  // ── Export / confirm ────────────────────────────────────────────────────────

  const downloadFullXlsx = () => {
    if (!result) return
    const wb = XLSX.utils.book_new()

    const activeHeaders  = result.headers.filter((_, ci) => !deletedColIndices.has(ci))
    const activeRawRows  = result.rawRows
      .filter((_, ri) => !deletedRowIndices.has(ri))
      .map(row => row.filter((_, ci) => !deletedColIndices.has(ci)))
    const activeEditRows = editedRows
      .filter((_, ri) => !deletedRowIndices.has(ri))
      .map(row => row.filter((_, ci) => !deletedColIndices.has(ci)))

    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([activeHeaders, ...activeRawRows]),
      'Raw Extracted Data',
    )
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([activeHeaders, ...activeEditRows]),
      'Normalized Data',
    )

    const warnRows: string[][] = [['Row', 'Column', 'Issue', 'Original Value', 'Confidence']]
    result.confidence.forEach((row, ri) => {
      if (deletedRowIndices.has(ri)) return
      row.forEach((conf, ci) => {
        if (deletedColIndices.has(ci)) return
        if (conf < 0.85) {
          warnRows.push([
            String(ri + 1),
            result.headers[ci] ?? `Col ${ci + 1}`,
            conf < 0.7 ? 'Low confidence — value may be incorrect' : 'Moderate confidence — verify value',
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

  const handleConfirm = () => {
    if (!result) return
    const activeHeaders = result.headers.filter((_, ci) => !deletedColIndices.has(ci))
    const activeRows    = editedRows
      .filter((_, ri) => !deletedRowIndices.has(ri))
      .map(row => row.filter((_, ci) => !deletedColIndices.has(ci)))
    const ws  = XLSX.utils.aoa_to_sheet([activeHeaders, ...activeRows])
    const wb  = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Data')
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
    const xlsxFile = new File(
      [buf],
      file.name.replace(/\.pdf$/i, '-converted.xlsx'),
      { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
    )
    onConfirm(xlsxFile)
  }

  // ── Derived ─────────────────────────────────────────────────────────────────

  const lowConfCount = result
    ? result.confidence.flat().filter(c => c < 0.85).length
    : 0

  const activeRowCount = editedRows.length - deletedRowIndices.size
  const activeColCount = result ? result.headers.length - deletedColIndices.size : 0

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-white dark:bg-gray-950 overflow-hidden">

      {/* Discard-edits confirmation */}
      {discardConfirm && (
        <div className="absolute inset-0 z-[60] flex items-center justify-center bg-black/40">
          <div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl border border-gray-200 dark:border-white/[0.08] p-6 w-80 space-y-4 mx-4">
            <p className="text-sm font-semibold text-gray-900 dark:text-white">Discard edits?</p>
            <p className="text-sm text-gray-500">You have unsaved changes. Closing now will lose all edits made to the extracted data.</p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setDiscardConfirm(false)}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 dark:bg-gray-800 dark:text-gray-200 dark:border-white/[0.12] dark:hover:bg-gray-700 transition-colors"
              >
                Keep editing
              </button>
              <button
                onClick={onCancel}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 transition-colors"
              >
                Discard and close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="shrink-0 flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-white/[0.07]">
        <div>
          <h2 className="text-base font-bold text-gray-900 dark:text-white">
            Convert PDF before importing
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Review and edit the extracted table, then continue to Import
          </p>
        </div>
        <button
          onClick={handleCancel}
          className="touch-target p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-white/[0.07] transition-colors"
          aria-label="Cancel conversion"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto px-6 py-5">
        <div className="max-w-6xl mx-auto space-y-5">

          {/* ── Extracting ───────────────────────────────────────────────── */}
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
              <p className="text-xs text-gray-400 font-mono truncate max-w-xs">{file.name}</p>
            </div>
          )}

          {/* ── Password required ────────────────────────────────────────── */}
          {phase === 'password' && (
            <div className="flex justify-center py-8">
              <div className="w-full max-w-sm rounded-xl border border-gray-200 bg-white dark:bg-gray-900 dark:border-white/[0.08] p-8 space-y-5 shadow-sm">

                <div className="flex flex-col items-center gap-3 text-center">
                  <div className="w-12 h-12 rounded-full bg-amber-50 dark:bg-amber-900/20 flex items-center justify-center">
                    <Lock className="w-5 h-5 text-amber-600 dark:text-amber-400" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-gray-900 dark:text-white">Password required</p>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 leading-relaxed">
                      This PDF is password-protected. Banks usually send the password separately — check the email or SMS that came with the statement, or look in your bank's online portal and enter the provided password to unlock it.
                    </p>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <input
                    type="password"
                    value={passwordValue}
                    autoFocus
                    autoComplete="current-password"
                    placeholder="PDF password"
                    onChange={e => setPasswordValue(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && passwordValue.trim()) {
                        const pwd = passwordValue
                        setPasswordValue('')
                        extract(file, pwd)
                      }
                    }}
                    className={`w-full px-3 py-2.5 rounded-lg border text-sm outline-none transition-colors ${
                      passwordError
                        ? 'border-red-400 focus:ring-2 focus:ring-red-200 bg-red-50 dark:bg-red-900/10'
                        : 'border-gray-300 dark:border-white/[0.12] focus:ring-2 focus:ring-primary/20 focus:border-primary dark:bg-gray-800 dark:text-white'
                    }`}
                  />
                  {passwordError && (
                    <p className="flex items-center gap-1.5 text-xs text-red-600 dark:text-red-400">
                      <AlertTriangle className="w-3 h-3 shrink-0" />
                      {passwordError}
                    </p>
                  )}
                </div>

                <div className="flex gap-3">
                  <button
                    onClick={onCancel}
                    className="flex-1 px-4 py-2.5 text-sm font-medium text-gray-600 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-white/[0.12] rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    disabled={!passwordValue.trim()}
                    onClick={() => {
                      const pwd = passwordValue
                      setPasswordValue('')
                      extract(file, pwd)
                    }}
                    className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary-light transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Lock className="w-4 h-4" />
                    Unlock and extract
                  </button>
                </div>

              </div>
            </div>
          )}

          {/* ── Error ────────────────────────────────────────────────────── */}
          {phase === 'error' && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-6 space-y-3">
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
                <div className="space-y-1.5">
                  <p className="text-sm font-semibold text-red-700">{extractErrorTitle}</p>
                  {extractError?.split('\n').map((line, i) => (
                    <p key={i} className="text-sm text-red-600">{line}</p>
                  ))}
                </div>
              </div>
              <button
                onClick={onCancel}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-red-700 bg-white border border-red-300 rounded-lg hover:bg-red-50 transition-colors"
              >
                <X className="w-4 h-4" /> Dismiss
              </button>
            </div>
          )}

          {/* ── Preview ──────────────────────────────────────────────────── */}
          {phase === 'preview' && result && (
            <div className="space-y-4">

              {/* File info bar */}
              <div className="flex flex-wrap items-center gap-3 rounded-xl border border-gray-200 bg-white px-5 py-3">
                <FileText className="w-4 h-4 text-red-500 shrink-0" />
                <span className="text-sm font-medium text-gray-700 truncate">{file.name}</span>
                <span className="text-xs text-gray-400 shrink-0">
                  · {activeRowCount.toLocaleString()} row{activeRowCount !== 1 ? 's' : ''}
                  {deletedRowIndices.size > 0 && ` (${deletedRowIndices.size} deleted)`}
                  {deletedColIndices.size > 0 && ` · ${activeColCount} of ${result.headers.length} columns`}
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
                        {result.headers.map((h, ci) => {
                          if (deletedColIndices.has(ci)) return null
                          return (
                            <th key={ci} className="group/col px-3 py-2.5 text-left text-gray-600 font-semibold whitespace-nowrap">
                              <span className="inline-flex items-center gap-1.5">
                                {h}
                                <button
                                  onClick={() => deleteCol(ci)}
                                  className="opacity-0 group-hover/col:opacity-100 transition-opacity text-gray-300 hover:text-red-500"
                                  title={`Delete column "${h}"`}
                                >
                                  <Trash2 className="w-3 h-3" />
                                </button>
                              </span>
                            </th>
                          )
                        })}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {editedRows.map((row, ri) => {
                        if (deletedRowIndices.has(ri)) return null
                        return (
                          <tr key={ri} className="hover:bg-gray-50/40 group">
                            <td className="relative w-8 px-2 py-1.5 text-gray-300 select-none text-right">
                              <span className="group-hover:opacity-0 transition-opacity">{ri + 1}</span>
                              <button
                                onClick={() => deleteRow(ri)}
                                className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity text-red-400 hover:text-red-600"
                                title="Delete row"
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                            </td>
                            {row.map((cell, ci) => {
                              if (deletedColIndices.has(ci)) return null
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
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Helper notes */}
              <div className="text-xs text-gray-400 space-y-0.5">
                <p>Click any cell to edit inline. Hover a row number or column header to delete that row or column.</p>
                <p>Amber and red cells have lower extraction confidence — verify before importing.</p>
                <p>Download XLSX includes raw data, your edits, and extraction warnings across three sheets.</p>
              </div>

            </div>
          )}

        </div>
      </div>

      {/* Footer — only shown in preview phase */}
      {phase === 'preview' && result && (
        <div className="shrink-0 border-t border-gray-200 dark:border-white/[0.07] px-6 py-4 flex flex-wrap items-center gap-3 bg-white dark:bg-gray-950">
          <button
            onClick={handleCancel}
            className="px-4 py-2.5 text-sm font-medium text-gray-600 bg-white border border-gray-300 rounded-lg hover:bg-black/[0.02] transition-colors"
          >
            Cancel
          </button>
          {result.method === 'native' && (
            <button
              onClick={reExtractWithOcr}
              className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-black/[0.02] transition-colors"
            >
              <ScanText className="w-4 h-4" />
              Re-extract with OCR
            </button>
          )}
          <div className="flex-1" />
          <button
            onClick={downloadFullXlsx}
            className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-black/[0.02] transition-colors"
          >
            <Download className="w-4 h-4" />
            Download XLSX
          </button>
          <button
            onClick={handleConfirm}
            className="flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary-light transition-colors"
          >
            Continue to Import
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      )}

    </div>
  )
}
