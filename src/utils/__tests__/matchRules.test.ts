import { describe, it, expect } from 'vitest'
import {
  matchByRules, keywordMatchTier,
  TIER_BANK, TIER_STAGE_CODE, TIER_WHOLE_WORD, TIER_WORD_START, TIER_WORD_END, TIER_SUBSTRING,
} from '../matchRules'
import { classifyIncomeType } from '../classifyIncomeType'
import type { IncomeType } from '../../hooks/useIncomeTypes'

// ── Helpers ────────────────────────────────────────────────────────────────────

const rule = (value: string, type: 'keyword' | 'stage_code' | 'bank' = 'keyword') =>
  ({ rule_type: type, rule_value: value })

function incomeType(name: string, values: string[], type: 'keyword' | 'stage_code' | 'bank' = 'keyword'): IncomeType {
  return {
    id: name.toLowerCase(),
    name,
    description: null,
    color: '#000',
    is_system: false,
    special_config_id: null,
    special_config_name: null,
    special_config_group_id: null,
    special_config_group_name: null,
    rules: values.map((v, i) => ({
      id: `${name}-${i}`,
      income_type_id: name.toLowerCase(),
      rule_type: type,
      rule_value: v,
    })),
    created_at: '2026-01-01',
  }
}

// ── keywordMatchTier ───────────────────────────────────────────────────────────

describe('keywordMatchTier', () => {
  it('scores a standalone word highest', () => {
    expect(keywordMatchTier('cash tithe january', 'tithe')).toBe(TIER_WHOLE_WORD)
  })

  it('scores a word prefix above a partial hit', () => {
    expect(keywordMatchTier('tithes', 'tithe')).toBe(TIER_WORD_START)   // TITHE-s
    expect(keywordMatchTier('tithes', 'hes')).toBe(TIER_WORD_END)       // tit-HES
    expect(keywordMatchTier('tithes', 'ith')).toBe(TIER_SUBSTRING)      // t-ITH-es
  })

  it('scores a word suffix between prefix and substring', () => {
    expect(keywordMatchTier('retithe', 'tithe')).toBe(TIER_WORD_END)
    expect(TIER_WORD_END).toBeGreaterThan(TIER_SUBSTRING)
    expect(TIER_WORD_START).toBeGreaterThan(TIER_WORD_END)
  })

  it('treats punctuation and separators as word boundaries', () => {
    expect(keywordMatchTier('trf/tithe/john', 'tithe')).toBe(TIER_WHOLE_WORD)
    expect(keywordMatchTier('tithe-offering', 'tithe')).toBe(TIER_WHOLE_WORD)
  })

  it('returns the strongest occurrence when a keyword appears twice', () => {
    expect(keywordMatchTier('tithes and tithe', 'tithe')).toBe(TIER_WHOLE_WORD)
  })

  it('returns 0 when absent or when either side is empty', () => {
    expect(keywordMatchTier('offering', 'tithe')).toBe(0)
    expect(keywordMatchTier('', 'tithe')).toBe(0)
    expect(keywordMatchTier('tithe', '')).toBe(0)
  })
})

// ── matchByRules ───────────────────────────────────────────────────────────────

