import { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
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
  offsetRole: 'root' | 'offset' | null
}

interface Props {
  value: RootTxnLink | null
  onChange: (v: RootTxnLink | null) => void
  /** When set, results are scoped to this bank by default. */
  bankName?: string | null
  /** When set, this transaction ID is excluded from search results (prevents self-linking). */
  excludeId?: string
}

const PAGE_SIZE = 8

// Same escaping used by useTransactions.ts — neutralizes ILIKE wildcards
// (%, _) and characters that break PostgREST .or() filter syntax.
function toLikePattern(rawQuery: string): string {
  const safeSearch = rawQuery.trim().replace(/[%_\\()[\],{}]/g, '')
  return `%${safeSearch}%`
}

interface RootQueryParams {
  orgId: string
  likeQ: string
  scopeBank: boolean
  bankName?: string | null
  excludeId?: string
  limit: number
}

function fetchRootInflows({ orgId, likeQ, scopeBank, bankName, excludeId, limit }: RootQueryParams) {
  let q = supabase
    .from('inflow_transactions')
    .select('id, date, amount, description, bank_name, transaction_ref, offset_role', { count: 'exact' })
    .eq('org_id', orgId)
    .or(`description.ilike.${likeQ},transaction_ref.ilike.${likeQ}`)
    .order('date', { ascending: false })
    .limit(limit)
  if (scopeBank) q = q.eq('bank_name', bankName!)
  if (excludeId) q = q.neq('id', excludeId)
  return q
}

function fetchRootOutflows({ orgId, likeQ, scopeBank, bankName, excludeId, limit }: RootQueryParams) {
  let q = supabase
    .from('outflow_transactions')
    .select('id, date, amount_disbursed, description, bank_description, bank_name, transaction_id, offset_role', { count: 'exact' })
    .eq('org_id', orgId)
    .or(`description.ilike.${likeQ},bank_description.ilike.${likeQ},transaction_id.ilike.${likeQ}`)
    .order('date', { ascending: false })
    .limit(limit)
  if (scopeBank) q = q.eq('bank_name', bankName!)
  if (excludeId) q = q.neq('id', excludeId)
  return q
}

function mapInflowRow(r: Record<string, unknown>): SearchResult {
  return {
    id:          r.id as string,
    date:        r.date as string,
    amount:      r.amount as number,
    description: r.description as string | null,
    bank_name:   r.bank_name as string | null,
    direction:   'in' as const,
    txnRef:      r.transaction_ref as string | null,
    offsetRole:  (r.offset_role as 'root' | 'offset' | null) ?? null,
  }
}

function mapOutflowRow(r: Record<string, unknown>): SearchResult {
  return {
    id:          r.id as string,
    date:        r.date as string,
    amount:      (r.amount_disbursed ?? 0) as number,
    description: (r.description ?? r.bank_description) as string | null,
    bank_name:   r.bank_name as string | null,
    direction:   'out' as const,
    txnRef:      r.transaction_id as string | null,
    offsetRole:  (r.offset_role as 'root' | 'offset' | null) ?? null,
  }
}

