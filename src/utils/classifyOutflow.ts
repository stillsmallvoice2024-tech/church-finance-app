// ── Outflow auto-classification ──────────────────────────────────────────────
//
// The outflow counterpart to classifyIncomeType. Debit rows previously had no
// rule engine at all — stage codes were only pre-populated by an exact
// category-name match on a mapped spreadsheet column — so every debit row on a
// bank statement had to be configured by hand.
//
// Matching runs against the RAW description, exactly as classifyIncomeType
// does. `normalizeNarration` output is for grouping and display only and must
// never be used here.

import type { OutflowClassificationRule } from '../hooks/useOutflowClassificationRules'

export interface OutflowClassification {
  stageCode1:    string
  stageCode2:    string
  outflowTypeId: string
  /** 'rule' when a rule fired; 'column' when the value came from the sheet. */
  source:        'rule' | 'column'
}

/**
 * Find the first rule matching the given description / stage code.
 * Rules are expected pre-sorted by priority then created_at.
 *
 * keyword    – case-insensitive substring match on the raw description
 * stage_code – case-insensitive exact match on stage_code_1
 *
 * Returns null when no rule fires, so the caller can fall back to the existing
 * category-mapping behaviour.
 */
export function classifyOutflow(
  description: string,
  stageCode1:  string,
  rules:       OutflowClassificationRule[],
): OutflowClassification | null {
  const desc  = description.toLowerCase()
  const stage = stageCode1.toLowerCase()

  for (const rule of rules) {
    const val = rule.rule_value.toLowerCase().trim()
    if (!val) continue

    const hit =
      (rule.rule_type === 'keyword'    && desc  && desc.includes(val)) ||
      (rule.rule_type === 'stage_code' && stage && stage === val)

    if (!hit) continue

    return {
      // A rule that leaves a field blank must not wipe a value the sheet
      // already supplied.
      stageCode1:    rule.stage_code_1 ?? '',
      stageCode2:    rule.stage_code_2 ?? '',
      outflowTypeId: rule.outflow_type_id ?? '',
      source:        'rule',
    }
  }

  return null
}

/**
 * Resolve the outflow type for a row, in precedence order:
 *   1. an explicit rule match
 *   2. the category → outflow-type map (existing behaviour)
 *   3. an exact category-name match (existing behaviour, now the last resort)
 */
export function resolveOutflowType(
  stageCode1:      string,
  ruleOutflowType: string,
  categories:      { id: string; name: string }[],
  outflowTypes:    { id: string; name: string }[],
  mappedDefault:   (categoryId: string) => { id: string } | null,
): string {
  if (ruleOutflowType) return ruleOutflowType
  if (!stageCode1) return ''

  const cat = categories.find(c => c.name === stageCode1)
  if (cat) {
    const suggested = mappedDefault(cat.id)
    if (suggested) return suggested.id
  }

  const match = outflowTypes.find(t => t.name.toLowerCase() === stageCode1.toLowerCase())
  return match?.id ?? ''
}
