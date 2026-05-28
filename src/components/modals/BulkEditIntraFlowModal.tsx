import { useState, useEffect } from 'react'
import { Modal }                  from '../ui/Modal'
import { filterInputCls }         from '../ui/FormField'
import { useUpdateTransaction }   from '../../hooks/useMutations'
import { useBulkUpdateAction }    from '../../hooks/useBulkActions'
import { useToastStore }          from '../../store/toastStore'
import { useCategories }          from '../../hooks/useCategories'

const PORTIONS = ['Percentage Allocation', 'Specific Seed', 'Savings']

export function BulkEditIntraFlowModal({ open, onClose, ids, onSuccess }: {
  open: boolean
  onClose: () => void
  ids: string[]
  onSuccess: () => void
}) {
  const { mutate: update }           = useUpdateTransaction('intra_flows')
  const { execute, loading: saving } = useBulkUpdateAction(update)
  const { push: toast }              = useToastStore()
  const { categories }               = useCategories()

  const [date,              setDate]              = useState('')
  const [accountFrom,       setAccountFrom]       = useState('')
  const [accountFromStage2, setAccountFromStage2] = useState('')
  const [accountTo,         setAccountTo]         = useState('')
  const [accountToStage2,   setAccountToStage2]   = useState('')
  const [description,       setDescription]       = useState('')
  const [remark,            setRemark]            = useState('')

  useEffect(() => {
    if (open) return
    setDate('')
    setAccountFrom('')
    setAccountFromStage2('')
    setAccountTo('')
    setAccountToStage2('')
    setDescription('')
    setRemark('')
  }, [open])

  const hasChanges = !!date || !!accountFrom || !!accountFromStage2 || !!accountTo || !!accountToStage2 || !!description || !!remark

  const handleApply = async () => {
    if (!hasChanges) return
    const baseUpdates: Record<string, unknown> = {}
    if (date)              baseUpdates.date                = date
    if (accountFrom)       baseUpdates.account_from        = accountFrom
    if (accountFromStage2) baseUpdates.account_from_stage2 = accountFromStage2
    if (accountTo)         baseUpdates.account_to          = accountTo
    if (accountToStage2)   baseUpdates.account_to_stage2   = accountToStage2
    if (description)       baseUpdates.description         = description
    if (remark)            baseUpdates.remark              = remark

    const { failed, strippedCols } = await execute(ids, baseUpdates)
    for (const col of strippedCols) {
      toast(`⚠ ${col} column missing — run Setup → Database migration`, 'error')
    }
    if (failed === 0) toast(`Updated ${ids.length} transfer${ids.length !== 1 ? 's' : ''}`, 'success')
    else              toast(`${ids.length - failed} updated, ${failed} failed`, 'error')
    onSuccess()
    onClose()
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Bulk Edit ${ids.length} Transfer${ids.length !== 1 ? 's' : ''}`}
      size="max-w-md"
    >
      <div className="space-y-4">
        <p className="text-sm text-gray-500">Only filled fields will be applied. Leave blank to keep existing values.</p>

        <div className="space-y-1">
          <label className="text-xs font-medium text-gray-500">Date</label>
          <input type="date" value={date} onChange={e => setDate(e.target.value)} className={filterInputCls} />
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium text-gray-500">From Category</label>
          <select value={accountFrom} onChange={e => setAccountFrom(e.target.value)} className={`${filterInputCls} bg-white`}>
            <option value="">— Keep existing —</option>
            {categories.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
          </select>
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium text-gray-500">From Portion</label>
          <select value={accountFromStage2} onChange={e => setAccountFromStage2(e.target.value)} className={`${filterInputCls} bg-white`}>
            <option value="">— Keep existing —</option>
            {PORTIONS.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium text-gray-500">To Category</label>
          <select value={accountTo} onChange={e => setAccountTo(e.target.value)} className={`${filterInputCls} bg-white`}>
            <option value="">— Keep existing —</option>
            {categories.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
          </select>
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium text-gray-500">To Portion</label>
          <select value={accountToStage2} onChange={e => setAccountToStage2(e.target.value)} className={`${filterInputCls} bg-white`}>
            <option value="">— Keep existing —</option>
            {PORTIONS.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium text-gray-500">Description</label>
          <input
            type="text"
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="— Keep existing —"
            className={filterInputCls}
          />
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium text-gray-500">Remark</label>
          <input
            type="text"
            value={remark}
            onChange={e => setRemark(e.target.value)}
            placeholder="— Keep existing —"
            className={filterInputCls}
          />
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
          >
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
