import { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import * as XLSX from 'xlsx'
import {
  Upload, PenLine, FileSpreadsheet, FileText,
  CheckCircle2, AlertTriangle, Loader2, X,
  TrendingUp, TrendingDown, Sparkles,
} from 'lucide-react'
import { Link, Navigate } from 'react-router-dom'
import { HelpButton }       from '../components/onboarding/HelpButton'
import { useFirstVisitTour } from '../hooks/useFirstVisitTour'
import { usePageTitle } from '../hooks/usePageTitle'
import { useRole } from '../hooks/useRole'
import { ImportModal, detectHeaderRow } from '../components/modals/ImportModal'
import { Modal } from '../components/ui/Modal'
import { supabase } from '../lib/supabase'
import { useCategories } from '../hooks/useCategories'
import { useAddInflow, useAddOutflow, AddInflowInput, AddOutflowInput } from '../hooks/useMutations'
import { useToastStore } from '../store/toastStore'
import { useBanks } from '../hooks/useBanks'
import { useAllocationStore, getConfigForDate, getSpecialConfigVersionForDate } from '../store/allocationStore'
import { getFinalConfig, type RowResolverState } from '../utils/configResolver'
import { formatDate } from '../utils/formatters'
import { formatCurrency } from '../utils/currency'
import { generateFallbackTransactionId } from '../utils/generateTransactionId'
// inflowTypes import removed — income type classification replaces hardcoded types
import { useIncomeTypes } from '../hooks/useIncomeTypes'
import { classifyIncomeType } from '../utils/classifyIncomeType'
import { normalizeId } from '../utils/normalizeId'
import { useOutflowTypeOptions, useCategoryOutflowTypeMaps, getDefaultOutflowTypeForCategory } from '../hooks/useOutflowTypes'
import { useOrgCurrency } from '../hooks/useOrgCurrency'
import { SearchableSelect } from '../components/ui/SearchableSelect'
import { RootTransactionSearch, type RootTxnLink } from '../components/ui/RootTransactionSearch'
import { isOffsetableType } from '../utils/transactionTypes'

// ── Types ──────────────────────────────────────────────────────────────────────

type Tab = 'file' | 'manual'

interface DupRecord {
  id: string
  table: 'inflow_transactions' | 'outflow_transactions'
}

interface ParseResult {
  fileName: string
  rowCount: number
  txnIdCol: string | null   // which column header was used
  ids: string[]             // all non-blank transaction IDs found
}

const TXN_TYPE_OPTIONS = [
  { value: '',                    label: 'Normal' },
  { value: 'refund',              label: 'Refund' },
  { value: 'reversal',            label: 'Reversal' },
  { value: 'bank_deposit',        label: 'Bank Deposit' },
  { value: 'intrabank_transfer',  label: 'Intrabank Transfer' },
]

// ── Helpers ────────────────────────────────────────────────────────────────────

const TXN_ID_ALIASES = [
  'transactionid', 'transaction_id', 'txnid', 'txn_id',
  'transactionref', 'transaction_ref', 'txnref', 'txn_ref',
  'reference', 'ref',
]

function findTxnIdColumn(headers: string[]): { header: string; index: number } | null {
  for (let i = 0; i < headers.length; i++) {
    const normalized = headers[i].toLowerCase().replace(/[\s\-().]+/g, '')
    if (TXN_ID_ALIASES.includes(normalized)) return { header: headers[i], index: i }
  }
  return null
}

const TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
  { id: 'file',   label: 'File Import',  icon: Upload  },
  { id: 'manual', label: 'Manual Entry', icon: PenLine },
]

// ── Page ───────────────────────────────────────────────────────────────────────

