import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useOrgStore } from '../store/orgStore'
import { fetchAllRows } from '../utils/fetchAllRows'

// All-time aggregates for the Bank Deposits & Transfers hub.
//
// Real events live in three places: the dedicated bank_deposits /
// intrabank_transfers tables (this page's own add-form), plus
// inflow_transactions / outflow_transactions rows tagged with the matching
// transaction_type (the Import pipeline's route into the same activity).
// The tagged rows come in root+offset pairs recording one physical event
// twice (root = the source side, offset = its counterpart) — DepositsPanel's
// and TransfersPanel's own reconciliation strips confirm root and offset
// amounts are meant to balance. Summing every row would double the total,
// so tagged rows are only counted when offset_role !== 'offset'.

export interface MonthPoint { month: string; amount: number } // month = 'YYYY-MM'
export interface BankVolume { name: string; value: number }

export interface BankMovementSummary {
  deposits: { total: number; count: number; monthly: MonthPoint[] }
  transfers: { total: number; count: number; byBank: BankVolume[] }
  loading: boolean
  error: string | null
  refetch: () => void
}

type TaggedRaw = { date: string; amount: number; bank_name: string | null; offset_role: string | null }
type DepositRaw  = { date: string; amount: number; bank_name: string | null }
type TransferRaw = { date: string; amount: number; from_bank_name: string | null; to_bank_name: string | null }

const isRootOrUntagged = (r: { offset_role: string | null }) => r.offset_role !== 'offset'

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

    const [depRes, depInRes, depOutRes, txRes, txInRes, txOutRes] = await Promise.all([
      fetchAllRows(() => supabase
        .from('bank_deposits')
        .select('date, amount, bank_name')
        .eq('org_id', orgId)),
      fetchAllRows(() => supabase
        .from('inflow_transactions')
        .select('date, amount, bank_name, offset_role')
        .eq('org_id', orgId).eq('transaction_type', 'bank_deposit')),
      fetchAllRows(() => supabase
        .from('outflow_transactions')
        .select('date, amount:amount_disbursed, bank_name, offset_role')
        .eq('org_id', orgId).eq('transaction_type', 'bank_deposit')),
      fetchAllRows(() => supabase
        .from('intrabank_transfers')
        .select('date, amount, from_bank_name, to_bank_name')
        .eq('org_id', orgId)),
      fetchAllRows(() => supabase
        .from('inflow_transactions')
        .select('date, amount, bank_name, offset_role')
        .eq('org_id', orgId).eq('transaction_type', 'intrabank_transfer')),
      fetchAllRows(() => supabase
        .from('outflow_transactions')
        .select('date, amount:amount_disbursed, bank_name, offset_role')
        .eq('org_id', orgId).eq('transaction_type', 'intrabank_transfer')),
    ])

    const firstError = depRes.error ?? depInRes.error ?? depOutRes.error ?? txRes.error ?? txInRes.error ?? txOutRes.error
    if (firstError) {
      setError(firstError.message)
      setLoading(false)
      return
    }

    const depositEvents = [
      ...(depRes.data as DepositRaw[]),
      ...(depInRes.data as TaggedRaw[]).filter(isRootOrUntagged),
      ...(depOutRes.data as TaggedRaw[]).filter(isRootOrUntagged),
    ]

    const monthMap = new Map<string, number>()
    let depTotal = 0
    for (const r of depositEvents) {
      const amt = Number(r.amount)
      depTotal += amt
      const ym = r.date.slice(0, 7)
      monthMap.set(ym, (monthMap.get(ym) ?? 0) + amt)
    }
    const monthly = Array.from(monthMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, amount]) => ({ month, amount }))
      .slice(-6)

    const txBankEvents = (txRes.data as TransferRaw[])
    const txInEvents   = (txInRes.data  as TaggedRaw[]).filter(isRootOrUntagged)
    const txOutEvents  = (txOutRes.data as TaggedRaw[]).filter(isRootOrUntagged)

    const bankVolume = new Map<string, number>()
    let txTotal = 0
    for (const r of txBankEvents) {
      const amt = Number(r.amount)
      txTotal += amt
      if (r.from_bank_name) bankVolume.set(r.from_bank_name, (bankVolume.get(r.from_bank_name) ?? 0) + amt)
      if (r.to_bank_name)   bankVolume.set(r.to_bank_name,   (bankVolume.get(r.to_bank_name)   ?? 0) + amt)
    }
    for (const r of txInEvents) {
      const amt = Number(r.amount)
      txTotal += amt
      if (r.bank_name) bankVolume.set(r.bank_name, (bankVolume.get(r.bank_name) ?? 0) + amt)
    }
    for (const r of txOutEvents) {
      const amt = Number(r.amount)
      txTotal += amt
      if (r.bank_name) bankVolume.set(r.bank_name, (bankVolume.get(r.bank_name) ?? 0) + amt)
    }
    const byBank = Array.from(bankVolume.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)

    setDeposits({ total: depTotal, count: depositEvents.length, monthly })
    setTransfers({ total: txTotal, count: txBankEvents.length + txInEvents.length + txOutEvents.length, byBank })
    setLoading(false)
  }, [orgId])

  useEffect(() => { fetch() }, [fetch])

  return { deposits, transfers, loading, error, refetch: fetch }
}
