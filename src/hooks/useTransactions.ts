import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import type { InflowType } from '../utils/inflowTypes'

// ── DB row types (mirror the exact columns in schema.sql) ──────────────────────

export interface InflowTransaction {
  id: string
  date: string
  description: string | null
  amount: number
  inflow_type: InflowType
  stage_code_1: string | null
  stage_code_2: string | null
  stage_code_3: string | null
  transaction_ref: string | null
  specific_seed_description: string | null
  remark: string | null
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
  amount_disbursed: number
  amount_refunded: number
  transfer_charge: number
  actual_amount: number
  bank_total: number
  stage_code_1: string | null
  stage_code_2: string | null
  remarks: string | null
  is_pending_deduction: boolean
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
  created_by: string | null
  created_at: string
}

// ── Filter interfaces ──────────────────────────────────────────────────────────

export interface TransactionFilters {
  dateFrom?: string
  dateTo?: string
  stageCode?: string   // filters on stage_code_1
  search?: string      // ilike match on description
  pendingOnly?: boolean // filter outflows by is_pending_deduction = true
  page?: number        // 0-indexed
  pageSize?: number
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
  const { dateFrom, dateTo, stageCode, search, page = 0, pageSize = 50 } = filters

  const [data, setData] = useState<InflowTransaction[]>([])
  const [count, setCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetch = useCallback(async () => {
    setLoading(true)
    setError(null)

    const from = page * pageSize
    const to = from + pageSize - 1

    let query = supabase
      .from('inflow_transactions')
      .select('*', { count: 'exact' })
      .order('date', { ascending: false })
      .range(from, to)

    if (dateFrom) query = query.gte('date', dateFrom)
    if (dateTo)   query = query.lte('date', dateTo)
    if (stageCode) query = query.eq('stage_code_1', stageCode)
    if (search)   query = query.ilike('description', `%${search}%`)

    const { data: rows, count: total, error: err } = await query

    if (err) {
      setError(err.message)
    } else {
      setData((rows ?? []) as InflowTransaction[])
      setCount(total ?? 0)
    }
    setLoading(false)
  }, [dateFrom, dateTo, stageCode, search, page, pageSize])

  useEffect(() => { fetch() }, [fetch])

  return { data, count, loading, error, refetch: fetch }
}

// ── useOutflowTransactions ─────────────────────────────────────────────────────

export function useOutflowTransactions(
  filters: TransactionFilters = {},
): PaginatedResult<OutflowTransaction> {
  const { dateFrom, dateTo, stageCode, search, pendingOnly, page = 0, pageSize = 50 } = filters

  const [data, setData] = useState<OutflowTransaction[]>([])
  const [count, setCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetch = useCallback(async () => {
    setLoading(true)
    setError(null)

    const from = page * pageSize
    const to = from + pageSize - 1

    let query = supabase
      .from('outflow_transactions')
      .select('*', { count: 'exact' })
      .order('date', { ascending: false })
      .range(from, to)

    if (dateFrom)    query = query.gte('date', dateFrom)
    if (dateTo)      query = query.lte('date', dateTo)
    if (stageCode)   query = query.eq('stage_code_1', stageCode)
    if (search)      query = query.ilike('description', `%${search}%`)
    if (pendingOnly) query = query.eq('is_pending_deduction', true)

    const { data: rows, count: total, error: err } = await query

    if (err) {
      setError(err.message)
    } else {
      setData((rows ?? []) as OutflowTransaction[])
      setCount(total ?? 0)
    }
    setLoading(false)
  }, [dateFrom, dateTo, stageCode, search, page, pageSize])

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
