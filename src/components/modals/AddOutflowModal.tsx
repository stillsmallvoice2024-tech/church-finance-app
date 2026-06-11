import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useForm, useWatch, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { ExternalLink } from 'lucide-react'
import { Link } from 'react-router-dom'
import { generateFallbackTransactionId } from '../../utils/generateTransactionId'
import { Modal, type ModalHandle } from '../ui/Modal'
import { TechDetails } from '../ui/TechDetails'
import { Field, inputCls } from '../ui/FormField'
import { ButtonSpinner } from '../ui/ButtonSpinner'
import { useAddOutflow, useUpdateTransaction, type AddOutflowInput } from '../../hooks/useMutations'
import { useCategories } from '../../hooks/useCategories'
import { useBanks } from '../../hooks/useBanks'
import { useOutflowTypeOptions, useCategoryOutflowTypeMaps, getDefaultOutflowTypeForCategory } from '../../hooks/useOutflowTypes'
import { useDepartmentOptions } from '../../hooks/useDepartments'
import type { OutflowTransaction } from '../../hooks/useTransactions'
import { CurrencyInput } from '../ui/CurrencyInput'
import { useOrgCurrency } from '../../hooks/useOrgCurrency'
import { SearchableSelect } from '../ui/SearchableSelect'
import { RootTransactionSearch, type RootTxnLink } from '../ui/RootTransactionSearch'
import { isOffsetableType } from '../../utils/transactionTypes'

const TXN_TYPES = [
  { value: '',                   label: 'Normal' },
  { value: 'refund',             label: 'Refund' },
  { value: 'reversal',           label: 'Reversal' },
  { value: 'bank_deposit',       label: 'Bank Deposit' },
  { value: 'intrabank_transfer', label: 'Intrabank Transfer' },
]

