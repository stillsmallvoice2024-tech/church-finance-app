import { useState, useEffect, useMemo } from 'react'
import { Navigate } from 'react-router-dom'
import { CalendarDays, CheckCircle2, Pencil, Trash2, Landmark, AlertCircle, Plus, Layers, Lock, LockOpen, FileEdit, Copy, ShieldAlert, ChevronDown, Search, X, Globe } from 'lucide-react'
import { usePageTitle } from '../hooks/usePageTitle'
import { useRole } from '../hooks/useRole'
import { useAccountingYearStore } from '../store/accountingYearStore'
import { useBanks, type DbBank } from '../hooks/useBanks'
import { AddBankModal } from '../components/modals/AddBankModal'
import { DeleteDialog }  from '../components/ui/DeleteDialog'
import { useDeleteBank } from '../hooks/useMutations'
import { useToastStore } from '../store/toastStore'
import { useAllocationStore, type AllocationConfig } from '../store/allocationStore'
import { AllocationConfigModal } from '../components/modals/AllocationConfigModal'
import { CreateSpecialConfigModal } from '../components/modals/CreateSpecialConfigModal'
import { useSpecialConfigGroups, type SpecialConfigGroupWithVersions } from '../hooks/useSpecialConfigGroups'
import { ResetDataModal }           from '../components/modals/ResetDataModal'
import { AddIncomeTypeModal }        from '../components/modals/AddIncomeTypeModal'
import { useIncomeTypes, deleteIncomeType, type IncomeType } from '../hooks/useIncomeTypes'
import { AddOutflowTypeModal }       from '../components/modals/AddOutflowTypeModal'
import { useOutflowTypes, useCategoryOutflowTypeMaps, deleteOutflowType, type OutflowType } from '../hooks/useOutflowTypes'
import { AddDepartmentModal }        from '../components/modals/AddDepartmentModal'
import { useDepartments, deleteDepartment, type Department } from '../hooks/useDepartments'
import { useCategories } from '../hooks/useCategories'
import { useCurrencies, useAddCurrency, useDeleteCurrency } from '../hooks/useCurrencies'
import {
  useLockAllocationConfig,
  useUnlockAllocationConfig,
  useDeleteAllocationConfig,
} from '../hooks/useMutations'
import { Modal } from '../components/ui/Modal'
import { formatDate } from '../utils/formatters'
import { supabase } from '../lib/supabase'
import { useOrgCurrency } from '../hooks/useOrgCurrency'
import { useOrgStore } from '../store/orgStore'
import { COMMON_TIMEZONES, getOrgTimezone } from '../utils/timezones'

const TABS = ['General', 'Banks', 'Allocation', 'Special Configs', 'Income Types', 'Outflow Types', 'Departments', 'Currencies'] as const
type Tab = typeof TABS[number]

// ── Compact shared search + sort bar for Setup tabs ──────────────────────────────

interface SortOpt { value: string; label: string }

