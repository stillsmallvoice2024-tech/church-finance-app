import { useState, useEffect, useCallback } from 'react'
import {
  ArrowRightLeft, Plus, Pencil, Trash2,
  LayoutGrid, LayoutList, AlertCircle, RefreshCw, X,
  ChevronRight, ChevronDown,
} from 'lucide-react'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Card }         from '../components/ui/Card'
import { Modal }        from '../components/ui/Modal'
import { DeleteDialog } from '../components/ui/DeleteDialog'
import { DescriptionCell, DescriptionTooltip } from '../components/ui/DescriptionCell'
import { useDescriptionExpand } from '../hooks/useDescriptionExpand'
import { RowDetailPanel, type DetailItem } from '../components/ui/RowDetailPanel'
import { usePageTitle } from '../hooks/usePageTitle'
import { useBanks }     from '../hooks/useBanks'
import { useRole }      from '../hooks/useRole'
import { useToastStore } from '../store/toastStore'
import { useAuthStore }  from '../store/authStore'
import { useOrgStore }   from '../store/orgStore'
import { supabase }      from '../lib/supabase'
import { formatDate, formatCurrency } from '../utils/formatters'
import { Field, inputCls, filterInputCls } from '../components/ui/FormField'
import { SearchableSelect } from '../components/ui/SearchableSelect'
import { exportCSV }   from '../utils/csvExport'
import { ExportDropdown } from '../components/ui/ExportDropdown'

// ── Types ──────────────────────────────────────────────────────────────────────

interface TransferRow {
  id:              string
  date:            string
  from_bank_id:    string | null
  from_bank_name:  string | null
  to_bank_id:      string | null
  to_bank_name:    string | null
  amount:          number
  description:     string | null
  transaction_ref: string | null
  remarks:         string | null
}

// ── Modal schema ───────────────────────────────────────────────────────────────

const schema = z.object({
  date:            z.string().min(1, 'Date is required'),
  from_bank_id:    z.string().optional(),
  to_bank_id:      z.string().optional(),
  amount:          z.coerce.number({ invalid_type_error: 'Enter a valid amount' }).positive('Amount must be > 0'),
  description:     z.string().optional(),
  transaction_ref: z.string().optional(),
  remarks:         z.string().optional(),
})
type FormValues = z.infer<typeof schema>

// ── Add/Edit modal ─────────────────────────────────────────────────────────────

