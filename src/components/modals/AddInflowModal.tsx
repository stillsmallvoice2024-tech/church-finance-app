import { useEffect, useRef, useState } from 'react'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Sparkles, ExternalLink } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Modal, type ModalHandle } from '../ui/Modal'
import { TechDetails } from '../ui/TechDetails'
import { Field, inputCls } from '../ui/FormField'
import { ButtonSpinner } from '../ui/ButtonSpinner'
import { useAddInflow, useUpdateTransaction, type AddInflowInput } from '../../hooks/useMutations'
import { useCategories } from '../../hooks/useCategories'
import { useBanks } from '../../hooks/useBanks'
import { useAllocationStore, getConfigForDate, getSpecialConfigVersionForDate } from '../../store/allocationStore'
import { useIncomeTypes, type IncomeType } from '../../hooks/useIncomeTypes'
import { classifyIncomeType } from '../../utils/classifyIncomeType'
import type { InflowTransaction } from '../../hooks/useTransactions'
import { CurrencyInput } from '../ui/CurrencyInput'
import { useOrgCurrency } from '../../hooks/useOrgCurrency'
import { SearchableSelect } from '../ui/SearchableSelect'

// ── Zod schema ─────────────────────────────────────────────────────────────────────────────

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
  const { baseCurrencySymbol } = useOrgCurrency()
  const { categories } = useCategories()
  const { banks } = useBanks()
  const fxBanks    = banks.filter(b => b.is_foreign_currency)
  const nonFxBanks = banks.filter(b => !b.is_foreign_currency)
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
  const modalRef = useRef<ModalHandle>(null)

  const [selectedConfigId,  setSelectedConfigId]  = useState('')
  const [configManuallySet, setConfigManuallySet] = useState(false)

  // Custom income type (user-defined, separate from the legacy inflowType)
  const [incomeTypeId,        setIncomeTypeId]        = useState<string>('')
  const [incomeTypeAutoSet,   setIncomeTypeAutoSet]   = useState(false)

  const selectedIncomeType: IncomeType | null =
    incomeTypes.find(t => t.id === incomeTypeId) ?? null

  const {
    register,
    control,
    handleSubmit,
    formState: { errors, isDirty },
    reset: resetForm,
    watch,
  } = useForm<FormValues>({ resolver: zodResolver(schema) })

  const description     = watch('description')
  const stageCode1      = watch('stage_code_1')
  const transactionType = watch('transaction_type')
  const watchedDate     = watch('date')

  // Auto-classify income type from description + stage code
  useEffect(() => {
    if (transactionType) {               // non-Normal: income type not applicable
      setIncomeTypeId('')
      setIncomeTypeAutoSet(false)
      return
    }
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
  }, [description, stageCode1, incomeTypes, transactionType]) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-apply special config when income type changes (unless config was manually picked)
  useEffect(() => {
    if (transactionType) {               // non-Normal: no allocation config
      setSelectedConfigId('')
      setConfigManuallySet(false)
      return
    }
    if (configManuallySet) return
    const isCatchAll = selectedIncomeType !== null && selectedIncomeType.rules.length === 0
    if (!isCatchAll && selectedIncomeType?.special_config_group_id && watchedDate) {
      const version = getSpecialConfigVersionForDate(allocConfigs, selectedIncomeType.special_config_group_id, watchedDate)
      setSelectedConfigId(version?.id ?? '')
    } else if (!isCatchAll && selectedIncomeType?.special_config_id) {
      setSelectedConfigId(selectedIncomeType.special_config_id)
    } else {
      if (watchedDate) {
        const cfg = getConfigForDate(lockedConfigs, watchedDate)
        setSelectedConfigId(cfg?.id ?? '')
      }
    }
  }, [incomeTypeId, selectedIncomeType, watchedDate, allocConfigs, transactionType]) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-select allocation config by date (unless manually overridden or income-type config applied)
  useEffect(() => {
    if (transactionType) return          // non-Normal: no allocation config
    if (configManuallySet || !watchedDate) return
    const isCatchAll = selectedIncomeType !== null && selectedIncomeType.rules.length === 0
    if (!isCatchAll && selectedIncomeType?.special_config_group_id) {
      const version = getSpecialConfigVersionForDate(allocConfigs, selectedIncomeType.special_config_group_id, watchedDate)
      setSelectedConfigId(version?.id ?? '')
      return
    }
    if (!isCatchAll && selectedIncomeType?.special_config_id) return
    const cfg = getConfigForDate(lockedConfigs, watchedDate)
    setSelectedConfigId(cfg?.id ?? '')
  }, [watchedDate, lockedConfigs, configManuallySet, allocConfigs, selectedIncomeType, transactionType]) // eslint-disable-line react-hooks/exhaustive-deps

  // Populate / clear form when modal opens
  useEffect(() => {
    if (!open) return
    resetAdd()
    resetUpdate()
    setConfigManuallySet(false)
    setIncomeTypeAutoSet(false)
    if (editRecord) {
      setSelectedConfigId(editRecord.allocation_config_id ?? '')
      setConfigManuallySet(true)
      setIncomeTypeId(editRecord.income_type_id ?? '')
      resetForm({
        date:                       editRecord.date,
        created_at_date:            editRecord.created_at ? editRecord.created_at.slice(0, 10) : '',
        recorded_at_date:           editRecord.recorded_at?.slice(0, 10) ?? '',
        amount:                     editRecord.amount,
        description:                editRecord.description ?? '',
        bank_name:                  editRecord.bank_name ?? '',
        stage_code_1:               editRecord.stage_code_1 ?? '',
        stage_code_2:               editRecord.stage_code_2 ?? '',
        transaction_ref:            editRecord.transaction_ref ?? '',
        specific_seed_description:  editRecord.specific_seed_description ?? '',
        remark:                     editRecord.remark ?? '',
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
            allocation_config_id:       values.transaction_type ? null : (selectedConfigId || null),
            bank_name:                  values.bank_name   || null,
            stage_code_1:               values.stage_code_1 || null,
            stage_code_2:               values.stage_code_2 || null,
            transaction_ref:            values.transaction_ref           || null,
            specific_seed_description:  values.specific_seed_description || null,
            remark:                     values.remark || null,
            // Preserve existing FX metadata — FX entry is managed through the FX module
            fx_currency:                editRecord.fx_currency ?? null,
            fx_amount:                  editRecord.fx_amount   ?? null,
            fx_rate:                    editRecord.fx_rate     ?? null,
            transaction_type:           values.transaction_type        || null,
            original_transaction_id:    values.original_transaction_id || null,
            income_type_id:             values.transaction_type ? null : (incomeTypeId || null),
            ...(values.created_at_date ? { created_at: `${values.created_at_date}T00:00:00.000Z` } : {}),
            ...(values.recorded_at_date ? { recorded_at: `${values.recorded_at_date}T00:00:00.000Z` } : {}),
          },
        })
      } else {
        const input: AddInflowInput = {
          date:                       values.date,
          amount:                     values.amount,
          description:                values.description  || undefined,
          allocation_config_id:       values.transaction_type ? undefined : (selectedConfigId || undefined),
          bank_name:                  values.bank_name   || undefined,
          stage_code_1:               values.stage_code_1 || undefined,
          stage_code_2:               values.stage_code_2 || undefined,
          transaction_ref:            values.transaction_ref           || undefined,
          specific_seed_description:  values.specific_seed_description || undefined,
          remark:                     values.remark || undefined,
          transaction_type:           values.transaction_type        || undefined,
          original_transaction_id:    values.original_transaction_id || undefined,
          income_type_id:             values.transaction_type ? undefined : (incomeTypeId || undefined),
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
        form="add-inflow-form"
        disabled={loading}
        className="px-5 min-h-[44px] text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary-light transition-colors disabled:opacity-60 flex items-center gap-2"
      >
        {loading && <ButtonSpinner />}
        {loading ? 'Saving…' : isEdit ? 'Save Changes' : 'Save Inflow'}
      </button>
    </div>
  )

  return (
    <Modal
      ref={modalRef}
      open={open}
      onClose={onClose}
      title={isEdit ? 'Edit Inflow Transaction' : 'Add Inflow Transaction'}
      isDirty={isDirty}
      disableClose={loading}
      footer={footerEl}
    >
      <form id="add-inflow-form" onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">

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
          <Field label={`Amount (${baseCurrencySymbol}) *`} error={errors.amount?.message}>
            <Controller control={control} name="amount" render={({ field }) => (
              <CurrencyInput value={field.value} onChange={field.onChange} placeholder="0.00" className={inputCls(!!errors.amount)} />
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

        {/* Description — auto-assigns type on change */}
        <Field label="Description" error={errors.description?.message}>
          <input type="text" placeholder="e.g. Sunday offering" {...register('description')} className={inputCls(!!errors.description)} />
        </Field>

        {/* Bank — FX banks excluded; FX transactions go through the FX module */}
        <Field label="Bank" error={errors.bank_name?.message}>
          <Controller name="bank_name" control={control} render={({ field }) => {
            const selectedIsFx = fxBanks.some(b => b.name === field.value)
            const bankOptions  = isEdit
              ? banks.map(b => ({ value: b.name, label: b.name }))
              : nonFxBanks.map(b => ({ value: b.name, label: b.name }))
            return (
              <>
                <SearchableSelect value={field.value ?? ''} onChange={field.onChange}
                  options={bankOptions}
                  placeholder="— None —" className={inputCls(!!errors.bank_name)} />
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

        {/* Transaction Type */}
        <Field label="Transaction Type" error={errors.transaction_type?.message}
          help="Normal is a regular inflow. Refund/Reversal corrects a prior outflow or entry. Bank Deposit, Intrabank Transfer, and Balance Brought Forward are system types used for reconciliation.">
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
          <Field label="Income Type"
            help="Classifies the source of this income (e.g. Tithes, Offerings, Rent). Used for income-type breakdown in financial reports. The system auto-suggests a type based on the description.">
            {transactionType ? (
              <div className="px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-600">
                {TXN_TYPES.find(t => t.value === transactionType)?.label ?? transactionType}
                <span className="text-xs text-gray-400 ml-2">— auto-set from transaction type</span>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2">
                  {selectedIncomeType && (
                    <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: selectedIncomeType.color }} />
                  )}
                  <div className="flex-1">
                    <SearchableSelect
                      value={incomeTypeId}
                      onChange={v => {
                        setIncomeTypeId(v)
                        setIncomeTypeAutoSet(false)
                        if (!v) setConfigManuallySet(false)
                      }}
                      options={incomeTypes.map(t => ({ value: t.id, label: t.name }))}
                      placeholder="— None —"
                      className={inputCls(false)}
                    />
                  </div>
                </div>
                {incomeTypeAutoSet && incomeTypeId && (
                  <p className="flex items-center gap-1 text-[10px] text-primary mt-1">
                    <Sparkles className="w-3 h-3" /> Auto-suggested from description · click to change
                  </p>
                )}
              </>
            )}
          </Field>
        )}

        {/* Allocation Config */}
        <Field label="Allocation Config"
          help="Defines how this inflow is split between funds (e.g. 70% to General Fund, 20% to Building Fund). The system auto-selects the config active on the transaction date. Choose a specific config to override.">
          {transactionType ? (
            <p className="text-xs text-gray-400 italic">Not applicable for non-Normal transactions</p>
          ) : selectedIncomeType?.special_config_id && !configManuallySet ? (
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
          <Field label="Stage Code 1" error={errors.stage_code_1?.message}
            help="The category assigned to this inflow. Used in reports to group income by type (e.g. Tithes, Offerings, Donations). Drives budget allocation.">
            <Controller name="stage_code_1" control={control} render={({ field }) => (
              <SearchableSelect value={field.value ?? ''} onChange={field.onChange}
                options={categories.map(c => ({ value: c.name, label: c.name }))}
                placeholder="— Select —" className={inputCls(!!errors.stage_code_1)} />
            )} />
          </Field>
          <Field label="Stage Code 2 (Portion Type)" error={errors.stage_code_2?.message}
            help="Specifies how this inflow's allocation portion is handled: Percentage Allocation applies percentage splits, Specific Seed earmarks a fixed amount, Savings routes to a savings fund.">
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

        {/* Remark */}
        <Field label="Remark" error={errors.remark?.message}>
          <textarea rows={2} placeholder="Additional notes…" {...register('remark')} className={`${inputCls(!!errors.remark)} resize-none`} />
        </Field>

      </form>
    </Modal>
  )
}

