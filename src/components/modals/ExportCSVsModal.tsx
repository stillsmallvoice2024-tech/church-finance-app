import { useState, useEffect, useCallback } from 'react'
import { CheckCircle2, XCircle, Loader2, FileDown } from 'lucide-react'
import { Modal } from '../ui/Modal'
import { supabase } from '../../lib/supabase'
import { exportCSV } from '../../utils/csvExport'
import { useOrgCurrency } from '../../hooks/useOrgCurrency'

type ItemStatus = 'pending' | 'running' | 'done' | 'error'

interface ExportItem {
  key:    string
  label:  string
  status: ItemStatus
}

const EXPORT_ITEMS: ExportItem[] = [
  { key: 'inflows',             label: 'Inflows',                  status: 'pending' },
  { key: 'outflows',            label: 'Outflows',                 status: 'pending' },
  { key: 'intra-flows',         label: 'Internal Transfers',       status: 'pending' },
  { key: 'bank-deposits',       label: 'Bank Deposits',            status: 'pending' },
  { key: 'intrabank-transfers', label: 'Intrabank Transfers',      status: 'pending' },
  { key: 'foreign-currency',    label: 'Foreign Currency',         status: 'pending' },
  { key: 'special-projects',    label: 'Special Projects',         status: 'pending' },
  { key: 'project-entries',     label: 'Special Project Entries',  status: 'pending' },
  { key: 'receipts',            label: 'Receipts (metadata)',      status: 'pending' },
  { key: 'bank-ledger',         label: 'Bank Ledger',              status: 'pending' },
  { key: 'category-ledger',     label: 'Category Ledger',          status: 'pending' },
  { key: 'audit-log',           label: 'Audit Log',                status: 'pending' },
]

const Q = (table: string) =>
  supabase.from(table).select('*', { count: 'exact' }).limit(100_000)

