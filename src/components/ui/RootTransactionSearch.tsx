import { useState, useEffect, useRef } from 'react'
import { Search, X, Link2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useOrgStore } from '../../store/orgStore'
import { formatCurrency, formatDate } from '../../utils/formatters'
import { useOrgCurrency } from '../../hooks/useOrgCurrency'

export interface RootTxnLink {
  id: string
  table: 'inflow_transactions' | 'outflow_transactions'
  label: string
  txnRef: string | null   // bank transaction_ref / transaction_id — same as original_transaction_id
}

interface SearchResult {
  id: string
  date: string
  amount: number
  description: string | null
  bank_name: string | null
  direction: 'in' | 'out'
  txnRef: string | null
}

interface Props {
  value: RootTxnLink | null
  onChange: (v: RootTxnLink | null) => void
  /** When set, results are scoped to this bank by default. */
  bankName?: string | null
}

export function RootTransactionSearch({ value, onChange, bankName }: Props) {
  const orgId = useOrgStore((s) => s.orgId)
  const { baseCurrencyCode } = useOrgCurrency()

  const [query,    setQuery]    = useState('')
  const [results,  setResults]  = useState<SearchResult[]>([])
  const [loading,  setLoading]  = useState(false)
  const [open,     setOpen]     = useState(false)
  const [allBanks, setAllBanks] = useState(!bankName)

  const containerRef   = useRef<HTMLDivElement>(null)
  const searchTimeout  = useRef<ReturnType<typeof setTimeout>>()

  // When bankName changes (e.g. user selects a different bank in the parent form),
  // reset the all-banks toggle to default (scoped) only if there is a bank to scope to.
  useEffect(() => { setAllBanks(!bankName) }, [bankName])

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // Debounced search — fires 300 ms after the user stops typing
  useEffect(() => {
    clearTimeout(searchTimeout.current)
    if (!query.trim() || !orgId) { setResults([]); setOpen(false); return }

    searchTimeout.current = setTimeout(async () => {
      setLoading(true)
      const likeQ      = `%${query.trim()}%`
      const scopeBank  = !allBanks && !!bankName

      const [inflowRes, outflowRes] = await Promise.all([
        (() => {
          let q = supabase
            .from('inflow_transactions')
            .select('id, date, amount, description, bank_name, transaction_ref')
            .eq('org_id', orgId)
            .ilike('description', likeQ)
            .order('date', { ascending: false })
            .limit(8)
          if (scopeBank) q = q.eq('bank_name', bankName!)
          return q
        })(),
        (() => {
          let q = supabase
            .from('outflow_transactions')
            .select('id, date, amount_disbursed, description, bank_description, bank_name, transaction_id')
            .eq('org_id', orgId)
            .ilike('description', likeQ)
            .order('date', { ascending: false })
            .limit(8)
          if (scopeBank) q = q.eq('bank_name', bankName!)
          return q
        })(),
      ])

      const merged: SearchResult[] = [
        ...(inflowRes.data ?? []).map((r: Record<string, unknown>) => ({
          id:          r.id as string,
          date:        r.date as string,
          amount:      r.amount as number,
          description: r.description as string | null,
          bank_name:   r.bank_name as string | null,
          direction:   'in' as const,
          txnRef:      r.transaction_ref as string | null,
        })),
        ...(outflowRes.data ?? []).map((r: Record<string, unknown>) => ({
          id:          r.id as string,
          date:        r.date as string,
          amount:      (r.amount_disbursed ?? 0) as number,
          description: (r.description ?? r.bank_description) as string | null,
          bank_name:   r.bank_name as string | null,
          direction:   'out' as const,
          txnRef:      r.transaction_id as string | null,
        })),
      ]
        .sort((a, b) => b.date.localeCompare(a.date))
        .slice(0, 12)

      setResults(merged)
      setOpen(merged.length > 0)
      setLoading(false)
    }, 300)

    return () => clearTimeout(searchTimeout.current)
  }, [query, orgId, bankName, allBanks])

  const select = (r: SearchResult) => {
    const table = r.direction === 'in'
      ? 'inflow_transactions' as const
      : 'outflow_transactions' as const
    const dirLabel = r.direction === 'in' ? '↙ IN' : '↗ OUT'
    const amtStr   = formatCurrency(r.amount, baseCurrencyCode)
    const refStr   = r.txnRef ? ` · ${r.txnRef}` : ''
    const descStr  = r.description ? ` · ${r.description.slice(0, 40)}` : ''
    const label    = `${dirLabel} · ${formatDate(r.date)} · ${amtStr}${refStr}${descStr}`
    onChange({ id: r.id, txnRef: r.txnRef ?? null, table, label })
    setQuery('')
    setOpen(false)
  }

  // ── Selected pill ──────────────────────────────────────────────────────────
  if (value) {
    return (
      <div className="flex items-start gap-2 px-3 py-2 bg-primary/5 border border-primary/20 rounded-lg">
        <Link2 className="w-3.5 h-3.5 text-primary shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          {value.txnRef && (
            <p className="text-xs font-semibold font-mono text-primary truncate">{value.txnRef}</p>
          )}
          <p className="text-xs text-gray-500 truncate">{value.label}</p>
        </div>
        <button
          type="button"
          onClick={() => onChange(null)}
          className="p-0.5 rounded text-gray-400 hover:text-danger hover:bg-danger/10 transition-colors shrink-0"
          title="Remove link"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    )
  }

  // ── Search input + dropdown ────────────────────────────────────────────────
  return (
    <div ref={containerRef} className="relative space-y-1.5">
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search by description…"
          className="w-full pl-8 pr-3 py-2 text-sm border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-primary/30 bg-white"
        />
        {loading && (
          <div className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
        )}
      </div>

      {/* Bank scope toggle */}
      {bankName && (
        <label className="flex items-center gap-1.5 text-[11px] text-gray-500 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={allBanks}
            onChange={e => setAllBanks(e.target.checked)}
            className="w-3 h-3 rounded accent-primary"
          />
          Search all banks
          <span className="text-gray-400">(default: {bankName})</span>
        </label>
      )}

      {/* Results dropdown */}
      {open && results.length > 0 && (
        <ul className="absolute z-50 left-0 right-0 max-h-64 overflow-y-auto bg-white border border-gray-200 rounded-lg shadow-lg py-1">
          {results.map(r => (
            <li
              key={`${r.direction}-${r.id}`}
              onMouseDown={e => { e.preventDefault(); select(r) }}
              className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-primary/5 transition-colors"
            >
              <span className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-bold ${
                r.direction === 'in'
                  ? 'bg-green-100 text-green-700'
                  : 'bg-red-100 text-red-700'
              }`}>
                {r.direction === 'in' ? 'IN' : 'OUT'}
              </span>
              <span className="text-xs text-gray-400 whitespace-nowrap">
                {formatDate(r.date)}
              </span>
              <span className="text-xs font-semibold text-gray-800 whitespace-nowrap">
                {formatCurrency(r.amount, baseCurrencyCode)}
              </span>
              <span className="text-xs text-gray-600 truncate min-w-0">
                {r.description ?? '—'}
              </span>
              {r.bank_name && r.bank_name !== bankName && (
                <span className="text-[10px] text-gray-400 shrink-0 whitespace-nowrap">
                  {r.bank_name}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
