import { useState, useMemo } from 'react'
import { Pencil, Trash2, AlertCircle, Plus, Layers, Lock } from 'lucide-react'
import { useOutflowTypes, useCategoryOutflowTypeMaps, type OutflowType } from '../../hooks/useOutflowTypes'
import { useCategories } from '../../hooks/useCategories'
import { SetupSearchSort, applySetupSort, TYPE_SORT_OPTS } from './shared'

// ── Outflow Types tab ──────────────────────────────────────────────────────────────────

export function OutflowTypesTab({ onAdd, onEdit, onDelete }: {
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
