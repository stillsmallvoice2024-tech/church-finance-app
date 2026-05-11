import { useState, useId } from 'react'
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  DragOverEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  FileText,
  Plus,
  GripVertical,
  Eye,
  EyeOff,
  Pencil,
  Trash2,
  Download,
  FileSpreadsheet,
  Save,
  Settings2,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  Check,
} from 'lucide-react'
import { usePageTitle } from '../hooks/usePageTitle'
import { useReportEngine } from '../hooks/useReportEngine'
import { useReportTemplates, useDeleteReportTemplate } from '../hooks/useReportTemplates'
import { useCategories } from '../hooks/useCategories'
import { SaveReportTemplateModal } from '../components/modals/SaveReportTemplateModal'
import { exportReportPDF, exportReportExcel, computeGroupTotal, computeGrandTotal } from '../utils/reportExport'
import { useToastStore } from '../store/toastStore'
import type {
  ReportGroup,
  ReportItem,
  ReportLayout,
  ReportTemplate,
  ReportPortion,
  ReportCategoryBalance,
} from '../types'

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number): string {
  return new Intl.NumberFormat('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)
}

function uid(): string {
  return Math.random().toString(36).slice(2, 10)
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

const PORTIONS: ReportPortion[] = ['All', 'Percentage', 'Specific Seed', 'Savings']

// ── Sortable Item ───────────────────────────────────────────────────────────────────

function SortableItem({
  item,
  groupId,
  balances,
  onToggleVisible,
  onRename,
  onChangePortion,
  onDelete,
  editing,
}: {
  item:            ReportItem
  groupId:         string
  balances:        Map<string, ReportCategoryBalance>
  onToggleVisible: (groupId: string, itemId: string) => void
  onRename:        (groupId: string, itemId: string, label: string) => void
  onChangePortion: (groupId: string, itemId: string, portion: ReportPortion) => void
  onDelete:        (groupId: string, itemId: string) => void
  editing:         boolean
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: `${groupId}::${item.id}` })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  }

  const bal = balances.get(item.categoryName)
  const value = bal
    ? item.portion === 'Percentage'    ? bal.percentageAllocated
    : item.portion === 'Specific Seed' ? bal.specificSeed
    : item.portion === 'Savings'       ? bal.savingsNet
    : bal.percentageAllocated + bal.specificSeed + bal.savingsNet
    : 0

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-2 px-3 py-2 rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-sm ${!item.visible ? 'opacity-50' : ''}`}
    >
      {editing && (
        <button
          {...attributes}
          {...listeners}
          type="button"
          className="text-gray-400 hover:text-gray-600 cursor-grab active:cursor-grabbing shrink-0"
        >
          <GripVertical className="w-4 h-4" />
        </button>
      )}

      <div className="flex-1 min-w-0">
        {editing ? (
          <input
            type="text"
            value={item.displayLabel}
            onChange={e => onRename(groupId, item.id, e.target.value)}
            className="w-full bg-transparent border-b border-dashed border-gray-400 focus:outline-none focus:border-primary text-sm"
          />
        ) : (
          <span className={`truncate ${!item.visible ? 'line-through text-gray-400' : ''}`}>
            {item.displayLabel}
          </span>
        )}
      </div>

      {editing && (
        <select
          value={item.portion}
          onChange={e => onChangePortion(groupId, item.id, e.target.value as ReportPortion)}
          className="text-xs border border-gray-300 dark:border-gray-600 rounded px-1 py-0.5 bg-white dark:bg-gray-700 shrink-0"
        >
          {PORTIONS.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
      )}

      <span className="text-right font-mono shrink-0 text-sm">
        ₦{fmt(value)}
      </span>

      {editing && (
        <>
          <button
            type="button"
            onClick={() => onToggleVisible(groupId, item.id)}
            className="text-gray-400 hover:text-gray-600 shrink-0"
            title={item.visible ? 'Hide row' : 'Show row'}
          >
            {item.visible ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
          </button>
          <button
            type="button"
            onClick={() => onDelete(groupId, item.id)}
            className="text-red-400 hover:text-red-600 shrink-0"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </>
      )}
    </div>
  )
}

// ── Sortable Group ────────────────────────────────────────────────────────────────

function SortableGroup({
  group,
  balances,
  editing,
  onRenameGroup,
  onToggleGroup,
  onDeleteGroup,
  children,
}: {
  group:         ReportGroup
  balances:      Map<string, ReportCategoryBalance>
  editing:       boolean
  onRenameGroup: (id: string, label: string) => void
  onToggleGroup: (id: string) => void
  onDeleteGroup: (id: string) => void
  children:      React.ReactNode
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: `group::${group.id}` })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  }

  const groupTotal = computeGroupTotal(group, balances)

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 overflow-hidden ${!group.visible ? 'opacity-60' : ''}`}
    >
      {/* Group header */}
      <div className="flex items-center gap-2 px-3 py-2 bg-primary/10 dark:bg-primary/20">
        {editing && (
          <button
            {...attributes}
            {...listeners}
            type="button"
            className="text-gray-500 hover:text-gray-700 cursor-grab active:cursor-grabbing shrink-0"
          >
            <GripVertical className="w-4 h-4" />
          </button>
        )}

        {editing ? (
          <input
            type="text"
            value={group.label}
            onChange={e => onRenameGroup(group.id, e.target.value)}
            className="flex-1 bg-transparent border-b border-dashed border-primary/60 focus:outline-none text-sm font-bold uppercase tracking-wide"
          />
        ) : (
          <span className="flex-1 text-sm font-bold uppercase tracking-wide text-primary dark:text-blue-300">
            {group.label}
          </span>
        )}

        {editing && (
          <>
            <button
              type="button"
              onClick={() => onToggleGroup(group.id)}
              className="text-gray-500 hover:text-gray-700 shrink-0"
              title={group.visible ? 'Hide group' : 'Show group'}
            >
              {group.visible ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
            </button>
            <button
              type="button"
              onClick={() => onDeleteGroup(group.id)}
              className="text-red-400 hover:text-red-600 shrink-0"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </>
        )}
      </div>

      {/* Items */}
      <div className="p-2 space-y-1">
        {children}
      </div>

      {/* Group subtotal */}
      <div className="flex items-center justify-between px-3 py-2 bg-gray-100 dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700">
        <span className="text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wide">
          {group.label} Sub-Total
        </span>
        <span className="font-mono font-bold text-sm">₦{fmt(groupTotal)}</span>
      </div>
    </div>
  )
}

