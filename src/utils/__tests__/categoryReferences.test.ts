import { describe, it, expect } from 'vitest'
import { resolveFundName, describeCategoryReferences } from '../categoryReferences'

describe('resolveFundName', () => {
  const names = new Map([['cat-1', 'Building Project']])

  it('prefers the category_id link over the stale text snapshot', () => {
    // The row was written as "Building Fund"; the fund has since been renamed.
    expect(resolveFundName(names, 'cat-1', 'Building Fund')).toBe('Building Project')
  })

  it('falls back to the snapshot when the row has no category_id', () => {
    expect(resolveFundName(names, null, 'Building Fund')).toBe('Building Fund')
  })

  it('falls back to the snapshot when the category_id is unknown', () => {
    // e.g. the category row was removed, or the map failed to load.
    expect(resolveFundName(names, 'cat-missing', 'Building Fund')).toBe('Building Fund')
  })

  it('returns null when there is neither a link nor a snapshot', () => {
    expect(resolveFundName(names, null, null)).toBeNull()
  })

  it('groups two rows written under different names onto one fund', () => {
    const a = resolveFundName(names, 'cat-1', 'Building Fund')
    const b = resolveFundName(names, 'cat-1', 'Building Project')
    expect(a).toBe(b)
  })
})

describe('describeCategoryReferences', () => {
  const base = {
    inflows: 0, outflows: 0, openingBalances: 0, intraFlows: 0, allocationConfigs: 0, total: 0,
  }

  it('lists only non-zero surfaces, singularised', () => {
    expect(describeCategoryReferences({ ...base, inflows: 1, allocationConfigs: 2 }))
      .toBe('1 inflow, 2 allocation configs')
  })

  it('pluralises correctly', () => {
    expect(describeCategoryReferences({ ...base, outflows: 3, intraFlows: 1 }))
      .toBe('3 outflows, 1 internal transfer')
  })

  it('is empty when nothing references the category', () => {
    expect(describeCategoryReferences(base)).toBe('')
  })
})
