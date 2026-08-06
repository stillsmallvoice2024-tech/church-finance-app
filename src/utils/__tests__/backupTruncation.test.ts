import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── Fake PostgREST ────────────────────────────────────────────────────────────
// Models the behaviour that caused the bug: the server caps every response at
// `max_rows` (1000 by default) regardless of any client-side .limit().

interface FakeTable {
  rows: Record<string, unknown>[]
  /** Server row cap per response — mirrors supabase/config.toml `max_rows`. */
  maxRows: number
  /** Column that does not exist on this table; ordering by it errors. */
  missingColumn?: string
  /** When set, every request to this table fails with this message. */
  error?: string
  /** Counting works but the row export fails — a readable table, broken mid-export. */
  selectError?: string
  /** Pages after the first come back empty — simulates a short/flaky export. */
  truncateAfterFirstPage?: boolean
  /** Deletes against this table fail with this message. */
  deleteError?: string
}

const db: Record<string, FakeTable> = {}
const calls = {
  orders:  [] as { table: string; column: string }[],
  deletes: [] as string[],
  upserts: [] as { table: string; count: number }[],
}

function table(name: string, rows: Record<string, unknown>[], extra: Partial<FakeTable> = {}): void {
  db[name] = { rows, maxRows: 1000, ...extra }
}

function makeBuilder(name: string) {
  const state = {
    head: false, org: undefined as string | undefined,
    orderCol: undefined as string | undefined,
    from: 0, to: Number.POSITIVE_INFINITY,
    op: 'select' as 'select' | 'delete' | 'upsert',
  }

  async function exec(): Promise<{ data: unknown; count: number | null; error: { message: string } | null }> {
    const t = db[name]
    if (!t)       return { data: null, count: null, error: { message: `relation "public.${name}" does not exist` } }
    if (t.error)  return { data: null, count: null, error: { message: t.error } }

    if (state.op === 'delete') {
      if (t.deleteError) return { data: null, count: null, error: { message: t.deleteError } }
      calls.deletes.push(name)
      t.rows = state.org ? t.rows.filter(r => r.org_id !== state.org) : []
      return { data: null, count: null, error: null }
    }
    if (state.op === 'upsert') return { data: null, count: null, error: null }

    if (state.orderCol && t.missingColumn === state.orderCol) {
      return { data: null, count: null, error: { message: `column ${name}.${state.orderCol} does not exist` } }
    }

    const visible = state.org ? t.rows.filter(r => r.org_id === state.org) : t.rows
    if (state.head) return { data: null, count: visible.length, error: null }
    if (t.selectError) return { data: null, count: null, error: { message: t.selectError } }

    if (t.truncateAfterFirstPage && state.from > 0) return { data: [], count: null, error: null }

    const end = Math.min(state.to + 1, state.from + t.maxRows)
    return { data: visible.slice(state.from, end), count: null, error: null }
  }

  const b = {
    select(_sel: string, opts?: { count?: string; head?: boolean }) { state.head = !!opts?.head; return b },
    eq(col: string, val: string) { if (col === 'org_id') state.org = val; return b },
    not() { return b },
    limit() { return b },
    order(column: string) { state.orderCol = column; calls.orders.push({ table: name, column }); return b },
    range(from: number, to: number) { state.from = from; state.to = to; return exec() },
    delete() { state.op = 'delete'; return b },
    upsert(rows: unknown[]) {
      state.op = 'upsert'
      calls.upserts.push({ table: name, count: rows.length })
      return b
    },
    then<A, B>(res: (v: Awaited<ReturnType<typeof exec>>) => A, rej?: (e: unknown) => B) {
      return exec().then(res, rej)
    },
  }
  return b as never
}

vi.mock('../../lib/supabase', () => ({
  supabase: { from: (name: string) => makeBuilder(name) },
}))

const {
  fetchTableData, preflightReplace, restoreFromBackup,
  BackupIntegrityError, MANAGED_TABLES,
} = await import('../backupRestore')
const { BACKUP_VERSION } = await import('../backupRestore')

const ORG = 'org-1'
const rowsFor = (n: number, org = ORG) =>
  Array.from({ length: n }, (_, i) => ({ id: `r${i}`, code: `c${i}`, org_id: org }))

function emptyDb(): void {
  for (const k of Object.keys(db)) delete db[k]
  for (const def of MANAGED_TABLES) table(def.key, [])
  calls.orders = []; calls.deletes = []; calls.upserts = []
}

