import { useEffect, useMemo, useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  FileSpreadsheet,
  Loader2,
} from 'lucide-react'
import { detectHeaderRow } from './ImportModal'
import { generateFallbackTransactionId } from '../../utils/generateTransactionId'
import { normalizeId } from '../../utils/normalizeId'
import { classifyIncomeType } from '../../utils/classifyIncomeType'
import { Modal } from '../ui/Modal'
import { useBanks } from '../../hooks/useBanks'
import { useIncomeTypes } from '../../hooks/useIncomeTypes'
import {
  useAllocationStore,
  getConfigForDate,
  getSpecialConfigVersionForDate,
} from '../../store/allocationStore'
import { useAuthStore } from '../../store/authStore'
import { useOrgStore } from '../../store/orgStore'
import { useToast } from '../../store/toastStore'
import { useOrgCurrency } from '../../hooks/useOrgCurrency'
import { supabase } from '../../lib/supabase'

// ---------------------------------------------------------------------------
// Local types
// ---------------------------------------------------------------------------

type Step = 'upload' | 'setup' | 'review' | 'importing' | 'done'

interface WizardRow {
  idx: number
  date: string
  description: string
  credit: number
  debit: number
  ref: string
}

interface WizardResult {
  imported: number
  skipped: number
  errors: string[]
}

interface Props {
  open: boolean
  onClose: () => void
}

// ---------------------------------------------------------------------------
// Helper: detectColumns
// ---------------------------------------------------------------------------

interface DetectedColumns {
  dateIdx: number
  creditIdx: number
  debitIdx: number
  descIdx: number
  refIdx: number
  amountIdx: number
}

function detectColumns(headers: string[]): DetectedColumns {
  const normalised = headers.map(h =>
    h.toLowerCase().replace(/[\s\-_.()+]/g, ''),
  )

  function findIdx(aliases: string[]): number {
    for (const alias of aliases) {
      const useEqualsOnly = alias.length <= 2
      for (let i = 0; i < normalised.length; i++) {
        const nh = normalised[i]
        if (useEqualsOnly) {
          if (nh === alias) return i
        } else {
          if (nh === alias || nh.includes(alias)) return i
        }
      }
    }
    return -1
  }

  const dateIdx = findIdx([
    'date',
    'txndate',
    'transactiondate',
    'valuedate',
    'postingdate',
  ])

  const creditIdx = findIdx([
    'credit',
    'creditamt',
    'deposits',
    'deposit',
    'inflow',
  ])

  const debitIdx = findIdx([
    'debit',
    'debitamt',
    'withdrawal',
    'withdrawals',
    'outflow',
    'payment',
  ])

  const descIdx = findIdx([
    'narration',
    'description',
    'details',
    'particulars',
    'remarks',
    'transactiondetails',
  ])

  const refIdx = findIdx([
    'reference',
    'transactionref',
    'txnref',
    'transactionid',
    'txnid',
  ])

  // amountIdx: exact match only to avoid creditamt stealing it
  const amountIdx = (() => {
    for (let i = 0; i < normalised.length; i++) {
      if (normalised[i] === 'amount') return i
    }
    return -1
  })()

  return { dateIdx, creditIdx, debitIdx, descIdx, refIdx, amountIdx }
}

// ---------------------------------------------------------------------------
// Helper: parseCredit
// ---------------------------------------------------------------------------

function parseCredit(raw: unknown): number {
  if (raw === null || raw === undefined || raw === '') return 0
  const str = String(raw).replace(/[^0-9.]/g, '')
  const n = parseFloat(str)
  if (isNaN(n) || n < 0) return 0
  return n
}

// ---------------------------------------------------------------------------
// Helper: parseDebit
// ---------------------------------------------------------------------------

function parseDebit(raw: unknown): number {
  if (raw === null || raw === undefined || raw === '') return 0
  const str = String(raw).trim()
  // Accounting notation: (1,234.56) → positive
  const accounting = str.match(/^\(([0-9,. ]+)\)$/)
  if (accounting) {
    const n = parseFloat(accounting[1].replace(/[^0-9.]/g, ''))
    return isNaN(n) ? 0 : Math.abs(n)
  }
  const cleaned = str.replace(/[^0-9.\-]/g, '')
  const n = parseFloat(cleaned)
  if (isNaN(n)) return 0
  return Math.abs(n)
}

// ---------------------------------------------------------------------------
// Helper: cellToDateStr
// ---------------------------------------------------------------------------

type DateFormat = 'dmy' | 'mdy'

