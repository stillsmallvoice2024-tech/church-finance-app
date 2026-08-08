import { useState, useEffect, useMemo } from 'react'
import { AlertTriangle } from 'lucide-react'
import { Modal } from '../ui/Modal'
import { Field, inputCls } from '../ui/FormField'
import { ButtonSpinner } from '../ui/ButtonSpinner'
import { useBanks } from '../../hooks/useBanks'
import { useMarkCashDeposited } from '../../hooks/useMutations'
import { formatCurrency } from '../../utils/formatters'
import { useOrgCurrency } from '../../hooks/useOrgCurrency'

const CUSTOM_SENTINEL = '__custom__'

interface Props {
  open:      boolean
  onClose:   () => void
  onSuccess: () => void
  inflow:    { id: string; date: string; amount: number } | null
}

export function MarkDepositedModal({ open, onClose, onSuccess, inflow }: Props) {
  const { banks } = useBanks()
  const { baseCurrencyCode } = useOrgCurrency()
  const { mutate, loading, error, reset } = useMarkCashDeposited()

  // Non-Cash banks are the deposit destinations.
  const targetBanks = useMemo(() => banks.filter(b => !b.is_system), [banks])

  const [date,         setDate]         = useState('')
  const [depositedBy,  setDepositedBy]  = useState('')
  const [bankChoice,   setBankChoice]   = useState('')
  const [customBank,   setCustomBank]   = useState('')

  useEffect(() => {
    if (open && inflow) {
      setDate(inflow.date)
      setDepositedBy('')
      setBankChoice(targetBanks[0]?.name ?? CUSTOM_SENTINEL)
      setCustomBank('')
      reset()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, inflow])

  const bankName = bankChoice === CUSTOM_SENTINEL ? customBank.trim() : bankChoice
  const canSubmit = !!inflow && !!date && depositedBy.trim().length > 0 && bankName.length > 0 && !loading

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!inflow || !canSubmit) return
    try {
      await mutate({ inflowId: inflow.id, date, depositedBy: depositedBy.trim(), bankName })
      onSuccess()
      onClose()
    } catch {
      /* error surfaced via hook error state */
    }
  }

  if (!inflow) return null

  const footerEl = (
    <div className="flex justify-end gap-3">
      <button type="button" onClick={onClose} disabled={loading}
        className="px-4 min-h-[44px] text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50">
        Cancel
      </button>
      <button type="submit" form="mark-deposited-form" disabled={!canSubmit}
        className="px-5 min-h-[44px] text-sm text-white bg-primary rounded-lg hover:bg-primary-light disabled:opacity-60 flex items-center gap-2">
        {loading && <ButtonSpinner />}
        {loading ? 'Saving…' : 'Mark Deposited'}
      </button>
    </div>
  )

  return (
    <Modal open={open} onClose={onClose} title="Mark Cash as Deposited" disableClose={loading} footer={footerEl}>
      <form id="mark-deposited-form" onSubmit={handleSubmit} noValidate className="space-y-4">
        <p className="text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
          This creates a matching bank outflow of{' '}
          <span className="font-semibold text-gray-700">{formatCurrency(inflow.amount, baseCurrencyCode)}</span>{' '}
          and links it to this cash inflow.
        </p>

        {error && (
          <div className="flex items-start gap-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        <Field label="Deposited By *">
          <input
            type="text"
            placeholder="e.g. John Doe"
            value={depositedBy}
            onChange={e => setDepositedBy(e.target.value)}
            className={inputCls(false)}
          />
        </Field>

        <Field label="Deposit Date *">
          <input
            type="date"
            value={date}
            onChange={e => setDate(e.target.value)}
            className={inputCls(false)}
          />
        </Field>

        <Field label="Deposited To Bank *">
          <select
            value={bankChoice}
            onChange={e => setBankChoice(e.target.value)}
            className={`${inputCls(false)} bg-white`}
          >
            {targetBanks.map(b => (
              <option key={b.id} value={b.name}>{b.name}</option>
            ))}
            <option value={CUSTOM_SENTINEL}>+ Other / custom…</option>
          </select>
        </Field>

        {bankChoice === CUSTOM_SENTINEL && (
          <Field label="Bank Name *">
            <input
              type="text"
              placeholder="e.g. First Bank of Nigeria"
              value={customBank}
              onChange={e => setCustomBank(e.target.value)}
              className={inputCls(false)}
            />
          </Field>
        )}
      </form>
    </Modal>
  )
}
