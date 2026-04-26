import { useEffect, useState, useRef } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { AlertTriangle, Terminal, Plus, Trash2, Check, X } from 'lucide-react'
import { Modal } from '../ui/Modal'
import { useAddBank, useUpdateBank, useAddCategory, type AddBankInput } from '../../hooks/useMutations'
import { useCategories } from '../../hooks/useCategories'
import type { DbBank, StartingBalanceRow } from '../../hooks/useBanks'

const ACCOUNT_TYPES = ['Current', 'Savings', 'Fixed Deposit', 'Domiciliary'] as const
const BUDGET_PORTIONS = ['Percentage Allocation', 'Specific Seed', 'Savings'] as const
const NEW_SENTINEL = '__new__'

const MIGRATION_SQL =
`ALTER TABLE banks
  ADD COLUMN IF NOT EXISTS starting_balance          numeric(15,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS starting_balance_category text,
  ADD COLUMN IF NOT EXISTS starting_balance_budget_portion text,
  ADD COLUMN IF NOT EXISTS starting_balance_alloc_type text,
  ADD COLUMN IF NOT EXISTS starting_balance_allocations jsonb NOT NULL DEFAULT '[]';`

const schema = z.object({
  name:             z.string().min(1, 'Bank name is required'),
  account_number:   z.string().optional(),
  account_type:     z.string().optional(),
  starting_balance: z.coerce.number().min(0).optional(),
})

type FormValues = z.infer<typeof schema>
type AllocType  = 'percentage' | 'amount'
interface RowDraft { category_name: string; budget_portion: string; value: string }
interface NewCatMode { rowIndex: number; draft: string; saving: boolean; error: string | null }

interface Props {
  open:        boolean
  onClose:     () => void
  onSuccess?:  () => void
  editRecord?: DbBank | null
}

