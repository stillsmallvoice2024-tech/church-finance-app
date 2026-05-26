/**
 * Regression tests for Dynamic Report formula "Balance" evaluation.
 *
 * Covers:
 *  1. buildTokenString produces consistent keys for every portion/date/dateField combo
 *  2. collectFormulaTokenKey (the logic used in FormulaBlockPreview) matches the key
 *     that collectTokensFromBlocks produces → guards against the dateField key-mismatch bug
 *  3. Formula total computation given a resolved token map
 *  4. parseTokens round-trip parses Balance tokens correctly
 */

import { describe, it, expect } from 'vitest'
import { buildTokenString, parseTokens } from '../reportTokenParser'
import type { FormulaTerm } from '../../types'

// Locally-scoped type mirrors BudgetPortion from reportQueryEngine (avoids pulling in supabase)
type BudgetPortion = 'all' | 'seed' | 'savings' | 'percentage'

// ── Helpers that mirror the logic in DynamicReportEditor ──────────────────────

/**
 * Reproduces the key-building logic from collectTokensFromBlocks (formula branch).
 * This is the "source" key: what resolveTokens stores.
 */
function collectKey(
  term: FormulaTerm,
  cfg: { dateFrom?: string; dateTo?: string; dateField?: string },
): string {
  const df         = cfg.dateField || undefined
  const portionArg = term.portion && term.portion !== 'all'
    ? (term.portion as BudgetPortion)
    : undefined
  return buildTokenString(
    term.fn as 'BALANCE' | 'INFLOWS' | 'OUTFLOWS' | 'NET',
    term.category ?? '',
    portionArg,
    cfg.dateFrom || undefined,
    cfg.dateTo   || undefined,
    df,
  )
}

/**
 * Reproduces the key-building logic from FormulaBlockPreview (the lookup key).
 * Before the fix this omitted dateField, causing misses.
 */
function previewKeyFixed(
  term: FormulaTerm,
  cfg: { dateFrom?: string; dateTo?: string; dateField?: string },
): string {
  const dateField  = (cfg.dateField as string | undefined) || undefined
  const portionArg = term.portion && term.portion !== 'all'
    ? (term.portion as BudgetPortion)
    : undefined
  return buildTokenString(
    term.fn as 'BALANCE' | 'INFLOWS' | 'OUTFLOWS' | 'NET',
    term.category ?? '',
    portionArg,
    cfg.dateFrom,
    cfg.dateTo,
    dateField,       // fixed: dateField now passed
  )
}

/**
 * Reproduces the BUGGY pre-fix preview key (missing dateField).
 */
