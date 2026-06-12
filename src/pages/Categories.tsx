import { useState, useEffect, Fragment, useMemo, useRef } from 'react'
import { Plus, Pencil, Trash2, Layers, AlertCircle, Terminal, Eye, EyeOff, FolderPlus, X, Check, Globe } from 'lucide-react'
import { DataControlsBar } from '../components/ui/DataControlsBar'
import { PaginationBar } from '../components/ui/PaginationBar'
import { useDataViewState } from '../hooks/useDataViewState'
import { sortRows, multiSortRows } from '../utils/sortUtils'
import { friendlyError } from '../utils/friendlyError'
import type { TableColumnDef } from '../utils/tableColumns'
import { deriveSortFields } from '../utils/tableColumns'
import {
  useCategories, useCategoryGroups, useCategoryOpeningBalances,
  fetchCategoryOpeningBalances, upsertCategoryOpeningBalance, deleteCategoryOpeningBalance,
  type Category, type CategoryGroup, type CategoryOpeningBalance, type BudgetPortion,
} from '../hooks/useCategories'
import { CurrencyInput } from '../components/ui/CurrencyInput'
import {
  useAddCategory,
  useUpdateCategory,
  useDeleteCategory,
  useAddCategoryGroup,
  useDeleteCategoryGroup,
  useUpdateCategoryGroup,
} from '../hooks/useMutations'
import { usePageTitle } from '../hooks/usePageTitle'
import { useToast } from '../store/toastStore'
import { Modal } from '../components/ui/Modal'
import { DeleteDialog } from '../components/ui/DeleteDialog'
import { supabase } from '../lib/supabase'
import { exportCSV } from '../utils/csvExport'
import { formatCurrency } from '../utils/formatters'
import { ExportDropdown } from '../components/ui/ExportDropdown'
import { useDescriptionExpand }    from '../hooks/useDescriptionExpand'
import { DescriptionCell, DescriptionTooltip } from '../components/ui/DescriptionCell'
import {
  autoCreateLinkedOutflowType,
  syncLinkedOutflowTypeName,
  handleCategoryDeleteCleanup,
} from '../hooks/useOutflowTypes'
import { useOrgCurrency } from '../hooks/useOrgCurrency'
import { useOrgStore }    from '../store/orgStore'
import { useBanks }       from '../hooks/useBanks'
import { HelpButton }      from '../components/onboarding/HelpButton'
import { useFirstVisitTour } from '../hooks/useFirstVisitTour'

// ── Constants ──────────────────────────────────────────────────────────────────

const BUDGET_PORTIONS = ['Percentage Allocation', 'Specific Seed', 'Savings'] as const

const MIGRATION_SQL =
`-- Run in Supabase SQL Editor:
CREATE TABLE IF NOT EXISTS public.category_groups (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.category_groups ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Auth users manage groups" ON public.category_groups
  FOR ALL USING (auth.uid() IS NOT NULL);

ALTER TABLE public.categories
  ADD COLUMN IF NOT EXISTS group_id uuid REFERENCES public.category_groups(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS is_hidden boolean NOT NULL DEFAULT false;`

const CAT_COLUMNS: TableColumnDef<Category>[] = [
  { key: 'name',  label: 'Name',  sortType: 'text', primary: true, accessor: c => c.name },
  { key: 'group', label: 'Group',                   accessor: c => (c as unknown as { group?: { name?: string } }).group?.name ?? '' },
]

const CAT_SORT_FIELDS = deriveSortFields(CAT_COLUMNS)

// ── Deletion check ─────────────────────────────────────────────────────────────

async function categoryHasLinkedData(cat: Category): Promise<boolean> {
  const [inf, out, cob] = await Promise.all([
    supabase.from('inflow_transactions').select('id', { count: 'exact', head: true }).eq('stage_code_1', cat.name),
    supabase.from('outflow_transactions').select('id', { count: 'exact', head: true }).eq('stage_code_1', cat.name),
    supabase.from('category_opening_balances').select('id', { count: 'exact', head: true }).eq('category_id', cat.id),
  ])
  return (inf.count ?? 0) > 0 || (out.count ?? 0) > 0 || (cob.count ?? 0) > 0
}

// ── Category form modal ────────────────────────────────────────────────────────

interface CategoryModalProps {
  open:             boolean
  onClose:          () => void
  onSuccess:        () => void
  editRecord?:      Category | null
  groups:           CategoryGroup[]
  onGroupCreated:   () => void
  fxGroupIds:       Set<string>
  foreignCurrencies: { code: string; name: string; symbol: string }[]
  mode:             'local' | 'fx'
}

