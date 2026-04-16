import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Modal } from '../ui/Modal'
import { useAddSpecialProject, type AddSpecialProjectInput } from '../../hooks/useMutations'

const schema = z.object({
  name:            z.string().min(1, 'Name is required'),
  code:            z.string().optional(),
  opening_balance: z.coerce.number().min(0).optional().or(z.literal('')).transform(v => v === '' ? 0 : Number(v)),
})

type FormValues = z.infer<typeof schema>

interface Props {
  open: boolean
  onClose: () => void
  onSuccess?: () => void
}

export function AddSpecialProjectModal({ open, onClose, onSuccess }: Props) {
  const { mutate, loading, error, reset } = useAddSpecialProject()
  const { register, handleSubmit, formState: { errors }, reset: resetForm } = useForm<FormValues>({ resolver: zodResolver(schema) })

  useEffect(() => {
    if (!open) return
    reset()
    resetForm({})
  }, [open, reset, resetForm])

  const onSubmit = async (values: FormValues) => {
    const input: AddSpecialProjectInput = {
      name:            values.name,
      code:            values.code || undefined,
      opening_balance: typeof values.opening_balance === 'number' ? values.opening_balance : 0,
    }
    try {
      await mutate(input)
      onSuccess?.()
      onClose()
    } catch { /* surfaced via hook error */ }
  }

  return (
    <Modal open={open} onClose={onClose} title="Add Special Project">
      <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
        {error && <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{error}</div>}

        <Field label="Project Name *" error={errors.name?.message}>
          <input type="text" placeholder="e.g. Building Fund" {...register('name')} className={iCls(!!errors.name)} />
        </Field>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Code" error={errors.code?.message}>
            <input type="text" placeholder="e.g. SP-08" {...register('code')} className={iCls(false)} />
          </Field>
          <Field label="Opening Balance (₦)" error={errors.opening_balance?.message}>
            <input type="number" min="0" step="0.01" placeholder="0.00" {...register('opening_balance')} className={iCls(!!errors.opening_balance)} />
          </Field>
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <button type="button" onClick={onClose} disabled={loading} className="px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50">Cancel</button>
          <button type="submit" disabled={loading} className="px-5 py-2 text-sm text-white bg-primary rounded-lg hover:bg-primary-light disabled:opacity-60 flex items-center gap-2">
            {loading && <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
            {loading ? 'Creating…' : 'Create Project'}
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