function SetupSearchSort({
  search, onSearch, sort, onSort, sortOptions, placeholder = 'Search…',
}: {
  search: string; onSearch: (s: string) => void
  sort: string;   onSort:   (v: string) => void
  sortOptions: SortOpt[]; placeholder?: string
}) {
  return (
    <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
      <div className="relative flex-1">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
        <input
          type="text"
          value={search}
          onChange={e => onSearch(e.target.value)}
          placeholder={placeholder}
          className="w-full pl-8 pr-7 py-1.5 text-sm border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-white"
        />
        {search && (
          <button
            type="button"
            onClick={() => onSearch('')}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            aria-label="Clear search"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
      <select
        value={sort}
        onChange={e => onSort(e.target.value)}
        className="py-1.5 pl-2.5 pr-6 text-sm border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-white text-gray-700 sm:w-auto"
        aria-label="Sort order"
      >
        {sortOptions.map(o => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  )
}

function applySetupSort<T>(data: T[], sort: string): T[] {
  const sep = sort.lastIndexOf('|')
  const key = sort.slice(0, sep)
  const dir = sort.slice(sep + 1)
  return [...data].sort((a, b) => {
    const av = String((a as Record<string, unknown>)[key] ?? '')
    const bv = String((b as Record<string, unknown>)[key] ?? '')
    const cmp = av.localeCompare(bv)
    return dir === 'asc' ? cmp : -cmp
  })
}

const BANK_SORT_OPTS: SortOpt[] = [
  { value: 'name|asc',        label: 'Name A→Z' },
  { value: 'name|desc',       label: 'Name Z→A' },
  { value: 'created_at|desc', label: 'Newest' },
  { value: 'created_at|asc',  label: 'Oldest' },
]

const ALLOC_SORT_OPTS: SortOpt[] = [
  { value: 'name|asc',        label: 'Name A→Z' },
  { value: 'name|desc',       label: 'Name Z→A' },
  { value: 'start_date|desc', label: 'Effective date newest' },
  { value: 'start_date|asc',  label: 'Effective date oldest' },
  { value: 'created_at|desc', label: 'Created newest' },
  { value: 'created_at|asc',  label: 'Created oldest' },
]

const SPECIAL_SORT_OPTS: SortOpt[] = [
  { value: 'name|asc',        label: 'Name A→Z' },
  { value: 'name|desc',       label: 'Name Z→A' },
  { value: 'created_at|desc', label: 'Newest' },
  { value: 'created_at|asc',  label: 'Oldest' },
]

const TYPE_SORT_OPTS: SortOpt[] = [
  { value: 'name|asc',        label: 'Name A→Z' },
  { value: 'name|desc',       label: 'Name Z→A' },
  { value: 'created_at|desc', label: 'Newest' },
  { value: 'created_at|asc',  label: 'Oldest' },
]

// ── General tab ──────────────────────────────────────────────────────────────────

function buildYearOptions(): number[] {
  const current = new Date().getFullYear()
  const years: number[] = []
  for (let y = current - 2; y <= current + 2; y++) years.push(y)
  return years
}

const YEAR_OPTIONS = buildYearOptions()

function GeneralTab() {
  const { year, setYear } = useAccountingYearStore()
  const [saved, setSaved] = useState(false)
  const [pending, setPending] = useState(year)

  const orgId          = useOrgStore(s => s.orgId)
  const storedTimezone = useOrgStore(s => s.timezone)
  const setTimezone    = useOrgStore(s => s.setTimezone)
  const { baseCurrencyCode } = useOrgCurrency()

  const effectiveTz    = getOrgTimezone(storedTimezone, baseCurrencyCode)
  const [pendingTz, setPendingTz] = useState(effectiveTz)
  const [tzSaved,   setTzSaved]   = useState(false)
  const [tzSaving,  setTzSaving]  = useState(false)
  const [tzError,   setTzError]   = useState<string | null>(null)

  // Keep pendingTz in sync if the store changes (e.g. org switch)
  useEffect(() => {
    setPendingTz(getOrgTimezone(storedTimezone, baseCurrencyCode))
  }, [storedTimezone, baseCurrencyCode])

  const handleSave = () => {
    setYear(pending)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const handleSaveTz = async () => {
    if (!orgId) return
    setTzSaving(true)
    setTzError(null)
    const { error } = await supabase
      .from('organizations')
      .update({ timezone: pendingTz })
      .eq('id', orgId)
    setTzSaving(false)
    if (error) {
      setTzError(error.message)
    } else {
      setTimezone(pendingTz)
      setTzSaved(true)
      setTimeout(() => setTzSaved(false), 2000)
    }
  }

  return (
    <div className="max-w-lg space-y-6">
      <div className="bg-white border border-gray-200 rounded-xl p-6 space-y-4">
        <div className="flex items-center gap-2 text-gray-800">
          <CalendarDays className="w-5 h-5 text-primary" />
          <h2 className="text-base font-semibold">Accounting Year</h2>
        </div>
        <p className="text-sm text-gray-500">
          Select the financial year you are currently working in. All transaction views and reports will reflect this period.
        </p>

        <div className="flex flex-wrap gap-2 pt-1">
          {YEAR_OPTIONS.map(y => (
            <button
              key={y}
              onClick={() => setPending(y)}
              className={`px-5 py-2 rounded-lg text-sm font-semibold border transition-colors ${
                pending === y
                  ? 'bg-primary text-white border-primary'
                  : 'bg-white text-gray-700 border-gray-300 hover:border-primary hover:text-primary'
              }`}
            >
              {y}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-3 pt-2">
          <button
            onClick={handleSave}
            disabled={pending === year}
            className="px-5 py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary-light disabled:opacity-50 transition-colors"
          >
            Save
          </button>
          {saved && (
            <span className="flex items-center gap-1.5 text-sm text-success font-medium">
              <CheckCircle2 className="w-4 h-4" /> Saved
            </span>
          )}
          {pending !== year && !saved && (
            <span className="text-xs text-gray-400">Unsaved change</span>
          )}
        </div>
      </div>

      {/* ── Timezone ─────────────────────────────────────────────────────────── */}
      <div className="bg-white border border-gray-200 rounded-xl p-6 space-y-4">
        <div className="flex items-center gap-2 text-gray-800">
          <Globe className="w-5 h-5 text-primary" />
          <h2 className="text-base font-semibold">Organisation Timezone</h2>
        </div>
        <p className="text-sm text-gray-500">
          Controls how timestamps (e.g. last reconciliation check) are displayed throughout the app.
          Defaults to the timezone of your organisation's base currency.
        </p>

        <div className="pt-1">
          <select
            value={pendingTz}
            onChange={e => setPendingTz(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
          >
            {COMMON_TIMEZONES.map(tz => (
              <option key={tz.value} value={tz.value}>
                {tz.label} (UTC{tz.offset})
              </option>
            ))}
          </select>
        </div>

        {tzError && (
          <p className="text-xs text-danger">{tzError}</p>
        )}

        <div className="flex items-center gap-3 pt-1">
          <button
            onClick={handleSaveTz}
            disabled={pendingTz === effectiveTz || tzSaving}
            className="px-5 py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary-light disabled:opacity-50 transition-colors"
          >
            {tzSaving ? 'Saving…' : 'Save'}
          </button>
          {tzSaved && (
            <span className="flex items-center gap-1.5 text-sm text-success font-medium">
              <CheckCircle2 className="w-4 h-4" /> Saved
            </span>
          )}
          {pendingTz !== effectiveTz && !tzSaved && !tzSaving && (
            <span className="text-xs text-gray-400">Unsaved change</span>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Banks tab ────────────────────────────────────────────────────────────────────

function BanksTab({ onAdd, onEdit, onDelete }: {
  onAdd:    () => void
  onEdit:   (bank: DbBank) => void
  onDelete: (bank: DbBank) => void
}) {
  const { banks, loading, error } = useBanks()
  const [search, setSearch] = useState('')
  const [sort,   setSort]   = useState('name|asc')

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    const filtered = q
      ? banks.filter(b => [b.name, b.account_number ?? '', b.account_type ?? ''].some(v => v.toLowerCase().includes(q)))
      : banks
    return applySetupSort(filtered, sort)
  }, [banks, search, sort])

  if (loading) {
    return (
      <div className="max-w-2xl space-y-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-12 bg-gray-100 rounded-lg animate-pulse" />
        ))}
      </div>
    )
  }

  if (error) {
    return (
      <div className="max-w-2xl flex items-start gap-3 rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
        <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
        {error}
      </div>
    )
  }

  return (
    <div className="max-w-2xl space-y-3">
      <div className="flex justify-end">
      </div>

      {/* Add form */}
      <form onSubmit={handleAdd} className="border border-gray-200 rounded-xl p-4 space-y-3 bg-gray-50">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Add Currency</p>
        {(formErr || addError) && (
          <p className="text-xs text-red-600">{formErr ?? addError}</p>
        )}
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-600">Code *</label>
            <input value={code} onChange={e => setCode(e.target.value.toUpperCase())} maxLength={6}
              placeholder="e.g. CHF" className={`${iCls} uppercase`} />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-600">Symbol *</label>
            <input value={symbol} onChange={e => setSymbol(e.target.value)} maxLength={6}
              placeholder="e.g. Fr." className={iCls} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-600">Name *</label>
            <input value={name} onChange={e => setName(e.target.value)}
              placeholder="e.g. Swiss Franc" className={iCls} />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-600">Flag emoji</label>
            <input value={flag} onChange={e => setFlag(e.target.value)} maxLength={4}
              placeholder="e.g. 🇨🇭" className={iCls} />
          </div>
        </div>
        <div className="flex justify-end">
          <button type="submit" disabled={adding}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary-light disabled:opacity-60">
            {adding ? <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <Plus className="w-4 h-4" />}
            {adding ? 'Adding…' : 'Add Currency'}
          </button>
        </div>
      </form>

      {/* Currency list */}
      {loading ? (
        <div className="space-y-2">
          {[1,2,3].map(i => <div key={i} className="h-12 bg-gray-100 rounded-xl animate-pulse" />)}
        </div>
      ) : (
        <div className="border border-gray-200 rounded-xl overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500">Code</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500">Name</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500">Symbol</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500">Flag</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {currencies.map(c => (
                <tr key={c.code} className="hover:bg-gray-50">
                  <td className="px-4 py-2.5 font-mono font-semibold text-gray-800">{c.code}</td>
                  <td className="px-4 py-2.5 text-gray-700">{c.name}</td>
                  <td className="px-4 py-2.5 font-mono text-gray-600">{c.symbol}</td>
                  <td className="px-4 py-2.5 text-lg">{c.flag ?? '—'}</td>
                  <td className="px-4 py-2.5 text-right">
                    <button
                      onClick={() => handleDelete(c.code)}
                      className="p-1.5 rounded hover:bg-red-50 text-gray-300 hover:text-danger transition-colors"
                      title={`Remove ${c.code}`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────────────

export default function SetupPage() {
  const { canWrite } = useRole()
  const [activeTab,      setActiveTab]      = useState<Tab>('General')
  const [bankModalOpen,  setBankModalOpen]  = useState(false)
  const [editBankRecord, setEditBankRecord] = useState<DbBank | null>(null)
  const [bankRefetch,    setBankRefetch]    = useState(0)
  const [deleteBankRecord, setDeleteBankRecord] = useState<DbBank | null>(null)
  const [allocModalOpen,  setAllocModalOpen]  = useState(false)
  const [editAllocRecord, setEditAllocRecord] = useState<AllocationConfig | null>(null)
  const [lockTarget,        setLockTarget]        = useState<AllocationConfig | null>(null)
  const [editLockedTarget,  setEditLockedTarget]  = useState<AllocationConfig | null>(null)
  const [deleteAllocTarget, setDeleteAllocTarget] = useState<AllocationConfig | null>(null)
  const [specialModalOpen,      setSpecialModalOpen]      = useState(false)
  const [specialModalMode,      setSpecialModalMode]      = useState<'new_group' | 'new_version'>('new_group')
  const [selectedSpecialGroup,  setSelectedSpecialGroup]  = useState<SpecialConfigGroupWithVersions | null>(null)
  const [copyFromVersion,       setCopyFromVersion]       = useState<AllocationConfig | null>(null)
  const [specialRefetch,        setSpecialRefetch]        = useState(0)
  const [resetModalOpen,       setResetModalOpen]       = useState(false)
  const [incomeTypeModalOpen,    setIncomeTypeModalOpen]    = useState(false)
  const [editIncomeType,         setEditIncomeType]         = useState<IncomeType | null>(null)
  const [deleteIncomeTypeTarget, setDeleteIncomeTypeTarget] = useState<IncomeType | null>(null)
  const [incomeTypeRefetch,      setIncomeTypeRefetch]      = useState(0)
  const [outflowTypeModalOpen,   setOutflowTypeModalOpen]   = useState(false)
  const [editOutflowType,        setEditOutflowType]        = useState<OutflowType | null>(null)
  const [deleteOutflowTypeTarget, setDeleteOutflowTypeTarget] = useState<OutflowType | null>(null)
  const [outflowTypeRefetch,     setOutflowTypeRefetch]     = useState(0)
  const [departmentModalOpen,    setDepartmentModalOpen]    = useState(false)
  const [editDepartment,         setEditDepartment]         = useState<Department | null>(null)
  const [deleteDepartmentTarget, setDeleteDepartmentTarget] = useState<Department | null>(null)
  const [departmentRefetch,      setDepartmentRefetch]      = useState(0)
  const { configs, reload: reloadAllocs } = useAllocationStore()

  const { push: toast } = useToastStore()
  const { mutate: deleteBank, loading: deletingBank } = useDeleteBank()
  const { mutate: lockConfig,   loading: locking   } = useLockAllocationConfig()
  const { mutate: unlockConfig, loading: unlocking } = useUnlockAllocationConfig()
  const { mutate: deleteAllocConfig               } = useDeleteAllocationConfig()

  usePageTitle('Setup')

  // Defense-in-depth: route guard in App.tsx is primary, this is a fallback
  if (!canWrite()) return <Navigate to="/" replace />

  const handleNewAlloc    = () => { setEditAllocRecord(null); setAllocModalOpen(true) }
  const handleEditAlloc   = (c: AllocationConfig) => { setEditAllocRecord(c); setAllocModalOpen(true) }
  const handleAllocSuccess = () => { reloadAllocs() }

  const handleLock        = (c: AllocationConfig) => setLockTarget(c)
  const handleEditLocked  = (c: AllocationConfig) => setEditLockedTarget(c)
  const handleDeleteAlloc = (c: AllocationConfig) => setDeleteAllocTarget(c)

  const confirmDeleteAlloc = async () => {
    if (!deleteAllocTarget) return
    try {
      await deleteAllocConfig(deleteAllocTarget.id)
      toast(`"${deleteAllocTarget.name}" deleted`, 'success')
      setDeleteAllocTarget(null)
      reloadAllocs()
    } catch (e: unknown) {
      toast(e instanceof Error ? e.message : 'Delete failed', 'error')
    }
  }

  const confirmLock = async () => {
    if (!lockTarget) return
    try {
      await lockConfig(lockTarget.id)
      toast(`"${lockTarget.name}" approved and locked`, 'success')
      setLockTarget(null)
      reloadAllocs()
    } catch (e: unknown) {
      toast(e instanceof Error ? e.message : 'Lock failed', 'error')
    }
  }

  const handleUnlockAndEdit = async () => {
    if (!editLockedTarget) return
    try {
      await unlockConfig(editLockedTarget.id)
      toast(`"${editLockedTarget.name}" unlocked`, 'success')
      const target = editLockedTarget
      setEditLockedTarget(null)
      setEditAllocRecord(target)
      setAllocModalOpen(true)
      reloadAllocs()
    } catch (e: unknown) {
      toast(e instanceof Error ? e.message : 'Unlock failed', 'error')
    }
  }

  const handleCreateCopy = () => {
    if (!editLockedTarget) return
    const source = editLockedTarget
    setEditLockedTarget(null)
    setEditAllocRecord({
      ...source,
      id:         '',
      name:       `${source.name} (copy)`,
      status:     'draft',
      created_at: '',
    })
    setAllocModalOpen(true)
  }

  const handleNewGroup = () => {
    setSpecialModalMode('new_group')
    setSelectedSpecialGroup(null)
    setCopyFromVersion(null)
    setSpecialModalOpen(true)
  }

  const handleNewVersion = (group: SpecialConfigGroupWithVersions, copyFrom: AllocationConfig | null) => {
    setSpecialModalMode('new_version')
    setSelectedSpecialGroup(group)
    setCopyFromVersion(copyFrom)
    setSpecialModalOpen(true)
  }

  const handleAddBank     = () => { setEditBankRecord(null); setBankModalOpen(true) }
  const handleEditBank    = (bank: DbBank) => { setEditBankRecord(bank); setBankModalOpen(true) }
  const handleDeleteBank  = (bank: DbBank) => { setDeleteBankRecord(bank) }
  const handleBankSuccess = () => { setBankRefetch(n => n + 1) }

  const confirmDeleteBank = async () => {
    if (!deleteBankRecord) return
    try {
      await deleteBank(deleteBankRecord.id)
      toast('Bank deleted', 'success')
      setDeleteBankRecord(null)
      setBankRefetch(n => n + 1)
    } catch (e: unknown) {
      toast(e instanceof Error ? e.message : 'Delete failed', 'error')
    }
  }

  return (
    <>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Setup</h1>
          <p className="text-sm text-gray-500 mt-1">Configure your church finance settings</p>
        </div>

        {/* Tab bar */}
        <div className="border-b border-gray-200 overflow-x-auto">
          <nav className="-mb-px flex gap-6">
            {TABS.map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`pb-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                  activeTab === tab
                    ? 'border-primary text-primary'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                {tab}
              </button>
            ))}
          </nav>
        </div>

        {/* Tab content */}
        <div>
          {activeTab === 'General'        && <GeneralTab />}
          {activeTab === 'Banks'          && <BanksTab key={bankRefetch} onAdd={handleAddBank} onEdit={handleEditBank} onDelete={handleDeleteBank} />}
          {activeTab === 'Allocation'     && <AllocationTab onNew={handleNewAlloc} onEdit={handleEditAlloc} onLock={handleLock} onEditLocked={handleEditLocked} onDelete={handleDeleteAlloc} />}
          {activeTab === 'Special Configs' && (
            <SpecialConfigsTab
              key={specialRefetch}
              onNew={handleNewGroup}
              onNewVersion={handleNewVersion}
              onRefetch={() => setSpecialRefetch(n => n + 1)}
            />
          )}
          {activeTab === 'Income Types' && (
            <IncomeTypesTab
              key={incomeTypeRefetch}
              onAdd={() => { setEditIncomeType(null); setIncomeTypeModalOpen(true) }}
              onEdit={t => { setEditIncomeType(t); setIncomeTypeModalOpen(true) }}
              onDelete={t => setDeleteIncomeTypeTarget(t)}
            />
          )}
          {activeTab === 'Outflow Types' && (
            <OutflowTypesTab
              key={outflowTypeRefetch}
              onAdd={() => { setEditOutflowType(null); setOutflowTypeModalOpen(true) }}
              onEdit={t => { setEditOutflowType(t); setOutflowTypeModalOpen(true) }}
              onDelete={t => setDeleteOutflowTypeTarget(t)}
            />
          )}
          {activeTab === 'Departments' && (
            <DepartmentsTab
              key={departmentRefetch}
              onAdd={() => { setEditDepartment(null); setDepartmentModalOpen(true) }}
              onEdit={d => { setEditDepartment(d); setDepartmentModalOpen(true) }}
              onDelete={d => setDeleteDepartmentTarget(d)}
            />
          )}
          {activeTab === 'Currencies'     && <CurrenciesTab />}
        </div>


        {/* Danger Zone */}
        <div className="border border-red-200 rounded-xl p-5 space-y-3 bg-red-50/40">
          <div className="flex items-center gap-2">
            <ShieldAlert className="w-5 h-5 text-red-600 shrink-0" />
            <h2 className="text-base font-semibold text-red-700">Danger Zone</h2>
          </div>
          <p className="text-sm text-gray-600">
            Permanently delete all transaction data. All data is exported to CSV before deletion. Categories, banks, and user accounts are preserved.
          </p>
          <button
            onClick={() => setResetModalOpen(true)}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-danger rounded-lg hover:bg-red-700 transition-colors"
          >
            <Trash2 className="w-4 h-4" /> Reset All Data
          </button>
        </div>
      </div>

      <AllocationConfigModal
        open={allocModalOpen}
        onClose={() => { setAllocModalOpen(false); setEditAllocRecord(null) }}
        onSuccess={handleAllocSuccess}
        editRecord={editAllocRecord}
        existingConfigs={configs}
      />

      {/* Lock confirmation dialog */}
      <Modal
        open={!!lockTarget}
        onClose={() => setLockTarget(null)}
        title="Approve & Lock Configuration"
        size="max-w-sm"
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            Lock <span className="font-semibold">"{lockTarget?.name}"</span>? Locked configurations are read-only and cannot be edited directly.
          </p>
          <div className="flex justify-end gap-3">
            <button
              onClick={() => setLockTarget(null)}
              disabled={locking}
              className="px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={confirmLock}
              disabled={locking}
              className="flex items-center gap-2 px-4 py-2 text-sm text-white bg-green-600 rounded-lg hover:bg-green-700 disabled:opacity-60"
            >
              {locking && <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />}
              Approve & Lock
            </button>
          </div>
        </div>
      </Modal>

      {/* Edit-locked choice dialog */}
      <Modal
        open={!!editLockedTarget}
        onClose={() => setEditLockedTarget(null)}
        title="Edit Locked Configuration"
        size="max-w-sm"
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            <span className="font-semibold">"{editLockedTarget?.name}"</span> is locked. How would you like to proceed?
          </p>
          <div className="space-y-2">
            <button
              onClick={handleUnlockAndEdit}
              disabled={unlocking}
              className="w-full flex items-center gap-3 px-4 py-3 text-left border border-amber-200 rounded-lg hover:bg-amber-50 transition-colors disabled:opacity-60"
            >
              <LockOpen className="w-5 h-5 text-amber-600 shrink-0" />
              <div>
                <p className="text-sm font-medium text-gray-900">Unlock &amp; Edit</p>
                <p className="text-xs text-gray-500">Reverts status to draft so you can make changes.</p>
              </div>
              {unlocking && <span className="ml-auto w-4 h-4 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />}
            </button>
            <button
              onClick={handleCreateCopy}
              className="w-full flex items-center gap-3 px-4 py-3 text-left border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
            >
              <Copy className="w-5 h-5 text-gray-500 shrink-0" />
              <div>
                <p className="text-sm font-medium text-gray-900">Create a Copy</p>
                <p className="text-xs text-gray-500">Opens a new draft pre-filled with this config's data.</p>
              </div>
            </button>
          </div>
          <div className="flex justify-end">
            <button
              onClick={() => setEditLockedTarget(null)}
              className="px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50"
            >
              Cancel
            </button>
          </div>
        </div>
      </Modal>
      <DeleteDialog
        open={!!deleteAllocTarget}
        onClose={() => setDeleteAllocTarget(null)}
        onConfirm={confirmDeleteAlloc}
        label={deleteAllocTarget ? `"${deleteAllocTarget.name}"` : 'this configuration'}
      />

      <AddBankModal
        open={bankModalOpen}
        onClose={() => { setBankModalOpen(false); setEditBankRecord(null) }}
        onSuccess={handleBankSuccess}
        editRecord={editBankRecord}
      />
      <DeleteDialog
        open={!!deleteBankRecord}
        onClose={() => setDeleteBankRecord(null)}
        onConfirm={confirmDeleteBank}
        loading={deletingBank}
        label={deleteBankRecord ? `"${deleteBankRecord.name}"` : 'this bank'}
      />
      <CreateSpecialConfigModal
        open={specialModalOpen}
        onClose={() => { setSpecialModalOpen(false) }}
        onSaved={() => { setSpecialModalOpen(false); setSpecialRefetch(n => n + 1) }}
        mode={specialModalMode}
        group={selectedSpecialGroup}
        copyFromVersion={copyFromVersion}
      />
      <ResetDataModal
        open={resetModalOpen}
        onClose={() => setResetModalOpen(false)}
        onDone={() => toast('All data deleted successfully', 'success')}
      />
      <AddIncomeTypeModal
        open={incomeTypeModalOpen}
        onClose={() => { setIncomeTypeModalOpen(false); setEditIncomeType(null) }}
        onSaved={() => { setIncomeTypeModalOpen(false); setEditIncomeType(null); setIncomeTypeRefetch(n => n + 1) }}
        editRecord={editIncomeType}
      />
      <DeleteDialog
        open={!!deleteIncomeTypeTarget}
        onClose={() => setDeleteIncomeTypeTarget(null)}
        onConfirm={async () => {
          if (!deleteIncomeTypeTarget) return
          try {
            await deleteIncomeType(deleteIncomeTypeTarget.id)
            setDeleteIncomeTypeTarget(null)
            setIncomeTypeRefetch(n => n + 1)
            toast('Income type deleted', 'success')
          } catch (e) {
            toast(e instanceof Error ? e.message : 'Delete failed', 'error')
          }
        }}
        loading={false}
        label={deleteIncomeTypeTarget ? `"${deleteIncomeTypeTarget.name}"` : 'this income type'}
      />
      <AddOutflowTypeModal
        open={outflowTypeModalOpen}
        onClose={() => { setOutflowTypeModalOpen(false); setEditOutflowType(null) }}
        onSaved={() => { setOutflowTypeModalOpen(false); setEditOutflowType(null); setOutflowTypeRefetch(n => n + 1) }}
        editRecord={editOutflowType}
      />
      <DeleteDialog
        open={!!deleteOutflowTypeTarget}
        onClose={() => setDeleteOutflowTypeTarget(null)}
        onConfirm={async () => {
          if (!deleteOutflowTypeTarget) return
          try {
            await deleteOutflowType(deleteOutflowTypeTarget.id)
            setDeleteOutflowTypeTarget(null)
            setOutflowTypeRefetch(n => n + 1)
            toast('Outflow type deleted', 'success')
          } catch (e) {
            toast(e instanceof Error ? e.message : 'Delete failed', 'error')
          }
        }}
        loading={false}
        label={deleteOutflowTypeTarget ? `"${deleteOutflowTypeTarget.name}"` : 'this outflow type'}
      />
      <AddDepartmentModal
        open={departmentModalOpen}
        onClose={() => { setDepartmentModalOpen(false); setEditDepartment(null) }}
        onSaved={() => { setDepartmentModalOpen(false); setEditDepartment(null); setDepartmentRefetch(n => n + 1) }}
        editRecord={editDepartment}
      />
      <DeleteDialog
        open={!!deleteDepartmentTarget}
        onClose={() => setDeleteDepartmentTarget(null)}
        onConfirm={async () => {
          if (!deleteDepartmentTarget) return
          try {
            await deleteDepartment(deleteDepartmentTarget.id)
            setDeleteDepartmentTarget(null)
            setDepartmentRefetch(n => n + 1)
            toast('Department deleted', 'success')
          } catch (e) {
            toast(e instanceof Error ? e.message : 'Delete failed', 'error')
          }
        }}
        loading={false}
        label={deleteDepartmentTarget ? `"${deleteDepartmentTarget.name}"` : 'this department'}
      />
    </>
  )
}
