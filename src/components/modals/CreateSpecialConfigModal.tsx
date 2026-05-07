import { useState, useEffect } from 'react'
import { Plus, Trash2, AlertTriangle, Terminal, Link2, Unlink } from 'lucide-react'
import { Modal } from '../ui/Modal'
import { InlineCategorySelect } from '../ui/InlineCategorySelect'
import { supabase } from '../../lib/supabase'
import { useCategories } from '../../hooks/useCategories'
import type { AllocationConfig } from '../../store/allocationStore'
import { useIncomeTypeOptions, setIncomeTypeConfigLink } from '../../hooks/useIncomeTypes'

const MIGRATION_SQL =
`ALTER TABLE allocation_configs
  ADD COLUMN IF NOT EXISTS is_special       boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS allocation_type  text    NOT NULL DEFAULT 'percentage'
    CHECK (allocation_type IN ('percentage', 'amount')),
  ADD COLUMN IF NOT EXISTS total_amount     numeric(15,2);

-- Allow multiple configs to share a start_date (required for special configs)
ALTER TABLE allocation_configs
  DROP CONSTRAINT IF EXISTS allocation_configs_start_date_key;`

interface Props {
  open:    boolean
  onClose: () => void
  onSaved: (config: AllocationConfig) => void
  editRecord?: AllocationConfig | null
}

interface RowDraft {
  category_name:  string
  budget_portion: string
  value:          string
}

