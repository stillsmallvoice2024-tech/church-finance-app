import { useEffect, useState, useCallback } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Modal } from '../ui/Modal'
import { useAddInflow, useUpdateTransaction, type AddInflowInput } from '../../hooks/useMutations'
import { useCategories } from '../../hooks/useCategories'
import {
  INFLOW_TYPES, INFLOW_TYPE_LABELS, autoAssignInflowType, type InflowType,
} from '../../utils/inflowTypes'
import type { InflowTransaction } from '../../hooks/useTransactions'

// ── Zod schema ─────────────────────────────────────────────────────────────────

const FX_CURRENCIES = ['USD', 'GBP', 'EUR', 'CNY', 'AED', 'CAD', 'CHF', 'ZAR']

const TXN_TYPES = [
  { value: '',                   label: 'Normal' },
  { value: 'refund',             label: 'Refund' },
  { value: 'reversal',           label: 'Reversal' },
  { value: 'bank_deposit',       label: 'Bank Deposit' },
  { value: 'intrabank_transfer', label: 'Intrabank Transfer' },
]

const schema = z.object({
  date:                       z.string().min(1, 'Date is required'),
  amount:                     z.coerce.number({ invalid_type_error: 'Enter a valid amount' }).positive('Amount must be greater than zero'),
  inflow_type:                z.string().optional(),
  description:                z.string().optional(),
  stage_code_1:               z.string().optional(),
  stage_code_2:               z.string().optional(),
  transaction_ref:            z.string().optional(),
  specific_seed_description:  z.string().optional(),
  remark:                     z.string().optional(),
  fx_currency:                z.string().optional(),
  transaction_type:           z.string().optional(),
  original_transaction_id:    z.string().optional(),
})

type FormValues = z.infer<typeof schema>

// ── Component ──────────────────────────────────────────────────────────────────

interface Props {
  open: boolean
  onClose: () => void
  onSuccess?: () => void
  editRecord?: InflowTransaction | null
}