function backupOf(managed: Record<string, Record<string, unknown>[]>) {
  return {
    _meta: {
      backupVersion: BACKUP_VERSION, appVersion: '1.0.0', createdAt: new Date().toISOString(),
      userId: 'u1', userEmail: 'u@example.com', managedTables: Object.keys(managed),
      unmanagedTables: [], skippedTables: [], warnings: [],
      schemaDiscoveryAvailable: true, strictMode: false,
    },
    managed,
    unmanaged: {},
  }
}

beforeEach(emptyDb)

// ── 1. The truncation bug ─────────────────────────────────────────────────────

describe('fetchTableData paging (regression: silent 1,000-row truncation)', () => {
  it('exports every row of a table far larger than the server max_rows cap', async () => {
    table('inflow_transactions', rowsFor(2500))
    const { rows } = await fetchTableData('inflow_transactions', undefined, ORG)
    expect(rows).toHaveLength(2500)
  })

  it('reports the true row count to the progress callback, not the capped one', async () => {
    table('inflow_transactions', rowsFor(2500))
    const seen: (number | undefined)[] = []
    await fetchTableData('inflow_transactions', (_s, c) => seen.push(c), ORG)
    expect(seen[seen.length - 1]).toBe(2500)
  })

  it('only returns rows belonging to the requested org', async () => {
    table('inflow_transactions', [...rowsFor(1500), ...rowsFor(1200, 'other-org')])
    const { rows } = await fetchTableData('inflow_transactions', undefined, ORG)
    expect(rows).toHaveLength(1500)
    expect(rows.every(r => r.org_id === ORG)).toBe(true)
  })
})

// ── 2 & 3. Completeness assertion ─────────────────────────────────────────────

describe('fetchTableData completeness assertion', () => {
  it('hard-fails when the export comes back short of the server count', async () => {
    table('inflow_transactions', rowsFor(2500), { truncateAfterFirstPage: true })
    await expect(fetchTableData('inflow_transactions', undefined, ORG))
      .rejects.toBeInstanceOf(BackupIntegrityError)
  })

  it('names the shortfall in the error so it cannot be mistaken for success', async () => {
    table('inflow_transactions', rowsFor(2500), { truncateAfterFirstPage: true })
    await expect(fetchTableData('inflow_transactions', undefined, ORG))
      .rejects.toThrow(/exported 1000 of 2500 rows/)
  })

  it('signals error — never done — to the progress callback on a shortfall', async () => {
    table('inflow_transactions', rowsFor(2500), { truncateAfterFirstPage: true })
    const seen: string[] = []
    await fetchTableData('inflow_transactions', s => seen.push(s), ORG).catch(() => {})
    expect(seen).toContain('error')
    expect(seen).not.toContain('done')
  })

  it('throws rather than exporting empty when a readable table errors mid-export', async () => {
    table('inflow_transactions', rowsFor(10), { selectError: 'connection reset' })
    await expect(fetchTableData('inflow_transactions', undefined, ORG)).rejects.toThrow(/connection reset/)
  })

  it('skips an unreachable table with a warning instead of failing the backup', async () => {
    const { rows, warnings } = await fetchTableData('table_that_does_not_exist', undefined, ORG)
    expect(rows).toEqual([])
    expect(warnings.join(' ')).toMatch(/not readable/)
  })
})

// ── 4. Non-`id` primary keys ──────────────────────────────────────────────────

describe('fetchTableData stable key', () => {
  it('pages currencies by its real PK (code), not id', async () => {
    table('currencies', rowsFor(1200).map(r => ({ code: r.code })), { missingColumn: 'id' })
    const { rows } = await fetchTableData('currencies', undefined, undefined, { stableKey: 'code' })
    expect(rows).toHaveLength(1200)
    expect(calls.orders.filter(o => o.table === 'currencies').every(o => o.column === 'code')).toBe(true)
  })

  it('falls back to one unordered page when the table has no stable key', async () => {
    table('legacy_table', rowsFor(400), { missingColumn: 'id' })
    const { rows, warnings } = await fetchTableData('legacy_table', undefined, ORG)
    expect(rows).toHaveLength(400)
    expect(warnings.join(' ')).toMatch(/single unordered page/)
  })

  it('still refuses a keyless table too large for one page', async () => {
    table('legacy_table', rowsFor(2500), { missingColumn: 'id' })
    await expect(fetchTableData('legacy_table', undefined, ORG))
      .rejects.toBeInstanceOf(BackupIntegrityError)
  })
})