export default function Import() {
  const { canImportTransactions } = useRole()
  const [activeTab, setActiveTab]     = useState<Tab>('file')
  const [importOpen, setImportOpen]   = useState(false)
  const [skipDups, setSkipDups]       = useState(false)
  const [dragging, setDragging]       = useState(false)
  const [parseResult, setParseResult] = useState<ParseResult | null>(null)
  const [dupLoading, setDupLoading]   = useState(false)
  const [duplicates, setDuplicates]   = useState<DupRecord[]>([])
  const [dupChecked, setDupChecked]   = useState(false)
  const [parseError, setParseError]   = useState<string | null>(null)
  const [selectedBankId, setSelectedBankId] = useState('')
  const [selectedFile, setSelectedFile] = useState<File | null>(null)

  const { banks } = useBanks()
  const fileInputRef = useRef<HTMLInputElement>(null)
  usePageTitle('Import')
  useFirstVisitTour('import')

  // Bank name derived from the selected bank ID — used for scoped dup checks.
  const selectedBankName = useMemo(
    () => banks.find(b => b.id === selectedBankId)?.name ?? null,
    [selectedBankId, banks],
  )

  const reset = () => {
    setParseResult(null)
    setDuplicates([])
    setDupChecked(false)
    setParseError(null)
    setDupLoading(false)
    setSkipDups(false)
    // NOTE: intentionally do NOT clear selectedBankId — bank persists across file changes
    setSelectedFile(null)
  }

  const openWizard = (skip: boolean) => {
    setSkipDups(skip)
    setImportOpen(true)
  }

  const parseAndCheck = useCallback(async (file: File) => {
    if (!file.name.match(/\.(xlsx|xls|pdf)$/i)) {
      setParseError('Only .xlsx, .xls, and .pdf files are supported.')
      return
    }

    reset()
    setSelectedFile(file)
    setParseError(null)

    // PDF: skip duplicate ID check — can't easily extract txn IDs from PDF text
    if (file.name.match(/\.pdf$/i)) {
      setParseResult({ fileName: file.name, rowCount: 0, txnIdCol: null, ids: [] })
      setDupChecked(true)
      return
    }

    // 1. Parse the Excel file — DB dup check runs in the effect below
    let ids: string[] = []
    let txnIdCol: string | null = null
    let rowCount = 0

    try {
      const buffer = await file.arrayBuffer()
      const wb     = XLSX.read(buffer, { type: 'array' })
      const ws     = wb.Sheets[wb.SheetNames[0]]
      const rows   = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) as unknown[][]
      const headerIdx = detectHeaderRow(rows)
      const headers = (rows[headerIdx] ?? []).map(h => String(h ?? '').trim())
      const dataRows = rows.slice(headerIdx + 1).filter(r => (r as unknown[]).some(c => c !== '' && c != null))
      rowCount = dataRows.length

      const col = findTxnIdColumn(headers)
      if (col) {
        txnIdCol = col.header
        ids = dataRows
          .map(r => normalizeId(String((r as unknown[])[col.index] ?? '')))
          .filter(id => id.length > 0)
      }

      setParseResult({ fileName: file.name, rowCount, txnIdCol, ids })
    } catch {
      setParseError('Could not read the file. Make sure it is a valid Excel file.')
      return
    }

    // No txn ID column — nothing to check
    if (ids.length === 0) {
      setDupChecked(true)
    }
    // Otherwise the useEffect below triggers the DB check
  }, [])

  // Re-run the DB duplicate check whenever the parsed IDs or the selected bank
  // changes.  Scoped to bank_name so transactions in different banks with the
  // same ID are not treated as duplicates.
  useEffect(() => {
    if (!parseResult?.ids?.length) return
    let isCurrent = true

    const runCheck = async () => {
      setDupLoading(true)
      setDupChecked(false)
      const uniqueIds = [...new Set(parseResult.ids)]

      const [inflowRes, outflowRes] = await Promise.all([
        selectedBankName
          ? supabase.from('inflow_transactions').select('transaction_ref').eq('bank_name', selectedBankName).in('transaction_ref', uniqueIds)
          : supabase.from('inflow_transactions').select('transaction_ref').in('transaction_ref', uniqueIds),
        selectedBankName
          ? supabase.from('outflow_transactions').select('transaction_id').eq('bank_name', selectedBankName).in('transaction_id', uniqueIds)
          : supabase.from('outflow_transactions').select('transaction_id').in('transaction_id', uniqueIds),
      ])

      if (!isCurrent) return

      const found: DupRecord[] = []
      if (!inflowRes.error && inflowRes.data) {
        for (const r of inflowRes.data) {
          if (r.transaction_ref) found.push({ id: normalizeId(r.transaction_ref), table: 'inflow_transactions' })
        }
      }
      if (!outflowRes.error && outflowRes.data) {
        for (const r of outflowRes.data) {
          if (r.transaction_id) found.push({ id: normalizeId(r.transaction_id), table: 'outflow_transactions' })
        }
      }

      setDuplicates(found)
      setDupChecked(true)
      setDupLoading(false)
    }

    runCheck()
    return () => { isCurrent = false }
  }, [parseResult, selectedBankName])

  // Defense-in-depth: route guard in App.tsx is primary, this is a fallback
  if (!canImportTransactions()) return <Navigate to="/" replace />

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) parseAndCheck(file)
  }

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) parseAndCheck(file)
    e.target.value = ''
  }

  return (
    <div className="space-y-5">

      {/* Header */}
      <div data-tour="page-header" className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Import Transactions</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Upload a bank statement or enter transactions manually
          </p>
        </div>
        <HelpButton tourId="importTour" size="sm" className="self-start" />
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 border-b border-gray-200">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            className={`flex items-center gap-2 px-5 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
              activeTab === id
                ? 'border-primary text-primary'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            <Icon className="w-4 h-4" />
            {label}
          </button>
        ))}
      </div>

      {/* ── File Import tab ──────────────────────────────────────────────── */}
      {activeTab === 'file' && (
        <div className="space-y-4">

          {/* Step indicator */}
          <div className="flex items-center gap-2 text-xs">
            {[
              { n: 1, label: 'Choose file',      active: !parseResult,                       done: !!parseResult },
              { n: 2, label: 'Review & confirm', active: !!parseResult && !importOpen,       done: importOpen },
              { n: 3, label: 'Map & import',     active: importOpen,                         done: false },
            ].map(({ n, label, active, done }, i) => (
              <div key={n} className="flex items-center gap-2">
                {i > 0 && <div className={`w-6 h-px ${done || active ? 'bg-primary/40' : 'bg-gray-200'}`} />}
                <div className={`flex items-center gap-1.5 ${active ? 'text-primary font-semibold' : done ? 'text-primary/60' : 'text-gray-400'}`}>
                  <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold border ${
                    active ? 'bg-primary text-white border-primary' :
                    done   ? 'bg-primary/10 text-primary border-primary/30' :
                             'bg-white text-gray-400 border-gray-200'
                  }`}>
                    {done ? '✓' : n}
                  </span>
                  <span className="hidden sm:inline">{label}</span>
                </div>
              </div>
            ))}
          </div>

          {/* Drop zone */}
          {!parseResult ? (
            <div
              data-tour="upload-zone"
              onDragOver={e => { e.preventDefault(); setDragging(true) }}
              onDragLeave={() => setDragging(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`cursor-pointer border-2 border-dashed rounded-xl p-14 flex flex-col items-center gap-4 transition-colors ${
                dragging
                  ? 'border-primary bg-primary/5'
                  : 'border-gray-300 bg-gray-50 hover:border-primary hover:bg-primary/5'
              }`}
            >
              <div className={`p-5 rounded-full transition-colors ${dragging ? 'bg-primary/10' : 'bg-white shadow-sm'}`}>
                <FileSpreadsheet className={`w-8 h-8 ${dragging ? 'text-primary' : 'text-gray-400'}`} />
              </div>
              <div className="text-center">
                <p className="text-sm font-semibold text-gray-700">
                  Drop your file here, or{' '}
                  <span className="text-primary underline underline-offset-2">click to browse</span>
                </p>
                <p className="text-xs text-gray-400 mt-1">Accepts .xlsx, .xls, and .pdf</p>
              </div>
            </div>
          ) : (
            /* ── Parsed file card ──────────────────────────────────────── */
            <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
              {/* File info bar */}
              <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-100 bg-gray-50">
                <div className="flex items-center gap-2.5 min-w-0">
                  {parseResult.fileName.match(/\.pdf$/i)
                    ? <FileText className="w-4 h-4 text-red-500 shrink-0" />
                    : <FileSpreadsheet className="w-4 h-4 text-primary shrink-0" />
                  }
                  <span className="text-sm font-medium text-gray-700 truncate">{parseResult.fileName}</span>
                  {parseResult.rowCount > 0 && (
                    <span className="text-xs text-gray-400 shrink-0">· {parseResult.rowCount.toLocaleString()} rows</span>
                  )}
                </div>
                <button
                  onClick={reset}
                  className="p-1 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-200 transition-colors shrink-0"
                  title="Remove file"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Duplicate detection results */}
              <div data-tour="duplicate-check" className="px-5 py-4 space-y-3">
                {/* PDF — no dup check */}
                {dupChecked && parseResult.fileName.match(/\.pdf$/i) && (
                  <div className="flex items-start gap-3 rounded-lg bg-blue-50 border border-blue-200 px-4 py-3 text-sm text-blue-700">
                    <FileText className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>
                      PDF detected — duplicate checking is skipped for PDFs. The import wizard will parse and map the columns for you.
                    </span>
                  </div>
                )}

                {/* No txn ID column */}
                {dupChecked && !parseResult.txnIdCol && !parseResult.fileName.match(/\.pdf$/i) && (
                  <div className="flex items-start gap-3 rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-700">
                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>
                      No transaction ID column detected in this file.
                      Duplicate checking requires a column named <strong>Transaction ID</strong>, <strong>Txn ID</strong>, or <strong>Reference</strong>.
                    </span>
                  </div>
                )}

                {/* Loading */}
                {dupLoading && (
                  <div className="flex items-center gap-2 text-sm text-gray-500 py-1">
                    <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                    Checking {parseResult.ids.length.toLocaleString()} transaction IDs against the database…
                  </div>
                )}

                {/* No duplicates */}
                {dupChecked && parseResult.txnIdCol && duplicates.length === 0 && !dupLoading && (
                  <div className="flex items-center gap-3 rounded-lg bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-700">
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                    <span>
                      No duplicates found — all {parseResult.ids.length.toLocaleString()} transaction IDs in column{' '}
                      <strong>"{parseResult.txnIdCol}"</strong> are new.
                    </span>
                  </div>
                )}

                {/* Duplicates found */}
                {dupChecked && duplicates.length > 0 && !dupLoading && (
                  <div className="rounded-lg bg-red-50 border border-red-200 overflow-hidden">
                    <div className="flex items-center gap-2 px-4 py-3 border-b border-red-100">
                      <AlertTriangle className="w-4 h-4 text-red-500 shrink-0" />
                      <span className="text-sm font-semibold text-red-700">
                        {duplicates.length} transaction{duplicates.length !== 1 ? 's' : ''} in this file {duplicates.length !== 1 ? 'were' : 'was'} already imported before
                      </span>
                    </div>
                    <ul className="divide-y divide-red-100 max-h-48 overflow-y-auto">
                      {duplicates.map(({ id, table }) => (
                        <li key={`${table}:${id}`} className="flex items-center justify-between px-4 py-2">
                          <span className="text-sm font-mono text-red-700">{id}</span>
                          <span className="text-[10px] font-medium text-red-400 bg-red-100 px-2 py-0.5 rounded">
                            {table === 'inflow_transactions' ? 'Inflow' : 'Outflow'}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Actions */}
                {dupChecked && !dupLoading && (
                  <div className="pt-1 space-y-3">
                    {/* Bank selector */}
                    <div className="flex items-center gap-3">
                      <label className="text-xs font-medium text-gray-600 shrink-0">Bank</label>
                      {banks.length === 0 ? (
                        <p className="text-xs text-gray-400">
                          No banks configured.{' '}
                          <Link to="/setup" className="text-primary underline hover:text-primary-light">Set up banks →</Link>
                        </p>
                      ) : (
                        <select
                          value={selectedBankId}
                          onChange={e => setSelectedBankId(e.target.value)}
                          className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-primary/30 bg-white"
                        >
                          <option value="">— No bank —</option>
                          {banks.map(b => (
                            <option key={b.id} value={b.id}>{b.is_foreign_currency ? `${b.name} [FX]` : b.name}</option>
                          ))}
                        </select>
                      )}
                    </div>

                    {/* Buttons */}
                    <div data-tour="import-confirm" className="flex flex-wrap items-center gap-3">
                      {duplicates.length > 0 ? (
                        <>
                          <button
                            onClick={() => openWizard(true)}
                            className="flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary-light transition-colors"
                          >
                            <Upload className="w-4 h-4" />
                            Skip Duplicates &amp; Import
                          </button>
                          <button
                            onClick={() => openWizard(false)}
                            className="flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                          >
                            Import Anyway
                          </button>
                          <p className="w-full text-xs text-gray-400">
                            "Skip" removes the {duplicates.length} duplicate row{duplicates.length !== 1 ? 's' : ''} before inserting.
                            "Import Anyway" includes them all.
                          </p>
                        </>
                      ) : (
                        <button
                          onClick={() => openWizard(false)}
                          className="flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary-light transition-colors"
                        >
                          <Upload className="w-4 h-4" />
                          Continue to Import Wizard
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Parse error */}
          {parseError && (
            <div className="flex items-center gap-2 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
              <AlertTriangle className="w-4 h-4 shrink-0" /> {parseError}
            </div>
          )}

          {/* Hidden file input */}
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,.pdf"
            className="hidden"
            onChange={handleFileInput}
          />

          {/* Supported tables */}
          {!parseResult && (
            <div className="rounded-xl border border-gray-100 bg-white p-5 space-y-3">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Supported Tables</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {['Inflow Transactions', 'Outflow Transactions', 'Intra-Account Flows', 'Ledger Entries', 'FX Transactions'].map(label => (
                  <div key={label} className="flex items-center gap-2 text-xs text-gray-600">
                    <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />
                    {label}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Manual Entry tab ─────────────────────────────────────────────── */}
      {activeTab === 'manual' && <ManualEntryForm />}

      {/* Import wizard modal */}
      <ImportModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        skipTxnIds={skipDups && duplicates.length > 0
          ? new Set(duplicates.map(d => d.id))
          : undefined}
        bank={selectedBankId ? (banks.find(b => b.id === selectedBankId) ?? null) : null}
        preloadedFile={selectedFile}
      />
    </div>
  )
}

// ── Manual Entry Form ──────────────────────────────────────────────────────────

function ManualEntryForm() {
  const { baseCurrencySymbol } = useOrgCurrency()
  const { categories }                                 = useCategories()
  const { push: toast }                                = useToastStore()
  const { banks, loading: banksLoading }               = useBanks()
  const { configs, fetch: fetchConfigs, loaded: cfgLoaded } = useAllocationStore()
  const addInflow  = useAddInflow()
  const addOutflow = useAddOutflow()

  useEffect(() => { if (!cfgLoaded) fetchConfigs() }, [cfgLoaded, fetchConfigs])

  const { incomeTypes } = useIncomeTypes()
  const { options: outflowTypeOptions } = useOutflowTypeOptions()
  const { maps: categoryOutflowMaps }   = useCategoryOutflowTypeMaps()

  // Direction toggle
  const [direction, setDirection] = useState<'inflow' | 'outflow'>('inflow')

  // Inflow-specific state
  const [incomeTypeId,      setIncomeTypeId]      = useState('')
  const [incomeTypeAutoSet, setIncomeTypeAutoSet] = useState(false)
  const [configOverride,    setConfigOverride]    = useState('')

  // Shared direction state
  const [txnType,       setTxnType]       = useState('')
  const [txnOffsetRole, setTxnOffsetRole] = useState('')
  const [rootTxnLink,   setRootTxnLink]   = useState<RootTxnLink | null>(null)

  // Outflow-specific state
  const [isPending,      setIsPending]      = useState(false)
  const [outflowS1,      setOutflowS1]      = useState('')
  const [outflowS2,      setOutflowS2]      = useState('')
  const [outflowTypeId,  setOutflowTypeId]  = useState('')

  // Form field values
  const [fields, setFields] = useState<Record<string, string>>({
    date: new Date().toISOString().slice(0, 10),
  })

  // Inline validation errors
  const [errors, setErrors] = useState<Record<string, string>>({})

  // Duplicate warning dialog
  const [dupWarning, setDupWarning]         = useState<{ txnId: string } | null>(null)
  const [pendingSave, setPendingSave]       = useState<(() => Promise<void>) | null>(null)
  const [saving, setSaving]                 = useState(false)

  const set = (key: string, val: string) => {
    setFields(prev => {
      const next = { ...prev, [key]: val }
      if (!txnType && direction === 'inflow' && !incomeTypeAutoSet && key === 'description') {
        const match = classifyIncomeType(val, '', incomeTypes)
        setIncomeTypeId(match ? match.id : '')
      }
      return next
    })
    if (errors[key]) setErrors(prev => ({ ...prev, [key]: '' }))
  }

  // Currency fields: store raw numeric string, display with commas
  const setCurrency = (key: string, displayVal: string) => {
    const stripped = displayVal.replace(/,/g, '')
    set(key, stripped)
  }
  const vCurrency = (key: string): string => formatCurrency(v(key))

  // Clear income type when switching to a non-Normal transaction type
  useEffect(() => {
    if (txnType) {
      setIncomeTypeId('')
      setIncomeTypeAutoSet(false)
    }
  }, [txnType])

  // Auto-fill outflow type from category mapping when stage_code_1 changes
  useEffect(() => {
    if (!outflowS1) { setOutflowTypeId(''); return }
    const cat = categories.find(c => c.name === outflowS1)
    if (cat) {
      const suggested = getDefaultOutflowTypeForCategory(cat.id, categoryOutflowMaps, outflowTypeOptions)
      setOutflowTypeId(suggested?.id ?? '')
      return
    }
    const match = outflowTypeOptions.find(t => t.name.toLowerCase() === outflowS1.toLowerCase())
    setOutflowTypeId(match?.id ?? '')
  }, [outflowS1, categories, categoryOutflowMaps, outflowTypeOptions])

  const handleDirectionChange = (d: 'inflow' | 'outflow') => {
    setDirection(d)
    setFields({ date: new Date().toISOString().slice(0, 10) })
    setErrors({})
    setIncomeTypeId('')
    setIncomeTypeAutoSet(false)
    setConfigOverride('')
    setTxnType('')
    setTxnOffsetRole('')
    setRootTxnLink(null)
    setIsPending(false)
    setOutflowS1('')
    setOutflowS2('')
    setOutflowTypeId('')
    setDupWarning(null)
    setPendingSave(null)
  }

  const v = (key: string) => fields[key] ?? ''

  // FX banks are excluded from Manual Entry — all FX transactions go through the FX module.
  const nonFxBanks = banks.filter(b => !b.is_foreign_currency)
  const hasFxBanks = banks.some(b => b.is_foreign_currency)

  const filteredManualCategories = useMemo(
    () => categories.filter(c => !c.currency),
    [categories],
  )

  // Clear outflowS1 when bank changes and the current value is not in the filtered list
  useEffect(() => {
    if (!outflowS1) return
    if (!filteredManualCategories.some(c => c.name === outflowS1)) setOutflowS1('')
  }, [filteredManualCategories, outflowS1])

  const availableTxnTypes = TXN_TYPE_OPTIONS

  // ── Duplicate check helpers ──────────────────────────────────────────────
  // bankName scopes the check to the selected bank so the same ID in a
  // different bank is not treated as a duplicate.

  async function checkInflowDup(ref: string, bankName: string | null): Promise<boolean> {
    let q = supabase.from('inflow_transactions').select('id').eq('transaction_ref', ref)
    if (bankName) q = q.eq('bank_name', bankName)
    const { data } = await q.limit(1)
    return (data?.length ?? 0) > 0
  }

  async function checkOutflowDup(txnId: string, bankName: string | null): Promise<boolean> {
    let q = supabase.from('outflow_transactions').select('id').eq('transaction_id', txnId)
    if (bankName) q = q.eq('bank_name', bankName)
    const { data } = await q.limit(1)
    return (data?.length ?? 0) > 0
  }

  // ── Save functions ───────────────────────────────────────────────────────

  const MISSING_COL_RE = /Could not find (?:the ')?(\w+)'? column/

  const doSaveInflow = async (pregenRef?: string) => {
    setSaving(true)
    try {
      const selectedIncomeType = incomeTypes.find(t => t.id === incomeTypeId) ?? null
      const effectiveConfigId: string | undefined = txnType ? undefined : (getFinalConfig(
        {
          incomeType:         selectedIncomeType,
          allocationConfigId: configOverride,
          isManualOverride:   !!configOverride,
        } satisfies RowResolverState,
        getConfigForDate(configs, v('date'))?.id ?? null,
        (groupId) => getSpecialConfigVersionForDate(configs, groupId, v('date'))?.id ?? null,
      ) ?? undefined)
      const selectedBank = banks.find(b => b.id === v('bank_id'))
      let input: AddInflowInput = {
        date:                       v('date'),
        amount:                     parseFloat(v('amount')),
        description:                v('description')               || undefined,
        allocation_config_id:       effectiveConfigId,
        bank_name:                  selectedBank?.name             || undefined,
        transaction_ref:            pregenRef || v('transaction_ref') || await generateFallbackTransactionId(v('date'), v('amount'), v('description') ?? '', selectedBank?.name ?? ''),
        specific_seed_description:  v('specific_seed_description') || undefined,
        remark:                     v('remark')                    || undefined,
        income_type_id:             txnType ? undefined : (incomeTypeId || undefined),
        transaction_type:           txnType                        || undefined,
        original_transaction_id:    v('original_transaction_id')   || undefined,
        ...(isOffsetableType(txnType) && txnOffsetRole
          ? { offset_role: txnOffsetRole as 'root' | 'offset' }
          : {}),
        ...(isOffsetableType(txnType) && txnOffsetRole === 'offset' && rootTxnLink
          ? {
              root_transaction_id:    rootTxnLink.id,
              root_transaction_table: rootTxnLink.table,
              offset_link_type:       txnType || undefined,
            }
          : {}),
        recorded_at:                new Date().toISOString(),
      }
      try {
        await addInflow.mutate(input)
      } catch (firstErr: unknown) {
        const col = (firstErr instanceof Error ? firstErr.message : '').match(MISSING_COL_RE)?.[1]
        if (col && col in input) {
          const retry = { ...input } as Record<string, unknown>
          delete retry[col]
          await addInflow.mutate(retry as unknown as AddInflowInput)
          toast(`⚠ ${col} column missing — run Setup → Database migration`, 'error')
        } else {
          throw firstErr
        }
      }
      toast('Inflow saved successfully', 'success')
      setFields({ date: new Date().toISOString().slice(0, 10) })
      setIncomeTypeId('')
      setIncomeTypeAutoSet(false)
      setConfigOverride('')
      setTxnType('')
      setTxnOffsetRole('')
      setRootTxnLink(null)
      setErrors({})
    } catch (e: unknown) {
      toast(e instanceof Error ? e.message : 'Save failed', 'error')
    } finally {
      setSaving(false)
      setDupWarning(null)
      setPendingSave(null)
    }
  }

  const doSaveOutflow = async (pregenId?: string) => {
    setSaving(true)
    try {
      const selectedBank = banks.find(b => b.id === v('bank_id'))
      let input: AddOutflowInput = {
        date:                    v('date'),
        amount_disbursed:        parseFloat(v('amount_disbursed')),
        description:             v('description')      || undefined,
        allocation_config_id:    txnType ? undefined : getConfigForDate(configs, v('date'))?.id,
        bank_name:               selectedBank?.name    || undefined,
        bank_description:        v('bank_description') || undefined,
        transaction_id:          pregenId || v('transaction_id') || await generateFallbackTransactionId(v('date'), v('amount_disbursed'), v('description') ?? v('bank_description') ?? '', selectedBank?.name ?? ''),
        is_pending_deduction:    isPending,
        stage_code_1:            outflowS1             || undefined,
        stage_code_2:            outflowS2             || undefined,
        outflow_type_id:         outflowTypeId         || undefined,
        remarks:                 v('remarks')          || undefined,
        transaction_type:        txnType               || undefined,
        original_transaction_id: v('original_transaction_id') || undefined,
        ...(isOffsetableType(txnType) && txnOffsetRole
          ? { offset_role: txnOffsetRole as 'root' | 'offset' }
          : {}),
        ...(isOffsetableType(txnType) && txnOffsetRole === 'offset' && rootTxnLink
          ? {
              root_transaction_id:    rootTxnLink.id,
              root_transaction_table: rootTxnLink.table,
              offset_link_type:       txnType || undefined,
            }
          : {}),
        recorded_at:             new Date().toISOString(),
      }
      try {
        await addOutflow.mutate(input)
      } catch (firstErr: unknown) {
        const col = (firstErr instanceof Error ? firstErr.message : '').match(MISSING_COL_RE)?.[1]
        if (col && col in input) {
          const retry = { ...input } as Record<string, unknown>
          delete retry[col]
          await addOutflow.mutate(retry as unknown as AddOutflowInput)
          toast(`⚠ ${col} column missing — run Setup → Database migration`, 'error')
        } else {
          throw firstErr
        }
      }
      toast('Outflow saved successfully', 'success')
      setFields({ date: new Date().toISOString().slice(0, 10) })
      setIsPending(false)
      setOutflowS1('')
      setOutflowS2('')
      setOutflowTypeId('')
      setTxnType('')
      setTxnOffsetRole('')
      setRootTxnLink(null)
      setErrors({})
    } catch (e: unknown) {
      toast(e instanceof Error ? e.message : 'Save failed', 'error')
    } finally {
      setSaving(false)
      setDupWarning(null)
      setPendingSave(null)
    }
  }

  // ── Submit handlers (validate → dup check → save or warn) ───────────────

  const handleSaveInflow = async () => {
    const errs: Record<string, string> = {}
    if (!v('date'))   errs.date   = 'Date is required'
    if (!v('amount') || parseFloat(v('amount')) <= 0) errs.amount = 'Enter a valid amount'
    if (!v('bank_id')) errs.bank_id = 'Bank is required'
    if (Object.keys(errs).length) { setErrors(errs); return }

    const bankName = banks.find(b => b.id === v('bank_id'))?.name ?? null
    const ref = v('transaction_ref').trim()
      || await generateFallbackTransactionId(v('date'), v('amount'), v('description') ?? '', bankName ?? '')
    const isDup = await checkInflowDup(ref, bankName)
    if (isDup) {
      setPendingSave(() => () => doSaveInflow(ref))
      setDupWarning({ txnId: ref })
      return
    }
    await doSaveInflow(ref)
  }

  const handleSaveOutflow = async () => {
    const errs: Record<string, string> = {}
    if (!v('date'))            errs.date            = 'Date is required'
    if (!v('amount_disbursed') || parseFloat(v('amount_disbursed')) <= 0)
      errs.amount_disbursed = 'Enter a valid amount'
    if (!v('bank_id')) errs.bank_id = 'Bank is required'
    if (Object.keys(errs).length) { setErrors(errs); return }

    const bankName = banks.find(b => b.id === v('bank_id'))?.name ?? null
    const txnId = v('transaction_id').trim()
      || await generateFallbackTransactionId(v('date'), v('amount_disbursed'), v('description') ?? v('bank_description') ?? '', bankName ?? '')
    const isDup = await checkOutflowDup(txnId, bankName)
    if (isDup) {
      setPendingSave(() => () => doSaveOutflow(txnId))
      setDupWarning({ txnId })
      return
    }
    await doSaveOutflow(txnId)
  }

  const handleConfirmDup = async () => {
    if (pendingSave) await pendingSave()
  }

  const handleCancelDup = () => {
    setDupWarning(null)
    setPendingSave(null)
  }

  return (
    <div className="max-w-2xl space-y-5">

      {/* Direction toggle */}
      <div className="flex gap-2">
        {(['inflow', 'outflow'] as const).map(d => {
          const Icon  = d === 'inflow' ? TrendingUp : TrendingDown
          const label = d === 'inflow' ? 'Inflow' : 'Outflow'
          const active = direction === d
          return (
            <button
              key={d}
              type="button"
              onClick={() => handleDirectionChange(d)}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold border-2 transition-colors ${
                active
                  ? d === 'inflow'
                    ? 'bg-success/10 border-success text-success'
                    : 'bg-danger/10 border-danger text-danger'
                  : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300'
              }`}
            >
              <Icon className="w-4 h-4" />
              {label}
            </button>
          )
        })}
      </div>

      {/* ── Inflow fields ─────────────────────────────────────────────── */}
      {direction === 'inflow' && (
        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">

          {/* Date + Amount */}
          <div className="grid grid-cols-2 gap-4">
            <Field label="Date *" error={errors.date}>
              <input type="date" value={v('date')} onChange={e => set('date', e.target.value)} className={iCls} />
            </Field>
            <Field label={`Amount (${baseCurrencySymbol}) *`} error={errors.amount}>
              <input type="text" inputMode="decimal" placeholder="0.00" value={vCurrency('amount')} onChange={e => setCurrency('amount', e.target.value)} className={iCls} />
            </Field>
          </div>

          {/* Description */}
          <Field label="Description">
            <input type="text" placeholder="e.g. Sunday offering" value={v('description')} onChange={e => set('description', e.target.value)} className={iCls} />
          </Field>

          {/* Bank */}
          <Field label="Bank *" error={errors.bank_id}>
            {!banksLoading && banks.length === 0 ? (
              <p className="text-xs text-gray-400 py-1">
                No banks configured.{' '}
                <Link to="/setup" className="text-primary underline hover:text-primary-light">Set up banks in Setup →</Link>
              </p>
            ) : (
              <>
                <select
                  value={v('bank_id')}
                  onChange={e => set('bank_id', e.target.value)}
                  disabled={banksLoading}
                  className={iCls}
                >
                  <option value="">— None —</option>
                  {nonFxBanks.map(b => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </select>
                {hasFxBanks && (
                  <p className="text-[11px] text-amber-600 mt-0.5">
                    Foreign currency banks are managed in the{' '}
                    <Link to="/foreign-currency" className="underline hover:text-amber-700">FX module</Link>.
                  </p>
                )}
              </>
            )}
          </Field>

          {/* Income Type */}
          {incomeTypes.length > 0 && (
            <Field label="Income Type">
              {txnType ? (
                <div className="px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-600">
                  {TXN_TYPE_OPTIONS.find(o => o.value === txnType)?.label ?? txnType}
                  <span className="text-xs text-gray-400 ml-2">— auto-set from transaction type</span>
                </div>
              ) : (
                <div className="space-y-1">
                  <select
                    value={incomeTypeId}
                    onChange={e => { setIncomeTypeId(e.target.value); setIncomeTypeAutoSet(!!e.target.value) }}
                    className={iCls}
                  >
                    <option value="">— Unclassified —</option>
                    {incomeTypes.map(t => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                  {incomeTypeId && !incomeTypeAutoSet && (
                    <p className="text-[10px] flex items-center gap-1 text-indigo-500">
                      <Sparkles className="w-3 h-3" />
                      Auto-detected · change above to override
                    </p>
                  )}
                </div>
              )}
            </Field>
          )}

          {/* Allocation Config */}
          {txnType ? (
            <div className="border border-gray-100 rounded-lg p-3 bg-gray-50">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Allocation Config</p>
              <p className="text-xs text-gray-400 italic mt-1">Not applicable for non-Normal transactions</p>
            </div>
          ) : cfgLoaded && v('date') && (() => {
            const selIncomeType = incomeTypes.find(t => t.id === incomeTypeId) ?? null
            const isCatchAll = selIncomeType !== null && selIncomeType.rules.length === 0
            const resolvedConfigId = getFinalConfig(
              {
                incomeType:         selIncomeType,
                allocationConfigId: configOverride,
                isManualOverride:   !!configOverride,
              } satisfies RowResolverState,
              getConfigForDate(configs, v('date'))?.id ?? null,
              (groupId) => getSpecialConfigVersionForDate(configs, groupId, v('date'))?.id ?? null,
            )
            const effectiveCfg = resolvedConfigId ? configs.find(c => c.id === resolvedConfigId) : null
            const isAutoSpecial = !configOverride && !isCatchAll &&
              selIncomeType && (selIncomeType.special_config_id || selIncomeType.special_config_group_id)
            return (
              <div className="border border-gray-100 rounded-lg p-3 space-y-2 bg-gray-50">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Allocation Config</p>
                {effectiveCfg ? (
                  <p className="text-xs text-primary">
                    {isAutoSpecial ? 'Auto-applying: ' : 'Using: '}
                    <strong>{effectiveCfg.name}</strong>
                    {!isAutoSpecial && !configOverride && (
                      <span className="text-gray-400 ml-1">— effective {formatDate(effectiveCfg.start_date)}</span>
                    )}
                  </p>
                ) : (
                  <p className="text-xs text-amber-600">No config found for this date — transaction saved without allocation</p>
                )}
                <select
                  value={configOverride}
                  onChange={e => setConfigOverride(e.target.value)}
                  className={`${iCls} bg-white text-xs`}
                >
                  <option value="">— Use auto-detected —</option>
                  {configs.map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
            )
          })()}

          {/* Transaction Ref */}
          <Field label="Transaction Ref">
            <input type="text" placeholder="Ref / cheque no." value={v('transaction_ref')} onChange={e => set('transaction_ref', e.target.value)} className={iCls} />
          </Field>

          {/* Transaction Type */}
          <Field label="Transaction Type">
            <select value={txnType} onChange={e => { setTxnType(e.target.value); setTxnOffsetRole(''); setRootTxnLink(null) }} className={iCls}>
              {availableTxnTypes.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </Field>

          {/* Offset Role — visible only for offsetting transaction types */}
          {isOffsetableType(txnType) && (
            <Field label="Offset Role">
              <select value={txnOffsetRole} onChange={e => { setTxnOffsetRole(e.target.value); if (e.target.value !== 'offset') setRootTxnLink(null) }} className={iCls}>
                <option value="">— Not set —</option>
                <option value="root">Root (original transaction)</option>
                <option value="offset">Offset (linked to root)</option>
              </select>
            </Field>
          )}

          {/* Root / Original Transaction — single combined field for offset rows */}
          {isOffsetableType(txnType) && txnOffsetRole === 'offset' && (
            <Field label="Root / Original Transaction">
              <RootTransactionSearch
                value={rootTxnLink}
                onChange={v => {
                  setRootTxnLink(v)
                  if (v?.txnRef) set('original_transaction_id', v.txnRef)
                }}
                bankName={banks.find(b => b.id === v('bank_id'))?.name ?? null}
              />
            </Field>
          )}

          {/* Specific Seed Description */}
          <Field label="Designated Purpose">
            <input type="text" placeholder="What is this gift designated for? (if any)" value={v('specific_seed_description')} onChange={e => set('specific_seed_description', e.target.value)} className={iCls} />
          </Field>

          {/* Remark */}
          <Field label="Remark">
            <textarea rows={2} placeholder="Additional notes…" value={v('remark')} onChange={e => set('remark', e.target.value)} className={`${iCls} resize-none`} />
          </Field>

          <div className="flex justify-end pt-1">
            <button
              type="button"
              onClick={handleSaveInflow}
              disabled={saving}
              className="flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-white bg-success rounded-lg hover:bg-green-700 transition-colors disabled:opacity-60"
            >
              {saving && <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
              {saving ? 'Saving…' : 'Save Inflow'}
            </button>
          </div>
        </div>
      )}

      {/* ── Outflow fields ────────────────────────────────────────────── */}
      {direction === 'outflow' && (
        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">

          {/* Date + Amount Disbursed */}
          <div className="grid grid-cols-2 gap-4">
            <Field label="Date *" error={errors.date}>
              <input type="date" value={v('date')} onChange={e => set('date', e.target.value)} className={iCls} />
            </Field>
            <Field label={`Amount Disbursed (${baseCurrencySymbol}) *`} error={errors.amount_disbursed}>
              <input type="text" inputMode="decimal" placeholder="0.00" value={vCurrency('amount_disbursed')} onChange={e => setCurrency('amount_disbursed', e.target.value)} className={iCls} />
            </Field>
          </div>

          {/* Description */}
          <Field label="Description">
            <input type="text" placeholder="e.g. Generator fuel purchase" value={v('description')} onChange={e => set('description', e.target.value)} className={iCls} />
          </Field>

          {/* Bank */}
          <Field label="Bank *" error={errors.bank_id}>
            {!banksLoading && banks.length === 0 ? (
              <p className="text-xs text-gray-400 py-1">
                No banks configured.{' '}
                <Link to="/setup" className="text-primary underline hover:text-primary-light">Set up banks in Setup →</Link>
              </p>
            ) : (
              <>
                <select
                  value={v('bank_id')}
                  onChange={e => set('bank_id', e.target.value)}
                  disabled={banksLoading}
                  className={iCls}
                >
                  <option value="">— None —</option>
                  {nonFxBanks.map(b => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </select>
                {hasFxBanks && (
                  <p className="text-[11px] text-amber-600 mt-0.5">
                    Foreign currency banks are managed in the{' '}
                    <Link to="/foreign-currency" className="underline hover:text-amber-700">FX module</Link>.
                  </p>
                )}
              </>
            )}
          </Field>

          {/* Bank Desc + Txn ID */}
          <div className="grid grid-cols-2 gap-4">
            <Field label="Bank Description">
              <input type="text" placeholder="Bank narration" value={v('bank_description')} onChange={e => set('bank_description', e.target.value)} className={iCls} />
            </Field>
            <Field label="Transaction ID">
              <input type="text" placeholder="Bank Txn ID" value={v('transaction_id')} onChange={e => set('transaction_id', e.target.value)} className={iCls} />
            </Field>
          </div>

          {/* Category (Stage Code 1 + 2) + Outflow Type */}
          <div className="border border-gray-100 rounded-lg p-3 space-y-3 bg-gray-50">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Budget Allocation (optional)</p>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Category">
                <select value={outflowS1} onChange={e => setOutflowS1(e.target.value)} className={iCls}>
                  <option value="">— None —</option>
                  {filteredManualCategories.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                </select>
              </Field>
              <Field label="Fund Type">
                <select value={outflowS2} onChange={e => setOutflowS2(e.target.value)} className={iCls}>
                  <option value="">— None —</option>
                  <option value="Percentage Allocation">Regular Funds</option>
                  <option value="Specific Seed">Designated Gift</option>
                  <option value="Savings">Savings</option>
                </select>
              </Field>
            </div>
            {outflowTypeOptions.length > 0 && (
              <Field label="Outflow Type">
                <SearchableSelect value={outflowTypeId} onChange={setOutflowTypeId}
                  options={outflowTypeOptions.map(t => ({ value: t.id, label: t.name }))}
                  placeholder="— None —" className={iCls} />
              </Field>
            )}
            <p className="text-[11px] text-gray-400">Links this outflow to the category ledger for tracking.</p>
          </div>

          {/* Pending Deduction */}
          <label className="flex items-center gap-3 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={isPending}
              onChange={e => setIsPending(e.target.checked)}
              className="w-4 h-4 rounded border-gray-300 text-primary focus:ring-primary/30"
            />
            <span className="text-sm font-medium text-gray-700">Mark as Pending Deduction</span>
          </label>

          {/* Remarks */}
          <Field label="Remarks">
            <textarea rows={2} placeholder="Additional notes…" value={v('remarks')} onChange={e => set('remarks', e.target.value)} className={`${iCls} resize-none`} />
          </Field>

          {/* Transaction Type */}
          <Field label="Transaction Type">
            <select value={txnType} onChange={e => { setTxnType(e.target.value); setTxnOffsetRole(''); setRootTxnLink(null) }} className={iCls}>
              {availableTxnTypes.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </Field>

          {/* Offset Role — visible only for offsetting transaction types */}
          {isOffsetableType(txnType) && (
            <Field label="Offset Role">
              <select value={txnOffsetRole} onChange={e => { setTxnOffsetRole(e.target.value); if (e.target.value !== 'offset') setRootTxnLink(null) }} className={iCls}>
                <option value="">— Not set —</option>
                <option value="root">Root (original transaction)</option>
                <option value="offset">Offset (linked to root)</option>
              </select>
            </Field>
          )}

          {/* Root / Original Transaction — single combined field for offset rows */}
          {isOffsetableType(txnType) && txnOffsetRole === 'offset' && (
            <Field label="Root / Original Transaction">
              <RootTransactionSearch
                value={rootTxnLink}
                onChange={v => {
                  setRootTxnLink(v)
                  if (v?.txnRef) set('original_transaction_id', v.txnRef)
                }}
                bankName={banks.find(b => b.id === v('bank_id'))?.name ?? null}
              />
            </Field>
          )}

          <div className="flex justify-end pt-1">
            <button
              type="button"
              onClick={handleSaveOutflow}
              disabled={saving}
              className="flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-white bg-danger rounded-lg hover:bg-red-700 transition-colors disabled:opacity-60"
            >
              {saving && <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
              {saving ? 'Saving…' : 'Save Outflow'}
            </button>
          </div>
        </div>
      )}

      {/* ── Duplicate warning dialog ──────────────────────────────────── */}
      {dupWarning && (
        <Modal open onClose={handleCancelDup} title="Possible Duplicate">
          <div className="space-y-4">
            <div className="flex items-start gap-3 rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-700">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold">Transaction ID already exists</p>
                <p className="mt-0.5">
                  A transaction with ID <span className="font-mono font-bold">{dupWarning.txnId}</span> already exists in the database.
                  Do you still want to save this record?
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-3">
              <button
                onClick={handleCancelDup}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmDup}
                disabled={saving}
                className="flex items-center gap-2 px-5 py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary-light transition-colors disabled:opacity-60"
              >
                {saving && <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                {saving ? 'Saving…' : 'Save Anyway'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

// ── Shared field helpers ───────────────────────────────────────────────────────

const iCls = 'w-full px-3 py-2 text-sm border border-gray-300 rounded-lg outline-none transition-colors focus:ring-2 focus:ring-primary/30 focus:border-primary bg-white'

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-gray-600">{label}</label>
      {children}
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  )
}
