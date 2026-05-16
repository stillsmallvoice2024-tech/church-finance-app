import { useEffect, useState, useCallback } from 'react'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { ChevronDown, ChevronRight, Sparkles } from 'lucide-react'
import { Modal } from '../ui/Modal'
import { useAddInflow, useUpdateTransaction, type AddInflowInput } from '../../hooks/useMutations'
import { useCategories } from '../../hooks/useCategories'
import { useBanks } from '../../hooks/useBanks'
import { useAllocationStore, getConfigForDate, getSpecialConfigVersionForDate } from '../../store/allocationStore'
import { useIncomeTypes, type IncomeType } from '../../hooks/useIncomeTypes'
import { classifyIncomeType } from '../../utils/classifyIncomeType'
import type { InflowTransaction } from '../../hooks/useTransactions'
import { CurrencyInput } from '../ui/CurrencyInput'

// ── Zod schema ─────────────────────────────────────────────────────────────────────────────

const FX_CURRENCIES = ['USD', 'GBP', 'EUR', 'CNY', 'AED', 'CAD', 'CHF', 'ZAR']

const optNum = z.union([
  z.coerce.number().min(0),
  z.literal('').transform(() => undefined),
]).optional()

const TXN_TYPES = [
  { value: '',                   label: 'Normal' },
  { value: 'refund',             label: 'Refund' },
  { value: 'reversal',           label: 'Reversal' },
  { value: 'bank_deposit',       label: 'Bank Deposit' },
  { value: 'intrabank_transfer', label: 'Intrabank Transfer' },
]

const schema = z.object({
  date:                       z.string().min(1, 'Date is required'),
  created_at_date:            z.string().optional(),
  recorded_at_date:           z.string().optional(),
  amount:                     z.coerce.number({ invalid_type_error: 'Enter a valid amount' }).positive('Amount must be greater than zero'),
  description:                z.string().optional(),
  bank_name:                  z.string().optional(),
  stage_code_1:               z.string().optional(),
  stage_code_2:               z.string().optional(),
  transaction_ref:            z.string().optional(),
  specific_seed_description:  z.string().optional(),
  remark:                     z.string().optional(),
  fx_currency:                z.string().optional(),
  fx_amount:                  optNum,
  fx_rate:                    optNum,
  transaction_type:           z.string().optional(),
  original_transaction_id:    z.string().optional(),
})

type FormValues = z.infer<typeof schema>

// ── Component ──────────────────────────────────────────────────────────────────────────────

interface Props {
  open: boolean
  onClose: () => void
  onSuccess?: () => void
  editRecord?: InflowTransaction | null
}

