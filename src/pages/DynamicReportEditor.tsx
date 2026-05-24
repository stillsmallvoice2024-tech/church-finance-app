import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  ArrowLeft, Save, Trash2, ChevronUp, ChevronDown,
  Type, BarChart2, Table2, AlertCircle, Check,
  Eye, Pencil, Plus, X, RefreshCw,
} from 'lucide-react'
import { usePageTitle } from '../hooks/usePageTitle'
import {
  useDynamicReportBlocks,
  useUpdateDynamicReport,
  useSaveDynamicReportBlocks,
  useDynamicReports,
} from '../hooks/useDynamicReports'
import { useToastStore } from '../store/toastStore'
import {
  parseTokens,
  resolveTokens,
  splitByTokens,
  buildTokenString,
  type ParsedToken,
  type TokenFn,
} from '../utils/reportTokenParser'
import type { DynamicReport, DynamicReportBlockType, TextBlockConfig, MetricBlockConfig } from '../types'
import type { QueryResult } from '../utils/reportQueryEngine'

// ── Helpers ────────────────────────────────────────────────────────────────────

const FN_LABELS: Record<TokenFn, string> = {
  BALANCE:  'Balance',
  INFLOWS:  'Inflows',
  OUTFLOWS: 'Outflows',
  NET:      'Net Movement',
}

function fmtNGN(n: number): string {
  return n.toLocaleString('en-NG', { minimumFractionDigits: 2 })
}

