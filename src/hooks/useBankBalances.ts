import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useOrgStore } from '../store/orgStore'
import { useBanks } from './useBanks'
import { fetchAllRows } from '../utils/fetchAllRows'
import { BALANCE_BROUGHT_FORWARD_TYPE } from '../utils/bankOpeningBalance'

// Current balance per bank: starting_balance + all-time inflows − outflows,
// mirroring the exact math BankLedger's own per-bank load() already does
// (excluding synthetic balance_brought_forward inflow rows, which are the
// same opening balance counted a second way). Aggregated client-side from
// minimal columns — no per-bank query, one pass over all transactions.

export interface BankBalance {
  id:        string
  name:      string
  currency:  string
  isForeign: boolean
  balance:   number
}

export interface BankBalancesResult {
  balances: BankBalance[]
  loading:  boolean
  error:    string | null
  refetch:  () => void
}

export function useBankBalances(): BankBalancesResult {
  const orgId = useOrgStore(s => s.orgId)
  const { banks, loading: banksLoading, error: banksError, refetch: refetchBanks } = useBanks()

  const [balances, setBalances] = useState<BankBalance[]>([])
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!orgId || banksLoading) return
    if (banks.length === 0) { setBalances([]); setLoading(false); return }
    setLoading(true)
    setError(null)

    const [inflowRes, outflowRes] = await Promise.all([
      fetchAllRows(() => supabase
        .from('inflow_transactions')
        .select('bank_id, bank_name, amount, transaction_type')
        .eq('org_id', orgId)),
      fetchAllRows(() => supabase
        .from('outflow_transactions')
        .select('bank_id, bank_name, amount_disbursed')
        .eq('org_id', orgId)),
    ])

    if (inflowRes.error || outflowRes.error) {
      setError((inflowRes.error ?? outflowRes.error)!.message)
      setLoading(false)
      return
    }

    // bank_id is the authoritative key (immune to renames); bank_name is only
    // used as a fallback for rows written before the bank_id backfill ran.
    const inflowById = new Map<string, number>()
    const inflowByName = new Map<string, number>()
    for (const r of inflowRes.data as { bank_id: string | null; bank_name: string | null; amount: number; transaction_type: string | null }[]) {
      if (r.transaction_type === BALANCE_BROUGHT_FORWARD_TYPE) continue
      if (r.bank_id) inflowById.set(r.bank_id, (inflowById.get(r.bank_id) ?? 0) + Number(r.amount))
      else if (r.bank_name) inflowByName.set(r.bank_name, (inflowByName.get(r.bank_name) ?? 0) + Number(r.amount))
    }

    const outflowById = new Map<string, number>()
    const outflowByName = new Map<string, number>()
    for (const r of outflowRes.data as { bank_id: string | null; bank_name: string | null; amount_disbursed: number }[]) {
      if (r.bank_id) outflowById.set(r.bank_id, (outflowById.get(r.bank_id) ?? 0) + Number(r.amount_disbursed))
      else if (r.bank_name) outflowByName.set(r.bank_name, (outflowByName.get(r.bank_name) ?? 0) + Number(r.amount_disbursed))
    }

    const result: BankBalance[] = banks.map(b => ({
      id:        b.id,
      name:      b.name,
      currency:  b.currency,
      isForeign: b.is_foreign_currency,
      balance:   (b.starting_balance ?? 0)
        + (inflowById.get(b.id) ?? 0) + (inflowByName.get(b.name) ?? 0)
        - (outflowById.get(b.id) ?? 0) - (outflowByName.get(b.name) ?? 0),
    }))

    setBalances(result)
    setLoading(false)
  }, [orgId, banks, banksLoading])

  useEffect(() => { load() }, [load])

  return {
    balances,
    loading: loading || banksLoading,
    error:   error ?? banksError,
    refetch: () => { refetchBanks(); load() },
  }
}
