import { useState, useEffect, useCallback } from 'react'
import { AlertTriangle, CheckCircle2, XCircle, Loader2, Trash2, ShieldAlert } from 'lucide-react'
import { Modal } from '../ui/Modal'
import { supabase } from '../../lib/supabase'
import { exportCSV } from '../../utils/csvExport'
import { useOrgCurrency } from '../../hooks/useOrgCurrency'
import { useOrgStore } from '../../store/orgStore'

// ── Types ──────────────────────────────────────────────────────────────────────

type Step = 'exporting' | 'confirm1' | 'confirm2' | 'deleting'
type ItemStatus = 'pending' | 'running' | 'done' | 'error'

interface ExportItem {
  key:    string
  label:  string
  status: ItemStatus
}

const INITIAL_EXPORTS: ExportItem[] = [
  { key: 'inflows',               label: 'Inflows',                   status: 'pending' },
  { key: 'outflows',              label: 'Outflows',                  status: 'pending' },
  { key: 'intra-flows',           label: 'Fund-to-Fund Transfer',        status: 'pending' },
  { key: 'bank-deposits',         label: 'Bank Deposits',             status: 'pending' },
  { key: 'intrabank-transfers',   label: 'Intrabank Transfers',       status: 'pending' },
  { key: 'foreign-currency',      label: 'Foreign Currency',          status: 'pending' },
  { key: 'special-projects',      label: 'Special Projects',          status: 'pending' },
  { key: 'project-entries',       label: 'Special Project Entries',   status: 'pending' },
  { key: 'receipts',              label: 'Receipts (metadata)',        status: 'pending' },
  { key: 'bank-ledger',           label: 'Bank Ledger',               status: 'pending' },
  { key: 'category-ledger',       label: 'Fund Ledger',           status: 'pending' },
  { key: 'audit-log',             label: 'Audit Log',                 status: 'pending' },
]

// ── Helpers ────────────────────────────────────────────────────────────────────

const ALL = { count: 'exact' as const }
const Q   = (table: string, orgId: string) =>
  supabase.from(table).select('*', ALL).eq('org_id', orgId).limit(100_000)

