/**
 * Regression tests for dedup query chunking.
 *
 * Root cause (fixed): duplicate detection passed ALL transaction IDs to a
 * single PostgREST `.in()` filter. For large imports with fallback SHA-256
 * IDs (64 hex chars each) the GET query string exceeded server URL limits,
 * the request failed, and — because the error was never checked — every
 * existing transaction was silently reported as new.
 */

import { describe, it, expect } from 'vitest'
import { chunkIds, DEDUP_CHUNK_SIZE } from '../chunkIds'

const fakeHash = (i: number) => i.toString(16).padStart(64, '0')

describe('chunkIds', () => {
  it('returns no chunks for an empty list', () => {
    expect(chunkIds([])).toEqual([])
  })

  it('returns a single chunk when under the limit', () => {
    const ids = ['a', 'b', 'c']
    expect(chunkIds(ids)).toEqual([['a', 'b', 'c']])
  })

  it('returns a single full chunk at exactly the limit', () => {
    const ids = Array.from({ length: DEDUP_CHUNK_SIZE }, (_, i) => fakeHash(i))
    const chunks = chunkIds(ids)
    expect(chunks).toHaveLength(1)
    expect(chunks[0]).toHaveLength(DEDUP_CHUNK_SIZE)
  })

  it('splits an 800-row import (the reported failure case) into bounded chunks', () => {
    const ids = Array.from({ length: 800 }, (_, i) => fakeHash(i))
    const chunks = chunkIds(ids)
    expect(chunks).toHaveLength(Math.ceil(800 / DEDUP_CHUNK_SIZE))
    for (const chunk of chunks) {
      expect(chunk.length).toBeGreaterThan(0)
      expect(chunk.length).toBeLessThanOrEqual(DEDUP_CHUNK_SIZE)
    }
  })

  it('preserves every ID exactly once, in order', () => {
    const ids = Array.from({ length: 257 }, (_, i) => fakeHash(i))
    expect(chunkIds(ids).flat()).toEqual(ids)
  })

  it('keeps each chunk URL-safe for 64-char fallback hashes', () => {
    const ids = Array.from({ length: DEDUP_CHUNK_SIZE }, (_, i) => fakeHash(i))
    const [chunk] = chunkIds(ids)
    // in.(id1,id2,...) — must stay well under common 8–16KB URL limits
    const queryFragment = `in.(${chunk.join(',')})`
    expect(queryFragment.length).toBeLessThan(8000)
  })

  it('respects a custom chunk size', () => {
    expect(chunkIds(['a', 'b', 'c', 'd', 'e'], 2)).toEqual([['a', 'b'], ['c', 'd'], ['e']])
  })

  it('throws on a non-positive size', () => {
    expect(() => chunkIds(['a'], 0)).toThrow()
  })
})
