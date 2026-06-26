import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  ClipboardCheck, Plus, ArrowLeft, CheckCircle2, AlertTriangle,
  MessageSquare, FileText, Clock, ChevronDown, ChevronUp,
  ExternalLink, Copy, Terminal, Trash2, CheckCheck, RotateCcw,
  Receipt, AlertCircle,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { usePageTitle } from '../hooks/usePageTitle'
import { useRole } from '../hooks/useRole'
import { useOrgStore } from '../store/orgStore'
import { useOrgCurrency } from '../hooks/useOrgCurrency'
import { useToastStore } from '../store/toastStore'
import { useAuditSessions, type AuditSession } from '../hooks/useAuditSessions'
import { useAuditFindings, type FindingType } from '../hooks/useAuditFindings'
import { Card } from '../components/ui/Card'
import { Modal } from '../components/ui/Modal'
import { EmptyState } from '../components/ui/EmptyState'
import { formatDate } from '../utils/formatters'

// ── Migration SQL (shown inline when tables missing) ──────────────────────────

export const AUDIT_MIGRATION_SQL =
`-- Run in Supabase SQL Editor → New Query

CREATE TABLE IF NOT EXISTS public.audit_sessions (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  period_start date        NOT NULL,
  period_end   date        NOT NULL,
  auditor_id   uuid        REFERENCES public.profiles(id) ON DELETE SET NULL,
  status       text        NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'complete')),
  notes        text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.audit_sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "audit_sessions_select" ON public.audit_sessions;
CREATE POLICY "audit_sessions_select" ON public.audit_sessions FOR SELECT USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "audit_sessions_insert" ON public.audit_sessions;
CREATE POLICY "audit_sessions_insert" ON public.audit_sessions FOR INSERT WITH CHECK (is_finance_user());
DROP POLICY IF EXISTS "audit_sessions_update" ON public.audit_sessions;
CREATE POLICY "audit_sessions_update" ON public.audit_sessions FOR UPDATE USING (is_finance_user());
DROP POLICY IF EXISTS "audit_sessions_delete" ON public.audit_sessions;
CREATE POLICY "audit_sessions_delete" ON public.audit_sessions FOR DELETE USING (is_admin());
CREATE INDEX IF NOT EXISTS idx_audit_sessions_org ON public.audit_sessions(org_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.audit_findings (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id   uuid        NOT NULL REFERENCES public.audit_sessions(id) ON DELETE CASCADE,
  org_id       uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  entity_type  text        NOT NULL,
  entity_id    uuid        NOT NULL,
  finding_type text        NOT NULL CHECK (finding_type IN ('ok', 'exception', 'note')),
  note         text,
  created_by   uuid        REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, entity_type, entity_id)
);
ALTER TABLE public.audit_findings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "audit_findings_select" ON public.audit_findings;
CREATE POLICY "audit_findings_select" ON public.audit_findings FOR SELECT USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "audit_findings_insert" ON public.audit_findings;
CREATE POLICY "audit_findings_insert" ON public.audit_findings FOR INSERT WITH CHECK (is_finance_user());
DROP POLICY IF EXISTS "audit_findings_update" ON public.audit_findings;
CREATE POLICY "audit_findings_update" ON public.audit_findings FOR UPDATE USING (is_finance_user());
DROP POLICY IF EXISTS "audit_findings_delete" ON public.audit_findings;
CREATE POLICY "audit_findings_delete" ON public.audit_findings FOR DELETE USING (is_finance_user());
CREATE INDEX IF NOT EXISTS idx_audit_findings_session ON public.audit_findings(session_id);
CREATE INDEX IF NOT EXISTS idx_audit_findings_entity  ON public.audit_findings(org_id, entity_type, entity_id);

-- activity_log_view (requires PostgreSQL 15+ — Supabase default)
CREATE OR REPLACE VIEW public.activity_log_view WITH (security_invoker = true) AS
  SELECT fc.id, 'field_change'::text AS event_type, fc.user_id, fc.org_id,
    fc.table_name, fc.record_id, fc.changed_at AS event_at,
    fc.field_name, fc.old_value, fc.new_value,
    NULL::text AS action, NULL::jsonb AS snapshot_data,
    p.full_name AS user_full_name, p.email AS user_email
  FROM public.field_changes fc LEFT JOIN public.profiles p ON p.id = fc.user_id
  UNION ALL
  SELECT al.id,
    CASE al.action WHEN 'INSERT' THEN 'record_created' ELSE 'record_deleted' END,
    al.user_id, al.org_id, al.table_name, al.record_id, al.created_at,
    NULL::text, NULL::text, NULL::text, al.action,
    COALESCE(al.new_data, al.old_data)::jsonb,
    p.full_name, p.email
  FROM public.audit_log al LEFT JOIN public.profiles p ON p.id = al.user_id
  WHERE al.action IN ('INSERT', 'DELETE');
GRANT SELECT ON public.activity_log_view TO authenticated;

NOTIFY pgrst, 'reload schema';`