async function runExport(key: string, sym: string, orgId: string): Promise<void> {
  const date = new Date().toISOString().slice(0, 10)

  if (key === 'inflows') {
    const { data } = await Q('inflow_transactions', orgId).order('date')
    const rows = (data ?? []) as Record<string, unknown>[]
    exportCSV(`inflows-${date}.csv`,
      ['Date','Description',`Amount (${sym})`,'Inflow Type','Stage 1','Stage 2','Stage 3','Txn Ref','FX Currency','Txn Type','Created At'],
      rows.map(r => [r.date, r.description, r.amount, r.inflow_type, r.stage_code_1,
        r.stage_code_2, r.stage_code_3, r.transaction_ref, r.fx_currency, r.transaction_type, r.created_at]))
  }

  else if (key === 'outflows') {
    const { data } = await Q('outflow_transactions', orgId).order('date')
    const rows = (data ?? []) as Record<string, unknown>[]
    exportCSV(`outflows-${date}.csv`,
      ['Date','Txn ID','Description',`Disbursed (${sym})`,`Refunded (${sym})`,`Transfer Charge (${sym})`,'Stage 1','Stage 2','Remarks','FX Currency','Txn Type','Created At'],
      rows.map(r => [r.date, r.transaction_id, r.description, r.amount_disbursed,
        r.amount_refunded, r.transfer_charge, r.stage_code_1, r.stage_code_2,
        r.remarks, r.fx_currency, r.transaction_type, r.created_at]))
  }

  else if (key === 'intra-flows') {
    const { data } = await Q('intra_flows', orgId).order('date')
    const rows = (data ?? []) as Record<string, unknown>[]
    exportCSV(`intra-flows-${date}.csv`,
      ['Date','From Category','To Category',`Amount (${sym})`,'Description','Transaction Ref','From Stage 1','From Stage 2','To Stage 1','To Stage 2','Remark','Created At'],
      rows.map(r => [r.date, r.account_from, r.account_to, r.total_amount, r.description,
        r.transaction_ref, r.account_from_stage1, r.account_from_stage2,
        r.account_to_stage1, r.account_to_stage2, r.remark, r.created_at]))
  }

  else if (key === 'bank-deposits') {
    const { data } = await Q('bank_deposits', orgId).order('date')
    const rows = (data ?? []) as Record<string, unknown>[]
    exportCSV(`bank-deposits-${date}.csv`,
      ['Date','Bank',`Amount (${sym})`,'Description','Transaction Ref','Remarks','Created At'],
      rows.map(r => [r.date, r.bank_name, r.amount, r.description, r.transaction_ref, r.remarks, r.created_at]))
  }

  else if (key === 'intrabank-transfers') {
    const { data } = await Q('intrabank_transfers', orgId).order('date')
    const rows = (data ?? []) as Record<string, unknown>[]
    exportCSV(`intrabank-transfers-${date}.csv`,
      ['Date','From Bank','To Bank',`Amount (${sym})`,'Description','Transaction Ref','Remarks','Created At'],
      rows.map(r => [r.date, r.from_bank_name, r.to_bank_name, r.amount,
        r.description, r.transaction_ref, r.remarks, r.created_at]))
  }

  else if (key === 'foreign-currency') {
    const { data } = await Q('fx_transactions', orgId).order('date')
    const rows = (data ?? []) as Record<string, unknown>[]
    exportCSV(`foreign-currency-${date}.csv`,
      ['Date','Currency','Narration','Deposit','Withdrawal','Running Balance','Transaction Ref','Created At'],
      rows.map(r => [r.date, r.currency, r.narration, r.deposit, r.withdrawal,
        r.running_balance, r.transaction_ref, r.created_at]))
  }

  else if (key === 'special-projects') {
    const { data } = await Q('special_projects', orgId).order('name')
    const rows = (data ?? []) as Record<string, unknown>[]
    exportCSV(`special-projects-${date}.csv`,
      ['Name','Code',`Opening Balance (${sym})`,'Active','Created At'],
      rows.map(r => [r.name, r.code, r.opening_balance, r.is_active, r.created_at]))
  }

  else if (key === 'project-entries') {
    const { data: entries } = await Q('project_entries', orgId).order('date')
    const { data: projects } = await supabase.from('special_projects').select('id, name').eq('org_id', orgId).limit(10_000)
    const nameMap = new Map((projects ?? []).map((p: Record<string, unknown>) => [p.id, p.name]))
    const rows = (entries ?? []) as Record<string, unknown>[]
    exportCSV(`special-project-entries-${date}.csv`,
      ['Project','Date','Description',`Inflow (${sym})`,`% Inflow (${sym})`,`Refund/Intraflow (${sym})`,`Outflow (${sym})`,`Balance (${sym})`,'Created At'],
      rows.map(r => [nameMap.get(r.project_id as string) ?? r.project_id, r.date, r.description,
        r.inflow, r.percentage_inflow, r.refund_intraflow, r.outflow, r.balance, r.created_at]))
  }

  else if (key === 'receipts') {
    const { data } = await Q('receipts', orgId).order('created_at')
    const rows = (data ?? []) as Record<string, unknown>[]
    exportCSV(`receipts-${date}.csv`,
      ['Entity Type','Entity ID','File Name','File Path','File Size (bytes)','MIME Type','Uploaded By','Created At'],
      rows.map(r => [r.entity_type, r.entity_id, r.file_name, r.file_path,
        r.file_size, r.mime_type, r.uploaded_by, r.created_at]))
  }

  else if (key === 'bank-ledger') {
    const [inflowRes, outflowRes] = await Promise.all([
      supabase.from('inflow_transactions').select('id,date,description,amount,stage_code_1').eq('org_id', orgId).order('date').limit(100_000),
      supabase.from('outflow_transactions').select('id,date,description,amount_disbursed,stage_code_1').eq('org_id', orgId).order('date').limit(100_000),
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
      supabase.from('inflow_transactions').select('date,description,amount,stage_code_1,inflow_type').eq('org_id', orgId).order('stage_code_1').order('date').limit(100_000),
      supabase.from('outflow_transactions').select('date,description,amount_disbursed,stage_code_1').eq('org_id', orgId).order('stage_code_1').order('date').limit(100_000),
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
      .eq('org_id', orgId)
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

// ── Delete all data ────────────────────────────────────────────────────────────

async function deleteAllData(orgId: string): Promise<void> {
  // 1. Delete storage files for receipts belonging to this org only
  const { data: receiptRows } = await supabase
    .from('receipts').select('file_path').eq('org_id', orgId).limit(100_000)
  if (receiptRows?.length) {
    const paths = (receiptRows as { file_path: string }[]).map(r => r.file_path)
    for (let i = 0; i < paths.length; i += 100) {
      await supabase.storage.from('receipts').remove(paths.slice(i, i + 100))
    }
  }

  // 2. Delete DB rows scoped to this org (order matters for FK constraints)
  const tables = [
    'receipts', 'audit_log', 'field_changes', 'project_entries',
    'intra_flows', 'bank_deposits', 'intrabank_transfers',
    'fx_transactions', 'inflow_transactions', 'outflow_transactions',
  ]
  for (const table of tables) {
    const { error } = await supabase.from(table).delete().eq('org_id', orgId)
    if (error) throw new Error(`Failed to delete ${table}: ${error.message}`)
  }
}

// ── Component ──────────────────────────────────────────────────────────────────

interface Props {
  open:    boolean
  onClose: () => void
  onDone:  () => void
}

export function ResetDataModal({ open, onClose, onDone }: Props) {
  const [step,      setStep]      = useState<Step>('exporting')
  const [items,     setItems]     = useState<ExportItem[]>(INITIAL_EXPORTS)
  const [confirm,   setConfirm]   = useState('')
  const [deleting,  setDeleting]  = useState(false)
  const [deleteErr, setDeleteErr] = useState<string | null>(null)
  const { baseCurrencySymbol } = useOrgCurrency()
  const orgId   = useOrgStore((s) => s.orgId)
  const orgName = useOrgStore((s) => s.orgName) ?? ''

  const setStatus = useCallback((key: string, status: ItemStatus) => {
    setItems(prev => prev.map(it => it.key === key ? { ...it, status } : it))
  }, [])

  // Auto-run exports when modal opens
  useEffect(() => {
    if (!open || !orgId) return
    setStep('exporting')
    setItems(INITIAL_EXPORTS)
    setConfirm('')
    setDeleteErr(null)

    let cancelled = false
    const sym = baseCurrencySymbol
    ;(async () => {
      for (const item of INITIAL_EXPORTS) {
        if (cancelled) return
        setStatus(item.key, 'running')
        try {
          await runExport(item.key, sym, orgId)
          if (!cancelled) setStatus(item.key, 'done')
        } catch {
          if (!cancelled) setStatus(item.key, 'error')
        }
      }
    })()

    return () => { cancelled = true }
  }, [open, orgId, setStatus, baseCurrencySymbol])

  const handleDelete = async () => {
    if (!orgId) return
    setDeleting(true)
    setDeleteErr(null)
    try {
      await deleteAllData(orgId)
      onDone()
      onClose()
    } catch (e) {
      setDeleteErr(e instanceof Error ? e.message : 'Delete failed')
    } finally {
      setDeleting(false)
    }
  }

  const allExported  = items.every(it => it.status === 'done' || it.status === 'error')
  const confirmValid = confirm.trim() === orgName.trim()

  return (
    <Modal
      open={open}
      onClose={deleting ? () => {} : onClose}
      title="Reset All Data"
      size="max-w-lg"
    >
      {/* ── Step 1: Exporting ── */}
      {step === 'exporting' && (
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            Exporting all data before deletion. Each file will download automatically.
          </p>
          <div className="space-y-1.5 max-h-72 overflow-y-auto">
            {items.map(item => (
              <div key={item.key} className="flex items-center gap-2.5 text-sm">
                {item.status === 'pending' && <div className="w-4 h-4 rounded-full border-2 border-gray-200 shrink-0" />}
                {item.status === 'running' && <Loader2 className="w-4 h-4 text-primary animate-spin shrink-0" />}
                {item.status === 'done'    && <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" />}
                {item.status === 'error'   && <XCircle className="w-4 h-4 text-amber-500 shrink-0" />}
                <span className={
                  item.status === 'done'    ? 'text-gray-700' :
                  item.status === 'error'   ? 'text-amber-600' :
                  item.status === 'running' ? 'text-gray-900 font-medium' :
                  'text-gray-400'
                }>
                  {item.label}
                  {item.status === 'error' && <span className="ml-1 text-xs">(skipped — table may not exist)</span>}
                </span>
              </div>
            ))}
          </div>
          <div className="flex justify-end gap-3 pt-2 border-t border-gray-100">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              onClick={() => setStep('confirm1')}
              disabled={!allExported}
              className="px-4 py-2 text-sm font-medium text-white bg-danger rounded-lg hover:bg-red-700 disabled:opacity-40 transition-colors"
            >
              {allExported ? 'Proceed to Delete' : 'Exporting…'}
            </button>
          </div>
        </div>
      )}

      {/* ── Step 2: First confirmation ── */}
      {step === 'confirm1' && (
        <div className="space-y-4">
          <div className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
            <ShieldAlert className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
            <div className="text-sm text-red-700 space-y-1">
              <p className="font-semibold">This action is permanent and irreversible.</p>
              <p>All transaction records will be deleted — inflows, outflows, fund-to-fund transfers, bank deposits, intrabank transfers, foreign currency, special project entries, receipts, and the audit log. Your data has been exported above.</p>
            </div>
          </div>
          <p className="text-sm text-gray-600">
            Structural settings (categories, banks, distribution rules, users) will be preserved.
          </p>
          <div className="flex justify-end gap-3 pt-2 border-t border-gray-100">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              onClick={() => setStep('confirm2')}
              className="px-4 py-2 text-sm font-medium text-white bg-danger rounded-lg hover:bg-red-700 transition-colors"
            >
              I understand, continue
            </button>
          </div>
        </div>
      )}

      {/* ── Step 3: Type to confirm ── */}
      {step === 'confirm2' && (
        <div className="space-y-4">
          <div className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
            <AlertTriangle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
            <p className="text-sm text-red-700 font-medium">Final confirmation required</p>
          </div>
          <div className="space-y-2">
            <label className="block text-sm font-medium text-gray-700">
              Type your organisation name{' '}
              <span className="font-mono font-bold text-danger">{orgName}</span>{' '}
              to confirm:
            </label>
            <input
              type="text"
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
              placeholder={orgName}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-300 focus:border-red-400 font-mono"
              autoComplete="off"
            />
          </div>
          {deleteErr && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{deleteErr}</p>
          )}
          <div className="flex justify-end gap-3 pt-2 border-t border-gray-100">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              onClick={handleDelete}
              disabled={!confirmValid || deleting}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-danger rounded-lg hover:bg-red-700 disabled:opacity-40 transition-colors"
            >
              {deleting && <Loader2 className="w-4 h-4 animate-spin" />}
              <Trash2 className="w-4 h-4" />
              {deleting ? 'Deleting…' : 'Delete All Data'}
            </button>
          </div>
        </div>
      )}
    </Modal>
  )
}
