import { useEffect, useState } from 'react'
import { useForm, useWatch, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Modal } from '../ui/Modal'
import { TechDetails } from '../ui/TechDetails'
import { Field, inputCls } from '../ui/FormField'
import { ButtonSpinner } from '../ui/ButtonSpinner'
import { CollapsibleSection } from '../ui/CollapsibleSection'
import { useAddOutflow, useUpdateTransaction, type AddOutflowInput } from '../../hooks/useMutations'
import { useCategories } from '../../hooks/useCategories'
import { useBanks } from '../../hooks/useBanks'
import { useOutflowTypeOptions, useCategoryOutflowTypeMaps, getDefaultOutflowTypeForCategory } from '../../hooks/useOutflowTypes'
import { useDepartmentOptions } from '../../hooks/useDepartments'
import type { OutflowTransaction } from '../../hooks/useTransactions'
import { CurrencyInput } from '../ui/CurrencyInput'

const TXN_TYPES = [
  { value: '',                   label: 'Normal' },
  { value: 'refund',             label: 'Refund' },
  { value: 'reversal',           label: 'Reversal' },
  { value: 'bank_deposit',       label: 'Bank Deposit' },
  { value: 'intrabank_transfer', label: 'Intrabank Transfer' },
]

// ── Zod schema ─────────────────────────────────────────────────────────────────────────────

const optNum = z.union([
  z.coerce.number().min(0),
  z.literal('').transform(() => undefined),
]).optional()

const schema = z.object({
  date:                    z.string().min(1, 'Date is required'),
  created_at_date:         z.string().optional(),
  recorded_at_date:        z.string().optional(),
  amount_disbursed:        z.coerce.number({ invalid_type_error: 'Enter a valid amount' }).positive('Amount must be greater than zero'),
  bank_name:               z.string().optional(),
  description:             z.string().optional(),
  bank_description:        z.string().optional(),
  transaction_id:          z.string().optional(),
  stage_code_1:            z.string().optional(),
  stage_code_2:            z.string().optional(),
  outflow_type_id:         z.string().optional(),
  department_id:           z.string().optional(),
  remarks:                 z.string().optional(),
  fx_currency:             z.string().optional(),
  fx_amount:               optNum,
  fx_rate:                 optNum,
  transaction_type:        z.string().optional(),
  original_transaction_id: z.string().optional(),
})

type FormValues = z.infer<typeof schema>

// ── Component ──────────────────────────────────────────────────────────────────────────────

interface Props {
  open: boolean
  onClose: () => void
  onSuccess?: () => void
  editRecord?: OutflowTransaction | null
}

