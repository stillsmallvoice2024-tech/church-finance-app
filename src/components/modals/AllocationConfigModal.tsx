import { useEffect } from 'react'
import { useForm, useFieldArray, useWatch, type Control } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Plus, Trash2 } from 'lucide-react'
import { Modal } from '../ui/Modal'
import {
  useAddAllocationConfig,
  useUpdateAllocationConfig,
} from '../../hooks/useMutations'
import type { AllocationConfig } from '../../store/allocationStore'
import { useCategories } from '../../hooks/useCategories'

const rowSchema = z.object({
  category_name: z.string().min(1, 'Required'),
  percentage:    z.coerce.number().min(0, 'Min 0').max(100, 'Max 100'),
})

const schema = z.object({
  name:       z.string().min(1, 'Name is required'),
  start_date: z.string().min(1, 'Start date is required'),
  rows:       z.array(rowSchema).min(1, 'Add at least one category row'),
})

type FormValues = z.infer<typeof schema>

interface Props {
  open:            boolean
  onClose:         () => void
  onSuccess?:      () => void
  editRecord?:     AllocationConfig | null
  existingConfigs?: AllocationConfig[]
}

// ── Live total strip ───────────────────────────────────────────────────────────

function TotalStrip({ control }: { control: Control<FormValues> }) {
  const rows  = useWatch({ control, name: 'rows' }) ?? []
  const total = rows.reduce((s, r) => s + Number(r?.percentage || 0), 0)
  const diff  = 100 - total
  const exact = Math.abs(diff) < 0.01

  return (
    <div className={`flex items-center justify-between rounded-lg px-4 py-2.5 text-sm font-medium border ${
      exact
        ? 'bg-green-50 border-green-200 text-green-700'
        : 'bg-amber-50 border-amber-200 text-amber-700'
    }`}>
      <span>Running total</span>
      <span className="font-mono text-base">
        {total.toFixed(1)}%
        {!exact && (
          <span className="ml-2 text-xs font-normal opacity-75">
            ({diff > 0 ? '+' : ''}{diff.toFixed(1)}% to reach 100%)
          </span>
        )}
      </span>
    </div>
  )
}

// ── Modal ──────────────────────────────────────────────────────────────────────

export function AllocationConfigModal({ open, onClose, onSuccess, editRecord, existingConfigs = [] }: Props) {
  const isEdit = !!editRecord?.id

  const { categories } = useCategories()

  const addMutation    = useAddAllocationConfig()
  const updateMutation = useUpdateAllocationConfig()

  const { mutate: add,    loading: adding,   error: addError,    reset: resetAdd    } = addMutation
  const { mutate: update, loading: updating, error: updateError, reset: resetUpdate } = updateMutation

  const loading = adding || updating
  const error   = addError || updateError

  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors },
    reset: resetForm,
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: '', start_date: '', rows: [{ category_name: '', percentage: 0 }] },
  })

  const { fields, append, remove } = useFieldArray({ control, name: 'rows' })

  useEffect(() => {
    if (!open) return
    resetAdd()
    resetUpdate()
    if (editRecord) {
      resetForm({
        name:       editRecord.name,
        start_date: editRecord.start_date,
        rows:       editRecord.rows.length > 0
          ? editRecord.rows
          : [{ category_name: '', percentage: 0 }],
      })
    } else {
      resetForm({ name: '', start_date: '', rows: [{ category_name: '', percentage: 0 }] })
    }
  }, [open, editRecord, resetForm, resetAdd, resetUpdate])

  const onSubmit = async (values: FormValues) => {
    const clash = existingConfigs.find(
      c => c.start_date === values.start_date && c.id !== editRecord?.id,
    )
    if (clash) {
      setError('start_date', { message: `Another configuration ("${clash.name}") already uses this date.` })
      return
    }
    try {
      if (isEdit && editRecord) {
        await update({ id: editRecord.id, ...values })
      } else {
        await add(values)
      }
      onSuccess?.()
      onClose()
    } catch { /* surfaced via hook error */ }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? 'Edit Configuration' : 'New Configuration'}
      size="max-w-xl"
    >
      <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-5">
        {error && (
          <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{error}</div>
        )}

        {/* Name + Date */}
        <div className="grid grid-cols-2 gap-4">
          <Field label="Configuration Name *" error={errors.name?.message}>
            <input
              type="text"
              placeholder="e.g. 2025 Allocation"
              {...register('name')}
              className={iCls(!!errors.name)}
            />
          </Field>
          <Field label="Effective From *" error={errors.start_date?.message}>
            <input
              type="date"
              {...register('start_date')}
              className={iCls(!!errors.start_date)}
            />
          </Field>
        </div>

        {/* Category rows */}
        <div className="space-y-2">
          <div className="grid grid-cols-[1fr_100px_32px] gap-2 px-0.5">
            <span className="text-xs font-medium text-gray-600">Category</span>
            <span className="text-xs font-medium text-gray-600 text-right">Percentage</span>
            <span />
          </div>

          {categories.length === 0 && (
            <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              No categories found. Create categories on the Categories page first.
            </p>
          )}

          {fields.map((field, idx) => (
            <div key={field.id} className="grid grid-cols-[1fr_100px_32px] gap-2 items-start">
              <div>
                <select
                  {...register(`rows.${idx}.category_name`)}
                  className={iCls(!!errors.rows?.[idx]?.category_name)}
                  disabled={categories.length === 0}
                >
                  <option value="">Select category…</option>
                  {categories.map(c => (
                    <option key={c.id} value={c.name}>{c.name}</option>
                  ))}
                </select>
                {errors.rows?.[idx]?.category_name && (
                  <p className="mt-0.5 text-xs text-red-500">{errors.rows[idx]!.category_name!.message}</p>
                )}
              </div>
              <div>
                <div className="relative">
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    max="100"
                    placeholder="0"
                    {...register(`rows.${idx}.percentage`)}
                    className={`${iCls(!!errors.rows?.[idx]?.percentage)} pr-7 text-right`}
                  />
                  <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-gray-400 pointer-events-none">%</span>
                </div>
                {errors.rows?.[idx]?.percentage && (
                  <p className="mt-0.5 text-xs text-red-500">{errors.rows[idx]!.percentage!.message}</p>
                )}
              </div>
              <button
                type="button"
                onClick={() => remove(idx)}
                disabled={fields.length === 1}
                className="mt-1 p-1.5 rounded-lg text-gray-400 hover:text-danger hover:bg-red-50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}

          {errors.rows?.root && (
            <p className="text-xs text-red-500">{errors.rows.root.message}</p>
          )}

          <button
            type="button"
            onClick={() => append({ category_name: '', percentage: 0 })}
            className="flex items-center gap-1.5 text-xs font-medium text-primary hover:text-primary-light transition-colors pt-1"
          >
            <Plus className="w-3.5 h-3.5" /> Add row
          </button>
        </div>

        {/* Live total */}
        <TotalStrip control={control} />

        <div className="flex justify-end gap-3 pt-1">
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
            {loading ? 'Saving…' : 'Save as Draft'}
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
