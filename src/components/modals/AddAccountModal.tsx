import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Modal } from '../ui/Modal'
import { useAddAccount, useUpdateAccount, type AddAccountInput } from '../../hooks/useMutations'
import type { DbAccount } from '../../hooks/useLedger'

const CATEGORIES = ['income', 'expense', 'savings', 'ministry', 'special', 'foreign'] as const

const schema = z.object({
  code:            z.string().min(1, 'Code is required'),
  name:            z.string().min(1, 'Name is required'),
  category:        z.enum(CATEGORIES),
  opening_balance: z.coerce.number().min(0).optional().or(z.literal('')).transform(v => v === '' ? 0 : Number(v)),
})

type FormValues = z.infer<typeof schema>

interface Props {
  open:        boolean
  onClose:     () => void
  onSuccess?:  () => void
  editRecord?: DbAccount | null
}

export function AddAccountModal({ open, onClose, onSuccess, editRecord }: Props) {
  const isEdit = !!editRecord

  const addMutation    = useAddAccount()
  const updateMutation = useUpdateAccount()

  const { mutate: add,    loading: adding,   error: addError,    reset: resetAdd    } = addMutation
  const { mutate: update, loading: updating, error: updateError, reset: resetUpdate } = updateMutation

  const loading = adding || updating
  const error   = addError || updateError

  const { register, handleSubmit, formState: { errors }, reset: resetForm } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { category: 'income' },
  })

  useEffect(() => {
    if (!open) return
    resetAdd()
    resetUpdate()
    if (editRecord) {
      resetForm({
        code:            editRecord.code,
        name:            editRecord.name,
        category:        editRecord.category,
        opening_balance: editRecord.opening_balance ?? 0,
      })
    } else {
      resetForm({ category: 'income', opening_balance: undefined })
    }
  }, [open, editRecord, resetForm, resetAdd, resetUpdate])

  const onSubmit = async (values: FormValues) => {
    try {
      if (isEdit && editRecord) {
        await update({
          id:              editRecord.id,
          code:            values.code,
          name:            values.name,
          category:        values.category,
          opening_balance: typeof values.opening_balance === 'number' ? values.opening_balance : 0,
        })
      } else {
        const input: AddAccountInput = {
          code:            values.code,
          name:            values.name,
          category:        values.category,
          opening_balance: typeof values.opening_balance === 'number' ? values.opening_balance : 0,
        }
        await add(input)
      }
      onSuccess?.()
      onClose()
    } catch { /* surfaced via hook error */ }
  }

  return (
    <Modal open={open} onClose={onClose} title={isEdit ? 'Edit Account' : 'Add Account'}>
      <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
        {error && <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{error}</div>}

        <div className="grid grid-cols-2 gap-4">
          <Field label="Code *" error={errors.code?.message}>
            <input type="text" placeholder="e.g. 300" {...register('code')} className={iCls(!!errors.code)} />
          </Field>
          <Field label="Name *" error={errors.name?.message}>
            <input type="text" placeholder="Account name" {...register('name')} className={iCls(!!errors.name)} />
          </Field>
        </div>

        <Field label="Category" error={errors.category?.message}>
          <select {...register('category')} className={`${iCls(!!errors.category)} bg-white`}>
            {CATEGORIES.map(c => (
              <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>
            ))}
          </select>
        </Field>

        <Field label="Opening Balance (₦)" error={errors.opening_balance?.message}>
          <input type="number" min="0" step="0.01" placeholder="0.00" {...register('opening_balance')} className={iCls(!!errors.opening_balance)} />
        </Field>

        <div className="flex justify-end gap-3 pt-2">
          <button type="button" onClick={onClose} disabled={loading} className="px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50">Cancel</button>
          <button type="submit" disabled={loading} className="px-5 py-2 text-sm text-white bg-primary rounded-lg hover:bg-primary-light disabled:opacity-60 flex items-center gap-2">
            {loading && <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
            {loading ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Account'}
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