export function AddInflowModal({ open, onClose, onSuccess, editRecord }: Props) {
  const isEdit = !!editRecord
  const { categories } = useCategories()

  const addMutation    = useAddInflow()
  const updateMutation = useUpdateTransaction('inflow_transactions')

  const { mutate: add,    loading: adding,   error: addError,    reset: resetAdd    } = addMutation
  const { mutate: update, loading: updating, error: updateError, reset: resetUpdate } = updateMutation

  const loading = adding || updating
  const error   = addError || updateError

  // Track inflow_type separately so we can auto-update when description changes
  const [inflowType, setInflowType] = useState<InflowType>('general_giving')

  const {
    register,
    handleSubmit,
    formState: { errors },
    reset: resetForm,
    watch,
    setValue,
  } = useForm<FormValues>({ resolver: zodResolver(schema) })

  const description    = watch('description')
  const transactionType = watch('transaction_type')

  // Auto-assign type when description changes (only if user hasn't manually changed it)
  const [typeManuallySet, setTypeManuallySet] = useState(false)
  useEffect(() => {
    if (!typeManuallySet && description) {
      setInflowType(autoAssignInflowType(description))
    }
  }, [description, typeManuallySet])

  const handleTypeChange = useCallback((t: InflowType) => {
    setInflowType(t)
    setTypeManuallySet(true)
    setValue('inflow_type', t)
  }, [setValue])

  // Populate / clear form when modal opens
  useEffect(() => {
    if (!open) return
    resetAdd()
    resetUpdate()
    setTypeManuallySet(false)
    if (editRecord) {
      setInflowType(editRecord.inflow_type ?? 'general_giving')
      setTypeManuallySet(true)
      resetForm({
        date:                       editRecord.date,
        amount:                     editRecord.amount,
        inflow_type:                editRecord.inflow_type ?? 'general_giving',
        description:                editRecord.description ?? '',
        stage_code_1:               editRecord.stage_code_1 ?? '',
        stage_code_2:               editRecord.stage_code_2 ?? '',
        transaction_ref:            editRecord.transaction_ref ?? '',
        specific_seed_description:  editRecord.specific_seed_description ?? '',
        remark:                     editRecord.remark ?? '',
        fx_currency:                editRecord.fx_currency ?? '',
        transaction_type:           editRecord.transaction_type ?? '',
        original_transaction_id:    editRecord.original_transaction_id ?? '',
      })
    } else {
      setInflowType('general_giving')
      resetForm({ date: new Date().toISOString().slice(0, 10), amount: undefined })
    }
  }, [open, editRecord, resetForm, resetAdd, resetUpdate])

  const onSubmit = async (values: FormValues) => {
    try {
      const type = inflowType
      if (isEdit && editRecord) {
        await update({
          id: editRecord.id,
          updates: {
            date:                       values.date,
            amount:                     values.amount,
            inflow_type:                type,
            description:                values.description  || null,
            stage_code_1:               values.stage_code_1 || null,
            stage_code_2:               values.stage_code_2 || null,
            transaction_ref:            values.transaction_ref           || null,
            specific_seed_description:  values.specific_seed_description || null,
            remark:                     values.remark || null,
            fx_currency:                values.fx_currency             || null,
            transaction_type:           values.transaction_type        || null,
            original_transaction_id:    values.original_transaction_id || null,
          },
        })
      } else {
        const input: AddInflowInput = {
          date:                       values.date,
          amount:                     values.amount,
          inflow_type:                type,
          description:                values.description  || undefined,
          stage_code_1:               values.stage_code_1 || undefined,
          stage_code_2:               values.stage_code_2 || undefined,
          transaction_ref:            values.transaction_ref           || undefined,
          specific_seed_description:  values.specific_seed_description || undefined,
          remark:                     values.remark || undefined,
          fx_currency:                values.fx_currency             || undefined,
          transaction_type:           values.transaction_type        || undefined,
          original_transaction_id:    values.original_transaction_id || undefined,
        }
        await add(input)
      }
      onSuccess?.()
      onClose()
    } catch {
      // error surfaces via hook state
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? 'Edit Inflow Transaction' : 'Add Inflow Transaction'}
    >
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
          <Field label="Amount (₦) *" error={errors.amount?.message}>
            <input type="number" min="0" step="0.01" placeholder="0.00" {...register('amount')} className={inputCls(!!errors.amount)} />
          </Field>
        </div>

        {/* Description — auto-assigns type on change */}
        <Field label="Description" error={errors.description?.message}>
          <input type="text" placeholder="e.g. Sunday offering" {...register('description')} className={inputCls(!!errors.description)} />
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

        {/* Inflow Type — shown with auto-assigned label, fully editable */}
        <Field label="Inflow Type">
          <div className="grid grid-cols-3 gap-1.5">
            {INFLOW_TYPES.map(t => (
              <button
                key={t} type="button"
                onClick={() => handleTypeChange(t)}
                className={`px-2 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                  inflowType === t
                    ? 'bg-primary text-white border-primary'
                    : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                }`}
              >
                {INFLOW_TYPE_LABELS[t]}
              </button>
            ))}
          </div>
          {!typeManuallySet && description && (
            <p className="text-[10px] text-gray-400 mt-1">Auto-assigned from description · click to change</p>
          )}
        </Field>

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

        {/* Transaction Ref */}
        <Field label="Transaction Ref" error={errors.transaction_ref?.message}>
          <input type="text" placeholder="Ref / cheque no." {...register('transaction_ref')} className={inputCls(!!errors.transaction_ref)} />
        </Field>

        {/* Specific Seed Description */}
        <Field label="Specific Seed Description" error={errors.specific_seed_description?.message}>
          <input type="text" placeholder="Specific seed description (if any)" {...register('specific_seed_description')} className={inputCls(!!errors.specific_seed_description)} />
        </Field>

        {/* FX Currency (optional) */}
        <Field label="FX Currency (if applicable)" error={errors.fx_currency?.message}>
          <select {...register('fx_currency')} className={inputCls(!!errors.fx_currency)}>
            <option value="">— None —</option>
            {FX_CURRENCIES.map(c => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </Field>

        {/* Remark */}
        <Field label="Remark" error={errors.remark?.message}>
          <textarea rows={2} placeholder="Additional notes…" {...register('remark')} className={`${inputCls(!!errors.remark)} resize-none`} />
        </Field>

        {/* Actions */}
        <div className="flex justify-end gap-3 pt-2">
          <button type="button" onClick={onClose} disabled={loading} className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50">
            Cancel
          </button>
          <button type="submit" disabled={loading} className="px-5 py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary-light transition-colors disabled:opacity-60 flex items-center gap-2">
            {loading && <Spinner />}
            {loading ? 'Saving…' : isEdit ? 'Save Changes' : 'Save Inflow'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

function inputCls(hasError: boolean) {
  return `w-full px-3 py-2 text-sm border rounded-lg outline-none transition-colors focus:ring-2 focus:ring-primary/30 bg-white ${
    hasError ? 'border-red-400 focus:border-red-400' : 'border-gray-300 focus:border-primary'
  }`
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

function Spinner() {
  return <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
}
