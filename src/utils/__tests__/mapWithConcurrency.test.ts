import { describe, it, expect } from 'vitest'
import { mapWithConcurrency } from '../mapWithConcurrency'

describe('mapWithConcurrency', () => {
  it('returns results in item order regardless of completion order', async () => {
    const items = [30, 10, 20, 5]
    const result = await mapWithConcurrency(items, 4, async ms => {
      await new Promise(resolve => setTimeout(resolve, ms))
      return ms
    })
    expect(result).toEqual([30, 10, 20, 5])
  })

  it('never runs more than `limit` at once', async () => {
    const items = Array.from({ length: 50 }, (_, i) => i)
    let active = 0
    let maxActive = 0
    await mapWithConcurrency(items, 5, async i => {
      active++
      maxActive = Math.max(maxActive, active)
      await new Promise(resolve => setTimeout(resolve, 1))
      active--
      return i
    })
    expect(maxActive).toBeLessThanOrEqual(5)
  })

  it('processes every item exactly once', async () => {
    const items = Array.from({ length: 237 }, (_, i) => i)
    const seen: number[] = []
    const result = await mapWithConcurrency(items, 10, async i => { seen.push(i); return i * 2 })
    expect(seen.sort((a, b) => a - b)).toEqual(items)
    expect(result).toEqual(items.map(i => i * 2))
  })

  it('handles an empty list', async () => {
    const result = await mapWithConcurrency([] as number[], 10, async i => i)
    expect(result).toEqual([])
  })

  it('handles a limit larger than the item count', async () => {
    const result = await mapWithConcurrency([1, 2, 3], 100, async i => i * 10)
    expect(result).toEqual([10, 20, 30])
  })

  it('propagates a rejection from any worker', async () => {
    const items = [1, 2, 3, 4, 5]
    await expect(
      mapWithConcurrency(items, 2, async i => {
        if (i === 3) throw new Error('boom')
        return i
      }),
    ).rejects.toThrow('boom')
  })
})
