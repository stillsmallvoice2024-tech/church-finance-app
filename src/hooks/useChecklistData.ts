import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useOrgStore } from '../store/orgStore'
import type { ChecklistData } from '../types/onboarding'

const DEFAULT: ChecklistData = {
  hasDepartments:      false,
  hasBankAccounts:     false,
  hasIncomeTypes:      false,
  hasOutflowTypes:     false,
  hasImportedStatement: false,
  hasInvitedMember:    false,
}

export function useChecklistData() {
  const orgId = useOrgStore(s => s.orgId)
  const [data,    setData]    = useState<ChecklistData>(DEFAULT)
  const [loading, setLoading] = useState(true)

  const fetch = useCallback(async () => {
    if (!orgId) { setLoading(false); return }
    setLoading(true)

    const [depts, banks, incomeTypes, outflowTypes, transactions, members] = await Promise.all([
      supabase.from('departments').select('id', { count: 'exact', head: true }).eq('org_id', orgId),
      supabase.from('banks').select('id', { count: 'exact', head: true }).eq('org_id', orgId),
      supabase
        .from('income_types')
        .select('id', { count: 'exact', head: true })
        .eq('org_id', orgId),
      supabase
        .from('outflow_types')
        .select('id', { count: 'exact', head: true })
        .eq('org_id', orgId)
        .eq('is_system', false),
      supabase
        .from('inflow_transactions')
        .select('id', { count: 'exact', head: true })
        .eq('org_id', orgId)
        .neq('transaction_type', 'balance_brought_forward'),
      supabase
        .from('org_members')
        .select('id', { count: 'exact', head: true })
        .eq('org_id', orgId)
        .eq('status', 'active'),
    ])

    setData({
      hasDepartments:       (depts.count       ?? 0) > 0,
      hasBankAccounts:      (banks.count        ?? 0) > 0,
      hasIncomeTypes:       (incomeTypes.count  ?? 0) > 0,
      hasOutflowTypes:      (outflowTypes.count ?? 0) > 0,
      hasImportedStatement: (transactions.count ?? 0) > 0,
      hasInvitedMember:     (members.count      ?? 0) > 1,
    })
    setLoading(false)
  }, [orgId])

  useEffect(() => { fetch() }, [fetch])

  return { data, loading, refetch: fetch }
}
