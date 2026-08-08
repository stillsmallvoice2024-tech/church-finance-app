import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { normalizeNarration } from '../utils/normalizeNarration'
import { useOrgStore } from '../store/orgStore'
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
  root_transaction_id: string | null
  root_transaction_table: string | null
  offset_link_type: string | null
  offset_role: string | null
  deposit_group_id: string | null
  recorded_at: string | null
  created_by: string | null
  created_at: string
  updated_at: string
  import_seq: number | null
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
  root_transaction_id: string | null
  root_transaction_table: string | null
  offset_link_type: string | null
  offset_role: string | null
  deposit_group_id: string | null
  outflow_type_id: string | null
  outflow_type_name: string | null  // joined from outflow_types; null when unset
  department_id: string | null
  department_name: string | null    // joined from departments; null when unset
  recorded_at: string | null
  created_by: string | null
  created_at: string
  updated_at: string
  import_seq: number | null
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
  updated_at: string | null
  import_seq: number | null
}

// ── Filter interfaces ──────────────────────────────────────────────────────────

export interface TransactionFilters {
  dateFrom?: string
  dateTo?: string
  stageCode?: string    // filters on stage_code_1
  search?: string       // ilike search value
  searchCol?: string    // 'all' (default) or specific DB column key
  pendingOnly?: boolean    // filter outflows by is_pending_deduction = true
  outflowTypeId?: string  // server-side filter on outflow_type_id
  page?: number         // 0-indexed; not used when fetchAll is true
  pageSize?: number     // not used when fetchAll is true
  fetchAll?: boolean    // fetch all rows (up to 10 000) so the caller can filter/paginate client-side
  sortColumn?: string        // DB column to sort by
  sortAscending?: boolean    // true = asc
  advancedSort?: AdvancedSortLevel[]  // multi-level sort; takes priority over sortColumn
  unmappedOnly?: boolean
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
  unmappedCount?: number
  loading: boolean
  error: string | null
  refetch: () => void
}


// ── useInflowTransactions ──────────────────────────────────────────────────────

const INFLOW_SORT_COLS = new Set(['date', 'amount', 'bank_name', 'description', 'transaction_type', 'recorded_at', 'stage_code_1', 'import_seq'])
const INFLOW_SEARCH_COLS = new Set(['description', 'bank_name', 'transaction_ref', 'transaction_type', 'stage_code_1'])

const INFLOW_UNMAPPED_OR =
  'and(transaction_type.is.null,allocation_config_id.is.null),' +
  'and(transaction_type.not.is.null,transaction_type.neq.balance_brought_forward,transaction_type.neq.bank_deposit,transaction_type.neq.intrabank_transfer,offset_role.is.null),' +
  'and(transaction_type.not.is.null,transaction_type.neq.balance_brought_forward,transaction_type.neq.bank_deposit,transaction_type.neq.intrabank_transfer,offset_role.eq.offset,root_transaction_id.is.null)'

const OUTFLOW_UNMAPPED_OR =
  'and(transaction_type.is.null,stage_code_1.is.null),' +
  'and(transaction_type.is.null,stage_code_2.is.null),' +
  'and(transaction_type.not.is.null,offset_role.is.null),' +
  'and(transaction_type.not.is.null,offset_role.eq.offset,root_transaction_id.is.null)'

