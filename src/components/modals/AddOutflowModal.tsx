import { useEffect, useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { useForm, useWatch, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Modal } from '../ui/Modal'
import { useAddOutflow, useUpdateTransaction, type AddOutflowInput } from '../../hooks/useMutations'
import { useCategories } from '../../hooks/useCategories'
import { useBanks } from '../../hooks/useBanks'
import type { OutflowTransaction } from '../../hooks/useTransactions'
import { CurrencyInput } from '../ui/CurrencyInput'

const FX_CURRENCIES = ['USD', 'GBP', 'EUR', 'CNY', 'AED', 'CAD', 'CHF', 'ZAR']

const TXN_TYPES = [
  { value: '',                   label: 'Normal' },
  { value: 'refund',             label: 'Refund' },
  { value: 'reversal',           label: 'Reversal' },
  { value: 'bank_deposit',       label: 'Bank Deposit' },
  { value: 'intrabank_transfer', label: 'Intrabank Transfer' },
]

// ── Zod schema ─────────────────────────────────────────────────────────────────

const optNum = z.union([
  z.coerce.number().min(0),
  z.literal('').transform(() => undefined),
]).optional()

const schema = z.object({
  date:                    z.string().min(1, 'Date is required'),
  amount_disbursed:        z.coerce.number({ invalid_type_error: 'Enter a valid amount' }).positive('Amount must be greater than zero'),
  bank_name:               z.string().optional(),
  description:             z.string().optional(),
  bank_description:        z.string().optional(),
  transaction_id:          z.string().optional(),
  stage_code_1:            z.string().optional(),
  stage_code_2:            z.string().optional(),
  amount_refunded:         optNum,
  transfer_charge:         optNum,
  remarks:                 z.string().optional(),
  fx_currency:             z.string().optional(),
  fx_amount:               optNum,
  fx_rate:                 optNum,
  transaction_type:        z.string().optional(),
  original_transaction_id: z.string().optional(),
})

type FormValues = z.infer<typeof schema>

// ── Component ──────────────────────────────────────────────────────────────────

interface Props {
  open: boolean
  onClose: () => void
  onSuccess?: () => void
  editRecord?: OutflowTransaction | null
}

export function AddOutflowModal({ open, onClose, onSuccess, editRecord }: Props) {
  const { categories } = useCategories()
  const { banks }      = useBanks()
  const isEdit = !!editRecord
  const [isPending, setIsPending] = useState(false)
  const [fxOpen,    setFxOpen]    = useState(false)

  const addMutation    = useAddOutflow()
  const updateMutation = useUpdateTransaction('outflow_transactions')

  const { mutate: add,    loading: adding,   error: addError,    reset: resetAdd    } = addMutation
  const { mutate: update, loading: updating, error: updateError, reset: resetUpdate } = updateMutation

  const loading = adding || updating
  const error   = addError || updateError

  const {
    register,
    handleSubmit,
    formState: { errors },
    reset: resetForm,
    control,
  } = useForm<FormValues>({ resolver: zodResolver(schema) })

  const transactionType = useWatch({ control, name: 'transaction_type' })

  useEffect(() => {
    if (!open) return
    resetAdd()
    resetUpdate()
    setFxOpen(false)
    if (editRecord) {
      setIsPending(editRecord.is_pending_deduction ?? false)
      resetForm({
        date:                    editRecord.date,
        amount_disbursed:        editRecord.amount_disbursed,
        bank_name:               editRecord.bank_name               ?? '',
        description:             editRecord.description             ?? '',
        bank_description:        editRecord.bank_description        ?? '',
        transaction_id:          editRecord.transaction_id          ?? '',
        stage_code_1:            editRecord.stage_code_1            ?? '',
        stage_code_2:            editRecord.stage_code_2            ?? '',
        amount_refunded:         editRecord.amount_refunded         ?? '',
        transfer_charge:         editRecord.transfer_charge         ?? '',
        remarks:                 editRecord.remarks                 ?? '',
        fx_currency:             editRecord.fx_currency             ?? '',
        fx_amount:               (editRecord as Record<string, unknown>).fx_amount as number ?? '',
        fx_rate:                 (editRecord as Record<string, unknown>).fx_rate   as number ?? '',
        transaction_type:        editRecord.transaction_type        ?? '',
        original_transaction_id: editRecord.original_transaction_id ?? '',
      })
    } else {
      setIsPending(false)
      resetForm({ date: new Date().toISOString().slice(0, 10), amount_disbursed: undefined })
    }
  }, [open, editRecord, resetForm, resetAdd, resetUpdate])

  const onSubmit = async (values: FormValues) => {
    try {
      if (isEdit && editRecord) {
        await update({
          id: editRecord.id,
          updates: {
            date:                    values.date,
            amount_disbursed:        values.amount_disbursed,
            bank_name:               values.bank_name               || null,
            description:             values.description             || null,
            bank_description:        values.bank_description        || null,
            transaction_id:          values.transaction_id          || null,
            stage_code_1:            values.stage_code_1            || null,
            stage_code_2:            values.stage_code_2            || null,
            amount_refunded:         values.amount_refunded         ?? null,
            transfer_charge:         values.transfer_charge         ?? null,
            remarks:                 values.remarks                 || null,
            is_pending_deduction:    isPending,
            fx_currency:             values.fx_currency             || null,
            fx_amount:               typeof values.fx_amount === 'number' ? values.fx_amount : null,
            fx_rate:                 typeof values.fx_rate   === 'number' ? values.fx_rate   : null,
            transaction_type:        values.transaction_type        || null,
            original_transaction_id: values.original_transaction_id || null,
          },
        })
      } else {
        const input: AddOutflowInput = {
          date:                    values.date,
          amount_disbursed:        values.amount_disbursed,
          is_pending_deduction:    isPending,
          bank_name:               values.bank_name               || undefined,
          description:             values.description             || undefined,
          bank_description:        values.bank_description        || undefined,
          transaction_id:          values.transaction_id          || undefined,
          stage_code_1:            values.stage_code_1            || undefined,
          stage_code_2:            values.stage_code_2            || undefined,
          amount_refunded:         typeof values.amount_refunded === 'number' ? values.amount_refunded : undefined,
          transfer_charge:         typeof values.transfer_charge === 'number' ? values.transfer_charge : undefined,
          remarks:                 values.remarks                 || undefined,
          fx_currency:             values.fx_currency             || undefined,
          fx_amount:               typeof values.fx_amount === 'number' ? values.fx_amount : undefined,
          fx_rate:                 typeof values.fx_rate   === 'number' ? values.fx_rate   : undefined,
          transaction_type:        values.transaction_type        || undefined,
          original_transaction_id: values.original_transaction_id || undefined,
        }
        await add(input)
      }
      onSuccess?.()
      onClose()
    } catch {
      // error surfaces via hook state
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? 'Edit Outflow Transaction' : 'Add Outflow Transaction'}
    >
      <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">

        {error && (
          <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {/* Date + Amount */}
        <div className="grid grid-cols-2 gap-4">
          <Field label="Date *" error={errors.date?.message}>
            <input type="date" {...register('date')} className={inputCls(!!errors.date)} />
          </Field>
          <Field label="Amount Disbursed (₦) *" error={errors.amount_disbursed?.message}>
            <Controller control={control} name="amount_disbursed" render={({ field }) => (
              <CurrencyInput value={field.value} onChange={field.onChange} placeholder="0.00" className={inputCls(!!errors.amount_disbursed)} />
            )} />
          </Field>
        </div>

        {/* Bank Account */}
        <Field label="Bank Account" error={errors.bank_name?.message}>
          <select {...register('bank_name')} className={inputCls(!!errors.bank_name)}>
            <option value="">— Select bank (optional) —</option>
            {banks.map(b => <option key={b.id} value={b.name}>{b.name}</option>)}
          </select>
        </Field>

        {/* Description */}
        <Field label="Description" error={errors.description?.message}>
          <input
            type="text" placeholder="e.g. Generator fuel purchase"
            {...register('description')}
            className={inputCls(!!errors.description)}
          />
        </Field>

        {/* Transaction Type */}
        <Field label="Transaction Type" error={errors.transaction_type?.message}>
          <select {...register('transaction_type')} className={inputCls(!!errors.transaction_type)}>
            {TXN_TYPES.map(t => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </Field>

        {/* Original Txn ID — only for refund/reversal */}
        {(transactionType === 'refund' || transactionType === 'reversal') && (
          <Field label="Original Transaction ID" error={errors.original_transaction_id?.message}>
            <input
              type="text"
              placeholder="ID of the transaction being refunded/reversed"
              {...register('original_transaction_id')}
              className={inputCls(!!errors.original_transaction_id)}
            />
          </Field>
        )}

        {/* Bank Desc + Txn ID */}
        <div className="grid grid-cols-2 gap-4">
          <Field label="Bank Description" error={errors.bank_description?.message}>
            <input
              type="text" placeholder="Bank narration"
              {...register('bank_description')}
              className={inputCls(!!errors.bank_description)}
            />
          </Field>
          <Field label="Transaction ID" error={errors.transaction_id?.message}>
            <input
              type="text" placeholder="Bank Txn ID"
              {...register('transaction_id')}
              className={inputCls(!!errors.transaction_id)}
            />
          </Field>
        </div>

        {/* Stage Code 1 + 2 */}
        <div className="grid grid-cols-2 gap-4">
          <Field label="Stage Code 1" error={errors.stage_code_1?.message}>
            <select {...register('stage_code_1')} className={inputCls(!!errors.stage_code_1)}>
              <option value="">— Select —</option>
              {categories.map(c => (
                <option key={c.id} value={c.name}>{c.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Stage Code 2 (Portion Type)" error={errors.stage_code_2?.message}>
            <select {...register('stage_code_2')} className={inputCls(!!errors.stage_code_2)}>
              <option value="">— Select —</option>
              <option value="Percentage Allocation">Percentage Allocation</option>
              <option value="Specific Seed">Specific Seed</option>
              <option value="Savings">Savings</option>
            </select>
          </Field>
        </div>

        {/* Pending Deduction */}
        <label className="flex items-center gap-3 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={isPending}
            onChange={e => setIsPending(e.target.checked)}
            className="w-4 h-4 rounded border-gray-300 text-primary focus:ring-primary/30"
          />
          <span className="text-sm font-medium text-gray-700">Mark as Pending Deduction</span>
        </label>

        {/* Optional banking extras */}
        <div className="border border-gray-100 rounded-lg p-4 space-y-4 bg-gray-50">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
            Optional Banking Details
          </p>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Amount Refunded (₦)" error={errors.amount_refunded?.message}>
              <Controller control={control} name="amount_refunded" render={({ field }) => (
                <CurrencyInput value={field.value} onChange={field.onChange} placeholder="0.00" className={inputCls(!!errors.amount_refunded)} />
              )} />
            </Field>
            <Field label="Transfer Charge (₦)" error={errors.transfer_charge?.message}>
              <Controller control={control} name="transfer_charge" render={({ field }) => (
                <CurrencyInput value={field.value} onChange={field.onChange} placeholder="0.00" className={inputCls(!!errors.transfer_charge)} />
              )} />
            </Field>
          </div>
          <Field label="FX Currency (if applicable)" error={errors.fx_currency?.message}>
            <select {...register('fx_currency')} className={inputCls(!!errors.fx_currency)}>
              <option value="">— None —</option>
              {FX_CURRENCIES.map(c => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </Field>
        </div>

        {/* FX Details collapsible */}
        <div className="border border-gray-100 rounded-lg overflow-hidden">
          <button
            type="button"
            onClick={() => setFxOpen(v => !v)}
            className="w-full flex items-center justify-between px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wider bg-gray-50 hover:bg-gray-100 transition-colors"
          >
            FX Details (amount &amp; rate)
            {fxOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          </button>
          {fxOpen && (
            <div className="p-4 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <Field label="FX Amount" error={errors.fx_amount?.message}>
                  <Controller control={control} name="fx_amount" render={({ field }) => (
                    <CurrencyInput value={field.value} onChange={field.onChange} placeholder="0.0000" className={inputCls(!!errors.fx_amount)} />
                  )} />
                </Field>
                <Field label="FX Rate" error={errors.fx_rate?.message}>
                  <Controller control={control} name="fx_rate" render={({ field }) => (
                    <CurrencyInput value={field.value} onChange={field.onChange} placeholder="0.000000" className={inputCls(!!errors.fx_rate)} />
                  )} />
                </Field>
              </div>
            </div>
          )}
        </div>

        {/* Remarks */}
        <Field label="Remarks" error={errors.remarks?.message}>
          <textarea
            rows={2} placeholder="Additional notes…"
            {...register('remarks')}
            className={`${inputCls(!!errors.remarks)} resize-none`}
          />
        </Field>

        {/* Actions */}
        <div className="flex justify-end gap-3 pt-2">
          <button
            type="button" onClick={onClose} disabled={loading}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit" disabled={loading}
            className="px-5 py-2 text-sm font-medium text-white bg-danger rounded-lg hover:bg-red-700 transition-colors disabled:opacity-60 flex items-center gap-2"
          >
            {loading && <Spinner />}
            {loading ? 'Saving…' : isEdit ? 'Save Changes' : 'Save Outflow'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function inputCls(hasError: boolean) {
  return `w-full px-3 py-2 text-sm border rounded-lg outline-none transition-colors focus:ring-2 focus:ring-primary/30 bg-white ${
    hasError ? 'border-red-400 focus:border-red-400' : 'border-gray-300 focus:border-primary'
  }`
}

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-gray-600">{label}</label>
      {children}
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  )
}

function Spinner() {
  return <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
}
