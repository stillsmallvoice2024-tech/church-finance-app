import { useState, useEffect, useMemo } from 'react'
import { Navigate } from 'react-router-dom'
import { CalendarDays, CheckCircle2, Pencil, Trash2, Landmark, AlertCircle, Plus, Layers, Lock, LockOpen, FileEdit, Copy, Terminal, ShieldAlert, ChevronDown, Search, X, Globe } from 'lucide-react'
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
import { generateFallbackTransactionId } from '../utils/generateTransactionId'
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
        <button
          onClick={onAdd}
          className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary-light transition-colors"
        >
          <Plus className="w-4 h-4" /> Add Bank
        </button>
      </div>

      {banks.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 py-16 text-center border border-dashed border-gray-300 rounded-xl bg-gray-50">
          <Landmark className="w-10 h-10 text-gray-300" />
          <div>
            <p className="text-sm font-medium text-gray-600">No banks configured yet</p>
            <p className="text-xs text-gray-400 mt-1">Add a bank to link it to your transactions and reports.</p>
          </div>
        </div>
      ) : (
        <>
          <SetupSearchSort search={search} onSearch={setSearch} sort={sort} onSort={setSort} sortOptions={BANK_SORT_OPTS} placeholder="Search banks…" />
          {visible.length === 0 ? (
            <p className="py-8 text-center text-sm text-gray-400">No banks match your search.</p>
          ) : (
            <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">Bank Name</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">Account Number</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">Type</th>
                    <th className="px-4 py-3 w-24" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {visible.map(bank => (
                    <tr key={bank.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3 font-medium text-gray-900">
                        <span className="flex items-center gap-2">
                          {bank.name}
                          {bank.is_foreign_currency && (
                            <span className="px-1.5 py-0.5 text-[10px] font-semibold rounded bg-amber-100 text-amber-700 border border-amber-200 shrink-0">FX</span>
                          )}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-500 font-mono text-xs">
                        {bank.account_number ?? <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-4 py-3 text-gray-500 text-xs">
                        {bank.account_type ?? <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => onEdit(bank)}
                            className="p-1.5 rounded-lg text-gray-400 hover:text-primary hover:bg-blue-50 transition-colors"
                            title="Edit"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => onDelete(bank)}
                            className="p-1.5 rounded-lg text-gray-400 hover:text-danger hover:bg-red-50 transition-colors"
                            title="Delete"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-xs text-gray-400">
            {visible.length !== banks.length
              ? `${visible.length} of ${banks.length} banks`
              : `${banks.length} bank${banks.length !== 1 ? 's' : ''} configured`}
          </p>
        </>
      )}
    </div>
  )
}

// ── Allocation tab ─────────────────────────────────────────────────────────────────

function AllocationTab({ onNew, onEdit, onLock, onEditLocked, onDelete }: {
  onNew:        () => void
  onEdit:       (c: AllocationConfig) => void
  onLock:       (c: AllocationConfig) => void
  onEditLocked: (c: AllocationConfig) => void
  onDelete:     (c: AllocationConfig) => void
}) {
  const { configs, loading, error, fetch } = useAllocationStore()
  const [search, setSearch] = useState('')
  const [sort,   setSort]   = useState('name|asc')

  useEffect(() => { fetch() }, [fetch])

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    const filtered = q
      ? configs.filter(c => [c.name, c.status ?? ''].some(v => v.toLowerCase().includes(q)))
      : configs
    return applySetupSort(filtered, sort)
  }, [configs, search, sort])

  const statusBadge = (config: AllocationConfig) => {
    const isLocked = config.status === 'locked'
    return (
      <div className="flex flex-col gap-0.5">
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium w-fit ${
          isLocked
            ? 'bg-green-50 text-green-700 border border-green-200'
            : 'bg-amber-50 text-amber-700 border border-amber-200'
        }`}>
          {isLocked ? <Lock className="w-3 h-3" /> : <FileEdit className="w-3 h-3" />}
          {isLocked ? 'Approved & Locked' : 'Draft'}
        </span>
        {!isLocked && (
          <span className="text-[10px] text-gray-400">Not in use — approve &amp; lock to activate</span>
        )}
      </div>
    )
  }

  return (
    <div className="max-w-2xl space-y-3">
      <div className="flex justify-end">
        <button
          onClick={onNew}
          className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary-light transition-colors"
        >
          <Plus className="w-4 h-4" /> New Configuration
        </button>
      </div>

      {loading && (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-14 bg-gray-100 rounded-lg animate-pulse" />
          ))}
        </div>
      )}

      {!loading && error && (
        <div className="flex items-start gap-3 rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          {error}
        </div>
      )}

      {!loading && !error && configs.length === 0 && (
        <div className="flex flex-col items-center justify-center gap-3 py-16 text-center border border-dashed border-gray-300 rounded-xl bg-gray-50">
          <Layers className="w-10 h-10 text-gray-300" />
          <div>
            <p className="text-sm font-medium text-gray-600">No allocation configurations yet</p>
            <p className="text-xs text-gray-400 mt-1">Create a configuration to define how income is split across categories.</p>
          </div>
        </div>
      )}

      {!loading && !error && configs.length > 0 && (
        <>
          <SetupSearchSort search={search} onSearch={setSearch} sort={sort} onSort={setSort} sortOptions={ALLOC_SORT_OPTS} placeholder="Search configurations…" />
          {visible.length === 0 ? (
            <p className="py-8 text-center text-sm text-gray-400">No configurations match your search.</p>
          ) : (
            <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">Name</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">Effective From</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500">Total %</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">Status</th>
                    <th className="px-4 py-3 w-28" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {visible.map(config => {
                    const total    = config.rows.reduce((s, r) => s + (r.percentage ?? 0), 0)
                    const balanced = Math.abs(total - 100) < 0.01
                    return (
                      <tr key={config.id} className="hover:bg-gray-50 transition-colors">
                        <td className="px-4 py-3 font-medium text-gray-900">{config.name}</td>
                        <td className="px-4 py-3 text-gray-500">{formatDate(config.start_date)}</td>
                        <td className={`px-4 py-3 text-right font-mono font-semibold ${balanced ? 'text-success' : 'text-danger'}`}>
                          {total.toFixed(1)}%
                        </td>
                        <td className="px-4 py-3">{statusBadge(config)}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-1">
                            {config.status === 'draft' ? (
                              <>
                                <button
                                  onClick={() => onLock(config)}
                                  className="p-1.5 rounded-lg text-gray-400 hover:text-green-600 hover:bg-green-50 transition-colors"
                                  title="Approve & Lock"
                                >
                                  <Lock className="w-4 h-4" />
                                </button>
                                <button
                                  onClick={() => onEdit(config)}
                                  className="p-1.5 rounded-lg text-gray-400 hover:text-primary hover:bg-blue-50 transition-colors"
                                  title="Edit"
                                >
                                  <Pencil className="w-4 h-4" />
                                </button>
                              </>
                            ) : (
                              <button
                                onClick={() => onEditLocked(config)}
                                className="p-1.5 rounded-lg text-gray-400 hover:text-primary hover:bg-blue-50 transition-colors"
                                title="Edit locked config"
                              >
                                <Pencil className="w-4 h-4" />
                              </button>
                            )}
                            <button
                              onClick={() => onDelete(config)}
                              className="p-1.5 rounded-lg text-gray-400 hover:text-danger hover:bg-red-50 transition-colors"
                              title="Delete"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-xs text-gray-400">
            {visible.length !== configs.length
              ? `${visible.length} of ${configs.length} configurations`
              : `${configs.length} configuration${configs.length !== 1 ? 's' : ''}`}
          </p>
        </>
      )}
    </div>
  )
}

// ── Special Configs tab ────────────────────────────────────────────────────────────

function SpecialConfigsTab({ onNew, onNewVersion, onRefetch }: {
  onNew:        () => void
  onNewVersion: (group: SpecialConfigGroupWithVersions, copyFrom: AllocationConfig | null) => void
  onRefetch:    () => void
}) {
  const { baseCurrencySymbol } = useOrgCurrency()
  const { groups, loading, error } = useSpecialConfigGroups()
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState('')
  const [sort,   setSort]   = useState('name|asc')

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    const filtered = q ? groups.filter(g => g.name.toLowerCase().includes(q)) : groups
    return applySetupSort(filtered, sort)
  }, [groups, search, sort])

  const toggleExpand = (id: string) =>
    setExpandedGroups(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })

  const handleDeleteGroup = async (g: SpecialConfigGroupWithVersions) => {
    if (!window.confirm(`Delete group "${g.name}" and all its versions? This cannot be undone.`)) return
    const { error: err } = await supabase
      .from('special_config_groups')
      .delete()
      .eq('id', g.id)
    if (err) { window.alert(err.message); return }
    onRefetch()
  }

  const handleDeleteVersion = async (v: AllocationConfig) => {
    if (!window.confirm(`Delete version #${v.version_number ?? '?'} (effective ${v.effective_from ?? '—'})? This cannot be undone.`)) return
    const { error: err } = await supabase
      .from('allocation_configs')
      .delete()
      .eq('id', v.id)
    if (err) { window.alert(err.message); return }
    onRefetch()
  }

  if (loading) return (
    <div className="max-w-3xl space-y-2">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="h-14 bg-gray-100 rounded-lg animate-pulse" />
      ))}
    </div>
  )

  if (error) return (
    <div className="max-w-3xl flex items-start gap-3 rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
      <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />{error}
    </div>
  )

  return (
    <div className="max-w-3xl space-y-3">
      <div className="flex justify-end">
        <button
          onClick={onNew}
          className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary-light transition-colors"
        >
          <Plus className="w-4 h-4" /> Create New Group
        </button>
      </div>

      {groups.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 py-16 text-center border border-dashed border-gray-300 rounded-xl bg-gray-50">
          <Layers className="w-10 h-10 text-gray-300" />
          <div>
            <p className="text-sm font-medium text-gray-600">No special config groups yet</p>
            <p className="text-xs text-gray-400 mt-1">Create a group to manage versioned special allocation configs.</p>
          </div>
        </div>
      ) : (
        <>
          <SetupSearchSort search={search} onSearch={setSearch} sort={sort} onSort={setSort} sortOptions={SPECIAL_SORT_OPTS} placeholder="Search groups…" />
          {visible.length === 0 ? (
            <p className="py-8 text-center text-sm text-gray-400">No groups match your search.</p>
          ) : (
        <div className="space-y-3">
          {visible.map(g => {
            const isExpanded = expandedGroups.has(g.id)
            const av = g.active_version
            const isAmt = av?.allocation_type === 'amount'
            return (
              <div key={g.id} className="bg-white border border-gray-200 rounded-xl overflow-x-auto">
                {/* Group header row */}
                <div className="flex items-center gap-3 px-4 py-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-gray-900 text-sm">{g.name}</span>
                      {g.linked_income_type_name && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-blue-50 text-blue-700 border border-blue-200">
                          {g.linked_income_type_name}
                        </span>
                      )}
                    </div>
                    {av ? (
                      <p className="text-xs text-gray-500 mt-0.5">
                        Active: v{av.version_number} &nbsp;&middot;&nbsp;
                        {av.effective_from ?? '—'}{av.effective_to ? ` → ${av.effective_to}` : ' → open'} &nbsp;&middot;&nbsp;
                        <span className={isAmt ? 'text-blue-600' : 'text-purple-600'}>
                          {isAmt ? `Amount ${baseCurrencySymbol}` : 'Percentage %'}
                        </span>
                        {' '}&nbsp;&middot;&nbsp;
                        <span className="text-green-700">Locked</span>
                      </p>
                    ) : (
                      <p className="text-xs text-gray-400 mt-0.5">No active version for today</p>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => onNewVersion(g, g.active_version)}
                      className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-primary border border-primary/30 rounded-lg hover:bg-blue-50 transition-colors"
                    >
                      <Plus className="w-3 h-3" /> New Version
                    </button>
                    <button
                      onClick={() => toggleExpand(g.id)}
                      className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors text-xs"
                      title={isExpanded ? 'Hide history' : 'View history'}
                    >
                      {isExpanded ? 'Hide' : 'History'}
                    </button>
                    <button
                      onClick={() => handleDeleteGroup(g)}
                      className="p-1.5 rounded-lg text-gray-400 hover:text-danger hover:bg-red-50 transition-colors"
                      title="Delete group"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Version history */}
                {isExpanded && (
                  <div className="border-t border-gray-100">
                    {g.versions.length === 0 ? (
                      <p className="px-4 py-3 text-xs text-gray-400">No versions yet.</p>
                    ) : (
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="bg-gray-50 border-b border-gray-100">
                            <th className="px-4 py-2 text-left text-gray-500 font-semibold">Ver</th>
                            <th className="px-4 py-2 text-left text-gray-500 font-semibold">Effective From</th>
                            <th className="px-4 py-2 text-left text-gray-500 font-semibold">Effective To</th>
                            <th className="px-4 py-2 text-left text-gray-500 font-semibold">Type</th>
                            <th className="px-4 py-2 text-left text-gray-500 font-semibold">Status</th>
                            <th className="px-4 py-2 text-right text-gray-500 font-semibold">Rows</th>
                            <th className="px-4 py-2 w-10" />
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50">
                          {g.versions.map(v => {
                            const vAmt = v.allocation_type === 'amount'
                            const vLocked = v.status === 'locked'
                            return (
                              <tr key={v.id} className="hover:bg-gray-50 transition-colors">
                                <td className="px-4 py-2 font-mono text-gray-600">v{v.version_number ?? '—'}</td>
                                <td className="px-4 py-2 text-gray-700">{v.effective_from ?? '—'}</td>
                                <td className="px-4 py-2 text-gray-500">{v.effective_to ?? <span className="text-gray-300">open</span>}</td>
                                <td className="px-4 py-2">
                                  <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${
                                    vAmt ? 'bg-blue-50 text-blue-700' : 'bg-purple-50 text-purple-700'
                                  }`}>
                                    {vAmt ? 'Amount' : 'Pct'}
                                  </span>
                                </td>
                                <td className="px-4 py-2">
                                  <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${
                                    vLocked ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'
                                  }`}>
                                    {vLocked ? <Lock className="w-2.5 h-2.5" /> : <FileEdit className="w-2.5 h-2.5" />}
                                    {vLocked ? 'Locked' : 'Draft'}
                                  </span>
                                </td>
                                <td className="px-4 py-2 text-right text-gray-500">{v.rows.length}</td>
                                <td className="px-4 py-2">
                                  <button
                                    onClick={() => handleDeleteVersion(v)}
                                    className="p-1 rounded text-gray-300 hover:text-danger hover:bg-red-50 transition-colors"
                                    title="Delete version"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
          )}
        </>
      )}
      <p className="text-xs text-gray-400">
        {visible.length !== groups.length
          ? `${visible.length} of ${groups.length} groups`
          : `${groups.length} group${groups.length !== 1 ? 's' : ''}`}
      </p>
    </div>
  )
}

// ── Currencies tab ───────────────────────────────────────────────────────────────────

const CURRENCIES_MIGRATION_SQL =
`-- Create currencies table
CREATE TABLE IF NOT EXISTS public.currencies (
  code       text PRIMARY KEY,
  name       text NOT NULL,
  symbol     text NOT NULL DEFAULT '',
  flag       text,
  is_active  boolean NOT NULL DEFAULT true,
  sort_order integer DEFAULT 100
);
ALTER TABLE public.currencies ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS "currencies_read"  ON public.currencies FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY IF NOT EXISTS "currencies_write" ON public.currencies FOR ALL
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));

-- Seed default currencies (skip if already present)
INSERT INTO public.currencies (code, name, symbol, flag, sort_order) VALUES
  ('NGN', 'Nigerian Naira', '₦', '🇳🇬', 0),
  ('USD', 'US Dollar',      '$', '🇺🇸', 1),
  ('GBP', 'British Pound',  '£', '🇬🇧', 2),
  ('EUR', 'Euro',           '€', '🇪🇺', 3),
  ('CNY', 'Chinese Yuan',   '¥', '🇨🇳', 4)
ON CONFLICT (code) DO NOTHING;

-- Remove hardcoded currency check constraints (if they exist)
ALTER TABLE public.banks          DROP CONSTRAINT IF EXISTS banks_currency_check;
ALTER TABLE public.fx_transactions DROP CONSTRAINT IF EXISTS fx_transactions_currency_check;`

function CurrenciesTab() {
  const { currencies, loading, error, refetch } = useCurrencies()
  const { mutate: addCurrency, loading: adding, error: addError, reset: resetAdd } = useAddCurrency()
  const { mutate: deleteCurrency } = useDeleteCurrency()
  const { push: toast } = useToastStore()

  const [code,   setCode]   = useState('')
  const [name,   setName]   = useState('')
  const [symbol, setSymbol] = useState('')
  const [flag,   setFlag]   = useState('')
  const [formErr, setFormErr] = useState<string | null>(null)
  const [showMigration, setShowMigration] = useState(false)
  const isMigrationError = !!error && /relation.*does not exist|does not exist/i.test(error)

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault()
    setFormErr(null)
    if (!code.trim())   { setFormErr('Currency code is required (e.g. CHF)'); return }
    if (!name.trim())   { setFormErr('Name is required'); return }
    if (!symbol.trim()) { setFormErr('Symbol is required (e.g. Fr.)'); return }
    try {
      await addCurrency({ code: code.trim().toUpperCase(), name: name.trim(), symbol: symbol.trim(), flag: flag.trim() || undefined })
      toast(`${code.toUpperCase()} added`, 'success')
      setCode(''); setName(''); setSymbol(''); setFlag('')
      resetAdd()
      refetch()
    } catch { /* error surfaced via addError */ }
  }

  const handleDelete = async (currCode: string) => {
    try {
      await deleteCurrency(currCode)
      toast(`${currCode} removed`, 'success')
      refetch()
    } catch (e: unknown) {
      toast(e instanceof Error ? e.message : 'Delete failed', 'error')
    }
  }

  const iCls = 'px-3 py-2 text-sm border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary'

  return (
    <div className="max-w-2xl space-y-5">
      {/* Migration hint */}
      {(isMigrationError || showMigration) && (
        <div className="space-y-2">
          <div className="flex items-start gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>Run this SQL in your Supabase editor to create the currencies table, then refresh.</span>
          </div>
          <pre className="bg-gray-900 text-green-300 text-xs rounded-xl p-4 overflow-x-auto whitespace-pre-wrap">
            {CURRENCIES_MIGRATION_SQL}
          </pre>
        </div>
      )}

      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">Manage the currencies available across banks, FX transactions, and deposits.</p>
        <button
          onClick={() => setShowMigration(v => !v)}
          className="text-xs text-gray-400 hover:text-gray-600 underline"
        >
          {showMigration ? 'Hide' : 'Show'} migration SQL
        </button>
      </div>

      {/* Add form */}
      <form onSubmit={handleAdd} className="border border-gray-200 rounded-xl p-4 space-y-3 bg-gray-50">
        <p className="text-xs font-semibold text-gray-500">Add Currency</p>
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

// ── Database tab ───────────────────────────────────────────────────────────────────

const MIGRATION_SQL = `-- ── Multi-org owner role (run if upgrading from a pre-owner-role install) ──────
ALTER TABLE public.org_members
  DROP CONSTRAINT IF EXISTS org_members_role_check;
ALTER TABLE public.org_members
  ADD CONSTRAINT org_members_role_check
    CHECK (role IN ('owner', 'admin', 'accountant', 'viewer'));

ALTER TABLE public.invitations
  DROP CONSTRAINT IF EXISTS invitations_role_check;
ALTER TABLE public.invitations
  ADD CONSTRAINT invitations_role_check
    CHECK (role IN ('owner', 'admin', 'accountant', 'viewer'));

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_role_check
    CHECK (role IN ('owner', 'admin', 'accountant', 'viewer'));

-- Promote org creators to owner; fallback: promote all admins where no owner exists
UPDATE public.org_members om
SET role = 'owner'
FROM public.organizations o
WHERE om.org_id  = o.id
  AND om.user_id = o.created_by
  AND om.role    = 'admin'
  AND om.status  = 'active';

UPDATE public.org_members
SET role = 'owner'
WHERE role   = 'admin'
  AND status = 'active'
  AND NOT EXISTS (
    SELECT 1 FROM public.org_members o2
    WHERE o2.org_id = org_members.org_id AND o2.role = 'owner'
  );

NOTIFY pgrst, 'reload schema';

-- ── Add bank_name to inflow/outflow
ALTER TABLE inflow_transactions  ADD COLUMN IF NOT EXISTS bank_name text;
ALTER TABLE outflow_transactions ADD COLUMN IF NOT EXISTS bank_name text;

-- FX fields
ALTER TABLE inflow_transactions
  ADD COLUMN IF NOT EXISTS fx_currency text,
  ADD COLUMN IF NOT EXISTS fx_amount   numeric(15,4),
  ADD COLUMN IF NOT EXISTS fx_rate     numeric(15,6);

ALTER TABLE outflow_transactions
  ADD COLUMN IF NOT EXISTS fx_currency text,
  ADD COLUMN IF NOT EXISTS fx_amount   numeric(15,4),
  ADD COLUMN IF NOT EXISTS fx_rate     numeric(15,6);

-- Transaction type + original reference
ALTER TABLE inflow_transactions
  ADD COLUMN IF NOT EXISTS transaction_type          text,
  ADD COLUMN IF NOT EXISTS original_transaction_id   text,
  ADD COLUMN IF NOT EXISTS allocation_config_id      uuid,
  ADD COLUMN IF NOT EXISTS income_type_id            uuid;

ALTER TABLE outflow_transactions
  ADD COLUMN IF NOT EXISTS transaction_type          text,
  ADD COLUMN IF NOT EXISTS original_transaction_id   text,
  ADD COLUMN IF NOT EXISTS allocation_config_id      uuid;

-- Bank deposits table
CREATE TABLE IF NOT EXISTS bank_deposits (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date                date NOT NULL,
  bank_id             uuid REFERENCES banks(id),
  bank_name           text,
  amount              numeric(15,2) NOT NULL,
  description         text,
  transaction_ref     text,
  remarks             text,
  created_at          timestamptz DEFAULT now()
);

-- Intrabank transfers table
CREATE TABLE IF NOT EXISTS intrabank_transfers (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date                date NOT NULL,
  from_bank_id        uuid REFERENCES banks(id),
  from_bank_name      text,
  to_bank_id          uuid REFERENCES banks(id),
  to_bank_name        text,
  amount              numeric(15,2) NOT NULL,
  description         text,
  transaction_ref     text,
  remarks             text,
  created_at          timestamptz DEFAULT now()
);

-- Category opening balances (multi-portion per category)
CREATE TABLE IF NOT EXISTS public.category_opening_balances (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id    uuid NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  budget_portion text NOT NULL CHECK (budget_portion IN ('Percentage Allocation','Specific Seed','Savings')),
  amount         numeric(15,2) NOT NULL DEFAULT 0,
  created_at     timestamptz DEFAULT now(),
  UNIQUE (category_id, budget_portion)
);
ALTER TABLE public.category_opening_balances ENABLE ROW LEVEL SECURITY;
DO $\$ BEGIN
  CREATE POLICY "cob_read" ON public.category_opening_balances FOR SELECT USING (auth.uid() IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $\$;
DO $\$ BEGIN
  CREATE POLICY "cob_write" ON public.category_opening_balances FOR ALL USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $\$;

-- Allow all authenticated users to delete transactions (removes admin-only restriction)
DROP POLICY IF EXISTS "inflow_delete" ON inflow_transactions;
CREATE POLICY "inflow_delete" ON inflow_transactions FOR DELETE USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "outflow_delete" ON outflow_transactions;
CREATE POLICY "outflow_delete" ON outflow_transactions FOR DELETE USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "intraflow_delete" ON intra_flows;
CREATE POLICY "intraflow_delete" ON intra_flows FOR DELETE USING (auth.uid() IS NOT NULL);

-- Fix field_changes FK so PostgREST can join profiles (was pointing to auth.users)
ALTER TABLE public.field_changes
  DROP CONSTRAINT IF EXISTS field_changes_user_id_fkey;
ALTER TABLE public.field_changes
  ADD CONSTRAINT field_changes_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE SET NULL;

-- Report Templates table
CREATE TABLE IF NOT EXISTS public.report_templates (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  description text,
  layout      jsonb NOT NULL DEFAULT '{}',
  created_by  uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now()
);
ALTER TABLE public.report_templates ENABLE ROW LEVEL SECURITY;
DO $\$ BEGIN
  CREATE POLICY "report_templates_select" ON public.report_templates FOR SELECT USING (auth.uid() IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $\$;
DO $\$ BEGIN
  CREATE POLICY "report_templates_all" ON public.report_templates FOR ALL USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $\$;

-- Fix RLS infinite recursion on profiles
-- profiles_admin_all called is_admin() which queries profiles causing infinite recursion
DROP POLICY IF EXISTS "profiles_admin_all" ON public.profiles;
DROP POLICY IF EXISTS "profiles_update_own" ON public.profiles;
DO $\$ BEGIN
  CREATE POLICY "profiles_insert" ON public.profiles
    FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $\$;
DO $\$ BEGIN
  CREATE POLICY "profiles_update" ON public.profiles
    FOR UPDATE USING (auth.uid() IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $\$;
DO $\$ BEGIN
  CREATE POLICY "profiles_delete" ON public.profiles
    FOR DELETE USING (auth.uid() IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $\$;

-- Bank columns (currency + starting balance + foreign currency flag)
ALTER TABLE banks
  ADD COLUMN IF NOT EXISTS currency                  text NOT NULL DEFAULT 'NGN',
  ADD COLUMN IF NOT EXISTS starting_balance          numeric(15,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS starting_balance_category text,
  ADD COLUMN IF NOT EXISTS starting_balance_budget_portion text,
  ADD COLUMN IF NOT EXISTS starting_balance_alloc_type text,
  ADD COLUMN IF NOT EXISTS starting_balance_allocations jsonb NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS is_foreign_currency       bool NOT NULL DEFAULT false;
-- Helper view: reads information_schema directly, bypasses PostgREST schema cache
CREATE OR REPLACE VIEW public.bank_schema_check AS
  SELECT column_name::text
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'banks';
GRANT SELECT ON public.bank_schema_check TO anon, authenticated;
NOTIFY pgrst, 'reload schema';

-- recorded_at: editable business reporting/upload date
-- Backfilled from created_at for existing rows
ALTER TABLE inflow_transactions
  ADD COLUMN IF NOT EXISTS recorded_at timestamptz;
UPDATE inflow_transactions SET recorded_at = created_at WHERE recorded_at IS NULL;

ALTER TABLE outflow_transactions
  ADD COLUMN IF NOT EXISTS recorded_at timestamptz;
UPDATE outflow_transactions SET recorded_at = created_at WHERE recorded_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_inflow_recorded_at  ON inflow_transactions(recorded_at);
CREATE INDEX IF NOT EXISTS idx_outflow_recorded_at ON outflow_transactions(recorded_at);

-- Special config versioning
CREATE TABLE IF NOT EXISTS public.special_config_groups (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.special_config_groups ENABLE ROW LEVEL SECURITY;
DO $\$ BEGIN
  CREATE POLICY "scg_read" ON public.special_config_groups FOR SELECT USING (auth.uid() IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $\$;
DO $\$ BEGIN
  CREATE POLICY "scg_write" ON public.special_config_groups FOR ALL USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $\$;

ALTER TABLE public.allocation_configs
  ADD COLUMN IF NOT EXISTS config_group_id uuid REFERENCES public.special_config_groups(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS effective_from  date,
  ADD COLUMN IF NOT EXISTS effective_to    date,
  ADD COLUMN IF NOT EXISTS version_number  integer NOT NULL DEFAULT 1;

ALTER TABLE public.income_types
  ADD COLUMN IF NOT EXISTS special_config_group_id uuid REFERENCES public.special_config_groups(id) ON DELETE SET NULL;

-- Migrate existing special configs: each becomes a group with version 1
DO $\$
DECLARE
  cfg RECORD;
  grp_id uuid;
BEGIN
  FOR cfg IN SELECT * FROM public.allocation_configs WHERE is_special = true AND config_group_id IS NULL LOOP
    INSERT INTO public.special_config_groups (name, created_at)
    VALUES (cfg.name, cfg.created_at)
    RETURNING id INTO grp_id;

    UPDATE public.allocation_configs
    SET config_group_id = grp_id,
        effective_from  = COALESCE(cfg.start_date::date, cfg.created_at::date),
        version_number  = 1
    WHERE id = cfg.id;

    UPDATE public.income_types
    SET special_config_group_id = grp_id
    WHERE special_config_id = cfg.id AND special_config_group_id IS NULL;
  END LOOP;
END $\$;

CREATE TABLE IF NOT EXISTS public.transaction_allocation_snapshots (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id     uuid NOT NULL REFERENCES public.inflow_transactions(id) ON DELETE CASCADE,
  config_version_id  uuid REFERENCES public.allocation_configs(id) ON DELETE RESTRICT,
  config_group_id    uuid REFERENCES public.special_config_groups(id) ON DELETE SET NULL,
  resolved_rows      jsonb NOT NULL DEFAULT '[]',
  allocation_type    text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  is_recalculated    boolean NOT NULL DEFAULT false,
  recalculated_at    timestamptz,
  UNIQUE(transaction_id)
);
ALTER TABLE public.transaction_allocation_snapshots ENABLE ROW LEVEL SECURITY;
DO $\$ BEGIN
  CREATE POLICY "tas_read" ON public.transaction_allocation_snapshots FOR SELECT USING (auth.uid() IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $\$;
DO $\$ BEGIN
  CREATE POLICY "tas_write" ON public.transaction_allocation_snapshots FOR ALL USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $\$;

CREATE TABLE IF NOT EXISTS public.recalculation_logs (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  config_group_id    uuid REFERENCES public.special_config_groups(id) ON DELETE SET NULL,
  config_version_id  uuid REFERENCES public.allocation_configs(id) ON DELETE SET NULL,
  performed_by       uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  performed_at       timestamptz NOT NULL DEFAULT now(),
  affected_count     integer NOT NULL DEFAULT 0,
  reason             text,
  action_summary     text NOT NULL
);
ALTER TABLE public.recalculation_logs ENABLE ROW LEVEL SECURITY;
DO $\$ BEGIN
  CREATE POLICY "rl_read" ON public.recalculation_logs FOR SELECT USING (auth.uid() IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $\$;
DO $\$ BEGIN
  CREATE POLICY "rl_write" ON public.recalculation_logs FOR ALL USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $\$;

-- Balance Brought Forward: deduplicate existing rows, then enforce uniqueness
DO $$ BEGIN
  DELETE FROM inflow_transactions
  WHERE transaction_type = 'balance_brought_forward'
    AND id NOT IN (
      SELECT DISTINCT ON (bank_name) id
      FROM inflow_transactions
      WHERE transaction_type = 'balance_brought_forward'
      ORDER BY bank_name, created_at DESC NULLS LAST
    );
EXCEPTION WHEN others THEN NULL; END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_inflow_bf_unique_bank
  ON inflow_transactions (bank_name)
  WHERE transaction_type = 'balance_brought_forward';

CREATE INDEX IF NOT EXISTS idx_inflow_bank_name  ON inflow_transactions(bank_name);
CREATE INDEX IF NOT EXISTS idx_outflow_bank_name ON outflow_transactions(bank_name);

-- Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';

-- Dynamic Reports: document-based finance reports with live-updating blocks
CREATE TABLE IF NOT EXISTS public.dynamic_reports (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title      text NOT NULL DEFAULT 'Untitled Report',
  created_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE public.dynamic_reports ENABLE ROW LEVEL SECURITY;
DO $\$ BEGIN
  CREATE POLICY "dr_select" ON public.dynamic_reports FOR SELECT USING (auth.uid() IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $\$;
DO $\$ BEGIN
  CREATE POLICY "dr_all" ON public.dynamic_reports FOR ALL USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $\$;

-- Dynamic Report Blocks: structured content blocks (text, metric, table)
CREATE TABLE IF NOT EXISTS public.dynamic_report_blocks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id   uuid NOT NULL REFERENCES dynamic_reports(id) ON DELETE CASCADE,
  block_type  text NOT NULL CHECK (block_type IN ('text', 'metric', 'table')),
  position    integer NOT NULL DEFAULT 0,
  config_json jsonb NOT NULL DEFAULT '{}',
  created_at  timestamptz DEFAULT now()
);
ALTER TABLE public.dynamic_report_blocks ENABLE ROW LEVEL SECURITY;
DO $\$ BEGIN
  CREATE POLICY "drb_select" ON public.dynamic_report_blocks FOR SELECT USING (auth.uid() IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $\$;
DO $\$ BEGIN
  CREATE POLICY "drb_all" ON public.dynamic_report_blocks FOR ALL USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $\$;
CREATE INDEX IF NOT EXISTS idx_drb_report_position ON public.dynamic_report_blocks(report_id, position);

-- Phase 4: Extend block_type to support formula blocks
ALTER TABLE public.dynamic_report_blocks DROP CONSTRAINT IF EXISTS dynamic_report_blocks_block_type_check;
ALTER TABLE public.dynamic_report_blocks ADD CONSTRAINT dynamic_report_blocks_block_type_check
  CHECK (block_type IN ('text', 'metric', 'table', 'formula'));

-- Phase 5: Report snapshots
CREATE TABLE IF NOT EXISTS public.dynamic_report_snapshots (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id   uuid NOT NULL REFERENCES dynamic_reports(id) ON DELETE CASCADE,
  label       text NOT NULL,
  snapshot_at timestamptz NOT NULL DEFAULT now(),
  data        jsonb NOT NULL DEFAULT '{}',
  created_at  timestamptz DEFAULT now()
);
ALTER TABLE public.dynamic_report_snapshots ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "drs_select" ON public.dynamic_report_snapshots FOR SELECT USING (auth.uid() IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "drs_all" ON public.dynamic_report_snapshots FOR ALL USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS idx_drs_report_at ON public.dynamic_report_snapshots(report_id, snapshot_at DESC);

-- Outflow Types table (reporting/classification layer — does not affect balances)
CREATE TABLE IF NOT EXISTS public.outflow_types (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL UNIQUE,
  color      text NOT NULL DEFAULT '#64748b',
  created_by uuid REFERENCES profiles(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE public.outflow_types ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "ot_read"  ON public.outflow_types FOR SELECT USING (auth.uid() IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "ot_write" ON public.outflow_types FOR ALL USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- outflow_type_id FK on outflow_transactions
ALTER TABLE outflow_transactions
  ADD COLUMN IF NOT EXISTS outflow_type_id uuid REFERENCES outflow_types(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_outflow_type_id ON outflow_transactions(outflow_type_id);

-- Outflow Types: new classification metadata columns
ALTER TABLE public.outflow_types
  ADD COLUMN IF NOT EXISTS is_system        boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_locked        boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS auto_created     boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS manually_renamed boolean NOT NULL DEFAULT false;

-- Ensure "General" permanent system fallback type exists
INSERT INTO public.outflow_types (name, color, is_system, is_locked)
VALUES ('General', '#64748b', true, true)
ON CONFLICT (name) DO UPDATE SET is_system = true, is_locked = true;

-- Category-OutflowType many-to-many mapping table
CREATE TABLE IF NOT EXISTS public.category_outflow_type_map (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id     uuid NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  outflow_type_id uuid NOT NULL REFERENCES outflow_types(id) ON DELETE CASCADE,
  created_at      timestamptz DEFAULT now(),
  UNIQUE(category_id, outflow_type_id)
);
ALTER TABLE public.category_outflow_type_map ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "cotm_read" ON public.category_outflow_type_map FOR SELECT USING (auth.uid() IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "cotm_write" ON public.category_outflow_type_map FOR ALL USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS idx_cotm_category ON public.category_outflow_type_map(category_id);
CREATE INDEX IF NOT EXISTS idx_cotm_type     ON public.category_outflow_type_map(outflow_type_id);

-- Auto-create linked outflow types for existing categories (idempotent)
DO $$
DECLARE
  cat RECORD;
  ot_id uuid;
BEGIN
  FOR cat IN SELECT id, name FROM public.categories LOOP
    SELECT id INTO ot_id FROM public.outflow_types WHERE LOWER(name) = LOWER(cat.name) LIMIT 1;
    IF ot_id IS NULL THEN
      INSERT INTO public.outflow_types (name, color, auto_created)
      VALUES (cat.name, '#64748b', true)
      RETURNING id INTO ot_id;
    END IF;
    INSERT INTO public.category_outflow_type_map (category_id, outflow_type_id)
    VALUES (cat.id, ot_id)
    ON CONFLICT (category_id, outflow_type_id) DO NOTHING;
  END LOOP;
END $$;

-- Backfill outflow_type_id for existing outflows from stage_code_1 → category mapping
DO $$
BEGIN
  UPDATE outflow_transactions ot
  SET outflow_type_id = (
    SELECT cotm.outflow_type_id
    FROM category_outflow_type_map cotm
    JOIN categories c ON c.id = cotm.category_id
    WHERE c.name = ot.stage_code_1
    ORDER BY cotm.created_at
    LIMIT 1
  )
  WHERE ot.stage_code_1 IS NOT NULL
    AND ot.outflow_type_id IS NULL
    AND EXISTS (
      SELECT 1 FROM category_outflow_type_map cotm2
      JOIN categories c2 ON c2.id = cotm2.category_id
      WHERE c2.name = ot.stage_code_1
    );
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- MULTI-TENANT FOUNDATION (Phase 1: Structural only)
-- Safe to run multiple times — all statements are idempotent.
-- Does NOT enforce tenant isolation. Existing queries unchanged.
-- ============================================================

-- Organizations
CREATE TABLE IF NOT EXISTS public.organizations (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text        NOT NULL,
  slug       text        NOT NULL UNIQUE,
  created_by uuid        REFERENCES profiles(id) ON DELETE SET NULL,
  metadata   jsonb       NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_organizations_slug       ON public.organizations(slug);
CREATE INDEX IF NOT EXISTS idx_organizations_created_by ON public.organizations(created_by);
DO $$ BEGIN
  CREATE POLICY "orgs_select" ON public.organizations FOR SELECT USING (auth.uid() IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "orgs_insert" ON public.organizations FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "orgs_update" ON public.organizations FOR UPDATE USING (auth.uid() IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "orgs_delete" ON public.organizations FOR DELETE USING (is_admin());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Org Members
CREATE TABLE IF NOT EXISTS public.org_members (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id    uuid        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role       text        NOT NULL DEFAULT 'viewer' CHECK (role IN ('admin', 'accountant', 'viewer')),
  joined_at  timestamptz NOT NULL DEFAULT now(),
  invited_by uuid        REFERENCES profiles(id) ON DELETE SET NULL,
  status     text        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'invited', 'suspended')),
  UNIQUE (org_id, user_id)
);
ALTER TABLE public.org_members ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_org_members_org_id  ON public.org_members(org_id);
CREATE INDEX IF NOT EXISTS idx_org_members_user_id ON public.org_members(user_id);
DO $$ BEGIN
  CREATE POLICY "org_members_select" ON public.org_members FOR SELECT USING (auth.uid() IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "org_members_insert" ON public.org_members FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "org_members_update" ON public.org_members FOR UPDATE USING (auth.uid() IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "org_members_delete" ON public.org_members FOR DELETE USING (is_admin());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Add nullable org_id to all business tables (nullable only; no enforcement yet)
ALTER TABLE public.category_groups           ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES organizations(id) ON DELETE SET NULL;
ALTER TABLE public.categories                ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES organizations(id) ON DELETE SET NULL;
ALTER TABLE public.banks                     ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES organizations(id) ON DELETE SET NULL;
ALTER TABLE public.allocation_configs        ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES organizations(id) ON DELETE SET NULL;
ALTER TABLE public.income_types              ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES organizations(id) ON DELETE SET NULL;
ALTER TABLE public.income_type_rules         ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES organizations(id) ON DELETE SET NULL;
ALTER TABLE public.inflow_transactions       ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES organizations(id) ON DELETE SET NULL;
ALTER TABLE public.outflow_transactions      ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES organizations(id) ON DELETE SET NULL;
ALTER TABLE public.intra_flows               ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES organizations(id) ON DELETE SET NULL;
ALTER TABLE public.bank_deposits             ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES organizations(id) ON DELETE SET NULL;
ALTER TABLE public.intrabank_transfers       ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES organizations(id) ON DELETE SET NULL;
ALTER TABLE public.accounts                  ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES organizations(id) ON DELETE SET NULL;
ALTER TABLE public.ledger_entries            ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES organizations(id) ON DELETE SET NULL;
ALTER TABLE public.fx_transactions           ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES organizations(id) ON DELETE SET NULL;
ALTER TABLE public.special_projects          ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES organizations(id) ON DELETE SET NULL;
ALTER TABLE public.project_entries           ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES organizations(id) ON DELETE SET NULL;
ALTER TABLE public.receipts                  ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES organizations(id) ON DELETE SET NULL;
ALTER TABLE public.invitations               ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES organizations(id) ON DELETE SET NULL;
ALTER TABLE public.report_templates          ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES organizations(id) ON DELETE SET NULL;
ALTER TABLE public.special_config_groups     ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES organizations(id) ON DELETE SET NULL;
ALTER TABLE public.transaction_allocation_snapshots ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES organizations(id) ON DELETE SET NULL;
ALTER TABLE public.recalculation_logs        ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES organizations(id) ON DELETE SET NULL;
ALTER TABLE public.dynamic_reports           ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES organizations(id) ON DELETE SET NULL;
ALTER TABLE public.outflow_types             ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES organizations(id) ON DELETE SET NULL;
ALTER TABLE public.category_outflow_type_map ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES organizations(id) ON DELETE SET NULL;
ALTER TABLE public.category_opening_balances ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES organizations(id) ON DELETE SET NULL;

-- Indexes on high-volume tables for future org-scoped queries
CREATE INDEX IF NOT EXISTS idx_inflow_org        ON public.inflow_transactions(org_id);
CREATE INDEX IF NOT EXISTS idx_outflow_org       ON public.outflow_transactions(org_id);
CREATE INDEX IF NOT EXISTS idx_intra_flows_org   ON public.intra_flows(org_id);
CREATE INDEX IF NOT EXISTS idx_banks_org         ON public.banks(org_id);
CREATE INDEX IF NOT EXISTS idx_categories_org    ON public.categories(org_id);
CREATE INDEX IF NOT EXISTS idx_alloc_configs_org ON public.allocation_configs(org_id);
CREATE INDEX IF NOT EXISTS idx_fx_org            ON public.fx_transactions(org_id);
CREATE INDEX IF NOT EXISTS idx_bank_deposits_org ON public.bank_deposits(org_id);

-- Org-aware helper functions (Phase 1 stubs — enforce nothing yet)
CREATE OR REPLACE FUNCTION public.get_current_org_id()
RETURNS uuid LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT NULL::uuid;
$$;

CREATE OR REPLACE FUNCTION public.is_org_admin(p_org_id uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.org_members
    WHERE org_id  = p_org_id
      AND user_id = auth.uid()
      AND role    = 'admin'
      AND status  = 'active'
  );
$$;

CREATE OR REPLACE FUNCTION public.is_org_finance_user(p_org_id uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.org_members
    WHERE org_id  = p_org_id
      AND user_id = auth.uid()
      AND role    IN ('admin', 'accountant')
      AND status  = 'active'
  );
$$;

-- Phase 5: Org-based invite system
-- Updated invitations RLS — gate on org admin instead of global is_admin().
DROP POLICY IF EXISTS "invitations_admin_all" ON public.invitations;
DROP POLICY IF EXISTS "invitations_select"    ON public.invitations;
DROP POLICY IF EXISTS "invitations_insert"    ON public.invitations;
DROP POLICY IF EXISTS "invitations_update"    ON public.invitations;
DROP POLICY IF EXISTS "invitations_delete"    ON public.invitations;

DO $$ BEGIN
  CREATE POLICY "invitations_select" ON public.invitations
    FOR SELECT USING (public.is_org_admin(org_id));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "invitations_insert" ON public.invitations
    FOR INSERT WITH CHECK (public.is_org_admin(org_id));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "invitations_update" ON public.invitations
    FOR UPDATE USING (public.is_org_admin(org_id));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "invitations_delete" ON public.invitations
    FOR DELETE USING (public.is_org_admin(org_id));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Updated get_invitation_by_token — idempotent via CREATE OR REPLACE.
CREATE OR REPLACE FUNCTION public.get_invitation_by_token(p_token uuid)
RETURNS TABLE(id uuid, email text, role text, status text, expires_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER STABLE AS $$
BEGIN
  RETURN QUERY
    SELECT i.id, i.email, i.role, i.status, i.expires_at
    FROM   public.invitations i
    WHERE  i.token      = p_token
      AND  i.status     = 'pending'
      AND  i.expires_at > now();
END;
$$;

-- Updated accept_invitation — falls back to primary org when org_id is NULL
-- (backward compat for invites created before Phase 5).
CREATE OR REPLACE FUNCTION public.accept_invitation(p_token uuid, p_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_invite public.invitations;
  v_org_id uuid;
BEGIN
  IF p_user_id != auth.uid() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT * INTO v_invite
  FROM   public.invitations
  WHERE  token      = p_token
    AND  status     = 'pending'
    AND  expires_at > now()
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid or expired invitation';
  END IF;

  -- Keep profiles.role in sync (backward compat — Phase 6 will remove this).
  UPDATE public.profiles
    SET role       = v_invite.role,
        updated_at = now()
  WHERE id = p_user_id;

  -- Resolve org_id — fall back to primary org for pre-Phase 5 invites.
  v_org_id := v_invite.org_id;
  IF v_org_id IS NULL THEN
    SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'primary' LIMIT 1;
  END IF;

  -- Upsert org_members — authoritative role source for all RLS checks.
  IF v_org_id IS NOT NULL THEN
    INSERT INTO public.org_members (org_id, user_id, role, status)
    VALUES (v_org_id, p_user_id, v_invite.role, 'active')
    ON CONFLICT (org_id, user_id) DO UPDATE
      SET role   = EXCLUDED.role,
          status = 'active';
  END IF;

  UPDATE public.invitations
    SET status      = 'accepted',
        accepted_at = now()
  WHERE token = p_token;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_invitations_org ON public.invitations(org_id);

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- ORG ONBOARDING (20260530000000)
-- Adds self-signup org creation + onboarding wizard support.
-- ============================================================

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS default_currency    text,
  ADD COLUMN IF NOT EXISTS fiscal_year_start   int     NOT NULL DEFAULT 1
    CHECK (fiscal_year_start BETWEEN 1 AND 12),
  ADD COLUMN IF NOT EXISTS timezone            text    NOT NULL DEFAULT 'Africa/Lagos',
  ADD COLUMN IF NOT EXISTS onboarding_complete boolean NOT NULL DEFAULT true;

-- Fix outflow_types name uniqueness for multi-tenancy
ALTER TABLE public.outflow_types DROP CONSTRAINT IF EXISTS outflow_types_name_key;
DO $$ BEGIN
  ALTER TABLE public.outflow_types ADD CONSTRAINT outflow_types_org_name_unique UNIQUE (org_id, name);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- create_organization(): atomically create org + admin membership (bypasses RLS)
CREATE OR REPLACE FUNCTION public.create_organization(p_name text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_user_id uuid := auth.uid(); v_org_id uuid; v_slug text; v_attempt int := 0;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF length(trim(p_name)) = 0 THEN RAISE EXCEPTION 'Organisation name cannot be empty'; END IF;
  v_slug := lower(regexp_replace(trim(p_name), '[^a-z0-9]+', '-', 'g'));
  v_slug := trim(both '-' from v_slug);
  IF v_slug = '' OR v_slug = 'primary' THEN v_slug := 'org'; END IF;
  LOOP
    BEGIN
      INSERT INTO public.organizations (name, slug, created_by, onboarding_complete)
      VALUES (trim(p_name), CASE WHEN v_attempt=0 THEN v_slug ELSE v_slug||'-'||v_attempt END, v_user_id, false)
      RETURNING id INTO v_org_id; EXIT;
    EXCEPTION WHEN unique_violation THEN
      v_attempt := v_attempt + 1;
      IF v_attempt > 9 THEN RAISE EXCEPTION 'Could not generate unique slug for: %', p_name; END IF;
    END;
  END LOOP;
  INSERT INTO public.org_members (org_id, user_id, role, status)
  VALUES (v_org_id, v_user_id, 'admin', 'active')
  ON CONFLICT (org_id, user_id) DO UPDATE SET role='admin', status='active';
  DELETE FROM public.org_members
  WHERE org_id=(SELECT id FROM public.organizations WHERE slug='primary' LIMIT 1)
    AND user_id=v_user_id AND role='viewer';
  RETURN v_org_id;
END; $$;
GRANT EXECUTE ON FUNCTION public.create_organization(text) TO authenticated;

-- complete_org_onboarding(): save settings + seed defaults + mark done
CREATE OR REPLACE FUNCTION public.complete_org_onboarding(
  p_org_id uuid, p_name text, p_default_currency text,
  p_fiscal_year_start int DEFAULT 1, p_timezone text DEFAULT 'Africa/Lagos'
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_user_id uuid := auth.uid();
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.org_members
    WHERE org_id=p_org_id AND user_id=v_user_id AND role='admin' AND status='active'
  ) THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  UPDATE public.organizations
  SET name=trim(p_name), default_currency=p_default_currency,
      fiscal_year_start=p_fiscal_year_start, timezone=p_timezone,
      onboarding_complete=true, updated_at=now()
  WHERE id=p_org_id;
  IF NOT EXISTS (SELECT 1 FROM public.income_types WHERE org_id=p_org_id LIMIT 1) THEN
    INSERT INTO public.income_types (org_id, name, color) VALUES
      (p_org_id,'Tithe','#6366f1'),(p_org_id,'Offering','#10b981'),
      (p_org_id,'Donation','#f59e0b'),(p_org_id,'Special Giving','#ec4899'),
      (p_org_id,'Thanksgiving','#3b82f6'),(p_org_id,'Project','#8b5cf6');
  END IF;
  INSERT INTO public.outflow_types (org_id, name, color, is_system, is_locked)
  VALUES (p_org_id,'General','#64748b',true,true) ON CONFLICT (org_id, name) DO NOTHING;
END; $$;
GRANT EXECUTE ON FUNCTION public.complete_org_onboarding(uuid,text,text,int,text) TO authenticated;

-- ── Departments / Units ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.departments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  code        text,
  description text,
  active      boolean NOT NULL DEFAULT true,
  org_id      uuid REFERENCES organizations(id) ON DELETE SET NULL,
  created_by  uuid REFERENCES profiles(id),
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now()
);

DO $$ BEGIN
  ALTER TABLE public.departments ADD CONSTRAINT departments_org_name_unique UNIQUE (org_id, name);
EXCEPTION WHEN duplicate_table OR duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_departments_org_active ON public.departments(org_id, active);

DO $$ BEGIN
  ALTER TABLE public.departments ENABLE ROW LEVEL SECURITY;

  DROP POLICY IF EXISTS "departments_select" ON public.departments;
  DROP POLICY IF EXISTS "departments_insert" ON public.departments;
  DROP POLICY IF EXISTS "departments_update" ON public.departments;
  DROP POLICY IF EXISTS "departments_delete" ON public.departments;

  CREATE POLICY "departments_select" ON public.departments FOR SELECT USING (auth.uid() IS NOT NULL);
  CREATE POLICY "departments_insert" ON public.departments FOR INSERT WITH CHECK (public.is_finance_user());
  CREATE POLICY "departments_update" ON public.departments FOR UPDATE USING (public.is_finance_user());
  CREATE POLICY "departments_delete" ON public.departments FOR DELETE USING (public.is_admin());
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- FK on outflow_transactions
ALTER TABLE public.outflow_transactions
  ADD COLUMN IF NOT EXISTS department_id uuid REFERENCES departments(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_outflow_department_id ON public.outflow_transactions(department_id);

-- ── Organisation deletion lifecycle (migration 20260602000001) ────────────────
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'pending_deletion')),
  ADD COLUMN IF NOT EXISTS deleted_at            timestamptz,
  ADD COLUMN IF NOT EXISTS purge_at              timestamptz,
  ADD COLUMN IF NOT EXISTS deletion_requested_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS deletion_backup_path  text;

CREATE INDEX IF NOT EXISTS idx_organizations_status   ON public.organizations(status);
CREATE INDEX IF NOT EXISTS idx_organizations_purge_at ON public.organizations(purge_at);

ALTER TABLE public.audit_log
  ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_audit_log_org_id ON public.audit_log(org_id);

CREATE TABLE IF NOT EXISTS public.org_deletion_backups (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  created_by       uuid        REFERENCES public.profiles(id) ON DELETE SET NULL,
  backup_path      text        NOT NULL,
  file_size_bytes  bigint,
  status           text        NOT NULL DEFAULT 'available'
                               CHECK (status IN ('generating', 'available', 'expired', 'failed')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  expires_at       timestamptz NOT NULL
);
ALTER TABLE public.org_deletion_backups ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "del_backup_owner_select" ON public.org_deletion_backups;
DO $$ BEGIN
  CREATE POLICY "del_backup_owner_select" ON public.org_deletion_backups
    FOR SELECT USING (
      EXISTS (
        SELECT 1 FROM public.org_members
        WHERE org_id  = org_deletion_backups.org_id
          AND user_id = auth.uid()
          AND role    = 'owner'
          AND status  = 'active'
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "del_backup_rpc_insert" ON public.org_deletion_backups
    FOR INSERT WITH CHECK (false);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "del_backup_owner_delete" ON public.org_deletion_backups
    FOR DELETE USING (
      EXISTS (
        SELECT 1 FROM public.org_members
        WHERE org_id  = org_deletion_backups.org_id
          AND user_id = auth.uid()
          AND role    = 'owner'
          AND status  = 'active'
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Invitation emails audit log ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.invitation_emails (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  invitation_id uuid        NOT NULL REFERENCES public.invitations(id) ON DELETE CASCADE,
  email         text        NOT NULL,
  status        text        NOT NULL CHECK (status IN ('sent', 'failed')),
  error_msg     text,
  resend_id     text,
  sent_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_invitation_emails_invitation
  ON public.invitation_emails(invitation_id);

CREATE INDEX IF NOT EXISTS idx_invitation_emails_sent_at
  ON public.invitation_emails(sent_at DESC);

ALTER TABLE public.invitation_emails ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "invitation_emails_admin_read"
    ON public.invitation_emails FOR SELECT
    USING (is_admin());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

NOTIFY pgrst, 'reload schema';

-- ── LB-2/E-C2: Atomic FX Conversion RPC ──────────────────────────────────────
-- Replaces 3 sequential client-side inserts with one Postgres transaction.
-- Any failure rolls back fx_transactions + inflow_transactions + fx_conversions.
CREATE OR REPLACE FUNCTION public.perform_fx_conversion(
  p_org_id               uuid,
  p_user_id              uuid,
  p_date                 date,
  p_fx_currency          text,
  p_fx_amount            numeric,
  p_exchange_rate        numeric,
  p_naira_amount         numeric,
  p_bank_name            text,
  p_base_currency        text DEFAULT 'NGN',
  p_notes                text DEFAULT NULL,
  p_allocation_config_id uuid DEFAULT NULL,
  p_stage_code_1         text DEFAULT NULL,
  p_stage_code_2         text DEFAULT 'Percentage Allocation'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
AS $func$
DECLARE
  v_prev_balance  numeric(15,4);
  v_new_balance   numeric(15,4);
  v_fx_tx_id      uuid;
  v_inflow_id     uuid;
  v_conversion_id uuid;
BEGIN
  IF p_org_id IS NULL THEN
    RAISE EXCEPTION 'org_id is required';
  END IF;
  IF p_bank_name IS NULL OR trim(p_bank_name) = '' THEN
    RAISE EXCEPTION 'bank_name is required for FX conversion inflows';
  END IF;
  IF p_fx_amount <= 0 THEN
    RAISE EXCEPTION 'fx_amount must be positive';
  END IF;
  IF p_exchange_rate <= 0 THEN
    RAISE EXCEPTION 'exchange_rate must be positive';
  END IF;

  SELECT COALESCE(running_balance, 0)
  INTO   v_prev_balance
  FROM   public.fx_transactions
  WHERE  org_id   = p_org_id
    AND  currency = p_fx_currency
  ORDER  BY date DESC, created_at DESC
  LIMIT  1;

  v_prev_balance := COALESCE(v_prev_balance, 0);
  v_new_balance  := v_prev_balance - p_fx_amount;

  INSERT INTO public.fx_transactions (
    date, currency, withdrawal, deposit, running_balance,
    narration, created_by, org_id
  ) VALUES (
    p_date, p_fx_currency, p_fx_amount, 0, v_new_balance,
    COALESCE(p_notes, 'Converted to ' || p_base_currency || ' @ ' || p_exchange_rate::text),
    p_user_id, p_org_id
  )
  RETURNING id INTO v_fx_tx_id;

  INSERT INTO public.inflow_transactions (
    date, amount, description, bank_name,
    stage_code_1, stage_code_2, allocation_config_id,
    fx_currency, fx_amount, fx_rate,
    transaction_type, created_by, org_id
  ) VALUES (
    p_date, p_naira_amount,
    COALESCE(p_notes, 'FX Conversion: ' || p_fx_currency || ' → ' || p_base_currency),
    p_bank_name, p_stage_code_1,
    COALESCE(p_stage_code_2, 'Percentage Allocation'),
    p_allocation_config_id, p_fx_currency, p_fx_amount, p_exchange_rate,
    'fx_conversion', p_user_id, p_org_id
  )
  RETURNING id INTO v_inflow_id;

  INSERT INTO public.fx_conversions (
    date, fx_currency, fx_amount, exchange_rate, naira_amount,
    fx_withdrawal_id, naira_inflow_id, notes,
    allocation_config_id, is_partial, created_by, org_id
  ) VALUES (
    p_date, p_fx_currency, p_fx_amount, p_exchange_rate, p_naira_amount,
    v_fx_tx_id, v_inflow_id, p_notes,
    p_allocation_config_id, (p_fx_amount < v_prev_balance),
    p_user_id, p_org_id
  )
  RETURNING id INTO v_conversion_id;

  RETURN jsonb_build_object(
    'fx_transaction_id', v_fx_tx_id,
    'inflow_id',         v_inflow_id,
    'conversion_id',     v_conversion_id
  );

EXCEPTION
  WHEN OTHERS THEN RAISE;
END;
$func$;

GRANT EXECUTE ON FUNCTION public.perform_fx_conversion(
  uuid, uuid, date, text, numeric, numeric, numeric, text, text, text, uuid, text, text
) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ── LB-8 / E-H6: Block NaN and negative amounts in category_opening_balances ──
DELETE FROM public.category_opening_balances
  WHERE amount < 0 OR amount = 'NaN'::numeric;
DO $$ BEGIN
  ALTER TABLE public.category_opening_balances
    ADD CONSTRAINT cob_amount_valid
    CHECK (amount >= 0 AND amount != 'NaN'::numeric);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── FX Conversion Management ──────────────────────────────────────────────────
-- A. Updated perform_fx_conversion: add advisory lock before running balance SELECT
CREATE OR REPLACE FUNCTION public.perform_fx_conversion(
  p_org_id               uuid,
  p_user_id              uuid,
  p_date                 date,
  p_fx_currency          text,
  p_fx_amount            numeric,
  p_exchange_rate        numeric,
  p_naira_amount         numeric,
  p_bank_name            text,
  p_base_currency        text DEFAULT 'NGN',
  p_notes                text DEFAULT NULL,
  p_allocation_config_id uuid DEFAULT NULL,
  p_stage_code_1         text DEFAULT NULL,
  p_stage_code_2         text DEFAULT 'Percentage Allocation'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_prev_balance  numeric(15,4);
  v_new_balance   numeric(15,4);
  v_fx_tx_id      uuid;
  v_inflow_id     uuid;
  v_conversion_id uuid;
BEGIN
  IF p_org_id IS NULL THEN
    RAISE EXCEPTION 'org_id is required';
  END IF;
  IF p_bank_name IS NULL OR trim(p_bank_name) = '' THEN
    RAISE EXCEPTION 'bank_name is required for FX conversion inflows';
  END IF;
  IF p_fx_amount <= 0 THEN
    RAISE EXCEPTION 'fx_amount must be positive';
  END IF;
  IF p_exchange_rate <= 0 THEN
    RAISE EXCEPTION 'exchange_rate must be positive';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(p_org_id::text), hashtext(p_fx_currency));

  SELECT COALESCE(running_balance, 0)
  INTO   v_prev_balance
  FROM   public.fx_transactions
  WHERE  org_id   = p_org_id
    AND  currency = p_fx_currency
  ORDER  BY date DESC, created_at DESC
  LIMIT  1;

  v_prev_balance := COALESCE(v_prev_balance, 0);
  v_new_balance  := v_prev_balance - p_fx_amount;

  INSERT INTO public.fx_transactions (
    date, currency, withdrawal, deposit, running_balance,
    narration, created_by, org_id
  ) VALUES (
    p_date, p_fx_currency, p_fx_amount, 0, v_new_balance,
    COALESCE(p_notes, 'Converted to ' || p_base_currency || ' @ ' || p_exchange_rate::text),
    p_user_id, p_org_id
  )
  RETURNING id INTO v_fx_tx_id;

  INSERT INTO public.inflow_transactions (
    date, amount, description, bank_name,
    stage_code_1, stage_code_2, allocation_config_id,
    fx_currency, fx_amount, fx_rate,
    transaction_type, created_by, org_id
  ) VALUES (
    p_date, p_naira_amount,
    COALESCE(p_notes, 'FX Conversion: ' || p_fx_currency || ' → ' || p_base_currency),
    p_bank_name, p_stage_code_1,
    COALESCE(p_stage_code_2, 'Percentage Allocation'),
    p_allocation_config_id, p_fx_currency, p_fx_amount, p_exchange_rate,
    'fx_conversion', p_user_id, p_org_id
  )
  RETURNING id INTO v_inflow_id;

  INSERT INTO public.fx_conversions (
    date, fx_currency, fx_amount, exchange_rate, naira_amount,
    fx_withdrawal_id, naira_inflow_id, notes,
    allocation_config_id, is_partial, created_by, org_id
  ) VALUES (
    p_date, p_fx_currency, p_fx_amount, p_exchange_rate, p_naira_amount,
    v_fx_tx_id, v_inflow_id, p_notes,
    p_allocation_config_id, (p_fx_amount < v_prev_balance),
    p_user_id, p_org_id
  )
  RETURNING id INTO v_conversion_id;

  RETURN jsonb_build_object(
    'fx_transaction_id', v_fx_tx_id,
    'inflow_id',         v_inflow_id,
    'conversion_id',     v_conversion_id
  );

EXCEPTION
  WHEN OTHERS THEN RAISE;
END;
$$;

-- B. update_fx_conversion RPC
CREATE OR REPLACE FUNCTION public.update_fx_conversion(
  p_conversion_id        uuid,
  p_org_id               uuid,
  p_user_id              uuid,
  p_exchange_rate        numeric,
  p_naira_amount         numeric,
  p_notes                text,
  p_allocation_config_id uuid,
  p_stage_code_1         text,
  p_stage_code_2         text,
  p_bank_name            text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE v_conv RECORD; BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.org_members WHERE org_id = p_org_id AND user_id = auth.uid() AND role IN ('owner','admin') AND status = 'active') THEN
    RAISE EXCEPTION 'Only admins and owners can edit FX conversions';
  END IF;
  SELECT * INTO v_conv FROM public.fx_conversions WHERE id = p_conversion_id AND org_id = p_org_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'FX conversion not found'; END IF;
  UPDATE public.fx_conversions SET
    exchange_rate = p_exchange_rate, naira_amount = p_naira_amount,
    notes = p_notes, allocation_config_id = p_allocation_config_id
  WHERE id = p_conversion_id;
  IF v_conv.naira_inflow_id IS NOT NULL THEN
    UPDATE public.inflow_transactions SET
      amount = p_naira_amount, fx_rate = p_exchange_rate,
      description = COALESCE(p_notes, description),
      allocation_config_id = p_allocation_config_id,
      stage_code_1 = p_stage_code_1, stage_code_2 = p_stage_code_2,
      bank_name = p_bank_name
    WHERE id = v_conv.naira_inflow_id;
  END IF;
  IF v_conv.fx_withdrawal_id IS NOT NULL AND p_notes IS NOT NULL THEN
    UPDATE public.fx_transactions SET narration = p_notes WHERE id = v_conv.fx_withdrawal_id;
  END IF;
  RETURN jsonb_build_object('conversion_id', p_conversion_id, 'inflow_id', v_conv.naira_inflow_id, 'fx_tx_id', v_conv.fx_withdrawal_id);
END; $$;
GRANT EXECUTE ON FUNCTION public.update_fx_conversion(uuid,uuid,uuid,numeric,numeric,text,uuid,text,text,text) TO authenticated;

-- C. revert_fx_conversion RPC
CREATE OR REPLACE FUNCTION public.revert_fx_conversion(
  p_conversion_id uuid,
  p_org_id        uuid,
  p_user_id       uuid
)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE
  v_conv    RECORD;
  v_fx_date date;
  v_fx_ts   timestamptz;
  v_fx_amt  numeric;
  v_ccy     text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.org_members WHERE org_id = p_org_id AND user_id = auth.uid() AND role IN ('owner','admin') AND status = 'active') THEN
    RAISE EXCEPTION 'Only admins and owners can revert FX conversions';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext(p_org_id::text), hashtext(
    (SELECT fx_currency FROM public.fx_conversions WHERE id = p_conversion_id AND org_id = p_org_id)
  ));
  SELECT * INTO v_conv FROM public.fx_conversions WHERE id = p_conversion_id AND org_id = p_org_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'FX conversion not found'; END IF;
  v_ccy    := v_conv.fx_currency;
  v_fx_amt := v_conv.fx_amount;
  IF v_conv.fx_withdrawal_id IS NOT NULL THEN
    SELECT date, created_at INTO v_fx_date, v_fx_ts
    FROM public.fx_transactions WHERE id = v_conv.fx_withdrawal_id;
    DELETE FROM public.fx_transactions WHERE id = v_conv.fx_withdrawal_id;
    UPDATE public.fx_transactions
    SET running_balance = running_balance + v_fx_amt
    WHERE org_id = p_org_id AND currency = v_ccy
      AND (date > v_fx_date OR (date = v_fx_date AND created_at > v_fx_ts));
  END IF;
  IF v_conv.naira_inflow_id IS NOT NULL THEN
    DELETE FROM public.inflow_transactions WHERE id = v_conv.naira_inflow_id;
  END IF;
  DELETE FROM public.fx_conversions WHERE id = p_conversion_id;
  RETURN jsonb_build_object(
    'reverted_conversion_id', p_conversion_id,
    'fx_tx_deleted', v_conv.fx_withdrawal_id,
    'inflow_deleted', v_conv.naira_inflow_id
  );
END; $$;
GRANT EXECUTE ON FUNCTION public.revert_fx_conversion(uuid,uuid,uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ── FX category currency ──────────────────────────────────────────────────────
ALTER TABLE public.categories ADD COLUMN IF NOT EXISTS currency text;

NOTIFY pgrst, 'reload schema';

-- ── Transaction offset linking ────────────────────────────────────────────────
-- Adds generic offset-linking architecture to inflow_transactions and
-- outflow_transactions. Supports reversal, refund, bank_deposit, and
-- intra_bank_transfer relationship types without double-counting balances.
-- Safe on existing data: all new columns are nullable. Existing rows are
-- unaffected — NULL offset_role is treated identically to 'root' everywhere.

ALTER TABLE public.inflow_transactions
  ADD COLUMN IF NOT EXISTS root_transaction_id    text,
  ADD COLUMN IF NOT EXISTS root_transaction_table text,
  ADD COLUMN IF NOT EXISTS offset_link_type       text,
  ADD COLUMN IF NOT EXISTS offset_role            text;

DO $$ BEGIN
  ALTER TABLE public.inflow_transactions
    ADD CONSTRAINT inflow_offset_role_check
    CHECK (offset_role IN ('root', 'offset'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE public.outflow_transactions
  ADD COLUMN IF NOT EXISTS root_transaction_id    text,
  ADD COLUMN IF NOT EXISTS root_transaction_table text,
  ADD COLUMN IF NOT EXISTS offset_link_type       text,
  ADD COLUMN IF NOT EXISTS offset_role            text;

DO $$ BEGIN
  ALTER TABLE public.outflow_transactions
    ADD CONSTRAINT outflow_offset_role_check
    CHECK (offset_role IN ('root', 'offset'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_inflow_root_txn_id
  ON public.inflow_transactions(root_transaction_id)
  WHERE root_transaction_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_outflow_root_txn_id
  ON public.outflow_transactions(root_transaction_id)
  WHERE root_transaction_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_inflow_offset_role
  ON public.inflow_transactions(offset_role)
  WHERE offset_role IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_outflow_offset_role
  ON public.outflow_transactions(offset_role)
  WHERE offset_role IS NOT NULL;

-- Anti-chaining trigger: prevents offset->offset links (no recursive chains).
-- An offset transaction's root_transaction_id must point to a root (or NULL role)
-- transaction, never to another offset.
CREATE OR REPLACE FUNCTION public.prevent_offset_chaining()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.offset_role = 'offset' AND NEW.root_transaction_id IS NOT NULL THEN
    IF NEW.root_transaction_table = 'inflow_transactions' THEN
      IF EXISTS (
        SELECT 1 FROM public.inflow_transactions
        WHERE id::text = NEW.root_transaction_id AND offset_role = 'offset'
      ) THEN
        RAISE EXCEPTION 'offset_chaining_not_allowed: root transaction is itself an offset';
      END IF;
    ELSIF NEW.root_transaction_table = 'outflow_transactions' THEN
      IF EXISTS (
        SELECT 1 FROM public.outflow_transactions
        WHERE id::text = NEW.root_transaction_id AND offset_role = 'offset'
      ) THEN
        RAISE EXCEPTION 'offset_chaining_not_allowed: root transaction is itself an offset';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_inflow_offset_chaining  ON public.inflow_transactions;
CREATE TRIGGER trg_prevent_inflow_offset_chaining
  BEFORE INSERT OR UPDATE ON public.inflow_transactions
  FOR EACH ROW EXECUTE FUNCTION public.prevent_offset_chaining();

DROP TRIGGER IF EXISTS trg_prevent_outflow_offset_chaining ON public.outflow_transactions;
CREATE TRIGGER trg_prevent_outflow_offset_chaining
  BEFORE INSERT OR UPDATE ON public.outflow_transactions
  FOR EACH ROW EXECUTE FUNCTION public.prevent_offset_chaining();

NOTIFY pgrst, 'reload schema';

-- ── Reconciliation Center tables ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.reconciliation_runs (
  id             uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  run_at         timestamptz NOT NULL DEFAULT now(),
  issue_count    int         NOT NULL DEFAULT 0,
  critical_count int         NOT NULL DEFAULT 0,
  warning_count  int         NOT NULL DEFAULT 0,
  info_count     int         NOT NULL DEFAULT 0,
  health_status  text        NOT NULL CHECK (health_status IN ('healthy','warning','critical')),
  run_by         uuid        REFERENCES public.profiles(id),
  issues_json    jsonb       NOT NULL DEFAULT '[]',
  org_id         uuid        NOT NULL DEFAULT public.get_current_org_id()
                 REFERENCES public.organizations(id) ON DELETE SET NULL
);
ALTER TABLE public.reconciliation_runs ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "recon_runs_select" ON public.reconciliation_runs FOR SELECT USING (org_id = public.get_current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "recon_runs_insert" ON public.reconciliation_runs FOR INSERT WITH CHECK (public.is_finance_user());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS idx_recon_runs_org_at ON public.reconciliation_runs(org_id, run_at DESC);

CREATE TABLE IF NOT EXISTS public.bank_statement_balances (
  id                uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  bank_name         text        NOT NULL,
  bank_id           uuid        REFERENCES public.banks(id) ON DELETE SET NULL,
  reference_balance numeric(15,2) NOT NULL,
  statement_date    date        NOT NULL,
  notes             text,
  entered_by        uuid        REFERENCES public.profiles(id),
  org_id            uuid        NOT NULL DEFAULT public.get_current_org_id()
                    REFERENCES public.organizations(id) ON DELETE SET NULL,
  created_at        timestamptz DEFAULT now(),
  UNIQUE (org_id, bank_name)
);
ALTER TABLE public.bank_statement_balances ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "bsb_select" ON public.bank_statement_balances FOR SELECT USING (org_id = public.get_current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "bsb_insert" ON public.bank_statement_balances FOR INSERT WITH CHECK (public.is_finance_user());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "bsb_update" ON public.bank_statement_balances FOR UPDATE USING (public.is_finance_user());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "bsb_delete" ON public.bank_statement_balances FOR DELETE USING (public.is_admin());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS idx_bsb_org_bank ON public.bank_statement_balances(org_id, bank_name);

NOTIFY pgrst, 'reload schema';`

// ── Income Types tab ───────────────────────────────────────────────────────────────────

function IncomeTypesTab({ onAdd, onEdit, onDelete }: {
  onAdd:    () => void
  onEdit:   (t: IncomeType) => void
  onDelete: (t: IncomeType) => void
}) {
  const { incomeTypes, loading, error } = useIncomeTypes()
  const [search, setSearch] = useState('')
  const [sort,   setSort]   = useState('name|asc')

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    const filtered = q
      ? incomeTypes.filter(t => [t.name, t.description ?? ''].some(v => v.toLowerCase().includes(q)))
      : incomeTypes
    return applySetupSort(filtered, sort)
  }, [incomeTypes, search, sort])

  if (loading) return (
    <div className="max-w-2xl space-y-2">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="h-14 bg-gray-100 rounded-xl animate-pulse" />
      ))}
    </div>
  )

  if (error && !/income_types|relation.*does not exist/i.test(error)) return (
    <div className="flex items-start gap-3 rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700 max-w-2xl">
      <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />{error}
    </div>
  )

  return (
    <div className="max-w-2xl space-y-4">
      {/* Migration hint */}
      {error && /income_types|relation.*does not exist/i.test(error) && (
        <div className="flex items-start gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>The <code className="font-mono text-xs">income_types</code> table doesn't exist yet. Add an income type to see the migration SQL.</span>
        </div>
      )}

      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-gray-500">Define custom income types with auto-recognition rules.</p>
        <button
          onClick={onAdd}
          className="shrink-0 flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary-light transition-colors"
        >
          <Plus className="w-4 h-4" /> Add Income Type
        </button>
      </div>

      {incomeTypes.length === 0 && !error ? (
        <div className="py-12 flex flex-col items-center gap-3 text-gray-400 border border-dashed border-gray-200 rounded-xl">
          <Layers className="w-10 h-10 text-gray-200" />
          <p className="text-sm">No income types yet. Add one to get started.</p>
        </div>
      ) : (
        <>
          <SetupSearchSort search={search} onSearch={setSearch} sort={sort} onSort={setSort} sortOptions={TYPE_SORT_OPTS} placeholder="Search income types…" />
          {visible.length === 0 ? (
            <p className="py-8 text-center text-sm text-gray-400">No income types match your search.</p>
          ) : (
            <div className="space-y-2">
              {visible.map(t => (
                <div key={t.id} className="flex items-start gap-3 bg-white border border-gray-100 rounded-xl px-4 py-3 hover:shadow-sm transition-shadow">
                  <div className="w-3 h-3 rounded-full mt-1 shrink-0" style={{ backgroundColor: t.color }} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900">{t.name}</p>
                    {t.description && <p className="text-xs text-gray-500 mt-0.5">{t.description}</p>}
                    {t.rules.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {t.rules.map(r => (
                          <span key={r.id} className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-600">
                            <span className="text-gray-400">{r.rule_type === 'keyword' ? 'kw:' : 'sc:'}</span>
                            {r.rule_value}
                          </span>
                        ))}
                      </div>
                    )}
                    {t.special_config_name && (
                      <p className="text-[11px] text-primary mt-1">↳ Auto-applies: {t.special_config_name}</p>
                    )}
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <button onClick={() => onEdit(t)} className="p-1.5 rounded-lg text-gray-400 hover:text-primary hover:bg-primary/10 transition-colors">
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button onClick={() => onDelete(t)} className="p-1.5 rounded-lg text-gray-400 hover:text-danger hover:bg-red-50 transition-colors">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
          <p className="text-xs text-gray-400">
            {visible.length !== incomeTypes.length
              ? `${visible.length} of ${incomeTypes.length} income types`
              : `${incomeTypes.length} income type${incomeTypes.length !== 1 ? 's' : ''}`}
          </p>
        </>
      )}
    </div>
  )
}

// ── Outflow Types tab ──────────────────────────────────────────────────────────────────

function OutflowTypesTab({ onAdd, onEdit, onDelete }: {
  onAdd:    () => void
  onEdit:   (t: OutflowType) => void
  onDelete: (t: OutflowType) => void
}) {
  const { outflowTypes, loading, error } = useOutflowTypes()
  const { maps }                         = useCategoryOutflowTypeMaps()
  const { categories }                   = useCategories()
  const [search, setSearch] = useState('')
  const [sort,   setSort]   = useState('name|asc')

  const typeToCategories = useMemo(() => {
    const m = new Map<string, string[]>()
    for (const map of maps) {
      const catName = categories.find(c => c.id === map.category_id)?.name
      if (!catName) continue
      m.set(map.outflow_type_id, [...(m.get(map.outflow_type_id) ?? []), catName])
    }
    return m
  }, [maps, categories])

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    const filtered = q ? outflowTypes.filter(t => t.name.toLowerCase().includes(q)) : outflowTypes
    return applySetupSort(filtered, sort)
  }, [outflowTypes, search, sort])

  if (loading) return (
    <div className="max-w-2xl space-y-2">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="h-14 bg-gray-100 rounded-xl animate-pulse" />
      ))}
    </div>
  )

  const isTableMissing = !!error && /relation.*does not exist|could not find the 'outflow_types' relation/i.test(error)
  const isCacheStale   = !!error && !isTableMissing && /could not find the '.*' column of 'outflow_types'/i.test(error)

  if (error && !isTableMissing && !isCacheStale) return (
    <div className="flex items-start gap-3 rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700 max-w-2xl">
      <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />{error}
    </div>
  )

  return (
    <div className="max-w-2xl space-y-4">
      {isTableMissing && (
        <div className="flex items-start gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>The <code className="font-mono text-xs">outflow_types</code> table doesn't exist yet. Please contact your administrator to apply the required database migration.</span>
        </div>
      )}
      {isCacheStale && (
        <div className="flex items-start gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>PostgREST schema cache is stale. Run <code className="font-mono text-xs">NOTIFY pgrst, 'reload schema';</code> in your Supabase SQL editor, then refresh this page.</span>
        </div>
      )}

      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-gray-500">Outflow types for reporting and expense classification. Does not affect balances or allocations.</p>
        <button
          onClick={onAdd}
          className="shrink-0 flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary-light transition-colors"
        >
          <Plus className="w-4 h-4" /> Add Outflow Type
        </button>
      </div>

      {outflowTypes.length === 0 && !error ? (
        <div className="py-12 flex flex-col items-center gap-3 text-gray-400 border border-dashed border-gray-200 rounded-xl">
          <Layers className="w-10 h-10 text-gray-200" />
          <p className="text-sm">No outflow types yet. Add one to classify expense purposes.</p>
          <p className="text-xs text-center text-gray-300 max-w-xs">Examples: Medical, Transport, Utilities, Salaries, Events</p>
        </div>
      ) : (
        <>
          <SetupSearchSort search={search} onSearch={setSearch} sort={sort} onSort={setSort} sortOptions={TYPE_SORT_OPTS} placeholder="Search outflow types…" />
          {visible.length === 0 ? (
            <p className="py-8 text-center text-sm text-gray-400">No outflow types match your search.</p>
          ) : (
            <div className="space-y-2">
              {visible.map(t => {
                const linkedCats = typeToCategories.get(t.id) ?? []
                const isStandalone = !t.is_system && linkedCats.length === 0
                return (
                  <div key={t.id} className="flex items-start gap-3 bg-white border border-gray-100 rounded-xl px-4 py-3 hover:shadow-sm transition-shadow">
                    <div className="w-3 h-3 rounded-full shrink-0 mt-0.5" style={{ backgroundColor: t.color }} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-medium text-gray-900">{t.name}</p>
                        {t.is_system && (
                          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700">System</span>
                        )}
                        {!t.is_system && linkedCats.length > 0 && (
                          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-green-100 text-green-700">Linked Category</span>
                        )}
                        {isStandalone && (
                          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500">Standalone</span>
                        )}
                      </div>
                      {linkedCats.length > 0 && (
                        <p className="text-xs text-gray-400 mt-0.5 truncate">↳ {linkedCats.join(', ')}</p>
                      )}
                    </div>
                    <div className="flex gap-1 shrink-0">
                      {t.is_locked ? (
                        <span className="p-1.5 text-gray-300" title="System type — cannot be edited or deleted">
                          <Lock className="w-4 h-4" />
                        </span>
                      ) : (
                        <>
                          <button onClick={() => onEdit(t)} className="p-1.5 rounded-lg text-gray-400 hover:text-primary hover:bg-primary/10 transition-colors">
                            <Pencil className="w-4 h-4" />
                          </button>
                          <button onClick={() => onDelete(t)} className="p-1.5 rounded-lg text-gray-400 hover:text-danger hover:bg-red-50 transition-colors">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
          <p className="text-xs text-gray-400">
            {visible.length !== outflowTypes.length
              ? `${visible.length} of ${outflowTypes.length} outflow types`
              : `${outflowTypes.length} outflow type${outflowTypes.length !== 1 ? 's' : ''}`}
          </p>
        </>
      )}
    </div>
  )
}

// ── Departments tab ───────────────────────────────────────────────────────────────────

function DepartmentsTab({ onAdd, onEdit, onDelete }: {
  onAdd:    () => void
  onEdit:   (d: Department) => void
  onDelete: (d: Department) => void
}) {
  const { departments, loading, error } = useDepartments()
  const [search, setSearch] = useState('')
  const [sort,   setSort]   = useState('name|asc')

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    const filtered = q
      ? departments.filter(d => [d.name, d.code ?? '', d.description ?? ''].some(v => v.toLowerCase().includes(q)))
      : departments
    return applySetupSort(filtered, sort)
  }, [departments, search, sort])

  if (loading) return (
    <div className="max-w-2xl space-y-2">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="h-14 bg-gray-100 rounded-xl animate-pulse" />
      ))}
    </div>
  )

  const isTableMissing = !!error && /relation.*does not exist|could not find the 'departments' relation/i.test(error)

  if (error && !isTableMissing) return (
    <div className="flex items-start gap-3 rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700 max-w-2xl">
      <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />{error}
    </div>
  )

  return (
    <div className="max-w-2xl space-y-4">
      {isTableMissing && (
        <div className="flex items-start gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>The <code className="font-mono text-xs">departments</code> table doesn't exist yet. Please contact your administrator to apply the required database migration.</span>
        </div>
      )}

      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-gray-500">Departments and units for outflow tracking. Does not affect balances or allocations.</p>
        <button
          onClick={onAdd}
          className="shrink-0 flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary-light transition-colors"
        >
          <Plus className="w-4 h-4" /> Add Department
        </button>
      </div>

      {departments.length === 0 && !error ? (
        <div className="py-12 flex flex-col items-center gap-3 text-gray-400 border border-dashed border-gray-200 rounded-xl">
          <Layers className="w-10 h-10 text-gray-200" />
          <p className="text-sm">No departments yet. Add one to track spending by unit.</p>
          <p className="text-xs text-center text-gray-300 max-w-xs">Examples: Finance, Administration, Welfare, Youth, Media</p>
        </div>
      ) : (
        <>
          <SetupSearchSort search={search} onSearch={setSearch} sort={sort} onSort={setSort} sortOptions={TYPE_SORT_OPTS} placeholder="Search departments…" />
          {visible.length === 0 ? (
            <p className="py-8 text-center text-sm text-gray-400">No departments match your search.</p>
          ) : (
            <div className="space-y-2">
              {visible.map(d => (
                <div key={d.id} className="flex items-start gap-3 bg-white border border-gray-100 rounded-xl px-4 py-3 hover:shadow-sm transition-shadow">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-medium text-gray-900">{d.name}</p>
                      {d.code && (
                        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700 font-mono">{d.code}</span>
                      )}
                      {!d.active && (
                        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500">Inactive</span>
                      )}
                    </div>
                    {d.description && (
                      <p className="text-xs text-gray-400 mt-0.5 truncate">{d.description}</p>
                    )}
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <button onClick={() => onEdit(d)} className="p-1.5 rounded-lg text-gray-400 hover:text-primary hover:bg-primary/10 transition-colors">
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button onClick={() => onDelete(d)} className="p-1.5 rounded-lg text-gray-400 hover:text-danger hover:bg-red-50 transition-colors">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
          <p className="text-xs text-gray-400">
            {visible.length !== departments.length
              ? `${visible.length} of ${departments.length} departments`
              : `${departments.length} department${departments.length !== 1 ? 's' : ''}`}
          </p>
        </>
      )}
    </div>
  )
}

function DatabaseTab() {
  const [copied, setCopied] = useState(false)
  const { push: toast } = useToastStore()

  const [backfilling, setBackfilling] = useState(false)
  const [backfillResult, setBackfillResult] = useState<{ inflows: number; outflows: number } | null>(null)
  const [backfillingCharge, setBackfillingCharge] = useState(false)
  const [backfillChargeResult, setBackfillChargeResult] = useState<number | null>(null)

  const handleCopy = async () => {
    await navigator.clipboard.writeText(MIGRATION_SQL)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const runBackfill = async () => {
    setBackfilling(true)
    setBackfillResult(null)
    try {
      const [{ data: inflows }, { data: outflows }] = await Promise.all([
        supabase.from('inflow_transactions').select('id, date, amount, description, bank_name').is('transaction_ref', null),
        supabase.from('outflow_transactions').select('id, date, amount_disbursed, description, bank_description, bank_name').is('transaction_id', null),
      ])

      let inflowCount = 0
      for (const row of inflows ?? []) {
        const ref = await generateFallbackTransactionId(
          row.date,
          String(row.amount),
          row.description ?? '',
          row.bank_name ?? '',
        )
        await supabase.from('inflow_transactions').update({ transaction_ref: ref }).eq('id', row.id)
        inflowCount++
      }

      let outflowCount = 0
      for (const row of outflows ?? []) {
        const id = await generateFallbackTransactionId(
          row.date,
          String(row.amount_disbursed),
          row.description ?? row.bank_description ?? '',
          row.bank_name ?? '',
        )
        await supabase.from('outflow_transactions').update({ transaction_id: id }).eq('id', row.id)
        outflowCount++
      }

      setBackfillResult({ inflows: inflowCount, outflows: outflowCount })
      toast(`Backfilled ${inflowCount} inflows and ${outflowCount} outflows`, 'success')
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Backfill failed', 'error')
    } finally {
      setBackfilling(false)
    }
  }

  const runChargeBackfill = async () => {
    setBackfillingCharge(true)
    setBackfillChargeResult(null)
    try {
      // Matches the same patterns used in ImportModal during ID generation
      const HASH_RE = /^[0-9a-f]{64}(-\d+)?$/i
      const COMM_RE = /^COMM(?:ISSION)?\b/i
      const VAT_RE  = /^VAT\b/i

      const { data, error } = await supabase
        .from('outflow_transactions')
        .select('id, transaction_id, description')
        .or('description.ilike.COMM%,description.ilike.VAT%')
        .not('transaction_id', 'is', null)
        .limit(5000)

      if (error) throw error

      let count = 0
      for (const row of data ?? []) {
        const txnId = row.transaction_id as string
        const desc  = (row.description as string) ?? ''
        if (txnId.endsWith('-comm') || txnId.endsWith('-vat')) continue
        if (HASH_RE.test(txnId)) continue
        const suffix = COMM_RE.test(desc) ? '-comm' : VAT_RE.test(desc) ? '-vat' : null
        if (!suffix) continue
        const { error: updateErr } = await supabase
          .from('outflow_transactions')
          .update({ transaction_id: txnId + suffix })
          .eq('id', row.id)
        if (!updateErr) count++
      }

      setBackfillChargeResult(count)
      toast(
        count > 0
          ? `Updated ${count} charge row${count !== 1 ? 's' : ''}`
          : 'No rows needed updating',
        'success',
      )
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Backfill failed', 'error')
    } finally {
      setBackfillingCharge(false)
    }
  }

  return (
    <div className="max-w-3xl space-y-5">
      {/* Backfill Transaction IDs */}
      <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-3">
        <div className="flex items-center gap-2">
          <Terminal className="w-5 h-5 text-primary" />
          <h2 className="text-base font-semibold text-gray-900">Backfill Transaction IDs</h2>
        </div>
        <p className="text-sm text-gray-500">
          Generates and saves fallback transaction IDs for any inflows or outflows that were saved without one.
          Safe to run multiple times — only records with a missing ID are updated.
        </p>
        {backfillResult && (
          <div className="flex items-center gap-2 rounded-lg bg-green-50 border border-green-200 px-4 py-2.5 text-sm text-green-700">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            Updated {backfillResult.inflows} inflow{backfillResult.inflows !== 1 ? 's' : ''} and {backfillResult.outflows} outflow{backfillResult.outflows !== 1 ? 's' : ''}
          </div>
        )}
        <button
          type="button"
          onClick={runBackfill}
          disabled={backfilling}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary-light transition-colors disabled:opacity-60"
        >
          {backfilling && <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
          {backfilling ? 'Backfilling…' : 'Run Backfill'}
        </button>
      </div>

      {/* Backfill Bank Charge IDs (COMM/VAT) */}
      <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-3">
        <div className="flex items-center gap-2">
          <Terminal className="w-5 h-5 text-primary" />
          <h2 className="text-base font-semibold text-gray-900">Backfill Bank Charge IDs</h2>
        </div>
        <p className="text-sm text-gray-500">
          Appends{' '}
          <code className="font-mono text-xs bg-gray-100 px-1 rounded">-comm</code> or{' '}
          <code className="font-mono text-xs bg-gray-100 px-1 rounded">-vat</code> to the{' '}
          <code className="font-mono text-xs bg-gray-100 px-1 rounded">transaction_id</code> of existing COMM/COMMISSION
          and VAT outflow rows that share a reference ID with their parent transaction. Safe to run multiple times —
          already-tagged rows and hash-based IDs are skipped automatically.
        </p>
        {backfillChargeResult !== null && (
          <div className="flex items-center gap-2 rounded-lg bg-green-50 border border-green-200 px-4 py-2.5 text-sm text-green-700">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            {backfillChargeResult > 0
              ? `Updated ${backfillChargeResult} charge row${backfillChargeResult !== 1 ? 's' : ''}`
              : 'No rows needed updating'}
          </div>
        )}
        <button
          type="button"
          onClick={runChargeBackfill}
          disabled={backfillingCharge}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary-light transition-colors disabled:opacity-60"
        >
          {backfillingCharge && <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
          {backfillingCharge ? 'Backfilling…' : 'Run Backfill'}
        </button>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Terminal className="w-5 h-5 text-primary" />
          <h2 className="text-base font-semibold text-gray-900">Database Migration</h2>
        </div>
        <p className="text-sm text-gray-500">
          Run the following SQL in your Supabase SQL editor to add the columns and tables required for new features.
          All statements use <code className="font-mono text-xs bg-gray-100 px-1 rounded">IF NOT EXISTS</code> — safe to run multiple times.
        </p>

        <div className="rounded-xl border border-gray-200 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2 bg-gray-800 border-b border-gray-700">
            <span className="text-xs font-medium text-gray-400 font-mono">SQL</span>
            <button
              type="button"
              onClick={handleCopy}
              className="flex items-center gap-1.5 text-xs text-gray-300 hover:text-white transition-colors"
            >
              <Copy className="w-3.5 h-3.5" />
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>
          <pre className="text-xs font-mono text-gray-200 bg-gray-900 p-4 overflow-x-auto whitespace-pre leading-relaxed max-h-[500px] overflow-y-auto">
            {MIGRATION_SQL}
          </pre>
        </div>

        <div className="flex items-start gap-2 rounded-lg bg-blue-50 border border-blue-200 px-4 py-3 text-sm text-blue-700">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>
            After running this migration, enable Row Level Security on the new tables if your project uses RLS.
            Go to <strong>Supabase → Table Editor → bank_deposits / intrabank_transfers → RLS</strong> and add appropriate policies.
          </span>
        </div>
      </div>
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
  const [devToolsOpen,         setDevToolsOpen]         = useState(false)
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

        {/* Developer Tools — hidden from UI; code kept in DatabaseTab for developer reference.
             See archive/devtools-removal branch (PR #304) for full clean-up when ready. */}

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
