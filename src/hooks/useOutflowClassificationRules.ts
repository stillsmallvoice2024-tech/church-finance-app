import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useOrgStore } from '../store/orgStore'

// ── Types ──────────────────────────────────────────────────────────────────────

export interface OutflowClassificationRule {
  id:              string
  rule_type:       'keyword' | 'stage_code' | 'bank'
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

// ── Manual per-type recognition rules ───────────────────────────────────────
//
// "Save as rule" (ImportModal) always sets stage_code_1, since it's saving a
// configured group's category alongside the type. A rule created from the
// outflow type's own "Recognition Rules" panel is about the type only, so it
// always leaves stage_code_1/stage_code_2 null. That distinction is what lets
// `saveManualOutflowRules` replace "this type's manual rules" on every save
// without ever touching a group-saved rule.

export type ManualOutflowRuleType = 'keyword' | 'bank'

export async function fetchManualOutflowRules(outflowTypeId: string): Promise<OutflowClassificationRule[]> {
  const { data, error } = await supabase
    .from('outflow_classification_rules')
    .select('id, rule_type, rule_value, stage_code_1, stage_code_2, outflow_type_id, priority, created_at')
    .eq('outflow_type_id', outflowTypeId)
    .is('stage_code_1', null)
    .order('created_at', { ascending: true })
  if (error) {
    if (/relation.*does not exist|does not exist|schema cache/i.test(error.message)) return []
    throw new Error(error.message)
  }
  return (data ?? []) as OutflowClassificationRule[]
}

export async function saveManualOutflowRules(
  outflowTypeId: string,
  rules: { rule_type: ManualOutflowRuleType; rule_value: string }[],
): Promise<void> {
  const { orgId } = useOrgStore.getState()
  const clean = rules.filter(r => r.rule_value.trim())

  // Scoped to stage_code_1 IS NULL so a group-saved rule for this same type
  // (which always has stage_code_1 set) is never deleted here.
  const { error: delErr } = await supabase
    .from('outflow_classification_rules')
    .delete()
    .eq('outflow_type_id', outflowTypeId)
    .is('stage_code_1', null)
  if (delErr) {
    if (!/relation.*does not exist|does not exist|schema cache/i.test(delErr.message)) {
      throw new Error(delErr.message)
    }
    if (clean.length === 0) return
    throw new Error(
      'Recognition rules need a database migration (outflow_classification_rules). '
      + 'The outflow type itself was saved — contact your administrator to enable rules.'
    )
  }

  if (clean.length === 0) return

  const { error: insErr } = await supabase.from('outflow_classification_rules').insert(
    clean.map(r => ({
      outflow_type_id: outflowTypeId,
      rule_type:       r.rule_type,
      rule_value:      r.rule_value.trim(),
      org_id:          orgId,
    }))
  )
  if (insErr) throw new Error(insErr.message)
}
