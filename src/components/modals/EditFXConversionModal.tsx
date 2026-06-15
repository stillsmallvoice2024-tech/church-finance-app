import { useState, useEffect, useMemo, useRef } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { Modal, type ModalHandle } from '../ui/Modal'
import { useUpdateFXConversion, useRevertFXConversion, type FXConversion, type UpdateFXConversionInput } from '../../hooks/useFXConversions'
import { useAllocationStore } from '../../store/allocationStore'
import { useOrgCurrency } from '../../hooks/useOrgCurrency'
import { useBanks } from '../../hooks/useBanks'
import { getCurrencyLocale } from '../../utils/formatters'

interface Props {
  open:       boolean
  onClose:    () => void
  onSuccess:  () => void
  conversion: FXConversion | null
}

function fmtFX(n: number, code: string) {
  return n.toLocaleString(getCurrencyLocale(code), { minimumFractionDigits: 4, maximumFractionDigits: 4 })
}

export function EditFXConversionModal({ open, onClose, onSuccess, conversion }: Props) {
  const updateMutation = useUpdateFXConversion()
  const revertMutation = useRevertFXConversion()
  const { configs } = useAllocationStore()
  const { baseCurrencyCode, baseCurrencySymbol, formatLocale, getCurrencySymbol } = useOrgCurrency()
  const { banks } = useBanks()
  const ngnBanks = useMemo(() => banks.filter(b => !b.is_foreign_currency), [banks])

  const [rate,       setRate]       = useState('')
  const [notes,      setNotes]      = useState('')
  const [configId,   setConfigId]   = useState('')
  const [stageCode1, setStageCode1] = useState('')
  const [stageCode2, setStageCode2] = useState('')
  const [bankName,   setBankName]   = useState('')
  const [formError,  setFormError]  = useState<string | null>(null)
  const [revertMode, setRevertMode] = useState(false)

  const modalRef = useRef<ModalHandle>(null)

  useEffect(() => {
    if (!open || !conversion) return
    updateMutation.reset()
    revertMutation.reset()
    setFormError(null)
    setRevertMode(false)
    setRate(String(conversion.exchange_rate))
    setNotes(conversion.notes ?? '')
    setConfigId(conversion.allocation_config_id ?? '')
    setStageCode1('')
    setStageCode2('')
    setBankName('')
  }, [open, conversion]) // eslint-disable-line react-hooks/exhaustive-deps

  const fxAmt     = conversion?.fx_amount   ?? 0
  const rateNum   = parseFloat(rate) || 0
  const nairaAmt  = fxAmt * rateNum
  const fxSym     = conversion ? getCurrencySymbol(conversion.fx_currency) : ''
  const isDirty   = conversion ? (
    rate !== String(conversion.exchange_rate) ||
    notes !== (conversion.notes ?? '') ||
    configId !== (conversion.allocation_config_id ?? '') ||
    stageCode1 !== '' || stageCode2 !== '' || bankName !== ''
  ) : false

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!conversion) return
    setFormError(null)
    if (rateNum <= 0) { setFormError('Exchange rate must be positive.'); return }
    const input: UpdateFXConversionInput = {
      id:                    conversion.id,
      exchange_rate:         rateNum,
      naira_amount:          nairaAmt,
      notes:                 notes.trim() || null,
      allocation_config_id:  configId || null,
      stage_code_1:          stageCode1.trim() || null,
      stage_code_2:          stageCode2.trim() || null,
      bank_name:             bankName.trim() || null,
    }
    try {
      await updateMutation.mutate(input)
      onSuccess()
      onClose()
    } catch { /* surfaced via hook */ }
  }

  const handleRevert = async () => {
    if (!conversion) return
    try {
      await revertMutation.mutate(conversion.id)
      onSuccess()
      onClose()
    } catch { /* surfaced via hook */ }
  }

  const iCls = 'w-full px-3 py-2 text-sm border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-white'

  if (!conversion) return null

  return (
    <Modal ref={modalRef} open={open} onClose={onClose} title="Edit FX Conversion" size="max-w-lg" isDirty={isDirty} disableClose={updateMutation.loading || revertMutation.loading}>
      {revertMode ? (
        <div className="space-y-4">
          <div className="flex items-start gap-3 p-4 bg-red-50 border border-red-200 rounded-lg">
            <AlertTriangle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="text-sm font-semibold text-red-800">Revert this conversion?</p>
              <p className="text-xs text-red-700">
                This will permanently delete the FX withdrawal, the {baseCurrencyCode} inflow, and the conversion record.
                The FX running balance will be restored. This cannot be undone.
              </p>
              <p className="text-xs text-red-600 font-mono mt-2">
                {fxSym}{fmtFX(conversion.fx_amount, conversion.fx_currency)} {conversion.fx_currency} → {baseCurrencySymbol}{conversion.naira_amount.toLocaleString(formatLocale, { minimumFractionDigits: 2 })} {baseCurrencyCode}
              </p>
            </div>
          </div>
          {revertMutation.error && (
            <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{revertMutation.error}</p>
          )}
          <div className="flex justify-end gap-3">
            <button type="button" onClick={() => setRevertMode(false)} disabled={revertMutation.loading}
              className="px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50">
              Cancel
            </button>
            <button type="button" onClick={handleRevert} disabled={revertMutation.loading}
              className="px-5 py-2 text-sm text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-60 flex items-center gap-2">
              {revertMutation.loading && <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
              {revertMutation.loading ? 'Reverting…' : 'Confirm Revert'}
            </button>
          </div>
        </div>
      ) : (
        <form onSubmit={handleSave} className="space-y-4" noValidate>
          {(updateMutation.error || formError) && (
            <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
              {formError ?? updateMutation.error}
            </p>
          )}

          {/* Read-only summary */}
          <div className="grid grid-cols-3 gap-3 p-3 bg-gray-50 rounded-lg border border-gray-100 text-xs">
            <div><p className="text-gray-400 mb-0.5">Date</p><p className="font-medium text-gray-700">{conversion.date}</p></div>
            <div><p className="text-gray-400 mb-0.5">Currency</p><p className="font-mono font-semibold text-gray-700">{conversion.fx_currency}</p></div>
            <div><p className="text-gray-400 mb-0.5">FX Amount</p><p className="font-mono font-semibold text-gray-700">{fxSym}{fmtFX(conversion.fx_amount, conversion.fx_currency)}</p></div>
          </div>

          {/* Rate (editable — triggers cascade) */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-gray-600">Exchange Rate ({baseCurrencySymbol} per {conversion.fx_currency}) *</label>
            <input type="text" inputMode="decimal" min="0.01" step="0.01" value={rate}
              onChange={e => setRate(e.target.value)} className={iCls} />
          </div>

          {/* NGN equivalent preview */}
          {rateNum > 0 && (
            <div className="flex items-center justify-between px-3 py-2 bg-blue-50 border border-blue-100 rounded-lg text-xs">
              <span className="text-blue-700">New {baseCurrencyCode} inflow amount</span>
              <span className="font-semibold text-blue-800">
                {baseCurrencySymbol}{nairaAmt.toLocaleString(formatLocale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </div>
          )}

          {/* Notes */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-gray-600">Notes</label>
            <input type="text" value={notes} onChange={e => setNotes(e.target.value)}
              placeholder="Conversion notes…" className={iCls} />
          </div>

          {/* Bank */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-gray-600">Receiving Bank (leave blank to keep current)</label>
            {ngnBanks.length > 0 ? (
              <select value={bankName} onChange={e => setBankName(e.target.value)} className={iCls}>
                <option value="">— Keep current —</option>
                {ngnBanks.map(b => <option key={b.id} value={b.name}>{b.name}</option>)}
              </select>
            ) : (
              <input type="text" value={bankName} onChange={e => setBankName(e.target.value)}
                placeholder="Bank name (leave blank to keep current)" className={iCls} />
            )}
          </div>

          {/* Allocation */}
          <div className="border border-gray-100 rounded-lg p-3 space-y-3 bg-gray-50">
            <p className="text-xs font-semibold text-gray-500">Allocation</p>
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-600">Distribution Rule</label>
              <select value={configId} onChange={e => setConfigId(e.target.value)} className={iCls}>
                <option value="">— Keep current / Auto-detect —</option>
                {configs.filter(c => c.status === 'locked').map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-gray-600">Category</label>
                <input type="text" value={stageCode1} onChange={e => setStageCode1(e.target.value)}
                  placeholder="Keep current" className={iCls} />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-gray-600">Fund Type</label>
                <input type="text" value={stageCode2} onChange={e => setStageCode2(e.target.value)}
                  placeholder="Keep current" className={iCls} />
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between gap-3 pt-2 border-t border-gray-100">
            <button type="button" onClick={() => setRevertMode(true)}
              className="px-4 py-2 text-sm text-red-600 border border-red-200 rounded-lg hover:bg-red-50 transition-colors flex items-center gap-2">
              <RefreshCw className="w-3.5 h-3.5" /> Revert Conversion
            </button>
            <div className="flex gap-3">
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
          </div>
        </form>
      )}
    </Modal>
  )
}
