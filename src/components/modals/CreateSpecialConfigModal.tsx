import { useState, useEffect, useRef, useMemo } from 'react'
import { Plus, Trash2, AlertTriangle, Link2, Unlink, GitBranch } from 'lucide-react'
import { Modal, type ModalHandle } from '../ui/Modal'
import { InlineCategorySelect } from '../ui/InlineCategorySelect'
import { useCategories } from '../../hooks/useCategories'
import type { AllocationConfig } from '../../store/allocationStore'
import {
  createGroupWithFirstVersion,
  createNewVersion,
  createVersionWithSplit,
  amendVersion,
  detectVersionOverlap,
  type SpecialConfigGroupWithVersions,
  type VersionOverlap,
} from '../../hooks/useSpecialConfigGroups'
import { useIncomeTypeOptions } from '../../hooks/useIncomeTypes'
import { useOrgCurrency } from '../../hooks/useOrgCurrency'

export const MIGRATION_SQL =
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
  open:              boolean
  onClose:           () => void
  onSaved:           (cfg?: AllocationConfig) => void
  mode:              'new_group' | 'new_version' | 'amend_version'
  group?:            SpecialConfigGroupWithVersions | null
  copyFromVersion?:  AllocationConfig | null
  versionToAmend?:   AllocationConfig | null
}

interface RowDraft {
  category_name:  string
  budget_portion: string
  value:          string
}