export function AddOutflowModal({ open, onClose, onSuccess, editRecord }: Props) {
  const { categories }    = useCategories()
  const { banks }         = useBanks()
  const { options: outflowTypeOptions } = useOutflowTypeOptions()
  const { maps: categoryOutflowMaps }  = useCategoryOutflowTypeMaps()
  const { options: departmentOptions } = useDepartmentOptions()
  const isEdit = !!editRecord
  const [isPending, setIsPending] = useState(false)

  const addMutation    = useAddOutflow()
  const updateMutation = useUpdateTransaction('outflow_transactions')

  const { mutate: add,    loading: adding,   error: addError,    reset: resetAdd    } = addMutation
  const { mutate: update, loading: updating, error: updateError, reset: resetUpdate } = updateMutation

  const loading = adding || updating
  const error   = addError || updateError

  const {
    register,
    handleSubmit,
    formState: { errors, isDirty },
    reset: resetForm,
    setValue,
    control,
  } = useForm<FormValues>({ resolver: zodResolver(schema) })

  const transactionType = useWatch({ control, name: 'transaction_type' })
  const stage1Watch     = useWatch({ control, name: 'stage_code_1' })

  useEffect(() => {
    if (!open) return
    resetAdd()
    resetUpdate()
    if (editRecord) {
      setIsPending(editRecord.is_pending_deduction ?? false)
      resetForm({
        date:                    editRecord.date,
        created_at_date:         editRecord.created_at ? editRecord.created_at.slice(0, 10) : '',
        recorded_at_date:        editRecord.recorded_at?.slice(0, 10) ?? '',
        amount_disbursed:        editRecord.amount_disbursed,
        bank_name:               editRecord.bank_name               ?? '',
        description:             editRecord.description             ?? '',
        bank_description:        editRecord.bank_description        ?? '',
        transaction_id:          editRecord.transaction_id          ?? '',
        stage_code_1:            editRecord.stage_code_1            ?? '',
        stage_code_2:            editRecord.stage_code_2            ?? '',
        outflow_type_id:         editRecord.outflow_type_id         ?? '',
        department_id:           editRecord.department_id           ?? '',
        remarks:                 editRecord.remarks                 ?? '',
        fx_currency:             editRecord.fx_currency             ?? '',
        fx_amount:               editRecord.fx_amount               ?? undefined,
        fx_rate:                 editRecord.fx_rate                 ?? undefined,
        transaction_type:        editRecord.transaction_type        ?? '',
        original_transaction_id: editRecord.original_transaction_id ?? '',
      })
    } else {
      setIsPending(false)
      resetForm({ date: new Date().toISOString().slice(0, 10), recorded_at_date: new Date().toISOString().slice(0, 10), amount_disbursed: undefined })
    }
  }, [open, editRecord, resetForm, resetAdd, resetUpdate])

  // Auto-suggest outflow type from the category-outflow map when stage_code_1 changes
  // (only if user hasn't already picked a type; never forced — user can override)
  const currentTypeId = useWatch({ control, name: 'outflow_type_id' })
  useEffect(() => {
    if (!open || isEdit || currentTypeId) return
    if (!stage1Watch) return
    const cat = categories.find(c => c.name === stage1Watch)
    if (cat) {
      const suggested = getDefaultOutflowTypeForCategory(cat.id, categoryOutflowMaps, outflowTypeOptions)
      if (suggested) setValue('outflow_type_id', suggested.id)
    }
  }, [stage1Watch, categories, categoryOutflowMaps, outflowTypeOptions, open, isEdit, currentTypeId, setValue])

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
            outflow_type_id:         values.outflow_type_id         || null,
            department_id:           values.department_id           || null,
            remarks:                 values.remarks                 || null,
            is_pending_deduction:    isPending,
            fx_currency:             values.fx_currency             || null,
            fx_amount:               typeof values.fx_amount === 'number' ? values.fx_amount : null,
            fx_rate:                 typeof values.fx_rate   === 'number' ? values.fx_rate   : null,
            transaction_type:        values.transaction_type        || null,
            original_transaction_id: values.original_transaction_id || null,
            ...(values.created_at_date ? { created_at: `${values.created_at_date}T00:00:00.000Z` } : {}),
            ...(values.recorded_at_date ? { recorded_at: `${values.recorded_at_date}T00:00:00.000Z` } : {}),
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
          outflow_type_id:         values.outflow_type_id         || null,
          department_id:           values.department_id           || null,
          remarks:                 values.remarks                 || undefined,
          fx_currency:             values.fx_currency             || undefined,
          fx_amount:               typeof values.fx_amount === 'number' ? values.fx_amount : undefined,
          fx_rate:                 typeof values.fx_rate   === 'number' ? values.fx_rate   : undefined,
          transaction_type:        values.transaction_type        || undefined,
          original_transaction_id: values.original_transaction_id || undefined,
          ...(values.recorded_at_date ? { recorded_at: `${values.recorded_at_date}T00:00:00.000Z` } : {}),
        }
        await add(input)
      }
      onSuccess?.()
      onClose()
    } catch {
      // error surfaces via hook state
    }
  }

  const footerEl = (
    <div className="flex justify-end gap-3">
      <button
        type="button"
        onClick={onClose}
        disabled={loading}
        className="px-4 min-h-[44px] text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
      >
        Cancel
      </button>
      <button
        type="submit"
        form="add-outflow-form"
        disabled={loading}
        className="px-5 min-h-[44px] text-sm font-medium text-white bg-danger rounded-lg hover:bg-red-700 transition-colors disabled:opacity-60 flex items-center gap-2"
      >
        {loading && <ButtonSpinner />}
        {loading ? 'Saving…' : isEdit ? 'Save Changes' : 'Save Outflow'}
      </button>
    </div>
  )

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? 'Edit Outflow Transaction' : 'Add Outflow Transaction'}
      isDirty={isDirty}
      footer={footerEl}
    >
      <form id="add-outflow-form" onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">

        {error && (
          <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
            {/schema cache/i.test(error) ? (
              <div className="space-y-1">
                <p>We couldn't save this right now. Please try again in a moment.</p>
                <TechDetails>{`NOTIFY pgrst, 'reload schema';\n-- If the column is missing, run the full migration in Setup → Database tab.`}</TechDetails>
              </div>
            ) : error}
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

        {/* Recorded Date — editable reporting/upload date */}
        <Field label="Recorded Date" error={errors.recorded_at_date?.message}>
          <input type="date" {...register('recorded_at_date')} className={inputCls(!!errors.recorded_at_date)} />
        </Field>

        {/* Date Added (created_at) — edit mode only, legacy */}
        {isEdit && (
          <Field label="Date Added — legacy (financial reports)" error={errors.created_at_date?.message}>
            <input type="date" {...register('created_at_date')} className={inputCls(!!errors.created_at_date)} />
          </Field>
        )}

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

        {/* Outflow Type + Department — reporting/classification only, do not affect balances */}
        <div className="grid grid-cols-2 gap-4">
          <Field label="Outflow Type (reporting)" error={errors.outflow_type_id?.message}>
            <select {...register('outflow_type_id')} className={inputCls(!!errors.outflow_type_id)}>
              <option value="">— Unclassified —</option>
              {outflowTypeOptions.map(t => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Department / Unit" error={errors.department_id?.message}>
            <select {...register('department_id')} className={inputCls(!!errors.department_id)}>
              <option value="">— None —</option>
              {departmentOptions.map(d => (
                <option key={d.id} value={d.id}>{d.code ? `[${d.code}] ${d.name}` : d.name}</option>
              ))}
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

        {/* FX Details collapsible */}
        <CollapsibleSection label="FX Details (amount & rate)">
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
        </CollapsibleSection>

        {/* Remarks */}
        <Field label="Remarks" error={errors.remarks?.message}>
          <textarea
            rows={2} placeholder="Additional notes…"
            {...register('remarks')}
            className={`${inputCls(!!errors.remarks)} resize-none`}
          />
        </Field>

      </form>
    </Modal>
  )
}

