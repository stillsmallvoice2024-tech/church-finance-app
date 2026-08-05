import { useEffect, useRef } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Modal, type ModalHandle } from '../ui/Modal'
import { focusFirstInvalid } from '../ui/FormField'
import { useAddIntraFlow, useUpdateTransaction, type AddIntraFlowInput } from '../../hooks/useMutations'
import { useCategories } from '../../hooks/useCategories'
import type { IntraFlowRow } from '../../hooks/useTransactions'
import { useOrgCurrency } from '../../hooks/useOrgCurrency'

// ── Zod schema ─────────────────────────────────────────────────────────────────

const schema = z.object({
  date:               z.string().min(1, 'Date is required'),
  account_from:       z.string().min(1, 'From Fund is required'),
  account_from_stage2: z.string().min(1, 'From Fund Type is required'),
  account_to:         z.string().min(1, 'To Fund is required'),
  account_to_stage2:  z.string().min(1, 'To Fund Type is required'),
  total_amount:       z.coerce.number({ invalid_type_error: 'Enter a valid amount' }).positive('Amount must be greater than zero'),
  description:        z.string().min(1, 'Description is required'),
  transaction_ref:    z.string().optional(),
  remark:             z.string().optional(),
})

type FormValues = z.infer<typeof schema>

// ── Component ──────────────────────────────────────────────────────────────────

interface Props {
  open: boolean
  onClose: () => void
  onSuccess?: () => void
  editRecord?: IntraFlowRow | null
}

