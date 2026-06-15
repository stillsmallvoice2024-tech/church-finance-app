import { useEffect, useState, useRef } from 'react'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { AlertTriangle, Plus, Trash2, Check, X } from 'lucide-react'
import { TechDetails } from '../ui/TechDetails'
import { Modal, type ModalHandle } from '../ui/Modal'
import { Field, inputCls, focusFirstInvalid } from '../ui/FormField'
import { ButtonSpinner } from '../ui/ButtonSpinner'
import { useAddBank, useUpdateBank, useAddCategory, type AddBankInput } from '../../hooks/useMutations'
import { useCategories, upsertCategoryOpeningBalance, deleteCategoryOpeningBalance, type BudgetPortion } from '../../hooks/useCategories'
import { useCurrencies } from '../../hooks/useCurrencies'
import { useOrgStore } from '../../store/orgStore'
import { useOrgCurrency } from '../../hooks/useOrgCurrency'
import type { DbBank, StartingBalanceRow, SchemaStatus } from '../../hooks/useBanks'
import { checkBankStartingBalanceMigration } from '../../hooks/useBanks'
import { CurrencyInput } from '../ui/CurrencyInput'
import { formatCurrency, parseCurrency } from '../../utils/currency'
import { useToastStore } from '../../store/toastStore'
import { propagateBankOpeningBalance } from '../../utils/bankOpeningBalance'
import { allocatePercent } from '../../utils/financeMath'

const ACCOUNT_TYPES  = ['Current', 'Savings', 'Fixed Deposit', 'Domiciliary'] as const
const BUDGET_PORTIONS = ['Percentage Allocation', 'Specific Seed', 'Savings'] as const
const NEW_SENTINEL = '__new__'
const MAX_CACHE_RETRIES = 3

const MIGRATION_SQL =
`ALTER TABLE banks
  ADD COLUMN IF NOT EXISTS currency                  text NOT NULL DEFAULT 'NGN',
  ADD COLUMN IF NOT EXISTS starting_balance          numeric(15,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS starting_balance_category text,
  ADD COLUMN IF NOT EXISTS starting_balance_budget_portion text,
  ADD COLUMN IF NOT EXISTS starting_balance_alloc_type text,
  ADD COLUMN IF NOT EXISTS starting_balance_allocations jsonb NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS is_foreign_currency       bool NOT NULL DEFAULT false;
-- Helper view: reads information_schema directly, bypasses PostgREST schema cache
CREATE OR REPLACE VIEW public.bank_schema_check AS
  SELECT column_name::text
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'banks';
GRANT SELECT ON public.bank_schema_check TO anon, authenticated;
-- Reload PostgREST schema cache immediately
NOTIFY pgrst, 'reload schema';`

const schema = z.object({
  name:             z.string().min(1, 'Bank name is required'),
  account_number:   z.string().optional(),
  account_type:     z.string().optional(),
  currency:         z.string().optional(),
  starting_balance: z.coerce.number().min(0).optional(),
})

type FormValues = z.infer<typeof schema>
type AllocType  = 'percentage' | 'amount'
interface RowDraft { category_name: string; budget_portion: string; value: string; apply_to_category: boolean }
interface NewCatMode { rowIndex: number; draft: string; saving: boolean; error: string | null }

interface Props {
  open:        boolean
  onClose:     () => void
  onSuccess?:  () => void
  editRecord?: DbBank | null
}