function fmtAmount(n: number): string {
  const abs = Math.abs(n)
  return (n < 0 ? '-' : '') + '₦' + fmtNGN(abs)
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

// ── Token insertion popover ────────────────────────────────────────────────────

interface TokenPopoverProps {
  onInsert: (token: string) => void
  onClose: () => void
}

function TokenPopover({ onInsert, onClose }: TokenPopoverProps) {
  const [fn,       setFn]       = useState<TokenFn>('BALANCE')
  const [category, setCategory] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo,   setDateTo]   = useState('')

  const handleInsert = () => {
    if (fn !== 'NET' && !category.trim()) return
    const token = buildTokenString(fn, category.trim(), dateFrom || undefined, dateTo || undefined)
    onInsert(token)
    onClose()
  }

  return (
    <div className="absolute z-20 top-full left-0 mt-1 w-72 bg-white rounded-xl border border-gray-200 shadow-lg p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-gray-700">Insert Metric Token</span>
        <button onClick={onClose} className="p-0.5 rounded text-gray-400 hover:text-gray-700">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Metric</label>
        <select
          value={fn}
          onChange={e => setFn(e.target.value as TokenFn)}
          className="w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-primary/30"
        >
          {(Object.keys(FN_LABELS) as TokenFn[]).map(k => (
            <option key={k} value={k}>{FN_LABELS[k]}</option>
          ))}
        </select>
      </div>

      {fn !== 'NET' && (
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Category *</label>
          <input
            type="text"
            value={category}
            onChange={e => setCategory(e.target.value)}
            placeholder="e.g. Tithes"
            className="w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-primary/30"
            autoFocus
          />
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">From (optional)</label>
          <input
            type="date"
            value={dateFrom}
            onChange={e => setDateFrom(e.target.value)}
            className="w-full rounded-lg border border-gray-200 px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">To (optional)</label>
          <input
            type="date"
            value={dateTo}
            onChange={e => setDateTo(e.target.value)}
            className="w-full rounded-lg border border-gray-200 px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        </div>
      </div>

      {/* Preview of generated token */}
      <div className="rounded-lg bg-gray-50 border border-gray-100 px-2.5 py-1.5 font-mono text-[11px] text-gray-500 break-all">
        {buildTokenString(fn, category.trim(), dateFrom || undefined, dateTo || undefined)}
      </div>

      <button
        onClick={handleInsert}
        disabled={fn !== 'NET' && !category.trim()}
        className="w-full py-1.5 text-xs font-medium text-white bg-primary rounded-lg hover:bg-primary-light transition-colors disabled:opacity-40"
      >
        Insert
      </button>
    </div>
  )
}

// ── Text block editor (with token insertion) ───────────────────────────────────

function TextBlockEditor({
  block,
  onChange,
}: {
  block: EditorBlock
  onChange: (cfg: Record<string, unknown>) => void
}) {
  const cfg = block.config_json as Partial<TextBlockConfig>
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [showPopover, setShowPopover] = useState(false)
  const cursorRef = useRef(0)

  const handleInsertToken = (token: string) => {
    const el = textareaRef.current
    const pos = cursorRef.current
    const current = cfg.text ?? ''
    const next = current.slice(0, pos) + token + current.slice(pos)
    onChange({ text: next })
    // Restore cursor after token
    requestAnimationFrame(() => {
      if (el) {
        const newPos = pos + token.length
        el.setSelectionRange(newPos, newPos)
        el.focus()
      }
    })
  }

  return (
    <div className="space-y-2">
      <div className="relative flex items-center gap-2">
        <button
          type="button"
          onClick={() => {
            cursorRef.current = textareaRef.current?.selectionStart ?? (cfg.text?.length ?? 0)
            setShowPopover(p => !p)
          }}
          className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-primary border border-primary/30 rounded-lg hover:bg-primary/5 transition-colors"
        >
          <Plus className="w-3 h-3" />
          Insert metric
        </button>
        <span className="text-[10px] text-gray-400">
          or type <code className="font-mono bg-gray-100 px-1 rounded">{'{{BALANCE:CategoryName}}'}</code>
        </span>
        {showPopover && (
          <TokenPopover
            onInsert={handleInsertToken}
            onClose={() => setShowPopover(false)}
          />
        )}
      </div>
      <textarea
        ref={textareaRef}
        rows={5}
        value={cfg.text ?? ''}
        onChange={e => onChange({ text: e.target.value })}
        onBlur={e => { cursorRef.current = e.target.selectionStart }}
        placeholder="Write your notes here… Use 'Insert metric' to embed live values."
        className="w-full resize-y rounded-lg border border-gray-200 px-3 py-2.5 text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 font-mono"
      />
    </div>
  )
}

// ── Metric block editor ────────────────────────────────────────────────────────

function MetricBlockEditor({
  block,
  onChange,
}: {
  block: EditorBlock
  onChange: (cfg: Record<string, unknown>) => void
}) {
  const cfg = block.config_json as Record<string, string>
  return (
    <div className="grid grid-cols-2 gap-3">
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
          Category{cfg.fn === 'NET' ? ' (not needed)' : ' *'}
        </label>
        <input
          type="text"
          value={cfg.category ?? ''}
          onChange={e => onChange({ ...cfg, category: e.target.value })}
          placeholder="e.g. Tithes"
          disabled={cfg.fn === 'NET'}
          className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:bg-gray-50 disabled:text-gray-400"
        />
      </div>
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

// ── Table block editor (Phase 3 placeholder) ───────────────────────────────────

function TableBlockEditor({
  block,
  onChange,
}: {
  block: EditorBlock
  onChange: (cfg: Record<string, unknown>) => void
}) {
  const cfg = block.config_json as Record<string, unknown>
  const categories: string[] = Array.isArray(cfg.categories) ? (cfg.categories as string[]) : []

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 rounded-lg bg-blue-50 border border-blue-200 px-3 py-2 text-xs text-blue-700">
        <Table2 className="w-3.5 h-3.5 shrink-0" />
        Dynamic table rendering is implemented in Phase 3. Configure now — it will render automatically.
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <label className="block text-xs font-medium text-gray-600 mb-1">
            Categories (comma-separated)
          </label>
          <input
            type="text"
            value={categories.join(', ')}
            onChange={e =>
              onChange({
                ...cfg,
                categories: e.target.value.split(',').map(s => s.trim()).filter(Boolean),
              })
            }
            placeholder="e.g. Tithes, Offering, Welfare"
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
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
      </div>
    </div>
  )
}

// ── Edit mode block card ───────────────────────────────────────────────────────

const BLOCK_META: Record<DynamicReportBlockType, { icon: React.ElementType; label: string }> = {
  text:   { icon: Type,      label: 'Text'   },
  metric: { icon: BarChart2, label: 'Metric' },
  table:  { icon: Table2,    label: 'Table'  },
}

function BlockCard({
  block, index, total, onChange, onDelete, onMoveUp, onMoveDown,
}: {
  block: EditorBlock
  index: number
  total: number
  onChange: (cfg: Record<string, unknown>) => void
  onDelete: () => void
  onMoveUp: () => void
  onMoveDown: () => void
}) {
  const meta = BLOCK_META[block.block_type]
  const Icon = meta.icon

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2.5 bg-gray-50 border-b border-gray-100">
        <div className="flex items-center gap-1.5 text-xs font-medium text-gray-500">
          <Icon className="w-3.5 h-3.5" />{meta.label}
        </div>
        <span className="text-[10px] text-gray-300 font-mono">#{index + 1}</span>
        <div className="ml-auto flex items-center gap-1">
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
      </div>
      <div className="p-4">
        {block.block_type === 'text'   && <TextBlockEditor   block={block} onChange={onChange} />}
        {block.block_type === 'metric' && <MetricBlockEditor block={block} onChange={onChange} />}
        {block.block_type === 'table'  && <TableBlockEditor  block={block} onChange={onChange} />}
      </div>
    </div>
  )
}

// ── Preview renderers ──────────────────────────────────────────────────────────

function ResolvedValue({ result }: { result: QueryResult | undefined }) {
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
      {fmtAmount(result.value)}
    </span>
  )
}

function TextBlockPreview({
  block,
  resolved,
}: {
  block: EditorBlock
  resolved: Map<string, QueryResult>
}) {
  const cfg = block.config_json as Partial<TextBlockConfig>
  const text = cfg.text ?? ''
  if (!text.trim()) {
    return <p className="text-gray-300 italic text-sm">Empty text block</p>
  }
  const segments = splitByTokens(text)
  return (
    <p className="text-sm text-gray-800 leading-relaxed whitespace-pre-wrap">
      {segments.map((seg, i) => {
        if (typeof seg === 'string') return <span key={i}>{seg}</span>
        return <ResolvedValue key={i} result={resolved.get(seg.raw)} />
      })}
    </p>
  )
}

function MetricBlockPreview({
  block,
  resolved,
}: {
  block: EditorBlock
  resolved: Map<string, QueryResult>
}) {
  const cfg = block.config_json as Partial<MetricBlockConfig>
  const fn       = cfg.fn ?? 'BALANCE'
  const category = cfg.category ?? ''
  const dateFrom = cfg.dateFrom
  const dateTo   = cfg.dateTo

  const tokenKey = buildTokenString(
    fn as TokenFn,
    category,
    dateFrom || undefined,
    dateTo   || undefined,
  )
  const result = resolved.get(tokenKey)

  const label = cfg.label || (fn === 'NET'
    ? 'Net Movement'
    : `${FN_LABELS[fn as TokenFn] ?? fn}${category ? ` — ${category}` : ''}`)

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
        <ResolvedValue result={result} />
      </div>
    </div>
  )
}