// ── Types ─────────────────────────────────────────────────────────────────────

interface AuditTxn {
  id:          string
  txType:      'inflow' | 'outflow'
  date:        string
  description: string
  amount:      number
  bankName:    string
  hasReceipt:  boolean
  receiptPath: string | null
}

type WorkspaceFilter = 'all' | 'inflow' | 'outflow' | 'no_receipt' | 'exception' | 'unreviewed'

// ── Helpers ───────────────────────────────────────────────────────────────────

function statusBadge(status: 'draft' | 'complete') {
  return status === 'complete'
    ? <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-green-100 text-green-700">Complete</span>
    : <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">Draft</span>
}

function findingBadge(type: FindingType | undefined) {
  if (!type) return <span className="text-xs text-gray-400">Unreviewed</span>
  if (type === 'ok')        return <span className="flex items-center gap-1 text-xs font-medium text-green-700"><CheckCircle2 className="w-3.5 h-3.5" />OK</span>
  if (type === 'exception') return <span className="flex items-center gap-1 text-xs font-medium text-red-600"><AlertTriangle className="w-3.5 h-3.5" />Exception</span>
  return <span className="flex items-center gap-1 text-xs font-medium text-blue-600"><MessageSquare className="w-3.5 h-3.5" />Note</span>
}

// ── New Session Modal ─────────────────────────────────────────────────────────

