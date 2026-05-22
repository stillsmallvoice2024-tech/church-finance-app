import type { IncomeType } from '../hooks/useIncomeTypes'
import { classifyIncomeType } from './classifyIncomeType'

export interface RowResolverState {
  incomeType: IncomeType | null
  /** Config ID stored by explicit user selection; meaningful only when isManualOverride=true. */
  allocationConfigId: string
  /**
   * true only when the user explicitly changed the Allocation Config dropdown for this row.
   * Cleared whenever the Income Type changes so the new type's linked config takes effect.
   */
  isManualOverride: boolean
}

/**
 * Resolves the effective income type for a transaction row using strict priority:
 *   1. Keyword / stage-code rule matching against incomeTypes
 *   2. User-designated default income type (userPrefs.defaultIncomeTypeId)
 *   3. "General" fallback — the first income type with zero rules
 *      (no keyword or stage-code rules = catch-all type, always maps to general config)
 *   4. null — no income type applied
 */
export function resolveDefaultIncomeType(
  description: string,
  stageCode1: string,
  incomeTypes: IncomeType[],
  userPrefs?: { defaultIncomeTypeId?: string | null },
): IncomeType | null {
  const matched = classifyIncomeType(description, stageCode1, incomeTypes)
  if (matched) return matched
  if (userPrefs?.defaultIncomeTypeId) {
    const def = incomeTypes.find(t => t.id === userPrefs.defaultIncomeTypeId)
    if (def) return def
  }
  // Last resort: income type with no rules is the "General" catch-all.
  // It has no keyword/stage rules by design so it never fires via matching;
  // it is always reached only here as the ultimate fallback.
  const catchAll = incomeTypes.find(t => t.rules.length === 0)
  if (catchAll) return catchAll
  return null
}

/**
 * Returns the allocation config ID for an income type.
 * Prefers the income type's linked special config; falls back to generalConfigId.
 */
export function resolveConfigForIncomeType(
  incomeType: IncomeType | null | undefined,
  generalConfigId: string | null,
): string | null {
  return incomeType?.special_config_id ?? generalConfigId
}

/**
 * Returns the final allocation config ID for a row.
 *
 * Strict precedence:
 *   1. isManualOverride=true  → allocationConfigId (falls back to generalConfigId when blank)
 *   2. incomeType.special_config_id (linked config)
 *      — skipped for the "General" catch-all type (zero rules), which always
 *        maps to generalConfigId regardless of any accidentally-set special_config_id
 *   3. generalConfigId (date-based general config)
 */
export function getFinalConfig(
  rowState: RowResolverState,
  generalConfigId: string | null,
): string | null {
  if (rowState.isManualOverride) {
    return rowState.allocationConfigId || generalConfigId
  }
  // The catch-all "General" type (no rules) always uses the general config
  const isCatchAll = rowState.incomeType !== null && rowState.incomeType.rules.length === 0
  if (isCatchAll) return generalConfigId
  return rowState.incomeType?.special_config_id ?? generalConfigId
}
