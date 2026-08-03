import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { friendlyError } from '../friendlyError'

describe('friendlyError', () => {
  beforeEach(() => { vi.spyOn(console, 'error').mockImplementation(() => {}) })
  afterEach(() => { vi.restoreAllMocks() })

  it('translates the browser default abort message', () => {
    // What postgrest-js produces when our fetch wrapper cancels a request:
    // `${err.name}: ${err.message}` from a bare AbortController.abort().
    const msg = friendlyError({ message: 'AbortError: signal is aborted without reason' }, 'save')
    expect(msg).toBe(
      "Couldn't save. The server took too long to respond. " +
      'Reload the page to check whether it saved before trying again.',
    )
  })

  it('translates our own timeout reason', () => {
    const msg = friendlyError(
      { message: 'AbortError: The allocation_configs request took longer than 60s and was cancelled.' },
      'save this rule',
    )
    expect(msg).toContain('took too long to respond')
  })

  it('translates a server-side lock timeout', () => {
    expect(friendlyError({ message: 'canceling statement due to lock timeout' }))
      .toContain('took too long to respond')
  })

  it('still maps permission and duplicate errors', () => {
    expect(friendlyError({ message: 'new row violates row-level security policy' }, 'save'))
      .toContain("don't have permission")
    expect(friendlyError({ message: 'duplicate key value violates unique constraint' }, 'save'))
      .toContain('already exists')
  })

  it('falls back for unrecognised errors', () => {
    expect(friendlyError({ message: 'something odd' }, 'save')).toBe("Couldn't save. Please try again.")
  })
})
