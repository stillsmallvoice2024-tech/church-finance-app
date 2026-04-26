import { useState, useRef, useCallback, useEffect } from 'react'
import * as XLSX from 'xlsx'
import {
  Upload, PenLine, FileSpreadsheet, FileText,
  CheckCircle2, AlertTriangle, Loader2, X,
  TrendingUp, TrendingDown,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { usePageTitle } from '../hooks/usePageTitle'
import { ImportModal } from '../components/modals/ImportModal'
import { Modal } from '../components/ui/Modal'
import { supabase } from '../lib/supabase'
import { useCategories } from '../hooks/useCategories'
import { useAddInflow, useAddOutflow } from '../hooks/useMutations'
import { useToastStore } from '../store/toastStore'
import { useBanks } from '../hooks/useBanks'
import { useAllocationStore, getConfigForDate } from '../store/allocationStore'
import { formatDate } from '../utils/formatters'
import {
  INFLOW_TYPES, INFLOW_TYPE_LABELS, autoAssignInflowType, type InflowType,
} from '../utils/inflowTypes'
import { useIncomeTypes } from '../hooks/useIncomeTypes'
import { classifyIncomeType } from '../utils/classifyIncomeType'
import { Sparkles } from 'lucide-react'

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

  const reset = () => {
    setParseResult(null)
    setDuplicates([])
    setDupChecked(false)
    setParseError(null)
    setDupLoading(false)
    setSkipDups(false)
    setSelectedBankId('')
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

    // 1. Parse the Excel file
    let ids: string[] = []
    let txnIdCol: string | null = null
    let rowCount = 0

    try {
      const buffer = await file.arrayBuffer()
      const wb     = XLSX.read(buffer, { type: 'array' })
      const ws     = wb.Sheets[wb.SheetNames[0]]
      const rows   = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) as unknown[][]
      const headers = (rows[0] ?? []).map(h => String(h ?? '').trim())
      const dataRows = rows.slice(1).filter(r => (r as unknown[]).some(c => c !== '' && c != null))
      rowCount = dataRows.length

      const col = findTxnIdColumn(headers)
      if (col) {
        txnIdCol = col.header
        ids = dataRows
          .map(r => String((r as unknown[])[col.index] ?? '').trim())
          .filter(id => id.length > 0)
      }

      setParseResult({ fileName: file.name, rowCount, txnIdCol, ids })
    } catch {
      setParseError('Could not read the file. Make sure it is a valid Excel file.')
      return
    }

    // 2. Check for duplicates in DB (only if we found a txn ID column)
    if (ids.length === 0) {
      setDupChecked(true)
      return
    }

    setDupLoading(true)
    const uniqueIds = [...new Set(ids)]

    const [inflowRes, outflowRes] = await Promise.all([
      supabase
        .from('inflow_transactions')
        .select('transaction_ref')
        .in('transaction_ref', uniqueIds),
      supabase
        .from('outflow_transactions')
        .select('transaction_id')
        .in('transaction_id', uniqueIds),
    ])

    const found: DupRecord[] = []
    if (!inflowRes.error && inflowRes.data) {
      for (const r of inflowRes.data) {
        if (r.transaction_ref) found.push({ id: r.transaction_ref, table: 'inflow_transactions' })
      }
    }
    if (!outflowRes.error && outflowRes.data) {
      for (const r of outflowRes.data) {
        if (r.transaction_id) found.push({ id: r.transaction_id, table: 'outflow_transactions' })
      }
    }

    setDuplicates(found)
    setDupChecked(true)
    setDupLoading(false)
  }, [])

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
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Import Transactions</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Upload a bank statement or enter transactions manually
        </p>
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

          {/* Drop zone */}
          {!parseResult ? (
            <div
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
              <div className="px-5 py-4 space-y-3">
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
                        {duplicates.length} duplicate transaction ID{duplicates.length !== 1 ? 's' : ''} already exist in the database
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
                            <option key={b.id} value={b.id}>{b.name}</option>
                          ))}
                        </select>
                      )}
                    </div>

                    {/* Buttons */}
                    <div className="flex flex-wrap items-center gap-3">
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
  const { categories }                                 = useCategories()
  const { push: toast }                                = useToastStore()
  const { banks, loading: banksLoading }               = useBanks()
  const { configs, fetch: fetchConfigs, loaded: cfgLoaded } = useAllocationStore()
  const { incomeTypes }                                = useIncomeTypes()
  const addInflow  = useAddInflow()
  const addOutflow = useAddOutflow()

  useEffect(() => { if (!cfgLoaded) fetchConfigs() }, [cfgLoaded, fetchConfigs])

  // Direction toggle
  const [direction, setDirection] = useState<'inflow' | 'outflow'>('inflow')

  // Inflow-specific state
  const [inflowType,      setInflowType]      = useState<InflowType>('general_giving')
  const [typeManuallySet, setTypeManuallySet] = useState(false)
  const [incomeTypeId,      setIncomeTypeId]      = useState('')
  const [incomeTypeAutoSet, setIncomeTypeAutoSet] = useState(false)

  // Outflow-specific state
  const [isPending, setIsPending] = useState(false)

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
      if (direction === 'inflow' && (key === 'description' || key === 'stage_code_1')) {
        const desc   = key === 'description' ? val : (prev.description ?? '')
        const stage1 = key === 'stage_code_1' ? val : (prev.stage_code_1 ?? '')
        if (!typeManuallySet) setInflowType(autoAssignInflowType(desc))
        if (!incomeTypeId || incomeTypeAutoSet) {
          const match = classifyIncomeType(desc, stage1, incomeTypes)
          if (match) { setIncomeTypeId(match.id); setIncomeTypeAutoSet(true) }
          else if (incomeTypeAutoSet) { setIncomeTypeId(''); setIncomeTypeAutoSet(false) }
        }
      }
      return next
    })
    if (errors[key]) setErrors(prev => ({ ...prev, [key]: '' }))
  }

  const handleDirectionChange = (d: 'inflow' | 'outflow') => {
    setDirection(d)
    setFields({ date: new Date().toISOString().slice(0, 10) })
    setErrors({})
    setInflowType('general_giving')
    setTypeManuallySet(false)
    setIncomeTypeId('')
    setIncomeTypeAutoSet(false)
    setIsPending(false)
    setDupWarning(null)
    setPendingSave(null)
  }

  const v = (key: string) => fields[key] ?? ''

  // ── Duplicate check helpers ──────────────────────────────────────────────

  async function checkInflowDup(ref: string): Promise<boolean> {
    const { data } = await supabase
      .from('inflow_transactions')
      .select('id')
      .eq('transaction_ref', ref)
      .limit(1)
    return (data?.length ?? 0) > 0
  }

  async function checkOutflowDup(txnId: string): Promise<boolean> {
    const { data } = await supabase
      .from('outflow_transactions')
      .select('id')
      .eq('transaction_id', txnId)
      .limit(1)
    return (data?.length ?? 0) > 0
  }

  // ── Save functions ───────────────────────────────────────────────────────

  const doSaveInflow = async () => {
    setSaving(true)
    const selectedIncomeType = incomeTypes.find(t => t.id === incomeTypeId) ?? null
    const configId = selectedIncomeType?.special_config_id
      ?? getConfigForDate(configs, v('date'))?.id
    try {
      await addInflow.mutate({
        date:                       v('date'),
        amount:                     parseFloat(v('amount')),
        inflow_type:                inflowType,
        description:                v('description')               || undefined,
        bank_id:                    v('bank_id')                   || undefined,
        allocation_config_id:       configId,
        stage_code_1:               v('stage_code_1')              || undefined,
        stage_code_2:               v('stage_code_2')              || undefined,
        transaction_ref:            v('transaction_ref')           || undefined,
        specific_seed_description:  v('specific_seed_description') || undefined,
        remark:                     v('remark')                    || undefined,
        income_type_id:             incomeTypeId                   || undefined,
      })
      toast('Inflow saved successfully', 'success')
      setFields({ date: new Date().toISOString().slice(0, 10) })
      setInflowType('general_giving')
      setTypeManuallySet(false)
      setIncomeTypeId('')
      setIncomeTypeAutoSet(false)
      setErrors({})
    } catch (e: unknown) {
      toast(e instanceof Error ? e.message : 'Save failed', 'error')
    } finally {
      setSaving(false)
      setDupWarning(null)
      setPendingSave(null)
    }
  }

  const doSaveOutflow = async () => {
    setSaving(true)
    try {
      await addOutflow.mutate({
        date:                 v('date'),
        amount_disbursed:     parseFloat(v('amount_disbursed')),
        description:          v('description')      || undefined,
        bank_id:              v('bank_id')          || undefined,
        allocation_config_id: getConfigForDate(configs, v('date'))?.id,
        bank_description:     v('bank_description') || undefined,
        transaction_id:       v('transaction_id')   || undefined,
        stage_code_1:         v('stage_code_1')     || undefined,
        stage_code_2:         v('stage_code_2')     || undefined,
        amount_refunded:      v('amount_refunded')  ? parseFloat(v('amount_refunded'))  : undefined,
        transfer_charge:      v('transfer_charge')  ? parseFloat(v('transfer_charge'))  : undefined,
        is_pending_deduction: isPending,
        remarks:              v('remarks')          || undefined,
      })
      toast('Outflow saved successfully', 'success')
      setFields({ date: new Date().toISOString().slice(0, 10) })
      setIsPending(false)
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
    if (Object.keys(errs).length) { setErrors(errs); return }

    const ref = v('transaction_ref').trim()
    if (ref) {
      const isDup = await checkInflowDup(ref)
      if (isDup) {
        setPendingSave(() => doSaveInflow)
        setDupWarning({ txnId: ref })
        return
      }
    }
    await doSaveInflow()
  }

  const handleSaveOutflow = async () => {
    const errs: Record<string, string> = {}
    if (!v('date'))            errs.date            = 'Date is required'
    if (!v('amount_disbursed') || parseFloat(v('amount_disbursed')) <= 0)
      errs.amount_disbursed = 'Enter a valid amount'
    if (Object.keys(errs).length) { setErrors(errs); return }

    const txnId = v('transaction_id').trim()
    if (txnId) {
      const isDup = await checkOutflowDup(txnId)
      if (isDup) {
        setPendingSave(() => doSaveOutflow)
        setDupWarning({ txnId })
        return
      }
    }
    await doSaveOutflow()
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

      {/* Allocation config label */}
      {cfgLoaded && v('date') && (() => {
        const cfg = getConfigForDate(configs, v('date'))
        return cfg ? (
          <div className="flex items-center gap-2 text-xs rounded-lg px-3 py-2 bg-primary/5 border border-primary/20 text-primary">
            <span>Using: <strong>{cfg.name}</strong> — effective {formatDate(cfg.start_date)}</span>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-xs rounded-lg px-3 py-2 bg-amber-50 border border-amber-200 text-amber-700">
            No allocation config found for {formatDate(v('date'))} — transaction will be saved without an allocation
          </div>
        )
      })()}

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
            <Field label="Amount (₦) *" error={errors.amount}>
              <input type="number" min="0" step="0.01" placeholder="0.00" value={v('amount')} onChange={e => set('amount', e.target.value)} className={iCls} />
            </Field>
          </div>

          {/* Description */}
          <Field label="Description">
            <input type="text" placeholder="e.g. Sunday offering" value={v('description')} onChange={e => set('description', e.target.value)} className={iCls} />
          </Field>

          {/* Bank */}
          <Field label="Bank">
            {!banksLoading && banks.length === 0 ? (
              <p className="text-xs text-gray-400 py-1">
                No banks configured.{' '}
                <Link to="/setup" className="text-primary underline hover:text-primary-light">Set up banks in Setup →</Link>
              </p>
            ) : (
              <select
                value={v('bank_id')}
                onChange={e => set('bank_id', e.target.value)}
                disabled={banksLoading}
                className={iCls}
              >
                <option value="">— None —</option>
                {banks.map(b => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            )}
          </Field>

          {/* Inflow Type */}
          <Field label="Inflow Type">
            <div className="grid grid-cols-3 gap-1.5">
              {INFLOW_TYPES.map(t => (
                <button
                  key={t} type="button"
                  onClick={() => { setInflowType(t); setTypeManuallySet(true) }}
                  className={`px-2 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                    inflowType === t
                      ? 'bg-primary text-white border-primary'
                      : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  {INFLOW_TYPE_LABELS[t]}
                </button>
              ))}
            </div>
            {!typeManuallySet && v('description') && (
              <p className="text-[10px] text-gray-400 mt-1">Auto-assigned from description · click to change</p>
            )}
          </Field>

          {/* Custom Income Type */}
          {incomeTypes.length > 0 && (
            <Field label="Income Type">
              <div className="flex items-center gap-2">
                {incomeTypeId && (() => {
                  const t = incomeTypes.find(x => x.id === incomeTypeId)
                  return t ? <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: t.color }} /> : null
                })()}
                <select
                  value={incomeTypeId}
                  onChange={e => {
                    setIncomeTypeId(e.target.value)
                    setIncomeTypeAutoSet(false)
                  }}
                  className={`flex-1 ${iCls}`}
                >
                  <option value="">— None —</option>
                  {incomeTypes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
              {incomeTypeAutoSet && incomeTypeId && (
                <p className="flex items-center gap-1 text-[10px] text-primary mt-1">
                  <Sparkles className="w-3 h-3" /> Auto-suggested · click to change
                </p>
              )}
            </Field>
          )}

          {/* Stage Code 1 + 2 */}
          <div className="grid grid-cols-2 gap-4">
            <Field label="Stage Code 1">
              <select value={v('stage_code_1')} onChange={e => set('stage_code_1', e.target.value)} className={iCls}>
                <option value="">— Select —</option>
                {categories.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
              </select>
            </Field>
            <Field label="Stage Code 2 (Portion Type)">
              <select value={v('stage_code_2')} onChange={e => set('stage_code_2', e.target.value)} className={iCls}>
                <option value="">— Select —</option>
                <option value="Percentage Allocation">Percentage Allocation</option>
                <option value="Specific Seed">Specific Seed</option>
                <option value="Savings">Savings</option>
              </select>
            </Field>
          </div>

          {/* Transaction Ref */}
          <Field label="Transaction Ref">
            <input type="text" placeholder="Ref / cheque no." value={v('transaction_ref')} onChange={e => set('transaction_ref', e.target.value)} className={iCls} />
          </Field>

          {/* Specific Seed Description */}
          <Field label="Specific Seed Description">
            <input type="text" placeholder="For specific seed entries" value={v('specific_seed_description')} onChange={e => set('specific_seed_description', e.target.value)} className={iCls} />
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
            <Field label="Amount Disbursed (₦) *" error={errors.amount_disbursed}>
              <input type="number" min="0" step="0.01" placeholder="0.00" value={v('amount_disbursed')} onChange={e => set('amount_disbursed', e.target.value)} className={iCls} />
            </Field>
          </div>

          {/* Description */}
          <Field label="Description">
            <input type="text" placeholder="e.g. Generator fuel purchase" value={v('description')} onChange={e => set('description', e.target.value)} className={iCls} />
          </Field>

          {/* Bank */}
          <Field label="Bank">
            {!banksLoading && banks.length === 0 ? (
              <p className="text-xs text-gray-400 py-1">
                No banks configured.{' '}
                <Link to="/setup" className="text-primary underline hover:text-primary-light">Set up banks in Setup →</Link>
              </p>
            ) : (
              <select
                value={v('bank_id')}
                onChange={e => set('bank_id', e.target.value)}
                disabled={banksLoading}
                className={iCls}
              >
                <option value="">— None —</option>
                {banks.map(b => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
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

          {/* Stage Code 1 + 2 */}
          <div className="grid grid-cols-2 gap-4">
            <Field label="Stage Code 1">
              <select value={v('stage_code_1')} onChange={e => set('stage_code_1', e.target.value)} className={iCls}>
                <option value="">— Select —</option>
                {categories.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
              </select>
            </Field>
            <Field label="Stage Code 2 (Portion Type)">
              <select value={v('stage_code_2')} onChange={e => set('stage_code_2', e.target.value)} className={iCls}>
                <option value="">— Select —</option>
                <option value="Percentage Allocation">Percentage Allocation</option>
                <option value="Specific Seed">Specific Seed</option>
                <option value="Savings">Savings</option>
              </select>
            </Field>
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

          {/* Optional banking extras */}
          <div className="border border-gray-100 rounded-lg p-4 space-y-4 bg-gray-50">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Optional Banking Details</p>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Amount Refunded (₦)">
                <input type="number" min="0" step="0.01" placeholder="0.00" value={v('amount_refunded')} onChange={e => set('amount_refunded', e.target.value)} className={iCls} />
              </Field>
              <Field label="Transfer Charge (₦)">
                <input type="number" min="0" step="0.01" placeholder="0.00" value={v('transfer_charge')} onChange={e => set('transfer_charge', e.target.value)} className={iCls} />
              </Field>
            </div>
          </div>

          {/* Remarks */}
          <Field label="Remarks">
            <textarea rows={2} placeholder="Additional notes…" value={v('remarks')} onChange={e => set('remarks', e.target.value)} className={`${iCls} resize-none`} />
          </Field>

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
