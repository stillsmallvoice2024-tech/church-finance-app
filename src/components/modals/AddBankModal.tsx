import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { AlertTriangle, Terminal } from 'lucide-react'
import { Modal } from '../ui/Modal'
import { useAddBank, useUpdateBank, type AddBankInput } from '../../hooks/useMutations'
import { useCategories } from '../../hooks/useCategories'
import type { DbBank } from '../../hooks/useBanks'

const ACCOUNT_TYPES = ['Current', 'Savings', 'Fixed Deposit', 'Domiciliary'] as const
const BUDGET_PORTIONS = ['Percentage Allocation', 'Specific Seed', 'Savings'] as const

const MIGRATION_SQL =
`ALTER TABLE banks
  ADD COLUMN IF NOT EXISTS starting_balance          numeric(15,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS starting_balance_category text,
  ADD COLUMN IF NOT EXISTS starting_balance_budget_portion text;`

const schema = z.object({
  name:           z.string().min(1, 'Bank name is required'),
  account_number: z.string().optional(),
  account_type:   z.string().optional(),
  starting_balance:               z.coerce.number().min(0).optional(),
  starting_balance_category:      z.string().optional(),
  starting_balance_budget_portion: z.string().optional(),
}).superRefine((data, ctx) => {
  if ((data.starting_balance ?? 0) > 0 && !data.starting_balance_category) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Category is required when a starting balance is set',
      path: ['starting_balance_category'],
    })
  }
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
  const { categories } = useCategories()

  const addMutation    = useAddBank()
  const updateMutation = useUpdateBank()

  const { mutate: add,    loading: adding,   error: addError,    reset: resetAdd    } = addMutation
  const { mutate: update, loading: updating, error: updateError, reset: resetUpdate } = updateMutation

  const loading = adding || updating
  const error   = addError || updateError

  const { register, handleSubmit, formState: { errors }, reset: resetForm, watch } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: '', account_number: '', account_type: '' },
  })

  const startingBalance = watch('starting_balance')
  const hasBalance = (startingBalance ?? 0) > 0

  useEffect(() => {
    if (!open) return
    resetAdd()
    resetUpdate()
    if (editRecord) {
      resetForm({
        name:           editRecord.name,
        account_number: editRecord.account_number ?? '',
        account_type:   editRecord.account_type   ?? '',
        starting_balance:               editRecord.starting_balance               ?? undefined,
        starting_balance_category:      editRecord.starting_balance_category      ?? '',
        starting_balance_budget_portion: editRecord.starting_balance_budget_portion ?? '',
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
      starting_balance:               values.starting_balance               || undefined,
      starting_balance_category:      values.starting_balance_category      || undefined,
      starting_balance_budget_portion: values.starting_balance_budget_portion || undefined,
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

  const isMigrationError = !!error && /starting_balance|Could not find|column.*bank/i.test(error)

  return (
    <Modal open={open} onClose={onClose} title={isEdit ? 'Edit Bank' : 'Add Bank'}>
      <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">

        {error && (
          <div className="space-y-2">
            <div className="flex items-start gap-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>
                {isMigrationError
                  ? 'Database migration required — run the SQL below in your Supabase SQL Editor, then try again.'
                  : error}
              </span>
            </div>
            {isMigrationError && (
              <div className="rounded-lg border border-gray-200 bg-gray-900 overflow-hidden">
                <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-800 border-b border-gray-700">
                  <Terminal className="w-3 h-3 text-gray-400" />
                  <span className="text-[10px] text-gray-400 font-mono">Supabase SQL Editor</span>
                </div>
                <pre className="px-3 py-3 text-[11px] text-green-300 font-mono overflow-x-auto whitespace-pre">{MIGRATION_SQL}</pre>
              </div>
            )}
          </div>
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

        {/* Opening Balance section */}
        <div className="border border-gray-100 rounded-lg p-4 space-y-3 bg-gray-50">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Opening Balance (optional)</p>

          <Field label="Starting Balance (₦)" error={errors.starting_balance?.message}>
            <input
              type="number" min="0" step="0.01" placeholder="0.00"
              {...register('starting_balance')}
              className={iCls(!!errors.starting_balance)}
            />
          </Field>

          <Field
            label={`Category${hasBalance ? ' *' : ''}`}
            error={errors.starting_balance_category?.message}
          >
            <select
              {...register('starting_balance_category')}
              className={`${iCls(!!errors.starting_balance_category)} bg-white`}
              disabled={!hasBalance}
            >
              <option value="">— Select category —</option>
              {categories.map(c => (
                <option key={c.id} value={c.name}>{c.name}</option>
              ))}
            </select>
          </Field>

          <Field label="Budget Portion" error={errors.starting_balance_budget_portion?.message}>
            <select
              {...register('starting_balance_budget_portion')}
              className={`${iCls(!!errors.starting_balance_budget_portion)} bg-white`}
              disabled={!hasBalance}
            >
              <option value="">— Select portion —</option>
              {BUDGET_PORTIONS.map(p => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </Field>
        </div>

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
