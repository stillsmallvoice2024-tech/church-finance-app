import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useOrgStore } from '../store/orgStore'

// ── Types ──────────────────────────────────────────────────────────────────────

export interface OutflowClassificationRule {
  id:              string
  rule_type:       'keyword' | 'stage_code'
  rule_value:      string
  stage_code_1:    string | null
  stage_code_2:    string | null
  outflow_type_id: string | null
  priority:        number
  created_at:      string
}

// ── useOutflowClassificationRules ──────────────────────────────────────────────
//
// Auto-classification rules for debit rows during import — the outflow
// counterpart to income_type_rules. Rules are returned pre-sorted in evaluation
// order (priority ascending, then oldest first) so `classifyOutflow` can take
// the first match without re-sorting.
//
// The table is new; an org whose database has not been migrated yet simply gets
// an empty rule set and the previous category-mapping behaviour, rather than a
// hard error blocking import.

export function useOutflowClassificationRules() {
  const orgId = useOrgStore((s) => s.orgId)

  const [rules,   setRules]   = useState<OutflowClassificationRule[]>([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)

  const fetch = useCallback(async () => {
    if (!orgId) { setLoading(false); return }
    setLoading(true); setError(null)
    const { data, error: err } = await supabase
      .from('outflow_classification_rules')
      .select('id, rule_type, rule_value, stage_code_1, stage_code_2, outflow_type_id, priority, created_at')
      .eq('org_id', orgId)
      .order('priority',   { ascending: true })
      .order('created_at', { ascending: true })

    if (err) {
      // A missing table means the migration has not been applied. Degrade to
      // "no rules" instead of breaking the import wizard.
      const missingTable = err.code === '42P01' || /does not exist|schema cache/i.test(err.message)
      if (!missingTable) setError(err.message)
      setRules([])
    } else {
      setRules((data ?? []) as OutflowClassificationRule[])
    }
    setLoading(false)
  }, [orgId])

  useEffect(() => { void fetch() }, [fetch])

  return { rules, loading, error, refetch: fetch }
}
