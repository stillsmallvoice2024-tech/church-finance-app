import { useState, useMemo } from 'react'
import {
  ArrowRight, RefreshCw, AlertCircle, AlertTriangle,
  CheckSquare, Square,
} from 'lucide-react'
import { Card } from '../components/ui/Card'
import { useCategories, type BudgetPortion } from '../hooks/useCategories'
import { useReportEngine } from '../hooks/useReportEngine'
import { useAuthStore } from '../store/authStore'
import { useOrgStore }  from '../store/orgStore'
import { useToastStore } from '../store/toastStore'
import { useTransactionSyncStore } from '../store/transactionSyncStore'
import { supabase } from '../lib/supabase'
import { formatCurrency } from '../utils/formatters'
import { friendlyError } from '../utils/friendlyError'
import { filterInputCls } from '../components/ui/FormField'
import type { ReportCategoryBalance } from '../types'
import { useOrgCurrency } from '../hooks/useOrgCurrency'
import { allocatePercent } from '../utils/financeMath'

// ── Constants ──────────────────────────────────────────────────────────────────

const PORTIONS: BudgetPortion[] = ['Percentage Allocation', 'Specific Seed', 'Savings']
const PORTION_LABELS: Record<string, string> = {
  'Percentage Allocation': 'Regular Funds',
  'Specific Seed':         'Designated Gift',
  Savings:                 'Savings Funds',
}

type Mode = 'full' | 'percentage' | 'fixed'
type Step = 'configure' | 'preview'