export function useInflowTransactions(
  filters: TransactionFilters = {},
): PaginatedResult<InflowTransaction> {
  const { dateFrom, dateTo, stageCode, search, searchCol, page = 0, pageSize = 50, fetchAll = false, sortColumn, sortAscending, advancedSort, unmappedOnly } = filters

  const orgId = useOrgStore((s) => s.orgId)

  const [data, setData] = useState<InflowTransaction[]>([])
  const [count, setCount] = useState(0)
  const [unmappedCount, setUnmappedCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetch = useCallback(async () => {
    if (!orgId) { setLoading(false); return }
    setLoading(true)
    setError(null)

    let query = supabase
      .from('inflow_transactions')
      .select('*', { count: 'exact' })
      .eq('org_id', orgId)

    // Server-side sort
    if (advancedSort && advancedSort.length > 0) {
      for (const l of advancedSort) {
        if (INFLOW_SORT_COLS.has(l.key)) query = query.order(l.key, { ascending: l.dir === 'asc' })
      }
    } else if (sortColumn && INFLOW_SORT_COLS.has(sortColumn)) {
      query = query.order(sortColumn, { ascending: sortAscending ?? false })
      if (sortColumn !== 'recorded_at') query = query.order('recorded_at', { ascending: false })
      if (sortColumn !== 'import_seq')  query = query.order('import_seq',  { ascending: true })
    } else {
      query = query.order('recorded_at', { ascending: false }).order('import_seq', { ascending: true })
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
      const safeSearch = search.replace(/[%_\\()\[\],{}]/g, '')
      if (!searchCol || searchCol === 'all') {
        query = query.or(`description.ilike.%${safeSearch}%,bank_name.ilike.%${safeSearch}%,transaction_ref.ilike.%${safeSearch}%,transaction_type.ilike.%${safeSearch}%`)
      } else if (INFLOW_SEARCH_COLS.has(searchCol)) {
        query = query.ilike(searchCol, `%${safeSearch}%`)
      }
    }

    if (unmappedOnly) {
      query = query.or(INFLOW_UNMAPPED_OR)
    }

    let cq = supabase
      .from('inflow_transactions')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', orgId)
      .or(INFLOW_UNMAPPED_OR)
    if (dateFrom) cq = cq.gte('date', dateFrom)
    if (dateTo)   cq = cq.lte('date', dateTo)
    if (search) {
      const safeSearch = search.replace(/[%_\\()\[\],{}]/g, '')
      if (!searchCol || searchCol === 'all') {
        cq = cq.or(`description.ilike.%${safeSearch}%,bank_name.ilike.%${safeSearch}%,transaction_ref.ilike.%${safeSearch}%,transaction_type.ilike.%${safeSearch}%`)
      } else if (INFLOW_SEARCH_COLS.has(searchCol)) {
        cq = cq.ilike(searchCol, `%${safeSearch}%`)
      }
    }

    const [{ data: rows, count: total, error: err }, { count: unmappedTotal }] = await Promise.all([query, cq])

    if (err) {
      setError(err.message)
    } else {
      setData((rows ?? []) as InflowTransaction[])
      setCount(total ?? 0)
      setUnmappedCount(unmappedTotal ?? 0)
    }
    setLoading(false)
  }, [orgId, dateFrom, dateTo, stageCode, search, searchCol, page, pageSize, fetchAll, sortColumn, sortAscending, advancedSort, unmappedOnly])

  useEffect(() => { fetch() }, [fetch])

  return { data, count, unmappedCount, loading, error, refetch: fetch }
}

// ── useOutflowTransactions ─────────────────────────────────────────────────────

const OUTFLOW_SORT_COLS = new Set(['date', 'amount_disbursed', 'bank_name', 'description', 'transaction_type', 'recorded_at', 'stage_code_1', 'import_seq'])
const OUTFLOW_SEARCH_COLS = new Set(['description', 'bank_description', 'bank_name', 'transaction_id', 'stage_code_1', 'transaction_type'])

export function useOutflowTransactions(
  filters: TransactionFilters = {},
): PaginatedResult<OutflowTransaction> {
  const { dateFrom, dateTo, stageCode, search, searchCol, pendingOnly, outflowTypeId, page = 0, pageSize = 50, fetchAll = false, sortColumn, sortAscending, advancedSort, unmappedOnly } = filters

  const orgId = useOrgStore((s) => s.orgId)

  const [data, setData] = useState<OutflowTransaction[]>([])
  const [count, setCount] = useState(0)
  const [unmappedCount, setUnmappedCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetch = useCallback(async () => {
    if (!orgId) { setLoading(false); return }
    setLoading(true)
    setError(null)

    let query = supabase
      .from('outflow_transactions')
      .select('*, outflow_types ( name ), departments ( name )', { count: 'exact' })
      .eq('org_id', orgId)

    // Server-side sort
    if (advancedSort && advancedSort.length > 0) {
      for (const l of advancedSort) {
        if (OUTFLOW_SORT_COLS.has(l.key)) query = query.order(l.key, { ascending: l.dir === 'asc' })
      }
    } else if (sortColumn && OUTFLOW_SORT_COLS.has(sortColumn)) {
      query = query.order(sortColumn, { ascending: sortAscending ?? false })
      if (sortColumn !== 'recorded_at') query = query.order('recorded_at', { ascending: false })
      if (sortColumn !== 'import_seq')  query = query.order('import_seq',  { ascending: true })
    } else {
      query = query.order('recorded_at', { ascending: false }).order('import_seq', { ascending: true })
    }

    if (fetchAll) {
      query = query.limit(10000)
    } else {
      query = query.range(page * pageSize, page * pageSize + pageSize - 1)
    }

    if (dateFrom)      query = query.gte('date', dateFrom)
    if (dateTo)        query = query.lte('date', dateTo)
    if (stageCode)     query = query.eq('stage_code_1', stageCode)
    if (pendingOnly)   query = query.eq('is_pending_deduction', true)
    if (outflowTypeId) query = query.eq('outflow_type_id', outflowTypeId)

    // Server-side search
    if (search && !fetchAll) {
      const safeSearch = search.replace(/[%_\\()\[\],{}]/g, '')
      if (!searchCol || searchCol === 'all') {
        query = query.or(`description.ilike.%${safeSearch}%,bank_description.ilike.%${safeSearch}%,bank_name.ilike.%${safeSearch}%,transaction_id.ilike.%${safeSearch}%,stage_code_1.ilike.%${safeSearch}%,transaction_type.ilike.%${safeSearch}%`)
      } else if (searchCol === 'description') {
        query = query.or(`description.ilike.%${safeSearch}%,bank_description.ilike.%${safeSearch}%`)
      } else if (OUTFLOW_SEARCH_COLS.has(searchCol)) {
        query = query.ilike(searchCol, `%${safeSearch}%`)
      }
    }

    if (unmappedOnly) {
      query = query.or(OUTFLOW_UNMAPPED_OR)
    }

    let cq = supabase
      .from('outflow_transactions')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', orgId)
      .or(OUTFLOW_UNMAPPED_OR)
    if (dateFrom)      cq = cq.gte('date', dateFrom)
    if (dateTo)        cq = cq.lte('date', dateTo)
    if (stageCode)     cq = cq.eq('stage_code_1', stageCode)
    if (outflowTypeId) cq = cq.eq('outflow_type_id', outflowTypeId)
    if (search) {
      const safeSearch = search.replace(/[%_\\()\[\],{}]/g, '')
      if (!searchCol || searchCol === 'all') {
        cq = cq.or(`description.ilike.%${safeSearch}%,bank_description.ilike.%${safeSearch}%,bank_name.ilike.%${safeSearch}%,transaction_id.ilike.%${safeSearch}%,stage_code_1.ilike.%${safeSearch}%,transaction_type.ilike.%${safeSearch}%`)
      } else if (searchCol === 'description') {
        cq = cq.or(`description.ilike.%${safeSearch}%,bank_description.ilike.%${safeSearch}%`)
      } else if (OUTFLOW_SEARCH_COLS.has(searchCol)) {
        cq = cq.ilike(searchCol, `%${safeSearch}%`)
      }
    }

    const [{ data: rows, count: total, error: err }, { count: unmappedTotal }] = await Promise.all([query, cq])

    if (err) {
      setError(err.message)
    } else {
      setData(
        (rows ?? []).map(r => {
          const raw  = r as Record<string, unknown>
          const ot   = raw.outflow_types as { name: string } | null
          const dept = raw.departments   as { name: string } | null
          return {
            ...(r as Omit<OutflowTransaction, 'display_description' | 'outflow_type_name' | 'department_name'>),
            display_description: normalizeNarration(
              (raw.description as string | null) ??
              (raw.bank_description as string | null)
            ),
            outflow_type_name: ot?.name   ?? null,
            department_name:   dept?.name ?? null,
          }
        }) as OutflowTransaction[]
      )
      setCount(total ?? 0)
      setUnmappedCount(unmappedTotal ?? 0)
    }
    setLoading(false)
  }, [orgId, dateFrom, dateTo, stageCode, search, searchCol, pendingOnly, outflowTypeId, page, pageSize, fetchAll, sortColumn, sortAscending, advancedSort, unmappedOnly])

  useEffect(() => { fetch() }, [fetch])

  return { data, count, unmappedCount, loading, error, refetch: fetch }
}

// ── useIntraFlows ──────────────────────────────────────────────────────────────

const INTRAFLOW_SORT_COLS = new Set(['date', 'total_amount', 'account_from', 'account_to', 'description', 'import_seq'])
const INTRAFLOW_SEARCH_COLS = new Set(['description', 'account_from', 'account_to'])

export function useIntraFlows(
  filters: IntraFlowFilters = {},
): PaginatedResult<IntraFlowRow> {
  const { dateFrom, dateTo, accountFrom, accountTo, search, searchCol, page = 0, pageSize = 50, sortColumn, sortAscending, advancedSort } = filters

  const orgId = useOrgStore((s) => s.orgId)

  const [data, setData] = useState<IntraFlowRow[]>([])
  const [count, setCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetch = useCallback(async () => {
    if (!orgId) { setLoading(false); return }
    setLoading(true)
    setError(null)

    const from = page * pageSize
    const to = from + pageSize - 1

    let query = supabase
      .from('intra_flows')
      .select('*', { count: 'exact' })
      .eq('org_id', orgId)

    // Server-side sort
    if (advancedSort && advancedSort.length > 0) {
      for (const l of advancedSort) {
        if (INTRAFLOW_SORT_COLS.has(l.key)) query = query.order(l.key, { ascending: l.dir === 'asc' })
      }
    } else if (sortColumn && INTRAFLOW_SORT_COLS.has(sortColumn)) {
      query = query.order(sortColumn, { ascending: sortAscending ?? false })
      if (sortColumn !== 'import_seq') query = query.order('import_seq', { ascending: false })
    } else {
      query = query.order('date', { ascending: false }).order('import_seq', { ascending: false })
    }

    query = query.range(from, to)

    if (dateFrom)    query = query.gte('date', dateFrom)
    if (dateTo)      query = query.lte('date', dateTo)
    if (accountFrom) query = query.ilike('account_from', `%${accountFrom}%`)
    if (accountTo)   query = query.ilike('account_to', `%${accountTo}%`)

    // Server-side search
    if (search) {
      const safeSearch = search.replace(/[%_\\()\[\],{}]/g, '')
      if (!searchCol || searchCol === 'all') {
        query = query.or(`description.ilike.%${safeSearch}%,account_from.ilike.%${safeSearch}%,account_to.ilike.%${safeSearch}%`)
      } else if (INTRAFLOW_SEARCH_COLS.has(searchCol)) {
        query = query.ilike(searchCol, `%${safeSearch}%`)
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
  }, [orgId, dateFrom, dateTo, accountFrom, accountTo, search, searchCol, page, pageSize, sortColumn, sortAscending, advancedSort])

  useEffect(() => { fetch() }, [fetch])

  return { data, count, loading, error, refetch: fetch }
}

// Backwards-compatible thin wrapper used by legacy imports
export { useInflowTransactions as useTransactions }
