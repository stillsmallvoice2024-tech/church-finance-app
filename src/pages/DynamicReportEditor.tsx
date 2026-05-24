import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  ArrowLeft, Save, Plus, Trash2, ChevronUp, ChevronDown,
  Type, BarChart2, Table2, AlertCircle, Check,
} from 'lucide-react'
import { usePageTitle } from '../hooks/usePageTitle'
import {
  useDynamicReportBlocks,
  useUpdateDynamicReport,
  useSaveDynamicReportBlocks,
} from '../hooks/useDynamicReports'
import { useDynamicReports } from '../hooks/useDynamicReports'
import { useToastStore } from '../store/toastStore'
import type { DynamicReport, DynamicReportBlockType, TextBlockConfig } from '../types'

// ── Local block shape (in-memory, before persistence) ─────────────────────────

interface EditorBlock {
  key: string
  block_type: DynamicReportBlockType
  config_json: Record<string, unknown>
}

function makeKey() {
  return Math.random().toString(36).slice(2)
}

// ── Block editors ──────────────────────────────────────────────────────────────

function TextBlockEditor({
  block,
  onChange,
}: {
  block: EditorBlock
  onChange: (cfg: Record<string, unknown>) => void
}) {
  const cfg = block.config_json as Partial<TextBlockConfig>
  return (
    <textarea
      rows={4}
      value={cfg.text ?? ''}
      onChange={e => onChange({ text: e.target.value })}
      placeholder="Write your notes here…"
      className="w-full resize-y rounded-lg border border-gray-200 px-3 py-2.5 text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50"
    />
  )
}

function MetricBlockEditor({
  block,
  onChange,
}: {
  block: EditorBlock
  onChange: (cfg: Record<string, unknown>) => void
}) {
  const cfg = block.config_json as Record<string, string>
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-700">
        <BarChart2 className="w-3.5 h-3.5 shrink-0" />
        Dynamic tokens are resolved in Phase 2. Configure the metric below.
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Function</label>
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
          <label className="block text-xs font-medium text-gray-600 mb-1">Category</label>
          <input
            type="text"
            value={cfg.category ?? ''}
            onChange={e => onChange({ ...cfg, category: e.target.value })}
            placeholder="e.g. Tithes"
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
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
    </div>
  )
}