// ── Category Picker ───────────────────────────────────────────────────────────────

function CategoryPicker({
  categories,
  layout,
  onAdd,
}: {
  categories: { name: string }[]
  layout:     ReportLayout
  onAdd:      (categoryName: string, targetGroupId: string, portion: ReportPortion) => void
}) {
  const [search,   setSearch]   = useState('')
  const [groupId,  setGroupId]  = useState(() => layout.groups[0]?.id ?? '')
  const [portion,  setPortion]  = useState<ReportPortion>('All')
  const [expanded, setExpanded] = useState(false)

  const used = new Set(
    layout.groups.flatMap(g => g.items.map(i => i.categoryName)),
  )

  const filtered = categories
    .filter(c => !used.has(c.name) && c.name.toLowerCase().includes(search.toLowerCase()))
    .slice(0, 30)

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
      <button
        type="button"
        onClick={() => setExpanded(p => !p)}
        className="w-full flex items-center justify-between px-4 py-3 text-sm font-semibold text-gray-700 dark:text-gray-200"
      >
        <span className="flex items-center gap-2"><Plus className="w-4 h-4" /> Add Categories</span>
        {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
      </button>

      {expanded && (
        <div className="border-t border-gray-200 dark:border-gray-700 p-3 space-y-3">
          <input
            type="text"
            placeholder="Search categories…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full rounded-lg border border-gray-300 dark:border-gray-600 px-3 py-1.5 text-sm bg-white dark:bg-gray-900 focus:outline-none focus:border-primary"
          />

          <div className="flex gap-2">
            <select
              value={groupId}
              onChange={e => setGroupId(e.target.value)}
              className="flex-1 rounded-lg border border-gray-300 dark:border-gray-600 px-2 py-1.5 text-xs bg-white dark:bg-gray-900"
            >
              {layout.groups.map(g => (
                <option key={g.id} value={g.id}>{g.label}</option>
              ))}
            </select>
            <select
              value={portion}
              onChange={e => setPortion(e.target.value as ReportPortion)}
              className="rounded-lg border border-gray-300 dark:border-gray-600 px-2 py-1.5 text-xs bg-white dark:bg-gray-900"
            >
              {PORTIONS.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>

          <div className="max-h-48 overflow-y-auto space-y-1">
            {filtered.length === 0 && (
              <p className="text-xs text-gray-500 text-center py-2">
                {used.size === categories.length ? 'All categories added' : 'No matches'}
              </p>
            )}
            {filtered.map(cat => (
              <button
                key={cat.name}
                type="button"
                onClick={() => onAdd(cat.name, groupId, portion)}
                className="w-full flex items-center justify-between gap-2 px-3 py-1.5 rounded-lg text-sm hover:bg-primary/10 text-left transition"
              >
                <span className="truncate">{cat.name}</span>
                <Plus className="w-3.5 h-3.5 text-primary shrink-0" />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Main Page ───────────────────────────────────────────────────────────────────

export default function FinancialReport() {
  usePageTitle('Financial Report')

  const { push } = useToastStore()
  const { categories } = useCategories()
  const { templates, refetch: refetchTemplates } = useReportTemplates()
  const { mutate: deleteTemplate } = useDeleteReportTemplate()

  const [reportDate,     setReportDate]     = useState(today)
  const [layout,         setLayout]         = useState<ReportLayout>({ groups: [] })
  const [editMode,       setEditMode]       = useState(false)
  const [selectedTplId,  setSelectedTplId]  = useState<string | null>(null)
  const [saveModalOpen,  setSaveModalOpen]  = useState(false)
  const [activeId,       setActiveId]       = useState<string | null>(null)
  const [tplMenuOpen,    setTplMenuOpen]    = useState(false)

  const { balances, loading, refetch } = useReportEngine(reportDate)

  const dndId = useId()

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  )

  // ── Layout mutation helpers ───────────────────────────────────────────────────────

  const addGroup = () => {
    const label = `Group ${layout.groups.length + 1}`
    setLayout(prev => ({
      groups: [...prev.groups, { id: uid(), label, visible: true, items: [] }],
    }))
  }

  const renameGroup = (gId: string, label: string) => {
    setLayout(prev => ({
      groups: prev.groups.map(g => g.id === gId ? { ...g, label } : g),
    }))
  }

  const toggleGroup = (gId: string) => {
    setLayout(prev => ({
      groups: prev.groups.map(g => g.id === gId ? { ...g, visible: !g.visible } : g),
    }))
  }

  const deleteGroup = (gId: string) => {
    setLayout(prev => ({ groups: prev.groups.filter(g => g.id !== gId) }))
  }

  const addItem = (categoryName: string, targetGroupId: string, portion: ReportPortion) => {
    setLayout(prev => ({
      groups: prev.groups.map(g =>
        g.id !== targetGroupId ? g : {
          ...g,
          items: [...g.items, {
            id:           uid(),
            categoryName,
            displayLabel: categoryName,
            portion,
            visible:      true,
          }],
        },
      ),
    }))
  }

  const toggleItem = (gId: string, iId: string) => {
    setLayout(prev => ({
      groups: prev.groups.map(g =>
        g.id !== gId ? g : {
          ...g,
          items: g.items.map(i => i.id === iId ? { ...i, visible: !i.visible } : i),
        },
      ),
    }))
  }

  const renameItem = (gId: string, iId: string, label: string) => {
    setLayout(prev => ({
      groups: prev.groups.map(g =>
        g.id !== gId ? g : {
          ...g,
          items: g.items.map(i => i.id === iId ? { ...i, displayLabel: label } : i),
        },
      ),
    }))
  }

  const changeItemPortion = (gId: string, iId: string, portion: ReportPortion) => {
    setLayout(prev => ({
      groups: prev.groups.map(g =>
        g.id !== gId ? g : {
          ...g,
          items: g.items.map(i => i.id === iId ? { ...i, portion } : i),
        },
      ),
    }))
  }

  const deleteItem = (gId: string, iId: string) => {
    setLayout(prev => ({
      groups: prev.groups.map(g =>
        g.id !== gId ? g : { ...g, items: g.items.filter(i => i.id !== iId) },
      ),
    }))
  }

  // ── Template actions ───────────────────────────────────────────────────────────────

  const loadTemplate = (tpl: ReportTemplate) => {
    setLayout(tpl.layout)
    setSelectedTplId(tpl.id)
    setTplMenuOpen(false)
  }

  const handleSaved = (tpl: ReportTemplate) => {
    setSelectedTplId(tpl.id)
    refetchTemplates()
  }

  const handleDeleteTemplate = async (tpl: ReportTemplate) => {
    if (!confirm(`Delete template "${tpl.name}"?`)) return
    try {
      await deleteTemplate(tpl.id)
      if (selectedTplId === tpl.id) {
        setSelectedTplId(null)
        setLayout({ groups: [] })
      }
      refetchTemplates()
      push('Template deleted', 'success')
    } catch {
      push('Failed to delete template', 'error')
    }
  }

  // ── Drag-and-drop ─────────────────────────────────────────────────────────────────

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(String(event.active.id))
  }

  const handleDragOver = (event: DragOverEvent) => {
    const { active, over } = event
    if (!over) return

    const activeStr = String(active.id)
    const overStr   = String(over.id)

    // Only handle item cross-group moves here
    if (activeStr.startsWith('group::') || !activeStr.includes('::')) return

    const [activeGroup, activeItemId] = activeStr.split('::')
    const overIsGroup  = overStr.startsWith('group::')
    const overGroup    = overIsGroup
      ? overStr.replace('group::', '')
      : overStr.split('::')[0]

    if (activeGroup === overGroup) return  // same group — handled in dragEnd

    setLayout(prev => {
      const srcGroup = prev.groups.find(g => g.id === activeGroup)
      const dstGroup = prev.groups.find(g => g.id === overGroup)
      if (!srcGroup || !dstGroup) return prev

      const item = srcGroup.items.find(i => i.id === activeItemId)
      if (!item) return prev

      return {
        groups: prev.groups.map(g => {
          if (g.id === activeGroup) return { ...g, items: g.items.filter(i => i.id !== activeItemId) }
          if (g.id === overGroup)   return { ...g, items: [...g.items, item] }
          return g
        }),
      }
    })
  }

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    setActiveId(null)
    if (!over || active.id === over.id) return

    const activeStr = String(active.id)
    const overStr   = String(over.id)

    if (activeStr.startsWith('group::') && overStr.startsWith('group::')) {
      // Reorder groups
      const activeIdx = layout.groups.findIndex(g => `group::${g.id}` === activeStr)
      const overIdx   = layout.groups.findIndex(g => `group::${g.id}` === overStr)
      if (activeIdx !== -1 && overIdx !== -1) {
        setLayout(prev => ({ groups: arrayMove(prev.groups, activeIdx, overIdx) }))
      }
      return
    }

    // Reorder items within same group
    if (!activeStr.startsWith('group::') && !overStr.startsWith('group::')) {
      const [activeGroup, activeItemId] = activeStr.split('::')
      const [overGroup,   overItemId]   = overStr.split('::')
      if (activeGroup !== overGroup) return  // cross-group move already done in dragOver

      setLayout(prev => ({
        groups: prev.groups.map(g => {
          if (g.id !== activeGroup) return g
          const ai = g.items.findIndex(i => i.id === activeItemId)
          const oi = g.items.findIndex(i => i.id === overItemId)
          return { ...g, items: arrayMove(g.items, ai, oi) }
        }),
      }))
    }
  }

  const grandTotal = computeGrandTotal(layout, balances)
  const selectedTpl = templates.find(t => t.id === selectedTplId) ?? null

  // ── Render ──────────────────────────────────────────────────────────────────────

  const renderReportView = () => {
    if (layout.groups.length === 0) {
      return (
        <div className="flex flex-col items-center justify-center py-16 text-gray-400">
          <FileText className="w-12 h-12 mb-3 opacity-30" />
          <p className="text-sm">No layout configured.</p>
          <p className="text-xs mt-1">Click <strong>Edit Layout</strong> to build your report.</p>
        </div>
      )
    }

    return (
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
        {/* Report header */}
        <div className="bg-primary px-6 py-4 text-white text-center">
          <h2 className="text-base font-bold uppercase tracking-wide">Breakdown of Financial Report</h2>
          <p className="text-sm opacity-80 mt-0.5">
            {new Date(reportDate + 'T12:00:00').toLocaleDateString('en-GB', {
              weekday: 'long', day: '2-digit', month: 'long', year: 'numeric',
            })}
          </p>
        </div>

        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 dark:bg-gray-800 text-xs uppercase text-gray-500 dark:text-gray-400">
              <th className="px-6 py-2 text-left font-semibold">Account / Description</th>
              <th className="px-6 py-2 text-right font-semibold">Amount (₦)</th>
            </tr>
          </thead>
          <tbody>
            {layout.groups.filter(g => g.visible).map(group => {
              const groupTotal = computeGroupTotal(group, balances)
              return (
                <>
                  {/* Group header row */}
                  <tr key={`gh-${group.id}`} className="bg-primary/10 dark:bg-primary/20">
                    <td colSpan={2} className="px-6 py-2 font-bold text-xs uppercase tracking-widest text-primary dark:text-blue-300">
                      {group.label}
                    </td>
                  </tr>

                  {/* Items */}
                  {group.items.filter(i => i.visible).map(item => {
                    const bal = balances.get(item.categoryName)
                    const val = bal
                      ? item.portion === 'Percentage'    ? bal.percentageAllocated
                      : item.portion === 'Specific Seed' ? bal.specificSeed
                      : item.portion === 'Savings'       ? bal.savingsNet
                      : bal.percentageAllocated + bal.specificSeed + bal.savingsNet
                      : 0
                    return (
                      <tr key={item.id} className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50">
                        <td className="px-8 py-2 text-gray-700 dark:text-gray-300">{item.displayLabel}</td>
                        <td className="px-6 py-2 text-right font-mono text-gray-900 dark:text-gray-100">
                          ₦{fmt(val)}
                        </td>
                      </tr>
                    )
                  })}

                  {/* Group subtotal */}
                  <tr key={`gs-${group.id}`} className="bg-gray-100 dark:bg-gray-800">
                    <td className="px-6 py-2 font-semibold text-xs uppercase tracking-wide text-gray-600 dark:text-gray-400">
                      {group.label} Sub-Total
                    </td>
                    <td className="px-6 py-2 text-right font-mono font-bold text-gray-900 dark:text-gray-100">
                      ₦{fmt(groupTotal)}
                    </td>
                  </tr>

                  {/* Spacer */}
                  <tr key={`sp-${group.id}`}><td colSpan={2} className="py-1" /></tr>
                </>
              )
            })}

            {/* Grand total */}
            <tr className="bg-primary text-white">
              <td className="px-6 py-3 font-bold uppercase tracking-widest text-sm">Grand Total</td>
              <td className="px-6 py-3 text-right font-mono font-bold text-lg">₦{fmt(grandTotal)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    )
  }

  const renderEditMode = () => (
    <DndContext
      id={dndId}
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
    >
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Left: category picker */}
        <div className="space-y-3">
          {layout.groups.length > 0 ? (
            <CategoryPicker
              categories={categories}
              layout={layout}
              onAdd={addItem}
            />
          ) : (
            <div className="rounded-xl border border-dashed border-gray-300 dark:border-gray-600 p-4 text-center text-sm text-gray-500">
              Add a group first to start adding categories.
            </div>
          )}
          <button
            type="button"
            onClick={addGroup}
            className="w-full flex items-center justify-center gap-2 rounded-xl border-2 border-dashed border-primary/40 px-4 py-3 text-sm font-medium text-primary hover:border-primary hover:bg-primary/5 transition"
          >
            <Plus className="w-4 h-4" /> Add Group
          </button>
        </div>

        {/* Right: layout builder */}
        <div className="lg:col-span-2 space-y-3">
          {layout.groups.length === 0 ? (
            <div className="rounded-xl border border-dashed border-gray-300 dark:border-gray-600 p-8 text-center text-gray-400">
              <p className="text-sm">No groups yet.</p>
              <p className="text-xs mt-1">Click <strong>Add Group</strong> to get started.</p>
            </div>
          ) : (
            <SortableContext
              items={layout.groups.map(g => `group::${g.id}`)}
              strategy={verticalListSortingStrategy}
            >
              {layout.groups.map(group => (
                <SortableGroup
                  key={group.id}
                  group={group}
                  balances={balances}
                  editing={true}
                  onRenameGroup={renameGroup}
                  onToggleGroup={toggleGroup}
                  onDeleteGroup={deleteGroup}
                >
                  <SortableContext
                    items={group.items.map(i => `${group.id}::${i.id}`)}
                    strategy={verticalListSortingStrategy}
                  >
                    {group.items.map(item => (
                      <SortableItem
                        key={item.id}
                        item={item}
                        groupId={group.id}
                        balances={balances}
                        onToggleVisible={toggleItem}
                        onRename={renameItem}
                        onChangePortion={changeItemPortion}
                        onDelete={deleteItem}
                        editing={true}
                      />
                    ))}
                  </SortableContext>
                </SortableGroup>
              ))}
            </SortableContext>
          )}

          {/* Grand total preview */}
          {layout.groups.length > 0 && (
            <div className="flex justify-between items-center px-4 py-3 rounded-xl bg-primary text-white font-bold">
              <span className="uppercase tracking-widest text-sm">Grand Total</span>
              <span className="font-mono text-lg">₦{fmt(grandTotal)}</span>
            </div>
          )}
        </div>
      </div>

      <DragOverlay>
        {activeId && !activeId.startsWith('group::') && activeId.includes('::') && (() => {
          const [gId, iId] = activeId.split('::')
          const item = layout.groups.find(g => g.id === gId)?.items.find(i => i.id === iId)
          if (!item) return null
          return (
            <div className="px-3 py-2 rounded-lg bg-white dark:bg-gray-800 border border-primary shadow-lg text-sm font-medium">
              {item.displayLabel}
            </div>
          )
        })()}
        {activeId && activeId.startsWith('group::') && (() => {
          const gId = activeId.replace('group::', '')
          const group = layout.groups.find(g => g.id === gId)
          if (!group) return null
          return (
            <div className="px-4 py-2 rounded-xl bg-primary/20 border border-primary shadow-lg text-sm font-bold uppercase">
              {group.label}
            </div>
          )
        })()}
      </DragOverlay>
    </DndContext>
  )

  return (
    <div className="p-4 md:p-6 space-y-4">
      {/* Page header */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex items-center gap-3 flex-1">
          <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
            <FileText className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-gray-900 dark:text-white">Financial Report</h1>
            <p className="text-xs text-gray-500 dark:text-gray-400">Cumulative balances as of the selected date (by date added)</p>
          </div>
        </div>

        {/* Controls */}
        <div className="flex flex-wrap items-center gap-2">

          {/* Date picker */}
          <div className="flex items-center gap-1.5 rounded-lg border border-gray-300 dark:border-gray-600 px-3 py-1.5 bg-white dark:bg-gray-800 text-sm">
            <span className="text-gray-500 text-xs">Date:</span>
            <input
              type="date"
              value={reportDate}
              onChange={e => setReportDate(e.target.value)}
              className="bg-transparent border-none outline-none text-sm text-gray-900 dark:text-white"
            />
          </div>

          {/* Refresh */}
          <button
            type="button"
            onClick={() => refetch()}
            disabled={loading}
            className="p-1.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition disabled:opacity-50"
            title="Refresh balances"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>

          {/* Template selector */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setTplMenuOpen(p => !p)}
              className="flex items-center gap-1.5 rounded-lg border border-gray-300 dark:border-gray-600 px-3 py-1.5 bg-white dark:bg-gray-800 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 transition"
            >
              <Settings2 className="w-3.5 h-3.5" />
              {selectedTpl ? selectedTpl.name : 'Templates'}
              <ChevronDown className="w-3.5 h-3.5" />
            </button>

            {tplMenuOpen && (
              <div className="absolute right-0 top-full mt-1 w-56 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-xl z-20 py-1">
                <div className="px-3 py-1.5 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Saved Templates</div>
                {templates.length === 0 && (
                  <p className="px-3 py-2 text-xs text-gray-400">No templates yet</p>
                )}
                {templates.map(tpl => (
                  <div key={tpl.id} className="flex items-center gap-1 px-2 py-1">
                    <button
                      type="button"
                      onClick={() => loadTemplate(tpl)}
                      className="flex-1 flex items-center gap-2 text-left px-2 py-1 rounded-lg text-sm hover:bg-gray-100 dark:hover:bg-gray-700 transition"
                    >
                      {selectedTplId === tpl.id && <Check className="w-3.5 h-3.5 text-primary shrink-0" />}
                      <span className="truncate">{tpl.name}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteTemplate(tpl)}
                      className="p-1 text-red-400 hover:text-red-600 rounded"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
                <div className="border-t border-gray-100 dark:border-gray-700 mt-1 pt-1">
                  <button
                    type="button"
                    onClick={() => { setSelectedTplId(null); setLayout({ groups: [] }); setTplMenuOpen(false) }}
                    className="w-full text-left px-4 py-1.5 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition"
                  >
                    Clear layout
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Edit layout toggle */}
          <button
            type="button"
            onClick={() => setEditMode(p => !p)}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition ${
              editMode
                ? 'bg-primary text-white shadow-sm'
                : 'border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-50'
            }`}
          >
            <Pencil className="w-3.5 h-3.5" />
            {editMode ? 'Done Editing' : 'Edit Layout'}
          </button>

          {/* Save template */}
          {editMode && (
            <button
              type="button"
              onClick={() => setSaveModalOpen(true)}
              className="flex items-center gap-1.5 rounded-lg border border-gray-300 dark:border-gray-600 px-3 py-1.5 bg-white dark:bg-gray-800 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 transition"
            >
              <Save className="w-3.5 h-3.5" />
              Save Template
            </button>
          )}

          {/* Export PDF */}
          {!editMode && layout.groups.length > 0 && (
            <button
              type="button"
              onClick={() => exportReportPDF(layout, balances, reportDate)}
              className="flex items-center gap-1.5 rounded-lg border border-gray-300 dark:border-gray-600 px-3 py-1.5 bg-white dark:bg-gray-800 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 transition"
            >
              <Download className="w-3.5 h-3.5" />
              PDF
            </button>
          )}

          {/* Export Excel */}
          {!editMode && layout.groups.length > 0 && (
            <button
              type="button"
              onClick={() => exportReportExcel(layout, balances, reportDate)}
              className="flex items-center gap-1.5 rounded-lg border border-gray-300 dark:border-gray-600 px-3 py-1.5 bg-white dark:bg-gray-800 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 transition"
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              Excel
            </button>
          )}
        </div>
      </div>

      {/* Close template menu on outside click */}
      {tplMenuOpen && (
        <div className="fixed inset-0 z-10" onClick={() => setTplMenuOpen(false)} />
      )}

      {/* Content */}
      <div className="overflow-x-auto">
        {editMode ? renderEditMode() : renderReportView()}
      </div>

      {/* Save template modal */}
      <SaveReportTemplateModal
        open={saveModalOpen}
        onClose={() => setSaveModalOpen(false)}
        onSaved={handleSaved}
        layout={layout}
        editTemplate={selectedTpl}
      />
    </div>
  )
}