function TableBlockPreview({ block }: { block: EditorBlock }) {
  const cfg = block.config_json as Record<string, unknown>
  const label = (cfg.label as string) || 'Table'
  return (
    <div className="rounded-xl border border-blue-200 bg-blue-50/40 px-5 py-4 text-sm text-blue-600 flex items-center gap-3">
      <Table2 className="w-4 h-4 shrink-0 text-blue-400" />
      <span>
        <strong>{label}</strong> — dynamic table rendering arrives in Phase 3.
        {Array.isArray(cfg.categories) && (cfg.categories as string[]).length > 0 && (
          <span className="text-blue-500"> Categories: {(cfg.categories as string[]).join(', ')}</span>
        )}
      </span>
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
    } else if (b.block_type === 'metric') {
      const cfg = b.config_json as Partial<MetricBlockConfig>
      if (!cfg.fn) continue
      // Represent the metric block as a virtual token for resolution
      tokens.push({
        raw:      buildTokenString(
          cfg.fn as TokenFn,
          cfg.category ?? '',
          cfg.dateFrom || undefined,
          cfg.dateTo   || undefined,
        ),
        fn:       cfg.fn as TokenFn,
        category: cfg.category ?? '',
        dateFrom: cfg.dateFrom || undefined,
        dateTo:   cfg.dateTo   || undefined,
      })
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

  const { blocks: savedBlocks, loading: blocksLoading } = useDynamicReportBlocks(id ?? null)
  const { mutate: updateTitle }  = useUpdateDynamicReport()
  const { mutate: saveBlocks, loading: saving } = useSaveDynamicReportBlocks()

  const [mode,    setMode]    = useState<'edit' | 'preview'>('edit')
  const [title,   setTitle]   = useState('')
  const [blocks,  setBlocks]  = useState<EditorBlock[]>([])
  const [isDirty, setIsDirty] = useState(false)
  const [saved,   setSaved]   = useState(false)

  // Token resolution state
  const [resolved,   setResolved]   = useState<Map<string, QueryResult>>(new Map())
  const [resolving,  setResolving]  = useState(false)

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
    const tokens = collectTokensFromBlocks(currentBlocks)
    if (tokens.length === 0) { setResolved(new Map()); return }
    setResolving(true)
    const map = await resolveTokens(tokens)
    setResolved(map)
    setResolving(false)
  }, [])

  useEffect(() => {
    if (mode === 'preview') resolveAll(blocks)
  }, [mode, resolveAll]) // resolve on enter preview; blocks re-resolves only via manual refresh

  const addBlock = useCallback((type: DynamicReportBlockType) => {
    const defaults: Record<DynamicReportBlockType, Record<string, unknown>> = {
      text:   { text: '' },
      metric: { fn: 'BALANCE', category: '', dateFrom: '', dateTo: '', label: '' },
      table:  { categories: [], dateFrom: '', dateTo: '', label: '' },
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
        <div className="flex items-center gap-2 shrink-0">
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
          {/* Refresh bar */}
          <div className="flex items-center justify-between">
            <p className="text-xs text-gray-400">
              {resolving ? 'Fetching live data…' : 'Live data — values from your finance records'}
            </p>
            <button
              onClick={() => resolveAll(blocks)}
              disabled={resolving}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-3 h-3 ${resolving ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>

          {blocks.length === 0 && (
            <div className="py-16 text-center text-sm text-gray-400">
              No blocks — switch to Edit mode to add content.
            </div>
          )}

          {blocks.map(block => (
            <div key={block.key}>
              {block.block_type === 'text' && (
                <TextBlockPreview block={block} resolved={resolved} />
              )}
              {block.block_type === 'metric' && (
                <MetricBlockPreview block={block} resolved={resolved} />
              )}
              {block.block_type === 'table' && (
                <TableBlockPreview block={block} />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
