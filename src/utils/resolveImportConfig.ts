import type { IncomeType } from '../hooks/useIncomeTypes'
import { getFinalConfig } from './configResolver'

// Re-export the new resolver API for consumers that import from this module.
export type { RowResolverState } from './configResolver'
export { resolveDefaultIncomeType, resolveConfigForIncomeType, getFinalConfig } from './configResolver'

export interface ResolveFinalRowConfigArgs {
  /** undefined = no decision yet; '' = explicit General; uuid = explicit special config */
  manualConfigId:  string | undefined
  incomeTypeId:    string | null | undefined
  incomeTypes:     IncomeType[]
  /** Date-based general config ID from getConfigForDate — null if no locked config exists */
  generalConfigId: string | null
}

/**
 * @deprecated Use getFinalConfig() with RowResolverState from configResolver instead.
 *
 * Kept for backward compatibility. Delegates to getFinalConfig() internally.
 */
export function resolveFinalRowConfig({
  manualConfigId,
  incomeTypeId,
  incomeTypes,
  generalConfigId,
}: ResolveFinalRowConfigArgs): string | null {
  const incomeType = incomeTypeId
    ? (incomeTypes.find(t => t.id === incomeTypeId) ?? null)
    : null
  return getFinalConfig(
    {
      incomeType,
      allocationConfigId: manualConfigId ?? '',
      isManualOverride:   manualConfigId !== undefined,
    },
    generalConfigId,
  )
}
