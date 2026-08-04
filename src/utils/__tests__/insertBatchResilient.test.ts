import { describe, it, expect } from 'vitest'
import { insertBatchResilient } from '../insertBatchResilient'

describe('insertBatchResilient', () => {
  it('imports every row when the batch succeeds outright', async () => {
    const rows = Array.from({ length: 250 }, (_, i) => ({ id: i }))
    const result = await insertBatchResilient(async () => ({ error: null }), rows)
    expect(result.imported).toBe(250)
    expect(result.failed).toEqual([])
    expect(result.errors).toEqual([])
  })

  it('isolates a single bad row instead of failing the whole batch', async () => {
    const rows = Array.from({ length: 250 }, (_, i) => ({ id: i }))
    const insert = async (batch: typeof rows) => {
      const bad = batch.some(r => r.id === 137)
      return { error: bad ? { message: 'duplicate key value violates unique constraint' } : null }
    }
    const result = await insertBatchResilient(insert, rows)
    expect(result.imported).toBe(249)
    expect(result.failed).toEqual([{ id: 137 }])
    expect(result.errors).toEqual(['duplicate key value violates unique constraint'])
  })

  it('isolates multiple bad rows scattered across the batch', async () => {
    const rows = Array.from({ length: 100 }, (_, i) => ({ id: i }))
    const badIds = new Set([3, 51, 99])
    const insert = async (batch: typeof rows) => {
      const bad = batch.some(r => badIds.has(r.id))
      return { error: bad ? { message: 'bad row' } : null }
    }
    const result = await insertBatchResilient(insert, rows)
    expect(result.imported).toBe(97)
    expect(result.failed.map(r => r.id).sort((a, b) => a - b)).toEqual([3, 51, 99])
  })

  it('handles an empty batch', async () => {
    const result = await insertBatchResilient(async () => ({ error: null }), [])
    expect(result).toEqual({ imported: 0, failed: [], errors: [] })
  })
})