export function AddInflowModal({ open, onClose, onSuccess, editRecord }: Props) {
  const isEdit = !!editRecord
  const { categories } = useCategories()
  const { banks } = useBanks()
  const { configs: allocConfigs, fetch: fetchAllocConfigs } = useAllocationStore()
  useEffect(() => { fetchAllocConfigs() }, [fetchAllocConfigs])
  const lockedConfigs = allocConfigs.filter(c => c.status === 'locked')

  const { incomeTypes } = useIncomeTypes()

  const addMutation    = useAddInflow()
  const updateMutation = useUpdateTransaction('inflow_transactions')

  const { mutate: add,    loading: adding,   error: addError,    reset: resetAdd    } = addMutation
  const { mutate: update, loading: updating, error: updateError, reset: resetUpdate } = updateMutation

  const loading = adding || updating
  const error   = addError || updateError

  const [selectedConfigId,  setSelectedConfigId]  = useState('')
  const [configManuallySet, setConfigManuallySet] = useState(false)
  const [fxOpen,            setFxOpen]            = useState(false)

  // Custom income type (user-defined, separate from the legacy inflowType)
  const [incomeTypeId,        setIncomeTypeId]        = useState<string>('')
  const [incomeTypeAutoSet,   setIncomeTypeAutoSet]   = useState(false)

  const selectedIncomeType: IncomeType | null =
    incomeTypes.find(t => t.id === incomeTypeId) ?? null

  const {
    register,
    control,
    handleSubmit,
    formState: { errors },
    reset: resetForm,
    watch,
    setValue,
  } = useForm<FormValues>({ resolver: zodResolver(schema) })

  const description     = watch('description')
  const stageCode1      = watch('stage_code_1')
  const transactionType = watch('transaction_type')
  const watchedDate     = watch('date')

  // Auto-classify income type from description + stage code
  useEffect(() => {
    if (incomeTypeId && !incomeTypeAutoSet) return   // manually set — leave it
    if (!incomeTypes.length) return
    const match = classifyIncomeType(description ?? '', stageCode1 ?? '', incomeTypes)
    if (match) {
      setIncomeTypeId(match.id)
      setIncomeTypeAutoSet(true)
    } else if (incomeTypeAutoSet) {
      // previous auto-match no longer fires — clear it
      setIncomeTypeId('')
      setIncomeTypeAutoSet(false)
    }
  }, [description, stageCode1, incomeTypes]) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-apply special config when income type changes (unless config was manually picked)
  useEffect(() => {
    if (configManuallySet) return
    if (selectedIncomeType?.special_config_group_id && watchedDate) {
      const version = getSpecialConfigVersionForDate(allocConfigs, selectedIncomeType.special_config_group_id, watchedDate)
      setSelectedConfigId(version?.id ?? '')
    } else if (selectedIncomeType?.special_config_id) {
      setSelectedConfigId(selectedIncomeType.special_config_id)
    } else if (!incomeTypeId) {
      if (watchedDate) {
        const cfg = getConfigForDate(lockedConfigs, watchedDate)
        setSelectedConfigId(cfg?.id ?? '')
      }
    }
  }, [incomeTypeId, selectedIncomeType, watchedDate, allocConfigs]) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-select allocation config by date (unless manually overridden or income-type config applied)
  useEffect(() => {
    if (configManuallySet || !watchedDate) return
    if (selectedIncomeType?.special_config_group_id) {
      const version = getSpecialConfigVersionForDate(allocConfigs, selectedIncomeType.special_config_group_id, watchedDate)
      setSelectedConfigId(version?.id ?? '')
      return
    }
    if (selectedIncomeType?.special_config_id) return
    const cfg = getConfigForDate(lockedConfigs, watchedDate)
    setSelectedConfigId(cfg?.id ?? '')
  }, [watchedDate, lockedConfigs, configManuallySet, allocConfigs, selectedIncomeType]) // eslint-disable-line react-hooks/exhaustive-deps

  // Populate / clear form when modal opens
  useEffect(() => {
    if (!open) return
    resetAdd()
    resetUpdate()
    setConfigManuallySet(false)
    setIncomeTypeAutoSet(false)
    setFxOpen(false)
    if (editRecord) {
      setSelectedConfigId((editRecord as Record<string, unknown>).allocation_config_id as string ?? '')
      setConfigManuallySet(true)
      setIncomeTypeId(editRecord.income_type_id ?? '')
      resetForm({
        date:                       editRecord.date,
        created_at_date:            editRecord.created_at ? editRecord.created_at.slice(0, 10) : '',
        recorded_at_date:           (editRecord as Record<string, unknown>).recorded_at
          ? ((editRecord as Record<string, unknown>).recorded_at as string).slice(0, 10)
          : '',
        amount:                     editRecord.amount,
        description:                editRecord.description ?? '',
        bank_name:                  editRecord.bank_name ?? '',
        stage_code_1:               editRecord.stage_code_1 ?? '',
        stage_code_2:               editRecord.stage_code_2 ?? '',
        transaction_ref:            editRecord.transaction_ref ?? '',
        specific_seed_description:  editRecord.specific_seed_description ?? '',
        remark:                     editRecord.remark ?? '',
        fx_currency:                editRecord.fx_currency ?? '',
        fx_amount:                  (editRecord as Record<string, unknown>).fx_amount as number ?? '',
        fx_rate:                    (editRecord as Record<string, unknown>).fx_rate   as number ?? '',
        transaction_type:           editRecord.transaction_type ?? '',
        original_transaction_id:    editRecord.original_transaction_id ?? '',
      })
    } else {
      setSelectedConfigId('')
      setIncomeTypeId('')
      resetForm({ date: new Date().toISOString().slice(0, 10), recorded_at_date: new Date().toISOString().slice(0, 10), amount: undefined })
    }
  }, [open, editRecord, resetForm, resetAdd, resetUpdate])

  const onSubmit = async (values: FormValues) => {
    try {
      if (isEdit && editRecord) {
        await update({
          id: editRecord.id,
          updates: {
            date:                       values.date,
            amount:                     values.amount,
            description:                values.description  || null,
            allocation_config_id:       selectedConfigId   || null,
            bank_name:                  values.bank_name   || null,
            stage_code_1:               values.stage_code_1 || null,
            stage_code_2:               values.stage_code_2 || null,
            transaction_ref:            values.transaction_ref           || null,
            specific_seed_description:  values.specific_seed_description || null,
            remark:                     values.remark || null,
            fx_currency:                values.fx_currency             || null,
            fx_amount:                  typeof values.fx_amount === 'number' ? values.fx_amount : null,
            fx_rate:                    typeof values.fx_rate   === 'number' ? values.fx_rate   : null,
            transaction_type:           values.transaction_type        || null,
            original_transaction_id:    values.original_transaction_id || null,
            income_type_id:             incomeTypeId || null,
            ...(values.created_at_date ? { created_at: `${values.created_at_date}T00:00:00.000Z` } : {}),
            ...(values.recorded_at_date ? { recorded_at: `${values.recorded_at_date}T00:00:00.000Z` } : {}),
          },
        })
      } else {
        const input: AddInflowInput = {
          date:                       values.date,
          amount:                     values.amount,
          description:                values.description  || undefined,
          allocation_config_id:       selectedConfigId   || undefined,
          bank_name:                  values.bank_name   || undefined,
          stage_code_1:               values.stage_code_1 || undefined,
          stage_code_2:               values.stage_code_2 || undefined,
          transaction_ref:            values.transaction_ref           || undefined,
          specific_seed_description:  values.specific_seed_description || undefined,
          remark:                     values.remark || undefined,
          fx_currency:                values.fx_currency             || undefined,
          fx_amount:                  typeof values.fx_amount === 'number' ? values.fx_amount : undefined,
          fx_rate:                    typeof values.fx_rate   === 'number' ? values.fx_rate   : undefined,
          transaction_type:           values.transaction_type        || undefined,
          original_transaction_id:    values.original_transaction_id || undefined,
          income_type_id:             incomeTypeId || undefined,
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

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? 'Edit Inflow Transaction' : 'Add Inflow Transaction'}
    >
      <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">

        {error && (
          <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
            {/schema cache/i.test(error) ? (
              <div className="space-y-2">
                <p className="font-semibold">Schema cache out of sync — run this in Supabase SQL editor, then retry:</p>
                <code className="block font-mono text-xs bg-white border border-red-200 rounded p-2 whitespace-pre-wrap break-all select-all">
                  {`NOTIFY pgrst, 'reload schema';`}
                </code>
                <p className="text-xs">If the column is also missing, run the full migration in <strong>Setup → Database tab</strong>.</p>
              </div>
            ) : error}
          </div>
        )}

        {/* Date + Amount */}
        <div className="grid grid-cols-2 gap-4">
          <Field label="Date *" error={errors.date?.message}>
            <input type="date" {...register('date')} className={inputCls(!!errors.date)} />
          </Field>
          <Field label="Amount (₦) *" error={errors.amount?.message}>
            <Controller control={control} name="amount" render={({ field }) => (
              <CurrencyInput value={field.value} onChange={field.onChange} placeholder="0.00" className={inputCls(!!errors.amount)} />
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

        {/* Description — auto-assigns type on change */}
        <Field label="Description" error={errors.description?.message}>
          <input type="text" placeholder="e.g. Sunday offering" {...register('description')} className={inputCls(!!errors.description)} />
        </Field>

        {/* Bank */}
        <Field label="Bank" error={errors.bank_name?.message}>
          <select {...register('bank_name')} className={inputCls(!!errors.bank_name)}>
            <option value="">— None —</option>
            {banks.map(b => (
              <option key={b.id} value={b.name}>{b.name}</option>
            ))}
          </select>
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

        {/* Income Type */}
        {incomeTypes.length > 0 && (
          <Field label="Income Type">
            <div className="flex items-center gap-2">
              {selectedIncomeType && (
                <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: selectedIncomeType.color }} />
              )}
              <select
                value={incomeTypeId}
                onChange={e => {
                  setIncomeTypeId(e.target.value)
                  setIncomeTypeAutoSet(false)
                  // If user manually clears the type, let date-based config take over
                  if (!e.target.value) setConfigManuallySet(false)
                }}
                className={`flex-1 ${inputCls(false)}`}
              >
                <option value="">— None —</option>
                {incomeTypes.map(t => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>
            {incomeTypeAutoSet && incomeTypeId && (
              <p className="flex items-center gap-1 text-[10px] text-primary mt-1">
                <Sparkles className="w-3 h-3" /> Auto-suggested from description · click to change
              </p>
            )}
          </Field>
        )}

        {/* Allocation Config */}
        <Field label="Allocation Config">
          {selectedIncomeType?.special_config_id && !configManuallySet ? (
            <div className="space-y-1">
              <div className="flex items-center justify-between px-3 py-2 bg-primary/5 border border-primary/20 rounded-lg">
                <span className="text-xs text-primary font-medium">
                  Auto-applying: {selectedIncomeType.special_config_name ?? 'Special Config'}
                </span>
                <button
                  type="button"
                  onClick={() => setConfigManuallySet(true)}
                  className="text-[10px] text-gray-400 hover:text-gray-600 underline"
                >
                  Override
                </button>
              </div>
            </div>
          ) : (
            <>
              <select
                value={selectedConfigId}
                onChange={e => { setSelectedConfigId(e.target.value); setConfigManuallySet(true) }}
                className={inputCls(false)}
              >
                <option value="">Date-based (auto)</option>
                {lockedConfigs.map(c => (
                  <option key={c.id} value={c.id}>{c.name} — effective {c.start_date}</option>
                ))}
              </select>
              {!selectedConfigId && watchedDate && (
                <p className="text-[10px] text-gray-400 mt-0.5">
                  Auto: {getConfigForDate(lockedConfigs, watchedDate)?.name ?? 'no config found for this date'}
                </p>
              )}
            </>
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

        {/* FX Details collapsible */}
        <div className="border border-gray-100 rounded-lg overflow-hidden">
          <button
            type="button"
            onClick={() => setFxOpen(v => !v)}
            className="w-full flex items-center justify-between px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wider bg-gray-50 hover:bg-gray-100 transition-colors"
          >
            FX Details (amount &amp; rate)
            {fxOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          </button>
          {fxOpen && (
            <div className="p-4 space-y-4">
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
            </div>
          )}
        </div>

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