function cellToDateStr(cell: unknown, format: DateFormat): string {
  if (cell instanceof Date) {
    const y = cell.getFullYear()
    const m = String(cell.getMonth() + 1).padStart(2, '0')
    const d = String(cell.getDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
  }

  if (typeof cell === 'number') {
    try {
      const parsed = XLSX.SSF.parse_date_code(cell)
      if (parsed && parsed.y && parsed.m && parsed.d) {
        const y = parsed.y
        const m = String(parsed.m).padStart(2, '0')
        const d = String(parsed.d).padStart(2, '0')
        return `${y}-${m}-${d}`
      }
    } catch {
      // fall through
    }
  }

  if (typeof cell === 'string') {
    const s = cell.trim()
    // YYYY-MM-DD is unambiguous
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
      return s.slice(0, 10)
    }
    // D/M/YYYY or M/D/YYYY — interpret based on user-selected format
    const parts = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/)
    if (parts) {
      const first  = parts[1].padStart(2, '0')
      const second = parts[2].padStart(2, '0')
      const year   = parts[3]
      const [month, day] = format === 'dmy' ? [second, first] : [first, second]
      return `${year}-${month}-${day}`
    }
  }

  return ''
}

// ---------------------------------------------------------------------------
// Helper: buildRows — convert raw XLSX data rows into WizardRow[]
// ---------------------------------------------------------------------------

function buildRows(
  dataRows: unknown[][],
  cols: DetectedColumns,
  format: DateFormat,
): { rows: WizardRow[]; hasRef: boolean } {
  const parsed: WizardRow[] = []
  let hasRef = false

  for (let i = 0; i < dataRows.length; i++) {
    const row = dataRows[i]
    const dateStr = cellToDateStr(row[cols.dateIdx], format)
    if (!dateStr) continue

    let credit = 0
    let debit = 0

    if (cols.creditIdx !== -1 && cols.debitIdx !== -1) {
      credit = parseCredit(row[cols.creditIdx])
      debit = parseDebit(row[cols.debitIdx])
    } else if (cols.amountIdx !== -1) {
      const strAmt = String(row[cols.amountIdx] ?? '').trim()
      const isNeg = strAmt.startsWith('-') || /^\(.*\)$/.test(strAmt)
      const absVal = parseDebit(row[cols.amountIdx])
      if (isNeg) { debit = absVal } else { credit = parseCredit(row[cols.amountIdx]) }
    } else if (cols.creditIdx !== -1) {
      credit = parseCredit(row[cols.creditIdx])
    } else if (cols.debitIdx !== -1) {
      debit = parseDebit(row[cols.debitIdx])
    }

    if (credit === 0 && debit === 0) continue

    const description = cols.descIdx !== -1
      ? normalizeId(String(row[cols.descIdx] ?? '').trim())
      : ''

    let ref = ''
    if (cols.refIdx !== -1) {
      ref = normalizeId(String(row[cols.refIdx] ?? '').trim())
      if (ref) hasRef = true
    }

    parsed.push({ idx: i, date: dateStr, description, credit, debit, ref })
  }

  return { rows: parsed, hasRef }
}

// ---------------------------------------------------------------------------
// Step indicator
// ---------------------------------------------------------------------------

const STEPS: { key: Step; label: string; num: number }[] = [
  { key: 'upload', label: 'Upload', num: 1 },
  { key: 'setup', label: 'Set Up', num: 2 },
  { key: 'review', label: 'Review', num: 3 },
  { key: 'importing', label: 'Import', num: 4 },
  { key: 'done', label: 'Done', num: 5 },
]

const STEP_ORDER: Step[] = ['upload', 'setup', 'review', 'importing', 'done']

