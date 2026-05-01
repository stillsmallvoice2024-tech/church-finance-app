import { useEffect, useMemo } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Modal } from '../ui/Modal'
import { useAddFXTransaction, type AddFXTransactionInput } from '../../hooks/useMutations'
import { useCurrencies } from '../../hooks/useCurrencies'

const schema = z.object({
  date:            z.string().min(1, 'Date is required'),
  currency:        z.string().min(1, 'Select a currency'),
  type:            z.enum(['deposit', 'withdrawal'] as const),
  amount:          z.coerce.number({ invalid_type_error: 'Enter a valid amount' }).positive('Amount must be greater than zero'),
  narration:       z.string().optional(),
  transaction_ref: z.string().optional(),
})

type FormValues = z.infer<typeof schema>

interface Props {
  open: boolean
  onClose: () => void
  onSuccess?: () => void
  currentBalances: Map<string, number>
}

export function AddFXModal({ open, onClose, onSuccess, currentBalances }: Props) {
  const { mutate, loading, error, reset } = useAddFXTransaction()
  const { currencies } = useCurrencies()

  const fxCurrencies = currencies.filter(c => c.code !== 'NGN')

  const { register, handleSubmit, watch, formState: { errors }, reset: resetForm } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { currency: 'USD', type: 'deposit' },
  })

  useEffect(() => {
    if (!open) return
    reset()
    resetForm({
      date:     new Date().toISOString().slice(0, 10),
      currency: fxCurrencies[0]?.code ?? 'USD',
      type:     'deposit',
      amount:   undefined,
    })
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  const selectedCurrency = watch('currency')
  const txType   = watch('type')
  const amount   = Number(watch('amount') || 0)
  const prevBal  = currentBalances.get(selectedCurrency) ?? 0
  const newBal   = useMemo(
    () => txType === 'deposit' ? prevBal + amount : prevBal - amount,
    [txType, prevBal, amount],
  )

  const selectedMeta = fxCurrencies.find(c => c.code === selectedCurrency)
  const sym = selectedMeta?.symbol ?? selectedCurrency

  const onSubmit = async (values: FormValues) => {
    const deposit    = values.type === 'deposit'    ? values.amount : 0
    const withdrawal = values.type === 'withdrawal' ? values.amount : 0
    const input: AddFXTransactionInput = {
      date:            values.date,
      currency:        values.currency,
      deposit,
      withdrawal,
      running_balance: newBal,
      narration:       values.narration       || undefined,
      transaction_ref: values.transaction_ref || undefined,
    }
    try {
      await mutate(input)
      onSuccess?.()
      onClose()
    } catch { /* surfaced via hook error */ }
  }

  return (
    <Modal open={open} onClose={onClose} title="Add FX Transaction">
      <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
        {error && <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{error}</div>}

        <div className="grid grid-cols-2 gap-4">
          <Field label="Date *" error={errors.date?.message}>
            <input type="date" {...register('date')} className={iCls(!!errors.date)} />
          </Field>
          <Field label="Currency" error={errors.currency?.message}>
            <select {...register('currency')} className={`${iCls(!!errors.currency)} bg-white`}>
              {fxCurrencies.map(c => (
                <option key={c.code} value={c.code}>
                  {c.flag ? `${c.flag} ` : ''}{c.code} — {c.name}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <Field label="Transaction Type" error={errors.type?.message}>
          <div className="flex gap-3">
            {(['deposit','withdrawal'] as const).map(t => (
              <label key={t} className="flex items-center gap-2 cursor-pointer">
                <input type="radio" value={t} {...register('type')} className="accent-primary" />
                <span className="text-sm capitalize">{t}</span>
              </label>
            ))}
          </div>
        </Field>

        <Field label={`Amount (${sym}) *`} error={errors.amount?.message}>
          <input type="number" min="0" step="0.0001" placeholder="0.0000" {...register('amount')} className={iCls(!!errors.amount)} />
        </Field>

        {/* Balance preview */}
        <div className="rounded-lg bg-gray-50 border border-gray-200 px-4 py-3 space-y-1.5 text-sm">
          <div className="flex justify-between text-gray-500">
            <span>Previous balance</span>
            <span>{sym}{prevBal.toLocaleString(undefined, { minimumFractionDigits: 4 })}</span>
          </div>
          <div className="flex justify-between font-semibold">
            <span className="text-gray-700">New balance</span>
            <span className={newBal >= 0 ? 'text-success' : 'text-danger'}>
              {sym}{newBal.toLocaleString(undefined, { minimumFractionDigits: 4 })}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Narration" error={errors.narration?.message}>
            <input type="text" placeholder="Description" {...register('narration')} className={iCls(false)} />
          </Field>
          <Field label="Transaction Ref" error={errors.transaction_ref?.message}>
            <input type="text" placeholder="Ref / ID" {...register('transaction_ref')} className={iCls(false)} />
          </Field>
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <button type="button" onClick={onClose} disabled={loading}
            className="px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50">
            Cancel
          </button>
          <button type="submit" disabled={loading}
            className="px-5 py-2 text-sm text-white bg-primary rounded-lg hover:bg-primary-light disabled:opacity-60 flex items-center gap-2">
            {loading && <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
            {loading ? 'Saving…' : 'Save Transaction'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

function iCls(e: boolean) {
  return `w-full px-3 py-2 text-sm border rounded-lg outline-none focus:ring-2 focus:ring-primary/30 bg-white ${e ? 'border-red-400' : 'border-gray-300 focus:border-primary'}`
}
function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return <div className="flex flex-col gap-1"><label className="text-xs font-medium text-gray-600">{label}</label>{children}{error && <p className="text-xs text-red-500">{error}</p>}</div>
}
