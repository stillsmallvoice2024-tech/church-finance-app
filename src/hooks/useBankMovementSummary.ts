import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useOrgStore } from '../store/orgStore'
import { fetchAllRows } from '../utils/fetchAllRows'

// All-time aggregates for the Bank Deposits & Transfers hub. Sourced from the
// two dedicated tables only (bank_deposits, intrabank_transfers) — not the
// inflow/outflow "offset" rows those actions also create — so the hub shows
// one honest count per real-world event instead of the root+offset pairing
// the Full tabs reconcile against.

export interface MonthPoint { month: string; amount: number } // month = 'YYYY-MM'
export interface BankVolume { name: string; value: number }

export interface BankMovementSummary {
  deposits: { total: number; count: number; monthly: MonthPoint[] }
  transfers: { total: number; count: number; byBank: BankVolume[] }
  loading: boolean
  error: string | null
  refetch: () => void
}

type DepositRaw  = { date: string; amount: number; bank_name: string | null }
type TransferRaw = { date: string; amount: number; from_bank_name: string | null; to_bank_name: string | null }

export function useBankMovementSummary(): BankMovementSummary {
  const orgId = useOrgStore(s => s.orgId)

  const [deposits,  setDeposits]  = useState<BankMovementSummary['deposits']>({ total: 0, count: 0, monthly: [] })
  const [transfers, setTransfers] = useState<BankMovementSummary['transfers']>({ total: 0, count: 0, byBank: [] })
  const [loading,   setLoading]   = useState(true)
  const [error,     setError]     = useState<string | null>(null)

  const fetch = useCallback(async () => {
    if (!orgId) { setLoading(false); return }
    setLoading(true)
    setError(null)

    const [depRes, txRes] = await Promise.all([
      fetchAllRows(() => supabase
        .from('bank_deposits')
        .select('date, amount, bank_name')
        .eq('org_id', orgId)),
      fetchAllRows(() => supabase
        .from('intrabank_transfers')
        .select('date, amount, from_bank_name, to_bank_name')
        .eq('org_id', orgId)),
    ])

    if (depRes.error || txRes.error) {
      setError((depRes.error ?? txRes.error)!.message)
      setLoading(false)
      return
    }

    const depRows = depRes.data as DepositRaw[]
    const monthMap = new Map<string, number>()
    let depTotal = 0
    for (const r of depRows) {
      const amt = Number(r.amount)
      depTotal += amt
      const ym = r.date.slice(0, 7)
      monthMap.set(ym, (monthMap.get(ym) ?? 0) + amt)
    }
    const monthly = Array.from(monthMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, amount]) => ({ month, amount }))
      .slice(-6)

    const txRows = txRes.data as TransferRaw[]
    const bankVolume = new Map<string, number>()
    let txTotal = 0
    for (const r of txRows) {
      const amt = Number(r.amount)
      txTotal += amt
      if (r.from_bank_name) bankVolume.set(r.from_bank_name, (bankVolume.get(r.from_bank_name) ?? 0) + amt)
      if (r.to_bank_name)   bankVolume.set(r.to_bank_name,   (bankVolume.get(r.to_bank_name)   ?? 0) + amt)
    }
    const byBank = Array.from(bankVolume.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)

    setDeposits({ total: depTotal, count: depRows.length, monthly })
    setTransfers({ total: txTotal, count: txRows.length, byBank })
    setLoading(false)
  }, [orgId])

  useEffect(() => { fetch() }, [fetch])

  return { deposits, transfers, loading, error, refetch: fetch }
}