interface CatRow {
  id:          string
  name:        string
  srcBalance:  number
  dstBalance:  number
  amount:      number
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function getPortionBalance(bal: ReportCategoryBalance, portion: BudgetPortion): number {
  if (portion === 'Percentage Allocation') return bal.percentageAllocated
  if (portion === 'Specific Seed')         return bal.specificSeed
  return bal.savingsNet
}

function computeAmount(srcBalance: number, mode: Mode, pct: number, fixed: number): number {
  const raw =
    mode === 'full'       ? srcBalance :
    mode === 'percentage' ? allocatePercent(srcBalance, pct) :
    fixed
  return Math.max(0, Math.min(raw, srcBalance))
}

// ── Execution ──────────────────────────────────────────────────────────────────

async function executeBulkReallocation(params: {
  rows:          CatRow[]
  sourcePortion: BudgetPortion
  destPortion:   BudgetPortion
  date:          string
  description:   string
}): Promise<number> {
  const { user } = useAuthStore.getState()
  const { orgId } = useOrgStore.getState()
  if (!user?.id) throw new Error('You must be signed in.')

  const batchId = crypto.randomUUID()
  const names = params.rows.map(r => r.name)

  const { data: catData } = await supabase
    .from('categories')
    .select('id, name')
    .eq('org_id', orgId ?? '')
    .in('name', names)

  const catMap = new Map((catData ?? []).map(c => [c.name as string, c.id as string]))

  const insertRows = params.rows
    .filter(r => r.amount > 0)
    .map(r => ({
      date:                params.date,
      account_from:        r.name,
      account_from_stage2: params.sourcePortion,
      account_to:          r.name,
      account_to_stage2:   params.destPortion,
      total_amount:        r.amount,
      from_category_id:    catMap.get(r.name) ?? null,
      to_category_id:      catMap.get(r.name) ?? null,
      description:         params.description,
      transfer_type:       'bulk_reallocation',
      ...(orgId ? { org_id: orgId } : {}),
      batch_id:            batchId,
      status:              'active',
      created_by:          user.id,
    }))

  if (insertRows.length === 0) throw new Error('No valid transfers to execute.')

  const { data: inserted, error } = await supabase
    .from('intra_flows')
    .insert(insertRows)
    .select('id')

  if (error) throw new Error(error.message)

  return (inserted ?? []).length
}

// ── Component ──────────────────────────────────────────────────────────────────

export default function BulkReallocation() {
  const { baseCurrencySymbol, baseCurrencyCode } = useOrgCurrency()
  const { categories, loading: catLoading } = useCategories()
  const { push: toast } = useToastStore()

  const today = new Date().toISOString().slice(0, 10)
  const { balances: reportBalances, loading: balLoading, error: balError, refetch: refetchBalances } =
    useReportEngine(today)

  const [srcPortion, setSrcPortion] = useState<BudgetPortion>('Percentage Allocation')
  const [dstPortion, setDstPortion] = useState<BudgetPortion>('Savings')
  const [mode,       setMode]       = useState<Mode>('full')
  const [pct,        setPct]        = useState(100)
  const [fixedAmt,   setFixedAmt]   = useState(0)

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [step,        setStep]        = useState<Step>('configure')
  const [date,        setDate]        = useState(today)
  const [description, setDescription] = useState('')
  const [executing,   setExecuting]   = useState(false)

  const tableRows = useMemo((): CatRow[] =>
    categories.map(cat => {
      const bal = reportBalances.get(cat.name)
      const srcBalance = bal ? getPortionBalance(bal, srcPortion) : 0
      const dstBalance = bal ? getPortionBalance(bal, dstPortion) : 0
      return {
        id:         cat.id,
        name:       cat.name,
        srcBalance,
        dstBalance,
        amount:     computeAmount(srcBalance, mode, pct, fixedAmt),
      }
    }),
    [categories, reportBalances, srcPortion, dstPortion, mode, pct, fixedAmt],
  )

  const selectedRows = useMemo(
    () => tableRows.filter(r => selectedIds.has(r.id)),
    [tableRows, selectedIds],
  )
  const totalAmount = useMemo(
    () => selectedRows.reduce((s, r) => s + r.amount, 0),
    [selectedRows],
  )

  const allSelected  = categories.length > 0 && selectedIds.size === categories.length
  const someSelected = selectedIds.size > 0 && !allSelected

  const toggleAll = () => {
    if (allSelected || someSelected) setSelectedIds(new Set())
    else setSelectedIds(new Set(categories.map(c => c.id)))
  }

  const toggleRow = (id: string) =>
    setSelectedIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })

  const handlePreview = () => {
    if (srcPortion === dstPortion) { toast('Source and destination portions must differ.', 'error'); return }
    if (selectedIds.size === 0)    { toast('Select at least one category.', 'error'); return }
    if (selectedRows.every(r => r.amount <= 0)) { toast('No positive amounts to transfer.', 'error'); return }
    if (!description) setDescription(`Bulk reallocation: ${srcPortion} → ${dstPortion}`)
    setStep('preview')
  }

  const handleExecute = async () => {
    const validRows = selectedRows.filter(r => r.amount > 0)
    if (validRows.length === 0) { toast('No valid transfers to execute.', 'error'); return }
    setExecuting(true)
    try {
      const count = await executeBulkReallocation({
        rows:          validRows,
        sourcePortion: srcPortion,
        destPortion:   dstPortion,
        date,
        description,
      })
      useTransactionSyncStore.getState().bumpIntraflow()
      refetchBalances()
      toast(`Bulk reallocation complete — ${count} transfer${count === 1 ? '' : 's'} created.`, 'success')
      setStep('configure')
      setSelectedIds(new Set())
    } catch (e) {
      toast(friendlyError(e, 'execute the reallocation'), 'error')
    } finally {
      setExecuting(false)
    }
  }

  // ── Loading state ────────────────────────────────────────────────────────────

  if (catLoading) return (
    <div className="space-y-3">
      {[1, 2, 3].map(i => <div key={i} className="h-12 bg-gray-100 rounded-xl animate-pulse" />)}
    </div>
  )

  // ── Preview step ─────────────────────────────────────────────────────────────

  if (step === 'preview') {
    const validRows = selectedRows.filter(r => r.amount > 0)
    const skipped   = selectedRows.filter(r => r.amount <= 0)
    const willZero  = validRows.filter(r => Math.abs(r.srcBalance - r.amount) < 0.005)

    return (
      <div className="space-y-5">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Preview Reallocation</h2>
            <p className="text-sm text-gray-500">Review before confirming</p>
          </div>
          <button
            onClick={() => setStep('configure')}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            ← Back
          </button>
        </div>

        {/* Config summary */}
        <Card>
          <div className="flex flex-wrap gap-4 items-center text-sm">
            <div className="flex items-center gap-2">
              <span className="text-gray-500">From:</span>
              <span className="font-semibold text-gray-800 bg-gray-100 px-2 py-0.5 rounded">{srcPortion}</span>
            </div>
            <ArrowRight className="w-4 h-4 text-gray-400 shrink-0" />
            <div className="flex items-center gap-2">
              <span className="text-gray-500">To:</span>
              <span className="font-semibold bg-primary/10 text-primary px-2 py-0.5 rounded">{dstPortion}</span>
            </div>
            <div className="ml-auto flex items-center gap-4 text-xs text-gray-500">
              <span>{validRows.length} category{validRows.length !== 1 ? 'ies' : 'y'}</span>
              <span className="font-bold text-primary">{formatCurrency(totalAmount, baseCurrencyCode)}</span>
            </div>
          </div>
        </Card>

        {/* Date + Description */}
        <Card>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-gray-600">Date</label>
              <input
                type="date"
                value={date}
                onChange={e => setDate(e.target.value)}
                className={filterInputCls}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-gray-600">Description</label>
              <input
                type="text"
                value={description}
                onChange={e => setDescription(e.target.value)}
                className={filterInputCls}
                placeholder="Transfer description"
              />
            </div>
          </div>
        </Card>

        {/* Category preview table */}
        <Card padding={false}>
          <div className="overflow-x-auto scroll-x-fade">
            <table className="min-w-full">
              <thead>
                <tr className="border-b border-gray-100">
                  {['Category', 'Source Balance', 'Amount to Move', 'Dest Balance (after)', ''].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {validRows.map(row => {
                  const goesZero = Math.abs(row.srcBalance - row.amount) < 0.005
                  return (
                    <tr key={row.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-sm font-medium text-gray-800">{row.name}</td>
                      <td className="px-4 py-3 text-sm font-mono text-right text-gray-600 whitespace-nowrap">
                        {formatCurrency(row.srcBalance, baseCurrencyCode)}
                      </td>
                      <td className="px-4 py-3 text-sm font-mono font-semibold text-right text-primary whitespace-nowrap">
                        {formatCurrency(row.amount, baseCurrencyCode)}
                      </td>
                      <td className="px-4 py-3 text-sm font-mono text-right text-gray-600 whitespace-nowrap">
                        {formatCurrency(row.dstBalance + row.amount, baseCurrencyCode)}
                      </td>
                      <td className="px-4 py-3 text-right pr-4">
                        {goesZero && (
                          <span className="inline-flex items-center gap-1 text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5 whitespace-nowrap">
                            <AlertTriangle className="w-3 h-3" /> Zero after
                          </span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-gray-200 bg-gray-50 font-bold">
                  <td className="px-4 py-3 text-sm text-gray-700">Total</td>
                  <td />
                  <td className="px-4 py-3 text-sm font-mono text-right text-primary whitespace-nowrap">
                    {formatCurrency(totalAmount, baseCurrencyCode)}
                  </td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            </table>
          </div>
        </Card>

        {/* Warnings */}
        {willZero.length > 0 && (
          <div className="flex gap-2 items-start px-4 py-3 rounded-lg bg-amber-50 border border-amber-200 text-sm text-amber-700">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>
              {willZero.length} {willZero.length === 1 ? 'category' : 'categories'} will reach zero in <strong>{srcPortion}</strong> after this move.
            </span>
          </div>
        )}
        {skipped.length > 0 && (
          <div className="flex gap-2 items-start px-4 py-3 rounded-lg bg-gray-50 border border-gray-200 text-sm text-gray-500">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>
              {skipped.length} {skipped.length === 1 ? 'category was' : 'categories were'} skipped — zero or insufficient balance in source portion.
            </span>
          </div>
        )}

        {/* Actions */}
        <div className="flex justify-end gap-3">
          <button
            onClick={() => setStep('configure')}
            disabled={executing}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleExecute}
            disabled={executing || validRows.length === 0}
            className="px-5 py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary-light disabled:opacity-60 flex items-center gap-2"
          >
            {executing && <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
            {executing ? 'Executing…' : `Confirm — ${validRows.length} Transfer${validRows.length !== 1 ? 's' : ''}`}
          </button>
        </div>
      </div>
    )
  }

  // ── Configure step ───────────────────────────────────────────────────────────

  const portionsDiffer = srcPortion !== dstPortion

  return (
    <div className="space-y-5">

      {/* Controls */}
      <Card>
        <div className="flex flex-wrap gap-4 items-end">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-500">Source Portion</label>
            <select
              value={srcPortion}
              onChange={e => setSrcPortion(e.target.value as BudgetPortion)}
              className={`${filterInputCls} bg-white`}
            >
              {PORTIONS.map(p => <option key={p} value={p}>{PORTION_LABELS[p] ?? p}</option>)}
            </select>
          </div>

          <ArrowRight className="w-4 h-4 text-gray-400 self-end mb-2.5 shrink-0" />

          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-500">Destination Portion</label>
            <select
              value={dstPortion}
              onChange={e => setDstPortion(e.target.value as BudgetPortion)}
              className={`${filterInputCls} bg-white`}
            >
              {PORTIONS.map(p => <option key={p} value={p}>{PORTION_LABELS[p] ?? p}</option>)}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-500">Mode</label>
            <select
              value={mode}
              onChange={e => setMode(e.target.value as Mode)}
              className={`${filterInputCls} bg-white`}
            >
              <option value="full">Full Balance</option>
              <option value="percentage">Percentage</option>
              <option value="fixed">Fixed Amount</option>
            </select>
          </div>

          {mode === 'percentage' && (
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-gray-500">Percentage (%)</label>
              <input
                type="text" inputMode="decimal"
                min={0}
                max={100}
                step={1}
                value={pct}
                onChange={e => setPct(Math.min(100, Math.max(0, Number(e.target.value))))}
                className={`${filterInputCls} w-24`}
              />
            </div>
          )}

          {mode === 'fixed' && (
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-gray-500">Amount ({baseCurrencySymbol})</label>
              <input
                type="text" inputMode="decimal"
                min={0}
                step={0.01}
                value={fixedAmt}
                onChange={e => setFixedAmt(Math.max(0, Number(e.target.value)))}
                className={`${filterInputCls} w-36`}
              />
            </div>
          )}

          {!portionsDiffer && (
            <p className="text-xs text-danger self-end mb-2.5">Source and destination must differ</p>
          )}

          <button
            onClick={refetchBalances}
            disabled={balLoading}
            title="Refresh balances" aria-label="Refresh balances"
            className="self-end mb-0.5 p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${balLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </Card>

      {balError && (
        <div className="flex gap-2 items-center px-4 py-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {balError}
        </div>
      )}

      {/* Summary strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Categories', value: categories.length.toLocaleString(), color: 'text-gray-900' },
          { label: 'Selected',   value: selectedIds.size.toLocaleString(),  color: 'text-primary' },
          { label: 'With balance', value: tableRows.filter(r => r.srcBalance > 0).length.toLocaleString(), color: 'text-gray-700' },
          { label: 'Total to Move', value: formatCurrency(totalAmount, baseCurrencyCode), color: 'text-primary' },
        ].map(({ label, value, color }) => (
          <div key={label} className="bg-white rounded-xl border border-gray-100 shadow-sm px-4 py-3 min-w-0">
            <p className="text-xs text-gray-500 mb-1 truncate">{label}</p>
            {balLoading
              ? <div className="h-6 bg-gray-200 rounded animate-pulse w-3/4" />
              : <p className={`text-base font-bold tabular-nums ${color}`}>{value}</p>
            }
          </div>
        ))}
      </div>

      {/* Category table */}
      <Card padding={false}>
        <div className="overflow-x-auto scroll-x-fade">
          <table className="min-w-full">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="w-10 px-3 py-3">
                  <button
                    onClick={toggleAll}
                    className="text-gray-400 hover:text-primary transition-colors flex items-center justify-center"
                    title={allSelected ? 'Deselect all' : 'Select all'}
                  >
                    {allSelected
                      ? <CheckSquare className="w-4 h-4 text-primary" />
                      : someSelected
                        ? <div className="w-4 h-4 border-2 border-primary rounded bg-primary/30" />
                        : <Square className="w-4 h-4" />
                    }
                  </button>
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">
                  Category
                </th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 whitespace-nowrap">
                  {srcPortion} Balance
                </th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 whitespace-nowrap">
                  {dstPortion} Balance
                </th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 whitespace-nowrap">
                  Amount to Move
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {balLoading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: 5 }).map((_, j) => (
                      <td key={j} className="px-4 py-3">
                        <div className="h-4 bg-gray-200 rounded animate-pulse" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : tableRows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-12 text-center text-sm text-gray-400">
                    No categories found.
                  </td>
                </tr>
              ) : (
                tableRows.map(row => {
                  const isSelected = selectedIds.has(row.id)
                  const willGoZero = isSelected && row.amount > 0 && Math.abs(row.srcBalance - row.amount) < 0.005
                  return (
                    <tr
                      key={row.id}
                      onClick={() => toggleRow(row.id)}
                      className={`cursor-pointer transition-colors hover:bg-gray-50 ${isSelected ? 'bg-primary/5' : ''}`}
                    >
                      <td className="w-10 px-3 py-3 text-center">
                        {isSelected
                          ? <CheckSquare className="w-4 h-4 text-primary mx-auto" />
                          : <Square className="w-4 h-4 text-gray-300 mx-auto" />
                        }
                      </td>
                      <td className="px-4 py-3 text-sm font-medium text-gray-800">
                        <div className="flex items-center gap-2">
                          {row.name}
                          {willGoZero && (
                            <span
                              title="Source balance will become zero"
                              className="inline-flex items-center gap-0.5 text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded px-1 py-0.5 whitespace-nowrap"
                            >
                              <AlertTriangle className="w-2.5 h-2.5" /> Zero
                            </span>
                          )}
                        </div>
                      </td>
                      <td className={`px-4 py-3 text-sm font-mono text-right whitespace-nowrap ${row.srcBalance < 0 ? 'text-danger' : row.srcBalance === 0 ? 'text-gray-400' : 'text-gray-700'}`}>
                        {formatCurrency(row.srcBalance, baseCurrencyCode)}
                      </td>
                      <td className="px-4 py-3 text-sm font-mono text-right text-gray-500 whitespace-nowrap">
                        {formatCurrency(row.dstBalance, baseCurrencyCode)}
                      </td>
                      <td className={`px-4 py-3 text-sm font-mono font-semibold text-right whitespace-nowrap ${isSelected && row.amount > 0 ? 'text-primary' : 'text-gray-300'}`}>
                        {isSelected ? formatCurrency(row.amount, baseCurrencyCode) : '—'}
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Action */}
      <div className="flex justify-end">
        <button
          onClick={handlePreview}
          disabled={selectedIds.size === 0 || !portionsDiffer || balLoading}
          className="px-5 py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary-light disabled:opacity-50 flex items-center gap-2 transition-colors"
        >
          Preview <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}
