import type { IncomeType } from '../hooks/useIncomeTypes'

/**
 * Single source of truth for config resolution during import.
 *
 * Precedence (highest first):
 *   1. Manual user override (caller is responsible for storing in rowConfigs)
 *   2. Income type associated config  (special_config_id on the income type)
 *   3. General date-based config      (returned as '' — means "use getConfigForDate")
 */
export function resolveConfigForIncomeType(
  incomeTypeId: string | null | undefined,
  incomeTypes: IncomeType[],
): string {
  if (!incomeTypeId) return ''
  return incomeTypes.find(t => t.id === incomeTypeId)?.special_config_id ?? ''
}
