import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { normalizeNarration } from '../utils/normalizeNarration'

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
  search?: string       // ilike match across key text columns; not used when fetchAll is true
  pendingOnly?: boolean // filter outflows by is_pending_deduction = true
  page?: number         // 0-indexed; not used when fetchAll is true
  pageSize?: number     // not used when fetchAll is true
  fetchAll?: boolean    // fetch all rows (up to 10 000) so the caller can filter/paginate client-side
}

export interface IntraFlowFilters {
  dateFrom?: string
  dateTo?: string
  accountFrom?: string // ilike match on account_from
  accountTo?: string   // ilike match on account_to
  search?: string
  page?: number
  pageSize?: number
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

export function useInflowTransactions(
  filters: TransactionFilters = {},
): PaginatedResult<InflowTransaction> {
  const { dateFrom, dateTo, stageCode, search, page = 0, pageSize = 50, fetchAll = false } = filters

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
      .order('created_at', { ascending: false })
      .order('date', { ascending: false })

    if (fetchAll) {
      query = query.limit(10000)
    } else {
      query = query.range(page * pageSize, page * pageSize + pageSize - 1)
    }

    if (dateFrom)             query = query.gte('date', dateFrom)
    if (dateTo)               query = query.lte('date', dateTo)
    if (stageCode)            query = query.eq('stage_code_1', stageCode)
    if (search && !fetchAll)  query = query.or(`description.ilike.%${search}%,bank_name.ilike.%${search}%,transaction_ref.ilike.%${search}%,transaction_type.ilike.%${search}%`)

    const { data: rows, count: total, error: err } = await query

    if (err) {
      setError(err.message)
    } else {
      setData((rows ?? []) as InflowTransaction[])
      setCount(total ?? 0)
    }
    setLoading(false)
  }, [dateFrom, dateTo, stageCode, search, page, pageSize, fetchAll])

  useEffect(() => { fetch() }, [fetch])

  return { data, count, loading, error, refetch: fetch }
}

// ── useOutflowTransactions ─────────────────────────────────────────────────────

export function useOutflowTransactions(
  filters: TransactionFilters = {},
): PaginatedResult<OutflowTransaction> {
  const { dateFrom, dateTo, stageCode, search, pendingOnly, page = 0, pageSize = 50, fetchAll = false } = filters

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
      .order('created_at', { ascending: false })
      .order('date', { ascending: false })

    if (fetchAll) {
      query = query.limit(10000)
    } else {
      query = query.range(page * pageSize, page * pageSize + pageSize - 1)
    }

    if (dateFrom)             query = query.gte('date', dateFrom)
    if (dateTo)               query = query.lte('date', dateTo)
    if (stageCode)            query = query.eq('stage_code_1', stageCode)
    if (search && !fetchAll)  query = query.or(`description.ilike.%${search}%,bank_name.ilike.%${search}%,transaction_id.ilike.%${search}%,stage_code_1.ilike.%${search}%,transaction_type.ilike.%${search}%`)
    if (pendingOnly)          query = query.eq('is_pending_deduction', true)

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
  }, [dateFrom, dateTo, stageCode, search, page, pageSize, fetchAll])

  useEffect(() => { fetch() }, [fetch])

  return { data, count, loading, error, refetch: fetch }
}

// ── useIntraFlows ──────────────────────────────────────────────────────────────

export function useIntraFlows(
  filters: IntraFlowFilters = {},
): PaginatedResult<IntraFlowRow> {
  const { dateFrom, dateTo, accountFrom, accountTo, search, page = 0, pageSize = 50 } = filters

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
      .order('date', { ascending: false })
      .range(from, to)

    if (dateFrom)    query = query.gte('date', dateFrom)
    if (dateTo)      query = query.lte('date', dateTo)
    if (accountFrom) query = query.ilike('account_from', `%${accountFrom}%`)
    if (accountTo)   query = query.ilike('account_to', `%${accountTo}%`)
    if (search)      query = query.ilike('description', `%${search}%`)

    const { data: rows, count: total, error: err } = await query

    if (err) {
      setError(err.message)
    } else {
      setData((rows ?? []) as IntraFlowRow[])
      setCount(total ?? 0)
    }
    setLoading(false)
  }, [dateFrom, dateTo, accountFrom, accountTo, search, page, pageSize])

  useEffect(() => { fetch() }, [fetch])

  return { data, count, loading, error, refetch: fetch }
}

// Backwards-compatible thin wrapper used by legacy imports
export { useInflowTransactions as useTransactions }
