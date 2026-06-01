import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  ArrowLeft, Save, Trash2, ChevronUp, ChevronDown,
  Type, BarChart2, Table2, AlertCircle, Check,
  Eye, Pencil, Plus, X, RefreshCw, Sigma,
  Link2, Printer, Camera, History, ChevronDown as ChevronDownIcon,
} from 'lucide-react'
import { Modal } from '../components/ui/Modal'
import { usePageTitle } from '../hooks/usePageTitle'
import {
  useDynamicReportBlocks,
  useUpdateDynamicReport,
  useSaveDynamicReportBlocks,
  useDynamicReports,
  useReportSnapshots,
  useSaveSnapshot,
  useDeleteSnapshot,
} from '../hooks/useDynamicReports'
import { useCategories } from '../hooks/useCategories'
import { useToastStore } from '../store/toastStore'
import { useOrgCurrency } from '../hooks/useOrgCurrency'
import { getCurrencySymbol, getCurrencyLocale } from '../utils/formatters'
import {
  parseTokens,
  resolveTokens,
  splitByTokens,
  buildTokenString,
  type ParsedToken,
  type TokenFn,
} from '../utils/reportTokenParser'
import {
  resolveTableBlock,
  type BudgetPortion,
  type TableRow,
  type QueryResult,
} from '../utils/reportQueryEngine'
import type {
  DynamicReport, DynamicReportBlockType,
  TextBlockConfig, MetricBlockConfig, TableBlockConfig, FormulaBlockConfig, FormulaTerm,
  DynamicReportSnapshot, SnapshotData, TextBlockEmbed,
} from '../types'

// ── Helpers ────────────────────────────────────────────────────────────────────

const FN_LABELS: Record<TokenFn, string> = {
  BALANCE:  'Balance',
  INFLOWS:  'Inflows',
  OUTFLOWS: 'Outflows',
  NET:      'Net Movement',
}

const PORTION_OPTIONS: Array<{ value: BudgetPortion; label: string }> = [
  { value: 'all',        label: 'All Funds'            },
  { value: 'seed',       label: 'Specific Seed'        },
  { value: 'savings',    label: 'Savings'              },
  { value: 'percentage', label: 'Percentage Allocation' },
]

const PORTION_SHORT: Record<string, string> = {
  seed:       ' · Seed',
  savings:    ' · Savings',
  percentage: ' · % Alloc',
}

function fmtNum(n: number, locale: string): string {
  return n.toLocaleString(locale, { minimumFractionDigits: 2 })
}

function fmtAmount(n: number, currency: string): string {
  const abs = Math.abs(n)
  const sym = getCurrencySymbol(currency)
  return (n < 0 ? '-' : '') + sym + fmtNum(abs, getCurrencyLocale(currency))
}

// ── Local block shape ──────────────────────────────────────────────────────────

interface EditorBlock {
  key: string
  block_type: DynamicReportBlockType
  config_json: Record<string, unknown>
}

function makeKey() {
  return Math.random().toString(36).slice(2)
}

// ── Insert block modal (metric / formula / table embed) ────────────────────────

type InsertTab = 'metric' | 'formula' | 'table'

