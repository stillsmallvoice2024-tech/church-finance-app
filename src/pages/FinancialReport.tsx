import { useState, useId, useCallback, useEffect, useRef, useMemo } from 'react'
import {
  DndContext,
  closestCenter,
  PointerSensor,
  TouchSensor,
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
  TableProperties,
  Layers,
  Pin,
  PinOff,
  AlertTriangle,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { usePageTitle } from '../hooks/usePageTitle'
import { useReportEngine } from '../hooks/useReportEngine'
import { useReportTemplates, useDeleteReportTemplate } from '../hooks/useReportTemplates'
import { useCategories } from '../hooks/useCategories'
import { useIncomeTypes } from '../hooks/useIncomeTypes'
import { SaveReportTemplateModal } from '../components/modals/SaveReportTemplateModal'
import {
  exportReportPDF,
  exportReportExcel,
  computeGroupTotal,
  computeTableTotal,
  getItemBalance,
  normaliseTables,
} from '../utils/reportExport'
import { useToastStore } from '../store/toastStore'
import { useReportTemplateStore } from '../store/reportTemplateStore'
import { useOrgCurrency } from '../hooks/useOrgCurrency'
import type {
  ReportGroup,
  ReportGroupChild,
  ReportItem,
  ReportSubgroup,
  ReportTable,
  ReportLayout,
  ReportTemplate,
  ReportPortion,
  ReportCategoryBalance,
  ReportBasis,
  ReportRowType,
  OperationalBalanceMap,
} from '../types'

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number, locale: string): string {
  return new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)
}

function uid(): string {
  return Math.random().toString(36).slice(2, 10)
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

const PORTIONS: ReportPortion[] = ['All', 'Percentage', 'Specific Seed', 'Savings']
const PORTION_LABELS: Record<string, string> = {
  All:             'All',
  Percentage:      'Regular Funds',
  'Specific Seed': 'Designated Gift',
  Savings:         'Savings Funds',
}

/** Normalise old layout.groups to multi-table format */
function ensureMultiTable(layout: ReportLayout): ReportTable[] {
  return normaliseTables(layout)
}

/** Build a usage-set key for an item to prevent exact duplicates */
function itemKey(item: ReportItem): string {
  const rt = item.rowType ?? 'category'
  if (rt === 'inflow_type')      return `it::${item.incomeTypeId ?? ''}`
  if (rt === 'transaction_type') return `tt::${item.transactionTypeKey ?? ''}`
  return `cat::${item.categoryName}::${item.portion}`
}

// ── DnD ID conventions ────────────────────────────────────────────────────────
// tbl-{id}                     table
// grp-{id}                     group
// sgp-{id}                     subgroup
// itm-{id}                     item

function tblId(id: string) { return `tbl-${id}` }
function grpId(id: string) { return `grp-${id}` }
function sgpId(id: string) { return `sgp-${id}` }
function itmId(id: string) { return `itm-${id}` }

function stripPrefix(dndId: string): string {
  return dndId.replace(/^(tbl|grp|sgp|itm)-/, '')
}

function prefixType(dndId: string): 'tbl' | 'grp' | 'sgp' | 'itm' | null {
  const m = dndId.match(/^(tbl|grp|sgp|itm)-/)
  return m ? (m[1] as 'tbl' | 'grp' | 'sgp' | 'itm') : null
}

// ── Locate helpers (scan layout) ─────────────────────────────────────────────

interface ItemLocation { tableId: string; groupId: string; subgroupId?: string; item: ReportItem }
interface GroupLocation { tableId: string; group: ReportGroup }

function findItem(tables: ReportTable[], itemId: string): ItemLocation | null {
  for (const t of tables) {
    for (const g of t.groups) {
      for (const child of g.children) {
        if (child.kind === 'item' && child.data.id === itemId) {
          return { tableId: t.id, groupId: g.id, item: child.data }
        }
        if (child.kind === 'subgroup') {
          const sgItem = child.data.items.find(i => i.id === itemId)
          if (sgItem) return { tableId: t.id, groupId: g.id, subgroupId: child.data.id, item: sgItem }
        }
      }
    }
  }
  return null
}

function findGroup(tables: ReportTable[], groupId: string): GroupLocation | null {
  for (const t of tables) {
    const g = t.groups.find(g => g.id === groupId)
    if (g) return { tableId: t.id, group: g }
  }
  return null
}

// ── Sortable Item ─────────────────────────────────────────────────────────────

function SortableItem({
  item,
  balances,
  opBalances,
  onToggleVisible,
  onRename,
  onChangePortion,
  onDelete,
  editing,
  onMoveUp,
  onMoveDown,
  subgroups,
  currentSubgroupId,
  onAssignSubgroup,
}: {
  item:              ReportItem
  balances:          Map<string, ReportCategoryBalance>
  opBalances:        OperationalBalanceMap
  onToggleVisible:   (itemId: string) => void
  onRename:          (itemId: string, label: string) => void
  onChangePortion:   (itemId: string, portion: ReportPortion) => void
  onDelete:          (itemId: string) => void
  editing:           boolean
  onMoveUp?:         () => void
  onMoveDown?:       () => void
  subgroups?:        { id: string; label: string }[]
  currentSubgroupId?: string
  onAssignSubgroup?: (sgId: string) => void
}) {
  const { baseCurrencySymbol, formatLocale } = useOrgCurrency()
  const dId = itmId(item.id)
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: dId })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  }

  const value = getItemBalance(item, balances, opBalances)
  const rowType = item.rowType ?? 'category'

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex flex-wrap items-center gap-2 px-3 py-2 rounded-lg bg-white dark:bg-[#141416] border border-gray-200 dark:border-white/[0.07] text-sm ${!item.visible ? 'opacity-50' : ''}`}
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
            onChange={e => onRename(item.id, e.target.value)}
            className="w-full bg-transparent border-b border-dashed border-gray-400 focus:outline-none focus:border-primary text-sm"
          />
        ) : (
          <span className={`truncate text-sm ${!item.visible ? 'line-through text-gray-400' : ''}`}>
            {item.displayLabel}
          </span>
        )}
        {rowType !== 'category' && (
          <span className="ml-1 text-xs font-semibold uppercase tracking-wide text-primary/60">
            {rowType === 'inflow_type' ? 'Income Type' : 'Txn Type'}
          </span>
        )}
      </div>

      {editing && rowType === 'category' && (
        <select
          value={item.portion}
          onChange={e => onChangePortion(item.id, e.target.value as ReportPortion)}
          className="text-xs border border-gray-300 dark:border-white/[0.10] rounded px-1 py-0.5 bg-white dark:bg-[#1c1c1e] shrink-0"
        >
          {PORTIONS.map(p => <option key={p} value={p}>{PORTION_LABELS[p] ?? p}</option>)}
        </select>
      )}

      <span className="text-right font-mono shrink-0 text-sm">
        {baseCurrencySymbol}{fmt(value, formatLocale)}
      </span>

      {editing && (
        <>
          {subgroups && subgroups.length > 0 && onAssignSubgroup && (
            <select
              value={currentSubgroupId ?? ''}
              onChange={e => onAssignSubgroup(e.target.value)}
              className="text-xs border border-gray-200 dark:border-white/[0.10] rounded px-1 py-0.5 bg-white dark:bg-[#1c1c1e] shrink-0 max-w-[88px]"
              title="Move to subgroup / group root"
            >
              <option value="">— Root —</option>
              {subgroups.map(sg => (
                <option key={sg.id} value={sg.id}>{sg.label}</option>
              ))}
            </select>
          )}
          <div className="flex flex-col shrink-0">
            <button
              type="button"
              onClick={onMoveUp}
              disabled={!onMoveUp}
              className={`text-gray-400 hover:text-gray-600 ${!onMoveUp ? 'opacity-25 cursor-not-allowed' : ''}`}
              title="Move up" aria-label="Move up"
            >
              <ChevronUp className="w-3 h-3" />
            </button>
            <button
              type="button"
              onClick={onMoveDown}
              disabled={!onMoveDown}
              className={`text-gray-400 hover:text-gray-600 ${!onMoveDown ? 'opacity-25 cursor-not-allowed' : ''}`}
              title="Move down" aria-label="Move down"
            >
              <ChevronDown className="w-3 h-3" />
            </button>
          </div>
          <button
            type="button"
            onClick={() => onToggleVisible(item.id)}
            className="text-gray-400 hover:text-gray-600 shrink-0"
            title={item.visible ? 'Hide row' : 'Show row'}
          >
            {item.visible ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
          </button>
          <button
            type="button"
            onClick={() => onDelete(item.id)}
            className="text-red-400 hover:text-red-600 shrink-0"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </>
      )}
    </div>
  )
}

// ── Sortable Subgroup ─────────────────────────────────────────────────────────

