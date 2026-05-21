import type { IncomeType } from '../hooks/useIncomeTypes'

export interface ResolveFinalRowConfigArgs {
  /** undefined = no decision yet; '' = explicit General; uuid = explicit special config */
  manualConfigId:  string | undefined
  incomeTypeId:    string | null | undefined
  incomeTypes:     IncomeType[]
  /** Date-based general config ID from getConfigForDate — null if no locked config exists */
  generalConfigId: string | null
}

/**
 * Single precedence resolver for import row allocation config.
 *
 * Precedence:
 *   1. Manual override (manualConfigId !== undefined)
 *      '' → explicit General (use generalConfigId)
 *      uuid → explicit special config
 *   2. Income type linked special config
 *   3. General date-based fallback
 *
 * Returns the config ID to write to allocation_config_id, or null if none.
 */
export function resolveFinalRowConfig({
  manualConfigId,
  incomeTypeId,
  incomeTypes,
  generalConfigId,
}: ResolveFinalRowConfigArgs): string | null {
  if (manualConfigId !== undefined) {
    return manualConfigId !== '' ? manualConfigId : generalConfigId
  }
  if (incomeTypeId) {
    const linked = incomeTypes.find(t => t.id === incomeTypeId)?.special_config_id ?? null
    if (linked) return linked
  }
  return generalConfigId
}

/**
 * Returns the special config ID linked to an income type, or '' for none.
 * Used to propagate config into rowConfigs when income type changes.
 */
export function resolveConfigForIncomeType(
  incomeTypeId: string | null | undefined,
  incomeTypes: IncomeType[],
): string {
  if (!incomeTypeId) return ''
  return incomeTypes.find(t => t.id === incomeTypeId)?.special_config_id ?? ''
}