async function runExport(key: string, sym: string): Promise<void> {
  const date = new Date().toISOString().slice(0, 10)

  if (key === 'inflows') {
    const { data } = await Q('inflow_transactions').order('date')
    const rows = (data ?? []) as Record<string, unknown>[]
    exportCSV(`inflows-${date}.csv`,
      ['Date','Description',`Amount (${sym})`,'Inflow Type','Stage 1','Stage 2','Stage 3','Txn Ref','FX Currency','Txn Type','Created At'],
      rows.map(r => [r.date, r.description, r.amount, r.inflow_type, r.stage_code_1,
        r.stage_code_2, r.stage_code_3, r.transaction_ref, r.fx_currency, r.transaction_type, r.created_at]))
  }

  else if (key === 'outflows') {
    const { data } = await Q('outflow_transactions').order('date')
    const rows = (data ?? []) as Record<string, unknown>[]
    exportCSV(`outflows-${date}.csv`,
      ['Date','Txn ID','Description',`Disbursed (${sym})`,`Refunded (${sym})`,`Transfer Charge (${sym})`,'Stage 1','Stage 2','Remarks','FX Currency','Txn Type','Created At'],
      rows.map(r => [r.date, r.transaction_id, r.description, r.amount_disbursed,
        r.amount_refunded, r.transfer_charge, r.stage_code_1, r.stage_code_2,
        r.remarks, r.fx_currency, r.transaction_type, r.created_at]))
  }

  else if (key === 'intra-flows') {
    const { data } = await Q('intra_flows').order('date')
    const rows = (data ?? []) as Record<string, unknown>[]
    exportCSV(`intra-flows-${date}.csv`,
      ['Date','From Category','To Category',`Amount (${sym})`,'Description','Transaction Ref','From Stage 1','From Stage 2','To Stage 1','To Stage 2','Remark','Created At'],
      rows.map(r => [r.date, r.account_from, r.account_to, r.total_amount, r.description,
        r.transaction_ref, r.account_from_stage1, r.account_from_stage2,
        r.account_to_stage1, r.account_to_stage2, r.remark, r.created_at]))
  }

  else if (key === 'bank-deposits') {
    const { data } = await Q('bank_deposits').order('date')
    const rows = (data ?? []) as Record<string, unknown>[]
    exportCSV(`bank-deposits-${date}.csv`,
      ['Date','Bank',`Amount (${sym})`,'Description','Transaction Ref','Remarks','Created At'],
      rows.map(r => [r.date, r.bank_name, r.amount, r.description, r.transaction_ref, r.remarks, r.created_at]))
  }

  else if (key === 'intrabank-transfers') {
    const { data } = await Q('intrabank_transfers').order('date')
    const rows = (data ?? []) as Record<string, unknown>[]
    exportCSV(`intrabank-transfers-${date}.csv`,
      ['Date','From Bank','To Bank',`Amount (${sym})`,'Description','Transaction Ref','Remarks','Created At'],
      rows.map(r => [r.date, r.from_bank_name, r.to_bank_name, r.amount,
        r.description, r.transaction_ref, r.remarks, r.created_at]))
  }

  else if (key === 'foreign-currency') {
    const { data } = await Q('fx_transactions').order('date')
    const rows = (data ?? []) as Record<string, unknown>[]
    exportCSV(`foreign-currency-${date}.csv`,
      ['Date','Currency','Narration','Deposit','Withdrawal','Running Balance','Transaction Ref','Created At'],
      rows.map(r => [r.date, r.currency, r.narration, r.deposit, r.withdrawal,
        r.running_balance, r.transaction_ref, r.created_at]))
  }

  else if (key === 'special-projects') {
    const { data } = await Q('special_projects').order('name')
    const rows = (data ?? []) as Record<string, unknown>[]
    exportCSV(`special-projects-${date}.csv`,
      ['Name','Code',`Opening Balance (${sym})`,'Active','Created At'],
      rows.map(r => [r.name, r.code, r.opening_balance, r.is_active, r.created_at]))
  }

  else if (key === 'project-entries') {
    const { data: entries }  = await Q('project_entries').order('date')
    const { data: projects } = await supabase.from('special_projects').select('id, name').limit(10_000)
    const nameMap = new Map((projects ?? []).map((p: Record<string, unknown>) => [p.id, p.name]))
    const rows    = (entries ?? []) as Record<string, unknown>[]
    exportCSV(`special-project-entries-${date}.csv`,
      ['Project','Date','Description',`Inflow (${sym})`,`% Inflow (${sym})`,`Refund/Intraflow (${sym})`,`Outflow (${sym})`,`Balance (${sym})`,'Created At'],
      rows.map(r => [nameMap.get(r.project_id as string) ?? r.project_id, r.date, r.description,
        r.inflow, r.percentage_inflow, r.refund_intraflow, r.outflow, r.balance, r.created_at]))
  }

  else if (key === 'receipts') {
    const { data } = await Q('receipts').order('created_at')
    const rows = (data ?? []) as Record<string, unknown>[]
    exportCSV(`receipts-${date}.csv`,
      ['Entity Type','Entity ID','File Name','File Path','File Size (bytes)','MIME Type','Uploaded By','Created At'],
      rows.map(r => [r.entity_type, r.entity_id, r.file_name, r.file_path,
        r.file_size, r.mime_type, r.uploaded_by, r.created_at]))
  }

  else if (key === 'bank-ledger') {
    const [inflowRes, outflowRes] = await Promise.all([
      supabase.from('inflow_transactions').select('id,date,description,amount,stage_code_1').order('date').limit(100_000),
      supabase.from('outflow_transactions').select('id,date,description,amount_disbursed,stage_code_1').order('date').limit(100_000),
    ])
    type R = Record<string, unknown>
    const merged = [
      ...(inflowRes.data ?? []).map((r: R) => ({ date: r.date, description: r.description, inflow: r.amount, outflow: 0, category: r.stage_code_1, type: 'Inflow' })),
      ...(outflowRes.data ?? []).map((r: R) => ({ date: r.date, description: r.description, inflow: 0, outflow: Number(r.amount_disbursed || 0), category: r.stage_code_1, type: 'Outflow' })),
    ].sort((a, b) => String(a.date).localeCompare(String(b.date)))
    exportCSV(`bank-ledger-${date}.csv`,
      ['Date','Description',`Inflow (${sym})`,`Outflow (${sym})`,'Category','Type'],
      merged.map(r => [r.date, r.description, r.inflow, r.outflow, r.category, r.type]))
  }

  else if (key === 'category-ledger') {
    const [inflowRes, outflowRes] = await Promise.all([
      supabase.from('inflow_transactions').select('date,description,amount,stage_code_1,inflow_type').order('stage_code_1').order('date').limit(100_000),
      supabase.from('outflow_transactions').select('date,description,amount_disbursed,stage_code_1').order('stage_code_1').order('date').limit(100_000),
    ])
    type R = Record<string, unknown>
    const rows = [
      ...(inflowRes.data ?? []).map((r: R) => ({ date: r.date, category: r.stage_code_1 ?? '(none)', description: r.description, inflow: r.amount, outflow: '', type: 'Inflow' })),
      ...(outflowRes.data ?? []).map((r: R) => ({ date: r.date, category: r.stage_code_1 ?? '(none)', description: r.description, inflow: '', outflow: Number(r.amount_disbursed || 0), type: 'Outflow' })),
    ].sort((a, b) => String(a.category).localeCompare(String(b.category)) || String(a.date).localeCompare(String(b.date)))
    exportCSV(`category-ledger-${date}.csv`,
      ['Category','Date','Description',`Inflow (${sym})`,`Outflow (${sym})`,'Type'],
      rows.map(r => [r.category, r.date, r.description, r.inflow, r.outflow, r.type]))
  }

  else if (key === 'audit-log') {
    const { data } = await supabase
      .from('audit_log')
      .select('id,user_id,action,table_name,record_id,created_at,profiles:user_id(full_name,email)')
      .order('created_at', { ascending: false })
      .limit(100_000)
    const rows = (data ?? []) as Record<string, unknown>[]
    exportCSV(`audit-log-${date}.csv`,
      ['Timestamp','Action','Table','Record ID','User Name','User Email'],
      rows.map(r => {
        const p = r.profiles as Record<string, unknown> | null
        return [r.created_at, r.action, r.table_name, r.record_id, p?.full_name ?? '', p?.email ?? '']
      }))
  }
}

