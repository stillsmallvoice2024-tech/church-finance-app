import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'

export interface DbBank {
  id:             string
  name:           string
  account_number: string | null
  account_type:   string | null
  starting_balance:               number | null
  starting_balance_category:      string | null
  starting_balance_budget_portion: string | null
  created_at:     string
}

export interface BanksResult {
  banks:   DbBank[]
  loading: boolean
  error:   string | null
  refetch: () => void
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