// ── 5. Audit tables are registered and never deleted ──────────────────────────

describe('audit trail survives replace mode', () => {
  it('registers receipts, audit_log and field_changes as append-mode', () => {
    for (const key of ['receipts', 'audit_log', 'field_changes']) {
      const def = MANAGED_TABLES.find(t => t.key === key)
      expect(def, `${key} must be in the managed registry`).toBeDefined()
      expect(def?.restoreMode).toBe('append')
      expect(def?.backupEnabled).toBe(true)
    }
  })

  it('does not delete them during a replace restore', async () => {
    table('inflow_transactions', rowsFor(5))
    table('receipts', rowsFor(3)); table('audit_log', rowsFor(3)); table('field_changes', rowsFor(3))
    await restoreFromBackup(
      backupOf({ inflow_transactions: rowsFor(5) }),
      { mode: 'replace', restoreUnmanaged: false, acknowledgeDataLoss: true },
      ORG,
    )
    expect(calls.deletes).not.toContain('receipts')
    expect(calls.deletes).not.toContain('audit_log')
    expect(calls.deletes).not.toContain('field_changes')
    expect(db.audit_log.rows).toHaveLength(3)
  })
})

// ── 6. Replace-mode preflight ─────────────────────────────────────────────────

describe('preflightReplace', () => {
  it('flags a backup that holds fewer rows than the live table', async () => {
    table('inflow_transactions', rowsFor(2500))
    const pf = await preflightReplace(backupOf({ inflow_transactions: rowsFor(1000) }), ORG)
    expect(pf.safe).toBe(false)
    expect(pf.totalShortfall).toBe(1500)
    expect(pf.shortfalls[0]).toMatchObject({ key: 'inflow_transactions', liveRows: 2500, backupRows: 1000 })
  })

  it('passes a backup that covers every live row', async () => {
    table('inflow_transactions', rowsFor(40))
    const pf = await preflightReplace(backupOf({ inflow_transactions: rowsFor(40) }), ORG)
    expect(pf.safe).toBe(true)
    expect(pf.totalShortfall).toBe(0)
  })

  it('treats an unreadable table as unsafe rather than assuming zero', async () => {
    delete db.inflow_transactions
    const pf = await preflightReplace(backupOf({}), ORG)
    expect(pf.safe).toBe(false)
    expect(pf.unreadable).toContain('inflow_transactions')
  })
})

describe('restoreFromBackup replace guard', () => {
  it('aborts before deleting anything when the backup is short', async () => {
    table('inflow_transactions', rowsFor(2500))
    await expect(restoreFromBackup(
      backupOf({ inflow_transactions: rowsFor(1000) }),
      { mode: 'replace', restoreUnmanaged: false },
      ORG,
    )).rejects.toThrow(/Replace aborted/)
    expect(calls.deletes).toEqual([])
    expect(db.inflow_transactions.rows).toHaveLength(2500)
  })

  it('proceeds when the data loss is explicitly acknowledged', async () => {
    table('inflow_transactions', rowsFor(2500))
    const res = await restoreFromBackup(
      backupOf({ inflow_transactions: rowsFor(1000) }),
      { mode: 'replace', restoreUnmanaged: false, acknowledgeDataLoss: true },
      ORG,
    )
    expect(calls.deletes).toContain('inflow_transactions')
    expect(res.success).toBe(true)
  })

  it('never blocks merge mode', async () => {
    table('inflow_transactions', rowsFor(2500))
    const res = await restoreFromBackup(
      backupOf({ inflow_transactions: rowsFor(1) }),
      { mode: 'merge', restoreUnmanaged: false },
      ORG,
    )
    expect(res.success).toBe(true)
    expect(calls.deletes).toEqual([])
  })
})

// ── 7. Failed deletes are reported ────────────────────────────────────────────

describe('replace-mode delete errors', () => {
  it('reports a failed delete instead of silently swallowing it', async () => {
    table('inflow_transactions', rowsFor(5), { deleteError: 'permission denied for table inflow_transactions' })
    const res = await restoreFromBackup(
      backupOf({ inflow_transactions: rowsFor(5) }),
      { mode: 'replace', restoreUnmanaged: false, acknowledgeDataLoss: true },
      ORG,
    )
    expect(res.success).toBe(false)
    expect(res.errors.some(e => e.table === 'inflow_transactions' && /delete failed/i.test(e.message))).toBe(true)
  })
})
