import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Modal } from '../ui/Modal'
import { useAddInflow, type AddInflowInput } from '../../hooks/useMutations'

// ── Zod schema ─────────────────────────────────────────────────────────────────

const schema = z.object({
  date:                       z.string().min(1, 'Date is required'),
  amount:                     z.coerce.number({ invalid_type_error: 'Enter a valid amount' }).positive('Amount must be greater than zero'),
  description:                z.string().optional(),
  stage_code_1:               z.string().optional(),
  transaction_ref:            z.string().optional(),
  specific_seed_description:  z.string().optional(),
  remark:                     z.string().optional(),
})

type FormValues = z.infer<typeof schema>

// ── Component ──────────────────────────────────────────────────────────────────

interface Props {
  open: boolean
  onClose: () => void
  onSuccess?: (id: string) => void
}

export function AddInflowModal({ open, onClose, onSuccess }: Props) {
  const { mutate, loading, error, reset } = useAddInflow()

  const {
    register,
    handleSubmit,
    formState: { errors },
    reset: resetForm,
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { date: new Date().toISOString().slice(0, 10) },
  })

  // Reset form + mutation error whenever modal opens/closes
  useEffect(() => {
    if (open) {
      resetForm({ date: new Date().toISOString().slice(0, 10) })
      reset()
    }
  }, [open, resetForm, reset])

  const onSubmit = async (values: FormValues) => {
    const input: AddInflowInput = {
      date:                      values.date,
      amount:                    values.amount,
      description:               values.description || undefined,
      stage_code_1:              values.stage_code_1 || undefined,
      transaction_ref:           values.transaction_ref || undefined,
      specific_seed_description: values.specific_seed_description || undefined,
      remark:                    values.remark || undefined,
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
    <Modal open={open} onClose={onClose} title="Add Inflow Transaction">
      <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">

        {/* Mutation-level error */}
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
          <Field label="Amount (₦) *" error={errors.amount?.message}>
            <input
              type="number"
              min="0"
              step="0.01"
              placeholder="0.00"
              {...register('amount')}
              className={inputCls(!!errors.amount)}
            />
          </Field>
        </div>

        {/* Description */}
        <Field label="Description" error={errors.description?.message}>
          <input
            type="text"
            placeholder="e.g. Sunday offering"
            {...register('description')}
            className={inputCls(!!errors.description)}
          />
        </Field>

        {/* Stage Code + Transaction Ref */}
        <div className="grid grid-cols-2 gap-4">
          <Field label="Stage Code" error={errors.stage_code_1?.message}>
            <input
              type="text"
              placeholder="e.g. T01"
              {...register('stage_code_1')}
              className={inputCls(!!errors.stage_code_1)}
            />
          </Field>
          <Field label="Transaction Ref" error={errors.transaction_ref?.message}>
            <input
              type="text"
              placeholder="Ref / cheque no."
              {...register('transaction_ref')}
              className={inputCls(!!errors.transaction_ref)}
            />
          </Field>
        </div>

        {/* Specific Seed Description */}
        <Field label="Seed Description" error={errors.specific_seed_description?.message}>
          <input
            type="text"
            placeholder="Specific seed description (if any)"
            {...register('specific_seed_description')}
            className={inputCls(!!errors.specific_seed_description)}
          />
        </Field>

        {/* Remark */}
        <Field label="Remark" error={errors.remark?.message}>
          <textarea
            rows={2}
            placeholder="Additional notes…"
            {...register('remark')}
            className={`${inputCls(!!errors.remark)} resize-none`}
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
            className="px-5 py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary-light transition-colors disabled:opacity-60 flex items-center gap-2"
          >
            {loading && <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
            {loading ? 'Saving…' : 'Save Inflow'}
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