describe('matchByRules', () => {
  it('prefers the stronger match over DB order', () => {
    const candidates = [
      { item: 'Speciale', rules: [rule('HES')] },   // "tit-HES-" — mid-word
      { item: 'Tithe',    rules: [rule('tithe')] }, // "TITHE-s"  — word start
    ]
    expect(matchByRules('Tithes', '', '', candidates)).toBe('Tithe')
  })

  it('still matches mid-word substrings when nothing stronger fires', () => {
    const candidates = [{ item: 'Speciale', rules: [rule('HES')] }]
    expect(matchByRules('Tithes', '', '', candidates)).toBe('Speciale')
  })

  it('lets an exact stage code beat any keyword match', () => {
    const candidates = [
      { item: 'Keyword type', rules: [rule('offering')] },
      { item: 'Stage type',   rules: [rule('Welfare', 'stage_code')] },
    ]
    expect(matchByRules('offering', 'Welfare', '', candidates)).toBe('Stage type')
  })

  it('requires stage codes to match exactly, not partially', () => {
    const candidates = [{ item: 'Stage type', rules: [rule('Welfare', 'stage_code')] }]
    expect(matchByRules('', 'Welfare Fund', '', candidates)).toBeNull()
    expect(matchByRules('', ' welfare ', '', candidates)).toBe('Stage type')
  })

  it('lets a bank rule beat any keyword match', () => {
    const candidates = [
      { item: 'Keyword type', rules: [rule('missions fund transfer')] },
      { item: 'Bank type',    rules: [rule('bank-uuid-1', 'bank')] },
    ]
    expect(matchByRules('missions fund transfer', '', 'bank-uuid-1', candidates)).toBe('Bank type')
  })

  it('lets a bank rule beat a stage code match too', () => {
    expect(TIER_BANK).toBeGreaterThan(TIER_STAGE_CODE)
    const candidates = [
      { item: 'Stage type', rules: [rule('Welfare', 'stage_code')] },
      { item: 'Bank type',  rules: [rule('bank-uuid-1', 'bank')] },
    ]
    expect(matchByRules('', 'Welfare', 'bank-uuid-1', candidates)).toBe('Bank type')
  })

  it('requires the bank id to match exactly, and is case-insensitive', () => {
    const candidates = [{ item: 'Bank type', rules: [rule('Bank-UUID-1', 'bank')] }]
    expect(matchByRules('', '', 'bank-uuid-2', candidates)).toBeNull()
    expect(matchByRules('', '', 'BANK-uuid-1', candidates)).toBe('Bank type')
  })

  it('does not fire a bank rule when no bank context is given', () => {
    const candidates = [{ item: 'Bank type', rules: [rule('bank-uuid-1', 'bank')] }]
    expect(matchByRules('', '', '', candidates)).toBeNull()
  })

  it('breaks same-tier ties with the longer, more specific rule', () => {
    const candidates = [
      { item: 'Broad',    rules: [rule('seed')] },
      { item: 'Specific', rules: [rule('seed offering')] },
    ]
    expect(matchByRules('seed offering march', '', '', candidates)).toBe('Specific')
  })

  it('ignores blank rule values and candidates with no rules', () => {
    const candidates = [
      { item: 'Empty', rules: [rule('   ')] },
      { item: 'None',  rules: [] },
    ]
    expect(matchByRules('anything', '', '', candidates)).toBeNull()
  })
})

// ── classifyIncomeType (regression for the reported bug) ───────────────────────

describe('classifyIncomeType', () => {
  const speciale = incomeType('Speciale', ['HES'])
  const tithe    = incomeType('Tithe',    ['tithe'])

  it('assigns "Tithes" to Tithe, not to the accidental "HES" substring match', () => {
    // Types arrive in name order — Speciale before Tithe — which is exactly the
    // order that produced the wrong answer under first-match-wins.
    expect(classifyIncomeType('Tithes', '', [speciale, tithe])?.name).toBe('Tithe')
    expect(classifyIncomeType('TITHES FOR JANUARY', '', [speciale, tithe])?.name).toBe('Tithe')
  })

  it('still assigns a genuine HES description to Speciale', () => {
    expect(classifyIncomeType('HES conference seed', '', [speciale, tithe])?.name).toBe('Speciale')
  })

  it('returns null when nothing matches', () => {
    expect(classifyIncomeType('bank charge', '', [speciale, tithe])).toBeNull()
  })

  it('lets a bank rule override a keyword match on another type', () => {
    const missions = incomeType('Missions', ['bank-uuid-9'], 'bank')
    // Description would normally match Tithe, but the whole import is for the
    // bank dedicated to Missions.
    expect(classifyIncomeType('cash tithe january', '', [tithe, missions], 'bank-uuid-9')?.name)
      .toBe('Missions')
    // Without bank context, the keyword match still wins.
    expect(classifyIncomeType('cash tithe january', '', [tithe, missions])?.name).toBe('Tithe')
  })
})
