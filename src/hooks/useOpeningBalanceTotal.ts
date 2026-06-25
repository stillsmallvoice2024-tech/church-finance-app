import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useOrgStore } from '../store/orgStore'

/**
 * Sum of every non-FX bank's `starting_balance` for the active org.
 * Mirrors the dashboard's opening-balance query exactly (see useDashboard.ts)
 * so both surfaces report the same figure. Foreign-currency banks are excluded
 * because their starting_balance is in a foreign denomination and is not
 * additive with the base-currency totals.
 */
export function useOpeningBalanceTotal(): { total: number; loading: boolean } {
  const orgId = useOrgStore((s) => s.orgId)
  const [total,   setTotal]   = useState(0)
  const [loading, setLoading] = useState(true)

  const fetch = useCallback(async () => {
    if (!orgId) { setLoading(false); return }
    setLoading(true)
    const { data } = await supabase
      .from('banks')
      .select('starting_balance')
      .eq('org_id', orgId)
      .eq('is_foreign_currency', false)
    setTotal(
      (data ?? []).reduce(
        (s, r) => s + Number((r as { starting_balance: number | null }).starting_balance ?? 0), 0,
      ),
    )
    setLoading(false)
  }, [orgId])

  useEffect(() => { fetch() }, [fetch])

  return { total, loading }
}
