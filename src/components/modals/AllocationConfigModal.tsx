import { useEffect, useRef } from 'react'
import { useForm, useFieldArray, useWatch, Controller, type Control } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Plus, Trash2 } from 'lucide-react'
import { Modal, type ModalHandle } from '../ui/Modal'
import { Field, inputCls, focusFirstInvalid } from '../ui/FormField'
import { ButtonSpinner } from '../ui/ButtonSpinner'
import { InlineCategorySelect } from '../ui/InlineCategorySelect'
import {
  useAddAllocationConfig,
  useUpdateAllocationConfig,
} from '../../hooks/useMutations'
import type { AllocationConfig } from '../../store/allocationStore'
import { useCategories } from '../../hooks/useCategories'

const BUDGET_PORTIONS = ['Percentage', 'Specific Seed', 'Savings'] as const
type BudgetPortion = typeof BUDGET_PORTIONS[number]

const rowSchema = z.object({
  category_name:  z.string().min(1, 'Required'),
  budget_portion: z.enum(BUDGET_PORTIONS, { errorMap: () => ({ message: 'Required' }) }),
  percentage:     z.coerce.number().min(0, 'Min 0').max(100, 'Max 100'),
})

const schema = z.object({
  name:       z.string().min(1, 'Name is required'),
  start_date: z.string().min(1, 'Start date is required'),
  rows:       z.array(rowSchema).min(1, 'Add at least one category row')
    .superRefine((rows, ctx) => {
      const seen = new Set<string>()
      rows.forEach((r, i) => {
        const key = `${r.category_name}||${r.budget_portion}`
        if (seen.has(key)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [i, 'budget_portion'],
            message: 'Duplicate category + portion combination',
          })
        }
        seen.add(key)
      })
    }),
})

type FormValues = z.infer<typeof schema>

const EMPTY_ROW = { category_name: '', budget_portion: '' as BudgetPortion, percentage: 0 }

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

  const { categories, refetch: refetchCategories } = useCategories()

  const addMutation    = useAddAllocationConfig()
  const updateMutation = useUpdateAllocationConfig()

  const { mutate: add,    loading: adding,   error: addError,    reset: resetAdd    } = addMutation
  const { mutate: update, loading: updating, error: updateError, reset: resetUpdate } = updateMutation

  const loading = adding || updating
  const error   = addError || updateError
  const modalRef = useRef<ModalHandle>(null)

  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors, isDirty },
    reset: resetForm,
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: '', start_date: '', rows: [{ ...EMPTY_ROW }] },
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
          ? editRecord.rows.map(r => ({
              category_name:  r.category_name,
              budget_portion: (r.budget_portion ?? '') as BudgetPortion,
              percentage:     r.percentage ?? 0,
            }))
          : [{ ...EMPTY_ROW }],
      })
    } else {
      resetForm({ name: '', start_date: '', rows: [{ ...EMPTY_ROW }] })
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
      ref={modalRef}
      open={open}
      onClose={onClose}
      title={isEdit ? 'Edit Configuration' : 'New Configuration'}
      size="max-w-2xl"
      isDirty={isDirty}
      disableClose={loading}
    >
      <form onSubmit={handleSubmit(onSubmit, focusFirstInvalid)} noValidate className="space-y-5">
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
              className={inputCls(!!errors.name)}
            />
          </Field>
          <Field label="Effective From *" error={errors.start_date?.message}>
            <input
              type="date"
              {...register('start_date')}
              className={inputCls(!!errors.start_date)}
            />
          </Field>
        </div>

        {/* Category rows */}
        <div className="space-y-2">
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_80px_32px] gap-2 px-0.5">
            <span className="text-xs font-medium text-gray-600">Category <span aria-hidden="true" className="text-danger">*</span></span>
            <span className="text-xs font-medium text-gray-600">Budget Portion <span aria-hidden="true" className="text-danger">*</span></span>
            <span className="text-xs font-medium text-gray-600 text-right">Percentage <span aria-hidden="true" className="text-danger">*</span></span>
            <span />
          </div>

          {categories.length === 0 && (
            <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              No categories found. Create categories on the Categories page first.
            </p>
          )}

          {fields.map((field, idx) => (
            <div key={field.id} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_80px_32px] gap-2 items-start">
              {/* Category */}
              <div>
                <Controller
                  control={control}
                  name={`rows.${idx}.category_name`}
                  render={({ field }) => (
                    <InlineCategorySelect
                      value={field.value}
                      onChange={field.onChange}
                      categories={categories}
                      onRefresh={refetchCategories}
                      selectCls={inputCls(!!errors.rows?.[idx]?.category_name)}
                    />
                  )}
                />
                {errors.rows?.[idx]?.category_name && (
                  <p className="mt-0.5 text-xs text-red-500">{errors.rows[idx]!.category_name!.message}</p>
                )}
              </div>

              {/* Budget portion */}
              <div>
                <select
                  {...register(`rows.${idx}.budget_portion`)}
                  className={inputCls(!!errors.rows?.[idx]?.budget_portion)}
                >
                  <option value="">— Portion —</option>
                  {BUDGET_PORTIONS.map(p => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
                {errors.rows?.[idx]?.budget_portion && (
                  <p className="mt-0.5 text-xs text-red-500">{errors.rows[idx]!.budget_portion!.message}</p>
                )}
              </div>

              {/* Percentage */}
              <div>
                <div className="relative">
                  <input
                    type="text" inputMode="decimal"
                    step="0.1"
                    min="0"
                    max="100"
                    placeholder="0"
                    {...register(`rows.${idx}.percentage`)}
                    className={`${inputCls(!!errors.rows?.[idx]?.percentage)} pr-7 text-right`}
                  />
                  <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-gray-500 pointer-events-none">%</span>
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
            onClick={() => append({ ...EMPTY_ROW })}
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
            onClick={() => modalRef.current?.requestClose()}
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
            {loading && <ButtonSpinner />}
            {loading ? 'Saving…' : 'Save as Draft'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

