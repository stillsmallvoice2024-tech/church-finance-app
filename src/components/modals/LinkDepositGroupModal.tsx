import { useState, useMemo, useEffect } from 'react'
import { X, AlertTriangle, CheckCircle, Search } from 'lucide-react'
import { useUpdateTransaction } from '../../hooks/useMutations'
import { formatCurrency, formatDate } from '../../utils/formatters'
import { useOrgCurrency } from '../../hooks/useOrgCurrency'

// ── Shared row shape (subset of DepositRow from BankMovement) ─────────────────

export interface GroupableRow {
  id:              string
  date:            string
  amount:          number
  bank_name:       string | null
  description:     string | null
  source:          'inflow' | 'outflow'
  offset_role:     string | null
  deposit_group_id?: string | null
}

type Role = 'root' | 'offset'

interface Selection {
  row:  GroupableRow
  role: Role
}

interface Props {
  open:        boolean
  onClose:     () => void
  onSuccess:   () => void
  targetRow:   GroupableRow
  allRows:     GroupableRow[]
}

// ── Component ─────────────────────────────────────────────────────────────────

export function LinkDepositGroupModal({ open, onClose, onSuccess, targetRow, allRows }: Props) {
  const { baseCurrencyCode } = useOrgCurrency()
  const updateInflow  = useUpdateTransaction('inflow_transactions')
  const updateOutflow = useUpdateTransaction('outflow_transactions')

  const [targetRole,  setTargetRole]  = useState<Role>('root')
  const [selections,  setSelections]  = useState<Selection[]>([])
  const [search,      setSearch]      = useState('')
  const [saving,      setSaving]      = useState(false)
  const [saveError,   setSaveError]   = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setTargetRole(targetRow.offset_role === 'offset' ? 'offset' : 'root')
      setSelections([])
      setSearch('')
      setSaveError(null)
    }
  }, [open, targetRow])

  const available = useMemo(() => {
    const selectedIds = new Set(selections.map(s => s.row.id))
    return allRows.filter(r =>
      r.id !== targetRow.id &&
      !r.deposit_group_id &&
      !selectedIds.has(r.id) &&
      (search === '' ||
        (r.description ?? '').toLowerCase().includes(search.toLowerCase()) ||
        (r.bank_name ?? '').toLowerCase().includes(search.toLowerCase()) ||
        r.date.includes(search)),
    )
  }, [allRows, targetRow.id, selections, search])

  const allGrouped: Selection[] = [{ row: targetRow, role: targetRole }, ...selections]
  const roots    = allGrouped.filter(s => s.role === 'root')
  const offsets  = allGrouped.filter(s => s.role === 'offset')
  const rootTotal   = roots.reduce((sum, s) => sum + s.row.amount, 0)
  const offsetTotal = offsets.reduce((sum, s) => sum + s.row.amount, 0)
  const offsetCount = offsets.length
  const balanced    = offsetCount === 1 && Math.abs(rootTotal - offsetTotal) < 0.01
  const canConfirm  = selections.length > 0 && !saving

  const toggleSelection = (row: GroupableRow) => {
    setSelections(prev => {
      const exists = prev.find(s => s.row.id === row.id)
      if (exists) return prev.filter(s => s.row.id !== row.id)
      return [...prev, { row, role: 'root' }]
    })
  }

  const setSelectionRole = (id: string, role: Role) => {
    setSelections(prev => prev.map(s => s.row.id === id ? { ...s, role } : s))
  }

  const handleConfirm = async () => {
    setSaving(true)
    setSaveError(null)
    const groupId = crypto.randomUUID()
    try {
      for (const { row, role } of allGrouped) {
        const updater = row.source === 'inflow' ? updateInflow : updateOutflow
        await updater.mutate({ id: row.id, updates: { deposit_group_id: groupId, offset_role: role } })
      }
      onSuccess()
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to create group')
    } finally {
      setSaving(false)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 shrink-0">
          <h2 className="text-base font-semibold text-gray-900">Create Deposit Group</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 px-5 py-4 space-y-5">

          {/* Target row */}
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">This row</p>
            <div className="border border-gray-200 rounded-xl p-3 bg-gray-50">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-gray-900">{formatDate(targetRow.date)}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{targetRow.bank_name ?? '—'}</p>
                  {targetRow.description && (
                    <p className="text-xs text-gray-600 mt-1 truncate">{targetRow.description}</p>
                  )}
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-sm font-mono font-bold text-gray-900">
                    {formatCurrency(targetRow.amount, baseCurrencyCode)}
                  </p>
                  <span className={`inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded mt-1 ${
                    targetRow.source === 'inflow' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                  }`}>{targetRow.source}</span>
                </div>
              </div>
              {/* Role toggle */}
              <div className="mt-3 flex items-center gap-2">
                <p className="text-xs text-gray-500 shrink-0">Role in group:</p>
                <RoleToggle value={targetRole} onChange={setTargetRole} />
              </div>
            </div>
          </div>

          {/* Add more rows */}
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
              Add other rows to this group
            </p>

            {/* Selected rows */}
            {selections.length > 0 && (
              <div className="mb-3 space-y-2">
                {selections.map(({ row, role }) => (
                  <div key={row.id} className="flex items-center gap-2 border border-primary/30 bg-primary/5 rounded-lg px-3 py-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-gray-800">{formatDate(row.date)} · {row.bank_name ?? '—'}</p>
                      <p className="text-xs font-mono text-gray-900">{formatCurrency(row.amount, baseCurrencyCode)}</p>
                    </div>
                    <RoleToggle value={role} onChange={r => setSelectionRole(row.id, r)} />
                    <button onClick={() => toggleSelection(row)} className="p-1 rounded text-gray-400 hover:text-danger hover:bg-red-50">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Search */}
            <div className="relative mb-2">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
              <input
                type="text"
                placeholder="Search by description, bank, date…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>

            {/* Available rows */}
            <div className="max-h-48 overflow-y-auto border border-gray-200 rounded-xl divide-y divide-gray-100">
              {available.length === 0 ? (
                <p className="text-xs text-gray-400 text-center py-4">No available rows{search ? ' matching your search' : ''}</p>
              ) : available.map(row => (
                <button
                  key={row.id}
                  onClick={() => toggleSelection(row)}
                  className="w-full text-left px-3 py-2.5 hover:bg-gray-50 transition-colors flex items-center gap-3"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-gray-800">{formatDate(row.date)} · {row.bank_name ?? '—'}</p>
                    {row.description && <p className="text-[11px] text-gray-500 truncate">{row.description}</p>}
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-xs font-mono font-semibold text-gray-900">{formatCurrency(row.amount, baseCurrencyCode)}</p>
                    <span className={`inline-block text-[10px] font-semibold px-1 py-0.5 rounded ${
                      row.source === 'inflow' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                    }`}>{row.source}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Balance summary */}
          {selections.length > 0 && (
            <div className={`rounded-xl border px-4 py-3 ${balanced ? 'border-green-200 bg-green-50' : 'border-amber-200 bg-amber-50'}`}>
              <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">Balance Check</p>
              <div className="space-y-1 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-600">Root total ({roots.length} row{roots.length !== 1 ? 's' : ''})</span>
                  <span className="font-mono font-semibold text-gray-900">{formatCurrency(rootTotal, baseCurrencyCode)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Offset total ({offsets.length} row{offsets.length !== 1 ? 's' : ''})</span>
                  <span className="font-mono font-semibold text-gray-900">{formatCurrency(offsetTotal, baseCurrencyCode)}</span>
                </div>
                <div className="border-t border-current/20 pt-1 flex items-center justify-between">
                  {balanced ? (
                    <>
                      <span className="flex items-center gap-1 text-green-700 font-semibold text-xs">
                        <CheckCircle className="w-3.5 h-3.5" /> Balanced
                      </span>
                      <span className="font-mono font-semibold text-green-700">{formatCurrency(0, baseCurrencyCode)}</span>
                    </>
                  ) : (
                    <>
                      <span className="flex items-center gap-1 text-amber-700 font-semibold text-xs">
                        <AlertTriangle className="w-3.5 h-3.5" />
                        {offsetCount !== 1 ? `${offsetCount} offset rows — use exactly 1` : 'Mismatch'}
                      </span>
                      <span className="font-mono font-semibold text-amber-700">
                        {offsetCount === 1 ? formatCurrency(Math.abs(rootTotal - offsetTotal), baseCurrencyCode) : '—'}
                      </span>
                    </>
                  )}
                </div>
              </div>
            </div>
          )}

          {saveError && (
            <p className="text-xs text-danger bg-red-50 border border-red-200 rounded-lg px-3 py-2">{saveError}</p>
          )}
        </div>

        {/* Footer */}
        <div className="shrink-0 flex items-center justify-end gap-2 px-5 py-4 border-t border-gray-100 bg-gray-50/60 rounded-b-2xl">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={!canConfirm}
            className="px-4 py-2 text-sm font-semibold text-white bg-primary rounded-lg hover:bg-primary-light disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {saving ? 'Saving…' : 'Create Group'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Role toggle ───────────────────────────────────────────────────────────────

function RoleToggle({ value, onChange }: { value: Role; onChange: (r: Role) => void }) {
  return (
    <div className="flex items-center gap-0.5 p-0.5 bg-gray-100 rounded-lg text-[11px] font-semibold">
      <button
        onClick={() => onChange('root')}
        className={`px-2 py-1 rounded-md transition-colors ${value === 'root' ? 'bg-green-600 text-white shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
      >
        Root
      </button>
      <button
        onClick={() => onChange('offset')}
        className={`px-2 py-1 rounded-md transition-colors ${value === 'offset' ? 'bg-amber-500 text-white shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
      >
        Offset
      </button>
    </div>
  )
}