function NewSessionModal({ onClose, onCreate }: {
  onClose:  () => void
  onCreate: (data: { period_start: string; period_end: string; notes?: string }) => Promise<void>
}) {
  const [periodStart, setPeriodStart] = useState('')
  const [periodEnd,   setPeriodEnd]   = useState('')
  const [notes,       setNotes]       = useState('')
  const [saving,      setSaving]      = useState(false)
  const [err,         setErr]         = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!periodStart || !periodEnd) { setErr('Both dates are required.'); return }
    if (periodEnd < periodStart)    { setErr('End date must be on or after start date.'); return }
    setSaving(true); setErr('')
    try {
      await onCreate({ period_start: periodStart, period_end: periodEnd, notes: notes.trim() || undefined })
      onClose()
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Failed to create session.')
    } finally { setSaving(false) }
  }

  const inputCls = 'w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary'
  const labelCls = 'block text-xs font-medium text-gray-600 mb-1'

  return (
    <Modal open onClose={onClose} title="New Audit Session">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>Period Start</label>
            <input type="date" value={periodStart} onChange={e => setPeriodStart(e.target.value)} className={inputCls} required />
          </div>
          <div>
            <label className={labelCls}>Period End</label>
            <input type="date" value={periodEnd} onChange={e => setPeriodEnd(e.target.value)} className={inputCls} required />
          </div>
        </div>
        <div>
          <label className={labelCls}>Notes (optional)</label>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            rows={2}
            placeholder="e.g. Q1 2026 internal audit"
            className={`${inputCls} resize-none`}
          />
        </div>
        {err && (
          <p className="text-xs text-red-600 flex items-center gap-1">
            <AlertCircle className="w-3.5 h-3.5 shrink-0" />{err}
          </p>
        )}
        <div className="flex gap-2 justify-end pt-1">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50">Cancel</button>
          <button type="submit" disabled={saving} className="px-4 py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary-light disabled:opacity-60">
            {saving ? 'Creating…' : 'Create Session'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

// ── Transaction Row in workspace ──────────────────────────────────────────────

function TxnRow({ txn, finding, sessionComplete, readOnly, onMark, sym, formatLocale }: {
  txn:             AuditTxn
  finding:         ReturnType<typeof useAuditFindings>['findingMap'] extends Map<string, infer V> ? V | undefined : never
  sessionComplete: boolean
  readOnly:        boolean
  onMark:          (entityType: string, entityId: string, type: FindingType, note?: string) => Promise<void>
  sym:             string
  formatLocale:    string
}) {
  const [expanded, setExpanded] = useState(false)
  const [noteText, setNoteText] = useState(finding?.note ?? '')
  const [saving,   setSaving]   = useState(false)

  useEffect(() => { setNoteText(finding?.note ?? '') }, [finding?.note])

  const handleMark = async (type: FindingType) => {
    setSaving(true)
    try {
      await onMark(txn.txType, txn.id, type, type !== 'ok' ? noteText.trim() || undefined : undefined)
    } finally { setSaving(false) }
  }

  const openReceipt = async () => {
    if (!txn.receiptPath) return
    const { data } = await supabase.storage.from('receipts').createSignedUrl(txn.receiptPath, 3600)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank', 'noopener')
  }

  const rowBg = finding?.finding_type === 'exception'
    ? 'bg-red-50/40 border-l-2 border-l-red-400'
    : finding?.finding_type === 'ok'
    ? 'bg-green-50/30 border-l-2 border-l-green-400'
    : finding?.finding_type === 'note'
    ? 'bg-blue-50/30 border-l-2 border-l-blue-400'
    : 'border-l-2 border-l-transparent'

  return (
    <div className={`${rowBg} transition-colors`}>
      <button
        type="button"
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-black/[0.02] text-left"
      >
        <div className="flex-1 min-w-0 grid grid-cols-[auto_1fr_auto_auto_auto] items-center gap-3">
          <span className="text-xs text-gray-400 whitespace-nowrap font-mono">{txn.date}</span>
          <span className="text-sm text-gray-800 truncate">{txn.description}</span>
          <span className={`text-sm font-semibold whitespace-nowrap ${txn.txType === 'inflow' ? 'text-green-700' : 'text-red-600'}`}>
            {txn.txType === 'inflow' ? '+' : '-'}{sym}{txn.amount.toLocaleString(formatLocale, { minimumFractionDigits: 2 })}
          </span>
          <span className="text-xs text-gray-500 whitespace-nowrap hidden sm:block">{txn.bankName || '—'}</span>
          <span className="flex items-center gap-1.5 whitespace-nowrap">
            {txn.hasReceipt
              ? <span className="flex items-center gap-1 text-xs font-medium text-green-700"><Receipt className="w-3.5 h-3.5" /></span>
              : <span className="flex items-center gap-1 text-xs text-amber-600"><Receipt className="w-3.5 h-3.5" />Missing</span>
            }
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {findingBadge(finding?.finding_type)}
          {expanded ? <ChevronUp className="w-3.5 h-3.5 text-gray-400" /> : <ChevronDown className="w-3.5 h-3.5 text-gray-400" />}
        </div>
      </button>

      {expanded && (
        <div className="px-4 pb-4 pt-1 border-t border-black/[0.04] bg-white/60 space-y-3">
          {/* Receipt section */}
          <div className="flex items-center gap-3">
            {txn.hasReceipt ? (
              <button
                type="button"
                onClick={openReceipt}
                className="flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
              >
                <ExternalLink className="w-3.5 h-3.5" /> View Receipt
              </button>
            ) : (
              <span className="flex items-center gap-1.5 text-xs text-amber-600 font-medium">
                <AlertTriangle className="w-3.5 h-3.5" /> No receipt attached
              </span>
            )}
          </div>

          {!sessionComplete && !readOnly && (
            <>
              {/* Note input */}
              <textarea
                value={noteText}
                onChange={e => setNoteText(e.target.value)}
                rows={2}
                placeholder="Add audit note (optional)…"
                className="w-full text-xs px-3 py-2 border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-primary/30 resize-none"
              />

              {/* Mark buttons */}
              <div className="flex gap-2 flex-wrap">
                <button
                  onClick={() => handleMark('ok')}
                  disabled={saving}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors disabled:opacity-50
                    ${finding?.finding_type === 'ok'
                      ? 'bg-green-600 text-white border-green-600'
                      : 'border-green-300 text-green-700 hover:bg-green-50'}`}
                >
                  <CheckCircle2 className="w-3.5 h-3.5" /> OK
                </button>
                <button
                  onClick={() => handleMark('exception')}
                  disabled={saving}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors disabled:opacity-50
                    ${finding?.finding_type === 'exception'
                      ? 'bg-red-600 text-white border-red-600'
                      : 'border-red-300 text-red-700 hover:bg-red-50'}`}
                >
                  <AlertTriangle className="w-3.5 h-3.5" /> Exception
                </button>
                <button
                  onClick={() => handleMark('note')}
                  disabled={saving}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors disabled:opacity-50
                    ${finding?.finding_type === 'note'
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'border-blue-300 text-blue-700 hover:bg-blue-50'}`}
                >
                  <MessageSquare className="w-3.5 h-3.5" /> Note
                </button>
                {finding && (
                  <button
                    onClick={async () => { setSaving(true); try { await onMark(txn.txType, txn.id, 'ok') } finally { setSaving(false) } }}
                    disabled={saving}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-50"
                    title="Clear finding"
                  >
                    <RotateCcw className="w-3 h-3" /> Clear
                  </button>
                )}
              </div>
              {finding?.note && (
                <p className="text-xs text-gray-500 italic">Current note: {finding.note}</p>
              )}
            </>
          )}
          {sessionComplete && finding?.note && (
            <p className="text-xs text-gray-500 italic border-l-2 border-gray-200 pl-2">{finding.note}</p>
          )}
        </div>
      )}
    </div>
  )
}

// ── Audit Workspace ───────────────────────────────────────────────────────────

function AuditWorkspace({ session, onBack, onComplete, onReopen }: {
  session:   AuditSession
  onBack:    () => void
  onComplete: () => Promise<void>
  onReopen:   () => Promise<void>
}) {
  const orgId = useOrgStore(s => s.orgId)
  const { baseCurrencySymbol: sym, formatLocale } = useOrgCurrency()
  const { push: toast } = useToastStore()
  const { isAuditor } = useRole()
  const canWrite = isAuditor()

  const [txns,    setTxns]    = useState<AuditTxn[]>([])
  const [loading, setLoading] = useState(true)
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [filter,  setFilter]  = useState<WorkspaceFilter>('all')
  const [completing, setCompleting] = useState(false)

  const { findingMap, upsert, refetch: refetchFindings } = useAuditFindings(session.id)

  const loadWorkspace = useCallback(async () => {
    if (!orgId) return
    setLoading(true); setLoadErr(null)

    const SKIP_TYPES = new Set(['balance_brought_forward', 'bank_deposit', 'intrabank_transfer'])

    const [inflowRes, outflowRes] = await Promise.all([
      supabase
        .from('inflow_transactions')
        .select('id, date, description, bank_description, amount, bank_name, transaction_type')
        .eq('org_id', orgId)
        .gte('date', session.period_start)
        .lte('date', session.period_end)
        .order('date', { ascending: false })
        .limit(500),
      supabase
        .from('outflow_transactions')
        .select('id, date, description, bank_description, amount_disbursed, bank_name, transaction_type')
        .eq('org_id', orgId)
        .gte('date', session.period_start)
        .lte('date', session.period_end)
        .order('date', { ascending: false })
        .limit(500),
    ])

    if (inflowRes.error || outflowRes.error) {
      setLoadErr(inflowRes.error?.message ?? outflowRes.error?.message ?? 'Failed to load transactions.')
      setLoading(false); return
    }

    const inflows  = (inflowRes.data  ?? []).filter(r => !SKIP_TYPES.has(r.transaction_type ?? ''))
    const outflows = (outflowRes.data ?? []).filter(r => !SKIP_TYPES.has(r.transaction_type ?? ''))
    const allIds   = [...inflows.map(r => r.id), ...outflows.map(r => r.id)]

    // Fetch receipts for all transaction IDs in one query
    const receiptMap = new Map<string, string>() // entity_id → file_path
    if (allIds.length > 0) {
      const { data: receipts } = await supabase
        .from('receipts')
        .select('entity_id, file_path')
        .in('entity_id', allIds)
        .eq('org_id', orgId)
      for (const r of receipts ?? []) {
        receiptMap.set(r.entity_id as string, r.file_path as string)
      }
    }

    const merged: AuditTxn[] = [
      ...inflows.map(r => ({
        id:          r.id as string,
        txType:      'inflow' as const,
        date:        r.date as string,
        description: (r.description ?? r.bank_description ?? '—') as string,
        amount:      Number(r.amount),
        bankName:    (r.bank_name ?? '') as string,
        hasReceipt:  receiptMap.has(r.id as string),
        receiptPath: receiptMap.get(r.id as string) ?? null,
      })),
      ...outflows.map(r => ({
        id:          r.id as string,
        txType:      'outflow' as const,
        date:        r.date as string,
        description: (r.description ?? r.bank_description ?? '—') as string,
        amount:      Number(r.amount_disbursed),
        bankName:    (r.bank_name ?? '') as string,
        hasReceipt:  receiptMap.has(r.id as string),
        receiptPath: receiptMap.get(r.id as string) ?? null,
      })),
    ].sort((a, b) => b.date.localeCompare(a.date))

    setTxns(merged)
    setLoading(false)
  }, [orgId, session.period_start, session.period_end])

  useEffect(() => { loadWorkspace() }, [loadWorkspace])

  const handleMark = useCallback(async (entityType: string, entityId: string, type: FindingType, note?: string) => {
    try {
      await upsert({ entity_type: entityType, entity_id: entityId, finding_type: type, note })
    } catch (e: unknown) {
      toast({ type: 'error', message: e instanceof Error ? e.message : 'Failed to save finding.' })
    }
  }, [upsert, toast])

  const handleComplete = async () => {
    setCompleting(true)
    try { await onComplete() } catch { /* swallow */ } finally { setCompleting(false) }
  }

  // Stats
  const stats = useMemo(() => {
    let ok = 0, exceptions = 0, notes = 0, noReceipt = 0, unreviewed = 0
    for (const t of txns) {
      if (!t.hasReceipt) noReceipt++
      const f = findingMap.get(`${t.txType}:${t.id}`)
      if (!f)                       unreviewed++
      else if (f.finding_type === 'ok')        ok++
      else if (f.finding_type === 'exception') exceptions++
      else if (f.finding_type === 'note')      notes++
    }
    return { ok, exceptions, notes, noReceipt, unreviewed, total: txns.length }
  }, [txns, findingMap])

  const filtered = useMemo(() => {
    if (filter === 'all')        return txns
    if (filter === 'inflow')     return txns.filter(t => t.txType === 'inflow')
    if (filter === 'outflow')    return txns.filter(t => t.txType === 'outflow')
    if (filter === 'no_receipt') return txns.filter(t => !t.hasReceipt)
    if (filter === 'exception')  return txns.filter(t => findingMap.get(`${t.txType}:${t.id}`)?.finding_type === 'exception')
    if (filter === 'unreviewed') return txns.filter(t => !findingMap.has(`${t.txType}:${t.id}`))
    return txns
  }, [txns, filter, findingMap])

  const filterBtn = (f: WorkspaceFilter, label: string, count?: number) => (
    <button
      key={f}
      onClick={() => setFilter(f)}
      className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap
        ${filter === f ? 'bg-primary text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
    >
      {label}{count !== undefined ? ` (${count})` : ''}
    </button>
  )

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors shrink-0"
        >
          <ArrowLeft className="w-4 h-4" /> Back to sessions
        </button>
        <div className="flex-1 min-w-0">
          <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
            {formatDate(session.period_start)} – {formatDate(session.period_end)}
            {statusBadge(session.status)}
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Auditor: {session.profiles?.full_name ?? '—'}
            {session.notes && ` · ${session.notes}`}
          </p>
        </div>
        {canWrite && session.status === 'draft' && (
          <button
            onClick={handleComplete}
            disabled={completing}
            className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 disabled:opacity-60 shrink-0"
          >
            <CheckCheck className="w-4 h-4" />
            {completing ? 'Completing…' : 'Complete Session'}
          </button>
        )}
        {canWrite && session.status === 'complete' && (
          <button
            onClick={onReopen}
            className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 shrink-0"
          >
            <RotateCcw className="w-4 h-4" /> Reopen
          </button>
        )}
        {!canWrite && (
          <span className="text-xs text-gray-400 italic shrink-0">View only</span>
        )}
      </div>

      {/* Stats strip */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        {[
          { label: 'Total',       value: stats.total,      color: 'text-gray-700'  },
          { label: 'OK',          value: stats.ok,         color: 'text-green-700' },
          { label: 'Exceptions',  value: stats.exceptions, color: 'text-red-600'   },
          { label: 'Notes',       value: stats.notes,      color: 'text-blue-600'  },
          { label: 'No Receipt',  value: stats.noReceipt,  color: 'text-amber-600' },
        ].map(({ label, value, color }) => (
          <div key={label} className="bg-white border border-gray-100 rounded-xl px-3 py-2 text-center">
            <p className={`text-lg font-bold ${color}`}>{value}</p>
            <p className="text-[10px] text-gray-500 uppercase tracking-wide">{label}</p>
          </div>
        ))}
      </div>

      {/* Filter bar */}
      <div className="flex gap-2 flex-wrap">
        {filterBtn('all',        'All',           stats.total)}
        {filterBtn('inflow',     'Inflows')}
        {filterBtn('outflow',    'Outflows')}
        {filterBtn('no_receipt', 'Missing Receipt', stats.noReceipt)}
        {filterBtn('exception',  'Exceptions',      stats.exceptions)}
        {filterBtn('unreviewed', 'Unreviewed',      stats.unreviewed)}
      </div>

      {/* Transaction list */}
      <Card padding={false}>
        {loadErr && (
          <div className="p-5 text-sm text-red-600 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />{loadErr}
          </div>
        )}
        {loading && !loadErr && (
          <div className="p-6 space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-11 rounded-lg bg-gray-100 animate-pulse" />
            ))}
          </div>
        )}
        {!loading && !loadErr && filtered.length === 0 && (
          <EmptyState icon={FileText} title="No transactions match this filter." compact />
        )}
        {!loading && !loadErr && filtered.length > 0 && (
          <div className="divide-y divide-black/[0.04]">
            {filtered.map(txn => (
              <TxnRow
                key={`${txn.txType}:${txn.id}`}
                txn={txn}
                finding={findingMap.get(`${txn.txType}:${txn.id}`)}
                sessionComplete={session.status === 'complete'}
                readOnly={!canWrite}
                onMark={handleMark}
                sym={sym}
                formatLocale={formatLocale}
              />
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}

// ── Sessions List ─────────────────────────────────────────────────────────────

function SessionsList({ sessions, loading, error, canManage, canDelete, onNew, onOpen, onComplete, onReopen, onDelete }: {
  sessions:   AuditSession[]
  loading:    boolean
  error:      string | null
  canManage:  boolean
  canDelete:  boolean
  onNew:      () => void
  onOpen:     (s: AuditSession) => void
  onComplete: (id: string) => Promise<void>
  onReopen:   (id: string) => Promise<void>
  onDelete:   (id: string) => Promise<void>
}) {
  const isMigrationError = !!error && /does not exist|audit_sessions/i.test(error)
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    await navigator.clipboard.writeText(AUDIT_MIGRATION_SQL)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (isMigrationError) {
    return (
      <Card>
        <div className="space-y-4">
          <div className="flex items-start gap-3 text-amber-700">
            <Terminal className="w-5 h-5 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-sm">Database migration required</p>
              <p className="text-xs mt-1 text-amber-600">Run the following SQL in your Supabase SQL Editor to enable the Audit feature.</p>
            </div>
          </div>
          <div className="rounded-xl border border-gray-200 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2 bg-gray-800">
              <span className="text-xs font-medium text-gray-400 font-mono">SQL</span>
              <button onClick={handleCopy} className="flex items-center gap-1.5 text-xs text-gray-300 hover:text-white transition-colors">
                <Copy className="w-3.5 h-3.5" />{copied ? 'Copied!' : 'Copy'}
              </button>
            </div>
            <pre className="text-xs font-mono text-gray-200 bg-gray-900 p-4 overflow-x-auto whitespace-pre leading-relaxed max-h-80 overflow-y-auto">
              {AUDIT_MIGRATION_SQL}
            </pre>
          </div>
        </div>
      </Card>
    )
  }

  if (error) {
    return <p className="text-sm text-red-600 p-4">{error}</p>
  }

  if (loading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-24 rounded-xl bg-gray-100 animate-pulse" />)}
      </div>
    )
  }

  if (sessions.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={ClipboardCheck}
          title="No audit sessions yet."
          description="Create a session to start vouching transactions against source documents."
          action={canManage ? { label: 'New Session', onClick: onNew } : undefined}
        />
      </Card>
    )
  }

  return (
    <div className="space-y-3">
      {sessions.map(s => (
        <div key={s.id} className="bg-white border border-gray-200 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-sm font-semibold text-gray-900">
                {formatDate(s.period_start)} – {formatDate(s.period_end)}
              </p>
              {statusBadge(s.status)}
            </div>
            <p className="text-xs text-gray-500 mt-0.5">
              Auditor: {s.profiles?.full_name ?? '—'}
              {s.notes && ` · ${s.notes}`}
              {' · '}Created {formatDate(s.created_at)}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap shrink-0">
            <button
              onClick={() => onOpen(s)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-primary rounded-lg hover:bg-primary-light"
            >
              <ClipboardCheck className="w-3.5 h-3.5" /> Open
            </button>
            {canManage && s.status === 'draft' && (
              <button
                onClick={() => onComplete(s.id)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-green-700 border border-green-300 rounded-lg hover:bg-green-50"
              >
                <CheckCheck className="w-3.5 h-3.5" /> Complete
              </button>
            )}
            {canManage && s.status === 'complete' && (
              <button
                onClick={() => onReopen(s.id)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50"
              >
                <RotateCcw className="w-3.5 h-3.5" /> Reopen
              </button>
            )}
            {canDelete && (
              <button
                onClick={() => onDelete(s.id)}
                className="p-1.5 text-gray-400 hover:text-red-500 rounded-lg hover:bg-red-50 transition-colors"
                title="Delete session"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function Audit() {
  usePageTitle('Internal Audit')
  const { push: toast } = useToastStore()
  const { isAuditor, isAdmin } = useRole()
  const canManageSessions = isAuditor()
  const canDeleteSessions = isAdmin()
  const { sessions, loading, error, create, complete, reopen, remove } = useAuditSessions()

  const [showNew,          setShowNew]          = useState(false)
  const [activeSession,    setActiveSession]    = useState<AuditSession | null>(null)

  const handleCreate = async (data: { period_start: string; period_end: string; notes?: string }) => {
    const session = await create(data)
    setShowNew(false)
    setActiveSession(session)
  }

  const handleComplete = async (id?: string) => {
    const target = id ?? activeSession?.id
    if (!target) return
    try {
      await complete(target)
      if (activeSession?.id === target) setActiveSession(s => s ? { ...s, status: 'complete' } : s)
      toast({ type: 'success', message: 'Session marked complete.' })
    } catch (e: unknown) {
      toast({ type: 'error', message: e instanceof Error ? e.message : 'Failed.' })
    }
  }

  const handleReopen = async (id?: string) => {
    const target = id ?? activeSession?.id
    if (!target) return
    try {
      await reopen(target)
      if (activeSession?.id === target) setActiveSession(s => s ? { ...s, status: 'draft' } : s)
      toast({ type: 'success', message: 'Session reopened.' })
    } catch (e: unknown) {
      toast({ type: 'error', message: e instanceof Error ? e.message : 'Failed.' })
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this audit session and all its findings? This cannot be undone.')) return
    try {
      await remove(id)
      if (activeSession?.id === id) setActiveSession(null)
      toast({ type: 'success', message: 'Session deleted.' })
    } catch (e: unknown) {
      toast({ type: 'error', message: e instanceof Error ? e.message : 'Failed.' })
    }
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between pb-4 border-b border-gray-100">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-gray-900 flex items-center gap-2">
            <ClipboardCheck className="w-6 h-6 text-primary" /> Internal Audit
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {activeSession ? 'Vouch transactions against source documents' : 'Manage audit sessions and review findings'}
          </p>
        </div>
        {!activeSession && canManageSessions && (
          <button
            onClick={() => setShowNew(true)}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary-light"
          >
            <Plus className="w-4 h-4" /> New Session
          </button>
        )}
      </div>

      {activeSession ? (
        <AuditWorkspace
          session={activeSession}
          onBack={() => setActiveSession(null)}
          onComplete={() => handleComplete()}
          onReopen={() => handleReopen()}
        />
      ) : (
        <SessionsList
          sessions={sessions}
          loading={loading}
          error={error}
          canManage={canManageSessions}
          canDelete={canDeleteSessions}
          onNew={() => setShowNew(true)}
          onOpen={setActiveSession}
          onComplete={id => handleComplete(id)}
          onReopen={id => handleReopen(id)}
          onDelete={handleDelete}
        />
      )}

      {showNew && (
        <NewSessionModal
          onClose={() => setShowNew(false)}
          onCreate={handleCreate}
        />
      )}
    </div>
  )
}
