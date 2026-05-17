import { useState, useEffect, useCallback } from 'react'
import {
  Landmark, Plus, Pencil, Trash2, ChevronDown, ChevronUp,
  LayoutGrid, LayoutList, AlertCircle, RefreshCw,
} from 'lucide-react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Card }         from '../components/ui/Card'
import { Modal }        from '../components/ui/Modal'
import { DeleteDialog } from '../components/ui/DeleteDialog'
import { usePageTitle } from '../hooks/usePageTitle'
import { useBanks }     from '../hooks/useBanks'
import { useRole }      from '../hooks/useRole'
import { useToastStore } from '../store/toastStore'
import { useAuthStore }  from '../store/authStore'
import { supabase }      from '../lib/supabase'
import { formatDate, formatCurrency } from '../utils/formatters'
import { useDescriptionExpand }    from '../hooks/useDescriptionExpand'
import { DescriptionCell, DescriptionTooltip } from '../components/ui/DescriptionCell'
import { filterInputCls } from '../components/ui/FormField'
import { EmptyState } from '../components/ui/EmptyState'

// ── Types ──────────────────────────────────────────────────────────────────────

interface DepositRow {
  id:              string
  date:            string
  bank_id:         string | null
  bank_name:       string | null
  amount:          number
  description:     string | null
  transaction_ref: string | null
  remarks:         string | null
  source:          'bank_deposits' | 'inflow' | 'outflow'
}

// ── Modal schema ───────────────────────────────────────────────────────────────

const schema = z.object({
  date:            z.string().min(1, 'Date is required'),
  bank_id:         z.string().optional(),
  amount:          z.coerce.number({ invalid_type_error: 'Enter a valid amount' }).positive('Amount must be > 0'),
  description:     z.string().optional(),
  transaction_ref: z.string().optional(),
  remarks:         z.string().optional(),
})
type FormValues = z.infer<typeof schema>

// ── Add/Edit modal ─────────────────────────────────────────────────────────────

