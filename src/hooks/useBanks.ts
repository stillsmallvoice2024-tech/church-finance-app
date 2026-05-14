import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'

export interface StartingBalanceRow {
  category_name:      string
  budget_portion:     string
  percentage?:        number
  amount?:            number
  apply_to_category?: boolean  // true (default) = add to category balance; false = already in records
}

export interface DbBank {
  id:             string
  name:           string
  account_number: string | null
  account_type:   string | null
  currency:       string   // 'NGN' | 'USD' | 'GBP' | 'EUR' | 'CNY'
  starting_balance:               number | null
  starting_balance_category:      string | null
  starting_balance_budget_portion: string | null
  starting_balance_alloc_type:    string | null
  starting_balance_allocations:   StartingBalanceRow[]
  created_at:     string
}

export interface BanksResult {
  banks:   DbBank[]
  loading: boolean
  error:   string | null
  refetch: () => void
}

export type SchemaStatus = 'ok' | 'migration_needed' | 'cache_stale'

export async function checkBankStartingBalanceMigration(): Promise<SchemaStatus> {
  // Try information_schema via the helper view — unaffected by PostgREST column cache
  const { data, error: viewErr } = await supabase
    .from('bank_schema_check')
    .select('column_name')
  if (!viewErr && data) {
    const cols = new Set(data.map((r: { column_name: string }) => r.column_name))
    if (!cols.has('starting_balance') || !cols.has('starting_balance_allocations')) {
      return 'migration_needed'
    }
    // Columns exist in DB — verify PostgREST's table cache also knows about them
    const { error: pgErr } = await supabase
      .from('banks')
      .select('starting_balance, starting_balance_allocations')
      .limit(0)
    return pgErr ? 'cache_stale' : 'ok'
  }
  // View not created yet — fall back to PostgREST-only check
  const { error } = await supabase
    .from('banks')
    .select('starting_balance, starting_balance_allocations')
    .limit(0)
  return error ? 'migration_needed' : 'ok'
}

export function useBanks(): BanksResult {
  const [banks,   setBanks]   = useState<DbBank[]>([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)

  const fetch = useCallback(async () => {
    setLoading(true)
    setError(null)

    const { data, error: err } = await supabase
      .from('banks')
      .select('*')
      .order('name', { ascending: true })

    if (err) setError(err.message)
    else     setBanks((data ?? []) as DbBank[])
    setLoading(false)
  }, [])

  useEffect(() => { fetch() }, [fetch])

  return { banks, loading, error, refetch: fetch }
}
