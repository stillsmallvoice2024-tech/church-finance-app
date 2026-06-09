import { useEffect, useMemo, useRef, useState } from 'react'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Modal, type ModalHandle } from '../ui/Modal'
import { useAddFXTransaction, useUpdateFXTransaction, type AddFXTransactionInput, type UpdateFXTransactionInput } from '../../hooks/useMutations'
import { CurrencyInput } from '../ui/CurrencyInput'
import type { FXTransaction } from '../../hooks/useFX'
import { useOrgCurrency } from '../../hooks/useOrgCurrency'
import { generateFallbackTransactionId } from '../../utils/generateTransactionId'
import { supabase } from '../../lib/supabase'

const schema = z.object({
  date:            z.string().min(1, 'Date is required'),
  currency:        z.string().min(1, 'Currency is required'),
  type:            z.enum(['deposit', 'withdrawal'] as const),
  amount:          z.coerce.number({ invalid_type_error: 'Enter a valid amount' }).positive('Amount must be greater than zero'),
  narration:       z.string().optional(),
  transaction_ref: z.string().optional(),
  bank_name:       z.string().min(1, 'Bank is required'),
})

type FormValues = z.infer<typeof schema>

interface Props {
  open: boolean
  onClose: () => void
  onSuccess?: () => void
  /** Current running balance per currency — used to preview new balance */
  currentBalances: Map<string, number>
  editRecord?: FXTransaction | null
  /** FX-tagged banks available for selection */
  fxBanks: { id: string; name: string }[]
}

export function AddFXModal({ open, onClose, onSuccess, currentBalances, editRecord, fxBanks }: Props) {
  const isEdit = !!editRecord
  const addMutation    = useAddFXTransaction()
  const updateMutation = useUpdateFXTransaction()
  const { loading, error, reset } = isEdit ? updateMutation : addMutation
  const { foreignCurrencies, getCurrencySymbol } = useOrgCurrency()
  const [dupError, setDupError] = useState<string | null>(null)

  const defaultFxCurrency = foreignCurrencies[0]?.code ?? 'USD'

  const modalRef = useRef<ModalHandle>(null)

  const { register, control, handleSubmit, watch, formState: { errors, isDirty }, reset: resetForm } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { currency: defaultFxCurrency, type: 'deposit' },
  })

  const defaultBankName = fxBanks[0]?.name ?? ''

  useEffect(() => {
    if (!open) return
    reset()
    setDupError(null)
    if (editRecord) {
      resetForm({
        date:            editRecord.date,
        currency:        editRecord.currency,
        type:            editRecord.deposit > 0 ? 'deposit' : 'withdrawal',
        amount:          editRecord.deposit > 0 ? editRecord.deposit : editRecord.withdrawal,
        narration:       editRecord.narration       ?? '',
        transaction_ref: editRecord.transaction_ref ?? '',
        bank_name:       (editRecord as FXTransaction & { bank_name?: string }).bank_name ?? defaultBankName,
      })
    } else {
      resetForm({ date: new Date().toISOString().slice(0, 10), currency: defaultFxCurrency, type: 'deposit', amount: undefined, bank_name: defaultBankName })
    }
  }, [open, reset, resetForm, editRecord, defaultFxCurrency, defaultBankName])

  const selectedCurrency = watch('currency')
  const txType    = watch('type')
  const amount    = Number(watch('amount') || 0)

  // In edit mode, "previous balance" is the balance of the row before this one,
  // not the current latest. Derived as: stored_balance - old_deposit + old_withdrawal.
  const prevBal = isEdit && editRecord
    ? editRecord.running_balance - editRecord.deposit + editRecord.withdrawal
    : (currentBalances.get(selectedCurrency) ?? 0)

  const newBal = useMemo(
    () => prevBal + (txType === 'deposit' ? amount : -amount),
    [txType, prevBal, amount],
  )

  const onSubmit = async (values: FormValues) => {
    const deposit    = values.type === 'deposit'    ? values.amount : 0
    const withdrawal = values.type === 'withdrawal' ? values.amount : 0
    setDupError(null)
    try {
      if (isEdit && editRecord) {
        const input: UpdateFXTransactionInput = {
          id:              editRecord.id,
          date:            values.date,
          currency:        values.currency,
          deposit,
          withdrawal,
          narration:       values.narration       || undefined,
          transaction_ref: values.transaction_ref || undefined,
          bank_name:       values.bank_name       || undefined,
        }
        await (updateMutation.mutate as unknown as (i: UpdateFXTransactionInput) => Promise<void>)(input)
      } else {
        const txnRef = values.transaction_ref?.trim()
          || await generateFallbackTransactionId(values.date, String(values.amount), values.narration ?? '', values.bank_name ?? '')
        let dupQ = supabase.from('fx_transactions').select('id').eq('transaction_ref', txnRef)
        if (values.bank_name) dupQ = dupQ.eq('bank_name', values.bank_name)
        const { data: dup } = await dupQ.limit(1)
        if (dup && dup.length > 0) {
          setDupError('Duplicate: an FX transaction with this ref already exists for the selected bank.')
          return
        }
        const input: AddFXTransactionInput = {
          date:            values.date,
          currency:        values.currency,
          deposit,
          withdrawal,
          narration:       values.narration       || undefined,
          transaction_ref: txnRef,
          bank_name:       values.bank_name       || undefined,
        }
        await (addMutation.mutate as unknown as (i: AddFXTransactionInput) => Promise<void>)(input)
      }
      onSuccess?.()
      onClose()
    } catch { /* surfaced via hook error */ }
  }

  const sym = getCurrencySymbol(selectedCurrency)

  return (
    <Modal ref={modalRef} open={open} onClose={onClose} title={isEdit ? 'Edit FX Transaction' : 'Add FX Transaction'} isDirty={isDirty} disableClose={loading}>
      <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
        {error    && <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{error}</div>}
        {dupError && <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-700">{dupError}</div>}

        <div className="grid grid-cols-2 gap-4">
          <Field label="Date *" error={errors.date?.message}>
            <input type="date" {...register('date')} className={iCls(!!errors.date)} />
          </Field>
          <Field label="Currency" error={errors.currency?.message}>
            <select {...register('currency')} className={`${iCls(!!errors.currency)} bg-white`}>
              {foreignCurrencies.map(c => (
                <option key={c.code} value={c.code}>{c.flag ? `${c.flag} ` : ''}{c.code} — {c.name}</option>
              ))}
            </select>
          </Field>
        </div>

        <Field label="Bank *" error={errors.bank_name?.message}>
          {fxBanks.length > 0 ? (
            <select {...register('bank_name')} className={`${iCls(!!errors.bank_name)} bg-white`}>
              <option value="">— Select bank —</option>
              {fxBanks.map(b => <option key={b.id} value={b.name}>{b.name}</option>)}
            </select>
          ) : (
            <input type="text" placeholder="Foreign currency bank name" {...register('bank_name')} className={iCls(!!errors.bank_name)} />
          )}
        </Field>

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
          <Controller control={control} name="amount" render={({ field }) => (
            <CurrencyInput value={field.value} onChange={field.onChange} placeholder="0.0000" className={iCls(!!errors.amount)} />
          )} />
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
          <button type="button" onClick={() => modalRef.current?.requestClose()} disabled={loading} className="px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50">Cancel</button>
          <button type="submit" disabled={loading} className="px-5 py-2 text-sm text-white bg-primary rounded-lg hover:bg-primary-light disabled:opacity-60 flex items-center gap-2">
            {loading && <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
            {loading ? 'Saving…' : isEdit ? 'Update Transaction' : 'Save Transaction'}
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
