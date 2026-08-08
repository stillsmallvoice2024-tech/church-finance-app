import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useOrgStore } from '../store/orgStore'
import { useBanks } from './useBanks'
import { fetchAllRows } from '../utils/fetchAllRows'
import { BALANCE_BROUGHT_FORWARD_TYPE } from '../utils/bankOpeningBalance'

// Current balance per bank: starting_balance + all-time inflows − outflows,
// mirroring the exact math BankLedger's own per-bank load() already does
// (excluding synthetic balance_brought_forward inflow rows, which are the
// same opening balance counted a second way).
//
// The sums come from `org_bank_balance_totals` (migration 20260807000003),
// which returns one row per bank. Before that this hook downloaded the org's
// entire inflow AND outflow history — every transaction ever recorded — purely
// to add up a handful of numbers. The client-side pass is kept below as the
// fallback for a database without the migration; both produce identical
// figures.

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

// Totals keyed the way the JS pass keyed them: by bank_id where the row has
// one, otherwise by bank_name for rows predating the bank_id backfill.
interface BankTotals {
  byId:   Map<string, { inflow: number; outflow: number }>
  byName: Map<string, { inflow: number; outflow: number }>
}

const emptyTotals = (): BankTotals => ({ byId: new Map(), byName: new Map() })

function bucket(totals: BankTotals, id: string | null, name: string | null) {
  const map = id ? totals.byId : totals.byName
  const key = id || name
  if (!key) return null
  let e = map.get(key)
  if (!e) { e = { inflow: 0, outflow: 0 }; map.set(key, e) }
  return e
}

interface BankTotalsRow {
  bank_id:       string | null
  bank_name:     string | null
  inflow_total:  number
  outflow_total: number
}

// Flipped to false the first time the RPC comes back missing, so an unmigrated
// database pays the failed round-trip once per session rather than per load.
let balanceRpcAvailable = true

async function fetchBankTotals(orgId: string): Promise<{ totals: BankTotals | null; error: string | null }> {
  if (balanceRpcAvailable) {
    const { data, error } = await supabase.rpc('org_bank_balance_totals', { p_org_id: orgId })
    if (!error) {
      const totals = emptyTotals()
      for (const r of (data ?? []) as BankTotalsRow[]) {
        const e = bucket(totals, r.bank_id, r.bank_name)
        if (!e) continue
        e.inflow  += Number(r.inflow_total)
        e.outflow += Number(r.outflow_total)
      }
      return { totals, error: null }
    }
    balanceRpcAvailable = false
  }

  // Fallback: the original full-history client-side pass.
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
    return { totals: null, error: (inflowRes.error ?? outflowRes.error)!.message }
  }

  const totals = emptyTotals()
  for (const r of inflowRes.data as { bank_id: string | null; bank_name: string | null; amount: number; transaction_type: string | null }[]) {
    if (r.transaction_type === BALANCE_BROUGHT_FORWARD_TYPE) continue
    const e = bucket(totals, r.bank_id, r.bank_name)
    if (e) e.inflow += Number(r.amount)
  }
  for (const r of outflowRes.data as { bank_id: string | null; bank_name: string | null; amount_disbursed: number }[]) {
    const e = bucket(totals, r.bank_id, r.bank_name)
    if (e) e.outflow += Number(r.amount_disbursed)
  }
  return { totals, error: null }
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

    const { totals, error: totalsError } = await fetchBankTotals(orgId)
    if (!totals) {
      setError(totalsError)
      setLoading(false)
      return
    }

    // bank_id is the authoritative key (immune to renames); bank_name is only
    // used as a fallback for rows written before the bank_id backfill ran, so a
    // bank's balance is the sum of both keys.
    const result: BankBalance[] = banks.map(b => {
      const byId   = totals.byId.get(b.id)
      const byName = totals.byName.get(b.name)
      return {
        id:        b.id,
        name:      b.name,
        currency:  b.currency,
        isForeign: b.is_foreign_currency,
        balance:   (b.starting_balance ?? 0)
          + (byId?.inflow  ?? 0) + (byName?.inflow  ?? 0)
          - (byId?.outflow ?? 0) - (byName?.outflow ?? 0),
      }
    })

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
