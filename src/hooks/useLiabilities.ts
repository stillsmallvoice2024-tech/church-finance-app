import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useOrgStore } from '../store/orgStore'

// ── Types ──────────────────────────────────────────────────────────────────────

export const LIABILITY_TYPES = [
  'Loan',
  'Accounts Payable',
  'Credit Line',
  'Mortgage',
  'Bond',
  'Other',
] as const

export type LiabilityType = typeof LIABILITY_TYPES[number]

export interface Liability {
  id:                  string
  name:                string
  liability_type:      string
  lender:              string | null
  principal_amount:    number
  outstanding_balance: number
  interest_rate:       number | null
  repayment_notes:     string | null
  due_date:            string | null
  notes:               string | null
  created_at:          string
}

export interface LiabilityInput {
  name:                string
  liability_type:      string
  lender:              string | null
  principal_amount:    number
  outstanding_balance: number
  interest_rate:       number | null
  repayment_notes:     string | null
  due_date:            string | null
  notes:               string | null
}

// ── Hook ───────────────────────────────────────────────────────────────────────

export function useLiabilities() {
  const orgId = useOrgStore(s => s.orgId)

  const [liabilities, setLiabilities] = useState<Liability[]>([])
  const [loading,     setLoading]     = useState(true)
  const [error,       setError]       = useState<string | null>(null)

  const fetch = useCallback(async () => {
    if (!orgId) { setLoading(false); return }
    setLoading(true); setError(null)
    const { data, error: err } = await supabase
      .from('liabilities')
      .select('*')
      .eq('org_id', orgId)
      .order('created_at', { ascending: false })
    if (err) {
      if (/relation.*does not exist/i.test(err.message)) setLiabilities([])
      else setError(err.message)
    } else {
      setLiabilities((data ?? []) as Liability[])
    }
    setLoading(false)
  }, [orgId])

  useEffect(() => { fetch() }, [fetch])

  return { liabilities, loading, error, refetch: fetch }
}

// ── Mutations ──────────────────────────────────────────────────────────────────

export async function saveLiability(input: LiabilityInput, existingId?: string): Promise<void> {
  const { orgId } = useOrgStore.getState()
  if (!orgId) throw new Error('No active organisation.')
  if (existingId) {
    const { error } = await supabase.from('liabilities').update(input).eq('id', existingId)
    if (error) throw new Error(error.message)
  } else {
    const { error } = await supabase.from('liabilities').insert({ ...input, org_id: orgId })
    if (error) throw new Error(error.message)
  }
}

export async function deleteLiability(id: string): Promise<void> {
  const { error, count } = await supabase
    .from('liabilities').delete({ count: 'exact' }).eq('id', id)
  if (error) throw new Error(error.message)
  if (count === 0) throw new Error('Record not found or access denied.')
}
