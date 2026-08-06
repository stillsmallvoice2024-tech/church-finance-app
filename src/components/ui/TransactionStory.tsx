import { useEffect, useState } from 'react'
import { History, Loader2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { usePlan } from '../../hooks/usePlan'

interface StoryEvent {
  id:         string
  changed_at: string
  field_name: string
  old_value:  string | null
  new_value:  string | null
  who:        string | null
}

interface TransactionStoryProps {
  table: string         // e.g. 'inflow_transactions'
  recordId: string
  createdAt?: string | null
  locale?: string
}

const FIELD_LABELS: Record<string, string> = {
  stage_code_1:              'Category',
  stage_code_2:              'Fund type',
  bank_name:                 'Bank',
  amount:                    'Amount',
  amount_disbursed:          'Amount disbursed',
  description:               'Description',
  display_description:       'Description',
  date:                      'Date',
  transaction_type:          'Transaction type',
  allocation_config_id:      'Distribution rule',
  specific_seed_description: 'Designated purpose',
  remark:                    'Remark',
  is_pending_deduction:      'Pending deduction',
  offset_role:               'Offset role',
}

function fieldLabel(f: string) {
  return FIELD_LABELS[f] ?? f.replace(/_/g, ' ')
}

function fmtWhen(iso: string, locale = 'en-GB') {
  return new Date(iso).toLocaleString(locale, {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

/**
 * "Transaction Journey" — a read-only timeline of every recorded change to a
 * transaction, sourced from the existing field_changes audit table.
 */
export function TransactionStory({ table, recordId, createdAt, locale }: TransactionStoryProps) {
  const { hasFeature } = usePlan()
  const [events,  setEvents]  = useState<StoryEvent[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [open,    setOpen]    = useState(false)

  useEffect(() => {
    if (!open || events !== null) return
    let cancelled = false
    setLoading(true)
    supabase
      .from('field_changes')
      .select('id, changed_at, field_name, old_value, new_value, profiles:user_id ( full_name, email )')
      .eq('table_name', table)
      .eq('record_id', recordId)
      .order('changed_at', { ascending: true })
      .limit(50)
      .then(({ data }) => {
        if (cancelled) return
        const rows = (data ?? []).map(r => {
          const p = (r as { profiles?: { full_name?: string | null; email?: string | null } | null }).profiles
          return {
            id:         (r as { id: string }).id,
            changed_at: (r as { changed_at: string }).changed_at,
            field_name: (r as { field_name: string }).field_name,
            old_value:  (r as { old_value: string | null }).old_value,
            new_value:  (r as { new_value: string | null }).new_value,
            who:        p?.full_name ?? p?.email ?? null,
          }
        })
        setEvents(rows)
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [open, events, table, recordId])

  // The dedicated Change Log page is Impact-only, but this same
  // field_changes data is also viewable per-transaction here on
  // Inflows/Outflows rows, on every tier — needs its own check.
  if (!hasFeature('changeLog')) return null

  return (
    <div className="col-span-2 sm:col-span-3 lg:col-span-4 pt-2 border-t border-gray-100 mt-1">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-400 hover:text-primary transition-colors"
      >
        <History className="w-3.5 h-3.5" />
        {open ? 'Hide transaction journey' : 'View transaction journey'}
      </button>

      {open && (
        <div className="mt-3">
          {loading ? (
            <div className="flex items-center gap-2 text-xs text-gray-500 py-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading history…
            </div>
          ) : (
            <ol className="relative border-l border-gray-200 ml-1.5 space-y-3">
              {createdAt && (
                <li className="pl-4 relative">
                  <span className="absolute -left-[5px] top-1 w-2.5 h-2.5 rounded-full bg-primary/70 border-2 border-white" />
                  <p className="text-xs text-gray-700 font-medium">Recorded</p>
                  <p className="text-xs text-gray-500">{fmtWhen(createdAt, locale)}</p>
                </li>
              )}
              {(events ?? []).map(e => (
                <li key={e.id} className="pl-4 relative">
                  <span className="absolute -left-[5px] top-1 w-2.5 h-2.5 rounded-full bg-gray-300 border-2 border-white" />
                  <p className="text-xs text-gray-700">
                    <span className="font-medium">{fieldLabel(e.field_name)}</span> changed
                    {e.old_value != null && <> from <span className="font-mono text-gray-500">"{e.old_value}"</span></>}
                    {e.new_value != null && <> to <span className="font-mono text-gray-700">"{e.new_value}"</span></>}
                    {e.who && <span className="text-gray-400"> · {e.who}</span>}
                  </p>
                  <p className="text-xs text-gray-500">{fmtWhen(e.changed_at, locale)}</p>
                </li>
              ))}
              {(events ?? []).length === 0 && !createdAt && (
                <li className="pl-4 text-xs text-gray-500">No changes recorded for this transaction.</li>
              )}
              {(events ?? []).length === 0 && createdAt && (
                <li className="pl-4 text-xs text-gray-500">Unchanged since it was recorded.</li>
              )}
            </ol>
          )}
        </div>
      )}
    </div>
  )
}
