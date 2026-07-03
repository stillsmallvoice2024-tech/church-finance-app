import { useState, useEffect, useRef } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { AlertTriangle } from 'lucide-react'
import type { ModalHandle } from '../ui/Modal'
import { Modal } from '../ui/Modal'
import { Field, inputCls } from '../ui/FormField'
import { ButtonSpinner } from '../ui/ButtonSpinner'
import { LIABILITY_TYPES, saveLiability, type Liability } from '../../hooks/useLiabilities'

// ── Schema ─────────────────────────────────────────────────────────────────────

const schema = z.object({
  name:                z.string().min(1, 'Name is required'),
  liability_type:      z.string().min(1, 'Type is required'),
  lender:              z.string().optional().transform(v => v || null),
  principal_amount:    z.coerce.number().min(0, 'Amount must be ≥ 0'),
  outstanding_balance: z.coerce.number().min(0, 'Balance must be ≥ 0'),
  interest_rate:       z.coerce.number().min(0).max(100).nullish().transform(v => v || null),
  repayment_notes:     z.string().optional().transform(v => v || null),
  due_date:            z.string().optional().transform(v => v || null),
  notes:               z.string().optional().transform(v => v || null),
})

type FormValues = z.infer<typeof schema>

// ── Props ──────────────────────────────────────────────────────────────────────

interface Props {
  open:        boolean
  onClose:     () => void
  onSaved:     () => void
  editRecord?: Liability | null
}

// ── Component ──────────────────────────────────────────────────────────────────

export function AddLiabilityModal({ open, onClose, onSaved, editRecord }: Props) {
  const isEdit = !!editRecord
  const modalRef = useRef<ModalHandle>(null)
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState<string | null>(null)

  const { register, handleSubmit, reset, formState: { errors, isDirty } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: '', liability_type: 'Loan', lender: '',
      principal_amount: 0, outstanding_balance: 0,
      interest_rate: null, repayment_notes: '', due_date: '', notes: '',
    },
  })

  useEffect(() => {
    if (!open) return
    setError(null)
    if (editRecord) {
      reset({
        name:                editRecord.name,
        liability_type:      editRecord.liability_type,
        lender:              editRecord.lender ?? '',
        principal_amount:    editRecord.principal_amount,
        outstanding_balance: editRecord.outstanding_balance,
        interest_rate:       editRecord.interest_rate ?? null,
        repayment_notes:     editRecord.repayment_notes ?? '',
        due_date:            editRecord.due_date ?? '',
        notes:               editRecord.notes ?? '',
      })
    } else {
      reset({
        name: '', liability_type: 'Loan', lender: '',
        principal_amount: 0, outstanding_balance: 0,
        interest_rate: null, repayment_notes: '', due_date: '', notes: '',
      })
    }
  }, [open, editRecord, reset])

  const onSubmit = async (values: FormValues) => {
    setSaving(true); setError(null)
    try {
      await saveLiability(
        {
          name:                values.name,
          liability_type:      values.liability_type,
          lender:              values.lender ?? null,
          principal_amount:    values.principal_amount,
          outstanding_balance: values.outstanding_balance,
          interest_rate:       values.interest_rate ?? null,
          repayment_notes:     values.repayment_notes ?? null,
          due_date:            values.due_date ?? null,
          notes:               values.notes ?? null,
        },
        editRecord?.id,
      )
      onSaved()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const footerEl = (
    <div className="flex justify-end gap-3">
      <button
        type="button"
        onClick={() => modalRef.current?.requestClose()}
        disabled={saving}
        className="px-4 min-h-[44px] text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
      >
        Cancel
      </button>
      <button
        type="submit"
        form="add-liability-form"
        disabled={saving}
        className="flex items-center gap-2 px-5 min-h-[44px] text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary-light disabled:opacity-60 transition-colors"
      >
        {saving && <ButtonSpinner />}
        {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Add Liability'}
      </button>
    </div>
  )

  return (
    <Modal
      ref={modalRef}
      open={open}
      onClose={onClose}
      title={isEdit ? 'Edit Liability' : 'Add Liability'}
      size="max-w-lg"
      isDirty={isDirty}
      disableClose={saving}
      footer={footerEl}
    >
      <form id="add-liability-form" onSubmit={handleSubmit(onSubmit)} className="space-y-4">

        {error && (
          <div className="flex items-start gap-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <Field label="Name *" error={errors.name?.message}>
              <input
                {...register('name')}
                placeholder="e.g. Church Building Loan"
                className={inputCls(!!errors.name)}
              />
            </Field>
          </div>

          <Field label="Type *" error={errors.liability_type?.message}>
            <select {...register('liability_type')} className={`${inputCls(!!errors.liability_type)} bg-white`}>
              {LIABILITY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>

          <Field label="Lender / Creditor">
            <input
              {...register('lender')}
              placeholder="e.g. First Bank"
              className={inputCls(false)}
            />
          </Field>

          <Field label="Principal Amount *" error={errors.principal_amount?.message}>
            <input type="number" step="0.01" min="0" {...register('principal_amount')} className={inputCls(!!errors.principal_amount)} />
          </Field>

          <Field label="Outstanding Balance *" error={errors.outstanding_balance?.message}>
            <input type="number" step="0.01" min="0" {...register('outstanding_balance')} className={inputCls(!!errors.outstanding_balance)} />
          </Field>

          <Field label="Interest Rate (% p.a.)" error={errors.interest_rate?.message}>
            <input
              type="number" step="0.01" min="0" max="100"
              placeholder="e.g. 12.5"
              {...register('interest_rate')}
              className={inputCls(!!errors.interest_rate)}
            />
          </Field>

          <Field label="Due Date">
            <input type="date" {...register('due_date')} className={inputCls(false)} />
          </Field>
        </div>

        <Field label="Repayment Schedule">
          <input
            {...register('repayment_notes')}
            placeholder="e.g. ₦50,000/month over 24 months"
            className={inputCls(false)}
          />
        </Field>

        <Field label="Notes">
          <textarea
            {...register('notes')}
            rows={2}
            placeholder="Optional notes"
            className={inputCls(false)}
          />
        </Field>

      </form>
    </Modal>
  )
}