export function CreateSpecialConfigModal({ open, onClose, onSaved, mode, group, copyFromVersion, versionToAmend }: Props) {
  const { baseCurrencySymbol } = useOrgCurrency()
  const { categories, refetch: refetchCategories } = useCategories()
  const { options: incomeTypeOptions, reload: reloadIncomeTypes } = useIncomeTypeOptions()

  const [name,                 setName]                 = useState('')
  const [effectiveFrom,        setEffectiveFrom]        = useState('')
  const [effectiveTo,          setEffectiveTo]          = useState('')
  const [allocType,            setAllocType]            = useState<'percentage' | 'amount'>('percentage')
  const [totalAmount,          setTotalAmount]          = useState('')
  const [rows,                 setRows]                 = useState<RowDraft[]>([{ category_name: '', budget_portion: '', value: '' }])
  const [saving,               setSaving]               = useState(false)
  const [error,                setError]                = useState<string | null>(null)
  const [selectedIncomeTypeId, setSelectedIncomeTypeId] = useState<string>('')
  const [wasModified,          setWasModified]          = useState(false)
  const [amendmentReason,      setAmendmentReason]      = useState('')
  const modalRef = useRef<ModalHandle>(null)

  const isDirty = wasModified && !saving

  const selectedOption = incomeTypeOptions.find(o => o.id === selectedIncomeTypeId) ?? null

  const isAmend = mode === 'amend_version'

  // Detect overlaps when effective dates change (new_version mode only)
  const overlaps = useMemo((): VersionOverlap[] => {
    if (mode !== 'new_version' || !group || !effectiveFrom) return []
    return detectVersionOverlap(
      group.versions,
      effectiveFrom,
      effectiveTo || null,
    )
  }, [mode, group, effectiveFrom, effectiveTo])

  useEffect(() => {
    if (!open) return
    reloadIncomeTypes()
    setError(null)
    setWasModified(false)
    setAmendmentReason('')

    const today = new Date().toISOString().slice(0, 10)

    if (mode === 'new_group') {
      setName('')
      setEffectiveFrom(today)
      setEffectiveTo('')
      setAllocType('percentage')
      setTotalAmount('')
      setRows([{ category_name: '', budget_portion: '', value: '' }])
      setSelectedIncomeTypeId('')
    } else if (mode === 'amend_version') {
      const src = versionToAmend
      if (src) {
        setEffectiveFrom(src.effective_from ?? today)
        setEffectiveTo(src.effective_to ?? '')
        setAllocType(src.allocation_type ?? 'percentage')
        setTotalAmount(src.total_amount != null ? String(src.total_amount) : '')
        setRows(
          src.rows.length > 0
            ? src.rows.map(r => ({
                category_name:  r.category_name,
                budget_portion: r.budget_portion === 'Percentage Allocation' ? 'Percentage' : (r.budget_portion ?? ''),
                value: String(
                  (src.allocation_type ?? 'percentage') === 'amount'
                    ? (r.amount ?? '')
                    : (r.percentage ?? '')
                ),
              }))
            : [{ category_name: '', budget_portion: '', value: '' }]
        )
      }
    } else {
      // new_version: pre-fill from copyFromVersion or group active version
      const src = copyFromVersion ?? group?.active_version ?? null
      setEffectiveFrom(today)
      setEffectiveTo('')
      if (src) {
        setAllocType(src.allocation_type ?? 'percentage')
        setTotalAmount(src.total_amount != null ? String(src.total_amount) : '')
        setRows(
          src.rows.length > 0
            ? src.rows.map(r => ({
                category_name:  r.category_name,
                budget_portion: r.budget_portion === 'Percentage Allocation' ? 'Percentage' : (r.budget_portion ?? ''),
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
  }, [open, mode, group, copyFromVersion, versionToAmend]) // eslint-disable-line react-hooks/exhaustive-deps

  const addRow    = () => { setWasModified(true); setRows(prev => [...prev, { category_name: '', budget_portion: '', value: '' }]) }
  const removeRow = (i: number) => { setWasModified(true); setRows(prev => prev.filter((_, idx) => idx !== i)) }
  const setRowField = (i: number, field: keyof RowDraft, val: string) => {
    setWasModified(true)
    setRows(prev => prev.map((r, idx) => idx === i ? { ...r, [field]: val } : r))
  }

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
    if (isAmend && !amendmentReason.trim()) { setError('Amendment reason is required'); return }
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
        const { config } = await createGroupWithFirstVersion({
          name:            name.trim(),
          allocation_type: allocType,
          total_amount:    allocType === 'amount' ? parseFloat(totalAmount) : null,
          rows:            dbRows,
          effective_from:  effectiveFrom,
          status,
          income_type_id:  selectedIncomeTypeId || null,
          prev_income_type_id: prevLinked?.id ?? null,
        })
        onSaved(config)
      } else if (isAmend) {
        if (!versionToAmend) throw new Error('Version to amend is required')
        await amendVersion({
          original:         versionToAmend,
          allocation_type:  allocType,
          total_amount:     allocType === 'amount' ? parseFloat(totalAmount) : null,
          rows:             dbRows,
          effective_from:   effectiveFrom,
          effective_to:     effectiveTo || null,
          amendment_reason: amendmentReason.trim(),
        })
        onSaved()
      } else {
        if (!group) throw new Error('Group is required for new_version mode')
        if (overlaps.length > 0) {
          await createVersionWithSplit({
            group,
            allocation_type: allocType,
            total_amount:    allocType === 'amount' ? parseFloat(totalAmount) : null,
            rows:            dbRows,
            effective_from:  effectiveFrom,
            effective_to:    effectiveTo || null,
            status,
            overlaps,
          })
        } else {
          await createNewVersion({
            group,
            allocation_type: allocType,
            total_amount:    allocType === 'amount' ? parseFloat(totalAmount) : null,
            rows:            dbRows,
            effective_from:  effectiveFrom,
            status,
          })
        }
        onSaved()
      }
    } catch (e: unknown) {
      setError((e as { message?: string })?.message ?? 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const title = mode === 'new_group'
    ? 'Create Special Rule'
    : isAmend
      ? `Amend Version — ${versionToAmend ? `v${versionToAmend.version_number}` : ''}`
      : `New Version — ${group?.name ?? ''}`

  return (
    <Modal
      ref={modalRef}
      open={open}
      onClose={onClose}
      title={title}
      size="max-w-xl"
      isDirty={isDirty}
      disableClose={saving}
    >
      <div className="space-y-4">

        {/* Amendment warning banner */}
        {isAmend && (
          <div className="flex items-start gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5">
            <GitBranch className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span>
              This creates an amendment that supersedes the original version. The original will be marked superseded and preserved for audit history. Dates are locked to the original version's period.
            </span>
          </div>
        )}

        {/* Name (new_group only) */}
        {mode === 'new_group' && (
          <div className="space-y-1">
            <label className="text-xs font-medium text-gray-600">Name *</label>
            <input
              type="text"
              value={name}
              onChange={e => { setName(e.target.value); setWasModified(true) }}
              placeholder="e.g. Easter Special Allocation"
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-primary/30 bg-white"
            />
          </div>
        )}

        {/* Effective From / To */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-xs font-medium text-gray-600">Effective From *</label>
            <input
              type="date"
              value={effectiveFrom}
              readOnly={isAmend}
              onChange={e => { if (!isAmend) { setEffectiveFrom(e.target.value); setWasModified(true) } }}
              className={`w-full px-3 py-2 text-sm border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-primary/30 bg-white ${isAmend ? 'opacity-60 cursor-not-allowed' : ''}`}
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-gray-600">Effective To</label>
            <input
              type="date"
              value={effectiveTo}
              readOnly={isAmend}
              onChange={e => { if (!isAmend) { setEffectiveTo(e.target.value); setWasModified(true) } }}
              placeholder="open-ended"
              className={`w-full px-3 py-2 text-sm border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-primary/30 bg-white ${isAmend ? 'opacity-60 cursor-not-allowed' : ''}`}
            />
          </div>
        </div>

        {/* Overlap warning (new_version only) */}
        {mode === 'new_version' && overlaps.length > 0 && (
          <div className="space-y-1 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5">
            <div className="flex items-center gap-1.5 font-semibold">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              Date overlap detected — affected versions will be split or trimmed:
            </div>
            <ul className="mt-1 space-y-0.5 pl-5 list-disc">
              {overlaps.map(ov => (
                <li key={ov.version.id}>
                  v{ov.version.version_number} ({ov.version.effective_from} → {ov.version.effective_to ?? 'open'})
                  {ov.wouldSplit ? ' — will be split into before/after segments' : ' — will be trimmed'}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Type toggle */}
        <div className="space-y-1">
          <label className="text-xs font-medium text-gray-600">Allocation Type</label>
          <div className="flex gap-2">
            {(['percentage', 'amount'] as const).map(t => (
              <button
                key={t}
                type="button"
                onClick={() => { setAllocType(t); setWasModified(true) }}
                className={`px-4 py-1.5 text-sm font-medium rounded-lg border transition-colors ${
                  allocType === t
                    ? 'bg-primary text-white border-primary'
                    : 'bg-white text-gray-600 border-gray-300 hover:border-primary'
                }`}
              >
                {t === 'percentage' ? 'Percentage %' : `Amount ${baseCurrencySymbol}`}
              </button>
            ))}
          </div>
        </div>

        {/* Total amount (amount-type only) */}
        {allocType === 'amount' && (
          <div className="space-y-1">
            <label className="text-xs font-medium text-gray-600">Total Amount ({baseCurrencySymbol}) *</label>
            <input
              type="text" inputMode="decimal"
              min="0"
              step="0.01"
              value={totalAmount}
              onChange={e => { setTotalAmount(e.target.value); setWasModified(true) }}
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
                : `${baseCurrencySymbol}${runningTotal.toLocaleString()} / ${baseCurrencySymbol}${(parseFloat(totalAmount) || 0).toLocaleString()}`}
            </span>
          </div>

          <div className="border border-gray-200 rounded-lg overflow-hidden">
            <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_80px_32px] bg-black/[0.02] dark:bg-white/[0.02] px-3 py-2 text-[11px] font-bold text-gray-400 uppercase tracking-widest border-b border-black/[0.06] dark:border-white/[0.07]">
              <span>Category</span>
              <span>Budget Portion</span>
              <span>{allocType === 'percentage' ? '%' : `${baseCurrencySymbol} Amount`}</span>
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
                    <option value="Percentage">Regular Funds</option>
                    <option value="Specific Seed">Designated Gift</option>
                    <option value="Savings">Savings Funds</option>
                  </select>
                  <input
                    type="text" inputMode="decimal"
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
                    className="touch-target p-1 rounded text-gray-300 hover:text-danger hover:bg-red-50 transition-colors"
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
              : `Total ${baseCurrencySymbol}${runningTotal.toLocaleString()} doesn't match ${baseCurrencySymbol}${(parseFloat(totalAmount) || 0).toLocaleString()}`}
          </div>
        )}

        {/* Amendment reason (amend_version only) */}
        {isAmend && (
          <div className="space-y-1">
            <label className="text-xs font-medium text-gray-600">Amendment Reason *</label>
            <textarea
              value={amendmentReason}
              onChange={e => { setAmendmentReason(e.target.value); setWasModified(true) }}
              placeholder="Describe why this amendment is needed…"
              rows={2}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-primary/30 bg-white resize-none"
            />
          </div>
        )}

        {/* Linked Income Type (new_group only) */}
        {mode === 'new_group' && (
          <div className="border border-gray-100 rounded-lg p-4 space-y-3 bg-gray-50">
            <div className="flex items-center gap-2">
              <Link2 className="w-3.5 h-3.5 text-gray-400" />
              <p className="text-xs font-semibold text-gray-500">Linked Income Type</p>
            </div>
            <p className="text-xs text-gray-500">
              When a transaction matches this income type, this config will be auto-applied.
            </p>
            {selectedIncomeTypeId ? (
              <div className="flex items-center gap-3">
                {selectedOption && (
                  <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: selectedOption.color }} />
                )}
                <select
                  value={selectedIncomeTypeId}
                  onChange={e => { setSelectedIncomeTypeId(e.target.value); setWasModified(true) }}
                  className="flex-1 px-2 py-1.5 text-xs border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-primary/30"
                >
                  <option value="">— None —</option>
                  {incomeTypeOptions.map(o => (
                    <option key={o.id} value={o.id}>{o.name}</option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => { setSelectedIncomeTypeId(''); setWasModified(true) }}
                  className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-gray-600 bg-white border border-gray-300 rounded-lg hover:border-danger hover:text-danger transition-colors"
                >
                  <Unlink className="w-3 h-3" /> Disconnect
                </button>
              </div>
            ) : (
              <select
                value=""
                onChange={e => { setSelectedIncomeTypeId(e.target.value); setWasModified(true) }}
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
        {/* Error */}
        {error && (() => {
          const isMigration = /is_special|allocation_type|total_amount|Could not find|config_group_id|effective_from/.test(error)
          return (
            <div className="space-y-2">
              <div className="flex items-start gap-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span>{isMigration
                  ? 'Database migration required — please contact your administrator, then try again.'
                  : error}
                </span>
              </div>
            </div>
          )
        })()}

        {/* Footer */}
        <div className="flex justify-end gap-3 pt-1">
          <button
            type="button"
            onClick={() => modalRef.current?.requestClose()}
            className="px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            Cancel
          </button>
          {!isAmend && (
            <button
              type="button"
              onClick={() => handleSave(false)}
              disabled={saving}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-60"
            >
              {saving && <span className="w-3.5 h-3.5 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />}
              {saving ? 'Saving...' : 'Save as Draft'}
            </button>
          )}
          <button
            type="button"
            onClick={() => handleSave(true)}
            disabled={saving}
            className="flex items-center gap-2 px-5 py-2 text-sm font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 disabled:opacity-60"
          >
            {saving && <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />}
            {saving ? 'Saving...' : isAmend ? 'Save Amendment' : 'Save & Lock'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
