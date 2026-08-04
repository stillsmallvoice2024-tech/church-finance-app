/**
 * Auto-assignment in the import wizard.
 *
 * Two regressions and one new behaviour:
 *  - a distribution rule linked to an auto-assigned income type must resolve
 *    (the grouped view bound to the raw stored override and never showed it)
 *  - the date-based general config must surface as ONE option, not as both the
 *    empty "General (date-based)" entry and a second option carrying the
 *    config's own name
 *  - selecting an outflow type should pull its fund across, but only when the
 *    relationship is unambiguous
 */

import { describe, it, expect } from 'vitest'
import { getFinalConfig, type RowResolverState } from '../configResolver'
import { getCategoryForOutflowType } from '../../hooks/useOutflowTypes'
import type { IncomeType } from '../../hooks/useIncomeTypes'

const GENERAL_CFG = 'cfg-general'
const LINKED_CFG  = 'cfg-linked'

function incomeType(over: Partial<IncomeType> = {}): IncomeType {
  return {
    id: 'it-1', name: 'Tithe', description: null, color: '#000',
    is_system: false,
    special_config_id: null, special_config_name: null,
    special_config_group_id: null, special_config_group_name: null,
    rules: [{ id: 'r1', income_type_id: 'it-1', rule_type: 'keyword', rule_value: 'tithe' }],
    created_at: '2026-01-01',
    ...over,
  } as IncomeType
}

const state = (over: Partial<RowResolverState> = {}): RowResolverState => ({
  incomeType: null, allocationConfigId: '', isManualOverride: false, ...over,
})

// Mirrors the display normalisation in buildInflowRowData.
const displayValue = (resolved: string | null, generalId: string | null) => {
  const r = resolved ?? ''
  return r && r === generalId ? '' : r
}

describe('linked distribution rule resolves from the income type', () => {
  it('returns the income type\'s own config, not the general one', () => {
    const it = incomeType({ special_config_id: LINKED_CFG })
    expect(getFinalConfig(state({ incomeType: it }), GENERAL_CFG)).toBe(LINKED_CFG)
  })

  it('keeps resolving after an auto-assignment, with no manual override set', () => {
    const it = incomeType({ special_config_id: LINKED_CFG })
    const resolved = getFinalConfig(state({ incomeType: it, isManualOverride: false }), GENERAL_CFG)
    expect(displayValue(resolved, GENERAL_CFG)).toBe(LINKED_CFG)
  })

  it('lets a manual override win over the linked config', () => {
    const it = incomeType({ special_config_id: LINKED_CFG })
    const resolved = getFinalConfig(
      state({ incomeType: it, isManualOverride: true, allocationConfigId: 'cfg-chosen' }),
      GENERAL_CFG,
    )
    expect(resolved).toBe('cfg-chosen')
  })

  it('resolves a versioned group config through the callback', () => {
    const it = incomeType({ special_config_group_id: 'grp-1' })
    const resolved = getFinalConfig(state({ incomeType: it }), GENERAL_CFG, () => 'cfg-v2')
    expect(resolved).toBe('cfg-v2')
  })

  it('still sends a catch-all income type to the general config', () => {
    const catchAll = incomeType({ rules: [], special_config_id: LINKED_CFG })
    expect(getFinalConfig(state({ incomeType: catchAll }), GENERAL_CFG)).toBe(GENERAL_CFG)
  })
})

describe('the general config is offered once, not twice', () => {
  it('collapses the date-based general config to the empty option', () => {
    const catchAll = incomeType({ rules: [] })
    const resolved = getFinalConfig(state({ incomeType: catchAll }), GENERAL_CFG)
    // Left as a UUID it would render a second option named "General" alongside
    // the empty "General (date-based)" entry.
    expect(displayValue(resolved, GENERAL_CFG)).toBe('')
  })

  it('leaves a genuinely special config selected', () => {
    const it = incomeType({ special_config_id: LINKED_CFG })
    const resolved = getFinalConfig(state({ incomeType: it }), GENERAL_CFG)
    expect(displayValue(resolved, GENERAL_CFG)).toBe(LINKED_CFG)
  })

  it('collapses an explicit manual pick of the general config too', () => {
    const resolved = getFinalConfig(
      state({ isManualOverride: true, allocationConfigId: GENERAL_CFG }), GENERAL_CFG,
    )
    expect(displayValue(resolved, GENERAL_CFG)).toBe('')
  })
})

describe('outflow type pulls its fund across when 1:1', () => {
  const categories = [
    { id: 'c1', name: 'Utilities' },
    { id: 'c2', name: 'Welfare'   },
  ]
  const map = (category_id: string, outflow_type_id: string) =>
    ({ id: `${category_id}-${outflow_type_id}`, category_id, outflow_type_id, created_at: '' })

  it('returns the single linked fund', () => {
    const maps = [map('c1', 't1')]
    expect(getCategoryForOutflowType('t1', maps, categories)?.name).toBe('Utilities')
  })

  it('returns nothing when several funds map to the type', () => {
    const maps = [map('c1', 't1'), map('c2', 't1')]
    expect(getCategoryForOutflowType('t1', maps, categories)).toBeNull()
  })

  it('tolerates a duplicated mapping row for the same fund', () => {
    const maps = [map('c1', 't1'), { ...map('c1', 't1'), id: 'dup' }]
    expect(getCategoryForOutflowType('t1', maps, categories)?.name).toBe('Utilities')
  })

  it('returns nothing for an unmapped or blank type', () => {
    expect(getCategoryForOutflowType('t9', [map('c1', 't1')], categories)).toBeNull()
    expect(getCategoryForOutflowType('', [map('c1', 't1')], categories)).toBeNull()
  })

  it('returns nothing when the mapped fund no longer exists', () => {
    expect(getCategoryForOutflowType('t1', [map('gone', 't1')], categories)).toBeNull()
  })
})