export function AddBankModal({ open, onClose, onSuccess, editRecord }: Props) {
  const isEdit = !!editRecord
  const { baseCurrencySymbol } = useOrgCurrency()
  const { categories, refetch: refetchCategories } = useCategories()
  const { currencies } = useCurrencies()
  const defaultCurrency = useOrgStore(s => s.defaultCurrency)
  const orgId           = useOrgStore(s => s.orgId) ?? ''
  const { push: toast } = useToastStore()

  const addMutation    = useAddBank()
  const updateMutation = useUpdateBank()
  const addCatMutation = useAddCategory()

  const { mutate: add,         loading: adding,   error: addError,    reset: resetAdd    } = addMutation
  const { mutate: update,      loading: updating, error: updateError, reset: resetUpdate } = updateMutation
  const { mutate: addCategory                                                             } = addCatMutation

  const loading = adding || updating
  const error   = addError || updateError
  const isSchemaCacheError = !!error && /schema cache/i.test(error)

  const [allocType,       setAllocType]       = useState<AllocType>('percentage')
  const [rows,            setRows]            = useState<RowDraft[]>([{ category_name: '', budget_portion: '', value: '', apply_to_category: true }])
  const [allocError,      setAllocError]      = useState<string | null>(null)
  const [newCatMode,      setNewCatMode]      = useState<NewCatMode | null>(null)
  const [schemaStatus,   setSchemaStatus]   = useState<SchemaStatus>('ok')
  const [checkingSchema, setCheckingSchema] = useState(false)
  const newCatInputRef   = useRef<HTMLInputElement>(null)
  const cacheRetryCount  = useRef(0)
  const initialAllocRef  = useRef<{ type: AllocType; rows: RowDraft[] }>({
    type: 'percentage',
    rows: [{ category_name: '', budget_portion: '', value: '', apply_to_category: true }],
  })

  const modalRef = useRef<ModalHandle>(null)

  const { register, control, handleSubmit, formState: { errors, isDirty: formIsDirty }, reset: resetForm, watch } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: '', account_number: '', account_type: '' },
  })

  const startingBalance = watch('starting_balance')
  const watchedCurrency = watch('currency')
  const hasBalance      = (startingBalance ?? 0) > 0

  const isForeignCurrencyBank = !!watchedCurrency && watchedCurrency !== (defaultCurrency ?? 'NGN')

  const selectedCurrencyMeta = currencies.find(c => c.code === watchedCurrency)
  const selectedCurrencySymbol = selectedCurrencyMeta?.symbol ?? watchedCurrency ?? baseCurrencySymbol

  const allocsDirty =
    allocType !== initialAllocRef.current.type ||
    JSON.stringify(rows) !== JSON.stringify(initialAllocRef.current.rows)
  const isDirty = formIsDirty || allocsDirty

  const runningTotal = rows.reduce((s, r) => s + (parseFloat(r.value) || 0), 0)
  const target       = allocType === 'percentage' ? 100 : (startingBalance ?? 0)
  const balanced     = !hasBalance || (target > 0 && Math.abs(runningTotal - target) < 0.01)

  const addRow      = () => setRows(prev => [...prev, { category_name: '', budget_portion: '', value: '', apply_to_category: true }])
  const removeRow   = (i: number) => setRows(prev => prev.filter((_, idx) => idx !== i))
  const setRowField = (i: number, field: keyof RowDraft, val: string | boolean) =>
    setRows(prev => prev.map((r, idx) => idx === i ? { ...r, [field]: val } : r))

  // Focus the new-category input whenever it appears
  useEffect(() => {
    if (newCatMode) setTimeout(() => newCatInputRef.current?.focus(), 0)
  }, [newCatMode?.rowIndex])

  useEffect(() => {
    if (!open) return
    resetAdd()
    resetUpdate()
    setAllocError(null)
    setNewCatMode(null)
    setSchemaStatus('ok')
    cacheRetryCount.current = 0

    // Populate form fields synchronously
    if (editRecord) {
      resetForm({
        name:             editRecord.name,
        account_number:   editRecord.account_number ?? '',
        account_type:     editRecord.account_type   ?? '',
        currency:         editRecord.currency       ?? defaultCurrency ?? '',
        starting_balance: editRecord.starting_balance ?? undefined,
      })
      const allocs = editRecord.starting_balance_allocations ?? []
      let initType: AllocType = 'percentage'
      let initRows: RowDraft[]
      if (allocs.length > 0) {
        const usesPercent = allocs[0].percentage !== undefined
        initType = usesPercent ? 'percentage' : 'amount'
        initRows = allocs.map(r => ({
          category_name:     r.category_name,
          budget_portion:    r.budget_portion,
          value:             String(usesPercent ? (r.percentage ?? '') : (r.amount ?? '')),
          apply_to_category: r.apply_to_category !== false,
        }))
      } else if (editRecord.starting_balance_category) {
        // backward-compat: legacy single-field bank
        initRows = [{
          category_name:     editRecord.starting_balance_category,
          budget_portion:    editRecord.starting_balance_budget_portion ?? '',
          value:             '',
          apply_to_category: true,
        }]
      } else {
        initRows = [{ category_name: '', budget_portion: '', value: '', apply_to_category: true }]
      }
      setAllocType(initType)
      setRows(initRows)
      initialAllocRef.current = { type: initType, rows: initRows }
    } else {
      const initRows: RowDraft[] = [{ category_name: '', budget_portion: '', value: '', apply_to_category: true }]
      resetForm({ name: '', account_number: '', account_type: '', currency: defaultCurrency ?? 'NGN' })
      setAllocType('percentage')
      setRows(initRows)
      initialAllocRef.current = { type: 'percentage', rows: initRows }
    }

    // Schema check with one retry — handles stale PostgREST cache immediately
    // after a migration is applied before the cache has fully reloaded.
    let active = true
    setCheckingSchema(true)
    ;(async () => {
      let status = await checkBankStartingBalanceMigration()
      if (active && status !== 'ok') {
        await new Promise(r => setTimeout(r, 1500))
        status = await checkBankStartingBalanceMigration()
      }
      if (active) {
        setSchemaStatus(status)
        setCheckingSchema(false)
      }
    })()
    return () => { active = false }
  }, [open, editRecord, resetForm, resetAdd, resetUpdate])

  // When a save fails with a schema-cache error: re-check state.
  // If re-check returns 'ok' (columns exist, cache now fine) the save failed during a
  // transient cache reload window — show a retry toast rather than silently clearing.
  // If re-check returns non-ok, the migration banner will show.
  // Capped at MAX_CACHE_RETRIES — beyond that, keep the error and show schemaStuck.
  useEffect(() => {
    if (!error || !/schema cache/i.test(error)) return
    cacheRetryCount.current++
    if (cacheRetryCount.current > MAX_CACHE_RETRIES) return
    let cancelled = false
    ;(async () => {
      const status = await checkBankStartingBalanceMigration()
      if (cancelled) return
      // SELECT cache is fine but the INSERT/UPDATE cache may still be stale —
      // treat as cache_stale so the banner instructs the user to run NOTIFY.
      // Do not auto-retry: the INSERT cache cannot be verified via SELECT alone
      // and retrying will loop until schemaStuck fires.
      setSchemaStatus(status === 'ok' ? 'cache_stale' : status)
      resetAdd()
      resetUpdate()
    })()
    return () => { cancelled = true }
  }, [error, toast])

  const confirmNewCategory = async (rowIndex: number) => {
    if (!newCatMode) return
    const name = newCatMode.draft.trim()
    if (!name) return
    setNewCatMode(prev => prev ? { ...prev, saving: true, error: null } : null)
    try {
      await addCategory({ name })
      await refetchCategories()
      setRowField(rowIndex, 'category_name', name)
      setNewCatMode(null)
    } catch (e: unknown) {
      const msg = (e as { message?: string })?.message ?? 'Failed to create category'
      setNewCatMode(prev => prev ? { ...prev, saving: false, error: msg } : null)
    }
  }

  const onSubmit = async (values: FormValues) => {
    setAllocError(null)
    if (hasBalance) {
      const validRows = rows.filter(r => r.category_name && r.budget_portion && parseFloat(r.value) > 0)
      if (validRows.length === 0) {
        setAllocError('Add at least one complete allocation row')
        return
      }
      if (!balanced) {
        setAllocError(
          allocType === 'percentage'
            ? `Allocations total ${runningTotal.toFixed(1)}% — must equal 100%`
            : `Allocations total ${selectedCurrencySymbol}${runningTotal.toLocaleString()} — must equal starting balance ${selectedCurrencySymbol}${(values.starting_balance ?? 0).toLocaleString()}`
        )
        return
      }
    }

    const validRows = rows.filter(r => r.category_name && r.budget_portion && parseFloat(r.value) > 0)
    const allocations: StartingBalanceRow[] = hasBalance
      ? validRows.map(r => ({
          category_name:     r.category_name,
          budget_portion:    r.budget_portion,
          apply_to_category: r.apply_to_category,
          ...(allocType === 'percentage'
            ? { percentage: parseFloat(r.value) }
            : { amount: parseFloat(r.value) }),
        }))
      : []

    // Only send starting_balance_allocations when there is a balance; omitting it for
    // no-balance banks lets the DB default ('[]') apply and avoids requiring the migration
    // for basic bank creation.
    const bankCurrency = values.currency || defaultCurrency || ''
    const payload: AddBankInput = {
      name:               values.name,
      account_number:     values.account_number || undefined,
      account_type:       values.account_type   || undefined,
      currency:           bankCurrency,
      is_foreign_currency: bankCurrency !== '' && bankCurrency !== (defaultCurrency ?? 'NGN'),
      starting_balance:             values.starting_balance || undefined,
      starting_balance_alloc_type:  hasBalance ? allocType : undefined,
      starting_balance_allocations: hasBalance ? allocations : undefined,
    }

    try {
      if (isEdit && editRecord) {
        await update({ id: editRecord.id, ...payload })
      } else {
        await add(payload)
      }

      // ── Propagate Balance Brought Forward into bank ledger ────────────────────
      try {
        await propagateBankOpeningBalance(
          values.name,
          values.starting_balance ?? null,
          isEdit && editRecord && editRecord.name !== values.name ? editRecord.name : undefined,
        )
      } catch (e) {
        console.error('[bank-modal] B/F propagation failed', e)
        toast('Bank saved — Balance Brought Forward entry could not be updated in Bank Ledger. Please reload Bank Ledger if needed.', 'error')
      }

      // ── Propagate opening balances into category_opening_balances ──────────────
      if (hasBalance && allocations.length > 0) {
        const totalBalance = values.starting_balance ?? 0
        const propagateErrors: string[] = []
        const skipped: string[] = []

        // On edit: remove stale entries where apply_to_category changed from true → false
        if (isEdit && editRecord) {
          const prevAllocs = editRecord.starting_balance_allocations ?? []
          for (const prev of prevAllocs) {
            if (prev.apply_to_category === false) continue // was already excluded, no cleanup
            const curr = allocations.find(
              a => a.category_name === prev.category_name && a.budget_portion === prev.budget_portion
            )
            if (curr && curr.apply_to_category === false) {
              const cat = categories.find(c => c.name === prev.category_name)
              if (cat) {
                try {
                  await deleteCategoryOpeningBalance(cat.id, prev.budget_portion as BudgetPortion)
                } catch (e) {
                  console.error('[bank-modal] stale cleanup failed', prev.category_name, e)
                }
              }
            }
          }
        }

        // Upsert entries for apply_to_category = true rows
        for (const row of allocations) {
          if (row.apply_to_category === false) continue
          const cat = categories.find(c => c.name === row.category_name)
          if (!cat) {
            console.warn('[bank-modal] category not found for propagation', row.category_name)
            skipped.push(row.category_name)
            continue
          }
          const amount = allocType === 'percentage'
            ? allocatePercent(totalBalance, row.percentage ?? 0)
            : (row.amount ?? 0)
          if (!isFinite(amount) || isNaN(amount) || amount <= 0) continue
          try {
            await upsertCategoryOpeningBalance(cat.id, row.budget_portion as BudgetPortion, amount, orgId)
          } catch (e: unknown) {
            const msg = (e as { message?: string })?.message ?? 'Unknown error'
            console.error('[bank-modal] upsert failed', { category: row.category_name, portion: row.budget_portion, error: msg })
            propagateErrors.push(`${row.category_name} (${row.budget_portion})`)
          }
        }

        if (propagateErrors.length > 0) {
          toast(
            `Bank saved — category balance update failed for: ${propagateErrors.join(', ')}. Check Setup → Database if migration is needed.`,
            'error'
          )
        } else if (skipped.length > 0) {
          toast(
            `Bank saved — ${skipped.length} categor${skipped.length === 1 ? 'y was' : 'ies were'} not found and skipped: ${skipped.join(', ')}`,
            'error'
          )
        } else {
          toast(isEdit ? 'Bank updated' : 'Bank added', 'success')
        }
      } else {
        toast(isEdit ? 'Bank updated' : 'Bank added', 'success')
      }

      onSuccess?.()
      onClose()
    } catch (e) {
      console.error('[bank-modal] save threw', e)
      /* error surfaced via hook error state */
    }
  }

  const schemaStuck         = isSchemaCacheError && cacheRetryCount.current > MAX_CACHE_RETRIES
  const showMigrationBanner = (!checkingSchema && schemaStatus !== 'ok') || schemaStuck

  const footerEl = (
    <div className="flex justify-end gap-3">
      <button
        type="button"
        onClick={() => modalRef.current?.requestClose()}
        disabled={loading}
        className="px-4 min-h-[44px] text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
      >
        Cancel
      </button>
      <button
        type="submit"
        form="add-bank-form"
        disabled={loading || checkingSchema || schemaStatus !== 'ok' || schemaStuck || (hasBalance && !balanced)}
        className="px-5 min-h-[44px] text-sm text-white bg-primary rounded-lg hover:bg-primary-light disabled:opacity-60 flex items-center gap-2"
      >
        {loading && <ButtonSpinner />}
        {loading ? 'Saving…' : isEdit ? 'Save Changes' : 'Add Bank'}
      </button>
    </div>
  )

  return (
    <Modal ref={modalRef} open={open} onClose={onClose} title={isEdit ? 'Edit Bank' : 'Add Bank'} isDirty={isDirty} disableClose={loading} footer={footerEl}>
      <form id="add-bank-form" onSubmit={handleSubmit(onSubmit, focusFirstInvalid)} noValidate className="space-y-4">

        {checkingSchema && (
          <div className="flex items-center gap-2 text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
            <span className="w-3 h-3 border-2 border-gray-400 border-t-transparent rounded-full animate-spin shrink-0" />
            <span>Verifying schema…</span>
          </div>
        )}

        {showMigrationBanner && (
          schemaStuck ? (
            <div className="flex items-start gap-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <div className="flex-1 space-y-1">
                <span>Something went wrong. Please refresh the page and try again.</span>
                {error && <TechDetails>{error}</TechDetails>}
              </div>
            </div>
          ) : schemaStatus === 'cache_stale' ? (
            <div className="flex items-start gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <div className="flex-1 space-y-1">
                <p>Bank setup is not fully configured. Your administrator needs to reload the database schema cache.</p>
                <button
                  type="button"
                  onClick={async () => {
                    setCheckingSchema(true)
                    const status = await checkBankStartingBalanceMigration()
                    setSchemaStatus(status)
                    setCheckingSchema(false)
                  }}
                  className="underline hover:text-amber-900"
                >
                  Re-check now
                </button>
                <TechDetails>{`NOTIFY pgrst, 'reload schema';`}</TechDetails>
              </div>
            </div>
          ) : (
            <div className="flex items-start gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <div className="flex-1 space-y-1">
                <p>Bank setup requires a one-time database migration. Ask your administrator to run the SQL below, then click Re-check.</p>
                <button
                  type="button"
                  onClick={async () => {
                    setCheckingSchema(true)
                    const status = await checkBankStartingBalanceMigration()
                    setSchemaStatus(status)
                    setCheckingSchema(false)
                  }}
                  className="underline hover:text-amber-900"
                >
                  Re-check now
                </button>
                <TechDetails>{MIGRATION_SQL}</TechDetails>
              </div>
            </div>
          )
        )}

        {error && !isSchemaCacheError && !showMigrationBanner && (
          <div className="flex items-start gap-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        <Field label="Bank Name *" error={errors.name?.message}>
          <input
            type="text"
            placeholder="e.g. First Bank of Nigeria"
            {...register('name')}
            className={inputCls(!!errors.name)}
          />
        </Field>

        <Field label="Account Number" error={errors.account_number?.message}>
          <input
            type="text"
            placeholder="e.g. 0123456789"
            {...register('account_number')}
            className={inputCls(!!errors.account_number)}
          />
        </Field>

        <Field label="Account Type" error={errors.account_type?.message}>
          <select {...register('account_type')} className={`${inputCls(!!errors.account_type)} bg-white`}>
            <option value="">— Select type —</option>
            {ACCOUNT_TYPES.map(t => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </Field>

        <Field label="Account Currency">
          <select {...register('currency')} className={`${inputCls(false)} bg-white`}>
            {currencies.map(c => (
              <option key={c.code} value={c.code}>
                {c.flag ? `${c.flag} ` : ''}{c.code} — {c.name}
              </option>
            ))}
          </select>
          {isForeignCurrencyBank && (
            <p className="text-xs text-amber-600 font-medium mt-0.5">
              Foreign Currency Bank — import transactions will be restricted to FX Inflow / FX Outflow types.
            </p>
          )}
        </Field>

        {/* Opening Balance section */}
        <div className="border border-gray-100 rounded-lg p-4 space-y-3 bg-gray-50">
          <p className="text-xs font-semibold text-gray-500">Opening Balance (optional)</p>

          <Field label={`Starting Balance (${selectedCurrencySymbol})`} error={errors.starting_balance?.message}>
            <Controller control={control} name="starting_balance" render={({ field }) => (
              <CurrencyInput value={field.value} onChange={field.onChange} placeholder="0.00" className={inputCls(!!errors.starting_balance)} />
            )} />
          </Field>

          {hasBalance && (
            <div className="space-y-3 pt-1">

              {/* Allocation type toggle */}
              <div className="space-y-1">
                <label className="text-xs font-medium text-gray-600">Allocation Type</label>
                <div className="flex gap-2">
                  {(['percentage', 'amount'] as const).map(t => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setAllocType(t)}
                      className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                        allocType === t
                          ? 'bg-primary text-white border-primary'
                          : 'bg-white text-gray-600 border-gray-300 hover:border-primary'
                      }`}
                    >
                      {t === 'percentage' ? 'Percentage %' : `Amount ${selectedCurrencySymbol}`}
                    </button>
                  ))}
                </div>
              </div>

              {/* Row builder */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-gray-600">Allocations *</label>
                  <span className={`text-xs font-mono font-semibold ${balanced ? 'text-green-600' : 'text-amber-600'}`}>
                    {allocType === 'percentage'
                      ? `${runningTotal.toFixed(1)} / 100%`
                      : `${selectedCurrencySymbol}${runningTotal.toLocaleString()} / ${selectedCurrencySymbol}${(startingBalance ?? 0).toLocaleString()}`}
                  </span>
                </div>

                <div className="border border-gray-200 rounded-lg overflow-hidden">
                  <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_80px_28px_32px] bg-black/[0.02] dark:bg-white/[0.02] px-3 py-2 text-[11px] font-bold text-gray-400 uppercase tracking-widest border-b border-black/[0.06] dark:border-white/[0.07]">
                    <span>Category</span>
                    <span>Portion</span>
                    <span>{allocType === 'percentage' ? '%' : selectedCurrencySymbol}</span>
                    <span title="Count in category balance" className="cursor-help">Count</span>
                    <span />
                  </div>
                  <div className="divide-y divide-gray-100 max-h-52 overflow-y-auto">
                    {rows.map((row, i) => {
                      const inNewMode = newCatMode?.rowIndex === i
                      return (
                        <div key={i} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_80px_28px_32px] items-center px-3 py-1.5 gap-2">

                          {/* Category cell — select or inline-create */}
                          {inNewMode ? (
                            <div className="flex items-center gap-1 min-w-0">
                              <input
                                ref={newCatInputRef}
                                type="text"
                                value={newCatMode!.draft}
                                onChange={e => setNewCatMode(prev => prev ? { ...prev, draft: e.target.value } : null)}
                                onKeyDown={e => {
                                  if (e.key === 'Enter') { e.preventDefault(); confirmNewCategory(i) }
                                  if (e.key === 'Escape') setNewCatMode(null)
                                }}
                                placeholder="Category name"
                                disabled={newCatMode!.saving}
                                className="text-xs px-2 py-1.5 border border-primary rounded outline-none focus:ring-2 focus:ring-primary/30 bg-white min-w-0 flex-1"
                              />
                              <button
                                type="button"
                                onClick={() => confirmNewCategory(i)}
                                disabled={!newCatMode!.draft.trim() || newCatMode!.saving}
                                className="touch-target p-1 rounded text-green-600 hover:bg-green-50 disabled:opacity-40 transition-colors shrink-0"
                              >
                                <Check className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => setNewCatMode(null)}
                                disabled={newCatMode!.saving}
                                className="touch-target p-1 rounded text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors shrink-0"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ) : (
                            <select
                              value={row.category_name}
                              onChange={e => {
                                if (e.target.value === NEW_SENTINEL) {
                                  setNewCatMode({ rowIndex: i, draft: '', saving: false, error: null })
                                } else {
                                  setRowField(i, 'category_name', e.target.value)
                                }
                              }}
                              className="text-xs px-2 py-1.5 border border-gray-200 rounded outline-none focus:ring-2 focus:ring-primary/30 bg-white min-w-0"
                            >
                              <option value="">— Category —</option>
                              {categories.map(c => (
                                <option key={c.id} value={c.name}>{c.name}</option>
                              ))}
                              <option value={NEW_SENTINEL}>+ New category…</option>
                            </select>
                          )}

                          <select
                            value={row.budget_portion}
                            onChange={e => setRowField(i, 'budget_portion', e.target.value)}
                            className="text-xs px-2 py-1.5 border border-gray-200 rounded outline-none focus:ring-2 focus:ring-primary/30 bg-white min-w-0"
                          >
                            <option value="">— Portion —</option>
                            {BUDGET_PORTIONS.map(p => (
                              <option key={p} value={p}>{p}</option>
                            ))}
                          </select>

                          <input
                            type="text"
                            inputMode="decimal"
                            min="0"
                            value={formatCurrency(row.value)}
                            onChange={e => {
                              const raw = e.target.value.replace(/[^0-9.]/g, '')
                              const parts = raw.split('.')
                              const clean = parts.length > 2 ? `${parts[0]}.${parts.slice(1).join('')}` : raw
                              const [int, dec] = clean.split('.')
                              const fmt = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (dec !== undefined ? `.${dec}` : '')
                              setRowField(i, 'value', parseCurrency(fmt) !== undefined ? String(parseCurrency(fmt)) : '')
                            }}
                            placeholder={allocType === 'percentage' ? '0.00' : '0'}
                            className="text-xs px-2 py-1.5 border border-gray-200 rounded outline-none focus:ring-2 focus:ring-primary/30 bg-white w-full"
                          />

                          <input
                            type="checkbox"
                            checked={row.apply_to_category}
                            onChange={e => setRowField(i, 'apply_to_category', e.target.checked)}
                            title={row.apply_to_category
                              ? 'Will be added to category balance'
                              : 'Already in category records — not counted again'}
                            className="w-4 h-4 rounded border-gray-300 text-primary focus:ring-primary/30 cursor-pointer justify-self-center"
                          />

                          <button
                            type="button"
                            onClick={() => removeRow(i)}
                            className="touch-target p-1 rounded text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )
                    })}
                  </div>
                </div>

                {/* Inline new-category error */}
                {newCatMode?.error && (
                  <p className="text-xs text-red-500">{newCatMode.error}</p>
                )}

                <button
                  type="button"
                  onClick={addRow}
                  className="flex items-center gap-1.5 text-xs text-primary hover:text-primary-light font-medium"
                >
                  <Plus className="w-3.5 h-3.5" /> Add row
                </button>

                <p className="text-xs text-gray-500">
                  <span className="font-medium">Count</span>: tick if this amount is new and should be added to the category balance. Untick if it already exists in the category's transaction records.
                </p>
              </div>

              {/* Allocation error / imbalance warning */}
              {(allocError || (!balanced && runningTotal > 0)) && (
                <div className="flex items-center gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                  {allocError ?? (
                    allocType === 'percentage'
                      ? `Total is ${runningTotal.toFixed(1)}% — must equal 100%`
                      : `Total ${selectedCurrencySymbol}${runningTotal.toLocaleString()} doesn't match starting balance ${selectedCurrencySymbol}${(startingBalance ?? 0).toLocaleString()}`
                  )}
                </div>
              )}
            </div>
          )}
        </div>

      </form>
    </Modal>
  )
}

