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
      return { error: bad ? { message: 'null value violates not-null constraint' } : null }
    }
    const result = await insertBatchResilient(insert, rows)
    expect(result.imported).toBe(249)
    expect(result.failed).toEqual([{ id: 137 }])
    expect(result.duplicates).toEqual([])
    expect(result.errors).toEqual(['null value violates not-null constraint'])
  })

  // The transaction-ref unique indexes are what actually prevent a duplicated
  // import; a row they reject is an expected outcome, not a failure to retry.
  it('reports a unique violation as a duplicate, not a failure', async () => {
    const rows = Array.from({ length: 250 }, (_, i) => ({ id: i }))
    const insert = async (batch: typeof rows) => {
      const dup = batch.some(r => r.id === 42)
      return {
        error: dup
          ? { message: 'duplicate key value violates unique constraint "inflow_transactions_org_bank_ref_unique"', code: '23505' }
          : null,
      }
    }
    const result = await insertBatchResilient(insert, rows)
    expect(result.imported).toBe(249)
    expect(result.duplicates).toEqual([{ id: 42 }])
    expect(result.failed).toEqual([])
    expect(result.errors).toEqual([])
  })

  it('classifies a unique violation by message when the code is absent', async () => {
    const rows = [{ id: 1 }]
    const insert = async () => ({ error: { message: 'duplicate key value violates unique constraint' } })
    const result = await insertBatchResilient(insert, rows)
    expect(result.duplicates).toEqual([{ id: 1 }])
    expect(result.failed).toEqual([])
  })

  it('separates duplicates from genuinely bad rows in one batch', async () => {
    const rows = Array.from({ length: 100 }, (_, i) => ({ id: i }))
    const insert = async (batch: typeof rows) => {
      if (batch.some(r => r.id === 10)) return { error: { message: 'unique_violation', code: '23505' } }
      if (batch.some(r => r.id === 80)) return { error: { message: 'invalid input syntax for type uuid' } }
      return { error: null }
    }
    const result = await insertBatchResilient(insert, rows)
    expect(result.imported).toBe(98)
    expect(result.duplicates).toEqual([{ id: 10 }])
    expect(result.failed).toEqual([{ id: 80 }])
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
    expect(result).toEqual({ imported: 0, failed: [], errors: [], duplicates: [] })
  })
})
