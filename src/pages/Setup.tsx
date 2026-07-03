import React, { useState, useEffect, useMemo } from 'react'
import { Navigate } from 'react-router-dom'
import { CalendarDays, CheckCircle2, Pencil, Trash2, Landmark, AlertCircle, Plus, Layers, Lock, LockOpen, FileEdit, Copy, ShieldAlert, ChevronDown, Search, X, Globe, Settings2, TrendingUp, TrendingDown, Users, Info, Clock, EyeOff, Eye } from 'lucide-react'
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
import { useSpecialConfigGroups, archiveGroup, restoreGroup, type SpecialConfigGroupWithVersions } from '../hooks/useSpecialConfigGroups'
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
import { friendlyError } from '../utils/friendlyError'
import { supabase } from '../lib/supabase'
import { useOrgCurrency } from '../hooks/useOrgCurrency'
import { useOrgStore } from '../store/orgStore'
import { COMMON_TIMEZONES, getOrgTimezone } from '../utils/timezones'

const TABS = ['General', 'Banks', 'Distribution Rules', 'Income Types', 'Outflow Types', 'Departments', 'Currencies'] as const
type Tab = typeof TABS[number]

const TAB_CARDS: { tab: Tab; Icon: React.FC<{ className?: string }>; label: string }[] = [
  { tab: 'General',            Icon: Settings2,    label: 'General'      },
  { tab: 'Banks',              Icon: Landmark,     label: 'Banks'        },
  { tab: 'Distribution Rules', Icon: Layers,       label: 'Distribution Rules' },
  { tab: 'Income Types',       Icon: TrendingUp,   label: 'Income Types'       },
  { tab: 'Outflow Types',      Icon: TrendingDown, label: 'Outflow Types'      },
  { tab: 'Departments',        Icon: Users,        label: 'Departments'  },
  { tab: 'Currencies',         Icon: Globe,        label: 'Currencies'   },
]

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
            <span className="text-xs text-gray-500">Unsaved change</span>
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
            <span className="text-xs text-gray-500">Unsaved change</span>
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
            <p className="text-xs text-gray-500 mt-1">Add a bank to link it to your transactions and reports.</p>
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
                  <tr className="border-b-2 border-black/[0.06] dark:border-white/[0.07]">
                    <th className="px-4 py-3 text-left text-[11px] font-bold text-gray-400 uppercase tracking-widest">Bank Name</th>
                    <th className="px-4 py-3 text-left text-[11px] font-bold text-gray-400 uppercase tracking-widest">Account Number</th>
                    <th className="px-4 py-3 text-left text-[11px] font-bold text-gray-400 uppercase tracking-widest">Type</th>
                    <th className="px-4 py-3 w-24" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-black/[0.05]">
                  {visible.map(bank => (
                    <tr key={bank.id} className="hover:bg-black/[0.02] dark:hover:bg-white/[0.03] transition-colors">
                      <td className="px-4 py-3 font-medium text-gray-900">
                        <span className="flex items-center gap-2">
                          {bank.name}
                          {bank.is_foreign_currency && (
                            <span className="px-1.5 py-0.5 text-xs font-semibold rounded bg-amber-100 text-amber-700 border border-amber-200 shrink-0">FX</span>
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
                            className="touch-target p-1.5 rounded-lg text-gray-400 hover:text-primary hover:bg-blue-50 transition-colors"
                            title="Edit" aria-label="Edit"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => onDelete(bank)}
                            className="touch-target p-1.5 rounded-lg text-gray-400 hover:text-danger hover:bg-red-50 transition-colors"
                            title="Delete" aria-label="Delete"
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
          <p className="text-xs text-gray-500">
            {visible.length !== banks.length
              ? `${visible.length} of ${banks.length} banks`
              : `${banks.length} bank${banks.length !== 1 ? 's' : ''} configured`}
          </p>
        </>
      )}
    </div>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const portionLabel = (p?: string): string => {
  if (!p || p === 'Percentage' || p === 'Percentage Allocation') return 'Regular Funds'
  return p
}

// ── General Distribution Rule panel ───────────────────────────────────────────

function GeneralGroupPanel({
  onNewVersion,
  onAmend,
  refetchKey,
}: {
  onNewVersion: (group: SpecialConfigGroupWithVersions, copyFrom: AllocationConfig | null) => void
  onAmend:      (group: SpecialConfigGroupWithVersions, version: AllocationConfig) => void
  refetchKey:   number
}) {
  const orgId = useOrgStore(s => s.orgId)
  const { baseCurrencySymbol } = useOrgCurrency()
  const [group,            setGroup]            = useState<SpecialConfigGroupWithVersions | null>(null)
  const [loading,          setLoading]          = useState(true)
  const [expanded,         setExpanded]         = useState(false)
  const [expandedVersions, setExpandedVersions] = useState<Set<string>>(new Set())
  const [pastInfoVersion,  setPastInfoVersion]  = useState<AllocationConfig | null>(null)

  const toggleVersion = (id: string) =>
    setExpandedVersions(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next })

  useEffect(() => {
    if (!orgId) return
    let cancelled = false
    const load = async () => {
      setLoading(true)
      const { data: grp } = await supabase
        .from('special_config_groups')
        .select('id, name, is_default, created_at')
        .eq('org_id', orgId)
        .eq('is_default', true)
        .maybeSingle()
      if (cancelled || !grp) { setLoading(false); return }

      const { data: versions } = await supabase
        .from('allocation_configs')
        .select('*')
        .eq('config_group_id', grp.id)
        .order('effective_from', { ascending: false })

      const today = new Date().toISOString().slice(0, 10)
      const active = (versions ?? []).find((v: AllocationConfig) =>
        v.status === 'locked' &&
        v.effective_from != null &&
        v.effective_from <= today &&
        (v.effective_to == null || v.effective_to >= today) &&
        v.superseded_by_id == null
      ) ?? null

      if (!cancelled) {
        setGroup({
          id:                      grp.id as string,
          name:                    grp.name as string,
          is_default:              true,
          is_archived:             false,
          created_at:              grp.created_at as string,
          versions:                (versions ?? []) as AllocationConfig[],
          active_version:          active as AllocationConfig | null,
          linked_income_type_id:   null,
          linked_income_type_name: null,
        })
        setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [orgId, refetchKey])

  const handleDeleteVersion = async (v: AllocationConfig) => {
    if (v.status === 'locked') { window.alert('Locked versions cannot be deleted. Create a new version to supersede it.'); return }
    if (!window.confirm(`Delete draft version #${v.version_number ?? '?'}? This cannot be undone.`)) return
    const { error: err } = await supabase.from('allocation_configs').delete().eq('id', v.id)
    if (err) { window.alert(err.message); return }
    setGroup(prev => prev ? { ...prev, versions: prev.versions.filter(x => x.id !== v.id) } : prev)
  }

  if (loading) return <div className="h-24 bg-gray-100 rounded-xl animate-pulse" />

  if (!group) return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-800">
      General Distribution Rule not found. Run the Distribution Rules Unification migration from the Database tab.
    </div>
  )

  const av    = group.active_version
  const isAmt = av?.allocation_type === 'amount'
  const today = new Date().toISOString().slice(0, 10)

  return (
    <>
    <div className="rounded-xl border-2 border-primary/20 bg-white overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 bg-primary/5">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-gray-900 text-sm">General Distribution Rule</span>
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-primary/10 text-primary border border-primary/20">
              Default fallback
            </span>
          </div>
          <p className="text-xs text-gray-500 mt-0.5">
            Applies to any income type without a custom rule.
          </p>
          {av ? (
            <p className="text-xs text-gray-500 mt-1">
              Active: v{av.version_number} &nbsp;&middot;&nbsp;
              {av.effective_from ?? '—'}{av.effective_to ? ` → ${av.effective_to}` : ' → open'} &nbsp;&middot;&nbsp;
              <span className={isAmt ? 'text-blue-600' : 'text-purple-600'}>
                {isAmt ? `Amount ${baseCurrencySymbol}` : 'Percentage %'}
              </span>
              &nbsp;&middot;&nbsp;<span className="text-green-700">Locked</span>
            </p>
          ) : (
            <p className="text-xs text-amber-600 mt-1">No active version for today — create a new version to activate.</p>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => onNewVersion(group, av)}
            className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-primary border border-primary/30 rounded-lg hover:bg-blue-50 transition-colors"
          >
            <Plus className="w-3 h-3" /> New Version
          </button>
          {group.versions.length > 0 && (
            <button
              onClick={() => setExpanded(p => !p)}
              className="px-2.5 py-1.5 text-xs text-gray-500 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition-colors"
            >
              {expanded ? 'Hide' : 'History'}
            </button>
          )}
        </div>
      </div>

      {/* Active version rows preview */}
      {av && (
        <div className="px-4 py-2 border-t border-gray-100">
          <p className="text-xs font-medium text-gray-500 mb-1.5">Current allocation</p>
          <div className="space-y-0.5">
            {av.rows.map((r, i) => (
              <div key={i} className="flex justify-between text-xs text-gray-700">
                <span>{r.category_name}</span>
                <span className="font-medium tabular-nums">
                  {r.percentage != null ? `${r.percentage}%` : r.amount != null ? `${baseCurrencySymbol}${r.amount}` : '—'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Version history */}
      {expanded && (
        <div className="border-t border-gray-100">
          {group.versions.length === 0 ? (
            <p className="px-4 py-3 text-xs text-gray-500">No versions yet.</p>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="px-4 py-2 text-left font-semibold text-gray-500">Version</th>
                  <th className="px-4 py-2 text-left font-semibold text-gray-500">Effective From</th>
                  <th className="px-4 py-2 text-left font-semibold text-gray-500">Effective To</th>
                  <th className="px-4 py-2 text-left font-semibold text-gray-500">Status</th>
                  <th className="px-4 py-2 w-8" />
                  <th className="px-4 py-2 w-12" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {group.versions.map(v => {
                  const isSuperseded     = v.superseded_by_id != null
                  const isCurrent        = v.id === av?.id
                  const isPast           = v.status === 'locked' && !!v.effective_to && v.effective_to < today && !isCurrent && !isSuperseded
                  const isFuture         = v.status === 'locked' && !!v.effective_from && v.effective_from > today
                  const isVersionExpanded = expandedVersions.has(v.id)
                  return (
                    <React.Fragment key={v.id}>
                      <tr className={`hover:bg-gray-50 ${isSuperseded ? 'opacity-60' : ''}`}>
                        <td className="px-4 py-2 font-medium text-gray-700">v{v.version_number}</td>
                        <td className="px-4 py-2 text-gray-600">{v.effective_from ?? '—'}</td>
                        <td className="px-4 py-2 text-gray-600">{v.effective_to ?? 'open'}</td>
                        <td className="px-4 py-2">
                          <div className="flex flex-wrap items-center gap-1">
                            <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[11px] font-medium ${
                              v.status === 'locked'
                                ? 'bg-green-50 text-green-700 border border-green-200'
                                : 'bg-amber-50 text-amber-700 border border-amber-200'
                            }`}>
                              {v.status === 'locked' ? <Lock className="w-2.5 h-2.5" /> : <FileEdit className="w-2.5 h-2.5" />}
                              {v.status === 'locked' ? 'Locked' : 'Draft'}
                            </span>
                            {isCurrent && (
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-green-100 text-green-700 border border-green-300">Current</span>
                            )}
                            {isPast && (
                              <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-100 text-gray-500 border border-gray-200">
                                <Clock className="w-2.5 h-2.5" />Past
                              </span>
                            )}
                            {isFuture && (
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-indigo-50 text-indigo-700 border border-indigo-200">Future</span>
                            )}
                            {v.change_type === 'amendment' && (
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-violet-50 text-violet-700 border border-violet-200">Amendment</span>
                            )}
                            {v.change_type === 'date_split' && (
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-cyan-50 text-cyan-700 border border-cyan-200">Date split</span>
                            )}
                            {isSuperseded && (
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-100 text-gray-500 border border-gray-200">Superseded</span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-2">
                          {v.rows.length > 0 && (
                            <button
                              onClick={() => toggleVersion(v.id)}
                              className="p-1 text-gray-400 hover:text-gray-700 rounded transition-colors"
                              title={isVersionExpanded ? 'Hide breakdown' : 'Show breakdown'}
                            >
                              <ChevronDown className={`w-3.5 h-3.5 transition-transform ${isVersionExpanded ? 'rotate-180' : ''}`} />
                            </button>
                          )}
                        </td>
                        <td className="px-4 py-2">
                          <div className="flex items-center gap-1">
                            {isCurrent && (
                              <button
                                onClick={() => onAmend(group!, v)}
                                className="p-1 text-gray-400 hover:text-violet-600 hover:bg-violet-50 rounded transition-colors"
                                title="Amend this version"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                            )}
                            {isPast && (
                              <button
                                onClick={() => setPastInfoVersion(v)}
                                className="p-1 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"
                                title="About this past version"
                              >
                                <Info className="w-3.5 h-3.5" />
                              </button>
                            )}
                            {v.status === 'draft' && (
                              <button
                                onClick={() => handleDeleteVersion(v)}
                                className="p-1 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors"
                                title="Delete draft"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                      {isVersionExpanded && v.rows.length > 0 && (
                        <tr>
                          <td colSpan={6} className="px-6 pb-3 pt-0 bg-gray-50/60">
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="border-b border-gray-200">
                                  <th className="py-1.5 text-left text-gray-500 font-medium">Category</th>
                                  <th className="py-1.5 text-left text-gray-500 font-medium">Fund Type</th>
                                  <th className="py-1.5 text-right text-gray-500 font-medium">Value</th>
                                </tr>
                              </thead>
                              <tbody>
                                {v.rows.map((r, i) => (
                                  <tr key={i} className="border-b border-gray-100 last:border-0">
                                    <td className="py-1 text-gray-700">{r.category_name}</td>
                                    <td className="py-1 text-gray-500">{portionLabel(r.budget_portion)}</td>
                                    <td className="py-1 text-right font-medium text-gray-700 tabular-nums">
                                      {r.percentage != null ? `${r.percentage}%` : r.amount != null ? `${baseCurrencySymbol}${r.amount}` : '—'}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
    {/* Past version info dialog */}
    {pastInfoVersion && (
      <Modal open onClose={() => setPastInfoVersion(null)} title="Historical Version">
        <div className="space-y-4">
          <p className="text-sm text-gray-700">
            This rule covered{' '}
            <strong>{pastInfoVersion.effective_from ?? '—'}</strong>
            {' → '}
            <strong>{pastInfoVersion.effective_to ?? 'open'}</strong>
            {' '}and is no longer active.
          </p>
          <p className="text-sm text-gray-600">
            To make corrections to how records from that period were distributed, create a new version with those same dates — the date-split system will handle any overlaps automatically.
          </p>
          <div className="flex justify-end gap-2 pt-2">
            <button
              onClick={() => setPastInfoVersion(null)}
              className="px-4 py-2 text-sm font-medium text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
            >
              Close
            </button>
            <button
              onClick={() => { onNewVersion(group!, pastInfoVersion); setPastInfoVersion(null) }}
              className="px-4 py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary-light transition-colors"
            >
              Create New Version
            </button>
          </div>
        </div>
      </Modal>
    )}
    </>
  )
}

// ── Unified Distribution Rules tab ─────────────────────────────────────────────

function DistributionRulesTab({
  onNewCustom,
  onNewVersion,
  onAmend,
  refetchKey,
  onRefetch,
}: {
  onNewCustom:  () => void
  onNewVersion: (group: SpecialConfigGroupWithVersions, copyFrom: AllocationConfig | null) => void
  onAmend:      (group: SpecialConfigGroupWithVersions, version: AllocationConfig) => void
  refetchKey:   number
  onRefetch:    () => void
}) {
  return (
    <div className="max-w-3xl space-y-6">
      {/* General rule — always first */}
      <div className="space-y-2">
        <div>
          <h3 className="text-sm font-semibold text-gray-800">General Rule</h3>
          <p className="text-xs text-gray-500 mt-0.5">The fallback rule applied when an income type has no custom rule.</p>
        </div>
        <GeneralGroupPanel onNewVersion={onNewVersion} onAmend={onAmend} refetchKey={refetchKey} />
      </div>

      {/* Divider */}
      <div className="border-t border-gray-200" />

      {/* Custom rules */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-gray-800">Custom Rules</h3>
            <p className="text-xs text-gray-500 mt-0.5">Income-type-specific rules that override the General rule.</p>
          </div>
          <button
            onClick={onNewCustom}
            className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary-light transition-colors"
          >
            <Plus className="w-4 h-4" /> New Custom Rule
          </button>
        </div>
        <SpecialConfigsTab
          key={refetchKey}
          onNew={onNewCustom}
          onNewVersion={onNewVersion}
          onAmend={onAmend}
          onRefetch={onRefetch}
          hideHeader
        />
      </div>
    </div>
  )
}

// ── Custom Rules tab ─────────────────────────────────────────────────────────────

function SpecialConfigsTab({ onNew, onNewVersion, onAmend, onRefetch, hideHeader = false }: {
  onNew:        () => void
  onNewVersion: (group: SpecialConfigGroupWithVersions, copyFrom: AllocationConfig | null) => void
  onAmend:      (group: SpecialConfigGroupWithVersions, version: AllocationConfig) => void
  onRefetch:    () => void
  hideHeader?:  boolean
}) {
  const { baseCurrencySymbol } = useOrgCurrency()
  const { groups, archivedGroups, loading, error } = useSpecialConfigGroups()
  const [expandedGroups,   setExpandedGroups]   = useState<Set<string>>(new Set())
  const [expandedVersions, setExpandedVersions] = useState<Set<string>>(new Set())
  const [pastInfoDialog,   setPastInfoDialog]   = useState<{ g: SpecialConfigGroupWithVersions; v: AllocationConfig } | null>(null)
  const [showArchived,     setShowArchived]      = useState(false)
  const [search, setSearch] = useState('')
  const [sort,   setSort]   = useState('name|asc')

  const toggleVersionExpand = (id: string) =>
    setExpandedVersions(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next })

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

  const handleArchiveGroup = async (g: SpecialConfigGroupWithVersions) => {
    if (!window.confirm(`Hide "${g.name}"? It will be removed from the active list but all its data is preserved. You can restore it at any time.`)) return
    try {
      await archiveGroup(g.id)
      onRefetch()
    } catch (e: unknown) { window.alert(e instanceof Error ? e.message : String(e)) }
  }

  const handleRestoreGroup = async (g: SpecialConfigGroupWithVersions) => {
    try {
      await restoreGroup(g.id)
      onRefetch()
    } catch (e: unknown) { window.alert(e instanceof Error ? e.message : String(e)) }
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
      {!hideHeader && (
        <div className="flex justify-end">
          <button
            onClick={onNew}
            className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary-light transition-colors"
          >
            <Plus className="w-4 h-4" /> Create New Group
          </button>
        </div>
      )}

      {groups.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 py-12 text-center border border-dashed border-gray-300 rounded-xl bg-gray-50">
          <Layers className="w-8 h-8 text-gray-300" />
          <div>
            <p className="text-sm font-medium text-gray-600">No custom rules yet</p>
            <p className="text-xs text-gray-500 mt-1">Create a custom rule to override the General rule for specific income types.</p>
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
            const today = new Date().toISOString().slice(0, 10)
            const isGroupUsed = g.versions.some(v => v.status === 'locked' && v.superseded_by_id == null && !!v.effective_from && v.effective_from <= today)
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
                      <p className="text-xs text-gray-500 mt-0.5">No active version for today</p>
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
                      className="touch-target p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors text-xs"
                      title={isExpanded ? 'Hide history' : 'View history'}
                    >
                      {isExpanded ? 'Hide' : 'History'}
                    </button>
                    {isGroupUsed ? (
                      <button
                        onClick={() => handleArchiveGroup(g)}
                        className="touch-target p-1.5 rounded-lg text-gray-400 hover:text-amber-600 hover:bg-amber-50 transition-colors"
                        title="Hide group (has locked versions — cannot delete)"
                      >
                        <EyeOff className="w-4 h-4" />
                      </button>
                    ) : (
                      <button
                        onClick={() => handleDeleteGroup(g)}
                        className="touch-target p-1.5 rounded-lg text-gray-400 hover:text-danger hover:bg-red-50 transition-colors"
                        title="Delete group"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Version history */}
                {isExpanded && (
                  <div className="border-t border-gray-100">
                    {g.versions.length === 0 ? (
                      <p className="px-4 py-3 text-xs text-gray-500">No versions yet.</p>
                    ) : (() => {
                      const today = new Date().toISOString().slice(0, 10)
                      return (
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="border-b-2 border-black/[0.06] dark:border-white/[0.07]">
                              <th className="px-4 py-2 text-left text-gray-500 font-semibold">Ver</th>
                              <th className="px-4 py-2 text-left text-gray-500 font-semibold">Effective From</th>
                              <th className="px-4 py-2 text-left text-gray-500 font-semibold">Effective To</th>
                              <th className="px-4 py-2 text-left text-gray-500 font-semibold">Type</th>
                              <th className="px-4 py-2 text-left text-gray-500 font-semibold">Status / Lineage</th>
                              <th className="px-4 py-2 w-8" />
                              <th className="px-4 py-2 w-20" />
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-50">
                            {g.versions.map(v => {
                              const vAmt             = v.allocation_type === 'amount'
                              const vLocked          = v.status === 'locked'
                              const isSuperseded     = v.superseded_by_id != null
                              const isCurrent        = v.id === av?.id
                              const isPast           = vLocked && !!v.effective_to && v.effective_to < today && !isCurrent && !isSuperseded
                              const isFuture         = vLocked && !!v.effective_from && v.effective_from > today
                              const isVersionExpanded = expandedVersions.has(v.id)
                              return (
                                <React.Fragment key={v.id}>
                                  <tr className={`hover:bg-black/[0.02] dark:hover:bg-white/[0.03] transition-colors ${isSuperseded ? 'opacity-60' : ''}`}>
                                    <td className="px-4 py-2 font-mono text-gray-600">v{v.version_number ?? '—'}</td>
                                    <td className="px-4 py-2 text-gray-700">{v.effective_from ?? '—'}</td>
                                    <td className="px-4 py-2 text-gray-500">{v.effective_to ?? <span className="text-gray-300">open</span>}</td>
                                    <td className="px-4 py-2">
                                      <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium ${
                                        vAmt ? 'bg-blue-50 text-blue-700' : 'bg-purple-50 text-purple-700'
                                      }`}>
                                        {vAmt ? 'Amount' : 'Pct'}
                                      </span>
                                    </td>
                                    <td className="px-4 py-2">
                                      <div className="flex flex-wrap items-center gap-1">
                                        <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium ${
                                          vLocked ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'
                                        }`}>
                                          {vLocked ? <Lock className="w-2.5 h-2.5" /> : <FileEdit className="w-2.5 h-2.5" />}
                                          {vLocked ? 'Locked' : 'Draft'}
                                        </span>
                                        {isCurrent && (
                                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-green-100 text-green-700 border border-green-300">Current</span>
                                        )}
                                        {isPast && (
                                          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-100 text-gray-500 border border-gray-200">
                                            <Clock className="w-2.5 h-2.5" />Past
                                          </span>
                                        )}
                                        {isFuture && (
                                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-indigo-50 text-indigo-700 border border-indigo-200">Future</span>
                                        )}
                                        {v.change_type === 'amendment' && (
                                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-violet-50 text-violet-700 border border-violet-200">Amendment</span>
                                        )}
                                        {v.change_type === 'date_split' && (
                                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-cyan-50 text-cyan-700 border border-cyan-200">Date split</span>
                                        )}
                                        {isSuperseded && (
                                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-100 text-gray-500 border border-gray-200">Superseded</span>
                                        )}
                                      </div>
                                    </td>
                                    <td className="px-4 py-2">
                                      {v.rows.length > 0 && (
                                        <button
                                          onClick={() => toggleVersionExpand(v.id)}
                                          className="touch-target p-1 rounded text-gray-400 hover:text-gray-700 transition-colors"
                                          title={isVersionExpanded ? 'Hide breakdown' : 'Show breakdown'}
                                        >
                                          <ChevronDown className={`w-3.5 h-3.5 transition-transform ${isVersionExpanded ? 'rotate-180' : ''}`} />
                                        </button>
                                      )}
                                    </td>
                                    <td className="px-4 py-2">
                                      <div className="flex items-center justify-end gap-1">
                                        {isCurrent && (
                                          <button
                                            onClick={() => onAmend(g, v)}
                                            className="touch-target p-1 rounded text-gray-400 hover:text-violet-600 hover:bg-violet-50 transition-colors"
                                            title="Amend this version"
                                          >
                                            <Pencil className="w-3.5 h-3.5" />
                                          </button>
                                        )}
                                        {isPast && (
                                          <button
                                            onClick={() => setPastInfoDialog({ g, v })}
                                            className="touch-target p-1 rounded text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                                            title="About this past version"
                                          >
                                            <Info className="w-3.5 h-3.5" />
                                          </button>
                                        )}
                                        {(!vLocked || isFuture) && (
                                          <button
                                            onClick={() => handleDeleteVersion(v)}
                                            className="touch-target p-1 rounded text-gray-300 hover:text-danger hover:bg-red-50 transition-colors"
                                            title="Delete version"
                                          >
                                            <Trash2 className="w-3.5 h-3.5" />
                                          </button>
                                        )}
                                      </div>
                                    </td>
                                  </tr>
                                  {isVersionExpanded && v.rows.length > 0 && (
                                    <tr>
                                      <td colSpan={7} className="px-6 pb-3 pt-0 bg-gray-50/60">
                                        <table className="w-full text-xs">
                                          <thead>
                                            <tr className="border-b border-gray-200">
                                              <th className="py-1.5 text-left text-gray-500 font-medium">Category</th>
                                              <th className="py-1.5 text-left text-gray-500 font-medium">Fund Type</th>
                                              <th className="py-1.5 text-right text-gray-500 font-medium">Value</th>
                                            </tr>
                                          </thead>
                                          <tbody>
                                            {v.rows.map((r, i) => (
                                              <tr key={i} className="border-b border-gray-100 last:border-0">
                                                <td className="py-1 text-gray-700">{r.category_name}</td>
                                                <td className="py-1 text-gray-500">{portionLabel(r.budget_portion)}</td>
                                                <td className="py-1 text-right font-medium text-gray-700 tabular-nums">
                                                  {r.percentage != null ? `${r.percentage}%` : r.amount != null ? `${baseCurrencySymbol}${r.amount}` : '—'}
                                                </td>
                                              </tr>
                                            ))}
                                          </tbody>
                                        </table>
                                      </td>
                                    </tr>
                                  )}
                                </React.Fragment>
                              )
                            })}
                          </tbody>
                        </table>
                      )
                    })()}
                  </div>
                )}
              </div>
            )
          })}
        </div>
          )}
        </>
      )}
      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-500">
          {visible.length !== groups.length
            ? `${visible.length} of ${groups.length} groups`
            : `${groups.length} group${groups.length !== 1 ? 's' : ''}`}
        </p>
        {archivedGroups.length > 0 && (
          <button
            type="button"
            onClick={() => setShowArchived(s => !s)}
            className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-800 transition-colors"
          >
            {showArchived ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
            {showArchived ? 'Hide archived' : `Show archived (${archivedGroups.length})`}
          </button>
        )}
      </div>

      {showArchived && archivedGroups.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Archived Groups</p>
          {archivedGroups.map(g => (
            <div key={g.id} className="bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 opacity-70">
              <div className="flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-gray-700 text-sm">{g.name}</span>
                    {g.linked_income_type_name && (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-blue-50 text-blue-700 border border-blue-200">
                        {g.linked_income_type_name}
                      </span>
                    )}
                    <span className="inline-flex items-center gap-1 text-xs text-gray-400">
                      <EyeOff className="w-3 h-3" /> Archived
                    </span>
                  </div>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {g.versions.length} version{g.versions.length !== 1 ? 's' : ''} — data preserved
                  </p>
                </div>
                <button
                  onClick={() => handleRestoreGroup(g)}
                  className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-green-700 border border-green-300 rounded-lg hover:bg-green-50 transition-colors"
                  title="Restore group to active list"
                >
                  <Eye className="w-3 h-3" /> Restore
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {pastInfoDialog && (
        <Modal open onClose={() => setPastInfoDialog(null)} title="Historical Version">
          <div className="space-y-4">
            <p className="text-sm text-gray-700">
              This rule covered{' '}
              <strong>{pastInfoDialog.v.effective_from ?? '—'}</strong>
              {' → '}
              <strong>{pastInfoDialog.v.effective_to ?? 'open'}</strong>
              {' '}and is no longer active.
            </p>
            <p className="text-sm text-gray-600">
              To make corrections to how records from that period were distributed, create a new version with those same dates — the date-split system will handle any overlaps automatically.
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setPastInfoDialog(null)}
                className="px-4 py-2 text-sm font-medium text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
              >
                Close
              </button>
              <button
                onClick={() => { onNewVersion(pastInfoDialog.g, pastInfoDialog.v); setPastInfoDialog(null) }}
                className="px-4 py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary-light transition-colors"
              >
                Create New Version
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

// ── Currencies tab ───────────────────────────────────────────────────────────────────

export const CURRENCIES_MIGRATION_SQL =
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
      toast(friendlyError(e, 'delete'), 'error')
    }
  }

  const iCls = 'px-3 py-2 text-sm border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary'

  return (
    <div className="max-w-2xl space-y-5">
      {/* Migration hint */}
      {isMigrationError && (
        <div className="flex items-start gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>The currencies table is missing — please run the latest database migration, then refresh.</span>
        </div>
      )}

      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">Manage the currencies available across banks, FX transactions, and deposits.</p>
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
              <tr className="border-b-2 border-black/[0.06] dark:border-white/[0.07]">
                <th className="px-4 py-2.5 text-left text-[11px] font-bold text-gray-400 uppercase tracking-widest">Code</th>
                <th className="px-4 py-2.5 text-left text-[11px] font-bold text-gray-400 uppercase tracking-widest">Name</th>
                <th className="px-4 py-2.5 text-left text-[11px] font-bold text-gray-400 uppercase tracking-widest">Symbol</th>
                <th className="px-4 py-2.5 text-left text-[11px] font-bold text-gray-400 uppercase tracking-widest">Flag</th>
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
                      className="touch-target p-1.5 rounded hover:bg-red-50 text-gray-300 hover:text-danger transition-colors"
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


// ── Distribution Rules Unification — Phase 1 migration ────────────────────────────────
// Run this ONCE in Supabase SQL editor on each existing database.
// Safe to re-run (all ops are idempotent).
export const DISTRIBUTION_RULES_MIGRATION_SQL = `-- ── Distribution Rules Unification — Phase 1 ────────────────────────────────
-- Run once in Supabase SQL editor. Safe to re-run (idempotent).

-- 1. New columns
ALTER TABLE public.special_config_groups
  ADD COLUMN IF NOT EXISTS is_default boolean NOT NULL DEFAULT false;

ALTER TABLE public.categories
  ADD COLUMN IF NOT EXISTS is_default boolean NOT NULL DEFAULT false;

-- 2. Performance indexes
CREATE INDEX IF NOT EXISTS idx_alloc_configs_group_date
  ON public.allocation_configs(config_group_id, status, effective_from, effective_to)
  WHERE config_group_id IS NOT NULL;

DO $$ BEGIN
  CREATE UNIQUE INDEX idx_alloc_configs_group_effrom_unique
    ON public.allocation_configs(config_group_id, effective_from)
    WHERE status = 'locked';
EXCEPTION WHEN duplicate_table OR duplicate_object THEN NULL; END $$;

-- 3. Per-org migration: create General rule group + version history
DO $$
DECLARE
  v_org         record;
  v_group_id    uuid;
  v_cfg         record;
  v_next_effrom date;
  v_idx         int;
BEGIN
  FOR v_org IN
    SELECT id, created_at FROM public.organizations
    WHERE status IS NULL OR status = 'active'
  LOOP

    IF EXISTS (
      SELECT 1 FROM public.special_config_groups
      WHERE org_id = v_org.id AND is_default = true
    ) THEN CONTINUE; END IF;

    INSERT INTO public.special_config_groups (org_id, name, is_default)
    VALUES (v_org.id, 'General', true)
    RETURNING id INTO v_group_id;

    IF EXISTS (
      SELECT 1 FROM public.allocation_configs
      WHERE org_id = v_org.id
        AND (is_special = false OR is_special IS NULL)
        AND config_group_id IS NULL
    ) THEN
      -- Scenario A/B: migrate existing general configs
      v_idx := 1;
      FOR v_cfg IN
        SELECT * FROM public.allocation_configs
        WHERE org_id = v_org.id
          AND (is_special = false OR is_special IS NULL)
          AND config_group_id IS NULL
        ORDER BY start_date ASC, created_at ASC
      LOOP
        UPDATE public.allocation_configs
        SET config_group_id = v_group_id,
            effective_from  = COALESCE(effective_from, v_cfg.start_date),
            version_number  = v_idx
        WHERE id = v_cfg.id;
        v_idx := v_idx + 1;
      END LOOP;

      FOR v_cfg IN
        SELECT id, COALESCE(effective_from, start_date) AS eff_from
        FROM public.allocation_configs
        WHERE config_group_id = v_group_id AND org_id = v_org.id
        ORDER BY COALESCE(effective_from, start_date) ASC
      LOOP
        SELECT COALESCE(effective_from, start_date)
        INTO   v_next_effrom
        FROM   public.allocation_configs
        WHERE  config_group_id = v_group_id
          AND  org_id = v_org.id
          AND  COALESCE(effective_from, start_date) > v_cfg.eff_from
        ORDER BY COALESCE(effective_from, start_date) ASC
        LIMIT 1;

        IF v_next_effrom IS NOT NULL THEN
          UPDATE public.allocation_configs
          SET effective_to = v_next_effrom - INTERVAL '1 day'
          WHERE id = v_cfg.id;
        END IF;
      END LOOP;

    ELSE
      -- Scenario C: no general configs — create draft placeholder
      INSERT INTO public.allocation_configs (
        org_id, config_group_id, name,
        start_date, effective_from, effective_to,
        status, is_special, allocation_type, rows, version_number
      ) VALUES (
        v_org.id, v_group_id, 'General Distribution Rule',
        v_org.created_at::date, v_org.created_at::date, NULL,
        'draft', false, 'percentage', '[]'::jsonb, 1
      );
    END IF;

  END LOOP;
END $$;

-- 4. Update complete_org_onboarding() for new orgs
DROP FUNCTION IF EXISTS public.complete_org_onboarding(uuid, text, text, int, text);

CREATE OR REPLACE FUNCTION public.complete_org_onboarding(
  p_org_id            uuid,
  p_name              text,
  p_default_currency  text,
  p_fiscal_year_start int  DEFAULT 1,
  p_timezone          text DEFAULT 'Africa/Lagos'
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_user_id  uuid := auth.uid();
  v_group_id uuid;
  v_org_date date;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.org_members
    WHERE org_id = p_org_id AND user_id = v_user_id
      AND role IN ('owner','admin') AND status = 'active'
  ) THEN RAISE EXCEPTION 'Unauthorized: only org admins can complete onboarding'; END IF;

  UPDATE public.organizations
  SET name = trim(p_name), default_currency = p_default_currency,
      fiscal_year_start = p_fiscal_year_start, timezone = p_timezone,
      onboarding_complete = true, updated_at = now()
  WHERE id = p_org_id;

  SELECT created_at::date INTO v_org_date
  FROM public.organizations WHERE id = p_org_id;

  IF NOT EXISTS (SELECT 1 FROM public.income_types WHERE org_id = p_org_id LIMIT 1) THEN
    INSERT INTO public.income_types (org_id, name, color) VALUES
      (p_org_id,'Tithe','#6366f1'),(p_org_id,'Offering','#10b981'),
      (p_org_id,'Donation','#f59e0b'),(p_org_id,'Special Giving','#ec4899'),
      (p_org_id,'Thanksgiving','#3b82f6'),(p_org_id,'Project','#8b5cf6');
  END IF;

  INSERT INTO public.outflow_types (org_id, name, color, is_system, is_locked)
  VALUES (p_org_id,'General','#64748b',true,true)
  ON CONFLICT (org_id, name) DO NOTHING;

  IF NOT EXISTS (SELECT 1 FROM public.categories WHERE org_id = p_org_id AND is_default = true) THEN
    INSERT INTO public.categories (org_id, name, is_default)
    VALUES (p_org_id, 'General', true);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.special_config_groups WHERE org_id = p_org_id AND is_default = true) THEN
    INSERT INTO public.special_config_groups (org_id, name, is_default)
    VALUES (p_org_id, 'General', true)
    RETURNING id INTO v_group_id;

    INSERT INTO public.allocation_configs (
      org_id, config_group_id, name,
      start_date, effective_from, effective_to,
      status, is_special, allocation_type, rows, version_number
    ) VALUES (
      p_org_id, v_group_id, 'General Distribution Rule',
      v_org_date, v_org_date, NULL,
      'draft', false, 'percentage',
      '[]'::jsonb,
      1
    );
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.complete_org_onboarding(uuid,text,text,int,text) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ── Distribution Rules — Phase 2: Supersede / Amendment / Date-split audit ────
-- Add columns for version lineage and audit trail. Safe to re-run (idempotent).

ALTER TABLE public.allocation_configs
  ADD COLUMN IF NOT EXISTS superseded_by_id  uuid
    REFERENCES public.allocation_configs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS superseded_at     timestamptz,
  ADD COLUMN IF NOT EXISTS change_type       text
    CHECK (change_type IN ('initial','new_version','date_split','amendment'))
    DEFAULT 'initial',
  ADD COLUMN IF NOT EXISTS source_version_id uuid
    REFERENCES public.allocation_configs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS amendment_reason  text;

NOTIFY pgrst, 'reload schema';`

export const SYSTEM_DEFAULTS_MIGRATION_SQL =
`-- ── System Defaults: is_system columns + protected seeds ────────────────────
-- Adds is_system flag to income_types and categories.
-- Marks the "General Donation" income type and "General" category as system-protected.
-- Safe to re-run (idempotent).

ALTER TABLE public.income_types
  ADD COLUMN IF NOT EXISTS is_system boolean NOT NULL DEFAULT false;

ALTER TABLE public.categories
  ADD COLUMN IF NOT EXISTS is_system boolean NOT NULL DEFAULT false;

NOTIFY pgrst, 'reload schema';

-- Mark existing "General Donation" rows as system-protected (no data overridden)
UPDATE public.income_types
SET is_system = true
WHERE name = 'General Donation' AND (is_system = false OR is_system IS NULL);

-- Insert "General Donation" only for orgs that don't have one yet
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT o.id FROM public.organizations o
    WHERE NOT EXISTS (
      SELECT 1 FROM public.income_types i
      WHERE i.org_id = o.id AND i.name = 'General Donation'
    )
  LOOP
    BEGIN
      INSERT INTO public.income_types (org_id, name, color, is_system)
      VALUES (r.id, 'General Donation', '#6b7280', true);
    EXCEPTION WHEN OTHERS THEN NULL; -- skip locked/deleted orgs
    END;
  END LOOP;
END;
$$;

-- Mark "General" category as system-protected for all orgs (idempotent)
UPDATE public.categories
SET is_system = true
WHERE name = 'General' AND is_default = true AND is_system = false;

-- Update complete_org_onboarding() to seed General Donation for new orgs
DROP FUNCTION IF EXISTS public.complete_org_onboarding(uuid, text, text, int, text);

CREATE OR REPLACE FUNCTION public.complete_org_onboarding(
  p_org_id            uuid,
  p_name              text,
  p_default_currency  text,
  p_fiscal_year_start int  DEFAULT 1,
  p_timezone          text DEFAULT 'Africa/Lagos'
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_user_id  uuid := auth.uid();
  v_group_id uuid;
  v_org_date date;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.org_members
    WHERE org_id = p_org_id AND user_id = v_user_id
      AND role IN ('owner','admin') AND status = 'active'
  ) THEN RAISE EXCEPTION 'Unauthorized: only org admins can complete onboarding'; END IF;

  UPDATE public.organizations
  SET name = trim(p_name), default_currency = p_default_currency,
      fiscal_year_start = p_fiscal_year_start, timezone = p_timezone,
      onboarding_complete = true, updated_at = now()
  WHERE id = p_org_id;

  SELECT created_at::date INTO v_org_date
  FROM public.organizations WHERE id = p_org_id;

  IF NOT EXISTS (SELECT 1 FROM public.income_types WHERE org_id = p_org_id LIMIT 1) THEN
    INSERT INTO public.income_types (org_id, name, color, is_system) VALUES
      (p_org_id,'General Donation','#6b7280',true);
    INSERT INTO public.income_types (org_id, name, color) VALUES
      (p_org_id,'Tithe','#6366f1'),(p_org_id,'Offering','#10b981'),
      (p_org_id,'Donation','#f59e0b'),(p_org_id,'Special Giving','#ec4899'),
      (p_org_id,'Thanksgiving','#3b82f6'),(p_org_id,'Project','#8b5cf6');
  END IF;

  INSERT INTO public.outflow_types (org_id, name, color, is_system, is_locked)
  VALUES (p_org_id,'General','#64748b',true,true)
  ON CONFLICT (org_id, name) DO NOTHING;

  IF NOT EXISTS (SELECT 1 FROM public.categories WHERE org_id = p_org_id AND is_default = true) THEN
    INSERT INTO public.categories (org_id, name, is_default, is_system)
    VALUES (p_org_id, 'General', true, true);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.special_config_groups WHERE org_id = p_org_id AND is_default = true) THEN
    INSERT INTO public.special_config_groups (org_id, name, is_default)
    VALUES (p_org_id, 'General', true)
    RETURNING id INTO v_group_id;

    INSERT INTO public.allocation_configs (
      org_id, config_group_id, name,
      start_date, effective_from, effective_to,
      status, is_special, allocation_type, rows, version_number
    ) VALUES (
      p_org_id, v_group_id, 'General Distribution Rule',
      v_org_date, v_org_date, NULL,
      'draft', false, 'percentage',
      '[]'::jsonb,
      1
    );
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.complete_org_onboarding(uuid,text,text,int,text) TO authenticated;`

export const SPECIAL_CONFIG_RPC_MIGRATION_SQL =
`-- ── Special Config Version RPC ───────────────────────────────────────────────
-- Atomic function to create a new special config version.
-- Required for "Create New Version" (including from past versions) to work.
-- Safe to re-run (CREATE OR REPLACE).

CREATE OR REPLACE FUNCTION public.create_special_config_version(
  p_group_id       uuid,
  p_org_id         uuid,
  p_name           text,
  p_allocation_type text,
  p_total_amount   numeric(15,2),
  p_rows           jsonb,
  p_effective_from date,
  p_status         text DEFAULT 'draft'
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_covering_id   uuid;
  v_covering_from date;
  v_next_from     date;
  v_new_to        date;
  v_max_ver       integer;
  v_new_id        uuid;
BEGIN
  IF NOT public.is_org_admin(p_org_id) THEN
    RAISE EXCEPTION 'create_special_config_version: caller must be an org admin';
  END IF;

  IF p_status NOT IN ('draft', 'locked') THEN
    RAISE EXCEPTION 'create_special_config_version: invalid status %', p_status;
  END IF;

  -- Lock the group row to prevent concurrent version creation
  PERFORM id FROM public.special_config_groups
  WHERE id = p_group_id AND org_id = p_org_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'create_special_config_version: group % not found in org %', p_group_id, p_org_id;
  END IF;

  -- Find covering version (the one whose date range contains p_effective_from)
  SELECT id, effective_from INTO v_covering_id, v_covering_from
  FROM   public.allocation_configs
  WHERE  config_group_id = p_group_id
    AND  org_id          = p_org_id
    AND  effective_from <= p_effective_from
    AND  (effective_to IS NULL OR effective_to >= p_effective_from)
  LIMIT  1;

  -- Find the immediately following version to determine new effective_to
  SELECT effective_from INTO v_next_from
  FROM   public.allocation_configs
  WHERE  config_group_id = p_group_id
    AND  org_id          = p_org_id
    AND  effective_from  > p_effective_from
  ORDER BY effective_from
  LIMIT  1;

  v_new_to := CASE WHEN v_next_from IS NOT NULL
                   THEN v_next_from - 1
                   ELSE NULL END;

  -- Close the covering version
  IF v_covering_id IS NOT NULL THEN
    UPDATE public.allocation_configs
    SET    effective_to = p_effective_from - 1
    WHERE  id = v_covering_id;
  END IF;

  -- Compute next version number server-side
  SELECT COALESCE(MAX(version_number), 0) INTO v_max_ver
  FROM   public.allocation_configs
  WHERE  config_group_id = p_group_id AND org_id = p_org_id;

  -- Insert new version
  INSERT INTO public.allocation_configs (
    name, is_special, allocation_type, total_amount, rows,
    effective_from, effective_to, version_number,
    config_group_id, start_date, status, org_id
  ) VALUES (
    p_name, true, p_allocation_type, p_total_amount, p_rows,
    p_effective_from, v_new_to, v_max_ver + 1,
    p_group_id, p_effective_from, p_status, p_org_id
  )
  RETURNING id INTO v_new_id;

  RETURN v_new_id;
END;
$$;

REVOKE ALL   ON FUNCTION public.create_special_config_version(uuid,uuid,text,text,numeric,jsonb,date,text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.create_special_config_version(uuid,uuid,text,text,numeric,jsonb,date,text) TO authenticated;

NOTIFY pgrst, 'reload schema';`

export const ARCHIVE_GROUPS_MIGRATION_SQL =
`-- ── Config Group Archive / Hide ──────────────────────────────────────────────
-- Adds is_archived flag to special_config_groups.
-- Archived groups are hidden from the active list but all data is preserved.
-- Safe to re-run (idempotent).

ALTER TABLE public.special_config_groups
  ADD COLUMN IF NOT EXISTS is_archived boolean NOT NULL DEFAULT false;

NOTIFY pgrst, 'reload schema';`

// ── Income Types tab ───────────────────────────────────────────────────────────────────

function IncomeTypesTab({ onAdd, onEdit, onDelete }: {
  onAdd:    () => void
  onEdit:   (t: IncomeType) => void
  onDelete: (t: IncomeType) => void
}) {
  const { incomeTypes, loading, error, refetch } = useIncomeTypes()
  const orgId = useOrgStore(s => s.orgId)
  const [search, setSearch] = useState('')
  const [sort,   setSort]   = useState('name|asc')
  const [promotingOverlap, setPromotingOverlap] = useState(false)

  const dismissKey = orgId ? `it-overlap-dismissed-${orgId}` : null
  const [overlapDismissed, setOverlapDismissed] = useState(
    () => dismissKey ? localStorage.getItem(dismissKey) === '1' : false
  )

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    const filtered = q
      ? incomeTypes.filter(t => [t.name, t.description ?? ''].some(v => v.toLowerCase().includes(q)))
      : incomeTypes
    return applySetupSort(filtered, sort)
  }, [incomeTypes, search, sort])

  const systemType = incomeTypes.find(t => t.is_system)
  const shadowType = incomeTypes.find(t => !t.is_system && /^general/i.test(t.name))
  const showOverlap = !!(systemType && shadowType && !overlapDismissed && !loading)

  const handlePromoteShadow = async () => {
    if (!shadowType || !systemType) return
    setPromotingOverlap(true)
    try {
      const { error: e1 } = await supabase.from('income_types').update({ is_system: true }).eq('id', shadowType.id)
      if (e1) throw new Error(e1.message)
      const { error: e2 } = await supabase.from('income_types').update({ is_system: false }).eq('id', systemType.id)
      if (e2) throw new Error(e2.message)
      refetch()
    } catch (e: unknown) {
      window.alert(e instanceof Error ? e.message : String(e))
    } finally { setPromotingOverlap(false) }
  }

  const handleDismissOverlap = () => {
    if (dismissKey) localStorage.setItem(dismissKey, '1')
    setOverlapDismissed(true)
  }

  if (loading) return (
    <div className="max-w-2xl space-y-2">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="h-14 bg-gray-100 rounded-xl animate-pulse" />
      ))}
    </div>
  )

  if (error && !/relation.*does not exist|column.*does not exist|Could not find/i.test(error)) return (
    <div className="flex items-start gap-3 rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700 max-w-2xl">
      <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />{error}
    </div>
  )

  const isTableMissing  = !!error && /relation.*does not exist/i.test(error)
  const isColumnMissing = !!error && /column.*does not exist|Could not find/i.test(error)

  return (
    <div className="max-w-2xl space-y-4">
      {/* Migration hint */}
      {isTableMissing && (
        <div className="flex items-start gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>The <code className="font-mono text-xs">income_types</code> table doesn't exist yet — run the <strong>Core Schema</strong> migration in Setup → Database (Step 1).</span>
        </div>
      )}
      {isColumnMissing && (
        <div className="flex items-start gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>A required column is missing — run the <strong>System Defaults</strong> migration in Setup → Database (Step 4).</span>
        </div>
      )}

      {showOverlap && (
        <div className="flex items-start gap-3 rounded-xl bg-amber-50 border border-amber-200 px-4 py-3">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-amber-600" />
          <div className="flex-1 min-w-0 space-y-2">
            <p className="text-sm text-amber-800">
              <strong>"{shadowType!.name}"</strong> and the system <strong>"{systemType!.name}"</strong> may serve the same purpose. You can designate your existing type as the system type, or keep both.
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={handlePromoteShadow}
                disabled={promotingOverlap}
                className="px-3 py-1.5 text-xs font-medium text-white bg-amber-600 rounded-lg hover:bg-amber-700 transition-colors disabled:opacity-60"
              >
                {promotingOverlap ? 'Updating…' : `Make "${shadowType!.name}" the system type`}
              </button>
              <button
                onClick={handleDismissOverlap}
                className="px-3 py-1.5 text-xs font-medium text-amber-700 border border-amber-300 rounded-lg hover:bg-amber-100 transition-colors"
              >
                Keep both
              </button>
            </div>
          </div>
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
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-medium text-gray-900">{t.name}</p>
                      {t.is_system && (
                        <span className="text-xs font-semibold px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700">System</span>
                      )}
                    </div>
                    {t.description && <p className="text-xs text-gray-500 mt-0.5">{t.description}</p>}
                    {t.rules.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {t.rules.map(r => (
                          <span key={r.id} className="inline-flex items-center gap-1 text-xs font-medium px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-600">
                            <span className="text-gray-400">{r.rule_type === 'keyword' ? 'kw:' : 'sc:'}</span>
                            {r.rule_value}
                          </span>
                        ))}
                      </div>
                    )}
                    {t.special_config_name && (
                      <p className="text-xs text-primary mt-1">↳ Auto-applies: {t.special_config_name}</p>
                    )}
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <button onClick={() => onEdit(t)} className="touch-target p-1.5 rounded-lg text-gray-400 hover:text-primary hover:bg-primary/10 transition-colors">
                      <Pencil className="w-4 h-4" />
                    </button>
                    {t.is_system ? (
                      <span className="p-1.5 text-gray-300" title="System type — cannot be deleted">
                        <Lock className="w-4 h-4" />
                      </span>
                    ) : (
                      <button onClick={() => onDelete(t)} className="touch-target p-1.5 rounded-lg text-gray-400 hover:text-danger hover:bg-red-50 transition-colors">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
          <p className="text-xs text-gray-500">
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
                          <span className="text-xs font-semibold px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700">System</span>
                        )}
                        {!t.is_system && linkedCats.length > 0 && (
                          <span className="text-xs font-semibold px-1.5 py-0.5 rounded-full bg-green-100 text-green-700">Linked Category</span>
                        )}
                        {isStandalone && (
                          <span className="text-xs font-semibold px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500">Standalone</span>
                        )}
                      </div>
                      {linkedCats.length > 0 && (
                        <p className="text-xs text-gray-500 mt-0.5 truncate">↳ {linkedCats.join(', ')}</p>
                      )}
                    </div>
                    <div className="flex gap-1 shrink-0">
                      {t.is_locked ? (
                        <span className="p-1.5 text-gray-300" title="System type — cannot be edited or deleted">
                          <Lock className="w-4 h-4" />
                        </span>
                      ) : (
                        <>
                          <button onClick={() => onEdit(t)} className="touch-target p-1.5 rounded-lg text-gray-400 hover:text-primary hover:bg-primary/10 transition-colors">
                            <Pencil className="w-4 h-4" />
                          </button>
                          <button onClick={() => onDelete(t)} className="touch-target p-1.5 rounded-lg text-gray-400 hover:text-danger hover:bg-red-50 transition-colors">
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
          <p className="text-xs text-gray-500">
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
                        <span className="text-xs font-semibold px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700 font-mono">{d.code}</span>
                      )}
                      {!d.active && (
                        <span className="text-xs font-semibold px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500">Inactive</span>
                      )}
                    </div>
                    {d.description && (
                      <p className="text-xs text-gray-500 mt-0.5 truncate">{d.description}</p>
                    )}
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <button onClick={() => onEdit(d)} className="touch-target p-1.5 rounded-lg text-gray-400 hover:text-primary hover:bg-primary/10 transition-colors">
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button onClick={() => onDelete(d)} className="touch-target p-1.5 rounded-lg text-gray-400 hover:text-danger hover:bg-red-50 transition-colors">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
          <p className="text-xs text-gray-500">
            {visible.length !== departments.length
              ? `${visible.length} of ${departments.length} departments`
              : `${departments.length} department${departments.length !== 1 ? 's' : ''}`}
          </p>
        </>
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
  const [specialModalMode,      setSpecialModalMode]      = useState<'new_group' | 'new_version' | 'amend_version'>('new_group')
  const [selectedSpecialGroup,  setSelectedSpecialGroup]  = useState<SpecialConfigGroupWithVersions | null>(null)
  const [copyFromVersion,       setCopyFromVersion]       = useState<AllocationConfig | null>(null)
  const [amendVersionRecord,    setAmendVersionRecord]    = useState<AllocationConfig | null>(null)
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

  const handleAllocSuccess = () => { reloadAllocs() }

  const confirmDeleteAlloc = async () => {
    if (!deleteAllocTarget) return
    try {
      await deleteAllocConfig(deleteAllocTarget.id)
      toast(`"${deleteAllocTarget.name}" deleted`, 'success')
      setDeleteAllocTarget(null)
      reloadAllocs()
    } catch (e: unknown) {
      toast(friendlyError(e, 'delete'), 'error')
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
      toast(friendlyError(e, 'lock the config'), 'error')
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
      toast(friendlyError(e, 'unlock the config'), 'error')
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
    setAmendVersionRecord(null)
    setSpecialModalOpen(true)
  }

  const handleAmendVersion = (group: SpecialConfigGroupWithVersions, version: AllocationConfig) => {
    setSpecialModalMode('amend_version')
    setSelectedSpecialGroup(group)
    setCopyFromVersion(null)
    setAmendVersionRecord(version)
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
      toast(friendlyError(e, 'delete'), 'error')
    }
  }

  return (
    <>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-gray-900">Setup</h1>
          <p className="text-sm text-gray-500 mt-1">Configure your organisation finance settings</p>
        </div>

        {/* Mobile: icon + label card grid */}
        <div className="grid grid-cols-4 gap-2 md:hidden">
          {TAB_CARDS.map(({ tab, Icon, label }) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex flex-col items-center justify-center gap-1.5 py-3 px-1 rounded-xl transition-colors ${
                activeTab === tab
                  ? 'bg-primary text-white'
                  : 'bg-gray-100 text-gray-500 active:bg-gray-200'
              }`}
            >
              <Icon className="w-5 h-5" />
              <span className="text-[10px] font-medium leading-tight text-center">{label}</span>
            </button>
          ))}
        </div>

        {/* Desktop: sidebar nav + content */}
        <div className="flex gap-7 items-start">
          <nav className="hidden md:flex flex-col w-48 shrink-0 gap-0.5">
            {TAB_CARDS.map(({ tab, Icon, label }) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm rounded-lg transition-colors leading-tight ${
                  activeTab === tab
                    ? 'bg-gray-100 text-gray-900 font-semibold'
                    : 'text-gray-500 hover:bg-gray-50 hover:text-gray-800'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                {label}
              </button>
            ))}
          </nav>

          <div className="flex-1 min-w-0">
            {activeTab === 'General'        && <GeneralTab />}
            {activeTab === 'Banks'          && <BanksTab key={bankRefetch} onAdd={handleAddBank} onEdit={handleEditBank} onDelete={handleDeleteBank} />}
            {activeTab === 'Distribution Rules' && (
              <DistributionRulesTab
                onNewCustom={handleNewGroup}
                onNewVersion={handleNewVersion}
                onAmend={handleAmendVersion}
                refetchKey={specialRefetch}
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
            Lock <span className="font-semibold">"{lockTarget?.name}"</span>? Locked distribution rules are read-only and cannot be edited directly.
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
              className="w-full flex items-center gap-3 px-4 py-3 text-left border border-gray-200 rounded-lg hover:bg-black/[0.02] dark:hover:bg-white/[0.03] transition-colors"
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
        label={deleteAllocTarget ? `"${deleteAllocTarget.name}"` : 'this distribution rule'}
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
        versionToAmend={amendVersionRecord}
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
            toast(friendlyError(e, 'delete'), 'error')
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
            toast(friendlyError(e, 'delete'), 'error')
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
            toast(friendlyError(e, 'delete'), 'error')
          }
        }}
        loading={false}
        label={deleteDepartmentTarget ? `"${deleteDepartmentTarget.name}"` : 'this department'}
      />
    </>
  )
}