function DepositModal({ open, onClose, onSaved, editRecord, banks }: {
  open: boolean
  onClose: () => void
  onSaved: () => void
  editRecord: DepositRow | null
  banks: { id: string; name: string }[]
}) {
  const [saving, setSaving] = useState(false)
  const [err,    setErr]    = useState<string | null>(null)
  const { user } = useAuthStore.getState()

  const { register, handleSubmit, formState: { errors }, reset } = useForm<FormValues>({
    resolver: zodResolver(schema),
  })

  useEffect(() => {
    if (!open) return
    setErr(null)
    if (editRecord) {
      reset({
        date:            editRecord.date,
        bank_id:         editRecord.bank_id         ?? '',
        amount:          editRecord.amount,
        description:     editRecord.description     ?? '',
        transaction_ref: editRecord.transaction_ref ?? '',
        remarks:         editRecord.remarks         ?? '',
      })
    } else {
      reset({ date: new Date().toISOString().slice(0, 10), amount: undefined })
    }
  }, [open, editRecord, reset])

  const onSubmit = async (values: FormValues) => {
    setSaving(true)
    setErr(null)
    try {
      const bankObj = banks.find(b => b.id === values.bank_id)
      const payload = {
        date:            values.date,
        bank_id:         values.bank_id         || null,
        bank_name:       bankObj?.name          || null,
        amount:          values.amount,
        description:     values.description     || null,
        transaction_ref: values.transaction_ref || null,
        remarks:         values.remarks         || null,
        created_by:      user?.id               ?? null,
      }
      if (editRecord) {
        const { error } = await supabase.from('bank_deposits').update(payload).eq('id', editRecord.id)
        if (error) throw error
      } else {
        const { error } = await supabase.from('bank_deposits').insert(payload)
        if (error) throw error
      }
      onSaved()
      onClose()
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={editRecord ? 'Edit Bank Deposit' : 'Add Bank Deposit'}>
      <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
        {err && (
          <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{err}</div>
        )}
        <div className="grid grid-cols-2 gap-4">
          <Field label="Date *" error={errors.date?.message}>
            <input type="date" {...register('date')} className={inputCls(!!errors.date)} />
          </Field>
          <Field label="Amount (₦) *" error={errors.amount?.message}>
            <input type="number" min="0" step="0.01" placeholder="0.00"
              {...register('amount')} className={inputCls(!!errors.amount)} />
          </Field>
        </div>
        <Field label="Bank" error={errors.bank_id?.message}>
          <select {...register('bank_id')} className={inputCls(!!errors.bank_id)}>
            <option value="">— Select Bank —</option>
            {banks.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </Field>
        <Field label="Description" error={errors.description?.message}>
          <input type="text" placeholder="e.g. Sunday offering deposit"
            {...register('description')} className={inputCls(!!errors.description)} />
        </Field>
        <Field label="Transaction Reference" error={errors.transaction_ref?.message}>
          <input type="text" placeholder="Bank reference / teller ID"
            {...register('transaction_ref')} className={inputCls(!!errors.transaction_ref)} />
        </Field>
        <Field label="Remarks" error={errors.remarks?.message}>
          <textarea rows={2} placeholder="Additional notes…"
            {...register('remarks')} className={`${inputCls(!!errors.remarks)} resize-none`} />
        </Field>
        <div className="flex justify-end gap-3 pt-2">
          <button type="button" onClick={onClose} disabled={saving}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50">
            Cancel
          </button>
          <button type="submit" disabled={saving}
            className="px-5 py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary-light disabled:opacity-60 flex items-center gap-2">
            {saving && <Spinner />}
            {saving ? 'Saving…' : editRecord ? 'Save Changes' : 'Add Deposit'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

// ── Main page ──────────────────────────────────────────────────────────────────

export default function BankDeposits() {
  usePageTitle('Bank Deposits')

  const { banks }       = useBanks()
  const { isAdmin }     = useRole()
  const { push }        = useToastStore()
  const admin           = isAdmin()

  const [rows,         setRows]         = useState<DepositRow[]>([])
  const [loading,      setLoading]      = useState(true)
  const [error,        setError]        = useState<string | null>(null)
  const [displayMode,  setDisplayMode]  = useState<'table' | 'cards'>('table')
  const [dateFrom,     setDateFrom]     = useState('')
  const [dateTo,       setDateTo]       = useState('')
  const [bankFilter,   setBankFilter]   = useState('')
  const [showModal,    setShowModal]    = useState(false)
  const [editRecord,   setEditRecord]   = useState<DepositRow | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<DepositRow | null>(null)
  const { tooltip: descTooltip, setTooltip: setDescTooltip } = useDescriptionExpand()
  const [deleting,     setDeleting]     = useState(false)
  const [showRecon,    setShowRecon]    = useState(false)
  const [reconData,    setReconData]    = useState<{ inflowTaggedTotal: number; outflowTaggedTotal: number } | null>(null)
  const [reconLoading, setReconLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const [depRes, inflowRes, outflowRes] = await Promise.all([
      supabase
        .from('bank_deposits')
        .select('id, date, bank_id, bank_name, amount, description, transaction_ref, remarks')
        .order('date', { ascending: false }),
      supabase
        .from('inflow_transactions')
        .select('id, date, bank_name, amount, description, transaction_ref, remark')
        .eq('transaction_type', 'bank_deposit')
        .order('date', { ascending: false }),
      supabase
        .from('outflow_transactions')
        .select('id, date, bank_name, amount_disbursed, description, transaction_id, remarks')
        .eq('transaction_type', 'bank_deposit')
        .order('date', { ascending: false }),
    ])
    if (depRes.error) { setError(depRes.error.message); setLoading(false); return }

    const depositRows: DepositRow[] = (depRes.data ?? []).map(r => ({ ...r, source: 'bank_deposits' as const }))

    const inflowRows: DepositRow[] = (inflowRes.data ?? []).map((r: Record<string, unknown>) => ({
      id:              r.id as string,
      date:            r.date as string,
      bank_id:         null,
      bank_name:       r.bank_name as string | null,
      amount:          r.amount as number,
      description:     r.description as string | null,
      transaction_ref: r.transaction_ref as string | null,
      remarks:         r.remark as string | null,
      source:          'inflow' as const,
    }))

    const outflowRows: DepositRow[] = (outflowRes.data ?? []).map((r: Record<string, unknown>) => ({
      id:              r.id as string,
      date:            r.date as string,
      bank_id:         null,
      bank_name:       r.bank_name as string | null,
      amount:          r.amount_disbursed as number,
      description:     r.description as string | null,
      transaction_ref: r.transaction_id as string | null,
      remarks:         r.remarks as string | null,
      source:          'outflow' as const,
    }))

    const merged = [...depositRows, ...inflowRows, ...outflowRows]
      .sort((a, b) => b.date.localeCompare(a.date))

    setRows(merged)
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const loadRecon = async () => {
    setReconLoading(true)
    const [infRes, outRes] = await Promise.all([
      supabase.from('inflow_transactions').select('amount').eq('transaction_type', 'bank_deposit'),
      supabase.from('outflow_transactions').select('amount_disbursed').eq('transaction_type', 'bank_deposit'),
    ])
    const inflowTaggedTotal  = (infRes.data ?? []).reduce((s, r) => s + (r.amount ?? 0), 0)
    const outflowTaggedTotal = (outRes.data ?? []).reduce((s, r) => s + (r.amount_disbursed ?? 0), 0)
    setReconData({ inflowTaggedTotal, outflowTaggedTotal })
    setReconLoading(false)
  }

  const toggleRecon = () => {
    if (!showRecon && !reconData) loadRecon()
    setShowRecon(v => !v)
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    const { error: err } = await supabase.from('bank_deposits').delete().eq('id', deleteTarget.id)
    setDeleting(false)
    setDeleteTarget(null)
    if (err) { push(err.message, 'error'); return }
    push('Deposit deleted', 'success')
    load()
  }

  const selectedBankName = bankFilter ? (banks.find(b => b.id === bankFilter)?.name ?? null) : null

  const filtered = rows.filter(r => {
    if (dateFrom && r.date < dateFrom) return false
    if (dateTo   && r.date > dateTo)   return false
    if (bankFilter) {
      if (r.source === 'bank_deposits') {
        if (r.bank_id !== bankFilter) return false
      } else {
        if (selectedBankName && r.bank_name !== selectedBankName) return false
      }
    }
    return true
  })

  const totalAmount = filtered.reduce((s, r) => s + r.amount, 0)

  const openAdd  = () => { setEditRecord(null); setShowModal(true) }
  const openEdit = (r: DepositRow) => { setEditRecord(r); setShowModal(true) }

  const colCount = admin ? 8 : 7

  if (error) return (
    <div className="flex flex-col items-center justify-center py-24 gap-4 text-center">
      <AlertCircle className="w-10 h-10 text-danger" />
      <p className="font-semibold text-gray-800">Failed to load bank deposits</p>
      <p className="text-sm text-gray-500">{error}</p>
      <button onClick={load} className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary-light">
        <RefreshCw className="w-4 h-4" /> Retry
      </button>
    </div>
  )

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Bank Deposits</h1>
          <p className="text-sm text-gray-500 mt-0.5">Physical cash deposited into bank accounts</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-0.5 p-1 bg-gray-100 rounded-lg">
            <button onClick={() => setDisplayMode('table')} title="Table view"
              className={`p-1.5 rounded-md transition-colors ${displayMode === 'table' ? 'bg-white shadow-sm text-primary' : 'text-gray-400 hover:text-gray-600'}`}>
              <LayoutList className="w-4 h-4" />
            </button>
            <button onClick={() => setDisplayMode('cards')} title="Card view"
              className={`p-1.5 rounded-md transition-colors ${displayMode === 'cards' ? 'bg-white shadow-sm text-primary' : 'text-gray-400 hover:text-gray-600'}`}>
              <LayoutGrid className="w-4 h-4" />
            </button>
          </div>
          {admin && (
            <button onClick={openAdd}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary-light transition-colors">
              <Plus className="w-4 h-4" /> Add Deposit
            </button>
          )}
        </div>
      </div>

      {/* Filters */}
      <Card>
        <div className="flex flex-wrap gap-3 items-end">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-500">From</label>
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className={filterInputCls} />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-500">To</label>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className={filterInputCls} />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-500">Bank</label>
            <select value={bankFilter} onChange={e => setBankFilter(e.target.value)} className={filterInputCls}>
              <option value="">All banks</option>
              {banks.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
          {(dateFrom || dateTo || bankFilter) && (
            <button onClick={() => { setDateFrom(''); setDateTo(''); setBankFilter('') }}
              className="px-3 py-2 text-sm text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors">
              Clear
            </button>
          )}
        </div>
      </Card>

      {/* Summary strip */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {[
          { label: 'Total deposits', value: filtered.length.toLocaleString() },
          { label: 'Total amount',   value: formatCurrency(totalAmount) },
          { label: 'Avg deposit',    value: filtered.length ? formatCurrency(totalAmount / filtered.length) : '—' },
        ].map(({ label, value }) => (
          <div key={label} className="bg-white rounded-xl border border-gray-100 shadow-sm px-4 py-3">
            <p className="text-xs text-gray-500 mb-1">{label}</p>
            {loading
              ? <div className="h-6 bg-gray-200 rounded animate-pulse w-3/4" />
              : <p className="text-lg font-bold text-gray-900">{value}</p>}
          </div>
        ))}
      </div>

      {/* Reconciliation panel */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <button onClick={toggleRecon}
          className="w-full flex items-center justify-between px-4 py-3 text-sm font-semibold text-gray-700 hover:bg-gray-50 transition-colors">
          <span className="flex items-center gap-2">
            <Landmark className="w-4 h-4 text-primary" />
            Reconciliation — Tagged Inflows vs Tagged Outflows
          </span>
          {showRecon ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
        </button>
        {showRecon && (
          <div className="px-4 pb-4 border-t border-gray-100">
            {reconLoading ? (
              <div className="py-6 flex justify-center">
                <div className="h-5 w-48 bg-gray-200 rounded animate-pulse" />
              </div>
            ) : reconData ? (
              <div className="mt-3 space-y-2">
                <ReconRow label="Inflow rows tagged 'bank_deposit'"  value={reconData.inflowTaggedTotal} />
                <ReconRow label="Outflow rows tagged 'bank_deposit'" value={reconData.outflowTaggedTotal} />
                <div className="border-t border-gray-200 pt-2">
                  <ReconRow label="Net (Inflows − Outflows)" value={reconData.inflowTaggedTotal - reconData.outflowTaggedTotal} highlight />
                </div>
                <button onClick={loadRecon} className="mt-2 text-xs text-primary hover:underline flex items-center gap-1">
                  <RefreshCw className="w-3 h-3" /> Refresh
                </button>
              </div>
            ) : null}
          </div>
        )}
      </div>

      {/* Table / Cards */}
      <Card padding={false}>
        {displayMode === 'cards' ? (
          <div className="p-4 space-y-3">
            {loading ? (
              Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="rounded-xl border border-gray-200 overflow-hidden shadow-sm animate-pulse">
                  <div className="px-4 pt-3.5 pb-3 space-y-2">
                    <div className="h-3 bg-gray-200 rounded w-1/4" />
                    <div className="h-4 bg-gray-200 rounded w-3/4" />
                  </div>
                  <div className="border-t border-gray-100 bg-gray-50/40 px-4 py-3 grid grid-cols-2 gap-4">
                    <div className="h-8 bg-gray-200 rounded" /><div className="h-8 bg-gray-200 rounded" />
                  </div>
                </div>
              ))
            ) : filtered.length === 0 ? (
              <EmptyState icon={Landmark} title="No bank deposits found." compact />
            ) : filtered.map(row => (
              <div key={`${row.source}-${row.id}`} className="rounded-xl border overflow-hidden shadow-sm bg-white border-gray-200">
                {/* Card header */}
                <div className="px-4 pt-3.5 pb-3">
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <p className="text-[11px] font-semibold text-gray-400">{formatDate(row.date)}</p>
                    <SourceBadge source={row.source} />
                  </div>
                  {row.bank_name && <p className="text-[11px] text-gray-400 mb-1.5">{row.bank_name}</p>}
                  {row.description && (
                    <div className="text-sm mb-1">
                      <DescriptionCell id={`card-desc-${row.id}`} text={row.description} tooltip={descTooltip} setTooltip={setDescTooltip} textCls="text-gray-800" />
                    </div>
                  )}
                  {row.transaction_ref && <p className="text-[11px] text-gray-400 font-mono">Ref: {row.transaction_ref}</p>}
                  {row.remarks && (
                    <div className="text-xs mt-1.5">
                      <DescriptionCell id={`card-rem-${row.id}`} text={row.remarks} tooltip={descTooltip} setTooltip={setDescTooltip} textCls="text-gray-400" />
                    </div>
                  )}
                </div>
                {/* Metrics footer */}
                <div className="grid grid-cols-2 border-t border-gray-100 bg-gray-50/40 px-4 py-3">
                  <div className="min-w-0">
                    <p className="text-[10px] uppercase tracking-wide font-semibold mb-0.5 text-gray-500">Amount</p>
                    <p className="text-sm font-mono font-bold tabular-nums text-gray-900">{formatCurrency(row.amount)}</p>
                  </div>
                  {admin && row.source === 'bank_deposits' ? (
                    <div className="border-l border-gray-200/80 pl-4 min-w-0 flex items-center justify-end gap-0.5">
                      <button onClick={() => openEdit(row)} className="p-1.5 rounded hover:bg-primary/10 text-gray-400 hover:text-primary transition-colors" title="Edit">
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => setDeleteTarget(row)} className="p-1.5 rounded hover:bg-red-50 text-gray-400 hover:text-danger transition-colors" title="Delete">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ) : (
                    <div className="border-l border-gray-200/80 pl-4 min-w-0" />
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead>
                <tr className="border-b border-gray-100">
                  {['Date', 'Bank', 'Amount (₦)', 'Description', 'Transaction Ref', 'Remarks', 'Source', ...(admin ? ['Actions'] : [])].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {loading ? (
                  Array.from({ length: 6 }).map((_, i) => (
                    <tr key={i}>{Array.from({ length: colCount }).map((_, j) => (
                      <td key={j} className="px-4 py-3"><div className="h-4 bg-gray-200 rounded animate-pulse" /></td>
                    ))}</tr>
                  ))
                ) : filtered.length === 0 ? (
                  <tr><td colSpan={colCount} className="py-16 text-center">
                    <div className="flex flex-col items-center gap-2 text-gray-400">
                      <Landmark className="w-10 h-10 text-gray-200" />
                      <p className="text-sm">No bank deposits found.</p>
                    </div>
                  </td></tr>
                ) : filtered.map(row => (
                  <tr key={`${row.source}-${row.id}`} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 text-sm text-gray-600 whitespace-nowrap">{formatDate(row.date)}</td>
                    <td className="px-4 py-3 text-sm text-gray-700 whitespace-nowrap">{row.bank_name ?? '—'}</td>
                    <td className="px-4 py-3 text-sm font-semibold text-gray-900 whitespace-nowrap">{formatCurrency(row.amount)}</td>
                    <td className="px-4 py-3 text-sm text-gray-700 max-w-[200px]">
                      <DescriptionCell id={`${row.source}-${row.id}`} text={row.description} tooltip={descTooltip} setTooltip={setDescTooltip} />
                    </td>
                    <td className="px-4 py-3 text-sm font-mono text-gray-500 whitespace-nowrap">{row.transaction_ref ?? '—'}</td>
                    <td className="px-4 py-3 text-sm text-gray-500 max-w-[160px]">
                      <DescriptionCell id={`rem-${row.source}-${row.id}`} text={row.remarks} tooltip={descTooltip} setTooltip={setDescTooltip} />
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <SourceBadge source={row.source} />
                    </td>
                    {admin && (
                      <td className="px-4 py-3">
                        {row.source === 'bank_deposits' && (
                          <div className="flex items-center gap-1">
                            <button onClick={() => openEdit(row)} className="p-1.5 rounded hover:bg-gray-100 text-gray-400 hover:text-primary transition-colors">
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button onClick={() => setDeleteTarget(row)} className="p-1.5 rounded hover:bg-red-50 text-gray-400 hover:text-danger transition-colors">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <DepositModal
        open={showModal}
        onClose={() => setShowModal(false)}
        onSaved={() => { push(editRecord ? 'Deposit updated' : 'Deposit added', 'success'); load() }}
        editRecord={editRecord}
        banks={banks}
      />

      <DeleteDialog
        open={!!deleteTarget}
        label={deleteTarget ? `deposit of ${formatCurrency(deleteTarget.amount)} on ${formatDate(deleteTarget.date)}` : 'this record'}
        loading={deleting}
        onConfirm={handleDelete}
        onClose={() => setDeleteTarget(null)}
      />
      <DescriptionTooltip tooltip={descTooltip} />
    </div>
  )
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const SOURCE_LABEL: Record<DepositRow['source'], string> = {
  bank_deposits: 'Deposit',
  inflow:        'Inflow',
  outflow:       'Outflow',
}
const SOURCE_CLS: Record<DepositRow['source'], string> = {
  bank_deposits: 'bg-primary/10 text-primary',
  inflow:        'bg-green-100 text-green-700',
  outflow:       'bg-red-100 text-red-700',
}

function SourceBadge({ source }: { source: DepositRow['source'] }) {
  return (
    <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${SOURCE_CLS[source]}`}>
      {SOURCE_LABEL[source]}
    </span>
  )
}

function ReconRow({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  const isNonZero = value !== 0
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-gray-600">{label}</span>
      <span className={`font-semibold ${highlight && isNonZero ? 'text-amber-600' : 'text-gray-900'}`}>
        {formatCurrency(value)}
      </span>
    </div>
  )
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

function inputCls(hasError: boolean) {
  return `w-full px-3 py-2 text-sm border rounded-lg outline-none transition-colors focus:ring-2 focus:ring-primary/30 bg-white ${
    hasError ? 'border-red-400 focus:border-red-400' : 'border-gray-300 focus:border-primary'
  }`
}