function CategoryModal({ open, onClose, onSuccess, editRecord, groups, onGroupCreated, fxGroupIds, foreignCurrencies, mode }: CategoryModalProps) {
  const isEdit = !!editRecord
  const orgId  = useOrgStore(s => s.orgId) ?? ''

  const addMutation    = useAddCategory()
  const updateMutation = useUpdateCategory()
  const addGroupMutation = useAddCategoryGroup()

  const { mutate: add,      loading: adding,    error: addErr,    reset: resetAdd    } = addMutation
  const { mutate: update,   loading: updating,  error: updateErr, reset: resetUpdate } = updateMutation
  const { mutate: addGroup, loading: addingGrp                                       } = addGroupMutation

  const [obSaving, setObSaving] = useState(false)
  const [obError,  setObError]  = useState<string | null>(null)

  const loading      = adding || updating || obSaving
  const error        = addErr || updateErr
  const displayError = error || obError

  const isMigrationError = !!error && /column.*does not exist|does not exist|relation.*does not exist/i.test(error)

  interface ObRow { budget_portion: BudgetPortion | ''; amount: string }

  const [name,         setName]         = useState('')
  const [desc,         setDesc]         = useState('')
  const [groupId,      setGroupId]      = useState('')
  const [currency,     setCurrency]     = useState('')
  const [newGroupName, setNewGroupName] = useState('')
  const [showNewGroup, setShowNewGroup] = useState(false)
  const [obRows,       setObRows]       = useState<ObRow[]>([])

  const isCurrentGroupFx = groupId !== '' && fxGroupIds.has(groupId)

  useEffect(() => {
    if (!open) return
    resetAdd(); resetUpdate()
    setObError(null)
    setName(editRecord?.name ?? '')
    setDesc(editRecord?.description ?? '')
    setGroupId(editRecord?.group_id ?? '')
    setCurrency(editRecord?.currency ?? '')
    setNewGroupName('')
    setShowNewGroup(false)
    setObRows([])
    if (editRecord?.id) {
      fetchCategoryOpeningBalances(editRecord.id).then(rows => {
        const validFetched = rows.filter(r => r.budget_portion)
        setObRows(validFetched.map(r => ({ budget_portion: r.budget_portion, amount: String(r.amount) })))
      }).catch(err => {
        console.warn('[CategoryModal] fetchCategoryOpeningBalances error', err)
      })
    }
  }, [open, editRecord]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleCreateGroup = async () => {
    if (!newGroupName.trim()) return
    const id = await addGroup({ name: newGroupName.trim() })
    onGroupCreated()
    setGroupId(id)
    setNewGroupName('')
    setShowNewGroup(false)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    setObSaving(true)
    setObError(null)
    try {
      // Reject rows where a portion is selected but the amount is missing, NaN, or non-positive
      const partialRows = obRows.filter(r => {
        if (!r.budget_portion) return false
        const amt = parseFloat(r.amount)
        return !r.amount || isNaN(amt) || !isFinite(amt) || amt <= 0
      })
      if (partialRows.length > 0) {
        setObError('Enter a valid amount greater than zero for each selected budget portion.')
        setObSaving(false)
        return
      }
      const validRows = obRows.filter(r => r.budget_portion && r.amount && parseFloat(r.amount) > 0)

      let savedId = editRecord?.id ?? ''
      if (isEdit && editRecord) {
        await update({
          id:          editRecord.id,
          name:        name.trim(),
          description: desc.trim() || undefined,
          group_id:    groupId || null,
          currency:    isCurrentGroupFx ? (currency || null) : null,
        })
        savedId = editRecord.id
      } else {
        savedId = await add({
          name:        name.trim(),
          description: desc.trim() || undefined,
          group_id:    groupId || null,
          currency:    isCurrentGroupFx ? (currency || null) : null,
        })
      }

      try {
        const usedPortions = new Set(validRows.map(r => r.budget_portion as BudgetPortion))

        if (isEdit && editRecord) {
          const existing = await fetchCategoryOpeningBalances(editRecord.id)
          for (const ex of existing) {
            if (!usedPortions.has(ex.budget_portion)) {
              await deleteCategoryOpeningBalance(editRecord.id, ex.budget_portion)
            }
          }
          await supabase
            .from('category_opening_balances')
            .delete()
            .eq('category_id', editRecord.id)
            .is('budget_portion', null)
        }
        for (const row of validRows) {
          await upsertCategoryOpeningBalance(savedId, row.budget_portion as BudgetPortion, parseFloat(row.amount), orgId)
        }
      } catch (obErr) {
        const msg = obErr instanceof Error ? obErr.message : String(obErr)
        console.error('[CategoryModal] ob upsert failed', msg)
        setObError(msg)
        return
      }

      // Auto-create linked outflow type for new categories (fire-and-forget)
      if (!isEdit) {
        autoCreateLinkedOutflowType(savedId, name.trim()).catch(() => {/* non-critical */})
      } else if (editRecord && name.trim() !== editRecord.name) {
        // Sync linked outflow type name if category was renamed (fire-and-forget)
        syncLinkedOutflowTypeName(savedId, name.trim(), editRecord.name).catch(() => {/* non-critical */})
      }

      onSuccess()
      onClose()
    } catch { /* hook error state already set by update/add mutators */ } finally {
      setObSaving(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={isEdit ? 'Edit Category' : 'New Category'} size="max-w-md">
      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        {displayError && (
          <div className="space-y-2">
            <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{isMigrationError ? 'Database migration required — run the SQL below in your Supabase SQL Editor, then try again.' : displayError}</span>
            </div>
            {isMigrationError && (
              <div className="rounded-lg border border-gray-200 bg-gray-900 overflow-hidden">
                <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-800 border-b border-gray-700">
                  <Terminal className="w-3 h-3 text-gray-400" />
                  <span className="text-[10px] text-gray-400 font-mono">Supabase SQL Editor</span>
                </div>
                <pre className="px-3 py-3 text-[11px] text-green-300 font-mono overflow-x-auto whitespace-pre">{MIGRATION_SQL}</pre>
              </div>
            )}
          </div>
        )}

        {/* Name */}
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-600">Category Name *</label>
          <input
            type="text" value={name} onChange={e => setName(e.target.value)}
            placeholder="e.g. Tithes, Offerings, Welfare" required
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
          />
        </div>

        {/* Group */}
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-600">Group (optional)</label>
          <div className="flex gap-2">
            <select
              value={groupId}
              onChange={e => setGroupId(e.target.value)}
              className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-white"
            >
              <option value="">— No group —</option>
              {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
            <button type="button" onClick={() => setShowNewGroup(v => !v)} title="Create new group"
              className="p-2 rounded-lg border border-gray-300 text-gray-500 hover:bg-gray-50 transition-colors">
              {showNewGroup ? <X className="w-4 h-4" /> : <FolderPlus className="w-4 h-4" />}
            </button>
          </div>
          {showNewGroup && (
            <div className="flex gap-2 mt-1">
              <input type="text" value={newGroupName} onChange={e => setNewGroupName(e.target.value)}
                placeholder="New group name" autoFocus
                className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
              />
              <button type="button" onClick={handleCreateGroup} disabled={!newGroupName.trim() || addingGrp}
                className="px-3 py-2 text-sm text-white bg-primary rounded-lg hover:bg-primary-light disabled:opacity-60">
                {addingGrp ? '…' : 'Add'}
              </button>
            </div>
          )}
        </div>

        {/* Currency — shown for FX groups, or always on FX tab */}
        {(isCurrentGroupFx || mode === 'fx') && foreignCurrencies.length > 0 && (
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-600">Foreign Currency</label>
            <select
              value={currency}
              onChange={e => setCurrency(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-white"
            >
              <option value="">— Select currency —</option>
              {foreignCurrencies.map(c => (
                <option key={c.code} value={c.code}>{c.symbol} {c.name} ({c.code})</option>
              ))}
            </select>
          </div>
        )}

        {/* Description */}
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-600">Description</label>
          <textarea value={desc} onChange={e => setDesc(e.target.value)} rows={2}
            placeholder="Optional description"
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary resize-none"
          />
        </div>

        {/* Opening Balances by Portion */}
        <div className="border border-gray-100 rounded-lg p-3 space-y-3 bg-gray-50">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-gray-500">Opening Balances by Portion</p>
            <button
              type="button"
              onClick={() => setObRows(prev => [...prev, { budget_portion: '', amount: '' }])}
              disabled={obRows.length >= BUDGET_PORTIONS.length}
              className="flex items-center gap-1 text-xs text-primary hover:text-primary-light font-medium disabled:opacity-40"
            >
              <Plus className="w-3 h-3" /> Add
            </button>
          </div>

          {obRows.length === 0 && (
            <p className="text-[11px] text-gray-400">No opening balances. Click Add to set a balance brought forward per budget portion.</p>
          )}

          <div className="space-y-2">
            {obRows.map((row, i) => {
              const usedPortions = new Set(obRows.filter((_, j) => j !== i).map(r => r.budget_portion))
              return (
                <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-2 items-center">
                  <select
                    value={row.budget_portion}
                    onChange={e => setObRows(prev => prev.map((r, j) => j === i ? { ...r, budget_portion: e.target.value as BudgetPortion | '' } : r))}
                    className="px-2 py-1.5 text-xs border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-primary/30 bg-white"
                  >
                    <option value="">— Portion —</option>
                    {BUDGET_PORTIONS.map(p => (
                      <option key={p} value={p} disabled={usedPortions.has(p)}>{p}</option>
                    ))}
                  </select>
                  <CurrencyInput
                    value={row.amount ? parseFloat(row.amount) : undefined}
                    onChange={v => setObRows(prev => prev.map((r, j) => j === i ? { ...r, amount: v != null ? String(v) : '' } : r))}
                    placeholder="0.00"
                    className="px-2 py-1.5 text-xs border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-primary/30 bg-white"
                  />
                  <button
                    type="button"
                    onClick={() => setObRows(prev => prev.filter((_, j) => j !== i))}
                    className="touch-target p-1 rounded text-gray-300 hover:text-danger hover:bg-red-50 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              )
            })}
          </div>
          <p className="text-[11px] text-gray-400">Balance brought forward per budget portion. Each portion can only appear once.</p>
        </div>

        <div className="flex justify-end gap-3 pt-1">
          <button type="button" onClick={onClose} disabled={loading}
            className="px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50">
            Cancel
          </button>
          <button type="submit" disabled={loading || !name.trim()}
            className="px-5 py-2 text-sm text-white bg-primary rounded-lg hover:bg-primary-light disabled:opacity-60 flex items-center gap-2">
            {loading && <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
            {loading ? 'Saving…' : isEdit ? 'Save Changes' : 'Create'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

// ── Main page ──────────────────────────────────────────────────────────────────

export default function Categories() {
  usePageTitle('Categories')
  useFirstVisitTour('categories')
  const { baseCurrencySymbol, formatLocale, foreignCurrencies } = useOrgCurrency()

  const { categories, loading, error, refetch }    = useCategories()
  const { groups, error: groupsError, refetch: refetchGroups } = useCategoryGroups()
  const { balances: allOpeningBalances, refetch: refetchBalances } = useCategoryOpeningBalances()
  const { mutate: deleteCategory }                  = useDeleteCategory()
  const { mutate: updateCategory }                  = useUpdateCategory()
  const { mutate: deleteGroup }                     = useDeleteCategoryGroup()
  const { mutate: updateGroup }                     = useUpdateCategoryGroup()
  const toast = useToast()
  const { banks } = useBanks()

  const [activeTab, setActiveTab] = useState<'local' | 'fx'>('local')

  // Identify FX groups by matching group names against foreign currency codes/name-words
  const fxGroupIds = useMemo(() => {
    const terms = new Set<string>()
    foreignCurrencies.forEach(c => {
      terms.add(c.code.toLowerCase())
      c.name.toLowerCase().split(/\s+/).forEach(w => terms.add(w))
    })
    // Also include currencies from FX banks that may not be in the currency table
    banks.filter(b => b.is_foreign_currency && b.currency).forEach(b => {
      terms.add((b.currency as string).toLowerCase())
    })
    return new Set(
      groups.filter(g => {
        const gn = g.name.toLowerCase()
        if (terms.has(gn)) return true
        return gn.split(/\s+/).some(w => terms.has(w))
      }).map(g => g.id)
    )
  }, [foreignCurrencies, banks, groups])

  const scrollYRef = useRef(0)

  const [modalOpen,    setModalOpen]    = useState(false)
  const [editRecord,   setEditRecord]   = useState<Category | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Category | null>(null)
  const [hideTarget,   setHideTarget]   = useState<Category | null>(null)
  const [showHiddenLocal, setShowHiddenLocal] = useState(false)
  const [showHiddenFx,    setShowHiddenFx]    = useState(false)
  const [checkingDeps, setCheckingDeps] = useState(false)
  const catState = useDataViewState({ storageKey: 'cat', defaultSortKey: 'name', defaultSortDir: 'asc' })

  // Group inline editing
  const [editGroupId,   setEditGroupId]   = useState<string | null>(null)
  const [editGroupName, setEditGroupName] = useState('')
  const [savingGroup,   setSavingGroup]   = useState(false)

  const pendingScrollRef = useRef<number | null>(null)

  // The scrollable container is <main id="main-content"> (overflow-y-auto in Layout.tsx),
  // not window. Capture/restore scrollTop on that element, not window.scrollY.
  // Restoration is deferred until loading=false: when refetch fires, loading=true replaces
  // the table with a skeleton (shorter content), the browser clamps main.scrollTop to 0,
  // and any restore attempt while the skeleton is visible is a no-op.
  const getScroller = () => document.getElementById('main-content')

  useEffect(() => {
    if (modalOpen || loading || pendingScrollRef.current === null) return
    const y = pendingScrollRef.current
    pendingScrollRef.current = null
    requestAnimationFrame(() => { getScroller()?.scrollTo(0, y) })
  }, [modalOpen, loading])

  const handleModalClose = () => {
    pendingScrollRef.current = scrollYRef.current
    setModalOpen(false)
  }

  const openAdd  = () => { scrollYRef.current = getScroller()?.scrollTop ?? 0; setEditRecord(null); setModalOpen(true) }
  const openEdit = (c: Category) => { scrollYRef.current = getScroller()?.scrollTop ?? 0; setEditRecord(c); setModalOpen(true) }

  const handleDeleteClick = async (cat: Category) => {
    setCheckingDeps(true)
    const hasData = await categoryHasLinkedData(cat)
    setCheckingDeps(false)
    if (hasData) {
      setHideTarget(cat)
    } else {
      setDeleteTarget(cat)
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    try {
      // Clean up auto-created outflow types before removing the category
      await handleCategoryDeleteCleanup(deleteTarget.id)
      await deleteCategory(deleteTarget.id)
      toast.success(`"${deleteTarget.name}" deleted.`)
      refetch()
    } catch (err) {
      toast.error(friendlyError(err, 'delete the category'))
    } finally {
      setDeleteTarget(null)
    }
  }

  const handleToggleHide = async (cat: Category, hide: boolean) => {
    try {
      await updateCategory({ id: cat.id, name: cat.name, is_hidden: hide })
      toast.success(hide ? `"${cat.name}" hidden.` : `"${cat.name}" restored.`)
      refetch()
    } catch (err) {
      toast.error(friendlyError(err, 'update the category'))
    } finally {
      setHideTarget(null)
    }
  }

  const handleDeleteGroup = async (g: CategoryGroup) => {
    try {
      await deleteGroup(g.id)
      toast.success(`Group "${g.name}" deleted.`)
      refetchGroups()
      refetch()
    } catch (err) {
      toast.error(friendlyError(err, 'delete the group'))
    }
  }

  const handleRenameGroup = async (g: CategoryGroup) => {
    const name = editGroupName.trim()
    if (!name || name === g.name) { setEditGroupId(null); return }
    setSavingGroup(true)
    try {
      await updateGroup({ id: g.id, name })
      toast.success(`Group renamed to "${name}".`)
      refetchGroups()
    } catch (err) {
      toast.error(friendlyError(err, 'rename the group'))
    } finally {
      setSavingGroup(false)
      setEditGroupId(null)
    }
  }

  const q = catState.search.trim().toLowerCase()
  const searchCol = catState.searchCol
  const showHidden = activeTab === 'fx' ? showHiddenFx : showHiddenLocal
  const visible  = categories.filter(c => {
    if (!showHidden && c.is_hidden) return false
    // Tab filter: FX tab shows categories in FX groups; Local tab shows the rest
    const isFxCat = c.group_id !== null && fxGroupIds.has(c.group_id)
    if (activeTab === 'fx'    && !isFxCat) return false
    if (activeTab === 'local' &&  isFxCat) return false
    if (!q) return true
    const groupName = groups.find(g => g.id === c.group_id)?.name ?? ''
    if (searchCol === 'name')  return c.name.toLowerCase().includes(q)
    if (searchCol === 'group') return groupName.toLowerCase().includes(q)
    return c.name.toLowerCase().includes(q) || groupName.toLowerCase().includes(q)
  })
  const hiddenCt = categories.filter(c => c.is_hidden && (
    activeTab === 'fx'
      ? (c.group_id !== null && fxGroupIds.has(c.group_id))
      : (c.group_id === null || !fxGroupIds.has(c.group_id))
  )).length

  const visibleSorted = useMemo(() => {
    const adv = catState.advancedSort
    if (adv.length > 0) return multiSortRows(visible, (c, k) => k === 'name' ? c.name : c.name, adv, CAT_SORT_FIELDS)
    return sortRows(visible, (c, k) => k === 'name' ? c.name : c.name, catState.sortKey, catState.sortDir, CAT_SORT_FIELDS)
  }, [visible, catState.sortKey, catState.sortDir, catState.advancedSort])

  const catPage = visibleSorted.slice(catState.page * catState.pageSize, (catState.page + 1) * catState.pageSize)

  const CAT_CSV_HEADERS = ['Name', 'Group', 'Description']
  const catCsvRow = (c: Category) => [c.name, groups.find(g => g.id === c.group_id)?.name ?? '', c.description ?? '']
  const CAT_CSV_FILE = `categories-${new Date().toISOString().slice(0, 10)}.csv`
  const handleExportView = () => exportCSV(CAT_CSV_FILE, CAT_CSV_HEADERS, catPage.map(catCsvRow))
  const handleExportAll  = () => exportCSV(CAT_CSV_FILE, CAT_CSV_HEADERS, visibleSorted.map(catCsvRow))

  // Bucket categories by group
  const groupMap = new Map<string | null, Category[]>()
  for (const cat of catPage) {
    const key = cat.group_id ?? null
    if (!groupMap.has(key)) groupMap.set(key, [])
    groupMap.get(key)!.push(cat)
  }

  const ungrouped = groupMap.get(null) ?? []
  const grouped   = groups.filter(g => groupMap.has(g.id))

  return (
    <div className="space-y-5">

      {/* Header */}
      <div data-tour="page-header" className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Categories</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {activeTab === 'fx' ? 'Foreign-currency categories and their opening balances' : 'Manage income and allocation categories'}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Local / FX tab switcher */}
          <div className="flex rounded-lg border border-gray-200 overflow-hidden text-sm">
            <button
              onClick={() => setActiveTab('local')}
              className={`flex items-center gap-1.5 px-3 py-1.5 transition-colors ${
                activeTab === 'local' ? 'bg-primary text-white' : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              <Layers className="w-3.5 h-3.5" /> Local
            </button>
            <button
              onClick={() => setActiveTab('fx')}
              className={`flex items-center gap-1.5 px-3 py-1.5 border-l border-gray-200 transition-colors ${
                activeTab === 'fx' ? 'bg-primary text-white' : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              <Globe className="w-3.5 h-3.5" /> FX
            </button>
          </div>
          <HelpButton tourId="categoriesTour" size="sm" />
          <ExportDropdown onExportView={handleExportView} onExportAll={handleExportAll} disabled={visibleSorted.length === 0} />
          {hiddenCt > 0 && (
            <button onClick={() => activeTab === 'fx' ? setShowHiddenFx(v => !v) : setShowHiddenLocal(v => !v)}
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-gray-500 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">
              {showHidden ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              {showHidden ? 'Hide hidden' : `Show hidden (${hiddenCt})`}
            </button>
          )}
          <button data-tour="add-button" onClick={openAdd}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary-light transition-colors">
            <Plus className="w-4 h-4" />
            Add Category
          </button>
        </div>
      </div>

      <div data-tour="data-controls">
      <DataControlsBar
        columns={CAT_COLUMNS}
        sortKey={catState.sortKey}
        sortDir={catState.sortDir}
        onSort={catState.setSort}
        defaultSortKey="name"
        defaultSortDir="asc"
        view={catState.view}
        onViewChange={catState.setView}
        search={catState.search}
        onSearchChange={catState.setSearch}
        searchPlaceholder="Search by category or group name…"
        searchCol={catState.searchCol}
        onSearchColChange={catState.setSearchCol}
        advancedSort={catState.advancedSort}
        onAdvancedSort={catState.setAdvancedSort}
        pageSize={catState.pageSize}
        onPageSizeChange={catState.setPageSize}
      />
      </div>

      {(error || groupsError) && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <div className="space-y-1">
            {error && <p>{error}</p>}
            {groupsError && <p>Groups: {groupsError} — run the migration SQL to create the category_groups table.</p>}
          </div>
        </div>
      )}

      {loading && (
        <div className="space-y-2">
          {[1, 2, 3, 4].map(i => <div key={i} className="h-14 rounded-xl bg-gray-100 animate-pulse" />)}
        </div>
      )}

      {!loading && !error && visible.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 gap-4 text-center">
          <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center">
            <Layers className="w-8 h-8 text-primary" />
          </div>
          <div>
            <p className="font-semibold text-gray-800">No categories yet</p>
            <p className="text-sm text-gray-500 mt-1">Create your first category to use in allocation configurations.</p>
          </div>
          <button onClick={openAdd}
            className="flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary-light transition-colors">
            <Plus className="w-4 h-4" />Add Category
          </button>
        </div>
      )}

      {/* Category cards */}
      {!loading && visible.length > 0 && catState.view === 'cards' && (
        <div data-tour="categories-list" className="space-y-3">
          {visibleSorted.map(cat => {
            const group = groups.find(g => g.id === cat.group_id)
            const displayBalances = allOpeningBalances.filter(b => b.category_id === cat.id)
            return (
              <div key={cat.id} className={`rounded-xl border overflow-hidden shadow-sm bg-white border-gray-200 ${cat.is_hidden ? 'opacity-50' : ''}`}>
                {/* Card header */}
                <div className="px-4 pt-3.5 pb-3">
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <p className="text-sm font-semibold text-gray-800 leading-snug">
                      {cat.name}
                      {cat.is_hidden && <span className="ml-2 text-[10px] text-amber-500 font-semibold uppercase">hidden</span>}
                    </p>
                    {displayBalances.length > 0 && (
                      <div className="flex flex-col items-end gap-0.5 shrink-0">
                        {displayBalances.map(b => (
                          <span key={b.budget_portion} className="text-[10px] text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">{b.budget_portion}</span>
                        ))}
                      </div>
                    )}
                  </div>
                  {group && <p className="text-[11px] font-semibold text-gray-400">{group.name}</p>}
                  {cat.description && <p className="text-xs text-gray-500 mt-1.5 break-words">{cat.description}</p>}
                </div>
                {/* Footer: opening balances + actions */}
                <div className="grid grid-cols-2 border-t border-gray-100 bg-gray-50/40 px-4 py-3">
                  <div className="min-w-0">
                    {displayBalances.length > 0 ? (
                      <div className="space-y-0.5">
                        <p className="text-[10px] uppercase tracking-wide font-semibold mb-0.5 text-gray-400">Bal. B/F</p>
                        {displayBalances.map(b => (
                          <p key={b.budget_portion} className="text-sm font-mono font-bold tabular-nums text-gray-700">
                            {cat.currency
                              ? formatCurrency(b.amount, cat.currency)
                              : `${baseCurrencySymbol}${b.amount.toLocaleString(formatLocale, { minimumFractionDigits: 2 })}`}
                          </p>
                        ))}
                      </div>
                    ) : (
                      <p className="text-[10px] uppercase tracking-wide font-semibold text-gray-300">No balance</p>
                    )}
                  </div>
                  <div className="border-l border-gray-200/80 pl-4 min-w-0 flex items-center justify-end gap-0.5">
                    <button onClick={() => openEdit(cat)} className="touch-target p-1.5 rounded text-gray-400 hover:text-primary hover:bg-primary/10 transition-colors" title="Edit">
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => handleDeleteClick(cat)} className="touch-target p-1.5 rounded text-gray-400 hover:text-danger hover:bg-red-50 transition-colors" title="Delete">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => handleToggleHide(cat, !cat.is_hidden)} className="touch-target p-1.5 rounded text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors" title={cat.is_hidden ? 'Show' : 'Hide'}>
                      {cat.is_hidden ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Category table — grouped */}
      {!loading && visible.length > 0 && catState.view === 'table' && (
        <div data-tour="categories-list" className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-xs text-gray-500 uppercase">
                <th className="px-5 py-3 text-left font-medium">Name</th>
                <th className="px-5 py-3 text-left font-medium hidden sm:table-cell">Description</th>
                <th className="px-5 py-3 text-left font-medium hidden md:table-cell">Portion</th>
                <th className="px-5 py-3 text-right font-medium hidden sm:table-cell">Bal. B/F</th>
                <th className="px-5 py-3 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {/* Grouped categories */}
              {grouped.map(g => (
                <Fragment key={g.id}>
                  <tr className="bg-gray-50">
                    <td colSpan={5} className="px-5 py-2">
                      <div className="flex items-center justify-between gap-2">
                        {editGroupId === g.id ? (
                          <form
                            className="flex items-center gap-2 flex-1"
                            onSubmit={e => { e.preventDefault(); handleRenameGroup(g) }}
                          >
                            <input
                              autoFocus
                              type="text"
                              value={editGroupName}
                              onChange={e => setEditGroupName(e.target.value)}
                              className="flex-1 text-xs px-2 py-0.5 border border-primary/40 rounded outline-none focus:ring-2 focus:ring-primary/30 bg-white font-semibold"
                            />
                            <button type="submit" disabled={savingGroup || !editGroupName.trim()}
                              className="touch-target p-1 rounded text-primary hover:bg-primary/10 transition-colors disabled:opacity-40" title="Save">
                              <Check className="w-3.5 h-3.5" />
                            </button>
                            <button type="button" onClick={() => setEditGroupId(null)}
                              className="touch-target p-1 rounded text-gray-400 hover:text-gray-600 transition-colors" title="Cancel">
                              <X className="w-3 h-3" />
                            </button>
                          </form>
                        ) : (
                          <>
                            <span className="text-xs font-semibold text-gray-500">{g.name}</span>
                            <div className="flex items-center gap-0.5">
                              <button
                                onClick={() => { setEditGroupId(g.id); setEditGroupName(g.name) }}
                                className="touch-target p-1 rounded text-gray-300 hover:text-primary hover:bg-primary/10 transition-colors" title="Rename group">
                                <Pencil className="w-3 h-3" />
                              </button>
                              <button onClick={() => handleDeleteGroup(g)}
                                className="touch-target p-1 rounded text-gray-300 hover:text-danger hover:bg-red-50 transition-colors" title="Remove group">
                                <X className="w-3 h-3" />
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                  {(groupMap.get(g.id) ?? []).map(cat => <CategoryRow key={cat.id} cat={cat} openingBalances={allOpeningBalances} onEdit={openEdit} onDelete={handleDeleteClick} onToggleHide={handleToggleHide} checking={checkingDeps} />)}
                </Fragment>
              ))}
              {/* Ungrouped categories */}
              {ungrouped.length > 0 && grouped.length > 0 && (
                <tr className="bg-gray-50">
                  <td colSpan={5} className="px-5 py-2">
                    <span className="text-xs font-semibold text-gray-500">Ungrouped</span>
                  </td>
                </tr>
              )}
              {ungrouped.map(cat => <CategoryRow key={cat.id} cat={cat} openingBalances={allOpeningBalances} onEdit={openEdit} onDelete={handleDeleteClick} onToggleHide={handleToggleHide} checking={checkingDeps} />)}
            </tbody>
          </table>
        </div>
      )}

      {/* Modals */}
      <CategoryModal
        open={modalOpen}
        onClose={handleModalClose}
        onSuccess={() => { refetch(); refetchBalances() }}
        editRecord={editRecord}
        groups={activeTab === 'fx'
          ? groups.filter(g => fxGroupIds.has(g.id))
          : groups.filter(g => !fxGroupIds.has(g.id))
        }
        onGroupCreated={refetchGroups}
        fxGroupIds={fxGroupIds}
        foreignCurrencies={foreignCurrencies}
        mode={activeTab}
      />

      <PaginationBar
        page={catState.page}
        pageSize={catState.pageSize}
        total={visibleSorted.length}
        onPageChange={catState.setPage}
        variant="full"
      />

      <DeleteDialog
        open={!!deleteTarget}
        label={deleteTarget?.name ?? 'this category'}
        onConfirm={handleDelete}
        onClose={() => setDeleteTarget(null)}
      />

      {/* Hide dialog — shown when category has linked data */}
      {!!hideTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-6 space-y-4">
            <h2 className="font-semibold text-gray-900">Cannot Delete</h2>
            <p className="text-sm text-gray-600">
              <strong>"{hideTarget.name}"</strong> has linked transactions or a non-zero starting balance.
              It cannot be deleted but can be hidden from views.
            </p>
            <div className="flex justify-end gap-3">
              <button onClick={() => setHideTarget(null)}
                className="px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50">
                Cancel
              </button>
              <button onClick={() => handleToggleHide(hideTarget, true)}
                className="px-4 py-2 text-sm text-white bg-amber-500 rounded-lg hover:bg-amber-600">
                Hide Category
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Category row ───────────────────────────────────────────────────────────────

function CategoryRow({ cat, openingBalances, onEdit, onDelete, onToggleHide, checking }: {
  cat:             Category
  openingBalances: CategoryOpeningBalance[]
  onEdit:          (c: Category) => void
  onDelete:        (c: Category) => void
  onToggleHide:    (c: Category, hide: boolean) => void
  checking:        boolean
}) {
  const { baseCurrencySymbol, formatLocale } = useOrgCurrency()
  const { tooltip, setTooltip } = useDescriptionExpand()

  const displayBalances = openingBalances.filter(b => b.category_id === cat.id)

  return (
    <tr className={`hover:bg-gray-50 transition-colors ${cat.is_hidden ? 'opacity-50' : ''}`}>
      <td className="px-5 py-3 font-medium text-gray-800">
        {cat.name}
        {cat.is_hidden && <span className="ml-2 text-[10px] text-amber-500 font-semibold uppercase">hidden</span>}
      </td>
      <td className="px-5 py-3 text-gray-500 hidden sm:table-cell max-w-[200px]">
        <DescriptionCell id={cat.id} text={cat.description} tooltip={tooltip} setTooltip={setTooltip} />
        <DescriptionTooltip tooltip={tooltip} />
      </td>
      <td className="px-5 py-3 hidden md:table-cell">
        {displayBalances.length > 0
          ? <div className="flex flex-col gap-0.5">
              {displayBalances.map(b => (
                <span key={b.budget_portion} className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full w-fit">{b.budget_portion}</span>
              ))}
            </div>
          : <span className="text-gray-300">—</span>}
      </td>
      <td className="px-5 py-3 text-right hidden sm:table-cell font-mono text-sm text-gray-700">
        {displayBalances.length > 0
          ? <div className="flex flex-col gap-0.5 items-end">
              {displayBalances.map(b => (
                <span key={b.budget_portion}>
                  {cat.currency
                    ? formatCurrency(b.amount, cat.currency)
                    : `${baseCurrencySymbol}${b.amount.toLocaleString(formatLocale, { minimumFractionDigits: 2 })}`}
                </span>
              ))}
            </div>
          : <span className="text-gray-300">—</span>}
      </td>
      <td className="px-5 py-3">
        <div className="flex items-center justify-end gap-1">
          {cat.is_hidden ? (
            <button onClick={() => onToggleHide(cat, false)}
              className="touch-target p-1.5 rounded-lg text-amber-400 hover:text-amber-600 hover:bg-amber-50 transition-colors" title="Restore">
              <Eye className="w-4 h-4" />
            </button>
          ) : (
            <button onClick={() => onEdit(cat)}
              className="touch-target p-1.5 rounded-lg text-gray-400 hover:text-primary hover:bg-primary/10 transition-colors" title="Edit">
              <Pencil className="w-4 h-4" />
            </button>
          )}
          <button onClick={() => onDelete(cat)} disabled={checking}
            className="touch-target p-1.5 rounded-lg text-gray-400 hover:text-danger hover:bg-red-50 transition-colors disabled:opacity-40" title="Delete">
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </td>
    </tr>
  )
}
