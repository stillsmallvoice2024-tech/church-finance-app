import { useState, useRef, useCallback, useMemo, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import * as XLSX from 'xlsx'
import {
  Upload, FileSpreadsheet, ChevronRight, ChevronLeft, ChevronDown,
  CheckCircle2, AlertTriangle, RefreshCw, FileText, Sparkles,
} from 'lucide-react'
import { Modal } from '../ui/Modal'
import { ViewToggle, useViewToggle } from '../ui/ViewToggle'
import { CreateSpecialConfigModal } from './CreateSpecialConfigModal'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/authStore'
import { useOrgStore } from '../../store/orgStore'
import { useAllocationStore, getConfigForDate, getSpecialConfigVersionForDate } from '../../store/allocationStore'
import { useCategories } from '../../hooks/useCategories'
import { useBanks } from '../../hooks/useBanks'
import { useIncomeTypes } from '../../hooks/useIncomeTypes'
import { useOutflowTypeOptions, useCategoryOutflowTypeMaps, getDefaultOutflowTypeForCategory } from '../../hooks/useOutflowTypes'
import { useOrgCurrency } from '../../hooks/useOrgCurrency'
import {
  resolveDefaultIncomeType,
  getFinalConfig,
  type RowResolverState,
} from '../../utils/configResolver'
import { generateFallbackTransactionId } from '../../utils/generateTransactionId'
import { parseDate, type DateFormat } from '../../utils/parseDate'
import { useTransactionSyncStore } from '../../store/transactionSyncStore'
import { SearchableSelect } from '../ui/SearchableSelect'

// ── ID normalization ──────────────────────────────────────────────────────────
// Strips invisible characters (zero-width spaces, soft hyphen, BOM, NBSP, etc.),
// applies Unicode NFC, collapses whitespace, and trims.
// Case is preserved — bank-provided IDs are case-sensitive.
function normalizeId(raw: string): string {
  // U+00AD soft-hyphen, U+00A0 NBSP, U+200B–U+200D zero-width chars,
  // U+2028–U+2029 line/para separators, U+FEFF BOM
  return raw
    .normalize('NFC')
    .replace(/\u00ad|\u00a0|\u200b|\u200c|\u200d|\u2028|\u2029|\ufeff/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

// ── Target table definitions ───────────────────────────────────────────────────

type TargetTable = 'bank_statement' | 'fx_transactions'

interface FieldDef { key: string; label: string; required?: boolean }

const TABLE_CONFIG: Record<TargetTable, { label: string; fields: FieldDef[] }> = {
  bank_statement: {
    label: 'Bank Statement (auto-split → Inflow / Outflow)',
    fields: [
      { key: 'date',        label: 'Date',                  required: true },
      { key: 'description', label: 'Description'                           },
      { key: 'credit',      label: 'Credit (Inflow Amount)'                },
      { key: 'debit',       label: 'Debit (Outflow Amount)'                },
      { key: 'balance',     label: 'Balance (info only)'                   },
      { key: 'reference',   label: 'Reference / Txn ID'                    },
    ],
  },
  fx_transactions: {
    label: 'FX Transactions',
    fields: [
      { key: 'date',            label: 'Date',            required: true },
      { key: 'currency',        label: 'Currency',        required: true },
      { key: 'deposit',         label: 'Deposit'                         },
      { key: 'withdrawal',      label: 'Withdrawal'                      },
      { key: 'running_balance', label: 'Running Balance'                 },
      { key: 'narration',       label: 'Narration'                       },
      { key: 'transaction_ref', label: 'Transaction Ref'                 },
    ],
  },
}

const SKIP = '__skip__'

const SESSION_KEY = 'church-import-session'

// ── Date / number parsing ──────────────────────────────────────────────────────
// parseDate and DateFormat are imported from ../../utils/parseDate

function parseNumber(raw: unknown): number {
  if (raw == null || raw === '') return 0
  if (typeof raw === 'number') return isNaN(raw) ? 0 : raw
  const cleaned = String(raw).replace(/,/g, '').replace(/\s/g, '').trim()
  const n = parseFloat(cleaned)
  return isNaN(n) ? 0 : n
}

// Debit-specific parser: always returns unsigned magnitude.
// Handles banks that store debits as negative numbers (-1000) or accounting
// notation (1,000.00) — both of which would silently fail a plain `> 0` check.
function parseDebitAmount(raw: unknown): number {
  if (raw == null || raw === '') return 0
  if (typeof raw === 'number') return isNaN(raw) ? 0 : Math.abs(raw)
  let s = String(raw).replace(/,/g, '').replace(/\s/g, '').trim()
  if (s.startsWith('(') && s.endsWith(')')) s = s.slice(1, -1)   // (1000.00) → 1000.00
  const n = parseFloat(s)
  return isNaN(n) ? 0 : Math.abs(n)
}

// ── Auto-mapping ───────────────────────────────────────────────────────────────

const ALIAS_MAP: Record<string, string[]> = {
  date:             ['date', 'dt', 'transdate', 'valuedate', 'entrydate', 'txndate', 'valuedate'],
  amount:           ['amount', 'amt', 'sum', 'value'],
  amount_disbursed: ['amount', 'disbursed', 'amtdisbursed'],
  total_amount:     ['total', 'totalamount', 'amount'],
  description:      ['description', 'desc', 'narration', 'details', 'particulars', 'memo', 'remarks'],
  stage_code_1:     ['stage', 'stagecode', 'stagecode1', 'code1', 'account'],
  transaction_ref:  ['ref', 'reference', 'txnref', 'transref', 'transactionid', 'txnid'],
  currency:         ['currency', 'ccy', 'curr'],
  // bank_statement virtual fields
  credit:           ['credit', 'cr', 'deposit', 'deposits', 'inflow', 'in', 'income', 'incoming', 'inward', 'creditamt'],
  debit:            ['debit', 'dr', 'withdrawal', 'withdrawals', 'outflow', 'out', 'payment', 'payments', 'charge', 'charges', 'debitamt'],
  reference:        ['reference', 'ref', 'txnref', 'transref', 'transactionid', 'txnid', 'sessionid'],
  balance:          ['balance', 'runningbalance', 'closingbalance', 'closingbal', 'runningbal'],
  deposit:          ['deposit', 'credit', 'inflow', 'in'],
  withdrawal:       ['withdrawal', 'debit', 'outflow', 'out'],
  running_balance:  ['balance', 'runningbalance', 'closingbalance'],
  inflow:           ['inflow', 'credit', 'in'],
  outflow:          ['outflow', 'debit', 'out'],
  remark:           ['remark', 'remarks', 'note', 'notes', 'comment'],
  narration:        ['narration', 'description', 'desc', 'memo'],
  inflow_type:      ['inflowtype', 'type', 'category'],
  bank_id:          ['bankid', 'banktxnid', 'banktransactionid', 'bankref', 'bankreference', 'banksessionid'],
}

export function detectHeaderRow(rows: unknown[][]): number {
  const allAliases = new Set(Object.values(ALIAS_MAP).flat())
  const scan = Math.min(15, rows.length)
  let bestScore = 0, bestIdx = 0
  for (let i = 0; i < scan; i++) {
    const score = (rows[i] as unknown[]).filter(c => {
      const v = String(c ?? '').toLowerCase().replace(/[\s_\-()\[\]]+/g, '')
      return v.length > 0 && allAliases.has(v)
    }).length
    if (score > bestScore) { bestScore = score; bestIdx = i }
  }
  return bestScore >= 2 ? bestIdx : 0
}

const TXN_TYPE_OPTIONS = [
  { value: '',                   label: 'Normal' },
  { value: 'refund',             label: 'Refund' },
  { value: 'reversal',           label: 'Reversal' },
  { value: 'bank_deposit',       label: 'Bank Deposit' },
  { value: 'intrabank_transfer', label: 'Intrabank Transfer' },
  { value: 'fx_inflow',          label: 'FX Inflow' },
  { value: 'fx_outflow',         label: 'FX Outflow' },
]

const FX_INFLOW_TYPES  = TXN_TYPE_OPTIONS.filter(o => o.value === 'fx_inflow')
const FX_OUTFLOW_TYPES = TXN_TYPE_OPTIONS.filter(o => o.value === 'fx_outflow')

function autoMapColumn(header: string, fields: FieldDef[]): string {
  const h = header.toLowerCase().replace(/[\s_\-().]+/g, '')
  // 1. exact field key match
  for (const f of fields) {
    if (f.key.replace(/_/g, '') === h) return f.key
  }
  // 2. alias match — short aliases (≤2 chars) use prefix/suffix only to avoid false mid-word matches
  for (const f of fields) {
    const aliases = ALIAS_MAP[f.key] ?? []
    for (const alias of aliases) {
      const match = alias.length <= 2
        ? (h === alias || h.startsWith(alias) || h.endsWith(alias))
        : (h === alias || h.includes(alias))
      if (match) return f.key
    }
  }
  return SKIP
}

// ── Parsed sheet ───────────────────────────────────────────────────────────────

interface ParsedSheet {
  name:     string
  headers:  string[]
  rows:     unknown[][]
  rowCount: number
}

// ── Step indicator ─────────────────────────────────────────────────────────────

function StepDots({ step }: { step: number }) {
  const STEPS = ['Upload', 'Select Sheet', 'Map Columns', 'Configure Rows', 'Import']
  return (
    <div className="flex items-center gap-0 mb-5">
      {STEPS.map((label, i) => {
        const n   = i + 1
        const done = n < step
        const cur  = n === step
        return (
          <div key={n} className="flex items-center">
            <div className="flex flex-col items-center">
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-colors ${
                done ? 'bg-primary border-primary text-white' :
                cur  ? 'border-primary text-primary bg-primary/5' :
                       'border-gray-200 text-gray-300'
              }`}>
                {done ? <CheckCircle2 className="w-4 h-4" /> : n}
              </div>
              <span className={`text-[10px] mt-1 whitespace-nowrap ${cur ? 'text-primary font-semibold' : 'text-gray-400'}`}>
                {label}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div className={`h-0.5 w-10 mx-1 mb-3 ${done ? 'bg-primary' : 'bg-gray-200'}`} />
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

interface Props {
  open:            boolean
  onClose:         () => void
  skipTxnIds?:     Set<string>
  bank?:           { id: string; name: string } | null
  preloadedFile?:  File | null
}

interface ImportResult {
  imported:        number
  skipped:         number
  errors:          string[]
  fallbackIdCount: number
  collisions:      string[]
}

export function ImportModal({ open, onClose, skipTxnIds, bank, preloadedFile }: Props) {
  const { baseCurrencySymbol, foreignCurrencies } = useOrgCurrency()
  const inputRef = useRef<HTMLInputElement>(null)
  const { user } = useAuthStore.getState()
  const orgId = useOrgStore.getState().orgId

  // Step state
  const [step,     setStep]    = useState(1)
  const [dragging, setDragging] = useState(false)
  const [parsing,  setParsing] = useState(false)

  // Step 1
  const [sheets,   setSheets]   = useState<ParsedSheet[]>([])
  const [parseErr, setParseErr] = useState<string | null>(null)
  const [fileName, setFileName] = useState<string>('')

  // Step 2
  const [selectedSheet, setSelectedSheet]   = useState('')
  const [targetTable,   setTargetTable]     = useState<TargetTable | ''>('')

  // Step 3 — mapping: spreadsheetCol → app field key (or SKIP)
  const [mapping, setMapping] = useState<Record<string, string>>({})

  // Step 4
  const [importing, setImporting]   = useState(false)
  const [progress,  setProgress]    = useState(0)
  const [result,    setResult]      = useState<ImportResult | null>(null)

  // Derived
  const sheet   = useMemo(() => sheets.find(s => s.name === selectedSheet) ?? null, [sheets, selectedSheet])
  const config  = targetTable ? TABLE_CONFIG[targetTable] : null
  const preview = sheet?.rows.slice(0, 5) ?? []

  // Allocation configs — load once so Step 4 and runImport can use them
  const { configs: allocConfigs, fetch: fetchAllocConfigs, reload: reloadAllocConfigs, loaded: allocLoaded } = useAllocationStore()
  // Refresh configs every time the modal opens; fall back to lazy-load if already loaded
  useEffect(() => {
    if (open) reloadAllocConfigs()
    else if (!allocLoaded) fetchAllocConfigs()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // Categories for stage code dropdowns
  const { categories } = useCategories()

  // Bank selector inside wizard
  const { banks: bankList } = useBanks()
  const [internalBank, setInternalBank] = useState<{ id: string; name: string } | null>(bank ?? null)

  // Income types for auto-classify + per-row picker
  const { incomeTypes } = useIncomeTypes()
  // Outflow types for auto-mapping from category-outflow map
  const { options: outflowTypeOptions } = useOutflowTypeOptions()
  const { maps: categoryOutflowMaps }   = useCategoryOutflowTypeMaps()

  // Sync bank prop → internalBank when parent provides/updates it (e.g. async bank data load)
  useEffect(() => {
    if (bank) setInternalBank(bank)
  }, [bank])

  const isForeignCurrencyBank = !!internalBank &&
    (bankList.find(b => b.id === internalBank.id)?.is_foreign_currency ?? false)

  const bankLabel = (b: { name: string; is_foreign_currency: boolean }) =>
    b.is_foreign_currency ? `${b.name} [FX]` : b.name

  // When a Foreign Currency Bank is selected: lock target table to fx_transactions
  // and auto-populate fxCurrency from the bank's own currency.
  useEffect(() => {
    if (!isForeignCurrencyBank) return
    setTargetTable('fx_transactions')
    const bankCurrency = bankList.find(b => b.id === internalBank?.id)?.currency
    if (bankCurrency) setFxCurrency(bankCurrency)
  }, [isForeignCurrencyBank, internalBank?.id, bankList])

  // Per-row pending deduction (by sheet row index ri)
  const [rowPendingDeductions, setRowPendingDeductions] = useState<Set<number>>(new Set())

  // Date format (Phase A)
  const [dateFormat, setDateFormat] = useState<DateFormat>('DD/MM/YYYY')

  // FX currency (Phase B)
  const [fxCurrency, setFxCurrency] = useState('')

  // Per-row special config assignment (rowIndex → configId)
  const [rowConfigs, setRowConfigs] = useState<Record<number, string>>({})

  // Step 4 — Configure Rows
  // Pre-merged, description-normalized rows built at proceedToRowConfig time; null before Step 4
  const [processedRows,   setProcessedRows]   = useState<unknown[][] | null>(null)
  const [rowStageCodes,   setRowStageCodes]   = useState<Record<number, { s1: string; s2: string }>>({})
  const [rowTxnTypes,     setRowTxnTypes]     = useState<Record<number, string>>({})
  const [rowOrigTxnIds,   setRowOrigTxnIds]   = useState<Record<number, string>>({})
  const [rowOutflowTypes, setRowOutflowTypes] = useState<Record<number, string>>({})
  const [batchTxnType,    setBatchTxnType]    = useState('')
  const [createConfigPendingRow, setCreateConfigPendingRow] = useState<number | 'apply' | null>(null)
  const [bsConfigTab,     setBsConfigTab]     = useState<'inflow' | 'outflow'>('inflow')

  // Step 4 — filter bars
  const [inflowFilter,  setInflowFilter]  = useState({ desc: '', amtFrom: '', amtTo: '' })
  const [outflowFilter, setOutflowFilter] = useState({ desc: '', amtFrom: '', amtTo: '' })

  // Step 4 — apply bar selections
  const [applyInflowConfig, setApplyInflowConfig] = useState('')
  const [applyS1,           setApplyS1]           = useState('')
  const [applyS2,           setApplyS2]           = useState('')
  const [applyIncomeType,   setApplyIncomeType]   = useState('')
  const [applyOutflowType,  setApplyOutflowType]  = useState('')

  // When the user picks an income type in the Apply bar, auto-derive its linked config
  // so both fields stay in sync without requiring a separate manual selection.
  useEffect(() => {
    if (!applyIncomeType) return
    const it = incomeTypes.find(t => t.id === applyIncomeType)
    if (!it) return
    if (it.rules.length === 0) {
      setApplyInflowConfig('__general__')
    } else if (it.special_config_id) {
      setApplyInflowConfig(it.special_config_id)
    } else if (it.special_config_group_id) {
      const today = new Date().toISOString().slice(0, 10)
      const v = getSpecialConfigVersionForDate(allocConfigs, it.special_config_group_id, today)
      if (v) setApplyInflowConfig(v.id)
    }
  }, [applyIncomeType, incomeTypes, allocConfigs])

  // Per-row income type overrides (rowIndex → incomeTypeId)
  const [rowIncomeTypes,     setRowIncomeTypes]     = useState<Record<number, string>>({})
  // Per-row manual config override flag — true only when user explicitly changed the config dropdown
  const [rowManualOverrides, setRowManualOverrides] = useState<Record<number, boolean>>({})
  const [tooltipState,   setTooltipState]   = useState<{ text: string; x: number; y: number } | null>(null)

  // Row selection (by sheet row index) — stable across filter/sort changes
  const [selectedInflowRis,  setSelectedInflowRis]  = useState<Set<number>>(new Set())
  const [selectedOutflowRis, setSelectedOutflowRis] = useState<Set<number>>(new Set())

  // Step 4 — view toggle (table vs cards) + per-card expanded state
  const { view: importRowView, setView: setImportRowView } = useViewToggle('import-step4-view')
  const [expandedInflowCardRis,  setExpandedInflowCardRis]  = useState<Set<number>>(new Set())
  const [expandedOutflowCardRis, setExpandedOutflowCardRis] = useState<Set<number>>(new Set())

  // ── Row-level memoized auto-classification ────────────────────────────────
  // Pre-compute keyword-matched income types for all inflow rows once, keyed by ri.
  // Avoids re-running classifyIncomeType for every row on every render (critical for 500+ rows).
  const autoClassifiedTypes = useMemo(() => {
    if (!processedRows || incomeTypes.length === 0) return {} as Record<number, import('../../hooks/useIncomeTypes').IncomeType | null>
    const descIdx   = sheet?.headers.findIndex(h => mapping[h] === 'description') ?? -1
    const creditIdx = sheet?.headers.findIndex(h => mapping[h] === 'credit') ?? -1
    const result: Record<number, import('../../hooks/useIncomeTypes').IncomeType | null> = {}
    for (let ri = 0; ri < processedRows.length; ri++) {
      const raw    = processedRows[ri]
      const credit = creditIdx >= 0 ? parseNumber(raw[creditIdx] as unknown) : 0
      if (credit <= 0) continue
      const desc = descIdx >= 0 && raw[descIdx] != null ? String(raw[descIdx]).trim() : ''
      result[ri] = desc ? resolveDefaultIncomeType(desc, '', incomeTypes) : null
    }
    return result
  }, [processedRows, incomeTypes, sheet?.headers, mapping])

  // ── Import pipeline: pre-computed IDs + duplicate detection ──────────────
  // Set during proceedToRowConfig (Step 3→4 transition), BEFORE Step 4 opens.
  // IDs are generated after description normalization so they are stable and
  // deterministic across repeated imports of the same file.
  const [precomputedInflowIds,  setPrecomputedInflowIds]  = useState<Record<number, string>>({})
  const [precomputedOutflowIds, setPrecomputedOutflowIds] = useState<Record<number, string>>({})
  // Row indices identified as DB duplicates — excluded from Step 4 configuration entirely.
  const [duplicateRis,    setDuplicateRis]    = useState<Set<number>>(new Set())
  const [dupCheckLoading, setDupCheckLoading] = useState(false)
  const [dupStats,        setDupStats]        = useState<{ total: number; newCount: number; dupCount: number } | null>(null)
  const [dupSkipOpen,     setDupSkipOpen]     = useState(false)

  // ── Dismiss-guard state ────────────────────────────────────────────────────
  const [confirmingReset, setConfirmingReset] = useState(false)

  // Processing = any async operation in flight — blocks ALL close paths
  const isProcessing = importing || parsing || dupCheckLoading
  // Dirty = meaningful progress exists that would be lost on close
  const isDirty = !result && (step > 1 || fileName !== '' || sheets.length > 0)

  // In-wizard dup check

  // Derived from the already-loaded allocConfigs store — no separate query needed.
  // This avoids the race condition where a linked config UUID is in displaySelId
  // but not yet present in a separately-loaded specialConfigs list, causing the
  // <select> to silently fall back to showing "General (date-based)".
  const specialConfigs = useMemo(
    () => allocConfigs.filter(c => c.is_special),
    [allocConfigs],
  )

  // Apply bar config list: for versioned group configs, only show the currently
  // active version (by today's date) — avoids multiple versions of the same group
  // appearing as separate options in the dropdown.
  const applyBarSpecialConfigs = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10)
    const seenGroups = new Set<string>()
    const result: typeof allocConfigs = []
    for (const c of specialConfigs) {
      if (!c.config_group_id) {
        result.push(c)
      } else if (!seenGroups.has(c.config_group_id)) {
        seenGroups.add(c.config_group_id)
        const active = getSpecialConfigVersionForDate(allocConfigs, c.config_group_id, today)
        if (active) result.push(active)
      }
    }
    return result
  }, [specialConfigs, allocConfigs])
  const [createConfigOpen, setCreateConfigOpen] = useState(false)

  // ── Reset on open/close ──────────────────────────────────────────────────

  const reset = useCallback(() => {
    try { sessionStorage.removeItem(SESSION_KEY) } catch {}
    setConfirmingReset(false)
    setNavBlockShowing(false)
    setStep(1)
    setSheets([])
    setParseErr(null)
    setFileName('')
    setSelectedSheet('')
    setTargetTable('')
    setMapping({})
    setProgress(0)
    setResult(null)
    setImporting(false)
    setParsing(false)
    setRowPendingDeductions(new Set())
    setDateFormat('DD/MM/YYYY')
    setFxCurrency('')
    setRowConfigs({})
    setProcessedRows(null)
    setRowStageCodes({})
    setRowTxnTypes({})
    setRowOrigTxnIds({})
    setRowOutflowTypes({})
    setBatchTxnType('')
    setCreateConfigPendingRow(null)
    setBsConfigTab('inflow')
    setInflowFilter({ desc: '', amtFrom: '', amtTo: '' })
    setOutflowFilter({ desc: '', amtFrom: '', amtTo: '' })
    setApplyInflowConfig('')
    setApplyS1('')
    setApplyS2('')
    setApplyIncomeType('')
    setApplyOutflowType('')
    setRowIncomeTypes({})
    setRowManualOverrides({})
    setSelectedInflowRis(new Set())
    setSelectedOutflowRis(new Set())
    setExpandedInflowCardRis(new Set())
    setExpandedOutflowCardRis(new Set())
    setPrecomputedInflowIds({})
    setPrecomputedOutflowIds({})
    setDuplicateRis(new Set())
    setDupCheckLoading(false)
    setDupStats(null)
    setDupSkipOpen(false)
    // Clear back-button sentinel ref so a fresh open can push a new one
    sentinelPushedRef.current = false
    pendingNavIsBackRef.current = false
    // NOTE: intentionally do NOT reset internalBank — persists across "Import Another"
  }, [])

  const handleClose = () => {
    // Neutralise the history sentinel pushed by the back-button guard so the user
    // doesn't get a phantom extra back-step after a normal close.
    if (sentinelPushedRef.current) {
      sentinelPushedRef.current = false
      history.replaceState({}, '')
    }
    reset()
    onClose()
  }

  // ── Session autosave ───────────────────────────────────────────────────────
  // Saves progress to sessionStorage so accidental closes can be recovered.
  // Only runs when dirty and no preloaded file (preloaded file re-parses on open).
  useEffect(() => {
    if (!isDirty || preloadedFile) return
    const state = {
      step, fileName,
      sheets,
      selectedSheet, targetTable, mapping, dateFormat, fxCurrency,
      bankId:   internalBank?.id   ?? null,
      bankName: internalBank?.name ?? null,
      rowConfigs,
      rowStageCodes,
      rowTxnTypes,
      rowOrigTxnIds,
      rowOutflowTypes,
      rowIncomeTypes,
      rowManualOverrides,
      rowPendingDeductions: [...rowPendingDeductions],
      processedRows:         step >= 4 ? processedRows        : null,
      precomputedInflowIds:  step >= 4 ? precomputedInflowIds : {},
      precomputedOutflowIds: step >= 4 ? precomputedOutflowIds : {},
      duplicateRis:          [...duplicateRis],
      dupStats,
      bsConfigTab,
    }
    try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(state)) } catch {}
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDirty, step, fileName, sheets, selectedSheet, targetTable, mapping, dateFormat,
      fxCurrency, internalBank, rowConfigs, rowStageCodes, rowTxnTypes, rowOrigTxnIds,
      rowOutflowTypes, rowIncomeTypes, rowManualOverrides, rowPendingDeductions,
      processedRows, precomputedInflowIds, precomputedOutflowIds, duplicateRis,
      dupStats, bsConfigTab, preloadedFile])

  // ── Session restore ────────────────────────────────────────────────────────
  // Runs once per false→true open transition.
  // Restores previously interrupted import sessions automatically.
  const prevOpenRef = useRef(false)
  useEffect(() => {
    const wasOpen = prevOpenRef.current
    prevOpenRef.current = open
    if (!open || wasOpen || preloadedFile) return
    try {
      const saved = sessionStorage.getItem(SESSION_KEY)
      if (!saved) return
      const s = JSON.parse(saved)
      if (!s.sheets?.length || s.step < 2) return
      // JSON.parse converts numeric object keys to strings; restore them as numbers
      const toNumRec = <T,>(obj: Record<string, T>): Record<number, T> =>
        Object.fromEntries(Object.entries(obj ?? {}).map(([k, v]) => [Number(k), v]))
      setStep(s.step)
      setFileName(s.fileName ?? '')
      setSheets(s.sheets)
      setSelectedSheet(s.selectedSheet ?? '')
      setTargetTable(s.targetTable ?? '')
      setMapping(s.mapping ?? {})
      setDateFormat(s.dateFormat ?? 'DD/MM/YYYY')
      setFxCurrency(s.fxCurrency ?? '')
      if (s.bankId && s.bankName) setInternalBank({ id: s.bankId, name: s.bankName })
      setRowConfigs(toNumRec(s.rowConfigs ?? {}))
      setRowStageCodes(toNumRec(s.rowStageCodes ?? {}))
      setRowTxnTypes(toNumRec(s.rowTxnTypes ?? {}))
      setRowOrigTxnIds(toNumRec(s.rowOrigTxnIds ?? {}))
      setRowOutflowTypes(toNumRec(s.rowOutflowTypes ?? {}))
      setRowIncomeTypes(toNumRec(s.rowIncomeTypes ?? {}))
      setRowManualOverrides(toNumRec(s.rowManualOverrides ?? {}))
      setRowPendingDeductions(new Set<number>(s.rowPendingDeductions ?? []))
      if (s.processedRows) setProcessedRows(s.processedRows)
      setPrecomputedInflowIds(toNumRec(s.precomputedInflowIds ?? {}))
      setPrecomputedOutflowIds(toNumRec(s.precomputedOutflowIds ?? {}))
      setDuplicateRis(new Set<number>(s.duplicateRis ?? []))
      if (s.dupStats) setDupStats(s.dupStats)
      if (s.bsConfigTab) setBsConfigTab(s.bsConfigTab)
    } catch {}
  }, [open, preloadedFile]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── beforeunload guard ─────────────────────────────────────────────────────
  // Prompts browser "Leave site?" on page refresh or tab close when dirty.
  useEffect(() => {
    if (!isDirty || isProcessing) return
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [isDirty, isProcessing])

  // ── Route change guard ────────────────────────────────────────────────────
  // useBlocker requires the Data Router API (createBrowserRouter) which this app
  // does not use. Instead, capture anchor clicks in the capture phase to intercept
  // React Router <Link> navigation before the router processes it.
  const navigate = useNavigate()
  const [navBlockShowing, setNavBlockShowing] = useState(false)
  const pendingNavPathRef = useRef('')
  // When true the pending "navigation" is actually a browser back/swipe-back gesture.
  // The discard action must close the modal rather than call navigate().
  const pendingNavIsBackRef = useRef(false)
  // True once a history sentinel has been pushed; ensures we push at most one.
  const sentinelPushedRef = useRef(false)

  useEffect(() => {
    if (!open || !isDirty || isProcessing || !!result) return
    const handler = (e: MouseEvent) => {
      const anchor = (e.target as HTMLElement).closest<HTMLAnchorElement>('a[href]')
      if (!anchor) return
      try {
        const url = new URL(anchor.href, window.location.href)
        if (url.origin !== window.location.origin) return // external
        if (url.pathname === window.location.pathname) return // same page
        e.preventDefault()
        e.stopPropagation()
        pendingNavPathRef.current = url.pathname + url.search
        pendingNavIsBackRef.current = false
        setNavBlockShowing(true)
      } catch {}
    }
    document.addEventListener('click', handler, true)
    return () => document.removeEventListener('click', handler, true)
  }, [open, isDirty, isProcessing, result])

  // ── Back-button / swipe-back guard ────────────────────────────────────────
  // Push a history sentinel so the first back-press pops our entry rather than
  // leaving the page. Intercept popstate to show the discard confirmation dialog.
  // Works for Android hardware back, iOS edge-swipe, and desktop browser back.
  useEffect(() => {
    if (!open || !isDirty || isProcessing) {
      return
    }
    if (!sentinelPushedRef.current) {
      sentinelPushedRef.current = true
      history.pushState({ importModalGuard: true }, '')
    }
    const handlePopState = () => {
      if (navBlockShowing) return // dialog already visible
      // Re-push sentinel so repeated back presses keep hitting the guard
      history.pushState({ importModalGuard: true }, '')
      pendingNavIsBackRef.current = true
      setNavBlockShowing(true)
    }
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, isDirty, isProcessing, navBlockShowing])

  // ── File parsing ─────────────────────────────────────────────────────────

  const parseFile = useCallback(async (file: File) => {
    setParseErr(null)
    setParsing(true)
    setFileName(file.name)
    try {
      let parsed: ParsedSheet[]

      if (file.name.match(/\.pdf$/i)) {
        const { parsePDF } = await import('../../utils/pdfParser')
        parsed = await parsePDF(file)
        if (parsed.length === 0) throw new Error('No tabular data detected in this PDF. Ensure it contains a statement table.')
      } else if (file.name.match(/\.(xlsx|xls)$/i)) {
        const data = await file.arrayBuffer()
        const wb   = XLSX.read(data, { type: 'array', cellDates: false })
        parsed = wb.SheetNames.map(name => {
          const ws        = wb.Sheets[name]
          const rows      = (XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) as unknown[][])
          const headerIdx = detectHeaderRow(rows)
          const headers   = (rows[headerIdx] ?? []).map(h => String(h ?? '').trim())
          const dataRows  = rows.slice(headerIdx + 1).filter(r => r.some(c => c !== '' && c != null))
          return { name, headers, rows: dataRows, rowCount: dataRows.length }
        })
      } else {
        throw new Error('Only .xlsx, .xls, and .pdf files are supported.')
      }

      setSheets(parsed)
      if (parsed.length > 0) {
        setSelectedSheet(parsed[0].name)
        setStep(2)
      }
    } catch (err) {
      setParseErr(err instanceof Error ? err.message : 'Failed to parse file')
    } finally {
      setParsing(false)
    }
  }, [])

  // Auto-parse pre-loaded file when modal opens — skips the upload step
  useEffect(() => {
    if (open && preloadedFile && sheets.length === 0 && !parsing) {
      parseFile(preloadedFile)
    }
  }, [open, preloadedFile]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) parseFile(file)
  }

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) parseFile(file)
    e.target.value = ''
  }

  // ── Step 2 → 3: build initial mapping ────────────────────────────────────

  const proceedToMapping = () => {
    if (!sheet || !config) return
    const initial: Record<string, string> = {}
    for (const h of sheet.headers) {
      initial[h] = autoMapColumn(h, config.fields)
    }
    setMapping(initial)
    setStep(3)
  }

  // ── Step 3 → 4 (bank_statement) or Step 3 → 5 (fx_transactions) ─────────

  // ── Import pipeline (bank_statement, Step 3→4 transition) ─────────────────
  // Pipeline order (all before Step 4 opens):
  //   1. Merge continuation rows
  //   2. Normalize descriptions
  //   3. Generate fallback transaction IDs AFTER normalization (stable, deterministic)
  //   4. Query DB for ALL computed IDs (preset + fallback) to find duplicates
  //   5. Mark duplicate rows → excluded from Step 4 entirely
  //   6. Step 4 receives ONLY non-duplicate rows for configuration
  const proceedToRowConfig = useCallback(async () => {
    if (!sheet || !config || targetTable !== 'bank_statement') return
    setDupCheckLoading(true)

    try {
      const s1ColIdx  = sheet.headers.findIndex(h => mapping[h] === 'stage_code_1')
      const s2ColIdx  = sheet.headers.findIndex(h => mapping[h] === 'stage_code_2')
      const dateIdx   = sheet.headers.findIndex(h => mapping[h] === 'date')
      const descIdx   = sheet.headers.findIndex(h => mapping[h] === 'description')
      const creditIdx = sheet.headers.findIndex(h => mapping[h] === 'credit')
      const debitIdx  = sheet.headers.findIndex(h => mapping[h] === 'debit')
      const refIdx    = sheet.headers.findIndex(h => mapping[h] === 'reference')

      // ── Stage 1: Merge continuation rows + normalize descriptions ─────────
      // runImport reuses processedRows — no second normalization pass needed.
      const merged = (sheet.rows as unknown[][]).map(r => [...r])

      // Remove repeated header rows before any stage processes merged.
      // Some statements contain multiple sub-tables and repeat the exact header
      // row mid-file; without this they reach continuation-row logic and get
      // appended to the preceding transaction's description.
      const normCell = (c: unknown) => String(c ?? '').toLowerCase().replace(/[\s_\-()\[\]]+/g, '')
      const headerSig = sheet.headers.map(normCell).filter(Boolean).join('\0')
      if (headerSig) {
        for (let ri = merged.length - 1; ri >= 0; ri--) {
          if (merged[ri].map(normCell).filter(Boolean).join('\0') === headerSig) {
            merged.splice(ri, 1)
          }
        }
      }

      for (let ri = 1; ri < merged.length; ri++) {
        const row = merged[ri]
        if (parseDate(row[dateIdx], dateFormat) !== null) continue
        if ((creditIdx >= 0 && parseNumber(row[creditIdx]) > 0) || (debitIdx >= 0 && parseDebitAmount(row[debitIdx]) > 0)) continue
        const hasDesc = descIdx >= 0 && row[descIdx] != null && String(row[descIdx]).trim() !== ''
        const hasRef  = refIdx  >= 0 && row[refIdx]  != null && String(row[refIdx]).trim()  !== ''
        if (!hasDesc && !hasRef) continue
        let prevRi = ri - 1
        while (prevRi >= 0 && parseDate(merged[prevRi][dateIdx], dateFormat) === null) prevRi--
        if (prevRi < 0) continue
        const prev = merged[prevRi]
        if (hasDesc) prev[descIdx] = (String(prev[descIdx] ?? '').trim() + ' ' + String(row[descIdx]).trim()).replace(/\s+/g, ' ').trim()
        if (hasRef)  prev[refIdx]  = (String(prev[refIdx]  ?? '').trim() + ' ' + String(row[refIdx]).trim()).replace(/\s+/g, ' ').trim()
      }
      if (descIdx >= 0) {
        for (const row of merged) {
          const raw = row[descIdx]
          if (raw != null && raw !== '') row[descIdx] = normalizeId(String(raw)) || raw
        }
      }
      setProcessedRows(merged)

      // ── Stage 2: Pre-populate rowStageCodes for debit rows ───────────────
      const initial: Record<number, { s1: string; s2: string }> = {}
      for (let ri = 0; ri < merged.length; ri++) {
        const raw   = merged[ri]
        const debit = debitIdx >= 0 ? parseDebitAmount(raw[debitIdx]) : 0
        if (debit <= 0) continue
        const s1 = s1ColIdx >= 0 && raw[s1ColIdx] != null && raw[s1ColIdx] !== ''
          ? String(raw[s1ColIdx]).trim() : ''
        const s2 = s2ColIdx >= 0 && raw[s2ColIdx] != null && raw[s2ColIdx] !== ''
          ? String(raw[s2ColIdx]).trim() : ''
        initial[ri] = { s1, s2 }
      }
      setRowStageCodes(initial)

      // Also initialize outflow types from category mapping for pre-populated stage codes
      if (outflowTypeOptions.length > 0) {
        const initialOt: Record<number, string> = {}
        for (const riKey of Object.keys(initial)) {
          const ri = Number(riKey)
          const sc = initial[ri]
          if (!sc.s1) continue
          const cat = categories.find((c: { name: string }) => c.name === sc.s1)
          if (cat) {
            const suggested = getDefaultOutflowTypeForCategory(cat.id, categoryOutflowMaps, outflowTypeOptions)
            if (suggested) { initialOt[ri] = suggested.id; continue }
          }
          const match = outflowTypeOptions.find(t => t.name.toLowerCase() === sc.s1.toLowerCase())
          if (match) initialOt[ri] = match.id
        }
        setRowOutflowTypes(initialOt)
      }

      // ── Stage 3: Generate fallback IDs AFTER normalization ────────────────
      // Separate maps for inflow (transaction_ref) and outflow (transaction_id).
      // Fallback IDs use normalized descriptions so they match on re-import.
      // Bank-provided refs are used directly (no hashing needed).
      const newInflowIds:  Record<number, string> = {}
      const newOutflowIds: Record<number, string> = {}
      const inflowIdList:  string[] = []
      const outflowIdList: string[] = []

      for (let ri = 0; ri < merged.length; ri++) {
        const raw    = merged[ri]
        const date   = dateIdx >= 0 ? parseDate(raw[dateIdx], dateFormat) : null
        if (!date) continue
        const credit = creditIdx >= 0 ? parseNumber(raw[creditIdx]) : 0
        const debit  = debitIdx  >= 0 ? parseDebitAmount(raw[debitIdx]) : 0
        const desc   = descIdx >= 0 && raw[descIdx] != null ? String(raw[descIdx]).trim() : ''
        const ref    = refIdx >= 0 && raw[refIdx] != null && raw[refIdx] !== ''
                         ? normalizeId(String(raw[refIdx])) || null : null

        if (credit > 0) {
          const id = ref ?? await generateFallbackTransactionId(
            String(date), String(credit), desc, internalBank?.name ?? ''
          )
          newInflowIds[ri] = id
          inflowIdList.push(id)
        }
        if (debit > 0) {
          const id = ref ?? await generateFallbackTransactionId(
            String(date), String(debit), desc, internalBank?.name ?? ''
          )
          newOutflowIds[ri] = id
          outflowIdList.push(id)
        }
      }
      setPrecomputedInflowIds(newInflowIds)
      setPrecomputedOutflowIds(newOutflowIds)

      // ── Stage 4: Duplicate detection against the database ─────────────────
      // Scoped to the selected bank (bank_name) so that the same transaction ID
      // in a different bank is not treated as a duplicate.
      const uniqueInflowIds  = [...new Set(inflowIdList)].filter(Boolean)
      const uniqueOutflowIds = [...new Set(outflowIdList)].filter(Boolean)
      const bankName = internalBank?.name ?? null

      const [inflowRes, outflowRes] = await Promise.all([
        uniqueInflowIds.length > 0
          ? (bankName
              ? supabase.from('inflow_transactions').select('transaction_ref').eq('bank_name', bankName).in('transaction_ref', uniqueInflowIds)
              : supabase.from('inflow_transactions').select('transaction_ref').in('transaction_ref', uniqueInflowIds))
          : Promise.resolve({ data: [] as { transaction_ref: string }[], error: null }),
        uniqueOutflowIds.length > 0
          ? (bankName
              ? supabase.from('outflow_transactions').select('transaction_id').eq('bank_name', bankName).in('transaction_id', uniqueOutflowIds)
              : supabase.from('outflow_transactions').select('transaction_id').in('transaction_id', uniqueOutflowIds))
          : Promise.resolve({ data: [] as { transaction_id: string }[], error: null }),
      ])

      const existingInflowRefs = new Set(
        (inflowRes.data ?? []).map(r => normalizeId(r.transaction_ref ?? '')).filter(Boolean)
      )
      const existingOutflowIds = new Set(
        (outflowRes.data ?? []).map(r => normalizeId(r.transaction_id ?? '')).filter(Boolean)
      )

      // Merge in skipTxnIds from Import.tsx pre-stage (when user chose "Skip Duplicates")
      if (skipTxnIds) {
        for (const id of skipTxnIds) {
          const normalized = normalizeId(id)
          existingInflowRefs.add(normalized)
          existingOutflowIds.add(normalized)
        }
      }

      // ── Stage 5: Mark duplicate rows + compute stats ──────────────────────
      // Only rows with valid dates and amounts are counted.
      const newDuplicateRis = new Set<number>()
      let totalCount = 0, dupCount = 0

      for (let ri = 0; ri < merged.length; ri++) {
        const raw    = merged[ri]
        const date   = dateIdx >= 0 ? parseDate(raw[dateIdx], dateFormat) : null
        if (!date) continue
        const credit = creditIdx >= 0 ? parseNumber(raw[creditIdx]) : 0
        const debit  = debitIdx  >= 0 ? parseDebitAmount(raw[debitIdx]) : 0
        if (credit === 0 && debit === 0) continue

        totalCount++
        let isDup = false
        const inflowId  = newInflowIds[ri]
        const outflowId = newOutflowIds[ri]
        if (credit > 0 && inflowId  && existingInflowRefs.has(normalizeId(inflowId)))  isDup = true
        if (debit  > 0 && outflowId && existingOutflowIds.has(normalizeId(outflowId))) isDup = true
        if (isDup) { newDuplicateRis.add(ri); dupCount++ }
      }

      setDuplicateRis(newDuplicateRis)
      setDupStats({ total: totalCount, newCount: totalCount - dupCount, dupCount })
      setStep(4)
    } finally {
      setDupCheckLoading(false)
    }
  }, [sheet, config, targetTable, mapping, dateFormat, internalBank, skipTxnIds,
      categories, categoryOutflowMaps, outflowTypeOptions])

  const proceedToImport = useCallback(() => {
    if (!sheet || !config || !targetTable) return
    setStep(5)
  }, [sheet, config, targetTable])

  // ── Step 4: Import ────────────────────────────────────────────────────────

  const runImport = useCallback(async () => {
    if (!sheet || !config || !targetTable) return
    setImporting(true)
    setProgress(0)
    setResult(null)

    const userId = user?.id ?? null
    let imported = 0
    let skipped  = 0
    const errors: string[] = []
    try {

    const { configs: latestConfigs } = useAllocationStore.getState()

    // Dup skip set — built from pre-import stage only (skipTxnIds passed from Import.tsx)
    const allSkipIds = new Set(skipTxnIds ? [...skipTxnIds].map(normalizeId) : [])
    let fallbackIdCount = 0
    const collisions: string[] = []

    // ── Bank statement split mode ─────────────────────────────────────────────
    if (targetTable === 'bank_statement') {
      const colIdx = (field: string) => {
        const h = Object.keys(mapping).find(k => mapping[k] === field)
        return h !== undefined ? sheet.headers.indexOf(h) : -1
      }
      const dateIdx   = colIdx('date')
      const descIdx   = colIdx('description')
      const creditIdx = colIdx('credit')
      const debitIdx  = colIdx('debit')
      const refIdx    = colIdx('reference')

      const inflowRows:  Record<string, unknown>[] = []
      const outflowRows: Record<string, unknown>[] = []
      const importTimestamp = new Date().toISOString()
      // Collision trackers for fallback IDs: hash → count of times seen this batch
      const inflowIdCounts  = new Map<string, number>()
      const outflowIdCounts = new Map<string, number>()

      // Rows pre-merged and description-normalized at proceedToRowConfig; fall back defensively
      const mergedRows = processedRows ?? (sheet.rows as unknown[][]).map(r => [...r])

      for (let ri = 0; ri < mergedRows.length; ri++) {
        const raw  = mergedRows[ri]
        const date = dateIdx >= 0 ? parseDate(raw[dateIdx], dateFormat) : null
        if (!date) { skipped++; continue }

        // Rows already in the database were excluded from Step 4 configuration.
        if (duplicateRis.has(ri)) { skipped++; continue }

        const credit = creditIdx >= 0 ? parseNumber(raw[creditIdx])      : 0
        const debit  = debitIdx  >= 0 ? parseDebitAmount(raw[debitIdx]) : 0
        const desc   = descIdx >= 0 && raw[descIdx] != null && raw[descIdx] !== ''
                         ? String(raw[descIdx]).trim() : null
        const ref    = refIdx >= 0 && raw[refIdx] != null && raw[refIdx] !== ''
                         ? normalizeId(String(raw[refIdx])) || null : null

        const cfg = getConfigForDate(latestConfigs, date)
        const rowTxnType = rowTxnTypes[ri] ?? ''
        const origId  = rowOrigTxnIds[ri] ?? ''

        if (credit > 0) {
          const txnType = isForeignCurrencyBank ? 'fx_inflow' : rowTxnType
          const row: Record<string, unknown> = { date, amount: credit, description: desc, transaction_ref: ref }
          if (userId) row.created_by = userId
          // Non-Normal transactions skip income type and allocation entirely
          if (!txnType) {
            const effIncomeTypeId = rowIncomeTypes[ri]
              ?? (desc ? resolveDefaultIncomeType(desc, '', incomeTypes)?.id : undefined)
            if (effIncomeTypeId) row.income_type_id = effIncomeTypeId
            const rowState: RowResolverState = {
              incomeType:          incomeTypes.find(t => t.id === effIncomeTypeId) ?? null,
              allocationConfigId:  rowConfigs[ri] ?? '',
              isManualOverride:    rowManualOverrides[ri] ?? false,
            }
            const resolvedId = getFinalConfig(
              rowState,
              cfg?.id ?? null,
              (groupId) => getSpecialConfigVersionForDate(latestConfigs, groupId, date)?.id ?? null,
            )
            if (resolvedId) row.allocation_config_id = resolvedId
          }
          if (internalBank) row.bank_name = internalBank.name
          if (!row.transaction_ref) {
            // Use ID pre-computed at Step 3→4 transition (after normalization, stable).
            // Falls back to on-the-fly generation as a safety net.
            const baseId = precomputedInflowIds[ri]
              ?? await generateFallbackTransactionId(
                String(date), String(credit), desc ?? '', internalBank?.name ?? ''
              )
            const count = inflowIdCounts.get(baseId) ?? 0
            inflowIdCounts.set(baseId, count + 1)
            row.transaction_ref = count === 0 ? baseId : `${baseId}-${count}`
            fallbackIdCount++
            if (count > 0) collisions.push(
              `Inflow   ${date}  ${credit}  "${(desc ?? '').slice(0, 35)}"  → …${(row.transaction_ref as string).slice(-10)}`
            )
          }
          if (txnType) row.transaction_type = txnType
          if (origId)  row.original_transaction_id = origId
          row.recorded_at = importTimestamp
          inflowRows.push(row)
        }
        if (debit > 0) {
          const txnType = isForeignCurrencyBank ? 'fx_outflow' : rowTxnType
          const row: Record<string, unknown> = { date, amount_disbursed: debit, description: desc, transaction_id: ref }
          if (userId) row.created_by = userId
          if (!txnType && cfg) row.allocation_config_id = cfg.id
          if (internalBank) row.bank_name = internalBank.name
          if (!row.transaction_id) {
            // Use ID pre-computed at Step 3→4 transition (after normalization, stable).
            const baseId = precomputedOutflowIds[ri]
              ?? await generateFallbackTransactionId(
                String(date), String(debit), desc ?? '', internalBank?.name ?? ''
              )
            const count = outflowIdCounts.get(baseId) ?? 0
            outflowIdCounts.set(baseId, count + 1)
            row.transaction_id = count === 0 ? baseId : `${baseId}-${count}`
            fallbackIdCount++
            if (count > 0) collisions.push(
              `Outflow  ${date}  ${debit}  "${(desc ?? '').slice(0, 35)}"  → …${(row.transaction_id as string).slice(-10)}`
            )
          }
          const sc = rowStageCodes[ri]
          if (sc) {
            if (sc.s1) row.stage_code_1 = sc.s1
            if (sc.s2) row.stage_code_2 = sc.s2
          }
          const otId = rowOutflowTypes[ri]
          if (otId) {
            row.outflow_type_id = otId
          } else if (sc?.s1 && outflowTypeOptions.length > 0) {
            // Fallback auto-mapping for rows not explicitly configured in UI
            const cat = categories.find((c: { name: string }) => c.name === sc.s1)
            if (cat) {
              const suggested = getDefaultOutflowTypeForCategory(cat.id, categoryOutflowMaps, outflowTypeOptions)
              if (suggested) row.outflow_type_id = suggested.id
            } else {
              const match = outflowTypeOptions.find(t => t.name.toLowerCase() === sc.s1.toLowerCase())
              if (match) row.outflow_type_id = match.id
            }
          }
          row.is_pending_deduction = rowPendingDeductions.has(ri)
          if (txnType) row.transaction_type = txnType
          if (origId)  row.original_transaction_id = origId
          row.recorded_at = importTimestamp
          outflowRows.push(row)
        }
        if (credit === 0 && debit === 0) skipped++
      }

      // Apply dup skip filter (allSkipIds comes from pre-import stage only)
      const inflowToInsert  = allSkipIds.size > 0
        ? inflowRows.filter(r => { const id = r.transaction_ref as string | undefined; return !id || !allSkipIds.has(id) })
        : inflowRows
      const outflowToInsert = allSkipIds.size > 0
        ? outflowRows.filter(r => { const id = r.transaction_id as string | undefined; return !id || !allSkipIds.has(id) })
        : outflowRows
      const skippedDups = (inflowRows.length - inflowToInsert.length) + (outflowRows.length - outflowToInsert.length)
      if (skippedDups > 0) { skipped += skippedDups; errors.push(`${skippedDups} duplicate(s) skipped`) }

      const total = inflowToInsert.length + outflowToInsert.length
      const BATCH = 100

      const MISSING_COL_SQL: Record<string, string> = {
        allocation_config_id:
          'ALTER TABLE inflow_transactions  ADD COLUMN IF NOT EXISTS allocation_config_id uuid;\n' +
          'ALTER TABLE outflow_transactions ADD COLUMN IF NOT EXISTS allocation_config_id uuid;',
        income_type_id:
          'ALTER TABLE inflow_transactions  ADD COLUMN IF NOT EXISTS income_type_id uuid;\n' +
          'ALTER TABLE outflow_transactions ADD COLUMN IF NOT EXISTS income_type_id uuid;',
        recorded_at:
          'ALTER TABLE inflow_transactions  ADD COLUMN IF NOT EXISTS recorded_at timestamptz;\n' +
          'UPDATE inflow_transactions SET recorded_at = created_at WHERE recorded_at IS NULL;\n' +
          'ALTER TABLE outflow_transactions ADD COLUMN IF NOT EXISTS recorded_at timestamptz;\n' +
          'UPDATE outflow_transactions SET recorded_at = created_at WHERE recorded_at IS NULL;\n' +
          "NOTIFY pgrst, 'reload schema';",
      }
      const missingColMsg = (col: string) => {
        const sql = MISSING_COL_SQL[col]
        return sql
          ? `⚠ ${col} column missing — run in Supabase SQL Editor:\n${sql}`
          : `⚠ ${col} column missing — run DB migration to add this column`
      }

      for (let i = 0; i < inflowToInsert.length; i += BATCH) {
        const batch = inflowToInsert.slice(i, i + BATCH)
        let { error: err } = await supabase.from('inflow_transactions').insert(batch)
        const missingInflow = err?.message.match(/Could not find (?:the ')?(\w+)'? column/)?.[1]
        if (missingInflow) {
          const stripped = batch.map(row => { const r = { ...row }; delete r[missingInflow]; return r })
          const { error: retryErr } = await supabase.from('inflow_transactions').insert(stripped)
          err = retryErr ?? null
          if (!errors.some(e => e.includes(missingInflow))) {
            errors.push(missingColMsg(missingInflow))
          }
        }
        if (err) {
          const msg = err.message.includes('invalid input syntax for type uuid')
            ? 'Schema error: ALTER TABLE inflow_transactions ALTER COLUMN transaction_ref TYPE text;'
            : `Inflow batch: ${err.message}`
          errors.push(msg); skipped += batch.length
        } else imported += batch.length
        setProgress(total > 0 ? Math.round(((i + batch.length) / total) * 50) : 50)
      }
      for (let i = 0; i < outflowToInsert.length; i += BATCH) {
        const batch = outflowToInsert.slice(i, i + BATCH)
        let { error: err } = await supabase.from('outflow_transactions').insert(batch)
        const missingOutflow = err?.message.match(/Could not find (?:the ')?(\w+)'? column/)?.[1]
        if (missingOutflow) {
          const stripped = batch.map(row => { const r = { ...row }; delete r[missingOutflow]; return r })
          const { error: retryErr } = await supabase.from('outflow_transactions').insert(stripped)
          err = retryErr ?? null
          if (!errors.some(e => e.includes(missingOutflow))) {
            errors.push(missingColMsg(missingOutflow))
          }
        }
        if (err) {
          const msg = err.message.includes('invalid input syntax for type uuid')
            ? 'Schema error: ALTER TABLE outflow_transactions ALTER COLUMN transaction_id TYPE text;'
            : `Outflow batch: ${err.message}`
          errors.push(msg); skipped += batch.length
        } else imported += batch.length
        setProgress(total > 0 ? 50 + Math.round(((i + batch.length) / total) * 50) : 100)
      }

      if (outflowToInsert.length > 0) {
        useTransactionSyncStore.getState().bumpOutflow()
      }

      setResult({ imported, skipped, errors, fallbackIdCount, collisions })
    }

    // ── FX transactions ───────────────────────────────────────────────────────
    if (targetTable === 'fx_transactions') {
      const colIdx = (field: string) => {
        const h = Object.keys(mapping).find(k => mapping[k] === field)
        return h !== undefined ? sheet.headers.indexOf(h) : -1
      }
      const dateIdx    = colIdx('date')
      const currIdx    = colIdx('currency')
      const depIdx     = colIdx('deposit')
      const wdIdx      = colIdx('withdrawal')
      const balIdx     = colIdx('running_balance')
      const narrIdx    = colIdx('narration')
      const refIdx     = colIdx('transaction_ref')

      const fxRows: Record<string, unknown>[] = []
      for (let ri = 0; ri < sheet.rows.length; ri++) {
        const raw  = sheet.rows[ri] as unknown[]
        const date = dateIdx >= 0 ? parseDate(raw[dateIdx], dateFormat) : null
        if (!date) { skipped++; continue }
        // Use standalone fxCurrency selector; column currency is fallback
        const currency = fxCurrency
          || (currIdx >= 0 && raw[currIdx] != null && raw[currIdx] !== ''
              ? String(raw[currIdx]).trim() : null)
        if (!currency) { skipped++; continue }
        const row: Record<string, unknown> = { date, currency }
        if (depIdx  >= 0) row.deposit          = parseNumber(raw[depIdx])
        if (wdIdx   >= 0) row.withdrawal        = parseNumber(raw[wdIdx])
        if (balIdx  >= 0) row.running_balance   = parseNumber(raw[balIdx])
        if (narrIdx >= 0 && raw[narrIdx] != null && raw[narrIdx] !== '') row.narration = String(raw[narrIdx]).trim()
        if (refIdx  >= 0 && raw[refIdx]  != null && raw[refIdx]  !== '') row.transaction_ref = String(raw[refIdx]).trim()
        if (userId) row.created_by = userId
        if (orgId)  row.org_id    = orgId
        if (internalBank) row.bank_name = internalBank.name
        fxRows.push(row)
      }

      const BATCH = 100
      for (let i = 0; i < fxRows.length; i += BATCH) {
        const batch = fxRows.slice(i, i + BATCH)
        const { error: err } = await supabase.from('fx_transactions').insert(batch)
        if (err) {
          errors.push(`FX batch: ${err.message}`); skipped += batch.length
        } else {
          imported += batch.length
        }
        setProgress(Math.round(((i + batch.length) / fxRows.length) * 100))
      }

      setResult({ imported, skipped, errors, fallbackIdCount, collisions })
    }
    } catch (e: unknown) {
      errors.push(e instanceof Error ? e.message : 'Unexpected error during import')
      setResult({ imported, skipped, errors, fallbackIdCount: 0, collisions: [] })
    } finally {
      setImporting(false)
    }
  }, [sheet, config, targetTable, mapping, user, skipTxnIds,
      dateFormat, fxCurrency, rowPendingDeductions,
      rowConfigs, rowManualOverrides, rowStageCodes, rowTxnTypes, rowOrigTxnIds, rowOutflowTypes,
      internalBank,
      rowIncomeTypes, incomeTypes,
      duplicateRis, precomputedInflowIds, precomputedOutflowIds])

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <>
    <Modal
      open={open}
      onClose={handleClose}
      title="Import Transactions"
      size="max-w-3xl"
      isDirty={isDirty}
      disableClose={isProcessing || navBlockShowing || confirmingReset}
      disableBackdropClose
      confirmTitle="Discard import progress?"
      confirmMessage="Current import setup and unsaved work will be lost."
      confirmKeepLabel="Continue Import"
      confirmDiscardLabel="Discard Changes"
      headerExtra={step > 1 ? (
        <button
          type="button"
          onClick={() => isDirty ? setConfirmingReset(true) : reset()}
          disabled={isProcessing}
          className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 px-2 py-1 rounded-lg hover:bg-gray-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <RefreshCw className="w-3 h-3" /> Reset
        </button>
      ) : undefined}
    >
      <div className="space-y-5">
        <StepDots step={step} />

        {/* ────────────────────────── STEP 1: Upload ───────────────────── */}
        {step === 1 && (
          <div className="space-y-4">
            <div
              onDragOver={e => { e.preventDefault(); setDragging(true) }}
              onDragLeave={() => setDragging(false)}
              onDrop={handleDrop}
              onClick={() => !parsing && inputRef.current?.click()}
              className={`border-2 border-dashed rounded-xl p-10 flex flex-col items-center gap-3 transition-colors ${
                parsing
                  ? 'border-primary bg-primary/5 cursor-wait'
                  : dragging
                    ? 'border-primary bg-primary/5 cursor-pointer'
                    : 'border-gray-300 hover:border-primary hover:bg-gray-50 cursor-pointer'
              }`}
            >
              <div className={`p-4 rounded-full transition-colors ${dragging || parsing ? 'bg-primary/10' : 'bg-gray-100'}`}>
                {parsing
                  ? <span className="block w-7 h-7 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                  : <Upload className={`w-7 h-7 ${dragging ? 'text-primary' : 'text-gray-400'}`} />
                }
              </div>
              <div className="text-center">
                <p className="text-sm font-medium text-gray-700">
                  {parsing
                    ? 'Parsing file…'
                    : <>Drop your file here, or <span className="text-primary underline">browse</span></>
                  }
                </p>
                <p className="text-xs text-gray-400 mt-1">Accepts .xlsx, .xls, and .pdf — max 20 MB</p>
              </div>
            </div>
            <input
              ref={inputRef}
              type="file"
              accept=".xlsx,.xls,.pdf"
              className="hidden"
              onChange={handleFileInput}
            />
            {parseErr && (
              <div className="flex items-center gap-2 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
                <AlertTriangle className="w-4 h-4 shrink-0" /> {parseErr}
              </div>
            )}
          </div>
        )}

        {/* Parsing spinner when preloaded file is being parsed at step 2 */}
        {step === 2 && parsing && (
          <div className="flex flex-col items-center gap-3 py-12">
            <span className="block w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            <p className="text-sm text-gray-500">Parsing {fileName}…</p>
          </div>
        )}

        {/* ─────────────────────── STEP 2: Sheet + Target ──────────────── */}
        {step === 2 && !parsing && sheets.length > 0 && (
          <div className="space-y-5">
            <div className="flex items-center gap-2 text-sm text-gray-500">
              {fileName.match(/\.pdf$/i)
                ? <FileText className="w-4 h-4 text-red-500" />
                : <FileSpreadsheet className="w-4 h-4 text-primary" />
              }
              <span className="font-medium text-gray-700">{fileName}</span>
              <span>·</span>
              <span>{sheets.length} sheet{sheets.length !== 1 ? 's' : ''} detected</span>
            </div>

            <div className="grid grid-cols-2 gap-4">
              {/* Sheet selector */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-gray-600">Worksheet</label>
                <select
                  value={selectedSheet}
                  onChange={e => setSelectedSheet(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-primary/30 bg-white"
                >
                  {sheets.map(s => (
                    <option key={s.name} value={s.name}>
                      {s.name} ({s.rowCount.toLocaleString()} rows)
                    </option>
                  ))}
                </select>
              </div>

              {/* Target table selector */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-gray-600">Import into table</label>
                {isForeignCurrencyBank ? (
                  <div className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg bg-gray-50 text-gray-500">
                    {TABLE_CONFIG.fx_transactions.label}
                    <span className="ml-2 text-[10px] font-semibold text-amber-600">(FX Bank — locked)</span>
                  </div>
                ) : (
                  <select
                    value={targetTable}
                    onChange={e => setTargetTable(e.target.value as TargetTable)}
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-primary/30 bg-white"
                  >
                    <option value="">— Select target table —</option>
                    {(Object.entries(TABLE_CONFIG) as [TargetTable, typeof TABLE_CONFIG[TargetTable]][]).map(
                      ([key, cfg]) => (
                        <option key={key} value={key}>{cfg.label}</option>
                      ),
                    )}
                  </select>
                )}
              </div>
            </div>

            {/* Bank selector — required for all import types */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-gray-600">Bank *</label>
              <select
                value={internalBank?.id ?? ''}
                onChange={e => {
                  const found = bankList.find(b => b.id === e.target.value)
                  setInternalBank(found ? { id: found.id, name: found.name } : null)
                }}
                className={`w-full px-3 py-2 text-sm border rounded-lg outline-none focus:ring-2 focus:ring-primary/30 bg-white ${
                  internalBank ? 'border-gray-300' : 'border-amber-300'
                }`}
              >
                <option value="">— Select bank —</option>
                {bankList.map(b => <option key={b.id} value={b.id}>{bankLabel(b)}</option>)}
              </select>
            </div>

            {/* Date format selector */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-gray-600">Date format in this file</label>
              <div className="flex gap-4">
                {(['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD'] as DateFormat[]).map(fmt => (
                  <label key={fmt} className="flex items-center gap-1.5 cursor-pointer text-sm text-gray-700">
                    <input
                      type="radio"
                      name="dateFormat"
                      value={fmt}
                      checked={dateFormat === fmt}
                      onChange={() => setDateFormat(fmt)}
                      className="text-primary focus:ring-primary/30"
                    />
                    {fmt}
                  </label>
                ))}
              </div>
            </div>

            {/* FX Currency — only for fx_transactions */}
            {targetTable === 'fx_transactions' && (
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-gray-600">FX Currency *</label>
                <select
                  value={fxCurrency}
                  onChange={e => setFxCurrency(e.target.value)}
                  className={`w-full px-3 py-2 text-sm border rounded-lg outline-none focus:ring-2 focus:ring-primary/30 bg-white ${
                    fxCurrency ? 'border-gray-300' : 'border-amber-300'
                  }`}
                >
                  <option value="">— Select currency —</option>
                  {foreignCurrencies.map(c => (
                    <option key={c.code} value={c.code}>{c.code} — {c.name}</option>
                  ))}
                </select>
                {!fxCurrency && (
                  <p className="text-xs text-amber-600 flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" /> Select an FX currency before importing.
                  </p>
                )}
              </div>
            )}

            {/* Preview table */}
            {sheet && (
              <div>
                <p className="text-xs font-medium text-gray-500 mb-2">
                  Preview — first {Math.min(5, preview.length)} rows
                </p>
                <div className="overflow-x-auto border border-gray-200 rounded-lg text-xs">
                  <table className="min-w-full">
                    <thead>
                      <tr className="bg-gray-50">
                        {sheet.headers.map(h => (
                          <th key={h} className="px-3 py-2 text-left font-semibold text-gray-500 whitespace-nowrap border-r border-gray-100 last:border-0">
                            {h || '(blank)'}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {preview.map((row, ri) => (
                        <tr key={ri}>
                          {sheet.headers.map((_, ci) => (
                            <td key={ci} className="px-3 py-1.5 text-gray-600 whitespace-nowrap border-r border-gray-50 last:border-0 max-w-[150px] truncate">
                              {String(row[ci] ?? '')}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <NavButtons
              step={step}
              onBack={preloadedFile ? undefined : () => { setStep(1); setSheets([]); setFileName('') }}
              onNext={proceedToMapping}
              nextDisabled={!targetTable || !selectedSheet || !internalBank || (targetTable === 'fx_transactions' && !fxCurrency)}
              nextLabel="Map Columns"
            />
          </div>
        )}

        {/* ─────────────────────── STEP 3: Column Mapping ──────────────── */}
        {step === 3 && sheet && config && (
          <div className="space-y-4">

            {/* Persistent bank bar */}
            <div className="flex items-center gap-3 rounded-lg bg-gray-50 border border-gray-200 px-3 py-2">
              <span className="text-xs font-medium text-gray-500 shrink-0">Bank</span>
              <select
                value={internalBank?.id ?? ''}
                onChange={e => {
                  const found = bankList.find(b => b.id === e.target.value)
                  setInternalBank(found ? { id: found.id, name: found.name } : null)
                }}
                className={`flex-1 text-xs px-2 py-1.5 border rounded-lg outline-none focus:ring-2 focus:ring-primary/30 bg-white ${
                  internalBank ? 'border-gray-300' : 'border-amber-400'
                }`}
              >
                <option value="">— Select bank —</option>
                {bankList.map(b => <option key={b.id} value={b.id}>{bankLabel(b)}</option>)}
              </select>
              {internalBank && (
                <span className="text-xs font-semibold text-primary shrink-0">{internalBank.name}</span>
              )}
            </div>

            <p className="text-sm text-gray-600">
              Map each spreadsheet column to an app field.
              Smart defaults have been applied where column names match.
            </p>

            <div className="border border-gray-200 rounded-xl overflow-hidden">
              <div className="grid grid-cols-2 bg-gray-50 px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase border-b border-gray-200">
                <span>Spreadsheet Column</span>
                <span>App Field</span>
              </div>
              <div className="divide-y divide-gray-100 max-h-72 overflow-y-auto">
                {sheet.headers.filter(h => h).map(h => (
                  <div key={h} className="grid grid-cols-2 items-center px-4 py-2.5 gap-3">
                    <div className="text-sm font-medium text-gray-700 truncate" title={h}>{h}</div>
                    <select
                      value={mapping[h] ?? SKIP}
                      onChange={e => setMapping(prev => ({ ...prev, [h]: e.target.value }))}
                      className={`text-xs px-2 py-1.5 border rounded-lg outline-none focus:ring-2 focus:ring-primary/30 bg-white ${
                        mapping[h] && mapping[h] !== SKIP ? 'border-primary/40 text-gray-800' : 'border-gray-200 text-gray-400'
                      }`}
                    >
                      <option value={SKIP}>— Skip this column —</option>
                      {config.fields.map(f => (
                        <option key={f.key} value={f.key}>
                          {f.label}{f.required ? ' *' : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            </div>

            {/* Required field check */}
            {(() => {
              const mappedFields = new Set(Object.values(mapping))
              const missing = config.fields.filter(f => {
                if (!f.required) return false
                if (f.key === 'currency' && fxCurrency) return false
                return !mappedFields.has(f.key)
              })
              return missing.length > 0 ? (
                <div className="flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-700">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>Required fields not mapped: <strong>{missing.map(f => f.label).join(', ')}</strong></span>
                </div>
              ) : null
            })()}

            <NavButtons
              step={step}
              onBack={() => setStep(2)}
              onNext={targetTable === 'bank_statement' ? proceedToRowConfig : proceedToImport}
              nextDisabled={(() => {
                const mappedFields = new Set(Object.values(mapping))
                return config.fields.some(f => {
                  if (!f.required) return false
                  if (f.key === 'currency' && fxCurrency) return false
                  return !mappedFields.has(f.key)
                }) || dupCheckLoading
              })()}
              nextLoading={dupCheckLoading}
              nextLabel={targetTable === 'bank_statement'
                ? dupCheckLoading
                  ? 'Checking for duplicates…'
                  : `Configure Rows (${sheet.rowCount.toLocaleString()})`
                : `Preview & Import (${sheet.rowCount.toLocaleString()} rows)`}
            />
          </div>
        )}

        {/* ─────────────────────── STEP 4: Configure Rows ─────────────── */}
        {step === 4 && sheet && config && targetTable === 'bank_statement' && (
          <div className="space-y-5">

            {/* Persistent bank bar */}
            <div className="flex items-center gap-3 rounded-lg bg-gray-50 border border-gray-200 px-3 py-2">
              <span className="text-xs font-medium text-gray-500 shrink-0">Bank</span>
              <select
                value={internalBank?.id ?? ''}
                onChange={e => {
                  const found = bankList.find(b => b.id === e.target.value)
                  setInternalBank(found ? { id: found.id, name: found.name } : null)
                }}
                className={`flex-1 text-xs px-2 py-1.5 border rounded-lg outline-none focus:ring-2 focus:ring-primary/30 bg-white ${
                  internalBank ? 'border-gray-300' : 'border-amber-400'
                }`}
              >
                <option value="">— Select bank —</option>
                {bankList.map(b => <option key={b.id} value={b.id}>{bankLabel(b)}</option>)}
              </select>
              {internalBank && (
                <span className="text-xs font-semibold text-primary shrink-0">{internalBank.name}</span>
              )}
            </div>

            {/* ── Foreign Currency Bank notice ─────────────────────────── */}
            {isForeignCurrencyBank && (
              <div className="flex items-start gap-2 rounded-lg bg-blue-50 border border-blue-200 px-4 py-3 text-xs text-blue-700">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>
                  <strong>Foreign Currency Bank</strong> — Credit rows will be imported as <strong>FX Inflow</strong> and debit rows as <strong>FX Outflow</strong>. Standard transaction types are not available for this bank.
                </span>
              </div>
            )}

            {/* ── Duplicate detection summary ───────────────────────────── */}
            {dupStats && (
              <div className={`rounded-lg border px-4 py-3 text-sm ${
                dupStats.dupCount > 0
                  ? 'bg-amber-50 border-amber-200'
                  : 'bg-green-50 border-green-200'
              }`}>
                <div className="flex items-center justify-between">
                  <div className={`flex items-center gap-2 font-medium ${
                    dupStats.dupCount > 0 ? 'text-amber-800' : 'text-green-700'
                  }`}>
                    {dupStats.dupCount > 0
                      ? <AlertTriangle className="w-4 h-4 shrink-0" />
                      : <CheckCircle2 className="w-4 h-4 shrink-0" />
                    }
                    {dupStats.dupCount > 0
                      ? `${dupStats.total} rows · ${dupStats.dupCount} already in database · ${dupStats.newCount} new to configure`
                      : `${dupStats.total} rows · all new — no duplicates found`
                    }
                  </div>
                  {dupStats.dupCount > 0 && (
                    <button
                      type="button"
                      onClick={() => setDupSkipOpen(o => !o)}
                      className="text-xs text-amber-600 hover:text-amber-800 underline ml-3 shrink-0"
                    >
                      {dupSkipOpen ? 'Hide skipped' : 'View skipped'}
                    </button>
                  )}
                </div>
                {dupStats.dupCount > 0 && dupSkipOpen && (() => {
                  const _dateIdx   = sheet.headers.findIndex(h => mapping[h] === 'date')
                  const _descIdx   = sheet.headers.findIndex(h => mapping[h] === 'description')
                  const _creditIdx = sheet.headers.findIndex(h => mapping[h] === 'credit')
                  const _debitIdx  = sheet.headers.findIndex(h => mapping[h] === 'debit')
                  return (
                    <div className="mt-3 pt-3 border-t border-amber-200 space-y-1 max-h-48 overflow-y-auto">
                      {[...duplicateRis].sort((a, b) => a - b).map(ri => {
                        const raw    = (processedRows ?? sheet.rows)[ri] as unknown[]
                        const date   = _dateIdx   >= 0 ? (parseDate(raw[_dateIdx],   dateFormat) ?? '') : ''
                        const desc   = _descIdx   >= 0 && raw[_descIdx] != null ? String(raw[_descIdx]).trim() : ''
                        const credit = _creditIdx >= 0 ? parseNumber(raw[_creditIdx]) : 0
                        const debit  = _debitIdx  >= 0 ? parseDebitAmount(raw[_debitIdx]) : 0
                        return (
                          <div key={ri} className="flex items-center gap-3 text-xs text-amber-700 py-1 border-b border-amber-100 last:border-0">
                            <span className="font-mono text-amber-400 shrink-0 w-5 text-right">{ri + 1}</span>
                            <span className="text-amber-500 shrink-0">{date}</span>
                            <span className="truncate flex-1 min-w-0">{desc || '—'}</span>
                            {credit > 0 && <span className="tabular-nums shrink-0 text-green-700">+{baseCurrencySymbol}{credit.toLocaleString()}</span>}
                            {debit  > 0 && <span className="tabular-nums shrink-0 text-red-700">−{baseCurrencySymbol}{debit.toLocaleString()}</span>}
                          </div>
                        )
                      })}
                    </div>
                  )
                })()}
              </div>
            )}

            {/* Tabs + view toggle */}
            <div className="flex items-center justify-between border-b border-gray-200">
              <div className="flex">
                {(['inflow', 'outflow'] as const).map(tab => (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => setBsConfigTab(tab)}
                    className={`px-5 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                      bsConfigTab === tab
                        ? 'border-primary text-primary'
                        : 'border-transparent text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    {tab === 'inflow' ? 'Credit (Inflow)' : 'Debit (Outflow)'}
                  </button>
                ))}
              </div>
              <div className="pb-1 pr-1">
                <ViewToggle storageKey="import-step4-view" value={importRowView} onChange={setImportRowView} />
              </div>
            </div>

            {(() => {
              const dateIdx   = sheet.headers.findIndex(h => mapping[h] === 'date')
              const descIdx   = sheet.headers.findIndex(h => mapping[h] === 'description')
              const creditIdx = sheet.headers.findIndex(h => mapping[h] === 'credit')
              const debitIdx  = sheet.headers.findIndex(h => mapping[h] === 'debit')

              const availableInflowTypes  = isForeignCurrencyBank ? FX_INFLOW_TYPES  : TXN_TYPE_OPTIONS
              const availableOutflowTypes = isForeignCurrencyBank ? FX_OUTFLOW_TYPES : TXN_TYPE_OPTIONS

              const allRows = (processedRows ?? sheet.rows).map((raw, ri) => {
                const r = raw as unknown[]
                return {
                  ri,
                  raw: r,
                  credit: creditIdx >= 0 ? parseNumber(r[creditIdx])      : 0,
                  debit:  debitIdx  >= 0 ? parseDebitAmount(r[debitIdx]) : 0,
                }
              })
              // Exclude duplicate rows — identified by DB check before Step 4 opened.
              // Only genuinely new transactions are shown for configuration.
              const creditRows = allRows.filter(r => r.credit > 0 && !duplicateRis.has(r.ri))
              const debitRows  = allRows.filter(r => r.debit  > 0 && !duplicateRis.has(r.ri))

              // ── Inflow tab ───────────────────────────────────────────────
              if (bsConfigTab === 'inflow') {
                const f = inflowFilter
                const filtered = creditRows.filter(({ raw, credit }) => {
                  const desc = descIdx >= 0 && raw[descIdx] != null ? String(raw[descIdx]).toLowerCase() : ''
                  if (f.desc    && !desc.includes(f.desc.toLowerCase())) return false
                  if (f.amtFrom && credit < parseFloat(f.amtFrom))       return false
                  if (f.amtTo   && credit > parseFloat(f.amtTo))         return false
                  return true
                })
                const isFiltered = filtered.length < creditRows.length

                return (
                  <div className="space-y-3">
                    {/* Filter bar */}
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        type="text"
                        placeholder="Search description…"
                        value={f.desc}
                        onChange={e => setInflowFilter(p => ({ ...p, desc: e.target.value }))}
                        className="flex-1 min-w-[160px] text-xs px-3 py-1.5 border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-primary/30 bg-white"
                      />
                      <span className="text-xs text-gray-400">Amount</span>
                      <input type="number" placeholder="from" value={f.amtFrom}
                        onChange={e => setInflowFilter(p => ({ ...p, amtFrom: e.target.value }))}
                        className="w-24 text-xs px-2 py-1.5 border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-primary/30 bg-white"
                      />
                      <input type="number" placeholder="to" value={f.amtTo}
                        onChange={e => setInflowFilter(p => ({ ...p, amtTo: e.target.value }))}
                        className="w-24 text-xs px-2 py-1.5 border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-primary/30 bg-white"
                      />
                      <button type="button" onClick={() => setInflowFilter({ desc: '', amtFrom: '', amtTo: '' })}
                        className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1.5 border border-gray-200 rounded-lg bg-white">
                        Clear
                      </button>
                      <span className="text-xs text-gray-400 ml-auto">
                        {filtered.length} / {creditRows.length} rows
                        {selectedInflowRis.size > 0 && (
                          <> · <span className="text-primary font-medium">{selectedInflowRis.size} selected</span></>
                        )}
                      </span>
                    </div>

                    {/* Apply bar */}
                    {(() => {
                      const inflowTargetRis = selectedInflowRis.size > 0
                        ? [...selectedInflowRis]
                        : filtered.map(r => r.ri)
                      const inflowTargetLabel = selectedInflowRis.size > 0
                        ? `${selectedInflowRis.size} selected`
                        : isFiltered ? `${filtered.length} filtered` : 'all'
                      return (
                    <div className="flex flex-wrap items-center gap-2 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
                      <span className="text-xs text-gray-500 shrink-0 whitespace-nowrap">
                        Apply to {inflowTargetLabel} rows:
                      </span>
                      <select value={applyInflowConfig} onChange={e => {
                          if (e.target.value === '__create__') { setCreateConfigPendingRow('apply'); setApplyInflowConfig('') }
                          else setApplyInflowConfig(e.target.value)
                        }}
                        className="flex-1 text-xs px-2 py-1.5 border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-primary/30 bg-white min-w-[120px]">
                        <option value="">— Allocation Config —</option>
                        <option value="__general__">General (date-based)</option>
                        {applyBarSpecialConfigs.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                        <option value="__create__">＋ Create New Config…</option>
                      </select>
                      {incomeTypes.length > 0 && (
                        <SearchableSelect value={applyIncomeType} onChange={setApplyIncomeType}
                          options={incomeTypes.map(t => ({ value: t.id, label: t.name }))}
                          placeholder="— Income Type —"
                          className="text-xs px-2 py-1.5 border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-primary/30 bg-white"
                          wrapperClassName="flex-1 min-w-[110px]" />
                      )}
                      <select value={batchTxnType} onChange={e => setBatchTxnType(e.target.value)}
                        className="text-xs px-2 py-1.5 border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-primary/30 bg-white">
                        <option value="">— Type —</option>
                        {availableInflowTypes.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                      <button
                        type="button"
                        disabled={(!applyInflowConfig && !applyIncomeType && !batchTxnType) || inflowTargetRis.length === 0}
                        onClick={() => {
                          if (applyInflowConfig) {
                            // Explicit config selection → mark affected rows as manual overrides
                            const configVal = applyInflowConfig === '__general__' ? '' : applyInflowConfig
                            setRowConfigs(prev => {
                              const next = { ...prev }
                              for (const ri of inflowTargetRis) next[ri] = configVal
                              return next
                            })
                            setRowManualOverrides(prev => {
                              const next = { ...prev }
                              for (const ri of inflowTargetRis) next[ri] = true
                              return next
                            })
                          }
                          if (applyIncomeType) {
                            setRowIncomeTypes(prev => {
                              const next = { ...prev }
                              for (const ri of inflowTargetRis) next[ri] = applyIncomeType
                              return next
                            })
                            if (!applyInflowConfig) {
                              // Income type only — clear manual overrides so linked config auto-applies
                              setRowManualOverrides(prev => {
                                const next = { ...prev }
                                for (const ri of inflowTargetRis) delete next[ri]
                                return next
                              })
                            }
                          }
                          if (batchTxnType !== '') {
                            setRowTxnTypes(prev => {
                              const next = { ...prev }
                              for (const ri of inflowTargetRis) next[ri] = batchTxnType
                              return next
                            })
                          }
                        }}
                        className="px-3 py-1.5 text-xs font-medium bg-primary text-white rounded-lg hover:bg-primary-light disabled:opacity-50"
                      >
                        Apply
                      </button>
                    </div>
                      )
                    })()}

                    {/* Row table */}
                    {(() => {
                      const allInflowFilteredSelected = filtered.length > 0 && filtered.every(({ ri }) => selectedInflowRis.has(ri))
                      const someInflowFilteredSelected = filtered.some(({ ri }) => selectedInflowRis.has(ri))

                      // Shared row-data extractor used by both table and card views
                      const buildInflowRowData = (ri: number, raw: unknown[]) => {
                        const date    = dateIdx >= 0 ? (parseDate(raw[dateIdx], dateFormat) ?? '') : ''
                        const desc    = descIdx >= 0 && raw[descIdx] != null ? String(raw[descIdx]).trim() : ''
                        const txnType = rowTxnTypes[ri] ?? ''
                        const origId  = rowOrigTxnIds[ri] ?? ''
                        const autoType        = autoClassifiedTypes[ri] ?? null
                        const effIncomeTypeId = rowIncomeTypes[ri] ?? autoType?.id ?? ''
                        const effIncomeType   = incomeTypes.find(t => t.id === effIncomeTypeId) ?? null
                        const rowState: RowResolverState = {
                          incomeType:         effIncomeType,
                          allocationConfigId: rowConfigs[ri] ?? '',
                          isManualOverride:   rowManualOverrides[ri] ?? false,
                        }
                        const displaySelId = getFinalConfig(
                          rowState,
                          '',
                          (groupId) => getSpecialConfigVersionForDate(allocConfigs, groupId, date || new Date().toISOString().slice(0, 10))?.id ?? null,
                        ) ?? ''
                        return { date, desc, txnType, origId, autoType, effIncomeTypeId, effIncomeType, displaySelId }
                      }

                      return importRowView === 'table' ? (
                    <div className="border border-gray-200 rounded-xl overflow-hidden">
                      <div className="grid grid-cols-[24px_32px_1fr_72px_120px_120px_96px] bg-gray-50 px-3 py-2 text-xs font-semibold text-gray-500 border-b border-gray-200">
                        <input
                          type="checkbox"
                          checked={allInflowFilteredSelected}
                          ref={el => { if (el) el.indeterminate = someInflowFilteredSelected && !allInflowFilteredSelected }}
                          onChange={e => {
                            setSelectedInflowRis(prev => {
                              const next = new Set(prev)
                              if (e.target.checked) filtered.forEach(({ ri }) => next.add(ri))
                              else filtered.forEach(({ ri }) => next.delete(ri))
                              return next
                            })
                          }}
                          className="w-3.5 h-3.5 rounded border-gray-300 text-primary focus:ring-primary/30 cursor-pointer"
                        />
                        <span>#</span><span>Description / Date</span><span>Amount</span><span>Allocation Config</span><span>Income Type</span><span>Type</span>
                      </div>
                      <div className="max-h-[340px] overflow-y-auto divide-y divide-gray-100">
                        {filtered.length === 0
                          ? <div className="py-8 text-center text-xs text-gray-400">No credit rows match the filter</div>
                          : filtered.map(({ ri, raw, credit }) => {
                              const { date, desc, txnType, origId, autoType, effIncomeTypeId, effIncomeType, displaySelId } = buildInflowRowData(ri, raw)
                              const isInflowSelected = selectedInflowRis.has(ri)
                              return (
                                <div key={ri} className={isInflowSelected ? 'bg-primary/5' : undefined}>
                                  <div className="grid grid-cols-[24px_32px_1fr_72px_120px_120px_96px] items-center px-3 py-2 gap-2 text-xs">
                                    <input
                                      type="checkbox"
                                      checked={isInflowSelected}
                                      onChange={e => {
                                        setSelectedInflowRis(prev => {
                                          const next = new Set(prev)
                                          e.target.checked ? next.add(ri) : next.delete(ri)
                                          return next
                                        })
                                      }}
                                      className="w-3.5 h-3.5 rounded border-gray-300 text-primary focus:ring-primary/30 cursor-pointer"
                                    />
                                    <span className="text-gray-400 font-mono">{ri + 1}</span>
                                    <div className="min-w-0">
                                      <div
                                        className="flex items-center"
                                        onMouseEnter={e => {
                                          if (!desc) return
                                          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
                                          const spaceBelow = window.innerHeight - rect.bottom
                                          setTooltipState({ text: desc, x: rect.left, y: spaceBelow >= 80 ? rect.bottom + 4 : rect.top - 4 })
                                        }}
                                        onMouseLeave={() => setTooltipState(null)}
                                      >
                                        <span className="text-gray-700 truncate">{desc || '—'}</span>
                                      </div>
                                      <div className="text-gray-400">{date}</div>
                                    </div>
                                    <span className="text-gray-700 font-medium">{baseCurrencySymbol}{credit.toLocaleString()}</span>
                                    {txnType ? (
                                      <span className="text-xs text-gray-400 italic">N/A</span>
                                    ) : (
                                      <select value={displaySelId}
                                        onChange={e => {
                                          if (e.target.value === '__create__') {
                                            setCreateConfigPendingRow(ri)
                                          } else {
                                            setRowConfigs(prev => ({ ...prev, [ri]: e.target.value }))
                                            setRowManualOverrides(prev => ({ ...prev, [ri]: true }))
                                          }
                                        }}
                                        className="text-xs px-2 py-1 border border-gray-200 rounded outline-none focus:ring-2 focus:ring-primary/30 bg-white w-full">
                                        <option value="">General (date-based)</option>
                                        {specialConfigs.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                                        {displaySelId && !specialConfigs.some(c => c.id === displaySelId) && (() => {
                                          const extra = allocConfigs.find(c => c.id === displaySelId)
                                          return extra ? <option key={extra.id} value={extra.id}>{extra.name}</option> : null
                                        })()}
                                        <option value="__create__">＋ Create New Config…</option>
                                      </select>
                                    )}
                                    {txnType ? (
                                      <span className="text-xs text-gray-600 px-1">
                                        {TXN_TYPE_OPTIONS.find(o => o.value === txnType)?.label ?? txnType}
                                      </span>
                                    ) : (
                                      <div className="relative">
                                        <SearchableSelect
                                          value={effIncomeTypeId}
                                          onChange={newId => {
                                            setRowIncomeTypes(prev => ({ ...prev, [ri]: newId }))
                                            setRowManualOverrides(prev => {
                                              const next = { ...prev }
                                              delete next[ri]
                                              return next
                                            })
                                          }}
                                          options={incomeTypes.map(t => ({ value: t.id, label: t.name }))}
                                          placeholder="— None —"
                                          className="text-xs px-2 py-1 border border-gray-200 rounded outline-none focus:ring-2 focus:ring-primary/30 bg-white w-full"
                                        />
                                        {autoType && !rowIncomeTypes[ri] && (
                                          <Sparkles className="pointer-events-none absolute right-5 top-1/2 -translate-y-1/2 w-3 h-3 text-indigo-400" />
                                        )}
                                        {effIncomeType && (
                                          <span
                                            className="pointer-events-none absolute left-1.5 top-1/2 -translate-y-1/2 w-2 h-2 rounded-full"
                                            style={{ background: effIncomeType.color }}
                                          />
                                        )}
                                      </div>
                                    )}
                                    <select value={txnType}
                                      onChange={e => setRowTxnTypes(prev => ({ ...prev, [ri]: e.target.value }))}
                                      disabled={isForeignCurrencyBank}
                                      className="text-xs px-2 py-1 border border-gray-200 rounded outline-none focus:ring-2 focus:ring-primary/30 bg-white w-full">
                                      {availableInflowTypes.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                                    </select>
                                  </div>
                                  {(txnType === 'refund' || txnType === 'reversal') && (
                                    <div className="px-3 pb-2 flex items-center gap-2">
                                      <span className="text-[10px] text-gray-400 w-28 shrink-0">Original Txn ID:</span>
                                      <input type="text" value={origId}
                                        onChange={e => setRowOrigTxnIds(prev => ({ ...prev, [ri]: e.target.value }))}
                                        placeholder="ID of original transaction"
                                        className="flex-1 text-xs px-2 py-1 border border-gray-200 rounded outline-none focus:ring-2 focus:ring-primary/30 bg-white"
                                      />
                                    </div>
                                  )}
                                </div>
                              )
                            })
                        }
                      </div>
                    </div>
                      ) : (
                    /* ── Card view ── */
                    <>
                      {filtered.length > 0 && (
                        <div className="flex items-center gap-2 px-1 pb-1">
                          <input
                            type="checkbox"
                            checked={allInflowFilteredSelected}
                            ref={el => { if (el) el.indeterminate = someInflowFilteredSelected && !allInflowFilteredSelected }}
                            onChange={e => {
                              setSelectedInflowRis(prev => {
                                const next = new Set(prev)
                                if (e.target.checked) filtered.forEach(({ ri }) => next.add(ri))
                                else filtered.forEach(({ ri }) => next.delete(ri))
                                return next
                              })
                            }}
                            className="w-3.5 h-3.5 rounded border-gray-300 text-primary focus:ring-primary/30 cursor-pointer shrink-0"
                          />
                          <span className="text-xs text-gray-500 select-none">
                            {allInflowFilteredSelected
                              ? `All ${filtered.length} selected`
                              : someInflowFilteredSelected
                                ? `${filtered.filter(({ ri }) => selectedInflowRis.has(ri)).length} of ${filtered.length} selected`
                                : `Select all ${filtered.length}`}
                          </span>
                        </div>
                      )}
                      <div className="space-y-3 max-h-[480px] overflow-y-auto pr-0.5">
                      {filtered.length === 0
                        ? <div className="py-8 text-center text-xs text-gray-400">No credit rows match the filter</div>
                        : filtered.map(({ ri, raw, credit }) => {
                            const { date, desc, txnType, origId, autoType, effIncomeTypeId, effIncomeType, displaySelId } = buildInflowRowData(ri, raw)
                            const isInflowSelected = selectedInflowRis.has(ri)
                            const isExpanded = expandedInflowCardRis.has(ri)
                            const configName = displaySelId
                              ? (allocConfigs.find(c => c.id === displaySelId)?.name ?? 'Config')
                              : 'General'
                            const typeName = txnType
                              ? (TXN_TYPE_OPTIONS.find(o => o.value === txnType)?.label ?? txnType)
                              : ''
                            return (
                              <div key={ri} className={`rounded-xl border overflow-hidden shadow-sm bg-white ${
                                isInflowSelected ? 'border-primary/40' : 'border-gray-200'
                              } ${isInflowSelected ? 'bg-primary/5' : ''}`}>
                                {/* Section 1 — header body */}
                                <div className="px-4 pt-3.5 pb-3">
                                  <div className="flex items-center justify-between mb-1.5">
                                    <div className="flex items-center gap-2 min-w-0">
                                      <input
                                        type="checkbox"
                                        checked={isInflowSelected}
                                        onChange={e => {
                                          setSelectedInflowRis(prev => {
                                            const next = new Set(prev)
                                            e.target.checked ? next.add(ri) : next.delete(ri)
                                            return next
                                          })
                                        }}
                                        className="w-4 h-4 rounded border-gray-300 text-primary focus:ring-primary/30 cursor-pointer shrink-0"
                                      />
                                      <span className="text-[10px] font-mono text-gray-400 shrink-0">#{ri + 1}</span>
                                      {date && <span className="text-[11px] font-semibold text-gray-400 truncate">{date}</span>}
                                    </div>
                                    <span className="text-sm font-mono font-bold text-success tabular-nums shrink-0 ml-2">
                                      {baseCurrencySymbol}{credit.toLocaleString()}
                                    </span>
                                  </div>
                                  <p className="text-sm text-gray-700 line-clamp-2 leading-snug">
                                    {desc || <span className="text-gray-400">—</span>}
                                  </p>
                                </div>
                                {/* Section 2 — meta / controls */}
                                <div className="border-t border-gray-100">
                                  {!isExpanded ? (
                                    <button
                                      type="button"
                                      onClick={() => setExpandedInflowCardRis(prev => { const s = new Set(prev); s.add(ri); return s })}
                                      className="w-full flex items-center justify-between px-4 py-2.5 bg-gray-50/40 text-xs text-gray-500 hover:bg-gray-50 transition-colors text-left"
                                    >
                                      <span className="truncate min-w-0 mr-2">
                                        {configName}
                                        {effIncomeType ? ` · ${effIncomeType.name}` : ''}
                                        {typeName ? ` · ${typeName}` : ''}
                                      </span>
                                      <ChevronRight className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                                    </button>
                                  ) : (
                                    <div className="px-4 py-3 bg-gray-50/40 space-y-3">
                                      {/* Allocation Config */}
                                      <div>
                                        <label className="text-[10px] uppercase tracking-wide font-semibold text-gray-400 mb-1 block">Allocation Config</label>
                                        {txnType ? (
                                          <span className="text-xs text-gray-400 italic">N/A for {TXN_TYPE_OPTIONS.find(o => o.value === txnType)?.label}</span>
                                        ) : (
                                          <select value={displaySelId}
                                            onChange={e => {
                                              if (e.target.value === '__create__') {
                                                setCreateConfigPendingRow(ri)
                                              } else {
                                                setRowConfigs(prev => ({ ...prev, [ri]: e.target.value }))
                                                setRowManualOverrides(prev => ({ ...prev, [ri]: true }))
                                              }
                                            }}
                                            className="w-full text-xs px-2 py-1.5 border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-primary/30 bg-white">
                                            <option value="">General (date-based)</option>
                                            {specialConfigs.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                                            {displaySelId && !specialConfigs.some(c => c.id === displaySelId) && (() => {
                                              const extra = allocConfigs.find(c => c.id === displaySelId)
                                              return extra ? <option key={extra.id} value={extra.id}>{extra.name}</option> : null
                                            })()}
                                            <option value="__create__">＋ Create New Config…</option>
                                          </select>
                                        )}
                                      </div>
                                      {/* Income Type */}
                                      {!txnType && (
                                        <div>
                                          <label className="text-[10px] uppercase tracking-wide font-semibold text-gray-400 mb-1 block">Income Type</label>
                                          <div className="relative">
                                            <SearchableSelect
                                              value={effIncomeTypeId}
                                              onChange={newId => {
                                                setRowIncomeTypes(prev => ({ ...prev, [ri]: newId }))
                                                setRowManualOverrides(prev => {
                                                  const next = { ...prev }
                                                  delete next[ri]
                                                  return next
                                                })
                                              }}
                                              options={incomeTypes.map(t => ({ value: t.id, label: t.name }))}
                                              placeholder="— None —"
                                              className="w-full text-xs px-2 py-1.5 border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-primary/30 bg-white"
                                            />
                                            {autoType && !rowIncomeTypes[ri] && (
                                              <Sparkles className="pointer-events-none absolute right-7 top-1/2 -translate-y-1/2 w-3 h-3 text-indigo-400" />
                                            )}
                                            {effIncomeType && (
                                              <span
                                                className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 w-2 h-2 rounded-full"
                                                style={{ background: effIncomeType.color }}
                                              />
                                            )}
                                          </div>
                                        </div>
                                      )}
                                      {/* Transaction Type */}
                                      <div>
                                        <label className="text-[10px] uppercase tracking-wide font-semibold text-gray-400 mb-1 block">Transaction Type</label>
                                        <select value={txnType}
                                          onChange={e => setRowTxnTypes(prev => ({ ...prev, [ri]: e.target.value }))}
                                          disabled={isForeignCurrencyBank}
                                          className="w-full text-xs px-2 py-1.5 border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-primary/30 bg-white">
                                          {availableInflowTypes.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                                        </select>
                                      </div>
                                      {/* Original Txn ID */}
                                      {(txnType === 'refund' || txnType === 'reversal') && (
                                        <div>
                                          <label className="text-[10px] uppercase tracking-wide font-semibold text-gray-400 mb-1 block">Original Txn ID</label>
                                          <input type="text" value={origId}
                                            onChange={e => setRowOrigTxnIds(prev => ({ ...prev, [ri]: e.target.value }))}
                                            placeholder="ID of original transaction"
                                            className="w-full text-xs px-2 py-1.5 border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-primary/30 bg-white"
                                          />
                                        </div>
                                      )}
                                      <button
                                        type="button"
                                        onClick={() => setExpandedInflowCardRis(prev => { const s = new Set(prev); s.delete(ri); return s })}
                                        className="w-full flex items-center justify-center gap-1 text-xs text-gray-400 hover:text-gray-600 pt-1"
                                      >
                                        <ChevronDown className="w-3.5 h-3.5 rotate-180" />
                                        Less
                                      </button>
                                    </div>
                                  )}
                                </div>
                              </div>
                            )
                          })
                      }
                    </div>
                    </>
                      )
                    })()}
                  </div>
                )
              }

              // ── Outflow tab ──────────────────────────────────────────────
              const f = outflowFilter
              const filtered = debitRows.filter(({ raw, debit }) => {
                const desc = descIdx >= 0 && raw[descIdx] != null ? String(raw[descIdx]).toLowerCase() : ''
                if (f.desc    && !desc.includes(f.desc.toLowerCase())) return false
                if (f.amtFrom && debit < parseFloat(f.amtFrom))        return false
                if (f.amtTo   && debit > parseFloat(f.amtTo))          return false
                return true
              })
              const isFiltered = filtered.length < debitRows.length

              return (
                <div className="space-y-3">
                  {/* Filter bar */}
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      type="text"
                      placeholder="Search description…"
                      value={f.desc}
                      onChange={e => setOutflowFilter(p => ({ ...p, desc: e.target.value }))}
                      className="flex-1 min-w-[160px] text-xs px-3 py-1.5 border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-primary/30 bg-white"
                    />
                    <span className="text-xs text-gray-400">Amount</span>
                    <input type="number" placeholder="from" value={f.amtFrom}
                      onChange={e => setOutflowFilter(p => ({ ...p, amtFrom: e.target.value }))}
                      className="w-24 text-xs px-2 py-1.5 border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-primary/30 bg-white"
                    />
                    <input type="number" placeholder="to" value={f.amtTo}
                      onChange={e => setOutflowFilter(p => ({ ...p, amtTo: e.target.value }))}
                      className="w-24 text-xs px-2 py-1.5 border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-primary/30 bg-white"
                    />
                    <button type="button" onClick={() => setOutflowFilter({ desc: '', amtFrom: '', amtTo: '' })}
                      className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1.5 border border-gray-200 rounded-lg bg-white">
                      Clear
                    </button>
                    <span className="text-xs text-gray-400 ml-auto">
                      {filtered.length} / {debitRows.length} rows
                      {selectedOutflowRis.size > 0 && (
                        <> · <span className="text-primary font-medium">{selectedOutflowRis.size} selected</span></>
                      )}
                    </span>
                  </div>

                  {/* Apply bar */}
                  {(() => {
                    const outflowTargetRis = selectedOutflowRis.size > 0
                      ? [...selectedOutflowRis]
                      : filtered.map(r => r.ri)
                    const outflowTargetLabel = selectedOutflowRis.size > 0
                      ? `${selectedOutflowRis.size} selected`
                      : isFiltered ? `${filtered.length} filtered` : 'all'
                    return (
                  <div className="flex flex-wrap items-center gap-2 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
                    <span className="text-xs text-gray-500 shrink-0 whitespace-nowrap">
                      Apply to {outflowTargetLabel} rows:
                    </span>
                    <SearchableSelect value={applyS1} onChange={setApplyS1}
                      options={categories.map(c => ({ value: c.name, label: c.name }))}
                      placeholder="Stage Code 1"
                      className="text-xs px-2 py-1.5 border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-primary/30 bg-white"
                      wrapperClassName="flex-1 min-w-[100px]" />
                    <select value={applyS2} onChange={e => setApplyS2(e.target.value)}
                      className="flex-1 text-xs px-2 py-1.5 border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-primary/30 bg-white min-w-[100px]">
                      <option value="">Stage Code 2</option>
                      <option value="Percentage Allocation">Percentage Allocation</option>
                      <option value="Specific Seed">Specific Seed</option>
                      <option value="Savings">Savings</option>
                    </select>
                    {outflowTypeOptions.length > 0 && (
                      <SearchableSelect value={applyOutflowType} onChange={setApplyOutflowType}
                        options={outflowTypeOptions.map(t => ({ value: t.id, label: t.name }))}
                        placeholder="Outflow Type"
                        className="text-xs px-2 py-1.5 border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-primary/30 bg-white"
                        wrapperClassName="flex-1 min-w-[100px]" />
                    )}
                    <select value={batchTxnType} onChange={e => setBatchTxnType(e.target.value)}
                      className="text-xs px-2 py-1.5 border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-primary/30 bg-white">
                      <option value="">— Type —</option>
                      {availableOutflowTypes.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                    <button
                      type="button"
                      disabled={(!applyS1 && !applyS2 && !batchTxnType && !applyOutflowType) || outflowTargetRis.length === 0}
                      onClick={() => {
                        if (applyS1 || applyS2) {
                          setRowStageCodes(prev => {
                            const next = { ...prev }
                            for (const ri of outflowTargetRis)
                              next[ri] = {
                                s1: applyS1 || (prev[ri]?.s1 ?? ''),
                                s2: applyS2 || (prev[ri]?.s2 ?? ''),
                              }
                            return next
                          })
                        }
                        if (applyOutflowType !== '') {
                          setRowOutflowTypes(prev => {
                            const next = { ...prev }
                            for (const ri of outflowTargetRis) next[ri] = applyOutflowType
                            return next
                          })
                        } else if (applyS1) {
                          // Auto-suggest outflow type from applied stage_code_1
                          const cat = categories.find((c: { name: string }) => c.name === applyS1)
                          let suggestedId = ''
                          if (cat) {
                            const sug = getDefaultOutflowTypeForCategory(cat.id, categoryOutflowMaps, outflowTypeOptions)
                            suggestedId = sug?.id ?? ''
                          } else {
                            const match = outflowTypeOptions.find(t => t.name.toLowerCase() === applyS1.toLowerCase())
                            suggestedId = match?.id ?? ''
                          }
                          if (suggestedId) {
                            setRowOutflowTypes(prev => {
                              const next = { ...prev }
                              for (const ri of outflowTargetRis) next[ri] = suggestedId
                              return next
                            })
                          }
                        }
                        if (batchTxnType !== '') {
                          setRowTxnTypes(prev => {
                            const next = { ...prev }
                            for (const ri of outflowTargetRis) next[ri] = batchTxnType
                            return next
                          })
                        }
                      }}
                      className="px-3 py-1.5 text-xs font-medium bg-primary text-white rounded-lg hover:bg-primary-light disabled:opacity-50"
                    >
                      Apply
                    </button>
                    <div className="w-px self-stretch bg-gray-200 mx-1" />
                    <button
                      type="button"
                      disabled={outflowTargetRis.length === 0}
                      onClick={() => setRowPendingDeductions(prev => {
                        const next = new Set(prev)
                        for (const ri of outflowTargetRis) next.add(ri)
                        return next
                      })}
                      className="px-3 py-1.5 text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200 rounded-lg hover:bg-amber-100 disabled:opacity-50 whitespace-nowrap"
                    >
                      Mark Pending
                    </button>
                    <button
                      type="button"
                      disabled={outflowTargetRis.length === 0}
                      onClick={() => setRowPendingDeductions(prev => {
                        const next = new Set(prev)
                        for (const ri of outflowTargetRis) next.delete(ri)
                        return next
                      })}
                      className="px-3 py-1.5 text-xs font-medium text-gray-500 border border-gray-200 rounded-lg hover:bg-gray-100 disabled:opacity-50 whitespace-nowrap"
                    >
                      Clear Pending
                    </button>
                  </div>
                    )
                  })()}

                  {/* Row table / card view */}
                  {(() => {
                    const allOutflowFilteredSelected = filtered.length > 0 && filtered.every(({ ri }) => selectedOutflowRis.has(ri))
                    const someOutflowFilteredSelected = filtered.some(({ ri }) => selectedOutflowRis.has(ri))

                    const buildOutflowRowData = (ri: number, raw: unknown[]) => {
                      const date    = dateIdx >= 0 ? (parseDate(raw[dateIdx], dateFormat) ?? '') : ''
                      const desc    = descIdx >= 0 && raw[descIdx] != null ? String(raw[descIdx]).trim() : ''
                      const sc      = rowStageCodes[ri] ?? { s1: '', s2: '' }
                      const txnType = rowTxnTypes[ri] ?? ''
                      const origId  = rowOrigTxnIds[ri] ?? ''
                      return { date, desc, sc, txnType, origId }
                    }

                    return importRowView === 'table' ? (
                  <div className="border border-gray-200 rounded-xl overflow-hidden">
                    <div className="grid grid-cols-[24px_36px_1fr_80px_110px_110px_52px_90px] bg-gray-50 px-3 py-2 text-xs font-semibold text-gray-500 border-b border-gray-200">
                      <input
                        type="checkbox"
                        checked={allOutflowFilteredSelected}
                        ref={el => { if (el) el.indeterminate = someOutflowFilteredSelected && !allOutflowFilteredSelected }}
                        onChange={e => {
                          setSelectedOutflowRis(prev => {
                            const next = new Set(prev)
                            if (e.target.checked) filtered.forEach(({ ri }) => next.add(ri))
                            else filtered.forEach(({ ri }) => next.delete(ri))
                            return next
                          })
                        }}
                        className="w-3.5 h-3.5 rounded border-gray-300 text-primary focus:ring-primary/30 cursor-pointer"
                      />
                      <span>#</span><span>Description / Date</span><span>Amount</span><span>Stage Code 1</span><span>Stage Code 2</span><span>Pending</span><span>Type</span>
                    </div>
                    <div className="max-h-[340px] overflow-y-auto divide-y divide-gray-100">
                      {filtered.length === 0
                        ? <div className="py-8 text-center text-xs text-gray-400">No debit rows match the filter</div>
                        : filtered.map(({ ri, raw, debit }) => {
                            const { date, desc, sc, txnType, origId } = buildOutflowRowData(ri, raw)
                            const isOutflowSelected = selectedOutflowRis.has(ri)
                            return (
                              <div key={ri} className={isOutflowSelected ? 'bg-primary/5' : undefined}>
                                <div className="grid grid-cols-[24px_36px_1fr_80px_110px_110px_52px_90px] items-center px-3 py-2 gap-2 text-xs">
                                  <input
                                    type="checkbox"
                                    checked={isOutflowSelected}
                                    onChange={e => {
                                      setSelectedOutflowRis(prev => {
                                        const next = new Set(prev)
                                        e.target.checked ? next.add(ri) : next.delete(ri)
                                        return next
                                      })
                                    }}
                                    className="w-3.5 h-3.5 rounded border-gray-300 text-primary focus:ring-primary/30 cursor-pointer"
                                  />
                                  <span className="text-gray-400 font-mono">{ri + 1}</span>
                                  <div className="min-w-0">
                                    <div
                                      className="flex items-center"
                                      onMouseEnter={e => {
                                        if (!desc) return
                                        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
                                        const spaceBelow = window.innerHeight - rect.bottom
                                        setTooltipState({ text: desc, x: rect.left, y: spaceBelow >= 80 ? rect.bottom + 4 : rect.top - 4 })
                                      }}
                                      onMouseLeave={() => setTooltipState(null)}
                                    >
                                      <span className="text-gray-700 truncate">{desc || '—'}</span>
                                    </div>
                                    <div className="text-gray-400">{date}</div>
                                  </div>
                                  <span className="text-gray-700 font-medium">{baseCurrencySymbol}{debit.toLocaleString()}</span>
                                  <SearchableSelect value={sc.s1}
                                    onChange={s1 => {
                                      setRowStageCodes(prev => ({ ...prev, [ri]: { s1, s2: prev[ri]?.s2 ?? '' } }))
                                      const cat = categories.find((c: { name: string }) => c.name === s1)
                                      let suggestedId = ''
                                      if (cat) {
                                        const sug = getDefaultOutflowTypeForCategory(cat.id, categoryOutflowMaps, outflowTypeOptions)
                                        suggestedId = sug?.id ?? ''
                                      } else if (s1) {
                                        const match = outflowTypeOptions.find(t => t.name.toLowerCase() === s1.toLowerCase())
                                        suggestedId = match?.id ?? ''
                                      }
                                      setRowOutflowTypes(prev => ({ ...prev, [ri]: suggestedId }))
                                    }}
                                    options={categories.map(c => ({ value: c.name, label: c.name }))}
                                    placeholder="— None —"
                                    className="text-xs px-2 py-1 border border-gray-200 rounded outline-none focus:ring-2 focus:ring-primary/30 bg-white w-full" />
                                  <select value={sc.s2}
                                    onChange={e => setRowStageCodes(prev => ({ ...prev, [ri]: { s1: prev[ri]?.s1 ?? '', s2: e.target.value } }))}
                                    className="text-xs px-2 py-1 border border-gray-200 rounded outline-none focus:ring-2 focus:ring-primary/30 bg-white w-full">
                                    <option value="">— None —</option>
                                    <option value="Percentage Allocation">Percentage Allocation</option>
                                    <option value="Specific Seed">Specific Seed</option>
                                    <option value="Savings">Savings</option>
                                  </select>
                                  <div className="flex justify-center">
                                    <input
                                      type="checkbox"
                                      checked={rowPendingDeductions.has(ri)}
                                      onChange={e => setRowPendingDeductions(prev => {
                                        const next = new Set(prev)
                                        e.target.checked ? next.add(ri) : next.delete(ri)
                                        return next
                                      })}
                                      title="Mark as Pending Deduction"
                                      className="w-3.5 h-3.5 rounded border-gray-300 text-amber-500 focus:ring-amber-400/30 cursor-pointer"
                                    />
                                  </div>
                                  <select value={txnType}
                                    onChange={e => setRowTxnTypes(prev => ({ ...prev, [ri]: e.target.value }))}
                                    disabled={isForeignCurrencyBank}
                                    className="text-xs px-2 py-1 border border-gray-200 rounded outline-none focus:ring-2 focus:ring-primary/30 bg-white w-full">
                                    {availableOutflowTypes.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                                  </select>
                                </div>
                                {outflowTypeOptions.length > 0 && (
                                  <div className="px-3 pb-2 flex items-center gap-2">
                                    <span className="text-[10px] text-gray-400 w-28 shrink-0">Outflow Type:</span>
                                    <SearchableSelect value={rowOutflowTypes[ri] ?? ''}
                                      onChange={v => setRowOutflowTypes(prev => ({ ...prev, [ri]: v }))}
                                      options={outflowTypeOptions.map(t => ({ value: t.id, label: t.name }))}
                                      placeholder="— None —"
                                      className="text-xs px-2 py-1 border border-gray-200 rounded outline-none focus:ring-2 focus:ring-primary/30 bg-white"
                                      wrapperClassName="flex-1" />
                                  </div>
                                )}
                                {(txnType === 'refund' || txnType === 'reversal') && (
                                  <div className="px-3 pb-2 flex items-center gap-2">
                                    <span className="text-[10px] text-gray-400 w-28 shrink-0">Original Txn ID:</span>
                                    <input type="text" value={origId}
                                      onChange={e => setRowOrigTxnIds(prev => ({ ...prev, [ri]: e.target.value }))}
                                      placeholder="ID of original transaction"
                                      className="flex-1 text-xs px-2 py-1 border border-gray-200 rounded outline-none focus:ring-2 focus:ring-primary/30 bg-white"
                                    />
                                  </div>
                                )}
                              </div>
                            )
                          })
                      }
                    </div>
                  </div>
                    ) : (
                  /* ── Card view ── */
                  <>
                    {filtered.length > 0 && (
                      <div className="flex items-center gap-2 px-1 pb-1">
                        <input
                          type="checkbox"
                          checked={allOutflowFilteredSelected}
                          ref={el => { if (el) el.indeterminate = someOutflowFilteredSelected && !allOutflowFilteredSelected }}
                          onChange={e => {
                            setSelectedOutflowRis(prev => {
                              const next = new Set(prev)
                              if (e.target.checked) filtered.forEach(({ ri }) => next.add(ri))
                              else filtered.forEach(({ ri }) => next.delete(ri))
                              return next
                            })
                          }}
                          className="w-3.5 h-3.5 rounded border-gray-300 text-primary focus:ring-primary/30 cursor-pointer shrink-0"
                        />
                        <span className="text-xs text-gray-500 select-none">
                          {allOutflowFilteredSelected
                            ? `All ${filtered.length} selected`
                            : someOutflowFilteredSelected
                              ? `${filtered.filter(({ ri }) => selectedOutflowRis.has(ri)).length} of ${filtered.length} selected`
                              : `Select all ${filtered.length}`}
                        </span>
                      </div>
                    )}
                    <div className="space-y-3 max-h-[480px] overflow-y-auto pr-0.5">
                    {filtered.length === 0
                      ? <div className="py-8 text-center text-xs text-gray-400">No debit rows match the filter</div>
                      : filtered.map(({ ri, raw, debit }) => {
                          const { date, desc, sc, txnType, origId } = buildOutflowRowData(ri, raw)
                          const isOutflowSelected = selectedOutflowRis.has(ri)
                          const isExpanded = expandedOutflowCardRis.has(ri)
                          const isPending = rowPendingDeductions.has(ri)
                          const outflowTypeName = outflowTypeOptions.find(t => t.id === (rowOutflowTypes[ri] ?? ''))?.name ?? ''
                          const typeName = txnType
                            ? (TXN_TYPE_OPTIONS.find(o => o.value === txnType)?.label ?? txnType)
                            : ''
                          return (
                            <div key={ri} className={`rounded-xl border overflow-hidden shadow-sm ${
                              isOutflowSelected ? 'border-primary/40 bg-primary/5' : 'border-gray-200 bg-white'
                            }`}>
                              {/* Section 1 — header body */}
                              <div className="px-4 pt-3.5 pb-3">
                                <div className="flex items-center justify-between mb-1.5">
                                  <div className="flex items-center gap-2 min-w-0">
                                    <input
                                      type="checkbox"
                                      checked={isOutflowSelected}
                                      onChange={e => {
                                        setSelectedOutflowRis(prev => {
                                          const next = new Set(prev)
                                          e.target.checked ? next.add(ri) : next.delete(ri)
                                          return next
                                        })
                                      }}
                                      className="w-4 h-4 rounded border-gray-300 text-primary focus:ring-primary/30 cursor-pointer shrink-0"
                                    />
                                    <span className="text-[10px] font-mono text-gray-400 shrink-0">#{ri + 1}</span>
                                    {date && <span className="text-[11px] font-semibold text-gray-400 truncate">{date}</span>}
                                    {isPending && (
                                      <span className="shrink-0 px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 text-[10px] font-semibold">Pending</span>
                                    )}
                                  </div>
                                  <span className="text-sm font-mono font-bold text-danger tabular-nums shrink-0 ml-2">
                                    {baseCurrencySymbol}{debit.toLocaleString()}
                                  </span>
                                </div>
                                <p className="text-sm text-gray-700 line-clamp-2 leading-snug">
                                  {desc || <span className="text-gray-400">—</span>}
                                </p>
                              </div>
                              {/* Section 2 — meta / controls */}
                              <div className="border-t border-gray-100">
                                {!isExpanded ? (
                                  <button
                                    type="button"
                                    onClick={() => setExpandedOutflowCardRis(prev => { const s = new Set(prev); s.add(ri); return s })}
                                    className="w-full flex items-center justify-between px-4 py-2.5 bg-gray-50/40 text-xs text-gray-500 hover:bg-gray-50 transition-colors text-left"
                                  >
                                    <span className="truncate min-w-0 mr-2">
                                      {sc.s1 || '—'}
                                      {sc.s2 ? ` · ${sc.s2}` : ''}
                                      {outflowTypeName ? ` · ${outflowTypeName}` : ''}
                                      {typeName ? ` · ${typeName}` : ''}
                                    </span>
                                    <ChevronRight className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                                  </button>
                                ) : (
                                  <div className="px-4 py-3 bg-gray-50/40 space-y-3">
                                    {/* Stage Code 1 */}
                                    <div>
                                      <label className="text-[10px] uppercase tracking-wide font-semibold text-gray-400 mb-1 block">Stage Code 1</label>
                                      <select value={sc.s1}
                                        onChange={e => {
                                          const s1 = e.target.value
                                          setRowStageCodes(prev => ({ ...prev, [ri]: { s1, s2: prev[ri]?.s2 ?? '' } }))
                                          const cat = categories.find((c: { name: string }) => c.name === s1)
                                          let suggestedId = ''
                                          if (cat) {
                                            const sug = getDefaultOutflowTypeForCategory(cat.id, categoryOutflowMaps, outflowTypeOptions)
                                            suggestedId = sug?.id ?? ''
                                          } else if (s1) {
                                            const match = outflowTypeOptions.find(t => t.name.toLowerCase() === s1.toLowerCase())
                                            suggestedId = match?.id ?? ''
                                          }
                                          setRowOutflowTypes(prev => ({ ...prev, [ri]: suggestedId }))
                                        }}
                                        className="w-full text-xs px-2 py-1.5 border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-primary/30 bg-white">
                                        <option value="">— None —</option>
                                        {categories.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                                      </select>
                                    </div>
                                    {/* Stage Code 2 */}
                                    <div>
                                      <label className="text-[10px] uppercase tracking-wide font-semibold text-gray-400 mb-1 block">Stage Code 2</label>
                                      <select value={sc.s2}
                                        onChange={e => setRowStageCodes(prev => ({ ...prev, [ri]: { s1: prev[ri]?.s1 ?? '', s2: e.target.value } }))}
                                        className="w-full text-xs px-2 py-1.5 border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-primary/30 bg-white">
                                        <option value="">— None —</option>
                                        <option value="Percentage Allocation">Percentage Allocation</option>
                                        <option value="Specific Seed">Specific Seed</option>
                                        <option value="Savings">Savings</option>
                                      </select>
                                    </div>
                                    {/* Outflow Type */}
                                    {outflowTypeOptions.length > 0 && (
                                      <div>
                                        <label className="text-[10px] uppercase tracking-wide font-semibold text-gray-400 mb-1 block">Outflow Type</label>
                                        <SearchableSelect value={rowOutflowTypes[ri] ?? ''}
                                          onChange={v => setRowOutflowTypes(prev => ({ ...prev, [ri]: v }))}
                                          options={outflowTypeOptions.map(t => ({ value: t.id, label: t.name }))}
                                          placeholder="— None —"
                                          className="w-full text-xs px-2 py-1.5 border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-primary/30 bg-white" />
                                      </div>
                                    )}
                                    {/* Pending Deduction */}
                                    <label className="flex items-center gap-2 cursor-pointer">
                                      <input
                                        type="checkbox"
                                        checked={isPending}
                                        onChange={e => setRowPendingDeductions(prev => {
                                          const next = new Set(prev)
                                          e.target.checked ? next.add(ri) : next.delete(ri)
                                          return next
                                        })}
                                        className="w-4 h-4 rounded border-gray-300 text-amber-500 focus:ring-amber-400/30 cursor-pointer"
                                      />
                                      <span className="text-xs text-gray-600">Mark as Pending Deduction</span>
                                    </label>
                                    {/* Transaction Type */}
                                    <div>
                                      <label className="text-[10px] uppercase tracking-wide font-semibold text-gray-400 mb-1 block">Transaction Type</label>
                                      <select value={txnType}
                                        onChange={e => setRowTxnTypes(prev => ({ ...prev, [ri]: e.target.value }))}
                                        disabled={isForeignCurrencyBank}
                                        className="w-full text-xs px-2 py-1.5 border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-primary/30 bg-white">
                                        {availableOutflowTypes.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                                      </select>
                                    </div>
                                    {/* Original Txn ID */}
                                    {(txnType === 'refund' || txnType === 'reversal') && (
                                      <div>
                                        <label className="text-[10px] uppercase tracking-wide font-semibold text-gray-400 mb-1 block">Original Txn ID</label>
                                        <input type="text" value={origId}
                                          onChange={e => setRowOrigTxnIds(prev => ({ ...prev, [ri]: e.target.value }))}
                                          placeholder="ID of original transaction"
                                          className="w-full text-xs px-2 py-1.5 border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-primary/30 bg-white"
                                        />
                                      </div>
                                    )}
                                    <button
                                      type="button"
                                      onClick={() => setExpandedOutflowCardRis(prev => { const s = new Set(prev); s.delete(ri); return s })}
                                      className="w-full flex items-center justify-center gap-1 text-xs text-gray-400 hover:text-gray-600 pt-1"
                                    >
                                      <ChevronDown className="w-3.5 h-3.5 rotate-180" />
                                      Less
                                    </button>
                                  </div>
                                )}
                              </div>
                            </div>
                          )
                        })
                    }
                  </div>
                  </>
                    )
                  })()}
                </div>
              )
            })()}

            {tooltipState && createPortal(
              <div
                className="fixed z-[9999] max-w-xs bg-gray-900 text-white text-xs rounded-lg px-3 py-2 shadow-xl pointer-events-none break-words leading-snug"
                style={{ top: tooltipState.y, left: Math.min(tooltipState.x, window.innerWidth - 320) }}
              >
                {tooltipState.text}
              </div>,
              document.body,
            )}

            <NavButtons
              step={step}
              onBack={() => setStep(3)}
              onNext={proceedToImport}
              nextLabel={`Preview & Import (${(dupStats?.newCount ?? sheet.rowCount).toLocaleString()} rows)`}
            />
          </div>
        )}

        {/* ─────────────────────── STEP 5: Preview & Import ────────────── */}
        {step === 5 && sheet && config && (
          <div className="space-y-5">

            {/* Persistent bank bar */}
            <div className="flex items-center gap-3 rounded-lg bg-gray-50 border border-gray-200 px-3 py-2">
              <span className="text-xs font-medium text-gray-500 shrink-0">Bank</span>
              <select
                value={internalBank?.id ?? ''}
                onChange={e => {
                  const found = bankList.find(b => b.id === e.target.value)
                  setInternalBank(found ? { id: found.id, name: found.name } : null)
                }}
                className={`flex-1 text-xs px-2 py-1.5 border rounded-lg outline-none focus:ring-2 focus:ring-primary/30 bg-white ${
                  internalBank ? 'border-gray-300' : 'border-amber-400'
                }`}
              >
                <option value="">— Select bank —</option>
                {bankList.map(b => <option key={b.id} value={b.id}>{bankLabel(b)}</option>)}
              </select>
              {internalBank && (
                <span className="text-xs font-semibold text-primary shrink-0">{internalBank.name}</span>
              )}
            </div>

            {/* No-bank warning */}
            {!internalBank && (
              <div className="flex items-center gap-2 rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-700">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                Select a bank before importing.
              </div>
            )}

            {/* Summary */}
            <div className="grid grid-cols-3 gap-3 text-center">
              <div className="rounded-lg bg-gray-50 px-3 py-3">
                <div className="text-2xl font-bold text-gray-900">
                  {(dupStats?.newCount ?? sheet.rowCount).toLocaleString()}
                </div>
                <div className="text-xs text-gray-500 mt-0.5">
                  Rows to import{dupStats?.dupCount ? ` (${dupStats.dupCount} skipped)` : ''}
                </div>
              </div>
              <div className="rounded-lg bg-gray-50 px-3 py-3">
                <div className="text-2xl font-bold text-gray-900">
                  {Object.values(mapping).filter(v => v !== SKIP).length}
                </div>
                <div className="text-xs text-gray-500 mt-0.5">Columns mapped</div>
              </div>
              <div className="rounded-lg bg-gray-50 px-3 py-3">
                <div className="text-lg font-bold text-gray-900">
                  {targetTable === 'bank_statement' ? 'Split' : TABLE_CONFIG[targetTable as TargetTable]?.label.split(' ')[0]}
                </div>
                <div className="text-xs text-gray-500 mt-0.5">
                  {targetTable === 'bank_statement' ? 'Inflow + Outflow' : 'Target table'}
                </div>
              </div>
            </div>

            {targetTable === 'bank_statement' && (
              <div className="rounded-lg bg-primary/5 border border-primary/20 px-4 py-3 text-xs text-primary space-y-1">
                <p className="font-semibold">Bank Statement Split Rules</p>
                <p>Credit &gt; 0 → <strong>Inflow</strong> table &nbsp;·&nbsp; Debit &gt; 0 → <strong>Outflow</strong> table</p>
                <p className="text-gray-500">Description follows the non-empty amount column into the correct table.</p>
                {internalBank && <p>Bank: <strong>{internalBank.name}</strong> will be tagged on all rows.</p>}
              </div>
            )}

            {/* First 3 rows preview mapped */}
            {sheet.rows.slice(0, 3).length > 0 && (
              <div>
                <p className="text-xs font-medium text-gray-500 mb-2">Sample rows (mapped values)</p>
                <div className="overflow-x-auto border border-gray-200 rounded-lg text-xs">
                  <table className="min-w-full">
                    <thead>
                      <tr className="bg-gray-50">
                        {config.fields
                          .filter(f => Object.values(mapping).includes(f.key))
                          .map(f => (
                            <th key={f.key} className="px-3 py-2 text-left font-semibold text-gray-500 whitespace-nowrap border-r border-gray-100 last:border-0">
                              {f.label}
                            </th>
                          ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {sheet.rows.slice(0, 3).map((row, ri) => (
                        <tr key={ri}>
                          {config.fields
                            .filter(f => Object.values(mapping).includes(f.key))
                            .map(f => {
                              const colIdx = sheet.headers.findIndex(h => mapping[h] === f.key)
                              const val = colIdx >= 0 ? row[colIdx] : ''
                              const display = f.key === 'date' ? (parseDate(val) ?? String(val)) : String(val ?? '')
                              return (
                                <td key={f.key} className="px-3 py-1.5 text-gray-600 whitespace-nowrap border-r border-gray-50 last:border-0 max-w-[120px] truncate">
                                  {display}
                                </td>
                              )
                            })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Progress bar */}
            {importing && (
              <div className="space-y-2">
                <div className="flex justify-between text-xs text-gray-500">
                  <span>Importing…</span>
                  <span>{progress}%</span>
                </div>
                <div className="w-full h-2.5 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary rounded-full transition-all duration-300"
                    style={{ width: `${progress}%` }}
                  />
                </div>
              </div>
            )}

            {/* Result */}
            {result && !importing && (
              <div className={`rounded-xl border p-4 space-y-2 ${
                result.errors.length > 0 ? 'bg-amber-50 border-amber-200' : 'bg-green-50 border-green-200'
              }`}>
                <div className={`flex items-center gap-2 font-semibold text-sm ${
                  result.errors.length > 0 ? 'text-amber-700' : 'text-success'
                }`}>
                  {result.errors.length === 0
                    ? <CheckCircle2 className="w-4 h-4" />
                    : <AlertTriangle className="w-4 h-4" />}
                  Import complete
                </div>
                <div className="text-sm space-y-1">
                  <div className="text-success">✓ {result.imported.toLocaleString()} rows imported</div>
                  {result.skipped > 0 && <div className="text-amber-600">⚠ {result.skipped} rows skipped</div>}
                  {result.fallbackIdCount > 0 && (
                    <div className="text-blue-600 dark:text-blue-400">ℹ {result.fallbackIdCount} fallback ID(s) auto-generated</div>
                  )}
                </div>
                {result.errors.length > 0 && (
                  <div className="mt-2 max-h-28 overflow-y-auto text-xs text-amber-700 bg-amber-100 rounded-lg p-3 space-y-0.5 font-mono">
                    {result.errors.map((e, i) => <div key={i} className="whitespace-pre-wrap">{e}</div>)}
                  </div>
                )}
                {result.collisions.length > 0 && (
                  <div className="mt-2">
                    <div className="text-xs font-semibold text-amber-700 dark:text-amber-400 mb-1">
                      ⚠ {result.collisions.length} collision-flagged — manual review needed:
                    </div>
                    <div className="max-h-28 overflow-y-auto text-xs text-amber-700 bg-amber-100 dark:bg-amber-900/30 rounded-lg p-3 space-y-0.5 font-mono">
                      {result.collisions.map((c, i) => <div key={i}>{c}</div>)}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Action buttons */}
            {!result ? (
              <NavButtons
                step={step}
                onBack={() => setStep(targetTable === 'bank_statement' ? 4 : 3)}
                onNext={runImport}
                nextDisabled={importing || !internalBank}
                nextLabel={importing ? 'Importing…' : 'Start Import'}
                nextLoading={importing}
              />
            ) : (
              <div className="flex justify-end gap-3">
                <button
                  onClick={reset}
                  className="flex items-center gap-1.5 px-4 py-2 text-sm border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-50"
                >
                  <RefreshCw className="w-3.5 h-3.5" /> Import Another
                </button>
                <button
                  onClick={handleClose}
                  className="px-5 py-2 text-sm bg-primary text-white rounded-lg hover:bg-primary-light"
                >
                  Done
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>

    <CreateSpecialConfigModal
      open={createConfigOpen || createConfigPendingRow !== null}
      mode="new_group"
      onClose={() => { setCreateConfigOpen(false); setCreateConfigPendingRow(null) }}
      onSaved={cfg => {
        if (!cfg) return
        reloadAllocConfigs()
        if (createConfigPendingRow === 'apply') {
          setApplyInflowConfig(cfg.id)
        } else if (typeof createConfigPendingRow === 'number') {
          setRowConfigs(prev => ({ ...prev, [createConfigPendingRow]: cfg.id }))
        }
        setCreateConfigPendingRow(null)
        setCreateConfigOpen(false)
      }}
    />

    {/* Reset-import confirm dialog */}
    {confirmingReset && createPortal(
      <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4 text-center">
          <p className="font-semibold text-gray-900 text-base">Discard import progress?</p>
          <p className="text-sm text-gray-500">Current import setup and unsaved work will be lost.</p>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setConfirmingReset(false)}
              className="flex-1 px-4 min-h-[44px] text-sm font-medium text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
            >
              Continue Import
            </button>
            <button
              type="button"
              onClick={() => { setConfirmingReset(false); reset() }}
              className="flex-1 px-4 min-h-[44px] text-sm font-medium text-white bg-danger rounded-lg hover:opacity-90 transition-colors"
            >
              Discard Changes
            </button>
          </div>
        </div>
      </div>,
      document.body
    )}

    {/* Route-change / back-button confirm dialog */}
    {navBlockShowing && createPortal(
      <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4 text-center">
          <p className="font-semibold text-gray-900 text-base">Discard import progress?</p>
          <p className="text-sm text-gray-500">Current import setup and unsaved work will be lost.</p>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => {
                pendingNavIsBackRef.current = false
                setNavBlockShowing(false)
              }}
              className="flex-1 px-4 min-h-[44px] text-sm font-medium text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
            >
              Continue Import
            </button>
            <button
              type="button"
              onClick={() => {
                try { sessionStorage.removeItem(SESSION_KEY) } catch {}
                if (pendingNavIsBackRef.current) {
                  // Triggered by browser back / swipe-back: close modal, stay on page.
                  // Neutralise the re-pushed sentinel to avoid a phantom back-step.
                  sentinelPushedRef.current = false
                  history.replaceState({}, '')
                  pendingNavIsBackRef.current = false
                  setNavBlockShowing(false)
                  reset()
                  onClose()
                } else {
                  setNavBlockShowing(false)
                  navigate(pendingNavPathRef.current)
                }
              }}
              className="flex-1 px-4 min-h-[44px] text-sm font-medium text-white bg-danger rounded-lg hover:opacity-90 transition-colors"
            >
              Discard & Close
            </button>
          </div>
        </div>
      </div>,
      document.body
    )}
    </>
  )
}

// ── Nav buttons ────────────────────────────────────────────────────────────────

function NavButtons({
  step,
  onBack,
  onNext,
  nextDisabled,
  nextLabel,
  nextLoading,
}: {
  step:         number
  onBack?:      () => void
  onNext?:      () => void
  nextDisabled?: boolean
  nextLabel?:   string
  nextLoading?: boolean
}) {
  return (
    <div className="flex justify-between pt-2">
      <button
        type="button"
        onClick={onBack}
        className={`flex items-center gap-1.5 px-4 py-2 text-sm border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-50 ${step <= 1 ? 'invisible' : ''}`}
      >
        <ChevronLeft className="w-4 h-4" /> Back
      </button>
      <button
        type="button"
        onClick={onNext}
        disabled={nextDisabled || nextLoading}
        className="flex items-center gap-1.5 px-5 py-2 text-sm bg-primary text-white rounded-lg hover:bg-primary-light disabled:opacity-60"
      >
        {nextLoading && <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
        {nextLabel ?? 'Next'} {!nextLoading && <ChevronRight className="w-4 h-4" />}
      </button>
    </div>
  )
}
