import { useState, useEffect } from 'react'
import { Plus, Trash2, AlertTriangle, Link2, Unlink } from 'lucide-react'
import { Modal } from '../ui/Modal'
import { InlineCategorySelect } from '../ui/InlineCategorySelect'
import { supabase } from '../../lib/supabase'
import { useCategories } from '../../hooks/useCategories'
import type { AllocationConfig } from '../../store/allocationStore'
import {
  createGroupWithFirstVersion,
  createNewVersion,
  getImpactedTransactionCount,
  recalculateTransactions,
  type SpecialConfigGroupWithVersions,
} from '../../hooks/useSpecialConfigGroups'
import { useIncomeTypeOptions } from '../../hooks/useIncomeTypes'

const MIGRATION_SQL =
`ALTER TABLE allocation_configs
  ADD COLUMN IF NOT EXISTS is_special       boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS allocation_type  text    NOT NULL DEFAULT 'percentage'
    CHECK (allocation_type IN ('percentage', 'amount')),
  ADD COLUMN IF NOT EXISTS total_amount     numeric(15,2),
  ADD COLUMN IF NOT EXISTS config_group_id  uuid,
  ADD COLUMN IF NOT EXISTS effective_from   date,
  ADD COLUMN IF NOT EXISTS effective_to     date,
  ADD COLUMN IF NOT EXISTS version_number   integer NOT NULL DEFAULT 1;

ALTER TABLE income_types
  ADD COLUMN IF NOT EXISTS special_config_group_id uuid;`

interface Props {
  open:             boolean
  onClose:          () => void
  onSaved:          (cfg?: AllocationConfig) => void
  mode:             'new_group' | 'new_version'
  group?:           SpecialConfigGroupWithVersions | null
  copyFromVersion?: AllocationConfig | null
}

interface RowDraft {
  category_name:  string
  budget_portion: string
  value:          string
}

type ImpactPhase = 'idle' | 'prompting' | 'reason' | 'recalculating' | 'done'

