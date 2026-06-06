import { useState, useEffect, useRef } from 'react'
import { Modal, type ModalHandle } from '../ui/Modal'
import { filterInputCls }         from '../ui/FormField'
import { SearchableSelect }       from '../ui/SearchableSelect'
import { useBulkUpdateTransaction } from '../../hooks/useMutations'
import { useToastStore }          from '../../store/toastStore'
import { useCategories }          from '../../hooks/useCategories'
import { useOutflowTypes }        from '../../hooks/useOutflowTypes'

export function BulkEditOutflowModal({ open, onClose, ids, banks, onSuccess }: {
  open: boolean
  onClose: () => void
  ids: string[]
  banks: { id: string; name: string }[]
  onSuccess: () => void
}) {
  const { execute, loading: saving } = useBulkUpdateTransaction('outflow_transactions')
  const { push: toast }             = useToastStore()
  const { categories }              = useCategories()
  const { outflowTypes }            = useOutflowTypes()

  const [bankName,      setBankName]      = useState('')
  const [recordedAt,    setRecordedAt]    = useState('')
  const [txnType,       setTxnType]       = useState('')
  const [stageCode1,    setStageCode1]    = useState('')
  const [stageCode2,    setStageCode2]    = useState('')
  const [outflowTypeId, setOutflowTypeId] = useState('')

  useEffect(() => {
    if (open) return
    setBankName('')
    setRecordedAt('')
    setTxnType('')
    setStageCode1('')
    setStageCode2('')
    setOutflowTypeId('')
  }, [open])

  const hasChanges = !!bankName || !!recordedAt || !!txnType || !!stageCode1 || !!stageCode2 || !!outflowTypeId
  const modalRef = useRef<ModalHandle>(null)

  const handleApply = async () => {
    if (!hasChanges) return
    const baseUpdates: Record<string, unknown> = {}
    if (bankName)      baseUpdates.bank_name       = bankName
    if (recordedAt)    baseUpdates.recorded_at     = `${recordedAt}T00:00:00.000Z`
    if (txnType)       baseUpdates.transaction_type = txnType
    if (stageCode1)    baseUpdates.stage_code_1    = stageCode1
    if (stageCode2)    baseUpdates.stage_code_2    = stageCode2
    if (outflowTypeId) baseUpdates.outflow_type_id = outflowTypeId

    const { failed } = await execute(ids, baseUpdates)
    if (failed === 0) toast(`Updated ${ids.length} transaction${ids.length !== 1 ? 's' : ''}`, 'success')
    else toast(`${ids.length - failed} updated, ${failed} failed`, 'error')
    onSuccess()
    onClose()
  }

  return (
    <Modal ref={modalRef} open={open} onClose={onClose} title={`Bulk Edit ${ids.length} Transaction${ids.length !== 1 ? 's' : ''}`} size="max-w-md" isDirty={hasChanges} disableClose={saving}>
      <div className="space-y-4">
        <p className="text-sm text-gray-500">Only filled fields will be applied. Leave blank to keep existing values.</p>

        <div className="space-y-1">
          <label className="text-xs font-medium text-gray-500">Bank Name</label>
          <SearchableSelect value={bankName} onChange={setBankName}
            options={banks.map(b => ({ value: b.name, label: b.name }))}
            placeholder="— Keep existing —" className={filterInputCls} />
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium text-gray-500">Recorded Date</label>
          <input type="date" value={recordedAt} onChange={e => setRecordedAt(e.target.value)} className={filterInputCls} />
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium text-gray-500">Transaction Type</label>
          <select value={txnType} onChange={e => setTxnType(e.target.value)} className={filterInputCls}>
            <option value="">— Keep existing —</option>
            <option value="refund">Refund</option>
            <option value="reversal">Reversal</option>
            <option value="bank_deposit">Bank Deposit</option>
            <option value="intrabank_transfer">Intrabank Transfer</option>
          </select>
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium text-gray-500">Stage Code 1 (Category)</label>
          <SearchableSelect value={stageCode1} onChange={setStageCode1}
            options={categories.map(c => ({ value: c.name, label: c.name }))}
            placeholder="— Keep existing —" className={filterInputCls} />
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium text-gray-500">Stage Code 2 (Portion Type)</label>
          <select value={stageCode2} onChange={e => setStageCode2(e.target.value)} className={filterInputCls}>
            <option value="">— Keep existing —</option>
            <option value="Percentage Allocation">Percentage Allocation</option>
            <option value="Specific Seed">Specific Seed</option>
            <option value="Savings">Savings</option>
          </select>
        </div>

        {outflowTypes.length > 0 && (
          <div className="space-y-1">
            <label className="text-xs font-medium text-gray-500">Outflow Type</label>
            <SearchableSelect value={outflowTypeId} onChange={setOutflowTypeId}
              options={outflowTypes.map(t => ({ value: t.id, label: t.name }))}
              placeholder="— Keep existing —" className={filterInputCls} />
          </div>
        )}

        <div className="flex justify-end gap-3 pt-2">
          <button type="button" onClick={() => modalRef.current?.requestClose()} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
            Cancel
          </button>
          <button
            type="button"
            onClick={handleApply}
            disabled={saving || !hasChanges}
            className="px-4 py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary-light transition-colors disabled:opacity-50"
          >
            {saving ? 'Applying…' : `Apply to ${ids.length} record${ids.length !== 1 ? 's' : ''}`}
          </button>
        </div>
      </div>
    </Modal>
  )
}
