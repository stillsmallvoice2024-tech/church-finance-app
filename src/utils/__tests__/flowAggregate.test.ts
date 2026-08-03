import { describe, it, expect } from 'vitest'
import { aggregateFlow, isSameTableOffset, type FlowRow } from '../flowAggregate'

describe('isSameTableOffset', () => {
  it('matches an offset whose root lives in the same table', () => {
    expect(isSameTableOffset(
      { offset_role: 'offset', root_transaction_table: 'outflow_transactions' },
      'outflow_transactions',
    )).toBe(true)
  })

  it('does not match a cross-table offset', () => {
    expect(isSameTableOffset(
      { offset_role: 'offset', root_transaction_table: 'inflow_transactions' },
      'outflow_transactions',
    )).toBe(false)
  })

  it('does not match roots or unlinked rows', () => {
    expect(isSameTableOffset({ offset_role: 'root', root_transaction_table: 'inflow_transactions' }, 'inflow_transactions')).toBe(false)
    expect(isSameTableOffset({ offset_role: null,   root_transaction_table: null },                  'inflow_transactions')).toBe(false)
    // Offset not yet linked to a root — still counted on its own page
    expect(isSameTableOffset({ offset_role: 'offset', root_transaction_table: null }, 'inflow_transactions')).toBe(false)
  })
})

describe('aggregateFlow', () => {
  const rows: FlowRow[] = [
    { date: '2026-01-05', amount: 1000, typeId: 'tithe' },
    { date: '2026-01-20', amount:  500, typeId: 'offering' },
    { date: '2026-02-02', amount:  250, typeId: 'tithe' },
  ]

  it('totals, counts, and buckets by month and type', () => {
    const agg = aggregateFlow(rows)
    expect(agg.total).toBe(1750)
    expect(agg.count).toBe(3)
    expect(agg.monthly).toEqual([
      { month: '2026-01', amount: 1500 },
      { month: '2026-02', amount:  250 },
    ])
    expect(agg.byType).toEqual([
      { typeId: 'tithe',    amount: 1250 },
      { typeId: 'offering', amount:  500 },
    ])
  })

  it('counts flipped rows (null type) in the total so type slices sum to it', () => {
    // An outflow reversal flipped onto the Inflows page: real cash in, no income type
    const agg = aggregateFlow([...rows, { date: '2026-02-10', amount: 750, typeId: null }])
    expect(agg.total).toBe(2500)
    expect(agg.count).toBe(4)
    expect(agg.byType.reduce((s, t) => s + t.amount, 0)).toBe(agg.total)
    expect(agg.byType.find(t => t.typeId === null)).toEqual({ typeId: null, amount: 750 })
    expect(agg.monthly).toEqual([
      { month: '2026-01', amount: 1500 },
      { month: '2026-02', amount: 1000 },
    ])
  })

  it('coerces numeric strings from PostgREST', () => {
    const agg = aggregateFlow([{ date: '2026-03-01', amount: '1200.50' as unknown as number, typeId: null }])
    expect(agg.total).toBe(1200.5)
  })

  it('returns empty aggregates for no rows', () => {
    expect(aggregateFlow([])).toEqual({ monthly: [], byType: [], total: 0, count: 0 })
  })
})