export function CreateSpecialConfigModal({ open, onClose, onSaved, mode, group, copyFromVersion }: Props) {
  const { categories, refetch: refetchCategories } = useCategories()
  const { options: incomeTypeOptions, reload: reloadIncomeTypes } = useIncomeTypeOptions()

  const [name,                 setName]                 = useState('')
  const [effectiveFrom,        setEffectiveFrom]        = useState('')
  const [allocType,            setAllocType]            = useState<'percentage' | 'amount'>('percentage')
  const [totalAmount,          setTotalAmount]          = useState('')
  const [rows,                 setRows]                 = useState<RowDraft[]>([{ category_name: '', budget_portion: '', value: '' }])
  const [saving,               setSaving]               = useState(false)
  const [error,                setError]                = useState<string | null>(null)
  const [selectedIncomeTypeId, setSelectedIncomeTypeId] = useState<string>('')

  const [impactPhase,    setImpactPhase]    = useState<ImpactPhase>('idle')
  const [impactCount,    setImpactCount]    = useState(0)
  const [recalcReason,   setRecalcReason]   = useState('')
  const [savedGroupId,   setSavedGroupId]   = useState<string | null>(null)
  const [savedVersionId, setSavedVersionId] = useState<string | null>(null)
  const [savedRows,      setSavedRows]      = useState<AllocationConfig['rows']>([])
  const [savedAllocType, setSavedAllocType] = useState<'percentage' | 'amount'>('percentage')
  const [savedEffFrom,   setSavedEffFrom]   = useState<string>('')
  const [savedEffTo,     setSavedEffTo]     = useState<string | null>(null)
  const [recalcDone,     setRecalcDone]     = useState(0)

  const selectedOption = incomeTypeOptions.find(o => o.id === selectedIncomeTypeId) ?? null

  useEffect(() => {
    if (!open) return
    reloadIncomeTypes()
    setError(null)
    setImpactPhase('idle')
    setRecalcReason('')
    setSavedGroupId(null)
    setSavedVersionId(null)

    const today = new Date().toISOString().slice(0, 10)

    if (mode === 'new_group') {
      setName('')
      setEffectiveFrom(today)
      setAllocType('percentage')
      setTotalAmount('')
      setRows([{ category_name: '', budget_portion: '', value: '' }])
      setSelectedIncomeTypeId('')
    } else {
      // new_version: pre-fill from copyFromVersion or group active version
      const src = copyFromVersion ?? group?.active_version ?? null
      setEffectiveFrom(today)
      if (src) {
        setAllocType(src.allocation_type ?? 'percentage')
        setTotalAmount(src.total_amount != null ? String(src.total_amount) : '')
        setRows(
          src.rows.length > 0
            ? src.rows.map(r => ({
                category_name:  r.category_name,
                budget_portion: r.budget_portion ?? '',
                value: String(
                  (src.allocation_type ?? 'percentage') === 'amount'
                    ? (r.amount ?? '')
                    : (r.percentage ?? '')
                ),
              }))
            : [{ category_name: '', budget_portion: '', value: '' }]
        )
      } else {
        setAllocType('percentage')
        setTotalAmount('')
        setRows([{ category_name: '', budget_portion: '', value: '' }])
      }
    }
  }, [open, mode, group, copyFromVersion]) // eslint-disable-line react-hooks/exhaustive-deps

  const addRow    = () => setRows(prev => [...prev, { category_name: '', budget_portion: '', value: '' }])
  const removeRow = (i: number) => setRows(prev => prev.filter((_, idx) => idx !== i))
  const setRowField = (i: number, field: keyof RowDraft, val: string) =>
    setRows(prev => prev.map((r, idx) => idx === i ? { ...r, [field]: val } : r))

  const runningTotal = rows.reduce((s, r) => s + (parseFloat(r.value) || 0), 0)
  const target = allocType === 'percentage' ? 100 : (parseFloat(totalAmount) || 0)
  const balanced = target > 0 && Math.abs(runningTotal - target) < 0.01

  const buildDbRows = (): AllocationConfig['rows'] => {
    const valid = rows.filter(r => r.category_name && r.value)
    return valid.map(r => ({
      category_name:  r.category_name,
      budget_portion: r.budget_portion || undefined,
      ...(allocType === 'percentage'
        ? { percentage: parseFloat(r.value) }
        : { amount: parseFloat(r.value) }),
    }))
  }

  const handleSave = async (lockAfterSave: boolean) => {
    setError(null)
    if (mode === 'new_group' && !name.trim()) { setError('Name is required'); return }
    if (!effectiveFrom) { setError('Effective from date is required'); return }
    if (allocType === 'amount' && (!totalAmount || parseFloat(totalAmount) <= 0)) {
      setError('Total amount is required for amount-type configs'); return
    }
    const dbRows = buildDbRows()
    if (dbRows.length === 0) { setError('Add at least one category row'); return }

    const status: 'draft' | 'locked' = lockAfterSave ? 'locked' : 'draft'
    setSaving(true)
    try {
      if (mode === 'new_group') {
        const prevLinked = incomeTypeOptions.find(o => o.special_config_id != null && o.id === selectedIncomeTypeId)
        const { groupId, config } = await createGroupWithFirstVersion({
          name:            name.trim(),
          allocation_type: allocType,
          total_amount:    allocType === 'amount' ? parseFloat(totalAmount) : null,
          rows:            dbRows,
          effective_from:  effectiveFrom,
          status,
          income_type_id:  selectedIncomeTypeId || null,
          prev_income_type_id: prevLinked?.id ?? null,
        })
        setSavedGroupId(groupId)
        onSaved(config)
      } else {
        if (!group) throw new Error('Group is required for new_version mode')
        const vId = await createNewVersion({
          group,
          allocation_type: allocType,
          total_amount:    allocType === 'amount' ? parseFloat(totalAmount) : null,
          rows:            dbRows,
          effective_from:  effectiveFrom,
          status,
        })
        setSavedVersionId(vId)
        setSavedRows(dbRows)
        setSavedAllocType(allocType)
        setSavedEffFrom(effectiveFrom)

        const today = new Date().toISOString().slice(0, 10)
        const isBackdated = effectiveFrom < today

        if (isBackdated && status === 'locked') {
          const covering = group.versions.find(v =>
            v.effective_from != null &&
            v.effective_from <= effectiveFrom &&
            (v.effective_to == null || v.effective_to >= effectiveFrom)
          )
          const newEffTo = covering
            ? subtractOneDay(effectiveFrom)
            : null
          setSavedEffTo(newEffTo)

          const count = await getImpactedTransactionCount(group.id, effectiveFrom, newEffTo)
          setImpactCount(count)
          if (count > 0) {
            setImpactPhase('prompting')
            setSaving(false)
            return
          }
        }
        onSaved()
      }
    } catch (e: unknown) {
      setError((e as { message?: string })?.message ?? 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const handleKeepExisting = () => {
    setImpactPhase('idle')
    onSaved()
  }

  const handleRecalculate = () => {
    setImpactPhase('reason')
  }

  const handleConfirmRecalc = async () => {
    if (!savedVersionId || !savedGroupId || !group) return
    setImpactPhase('recalculating')
    try {
      const { data: { user } } = await supabase.auth.getUser()
      const userId = user?.id ?? ''
      const count = await recalculateTransactions({
        groupId:       group.id,
        newVersionId:  savedVersionId,
        effectiveFrom: savedEffFrom,
        effectiveTo:   savedEffTo,
        rows:          savedRows,
        allocationType: savedAllocType,
        reason:        recalcReason.trim() || 'Manual recalculation',
        userId,
      })
      setRecalcDone(count)
      setImpactPhase('done')
    } catch (e: unknown) {
      setError((e as { message?: string })?.message ?? 'Recalculation failed')
      setImpactPhase('prompting')
    }
  }

  const handleDoneAfterRecalc = () => {
    setImpactPhase('idle')
    onSaved()
  }

  const title = mode === 'new_group'
    ? 'Create Special Config'
    : `New Version — ${group?.name ?? ''}`

  return (
    <Modal open={open} onClose={onClose} title={title} size="max-w-xl">
      <div className="space-y-4">

        {/* Name (new_group only) */}
        {mode === 'new_group' && (
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
        )}

        {/* Effective From */}
        <div className="space-y-1">
          <label className="text-xs font-medium text-gray-600">Effective From *</label>
          <input
            type="date"
            value={effectiveFrom}
            onChange={e => setEffectiveFrom(e.target.value)}
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
            <span className={`text-xs font-mono font-semibold ${balanced ? 'text-green-600' : 'text-amber-600'}`}>
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
                    onChange={n => setRowField(i, 'category_name', n)}
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

        {/* Linked Income Type (new_group only) */}
        {mode === 'new_group' && (
          <div className="border border-gray-100 rounded-lg p-4 space-y-3 bg-gray-50">
            <div className="flex items-center gap-2">
              <Link2 className="w-3.5 h-3.5 text-gray-400" />
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Linked Income Type</p>
            </div>
            <p className="text-[11px] text-gray-400">
              When a transaction matches this income type, this config will be auto-applied.
            </p>
            {selectedIncomeTypeId ? (
              <div className="flex items-center gap-3">
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
          </div>
        )}

        {/* Impact prompt (backdated new_version) */}
        {impactPhase === 'prompting' && (
          <div className="border border-amber-200 rounded-lg p-4 space-y-3 bg-amber-50">
            <div className="flex items-start gap-2 text-sm text-amber-800">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <p>
                This version is backdated to <strong>{effectiveFrom}</strong>.{' '}
                <strong>{impactCount}</strong> transaction{impactCount !== 1 ? 's are' : ' is'} currently using a
                different config version for dates in this range.
              </p>
            </div>
            <div className="flex gap-2 flex-wrap">
              <button
                type="button"
                onClick={handleKeepExisting}
                className="px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-100 transition-colors"
              >
                Keep Existing (Future Only)
              </button>
              <button
                type="button"
                onClick={handleRecalculate}
                className="px-4 py-2 text-sm font-medium text-white bg-amber-600 rounded-lg hover:bg-amber-700 transition-colors"
              >
                Recalculate {impactCount} Transaction{impactCount !== 1 ? 's' : ''}
              </button>
            </div>
          </div>
        )}

        {/* Reason input for recalculation */}
        {impactPhase === 'reason' && (
          <div className="border border-blue-200 rounded-lg p-4 space-y-3 bg-blue-50">
            <p className="text-sm font-medium text-blue-900">Reason for recalculation</p>
            <input
              type="text"
              value={recalcReason}
              onChange={e => setRecalcReason(e.target.value)}
              placeholder="e.g. Config correction for Easter series"
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-primary/30 bg-white"
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setImpactPhase('prompting')}
                className="px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-100"
              >
                Back
              </button>
              <button
                type="button"
                onClick={handleConfirmRecalc}
                className="px-4 py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary-light transition-colors"
              >
                Confirm Recalculation
              </button>
            </div>
          </div>
        )}

        {impactPhase === 'recalculating' && (
          <div className="flex items-center gap-3 text-sm text-gray-600 bg-gray-50 border border-gray-200 rounded-lg px-4 py-3">
            <span className="w-4 h-4 border-2 border-gray-400 border-t-transparent rounded-full animate-spin shrink-0" />
            Recalculating transactions...
          </div>
        )}

        {impactPhase === 'done' && (
          <div className="border border-green-200 rounded-lg p-4 bg-green-50 space-y-3">
            <p className="text-sm text-green-800 font-medium">
              Recalculated {recalcDone} transaction{recalcDone !== 1 ? 's' : ''} successfully.
            </p>
            <button
              type="button"
              onClick={handleDoneAfterRecalc}
              className="px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 transition-colors"
            >
              Done
            </button>
          </div>
        )}

        {/* Error */}
        {error && (() => {
          const isMigration = /is_special|allocation_type|total_amount|Could not find|config_group_id|effective_from/.test(error)
          return (
            <div className="space-y-2">
              <div className="flex items-start gap-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span>{isMigration
                  ? 'Database migration required. Run the SQL below in your Supabase SQL Editor, then try again.'
                  : error}
                </span>
              </div>
              {isMigration && (
                <div className="rounded-lg border border-gray-200 bg-gray-900 overflow-hidden">
                  <pre className="px-3 py-3 text-[11px] text-green-300 font-mono overflow-x-auto whitespace-pre">{MIGRATION_SQL}</pre>
                </div>
              )}
            </div>
          )
        })()}

        {/* Footer (hidden during impact flow) */}
        {impactPhase === 'idle' && (
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
              {saving ? 'Saving...' : 'Save as Draft'}
            </button>
            <button
              type="button"
              onClick={() => handleSave(true)}
              disabled={saving}
              className="flex items-center gap-2 px-5 py-2 text-sm font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 disabled:opacity-60"
            >
              {saving && <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />}
              {saving ? 'Saving...' : 'Save & Lock'}
            </button>
          </div>
        )}

        {(impactPhase === 'prompting' || impactPhase === 'reason') && (
          <div className="flex justify-end pt-1">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50"
            >
              Close
            </button>
          </div>
        )}
      </div>
    </Modal>
  )
}

function subtractOneDay(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}
