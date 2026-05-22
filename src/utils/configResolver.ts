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
 *   3. null — caller falls back to the general (date-based) config
 *
 * "General Givings" is the conceptual ultimate fallback: when this returns null the
 * row behaves as if General Givings were selected (maps to generalConfig, no special split).
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
 *   3. generalConfigId (date-based general config)
 */
export function getFinalConfig(
  rowState: RowResolverState,
  generalConfigId: string | null,
): string | null {
  if (rowState.isManualOverride) {
    return rowState.allocationConfigId || generalConfigId
  }
  return rowState.incomeType?.special_config_id ?? generalConfigId
}
