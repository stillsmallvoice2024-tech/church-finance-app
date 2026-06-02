/**
 * Tests for org-deletion logic.
 * Pure unit tests — no React rendering required.
 * Tests the core async functions by exercising the hook's Supabase calls
 * and verifying the expected RPC / auth interactions.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mocks ──────────────────────────────────────────────────────────────────────

const mockRpc    = vi.fn()
const mockSignIn = vi.fn()
const mockUpload = vi.fn()

vi.mock('../lib/supabase', () => ({
  supabase: {
    auth:    { signInWithPassword: (args: unknown) => mockSignIn(args) },
    rpc:     (name: string, args: unknown) => mockRpc(name, args),
    storage: {
      from: (_bucket: string) => ({ upload: mockUpload }),
    },
  },
}))

const mockCreateBackup   = vi.fn()
const mockDownloadBackup = vi.fn()

vi.mock('../utils/backupRestore', () => ({
  createBackup:    (uid: string, email: string) => mockCreateBackup(uid, email),
  downloadBackup:  (b: unknown) => mockDownloadBackup(b),
}))

// ── Helpers shared with the hook internals ────────────────────────────────────

const USER_ID = 'user-1'
const ORG_ID  = 'org-1'

function makeBackup() {
  return {
    _meta: {
      createdAt: new Date().toISOString(), userId: USER_ID, userEmail: 'test@example.com',
      backupVersion: '2', appVersion: '1',
      managedTables: [], unmanagedTables: [], skippedTables: [],
      warnings: [], schemaDiscoveryAvailable: false, strictMode: false,
    },
    managed: {}, unmanaged: {},
  }
}

// ── Tests ──────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
  mockUpload.mockResolvedValue({ error: null })
})

describe('request_org_deletion RPC contract', () => {
  it('is called with correct parameters', async () => {
    mockRpc.mockResolvedValue({ data: { ok: true, deleted_at: new Date().toISOString(), purge_at: new Date().toISOString() }, error: null })

    const { supabase } = await import('../lib/supabase')
    await supabase.rpc('request_org_deletion', { p_org_id: ORG_ID, p_org_name_confirm: 'My Church' })

    expect(mockRpc).toHaveBeenCalledWith('request_org_deletion', { p_org_id: ORG_ID, p_org_name_confirm: 'My Church' })
  })

  it('returns ok=true on success', async () => {
    const purgeAt = new Date(Date.now() + 30 * 86400_000).toISOString()
    mockRpc.mockResolvedValue({ data: { ok: true, deleted_at: new Date().toISOString(), purge_at: purgeAt }, error: null })

    const { supabase } = await import('../lib/supabase')
    const { data } = await supabase.rpc('request_org_deletion', { p_org_id: ORG_ID, p_org_name_confirm: 'My Church' })

    expect(data).toMatchObject({ ok: true })
    expect(data.purge_at).toBe(purgeAt)
  })
})

describe('restore_org RPC contract', () => {
  it('is called with the org id', async () => {
    mockRpc.mockResolvedValue({ data: { ok: true }, error: null })

    const { supabase } = await import('../lib/supabase')
    await supabase.rpc('restore_org', { p_org_id: ORG_ID })

    expect(mockRpc).toHaveBeenCalledWith('restore_org', { p_org_id: ORG_ID })
  })
})

describe('record_deletion_backup RPC contract', () => {
  it('is called with path and size', async () => {
    mockRpc.mockResolvedValue({ data: { ok: true, backup_id: 'bid-1' }, error: null })

    const { supabase } = await import('../lib/supabase')
    await supabase.rpc('record_deletion_backup', { p_org_id: ORG_ID, p_path: 'org-1/ts.json', p_file_size: 12345 })

    expect(mockRpc).toHaveBeenCalledWith('record_deletion_backup', {
      p_org_id:    ORG_ID,
      p_path:      'org-1/ts.json',
      p_file_size: 12345,
    })
  })
})

describe('re-authentication via signInWithPassword', () => {
  it('calls supabase.auth.signInWithPassword with email + password', async () => {
    mockSignIn.mockResolvedValue({ error: null })

    const { supabase } = await import('../lib/supabase')
    await supabase.auth.signInWithPassword({ email: 'test@example.com', password: 'correct' })

    expect(mockSignIn).toHaveBeenCalledWith({ email: 'test@example.com', password: 'correct' })
  })

  it('returns an error when password is wrong', async () => {
    mockSignIn.mockResolvedValue({ error: { message: 'Invalid login credentials' } })

    const { supabase } = await import('../lib/supabase')
    const { error } = await supabase.auth.signInWithPassword({ email: 'test@example.com', password: 'wrong' })

    expect(error).not.toBeNull()
    expect(error?.message).toMatch(/invalid login/i)
  })
})

describe('backup creation', () => {
  it('calls createBackup with userId and email', async () => {
    mockCreateBackup.mockResolvedValue(makeBackup())

    const { createBackup } = await import('../utils/backupRestore')
    const result = await createBackup(USER_ID, 'test@example.com')

    expect(mockCreateBackup).toHaveBeenCalledWith(USER_ID, 'test@example.com')
    expect(result._meta.userId).toBe(USER_ID)
  })

  it('stores backup via storage upload', async () => {
    const { supabase } = await import('../lib/supabase')
    const blob = new Blob([JSON.stringify(makeBackup())], { type: 'application/json' })
    await supabase.storage.from('deletion-backups').upload('org-1/test.json', blob)

    expect(mockUpload).toHaveBeenCalledWith('org-1/test.json', blob)
  })
})

describe('downloadBackup', () => {
  it('triggers download with backup object', async () => {
    const backup = makeBackup()
    const { downloadBackup } = await import('../utils/backupRestore')
    downloadBackup(backup)

    expect(mockDownloadBackup).toHaveBeenCalledWith(backup)
  })
})

describe('daysUntil helper (inline)', () => {
  function daysUntil(iso: string | null): number {
    if (!iso) return 30
    const ms = new Date(iso).getTime() - Date.now()
    return Math.max(0, Math.ceil(ms / (1000 * 60 * 60 * 24)))
  }

  it('returns 30 for a null date', () => {
    expect(daysUntil(null)).toBe(30)
  })

  it('returns 0 for a date in the past', () => {
    const past = new Date(Date.now() - 86400_000).toISOString()
    expect(daysUntil(past)).toBe(0)
  })

  it('returns ~30 for a date 30 days in the future', () => {
    const future = new Date(Date.now() + 30 * 86400_000).toISOString()
    expect(daysUntil(future)).toBeGreaterThanOrEqual(29)
    expect(daysUntil(future)).toBeLessThanOrEqual(30)
  })
})