// ── Zod schema ─────────────────────────────────────────────────────────────────────────────

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
  transaction_type:        z.string().optional(),
  original_transaction_id: z.string().optional(),
  offset_role:             z.string().optional(),
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
  const { baseCurrencySymbol } = useOrgCurrency()
  const { categories }    = useCategories()
  const { banks }         = useBanks()
  const fxBanks    = banks.filter(b => b.is_foreign_currency)
  const nonFxBanks = banks.filter(b => !b.is_foreign_currency)
  const { options: outflowTypeOptions } = useOutflowTypeOptions()
  const { maps: categoryOutflowMaps }  = useCategoryOutflowTypeMaps()
  const { options: departmentOptions } = useDepartmentOptions()
  const isEdit = !!editRecord
  const [isPending,    setIsPending]    = useState(false)
  const [dupError,     setDupError]     = useState<string | null>(null)
  const [rootTxnLink,  setRootTxnLink]  = useState<RootTxnLink | null>(null)

  const addMutation    = useAddOutflow()
  const updateMutation = useUpdateTransaction('outflow_transactions')

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
    setValue,
    watch,
    control,
  } = useForm<FormValues>({ resolver: zodResolver(schema) })

  const transactionType = useWatch({ control, name: 'transaction_type' })
  const stage1Watch     = useWatch({ control, name: 'stage_code_1' })
  const offsetRole      = watch('offset_role') ?? ''
  const watchedBankName = watch('bank_name')

  const selectedBank = useMemo(
    () => banks.find(b => b.name === watchedBankName) ?? null,
    [banks, watchedBankName],
  )
  const filteredCategories = useMemo(() => {
    if (!selectedBank) return categories
    if (selectedBank.is_foreign_currency) return categories.filter(c => c.currency === selectedBank.currency)
    return categories.filter(c => !c.currency)
  }, [categories, selectedBank])

  const isOffsetType = isOffsetableType(transactionType)

  useEffect(() => {
    if (!open) return
    resetAdd()
    resetUpdate()
    setDupError(null)
    setRootTxnLink(null)
    if (editRecord) {
      setIsPending(editRecord.is_pending_deduction ?? false)
      if (editRecord.root_transaction_id && editRecord.root_transaction_table) {
        setRootTxnLink({
          id:    editRecord.root_transaction_id,
          table: editRecord.root_transaction_table as 'inflow_transactions' | 'outflow_transactions',
          label: `Linked · ID: ${editRecord.root_transaction_id.slice(0, 8)}… (search to update)`,
        })
      }
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
        transaction_type:        editRecord.transaction_type        ?? '',
        original_transaction_id: editRecord.original_transaction_id ?? '',
        offset_role:             editRecord.offset_role             ?? '',
      })
    } else {
      setIsPending(false)
      resetForm({ date: new Date().toISOString().slice(0, 10), recorded_at_date: new Date().toISOString().slice(0, 10), amount_disbursed: undefined })
    }
  }, [open, editRecord, resetForm, resetAdd, resetUpdate])

  // Clear stage_code_1 when bank changes and the current value is not in the filtered list
  const stage1Value = useWatch({ control, name: 'stage_code_1' })
  useEffect(() => {
    if (!stage1Value) return
    if (!filteredCategories.some(c => c.name === stage1Value)) setValue('stage_code_1', '')
  }, [filteredCategories, stage1Value, setValue])

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
    setDupError(null)
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
            fx_currency:             editRecord.fx_currency         ?? null,
            fx_amount:               editRecord.fx_amount           ?? null,
            fx_rate:                 editRecord.fx_rate             ?? null,
            transaction_type:        values.transaction_type        || null,
            original_transaction_id: values.original_transaction_id || null,
            offset_role:             isOffsetableType(values.transaction_type) ? (values.offset_role as 'root' | 'offset' | null || null) : null,
            root_transaction_id:     isOffsetableType(values.transaction_type) && values.offset_role === 'offset' && rootTxnLink ? rootTxnLink.id    : null,
            root_transaction_table:  isOffsetableType(values.transaction_type) && values.offset_role === 'offset' && rootTxnLink ? rootTxnLink.table : null,
            offset_link_type:        isOffsetableType(values.transaction_type) && values.offset_role === 'offset' && rootTxnLink ? (values.transaction_type || null) : null,
            ...(values.created_at_date ? { created_at: `${values.created_at_date}T00:00:00.000Z` } : {}),
            ...(values.recorded_at_date ? { recorded_at: `${values.recorded_at_date}T00:00:00.000Z` } : {}),
          },
        })
      } else {
        const txnId = values.transaction_id?.trim()
          || await generateFallbackTransactionId(values.date, String(values.amount_disbursed), values.description ?? values.bank_description ?? '', values.bank_name ?? '')
        let dupQ = supabase.from('outflow_transactions').select('id').eq('transaction_id', txnId)
        if (values.bank_name) dupQ = dupQ.eq('bank_name', values.bank_name)
        const { data: dup } = await dupQ.limit(1)
        if (dup && dup.length > 0) {
          setDupError('Duplicate: an outflow with this transaction ID already exists for the selected bank.')
          return
        }
        const input: AddOutflowInput = {
          date:                    values.date,
          amount_disbursed:        values.amount_disbursed,
          is_pending_deduction:    isPending,
          bank_name:               values.bank_name               || undefined,
          description:             values.description             || undefined,
          bank_description:        values.bank_description        || undefined,
          transaction_id:          txnId,
          stage_code_1:            values.stage_code_1            || undefined,
          stage_code_2:            values.stage_code_2            || undefined,
          outflow_type_id:         values.outflow_type_id         || null,
          department_id:           values.department_id           || null,
          remarks:                 values.remarks                 || undefined,
          transaction_type:        values.transaction_type        || undefined,
          original_transaction_id: values.original_transaction_id || undefined,
          ...(isOffsetableType(values.transaction_type) && values.offset_role
            ? { offset_role: values.offset_role as 'root' | 'offset' }
            : {}),
          ...(isOffsetableType(values.transaction_type) && values.offset_role === 'offset' && rootTxnLink
            ? {
                root_transaction_id:    rootTxnLink.id,
                root_transaction_table: rootTxnLink.table,
                offset_link_type:       values.transaction_type || undefined,
              }
            : {}),
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
        onClick={() => modalRef.current?.requestClose()}
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
      ref={modalRef}
      open={open}
      onClose={onClose}
      title={isEdit ? 'Edit Outflow Transaction' : 'Add Outflow Transaction'}
      isDirty={isDirty}
      disableClose={loading}
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

        {dupError && (
          <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-700">
            {dupError}
          </div>
        )}

        {/* Date + Amount */}
        <div className="grid grid-cols-2 gap-4">
          <Field label="Date *" error={errors.date?.message}>
            <input type="date" {...register('date')} className={inputCls(!!errors.date)} />
          </Field>
          <Field label={`Amount Disbursed (${baseCurrencySymbol}) *`} error={errors.amount_disbursed?.message}>
            <Controller control={control} name="amount_disbursed" render={({ field }) => (
              <CurrencyInput value={field.value} onChange={field.onChange} placeholder="0.00" className={inputCls(!!errors.amount_disbursed)} />
            )} />
          </Field>
        </div>

        {/* Recorded Date — editable reporting/upload date */}
        <Field label="Recorded Date" error={errors.recorded_at_date?.message}
          help="The date this transaction was logged in the system, which may differ from the bank transaction date. Financial reports use the bank date; audit logs use the recorded date.">
          <input type="date" {...register('recorded_at_date')} className={inputCls(!!errors.recorded_at_date)} />
        </Field>

        {/* Date Added (created_at) — edit mode only, legacy */}
        {isEdit && (
          <Field label="Date Added — legacy (financial reports)" error={errors.created_at_date?.message}>
            <input type="date" {...register('created_at_date')} className={inputCls(!!errors.created_at_date)} />
          </Field>
        )}

        {/* Bank Account — FX banks excluded in add mode; FX transactions go through the FX module */}
        <Field label="Bank Account" error={errors.bank_name?.message}>
          <Controller name="bank_name" control={control} render={({ field }) => {
            const selectedIsFx = fxBanks.some(b => b.name === field.value)
            const bankOptions  = isEdit
              ? banks.map(b => ({ value: b.name, label: b.name }))
              : nonFxBanks.map(b => ({ value: b.name, label: b.name }))
            return (
              <>
                <SearchableSelect value={field.value ?? ''} onChange={field.onChange}
                  options={bankOptions}
                  placeholder="— Select bank (optional) —" className={inputCls(!!errors.bank_name)} />
                {(selectedIsFx || (!isEdit && fxBanks.length > 0)) && (
                  <p className="flex items-center gap-1 text-[11px] text-amber-600 mt-0.5">
                    <ExternalLink className="w-3 h-3 shrink-0" />
                    Foreign currency transactions are managed in the{' '}
                    <Link to="/foreign-currency" className="underline hover:text-amber-700" onClick={onClose}>
                      FX module
                    </Link>.
                  </p>
                )}
              </>
            )
          }} />
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
        <Field label="Transaction Type" error={errors.transaction_type?.message}
          help="Normal is a regular outflow. Refund/Reversal corrects a prior entry. Bank Deposit and Intrabank Transfer are system types for inter-account movements.">
          <select {...register('transaction_type')} className={inputCls(!!errors.transaction_type)}>
            {TXN_TYPES.map(t => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </Field>

        {/* Offset Role — visible only for offsetting transaction types */}
        {isOffsetType && (
          <Field label="Offset Role"
            help="Root = this is the original transaction. Offset = this transaction cancels or adjusts a root transaction.">
            <select {...register('offset_role')} className={inputCls(false)}>
              <option value="">— Not set —</option>
              <option value="root">Root (original transaction)</option>
              <option value="offset">Offset (linked to root)</option>
            </select>
          </Field>
        )}

        {/* Root / Original Transaction — single combined field for offset rows */}
        {isOffsetType && offsetRole === 'offset' && (
          <Field label="Root / Original Transaction"
            help="Search for the original transaction this offsets. The transaction ref is automatically saved as the Original Transaction ID. Scoped to the same bank by default. You can link this later via Edit if the root is unknown now.">
            <RootTransactionSearch
              value={rootTxnLink}
              onChange={v => {
                setRootTxnLink(v)
                if (v?.txnRef) setValue('original_transaction_id', v.txnRef)
              }}
              bankName={watchedBankName}
              excludeId={editRecord?.id}
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
          <Field label="Stage Code 1" error={errors.stage_code_1?.message}
            help="The fund or category this outflow is charged against. Used to match outflows to the correct budget line and allocation portion.">
            <Controller name="stage_code_1" control={control} render={({ field }) => (
              <SearchableSelect value={field.value ?? ''} onChange={field.onChange}
                options={filteredCategories.map(c => ({ value: c.name, label: c.name }))}
                placeholder="— Select —" className={inputCls(!!errors.stage_code_1)} />
            )} />
          </Field>
          <Field label="Stage Code 2 (Portion Type)" error={errors.stage_code_2?.message}
            help="The allocation portion this outflow is drawn from: Percentage Allocation, Specific Seed, or Savings.">
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
          <Field label="Outflow Type (reporting)" error={errors.outflow_type_id?.message}
            help="Classifies the nature of this expenditure for financial reports (e.g. Salaries, Utilities, Events). Does not affect balances — for reporting only.">
            <Controller name="outflow_type_id" control={control} render={({ field }) => (
              <SearchableSelect value={field.value ?? ''} onChange={field.onChange}
                options={outflowTypeOptions.map(t => ({ value: t.id, label: t.name }))}
                placeholder="— Unclassified —" className={inputCls(!!errors.outflow_type_id)} />
            )} />
          </Field>
          <Field label="Department / Unit" error={errors.department_id?.message}>
            <Controller name="department_id" control={control} render={({ field }) => (
              <SearchableSelect value={field.value ?? ''} onChange={field.onChange}
                options={departmentOptions.map(d => ({ value: d.id, label: d.code ? `[${d.code}] ${d.name}` : d.name }))}
                placeholder="— None —" className={inputCls(!!errors.department_id)} />
            )} />
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