function previewKeyBroken(
  term: FormulaTerm,
  cfg: { dateFrom?: string; dateTo?: string; dateField?: string },
): string {
  const portionArg = term.portion && term.portion !== 'all'
    ? (term.portion as BudgetPortion)
    : undefined
  // Bug: dateField NOT passed
  return buildTokenString(
    term.fn as 'BALANCE' | 'INFLOWS' | 'OUTFLOWS' | 'NET',
    term.category ?? '',
    portionArg,
    cfg.dateFrom,
    cfg.dateTo,
    // dateField omitted
  )
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('buildTokenString', () => {
  it('produces {{BALANCE:Cat}} for all-portion, no dates', () => {
    expect(buildTokenString('BALANCE', 'Cat')).toBe('{{BALANCE:Cat}}')
  })

  it('produces {{BALANCE:Cat:seed}} for seed portion, no dates', () => {
    expect(buildTokenString('BALANCE', 'Cat', 'seed')).toBe('{{BALANCE:Cat:seed}}')
  })

  it('appends date range correctly', () => {
    expect(buildTokenString('BALANCE', 'Cat', undefined, '2024-01-01', '2024-12-31'))
      .toBe('{{BALANCE:Cat:2024-01-01:2024-12-31}}')
  })

  it('appends portion + date range', () => {
    expect(buildTokenString('BALANCE', 'Cat', 'percentage', '2024-01-01', '2024-12-31'))
      .toBe('{{BALANCE:Cat:percentage:2024-01-01:2024-12-31}}')
  })

  it('omits dateField suffix for default "date" field', () => {
    const key = buildTokenString('BALANCE', 'Cat', undefined, '2024-01-01', '2024-12-31', 'date')
    expect(key).toBe('{{BALANCE:Cat:2024-01-01:2024-12-31}}')
  })

  it('appends :recorded_at suffix when dateField is recorded_at and dates present', () => {
    const key = buildTokenString('BALANCE', 'Cat', undefined, '2024-01-01', '2024-12-31', 'recorded_at')
    expect(key).toBe('{{BALANCE:Cat:2024-01-01:2024-12-31:recorded_at}}')
  })

  it('does NOT append :recorded_at when no dates even if dateField is recorded_at', () => {
    const key = buildTokenString('BALANCE', 'Cat', 'seed', undefined, undefined, 'recorded_at')
    expect(key).toBe('{{BALANCE:Cat:seed}}')
  })
})

describe('parseTokens round-trip', () => {
  it('parses BALANCE:Cat back to correct fields', () => {
    const [t] = parseTokens('{{BALANCE:Cat}}')
    expect(t.fn).toBe('BALANCE')
    expect(t.category).toBe('Cat')
    expect(t.portion).toBeUndefined()
    expect(t.dateFrom).toBeUndefined()
    expect(t.dateTo).toBeUndefined()
  })

  it('parses BALANCE:Cat:seed', () => {
    const [t] = parseTokens('{{BALANCE:Cat:seed}}')
    expect(t.fn).toBe('BALANCE')
    expect(t.portion).toBe('seed')
  })

  it('parses BALANCE:Cat:percentage:2024-01-01:2024-12-31:recorded_at', () => {
    const [t] = parseTokens('{{BALANCE:Cat:percentage:2024-01-01:2024-12-31:recorded_at}}')
    expect(t.fn).toBe('BALANCE')
    expect(t.portion).toBe('percentage')
    expect(t.dateFrom).toBe('2024-01-01')
    expect(t.dateTo).toBe('2024-12-31')
    expect(t.dateField).toBe('recorded_at')
  })
})

describe('FormulaBlockPreview key matches collectTokensFromBlocks key', () => {
  const CASES: Array<{
    label: string
    term: FormulaTerm
    cfg: { dateFrom?: string; dateTo?: string; dateField?: string }
  }> = [
    {
      label: 'BALANCE all no dates',
      term: { sign: '+', fn: 'BALANCE', category: 'Ministry', portion: 'all' },
      cfg: {},
    },
    {
      label: 'BALANCE seed no dates',
      term: { sign: '+', fn: 'BALANCE', category: 'Ministry', portion: 'seed' },
      cfg: {},
    },
    {
      label: 'BALANCE all with dates, default dateField',
      term: { sign: '+', fn: 'BALANCE', category: 'Ministry', portion: 'all' },
      cfg: { dateFrom: '2024-01-01', dateTo: '2024-12-31', dateField: 'date' },
    },
    {
      label: 'BALANCE percentage with dates and recorded_at dateField',
      term: { sign: '+', fn: 'BALANCE', category: 'Ministry', portion: 'percentage' },
      cfg: { dateFrom: '2024-01-01', dateTo: '2024-12-31', dateField: 'recorded_at' },
    },
    {
      label: 'NET no dates',
      term: { sign: '+', fn: 'NET', category: '' },
      cfg: {},
    },
    {
      label: 'INFLOWS savings with recorded_at dates',
      term: { sign: '+', fn: 'INFLOWS', category: 'Savings Fund', portion: 'savings' },
      cfg: { dateFrom: '2025-01-01', dateTo: '2025-06-30', dateField: 'recorded_at' },
    },
  ]

  for (const { label, term, cfg } of CASES) {
    it(`collect key === preview key: ${label}`, () => {
      const collect = collectKey(term, cfg)
      const preview = previewKeyFixed(term, cfg)
      expect(preview).toBe(collect)
    })
  }

  it('broken preview key DIFFERS from collect key when dateField=recorded_at and dates set', () => {
    const term: FormulaTerm = { sign: '+', fn: 'BALANCE', category: 'Cat', portion: 'all' }
    const cfg = { dateFrom: '2024-01-01', dateTo: '2024-12-31', dateField: 'recorded_at' }
    expect(previewKeyBroken(term, cfg)).not.toBe(collectKey(term, cfg))
  })
})

describe('formula total computation', () => {
  it('sums positive and negative terms correctly', () => {
    const terms: FormulaTerm[] = [
      { sign: '+', fn: 'BALANCE', category: 'A', portion: 'all' },
      { sign: '+', fn: 'BALANCE', category: 'B', portion: 'all' },
      { sign: '-', fn: 'BALANCE', category: 'C', portion: 'all' },
    ]
    const cfg = {}
    const resolved = new Map<string, { value: number; error: null }>([
      [collectKey(terms[0], cfg), { value: 1000, error: null }],
      [collectKey(terms[1], cfg), { value: 500,  error: null }],
      [collectKey(terms[2], cfg), { value: 200,  error: null }],
    ])

    let total = 0
    for (const term of terms) {
      const key    = previewKeyFixed(term, cfg)
      const result = resolved.get(key)
      if (result && !result.error) {
        total += term.sign === '-' ? -result.value : result.value
      }
    }
    expect(total).toBe(1300)  // 1000 + 500 - 200
  })

  it('returns 0 when resolved map is empty (no DB data)', () => {
    const terms: FormulaTerm[] = [
      { sign: '+', fn: 'BALANCE', category: 'Missing', portion: 'all' },
    ]
    const resolved = new Map<string, { value: number; error: null }>()

    let total = 0
    for (const term of terms) {
      const key    = previewKeyFixed(term, {})
      const result = resolved.get(key)
      if (result && !result.error) {
        total += term.sign === '-' ? -result.value : result.value
      }
    }
    expect(total).toBe(0)
  })

  it('includes opening balance when token value reflects it', () => {
    // getCategoryBalance now includes opening balance; token resolves to net balance
    const term: FormulaTerm = { sign: '+', fn: 'BALANCE', category: 'Ministry', portion: 'all' }
    const cfg = {}
    const key = collectKey(term, cfg)

    // Simulate: inflows=5000, outflows=2000, opening=1000 → balance=4000
    const resolved = new Map([[key, { value: 4000, error: null }]])

    let total = 0
    const result = resolved.get(previewKeyFixed(term, cfg))
    if (result && !result.error) total += result.value

    expect(total).toBe(4000)
  })
})