function TableBlockEditor({
  block,
  onChange,
}: {
  block: EditorBlock
  onChange: (cfg: Record<string, unknown>) => void
}) {
  const cfg = block.config_json as Record<string, unknown>
  const categories: string[] = Array.isArray(cfg.categories) ? (cfg.categories as string[]) : []
  const catText = categories.join(', ')

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 rounded-lg bg-blue-50 border border-blue-200 px-3 py-2 text-xs text-blue-700">
        <Table2 className="w-3.5 h-3.5 shrink-0" />
        Dynamic table rendering is implemented in Phase 3. Configure the table below.
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <label className="block text-xs font-medium text-gray-600 mb-1">
            Categories (comma-separated)
          </label>
          <input
            type="text"
            value={catText}
            onChange={e =>
              onChange({
                ...cfg,
                categories: e.target.value
                  .split(',')
                  .map(s => s.trim())
                  .filter(Boolean),
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
          <label className="block text-xs font-medium text-gray-600 mb-1">Table Label (optional)</label>
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

// ── Block card ─────────────────────────────────────────────────────────────────

const BLOCK_META: Record<DynamicReportBlockType, { icon: React.ElementType; label: string }> = {
  text:   { icon: Type,     label: 'Text'   },
  metric: { icon: BarChart2, label: 'Metric' },
  table:  { icon: Table2,   label: 'Table'  },
}

function BlockCard({
  block,
  index,
  total,
  onChange,
  onDelete,
  onMoveUp,
  onMoveDown,
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
      <div className="flex items-center gap-3 px-4 py-3 bg-gray-50 border-b border-gray-100">
        <div className="flex items-center gap-2 text-xs font-medium text-gray-500">
          <Icon className="w-3.5 h-3.5" />
          {meta.label}
        </div>
        <span className="text-xs text-gray-300 font-mono">#{index + 1}</span>
        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={onMoveUp}
            disabled={index === 0}
            className="p-1 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-200 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            title="Move up"
          >
            <ChevronUp className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={onMoveDown}
            disabled={index === total - 1}
            className="p-1 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-200 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            title="Move down"
          >
            <ChevronDown className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={onDelete}
            className="p-1 rounded text-gray-400 hover:text-danger hover:bg-red-50 transition-colors"
            title="Delete block"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
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

// ── Main editor ────────────────────────────────────────────────────────────────

export default function DynamicReportEditor() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { push: pushToast } = useToastStore()

  const { reports, loading: reportsLoading } = useDynamicReports()
  const report: DynamicReport | undefined = reports.find(r => r.id === id)

  const { blocks: savedBlocks, loading: blocksLoading } = useDynamicReportBlocks(id ?? null)
  const { mutate: updateTitle } = useUpdateDynamicReport()
  const { mutate: saveBlocks, loading: saving } = useSaveDynamicReportBlocks()

  const [title,  setTitle]  = useState('')
  const [blocks, setBlocks] = useState<EditorBlock[]>([])
  const [isDirty, setIsDirty] = useState(false)
  const [saved,   setSaved]   = useState(false)
  const titleRef = useRef<HTMLInputElement>(null)

  usePageTitle(title || 'Report Editor')

  useEffect(() => {
    if (report) setTitle(report.title)
  }, [report])

  useEffect(() => {
    if (!blocksLoading) {
      setBlocks(
        savedBlocks.map(b => ({
          key:         b.id,
          block_type:  b.block_type,
          config_json: b.config_json,
        })),
      )
    }
  }, [savedBlocks, blocksLoading])

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
      const idx = prev.findIndex(b => b.key === key)
      if (idx < 0) return prev
      const next = idx + dir
      if (next < 0 || next >= prev.length) return prev
      const arr = [...prev]
      ;[arr[idx], arr[next]] = [arr[next], arr[idx]]
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
        <button
          onClick={() => navigate('/dynamic-reports')}
          className="mt-4 text-sm text-primary hover:underline"
        >
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
            ref={titleRef}
            value={title}
            onChange={e => { setTitle(e.target.value); setIsDirty(true) }}
            className="flex-1 min-w-0 text-xl font-bold text-gray-900 bg-transparent border-b-2 border-transparent focus:border-primary outline-none transition-colors"
            placeholder="Untitled Report"
          />
        </div>
        <button
          onClick={handleSave}
          disabled={saving || !isDirty}
          className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-colors shrink-0 ${
            saved
              ? 'bg-success/10 text-success border border-success/20'
              : 'bg-primary text-white hover:bg-primary-light disabled:opacity-40'
          }`}
        >
          {saved ? (
            <><Check className="w-4 h-4" />Saved</>
          ) : (
            <><Save className="w-4 h-4" />{saving ? 'Saving…' : 'Save'}</>
          )}
        </button>
      </div>

      {/* Blocks */}
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
          <div className="flex flex-col items-center justify-center py-12 text-center border-2 border-dashed border-gray-200 rounded-xl">
            <p className="text-sm text-gray-400">No blocks yet — add one below</p>
          </div>
        )}
      </div>

      {/* Add block buttons */}
      <div className="flex flex-wrap gap-2">
        <span className="text-xs font-medium text-gray-400 self-center mr-1">Add block:</span>
        <button
          onClick={() => addBlock('text')}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
        >
          <Type className="w-3.5 h-3.5" />
          Text
        </button>
        <button
          onClick={() => addBlock('metric')}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
        >
          <BarChart2 className="w-3.5 h-3.5" />
          Metric
        </button>
        <button
          onClick={() => addBlock('table')}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
        >
          <Table2 className="w-3.5 h-3.5" />
          Table
        </button>
        {isDirty && (
          <span className="text-xs text-gray-400 self-center ml-auto">Unsaved changes</span>
        )}
      </div>

      {blocks.length > 0 && (
        <div className="flex justify-end">
          <button
            onClick={handleSave}
            disabled={saving || !isDirty}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary-light transition-colors disabled:opacity-40"
          >
            <Save className="w-4 h-4" />
            {saving ? 'Saving…' : 'Save Report'}
          </button>
        </div>
      )}
    </div>
  )
}
