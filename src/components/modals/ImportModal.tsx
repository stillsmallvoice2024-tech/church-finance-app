import { useState, useRef, useCallback, useMemo, useEffect } from 'react'
import * as XLSX from 'xlsx'
import {
  Upload, FileSpreadsheet, ChevronRight, ChevronLeft,
  CheckCircle2, AlertTriangle, RefreshCw, FileText, Loader2,
} from 'lucide-react'
import { Modal } from '../ui/Modal'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/authStore'
import { useAllocationStore, getConfigForDate } from '../../store/allocationStore'
import { useCategories } from '../../hooks/useCategories'
import { formatDate } from '../../utils/formatters'

// ── Target table definitions ───────────────────────────────────────────────────

type TargetTable =
  | 'inflow_transactions'
  | 'outflow_transactions'
  | 'intra_flows'
  | 'ledger_entries'
  | 'fx_transactions'

interface FieldDef { key: string; label: string; required?: boolean }

const TABLE_CONFIG: Record<TargetTable, { label: string; fields: FieldDef[] }> = {
  inflow_transactions: {
    label: 'Inflow Transactions',
    fields: [
      { key: 'date',                      label: 'Date',                    required: true },
      { key: 'amount',                    label: 'Amount',                  required: true },
      { key: 'description',               label: 'Description'                            },
      { key: 'stage_code_1',              label: 'Stage Code 1'                           },
      { key: 'stage_code_2',              label: 'Stage Code 2'                           },
      { key: 'stage_code_3',              label: 'Stage Code 3'                           },
      { key: 'transaction_ref',           label: 'Transaction Ref'                        },
      { key: 'specific_seed_description', label: 'Seed Description'                       },
      { key: 'remark',                    label: 'Remark'                                 },
    ],
  },
  outflow_transactions: {
    label: 'Outflow Transactions',
    fields: [
      { key: 'date',             label: 'Date',             required: true },
      { key: 'amount_disbursed', label: 'Amount Disbursed', required: true },
      { key: 'description',      label: 'Description'                      },
      { key: 'amount_refunded',  label: 'Amount Refunded'                  },
      { key: 'transfer_charge',  label: 'Transfer Charge'                  },
      { key: 'actual_amount',    label: 'Actual Amount'                    },
      { key: 'bank_total',       label: 'Bank Total'                       },
      { key: 'stage_code_1',     label: 'Stage Code 1'                     },
      { key: 'stage_code_2',     label: 'Stage Code 2'                     },
      { key: 'transaction_id',   label: 'Transaction ID'                   },
      { key: 'bank_description', label: 'Bank Description'                 },
      { key: 'remarks',          label: 'Remarks'                          },
    ],
  },
  intra_flows: {
    label: 'Intra-Account Flows',
    fields: [
      { key: 'date',                label: 'Date',         required: true },
      { key: 'total_amount',        label: 'Total Amount', required: true },
      { key: 'account_from',        label: 'Account From'                 },
      { key: 'account_to',          label: 'Account To'                   },
      { key: 'description',         label: 'Description'                  },
      { key: 'transaction_ref',     label: 'Transaction Ref'              },
      { key: 'account_from_stage1', label: 'From Stage 1'                 },
      { key: 'account_from_stage2', label: 'From Stage 2'                 },
      { key: 'account_to_stage1',   label: 'To Stage 1'                   },
      { key: 'account_to_stage2',   label: 'To Stage 2'                   },
      { key: 'remark',              label: 'Remark'                       },
    ],
  },
  ledger_entries: {
    label: 'Ledger Entries',
    fields: [
      { key: 'account_id',   label: 'Account ID',   required: true },
      { key: 'date',         label: 'Date',         required: true },
      { key: 'inflow',       label: 'Inflow'                       },
      { key: 'outflow',      label: 'Outflow'                      },
      { key: 'balance',      label: 'Balance'                      },
      { key: 'description',  label: 'Description'                  },
      { key: 'refund_intraflow', label: 'Refund/Intraflow'         },
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

// ── Date / number parsing ──────────────────────────────────────────────────────

function parseDate(raw: unknown): string | null {
  if (raw == null || raw === '') return null
  // Excel serial number
  if (typeof raw === 'number') {
    const d = XLSX.SSF.parse_date_code(raw)
    if (d) {
      const yy = d.y.toString().padStart(4, '0')
      const mm = String(d.m).padStart(2, '0')
      const dd = String(d.d).padStart(2, '0')
      return `${yy}-${mm}-${dd}`
    }
    return null
  }
  const s = String(raw).trim()
  // YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  // DD/MM/YYYY or D/M/YYYY
  const dmy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2,'0')}-${dmy[1].padStart(2,'0')}`
  // MM/DD/YYYY
  const mdy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (mdy) return `${mdy[3]}-${mdy[1].padStart(2,'0')}-${mdy[2].padStart(2,'0')}`
  // Try native Date parse
  const parsed = new Date(s)
  if (!isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10)
  return null
}

function parseNumber(raw: unknown): number {
  if (raw == null || raw === '') return 0
  if (typeof raw === 'number') return isNaN(raw) ? 0 : raw
  const cleaned = String(raw).replace(/,/g, '').replace(/\s/g, '').trim()
  const n = parseFloat(cleaned)
  return isNaN(n) ? 0 : n
}

// ── Auto-mapping ───────────────────────────────────────────────────────────────

const ALIAS_MAP: Record<string, string[]> = {
  date:             ['date', 'dt', 'transdate', 'valuedate', 'entrydate', 'txndate'],
  amount:           ['amount', 'amt', 'sum', 'value', 'credit', 'debit'],
  amount_disbursed: ['amount', 'disbursed', 'amtdisbursed'],
  total_amount:     ['total', 'totalamount', 'amount'],
  description:      ['description', 'desc', 'narration', 'details', 'particulars', 'memo'],
  stage_code_1:     ['stage', 'stagecode', 'stagecode1', 'code1', 'account'],
  transaction_ref:  ['ref', 'reference', 'txnref', 'transref'],
  currency:         ['currency', 'ccy', 'curr'],
  deposit:          ['deposit', 'credit', 'inflow', 'in'],
  withdrawal:       ['withdrawal', 'debit', 'outflow', 'out'],
  running_balance:  ['balance', 'runningbalance', 'closingbalance'],
  inflow:           ['inflow', 'credit', 'in'],
  outflow:          ['outflow', 'debit', 'out'],
  balance:          ['balance', 'closingbal', 'runningbal'],
  remark:           ['remark', 'remarks', 'note', 'notes', 'comment'],
  narration:        ['narration', 'description', 'desc', 'memo'],
}

function autoMapColumn(header: string, fields: FieldDef[]): string {
  const h = header.toLowerCase().replace(/[\s_\-().]+/g, '')
  // 1. exact field key match
  for (const f of fields) {
    if (f.key.replace(/_/g, '') === h) return f.key
  }
  // 2. alias match
  for (const f of fields) {
    const aliases = ALIAS_MAP[f.key] ?? []
    for (const alias of aliases) {
      if (h === alias || h.includes(alias)) return f.key
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
  const STEPS = ['Upload', 'Select Sheet', 'Map Columns', 'Import']
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
  open:         boolean
  onClose:      () => void
  skipTxnIds?:  Set<string>   // when set, rows matching these IDs are skipped at import
  bank?:        { id: string; name: string } | null
}

interface ImportResult {
  imported: number
  skipped:  number
  errors:   string[]
}

export function ImportModal({ open, onClose, skipTxnIds, bank }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const { user } = useAuthStore.getState()

  // Step state
  const [step,    setStep]   = useState(1)
  const [dragging, setDragging] = useState(false)

  // Step 1
  const [sheets,  setSheets]  = useState<ParsedSheet[]>([])
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
  const { configs: allocConfigs, fetch: fetchAllocConfigs, loaded: allocLoaded } = useAllocationStore()
  useEffect(() => { if (!allocLoaded) fetchAllocConfigs() }, [allocLoaded, fetchAllocConfigs])

  // ── Reset on open/close ──────────────────────────────────────────────────

  const reset = useCallback(() => {
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
  }, [])

  const handleClose = () => { reset(); onClose() }

  // ── File parsing ─────────────────────────────────────────────────────────

  const parseFile = useCallback((file: File) => {
    setParseErr(null)
    if (!file.name.match(/\.(xlsx|xls)$/i)) {
      setParseErr('Only .xlsx and .xls files are supported.')
      return
    }
    setFileName(file.name)
    const reader = new FileReader()
    reader.onload = e => {
      try {
        const data = e.target?.result
        if (!data) throw new Error('Could not read file')
        const wb = XLSX.read(data, { type: 'array', cellDates: false })
        const parsed: ParsedSheet[] = wb.SheetNames.map(name => {
          const ws   = wb.Sheets[name]
          const rows = (XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) as unknown[][])
          const headers = (rows[0] ?? []).map(h => String(h ?? '').trim())
          const dataRows = rows.slice(1).filter(r => r.some(c => c !== '' && c != null))
          return { name, headers, rows: dataRows, rowCount: dataRows.length }
        })
        setSheets(parsed)
        if (parsed.length > 0) {
          setSelectedSheet(parsed[0].name)
          setStep(2)
        }
      } catch (err) {
        setParseErr(err instanceof Error ? err.message : 'Failed to parse file')
      }
    }
    reader.readAsArrayBuffer(file)
  }, [])

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

  // ── Step 4: Import ────────────────────────────────────────────────────────

  const runImport = useCallback(async () => {
    if (!sheet || !config || !targetTable) return
    setImporting(true)
    setProgress(0)
    setResult(null)

    const userId = user?.id ?? null
    const numericFields = new Set(
      config.fields
        .filter(f => !['date', 'description', 'currency', 'transaction_ref',
                       'narration', 'remark', 'remarks', 'bank_description',
                       'stage_code_1', 'stage_code_2', 'stage_code_3',
                       'account_from', 'account_to', 'transaction_id',
                       'specific_seed_description', 'account_id',
                       'account_from_stage1', 'account_from_stage2',
                       'account_to_stage1', 'account_to_stage2'].includes(f.key))
        .map(f => f.key),
    )

    let imported = 0
    let skipped  = 0
    const errors: string[] = []

    // Build rows
    const mappedRows: Record<string, unknown>[] = []
    for (let ri = 0; ri < sheet.rows.length; ri++) {
      const raw = sheet.rows[ri]
      const row: Record<string, unknown> = {}

      for (let ci = 0; ci < sheet.headers.length; ci++) {
        const header = sheet.headers[ci]
        const field  = mapping[header]
        if (!field || field === SKIP) continue
        const val = raw[ci]

        if (field === 'date') {
          const d = parseDate(val)
          if (!d) { errors.push(`Row ${ri + 2}: invalid date "${val}"`); continue }
          row[field] = d
        } else if (numericFields.has(field)) {
          row[field] = parseNumber(val)
        } else {
          row[field] = val != null && val !== '' ? String(val).trim() : null
        }
      }

      // Check required fields
      const missing = config.fields
        .filter(f => f.required && !row[f.key])
        .map(f => f.label)
      if (missing.length > 0) {
        skipped++
        if (errors.length < 20) errors.push(`Row ${ri + 2}: missing required fields: ${missing.join(', ')}`)
        continue
      }

      // Skip all-empty rows
      if (Object.values(row).every(v => v == null || v === '' || v === 0)) {
        skipped++
        continue
      }

      if (userId) row.created_by = userId
      mappedRows.push(row)
    }

    // Inject bank_id for inflow/outflow tables if a bank was selected
    if (bank && (targetTable === 'inflow_transactions' || targetTable === 'outflow_transactions')) {
      for (const row of mappedRows) row.bank_id = bank.id
    }

    // Inject allocation_config_id per row based on the row's date
    if (targetTable === 'inflow_transactions' || targetTable === 'outflow_transactions') {
      const { configs: latestConfigs } = useAllocationStore.getState()
      for (const row of mappedRows) {
        const date = row.date as string | undefined
        if (date) {
          const cfg = getConfigForDate(latestConfigs, date)
          if (cfg) row.allocation_config_id = cfg.id
        }
      }
    }

    // Filter out rows whose transaction ID is in the skip list
    let rowsToInsert = mappedRows
    if (skipTxnIds && skipTxnIds.size > 0) {
      const txnField =
        targetTable === 'inflow_transactions'  ? 'transaction_ref' :
        targetTable === 'outflow_transactions' ? 'transaction_id'  : null
      if (txnField) {
        rowsToInsert = mappedRows.filter(r => {
          const id = r[txnField] as string | undefined
          return !id || !skipTxnIds.has(id)
        })
        const dupCount = mappedRows.length - rowsToInsert.length
        if (dupCount > 0) {
          skipped += dupCount
          errors.push(`${dupCount} duplicate transaction ID(s) skipped`)
        }
      }
    }

    // Batch insert 100 rows at a time
    const BATCH = 100
    for (let i = 0; i < rowsToInsert.length; i += BATCH) {
      const batch = rowsToInsert.slice(i, i + BATCH)
      const { error } = await supabase.from(targetTable).insert(batch)
      if (error) {
        const msg = `Batch ${Math.floor(i / BATCH) + 1}: ${error.message}`
        errors.push(msg)
        skipped += batch.length
      } else {
        imported += batch.length
      }
      setProgress(Math.round(((i + batch.length) / rowsToInsert.length) * 100))
    }

    setResult({ imported, skipped, errors })
    setImporting(false)
  }, [sheet, config, targetTable, mapping, user, skipTxnIds, bank])

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <Modal open={open} onClose={handleClose} title="Import from Excel" size="max-w-3xl">
      <div className="space-y-5">
        <StepDots step={step} />

        {/* ────────────────────────── STEP 1: Upload ───────────────────── */}
        {step === 1 && (
          <div className="space-y-4">
            <div
              onDragOver={e => { e.preventDefault(); setDragging(true) }}
              onDragLeave={() => setDragging(false)}
              onDrop={handleDrop}
              onClick={() => inputRef.current?.click()}
              className={`border-2 border-dashed rounded-xl p-10 flex flex-col items-center gap-3 cursor-pointer transition-colors ${
                dragging
                  ? 'border-primary bg-primary/5'
                  : 'border-gray-300 hover:border-primary hover:bg-gray-50'
              }`}
            >
              <div className={`p-4 rounded-full transition-colors ${dragging ? 'bg-primary/10' : 'bg-gray-100'}`}>
                <Upload className={`w-7 h-7 ${dragging ? 'text-primary' : 'text-gray-400'}`} />
              </div>
              <div className="text-center">
                <p className="text-sm font-medium text-gray-700">
                  Drop your Excel file here, or <span className="text-primary underline">browse</span>
                </p>
                <p className="text-xs text-gray-400 mt-1">Accepts .xlsx and .xls — max 20 MB</p>
              </div>
            </div>
            <input
              ref={inputRef}
              type="file"
              accept=".xlsx,.xls"
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

        {/* ─────────────────────── STEP 2: Sheet + Target ──────────────── */}
        {step === 2 && (
          <div className="space-y-5">
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <FileSpreadsheet className="w-4 h-4 text-primary" />
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
              </div>
            </div>

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
              onBack={() => { setStep(1); setSheets([]); setFileName('') }}
              onNext={proceedToMapping}
              nextDisabled={!targetTable || !selectedSheet}
              nextLabel="Map Columns"
            />
          </div>
        )}

        {/* ─────────────────────── STEP 3: Column Mapping ──────────────── */}
        {step === 3 && sheet && config && (
          <div className="space-y-4">
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
              const missing = config.fields.filter(f => f.required && !mappedFields.has(f.key))
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
              onNext={() => setStep(4)}
              nextDisabled={(() => {
                const mappedFields = new Set(Object.values(mapping))
                return config.fields.some(f => f.required && !mappedFields.has(f.key))
              })()}
              nextLabel={`Preview & Import (${sheet.rowCount.toLocaleString()} rows)`}
            />
          </div>
        )}

        {/* ─────────────────────── STEP 4: Preview & Import ────────────── */}
        {step === 4 && sheet && config && (
          <div className="space-y-5">
            {/* Summary */}
            <div className="grid grid-cols-3 gap-3 text-center">
              <div className="rounded-lg bg-gray-50 px-3 py-3">
                <div className="text-2xl font-bold text-gray-900">{sheet.rowCount.toLocaleString()}</div>
                <div className="text-xs text-gray-500 mt-0.5">Rows to import</div>
              </div>
              <div className="rounded-lg bg-gray-50 px-3 py-3">
                <div className="text-2xl font-bold text-gray-900">
                  {Object.values(mapping).filter(v => v !== SKIP).length}
                </div>
                <div className="text-xs text-gray-500 mt-0.5">Columns mapped</div>
              </div>
              <div className="rounded-lg bg-gray-50 px-3 py-3">
                <div className="text-2xl font-bold text-gray-900">{TABLE_CONFIG[targetTable as TargetTable]?.label.split(' ')[0]}</div>
                <div className="text-xs text-gray-500 mt-0.5">Target table</div>
              </div>
            </div>
            {bank && (targetTable === 'inflow_transactions' || targetTable === 'outflow_transactions') && (
              <div className="flex items-center gap-2 text-sm text-gray-600">
                <span className="text-xs font-medium text-gray-500">Bank</span>
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-primary/10 text-primary text-xs font-semibold border border-primary/20">
                  {bank.name}
                </span>
                <span className="text-xs text-gray-400">will be applied to all {sheet.rowCount.toLocaleString()} rows</span>
              </div>
            )}
            {/* Allocation config label */}
            {(targetTable === 'inflow_transactions' || targetTable === 'outflow_transactions') && (() => {
              const dateHeader = Object.keys(mapping).find(h => mapping[h] === 'date')
              const dateColIdx = dateHeader !== undefined ? sheet.headers.indexOf(dateHeader) : -1
              const firstDate  = dateColIdx >= 0 && sheet.rows[0] ? parseDate(sheet.rows[0][dateColIdx]) : null
              const cfg        = firstDate ? getConfigForDate(allocConfigs, firstDate) : null
              return cfg ? (
                <div className="flex items-center gap-2 text-xs rounded-lg px-3 py-2 bg-primary/5 border border-primary/20 text-primary">
                  Using: <strong>{cfg.name}</strong> — effective {formatDate(cfg.start_date)}
                  <span className="ml-auto text-gray-400">config applied per row date</span>
                </div>
              ) : firstDate ? (
                <div className="flex items-center gap-2 text-xs rounded-lg px-3 py-2 bg-amber-50 border border-amber-200 text-amber-700">
                  No allocation config found for {formatDate(firstDate)} — rows will be saved without an allocation
                </div>
              ) : null
            })()}

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
                        {bank && (targetTable === 'inflow_transactions' || targetTable === 'outflow_transactions') && (
                          <th className="px-3 py-2 text-left font-semibold text-primary whitespace-nowrap">Bank</th>
                        )}
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
                          {bank && (targetTable === 'inflow_transactions' || targetTable === 'outflow_transactions') && (
                            <td className="px-3 py-1.5 whitespace-nowrap">
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-primary/10 text-primary font-semibold">
                                {bank.name}
                              </span>
                            </td>
                          )}
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
                  {bank && (targetTable === 'inflow_transactions' || targetTable === 'outflow_transactions') && (
                    <div className="flex items-center gap-1.5 text-gray-600 pt-1">
                      <span className="text-xs">Bank:</span>
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-primary/10 text-primary text-xs font-semibold border border-primary/20">
                        {bank.name}
                      </span>
                    </div>
                  )}
                </div>
                {result.errors.length > 0 && (
                  <div className="mt-2 max-h-28 overflow-y-auto text-xs text-amber-700 bg-amber-100 rounded-lg p-3 space-y-0.5 font-mono">
                    {result.errors.map((e, i) => <div key={i}>{e}</div>)}
                  </div>
                )}
              </div>
            )}

            {/* Action buttons */}
            {!result ? (
              <NavButtons
                step={step}
                onBack={() => setStep(3)}
                onNext={runImport}
                nextDisabled={importing}
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
