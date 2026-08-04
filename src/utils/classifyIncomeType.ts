import type { IncomeType } from '../hooks/useIncomeTypes'
import { matchByRules } from './matchRules'

/**
 * Finds the IncomeType whose rules match the given description / stage code /
 * bank most strongly. Returns null if no rule fires.
 *
 * keyword    – case-insensitive match on description; word matches beat
 *              mid-word substrings (see `matchRules.ts` for the scoring).
 * bank       – exact match on the bank the import/entry is for (strongest
 *              tier — a dedicated bank account beats a keyword coincidence).
 * stage_code – case-insensitive exact match on stage_code_1 (legacy — no
 *              longer creatable from the UI, but existing rules still fire).
 *
 * Rule order in the DB is only used to break exact ties.
 */
export function classifyIncomeType(
  description: string,
  stageCode1:  string,
  incomeTypes: IncomeType[],
  bankId:      string = '',
): IncomeType | null {
  return matchByRules(
    description,
    stageCode1,
    bankId,
    incomeTypes.map(t => ({ item: t, rules: t.rules ?? [] })),
  )
}
