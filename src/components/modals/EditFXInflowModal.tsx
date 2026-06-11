import { useState, useEffect, useRef } from 'react'
import { Download } from 'lucide-react'
import { Modal, type ModalHandle } from '../ui/Modal'
import { useUpdateTransaction } from '../../hooks/useMutations'
import { useAllocationStore } from '../../store/allocationStore'
import { useBanks } from '../../hooks/useBanks'
import { supabase } from '../../lib/supabase'
import { useOrgStore } from '../../store/orgStore'
import { useOrgCurrency } from '../../hooks/useOrgCurrency'
import type { InflowTransaction } from '../../hooks/useTransactions'

interface Props {
  open:       boolean
  onClose:    () => void
  onSuccess:  () => void
  record:     InflowTransaction | null
}

export function EditFXInflowModal({ open, onClose, onSuccess, record }: Props) {
  const updateMutation = useUpdateTransaction('inflow_transactions')
  const { configs } = useAllocationStore()
  const { banks } = useBanks()
  const { baseCurrencyCode, baseCurrencySymbol, formatLocale, getCurrencySymbol } = useOrgCurrency()
  const orgId = useOrgStore(s => s.orgId)
  const ngnBanks = banks.filter(b => !b.is_foreign_currency)

  const [description, setDescription] = useState('')
  const [bankName,    setBankName]    = useState('')
  const [stageCode1,  setStageCode1]  = useState('')
  const [stageCode2,  setStageCode2]  = useState('')
  const [configId,    setConfigId]    = useState('')
  const [loadingNarr, setLoadingNarr] = useState(false)

  const modalRef = useRef<ModalHandle>(null)

  const isDirty = record ? (
    description !== (record.description ?? '') ||
    bankName    !== (record.bank_name ?? '')    ||
    stageCode1  !== (record.stage_code_1 ?? '') ||
    stageCode2  !== (record.stage_code_2 ?? '') ||
    configId    !== (record.allocation_config_id ?? '')
  ) : false

  useEffect(() => {
    if (!open || !record) return
    updateMutation.reset()
    setDescription(record.description ?? '')
    setBankName(record.bank_name ?? '')
    setStageCode1(record.stage_code_1 ?? '')
    setStageCode2(record.stage_code_2 ?? '')
    setConfigId(record.allocation_config_id ?? '')
  }, [open, record]) // eslint-disable-line react-hooks/exhaustive-deps

  const loadFXNarration = async () => {
    if (!record || !orgId) return
    setLoadingNarr(true)
    try {
      const { data: conv } = await supabase
        .from('fx_conversions')
        .select('fx_withdrawal_id')
        .eq('naira_inflow_id', record.id)
        .eq('org_id', orgId)
        .maybeSingle()
      if (conv?.fx_withdrawal_id) {
        const { data: fxTx } = await supabase
          .from('fx_transactions')
          .select('narration')
          .eq('id', conv.fx_withdrawal_id)
          .maybeSingle()
        if (fxTx?.narration) setDescription(fxTx.narration)
      }
    } finally { setLoadingNarr(false) }
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!record) return
    try {
      await updateMutation.mutate({
        id: record.id,
        updates: {
          description:          description.trim() || null,
          bank_name:            bankName.trim() || null,
          stage_code_1:         stageCode1.trim() || null,
          stage_code_2:         stageCode2.trim() || null,
          allocation_config_id: configId || null,
        },
      })
      onSuccess()
      onClose()
    } catch { /* surfaced via hook */ }
  }

  const iCls = 'w-full px-3 py-2 text-sm border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-white'

  if (!record) return null
  const fxSym = record.fx_currency ? getCurrencySymbol(record.fx_currency) : ''

  return (
    <Modal ref={modalRef} open={open} onClose={onClose} title="Edit FX Conversion Inflow" size="max-w-md" isDirty={isDirty} disableClose={updateMutation.loading}>
      <form onSubmit={handleSave} className="space-y-4" noValidate>
        {updateMutation.error && (
          <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{updateMutation.error}</p>
        )}

        {/* Read-only info */}
        <div className="grid grid-cols-2 gap-3 p-3 bg-gray-50 rounded-lg border border-gray-100 text-xs">
          <div><p className="text-gray-400 mb-0.5">Date</p><p className="font-medium text-gray-700">{record.date}</p></div>
          <div>
            <p className="text-gray-400 mb-0.5">{baseCurrencyCode} Amount</p>
            <p className="font-mono font-semibold text-success">{baseCurrencySymbol}{Number(record.amount).toLocaleString(formatLocale, { minimumFractionDigits: 2 })}</p>
          </div>
          {record.fx_currency && (
            <>
              <div><p className="text-gray-400 mb-0.5">FX Currency</p><p className="font-mono font-semibold text-gray-700">{record.fx_currency}</p></div>
              <div>
                <p className="text-gray-400 mb-0.5">FX Amount</p>
                <p className="font-mono text-gray-700">{fxSym}{Number(record.fx_amount ?? 0).toLocaleString(undefined, { minimumFractionDigits: 4 })}</p>
              </div>
              {record.fx_rate && (
                <div className="col-span-2">
                  <p className="text-gray-400 mb-0.5">Rate</p>
                  <p className="font-mono text-gray-700">{baseCurrencySymbol}{Number(record.fx_rate).toLocaleString(undefined, { minimumFractionDigits: 4 })} per {record.fx_currency}</p>
                </div>
              )}
            </>
          )}
        </div>

        {/* Description + narration load */}
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium text-gray-600">Description</label>
            <button type="button" onClick={loadFXNarration} disabled={loadingNarr}
              className="flex items-center gap-1 text-[10px] text-primary hover:underline disabled:opacity-50">
              <Download className="w-3 h-3" />
              {loadingNarr ? 'Loading…' : 'Load FX narration'}
            </button>
          </div>
          <input type="text" value={description} onChange={e => setDescription(e.target.value)}
            placeholder="Description" className={iCls} />
        </div>

        {/* Bank */}
        <div className="space-y-1">
          <label className="text-xs font-medium text-gray-600">Receiving Bank</label>
          {ngnBanks.length > 0 ? (
            <select value={bankName} onChange={e => setBankName(e.target.value)} className={iCls}>
              <option value="">— Select bank —</option>
              {ngnBanks.map(b => <option key={b.id} value={b.name}>{b.name}</option>)}
            </select>
          ) : (
            <input type="text" value={bankName} onChange={e => setBankName(e.target.value)}
              placeholder="Bank name" className={iCls} />
          )}
        </div>

        {/* Allocation */}
        <div className="border border-gray-100 rounded-lg p-3 space-y-3 bg-gray-50">
          <p className="text-xs font-semibold text-gray-500">Allocation</p>
          <div className="space-y-1">
            <label className="text-xs font-medium text-gray-600">Allocation Config</label>
            <select value={configId} onChange={e => setConfigId(e.target.value)} className={iCls}>
              <option value="">— Auto-detect by date —</option>
              {configs.filter(c => c.status === 'locked').map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-600">Category</label>
              <input type="text" value={stageCode1} onChange={e => setStageCode1(e.target.value)}
                placeholder="e.g. 100" className={iCls} />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-600">Fund Type</label>
              <input type="text" value={stageCode2} onChange={e => setStageCode2(e.target.value)}
                placeholder="e.g. Percentage Allocation" className={iCls} />
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <button type="button" onClick={() => modalRef.current?.requestClose()} disabled={updateMutation.loading}
            className="px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50">
            Cancel
          </button>
          <button type="submit" disabled={updateMutation.loading}
            className="px-5 py-2 text-sm text-white bg-primary rounded-lg hover:bg-primary-light disabled:opacity-60 flex items-center gap-2">
            {updateMutation.loading && <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
            {updateMutation.loading ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
