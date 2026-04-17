import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Modal } from '../ui/Modal'
import { useAddBank, useUpdateBank, type AddBankInput } from '../../hooks/useMutations'
import type { DbBank } from '../../hooks/useBanks'

const ACCOUNT_TYPES = ['Current', 'Savings', 'Fixed Deposit', 'Domiciliary'] as const

const schema = z.object({
  name:           z.string().min(1, 'Bank name is required'),
  account_number: z.string().optional(),
  account_type:   z.string().optional(),
})

type FormValues = z.infer<typeof schema>

interface Props {
  open:        boolean
  onClose:     () => void
  onSuccess?:  () => void
  editRecord?: DbBank | null
}

export function AddBankModal({ open, onClose, onSuccess, editRecord }: Props) {
  const isEdit = !!editRecord

  const addMutation    = useAddBank()
  const updateMutation = useUpdateBank()

  const { mutate: add,    loading: adding,   error: addError,    reset: resetAdd    } = addMutation
  const { mutate: update, loading: updating, error: updateError, reset: resetUpdate } = updateMutation

  const loading = adding || updating
  const error   = addError || updateError

  const { register, handleSubmit, formState: { errors }, reset: resetForm } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: '', account_number: '', account_type: '' },
  })

  useEffect(() => {
    if (!open) return
    resetAdd()
    resetUpdate()
    if (editRecord) {
      resetForm({
        name:           editRecord.name,
        account_number: editRecord.account_number ?? '',
        account_type:   editRecord.account_type   ?? '',
      })
    } else {
      resetForm({ name: '', account_number: '', account_type: '' })
    }
  }, [open, editRecord, resetForm, resetAdd, resetUpdate])

  const onSubmit = async (values: FormValues) => {
    const payload: AddBankInput = {
      name:           values.name,
      account_number: values.account_number || undefined,
      account_type:   values.account_type   || undefined,
    }
    try {
      if (isEdit && editRecord) {
        await update({ id: editRecord.id, ...payload })
      } else {
        await add(payload)
      }
      onSuccess?.()
      onClose()
    } catch { /* surfaced via hook error */ }
  }

  return (
    <Modal open={open} onClose={onClose} title={isEdit ? 'Edit Bank' : 'Add Bank'}>
      <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
        {error && (
          <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{error}</div>
        )}

        <Field label="Bank Name *" error={errors.name?.message}>
          <input
            type="text"
            placeholder="e.g. First Bank of Nigeria"
            {...register('name')}
            className={iCls(!!errors.name)}
          />
        </Field>

        <Field label="Account Number" error={errors.account_number?.message}>
          <input
            type="text"
            placeholder="e.g. 0123456789"
            {...register('account_number')}
            className={iCls(!!errors.account_number)}
          />
        </Field>

        <Field label="Account Type" error={errors.account_type?.message}>
          <select {...register('account_type')} className={`${iCls(!!errors.account_type)} bg-white`}>
            <option value="">— Select type —</option>
            {ACCOUNT_TYPES.map(t => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </Field>

        <div className="flex justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={loading}
            className="px-5 py-2 text-sm text-white bg-primary rounded-lg hover:bg-primary-light disabled:opacity-60 flex items-center gap-2"
          >
            {loading && <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
            {loading ? 'Saving…' : isEdit ? 'Save Changes' : 'Add Bank'}
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
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-gray-600">{label}</label>
      {children}
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  )
}
