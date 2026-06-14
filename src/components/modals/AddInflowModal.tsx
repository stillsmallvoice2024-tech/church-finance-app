import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Sparkles, ExternalLink } from 'lucide-react'
import { Link } from 'react-router-dom'
import { generateFallbackTransactionId } from '../../utils/generateTransactionId'
import { Modal, type ModalHandle } from '../ui/Modal'
import { TechDetails } from '../ui/TechDetails'
import { Field, inputCls, focusFirstInvalid, DateQuickChips } from '../ui/FormField'
import { CollapsibleSection } from '../ui/CollapsibleSection'
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
import { RootTransactionSearch, type RootTxnLink } from '../ui/RootTransactionSearch'
import { isOffsetableType } from '../../utils/transactionTypes'

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
  offset_role:                z.string().optional(),
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
  const [dupError, setDupError] = useState<string | null>(null)
  const [rootTxnLink, setRootTxnLink] = useState<RootTxnLink | null>(null)

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
    setValue,
  } = useForm<FormValues>({ resolver: zodResolver(schema) })

  const description     = watch('description')
  const stageCode1      = watch('stage_code_1')
  const transactionType = watch('transaction_type')
  const watchedDate     = watch('date')
  const offsetRole      = watch('offset_role') ?? ''
  const watchedBankName = watch('bank_name')

  const filteredCategories = useMemo(
    () => categories.filter(c => !c.currency),
    [categories],
  )

  const isOffsetType = isOffsetableType(transactionType)

  // Clear stage_code_1 when bank changes and the current value is not in the filtered list
  useEffect(() => {
    if (!stageCode1) return
    if (!filteredCategories.some(c => c.name === stageCode1)) setValue('stage_code_1', '')
  }, [filteredCategories, stageCode1, setValue])

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

  // Propagate category + fund type from root to this offset
  // In edit mode, only skip if the record already has values (don't overwrite intentional data)
  useEffect(() => {
    if (!rootTxnLink) return
    if (editRecord && (editRecord.stage_code_1 || editRecord.stage_code_2)) return
    let cancelled = false
    supabase.from(rootTxnLink.table)
      .select('stage_code_1, stage_code_2')
      .eq('id', rootTxnLink.id)
      .single()
      .then(({ data }) => {
        if (cancelled || !data) return
        if (data.stage_code_1) setValue('stage_code_1', data.stage_code_1 as string)
        if (data.stage_code_2) setValue('stage_code_2', data.stage_code_2 as string)
      })
    return () => { cancelled = true }
  }, [rootTxnLink, editRecord, setValue]) // eslint-disable-line react-hooks/exhaustive-deps

  // Populate / clear form when modal opens
  useEffect(() => {
    if (!open) return
    resetAdd()
    resetUpdate()
    setConfigManuallySet(false)
    setIncomeTypeAutoSet(false)
    setDupError(null)
    setRootTxnLink(null)
    if (editRecord) {
      setSelectedConfigId(editRecord.allocation_config_id ?? '')
      setConfigManuallySet(true)
      setIncomeTypeId(editRecord.income_type_id ?? '')
      // Restore root-link pill if this record has a linked root
      if (editRecord.root_transaction_id && editRecord.root_transaction_table) {
        setRootTxnLink({
          id:     editRecord.root_transaction_id,
          table:  editRecord.root_transaction_table as 'inflow_transactions' | 'outflow_transactions',
          label:  `Linked · ID: ${editRecord.root_transaction_id.slice(0, 8)}… (search to update)`,
          txnRef: null,
        })
      }
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
        offset_role:                editRecord.offset_role ?? '',
      })
    } else {
      setSelectedConfigId('')
      setIncomeTypeId('')
      resetForm({ date: new Date().toISOString().slice(0, 10), recorded_at_date: new Date().toISOString().slice(0, 10), amount: undefined })
    }
  }, [open, editRecord, resetForm, resetAdd, resetUpdate])

  const onSubmit = async (values: FormValues) => {
    setDupError(null)
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
            offset_role:                isOffsetableType(values.transaction_type) ? (values.offset_role as 'root' | 'offset' | null || null) : null,
            root_transaction_id:        isOffsetableType(values.transaction_type) && values.offset_role === 'offset' && rootTxnLink ? rootTxnLink.id    : null,
            root_transaction_table:     isOffsetableType(values.transaction_type) && values.offset_role === 'offset' && rootTxnLink ? rootTxnLink.table : null,
            offset_link_type:           isOffsetableType(values.transaction_type) && values.offset_role === 'offset' && rootTxnLink ? (values.transaction_type || null) : null,
            income_type_id:             values.transaction_type ? null : (incomeTypeId || null),
            ...(values.created_at_date ? { created_at: `${values.created_at_date}T00:00:00.000Z` } : {}),
            ...(values.recorded_at_date ? { recorded_at: `${values.recorded_at_date}T00:00:00.000Z` } : {}),
          },
        })
      } else {
        const txnRef = values.transaction_ref?.trim()
          || await generateFallbackTransactionId(values.date, String(values.amount), values.description ?? '', values.bank_name ?? '')
        let dupQ = supabase.from('inflow_transactions').select('id').eq('transaction_ref', txnRef)
        if (values.bank_name) dupQ = dupQ.eq('bank_name', values.bank_name)
        const { data: dup } = await dupQ.limit(1)
        if (dup && dup.length > 0) {
          setDupError('Duplicate: an inflow with this transaction ref already exists for the selected bank.')
          return
        }
        const input: AddInflowInput = {
          date:                       values.date,
          amount:                     values.amount,
          description:                values.description  || undefined,
          allocation_config_id:       values.transaction_type ? undefined : (selectedConfigId || undefined),
          bank_name:                  values.bank_name   || undefined,
          stage_code_1:               values.stage_code_1 || undefined,
          stage_code_2:               values.stage_code_2 || undefined,
          transaction_ref:            txnRef,
          specific_seed_description:  values.specific_seed_description || undefined,
          remark:                     values.remark || undefined,
          transaction_type:           values.transaction_type        || undefined,
          original_transaction_id:    values.original_transaction_id || undefined,
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
      <form id="add-inflow-form" onSubmit={handleSubmit(onSubmit, focusFirstInvalid)} noValidate className="space-y-4">

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
            <DateQuickChips onPick={d => setValue('date', d, { shouldDirty: true, shouldValidate: true })} />
          </Field>
          <Field label={`Amount (${baseCurrencySymbol}) *`} error={errors.amount?.message}>
            <Controller control={control} name="amount" render={({ field }) => (
              <CurrencyInput value={field.value} onChange={field.onChange} placeholder="0.00" className={inputCls(!!errors.amount)} />
            )} />
          </Field>
        </div>

        {/* Recorded Date / legacy date / refs / remarks live in "More details" below
            — the happy path stays a 5-field form on phones (F2 mobile audit) */}

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
                  <p className="flex items-center gap-1 text-xs text-amber-600 mt-0.5">
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

        {/* Transaction Type / offsets — collapsed unless relevant */}
        <CollapsibleSection label="Transaction type & offsets" defaultOpen={isEdit || isOffsetType}>
        <Field label="Transaction Type" error={errors.transaction_type?.message}
          help="Normal is a regular inflow. Refund/Reversal corrects a prior outflow or entry. Bank Deposit, Intrabank Transfer, and Balance Brought Forward are system types used for reconciliation.">
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
        </CollapsibleSection>

        {/* Income Type */}
        {incomeTypes.length > 0 && (
          <Field label="Income Type"
            help="Classifies the source of this income (e.g. Tithes, Offerings, Rent). Used for income-type breakdown in financial reports. The system auto-suggests a type based on the description.">
            {transactionType ? (
              <div className="px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-600">
                {TXN_TYPES.find(t => t.value === transactionType)?.label ?? transactionType}
                <span className="text-xs text-gray-500 ml-2">— auto-set from transaction type</span>
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
                  <p className="flex items-center gap-1 text-xs text-primary mt-1">
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
            <p className="text-xs text-gray-500 italic">Not applicable for non-Normal transactions</p>
          ) : selectedIncomeType?.special_config_id && !configManuallySet ? (
            <div className="space-y-1">
              <div className="flex items-center justify-between px-3 py-2 bg-primary/5 border border-primary/20 rounded-lg">
                <span className="text-xs text-primary font-medium">
                  Auto-applying: {selectedIncomeType.special_config_name ?? 'Special Config'}
                </span>
                <button
                  type="button"
                  onClick={() => setConfigManuallySet(true)}
                  className="text-xs text-gray-500 hover:text-gray-600 underline"
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
                <p className="text-xs text-gray-500 mt-0.5">
                  Auto: {getConfigForDate(lockedConfigs, watchedDate)?.name ?? 'no config found for this date'}
                </p>
              )}
            </>
          )}
        </Field>

        {/* Stage Code 1 + 2 (display labels: Category / Fund Type) */}
        <div className="grid grid-cols-2 gap-4">
          <Field label="Category" error={errors.stage_code_1?.message}
            help="The category assigned to this inflow. Used in reports to group income by type (e.g. Tithes, Offerings, Donations). Drives budget allocation.">
            <Controller name="stage_code_1" control={control} render={({ field }) => (
              <SearchableSelect value={field.value ?? ''} onChange={field.onChange}
                options={filteredCategories.map(c => ({ value: c.name, label: c.name }))}
                placeholder="— Select —" className={inputCls(!!errors.stage_code_1)} />
            )} />
          </Field>
          <Field label="Fund Type" error={errors.stage_code_2?.message}
            help="How this inflow is routed: Regular Funds applies the percentage distribution rule, Designated Gift earmarks the full amount for a specific purpose, Savings routes it to a savings fund.">
            <select {...register('stage_code_2')} className={inputCls(!!errors.stage_code_2)}>
              <option value="">— Select —</option>
              <option value="Percentage Allocation">Regular Funds (percentage split)</option>
              <option value="Specific Seed">Designated Gift (earmarked)</option>
              <option value="Savings">Savings</option>
            </select>
          </Field>
        </div>

        {/* Optional details — collapsed by default to keep the form short */}
        <CollapsibleSection label="More details (dates, refs, remarks)" defaultOpen={isEdit}>
          <Field label="Recorded Date" error={errors.recorded_at_date?.message}
            help="The date this transaction was logged in the system, which may differ from the bank transaction date. Financial reports use the bank date; audit logs use the recorded date.">
            <input type="date" {...register('recorded_at_date')} className={inputCls(!!errors.recorded_at_date)} />
          </Field>

          {isEdit && (
            <Field label="Date Added — legacy (financial reports)" error={errors.created_at_date?.message}>
              <input type="date" {...register('created_at_date')} className={inputCls(!!errors.created_at_date)} />
            </Field>
          )}

          <Field label="Transaction Ref" error={errors.transaction_ref?.message}>
            <input type="text" placeholder="Ref / cheque no." {...register('transaction_ref')} className={inputCls(!!errors.transaction_ref)} />
          </Field>

          <Field label="Designated Purpose" error={errors.specific_seed_description?.message}
            help="For designated gifts: describe what this gift is earmarked for (e.g. Building Project, Missions).">
            <input type="text" placeholder="What is this gift designated for? (if any)" {...register('specific_seed_description')} className={inputCls(!!errors.specific_seed_description)} />
          </Field>

          <Field label="Remark" error={errors.remark?.message}>
            <textarea rows={2} placeholder="Additional notes…" {...register('remark')} className={`${inputCls(!!errors.remark)} resize-none`} />
          </Field>
        </CollapsibleSection>

      </form>
    </Modal>
  )
}