export function AddBankModal({ open, onClose, onSuccess, editRecord }: Props) {
  const isEdit = !!editRecord
  const { categories, refetch: refetchCategories } = useCategories()

  const addMutation    = useAddBank()
  const updateMutation = useUpdateBank()
  const addCatMutation = useAddCategory()

  const { mutate: add,         loading: adding,   error: addError,    reset: resetAdd    } = addMutation
  const { mutate: update,      loading: updating, error: updateError, reset: resetUpdate } = updateMutation
  const { mutate: addCategory                                                             } = addCatMutation

  const loading = adding || updating
  const error   = addError || updateError

  const [allocType,  setAllocType]  = useState<AllocType>('percentage')
  const [rows,       setRows]       = useState<RowDraft[]>([{ category_name: '', budget_portion: '', value: '' }])
  const [allocError, setAllocError] = useState<string | null>(null)
  const [newCatMode, setNewCatMode] = useState<NewCatMode | null>(null)
  const newCatInputRef = useRef<HTMLInputElement>(null)

  const { register, handleSubmit, formState: { errors }, reset: resetForm, watch } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: '', account_number: '', account_type: '' },
  })

  const startingBalance = watch('starting_balance')
  const hasBalance      = (startingBalance ?? 0) > 0

  const runningTotal = rows.reduce((s, r) => s + (parseFloat(r.value) || 0), 0)
  const target       = allocType === 'percentage' ? 100 : (startingBalance ?? 0)
  const balanced     = !hasBalance || (target > 0 && Math.abs(runningTotal - target) < 0.01)

  const addRow      = () => setRows(prev => [...prev, { category_name: '', budget_portion: '', value: '' }])
  const removeRow   = (i: number) => setRows(prev => prev.filter((_, idx) => idx !== i))
  const setRowField = (i: number, field: keyof RowDraft, val: string) =>
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
    if (editRecord) {
      resetForm({
        name:             editRecord.name,
        account_number:   editRecord.account_number ?? '',
        account_type:     editRecord.account_type   ?? '',
        starting_balance: editRecord.starting_balance ?? undefined,
      })
      const allocs = editRecord.starting_balance_allocations ?? []
      if (allocs.length > 0) {
        const usesPercent = allocs[0].percentage !== undefined
        setAllocType(usesPercent ? 'percentage' : 'amount')
        setRows(allocs.map(r => ({
          category_name:  r.category_name,
          budget_portion: r.budget_portion,
          value:          String(usesPercent ? (r.percentage ?? '') : (r.amount ?? '')),
        })))
      } else if (editRecord.starting_balance_category) {
        // backward-compat: legacy single-field bank
        setAllocType('percentage')
        setRows([{
          category_name:  editRecord.starting_balance_category,
          budget_portion: editRecord.starting_balance_budget_portion ?? '',
          value:          '',
        }])
      } else {
        setAllocType('percentage')
        setRows([{ category_name: '', budget_portion: '', value: '' }])
      }
    } else {
      resetForm({ name: '', account_number: '', account_type: '' })
      setAllocType('percentage')
      setRows([{ category_name: '', budget_portion: '', value: '' }])
    }
  }, [open, editRecord, resetForm, resetAdd, resetUpdate])

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
            : `Allocations total ₦${runningTotal.toLocaleString()} — must equal starting balance ₦${(values.starting_balance ?? 0).toLocaleString()}`
        )
        return
      }
    }

    const validRows = rows.filter(r => r.category_name && r.budget_portion && parseFloat(r.value) > 0)
    const allocations: StartingBalanceRow[] = hasBalance
      ? validRows.map(r => ({
          category_name:  r.category_name,
          budget_portion: r.budget_portion,
          ...(allocType === 'percentage'
            ? { percentage: parseFloat(r.value) }
            : { amount: parseFloat(r.value) }),
        }))
      : []

    const payload: AddBankInput = {
      name:           values.name,
      account_number: values.account_number || undefined,
      account_type:   values.account_type   || undefined,
      starting_balance:             values.starting_balance || undefined,
      starting_balance_alloc_type:  hasBalance ? allocType : undefined,
      starting_balance_allocations: allocations,
    }
    try {
      if (isEdit && editRecord) {
        await update({ id: editRecord.id, ...payload })
      } else {
        await add(payload)
      }
      onSuccess?.()
      onClose()
    } catch { /* surfaced via hook error */ }
  }

  const isMigrationError = !!error && /starting_balance|Could not find|column.*bank/i.test(error)

  return (
    <Modal open={open} onClose={onClose} title={isEdit ? 'Edit Bank' : 'Add Bank'}>
      <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">

        {error && (
          <div className="space-y-2">
            <div className="flex items-start gap-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>
                {isMigrationError
                  ? 'Database migration required — run the SQL below in your Supabase SQL Editor, then try again.'
                  : error}
              </span>
            </div>
            {isMigrationError && (
              <div className="rounded-lg border border-gray-200 bg-gray-900 overflow-hidden">
                <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-800 border-b border-gray-700">
                  <Terminal className="w-3 h-3 text-gray-400" />
                  <span className="text-[10px] text-gray-400 font-mono">Supabase SQL Editor</span>
                </div>
                <pre className="px-3 py-3 text-[11px] text-green-300 font-mono overflow-x-auto whitespace-pre">{MIGRATION_SQL}</pre>
              </div>
            )}
          </div>
        )}

        <Field label="Bank Name *" error={errors.name?.message}>
          <input
            type="text"
            placeholder="e.g. First Bank of Nigeria"
            {...register('name')}
            className={iCls(!!errors.name)}
          />
        </Field>

        <Field label="Account Number" error={errors.account_number?.message}>
          <input
            type="text"
            placeholder="e.g. 0123456789"
            {...register('account_number')}
            className={iCls(!!errors.account_number)}
          />
        </Field>

        <Field label="Account Type" error={errors.account_type?.message}>
          <select {...register('account_type')} className={`${iCls(!!errors.account_type)} bg-white`}>
            <option value="">— Select type —</option>
            {ACCOUNT_TYPES.map(t => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </Field>

        {/* Opening Balance section */}
        <div className="border border-gray-100 rounded-lg p-4 space-y-3 bg-gray-50">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Opening Balance (optional)</p>

          <Field label="Starting Balance (₦)" error={errors.starting_balance?.message}>
            <input
              type="number" min="0" step="0.01" placeholder="0.00"
              {...register('starting_balance')}
              className={iCls(!!errors.starting_balance)}
            />
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
                      {t === 'percentage' ? 'Percentage %' : 'Amount ₦'}
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
                      : `₦${runningTotal.toLocaleString()} / ₦${(startingBalance ?? 0).toLocaleString()}`}
                  </span>
                </div>

                <div className="border border-gray-200 rounded-lg overflow-hidden">
                  <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_80px_32px] bg-gray-50 px-3 py-2 text-xs font-semibold text-gray-500 border-b border-gray-200">
                    <span>Category</span>
                    <span>Portion</span>
                    <span>{allocType === 'percentage' ? '%' : '₦'}</span>
                    <span />
                  </div>
                  <div className="divide-y divide-gray-100 max-h-52 overflow-y-auto">
                    {rows.map((row, i) => {
                      const inNewMode = newCatMode?.rowIndex === i
                      return (
                        <div key={i} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_80px_32px] items-center px-3 py-1.5 gap-2">

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
                                className="p-1 rounded text-green-600 hover:bg-green-50 disabled:opacity-40 transition-colors shrink-0"
                              >
                                <Check className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => setNewCatMode(null)}
                                disabled={newCatMode!.saving}
                                className="p-1 rounded text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors shrink-0"
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
                            type="number"
                            min="0"
                            step={allocType === 'percentage' ? '0.01' : '1'}
                            value={row.value}
                            onChange={e => setRowField(i, 'value', e.target.value)}
                            placeholder={allocType === 'percentage' ? '0.00' : '0'}
                            className="text-xs px-2 py-1.5 border border-gray-200 rounded outline-none focus:ring-2 focus:ring-primary/30 bg-white w-full"
                          />

                          <button
                            type="button"
                            onClick={() => removeRow(i)}
                            className="p-1 rounded text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors"
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
              </div>

              {/* Allocation error / imbalance warning */}
              {(allocError || (!balanced && runningTotal > 0)) && (
                <div className="flex items-center gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                  {allocError ?? (
                    allocType === 'percentage'
                      ? `Total is ${runningTotal.toFixed(1)}% — must equal 100%`
                      : `Total ₦${runningTotal.toLocaleString()} doesn't match starting balance ₦${(startingBalance ?? 0).toLocaleString()}`
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={loading || (hasBalance && !balanced)}
            className="px-5 py-2 text-sm text-white bg-primary rounded-lg hover:bg-primary-light disabled:opacity-60 flex items-center gap-2"
          >
            {loading && <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
            {loading ? 'Saving…' : isEdit ? 'Save Changes' : 'Add Bank'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

function iCls(e: boolean) {
  return `w-full px-3 py-2 text-sm border rounded-lg outline-none focus:ring-2 focus:ring-primary/30 bg-white ${e ? 'border-red-400' : 'border-gray-300 focus:border-primary'}`
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
