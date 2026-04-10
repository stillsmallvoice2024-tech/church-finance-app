import { useEffect, useMemo } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Modal } from '../ui/Modal'
import { useAddLedgerEntry, type AddLedgerEntryInput } from '../../hooks/useMutations'

const num = z.coerce.number().min(0).optional().or(z.literal('')).transform(v => v === '' ? undefined : Number(v))

const schema = z.object({
  date:                      z.string().min(1, 'Date is required'),
  description:               z.string().optional(),
  inflow:                    num,
  refund_intraflow:          num,
  outflow:                   num,
  special_seed_description:  z.string().optional(),
})

type FormValues = z.infer<typeof schema>

interface Props {
  open: boolean
  onClose: () => void
  onSuccess?: () => void
  accountId: string
  previousBalance: number
}

export function AddLedgerEntryModal({ open, onClose, onSuccess, accountId, previousBalance }: Props) {
  const { mutate, loading, error, reset } = useAddLedgerEntry()

  const {
    register, handleSubmit, watch, reset: resetForm,
    formState: { errors },
  } = useForm<FormValues>({ resolver: zodResolver(schema) })

  useEffect(() => {
    if (!open) return
    reset()
    resetForm({ date: new Date().toISOString().slice(0, 10) })
  }, [open, reset, resetForm])

  const inflow   = Number(watch('inflow')          || 0)
  const refund   = Number(watch('refund_intraflow') || 0)
  const outflow  = Number(watch('outflow')          || 0)
  const newBalance = useMemo(
    () => previousBalance + inflow + refund - outflow,
    [previousBalance, inflow, refund, outflow],
  )

  const onSubmit = async (values: FormValues) => {
    const input: AddLedgerEntryInput = {
      account_id:              accountId,
      date:                    values.date,
      description:             values.description            || undefined,
      inflow:                  typeof values.inflow === 'number' ? values.inflow : 0,
      refund_intraflow:        typeof values.refund_intraflow === 'number' ? values.refund_intraflow : 0,
      outflow:                 typeof values.outflow === 'number' ? values.outflow : 0,
      balance:                 newBalance,
      special_seed_description: values.special_seed_description || undefined,
    }
    try {
      await mutate(input)
      onSuccess?.()
      onClose()
    } catch { /* surfaced via hook error */ }
  }

  return (
    <Modal open={open} onClose={onClose} title="Add Ledger Entry">
      <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
        {error && <ErrBanner msg={error} />}

        <div className="grid grid-cols-2 gap-4">
          <Field label="Date *" error={errors.date?.message}>
            <input type="date" {...register('date')} className={iCls(!!errors.date)} />
          </Field>
          <Field label="Description" error={errors.description?.message}>
            <input type="text" placeholder="Narration" {...register('description')} className={iCls(false)} />
          </Field>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <Field label="Inflow (₦)" error={errors.inflow?.message}>
            <input type="number" min="0" step="0.01" placeholder="0.00" {...register('inflow')} className={iCls(!!errors.inflow)} />
          </Field>
          <Field label="Refund/Intra (₦)" error={errors.refund_intraflow?.message}>
            <input type="number" min="0" step="0.01" placeholder="0.00" {...register('refund_intraflow')} className={iCls(false)} />
          </Field>
          <Field label="Outflow (₦)" error={errors.outflow?.message}>
            <input type="number" min="0" step="0.01" placeholder="0.00" {...register('outflow')} className={iCls(!!errors.outflow)} />
          </Field>
        </div>

        {/* Auto-calculated balance preview */}
        <div className="rounded-lg bg-gray-50 border border-gray-200 px-4 py-3 flex items-center justify-between">
          <span className="text-sm text-gray-500">New Balance (auto-calculated)</span>
          <span className={`text-base font-bold ${newBalance >= 0 ? 'text-success' : 'text-danger'}`}>
            ₦{newBalance.toLocaleString('en-NG', { minimumFractionDigits: 2 })}
          </span>
        </div>

        <Field label="Specific Seed Description" error={errors.special_seed_description?.message}>
          <input type="text" placeholder="Seed description" {...register('special_seed_description')} className={iCls(false)} />
        </Field>

        <div className="flex justify-end gap-3 pt-2">
          <button type="button" onClick={onClose} disabled={loading} className="px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50">Cancel</button>
          <button type="submit" disabled={loading} className="px-5 py-2 text-sm text-white bg-primary rounded-lg hover:bg-primary-light disabled:opacity-60 flex items-center gap-2">
            {loading && <Spinner />}{loading ? 'Saving…' : 'Save Entry'}
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
function ErrBanner({ msg }: { msg: string }) {
  return <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{msg}</div>
}
function Spinner() {
  return <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
}
