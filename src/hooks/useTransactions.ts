import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { normalizeNarration } from '../utils/normalizeNarration'
import type { AdvancedSortLevel } from '../utils/sortUtils'

// ── DB row types (mirror the exact columns in schema.sql) ──────────────────────

export interface InflowTransaction {
  id: string
  date: string
  description: string | null
  amount: number
  stage_code_1: string | null
  stage_code_2: string | null
  stage_code_3: string | null
  transaction_ref: string | null
  specific_seed_description: string | null
  remark: string | null
  bank_name: string | null
  fx_currency: string | null
  fx_amount: number | null
  fx_rate: number | null
  allocation_config_id: string | null
  transaction_type: string | null
  original_transaction_id: string | null
  income_type_id: string | null
  recorded_at: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface OutflowTransaction {
  id: string
  date: string
  transaction_id: string | null
  bank_description: string | null
  description: string | null
  display_description: string  // computed client-side from bank_description; never stored to DB or used for matching
  amount_disbursed: number
  amount_refunded: number
  transfer_charge: number
  actual_amount: number
  bank_total: number
  stage_code_1: string | null
  stage_code_2: string | null
  remarks: string | null
  is_pending_deduction: boolean
  bank_name: string | null
  fx_currency: string | null
  fx_amount: number | null
  fx_rate: number | null
  transaction_type: string | null
  original_transaction_id: string | null
  recorded_at: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface IntraFlowRow {
  id: string
  date: string
  transaction_ref: string | null
  account_from: string | null
  account_to: string | null
  description: string | null
  total_amount: number
  account_from_stage1: string | null
  account_from_stage2: string | null
  account_to_stage1: string | null
  account_to_stage2: string | null
  remark: string | null
  from_category_id: string | null
  to_category_id: string | null
  status: string
  reversal_of_id: string | null
  created_by: string | null
  created_at: string
}

// ── Filter interfaces ──────────────────────────────────────────────────────────

export interface TransactionFilters {
  dateFrom?: string
  dateTo?: string
  stageCode?: string    // filters on stage_code_1
  search?: string       // ilike search value
  searchCol?: string    // 'all' (default) or specific DB column key
  pendingOnly?: boolean // filter outflows by is_pending_deduction = true
  page?: number         // 0-indexed; not used when fetchAll is true
  pageSize?: number     // not used when fetchAll is true
  fetchAll?: boolean    // fetch all rows (up to 10 000) so the caller can filter/paginate client-side
  sortColumn?: string        // DB column to sort by
  sortAscending?: boolean    // true = asc
  advancedSort?: AdvancedSortLevel[]  // multi-level sort; takes priority over sortColumn
}

export interface IntraFlowFilters {
  dateFrom?: string
  dateTo?: string
  accountFrom?: string // ilike match on account_from
  accountTo?: string   // ilike match on account_to
  search?: string
  searchCol?: string   // 'all' (default) or specific DB column key
  page?: number
  pageSize?: number
  sortColumn?: string
  sortAscending?: boolean
  advancedSort?: AdvancedSortLevel[]
}

// ── Shared result type ─────────────────────────────────────────────────────────

export interface PaginatedResult<T> {
  data: T[]
  count: number          // total matching rows (for pagination UI)
  loading: boolean
  error: string | null
  refetch: () => void
}


// ── useInflowTransactions ──────────────────────────────────────────────────────

const INFLOW_SORT_COLS = new Set(['date', 'amount', 'bank_name', 'description', 'transaction_type', 'recorded_at', 'stage_code_1'])
const INFLOW_SEARCH_COLS = new Set(['description', 'bank_name', 'transaction_ref', 'transaction_type', 'stage_code_1'])

export function useInflowTransactions(
  filters: TransactionFilters = {},
): PaginatedResult<InflowTransaction> {
  const { dateFrom, dateTo, stageCode, search, searchCol, page = 0, pageSize = 50, fetchAll = false, sortColumn, sortAscending, advancedSort } = filters

  const [data, setData] = useState<InflowTransaction[]>([])
  const [count, setCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetch = useCallback(async () => {
    setLoading(true)
    setError(null)

    let query = supabase
      .from('inflow_transactions')
      .select('*', { count: 'exact' })

    // Server-side sort
    if (advancedSort && advancedSort.length > 0) {
      for (const l of advancedSort) {
        if (INFLOW_SORT_COLS.has(l.key)) query = query.order(l.key, { ascending: l.dir === 'asc' })
      }
    } else if (sortColumn && INFLOW_SORT_COLS.has(sortColumn)) {
      query = query.order(sortColumn, { ascending: sortAscending ?? false })
      if (sortColumn !== 'recorded_at') query = query.order('recorded_at', { ascending: false })
    } else {
      query = query.order('recorded_at', { ascending: false }).order('date', { ascending: false })
    }

    if (fetchAll) {
      query = query.limit(10000)
    } else {
      query = query.range(page * pageSize, page * pageSize + pageSize - 1)
    }

    if (dateFrom)  query = query.gte('date', dateFrom)
    if (dateTo)    query = query.lte('date', dateTo)
    if (stageCode) query = query.eq('stage_code_1', stageCode)

    // Server-side search
    if (search && !fetchAll) {
      const safeSearch = search.replace(/[(),]/g, '')
      if (!searchCol || searchCol === 'all') {
        query = query.or(`description.ilike.%${safeSearch}%,bank_name.ilike.%${safeSearch}%,transaction_ref.ilike.%${safeSearch}%,transaction_type.ilike.%${safeSearch}%`)
      } else if (INFLOW_SEARCH_COLS.has(searchCol)) {
        query = query.ilike(searchCol, `%${search}%`)
      }
    }

    const { data: rows, count: total, error: err } = await query

    if (err) {
      setError(err.message)
    } else {
      setData((rows ?? []) as InflowTransaction[])
      setCount(total ?? 0)
    }
    setLoading(false)
  }, [dateFrom, dateTo, stageCode, search, searchCol, page, pageSize, fetchAll, sortColumn, sortAscending, advancedSort])

  useEffect(() => { fetch() }, [fetch])

  return { data, count, loading, error, refetch: fetch }
}

// ── useOutflowTransactions ─────────────────────────────────────────────────────

const OUTFLOW_SORT_COLS = new Set(['date', 'amount_disbursed', 'bank_name', 'description', 'transaction_type', 'recorded_at', 'stage_code_1'])
const OUTFLOW_SEARCH_COLS = new Set(['description', 'bank_description', 'bank_name', 'transaction_id', 'stage_code_1', 'transaction_type'])

export function useOutflowTransactions(
  filters: TransactionFilters = {},
): PaginatedResult<OutflowTransaction> {
  const { dateFrom, dateTo, stageCode, search, searchCol, pendingOnly, page = 0, pageSize = 50, fetchAll = false, sortColumn, sortAscending, advancedSort } = filters

  const [data, setData] = useState<OutflowTransaction[]>([])
  const [count, setCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetch = useCallback(async () => {
    setLoading(true)
    setError(null)

    let query = supabase
      .from('outflow_transactions')
      .select('*', { count: 'exact' })

    // Server-side sort
    if (advancedSort && advancedSort.length > 0) {
      for (const l of advancedSort) {
        if (OUTFLOW_SORT_COLS.has(l.key)) query = query.order(l.key, { ascending: l.dir === 'asc' })
      }
    } else if (sortColumn && OUTFLOW_SORT_COLS.has(sortColumn)) {
      query = query.order(sortColumn, { ascending: sortAscending ?? false })
      if (sortColumn !== 'recorded_at') query = query.order('recorded_at', { ascending: false })
    } else {
      query = query.order('recorded_at', { ascending: false }).order('date', { ascending: false })
    }

    if (fetchAll) {
      query = query.limit(10000)
    } else {
      query = query.range(page * pageSize, page * pageSize + pageSize - 1)
    }

    if (dateFrom)  query = query.gte('date', dateFrom)
    if (dateTo)    query = query.lte('date', dateTo)
    if (stageCode) query = query.eq('stage_code_1', stageCode)
    if (pendingOnly) query = query.eq('is_pending_deduction', true)

    // Server-side search
    if (search && !fetchAll) {
      const safeSearch = search.replace(/[(),]/g, '')
      if (!searchCol || searchCol === 'all') {
        query = query.or(`description.ilike.%${safeSearch}%,bank_description.ilike.%${safeSearch}%,bank_name.ilike.%${safeSearch}%,transaction_id.ilike.%${safeSearch}%,stage_code_1.ilike.%${safeSearch}%,transaction_type.ilike.%${safeSearch}%`)
      } else if (searchCol === 'description') {
        query = query.or(`description.ilike.%${safeSearch}%,bank_description.ilike.%${safeSearch}%`)
      } else if (OUTFLOW_SEARCH_COLS.has(searchCol)) {
        query = query.ilike(searchCol, `%${search}%`)
      }
    }

    const { data: rows, count: total, error: err } = await query

    if (err) {
      setError(err.message)
    } else {
      setData(
        (rows ?? []).map(r => ({
          ...(r as Omit<OutflowTransaction, 'display_description'>),
          display_description: normalizeNarration(
            (r as { description?: string | null }).description ??
            (r as { bank_description?: string | null }).bank_description
          ),
        })) as OutflowTransaction[]
      )
      setCount(total ?? 0)
    }
    setLoading(false)
  }, [dateFrom, dateTo, stageCode, search, searchCol, pendingOnly, page, pageSize, fetchAll, sortColumn, sortAscending, advancedSort])

  useEffect(() => { fetch() }, [fetch])

  return { data, count, loading, error, refetch: fetch }
}

// ── useIntraFlows ──────────────────────────────────────────────────────────────

const INTRAFLOW_SORT_COLS = new Set(['date', 'total_amount', 'account_from', 'account_to', 'description'])
const INTRAFLOW_SEARCH_COLS = new Set(['description', 'account_from', 'account_to'])

export function useIntraFlows(
  filters: IntraFlowFilters = {},
): PaginatedResult<IntraFlowRow> {
  const { dateFrom, dateTo, accountFrom, accountTo, search, searchCol, page = 0, pageSize = 50, sortColumn, sortAscending, advancedSort } = filters

  const [data, setData] = useState<IntraFlowRow[]>([])
  const [count, setCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetch = useCallback(async () => {
    setLoading(true)
    setError(null)

    const from = page * pageSize
    const to = from + pageSize - 1

    let query = supabase
      .from('intra_flows')
      .select('*', { count: 'exact' })

    // Server-side sort
    if (advancedSort && advancedSort.length > 0) {
      for (const l of advancedSort) {
        if (INTRAFLOW_SORT_COLS.has(l.key)) query = query.order(l.key, { ascending: l.dir === 'asc' })
      }
    } else if (sortColumn && INTRAFLOW_SORT_COLS.has(sortColumn)) {
      query = query.order(sortColumn, { ascending: sortAscending ?? false })
    } else {
      query = query.order('date', { ascending: false })
    }

    query = query.range(from, to)

    if (dateFrom)    query = query.gte('date', dateFrom)
    if (dateTo)      query = query.lte('date', dateTo)
    if (accountFrom) query = query.ilike('account_from', `%${accountFrom}%`)
    if (accountTo)   query = query.ilike('account_to', `%${accountTo}%`)

    // Server-side search
    if (search) {
      const safeSearch = search.replace(/[(),]/g, '')
      if (!searchCol || searchCol === 'all') {
        query = query.or(`description.ilike.%${safeSearch}%,account_from.ilike.%${safeSearch}%,account_to.ilike.%${safeSearch}%`)
      } else if (INTRAFLOW_SEARCH_COLS.has(searchCol)) {
        query = query.ilike(searchCol, `%${search}%`)
      }
    }

    const { data: rows, count: total, error: err } = await query

    if (err) {
      setError(err.message)
    } else {
      setData((rows ?? []) as IntraFlowRow[])
      setCount(total ?? 0)
    }
    setLoading(false)
  }, [dateFrom, dateTo, accountFrom, accountTo, search, searchCol, page, pageSize, sortColumn, sortAscending, advancedSort])

  useEffect(() => { fetch() }, [fetch])

  return { data, count, loading, error, refetch: fetch }
}

// Backwards-compatible thin wrapper used by legacy imports
export { useInflowTransactions as useTransactions }
