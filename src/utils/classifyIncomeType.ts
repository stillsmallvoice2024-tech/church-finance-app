import type { IncomeType } from '../hooks/useIncomeTypes'

/**
 * Finds the first IncomeType whose rules match the given description / stage code.
 * Rules are evaluated in DB order (top-to-bottom per income type, types in name order).
 * Returns null if no rule fires.
 *
 * keyword   – case-insensitive substring match on description
 * stage_code – case-insensitive exact match on stage_code_1
 */
export function classifyIncomeType(
  description: string,
  stageCode1:  string,
  incomeTypes: IncomeType[],
): IncomeType | null {
  const desc  = description.toLowerCase()
  const stage = stageCode1.toLowerCase()

  for (const type of incomeTypes) {
    for (const rule of type.rules) {
      const val = rule.rule_value.toLowerCase()
      if (rule.rule_type === 'keyword'    && desc  && desc.includes(val))   return type
      if (rule.rule_type === 'stage_code' && stage && stage === val)        return type
    }
  }
  return null
}