function SortableSubgroup({
  sg,
  groupId: _groupId,
  balances,
  opBalances,
  editing,
  onRenameSubgroup,
  onToggleSubgroup,
  onDeleteSubgroup,
  onToggleItem,
  onRenameItem,
  onChangeItemPortion,
  onDeleteItem,
  allSubgroups,
  onMoveItemUp,
  onMoveItemDown,
  onMoveItemToSubgroup,
  onRemoveItemFromSubgroup,
  onMoveSubgroupUp,
  onMoveSubgroupDown,
}: {
  sg:                      ReportSubgroup
  groupId:                 string // passed for caller convenience, not used internally
  balances:                Map<string, ReportCategoryBalance>
  opBalances:              OperationalBalanceMap
  editing:                 boolean
  onRenameSubgroup:        (sgId: string, label: string) => void
  onToggleSubgroup:        (sgId: string) => void
  onDeleteSubgroup:        (sgId: string) => void
  onToggleItem:            (itemId: string) => void
  onRenameItem:            (itemId: string, label: string) => void
  onChangeItemPortion:     (itemId: string, portion: ReportPortion) => void
  onDeleteItem:            (itemId: string) => void
  allSubgroups:            { id: string; label: string }[]
  onMoveItemUp:            (itemId: string) => void
  onMoveItemDown:          (itemId: string) => void
  onMoveItemToSubgroup:    (itemId: string, sgId: string) => void
  onRemoveItemFromSubgroup:(itemId: string) => void
  onMoveSubgroupUp?:       () => void
  onMoveSubgroupDown?:     () => void
}) {
  const { baseCurrencySymbol, formatLocale } = useOrgCurrency()
  const dId = sgpId(sg.id)
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: dId })

  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }
  const sgTotal = sg.items.filter(i => i.visible).reduce((s, i) => s + getItemBalance(i, balances, opBalances), 0)

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`ml-3 rounded-lg border border-gray-200 dark:border-white/[0.07] bg-gray-50 dark:bg-[#141416] overflow-hidden ${!sg.visible ? 'opacity-60' : ''}`}
    >
      {/* Subgroup header */}
      <div className="flex items-center gap-2 px-2 py-1.5 bg-primary/5 dark:bg-primary/10">
        {editing && (
          <button
            {...attributes}
            {...listeners}
            type="button"
            className="text-gray-400 hover:text-gray-600 cursor-grab active:cursor-grabbing shrink-0"
          >
            <GripVertical className="w-3.5 h-3.5" />
          </button>
        )}
        {editing ? (
          <input
            type="text"
            value={sg.label}
            onChange={e => onRenameSubgroup(sg.id, e.target.value)}
            className="flex-1 bg-transparent border-b border-dashed border-primary/40 focus:outline-none text-xs font-semibold"
          />
        ) : (
          <span className="flex-1 text-xs font-semibold text-primary/80 dark:text-blue-400 uppercase tracking-wide">
            {sg.label}
          </span>
        )}
        {editing && (
          <>
            <button
              type="button"
              onClick={onMoveSubgroupUp}
              disabled={!onMoveSubgroupUp}
              className={`shrink-0 ${!onMoveSubgroupUp ? 'text-gray-200 dark:text-gray-700 cursor-not-allowed' : 'text-gray-400 hover:text-gray-600'}`}
              title="Move subgroup up"
            >
              <ChevronUp className="w-3 h-3" />
            </button>
            <button
              type="button"
              onClick={onMoveSubgroupDown}
              disabled={!onMoveSubgroupDown}
              className={`shrink-0 ${!onMoveSubgroupDown ? 'text-gray-200 dark:text-gray-700 cursor-not-allowed' : 'text-gray-400 hover:text-gray-600'}`}
              title="Move subgroup down"
            >
              <ChevronDown className="w-3 h-3" />
            </button>
            <button type="button" onClick={() => onToggleSubgroup(sg.id)} className="text-gray-400 hover:text-gray-600 shrink-0">
              {sg.visible ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
            </button>
            <button type="button" onClick={() => onDeleteSubgroup(sg.id)} className="text-red-400 hover:text-red-600 shrink-0">
              <Trash2 className="w-3 h-3" />
            </button>
          </>
        )}
      </div>

      {/* Items */}
      <div className="p-1.5 space-y-1">
        <SortableContext items={sg.items.map(i => itmId(i.id))} strategy={verticalListSortingStrategy}>
          {sg.items.map((item, idx) => (
            <SortableItem
              key={item.id}
              item={item}
              balances={balances}
              opBalances={opBalances}
              onToggleVisible={onToggleItem}
              onRename={onRenameItem}
              onChangePortion={onChangeItemPortion}
              onDelete={onDeleteItem}
              editing={editing}
              onMoveUp={idx > 0 ? () => onMoveItemUp(item.id) : undefined}
              onMoveDown={idx < sg.items.length - 1 ? () => onMoveItemDown(item.id) : undefined}
              subgroups={allSubgroups}
              currentSubgroupId={sg.id}
              onAssignSubgroup={(targetSgId) => {
                if (!targetSgId) onRemoveItemFromSubgroup(item.id)
                else onMoveItemToSubgroup(item.id, targetSgId)
              }}
            />
          ))}
        </SortableContext>
      </div>

      {/* Subgroup subtotal */}
      <div className="flex items-center justify-between px-3 py-1 bg-gray-100/70 dark:bg-[#1c1c1e]/30 border-t border-gray-200 dark:border-white/[0.10]">
        <span className="text-[11px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest uppercase tracking-wide">
          {sg.label} Sub-Total
        </span>
        <span className="font-mono font-bold text-xs">{baseCurrencySymbol}{fmt(sgTotal, formatLocale)}</span>
      </div>
    </div>
  )
}

// ── Sortable Group ────────────────────────────────────────────────────────────

function SortableGroup({
  group,
  tableId: _tableId,
  balances,
  opBalances,
  editing,
  onRenameGroup,
  onToggleGroup,
  onDeleteGroup,
  onAddSubgroup,
  onRenameSubgroup,
  onToggleSubgroup,
  onDeleteSubgroup,
  onToggleItem,
  onRenameItem,
  onChangeItemPortion,
  onDeleteItem,
  onMoveItemUp,
  onMoveItemDown,
  onMoveItemToSubgroup,
  onRemoveItemFromSubgroup,
  onMoveSubgroupUp,
  onMoveSubgroupDown,
  onMoveGroupUp,
  onMoveGroupDown,
}: {
  group:                   ReportGroup
  tableId:                 string // passed for caller convenience, not used internally
  balances:                Map<string, ReportCategoryBalance>
  opBalances:              OperationalBalanceMap
  editing:                 boolean
  onRenameGroup:           (gId: string, label: string) => void
  onToggleGroup:           (gId: string) => void
  onDeleteGroup:           (gId: string) => void
  onAddSubgroup:           (gId: string) => void
  onRenameSubgroup:        (gId: string, sgId: string, label: string) => void
  onToggleSubgroup:        (gId: string, sgId: string) => void
  onDeleteSubgroup:        (gId: string, sgId: string) => void
  onToggleItem:            (itemId: string) => void
  onRenameItem:            (itemId: string, label: string) => void
  onChangeItemPortion:     (itemId: string, portion: ReportPortion) => void
  onDeleteItem:            (itemId: string) => void
  onMoveItemUp:            (itemId: string) => void
  onMoveItemDown:          (itemId: string) => void
  onMoveItemToSubgroup:    (itemId: string, sgId: string) => void
  onRemoveItemFromSubgroup:(itemId: string) => void
  onMoveSubgroupUp:        (gId: string, sgId: string) => void
  onMoveSubgroupDown:      (gId: string, sgId: string) => void
  onMoveGroupUp?:          () => void
  onMoveGroupDown?:        () => void
}) {
  const { baseCurrencySymbol, formatLocale } = useOrgCurrency()
  const dId = grpId(group.id)
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: dId })

  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }
  const groupTotal = computeGroupTotal(group, balances, opBalances)

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`rounded-xl border border-gray-200 dark:border-white/[0.07] bg-gray-50 dark:bg-[#0c0c0e] overflow-hidden ${!group.visible ? 'opacity-60' : ''}`}
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
              onClick={onMoveGroupUp}
              disabled={!onMoveGroupUp}
              className={`shrink-0 ${!onMoveGroupUp ? 'text-gray-300 dark:text-gray-600 cursor-not-allowed' : 'text-gray-500 hover:text-gray-700'}`}
              title="Move group up"
            >
              <ChevronUp className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={onMoveGroupDown}
              disabled={!onMoveGroupDown}
              className={`shrink-0 ${!onMoveGroupDown ? 'text-gray-300 dark:text-gray-600 cursor-not-allowed' : 'text-gray-500 hover:text-gray-700'}`}
              title="Move group down"
            >
              <ChevronDown className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => onAddSubgroup(group.id)}
              className="text-gray-500 hover:text-primary shrink-0"
              title="Add subgroup"
            >
              <Layers className="w-4 h-4" />
            </button>
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

      {/* Items + subgroups in unified order */}
      <div className="p-2 space-y-1">
        {(() => {
          const allSubgroupList = group.children
            .filter(c => c.kind === 'subgroup')
            .map(c => ({ id: (c as { kind: 'subgroup'; data: ReportSubgroup }).data.id, label: (c as { kind: 'subgroup'; data: ReportSubgroup }).data.label }))
          const allItemIdsCtx = group.children.map(c =>
            c.kind === 'item' ? itmId(c.data.id) : sgpId((c as { kind: 'subgroup'; data: ReportSubgroup }).data.id)
          )
          return (
            <SortableContext items={allItemIdsCtx} strategy={verticalListSortingStrategy}>
              {group.children.map((child, idx) => {
                if (child.kind === 'item') {
                  return (
                    <SortableItem
                      key={child.data.id}
                      item={child.data}
                      balances={balances}
                      opBalances={opBalances}
                      onToggleVisible={onToggleItem}
                      onRename={onRenameItem}
                      onChangePortion={onChangeItemPortion}
                      onDelete={onDeleteItem}
                      editing={editing}
                      onMoveUp={idx > 0 ? () => onMoveItemUp(child.data.id) : undefined}
                      onMoveDown={idx < group.children.length - 1 ? () => onMoveItemDown(child.data.id) : undefined}
                      subgroups={allSubgroupList}
                      currentSubgroupId={undefined}
                      onAssignSubgroup={(sgId) => { if (sgId) onMoveItemToSubgroup(child.data.id, sgId) }}
                    />
                  )
                } else {
                  const sg = child.data
                  return (
                    <SortableSubgroup
                      key={sg.id}
                      sg={sg}
                      groupId={group.id}
                      balances={balances}
                      opBalances={opBalances}
                      editing={editing}
                      onRenameSubgroup={(sgId, label) => onRenameSubgroup(group.id, sgId, label)}
                      onToggleSubgroup={(sgId) => onToggleSubgroup(group.id, sgId)}
                      onDeleteSubgroup={(sgId) => onDeleteSubgroup(group.id, sgId)}
                      onToggleItem={onToggleItem}
                      onRenameItem={onRenameItem}
                      onChangeItemPortion={onChangeItemPortion}
                      onDeleteItem={onDeleteItem}
                      allSubgroups={allSubgroupList}
                      onMoveItemUp={onMoveItemUp}
                      onMoveItemDown={onMoveItemDown}
                      onMoveItemToSubgroup={onMoveItemToSubgroup}
                      onRemoveItemFromSubgroup={onRemoveItemFromSubgroup}
                      onMoveSubgroupUp={idx > 0 ? () => onMoveSubgroupUp(group.id, sg.id) : undefined}
                      onMoveSubgroupDown={idx < group.children.length - 1 ? () => onMoveSubgroupDown(group.id, sg.id) : undefined}
                    />
                  )
                }
              })}
            </SortableContext>
          )
        })()}
      </div>

      {/* Group subtotal */}
      <div className="flex items-center justify-between px-3 py-2 bg-gray-100 dark:bg-[#141416] border-t border-gray-200 dark:border-white/[0.07]">
        <span className="text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wide">
          {group.label} Sub-Total
        </span>
        <span className="font-mono font-bold text-sm">{baseCurrencySymbol}{fmt(groupTotal, formatLocale)}</span>
      </div>
    </div>
  )
}