export function AddIntraFlowModal({ open, onClose, onSuccess, editRecord }: Props) {
  const { baseCurrencySymbol } = useOrgCurrency()
  const { categories } = useCategories()
  const isEdit = !!editRecord

  const addMutation    = useAddIntraFlow()
  const updateMutation = useUpdateTransaction('intra_flows')

  const { mutate: add,    loading: adding,   error: addError,    reset: resetAdd    } = addMutation
  const { mutate: update, loading: updating, error: updateError, reset: resetUpdate } = updateMutation

  const loading = adding || updating
  const error   = addError || updateError
  const modalRef = useRef<ModalHandle>(null)

  const {
    register,
    handleSubmit,
    formState: { errors, isDirty },
    reset: resetForm,
  } = useForm<FormValues>({ resolver: zodResolver(schema) })

  useEffect(() => {
    if (!open) return
    resetAdd()
    resetUpdate()
    if (editRecord) {
      resetForm({
        date:                editRecord.date,
        account_from:        editRecord.account_from        ?? '',
        account_from_stage2: editRecord.account_from_stage2 ?? '',
        account_to:          editRecord.account_to          ?? '',
        account_to_stage2:   editRecord.account_to_stage2   ?? '',
        total_amount:        editRecord.total_amount,
        description:         editRecord.description         ?? '',
        transaction_ref:     editRecord.transaction_ref     ?? '',
        remark:              editRecord.remark              ?? '',
      })
    } else {
      resetForm({ date: new Date().toISOString().slice(0, 10), total_amount: undefined })
    }
  }, [open, editRecord, resetForm, resetAdd, resetUpdate])

  const onSubmit = async (values: FormValues) => {
    try {
      if (isEdit && editRecord) {
        await update({
          id: editRecord.id,
          updates: {
            date:                values.date,
            account_from:        values.account_from,
            account_from_stage2: values.account_from_stage2,
            account_to:          values.account_to,
            account_to_stage2:   values.account_to_stage2,
            total_amount:        values.total_amount,
            description:         values.description      || null,
            transaction_ref:     values.transaction_ref  || null,
            remark:              values.remark           || null,
          },
        })
      } else {
        const input: AddIntraFlowInput = {
          date:                values.date,
          account_from:        values.account_from,
          account_from_stage2: values.account_from_stage2,
          account_to:          values.account_to,
          account_to_stage2:   values.account_to_stage2,
          total_amount:        values.total_amount,
          description:         values.description      || undefined,
          transaction_ref:     values.transaction_ref  || undefined,
          remark:              values.remark           || undefined,
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
      ref={modalRef}
      open={open}
      onClose={onClose}
      title={isEdit ? 'Edit Fund-to-Fund Transfer' : 'Add Fund-to-Fund Transfer'}
      size="max-w-2xl"
      isDirty={isDirty}
      disableClose={loading}
    >
      <form onSubmit={handleSubmit(onSubmit, focusFirstInvalid)} noValidate className="space-y-4">

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
          <Field label={`Amount (${baseCurrencySymbol}) *`} error={errors.total_amount?.message}>
            <input
              type="text" inputMode="decimal" min="0" step="0.01" placeholder="0.00"
              {...register('total_amount')}
              className={inputCls(!!errors.total_amount)}
            />
          </Field>
        </div>

        {/* From */}
        <div className="grid grid-cols-2 gap-4">
          <Field label="From Fund *" error={errors.account_from?.message}>
            <select {...register('account_from')} className={inputCls(!!errors.account_from)}>
              <option value="">— Select —</option>
              {categories.map(c => (
                <option key={c.id} value={c.name}>{c.name}</option>
              ))}
            </select>
          </Field>
          <Field label="From Fund Type *" error={errors.account_from_stage2?.message}>
            <select {...register('account_from_stage2')} className={inputCls(!!errors.account_from_stage2)}>
              <option value="">— Select —</option>
              <option value="Percentage Allocation">Regular Funds</option>
              <option value="Specific Seed">Designated Gift</option>
              <option value="Savings">Savings Funds</option>
            </select>
          </Field>
        </div>

        {/* To */}
        <div className="grid grid-cols-2 gap-4">
          <Field label="To Fund *" error={errors.account_to?.message}>
            <select {...register('account_to')} className={inputCls(!!errors.account_to)}>
              <option value="">— Select —</option>
              {categories.map(c => (
                <option key={c.id} value={c.name}>{c.name}</option>
              ))}
            </select>
          </Field>
          <Field label="To Fund Type *" error={errors.account_to_stage2?.message}>
            <select {...register('account_to_stage2')} className={inputCls(!!errors.account_to_stage2)}>
              <option value="">— Select —</option>
              <option value="Percentage Allocation">Regular Funds</option>
              <option value="Specific Seed">Designated Gift</option>
              <option value="Savings">Savings Funds</option>
            </select>
          </Field>
        </div>

        {/* Description + Transaction Ref */}
        <div className="grid grid-cols-2 gap-4">
          <Field label="Description *" error={errors.description?.message}>
            <input
              type="text" placeholder="Transfer description"
              {...register('description')}
              className={inputCls(!!errors.description)}
            />
          </Field>
          <Field label="Transaction Ref" error={errors.transaction_ref?.message}>
            <input
              type="text" placeholder="Ref / ID"
              {...register('transaction_ref')}
              className={inputCls(!!errors.transaction_ref)}
            />
          </Field>
        </div>

        {/* Remark */}
        <Field label="Remark" error={errors.remark?.message}>
          <textarea
            rows={2} placeholder="Additional notes…"
            {...register('remark')}
            className={`${inputCls(!!errors.remark)} resize-none`}
          />
        </Field>

        {/* Actions */}
        <div className="flex justify-end gap-3 pt-2">
          <button
            type="button" onClick={() => modalRef.current?.requestClose()} disabled={loading}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit" disabled={loading}
            className="px-5 py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary-light transition-colors disabled:opacity-60 flex items-center gap-2"
          >
            {loading && <Spinner />}
            {loading ? 'Saving…' : isEdit ? 'Save Changes' : 'Save Transfer'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function inputCls(hasError: boolean) {
  return `w-full px-3 py-2 min-h-[44px] text-base sm:text-sm border rounded-lg outline-none transition-colors focus:ring-2 focus:ring-primary/30 bg-white ${
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
