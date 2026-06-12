import { useState, useEffect, useMemo, useRef } from 'react'
import { TrendingDown, TrendingUp, AlertCircle, RefreshCw } from 'lucide-react'
import { Modal, type ModalHandle } from '../ui/Modal'
import { useAddFXConversion, type AddFXConversionInput } from '../../hooks/useFXConversions'
import { useAllocationStore } from '../../store/allocationStore'
import { useOrgCurrency } from '../../hooks/useOrgCurrency'
import { getCurrencyLocale } from '../../utils/formatters'
import type { FXCurrencySummary } from '../../hooks/useFX'

function fmtFX(n: number, locale: string, dp = 4) {
  return n.toLocaleString(locale, { minimumFractionDigits: dp, maximumFractionDigits: dp })
}

interface Props {
  open:              boolean
  onClose:           () => void
  onSuccess:         () => void
  summaries:         FXCurrencySummary[]
  defaultCurrency?:  string
  /** NGN (non-FX) banks available to receive the converted amount */
  banks:             { id: string; name: string }[]
}

export function AddFXConversionModal({ open, onClose, onSuccess, summaries, defaultCurrency, banks }: Props) {
  const { mutate, loading, error, reset } = useAddFXConversion()
  const { configs } = useAllocationStore()
  const { baseCurrencyCode, baseCurrencySymbol, formatLocale, foreignCurrencies: fxCurrencies, getCurrencySymbol } = useOrgCurrency()

  const [currency,    setCurrency]    = useState(defaultCurrency ?? fxCurrencies[0]?.code ?? 'USD')
  const [fxAmount,    setFxAmount]    = useState('')
  const [rate,        setRate]        = useState('')
  const [date,        setDate]        = useState('')
  const [bankName,    setBankName]    = useState('')
  const [notes,       setNotes]       = useState('')
  const [configId,    setConfigId]    = useState('')
  const [stageCode1,  setStageCode1]  = useState('')
  const [formError,   setFormError]   = useState<string | null>(null)

  const modalRef = useRef<ModalHandle>(null)
  const isDirty = fxAmount !== '' || rate !== '' || notes !== '' || stageCode1 !== '' || bankName !== ''

  const summary    = summaries.find(s => s.currency === currency)
  const balance    = summary?.currentBalance ?? 0
  const meta       = fxCurrencies.find(m => m.code === currency) ?? { code: currency, symbol: getCurrencySymbol(currency), flag: null }
  const fxAmt      = parseFloat(fxAmount) || 0
  const exchangeRate = parseFloat(rate)   || 0
  const baseAmt    = fxAmt * exchangeRate
  const isPartial  = fxAmt > 0 && fxAmt < balance

  useEffect(() => {
    if (!open) return
    reset()
    setFormError(null)
    setFxAmount('')
    setRate('')
    setBankName(banks[0]?.name ?? '')
    setNotes('')
    setConfigId('')
    setStageCode1('')
    setDate(new Date().toISOString().slice(0, 10))
    if (defaultCurrency) setCurrency(defaultCurrency)
  }, [open, defaultCurrency]) // eslint-disable-line react-hooks/exhaustive-deps

  const availableCurrencies = useMemo(
    () => fxCurrencies.filter(m => (summaries.find(s => s.currency === m.code)?.currentBalance ?? 0) > 0),
    [fxCurrencies, summaries],
  )

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setFormError(null)
    if (!currency)          { setFormError('Select a currency.'); return }
    if (fxAmt <= 0)         { setFormError('Enter a positive FX amount.'); return }
    if (fxAmt > balance)    { setFormError(`Amount exceeds available balance (${meta.symbol}${fmtFX(balance, getCurrencyLocale(currency))}).`); return }
    if (exchangeRate <= 0)  { setFormError('Enter a valid exchange rate.'); return }
    if (!date)              { setFormError('Select a date.'); return }
    if (!bankName.trim())   { setFormError('Select a bank to receive the converted amount.'); return }

    const input: AddFXConversionInput = {
      date,
      fx_currency:          currency,
      fx_amount:            fxAmt,
      exchange_rate:        exchangeRate,
      naira_amount:         baseAmt,
      bank_name:            bankName.trim(),
      notes:                notes.trim() || undefined,
      allocation_config_id: configId || undefined,
      stage_code_1:         stageCode1.trim() || undefined,
      is_partial:           isPartial,
    }

    try {
      await mutate(input)
      onSuccess()
      onClose()
    } catch {
      // error surfaced via hook
    }
  }

  const iCls = 'w-full px-3 py-2 text-sm border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary'

  return (
    <Modal ref={modalRef} open={open} onClose={onClose} title={`Convert FX to ${baseCurrencyCode}`} size="max-w-md" isDirty={isDirty} disableClose={loading}>
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>

        {(error || formError) && (
          <div className="flex items-start gap-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            {formError ?? error}
          </div>
        )}

        {/* Currency select */}
        <div className="space-y-1">
          <label className="text-xs font-medium text-gray-600">Source Currency *</label>
          {availableCurrencies.length === 0 ? (
            <p className="text-sm text-gray-400">No FX holdings with a positive balance.</p>
          ) : (
            <div className="flex gap-2 flex-wrap">
              {availableCurrencies.map(m => {
                const bal = summaries.find(s => s.currency === m.code)?.currentBalance ?? 0
                return (
                  <button
                    key={m.code}
                    type="button"
                    onClick={() => { setCurrency(m.code); setFxAmount('') }}
                    className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border transition-colors ${
                      currency === m.code
                        ? 'bg-primary text-white border-primary'
                        : 'bg-white text-gray-700 border-gray-300 hover:border-primary'
                    }`}
                  >
                    {m.flag} {m.code}
                    <span className="font-mono opacity-70">{m.symbol}{fmtFX(bal, getCurrencyLocale(m.code), 2)}</span>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* Balance indicator */}
        {meta && balance > 0 && (
          <div className="flex items-center justify-between px-3 py-2 bg-blue-50 border border-blue-100 rounded-lg text-xs">
            <span className="text-blue-700">Available: <strong>{meta.symbol}{fmtFX(balance, getCurrencyLocale(currency))}</strong></span>
            <button
              type="button"
              onClick={() => setFxAmount(String(balance))}
              className="text-blue-600 hover:underline font-medium"
            >
              Use full balance
            </button>
          </div>
        )}

        {/* Amount + Rate row */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-xs font-medium text-gray-600">
              FX Amount ({currency}) *
            </label>
            <input
              type="text" inputMode="decimal"
              min="0.0001"
              step="0.0001"
              value={fxAmount}
              onChange={e => setFxAmount(e.target.value)}
              placeholder={`0.0000`}
              className={iCls}
            />
            {isPartial && (
              <p className="text-xs text-amber-600">Partial conversion — {meta.symbol}{fmtFX(balance - fxAmt, getCurrencyLocale(currency))} remains</p>
            )}
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-gray-600">Rate ({baseCurrencySymbol} per {currency}) *</label>
            <input
              type="text" inputMode="decimal"
              min="0"
              step="0.01"
              value={rate}
              onChange={e => setRate(e.target.value)}
              placeholder="e.g. 1580.00"
              className={iCls}
            />
          </div>
        </div>

        {/* NGN Equivalent preview */}
        {fxAmt > 0 && exchangeRate > 0 && (
          <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-green-50 border border-green-200 text-sm">
            <div className="flex items-center gap-1.5 text-gray-600">
              <TrendingDown className="w-4 h-4 text-danger" />
              <span className="font-mono">{meta?.symbol}{fmtFX(fxAmt, getCurrencyLocale(currency))}</span>
            </div>
            <RefreshCw className="w-3.5 h-3.5 text-gray-400" />
            <div className="flex items-center gap-1.5 text-success font-semibold">
              <TrendingUp className="w-4 h-4" />
              <span>{baseCurrencySymbol}{baseAmt.toLocaleString(formatLocale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            </div>
          </div>
        )}

        {/* Date */}
        <div className="space-y-1">
          <label className="text-xs font-medium text-gray-600">Conversion Date *</label>
          <input
            type="date"
            value={date}
            onChange={e => setDate(e.target.value)}
            className={iCls}
          />
        </div>

        {/* Receiving Bank */}
        <div className="space-y-1">
          <label className="text-xs font-medium text-gray-600">Receiving Bank ({baseCurrencyCode}) *</label>
          {banks.length > 0 ? (
            <select
              value={bankName}
              onChange={e => setBankName(e.target.value)}
              className={`${iCls} bg-white`}
            >
              <option value="">— Select bank —</option>
              {banks.map(b => <option key={b.id} value={b.name}>{b.name}</option>)}
            </select>
          ) : (
            <input
              type="text"
              value={bankName}
              onChange={e => setBankName(e.target.value)}
              placeholder="Bank name"
              className={iCls}
            />
          )}
        </div>

        {/* Notes */}
        <div className="space-y-1">
          <label className="text-xs font-medium text-gray-600">Notes</label>
          <input
            type="text"
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="e.g. Exchange at Union Bank"
            className={iCls}
          />
        </div>

        {/* Allocation */}
        <div className="border border-gray-100 rounded-lg p-3 space-y-3 bg-gray-50">
          <p className="text-xs font-semibold text-gray-500">Allocation for the {baseCurrencyCode} Inflow</p>

          <div className="space-y-1">
            <label className="text-xs font-medium text-gray-600">Allocation Config</label>
            <select
              value={configId}
              onChange={e => setConfigId(e.target.value)}
              className={`${iCls} bg-white`}
            >
              <option value="">— Auto-detect by date —</option>
              {configs.filter(c => c.status === 'locked').map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-gray-600">Stage Code / Account Code</label>
            <input
              type="text"
              value={stageCode1}
              onChange={e => setStageCode1(e.target.value)}
              placeholder="e.g. 100"
              className={iCls}
            />
          </div>
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={() => modalRef.current?.requestClose()}
            disabled={loading}
            className="px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={loading || fxAmt <= 0 || exchangeRate <= 0 || !date || !bankName.trim()}
            className="px-5 py-2 text-sm text-white bg-primary rounded-lg hover:bg-primary-light disabled:opacity-60 flex items-center gap-2"
          >
            {loading && <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
            {loading ? 'Recording…' : 'Record Conversion'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