// ── Sortable Table ────────────────────────────────────────────────────────────

function SortableTableBlock({
  table,
  balances,
  opBalances,
  editing,
  isFirst,
  isLast,
  onRenameTable,
  onToggleTable,
  onDeleteTable,
  onMoveUp,
  onMoveDown,
  onToggleCombined,
  onAddGroup,
  onMoveGroupUp,
  onMoveGroupDown,
  onRenameGroup,
  onToggleGroup,
  onDeleteGroup,
  onAddSubgroup,
  onRenameSubgroup,
  onToggleSubgroup,
  onDeleteSubgroup,
  onToggleItem,
  onRenameItem,
  onChangeItemPortion,
  onDeleteItem,
  onMoveItemUp,
  onMoveItemDown,
  onMoveItemToSubgroup,
  onRemoveItemFromSubgroup,
  onMoveSubgroupUp,
  onMoveSubgroupDown,
}: {
  table:              ReportTable
  balances:           Map<string, ReportCategoryBalance>
  opBalances:         OperationalBalanceMap
  editing:            boolean
  isFirst:            boolean
  isLast:             boolean
  onRenameTable:           (tId: string, title: string) => void
  onToggleTable:           (tId: string) => void
  onDeleteTable:           (tId: string) => void
  onMoveUp:                (tId: string) => void
  onMoveDown:              (tId: string) => void
  onToggleCombined:        (tId: string) => void
  onAddGroup:              (tId: string) => void
  onMoveGroupUp:           (gId: string) => void
  onMoveGroupDown:         (gId: string) => void
  onRenameGroup:           (gId: string, label: string) => void
  onToggleGroup:           (gId: string) => void
  onDeleteGroup:           (gId: string) => void
  onAddSubgroup:           (gId: string) => void
  onRenameSubgroup:        (gId: string, sgId: string, label: string) => void
  onToggleSubgroup:        (gId: string, sgId: string) => void
  onDeleteSubgroup:        (gId: string, sgId: string) => void
  onToggleItem:            (itemId: string) => void
  onRenameItem:            (itemId: string, label: string) => void
  onChangeItemPortion:     (itemId: string, portion: ReportPortion) => void
  onDeleteItem:            (itemId: string) => void
  onMoveItemUp:            (itemId: string) => void
  onMoveItemDown:          (itemId: string) => void
  onMoveItemToSubgroup:    (itemId: string, sgId: string) => void
  onRemoveItemFromSubgroup:(itemId: string) => void
  onMoveSubgroupUp:        (gId: string, sgId: string) => void
  onMoveSubgroupDown:      (gId: string, sgId: string) => void
}) {
  const dId = tblId(table.id)
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: dId })

  const { baseCurrencySymbol, formatLocale } = useOrgCurrency()
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }
  const tableTotal = computeTableTotal(table, balances, opBalances)

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`rounded-2xl border-2 border-primary/20 dark:border-primary/30 bg-white dark:bg-[#0c0c0e] overflow-hidden ${!table.visible ? 'opacity-60' : ''}`}
    >
      {/* Table title bar */}
      <div className="flex flex-wrap items-center gap-2 px-4 py-3 bg-primary/5 dark:bg-primary/10 border-b border-primary/10">
        {editing && (
          <button
            {...attributes}
            {...listeners}
            type="button"
            className="text-gray-400 hover:text-gray-600 cursor-grab active:cursor-grabbing shrink-0"
          >
            <GripVertical className="w-5 h-5" />
          </button>
        )}
        <TableProperties className="w-4 h-4 text-primary shrink-0" />
        {editing ? (
          <input
            type="text"
            value={table.title}
            onChange={e => onRenameTable(table.id, e.target.value)}
            className="flex-1 bg-transparent border-b border-dashed border-primary/50 focus:outline-none text-sm font-bold text-primary"
          />
        ) : (
          <span className="flex-1 text-sm font-bold text-primary dark:text-blue-300">
            {table.title}
          </span>
        )}
        {editing && (
          <>
            <button
              type="button"
              onClick={() => onMoveUp(table.id)}
              disabled={isFirst}
              className={`shrink-0 ${isFirst ? 'text-gray-200 dark:text-gray-700 cursor-not-allowed' : 'text-gray-400 hover:text-gray-600'}`}
              title="Move table up"
            >
              <ChevronUp className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => onMoveDown(table.id)}
              disabled={isLast}
              className={`shrink-0 ${isLast ? 'text-gray-200 dark:text-gray-700 cursor-not-allowed' : 'text-gray-400 hover:text-gray-600'}`}
              title="Move table down"
            >
              <ChevronDown className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => onToggleCombined(table.id)}
              className={`text-xs font-bold px-1.5 py-0.5 rounded border shrink-0 transition-colors ${
                (table.include_in_combined_total ?? true)
                  ? 'bg-primary/10 text-primary border-primary/30'
                  : 'text-gray-400 border-gray-300 hover:text-gray-600 dark:border-white/[0.10]'
              }`}
              title={(table.include_in_combined_total ?? true) ? 'Included in Combined Total (click to exclude)' : 'Excluded from Combined Total (click to include)'}
            >
              ∑
            </button>
            <button type="button" onClick={() => onAddGroup(table.id)} className="flex items-center gap-1 text-xs text-primary hover:text-primary-dark border border-primary/30 rounded px-2 py-1 shrink-0 hover:bg-primary/5">
              <Plus className="w-3 h-3" /> Group
            </button>
            <button type="button" onClick={() => onToggleTable(table.id)} className="text-gray-400 hover:text-gray-600 shrink-0">
              {table.visible ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
            </button>
            <button type="button" onClick={() => onDeleteTable(table.id)} className="text-red-400 hover:text-red-600 shrink-0">
              <Trash2 className="w-4 h-4" />
            </button>
          </>
        )}
      </div>

      {/* Groups */}
      <div className="p-3 space-y-3">
        <SortableContext
          items={table.groups.map(g => grpId(g.id))}
          strategy={verticalListSortingStrategy}
        >
          {table.groups.length === 0 ? (
            <div className="text-center text-sm text-gray-400 py-4">
              {editing ? 'No groups yet. Click "+ Group" to add one.' : 'No groups configured.'}
            </div>
          ) : (
            table.groups.map((group, gIdx) => (
              <SortableGroup
                key={group.id}
                group={group}
                tableId={table.id}
                balances={balances}
                opBalances={opBalances}
                editing={editing}
                onRenameGroup={onRenameGroup}
                onToggleGroup={onToggleGroup}
                onDeleteGroup={onDeleteGroup}
                onAddSubgroup={onAddSubgroup}
                onRenameSubgroup={onRenameSubgroup}
                onToggleSubgroup={onToggleSubgroup}
                onDeleteSubgroup={onDeleteSubgroup}
                onToggleItem={onToggleItem}
                onRenameItem={onRenameItem}
                onChangeItemPortion={onChangeItemPortion}
                onDeleteItem={onDeleteItem}
                onMoveItemUp={onMoveItemUp}
                onMoveItemDown={onMoveItemDown}
                onMoveItemToSubgroup={onMoveItemToSubgroup}
                onRemoveItemFromSubgroup={onRemoveItemFromSubgroup}
                onMoveSubgroupUp={onMoveSubgroupUp}
                onMoveSubgroupDown={onMoveSubgroupDown}
                onMoveGroupUp={gIdx > 0 ? () => onMoveGroupUp(group.id) : undefined}
                onMoveGroupDown={gIdx < table.groups.length - 1 ? () => onMoveGroupDown(group.id) : undefined}
              />
            ))
          )}
        </SortableContext>
      </div>

      {/* Table grand total */}
      <div className="flex justify-between items-center px-4 py-3 bg-primary text-white font-bold border-t border-primary/30">
        <span className="uppercase tracking-widest text-sm">{table.title} Total</span>
        <span className="font-mono text-lg">{baseCurrencySymbol}{fmt(tableTotal, formatLocale)}</span>
      </div>
    </div>
  )
}