export function CreateSpecialConfigModal({ open, onClose, onSaved, editRecord }: Props) {
  const { categories, refetch: refetchCategories } = useCategories()
  const { options: incomeTypeOptions, reload: reloadIncomeTypes } = useIncomeTypeOptions()

  const [name,                 setName]                 = useState('')
  const [allocType,            setAllocType]            = useState<'percentage' | 'amount'>('percentage')
  const [totalAmount,          setTotalAmount]          = useState('')
  const [rows,                 setRows]                 = useState<RowDraft[]>([{ category_name: '', budget_portion: '', value: '' }])
  const [saving,               setSaving]               = useState(false)
  const [error,                setError]                = useState<string | null>(null)
  // Income type link state
  const [selectedIncomeTypeId, setSelectedIncomeTypeId] = useState<string>('')

  // The income type currently linked to this config in the DB (used to detect/clear old link on save)
  const linkedIncomeType = incomeTypeOptions.find(
    o => o.special_config_id === editRecord?.id
  ) ?? null
  // The income type the user has selected in the dropdown
  const selectedOption = incomeTypeOptions.find(o => o.id === selectedIncomeTypeId) ?? null
  // Conflict: selected income type is already linked to a DIFFERENT config
  const hasConflict = !!selectedOption?.special_config_id &&
    selectedOption.special_config_id !== editRecord?.id

  useEffect(() => {
    if (!open) return
    reloadIncomeTypes()
    if (editRecord) {
      setName(editRecord.name)
      setAllocType(editRecord.allocation_type ?? 'percentage')
      setTotalAmount(editRecord.total_amount != null ? String(editRecord.total_amount) : '')
      setRows(
        editRecord.rows.length > 0
          ? editRecord.rows.map(r => ({
              category_name:  r.category_name,
              budget_portion: r.budget_portion ?? '',
              value: String(allocType === 'amount' ? (r.amount ?? '') : (r.percentage ?? '')),
            }))
          : [{ category_name: '', budget_portion: '', value: '' }],
      )
    } else {
      setName('')
      setAllocType('percentage')
      setTotalAmount('')
      setRows([{ category_name: '', budget_portion: '', value: '' }])
    }
    setError(null)
  }, [open, editRecord]) // eslint-disable-line react-hooks/exhaustive-deps

  // Sync selected income type when options load (for edit mode)
  useEffect(() => {
    if (incomeTypeOptions.length === 0) return
    const linked = incomeTypeOptions.find(o => o.special_config_id === editRecord?.id)
    setSelectedIncomeTypeId(linked?.id ?? '')
  }, [incomeTypeOptions, editRecord?.id])

  const addRow    = () => setRows(prev => [...prev, { category_name: '', budget_portion: '', value: '' }])
  const removeRow = (i: number) => setRows(prev => prev.filter((_, idx) => idx !== i))
  const setRowField = (i: number, field: keyof RowDraft, val: string) =>
    setRows(prev => prev.map((r, idx) => idx === i ? { ...r, [field]: val } : r))

  const runningTotal = rows.reduce((s, r) => s + (parseFloat(r.value) || 0), 0)
  const target = allocType === 'percentage' ? 100 : (parseFloat(totalAmount) || 0)
  const balanced = target > 0 && Math.abs(runningTotal - target) < 0.01

  const handleSave = async (lockAfterSave = false) => {
    setError(null)
    if (!name.trim()) { setError('Name is required'); return }
    if (allocType === 'amount' && (!totalAmount || parseFloat(totalAmount) <= 0)) {
      setError('Total amount is required for amount-type configs'); return
    }
    const validRows = rows.filter(r => r.category_name && r.value)
    if (validRows.length === 0) { setError('Add at least one category row'); return }
    if (hasConflict) { setError('Resolve the income type conflict before saving.'); return }

    const dbRows = validRows.map(r => ({
      category_name:  r.category_name,
      budget_portion: r.budget_portion || null,
      ...(allocType === 'percentage'
        ? { percentage: parseFloat(r.value) }
        : { amount: parseFloat(r.value) }),
    }))

    const payload = {
      name: name.trim(),
      is_special: true,
      allocation_type: allocType,
      total_amount: allocType === 'amount' ? parseFloat(totalAmount) : null,
      rows: dbRows,
      start_date: new Date().toISOString().slice(0, 10),
      status: 'draft' as const,
    }

    setSaving(true)
    try {
      let result
      if (editRecord?.id) {
        const { data, error: err } = await supabase
          .from('allocation_configs')
          .update(payload)
          .eq('id', editRecord.id)
          .select()
          .single()
        if (err) throw err
        result = data
      } else {
        const { data, error: err } = await supabase
          .from('allocation_configs')
          .insert(payload)
          .select()
          .single()
        if (err) throw err
        result = data
      }

      const configId = (result as AllocationConfig).id

      if (lockAfterSave) {
        const { error: lockErr } = await supabase
          .from('allocation_configs')
          .update({ status: 'locked' })
          .eq('id', configId)
        if (lockErr) throw lockErr
        ;(result as AllocationConfig).status = 'locked'
      }

      const prevId   = linkedIncomeType?.id ?? null
      const nextId   = selectedIncomeTypeId || null
      if (prevId !== nextId) {
        await setIncomeTypeConfigLink(configId, nextId, prevId)
      }

      onSaved(result as AllocationConfig)
      onClose()
    } catch (e: unknown) {
      const msg = (e as { message?: string })?.message ?? 'Save failed'
      setError(msg)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editRecord ? 'Edit Special Config' : 'Create Special Config'}
      size="max-w-xl"
    >
      <div className="space-y-4">

        {/* Name */}
        <div className="space-y-1">
          <label className="text-xs font-medium text-gray-600">Name *</label>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="e.g. Easter Special Allocation"
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-primary/30 bg-white"
          />
        </div>

        {/* Type toggle */}
        <div className="space-y-1">
          <label className="text-xs font-medium text-gray-600">Allocation Type</label>
          <div className="flex gap-2">
            {(['percentage', 'amount'] as const).map(t => (
              <button
                key={t}
                type="button"
                onClick={() => setAllocType(t)}
                className={`px-4 py-1.5 text-sm font-medium rounded-lg border transition-colors ${
                  allocType === t
                    ? 'bg-primary text-white border-primary'
                    : 'bg-white text-gray-600 border-gray-300 hover:border-primary'
                }`}
              >
                {t === 'percentage' ? 'Percentage %' : 'Amount ₦'}
              </button>
            ))}
          </div>
        </div>

        {/* Total amount (amount-type only) */}
        {allocType === 'amount' && (
          <div className="space-y-1">
            <label className="text-xs font-medium text-gray-600">Total Amount (₦) *</label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={totalAmount}
              onChange={e => setTotalAmount(e.target.value)}
              placeholder="0.00"
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-primary/30 bg-white"
            />
          </div>
        )}

        {/* Category rows */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium text-gray-600">Category Rows</label>
            <span className={`text-xs font-mono font-semibold ${
              balanced ? 'text-green-600' : 'text-amber-600'
            }`}>
              {allocType === 'percentage'
                ? `${runningTotal.toFixed(1)} / 100%`
                : `₦${runningTotal.toLocaleString()} / ₦${(parseFloat(totalAmount) || 0).toLocaleString()}`}
            </span>
          </div>

          <div className="border border-gray-200 rounded-lg overflow-hidden">
            <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_80px_32px] bg-gray-50 px-3 py-2 text-xs font-semibold text-gray-500 border-b border-gray-200">
              <span>Category</span>
              <span>Budget Portion</span>
              <span>{allocType === 'percentage' ? '%' : '₦ Amount'}</span>
              <span />
            </div>
            <div className="divide-y divide-gray-100 max-h-56 overflow-y-auto">
              {rows.map((row, i) => (
                <div key={i} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_80px_32px] items-center px-3 py-1.5 gap-2">
                  <InlineCategorySelect
                    value={row.category_name}
                    onChange={name => setRowField(i, 'category_name', name)}
                    categories={categories}
                    onRefresh={refetchCategories}
                    selectCls="text-xs px-2 py-1.5 border border-gray-200 rounded outline-none focus:ring-2 focus:ring-primary/30 bg-white w-full"
                  />
                  <select
                    value={row.budget_portion}
                    onChange={e => setRowField(i, 'budget_portion', e.target.value)}
                    className="text-xs px-2 py-1.5 border border-gray-200 rounded outline-none focus:ring-2 focus:ring-primary/30 bg-white w-full"
                  >
                    <option value="">— Portion —</option>
                    <option value="Percentage Allocation">Percentage Allocation</option>
                    <option value="Specific Seed">Specific Seed</option>
                    <option value="Savings">Savings</option>
                  </select>
                  <input
                    type="number"
                    min="0"
                    step={allocType === 'percentage' ? '0.01' : '1'}
                    value={row.value}
                    onChange={e => setRowField(i, 'value', e.target.value)}
                    placeholder={allocType === 'percentage' ? '0.00' : '0'}
                    className="text-xs px-2 py-1.5 border border-gray-200 rounded outline-none focus:ring-2 focus:ring-primary/30 bg-white w-full"
                  />
                  <button
                    type="button"
                    onClick={() => removeRow(i)}
                    className="p-1 rounded text-gray-300 hover:text-danger hover:bg-red-50 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          <button
            type="button"
            onClick={addRow}
            className="flex items-center gap-1.5 text-xs text-primary hover:text-primary-light font-medium"
          >
            <Plus className="w-3.5 h-3.5" /> Add row
          </button>
        </div>

        {/* Balance warning */}
        {!balanced && runningTotal > 0 && (
          <div className="flex items-center gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            {allocType === 'percentage'
              ? `Total is ${runningTotal.toFixed(1)}% — must equal 100%`
              : `Total ₦${runningTotal.toLocaleString()} doesn't match ₦${(parseFloat(totalAmount) || 0).toLocaleString()}`}
          </div>
        )}

        {/* Linked Income Type */}
        <div className="border border-gray-100 rounded-lg p-4 space-y-3 bg-gray-50">
          <div className="flex items-center gap-2">
            <Link2 className="w-3.5 h-3.5 text-gray-400" />
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Linked Income Type</p>
          </div>
          <p className="text-[11px] text-gray-400">
            When a transaction matches this income type, this config will be auto-applied.
            Only one special config can be linked to a given income type at a time.
          </p>

          {selectedIncomeTypeId ? (
            <div className="flex items-center gap-3">
              {/* Color dot */}
              {selectedOption && (
                <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: selectedOption.color }} />
              )}
              <select
                value={selectedIncomeTypeId}
                onChange={e => setSelectedIncomeTypeId(e.target.value)}
                className="flex-1 px-2 py-1.5 text-xs border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-primary/30"
              >
                <option value="">— None —</option>
                {incomeTypeOptions.map(o => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => setSelectedIncomeTypeId('')}
                className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-gray-600 bg-white border border-gray-300 rounded-lg hover:border-danger hover:text-danger transition-colors"
                title="Disconnect"
              >
                <Unlink className="w-3 h-3" /> Disconnect
              </button>
            </div>
          ) : (
            <select
              value=""
              onChange={e => setSelectedIncomeTypeId(e.target.value)}
              className="w-full px-2 py-1.5 text-xs border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-primary/30"
            >
              <option value="">— None —</option>
              {incomeTypeOptions.map(o => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </select>
          )}

          {/* Conflict warning */}
          {hasConflict && (
            <div className="flex items-start gap-2 text-[11px] text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>
                <strong>{selectedOption?.name}</strong> is already linked to another special config.
                Disconnect it from that config first, then try again.
              </span>
            </div>
          )}
        </div>

        {/* Error */}
        {error && (() => {
          const isMigration = /is_special|allocation_type|total_amount|Could not find|allocation_configs_start_date_key/.test(error)
          return (
            <div className="space-y-2">
              <div className="flex items-start gap-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span>{isMigration
                  ? 'Database migration required — the allocation_configs table is missing required columns. Run the SQL below in your Supabase SQL Editor, then try again.'
                  : error}
                </span>
              </div>
              {isMigration && (
                <div className="rounded-lg border border-gray-200 bg-gray-900 overflow-hidden">
                  <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-800 border-b border-gray-700">
                    <Terminal className="w-3 h-3 text-gray-400" />
                    <span className="text-[10px] text-gray-400 font-mono">Supabase SQL Editor</span>
                  </div>
                  <pre className="px-3 py-3 text-[11px] text-green-300 font-mono overflow-x-auto whitespace-pre">{MIGRATION_SQL}</pre>
                </div>
              )}
            </div>
          )
        })()}

        {/* Footer */}
        <div className="flex justify-end gap-3 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => handleSave(false)}
            disabled={saving}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-60"
          >
            {saving && <span className="w-3.5 h-3.5 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />}
            {saving ? 'Saving…' : 'Save as Draft'}
          </button>
          <button
            type="button"
            onClick={() => handleSave(true)}
            disabled={saving}
            className="flex items-center gap-2 px-5 py-2 text-sm font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 disabled:opacity-60"
          >
            {saving && <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />}
            {saving ? 'Saving…' : 'Save & Lock'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