function InsertBlockModal({
  open,
  onClose,
  categoryNames,
  onInsertMetric,
  onInsertEmbed,
}: {
  open: boolean
  onClose: () => void
  categoryNames: string[]
  onInsertMetric: (token: string) => void
  onInsertEmbed: (id: string, type: 'formula' | 'table', config: Record<string, unknown>) => void
}) {
  const { allCurrencies, baseCurrencyCode } = useOrgCurrency()
  const currencyOptions = allCurrencies.map(c => ({ value: c.code, label: `${c.symbol} ${c.code}` }))
  const [tab, setTab] = useState<InsertTab>('metric')

  // Metric state
  const [mFn,       setMFn]       = useState<TokenFn>('BALANCE')
  const [mCategory, setMCategory] = useState(categoryNames[0] ?? '')
  const [mPortion,  setMPortion]  = useState<BudgetPortion>('all')
  const [mDateFrom, setMDateFrom] = useState('')
  const [mDateTo,   setMDateTo]   = useState('')
  const [mDateField, setMDateField] = useState('date')

  // Formula state
  const [fTerms,    setFTerms]    = useState<FormulaTerm[]>([])
  const [fDateFrom, setFDateFrom] = useState('')
  const [fDateTo,   setFDateTo]   = useState('')
  const [fDateField, setFDateField] = useState('date')
  const [fCurrency, setFCurrency] = useState(baseCurrencyCode)
  const [fLabel,    setFLabel]    = useState('')

  // Table state
  const [tCats,     setTCats]     = useState<string[]>([])
  const [tCols,     setTCols]     = useState<string[]>(['inflows', 'outflows', 'balance'])
  const [tPortion,  setTPortion]  = useState<BudgetPortion>('all')
  const [tDateFrom, setTDateFrom] = useState('')
  const [tDateTo,   setTDateTo]   = useState('')
  const [tDateField, setTDateField] = useState('date')
  const [tCurrency, setTCurrency] = useState(baseCurrencyCode)
  const [tLabel,    setTLabel]    = useState('')

  // Reset on open
  useEffect(() => {
    if (!open) return
    setTab('metric')
    setMFn('BALANCE'); setMCategory(categoryNames[0] ?? ''); setMPortion('all')
    setMDateFrom(''); setMDateTo(''); setMDateField('date')
    setFTerms([]); setFDateFrom(''); setFDateTo(''); setFDateField('date'); setFCurrency(baseCurrencyCode); setFLabel('')
    setTCats([]); setTCols(['inflows', 'outflows', 'balance']); setTPortion('all')
    setTDateFrom(''); setTDateTo(''); setTDateField('date'); setTCurrency(baseCurrencyCode); setTLabel('')
  }, [open, categoryNames, baseCurrencyCode])

  const insertDisabled =
    tab === 'metric'  ? (mFn !== 'NET' && !mCategory.trim()) :
    tab === 'formula' ? fTerms.length === 0 :
    tCats.length === 0

  const handleInsert = () => {
    if (tab === 'metric') {
      const token = buildTokenString(
        mFn, mCategory.trim(),
        mPortion !== 'all' ? mPortion : undefined,
        mDateFrom || undefined, mDateTo || undefined,
        mDateField !== 'date' ? mDateField : undefined,
      )
      onInsertMetric(token)
    } else if (tab === 'formula') {
      onInsertEmbed(makeKey(), 'formula', {
        terms:          fTerms,
        dateFrom:       fDateFrom || undefined,
        dateTo:         fDateTo   || undefined,
        dateField:      fDateField !== 'date' ? fDateField : undefined,
        displayCurrency: fCurrency,
        label:          fLabel || undefined,
      })
    } else {
      onInsertEmbed(makeKey(), 'table', {
        categories:     tCats,
        columns:        tCols,
        portion:        tPortion,
        dateFrom:       tDateFrom || undefined,
        dateTo:         tDateTo   || undefined,
        dateField:      tDateField !== 'date' ? tDateField : undefined,
        displayCurrency: tCurrency,
        label:          tLabel || undefined,
      })
    }
    onClose()
  }

  const metricPreview = buildTokenString(
    mFn, mCategory.trim(),
    mPortion !== 'all' ? mPortion : undefined,
    mDateFrom || undefined, mDateTo || undefined,
    mDateField !== 'date' ? mDateField : undefined,
  )

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Insert into Text Block"
      size="max-w-lg"
      footer={
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleInsert}
            disabled={insertDisabled}
            className="px-4 py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary-light transition-colors disabled:opacity-40"
          >
            Insert
          </button>
        </div>
      }
    >
      {/* Tab bar */}
      <div className="flex rounded-lg border border-gray-200 overflow-hidden text-xs mb-4">
        {(['metric', 'formula', 'table'] as InsertTab[]).map(t => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`flex-1 py-2 font-medium capitalize transition-colors border-r border-gray-200 last:border-r-0 ${
              tab === t ? 'bg-primary text-white' : 'bg-white text-gray-600 hover:bg-gray-50'
            }`}
          >
            {t === 'metric' ? 'Metric' : t === 'formula' ? 'Formula' : 'Table'}
          </button>
        ))}
      </div>

      {/* ── Metric tab ── */}
      {tab === 'metric' && (
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Metric</label>
            <select value={mFn} onChange={e => setMFn(e.target.value as TokenFn)}
              className="w-full rounded-lg border border-gray-200 px-2.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30">
              {(Object.keys(FN_LABELS) as TokenFn[]).map(k => (
                <option key={k} value={k}>{FN_LABELS[k]}</option>
              ))}
            </select>
          </div>
          {mFn !== 'NET' && (
            <>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Category *</label>
                <select value={mCategory} onChange={e => setMCategory(e.target.value)}
                  className="w-full rounded-lg border border-gray-200 px-2.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30">
                  {categoryNames.length === 0 && <option value="">No categories found</option>}
                  {categoryNames.map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Budget Portion</label>
                <select value={mPortion} onChange={e => setMPortion(e.target.value as BudgetPortion)}
                  className="w-full rounded-lg border border-gray-200 px-2.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30">
                  {PORTION_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
            </>
          )}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">From (optional)</label>
              <input type="date" value={mDateFrom} onChange={e => setMDateFrom(e.target.value)}
                className="w-full rounded-lg border border-gray-200 px-2.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">To (optional)</label>
              <input type="date" value={mDateTo} onChange={e => setMDateTo(e.target.value)}
                className="w-full rounded-lg border border-gray-200 px-2.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
            </div>
          </div>
          <DateFieldToggle value={mDateField} onChange={setMDateField} />
          <div className="rounded-lg bg-gray-50 border border-gray-100 px-2.5 py-1.5 font-mono text-[11px] text-gray-500 break-all">
            {metricPreview}
          </div>
        </div>
      )}

      {/* ── Formula tab ── */}
      {tab === 'formula' && (
        <div className="space-y-3">
          <div className="space-y-2">
            {fTerms.length === 0 && (
              <p className="text-xs text-gray-400 italic py-2 text-center">Add at least one term to compute a result.</p>
            )}
            {fTerms.map((term, idx) => (
              <div key={idx} className="flex items-center gap-2 p-2 rounded-lg bg-gray-50 border border-gray-100">
                <button
                  type="button"
                  onClick={() => setFTerms(fTerms.map((t, i) => i === idx ? { ...t, sign: t.sign === '+' ? '-' : '+' } : t))}
                  className={`w-7 h-7 rounded-lg text-sm font-bold shrink-0 flex items-center justify-center border ${
                    term.sign === '+'
                      ? 'bg-success/10 text-success border-success/30'
                      : 'bg-danger/10 text-danger border-danger/30'
                  }`}
                >{term.sign}</button>
                <select value={term.fn}
                  onChange={e => setFTerms(fTerms.map((t, i) => i === idx ? { ...t, fn: e.target.value as FormulaTerm['fn'] } : t))}
                  className="rounded-lg border border-gray-200 px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-primary/30 w-28">
                  <option value="BALANCE">Balance</option>
                  <option value="INFLOWS">Inflows</option>
                  <option value="OUTFLOWS">Outflows</option>
                  <option value="NET">Net Movement</option>
                </select>
                {term.fn !== 'NET' && (
                  <select value={term.category ?? ''}
                    onChange={e => setFTerms(fTerms.map((t, i) => i === idx ? { ...t, category: e.target.value } : t))}
                    className="flex-1 min-w-0 rounded-lg border border-gray-200 px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-primary/30">
                    <option value="">— category —</option>
                    {categoryNames.map(n => <option key={n} value={n}>{n}</option>)}
                  </select>
                )}
                {term.fn !== 'NET' && (
                  <select value={term.portion ?? 'all'}
                    onChange={e => setFTerms(fTerms.map((t, i) => i === idx ? { ...t, portion: e.target.value } : t))}
                    className="rounded-lg border border-gray-200 px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-primary/30 w-28">
                    {PORTION_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                )}
                {term.fn === 'NET' && <span className="flex-1 text-xs text-gray-400 italic">all categories</span>}
                <button type="button"
                  onClick={() => setFTerms(fTerms.filter((_, i) => i !== idx))}
                  className="p-1 rounded text-gray-400 hover:text-danger shrink-0">
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
          <button type="button"
            onClick={() => setFTerms([...fTerms, { sign: '+', fn: 'BALANCE', category: categoryNames[0] ?? '', portion: 'all' }])}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-primary border border-primary/30 rounded-lg hover:bg-primary/5 transition-colors">
            <Plus className="w-3 h-3" /> Add term
          </button>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Date From</label>
              <input type="date" value={fDateFrom} onChange={e => setFDateFrom(e.target.value)}
                className="w-full rounded-lg border border-gray-200 px-2.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Date To</label>
              <input type="date" value={fDateTo} onChange={e => setFDateTo(e.target.value)}
                className="w-full rounded-lg border border-gray-200 px-2.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
            </div>
          </div>
          <DateFieldToggle value={fDateField} onChange={setFDateField} />
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Display Currency</label>
            <select value={fCurrency} onChange={e => setFCurrency(e.target.value)}
              className="w-full rounded-lg border border-gray-200 px-2.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30">
              {currencyOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Label (optional)</label>
            <input type="text" value={fLabel} onChange={e => setFLabel(e.target.value)}
              placeholder="e.g. Net Income"
              className="w-full rounded-lg border border-gray-200 px-2.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
          </div>
        </div>
      )}

      {/* ── Table tab ── */}
      {tab === 'table' && (
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">Categories</label>
            {tCats.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {tCats.map(cat => (
                  <span key={cat} className="inline-flex items-center gap-1 pl-2.5 pr-1.5 py-1 bg-primary/10 text-primary text-xs font-medium rounded-full">
                    {cat}
                    <button type="button" onClick={() => setTCats(tCats.filter(c => c !== cat))}
                      className="rounded-full hover:bg-primary/20 p-0.5">
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <select value="" onChange={e => { if (e.target.value) setTCats([...tCats, e.target.value]); e.target.value = '' }}
              className="w-full rounded-lg border border-gray-200 px-2.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 text-gray-500"
              disabled={categoryNames.filter(n => !tCats.includes(n)).length === 0}>
              <option value="">
                {categoryNames.filter(n => !tCats.includes(n)).length === 0 ? 'All categories added' : '+ Add a category…'}
              </option>
              {categoryNames.filter(n => !tCats.includes(n)).map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">Columns to show</label>
            <div className="flex items-center gap-4">
              {ALL_COLUMNS.map(c => (
                <label key={c.key} className="flex items-center gap-1.5 text-sm text-gray-700 cursor-pointer select-none">
                  <input type="checkbox" checked={tCols.includes(c.key)}
                    onChange={() => {
                      const next = tCols.includes(c.key) ? tCols.filter(x => x !== c.key) : [...tCols, c.key]
                      if (next.length > 0) setTCols(next)
                    }}
                    className="rounded border-gray-300 text-primary" />
                  {c.label}
                </label>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Budget Portion</label>
            <select value={tPortion} onChange={e => setTPortion(e.target.value as BudgetPortion)}
              className="w-full rounded-lg border border-gray-200 px-2.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30">
              {PORTION_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Date From</label>
              <input type="date" value={tDateFrom} onChange={e => setTDateFrom(e.target.value)}
                className="w-full rounded-lg border border-gray-200 px-2.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Date To</label>
              <input type="date" value={tDateTo} onChange={e => setTDateTo(e.target.value)}
                className="w-full rounded-lg border border-gray-200 px-2.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
            </div>
          </div>
          <DateFieldToggle value={tDateField} onChange={setTDateField} />
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Display Currency</label>
            <select value={tCurrency} onChange={e => setTCurrency(e.target.value)}
              className="w-full rounded-lg border border-gray-200 px-2.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30">
              {currencyOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Label (optional)</label>
            <input type="text" value={tLabel} onChange={e => setTLabel(e.target.value)}
              placeholder="e.g. Category Summary"
              className="w-full rounded-lg border border-gray-200 px-2.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
          </div>
        </div>
      )}
    </Modal>
  )
}

// ── Text block editor (with token insertion) ───────────────────────────────────

function TextBlockEditor({
  block,
  onChange,
  categoryNames,
}: {
  block: EditorBlock
  onChange: (cfg: Record<string, unknown>) => void
  categoryNames: string[]
}) {
  const cfg = block.config_json as Partial<TextBlockConfig>
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [showInsert, setShowInsert] = useState(false)
  const cursorRef = useRef(0)

  const insertAtCursor = (token: string, extraConfig?: Record<string, unknown>) => {
    const el = textareaRef.current
    const pos = cursorRef.current
    const current = cfg.text ?? ''
    const next = current.slice(0, pos) + token + current.slice(pos)
    onChange({ ...cfg, text: next, ...extraConfig })
    requestAnimationFrame(() => {
      if (el) {
        const newPos = pos + token.length
        el.setSelectionRange(newPos, newPos)
        el.focus()
      }
    })
  }

  const handleInsertMetric = (token: string) => {
    insertAtCursor(token)
  }

  const handleInsertEmbed = (id: string, type: 'formula' | 'table', config: Record<string, unknown>) => {
    const existing = Array.isArray(cfg.embeds) ? (cfg.embeds as TextBlockEmbed[]) : []
    insertAtCursor(`{{EMBED:${id}}}`, {
      embeds: [...existing, { id, type, config }],
    })
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => {
            cursorRef.current = textareaRef.current?.selectionStart ?? (cfg.text?.length ?? 0)
            setShowInsert(true)
          }}
          className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-primary border border-primary/30 rounded-lg hover:bg-primary/5 transition-colors"
        >
          <Plus className="w-3 h-3" />
          Insert
        </button>
        <span className="text-[10px] text-gray-400">
          metric, formula, or table — or type <code className="font-mono bg-gray-100 px-1 rounded">{'{{BALANCE:Cat}}'}</code> directly
        </span>
      </div>
      <textarea
        ref={textareaRef}
        rows={5}
        value={cfg.text ?? ''}
        onChange={e => onChange({ ...cfg, text: e.target.value })}
        onBlur={e => { cursorRef.current = e.target.selectionStart }}
        placeholder="Write notes here… Click 'Insert' to embed a live metric, formula result, or table."
        className="w-full resize-y rounded-lg border border-gray-200 px-3 py-2.5 text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 font-mono"
      />
      <InsertBlockModal
        open={showInsert}
        onClose={() => setShowInsert(false)}
        categoryNames={categoryNames}
        onInsertMetric={handleInsertMetric}
        onInsertEmbed={handleInsertEmbed}
      />
    </div>
  )
}

// ── Metric block editor ────────────────────────────────────────────────────────

function MetricBlockEditor({
  block,
  onChange,
  categoryNames,
}: {
  block: EditorBlock
  onChange: (cfg: Record<string, unknown>) => void
  categoryNames: string[]
}) {
  const { allCurrencies, baseCurrencyCode } = useOrgCurrency()
  const currencyOptions = allCurrencies.map(c => ({ value: c.code, label: `${c.symbol} ${c.code}` }))
  const cfg       = block.config_json as Record<string, string>
  const isNet     = cfg.fn === 'NET'
  const isInflows = cfg.fn === 'INFLOWS'

  return (
    <div className="grid grid-cols-2 gap-3">
      {/* Row 1: Metric + Category/Income Type */}
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Metric</label>
        <select
          value={cfg.fn ?? 'BALANCE'}
          onChange={e => onChange({ ...cfg, fn: e.target.value })}
          className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
        >
          <option value="BALANCE">Balance</option>
          <option value="INFLOWS">Inflows</option>
          <option value="OUTFLOWS">Outflows</option>
          <option value="NET">Net Movement</option>
        </select>
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">
          {isInflows ? 'Income Type *' : isNet ? 'Category (not needed)' : 'Category *'}
        </label>
        <select
          value={cfg.category ?? ''}
          onChange={e => onChange({ ...cfg, category: e.target.value })}
          disabled={isNet}
          className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:bg-gray-50 disabled:text-gray-400"
        >
          <option value="">— select {isInflows ? 'income type' : 'category'} —</option>
          {categoryNames.map(n => (
            <option key={n} value={n}>{n}</option>
          ))}
        </select>
      </div>

      {/* Budget Portion: Balance + Outflows only */}
      {!isNet && !isInflows && (
        <div className="col-span-2">
          <label className="block text-xs font-medium text-gray-600 mb-1">Budget Portion</label>
          <select
            value={cfg.portion ?? 'all'}
            onChange={e => onChange({ ...cfg, portion: e.target.value })}
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
          >
            {PORTION_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
      )}

      {/* Inflows: convenience single-date shortcut (sets both from + to) */}
      {isInflows && (
        <div className="col-span-2">
          <label className="block text-xs font-medium text-gray-600 mb-1">
            Recorded Date <span className="font-normal text-gray-400">(shortcut — sets both dates)</span>
          </label>
          <input
            type="date"
            value={cfg.dateFrom === cfg.dateTo ? cfg.dateFrom ?? '' : ''}
            onChange={e => onChange({ ...cfg, dateFrom: e.target.value, dateTo: e.target.value })}
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
          <p className="text-[10px] text-gray-400 mt-1">Sets a single day — or use Date From / Date To below for a range</p>
        </div>
      )}

      {/* Date range: all metric types */}
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Date From</label>
        <input
          type="date"
          value={cfg.dateFrom ?? ''}
          onChange={e => onChange({ ...cfg, dateFrom: e.target.value })}
          className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Date To</label>
        <input
          type="date"
          value={cfg.dateTo ?? ''}
          onChange={e => onChange({ ...cfg, dateTo: e.target.value })}
          className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
        />
      </div>

      {/* Date column selector — all metric types */}
      <DateFieldToggle
        value={cfg.dateField ?? 'date'}
        onChange={v => onChange({ ...cfg, dateField: v })}
      />

      {/* Display Currency */}
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Display Currency</label>
        <select
          value={(cfg.displayCurrency as string) ?? baseCurrencyCode}
          onChange={e => onChange({ ...cfg, displayCurrency: e.target.value })}
          className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
        >
          {currencyOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>

      <div className="col-span-2">
        <label className="block text-xs font-medium text-gray-600 mb-1">Label (optional)</label>
        <input
          type="text"
          value={cfg.label ?? ''}
          onChange={e => onChange({ ...cfg, label: e.target.value })}
          placeholder="e.g. Current Tithes Balance"
          className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
        />
      </div>
    </div>
  )
}

// ── Table block editor ─────────────────────────────────────────────────────────

const ALL_COLUMNS: Array<{ key: TableBlockConfig['columns'][number]; label: string }> = [
  { key: 'inflows',  label: 'Inflows'  },
  { key: 'outflows', label: 'Outflows' },
  { key: 'balance',  label: 'Balance'  },
]

function TableBlockEditor({
  block,
  onChange,
  categoryNames,
}: {
  block: EditorBlock
  onChange: (cfg: Record<string, unknown>) => void
  categoryNames: string[]
}) {
  const { allCurrencies, baseCurrencyCode } = useOrgCurrency()
  const currencyOptions = allCurrencies.map(c => ({ value: c.code, label: `${c.symbol} ${c.code}` }))
  const cfg = block.config_json as Partial<TableBlockConfig> & Record<string, unknown>
  const categories: string[] = Array.isArray(cfg.categories) ? cfg.categories : []
  const columns: string[] = Array.isArray(cfg.columns) && cfg.columns.length > 0
    ? cfg.columns
    : ['inflows', 'outflows', 'balance']

  const toggleColumn = (col: string) => {
    const next = columns.includes(col)
      ? columns.filter(c => c !== col)
      : [...columns, col]
    if (next.length === 0) return
    onChange({ ...cfg, columns: next })
  }

  const addCategory = (name: string) => {
    if (!name || categories.includes(name)) return
    onChange({ ...cfg, categories: [...categories, name] })
  }

  const removeCategory = (name: string) => {
    onChange({ ...cfg, categories: categories.filter(c => c !== name) })
  }

  const available = categoryNames.filter(n => !categories.includes(n))

  return (
    <div className="grid grid-cols-2 gap-3">
      {/* Category chips + dropdown */}
      <div className="col-span-2">
        <label className="block text-xs font-medium text-gray-600 mb-1.5">Categories</label>
        {categories.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-2">
            {categories.map(cat => (
              <span
                key={cat}
                className="inline-flex items-center gap-1 pl-2.5 pr-1.5 py-1 bg-primary/10 text-primary text-xs font-medium rounded-full"
              >
                {cat}
                <button
                  type="button"
                  onClick={() => removeCategory(cat)}
                  className="rounded-full hover:bg-primary/20 p-0.5 transition-colors"
                  aria-label={`Remove ${cat}`}
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
          </div>
        )}
        <select
          value=""
          onChange={e => { addCategory(e.target.value); e.target.value = '' }}
          className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 text-gray-500"
          disabled={available.length === 0}
        >
          <option value="">
            {available.length === 0
              ? categories.length === 0 ? 'No categories found' : 'All categories added'
              : '+ Add a category…'}
          </option>
          {available.map(n => (
            <option key={n} value={n}>{n}</option>
          ))}
        </select>
      </div>

      {/* Budget Portion */}
      <div className="col-span-2">
        <label className="block text-xs font-medium text-gray-600 mb-1">Budget Portion</label>
        <select
          value={(cfg.portion as string) ?? 'all'}
          onChange={e => onChange({ ...cfg, portion: e.target.value })}
          className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
        >
          {PORTION_OPTIONS.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Date From</label>
        <input
          type="date"
          value={(cfg.dateFrom as string) ?? ''}
          onChange={e => onChange({ ...cfg, dateFrom: e.target.value })}
          className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Date To</label>
        <input
          type="date"
          value={(cfg.dateTo as string) ?? ''}
          onChange={e => onChange({ ...cfg, dateTo: e.target.value })}
          className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
        />
      </div>
      <DateFieldToggle
        value={(cfg.dateField as string) ?? 'date'}
        onChange={v => onChange({ ...cfg, dateField: v })}
      />
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Display Currency</label>
        <select
          value={(cfg.displayCurrency as string) ?? baseCurrencyCode}
          onChange={e => onChange({ ...cfg, displayCurrency: e.target.value })}
          className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
        >
          {currencyOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>
      <div className="col-span-2">
        <label className="block text-xs font-medium text-gray-600 mb-1">Label (optional)</label>
        <input
          type="text"
          value={(cfg.label as string) ?? ''}
          onChange={e => onChange({ ...cfg, label: e.target.value })}
          placeholder="e.g. Category Summary"
          className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
        />
      </div>
      <div className="col-span-2">
        <label className="block text-xs font-medium text-gray-600 mb-1.5">Columns to show</label>
        <div className="flex items-center gap-4">
          {ALL_COLUMNS.map(c => (
            <label key={c.key} className="flex items-center gap-1.5 text-sm text-gray-700 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={columns.includes(c.key)}
                onChange={() => toggleColumn(c.key)}
                className="rounded border-gray-300 text-primary focus:ring-primary/30"
              />
              {c.label}
            </label>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Formula block editor ───────────────────────────────────────────────────────

function FormulaBlockEditor({
  block,
  onChange,
  categoryNames,
}: {
  block: EditorBlock
  onChange: (cfg: Record<string, unknown>) => void
  categoryNames: string[]
}) {
  const { allCurrencies, baseCurrencyCode } = useOrgCurrency()
  const currencyOptions = allCurrencies.map(c => ({ value: c.code, label: `${c.symbol} ${c.code}` }))
  const cfg = block.config_json as Partial<FormulaBlockConfig> & Record<string, unknown>
  const terms: FormulaTerm[] = Array.isArray(cfg.terms) ? cfg.terms : []

  const updateTerm = (idx: number, patch: Partial<FormulaTerm>) => {
    const next = terms.map((t, i) => (i === idx ? { ...t, ...patch } : t))
    onChange({ ...cfg, terms: next })
  }

  const addTerm = () => {
    const newTerm: FormulaTerm = {
      sign:     '+',
      fn:       'BALANCE',
      category: categoryNames[0] ?? '',
      portion:  'all',
    }
    onChange({ ...cfg, terms: [...terms, newTerm] })
  }

  const removeTerm = (idx: number) => {
    onChange({ ...cfg, terms: terms.filter((_, i) => i !== idx) })
  }

  return (
    <div className="space-y-3">
      {/* Terms list */}
      <div className="space-y-2">
        {terms.length === 0 && (
          <p className="text-xs text-gray-400 italic py-2 text-center">
            No terms yet — add at least two to compute a result.
          </p>
        )}
        {terms.map((term, idx) => (
          <div key={idx} className="flex items-center gap-2 p-2.5 rounded-lg bg-gray-50 border border-gray-100">
            {/* Sign toggle */}
            <button
              type="button"
              onClick={() => updateTerm(idx, { sign: term.sign === '+' ? '-' : '+' })}
              className={`w-7 h-7 rounded-lg text-sm font-bold shrink-0 flex items-center justify-center transition-colors border ${
                term.sign === '+'
                  ? 'bg-success/10 text-success border-success/30 hover:bg-success/20'
                  : 'bg-danger/10 text-danger border-danger/30 hover:bg-danger/20'
              }`}
              title="Click to toggle +/−"
            >
              {term.sign}
            </button>

            {/* Metric fn */}
            <select
              value={term.fn}
              onChange={e => updateTerm(idx, { fn: e.target.value as FormulaTerm['fn'], category: term.fn === 'NET' ? (categoryNames[0] ?? '') : term.category })}
              className="rounded-lg border border-gray-200 px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-primary/30 w-28"
            >
              <option value="BALANCE">Balance</option>
              <option value="INFLOWS">Inflows</option>
              <option value="OUTFLOWS">Outflows</option>
              <option value="NET">Net Movement</option>
            </select>

            {/* Category */}
            {term.fn !== 'NET' && (
              <select
                value={term.category ?? ''}
                onChange={e => updateTerm(idx, { category: e.target.value })}
                className="flex-1 min-w-0 rounded-lg border border-gray-200 px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-primary/30"
              >
                <option value="">— category —</option>
                {categoryNames.map(n => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            )}
            {term.fn === 'NET' && (
              <span className="flex-1 text-xs text-gray-400 italic px-2">all categories</span>
            )}

            {/* Portion */}
            {term.fn !== 'NET' && (
              <select
                value={term.portion ?? 'all'}
                onChange={e => updateTerm(idx, { portion: e.target.value })}
                className="rounded-lg border border-gray-200 px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-primary/30 w-36"
              >
                {PORTION_OPTIONS.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            )}

            {/* Remove */}
            <button
              type="button"
              onClick={() => removeTerm(idx)}
              className="p-1 rounded text-gray-400 hover:text-danger hover:bg-red-50 transition-colors shrink-0"
              title="Remove term"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={addTerm}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-primary border border-primary/30 rounded-lg hover:bg-primary/5 transition-colors"
      >
        <Plus className="w-3 h-3" />
        Add term
      </button>

      {/* Date range + label */}
      <div className="grid grid-cols-2 gap-3 pt-1">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Date From (all terms)</label>
          <input
            type="date"
            value={(cfg.dateFrom as string) ?? ''}
            onChange={e => onChange({ ...cfg, dateFrom: e.target.value })}
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Date To (all terms)</label>
          <input
            type="date"
            value={(cfg.dateTo as string) ?? ''}
            onChange={e => onChange({ ...cfg, dateTo: e.target.value })}
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        </div>
        <DateFieldToggle
          value={(cfg.dateField as string) ?? 'date'}
          onChange={v => onChange({ ...cfg, dateField: v })}
        />
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Display Currency</label>
          <select
            value={(cfg.displayCurrency as string) ?? baseCurrencyCode}
            onChange={e => onChange({ ...cfg, displayCurrency: e.target.value })}
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
          >
            {currencyOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div className="col-span-2">
          <label className="block text-xs font-medium text-gray-600 mb-1">Label (optional)</label>
          <input
            type="text"
            value={(cfg.label as string) ?? ''}
            onChange={e => onChange({ ...cfg, label: e.target.value })}
            placeholder="e.g. Net Tithes + Offering"
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        </div>
      </div>
    </div>
  )
}

// ── Shared date-field toggle ───────────────────────────────────────────────────

function DateFieldToggle({
  value,
  onChange,
}: {
  value: string
  onChange: (v: string) => void
}) {
  const isRecorded = value === 'recorded_at'
  return (
    <div className="col-span-2">
      <label className="block text-xs font-medium text-gray-600 mb-1.5">Filter Date Column</label>
      <div className="flex rounded-lg border border-gray-200 overflow-hidden text-xs">
        <button
          type="button"
          onClick={() => onChange('date')}
          className={`flex-1 px-3 py-2 transition-colors ${
            !isRecorded ? 'bg-primary text-white font-medium' : 'bg-white text-gray-600 hover:bg-gray-50'
          }`}
        >
          Transaction Date
        </button>
        <button
          type="button"
          onClick={() => onChange('recorded_at')}
          className={`flex-1 px-3 py-2 border-l border-gray-200 transition-colors ${
            isRecorded ? 'bg-primary text-white font-medium' : 'bg-white text-gray-600 hover:bg-gray-50'
          }`}
        >
          Recorded At
        </button>
      </div>
      <p className="text-[10px] text-gray-400 mt-1">
        {isRecorded
          ? 'Filters by when the transaction was entered into the system'
          : 'Filters by the transaction value date'}
      </p>
    </div>
  )
}

// ── Edit mode block card ───────────────────────────────────────────────────────

const BLOCK_META: Record<DynamicReportBlockType, { icon: React.ElementType; label: string }> = {
  text:    { icon: Type,      label: 'Text'    },
  metric:  { icon: BarChart2, label: 'Metric'  },
  table:   { icon: Table2,    label: 'Table'   },
  formula: { icon: Sigma,     label: 'Formula' },
}

function BlockCard({
  block, index, total, categoryNames, onChange, onDelete, onMoveUp, onMoveDown,
}: {
  block: EditorBlock
  index: number
  total: number
  categoryNames: string[]
  onChange: (cfg: Record<string, unknown>) => void
  onDelete: () => void
  onMoveUp: () => void
  onMoveDown: () => void
}) {
  const meta    = BLOCK_META[block.block_type]
  const Icon    = meta.icon
  const [open, setOpen] = useState(true)
  const bodyRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open && bodyRef.current) {
      setTimeout(() => {
        bodyRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
      }, 60)
    }
  }, [open])

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      {/* Header — click anywhere to collapse/expand */}
      <div
        role="button"
        onClick={() => setOpen(p => !p)}
        className="flex items-center gap-2 px-4 py-2.5 bg-gray-50 border-b border-gray-100 cursor-pointer select-none"
      >
        <div className="flex items-center gap-1.5 text-xs font-medium text-gray-500">
          <Icon className="w-3.5 h-3.5" />{meta.label}
        </div>
        <span className="text-[10px] text-gray-300 font-mono">#{index + 1}</span>
        <div className="ml-auto flex items-center gap-1" onClick={e => e.stopPropagation()}>
          <button onClick={onMoveUp} disabled={index === 0}
            className="p-1 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-200 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            title="Move up"><ChevronUp className="w-3.5 h-3.5" /></button>
          <button onClick={onMoveDown} disabled={index === total - 1}
            className="p-1 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-200 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            title="Move down"><ChevronDown className="w-3.5 h-3.5" /></button>
          <button onClick={onDelete}
            className="p-1 rounded text-gray-400 hover:text-danger hover:bg-red-50 transition-colors"
            title="Delete block"><Trash2 className="w-3.5 h-3.5" /></button>
        </div>
        <ChevronDown className={`w-3.5 h-3.5 text-gray-400 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
      </div>
      {open && (
        <div className="p-4" ref={bodyRef}>
          {block.block_type === 'text'    && <TextBlockEditor    block={block} onChange={onChange} categoryNames={categoryNames} />}
          {block.block_type === 'metric'  && <MetricBlockEditor  block={block} onChange={onChange} categoryNames={categoryNames} />}
          {block.block_type === 'table'   && <TableBlockEditor   block={block} onChange={onChange} categoryNames={categoryNames} />}
          {block.block_type === 'formula' && <FormulaBlockEditor block={block} onChange={onChange} categoryNames={categoryNames} />}
        </div>
      )}
    </div>
  )
}

// ── Preview renderers ──────────────────────────────────────────────────────────

function ResolvedValue({ result, currency }: { result: QueryResult | undefined; currency: string }) {
  if (!result) {
    return <span className="text-gray-300 text-xs font-mono animate-pulse">…</span>
  }
  if (result.error) {
    return (
      <span
        className="text-danger text-xs font-medium bg-red-50 px-1.5 py-0.5 rounded border border-red-200"
        title={result.error}
      >
        [error]
      </span>
    )
  }
  return (
    <span className={`font-mono font-semibold ${result.value < 0 ? 'text-danger' : 'text-success'}`}>
      {fmtAmount(result.value, currency)}
    </span>
  )
}

const EMBED_TOKEN_RE = /\{\{EMBED:([^}]+)\}\}/g

function TextBlockPreview({
  block,
  resolved,
  tableData,
}: {
  block: EditorBlock
  resolved: Map<string, QueryResult>
  tableData: Map<string, TableRow[]>
}) {
  const { baseCurrencyCode } = useOrgCurrency()
  const cfg    = block.config_json as Partial<TextBlockConfig>
  const text   = cfg.text ?? ''
  const embeds = (Array.isArray(cfg.embeds) ? cfg.embeds : []) as TextBlockEmbed[]

  if (!text.trim()) {
    return <p className="text-gray-300 italic text-sm">Empty text block</p>
  }

  // Split by metric tokens, then further split each string segment by {{EMBED:id}} tokens
  type Seg =
    | { kind: 'text';    content: string }
    | { kind: 'metric';  raw: string }
    | { kind: 'embed';   id: string }

  const segments: Seg[] = []
  for (const s of splitByTokens(text)) {
    if (typeof s !== 'string') {
      segments.push({ kind: 'metric', raw: s.raw })
      continue
    }
    EMBED_TOKEN_RE.lastIndex = 0
    let last = 0; let m: RegExpExecArray | null
    while ((m = EMBED_TOKEN_RE.exec(s)) !== null) {
      if (m.index > last) segments.push({ kind: 'text', content: s.slice(last, m.index) })
      segments.push({ kind: 'embed', id: m[1] })
      last = m.index + m[0].length
    }
    if (last < s.length) segments.push({ kind: 'text', content: s.slice(last) })
  }

  return (
    <div className="text-sm text-gray-800 leading-relaxed">
      {segments.map((seg, i) => {
        if (seg.kind === 'text') {
          return <span key={i} className="whitespace-pre-wrap">{seg.content}</span>
        }
        if (seg.kind === 'metric') {
          return <ResolvedValue key={i} result={resolved.get(seg.raw)} currency={baseCurrencyCode} />
        }
        // Embed
        const embed = embeds.find(e => e.id === seg.id)
        if (!embed) {
          return <span key={i} className="text-[10px] text-gray-300 font-mono">[missing embed]</span>
        }
        if (embed.type === 'formula') {
          const fCfg = embed.config as Partial<FormulaBlockConfig>
          const terms: FormulaTerm[] = Array.isArray(fCfg.terms) ? fCfg.terms : []
          const df = (fCfg.dateField as string | undefined) || undefined
          let total = 0; let pending = false
          for (const term of terms) {
            const pa  = term.portion && term.portion !== 'all' ? term.portion as BudgetPortion : undefined
            const key = buildTokenString(term.fn as TokenFn, term.category ?? '', pa,
              fCfg.dateFrom as string | undefined, fCfg.dateTo as string | undefined, df)
            const r = resolved.get(key)
            if (!r) { pending = true; break }
            if (r.error) return (
              <span key={i} className="text-danger text-xs font-medium bg-red-50 px-1.5 py-0.5 rounded border border-red-200" title={r.error}>[error]</span>
            )
            total += term.sign === '+' ? r.value : -r.value
          }
          if (pending || terms.length === 0) {
            return <span key={i} className="text-gray-300 text-xs font-mono animate-pulse">…</span>
          }
          return <ResolvedValue key={i} result={{ value: total, error: null }} currency={(fCfg.displayCurrency as string) ?? baseCurrencyCode} />
        }
        if (embed.type === 'table') {
          return (
            <div key={i} className="my-3">
              <TableBlockPreview
                block={{ key: seg.id, block_type: 'table', config_json: embed.config }}
                rows={tableData.get(seg.id)}
                resolving={false}
              />
            </div>
          )
        }
        return null
      })}
    </div>
  )
}

function MetricBlockPreview({
  block,
  resolved,
}: {
  block: EditorBlock
  resolved: Map<string, QueryResult>
}) {
  const { baseCurrencyCode } = useOrgCurrency()
  const cfg      = block.config_json as Partial<MetricBlockConfig>
  const fn       = cfg.fn ?? 'BALANCE'
  const category = cfg.category ?? ''
  const portion  = (cfg.portion as BudgetPortion | undefined) ?? 'all'
  const currency = cfg.displayCurrency ?? baseCurrencyCode
  const dateFrom = cfg.dateFrom
  const dateTo   = cfg.dateTo

  const tokenKey = buildTokenString(
    fn as TokenFn,
    category,
    portion !== 'all' ? portion : undefined,
    dateFrom || undefined,
    dateTo   || undefined,
  )
  const result = resolved.get(tokenKey)

  const portionSuffix = portion && portion !== 'all' ? (PORTION_SHORT[portion] ?? '') : ''
  const label = cfg.label || (fn === 'NET'
    ? 'Net Movement'
    : `${FN_LABELS[fn as TokenFn] ?? fn}${category ? ` — ${category}` : ''}${portionSuffix}`)

  const dateLabel = dateFrom && dateTo ? `${dateFrom} → ${dateTo}` : null

  return (
    <div className="rounded-xl border border-gray-200 bg-white px-5 py-4 flex items-start justify-between gap-4 shadow-sm">
      <div className="min-w-0">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide truncate">{label}</p>
        {dateLabel && (
          <p className="text-[10px] text-gray-400 mt-0.5">{dateLabel}</p>
        )}
      </div>
      <div className="text-2xl font-bold tabular-nums shrink-0">
        <ResolvedValue result={result} currency={currency} />
      </div>
    </div>
  )
}

function TableBlockPreview({
  block,
  rows,
  resolving,
}: {
  block: EditorBlock
  rows: TableRow[] | undefined
  resolving: boolean
}) {
  const { baseCurrencyCode } = useOrgCurrency()
  const cfg      = block.config_json as Partial<TableBlockConfig>
  const currency = cfg.displayCurrency ?? baseCurrencyCode
  const label    = cfg.label || 'Financial Summary'
  const cats    = Array.isArray(cfg.categories) ? cfg.categories : []
  const colKeys: Array<'inflows' | 'outflows' | 'balance'> =
    Array.isArray(cfg.columns) && cfg.columns.length > 0
      ? cfg.columns
      : ['inflows', 'outflows', 'balance']
  const colLabels: Record<string, string> = {
    inflows: 'Inflows', outflows: 'Outflows', balance: 'Balance',
  }

  if (cats.length === 0) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white overflow-hidden shadow-sm">
        <div className="px-5 py-3 border-b border-gray-100">
          <p className="text-sm font-semibold text-gray-700">{label}</p>
        </div>
        <p className="px-5 py-8 text-center text-sm text-gray-400">
          No categories configured — edit this block to add categories.
        </p>
      </div>
    )
  }

  // Compute totals
  const totals = { inflows: 0, outflows: 0, balance: 0 }
  for (const r of rows ?? []) {
    totals.inflows  += r.inflows
    totals.outflows += r.outflows
    totals.balance  += r.balance
  }

  const amtCls = (v: number) =>
    v < 0 ? 'text-danger font-mono font-semibold' : 'text-gray-900 font-mono font-semibold'

  return (
    <div className="rounded-xl border border-gray-200 bg-white overflow-hidden shadow-sm">
      {/* Table header */}
      <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
        <p className="text-sm font-semibold text-gray-700">{label}</p>
        {cfg.dateFrom && cfg.dateTo && (
          <p className="text-[10px] text-gray-400 font-mono">{cfg.dateFrom} → {cfg.dateTo}</p>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-100">
              <th className="px-5 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">
                Category
              </th>
              {colKeys.map(col => (
                <th key={col} className="px-5 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wide">
                  {colLabels[col]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {/* Loading skeleton */}
            {resolving && cats.map(cat => (
              <tr key={cat}>
                <td className="px-5 py-3 text-gray-700 font-medium">{cat}</td>
                {colKeys.map(col => (
                  <td key={col} className="px-5 py-3 text-right">
                    <span className="inline-block h-4 w-20 bg-gray-100 rounded animate-pulse" />
                  </td>
                ))}
              </tr>
            ))}

            {/* Data rows */}
            {!resolving && (rows ?? []).map(row => (
              <tr key={row.category} className="hover:bg-gray-50 transition-colors">
                <td className="px-5 py-3 text-gray-800 font-medium">{row.category}</td>
                {colKeys.map(col => {
                  const err = col === 'outflows' ? row.outflowError : (col === 'inflows' ? row.inflowError : (row.inflowError || row.outflowError))
                  if (err) {
                    return (
                      <td key={col} className="px-5 py-3 text-right text-danger text-xs" title={err}>
                        [error]
                      </td>
                    )
                  }
                  const val = row[col as keyof Pick<TableRow, 'inflows' | 'outflows' | 'balance'>]
                  return (
                    <td key={col} className={`px-5 py-3 text-right ${amtCls(val)}`}>
                      {fmtAmount(val, currency)}
                    </td>
                  )
                })}
              </tr>
            ))}

            {/* Empty — categories set but no rows resolved yet */}
            {!resolving && (!rows || rows.length === 0) && (
              <tr>
                <td colSpan={1 + colKeys.length} className="px-5 py-8 text-center text-sm text-gray-400">
                  No data found for the configured categories.
                </td>
              </tr>
            )}
          </tbody>

          {/* Totals row */}
          {!resolving && rows && rows.length > 0 && (
            <tfoot>
              <tr className="bg-gray-50 border-t-2 border-gray-200 font-bold">
                <td className="px-5 py-3 text-gray-700">Total</td>
                {colKeys.map(col => (
                  <td key={col} className={`px-5 py-3 text-right ${amtCls(totals[col as keyof typeof totals])}`}>
                    {fmtAmount(totals[col as keyof typeof totals], currency)}
                  </td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  )
}

// ── Formula block preview ──────────────────────────────────────────────────────

function FormulaBlockPreview({
  block,
  resolved,
  resolving,
}: {
  block: EditorBlock
  resolved: Map<string, QueryResult>
  resolving: boolean
}) {
  const { baseCurrencyCode } = useOrgCurrency()
  const cfg       = block.config_json as Partial<FormulaBlockConfig>
  const terms     = cfg.terms ?? []
  const currency  = cfg.displayCurrency ?? baseCurrencyCode
  const dateFrom  = cfg.dateFrom
  const dateTo    = cfg.dateTo
  const dateField = (cfg.dateField as string | undefined) || undefined
  const label     = cfg.label || 'Formula Result'
  const dateLabel = dateFrom && dateTo ? `${dateFrom} → ${dateTo}` : null

  if (terms.length === 0) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white px-5 py-4 shadow-sm">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">{label}</p>
        <p className="text-sm text-gray-400 mt-2 italic">No terms configured — edit this block to add metrics.</p>
      </div>
    )
  }

  // Compute total from resolved values
  let total = 0
  let hasError = false

  const termRows = terms.map(term => {
    const portionArg = term.portion && term.portion !== 'all'
      ? term.portion as BudgetPortion
      : undefined
    const key = buildTokenString(term.fn as TokenFn, term.category ?? '', portionArg, dateFrom, dateTo, dateField)
    const result = resolved.get(key)
    if (result && !result.error) {
      total += term.sign === '-' ? -result.value : result.value
    }
    if (result?.error) hasError = true

    // Build a readable description for this term
    const fnLabel  = FN_LABELS[term.fn as TokenFn] ?? term.fn
    const catPart  = term.fn !== 'NET' && term.category ? ` · ${term.category}` : ''
    const portPart = portionArg ? (PORTION_SHORT[portionArg] ?? '') : ''
    const desc     = `${fnLabel}${catPart}${portPart}`

    return { term, key, result, desc }
  })

  const amtCls = (v: number) =>
    v < 0 ? 'text-danger font-mono font-semibold' : 'text-success font-mono font-semibold'

  return (
    <div className="rounded-xl border border-gray-200 bg-white overflow-hidden shadow-sm">
      <div className="px-5 py-3 border-b border-gray-100 flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">{label}</p>
          {dateLabel && <p className="text-[10px] text-gray-400 mt-0.5 font-mono">{dateLabel}</p>}
        </div>
        <Sigma className="w-4 h-4 text-gray-300 shrink-0 mt-0.5" />
      </div>

      <div className="px-5 py-3 space-y-1.5">
        {/* Term breakdown */}
        {termRows.map((row, i) => (
          <div key={i} className="flex items-center justify-between gap-3 text-sm">
            <div className="flex items-center gap-2 min-w-0">
              <span className={`text-xs font-bold w-4 shrink-0 ${row.term.sign === '+' ? 'text-success' : 'text-danger'}`}>
                {row.term.sign}
              </span>
              <span className="text-gray-600 truncate text-xs">{row.desc}</span>
            </div>
            {resolving ? (
              <span className="inline-block h-4 w-24 bg-gray-100 rounded animate-pulse shrink-0" />
            ) : row.result?.error ? (
              <span className="text-danger text-xs font-medium bg-red-50 px-1.5 py-0.5 rounded border border-red-200 shrink-0" title={row.result.error}>
                [error]
              </span>
            ) : (
              <span className={`shrink-0 text-sm ${amtCls(row.result?.value ?? 0)}`}>
                {fmtAmount(row.result?.value ?? 0, currency)}
              </span>
            )}
          </div>
        ))}

        {/* Divider + total */}
        <div className="border-t border-gray-200 pt-2 mt-1 flex items-center justify-between">
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Total</span>
          {resolving ? (
            <span className="inline-block h-5 w-28 bg-gray-100 rounded animate-pulse" />
          ) : hasError ? (
            <span className="text-danger text-xs font-medium">Partial result</span>
          ) : (
            <span className={`text-xl font-bold tabular-nums ${amtCls(total)}`}>
              {fmtAmount(total, currency)}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Token collection helpers ───────────────────────────────────────────────────

function collectTokensFromBlocks(blocks: EditorBlock[]): ParsedToken[] {
  const tokens: ParsedToken[] = []
  for (const b of blocks) {
    if (b.block_type === 'text') {
      const cfg = b.config_json as Partial<TextBlockConfig>
      tokens.push(...parseTokens(cfg.text ?? ''))
      // Collect metric tokens from formula embeds stored in this text block
      const embeds = (Array.isArray(cfg.embeds) ? cfg.embeds : []) as TextBlockEmbed[]
      for (const embed of embeds) {
        if (embed.type !== 'formula') continue
        const fCfg = embed.config as Partial<FormulaBlockConfig>
        const df   = (fCfg.dateField as string | undefined) || undefined
        for (const term of (fCfg.terms ?? []) as FormulaTerm[]) {
          if (term.fn !== 'NET' && !term.category) continue
          const pa = term.portion && term.portion !== 'all' ? term.portion as BudgetPortion : undefined
          tokens.push({
            raw:       buildTokenString(term.fn as TokenFn, term.category ?? '', pa,
              fCfg.dateFrom as string | undefined, fCfg.dateTo as string | undefined, df),
            fn:        term.fn as TokenFn,
            category:  term.category ?? '',
            portion:   pa,
            dateFrom:  fCfg.dateFrom as string | undefined,
            dateTo:    fCfg.dateTo   as string | undefined,
            dateField: df,
          })
        }
      }
    } else if (b.block_type === 'metric') {
      const cfg = b.config_json as Partial<MetricBlockConfig>
      if (!cfg.fn) continue
      const portion    = (cfg.portion as BudgetPortion | undefined) ?? 'all'
      const portionArg = portion !== 'all' ? portion : undefined
      const df         = cfg.dateField || undefined
      tokens.push({
        raw:       buildTokenString(
          cfg.fn as TokenFn,
          cfg.category ?? '',
          portionArg,
          cfg.dateFrom || undefined,
          cfg.dateTo   || undefined,
          df,
        ),
        fn:        cfg.fn as TokenFn,
        category:  cfg.category ?? '',
        portion:   portionArg,
        dateFrom:  cfg.dateFrom || undefined,
        dateTo:    cfg.dateTo   || undefined,
        dateField: df,
      })
    } else if (b.block_type === 'formula') {
      const cfg = b.config_json as Partial<FormulaBlockConfig>
      const df  = cfg.dateField || undefined
      for (const term of cfg.terms ?? []) {
        if (term.fn !== 'NET' && !term.category) continue
        const portionArg = term.portion && term.portion !== 'all'
          ? term.portion as BudgetPortion
          : undefined
        tokens.push({
          raw:       buildTokenString(
            term.fn as TokenFn,
            term.category ?? '',
            portionArg,
            cfg.dateFrom || undefined,
            cfg.dateTo   || undefined,
            df,
          ),
          fn:        term.fn as TokenFn,
          category:  term.category ?? '',
          portion:   portionArg,
          dateFrom:  cfg.dateFrom || undefined,
          dateTo:    cfg.dateTo   || undefined,
          dateField: df,
        })
      }
    }
  }
  return tokens
}

// ── Main editor ────────────────────────────────────────────────────────────────

export default function DynamicReportEditor() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { push: pushToast } = useToastStore()

  const { reports, loading: reportsLoading } = useDynamicReports()
  const report: DynamicReport | undefined = reports.find(r => r.id === id)
  const { categories } = useCategories()
  const categoryNames = categories.map(c => c.name)

  const { blocks: savedBlocks, loading: blocksLoading } = useDynamicReportBlocks(id ?? null)
  const { mutate: updateTitle }  = useUpdateDynamicReport()
  const { mutate: saveBlocks, loading: saving } = useSaveDynamicReportBlocks()
  const { snapshots, refetch: refetchSnapshots } = useReportSnapshots(id ?? null)
  const { mutate: saveSnapshot, loading: savingSnapshot } = useSaveSnapshot()
  const { mutate: deleteSnapshot } = useDeleteSnapshot()

  const [mode,    setMode]    = useState<'edit' | 'preview'>('edit')
  const [title,   setTitle]   = useState('')
  const [blocks,  setBlocks]  = useState<EditorBlock[]>([])
  const [isDirty, setIsDirty] = useState(false)
  const [saved,   setSaved]   = useState(false)

  // Token resolution state
  const [resolved,   setResolved]   = useState<Map<string, QueryResult>>(new Map())
  const [tableData,  setTableData]  = useState<Map<string, TableRow[]>>(new Map())
  const [resolving,  setResolving]  = useState(false)

  // Phase 5: share, snapshot, viewing
  const [linkCopied,       setLinkCopied]       = useState(false)
  const [snapshotLabel,    setSnapshotLabel]    = useState('')
  const [showSnapshotPanel, setShowSnapshotPanel] = useState(false)
  const [viewingSnapshot,  setViewingSnapshot]  = useState<DynamicReportSnapshot | null>(null)

  usePageTitle(title || 'Report Editor')

  useEffect(() => {
    if (report) setTitle(report.title)
  }, [report])

  useEffect(() => {
    if (!blocksLoading) {
      setBlocks(
        savedBlocks.map(b => ({ key: b.id, block_type: b.block_type, config_json: b.config_json })),
      )
    }
  }, [savedBlocks, blocksLoading])

  // Resolve tokens whenever we enter preview mode or blocks change in preview
  const resolveAll = useCallback(async (currentBlocks: EditorBlock[]) => {
    setResolving(true)

    // Resolve text + metric tokens
    const tokens = collectTokensFromBlocks(currentBlocks)
    const tokenMap = tokens.length > 0 ? await resolveTokens(tokens) : new Map<string, QueryResult>()
    setResolved(tokenMap)

    // Resolve table blocks in parallel
    const tableBlocks = currentBlocks.filter(b => b.block_type === 'table')
    const tableResults = await Promise.all(
      tableBlocks.map(async b => {
        const cfg     = b.config_json as Partial<TableBlockConfig>
        const cats    = Array.isArray(cfg.categories) ? cfg.categories.filter(Boolean) : []
        if (cats.length === 0) return { key: b.key, rows: [] as TableRow[] }
        const dr      = cfg.dateFrom && cfg.dateTo
          ? { from: cfg.dateFrom, to: cfg.dateTo }
          : undefined
        const portion = (cfg.portion as BudgetPortion | undefined) ?? 'all'
        const df      = (cfg.dateField as string | undefined) || undefined
        const rows    = await resolveTableBlock(cats, dr, portion !== 'all' ? portion : undefined, df)
          .catch(() => [] as TableRow[])
        return { key: b.key, rows }
      }),
    )
    const tMap = new Map<string, TableRow[]>()
    for (const r of tableResults) tMap.set(r.key, r.rows)

    // Resolve table embeds stored inside text blocks
    const textEmbedResults = await Promise.all(
      currentBlocks
        .filter(b => b.block_type === 'text')
        .flatMap(b => {
          const cfg    = b.config_json as Partial<TextBlockConfig>
          const embeds = (Array.isArray(cfg.embeds) ? cfg.embeds : []) as TextBlockEmbed[]
          return embeds
            .filter(e => e.type === 'table')
            .map(async e => {
              const tCfg = e.config as Partial<TableBlockConfig>
              const cats = (Array.isArray(tCfg.categories) ? tCfg.categories : []).filter(Boolean) as string[]
              if (cats.length === 0) return { key: e.id, rows: [] as TableRow[] }
              const dr      = tCfg.dateFrom && tCfg.dateTo
                ? { from: tCfg.dateFrom as string, to: tCfg.dateTo as string }
                : undefined
              const portion = (tCfg.portion as BudgetPortion | undefined) ?? 'all'
              const df      = (tCfg.dateField as string | undefined) || undefined
              const rows    = await resolveTableBlock(cats, dr, portion !== 'all' ? portion : undefined, df)
                .catch(() => [] as TableRow[])
              return { key: e.id, rows }
            })
        }),
    )
    for (const r of textEmbedResults) tMap.set(r.key, r.rows)

    setTableData(tMap)

    setResolving(false)
  }, [])

  useEffect(() => {
    if (mode === 'preview') resolveAll(blocks)
  }, [mode, resolveAll]) // resolve on enter preview; blocks re-resolves only via manual refresh

  const addBlock = useCallback((type: DynamicReportBlockType) => {
    const defaults: Record<DynamicReportBlockType, Record<string, unknown>> = {
      text:    { text: '' },
      metric:  { fn: 'BALANCE', category: '', portion: 'all', dateFrom: '', dateTo: '', label: '' },
      table:   { categories: [], portion: 'all', dateFrom: '', dateTo: '', label: '' },
      formula: { terms: [], dateFrom: '', dateTo: '', label: '' },
    }
    setBlocks(prev => [...prev, { key: makeKey(), block_type: type, config_json: defaults[type] }])
    setIsDirty(true)
  }, [])

  const updateBlock = useCallback((key: string, cfg: Record<string, unknown>) => {
    setBlocks(prev => prev.map(b => b.key === key ? { ...b, config_json: cfg } : b))
    setIsDirty(true)
  }, [])

  const deleteBlock = useCallback((key: string) => {
    setBlocks(prev => prev.filter(b => b.key !== key))
    setIsDirty(true)
  }, [])

  const moveBlock = useCallback((key: string, dir: -1 | 1) => {
    setBlocks(prev => {
      const idx  = prev.findIndex(b => b.key === key)
      const next = idx + dir
      if (idx < 0 || next < 0 || next >= prev.length) return prev
      const arr = [...prev];
      [arr[idx], arr[next]] = [arr[next], arr[idx]]
      return arr
    })
    setIsDirty(true)
  }, [])

  // Compute display maps: snapshot overrides live when viewing a snapshot
  const displayResolved: Map<string, QueryResult> = viewingSnapshot
    ? new Map(
        Object.entries(viewingSnapshot.data.resolved).map(([k, v]) => [k, { value: v, error: null }]),
      )
    : resolved

  const displayTableData: Map<string, TableRow[]> = viewingSnapshot
    ? new Map(Object.entries(viewingSnapshot.data.tableData) as [string, TableRow[]][])
    : tableData

  const handleCopyLink = () => {
    navigator.clipboard.writeText(window.location.href).catch(() => {})
    setLinkCopied(true)
    setTimeout(() => setLinkCopied(false), 2000)
  }

  const handleSaveSnapshot = useCallback(async () => {
    if (!id) return
    const label = snapshotLabel.trim() || new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
    const data: SnapshotData = {
      resolvedAt: new Date().toISOString(),
      resolved:   Object.fromEntries(
        Array.from(resolved.entries())
          .filter(([, v]) => !v.error)
          .map(([k, v]) => [k, v.value]),
      ),
      tableData: Object.fromEntries(Array.from(tableData.entries())),
    }
    const ok = await saveSnapshot(id, label, data)
    if (ok) {
      setSnapshotLabel('')
      refetchSnapshots()
      pushToast('Snapshot saved', 'success')
    } else {
      pushToast('Failed to save snapshot', 'error')
    }
  }, [id, snapshotLabel, resolved, tableData, saveSnapshot, refetchSnapshots, pushToast])

  const handleDeleteSnapshot = useCallback(async (snapshotId: string) => {
    const ok = await deleteSnapshot(snapshotId)
    if (ok) {
      if (viewingSnapshot?.id === snapshotId) setViewingSnapshot(null)
      refetchSnapshots()
    }
  }, [deleteSnapshot, viewingSnapshot, refetchSnapshots])

  const handleSave = useCallback(async () => {
    if (!id) return
    const trimmedTitle = title.trim() || 'Untitled Report'
    const [, blocksOk] = await Promise.all([
      updateTitle(id, trimmedTitle),
      saveBlocks(id, blocks.map((b, i) => ({
        block_type:  b.block_type,
        position:    i,
        config_json: b.config_json,
      }))),
    ])
    if (blocksOk) {
      setTitle(trimmedTitle)
      setIsDirty(false)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
      pushToast('Report saved', 'success')
    } else {
      pushToast('Failed to save report', 'error')
    }
  }, [id, title, blocks, updateTitle, saveBlocks, pushToast])

  const loading = reportsLoading || blocksLoading

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-48 bg-gray-200 rounded animate-pulse" />
        <div className="h-40 bg-gray-100 rounded-xl animate-pulse" />
      </div>
    )
  }

  if (!report && !reportsLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <AlertCircle className="w-10 h-10 text-gray-300 mb-3" />
        <p className="text-sm text-gray-500">Report not found.</p>
        <button onClick={() => navigate('/dynamic-reports')} className="mt-4 text-sm text-primary hover:underline">
          Back to reports
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <button
          onClick={() => navigate('/dynamic-reports')}
          className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors self-start"
        >
          <ArrowLeft className="w-4 h-4" />
          All Reports
        </button>
        <div className="flex-1 flex items-center gap-3 min-w-0">
          <input
            value={title}
            onChange={e => { setTitle(e.target.value); setIsDirty(true) }}
            className="flex-1 min-w-0 text-xl font-bold text-gray-900 bg-transparent border-b-2 border-transparent focus:border-primary outline-none transition-colors"
            placeholder="Untitled Report"
          />
        </div>
        <div className="flex items-center gap-2 shrink-0 no-print">
          {/* Share + Print (preview only) */}
          {mode === 'preview' && (
            <>
              <button
                onClick={handleCopyLink}
                title="Copy shareable link"
                className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
              >
                {linkCopied ? <Check className="w-3.5 h-3.5 text-success" /> : <Link2 className="w-3.5 h-3.5" />}
                {linkCopied ? 'Copied!' : 'Share'}
              </button>
              <button
                onClick={() => window.print()}
                title="Print report"
                className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
              >
                <Printer className="w-3.5 h-3.5" />Print
              </button>
            </>
          )}
          {/* Edit / Preview toggle */}
          <div className="flex items-center bg-gray-100 rounded-lg p-1 gap-1">
            <button
              onClick={() => setMode('edit')}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                mode === 'edit' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              <Pencil className="w-3 h-3" />Edit
            </button>
            <button
              onClick={() => setMode('preview')}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                mode === 'preview' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              <Eye className="w-3 h-3" />Preview
            </button>
          </div>
          <button
            onClick={handleSave}
            disabled={saving || !isDirty}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
              saved
                ? 'bg-success/10 text-success border border-success/20'
                : 'bg-primary text-white hover:bg-primary-light disabled:opacity-40'
            }`}
          >
            {saved ? <><Check className="w-4 h-4" />Saved</> : <><Save className="w-4 h-4" />{saving ? 'Saving…' : 'Save'}</>}
          </button>
        </div>
      </div>

      {/* ── Edit mode ── */}
      {mode === 'edit' && (
        <>
          <div className="space-y-3">
            {blocks.map((block, index) => (
              <BlockCard
                key={block.key}
                block={block}
                index={index}
                total={blocks.length}
                categoryNames={categoryNames}
                onChange={cfg => updateBlock(block.key, cfg)}
                onDelete={() => deleteBlock(block.key)}
                onMoveUp={() => moveBlock(block.key, -1)}
                onMoveDown={() => moveBlock(block.key, 1)}
              />
            ))}
            {blocks.length === 0 && (
              <div className="flex flex-col items-center justify-center py-12 border-2 border-dashed border-gray-200 rounded-xl text-center">
                <p className="text-sm text-gray-400">No blocks yet — add one below</p>
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-gray-400 self-center">Add block:</span>
            <button onClick={() => addBlock('text')}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">
              <Type className="w-3.5 h-3.5" />Text
            </button>
            <button onClick={() => addBlock('metric')}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">
              <BarChart2 className="w-3.5 h-3.5" />Metric
            </button>
            <button onClick={() => addBlock('table')}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">
              <Table2 className="w-3.5 h-3.5" />Table
            </button>
            <button onClick={() => addBlock('formula')}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">
              <Sigma className="w-3.5 h-3.5" />Formula
            </button>
            {isDirty && <span className="text-xs text-gray-400 ml-auto">Unsaved changes</span>}
          </div>

          {blocks.length > 0 && (
            <div className="flex justify-end">
              <button
                onClick={handleSave}
                disabled={saving || !isDirty}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary-light transition-colors disabled:opacity-40"
              >
                <Save className="w-4 h-4" />{saving ? 'Saving…' : 'Save Report'}
              </button>
            </div>
          )}
        </>
      )}

      {/* ── Preview mode ── */}
      {mode === 'preview' && (
        <div className="space-y-4">
          {/* Status bar — snapshot vs live */}
          <div className="flex items-center justify-between no-print">
            {viewingSnapshot ? (
              <p className="text-xs text-amber-600 font-medium flex items-center gap-1.5">
                <History className="w-3.5 h-3.5" />
                Snapshot: {viewingSnapshot.label} &middot; {new Date(viewingSnapshot.snapshot_at).toLocaleString()}
              </p>
            ) : (
              <p className="text-xs text-gray-400">
                {resolving ? 'Fetching live data…' : 'Live data — values from your finance records'}
              </p>
            )}
            {viewingSnapshot ? (
              <button
                onClick={() => setViewingSnapshot(null)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-lg hover:bg-amber-100 transition-colors"
              >
                <RefreshCw className="w-3 h-3" />Return to live
              </button>
            ) : (
              <button
                onClick={() => resolveAll(blocks)}
                disabled={resolving}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
              >
                <RefreshCw className={`w-3 h-3 ${resolving ? 'animate-spin' : ''}`} />
                Refresh
              </button>
            )}
          </div>

          {blocks.length === 0 && (
            <div className="py-16 text-center text-sm text-gray-400">
              No blocks — switch to Edit mode to add content.
            </div>
          )}

          {/* Blocks rendered with displayResolved / displayTableData */}
          {blocks.map(block => (
            <div key={block.key}>
              {block.block_type === 'text' && (
                <TextBlockPreview block={block} resolved={displayResolved} tableData={displayTableData} />
              )}
              {block.block_type === 'metric' && (
                <MetricBlockPreview block={block} resolved={displayResolved} />
              )}
              {block.block_type === 'table' && (
                <TableBlockPreview
                  block={block}
                  rows={displayTableData.get(block.key)}
                  resolving={resolving && !viewingSnapshot}
                />
              )}
              {block.block_type === 'formula' && (
                <FormulaBlockPreview
                  block={block}
                  resolved={displayResolved}
                  resolving={resolving && !viewingSnapshot}
                />
              )}
            </div>
          ))}

          {/* ── Snapshots panel ── */}
          <div className="mt-6 border-t border-gray-100 pt-4 no-print">
            <button
              onClick={() => setShowSnapshotPanel(p => !p)}
              className="flex items-center gap-2 text-xs font-medium text-gray-500 hover:text-gray-700 transition-colors w-full"
            >
              <History className="w-3.5 h-3.5" />
              Snapshots ({snapshots.length})
              <ChevronDownIcon className={`w-3.5 h-3.5 ml-auto transition-transform ${showSnapshotPanel ? 'rotate-180' : ''}`} />
            </button>

            {showSnapshotPanel && (
              <div className="mt-3 space-y-3">
                {/* Save current state */}
                <div className="flex items-center gap-2 p-3 rounded-xl bg-gray-50 border border-gray-100">
                  <Camera className="w-4 h-4 text-gray-400 shrink-0" />
                  <input
                    type="text"
                    value={snapshotLabel}
                    onChange={e => setSnapshotLabel(e.target.value)}
                    placeholder="Snapshot label (e.g. May 2026)"
                    className="flex-1 min-w-0 text-xs border-none bg-transparent outline-none text-gray-700 placeholder-gray-400"
                    onKeyDown={e => { if (e.key === 'Enter') handleSaveSnapshot() }}
                  />
                  <button
                    onClick={handleSaveSnapshot}
                    disabled={savingSnapshot || resolving}
                    className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-white bg-primary rounded-lg hover:bg-primary-light disabled:opacity-40 transition-colors shrink-0"
                  >
                    <Camera className="w-3 h-3" />
                    {savingSnapshot ? 'Saving…' : 'Save'}
                  </button>
                </div>

                {/* Snapshot list */}
                {snapshots.length === 0 ? (
                  <p className="text-xs text-gray-400 text-center py-3">No snapshots yet — save the current live state above.</p>
                ) : (
                  <div className="rounded-xl border border-gray-200 divide-y divide-gray-100 overflow-hidden">
                    {snapshots.map(snap => (
                      <div
                        key={snap.id}
                        className={`flex items-center gap-3 px-4 py-2.5 text-xs transition-colors ${
                          viewingSnapshot?.id === snap.id ? 'bg-amber-50' : 'bg-white hover:bg-gray-50'
                        }`}
                      >
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-gray-800 truncate">{snap.label}</p>
                          <p className="text-gray-400 mt-0.5">
                            {new Date(snap.snapshot_at).toLocaleString()}
                          </p>
                        </div>
                        <button
                          onClick={() => setViewingSnapshot(viewingSnapshot?.id === snap.id ? null : snap)}
                          className={`shrink-0 px-2 py-1 rounded text-xs font-medium transition-colors ${
                            viewingSnapshot?.id === snap.id
                              ? 'bg-amber-100 text-amber-700 hover:bg-amber-200'
                              : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                          }`}
                        >
                          {viewingSnapshot?.id === snap.id ? 'Live' : 'View'}
                        </button>
                        <button
                          onClick={() => handleDeleteSnapshot(snap.id)}
                          className="shrink-0 p-1 rounded text-gray-400 hover:text-danger hover:bg-red-50 transition-colors"
                          title="Delete snapshot"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
