import { useState, useMemo } from 'react'
import { Pencil, Trash2, AlertCircle, Plus, Layers } from 'lucide-react'
import { useDepartments, type Department } from '../../hooks/useDepartments'
import { SetupSearchSort, applySetupSort, TYPE_SORT_OPTS } from './shared'

// ── Departments tab ───────────────────────────────────────────────────────────────────

export function DepartmentsTab({ onAdd, onEdit, onDelete }: {
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
