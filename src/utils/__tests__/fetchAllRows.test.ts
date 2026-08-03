import { describe, it, expect } from 'vitest'
import { fetchAllRows } from '../fetchAllRows'

// Minimal stand-in for a PostgREST builder: records the applied ORDER BY and
// serves rows from a fixed dataset via .range().
function makeQuery(rows: { id: string }[]) {
  const orders: { column: string; ascending: boolean }[] = []
  const builder = {
    order(column: string, opts: { ascending: boolean }) {
      orders.push({ column, ascending: opts.ascending })
      return builder
    },
    range(from: number, to: number) {
      return Promise.resolve({ data: rows.slice(from, to + 1), error: null })
    },
  }
  return { builder, orders }
}

describe('fetchAllRows', () => {
  it('applies a stable primary-key order to every page request', async () => {
    const { builder, orders } = makeQuery([{ id: 'a' }, { id: 'b' }])
    await fetchAllRows(() => builder)
    expect(orders).toEqual([{ column: 'id', ascending: true }])
  })

  it('accepts a custom stable key', async () => {
    const { builder, orders } = makeQuery([{ id: 'a' }])
    await fetchAllRows(() => builder, 'created_at')
    expect(orders[0]).toEqual({ column: 'created_at', ascending: true })
  })

  it('pages past the 1000-row server cap without skipping or duplicating rows', async () => {
    const rows = Array.from({ length: 2500 }, (_, i) => ({ id: String(i) }))
    const { builder, orders } = makeQuery(rows)

    const { data, error } = await fetchAllRows(() => builder)

    expect(error).toBeNull()
    expect(data).toHaveLength(2500)
    expect(new Set(data.map(r => r.id)).size).toBe(2500)
    expect(data[0].id).toBe('0')
    expect(data[2499].id).toBe('2499')
    // 3 pages → order re-applied on each rebuilt query
    expect(orders).toHaveLength(3)
  })

  it('returns the error and stops paging', async () => {
    const builder = {
      order() { return builder },
      range() { return Promise.resolve({ data: null, error: { message: 'boom' } }) },
    }
    const { data, error } = await fetchAllRows(() => builder)
    expect(data).toEqual([])
    expect(error?.message).toBe('boom')
  })
})