function StepIndicator({ current }: { current: Step }) {
  const currentIdx = STEP_ORDER.indexOf(current)
  return (
    <div className="flex items-center justify-center gap-0 mb-6">
      {STEPS.map((s, i) => {
        const idx = STEP_ORDER.indexOf(s.key)
        const isPast = idx < currentIdx
        const isActive = idx === currentIdx
        const isFuture = idx > currentIdx

        return (
          <div key={s.key} className="flex items-center">
            <div className="flex flex-col items-center gap-1">
              <div
                className={[
                  'w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold transition-colors',
                  isActive
                    ? 'bg-primary text-white'
                    : isPast
                      ? 'bg-primary/20 text-primary'
                      : isFuture
                        ? 'bg-gray-200 dark:bg-gray-700 text-gray-400 dark:text-gray-500'
                        : '',
                ].join(' ')}
              >
                {isPast ? (
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2.5}
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                ) : (
                  s.num
                )}
              </div>
              <span
                className={[
                  'text-xs font-medium whitespace-nowrap',
                  isActive
                    ? 'text-primary'
                    : isPast
                      ? 'text-primary/70'
                      : 'text-gray-400 dark:text-gray-500',
                ].join(' ')}
              >
                {s.label}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div
                className={[
                  'h-px w-8 mx-1 mb-5 transition-colors',
                  idx < currentIdx
                    ? 'bg-primary/40'
                    : 'bg-gray-200 dark:bg-gray-700',
                ].join(' ')}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function ImportWizardModal({ open, onClose }: Props) {
  // ---- hooks ----
  const { banks } = useBanks()
  const { incomeTypes } = useIncomeTypes()
  const configs     = useAllocationStore(s => s.configs)
  const loaded      = useAllocationStore(s => s.loaded)
  const fetchConfigs = useAllocationStore(s => s.fetch)
  const { formatAmount } = useOrgCurrency()
  const toast = useToast()

  // ---- state ----
  const [step, setStep] = useState<Step>('upload')
  const [dragging, setDragging] = useState(false)
  const [parsing, setParsing] = useState(false)
  const [parseError, setParseError] = useState<string | null>(null)
  const [fileName, setFileName] = useState('')
  const [dateFormat, setDateFormat] = useState<DateFormat>('dmy')
  const [rawDataRows, setRawDataRows] = useState<unknown[][]>([])
  const [rawCols, setRawCols] = useState<DetectedColumns | null>(null)
  const [wizardRows, setWizardRows] = useState<WizardRow[]>([])
  const [hasRefCol, setHasRefCol] = useState(false)
  const [bankId, setBankId] = useState('')
  const [incomeTypeId, setIncomeTypeId] = useState('')
  const [configId, setConfigId] = useState('')
  const [configAutoSet, setConfigAutoSet] = useState(false)
  const [setupError, setSetupError] = useState<string | null>(null)
  const [dupRefs, setDupRefs] = useState<Set<string>>(new Set())
  const [dupLoading, setDupLoading] = useState(false)
  const [showPreview, setShowPreview] = useState(false)
  const [result, setResult] = useState<WizardResult | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // ---- derived ----
  const nonFxBanks = banks.filter(b => !b.is_foreign_currency)
  const selectedBank = nonFxBanks.find(b => b.id === bankId) ?? null
  const lockedConfigs = configs.filter(c => c.status === 'locked' && !c.is_special)
  const inflows = wizardRows.filter(r => r.credit > 0)
  const outflows = wizardRows.filter(r => r.debit > 0)
  const totalCredit = inflows.reduce((s, r) => s + r.credit, 0)
  const totalDebit = outflows.reduce((s, r) => s + r.debit, 0)
  const today = new Date().toISOString().slice(0, 10)

  const dateRange = useMemo(() => {
    if (wizardRows.length === 0) return { from: '', to: '' }
    const dates = wizardRows.map(r => r.date).filter(Boolean).sort()
    return { from: dates[0] ?? '', to: dates[dates.length - 1] ?? '' }
  }, [wizardRows])

  const skipCount = dupRefs.size
  const importableCount = wizardRows.length - skipCount

  // ---- reset on open ----
  useEffect(() => {
    if (!open) return
    setStep('upload')
    setDragging(false)
    setParsing(false)
    setParseError(null)
    setFileName('')
    setDateFormat('dmy')
    setRawDataRows([])
    setRawCols(null)
    setWizardRows([])
    setHasRefCol(false)
    setBankId('')
    setIncomeTypeId('')
    setConfigId('')
    setConfigAutoSet(false)
    setSetupError(null)
    setDupRefs(new Set())
    setDupLoading(false)
    setShowPreview(false)
    setResult(null)
  }, [open])

  // ---- re-parse rows when date format changes ----
  useEffect(() => {
    if (!rawCols || rawDataRows.length === 0) return
    const { rows, hasRef } = buildRows(rawDataRows, rawCols, dateFormat)
    setWizardRows(rows)
    setHasRefCol(hasRef)
  }, [dateFormat, rawDataRows, rawCols])

  // ---- fetch configs on open ----
  useEffect(() => {
    if (open && !loaded) fetchConfigs()
  }, [open, loaded, fetchConfigs])

  // ---- auto-set config when income type changes ----
  useEffect(() => {
    if (!incomeTypeId) {
      setConfigAutoSet(false)
      return
    }
    const it = incomeTypes.find(t => t.id === incomeTypeId)
    if (!it) return
    if (it.special_config_id) {
      setConfigId(it.special_config_id)
      setConfigAutoSet(true)
    } else if (it.special_config_group_id) {
      const v = getSpecialConfigVersionForDate(configs, it.special_config_group_id, today)
      if (v) {
        setConfigId(v.id)
        setConfigAutoSet(true)
      } else {
        setConfigAutoSet(false)
      }
    } else {
      setConfigAutoSet(false)
    }
  }, [incomeTypeId, incomeTypes, configs, today])

  // ---- resetWizard (imperative) ----
  function resetWizard() {
    setStep('upload')
    setDragging(false)
    setParsing(false)
    setParseError(null)
    setFileName('')
    setDateFormat('dmy')
    setRawDataRows([])
    setRawCols(null)
    setWizardRows([])
    setHasRefCol(false)
    setBankId('')
    setIncomeTypeId('')
    setConfigId('')
    setConfigAutoSet(false)
    setSetupError(null)
    setDupRefs(new Set())
    setDupLoading(false)
    setShowPreview(false)
    setResult(null)
  }

  // ---- parseFile ----
  async function parseFile(file: File) {
    const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
    if (ext !== 'xlsx' && ext !== 'xls') {
      setParseError(
        'Please upload an Excel file (.xlsx or .xls). For PDF files, use the Standard Import instead.',
      )
      return
    }

    setParsing(true)
    setParseError(null)

    try {
      const buffer = await file.arrayBuffer()
      const wb = XLSX.read(buffer, { type: 'array', cellDates: true })
      const sheetName = wb.SheetNames[0]
      const ws = wb.Sheets[sheetName]
      const allRows = XLSX.utils.sheet_to_json<unknown[]>(ws, {
        header: 1,
        defval: '',
      })

      const headerRowIdx = detectHeaderRow(allRows as unknown[][])
      const headerRow = allRows[headerRowIdx] as unknown[]
      const headers = headerRow.map(h => String(h ?? ''))

      const cols = detectColumns(headers)

      if (cols.dateIdx === -1) {
        setParseError(
          'Could not find a date column in this file. Please check that your file has a column labelled "Date", "Transaction Date", or similar.',
        )
        return
      }

      if (cols.creditIdx === -1 && cols.debitIdx === -1 && cols.amountIdx === -1) {
        setParseError(
          'Could not find amount columns in this file. Please check that your file has columns for credit/debit amounts or a column labelled "Amount".',
        )
        return
      }

      const dataRows = allRows.slice(headerRowIdx + 1) as unknown[][]
      const { rows: parsed, hasRef: rowHasRef } = buildRows(dataRows, cols, dateFormat)

      if (parsed.length === 0) {
        setParseError(
          'No valid transactions were found in this file. Please check that the file contains rows with dates and amounts.',
        )
        return
      }

      setFileName(file.name)
      setRawDataRows(dataRows)
      setRawCols(cols)
      setWizardRows(parsed)
      setHasRefCol(rowHasRef)
      setStep('setup')
    } catch (err) {
      setParseError(
        `Failed to read the file: ${err instanceof Error ? err.message : 'Unknown error'}`,
      )
    } finally {
      setParsing(false)
    }
  }

  // ---- proceedToReview ----
  async function proceedToReview() {
    setSetupError(null)
    if (!bankId) {
      setSetupError('Please select a bank account before continuing.')
      return
    }
    if (!incomeTypeId) {
      setSetupError('Please select an income category (or choose Auto-detect) before continuing.')
      return
    }

    setStep('review')
    setDupRefs(new Set())

    // Background dedup check
    const refs = wizardRows.map(r => r.ref).filter(Boolean)
    if (selectedBank && refs.length > 0) {
      setDupLoading(true)
      try {
        const { data: existingInflows } = await supabase
          .from('inflow_transactions')
          .select('transaction_ref')
          .eq('bank_name', selectedBank.name)
          .in('transaction_ref', refs)

        const { data: existingOutflows } = await supabase
          .from('outflow_transactions')
          .select('transaction_id')
          .eq('bank_name', selectedBank.name)
          .in('transaction_id', refs)

        const found = new Set<string>()
        for (const row of existingInflows ?? []) {
          if (row.transaction_ref) found.add(row.transaction_ref)
        }
        for (const row of existingOutflows ?? []) {
          if (row.transaction_id) found.add(row.transaction_id)
        }
        setDupRefs(found)
      } catch {
        // Non-fatal — just proceed without dedup
      } finally {
        setDupLoading(false)
      }
    }
  }

  // ---- runImport ----
  async function runImport() {
    setStep('importing')

    const user = useAuthStore.getState().user
    if (!user?.id) {
      toast.error('You must be signed in to import transactions.')
      setStep('review')
      return
    }

    const currentOrgId = useOrgStore.getState().orgId
    if (!currentOrgId) {
      toast.error('No organisation selected.')
      setStep('review')
      return
    }

    const importTimestamp = new Date().toISOString()
    const resolvedConfigId =
      configId || getConfigForDate(lockedConfigs, today)?.id || null
    const bankName = selectedBank?.name ?? ''

    const errors: string[] = []
    let imported = 0

    // ---- Build inflow payloads ----
    const inflowPayloads: Record<string, unknown>[] = []
    const inflowRefMap = new Map<string, number>()

    for (const row of wizardRows) {
      if (row.credit <= 0) continue
      if (row.ref && dupRefs.has(row.ref)) continue

      let baseRef =
        row.ref ||
        (await generateFallbackTransactionId(
          row.date,
          String(row.credit),
          row.description,
          bankName,
        ))

      // Collision suffix
      const count = inflowRefMap.get(baseRef) ?? 0
      inflowRefMap.set(baseRef, count + 1)
      const transactionRef = count === 0 ? baseRef : `${baseRef}-${count}`

      const rowIncomeTypeId = incomeTypeId === '__auto__'
        ? (classifyIncomeType(row.description, '', incomeTypes)?.id ?? null)
        : (incomeTypeId || null)

      inflowPayloads.push({
        date: row.date,
        amount: row.credit,
        description: row.description,
        bank_name: bankName,
        transaction_ref: transactionRef,
        ...(rowIncomeTypeId ? { income_type_id: rowIncomeTypeId } : {}),
        ...(resolvedConfigId ? { allocation_config_id: resolvedConfigId } : {}),
        org_id: currentOrgId,
        created_by: user.id,
        recorded_at: importTimestamp,
      })
    }

    // ---- Build outflow payloads ----
    const outflowPayloads: Record<string, unknown>[] = []
    const outflowRefMap = new Map<string, number>()

    for (const row of wizardRows) {
      if (row.debit <= 0) continue
      if (row.ref && dupRefs.has(row.ref)) continue

      let baseId =
        row.ref ||
        (await generateFallbackTransactionId(
          row.date,
          String(row.debit),
          row.description,
          bankName,
        ))

      const count = outflowRefMap.get(baseId) ?? 0
      outflowRefMap.set(baseId, count + 1)
      const transactionId = count === 0 ? baseId : `${baseId}-${count}`

      outflowPayloads.push({
        date: row.date,
        amount_disbursed: row.debit,
        description: row.description,
        bank_name: bankName,
        transaction_id: transactionId,
        org_id: currentOrgId,
        created_by: user.id,
        recorded_at: importTimestamp,
      })
    }

    // ---- Insert inflows ----
    if (inflowPayloads.length > 0) {
      const { error } = await supabase
        .from('inflow_transactions')
        .insert(inflowPayloads)
      if (error) {
        errors.push(`Income transactions: ${error.message}`)
      } else {
        imported += inflowPayloads.length
      }
    }

    // ---- Insert outflows ----
    if (outflowPayloads.length > 0) {
      const { error } = await supabase
        .from('outflow_transactions')
        .insert(outflowPayloads)
      if (error) {
        errors.push(`Payment transactions: ${error.message}`)
      } else {
        imported += outflowPayloads.length
      }
    }

    setResult({ imported, skipped: dupRefs.size, errors })
    setStep('done')
  }

  // ---- Format helpers ----
  function fmtAmount(n: number): string {
    return formatAmount(n)
  }

  function fmtDate(iso: string): string {
    if (!iso) return '—'
    try {
      return new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      })
    } catch {
      return iso
    }
  }

  // ---- Drop zone handlers ----
  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) parseFile(file)
  }

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) parseFile(file)
    e.target.value = ''
  }

  // ---------------------------------------------------------------------------
  // Render step: upload
  // ---------------------------------------------------------------------------
  function renderUpload() {
    return (
      <div className="flex flex-col gap-4">
        {/* Drop zone */}
        <div
          role="button"
          tabIndex={0}
          onClick={() => !parsing && fileInputRef.current?.click()}
          onKeyDown={e => {
            if ((e.key === 'Enter' || e.key === ' ') && !parsing)
              fileInputRef.current?.click()
          }}
          onDragOver={e => {
            e.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          className={[
            'relative flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-10 text-center cursor-pointer transition-colors select-none',
            dragging
              ? 'border-primary bg-primary/5 dark:bg-primary/10'
              : 'border-gray-300 dark:border-gray-600 hover:border-primary/60 hover:bg-gray-50 dark:hover:bg-gray-800/50',
            parsing ? 'pointer-events-none opacity-60' : '',
          ].join(' ')}
        >
          {parsing ? (
            <>
              <Loader2 className="w-10 h-10 text-primary animate-spin" />
              <p className="text-sm font-medium text-gray-600 dark:text-gray-300">
                Reading file…
              </p>
            </>
          ) : (
            <>
              <FileSpreadsheet
                className={[
                  'w-12 h-12 transition-colors',
                  dragging
                    ? 'text-primary'
                    : 'text-gray-400 dark:text-gray-500',
                ].join(' ')}
              />
              <div>
                <p className="text-sm font-semibold text-gray-700 dark:text-gray-200">
                  Drop your Excel file here, or click to browse
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  Accepts .xlsx and .xls · PDF files require Standard Import
                </p>
              </div>
            </>
          )}
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.xls"
          className="hidden"
          onChange={handleFileInput}
        />

        {/* Parse error */}
        {parseError && (
          <div className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-700/50 dark:bg-amber-900/20 p-3">
            <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            <p className="text-sm text-amber-800 dark:text-amber-300">
              {parseError}
            </p>
          </div>
        )}
      </div>
    )
  }

  // ---------------------------------------------------------------------------
  // Render step: setup
  // ---------------------------------------------------------------------------
  function renderSetup() {
    const selectedConfig = lockedConfigs.find(c => c.id === configId) ?? null

    return (
      <div className="flex flex-col gap-5">
        {/* Date format */}
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-gray-700 dark:text-gray-200">
            Date Arrangement
          </label>
          <p className="text-xs text-gray-500 dark:text-gray-400 -mt-1">
            How are dates written in your file? Changing this will update all parsed dates.
          </p>
          <div className="flex gap-2">
            {([
              { value: 'dmy', label: 'DD/MM/YYYY', example: 'e.g. 25/12/2024' },
              { value: 'mdy', label: 'MM/DD/YYYY', example: 'e.g. 12/25/2024' },
            ] as const).map(opt => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setDateFormat(opt.value)}
                className={`flex-1 flex flex-col items-center gap-0.5 py-2 px-3 rounded-lg border text-sm transition-colors ${
                  dateFormat === opt.value
                    ? 'border-primary bg-primary/10 text-primary font-semibold'
                    : 'border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'
                }`}
              >
                <span>{opt.label}</span>
                <span className="text-xs font-normal text-gray-400 dark:text-gray-500">{opt.example}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Bank */}
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-gray-700 dark:text-gray-200">
            Which bank account is this for?
          </label>
          {nonFxBanks.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">
              No bank accounts found.{' '}
              <a
                href="/setup/banks"
                className="text-primary underline hover:no-underline"
              >
                Add a bank in Setup
              </a>{' '}
              before importing.
            </p>
          ) : (
            <select
              value={bankId}
              onChange={e => setBankId(e.target.value)}
              className="block w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary/50"
            >
              <option value="">— Select bank account —</option>
              {nonFxBanks.map(b => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          )}
        </div>

        {/* Income category */}
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-gray-700 dark:text-gray-200">
            Income Category
          </label>
          <p className="text-xs text-gray-500 dark:text-gray-400 -mt-1">
            Pick one category for all rows, or let the app detect each row automatically from its description.
          </p>
          <select
            value={incomeTypeId}
            onChange={e => {
              setIncomeTypeId(e.target.value)
              if (!e.target.value || e.target.value === '__auto__') {
                setConfigId('')
                setConfigAutoSet(false)
              }
            }}
            className="block w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary/50"
          >
            <option value="">— Select income category —</option>
            <option value="__auto__">Auto-detect from description (mixed)</option>
            {incomeTypes.map(t => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          {incomeTypeId === '__auto__' && (
            <p className="text-xs text-primary/80 dark:text-primary/70">
              Each row will be matched to a category based on its description text using your keyword rules.
              Rows with no match will be imported without a category.
            </p>
          )}
        </div>

        {/* Budget plan — hidden in auto-detect mode */}
        {incomeTypeId !== '__auto__' && <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-gray-700 dark:text-gray-200">
            Budget Plan{' '}
            <span className="font-normal text-gray-400">(optional)</span>
          </label>
          <p className="text-xs text-gray-500 dark:text-gray-400 -mt-1">
            Which budget plan should be applied to income?
          </p>
          <select
            value={configId}
            onChange={e => {
              setConfigId(e.target.value)
              setConfigAutoSet(false)
            }}
            className="block w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary/50"
          >
            <option value="">— No budget plan —</option>
            {lockedConfigs.map(c => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          {configAutoSet && selectedConfig && (
            <p className="text-xs text-primary/80 dark:text-primary/70">
              (auto-set from your income category)
            </p>
          )}
        </div>}

        {/* Error */}
        {setupError && (
          <div className="flex gap-2 rounded-lg border border-red-200 bg-red-50 dark:border-red-700/50 dark:bg-red-900/20 p-3">
            <AlertTriangle className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
            <p className="text-sm text-red-700 dark:text-red-300">{setupError}</p>
          </div>
        )}

        {/* Buttons */}
        <div className="flex justify-between pt-1">
          <button
            type="button"
            onClick={() => setStep('upload')}
            className="px-4 py-2 text-sm font-medium rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
          >
            Back
          </button>
          <button
            type="button"
            onClick={proceedToReview}
            className="px-5 py-2 text-sm font-medium rounded-lg bg-primary text-white hover:bg-primary/90 transition-colors"
          >
            Continue
          </button>
        </div>
      </div>
    )
  }

  // ---------------------------------------------------------------------------
  // Render step: review
  // ---------------------------------------------------------------------------
  function renderReview() {
    const selectedIncomeType = incomeTypeId !== '__auto__'
      ? (incomeTypes.find(t => t.id === incomeTypeId) ?? null)
      : null
    const selectedConfig = lockedConfigs.find(c => c.id === configId) ?? null
    const previewRows = wizardRows.slice(0, 5)

    return (
      <div className="flex flex-col gap-4">
        <h3 className="text-base font-semibold text-gray-800 dark:text-gray-100">
          Ready to import
        </h3>

        {/* Summary grid */}
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
          <dl className="divide-y divide-gray-100 dark:divide-gray-700">
            {(
              [
                ['File', fileName],
                ['Bank', selectedBank?.name ?? '—'],
                [
                  'Income category',
                  incomeTypeId === '__auto__' ? 'Auto-detect (mixed)' : (selectedIncomeType?.name ?? '—'),
                ],
                ...(incomeTypeId !== '__auto__' ? [['Budget plan', selectedConfig?.name ?? 'None']] : []),
              ] as [string, string][]
            ).map(([label, value]) => (
              <div
                key={label}
                className="flex gap-3 px-4 py-2.5 text-sm"
              >
                <dt className="w-36 shrink-0 text-gray-500 dark:text-gray-400">
                  {label}
                </dt>
                <dd className="font-medium text-gray-800 dark:text-gray-100 break-all">
                  {value}
                </dd>
              </div>
            ))}
          </dl>
        </div>

        {/* Stats */}
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
          <dl className="divide-y divide-gray-100 dark:divide-gray-700">
            {inflows.length > 0 && (
              <div className="flex gap-3 px-4 py-2.5 text-sm">
                <dt className="w-36 shrink-0 text-gray-500 dark:text-gray-400">
                  Money received
                </dt>
                <dd className="font-medium text-gray-800 dark:text-gray-100">
                  {inflows.length} transaction{inflows.length !== 1 ? 's' : ''}{' '}
                  · {fmtAmount(totalCredit)}
                </dd>
              </div>
            )}
            {outflows.length > 0 && (
              <div className="flex gap-3 px-4 py-2.5 text-sm">
                <dt className="w-36 shrink-0 text-gray-500 dark:text-gray-400">
                  Payments
                </dt>
                <dd className="font-medium text-gray-800 dark:text-gray-100">
                  {outflows.length} transaction{outflows.length !== 1 ? 's' : ''}{' '}
                  · {fmtAmount(totalDebit)}
                </dd>
              </div>
            )}
            {dateRange.from && (
              <div className="flex gap-3 px-4 py-2.5 text-sm">
                <dt className="w-36 shrink-0 text-gray-500 dark:text-gray-400">
                  Date range
                </dt>
                <dd className="font-medium text-gray-800 dark:text-gray-100">
                  {fmtDate(dateRange.from)}
                  {dateRange.from !== dateRange.to
                    ? ` — ${fmtDate(dateRange.to)}`
                    : ''}
                </dd>
              </div>
            )}
          </dl>
        </div>

        {/* Dedup status */}
        {dupLoading && (
          <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
            <Loader2 className="w-4 h-4 animate-spin" />
            Checking for existing records…
          </div>
        )}
        {!dupLoading && dupRefs.size > 0 && (
          <div className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-700/50 dark:bg-amber-900/20 p-3">
            <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            <p className="text-sm text-amber-800 dark:text-amber-300">
              {dupRefs.size} transaction{dupRefs.size !== 1 ? 's' : ''} already
              in the system — will be skipped
            </p>
          </div>
        )}
        {!hasRefCol && (
          <div className="flex gap-2 rounded-lg border border-blue-200 bg-blue-50 dark:border-blue-700/50 dark:bg-blue-900/20 p-3">
            <svg
              className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <p className="text-sm text-blue-800 dark:text-blue-300">
              No reference column detected — deduplication may not catch
              re-imports of the same file
            </p>
          </div>
        )}

        {/* Outflow note */}
        {outflows.length > 0 && (
          <div className="flex gap-2 rounded-lg border border-blue-200 bg-blue-50 dark:border-blue-700/50 dark:bg-blue-900/20 p-3">
            <svg
              className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <p className="text-sm text-blue-800 dark:text-blue-300">
              Payments (money going out) will be recorded without a category
              assignment. You can assign them later.
            </p>
          </div>
        )}

        {/* Collapsible preview */}
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
          <button
            type="button"
            onClick={() => setShowPreview(v => !v)}
            className="w-full flex items-center justify-between px-4 py-2.5 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
          >
            <span>Show first 5 rows</span>
            {showPreview ? (
              <ChevronDown className="w-4 h-4" />
            ) : (
              <ChevronRight className="w-4 h-4" />
            )}
          </button>
          {showPreview && (
            <div className="overflow-x-auto border-t border-gray-100 dark:border-gray-700">
              <table className="w-full text-xs">
                <thead className="bg-gray-50 dark:bg-gray-800">
                  <tr>
                    {['Date', 'Description', 'Credit', 'Debit'].map(h => (
                      <th
                        key={h}
                        className="px-3 py-2 text-left font-medium text-gray-500 dark:text-gray-400"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                  {previewRows.map(row => (
                    <tr key={row.idx} className="bg-white dark:bg-gray-900">
                      <td className="px-3 py-2 text-gray-700 dark:text-gray-300 whitespace-nowrap">
                        {fmtDate(row.date)}
                      </td>
                      <td className="px-3 py-2 text-gray-700 dark:text-gray-300 max-w-[14rem] truncate">
                        {row.description || '—'}
                      </td>
                      <td className="px-3 py-2 text-gray-700 dark:text-gray-300 whitespace-nowrap">
                        {row.credit > 0 ? fmtAmount(row.credit) : '—'}
                      </td>
                      <td className="px-3 py-2 text-gray-700 dark:text-gray-300 whitespace-nowrap">
                        {row.debit > 0 ? fmtAmount(row.debit) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Buttons */}
        <div className="flex justify-between pt-1">
          <button
            type="button"
            onClick={() => setStep('setup')}
            className="px-4 py-2 text-sm font-medium rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
          >
            Back
          </button>
          <button
            type="button"
            onClick={runImport}
            disabled={dupLoading}
            className="px-5 py-2 text-sm font-medium rounded-lg bg-primary text-white hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            Import {importableCount} transaction
            {importableCount !== 1 ? 's' : ''} →
          </button>
        </div>
      </div>
    )
  }

  // ---------------------------------------------------------------------------
  // Render step: importing
  // ---------------------------------------------------------------------------
  function renderImporting() {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-10 text-center">
        <Loader2 className="w-10 h-10 text-primary animate-spin" />
        <p className="text-base font-semibold text-gray-800 dark:text-gray-100">
          Importing your transactions…
        </p>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Please don't close this window.
        </p>
      </div>
    )
  }

  // ---------------------------------------------------------------------------
  // Render step: done
  // ---------------------------------------------------------------------------
  function renderDone() {
    if (!result) return null

    const inflowImported = inflows.length - Math.min(dupRefs.size, inflows.length)
    const outflowImported = outflows.length - Math.max(0, dupRefs.size - inflows.length)
    const hasErrors = result.errors.length > 0

    return (
      <div className="flex flex-col items-center gap-4 py-4 text-center">
        {hasErrors ? (
          <AlertTriangle className="w-12 h-12 text-amber-500" />
        ) : (
          <CheckCircle2 className="w-12 h-12 text-green-500" />
        )}

        <div>
          <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-100">
            {hasErrors ? 'Import finished with issues' : 'Import complete!'}
          </h3>
          {!hasErrors && (
            <>
              <p className="text-base font-bold text-gray-900 dark:text-gray-50 mt-1">
                {result.imported} transaction
                {result.imported !== 1 ? 's' : ''} imported
              </p>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
                {inflowImported > 0
                  ? `${inflowImported} income transaction${inflowImported !== 1 ? 's' : ''}`
                  : ''}
                {inflowImported > 0 && outflowImported > 0 ? ' · ' : ''}
                {outflowImported > 0
                  ? `${outflowImported} payment${outflowImported !== 1 ? 's' : ''}`
                  : ''}
              </p>
              {result.skipped > 0 && (
                <p className="text-sm text-gray-400 dark:text-gray-500 mt-0.5">
                  {result.skipped} already in system (skipped)
                </p>
              )}
            </>
          )}
        </div>

        {hasErrors && (
          <div className="w-full flex flex-col gap-2 text-left">
            {result.errors.map((err, i) => (
              <div
                key={i}
                className="rounded-lg border border-red-200 bg-red-50 dark:border-red-700/50 dark:bg-red-900/20 px-3 py-2 text-sm text-red-700 dark:text-red-300"
              >
                {err}
              </div>
            ))}
          </div>
        )}

        <div className="flex gap-3 mt-2">
          <button
            type="button"
            onClick={resetWizard}
            className="px-4 py-2 text-sm font-medium rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
          >
            Import Another
          </button>
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 text-sm font-medium rounded-lg bg-primary text-white hover:bg-primary/90 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    )
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  const isDirty = step !== 'upload' && step !== 'done'
  const disableClose = step === 'importing'

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Import Wizard"
      isDirty={isDirty}
      disableClose={disableClose}
      disableBackdropClose
      size="max-w-2xl"
    >
      <div className="px-1">
        <StepIndicator current={step} />

        {step === 'upload' && renderUpload()}
        {step === 'setup' && renderSetup()}
        {step === 'review' && renderReview()}
        {step === 'importing' && renderImporting()}
        {step === 'done' && renderDone()}
      </div>
    </Modal>
  )
}
