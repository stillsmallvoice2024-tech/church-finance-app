import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Pencil, Trash2, Landmark, AlertCircle, Plus, Lock } from 'lucide-react'
import { useBanks, type DbBank } from '../../hooks/useBanks'
import { usePlan } from '../../hooks/usePlan'
import { SetupSearchSort, applySetupSort, BANK_SORT_OPTS } from './shared'

// ── Banks tab ────────────────────────────────────────────────────────────────────

export function BanksTab({ onAdd, onEdit, onDelete }: {
  onAdd:    () => void
  onEdit:   (bank: DbBank) => void
  onDelete: (bank: DbBank) => void
}) {
  const { banks, loading, error } = useBanks()
  const [search, setSearch] = useState('')
  const [sort,   setSort]   = useState('name|asc')

  const navigate = useNavigate()
  const { quantityLimit, planLoading } = usePlan()
  const bankLimit = quantityLimit('multiBank')
  // An unknown tier resolves to Start, whose cap is 1 — so hold the cap off
  // until the real tier lands, or a Growth org briefly reads as "at cap".
  const atCap = !planLoading && bankLimit !== null && banks.length >= bankLimit

  // Single guarded entry point, mirrors DistributionRulesTab's
  // guardedNewCustom — the real cap enforcement lives in useAddBank()
  // (useMutations.ts), this just avoids opening the modal only to fail.
  const guardedAdd = () => {
    if (atCap) { navigate('/settings?tab=billing&locked=multiBank'); return }
    onAdd()
  }

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
      <div className="flex items-center justify-between gap-3">
        {bankLimit !== null && (
          <p className={`text-xs ${atCap ? 'text-amber-600 font-medium' : 'text-gray-500'}`}>
            {banks.length} of {bankLimit} bank{bankLimit === 1 ? '' : 's'} used
          </p>
        )}
        <div className="ml-auto">
          {atCap ? (
            <button
              onClick={guardedAdd}
              className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-lg hover:bg-amber-100 transition-colors"
            >
              <Lock className="w-4 h-4" /> Upgrade for more
            </button>
          ) : (
            <button
              onClick={guardedAdd}
              className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary-light transition-colors"
            >
              <Plus className="w-4 h-4" /> Add Bank
            </button>
          )}
        </div>
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
                          {bank.is_system && (
                            <span className="flex items-center gap-1 px-1.5 py-0.5 text-xs font-semibold rounded bg-gray-100 text-gray-500 border border-gray-200 shrink-0">
                              <Lock className="w-3 h-3" /> System
                            </span>
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
                          {!bank.is_system && (
                            <button
                              onClick={() => onDelete(bank)}
                              className="touch-target p-1.5 rounded-lg text-gray-400 hover:text-danger hover:bg-red-50 transition-colors"
                              title="Delete" aria-label="Delete"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
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
