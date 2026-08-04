/**
 * Outflow auto-classification. Debit rows previously had no rule engine at all,
 * so every one had to be configured by hand on a bank statement import.
 *
 * The critical invariant: rules match the RAW description. normalizeNarration
 * output is for grouping and display only and must never reach matching.
 */

import { describe, it, expect } from 'vitest'
import { classifyOutflow, resolveOutflowType } from '../classifyOutflow'
import type { OutflowClassificationRule } from '../../hooks/useOutflowClassificationRules'

let n = 0
function rule(p: Partial<OutflowClassificationRule>): OutflowClassificationRule {
  return {
    id: `r${n++}`,
    rule_type: 'keyword',
    rule_value: '',
    stage_code_1: null,
    stage_code_2: null,
    outflow_type_id: null,
    priority: 0,
    created_at: '2026-01-01',
    ...p,
  }
}

describe('classifyOutflow', () => {
  it('matches a keyword rule case-insensitively as a substring', () => {
    const rules = [rule({ rule_value: 'shoprite', stage_code_1: 'Welfare' })]
    const out = classifyOutflow('POS PAYMT SHOPRITE IKEJA TERMINAL 22391', '', '', rules)
    expect(out?.stageCode1).toBe('Welfare')
    expect(out?.source).toBe('rule')
  })

  it('matches a stage_code rule only on an exact stage code', () => {
    const rules = [rule({ rule_type: 'stage_code', rule_value: 'utilities', stage_code_2: 'Savings' })]
    expect(classifyOutflow('anything', 'Utilities', '', rules)?.stageCode2).toBe('Savings')
    expect(classifyOutflow('anything', 'Utilities extra', '', rules)).toBeNull()
  })

  it('returns the first matching rule, respecting caller-supplied order', () => {
    const rules = [
      rule({ rule_value: 'transfer', stage_code_1: 'First' }),
      rule({ rule_value: 'transfer', stage_code_1: 'Second' }),
    ]
    expect(classifyOutflow('NIP TRANSFER TO JOHN', '', '', rules)?.stageCode1).toBe('First')
  })

  it('returns null when nothing matches, so callers can fall back', () => {
    expect(classifyOutflow('BANK CHARGE', '', '', [rule({ rule_value: 'salary' })])).toBeNull()
  })

  it('ignores rules with a blank rule_value rather than matching everything', () => {
    expect(classifyOutflow('ANY DESCRIPTION', '', '', [rule({ rule_value: '   ' })])).toBeNull()
  })

  it('does not match a keyword rule against an empty description', () => {
    expect(classifyOutflow('', '', '', [rule({ rule_value: 'fuel' })])).toBeNull()
  })

  it('matches the RAW description, including reference tokens a cleaner would strip', () => {
    // normalizeNarration would render this as "Transfer - John Doe", losing
    // "REF 48291" — a rule keyed on the reference must still fire.
    const rules = [rule({ rule_value: 'ref 48291', stage_code_1: 'Matched' })]
    const out = classifyOutflow('NIP TRANSFER TO JOHN DOE REF 48291 SUCCESSFUL', '', '', rules)
    expect(out?.stageCode1).toBe('Matched')
  })

  it('lets a bank rule beat a keyword rule regardless of list order', () => {
    const rules = [
      rule({ rule_value: 'transfer', stage_code_1: 'Keyword Match' }),
      rule({ rule_type: 'bank', rule_value: 'bank-uuid-1', stage_code_1: 'Bank Match' }),
    ]
    expect(classifyOutflow('NIP TRANSFER TO JOHN', '', 'bank-uuid-1', rules)?.stageCode1).toBe('Bank Match')
  })

  it('requires the bank id to match exactly, and is case-insensitive', () => {
    const rules = [rule({ rule_type: 'bank', rule_value: 'Bank-UUID-1', outflow_type_id: 't1' })]
    expect(classifyOutflow('', '', 'bank-uuid-2', rules)).toBeNull()
    expect(classifyOutflow('', '', 'BANK-uuid-1', rules)?.outflowTypeId).toBe('t1')
  })

  it('does not fire a bank rule when no bank context is given', () => {
    const rules = [rule({ rule_type: 'bank', rule_value: 'bank-uuid-1', outflow_type_id: 't1' })]
    expect(classifyOutflow('', '', '', rules)).toBeNull()
  })

  it('falls through to keyword matching when the bank has no rule of its own', () => {
    const rules = [
      rule({ rule_type: 'bank', rule_value: 'other-bank', outflow_type_id: 't1' }),
      rule({ rule_value: 'fuel', outflow_type_id: 't2' }),
    ]
    expect(classifyOutflow('fuel purchase', '', 'bank-uuid-1', rules)?.outflowTypeId).toBe('t2')
  })
})

describe('resolveOutflowType', () => {
  const categories   = [{ id: 'c1', name: 'Utilities' }]
  const outflowTypes = [{ id: 't1', name: 'Utilities' }, { id: 't2', name: 'Welfare' }]

  it('prefers the rule-supplied outflow type above everything else', () => {
    const got = resolveOutflowType('Utilities', 't2', categories, outflowTypes, () => ({ id: 't1' }))
    expect(got).toBe('t2')
  })

  it('falls back to the category → outflow-type map', () => {
    const got = resolveOutflowType('Utilities', '', categories, outflowTypes, () => ({ id: 't1' }))
    expect(got).toBe('t1')
  })

  it('falls back to an exact category-name match when the map has nothing', () => {
    const got = resolveOutflowType('Welfare', '', categories, outflowTypes, () => null)
    expect(got).toBe('t2')
  })

  it('returns empty when there is no stage code to work from', () => {
    expect(resolveOutflowType('', '', categories, outflowTypes, () => null)).toBe('')
  })

  it('returns empty rather than guessing when nothing matches', () => {
    expect(resolveOutflowType('Unknown', '', categories, outflowTypes, () => null)).toBe('')
  })
})
