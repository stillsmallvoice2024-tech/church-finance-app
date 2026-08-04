/**
 * Shared recognition-rule matcher for income types.
 *
 * Rules are NOT first-match-wins — every rule of every candidate is scored and
 * the strongest match wins. Scoring exists to stop a short accidental substring
 * from beating a real word match:
 *
 *   description "Tithes"
 *     rule "tithe" (Tithe)     → word-start match  → tier 3
 *     rule "hes"   (Speciale)  → mid-word match    → tier 1   ← "tit-HES-"
 *   ⇒ "Tithe" wins regardless of DB order.
 *
 * Mid-word substrings still match (existing setups relying on them keep
 * working) but only when nothing stronger fires.
 *
 * `bank` rules sit above everything else — a whole import batch belongs to one
 * bank, so a type dedicated to that bank (e.g. a bank account used only for a
 * Missions fund) should not be second-guessed by a keyword coincidence in the
 * description text.
 *
 * `stage_code` can no longer be created from the UI (replaced by `bank`) but
 * existing stored rules of that type still match, so nothing already saved
 * silently stops working.
 *
 * Ties (same tier) are broken by rule length — the longer, more specific rule
 * wins; if still tied, the first candidate in the given order wins.
 *
 * Outflow classification uses a separate, simpler first-match-by-priority
 * engine (`classifyOutflow.ts`) — this matcher is income-side only.
 */

export type RuleType = 'keyword' | 'stage_code' | 'bank'

export interface MatchableRule {
  rule_type:  RuleType
  rule_value: string
}

export interface RuleCandidate<T> {
  item:  T
  rules: MatchableRule[]
}

// Match strength, strongest first.
export const TIER_BANK       = 6   // rule's bank matches the import's selected bank
export const TIER_STAGE_CODE = 5   // exact stage_code_1 match (legacy — no longer creatable)
export const TIER_WHOLE_WORD = 4   // "tithe" in "cash tithe jan"
export const TIER_WORD_START = 3   // "tithe" in "tithes"
export const TIER_WORD_END   = 2   // "tithe" in "retithe"
export const TIER_SUBSTRING  = 1   // "hes"   in "tithes"

const WORD_CHAR = /[\p{L}\p{N}]/u

function isWordChar(ch: string | undefined): boolean {
  return ch !== undefined && WORD_CHAR.test(ch)
}

/**
 * Strength of the best occurrence of `keyword` inside `description`.
 * Both arguments must already be lower-cased. Returns 0 when absent.
 */
export function keywordMatchTier(description: string, keyword: string): number {
  if (!description || !keyword) return 0
  let best = 0
  let from = 0
  for (;;) {
    const at = description.indexOf(keyword, from)
    if (at === -1) break
    const startsWord = !isWordChar(description[at - 1])
    const endsWord   = !isWordChar(description[at + keyword.length])
    const tier =
      startsWord && endsWord ? TIER_WHOLE_WORD :
      startsWord            ? TIER_WORD_START :
      endsWord              ? TIER_WORD_END   :
                              TIER_SUBSTRING
    if (tier > best) best = tier
    if (best === TIER_WHOLE_WORD) break
    from = at + 1
  }
  return best
}

/**
 * Returns the candidate whose rules match the description / stage code / bank
 * most strongly, or null when no rule fires.
 *
 * `bankId` is the bank the current import (or manual entry) is for — compared
 * against `bank` rules by exact id. Pass '' when no bank context applies.
 */
export function matchByRules<T>(
  description: string,
  stageCode1:  string,
  bankId:      string,
  candidates:  RuleCandidate<T>[],
): T | null {
  const desc  = (description ?? '').toLowerCase()
  const stage = (stageCode1  ?? '').trim().toLowerCase()
  const bank  = (bankId      ?? '').trim().toLowerCase()

  let bestItem:  T | null = null
  let bestScore = 0

  for (const candidate of candidates) {
    for (const rule of candidate.rules ?? []) {
      const val = (rule.rule_value ?? '').trim().toLowerCase()
      if (!val) continue

      const tier =
        rule.rule_type === 'bank'       ? (bank  && bank  === val ? TIER_BANK       : 0) :
        rule.rule_type === 'stage_code' ? (stage && stage === val ? TIER_STAGE_CODE : 0) :
        keywordMatchTier(desc, val)
      if (tier === 0) continue

      // Tier dominates; rule length is the tie-breaker (capped so it can never
      // promote a weaker tier).
      const score = tier * 1000 + Math.min(val.length, 999)
      if (score > bestScore) {
        bestScore = score
        bestItem  = candidate.item
      }
    }
  }

  return bestItem
}
