import { useState, useEffect, useCallback } from 'react'
import { useOrgStore } from '../store/orgStore'
import { computeFundBuckets } from '../utils/fundBuckets'

// Point-in-time balances for the Funds "Simple" view. Reuses the shared
// fund-bucket engine (the CategoryLedger card algorithm) so numbers match the
// detailed tabs exactly. No date range — balances are current.

export type FundGroup = 'regular' | 'designated' | 'savings'

export interface FundRow {
  key:     string       // group + name (unique)
  name:    string
  group:   FundGroup
  balance: number
}

export interface FundsSummary {
  funds:        FundRow[]                             // all non-zero funds, sorted by |balance| desc
  groupTotals:  Record<FundGroup, number>
  total:        number                                // sum of the three group totals
  loading:      boolean
  error:        string | null
  refetch:      () => void
}

const NEGLIGIBLE = 0.005

export function useFundsSummary(): FundsSummary {
  const orgId = useOrgStore((s) => s.orgId)

  const [funds,       setFunds]       = useState<FundRow[]>([])
  const [groupTotals, setGroupTotals] = useState<Record<FundGroup, number>>({ regular: 0, designated: 0, savings: 0 })
  const [total,       setTotal]       = useState(0)
  const [loading,     setLoading]     = useState(true)
  const [error,       setError]       = useState<string | null>(null)

  const fetch = useCallback(async () => {
    if (!orgId) { setLoading(false); return }
    setLoading(true)
    setError(null)

    const fb = await computeFundBuckets(orgId)
    if (fb.error) { setError(fb.error); setLoading(false); return }

    const rows: FundRow[] = []
    let regular = 0, savings = 0, designated = 0

    for (const [category, b] of fb.byCategory) {
      const pctNet = b.pctIn - b.pctOut
      const savNet = b.savIn - b.savOut
      regular += pctNet
      savings += savNet
      if (Math.abs(pctNet) > NEGLIGIBLE) rows.push({ key: `regular:${category}`, name: category, group: 'regular', balance: pctNet })
      if (Math.abs(savNet) > NEGLIGIBLE) rows.push({ key: `savings:${category}`, name: category, group: 'savings', balance: savNet })
    }

    for (const targets of fb.seedTargets.values()) {
      for (const t of targets) {
        designated += t.total
        if (Math.abs(t.total) > NEGLIGIBLE) rows.push({ key: `designated:${t.target}`, name: t.target, group: 'designated', balance: t.total })
      }
    }

    rows.sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance))

    setFunds(rows)
    setGroupTotals({ regular, designated, savings })
    setTotal(regular + designated + savings)
    setLoading(false)
  }, [orgId])

  useEffect(() => { fetch() }, [fetch])

  return { funds, groupTotals, total, loading, error, refetch: fetch }
}
