import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'

// ── DB row types ───────────────────────────────────────────────────────────────

export interface DbAccount {
  id: string
  code: string
  name: string
  category: 'income' | 'expense' | 'savings' | 'ministry' | 'special' | 'foreign'
  opening_balance: number
  is_active: boolean
  created_at: string
}

export interface LedgerEntry {
  id: string
  account_id: string
  date: string
  description: string | null
  inflow: number
  refund_intraflow: number
  outflow: number
  balance: number
  percentage_part: number | null
  savings_part: number | null
  special_seed_description: string | null
  created_by: string | null
  created_at: string
}

interface DateRange {
  dateFrom?: string
  dateTo?: string
}

// ── useAccounts ────────────────────────────────────────────────────────────────

export interface AccountsResult {
  accounts: DbAccount[]
  loading: boolean
  error: string | null
  refetch: () => void
}

export function useAccounts(): AccountsResult {
  const [accounts, setAccounts] = useState<DbAccount[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetch = useCallback(async () => {
    setLoading(true)
    setError(null)

    const { data, error: err } = await supabase
      .from('accounts')
      .select('*')
      .eq('is_active', true)
      .order('code', { ascending: true })

    if (err) {
      setError(err.message)
    } else {
      setAccounts((data ?? []) as DbAccount[])
    }
    setLoading(false)
  }, [])

  useEffect(() => { fetch() }, [fetch])

  return { accounts, loading, error, refetch: fetch }
}

// ── useLedgerEntries ───────────────────────────────────────────────────────────

export interface LedgerResult {
  entries: LedgerEntry[]
  runningBalance: number   // latest balance value (last entry's balance field)
  loading: boolean
  error: string | null
  refetch: () => void
}

export function useLedgerEntries(accountId: string, dateRange?: DateRange): LedgerResult {
  const [entries, setEntries] = useState<LedgerEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const dateFrom = dateRange?.dateFrom
  const dateTo   = dateRange?.dateTo

  const fetch = useCallback(async () => {
    if (!accountId) {
      setEntries([])
      setLoading(false)
      return
    }

    setLoading(true)
    setError(null)

    let query = supabase
      .from('ledger_entries')
      .select('*')
      .eq('account_id', accountId)
      .order('date', { ascending: true })
      .order('created_at', { ascending: true }) // stable tiebreaker

    if (dateFrom) query = query.gte('date', dateFrom)
    if (dateTo)   query = query.lte('date', dateTo)

    const { data, error: err } = await query

    if (err) {
      setError(err.message)
    } else {
      setEntries((data ?? []) as LedgerEntry[])
    }
    setLoading(false)
  }, [accountId, dateFrom, dateTo])

  useEffect(() => { fetch() }, [fetch])

  const runningBalance = entries.length > 0 ? entries[entries.length - 1].balance : 0

  return { entries, runningBalance, loading, error, refetch: fetch }
}