export function RootTransactionSearch({ value, onChange, bankName, excludeId }: Props) {
  const orgId = useOrgStore((s) => s.orgId)
  const { baseCurrencyCode } = useOrgCurrency()

  const [query,         setQuery]         = useState('')
  const [inflows,       setInflows]       = useState<SearchResult[]>([])
  const [outflows,      setOutflows]      = useState<SearchResult[]>([])
  const [inflowTotal,   setInflowTotal]   = useState(0)
  const [outflowTotal,  setOutflowTotal]  = useState(0)
  const [loading,       setLoading]       = useState(false)
  const [loadingMoreIn,  setLoadingMoreIn]  = useState(false)
  const [loadingMoreOut, setLoadingMoreOut] = useState(false)
  const [open,          setOpen]          = useState(false)
  const [allBanks,      setAllBanks]      = useState(!bankName)
  const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties>({})

  const containerRef  = useRef<HTMLDivElement>(null)
  const dropdownRef   = useRef<HTMLUListElement>(null)
  const searchTimeout = useRef<ReturnType<typeof setTimeout>>()
  // Guards against out-of-order async responses: bumped whenever a fresh
  // debounced search starts, read (not bumped) when a "load more" click
  // starts. A response is only committed if this hasn't changed since.
  const searchGenRef  = useRef(0)

  useEffect(() => { setAllBanks(!bankName) }, [bankName])

  // Compute fixed position from the container's bounding rect
  const updatePos = useCallback(() => {
    if (!containerRef.current) return
    const rect = containerRef.current.getBoundingClientRect()
    setDropdownStyle({
      position: 'fixed',
      top:   rect.bottom + 4,
      left:  rect.left,
      width: rect.width,
      zIndex: 9999,
    })
  }, [])

  // Reposition on scroll/resize while open
  useEffect(() => {
    if (!open) return
    updatePos()
    window.addEventListener('scroll', updatePos, true)
    window.addEventListener('resize', updatePos)
    return () => {
      window.removeEventListener('scroll', updatePos, true)
      window.removeEventListener('resize', updatePos)
    }
  }, [open, updatePos])

  // Close on outside click (must check both the container and the portal dropdown)
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as Node
      if (
        !containerRef.current?.contains(target) &&
        !dropdownRef.current?.contains(target)
      ) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // Debounced search — always starts a fresh page-1 fetch for both tables
  useEffect(() => {
    clearTimeout(searchTimeout.current)
    if (!query.trim() || !orgId) {
      searchGenRef.current++
      setInflows([]); setOutflows([])
      setInflowTotal(0); setOutflowTotal(0)
      setLoadingMoreIn(false); setLoadingMoreOut(false)
      setOpen(false)
      return
    }

    searchTimeout.current = setTimeout(async () => {
      const myGen = ++searchGenRef.current
      setLoading(true)
      setLoadingMoreIn(false); setLoadingMoreOut(false)
      const likeQ     = toLikePattern(query)
      const scopeBank = !allBanks && !!bankName
      const params     = { orgId, likeQ, scopeBank, bankName, excludeId, limit: PAGE_SIZE }

      const [inflowRes, outflowRes] = await Promise.all([
        fetchRootInflows(params),
        fetchRootOutflows(params),
      ])

      if (searchGenRef.current !== myGen) return   // superseded by a newer search

      const mappedInflows  = (inflowRes.data  ?? []).map(mapInflowRow)
      const mappedOutflows = (outflowRes.data ?? []).map(mapOutflowRow)

      setInflows(mappedInflows)
      setOutflows(mappedOutflows)
      setInflowTotal(inflowRes.count ?? mappedInflows.length)
      setOutflowTotal(outflowRes.count ?? mappedOutflows.length)
      setOpen(mappedInflows.length > 0 || mappedOutflows.length > 0)
      setLoading(false)
    }, 300)

    return () => clearTimeout(searchTimeout.current)
  }, [query, orgId, bankName, allBanks, excludeId])

  // Load more — re-fetches the same search at a bigger limit, replacing the
  // section's results. Superseded automatically if a fresh search starts
  // while this is in flight (searchGenRef check below).
  const loadMoreInflows = async () => {
    if (!orgId || !query.trim() || loadingMoreIn) return
    const myGen = searchGenRef.current
    setLoadingMoreIn(true)
    const res = await fetchRootInflows({
      orgId, likeQ: toLikePattern(query), scopeBank: !allBanks && !!bankName,
      bankName, excludeId, limit: inflows.length + PAGE_SIZE,
    })
    if (searchGenRef.current !== myGen) return
    setInflows((res.data ?? []).map(mapInflowRow))
    setInflowTotal(res.count ?? inflows.length)
    setLoadingMoreIn(false)
  }

  const loadMoreOutflows = async () => {
    if (!orgId || !query.trim() || loadingMoreOut) return
    const myGen = searchGenRef.current
    setLoadingMoreOut(true)
    const res = await fetchRootOutflows({
      orgId, likeQ: toLikePattern(query), scopeBank: !allBanks && !!bankName,
      bankName, excludeId, limit: outflows.length + PAGE_SIZE,
    })
    if (searchGenRef.current !== myGen) return
    setOutflows((res.data ?? []).map(mapOutflowRow))
    setOutflowTotal(res.count ?? outflows.length)
    setLoadingMoreOut(false)
  }

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

  // ── Result row ─────────────────────────────────────────────────────────────
  const renderRow = (r: SearchResult) => (
    <li
      key={`${r.direction}-${r.id}`}
      onMouseDown={e => { e.preventDefault(); select(r) }}
      className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-primary/5 transition-colors"
    >
      <span className={`shrink-0 px-1.5 py-0.5 rounded text-xs font-bold ${
        r.direction === 'in'
          ? 'bg-green-100 text-green-700'
          : 'bg-red-100 text-red-700'
      }`}>
        {r.direction === 'in' ? 'IN' : 'OUT'}
      </span>
      {r.offsetRole && (
        <span className={`shrink-0 px-1.5 py-0.5 rounded text-xs font-bold ${
          r.offsetRole === 'root'
            ? 'bg-green-50 text-green-600 border border-green-200'
            : 'bg-amber-50 text-amber-600 border border-amber-200'
        }`} title={r.offsetRole === 'root' ? 'This transaction is a root (has an offset linked to it)' : 'This transaction is already tagged as an offset'}>
          {r.offsetRole === 'root' ? 'R' : 'O'}
        </span>
      )}
      <span className="text-xs text-gray-500 whitespace-nowrap">
        {formatDate(r.date)}
      </span>
      <span className="text-xs font-semibold text-gray-800 whitespace-nowrap">
        {formatCurrency(r.amount, baseCurrencyCode)}
      </span>
      <span className="text-xs text-gray-600 truncate min-w-0">
        {r.description ?? '—'}
      </span>
      {r.bank_name && r.bank_name !== bankName && (
        <span className="text-xs text-gray-500 shrink-0 whitespace-nowrap">
          {r.bank_name}
        </span>
      )}
    </li>
  )

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
  const dropdown = open && (inflows.length > 0 || outflows.length > 0)
    ? createPortal(
        <ul
          ref={dropdownRef}
          style={dropdownStyle}
          className="max-h-80 overflow-y-auto bg-white border border-gray-200 rounded-lg shadow-lg py-1"
        >
          {inflows.length > 0 && (
            <>
              <li className="px-3 py-1 text-xs font-semibold text-green-700 bg-green-50 border-b border-green-100 sticky top-0">
                Inflows ({inflowTotal > inflows.length ? `${inflows.length} of ${inflowTotal}` : inflows.length})
              </li>
              {inflows.map(renderRow)}
              {inflowTotal > inflows.length && (
                <li>
                  <button
                    type="button"
                    disabled={loadingMoreIn}
                    onMouseDown={e => { e.preventDefault(); loadMoreInflows() }}
                    className="w-full flex items-center justify-center gap-2 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {loadingMoreIn ? (
                      <span className="w-3 h-3 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
                    ) : (
                      `Show ${Math.min(PAGE_SIZE, inflowTotal - inflows.length)} more`
                    )}
                  </button>
                </li>
              )}
            </>
          )}
          {outflows.length > 0 && (
            <>
              <li className={`px-3 py-1 text-xs font-semibold text-red-700 bg-red-50 border-b border-red-100 sticky top-0 ${inflows.length > 0 ? 'border-t border-gray-100 mt-1' : ''}`}>
                Outflows ({outflowTotal > outflows.length ? `${outflows.length} of ${outflowTotal}` : outflows.length})
              </li>
              {outflows.map(renderRow)}
              {outflowTotal > outflows.length && (
                <li>
                  <button
                    type="button"
                    disabled={loadingMoreOut}
                    onMouseDown={e => { e.preventDefault(); loadMoreOutflows() }}
                    className="w-full flex items-center justify-center gap-2 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {loadingMoreOut ? (
                      <span className="w-3 h-3 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
                    ) : (
                      `Show ${Math.min(PAGE_SIZE, outflowTotal - outflows.length)} more`
                    )}
                  </button>
                </li>
              )}
            </>
          )}
        </ul>,
        document.body
      )
    : null

  return (
    <div ref={containerRef} className="relative space-y-1.5">
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search by description or transaction ref…"
          className="w-full pl-8 pr-3 py-2 text-sm border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-primary/30 bg-white"
        />
        {loading && (
          <div className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
        )}
      </div>

      {/* Bank scope toggle */}
      {bankName && (
        <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer select-none">
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

      {dropdown}
    </div>
  )
}
