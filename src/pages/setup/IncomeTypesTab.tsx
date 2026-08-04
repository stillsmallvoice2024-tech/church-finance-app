import { useState, useMemo } from 'react'
import { Pencil, Trash2, AlertCircle, Plus, Layers, Lock } from 'lucide-react'
import { useIncomeTypes, type IncomeType } from '../../hooks/useIncomeTypes'
import { useBanks } from '../../hooks/useBanks'
import { supabase } from '../../lib/supabase'
import { useOrgStore } from '../../store/orgStore'
import { SetupSearchSort, applySetupSort, TYPE_SORT_OPTS } from './shared'

// ── Income Types tab ───────────────────────────────────────────────────────────────────

export function IncomeTypesTab({ onAdd, onEdit, onDelete }: {
  onAdd:    () => void
  onEdit:   (t: IncomeType) => void
  onDelete: (t: IncomeType) => void
}) {
  const { incomeTypes, loading, error, refetch } = useIncomeTypes()
  const { banks } = useBanks()   // org-scoped — resolves a bank rule's id to its name
  const bankNameById = useMemo(() => new Map(banks.map(b => [b.id, b.name])), [banks])
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
                            <span className="text-gray-400">
                              {r.rule_type === 'keyword' ? 'kw:' : r.rule_type === 'bank' ? 'bank:' : 'sc:'}
                            </span>
                            {r.rule_type === 'bank' ? (bankNameById.get(r.rule_value) ?? r.rule_value) : r.rule_value}
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
