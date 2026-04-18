import { useState, useEffect } from 'react'
import { Plus, Trash2, AlertTriangle } from 'lucide-react'
import { Modal } from '../ui/Modal'
import { supabase } from '../../lib/supabase'
import { useCategories } from '../../hooks/useCategories'
import type { AllocationConfig } from '../../store/allocationStore'

interface Props {
  open:    boolean
  onClose: () => void
  onSaved: (config: AllocationConfig) => void
  editRecord?: AllocationConfig | null
}

interface RowDraft {
  category_name: string
  value: string
}

export function CreateSpecialConfigModal({ open, onClose, onSaved, editRecord }: Props) {
  const { categories } = useCategories()

  const [name,          setName]          = useState('')
  const [allocType,     setAllocType]     = useState<'percentage' | 'amount'>('percentage')
  const [totalAmount,   setTotalAmount]   = useState('')
  const [rows,          setRows]          = useState<RowDraft[]>([{ category_name: '', value: '' }])
  const [saving,        setSaving]        = useState(false)
  const [error,         setError]         = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    if (editRecord) {
      setName(editRecord.name)
      setAllocType(editRecord.allocation_type ?? 'percentage')
      setTotalAmount(editRecord.total_amount != null ? String(editRecord.total_amount) : '')
      setRows(
        editRecord.rows.length > 0
          ? editRecord.rows.map(r => ({
              category_name: r.category_name,
              value: String(allocType === 'amount' ? (r.amount ?? '') : (r.percentage ?? '')),
            }))
          : [{ category_name: '', value: '' }],
      )
    } else {
      setName('')
      setAllocType('percentage')
      setTotalAmount('')
      setRows([{ category_name: '', value: '' }])
    }
    setError(null)
  }, [open, editRecord]) // eslint-disable-line react-hooks/exhaustive-deps

  const addRow    = () => setRows(prev => [...prev, { category_name: '', value: '' }])
  const removeRow = (i: number) => setRows(prev => prev.filter((_, idx) => idx !== i))
  const setRowField = (i: number, field: keyof RowDraft, val: string) =>
    setRows(prev => prev.map((r, idx) => idx === i ? { ...r, [field]: val } : r))

  const runningTotal = rows.reduce((s, r) => s + (parseFloat(r.value) || 0), 0)
  const target = allocType === 'percentage' ? 100 : (parseFloat(totalAmount) || 0)
  const balanced = target > 0 && Math.abs(runningTotal - target) < 0.01

  const handleSave = async () => {
    setError(null)
    if (!name.trim()) { setError('Name is required'); return }
    if (allocType === 'amount' && (!totalAmount || parseFloat(totalAmount) <= 0)) {
      setError('Total amount is required for amount-type configs'); return
    }
    const validRows = rows.filter(r => r.category_name && r.value)
    if (validRows.length === 0) { setError('Add at least one category row'); return }

    const dbRows = validRows.map(r => ({
      category_name: r.category_name,
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
      onSaved(result as AllocationConfig)
      onClose()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Save failed')
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
            <div className="grid grid-cols-[1fr_120px_36px] bg-gray-50 px-3 py-2 text-xs font-semibold text-gray-500 border-b border-gray-200">
              <span>Category</span>
              <span>{allocType === 'percentage' ? '%' : '₦ Amount'}</span>
              <span />
            </div>
            <div className="divide-y divide-gray-100 max-h-56 overflow-y-auto">
              {rows.map((row, i) => (
                <div key={i} className="grid grid-cols-[1fr_120px_36px] items-center px-3 py-1.5 gap-2">
                  <select
                    value={row.category_name}
                    onChange={e => setRowField(i, 'category_name', e.target.value)}
                    className="text-xs px-2 py-1.5 border border-gray-200 rounded outline-none focus:ring-2 focus:ring-primary/30 bg-white"
                  >
                    <option value="">— Select —</option>
                    {categories.map(c => (
                      <option key={c.id} value={c.name}>{c.name}</option>
                    ))}
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

        {/* Error */}
        {error && (
          <div className="flex items-center gap-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> {error}
          </div>
        )}

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
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 px-5 py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary-light disabled:opacity-60"
          >
            {saving && <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />}
            {saving ? 'Saving…' : 'Save Config'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