interface Props {
  open:    boolean
  onClose: () => void
}

export function ExportCSVsModal({ open, onClose }: Props) {
  const [items,  setItems]  = useState<ExportItem[]>(EXPORT_ITEMS)
  const [done,   setDone]   = useState(false)
  const { baseCurrencySymbol } = useOrgCurrency()

  const setStatus = useCallback((key: string, status: ItemStatus) => {
    setItems(prev => prev.map(it => it.key === key ? { ...it, status } : it))
  }, [])

  useEffect(() => {
    if (!open) return
    setItems(EXPORT_ITEMS)
    setDone(false)

    let cancelled = false
    const sym = baseCurrencySymbol
    ;(async () => {
      for (const item of EXPORT_ITEMS) {
        if (cancelled) return
        setStatus(item.key, 'running')
        try {
          await runExport(item.key, sym)
          if (!cancelled) setStatus(item.key, 'done')
        } catch {
          if (!cancelled) setStatus(item.key, 'error')
        }
      }
      if (!cancelled) setDone(true)
    })()

    return () => { cancelled = true }
  }, [open, setStatus, baseCurrencySymbol])

  const allFinished = items.every(it => it.status === 'done' || it.status === 'error')

  return (
    <Modal
      open={open}
      onClose={() => { if (allFinished) onClose() }}
      title="Export CSVs"
      size="max-w-md"
    >
      <div className="space-y-4">
        <p className="text-sm text-gray-600">
          {done
            ? 'All exports complete. Each file has been downloaded to your device.'
            : 'Exporting data as CSV files. Each file will download automatically.'}
        </p>

        <div className="space-y-1.5 max-h-72 overflow-y-auto">
          {items.map(item => (
            <div key={item.key} className="flex items-center gap-2.5 text-sm">
              {item.status === 'pending' && (
                <div className="w-4 h-4 rounded-full border-2 border-gray-200 shrink-0" />
              )}
              {item.status === 'running' && (
                <Loader2 className="w-4 h-4 text-primary animate-spin shrink-0" />
              )}
              {item.status === 'done' && (
                <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" />
              )}
              {item.status === 'error' && (
                <XCircle className="w-4 h-4 text-red-500 shrink-0" />
              )}
              <span className={item.status === 'error' ? 'text-red-600' : item.status === 'done' ? 'text-gray-700' : 'text-gray-500'}>
                {item.label}
              </span>
            </div>
          ))}
        </div>

        {allFinished && (
          <div className="flex justify-end">
            <button
              onClick={onClose}
              className="flex items-center gap-2 px-4 py-2 text-sm text-white bg-primary rounded-lg hover:bg-primary-light"
            >
              <FileDown className="w-4 h-4" />
              Done
            </button>
          </div>
        )}
      </div>
    </Modal>
  )
}
