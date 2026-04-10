import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Modal } from '../ui/Modal'
import { useAddOutflow, type AddOutflowInput } from '../../hooks/useMutations'

// ── Zod schema ─────────────────────────────────────────────────────────────────

const schema = z.object({
  date:              z.string().min(1, 'Date is required'),
  amount_disbursed:  z.coerce.number({ invalid_type_error: 'Enter a valid amount' }).positive('Amount must be greater than zero'),
  description:       z.string().optional(),
  bank_description:  z.string().optional(),
  transaction_id:    z.string().optional(),
  stage_code_1:      z.string().optional(),
  amount_refunded:   z.coerce.number().min(0).optional().or(z.literal('')).transform(v => v === '' ? undefined : v),
  transfer_charge:   z.coerce.number().min(0).optional().or(z.literal('')).transform(v => v === '' ? undefined : v),
  remarks:           z.string().optional(),
})

type FormValues = z.infer<typeof schema>

// ── Component ──────────────────────────────────────────────────────────────────

interface Props {
  open: boolean
  onClose: () => void
  onSuccess?: (id: string) => void
}

export function AddOutflowModal({ open, onClose, onSuccess }: Props) {
  const { mutate, loading, error, reset } = useAddOutflow()

  const {
    register,
    handleSubmit,
    formState: { errors },
    reset: resetForm,
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { date: new Date().toISOString().slice(0, 10) },
  })

  useEffect(() => {
    if (open) {
      resetForm({ date: new Date().toISOString().slice(0, 10) })
      reset()
    }
  }, [open, resetForm, reset])

  const onSubmit = async (values: FormValues) => {
    const input: AddOutflowInput = {
      date:             values.date,
      amount_disbursed: values.amount_disbursed,
      description:      values.description || undefined,
      bank_description: values.bank_description || undefined,
      transaction_id:   values.transaction_id || undefined,
      stage_code_1:     values.stage_code_1 || undefined,
      amount_refunded:  typeof values.amount_refunded === 'number' ? values.amount_refunded : undefined,
      transfer_charge:  typeof values.transfer_charge === 'number' ? values.transfer_charge : undefined,
      remarks:          values.remarks || undefined,
    }

    try {
      const id = await mutate(input)
      onSuccess?.(id)
      onClose()
    } catch {
      // error already stored in hook state
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Add Outflow Transaction">
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
            <input
              type="number"
              min="0"
              step="0.01"
              placeholder="0.00"
              {...register('amount_disbursed')}
              className={inputCls(!!errors.amount_disbursed)}
            />
          </Field>
        </div>

        {/* Description */}
        <Field label="Description" error={errors.description?.message}>
          <input
            type="text"
            placeholder="e.g. Generator fuel purchase"
            {...register('description')}
            className={inputCls(!!errors.description)}
          />
        </Field>

        {/* Bank Description + Transaction ID */}
        <div className="grid grid-cols-2 gap-4">
          <Field label="Bank Description" error={errors.bank_description?.message}>
            <input
              type="text"
              placeholder="Bank narration"
              {...register('bank_description')}
              className={inputCls(!!errors.bank_description)}
            />
          </Field>
          <Field label="Transaction ID" error={errors.transaction_id?.message}>
            <input
              type="text"
              placeholder="Bank Txn ID"
              {...register('transaction_id')}
              className={inputCls(!!errors.transaction_id)}
            />
          </Field>
        </div>

        {/* Stage Code */}
        <Field label="Stage Code" error={errors.stage_code_1?.message}>
          <input
            type="text"
            placeholder="e.g. E01"
            {...register('stage_code_1')}
            className={inputCls(!!errors.stage_code_1)}
          />
        </Field>

        {/* Optional banking extras */}
        <div className="border border-gray-100 rounded-lg p-4 space-y-4 bg-gray-50">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
            Optional Banking Details
          </p>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Amount Refunded (₦)" error={errors.amount_refunded?.message}>
              <input
                type="number"
                min="0"
                step="0.01"
                placeholder="0.00"
                {...register('amount_refunded')}
                className={inputCls(!!errors.amount_refunded)}
              />
            </Field>
            <Field label="Transfer Charge (₦)" error={errors.transfer_charge?.message}>
              <input
                type="number"
                min="0"
                step="0.01"
                placeholder="0.00"
                {...register('transfer_charge')}
                className={inputCls(!!errors.transfer_charge)}
              />
            </Field>
          </div>
        </div>

        {/* Remarks */}
        <Field label="Remarks" error={errors.remarks?.message}>
          <textarea
            rows={2}
            placeholder="Additional notes…"
            {...register('remarks')}
            className={`${inputCls(!!errors.remarks)} resize-none`}
          />
        </Field>

        {/* Actions */}
        <div className="flex justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={loading}
            className="px-5 py-2 text-sm font-medium text-white bg-danger rounded-lg hover:bg-red-700 transition-colors disabled:opacity-60 flex items-center gap-2"
          >
            {loading && <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
            {loading ? 'Saving…' : 'Save Outflow'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

// ── Tiny helpers ───────────────────────────────────────────────────────────────

function inputCls(hasError: boolean) {
  return `w-full px-3 py-2 text-sm border rounded-lg outline-none transition-colors focus:ring-2 focus:ring-primary/30 ${
    hasError
      ? 'border-red-400 focus:border-red-400'
      : 'border-gray-300 focus:border-primary'
  }`
}

function Field({
  label,
  error,
  children,
}: {
  label: string
  error?: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-gray-600">{label}</label>
      {children}
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  )
}
