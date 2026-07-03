import React, { useState, useEffect, useMemo } from 'react'
import { Pencil, Trash2, AlertCircle, Plus, Layers, Lock, FileEdit, ChevronDown, Info, Clock, EyeOff, Eye } from 'lucide-react'
import { type AllocationConfig } from '../../store/allocationStore'
import { useSpecialConfigGroups, archiveGroup, restoreGroup, type SpecialConfigGroupWithVersions } from '../../hooks/useSpecialConfigGroups'
import { Modal } from '../../components/ui/Modal'
import { supabase } from '../../lib/supabase'
import { useOrgCurrency } from '../../hooks/useOrgCurrency'
import { useOrgStore } from '../../store/orgStore'
import { SetupSearchSort, applySetupSort, SPECIAL_SORT_OPTS, portionLabel } from './shared'

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

export function DistributionRulesTab({
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