function TransferModal({ open, onClose, onSaved, editRecord, banks }: {
  open: boolean
  onClose: () => void
  onSaved: () => void
  editRecord: TransferRow | null
  banks: { id: string; name: string }[]
}) {
  const [saving, setSaving] = useState(false)
  const [err,    setErr]    = useState<string | null>(null)
  const { user } = useAuthStore.getState()

  const { register, handleSubmit, formState: { errors }, reset, control } = useForm<FormValues>({
    resolver: zodResolver(schema),
  })

  useEffect(() => {
    if (!open) return
    setErr(null)
    if (editRecord) {
      reset({
        date:            editRecord.date,
        from_bank_id:    editRecord.from_bank_id    ?? '',
        to_bank_id:      editRecord.to_bank_id      ?? '',
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
    const fromBank = banks.find(b => b.id === values.from_bank_id)
    const toBank   = banks.find(b => b.id === values.to_bank_id)
    const payload = {
      date:            values.date,
      from_bank_id:    values.from_bank_id    || null,
      from_bank_name:  fromBank?.name         ?? null,
      to_bank_id:      values.to_bank_id      || null,
      to_bank_name:    toBank?.name           ?? null,
      amount:          values.amount,
      description:     values.description     || null,
      transaction_ref: values.transaction_ref || null,
      remarks:         values.remarks         || null,
    }
    try {
      if (editRecord) {
        const { error } = await supabase.from('intrabank_transfers').update(payload).eq('id', editRecord.id)
        if (error) throw error
      } else {
        const { orgId } = useOrgStore.getState()
        const row = { ...payload, ...(user?.id ? { created_by: user.id } : {}), ...(orgId ? { org_id: orgId } : {}) }
        const { error } = await supabase.from('intrabank_transfers').insert(row)
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
    <Modal open={open} onClose={onClose} title={editRecord ? 'Edit Transfer' : 'Add Intrabank Transfer'}>
      <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
        {err && <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{err}</div>}
        <div className="grid grid-cols-2 gap-4">
          <Field label="Date *" error={errors.date?.message}>
            <input type="date" {...register('date')} className={inputCls(!!errors.date)} />
          </Field>
          <Field label="Amount (₦) *" error={errors.amount?.message}>
            <input type="number" min="0" step="0.01" placeholder="0.00" {...register('amount')} className={inputCls(!!errors.amount)} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Field label="From Bank" error={errors.from_bank_id?.message}>
            <Controller name="from_bank_id" control={control} render={({ field }) => (
              <SearchableSelect value={field.value ?? ''} onChange={field.onChange}
                options={banks.map(b => ({ value: b.id, label: b.name }))}
                placeholder="— Select —" className={inputCls(false)} />
            )} />
          </Field>
          <Field label="To Bank" error={errors.to_bank_id?.message}>
            <Controller name="to_bank_id" control={control} render={({ field }) => (
              <SearchableSelect value={field.value ?? ''} onChange={field.onChange}
                options={banks.map(b => ({ value: b.id, label: b.name }))}
                placeholder="— Select —" className={inputCls(false)} />
            )} />
          </Field>
        </div>
        <Field label="Description" error={errors.description?.message}>
          <input type="text" placeholder="e.g. Fund movement to operations account" {...register('description')} className={inputCls(false)} />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Transaction Ref">
            <input type="text" placeholder="Ref / ID" {...register('transaction_ref')} className={inputCls(false)} />
          </Field>
          <Field label="Remarks">
            <input type="text" placeholder="Additional notes" {...register('remarks')} className={inputCls(false)} />
          </Field>
        </div>
        <div className="flex justify-end gap-3 pt-2">
          <button type="button" onClick={onClose} disabled={saving}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50">
            Cancel
          </button>
          <button type="submit" disabled={saving}
            className="px-5 py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary-light disabled:opacity-60 flex items-center gap-2">
            {saving && <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
            {saving ? 'Saving…' : editRecord ? 'Save Changes' : 'Save Transfer'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function IntraBankTransfers() {
  usePageTitle('Intrabank Transfers')

  const { banks } = useBanks()
  const { canWrite, canDelete } = useRole()
  const { push: toast } = useToastStore()
  const { tooltip: descTooltip, setTooltip: setDescTooltip } = useDescriptionExpand()

  const [rows,        setRows]        = useState<TransferRow[]>([])
  const [loading,     setLoading]     = useState(true)
  const [error,       setError]       = useState<string | null>(null)
  const [displayMode, setDisplayMode] = useState<'table' | 'cards'>('table')
  const [dateFrom,    setDateFrom]    = useState('')
  const [dateTo,      setDateTo]      = useState('')
  const [bankFilter,  setBankFilter]  = useState('')

  const [modalOpen,   setModalOpen]   = useState(false)
  const [editRecord,  setEditRecord]  = useState<TransferRow | null>(null)
  const [deleteId,    setDeleteId]    = useState<string | null>(null)
  const [deleting,    setDeleting]    = useState(false)
  const [expandedId,  setExpandedId]  = useState<string | null>(null)

  const transferDetailItems = (row: TransferRow): DetailItem[] => [
    { label: 'Transaction Ref',  value: row.transaction_ref, mono: true, breakAll: true },
    { label: 'Remarks',          value: row.remarks,         breakAll: true },
    { label: 'From Bank',        value: row.from_bank_name },
    { label: 'To Bank',          value: row.to_bank_name },
    { label: 'Raw Description',  value: row.description,     breakAll: true },
  ]

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const { data, error: err } = await supabase
      .from('intrabank_transfers')
      .select('*')
      .order('date', { ascending: false })
    if (err) {
      setError(err.message)
    } else {
      setRows((data ?? []) as TransferRow[])
    }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const filtered = rows.filter(r => {
    if (dateFrom    && r.date < dateFrom)    return false
    if (dateTo      && r.date > dateTo)      return false
    if (bankFilter  && r.from_bank_id !== bankFilter && r.to_bank_id !== bankFilter) return false
    return true
  })

  const openAdd  = () => { setEditRecord(null); setModalOpen(true) }
  const openEdit = (r: TransferRow) => { setEditRecord(r); setModalOpen(true) }

  const IBT_CSV_HEADERS = ['Date', 'From Bank', 'To Bank', 'Amount (₦)', 'Description', 'Ref', 'Remarks']
  const ibtCsvRow = (r: TransferRow) => [
    r.date, r.from_bank_name ?? '', r.to_bank_name ?? '', r.amount,
    r.description ?? '', r.transaction_ref ?? '', r.remarks ?? '',
  ]
  const IBT_CSV_FILE = `intrabank-transfers-${new Date().toISOString().slice(0, 10)}.csv`
  const handleExportView = () => exportCSV(IBT_CSV_FILE, IBT_CSV_HEADERS, filtered.map(ibtCsvRow))
  const handleExportAll  = () => exportCSV(IBT_CSV_FILE, IBT_CSV_HEADERS, filtered.map(ibtCsvRow))

  const handleDelete = async () => {
    if (!deleteId) return
    setDeleting(true)
    const { error: err } = await supabase.from('intrabank_transfers').delete().eq('id', deleteId)
    setDeleting(false)
    if (err) { toast(err.message, 'error'); return }
    toast('Transfer deleted', 'success')
    setDeleteId(null)
    load()
  }

  if (error) return (
    <div className="flex flex-col items-center justify-center py-24 gap-4 text-center">
      <AlertCircle className="w-10 h-10 text-danger" />
      <p className="font-semibold text-gray-800">Failed to load intrabank transfers</p>
      <p className="text-sm text-gray-500">{error}</p>
      <button onClick={load} className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary-light">
        <RefreshCw className="w-4 h-4" /> Retry
      </button>
    </div>
  )

  return (
    <>
      <div className="space-y-5">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Intrabank Transfers</h1>
            <p className="text-sm text-gray-500 mt-0.5">Bank-to-bank fund movements</p>
          </div>
          <div className="flex items-center gap-2">
            <ExportDropdown
              onExportView={handleExportView}
              onExportAll={handleExportAll}
              disabled={filtered.length === 0}
            />
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
            {canWrite() && (
              <button onClick={openAdd}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary-light">
                <Plus className="w-4 h-4" /> Add Transfer
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
            <div className="flex flex-col gap-1 min-w-[160px]">
              <label className="text-xs font-medium text-gray-500">Bank</label>
              <SearchableSelect value={bankFilter} onChange={setBankFilter}
                options={banks.map(b => ({ value: b.id, label: b.name }))}
                placeholder="All banks" className={filterInputCls} />
            </div>
            {(dateFrom || dateTo || bankFilter) && (
              <button onClick={() => { setDateFrom(''); setDateTo(''); setBankFilter('') }}
                className="px-3 py-2 text-sm text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg flex items-center gap-1">
                <X className="w-3.5 h-3.5" /> Clear
              </button>
            )}
          </div>
        </Card>

        {/* Summary strip */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {[
            { label: 'Total transfers', value: filtered.length.toLocaleString() },
            { label: 'Total amount',    value: formatCurrency(filtered.reduce((s, r) => s + r.amount, 0)) },
            { label: 'Largest',         value: filtered.length ? formatCurrency(Math.max(...filtered.map(r => r.amount))) : '—' },
          ].map(({ label, value }) => (
            <div key={label} className="bg-white rounded-xl border border-gray-100 shadow-sm px-4 py-3">
              <p className="text-xs text-gray-500 mb-1">{label}</p>
              {loading ? <div className="h-6 bg-gray-200 rounded animate-pulse w-3/4" />
                       : <p className="text-lg font-bold text-gray-900">{value}</p>}
            </div>
          ))}
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
                <div className="py-12 text-center text-gray-400">
                  <ArrowRightLeft className="w-10 h-10 text-gray-200 mx-auto mb-2" />
                  <p className="text-sm">No intrabank transfers found.</p>
                </div>
              ) : filtered.map(row => (
                <div key={row.id} className="rounded-xl border overflow-hidden shadow-sm bg-white border-gray-200">
                  {/* Card header */}
                  <div className="px-4 pt-3.5 pb-3">
                    <p className="text-[11px] font-semibold mb-2 text-gray-400">{formatDate(row.date)}</p>
                    <div className="flex items-center gap-2 text-sm text-gray-700 mb-1">
                      <span className="font-medium truncate">{row.from_bank_name ?? '—'}</span>
                      <ArrowRightLeft className="w-3 h-3 text-gray-400 shrink-0" />
                      <span className="font-medium truncate">{row.to_bank_name ?? '—'}</span>
                    </div>
                    {row.description && (
                      <div className="text-sm mt-1.5">
                        <DescriptionCell id={`card-desc-${row.id}`} text={row.description} tooltip={descTooltip} setTooltip={setDescTooltip} textCls="text-gray-600" />
                      </div>
                    )}
                    {row.transaction_ref && <p className="text-[11px] text-gray-400 font-mono mt-1">{row.transaction_ref}</p>}
                  </div>
                  {/* Metrics footer */}
                  <div className="grid grid-cols-2 border-t border-gray-100 bg-gray-50/40 px-4 py-3">
                    <div className="min-w-0">
                      <p className="text-[10px] uppercase tracking-wide font-semibold mb-0.5 text-gray-500">Transfer</p>
                      <p className="text-sm font-mono font-bold tabular-nums text-primary">{formatCurrency(row.amount)}</p>
                    </div>
                    <div className="border-l border-gray-200/80 pl-4 min-w-0 flex items-center justify-end gap-0.5">
                      {canWrite()  && <button onClick={() => openEdit(row)} className="p-1.5 rounded-lg text-gray-400 hover:text-primary hover:bg-primary/10 transition-colors" title="Edit"><Pencil className="w-3.5 h-3.5" /></button>}
                      {canDelete() && <button onClick={() => setDeleteId(row.id)} className="p-1.5 rounded-lg text-gray-400 hover:text-danger hover:bg-red-50 transition-colors" title="Delete"><Trash2 className="w-3.5 h-3.5" /></button>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="w-8" />
                    {['Date', 'From Bank', 'To Bank', 'Amount (₦)', 'Description', 'Ref', 'Remarks', 'Actions'].map(h => (
                      <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {loading ? (
                    Array.from({ length: 6 }).map((_, i) => (
                      <tr key={i}>{Array.from({ length: 8 }).map((_, j) => (
                        <td key={j} className="px-4 py-3"><div className="h-4 bg-gray-200 rounded animate-pulse" /></td>
                      ))}</tr>
                    ))
                  ) : filtered.length === 0 ? (
                    <tr><td colSpan={8} className="py-16 text-center">
                      <div className="flex flex-col items-center gap-2 text-gray-400">
                        <ArrowRightLeft className="w-10 h-10 text-gray-200" />
                        <p className="text-sm">No intrabank transfers found.</p>
                      </div>
                    </td></tr>
                  ) : filtered.flatMap(row => {
                    const isExpanded = expandedId === row.id
                    return [
                    <tr key={row.id} className="hover:bg-gray-50 transition-colors">
                      <td className="w-8 px-1 py-3">
                        <button
                          onClick={() => setExpandedId(isExpanded ? null : row.id)}
                          className="p-1 rounded text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
                          title={isExpanded ? 'Collapse' : 'Expand details'}
                        >
                          {isExpanded
                            ? <ChevronDown className="w-3.5 h-3.5" />
                            : <ChevronRight className="w-3.5 h-3.5" />}
                        </button>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600 whitespace-nowrap">{formatDate(row.date)}</td>
                      <td className="px-4 py-3 text-sm text-gray-700 whitespace-nowrap">{row.from_bank_name ?? '—'}</td>
                      <td className="px-4 py-3 text-sm text-gray-700 whitespace-nowrap">{row.to_bank_name ?? '—'}</td>
                      <td className="px-4 py-3 text-sm font-semibold text-primary whitespace-nowrap">{formatCurrency(row.amount)}</td>
                      <td className="px-4 py-3 text-sm text-gray-800 max-w-[180px]">
                        <DescriptionCell id={row.id} text={row.description} tooltip={descTooltip} setTooltip={setDescTooltip} />
                      </td>
                      <td className="px-4 py-3 text-sm font-mono text-gray-500 whitespace-nowrap">{row.transaction_ref ?? '—'}</td>
                      <td className="px-4 py-3 text-sm text-gray-500 max-w-[140px]">
                        <DescriptionCell id={`rem-${row.id}`} text={row.remarks} tooltip={descTooltip} setTooltip={setDescTooltip} />
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          {canWrite()  && <button onClick={() => openEdit(row)} className="p-1.5 rounded-lg text-gray-400 hover:text-primary hover:bg-primary/10" title="Edit"><Pencil className="w-4 h-4" /></button>}
                          {canDelete() && <button onClick={() => setDeleteId(row.id)} className="p-1.5 rounded-lg text-gray-400 hover:text-danger hover:bg-red-50" title="Delete"><Trash2 className="w-4 h-4" /></button>}
                        </div>
                      </td>
                    </tr>,
                    isExpanded && <RowDetailPanel key={`${row.id}-detail`} items={transferDetailItems(row)} colSpan={9} />,
                    ]
                  }).filter(Boolean)}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      <TransferModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSaved={() => { toast(editRecord ? 'Transfer updated' : 'Transfer saved', 'success'); load() }}
        editRecord={editRecord}
        banks={banks}
      />
      <DeleteDialog
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={handleDelete}
        loading={deleting}
        label="this intrabank transfer"
      />
      <DescriptionTooltip tooltip={descTooltip} />
    </>
  )
}