// ── Category Picker ───────────────────────────────────────────────────────────

function CategoryPicker({
  categories,
  incomeTypes,
  tables,
  onAdd,
}: {
  categories:  { name: string }[]
  incomeTypes: { id: string; name: string; color: string }[]
  tables:      ReportTable[]
  onAdd:       (rowType: ReportRowType, key: string, label: string, targetGroupId: string, portion: ReportPortion, incomeTypeId?: string, transactionTypeKey?: string) => void
}) {
  const [search,    setSearch]    = useState('')
  const [groupId,   setGroupId]   = useState(() => tables[0]?.groups[0]?.id ?? '')
  const [portion,   setPortion]   = useState<ReportPortion>('All')
  const [tab,       setTab]       = useState<'category' | 'inflow_type' | 'transaction_type'>('category')
  const [expanded,  setExpanded]  = useState(false)

  const allGroups = tables.flatMap(t => t.groups)

  const usedKeys = new Set(
    tables.flatMap(t => t.groups.flatMap(g =>
      g.children.flatMap(c =>
        c.kind === 'item' ? [itemKey(c.data)] : c.data.items.map(itemKey)
      )
    ))
  )

  const TXN_TYPES = [
    { key: 'normal',              label: 'Normal Transactions' },
    { key: 'reversal',            label: 'Reversal' },
    { key: 'refund',              label: 'Refund' },
    { key: 'bank_deposit',        label: 'Bank Deposit' },
    { key: 'intrabank_transfer',  label: 'Intrabank Transfer' },
  ]

  const filteredCats = categories
    .filter(c => c.name.toLowerCase().includes(search.toLowerCase()))
    .slice(0, 30)

  const filteredTypes = incomeTypes
    .filter(t => t.name.toLowerCase().includes(search.toLowerCase()))

  return (
    <div className="rounded-xl border border-gray-200 dark:border-white/[0.07] bg-white dark:bg-[#141416]">
      <button
        type="button"
        onClick={() => setExpanded(p => !p)}
        className="w-full flex items-center justify-between px-4 py-3 text-sm font-semibold text-gray-700 dark:text-gray-200"
      >
        <span className="flex items-center gap-2"><Plus className="w-4 h-4" /> Add Rows</span>
        {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
      </button>

      {expanded && (
        <div className="border-t border-gray-200 dark:border-white/[0.07] p-3 space-y-3">
          {/* Row type tabs */}
          <div className="flex gap-1 p-1 bg-gray-100 dark:bg-[#1c1c1e] rounded-lg">
            {(['category', 'inflow_type', 'transaction_type'] as const).map(t => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className={`flex-1 text-xs font-medium py-1 rounded-md transition-colors ${tab === t ? 'bg-white dark:bg-[#141416] shadow-sm text-primary' : 'text-gray-500 hover:text-gray-700'}`}
              >
                {t === 'category' ? 'Category' : t === 'inflow_type' ? 'Income Type' : 'Txn Type'}
              </button>
            ))}
          </div>

          <input
            type="text"
            placeholder="Search…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full rounded-lg border border-gray-300 dark:border-white/[0.10] px-3 py-1.5 text-sm bg-white dark:bg-[#0c0c0e] focus:outline-none focus:border-primary"
          />

          <div className="flex gap-2">
            <select
              value={groupId}
              onChange={e => setGroupId(e.target.value)}
              className="flex-1 rounded-lg border border-gray-300 dark:border-white/[0.10] px-2 py-1.5 text-xs bg-white dark:bg-[#0c0c0e]"
            >
              {allGroups.map(g => (
                <option key={g.id} value={g.id}>{g.label}</option>
              ))}
            </select>
            {tab === 'category' && (
              <select
                value={portion}
                onChange={e => setPortion(e.target.value as ReportPortion)}
                className="rounded-lg border border-gray-300 dark:border-white/[0.10] px-2 py-1.5 text-xs bg-white dark:bg-[#0c0c0e]"
              >
                {PORTIONS.map(p => <option key={p} value={p}>{PORTION_LABELS[p] ?? p}</option>)}
              </select>
            )}
          </div>

          <div className="max-h-48 overflow-y-auto space-y-1">
            {tab === 'category' && filteredCats.map(cat => {
              const key = `cat::${cat.name}::${portion}`
              const alreadyUsed = usedKeys.has(key)
              return (
                <button
                  key={key}
                  type="button"
                  disabled={alreadyUsed}
                  onClick={() => onAdd('category', key, cat.name, groupId, portion)}
                  className={`w-full flex items-center justify-between gap-2 px-3 py-1.5 rounded-lg text-sm text-left transition ${alreadyUsed ? 'opacity-40 cursor-not-allowed' : 'hover:bg-primary/10'}`}
                >
                  <span className="truncate">{cat.name}</span>
                  {alreadyUsed ? <Check className="w-3.5 h-3.5 text-green-500 shrink-0" /> : <Plus className="w-3.5 h-3.5 text-primary shrink-0" />}
                </button>
              )
            })}

            {tab === 'inflow_type' && filteredTypes.map(t => {
              const key = `it::${t.id}`
              const alreadyUsed = usedKeys.has(key)
              return (
                <button
                  key={key}
                  type="button"
                  disabled={alreadyUsed}
                  onClick={() => onAdd('inflow_type', key, t.name, groupId, 'All', t.id)}
                  className={`w-full flex items-center justify-between gap-2 px-3 py-1.5 rounded-lg text-sm text-left transition ${alreadyUsed ? 'opacity-40 cursor-not-allowed' : 'hover:bg-primary/10'}`}
                >
                  <span className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: t.color }} />
                    {t.name}
                  </span>
                  {alreadyUsed ? <Check className="w-3.5 h-3.5 text-green-500 shrink-0" /> : <Plus className="w-3.5 h-3.5 text-primary shrink-0" />}
                </button>
              )
            })}

            {tab === 'transaction_type' && TXN_TYPES.map(t => {
              const key = `tt::${t.key}`
              const alreadyUsed = usedKeys.has(key)
              return (
                <button
                  key={key}
                  type="button"
                  disabled={alreadyUsed}
                  onClick={() => onAdd('transaction_type', key, t.label, groupId, 'All', undefined, t.key)}
                  className={`w-full flex items-center justify-between gap-2 px-3 py-1.5 rounded-lg text-sm text-left transition ${alreadyUsed ? 'opacity-40 cursor-not-allowed' : 'hover:bg-primary/10'}`}
                >
                  <span className="truncate">{t.label}</span>
                  {alreadyUsed ? <Check className="w-3.5 h-3.5 text-green-500 shrink-0" /> : <Plus className="w-3.5 h-3.5 text-primary shrink-0" />}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function FinancialReport() {
  usePageTitle('Financial Report')
  const { baseCurrencySymbol, formatLocale } = useOrgCurrency()

  const { push } = useToastStore()
  const { categories } = useCategories()
  const { incomeTypes } = useIncomeTypes()
  const { templates, refetch: refetchTemplates } = useReportTemplates()
  const { mutate: deleteTemplate } = useDeleteReportTemplate()
  const { pinnedTemplateId, pin: pinTemplate, unpin: unpinTemplate } = useReportTemplateStore()

  const [reportDate,    setReportDate]    = useState(today)
  const [reportBasis,   setReportBasis]   = useState<ReportBasis>('transaction_date')
  const [tables,        setTables]        = useState<ReportTable[]>([])
  const [editMode,      setEditMode]      = useState(false)
  const [selectedTplId, setSelectedTplId] = useState<string | null>(null)
  const [saveModalOpen, setSaveModalOpen] = useState(false)
  const [activeId,      setActiveId]      = useState<string | null>(null)
  const [tplMenuOpen,   setTplMenuOpen]   = useState(false)
  const [hideZeroRows,  setHideZeroRows]  = useState(false)
  const pinnedAutoLoadedRef = useRef(false)

  const { balances, operationalBalances, loading, refetch } = useReportEngine(reportDate, reportBasis)

  const dndId = useId()
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    // Long-press to drag on touch — leaves normal scrolling intact
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
  )

  // ── Layout from templates ─────────────────────────────────────────────────

  const currentLayout: ReportLayout = { tables, basis: reportBasis }

  // Auto-load pinned template once after templates have loaded
  useEffect(() => {
    if (pinnedAutoLoadedRef.current) return
    if (templates.length === 0) return
    if (!pinnedTemplateId) return
    const pinned = templates.find(t => t.id === pinnedTemplateId)
    if (!pinned) return
    pinnedAutoLoadedRef.current = true
    const t = ensureMultiTable(pinned.layout)
    setTables(t)
    if (pinned.layout.basis) setReportBasis(pinned.layout.basis)
    setSelectedTplId(pinned.id)
  }, [templates, pinnedTemplateId])

  const loadTemplate = (tpl: ReportTemplate) => {
    const t = ensureMultiTable(tpl.layout)
    setTables(t)
    if (tpl.layout.basis) setReportBasis(tpl.layout.basis)
    setSelectedTplId(tpl.id)
    setTplMenuOpen(false)
    // Auto-replace pin if one exists
    if (pinnedTemplateId !== null) {
      pinTemplate(tpl.id)
    }
  }

  const handleSaved = (tpl: ReportTemplate) => {
    setSelectedTplId(tpl.id)
    refetchTemplates()
  }

  const handleDeleteTemplate = async (tpl: ReportTemplate) => {
    if (!confirm(`Delete template "${tpl.name}"?`)) return
    try {
      await deleteTemplate(tpl.id)
      if (selectedTplId === tpl.id) { setSelectedTplId(null); setTables([]) }
      if (pinnedTemplateId === tpl.id) unpinTemplate()
      refetchTemplates()
      push('Template deleted', 'success')
    } catch {
      push('Failed to delete template', 'error')
    }
  }

  // ── Row visibility helper ────────────────────────────────────────────────

  const shouldDisplayRow = useCallback((item: ReportItem, balances: Map<string, ReportCategoryBalance>, opBalances: OperationalBalanceMap): boolean => {
    if (!hideZeroRows) return true
    const val = getItemBalance(item, balances, opBalances)
    return val !== 0
  }, [hideZeroRows])

  // ── Find unmapped income types ────────────────────────────────────────────

  const getMappedIncomeTypeIds = useCallback((): Set<string> => {
    const mapped = new Set<string>()
    for (const table of tables) {
      for (const group of table.groups) {
        for (const child of group.children) {
          if (child.kind === 'item' && child.data.rowType === 'inflow_type' && child.data.incomeTypeId) {
            mapped.add(child.data.incomeTypeId)
          } else if (child.kind === 'subgroup') {
            for (const item of child.data.items) {
              if (item.rowType === 'inflow_type' && item.incomeTypeId) {
                mapped.add(item.incomeTypeId)
              }
            }
          }
        }
      }
    }
    return mapped
  }, [tables])

  const unmappedIncomeTypes = useMemo(() => {
    const mapped = getMappedIncomeTypeIds()
    return incomeTypes.filter(it => !mapped.has(it.id))
  }, [incomeTypes, getMappedIncomeTypeIds])

  // ── Table mutations ───────────────────────────────────────────────────────

  const addTable = () => {
    setTables(prev => [...prev, { id: uid(), title: `Table ${prev.length + 1}`, visible: true, groups: [], include_in_combined_total: true }])
  }

  const renameTable = useCallback((tId: string, title: string) => {
    setTables(prev => prev.map(t => t.id === tId ? { ...t, title } : t))
  }, [])

  const toggleTable = useCallback((tId: string) => {
    setTables(prev => prev.map(t => t.id === tId ? { ...t, visible: !t.visible } : t))
  }, [])

  const deleteTable = useCallback((tId: string) => {
    setTables(prev => prev.filter(t => t.id !== tId))
  }, [])

  const moveTableUp = useCallback((tId: string) => {
    setTables(prev => {
      const idx = prev.findIndex(t => t.id === tId)
      if (idx <= 0) return prev
      return arrayMove(prev, idx, idx - 1)
    })
  }, [])

  const moveTableDown = useCallback((tId: string) => {
    setTables(prev => {
      const idx = prev.findIndex(t => t.id === tId)
      if (idx === -1 || idx >= prev.length - 1) return prev
      return arrayMove(prev, idx, idx + 1)
    })
  }, [])

  const toggleTableCombined = useCallback((tId: string) => {
    setTables(prev => prev.map(t =>
      t.id === tId ? { ...t, include_in_combined_total: !(t.include_in_combined_total ?? true) } : t
    ))
  }, [])

  // ── Group mutations ───────────────────────────────────────────────────────

  const addGroup = useCallback((tId: string) => {
    setTables(prev => prev.map(t =>
      t.id !== tId ? t : {
        ...t,
        groups: [...t.groups, { id: uid(), label: `Group ${t.groups.length + 1}`, visible: true, children: [] }],
      },
    ))
  }, [])

  const renameGroup = useCallback((gId: string, label: string) => {
    setTables(prev => prev.map(t => ({
      ...t,
      groups: t.groups.map(g => g.id === gId ? { ...g, label } : g),
    })))
  }, [])

  const toggleGroup = useCallback((gId: string) => {
    setTables(prev => prev.map(t => ({
      ...t,
      groups: t.groups.map(g => g.id === gId ? { ...g, visible: !g.visible } : g),
    })))
  }, [])

  const deleteGroup = useCallback((gId: string) => {
    setTables(prev => prev.map(t => ({ ...t, groups: t.groups.filter(g => g.id !== gId) })))
  }, [])

  const moveGroupUp = useCallback((gId: string) => {
    setTables(prev => prev.map(t => {
      const idx = t.groups.findIndex(g => g.id === gId)
      if (idx <= 0) return t
      return { ...t, groups: arrayMove(t.groups, idx, idx - 1) }
    }))
  }, [])

  const moveGroupDown = useCallback((gId: string) => {
    setTables(prev => prev.map(t => {
      const idx = t.groups.findIndex(g => g.id === gId)
      if (idx === -1 || idx >= t.groups.length - 1) return t
      return { ...t, groups: arrayMove(t.groups, idx, idx + 1) }
    }))
  }, [])

  // ── Subgroup mutations ────────────────────────────────────────────────────

  const addSubgroup = useCallback((gId: string) => {
    setTables(prev => prev.map(t => ({
      ...t,
      groups: t.groups.map(g => {
        if (g.id !== gId) return g
        const sgCount = g.children.filter(c => c.kind === 'subgroup').length
        const newSg: ReportSubgroup = { id: uid(), label: `Subgroup ${sgCount + 1}`, visible: true, items: [] }
        return { ...g, children: [...g.children, { kind: 'subgroup' as const, data: newSg }] }
      }),
    })))
  }, [])

  const renameSubgroup = useCallback((gId: string, sgId: string, label: string) => {
    setTables(prev => prev.map(t => ({
      ...t,
      groups: t.groups.map(g => {
        if (g.id !== gId) return g
        return {
          ...g,
          children: g.children.map(c =>
            c.kind === 'subgroup' && c.data.id === sgId
              ? { kind: 'subgroup' as const, data: { ...c.data, label } }
              : c
          ),
        }
      }),
    })))
  }, [])

  const toggleSubgroup = useCallback((gId: string, sgId: string) => {
    setTables(prev => prev.map(t => ({
      ...t,
      groups: t.groups.map(g => {
        if (g.id !== gId) return g
        return {
          ...g,
          children: g.children.map(c =>
            c.kind === 'subgroup' && c.data.id === sgId
              ? { kind: 'subgroup' as const, data: { ...c.data, visible: !c.data.visible } }
              : c
          ),
        }
      }),
    })))
  }, [])

  const deleteSubgroup = useCallback((gId: string, sgId: string) => {
    setTables(prev => prev.map(t => ({
      ...t,
      groups: t.groups.map(g => {
        if (g.id !== gId) return g
        return { ...g, children: g.children.filter(c => !(c.kind === 'subgroup' && c.data.id === sgId)) }
      }),
    })))
  }, [])

  const moveSubgroupUp = useCallback((gId: string, sgId: string) => {
    setTables(prev => prev.map(t => ({
      ...t,
      groups: t.groups.map(g => {
        if (g.id !== gId) return g
        const idx = g.children.findIndex(c => c.kind === 'subgroup' && c.data.id === sgId)
        if (idx <= 0) return g
        return { ...g, children: arrayMove(g.children, idx, idx - 1) }
      }),
    })))
  }, [])

  const moveSubgroupDown = useCallback((gId: string, sgId: string) => {
    setTables(prev => prev.map(t => ({
      ...t,
      groups: t.groups.map(g => {
        if (g.id !== gId) return g
        const idx = g.children.findIndex(c => c.kind === 'subgroup' && c.data.id === sgId)
        if (idx === -1 || idx >= g.children.length - 1) return g
        return { ...g, children: arrayMove(g.children, idx, idx + 1) }
      }),
    })))
  }, [])

  // ── Item mutations ────────────────────────────────────────────────────────

  const addItem = useCallback((
    rowType: ReportRowType,
    _key: string,
    label: string,
    targetGroupId: string,
    portion: ReportPortion,
    incomeTypeId?: string,
    transactionTypeKey?: string,
  ) => {
    const newItem: ReportItem = {
      id: uid(),
      rowType,
      categoryName: label,
      displayLabel: label,
      portion,
      visible: true,
      ...(incomeTypeId       ? { incomeTypeId }       : {}),
      ...(transactionTypeKey ? { transactionTypeKey } : {}),
    }
    setTables(prev => prev.map(t => ({
      ...t,
      groups: t.groups.map(g =>
        g.id !== targetGroupId ? g : { ...g, children: [...g.children, { kind: 'item' as const, data: newItem }] }
      ),
    })))
  }, [])

  const toggleItem = useCallback((itemId: string) => {
    setTables(prev => prev.map(t => ({
      ...t,
      groups: t.groups.map(g => ({
        ...g,
        children: g.children.map(c => {
          if (c.kind === 'item') {
            return c.data.id === itemId ? { kind: 'item' as const, data: { ...c.data, visible: !c.data.visible } } : c
          }
          return { kind: 'subgroup' as const, data: {
            ...c.data,
            items: c.data.items.map(i => i.id === itemId ? { ...i, visible: !i.visible } : i),
          }}
        }),
      })),
    })))
  }, [])

  const renameItem = useCallback((itemId: string, label: string) => {
    setTables(prev => prev.map(t => ({
      ...t,
      groups: t.groups.map(g => ({
        ...g,
        children: g.children.map(c => {
          if (c.kind === 'item') {
            return c.data.id === itemId ? { kind: 'item' as const, data: { ...c.data, displayLabel: label } } : c
          }
          return { kind: 'subgroup' as const, data: {
            ...c.data,
            items: c.data.items.map(i => i.id === itemId ? { ...i, displayLabel: label } : i),
          }}
        }),
      })),
    })))
  }, [])

  const changeItemPortion = useCallback((itemId: string, portion: ReportPortion) => {
    setTables(prev => prev.map(t => ({
      ...t,
      groups: t.groups.map(g => ({
        ...g,
        children: g.children.map(c => {
          if (c.kind === 'item') {
            return c.data.id === itemId ? { kind: 'item' as const, data: { ...c.data, portion } } : c
          }
          return { kind: 'subgroup' as const, data: {
            ...c.data,
            items: c.data.items.map(i => i.id === itemId ? { ...i, portion } : i),
          }}
        }),
      })),
    })))
  }, [])

  const deleteItem = useCallback((itemId: string) => {
    setTables(prev => prev.map(t => ({
      ...t,
      groups: t.groups.map(g => ({
        ...g,
        children: g.children.reduce<ReportGroupChild[]>((acc, c) => {
          if (c.kind === 'item') {
            return c.data.id === itemId ? acc : [...acc, c]
          }
          return [...acc, { kind: 'subgroup' as const, data: {
            ...c.data, items: c.data.items.filter(i => i.id !== itemId),
          }}]
        }, []),
      })),
    })))
  }, [])

  const moveItemUp = useCallback((itemId: string) => {
    setTables(prev => prev.map(t => ({
      ...t,
      groups: t.groups.map(g => {
        const idx = g.children.findIndex(c => c.kind === 'item' && c.data.id === itemId)
        if (idx > 0) return { ...g, children: arrayMove(g.children, idx, idx - 1) }
        return {
          ...g,
          children: g.children.map(c => {
            if (c.kind !== 'subgroup') return c
            const si = c.data.items.findIndex(i => i.id === itemId)
            if (si > 0) return { kind: 'subgroup' as const, data: { ...c.data, items: arrayMove(c.data.items, si, si - 1) } }
            return c
          }),
        }
      }),
    })))
  }, [])

  const moveItemDown = useCallback((itemId: string) => {
    setTables(prev => prev.map(t => ({
      ...t,
      groups: t.groups.map(g => {
        const idx = g.children.findIndex(c => c.kind === 'item' && c.data.id === itemId)
        if (idx !== -1 && idx < g.children.length - 1) return { ...g, children: arrayMove(g.children, idx, idx + 1) }
        return {
          ...g,
          children: g.children.map(c => {
            if (c.kind !== 'subgroup') return c
            const si = c.data.items.findIndex(i => i.id === itemId)
            if (si !== -1 && si < c.data.items.length - 1) return { kind: 'subgroup' as const, data: { ...c.data, items: arrayMove(c.data.items, si, si + 1) } }
            return c
          }),
        }
      }),
    })))
  }, [])

  const moveItemToSubgroup = useCallback((itemId: string, targetSgId: string) => {
    setTables(prev => prev.map(t => ({
      ...t,
      groups: t.groups.map(g => {
        if (!g.children.some(c => c.kind === 'subgroup' && c.data.id === targetSgId)) return g
        let item: ReportItem | undefined
        const withoutItem = g.children.reduce<ReportGroupChild[]>((acc, c) => {
          if (c.kind === 'item') {
            if (c.data.id === itemId) { item = c.data; return acc }
            return [...acc, c]
          }
          const si = c.data.items.findIndex(i => i.id === itemId)
          if (si !== -1) {
            item = c.data.items[si]
            return [...acc, { kind: 'subgroup' as const, data: { ...c.data, items: c.data.items.filter(i => i.id !== itemId) } }]
          }
          return [...acc, c]
        }, [])
        if (!item) return g
        return {
          ...g,
          children: withoutItem.map(c =>
            c.kind === 'subgroup' && c.data.id === targetSgId
              ? { kind: 'subgroup' as const, data: { ...c.data, items: [...c.data.items, item!] } }
              : c
          ),
        }
      }),
    })))
  }, [])

  const removeItemFromSubgroup = useCallback((itemId: string) => {
    setTables(prev => prev.map(t => ({
      ...t,
      groups: t.groups.map(g => {
        let item: ReportItem | undefined
        const newChildren = g.children.map(c => {
          if (c.kind !== 'subgroup') return c
          const si = c.data.items.findIndex(i => i.id === itemId)
          if (si !== -1) {
            item = c.data.items[si]
            return { kind: 'subgroup' as const, data: { ...c.data, items: c.data.items.filter(i => i.id !== itemId) } }
          }
          return c
        })
        if (!item) return g
        return { ...g, children: [...newChildren, { kind: 'item' as const, data: item }] }
      }),
    })))
  }, [])

  // ── Drag-and-drop ─────────────────────────────────────────────────────────

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(String(event.active.id))
  }

  const handleDragOver = (event: DragOverEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return

    const activeStr  = String(active.id)
    const overStr    = String(over.id)
    const activeType = prefixType(activeStr)
    const overType   = prefixType(overStr)

    // Cross-group item moves (direct group children only — not items inside subgroups)
    if (activeType === 'itm') {
      const itemId = stripPrefix(activeStr)
      const loc    = findItem(tables, itemId)
      if (!loc || loc.subgroupId) return

      let destGroupId: string | null = null
      if (overType === 'grp') {
        destGroupId = stripPrefix(overStr)
      } else if (overType === 'itm') {
        const overItemLoc = findItem(tables, stripPrefix(overStr))
        if (overItemLoc && !overItemLoc.subgroupId) destGroupId = overItemLoc.groupId
      }
      // sgp → ignore (ambiguous cross-group intent)

      if (!destGroupId || destGroupId === loc.groupId) return

      setTables(prev => {
        const item = findItem(prev, itemId)?.item
        if (!item) return prev
        return prev.map(t => ({
          ...t,
          groups: t.groups.map(g => {
            if (g.id === loc.groupId) {
              return { ...g, children: g.children.filter(c => !(c.kind === 'item' && c.data.id === itemId)) }
            }
            if (g.id === destGroupId) {
              return { ...g, children: [...g.children, { kind: 'item' as const, data: item }] }
            }
            return g
          }),
        }))
      })
    }
  }

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    setActiveId(null)
    if (!over || active.id === over.id) return

    const activeStr  = String(active.id)
    const overStr    = String(over.id)
    const activeType = prefixType(activeStr)
    const overType   = prefixType(overStr)

    // Reorder tables
    if (activeType === 'tbl' && overType === 'tbl') {
      const ai = tables.findIndex(t => tblId(t.id) === activeStr)
      const oi = tables.findIndex(t => tblId(t.id) === overStr)
      if (ai !== -1 && oi !== -1) setTables(prev => arrayMove(prev, ai, oi))
      return
    }

    // Reorder groups within or across tables
    if (activeType === 'grp' && overType === 'grp') {
      const activeGId = stripPrefix(activeStr)
      const overGId   = stripPrefix(overStr)
      const activeLoc = findGroup(tables, activeGId)
      const overLoc   = findGroup(tables, overGId)
      if (!activeLoc || !overLoc) return

      if (activeLoc.tableId === overLoc.tableId) {
        setTables(prev => prev.map(t => {
          if (t.id !== activeLoc.tableId) return t
          const ai2 = t.groups.findIndex(g => g.id === activeGId)
          const oi2 = t.groups.findIndex(g => g.id === overGId)
          return { ...t, groups: arrayMove(t.groups, ai2, oi2) }
        }))
      } else {
        setTables(prev => {
          const group = findGroup(prev, activeGId)?.group
          if (!group) return prev
          return prev.map(t => {
            if (t.id === activeLoc.tableId) return { ...t, groups: t.groups.filter(g => g.id !== activeGId) }
            if (t.id === overLoc.tableId) {
              const oi2 = t.groups.findIndex(g => g.id === overGId)
              const newGroups = [...t.groups]
              newGroups.splice(oi2, 0, group)
              return { ...t, groups: newGroups }
            }
            return t
          })
        })
      }
      return
    }

    // Group-level child reorder: items ↔ items, items ↔ subgroups, subgroups ↔ subgroups
    if (activeType === 'itm' || activeType === 'sgp') {
      if (overType !== 'itm' && overType !== 'sgp') return

      const activeRawId = stripPrefix(activeStr)
      const overRawId   = stripPrefix(overStr)

      // Special case: two items inside the same subgroup
      if (activeType === 'itm' && overType === 'itm') {
        const activeLoc = findItem(tables, activeRawId)
        const overLoc   = findItem(tables, overRawId)
        if (!activeLoc || !overLoc || activeLoc.groupId !== overLoc.groupId) return
        if (activeLoc.subgroupId && overLoc.subgroupId && activeLoc.subgroupId === overLoc.subgroupId) {
          setTables(prev => prev.map(t => ({
            ...t,
            groups: t.groups.map(g => {
              if (g.id !== activeLoc.groupId) return g
              return {
                ...g,
                children: g.children.map(c => {
                  if (c.kind !== 'subgroup' || c.data.id !== activeLoc.subgroupId) return c
                  const ai2 = c.data.items.findIndex(i => i.id === activeRawId)
                  const oi2 = c.data.items.findIndex(i => i.id === overRawId)
                  if (ai2 === -1 || oi2 === -1) return c
                  return { kind: 'subgroup' as const, data: { ...c.data, items: arrayMove(c.data.items, ai2, oi2) } }
                }),
              }
            }),
          })))
          return
        }
        // Block cross-subgroup DnD
        if (activeLoc.subgroupId || overLoc.subgroupId) return
      }

      // General: reorder direct group children (itm ↔ itm, itm ↔ sgp, sgp ↔ sgp, sgp ↔ itm)
      setTables(prev => prev.map(t => ({
        ...t,
        groups: t.groups.map(g => {
          const ai2 = g.children.findIndex(c =>
            activeType === 'itm'
              ? c.kind === 'item' && c.data.id === activeRawId
              : c.kind === 'subgroup' && c.data.id === activeRawId
          )
          if (ai2 === -1) return g
          const oi2 = g.children.findIndex(c =>
            overType === 'itm'
              ? c.kind === 'item' && c.data.id === overRawId
              : c.kind === 'subgroup' && c.data.id === overRawId
          )
          if (oi2 === -1) return g
          return { ...g, children: arrayMove(g.children, ai2, oi2) }
        }),
      })))
    }
  }

  const combinedTables = tables.filter(t => t.visible && (t.include_in_combined_total ?? true))
  const grandTotal = combinedTables.reduce((s, t) => s + computeTableTotal(t, balances, operationalBalances), 0)
  const showCombinedTotal = tables.filter(t => t.visible).length > 1 && combinedTables.length > 0

  const selectedTpl = templates.find(t => t.id === selectedTplId) ?? null

  // ── Report view ───────────────────────────────────────────────────────────

  const renderReportView = () => {
    if (tables.length === 0) {
      return (
        <div className="flex flex-col items-center justify-center py-16 text-gray-400">
          <FileText className="w-12 h-12 mb-3 opacity-30" />
          <p className="text-sm">No layout configured.</p>
          <p className="text-xs mt-1">Click <strong>Edit Layout</strong> to build your report.</p>
        </div>
      )
    }

    return (
      <div className="space-y-6">
        {/* Report header */}
        <div className="rounded-xl border border-primary/20 overflow-hidden">
          <div className="bg-primary px-6 py-4 text-white text-center">
            <h2 className="text-base font-bold uppercase tracking-wide">Breakdown of Financial Report</h2>
            <p className="text-sm opacity-80 mt-0.5">
              {new Date(reportDate + 'T12:00:00').toLocaleDateString('en-GB', {
                weekday: 'long', day: '2-digit', month: 'long', year: 'numeric',
              })}
            </p>
            <p className="text-xs opacity-60 mt-0.5">
              Basis: {reportBasis === 'transaction_date' ? 'Transaction Date' : 'Recorded Date'}
            </p>
          </div>
        </div>

        {tables.filter(t => t.visible).map(table => (
          <div key={table.id} className="rounded-xl border border-gray-200 dark:border-white/[0.07] overflow-hidden">
            {tables.length > 1 && (
              <div className="bg-primary/10 dark:bg-primary/20 px-6 py-2 border-b border-primary/10">
                <h3 className="text-sm font-bold text-primary dark:text-blue-300 uppercase tracking-wide">{table.title}</h3>
              </div>
            )}
            <div className="overflow-x-auto scroll-x-fade">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 dark:bg-[#141416] text-xs uppercase text-gray-500 dark:text-gray-400">
                  <th className="px-6 py-2 text-left font-semibold">Account / Description</th>
                  <th className="px-6 py-2 text-right font-semibold">Amount ({baseCurrencySymbol})</th>
                </tr>
              </thead>
              <tbody>
                {table.groups.filter(g => g.visible).map(group => {
                  const groupTotal = computeGroupTotal(group, balances, operationalBalances)
                  return (
                    <>
                      <tr key={`gh-${group.id}`} className="bg-primary/10 dark:bg-primary/20">
                        <td colSpan={2} className="px-6 py-2 font-bold text-xs uppercase tracking-widest text-primary dark:text-blue-300">
                          {group.label}
                        </td>
                      </tr>

                      {group.children.map(child => {
                        if (child.kind === 'item') {
                          const item = child.data
                          if (!item.visible) return null
                          if (!shouldDisplayRow(item, balances, operationalBalances)) return null
                          const val = getItemBalance(item, balances, operationalBalances)
                          return (
                            <tr key={item.id} className="border-b border-gray-100 dark:border-white/[0.06] hover:bg-black/[0.02] dark:hover:bg-white/[0.03]">
                              <td className="px-8 py-2 text-gray-700 dark:text-gray-300">{item.displayLabel}</td>
                              <td className="px-6 py-2 text-right font-mono text-gray-900 dark:text-gray-100">{baseCurrencySymbol}{fmt(val, formatLocale)}</td>
                            </tr>
                          )
                        } else {
                          const sg = child.data
                          if (!sg.visible) return null
                          const sgTotal = sg.items.filter(i => i.visible && shouldDisplayRow(i, balances, operationalBalances)).reduce((s, i) => s + getItemBalance(i, balances, operationalBalances), 0)
                          return (
                            <>
                              <tr key={`sgh-${sg.id}`} className="bg-gray-50/80 dark:bg-[#141416]/40">
                                <td colSpan={2} className="px-8 py-1.5 text-xs font-semibold italic text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                                  {sg.label}
                                </td>
                              </tr>
                              {sg.items.filter(i => i.visible && shouldDisplayRow(i, balances, operationalBalances)).map(item => {
                                const val = getItemBalance(item, balances, operationalBalances)
                                return (
                                  <tr key={item.id} className="border-b border-gray-100 dark:border-white/[0.07]">
                                    <td className="px-12 py-2 text-gray-600 dark:text-gray-400">{item.displayLabel}</td>
                                    <td className="px-6 py-2 text-right font-mono text-gray-900 dark:text-gray-100">{baseCurrencySymbol}{fmt(val, formatLocale)}</td>
                                  </tr>
                                )
                              })}
                              <tr key={`sgs-${sg.id}`} className="bg-gray-100/60 dark:bg-[#141416]/30">
                                <td className="px-8 py-1 text-[11px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest">{sg.label} Sub-Total</td>
                                <td className="px-6 py-1 text-right font-mono font-bold text-xs">{baseCurrencySymbol}{fmt(sgTotal, formatLocale)}</td>
                              </tr>
                            </>
                          )
                        }
                      })}

                      <tr key={`gs-${group.id}`} className="bg-gray-100 dark:bg-[#141416]">
                        <td className="px-6 py-2 font-semibold text-xs uppercase tracking-wide text-gray-600 dark:text-gray-400">
                          {group.label} Sub-Total
                        </td>
                        <td className="px-6 py-2 text-right font-mono font-bold text-gray-900 dark:text-gray-100">
                          {baseCurrencySymbol}{fmt(groupTotal, formatLocale)}
                        </td>
                      </tr>
                      <tr key={`sp-${group.id}`}><td colSpan={2} className="py-1" /></tr>
                    </>
                  )
                })}

                <tr className="bg-primary text-white">
                  <td className="px-6 py-3 font-bold uppercase tracking-widest text-sm">
                    {tables.length > 1 ? `${table.title} Total` : 'Grand Total'}
                  </td>
                  <td className="px-6 py-3 text-right font-mono font-bold text-lg">
                    {baseCurrencySymbol}{fmt(computeTableTotal(table, balances, operationalBalances), formatLocale)}
                  </td>
                </tr>
              </tbody>
            </table>
            </div>
          </div>
        ))}

        {showCombinedTotal && (
          <div className="flex justify-between items-center px-6 py-4 rounded-xl bg-primary/5 border-2 border-primary/20 font-bold">
            <span className="text-primary uppercase tracking-widest text-sm">Combined Grand Total</span>
            <span className="font-mono text-lg text-primary">{baseCurrencySymbol}{fmt(grandTotal, formatLocale)}</span>
          </div>
        )}
      </div>
    )
  }

  // ── All sortable IDs for the top-level DnD ────────────────────────────────

  const allSortableIds = [
    ...tables.map(t => tblId(t.id)),
    ...tables.flatMap(t => t.groups.map(g => grpId(g.id))),
    ...tables.flatMap(t => t.groups.flatMap(g =>
      g.children.map(c =>
        c.kind === 'item' ? itmId(c.data.id) : sgpId(c.data.id)
      )
    )),
  ]

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
        {/* Left: pickers */}
        <div className="space-y-3">
          {tables.length > 0 && tables.some(t => t.groups.length > 0) ? (
            <CategoryPicker
              categories={categories}
              incomeTypes={incomeTypes}
              tables={tables}
              onAdd={addItem}
            />
          ) : (
            <div className="rounded-xl border border-dashed border-gray-300 dark:border-white/[0.10] p-4 text-center text-sm text-gray-500">
              Add a table with a group first.
            </div>
          )}
          <button
            type="button"
            onClick={addTable}
            className="w-full flex items-center justify-center gap-2 rounded-xl border-2 border-dashed border-primary/40 px-4 py-3 text-sm font-medium text-primary hover:border-primary hover:bg-primary/5 transition"
          >
            <TableProperties className="w-4 h-4" /> Add Table
          </button>
        </div>

        {/* Right: layout builder */}
        <div className="lg:col-span-2 space-y-4">
          {unmappedIncomeTypes.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800 p-3">
              <div className="flex gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-500 shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">Income types not in template</p>
                  <p className="text-xs text-amber-800 dark:text-amber-300 mt-1">
                    {unmappedIncomeTypes.map(it => it.name).join(', ')} {unmappedIncomeTypes.length === 1 ? 'is' : 'are'} not included. Consider adding {unmappedIncomeTypes.length === 1 ? 'it' : 'them'} to avoid missing data.
                  </p>
                </div>
              </div>
            </div>
          )}
          {tables.length === 0 ? (
            <div className="rounded-xl border border-dashed border-gray-300 dark:border-white/[0.10] p-8 text-center text-gray-400">
              <p className="text-sm">No tables yet.</p>
              <p className="text-xs mt-1">Click <strong>Add Table</strong> to get started.</p>
            </div>
          ) : (
            <SortableContext items={allSortableIds} strategy={verticalListSortingStrategy}>
              {tables.map((table, i) => (
                <SortableTableBlock
                  key={table.id}
                  table={table}
                  balances={balances}
                  opBalances={operationalBalances}
                  editing={true}
                  isFirst={i === 0}
                  isLast={i === tables.length - 1}
                  onRenameTable={renameTable}
                  onToggleTable={toggleTable}
                  onDeleteTable={deleteTable}
                  onMoveUp={moveTableUp}
                  onMoveDown={moveTableDown}
                  onToggleCombined={toggleTableCombined}
                  onAddGroup={addGroup}
                  onMoveGroupUp={moveGroupUp}
                  onMoveGroupDown={moveGroupDown}
                  onRenameGroup={renameGroup}
                  onToggleGroup={toggleGroup}
                  onDeleteGroup={deleteGroup}
                  onAddSubgroup={addSubgroup}
                  onRenameSubgroup={renameSubgroup}
                  onToggleSubgroup={toggleSubgroup}
                  onDeleteSubgroup={deleteSubgroup}
                  onToggleItem={toggleItem}
                  onRenameItem={renameItem}
                  onChangeItemPortion={changeItemPortion}
                  onDeleteItem={deleteItem}
                  onMoveItemUp={moveItemUp}
                  onMoveItemDown={moveItemDown}
                  onMoveItemToSubgroup={moveItemToSubgroup}
                  onRemoveItemFromSubgroup={removeItemFromSubgroup}
                  onMoveSubgroupUp={moveSubgroupUp}
                  onMoveSubgroupDown={moveSubgroupDown}
                />
              ))}
            </SortableContext>
          )}

          {showCombinedTotal && (
            <div className="flex justify-between items-center px-4 py-3 rounded-xl bg-primary/5 border-2 border-primary/20 font-bold text-primary">
              <span className="uppercase tracking-widest text-sm">Combined Grand Total</span>
              <span className="font-mono text-lg">{baseCurrencySymbol}{fmt(grandTotal, formatLocale)}</span>
            </div>
          )}
        </div>
      </div>

      <DragOverlay>
        {activeId && (() => {
          const type = prefixType(activeId)
          const id   = stripPrefix(activeId)
          if (type === 'itm') {
            const loc = findItem(tables, id)
            if (!loc) return null
            return (
              <div className="px-3 py-2 rounded-lg bg-white dark:bg-[#141416] border border-primary shadow-lg text-sm font-medium">
                {loc.item.displayLabel}
              </div>
            )
          }
          if (type === 'grp') {
            const loc = findGroup(tables, id)
            if (!loc) return null
            return (
              <div className="px-4 py-2 rounded-xl bg-primary/20 border border-primary shadow-lg text-sm font-bold uppercase">
                {loc.group.label}
              </div>
            )
          }
          if (type === 'tbl') {
            const t = tables.find(t2 => t2.id === id)
            if (!t) return null
            return (
              <div className="px-4 py-2 rounded-xl bg-primary/10 border-2 border-primary shadow-lg text-sm font-bold">
                {t.title}
              </div>
            )
          }
          return null
        })()}
      </DragOverlay>
    </DndContext>
  )

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="p-4 md:p-6 space-y-4">
      {/* Breadcrumb */}
      <Link
        to="/reports"
        className="inline-flex items-center gap-1.5 text-xs text-gray-500 hover:text-primary transition-colors print:hidden"
      >
        <ChevronDown className="w-3.5 h-3.5 rotate-90" aria-hidden="true" />
        All Reports
      </Link>

      {/* Page header */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex items-center gap-3 flex-1">
          <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
            <FileText className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-gray-900 dark:text-white">Financial Report</h1>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Multi-table report builder · {reportBasis === 'transaction_date' ? 'Transaction Date basis' : 'Recorded Date basis'}
            </p>
          </div>
        </div>

        {/* Controls */}
        <div className="flex flex-wrap items-center gap-2">

          {/* Date picker */}
          <div className="flex items-center gap-1.5 rounded-lg border border-gray-300 dark:border-white/[0.10] px-3 py-1.5 bg-white dark:bg-[#141416] text-sm">
            <span className="text-gray-500 text-xs">Date:</span>
            <input
              type="date"
              value={reportDate}
              onChange={e => setReportDate(e.target.value)}
              className="bg-transparent border-none outline-none text-sm text-gray-900 dark:text-white"
            />
          </div>

          {/* Report basis selector */}
          <select
            value={reportBasis}
            onChange={e => setReportBasis(e.target.value as ReportBasis)}
            className="rounded-lg border border-gray-300 dark:border-white/[0.10] px-2 py-1.5 text-xs bg-white dark:bg-[#141416] text-gray-700 dark:text-gray-200"
            title="Report basis"
          >
            <option value="transaction_date">Transaction Date</option>
            <option value="recorded_at">Recorded Date</option>
          </select>

          {/* Refresh */}
          <button
            type="button"
            onClick={() => refetch()}
            disabled={loading}
            className="touch-target p-1.5 rounded-lg border border-gray-300 dark:border-white/[0.10] bg-white dark:bg-[#141416] text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition disabled:opacity-50"
            title="Refresh balances" aria-label="Refresh balances"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>

          {/* Template selector */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setTplMenuOpen(p => !p)}
              className="flex items-center gap-1.5 rounded-lg border border-gray-300 dark:border-white/[0.10] px-3 py-1.5 bg-white dark:bg-[#141416] text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 transition"
            >
              <Settings2 className="w-3.5 h-3.5" />
              {selectedTpl ? selectedTpl.name : 'Templates'}
              {pinnedTemplateId && <Pin className="w-3 h-3 text-primary shrink-0" />}
              <ChevronDown className="w-3.5 h-3.5" />
            </button>

            {tplMenuOpen && (
              <div className="absolute right-0 top-full mt-1 w-60 rounded-xl border border-gray-200 dark:border-white/[0.07] bg-white dark:bg-[#141416] shadow-xl z-20 py-1">
                <div className="px-3 py-1.5 text-[11px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest uppercase tracking-wide">Saved Templates</div>
                {templates.length === 0 && (
                  <p className="px-3 py-2 text-xs text-gray-500">No templates yet</p>
                )}
                {templates.map(tpl => {
                  const isPinned = pinnedTemplateId === tpl.id
                  return (
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
                        title={isPinned ? 'Unpin template' : 'Pin template'}
                        onClick={() => isPinned ? unpinTemplate() : pinTemplate(tpl.id)}
                        className={`touch-target p-1 rounded transition ${isPinned ? 'text-primary hover:text-primary/70' : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-200'}`}
                      >
                        {isPinned ? <PinOff className="w-3.5 h-3.5" /> : <Pin className="w-3.5 h-3.5" />}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteTemplate(tpl)}
                        className="p-1 text-red-400 hover:text-red-600 rounded"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )
                })}
                <div className="border-t border-gray-100 dark:border-white/[0.07] mt-1 pt-1">
                  <button
                    type="button"
                    onClick={() => { setSelectedTplId(null); setTables([]); setTplMenuOpen(false) }}
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
                : 'border border-gray-300 dark:border-white/[0.10] bg-white dark:bg-[#141416] text-gray-700 dark:text-gray-200 hover:bg-gray-50'
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
              className="flex items-center gap-1.5 rounded-lg border border-gray-300 dark:border-white/[0.10] px-3 py-1.5 bg-white dark:bg-[#141416] text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 transition"
            >
              <Save className="w-3.5 h-3.5" />
              Save Template
            </button>
          )}

          {/* Hide zero rows toggle */}
          {!editMode && tables.length > 0 && (
            <label className="flex items-center gap-2 rounded-lg border border-gray-300 dark:border-white/[0.10] px-3 py-1.5 bg-white dark:bg-[#141416] text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 transition cursor-pointer">
              <input
                type="checkbox"
                checked={hideZeroRows}
                onChange={e => setHideZeroRows(e.target.checked)}
                className="w-4 h-4 rounded border-gray-300 text-primary cursor-pointer"
              />
              <span>Hide zero rows</span>
            </label>
          )}

          {/* Export PDF */}
          {!editMode && tables.length > 0 && (
            <button
              type="button"
              onClick={() => exportReportPDF(currentLayout, balances, reportDate, undefined, operationalBalances, baseCurrencySymbol, formatLocale, hideZeroRows)}
              className="flex items-center gap-1.5 rounded-lg border border-gray-300 dark:border-white/[0.10] px-3 py-1.5 bg-white dark:bg-[#141416] text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 transition"
            >
              <Download className="w-3.5 h-3.5" />
              PDF
            </button>
          )}

          {/* Export Excel */}
          {!editMode && tables.length > 0 && (
            <button
              type="button"
              onClick={() => exportReportExcel(currentLayout, balances, reportDate, undefined, operationalBalances, baseCurrencySymbol, formatLocale, hideZeroRows)}
              className="flex items-center gap-1.5 rounded-lg border border-gray-300 dark:border-white/[0.10] px-3 py-1.5 bg-white dark:bg-[#141416] text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 transition"
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
      <div className="overflow-x-auto scroll-x-fade">
        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map(i => (
              <div key={i} className="rounded-xl border border-gray-100 bg-white p-4">
                <div className="animate-pulse bg-gray-200 rounded h-4 w-1/4 mb-3" />
                <div className="animate-pulse bg-gray-200 rounded h-3 w-full mb-2" />
                <div className="animate-pulse bg-gray-200 rounded h-3 w-2/3" />
              </div>
            ))}
          </div>
        ) : editMode ? renderEditMode() : renderReportView()}
      </div>

      {/* Save template modal */}
      <SaveReportTemplateModal
        open={saveModalOpen}
        onClose={() => setSaveModalOpen(false)}
        onSaved={handleSaved}
        layout={currentLayout}
        editTemplate={selectedTpl}
      />
    </div>
  )
}
